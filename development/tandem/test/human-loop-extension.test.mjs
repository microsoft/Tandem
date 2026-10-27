import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PermissionBroker } from "../runtime-src/permissions/permission-broker.ts";
import { getHostStateWal } from "../runtime-src/domain/host-state-wal.ts";
import { HumanLoopEvents, projectHumanProgress } from "../src/human-loop-provider.mjs";
import { HumanLoopPreferences, normalizeModelCatalog, validateProjectReasoningEffort } from "../src/human-loop-preferences.mjs";
import { createBrowserEntry } from "../src/human-loop-browser-entry.mjs";
import { createNativePermissionLifecycle } from "../src/native-permission-lifecycle.mjs";
import { privateReviewRegistration } from "../src/native-evidence-workflow.mjs";

test("active extension isolates private history, keeps view ownership and registers no legacy execution tools", async () => {
  const root = await mkdtemp(join(tmpdir(), "human-extension-"));
  await new HumanLoopPreferences(root).update({ model: "fixture" });
  let registration, instance, providerOptions, ready = false, extension;
  let providerCreates = 0, providerCloses = 0, wakes = 0, runtimeCloses = 0;
  const browserCalls = [];
  const main = { sessionId: "main",
    getEvents: async () => assert.fail("Private Development must not read or copy parent chat history."),
    on: () => assert.fail("Do not bridge main-chat events into the private runtime."),
    rpc: { mode: { get: async () => "interactive" } } };
  const runtime = {
    store: { recordMessage: async () => assert.fail("Do not manufacture private conversation from main chat.") },
    wake() { wakes++; },
    send() { assert.fail("Opening a view or observing main events cannot submit work."); },
    readiness: async () => ({ status: "ready" }),
    modelSettings: async () => ({ actual: "fixture", desired: "fixture" }),
  };
  class Installation {
    constructor(options) { this.options = options; this.runtime = null; instance = this; }
    async open() { ready = true; this.runtime = runtime; return runtime; }
    async read() { return { status: ready ? "ready" : "new" }; }
    async guardMainTool() { return undefined; }
    async close() { runtimeCloses++; ready = false; return { status: "closed", warnings: [] }; }
  }
  const url = new URL("../src/extension.mjs", import.meta.url);
  const controllerUrl = new URL("../src/human-loop-controller.mjs", import.meta.url);
  const controllerSource = (await readFile(controllerUrl, "utf8"))
    .replace(/^import[\s\S]*?;\r?\n/gm, "").replaceAll("export function", "function").replaceAll("export async function", "async function")
    .replaceAll("import.meta.url", JSON.stringify(controllerUrl.href));
  const source = (await readFile(url, "utf8")).replace(/^import[\s\S]*?;\r?\n/gm, "")
    .replaceAll('import.meta.resolve("@github/copilot-sdk")', JSON.stringify("installed-sdk"))
    .replaceAll("import.meta.url", JSON.stringify(url.href))
    .replace("await controller.attach(session);", "await controller.attach(session); return {canvas, controller};");
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  try {
    extension = await new AsyncFunction("process", "fileURLToPath", "randomUUID", "createCanvas", "joinSession", "PermissionBroker",
      "HumanLoopInstallation", "HumanLoopRuntime", "HumanLoopEvents", "createHumanLoopProvider", "openBrowserCanvas",
      "createBrowserEntry", "createNativePermissionLifecycle", "join", "homedir", "defineWorkflow", "privateReviewRegistration",
      "HumanLoopPreferences", "normalizeModelCatalog", "validateProjectReasoningEffort", "projectHumanProgress",
      `${controllerSource}\n${source}`)(
      { cwd: () => root, env: {} }, fileURLToPath, () => "registration", definition => definition,
      async value => { registration = value; return main; }, PermissionBroker, Installation, class {}, HumanLoopEvents,
      async options => {
        providerCreates++; providerOptions = options;
        return { url: "http://127.0.0.1:1/", close: async () => { providerCloses++; } };
      },
      async (...args) => { browserCalls.push(args); return { instanceId: "browser" }; },
      createBrowserEntry, createNativePermissionLifecycle, join, homedir, value => value,
      (define, get) => privateReviewRegistration(define, get, {}),
      HumanLoopPreferences, normalizeModelCatalog, validateProjectReasoningEffort, projectHumanProgress,
    );
    assert.equal(wakes, 0);
    assert.deepEqual(registration.canvases.map(({ id, displayName }) => ({ id, displayName })),
      [{ id: "tandem", displayName: "Tandem" }]);
    assert.deepEqual(registration.tools.map(tool => tool.name), ["tandem_open_browser"]);
    assert.equal(registration.canvases[0].actions.some(({ name }) => /approve|apply|submit.*answer/.test(name)), false);
    for (const type of ["user.message", "assistant.message", "assistant.reasoning", "assistant.idle", "session.idle"]) {
      registration.onEvent({ type, data: { content: "Parent-only content" } });
    }
    assert.equal(wakes, 0);
    assert.doesNotMatch(JSON.stringify(extension.controller.events.list()), /Parent-only content/);
    await extension.canvas.open({ instanceId: "test" });
    await extension.controller.start();
    assert.equal(instance.runtime, runtime);
    assert.equal(providerCreates, 1);
    assert.deepEqual(await providerOptions.openBrowser("http://127.0.0.1:55741/", { focus: false }), { instanceId: "browser" });
    assert.deepEqual(browserCalls, [[main, "http://127.0.0.1:55741/", { focus: false }]]);
    assert.equal(extension.canvas.close, undefined, "The SDK uses onClose.");
    await extension.canvas.open({ instanceId: "test" });
    await extension.controller.start();
    assert.equal(providerCreates, 1);
    await extension.canvas.onClose({ instanceId: "test" });
    await extension.canvas.onClose({ instanceId: "test" });
    assert.equal(providerCloses, 1);
    assert.equal(runtimeCloses, 0, "Closing a view does not close the private runtime.");
    await extension.canvas.open({ instanceId: "test" });
    await extension.controller.start();
    assert.equal(providerCreates, 2);
    await extension.canvas.onClose({ instanceId: "test" });
    assert.equal(providerCloses, 2);

    const permission = { kind: "custom-tool", toolName: "tandem_open_browser",
      toolDescription: "Open the UI", args: {}, toolCallId: "opening-call" };
    const pending = registration.onPermissionRequest(permission, { sessionId: "main" });
    registration.onEvent({ type: "permission.requested", data: { requestId: "native-opening", permissionRequest: permission } });
    assert.equal(providerOptions.permissions.list().length, 1);
    registration.onEvent({ type: "permission.completed", data: {
      requestId: "native-opening", toolCallId: "wrong-call", result: { kind: "approved" },
    } });
    assert.equal(providerOptions.permissions.list().length, 1);
    assert.ok(extension.controller.events.list().some(event => event.type === "human.permission-sync-failed"));
    registration.onEvent({ type: "permission.completed", data: {
      requestId: "native-opening", toolCallId: "opening-call", result: { kind: "approved" },
    } });
    assert.deepEqual(await pending, { kind: "no-result" });
    assert.deepEqual(providerOptions.permissions.list(), []);
    const local = JSON.parse(await registration.tools[0].handler({}, { sessionId: "main" }));
    assert.equal(local.url, "http://127.0.0.1:1/");
    assert.equal(providerOptions.surface, "browser");
    assert.equal(providerOptions.openBrowser, undefined);
    assert.equal(providerCreates, 3);
    await extension.controller.start();
    const beforeIdle = wakes;
    registration.onEvent({ type: "assistant.idle" });
    assert.equal(wakes, beforeIdle);
    const openBrowser = registration.canvases[0].actions.find(action => action.name === "open_browser");
    assert.deepEqual(await openBrowser.handler({ sessionId: "main", input: {} }), local);
    assert.equal(providerCreates, 3);
    await registration.hooks.onSessionEnd({ reason: "complete" }, { sessionId: "main" });
    await registration.hooks.onSessionEnd({ reason: "user_exit" }, { sessionId: "foreign" });
    assert.equal(providerCloses, 2);
    await registration.hooks.onSessionEnd({ reason: "user_exit" }, { sessionId: "main" });
    assert.equal(providerCloses, 3);
    assert.equal(runtimeCloses, 1);
  } finally {
    extension?.controller.events.close();
    await getHostStateWal(root).close();
    await rm(root, { recursive: true, force: true });
  }
});
