import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import type { PermissionRequest } from "@github/copilot-sdk";
import { DesktopProtocol, validateDesktopUrl } from "../src/desktop/protocol.js";
import { desktopRuntimeEnvironment } from "../src/desktop/environment.js";
import { desktopSessionConfig, parseDesktopModelSelection } from "../src/desktop/runtime.js";
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

test("native session errors retain notification identity without reclassifying runtime blockers by text", () => {
    const f = protocolFixture();
    try {
        const message = "Configure TANDEM_Speech__ResourceId and TANDEM_Speech__Region";
        f.protocol.reportSessionError({ id: "one", data: { errorType: "notification", message } });
        f.protocol.reportSessionError({ id: "two", data: { errorType: "notification", message } });
        for (const errorType of ["authentication", "query", "unknown"]) {
            f.protocol.reportSessionError({ id: errorType, data: { errorType, message } });
        }
        assert.deepEqual(f.events, [
            { type: "error", message, notificationId: "one" },
            { type: "error", message, notificationId: "two" },
            ...Array.from({ length: 3 }, () => ({ type: "error", message })),
        ]);
    } finally { f.protocol.close(); }
});
test("native host forwards only explicit model/effort choices and leaves ordinary resume settings unset", () => {
    const f = protocolFixture();
    try {
        assert.equal(parseDesktopModelSelection(), undefined);
        const ordinary = desktopSessionConfig("workspace", "runtime", f.protocol);
        assert.equal(Object.hasOwn(ordinary, "model"), false);
        assert.equal(Object.hasOwn(ordinary, "reasoningEffort"), false);
        const selected = parseDesktopModelSelection("gpt-6-astra", "low");
        assert.deepEqual(selected, { model: "gpt-6-astra", reasoningEffort: "low" });
        const config = desktopSessionConfig("workspace", "runtime", f.protocol, selected);
        assert.equal(config.model, "gpt-6-astra");
        assert.equal(config.reasoningEffort, "low");
        assert.equal(config.continuePendingWork, false);
        assert.equal(config.suppressResumeEvent, true);
        assert.deepEqual(parseDesktopModelSelection("gpt-6-astra"), { model: "gpt-6-astra" });
        for (const [model, effort] of [[undefined, "low"], ["", "low"], [" gpt-6-astra", "low"], ["gpt-6-astra", "invented"]]) {
            assert.throws(() => parseDesktopModelSelection(model, effort), /model|effort/);
        }
    } finally { f.protocol.close(); }
});

test("desktop sessions disable untracked question tools without changing tool permissions", async () => {
    const f = protocolFixture();
    try {
        const config = desktopSessionConfig("workspace", "runtime", f.protocol);
        assert.equal(config.streaming, true, "drawing workers inherit streaming from the desktop session");
        assert.equal(config.includeSubAgentStreamingEvents, true);
        assert.equal(config.extensionSdkPath, dirname(fileURLToPath(import.meta.resolve("@github/copilot-sdk"))),
            "Composed extensions must receive the host SDK that preserves terminal declarations.");
        assert.ok((await readFile(join(config.extensionSdkPath, "extension.js"), "utf8")).length > 0);
        assert.equal(config.onUserInputRequest, undefined, "the native question bridge must not be registered");
        assert.deepEqual(config.excludedTools, ["ask_user"]);
        assert.ok(config.hooks?.onPreToolUse);
        const hookInput = {
            sessionId: "desktop-worker", timestamp: new Date(), workingDirectory: "workspace",
            toolName: "ask_user", toolArgs: { question: "What are the second location's name and opening hours?" },
        };
        const rejected = await config.hooks.onPreToolUse(hookInput, { sessionId: "desktop" });
        assert.equal(rejected?.permissionDecision, "deny");
        assert.match(rejected!.permissionDecisionReason!, /tracked decision\/question/);
        assert.match(rejected!.permissionDecisionReason!, /Never invent a user answer/);
        assert.equal(await config.hooks.onPreToolUse({ ...hookInput, toolName: "read_file" }, { sessionId: "desktop" }), undefined);
        assert.equal(await config.hooks.onPreToolUse({ ...hookInput, toolName: "run_dynamic_workflow" }, { sessionId: "desktop" }), undefined);
        assert.deepEqual(f.events, [], "untracked question tools cannot emit native questions");
        const permission = config.onPermissionRequest!(desktopPermissionRequests.read, permissionInvocation);
        assert.equal(f.events[0].type, "permission");
        f.reply({ type: "permission-response", id: f.events[0].id, approved: true });
        assert.deepEqual(await permission, { kind: "approve-once", approvedInteractively: true });
        assert.equal(f.protocol.waitingForInput, false);
    } finally { f.protocol.close(); }
});

function shellPermission(fullCommandText = "Get-ChildItem"): Extract<PermissionRequest, { kind: "shell" }> {
    return {
        kind: "shell", fullCommandText, intention: "Run a shell command",
        commands: [{ identifier: fullCommandText, readOnly: false }],
        canOfferSessionApproval: false, hasWriteFileRedirection: false, possiblePaths: [], possibleUrls: [],
    };
}

test("extension environment access never inherits desktop allow-all", async () => {
    const f = protocolFixture();
    try {
        f.reply({ type: "set-permission-mode", mode: "allow-all" });
        const pending = f.protocol.permission({
            kind: "extension-env-access", extensionName: "owned-extension", environmentVariables: ["EXAMPLE_SECRET_NAME"],
        }, { sessionId: "desktop" });
        const prompt = f.events.find(event => event.type === "permission")!;
        assert.equal(prompt.canAllowAllForSession, false);
        f.reply({ type: "permission-response", id: prompt.id, approved: false });
        assert.equal((await pending).kind, "reject");
    } finally { f.protocol.close(); }
});

const desktopPermissionRequests = {
    shell: shellPermission(),
    read: { kind: "read", path: "example.txt", intention: "Read a file" },
    write: { kind: "write", fileName: "example.txt", diff: "+text", intention: "Write a file", canOfferSessionApproval: false },
    url: { kind: "url", url: "https://example.com", intention: "Fetch a page" },
    mcp: { kind: "mcp", serverName: "example", toolName: "test", toolTitle: "Test", readOnly: false },
    memory: { kind: "memory", fact: "Example fact" },
    "custom-tool": { kind: "custom-tool", toolName: "test", toolDescription: "Test" },
    hook: { kind: "hook", toolName: "test" },
    "extension-management": { kind: "extension-management", extensionName: "session:tandem", operation: "reload" },
    "extension-permission-access": {
        kind: "extension-permission-access", extensionName: "session:tandem", capabilities: ["register hooks"],
    },
    workflow: {
        kind: "workflow", name: "test", description: "Test", operation: "run", approvalKey: "test",
        canPersistApproval: false, phases: [], maxConcurrentSubagents: 1, maxTotalSubagents: 1,
        timeoutSeconds: 10, maxAiCredits: 1,
    },
} satisfies { [Kind in PermissionRequest["kind"]]: Extract<PermissionRequest, { kind: Kind }> };
const permissionInvocation = { sessionId: "desktop-test" };

function nativePermission(f: ReturnType<typeof protocolFixture>, request: PermissionRequest, requestId: string,
    agentId = "worker-a", sessionId = permissionInvocation.sessionId) {
    f.protocol.observeNativeEvent(sessionId, { type: "subagent.started", agentId, data: { workflowRunId: `workflow-${agentId}` } });
    f.protocol.observeNativeEvent(sessionId, { type: "permission.requested", agentId, data: { requestId, permissionRequest: request } });
}
const cancelledWorker = (f: ReturnType<typeof protocolFixture>, agentId = "worker-a", sessionId = permissionInvocation.sessionId) =>
    f.protocol.observeNativeEvent(sessionId, { type: "subagent.completed", agentId, data: { cancelled: true } });

test("native cancellation dismisses exact pending consent and stale Allow all cannot approve it", async () => {
    const f = protocolFixture();
    try {
        const request = { ...shellPermission(), toolCallId: "owned-tool" };
        nativePermission(f, request, "native-request");
        const permission = f.protocol.permission(request, permissionInvocation);
        await Promise.resolve();
        const id = f.events.find(event => event.type === "permission")!.id;
        cancelledWorker(f);
        assert.equal((await permission).kind, "reject");
        assert.equal(f.protocol.waitingForInput, false);
        assert.ok(f.events.some(event => event.type === "permission-resolved" && event.id === id));
        assert.ok(f.events.some(event => event.type === "status" && /dismissed/.test(String(event.message))));
        f.reply({ type: "permission-response", id, approved: true, allowAllForSession: true });
        assert.equal(f.events.at(-1)!.type, "error");
        assert.equal(f.protocol.permissionMode, "ask");
    } finally { f.protocol.close(); }
});

test("callback before native attribution waits and a previously cancelled worker never receives a prompt", async () => {
    const f = protocolFixture();
    try {
        const request = { ...shellPermission(), toolCallId: "late-attribution" };
        const permission = f.protocol.permission(request, permissionInvocation);
        await Promise.resolve();
        assert.equal(f.events.length, 0);
        cancelledWorker(f);
        nativePermission(f, request, "native-late");
        assert.equal((await permission).kind, "reject");
        assert.equal(f.events.filter(event => event.type === "permission").length, 0);
    } finally { f.protocol.close(); }
});

test("cancellation racing an already clicked UI approval fences the SDK decision", async () => {
    const f = protocolFixture();
    try {
        const request = { ...shellPermission(), toolCallId: "racing-tool" };
        nativePermission(f, request, "native-race");
        const permission = f.protocol.permission(request, permissionInvocation);
        await Promise.resolve();
        f.reply({ type: "permission-response", id: f.events.find(event => event.type === "permission")!.id, approved: true });
        cancelledWorker(f);
        assert.equal((await permission).kind, "reject");
    } finally { f.protocol.close(); }
});

test("cancelling one native worker leaves independent consent and normal completion intact", async () => {
    const f = protocolFixture();
    try {
        const a = { ...shellPermission("Get-Date"), toolCallId: "tool-a" };
        const b = { ...shellPermission("Get-Location"), toolCallId: "tool-b" };
        nativePermission(f, a, "request-a", "worker-a");
        nativePermission(f, b, "request-b", "worker-b");
        const first = f.protocol.permission(a, permissionInvocation), second = f.protocol.permission(b, permissionInvocation);
        await Promise.resolve();
        const secondId = f.events.filter(event => event.type === "permission")[1].id;
        cancelledWorker(f, "worker-b", "different-session");
        cancelledWorker(f, "worker-a");
        assert.equal((await first).kind, "reject");
        assert.equal(f.protocol.waitingForInput, true);
        f.protocol.observeNativeEvent(permissionInvocation.sessionId, { type: "subagent.completed",
            agentId: "worker-b", data: { cancelled: false } });
        f.reply({ type: "permission-response", id: secondId, approved: true });
        assert.deepEqual(await second, { kind: "approve-once", approvedInteractively: true });
    } finally { f.protocol.close(); }
});

test("native permission completion retires the UI without sending another decision", async () => {
    const f = protocolFixture();
    try {
        const request = { ...shellPermission(), toolCallId: "retired-tool" };
        nativePermission(f, request, "native-retired");
        const permission = f.protocol.permission(request, permissionInvocation);
        await Promise.resolve();
        const id = f.events.find(event => event.type === "permission")!.id;
        f.protocol.observeNativeEvent(permissionInvocation.sessionId, { type: "permission.completed",
            data: { requestId: "native-retired", result: { kind: "denied" } } });
        assert.deepEqual(await permission, { kind: "no-result" });
        assert.ok(f.events.some(event => event.type === "permission-resolved" && event.id === id));
        assert.equal(f.protocol.waitingForInput, false);
    } finally { f.protocol.close(); }
});

test("Close releases a permission callback still waiting for native attribution", async () => {
    const f = protocolFixture();
    const permission = f.protocol.permission({ ...shellPermission(), toolCallId: "not-yet-attributed" }, permissionInvocation);
    f.protocol.close();
    assert.equal((await permission).kind, "reject");
});

test("native permission identity remains session-specific and sequential requests do not reuse an old decision", async () => {
    const f = protocolFixture();
    try {
        const request = { ...shellPermission(), toolCallId: "sequential-tool" };
        const first = f.protocol.permission(request, permissionInvocation);
        nativePermission(f, request, "foreign-request", "worker-a", "foreign-session");
        await Promise.resolve();
        assert.equal(f.events.length, 0);
        nativePermission(f, request, "first-request");
        await Promise.resolve();
        f.reply({ type: "permission-response", id: f.events.find(event => event.type === "permission")!.id, approved: false });
        assert.equal((await first).kind, "reject");
        f.protocol.observeNativeEvent(permissionInvocation.sessionId, { type: "permission.completed", data: { requestId: "first-request" } });
        nativePermission(f, request, "next-request");
        const second = f.protocol.permission(request, permissionInvocation);
        await Promise.resolve();
        const prompts = f.events.filter(event => event.type === "permission");
        assert.equal(prompts.length, 2);
        f.reply({ type: "permission-response", id: prompts[1].id, approved: true });
        assert.deepEqual(await second, { kind: "approve-once", approvedInteractively: true });
    } finally { f.protocol.close(); }
});

for (const request of Object.values(desktopPermissionRequests)) {
    test(`desktop asks before approving ${request.kind} by default`, async () => {
        const f = protocolFixture();
        try {
            const permission = f.protocol.permission(request, permissionInvocation);
            assert.equal(f.protocol.permissionMode, "ask");
            assert.equal(f.protocol.waitingForInput, true);
            assert.equal(f.events[0].type, "permission");
            assert.equal(f.events[0].canAllowAllForSession, true);
            assert.deepEqual(JSON.parse(String(f.events[0].details)), request);
            f.reply({ type: "permission-response", id: f.events[0].id, approved: true });
            assert.deepEqual(await permission, { kind: "approve-once", approvedInteractively: true });
            assert.equal(f.protocol.permissionMode, "ask", "Allow once does not grant future permissions.");
            assert.equal(f.events.length, 1);
            assert.equal(f.protocol.waitingForInput, false);
        } finally { f.protocol.close(); }
    });
}

test("desktop allow-all is explicit, covers all tool kinds, and resets with each backend", async () => {
    for (let cycle = 0; cycle < 2; cycle++) {
        const f = protocolFixture();
        try {
            assert.equal(f.protocol.permissionMode, "ask");
            f.reply({ type: "set-permission-mode", mode: "allow-all" });
            assert.deepEqual(f.events, [{ type: "permission-mode", mode: "allow-all" }]);
            for (const request of Object.values(desktopPermissionRequests)) {
                assert.deepEqual(await f.protocol.permission(request, permissionInvocation), { kind: "approve-once" });
            }
            const results = await Promise.all(Array.from({ length: 32 }, (_, index) =>
                f.protocol.permission(index % 2 ? shellPermission() : desktopPermissionRequests.read, permissionInvocation)));
            assert.ok(results.every((result) => result.kind === "approve-once"));
            assert.equal(f.events.length, 1);
            assert.equal(f.protocol.waitingForInput, false);
        } finally { f.protocol.close(); }
    }
});

test("desktop allow-all still asks for managed-policy and sandbox-bypass requests", async () => {
    const f = protocolFixture();
    try {
        f.reply({ type: "set-permission-mode", mode: "allow-all" });
        for (const [request, invocation] of [
            [{ ...shellPermission(), managedApprovalRequired: true }, permissionInvocation],
            [{ ...desktopPermissionRequests.read, managedApprovalRequired: true }, permissionInvocation],
            [shellPermission(), { ...permissionInvocation, managedSettingsEnabled: true }],
            [{ ...shellPermission(), requestSandboxBypass: true }, permissionInvocation],
        ] as const) {
            const permission = f.protocol.permission(request, invocation);
            const event = f.events.at(-1)!;
            assert.equal(event.type, "permission");
            assert.equal(event.canAllowAllForSession, false);
            assert.match(String(event.details), /managed|sandbox/i);
            f.reply({ type: "permission-response", id: event.id, approved: true, allowAllForSession: true });
            assert.equal(f.events.at(-1)!.type, "error", "A policy prompt cannot opt into allow-all.");
            assert.equal(f.protocol.waitingForInput, true);
            f.reply({ type: "permission-response", id: event.id, approved: true });
            assert.deepEqual(await permission, { kind: "approve-once", approvedInteractively: true });
            assert.equal(f.protocol.waitingForInput, false);
        }
    } finally { f.protocol.close(); }
});

test("Allow all from a prompt releases only ordinary queued permissions, not policy requests or questions", async () => {
    const f = protocolFixture();
    try {
        const first = f.protocol.permission(shellPermission(), permissionInvocation);
        const second = f.protocol.permission(desktopPermissionRequests.write, permissionInvocation);
        const managed = f.protocol.permission({ ...desktopPermissionRequests.read, managedApprovalRequired: true }, permissionInvocation);
        const question = f.protocol.question({ question: "Continue?", choices: ["Yes"] });
        const [firstEvent, secondEvent, managedEvent, questionEvent] = f.events;
        f.reply({ type: "permission-response", id: firstEvent.id, approved: true, allowAllForSession: true });
        assert.deepEqual(await first, { kind: "approve-once", approvedInteractively: true });
        assert.deepEqual(await second, { kind: "approve-once" }, "Queued actions were not individually approved.");
        assert.equal(f.protocol.permissionMode, "allow-all");
        assert.deepEqual(f.events.filter((event) => event.type === "permission-resolved"),
            [{ type: "permission-resolved", id: secondEvent.id }]);
        assert.equal(f.protocol.waitingForInput, true);
        f.reply({ type: "permission-response", id: managedEvent.id, approved: false });
        f.reply({ type: "question-response", id: questionEvent.id, answer: "Yes" });
        assert.deepEqual(await managed, { kind: "reject" });
        assert.deepEqual(await question, { answer: "Yes", wasFreeform: false });
        f.reply({ type: "permission-response", id: secondEvent.id, approved: true, allowAllForSession: true });
        assert.equal(f.events.at(-1)!.type, "error", "Late dialog replies cannot authorize another request.");
        assert.equal(f.protocol.waitingForInput, false);
    } finally { f.protocol.close(); }
});

test("desktop mode revocation fences pending and in-flight automatic approvals", async () => {
    const f = protocolFixture();
    try {
        const pending = f.protocol.permission(shellPermission(), permissionInvocation);
        const oldId = f.events.at(-1)!.id;
        f.reply({ type: "set-permission-mode", mode: "allow-all" });
        f.reply({ type: "set-permission-mode", mode: "ask" });
        await Promise.resolve();
        const newEvent = f.events.at(-1)!;
        assert.equal(newEvent.type, "permission");
        assert.notEqual(newEvent.id, oldId);
        f.reply({ type: "permission-response", id: newEvent.id, approved: false });
        assert.deepEqual(await pending, { kind: "reject" });
        f.reply({ type: "set-permission-mode", mode: "allow-all" });
        const automatic = f.protocol.permission(shellPermission(), permissionInvocation);
        f.reply({ type: "set-permission-mode", mode: "ask" });
        await Promise.resolve();
        assert.equal(f.events.at(-1)!.type, "permission");
        f.reply({ type: "permission-response", id: f.events.at(-1)!.id, approved: false });
        assert.deepEqual(await automatic, { kind: "reject" });
    } finally { f.protocol.close(); }
});

test("desktop invalid replies and oversized permission details cannot grant approval", async () => {
    const f = protocolFixture();
    try {
        f.reply({ type: "set-permission-mode", mode: "always" });
        assert.equal(f.protocol.permissionMode, "ask");
        assert.equal(f.events.at(-1)!.type, "error");
        const pending = f.protocol.permission(shellPermission(), permissionInvocation);
        const id = f.events.at(-1)!.id;
        for (const response of [{ approved: "yes" }, { approved: false, allowAllForSession: true },
            { approved: true, allowAllForSession: "yes" }]) {
            f.reply({ type: "permission-response", id, ...response });
            assert.equal(f.protocol.waitingForInput, true);
            assert.equal(f.protocol.permissionMode, "ask");
            assert.equal(f.events.at(-1)!.type, "error");
        }
        f.reply({ type: "permission-response", id, approved: false });
        assert.deepEqual(await pending, { kind: "reject" });
        assert.equal((await f.protocol.permission(shellPermission("x".repeat(64 * 1024)), permissionInvocation)).kind, "reject");
        assert.match(String(f.events.at(-1)!.message), /too large/);
        assert.equal(f.protocol.waitingForInput, false);
    } finally { f.protocol.close(); }
});

test("desktop shutdown releases input, rejects pending questions, and stops tool approvals", async () => {
    const f = protocolFixture();
    const question = f.protocol.question({ question: "Continue?" });
    const rejected = assert.rejects(question, /closing/);
    const permission = f.protocol.permission(shellPermission(), permissionInvocation);
    f.protocol.close();
    await rejected;
    assert.deepEqual(await permission, { kind: "reject" });
    await assert.rejects(f.protocol.permission(shellPermission(), permissionInvocation), /closed|closing/);
    assert.equal(f.input.destroyed, true);
    assert.equal(f.protocol.waitingForInput, false);
    assert.equal(f.shutdowns(), 1);
});

test("desktop rejects stale approval messages instead of resolving unrelated questions", async () => {
    const f = protocolFixture();
    try {
        const question = f.protocol.question({ question: "Continue?", choices: ["Yes"], allowFreeform: false });
        const id = f.events[0].id;
        f.reply({ type: "permission-response", id, approved: true });
        assert.equal(f.events[1].type, "error");
        assert.equal(f.protocol.waitingForInput, true);
        f.reply({ type: "question-response", id, answer: "Yes" });
        assert.deepEqual(await question, { answer: "Yes", wasFreeform: false });
    } finally { f.protocol.close(); }
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
