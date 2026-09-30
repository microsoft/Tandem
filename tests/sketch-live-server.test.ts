import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import { test, type TestContext } from "node:test";
import WebSocket, { WebSocketServer, type ClientOptions } from "ws";
import {
    attachSketchLiveServer,
    ensureSketchLiveAzureCliPath,
    SketchLiveError,
    type SketchLiveAuthorization,
    type SketchLiveServerDependencies,
} from "../src/sketch-live-server.js";
import { SpeechAuthError } from "../src/speech-auth.js";

const secret = "fixture-secret-never-in-browser";
const token = () => ({ token: secret, expiresOnTimestamp: Date.now() + 3_600_000 });
const auth = () => ({ identity: "sketch:revision-1:user-tandem", instructions: "Help refine the active sketch." });
const started = { type: "session.started", event_id: "provider-start", session: { id: "fixture-session" } };

test("GPT-live finds the per-user Azure CLI without replacing the inherited PATH", () => {
    const directory = "C:\\Users\\fixture\\AppData\\Local\\Programs\\AzureCLI\\bin";
    const checked: string[] = [];
    const env = { LOCALAPPDATA: "C:\\Users\\fixture\\AppData\\Local", Path: "C:\\Windows;C:\\ExistingCLI" };
    const exists = (path: string) => { checked.push(path); return true; };
    ensureSketchLiveAzureCliPath(env, "win32", exists);
    assert.equal(env.Path, `C:\\Windows;C:\\ExistingCLI;${directory}`);
    assert.deepEqual(checked, [`${directory}\\az.cmd`]);
    ensureSketchLiveAzureCliPath(env, "win32", exists);
    assert.equal(env.Path, `C:\\Windows;C:\\ExistingCLI;${directory}`, "retries do not duplicate PATH entries");
    const quoted: NodeJS.ProcessEnv = { LOCALAPPDATA: env.LOCALAPPDATA, PATH: `"${directory.toUpperCase()}\\"` };
    ensureSketchLiveAzureCliPath(quoted, "win32", exists);
    assert.equal(quoted.PATH, `"${directory.toUpperCase()}\\"`, "Windows path matching is case-insensitive");
    assert.equal(Object.hasOwn(quoted, "Path"), false);
});

test("GPT-live leaves PATH unchanged without a verified Windows per-user Azure CLI", () => {
    for (const platform of ["linux", "darwin", "win32"] as const) {
        const env = { LOCALAPPDATA: "C:\\Users\\fixture\\AppData\\Local", PATH: "original" };
        ensureSketchLiveAzureCliPath(env, platform, () => false);
        assert.equal(env.PATH, "original");
    }
    const missingLocal: NodeJS.ProcessEnv = { Path: "original" };
    ensureSketchLiveAzureCliPath(missingLocal, "win32", () => true);
    assert.deepEqual(missingLocal, { Path: "original" });
    const missingPath: NodeJS.ProcessEnv = { LOCALAPPDATA: "C:\\Users\\fixture\\AppData\\Local" };
    ensureSketchLiveAzureCliPath(missingPath, "win32", () => true);
    assert.equal(missingPath.Path, "C:\\Users\\fixture\\AppData\\Local\\Programs\\AzureCLI\\bin");
});

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

async function until(check: () => boolean, message = "Expected transport event"): Promise<void> {
    const end = Date.now() + 2_000;
    while (!check()) {
        if (Date.now() >= end) assert.fail(message);
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
}

async function fixture(t: TestContext, dependencies: SketchLiveServerDependencies = {}) {
    const http = createServer((_request, response) => response.writeHead(404).end());
    const upstreamHttp = createServer((_request, response) => response.writeHead(404).end());
    const state = {
        autoStart: true,
        rejectProvider: false,
        authorize: async (): Promise<SketchLiveAuthorization> => auth(),
        getToken: async (_scope: string, _options: { abortSignal: AbortSignal }) => token(),
    };
    const provider = new WebSocketServer({
        server: upstreamHttp,
        verifyClient: (_info, done) => done(!state.rejectProvider, 401, secret),
    });
    const providerSockets: WebSocket[] = [];
    const providerMessages: Record<string, any>[] = [];
    const providerHeaders: (string | undefined)[] = [];
    provider.on("connection", (socket, request) => {
        providerSockets.push(socket);
        providerHeaders.push(request.headers.authorization);
        socket.on("error", () => {});
        socket.on("message", (data) => {
            const event = JSON.parse(data.toString());
            providerMessages.push(event);
            if (event.type === "session.start" && state.autoStart) socket.send(JSON.stringify(started));
        });
    });
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
    await new Promise<void>((resolve) => upstreamHttp.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
    const upstreamUrl = `ws://127.0.0.1:${(upstreamHttp.address() as { port: number }).port}`;
    const credentials: { tenantId: string; processTimeoutInMs: number }[] = [];
    const tokens: { scope: string; signal: AbortSignal }[] = [];
    const connections: { url: string; options: ClientOptions }[] = [];
    let authorizations = 0;
    const attachment = attachSketchLiveServer(http, {
        origin: () => origin,
        authorize: () => { authorizations++; return state.authorize(); },
    }, {
        env: {},
        createCredential: (options) => {
            credentials.push(options);
            return { getToken: (scope, options) => {
                tokens.push({ scope, signal: options.abortSignal });
                return state.getToken(scope, options);
            } };
        },
        createSocket: (url, options) => {
            connections.push({ url, options });
            return new WebSocket(upstreamUrl, options);
        },
        ...dependencies,
    });
    const clients: WebSocket[] = [];
    function dial(path: string, options: ClientOptions = {}) {
        const socket = new WebSocket(origin.replace("http:", "ws:") + path, { origin, ...options });
        const events: Record<string, any>[] = [];
        const texts: string[] = [];
        const errors: string[] = [];
        let status: number | undefined;
        let closeCode: number | undefined;
        let closeReason: string | undefined;
        clients.push(socket);
        socket.on("message", (data) => {
            texts.push(data.toString());
            events.push(JSON.parse(data.toString()));
        });
        socket.on("error", (error) => errors.push(error.message));
        socket.on("close", (code, reason) => { closeCode = code; closeReason = reason.toString(); });
        socket.on("unexpected-response", (_request, response) => {
            status = response.statusCode;
            response.resume();
            socket.terminate();
        });
        return { socket, events, texts, errors, status: () => status, closeCode: () => closeCode, closeReason: () => closeReason };
    }
    async function connect(ticket?: { path: string; ticket: string }) {
        ticket ??= await attachment.issueTicket();
        const client = dial(`${ticket.path}?ticket=${ticket.ticket}`);
        await until(() => client.socket.readyState === WebSocket.OPEN || client.status() !== undefined || client.closeCode() !== undefined);
        return client;
    }
    t.after(async () => {
        attachment.close();
        for (const socket of clients) socket.terminate();
        for (const socket of providerSockets) socket.terminate();
        await Promise.all([
            new Promise<void>((resolve) => http.close(() => resolve())),
            new Promise<void>((resolve) => provider.close(() => upstreamHttp.close(() => resolve()))),
        ]);
    });
    return {
        attachment, server: http, state, origin, upstreamUrl, credentials, tokens, connections, providerSockets, providerMessages, providerHeaders,
        authorizations: () => authorizations, dial, connect,
    };
}

async function ready(h: Awaited<ReturnType<typeof fixture>>) {
    const client = await h.connect();
    await until(() => client.events.some((event) => event.type === "session.started"));
    return client;
}

function assertSafeError(client: ReturnType<Awaited<ReturnType<typeof fixture>>["dial"]>) {
    assert.ok(client.events.some((event) => event.type === "tandem.live.error"));
    assert.doesNotMatch(JSON.stringify(client.events), new RegExp(secret));
    assert.doesNotMatch(client.closeReason() ?? "", new RegExp(secret));
}

test("live tickets do not authenticate; connecting uses Azure CLI defaults and the native start protocol", async (t) => {
    const h = await fixture(t);
    const ticket = await h.attachment.issueTicket();
    assert.equal(ticket.path, "/api/sketch/live/socket");
    assert.match(ticket.ticket, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(ticket.maxDurationSeconds, 600);
    assert.equal(h.credentials.length, 0);
    assert.equal(h.connections.length, 0);
    const client = await h.connect(ticket);
    await until(() => client.events.length === 1);
    assert.deepEqual(client.events, [started]);
    assert.ok(h.authorizations() >= 3, "ticket, upgrade, and pre-provider authorization");
    assert.deepEqual(h.credentials, [{ tenantId: "72f988bf-86f1-41af-91ab-2d7cd011db47", processTimeoutInMs: 20_000 }]);
    assert.equal(h.tokens[0].scope, "https://cognitiveservices.azure.com/.default");
    assert.equal(h.connections[0].url, "wss://cloudgpt-ins.openai.azure.com/openai/v1/live/sessions");
    assert.equal(h.connections[0].options.followRedirects, false);
    assert.equal(h.connections[0].options.perMessageDeflate, false);
    assert.equal(h.connections[0].options.maxPayload, 262_144);
    assert.deepEqual(h.providerHeaders, [`Bearer ${secret}`]);
    assert.match(h.providerMessages[0].event_id, /^[a-f0-9-]{36}$/);
    const { event_id: _id, ...payload } = h.providerMessages[0];
    assert.deepEqual(payload, {
        type: "session.start",
        session: {
            model: "gpt-live-1",
            instructions: auth().instructions,
            audio: { format: { type: "audio/pcm", rate: 16_000 }, output: { voice: "marin" } },
            delegation: { type: "client" },
            store: false,
        },
    });
    assert.doesNotMatch(JSON.stringify(client.events), new RegExp(secret));
    client.socket.send(JSON.stringify({ type: "session.close" }));
    await until(() => client.closeCode() !== undefined && h.providerMessages.length === 2);
    assert.equal(h.providerMessages[1].type, "session.close");
    const second = await ready(h);
    assert.equal(h.tokens.length, 2, "each new session authenticates afresh");
    second.socket.close();
});

test("live configuration rejects every endpoint/credential/path spoof without using Azure", async (t) => {
    const env: Record<string, string | undefined> = {};
    const h = await fixture(t, { env });
    for (const bad of [
        "", "http://cloudgpt-ins.openai.azure.com/openai/v1/", "wss://cloudgpt-ins.openai.azure.com/openai/v1/",
        "https://cloudgpt-ins.openai.azure.com.evil.example/openai/v1/",
        "https://cloudgpt-ins.openai.azure.com@evil.example/openai/v1/",
        "https://user:password@cloudgpt-ins.openai.azure.com/openai/v1/",
        "https://cloudgpt-ins.openai.azure.com:443/openai/v1/",
        "https://cloudgpt-ins.openai.azure.com/openai/v1/live/sessions",
        "https://cloudgpt-ins.openai.azure.com/openai/v1/?api-key=" + secret,
        "https://cloudgpt-ins.openai.azure.com/openai/v1/#" + secret,
        "https://cloudgpt-ins.openai.azure.com/openai/v1/../v1/",
        "https://cloudgpt-ins.openai.azure.com/openai/%761/",
        " https://cloudgpt-ins.openai.azure.com/openai/v1/",
        "https://cloudgpt-ins.openai.azure.com/openai/v1/\n",
    ]) {
        env.TANDEM_Live__Endpoint = bad;
        await assert.rejects(h.attachment.issueTicket(), (error: SketchLiveError) =>
            error.statusCode === 503 && !error.message.includes(secret) && !error.message.includes("password"));
    }
    delete env.TANDEM_Live__Endpoint;
    for (const [name, value] of [
        ["TANDEM_Live__Model", "gpt-realtime"], ["TANDEM_Live__Voice", "marin\r\n" + secret],
        ["TANDEM_Live__TenantId", "organizations"], ["TANDEM_Live__TenantId", secret],
    ]) {
        env[name] = value;
        await assert.rejects(h.attachment.issueTicket(), { statusCode: 503 });
        delete env[name];
    }
    assert.equal(h.authorizations(), 0);
    assert.equal(h.credentials.length, 0);
    assert.equal(h.connections.length, 0);
});

test("configured tenant/voice and fresh bounded instructions are used, never client overrides", async (t) => {
    const tenantId = "11111111-1111-1111-1111-111111111111";
    const h = await fixture(t, { env: { TANDEM_Live__TenantId: tenantId, TANDEM_Live__Voice: "cedar" } });
    const ticket = await h.attachment.issueTicket();
    h.state.authorize = async () => ({ ...auth(), instructions: "Newly captured instructions" });
    await h.connect(ticket);
    await until(() => h.providerMessages.length === 1);
    assert.equal(h.providerMessages[0].session.instructions, "Newly captured instructions");
    assert.equal(h.providerMessages[0].session.audio.output.voice, "cedar");
    assert.equal(h.credentials[0].tenantId, tenantId);
});

test("initial sketch context travels in session.start, never an unsolicited thinking append", async (t) => {
    const h = await fixture(t);
    const context = [JSON.stringify({ kind: "screen", id: "home", title: "Home", width: 960, height: 640 })];
    const ticket = await h.attachment.issueTicket(context);
    const client = await h.connect(ticket);
    await until(() => client.events.some((event) => event.type === "session.started"));
    assert.equal(h.providerMessages.length, 1);
    assert.equal(h.providerMessages[0].type, "session.start");
    assert.match(h.providerMessages[0].session.instructions, /untrusted task data/);
    assert.ok(h.providerMessages[0].session.instructions.includes(context[0]));
    client.socket.send(JSON.stringify({ type: "session.thinking.append", content: "A draft changed." }));
    await until(() => client.closeCode() !== undefined);
    assert.equal(client.events.at(-1)?.code, "delegation_required");
    assert.equal(h.providerMessages.length, 1, "the provider never receives the invalid append");
});

test("initial context validates records and the combined startup instruction limit before connecting", async (t) => {
    const h = await fixture(t);
    for (const context of [null, {}, ["not-json"], ['{"kind":"configuration","endpoint":"override"}'],
        [JSON.stringify({ kind: "goal", text: "x".repeat(500) })], Array(33).fill('{"kind":"goal","text":"a"}')]) {
        await assert.rejects(h.attachment.issueTicket(context), { statusCode: 400 });
    }
    h.state.authorize = async () => ({ ...auth(), instructions: "x".repeat(16_380) });
    await assert.rejects(h.attachment.issueTicket(['{"kind":"goal","text":"test"}']), { statusCode: 400 });
    assert.equal(h.connections.length, 0);
    assert.equal(h.tokens.length, 0);
});

test("only the verified twenty-two GPT-live voices can be configured", async (t) => {
    const env: Record<string, string | undefined> = {};
    let now = Date.now();
    const h = await fixture(t, { env, now: () => now });
    for (const voice of [
        "marin", "alloy", "ash", "ballad", "beacon", "bossa", "cedar", "cinder", "coral", "delta", "echo",
        "gleam", "meridian", "quartz", "ripple", "sage", "shimmer", "stone", "tempo", "verse", "vesper", "willow",
    ]) {
        env.TANDEM_Live__Voice = voice;
        now += 30_001;
        await h.attachment.issueTicket();
    }
    for (const voice of ["", "unknown-voice", "Marin", "marin ", "marin\n"]) {
        env.TANDEM_Live__Voice = voice;
        await assert.rejects(h.attachment.issueTicket(), { statusCode: 503 });
    }
    assert.equal(h.credentials.length, 0);
});

test("oversized UTF-8 instructions and access errors fail safely during ticket issuance", async (t) => {
    const h = await fixture(t);
    h.state.authorize = async () => ({ ...auth(), instructions: "é".repeat(8_192) });
    await h.attachment.issueTicket();
    h.state.authorize = async () => ({ ...auth(), instructions: "é".repeat(8_193) });
    await assert.rejects(h.attachment.issueTicket(), { statusCode: 403 });
    h.state.authorize = async () => { throw new Error(secret); };
    await assert.rejects(h.attachment.issueTicket(), (error: SketchLiveError) =>
        error.statusCode === 403 && !error.message.includes(secret) && !("cause" in error));
    assert.equal(h.credentials.length, 0);
});

test("ticket issuance preserves explicit authorization denials but sanitizes unexpected errors", async (t) => {
    const h = await fixture(t);
    for (const status of [403, 409]) {
        const denial = new SpeechAuthError("Open the active sketch in the preferred provider before starting GPT-live.", status);
        h.state.authorize = async () => { throw denial; };
        await assert.rejects(h.attachment.issueTicket(), (error) => error === denial);
    }
    for (const unexpected of [
        new Error(secret),
        Object.assign(new Error(secret), { statusCode: 409, name: "SpeechAuthError" }),
        new SpeechAuthError(secret, 503),
    ]) {
        h.state.authorize = async () => { throw unexpected; };
        await assert.rejects(h.attachment.issueTicket(), (error: SketchLiveError) =>
            error instanceof SketchLiveError && error.statusCode === 403
            && !error.message.includes(secret) && !("cause" in error));
    }
    assert.equal(h.credentials.length, 0);
});

test("upgrades require exact Origin, Host, route, and a single-use ticket", async (t) => {
    const h = await fixture(t);
    const ticket = await h.attachment.issueTicket();
    const path = `${ticket.path}?ticket=${ticket.ticket}`;
    for (const [route, options] of [
        [path, { origin: "https://evil.example" }],
        [path, { origin: undefined }],
        [path, { headers: { Host: "evil.example" } }],
        [path, { origin: undefined, headers: { Origin: [h.origin, h.origin] } }],
        [path, { headers: { "Sec-Fetch-Site": "cross-site" } }],
        [path, { headers: { "Sec-WebSocket-Protocol": "unauthorized-protocol" } }],
        ["/other?ticket=" + ticket.ticket, {}],
        [ticket.path, {}],
        [path + "&ticket=" + ticket.ticket, {}],
        [path + "&model=gpt-realtime", {}],
        [path.replace("socket", "%73ocket"), {}],
        [path.replace(ticket.ticket, "A".repeat(43)), {}],
    ] as [string, ClientOptions][]) {
        const client = h.dial(route, options);
        await until(() => client.status() !== undefined, `Expected a rejected upgrade: ${JSON.stringify(options)}`);
        assert.equal(client.status(), 403);
    }
    assert.equal(h.credentials.length, 0);
    const client = await h.connect(ticket);
    await until(() => client.events.length > 0);
    const replay = h.dial(path);
    await until(() => replay.status() !== undefined);
    assert.equal(replay.status(), 403);
    await assert.rejects(h.attachment.issueTicket(), { statusCode: 409 });
    client.socket.close();
    await until(() => client.closeCode() !== undefined);
    const replayAfterClose = h.dial(path);
    await until(() => replayAfterClose.status() !== undefined);
    assert.equal(replayAfterClose.status(), 403);
    assert.equal(h.credentials.length, 1);
});

test("stale and expired tickets cannot connect and unused tickets are bounded", async (t) => {
    let now = Date.now();
    const h = await fixture(t, { now: () => now });
    const expired = await h.attachment.issueTicket();
    now += 30_001;
    const client = await h.connect(expired);
    assert.equal(client.status(), 403);
    const stale = await h.attachment.issueTicket();
    h.state.authorize = async () => ({ ...auth(), identity: "another-stage" });
    const staleClient = await h.connect(stale);
    assert.equal(staleClient.status(), 403);
    for (let index = 0; index < 8; index++) await h.attachment.issueTicket();
    await assert.rejects(h.attachment.issueTicket(), { statusCode: 429 });
    now += 30_001;
    await h.attachment.issueTicket();
    assert.equal(h.credentials.length, 0);
    assert.equal(h.connections.length, 0);
});

test("the attachment reserves its single session before asynchronous authorization", async (t) => {
    const h = await fixture(t);
    const first = await h.attachment.issueTicket();
    const second = await h.attachment.issueTicket();
    const authorization = deferred<SketchLiveAuthorization>();
    h.state.authorize = () => authorization.promise;
    const firstClient = h.dial(`${first.path}?ticket=${first.ticket}`);
    await until(() => h.authorizations() === 3);
    const secondClient = await h.connect(second);
    assert.equal(secondClient.status(), 409);
    assert.equal(h.authorizations(), 3);
    authorization.resolve(auth());
    await until(() => firstClient.events.length === 1);
    assert.equal(h.connections.length, 1);
});

test("pending ticket authorizations are bounded and shutdown cancels them", async (t) => {
    const h = await fixture(t);
    h.state.authorize = () => new Promise(() => {});
    const requests = Array.from({ length: 8 }, () => h.attachment.issueTicket());
    const settled = Promise.allSettled(requests);
    await assert.rejects(h.attachment.issueTicket(), { statusCode: 429 });
    h.attachment.close();
    const results = await settled;
    assert.ok(results.every((result) => result.status === "rejected"));
    await assert.rejects(h.attachment.issueTicket(), { statusCode: 503 });
    assert.equal(h.credentials.length, 0);
});

test("a changed identity during Azure authentication cannot open the provider socket", async (t) => {
    const pending = deferred<ReturnType<typeof token>>();
    const h = await fixture(t);
    h.state.getToken = () => pending.promise;
    const client = await h.connect();
    await until(() => h.tokens.length === 1);
    h.state.authorize = async () => ({ ...auth(), identity: "reset-sketch" });
    pending.resolve(token());
    await until(() => client.closeCode() !== undefined);
    assertSafeError(client);
    assert.equal(h.connections.length, 0);
});

test("the latest authorized instructions are captured immediately before connecting", async (t) => {
    const pending = deferred<ReturnType<typeof token>>();
    const h = await fixture(t);
    h.state.getToken = () => pending.promise;
    const client = await h.connect();
    await until(() => h.tokens.length === 1);
    h.state.authorize = async () => ({ ...auth(), instructions: "Latest active sketch selection." });
    pending.resolve(token());
    await until(() => client.events.length > 0);
    assert.equal(h.providerMessages[0].session.instructions, "Latest active sketch selection.");
});

test("native audio, context, mute and delegation commands relay without credentials", async (t) => {
    const h = await fixture(t);
    const client = await ready(h);
    const commands = [
        { type: "session.input_audio.append", audio: Buffer.from([0, 0, 255, 127]).toString("base64") },
        { type: "session.thinking.append", content: "The selected screen is Home.", delegation_id: "delegation-1" },
        { type: "session.commentary.append", content: "I will update it.", event_id: "client-comment", delegation_id: "delegation-1" },
        { type: "session.input_audio.mute" },
        { type: "session.input_audio.unmute" },
        { type: "session.thinking.append", content: "é".repeat(250), delegation_id: "delegation-1" },
        { type: "session.commentary.append", content: "x".repeat(500), delegation_id: "delegation-1" },
    ];
    for (const command of commands) client.socket.send(JSON.stringify(command));
    await until(() => h.providerMessages.length === commands.length + 1);
    for (let index = 0; index < commands.length; index++) {
        const actual = h.providerMessages[index + 1];
        assert.equal(typeof actual.event_id, "string");
        assert.deepEqual(actual, { ...commands[index], event_id: actual.event_id });
    }
    assert.equal(h.providerMessages[3].event_id, "client-comment");
    const events = [
        { type: "session.input_transcript.delta", delta: "input" },
        { type: "session.output_transcript.delta", delta: "output" },
        { type: "session.output_audio.delta", delta: "AAA=" },
        { type: "session.delegation.created", delegation: { id: "delegation-1", input: { title: "Home" } } },
        { type: "session.usage.updated", usage: { input_tokens: 7 } },
        { type: "session.thinking.appended", event_id: "ack-thinking" },
        { type: "session.commentary.appended", event_id: "ack-commentary" },
        { type: "session.input_audio.muted" },
        { type: "session.input_audio.unmuted" },
    ];
    for (const event of events) h.providerSockets[0].send(JSON.stringify(event, null, 2));
    await until(() => client.events.length === events.length + 1);
    assert.deepEqual(client.events.slice(1), events);
    assert.equal(client.texts[1], JSON.stringify(events[0], null, 2), "provider event text is unchanged");
    assert.doesNotMatch(client.texts.join(""), new RegExp(secret));
    h.providerSockets[0].send(JSON.stringify({ type: "session.closed" }));
    await until(() => client.closeCode() !== undefined);
    assert.equal(client.events.at(-1)?.type, "session.closed");
    assert.equal(client.closeCode(), 1000);
});

test("input waits for session.started and the startup queue preserves order", async (t) => {
    const h = await fixture(t);
    h.state.autoStart = false;
    const client = await h.connect();
    await until(() => h.providerMessages.length === 1);
    client.socket.send(JSON.stringify({ type: "session.thinking.append", content: "first", delegation_id: "delegation-1" }));
    client.socket.send(JSON.stringify({ type: "session.commentary.append", content: "second", delegation_id: "delegation-1" }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(h.providerMessages.length, 1);
    h.providerSockets[0].send(JSON.stringify(started));
    await until(() => h.providerMessages.length === 3);
    assert.deepEqual(h.providerMessages.slice(1).map((event) => event.content), ["first", "second"]);
});

test("client commands reject malformed PCM, binary data, overrides, and oversized content", async (t) => {
    const h = await fixture(t);
    const invalid: (string | Buffer)[] = [
        JSON.stringify({ type: "session.input_audio.append", audio: "AA A=" }),
        JSON.stringify({ type: "session.input_audio.append", audio: "AAA" }),
        JSON.stringify({ type: "session.input_audio.append", audio: "AAB=" }),
        JSON.stringify({ type: "session.input_audio.append", audio: "AQ==" }),
        JSON.stringify({ type: "session.input_audio.append", audio: "" }),
        JSON.stringify({ type: "session.input_audio.append", audio: Buffer.alloc(32_002).toString("base64") }),
        JSON.stringify({ type: "session.input_audio.append", audio: "AAA=", model: "override" }),
        JSON.stringify({ type: "session.start", session: { model: "override" } }),
        JSON.stringify({ type: "session.thinking.append", content: "é".repeat(8_193) }),
        JSON.stringify({ type: "session.thinking.append", content: "é".repeat(249) + "你" }),
        JSON.stringify({ type: "session.commentary.append", content: "x".repeat(501) }),
        JSON.stringify({ type: "session.commentary.append", content: "x", delegation_id: {} }),
        JSON.stringify({ type: "session.commentary.append", content: "x", delegation_id: "invalid\n" }),
        JSON.stringify({ type: "session.input_audio.mute", event_id: "x".repeat(129) }),
        JSON.stringify({ type: "session.input_audio.mute", event_id: "invalid\n" }),
        JSON.stringify({ type: "session.close", headers: { Authorization: secret } }),
        "not-json", "[]",
        Buffer.from(JSON.stringify({ type: "session.input_audio.mute" })),
        JSON.stringify({ type: "session.thinking.append", content: "x".repeat(65_536) }),
    ];
    for (const frame of invalid) {
        const client = await ready(h);
        const before = h.providerMessages.length;
        client.socket.send(frame);
        await until(() => client.closeCode() !== undefined);
        if (Buffer.byteLength(frame) > 65_536) {
            assert.equal(client.closeCode(), 1009, "WebSocket's hard frame limit closes before application events");
        } else {
            assertSafeError(client);
        }
        assert.equal(h.providerMessages.length, before, "invalid data never reaches the provider");
    }
});

test("startup queues bound both message count and total PCM bytes", async (t) => {
    const h = await fixture(t);
    h.state.autoStart = false;
    for (const [count, frame] of [
        [33, JSON.stringify({ type: "session.input_audio.mute" })],
        [7, JSON.stringify({ type: "session.input_audio.append", audio: Buffer.alloc(32_000).toString("base64") })],
    ] as const) {
        const client = await h.connect();
        for (let index = 0; index < count && client.socket.readyState === WebSocket.OPEN; index++) client.socket.send(frame);
        await until(() => client.closeCode() !== undefined);
        assertSafeError(client);
        assert.match(client.events.at(-1)?.message, /queue limit/);
    }
});

test("startup deadlines abort authentication and reject late results without reconnecting", async (t) => {
    const pending = deferred<ReturnType<typeof token>>();
    const h = await fixture(t, { startupTimeoutMs: 200 });
    h.state.getToken = () => pending.promise;
    const client = await h.connect();
    await until(() => client.closeCode() !== undefined);
    assertSafeError(client);
    assert.match(client.events.at(-1)?.message, /startup timed out/);
    assert.equal(h.tokens[0].signal.aborted, true);
    pending.resolve(token());
    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.equal(h.connections.length, 0);
    h.state.getToken = async () => token();
    await ready(h);
    assert.equal(h.credentials.length, 2);
});

test("startup requires a provider session.started acknowledgment, not just an open socket", async (t) => {
    const h = await fixture(t, { startupTimeoutMs: 200 });
    h.state.autoStart = false;
    const client = await h.connect();
    await until(() => client.closeCode() !== undefined);
    assert.match(client.events.at(-1)?.message, /startup timed out/);
    await until(() => h.providerSockets[0].readyState === WebSocket.CLOSED);
});

test("the startup deadline also cancels a pending local upgrade authorization", async (t) => {
    const h = await fixture(t, { startupTimeoutMs: 200, authorizationTimeoutMs: 1_000 });
    const ticket = await h.attachment.issueTicket();
    const pending = deferred<SketchLiveAuthorization>();
    h.state.authorize = () => pending.promise;
    const client = await h.connect(ticket);
    assert.equal(client.status(), 504);
    pending.resolve(auth());
    h.state.authorize = async () => auth();
    await ready(h);
    assert.equal(h.credentials.length, 1, "the abandoned upgrade cannot start authentication");
});

test("periodic stage/provider revocation, denial, and authorization timeout stop live sessions", async (t) => {
    const h = await fixture(t, { authorizationIntervalMs: 20, authorizationTimeoutMs: 60 });
    for (const next of [
        async () => ({ ...auth(), identity: "different-provider" }),
        async () => { throw new Error(secret); },
        () => new Promise<SketchLiveAuthorization>(() => {}),
    ]) {
        h.state.authorize = async () => auth();
        const client = await ready(h);
        h.state.authorize = next;
        await until(() => client.closeCode() !== undefined);
        assertSafeError(client);
        await until(() => h.providerSockets.at(-1)?.readyState === WebSocket.CLOSED);
    }
});

test("session expiry releases the active slot and immediately expiring tokens cannot connect", async (t) => {
    const h = await fixture(t, { maxDurationMs: 200 });
    const first = await ready(h);
    await until(() => first.closeCode() !== undefined);
    assert.match(first.events.at(-1)?.message, /time limit/);
    h.state.getToken = async () => ({ token: secret, expiresOnTimestamp: Date.now() + 120 });
    const second = await h.connect();
    await until(() => second.closeCode() !== undefined);
    assertSafeError(second);
    assert.match(second.events.at(-1)?.message, /authentication/);
    assert.equal(h.connections.length, 1);
    assert.equal(h.tokens.length, 2);
});

test("tokens require at least thirty seconds of remaining lifetime", async (t) => {
    const now = Date.now();
    const h = await fixture(t, { now: () => now });
    for (const remaining of [-1, 0, 1, 29_999]) {
        h.state.getToken = async () => ({ token: secret, expiresOnTimestamp: now + remaining });
        const client = await h.connect();
        await until(() => client.closeCode() !== undefined);
        assertSafeError(client);
        assert.equal(h.connections.length, 0);
    }
    h.state.getToken = async () => ({ token: secret, expiresOnTimestamp: now + 30_000 });
    await ready(h);
    assert.equal(h.connections.length, 1, "exactly thirty seconds is accepted with a fixed clock");
});

test("token lifetime is rechecked after the final authorization await", async (t) => {
    let now = Date.now();
    const h = await fixture(t, { now: () => now });
    h.state.getToken = async () => ({ token: secret, expiresOnTimestamp: now + 30_000 });
    h.state.authorize = async () => {
        if (h.authorizations() === 3) now += 1_000;
        return auth();
    };
    const client = await h.connect();
    await until(() => client.closeCode() !== undefined);
    assertSafeError(client);
    assert.equal(h.connections.length, 0, "a token that became nearly expired is never sent upstream");
});

test("auth exceptions, invalid tokens, and provider handshake failures never echo credentials", async (t) => {
    const h = await fixture(t);
    for (const getToken of [
        async () => { throw new Error(`Authorization: Bearer ${secret}`); },
        async () => ({ token: `${secret}\r\nX-Injected: true`, expiresOnTimestamp: Date.now() + 3_600_000 }),
        async () => ({ token: secret, expiresOnTimestamp: 0 }),
        async () => null,
    ]) {
        h.state.getToken = getToken;
        const client = await h.connect();
        await until(() => client.closeCode() !== undefined);
        assertSafeError(client);
    }
    assert.equal(h.connections.length, 0);
    h.state.getToken = async () => token();
    h.state.rejectProvider = true;
    const rejected = await h.connect();
    await until(() => rejected.closeCode() !== undefined);
    assertSafeError(rejected);
    assert.equal(rejected.events.at(-1)?.code, "unauthorized");
    assert.equal(h.connections.length, 1);
});

test("credential and socket construction failures are sanitized", async (t) => {
    for (const dependencies of [
        { createCredential: () => { throw new Error(secret); } },
        { createSocket: () => { throw new Error(secret); } },
    ]) {
        const h = await fixture(t, dependencies);
        const client = await h.connect();
        await until(() => client.closeCode() !== undefined);
        assertSafeError(client);
    }
});

test("provider errors, invalid/binary/oversized frames, and close reasons are sanitized", async (t) => {
    const h = await fixture(t);
    const frames: (string | Buffer)[] = [
        JSON.stringify({ type: "error", message: secret }),
        JSON.stringify({ type: "session.error", error: { message: secret } }),
        JSON.stringify({ type: "session.closed", error: { message: secret } }),
        JSON.stringify({ type: "session.started", error: secret }),
        "{secret:" + secret,
        Buffer.from(secret),
        JSON.stringify({ type: "session.output_transcript.delta", delta: "x".repeat(262_144) + secret }),
    ];
    for (const frame of frames) {
        const client = await ready(h);
        h.providerSockets.at(-1)!.send(frame);
        await until(() => client.closeCode() !== undefined);
        assertSafeError(client);
    }
    const client = await ready(h);
    h.providerSockets.at(-1)!.close(1011, secret);
    await until(() => client.closeCode() !== undefined);
    assertSafeError(client);
});

test("the real missing-delegation rejection has an actionable code without echoing provider text", async (t) => {
    const h = await fixture(t);
    const client = await ready(h);
    h.providerSockets[0].send(JSON.stringify({
        type: "error",
        error: { code: "missing_required_parameter", param: "delegation_id", type: "invalid_request_error", message: secret },
    }));
    await until(() => client.closeCode() !== undefined);
    assertSafeError(client);
    assert.equal(client.events.at(-1)?.code, "delegation_required");
});
class HeldSocket extends EventEmitter {
    readyState = WebSocket.OPEN;
    bufferedAmount = 0;
    messages: string[] = [];
    send(text: string) { this.messages.push(text); }
    terminate() { this.readyState = WebSocket.CLOSED; this.emit("close", 1006, Buffer.alloc(0)); }
}

test("provider write buffers and outstanding writes have hard bounds", async (t) => {
    const mocks: HeldSocket[] = [];
    const h = await fixture(t, {
        createSocket: () => {
            const socket = new HeldSocket();
            mocks.push(socket);
            queueMicrotask(() => socket.emit("message", Buffer.from(JSON.stringify(started)), false));
            return socket as unknown as WebSocket;
        },
    });
    const client = await ready(h);
    for (let index = 0; index < 65; index++) client.socket.send(JSON.stringify({ type: "session.input_audio.mute" }));
    await until(() => client.closeCode() !== undefined);
    assertSafeError(client);
    assert.match(client.events.at(-1)?.message, /buffer limit/);
    assert.equal(mocks[0].messages.length, 64);
    assert.equal(mocks[0].readyState, WebSocket.CLOSED);
});

test("provider write limits also bound aggregate bytes and socket backpressure", async (t) => {
    let upstream: HeldSocket;
    const h = await fixture(t, {
        createSocket: () => {
            upstream = new HeldSocket();
            queueMicrotask(() => upstream.emit("message", Buffer.from(JSON.stringify(started)), false));
            return upstream as unknown as WebSocket;
        },
    });
    const audio = JSON.stringify({ type: "session.input_audio.append", audio: Buffer.alloc(32_000).toString("base64") });
    const first = await ready(h);
    for (let index = 0; index < 14; index++) first.socket.send(audio);
    await until(() => first.closeCode() !== undefined);
    assertSafeError(first);
    assert.ok(upstream!.messages.length < 14);
    const second = await ready(h);
    upstream!.bufferedAmount = 524_288;
    second.socket.send(JSON.stringify({ type: "session.input_audio.mute" }));
    await until(() => second.closeCode() !== undefined);
    assertSafeError(second);
    assert.equal(upstream!.messages.length, 1);
});

test("provider event bursts cannot accumulate unbounded browser writes", async (t) => {
    let upstream: HeldSocket;
    const h = await fixture(t, {
        createSocket: () => {
            upstream = new HeldSocket();
            queueMicrotask(() => upstream.emit("message", Buffer.from(JSON.stringify(started)), false));
            return upstream as unknown as WebSocket;
        },
    });
    const client = await ready(h);
    for (let index = 0; index < 65; index++) {
        upstream!.emit("message", Buffer.from(JSON.stringify({ type: "session.output_transcript.delta", delta: "bounded" })), false);
    }
    await until(() => client.closeCode() !== undefined);
    assertSafeError(client);
    assert.match(client.events.at(-1)?.message, /buffer limit/);
});

test("large provider deltas cannot accumulate unbounded browser bytes", async (t) => {
    let upstream: HeldSocket;
    const h = await fixture(t, {
        createSocket: () => {
            upstream = new HeldSocket();
            queueMicrotask(() => upstream.emit("message", Buffer.from(JSON.stringify(started)), false));
            return upstream as unknown as WebSocket;
        },
    });
    const client = await ready(h);
    for (let index = 0; index < 3; index++) {
        upstream!.emit("message", Buffer.from(JSON.stringify({ type: "session.output_transcript.delta", delta: "x".repeat(262_000) })), false);
    }
    await until(() => client.closeCode() !== undefined);
    assertSafeError(client);
    assert.ok(client.events.filter((event) => event.type === "session.output_transcript.delta").length <= 2);
});

test("client disconnect and attachment shutdown release both sockets and timers", async (t) => {
    const h = await fixture(t);
    const first = await ready(h);
    first.socket.terminate();
    await until(() => h.providerSockets[0].readyState === WebSocket.CLOSED);
    const second = await ready(h);
    h.attachment.close();
    h.attachment.close();
    await until(() => second.closeCode() !== undefined && h.providerSockets[1].readyState === WebSocket.CLOSED);
    assert.ok(h.tokens.every(({ signal }) => signal.aborted));
    await assert.rejects(h.attachment.issueTicket(), { statusCode: 503 });
});

test("the HTTP server close event shuts down the attachment and pending tickets", async (t) => {
    const h = await fixture(t);
    h.state.authorize = () => new Promise(() => {});
    const ticket = Promise.allSettled([h.attachment.issueTicket()]);
    await new Promise<void>((resolve) => h.server.close(() => resolve()));
    assert.equal((await ticket)[0].status, "rejected");
    assert.equal(h.server.listenerCount("upgrade"), 0);
    await assert.rejects(h.attachment.issueTicket(), { statusCode: 503 });
    assert.equal(h.credentials.length, 0);
});
