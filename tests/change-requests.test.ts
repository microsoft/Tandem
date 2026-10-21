import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
    activateChange, applyRequirementsDelta, changeBaselineDigest, readChangeAssessment, readChangeRequests, preserveUnchangedScreens,
    prototypeNeedsChangeUpdate,
    type ChangeAssessment, type ChangeRequest, type RequirementsDelta,
} from "../src/change-requests.js";
import { migrateLifecycle } from "../src/lifecycle.js";
import { newPrototypeFlow } from "../src/prototype-flow.js";
import type { DecisionNode } from "../src/workflow.js";
import { extensionHarness } from "./helpers/extension-harness.js";
import { state as uiState } from "./helpers/react-harness.js";
import { buildChangeAssessmentPrompt } from "../src/planning-prompts.js";
import { emptySketchState } from "../src/sketch.js";
import { sketchDocument } from "./helpers/sketch-lifecycle-fixture.js";
import { requirementsInputDigest } from "../src/requirements-reconciliation.js";

const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));
export function node(id: string, dependencies: string[] = [], answer: string | null = "Keep"): DecisionNode {
    return { id, title: id, dependencies, answer, status: answer ? "answered" : "toAnswer",
        question: { id, text: `Choose ${id}`, rationale: "Observable behavior", choices: ["Keep", "Change", "Minimal"],
            recommended: "Keep", allowFreeText: true, answerPlaceholder: "" } };
}
export function delta(): RequirementsDelta {
    const added = node("save-location", [], null);
    return { usages: { add: ["I want to save and reload a motion sequence."], remove: [] },
        upsert: [{ id: added.id, title: added.title, dependencies: added.dependencies, question: added.question! }],
        remove: [], assumptions: { add: [], remove: [] }, deferred: { add: [], remove: [] }, prototypeApproach: null };
}
export function assessment(): ChangeAssessment {
    return { version: 1, summary: "Add saving and loading without rebuilding the simulation.", reason: "This adds a capability.",
        startStage: "requirements", stages: [{ stage: "requirements", reason: "Define the new saving behavior." },
            { stage: "prototype", reason: "Add the saved-sequence mock interaction." }],
        preserved: ["Joint controls", "Playback", "Chosen appearance"], affectedScreenIds: [], question: null, requirements: delta() };
}
export function proposed(): ChangeRequest {
    return { version: 1, id: "change-one", clientRequestId: "client-one", originStage: "prototype",
        message: "Save and reload motion sequences.", submittedAt: "2026-10-15T12:00:00Z",
        baseCheckpointId: null, baseSketchRevisionId: null, visualSelection: null, sourceResultId: null, sourceRequests: [],
        baselineDigest: "a".repeat(64), analysisId: "analysis-one", assessment: assessment(), status: "proposed",
        error: "", clarifications: [], remainingStages: [], workStarted: [], affectedDecisionIds: [], snapshotPath: null,
        completedAt: null, developmentAdmission: null, developmentRequest: null };
}
function baseState() {
    const state = uiState("prototype");
    state.requirements = { substage: "dag", usageItems: ["I want to move the joints."], suggestions: [] };
    state.decisionGraph = { nodes: [node("joints"), node("playback", ["joints"]), node("appearance")] };
    state.assumed = ["Mock simulation"]; state.deferred = ["Real robot integration"];
    return state;
}

test("a sparse requirements delta preserves every independent accepted answer and retains dependent prior answers", () => {
    const state = baseState();
    const patch = delta();
    const changed = node("joints");
    changed.question!.text = "Choose the changed joint controls";
    patch.upsert.push({ id: changed.id, title: changed.title, dependencies: [], question: changed.question! });
    const result = applyRequirementsDelta(state, patch);
    assert.deepEqual(result.graph.nodes.find(item => item.id === "appearance"), state.decisionGraph.nodes[2]);
    for (const id of ["joints", "playback"]) {
        assert.equal(result.graph.nodes.find(item => item.id === id)?.answer, null);
        assert.equal(result.graph.nodes.find(item => item.id === id)?.review?.previousAnswer, "Keep");
    }
    assert.equal(state.decisionGraph.nodes[0].answer, "Keep", "assessment cannot mutate its baseline");
    assert.deepEqual(result.assumed, state.assumed);
    assert.deepEqual(result.deferred, state.deferred);
    assert.equal(result.graph.nodes.length, 4);
});

test("invalid topology, invented answers, invalid defaults and omitted Requirements routing fail visibly", () => {
    const state = baseState();
    assert.throws(() => applyRequirementsDelta(state, { ...delta(), remove: ["joints"] }), /dependency/);
    const cycle = delta(); cycle.upsert[0].dependencies = ["save-location"];
    assert.throws(() => applyRequirementsDelta(state, cycle), /cycle/);
    assert.throws(() => applyRequirementsDelta(state, { ...delta(), upsert: [{ ...delta().upsert[0], answer: "Invented" }] } as RequirementsDelta), /unexpected fields/);
    const defaults = delta(); defaults.upsert[0].question.recommended = "Unseen";
    assert.throws(() => applyRequirementsDelta(state, defaults), /valid choices/);
    assert.throws(() => readChangeAssessment({ ...assessment(), stages: [{ stage: "prototype", reason: "Wrong" }] }, state), /include Requirements/);
    assert.throws(() => readChangeAssessment({ ...assessment(), startStage: "prototype" }, state), /earliest/);
});

test("scoped activation retains the preview, checkpoints, independent stages and historical output identities", () => {
    const state = baseState();
    state.previewUrl = "http://127.0.0.1:4321/";
    state.previewStatus = "ready"; state.prototypeFlow = newPrototypeFlow();
    state.lifecycle.outputs = [{ stageId: "requirements", path: "requirements-r1.json", completedAt: "before" },
        { stageId: "sketch", path: "sketch-r1.json", completedAt: "before" }];
    const request = proposed(); state.changeRequests = [request];
    const next = activateChange(state, request, "changes\\baseline.json");
    assert.equal(next.generation, state.generation);
    assert.equal(next.previewUrl, state.previewUrl);
    assert.deepEqual(next.prototypeFlow, state.prototypeFlow);
    assert.ok(next.lifecycle.completedStages.includes("sketch"));
    assert.equal(next.lifecycle.history[0].path, "requirements-r1.json");
    assert.deepEqual(migrateLifecycle(next.lifecycle).completedStages, ["prepare", "sketch"]);
    assert.equal(migrateLifecycle(next.lifecycle).currentStage, "requirements");
    assert.equal(next.changeRequests![0].snapshotPath, "changes\\baseline.json");
    assert.equal(next.decisionGraph.nodes.filter(item => item.answer).length, 3);
});

test("change provenance is strict and cosmetic processing updates do not stale an impact proposal", () => {
    const state = baseState();
    const digest = changeBaselineDigest(state);
    assert.equal(changeBaselineDigest({ ...state, processing: { status: "success" }, revision: 9, updatedAt: "later" }), digest);
    assert.notEqual(changeBaselineDigest({ ...state, deferred: ["New deferral"] }), digest);
    assert.deepEqual(readChangeRequests(undefined), []);
    assert.throws(() => readChangeRequests([proposed(), proposed()]), /conflicting identities/);
    assert.throws(() => readChangeRequests([{ ...proposed(), baselineDigest: "invalid" }]), /provenance/);
    assert.throws(() => readChangeRequests([{ ...proposed(), developmentAdmission: "admitted" }]), /immutable request/);
    assert.match(buildChangeAssessmentPrompt({ request: proposed(), project: state }), /ONLY new work/);
    assert.match(buildChangeAssessmentPrompt({ request: proposed(), project: state }), /not proof that you inspected an image/);
});

async function fixture(gitReady = false) {
    const h = await extensionHarness({}, undefined, "", undefined, false, gitReady);
    const initial = h.api.createLegacyState("sample", "Robot simulation");
    Object.assign(initial, { ...baseState(), prototypeId: "sample", generation: initial.generation, revision: 0 });
    initial.sketch = emptySketchState();
    delete initial.lifecycle.version;
    initial.lifecycle.completedStages = ["prepare", "requirements"];
    initial.lifecycle.skippedStages = [];
    initial.previewStatus = "ready"; initial.previewUrl = "http://127.0.0.1:12345/";
    await writeFile(join(h.root, "app.ts"), "export const keep = 'joint controls';\n");
    initial.prototypeFlow = { ...newPrototypeFlow(), displayedCheckpointId: "old-interaction",
        checkpoints: ["structure", "interaction"].map((milestone, index) => ({
            id: `old-${milestone}`, requestId: `old-${milestone}`, generation: initial.generation,
            milestone: milestone as "structure" | "interaction", revisionId: null,
            baseCheckpointId: index ? "old-structure" : null, sourceCheckpointId: index ? "old-structure" : null,
            workspacePath: h.root, workspacePrepared: true, status: "ready" as const,
            previewUrl: initial.previewUrl, summary: `Existing ${milestone}`, focus: "",
            requestedAt: "2026-10-15T00:00:00Z", completedAt: "2026-10-15T00:00:01Z", timeoutSeconds: null,
        })) };
    await h.api.persistState(initial);
    return { h, initial: await h.api.loadState("sample") };
}
function worker(h: Awaited<ReturnType<typeof extensionHarness>>, result: ChangeAssessment) {
    h.api.setSession({ ...h.session, rpc: { ...h.session.rpc, workflow: { run: async (request: any) => {
        h.requests.push(plain(request));
        const runId = `run-${h.requests.length}`;
        if (request.args.action === "assess-change") {
            const output = await h.api.answerFactory.run({ args: request.args, runId, phase() {}, log() {},
                step: (_: string, action: () => Promise<unknown>) => action(),
                agent: async (prompt: string, options: any) => {
                    assert.match(prompt, /Do not use tools/);
                    assert.equal(options.agent, h.api.textWorkerAgent.name);
                    assert.equal(options.schema.properties.requirements.anyOf[0].additionalProperties, false);
                    return plain(result);
                } });
            return { runId, status: "completed", result: output };
        }
        const checkpoint = request.args.state.prototypeFlow.checkpoints.at(-1);
        h.setPreviewHtml(`<meta name="tandem-prototype-id" content="sample"><meta name="tandem-prototype-checkpoint" content="${checkpoint.id}">`);
        return { runId, status: "completed", result: {
            summary: "Only the requested interaction changed.", focus: "Try save and reload.",
            previewUrl: "http://127.0.0.1:12346/", question: null, artifactChanges: { upsert: [], remove: [] }, evidence: [],
        } };
    } } } });
}
async function assess(f: Awaited<ReturnType<typeof fixture>>, result = assessment()) {
    worker(f.h, result);
    const receipt = await f.h.api.submitChangeRequest("sample", "project:tandem", {
        message: "Save and reload motion sequences.", clientRequestId: "request-one",
    });
    await f.h.waitForRequests();
    await f.h.api.waitForAnswer("sample");
    return { receipt, state: await f.h.api.loadState("sample") };
}
function approval(request: ChangeRequest) {
    return { requestId: request.id, analysisId: request.analysisId, baselineDigest: request.baselineDigest, decision: "approve" };
}

test("prototype feedback assesses once and opens a pinned draft without changing accepted work", async () => {
    const f = await fixture();
    try {
        const { receipt, state } = await assess(f);
        assert.equal(state.changeRequests![0].status, "proposed", state.processing.message);
        assert.equal(state.lifecycle.currentStage, "prototype");
        assert.deepEqual(plain(state.decisionGraph), plain(f.initial.decisionGraph));
        assert.deepEqual(plain(state.prototypeFlow), plain(f.initial.prototypeFlow));
        const repeated = await f.h.api.submitChangeRequest("sample", "project:tandem", {
            message: "Save and reload motion sequences.", clientRequestId: "request-one",
        });
        assert.equal(repeated.requestId, receipt.requestId);
        assert.equal(f.h.requests.length, 1);
        const next = await f.h.api.decideChangeRequest("sample", "project:tandem", approval(state.changeRequests![0]));
        assert.equal(next.lifecycle.currentStage, "prototype");
        assert.equal(next.changeRequests![0].status, "reviewing");
        assert.equal(prototypeNeedsChangeUpdate(next), false, "Opening a draft cannot make the accepted legacy preview stale.");
        const draft = await f.h.api.loadState(next.changeRequests![0].reviewId!);
        assert.equal(draft.decisionGraph.nodes.filter(item => item.answer).length, 3);
        assert.equal(draft.question!.id, "save-location");
        assert.deepEqual(plain(next.decisionGraph), plain(f.initial.decisionGraph));
        assert.deepEqual(plain(next.prototypeFlow), plain(f.initial.prototypeFlow));
        const baseline = JSON.parse(await readFile(join(f.h.root, next.changeRequests![0].snapshotPath!), "utf8"));
        assert.equal(baseline.prototypeFlow.displayedCheckpointId, "old-interaction");
        assert.equal(baseline.decisionGraph.nodes.length, 3);
        assert.equal(f.h.requests.length, 1, "approval does not replay the old prototype or interview");
    } finally { await f.h.close(); }
});

test("stale proposals cannot create drafts; private Development permits drafting but blocks Apply", async () => {
    const f = await fixture();
    try {
        const { state } = await assess(f);
        await f.h.api.persistState({ ...state, deferred: [...state.deferred, "A newer decision"] });
        await assert.rejects(f.h.api.decideChangeRequest("sample", "project:tandem", approval(state.changeRequests![0])), /project changed/i);
        const unchanged = await f.h.api.loadState("sample");
        assert.equal(unchanged.lifecycle.currentStage, "prototype");
        assert.equal(unchanged.decisionGraph.nodes.length, 3);
        await f.h.api.persistState({ ...unchanged, deferred: f.initial.deferred });
        f.h.developmentRequests.push({ id: "busy" });
        const reviewing = await f.h.api.decideChangeRequest("sample", "project:tandem", approval(state.changeRequests![0]));
        const draft = await f.h.api.loadState(reviewing.changeRequests![0].reviewId!);
        draft.decisionGraph.nodes.find(item => item.id === "save-location")!.answer = "Keep";
        await f.h.api.persistState(draft);
        await assert.rejects(f.h.api.applyStageReview("sample", "project:tandem", {
            reviewId: draft.prototypeId, expectedRevision: draft.revision,
        }), /Development/);
        assert.equal((await f.h.api.loadState("sample")).lifecycle.currentStage, "prototype");
    } finally { await f.h.close(); }
});

test("cancelling a pinned proposal retains current work and cannot abandon a running draft", async () => {
    const f = await fixture();
    try {
        const { state } = await assess(f);
        const reviewing = await f.h.api.decideChangeRequest("sample", "project:tandem", approval(state.changeRequests![0]));
        const draft = await f.h.api.loadState(reviewing.changeRequests![0].reviewId!);
        draft.processing = { action: "answer-decision", status: "running", requestId: "draft-answer", requestedAt: draft.updatedAt };
        await f.h.api.persistState(draft);
        const decision = { requestId: state.changeRequests![0].id, decision: "cancel" };
        await assert.rejects(f.h.api.decideChangeRequest("sample", "project:tandem", decision), /Finish draft work/);
        await assert.rejects(f.h.api.reopenLifecycleStage("sample", "requirements", "project:tandem"), /review draft work/);
        draft.processing = null; await f.h.api.persistState(draft);
        const current = await f.h.api.loadState("sample");
        current.processing = { action: "build-prototype", status: "running", requestId: "current-work", requestedAt: current.updatedAt };
        await f.h.api.persistState(current);
        const cancelled = await f.h.api.decideChangeRequest("sample", "project:tandem", decision);
        assert.equal(cancelled.changeRequests![0].status, "cancelled");
        assert.equal(cancelled.processing.requestId, "current-work");
        assert.equal(prototypeNeedsChangeUpdate(cancelled), false, "Cancelling an unapplied draft cannot invalidate the accepted preview.");
        assert.deepEqual(cancelled.lifecycle, current.lifecycle);
        assert.deepEqual(cancelled.decisionGraph, current.decisionGraph);
        assert.ok(cancelled.stageReviews?.find(item => item.id === draft.prototypeId)?.discardedAt);
    } finally { await f.h.close(); }
});

test("same-stage revisions use the existing candidate flow and preserve the displayed checkpoint until Apply update", async () => {
    const f = await fixture();
    try {
        const plan: ChangeAssessment = { ...assessment(), startStage: "prototype", requirements: null,
            stages: [{ stage: "prototype", reason: "Appearance stays within the agreed behavior." }] };
        await assess(f, plan);
        await f.h.waitForRequests(2);
        await f.h.api.waitForAnswer("sample");
        const ready = await f.h.api.loadState("sample");
        assert.equal(ready.prototypeFlow!.displayedCheckpointId, "old-interaction");
        assert.ok(ready.prototypeFlow!.pendingCheckpointId);
        assert.equal(ready.decisionGraph.nodes.length, 3);
        assert.equal(ready.changeRequests![0].status, "active");
        assert.match((f.h.requests[1] as any).args.state.changeRequest.message, /Save and reload/);
        const applied = await f.h.api.prototypeAction("sample", "project:tandem", {
            action: "apply-update", checkpointId: ready.prototypeFlow!.pendingCheckpointId,
        });
        assert.equal(applied.changeRequests![0].status, "completed");
        assert.equal(applied.previewUrl, "http://127.0.0.1:12346/");
        assert.equal(await readFile(join(f.h.root, "app.ts"), "utf8"), "export const keep = 'joint controls';\n");
    } finally { await f.h.close(); }
});

test("cancelling a proposed change preserves the baseline and does not start a revision", async () => {
    const f = await fixture();
    try {
        const { state } = await assess(f);
        const next = await f.h.api.decideChangeRequest("sample", "project:tandem", {
            requestId: state.changeRequests![0].id, decision: "cancel",
        });
        assert.equal(next.changeRequests![0].status, "cancelled");
        assert.equal(next.lifecycle.currentStage, "prototype");
        assert.deepEqual(plain(next.decisionGraph), plain(f.initial.decisionGraph));
        assert.equal(f.h.requests.length, 1);
    } finally { await f.h.close(); }
});

test("public prototype feedback reaches impact assessment rather than the writable checkpoint worker", async () => {
    const f = await fixture();
    const server = await f.h.api.startServer("change-http", "sample", "project:tandem", true);
    try {
        worker(f.h, assessment());
        const response = await fetch(new URL("/api/revision", server.url), { method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ suggestion: "Add save and reload.", clientRequestId: "http-change", baseCheckpointId: "old-interaction" }) });
        assert.equal(response.status, 202);
        const receipt = await response.json();
        await f.h.api.waitForAnswer("sample");
        const state = await f.h.api.loadState("sample");
        assert.equal(state.changeRequests![0].id, receipt.requestId);
        assert.equal(state.changeRequests![0].status, "proposed");
        assert.equal((f.h.requests[0] as any).args.action, "assess-change");
        assert.equal(state.prototypeReview.revisions.length, 0);
        assert.equal(state.lifecycle.currentStage, "prototype");
    } finally {
        clearInterval(server.heartbeat);
        await new Promise<void>(resolve => server.server.close(() => resolve()));
        await f.h.close();
    }
});

test("applying a draft usage keeps Prototype current and builds a delta only when explicitly requested", async () => {
    const f = await fixture();
    try {
        const plan = assessment(); plan.requirements!.upsert = [];
        const { state } = await assess(f, plan);
        const changed = await f.h.api.decideChangeRequest("sample", "project:tandem", approval(state.changeRequests![0]));
        const draft = await f.h.api.loadState(changed.changeRequests![0].reviewId!);
        assert.equal(draft.question, null, "an unambiguous new usage does not repeat answered questions");
        const accepted = await f.h.api.applyStageReview("sample", "project:tandem", {
            reviewId: draft.prototypeId, expectedRevision: draft.revision,
        });
        assert.equal(accepted.lifecycle.currentStage, "prototype");
        assert.equal(f.h.requests.length, 1, "Apply does not start another preview.");
        await f.h.api.beginPrototypeBuild("sample", "project:tandem");
        await f.h.waitForRequests(2); await f.h.api.waitForAnswer("sample");
        const ready = await f.h.api.loadState("sample");
        const checkpoint = ready.prototypeFlow!.checkpoints.at(-1)!;
        assert.equal(checkpoint.sourceCheckpointId, "old-interaction");
        assert.equal(checkpoint.milestone, "interaction");
        assert.equal(checkpoint.requirementsDigest, requirementsInputDigest(ready));
        assert.equal(ready.prototypeFlow!.displayedCheckpointId, "old-interaction");
        assert.deepEqual(plain(ready.decisionGraph), plain(f.initial.decisionGraph));
        const applied = await f.h.api.prototypeAction("sample", "project:tandem", { action: "apply-update", checkpointId: checkpoint.id });
        assert.equal(f.h.api.stageCompletionError(applied, "prototype", { requirePrototypeSpec: false }), null);
        assert.equal(f.h.requests.length, 2, "only assessment and the requested delta ran");
    } finally { await f.h.close(); }
});

test("scoped drawing results cannot modify unrelated manual screen content", () => {
    const previous = sketchDocument(), changed = plain(previous);
    changed.screens[0].notes = "Unrequested rewrite";
    const scope = proposed();
    assert.throws(() => preserveUnchangedScreens(previous, changed, scope), /unrelated screen/);
    scope.assessment!.affectedScreenIds = ["main"];
    assert.doesNotThrow(() => preserveUnchangedScreens(previous, changed, scope));
    assert.throws(() => preserveUnchangedScreens(previous, { ...previous, screens: [] }, proposed()), /unrelated screen/);
});

test("uncertain native delivery reconciles one immutable change request without replay or losing its context", async () => {
    const f = await fixture(true);
    try {
        const plan: ChangeAssessment = { ...assessment(), requirements: null, startStage: "development",
            stages: [{ stage: "development", reason: "Restore the agreed implementation behavior." }] };
        const { state } = await assess(f, plan);
        await f.h.api.decideChangeRequest("sample", "project:tandem", approval(state.changeRequests![0]));
        f.h.setDevelopmentSend(async request => { f.h.developmentRequests.push(request); throw new Error("Lost acknowledgement"); });
        await assert.rejects(f.h.api.sendChangeToDevelopment("sample", "project:tandem", state.changeRequests![0].id), /Lost acknowledgement/);
        const uncertain = await f.h.api.loadState("sample");
        assert.equal(uncertain.changeRequests![0].developmentAdmission, "uncertain");
        const envelope = plain(uncertain.changeRequests![0].developmentRequest);
        await f.h.api.persistState({ ...uncertain, deferred: [...uncertain.deferred, "A newer context entry"] });
        const admitted = await f.h.api.sendChangeToDevelopment("sample", "project:tandem", state.changeRequests![0].id);
        assert.equal(admitted.changeRequests![0].developmentAdmission, "admitted");
        assert.deepEqual(plain(admitted.changeRequests![0].developmentRequest), envelope);
        assert.equal(f.h.developmentRequests.length, 1);
        assert.match(String(f.h.developmentRequests[0].message), /Save and reload motion sequences/);
    } finally { await f.h.close(); }
});
