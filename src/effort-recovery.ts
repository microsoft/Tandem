interface NativeSession {
    sessionId: string;
    rpc: {
        metadata: { isProcessing(): Promise<unknown>; activity(): Promise<unknown> };
        queue: { pendingItems(): Promise<unknown> };
        workflow: { listRuns(input: { limit: number }): Promise<unknown> };
    };
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
export interface IdleNativeEvidence {
    observedAt: string;
    sessionId: string;
    processing: false;
    hasActiveWork: false;
    abortable: false;
    pendingItems: 0;
    steeringMessages: 0;
    runs: Array<{ runId: string; status: "completed" | "failed" | "cancelled" }>;
}
export interface FactoryAbandonment {
    outcome: "abandoned-uncertain";
    decisionId: string;
    recordedAt: string;
    owner: { sessionId: string; workspaceRoot: string };
    observations: [IdleNativeEvidence, IdleNativeEvidence];
}

export async function inspectIdleNativeSession(session: NativeSession): Promise<IdleNativeEvidence> {
    const [processing, activity, queue, inventory] = await Promise.all([
        session.rpc.metadata.isProcessing(), session.rpc.metadata.activity(),
        session.rpc.queue.pendingItems(), session.rpc.workflow.listRuns({ limit: 500 }),
    ]);
    if (!object(processing) || processing.processing !== false || !object(activity)
        || activity.hasActiveWork !== false || activity.abortable !== false) {
        throw new Error("Native work is active or its idle state is unavailable. Recovery was not applied.");
    }
    if (!object(queue) || !Array.isArray(queue.items) || queue.items.length
        || !Array.isArray(queue.steeringMessages) || queue.steeringMessages.length
        || queue.withdrawableTurnMessageId != null || (queue.inFlightSteeringCount ?? 0) !== 0) {
        throw new Error("Native queued or in-flight input is present or unknown. Recovery was not applied.");
    }
    if (!object(inventory) || !Array.isArray(inventory.runs) || inventory.omittedOlder !== 0 || inventory.hasMoreNewer !== false) {
        throw new Error("A complete native workflow inventory is unavailable. Recovery was not applied.");
    }
    const runs: IdleNativeEvidence["runs"] = [], ids = new Set<string>();
    for (const run of inventory.runs) {
        if (!object(run) || typeof run.runId !== "string" || !run.runId || ids.has(run.runId)
            || !["completed", "failed", "cancelled"].includes(String(run.status))) {
            throw new Error("A native workflow is active, resumable or unknown. Recovery was not applied.");
        }
        ids.add(run.runId);
        runs.push({ runId: run.runId, status: run.status as IdleNativeEvidence["runs"][number]["status"] });
    }
    runs.sort((left, right) => left.runId.localeCompare(right.runId));
    return { observedAt: new Date().toISOString(), sessionId: session.sessionId, processing: false,
        hasActiveWork: false, abortable: false, pendingItems: 0, steeringMessages: 0, runs };
}

export function validFactoryAbandonment(value: unknown): value is FactoryAbandonment {
    if (!object(value) || value.outcome !== "abandoned-uncertain" || typeof value.decisionId !== "string"
        || !value.decisionId || typeof value.recordedAt !== "string" || !Number.isFinite(Date.parse(value.recordedAt))
        || !object(value.owner) || typeof value.owner.sessionId !== "string" || !value.owner.sessionId
        || typeof value.owner.workspaceRoot !== "string" || !value.owner.workspaceRoot
        || !Array.isArray(value.observations) || value.observations.length !== 2) return false;
    const owner = value.owner;
    if (!value.observations.every(observation => object(observation)
        && observation.sessionId === owner.sessionId && observation.processing === false
        && observation.hasActiveWork === false && observation.abortable === false
        && observation.pendingItems === 0 && observation.steeringMessages === 0
        && typeof observation.observedAt === "string" && Number.isFinite(Date.parse(observation.observedAt))
        && Array.isArray(observation.runs) && observation.runs.every(run => object(run)
            && typeof run.runId === "string" && Boolean(run.runId)
            && ["completed", "failed", "cancelled"].includes(String(run.status))))) return false;
    const [first, second] = value.observations as [IdleNativeEvidence, IdleNativeEvidence];
    return Date.parse(first.observedAt) <= Date.parse(second.observedAt)
        && Date.parse(second.observedAt) <= Date.parse(value.recordedAt)
        && JSON.stringify(first.runs) === JSON.stringify(second.runs)
        && new Set(first.runs.map(run => run.runId)).size === first.runs.length;
}
