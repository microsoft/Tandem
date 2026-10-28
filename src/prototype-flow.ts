import { ProjectStoreError } from "./project-store.js";
import { readPreviewStart, type PreviewStart } from "./preview-start.js";
import {
    isVisualExploration, readVisualCheckpoint, readVisualSelection, awaitingVisualChoice,
    originalPrototypeCheckpointId, visualExplorationIsCurrent,
    type VisualCheckpoint, type VisualExploration, type VisualSelection,
} from "./visual-directions.js";
export { awaitingVisualChoice, visualExplorationIsCurrent, prototypePreviewCheckpointId, isPrototypePreviewTarget } from "./visual-directions.js";
import { prototypeMilestoneLabels, prototypeMilestoneReady, type PrototypeMilestone, type PrototypeSubstage } from "./prototype-milestones.js";
export { prototypeMilestoneLabels, prototypeMilestoneReady, prototypeSubstage, type PrototypeMilestone, type PrototypeSubstage } from "./prototype-milestones.js";
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
    timeoutSeconds: number | null;
    sourceFingerprint?: string | null;
    requirementsDigest?: string;
    previewStart?: PreviewStart;
    sketchRevisionId?: string | null;
    sketchInputHash?: string | null;
    sketchImagesRead?: string[];
    visual?: VisualCheckpoint;
    visualDismissedAt?: string;
    continuation?: "interaction";
}

export interface PrototypeFlow {
    version: 1;
    checkpoints: PrototypeCheckpoint[];
    displayedCheckpointId: string | null;
    pendingCheckpointId: string | null;
    activeCheckpointId: string | null;
    visualRequested: boolean;
    visualExploration?: VisualExploration | null;
    budget: { limitSeconds: number | null; usedSeconds: number };
}

export function newPrototypeFlow(): PrototypeFlow {
    return {
        version: 1, checkpoints: [], displayedCheckpointId: null,
        pendingCheckpointId: null, activeCheckpointId: null, visualRequested: false,
        budget: { limitSeconds: null, usedSeconds: 0 },
    };
}

const record = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value);
const nullableString = (value: unknown): value is string | null =>
    value === null || typeof value === "string";
const historicalSeconds = (value: unknown): value is number | null =>
    value === null || typeof value === "number" && Number.isFinite(value) && value >= 0;

export function readPrototypeFlow(value: unknown): PrototypeFlow | null {
    if (value == null) return null;
    const invalid = () => new ProjectStoreError("prototype_flow_invalid",
        "The saved prototype checkpoints are invalid. Restore the original state before continuing.", 422);
    if (!record(value) || value.version !== 1 || !Array.isArray(value.checkpoints) ||
        !nullableString(value.displayedCheckpointId) || !nullableString(value.pendingCheckpointId) ||
        !nullableString(value.activeCheckpointId) || typeof value.visualRequested !== "boolean" ||
        !record(value.budget) || !historicalSeconds(value.budget.limitSeconds) ||
        typeof value.budget.usedSeconds !== "number" ||
        !Number.isFinite(value.budget.usedSeconds) || value.budget.usedSeconds < 0) throw invalid();
    const checkpoints = value.checkpoints.map((entry): PrototypeCheckpoint => {
        if (!record(entry) || typeof entry.id !== "string" || !entry.id ||
            typeof entry.requestId !== "string" || typeof entry.generation !== "string" ||
            (entry.milestone !== "prototype" && entry.milestone !== "structure" && entry.milestone !== "interaction" && entry.milestone !== "visual") ||
            (entry.status !== "running" && entry.status !== "ready" && entry.status !== "failed" && entry.status !== "clarifying") ||
            !nullableString(entry.revisionId) || !nullableString(entry.baseCheckpointId) ||
            !nullableString(entry.sourceCheckpointId) || typeof entry.workspacePath !== "string" ||
            typeof entry.workspacePrepared !== "boolean" || !nullableString(entry.previewUrl) ||
            typeof entry.summary !== "string" || typeof entry.focus !== "string" ||
            typeof entry.requestedAt !== "string" || !nullableString(entry.completedAt) ||
            !historicalSeconds(entry.timeoutSeconds) ||
            (entry.sourceFingerprint !== undefined && !nullableString(entry.sourceFingerprint)) ||
            (entry.requirementsDigest !== undefined && (typeof entry.requirementsDigest !== "string" || !/^[a-f0-9]{64}$/.test(entry.requirementsDigest))) ||
            (entry.sketchRevisionId !== undefined && !nullableString(entry.sketchRevisionId)) ||
            (entry.sketchInputHash !== undefined && !nullableString(entry.sketchInputHash)) ||
            Boolean(entry.sketchRevisionId) !== Boolean(entry.sketchInputHash) ||
            (typeof entry.sketchRevisionId === "string" && (!entry.sketchRevisionId || entry.sketchRevisionId.length > 80)) ||
            (typeof entry.sketchInputHash === "string" && !/^[a-f0-9]{64}$/.test(entry.sketchInputHash)) ||
            (entry.sketchImagesRead !== undefined && (!Array.isArray(entry.sketchImagesRead) ||
                entry.sketchImagesRead.length > 8 || entry.sketchImagesRead.some((id) => typeof id !== "string") ||
                new Set(entry.sketchImagesRead).size !== entry.sketchImagesRead.length)) ||
            (!entry.sketchRevisionId && Array.isArray(entry.sketchImagesRead) && entry.sketchImagesRead.length > 0) ||
            (entry.continuation !== undefined && (entry.continuation !== "interaction" ||
                entry.milestone !== "structure" || entry.revisionId !== null)) ||
            (entry.timeoutSeconds !== null && (entry.timeoutSeconds < 0 || entry.timeoutSeconds > 300))) throw invalid();
        if (entry.visualDismissedAt !== undefined && (entry.milestone !== "visual" ||
            !["failed", "ready"].includes(String(entry.status)) || typeof entry.visualDismissedAt !== "string" ||
            !Number.isFinite(Date.parse(entry.visualDismissedAt)))) throw invalid();
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
            ...(typeof entry.requirementsDigest === "string" ? { requirementsDigest: entry.requirementsDigest } : {}),
            ...(entry.previewStart !== undefined ? { previewStart: readPreviewStart(entry.previewStart) } : {}),
            ...(entry.sketchRevisionId !== undefined ? {
                sketchRevisionId: typeof entry.sketchRevisionId === "string" ? entry.sketchRevisionId : null,
            } : {}),
            ...(entry.sketchInputHash !== undefined ? {
                sketchInputHash: typeof entry.sketchInputHash === "string" ? entry.sketchInputHash : null,
            } : {}),
            ...(Array.isArray(entry.sketchImagesRead) ? { sketchImagesRead: entry.sketchImagesRead.map((id: string) => id) } : {}),
            ...(entry.visual !== undefined ? { visual: readVisualCheckpoint(entry.visual) } : {}),
            ...(typeof entry.visualDismissedAt === "string" ? { visualDismissedAt: entry.visualDismissedAt } : {}),
            ...(entry.continuation === "interaction" ? { continuation: "interaction" as const } : {}),
        };
    });
    if (new Set(checkpoints.map((item) => item.id)).size !== checkpoints.length) throw invalid();
    // Legacy capped accounting remains readable; new unbounded work can exceed its retained historical limit.
    if (value.budget.limitSeconds !== null && value.budget.usedSeconds > value.budget.limitSeconds
        && !checkpoints.some(item => item.timeoutSeconds === null)) throw invalid();
    const ids = [value.displayedCheckpointId, value.pendingCheckpointId, value.activeCheckpointId,
        ...checkpoints.flatMap((item) => [item.baseCheckpointId, item.sourceCheckpointId])];
    if (ids.some((id) => id !== null && !checkpoints.some((item) => item.id === id))) throw invalid();
    for (const id of [value.displayedCheckpointId, value.pendingCheckpointId]) {
        if (id && !checkpoints.some((item) => item.id === id && item.status === "ready" && item.previewUrl)) throw invalid();
    }
    if (checkpoints.filter((item) => item.status === "running").length !== (value.activeCheckpointId ? 1 : 0) ||
        (value.activeCheckpointId && !checkpoints.some((item) => item.id === value.activeCheckpointId && item.status === "running"))) throw invalid();
    for (const checkpoint of checkpoints) {
        if (!checkpoint.visual) continue;
        const visual = checkpoint.visual;
        if (checkpoint.milestone !== "visual" || (checkpoint.status === "ready") !== Boolean(visual.manifest) ||
            checkpoint.visualDismissedAt && visual.operation === "preserve" ||
            visual.explorationCheckpointId && !checkpoints.some(item =>
                item.id === visual.explorationCheckpointId && item.status === "ready" && isVisualExploration(item))) throw invalid();
    }
    let visualExploration: VisualExploration | null = null;
    if (value.visualExploration != null) {
        const saved = value.visualExploration;
        if (!record(saved) || typeof saved.checkpointId !== "string" || typeof saved.activeDirectionId !== "string" ||
            !nullableString(saved.appliedCheckpointId) || !Array.isArray(saved.selections)) throw invalid();
        const checkpoint = checkpoints.find(item => item.id === saved.checkpointId);
        if (!checkpoint || !isVisualExploration(checkpoint) || checkpoint.status !== "ready" || !checkpoint.visual?.manifest) throw invalid();
        const selections = saved.selections.map(readVisualSelection);
        const ids = checkpoint.visual.manifest.directions.map(item => item.id);
        if (selections.length !== ids.length || new Set(selections.map(item => item.directionId)).size !== ids.length ||
            selections.some(item => !ids.includes(item.directionId)) || !ids.includes(saved.activeDirectionId) ||
            saved.appliedCheckpointId && !checkpoints.some(item => item.id === saved.appliedCheckpointId &&
                item.status === "ready" && item.visual && item.visual.explorationCheckpointId === saved.checkpointId &&
                ["choose", "preserve"].includes(item.visual.operation))) throw invalid();
        visualExploration = { checkpointId: saved.checkpointId, activeDirectionId: saved.activeDirectionId,
            selections, appliedCheckpointId: saved.appliedCheckpointId };
    }
    return {
        version: 1, checkpoints, displayedCheckpointId: value.displayedCheckpointId,
        pendingCheckpointId: value.pendingCheckpointId, activeCheckpointId: value.activeCheckpointId,
        visualRequested: value.visualRequested,
        ...(value.visualExploration !== undefined ? { visualExploration } : {}),
        budget: { limitSeconds: value.budget.limitSeconds, usedSeconds: value.budget.usedSeconds },
    };
}

export function prototypeCheckpoint(flow: PrototypeFlow, id: string | null): PrototypeCheckpoint | null {
    return flow.checkpoints.find((item) => item.id === id) || null;
}

export type PrototypePreviewTarget = "current" | "pending" | "exploration" | "original" | PrototypeMilestone;

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

export function nextPrototypeMilestone(flow: PrototypeFlow): PrototypeSubstage | null {
    if (!prototypeMilestoneReady(flow, "prototype")) return "prototype";
    return flow.visualRequested && !prototypeMilestoneReady(flow, "visual") ? "visual" : null;
}

export function prototypeSketchEvidenceCheckpoint(flow: PrototypeFlow, checkpoint: PrototypeCheckpoint): PrototypeCheckpoint {
    const source = prototypeCheckpoint(flow, checkpoint.sourceCheckpointId);
    // Reused reads retain their original checkpoint and are limited to this progressive request and approval.
    return source?.continuation === "interaction" && source.status === "ready" && checkpoint.milestone === "interaction"
        && source.requestId === checkpoint.requestId && source.generation === checkpoint.generation
        && source.sketchRevisionId === checkpoint.sketchRevisionId && source.sketchInputHash === checkpoint.sketchInputHash
        ? source : checkpoint;
}

export function reservePrototypeCheckpoint(flow: PrototypeFlow, checkpoint: Omit<PrototypeCheckpoint, "timeoutSeconds">): PrototypeFlow {
    if (flow.activeCheckpointId || flow.pendingCheckpointId) throw new Error("Apply the prepared update or finish active work before building another checkpoint.");
    return {
        ...flow, activeCheckpointId: checkpoint.id,
        checkpoints: [...flow.checkpoints, { ...checkpoint, timeoutSeconds: null }],
    };
}

export function settlePrototypeCheckpoint(flow: PrototypeFlow, id: string,
    update: Pick<PrototypeCheckpoint, "status" | "previewUrl" | "summary" | "focus"> & { visual?: VisualCheckpoint }, completedAt: string): PrototypeFlow {
    const checkpoint = prototypeCheckpoint(flow, id);
    if (!checkpoint || flow.activeCheckpointId !== id || checkpoint.status !== "running") {
        throw new Error("This result no longer owns the active prototype checkpoint.");
    }
    const elapsed = Math.max(1, Math.ceil((Date.parse(completedAt) - Date.parse(checkpoint.requestedAt)) / 1000));
    if (!Number.isFinite(elapsed) || update.status === "running") throw new Error("Invalid prototype checkpoint completion.");
    const ready = update.status === "ready";
    if (ready && !update.previewUrl) throw new Error("A ready checkpoint must have a verified preview URL.");
    const exploring = ready && isVisualExploration(checkpoint);
    let exploration = flow.visualExploration;
    if (exploring) {
        const manifest = update.visual?.manifest;
        if (!manifest) throw new Error("Visual exploration must retain its verified direction manifest.");
        const previous = checkpoint.visual?.operation === "refine" ? exploration : null;
        exploration = {
            checkpointId: id, activeDirectionId: previous?.activeDirectionId || manifest.defaultSelection.directionId,
            selections: manifest.directions.map(direction => previous?.selections.find(item => item.directionId === direction.id)
                || { directionId: direction.id, settings: direction.defaults }),
            appliedCheckpointId: null,
        };
    }
    return {
        ...flow, activeCheckpointId: null,
        checkpoints: flow.checkpoints.map((item) => item.id === id ? { ...item, ...update, completedAt } : item),
        displayedCheckpointId: ready && !exploring && !flow.displayedCheckpointId ? id : flow.displayedCheckpointId,
        pendingCheckpointId: ready && !exploring && flow.displayedCheckpointId ? id : flow.pendingCheckpointId,
        ...(exploration !== undefined ? { visualExploration: exploration } : {}),
        budget: {
            ...flow.budget,
            usedSeconds: checkpoint.timeoutSeconds === null ? flow.budget.usedSeconds + elapsed
                : flow.budget.usedSeconds - checkpoint.timeoutSeconds + Math.min(checkpoint.timeoutSeconds, elapsed),
        },
    };
}

export function promotePrototypeCheckpoint(flow: PrototypeFlow, id: string): PrototypeFlow {
    if (flow.pendingCheckpointId !== id || prototypeCheckpoint(flow, id)?.status !== "ready") {
        throw new Error("This update is no longer pending. Review the current prototype update.");
    }
    const checkpoint = prototypeCheckpoint(flow, id)!;
    if (isVisualExploration(checkpoint)) throw new Error("Choose a direction before applying visual exploration.");
    const exploration = flow.visualExploration;
    if (checkpoint.visual?.operation === "choose" && (checkpoint.baseCheckpointId !== flow.displayedCheckpointId ||
        checkpoint.visual.explorationCheckpointId !== exploration?.checkpointId)) {
        throw new Error("The prepared visual choice no longer matches the current prototype and exploration.");
    }
    return { ...flow, displayedCheckpointId: id, pendingCheckpointId: null,
        ...(exploration && ["choose", "preserve"].includes(checkpoint.visual?.operation || "")
            ? { visualExploration: { ...exploration, appliedCheckpointId: id } } : {}),
    };
}

export function restoreOriginalPrototype(flow: PrototypeFlow, id: string): PrototypeFlow {
    const exploration = flow.visualExploration;
    const original = prototypeCheckpoint(flow, originalPrototypeCheckpointId(flow));
    if (!exploration || !visualExplorationIsCurrent(flow) || !original || original.id !== id || original.status !== "ready" || !original.previewUrl) {
        throw new Error("The original prototype no longer matches this exploration. Review the current prototype before accepting Default.");
    }
    if (flow.activeCheckpointId || flow.pendingCheckpointId) {
        throw new Error("Resolve the active or prepared prototype update before accepting Default.");
    }
    return { ...flow, displayedCheckpointId: original.id, visualRequested: false,
        visualExploration: { ...exploration, appliedCheckpointId: null } };
}

export function updateVisualSelection(flow: PrototypeFlow, checkpointId: string, input: unknown): PrototypeFlow {
    const exploration = flow.visualExploration;
    const selection: VisualSelection = readVisualSelection(input);
    if (!exploration || exploration.checkpointId !== checkpointId ||
        !exploration.selections.some(item => item.directionId === selection.directionId)) {
        throw new Error("These visual directions changed. Inspect the latest alternatives before adjusting them.");
    }
    return { ...flow, visualExploration: { ...exploration, activeDirectionId: selection.directionId,
        selections: exploration.selections.map(item => item.directionId === selection.directionId ? selection : item) } };
}

export function prototypeFlowCompletionError(flow: PrototypeFlow | null, { keepCurrentVisual = false } = {}): string | null {
    if (!flow) return null;
    if (flow.activeCheckpointId) return "Wait for the active prototype checkpoint to finish.";
    if (flow.pendingCheckpointId) return "Apply the prepared prototype update before finishing.";
    if (!keepCurrentVisual && awaitingVisualChoice(flow)) return "Choose and apply a visual direction, or keep the current prototype before finishing.";
    const milestone = nextPrototypeMilestone(flow);
    if (milestone) return `Finish ${prototypeMilestoneLabels[milestone]} before finishing Prototype.`;
    return null;
}
