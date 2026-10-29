import { isRecord, parseBackendEvent, type HostCommand, type HostPhase, type HostSnapshot, type WorkspaceListing } from "./contracts.js";
import { redactDiagnostic } from "./diagnostics.js";

interface ClientSnapshot {
    host: HostSnapshot | null;
    connected: boolean;
    error: string | null;
}

function nullableText(value: unknown): string | null {
    if (value === null) return null;
    if (typeof value === "string") return value;
    throw new Error("The host returned an invalid text field.");
}

function parseNotice(value: unknown): HostSnapshot["notice"] {
    if (value == null) return null;
    if (!isRecord(value) || typeof value.id !== "string" || !value.id || value.id.length > 512
        || typeof value.message !== "string" || value.message.length > 8192) throw new Error("The host returned an invalid notification.");
    return { id: value.id, message: value.message };
}

function parseDirectories(value: unknown): WorkspaceListing {
    if (!isRecord(value) || typeof value.path !== "string" || (value.parent !== null && typeof value.parent !== "string")
        || typeof value.truncated !== "boolean" || !Array.isArray(value.directories)) {
        throw new Error("The host returned an invalid folder listing.");
    }
    return { path: value.path, parent: nullableText(value.parent), truncated: value.truncated, directories: value.directories.map((entry) => {
        if (!isRecord(entry) || typeof entry.name !== "string" || typeof entry.path !== "string") throw new Error("Invalid folder entry.");
        return { name: entry.name, path: entry.path };
    }) };
}

export function readLaunchCapability(location: Location, storage: Storage, history: History): string {
    const match = /^#token=([A-Za-z0-9_-]{43})$/.exec(location.hash);
    if (location.hash) history.replaceState(null, "", location.pathname);
    if (match) storage.setItem("tandem-host-capability", match[1]);
    const token = match?.[1] || storage.getItem("tandem-host-capability");
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
        throw new Error("Open the private launch URL printed in the Tandem terminal. This tab has no host access.");
    }
    return token;
}

export function parseHostSnapshot(value: unknown): HostSnapshot {
    const isPhase = (value: unknown): value is HostPhase => typeof value === "string"
        && ["idle", "starting", "ready", "stopping", "error", "stopped"].includes(value);
    if (!isRecord(value) || typeof value.revision !== "number" || !Number.isSafeInteger(value.revision) || typeof value.generation !== "string"
        || typeof value.version !== "string" || typeof value.status !== "string"
        || (value.statusKind !== undefined && value.statusKind !== "ready" && value.statusKind !== "message")
        || !isPhase(value.phase)
        || (value.permissionMode !== "ask" && value.permissionMode !== "allow-all")
        || !["workspace", "sessionId", "canvasUrl", "error", "warning"].every((key) => value[key] === null || typeof value[key] === "string")
        || !Array.isArray(value.requests) || value.requests.length > 16
        || !Array.isArray(value.recentWorkspaces) || !value.recentWorkspaces.every((path) => typeof path === "string")) {
        throw new Error("The host returned an invalid state. Restart Tandem with a matching package.");
    }
    const requests = value.requests.map((request) => {
        const event = parseBackendEvent(request);
        if (event.type !== "permission" && event.type !== "question") throw new Error("The host returned an invalid pending request.");
        return event;
    });
    if (value.canvasUrl) {
        const url = new URL(String(value.canvasUrl));
        if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || Number(url.port) <= 0 || url.pathname !== "/"
            || url.username || url.password || url.search || url.hash) throw new Error("The host returned an unsafe application URL.");
    }
    return { revision: value.revision, generation: value.generation, version: value.version, phase: value.phase,
        permissionMode: value.permissionMode, status: value.status,
        statusKind: value.statusKind === "ready" || value.statusKind === "message" ? value.statusKind : undefined,
        requests, recentWorkspaces: value.recentWorkspaces,
        workspace: nullableText(value.workspace), sessionId: nullableText(value.sessionId), canvasUrl: nullableText(value.canvasUrl),
        error: nullableText(value.error), warning: nullableText(value.warning),
        notice: parseNotice(value.notice) };
}

export class BrowserStore {
    private state: ClientSnapshot = { host: null, connected: false, error: null };
    private readonly listeners = new Set<() => void>();
    private readonly diagnosticsByGeneration = new Map<string, string[]>();
    constructor(private readonly token: string, private readonly fetcher: typeof fetch = (input, init) => fetch(input, init)) {}
    getSnapshot = (): ClientSnapshot => this.state;
    subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
    private publish(next: ClientSnapshot) {
        this.state = next;
        for (const listener of this.listeners) listener();
    }
    accept(value: unknown): void {
        const host = parseHostSnapshot(value);
        if (this.state.host && host.revision < this.state.host.revision) return;
        this.publish({ host, connected: host.phase !== "stopped", error: null });
    }
    private async request(path: string, options: RequestInit = {}): Promise<Response> {
        const response = await this.fetcher(path, { ...options, cache: "no-store",
            headers: { ...options.headers, Authorization: `Bearer ${this.token}` } });
        if (!response.ok) {
            const body: unknown = await response.json();
            const message = isRecord(body) && typeof body.error === "string" ? body.error : "The host request failed.";
            throw Object.assign(new Error(message), { status: response.status });
        }
        return response;
    }
    async command(command: HostCommand): Promise<void> {
        const response = await this.request("/host/command", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command),
            signal: AbortSignal.timeout(15_000),
        });
        this.accept(await response.json());
    }
    async directories(path?: string): Promise<WorkspaceListing> {
        const response = await this.request(`/host/directories${path === undefined ? "" : `?path=${encodeURIComponent(path)}`}`,
            { signal: AbortSignal.timeout(15_000) });
        return parseDirectories(await response.json());
    }
    async createDirectory(generation: string, parent: string, name: string): Promise<WorkspaceListing> {
        const response = await this.request("/host/directories", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ generation, parent, name }), signal: AbortSignal.timeout(15_000),
        });
        return parseDirectories(await response.json());
    }
    async diagnostics(): Promise<string> {
        const generation = this.state.host?.generation || "";
        const response = await this.request("/host/diagnostics", { signal: AbortSignal.timeout(15_000) });
        const value: unknown = await response.json();
        if (!isRecord(value) || typeof value.text !== "string") throw new Error("The host returned invalid diagnostics.");
        const local = this.diagnosticsByGeneration.get(generation) || [];
        return [value.text, ...local].filter(Boolean).join("\n");
    }
    recordError(generation: string, message: string): void {
        message = redactDiagnostic(message);
        console.error("Tandem browser action failed:", message);
        const lines = this.diagnosticsByGeneration.get(generation) || [];
        this.diagnosticsByGeneration.set(generation, [...lines.slice(-19), `${new Date().toISOString()} Browser: ${message}`]);
        for (const key of this.diagnosticsByGeneration.keys()) if (key !== generation) this.diagnosticsByGeneration.delete(key);
    }
    connect(): () => void {
        const controller = new AbortController();
        const signal = controller.signal;
        const run = async () => {
            while (!signal.aborted) {
                try {
                    const response = await this.request("/host/events", { signal });
                    if (!response.body) throw new Error("Streaming host updates are unavailable in this browser.");
                    const reader = response.body.getReader();
                    const decoder = new TextDecoder();
                    let buffered = "";
                    try {
                        for (;;) {
                            const next = await reader.read();
                            if (next.done) break;
                            buffered += decoder.decode(next.value, { stream: true });
                            if (buffered.length > 2 * 1024 * 1024) throw new Error("The host update exceeded its size limit.");
                            let index: number;
                            while ((index = buffered.indexOf("\n\n")) >= 0) {
                                const message = buffered.slice(0, index);
                                buffered = buffered.slice(index + 2);
                                if (message.startsWith("data: ")) this.accept(JSON.parse(message.slice(6)));
                            }
                        }
                    } finally { await reader.cancel(); }
                    if (this.state.host?.phase === "stopped") return;
                    throw new Error("Host connection interrupted. The backend is not stopped by closing a tab. Reconnecting...");
                } catch (error) {
                    if (signal.aborted) return;
                    this.publish({ ...this.state, connected: false, error: error instanceof Error ? error.message : String(error) });
                    if (isRecord(error) && error.status === 401) return;
                    await new Promise<void>((resolve) => {
                        const done = () => { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); };
                        const timer = setTimeout(done, 1500);
                        signal.addEventListener("abort", done, { once: true });
                    });
                }
            }
        };
        void run();
        return () => controller.abort();
    }
}
