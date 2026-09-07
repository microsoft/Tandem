import type { LifecycleStageId, LifecycleState, TandemArtifact } from "./types.js";

export const lifecycleStages: { id: LifecycleStageId; label: string }[] = [
    { id: "prepare", label: "Preparation" },
    { id: "requirements", label: "Requirements" },
    { id: "prototype", label: "Prototype" },
    { id: "design", label: "Design" },
    { id: "plan", label: "Plan" },
    { id: "implement", label: "Implement" },
    { id: "test", label: "Test" },
];

export interface JobOwner {
    sessionId: string;
    workspaceRoot: string;
}

export interface ActivityState {
    preparation?: { status?: string };
    processing?: { status?: string } | null;
    suggestionProcessing?: { status?: string } | null;
    designReview?: ReviewActivity;
    testDesignReview?: ReviewActivity;
    planning?: { processing?: unknown };
    implementation?: ExecutionActivity;
    testing?: ExecutionActivity;
}

export interface ExecutionActivity {
    status?: string;
    runId?: string | null;
    terminalConfirmedAt?: string | null;
    cancellation?: { confirmedAt?: string | null } | null;
}

export function hasUnconfirmedExecution(value?: ExecutionActivity): boolean {
    return Boolean(value?.cancellation && !value.cancellation.confirmedAt) ||
        Boolean(value && !value.terminalConfirmedAt &&
            (value.status === "cancelled" || (value.status === "failed" && value.runId)));
}

interface ReviewActivity {
    processing?: unknown;
    finalizeRequested?: boolean;
    threads?: { status?: string }[];
}

export function hasActiveWork(state: ActivityState): boolean {
    const reviewActive = (review?: ReviewActivity) => Boolean(review?.processing || review?.finalizeRequested ||
        review?.threads?.some((thread) => thread.status === "queued" || thread.status === "processing"));
    return ["starting", "running"].includes(state.preparation?.status || "") ||
        state.processing?.status === "running" || state.suggestionProcessing?.status === "running" ||
        reviewActive(state.designReview) || reviewActive(state.testDesignReview) || Boolean(state.planning?.processing) ||
        hasUnconfirmedExecution(state.implementation) || hasUnconfirmedExecution(state.testing) ||
        ["starting", "running"].includes(state.implementation?.status || "") ||
        ["starting", "running"].includes(state.testing?.status || "");
}

export function reopenTestLifecycle(lifecycle: LifecycleState): LifecycleState {
    return {
        ...lifecycle, currentStage: "test",
        completedStages: lifecycle.completedStages.filter((stage) => stage !== "test"),
        outputs: lifecycle.outputs.filter((output) => output.stageId !== "test"),
        history: [...lifecycle.history, ...lifecycle.outputs.filter((output) => output.stageId === "test")],
    };
}

export function sameOwner(left: JobOwner | null, right: JobOwner): boolean {
    const canonical = (path: string) => {
        const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
        return /^[a-z]:\//i.test(normalized) || normalized.startsWith("//") ? normalized.toLowerCase() : normalized;
    };
    return left?.sessionId === right.sessionId && canonical(left.workspaceRoot) === canonical(right.workspaceRoot);
}

export function invalidateArtifacts(artifacts: TandemArtifact[], stageId: LifecycleStageId): TandemArtifact[] {
    const index = lifecycleStages.findIndex((stage) => stage.id === stageId);
    return artifacts.map((artifact) =>
        lifecycleStages.findIndex((stage) => stage.id === artifact.stage) >= index
            ? { ...artifact, reviewStatus: "stale" }
            : artifact);
}

export interface DecisionQuestion {
    id: string;
    text: string;
    rationale: string;
    choices: string[];
    recommended: string | null;
    allowFreeText: boolean;
    answerPlaceholder: string;
}

export interface DecisionNode {
    id: string;
    title: string;
    dependencies: string[];
    question: DecisionQuestion | null;
    answer: string | null;
    status: "answered" | "active" | "toAnswer";
}

export interface DecisionGraph { nodes: DecisionNode[] }

export function normalizeDecisionId(value: unknown): string {
    return String(value || "").trim().replace(/[^A-Za-z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "").slice(0, 120);
}

export function validateDecisionGraph(graph: DecisionGraph): void {
    const ids = new Set(graph.nodes.map((node) => node.id));
    if (ids.size !== graph.nodes.length) throw new Error("Decision IDs must be unique.");
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const byId = new Map(graph.nodes.map((node) => [node.id, node]));
    const visit = (id: string) => {
        if (visiting.has(id)) throw new Error("The requirements graph contains a dependency cycle.");
        if (visited.has(id)) return;
        const node = byId.get(id);
        if (!node) throw new Error(`Unknown decision dependency "${id}".`);
        visiting.add(id);
        for (const dependency of node.dependencies) visit(dependency);
        visiting.delete(id);
        visited.add(id);
    };
    for (const id of ids) visit(id);
}

export function decisionDescendants(graph: DecisionGraph, id: string): Set<string> {
    const descendants = new Set<string>();
    let changed = true;
    while (changed) {
        changed = false;
        for (const node of graph.nodes) {
            if (node.id !== id && !descendants.has(node.id) &&
                node.dependencies.some((dependency) => dependency === id || descendants.has(dependency))) {
                descendants.add(node.id);
                changed = true;
            }
        }
    }
    return descendants;
}

export function applyAuthoritativeAnswer(
    current: DecisionGraph,
    proposed: DecisionGraph,
    questionId: string,
    answer: string,
    changingAnswer: boolean,
): DecisionGraph {
    validateDecisionGraph(proposed);
    if (!current.nodes.some((node) => node.id === questionId) ||
        !proposed.nodes.some((node) => node.id === questionId)) {
        throw new Error("The worker omitted the decision being answered.");
    }
    const descendants = decisionDescendants(current, questionId);
    const oldNodes = new Map(current.nodes.map((node) => [node.id, node]));
    for (const old of current.nodes) {
        if (!proposed.nodes.some((node) => node.id === old.id)) {
            throw new Error(`The worker removed existing decision "${old.id}". Reopen the requirements explicitly to revise scope.`);
        }
    }
    const nodes = proposed.nodes.map((node): DecisionNode => {
        const old = oldNodes.get(node.id);
        if (node.id === questionId) return { ...old!, answer };
        if ((!old || descendants.has(node.id)) && !node.question) {
            throw new Error(`The worker omitted the question for decision "${node.id}".`);
        }
        if (changingAnswer && descendants.has(node.id)) return { ...node, answer: null };
        if ((node.answer || null) !== (old?.answer || null)) {
            throw new Error(`The worker changed an answer the user did not submit: "${node.id}".`);
        }
        if (old?.answer && JSON.stringify(node.dependencies) !== JSON.stringify(old.dependencies)) {
            throw new Error(`The worker changed prerequisites for confirmed decision "${node.id}".`);
        }
        return old && !descendants.has(node.id) ? { ...old } : { ...node, answer: old?.answer || null };
    });
    validateDecisionGraph({ nodes });
    return { nodes };
}
