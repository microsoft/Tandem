import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readStageReviewDraft, readStageReviews, stageReviewConflict } from "../src/stage-review.js";
import { migrateLifecycle } from "../src/lifecycle.js";
import { SketchStore } from "../src/sketch-store.js";
import { newPrototypeFlow } from "../src/prototype-flow.js";
import { fingerprintPrototypeWorkspace } from "../src/prototype-runtime.js";
import { requirementsInputDigest } from "../src/requirements-reconciliation.js";
import { changeBaselineDigest, type ChangeRequest } from "../src/change-requests.js";
import type { TandemState } from "../src/types.js";
import { executionDigest } from "../src/execution.js";
import { DevelopmentHandoffs } from "../src/development-handoff.js";
import { extensionHarness } from "./helpers/extension-harness.js";
import { sketchDocument, screenPng } from "./helpers/sketch-lifecycle-fixture.js";

const provider = "project:tandem";
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));

async function fixture(includeIndependentScreen = false) {
    const h = await extensionHarness();
    const state = h.api.createState("sample", "A task app");
    state.stage = state.lifecycle.currentStage = "sketch";
    state.lifecycle.completedStages = ["prepare", "requirements"];
    state.preparation.status = "ready";
    state.prototypeApproach = { mode: "build", reason: "Task UI" };
    state.requirements = { substage: "dag", usageItems: ["I want to complete a task."], suggestions: [] };
    state.decisionGraph = { nodes: [{ id: "usage", title: "Task behavior", dependencies: [], answer: "Keep",
        status: "answered", question: { id: "usage", text: "Choose task behavior", choices: ["Keep", "Change", "Minimal"],
            recommended: "Keep", allowFreeText: true, answerPlaceholder: "", rationale: "Task behavior" } }] };
    const document = sketchDocument();
    if (includeIndependentScreen) {
        const decision = structuredClone(state.decisionGraph.nodes[0]);
        decision.id = decision.question!.id = "help";
        state.decisionGraph.nodes.push(decision);
        document.screens.push({ ...structuredClone(document.screens[0]), id: "help", title: "Help", decisionIds: ["help"] });
    }
    await h.api.persistState(state);
    const saved = await h.api.sketchAction("sample", provider, { action: "save", expectedRevision: null, document });
    const approved = await h.api.sketchAction("sample", provider, { action: "approve", expectedRevision: saved.sketch.current!.id,
        previews: document.screens.map(screen => ({ screenId: screen.id, data: screenPng() })) });
    approved.stage = approved.lifecycle.currentStage = "prototype";
    approved.lifecycle.completedStages = ["prepare", "requirements", "sketch"];
    approved.lifecycle.outputs = [{ stageId: "sketch", path: "retained-sketch-r1.json", completedAt: approved.updatedAt }];
    approved.previewUrl = "http://127.0.0.1:4321/";
    approved.previewStatus = "ready";
    await h.api.persistState(approved);
    return { h, parent: await h.api.loadState("sample"), document };
}

test("opening and resuming a review while current work runs copies no sources and does not move the lifecycle", async t => {
    const { h, parent } = await fixture(); t.after(() => h.close());
    parent.processing = { action: "generate-design-spec", status: "running", requestId: "current-job",
        requestedAt: parent.updatedAt, runId: null, completedAt: null };
    await h.api.persistState(parent);
    const current = await h.api.loadState("sample");
    const draft = await h.api.openStageReview("sample", provider, { stageId: "requirements", expectedGeneration: parent.generation });
    const retained = await h.api.loadState("sample");
    assert.deepEqual(retained.lifecycle, current.lifecycle);
    assert.deepEqual(retained.processing, current.processing);
    assert.equal(retained.previewUrl, current.previewUrl);
    assert.equal(draft.lifecycle.currentStage, "requirements");
    assert.equal(draft.processing, null);
    assert.equal(draft.stageReview?.parentId, "sample");
    assert.equal(draft.generation, parent.generation);
    assert.equal((await h.api.openStageReview("sample", provider, {
        stageId: "requirements", expectedGeneration: parent.generation,
    })).prototypeId, draft.prototypeId);
    assert.deepEqual((await readdir(join(h.root, ".tandem", "efforts", draft.prototypeId))).sort(), ["review-baseline.json", "state.json"]);
    assert.equal(h.requests.length, 0);
    assert.equal(migrateLifecycle(draft.lifecycle).currentStage, "requirements");
    await assert.rejects(h.api.applyStageReview("sample", provider, { reviewId: draft.prototypeId, expectedRevision: draft.revision }), /Finish current work/);
});

test("design edits and approvals stay isolated until Apply; Apply preserves current stage, old files and receipts", async t => {
    const { h, parent } = await fixture(); t.after(() => h.close());
    const original = parent.sketch.current!;
    const draft = await h.api.openStageReview("sample", provider, { stageId: "sketch", expectedGeneration: parent.generation });
    const document = sketchDocument();
    document.screens[0].title = "Draft task view";
    const saved = await h.api.sketchAction(draft.prototypeId, provider, { action: "save", expectedRevision: original.id, document });
    const approved = await h.api.sketchAction(draft.prototypeId, provider, { action: "approve", expectedRevision: saved.sketch.current!.id,
        previews: [{ screenId: "main", data: screenPng() }] });
    assert.equal((await h.api.loadState("sample")).sketch.current!.id, original.id);
    assert.equal((await new SketchStore(h.root).read("sample", original)).screens[0].title, sketchDocument().screens[0].title);
    const result = await h.api.applyStageReview("sample", provider, { reviewId: draft.prototypeId, expectedRevision: approved.revision });
    assert.equal(result.lifecycle.currentStage, "prototype");
    assert.equal((await h.api.loadState("sample")).lifecycle.currentStage, "prototype", "Normalization cannot rewind a reviewed lifecycle.");
    assert.equal(result.sketch.current!.id, approved.sketch.current!.id);
    assert.equal(result.previewUrl, parent.previewUrl);
    assert.ok(result.lifecycle.history.some(item => item.path === "retained-sketch-r1.json"));
    assert.ok(result.stageReviews?.find(item => item.id === draft.prototypeId)?.appliedAt);
    assert.equal(result.lifecycle.outputs.find(item => item.stageId === "sketch")?.path.includes("review-"), false);
    const revision = result.revision;
    assert.equal((await h.api.applyStageReview("sample", provider, { reviewId: draft.prototypeId, expectedRevision: approved.revision })).revision, revision);
    await assert.rejects(h.api.sketchAction(draft.prototypeId, provider, {
        action: "save", expectedRevision: approved.sketch.current!.id, document,
    }), /no longer editable/);
    assert.equal(h.requests.length, 0, "Applying a design draft cannot automatically build a prototype.");
    const reopened = await h.api.reopenLifecycleStage("sample", "requirements", provider);
    assert.equal(reopened.lifecycle.currentStage, "requirements", "Explicit Reopen remains a distinct lifecycle transition.");
    assert.notEqual(reopened.generation, parent.generation);
    assert.equal(reopened.lifecycle.reviewId, undefined);
});

test("earlier-stage Apply preserves newer current-stage work and records dependent outputs as needing review", async t => {
    const { h, parent } = await fixture(); t.after(() => h.close());
    const draft = await h.api.openStageReview("sample", provider, { stageId: "requirements", expectedGeneration: parent.generation });
    await assert.rejects(h.api.applyStageReview("sample", provider, {
        reviewId: draft.prototypeId, expectedRevision: draft.revision,
    }), /No saved changes to apply/);
    assert.equal((await h.api.loadState("sample")).sketch.status, "approved", "An empty Apply cannot invalidate downstream work.");
    draft.decisionGraph.nodes[0].answer = "Change";
    await h.api.persistState(draft);
    const current = await h.api.loadState("sample");
    current.previewUrl = "http://127.0.0.1:5432/";
    await h.api.persistState(current);
    const result = await h.api.applyStageReview("sample", provider, { reviewId: draft.prototypeId, expectedRevision: draft.revision });
    assert.equal(result.lifecycle.currentStage, "prototype");
    assert.equal(result.previewUrl, current.previewUrl);
    assert.equal(result.decisionGraph.nodes[0].answer, "Change");
    assert.deepEqual(plain(result.lifecycle.completedStages), ["prepare", "requirements"]);
    assert.equal(result.sketch.status, "stale");
    assert.equal(result.sketch.approved, null);
    assert.equal((await h.api.loadState("sample")).lifecycle.currentStage, "prototype");
    assert.match(h.api.stageCompletionError(result, "prototype")!, /earlier-stage drafts/);
    assert.equal(h.requests.length, 0);
});

test("Requirements-to-Designs review preserves request scope and explicitly updates new and older saved drafts", async t => {
    for (const mode of ["new draft", "older saved draft", "replaced requirement"] as const) await t.test(mode, async t => {
        const legacy = mode === "older saved draft";
        const replaced = mode === "replaced requirement";
        const { h, parent, document } = await fixture(true); t.after(() => h.close());
        const addedUsage = "I want to inspect task details.";
        const originalDecision = parent.decisionGraph.nodes.find(item => item.id === "usage")!;
        const decisionId = replaced ? "task-details" : originalDecision.id;
        const affectedDecisionIds = replaced ? ["usage", "task-details"] : ["usage"];
        const request: ChangeRequest = {
            version: 1, id: "change-details", clientRequestId: "client-details", originStage: "prototype",
            message: "Add task details.", submittedAt: parent.updatedAt, baseCheckpointId: null,
            baseSketchRevisionId: parent.sketch.current!.id, visualSelection: null, sourceResultId: null, sourceRequests: [],
            baselineDigest: changeBaselineDigest(parent), analysisId: "analysis-details", status: "proposed", error: "",
            clarifications: [{ question: "Which tasks?", answer: "The existing task list." }],
            remainingStages: [], workStarted: [], affectedDecisionIds: [], snapshotPath: null,
            completedAt: null, developmentAdmission: null, developmentRequest: null,
            assessment: { version: 1, summary: "Show task details", reason: "Adds task information", startStage: "requirements",
                stages: [{ stage: "requirements", reason: "Confirm task details" }, { stage: "sketch", reason: "Update the task screen" },
                    { stage: "prototype", reason: "Update the preview" }],
                preserved: ["Help screen"], affectedScreenIds: [], question: null,
                requirements: { usages: { add: [addedUsage], remove: [] },
                    upsert: [{ id: decisionId, title: originalDecision.title, dependencies: [],
                        question: { ...originalDecision.question!, id: decisionId, text: "Choose the task details behavior" } }],
                    remove: replaced ? ["usage"] : [], assumptions: { add: [], remove: [] }, deferred: { add: [], remove: [] }, prototypeApproach: null } },
        };
        await h.api.persistState({ ...parent, changeRequests: [request] });
        const requirements = await h.api.openStageReview("sample", provider, { stageId: "requirements",
            expectedGeneration: parent.generation, changeRequestId: request.id, analysisId: request.analysisId,
            baselineDigest: request.baselineDigest });
        const changedDecision = requirements.decisionGraph.nodes.find(item => item.id === decisionId)!;
        assert.equal(changedDecision.answer, null);
        changedDecision.answer = "Change";
        changedDecision.status = "answered";
        await h.api.persistState(requirements);
        const accepted = await h.api.applyStageReview("sample", provider, {
            reviewId: requirements.prototypeId, expectedRevision: requirements.revision,
        });
        const pending = accepted.changeRequests!.find(item => item.id === request.id)!;
        assert.deepEqual(plain(pending.affectedDecisionIds), affectedDecisionIds);
        assert.deepEqual(plain(pending.remainingStages), ["sketch", "prototype"]);
        assert.equal(accepted.sketch.status, "stale");
        const draft = await h.api.openStageReview("sample", provider, { stageId: "sketch",
            expectedGeneration: accepted.generation, changeRequestId: pending.id,
            analysisId: pending.analysisId, baselineDigest: pending.baselineDigest });
        const continued = draft.changeRequests!.find(item => item.id === request.id)!;
        assert.equal(continued.status, "active");
        assert.deepEqual(plain(continued.remainingStages), ["sketch"]);
        assert.deepEqual(plain(continued.affectedDecisionIds), affectedDecisionIds);
        assert.equal(continued.analysisId, request.analysisId);
        assert.equal(continued.baseSketchRevisionId, request.baseSketchRevisionId);
        assert.deepEqual(plain(continued.clarifications), request.clarifications);
        assert.deepEqual(plain(draft.decisionGraph), plain(accepted.decisionGraph), "Do not reapply the delta and clear reviewed answers.");
        assert.equal(draft.requirements.usageItems.filter(item => item === addedUsage).length, 1);
        if (legacy) {
            draft.changeRequests = [];
            await h.api.persistState(draft);
            const current = await h.api.loadState("sample");
            current.changeRequests![0].affectedDecisionIds = [];
            current.assumed.push("A conflicting accepted constraint");
            await h.api.persistState(current);
            await assert.rejects(h.api.sketchAction(draft.prototypeId, provider, {
                action: "update", expectedRevision: draft.sketch.current!.id,
            }), /Accepted inputs changed/);
            assert.deepEqual(plain((await h.api.loadState(draft.prototypeId)).changeRequests), []);
            current.assumed.pop();
            current.changeRequests![0].status = "cancelled";
            await h.api.persistState(current);
            await assert.rejects(h.api.sketchAction(draft.prototypeId, provider, {
                action: "update", expectedRevision: draft.sketch.current!.id,
            }), /linked change no longer owns/);
            assert.deepEqual(plain((await h.api.loadState(draft.prototypeId)).changeRequests), []);
            current.changeRequests![0].status = "reviewing";
            await h.api.persistState(current);
        }
        await h.api.ensureSketchStarted(draft, true);
        await h.api.continueChangeWork(draft.prototypeId);
        assert.equal(h.requests.length, 0, "Opening or recovering a pinned draft cannot start work.");
        let changeUnrelatedScreen = true;
        let updateReferences = !replaced;
        h.api.setSession({ ...h.session, rpc: { ...h.session.rpc, workflow: { run: async (launch: {
            args: { action: string; state: TandemState & { changeRequest: ChangeRequest } };
        }) => {
            h.requests.push(launch);
            assert.equal(launch.args.action, "revise-sketch");
            assert.equal(launch.args.state.changeRequest.id, request.id);
            assert.deepEqual(plain(launch.args.state.changeRequest.affectedDecisionIds), affectedDecisionIds);
            assert.ok(launch.args.state.requirements.usageItems.includes(addedUsage));
            const updated = structuredClone(document);
            updated.screens[0].title = "Task details";
            if (updateReferences) updated.screens[0].decisionIds = [decisionId];
            if (changeUnrelatedScreen) updated.screens[1].title = "Unrequested rewrite";
            const operations = updated.screens.slice(0, changeUnrelatedScreen ? 2 : 1)
                .map(({ ui: _ui, ...screen }) => JSON.stringify({ op: "upsert-screen", screen }));
            const runId = `draft-design-${h.requests.length}`;
            try {
                const result = await h.api.answerFactory.run({
                    args: launch.args, runId, signal: new AbortController().signal,
                    session: { on: () => () => {}, workflow: { getRunDetail: async () => ({ runId, agents: [] }) } },
                    phase() {}, log() {}, step: (_key: string, work: () => Promise<unknown>) => work(),
                    agent: async (prompt: string) => {
                        assert.match(prompt, /INCREMENTAL UPDATE/);
                        assert.doesNotMatch(prompt, /Start from an empty sketch set|TITLE-FIRST ORDER/);
                        return [...operations, '{"op":"done"}'].join("\n");
                    },
                });
                return { runId, status: "completed", result };
            } catch (error) {
                return { runId, status: "failed", error: error instanceof Error ? error.message : String(error) };
            }
        } } } });
        const update = async () => {
            await h.api.sketchAction(draft.prototypeId, provider, { action: "update", expectedRevision: draft.sketch.current!.id });
            await h.api.waitForAnswer(draft.prototypeId);
            return h.api.loadState(draft.prototypeId);
        };
        if (replaced) {
            const obsolete = await update();
            assert.equal(obsolete.processing.status, "error");
            assert.match(obsolete.processing.message, /requirement|decision/i);
            assert.equal(obsolete.sketch.current!.id, parent.sketch.current!.id);
            updateReferences = true;
        }
        const rejected = await update();
        assert.equal(rejected.processing.status, "error");
        assert.match(rejected.processing.message, /unrelated screen "help"/);
        assert.equal(rejected.sketch.current!.id, parent.sketch.current!.id);
        changeUnrelatedScreen = false;
        const generated = await update();
        assert.equal(generated.sketch.status, "draft", generated.processing.message);
        assert.equal(generated.sketch.current!.source, "revised");
        assert.equal(generated.sketch.requests!.at(-1)!.kind, "update");
        assert.equal(generated.processing.changeRequestId, request.id);
        assert.equal(generated.sketch.current!.requirementsDigest, requirementsInputDigest(accepted));
        assert.deepEqual(plain(generated.changeRequests![0].affectedDecisionIds), affectedDecisionIds);
        assert.equal((await h.api.loadState("sample")).sketch.current!.id, parent.sketch.current!.id);
        const approved = await h.api.sketchAction(draft.prototypeId, provider, { action: "approve",
            expectedRevision: generated.sketch.current!.id,
            previews: document.screens.map(screen => ({ screenId: screen.id, data: screenPng() })) });
        const applied = await h.api.applyStageReview("sample", provider, {
            reviewId: draft.prototypeId, expectedRevision: approved.revision,
        });
        assert.equal(applied.lifecycle.currentStage, "prototype");
        assert.equal(applied.previewUrl, parent.previewUrl);
        assert.equal(applied.sketch.status, "approved");
        assert.deepEqual(plain(applied.changeRequests![0].remainingStages), ["prototype"]);
        assert.ok(applied.changeRequests![0].workStarted.includes("sketch"));
        assert.deepEqual(await new SketchStore(h.root).read("sample", parent.sketch.current!), document);
        assert.equal(h.requests.length, replaced ? 3 : 2);
    });
});

test("stale inputs, stale draft revisions and active draft work cannot be applied or silently overwrite accepted work", async t => {
    const { h, parent } = await fixture(); t.after(() => h.close());
    const draft = await h.api.openStageReview("sample", provider, { stageId: "sketch", expectedGeneration: parent.generation });
    await assert.rejects(h.api.applyStageReview("sample", provider, { reviewId: draft.prototypeId, expectedRevision: 0 }), /draft changed/);
    draft.processing = { action: "revise-sketch", status: "running", requestId: "draft-job", requestedAt: draft.updatedAt };
    await h.api.persistState(draft);
    await assert.rejects(h.api.applyStageReview("sample", provider, { reviewId: draft.prototypeId, expectedRevision: draft.revision }), /draft work/);
    await assert.rejects(h.api.discardStageReview("sample", provider, { reviewId: draft.prototypeId, expectedRevision: draft.revision }), /Finish draft work/);
    draft.processing = null; await h.api.persistState(draft);
    const accepted = await h.api.loadState("sample");
    accepted.assumed.push("A new accepted constraint");
    await h.api.persistState(accepted);
    assert.match(stageReviewConflict(accepted, draft), /Accepted inputs changed/);
    await assert.rejects(h.api.applyStageReview("sample", provider, { reviewId: draft.prototypeId, expectedRevision: draft.revision }), /Accepted inputs changed/);
    const discarded = await h.api.discardStageReview("sample", provider, { reviewId: draft.prototypeId, expectedRevision: draft.revision });
    assert.deepEqual(discarded.sketch, accepted.sketch);
    assert.deepEqual(discarded.lifecycle, accepted.lifecycle);
    assert.ok(discarded.stageReviews?.find(item => item.id === draft.prototypeId)?.discardedAt);
    assert.ok(await readFile(join(h.root, ".tandem", "efforts", draft.prototypeId, "state.json"), "utf8"));
});

test("scoped review HTTP routes isolate reads and refuse lifecycle, settings and Development escapes", async t => {
    const { h, parent } = await fixture(); t.after(() => h.close());
    const server = await h.api.startServer("review-http", "sample", provider, true);
    t.after(async () => {
        clearInterval(server.heartbeat);
        await new Promise<void>(resolve => { server.server.close(() => resolve()); server.server.closeAllConnections(); });
    });

    const post = (path: string, body: unknown) => fetch(new URL(path, server.url), { method: "POST",
        headers: { "Content-Type": "application/json", Origin: new URL(server.url).origin }, body: JSON.stringify(body) });
    const opened = await post("/api/reviews/open", { stageId: "sketch", expectedGeneration: parent.generation });
    assert.equal(opened.status, 200);
    const { draft } = await opened.json();
    const prefix = `/api/reviews/${draft.prototypeId}`;
    const baseline = await (await fetch(new URL(prefix + "/baseline", server.url))).json();
    assert.equal(baseline.state.prototypeId, "sample");
    assert.equal(baseline.document.screens[0].id, "main");
    const snapshot = await (await fetch(new URL(prefix + "/state", server.url))).json();
    assert.equal(snapshot.lifecycle.currentStage, "sketch");
    assert.equal(snapshot.stageReviewStatus.currentStage, "prototype");
    const drawings = await (await fetch(new URL(prefix + "/sketch", server.url))).json();
    assert.deepEqual(drawings.document, sketchDocument());
    for (const endpoint of ["/stage/reopen", "/stage/complete", "/effort/reset", "/development/open", "/process", "/sketch/live/session"]) {
        const result = await post(prefix + endpoint, {});
        assert.equal(result.status, 409, endpoint);
        assert.match((await result.json()).error, /pinned draft/);
    }
    assert.equal((await h.api.loadState("sample")).lifecycle.currentStage, "prototype");
    assert.equal(h.requests.length, 0);
});

test("Preparation drafts analyze only on request and Apply preserves the working stage and accepted requirement answers", async t => {
    const { h, parent } = await fixture(); t.after(() => h.close());
    const draft = await h.api.openStageReview("sample", provider, { stageId: "prepare", expectedGeneration: parent.generation });
    const server = await h.api.startServer("preparation-review-http", "sample", provider, true);
    t.after(async () => {
        clearInterval(server.heartbeat);
        await new Promise<void>(resolve => { server.server.close(() => resolve()); server.server.closeAllConnections(); });
    });
    const post = (suffix: string, body: unknown) => fetch(new URL(`/api/reviews/${draft.prototypeId}${suffix}`, server.url), {
        method: "POST", headers: { "Content-Type": "application/json", Origin: new URL(server.url).origin }, body: JSON.stringify(body),
    });
    const saved = await post("/goal", { goal: "A shared task app", expectedRevision: draft.revision });
    assert.equal(saved.status, 200);
    assert.equal((await h.api.loadState("sample")).goal, parent.goal);
    await fetch(new URL(`/api/reviews/${draft.prototypeId}/preparation/status`, server.url));
    assert.equal(h.requests.length, 0, "Reading a saved draft cannot start analysis.");
    h.api.setSession({ ...h.session, rpc: { ...h.session.rpc, workflow: { run: async request => {
        h.requests.push(request);
        const runId = "review-preparation";
        const handoff = { status: "ready", summary: "Synthetic shared-task analysis", checks: [], sources: [],
            suggestedUsages: ["I want to share my task list."], prototypeApproach: parent.prototypeApproach, assumed: [], deferred: [] };
        const result = await h.api.preparationFactory.run({
            args: request.args, runId, phase() {}, log() {}, step: (_key: string, work: () => Promise<unknown>) => work(),
            agent: async (_prompt: string, options: { label: string }) => ["prepare:goal-only", "prepare:context"].includes(options.label)
                ? { requiresSourceResearch: false, handoff } : options.label === "prepare:requirements" ? handoff
                    : { summary: "Synthetic fixture inspection", checks: [], sources: [] },
        });
        return { runId, status: "completed", result };
    } } } });
    const started = await post("/preparation/retry", {});
    assert.equal(started.status, 202, await started.text());
    await h.waitForRequests();
    await h.api.waitForPreparation(draft.prototypeId);
    const ready = await h.api.loadState(draft.prototypeId);
    assert.equal(ready.lifecycle.currentStage, "prepare");
    assert.equal(ready.preparation.status, "ready", ready.preparation.error);
    const applied = await h.api.applyStageReview("sample", provider, { reviewId: draft.prototypeId, expectedRevision: ready.revision });
    assert.equal(applied.lifecycle.currentStage, "prototype");
    assert.equal((await h.api.loadState("sample")).lifecycle.currentStage, "prototype");
    assert.equal(applied.goal, "A shared task app");
    assert.deepEqual(plain(applied.decisionGraph), plain(parent.decisionGraph));
    assert.deepEqual(plain(applied.requirements.usageItems), plain(parent.requirements.usageItems));
    assert.equal(h.requests.length, 1, "No downstream analysis or preview is started by Apply.");
});

test("prototype feedback is saved without work; only an explicit draft preview build copies source and dispatches a worker", async t => {
    const { h, parent } = await fixture(); t.after(() => h.close());
    const source = join(h.root, ".tandem", "efforts", "sample", "previews", "accepted-interaction");
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "index.html"), "<button>Keep this task</button>");
    parent.stage = parent.lifecycle.currentStage = "development";
    parent.lifecycle.completedStages.push("prototype");
    parent.prototypeFlow = { ...newPrototypeFlow(), displayedCheckpointId: "accepted-interaction",
        checkpoints: ["structure", "interaction"].map(milestone => ({
            id: `accepted-${milestone}`, requestId: `accepted-${milestone}`, generation: parent.generation,
            milestone: milestone as "structure" | "interaction", revisionId: null, status: "ready",
            baseCheckpointId: null, sourceCheckpointId: null, workspacePath: source, workspacePrepared: true,
            previewUrl: parent.previewUrl, summary: "Accepted task", focus: "Complete a task", requestedAt: parent.updatedAt,
            completedAt: parent.updatedAt, timeoutSeconds: null, sourceFingerprint: "",
            requirementsDigest: requirementsInputDigest(parent), sketchRevisionId: parent.sketch.current!.id,
            sketchInputHash: executionDigest({ revisionId: parent.sketch.approved!.revisionId, documentHash: parent.sketch.approved!.documentHash,
                requirementsDigest: parent.sketch.approved!.requirementsDigest, assets: parent.sketch.approved!.assets }),
        })) };
    for (const checkpoint of parent.prototypeFlow.checkpoints) checkpoint.sourceFingerprint = await fingerprintPrototypeWorkspace(source);
    await h.api.persistState(parent);
    const draft = await h.api.openStageReview("sample", provider, { stageId: "prototype", expectedGeneration: parent.generation });
    const server = await h.api.startServer("prototype-review-http", "sample", provider, true);
    t.after(async () => {
        clearInterval(server.heartbeat);
        await new Promise<void>(resolve => { server.server.close(() => resolve()); server.server.closeAllConnections(); });
    });
    const response = await fetch(new URL(`/api/reviews/${draft.prototypeId}/revision`, server.url), {
        method: "POST", headers: { "Content-Type": "application/json", Origin: new URL(server.url).origin },
        body: JSON.stringify({ suggestion: "Move the task status below the title.", clientRequestId: "draft-feedback",
            baseCheckpointId: "accepted-interaction" }),
    });
    assert.equal(response.status, 202);
    assert.equal(h.requests.length, 0);
    assert.deepEqual((await readdir(join(h.root, ".tandem", "efforts", draft.prototypeId))).sort(), ["review-baseline.json", "state.json"]);
    h.api.setSession({ ...h.session, rpc: { ...h.session.rpc, workflow: { run: async request => {
        h.requests.push(request);
        const checkpoint = request.args.state.prototypeFlow.checkpoints.at(-1);
        await h.api.readSketchImage({ prototypeId: draft.prototypeId, checkpointId: checkpoint.id,
            revisionId: parent.sketch.current!.id, screenId: "main" });
        const html = `<meta name="tandem-prototype-id" content="sample"><meta name="tandem-prototype-checkpoint" content="${checkpoint.id}"><button>Reviewed task status</button>`;
        await writeFile(join(checkpoint.workspacePath, "index.html"), html);
        h.setPreviewHtml(html);
        return { runId: "draft-preview-run", status: "completed", result: { summary: "Synthetic draft task update",
            focus: "Inspect the task status", previewUrl: "http://127.0.0.1:4322/", question: null,
            artifactChanges: { upsert: [], remove: [] }, evidence: [] } };
    } } } });
    await h.api.beginPrototypeBuild(draft.prototypeId, provider);
    await h.waitForRequests();
    await h.api.waitForAnswer(draft.prototypeId);
    const request = h.requests[0] as { args: { prototypeId: string; state: { previewPrototypeId: string } } };
    assert.equal(request.args.prototypeId, draft.prototypeId);
    assert.equal(request.args.state.previewPrototypeId, "sample");
    assert.match(h.api.answerFactoryPrompt(request.args), /tandem-prototype-id" content="sample"/);
    assert.equal(await readFile(join(source, "index.html"), "utf8"), "<button>Keep this task</button>");
    assert.equal((await h.api.loadState("sample")).lifecycle.currentStage, "development");
    await h.api.assertDevelopmentAvailable();
    const built = await h.api.loadState(draft.prototypeId);
    assert.ok(built.prototypeFlow!.pendingCheckpointId, JSON.stringify({ processing: built.processing, logs: h.logs }));
    const checkpoint = built.prototypeFlow!.checkpoints.at(-1)!;
    assert.equal(checkpoint.workspacePath, join(h.root, ".tandem", "efforts", "sample", "previews", checkpoint.requestId));
    const candidate = await h.api.prototypeAction(draft.prototypeId, provider, {
        action: "apply-update", checkpointId: checkpoint.id, expectedRevision: built.revision,
    });
    assert.equal((await h.api.loadState("sample")).prototypeFlow!.displayedCheckpointId, "accepted-interaction");
    candidate.prototypeReview.designSpecArtifactId = "draft-feature-spec";
    candidate.artifacts.push({ id: "draft-feature-spec", title: "Synthetic reviewed feature specification", kind: "feature-spec",
        stage: "prototype", path: "", language: "markdown", content: "The reviewed task status is below the title.", mermaid: "", reviewStatus: "current" });
    await h.api.persistState(candidate);
    const accepted = await h.api.applyStageReview("sample", provider, { reviewId: draft.prototypeId, expectedRevision: candidate.revision });
    assert.equal(accepted.lifecycle.currentStage, "development");
    assert.equal(accepted.prototypeFlow!.displayedCheckpointId, checkpoint.id);
    const handoffs = new DevelopmentHandoffs(h.root, h.root, h.session.sessionId);
    const review = await handoffs.review(accepted);
    const handoff = await handoffs.prepare(accepted, review.binding);
    assert.equal(handoff.prototype.sourceRoot, checkpoint.workspacePath);
    assert.equal(handoff.prototype.sourceFingerprint, checkpoint.sourceFingerprint);
    assert.equal(h.developmentRequests.length, 0, "Applying a draft does not authorize Development.");
});

test("review records reject conflicting identities and unsupported baselines", () => {
    assert.deepEqual(readStageReviews(undefined), []);
    assert.throws(() => readStageReviews([{ version: 1, id: "../escape" }]), /invalid/);
    assert.throws(() => readStageReviewDraft({ version: 1, parentId: "sample", stage: "requirements",
        baselineDigest: "not-a-digest", baselineRevision: 1 }, "review-11111111-1111-1111-1111-111111111111"), /invalid baseline/);
});
