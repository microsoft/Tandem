import type { ChangeRequest } from "./change-requests.js";
import type { TandemState } from "./types.js";

export function currentChangeReview(state: Pick<TandemState, "changeRequests" | "stageReview">): ChangeRequest | undefined {
    const requests = state.changeRequests?.filter(request => !["completed", "cancelled", "deferred"].includes(request.status)
        && !(state.stageReview?.changeRequestId === request.id && request.status === "active")) ?? [];
    return requests.find(request => request.status === "active")
        ?? requests.find(request => request.status === "reviewing")
        ?? requests.find(request => request.status === "analyzing")
        ?? requests[0];
}

export function changeReviewBlocksEditing(state: TandemState): boolean {
    const review = currentChangeReview(state);
    return Boolean(review && review.status !== "active"
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
    return Boolean(assessment && !assessment.question && assessment.stages.length === 1
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
