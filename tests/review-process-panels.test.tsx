import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { JSDOM } from "jsdom";
import React, { act, useState } from "react";
import { createProcessState } from "../src/process-state.js";
import { ArtifactList, ArtifactsPanel } from "../src/renderer/artifacts-panel.js";
import { ProcessPanel } from "../src/renderer/process-panel.js";
import { SpeechProvider } from "../src/renderer/speech-textarea.js";
import { DraftProvider, UiContext, type UiContextValue, type UiState } from "../src/renderer/ui-context.js";
import type { AcceptanceRecord } from "../src/accepted-artifacts.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function fixture(): UiState {
  return {
    prototypeId: "review-fixture", generation: "first-generation", revision: 1,
    lifecycle: { currentStage: "prototype", completedStages: ["prepare", "requirements", "sketch"],
      outputs: [], skippedStages: [], history: [] },
    design: { substage: "product" }, designReview: { threads: [] }, testDesignReview: { threads: [], scenarios: [] },
    artifacts: ["a", "b"].map((id) => ({
      id, title: `Artifact ${id}`, stage: "design", kind: "contract", path: "", language: "markdown", content: `Content ${id}`, mermaid: "",
    })),
    process: createProcessState(), provider: { canSubmitAnswers: true },
    preparation: { status: "ready" }, implementation: { status: "idle" }, testing: { status: "idle" },
    planning: {}, previewStatus: "waiting",
  } as UiState;
}

function acceptance(id: string, path: string): AcceptanceRecord {
  return { id, stageId: "prototype", snapshotPath: path, snapshotHash: "snapshot-hash", acceptedAt: "now",
    acceptedBy: { label: "Owner", sessionId: "owner-session" }, source: { commit: null, fingerprint: "sources" },
    producer: { version: "1", configurationHash: "config" }, upstream: [], artifactHashes: [], exportPath: null };
}

async function harness(initial = fixture()) {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost" });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  const globals: Record<string, unknown> = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement, Element: dom.window.Element,
    Node: dom.window.Node, MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0),
    cancelAnimationFrame: clearTimeout, IS_REACT_ACT_ENVIRONMENT: true,
  };
  for (const [key, value] of Object.entries(globals)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(dom.window.document.getElementById("root")!);
  const requests: { endpoint: string; body: any }[] = [];
  const confirmations: string[] = [];
  let snapshot = initial;
  let send: (endpoint: string, body: unknown) => Promise<UiState> = async () => snapshot;
  let confirmation: (message: string) => Promise<boolean> = async () => true;
  function Host({ state }: { state: UiState }) {
    const [selection, setSelection] = useState<string | null>(state.artifacts[0]?.id || null);
    const [busy, setBusy] = useState(new Set<string>());
    const context: UiContextValue = {
      state, pending: busy.size > 0,
      post: async <T,>(endpoint: string, body: unknown) => {
        requests.push({ endpoint, body });
        return await send(endpoint, body) as T;
      },
      refresh: async () => undefined,
      canEdit: (stage, allowCompleted = false) => state.lifecycle.currentStage === stage
        && (allowCompleted || !state.lifecycle.completedStages.includes(stage))
        && state.provider?.canSubmitAnswers !== false && !state.effortReset,
      guidance: (action) => `Return to the owning session to ${action}.`,
      confirm: async (message) => { confirmations.push(message); return confirmation(message); },
      browseStage: () => undefined, selectArtifact: setSelection,
      setBusy: (key, value) => setBusy((old) => {
        const next = new Set(old);
        if (value) next.add(key); else next.delete(key);
        return next;
      }),
    };
    return <UiContext.Provider value={context}>
      <DraftProvider key={`${state.prototypeId}:${state.generation}`}><SpeechProvider>
        <ArtifactList selectedArtifactId={selection} />
        <ArtifactsPanel selectedArtifactId={selection} /><ProcessPanel />
      </SpeechProvider></DraftProvider>
    </UiContext.Provider>;
  }
  async function render(next: UiState) {
    snapshot = next;
    await act(async () => { root.render(<Host state={next} />); });
  }
  function get<T extends Element = HTMLElement>(selector: string): T {
    const element = dom.window.document.querySelector<T>(selector);
    assert.ok(element, `Missing ${selector}`);
    return element;
  }
  async function click(selector: string) {
    await act(async () => { get<HTMLElement>(selector).click(); });
  }
  async function input(selector: string, value: string) {
    const element = get<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(selector);
    const prototype = element instanceof dom.window.HTMLTextAreaElement ? dom.window.HTMLTextAreaElement.prototype
      : element instanceof dom.window.HTMLSelectElement ? dom.window.HTMLSelectElement.prototype
        : dom.window.HTMLInputElement.prototype;
    await act(async () => {
      Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
      element.dispatchEvent(new dom.window.Event(element instanceof dom.window.HTMLSelectElement ? "change" : "input", { bubbles: true }));
    });
  }
  async function submit(selector: string) {
    await act(async () => {
      get(selector).dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    });
  }
  cleanups.push(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  await render(initial);
  return {
    render, get, click, input, submit, requests, confirmations,
    setSend: (handler: typeof send) => { send = handler; },
    setConfirm: (handler: typeof confirmation) => { confirmation = handler; },
    text: () => dom.window.document.body.textContent || "",
  };
}

test("process settings retain their dirty base revision on conflicts and preserve replacement drafts", async () => {
  const state = fixture();
  const h = await harness(state);
  await h.input("#handoff-adapter", "github");
  await h.input("#process-repository", "owner/repo");
  await h.render({ ...state, revision: 2 });
  h.setSend(async () => { throw new Error("The effort changed. Review and retry."); });
  await h.submit('form[aria-label="Process settings"]');
  assert.equal(h.requests[0].body.expectedRevision, 1);
  assert.equal(h.requests[0].body.settings.adapters.status, "local");
  assert.match(h.get("#process-message").textContent!, /effort changed/);
  assert.equal(h.get<HTMLInputElement>("#process-repository").value, "owner/repo");
  await h.click("#reset-process");
  assert.equal(h.get<HTMLSelectElement>("#handoff-adapter").value, "local");
  let release!: (state: UiState) => void;
  h.setSend(() => new Promise((resolve) => { release = resolve; }));
  await h.submit('form[aria-label="Process settings"]');
  await h.input("#process-repository", "replacement/repository");
  await act(async () => { release(state); });
  assert.equal(h.get<HTMLInputElement>("#process-repository").value, "replacement/repository");
  assert.equal(h.requests.length, 2);
});

test("handoff export selects only current acceptance and never authorizes automatic dispatch", async () => {
  const state = fixture();
  state.lifecycle.currentStage = "development";
  state.lifecycle.completedStages.push("prototype");
  state.lifecycle.outputs = [{ stageId: "prototype", path: ".tandem\\plan-r2.json", completedAt: "now" }];
  state.process.acceptances = [acceptance("old", ".tandem\\plan-r1.json")];
  const h = await harness(state);
  assert.equal(h.get<HTMLButtonElement>("#export-handoff").disabled, true);
  state.process.acceptances.push(acceptance("current", ".tandem\\plan-r2.json"));
  await h.render({ ...state, revision: 2 });
  h.setConfirm(async () => false);
  await h.click("#export-handoff");
  assert.equal(h.requests.length, 0);
  h.setConfirm(async () => true);
  await h.click("#export-handoff");
  assert.deepEqual(h.requests[0].body, { expectedRevision: 2, action: "export", acceptanceId: "current" });
  assert.match(h.text(), /Historical snapshot/);
  state.process.settings.autoStartImplementation = true;
  await h.render({ ...state, revision: 3 });
  await h.input("#handoff-approver", "Owner");
  await h.click("#accept-handoff");
  assert.match(h.confirmations.at(-1)!, /Nothing will execute/);
  assert.equal(h.requests[1].body.approver, "Owner");
});

test("publication is explicit, receipts survive adapter changes, and GitHub intake omits local JSON", async () => {
  const state = fixture();
  state.lifecycle.outputs = [{ stageId: "development", path: ".tandem\\development-r1.json", completedAt: "now" }];
  state.process.deliveryDraft = { id: "draft", body: "Review before publishing", sourceFingerprint: "sources", acceptanceIds: [] };
  state.process.settings.adapters = { handoff: "github", status: "local", intake: "github" };
  state.process.receipts = [{ id: "receipt", adapter: "local", block: "handoff", recordedAt: "now",
    reference: "local-bundle", summary: "Not published", inputHash: "hash" }];
  const h = await harness(state);
  assert.match(h.get("#process-receipts").textContent!, /local \/ handoff/);
  h.setConfirm(async () => false);
  await h.click("#publish-delivery");
  assert.equal(h.requests.length, 0);
  h.setConfirm(async () => true);
  await h.input("#process-reference", "https://github.com/owner/repo/issues/23");
  await h.input("#intake-content", '{"title":"Old local data"}');
  await h.click("#import-intake");
  assert.equal(Object.hasOwn(h.requests[0].body, "content"), false);
  await h.click("#publish-delivery");
  assert.equal(h.requests[1].body.confirm, true);
  assert.match(h.confirmations.at(-1)!, /using github/);
  assert.match(h.confirmations.at(-1)!, /Nothing will be merged or deployed/);
});

test("a confirmation cannot submit for a changed revision or an unmounted generation", async () => {
  const state = fixture();
  const h = await harness(state);
  let release!: (approved: boolean) => void;
  h.setConfirm(() => new Promise((resolve) => { release = resolve; }));
  await h.submit('form[aria-label="Process settings"]');
  await h.render({ ...state, revision: 2 });
  await act(async () => { release(true); });
  assert.equal(h.requests.length, 0);
  assert.match(h.get("#process-message").textContent!, /effort changed/);
  await h.submit('form[aria-label="Process settings"]');
  await h.render({ ...state, generation: "replacement-generation", revision: 3 });
  await act(async () => { release(true); });
  assert.equal(h.requests.length, 0);
});

test("provider read-only controls preserve history, block mutations, and distinguish historical proof", async () => {
  const state = fixture();
  state.provider = { canSubmitAnswers: false };
  state.implementation = { status: "completed", requestId: "current-request", runId: "run",
    inputRevision: "spec", verifiedSourceFingerprint: "sources", commandEvidence: [{
      id: "proof", checkId: "check", status: "passed", exitCode: 0, requestId: "old-request", runId: "run",
      inputRevision: "old-spec", sourceFingerprint: "old-sources", outputHash: "output-hash", output: "Tool output",
      args: ["test"], program: "npm", outputTruncated: true,
    }] };
  const h = await harness(state);
  assert.equal(h.get<HTMLButtonElement>("#save-process").disabled, true);
  await h.submit('form[aria-label="Process settings"]');
  assert.equal(h.requests.length, 0);
  assert.match(h.get("#process-evidence").textContent!, /historical \/ different inputs/);
  assert.match(h.get("#process-evidence").textContent!, /Specification \/ inputs: old-spec/);
  assert.match(h.get("#process-evidence").textContent!, /Output SHA256: output-hash/);
  assert.match(h.get("#process-evidence").textContent!, /\[Output truncated\]/);
  const evidence = h.get<HTMLDetailsElement>("#process-evidence details");
  evidence.open = true;
  const summary = evidence.querySelector("summary")!;
  summary.focus();
  await h.render({ ...state, revision: 2 });
  assert.equal(h.get("#process-evidence details"), evidence);
  assert.equal(evidence.open, true);
  assert.equal(summary.ownerDocument.activeElement, summary);
});

test("approved scenario specifications remain readable and artifact content is escaped", async () => {
  const state = fixture();
  state.design.substage = "test";
  state.testDesignReview = { threads: [], finalizedArtifactId: "test-spec", scenarios: [{
    id: "integration", title: "Service boundary", type: "integration", description: "Validate a boundary",
    dependencies: ["setup"], steps: ["Send request"], expectedOutcome: "Accepted response", validation: ["Check status"],
  }] };
  state.artifacts[0].content = '<script>alert("not executable")</script>';
  const h = await harness(state);
  assert.match(h.text(), /Read-only legacy evidence/);
  assert.match(h.text(), /does not authorize Development/);
  assert.equal(h.get("#artifact-content").querySelector("script"), null);
  assert.equal(h.get("#artifact-content").textContent, state.artifacts[0].content);
});
