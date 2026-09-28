import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PermissionBroker } from "../runtime-src/permissions/permission-broker.ts";
import { HumanLoopEvents } from "../src/human-loop-provider.mjs";
import { createBrowserEntry } from "../src/human-loop-browser-entry.mjs";
import { createNativePermissionLifecycle } from "../src/native-permission-lifecycle.mjs";

test("active extension defers root audit until ownership setup, preserves originals, and registers no legacy execution tools", async () => {
  const root = await mkdtemp(join(tmpdir(), "human-extension-"));
  const original = [
    { id: "u", type: "user.message", timestamp: "2026-09-14T00:00:00Z", data: { content: "  Exact root user\nmessage." } },
    { id: "a", type: "assistant.message", timestamp: "2026-09-14T00:00:01Z", data: { content: "Exact root assistant." } },
    { id: "r", type: "assistant.reasoning", timestamp: "2026-09-14T00:00:02Z", data: { content: "PRIVATE reasoning" } },
  ];
  const records = [], order = [];
  let registration, mainHandler, instance, providerOptions, ready = false, holdAudit = null;
  let providerCreates = 0, providerCloses = 0, wakes = 0;
  const browserCalls = [];
  const main = { sessionId: "main", getEvents: async () => original, on: (handler) => { mainHandler = handler; },
    rpc: { mode: { get: async () => "interactive" } } };
  const runtime = { store: { recordMessage: async (entry) => {
    assert.equal(ready, true);
    if (holdAudit) { holdAudit.entered.resolve(); await holdAudit.release.promise; }
    records.push(entry);
  } }, wake() { wakes++; }, send() { assert.fail("Main-chat observation must never admit a Tandem request."); },
  readiness: async () => ({ status: "ready" }) };
  class Installation {
    constructor(options) { this.options = options; this.runtime = null; instance = this; }
    async open() {
      if (!this.runtime) { assert.equal(records.length, 0); order.push("owner-established"); }
      ready = true; this.runtime = runtime; return runtime;
    }
    async read() { return { status: ready ? "ready" : "new" }; }
    async guardMainTool() { return undefined; }
  }
  const url = new URL("../src/extension.mjs", import.meta.url);
  let source = await readFile(url, "utf8");
  source = source.replace(/^import[\s\S]*?;\r?\n/gm, "")
    .replaceAll('import.meta.resolve("@github/copilot-sdk")', JSON.stringify("installed-sdk"))
    .replaceAll("import.meta.url", JSON.stringify(url.href));
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  let extension;
  try {
    extension = await new AsyncFunction("process", "fileURLToPath", "randomUUID", "createCanvas", "joinSession", "PermissionBroker",
      "HumanLoopInstallation", "HumanLoopRuntime", "HumanLoopEvents", "createHumanLoopProvider", "openBrowserCanvas", "createBrowserEntry", "createNativePermissionLifecycle",
      `${source}\nreturn {canvas, originals, events, flushOriginals, start};`)(
      { cwd: () => root }, fileURLToPath, () => "registration", (definition) => definition,
      async (value) => { registration = value; return main; }, PermissionBroker, Installation, class {}, HumanLoopEvents,
      async (options) => { providerCreates++; providerOptions = options;
        return { url: "http://127.0.0.1:1/", close: async () => { providerCloses++; } }; },
      async (...args) => { browserCalls.push(args); return { instanceId: "browser" }; },
      createBrowserEntry, createNativePermissionLifecycle,
    );
    assert.equal(records.length, 0);
    assert.equal(extension.originals.size, 2);
    assert.deepEqual(registration.canvases.map(({ id, displayName }) => ({ id, displayName })),
      [{ id: "tandem", displayName: "Tandem" }]);
    assert.deepEqual(registration.tools.map(tool => tool.name), ["tandem_open_browser"]);
    assert.equal(registration.canvases[0].actions.some(({ name }) => /approve|apply|submit.*answer/.test(name)), false);
    await extension.canvas.open({ instanceId: "test" });
    for (let i = 0; i < 100 && records.length < 2; i++) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(order, ["owner-established"]);
    assert.equal(records.length, 2);
    assert.equal(records[0].content, original[0].data.content);
    assert.equal(records[0].timestamp, original[0].timestamp);
    assert.equal(records[0].role, "host-user");
    assert.ok(records.every(record => record.requestId === null));
    assert.deepEqual(await providerOptions.openBrowser("http://127.0.0.1:55741/", { focus: false }), { instanceId: "browser" });
    assert.deepEqual(browserCalls, [[main, "http://127.0.0.1:55741/", { focus: false }]]);
    assert.equal(records.length, 2, "Opening Host browser UI must not insert an agent/workflow turn.");
    assert.doesNotMatch(JSON.stringify(records), /PRIVATE reasoning/);
    mainHandler(original[0]); await extension.flushOriginals();
    assert.equal(records.length, 2);
    holdAudit = { entered: Promise.withResolvers(), release: Promise.withResolvers() };
    mainHandler({ ...original[0], id: "in-flight", data: { content: "Exact in-flight original." } });
    await holdAudit.entered.promise;
    let drained = false;
    const closing = instance.options.beforeClose().then(() => { drained = true; });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(drained, false, "Close must wait for admitted audit persistence.");
    holdAudit.release.resolve(); await closing; holdAudit = null; ready = false;
    mainHandler({ ...original[0], id: "while-closed", data: { content: "Exact closed original." } });
    await extension.flushOriginals();
    assert.equal(records.length, 3);
    assert.equal(extension.originals.has("while-closed"), true);
    ready = true; instance.options.afterReady(); await extension.flushOriginals();
    assert.equal(records.length, 4);
    assert.equal(records[3].content, "Exact closed original.");
    mainHandler({ ...original[0], id: "while-closed", data: { content: "Exact closed original." } });
    await extension.flushOriginals();
    assert.equal(records.length, 4);
    assert.equal(extension.canvas.close, undefined, "The SDK accepts onClose, not a close declaration.");
    await extension.canvas.open({ instanceId: "test" });
    await extension.start();
    assert.equal(providerCreates, 1, "Opening an existing panel reuses its server.");
    await extension.canvas.onClose({ instanceId: "test" });
    await extension.canvas.onClose({ instanceId: "test" });
    assert.equal(providerCloses, 1, "Repeated panel close only closes its server once.");
    assert.equal(instance.runtime, runtime, "Panel close does not close or replace the workflow.");
    await extension.canvas.open({ instanceId: "test" });
    await extension.start();
    assert.equal(providerCreates, 2, "Reopening a closed panel creates a new server.");
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
    assert.ok(extension.events.list().some(event => event.type === "human.permission-sync-failed"));
    registration.onEvent({ type: "permission.completed", data: {
      requestId: "native-opening", toolCallId: "opening-call", result: { kind: "approved" },
    } });
    assert.deepEqual(await pending, { kind: "no-result" });
    assert.deepEqual(providerOptions.permissions.list(), []);
    assert.equal(providerCreates, 2, "Native permission completion does not open the browser or start setup.");
    const local = JSON.parse(await registration.tools[0].handler({}, { sessionId: "main" }));
    assert.equal(local.url, "http://127.0.0.1:1/");
    assert.equal(providerOptions.surface, "browser");
    assert.equal(providerOptions.openBrowser, undefined);
    assert.equal(providerCreates, 3);
    assert.equal(instance.runtime, runtime, "The CLI browser shares the app's actual installation/runtime.");
    assert.equal(records.length, 4);
    await extension.start();
    const beforeIdle = wakes;
    mainHandler({ type: "assistant.idle" });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(wakes, beforeIdle, "Main idle must not schedule private runtime work.");
    const openBrowser = registration.canvases[0].actions.find(action => action.name === "open_browser");
    assert.deepEqual(await openBrowser.handler({ sessionId: "main", input: {} }), local);
    assert.equal(providerCreates, 3, "Canvas fallback uses the independently owned browser provider.");
    await registration.hooks.onSessionEnd({ reason: "complete" }, { sessionId: "main" });
    assert.equal(providerCloses, 2, "Ordinary response completion must not close the browser.");
    await registration.hooks.onSessionEnd({ reason: "user_exit" }, { sessionId: "foreign" });
    assert.equal(providerCloses, 2);
    await registration.hooks.onSessionEnd({ reason: "user_exit" }, { sessionId: "main" });
    assert.equal(providerCloses, 3, "Owning-session exit closes the separately owned browser.");
    assert.ok(records.every(record => record.requestId === null));
    assert.deepEqual(order, ["owner-established"]);
    assert.equal(records.length, 4);
  } finally { extension?.events.close(); await rm(root, { recursive: true, force: true }); }
});
