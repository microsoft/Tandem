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

async function harness(t: TestContext, panel: "preparation" | "plan" | "implementation" | "test") {
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
  const [{ createRoot }, { UiContext, DraftProvider }, { SpeechProvider }, { PreparationPanel }, { PlanPanel }, { ImplementationPanel, TestPanel }] = await Promise.all([
    import("react-dom/client"), import("../src/renderer/ui-context.js"), import("../src/renderer/speech-textarea.js"),
    import("../src/renderer/preparation-panel.js"), import("../src/renderer/plan-panel.js"), import("../src/renderer/execution-panel.js"),
  ]);
  const panels: Record<typeof panel, ComponentType> = { preparation: PreparationPanel, plan: PlanPanel, implementation: ImplementationPanel, test: TestPanel };
  const Panel = panels[panel];
  const root = createRoot(dom.window.document.getElementById("root")!);
  let state = fixture(panel === "preparation" ? "prepare" : panel === "implementation" ? "implement" : panel);
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

test("React planning keeps agent limits, exact generation payloads, and explicit finalization", async (t) => {
  const h = await harness(t, "plan");
  await h.input("#plan-max-agents", "99");
  await h.update({ ...h.state, revision: 2, planning: { ...h.state.planning, maxAgents: 2 } });
  assert.equal(h.element<HTMLInputElement>("#plan-max-agents").value, "99");
  await h.click("#generate-plan");
  assert.deepEqual(h.requests[0], { endpoint: "/api/plan/generate", body: { action: "generate", instruction: "", maxAgents: 30 } });
  await h.click("#finalize-plan");
  assert.equal(h.requests.length, 1);
  await h.update({ ...h.state, planning: {
    ...h.state.planning, status: "ready",
    workItems: [{ id: "work", title: "Work", agentId: "A", dependencies: [], acceptanceCriteria: ["Works"], validation: ["Run tests"] }],
    waves: [{ index: 1, startHour: 0, endHour: 1, workItemIds: ["work"] }],
    agents: [{ id: "A", roles: ["Engineer"], estimatedHours: 1, workItemIds: ["work"] }], risks: ["Coordinate files"],
  } });
  await h.click("#generate-plan");
  assert.deepEqual(h.requests[1].body, {
    action: "revise",
    instruction: "Regenerate the complete plan for the selected agent limit while preserving accepted design scope.", maxAgents: 30,
  });
  await h.click("#optimize-plan");
  assert.deepEqual(h.requests[2].body, {
    action: "revise",
    instruction: "Reduce unnecessary dependencies and file ownership conflicts, widen safe parallel frontiers, balance agent workload, and shorten scheduled elapsed time without dropping scope or validation.",
    maxAgents: 30,
  });
  await h.click("#finalize-plan");
  assert.deepEqual(h.requests[3], { endpoint: "/api/plan/finalize", body: {} });
  await h.pending(true);
  await h.click("#finalize-plan");
  assert.equal(h.requests.length, 4);
});

test("React plan errors and replacement drafts survive polling and accepted requests", async (t) => {
  const h = await harness(t, "plan");
  await h.update({ ...h.state, planning: { ...h.state.planning, status: "ready", workItems: [{ id: "work", title: "Work" }] } });
  await h.input("#plan-revision-input", "First instruction");
  h.setPost(async () => { throw new Error("Rejected"); });
  await h.submit("#plan-revision-form");
  assert.equal(h.element<HTMLTextAreaElement>("#plan-revision-input").value, "First instruction");
  await h.update({ ...h.state, revision: 2 });
  assert.match(h.element("#plan-status").textContent!, /Rejected/);
  let resolve!: (value: UiState) => void;
  h.setPost(() => new Promise((done) => { resolve = done; }));
  await h.submit("#plan-revision-form");
  await h.input("#plan-revision-input", "Replacement instruction");
  await h.input("#plan-revision-input", "First instruction");
  await act(async () => resolve(h.state));
  assert.equal(h.element<HTMLTextAreaElement>("#plan-revision-input").value, "First instruction", "a retyped draft is not the accepted draft even when its text matches");
  h.setPost(async () => h.state);
  await h.submit("#plan-revision-form");
  assert.equal(h.element<HTMLTextAreaElement>("#plan-revision-input").value, "");
  assert.deepEqual(h.requests.at(-1)?.body, { action: "revise", instruction: "First instruction", maxAgents: 4 });
});

test("React work disclosures preserve expansion and focus on runtime-only updates", async (t) => {
  const h = await harness(t, "implementation");
  await h.update({ ...h.state, planning: { workItems: [{ id: "done", title: "Completed work", agentId: "A" }] },
    implementation: { status: "running", workItems: [{ id: "done", status: "completed", summary: "Evidence" }] } });
  const selector = '[data-ui-key="implementation-work:done:summary"]';
  await h.click(selector);
  h.element(selector).focus();
  await h.update({ ...h.state, implementationRuntime: { liveAgentCount: 0, progress: [{ seq: 1, text: "Other work updated", recordedAt: 1 }] } });
  assert.equal(h.element(selector).getAttribute("aria-expanded"), "true");
  assert.equal(h.document.activeElement, h.element(selector));
  assert.match(h.element("#implementation-progress").textContent!, /0 live agents/);
  assert.match(h.element("#implementation-work-items").textContent!, /Evidence/);
  assert.equal(h.element('[role="progressbar"]').getAttribute("aria-valuenow"), "100");
});

test("React implementation uses guarded start, stop, and versioned strategy submissions", async (t) => {
  const h = await harness(t, "implementation");
  await h.update({ ...h.state, planning: { workItems: [{ id: "work", title: "Work" }] } });
  await h.click("#start-implementation");
  assert.deepEqual(h.requests[0], { endpoint: "/api/implementation/start", body: {} });
  await h.update({ ...h.state, implementation: { ...h.state.implementation, status: "running" } });
  await h.click("#start-implementation");
  assert.equal(h.requests.length, 1);
  await h.input("#implementation-strategy-input", "  Validate deeply  ");
  h.setPost(async () => { throw new Error("Queue rejected"); });
  await h.submit("#implementation-strategy-form");
  assert.deepEqual(h.requests[1], { endpoint: "/api/implementation/strategy", body: { text: "Validate deeply" } });
  assert.equal(h.element<HTMLTextAreaElement>("#implementation-strategy-input").value, "  Validate deeply  ");
  assert.match(h.element("#implementation-status").textContent!, /Queue rejected/);
  h.setPost(async () => h.state);
  await h.submit("#implementation-strategy-form");
  assert.equal(h.element<HTMLTextAreaElement>("#implementation-strategy-input").value, "");
  await h.click("#stop-implementation");
  assert.deepEqual(h.requests[3], { endpoint: "/api/implementation/stop", body: {} });
  await h.update({ ...h.state, implementation: { ...h.state.implementation, status: "completed" } });
  assert.equal(h.element<HTMLButtonElement>("#start-implementation").disabled, true);
  assert.equal(h.element<HTMLButtonElement>("#submit-implementation-strategy").disabled, true);
});

test("React tests rerun completed current stages but block historical and concurrent work", async (t) => {
  const h = await harness(t, "test");
  await h.update({ ...h.state, lifecycle: { ...h.state.lifecycle, completedStages: ["test"] },
    testDesignReview: { scenarios: [{ id: "scenario", title: "Scenario" }] },
    testing: { status: "completed", scenarios: [{ id: "scenario", status: "passed" }] } });
  assert.match(h.element("#start-tests").textContent!, /Run tests again/);
  await h.click("#start-tests");
  assert.deepEqual(h.requests, [{ endpoint: "/api/test/start", body: {} }]);
  await h.update({ ...h.state, implementation: { status: "running" } });
  assert.equal(h.element<HTMLButtonElement>("#start-tests").disabled, true);
  await h.click("#start-tests");
  await h.update({ ...h.state, implementation: { status: "completed" }, lifecycle: { ...h.state.lifecycle, currentStage: "implement" } });
  assert.equal(h.element<HTMLButtonElement>("#start-tests").disabled, true);
  await h.click("#start-tests");
  assert.equal(h.requests.length, 1);
});

test("React scenario details stay open when an active scenario completes", async (t) => {
  const h = await harness(t, "test");
  await h.update({ ...h.state, testDesignReview: { scenarios: [{ id: "scenario", title: "Scenario" }] },
    testing: { status: "running", scenarios: [{ id: "scenario", status: "running" }] } });
  const selector = '[data-ui-key="test-scenario:scenario:summary"]';
  assert.equal(h.element(selector).getAttribute("aria-expanded"), "true");
  h.element(selector).focus();
  await h.update({ ...h.state, testing: { status: "completed", scenarios: [{ id: "scenario", status: "passed", evidence: ["Completed evidence"] }] } });
  assert.equal(h.element(selector).getAttribute("aria-expanded"), "true");
  assert.equal(h.document.activeElement, h.element(selector));
  assert.match(h.element("#test-scenarios").textContent!, /Completed evidence/);
});

test("React test diagnostics retain focus and details until a new request replaces the run", async (t) => {
  const h = await harness(t, "test");
  await h.update({ ...h.state, testing: { status: "failed", requestId: "run-one", error: "Test failed",
    errorDetails: "Command: npm test\nExit code: 1", scenarios: [] } });
  await h.click("#test-error-toggle");
  assert.equal(h.element("#test-error-toggle").getAttribute("aria-expanded"), "true");
  assert.equal(h.document.activeElement, h.element("#test-error-details"));
  await h.update({ ...h.state, testRuntime: { runId: "late-sdk-run", error: "Telemetry failed", progress: [{ seq: 1, text: "Stopped", recordedAt: 1 }] } });
  assert.equal(h.element("#test-error-toggle").getAttribute("aria-expanded"), "true");
  assert.equal(h.document.activeElement, h.element("#test-error-details"));
  assert.match(h.element("#test-error-details").textContent!, /Exit code: 1/);
  assert.match(h.element("#test-error-details").textContent!, /Telemetry failed/);
  await h.update({ ...h.state, testing: { ...h.state.testing, requestId: "run-two" } });
  assert.equal(h.element("#test-error-toggle").getAttribute("aria-expanded"), "false");
  assert.equal(h.element("#test-error-details").hidden, true);
});

test("React test evidence distinguishes worker reports, current commands, and historical proof", async (t) => {
  const h = await harness(t, "test");
  const command: CommandEvidence = {
    id: "proof", checkId: "unit", requestId: "request", runId: "sdk-run", inputRevision: "spec", sourceFingerprint: "sources",
    program: "npm", args: ["test"], status: "failed", exitCode: 1, output: "Assertion failed",
    outputHash: "hash", outputTruncated: true, error: "Command failed", startedAt: "start", completedAt: "end",
  };
  await h.update({ ...h.state,
    testDesignReview: { scenarios: [{ id: "scenario", title: "Scenario", dependencies: ["dependency"] }] },
    testing: {
      status: "failed", requestId: "request", runId: "sdk-run", inputRevision: "spec", sourceFingerprint: "sources",
      scenarios: [{ id: "scenario", status: "failed", summary: "Worker failed", evidence: ["Worker evidence"] }],
      commandEvidence: [command], events: [{ id: "failure", type: "error", message: "Failure event", at: "2026-09-20" }],
      agents: [{ id: "agent", scenarioId: "scenario", status: "failed", summary: "Agent failure" }],
    },
  });
  assert.match(h.element("#test-scenarios").textContent!, /Worker-reported scenario evidence/);
  await h.click('[data-ui-key="test-command-evidence:proof:summary"]');
  assert.match(h.element("#test-command-evidence").textContent!, /Evidence for the current execution inputs/);
  assert.match(h.element("#test-command-evidence").textContent!, /Output SHA256: hash/);
  await h.click("#test-error-toggle");
  for (const expected of ["Worker failed", "Worker evidence", "Agent failure", "Failure event", "Assertion failed", "outputTruncated"]) {
    assert.ok(h.element("#test-error-details").textContent!.includes(expected), expected);
  }
  await h.update({ ...h.state, testing: { ...h.state.testing, sourceFingerprint: "changed-sources" } });
  assert.match(h.element("#test-command-evidence").textContent!, /Historical evidence/);
  assert.equal(h.element("#test-error-toggle").getAttribute("aria-expanded"), "true");
});
