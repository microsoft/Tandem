import { ProjectStoreError } from "./project-store.js";

export type PrototypeMilestone = "structure" | "interaction" | "visual";
export interface PrototypeCheckpoint {
    id: string;
    requestId: string;
    generation: string;
    milestone: PrototypeMilestone;
    revisionId: string | null;
    baseCheckpointId: string | null;
    sourceCheckpointId: string | null;
    workspacePath: string;
    workspacePrepared: boolean;
    status: "running" | "ready" | "failed" | "clarifying";
    previewUrl: string | null;
    summary: string;
    focus: string;
    requestedAt: string;
    completedAt: string | null;
    timeoutSeconds: number;
    sourceFingerprint?: string | null;
    sketchRevisionId?: string | null;
    sketchInputHash?: string | null;
    sketchImagesRead?: string[];
}

export interface PrototypeFlow {
    version: 1;
    checkpoints: PrototypeCheckpoint[];
    displayedCheckpointId: string | null;
    pendingCheckpointId: string | null;
    activeCheckpointId: string | null;
    visualRequested: boolean;
    budget: { limitSeconds: number; usedSeconds: number };
}

export const PROTOTYPE_WORK_WINDOW_SECONDS = 900;
export const prototypeMilestoneLabels: Record<PrototypeMilestone, string> = {
    structure: "Structure",
    interaction: "Interaction",
    visual: "Visual direction",
};

export function newPrototypeFlow(): PrototypeFlow {
    return {
        version: 1, checkpoints: [], displayedCheckpointId: null,
        pendingCheckpointId: null, activeCheckpointId: null, visualRequested: false,
        budget: { limitSeconds: PROTOTYPE_WORK_WINDOW_SECONDS, usedSeconds: 0 },
    };
}

const record = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value);
const nullableString = (value: unknown): value is string | null =>
    value === null || typeof value === "string";

export function readPrototypeFlow(value: unknown): PrototypeFlow | null {
    if (value == null) return null;
    const invalid = () => new ProjectStoreError("prototype_flow_invalid",
        "The saved prototype checkpoints are invalid. Restore the original state before continuing.", 422);
    if (!record(value) || value.version !== 1 || !Array.isArray(value.checkpoints) ||
        !nullableString(value.displayedCheckpointId) || !nullableString(value.pendingCheckpointId) ||
        !nullableString(value.activeCheckpointId) || typeof value.visualRequested !== "boolean" ||
        !record(value.budget) || typeof value.budget.limitSeconds !== "number" ||
        typeof value.budget.usedSeconds !== "number" ||
        !Number.isFinite(value.budget.limitSeconds) || !Number.isFinite(value.budget.usedSeconds) ||
        value.budget.usedSeconds < 0 || value.budget.limitSeconds < value.budget.usedSeconds) throw invalid();
    const checkpoints = value.checkpoints.map((entry): PrototypeCheckpoint => {
        if (!record(entry) || typeof entry.id !== "string" || !entry.id ||
            typeof entry.requestId !== "string" || typeof entry.generation !== "string" ||
            (entry.milestone !== "structure" && entry.milestone !== "interaction" && entry.milestone !== "visual") ||
            (entry.status !== "running" && entry.status !== "ready" && entry.status !== "failed" && entry.status !== "clarifying") ||
            !nullableString(entry.revisionId) || !nullableString(entry.baseCheckpointId) ||
            !nullableString(entry.sourceCheckpointId) || typeof entry.workspacePath !== "string" ||
            typeof entry.workspacePrepared !== "boolean" || !nullableString(entry.previewUrl) ||
            typeof entry.summary !== "string" || typeof entry.focus !== "string" ||
            typeof entry.requestedAt !== "string" || !nullableString(entry.completedAt) ||
            typeof entry.timeoutSeconds !== "number" || !Number.isFinite(entry.timeoutSeconds) ||
            (entry.sourceFingerprint !== undefined && !nullableString(entry.sourceFingerprint)) ||
            (entry.sketchRevisionId !== undefined && !nullableString(entry.sketchRevisionId)) ||
            (entry.sketchInputHash !== undefined && !nullableString(entry.sketchInputHash)) ||
            Boolean(entry.sketchRevisionId) !== Boolean(entry.sketchInputHash) ||
            (typeof entry.sketchRevisionId === "string" && (!entry.sketchRevisionId || entry.sketchRevisionId.length > 80)) ||
            (typeof entry.sketchInputHash === "string" && !/^[a-f0-9]{64}$/.test(entry.sketchInputHash)) ||
            (entry.sketchImagesRead !== undefined && (!Array.isArray(entry.sketchImagesRead) ||
                entry.sketchImagesRead.length > 8 || entry.sketchImagesRead.some((id) => typeof id !== "string") ||
                new Set(entry.sketchImagesRead).size !== entry.sketchImagesRead.length)) ||
            (!entry.sketchRevisionId && Array.isArray(entry.sketchImagesRead) && entry.sketchImagesRead.length > 0) ||
            entry.timeoutSeconds < 0 || entry.timeoutSeconds > 300) throw invalid();
        return {
            id: entry.id, requestId: entry.requestId, generation: entry.generation,
            milestone: entry.milestone,
            status: entry.status,
            revisionId: entry.revisionId, baseCheckpointId: entry.baseCheckpointId,
            sourceCheckpointId: entry.sourceCheckpointId, workspacePath: entry.workspacePath,
            workspacePrepared: entry.workspacePrepared, previewUrl: entry.previewUrl,
            summary: entry.summary, focus: entry.focus, requestedAt: entry.requestedAt,
            completedAt: entry.completedAt, timeoutSeconds: entry.timeoutSeconds,
            ...(entry.sourceFingerprint !== undefined ? {
                sourceFingerprint: typeof entry.sourceFingerprint === "string" ? entry.sourceFingerprint : null,
            } : {}),
            ...(entry.sketchRevisionId !== undefined ? {
                sketchRevisionId: typeof entry.sketchRevisionId === "string" ? entry.sketchRevisionId : null,
            } : {}),
            ...(entry.sketchInputHash !== undefined ? {
                sketchInputHash: typeof entry.sketchInputHash === "string" ? entry.sketchInputHash : null,
            } : {}),
            ...(Array.isArray(entry.sketchImagesRead) ? { sketchImagesRead: entry.sketchImagesRead.map((id: string) => id) } : {}),
        };
    });
    if (new Set(checkpoints.map((item) => item.id)).size !== checkpoints.length) throw invalid();
    const ids = [value.displayedCheckpointId, value.pendingCheckpointId, value.activeCheckpointId,
        ...checkpoints.flatMap((item) => [item.baseCheckpointId, item.sourceCheckpointId])];
    if (ids.some((id) => id !== null && !checkpoints.some((item) => item.id === id))) throw invalid();
    for (const id of [value.displayedCheckpointId, value.pendingCheckpointId]) {
        if (id && !checkpoints.some((item) => item.id === id && item.status === "ready" && item.previewUrl)) throw invalid();
    }
    if (checkpoints.filter((item) => item.status === "running").length !== (value.activeCheckpointId ? 1 : 0) ||
        (value.activeCheckpointId && !checkpoints.some((item) => item.id === value.activeCheckpointId && item.status === "running"))) throw invalid();
    return {
        version: 1, checkpoints, displayedCheckpointId: value.displayedCheckpointId,
        pendingCheckpointId: value.pendingCheckpointId, activeCheckpointId: value.activeCheckpointId,
        visualRequested: value.visualRequested,
        budget: { limitSeconds: value.budget.limitSeconds, usedSeconds: value.budget.usedSeconds },
    };
}

export function prototypeCheckpoint(flow: PrototypeFlow, id: string | null): PrototypeCheckpoint | null {
    return flow.checkpoints.find((item) => item.id === id) || null;
}

export function prototypeRetrySource(flow: PrototypeFlow, failed: PrototypeCheckpoint): PrototypeCheckpoint | null {
    const visited = new Set<string>();
    let source: PrototypeCheckpoint | null = failed;
    while (source) {
        if (visited.has(source.id)) throw new Error("The prototype retry source chain contains a cycle.");
        visited.add(source.id);
        if (source.status === "running") throw new Error("An active checkpoint cannot be used as a retry source.");
        if (source.workspacePrepared) return source;
        if (!source.sourceCheckpointId) return null;
        const previous = prototypeCheckpoint(flow, source.sourceCheckpointId);
        if (!previous) throw new Error("The prototype retry source is missing. Restore its checkpoint record before retrying.");
        source = previous;
    }
    return null;
}

export function nextPrototypeMilestone(flow: PrototypeFlow): PrototypeMilestone | null {
    for (const milestone of ["structure", "interaction", "visual"] as const) {
        if (milestone === "visual" && !flow.visualRequested) return null;
        if (!flow.checkpoints.some((item) => item.milestone === milestone && item.status === "ready")) return milestone;
    }
    return null;
}

export function reservePrototypeCheckpoint(flow: PrototypeFlow, checkpoint: Omit<PrototypeCheckpoint, "timeoutSeconds">): PrototypeFlow {
    if (flow.activeCheckpointId || flow.pendingCheckpointId) throw new Error("Apply the prepared update or finish active work before building another checkpoint.");
    const timeoutSeconds = Math.min(300, Math.floor(flow.budget.limitSeconds - flow.budget.usedSeconds));
    if (timeoutSeconds < 1) throw new Error("The prototype work budget is exhausted. Explicitly extend the work window to continue.");
    return {
        ...flow, activeCheckpointId: checkpoint.id,
        checkpoints: [...flow.checkpoints, { ...checkpoint, timeoutSeconds }],
        budget: { ...flow.budget, usedSeconds: flow.budget.usedSeconds + timeoutSeconds },
    };
}

export function settlePrototypeCheckpoint(flow: PrototypeFlow, id: string,
    update: Pick<PrototypeCheckpoint, "status" | "previewUrl" | "summary" | "focus">, completedAt: string): PrototypeFlow {
    const checkpoint = prototypeCheckpoint(flow, id);
    if (!checkpoint || flow.activeCheckpointId !== id || checkpoint.status !== "running") {
        throw new Error("This result no longer owns the active prototype checkpoint.");
    }
    const elapsed = Math.max(1, Math.ceil((Date.parse(completedAt) - Date.parse(checkpoint.requestedAt)) / 1000));
    if (!Number.isFinite(elapsed) || update.status === "running") throw new Error("Invalid prototype checkpoint completion.");
    const ready = update.status === "ready";
    if (ready && !update.previewUrl) throw new Error("A ready checkpoint must have a verified preview URL.");
    return {
        ...flow, activeCheckpointId: null,
        checkpoints: flow.checkpoints.map((item) => item.id === id ? { ...item, ...update, completedAt } : item),
        displayedCheckpointId: ready && !flow.displayedCheckpointId ? id : flow.displayedCheckpointId,
        pendingCheckpointId: ready && flow.displayedCheckpointId ? id : flow.pendingCheckpointId,
        budget: {
            ...flow.budget,
            usedSeconds: flow.budget.usedSeconds - checkpoint.timeoutSeconds + Math.min(checkpoint.timeoutSeconds, elapsed),
        },
    };
}

export function promotePrototypeCheckpoint(flow: PrototypeFlow, id: string): PrototypeFlow {
    if (flow.pendingCheckpointId !== id || prototypeCheckpoint(flow, id)?.status !== "ready") {
        throw new Error("This update is no longer pending. Review the current prototype update.");
    }
    return { ...flow, displayedCheckpointId: id, pendingCheckpointId: null };
}

export function prototypeFlowCompletionError(flow: PrototypeFlow | null): string | null {
    if (!flow) return null;
    if (flow.activeCheckpointId) return "Wait for the active prototype checkpoint to finish.";
    if (flow.pendingCheckpointId) return "Apply the prepared prototype update before finishing.";
    const milestone = nextPrototypeMilestone(flow);
    if (milestone) return `Finish ${prototypeMilestoneLabels[milestone]} before finishing Prototype.`;
    return null;
}
