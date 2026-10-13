import { createHash } from "node:crypto";
import type { PermissionRequest } from "@github/copilot-sdk";

export interface NativePermissionScope {
    sessionId: string;
    toolCallId: string;
    requestId?: string;
    agentId?: string;
    workflowRunId?: string;
    claimed: boolean;
    cancelled: boolean;
    retired: boolean;
    ready: Promise<void>;
    bind(): void;
}

function envelope(sessionId: string, request: unknown): string {
    return createHash("sha256").update(JSON.stringify([sessionId, request], (_key, value) =>
        value && typeof value === "object" && !Array.isArray(value)
            ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value)).digest("hex");
}
const identity = (sessionId: string, id: string) => JSON.stringify([sessionId, id]);
const record = (value: unknown): value is Record<string, unknown> =>
    Boolean(value) && typeof value === "object" && !Array.isArray(value);

export class NativePermissionLifetimes {
    private readonly envelopes = new Map<string, NativePermissionScope>();
    private readonly requests = new Map<string, NativePermissionScope>();
    private readonly cancelledAgents = new Set<string>();
    private readonly retiredRequests = new Set<string>();
    private readonly workflows = new Map<string, string>();
    private closed = false;

    constructor(private readonly ended: (scope: NativePermissionScope) => void) {}

    private create(sessionId: string, toolCallId: string): NativePermissionScope {
        let bind!: () => void;
        const ready = new Promise<void>(resolve => { bind = resolve; });
        return { sessionId, toolCallId, claimed: false, cancelled: this.closed, retired: false,
            ready, bind };
    }

    claim(sessionId: string, request: PermissionRequest): NativePermissionScope | undefined {
        if (!("toolCallId" in request) || typeof request.toolCallId !== "string" || !request.toolCallId) return undefined;
        const key = envelope(sessionId, request);
        const scope = this.envelopes.get(key) ?? this.create(sessionId, request.toolCallId);
        if (scope.claimed) throw new Error("The same native permission envelope is already being handled; no second decision was sent.");
        scope.claimed = true;
        this.envelopes.set(key, scope);
        if (this.closed) scope.bind();
        return scope;
    }

    observe(sessionId: string, event: { type: string; agentId?: string; data: unknown }): void {
        if (this.closed || !record(event.data)) return;
        const data = event.data;
        if (event.type === "subagent.started" && event.agentId && typeof data.workflowRunId === "string") {
            this.workflows.set(identity(sessionId, event.agentId), data.workflowRunId);
        } else if (event.type === "permission.requested" && record(data.permissionRequest)
            && typeof data.requestId === "string" && typeof data.permissionRequest.toolCallId === "string") {
            const key = envelope(sessionId, data.permissionRequest);
            const previous = this.envelopes.get(key);
            let scope = previous ?? this.create(sessionId, data.permissionRequest.toolCallId);
            if (previous?.requestId && previous.requestId !== data.requestId) {
                scope = this.create(sessionId, data.permissionRequest.toolCallId);
                if (!previous.retired || !previous.claimed) {
                    previous.cancelled = scope.cancelled = true;
                    previous.bind(); this.ended(previous);
                }
            }
            scope.requestId = data.requestId;
            scope.agentId = event.agentId;
            scope.workflowRunId = event.agentId ? this.workflows.get(identity(sessionId, event.agentId)) : undefined;
            scope.cancelled ||= Boolean(event.agentId && this.cancelledAgents.has(identity(sessionId, event.agentId)));
            scope.retired = this.retiredRequests.has(identity(sessionId, data.requestId));
            this.envelopes.set(key, scope);
            this.requests.set(identity(sessionId, data.requestId), scope);
            scope.bind();
            if (scope.cancelled || scope.retired) this.ended(scope);
        } else if (event.type === "permission.completed" && typeof data.requestId === "string") {
            const key = identity(sessionId, data.requestId);
            this.retiredRequests.add(key);
            const scope = this.requests.get(key);
            if (scope) { scope.retired = true; scope.bind(); this.ended(scope); }
        } else if (event.type === "subagent.completed" && data.cancelled === true && event.agentId) {
            this.cancelledAgents.add(identity(sessionId, event.agentId));
            for (const scope of this.requests.values()) {
                if (scope.sessionId !== sessionId || scope.agentId !== event.agentId) continue;
                scope.cancelled = true; scope.bind(); this.ended(scope);
            }
        }
    }

    close(): void {
        this.closed = true;
        for (const scope of this.envelopes.values()) {
            scope.cancelled = true; scope.bind(); this.ended(scope);
        }
        this.envelopes.clear(); this.requests.clear(); this.workflows.clear();
        this.cancelledAgents.clear(); this.retiredRequests.clear();
    }
}
