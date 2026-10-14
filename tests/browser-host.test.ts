import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { request as httpRequest } from "node:http";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { test, type TestContext } from "node:test";
import type { DesktopEvent } from "../src/desktop/protocol.js";
import { consumeLines, type BackendOptions } from "../src/browser/backend.js";
import type { BackendCommand } from "../src/browser/contracts.js";
import { parseBackendEvent } from "../src/browser/contracts.js";
import { HostDiagnostics, redactDiagnostic, WorkspacePreferences } from "../src/browser/local-state.js";
import { createBrowserHost, type BrowserHostOptions } from "../src/browser/server.js";

async function until(predicate: () => boolean, timeout = 3000): Promise<void> {
    const deadline = Date.now() + timeout;
    while (!predicate()) {
        if (Date.now() > deadline) throw new Error("Expected browser-host state was not reached.");
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
}

async function fixture(t: TestContext, startupTimeoutMs?: number, modelSelection?: BrowserHostOptions["modelSelection"]) {
    const root = await mkdtemp(join(tmpdir(), "tandem-browser-host-"));
    const workspace = join(root, "workspace");
    const other = join(root, "other");
    await Promise.all([mkdir(workspace), mkdir(other)]);
    const backends: Array<{ options: BackendOptions; commands: BackendCommand[]; stops: number; failStop: boolean; sendGate?: Promise<void> }> = [];
    const host = await createBrowserHost({
        version: "test", runtimeDirectory: root, initialDirectory: root,
        workspace, preferencesPath: join(root, "preferences"), page: "<html>Tandem fixture</html>", scriptHash: "sha256-fixture",
        startupTimeoutMs,
        ...(modelSelection ? { modelSelection } : {}),
        backendFactory: async (options) => {
            const record: typeof backends[number] = { options, commands: [], stops: 0, failStop: false };
            backends.push(record);
            options.event({ type: "permission-mode", mode: "ask" });
            return {
                async send(command) {
                    record.commands.push(command);
                    await record.sendGate;
                    if (command.type === "set-permission-mode") options.event({ type: "permission-mode", mode: command.mode });
                },
                async stop() {
                    record.stops++;
                    if (record.failStop) { record.failStop = false; throw new Error("Termination unconfirmed."); }
                },
            };
        },
    });
    t.after(async () => { await host.close(); await rm(root, { recursive: true, force: true }); });
    host.start();
    await until(() => backends.length === 1);
    const headers = { Authorization: `Bearer ${host.capability}`, "Content-Type": "application/json", Origin: new URL(host.url).origin };
    const request = (path: string, options: RequestInit = {}) => fetch(new URL(path, host.url), { headers, ...options });
    return { host, root, workspace, other, backends, headers, request,
        command: (input: Record<string, unknown>) => request("host/command", { method: "POST",
            body: JSON.stringify({ generation: host.snapshot().generation, ...input }) }),
        ready(index = backends.length - 1) {
            const record = backends[index];
            record.options.event({ type: "ready", workspace: record.options.workspace, url: `http://127.0.0.1:${5000 + index}/`, sessionId: `session-${index}` });
        },
        event(event: DesktopEvent) { backends.at(-1)!.options.event(event); },
    };
}

const permission = (id = "request-one", canAllowAllForSession = true): Extract<DesktopEvent, { type: "permission" }> =>
    ({ type: "permission", id, title: "Allow action?", details: '{"kind":"extension-management"}', canAllowAllForSession });

test("browser host preserves explicit main model selection across workspace switches without granting permissions", async (t) => {
    const selection = { model: "gpt-6-astra", reasoningEffort: "low" } as const;
    const f = await fixture(t, undefined, selection);
    assert.deepEqual(f.backends[0].options.modelSelection, selection);
    f.ready();
    assert.equal((await f.command({ type: "open-workspace", workspace: f.other })).status, 202);
    await until(() => f.backends.length === 2);
    assert.deepEqual(f.backends[1].options.modelSelection, selection);
    assert.equal(f.backends[0].stops, 1);
    assert.equal(f.host.snapshot().permissionMode, "ask");
    assert.deepEqual(f.backends[1].commands, []);
});

test("browser host leaves native model defaults untouched when no selection was supplied", async (t) => {
    const f = await fixture(t);
    assert.equal(Object.hasOwn(f.backends[0].options, "modelSelection"), false);
});

test("browser host API requires a launch capability, same origin and bounded JSON", async (t) => {
    const f = await fixture(t);
    const page = await fetch(f.host.url);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-security-policy")!, /frame-ancestors 'none'/);
    assert.equal(page.headers.get("referrer-policy"), "no-referrer");
    assert.ok(!(await page.text()).includes(f.host.capability));
    assert.equal((await fetch(new URL("host/state", f.host.url))).status, 401);
    assert.equal((await f.request("host/state", { headers: { ...f.headers, Origin: "https://untrusted.example" } })).status, 403);
    const rebinding = await new Promise<number | undefined>((resolve, reject) => {
        const request = httpRequest(new URL("host/state", f.host.url), { headers: { ...f.headers, Host: "untrusted.example" } },
            (response) => { response.resume(); resolve(response.statusCode); });
        request.once("error", reject);
        request.end();
    });
    assert.equal(rebinding, 403);
    assert.equal((await f.request("host/command", { method: "POST", body: "{}", headers: { Authorization: f.headers.Authorization } })).status, 415);
    assert.equal((await f.request("host/command", { method: "POST", body: "{" })).status, 400);
    assert.equal((await f.request("host/command", { method: "POST", body: JSON.stringify({ data: "x".repeat(192 * 1024) }) })).status, 413);
    assert.equal((await f.command({ type: "set-permission-mode", mode: "always" })).status, 400);
    assert.equal((await f.command({ type: "stop", generation: "stale" })).status, 409);
    assert.equal(f.backends[0].stops, 0);
});

test("startup permissions survive state/SSE reconnect and closing a tab never stops the backend", async (t) => {
    const f = await fixture(t);
    f.event(permission());
    assert.equal(f.host.snapshot().phase, "starting");
    const before = await f.request("host/state").then((value) => value.json());
    assert.equal(before.requests[0].id, "request-one");
    for (let pass = 0; pass < 2; pass++) {
        const controller = new AbortController();
        const response = await f.request("host/events", { signal: controller.signal });
        const reader = response.body!.getReader();
        const chunk = await reader.read();
        assert.match(new TextDecoder().decode(chunk.value), /request-one/);
        controller.abort();
        await reader.cancel().catch((error: Error) => assert.equal(error.name, "AbortError"));
    }
    assert.equal(f.host.snapshot().requests.length, 1);
    assert.equal(f.backends[0].stops, 0);
    assert.equal((await f.command({ type: "permission-response", id: "request-one", approved: true })).status, 202);
    assert.deepEqual(f.backends[0].commands, [{ type: "permission-response", id: "request-one", approved: true, allowAllForSession: false }]);
    assert.equal((await f.command({ type: "permission-response", id: "request-one", approved: true })).status, 409);
    f.ready();
    assert.equal(f.host.snapshot().phase, "ready");
});

test("native expired-consent events remove only that browser prompt and reject late approval", async (t) => {
    const f = await fixture(t);
    f.ready();
    f.event(permission("cancelled-worker"));
    f.event(permission("independent-worker"));
    f.event(parseBackendEvent({ type: "permission-resolved", id: "cancelled-worker" }));
    f.event({ type: "status", message: "Native work ended; its pending consent was dismissed." });
    const state = await f.request("host/state").then(response => response.json());
    assert.deepEqual(state.requests.map(request => request.id), ["independent-worker"]);
    assert.match(state.status, /consent was dismissed/);
    assert.equal((await f.command({ type: "permission-response", id: "cancelled-worker", approved: true, allowAllForSession: true })).status, 409);
    assert.equal(f.backends[0].commands.length, 0);
    assert.equal((await f.command({ type: "permission-response", id: "independent-worker", approved: true })).status, 202);
    assert.equal(f.backends[0].commands.length, 1);
});

test("managed approvals, questions, and queued requests stay individually fenced", async (t) => {
    const f = await fixture(t);
    f.event(permission("managed", false));
    assert.equal((await f.command({ type: "permission-response", id: "managed", approved: true, allowAllForSession: true })).status, 400);
    assert.equal((await f.command({ type: "permission-response", id: "managed", approved: "yes" })).status, 400);
    f.event({ type: "question", id: "question", question: "Choose", choices: ["A", "B"], allowFreeform: false });
    assert.equal((await f.command({ type: "question-response", id: "question", answer: "C" })).status, 400);
    assert.equal((await f.command({ type: "question-response", id: "managed", answer: "A" })).status, 409);
    assert.equal((await f.command({ type: "question-response", id: "question", answer: "A" })).status, 202);
    assert.equal(f.host.snapshot().requests.length, 1);
    assert.equal((await f.command({ type: "permission-response", id: "managed", approved: false })).status, 202);
    for (let index = 0; index < 17; index++) f.event(permission(`queued-${index}`));
    await until(() => f.backends[0].commands.some((command) => command.type === "permission-response" && command.id === "queued-16"));
    assert.equal(f.host.snapshot().requests.length, 16);
    assert.deepEqual(f.backends[0].commands.at(-1), { type: "permission-response", id: "queued-16", approved: false });
    f.event({ type: "permission-resolved", id: "queued-0" });
    assert.equal(f.host.snapshot().requests.length, 15);
});

test("workspace switching stops only the prior backend, resets permissions, and rejects late replies", async (t) => {
    const f = await fixture(t);
    f.ready();
    await f.command({ type: "set-permission-mode", mode: "allow-all" });
    const original = f.host.snapshot();
    f.event(permission("old-request"));
    assert.equal((await f.command({ type: "open-workspace", workspace: f.other })).status, 202);
    await until(() => f.backends.length === 2);
    assert.equal(f.backends[0].stops, 1);
    assert.equal(f.host.snapshot().permissionMode, "ask");
    assert.notEqual(f.host.snapshot().generation, original.generation);
    assert.deepEqual(f.host.snapshot().requests, []);
    assert.equal((await f.command({ type: "permission-response", id: "old-request", approved: true, generation: original.generation })).status, 409);
    f.backends[0].options.event({ type: "error", message: "Late old error" });
    assert.equal(f.host.snapshot().error, null);
    f.ready();
    assert.equal(f.host.snapshot().canvasUrl, "http://127.0.0.1:5001/");
    const revision = f.host.snapshot().revision;
    f.ready();
    assert.equal(f.host.snapshot().revision, revision, "duplicate ready events must not reload the application frame");
});

test("invalid folder selection preserves the current workspace and directory errors are visible", async (t) => {
    const f = await fixture(t);
    f.ready();
    const state = f.host.snapshot();
    await f.command({ type: "open-workspace", workspace: join(f.root, "missing") });
    await until(() => Boolean(f.host.snapshot().error));
    assert.equal(f.host.snapshot().phase, "ready");
    assert.equal(f.host.snapshot().canvasUrl, state.canvasUrl);
    assert.equal(f.host.snapshot().generation, state.generation);
    assert.equal(f.backends[0].stops, 0);
    const folders = await f.request(`host/directories?path=${encodeURIComponent(f.root)}`).then((response) => response.json());
    assert.ok(folders.directories.some((folder: { path: string }) => folder.path === f.workspace));
    assert.equal((await f.request(`host/directories?path=${encodeURIComponent(join(f.root, "missing"))}`)).status, 400);
    assert.equal((await f.request("host/directories?path=relative")).status, 400);
});

test("a late command failure cannot corrupt the next workspace", async (t) => {
    const f = await fixture(t);
    f.ready();
    f.event(permission("old"));
    let reject!: (error: Error) => void;
    f.backends[0].sendGate = new Promise<void>((_, fail) => { reject = fail; });
    const pending = f.command({ type: "permission-response", id: "old", approved: false });
    await until(() => f.backends[0].commands.length === 1);
    await f.command({ type: "open-workspace", workspace: f.other });
    await until(() => f.backends.length === 2);
    reject(new Error("The old pipe closed."));
    assert.equal((await pending).status, 503);
    assert.equal(f.host.snapshot().error, null);
    assert.equal(f.host.snapshot().phase, "starting");
});

test("folder creation is explicit, generation-scoped and cannot traverse or overwrite", async (t) => {
    const f = await fixture(t);
    const create = (name: string, generation = f.host.snapshot().generation) => f.request("host/directories", {
        method: "POST", body: JSON.stringify({ parent: f.workspace, name, generation }),
    });
    assert.equal((await create("stale", "old-generation")).status, 409);
    for (const name of ["..", "../outside", "a\\b", "CON", "trailing.", " padded "]) {
        assert.equal((await create(name)).status, 400, name);
    }
    const result = await create("New workspace");
    assert.equal(result.status, 201);
    const value = await result.json() as { path: string; parent: string };
    assert.equal(value.path, join(f.workspace, "New workspace"));
    const marker = join(value.path, "keep.txt");
    await writeFile(marker, "preserve");
    assert.equal((await create("New workspace")).status, 400);
    assert.equal(await readFile(marker, "utf8"), "preserve");
    assert.equal(f.host.snapshot().workspace, f.workspace, "creating a folder must not switch or restart the workspace");
    assert.equal(f.backends[0].stops, 0);
});

test("startup deadlines pause for human permissions and failures do not grant approval", async (t) => {
    const f = await fixture(t, 35);
    f.event(permission());
    await new Promise((resolve) => setTimeout(resolve, 70));
    assert.equal(f.host.snapshot().phase, "starting");
    await f.command({ type: "permission-response", id: "request-one", approved: false });
    await until(() => f.host.snapshot().phase === "error");
    assert.match(f.host.snapshot().error!, /timed out/);
    assert.equal(f.backends[0].stops, 1);
    assert.equal(f.backends[0].commands.some((command) => command.type === "permission-response" && command.approved), false);
});

test("shutdown failure remains visible and the host stays available for retry", async (t) => {
    const f = await fixture(t);
    f.ready();
    f.backends[0].failStop = true;
    await assert.rejects(f.host.close(), /Termination unconfirmed/);
    assert.equal(f.host.snapshot().phase, "error");
    assert.equal((await f.request("host/state")).status, 200);
    await f.host.close();
    assert.equal(f.host.snapshot().phase, "stopped");
});

test("Stop flushes the terminal state to connected browser tabs before closing HTTP", async (t) => {
    const f = await fixture(t);
    f.ready();
    const response = await f.request("host/events");
    const events = response.text();
    await f.host.close();
    assert.match(await events, /"phase":"stopped"/);
    assert.equal(f.backends[0].stops, 1);
});

test("protocol events and line buffers reject unsafe or unbounded input", () => {
    assert.throws(() => parseBackendEvent({ type: "permission", id: "a", title: "Test", details: "test", canAllowAllForSession: "yes" }));
    assert.throws(() => parseBackendEvent({ type: "question", id: "q", question: "Test", choices: [42] }));
    const stream = new PassThrough();
    const lines: string[] = [];
    let oversized = 0;
    consumeLines(stream, 12, (line) => lines.push(line), () => { oversized++; });
    stream.write(Buffer.from("abc\npart"));
    stream.write(Buffer.from("ial\n" + "x".repeat(50)));
    stream.write(Buffer.from("\nnext\n"));
    stream.write(Buffer.from("\u8a9e".repeat(10) + "\n"));
    assert.deepEqual(lines, ["abc", "partial", "next", "\u8a9e".repeat(10)]);
    assert.equal(oversized, 1);
    stream.end();
});

test("host responses preserve Unicode and oversized escaped answers retain their pending prompt", async (t) => {
    const f = await fixture(t);
    f.event({ type: "question", id: "unicode", question: "Answer", allowFreeform: true });
    const answer = "\u8a9e".repeat(32000);
    assert.equal((await f.command({ type: "question-response", id: "unicode", answer })).status, 202);
    assert.deepEqual(f.backends[0].commands.at(-1), { type: "question-response", id: "unicode", answer });
    f.event({ type: "question", id: "escaped", question: "Answer", allowFreeform: true });
    assert.equal((await f.command({ type: "question-response", id: "escaped", answer: "\0a".repeat(16000) })).status, 400);
    assert.equal(f.host.snapshot().requests[0].id, "escaped");
    assert.equal(f.backends[0].commands.length, 1);
});

test("diagnostics redact credentials and corrupt preferences are never overwritten", async () => {
    const root = await mkdtemp(join(tmpdir(), "tandem-browser-state-"));
    try {
        const warnings: string[] = [];
        const log = new HostDiagnostics((message) => warnings.push(message));
        await log.setWorkspace(root);
        log.write('Authorization: Bearer secret-value token="private-value" ghp_abcdefghijklmnopqrstuvwxyz');
        await log.flush();
        const output = await readFile(join(root, ".tandem", "desktop", "browser.log"), "utf8");
        assert.doesNotMatch(output, /secret-value|private-value|ghp_abc/);
        assert.match(redactDiagnostic("access_token=abc"), /\[redacted\]/);
        const preferences = new WorkspacePreferences(root, (message) => warnings.push(message));
        const path = join(root, "browser-workspaces.json");
        await writeFile(path, "{broken");
        await preferences.load();
        await preferences.remember(root);
        assert.equal(await readFile(path, "utf8"), "{broken");
        assert.ok(warnings.some((message) => message.includes("preserved")));
    } finally { await rm(root, { recursive: true, force: true }); }
});
