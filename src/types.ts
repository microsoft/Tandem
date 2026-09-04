export type LifecycleStageId =
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
    status: "not-started" | "ready" | "needs-attention";
    summary: string;
    checks: PreparationCheck[];
    sources: PreparationSource[];
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
}

export interface TandemState {
    version: 1;
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
    question: any;
    decisionGraph: { nodes: any[] };
    confirmed: string[];
    assumed: string[];
    deferred: string[];
    artifacts: TandemArtifact[];
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
