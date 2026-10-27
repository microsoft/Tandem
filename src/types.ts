import type { DecisionGraph, DecisionQuestion, JobOwner } from "./workflow.js";
import type { ProcessState } from "./process-state.js";
import type { PrototypeFlow } from "./prototype-flow.js";
import type { SketchState } from "./sketch.js";
import type { ArtifactAsset } from "./artifact-assets.js";

export type LifecycleStageId =
    | "prepare"
    | "requirements"
    | "sketch"
    | "prototype"
    | "development";

export type HistoricalStageId = LifecycleStageId | "design" | "plan" | "implement" | "test";

export type TandemPhase = "discovery" | "building" | "iterating" | "complete";

export type PrototypeApproachMode =
    | "undecided"
    | "build"
    | "validate-existing"
    | "not-applicable";

export interface PrototypeApproach {
    mode: PrototypeApproachMode;
    reason: string;
}

export interface PreparationCheck {
    label: string;
    status: "ready" | "missing" | "deferred";
    detail: string;
}

export interface PreparationSource {
    title: string;
    url: string;
    purpose: string;
}

export interface PreparationState {
    status:
        | "not-started"
        | "starting"
        | "running"
        | "ready"
        | "needs-attention"
        | "failed";
    summary: string;
    workItems: Array<{
        id: string;
        title: string;
        status: "pending" | "running" | "completed" | "failed";
        detail: string;
        result: string;
    }>;
    messages: Array<{
        id: string;
        text: string;
        kind: "info" | "success" | "warning" | "error";
        at: string;
    }>;
    checks: PreparationCheck[];
    sources: PreparationSource[];
    suggestedUsages: string[];
    processing: {
        requestId: string | null;
        generation: string | null;
        runId: string | null;
        requestedAt: string;
        completedAt: string | null;
    } | null;
    error: string;
}

export interface LifecycleOutput {
    stageId: HistoricalStageId;
    path: string;
    completedAt: string;
}

export interface SkippedLifecycleStage {
    stageId: HistoricalStageId;
    reason: string;
    skippedAt: string;
}

export interface LifecycleState {
    version?: 3;
    changeRequestId?: string;
    reviewId?: string;
    currentStage: LifecycleStageId;
    completedStages: LifecycleStageId[];
    outputs: LifecycleOutput[];
    skippedStages: SkippedLifecycleStage[];
    history: LifecycleOutput[];
    migration?: { version: 1; original: Record<string, unknown> };
}

export interface TandemArtifact {
    id: string;
    title: string;
    kind: string;
    stage: HistoricalStageId;
    path: string;
    language: string;
    content: string;
    mermaid: string;
    sourceThreadIds?: string[];
    reviewStatus?: "current" | "stale";
    sourceRevision?: number;
    assets?: ArtifactAsset[];
}

export interface TandemState {
    version: 1;
    revision: number;
    generation: string;
    effortReset?: { requestId: string; generation: string; error: string } | null;
    factoryRuns?: Array<{
        requestId: string; generation: string; runId: string | null; terminal?: boolean;
        launchRejection?: { message: string; recordedAt: string };
        recovery?: import("./effort-recovery.js").FactoryAbandonment;
    }>;
    jobOwner: JobOwner | null;
    openResetRequestId: string | null;
    prototypeId: string;
    stage: LifecycleStageId;
    lifecycle: LifecycleState;
    goal: string;
    phase: TandemPhase;
    status: string;
    preparation: PreparationState;
    prototypeApproach: PrototypeApproach;
    requirements: {
        substage: "usage" | "dag";
        usageItems: string[];
        suggestions: string[];
        research?: import("./requirements-research.js").RequirementsResearch | null;
    };
    question: DecisionQuestion | null;
    decisionGraph: DecisionGraph;
    confirmed: string[];
    assumed: string[];
    deferred: string[];
    artifacts: TandemArtifact[];
    sketch: SketchState;
    process: ProcessState;
    previewUrl: string | null;
    previewStatus: "waiting" | "starting" | "ready" | "error";
    prototypeFlow: PrototypeFlow | null;
    prototypeReview: Record<string, any>;
    designReview: Record<string, any>;
    design: { substage: "product" | "test" };
    testDesignReview: Record<string, any>;
    planning: Record<string, any>;
    implementation: Record<string, any>;
    testing: Record<string, any>;
    processing: any;
    suggestionProcessing: any;
    reloadReceipt: any;
    development?: { handoffId: string; requestId: string; snapshotPath: string } | null;
    developmentIntent?: {
        generation: string; requestId: string; snapshotPath: string | null;
        status: "preparing" | "starting" | "failed" | "admitted"; error: string;
    } | null;
    changeRequests?: import("./change-requests.js").ChangeRequest[];
    stageReviews?: import("./stage-review.js").StageReviewReference[];
    stageReview?: import("./stage-review.js").StageReviewDraft;
    updatedAt: string;
}
