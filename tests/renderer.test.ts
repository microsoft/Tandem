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

test("bulk recommendations stay single-flight across unrelated snapshots and advance once per decision", async () => {
    const h = await rendererHarness();
    h.api.setMermaid(async () => { throw new Error("offline"); });
    const value = state();
    value.requirements.substage = "dag";
    value.decisionGraph.nodes = [decision("first"), decision("second", "toAnswer")];
    h.api.renderIfChanged(value);
    let resolveFirst!: (value: any) => void;
    h.setFetch(async () => {
        if (h.requests.length === 1) return new Promise((resolve) => { resolveFirst = resolve; });
        return response({
            ...value, revision: 5,
            decisionGraph: { nodes: [decision("first", "answered"), decision("second")] },
            processing: { status: "running", action: "answer-decision", question: { id: "second" } },
        });
    });
    await h.api.elements.questionHost.querySelector(".all-recommended").emit("click");
    h.api.renderIfChanged({ ...value, revision: 2, status: "Unrelated notification" });
    assert.equal(h.api.pending(), true);
    assert.equal(h.requests.length, 1);
    resolveFirst(response({
        ...value, revision: 3,
        processing: { status: "running", action: "answer-decision", question: { id: "first" } },
    }));
    await h.flush();
    assert.equal(h.requests.length, 1);
    h.api.renderIfChanged({
        ...value, revision: 4,
        decisionGraph: { nodes: [decision("first", "answered"), decision("second")] },
    });
    await h.flush();
    assert.equal(h.requests.length, 2);
    assert.deepEqual(h.requests.map((request) => request.body.questionId), ["first", "second"]);
    assert.equal(h.api.pending(), false);
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
    assert.doesNotMatch(css, /animation:\s*next-action/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.processing-indicator/);
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
