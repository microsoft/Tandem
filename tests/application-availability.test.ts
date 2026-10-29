import assert from "node:assert/strict";
import { test } from "node:test";
import {
    projectApplicationCapabilities, upstreamAvailability, upstreamOperations, type ApplicationState,
} from "../src/application-interface.js";
import type { ChangeRequest, ChangeStatus } from "../src/change-requests.js";
import { createStageReview, type ReviewStage } from "../src/stage-review.js";
import { lifecycleStages } from "../src/workflow.js";
import { state } from "./helpers/react-harness.js";
import type { ApplicationInput } from "../development/tandem/runtime-src/application-interface.js";

function availability(id: string, value: ApplicationState, input?: ApplicationInput, actor: "user" | "agent" = "user") {
    const operation = upstreamOperations.find(item => item.id === id);
    assert.ok(operation, `Missing operation ${id}`);
    return upstreamAvailability(operation, value, actor, input);
}

function review(stage: ReviewStage): ApplicationState {
    const parent = state("development");
    const draft = createStageReview(parent, {
        version: 1, id: "review-11111111-1111-4111-8111-111111111111", stage,
        generation: parent.generation, createdAt: parent.updatedAt, appliedAt: null, discardedAt: null,
    });
    return { ...draft, stageReviewStatus: { conflict: "", blocker: null, changed: true, appliedAt: null, discardedAt: null } };
}

function change(status: ChangeStatus): ChangeRequest {
    return {
        version: 1, id: "change", clientRequestId: "client", originStage: "requirements", message: "Add saving.",
        submittedAt: "2026-10-28T00:00:00Z", status, assessment: null, analysisId: null, baselineDigest: null,
        error: "", clarifications: [], remainingStages: ["requirements"], workStarted: [], affectedDecisionIds: [],
        snapshotPath: null, completedAt: null, baseCheckpointId: null, baseSketchRevisionId: null, visualSelection: null,
        sourceResultId: null, sourceRequests: [], developmentAdmission: null, developmentRequest: null,
    };
}

test("every declared operation preserves read-only, reset and settled-review fences in every stage", () => {
    for (const { id: stage } of lifecycleStages) {
        for (const operation of upstreamOperations) {
            const value = state(stage);
            value.provider = { ...value.provider, canSubmitAnswers: false };
            const readOnly = upstreamAvailability(operation, value, "user");
            assert.equal(readOnly.blockers.some(item => item.code === "read_only_provider"), operation.method === "POST",
                `${stage}: ${operation.id} read-only fence`);
            value.provider = { ...value.provider, canSubmitAnswers: true };
            value.effortReset = { generation: value.generation, requestId: "reset", error: "" };
            const resetting = upstreamAvailability(operation, value, "user");
            assert.equal(resetting.blockers.some(item => item.code === "reset_pending"),
                operation.method === "POST" && operation.id !== "project.reset", `${stage}: ${operation.id} reset fence`);
            for (const outcome of ["appliedAt", "discardedAt"] as const) {
                const settled = { ...value, effortReset: null, stageReviewStatus: {
                    conflict: "", blocker: null, changed: true, appliedAt: null, discardedAt: null,
                    [outcome]: value.updatedAt,
                } };
                assert.equal(upstreamAvailability(operation, settled, "user").blockers.some(item => item.code === "review_not_editable"),
                    operation.method === "POST", `${stage}: ${operation.id} ${outcome}`);
            }
        }
    }
});

test("stage-specific commands and Requirements action variants stay within their owning stage", () => {
    const commands = [
        { id: "project.start", stages: ["prepare"] },
        { id: "preparation.retry", stages: ["prepare"] },
        { id: "designs.edit", stages: ["sketch"] },
        { id: "prototype.start", stages: ["prototype"] },
        { id: "prototype.feedback", stages: ["prototype"] },
        { id: "prototype.action", stages: ["prototype"] },
        { id: "changes.submit", stages: ["requirements", "sketch", "prototype"] },
        ...["add-usage", "generate-dag", "answer-decision", "change-answer", "apply-defaults", "clarify-revision"].map(action => ({
            id: "requirements.submit", stages: [action === "clarify-revision" ? "prototype" : "requirements"], input: { action },
        })),
    ];
    for (const { id: stage } of lifecycleStages) {
        const value = state(stage);
        value.requirements.usageItems = ["I want to save tasks."];
        for (const command of commands) {
            const result = availability(command.id, value, "input" in command ? command.input : undefined);
            assert.equal(result.blockers.some(item => item.code === "stage_not_active"), !command.stages.includes(stage),
                `${stage}: ${command.id} ${"input" in command ? command.input.action : ""}`);
        }
    }
    const value = state("prototype");
    assert.equal(availability("requirements.submit", value).status, "blocked");
    value.prototypeReview.question = { id: "clarification" };
    assert.equal(availability("requirements.submit", value).status, "available");
    assert.equal(availability("requirements.submit", value, { action: "generate-dag" }).status, "blocked");
});

test("all command and action variants preserve human authority even when otherwise blocked", () => {
    const humanCommands = [
        "project.choose-entry", "project.reset", "project.recover", "prototype.restart.decide", "changes.abandon",
        "reviews.apply", "reviews.discard", "stages.complete", "stages.reopen", "settings.effort.select",
        "maintenance.reload", "development.setup", "development.continue",
    ];
    const expected: Record<string, string[]> = {
        "requirements.submit": ["answer-decision", "change-answer", "apply-defaults", "clarify-revision"],
        "designs.edit": ["approve"],
        "prototype.action": ["apply-update", "choose-visual", "visual-original", "skip-visual"],
        "changes.decide": ["approve", "clarify", "refine"],
    };
    assert.deepEqual(upstreamOperations.filter(item => item.authority === "user").map(item => item.id), humanCommands);
    assert.deepEqual(Object.fromEntries(upstreamOperations.filter(item => item.humanActions).map(item => [item.id, item.humanActions])), expected);
    for (const operation of upstreamOperations) {
        const field = operation.id === "changes.decide" ? "decision" : "action";
        const actions = operation.inputSchema.properties?.[field]?.enum ?? [];
        const inputs = [undefined, ...actions.map(action => ({ [field]: action }))];
        for (const input of inputs) {
            const value = state("requirements");
            value.provider = { ...value.provider, canSubmitAnswers: false };
            const result = upstreamAvailability(operation, value, "agent", input);
            const human = humanCommands.includes(operation.id) || Boolean(input && expected[operation.id]?.includes(String(input[field])));
            assert.equal(result.status === "human-required", human, `${operation.id}: ${JSON.stringify(input)}`);
            assert.equal(result.blockers.some(item => item.code === "human_decision_required"), human);
            assert.equal(upstreamAvailability(operation, value, "user", input).status === "human-required", false);
        }
    }
});

test("pinned reviews expose only their own stage routes plus read and recovery operations", () => {
    const reads = ["project.state", "reviews.baseline", "designs.read", "preparation.status", "workflow.status", "prototype.preview"];
    const common = ["reviews.apply", "reviews.discard", "project.recover"];
    const writes: Record<ReviewStage, string[]> = {
        prepare: ["reviews.edit-brief", "preparation.retry"],
        requirements: ["requirements.submit", "changes.submit", "changes.decide"],
        sketch: ["designs.edit"],
        prototype: ["prototype.feedback", "requirements.submit", "prototype.start", "prototype.action", "stages.complete",
            "prototype.restart.inspect", "prototype.restart.decide"],
    };
    for (const stage of Object.keys(writes) as ReviewStage[]) {
        const value = review(stage);
        const allowed = new Set([...reads, ...common, ...writes[stage]]);
        for (const operation of upstreamOperations) {
            const result = upstreamAvailability(operation, value, "user");
            assert.equal(result.blockers.some(item => item.code === "review_action_unavailable"), !allowed.has(operation.id),
                `${stage}: ${operation.id}`);
        }
    }
    for (const id of ["reviews.baseline", "reviews.edit-brief"]) {
        assert.ok(availability(id, state("prepare")).blockers.some(item => item.code === "review_required"));
    }
});

test("review apply distinguishes changed, unchanged, conflicting, blocked and settled drafts", () => {
    const cases: Array<[Partial<NonNullable<ApplicationState["stageReviewStatus"]>>, string[]]> = [
        [{}, []],
        [{ changed: false }, ["review_unchanged"]],
        [{ conflict: "Accepted inputs changed." }, ["review_baseline_stale"]],
        [{ blocker: "Answer the remaining questions." }, ["review_not_ready"]],
        [{ appliedAt: "2026-10-28T00:00:00Z" }, ["review_not_editable"]],
        [{ discardedAt: "2026-10-28T00:00:00Z" }, ["review_not_editable"]],
        [{ changed: false, conflict: "Accepted inputs changed.", blocker: "Answer the remaining questions." },
            ["review_baseline_stale", "review_not_ready", "review_unchanged"]],
    ];
    for (const [status, codes] of cases) {
        const value = review("requirements");
        assert.ok(value.stageReviewStatus);
        Object.assign(value.stageReviewStatus, status);
        const result = availability("reviews.apply", value);
        assert.deepEqual(result.blockers.map(item => item.code), codes);
        assert.equal(result.status, codes.length ? "blocked" : "available");
        assert.ok(result.blockers.every(item => item.message.trim()));
    }
});

test("all discovery change statuses preserve their editing fence without blocking retained Development history", () => {
    const blocked: Record<ChangeStatus, boolean> = {
        queued: true, analyzing: true, proposed: true, reviewing: false, active: false,
        deferred: false, completed: false, cancelled: false, failed: true,
    };
    for (const [status, expected] of Object.entries(blocked)) {
        const value = state("requirements");
        value.changeRequests = [change(status as ChangeStatus)];
        for (const id of ["requirements.submit", "designs.edit"]) {
            assert.equal(availability(id, value).blockers.some(item => item.code === "change_review_required"), expected,
                `${id}: ${status}`);
        }
        value.changeRequests[0].originStage = "development";
        assert.equal(availability("requirements.submit", value).blockers.some(item => item.code === "change_review_required"), false);
    }
    const value = state("requirements");
    value.changeRequests = [{ ...change("reviewing"), remainingStages: ["sketch"] }];
    assert.ok(availability("requirements.submit", value).blockers.some(item => item.code === "change_review_required"));
});

test("owned work blocks destructive and completing operations but leaves reads and queued feedback inspectable", () => {
    const guarded = new Set(["designs.edit", "prototype.start", "stages.complete", "reviews.apply", "reviews.discard", "changes.abandon"]);
    for (const status of ["running", "success", "error"]) {
        const value = state("prototype");
        value.processing = { action: "build-prototype", status };
        for (const operation of upstreamOperations) {
            const result = upstreamAvailability(operation, value, "user");
            assert.equal(result.blockers.some(item => item.code === "processing_in_progress"),
                status === "running" && guarded.has(operation.id), `${operation.id}: ${status}`);
        }
    }
});

test("abandonment availability requires the current, uncommitted restore point in the same effort", () => {
    const value = state("requirements");
    value.changeRequests = [{ ...change("completed"), restorePoint: {
        requestId: "change", generation: value.generation, digest: "a".repeat(64),
    } }];
    assert.equal(availability("changes.abandon", value, { requestId: "change" }).status, "available");
    const cases: Array<[string, (snapshot: ApplicationState) => void, ApplicationInput?]> = [
        ["no review", snapshot => { snapshot.changeRequests = []; }],
        ["no restore point", snapshot => { delete snapshot.changeRequests![0].restorePoint; }],
        ["another generation", snapshot => { snapshot.generation = "new-generation"; }],
        ["wrong request", () => {}, { requestId: "different" }],
        ["committed", snapshot => { snapshot.changeRequests![0].committedAt = snapshot.updatedAt; }],
        ["abandoned", snapshot => { snapshot.changeRequests![0].abandonment = {
            abandonedAt: snapshot.updatedAt, snapshotPath: "history\\abandoned.json",
        }; }],
        ["finished Prototype", snapshot => { snapshot.lifecycle.completedStages.push("prototype"); }],
        ["Development", snapshot => { snapshot.stage = snapshot.lifecycle.currentStage = "development"; }],
    ];
    for (const [name, mutate, input] of cases) {
        const snapshot = structuredClone(value); mutate(snapshot);
        assert.ok(availability("changes.abandon", snapshot, input).blockers.some(item => item.code === "change_restore_unavailable"), name);
    }
});

test("start, retry, intake and completion readiness distinguish their non-working states", () => {
    const value = state("prepare");
    value.goal = "";
    assert.equal(availability("project.start", value).status, "available");
    const retries: Record<typeof value.preparation.status, boolean> = {
        "not-started": false, starting: false, running: false, ready: false, "needs-attention": false, failed: true,
    };
    for (const [status, retry] of Object.entries(retries)) {
        value.preparation.status = status as typeof value.preparation.status;
        assert.equal(availability("preparation.retry", value).status === "available", retry, status);
        assert.equal(availability("project.start", value).status === "available", status === "not-started", status);
    }
    const draft = review("prepare");
    draft.preparation.status = "ready";
    assert.equal(availability("preparation.retry", draft).status, "available", "A reviewed brief can be analyzed again.");
    const requirements = state("requirements");
    assert.ok(availability("requirements.submit", requirements, { action: "generate-dag" }).blockers.some(item => item.code === "usage_required"));
    requirements.requirements.usageItems = ["I want to save tasks."];
    assert.equal(availability("requirements.submit", requirements, { action: "generate-dag" }).status, "available");
    requirements.requirements.substage = "dag";
    for (const action of ["generate-dag", "add-usage"]) {
        assert.ok(availability("requirements.submit", requirements, { action }).blockers.some(item => item.code === "intake_closed"));
    }
    for (const { id: stage } of lifecycleStages) {
        const snapshot: ApplicationState = { ...state(stage), stageCompletionBlocker: "Saved evidence is not ready." };
        assert.equal(availability("stages.complete", snapshot).status, "blocked", stage);
        snapshot.stageCompletionBlocker = null;
        assert.equal(availability("stages.complete", snapshot).status, ["prepare", "development"].includes(stage) ? "blocked" : "available", stage);
    }
});

test("capability projection covers the complete catalog and never changes saved state", () => {
    for (const { id: stage } of lifecycleStages) {
        const value = state(stage), original = structuredClone(value);
        const projected = projectApplicationCapabilities(value);
        assert.equal(projected.protocol, "tandem-application/v1");
        assert.equal(projected.canFinishPrototypeWithCurrentVisual, false, "Keeping visuals requires the host's additional readiness projection.");
        assert.deepEqual(Object.keys(projected.operations), upstreamOperations.map(item => item.id));
        for (const operation of upstreamOperations) {
            assert.deepEqual(projected.operations[operation.id], upstreamAvailability(operation, value, "user"), operation.id);
        }
        assert.deepEqual(projectApplicationCapabilities(value), projected);
        assert.deepEqual(value, original);
    }
});
