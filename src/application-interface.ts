import {
    APPLICATION_PROTOCOL, applicationAvailability, booleanSchema, enumSchema, idSchema, nullableSchema,
    objectSchema, revisionSchema, stringSchema,
    type ApplicationActor, type ApplicationBlocker, type ApplicationInput, type ApplicationOperation, type ApplicationSchema,
} from "../development/tandem/runtime-src/application-interface.js";
import { changeReviewBlocksEditing, changeReviewToAbandon } from "./change-request-policy.js";
import { sketchChangeContextSchema } from "./change-requests.js";
import { sketchDocumentSchema } from "./sketch.js";
import { visualSelectionSchema } from "./visual-directions.js";
import { hasActiveWork } from "./workflow.js";
import type { LifecycleStageId, TandemState } from "./types.js";

export { APPLICATION_PROTOCOL };
export interface UpstreamOperation extends ApplicationOperation {
    stages?: readonly LifecycleStageId[];
    draft?: boolean;
    bindsState?: boolean;
}
const hash: ApplicationSchema = { type: "string", pattern: "^[a-f0-9]{64}$" };
const text = stringSchema();
const strings: ApplicationSchema = { type: "array", items: text, maxItems: 200 };
const stage = enumSchema("prepare", "requirements", "sketch", "prototype");
const expected = { generation: idSchema, expectedRevision: revisionSchema };
const operation = (id: string, method: "GET" | "POST", path: string, description: string,
    inputSchema = objectSchema(), options: Partial<UpstreamOperation> = {}): UpstreamOperation => ({
    id, method, path, description, inputSchema, authority: "agent", retry: method === "GET" ? "read" : "inspect",
    bindsState: method === "POST", ...options,
});

export const upstreamOperations: readonly UpstreamOperation[] = [
    operation("project.state", "GET", "/api/state", "Read the current effort or pinned review, including saved decisions and work receipts.", objectSchema(), { draft: true }),
    operation("project.entry", "GET", "/api/project-entry", "Read the project's saved starting path."),
    operation("project.choose-entry", "POST", "/api/project-entry", "Choose Preparation or native Development without submitting work.",
        objectSchema({ startingPath: enumSchema("preparation", "development") }, ["startingPath"]), { authority: "user", bindsState: false }),
    operation("project.open", "POST", "/api/project-entry/open", "Open the saved starting path; does not authorize implementation.", objectSchema(), { bindsState: false }),
    operation("project.start", "POST", "/api/effort/start", "Start Preparation with the explicitly supplied goal.",
        objectSchema({ ...expected, goal: text }, ["generation", "expectedRevision", "goal"]), { stages: ["prepare"] }),
    operation("project.reset", "POST", "/api/effort/reset", "Reset this upstream effort after explicit confirmation; retain Development ownership.",
        objectSchema({ ...expected, confirm: { const: true } }, ["generation", "expectedRevision", "confirm"]), { authority: "user" }),
    operation("project.recover", "POST", "/api/effort/recover", "Abandon an uncertain launch only after bound human confirmation and native idle inspection.",
        objectSchema({ ...expected, requestId: idSchema, decisionId: idSchema, confirm: { const: true },
            owner: objectSchema({ sessionId: idSchema, workspaceRoot: text }, ["sessionId", "workspaceRoot"]) },
        ["generation", "expectedRevision", "requestId", "decisionId", "confirm", "owner"]), { authority: "user", draft: true }),
    operation("preparation.status", "GET", "/api/preparation/status", "Read Preparation and its native activity.", objectSchema(), { draft: true }),
    operation("preparation.retry", "POST", "/api/preparation/retry", "Retry failed Preparation, or analyze an edited Preparation draft.",
        objectSchema(), { stages: ["prepare"], draft: true }),
    operation("workflow.status", "GET", "/api/workflow/status", "Read owned asynchronous work without inferring completion from silence.", objectSchema(), { draft: true }),
    operation("requirements.submit", "POST", "/api/answer", "Add usage, generate the DAG, or submit a human decision/default batch. Clarifications remain human decisions.",
        { ...objectSchema({
            action: enumSchema("add-usage", "generate-dag", "answer-decision", "change-answer", "apply-defaults", "clarify-revision"),
            questionId: stringSchema(200), answer: stringSchema(4000, 0), ...expected, retryRequestId: idSchema,
            expectedRequirementsDigest: hash,
            defaults: { type: "array", maxItems: 200, items: objectSchema({ nodeId: idSchema, answer: text }, ["nodeId", "answer"]) },
        }, ["action"]), oneOf: [
            { properties: { action: { const: "add-usage" } }, required: ["answer"] },
            { properties: { action: { const: "generate-dag" } } },
            { properties: { action: enumSchema("answer-decision", "change-answer", "clarify-revision") }, required: ["questionId", "answer"] },
            { properties: { action: { const: "apply-defaults" } }, required: ["generation", "expectedRevision"],
                oneOf: [{ required: ["defaults"] }, { required: ["retryRequestId"] }] },
        ] }, { draft: true, retry: "inspect",
            humanActions: ["answer-decision", "change-answer", "apply-defaults", "clarify-revision"] }),
    operation("designs.read", "GET", "/api/sketch", "Read the saved UI DSL document and revision/approval bindings.", objectSchema(), { draft: true }),
    operation("designs.edit", "POST", "/api/sketch", "Generate, update, revise, retry or save Designs. Approval requires the user's reviewed rendered version.",
        objectSchema({
            action: enumSchema("generate", "update", "revise", "retry", "save", "approve"),
            expectedRevision: nullableSchema(stringSchema(200)), expectedGeneration: idSchema, requestId: idSchema,
            instruction: text, clientRequestId: idSchema, sketchContext: sketchChangeContextSchema,
            document: sketchDocumentSchema, previews: { type: "array", maxItems: 8, items: objectSchema({
                screenId: idSchema, data: stringSchema(12 * 1024 * 1024),
            }, ["screenId", "data"]) },
        }, ["action", "expectedRevision"]), { draft: true, stages: ["sketch"], humanActions: ["approve"], retry: "identity" }),
    operation("prototype.start", "POST", "/api/prototype/start", "Build the authorized prototype or explicitly build a draft preview.",
        objectSchema(), { draft: true, stages: ["prototype"] }),
    operation("prototype.feedback", "POST", "/api/revision", "Submit feedback or replace the current review using its exact request identity.",
        objectSchema({ suggestion: text, clientRequestId: idSchema, replacesRequestId: idSchema,
            baseCheckpointId: nullableSchema(idSchema), visualSelection: visualSelectionSchema }, ["suggestion", "clientRequestId"]),
        { draft: true, stages: ["prototype"], retry: "identity" }),
    operation("prototype.action", "POST", "/api/prototype/action", "Prepare, retry or compare prototypes. Applying a version or choosing a direction requires user review.",
        objectSchema({ action: enumSchema("apply-update", "retry", "visual", "visual-preview", "refine-visual", "choose-visual",
            "visual-original", "visual-back", "skip-visual", "extend-budget"),
        checkpointId: idSchema, expectedRevision: revisionSchema, selection: visualSelectionSchema, suggestion: text, clientRequestId: idSchema }, ["action"]),
        { draft: true, stages: ["prototype"], humanActions: ["apply-update", "choose-visual", "visual-original", "skip-visual"] }),
    operation("prototype.preview", "GET", "/api/prototype/preview-status", "Verify the identity and availability of a saved preview.",
        objectSchema({ target: stringSchema(100) }), { query: ["target"], draft: true }),
    operation("prototype.restart.inspect", "POST", "/api/prototype/preview-restart/inspect", "Inspect a retained preview launch recipe without starting it.",
        objectSchema({ target: stringSchema(100), generation: idSchema, checkpointId: idSchema, entrypoint: text,
            args: strings, workingDirectory: text, choiceId: idSchema }, ["target", "generation", "checkpointId"]), { draft: true }),
    operation("prototype.restart.decide", "POST", "/api/prototype/preview-restart/decision", "Decide the exact preview restart confirmation.",
        objectSchema({ confirmationId: idSchema, approve: booleanSchema }, ["confirmationId", "approve"]), { authority: "user", draft: true }),
    operation("changes.submit", "POST", "/api/change-requests", "Assess explicit change feedback without replacing accepted work.",
        objectSchema({ message: text, clientRequestId: idSchema, replacesRequestId: idSchema, originStage: enumSchema("requirements", "sketch", "prototype"),
            expectedGeneration: idSchema, expectedRevision: nullableSchema(idSchema), sketchContext: sketchChangeContextSchema,
            baseCheckpointId: nullableSchema(idSchema), visualSelection: visualSelectionSchema }, ["message", "clientRequestId"]),
        { draft: true, stages: ["requirements", "sketch", "prototype"], retry: "identity" }),
    operation("changes.decide", "POST", "/api/change-requests/decision", "Retry or cancel a saved change, or record the user's exact impact decision.",
        objectSchema({ requestId: idSchema, decision: enumSchema("approve", "cancel", "retry", "clarify", "refine"),
            analysisId: idSchema, baselineDigest: hash, answer: stringSchema(4000, 0) }, ["requestId", "decision"]),
        { draft: true, humanActions: ["approve", "clarify", "refine"], retry: "identity" }),
    operation("changes.abandon", "POST", "/api/change-requests/abandon", "Restore the whole review to its original pre-request state before Finish Prototype, retaining history.",
        objectSchema({ ...expected, requestId: idSchema, restorePointDigest: hash, confirm: { const: true } },
            ["generation", "expectedRevision", "requestId", "restorePointDigest", "confirm"]),
        { authority: "user", retry: "identity" }),
    operation("changes.continue-development", "POST", "/api/change-requests/development", "Send an explicitly approved completed discovery change to its native owner.",
        objectSchema({ requestId: idSchema }, ["requestId"]), { retry: "identity", bindsState: false }),
    operation("reviews.open", "POST", "/api/reviews/open", "Create or resume a separate earlier-stage draft without applying its changes.",
        objectSchema({ stageId: stage, expectedGeneration: idSchema, changeRequestId: idSchema, analysisId: idSchema, baselineDigest: hash },
            ["stageId", "expectedGeneration"]), { retry: "identity" }),
    operation("reviews.apply", "POST", "/api/reviews/apply", "Apply the user's reviewed saved draft using its exact revision and baseline.",
        objectSchema({ reviewId: idSchema, expectedRevision: revisionSchema }, ["reviewId", "expectedRevision"]), { authority: "user", draft: true, retry: "identity" }),
    operation("reviews.discard", "POST", "/api/reviews/discard", "Discard a draft after user confirmation, retaining its history.",
        objectSchema({ reviewId: idSchema, expectedRevision: revisionSchema }, ["reviewId", "expectedRevision"]), { authority: "user", draft: true, retry: "identity" }),
    operation("reviews.baseline", "GET", "/api/baseline", "Read the exact immutable baseline of the targeted review.", objectSchema(), { draft: true }),
    operation("reviews.edit-brief", "POST", "/api/goal", "Edit a pinned Preparation brief; analysis and applying remain separate.",
        objectSchema({ goal: text, expectedRevision: revisionSchema }, ["goal", "expectedRevision"]), { draft: true, stages: ["prepare"] }),
    operation("stages.complete", "POST", "/api/stage/complete", "Record explicit stage completion. Prototype generates its bound specification first.",
        objectSchema({ stageId: stage, continueDevelopment: booleanSchema }, ["stageId"]), { authority: "user", draft: true }),
    operation("stages.reopen", "POST", "/api/stage/reopen", "Explicitly reopen an upstream stage while retaining its history.",
        objectSchema({ stageId: stage }, ["stageId"]), { authority: "user" }),
    operation("settings.effort.read", "GET", "/api/settings/project-effort", "Read the independent sessions' effective project effort."),
    operation("settings.effort.select", "POST", "/api/settings/project-effort", "Select an explicitly requested project effort without silently substituting models.",
        objectSchema({ effort: enumSchema("none", "minimal", "low", "medium", "high", "xhigh", "max") }, ["effort"]), { authority: "user", bindsState: false }),
    operation("maintenance.reload", "POST", "/api/reload", "Reload the supported provider; not a reset, update or work retry.",
        objectSchema(), { authority: "user", bindsState: false }),
    operation("development.model-required", "GET", "/api/development/model-selection", "Inspect whether native Development needs an explicit model selection."),
    operation("development.preflight", "GET", "/api/development/preflight", "Inspect Git readiness and any one-use setup consent."),
    operation("development.setup", "POST", "/api/development/setup", "Apply only the exact human-confirmed Git setup.",
        objectSchema({ token: idSchema }, ["token"]), { authority: "user", bindsState: false }),
    operation("development.handoff", "GET", "/api/development/handoff", "Read the saved Prototype handoff admission."),
    operation("development.review-handoff", "GET", "/api/development/handoff-review", "Read the exact saved Prototype summary without starting work."),
    operation("development.status", "GET", "/api/development/status", "Read native ownership and runtime status without starting work."),
    operation("development.view", "POST", "/api/development/view", "Open a native Development view without submitting a task.", objectSchema(), { bindsState: false }),
    operation("development.open", "POST", "/api/development/open", "Initialize or explicitly retry the native runtime; opening does not submit work.",
        objectSchema({ retry: booleanSchema }), { bindsState: false }),
    operation("development.continue", "POST", "/api/development/continue", "Continue the explicitly reviewed exact Prototype into native Designer, not implementation.",
        objectSchema({ generation: idSchema, snapshotPath: text, expectedRevision: revisionSchema, reviewBinding: hash },
            ["generation", "snapshotPath", "expectedRevision"]), { authority: "user", retry: "identity", bindsState: false }),
];

export interface ApplicationState extends TandemState {
    provider?: { canSubmitAnswers?: boolean };
    stageCompletionBlocker?: string | null;
    stageReviewStatus?: { conflict: string; blocker: string | null; changed: boolean; appliedAt: string | null; discardedAt: string | null };
}

export const reviewReadPaths = new Set(["/state", "/baseline", "/sketch", "/preparation/status", "/workflow/status", "/prototype/preview-status"]);
export const reviewWritePaths: Record<Exclude<LifecycleStageId, "development">, readonly string[]> = {
    prepare: ["/goal", "/preparation/retry"],
    requirements: ["/answer", "/change-requests", "/change-requests/decision"],
    sketch: ["/sketch"],
    prototype: ["/revision", "/answer", "/prototype/start", "/prototype/action", "/stage/complete",
        "/prototype/preview-restart/inspect", "/prototype/preview-restart/decision"],
};

export function upstreamAvailability(operation: UpstreamOperation, state: ApplicationState, actor: ApplicationActor, input?: ApplicationInput) {
    const blockers: ApplicationBlocker[] = [];
    const block = (code: string, message: string) => blockers.push({ code, message });
    if (state.stageReview && !operation.draft) block("review_action_unavailable", "This operation does not belong to a pinned review.");
    if (state.stageReview && operation.draft && !["reviews.apply", "reviews.discard"].includes(operation.id)) {
        const suffix = operation.path.slice(4);
        if (!(operation.method === "GET" ? reviewReadPaths.has(suffix)
            : reviewWritePaths[state.stageReview.stage].includes(suffix) || suffix === "/effort/recover")) {
            block("review_action_unavailable", "This operation does not belong to the pinned stage.");
        }
    }
    if (!state.stageReview && ["reviews.baseline", "reviews.edit-brief"].includes(operation.id)) block("review_required", "Target a saved review for this operation.");
    if (operation.method === "POST") {
        if (state.provider?.canSubmitAnswers === false) block("read_only_provider", "Use the owning writable provider.");
        if (operation.stages && !operation.stages.includes(state.lifecycle.currentStage)) block("stage_not_active", "This operation is not available in the current stage.");
        if (state.effortReset && operation.id !== "project.reset") block("reset_pending", "Resolve the pending reset before changing this effort.");
        if (state.stageReviewStatus?.appliedAt || state.stageReviewStatus?.discardedAt) block("review_not_editable", "This saved draft is no longer editable.");
        if (operation.id === "project.start" && (state.goal.trim() || state.preparation.status !== "not-started" || hasActiveWork(state))) {
            block("effort_started", "This effort has already started. Inspect its saved work instead of starting it again.");
        }
        if (operation.id === "preparation.retry" && !state.stageReview && state.preparation.status !== "failed") {
            block("preparation_not_failed", "Preparation can be retried only after a failed preparation run.");
        }
        if (operation.id === "requirements.submit") {
            const clarification = input?.action === "clarify-revision";
            if (state.lifecycle.currentStage !== (clarification ? "prototype" : "requirements")
                && !(input === undefined && state.lifecycle.currentStage === "prototype" && state.prototypeReview.question)) {
                block("stage_not_active", clarification ? "Prototype clarification is not active." : "Requirements collection is not active.");
            }
            if (input?.action === "generate-dag" && !state.requirements.usageItems.length) {
                block("usage_required", "Add at least one usage before generating the DAG.");
            }
            if (["add-usage", "generate-dag"].includes(String(input?.action)) && state.requirements.substage !== "usage") {
                block("intake_closed", "Usage intake is no longer active. Submit an explicit change against the saved requirements.");
            }
        }
        if (operation.id === "stages.complete") {
            if (state.lifecycle.currentStage === "prepare") block("preparation_owned", "Preparation completes through its owned result, not a manual stage command.");
            else if (state.lifecycle.currentStage === "development") block("development_owned", "Native Development owns its own completion and Review.");
            else if (state.stageCompletionBlocker) block("stage_not_ready", state.stageCompletionBlocker);
        }
        if (["requirements.submit", "designs.edit"].includes(operation.id) && changeReviewBlocksEditing(state)) {
            block("change_review_required", "Resolve the current change review before editing this work.");
        }
        if (operation.id === "reviews.apply" && state.stageReviewStatus) {
            const review = state.stageReviewStatus;
            if (review.conflict) block("review_baseline_stale", review.conflict);
            if (review.blocker) block("review_not_ready", review.blocker);
            if (!review.changed) block("review_unchanged", "No saved changes to apply.");
        }
        if (operation.id === "changes.abandon" && (!changeReviewToAbandon(state)
            || input?.requestId !== undefined && changeReviewToAbandon(state)?.id !== input.requestId)) {
            block("change_restore_unavailable", "Only the latest review with a saved pre-request restore point can be abandoned before Finish Prototype.");
        }
        if (["designs.edit", "prototype.start", "stages.complete", "reviews.apply", "reviews.discard", "changes.abandon"].includes(operation.id) && hasActiveWork(state)) {
            block("processing_in_progress", "Wait for owned work to finish before changing this work.");
        }
    }
    return applicationAvailability(operation, actor, blockers, input);
}

export function projectApplicationCapabilities(state: ApplicationState) {
    return { protocol: APPLICATION_PROTOCOL,
        operations: Object.fromEntries(upstreamOperations.map(operation => [operation.id, upstreamAvailability(operation, state, "user")])) };
}
