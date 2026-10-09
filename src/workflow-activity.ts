import type { TandemState } from "./types.js";

export interface WorkflowBinding {
    generation: string;
    requestId: string;
    runId: string;
    requestedAt: string;
    completedAt?: string | null;
    kind: "preparation" | "answer" | "suggestions";
}

export function workflowBinding(state: TandemState): WorkflowBinding | null {
    const preparation = state.preparation?.processing;
    const choices = [
        { kind: "preparation" as const, request: preparation, status: state.preparation?.status },
        { kind: "answer" as const, request: state.processing, status: state.processing?.status },
        { kind: "suggestions" as const, request: state.suggestionProcessing, status: state.suggestionProcessing?.status },
    ];
    const chosen = choices.find(item => item.request?.runId && ["starting", "running"].includes(item.status))
        ?? choices.find(item => item.kind === (state.lifecycle.currentStage === "prepare" ? "preparation" : "answer") && item.request?.runId)
        ?? choices.find(item => item.kind === "suggestions" && item.request?.runId);
    if (!chosen?.request?.runId || !chosen.request.requestId) return null;
    return { generation: state.generation, requestId: chosen.request.requestId, runId: chosen.request.runId,
        requestedAt: chosen.request.requestedAt, completedAt: timestamp(chosen.request.completedAt), kind: chosen.kind };
}

interface NativeAgent {
    agentId: string;
    toolCallId: string;
    runId: string;
    status: string;
    activityAt: string | null;
    intent: string;
    intentAt: string | null;
    operation: string;
    operations: Map<string, string>;
    permissions: Set<string>;
}

export interface WorkflowActivitySnapshot extends WorkflowBinding {
    status: string;
    error?: string;
    lastNativeActivityAt: string | null;
    agents: Array<{
        id: string;
        label: string;
        status: string;
        operation: string;
        update: string;
        updateAt: string | null;
        lastNativeActivityAt: string | null;
        pendingPermissions: number;
        activeMs: number | null;
    }>;
}

interface NativeRunDetail {
    runId: string;
    status: string;
    completedAt?: number | null;
    agents: readonly { agentId?: string; toolCallId: string; label: string; status: string; activeMs?: number }[];
    progress: { records: readonly { recordedAt: number }[] };
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const terminal = new Set(["completed", "cancelled", "error", "failed"]);
const timestamp = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
const sentence = (value: unknown) => typeof value === "string" ? value.trim().slice(0, 400) : "";
const newest = (left: string | null, right: string | null) =>
    !left || right && Date.parse(right) > Date.parse(left) ? right : left;

/** Read-only native activity. None of these observations settles or retries work. */
export class NativeWorkflowActivity {
    private readonly agents = new Map<string, NativeAgent>();
    private readonly permissions = new Map<string, { agentId: string; runId: string }>();

    observe(event: { type: string; agentId?: string; timestamp?: string; data: unknown }): void {
        if (!record(event.data)) return;
        const data = event.data, at = timestamp(event.timestamp);
        const permissionOwner = event.type === "permission.completed" && typeof data.requestId === "string"
            ? this.permissions.get(data.requestId) : undefined;
        if (permissionOwner && event.agentId && event.agentId !== permissionOwner.agentId) return;
        const agentId = event.agentId || permissionOwner?.agentId;
        if (!agentId) return;
        if (event.type === "subagent.started") {
            if (typeof data.workflowRunId !== "string" || typeof data.toolCallId !== "string") return;
            this.agents.set(agentId, { agentId, toolCallId: data.toolCallId, runId: data.workflowRunId,
                status: "running", activityAt: at, intent: "", intentAt: null, operation: "", operations: new Map(), permissions: new Set() });
            return;
        }
        const agent = this.agents.get(agentId);
        if (!agent) return;
        if (event.type === "subagent.completed" || event.type === "subagent.failed") {
            agent.status = data.cancelled === true ? "cancelled" : event.type === "subagent.failed" ? "failed" : "completed";
            agent.permissions.clear(); agent.operations.clear(); agent.operation = "";
        } else if (event.type === "permission.completed") {
            if (typeof data.requestId !== "string" || permissionOwner?.agentId !== agent.agentId || permissionOwner.runId !== agent.runId) return;
            agent.permissions.delete(data.requestId); this.permissions.delete(data.requestId);
        } else if (terminal.has(agent.status)) {
            return;
        } else if (event.type === "permission.requested") {
            if (typeof data.requestId !== "string") return;
            const previous = this.permissions.get(data.requestId);
            if (previous && (previous.agentId !== agent.agentId || previous.runId !== agent.runId)) return;
            agent.permissions.add(data.requestId); this.permissions.set(data.requestId, { agentId: agent.agentId, runId: agent.runId });
        } else if (event.type === "tool.execution_start") {
            if (typeof data.toolCallId !== "string" || typeof data.toolName !== "string") return;
            agent.operations.set(data.toolCallId, data.toolName.slice(0, 80));
            agent.operation = data.toolName.slice(0, 80);
            const description = data.toolName === "powershell" && record(data.arguments) ? data.arguments.description : undefined;
            const update = sentence(data.intentionSummary) || sentence(description);
            if (update) { agent.intent = update; agent.intentAt = at; }
        } else if (event.type === "tool.execution_complete") {
            if (typeof data.toolCallId !== "string" || !agent.operations.delete(data.toolCallId)) return;
            agent.operation = [...agent.operations.values()].at(-1) || "";
        } else if (event.type === "assistant.intent") {
            agent.intent = sentence(data.intent);
            agent.intentAt = at;
        } else if (event.type === "assistant.message" && data.phase === "commentary") {
            agent.intent = sentence(data.content);
            agent.intentAt = at;
        } else if (!["assistant.turn_start", "assistant.message_start", "assistant.message_delta", "assistant.streaming_delta", "tool.execution_progress"].includes(event.type)) {
            return;
        }
        agent.activityAt = newest(agent.activityAt, at);
    }

    snapshot(binding: WorkflowBinding, detail: NativeRunDetail): WorkflowActivitySnapshot {
        if (detail.runId !== binding.runId) throw new Error("Native activity belongs to another workflow.");
        let lastNativeActivityAt: string | null = null;
        for (const item of detail.progress.records) {
            if (Number.isFinite(item.recordedAt)) lastNativeActivityAt = newest(lastNativeActivityAt, new Date(item.recordedAt).toISOString());
        }
        const agents = detail.agents.map(row => {
            const observed = [...this.agents.values()].find(agent => agent.runId === binding.runId &&
                (row.agentId ? row.agentId === agent.agentId : row.toolCallId === agent.toolCallId));
            const status = terminal.has(row.status) ? row.status : observed?.status || row.status;
            const pendingPermissions = terminal.has(status) ? 0 : observed?.permissions.size || 0;
            lastNativeActivityAt = newest(lastNativeActivityAt, observed?.activityAt ?? null);
            return { id: row.agentId || row.toolCallId, label: row.label, status: pendingPermissions ? "waiting-permission" : status,
                operation: terminal.has(status) ? "" : observed?.operation || "", update: observed?.intent || "", updateAt: observed?.intentAt ?? null,
                lastNativeActivityAt: observed?.activityAt ?? null, pendingPermissions,
                activeMs: typeof row.activeMs === "number" && Number.isFinite(row.activeMs) ? row.activeMs : null };
        });
        const nativeEnd = typeof detail.completedAt === "number" && Number.isFinite(new Date(detail.completedAt).getTime())
            ? new Date(detail.completedAt).toISOString() : null;
        return { ...binding, completedAt: terminal.has(detail.status) ? nativeEnd ?? binding.completedAt ?? null : null,
            status: detail.status, lastNativeActivityAt, agents };
    }
}
