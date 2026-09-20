import assert from "node:assert/strict";
import { after, test } from "node:test";
import { JSDOM } from "jsdom";
import type { SketchDocument } from "../src/sketch.js";
import type { UiContextValue, UiState } from "../src/renderer/ui-context.js";
import { createScreen, createShape } from "../src/renderer/sketch-editor.js";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
const globals = new Map<string, PropertyDescriptor | undefined>();
function globalValue(name: string, value: unknown) {
  if (!globals.has(name)) globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}
for (const name of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "MutationObserver", "HTMLInputElement", "HTMLTextAreaElement"]) {
  globalValue(name, dom.window[name as keyof Window]);
}
globalValue("IS_REACT_ACT_ENVIRONMENT", true);
const React = await import("react");
const { act, useCallback, useState } = React;
const { createRoot } = await import("react-dom/client");
const { DraftProvider, UiContext } = await import("../src/renderer/ui-context.js");
const { SpeechProvider } = await import("../src/renderer/speech-textarea.js");
const { SketchPanel, SketchCompletionContext, isSketchRevisionApproved } = await import("../src/renderer/sketch-panel.js");

after(() => {
  dom.window.close();
  for (const [name, descriptor] of globals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

function fixture() {
  const document: SketchDocument = { version: 1, screens: [], transitions: [] };
  document.screens.push(createScreen(document, ["Requirement.Main_1"]));
  document.screens[0].shapes.push(createShape(document.screens[0], "rectangle"));
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

async function harness(initial = fixture()) {
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
  let stored = initial.document as SketchDocument | null;
  let visible = initial.state;
  let update!: (state: UiState) => void;
  let show!: (shown: boolean) => void;
  let completionBlocked = true;
  let confirm = true;
  let readError = "";
  let postHandler: ((endpoint: string, body: Record<string, any>) => Promise<UiState>) | null = null;
  const requests: Array<{ path: string; body: Record<string, any> | null }> = [];
  const exports: Array<{ width: number; height: number; source: string }> = [];
  const host = dom.window.document.createElement("div");
  dom.window.document.body.append(host);
  const root = createRoot(host);
  globalValue("Image", undefined);
  globalValue("fetch", async (path: string) => {
    requests.push({ path, body: null });
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
      guidance: () => "Return to the session that owns this effort to edit or approve drawings.",
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
          action: body.action === "revise" ? "revise-sketch" : "generate-sketch", status: "running", answer: body.instruction,
        } };
        update(server);
        return server as T;
      },
    };
    return <UiContext.Provider value={context}><DraftProvider><SpeechProvider>
      <SketchCompletionContext.Provider value={report}><div hidden={!shown}><SketchPanel /></div></SketchCompletionContext.Provider>
    </SpeechProvider></DraftProvider></UiContext.Provider>;
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
    get state() { return visible; },
    get server() { return server; },
    get completionBlocked() { return completionBlocked; },
    async close() {
      await act(async () => root.unmount());
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
    async selectShape(index: number) {
      await act(async () => element("shapes").querySelectorAll<HTMLButtonElement>("button")[index].click());
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
    setDocument(value: SketchDocument | null) { stored = value; },
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

test("React sketch loads separately without generating, and all manual tools preserve bounded documents", async () => {
  const initial = fixture();
  initial.state.sketch.current = null;
  initial.state.sketch.status = "empty";
  const h = await harness({ ...initial, document: null as unknown as SketchDocument });
  try {
    assert.deepEqual(h.requests, [{ path: "/api/sketch", body: null }]);
    await h.click("add-screen");
    for (const kind of ["rectangle", "ellipse", "text", "line", "arrow"]) await h.click("add-" + kind);
    assert.equal(h.element("board").querySelectorAll("[data-shape-id]").length, 5);
    await h.selectShape(2);
    await h.input("text", "<script>&text");
    assert.equal(h.element("board").querySelector("script"), null);
    await h.selectShape(4);
    await h.input("x", "10000");
    await h.event(h.element("x"), "focusout");
    assert.equal(h.element<HTMLInputElement>("x").value, "800");
    await h.click("undo");
    assert.equal(h.element<HTMLInputElement>("x").value, "40");
    await h.click("redo");
    await h.input("title", "Home");
    await h.click("add-screen");
    await h.click("add-transition");
    const trigger = h.element("transitions").querySelector("input")!;
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(trigger, "Open home");
    await h.event(trigger, "input");
    await h.click("save");
    const document = h.requests.at(-1)!.body!.document as SketchDocument;
    assert.equal(document.screens[0].title, "Home");
    assert.equal(document.screens[0].shapes[4].x, 800);
    assert.deepEqual(document.screens[0].decisionIds, ["Requirement.Main_1"]);
    assert.equal(document.transitions[0].trigger, "Open home");
    assert.equal(h.completionBlocked, true);
    assert.equal(h.element<HTMLButtonElement>("approve").disabled, true);
  } finally { await h.close(); }
});

test("React sketch preserves invalid screen, shape and transition fields across SSE and hidden tabs", async () => {
  const h = await harness();
  try {
    await h.input("purpose", "");
    await h.selectShape(0);
    await h.input("x", "");
    await h.click("add-transition");
    const trigger = h.element("transitions").querySelector("input")!;
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(trigger, "");
    await h.event(trigger, "input");
    await h.hidden(true);
    await h.sse({ ...h.server, revision: 2 });
    await h.hidden(false);
    assert.equal(h.element<HTMLInputElement>("purpose").value, "");
    assert.equal(h.element<HTMLInputElement>("x").value, "");
    assert.equal(h.element("purpose").getAttribute("aria-invalid"), "true");
    assert.equal(trigger.value, "");
    assert.equal(h.element<HTMLButtonElement>("save").disabled, true);
    await h.click("undo");
    assert.equal(h.element<HTMLInputElement>("purpose").value, "Support the selected requirements.");
    assert.equal(h.element<HTMLInputElement>("x").value, "40");
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

test("React sketch commits drag and bounded freehand as single undo steps, cancels and nudges by keyboard", async () => {
  const h = await harness();
  try {
    const board = h.element("board");
    const shape = () => board.querySelector("[data-shape-id]")!;
    await h.event(shape(), "pointerdown", { pointerId: 1, button: 0, clientX: 50, clientY: 50 });
    await h.event(board, "pointermove", { pointerId: 1, clientX: 70, clientY: 80 });
    await h.event(board, "pointerup", { pointerId: 1, clientX: 70, clientY: 80 });
    assert.equal(h.element<HTMLInputElement>("x").value, "60");
    await h.event(board, "keydown", { key: "ArrowRight", shiftKey: true });
    assert.equal(h.element<HTMLInputElement>("x").value, "70");
    await h.event(board, "keydown", { key: "z", ctrlKey: true });
    assert.equal(h.element<HTMLInputElement>("x").value, "60");
    await h.event(shape(), "pointerdown", { pointerId: 2, button: 0, clientX: 70, clientY: 80 });
    await h.event(board, "pointermove", { pointerId: 2, clientX: 90, clientY: 90 });
    await h.event(board, "pointercancel", { pointerId: 2 });
    assert.equal(h.element<HTMLInputElement>("x").value, "60");
    await h.click("freehand");
    await h.event(board, "pointerdown", { pointerId: 3, button: 0, clientX: 10, clientY: 10 });
    await h.event(board, "pointerup", { pointerId: 3, clientX: 10000, clientY: 10000 });
    assert.equal(board.querySelectorAll("[data-shape-id]").length, 2);
    assert.match(board.querySelector("path")!.getAttribute("d")!, /960 640/);
    await h.click("undo");
    assert.equal(board.querySelectorAll("[data-shape-id]").length, 1);
    await h.event(board, "keydown", { key: "Escape" });
    assert.equal(h.element("freehand").getAttribute("aria-pressed"), "false");
  } finally { await h.close(); }
});

test("React sketch does not replace or rebase a pointer gesture when a remote revision arrives", async () => {
  const h = await harness();
  try {
    const board = h.element("board");
    await h.event(board.querySelector("[data-shape-id]")!, "pointerdown", { pointerId: 1, button: 0, clientX: 50, clientY: 50 });
    await h.sse({ ...h.server, revision: 2, sketch: { ...h.server.sketch, current: { ...h.server.sketch.current!, id: "remote" } } });
    await h.event(board, "pointerup", { pointerId: 1, clientX: 70, clientY: 80 });
    assert.equal(h.element<HTMLInputElement>("x").value, "60");
    assert.match(h.element("status").textContent!, /Conflict/);
    assert.equal(h.element<HTMLButtonElement>("save").disabled, true);
    assert.equal(h.requests.length, 1);
  } finally { await h.close(); }
});

test("React sketch saves then exports every canonical screen before approving the exact revision", async () => {
  const initial = fixture();
  const second = createScreen(initial.document, ["Requirement.Main_1"]);
  second.width = 375;
  second.height = 812;
  second.shapes.push({ ...createShape(second, "text"), text: "<script>&unsafe" });
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
    h.setReadError("Drawing storage unavailable");
    await h.click("reload");
    await h.sse({ ...h.server, revision: 2 });
    assert.equal(h.requests.length, 2);
    assert.match(h.element("message").textContent!, /Drawing storage unavailable/);
    h.setReadError("");
    await h.click("reload");
    assert.equal(h.element<HTMLButtonElement>("approve").disabled, false);
    await h.sse({ ...h.server, revision: 3, provider: { canSubmitAnswers: false } });
    assert.equal(h.element<HTMLButtonElement>("approve").disabled, true);
    assert.match(h.element("status").textContent!, /session that owns this effort/);
    await h.sse({ ...h.server, revision: 4, provider: { canSubmitAnswers: true },
      processing: { action: "generate-sketch", status: "running", message: "Drawing new screens" } });
    assert.equal(h.element<HTMLButtonElement>("add-screen").disabled, true);
    assert.match(h.element("status").textContent!, /Drawing new screens/);
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
    assert.deepEqual(h.requests[1].body, { action: "revise", expectedRevision: "drawing-1", instruction: "Move navigation" });
    await act(async () => reject(new Error("Cannot start revision")));
    assert.match(h.element("message").textContent!, /Cannot start revision/);
    assert.equal(h.element<HTMLTextAreaElement>("instruction").value, "Move navigation");
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
    assert.match(h.element("message").textContent!, /drawing changed/i);
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
    await h.click("add-rectangle");
    await h.sse({ ...h.server, revision: 3, sketch: { ...h.server.sketch, status: "stale" } });
    assert.equal(h.element<HTMLButtonElement>("approve").disabled, true);
    assert.match(h.element("status").textContent!, /Stale/);
    await h.sse({ ...h.server, revision: 4, lifecycle: { ...h.server.lifecycle, currentStage: "prototype" } });
    assert.match(h.element("status").textContent!, /Read only/);
    assert.equal(h.element<HTMLButtonElement>("add-screen").disabled, true);
  } finally { await h.close(); }
});

test("React sketch drawing tools are larger icon-only buttons with accessible names and tooltips", async () => {
  const h = await harness();
  try {
    for (const [id, label] of [["add-rectangle", "Rectangle"], ["add-ellipse", "Ellipse"], ["add-text", "Text"],
      ["add-line", "Line"], ["add-arrow", "Arrow"], ["freehand", "Freehand"]]) {
      const button = h.element(id);
      assert.equal(button.textContent, "");
      assert.equal(button.getAttribute("aria-label"), label);
      assert.equal(button.getAttribute("title"), label);
      assert.ok(button.classList.contains("sketch-icon-button"));
      assert.equal(button.querySelector("svg")?.getAttribute("width"), "20");
    }
  } finally { await h.close(); }
});

test("React sketch presets apply both dimensions atomically, preserve clipped shapes, and save canonical export sizes", async () => {
  const initial = fixture();
  initial.document.screens[0].shapes[0].x = 800;
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
    assert.equal(h.element("board").querySelector("svg")!.getAttribute("width"), "1080");
    assert.equal(h.element("board").querySelector("svg")!.getAttribute("height"), "1920");
    assert.equal(h.element<HTMLButtonElement>("save").disabled, false);
    assert.equal(h.element<HTMLButtonElement>("approve").disabled, false, "presets need no separate Apply step");
    await h.click("undo");
    assert.equal(h.element("board").querySelector("svg")!.getAttribute("viewBox"), "0 0 960 640");
    assert.equal(preset.value, "tandem");
    assert.equal(h.element<HTMLButtonElement>("undo").disabled, true);
    await h.click("redo");
    assert.equal(preset.value, "hd-portrait");
    await h.input("size-preset", "a4-portrait");
    assert.equal(h.element("board").querySelector("svg")!.getAttribute("viewBox"), "0 0 794 1123");
    assert.equal(h.element("board").querySelector("[data-shape-id] rect")!.getAttribute("x"), "800");
    assert.equal(h.element("board").querySelector("[data-shape-id] rect")!.getAttribute("width"), "160");
    await h.click("save");
    const clipped = h.requests.at(-1)!.body!.document as SketchDocument;
    assert.equal(clipped.screens[0].width, 794);
    assert.deepEqual(clipped.screens[0].shapes, initial.document.screens[0].shapes);
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
      .screens[0].shapes, initial.document.screens[0].shapes);
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
    assert.equal(h.element("board").querySelector("svg")!.getAttribute("viewBox"), "0 0 1080 1080");
    await h.click("undo");
    assert.equal(preset.value, "custom");
    assert.equal(h.element("board").querySelector("svg")!.getAttribute("viewBox"), "0 0 375 812");
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
    assert.equal(h.element("board").querySelector("svg")!.getAttribute("viewBox"), "0 0 1080 1920");
    assert.equal(h.element<HTMLButtonElement>("save").disabled, false);
    await h.click("undo");
    assert.equal(h.element<HTMLSelectElement>("size-preset").value, "tandem");
    assert.equal(h.element<HTMLInputElement>("title").value, "Local draft", "resizing has its own undo step");
    await h.input("size-preset", "hd-portrait");
    await h.sse({ ...h.server, revision: 3, provider: { canSubmitAnswers: false } });
    assert.equal(h.element<HTMLSelectElement>("size-preset").disabled, true);
    await h.input("size-preset", "square");
    assert.equal(h.element("board").querySelector("svg")!.getAttribute("viewBox"), "0 0 1080 1920", "read-only presets cannot change geometry");
    await h.click("zoom-actual");
    assert.equal(h.element("zoom").textContent, "100%");
    await h.click("zoom-out");
    assert.equal(h.element("zoom").textContent, "80%", "read-only drawings remain zoomable");
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
    assert.equal(h.requests.length, 1, "zoom never writes or loads drawings");
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
  second.shapes.push(createShape(second, "text"));
  initial.document.screens.push(second);
  const h = await harness(initial);
  try {
    await h.resizeViewport(506, 346);
    await h.input("size-preset", "hd-landscape");
    await h.click("zoom-actual");
    await h.selectScreen(1);
    assert.equal(h.element("zoom-fit").getAttribute("aria-pressed"), "true");
    assert.equal(h.element<HTMLSelectElement>("size-preset").value, "custom");
    assert.equal(h.element("board").querySelector("svg")!.getAttribute("width"), "375");
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

test("React sketch maps pointer gestures through fitted and scrolled zoom without scaling saved geometry", async () => {
  const h = await harness();
  try {
    await h.resizeViewport(506, 346);
    const board = h.element("board");
    const rect = () => board.querySelector("[data-shape-id]")!;
    await h.event(rect(), "pointerdown", { pointerId: 1, button: 0, clientX: 25, clientY: 25 });
    assert.equal(h.element<HTMLButtonElement>("zoom-in").disabled, true);
    assert.equal(h.element<HTMLSelectElement>("size-preset").disabled, true);
    await h.event(board, "pointerup", { pointerId: 1, clientX: 45, clientY: 55 });
    assert.equal(h.element<HTMLInputElement>("x").value, "80");
    assert.equal(h.element<HTMLInputElement>("y").value, "100");
    await h.click("zoom-actual");
    await h.click("zoom-in");
    const bounds = board.querySelector("svg")!.getBoundingClientRect();
    assert.ok(bounds.left < 0, "zoomed viewport has scrolled");
    await h.event(rect(), "pointerdown", { pointerId: 2, button: 0, clientX: bounds.left + 100, clientY: bounds.top + 125 });
    await h.event(board, "pointerup", { pointerId: 2, clientX: bounds.left + 125, clientY: bounds.top + 150 });
    assert.equal(h.element<HTMLInputElement>("x").value, "100");
    assert.equal(h.element<HTMLInputElement>("y").value, "120");
    await h.click("zoom-fit");
    await h.click("freehand");
    await h.event(board, "pointerdown", { pointerId: 3, button: 0, clientX: 5, clientY: 5 });
    await h.event(board, "pointerup", { pointerId: 3, clientX: 10, clientY: 15 });
    await h.click("save");
    const saved = h.requests.at(-1)!.body!.document as SketchDocument;
    assert.equal(saved.screens[0].shapes[0].width, 160);
    assert.deepEqual(saved.screens[0].shapes[1].points, [{ x: 10, y: 10 }, { x: 20, y: 30 }]);
  } finally { await h.close(); }
});
