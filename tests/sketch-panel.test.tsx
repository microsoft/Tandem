import assert from "node:assert/strict";
import { after, test } from "node:test";
import { JSDOM } from "jsdom";
import type { DslSketchDocument as SketchDocument, LegacySketchDocument } from "../src/sketch.js";
import type { UiContextValue, UiState } from "../src/renderer/ui-context.js";
import { createDslScreen as createScreen } from "../src/renderer/sketch-editor.js";
import { addUi, buttonScreen, createDocument, applyOperations } from "./helpers/ui-dsl-fixture.js";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
const globals = new Map<string, PropertyDescriptor | undefined>();
function globalValue(name: string, value: unknown) {
  if (!globals.has(name)) globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}
for (const name of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "NodeFilter", "CustomEvent",
  "MutationObserver", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement"]) {
  globalValue(name, dom.window[name as keyof Window]);
}
globalValue("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));
globalValue("IS_REACT_ACT_ENVIRONMENT", true);
const React = await import("react");
const { act, useCallback, useState } = React;
const { createRoot } = await import("react-dom/client");
const { DraftProvider, UiContext } = await import("../src/renderer/ui-context.js");
const { SketchPanel, SketchCompletionContext, isSketchRevisionApproved } = await import("../src/renderer/sketch-panel.js");

after(() => {
  dom.window.close();
  for (const [name, descriptor] of globals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

function fixture() {
  const document: SketchDocument = { version: 2, screens: [], transitions: [] };
  document.screens.push(buttonScreen(createScreen(document, ["Requirement.Main_1"])));
  const state = {
    version: 1, prototypeId: "react-sketch", generation: "first", revision: 1,
    lifecycle: { currentStage: "sketch", completedStages: ["prepare", "requirements"], skippedStages: [], outputs: [], history: [] },
    provider: { canSubmitAnswers: true }, prototypeApproach: { mode: "build", reason: "" },
    decisionGraph: { nodes: [{ id: "Requirement.Main_1", status: "answered", answer: "Use a screen", dependencies: [] }] },
    sketch: { version: 1, status: "draft", current: {
      id: "drawing-1", number: 1, documentHash: "hash-1", requirementsDigest: "requirements-1",
      createdAt: "2026-09-20T00:00:00.000Z", source: "generated",
    }, approved: null, history: [] },
  } as unknown as UiState;
  return { document, state };
}

async function harness(initial: { state: UiState; document: SketchDocument | LegacySketchDocument | null } = fixture()) {
  const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch");
  const imageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Image");
  const observerDescriptor = Object.getOwnPropertyDescriptor(globalThis, "ResizeObserver");
  let measureViewport = () => {};
  globalValue("ResizeObserver", class {
    constructor(callback: () => void) { measureViewport = callback; }
    observe() {}
    disconnect() { measureViewport = () => {}; }
  });
  let server = initial.state;
  let stored = initial.document;
  let visible = initial.state;
  let update!: (state: UiState) => void;
  let show!: (shown: boolean) => void;
  let completionBlocked = true;
  let confirm = true;
  let readError = "";
  let readGate: Promise<void> | null = null;
  let postHandler: ((endpoint: string, body: Record<string, any>) => Promise<UiState>) | null = null;
  const requests: Array<{ path: string; body: Record<string, any> | null }> = [];
  const exports: Array<{ width: number; height: number; source: string }> = [];
  const host = dom.window.document.createElement("div");
  dom.window.document.body.append(host);
  const root = createRoot(host);
  globalValue("Image", undefined);
  globalValue("fetch", async (path: string) => {
    requests.push({ path, body: null });
    if (readGate) await readGate;
    return {
      ok: !readError,
      json: async () => readError ? { error: readError } : { sketch: server.sketch, document: stored },
    };
  });
  const capture = new Set<number>();
  dom.window.HTMLElement.prototype.setPointerCapture = (id: number) => { capture.add(id); };
  dom.window.HTMLElement.prototype.hasPointerCapture = (id: number) => capture.has(id);
  dom.window.HTMLElement.prototype.releasePointerCapture = (id: number) => { capture.delete(id); };
  dom.window.SVGElement.prototype.getBoundingClientRect = function () {
    const canvas = this.closest<HTMLElement>("#sketch-canvas");
    const width = Number.parseFloat(canvas?.style.width ?? "") || Number(this.getAttribute("width")) || 960;
    const height = Number.parseFloat(canvas?.style.height ?? "") || Number(this.getAttribute("height")) || 640;
    const left = -(canvas?.parentElement?.scrollLeft ?? 0);
    const top = -(canvas?.parentElement?.scrollTop ?? 0);
    return { x: left, y: top, top, left, right: left + width, bottom: top + height, width, height, toJSON() {} };
  };
  const report = (blocked: boolean) => { completionBlocked = blocked; };
  function App() {
    const [state, setState] = useState(initial.state);
    const [pending, setPending] = useState(false);
    const [shown, setShown] = useState(true);
    visible = state;
    update = setState;
    show = setShown;
    const setBusy = useCallback((_key: string, busy: boolean) => setPending(busy), []);
    const context: UiContextValue = {
      state, pending, setBusy, refresh: async () => update(server),
      canEdit: (stage) => state.lifecycle.currentStage === stage && !state.lifecycle.completedStages.includes(stage)
        && state.provider?.canSubmitAnswers !== false && !state.lifecycle.skippedStages.some((item) => item.stageId === stage),
      guidance: () => "Return to the session that owns this effort to edit or approve designs.",
      confirm: async () => confirm, browseStage() {}, selectArtifact() {},
      post: async <T,>(endpoint: string, value: unknown): Promise<T> => {
        const body = value as Record<string, any>;
        requests.push({ path: endpoint, body });
        if (postHandler) server = await postHandler(endpoint, body);
        else if (body.action === "save") {
          stored = structuredClone(body.document);
          server = { ...server, revision: server.revision + 1, processing: null, sketch: { ...server.sketch,
            status: "draft", current: { ...server.sketch.current!, id: "drawing-2", documentHash: "hash-2", source: "edited" } } };
        } else if (body.action === "approve") {
          server = { ...server, revision: server.revision + 1, sketch: { ...server.sketch, status: "approved", approved: {
            revisionId: server.sketch.current!.id, documentHash: server.sketch.current!.documentHash,
            requirementsDigest: server.sketch.current!.requirementsDigest, approvedAt: "2026-09-20T00:01:00.000Z", assets: [],
          } } };
        } else if (endpoint === "/api/stage/complete") {
          server = { ...server, revision: server.revision + 1, lifecycle: { ...server.lifecycle, currentStage: "prototype",
            completedStages: [...server.lifecycle.completedStages, "sketch"] } };
        } else server = { ...server, revision: server.revision + 1, processing: {
          action: ["revise", "update"].includes(body.action) ? "revise-sketch" : "generate-sketch", status: "running", answer: body.instruction,
        } };
        update(server);
        return server as T;
      },
    };
    return <UiContext.Provider value={context}><DraftProvider>
      <SketchCompletionContext.Provider value={report}><div hidden={!shown}><SketchPanel /></div></SketchCompletionContext.Provider>
    </DraftProvider></UiContext.Provider>;
  }
  await act(async () => { root.render(<App />); });
  const element = <T extends HTMLElement = HTMLElement>(id: string) => {
    const node = host.querySelector<T>(`#sketch-${id}`);
    assert.ok(node, id);
    return node;
  };
  async function event(node: Element, type: string, values: Record<string, unknown> = {}) {
    await act(async () => {
      const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
      for (const [key, value] of Object.entries(values)) Object.defineProperty(event, key, { value });
      node.dispatchEvent(event);
    });
  }
  return {
    requests, exports, element,
    treeNode(id: string) {
      const node = element("structure-tree").querySelector<HTMLButtonElement>(`[data-node-id="${id}"]`);
      assert.ok(node, `Missing structure node ${id}`);
      return node;
    },
    selectedNodeId() {
      return element("structure-tree").querySelector<HTMLElement>('[aria-selected="true"]')?.dataset.nodeId ?? null;
    },
    preview() { return element("board").querySelector(".dsl-view")!.shadowRoot!.querySelector<HTMLElement>(".uidl-surface")!; },
    viewSize() {
      const view = element("canvas").firstElementChild as HTMLElement;
      return [Number.parseFloat(view.style.width), Number.parseFloat(view.style.height)];
    },
    get state() { return visible; },
    get server() { return server; },
    get completionBlocked() { return completionBlocked; },
    async close() {
      await act(async () => root.unmount());
      await new Promise((resolve) => setTimeout(resolve, 0));
      host.remove();
      if (fetchDescriptor) Object.defineProperty(globalThis, "fetch", fetchDescriptor);
      else Reflect.deleteProperty(globalThis, "fetch");
      if (imageDescriptor) Object.defineProperty(globalThis, "Image", imageDescriptor);
      else Reflect.deleteProperty(globalThis, "Image");
      if (observerDescriptor) Object.defineProperty(globalThis, "ResizeObserver", observerDescriptor);
      else Reflect.deleteProperty(globalThis, "ResizeObserver");
    },
    async click(id: string) { await act(async () => element<HTMLButtonElement>(id).click()); },
    async input(id: string, value: string) {
      const node = element<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(id);
      const prototype = node instanceof dom.window.HTMLTextAreaElement ? dom.window.HTMLTextAreaElement.prototype
        : node instanceof dom.window.HTMLSelectElement ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(node, value);
      await event(node, node instanceof dom.window.HTMLSelectElement ? "change" : "input");
    },
    async selectScreen(index: number) {
      await act(async () => element("screens").querySelectorAll<HTMLButtonElement>("button")[index].click());
    },
    async resizeViewport(width: number, height: number) {
      const node = element("board-wrap");
      node.style.padding = "12px";
      node.style.border = "1px solid";
      node.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, width, height, right: width, bottom: height, toJSON() {} });
      Object.defineProperties(node, {
        clientWidth: { configurable: true, value: width - 2 },
        clientHeight: { configurable: true, value: height - 2 },
      });
      const canvas = element("canvas");
      canvas.getBoundingClientRect = () => {
        const width = Number.parseFloat(canvas.style.width), height = Number.parseFloat(canvas.style.height);
        const left = 12 + Math.max(0, (node.clientWidth - 24 - width) / 2) - node.scrollLeft;
        const top = 12 + Math.max(0, (node.clientHeight - 24 - height) / 2) - node.scrollTop;
        return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON() {} };
      };
      await act(async () => measureViewport());
    },
    event,
    async sse(next: UiState) { server = next; await act(async () => update(next)); },
    async hidden(value: boolean) { await act(async () => show(!value)); },
    setConfirm(value: boolean) { confirm = value; },
    setPost(value: typeof postHandler) { postHandler = value; },
    setReadError(value: string) { readError = value; },
    setReadGate(value: Promise<void> | null) { readGate = value; },
    setDocument(value: SketchDocument | LegacySketchDocument | null) { stored = value; },
    enablePng() {
      globalValue("Image", class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        source = "";
        set src(value: string) { this.source = value; queueMicrotask(() => this.onload?.()); }
      });
      dom.window.HTMLCanvasElement.prototype.getContext = function () {
        return { fillStyle: "", fillRect() {}, drawImage: (image: { source: string }) => {
          exports.push({ width: this.width, height: this.height, source: image.source });
        } } as unknown as CanvasRenderingContext2D;
      } as unknown as typeof dom.window.HTMLCanvasElement.prototype.getContext;
      dom.window.HTMLCanvasElement.prototype.toDataURL = () => "data:image/png;base64,iVBORw0KGgo=";
    },
  };
}

test("wireframe Designs explains its approval scope and previews saved navigation without edits or worker requests", async () => {
  const initial = fixture();
  initial.document.fidelity = "wireframe";
  const first = initial.document.screens[0];
  const second = buttonScreen(createScreen(initial.document, ["Requirement.Main_1"]));
  second.title = "Task details";
  initial.document.screens.push(second);
  initial.document.transitions.push({ id: "open-task", fromScreenId: first.id, toScreenId: second.id,
    trigger: "Open task", description: "Preview the task details, without running application logic." });
  first.ui = applyOperations(first.ui, [{ op: "update", id: "primary-action", props: { label: "Open task", action: "open-task" } }]);
  const h = await harness(initial);
  try {
    assert.equal(dom.window.document.getElementById("sketch-focus"), null);
    assert.equal(h.element("approve").getAttribute("aria-describedby"), null);
    assert.match(h.element("approve").title, /Appearance is deferred/);
    assert.match(h.element<HTMLTextAreaElement>("instruction").placeholder, /layout, label or navigation/);
    const requests = h.requests.length;
    await h.click("interact");
    await h.event(h.preview().querySelector('[data-ui-id="primary-action"]')!, "click");
    assert.equal(h.element<HTMLInputElement>("title").value, "Task details");
    await h.selectScreen(0);
    const flow = h.element("board-help").parentElement!.querySelector('nav[aria-label="Preview screen flow"]')!;
    assert.match(flow.textContent!, /Navigation preview only/);
    await h.event(flow.querySelector("button")!, "click");
    assert.equal(h.element<HTMLInputElement>("title").value, "Task details");
    assert.equal(h.element<HTMLButtonElement>("save").disabled, true, "Browsing cannot dirty the saved design.");
    assert.equal(h.requests.length, requests, "Click-through must not start generation, save or approve.");
  } finally { await h.close(); }
});

test("unchanged selected-screen content is not rerendered by another screen's streamed update", async () => {
  const initial = fixture();
  addUi(initial.document.screens[0], "task-name", "Input", { label: "Task name", placeholder: "Name" });
  initial.document.screens.push(buttonScreen(createScreen(initial.document, ["Requirement.Main_1"])));
  const h = await harness(initial);
  try {
    await h.sse(streaming(h.state, initial.document, 1));
    await h.click("interact");
    const input = h.preview().querySelector<HTMLInputElement>("input")!;
    input.value = "Local preview input";
    await h.event(input, "input");
    let mutations = 0;
    const observer = new dom.window.MutationObserver(records => { mutations += records.length; });
    observer.observe(h.preview(), { subtree: true, childList: true, attributes: true, characterData: true });
    const otherScreen = structuredClone(initial.document);
    otherScreen.screens[1].ui = applyOperations(otherScreen.screens[1].ui,
      [{ op: "update", id: "primary-action", props: { label: "Other page updated" } }]);
    await h.sse(streaming(h.state, otherScreen, 2));
    observer.disconnect();
    assert.equal(h.preview().querySelector("input"), input);
    assert.equal(input.value, "Local preview input");
    assert.equal(mutations, 0, "An unrelated page update should not touch the selected preview DOM.");
  } finally { await h.close(); }
});

function streaming(state: UiState, document: SketchDocument, sequence = 1): UiState {
  const request = {
    generation: state.generation, baseRevisionId: state.sketch.current?.id ?? null,
    requirementsDigest: "requirements-1",
  };
  return { ...state, processing: {
    action: state.sketch.current ? "revise-sketch" : "generate-sketch", status: "running",
    requestId: "stream-request", runId: "stream-run", sketchRequest: request,
    answer: "Move the navigation", message: "Designing screens",
  }, sketchPreview: {
    prototypeId: state.prototypeId, ...request, requestId: "stream-request", runId: "stream-run", sequence, document,
  } };
}

test("React sketch shows generation in the main area before the first screen with a request-based elapsed timer", async t => {
  const initial = fixture();
  initial.state.sketch.current = null;
  initial.state.sketch.status = "empty";
  let now = Date.parse("2026-10-23T11:12:00.000Z");
  t.mock.method(Date, "now", () => now);
  const intervals = new Map<number, () => void>();
  let intervalId = 0;
  t.mock.method(dom.window, "setInterval", (callback: TimerHandler, delay?: number) => {
    assert.equal(typeof callback, "function");
    assert.equal(delay, 1000);
    const id = ++intervalId;
    intervals.set(id, () => { if (typeof callback === "function") callback(); });
    return id;
  });
  t.mock.method(dom.window, "clearInterval", (id?: number) => { if (id !== undefined) intervals.delete(id); });
  initial.state.processing = {
    action: "generate-sketch", status: "starting", requestId: "first-design",
    requestedAt: new Date(now - 65_000).toISOString(), message: "Designing the primary screens from the accepted requirements.",
  };
  const h = await harness({ state: initial.state, document: null });
  try {
    assert.equal(h.element("generation").dataset.empty, "true");
    assert.equal(h.element("generation-title").textContent, "Starting UI design");
    assert.equal(h.element("generation-elapsed").textContent, "1m 5s elapsed");
    assert.equal(h.element("generation-elapsed").getAttribute("aria-live"), "off");
    assert.equal(h.element("generation-status").getAttribute("role"), "status");
    assert.match(h.element("generation-status").textContent!, /Designing the primary screens/);
    assert.equal(h.element("empty").hidden, true, "Do not tell users to generate while generation is already running.");
    assert.equal(h.element("status").hidden, true, "The main indicator replaces duplicate status copy.");
    assert.equal(h.element<HTMLButtonElement>("generate").disabled, true);
    assert.equal(h.element<HTMLButtonElement>("approve").disabled, true);
    assert.doesNotMatch(h.element("generation").textContent!, /%|complete/i);
    assert.deepEqual(h.requests, [{ path: "/api/sketch", body: null }]);
    now += 2000;
    await act(async () => { for (const update of intervals.values()) update(); });
    assert.equal(h.element("generation-elapsed").textContent, "1m 7s elapsed");
    await h.sse({ ...h.server, revision: 2, processing: { ...h.server.processing, status: "running" } });
    assert.equal(h.element("generation-title").textContent, "Generating UI design");
    assert.equal(h.element("generation-elapsed").textContent, "1m 7s elapsed", "Polling does not restart the request clock.");
    await h.sse({ ...h.server, revision: 3, processing: { ...h.server.processing, status: "cancelled" } });
    assert.equal(h.element("empty").hidden, false);
    assert.equal(h.element("empty").parentElement!.querySelector("#sketch-generation"), null);
    assert.equal(intervals.size, 0, "Stopping generation clears its timer.");
  } finally { await h.close(); }
});

test("React sketch does not invent an elapsed time when the generation timestamp is missing", async () => {
  const initial = fixture();
  initial.state.sketch.current = null;
  initial.state.processing = { action: "generate-sketch", status: "running" };
  const h = await harness({ state: initial.state, document: null });
  try {
    assert.equal(h.element("generation-title").textContent, "Generating UI design");
    assert.equal(h.element("generation").querySelector('[role="timer"]'), null);
    assert.match(h.element("generation-status").textContent!, /Preparing screens from your accepted requirements/);
  } finally { await h.close(); }
});

test("React sketch displays incremental DSL components before a first saved revision without refetching", async () => {
  const initial = fixture();
  initial.state.sketch.current = null;
  initial.state.sketch.status = "empty";
  const h = await harness({ ...initial, document: null as unknown as SketchDocument });
  try {
    const document = structuredClone(initial.document);
    document.screens[0].ui = createDocument();
    document.screens[0].title = "Incoming screen";
    await h.sse(streaming(h.server, document));
    assert.equal(h.element("generation").dataset.empty, "false");
    assert.match(h.element("generation-progress").textContent!, /1 screen received.*live update 1/);
    assert.equal(h.element<HTMLInputElement>("title").value, "Incoming screen");
    assert.equal(h.element("workspace").hidden, false);
    assert.equal(h.preview().querySelectorAll("[data-ui-id]:not([data-type=Screen])").length, 0);
    const second = structuredClone(document);
    buttonScreen(second.screens[0]);
    await h.sse(streaming(h.server, second, 2));
    assert.equal(h.preview().querySelectorAll("[data-ui-id]:not([data-type=Screen])").length, 1);
    const third = structuredClone(second);
    addUi(third.screens[0], "label", "Text", { text: "Already visible" });
    await h.sse(streaming(h.server, third, 3));
    assert.equal(h.preview().querySelectorAll("[data-ui-id]:not([data-type=Screen])").length, 2);
    assert.match(h.preview().textContent!, /Already visible/);
    assert.match(h.element("status").textContent!, /Live preview.*update 3.*not saved or approved/);
    assert.match(h.element("generation-progress").textContent!, /1 screen received.*live update 3/);
    assert.equal(h.state.sketch.current, null);
    assert.deepEqual(h.requests, [{ path: "/api/sketch", body: null }], "preview updates never load saved designs");
    assert.equal(h.completionBlocked, true);
    for (const id of ["save", "approve", "generate", "add-screen", "undo", "redo", "reload",
      "title", "size-preset", "add-transition"]) {
      assert.equal(h.element<HTMLButtonElement>(id).disabled, true, id);
    }
    await h.input("title", "Cannot mutate a preview");
    await h.click("add-screen");
    assert.equal(h.element<HTMLInputElement>("title").value, "Incoming screen");
    assert.equal(h.preview().querySelectorAll("[data-ui-id]:not([data-type=Screen])").length, 2);
    await h.sse({ ...h.server, processing: { ...h.server.processing, status: "error", message: "Stream failed. Retry explicitly." },
      sketchPreview: null });
    assert.equal(h.element("empty").hidden, false);
    assert.equal(h.element("empty").parentElement!.querySelector("#sketch-generation"), null);
    assert.equal(h.element<HTMLButtonElement>("undo").disabled, true);
    assert.equal(h.element<HTMLButtonElement>("save").disabled, true);
    assert.match(h.element("message").textContent!, /Stream failed/);
  } finally { await h.close(); }
});

test("React sketch lists titled waiting pages first and keeps each page's progress until its preview is ready", async () => {
  const initial = fixture();
  initial.state.sketch.current = null;
  initial.state.sketch.status = "empty";
  const h = await harness({ state: initial.state, document: null });
  try {
    const document = structuredClone(initial.document);
    const first = document.screens[0];
    first.ui = createDocument();
    first.title = "Menu";
    const second = createScreen(document, ["Requirement.Main_1"]);
    second.title = "Drink details";
    document.screens.push(second);
    const initialPreview = streaming(h.server, document);
    const update = async (sequence: number, screenStatuses: Record<string, "waiting" | "processing" | "ready">) =>
      h.sse({ ...initialPreview, sketchPreview: { ...initialPreview.sketchPreview!, sequence,
        document: structuredClone(document), screenStatuses } });
    await update(1, { [first.id]: "waiting", [second.id]: "waiting" });
    const buttons = () => [...h.element("screens").querySelectorAll<HTMLButtonElement>("button")];
    assert.deepEqual(buttons().map(button => button.textContent), ["MenuWaiting", "Drink detailsWaiting"]);
    assert.ok(buttons().every(button => button.dataset.screenStatus === "waiting" && !button.disabled));
    assert.equal(h.element("page-status").dataset.status, "waiting");
    assert.match(h.element("board").textContent!, /Menu.*Waiting for design/);
    assert.equal(h.element("board").getAttribute("aria-busy"), "true");
    await update(2, { [first.id]: "processing", [second.id]: "waiting" });
    assert.ok(buttons()[0].querySelector(".processing-indicator"));
    assert.match(h.element("page-status").textContent!, /Menu.*Design in progress/);
    buttonScreen(first);
    await update(3, { [first.id]: "processing", [second.id]: "waiting" });
    assert.equal(h.element("board").querySelector(".sketch-page-placeholder"), null, "Keep streamed UI visible under its progress heading.");
    await h.selectScreen(1);
    assert.match(h.element("page-status").textContent!, /Drink details.*Waiting for design/);
    await update(4, { [first.id]: "ready", [second.id]: "processing" });
    assert.equal(buttons()[0].dataset.screenStatus, "ready");
    assert.equal(buttons()[0].querySelector(".processing-indicator"), null);
    assert.match(h.element("page-status").textContent!, /Drink details.*Design in progress/);
    await h.selectScreen(0);
    assert.match(h.element("page-status").textContent!, /Menu.*Preview ready - not saved or approved/);
    assert.equal(h.element("board").getAttribute("aria-busy"), "false");
    assert.equal(h.element<HTMLButtonElement>("approve").disabled, true);
    assert.equal(h.completionBlocked, true);
    assert.deepEqual(h.requests, [{ path: "/api/sketch", body: null }]);
    await h.sse({ ...h.server, processing: { ...h.server.processing, status: "cancelled" }, sketchPreview: null });
    assert.equal(h.element("empty").parentElement!.querySelector("#sketch-page-status"), null);
  } finally { await h.close(); }
});

test("React sketch streaming screens stay navigable across updates and failure restores saved designs without undo entries", async () => {
  const initial = fixture();
  const h = await harness(initial);
  try {
    const document = structuredClone(initial.document);
    document.screens[0].ui = applyOperations(document.screens[0].ui, [
      { op: "update", id: "primary-action", props: { label: "Live action" } },
    ]);
    const second = createScreen(document, ["Requirement.Main_1"]);
    second.title = "Second live screen";
    addUi(second, "label", "Text", { text: "Streaming label" });
    document.screens.push(second);
    await h.sse(streaming(h.server, document));
    assert.equal(h.element("generation-title").textContent, "Updating UI design");
    assert.match(h.element("generation-progress").textContent!, /Updating existing designs.*live update 1/);
    await h.selectScreen(1);
    assert.equal(h.element<HTMLInputElement>("title").value, "Second live screen");
    assert.match(h.preview().textContent!, /Streaming label/);
    await h.click("zoom-actual");
    await h.click("zoom-out");
    assert.equal(h.element("zoom").textContent, "80%");
    const next = structuredClone(document);
    addUi(next.screens[1], "hint", "Text", { text: "Another component" });
    await h.sse(streaming(h.server, next, 2));
    assert.equal(h.element<HTMLInputElement>("title").value, "Second live screen");
    assert.equal(h.preview().querySelectorAll("[data-ui-id]:not([data-type=Screen])").length, 2);
    assert.equal(h.element("zoom").textContent, "80%", "incremental chunks do not reset navigation");
    await h.sse({ ...h.server, processing: { ...h.server.processing, status: "error", message: "Design worker failed. Retry explicitly." },
      sketchPreview: null });
    assert.equal(h.element<HTMLInputElement>("title").value, "Screen 1");
    assert.equal(h.preview().querySelector("[data-ui-id='primary-action']")!.textContent, "Continue");
    assert.equal(h.preview().querySelectorAll("[data-ui-id]:not([data-type=Screen])").length, 1);
    assert.equal(h.element<HTMLButtonElement>("save").disabled, true);
    assert.equal(h.element<HTMLButtonElement>("undo").disabled, true);
    assert.equal(h.element<HTMLButtonElement>("redo").disabled, true);
    assert.equal(h.requests.length, 1);
    assert.match(h.element("failed-instruction").textContent!, /Move the navigation/);
    assert.equal(h.element<HTMLButtonElement>("retry-revision").disabled, false);
    assert.equal(h.element("board").getAttribute("aria-label"), "UI DSL screen view");
  } finally { await h.close(); }
});

test("failed generation keeps completed and partial pages navigable and retries without saving or starting over", async () => {
  const initial = fixture();
  initial.state.sketch.current = null;
  initial.state.sketch.status = "empty";
  const h = await harness({ state: initial.state, document: null });
  try {
    const document = structuredClone(initial.document);
    const first = document.screens[0];
    first.title = "Completed page";
    const second = createScreen(document, ["Requirement.Main_1"]);
    second.title = "Partial page";
    addUi(second, "partial-title", "Heading", { text: "Retained partial content" });
    document.screens.push(second);
    const third = createScreen(document, ["Requirement.Main_1"]);
    third.title = "Waiting page";
    document.screens.push(third);
    document.transitions.push({ id: "next", fromScreenId: first.id, toScreenId: second.id, trigger: "Next", description: "" });
    const live = streaming(h.server, document);
    live.sketchPreview!.screenStatuses = { [first.id]: "ready", [second.id]: "processing", [third.id]: "waiting" };
    await h.sse(live);
    await h.selectScreen(1);
    const failed = { ...live, revision: live.revision + 1,
      processing: { ...live.processing, status: "error", message: "'size' is not a prop of List.",
        sketchRecovery: { phase: "content", preview: live.sketchPreview } } };
    await h.sse(failed);
    assert.match(h.preview().textContent!, /Retained partial content/);
    assert.equal(h.element("page-status").dataset.status, "stopped");
    assert.equal(h.element("board").getAttribute("aria-busy"), "false");
    assert.equal(h.element("workspace").querySelector(".processing-indicator"), null);
    assert.deepEqual([...h.element("screens").querySelectorAll("button")].map(item => item.textContent),
      ["Completed pageReady", "Partial pageStopped", "Waiting pageWaiting"]);
    assert.match(h.element("status").textContent!, /incomplete preview, not saved or approved/);
    assert.equal(h.element<HTMLButtonElement>("save").disabled, true);
    assert.equal(h.element<HTMLButtonElement>("approve").disabled, true);
    assert.equal(h.element<HTMLButtonElement>("retry-generation").disabled, false);
    await h.selectScreen(0);
    assert.equal(h.preview().querySelector("button")!.textContent, "Continue");
    await h.selectScreen(2);
    assert.equal(h.element("board").getAttribute("aria-busy"), "false");
    assert.match(h.element("board").textContent!, /Waiting page/);
    await h.selectScreen(1);
    h.setPost(async (endpoint, body) => {
      assert.equal(endpoint, "/api/sketch");
      assert.deepEqual(body, { action: "retry", expectedRevision: null, expectedGeneration: failed.generation,
        requestId: failed.processing.requestId });
      return { ...failed, revision: failed.revision + 1,
        processing: { ...failed.processing, status: "running", requestId: "retry-request", runId: null, sketchRecovery: null,
          sketchResume: failed.processing.sketchRecovery },
        sketchPreview: live.sketchPreview };
    });
    await h.click("retry-generation");
    assert.equal(h.requests.length, 2, "Only the initial read and explicit retry, never an implicit save or regenerate.");
    assert.match(h.preview().textContent!, /Retained partial content/);
    assert.equal(h.element("page-status").dataset.status, "processing");
    await h.sse({ ...h.server, revision: h.server.revision + 1,
      processing: { ...h.server.processing, runId: "retry-run" },
      sketchPreview: { ...live.sketchPreview!, requestId: "retry-request", runId: "retry-run", sequence: 0 } });
    assert.match(h.preview().textContent!, /Retained partial content/);
    assert.equal(h.state.sketch.current, null);
    assert.equal(h.completionBlocked, true);
  } finally { await h.close(); }
});

test("React sketch incoming preview never obscures local edits or changes their undo history", async () => {
  const initial = fixture();
  const h = await harness(initial);
  try {
    await h.input("title", "My unsaved title");
    const document = structuredClone(initial.document);
    document.screens[0].title = "Incoming AI title";
    addUi(document.screens[0], "label", "Text", { text: "Incoming component" });
    await h.sse(streaming(h.server, document));
    assert.equal(h.element<HTMLInputElement>("title").value, "My unsaved title");
    assert.equal(h.preview().querySelectorAll("[data-ui-id]:not([data-type=Screen])").length, 1);
    assert.match(h.element("status").textContent!, /Live preview pending.*local edits are preserved.*not saved or approved/);
    assert.match(h.element("generation").textContent!, /Your local edits remain visible.*not saved or approved/);
    assert.equal(h.element("workspace").querySelector("#sketch-page-status"), null, "Incoming progress must not label unsaved local edits.");
    assert.equal(h.element<HTMLButtonElement>("reload").disabled, true);
    assert.equal(h.element<HTMLButtonElement>("save").disabled, true);
    await h.sse({ ...h.server, processing: { ...h.server.processing, status: "cancelled" }, sketchPreview: null });
    assert.equal(h.element<HTMLInputElement>("title").value, "My unsaved title");
    assert.equal(h.element<HTMLButtonElement>("save").disabled, false);
    await h.click("undo");
    assert.equal(h.element<HTMLInputElement>("title").value, "Screen 1");
    assert.equal(h.element<HTMLButtonElement>("undo").disabled, true);
    assert.equal(h.element<HTMLButtonElement>("save").disabled, true);
    await h.click("redo");
    assert.equal(h.element<HTMLInputElement>("title").value, "My unsaved title");
    await h.click("save");
    const saved = h.requests.find((request) => request.body?.action === "save")!.body!.document as SketchDocument;
    assert.equal(saved.screens[0].title, "My unsaved title");
    assert.deepEqual(saved.screens[0].ui, initial.document.screens[0].ui);
  } finally { await h.close(); }
});

test("React sketch ignores late request and generation previews and reports malformed matching documents", async () => {
  const initial = fixture();
  const h = await harness(initial);
  try {
    const document = structuredClone(initial.document);
    document.screens[0].title = "Live title";
    const active = streaming(h.server, document);
    for (const field of ["prototypeId", "generation", "requestId", "runId", "baseRevisionId", "requirementsDigest"]) {
      const stale = { ...active.sketchPreview!, [field]: "obsolete", document: {} };
      await h.sse({ ...active, sketchPreview: stale as UiState["sketchPreview"] });
      assert.equal(h.element<HTMLInputElement>("title").value, "Screen 1", field);
      assert.equal(h.element("message").hidden, true, field);
    }
    await h.sse(active);
    assert.equal(h.element<HTMLInputElement>("title").value, "Live title");
    await h.sse({ ...active, processing: { ...active.processing, requestId: "replacement" } });
    assert.equal(h.element<HTMLInputElement>("title").value, "Screen 1");
    await h.sse({ ...active, generation: "replacement-generation" });
    assert.equal(h.element<HTMLInputElement>("title").value, "Screen 1");
    await h.sse({ ...active, sketchPreview: { ...active.sketchPreview!, document: {} as SketchDocument } });
    assert.equal(h.element<HTMLInputElement>("title").value, "Screen 1");
    assert.match(h.element("message").textContent!, /preview is invalid.*unchanged.*retry/);
    assert.equal(h.preview().querySelectorAll("[data-ui-id]:not([data-type=Screen])").length, 1);
  } finally { await h.close(); }
});

test("React sketch blocks completion of previously approved designs until streaming ends and loads only the saved success revision", async () => {
  const initial = fixture();
  initial.state.sketch.status = "approved";
  initial.state.sketch.approved = {
    revisionId: "drawing-1", documentHash: "hash-1", requirementsDigest: "requirements-1",
    approvedAt: "2026-09-20T00:01:00.000Z", assets: [],
  };
  const h = await harness(initial);
  let release = () => {};
  try {
    assert.equal(h.completionBlocked, false);
    const document = structuredClone(initial.document);
    document.screens[0].title = "Unsaved live result";
    await h.sse(streaming(h.server, document));
    assert.equal(h.completionBlocked, true, "old approval does not approve a running preview");
    assert.equal(h.element<HTMLButtonElement>("approve").disabled, true);
    h.setReadGate(new Promise<void>((resolve) => { release = resolve; }));
    const saved = structuredClone(document);
    saved.screens[0].title = "Confirmed saved result";
    h.setDocument(saved);
    await h.sse({ ...h.server, revision: 2, sketchPreview: null, processing: { ...h.server.processing, status: "success" },
      sketch: { ...h.server.sketch, status: "draft", approved: null, current: {
        ...h.server.sketch.current!, id: "drawing-success", documentHash: "saved-hash", number: 2,
      } } });
    assert.match(h.element("status").textContent!, /Loading saved designs/);
    assert.equal(h.element("status").parentElement!.querySelector("#sketch-generation"), null);
    assert.doesNotMatch(h.element("status").textContent!, /approved/);
    assert.notEqual(h.element<HTMLInputElement>("title").value, "Unsaved live result");
    assert.equal(h.element<HTMLButtonElement>("approve").disabled, true);
    assert.equal(h.completionBlocked, true);
    await act(async () => release());
    assert.equal(h.element<HTMLInputElement>("title").value, "Confirmed saved result");
    assert.equal(h.element<HTMLButtonElement>("save").disabled, true);
    assert.equal(h.element<HTMLButtonElement>("undo").disabled, true);
    assert.equal(h.element<HTMLButtonElement>("approve").disabled, false);
    assert.equal(h.completionBlocked, true, "new saved revision still needs explicit approval");
    assert.equal(h.requests.length, 2, "only the final saved revision triggers another design read");
  } finally { release(); await h.close(); }
});

test("React sketch composer keeps only text, Send and history, with explicit keyboard submission", async () => {
  for (const modifier of ["ctrlKey", "metaKey"]) {
    const h = await harness();
    try {
      const input = h.element<HTMLTextAreaElement>("instruction");
      const form = input.form!;
      assert.equal(input.readOnly, false);
      assert.equal(input.maxLength, 4000);
      assert.equal(input.rows, 1);
      assert.deepEqual([...form.querySelectorAll("button")].map(button => button.id), ["sketch-revise", "sketch-history-toggle"]);
      assert.equal(form.querySelector("select"), null);
      assert.equal(h.element<HTMLButtonElement>("revise").disabled, true);
      await h.input("instruction", "Move the primary action\nbelow the heading.");
      await h.hidden(true);
      await h.hidden(false);
      await h.sse({ ...h.server, revision: 2 });
      assert.equal(h.element("instruction"), input);
      assert.equal(input.value, "Move the primary action\nbelow the heading.");
      await h.event(input, "keydown", { key: "Enter" });
      await h.event(input, "keydown", { key: "Enter", [modifier]: true, isComposing: true });
      assert.equal(h.requests.filter(request => request.body).length, 0);
      await h.event(input, "keydown", { key: "Enter", [modifier]: true });
      const writes = h.requests.filter(request => request.body);
      assert.match(writes[0].body!.clientRequestId, /^[a-f0-9-]{36}$/);
      assert.deepEqual(writes.map(request => request.body), [{
        action: "revise", expectedRevision: "drawing-1", instruction: "Move the primary action\nbelow the heading.",
        clientRequestId: writes[0].body!.clientRequestId,
        sketchContext: { revisionId: "drawing-1", screenId: "screen-1", nodeId: null },
      }]);
      assert.equal(input.value, "");
      assert.equal(h.state.sketch.approved, null);
      assert.equal(h.state.lifecycle.currentStage, "sketch");
    } finally { await h.close(); }
  }
});

test("React sketch creates empty DSL screens and preserves metadata and transitions without geometry tools", async () => {
  const initial = fixture();
  initial.state.sketch.current = null;
  initial.state.sketch.status = "empty";
  const h = await harness({ ...initial, document: null as unknown as SketchDocument });
  try {
    assert.deepEqual(h.requests, [{ path: "/api/sketch", body: null }]);
    await h.click("add-screen");
    assert.equal(h.preview().querySelectorAll("[data-ui-id]").length, 1);
    assert.equal(h.element("workspace").querySelector("#sketch-tools"), null);
    await h.input("title", "Home");
    await h.click("add-screen");
    await h.click("add-transition");
    const trigger = h.element("transitions").querySelector("input")!;
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(trigger, "Open home");
    await h.event(trigger, "input");
    await h.click("save");
    const document = h.requests.at(-1)!.body!.document as SketchDocument;
    assert.equal(document.screens[0].title, "Home");
    assert.equal(document.version, 2);
    assert.deepEqual(document.screens[0].ui.nodes.screen.children, []);
    assert.deepEqual(document.screens[0].decisionIds, ["Requirement.Main_1"]);
    assert.equal(document.transitions[0].trigger, "Open home");
    assert.equal(h.completionBlocked, true);
    assert.equal(h.element<HTMLButtonElement>("approve").disabled, true);
  } finally { await h.close(); }
});

test("React sketch preserves invalid screen and transition fields across SSE and hidden tabs", async () => {
  const h = await harness();
  try {
    await h.input("purpose", "");
    await h.click("add-transition");
    const trigger = h.element("transitions").querySelector("input")!;
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(trigger, "");
    await h.event(trigger, "input");
    await h.hidden(true);
    await h.sse({ ...h.server, revision: 2 });
    await h.hidden(false);
    assert.equal(h.element<HTMLInputElement>("purpose").value, "");
    assert.equal(h.element("purpose").getAttribute("aria-invalid"), "true");
    assert.equal(trigger.value, "");
    assert.equal(h.element<HTMLButtonElement>("save").disabled, true);
    await h.click("undo");
    assert.equal(h.element<HTMLInputElement>("purpose").value, "Support the selected requirements.");
    assert.equal(trigger.value, "Continue");
  } finally { await h.close(); }
});









test("React sketch retains local edits on remote conflict and only discards after explicit confirmation", async () => {
  const h = await harness();
  try {
    await h.input("title", "Local title");
    await h.sse({ ...h.server, revision: 2, sketch: { ...h.server.sketch, current: { ...h.server.sketch.current!, id: "remote" } } });
    assert.match(h.element("status").textContent!, /Conflict.*local edits are retained/);
    assert.equal(h.requests.length, 1);
    assert.equal(h.element<HTMLButtonElement>("save").disabled, true);
    h.setConfirm(false);
    await h.click("reload");
    assert.equal(h.element<HTMLInputElement>("title").value, "Local title");
    h.setConfirm(true);
    await h.click("reload");
    assert.equal(h.element<HTMLInputElement>("title").value, "Screen 1");
    assert.equal(h.requests.length, 2);
  } finally { await h.close(); }
});





test("React sketch saves then exports every canonical screen before approving the exact revision", async () => {
  const initial = fixture();
  const second = createScreen(initial.document, ["Requirement.Main_1"]);
  second.width = 375;
  second.height = 812;
  addUi(second, "label", "Text", { text: "<script>&unsafe" });
  initial.document.screens.push(second);
  const h = await harness(initial);
  try {
    h.enablePng();
    await h.input("title", "Edited title");
    await h.click("approve");
    assert.deepEqual(h.requests.slice(1).map((request) => request.body!.action || request.body!.stageId), ["save", "approve", "sketch"]);
    assert.equal(h.requests[2].body!.expectedRevision, "drawing-2");
    assert.deepEqual(h.exports.map(({ width, height }) => [width, height]), [[960, 640], [375, 812]]);
    assert.match(decodeURIComponent(h.exports[1].source), /&lt;script&gt;&amp;unsafe/);
    assert.equal(h.state.lifecycle.currentStage, "prototype");
    assert.equal(isSketchRevisionApproved(h.state.sketch), true);
  } finally { await h.close(); }
});

test("React sketch preserves confirmed approval after continuation failure and rejects mismatched approval identity", async () => {
  const h = await harness();
  try {
    h.enablePng();
    h.setPost(async (endpoint) => {
      if (endpoint === "/api/stage/complete") throw new Error("Continuation failed. Retry Finish Sketch.");
      return { ...h.server, revision: 2, sketch: { ...h.server.sketch, status: "approved", approved: {
        revisionId: "drawing-1", documentHash: "hash-1", requirementsDigest: "requirements-1",
        approvedAt: "2026-09-20T00:01:00.000Z", assets: [],
      } } };
    });
    await h.click("approve");
    assert.match(h.element("message").textContent!, /Continuation failed/);
    assert.equal(h.completionBlocked, false);
    await h.sse({ ...h.server, revision: 3, sketch: { ...h.server.sketch, approved: {
      ...h.server.sketch.approved!, documentHash: "different-document",
    } } });
    assert.equal(h.completionBlocked, true);
  } finally { await h.close(); }
});

test("React sketch retries the original instruction after saving even when revision transport fails", async () => {
  const initial = fixture();
  initial.state.processing = { action: "revise-sketch", status: "error", answer: "Move navigation left", message: "Worker failed" };
  const h = await harness(initial);
  try {
    await h.input("instruction", "My later unsent instruction");
    await h.input("notes", "Local change");
    h.setPost(async (_endpoint, body) => {
      if (body.action === "revise") throw new Error("Retry transport unavailable");
      return { ...h.server, revision: 2, processing: null, sketch: { ...h.server.sketch, current: {
        ...h.server.sketch.current!, id: "drawing-edited", documentHash: "edited-hash",
      } } };
    });
    await h.click("retry-revision");
    assert.deepEqual(h.requests.slice(1).map((request) => request.body!.action), ["save", "revise"]);
    assert.equal(h.requests[2].body!.instruction, "Move navigation left");
    assert.equal(h.requests[2].body!.expectedRevision, "drawing-edited");
    await h.sse({ ...h.server, revision: 3 });
    assert.match(h.element("failed-instruction").textContent!, /Move navigation left/);
    assert.match(h.element("message").textContent!, /Retry transport unavailable/);
    assert.equal(h.element<HTMLTextAreaElement>("instruction").value, "My later unsent instruction");
  } finally { await h.close(); }
});

test("React sketch PNG failures, load failures and provider or worker gates remain explicit", async () => {
  const h = await harness();
  try {
    await h.click("approve");
    assert.match(h.element("message").textContent!, /PNG export is unavailable.*not approved/);
    assert.equal(h.requests.length, 1);
    h.setReadError("Design storage unavailable");
    await h.click("reload");
    await h.sse({ ...h.server, revision: 2 });
    assert.equal(h.requests.length, 2);
    assert.match(h.element("message").textContent!, /Design storage unavailable/);
    h.setReadError("");
    await h.click("reload");
    assert.equal(h.element<HTMLButtonElement>("approve").disabled, false);
    await h.sse({ ...h.server, revision: 3, provider: { canSubmitAnswers: false } });
    assert.equal(h.element<HTMLButtonElement>("approve").disabled, true);
    assert.match(h.element("status").textContent!, /session that owns this effort/);
    await h.sse({ ...h.server, revision: 4, provider: { canSubmitAnswers: true },
      processing: { action: "generate-sketch", status: "running", message: "Designing new screens" } });
    assert.equal(h.element<HTMLButtonElement>("add-screen").disabled, true);
    assert.match(h.element("status").textContent!, /Designing new screens/);
  } finally { await h.close(); }
});

test("React sketch clean SSE reloads do not generate and accepted decision references remain editable", async () => {
  const h = await harness();
  try {
    const document = fixture().document;
    document.screens[0].title = "Remote title";
    h.setDocument(document);
    await h.sse({ ...h.server, revision: 2, sketch: { ...h.server.sketch, current: {
      ...h.server.sketch.current!, id: "remote", documentHash: "remote-hash",
    } } });
    assert.equal(h.element<HTMLInputElement>("title").value, "Remote title");
    assert.equal(h.requests.length, 2);
    await h.input("decisions", "Requirement.Main_1, ");
    assert.equal(h.element<HTMLInputElement>("decisions").value, "Requirement.Main_1, ");
    await h.input("decisions", "Requirement.Main_1, unaccepted");
    await h.click("save");
    assert.match(h.element("message").textContent!, /outside the accepted requirements DAG/);
    assert.equal(h.requests.length, 2);
    await h.input("decisions", "Requirement.Main_1");
    await h.input("notes", "Valid draft");
    await h.click("save");
    assert.deepEqual(h.requests.at(-1)!.body!.document.screens[0].decisionIds, ["Requirement.Main_1"]);
  } finally { await h.close(); }
});

test("React sketch revision requests are explicit, duplicate-safe and keep unsent instructions on error", async () => {
  const h = await harness();
  try {
    h.setConfirm(false);
    await h.click("generate");
    assert.equal(h.requests.length, 1);
    await h.input("instruction", "Move navigation");
    let reject!: (cause: Error) => void;
    h.setPost(async () => await new Promise<UiState>((_resolve, fail) => { reject = fail; }));
    await h.click("revise");
    await h.click("revise");
    await h.click("approve");
    assert.equal(h.requests.length, 2);
    assert.deepEqual(h.requests[1].body, { action: "revise", expectedRevision: "drawing-1", instruction: "Move navigation",
      clientRequestId: h.requests[1].body!.clientRequestId,
      sketchContext: { revisionId: "drawing-1", screenId: "screen-1", nodeId: null } });
    assert.match(h.requests[1].body!.clientRequestId, /^[a-f0-9-]{36}$/);
    await act(async () => reject(new Error("Cannot start revision")));
    assert.match(h.element("message").textContent!, /Cannot start revision/);
    assert.equal(h.element<HTMLTextAreaElement>("instruction").value, "Move navigation");
  } finally { await h.close(); }
});

test("design requests bind the viewed screen and explicitly picked element without editing the DSL", async () => {
  const initial = fixture();
  initial.document.screens.push(buttonScreen(createScreen(initial.document, ["Requirement.Main_1"]), "Another action"));
  const h = await harness(initial);
  try {
    await h.input("change-target", "primary-action");
    assert.equal(h.preview().querySelector('[data-ui-id="primary-action"]')!.getAttribute("data-selected"), "true");
    await h.selectScreen(1);
    assert.equal(h.element<HTMLSelectElement>("change-target").value, "", "Identical node IDs on another screen are not the same selection.");
    assert.equal(h.preview().querySelector("[data-selected]"), null);
    await h.click("pick-element");
    assert.equal(h.element("pick-element").getAttribute("aria-pressed"), "true");
    await h.event(h.preview().querySelector('[data-ui-id="primary-action"]')!, "click");
    assert.equal(h.element("pick-element").getAttribute("aria-pressed"), "true", "Selection mode stays active after picking.");
    assert.equal(h.element<HTMLSelectElement>("change-target").value, "primary-action");
    assert.equal(h.element<HTMLButtonElement>("save").disabled, true);
    assert.equal(h.element<HTMLButtonElement>("undo").disabled, true);
    await h.input("instruction", "Replace this block with an icon.");
    await h.click("revise");
    assert.deepEqual(h.requests.at(-1)!.body!.sketchContext, {
      revisionId: "drawing-1", screenId: initial.document.screens[1].id, nodeId: "primary-action",
    });
    assert.equal(h.state.sketch.approved, null);
    assert.equal(h.requests.filter(request => request.body).length, 1, "Selecting a target is view context, not a saved edit or approval.");
  } finally { await h.close(); }
});

test("design selection survives view updates but cannot silently target a new saved revision", async () => {
  const initial = fixture();
  const h = await harness(initial);
  try {
    await h.input("change-target", "primary-action");
    await h.hidden(true); await h.hidden(false);
    await h.sse({ ...h.server, revision: 2 });
    assert.equal(h.element<HTMLSelectElement>("change-target").value, "primary-action");
    const newer = structuredClone(initial.document);
    newer.screens[0].notes = "Newer design";
    h.setDocument(newer);
    await h.sse({ ...h.server, revision: 3, sketch: { ...h.server.sketch,
      current: { ...h.server.sketch.current!, id: "drawing-new", documentHash: "new-hash" },
    } });
    assert.equal(h.element<HTMLSelectElement>("change-target").value, "");
    assert.equal(h.preview().querySelector("[data-selected]"), null);
    await h.input("instruction", "Adjust this screen.");
    await h.click("revise");
    assert.deepEqual(h.requests.at(-1)!.body!.sketchContext, {
      revisionId: "drawing-new", screenId: initial.document.screens[0].id, nodeId: null,
    });
  } finally { await h.close(); }
});

test("Structure follows Screen details without a Selection section and preserves persistent view selection", async () => {
  const initial = fixture(), screen = initial.document.screens[0];
  screen.ui = applyOperations(screen.ui, [
    { op: "add", parent: "screen", component: { id: "layout", type: "Stack", props: {} } },
    { op: "add", parent: "layout", component: { id: "heading", type: "Heading", props: { text: "Your workspace" } } },
    { op: "add", parent: "layout", component: { id: "form", type: "Card", props: {} } },
    { op: "add", parent: "form", component: { id: "entry", type: "Input", props: { label: "Name" } } },
    { op: "move", id: "primary-action", parent: "form" },
  ]);
  const original = JSON.stringify(initial.document);
  const h = await harness(initial);
  try {
    assert.equal(h.element<HTMLDetailsElement>("structure").open, true);
    assert.equal(h.element("structure").previousElementSibling?.className, "sketch-screen-details");
    assert.equal(h.element("workspace").querySelector("#sketch-selection"), null);
    assert.deepEqual([...h.element("structure-tree").querySelectorAll<HTMLButtonElement>("[data-node-id]")]
      .map(node => node.dataset.nodeId), ["screen", "layout", "heading", "form", "entry", "primary-action"]);
    assert.equal(h.treeNode("primary-action").getAttribute("aria-level"), "4");
    assert.equal(h.preview().dataset.mode, "select", "The integrated editor defaults to selection, not interaction.");
    assert.equal(h.selectedNodeId(), null);

    await h.event(h.preview().querySelector('[data-ui-id="heading"]')!, "click");
    assert.equal(h.treeNode("heading").getAttribute("aria-selected"), "true");
    assert.equal(h.selectedNodeId(), "heading");
    assert.equal(h.element<HTMLSelectElement>("change-target").value, "heading");
    assert.equal(h.preview().dataset.mode, "select");
    await h.event(h.preview().querySelector('[data-ui-id="primary-action"] span')!, "click");
    assert.equal(h.selectedNodeId(), "primary-action", "Selecting again does not require rearming a picker.");
    assert.equal(h.treeNode("heading").getAttribute("aria-selected"), "false");
    assert.equal(h.treeNode("primary-action").getAttribute("aria-selected"), "true");

    await h.click("interact");
    assert.equal(h.preview().dataset.mode, "interact");
    await h.event(h.preview().querySelector('[data-ui-id="heading"]')!, "click");
    assert.equal(h.selectedNodeId(), "primary-action", "Trying controls does not retarget a request.");
    await h.event(h.treeNode("entry"), "click");
    assert.equal(h.preview().dataset.mode, "select", "Selecting in Structure restores the visible selection outline.");
    assert.equal(h.preview().querySelector('[data-ui-id="entry"]')!.getAttribute("data-selected"), "true");
    assert.equal(h.element<HTMLSelectElement>("change-target").value, "entry");
    await h.input("change-target", "");
    assert.equal(h.selectedNodeId(), null);
    assert.equal(h.preview().querySelector("[data-selected]"), null);
    assert.equal(h.element<HTMLButtonElement>("save").disabled, true);
    assert.equal(h.element<HTMLButtonElement>("undo").disabled, true);
    assert.equal(JSON.stringify(initial.document), original);
    assert.equal(h.requests.length, 1);
  } finally { await h.close(); }
});

test("Structure supports keyboard traversal, collapse and revealing an element selected in the view", async () => {
  const initial = fixture(), screen = initial.document.screens[0];
  screen.ui = applyOperations(screen.ui, [
    { op: "add", parent: "screen", component: { id: "card", type: "Card", props: {} } },
    { op: "move", id: "primary-action", parent: "card" },
  ]);
  const h = await harness(initial);
  try {
    await act(async () => h.treeNode("screen").focus());
    await h.event(h.treeNode("screen"), "keydown", { key: "ArrowRight" });
    assert.equal(dom.window.document.activeElement, h.treeNode("card"));
    await h.event(h.treeNode("card"), "keydown", { key: "ArrowDown" });
    assert.equal(dom.window.document.activeElement, h.treeNode("primary-action"));
    assert.equal(h.selectedNodeId(), "primary-action");
    await h.event(h.treeNode("primary-action"), "keydown", { key: "ArrowLeft" });
    assert.equal(dom.window.document.activeElement, h.treeNode("card"));
    await h.event(h.treeNode("card"), "keydown", { key: "ArrowLeft" });
    assert.equal(h.treeNode("card").getAttribute("aria-expanded"), "false");
    assert.equal(h.element("structure-tree").querySelector('[data-node-id="primary-action"]'), null);
    await h.event(h.preview().querySelector('[data-ui-id="primary-action"]')!, "click");
    assert.equal(h.treeNode("card").getAttribute("aria-expanded"), "true");
    assert.equal(h.treeNode("primary-action").getAttribute("aria-selected"), "true");
    await act(async () => h.treeNode("primary-action").focus());
    await h.event(h.treeNode("primary-action"), "keydown", { key: "Home" });
    assert.equal(dom.window.document.activeElement, h.treeNode("screen"));
    await h.event(h.treeNode("screen"), "keydown", { key: "End" });
    assert.equal(dom.window.document.activeElement, h.treeNode("primary-action"));
    assert.equal(h.requests.length, 1);
  } finally { await h.close(); }
});

test("Structure remains inspectable in read-only and streaming views without reusing transient selections", async () => {
  const initial = fixture();
  const h = await harness(initial);
  try {
    await h.sse({ ...h.server, revision: 2, provider: { canSubmitAnswers: false } });
    await h.event(h.treeNode("primary-action"), "click");
    assert.equal(h.selectedNodeId(), "primary-action");
    assert.equal(h.element<HTMLButtonElement>("save").disabled, true);
    assert.equal(h.element<HTMLButtonElement>("revise").disabled, true);
    assert.equal(h.preview().dataset.mode, "select");
    await h.click("zoom-actual"); await h.click("zoom-out");
    assert.equal(h.element("zoom").textContent, "80%");
    await h.sse(streaming({ ...h.server, revision: 3, provider: { canSubmitAnswers: true } }, initial.document));
    assert.equal(h.preview().querySelector("[data-selected]"), null, "Saved selection cannot identify an uncommitted preview.");
    await h.event(h.treeNode("primary-action"), "click");
    const changed = structuredClone(initial.document);
    changed.screens[0].ui = applyOperations(changed.screens[0].ui, [
      { op: "update", id: "primary-action", props: { label: "Streamed change" } },
    ]);
    await h.sse(streaming(h.server, changed, 2));
    assert.equal(h.selectedNodeId(), "primary-action");
    assert.match(h.treeNode("primary-action").textContent!, /Streamed change/);
    assert.equal(h.element<HTMLButtonElement>("revise").disabled, true);
    await h.sse({ ...h.server, revision: 4, processing: null, sketchPreview: null });
    assert.equal(h.selectedNodeId(), null, "Preview selection cannot silently target saved content.");
    await h.input("instruction", "Adjust this screen.");
    await h.click("revise");
    assert.deepEqual(h.requests.at(-1)!.body!.sketchContext, {
      revisionId: "drawing-1", screenId: "screen-1", nodeId: null,
    });
  } finally { await h.close(); }
});

test("saving local design edits before revision binds the selected element to the saved revision", async () => {
  const h = await harness();
  try {
    await h.input("change-target", "primary-action");
    await h.input("notes", "Keep these unsaved annotations.");
    await h.input("instruction", "Use an icon for this action.");
    await h.click("revise");
    const writes = h.requests.filter(request => request.body);
    assert.deepEqual(writes.map(request => request.body!.action), ["save", "revise"]);
    assert.deepEqual(writes[1].body!.sketchContext, {
      revisionId: "drawing-2", screenId: "screen-1", nodeId: "primary-action",
    });
    assert.equal(writes[0].body!.document.screens[0].notes, "Keep these unsaved annotations.");
  } finally { await h.close(); }
});

test("retrying a failed design request preserves its original target instead of the newly viewed screen", async () => {
  const initial = fixture();
  initial.document.screens.push(buttonScreen(createScreen(initial.document, ["Requirement.Main_1"]), "Another action"));
  const context = { revisionId: "drawing-1", screenId: initial.document.screens[1].id, nodeId: "primary-action" };
  initial.state.processing = { action: "revise-sketch", status: "error", answer: "Replace this action with an icon.",
    message: "The design worker failed.", sketchContext: context };
  const h = await harness(initial);
  try {
    assert.equal(h.element<HTMLSelectElement>("change-target").value, "");
    await h.input("instruction", "Keep this different unsent request.");
    h.setPost(async () => { throw new Error("Retry transport unavailable."); });
    await h.click("retry-revision");
    assert.deepEqual(h.requests.at(-1)!.body!.sketchContext, context);
    assert.equal(h.requests.at(-1)!.body!.instruction, initial.state.processing.answer);
    await h.sse({ ...h.server, revision: 2 });
    await h.click("retry-revision");
    assert.deepEqual(h.requests.at(-1)!.body!.sketchContext, context, "A transport retry cannot replace the saved target with current view context.");
    assert.equal(h.element<HTMLTextAreaElement>("instruction").value, "Keep this different unsent request.");
  } finally { await h.close(); }
});

test("React sketch aborts approval if immutable revision metadata changes during PNG export", async () => {
  const h = await harness();
  try {
    h.enablePng();
    let rendered!: () => void;
    globalValue("Image", class {
      onload: (() => void) | null = null;
      source = "";
      set src(value: string) { this.source = value; rendered = () => this.onload?.(); }
    });
    await h.click("approve");
    await h.sse({ ...h.server, revision: 2, sketch: { ...h.server.sketch, current: {
      ...h.server.sketch.current!, documentHash: "changed-under-the-same-id",
    } } });
    await act(async () => rendered());
    assert.equal(h.requests.filter((request) => request.body).length, 0);
    assert.match(h.element("message").textContent!, /design changed/i);
    assert.equal(h.completionBlocked, true);
  } finally { await h.close(); }
});

test("React sketch stays unloaded before Sketch is available and honors historical and stale stages", async () => {
  const initial = fixture();
  initial.state.lifecycle.currentStage = "requirements";
  initial.state.sketch.current = null;
  initial.state.sketch.status = "empty";
  const h = await harness({ ...initial, document: null as unknown as SketchDocument });
  try {
    assert.equal(h.requests.length, 0);
    assert.equal(h.element<HTMLButtonElement>("generate").disabled, true);
    await h.sse({ ...h.server, revision: 2, lifecycle: { ...h.server.lifecycle, currentStage: "sketch" } });
    assert.equal(h.requests.length, 1);
    await h.click("add-screen");
    await h.sse({ ...h.server, revision: 3, sketch: { ...h.server.sketch, status: "stale" } });
    assert.equal(h.element<HTMLButtonElement>("approve").disabled, true);
    assert.match(h.element("status").textContent!, /Stale/);
    await h.sse({ ...h.server, revision: 4, lifecycle: { ...h.server.lifecycle, currentStage: "prototype" } });
    assert.match(h.element("status").textContent!, /Read only/);
    assert.equal(h.element<HTMLButtonElement>("add-screen").disabled, true);
  } finally { await h.close(); }
});

test("React sketch explicitly updates stale requirements without applying or losing draft edits", async () => {
  const initial = fixture();
  initial.state.sketch.status = "stale";
  initial.state.stageReview = { version: 1, parentId: "parent", stage: "sketch",
    baselineDigest: "a".repeat(64), baselineRevision: 1 };
  const h = await harness(initial);
  try {
    const update = h.element<HTMLButtonElement>("update-requirements");
    assert.equal(update.textContent, "Update designs from latest requirements");
    assert.equal(update.closest("#sketch-status"), h.element("status"));
    assert.equal(update.disabled, false);
    assert.equal(h.element<HTMLButtonElement>("approve").disabled, true);
    await h.input("instruction", "Keep this follow-up instruction.");
    assert.equal(h.element<HTMLButtonElement>("revise").disabled, true);
    h.setConfirm(false);
    await h.click("update-requirements");
    assert.equal(h.requests.filter(item => item.body).length, 0);
    h.setConfirm(true);
    await h.click("update-requirements");
    assert.deepEqual(h.requests.filter(item => item.body).map(item => ({ path: item.path, body: item.body })),
      [{ path: "/api/sketch", body: { action: "update", expectedRevision: "drawing-1" } }]);
    assert.equal(h.element("generation-title").textContent, "Updating UI design");
    assert.match(h.element("generation").textContent!, /existing designs remain visible/);
    assert.equal(h.element("screens").querySelector("button")!.getAttribute("data-screen-status"), "ready");
    assert.equal(h.element<HTMLInputElement>("instruction").value, "Keep this follow-up instruction.");
    assert.equal(h.element<HTMLButtonElement>("approve").disabled, true);
    assert.equal(h.completionBlocked, true);
    assert.equal(h.state.lifecycle.currentStage, "sketch");
    await h.sse({ ...h.server, revision: h.server.revision + 1,
      processing: { ...h.server.processing, status: "error", message: "Update failed. Retry explicitly." } });
    assert.equal(h.element<HTMLButtonElement>("update-requirements").disabled, false);
    await h.input("title", "Keep this local screen title");
    assert.equal(h.element<HTMLButtonElement>("update-requirements").disabled, true);
    assert.match(h.element("update-requirements").title, /Save or undo/);
    await h.click("update-requirements");
    assert.equal(h.requests.filter(item => item.body).length, 1);
    await h.click("undo");
    assert.equal(h.element<HTMLButtonElement>("update-requirements").disabled, false);
    await h.sse({ ...h.server, revision: h.server.revision + 1, provider: { canSubmitAnswers: false } });
    assert.equal(h.element("status").querySelector("#sketch-update-requirements"), null);
    assert.equal(h.requests.filter(item => item.body).length, 1);
  } finally { await h.close(); }
});

test("React sketch retains all reviewed screens while an incremental update streams", async () => {
  const initial = fixture();
  initial.document.screens.push(buttonScreen(createScreen(initial.document, ["Requirement.Main_1"])));
  const h = await harness(initial);
  try {
    const next = structuredClone(initial.document);
    next.screens[0].ui = applyOperations(next.screens[0].ui, [{ op: "setToken", key: "space.1", value: 24 }]);
    const update = streaming(h.server, next);
    update.sketchPreview!.screenStatuses = {
      [next.screens[0].id]: "processing", [next.screens[1].id]: "ready",
    };
    await h.sse(update);
    assert.equal(h.element("generation-title").textContent, "Updating UI design");
    assert.match(h.element("generation-progress").textContent!, /Updating existing designs/);
    assert.doesNotMatch(h.element("generation-progress").textContent!, /screens received/);
    const screens = h.element("screens").querySelectorAll("button");
    assert.equal(screens.length, 2);
    assert.equal(screens[0].getAttribute("data-screen-status"), "processing");
    assert.equal(screens[1].getAttribute("data-screen-status"), "ready");
    await h.selectScreen(1);
    assert.ok(h.preview().querySelector('[data-ui-id="primary-action"]'));
    assert.equal(h.requests.filter(item => item.body).length, 0);
  } finally { await h.close(); }
});

test("React sketch retries failed requirements updates as incremental updates after reload", async () => {
  const initial = fixture();
  const instruction = "Update existing designs for the latest requirements.";
  initial.state.sketch.status = "stale";
  initial.state.sketch.requests = [{
    requestId: "update-request", kind: "update", instruction, requestedAt: "2026-10-24T00:00:00Z", baseRevisionId: "drawing-1",
  }];
  initial.state.processing = {
    action: "revise-sketch", status: "error", requestId: "update-request", answer: instruction, message: "Update failed.",
  };
  const h = await harness(initial);
  try {
    assert.equal(h.requests.filter(item => item.body).length, 0);
    assert.equal(h.element("retry-revision").textContent, "Retry update");
    await h.input("instruction", "Keep this new unsent request.");
    await h.click("retry-revision");
    assert.deepEqual(h.requests.filter(item => item.body).map(item => item.body), [
      { action: "update", expectedRevision: "drawing-1" },
    ]);
    assert.equal(h.element<HTMLInputElement>("instruction").value, "Keep this new unsent request.");
    assert.equal(h.element("generation-title").textContent, "Updating UI design");
  } finally { await h.close(); }
});

test("React sketch removes all geometry tools and inspector but keeps accessible size and zoom controls", async () => {
  const h = await harness();
  try {
    for (const [id, label] of [["add-rectangle", "Rectangle"], ["add-ellipse", "Ellipse"], ["add-text", "Text"],
      ["add-line", "Line"], ["add-arrow", "Arrow"], ["add-quadratic", "Quadratic Bezier"],
      ["add-cubic", "Cubic Bezier"], ["add-spline", "Catmull-Rom spline"], ["freehand", "Freehand"]]) {
      assert.equal(h.element("workspace").querySelector(`#sketch-${id}`), null, label);
    }
    assert.equal(h.element("workspace").querySelector("#sketch-object-properties"), null);
    assert.equal(h.element("workspace").querySelector("#sketch-shapes"), null);
    assert.equal(h.element("size-preset").getAttribute("aria-label"), "Canvas size");
    for (const id of ["zoom-in", "zoom-out", "zoom-fit", "zoom-actual"]) {
      assert.ok(h.element(id).getAttribute("aria-label"));
      assert.ok(h.element(id).getAttribute("title"));
    }
  } finally { await h.close(); }
});

test("React sketch presets apply both dimensions atomically, preserve DSL nodes, and save canonical export sizes", async () => {
  const initial = fixture();
  const h = await harness(initial);
  try {
    h.enablePng();
    const preset = h.element<HTMLSelectElement>("size-preset");
    assert.equal(preset.size, 0, "presets use a collapsed dropdown");
    assert.equal(preset.multiple, false);
    assert.equal(preset.getAttribute("aria-label"), "Canvas size");
    assert.equal(preset.closest("aside"), null, "size controls are no longer in the sidebar");
    assert.ok(preset.parentElement!.classList.contains("sketch-view-controls"));
    assert.equal(preset.nextElementSibling, h.element("zoom-tools"), "dropdown is directly before the zoom controls");
    for (const id of ["canvas-width", "canvas-height", "size-apply", "size-help", "viewport"]) {
      assert.equal(h.element("workspace").querySelector(`#sketch-${id}`), null, `removed ${id}`);
    }
    assert.equal(preset.options.length, 8);
    assert.equal(preset.value, "tandem");
    await h.input("size-preset", "hd-portrait");
    assert.equal(h.viewSize()[0], 1080);
    assert.equal(h.viewSize()[1], 1920);
    assert.equal(h.element<HTMLButtonElement>("save").disabled, false);
    assert.equal(h.element<HTMLButtonElement>("approve").disabled, false, "presets need no separate Apply step");
    await h.click("undo");
    assert.deepEqual(h.viewSize(), [960, 640]);
    assert.equal(preset.value, "tandem");
    assert.equal(h.element<HTMLButtonElement>("undo").disabled, true);
    await h.click("redo");
    assert.equal(preset.value, "hd-portrait");
    await h.input("size-preset", "a4-portrait");
    assert.deepEqual(h.viewSize(), [794, 1123]);
    assert.equal(h.preview().querySelector("[data-ui-id='primary-action']")!.textContent, "Continue");
    await h.click("save");
    const clipped = h.requests.at(-1)!.body!.document as SketchDocument;
    assert.equal(clipped.screens[0].width, 794);
    assert.deepEqual(clipped.screens[0].ui, initial.document.screens[0].ui);
    await h.click("reload");
    assert.equal(preset.value, "a4-portrait");
    await h.input("size-preset", "hd-landscape");
    await h.click("zoom-actual");
    await h.click("zoom-out");
    await h.click("approve");
    assert.deepEqual(h.exports.map(({ width, height }) => [width, height]), [[1920, 1080]]);
    assert.deepEqual(h.requests.filter((request) => request.body).map((request) => request.body!.action || request.body!.stageId),
      ["save", "save", "approve", "sketch"]);
    assert.deepEqual((h.requests.filter((request) => request.body?.action === "save").at(-1)!.body!.document as SketchDocument)
      .screens[0].ui, initial.document.screens[0].ui);
  } finally { await h.close(); }
});

test("React sketch dropdown preserves existing custom dimensions without exposing a size editor", async () => {
  const initial = fixture();
  initial.document.screens[0].width = 375;
  initial.document.screens[0].height = 812;
  const h = await harness(initial);
  try {
    const preset = h.element<HTMLSelectElement>("size-preset");
    assert.equal(preset.value, "custom");
    assert.equal(preset.selectedOptions[0].textContent, "Custom (375 × 812)");
    assert.equal(preset.selectedOptions[0].disabled, true);
    assert.equal(h.element<HTMLButtonElement>("save").disabled, true);
    await h.input("size-preset", "square");
    assert.equal(preset.value, "square");
    assert.deepEqual(h.viewSize(), [1080, 1080]);
    await h.click("undo");
    assert.equal(preset.value, "custom");
    assert.deepEqual(h.viewSize(), [375, 812]);
    assert.equal(h.element<HTMLButtonElement>("save").disabled, true);
  } finally { await h.close(); }
});

test("React sketch preset changes survive hidden tabs and SSE and respect edit gates", async () => {
  const h = await harness();
  try {
    await h.input("title", "Local draft");
    await h.input("size-preset", "hd-portrait");
    await h.hidden(true);
    await h.sse({ ...h.server, revision: 2 });
    await h.hidden(false);
    assert.equal(h.element<HTMLSelectElement>("size-preset").value, "hd-portrait");
    assert.deepEqual(h.viewSize(), [1080, 1920]);
    assert.equal(h.element<HTMLButtonElement>("save").disabled, false);
    await h.click("undo");
    assert.equal(h.element<HTMLSelectElement>("size-preset").value, "tandem");
    assert.equal(h.element<HTMLInputElement>("title").value, "Local draft", "resizing has its own undo step");
    await h.input("size-preset", "hd-portrait");
    await h.sse({ ...h.server, revision: 3, provider: { canSubmitAnswers: false } });
    assert.equal(h.element<HTMLSelectElement>("size-preset").disabled, true);
    await h.input("size-preset", "square");
    assert.deepEqual(h.viewSize(), [1080, 1920], "read-only presets cannot change geometry");
    await h.click("zoom-actual");
    assert.equal(h.element("zoom").textContent, "100%");
    await h.click("zoom-out");
    assert.equal(h.element("zoom").textContent, "80%", "read-only designs remain zoomable");
  } finally { await h.close(); }
});

test("React sketch fit measures both viewport axes, tracks resize, and zoom preserves undo state and viewport center", async () => {
  const h = await harness();
  try {
    await h.resizeViewport(506, 346);
    assert.equal(h.element("zoom").textContent, "50%");
    assert.equal(h.element("canvas").style.width, "480px");
    assert.equal(h.element("canvas").style.height, "320px");
    await h.click("zoom-in");
    assert.equal(h.element("zoom").textContent, "62.5%", "zoom starts from the fitted scale");
    assert.equal(h.element("board-wrap").scrollLeft, 60);
    assert.equal(h.element("board-wrap").scrollTop, 40);
    await h.click("zoom-out");
    assert.equal(h.element("zoom").textContent, "50%");
    await h.click("zoom-actual");
    assert.equal(h.element("canvas").style.width, "960px");
    assert.equal(h.element("canvas").style.height, "640px");
    await h.resizeViewport(1226, 666);
    assert.equal(h.element("zoom").textContent, "100%", "actual size ignores viewport resizing");
    await h.click("zoom-fit");
    assert.equal(h.element("zoom").textContent, "100%", "fit is height-constrained even with extra width");
    await h.resizeViewport(326, 666);
    assert.equal(h.element("zoom").textContent, "31.3%");
    assert.equal(h.element("board-wrap").scrollLeft, 0);
    assert.equal(h.element("board-wrap").scrollTop, 0);
    await h.input("size-preset", "square");
    assert.equal(h.element("canvas").style.height, "300px");
    await h.click("undo");
    assert.equal(h.element<HTMLButtonElement>("undo").disabled, true);
    assert.equal(h.element<HTMLButtonElement>("save").disabled, true);
    assert.equal(h.requests.length, 1, "zoom never writes or loads designs");
    for (let count = 0; count < 30; count++) await h.click("zoom-in");
    assert.equal(h.element("zoom").textContent, "800%");
    assert.equal(h.element<HTMLButtonElement>("zoom-in").disabled, true);
    for (let count = 0; count < 40; count++) await h.click("zoom-out");
    assert.equal(h.element("zoom").textContent, "1%");
    assert.equal(h.element<HTMLButtonElement>("zoom-out").disabled, true);
  } finally { await h.close(); }
});

test("React sketch switches screens into fit and keeps per-screen preset and custom dimensions", async () => {
  const initial = fixture();
  const second = createScreen(initial.document, ["Requirement.Main_1"]);
  second.width = 375;
  second.height = 812;
  addUi(second, "label", "Text", { text: "Mobile view" });
  initial.document.screens.push(second);
  const h = await harness(initial);
  try {
    await h.resizeViewport(506, 346);
    await h.input("size-preset", "hd-landscape");
    await h.click("zoom-actual");
    await h.selectScreen(1);
    assert.equal(h.element("zoom-fit").getAttribute("aria-pressed"), "true");
    assert.equal(h.element<HTMLSelectElement>("size-preset").value, "custom");
    assert.equal(h.viewSize()[0], 375);
    assert.equal(h.element("canvas").style.height, "320px");
    assert.equal(h.element<HTMLButtonElement>("approve").disabled, false);
    await h.selectScreen(0);
    assert.equal(h.element("zoom-fit").getAttribute("aria-pressed"), "true", "returning to a screen must not restore its old custom zoom");
    await h.selectScreen(1);
    await h.click("zoom-in");
    await h.selectScreen(0);
    assert.equal(h.element("zoom-fit").getAttribute("aria-pressed"), "true");
    assert.equal(h.element<HTMLSelectElement>("size-preset").value, "hd-landscape");
    await h.click("save");
    const saved = h.requests.at(-1)!.body!.document as SketchDocument;
    assert.deepEqual(saved.screens.map(({ width, height }) => [width, height]), [[1920, 1080], [375, 812]]);
  } finally { await h.close(); }
});

test("React sketch captures the zoom anchor before shrinking content clamps browser scroll offsets", async () => {
  const h = await harness();
  try {
    await h.resizeViewport(506, 346);
    const shell = h.element("board-wrap");
    let scroll = 0;
    const clampScroll = (value: number) => Math.max(0, Math.min(value, Number.parseFloat(h.element("canvas").style.width) - 480));
    Object.defineProperty(shell, "scrollLeft", {
      configurable: true,
      get: () => scroll = clampScroll(scroll),
      set: (value: number) => { scroll = clampScroll(value); },
    });

    await h.click("zoom-actual");
    shell.scrollLeft = 450;
    await h.click("zoom-out");
    assert.equal(h.element("canvas").style.width, "768px");
    assert.equal(shell.scrollLeft, 288, "zooming out near the right edge remains at the right edge");
    await h.click("zoom-actual");
    assert.equal(shell.scrollLeft, 420);
    await h.input("size-preset", "a4-portrait");
    assert.equal(shell.scrollLeft, 305.875, "canvas resizing also captures the center before layout clamps scroll");
  } finally { await h.close(); }
});

test("legacy geometry shows only explicit regeneration and never appears or counts as completed DSL", async () => {
  const initial = fixture();
  const { ui: _ui, ...metadata } = initial.document.screens[0];
  const document: LegacySketchDocument = { version: 1, screens: [{
    ...metadata, shapes: [{ id: "old-label", kind: "text", text: "Do not render legacy geometry",
      x: 1, y: 1, width: 200, height: 40, fontSize: 20, fill: "#333333", stroke: "none", points: [] }],
  }], transitions: [] };
  initial.state.sketch.status = "approved";
  initial.state.sketch.approved = { revisionId: "drawing-1", documentHash: "hash-1", requirementsDigest: "requirements-1",
    approvedAt: "2026-09-20T00:01:00.000Z", assets: [] };
  const before = JSON.stringify(document);
  const h = await harness({ state: initial.state, document });
  try {
    assert.equal(h.element("workspace").hidden, true);
    assert.equal(h.element("board").querySelector("svg, .dsl-view"), null);
    assert.match(h.element("empty").textContent!, /retired geometry.*Regenerate designs.*history will remain intact/);
    assert.equal(h.completionBlocked, true);
    assert.equal(h.element<HTMLButtonElement>("revise").disabled, true);
    assert.equal(h.element<HTMLButtonElement>("add-screen").disabled, true);
    assert.equal(h.requests.length, 1, "opening old data must not regenerate or rewrite it");
    h.setConfirm(false);
    await h.click("generate");
    assert.equal(h.requests.length, 1);
    h.setConfirm(true);
    await h.click("generate");
    assert.deepEqual(h.requests.at(-1)!.body, { action: "generate", expectedRevision: "drawing-1" });
    assert.equal(JSON.stringify(document), before);
  } finally { await h.close(); }
});

test("local DSL preview controls preserve focus and values without creating design edits", async () => {
  const initial = fixture();
  addUi(initial.document.screens[0], "name", "Input", { label: "Name", value: "Saved example" });
  const h = await harness(initial);
  try {
    const input = h.preview().querySelector("input")!;
    input.focus(); input.value = "Local example"; input.setSelectionRange(2, 5);
    const next = structuredClone(initial.document);
    next.screens[0].ui = applyOperations(next.screens[0].ui, [
      { op: "update", id: "primary-action", props: { label: "Updated" } },
    ]);
    await h.sse(streaming(h.server, next));
    assert.equal(h.preview().querySelector("input"), input);
    assert.equal(input.value, "Local example");
    assert.equal(input.selectionStart, 2);
    assert.equal((input.getRootNode() as ShadowRoot).activeElement, input);
    assert.equal(h.requests.length, 1);
    assert.equal(h.element<HTMLButtonElement>("save").disabled, true);
  } finally { await h.close(); }
});
