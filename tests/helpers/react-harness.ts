import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { webcrypto } from "node:crypto";
import { TextEncoder, TextDecoder } from "node:util";
import type { TestContext } from "node:test";
import type { UiState } from "../../src/renderer/ui-context.js";
import type { SpeechSessionFactory } from "../../src/renderer/speech-recognizer.js";
import { createProcessState } from "../../src/process-state.js";

let compiled: Promise<string> | undefined;
async function compile() {
  const result = await build({
    stdin: {
      contents: `
        import React from "react";
        import {createRoot} from "react-dom/client";
        import {flushSync} from "react-dom";
        import {App} from "./app.js";
        import {StudioStore} from "./state-store.js";
        export function mount() {
          const store = new StudioStore();
          const root = createRoot(document.getElementById("root"));
          flushSync(() => root.render(React.createElement(App, {store, version:"0.0.0-test", connect:false})));
          return {store, flushSync, dispose: () => flushSync(() => root.unmount())};
        }`,
      loader: "tsx", resolveDir: fileURLToPath(new URL("../../src/renderer/", import.meta.url)),
    },
    bundle: true, write: false, platform: "browser", format: "iife", globalName: "TandemTest",
    loader: { ".png": "dataurl" },
    target: "es2022", logLevel: "silent", define: { "process.env.NODE_ENV": '"development"' },
    plugins: [{
      name: "renderer-test-services",
      setup(api) {
        api.onResolve({ filter: /speech-recognizer\.js$/ }, () => ({ path: "speech", namespace: "test-services" }));
        api.onResolve({ filter: /^https:.*mermaid/ }, () => ({ path: "mermaid", namespace: "test-services" }));
        api.onLoad({ filter: /.*/, namespace: "test-services" }, (args) => ({
          contents: args.path === "speech"
            ? "export const createAzureSpeechSession = (...args) => globalThis.__speechFactory(...args);"
            : "export default { initialize(){}, render: (...args) => globalThis.__renderMermaid(...args) };",
        }));
      },
    }],
  });
  return result.outputFiles[0].text;
}

export interface Request { path: string; body: any; options: RequestInit }
export function response(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as Response;
}

export async function reactHarness(t?: TestContext, headerHost?: { origin: string; channel: string }, startingPath: "preparation" | "development" | null = "preparation") {
  const hash = headerHost ? "#" + new URLSearchParams({ "tandem-host": headerHost.origin, "header-channel": headerHost.channel }) : "";
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: "http://127.0.0.1:4567/" + hash, runScripts: "outside-only", pretendToBeVisual: true,
  });
  const window = dom.window;
  const document = window.document;
  const requests: Request[] = [];
  const presentationRequests: string[] = [];
  const entryRequests: string[] = [];
  const previewRequests: RequestInit[] = [];
  let previewFetcher: (() => Promise<Response>) | null = null;
  let entryOpened = false;
  let processSettingsFixture = false;
  let gitFetcher: (() => Promise<Response>) | null = null;
  const errors: string[] = [];
  const pngExports: { width: number; height: number; source: string }[] = [];
  const headerMessages: Record<string, any>[] = [];
  const parent = headerHost ? { postMessage(data: unknown, origin: string) {
    if (origin !== headerHost.origin) throw new Error("Header message sent to the wrong origin.");
    headerMessages.push(JSON.parse(JSON.stringify(data)));
  } } : window;
  if (headerHost) Object.defineProperty(window, "parent", { value: parent, configurable: true });
  let narrow = false;
  let fetcher: (path: string, options: RequestInit) => Promise<Response> = async () => { throw new Error("Network disabled in renderer tests"); };
  let speechFactory: SpeechSessionFactory = async () => { throw new Error("Speech is not configured in this test"); };
  let mermaid: (id: string, source: string) => Promise<{ svg: string }> = async () => { throw new Error("Mermaid unavailable in this test"); };
  window.console.error = (...args: unknown[]) => { errors.push(args.map(String).join(" ")); };
  Object.defineProperty(window, "crypto", { value: webcrypto });
  Object.assign(window, {
    TextEncoder, TextDecoder, AbortController, AbortSignal,
    matchMedia: (query: string) => ({ matches: query === "(max-width: 760px)" && narrow, media: query, addEventListener() {}, removeEventListener() {} }),
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    PointerEvent: window.MouseEvent,
    fetch: async (input: string | URL | Request, options: RequestInit = {}) => {
      const path = String(input);
      if (processSettingsFixture && path === "/api/settings/project-effort") {
        return response({ desired: null, changing: false,
          stage1: { desired: null, actual: null, model: null, supported: [], status: "pending", error: null },
          stage2: { desired: null, actual: null, model: null, supported: [], status: "pending", error: null } });
      }
      if (path === "/api/development/preflight") {
        return gitFetcher ? gitFetcher() : response({ status: "ready", projectPath: "C:\\fixture-project",
          initialize: false, message: "Fixture Git working copy is ready." });
      }
      if (path === "/api/project-entry") {
        entryRequests.push(path + ":" + (options.method || "GET"));
        if (options.method === "POST") {
          const choice = JSON.parse(String(options.body)).startingPath;
          if (startingPath && choice !== startingPath) return response({ error: "Starting path already chosen." }, 409);
          startingPath = choice;
        }
        return response({ projectPath: "C:\\fixture-project", startingPath });
      }
      if (path === "/api/project-entry/open") {
        entryRequests.push(path);
        const developmentStarted = !entryOpened && startingPath === "development";
        entryOpened = true;
        return response({ developmentStarted, developmentContext: startingPath === "development" });
      }
      if (path === "/api/development/view") {
        presentationRequests.push(path);
        return response({ url: "http://127.0.0.1:8765/", channel: "fixture-project" });
      }
      if (path.startsWith("/api/prototype/preview-status")) {
        previewRequests.push(options);
        const target = path.includes("target=pending") ? "pending" : "current";
        if (previewFetcher && target === "current") return previewFetcher();
        const current = mounted.store.getSnapshot().state;
        const checkpoint = current.prototypeFlow?.checkpoints.find((item: { id: string }) =>
          item.id === (target === "current" ? current.prototypeFlow.displayedCheckpointId : current.prototypeFlow.pendingCheckpointId));
        return response({ generation: current.generation, checkpointId: checkpoint?.id ?? null,
          pendingCheckpointId: current.prototypeFlow?.pendingCheckpointId ?? null,
          url: checkpoint?.previewUrl || current.previewUrl, available: true, reason: "" });
      }
      requests.push({ path, body: options.body ? JSON.parse(String(options.body)) : null, options });
      return fetcher(path, options);
    },
    __speechFactory: (...args: Parameters<SpeechSessionFactory>) => speechFactory(...args),
    __renderMermaid: (id: string, source: string) => mermaid(id, source),
  });
  Object.assign(window.HTMLElement.prototype, {
    scrollIntoView() {}, hasPointerCapture() { return false; }, setPointerCapture() {}, releasePointerCapture() {},
    getBoundingClientRect() { return { x: 0, y: 0, left: 0, top: 0, width: Number.parseFloat(this.style.width) || 960, height: 640, right: 960, bottom: 640, toJSON() {} }; },
  });
  window.Node.prototype[Symbol.for("nodejs.util.inspect.custom")] = function() {
    return this.nodeType === 1 ? `<${this.nodeName.toLowerCase()}${this.id ? "#" + this.id : ""}>` : this.nodeName;
  };
  window.eval(await (compiled ??= compile()));
  const mounted = window.TandemTest.mount();
  const flush = async () => {
    for (let count = 0; count < 4; count++) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      mounted.flushSync(() => {});
    }
  };
  const get = <T extends HTMLElement = HTMLElement>(id: string): T => {
    const node = document.getElementById(id);
    if (!node) throw new Error("Missing renderer element #" + id);
    return node as T;
  };
  const fire = async (node: Element, type: string, details: Record<string, unknown> = {}) => {
    const ctor = type.startsWith("key") ? window.KeyboardEvent : type.startsWith("pointer") || ["click", "mousedown", "mouseup"].includes(type)
      ? window.MouseEvent : window.Event;
    const event = new ctor(type, { bubbles: true, cancelable: true, ...details });
    for (const [key, value] of Object.entries(details)) if (!(key in event) || event[key] !== value) Object.defineProperty(event, key, { value });
    mounted.flushSync(() => node.dispatchEvent(event));
    await flush();
  };
  const click = async (target: string | Element) => {
    const node = typeof target === "string" ? get(target) : target;
    if ("disabled" in node && node.disabled) return;
    await fire(node, "click");
  };
  const input = async (target: string | HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) => {
    const node = typeof target === "string" ? get<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(target) : target;
    const prototype = node.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : node.tagName === "SELECT" ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(node, value);
    await fire(node, node.tagName === "SELECT" ? "change" : "input");
  };
  const dispose = () => { mounted.dispose(); window.close(); };
  t?.after(dispose);
  return { presentationRequests, entryRequests, previewRequests,
    window, document, requests, errors, pngExports, store: mounted.store, get, click, input, fire, flush, dispose,
    async openProcess() {
      processSettingsFixture = true;
      try {
        await click("project-settings");
        if (document.getElementById("acceptance-delivery")) await click("acceptance-delivery");
        else {
          const frame = get<HTMLIFrameElement>("project-conversation-frame");
          window.dispatchEvent(new window.MessageEvent("message", { origin: "http://127.0.0.1:8765", source: frame.contentWindow,
            data: { protocol: "tandem-project/v1", channel: "fixture-project", type: "process-open" } }));
          await flush();
        }
      } finally { processSettingsFixture = false; }
    },
    render(value: UiState, sequence?: number) {
      let changed = false;
      mounted.flushSync(() => { changed = mounted.store.accept(value, sequence); });
      return changed;
    },
    async confirm(approve = true) {
      await flush();
      const dialog = document.querySelector('[role="alertdialog"]');
      if (!dialog) throw new Error("Expected a confirmation dialog");
      const button = Array.from(dialog.querySelectorAll("button")).find((node) => node.textContent === (approve ? "Confirm" : "Cancel"));
      if (!button) throw new Error("Confirmation button missing");
      await click(button);
    },
    setFetch(handler: typeof fetcher) { fetcher = handler; },
    setGitPreflight(handler: () => Promise<Response>) { gitFetcher = handler; },
    setPreviewFetch(handler: () => Promise<Response>) { previewFetcher = handler; },
    headerMessages,
    async sendHeaderMessage(data: Record<string, unknown>, origin = headerHost?.origin || "http://127.0.0.1:9000", source: unknown = parent) {
      const event = new window.MessageEvent("message", { data: { channel: headerHost?.channel, ...data }, origin });
      Object.defineProperty(event, "source", { value: source });
      mounted.flushSync(() => window.dispatchEvent(event));
      await flush();
    },
    setSpeechFactory(handler: SpeechSessionFactory) { speechFactory = handler; },
    setMermaid(handler: typeof mermaid) { mermaid = handler; },
    setNarrowViewport(value: boolean) { narrow = value; window.dispatchEvent(new window.Event("resize")); },
    enablePngExport(data = "iVBORw0KGgo=") {
      window.Image = class {
        source = "";
        onload?: () => void;
        set src(value: string) { this.source = value; this.onload?.(); }
      };
      window.HTMLCanvasElement.prototype.getContext = function() {
        return { fillRect() {}, drawImage: (image: { source: string }) => pngExports.push({ width: this.width, height: this.height, source: image.source }) };
      };
      window.HTMLCanvasElement.prototype.toDataURL = () => "data:image/png;base64," + data;
    },
  };
}

export function state(stage: UiState["lifecycle"]["currentStage"] = "requirements", revision = 1): UiState {
  const stages: UiState["lifecycle"]["currentStage"][] = ["prepare", "requirements", "sketch", "prototype", "development"];
  return {
    version: 1, prototypeId: "fixture", revision, updatedAt: `2026-09-06T00:00:${String(revision).padStart(2, "0")}Z`,
    generation: "fixture-generation", jobOwner: null, openResetRequestId: null, stage, phase: "discovery", status: "",
    goal: "Build a useful project",
    lifecycle: { version: 3, currentStage: stage, completedStages: stages.slice(0, stages.indexOf(stage)), outputs: [], skippedStages: [], history: [] },
    provider: { canSubmitAnswers: true, extensionId: "fixture", canReload: false },
    preparation: { status: stage === "prepare" ? "not-started" : "ready", summary: "", error: "", workItems: [], messages: [], checks: [], sources: [], suggestedUsages: [], processing: null },
    prototypeApproach: { mode: stage === "prepare" ? "undecided" : "build", reason: "Fixture prototype approach" },
    sketch: { version: 1, status: "empty", current: null, approved: null, history: [], processing: null, message: "" },
    requirements: { substage: "usage", usageItems: [], suggestions: [] },
    decisionGraph: { nodes: [] }, question: null, artifacts: [], previewStatus: "waiting", previewUrl: null, prototypeFlow: null,
    confirmed: [], assumed: [], deferred: [], process: createProcessState(), reloadReceipt: null,
    prototypeReview: { revisions: [], question: null },
    planning: { status: "idle", workItems: [], agents: [], waves: [], maxAgents: 4 },
    implementation: { status: "idle", workItems: [], agents: [] },
    testing: { status: "idle", scenarios: [], agents: [] },
    designReview: { threads: [] }, testDesignReview: { threads: [], scenarios: [] }, design: { substage: "product" },
    processing: null, suggestionProcessing: null,
  };
}
export function decision(id: string, status = "active") {
  return { id, title: id, status, answer: status === "answered" ? "Previous answer" : null, dependencies: [],
    question: { id, text: id, choices: ["A", "B"], recommended: "A", allowFreeText: true } };
}
