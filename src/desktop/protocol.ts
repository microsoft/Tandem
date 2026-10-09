import { randomUUID } from "node:crypto";
import { createInterface, type Interface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { approveAll, type PermissionHandler, type PermissionRequest, type SessionConfig } from "@github/copilot-sdk";

type UserInputHandler = NonNullable<SessionConfig["onUserInputRequest"]>;
type UserInputRequest = Parameters<UserInputHandler>[0];
type UserInputResponse = Awaited<ReturnType<UserInputHandler>>;

export type DesktopPermissionMode = "ask" | "allow-all";

export type DesktopEvent =
    | { type: "status" | "error"; message: string }
    | { type: "ready"; url: string; workspace: string; sessionId: string }
    | { type: "permission"; id: string; title: string; details: string; canAllowAllForSession: boolean }
    | { type: "permission-mode"; mode: DesktopPermissionMode }
    | { type: "permission-resolved"; id: string }
    | { type: "question"; id: string; question: string; choices?: string[]; allowFreeform?: boolean }
    | { type: "stopped" };

type Reply = Record<string, unknown>;

export function validateDesktopUrl(value: string): URL {
    const url = new URL(value);
    if (value.trim() !== value || /[\r\n\t]/.test(value) ||
        url.protocol !== "http:" || url.hostname !== "127.0.0.1" || Number(url.port) <= 0 ||
        url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
        throw new Error("Tandem returned an invalid local application URL.");
    }
    return url;
}

export class DesktopProtocol {
    private readonly reader: Interface;
    private readonly pending = new Map<string, {
        type: string; resolve(value: Reply): void; reject(error: Error): void;
        canAutoApprove: boolean;
    }>();
    private closed = false;
    private mode: DesktopPermissionMode = "ask";

    constructor(private readonly input: Readable, private readonly output: Writable, private readonly onShutdown: () => void) {
        this.reader = createInterface({ input, crlfDelay: Infinity });
        this.reader.on("line", (line) => this.receive(line));
        this.reader.on("close", () => { this.close(); this.onShutdown(); });
    }

    send(event: DesktopEvent): void {
        if (!this.closed) this.output.write(`${JSON.stringify(event)}\n`);
    }

    get waitingForInput(): boolean { return !this.closed && this.pending.size > 0; }
    get permissionMode(): DesktopPermissionMode { return this.mode; }

    private receive(line: string): void {
        try {
            if (line.length > 64 * 1024) throw new Error("Desktop command exceeds the size limit.");
            const command: unknown = JSON.parse(line);
            if (!command || typeof command !== "object" || !("type" in command)) throw new Error("Invalid desktop command.");
            const value = command as Reply;
            if (value.type === "shutdown") { this.onShutdown(); return; }
            if (value.type === "set-permission-mode") {
                if (value.mode !== "ask" && value.mode !== "allow-all") throw new Error("Invalid desktop permission mode.");
                this.setPermissionMode(value.mode);
                return;
            }
            if (typeof value.id !== "string") throw new Error("Desktop response is missing its request ID.");
            const request = this.pending.get(value.id);
            if (!request || request.type !== value.type) throw new Error("Desktop response does not match a pending request.");
            if (value.type === "permission-response") {
                if (typeof value.approved !== "boolean" ||
                    (value.allowAllForSession !== undefined && typeof value.allowAllForSession !== "boolean")) {
                    throw new Error("Invalid desktop permission response.");
                }
                if (value.allowAllForSession === true && (!value.approved || !request.canAutoApprove)) {
                    throw new Error("This request cannot enable automatic approvals.");
                }
            }
            this.pending.delete(value.id);
            if (value.type === "permission-response" && value.allowAllForSession === true) this.setPermissionMode("allow-all");
            request.resolve({ ...value, approvedInteractively: true });
        } catch (error) {
            this.send({ type: "error", message: error instanceof Error ? error.message : "Invalid desktop command." });
        }
    }

    private setPermissionMode(mode: DesktopPermissionMode): void {
        this.mode = mode;
        this.send({ type: "permission-mode", mode });
        if (mode !== "allow-all") return;
        for (const [id, request] of this.pending) {
            if (request.type !== "permission-response" || !request.canAutoApprove) continue;
            this.pending.delete(id);
            this.send({ type: "permission-resolved", id });
            request.resolve({ approved: true, approvedInteractively: false });
        }
    }

    private ask(event: DesktopEvent & { id: string }, responseType: string, canAutoApprove = false): Promise<Reply> {
        if (this.closed) return Promise.reject(new Error("The desktop window is closed."));
        return new Promise((resolve, reject) => {
            this.pending.set(event.id, { type: responseType, resolve, reject, canAutoApprove });
            this.send(event);
        });
    }

    async permission(request: PermissionRequest, invocation: Parameters<PermissionHandler>[1]): Promise<Awaited<ReturnType<PermissionHandler>>> {
        if (this.closed) throw new Error("The desktop window is closed.");
        const managed = invocation.managedSettingsEnabled || request.managedApprovalRequired;
        const bypass = "requestSandboxBypass" in request && request.requestSandboxBypass;
        let canAutoApprove = !managed && !bypass && request.kind !== "extension-env-access";
        for (;;) {
            if (this.closed) return { kind: "reject" };
            if (this.mode === "allow-all" && canAutoApprove) {
                const result = await approveAll(request, invocation);
                if (this.closed) return { kind: "reject" };
                if (result.kind === "no-result") canAutoApprove = false;
                else if (this.mode === "allow-all") return result;
            }
            const event: Extract<DesktopEvent, { type: "permission" }> = {
                type: "permission", id: randomUUID(), title: `Allow ${request.kind} action?`,
                details: [
                    managed ? "Managed policy requires an explicit decision for this request." : "",
                    bypass ? "This action requests access outside the sandbox. Review the elevated risk before allowing it." : "",
                    JSON.stringify(request, null, 2),
                ].filter(Boolean).join("\n\n"),
                canAllowAllForSession: canAutoApprove,
            };
            if (JSON.stringify(event).length > 60 * 1024) {
                const feedback = "Tool permission details are too large to display safely. The action was not approved.";
                this.send({ type: "error", message: feedback });
                return { kind: "reject", feedback };
            }
            const reply = await this.ask(event, "permission-response", canAutoApprove);
            if (this.closed || reply.approved !== true) return { kind: "reject" };
            if (reply.approvedInteractively === true) return { kind: "approve-once", approvedInteractively: true };
            // A mode change released this prompt; recheck it before automatic approval.
        }
    }

    async question(request: UserInputRequest): Promise<UserInputResponse> {
        const reply = await this.ask({ type: "question", id: randomUUID(), ...request }, "question-response");
        if (reply.cancelled === true) throw new Error("The user cancelled the question.");
        if (typeof reply.answer !== "string" || !reply.answer.trim()) throw new Error("An answer is required.");
        const wasFreeform = !request.choices?.includes(reply.answer);
        if (wasFreeform && request.allowFreeform === false) throw new Error("Select one of the offered answers.");
        return { answer: reply.answer, wasFreeform };
    }

    close(): void {
        if (this.closed) return;
        this.closed = true;
        for (const request of this.pending.values()) {
            if (request.type === "permission-response") request.resolve({ approved: false });
            else request.reject(new Error("The desktop window is closing."));
        }
        this.pending.clear();
        this.reader.close();
        this.input.destroy();
    }
}
