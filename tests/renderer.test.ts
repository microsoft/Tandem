import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { transform } from "esbuild";
import { runInNewContext } from "node:vm";
import { rendererHarness, state, decision, response } from "./helpers/renderer-harness.js";

function processFixture() {
    return {
        settings: { adapters: { handoff: "local", status: "local", intake: "local" }, githubRepository: "",
            autoStartImplementation: false, autoStartTests: false, verification: { enabled: false, independentReview: true, checks: [] } },
        acceptances: [], receipts: [], deliveryDraft: null, message: "",
    };
}

function blankEffort(revision = 1, generation = "fixture-generation") {
    return { ...state("prepare", revision), goal: "", generation };
}

function checkpoint(id: string, milestone: string, status = "ready", extra: any = {}) {
    return {
        id, milestone, revisionId: null, requestId: `request-${id}`, generation: "fixture-generation",
        status, baseCheckpointId: null, workspacePath: `workspaces\\${id}`,
        previewUrl: status === "ready" ? `http://127.0.0.1:${id === "structure" ? 9998 : 9999}/` : null,
        summary: `${milestone} checkpoint`, focus: `Building ${milestone}`, requestedAt: "2026-09-09T00:00:00Z",
        completedAt: status === "running" ? null : "2026-09-09T00:01:00Z", timeoutSeconds: 300, ...extra,
    };
}

function progressivePrototype(revision = 1): any {
    return {
        ...state("prototype", revision), previewStatus: "ready", previewUrl: "http://127.0.0.1:9998/",
        prototypeFlow: {
            version: 1,
            checkpoints: [checkpoint("structure", "structure"), checkpoint("interaction", "interaction", "running")],
            displayedCheckpointId: "structure", pendingCheckpointId: null, activeCheckpointId: "interaction",
            visualRequested: false, budget: { limitSeconds: 900, usedSeconds: 90 },
        },
    };
}

function readyPrototype(revision = 1, pending = false): any {
    const value = progressivePrototype(revision);
    value.prototypeFlow.checkpoints[1] = checkpoint("interaction", "interaction");
    value.prototypeFlow.activeCheckpointId = null;
    value.prototypeFlow.pendingCheckpointId = pending ? "interaction" : null;
    value.prototypeFlow.displayedCheckpointId = pending ? "structure" : "interaction";
    value.previewUrl = value.prototypeFlow.checkpoints[pending ? 0 : 1].previewUrl;
    return value;
}

test("header omits reload success text and places the version after Reset", async () => {
    const h = await rendererHarness();
    const value = { ...state(), provider: { canSubmitAnswers: true, canReload: true },
        reloadReceipt: { status: "success", message: "Reloaded the latest installed user extension." } };
    h.api.renderIfChanged(value);
    assert.equal(h.api.elements.reloadStatus.textContent, "");
    assert.equal(h.api.elements.reloadButton.textContent, "Reload");
    assert.equal(h.api.elements.reloadButton.disabled, false);
    const actions = h.document.querySelector(".topbar-actions")!;
    assert.equal(actions.children.at(-1)!.className, "build-version");
    assert.equal(actions.children.at(-2), h.api.elements.resetEffort);
    h.api.renderIfChanged({ ...value, revision: 2,
        reloadReceipt: { status: "error", message: "Could not reload the extension." } });
    assert.equal(h.api.elements.reloadStatus.textContent, "Could not reload the extension.");
    assert.equal(h.api.elements.reloadStatus.dataset.status, "error");
});

test("goal entry waits for an explicit valid start and preserves drafts across updates", async () => {
    const h = await rendererHarness();
    const value = blankEffort();
    h.api.renderIfChanged(value);
    assert.equal(h.api.elements.startPanel.hidden, false);
    assert.equal(h.api.elements.workspace.hidden, true);
    assert.equal(h.api.elements.lifecycleStatus.hidden, true);
    assert.equal(h.api.elements.nextActionBar.hidden, true);
    assert.equal(h.api.elements.startEffort.disabled, true);
    assert.equal(h.requests.length, 0);
    h.api.elements.startGoal.value = "   ";
    await h.api.elements.startForm.emit("submit");
    assert.match(h.api.elements.startMessage.textContent, /Enter a project goal/);
    assert.equal(h.api.elements.startGoal.getAttribute("aria-invalid"), "true");
    assert.equal(h.requests.length, 0);
    h.api.elements.startGoal.value = "  Build a team task board  ";
    await h.api.elements.startGoal.emit("input");
    h.api.elements.startGoal.focus();
    h.api.elements.startGoal.setSelectionRange(3, 8);
    h.api.renderIfChanged({ ...value, revision: 2 });
    assert.equal(h.api.elements.startGoal.value, "  Build a team task board  ");
    assert.equal(h.api.elements.startGoal.selectionStart, 3);
    assert.equal(h.api.elements.startEffort.disabled, false);
    const started = { ...state("prepare", 3), goal: "Build a team task board" };
    started.preparation.status = "starting";
    let release!: (response: any) => void;
    h.setFetch(() => new Promise((resolve) => { release = resolve; }));
    const request = h.api.elements.startForm.emit("submit");
    await h.flush();
    assert.equal(h.api.elements.startEffort.disabled, true);
    await h.api.elements.startForm.emit("submit");
    await h.api.elements.resetEffort.emit("click");
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].path, "/api/effort/start");
    assert.equal(h.requests[0].body.goal, "Build a team task board");
    assert.equal(h.requests[0].body.expectedRevision, 2);
    assert.equal(h.requests[0].body.generation, "fixture-generation");
    release(response(started));
    await request;
    assert.equal(h.api.elements.startPanel.hidden, true);
    assert.equal(h.api.elements.workspace.hidden, false);
    assert.equal(h.api.elements.preparationPanel.hidden, false);
    assert.equal(h.api.elements.startGoal.value, "");
    assert.equal(h.document.activeElement, h.api.elements.preparationPanel);
});

test("start errors preserve the goal and read-only goal entry cannot submit", async () => {
    const h = await rendererHarness();
    const value = blankEffort();
    h.api.renderIfChanged(value);
    h.api.elements.startGoal.value = "x".repeat(4001);
    await h.api.elements.startForm.emit("submit");
    assert.equal(h.requests.length, 0);
    h.api.elements.startGoal.value = "Build a focused app";
    await h.api.elements.startGoal.emit("input");
    h.setFetch(async () => response({ error: "The effort changed. Reload and retry." }, 409));
    await h.api.elements.startForm.emit("submit");
    assert.equal(h.api.elements.startGoal.value, "Build a focused app");
    assert.match(h.api.elements.startMessage.textContent, /effort changed/);
    h.api.renderIfChanged({ ...value, revision: 2 });
    assert.match(h.api.elements.startMessage.textContent, /effort changed/);
    h.api.renderIfChanged({ ...value, revision: 3, provider: { canSubmitAnswers: false } });
    await h.api.elements.startForm.emit("submit");
    await h.api.elements.resetEffort.emit("click");
    assert.equal(h.api.elements.startGoal.disabled, true);
    assert.equal(h.api.elements.resetEffort.disabled, true);
    assert.equal(h.requests.length, 1);
});

test("reset is confirmed, available during active work, and clears local drafts only after success", async () => {
    const h = await rendererHarness();
    const value = { ...state("implement"), process: processFixture() };
    value.implementation.status = "running";
    h.api.renderIfChanged({ ...value, implementationRuntime: { liveAgentCount: 2 } });
    assert.equal(h.api.elements.resetEffort.disabled, false);
    h.api.elements.handoffApprover.value = "Previous owner";
    h.api.elements.usageInput.value = "Old unsent usage";
    h.api.elements.processRepository.value = "owner/old";
    await h.api.elements.processRepository.emit("input");
    h.api.formDrafts.set("old-question", { values: { detail: "Old draft" }, version: 1 });
    h.setConfirm(false);
    await h.api.elements.resetEffort.emit("click");
    assert.equal(h.requests.length, 0);
    assert.equal(h.api.elements.usageInput.value, "Old unsent usage");
    h.setConfirm(true);
    let release!: (response: any) => void;
    h.setFetch(() => new Promise((resolve) => { release = resolve; }));
    const request = h.api.elements.resetEffort.emit("click");
    await h.flush();
    assert.equal(h.api.elements.resetEffort.disabled, true);
    assert.match(h.api.elements.effortMessage.textContent, /Stopping active work/);
    assert.equal(h.api.elements.workspace.inert, true);
    assert.equal(h.api.elements.workspace.getAttribute("aria-busy"), "true");
    assert.equal(h.api.elements.usageInput.value, "Old unsent usage");
    await h.api.elements.resetEffort.emit("click");
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].path, "/api/effort/reset");
    assert.equal(h.requests[0].body.confirm, true);
    assert.equal(h.requests[0].body.expectedRevision, 1);
    assert.equal(h.requests[0].body.generation, "fixture-generation");
    release(response(blankEffort(4, "reset-generation")));
    await request;
    assert.equal(h.api.elements.startPanel.hidden, false);
    assert.equal(h.api.elements.workspace.inert, false);
    assert.equal(h.api.elements.usageInput.value, "");
    assert.equal(h.api.elements.handoffApprover.value, "");
    assert.equal(h.api.elements.processRepository.value, "");
    assert.equal(h.api.formDrafts.has("old-question"), false);
    assert.equal(h.api.current().implementationRuntime, undefined);
    assert.equal(h.document.activeElement, h.api.elements.startGoal);
    assert.match(h.api.elements.effortMessage.textContent, /Effort reset/);
    assert.equal(h.api.renderIfChanged({ ...value, revision: 2 }), false, "old activity must not restore the previous effort");
    assert.equal(h.api.elements.startPanel.hidden, false);
});

test("reset cancellation failure keeps the current effort and exposes a persistent error", async () => {
    const h = await rendererHarness();
    const value = state("prepare");
    value.preparation.status = "running";
    h.api.renderIfChanged(value);
    h.api.elements.usageInput.value = "Keep this draft";
    h.setFetch(async () => response({ error: "Worker termination could not be confirmed. Retry Reset." }, 409));
    await h.api.elements.resetEffort.emit("click");
    h.api.renderIfChanged({ ...value, revision: 2 });
    assert.equal(h.api.elements.startPanel.hidden, true);
    assert.equal(h.api.elements.usageInput.value, "Keep this draft");
    assert.equal(h.api.elements.resetEffort.disabled, false);
    assert.match(h.api.elements.effortMessage.textContent, /termination could not be confirmed/);
    assert.equal(h.api.elements.effortMessage.dataset.status, "error");
});

test("reset does not claim success without a new empty generation", async () => {
    const h = await rendererHarness();
    const value = state("requirements");
    h.api.renderIfChanged(value);
    h.setFetch(async () => response(value));
    await h.api.elements.resetEffort.emit("click");
    assert.match(h.api.elements.effortMessage.textContent, /has not been confirmed/);
    assert.equal(h.api.elements.effortMessage.dataset.status, "error");
});

test("a persisted reset barrier blocks normal actions after reload but leaves Reset retry available", async () => {
    const h = await rendererHarness();
    const value = { ...state("requirements"), effortReset: {
        requestId: "reset-request", generation: "fixture-generation", error: "Worker termination is unconfirmed.",
    } };
    h.api.renderIfChanged(value);
    assert.equal(h.api.elements.workspace.inert, true);
    assert.equal(h.api.elements.resetEffort.disabled, false);
    assert.equal(h.api.elements.nextActionBar.hidden, true);
    assert.match(h.api.elements.effortMessage.textContent, /termination is unconfirmed/);
    h.api.elements.usageInput.value = "Should not submit";
    await h.api.elements.usageForm.emit("submit");
    assert.equal(h.requests.length, 0);
    h.api.renderIfChanged({ ...value, revision: 2, effortReset: { ...value.effortReset, error: "" } });
    assert.equal(h.api.elements.resetEffort.disabled, false);
    assert.match(h.api.elements.effortMessage.textContent, /Reset is pending/);
    h.setFetch(async () => response(blankEffort(4, "after-retry")));
    await h.api.elements.resetEffort.emit("click");
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].body.expectedRevision, 2);
    assert.equal(h.api.elements.startPanel.hidden, false);
    assert.equal(h.api.elements.startGoal.disabled, false);
});

test("process setting drafts survive updates and stale-save errors", async () => {
    const h = await rendererHarness();
    const value = { ...state(), process: processFixture() };
    h.api.renderIfChanged(value);
    h.api.elements.handoffAdapter.value = "github";
    await h.api.elements.handoffAdapter.emit("change");
    h.api.elements.processRepository.value = "owner/repo";
    await h.api.elements.processRepository.emit("input");
    h.api.renderIfChanged({ ...value, revision: 2 });
    assert.equal(h.api.elements.handoffAdapter.value, "github");
    h.setFetch(async () => response({ error: "The effort changed. Review and retry." }, 409));
    await h.api.elements.saveProcess.emit("click");
    assert.equal(h.requests[0].body.expectedRevision, 1);
    assert.equal(h.requests[0].body.settings.adapters.status, "local");
    assert.match(h.api.elements.processMessage.textContent, /effort changed/);
    assert.equal(h.api.elements.processRepository.value, "owner/repo");
    await h.api.elements.resetProcess.emit("click");
    assert.equal(h.api.elements.handoffAdapter.value, "local");
});

test("handoff export uses only the current completed stage acceptance", async () => {
    const h = await rendererHarness();
    const value = { ...state("implement"), process: processFixture() };
    value.lifecycle.outputs = [{ stageId: "plan", path: ".tandem\\plan-r2.json" }];
    (value.process.acceptances as any[]).push({
        id: "old", stageId: "plan", snapshotPath: ".tandem\\plan-r1.json", acceptedBy: { label: "Owner" }, acceptedAt: "earlier",
    });
    h.api.renderIfChanged(value);
    assert.equal(h.api.elements.exportHandoff.disabled, true);
    (value.process.acceptances as any[]).push({
        id: "current", stageId: "plan", snapshotPath: ".tandem\\plan-r2.json", acceptedBy: { label: "Owner" }, acceptedAt: "now",
    });
    h.api.renderIfChanged({ ...value, revision: 2 });
    assert.equal(h.api.elements.exportHandoff.disabled, false);
    h.setConfirm(false);
    await h.api.elements.exportHandoff.emit("click");
    assert.equal(h.requests.length, 0);
    h.setConfirm(true);
    h.setFetch(async () => response({ ...value, revision: 3 }));
    await h.api.elements.exportHandoff.emit("click");
    assert.equal(h.requests[0].body.acceptanceId, "current");
});

test("a pending process mutation blocks stage completion and preserves new drafts", async () => {
    const h = await rendererHarness();
    const value = { ...state("prototype"), process: processFixture() };
    value.previewStatus = "ready";
    value.prototypeReview.designSpecArtifactId = "draft-feature-spec";
    h.api.renderIfChanged(value);
    let release!: (value: unknown) => void;
    h.setFetch(() => new Promise((resolve) => { release = resolve; }));
    const submission = h.api.elements.saveProcess.emit("click");
    await h.flush();
    await h.api.elements.completeStage.emit("click");
    assert.equal(h.requests.length, 1);
    h.api.elements.verificationChecks.value = "[unfinished";
    await h.api.elements.verificationChecks.emit("input");
    release(response({ ...value, revision: 2 }));
    await submission;
    assert.equal(h.api.elements.verificationChecks.value, "[unfinished");
});

test("publication is explicit and adapter receipts remain visible after switching", async () => {
    const h = await rendererHarness();
    const value = { ...state("test"), process: processFixture() };
    (value.process.receipts as any[]).push({
        id: "receipt", adapter: "local", block: "handoff", recordedAt: "now", reference: "tandem-records\\delivery\\local", summary: "Not published",
    });
    value.process.settings.adapters.handoff = "github";
    h.api.renderIfChanged(value);
    assert.match(h.api.elements.processReceipts.textContent, /local \/ handoff/);
    h.setConfirm(false);
    await h.api.elements.publishDelivery.emit("click");
    assert.equal(h.requests.length, 0);
});

test("requirements remain answerable and selectable without Mermaid", async () => {
    const h = await rendererHarness();
    h.api.setMermaid(async () => { throw new Error("CDN unavailable"); });
    const value = state();
    value.requirements.substage = "dag";
    value.decisionGraph.nodes = [decision("active"), decision("previous", "answered"), decision("future", "toAnswer")];
    h.api.render(value);
    assert.ok(h.api.elements.questionHost.querySelector("textarea"), "question renders before the diagram promise");
    await h.flush();
    const buttons = h.api.elements.decisionList.querySelectorAll("button");
    assert.equal(buttons.length, 3);
    assert.equal(buttons[2].disabled, true);
    await buttons[1].emit("click");
    assert.match(h.api.elements.questionHost.textContent, /Previous answer/);
    assert.equal(h.api.elements.decisionList.hidden, false);
});

test("a rejected DAG stops showing generation, keeps usages, and exposes a retry", async () => {
    const h = await rendererHarness();
    const value = state();
    value.requirements.usageItems = ["I want to explore a model."];
    value.processing = { action: "generate-dag", requestId: "dag-request", status: "running" };
    h.api.renderIfChanged(value);
    assert.equal(h.api.elements.generateDag.textContent, "Generating DAG...");
    assert.equal(h.api.elements.generateDag.disabled, true);
    const failed = { ...value, revision: 2, processing: { ...value.processing, status: "error",
        message: "New requirements must be answered by the user, not by the worker." } };
    h.api.renderIfChanged(failed);
    assert.equal(h.api.elements.generateDag.textContent, "Retry requirements DAG");
    assert.equal(h.api.elements.generateDag.disabled, false);
    assert.equal(h.api.elements.usageIntake.hidden, false);
    assert.equal(h.api.elements.dagSubstage.dataset.status, "locked");
    assert.equal(h.api.elements.designTreeCard.hidden, true);
    assert.match(h.api.elements.usageItems.textContent, /explore a model/);
    assert.match(h.api.elements.usageMessage.textContent, /answered by the user/);
    assert.equal(h.api.elements.usageMessage.dataset.status, "error");
    assert.match(h.api.elements.nextActionGuide.textContent, /Retry the requirements DAG/);
    h.api.render({ ...failed, revision: 3 }, true);
    assert.match(h.api.elements.usageMessage.textContent, /Your usages are saved/);
    h.setFetch(async () => response({ ...value, revision: 4 }));
    await h.api.elements.generateDag.emit("click");
    await h.flush();
    assert.equal(h.requests[0].path, "/api/answer");
    assert.equal(h.requests[0].body.action, "generate-dag");
    assert.equal(h.api.elements.generateDag.textContent, "Generating DAG...");
});

test("an accepted DAG opens Requirements and focuses its first decision exactly once without Mermaid", async () => {
    const h = await rendererHarness();
    h.api.setMermaid(async () => { throw new Error("Diagram unavailable"); });
    h.setNarrowViewport(true);
    const value = state();
    value.requirements.usageItems = ["I want to explore a model."];
    value.processing = { action: "generate-dag", status: "running", requestId: "dag-request" };
    h.api.renderIfChanged(value);
    h.api.browseStage("prepare");
    await h.api.elements.contextToggle.emit("click");
    const ready = { ...value, revision: 2,
        requirements: { ...value.requirements, substage: "dag" },
        processing: { ...value.processing, status: "success" },
        decisionGraph: { nodes: [decision("first"), decision("next", "toAnswer")] } };
    h.api.renderIfChanged(ready);
    assert.equal(h.api.elements.designTreePanel.hidden, false);
    assert.equal(h.api.elements.preparationPanel.hidden, true);
    assert.equal(h.api.elements.usageIntake.hidden, true);
    assert.equal(h.api.elements.usageSubstage.dataset.status, "complete");
    assert.equal(h.api.elements.dagSubstage.dataset.status, "active");
    assert.equal(h.api.elements.designTreeCard.hidden, false);
    assert.equal(h.api.elements.contextToggle.getAttribute("aria-expanded"), "false");
    assert.equal(h.document.activeElement, h.api.elements.questionHost.querySelector("input:checked"));
    await h.flush();
    assert.equal(h.document.activeElement, h.api.elements.questionHost.querySelector("input:checked"));
    const detail = h.api.elements.questionHost.querySelector("textarea");
    detail.value = "My own decision";
    await detail.emit("input");
    detail.focus();
    detail.setSelectionRange(2, 5);
    h.api.renderIfChanged({ ...ready, revision: 3 });
    assert.equal(h.document.activeElement, detail);
    assert.equal(detail.selectionStart, 2);
    h.api.browseStage("prepare");
    h.api.renderIfChanged({ ...ready, revision: 4 });
    assert.equal(h.api.elements.preparationPanel.hidden, false, "later polling must not pull the user back");
    assert.equal(h.requests.length, 0, "focus does not submit the recommended answer");
});

test("DAG focus waits for a pending submit to settle and never carries across effort identities", async () => {
    const h = await rendererHarness();
    const value = state();
    h.api.render(value);
    h.api.setPending(true);
    const ready = { ...value, revision: 2, requirements: { ...value.requirements, substage: "dag" },
        decisionGraph: { nodes: [decision("first")] } };
    h.api.render(ready);
    h.api.setPending(false);
    h.api.render(ready, true);
    assert.equal(h.document.activeElement, h.api.elements.questionHost.querySelector("input:checked"));
    h.api.render({ ...value, revision: 3 });
    h.api.browseStage("prepare");
    h.api.render({ ...ready, revision: 4, generation: "another-effort" });
    assert.equal(h.api.elements.preparationPanel.hidden, false);
});

test("snapshots reject older revisions and late equal-revision runtime/provider responses", async () => {
    const h = await rendererHarness();
    const newer = state("design", 3);
    h.api.renderIfChanged(newer, 10);
    assert.equal(h.api.renderIfChanged(state("prototype", 2), 11), false);
    assert.equal(h.api.current().lifecycle.currentStage, "design");
    h.api.renderIfChanged({ ...newer, provider: { ...newer.provider, canReload: true }, implementationRuntime: { liveAgentCount: 2 } }, 20);
    h.api.renderIfChanged({ ...newer, provider: { ...newer.provider, canReload: false }, implementationRuntime: { liveAgentCount: 1 } }, 19);
    assert.equal(h.api.current().provider.canReload, true);
    assert.equal(h.api.current().implementationRuntime.liveAgentCount, 2);
    assert.equal(h.api.elements.reloadButton.disabled, false, "provider-only changes are rendered");
    h.api.renderIfChanged({ ...newer, revision: 4, provider: undefined }, 21);
    assert.equal(h.api.current().implementationRuntime.liveAgentCount, 2, "missing telemetry is not an instruction to erase it");
});

test("legacy snapshots use revision zero and cannot replace revisioned state", async () => {
    const h = await rendererHarness();
    const legacy = state();
    delete legacy.revision;
    h.api.renderIfChanged(legacy);
    assert.equal(h.api.current().revision, 0);
    h.api.renderIfChanged(state("prototype", 1));
    h.api.renderIfChanged({ ...legacy, updatedAt: "2030-01-01T00:00:00Z" });
    assert.equal(h.api.current().revision, 1);
});

test("an in-flight poll cannot roll back an SSE snapshot and only one poll runs at a time", async () => {
    const h = await rendererHarness();
    let resolve!: (value: any) => void;
    h.setFetch(() => new Promise((done) => { resolve = done; }));
    h.api.renderIfChanged(state("requirements", 1));
    const poll = h.api.refreshSharedState();
    assert.equal(h.api.refreshSharedState(), poll);
    h.api.renderIfChanged(state("prototype", 2));
    resolve(response(state("requirements", 1)));
    await poll;
    assert.equal(h.api.current().revision, 2);
    assert.equal(h.requests.length, 1);
});

test("an accepted mutation waits for a poll started after the mutation, not an older in-flight read", async () => {
    const h = await rendererHarness();
    const value = state();
    h.api.renderIfChanged(value);
    let resolveOld!: (value: any) => void;
    let reads = 0;
    h.setFetch(async (path) => {
        if (path === "/api/answer") return response({ accepted: true }, 202);
        if (++reads === 1) return new Promise((resolve) => { resolveOld = resolve; });
        return response({ ...value, revision: 2 });
    });
    const old = h.api.refreshSharedState();
    const mutation = h.api.postJson("/api/answer", { answer: "accepted" });
    await h.flush();
    resolveOld(response(value));
    await Promise.all([old, mutation]);
    assert.equal(reads, 2);
    assert.equal(h.api.current().revision, 2);
});

test("unrelated state updates retain decision text, radio selection, focus and caret", async () => {
    const h = await rendererHarness();
    h.api.setMermaid(async () => { throw new Error("offline"); });
    const value = state();
    value.requirements.substage = "dag";
    value.decisionGraph.nodes = [decision("q")];
    h.api.renderIfChanged(value);
    const input = h.api.elements.questionHost.querySelector("textarea");
    input.value = "My unsent answer";
    await input.emit("input");
    input.focus(); input.setSelectionRange(3, 7);
    h.api.renderIfChanged({ ...value, revision: 2, status: "Unrelated artifact update" });
    const after = h.api.elements.questionHost.querySelector("textarea");
    assert.equal(after.value, "My unsent answer");
    assert.equal(h.document.activeElement, after);
    assert.equal(after.selectionStart, 3);
    assert.equal(after.selectionEnd, 7);
    assert.equal(h.api.elements.questionHost.querySelector('input[name="prototype-choice"]:checked'), null);
    const radio = h.api.elements.questionHost.querySelectorAll("input")[1];
    radio.checked = true; await radio.emit("change");
    h.api.renderIfChanged({ ...value, revision: 3 });
    assert.equal(h.api.elements.questionHost.querySelector('input[name="prototype-choice"]:checked').value, "B");
});

test("failed clarification retains its draft and choice; unrelated renders do not clear pending", async () => {
    const h = await rendererHarness();
    const value = state("prototype");
    value.previewStatus = "ready";
    value.previewUrl = "http://127.0.0.1:9999";
    value.prototypeReview.question = decision("clarify").question;
    h.api.render(value);
    const input = h.api.elements.revisionQuestionDetail;
    input.value = "A precise clarification"; await input.emit("input");
    h.api.setPending(true);
    h.api.render({ ...value, revision: 2 });
    assert.equal(h.api.pending(), true);
    assert.equal(input.value, "A precise clarification");
    h.api.setPending(false); h.api.render(value);
    h.setFetch(async () => response({ error: "Please retry" }, 503));
    await h.api.elements.revisionQuestionForm.emit("submit");
    assert.equal(input.value, "A precise clarification");
    assert.match(h.api.elements.revisionStatus.textContent, /Please retry/);
    assert.equal(h.api.pending(), false);
});

test("whole-graph defaults freeze all choices in one request and never chain new recommendations", async () => {
    const h = await rendererHarness();
    h.api.setMermaid(async () => { throw new Error("offline"); });
    const value = state();
    value.requirements.substage = "dag";
    value.decisionGraph.nodes = [decision("first"), { ...decision("second", "toAnswer"), dependencies: ["first"] }];
    for (const node of value.decisionGraph.nodes) node.question.choices.push("C");
    h.api.renderIfChanged(value);
    let resolveFirst!: (value: any) => void;
    h.setFetch(async () => {
        return new Promise((resolve) => { resolveFirst = resolve; });
    });
    const button = h.api.elements.questionHost.querySelector(".all-recommended");
    assert.match(button.textContent, /whole-graph defaults/);
    assert.match(button.title, /ALL unanswered decisions/);
    await button.emit("click");
    await button.emit("click");
    h.api.renderIfChanged({ ...value, revision: 2, status: "Unrelated notification" });
    assert.equal(h.api.pending(), true);
    assert.equal(h.requests.length, 1);
    assert.match(h.confirmations[0], /first: A\nsecond: A/);
    resolveFirst(response({
        ...value, revision: 3,
        processing: { status: "running", action: "apply-defaults", question: { id: "whole-graph-defaults" } },
    }));
    await h.flush();
    assert.equal(h.requests.length, 1);
    h.api.renderIfChanged({
        ...value, revision: 4,
        decisionGraph: { nodes: [decision("first", "answered"), decision("second")] },
    });

    await h.flush();
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].body.action, "apply-defaults");
    assert.equal(h.requests[0].body.expectedRevision, 1);
    assert.equal(h.requests[0].body.generation, "fixture-generation");
    assert.deepEqual(h.requests[0].body.defaults, [
        { nodeId: "first", answer: value.decisionGraph.nodes[0].question.recommended },
        { nodeId: "second", answer: value.decisionGraph.nodes[1].question.recommended },
    ]);
    assert.equal(h.api.pending(), false);
});

test("whole-graph defaults require confirmation and curated recommendations on downstream nodes", async () => {
    const h = await rendererHarness();
    const value = state();
    value.requirements.substage = "dag";
    value.decisionGraph.nodes = [decision("first"), decision("second", "toAnswer")];
    value.decisionGraph.nodes[0].question.choices.push("C");
    h.api.renderIfChanged(value);
    await h.api.elements.questionHost.querySelector(".all-recommended").emit("click");
    assert.equal(h.requests.length, 0);
    assert.match(h.api.elements.designTreeStatus.textContent, /second.*no curated recommended/);
    value.decisionGraph.nodes[1].question.choices.push("C");
    h.api.renderIfChanged({ ...value, revision: 2 });
    h.setConfirm(false);
    await h.api.elements.questionHost.querySelector(".all-recommended").emit("click");
    assert.equal(h.requests.length, 0);
    assert.match(h.confirmations[0], /ALL 2 unanswered/);
    assert.equal(h.api.pending(), false);
});

test("a single default answer does not consent to whole-graph defaults", async () => {
    const h = await rendererHarness();
    const value = state();
    value.requirements.substage = "dag";
    value.decisionGraph.nodes = [decision("first"), decision("second", "toAnswer")];
    h.api.renderIfChanged(value);
    h.setFetch(async () => response({ ...value, revision: 2, processing: { status: "running", action: "answer-decision" } }));
    await h.api.elements.questionHost.querySelector("form").emit("submit");
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].body.action, "answer-decision");
    assert.equal(h.requests[0].body.questionId, "first");
    assert.equal(h.requests[0].body.defaults, undefined);
});

test("failed whole-graph defaults retry their saved request and show unresolved review evidence after reload", async () => {
    const h = await rendererHarness();
    const value = state();
    value.requirements.substage = "dag";
    value.decisionGraph.nodes = [decision("first"), decision("second", "toAnswer")];
    value.processing = { status: "error", action: "apply-defaults", requestId: "saved-batch", message: "Semantic worker failed" };
    h.api.renderIfChanged(value);
    assert.match(h.api.elements.questionHost.textContent, /Semantic worker failed/);
    const retry = h.api.elements.questionHost.querySelector(".all-recommended");
    assert.equal(retry.textContent, "Retry whole-graph defaults");
    h.setFetch(async () => response({ ...value, revision: 2, processing: { status: "running", action: "apply-defaults" } }));
    await retry.emit("click");
    await h.flush();
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].body.retryRequestId, "saved-batch");
    assert.equal(h.requests[0].body.defaults, undefined);
    h.api.renderIfChanged({ ...value, revision: 3, processing: { status: "success", action: "apply-defaults" },
        decisionGraph: { nodes: [{ ...decision("first"), review: { reason: "Incompatible choices", previousAnswer: "Old recommendation" } },
            decision("second", "toAnswer")] } });
    assert.match(h.api.elements.questionHost.textContent, /Review required: Incompatible choices/);
    assert.match(h.api.elements.questionHost.textContent, /Previously selected: Old recommendation/);
    assert.equal(h.requests.length, 1);
});

test("replacing a failed batch requires confirmation of the current whole-graph choices", async () => {
    const h = await rendererHarness();
    const value = state();
    value.requirements.substage = "dag";
    value.decisionGraph.nodes = [decision("first"), decision("second", "toAnswer")];
    for (const node of value.decisionGraph.nodes) node.question.choices.push("C");
    value.processing = { action: "apply-defaults", status: "error", requestId: "old", message: "Inputs changed" };
    h.api.renderIfChanged(value);
    h.setConfirm(false);
    await h.api.elements.questionHost.querySelector(".review-current-defaults").emit("click");
    assert.equal(h.requests.length, 0);
    h.setConfirm(true);
    h.setFetch(async () => response({ ...value, revision: 2, processing: { status: "running", action: "apply-defaults" } }));
    await h.api.elements.questionHost.querySelector(".review-current-defaults").emit("click");
    await h.flush();
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].body.retryRequestId, undefined);
    assert.equal(h.requests[0].body.defaults.length, 2);
});

test("review-only terminal snapshots refresh an unchanged question even when running updates were missed", async () => {
    const h = await rendererHarness();
    const value = state();
    value.requirements.substage = "dag";
    value.processing = { status: "success", action: "apply-defaults" };
    value.decisionGraph.nodes = [decision("first"), decision("second", "toAnswer")];
    h.api.renderIfChanged(value);
    assert.doesNotMatch(h.api.elements.questionHost.textContent, /Review required:/);
    for (const [index, review] of [
        { reason: "Incompatible choices", previousAnswer: "Old recommendation" },
        { reason: "Changed compatibility constraint", previousAnswer: "Another selection" },
        null,
    ].entries()) {
        h.api.renderIfChanged({ ...value, revision: index + 2,
            decisionGraph: { nodes: [{ ...value.decisionGraph.nodes[0], review }, value.decisionGraph.nodes[1]] } });
        const text = h.api.elements.questionHost.textContent;
        if (review) {
            assert.ok(text.includes(`Review required: ${review.reason}`));
            assert.ok(text.includes(`Previously selected: ${review.previousAnswer}`));
        } else {
            assert.doesNotMatch(text, /Review required:|Previously selected:/);
        }
        if (index > 0) assert.doesNotMatch(text, /Old recommendation/);
    }
    assert.equal(h.requests.length, 0);
});

test("stage finalization cannot overtake an in-flight review submission", async () => {
    const h = await rendererHarness();
    const value = state("design");
    value.artifacts = [{ id: "design", title: "Design", stage: "design", content: "Spec", mermaid: "" }];
    h.api.render(value);
    let resolve!: (value: any) => void;
    h.setFetch(() => new Promise((done) => { resolve = done; }));
    h.api.elements.designReviewInput.value = "Review this behavior";
    const request = h.api.elements.designReviewForm.emit("submit");
    await h.flush();
    await h.api.elements.finishReview.emit("click");
    assert.equal(h.requests.length, 1);
    resolve(response({ ...value, revision: 2 }));
    await request;
    assert.equal(h.api.pending(), false);
});

test("Test design explains automatic drafts and gates finalization until review is resolved", async () => {
    const h = await rendererHarness();
    const value = state("design");
    value.design.substage = "test";
    value.designReview.finalizedArtifactId = "design-spec";
    h.api.render(value);
    assert.match(h.api.elements.designReviewThreads.textContent, /Preparing integration and interaction test-design drafts/);
    assert.match(h.api.elements.designReviewStageStatus.textContent, /automatically before finalization/);
    assert.equal(h.api.elements.finishReview.disabled, true);
    await h.api.elements.finishReview.emit("click");
    assert.equal(h.requests.length, 0);
    value.testDesignReview.threads = [{
        id: "default-project-integration-tests", type: "artifact", artifactKind: "test-scenario",
        prompt: "Generate integration drafts", status: "queued", artifactIds: [],
    }];
    h.api.render(value);
    assert.match(h.api.elements.designReviewStageStatus.textContent, /Generating design artifacts/);
    assert.equal(h.api.elements.finishReview.disabled, true);
    value.testDesignReview.threads[0].status = "answered";
    value.testDesignReview.threads[0].artifactIds = ["integration-draft"];
    value.artifacts = [{
        id: "integration-draft", title: "Integration test draft", stage: "design",
        kind: "test-scenario", content: "Reviewable integration scenarios", mermaid: "",
        sourceThreadIds: ["default-project-integration-tests"], reviewStatus: "current",
    }];
    h.api.render(value);
    assert.match(h.api.elements.designReviewStageStatus.textContent, /Open each generated artifact/);
    assert.equal(h.api.elements.finishReview.disabled, true);
    await h.api.elements.designReviewThreads.querySelector(".review-artifact-link").emit("click");
    assert.equal(h.api.elements.contentPanel.hidden, false);
    assert.equal(h.api.elements.artifactHeading.textContent, "Integration test draft");
    assert.equal(h.api.elements.designReviewForm.hidden, false);
    assert.equal(h.api.elements.artifactReviewThreads.querySelector('[data-thread-action="resolve"]').textContent, "Mark resolved");
    value.testDesignReview.threads[0].status = "resolved";
    h.api.render(value);
    assert.equal(h.api.elements.finishReview.disabled, false);
    assert.equal(h.api.elements.finishReview.textContent, "Finish test design");
    h.setFetch(async () => response({ ...value, revision: 2 }));
    h.api.elements.designReviewInput.value = "Also cover invalid requests";
    h.api.elements.reviewRequestKind.value = "test-scenario";
    await h.api.elements.designReviewForm.emit("submit");
    assert.equal(h.requests[0].path, "/api/design-review");
    assert.equal(h.requests[0].body.artifactId, "integration-draft");
    assert.equal(h.requests[0].body.artifactKind, "test-scenario");
});

test("failed usage and plan submissions retain their inputs and show initial plan errors", async () => {
    const h = await rendererHarness();
    h.api.render(state());
    h.setFetch(async () => response({ error: "Rejected" }, 503));
    h.api.elements.usageInput.value = "Use the app offline";
    await h.api.elements.usageForm.emit("submit");
    assert.equal(h.api.elements.usageInput.value, "Use the app offline");
    h.api.render(state("plan"));
    h.api.elements.planRevisionInput.value = "Preserve this plan instruction";
    await h.api.elements.planRevisionForm.emit("submit");
    assert.equal(h.api.elements.planRevisionInput.value, "Preserve this plan instruction");
    assert.match(h.api.elements.planStatus.textContent, /Rejected/);
    assert.equal(h.api.elements.planStatus.closest("[hidden]"), null);
});

test("successful submissions clear only the accepted input, not a replacement draft", async () => {
    const h = await rendererHarness();
    const value = state();
    h.api.render(value);
    let resolve!: (value: any) => void;
    h.setFetch(() => new Promise((done) => { resolve = done; }));
    h.api.elements.usageInput.value = "First usage";
    const send = h.api.elements.usageForm.emit("submit");
    await h.flush();
    h.api.elements.usageInput.value = "Replacement usage";
    await h.api.elements.usageInput.emit("input");
    resolve(response({ ...value, revision: 2, requirements: { ...value.requirements, usageItems: ["First usage"] } }));
    await send;
    assert.equal(h.api.elements.usageInput.value, "Replacement usage");
    h.setFetch(async () => response({ ...value, revision: 3 }));
    await h.api.elements.usageForm.emit("submit");
    assert.equal(h.api.elements.usageInput.value, "");
});

test("artifact composers are scoped to artifact identity and preserve selections", async () => {
    const h = await rendererHarness();
    const value = state("design");
    value.artifacts = ["a", "b"].map((id) => ({ id, title: id, stage: "design", content: "Spec", mermaid: "" }));
    h.api.render(value);
    h.api.elements.designReviewInput.value = "Question about A";
    await h.api.elements.designReviewInput.emit("input");
    await h.api.elements.artifactList.querySelectorAll("button")[1].emit("click");
    assert.equal(h.api.elements.designReviewInput.value, "");
    h.api.elements.designReviewInput.value = "Question about B";
    await h.api.elements.designReviewInput.emit("input");
    h.api.render({ ...value, revision: 2, status: "Updated elsewhere" });
    assert.equal(h.api.elements.artifactHeading.textContent, "b");
    await h.api.elements.artifactList.querySelectorAll("button")[0].emit("click");
    assert.equal(h.api.elements.designReviewInput.value, "Question about A");
});

test("draft agent limit survives blur and design finalization errors are visible in its stage", async () => {
    const h = await rendererHarness();
    const value = state("plan");
    h.api.render(value);
    h.api.elements.planMaxAgents.value = "9";
    await h.api.elements.planMaxAgents.emit("input");
    h.api.elements.planRevisionInput.focus();
    h.api.render({ ...value, revision: 2, status: "Refreshed" });
    assert.equal(h.api.elements.planMaxAgents.value, "9");
    const design = state("design", 3);
    h.api.render(design);
    h.setFetch(async () => response({ error: "Could not capture specification" }, 503));
    await h.api.elements.finishReview.emit("click");
    assert.match(h.api.elements.designReviewStageStatus.textContent, /Could not capture specification/);
    assert.equal(h.api.elements.designReviewStageStatus.closest("[hidden]"), null);
});

test("runtime-only updates preserve expanded evidence and focused summaries", async () => {
    const h = await rendererHarness();
    const value = state("implement");
    value.planning.workItems = [{ id: "done", title: "Completed work" }];
    value.implementation = { status: "running", workItems: [{ id: "done", status: "completed", summary: "Evidence" }] };
    h.api.renderIfChanged(value);
    const card = h.api.elements.implementationWorkItems.children[0];
    card.open = true; card.children[0].focus();
    h.api.renderIfChanged({ ...value, implementationRuntime: { liveAgentCount: 0, progress: [{ seq: 1, text: "Another task updated" }] } });
    const after = h.api.elements.implementationWorkItems.children[0];
    assert.equal(after.open, true);
    assert.equal(h.document.activeElement, after.children[0]);
    assert.match(h.api.elements.implementationProgress.textContent, /0 live agents/);
    const testState = state("test", 2);
    testState.testDesignReview.scenarios = [{ id: "passed", title: "Passed scenario" }];
    testState.testing = { status: "running", scenarios: [{ id: "passed", status: "passed" }] };
    h.api.renderIfChanged(testState);
    h.api.elements.testScenarios.children[0].open = true;
    h.api.renderIfChanged({ ...testState, testRuntime: { liveAgentCount: 1 } });
    assert.equal(h.api.elements.testScenarios.children[0].open, true);
});

test("diagram redraws preserve zoom and unrelated updates reuse the diagram", async () => {
    const h = await rendererHarness();
    let renders = 0;
    h.api.setMermaid(async () => ({
        render: async () => { renders++; return { svg: '<svg viewBox="0 0 800 300"><rect /></svg>' }; },
    }));
    const value = state("plan");
    value.planning.workItems = [{ id: "work", title: "Build" }];
    h.api.render(value); await h.flush();
    h.api.setDiagramScale(h.api.elements.planDag, 2);
    const before = renders;
    h.api.render({ ...value, revision: 2, status: "Unrelated" }); await h.flush();
    assert.equal(renders, before);
    assert.equal(h.api.elements.planDag.querySelector("svg").style.width, "1600px");
    h.api.render({ ...value, revision: 3, planning: { ...value.planning, workItems: [{ id: "work", title: "Changed title" }] } });
    await h.flush();
    assert.equal(h.api.elements.planDag.querySelector("svg").style.width, "1600px");
});

test("prototype waits honestly, starts explicitly, and reports actual progress plus elapsed time", async () => {
    const h = await rendererHarness();
    const value = state("prototype");
    value.phase = "building";
    h.api.render(value);
    assert.equal(h.api.elements.prototypeBuilding.hidden, true);
    assert.equal(h.api.elements.startPrototype.hidden, false);
    const running = { ...value, revision: 2, previewStatus: "starting", processing: {
        action: "build-prototype", status: "running", message: "Installing app dependencies", requestedAt: new Date(Date.now() - 5000).toISOString(),
    } };
    h.setFetch(async () => response(running));
    await h.api.elements.startPrototype.emit("click");
    assert.equal(h.requests[0].path, "/api/prototype/start");
    assert.equal(h.api.elements.prototypeBuilding.hidden, false);
    assert.equal(h.api.elements.prototypeBuildingMessage.textContent, "Installing app dependencies");
    for (const timer of h.timers) timer();
    assert.equal(h.api.elements.prototypeBuildingMessage.textContent, "Installing app dependencies");
    assert.match(h.api.elements.prototypeBuildingElapsed.textContent, /Elapsed:/);
    h.api.renderIfChanged({ ...value, revision: 3, previewStatus: "error", processing: { action: "build-prototype", status: "error", message: "Build failed" } });
    assert.equal(h.api.elements.startPrototype.textContent, "Retry prototype build");
    assert.match(h.api.elements.prototypeBuildStatus.textContent, /Build failed/);
});

test("progressive Prototype shows honest milestones and retains the working iframe while updates build", async () => {
    const h = await rendererHarness();
    const first = progressivePrototype();
    first.previewUrl = null;
    first.previewStatus = "starting";
    first.prototypeFlow.checkpoints = [checkpoint("first", "structure", "running")];
    first.prototypeFlow.displayedCheckpointId = null;
    first.prototypeFlow.activeCheckpointId = "first";
    h.api.renderIfChanged(first);
    assert.equal(h.api.elements.prototypeProgress.hidden, false);
    assert.match(h.api.elements.prototypeMilestones.textContent, /StructureBuildingInteractionWaitingVisual directionOptional/);
    assert.match(h.api.elements.prototypeProgressMessage.textContent, /No preview is available yet/);
    assert.equal(h.api.elements.previewFrame.style.display, "none");
    assert.equal(h.api.elements.revisionInput.disabled, false);
    assert.equal(h.api.elements.submitRevision.disabled, false);
    const value = progressivePrototype(2);
    h.api.renderIfChanged(value);
    const frame = h.api.elements.previewFrame;
    assert.equal(frame.style.display, "block");
    assert.equal(frame.src, value.previewUrl);
    assert.equal(h.api.elements.prototypeBuilding.hidden, false);
    assert.equal(h.api.elements.prototypeBuildingTitle.textContent, "Building Interaction");
    assert.match(h.api.elements.prototypeBudget.textContent, /used or reserved for active work/);
    assert.equal(h.api.elements.prototypeMilestones.querySelector('[aria-current="step"]').dataset.milestone, "interaction");
    h.api.elements.revisionInput.value = "Keep this draft";
    await h.api.elements.revisionInput.emit("input");
    h.api.elements.revisionInput.focus();
    h.api.elements.revisionInput.setSelectionRange(2, 5);
    h.api.renderIfChanged({ ...value, revision: 3, status: "Verifying the update" });
    assert.equal(frame.navigations.length, 1);
    assert.equal(h.api.elements.revisionInput.value, "Keep this draft");
    assert.equal(h.api.elements.revisionInput.selectionStart, 2);
    h.api.renderIfChanged(readyPrototype(4, true));
    assert.equal(frame.navigations.length, 1, "a validated candidate must not automatically replace the displayed preview");
    assert.match(h.api.elements.prototypeProgressMessage.textContent, /Update ready/);
    assert.equal(h.api.elements.applyPrototypeUpdate.hidden, false);
    assert.equal(h.api.elements.applyPrototypeUpdate.disabled, false);
    assert.equal(h.api.elements.requestPrototypeVisual.hidden, true);
    assert.equal(h.api.elements.completeStage.disabled, true);
});

test("compact prototype layout is scoped to the preview and preserves expanded details and drafts", async () => {
    const h = await rendererHarness();
    const value = progressivePrototype();
    value.prototypeReview.revisions = [{ id: "queued", suggestion: "Keep the camera position.", status: "queued" }];
    h.api.renderIfChanged(value);
    assert.equal(h.document.body.classList.contains("prototype-view"), true);
    assert.equal(h.api.elements.prototypeProgressDetails.open, false);
    assert.equal(h.api.elements.revisionHistoryDetails.open, false);
    assert.equal(h.api.elements.revisionHistoryDetails.hidden, false);
    assert.match(h.api.elements.revisionQueueSummary.textContent, /1 queued/);
    assert.equal(h.api.elements.requestPrototypeVisual.hidden, true);
    assert.equal(h.api.elements.prototypeProgressMessage.dataset.essential, "false");
    assert.equal(h.api.elements.revisionStatus.dataset.essential, "false");
    assert.equal(h.api.elements.revisionInput.getAttribute("rows"), "1");
    await h.api.elements.revisionForm.emit("submit");
    assert.equal(h.api.elements.revisionStatus.dataset.status, "error");
    assert.equal(h.api.elements.revisionStatus.dataset.essential, "true");
    assert.match(h.api.elements.revisionStatus.textContent, /Enter a revision suggestion/);
    const frame = h.api.elements.previewFrame;
    h.api.elements.prototypeProgressDetails.open = true;
    h.api.elements.revisionHistoryDetails.open = true;
    h.api.elements.revisionInput.value = "Draft stays here.";
    h.api.elements.revisionInput.focus();
    h.api.elements.revisionInput.setSelectionRange(3, 5);
    h.api.renderIfChanged({ ...value, revision: 2, status: "Building the next update" });
    assert.equal(h.api.elements.prototypeProgressDetails.open, true);
    assert.equal(h.api.elements.revisionHistoryDetails.open, true);
    assert.equal(h.api.elements.revisionInput.value, "Draft stays here.");
    assert.equal(h.api.elements.revisionInput.selectionStart, 3);
    assert.equal(frame.navigations.length, 1);
    await h.api.elements.requirementsTab.emit("click");
    assert.equal(h.document.body.classList.contains("prototype-view"), false);
    await h.api.elements.previewTab.emit("click");
    assert.equal(h.document.body.classList.contains("prototype-view"), true);
    assert.equal(h.api.elements.revisionHistoryDetails.open, true);
    assert.equal(frame.navigations.length, 1);
});

test("compact prototype controls never collapse pending updates, failures, or clarifications", async () => {
    const h = await rendererHarness();
    const pending = readyPrototype(1, true);
    h.api.renderIfChanged(pending);
    assert.equal(h.api.elements.applyPrototypeUpdate.hidden, false);
    assert.equal(h.api.elements.prototypeProgressMessage.dataset.essential, "true");
    assert.equal(h.api.elements.prototypeProgressDetails.open, false);
    const failed = progressivePrototype(2);
    failed.prototypeFlow.activeCheckpointId = null;
    failed.prototypeFlow.checkpoints[1].status = "failed";
    failed.prototypeFlow.checkpoints[1].summary = "Build failed; preview retained.";
    h.api.renderIfChanged(failed);
    assert.equal(h.api.elements.retryPrototypeCheckpoint.hidden, false);
    assert.equal(h.api.elements.prototypeProgressMessage.dataset.essential, "true");
    assert.equal(h.api.elements.previewFrame.style.display, "block");
    const clarification = readyPrototype(3);
    clarification.prototypeReview.question = decision("clarify").question;
    h.api.renderIfChanged(clarification);
    assert.equal(h.api.elements.revisionQuestion.hidden, false);
    assert.equal(h.api.elements.revisionStatus.dataset.essential, "true");
    h.api.elements.revisionInput.value = "Keep this failed submission.";
    h.setFetch(async () => response({ error: "Submission was rejected." }, 409));
    await h.api.elements.revisionForm.emit("submit");
    assert.equal(h.api.elements.revisionStatus.dataset.essential, "true");
    assert.equal(h.api.elements.revisionStatus.dataset.status, "error");
    assert.equal(h.api.elements.revisionInput.value, "Keep this failed submission.");
});

test("feedback queues before a preview and during clarification without losing an actively edited draft", async () => {
    const h = await rendererHarness();
    const value = progressivePrototype();
    value.previewUrl = null;
    value.previewStatus = "starting";
    value.prototypeFlow.displayedCheckpointId = null;
    h.api.renderIfChanged(value);
    h.api.elements.revisionInput.value = "Make the primary action obvious";
    await h.api.elements.revisionInput.emit("input");
    let release!: (value: any) => void;
    h.setFetch(() => new Promise((resolve) => { release = resolve; }));
    const request = h.api.elements.revisionForm.emit("submit");
    await h.flush();
    assert.equal(h.requests[0].path, "/api/revision");
    assert.equal(h.requests[0].body.baseCheckpointId, null);
    assert.match(h.requests[0].body.clientRequestId, /^[\da-f-]{36}$/);
    assert.equal(h.api.elements.revisionInput.disabled, false);
    h.api.elements.revisionInput.value = "A second observation";
    await h.api.elements.revisionInput.emit("input");
    const queued = { ...value, revision: 2, prototypeReview: { revisions: [
        { id: "revision-1", suggestion: h.requests[0].body.suggestion, status: "queued" },
    ], question: decision("clarify").question } };
    release(response(queued));
    await request;
    assert.equal(h.api.elements.revisionInput.value, "A second observation");
    assert.equal(h.api.elements.submitRevision.disabled, false);
    assert.match(h.api.elements.revisionHistory.textContent, /Make the primary action obviousQueued/);
    assert.match(h.api.elements.revisionQueueSummary.textContent, /1 queued/);
    h.setFetch(async () => response({ ...queued, revision: 3 }));
    await h.api.elements.revisionForm.emit("submit");
    assert.equal(h.requests.length, 2);
    assert.equal(h.requests[1].body.suggestion, "A second observation");
    assert.notEqual(h.requests[1].body.clientRequestId, h.requests[0].body.clientRequestId);
    assert.equal(h.api.elements.revisionInput.value, "");
});

test("revision transport retries preserve the request id and original base checkpoint", async () => {
    const h = await rendererHarness();
    h.api.renderIfChanged(progressivePrototype());
    h.api.elements.revisionInput.value = "Keep the filter visible";
    await h.api.elements.revisionInput.emit("input");
    h.setFetch(async () => response({ error: "Connection failed; retry the saved draft" }, 503));
    await h.api.elements.revisionForm.emit("submit");
    assert.equal(h.api.elements.revisionInput.value, "Keep the filter visible");
    h.api.renderIfChanged(readyPrototype(2));
    assert.match(h.api.elements.revisionStatus.textContent, /Connection failed/);
    h.setFetch(async () => response(readyPrototype(3)));
    await h.api.elements.revisionForm.emit("submit");
    assert.equal(h.requests[1].body.clientRequestId, h.requests[0].body.clientRequestId);
    assert.equal(h.requests[1].body.baseCheckpointId, "structure", "retry must refer to the preview originally reviewed");
    assert.equal(h.api.elements.revisionInput.value, "");
    h.api.elements.revisionInput.value = "Keep the filter visible";
    await h.api.elements.revisionInput.emit("input");
    await h.api.elements.revisionForm.emit("submit");
    assert.notEqual(h.requests[2].body.clientRequestId, h.requests[0].body.clientRequestId);
    assert.equal(h.requests[2].body.baseCheckpointId, "interaction");
});

test("the revision queue displays unresolved history accurately and never discards a full-queue draft", async () => {
    const h = await rendererHarness();
    const value = readyPrototype();
    value.prototypeReview.revisions = ["queued", "processing", "clarifying", "ready", "applied", "failed"]
        .map((status, index) => ({ id: `r-${index}`, suggestion: `Suggestion ${index}`, status }));
    h.api.renderIfChanged(value);
    assert.equal(h.api.elements.revisionHistory.children.length, 6);
    assert.match(h.api.elements.revisionHistory.textContent, /Building update/);
    assert.match(h.api.elements.revisionHistory.textContent, /Update ready — not applied/);
    assert.match(h.api.elements.revisionHistory.textContent, /Applied/);
    assert.match(h.api.elements.revisionHistory.textContent, /Needs clarification/);
    value.prototypeReview.revisions = Array.from({ length: 50 }, (_, index) => ({
        id: `queued-${index}`, suggestion: `Queued suggestion ${index}`, status: "queued",
    }));
    h.api.renderIfChanged({ ...value, revision: 2 });
    h.api.elements.revisionInput.value = "Never lose this draft";
    assert.equal(h.api.elements.revisionInput.disabled, false);
    assert.equal(h.api.elements.submitRevision.disabled, true);
    assert.equal(h.api.elements.revisionHistory.children.length, 50);
    await h.api.elements.revisionForm.emit("submit");
    assert.equal(h.requests.length, 0);
    assert.equal(h.api.elements.revisionInput.value, "Never lose this draft");
    assert.match(h.api.elements.revisionStatus.textContent, /queue is full/);
    h.api.renderIfChanged({ ...value, revision: 3 });
    assert.match(h.api.elements.revisionStatus.textContent, /queue is full/);
});

test("read-only, final-spec generation and other stages block revision submission but retain editable drafts", async () => {
    const h = await rendererHarness();
    const value = readyPrototype();
    for (const snapshot of [
        { ...value, provider: { canSubmitAnswers: false } },
        { ...value, processing: { action: "generate-design-spec", status: "running" } },
        { ...value, lifecycle: { ...value.lifecycle, currentStage: "design", completedStages: ["prepare", "requirements", "prototype"] } },
    ]) {
        h.api.render(snapshot);
        h.api.elements.revisionInput.value = "Keep the draft";
        assert.equal(h.api.elements.revisionInput.disabled, false);
        assert.equal(h.api.elements.submitRevision.disabled, true);
        if (snapshot.processing?.action === "generate-design-spec") {
            assert.match(h.api.elements.revisionStatus.textContent, /frozen input.*Keep drafting/);
        }
        await h.api.elements.revisionForm.emit("submit");
        assert.equal(h.api.elements.revisionInput.value, "Keep the draft");
    }
    h.api.render({ ...value, effortReset: { requestId: "reset" } });
    await h.api.elements.revisionForm.emit("submit");
    assert.equal(h.requests.length, 0);
    assert.equal(h.api.elements.revisionInput.value, "Keep the draft");
});

test("Finish Prototype requires promoted milestones and resolved feedback, but not optional visual direction", async () => {
    const h = await rendererHarness();
    const value = readyPrototype();
    h.api.render(value);
    assert.equal(h.api.elements.completeStage.disabled, false);
    const snapshots = [
        progressivePrototype(),
        readyPrototype(1, true),
        { ...value, prototypeFlow: { ...value.prototypeFlow, checkpoints: [checkpoint("structure", "structure")] } },
        { ...value, prototypeFlow: { ...value.prototypeFlow, visualRequested: true } },
        { ...value, prototypeReview: { ...value.prototypeReview, question: decision("clarify").question } },
        ...["queued", "processing", "clarifying", "ready", "failed"].map((status) => ({
            ...value, prototypeReview: { revisions: [{ id: status, status, suggestion: status }], question: null },
        })),
    ];
    for (const snapshot of snapshots) {
        h.api.render(snapshot);
        assert.equal(h.api.elements.completeStage.disabled, true, JSON.stringify(snapshot.prototypeReview));
        await h.api.elements.completeStage.emit("click");
    }
    assert.equal(h.requests.length, 0);
    h.api.render({ ...value, prototypeReview: { revisions: [{ id: "done", status: "applied", suggestion: "Done" }], question: null } });
    assert.equal(h.api.elements.completeStage.disabled, false);
    const legacy = state("prototype");
    legacy.previewStatus = "ready";
    legacy.previewUrl = "http://127.0.0.1:9998/";
    h.api.render(legacy);
    assert.equal(h.api.elements.prototypeProgress.hidden, true);
    assert.equal(h.api.elements.completeStage.disabled, false, "legacy ready previews do not acquire new milestone gates");
});

test("visual direction is explicitly optional and failed checkpoint retries preserve the preview", async () => {
    const h = await rendererHarness();
    const value = readyPrototype();
    h.api.renderIfChanged(value);
    assert.equal(h.api.elements.requestPrototypeVisual.hidden, false);
    assert.equal(h.api.elements.requestPrototypeVisual.disabled, false);
    const visual = { ...value, revision: 2, prototypeFlow: { ...value.prototypeFlow, visualRequested: true,
        activeCheckpointId: "visual", checkpoints: [...value.prototypeFlow.checkpoints, checkpoint("visual", "visual", "running")] } };
    h.setFetch(async () => response(visual));
    await h.api.elements.requestPrototypeVisual.emit("click");
    assert.equal(h.requests[0].path, "/api/prototype/action");
    assert.equal(h.requests[0].body.action, "visual");
    assert.equal(h.requests[0].body.expectedRevision, 1);
    assert.equal(h.api.elements.completeStage.disabled, true);
    assert.equal(h.api.elements.previewFrame.navigations.length, 1);
    const failed = { ...visual, revision: 3, prototypeFlow: { ...visual.prototypeFlow, activeCheckpointId: null,
        checkpoints: [...value.prototypeFlow.checkpoints, checkpoint("visual", "visual", "failed", { summary: "Worker timed out" })] } };
    h.api.renderIfChanged(failed);
    assert.equal(h.api.elements.previewFrame.style.display, "block");
    assert.equal(h.api.elements.previewFrame.navigations.length, 1);
    assert.match(h.api.elements.prototypeProgressMessage.textContent, /Worker timed out.*preview is unchanged/);
    assert.equal(h.api.elements.retryPrototypeCheckpoint.hidden, false);
    h.setFetch(async () => response({ ...visual, revision: 4 }));
    await h.api.elements.retryPrototypeCheckpoint.emit("click");
    assert.equal(h.requests[1].body.action, "retry");
    assert.equal(h.requests[1].body.checkpointId, "visual");
});

test("feedback on a legacy ready preview lets the host bind its migrated checkpoint", async () => {
    const h = await rendererHarness();
    const value = { ...readyPrototype(), prototypeFlow: null };
    h.api.renderIfChanged(value);
    h.api.elements.revisionInput.value = "Keep my selected item.";
    h.setFetch(async () => response({ ...value, revision: 2 }));
    await h.api.elements.revisionForm.emit("submit");
    assert.equal(Object.hasOwn(h.requests[0].body, "baseCheckpointId"), false);
    assert.equal(h.requests[0].body.suggestion, "Keep my selected item.");
});

test("legacy failed feedback exposes retry without a checkpoint and preserves the ready preview", async () => {
    const h = await rendererHarness();
    const value = state("prototype");
    value.previewStatus = "ready";
    value.previewUrl = "http://127.0.0.1:9998/";
    value.prototypeReview.revisions = [
        { id: "oldest-failure", suggestion: "Keep the first filter visible", status: "failed" },
        { id: "later-failure", suggestion: "Keep the second filter visible", status: "failed" },
    ];
    h.api.renderIfChanged(value);
    const frame = h.api.elements.previewFrame;
    assert.equal(h.api.elements.prototypeProgress.hidden, false);
    assert.equal(h.api.elements.prototypeMilestones.hidden, true, "legacy previews must not acquire new milestone requirements");
    assert.equal(h.api.elements.retryPrototypeCheckpoint.hidden, false);
    assert.equal(h.api.elements.retryPrototypeCheckpoint.disabled, false);
    assert.equal(h.api.elements.retryPrototypeCheckpoint.textContent, "Retry failed revision");
    assert.equal(h.api.elements.startPrototype.hidden, true);
    assert.equal(h.api.elements.completeStage.disabled, true);
    h.api.elements.revisionInput.value = "Keep this draft while retrying";
    h.setFetch(async () => response({ ...value, revision: 2,
        processing: { action: "submit-revision", status: "running", message: "Retrying oldest failed feedback" } }));
    await h.api.elements.retryPrototypeCheckpoint.emit("click");
    assert.equal(h.requests[0].path, "/api/prototype/action");
    assert.equal(h.requests[0].body.action, "retry");
    assert.equal(Object.hasOwn(h.requests[0].body, "checkpointId"), false);
    assert.equal(h.requests[0].body.expectedRevision, 1);
    assert.equal(frame.style.display, "block");
    assert.equal(frame.navigations.length, 1);
    assert.equal(h.api.elements.revisionInput.value, "Keep this draft while retrying");
    assert.equal(h.api.elements.retryPrototypeCheckpoint.hidden, true);
});

test("failed feedback without a matching checkpoint can retry in a progressive flow", async () => {
    const h = await rendererHarness();
    const value = readyPrototype();
    value.prototypeReview.revisions = [{ id: "legacy-failure", suggestion: "Earlier feedback", status: "failed" }];
    h.api.renderIfChanged(value);
    assert.equal(h.api.elements.retryPrototypeCheckpoint.hidden, false);
    assert.equal(h.api.elements.retryPrototypeCheckpoint.textContent, "Retry failed revision");
    h.setFetch(async () => response({ ...value, revision: 2 }));
    await h.api.elements.retryPrototypeCheckpoint.emit("click");
    assert.equal(h.requests[0].body.action, "retry");
    assert.equal(Object.hasOwn(h.requests[0].body, "checkpointId"), false);
    assert.equal(h.api.elements.previewFrame.navigations.length, 1);
});

test("extending an exhausted prototype work window requires explicit confirmation", async () => {
    const h = await rendererHarness();
    const value = progressivePrototype();
    value.prototypeFlow.activeCheckpointId = null;
    value.prototypeFlow.checkpoints[1] = checkpoint("interaction", "interaction", "failed");
    value.prototypeFlow.budget.usedSeconds = 900;
    h.api.renderIfChanged(value);
    assert.equal(h.api.elements.extendPrototypeBudget.hidden, false);
    assert.equal(h.api.elements.retryPrototypeCheckpoint.hidden, true);
    h.setConfirm(false);
    await h.api.elements.extendPrototypeBudget.emit("click");
    assert.equal(h.requests.length, 0);
    h.setConfirm(true);
    h.setFetch(async () => response({ ...value, revision: 2 }));
    await h.api.elements.extendPrototypeBudget.emit("click");
    assert.equal(h.requests[0].body.action, "extend-budget");
    assert.match(h.confirmations[0], /15-minute AI work window/);
    assert.equal(h.api.elements.previewFrame.navigations.length, 1);
    assert.equal(h.api.elements.revisionInput.disabled, false);
});

test("failed optional visual direction can be skipped without losing history or the working preview", async () => {
    const h = await rendererHarness();
    const value = readyPrototype();
    value.prototypeFlow.visualRequested = true;
    value.prototypeFlow.checkpoints.push(checkpoint("visual", "visual", "failed", { summary: "Visual job exceeded its work window" }));
    value.prototypeFlow.budget.usedSeconds = 900;
    h.api.renderIfChanged(value);
    const frame = h.api.elements.previewFrame;
    assert.equal(h.api.elements.skipPrototypeVisual.hidden, false);
    assert.equal(h.api.elements.skipPrototypeVisual.disabled, false);
    assert.equal(h.api.elements.completeStage.disabled, true);
    h.api.elements.revisionInput.value = "Keep my future feedback";
    const skipped = { ...value, revision: 2, prototypeFlow: { ...value.prototypeFlow, visualRequested: false } };
    h.setFetch(async () => response(skipped));
    await h.api.elements.skipPrototypeVisual.emit("click");
    assert.equal(h.requests[0].path, "/api/prototype/action");
    assert.equal(h.requests[0].body.action, "skip-visual");
    assert.equal(h.requests[0].body.expectedRevision, 1);
    assert.equal(h.api.elements.skipPrototypeVisual.hidden, true);
    assert.equal(h.api.elements.retryPrototypeCheckpoint.hidden, true);
    assert.equal(h.api.elements.extendPrototypeBudget.hidden, false, "The user can extend an exhausted budget before requesting more optional work.");
    assert.equal(h.api.elements.requestPrototypeVisual.disabled, true);
    assert.equal(h.api.elements.completeStage.disabled, false);
    assert.match(h.api.elements.prototypeMilestones.textContent, /Visual directionSkipped \(optional\)/);
    assert.doesNotMatch(h.api.elements.prototypeProgressMessage.textContent, /latest update failed/);
    assert.equal(h.api.current().prototypeFlow.checkpoints.at(-1).status, "failed", "skipping retains checkpoint history");
    assert.equal(h.api.elements.revisionInput.value, "Keep my future feedback");
    assert.equal(frame.navigations.length, 1);
    assert.equal(frame.style.display, "block");
});

test("Skip visual direction is unavailable before a visual failure and while any job is active", async () => {
    const h = await rendererHarness();
    const ready = readyPrototype();
    const failed = { ...ready, prototypeFlow: { ...ready.prototypeFlow, visualRequested: true,
        checkpoints: [...ready.prototypeFlow.checkpoints, checkpoint("visual", "visual", "failed")] } };
    for (const value of [
        ready,
        { ...ready, prototypeFlow: { ...ready.prototypeFlow, visualRequested: true } },
        { ...failed, processing: { action: "submit-revision", status: "running" } },
        { ...failed, prototypeFlow: { ...failed.prototypeFlow, activeCheckpointId: "retry",
            checkpoints: [...failed.prototypeFlow.checkpoints, checkpoint("retry", "visual", "running")] } },
    ]) {
        h.api.render(value);
        assert.equal(h.api.elements.skipPrototypeVisual.hidden, true);
        await h.api.elements.skipPrototypeVisual.emit("click");
    }
    h.api.render({ ...failed, provider: { canSubmitAnswers: false } });
    assert.equal(h.api.elements.skipPrototypeVisual.disabled, true);
    await h.api.elements.skipPrototypeVisual.emit("click");
    assert.equal(h.requests.length, 0);
});

test("explicit update captures only the current iframe origin and restores bounded state after the new load", async () => {
    const h = await rendererHarness();
    h.api.renderIfChanged(readyPrototype(1, true));
    const frame = h.api.elements.previewFrame;
    assert.equal(frame.getAttribute("referrerpolicy"), "origin", "bridge receives the parent origin without its path or query");
    h.setFetch(async () => response(readyPrototype(2)));
    const applying = h.api.elements.applyPrototypeUpdate.emit("click");
    await h.flush();
    const capture = frame.frameMessages[0];
    assert.equal(capture.data.type, "tandem:preview:capture");
    assert.equal(capture.origin, "http://127.0.0.1:9998");
    assert.equal(h.requests.length, 0);
    const data = { type: "tandem:preview:state", requestId: capture.data.requestId, prototypeId: "fixture",
        state: { route: "/items/7", scroll: { x: 0, y: 400 }, fields: { search: "private draft" } } };
    for (const event of [
        { source: {}, origin: capture.origin, data },
        { source: frame.contentWindow, origin: "http://127.0.0.1:1234", data },
        { source: frame.contentWindow, origin: capture.origin, data: { ...data, requestId: "stale" } },
        { source: frame.contentWindow, origin: capture.origin, data: { ...data, prototypeId: "another-effort" } },
        { source: frame.contentWindow, origin: capture.origin, data: { ...data, state: "x".repeat(65 * 1024) } },
    ]) await h.emitWindow("message", event);
    assert.equal(h.requests.length, 0, "untrusted or oversized messages cannot trigger promotion");
    await h.emitWindow("message", { source: frame.contentWindow, origin: capture.origin, data });
    await applying;
    assert.equal(h.requests[0].body.action, "apply-update");
    assert.equal(h.requests[0].body.checkpointId, "interaction");
    assert.equal(h.requests[0].body.expectedRevision, 1);
    assert.equal(JSON.stringify(h.requests).includes("private draft"), false, "captured fields never enter durable API state");
    assert.equal(frame.navigations.length, 2);
    assert.equal(frame.frameMessages.length, 1, "restore must wait for the promoted preview to load");
    await frame.emit("load");
    const restore = frame.frameMessages[1];
    assert.equal(restore.origin, "http://127.0.0.1:9999");
    assert.equal(restore.data.type, "tandem:preview:restore");
    assert.equal(restore.data.prototypeId, "fixture");
    assert.equal(JSON.stringify(restore.data.state), JSON.stringify(data.state));
    h.api.renderIfChanged(readyPrototype(3));
    await frame.emit("load");
    assert.equal(frame.navigations.length, 2);
    assert.equal(frame.frameMessages.length, 2, "cooperative restore runs only once");
});

test("an unsupported or malicious preview cannot block explicit promotion", async () => {
    const h = await rendererHarness();
    h.api.renderIfChanged(readyPrototype(1, true));
    const frame = h.api.elements.previewFrame;
    h.setFetch(async () => response(readyPrototype(2)));
    const applying = h.api.elements.applyPrototypeUpdate.emit("click");
    await h.flush();
    const capture = frame.frameMessages[0];
    await h.emitWindow("message", { source: frame.contentWindow, origin: capture.origin, data: {
        type: "tandem:preview:state", prototypeId: "fixture", requestId: capture.data.requestId,
        state: "😀".repeat(20 * 1024),
    } });
    await applying;
    assert.equal(h.requests.length, 1);
    await frame.emit("load");
    assert.equal(frame.frameMessages.length, 1, "oversized UTF-8 data is not restored");
    assert.equal(frame.src, readyPrototype().previewUrl);
    assert.equal(h.api.elements.completeStage.disabled, false);
});

test("a candidate changed during capture is rejected without submitting or replacing the preview", async () => {
    const h = await rendererHarness();
    h.api.renderIfChanged(readyPrototype(1, true));
    const frame = h.api.elements.previewFrame;
    const applying = h.api.elements.applyPrototypeUpdate.emit("click");
    await h.flush();
    const capture = frame.frameMessages[0];
    const changed = readyPrototype(2, true);
    changed.prototypeFlow.checkpoints.push(checkpoint("new-interaction", "interaction"));
    changed.prototypeFlow.pendingCheckpointId = "new-interaction";
    h.api.renderIfChanged(changed);
    await h.emitWindow("message", { source: frame.contentWindow, origin: capture.origin, data: {
        type: "tandem:preview:state", requestId: capture.data.requestId, prototypeId: "fixture", state: { scroll: 20 },
    } });
    await applying;
    assert.equal(h.requests.length, 0);
    assert.equal(frame.navigations.length, 1);
    assert.match(h.api.elements.prototypeActionStatus.textContent, /update changed/);
    h.api.renderIfChanged({ ...changed, revision: 3 });
    assert.match(h.api.elements.prototypeActionStatus.textContent, /update changed/);
});

test("a server rejection preserves the preview, discards captured state and permits retry", async () => {
    const h = await rendererHarness();
    h.api.renderIfChanged(readyPrototype(1, true));
    const frame = h.api.elements.previewFrame;
    frame.onPreviewMessage = (request, origin) => {
        if (request.type === "tandem:preview:capture") void h.emitWindow("message", {
            source: frame.contentWindow, origin, data: { type: "tandem:preview:state", requestId: request.requestId,
                prototypeId: request.prototypeId, state: { field: "ephemeral" } },
        });
    };
    h.setFetch(async () => response({ error: "Stale pending checkpoint; review the new update" }, 409));
    await h.api.elements.applyPrototypeUpdate.emit("click");
    assert.equal(frame.navigations.length, 1);
    assert.equal(h.api.elements.applyPrototypeUpdate.disabled, false);
    assert.match(h.api.elements.prototypeActionStatus.textContent, /Stale pending checkpoint/);
    h.api.renderIfChanged(readyPrototype(2));
    await frame.emit("load");
    assert.equal(frame.frameMessages.some((message: any) => message.data.type === "tandem:preview:restore"), false);
});

test("promoting a checkpoint at the same URL reloads only after the explicit action", async () => {
    const h = await rendererHarness();
    const value = readyPrototype(1, true);
    value.prototypeFlow.checkpoints[1].previewUrl = value.previewUrl;
    h.api.renderIfChanged(value);
    const frame = h.api.elements.previewFrame;
    frame.onPreviewMessage = (request, origin) => {
        if (request.type === "tandem:preview:capture") void h.emitWindow("message", {
            source: frame.contentWindow, origin, data: { type: "tandem:preview:state", requestId: request.requestId,
                prototypeId: request.prototypeId, state: null },
        });
    };
    h.setFetch(async () => response({ ...value, revision: 2, prototypeFlow: { ...value.prototypeFlow,
        displayedCheckpointId: "interaction", pendingCheckpointId: null } }));
    await h.api.elements.applyPrototypeUpdate.emit("click");
    assert.equal(frame.navigations.length, 2);
    assert.equal(frame.navigations[0], frame.navigations[1]);
    await frame.emit("load");
    assert.equal(frame.frameMessages[1].data.state, null);
});

test("stage browsing is read-only; reopening requires confirmation and no active jobs", async () => {
    const h = await rendererHarness();
    const value = state("test");
    value.planning.workItems = [{ id: "work", title: "Saved plan" }];
    value.implementation.workItems = [{ id: "work", status: "completed" }];
    h.api.render(value);
    await h.api.elements.stageList.querySelector('[data-stage-id="plan"]').emit("click");
    assert.equal(h.api.current().lifecycle.currentStage, "test");
    assert.equal(h.api.elements.planPanel.hidden, false);
    assert.equal(h.api.elements.generatePlan.disabled, true);
    await h.api.elements.generatePlan.emit("click");
    assert.equal(h.requests.length, 0);
    assert.equal(h.api.elements.implementationTab.hidden, false);
    h.setConfirm(false);
    await h.api.elements.reopenStage.emit("click");
    assert.equal(h.requests.length, 0);
    h.setConfirm(true);
    h.setFetch(async () => response(state("plan", 2)));
    await h.api.elements.reopenStage.emit("click");
    assert.equal(h.requests[0].path, "/api/stage/reopen");
    assert.equal(h.requests[0].body.stageId, "plan");
    assert.match(h.confirmations[0], /dependent stage outputs will be marked stale/);
    const busy = state("test", 3);
    busy.testing.status = "running";
    h.api.renderIfChanged(busy); h.api.browseStage("plan");
    assert.equal(h.api.elements.reopenStage.disabled, true);
    await h.api.elements.reopenStage.emit("click");
    assert.equal(h.requests.length, 1);
});

test("responsive layout and graph keyboard focus have explicit accessible styles", async () => {
    const css = await readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
    assert.match(css, /container:\s*output\s*\/\s*inline-size/);
    assert.match(css, /@container output \(max-width: 680px\)/);
    assert.match(css, /g\.node\[data-selectable="true"\]:focus-visible\s*\{\s*outline:\s*3px solid/);
    assert.match(css, /\.workspace\[data-context-open="true"\] \.requirements\s*\{\s*display: block/);
    assert.match(css, /\.preview-tabs\s*\{[^}]*overflow-x: auto/);
    assert.match(css, /\.preview\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
    assert.match(css, /\.prototype-view \.frame-wrap\s*\{[^}]*grid-template-rows:\s*minmax\(220px, 1fr\) auto/);
    assert.match(css, /form:focus-within textarea\[data-speech-input\]/);
    assert.doesNotMatch(css, /animation:\s*next-action/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.processing-indicator/);
});

test("compact density is shared by all stage headers, panels, controls, and composers", async () => {
    const css = await readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
    const rules = (selector: string) => {
        const start = css.indexOf(selector + " {");
        assert.ok(start >= 0, `Missing ${selector}`);
        return css.slice(start, css.indexOf("}", start));
    };
    assert.match(css, /--studio-space:\s*8px/);
    assert.match(css, /--studio-control-height:\s*32px/);
    assert.match(css, /--studio-composer-height:\s*36px/);
    assert.match(rules(".topbar"), /min-height:\s*var\(--studio-header-height\)/);
    assert.match(rules(".previewbar"), /min-height:\s*var\(--studio-tab-height\)/);
    assert.doesNotMatch(css, /\.prototype-view \.(?:topbar|previewbar|mark)\s*\{/);
    for (const selector of [".preparation-panel", ".design-tree-panel", ".design-review-panel",
        ".plan-panel", ".implementation-panel", ".content-panel", ".frame-wrap"]) {
        assert.match(rules(selector), /padding:\s*var\(--studio-space\)/, selector);
    }
    for (const selector of [".preparation-stage-heading", ".design-review-heading", ".plan-heading",
        ".implementation-heading", ".content-heading", ".design-tree-heading"]) {
        assert.match(rules(selector), /padding:\s*var\(--studio-heading-padding\)/, selector);
    }
    assert.match(rules("form textarea[data-speech-input]"), /height:\s*var\(--studio-composer-height\)/);
    assert.match(rules("form:focus-within textarea[data-speech-input]"), /var\(--studio-composer-expanded-height\)/);
    assert.match(rules(".start-form textarea[data-speech-input]"), /min-height:\s*112px/);
    assert.match(rules(".artifact-content"), /line-height:\s*1\.55/);
    assert.match(rules(".requirements"), /padding-inline-end:\s*4px/);
    assert.match(rules(".requirements"), /scrollbar-width:\s*thin/);
    assert.match(rules(".requirements"), /scrollbar-gutter:\s*stable/);
    assert.match(rules(".splitter"), /min-width:\s*9px/);
});

test("compact project context is explicit, preserves drafts, and closes on navigation or Escape", async () => {
    const h = await rendererHarness();
    h.setNarrowViewport(true);
    const value = state("requirements");
    h.api.renderIfChanged(value);
    assert.equal(h.api.elements.contextToggle.getAttribute("aria-expanded"), "false");
    assert.equal(h.api.elements.contextStage.textContent, "Requirements");
    await h.api.elements.contextToggle.emit("click");
    assert.equal(h.api.elements.workspace.dataset.contextOpen, "true");
    h.api.elements.handoffApprover.value = "Design owner";
    h.api.renderIfChanged({ ...value, revision: 2 });
    assert.equal(h.api.elements.contextToggle.getAttribute("aria-expanded"), "true");
    await h.api.elements.requirements.emit("keydown", { key: "Escape" });
    assert.equal(h.api.elements.workspace.dataset.contextOpen, "false");
    assert.equal(h.document.activeElement, h.api.elements.contextToggle);
    assert.equal(h.api.elements.handoffApprover.value, "Design owner");
    await h.api.elements.contextToggle.emit("click");
    await h.api.elements.stageList.querySelector('[data-stage-id="prepare"]').emit("click");
    assert.equal(h.api.elements.workspace.dataset.contextOpen, "false");
    assert.equal(h.api.elements.preparationPanel.hidden, false);
    assert.equal(h.api.current().lifecycle.currentStage, "requirements");
    assert.equal(h.requests.length, 0);
});

test("next-step guidance navigates and focuses without executing a mutation", async () => {
    const h = await rendererHarness();
    h.setNarrowViewport(true);
    const value = state("prepare");
    value.preparation.status = "failed";
    value.preparation.error = "Could not inspect workspace";
    h.api.render(value);
    assert.equal(h.api.elements.nextActionBar.hidden, false);
    assert.match(h.api.elements.nextActionGuide.textContent, /Retry preparation/);
    assert.equal(h.api.elements.preparationStageProgress.textContent, "Could not inspect workspace");
    await h.api.elements.contextToggle.emit("click");
    await h.api.elements.showNextAction.emit("click");
    assert.equal(h.api.elements.workspace.dataset.contextOpen, "false");
    assert.equal(h.document.activeElement, h.api.elements.retryPreparation);
    assert.equal(h.requests.length, 0);
    value.preparation.status = "running";
    h.api.render(value);
    assert.equal(h.api.elements.nextActionBar.hidden, true);
});

test("next-step guidance reveals stage completion in compact context from a historical view", async () => {
    const h = await rendererHarness();
    h.setNarrowViewport(true);
    const value = state("requirements");
    value.requirements.substage = "dag";
    value.decisionGraph.nodes = [decision("accepted", "answered")];
    h.api.render(value);
    h.api.browseStage("prepare");
    assert.equal(h.api.elements.completeStage.hidden, true);
    await h.api.elements.showNextAction.emit("click");
    assert.equal(h.api.elements.completeStage.hidden, false);
    assert.equal(h.api.elements.contextToggle.getAttribute("aria-expanded"), "true");
    assert.equal(h.document.activeElement, h.api.elements.completeStage);
    assert.equal(h.requests.length, 0);
});

test("artifact navigation shows one empty state and only populated stage groups", async () => {
    const h = await rendererHarness();
    h.setNarrowViewport(true);
    const value = state("design");
    h.api.render(value);
    assert.equal(h.api.elements.artifactList.querySelectorAll(".artifact-empty").length, 1);
    assert.equal(h.api.elements.artifactList.querySelectorAll(".artifact-stage-group").length, 0);
    value.artifacts = [
        { id: "intent", title: "User intent", stage: "requirements", kind: "intent", content: "Intent" },
        { id: "contract", title: "UI contract", stage: "design", kind: "contract", content: "Contract", reviewStatus: "stale" },
    ];
    h.api.render(value);
    assert.equal(h.api.elements.artifactList.querySelectorAll(".artifact-stage-group").length, 2);
    assert.match(h.api.elements.artifactList.textContent, /stale/);
    await h.api.elements.contextToggle.emit("click");
    await h.api.elements.artifactList.querySelector('[data-artifact-id="contract"]').emit("click");
    assert.equal(h.api.elements.workspace.dataset.contextOpen, "false");
    assert.equal(h.api.elements.artifactHeading.textContent, "UI contract");
    assert.equal(h.api.elements.contentPanel.hidden, false);
    assert.equal(h.requests.length, 0);
});

test("failed preparation without an error never reports successful completion", async () => {
    const h = await rendererHarness();
    const value = state("prepare");
    value.preparation.status = "failed";
    h.api.render(value);
    assert.match(h.api.elements.preparationStageProgress.textContent, /stopped before completion/);
});

test("renderer asset injection does not interpret dollar substitution sequences", async () => {
    const source = (await readFile(new URL("../src/renderer.ts", import.meta.url), "utf8")).replace(/^import .+;\r?$/gm, "");
    const code = (await transform(source + "\nglobalThis.render = renderTandemHtml;", { loader: "ts", format: "cjs" })).code;
    const payload = "$& $$ $` $'";
    const context: any = { module: { exports: {} }, styles: payload, clientScript: payload, htmlTemplate: "__TANDEM_STYLES__ | __TANDEM_CLIENT__ | v__TANDEM_VERSION__" };
    runInNewContext(code, context);
    assert.equal(context.render("0.0.0-test"), payload + " | " + payload + " | v0.0.0-test");
});

test("Preparation runtime updates stay ordered and advance automatically into Requirements", async () => {
    const h = await rendererHarness();
    const value = state("prepare");
    value.preparation.status = "running";
    value.preparation.workItems = [{ id: "context", title: "Inspect context", status: "running", detail: "Read project guidance" }];
    h.api.renderIfChanged(value, 10);
    assert.equal(h.api.elements.stageList.querySelectorAll("button").length, 7);
    assert.equal(h.api.elements.currentStageIndex.textContent, "1");
    assert.equal(h.api.elements.preparationPanel.hidden, false);
    assert.equal(h.api.elements.requirementsTab.disabled, true);
    assert.equal(h.api.elements.completeStage.disabled, true);
    assert.equal(h.api.hasActiveJobs(value), true);
    await h.api.elements.completeStage.emit("click");
    assert.equal(h.requests.length, 0);
    h.api.renderIfChanged({ ...value, preparationRuntime: {
        currentPhase: "analyze-sources", agents: [{ label: "prepare:context", status: "running", activity: "Reading docs" }],
    } }, 12);
    assert.match(h.api.elements.preparationStageProgress.textContent, /analyze sources/);
    assert.match(h.api.elements.preparationWorkItems.textContent, /Reading docs/);
    h.api.renderIfChanged({ ...value, preparationRuntime: { currentPhase: "old-phase" } }, 11);
    assert.match(h.api.elements.preparationStageProgress.textContent, /analyze sources/);
    const ready = state("requirements", 2);
    ready.preparation.suggestedUsages = ["Suggested requirement"];
    h.api.renderIfChanged(ready, 13);
    assert.equal(h.api.elements.currentStageIndex.textContent, "2");
    assert.equal(h.api.elements.designTreePanel.hidden, false);
    assert.equal(h.api.elements.requirementsTab.disabled, false);
    h.api.browseStage("prepare");
    assert.equal(h.api.elements.preparationPanel.hidden, false);
    assert.match(h.api.elements.stageBrowsing.textContent, /read only/);
    assert.equal(h.api.elements.retryPreparation.hidden, true);
    h.setFetch(async () => response(state("prepare", 3)));
    await h.api.elements.reopenStage.emit("click");
    assert.equal(h.requests[0].path, "/api/stage/reopen");
    assert.equal(h.requests[0].body.stageId, "prepare");
});

test("Preparation polls use its status route and retry errors remain visible", async () => {
    const h = await rendererHarness();
    const value = state("prepare");
    value.preparation.status = "failed";
    h.api.renderIfChanged(value);
    h.setFetch(async (path) => path === "/api/preparation/status"
        ? response(value)
        : response({ error: "Preparation unavailable" }, 503));
    await h.api.refreshSharedState();
    assert.equal(h.requests[0].path, "/api/preparation/status");
    await h.api.elements.retryPreparation.emit("click");
    assert.equal(h.requests[1].path, "/api/preparation/retry");
    assert.match(h.api.elements.preparationStageMessage.textContent, /Preparation unavailable/);
    assert.equal(h.api.elements.retryPreparation.disabled, false);
    h.api.renderIfChanged({ ...state("requirements", 2), preparation: value.preparation });
    await h.api.elements.retryPreparation.emit("click");
    assert.equal(h.requests.length, 2, "historical Preparation cannot mutate through its old retry button");
});

test("not-applicable and skipped prototypes never expose start, finish, or reopen mutations", async () => {
    const h = await rendererHarness();
    const value = state("design");
    value.prototypeApproach = { mode: "not-applicable", reason: "Command-line app" };
    value.lifecycle.skippedStages = [{ stageId: "prototype", reason: "Command-line app", skippedAt: value.updatedAt }];
    value.previewStatus = "ready";
    value.previewUrl = "http://127.0.0.1:9999/stale";
    value.artifacts = [{ id: "old-preview", title: "Old preview", stage: "prototype", content: "Old output", mermaid: "" }];
    h.api.render(value);
    assert.equal(h.api.elements.previewTab.disabled, true);
    assert.equal(h.api.elements.startPrototype.hidden, true);
    assert.equal(h.api.elements.previewFrame.style.display, "none");
    assert.match(h.api.elements.previewEmptyMessage.textContent, /Command-line app/);
    const skipped = h.api.elements.stageList.querySelector('[data-stage-id="prototype"]');
    assert.equal(skipped.disabled, true);
    assert.match(skipped.getAttribute("aria-label"), /not applicable/);
    await h.api.elements.artifactList.querySelector("button").emit("click");
    assert.equal(h.api.elements.reopenStage.hidden, true);
    await h.api.elements.reopenStage.emit("click");
    await h.api.elements.startPrototype.emit("click");
    assert.equal(h.requests.length, 0);
    h.api.render({ ...value, lifecycle: { ...value.lifecycle, currentStage: "prototype" } });
    assert.equal(h.api.elements.completeStage.disabled, true);
    await h.api.elements.completeStage.emit("click");
    assert.equal(h.requests.length, 0);
});

test("validate-existing uses the same safe start route without claiming to replace the app", async () => {
    const h = await rendererHarness();
    const value = state("prototype");
    value.prototypeApproach = { mode: "validate-existing", reason: "App already exists" };
    h.api.render(value);
    assert.equal(h.api.elements.startPrototype.textContent, "Validate existing prototype");
    assert.match(h.api.elements.previewEmptyMessage.textContent, /without replacing/);
    h.setFetch(async () => response({
        ...value, revision: 2, previewStatus: "starting",
        processing: { action: "build-prototype", status: "running", message: "Checking the existing app" },
    }));
    await h.api.elements.startPrototype.emit("click");
    assert.equal(h.requests[0].path, "/api/prototype/start");
    assert.deepEqual(h.requests[0].body, {});
    assert.equal(h.api.elements.prototypeBuildingTitle.textContent, "Validating existing prototype");
    assert.equal(h.api.elements.prototypeBuildingMessage.textContent, "Checking the existing app");
    h.api.renderIfChanged({ ...value, revision: 3, previewStatus: "error" });
    assert.equal(h.api.elements.startPrototype.textContent, "Retry existing prototype validation");
    h.api.renderIfChanged({ ...value, revision: 4, prototypeApproach: { mode: "undecided", reason: "" } });
    assert.equal(h.api.elements.startPrototype.disabled, true);
    await h.api.elements.startPrototype.emit("click");
    assert.equal(h.requests.length, 1);
});

test("completed Tests runs can run again but historical test views remain read-only", async () => {
    const h = await rendererHarness();
    const value = state("test");
    value.lifecycle.completedStages.push("test");
    value.testDesignReview.scenarios = [{ id: "scenario", title: "Scenario" }];
    value.testing = { status: "completed", scenarios: [{ id: "scenario", status: "passed" }] };
    h.api.render(value);
    assert.equal(h.api.elements.startTests.textContent, "Run tests again");
    assert.equal(h.api.elements.startTests.disabled, false);
    h.setFetch(async () => response({ ...value, revision: 2, testing: { ...value.testing, status: "starting" } }));
    await h.api.elements.startTests.emit("click");
    assert.equal(h.requests[0].path, "/api/test/start");
    assert.equal(h.api.elements.startTests.disabled, true);
    h.api.renderIfChanged({ ...value, revision: 3, lifecycle: { ...value.lifecycle, currentStage: "implement" } });
    h.api.browseStage("test");
    assert.equal(h.api.elements.testPanel.hidden, false);
    assert.equal(h.api.elements.startTests.disabled, true);
    await h.api.elements.startTests.emit("click");
    assert.equal(h.requests.length, 1);
});

test("detailed test diagnostics preserve expansion and focus until a new run replaces them", async () => {
    const h = await rendererHarness();
    const value = state("test");
    value.testing = { status: "failed", requestId: "run-one", error: "Test failed", errorDetails: "Command: npm test\nExit code: 1", scenarios: [] };
    h.api.renderIfChanged(value);
    assert.equal(h.api.elements.testErrorToggle.hidden, false);
    await h.api.elements.testErrorToggle.emit("click");
    assert.equal(h.api.elements.testErrorDetails.hidden, false);
    assert.equal(h.document.activeElement, h.api.elements.testErrorDetails);
    h.api.renderIfChanged({ ...value, testRuntime: { progress: [{ seq: 1, text: "Agent stopped" }] } });
    assert.equal(h.api.elements.testErrorDetails.hidden, false);
    assert.equal(h.document.activeElement, h.api.elements.testErrorDetails);
    assert.match(h.api.elements.testErrorDetails.textContent, /Exit code: 1/);
    h.api.renderIfChanged({ ...value, revision: 2, testing: { ...value.testing, requestId: "run-two" } });
    assert.equal(h.api.elements.testErrorDetails.hidden, true);
});

test("legacy history fields remain optional and archived Preparation output can be browsed", async () => {
    const h = await rendererHarness();
    const value = state("requirements");
    delete value.lifecycle.skippedStages;
    delete value.lifecycle.history;
    h.api.render(value);
    assert.equal(h.api.elements.stageList.querySelectorAll("button").length, 7);
    value.lifecycle.completedStages = [];
    value.lifecycle.history = [{ stageId: "prepare", path: "history/preparation.md", completedAt: value.updatedAt }];
    h.api.render({ ...value, revision: 2 });
    const button = h.api.elements.stageList.querySelector('[data-stage-id="prepare"]');
    assert.equal(button.disabled, false);
    assert.equal(button.title, "history/preparation.md");
    await button.emit("click");
    assert.equal(h.api.elements.preparationPanel.hidden, false);
    assert.equal(h.requests.length, 0);
});

test("GitHub intake does not send stale Local JSON to the selected adapter", async () => {
    const h = await rendererHarness();
    const value = state("requirements");
    value.process = {
        settings: { adapters: { handoff: "local", status: "local", intake: "github" },
            verification: { enabled: false, independentReview: true, checks: [] } },
        acceptances: [], receipts: [], message: "",
    };
    h.api.render(value);
    h.api.elements.intakeContent.value = '{"title":"Old local data","body":"Do not send"}';
    h.api.elements.processReference.value = "https://github.com/Example/Tandem/issues/23";
    h.setFetch(async () => response({ ...value, revision: 2 }));
    await h.api.elements.importIntake.emit("click");
    assert.equal(h.requests[0].path, "/api/process");
    assert.equal(h.requests[0].body.action, "intake");
    assert.equal(Object.hasOwn(h.requests[0].body, "content"), false);
});
