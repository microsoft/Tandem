import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { canvasRequestAllowed, readJsonRequest, sendJsonResponse } from "../canvas-transport.js";
import { validateDesktopUrl, type DesktopEvent } from "../desktop/protocol.js";
import type { DesktopModelSelection } from "../desktop/runtime.js";
import { startBackend, type Backend, type BackendFactory } from "./backend.js";
import type { BackendCommand, HostSnapshot } from "./contracts.js";
import {
    createWorkspaceDirectory, errorMessage, HostDiagnostics, listWorkspaceDirectories, preferencesDirectory, redactDiagnostic,
    sameWorkspace, workspacePath, WorkspacePreferences,
} from "./local-state.js";

class HostError extends Error {
    constructor(readonly status: number, message: string) { super(message); }
}

// The runtime limits JSON commands by UTF-16 length, not UTF-8 byte length.
const MAX_HOST_REQUEST_BYTES = 3 * 64 * 1024;

async function readHostBody(request: IncomingMessage): Promise<Record<string, unknown>> {
    if (request.headers["content-type"]?.split(";")[0].trim() !== "application/json") throw new HostError(415, "Host commands require JSON.");
    if (Number(request.headers["content-length"]) > MAX_HOST_REQUEST_BYTES) {
        request.resume();
        throw new HostError(413, "Host command exceeds the 192 KiB transport limit.");
    }
    try { return await readJsonRequest(request.iterator({ destroyOnReturn: false }), MAX_HOST_REQUEST_BYTES); }
    catch (error) {
        request.resume();
        throw new HostError(errorMessage(error) === "Request is too large." ? 413 : 400, errorMessage(error));
    }
}

export interface BrowserHostOptions {
    version: string;
    runtimeDirectory: string;
    workspace?: string;
    initialDirectory: string;
    page: string;
    scriptHash: string;
    assets?: () => { page: string; scriptHash: string };
    developmentRevision?: () => string;
    preferencesPath?: string;
    backendFactory?: BackendFactory;
    startupTimeoutMs?: number;
    modelSelection?: DesktopModelSelection;
    sourcePreview?: boolean;
}

export async function createBrowserHost(options: BrowserHostOptions) {
    const capability = randomBytes(32).toString("base64url");
    const clients = new Set<ServerResponse>();
    const state: HostSnapshot = {
        revision: 0, generation: randomUUID(), version: options.version, phase: "idle",
        workspace: null, sessionId: null, canvasUrl: null, status: "Open a workspace to begin.",
        error: null, notice: null, warning: null, permissionMode: "ask", requests: [], recentWorkspaces: [],
    };
    let backend: Backend | undefined;
    let transition: Promise<void> | undefined;
    let closing: Promise<void> | undefined;
    let closed = false;
    let startupTimer: ReturnType<typeof setTimeout> | undefined;
    let modeReported = false;
    const acknowledgedNotices = new Set<string>();
    const replying = new Set<string>();
    const snapshot = (): HostSnapshot => structuredClone(state);
    const publish = () => {
        state.revision++;
        const event = `data: ${JSON.stringify(state)}\n\n`;
        for (const client of clients) {
            if (client.writableLength > 4 * 1024 * 1024) client.destroy();
            else client.write(event);
        }
    };
    const warning = (message: string) => { state.warning = redactDiagnostic(message); publish(); };
    const diagnostics = new HostDiagnostics(warning);
    const preferences = new WorkspacePreferences(options.preferencesPath || preferencesDirectory(), (message) => {
        diagnostics.write(message);
        warning(message);
    });
    await preferences.load();
    state.recentWorkspaces = [...preferences.recent];

    const fail = (message: string) => {
        clearTimeout(startupTimer);
        state.error = redactDiagnostic(message);
        state.phase = "error";
        state.canvasUrl = null;
        state.requests = [];
        replying.clear();
        state.status = "The workspace needs attention.";
        diagnostics.write(message);
        publish();
    };
    const armStartupTimer = () => {
        clearTimeout(startupTimer);
        if (state.phase !== "starting" || state.requests.length) return;
        const generation = state.generation;
        startupTimer = setTimeout(() => {
            if (state.generation !== generation || state.phase !== "starting") return;
            fail("Startup timed out. Check Diagnostics and Copilot sign-in, then retry.");
            void backend?.stop().catch((error: unknown) => warning(errorMessage(error)));
        }, options.startupTimeoutMs ?? 60_000);
    };
    const send = async (command: BackendCommand) => {
        if (!backend || closing || ["error", "stopping", "stopped", "idle"].includes(state.phase)) {
            throw new HostError(409, "The backend is not accepting commands. Open or retry the workspace.");
        }
        const target = backend;
        const generation = state.generation;
        try { await target.send(command); }
        catch (error) {
            if (target === backend && generation === state.generation && !closing && state.phase !== "stopping") {
                fail(`Your command could not be delivered: ${errorMessage(error)}`);
            }
            throw new HostError(503, "The command could not be delivered to its original backend. Review the current workspace before retrying.");
        }
        if (target !== backend || generation !== state.generation || closing || state.phase === "stopping") {
            throw new HostError(409, "The workspace changed while this command was being delivered. No command was sent to the new backend.");
        }
    };
    const receive = (event: DesktopEvent, generation: string) => {
        if (generation !== state.generation || closing || state.phase === "stopping" || state.phase === "error") return;
        switch (event.type) {
            case "status": state.status = redactDiagnostic(event.message); break;
            case "error":
                if (state.phase !== "ready") { fail(event.message); return; }
                if (event.notificationId) {
                    if (acknowledgedNotices.has(event.notificationId) || event.notificationId === state.notice?.id) return;
                    state.notice = { id: event.notificationId, message: redactDiagnostic(event.message) };
                } else state.error = redactDiagnostic(event.message);
                diagnostics.write(event.message);
                break;
            case "permission-mode":
                modeReported = true;
                state.permissionMode = event.mode;
                break;
            case "permission-resolved":
                state.requests = state.requests.filter((request) => request.id !== event.id);
                replying.delete(`${generation}:${event.id}`);
                armStartupTimer();
                break;
            case "permission":
            case "question":
                if (state.requests.some((request) => request.id === event.id)) return;
                if (state.requests.length >= 16) {
                    warning("A backend prompt was denied because the pending-request limit was reached.");
                    void send(event.type === "permission"
                        ? { type: "permission-response", id: event.id, approved: false }
                        : { type: "question-response", id: event.id, cancelled: true })
                        .catch((error: unknown) => warning(errorMessage(error)));
                    return;
                }
                state.requests.push(event);
                clearTimeout(startupTimer);
                break;
            case "ready":
                try {
                    if (!modeReported) throw new Error("The backend did not report its permission mode.");
                    if (!state.workspace || !sameWorkspace(event.workspace, state.workspace)) throw new Error("The backend returned a different workspace.");
                    if (state.sessionId && state.sessionId !== event.sessionId) throw new Error("The backend session identity changed.");
                    const url = validateDesktopUrl(event.url).href;
                    if (state.phase === "ready" && state.canvasUrl === url) return;
                    state.canvasUrl = url;
                    state.sessionId = event.sessionId;
                    state.phase = "ready";
                    state.status = "Ready";
                    state.error = null;
                    clearTimeout(startupTimer);
                } catch (error) { fail(errorMessage(error)); return; }
                break;
            case "stopped": fail("The backend stopped. Retry or open another workspace."); return;
        }
        publish();
    };

    const openWorkspace = (path: string) => {
        if (transition || closing) throw new HostError(409, "A workspace transition is already in progress.");
        let stoppingPrevious = false;
        const work = async () => {
            const workspace = await workspacePath(path);
            stoppingPrevious = true;
            clearTimeout(startupTimer);
            state.phase = "stopping";
            state.status = "Stopping the previous workspace...";
            state.canvasUrl = null;
            state.requests = [];
            replying.clear();
            publish();
            await backend?.stop();
            backend = undefined;
            if (closing) return;
            state.generation = randomUUID();
            acknowledgedNotices.clear();
            const generation = state.generation;
            Object.assign(state, { workspace, phase: "starting", sessionId: null, permissionMode: "ask",
                status: "Starting the independent Copilot runtime...", error: null, notice: null });
            modeReported = false;
            await diagnostics.setWorkspace(workspace);
            diagnostics.write(`Starting Tandem browser host ${options.version}.`);
            await preferences.remember(workspace);
            state.recentWorkspaces = [...preferences.recent];
            publish();
            armStartupTimer();
            backend = await (options.backendFactory || startBackend)({
                workspace, runtimeDirectory: options.runtimeDirectory,
                ...(options.modelSelection ? { modelSelection: options.modelSelection } : {}),
                ...(options.sourcePreview ? { sourcePreview: true } : {}),
                event: (event) => receive(event, generation),
                diagnostic: (message) => diagnostics.write(message),
                exited: (code, error) => {
                    if (generation !== state.generation || state.phase === "stopping" || closing) return;
                    if (state.phase === "error") return;
                    fail(error || `The backend exited (${code ?? "unknown"}). Retry to start it again.`);
                },
            });
        };
        transition = work().catch((error: unknown) => {
            if (stoppingPrevious) fail(errorMessage(error));
            else {
                const message = redactDiagnostic(`Cannot open that workspace: ${errorMessage(error)}`);
                if (state.phase === "ready") state.notice = { id: randomUUID(), message };
                else state.error = message;
                diagnostics.write(message);
                publish();
            }
        }).finally(() => { transition = undefined; });
    };

    const command = async (input: Record<string, unknown>) => {
        if (input.generation !== state.generation) throw new HostError(409, "This command belongs to an earlier workspace. Reload the host state.");
        if (input.type === "dismiss-notice") {
            if (typeof input.id !== "string" || !input.id || input.id.length > 512) throw new HostError(400, "A notification ID is required.");
            // A stale acknowledgment is harmless and must not clear a newer occurrence or a blocker.
            if (state.phase === "ready" && state.notice?.id === input.id) {
                acknowledgedNotices.add(input.id);
                state.notice = null;
                publish();
            }
            return;
        }
        if (input.type === "stop") return "stop";
        if (input.type === "open-workspace") {
            if (typeof input.workspace !== "string" || input.workspace.length > 32768) throw new HostError(400, "Enter a workspace folder path.");
            openWorkspace(input.workspace);
            return;
        }
        if (input.type === "retry") {
            if (!state.workspace) throw new HostError(409, "Choose a workspace first.");
            openWorkspace(state.workspace);
            return;
        }
        if (input.type === "set-permission-mode") {
            if (input.mode !== "ask" && input.mode !== "allow-all") throw new HostError(400, "Invalid permission mode.");
            await send({ type: input.type, mode: input.mode });
            return;
        }
        if (input.type !== "permission-response" && input.type !== "question-response") throw new HostError(400, "Unknown host command.");
        const request = state.requests.find((request) => request.id === input.id);
        const responseKey = `${state.generation}:${input.id}`;
        if (!request || replying.has(responseKey) || input.type !== `${request.type}-response`) {
            throw new HostError(409, "This request has already been resolved or no longer belongs to this workspace.");
        }
        let response: BackendCommand;
        if (request.type === "permission") {
            if (typeof input.approved !== "boolean" || (input.allowAllForSession !== undefined && typeof input.allowAllForSession !== "boolean")
                || (input.allowAllForSession === true && (!input.approved || !request.canAllowAllForSession))) {
                throw new HostError(400, "This permission request does not allow that response.");
            }
            response = { type: "permission-response", id: request.id, approved: input.approved, allowAllForSession: input.allowAllForSession === true };
        } else if (input.cancelled === true) {
            response = { type: "question-response", id: request.id, cancelled: true };
        } else {
            if (typeof input.answer !== "string" || !input.answer.trim() || input.answer.length > 32768
                || (request.allowFreeform === false && !request.choices?.includes(input.answer))) {
                throw new HostError(400, "Provide an answer permitted by this question.");
            }
            response = { type: "question-response", id: request.id, answer: input.answer };
        }
        if (JSON.stringify(response).length > 64 * 1024) throw new HostError(400, "This response is too large for the runtime. Shorten it before retrying.");
        replying.add(responseKey);
        try {
            await send(response);
            state.requests = state.requests.filter((item) => item.id !== request.id);
            armStartupTimer();
            publish();
        } finally { replying.delete(responseKey); }
    };

    let url = "";
    const authorize = (request: IncomingMessage) => {
        if (!canvasRequestAllowed(request, url)) throw new HostError(403, "Only the local Tandem host may access this endpoint.");
        const received = request.headers.authorization;
        const expected = `Bearer ${capability}`;
        if (!received || Buffer.byteLength(received) !== Buffer.byteLength(expected)
            || !timingSafeEqual(Buffer.from(received), Buffer.from(expected))) {
            throw new HostError(401, "Open the private launch URL printed in the Tandem terminal.");
        }
    };
    const handle = async (request: IncomingMessage, response: ServerResponse) => {
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.setHeader("Referrer-Policy", "no-referrer");
        response.setHeader("Cache-Control", "no-store");
        if (!canvasRequestAllowed(request, url)) throw new HostError(403, "This request did not originate from the local host.");
        const address = new URL(request.url || "/", url);
        if (request.method === "GET" && address.pathname === "/") {
            const assets = options.assets ? options.assets() : options;
            response.setHeader("Content-Security-Policy", `default-src 'none'; script-src '${assets.scriptHash}'; style-src 'unsafe-inline'; connect-src 'self'; img-src data:; frame-src http://127.0.0.1:*; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`);
            response.setHeader("Permissions-Policy", "camera=(), geolocation=(), display-capture=()");
            response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            response.end(assets.page);
            return;
        }
        authorize(request);
        if (request.method === "GET" && address.pathname === "/host/state") {
            sendJsonResponse(response, 200, snapshot());
        } else if (request.method === "GET" && address.pathname === "/host/development" && options.developmentRevision) {
            sendJsonResponse(response, 200, { revision: options.developmentRevision() });
        } else if (request.method === "GET" && address.pathname === "/host/events") {
            if (clients.size >= 32) throw new HostError(429, "Too many host connections. Close unused Tandem tabs.");
            response.writeHead(200, { "Content-Type": "text/event-stream", Connection: "keep-alive" });
            clients.add(response);
            response.write(`data: ${JSON.stringify(state)}\n\n`);
            response.on("close", () => clients.delete(response));
        } else if (request.method === "GET" && address.pathname === "/host/directories") {
            try {
                sendJsonResponse(response, 200, await listWorkspaceDirectories(address.searchParams.get("path") || state.workspace || options.initialDirectory));
            } catch (error) { throw new HostError(400, `Cannot browse that folder: ${errorMessage(error)}`); }
        } else if (request.method === "GET" && address.pathname === "/host/diagnostics") {
            sendJsonResponse(response, 200, { text: diagnostics.snapshot() });
        } else if (request.method === "POST" && address.pathname === "/host/directories") {
            const input = await readHostBody(request);
            if (closing || input.generation !== state.generation) throw new HostError(409, "The workspace changed. Reopen the folder picker.");
            if (typeof input.parent !== "string" || typeof input.name !== "string") throw new HostError(400, "Choose a parent folder and a new folder name.");
            try { sendJsonResponse(response, 201, await createWorkspaceDirectory(input.parent, input.name)); }
            catch (error) { throw new HostError(400, `Cannot create that folder: ${errorMessage(error)}`); }
        } else if (request.method === "POST" && address.pathname === "/host/command") {
            const result = await command(await readHostBody(request));
            sendJsonResponse(response, 202, snapshot());
            if (result === "stop") void close().catch((error: unknown) => { diagnostics.write(errorMessage(error)); });
        } else {
            throw new HostError(404, "Host endpoint not found.");
        }
    };
    const server = createServer((request, response) => {
        void handle(request, response).catch((error: unknown) => {
            const message = redactDiagnostic(errorMessage(error));
            if (!response.headersSent) sendJsonResponse(response, error instanceof HostError ? error.status : 500, { error: message });
            else response.end();
            if (!(error instanceof HostError)) diagnostics.write(`Host request failed: ${message}`);
        });
    });
    server.requestTimeout = 15_000;
    server.headersTimeout = 10_000;
    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("The browser host did not obtain a loopback port.");
    url = `http://127.0.0.1:${address.port}/`;
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => { finish = resolve; });
    const heartbeat = setInterval(() => { for (const client of clients) client.write(": keepalive\n\n"); }, 20_000);
    const close = (): Promise<void> => closing ??= (async () => {
        clearTimeout(startupTimer);
        state.phase = "stopping";
        state.status = "Stopping Tandem...";
        state.canvasUrl = null;
        state.requests = [];
        publish();
        try {
            await transition;
            await backend?.stop();
            backend = undefined;
            state.phase = "stopped";
            state.status = "Tandem stopped. You can close this tab.";
            publish();
        } catch (error) {
            fail(`Shutdown failed: ${errorMessage(error)}`);
            closing = undefined;
            throw error;
        }
        try {
            clearInterval(heartbeat);
            let flushTimer: ReturnType<typeof setTimeout> | undefined;
            try {
                await Promise.race([
                    Promise.all([...clients].map((client) => new Promise<void>((resolve) => client.end(resolve)))),
                    new Promise<void>((resolve) => { flushTimer = setTimeout(resolve, 1000); }),
                ]);
            } finally { clearTimeout(flushTimer); }
            clients.clear();
            await new Promise<void>((resolve, reject) => {
                server.close((error) => error ? reject(error) : resolve());
                server.closeAllConnections();
            });
            await diagnostics.flush();
        } finally {
            closed = true;
            finish();
        }
    })();
    return {
        url, launchUrl: `${url}#token=${capability}`, capability, snapshot,
        start() { if (closed) throw new Error("The browser host has stopped."); if (options.workspace) openWorkspace(options.workspace); },
        report: warning,
        close,
        finished,
    };
}
