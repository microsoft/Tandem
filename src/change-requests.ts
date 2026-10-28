import { createHash } from "node:crypto";
import type { LifecycleStageId, TandemState } from "./types.js";
import type { DecisionGraph, DecisionNode, DecisionQuestion } from "./workflow.js";
import { curatedDefault, decisionDescendants, lifecycleStages, validateDecisionGraph } from "./workflow.js";
import {
    patchSemanticList, requirementsChangeSetSchema, requirementsInputDigest, validateRequirementsValue,
} from "./requirements-reconciliation.js";
import type { VisualSelection } from "./visual-directions.js";
import { readVisualSelection, visualSelectionSchema } from "./visual-directions.js";
import type { SketchDocument } from "./sketch.js";
import { currentChangeReview, isCurrentStageChange, isDiscoveryChangeRequest, isLocalChange, pendingUpstreamReviewStage } from "./change-request-policy.js";
export { isLocalChange } from "./change-request-policy.js";

export interface RequirementsDelta {
    usages: { add: string[]; remove: string[] };
    upsert: Array<{ id: string; title: string; dependencies: string[]; question: DecisionQuestion }>;
    remove: string[];
    assumptions: { add: string[]; remove: string[] };
    deferred: { add: string[]; remove: string[] };
    prototypeApproach: TandemState["prototypeApproach"] | null;
}

export interface ChangeAssessment {
    version: 1;
    summary: string;
    reason: string;
    startStage: LifecycleStageId | "none";
    stages: Array<{ stage: LifecycleStageId; reason: string }>;
    preserved: string[];
    affectedScreenIds: string[];
    question: string | null;
    requirements: RequirementsDelta | null;
}

export interface SketchChangeContext {
    revisionId: string;
    screenId: string;
    nodeId: string | null;
}

export type ChangeStatus = "queued" | "analyzing" | "proposed" | "reviewing" | "active" | "deferred" | "completed" | "cancelled" | "failed";
export interface ChangeRequest {
    version: 1;
    id: string;
    clientRequestId: string;
    originStage: LifecycleStageId;
    message: string;
    submittedAt: string;
    baseCheckpointId: string | null;
    baseSketchRevisionId: string | null;
    sketchContext?: SketchChangeContext | null;
    visualSelection: VisualSelection | null;
    sourceResultId: string | null;
    sourceRequests: Array<{ id: string; message: string; receivedAt: string; context: string }>;
    baselineDigest: string | null;
    analysisId: string | null;
    assessment: ChangeAssessment | null;
    status: ChangeStatus;
    reviewId?: string | null;
    replacesRequestId?: string | null;
    replacedByRequestId?: string | null;
    error: string;
    clarifications: Array<{ question: string; answer: string }>;
    remainingStages: LifecycleStageId[];
    workStarted: LifecycleStageId[];
    affectedDecisionIds: string[];
    snapshotPath: string | null;
    restorePoint?: { requestId: string; generation: string; digest: string } | null;
    abandonment?: { abandonedAt: string; snapshotPath: string } | null;
    committedAt?: string | null;
    completedAt: string | null;
    developmentAdmission: "sending" | "admitted" | "uncertain" | null;
    developmentRequest: { id: string; message: string; receivedAt: string } | null;
}

const text = (maxLength = 4000, minLength = 1) => ({ type: "string", minLength, maxLength });
const nullable = <T extends object>(schema: T) => ({ anyOf: [schema, { type: "null" }] });
const array = <T extends object>(items: T, maxItems = 200) => ({ type: "array", items, maxItems });
const object = <T extends Record<string, object>>(properties: T) => ({
    type: "object", additionalProperties: false, properties, required: Object.keys(properties),
});
const stageSchema = { type: "string", enum: lifecycleStages.map(stage => stage.id) };
const strings = (maxItems = 50, maxLength = 2000) => ({ ...array(text(maxLength), maxItems), uniqueItems: true });
const patch = object({ add: strings(), remove: strings() });
const questionSchema = requirementsChangeSetSchema.properties.questions.items.properties.question;
export const requirementsDeltaSchema = object({
    usages: object({ add: strings(30, 500), remove: strings(30, 500) }),
    upsert: array(object({ id: text(120), title: text(240), dependencies: strings(200, 120), question: questionSchema })),
    remove: strings(200, 120), assumptions: patch, deferred: patch,
    prototypeApproach: requirementsChangeSetSchema.properties.prototypeApproach,
});
export const changeAssessmentSchema = object({
    version: { type: "integer", const: 1 },
    summary: text(1000), reason: text(2000),
    startStage: { type: "string", enum: [...lifecycleStages.map(stage => stage.id), "none"] },
    stages: array(object({ stage: stageSchema, reason: text(1000) }), 5),
    preserved: strings(20, 500), affectedScreenIds: strings(8, 120),
    question: nullable(text(2000)), requirements: nullable(requirementsDeltaSchema),
});
export const sketchChangeContextSchema = object({
    revisionId: text(120), screenId: text(120), nodeId: nullable(text(120)),
});
const changeRequestSchema = object({
    version: { type: "integer", const: 1 }, id: text(120), clientRequestId: text(120),
    originStage: stageSchema, message: text(), submittedAt: text(100),
    baseCheckpointId: nullable(text(120)), baseSketchRevisionId: nullable(text(120)), visualSelection: nullable(visualSelectionSchema),
    sketchContext: nullable(sketchChangeContextSchema),
    sourceResultId: nullable(text(500)),
    sourceRequests: array(object({ id: text(500), message: text(65536), receivedAt: text(100), context: text(524288) }), 50),
    baselineDigest: nullable(text(64)), analysisId: nullable(text(120)),
    assessment: nullable(changeAssessmentSchema),
    status: { type: "string", enum: ["queued", "analyzing", "proposed", "reviewing", "active", "deferred", "completed", "cancelled", "failed"] },
    reviewId: nullable(text(120)),
    replacesRequestId: nullable(text(120)), replacedByRequestId: nullable(text(120)),
    error: text(2000, 0), clarifications: array(object({ question: text(2000), answer: text() }), 20),
    remainingStages: array(stageSchema, 5), workStarted: array(stageSchema, 5), affectedDecisionIds: strings(200, 120),
    snapshotPath: nullable(text(2000)), completedAt: nullable(text(100)),
    restorePoint: nullable(object({ requestId: text(120), generation: text(200), digest: text(64) })),
    abandonment: nullable(object({ abandonedAt: text(100), snapshotPath: text(2000) })),
    committedAt: nullable(text(100)),
    developmentAdmission: nullable({ type: "string", enum: ["sending", "admitted", "uncertain"] }),
    developmentRequest: nullable(object({ id: text(120), message: text(4 * 1024 * 1024), receivedAt: text(100) })),
});
export function readChangeRequests(value: unknown): ChangeRequest[] {
    if (value === undefined) return [];
    if (Array.isArray(value)) value = value.map(item => item && typeof item === "object" && !Array.isArray(item)
        ? { reviewId: null, sketchContext: null, ...item } : item);
    validateRequirementsValue(Array.isArray(value) ? value.map(item => ({
        replacesRequestId: null, replacedByRequestId: null, restorePoint: null, abandonment: null, committedAt: null, ...item,
    })) : value, array(changeRequestSchema, 200), "change requests");
    const requests = value as ChangeRequest[];
    if (new Set(requests.map(request => request.id)).size !== requests.length ||
        new Set(requests.map(request => request.clientRequestId)).size !== requests.length ||
        requests.filter(request => isDiscoveryChangeRequest(request) && request.status === "active").length > 1) {
        throw new Error("Saved change requests have conflicting identities or active work.");
    }
    for (const request of requests) {
        if (![request.id, request.clientRequestId, request.analysisId].every(id => id === null || /^[A-Za-z0-9._-]{1,120}$/.test(id)) ||
            request.baselineDigest !== null && !/^[a-f0-9]{64}$/.test(request.baselineDigest) ||
            !Number.isFinite(Date.parse(request.submittedAt)) ||
            request.completedAt !== null && !Number.isFinite(Date.parse(request.completedAt)) ||
            ["proposed", "reviewing", "active"].includes(request.status) && (!request.assessment || !request.baselineDigest || !request.analysisId)
            || request.status === "reviewing" && !request.reviewId
            || request.reviewId != null && !/^review-[a-f0-9-]{36}$/.test(request.reviewId)) {
            throw new Error("Saved change request provenance is invalid. Its data was preserved.");
        }
        if (request.sketchContext && request.sketchContext.revisionId !== request.baseSketchRevisionId) {
            throw new Error("The saved design context does not match the request's source revision.");
        }
        if (request.replacesRequestId) {
            const previous = requests.find(item => item.id === request.replacesRequestId);
            if (!previous || requests.indexOf(previous) >= requests.indexOf(request)
                || !isDiscoveryChangeRequest(previous) || request.originStage !== "prototype") {
                throw new Error("Saved review feedback has an invalid previous request.");
            }
        }
        if (request.replacedByRequestId && !requests.some(item => item.id === request.replacedByRequestId && item.replacesRequestId === request.id)) {
            throw new Error("The replaced review has no matching feedback request.");
        }
        if (request.restorePoint) {
            const root = requests.find(item => item.id === request.restorePoint!.requestId);
            if (!root || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(root.id) || !/^[a-f0-9]{64}$/.test(request.restorePoint.digest)
                || root.restorePoint?.requestId !== root.id || root.restorePoint.digest !== request.restorePoint.digest
                || root.restorePoint.generation !== request.restorePoint.generation
                || root !== request && !previousChangeReviews({ changeRequests: requests }, request).includes(root)) {
                throw new Error("The saved change restore point does not match its original request.");
            }
        }
        if (request.abandonment && (!request.restorePoint || request.status !== "cancelled" || request.committedAt
            || !Number.isFinite(Date.parse(request.abandonment.abandonedAt)))
            || request.committedAt && (!request.restorePoint || !Number.isFinite(Date.parse(request.committedAt)))) {
            throw new Error("The saved change review outcome is invalid. Its history was preserved.");
        }
        if (request.visualSelection) readVisualSelection(request.visualSelection);
        if (Boolean(request.developmentAdmission) !== Boolean(request.developmentRequest) ||
            request.developmentRequest && request.developmentRequest.id !== `change-${request.id}`) {
            throw new Error("The saved Development change admission has no matching immutable request.");
        }
    }
    return structuredClone(requests);
}

export function previousChangeReviews(state: Pick<TandemState, "changeRequests">, request: ChangeRequest): ChangeRequest[] {
    const previous: ChangeRequest[] = [];
    let id = request.replacesRequestId;
    while (id) {
        const item = state.changeRequests?.find(candidate => candidate.id === id);
        if (!item || previous.some(candidate => candidate.id === id) || id === request.id) {
            throw new Error("The previous review context could not be verified.");
        }
        previous.unshift(item);
        id = item.replacesRequestId;
    }
    return previous;
}

export function activeChange(state: Pick<TandemState, "changeRequests">): ChangeRequest | undefined {
    return state.changeRequests?.find(request => isDiscoveryChangeRequest(request) && request.status === "active");
}

export function pendingChange(state: Pick<TandemState, "changeRequests">): ChangeRequest | undefined {
    return state.changeRequests?.find(request => isDiscoveryChangeRequest(request)
        && ["queued", "analyzing", "proposed", "failed"].includes(request.status)) ?? activeChange(state);
}

export function nextChangeWork(state: Pick<TandemState, "changeRequests">): ChangeRequest | undefined {
    const request = currentChangeReview(state);
    return request && ["active", "analyzing", "queued"].includes(request.status) ? request : undefined;
}

export function completeSavedChange(state: TandemState): TandemState {
    const request = activeChange(state), processing = state.processing, revision = state.sketch.current;
    if (!request || !isCurrentStageChange(state, request)) return state;
    // Requirements deltas were saved atomically with activation; answering their questions is separate work.
    const requirementsSaved = request.originStage === "requirements" && request.assessment?.requirements && request.snapshotPath
        && state.factoryRuns?.some(receipt => receipt.requestId === request.analysisId
            && receipt.generation === state.generation && receipt.runId && receipt.terminal && !receipt.recovery && !receipt.launchRejection);
    if (!requirementsSaved && (request.originStage !== "sketch" || !isLocalChange(state, request)
        || !request.workStarted.includes("sketch") || processing?.action !== "revise-sketch"
        || processing.status !== "success" || processing.changeRequestId !== request.id || !processing.completedAt
        || !revision || revision.source !== "revised" || revision.id === processing.sketchRequest?.baseRevisionId
        || revision.requirementsDigest !== processing.sketchRequest?.requirementsDigest
        || revision.requirementsDigest !== requirementsInputDigest(state)
        || !state.sketch.requests?.some(item => item.requestId === processing.requestId
            && item.baseRevisionId === processing.sketchRequest.baseRevisionId)
        || !state.factoryRuns?.some(receipt => receipt.requestId === processing.requestId
            && receipt.generation === state.generation && receipt.runId === processing.runId
            && receipt.runId && receipt.terminal && !receipt.recovery && !receipt.launchRejection))) return state;
    return { ...state, changeRequests: state.changeRequests!.map(item => item.id === request.id
        ? { ...item, status: "completed", remainingStages: [],
            completedAt: requirementsSaved ? new Date().toISOString() : processing.completedAt, error: "" } : item) };
}

export function readSketchChangeContext(value: unknown, source?: {
    revisionId: string | null; document: SketchDocument | null;
}): SketchChangeContext | null {
    if (value == null) return null;
    validateRequirementsValue(value, sketchChangeContextSchema, "design change context");
    const context = structuredClone(value as SketchChangeContext);
    if (source) {
        const screen = source.document?.screens.find(item => item.id === context.screenId);
        if (context.revisionId !== source.revisionId || !screen
            || context.nodeId !== null && (!("ui" in screen) || !Object.hasOwn(screen.ui.nodes, context.nodeId))) {
            throw new Error("The selected design screen or element changed. Select it in the current revision before sending.");
        }
    }
    return { revisionId: context.revisionId, screenId: context.screenId, nodeId: context.nodeId };
}

export function pendingPrototypeChange(state: TandemState): ChangeRequest | undefined {
    const revisions: Array<{ id: string; clientRequestId?: string | null; checkpointId?: string | null; status: string }> =
        state.prototypeReview.revisions ?? [];
    return state.changeRequests?.find(request => isDiscoveryChangeRequest(request)
        && ["active", "reviewing"].includes(request.status) && request.remainingStages[0] === "prototype"
        && !revisions.some(revision => revision.clientRequestId === `change-${request.id}` && revision.status === "applied"
            && state.prototypeFlow?.checkpoints.some(checkpoint => checkpoint.id === revision.checkpointId
                && checkpoint.revisionId === revision.id && checkpoint.generation === state.generation && checkpoint.status === "ready")));
}

export function cancelPrototypeChange(state: TandemState, requestId: string, completedAt: string): Pick<TandemState, "prototypeFlow" | "prototypeReview"> {
    const revisions: Array<{ id: string; clientRequestId?: string | null; status: string }> = state.prototypeReview.revisions ?? [];
    const cancelled = new Set(revisions.filter(item => item.clientRequestId === `change-${requestId}`
        && !["applied", "dismissed"].includes(item.status)).map(item => item.id));
    const pending = state.prototypeFlow?.checkpoints.find(item => item.id === state.prototypeFlow?.pendingCheckpointId);
    return {
        prototypeFlow: pending?.revisionId && cancelled.has(pending.revisionId)
            ? { ...state.prototypeFlow!, pendingCheckpointId: null } : state.prototypeFlow,
        prototypeReview: { ...state.prototypeReview,
            revisions: revisions.map(item => cancelled.has(item.id) ? { ...item, status: "dismissed", completedAt } : item),
            ...(cancelled.has(state.prototypeReview.activeRevisionId) ? { activeRevisionId: null, question: null } : {}),
        },
    };
}

export function prototypeNeedsChangeUpdate(state: TandemState): boolean {
    if (state.prototypeApproach.mode === "not-applicable") return false;
    if (pendingPrototypeChange(state)) return true;
    const displayed = state.prototypeFlow?.checkpoints.find(item => item.id === state.prototypeFlow?.displayedCheckpointId);
    const reviewedInputs = Boolean(state.lifecycle.reviewId || state.changeRequests?.some(request => request.snapshotPath && request.assessment?.requirements
        && !request.reviewId && !request.abandonment && ["active", "completed", "cancelled"].includes(request.status))
        || state.stageReviews?.some(review => review.appliedAt && ["prepare", "requirements", "sketch"].includes(review.stage)
            && !state.changeRequests?.some(request => request.id === review.changeRequestId && request.abandonment)));
    if (!displayed) return Boolean(state.previewUrl && reviewedInputs);
    const requirementsChanged = displayed.requirementsDigest
        ? displayed.requirementsDigest !== requirementsInputDigest(state) : reviewedInputs;
    const sketchesChanged = !state.lifecycle.skippedStages.some(item => item.stageId === "sketch")
        && (displayed.sketchRevisionId ?? null) !== (state.sketch.current?.id ?? null);
    return requirementsChanged || sketchesChanged;
}

export function restoreChangeReview(state: TandemState, baseline: TandemState, request: ChangeRequest,
    abandonment: NonNullable<ChangeRequest["abandonment"]>): TandemState {
    const rootId = request.restorePoint?.requestId;
    if (!rootId || baseline.prototypeId !== state.prototypeId || baseline.generation !== state.generation || baseline.stageReview) {
        throw new Error("The pre-request restore point belongs to another effort.");
    }
    const requests = state.changeRequests ?? [];
    const related = new Set(requests.filter(item => item.restorePoint?.requestId === rootId).map(item => item.id));
    const rootIndex = requests.findIndex(item => item.id === rootId);
    if (rootIndex < 0 || requests.slice(rootIndex).some(item => !related.has(item.id) && !item.abandonment)) {
        throw new Error("A later independent request exists. Abandon its review first; no work was changed.");
    }
    if (requests.some(item => related.has(item.id) && (item.committedAt || item.developmentAdmission))) {
        throw new Error("This review was already committed or sent to Development and cannot be abandoned.");
    }
    if (state.stageReviews?.some(review => review.appliedAt && !related.has(review.changeRequestId ?? "")
        && !requests.some(item => item.id === review.changeRequestId && item.abandonment)
        && !baseline.stageReviews?.some(previous => previous.id === review.id && previous.appliedAt === review.appliedAt))) {
        throw new Error("An independent draft was applied after this request. Restoring it would overwrite unrelated work.");
    }
    if (baseline.prototypeFlow?.pendingCheckpointId
        && baseline.prototypeFlow.pendingCheckpointId !== state.prototypeFlow?.pendingCheckpointId
        || baseline.prototypeReview.revisions?.some((previous: { id: string; status: string }) =>
            !["applied", "dismissed"].includes(previous.status) && state.prototypeReview.revisions.some(
                (item: { id: string; status: string }) => item.id === previous.id && item.status !== previous.status))) {
        throw new Error("Earlier prototype work changed after this request. Restoring it would overwrite unrelated work.");
    }
    const retainedOutputs = [...state.lifecycle.history, ...state.lifecycle.outputs]
        .filter(output => !baseline.lifecycle.outputs.some(original => original.path === output.path));
    const history = [...baseline.lifecycle.history, ...retainedOutputs]
        .filter((output, index, entries) => entries.findIndex(item => item.path === output.path) === index);
    const baselineRevisions: Array<{ id: string }> = baseline.prototypeReview.revisions ?? [];
    const revisions: Array<{ id: string }> = state.prototypeReview.revisions ?? [];
    return {
        ...state,
        stage: baseline.stage, phase: baseline.phase, lifecycle: { ...structuredClone(baseline.lifecycle), history },
        goal: baseline.goal, preparation: structuredClone(baseline.preparation),
        prototypeApproach: structuredClone(baseline.prototypeApproach),
        requirements: structuredClone(baseline.requirements), decisionGraph: structuredClone(baseline.decisionGraph),
        question: structuredClone(baseline.question), confirmed: [...baseline.confirmed],
        assumed: [...baseline.assumed], deferred: [...baseline.deferred], artifacts: structuredClone(baseline.artifacts),
        sketch: structuredClone(baseline.sketch), prototypeFlow: structuredClone(baseline.prototypeFlow),
        previewUrl: baseline.previewUrl, previewStatus: baseline.previewStatus,
        prototypeReview: { ...structuredClone(baseline.prototypeReview), revisions: [
            ...structuredClone(baselineRevisions),
            ...revisions.filter(item => !baselineRevisions.some(previous => previous.id === item.id))
                .map(item => ({ ...structuredClone(item), status: "dismissed", completedAt: abandonment.abandonedAt })),
        ] },
        processing: structuredClone(baseline.processing), suggestionProcessing: structuredClone(baseline.suggestionProcessing),
        stageReviews: state.stageReviews?.map(review => related.has(review.changeRequestId ?? "")
            && !review.appliedAt && !review.discardedAt ? { ...review, discardedAt: abandonment.abandonedAt } : review),
        changeRequests: requests.map(item => related.has(item.id)
            ? { ...item, status: "cancelled", remainingStages: [], error: "", completedAt: abandonment.abandonedAt, abandonment } : item),
        status: "Changes abandoned. The work from before the original request is restored. Review history and saved files are retained.",
        updatedAt: abandonment.abandonedAt,
    };
}

export function changeBaselineDigest(state: TandemState, development: unknown = null): string {
    return createHash("sha256").update(JSON.stringify({
        generation: state.generation, goal: state.goal, requirements: requirementsInputDigest(state),
        lifecycle: state.lifecycle, sketch: state.sketch.current, approval: state.sketch.approved,
        flow: state.prototypeFlow, revisions: state.prototypeReview.revisions,
        artifacts: state.artifacts, preparation: state.preparation, development,
    })).digest("hex");
}

export function applyRequirementsDelta(state: TandemState, delta: RequirementsDelta): {
    graph: DecisionGraph; affected: string[]; usages: string[]; assumed: string[]; deferred: string[];
} {
    validateRequirementsValue(delta, requirementsDeltaSchema, "requirements delta");
    const current = state.decisionGraph;
    const ids = new Set(current.nodes.map(node => node.id));
    if (new Set(delta.upsert.map(node => node.id)).size !== delta.upsert.length ||
        delta.remove.some(id => !ids.has(id) || delta.upsert.some(node => node.id === id))) {
        throw new Error("The change adds duplicate decisions or removes an unknown/replaced decision.");
    }
    const affected = new Set(delta.remove);
    for (const node of delta.upsert) {
        if (!/^[A-Za-z0-9._-]{1,120}$/.test(node.id) || node.question.id !== node.id ||
            node.question.recommended !== null && !curatedDefault(node.question)) {
            throw new Error(`The changed decision "${node.id}" needs a matching question and valid choices.`);
        }
        const old = current.nodes.find(previous => previous.id === node.id);
        if (!old || JSON.stringify({ id: old.id, title: old.title, dependencies: old.dependencies, question: old.question }) !== JSON.stringify(node)) {
            affected.add(node.id);
        }
    }
    for (const id of [...affected]) for (const child of decisionDescendants(current, id)) affected.add(child);
    const nodes: DecisionNode[] = current.nodes.filter(node => !delta.remove.includes(node.id)).map(node => {
        const replacement = delta.upsert.find(item => item.id === node.id);
        if (!affected.has(node.id)) return structuredClone(node);
        return {
            ...(replacement || node), answer: null, status: "toAnswer",
            review: { previousAnswer: node.answer || node.review?.previousAnswer || null,
                reason: replacement ? "This decision changed with your request. Review the updated question."
                    : "An earlier decision changed. Review this dependent decision; your previous answer is retained." },
        };
    });
    for (const node of delta.upsert) if (!ids.has(node.id)) nodes.push({ ...node, answer: null, status: "toAnswer" });
    const graph = { nodes };
    validateDecisionGraph(graph);
    if (!nodes.length || nodes.length > 200) throw new Error("Keep between 1 and 200 requirement decisions.");
    const usages = patchSemanticList(state.requirements.usageItems, delta.usages);
    if (usages.length > 30 || usages.some(usage => /[\r\n]/.test(usage)) ||
        new Set(usages.map(usage => usage.toLowerCase())).size !== usages.length) {
        throw new Error("Requirements must retain at most 30 distinct, single-line usages.");
    }
    return { graph, affected: [...affected], usages,
        assumed: patchSemanticList(state.assumed, delta.assumptions),
        deferred: patchSemanticList(state.deferred, delta.deferred) };
}

export function readChangeAssessment(value: unknown, state: TandemState, request?: Pick<ChangeRequest, "replacesRequestId">): ChangeAssessment {
    validateRequirementsValue(value, changeAssessmentSchema, "change assessment");
    const assessment = structuredClone(value as ChangeAssessment);
    const pending = request?.replacesRequestId ? pendingUpstreamReviewStage(state) : undefined;
    const requiredReviews = pending ? lifecycleStages.slice(stageIndex(pending), stageIndex(state.lifecycle.currentStage))
        .filter(stage => !state.lifecycle.completedStages.includes(stage.id)
            && !state.lifecycle.skippedStages.some(skipped => skipped.stageId === stage.id)) : [];
    const stages = assessment.stages.map(item => item.stage);
    if (new Set(stages).size !== stages.length) throw new Error("Each affected stage must appear only once.");
    if (assessment.requirements) {
        const delta = applyRequirementsDelta(state, assessment.requirements);
        if (!stages.includes("requirements")) throw new Error("A Requirements change must explicitly include Requirements.");
        if (!assessment.question && requirementsInputDigest(state) === requirementsInputDigest({
            ...state, requirements: { ...state.requirements, usageItems: delta.usages }, decisionGraph: delta.graph,
            assumed: delta.assumed, deferred: delta.deferred,
            prototypeApproach: assessment.requirements.prototypeApproach ?? state.prototypeApproach,
        })) {
            throw new Error("The Requirements patch makes no saved changes. Recheck the impact: update only the affected stage, or report that the request is already satisfied.");
        }
        // Existing approval is bound to the complete requirements digest, even when screen bytes can be reused.
        if (state.sketch.current && !stages.includes("sketch")) {
            assessment.stages.push({ stage: "sketch", reason: "Review the retained designs against the changed requirements; unchanged screens are preserved." });
        }
        if ((state.prototypeFlow?.displayedCheckpointId || state.previewUrl) && !stages.includes("prototype")) {
            assessment.stages.push({ stage: "prototype", reason: "Update the saved prototype against the revised requirements and designs." });
        }
    }
    if (assessment.stages.some(item => item.stage === "sketch") && (state.prototypeFlow?.displayedCheckpointId || state.previewUrl) &&
        !assessment.stages.some(item => item.stage === "prototype")) {
        assessment.stages.push({ stage: "prototype", reason: "Bring the retained prototype into line with the reviewed designs." });
    }
    if (assessment.stages.some(item => item.stage === "requirements") && !assessment.requirements && !assessment.question
        && !requiredReviews.some(stage => stage.id === "requirements")) {
        throw new Error("Describe the Requirements delta or ask a concrete clarification before changing Requirements.");
    }
    assessment.stages.sort((left, right) => stageIndex(left.stage) - stageIndex(right.stage));
    const earliest: ChangeAssessment["startStage"] = assessment.stages.length ? assessment.stages[0]!.stage : "none";
    if (earliest !== assessment.startStage) throw new Error("The starting stage must be the earliest affected stage.");
    if (assessment.startStage === "none" && assessment.requirements) throw new Error("An unchanged outcome cannot contain a Requirements delta.");
    if (requiredReviews.length) {
        for (const stage of requiredReviews) {
            if (!assessment.stages.some(item => item.stage === stage.id)) assessment.stages.push({
                stage: stage.id, reason: `Previously applied changes still require ${stage.label} review. Retain saved content and confirm it against the accepted inputs.`,
            });
        }
        if ((state.previewUrl || state.prototypeFlow?.displayedCheckpointId) && !assessment.stages.some(item => item.stage === "prototype")) {
            assessment.stages.push({ stage: "prototype", reason: "Review the retained prototype against the already-applied upstream changes." });
        }
        assessment.stages.sort((left, right) => stageIndex(left.stage) - stageIndex(right.stage));
        assessment.startStage = assessment.stages[0]!.stage;
    }
    return assessment;
}

export function stageIndex(stage: LifecycleStageId): number {
    return lifecycleStages.findIndex(item => item.id === stage);
}

export function activateChange(state: TandemState, request: ChangeRequest, snapshotPath: string): TandemState {
    if (!isDiscoveryChangeRequest(request)) {
        throw new Error("Development requests no longer enter upstream impact review. Continue in the Development conversation.");
    }
    const assessment = request.assessment;
    if (!assessment || assessment.question || assessment.startStage === "none" || assessment.startStage === "development") {
        throw new Error("Review or clarify this change before starting upstream work.");
    }
    const delta = assessment.requirements ? applyRequirementsDelta(state, assessment.requirements) : null;
    const stages = new Set(assessment.stages.map(item => item.stage));
    const graph = delta?.graph ?? state.decisionGraph;
    const approach = assessment.requirements?.prototypeApproach ?? state.prototypeApproach;
    const requirementsSaved = assessment.startStage === "requirements" && isCurrentStageChange(state, request);
    const next: TandemState = {
        ...state, stage: assessment.startStage, phase: assessment.startStage === "requirements" ? "discovery" : "iterating",
        lifecycle: { ...state.lifecycle, currentStage: assessment.startStage, changeRequestId: request.id,
            completedStages: state.lifecycle.completedStages.filter(stage => !stages.has(stage)),
            outputs: state.lifecycle.outputs.filter(output => !stages.has(output.stageId as LifecycleStageId)),
            history: [...state.lifecycle.history, ...state.lifecycle.outputs.filter(output => stages.has(output.stageId as LifecycleStageId))],
            skippedStages: state.lifecycle.skippedStages.filter(stage => !stages.has(stage.stageId as LifecycleStageId)) },
        requirements: { ...state.requirements, substage: "dag", usageItems: delta?.usages ?? state.requirements.usageItems },
        decisionGraph: graph, assumed: delta?.assumed ?? state.assumed, deferred: delta?.deferred ?? state.deferred,
        prototypeApproach: approach,
        artifacts: state.artifacts.map(artifact => stages.has(artifact.stage as LifecycleStageId) ? { ...artifact, reviewStatus: "stale" } : artifact),
        sketch: stages.has("sketch") ? { ...state.sketch, approved: null,
            status: !state.sketch.current ? "empty" : stages.has("requirements") ? "stale" : "draft" } : state.sketch,
        prototypeReview: { ...state.prototypeReview, designSpecArtifactId: stages.has("prototype") ? null : state.prototypeReview.designSpecArtifactId },
        processing: null, suggestionProcessing: null,
        changeRequests: (state.changeRequests ?? []).map(item => item.id === request.id ? { ...item,
            status: requirementsSaved ? "completed" : "active", remainingStages: requirementsSaved ? [] : [...stages],
            completedAt: requirementsSaved ? new Date().toISOString() : null,
            affectedDecisionIds: delta?.affected ?? [], snapshotPath, error: "" } : item),
        status: requirementsSaved ? "Requirements updated. Review the remaining decisions before continuing."
            : `Updating ${lifecycleStages.find(stage => stage.id === assessment.startStage)?.label ?? assessment.startStage} for your request. Previous work is retained.`,
    };
    if (!state.stageReview) delete next.lifecycle.reviewId;
    return next;
}

export function preserveUnchangedScreens(previous: SketchDocument, proposed: SketchDocument, request: ChangeRequest): void {
    const affected = new Set(request.assessment?.affectedScreenIds ?? []);
    for (const screen of previous.screens) {
        if (affected.has(screen.id) || screen.decisionIds.some(id => request.affectedDecisionIds.includes(id))) continue;
        if (JSON.stringify(screen) !== JSON.stringify(proposed.screens.find(item => item.id === screen.id))) {
            throw new Error(`The design update changed unrelated screen "${screen.id}". Preserve its exact content.`);
        }
    }
    for (const transition of previous.transitions) {
        if (affected.has(transition.fromScreenId) || affected.has(transition.toScreenId) ||
            previous.screens.some(screen => [transition.fromScreenId, transition.toScreenId].includes(screen.id) &&
                screen.decisionIds.some(id => request.affectedDecisionIds.includes(id)))) continue;
        if (JSON.stringify(transition) !== JSON.stringify(proposed.transitions.find(item => item.id === transition.id))) {
            throw new Error(`The design update changed unrelated navigation "${transition.id}".`);
        }
    }
}
