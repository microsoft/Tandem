import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type { IncomingMessage, Server } from "node:http";
import { win32 } from "node:path";
import type { Duplex } from "node:stream";
import WebSocket, { WebSocketServer, type ClientOptions, type RawData } from "ws";
import { SpeechAuthError } from "./speech-auth.js";
import { readSketchLiveInitialContext, type SketchLiveFailureCode } from "./sketch-live-protocol.js";
import { buildSketchLiveSessionInstructions } from "./planning-prompts.js";

const endpoint = "https://cloudgpt-ins.openai.azure.com/openai/v1/";
const socketEndpoint = "wss://cloudgpt-ins.openai.azure.com/openai/v1/live/sessions";
const socketPath = "/api/sketch/live/socket";
const scope = "https://cognitiveservices.azure.com/.default";
const defaultTenant = "72f988bf-86f1-41af-91ab-2d7cd011db47";
const inboundBytes = 65_536;
const providerBytes = 262_144;
const bufferedBytes = 524_288;
const queuedBytes = 262_144;
const queuedMessages = 32;
const pendingMessages = 64;
const maximumTickets = 8;
const instructionBytes = 16_384;
const appendBytes = 500;
const audioBytes = 32_000;
const minimumTokenLifetimeMs = 30_000;
const voices = new Set([
    "marin", "alloy", "ash", "ballad", "beacon", "bossa", "cedar", "cinder", "coral", "delta", "echo",
    "gleam", "meridian", "quartz", "ripple", "sage", "shimmer", "stone", "tempo", "verse", "vesper", "willow",
]);
const providerEvents = new Set([
    "session.started",
    "session.input_transcript.delta",
    "session.output_transcript.delta",
    "session.output_audio.delta",
    "session.delegation.created",
    "session.usage.updated",
    "session.closed",
    "session.input_audio.muted",
    "session.input_audio.unmuted",
    "session.thinking.appended",
    "session.commentary.appended",
]);

export class SketchLiveError extends Error {
    constructor(message: string, public readonly statusCode: number) {
        super(message);
        this.name = "SketchLiveError";
    }
}

export interface SketchLiveAuthorization {
    identity: string;
    instructions: string;
}

export interface SketchLiveCredential {
    getToken(
        scope: string,
        options: { abortSignal: AbortSignal },
    ): Promise<{ token: string; expiresOnTimestamp: number } | null>;
}

export interface SketchLiveServerDependencies {
    env?: Readonly<Record<string, string | undefined>>;
    createCredential?: (options: { tenantId: string; processTimeoutInMs: number }) =>
        SketchLiveCredential | Promise<SketchLiveCredential>;
    createSocket?: (url: string, options: ClientOptions) => WebSocket;
    now?: () => number;
    ticketTtlMs?: number;
    startupTimeoutMs?: number;
    maxDurationMs?: number;
    authorizationIntervalMs?: number;
    authorizationTimeoutMs?: number;
    closeTimeoutMs?: number;
}

export function ensureSketchLiveAzureCliPath(
    env: NodeJS.ProcessEnv = process.env,
    platform: NodeJS.Platform = process.platform,
    exists: (path: string) => boolean = existsSync,
): void {
    if (platform !== "win32" || !env.LOCALAPPDATA) return;
    const directory = win32.join(env.LOCALAPPDATA, "Programs", "AzureCLI", "bin");
    if (!exists(win32.join(directory, "az.cmd"))) return;
    const key = Object.keys(env).find((name) => name.toLowerCase() === "path") ?? "Path";
    const current = env[key] ?? "";
    const normalized = (path: string) => win32.normalize(path.trim().replace(/^"|"$/g, "")).replace(/\\$/, "").toLowerCase();
    if (!current.split(";").some((entry) => normalized(entry) === normalized(directory))) {
        env[key] = current ? `${current};${directory}` : directory;
    }
}

function configuration(env: Readonly<Record<string, string | undefined>>) {
    if ((env.TANDEM_Live__Endpoint ?? endpoint) !== endpoint) {
        throw new SketchLiveError("TANDEM_Live__Endpoint must be the approved GPT-live HTTPS endpoint.", 503);
    }
    if ((env.TANDEM_Live__Model ?? "gpt-live-1") !== "gpt-live-1") {
        throw new SketchLiveError("TANDEM_Live__Model must be gpt-live-1.", 503);
    }
    const voice = env.TANDEM_Live__Voice ?? "marin";
    const tenantId = env.TANDEM_Live__TenantId ?? defaultTenant;
    if (!voices.has(voice)) {
        throw new SketchLiveError("TANDEM_Live__Voice must be a supported GPT-live voice name; omit it to use marin.", 503);
    }
    if (tenantId.length !== 36 || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(tenantId)) {
        throw new SketchLiveError("TANDEM_Live__TenantId must be a tenant GUID.", 503);
    }
    return { voice, tenantId };
}

function canonicalOrigin(value: string): URL {
    try {
        const url = new URL(value);
        if (!["http:", "https:"].includes(url.protocol) || value !== url.origin) throw new Error();
        return url;
    } catch {
        throw new SketchLiveError("The live sketch origin is not configured correctly.", 500);
    }
}

function validUpgrade(request: IncomingMessage, expectedOrigin: string): string | undefined {
    const origin = canonicalOrigin(expectedOrigin);
    for (const name of ["host", "origin", "sec-fetch-site", "sec-websocket-protocol"]) {
        const value = request.headers[name];
        const occurrences = request.rawHeaders.filter((header, index) =>
            index % 2 === 0 && header.toLowerCase() === name).length;
        if (occurrences > 1 || Array.isArray(value) || (value !== undefined && /[\r\n\0]/.test(value))) return;
    }
    if (request.method !== "GET" || request.headers.host !== origin.host
        || request.headers.origin !== expectedOrigin || request.headers["sec-websocket-protocol"] !== undefined
        || (request.headers["sec-fetch-site"] !== undefined && request.headers["sec-fetch-site"] !== "same-origin")) return;
    return /^\/api\/sketch\/live\/socket\?ticket=([A-Za-z0-9_-]{43})$/.exec(request.url ?? "")?.[1];
}

function rejectUpgrade(socket: Duplex, status: number): void {
    if (socket.destroyed) return;
    socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nCache-Control: no-store\r\nContent-Length: 0\r\n\r\n`);
    socket.destroy();
}

function limited<T>(operation: () => Promise<T>, signal: AbortSignal, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const fail = () => { cleanup(); reject(new Error("Live sketch operation did not complete.")); };
        const timer = setTimeout(fail, timeoutMs);
        const cleanup = () => { clearTimeout(timer); signal.removeEventListener("abort", fail); };
        signal.addEventListener("abort", fail, { once: true });
        Promise.resolve().then(() => { signal.throwIfAborted(); return operation(); }).then(
            (value) => { cleanup(); resolve(value); },
            (error) => { cleanup(); reject(error); },
        );
    });
}

function record(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseMessage(data: RawData, isBinary: boolean, maximum: number): { text: string; event: Record<string, unknown> } {
    const buffer = Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (isBinary || buffer.byteLength > maximum) throw new Error();
    const text = buffer.toString("utf8");
    const event: unknown = JSON.parse(text);
    if (!record(event) || typeof event.type !== "string") throw new Error();
    return { text, event };
}

function clientCommand(event: Record<string, unknown>): string {
    const type = event.type;
    const fields = ["type", "event_id"];
    if (type === "session.input_audio.append") {
        fields.push("audio");
        const audio = event.audio;
        if (typeof audio !== "string" || !audio.length || audio.length > Math.ceil(audioBytes / 3) * 4
            || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(audio)) throw new Error();
        const bytes = Buffer.from(audio, "base64");
        if (!bytes.length || bytes.length % 2 || bytes.length > audioBytes || bytes.toString("base64") !== audio) throw new Error();
    } else if (type === "session.thinking.append" || type === "session.commentary.append") {
        fields.push("content", "delegation_id");
        if (typeof event.content !== "string" || Buffer.byteLength(event.content, "utf8") > appendBytes) throw new Error();
        if (typeof event.delegation_id !== "string"
            || !/^[A-Za-z0-9_.:-]{1,256}$/.test(event.delegation_id) || /[\r\n]/.test(event.delegation_id)) throw new Error();
    } else if (!["session.input_audio.mute", "session.input_audio.unmute", "session.close"].includes(type as string)) {
        throw new Error();
    }
    if (Object.keys(event).some((key) => !fields.includes(key))) throw new Error();
    if (event.event_id !== undefined && (typeof event.event_id !== "string"
        || !/^[A-Za-z0-9_-]{1,128}$/.test(event.event_id) || /[\r\n]/.test(event.event_id))) throw new Error();
    return JSON.stringify({ ...event, event_id: event.event_id ?? randomUUID() });
}

export function attachSketchLiveServer(
    server: Server,
    options: { origin: () => string; authorize: () => Promise<SketchLiveAuthorization>; onFailure?: (code: SketchLiveFailureCode) => void },
    dependencies: SketchLiveServerDependencies = {},
): {
    issueTicket(context?: unknown): Promise<{ ticket: string; path: string; maxDurationSeconds: number }>;
    close(): void;
} {
    const env = dependencies.env ?? process.env;
    const now = dependencies.now ?? Date.now;
    const ticketTtlMs = dependencies.ticketTtlMs ?? 30_000;
    const startupTimeoutMs = dependencies.startupTimeoutMs ?? 20_000;
    const maxDurationMs = dependencies.maxDurationMs ?? 600_000;
    const authorizationIntervalMs = dependencies.authorizationIntervalMs ?? 1_000;
    const authorizationTimeoutMs = dependencies.authorizationTimeoutMs ?? 5_000;
    const closeTimeoutMs = dependencies.closeTimeoutMs ?? 250;
    for (const value of [ticketTtlMs, startupTimeoutMs, maxDurationMs, authorizationIntervalMs, authorizationTimeoutMs, closeTimeoutMs]) {
        if (!Number.isSafeInteger(value) || value <= 0) throw new SketchLiveError("Invalid live sketch transport limits.", 500);
    }
    const createCredential = dependencies.createCredential ?? (async (credentialOptions) => {
        ensureSketchLiveAzureCliPath();
        const { AzureCliCredential } = await import("@azure/identity");
        return new AzureCliCredential(credentialOptions);
    });
    const createSocket = dependencies.createSocket ?? ((url, socketOptions) => new WebSocket(url, socketOptions));
    const tickets = new Map<string, { identity: string; origin: string; expiresAt: number; context: string[] }>();
    const ticketRequests = new Set<AbortController>();
    const closingClients = new Map<WebSocket, ReturnType<typeof setTimeout>>();
    const sockets = new WebSocketServer({ noServer: true, clientTracking: false, maxPayload: inboundBytes, perMessageDeflate: false });
    let closed = false;
    let active: { finish: (message?: string, status?: number) => void } | undefined;

    async function authorize(signal: AbortSignal): Promise<SketchLiveAuthorization> {
        try {
            const auth = await limited(() => options.authorize(), signal, authorizationTimeoutMs);
            if (!auth || typeof auth.identity !== "string" || !auth.identity.length || auth.identity.length > 4_096
                || typeof auth.instructions !== "string" || Buffer.byteLength(auth.instructions, "utf8") > instructionBytes) throw new Error();
            return auth;
        } catch (error) {
            if (error instanceof SpeechAuthError && [403, 409].includes(error.statusCode)) throw error;
            throw new SketchLiveError("Live sketch access is no longer available.", 403);
        }
    }

    function closeClient(client: WebSocket, message?: string, code?: SketchLiveFailureCode): void {
        if (client.readyState === WebSocket.CLOSED) return;
        try {
            if (message && client.readyState === WebSocket.OPEN && client.bufferedAmount < bufferedBytes - 1_024) {
                client.send(JSON.stringify({ type: "tandem.live.error", message, code }), { compress: false });
            }
            client.close(message ? 1008 : 1000, "Live sketch session ended.");
            const timer = setTimeout(() => { closingClients.delete(client); client.terminate(); }, closeTimeoutMs);
            timer.unref();
            closingClients.set(client, timer);
            client.once("close", () => { clearTimeout(timer); closingClients.delete(client); });
        } catch {
            client.terminate();
        }
    }

    function upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
        let ticket: string | undefined;
        let origin: string;
        try {
            origin = options.origin();
            ticket = validUpgrade(request, origin);
        } catch {
            rejectUpgrade(socket, 403);
            return;
        }
        if (closed || !ticket) { rejectUpgrade(socket, 403); return; }
        const grant = tickets.get(ticket);
        if (!grant || grant.expiresAt <= now() || grant.origin !== origin) {
            if (grant) tickets.delete(ticket);
            rejectUpgrade(socket, 403);
            return;
        }
        if (active) { rejectUpgrade(socket, 409); return; }
        tickets.delete(ticket);
        const { identity, origin: ticketOrigin, context } = grant;
        const controller = new AbortController();
        const queue: string[] = [];
        let queueSize = 0;
        let client: WebSocket | undefined;
        let upstream: WebSocket | undefined;
        let finished = false;
        let started = false;
        let stopping = false;
        let checking = false;
        let durationTimer: ReturnType<typeof setTimeout> | undefined;
        let checkTimer: ReturnType<typeof setInterval> | undefined;
        let stopTimer: ReturnType<typeof setTimeout> | undefined;
        const startupTimer = setTimeout(() => finish("Live sketch startup timed out.", 504, "startup_timeout"), startupTimeoutMs);
        const reservation = { finish };
        // Reserve synchronously: concurrent upgrades must not race through authorize/getToken.
        active = reservation;

        function finish(message?: string, status = 403, code: SketchLiveFailureCode = "provider_failed"): void {
            if (finished) return;
            finished = true;
            controller.abort();
            clearTimeout(startupTimer);
            clearTimeout(durationTimer);
            clearTimeout(stopTimer);
            clearInterval(checkTimer);
            queue.length = 0;
            queueSize = 0;
            upstream?.terminate();
            if (client) closeClient(client, message, code);
            else rejectUpgrade(socket, status);
            if (active === reservation) active = undefined;
            if (message) options.onFailure?.(code);
        }

        socket.once("close", () => finish());
        socket.once("error", () => finish("The live sketch connection ended."));
        const pending = new Map<WebSocket, { bytes: number; count: number }>();
        function send(target: WebSocket, text: string, sent?: () => void): boolean {
            if (finished || target.readyState !== WebSocket.OPEN) return false;
            const bytes = Buffer.byteLength(text, "utf8");
            const count = pending.get(target) ?? { bytes: 0, count: 0 };
            if (target.bufferedAmount + bytes > bufferedBytes || count.bytes + bytes > bufferedBytes || count.count >= pendingMessages) {
                finish("Live sketch traffic exceeded its buffer limit.");
                return false;
            }
            pending.set(target, count);
            count.bytes += bytes;
            count.count++;
            try {
                target.send(text, { binary: false, compress: false }, (error) => {
                    count.bytes -= bytes;
                    count.count--;
                    if (error) finish("The live sketch connection ended.");
                    else if (!finished) sent?.();
                });
                return true;
            } catch {
                finish("The live sketch connection ended.");
                return false;
            }
        }

        function receiveClient(data: RawData, binary: boolean): void {
            if (finished || stopping) return;
            let text: string;
            let event: Record<string, unknown>;
            try {
                ({ event } = parseMessage(data, binary, inboundBytes));
                if (["session.thinking.append", "session.commentary.append"].includes(String(event.type))
                    && !event.delegation_id) {
                    finish("A GPT-live context command requires its delegation ID.", 400, "delegation_required");
                    return;
                }
                text = clientCommand(event);
            } catch {
                finish("The live sketch command is invalid or too large.", 400, "invalid_command");
                return;
            }
            if (event.type === "session.close") {
                stopping = true;
                stopTimer = setTimeout(() => finish(), closeTimeoutMs);
                if (!upstream || !send(upstream, text, () => finish())) finish();
            } else if (started && upstream) {
                send(upstream, text);
            } else if (queue.length >= queuedMessages || queueSize + Buffer.byteLength(text, "utf8") > queuedBytes) {
                finish("Live sketch traffic exceeded its startup queue limit.");
            } else {
                queue.push(text);
                queueSize += Buffer.byteLength(text, "utf8");
            }
        }

        function receiveProvider(data: RawData, binary: boolean): void {
            if (finished || stopping) return;
            let text: string;
            let event: Record<string, unknown>;
            try {
                ({ text, event } = parseMessage(data, binary, providerBytes));
            } catch {
                finish("The GPT-live service returned an invalid response.", 502, "protocol_rejected");
                return;
            }
            if (!providerEvents.has(event.type as string) || event.error != null || event.errors != null) {
                const missingDelegation = record(event.error) && event.error.code === "missing_required_parameter"
                    && event.error.param === "delegation_id";
                finish("The GPT-live service rejected a protocol message.", 502,
                    missingDelegation ? "delegation_required" : "protocol_rejected");
                return;
            }
            if (event.type === "session.started") {
                if (started) { finish("The GPT-live service returned an invalid response."); return; }
                started = true;
                clearTimeout(startupTimer);
            }
            if (!client || !send(client, text)) return;
            if (event.type === "session.closed") {
                finish();
            } else if (event.type === "session.started") {
                for (const command of queue) {
                    if (!upstream || !send(upstream, command)) break;
                }
                queue.length = 0;
                queueSize = 0;
            }
        }

        async function checkAuthorization(): Promise<void> {
            if (finished || checking) return;
            checking = true;
            try {
                const auth = await authorize(controller.signal);
                if (!finished && (auth.identity !== identity || options.origin() !== ticketOrigin)) {
                    finish("Live sketch access changed. Start a new session.");
                }
            } catch {
                if (!finished) finish("Live sketch access is no longer available.");
            } finally {
                checking = false;
            }
        }

        async function connect(): Promise<void> {
            let auth: SketchLiveAuthorization;
            let config: ReturnType<typeof configuration>;
            try {
                config = configuration(env);
                auth = await authorize(controller.signal);
                if (finished) return;
                if (auth.identity !== identity || options.origin() !== ticketOrigin) {
                    finish("Live sketch access changed. Start a new session.");
                    return;
                }
            } catch {
                finish("Live sketch access or configuration is unavailable.");
                return;
            }
            if (socket.destroyed || finished) { finish(); return; }
            try {
                sockets.handleUpgrade(request, socket, head, (connected) => { client = connected; });
            } catch {
                finish("The live sketch connection could not be opened.");
                return;
            }
            if (!client) { finish(); return; }
            client.on("message", receiveClient);
            client.on("error", () => finish("The live sketch command is invalid or too large."));
            client.once("close", () => finish());
            checkTimer = setInterval(() => { void checkAuthorization(); }, authorizationIntervalMs);
            durationTimer = setTimeout(() => finish("The live sketch session reached its time limit."), maxDurationMs);

            try {
                const credential = await createCredential({ tenantId: config.tenantId, processTimeoutInMs: startupTimeoutMs });
                if (finished) return;
                const accessToken = await credential.getToken(scope, { abortSignal: controller.signal });
                if (finished) return;
                if (!accessToken || typeof accessToken.token !== "string" || accessToken.token.length > 32_768
                    || !/^[A-Za-z0-9._~+/-]+=*$/.test(accessToken.token) || /[\r\n]/.test(accessToken.token)
                    || !Number.isFinite(accessToken.expiresOnTimestamp)
                    || accessToken.expiresOnTimestamp < now() + minimumTokenLifetimeMs) throw new Error();
                const current = await authorize(controller.signal);
                if (finished) return;
                if (current.identity !== identity || options.origin() !== ticketOrigin) {
                    finish("Live sketch access changed. Start a new session.");
                    return;
                }
                auth = current;
                auth = { ...auth, instructions: buildSketchLiveSessionInstructions(auth.instructions, context) };
                if (Buffer.byteLength(auth.instructions, "utf8") > instructionBytes) {
                    finish("Initial sketch context exceeds the GPT-live instruction limit.", 400, "invalid_command");
                    return;
                }
                const remainingTokenLifetime = accessToken.expiresOnTimestamp - now();
                if (remainingTokenLifetime < minimumTokenLifetimeMs) throw new Error();
                clearTimeout(durationTimer);
                const lifetime = Math.min(maxDurationMs, remainingTokenLifetime);
                durationTimer = setTimeout(() => finish("The live sketch session reached its time limit."), lifetime);
                upstream = createSocket(socketEndpoint, {
                    headers: { Authorization: `Bearer ${accessToken.token}` },
                    handshakeTimeout: startupTimeoutMs,
                    followRedirects: false,
                    perMessageDeflate: false,
                    maxPayload: providerBytes,
                });
            } catch {
                finish("GPT-live authentication or connection failed. Sign in with Azure CLI in the configured tenant and retry.",
                    503, "authentication_failed");
                return;
            }
            if (finished) { upstream.terminate(); return; }
            upstream.on("unexpected-response", (_request, response) => {
                const codes: Partial<Record<number, SketchLiveFailureCode>> = {
                    401: "unauthorized", 403: "access_denied", 404: "route_unavailable", 429: "throttled",
                };
                response.resume();
                finish("The GPT-live service rejected the WebSocket handshake.", 502,
                    codes[response.statusCode ?? 0] ?? "transport_failed");
            });
            upstream.on("error", () => finish("The GPT-live service connection failed.", 502, "transport_failed"));
            upstream.once("close", () => finish("The GPT-live service connection ended."));
            upstream.on("message", receiveProvider);
            let opened = false;
            const open = () => {
                if (finished || opened) return;
                opened = true;
                send(upstream!, JSON.stringify({
                    type: "session.start",
                    event_id: randomUUID(),
                    session: {
                        model: "gpt-live-1",
                        instructions: auth.instructions,
                        audio: { format: { type: "audio/pcm", rate: 16_000 }, output: { voice: config.voice } },
                        delegation: { type: "client" },
                        store: false,
                    },
                }));
            };
            upstream.once("open", open);
            if (upstream.readyState === WebSocket.OPEN) open();
            else if (upstream.readyState !== WebSocket.CONNECTING) finish("The GPT-live service connection failed.");
        }
        void connect();
    }

    async function issueTicket(initialContext: unknown = []): Promise<{ ticket: string; path: string; maxDurationSeconds: number }> {
        if (closed) throw new SketchLiveError("The live sketch server is closed.", 503);
        if (active) throw new SketchLiveError("A live sketch session is already active.", 409);
        configuration(env);
        let context: string[];
        try { context = readSketchLiveInitialContext(initialContext); }
        catch { throw new SketchLiveError("Supply bounded initial sketch context records.", 400); }
        const origin = options.origin();
        canonicalOrigin(origin);
        for (const [ticket, grant] of tickets) if (grant.expiresAt <= now()) tickets.delete(ticket);
        if (tickets.size + ticketRequests.size >= maximumTickets) {
            throw new SketchLiveError("Too many live sketch tickets. Wait briefly before trying again.", 429);
        }
        const controller = new AbortController();
        ticketRequests.add(controller);
        try {
            const auth = await authorize(controller.signal);
            if (Buffer.byteLength(buildSketchLiveSessionInstructions(auth.instructions, context), "utf8") > instructionBytes) {
                throw new SketchLiveError("Initial sketch context exceeds the GPT-live instruction limit.", 400);
            }
            if (closed || controller.signal.aborted) throw new SketchLiveError("The live sketch server is closed.", 503);
            if (active) throw new SketchLiveError("A live sketch session is already active.", 409);
            const ticket = randomBytes(32).toString("base64url");
            tickets.set(ticket, { identity: auth.identity, origin, expiresAt: now() + ticketTtlMs, context });
            return { ticket, path: socketPath, maxDurationSeconds: Math.ceil(maxDurationMs / 1_000) };
        } finally {
            ticketRequests.delete(controller);
        }
    }

    function close(): void {
        if (closed) return;
        closed = true;
        server.off("upgrade", upgrade);
        server.off("close", close);
        tickets.clear();
        for (const controller of ticketRequests) controller.abort();
        ticketRequests.clear();
        active?.finish();
        for (const [client, timer] of closingClients) { clearTimeout(timer); client.terminate(); }
        closingClients.clear();
        sockets.close();
    }
    server.on("upgrade", upgrade);
    server.once("close", close);
    return { issueTicket, close };
}
