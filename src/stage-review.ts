import { createHash } from "node:crypto";
import { normalizeProjectId } from "./project-store.js";
import { requirementsInputDigest } from "./requirements-reconciliation.js";
import type { LifecycleStageId, TandemState } from "./types.js";
import { lifecycleStages, invalidateArtifacts } from "./workflow.js";

export type ReviewStage = Exclude<LifecycleStageId, "development">;

export interface StageReviewReference {
    version: 1;
    id: string;
    stage: ReviewStage;
    generation: string;
    createdAt: string;
    appliedAt: string | null;
    discardedAt: string | null;
    changeRequestId?: string;
}

export interface StageReviewDraft {
    version: 1;
    parentId: string;
    stage: ReviewStage;
    baselineDigest: string;
    baselineRevision: number;
    changeRequestId?: string;
}

const stages: ReviewStage[] = ["prepare", "requirements", "sketch", "prototype"];
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const date = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
const reviewId = (value: unknown): value is string => typeof value === "string" && /^review-[a-f0-9-]{36}$/.test(value);
export const isReviewStage = (value: unknown): value is ReviewStage => stages.some(stage => stage === value);

export function readStageReviews(value: unknown): StageReviewReference[] {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > 200) throw new Error("Saved stage reviews are invalid. Their records were preserved.");
    const ids = new Set<string>();
    const openStages = new Set<string>();
    for (const item of value) {
        if (!record(item) || item.version !== 1 || !reviewId(item.id) || !isReviewStage(item.stage)
            || typeof item.generation !== "string" || !item.generation || !date(item.createdAt)
            || item.appliedAt !== null && !date(item.appliedAt) || item.discardedAt !== null && !date(item.discardedAt)
            || item.changeRequestId !== undefined && (typeof item.changeRequestId !== "string" || !/^[A-Za-z0-9._-]{1,120}$/.test(item.changeRequestId))
            || item.appliedAt && item.discardedAt || ids.has(item.id)) {
            throw new Error("Saved stage review identities or outcomes are invalid. Their records were preserved.");
        }
        ids.add(item.id);
        if (!item.appliedAt && !item.discardedAt) {
            const key = JSON.stringify([item.stage, item.generation]);
            if (openStages.has(key)) throw new Error("More than one draft owns this stage review.");
            openStages.add(key);
        }
    }
    return structuredClone(value as StageReviewReference[]);
}

export function readStageReviewDraft(value: unknown, id: string): StageReviewDraft | undefined {
    if (value === undefined) return undefined;
    if (!record(value) || value.version !== 1 || !reviewId(id) || !isReviewStage(value.stage)
        || typeof value.parentId !== "string" || normalizeProjectId(value.parentId) !== value.parentId || value.parentId === id
        || typeof value.baselineDigest !== "string" || !/^[a-f0-9]{64}$/.test(value.baselineDigest)
        || value.changeRequestId !== undefined && (typeof value.changeRequestId !== "string" || !/^[A-Za-z0-9._-]{1,120}$/.test(value.changeRequestId))
        || !Number.isSafeInteger(value.baselineRevision) || Number(value.baselineRevision) < 1) {
        throw new Error("The saved review draft has an invalid baseline. Its state was preserved.");
    }
    return { version: 1, parentId: value.parentId, stage: value.stage,
        baselineDigest: value.baselineDigest, baselineRevision: Number(value.baselineRevision),
        ...(typeof value.changeRequestId === "string" ? { changeRequestId: value.changeRequestId } : {}) };
}

export function stageReviewDigest(state: TandemState, stage: ReviewStage): string {
    return digest({
        goal: state.goal,
        preparation: state.preparation,
        ...(stage !== "prepare" ? { requirements: requirementsInputDigest(state) } : {}),
        ...(["sketch", "prototype"].includes(stage) ? { sketch: state.sketch } : {}),
        ...(stage === "prototype" ? { flow: state.prototypeFlow, review: state.prototypeReview,
            previewUrl: state.previewUrl, previewStatus: state.previewStatus } : {}),
    });
}

export function stageReviewHasChanges(parent: TandemState, draft: TandemState): boolean {
    const review = draft.stageReview;
    return Boolean(review && (!parent.lifecycle.completedStages.includes(review.stage)
        || stageReviewDigest(draft, review.stage) !== review.baselineDigest));
}

export function stageReviewConflict(parent: TandemState, draft: TandemState): string {
    const review = draft.stageReview;
    if (!review || review.parentId !== parent.prototypeId) return "This draft belongs to another project.";
    const reference = parent.stageReviews?.find(item => item.id === draft.prototypeId && item.stage === review.stage);
    if (!reference) return "This draft is no longer linked to the current effort.";
    if (parent.changeRequests?.some(request => request.id === reference.changeRequestId && request.abandonment)) {
        return "This review's changes were abandoned. The pre-request work is restored; this draft is retained as history.";
    }
    if (reference.appliedAt) return "These draft changes have already been applied.";
    if (reference.discardedAt) return "This draft has been discarded.";
    if (parent.effortReset || parent.generation !== draft.generation || reference.generation !== parent.generation) {
        return "The effort changed. This saved draft cannot update the new effort.";
    }
    if (stageReviewDigest(parent, review.stage) !== review.baselineDigest) {
        return "Accepted inputs changed since this draft was opened. Keep this draft for comparison and start a fresh review before applying.";
    }
    return "";
}

export function createStageReview(parent: TandemState, reference: StageReviewReference): TandemState {
    if (parent.stageReview || !reviewId(reference.id) || reference.generation !== parent.generation
        || !isReviewStage(reference.stage) || reference.appliedAt || reference.discardedAt) {
        throw new Error("Choose an earlier stage of the current effort to review.");
    }
    const currentIndex = lifecycleStages.findIndex(stage => stage.id === parent.lifecycle.currentStage);
    const stageIndex = stages.indexOf(reference.stage);
    if (stageIndex >= currentIndex || parent.lifecycle.skippedStages.some(item => item.stageId === reference.stage)
        || !parent.lifecycle.completedStages.includes(reference.stage)
            && !parent.lifecycle.history.some(item => item.stageId === reference.stage)
            && !parent.artifacts.some(item => item.stage === reference.stage) && !parent.lifecycle.reviewId) {
        throw new Error("Only available earlier stages can have a pinned review draft.");
    }
    const draft = structuredClone(parent);
    draft.prototypeId = reference.id;
    draft.revision = 0;
    draft.stage = reference.stage;
    draft.lifecycle.currentStage = reference.stage;
    draft.lifecycle.reviewId = reference.id;
    draft.lifecycle.completedStages = draft.lifecycle.completedStages.filter(stage => stage !== reference.stage);
    delete draft.lifecycle.changeRequestId;
    draft.stageReview = { version: 1, parentId: parent.prototypeId, stage: reference.stage,
        baselineDigest: stageReviewDigest(parent, reference.stage), baselineRevision: parent.revision,
        ...(reference.changeRequestId ? { changeRequestId: reference.changeRequestId } : {}) };
    draft.stageReviews = [];
    draft.effortReset = null;
    draft.jobOwner = null;
    draft.factoryRuns = [];
    draft.openResetRequestId = null;
    draft.development = null;
    draft.changeRequests = [];
    draft.processing = null;
    draft.suggestionProcessing = null;
    if (reference.stage !== "prototype") {
        draft.prototypeFlow = null;
        draft.previewUrl = null;
        draft.previewStatus = "waiting";
    }
    draft.prototypeReview = { ...draft.prototypeReview, question: null, activeRevisionId: null,
        revisions: draft.prototypeReview.revisions.filter((item: { status: string }) => ["applied", "dismissed"].includes(item.status)) };
    draft.phase = "iterating";
    draft.status = "Pinned review draft. Accepted work is unchanged; no preview build has started.";
    draft.updatedAt = reference.createdAt;
    return draft;
}

export function mergeStageReview(parent: TandemState, draft: TandemState, appliedAt: string): TandemState {
    const conflict = stageReviewConflict(parent, draft);
    if (conflict) throw new Error(conflict);
    const stage = draft.stageReview!.stage;
    if (draft.lifecycle.currentStage !== stage) throw new Error("This draft left its pinned stage. Review its saved work before applying.");
    const index = stages.indexOf(stage);
    const preserveSkipped = JSON.stringify(parent.prototypeApproach) === JSON.stringify(draft.prototypeApproach);
    const downstream = (id: string) => stages.indexOf(id as ReviewStage) > index
        && !(preserveSkipped && parent.lifecycle.skippedStages.some(item => item.stageId === id));
    const affected = (id: string) => id === stage || downstream(id);
    const next = structuredClone(parent);
    if (stage === "prepare") {
        next.goal = draft.goal;
        next.preparation = structuredClone(draft.preparation);
        next.requirements.suggestions = [...draft.requirements.suggestions];
    } else if (stage === "requirements") {
        next.requirements = structuredClone(draft.requirements);
        next.decisionGraph = structuredClone(draft.decisionGraph);
        next.confirmed = [...draft.confirmed];
        next.assumed = [...draft.assumed];
        next.deferred = [...draft.deferred];
        next.prototypeApproach = { ...draft.prototypeApproach };
    } else if (stage === "sketch") {
        next.sketch = structuredClone(draft.sketch);
    } else {
        next.prototypeFlow = structuredClone(draft.prototypeFlow);
        next.prototypeReview = structuredClone(draft.prototypeReview);
        next.previewUrl = draft.previewUrl;
        next.previewStatus = draft.previewStatus;
    }
    next.artifacts = [
        ...invalidateArtifacts(parent.artifacts.filter(item => item.stage !== stage), stage),
        ...structuredClone(draft.artifacts.filter(item => item.stage === stage)),
    ];
    if (downstream("sketch")) {
        next.sketch = { ...next.sketch, approved: null, status: next.sketch.current ? "stale" : "empty" };
    }
    if (downstream("prototype")) next.prototypeReview = { ...next.prototypeReview, designSpecArtifactId: null };
    next.lifecycle = {
        ...parent.lifecycle,
        reviewId: draft.prototypeId,
        completedStages: parent.lifecycle.completedStages.filter(item => !affected(item)),
        history: [...parent.lifecycle.history, ...parent.lifecycle.outputs.filter(item => affected(item.stageId))],
        outputs: parent.lifecycle.outputs.filter(item => !affected(item.stageId)),
        skippedStages: parent.lifecycle.skippedStages.filter(item => !affected(item.stageId)),
    };
    next.stageReviews = parent.stageReviews?.map(item => item.id === draft.prototypeId ? { ...item, appliedAt } : item);
    next.changeRequests = parent.changeRequests?.map(request => {
        if (request.id !== draft.stageReview?.changeRequestId || request.status !== "reviewing") return request;
        const draftRequest = draft.changeRequests?.find(item => item.id === request.id);
        const remainingStages = request.remainingStages.filter(item => item !== stage);
        return { ...request, remainingStages, status: remainingStages.length ? "reviewing" : "completed",
            affectedDecisionIds: [...new Set([...request.affectedDecisionIds, ...draftRequest?.affectedDecisionIds ?? []])],
            workStarted: [...new Set([...request.workStarted, ...draftRequest?.workStarted ?? []])],
            completedAt: remainingStages.length ? null : appliedAt };
    });
    next.updatedAt = appliedAt;
    return next;
}
