import type { DecisionGraph, DecisionQuestion, JobOwner } from "./workflow.js";
import type { ProcessState } from "./process-state.js";

export type LifecycleStageId =
    | "prepare"
    | "requirements"
    | "prototype"
    | "design"
    | "plan"
    | "implement"
    | "test";

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
    stageId: LifecycleStageId;
    path: string;
    completedAt: string;
}

export interface SkippedLifecycleStage {
    stageId: LifecycleStageId;
    reason: string;
    skippedAt: string;
}

export interface LifecycleState {
    currentStage: LifecycleStageId;
    completedStages: LifecycleStageId[];
    outputs: LifecycleOutput[];
    skippedStages: SkippedLifecycleStage[];
    history: LifecycleOutput[];
}

export interface TandemArtifact {
    id: string;
    title: string;
    kind: string;
    stage: LifecycleStageId;
    path: string;
    language: string;
    content: string;
    mermaid: string;
    sourceThreadIds?: string[];
    reviewStatus?: "current" | "stale";
    sourceRevision?: number;
}

export interface TandemState {
    version: 1;
    revision: number;
    generation: string;
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
    };
    question: DecisionQuestion | null;
    decisionGraph: DecisionGraph;
    confirmed: string[];
    assumed: string[];
    deferred: string[];
    artifacts: TandemArtifact[];
    process: ProcessState;
    previewUrl: string | null;
    previewStatus: "waiting" | "starting" | "ready" | "error";
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
    updatedAt: string;
}
