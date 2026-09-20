import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { DesktopProtocol, validateDesktopUrl } from "../src/desktop/protocol.js";
import { desktopRuntimeEnvironment } from "../src/desktop/environment.js";
import { claimDesktopWorkspace } from "../src/desktop/workspace.js";
import { isPreferredTandemProvider, preferredTandemProvider } from "../src/provider-identity.js";
import { canvasRequestAllowed } from "../src/canvas-transport.js";
import { extensionHarness } from "./helpers/extension-harness.js";

test("desktop accepts only root loopback application URLs", () => {
    assert.equal(validateDesktopUrl("http://127.0.0.1:1234/").origin, "http://127.0.0.1:1234");
    for (const url of ["https://example.com/", "http://localhost:1234/", "http://127.0.0.1/", "file:///C:/secret",
        "http://user@127.0.0.1:1234/", "http://127.0.0.1:1234/path", "http://127.0.0.1:1234/?token=value",
        "http://127.0.0.1:0/", "http://127.0.0.1:1234/\n", " http://127.0.0.1:1234/"]) {
        assert.throws(() => validateDesktopUrl(url));
    }
});

test("independent runtimes do not inherit another host's session or tool trampoline", () => {
    const source = { SESSION_ID: "parent", COPILOT_TRAMPOLINE_PORT: "1234", COPILOT_TRAMPOLINE_TOKEN: "parent-only",
        COPILOT_SDK_PATH: "parent-sdk", COPILOT_HOME: "user-home", PATH: "tools", TANDEM_Speech__Region: "eastus" };
    const environment = desktopRuntimeEnvironment(source);
    assert.equal(environment.SESSION_ID, undefined);
    assert.equal(environment.COPILOT_TRAMPOLINE_PORT, undefined);
    assert.equal(environment.COPILOT_TRAMPOLINE_TOKEN, undefined);
    assert.equal(environment.COPILOT_SDK_PATH, undefined);
    assert.equal(environment.COPILOT_HOME, "user-home");
    assert.equal(environment.PATH, "tools");
    assert.equal(environment.TANDEM_Speech__Region, "eastus");
    assert.equal(source.SESSION_ID, "parent");
});

test("desktop provider is session-bound and preserves installed provider precedence", () => {
    const session = { id: "session:current:tandem", status: "running" };
    const project = { id: "project:tandem", status: "running" };
    const user = { id: "user:tandem", status: "running" };
    assert.equal(preferredTandemProvider([session], "current"), session.id);
    assert.equal(preferredTandemProvider([session], "other"), undefined);
    assert.equal(preferredTandemProvider([session, project], "current"), project.id);
    assert.equal(preferredTandemProvider([session, project, user], "current"), user.id);
    assert.equal(preferredTandemProvider([{ ...session, status: "failed" }], "current"), undefined);
    assert.equal(isPreferredTandemProvider("session:tandem", [session], "current"), true);
    assert.equal(isPreferredTandemProvider("session:tandem", [session], "other"), false);
    assert.equal(isPreferredTandemProvider("session:tandem", [session, user], "current"), false);
});

test("canvas transport rejects cross-origin API requests and rebinding hosts but permits embedding", () => {
    const origin = "http://127.0.0.1:1234";
    const request = { method: "POST", url: "/api/answer", headers: { host: "127.0.0.1:1234", origin } };
    assert.equal(canvasRequestAllowed(request, origin), true);
    assert.equal(canvasRequestAllowed({ ...request, headers: { ...request.headers, origin: "https://untrusted.example" } }, origin), false);
    assert.equal(canvasRequestAllowed({ ...request, headers: { ...request.headers, host: "untrusted.example:1234" } }, origin), false);
    assert.equal(canvasRequestAllowed({
        method: "GET", url: "/api/state", headers: { host: "127.0.0.1:1234", "sec-fetch-site": "cross-site" },
    }, origin), false);
    assert.equal(canvasRequestAllowed({
        method: "GET", url: "/", headers: { host: "127.0.0.1:1234", "sec-fetch-site": "cross-site" },
    }, origin), true);
});

function protocolFixture() {
    const input = new PassThrough();
    const output = new PassThrough();
    const events: Record<string, unknown>[] = [];
    let shutdowns = 0;
    output.on("data", (data: Buffer) => events.push(JSON.parse(data.toString())));
    const protocol = new DesktopProtocol(input, output, () => { shutdowns++; });
    return { input, events, protocol, shutdowns: () => shutdowns,
        reply(value: Record<string, unknown>) { input.write(`${JSON.stringify(value)}\n`); } };
}

test("desktop permissions require a matching, explicit native approval; malformed approval is denied", async () => {
    const f = protocolFixture();
    try {
        const permission = f.protocol.permission({ kind: "read", path: "example.txt" });
        assert.equal(f.protocol.waitingForInput, true);
        assert.equal(f.events[0].type, "permission");
        f.reply({ type: "question-response", id: f.events[0].id, approved: true });
        assert.equal(f.events[1].type, "error");
        f.reply({ type: "permission-response", id: f.events[0].id, approved: "true" });
        assert.deepEqual(await permission, { kind: "reject" });
        assert.equal(f.protocol.waitingForInput, false);
        const approved = f.protocol.permission({ kind: "read", path: "example.txt" });
        f.reply({ type: "permission-response", id: f.events.at(-1)!.id, approved: true });
        assert.deepEqual(await approved, { kind: "approve-once" });
    } finally { f.protocol.close(); }
});

test("desktop shutdown releases an open input pipe and rejects pending consent", async () => {
    const f = protocolFixture();
    const permission = f.protocol.permission({ kind: "read", path: "example.txt" });
    const rejected = assert.rejects(permission, /closing/);
    f.protocol.close();
    await rejected;
    assert.equal(f.input.destroyed, true);
    assert.equal(f.protocol.waitingForInput, false);
    assert.equal(f.shutdowns(), 1);
});

test("desktop question choices and cancellation are enforced and pending requests close", async () => {
    const f = protocolFixture();
    try {
        const question = f.protocol.question({ question: "Continue?", choices: ["Yes", "No"], allowFreeform: false });
        f.reply({ type: "question-response", id: f.events.at(-1)!.id, answer: "Yes", wasFreeform: true });
        assert.deepEqual(await question, { answer: "Yes", wasFreeform: false });
        const invalid = f.protocol.question({ question: "Continue?", choices: ["Yes"], allowFreeform: false });
        f.reply({ type: "question-response", id: f.events.at(-1)!.id, answer: "Unexpected" });
        await assert.rejects(invalid, /offered answers/);
        const cancelled = f.protocol.question({ question: "Continue?" });
        f.reply({ type: "question-response", id: f.events.at(-1)!.id, cancelled: true });
        await assert.rejects(cancelled, /cancelled/);
        const pending = f.protocol.question({ question: "Continue?" });
        f.input.end();
        await assert.rejects(pending, /closing/);
        assert.equal(f.shutdowns(), 1);
    } finally { f.protocol.close(); }
});

test("desktop session identity survives restart, excludes a second window, and preserves corrupt records", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "tandem-desktop-"));
    let release: (() => Promise<void>) | undefined;
    try {
        const first = await claimDesktopWorkspace(workspace, (error) => { throw error; });
        release = first.release;
        assert.equal(first.resume, false);
        await first.save();
        await assert.rejects(claimDesktopWorkspace(workspace, () => {}), /already open/);
        await first.release();
        release = undefined;
        const second = await claimDesktopWorkspace(workspace, (error) => { throw error; });
        release = second.release;
        assert.equal(second.resume, true);
        assert.equal(second.sessionId, first.sessionId);
        await second.release();
        release = undefined;
        const directory = join(workspace, ".tandem", "desktop");
        const key = (await readdir(directory))[0];
        const file = join(directory, key, "session.json");
        await writeFile(file, '{"broken":true}');
        await assert.rejects(claimDesktopWorkspace(workspace, () => {}), /Invalid desktop session identity/);
        assert.equal(await readFile(file, "utf8"), '{"broken":true}');
    } finally {
        await release?.();
        await rm(workspace, { recursive: true, force: true });
    }
});

test("session-scoped Tandem opens writable without a goal or worker launch", async () => {
    const h = await extensionHarness();
    const extensionId = `session:${h.session.sessionId}:tandem`;
    h.api.setSession({ ...h.session, rpc: { ...h.session.rpc, extensions: {
        list: async () => ({ extensions: [{ id: extensionId, status: "running" }] }),
    } } });
    try {
        const opened = await h.api.openTandem({
            instanceId: "desktop-main", extensionId: "session:tandem", sessionId: h.session.sessionId, input: {},
        });
        const response = await fetch(new URL("api/state", opened.url));
        const state = await response.json() as { goal: string; provider: { canSubmitAnswers: boolean; canReload: boolean } };
        assert.equal(state.goal, "");
        assert.equal(state.provider.canSubmitAnswers, true);
        assert.equal(state.provider.canReload, false);
        assert.equal(h.requests.length, 0);
    } finally { await h.close(); }
});
