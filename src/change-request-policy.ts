import type { ChangeRequest } from "./change-requests.js";
import type { LifecycleStageId, TandemState } from "./types.js";
import { lifecycleStages } from "./workflow.js";

export function pendingUpstreamReviewStage(state: TandemState, stage = state.lifecycle.currentStage): LifecycleStageId | undefined {
    if (!state.lifecycle.reviewId || state.stageReview) return undefined;
    const index = lifecycleStages.findIndex(item => item.id === stage);
    return lifecycleStages.slice(0, index).find(item => !state.lifecycle.completedStages.includes(item.id)
        && !state.lifecycle.skippedStages.some(skipped => skipped.stageId === item.id))?.id;
}

export function isDiscoveryChangeRequest(request: Pick<ChangeRequest, "originStage">): boolean {
    // Retain old Development escalations as history, not scheduling or review authority.
    return request.originStage !== "development";
}

export function currentChangeReview(state: Pick<TandemState, "changeRequests" | "stageReview">): ChangeRequest | undefined {
    const requests = state.changeRequests?.filter(request => isDiscoveryChangeRequest(request)
        && !["completed", "cancelled", "deferred"].includes(request.status)
        && !(state.stageReview?.changeRequestId === request.id && request.status === "active")) ?? [];
    return requests.find(request => request.status === "active")
        ?? requests.find(request => request.status === "reviewing")
        ?? requests.find(request => request.status === "analyzing")
        ?? requests[0];
}

export function changeReviewWaitsForPrototype(state: TandemState): boolean {
    return currentChangeReview(state)?.status === "queued" && state.lifecycle.currentStage === "prototype"
        && Boolean(state.prototypeFlow?.activeCheckpointId || state.prototypeFlow?.pendingCheckpointId || state.prototypeReview.question
            || state.prototypeReview.revisions?.some((revision: { status: string }) =>
                ["queued", "processing", "clarifying", "ready", "failed"].includes(revision.status)));
}

export function changeReviewBlocksEditing(state: TandemState): boolean {
    const review = currentChangeReview(state);
    return Boolean(review && review.status !== "active"
        && !changeReviewWaitsForPrototype(state)
        && !(review.status === "reviewing" && review.remainingStages[0] === state.lifecycle.currentStage));
}

export function changeReviewNeedsAttention(state: TandemState): boolean {
    const review = currentChangeReview(state);
    if (!review) return false;
    if (review.status === "proposed") return Boolean(review.error) || !isLocalChange(state, review);
    if (["reviewing", "failed"].includes(review.status)) return true;
    return review.status === "active" && (Boolean(review.error)
        || state.processing?.status === "error" || Boolean(state.prototypeFlow?.pendingCheckpointId || state.prototypeReview.question));
}

export function isCurrentStageChange(state: TandemState, request: ChangeRequest): boolean {
    const assessment = request.assessment;
    return Boolean(isDiscoveryChangeRequest(request) && assessment && !assessment.question && assessment.stages.length === 1
        && assessment.startStage === request.originStage && assessment.stages[0]!.stage === request.originStage
        && request.originStage === state.lifecycle.currentStage
        && !state.lifecycle.completedStages.includes(request.originStage));
}

export function isLocalChange(state: TandemState, request: ChangeRequest): boolean {
    if (!isCurrentStageChange(state, request)) return false;
    const delta = request.assessment!.requirements;
    if (["sketch", "prototype"].includes(request.originStage)) return !delta;
    return Boolean(request.originStage === "requirements" && delta && !delta.prototypeApproach
        && !delta.usages.remove.length && !delta.remove.length
        && !delta.assumptions.add.length && !delta.assumptions.remove.length
        && !delta.deferred.add.length && !delta.deferred.remove.length
        && delta.upsert.every(node => !state.decisionGraph.nodes.some(current => current.id === node.id)));
}
