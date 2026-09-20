import { randomUUID } from "node:crypto";
import { createInterface, type Interface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { approveAll, type PermissionHandler, type PermissionRequest, type PermissionRequestResult, type SessionConfig } from "@github/copilot-sdk";

type UserInputHandler = NonNullable<SessionConfig["onUserInputRequest"]>;
type UserInputRequest = Parameters<UserInputHandler>[0];
type UserInputResponse = Awaited<ReturnType<UserInputHandler>>;

export type DesktopEvent =
    | { type: "status" | "error"; message: string }
    | { type: "ready"; url: string; workspace: string; sessionId: string }
    | { type: "permission"; id: string; title: string; details: string }
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
    }>();
    private closed = false;

    constructor(private readonly input: Readable, private readonly output: Writable, private readonly onShutdown: () => void) {
        this.reader = createInterface({ input, crlfDelay: Infinity });
        this.reader.on("line", (line) => this.receive(line));
        this.reader.on("close", () => { this.close(); this.onShutdown(); });
    }

    send(event: DesktopEvent): void {
        if (!this.closed) this.output.write(`${JSON.stringify(event)}\n`);
    }

    get waitingForInput(): boolean { return !this.closed && this.pending.size > 0; }

    private receive(line: string): void {
        try {
            if (line.length > 64 * 1024) throw new Error("Desktop command exceeds the size limit.");
            const command: unknown = JSON.parse(line);
            if (!command || typeof command !== "object" || !("type" in command)) throw new Error("Invalid desktop command.");
            const value = command as Reply;
            if (value.type === "shutdown") { this.onShutdown(); return; }
            if (typeof value.id !== "string") throw new Error("Desktop response is missing its request ID.");
            const request = this.pending.get(value.id);
            if (!request || request.type !== value.type) throw new Error("Desktop response does not match a pending request.");
            this.pending.delete(value.id);
            request.resolve(value);
        } catch (error) {
            this.send({ type: "error", message: error instanceof Error ? error.message : "Invalid desktop command." });
        }
    }

    private ask(event: DesktopEvent & { id: string }, responseType: string): Promise<Reply> {
        if (this.closed) return Promise.reject(new Error("The desktop window is closed."));
        return new Promise((resolve, reject) => {
            this.pending.set(event.id, { type: responseType, resolve, reject });
            this.send(event);
        });
    }

    async permission(request: PermissionRequest, invocation: Parameters<PermissionHandler>[1]): Promise<Awaited<ReturnType<PermissionHandler>>> {
        if (this.closed) throw new Error("The desktop window is closed.");
        if (invocation.managedSettingsEnabled) return this.rejectManagedPermission();
        const result = await approveAll(request, invocation);
        if (this.closed) return { kind: "reject" };
        // There is no second client to answer requests the SDK cannot automatically approve.
        return result.kind === "no-result" ? this.rejectManagedPermission() : result;
    }

    private rejectManagedPermission(): PermissionRequestResult {
        const feedback = "Copilot managed policy prevents automatic approval. Tool-approval dialogs are disabled in Tandem Desktop.";
        this.send({ type: "error", message: feedback });
        return { kind: "reject", feedback };
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
        for (const request of this.pending.values()) request.reject(new Error("The desktop window is closing."));
        this.pending.clear();
        this.reader.close();
        this.input.destroy();
    }
}
