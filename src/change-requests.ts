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
import { currentChangeReview, isCurrentStageChange, isDiscoveryChangeRequest, isLocalChange } from "./change-request-policy.js";
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
    error: string;
    clarifications: Array<{ question: string; answer: string }>;
    remainingStages: LifecycleStageId[];
    workStarted: LifecycleStageId[];
    affectedDecisionIds: string[];
    snapshotPath: string | null;
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
    error: text(2000, 0), clarifications: array(object({ question: text(2000), answer: text() }), 20),
    remainingStages: array(stageSchema, 5), workStarted: array(stageSchema, 5), affectedDecisionIds: strings(200, 120),
    snapshotPath: nullable(text(2000)), completedAt: nullable(text(100)),
    developmentAdmission: nullable({ type: "string", enum: ["sending", "admitted", "uncertain"] }),
    developmentRequest: nullable(object({ id: text(120), message: text(4 * 1024 * 1024), receivedAt: text(100) })),
});
export function readChangeRequests(value: unknown): ChangeRequest[] {
    if (value === undefined) return [];
    if (Array.isArray(value)) value = value.map(item => item && typeof item === "object" && !Array.isArray(item)
        ? { reviewId: null, sketchContext: null, ...item } : item);
    validateRequirementsValue(value, array(changeRequestSchema, 200), "change requests");
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
        if (request.visualSelection) readVisualSelection(request.visualSelection);
        if (Boolean(request.developmentAdmission) !== Boolean(request.developmentRequest) ||
            request.developmentRequest && request.developmentRequest.id !== `change-${request.id}`) {
            throw new Error("The saved Development change admission has no matching immutable request.");
        }
    }
    return structuredClone(requests);
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

export function prototypeNeedsChangeUpdate(state: TandemState): boolean {
    const displayed = state.prototypeFlow?.checkpoints.find(item => item.id === state.prototypeFlow?.displayedCheckpointId);
    if (!displayed) return false;
    return Boolean((state.lifecycle.reviewId || state.changeRequests?.some(request => request.snapshotPath && request.assessment?.requirements
        && !request.reviewId && ["active", "completed", "cancelled"].includes(request.status))
        || state.stageReviews?.some(review => review.appliedAt && ["prepare", "requirements"].includes(review.stage))) &&
        displayed.requirementsDigest !== requirementsInputDigest(state) ||
        (state.lifecycle.changeRequestId || state.lifecycle.reviewId) && state.sketch.current && displayed.sketchRevisionId !== state.sketch.current.id);
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

export function readChangeAssessment(value: unknown, state: TandemState): ChangeAssessment {
    validateRequirementsValue(value, changeAssessmentSchema, "change assessment");
    const assessment = structuredClone(value as ChangeAssessment);
    const stages = assessment.stages.map(item => item.stage);
    if (new Set(stages).size !== stages.length) throw new Error("Each affected stage must appear only once.");
    if (assessment.requirements) {
        applyRequirementsDelta(state, assessment.requirements);
        if (!stages.includes("requirements")) throw new Error("A Requirements change must explicitly include Requirements.");
        // Existing approval is bound to the complete requirements digest, even when screen bytes can be reused.
        if (state.sketch.current && !stages.includes("sketch")) {
            assessment.stages.push({ stage: "sketch", reason: "Review the retained designs against the changed requirements; unchanged screens are preserved." });
        }
        if (state.prototypeFlow?.displayedCheckpointId && !stages.includes("prototype")) {
            assessment.stages.push({ stage: "prototype", reason: "Update the saved prototype against the revised requirements and designs." });
        }
    }
    if (assessment.stages.some(item => item.stage === "sketch") && state.prototypeFlow?.displayedCheckpointId &&
        !assessment.stages.some(item => item.stage === "prototype")) {
        assessment.stages.push({ stage: "prototype", reason: "Bring the retained prototype into line with the reviewed designs." });
    }
    if (assessment.stages.some(item => item.stage === "requirements") && !assessment.requirements && !assessment.question) {
        throw new Error("Describe the Requirements delta or ask a concrete clarification before changing Requirements.");
    }
    assessment.stages.sort((left, right) => stageIndex(left.stage) - stageIndex(right.stage));
    const earliest: ChangeAssessment["startStage"] = assessment.stages.length ? assessment.stages[0]!.stage : "none";
    if (earliest !== assessment.startStage) throw new Error("The starting stage must be the earliest affected stage.");
    if (assessment.startStage === "none" && assessment.requirements) throw new Error("An unchanged outcome cannot contain a Requirements delta.");
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
