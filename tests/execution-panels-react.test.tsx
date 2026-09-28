import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { JSDOM } from "jsdom";
import React, { act, type ComponentType } from "react";
import { createProcessState } from "../src/process-state.js";
import { emptySketchState } from "../src/sketch.js";
import type { LifecycleStageId } from "../src/types.js";
import type { CommandEvidence } from "../src/verification.js";
import type { UiContextValue, UiState } from "../src/renderer/ui-context.js";

function fixture(stage: LifecycleStageId): UiState {
  return {
    version: 1, revision: 1, generation: "generation-one", prototypeId: "effort-one",
    jobOwner: null, openResetRequestId: null, stage, goal: "Build a useful project",
    phase: "discovery", status: "", updatedAt: "2026-09-20T00:00:00Z",
    lifecycle: { currentStage: stage, completedStages: [], outputs: [], skippedStages: [], history: [] },
    preparation: {
      status: stage === "prepare" ? "not-started" : "ready", summary: "", error: "",
      workItems: [], messages: [], checks: [], sources: [], suggestedUsages: [], processing: null,
    },
    provider: { canSubmitAnswers: true }, prototypeApproach: { mode: "build", reason: "" },
    requirements: { substage: "usage", usageItems: [], suggestions: [] },
    question: null, decisionGraph: { nodes: [] }, confirmed: [], assumed: [], deferred: [], artifacts: [],
    sketch: emptySketchState(), process: createProcessState(), previewUrl: null, previewStatus: "waiting",
    prototypeFlow: null, prototypeReview: { revisions: [] }, designReview: { threads: [] },
    design: { substage: "product" }, testDesignReview: { threads: [], scenarios: [] },
    planning: { status: "idle", maxAgents: 4, workItems: [], waves: [], agents: [] },
    implementation: { status: "idle", workItems: [], agents: [], events: [] },
    testing: { status: "idle", scenarios: [], agents: [], events: [] },
    processing: null, suggestionProcessing: null, reloadReceipt: null,
  };
}

async function harness(t: TestContext, panel: "preparation") {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { pretendToBeVisual: true, url: "http://localhost/" });
  const globalValues = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node,
    HTMLInputElement: dom.window.HTMLInputElement, HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    Event: dom.window.Event, MouseEvent: dom.window.MouseEvent,
    MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(Object.keys(globalValues).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globalValues)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const [{ createRoot }, { UiContext, DraftProvider }, { SpeechProvider }, { PreparationPanel }] = await Promise.all([
    import("react-dom/client"), import("../src/renderer/ui-context.js"), import("../src/renderer/speech-textarea.js"),
    import("../src/renderer/preparation-panel.js"),
  ]);
  const panels: Record<typeof panel, ComponentType> = { preparation: PreparationPanel };
  const Panel = panels[panel];
  const root = createRoot(dom.window.document.getElementById("root")!);
  let state = fixture("prepare");
  let pending = false;
  const requests: Array<{ endpoint: string; body: unknown }> = [];
  let handler: () => Promise<unknown> = async () => state;
  function render() {
    const context: UiContextValue = {
      state, pending,
      post: async <T,>(endpoint: string, body: unknown) => { requests.push({ endpoint, body }); return await handler() as T; },
      refresh: async () => {},
      canEdit: (stage, allowCompleted = false) => state.provider?.canSubmitAnswers !== false
        && state.lifecycle.currentStage === stage && (allowCompleted || !state.lifecycle.completedStages.includes(stage)),
      guidance: (action) => "Use the writable provider to " + action + ".",
      confirm: async () => true, browseStage: () => {}, selectArtifact: () => {}, setBusy: () => {},
    };
    root.render(<UiContext.Provider value={context}>
      <DraftProvider key={state.prototypeId + ":" + state.generation}><SpeechProvider><Panel /></SpeechProvider></DraftProvider>
    </UiContext.Provider>);
  }
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  await act(async () => render());
  function element<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = dom.window.document.querySelector<T>(selector);
    assert.ok(element, "Missing element: " + selector);
    return element;
  }
  return {
    requests, element, document: dom.window.document,
    get state() { return state; },
    async update(next: UiState) { state = next; await act(async () => render()); },
    async pending(value: boolean) { pending = value; await act(async () => render()); },
    setPost(next: () => Promise<unknown>) { handler = next; },
    async click(selector: string) { await act(async () => element(selector).click()); },
    async submit(selector: string) { await act(async () => element(selector).dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }))); },
    async input(selector: string, value: string) {
      await act(async () => {
        const input = element<HTMLInputElement | HTMLTextAreaElement>(selector);
        const prototype = input.tagName === "TEXTAREA" ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      });
    },
  };
}

test("React preparation shows runtime/results, and only explicitly retries editable failures", async (t) => {
  const h = await harness(t, "preparation");
  const preparation = {
    ...h.state.preparation, status: "failed" as const,
    workItems: [{ id: "context", title: "Inspect context", status: "running" as const, detail: "Read guidance", result: "" }],
    checks: [{ label: "Workspace", status: "missing" as const, detail: "Missing configuration" }],
    sources: [{ title: "Documentation", url: "https://example.com/docs", purpose: "Authority" }],
    suggestedUsages: ["Suggested requirement"],
  };
  await h.update({ ...h.state, preparation });
  assert.match(h.element("#preparation-stage-progress").textContent!, /stopped before completion/);
  assert.match(h.element("#preparation-result-checks").textContent!, /Workspace · missing/);
  assert.match(h.element("#preparation-result-suggestions").textContent!, /Suggested requirement/);
  assert.equal(h.element<HTMLAnchorElement>("#preparation-result-sources a").rel, "noreferrer");
  h.setPost(async () => { throw new Error("Preparation unavailable"); });
  await h.click("#retry-preparation");
  assert.deepEqual(h.requests, [{ endpoint: "/api/preparation/retry", body: {} }]);
  await h.update({ ...h.state, preparationRuntime: { error: "Telemetry unavailable", agents: [{ label: "prepare:context", activity: "Reading docs" }] } });
  assert.match(h.element("#preparation-stage-message").textContent!, /Preparation unavailable/);
  assert.match(h.element("#preparation-work-items").textContent!, /Reading docs/);
  await h.pending(true);
  assert.equal(h.element<HTMLButtonElement>("#retry-preparation").disabled, true);
  await h.click("#retry-preparation");
  await h.pending(false);
  await h.update({ ...h.state, lifecycle: { ...h.state.lifecycle, currentStage: "requirements" } });
  await h.click("#retry-preparation");
  assert.equal(h.requests.length, 1);
});
