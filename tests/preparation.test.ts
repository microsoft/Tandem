import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { extensionHarness } from "./helpers/extension-harness.js";
import type { PreparationToken } from "../src/agent-runner.js";
import type { TandemState } from "../src/types.js";

function tokenFor(state: TandemState, runId: string | null): PreparationToken {
    assert.ok(state.preparation.processing?.requestId);
    return { requestId: state.preparation.processing.requestId, generation: state.generation, runId };
}

function readyRequirements(state: TandemState) {
    state.stage = "requirements";
    state.lifecycle = { ...state.lifecycle, currentStage: "requirements", completedStages: ["prepare"] };
    state.requirements = { substage: "dag", usageItems: ["I want to use the deliverable."], suggestions: [] };
    state.decisionGraph.nodes = [{ id: "usage", title: "Usage", dependencies: [], question: null, answer: "Confirmed", status: "answered" }];
    return state;
}

test("automatic Preparation binds its run before agents and writes a versioned Requirements handoff", async () => {
    const fixture = await extensionHarness();
    try {
        const state = fixture.api.createState("sample", "Build an app");
        await fixture.api.persistState(state);
        const pending = await fixture.api.ensurePreparationStarted(state, true);
        await fixture.waitForRequests();
        assert.equal(fixture.requests.length, 1);
        const request = fixture.requests[0];
        assert.ok(request && typeof request === "object" && "args" in request);
        assert.ok(request.args && typeof request.args === "object");
        assert.ok(Object.keys(request.args).every((key) =>
            Object.hasOwn(fixture.api.preparationFactory.meta.argsSchema.properties, key)));
        const results = [
            { summary: "Workspace inspected", checks: [{ label: "Node", status: "ready", detail: "Available" }] },
            { summary: "Sources inspected", checks: [], sources: [{ title: "Reference", url: "https://example.com/docs", purpose: "Contract" }] },
            { status: "ready", summary: "Ready for Requirements", suggestedUsages: ["I want to inspect my tasks."],
                prototypeApproach: { mode: "build", reason: "A new GUI is needed." }, assumed: [], deferred: [] },
        ];
        const keys: string[] = [];
        const result = await fixture.api.preparationFactory.run({
            args: request.args, runId: "prepare-run", phase() {}, log() {},
            step: async (key: string, work: () => Promise<unknown>) => { keys.push(key); return work(); },
            agent: async () => {
                assert.equal((await fixture.api.loadState("sample")).preparation.processing?.runId, "prepare-run");
                return results.shift();
            },
        });
        assert.equal(keys.length, 3);
        assert.ok(keys.every((key) => key.startsWith(pending.preparation.processing!.requestId!)));
        fixture.api.setSession({ ...fixture.session, factory: {
            waitForRun: async () => ({ runId: "prepare-run", status: "completed", result }),
        } });
        await fixture.api.waitForEffortRun("sample", "prepare-run");
        await fixture.api.settlePreparationRun("sample", { runId: "prepare-run", status: "completed", result }, tokenFor(pending, "prepare-run"));
        const ready = await fixture.api.loadState("sample");
        assert.equal(ready.lifecycle.currentStage, "requirements");
        assert.equal(ready.preparation.status, "ready");
        assert.equal(ready.requirements.suggestions[0], "I want to inspect my tasks.");
        assert.equal(ready.jobOwner, null);
        const output = ready.lifecycle.outputs[0];
        assert.match(output.path, /efforts[\\/]sample[\\/]stages[\\/]prepare-r\d+\.json$/);
        const snapshot = JSON.parse(await readFile(join(fixture.root, output.path), "utf8"));
        assert.equal(snapshot.revision, ready.revision);
    } finally { await fixture.close(); }
});

test("Preparation rejects superseded callbacks and foreign-session ownership", async () => {
    const fixture = await extensionHarness();
    try {
        const state = fixture.api.createState("sample", "Analyze the workspace");
        await fixture.api.persistState(state);
        const pending = await fixture.api.ensurePreparationStarted(state, true);
        const token = tokenFor(pending, "prepare-run");
        assert.equal(await fixture.api.bindPreparationRun("sample", token), true);
        assert.equal(await fixture.api.bindPreparationRun("sample", { ...token, runId: "other-run" }), false);
        const before = await fixture.api.loadState("sample");
        await fixture.api.settlePreparationRun("sample", { runId: "other-run", status: "error", error: "old failure" }, { ...token, runId: "other-run" });
        assert.equal((await fixture.api.loadState("sample")).revision, before.revision);
        await assert.rejects(fixture.api.recordPreparationWorkItem("sample", "workspace", "running", { ...token, generation: "old" }), /no longer owns/);
        fixture.session.sessionId = "foreign";
        await assert.rejects(fixture.api.recordPreparationWorkItem("sample", "workspace", "running", token), /another session/);
    } finally { await fixture.close(); }
});

test("interrupted Preparation without a durable run becomes visibly retryable, not duplicated", async () => {
    const fixture = await extensionHarness();
    try {
        const state = fixture.api.createState("sample");
        state.preparation.status = "starting";
        state.preparation.processing = { requestId: null, generation: null, runId: null, requestedAt: "before", completedAt: null };
        await fixture.api.persistState(state);
        fixture.api.recoverPreparationFactory(state, true);
        await fixture.api.waitForPreparation("sample");
        const failed = await fixture.api.loadState("sample");
        assert.equal(failed.preparation.status, "failed");
        assert.match(failed.preparation.error, /retry explicitly/);
        assert.equal(fixture.requests.length, 0);
    } finally { await fixture.close(); }
});

test("canvas reset preserves revisions and cannot repeat during rehydration or an existing open", async () => {
    const fixture = await extensionHarness();
    try {
        const state = fixture.api.createState("sample", "Original");
        await fixture.api.persistState(state);
        const input = { reset: true, goal: "Reset goal" };
        fixture.session.openCanvases.push({ instanceId: "legacy-panel" });
        assert.equal(fixture.api.isCanvasRehydration({ instanceId: "legacy-panel" }), true);
        assert.equal(fixture.api.isCanvasRehydration({ instanceId: "new-panel" }), false);
        const reset = await fixture.api.applyCanvasReset(state, input, "session:panel", false, true);
        assert.ok(reset.revision > state.revision);
        assert.notEqual(reset.generation, state.generation);
        reset.goal = "Newly edited goal";
        await fixture.api.persistState(reset);
        const loaded = await fixture.api.loadState("sample");
        assert.equal((await fixture.api.applyCanvasReset(loaded, input, "session:panel", false, true)).goal, reset.goal);
        assert.equal((await fixture.api.applyCanvasReset(loaded, input, "other:panel", true, true)).goal, reset.goal);
        const pending = await fixture.api.ensurePreparationStarted(loaded, true);
        await fixture.waitForRequests();
        await assert.rejects(fixture.api.applyCanvasReset(pending, input, "new:panel", false, true), /active work/);
    } finally { await fixture.close(); }
});

test("non-GUI Requirements bypass Prototype with both snapshots and a feature-spec handoff", async () => {
    const fixture = await extensionHarness();
    try {
        const state = readyRequirements(fixture.api.createState("sample", "Build a CLI"));
        state.prototypeApproach = { mode: "not-applicable", reason: "Command-line contract only." };
        await fixture.api.persistState(state);
        const completed = await fixture.api.completeLifecycleStage("sample", "requirements", "project:tandem");
        assert.equal(completed.lifecycle.currentStage, "design");
        assert.equal(completed.lifecycle.skippedStages[0].stageId, "prototype");
        assert.equal(completed.lifecycle.outputs.length, 2);
        assert.ok(completed.artifacts.some((artifact) => artifact.id === "draft-feature-spec"));
        assert.notEqual(completed.processing?.action, "build-prototype");
        for (const output of completed.lifecycle.outputs) {
            const snapshot = JSON.parse(await readFile(join(fixture.root, output.path), "utf8"));
            assert.equal(snapshot.result.prototypeApproach.mode, "not-applicable");
        }
    } finally { await fixture.close(); }
});

test("existing GUI validation does not request a separate app", async () => {
    const fixture = await extensionHarness();
    try {
        const state = readyRequirements(fixture.api.createState("sample"));
        state.prototypeApproach = { mode: "validate-existing", reason: "The repository already has a GUI." };
        await fixture.api.persistState(state);
        const pending = await fixture.api.completeLifecycleStage("sample", "requirements", "project:tandem");
        assert.equal(pending.processing.action, "build-prototype");
        await fixture.waitForRequests();
        const request = fixture.requests[0];
        assert.ok(request && typeof request === "object" && "args" in request);
        const prompt = fixture.api.answerFactoryPrompt(request.args);
        assert.match(prompt, /existing GUI/);
        assert.match(prompt, /Do not create a separate prototype app/);
    } finally { await fixture.close(); }
});

test("reopening Preparation invalidates downstream decisions and starts a fresh owned request", async () => {
    const fixture = await extensionHarness();
    try {
        const state = readyRequirements(fixture.api.createState("sample", "Goal"));
        state.lifecycle.outputs = [{ stageId: "prepare", path: "old.json", completedAt: "before" }];
        state.prototypeApproach = { mode: "build", reason: "Old analysis" };
        await fixture.api.persistState(state);
        const reopened = await fixture.api.reopenLifecycleStage("sample", "prepare", "project:tandem");
        assert.equal(reopened.lifecycle.currentStage, "prepare");
        assert.equal(reopened.preparation.status, "starting");
        assert.equal(reopened.decisionGraph.nodes.length, 0);
        assert.equal(reopened.prototypeApproach.mode, "undecided");
        assert.equal(reopened.lifecycle.history[0].path, "old.json");
        assert.notEqual(reopened.generation, state.generation);
        assert.ok(reopened.preparation.processing?.requestId);
        await fixture.waitForRequests();
    } finally { await fixture.close(); }
});
