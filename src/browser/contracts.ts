import type { DesktopEvent, DesktopPermissionMode } from "../desktop/protocol.js";

export type HostRequest = Extract<DesktopEvent, { type: "permission" | "question" }>;
export type HostPhase = "idle" | "starting" | "ready" | "stopping" | "error" | "stopped";

export interface HostSnapshot {
    revision: number;
    generation: string;
    version: string;
    phase: HostPhase;
    workspace: string | null;
    sessionId: string | null;
    canvasUrl: string | null;
    status: string;
    error: string | null;
    notice?: { id: string; message: string } | null;
    warning: string | null;
    permissionMode: DesktopPermissionMode;
    requests: HostRequest[];
    recentWorkspaces: string[];
}

export type BackendCommand =
    | { type: "shutdown" }
    | { type: "set-permission-mode"; mode: DesktopPermissionMode }
    | { type: "permission-response"; id: string; approved: boolean; allowAllForSession?: boolean }
    | { type: "question-response"; id: string; cancelled: true }
    | { type: "question-response"; id: string; answer: string };

export type HostCommand = (
    | { type: "open-workspace"; workspace: string }
    | { type: "retry" | "stop" }
    | { type: "dismiss-notice"; id: string }
    | Exclude<BackendCommand, { type: "shutdown" }>
) & { generation: string };

export interface WorkspaceListing {
    path: string;
    parent: string | null;
    directories: Array<{ name: string; path: string }>;
    truncated: boolean;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown, limit: number): value is string {
    return typeof value === "string" && value.length > 0 && value.length <= limit;
}

function choices(value: unknown): value is string[] | undefined {
    return value === undefined || (Array.isArray(value) && value.length <= 64 && value.every((choice) => text(choice, 4096)));
}

export function parseBackendEvent(value: unknown): DesktopEvent {
    if (isRecord(value)) {
        switch (value.type) {
            case "status":
                if (text(value.message, 60 * 1024)) return { type: value.type, message: value.message };
                break;
            case "error":
                if (text(value.message, 60 * 1024) && (value.notificationId === undefined || text(value.notificationId, 512))) {
                    return { type: value.type, message: value.message,
                        ...(typeof value.notificationId === "string" ? { notificationId: value.notificationId } : {}) };
                }
                break;
            case "stopped": return { type: "stopped" };
            case "ready":
                if (text(value.url, 256) && text(value.workspace, 32768) && text(value.sessionId, 512)) {
                    return { type: "ready", url: value.url, workspace: value.workspace, sessionId: value.sessionId };
                }
                break;
            case "permission-mode":
                if (value.mode === "ask" || value.mode === "allow-all") return { type: value.type, mode: value.mode };
                break;
            case "permission-resolved":
                if (text(value.id, 512)) return { type: value.type, id: value.id };
                break;
            case "permission":
                if (text(value.id, 512) && text(value.title, 1024) && text(value.details, 60 * 1024)
                    && typeof value.canAllowAllForSession === "boolean") {
                    return { type: value.type, id: value.id, title: value.title, details: value.details,
                        canAllowAllForSession: value.canAllowAllForSession };
                }
                break;
            case "question":
                if (text(value.id, 512) && text(value.question, 32 * 1024)
                    && (value.allowFreeform === undefined || typeof value.allowFreeform === "boolean")
                    && choices(value.choices)) {
                    return { type: value.type, id: value.id, question: value.question,
                        choices: value.choices, allowFreeform: typeof value.allowFreeform === "boolean" ? value.allowFreeform : undefined };
                }
        }
    }
    throw new Error("The backend returned an invalid host event.");
}
