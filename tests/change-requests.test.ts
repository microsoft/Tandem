import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
    activateChange, applyRequirementsDelta, changeBaselineDigest, readChangeAssessment, readChangeRequests, preserveUnchangedScreens,
    prototypeNeedsChangeUpdate, activeChange, pendingChange, nextChangeWork, readSketchChangeContext, isLocalChange,
    type ChangeAssessment, type ChangeRequest, type RequirementsDelta,
} from "../src/change-requests.js";
import { migrateLifecycle } from "../src/lifecycle.js";
import { newPrototypeFlow } from "../src/prototype-flow.js";
import type { DecisionNode } from "../src/workflow.js";
import { extensionHarness } from "./helpers/extension-harness.js";
import { state as uiState } from "./helpers/react-harness.js";
import { buildChangeAssessmentPrompt } from "../src/planning-prompts.js";
import { emptySketchState } from "../src/sketch.js";
import { SketchStore } from "../src/sketch-store.js";
import { sketchDocument } from "./helpers/sketch-lifecycle-fixture.js";
import { addUi } from "./helpers/ui-dsl-fixture.js";
import { requirementsInputDigest } from "../src/requirements-reconciliation.js";
import { changeReviewBlocksEditing, changeReviewNeedsAttention, currentChangeReview, pendingUpstreamReviewStage } from "../src/change-request-policy.js";

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

test("legacy saved previews are included in requirements and design review paths", () => {
    const state = baseState();
    state.previewUrl = "http://127.0.0.1:4321/";
    state.previewStatus = "ready";
    assert.equal(state.prototypeFlow, null);
    const requirements = assessment();
    requirements.stages = [{ stage: "requirements", reason: "Add the requested usage." }];
    assert.deepEqual(readChangeAssessment(requirements, state).stages.map(item => item.stage), ["requirements", "prototype"]);
    assert.deepEqual(readChangeAssessment({ ...requirements, requirements: null, startStage: "sketch",
        stages: [{ stage: "sketch", reason: "Change the agreed layout." }] }, state).stages.map(item => item.stage), ["sketch", "prototype"]);
    assert.equal(requirements.stages.length, 1, "Normalization must not rewrite the worker's input.");
});

test("unchanged Requirements patches cannot create empty reviews, while real no-question deltas and ambiguities remain valid", () => {
    const state = baseState();
    const plan = assessment();
    plan.requirements!.upsert = [];
    plan.requirements!.usages.add = [...state.requirements.usageItems];
    assert.throws(() => readChangeAssessment(plan, state), /makes no saved changes/);
    assert.equal(readChangeAssessment({ ...plan, question: "Which behavior should change?" }, state).question, "Which behavior should change?");
    plan.requirements!.remove = ["appearance"];
    plan.requirements!.assumptions = { add: ["Keep data local"], remove: ["Mock simulation"] };
    plan.requirements!.deferred = { add: ["Cloud storage"], remove: ["Real robot integration"] };
    const result = applyRequirementsDelta(state, readChangeAssessment(plan, state).requirements!);
    assert.equal(result.graph.nodes.every(item => item.answer === "Keep"), true);
    assert.deepEqual(result.assumed, ["Keep data local"]);
    assert.deepEqual(result.deferred, ["Cloud storage"]);
    assert.deepEqual(result.affected, ["appearance"]);
});

test("prototype freshness follows saved input bindings, including legacy previews and partially cancelled reviews", async t => {
    const { h, initial } = await fixture(); t.after(() => h.close());
    const state = structuredClone(initial);
    const displayed = state.prototypeFlow!.checkpoints.find(item => item.id === state.prototypeFlow!.displayedCheckpointId)!;
    displayed.requirementsDigest = requirementsInputDigest(state);
    assert.equal(prototypeNeedsChangeUpdate(state), false);
    state.assumed.push("An accepted changed constraint");
    assert.equal(prototypeNeedsChangeUpdate(state), true, "Changed bindings cannot rely on a lifecycle marker to become stale.");
    state.assumed.pop();
    assert.equal(prototypeNeedsChangeUpdate(state), false);
    const request = { ...proposed(), status: "cancelled" as const, snapshotPath: "changes\\baseline.json" };
    state.changeRequests = [request];
    delete displayed.requirementsDigest;
    assert.equal(prototypeNeedsChangeUpdate(state), true, "Cancelling remaining work does not undo an already saved requirements patch.");
    state.changeRequests = [];
    state.prototypeFlow = null;
    assert.equal(prototypeNeedsChangeUpdate(state), false, "Unchanged legacy previews remain inspectable.");
    state.lifecycle.reviewId = "review-11111111-1111-4111-8111-111111111111";
    assert.equal(prototypeNeedsChangeUpdate(state), true, "A reviewed legacy preview has no current input evidence.");
    state.prototypeApproach.mode = "not-applicable";
    assert.equal(prototypeNeedsChangeUpdate(state), false, "A bypassed prototype must not acquire a mandatory build.");
});

test("an accepted change needs its own applied prototype revision even when requirement inputs already match", async t => {
    const { h, initial } = await fixture(); t.after(() => h.close());
    const state = structuredClone(initial);
    const displayed = state.prototypeFlow!.checkpoints.find(item => item.id === state.prototypeFlow!.displayedCheckpointId)!;
    displayed.requirementsDigest = requirementsInputDigest(state);
    const request = { ...proposed(), status: "reviewing" as const, remainingStages: ["prototype" as const],
        reviewId: "review-11111111-1111-4111-8111-111111111111" };
    state.changeRequests = [request];
    assert.equal(prototypeNeedsChangeUpdate(state), true);
    const revision = { id: "requested-revision", clientRequestId: `change-${request.id}`, checkpointId: "prepared", status: "ready" };
    state.prototypeReview.revisions = [revision];
    const prepared = { ...displayed, id: "prepared", requestId: "prepared", revisionId: revision.id };
    state.prototypeFlow!.checkpoints.push(prepared);
    state.prototypeFlow!.pendingCheckpointId = prepared.id;
    assert.equal(prototypeNeedsChangeUpdate(state), true, "A prepared candidate is not an applied change.");
    revision.status = "applied";
    state.prototypeFlow!.displayedCheckpointId = prepared.id;
    state.prototypeFlow!.pendingCheckpointId = null;
    assert.equal(prototypeNeedsChangeUpdate(state), false);
    prepared.revisionId = "unrelated-revision";
    assert.equal(prototypeNeedsChangeUpdate(state), true, "An unrelated checkpoint cannot satisfy this request.");
});

test("review routing finds the earliest invalidated stage and respects skipped stages and pinned drafts", () => {
    const state = baseState();
    state.lifecycle.reviewId = "review-11111111-1111-4111-8111-111111111111";
    state.lifecycle.completedStages = ["prepare"];
    assert.equal(pendingUpstreamReviewStage(state), "requirements");
    state.lifecycle.completedStages.push("requirements");
    assert.equal(pendingUpstreamReviewStage(state), "sketch");
    state.lifecycle.skippedStages.push({ stageId: "sketch", reason: "Legacy stage was not used.", skippedAt: state.updatedAt });
    assert.equal(pendingUpstreamReviewStage(state), undefined);
    state.lifecycle.skippedStages = [];
    state.stageReview = { version: 1, parentId: "parent", stage: "prototype",
        baselineDigest: "a".repeat(64), baselineRevision: 1 };
    assert.equal(pendingUpstreamReviewStage(state), undefined, "A pinned draft retains its independent stage scope.");
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

test("automatic graphical edits cannot bypass ambiguity, another stage or completed agreements", () => {
    const state = baseState(), request = proposed();
    request.assessment = { ...assessment(), startStage: "prototype", requirements: null,
        stages: [{ stage: "prototype", reason: "Adjust the existing mock preview." }] };
    assert.equal(isLocalChange(state, request), true);
    for (const plan of [
        { ...request.assessment, question: "Which of the two panels should change?" },
        assessment(),
        { ...request.assessment, stages: [{ stage: "sketch" as const, reason: "Review accepted designs." }] },
        { ...request.assessment, stages: [...request.assessment.stages, { stage: "development" as const, reason: "Reconcile implemented behavior." }] },
    ]) assert.equal(isLocalChange(state, { ...request, assessment: plan }), false);
    assert.equal(isLocalChange({ ...state, lifecycle: { ...state.lifecycle, currentStage: "development" } }, request), false);
    assert.equal(isLocalChange({ ...state, lifecycle: { ...state.lifecycle, completedStages: [...state.lifecycle.completedStages, "prototype"] } }, request), false);
});

test("runnable work and stage-completion blockers remain distinct when changes coexist", () => {
    const active = { ...proposed(), status: "active" as const };
    const waiting = { ...proposed(), id: "waiting", clientRequestId: "waiting-client", status: "queued" as const };
    const state = { changeRequests: [active, waiting] };
    assert.equal(nextChangeWork(state)!.id, active.id);
    assert.equal(pendingChange(state)!.id, waiting.id, "An active change cannot hide unreviewed work from stage completion.");
    const deferred = { ...waiting, status: "deferred" as const };
    assert.equal(pendingChange({ changeRequests: [deferred] }), undefined);
    assert.equal(nextChangeWork({ changeRequests: [{ ...active, status: "proposed" }, waiting] }), undefined,
        "Saved queued work waits behind the single pending review.");
});

function historicalDevelopmentChange(status: ChangeRequest["status"] = "queued"): ChangeRequest {
    return { ...proposed(), id: "old-development", clientRequestId: "old-development-client", originStage: "development",
        status, sourceResultId: "old-router-result", sketchContext: null,
        sourceRequests: [{ id: "original-development-request", message: "Add saving while keeping joint controls.",
            receivedAt: "2026-10-19T00:00:00Z", context: JSON.stringify({ answers: null, attachments: [] }) }],
        reviewId: status === "reviewing" ? "review-11111111-1111-4111-8111-111111111111" : null,
        remainingStages: ["requirements", "prototype"] };
}

test("historical Development impact requests are readable but never own discovery work or review gates", () => {
    for (const status of ["queued", "analyzing", "proposed", "reviewing", "active", "failed", "deferred", "completed", "cancelled"] as const) {
        const historical = historicalDevelopmentChange(status);
        const state = { ...baseState(), changeRequests: readChangeRequests([historical]) };
        assert.deepEqual(state.changeRequests, [historical], status);
        assert.equal(currentChangeReview(state), undefined, status);
        assert.equal(activeChange(state), undefined, status);
        assert.equal(pendingChange(state), undefined, status);
        assert.equal(nextChangeWork(state), undefined, status);
        assert.equal(changeReviewBlocksEditing(state), false, status);
        assert.equal(changeReviewNeedsAttention(state), false, status);
        assert.throws(() => activateChange(state, historical, "changes\\unused.json"), /Development requests no longer enter upstream impact review/);
        const current = { ...proposed(), status: "active" as const };
        state.changeRequests = readChangeRequests([historical, current]);
        assert.equal(activeChange(state)!.id, current.id, status);
        assert.equal(nextChangeWork(state)!.id, current.id, status);
    }
});

test("the single review gate permits inspection and the work needed to finish its own stage", () => {
    const state = baseState();
    const review: ChangeRequest = { ...proposed(), status: "reviewing", remainingStages: ["requirements", "prototype"] };
    state.changeRequests = [{ ...proposed(), id: "legacy-question", clientRequestId: "legacy-client" }, review];
    assert.equal(currentChangeReview(state)!.id, review.id);
    assert.equal(changeReviewNeedsAttention(state), true);
    assert.equal(changeReviewBlocksEditing(state), true);
    review.remainingStages = ["prototype"];
    assert.equal(changeReviewBlocksEditing(state), false, "The required current-stage update must not be blocked by its own review.");
    review.status = "active";
    state.stageReview = { version: 1, parentId: "sample", stage: "prototype",
        baselineDigest: "a".repeat(64), baselineRevision: 1, changeRequestId: review.id };
    state.changeRequests = [review];
    assert.equal(currentChangeReview(state), undefined, "An admitted pinned draft may be refined without creating a second parent review.");
    state.changeRequests.push({ ...proposed(), id: "draft-question", clientRequestId: "draft-question-client" });
    assert.equal(changeReviewBlocksEditing(state), true, "Unresolved questions created inside the draft must still be resolved.");
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
function worker(h: Awaited<ReturnType<typeof extensionHarness>>, result: ChangeAssessment, sessionId = h.session.sessionId) {
    h.api.setSession({ ...h.session, sessionId, rpc: { ...h.session.rpc, workflow: { run: async (request: any) => {
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

test("already-satisfied requests finish assessment without creating an empty draft or rebuilding a preview", async t => {
    const f = await fixture(); t.after(() => f.h.close());
    const { state } = await assess(f, { ...assessment(), startStage: "none", stages: [], requirements: null,
        summary: "The requested behavior is already part of the accepted work." });
    assert.equal(state.changeRequests![0].status, "completed");
    assert.deepEqual(plain(state.lifecycle), plain(f.initial.lifecycle));
    assert.deepEqual(plain(state.decisionGraph), plain(f.initial.decisionGraph));
    assert.equal(state.stageReviews?.length ?? 0, 0);
    assert.equal(prototypeNeedsChangeUpdate(state), false);
    assert.equal(f.h.requests.length, 1);
});

for (const feedback of [false, true]) test(`a queued change waits behind an ${feedback ? "existing feedback update" : "automatic checkpoint"} without blocking its application`, async t => {
    const f = await fixture(); t.after(() => f.h.close());
    const source = f.initial.prototypeFlow!.checkpoints.at(-1)!;
    const prepared = { ...source, id: "previous-update", requestId: "previous-update",
        baseCheckpointId: source.id, sourceCheckpointId: source.id, revisionId: feedback ? "previous-feedback" : null,
        requirementsDigest: requirementsInputDigest(f.initial) };
    f.initial.prototypeFlow!.checkpoints.push(prepared);
    f.initial.prototypeFlow!.pendingCheckpointId = prepared.id;
    if (feedback) f.initial.prototypeReview.revisions = [{
        id: "previous-feedback", suggestion: "Improve the playback label.", status: "ready", summary: "Prepared label.",
        clientRequestId: "previous-feedback-client", baseCheckpointId: source.id, checkpointId: prepared.id,
        clarifications: [], submittedAt: f.initial.updatedAt, completedAt: f.initial.updatedAt,
    }];
    await f.h.api.persistState(f.initial);
    worker(f.h, assessment());
    const receipt = await f.h.api.submitChangeRequest("sample", "project:tandem", {
        message: "Save and reload sequences.", clientRequestId: "queued-after-update",
    });
    const queued = await f.h.api.loadState("sample");
    assert.equal(queued.changeRequests![0].status, "queued");
    assert.equal(f.h.requests.length, 0, "Assessment must wait until the earlier candidate is resolved.");
    assert.equal(changeReviewBlocksEditing(queued), false, "The queued request cannot lock the action it is waiting for.");
    f.h.setPreviewHtml(`<meta name="tandem-prototype-id" content="sample"><meta name="tandem-prototype-checkpoint" content="${prepared.id}">`);
    await f.h.api.prototypeAction("sample", "project:tandem", { action: "apply-update", checkpointId: prepared.id });
    await f.h.waitForRequests(); await f.h.api.waitForAnswer("sample");
    const assessed = await f.h.api.loadState("sample");
    assert.equal(assessed.prototypeFlow!.displayedCheckpointId, prepared.id);
    assert.equal(assessed.changeRequests![0].id, receipt.requestId);
    assert.equal(assessed.changeRequests![0].status, "proposed");
    assert.equal(changeReviewBlocksEditing(assessed), true, "Only the predecessor work is exempt from the review gate.");
    assert.equal(f.h.requests.length, 1);
});

test("a queued change leaves the existing prototype clarification answerable and waits for its candidate", async t => {
    const f = await fixture(); t.after(() => f.h.close());
    const source = f.initial.prototypeFlow!.checkpoints.at(-1)!;
    const question = { id: "playback-detail", text: "Which playback label?", choices: ["Start", "Play", "Run"],
        recommended: "Play", rationale: "", allowFreeText: true, answerPlaceholder: "" };
    f.initial.prototypeReview.question = question;
    f.initial.prototypeReview.activeRevisionId = "previous-feedback";
    f.initial.prototypeReview.revisions = [{
        id: "previous-feedback", suggestion: "Improve playback.", status: "clarifying", summary: "",
        clientRequestId: "previous-client", baseCheckpointId: source.id, checkpointId: null,
        clarifications: [], submittedAt: f.initial.updatedAt, completedAt: null,
    }];
    await f.h.api.persistState(f.initial);
    worker(f.h, assessment());
    await f.h.api.submitChangeRequest("sample", "project:tandem", {
        message: "Save and reload sequences.", clientRequestId: "queued-after-question",
    });
    assert.equal(f.h.requests.length, 0);
    const server = await f.h.api.startServer("queued-clarification-http", "sample", "project:tandem", true);
    t.after(async () => {
        clearInterval(server.heartbeat);
        await new Promise<void>(resolve => { server.server.close(() => resolve()); server.server.closeAllConnections(); });
    });
    const response = await fetch(new URL("/api/answer", server.url), { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clarify-revision", questionId: question.id, answer: "Play" }) });
    assert.equal(response.status, 202, await response.text());
    await f.h.waitForRequests(); await f.h.api.waitForAnswer("sample");
    const ready = await f.h.api.loadState("sample");
    assert.ok(ready.prototypeFlow!.pendingCheckpointId, ready.processing.message);
    assert.equal(ready.changeRequests![0].status, "queued");
    assert.deepEqual(plain(ready.prototypeReview.revisions[0].clarifications), [{ question: question.text, answer: "Play" }]);
    await f.h.api.prototypeAction("sample", "project:tandem", { action: "apply-update", checkpointId: ready.prototypeFlow!.pendingCheckpointId });
    await f.h.waitForRequests(2); await f.h.api.waitForAnswer("sample");
    assert.equal((await f.h.api.loadState("sample")).changeRequests![0].status, "proposed");
    assert.equal(f.h.requests.length, 2);
});

test("an upstream draft cannot strand a prepared prototype on older inputs", async t => {
    const f = await fixture(); t.after(() => f.h.close());
    const source = f.initial.prototypeFlow!.checkpoints.at(-1)!;
    const prepared = { ...source, id: "prepared-before-review", requestId: "prepared-before-review",
        baseCheckpointId: source.id, sourceCheckpointId: source.id, requirementsDigest: requirementsInputDigest(f.initial) };
    f.initial.prototypeFlow!.checkpoints.push(prepared);
    f.initial.prototypeFlow!.pendingCheckpointId = prepared.id;
    await f.h.api.persistState(f.initial);
    const draft = await f.h.api.openStageReview("sample", "project:tandem", {
        stageId: "requirements", expectedGeneration: f.initial.generation,
    });
    draft.requirements.usageItems.push("I want to save a sequence.");
    await f.h.api.persistState(draft);
    await assert.rejects(f.h.api.applyStageReview("sample", "project:tandem", {
        reviewId: draft.prototypeId, expectedRevision: draft.revision,
    }), /show the prepared prototype update/);
    assert.equal((await f.h.api.loadState("sample")).prototypeFlow!.pendingCheckpointId, prepared.id);
    f.h.setPreviewHtml(`<meta name="tandem-prototype-id" content="sample"><meta name="tandem-prototype-checkpoint" content="${prepared.id}">`);
    await f.h.api.prototypeAction("sample", "project:tandem", { action: "apply-update", checkpointId: prepared.id });
    const accepted = await f.h.api.applyStageReview("sample", "project:tandem", {
        reviewId: draft.prototypeId, expectedRevision: draft.revision,
    });
    assert.equal(accepted.prototypeFlow!.displayedCheckpointId, prepared.id);
    assert.equal(prototypeNeedsChangeUpdate(accepted), true);
    assert.equal(f.h.requests.length, 0);
});

test("composed Development receives retained handoffs without a live baseline or settlement callback", async () => {
    const f = await fixture();
    try {
        await writeFile(join(f.h.root, ".tandem", "current.json"), JSON.stringify({ version: 1, prototypeId: "sample" }));
        assert.equal("onHandoffSettled" in f.h.developmentOptions, false);
        assert.deepEqual(plain(await f.h.developmentOptions.contextProvider()), []);
        assert.equal(f.h.requests.length, 0);
        assert.equal(f.h.developmentRequests.length, 0);
        assert.deepEqual(plain((await f.h.api.loadState("sample")).decisionGraph), plain(f.initial.decisionGraph));
    } finally { await f.h.close(); }
});

test("Development cannot submit a new impact request through either the host or HTTP path", async () => {
    const f = await fixture();
    try {
        const initial: typeof f.initial = { ...f.initial, stage: "development", lifecycle: { ...f.initial.lifecycle,
            currentStage: "development" as const, completedStages: ["prepare", "requirements", "sketch", "prototype"] } };
        await f.h.api.persistState(initial);
        const input = { message: "Add saving and loading.", clientRequestId: "from-development" };
        await assert.rejects(f.h.api.submitChangeRequest("sample", "project:tandem", input), /Development conversation/);
        await assert.rejects(f.h.api.submitChangeRequest("sample", "project:tandem", { ...input, originStage: "prototype" }),
            /Development conversation/, "A stale Prototype control cannot submit impact review after the Development transition.");
        const server = await f.h.api.startServer("development-review-boundary", "sample", "project:tandem", true);
        try {
            const response = await fetch(new URL("/api/change-requests", server.url), {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...input, originStage: "development" }),
            });
            assert.equal(response.ok, false);
            assert.match((await response.json()).error, /Development conversation/);
        } finally {
            clearInterval(server.heartbeat);
            await new Promise<void>(resolve => { server.server.close(() => resolve()); server.server.closeAllConnections(); });
        }
        assert.equal(f.h.requests.length, 0);
        assert.equal(f.h.developmentRequests.length, 0);
        assert.deepEqual(plain((await f.h.api.loadState("sample")).changeRequests), []);
    } finally { await f.h.close(); }
});

test("retained Development requests do not resume, block a Prototype request or expose old mutation paths", async () => {
    const f = await fixture();
    try {
        const historical = historicalDevelopmentChange();
        await f.h.api.persistState({ ...f.initial, changeRequests: [historical] });
        await f.h.api.continueChangeWork("sample");
        assert.equal(f.h.requests.length, 0, "Loading an old Development queue must not schedule an upstream assessment.");
        for (const decision of ["approve", "retry", "cancel", "clarify", "refine", "defer"]) {
            await assert.rejects(f.h.api.decideChangeRequest("sample", "project:tandem", {
                ...approval(historical), decision, answer: "Retained context, not a new request.",
            }), /read-only/);
        }
        await assert.rejects(f.h.api.openStageReview("sample", "project:tandem", {
            stageId: "requirements", expectedGeneration: f.initial.generation, changeRequestId: historical.id,
            analysisId: historical.analysisId, baselineDigest: historical.baselineDigest,
        }), /read-only/);
        await assert.rejects(f.h.api.sendChangeToDevelopment("sample", "project:tandem", historical.id), /read-only/);
        assert.equal(f.h.developmentRequests.length, 0);
        const { receipt, state } = await assess(f);
        assert.equal(state.changeRequests!.find(item => item.id === receipt.requestId)!.status, "proposed");
        assert.equal(f.h.requests.length, 1, "Only the new Prototype request receives impact review.");
        assert.deepEqual(plain(state.changeRequests!.find(item => item.id === historical.id)), historical);
        assert.deepEqual(plain(state.decisionGraph), plain(f.initial.decisionGraph));
    } finally { await f.h.close(); }
});

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

test("an About Us Requirements draft applies while an older design clarification stays unresolved", async () => {
    const f = await fixture();
    try {
        const parent = { ...f.initial, stage: "sketch" as const,
            lifecycle: { ...f.initial.lifecycle, currentStage: "sketch" as const,
                completedStages: ["prepare" as const, "requirements" as const], skippedStages: [] },
            prototypeFlow: null, previewUrl: null, previewStatus: "waiting" as const };
        const document = sketchDocument();
        document.screens[0].decisionIds = ["joints"];
        const store = new SketchStore(f.h.root);
        const revision = await store.save("sample", document, {
            requirementsDigest: requirementsInputDigest(parent), source: "generated", number: 1,
        });
        parent.sketch = { ...emptySketchState(), current: revision, history: [revision], status: "draft" };
        const icon: ChangeRequest = { ...proposed(), originStage: "sketch", message: "Add some icon to replace the illustrative block.",
            baseSketchRevisionId: revision.id, baselineDigest: changeBaselineDigest(parent),
            assessment: { ...assessment(), startStage: "sketch", stages: [{ stage: "sketch", reason: "Replace the identified illustration." }],
                question: "Which screen and illustrative block should the icon replace?", requirements: null },
            clarifications: [{ question: "What should be preserved?", answer: "Keep the existing menu." }] };
        await f.h.api.persistState(parent);
        const plan = assessment();
        plan.requirements!.upsert = [];
        plan.requirements!.usages.add = ["I want to learn about the coffee shop on an About Us page."];
        plan.stages = [{ stage: "requirements", reason: "Add the requested About Us information." },
            { stage: "sketch", reason: "Add the page and its navigation." }];
        worker(f.h, plan);
        const { requestId } = await f.h.api.submitChangeRequest("sample", "project:tandem", {
            message: "Create a page of about us.", clientRequestId: "about-us-request", originStage: "sketch",
        });
        await f.h.api.waitForAnswer("sample");
        const assessed = await f.h.api.loadState("sample");
        await f.h.api.persistState({ ...assessed, changeRequests: [icon, ...assessed.changeRequests!] });
        const about = assessed.changeRequests!.find(item => item.id === requestId)!;
        const reviewing = await f.h.api.decideChangeRequest("sample", "project:tandem", approval(about));
        const draft = await f.h.api.loadState(reviewing.changeRequests!.find(item => item.id === requestId)!.reviewId!);
        assert.equal(draft.question, null, "The explicit About Us addition does not need invented answers.");
        assert.equal(pendingChange(reviewing)!.id, icon.id);
        const server = await f.h.api.startServer("independent-apply", "sample", "project:tandem", true);
        let result: typeof parent;
        try {
            const statusResponse = await fetch(new URL(`/api/reviews/${draft.prototypeId}/state`, server.url));
            assert.equal(statusResponse.status, 200);
            const status = await statusResponse.json();
            assert.equal(status.stageReviewStatus.blocker, null, "An unanswered parent question cannot disable a ready draft.");
            const applied = await fetch(new URL("/api/reviews/apply", server.url), {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ reviewId: draft.prototypeId, expectedRevision: draft.revision }),
            });
            const body = await applied.json();
            assert.equal(applied.status, 200, body.error);
            result = body;
        } finally {
            clearInterval(server.heartbeat);
            await new Promise<void>(resolve => { server.server.close(() => resolve()); server.server.closeAllConnections(); });
        }
        assert.equal(result.lifecycle.currentStage, "sketch");
        assert.ok(result.requirements.usageItems.includes(plan.requirements!.usages.add[0]));
        assert.deepEqual(plain(result.decisionGraph), plain(parent.decisionGraph));
        assert.deepEqual(plain(result.changeRequests!.find(item => item.id === icon.id)),
            plain(reviewing.changeRequests!.find(item => item.id === icon.id)), "The unanswered icon request is neither applied, cancelled nor silently deferred.");
        const remaining = result.changeRequests!.find(item => item.id === requestId)!;
        assert.equal(remaining.status, "reviewing");
        assert.deepEqual(plain(remaining.remainingStages), ["sketch"]);
        assert.ok(result.stageReviews!.find(item => item.id === draft.prototypeId)!.appliedAt);
        assert.equal(result.sketch.current!.id, revision.id);
        assert.equal(result.sketch.status, "stale", "Only the now-outdated design approval needs follow-up.");
        assert.deepEqual(await store.read("sample", revision), document);
        assert.equal(f.h.requests.length, 1, "Apply cannot replay assessment, start design work or answer the old question.");
        assert.doesNotMatch(f.h.api.stageCompletionError(result, "sketch") ?? "", /saved change request/,
            "The current review's remaining Designs work can finish before a legacy queued review takes focus.");
    } finally { await f.h.close(); }
});

test("applying a pinned draft retains queued, failed and unapplied proposals and stales their old approvals", async () => {
    const f = await fixture();
    try {
        const plan = assessment();
        plan.requirements!.upsert = [];
        const { state } = await assess(f, plan);
        const reviewing = await f.h.api.decideChangeRequest("sample", "project:tandem", approval(state.changeRequests![0]));
        const draft = await f.h.api.loadState(reviewing.changeRequests![0].reviewId!);
        const existing = (["queued", "failed", "proposed", "deferred"] as const).map((status, index): ChangeRequest => ({
            ...proposed(), id: `unapplied-${index}`, clientRequestId: `unapplied-client-${index}`,
            status, message: `Independent saved request ${index}`,
            baselineDigest: changeBaselineDigest(reviewing),
        }));
        await f.h.api.persistState({ ...reviewing, changeRequests: [...reviewing.changeRequests!, ...existing] });
        const before = await f.h.api.loadState("sample");
        const result = await f.h.api.applyStageReview("sample", "project:tandem", {
            reviewId: draft.prototypeId, expectedRevision: draft.revision,
        });
        assert.deepEqual(plain(result.changeRequests!.slice(1)), plain(before.changeRequests!.slice(1)));
        assert.deepEqual(plain(result.prototypeFlow), plain(before.prototypeFlow));
        assert.deepEqual(plain(result.factoryRuns), plain(before.factoryRuns));
        assert.equal(result.lifecycle.currentStage, "prototype");
        const stale = result.changeRequests!.find(item => item.id === "unapplied-2")!;
        assert.notEqual(stale.baselineDigest, changeBaselineDigest(result));
        await assert.rejects(f.h.api.decideChangeRequest("sample", "project:tandem", approval(stale)), /project changed/i);
        assert.equal(f.h.requests.length, 1);
    } finally { await f.h.close(); }
});

test("an approved active change still blocks pinned Apply even when an older proposal is waiting", async () => {
    const f = await fixture();
    try {
        const plan = assessment();
        plan.requirements!.upsert = [];
        const { state } = await assess(f, plan);
        const reviewing = await f.h.api.decideChangeRequest("sample", "project:tandem", approval(state.changeRequests![0]));
        const draft = await f.h.api.loadState(reviewing.changeRequests![0].reviewId!);
        const waiting: ChangeRequest = { ...proposed(), id: "waiting", clientRequestId: "waiting-client",
            assessment: { ...assessment(), question: "Which item?" } };
        const active: ChangeRequest = { ...proposed(), id: "active", clientRequestId: "active-client", status: "active",
            workStarted: ["prototype"], remainingStages: ["prototype"],
            assessment: { ...assessment(), startStage: "prototype", requirements: null,
                stages: [{ stage: "prototype", reason: "Prepare the already approved update." }] } };
        await f.h.api.persistState({ ...reviewing, changeRequests: [...reviewing.changeRequests!, waiting, active] });
        const before = await f.h.api.loadState("sample");
        assert.equal(pendingChange(before)!.id, waiting.id, "The work guard must not inspect only the first pending request.");
        const server = await f.h.api.startServer("active-change-blocker", "sample", "project:tandem", true);
        try {
            const response = await fetch(new URL(`/api/reviews/${draft.prototypeId}/state`, server.url));
            assert.equal(response.status, 200);
            assert.match((await response.json()).stageReviewStatus.blocker, /change already being applied/,
                "Show the real blocker before the user clicks Apply.");
        } finally {
            clearInterval(server.heartbeat);
            await new Promise<void>(resolve => { server.server.close(() => resolve()); server.server.closeAllConnections(); });
        }
        await assert.rejects(f.h.api.applyStageReview("sample", "project:tandem", {
            reviewId: draft.prototypeId, expectedRevision: draft.revision,
        }), /change already being applied/);
        const retained = await f.h.api.loadState("sample");
        assert.deepEqual(plain(retained), plain(before));
        assert.equal(f.h.requests.length, 1);
    } finally { await f.h.close(); }
});

test("a pending request inside the pinned draft still must be resolved before Apply", async () => {
    const f = await fixture();
    try {
        const plan = assessment();
        plan.requirements!.upsert = [];
        const { state } = await assess(f, plan);
        const reviewing = await f.h.api.decideChangeRequest("sample", "project:tandem", approval(state.changeRequests![0]));
        const draft = await f.h.api.loadState(reviewing.changeRequests![0].reviewId!);
        await f.h.api.persistState({ ...draft, changeRequests: [...draft.changeRequests!, {
            ...proposed(), id: "draft-pending", clientRequestId: "draft-pending-client",
            assessment: { ...assessment(), question: "Which draft behavior should change?" },
        }] });
        const updated = await f.h.api.loadState(draft.prototypeId);
        await assert.rejects(f.h.api.applyStageReview("sample", "project:tandem", {
            reviewId: updated.prototypeId, expectedRevision: updated.revision,
        }), /saved change request/);
        assert.deepEqual(plain(await f.h.api.loadState("sample")), plain(reviewing));
    } finally { await f.h.close(); }
});

test("a failed assessment with unconfirmed worker ownership still blocks pinned Apply", async () => {
    const f = await fixture();
    try {
        const plan = assessment();
        plan.requirements!.upsert = [];
        const { state } = await assess(f, plan);
        const reviewing = await f.h.api.decideChangeRequest("sample", "project:tandem", approval(state.changeRequests![0]));
        const draft = await f.h.api.loadState(reviewing.changeRequests![0].reviewId!);
        const failed: ChangeRequest = { ...proposed(), id: "unconfirmed", clientRequestId: "unconfirmed-client",
            analysisId: "unconfirmed-analysis", status: "failed", error: "The worker outcome is unknown." };
        await f.h.api.persistState({ ...reviewing, changeRequests: [...reviewing.changeRequests!, failed],
            factoryRuns: [...reviewing.factoryRuns!, { requestId: failed.analysisId!, generation: reviewing.generation,
                runId: null, terminal: false }] });
        const before = await f.h.api.loadState("sample");
        await assert.rejects(f.h.api.applyStageReview("sample", "project:tandem", {
            reviewId: draft.prototypeId, expectedRevision: draft.revision,
        }), /Finish current work/);
        assert.deepEqual(plain(await f.h.api.loadState("sample")), plain(before));
        assert.equal(f.h.requests.length, 1, "An unknown launch cannot be replayed or treated as safe completion.");
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
        current.processing = { action: "submit-revision", status: "running", requestId: "linked-prototype-work",
            changeRequestId: state.changeRequests![0].id, requestedAt: current.updatedAt };
        await f.h.api.persistState(current);
        await assert.rejects(f.h.api.decideChangeRequest("sample", "project:tandem", decision), /Wait for this change's prototype work/);
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
        await assert.rejects(f.h.api.decideChangeRequest("sample", "project:tandem", {
            requestId: ready.changeRequests![0].id, decision: "defer",
        }), /Resolve or cancel/);
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

for (const status of ["ready", "failed", "clarifying"] as const) test(`cancelling a ${status} prototype change releases its own pending work without losing history`, async t => {
    const f = await fixture(); t.after(() => f.h.close());
    const request = { ...proposed(), status: "active" as const, remainingStages: ["prototype" as const],
        assessment: { ...assessment(), requirements: null, startStage: "prototype" as const,
            stages: [{ stage: "prototype" as const, reason: "Revise playback." }] } };
    const source = f.initial.prototypeFlow!.checkpoints.at(-1)!;
    const checkpoint = { ...source, id: "cancelled-update", requestId: "cancelled-update", revisionId: "cancelled-feedback",
        sourceCheckpointId: source.id, baseCheckpointId: source.id, status,
        previewUrl: status === "ready" ? source.previewUrl : null };
    f.initial.prototypeFlow!.checkpoints.push(checkpoint);
    f.initial.prototypeFlow!.pendingCheckpointId = status === "ready" ? checkpoint.id : null;
    f.initial.changeRequests = [request];
    f.initial.prototypeReview.revisions = [{
        id: checkpoint.revisionId, clientRequestId: `change-${request.id}`, suggestion: request.message, status,
        checkpointId: checkpoint.id, baseCheckpointId: source.id, summary: "Retained attempted update.",
        clarifications: [], submittedAt: f.initial.updatedAt, completedAt: status === "clarifying" ? null : f.initial.updatedAt,
    }];
    f.initial.prototypeReview.activeRevisionId = checkpoint.revisionId;
    if (status === "clarifying") f.initial.prototypeReview.question = {
        id: "cancelled-question", text: "Which label?", choices: ["Start", "Play", "Run"],
        recommended: "Play", allowFreeText: true, rationale: "", answerPlaceholder: "",
    };
    await f.h.api.persistState(f.initial);
    const cancelled = await f.h.api.decideChangeRequest("sample", "project:tandem", { requestId: request.id, decision: "cancel" });
    assert.equal(cancelled.changeRequests![0].status, "cancelled");
    assert.equal(cancelled.prototypeFlow!.displayedCheckpointId, source.id);
    assert.equal(cancelled.prototypeFlow!.pendingCheckpointId, null);
    assert.equal(cancelled.prototypeFlow!.checkpoints.at(-1)!.id, checkpoint.id);
    assert.equal(cancelled.prototypeReview.revisions[0].status, "dismissed");
    assert.equal(cancelled.prototypeReview.question, null);
    assert.equal(prototypeNeedsChangeUpdate(cancelled), false);
    assert.equal(f.h.api.stageCompletionError(cancelled, "prototype", { requirePrototypeSpec: false }), null);
    assert.equal(f.h.requests.length, 0);
});

test("an unanswered impact question blocks new requests without losing the pending review", async () => {
    const f = await fixture();
    try {
        const question = "Which saved sequence should this replace?";
        const { state } = await assess(f, { ...assessment(), question });
        await assert.rejects(f.h.api.submitChangeRequest("sample", "project:tandem", {
            message: "Add a separate export option.", clientRequestId: "independent-change",
        }), /Resolve the current review/);
        const next = await f.h.api.loadState("sample");
        assert.equal(f.h.requests.length, 1);
        assert.equal(next.changeRequests![0].assessment!.question, question);
        assert.equal(next.changeRequests![0].status, "proposed");
        assert.equal(next.changeRequests!.length, 1);
        assert.deepEqual(plain(next.decisionGraph), plain(state.decisionGraph));
        const duplicate = await f.h.api.submitChangeRequest("sample", "project:tandem", {
            message: state.changeRequests![0].message, clientRequestId: state.changeRequests![0].clientRequestId,
        });
        assert.equal(duplicate.requestId, state.changeRequests![0].id, "A retry of the same message is still idempotent.");
        await assert.rejects(f.h.api.beginPrototypeBuild("sample", "project:tandem"), /Resolve the current review/);
        await assert.rejects(f.h.api.queuePrototypeRevision("sample", "project:tandem", {
            suggestion: "Bypass the review with another edit.", clientRequestId: "direct-revision",
        }), /Resolve the current review/);
    } finally { await f.h.close(); }
});

test("concurrent submissions admit only one review and leave the rejected message out of saved work", async () => {
    const f = await fixture();
    try {
        worker(f.h, { ...assessment(), question: "Which sequence should change?" });
        const results = await Promise.allSettled(["first", "second"].map(id =>
            f.h.api.submitChangeRequest("sample", "project:tandem", {
                message: `${id} requested change`, clientRequestId: `${id}-client`, originStage: "prototype",
            })));
        await f.h.api.waitForAnswer("sample");
        assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
        const rejected = results.find(result => result.status === "rejected");
        assert.ok(rejected?.status === "rejected");
        assert.match(String(rejected.reason), /Resolve the current review/);
        const saved = await f.h.api.loadState("sample");
        assert.equal(saved.changeRequests!.length, 1);
        assert.equal(f.h.requests.length, 1);
        assert.equal(saved.changeRequests![0].status, "proposed");
        assert.deepEqual(plain(saved.decisionGraph), plain(f.initial.decisionGraph));
    } finally { await f.h.close(); }
});

test("pending review rejects direct design edits and approval while saved designs remain readable", async () => {
    const f = await fixture();
    try {
        const current = { ...f.initial, stage: "sketch" as const,
            lifecycle: { ...f.initial.lifecycle, currentStage: "sketch" as const,
                completedStages: ["prepare" as const, "requirements" as const], skippedStages: [] },
            prototypeFlow: null, previewStatus: "waiting" as const, previewUrl: null };
        await f.h.api.persistState(current);
        const document = sketchDocument();
        document.screens[0].decisionIds = ["joints"];
        const saved = await f.h.api.sketchAction("sample", "project:tandem", { action: "save", expectedRevision: null, document });
        await f.h.api.persistState({ ...saved, changeRequests: [{ ...proposed(), originStage: "sketch" }] });
        for (const action of ["save", "approve", "generate"]) {
            await assert.rejects(f.h.api.sketchAction("sample", "project:tandem", {
                action, expectedRevision: saved.sketch.current!.id, ...(action === "save" ? { document } : {}),
            }), /Resolve the current review/);
        }
        assert.deepEqual(await new SketchStore(f.h.root).read("sample", saved.sketch.current!), document);
        assert.equal((await f.h.api.loadState("sample")).sketch.current!.id, saved.sketch.current!.id);
        assert.equal(f.h.requests.length, 0);
    } finally { await f.h.close(); }
});

test("reopening preserves the active review and only resumes the next queued request after resolution", async () => {
    const f = await fixture();
    let reopened: Awaited<ReturnType<typeof extensionHarness>> | undefined;
    try {
        const { state } = await assess(f, { ...assessment(), question: "Which sequence?" });
        await f.h.api.persistState({ ...state, changeRequests: [...state.changeRequests!, {
            ...proposed(), id: "waiting-change", clientRequestId: "waiting-client",
            message: "Add an export option.", status: "queued", assessment: null, baselineDigest: null, analysisId: null,
        }] });
        reopened = await extensionHarness({}, f.h.root);
        worker(reopened, assessment(), "new-session");
        await reopened.api.openTandem({ instanceId: "reopened", sessionId: "new-session",
            extensionId: "project:tandem", input: { prototypeId: "sample" }, reason: "rehydrate" });
        const waiting = await reopened.api.loadState("sample");
        assert.equal(reopened.requests.length, 0);
        assert.equal(waiting.changeRequests![1].status, "queued");
        await reopened.api.decideChangeRequest("sample", "project:tandem", { requestId: waiting.changeRequests![0].id, decision: "cancel" });
        await reopened.waitForRequests();
        await reopened.api.waitForAnswer("sample");
        const next = await reopened.api.loadState("sample");
        assert.equal(reopened.requests.length, 1);
        assert.equal((reopened.requests[0] as { args: { state: { changeRequest: ChangeRequest } } }).args.state.changeRequest.id, "waiting-change");
        assert.equal(next.changeRequests![0].analysisId, state.changeRequests![0].analysisId);
        assert.equal(next.changeRequests![1].status, "proposed");
    } finally {
        await reopened?.close();
        await f.h.close();
    }
});

test("opening in another session cannot take over live assessment ownership to unblock its queue", async () => {
    const f = await fixture();
    let reopened: Awaited<ReturnType<typeof extensionHarness>> | undefined;
    try {
        const request = { ...proposed(), status: "analyzing" as const, assessment: null };
        await f.h.api.persistState({ ...f.initial, changeRequests: [request],
            processing: { action: "assess-change", status: "running", requestId: request.analysisId,
                changeRequestId: request.id, runId: "live-run", requestedAt: request.submittedAt },
            factoryRuns: [{ requestId: request.analysisId!, generation: f.initial.generation, runId: "live-run", terminal: false }],
            jobOwner: { sessionId: "original-owner", workspaceRoot: f.h.root } });
        reopened = await extensionHarness({}, f.h.root);
        reopened.api.setSession({ ...reopened.session, sessionId: "new-session" });
        await reopened.api.openTandem({ instanceId: "foreign-assessment", sessionId: "new-session",
            extensionId: "project:tandem", input: { prototypeId: "sample" }, reason: "rehydrate" });
        const retained = await reopened.api.loadState("sample");
        assert.equal(retained.jobOwner!.sessionId, "original-owner");
        assert.equal(retained.changeRequests![0].status, "analyzing");
        assert.equal(retained.processing.runId, "live-run");
        assert.equal(reopened.requests.length, 0);
        await assert.rejects(reopened.api.decideChangeRequest("sample", "project:tandem", {
            requestId: request.id, decision: "defer",
        }), /another session/);
    } finally {
        await reopened?.close();
        await f.h.close();
    }
});

test("an unresolved review cannot be deferred away while legacy deferred records remain resumable", async () => {
    const f = await fixture();
    try {
        const { state } = await assess(f, { ...assessment(), question: "Which saved sequence should change?" });
        const request = state.changeRequests![0];
        await assert.rejects(f.h.api.decideChangeRequest("sample", "project:tandem", {
            requestId: request.id, decision: "defer", analysisId: request.analysisId, baselineDigest: request.baselineDigest,
        }), /Resolve or cancel/);
        const deferred = { ...state, changeRequests: [{ ...request, status: "deferred" as const }] };
        await f.h.api.persistState(deferred);
        assert.equal(deferred.changeRequests![0].status, "deferred");
        assert.deepEqual(deferred.changeRequests![0].assessment, request.assessment);
        assert.deepEqual(deferred.changeRequests![0].clarifications, request.clarifications);
        assert.equal(pendingChange(deferred), undefined);
        assert.doesNotMatch(f.h.api.stageCompletionError(deferred, "prototype") ?? "", /saved change request/);
        assert.deepEqual(plain(deferred.decisionGraph), plain(state.decisionGraph));
        assert.deepEqual(plain(deferred.lifecycle), plain(state.lifecycle));
        assert.equal(readChangeRequests(deferred.changeRequests)[0].status, "deferred");
        const updated = { ...deferred, deferred: [...deferred.deferred, "New agreed context"] };
        await f.h.api.persistState(updated);
        await f.h.api.decideChangeRequest("sample", "project:tandem", { requestId: request.id, decision: "retry" });
        await f.h.api.waitForAnswer("sample");
        const resumed = (await f.h.api.loadState("sample")).changeRequests![0];
        assert.equal(resumed.id, request.id);
        assert.equal(resumed.status, "proposed");
        assert.notEqual(resumed.analysisId, request.analysisId);
        assert.notEqual(resumed.baselineDigest, request.baselineDigest);
        assert.equal(f.h.requests.length, 2);
        assert.equal(resumed.assessment!.question, request.assessment!.question, "Resuming does not invent an answer or approval.");
    } finally { await f.h.close(); }
});

test("explicit additive Requirements changes save directly and release the queue without answering new questions", async () => {
    const f = await fixture();
    try {
        const initial = { ...f.initial, stage: "requirements" as const,
            lifecycle: { ...f.initial.lifecycle, currentStage: "requirements" as const, completedStages: ["prepare" as const] },
            prototypeFlow: null, previewUrl: null, previewStatus: "waiting" as const };
        await f.h.api.persistState(initial);
        const plan = { ...assessment(), stages: [{ stage: "requirements" as const, reason: "Add the explicitly requested usage and missing decision." }] };
        worker(f.h, plan);
        await f.h.api.submitChangeRequest("sample", "project:tandem", {
            message: "Add saving and reloading sequences.", clientRequestId: "first-addition", originStage: "requirements",
        });
        await f.h.api.waitForAnswer("sample");
        const first = await f.h.api.loadState("sample");
        assert.equal(first.changeRequests![0].status, "completed", first.changeRequests![0].error || first.processing?.message);
        assert.ok(first.changeRequests![0].snapshotPath);
        assert.equal(first.question!.id, "save-location");
        assert.equal(first.decisionGraph.nodes.find(item => item.id === "save-location")!.answer, null);
        assert.deepEqual(plain(first.decisionGraph.nodes.slice(0, 3)), plain(initial.decisionGraph.nodes));
        const nextDelta = delta();
        const added = node("export-format", [], null);
        nextDelta.usages.add = ["I want to export a sequence."];
        nextDelta.upsert = [{ id: added.id, title: added.title, dependencies: [], question: added.question! }];
        worker(f.h, { ...plan, requirements: nextDelta });
        await f.h.api.submitChangeRequest("sample", "project:tandem", {
            message: "Also add sequence export.", clientRequestId: "second-addition", originStage: "requirements",
        });
        await f.h.api.waitForAnswer("sample");
        const second = await f.h.api.loadState("sample");
        assert.ok(second.changeRequests!.every(item => item.status === "completed"));
        assert.equal(second.decisionGraph.nodes.filter(item => item.answer === null).length, 2);
        assert.equal(second.lifecycle.currentStage, "requirements");
        assert.equal(f.h.requests.length, 2, "One assessment per request, not a repeated stage or approval cycle.");
    } finally { await f.h.close(); }
});

test("changing accepted Requirements decisions still needs review but its saved delta does not monopolize the queue", async () => {
    const f = await fixture();
    try {
        const initial = { ...f.initial, stage: "requirements" as const,
            lifecycle: { ...f.initial.lifecycle, currentStage: "requirements" as const, completedStages: ["prepare" as const] },
            prototypeFlow: null, previewUrl: null, previewStatus: "waiting" as const };
        await f.h.api.persistState(initial);
        const baseline = await f.h.api.loadState("sample");
        const patch = delta();
        const changed = node("joints");
        changed.question!.text = "Choose the revised joint control behavior.";
        patch.upsert = [{ id: changed.id, title: changed.title, dependencies: [], question: changed.question! }];
        worker(f.h, { ...assessment(), requirements: patch,
            stages: [{ stage: "requirements", reason: "Revisit an accepted answer and its dependent decisions." }] });
        await f.h.api.submitChangeRequest("sample", "project:tandem", {
            message: "Change the existing joint control behavior.", clientRequestId: "revise-accepted", originStage: "requirements",
        });
        await f.h.api.waitForAnswer("sample");
        const proposed = await f.h.api.loadState("sample");
        assert.equal(proposed.changeRequests![0].status, "proposed", proposed.changeRequests![0].error || proposed.processing?.message);
        assert.deepEqual(plain(proposed.artifacts), plain(baseline.artifacts), "Read-only impact checks cannot rewrite the accepted diagram as reconciliation progress.");
        assert.equal(proposed.changeRequests![0].baselineDigest, changeBaselineDigest(proposed), "The assessment must not stale its own proposal.");
        assert.deepEqual(plain(proposed.decisionGraph), plain(initial.decisionGraph));
        const applied = await f.h.api.decideChangeRequest("sample", "project:tandem", approval(proposed.changeRequests![0]));
        assert.equal(applied.changeRequests![0].status, "completed");
        assert.equal(applied.decisionGraph.nodes[0].answer, null);
        assert.equal(applied.decisionGraph.nodes[0].review!.previousAnswer, "Keep");
        assert.equal(applied.decisionGraph.nodes[2].answer, "Keep");
        assert.equal(applied.lifecycle.currentStage, "requirements");
        assert.equal(pendingChange(applied), undefined);
        await f.h.api.persistState({ ...applied, changeRequests: applied.changeRequests!.map(item => ({
            ...item, status: "active" as const, completedAt: null, remainingStages: ["requirements" as const],
        })) });
        await f.h.api.continueChangeWork("sample");
        const recovered = await f.h.api.loadState("sample");
        assert.equal(recovered.changeRequests![0].status, "completed", "Legacy saved deltas can release their queue without reapplying.");
        assert.deepEqual(plain(recovered.decisionGraph), plain(applied.decisionGraph));
        assert.equal(f.h.requests.length, 1);
    } finally { await f.h.close(); }
});

test("design change context validates exact screen and node identities and retains the original DSL across reassessment", async () => {
    const f = await fixture();
    try {
        const document = sketchDocument();
        document.screens[0].decisionIds = ["joints"];
        addUi(document.screens[0], "illustration", "Image", { alt: "Coffee illustration", aspect: "wide" });
        const store = new SketchStore(f.h.root);
        const original = await store.save("sample", document, {
            requirementsDigest: requirementsInputDigest(f.initial), source: "generated", number: 1,
        });
        const state = { ...f.initial, sketch: { ...emptySketchState(), status: "draft" as const, current: original, history: [original] } };
        await f.h.api.persistState(state);
        const context = { revisionId: original.id, screenId: "main", nodeId: "illustration" };
        const plan: ChangeAssessment = { ...assessment(), startStage: "sketch", requirements: null, affectedScreenIds: ["main"],
            stages: [{ stage: "sketch", reason: "Update the selected action." }, { stage: "prototype", reason: "Reflect reviewed designs." }],
            question: "Should the action stay in the same row?" };
        worker(f.h, plan);
        for (const invalid of [{ ...context, screenId: "missing" }, { ...context, nodeId: "missing" }, { ...context, revisionId: "old" }]) {
            await assert.rejects(f.h.api.submitChangeRequest("sample", "project:tandem", {
                message: "Replace this block with an icon.", clientRequestId: "target-change", originStage: "sketch", sketchContext: invalid,
            }), /selected design/);
        }
        await f.h.api.submitChangeRequest("sample", "project:tandem", {
            message: "Replace this block with an icon.", clientRequestId: "target-change", originStage: "sketch", sketchContext: context,
        });
        await f.h.api.waitForAnswer("sample");
        const assessed = await f.h.api.loadState("sample");
        const request = assessed.changeRequests![0];
        assert.deepEqual(plain(request.sketchContext), context);
        assert.equal(request.status, "proposed", "A real question is never auto-approved.");
        await assert.rejects(f.h.api.decideChangeRequest("sample", "project:tandem", approval(request)), /current (?:impact|change) proposal/);
        const repeated = await f.h.api.submitChangeRequest("sample", "project:tandem", {
            message: request.message, clientRequestId: request.clientRequestId, originStage: "sketch",
            sketchContext: { nodeId: context.nodeId, screenId: context.screenId, revisionId: context.revisionId },
        });
        assert.equal(repeated.requestId, request.id);
        assert.equal(f.h.requests.length, 1);
        await assert.rejects(f.h.api.submitChangeRequest("sample", "project:tandem", {
            message: request.message, clientRequestId: request.clientRequestId, originStage: "sketch",
            sketchContext: { ...context, nodeId: null },
        }), /different content/);
        assert.throws(() => readChangeRequests([{ ...request, sketchContext: { ...context, revisionId: "old" } }]), /source revision/);
        assert.deepEqual(readSketchChangeContext(context, { revisionId: original.id, document }), context);
        const newerDocument = plain(document);
        newerDocument.screens[0].notes = "A newer unrelated annotation.";
        const newer = await store.save("sample", newerDocument, {
            requirementsDigest: requirementsInputDigest(state), source: "edited", number: 2,
        });
        await f.h.api.persistState({ ...assessed, sketch: { ...assessed.sketch, current: newer, history: [original, newer] } });
        await f.h.api.decideChangeRequest("sample", "project:tandem", { requestId: request.id, decision: "retry" });
        await f.h.api.waitForAnswer("sample");
        const args = (f.h.requests[1] as { args: { sketchDocument: unknown; submittedDrawings: unknown } }).args;
        assert.deepEqual(plain(args.sketchDocument), newerDocument);
        assert.deepEqual(plain(args.submittedDrawings), { revisionId: original.id, document });
        const prompt = f.h.api.answerFactoryPrompt(args);
        assert.match(prompt, /ui\.nodes/);
        assert.match(prompt, /Never silently retarget/);
        assert.match(prompt, /Coffee illustration/);
        assert.ok(prompt.includes(JSON.stringify(context)));
        assert.ok(prompt.includes("A newer unrelated annotation."));
        assert.deepEqual(await store.read("sample", original), document);
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

for (const legacy of [false, true]) test(`applying a draft usage explicitly updates the ${legacy ? "legacy" : "tracked"} prototype through its public retry action`, async () => {
    const f = await fixture();
    const server = await f.h.api.startServer("review-update-http", "sample", "project:tandem", true);
    try {
        if (legacy) {
            f.initial.prototypeFlow = null;
            await f.h.api.persistState(f.initial);
        }
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
        const published = await (await fetch(new URL("/api/state", server.url))).json();
        assert.equal(published.prototypeNeedsUpdate, true);
        assert.match(f.h.api.stageCompletionError(accepted, "prototype")!, /Update and apply the prototype/);
        await assert.rejects(f.h.api.prototypeAction("sample", "project:tandem", { action: "visual" }), /Update and apply the prototype/);
        const response = await fetch(new URL("/api/prototype/action", server.url), { method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "retry", expectedRevision: published.revision }) });
        assert.equal(response.status, 200, await response.text());
        await f.h.waitForRequests(2); await f.h.api.waitForAnswer("sample");
        const ready = await f.h.api.loadState("sample");
        const checkpoint = ready.prototypeFlow!.checkpoints.at(-1)!;
        const originalId = legacy ? `legacy-interaction-${ready.generation}` : "old-interaction";
        assert.equal(checkpoint.sourceCheckpointId, originalId);
        assert.equal(checkpoint.milestone, "prototype");
        assert.equal(checkpoint.requirementsDigest, requirementsInputDigest(ready));
        assert.equal(ready.prototypeFlow!.displayedCheckpointId, originalId);
        assert.equal(ready.processing.changeRequestId, state.changeRequests![0].id);
        assert.equal(prototypeNeedsChangeUpdate(ready), true, "The user must inspect and show the prepared version.");
        const workerRequest = f.h.requests[1] as { args: { state: { changeRequest: ChangeRequest } } };
        assert.equal(workerRequest.args.state.changeRequest.id, state.changeRequests![0].id,
            "The worker must receive the full original request, not just a generic refresh instruction.");
        assert.deepEqual(plain(ready.decisionGraph), plain(f.initial.decisionGraph));
        const applied = await f.h.api.prototypeAction("sample", "project:tandem", { action: "apply-update", checkpointId: checkpoint.id });
        assert.equal(prototypeNeedsChangeUpdate(applied), false);
        assert.equal(f.h.api.stageCompletionError(applied, "prototype", { requirePrototypeSpec: false }), null);
        assert.equal(f.h.requests.length, 2, "only assessment and the requested delta ran");
    } finally {
        clearInterval(server.heartbeat);
        await new Promise<void>(resolve => { server.server.close(() => resolve()); server.server.closeAllConnections(); });
        await f.h.close();
    }
});

test("a stale checkpoint without review flags can be rebuilt and applied without reopening or resetting", async t => {
    const f = await fixture(); t.after(() => f.h.close());
    f.initial.prototypeFlow!.checkpoints.at(-1)!.requirementsDigest = "a".repeat(64);
    await f.h.api.persistState(f.initial);
    worker(f.h, assessment());
    assert.equal(prototypeNeedsChangeUpdate(await f.h.api.loadState("sample")), true);
    await f.h.api.beginPrototypeBuild("sample", "project:tandem");
    await f.h.waitForRequests(); await f.h.api.waitForAnswer("sample");
    const ready = await f.h.api.loadState("sample");
    assert.ok(ready.prototypeFlow!.pendingCheckpointId, ready.processing.message);
    const applied = await f.h.api.prototypeAction("sample", "project:tandem", {
        action: "apply-update", checkpointId: ready.prototypeFlow!.pendingCheckpointId,
    });
    assert.equal(prototypeNeedsChangeUpdate(applied), false);
    assert.equal(applied.generation, f.initial.generation);
    assert.equal(applied.lifecycle.reviewId, undefined);
    assert.equal(applied.prototypeFlow!.checkpoints[1].id, "old-interaction");
    assert.equal(f.h.requests.length, 1);
});

test("a failed reviewed-input update retains its request and preview across reload and explicit retry", async t => {
    const f = await fixture(); t.after(() => f.h.close());
    const plan = assessment(); plan.requirements!.upsert = [];
    const { state } = await assess(f, plan);
    const reviewing = await f.h.api.decideChangeRequest("sample", "project:tandem", approval(state.changeRequests![0]));
    const draft = await f.h.api.loadState(reviewing.changeRequests![0].reviewId!);
    await f.h.api.applyStageReview("sample", "project:tandem", { reviewId: draft.prototypeId, expectedRevision: draft.revision });
    f.h.setPreviewFetch(async () => new Response("Preview unavailable", { status: 503 }));
    await f.h.api.beginPrototypeBuild("sample", "project:tandem");
    await f.h.waitForRequests(2); await f.h.api.waitForAnswer("sample");
    const failed = await f.h.api.loadState("sample");
    assert.equal(failed.processing.status, "error");
    assert.equal(failed.prototypeFlow!.displayedCheckpointId, "old-interaction");
    assert.equal(failed.prototypeFlow!.pendingCheckpointId, null);
    assert.equal(prototypeNeedsChangeUpdate(failed), true);
    const revisionId = failed.prototypeReview.revisions[0].id;
    await f.h.api.continueChangeWork("sample");
    assert.equal(f.h.requests.length, 2, "Reload cannot automatically repeat a failed update.");
    f.h.setPreviewFetch(async () => {
        const current = await f.h.api.loadState("sample");
        const id = current.prototypeFlow!.activeCheckpointId ?? current.prototypeFlow!.pendingCheckpointId;
        return new Response(`<meta name="tandem-prototype-id" content="sample"><meta name="tandem-prototype-checkpoint" content="${id}">`);
    });
    await f.h.api.beginPrototypeBuild("sample", "project:tandem");
    await f.h.waitForRequests(3); await f.h.api.waitForAnswer("sample");
    const ready = await f.h.api.loadState("sample");
    assert.ok(ready.prototypeFlow!.pendingCheckpointId, ready.processing.message);
    assert.equal(ready.prototypeReview.revisions.length, 1, "Retry reuses the saved feedback identity.");
    assert.equal(ready.prototypeReview.revisions[0].id, revisionId);
    const applied = await f.h.api.prototypeAction("sample", "project:tandem", { action: "apply-update", checkpointId: ready.prototypeFlow!.pendingCheckpointId });
    assert.equal(prototypeNeedsChangeUpdate(applied), false);
    assert.equal(applied.processing.changeRequestId, state.changeRequests![0].id);
    assert.equal(f.h.requests.length, 3);
});
test("scoped design results cannot modify unrelated manual screen content", () => {
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
