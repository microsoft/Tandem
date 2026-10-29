import { ProjectStoreError } from "./project-store.js";
import type { LifecycleOutput, LifecycleStageId, LifecycleState, TandemState } from "./types.js";
import { hasActiveWork, hasUnconfirmedExecution, isRetiredStage, lifecycleStages, parseHistoricalStageId } from "./workflow.js";

export const LEGACY_SKETCH_REASON = "This effort entered Prototype before Designs was introduced. Reopen Requirements to add approved designs.";
const record = (value: unknown): value is Record<string, any> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** Historical records never pass through the active-stage filter. */
export function migrateLifecycle(value: unknown): LifecycleState {
    if (!record(value)) throw new ProjectStoreError("lifecycle_invalid", "The saved lifecycle is invalid; its state was preserved.", 422);
    if (value.version !== undefined && value.version !== 2 && value.version !== 3) {
        throw new ProjectStoreError("lifecycle_version_invalid", "The saved lifecycle version is unsupported; its state was preserved.", 422);
    }
    const completed = new Set<unknown>(Array.isArray(value.completedStages) ? value.completedStages : []);
    for (const id of completed) parseHistoricalStageId(id);
    if (value.currentStage) parseHistoricalStageId(value.currentStage);
    if (value.currentStage && value.currentStage !== "prepare") completed.add("prepare");
    const migratedSketch = value.version === undefined && completed.has("requirements") && !completed.has("sketch");
    if (migratedSketch) completed.add("sketch");
    const completedStages: LifecycleStageId[] = [];
    if (value.changeRequestId !== undefined && (value.version !== 3 || typeof value.changeRequestId !== "string" ||
        !/^[A-Za-z0-9._-]{1,120}$/.test(value.changeRequestId))) {
        throw new ProjectStoreError("lifecycle_invalid", "The scoped lifecycle change identity is invalid.", 422);
    }
    if (value.reviewId !== undefined && (value.version !== 3 || typeof value.reviewId !== "string"
        || !/^review-[a-f0-9-]{36}$/.test(value.reviewId) || !lifecycleStages.some(stage => stage.id === value.currentStage))) {
        throw new ProjectStoreError("lifecycle_invalid", "The pinned stage review identity is invalid.", 422);
    }
    for (const stage of lifecycleStages) {
        if (stage.id === "development") break;
        if (!completed.has(stage.id)) {
            if (!value.changeRequestId && !value.reviewId) break;
        } else completedStages.push(stage.id);
    }
    const outputs = (input: unknown): LifecycleOutput[] => {
        if (input === undefined) return [];
        if (!Array.isArray(input)) throw new ProjectStoreError("lifecycle_invalid", "Saved stage history is invalid.", 422);
        return input.map((entry) => {
            if (!record(entry) || typeof entry.path !== "string" || typeof entry.completedAt !== "string") {
                throw new ProjectStoreError("lifecycle_invalid", "Saved stage output is invalid; no history was discarded.", 422);
            }
            return { ...entry, stageId: parseHistoricalStageId(entry.stageId), path: entry.path, completedAt: entry.completedAt };
        });
    };
    const originalOutputs = outputs(value.outputs);
    const history = outputs(value.history);
    for (const output of originalOutputs.filter((entry) => isRetiredStage(entry.stageId))) {
        if (!history.some((entry) => entry.stageId === output.stageId && entry.path === output.path)) history.push(output);
    }
    const skippedStages = (Array.isArray(value.skippedStages) ? value.skippedStages : []).map((entry) => {
        if (!record(entry) || typeof entry.reason !== "string" || typeof entry.skippedAt !== "string") {
            throw new ProjectStoreError("lifecycle_invalid", "Saved skipped-stage evidence is invalid.", 422);
        }
        return { stageId: parseHistoricalStageId(entry.stageId), reason: entry.reason, skippedAt: entry.skippedAt };
    });
    if (migratedSketch && !skippedStages.some((entry) => entry.stageId === "sketch")) {
        skippedStages.push({ stageId: "sketch",
            reason: skippedStages.find((entry) => entry.stageId === "prototype")?.reason || LEGACY_SKETCH_REASON,
            skippedAt: originalOutputs.find((entry) => entry.stageId === "requirements")?.completedAt || "" });
    }
    if (value.migration !== undefined && (!record(value.migration) || value.migration.version !== 1 || !record(value.migration.original))) {
        throw new ProjectStoreError("lifecycle_invalid", "Saved lifecycle migration is invalid.", 422);
    }
    return {
        version: 3, currentStage: value.reviewId ? value.currentStage
            : lifecycleStages.find(stage => !completedStages.includes(stage.id))?.id ?? "development",
        ...(value.changeRequestId ? { changeRequestId: value.changeRequestId } : {}),
        ...(value.reviewId ? { reviewId: value.reviewId } : {}),
        completedStages, outputs: originalOutputs.filter((entry) => !isRetiredStage(entry.stageId)),
        history, skippedStages,
        ...(value.version !== 3 ? { migration: { version: 1, original: structuredClone(value) } }
            : value.migration ? { migration: structuredClone(value.migration) } : {}),
    };
}

export function legacyCutoverError(state: Pick<TandemState, "designReview" | "testDesignReview" | "planning" | "implementation" | "testing" | "factoryRuns"> & { lifecycle?: LifecycleState }): string | null {
    const owners = [state.designReview?.processing, state.testDesignReview?.processing, state.planning?.processing,
        state.implementation, state.testing].filter(Boolean);
    const legacyActive = hasActiveWork({
        designReview: state.designReview, testDesignReview: state.testDesignReview, planning: state.planning,
        implementation: state.implementation, testing: state.testing,
    }) || [state.implementation, state.testing].some((runtime) => hasUnconfirmedExecution(runtime)
        || Boolean(runtime?.runId && !runtime.terminalConfirmedAt && runtime.status !== "idle"))
        || (state.factoryRuns || []).some((run) => !run.terminal && (isRetiredStage(state.lifecycle?.migration?.original.currentStage)
            || owners.some(owner => owner.requestId === run.requestId || owner.runId && owner.runId === run.runId)));
    return legacyActive ? "Legacy work is active or its termination is unconfirmed. Its original owner must settle it before Development can start; old workers will not be adopted or replayed." : null;
}

export function assertLegacyCutover(state: Parameters<typeof legacyCutoverError>[0]): void {
    const reason = legacyCutoverError(state);
    if (reason) throw new ProjectStoreError("legacy_cutover_blocked", reason);
}

export function assertUpstreamStage(stage: unknown): asserts stage is Exclude<LifecycleStageId, "development"> {
    if (isRetiredStage(stage) || stage === "development") {
        throw new ProjectStoreError("stage_retired", "The Design/Plan/Implement/Test pipeline is retired. Use Development's native requests and confirmations, not stage completion or reopening.", 410);
    }
}
