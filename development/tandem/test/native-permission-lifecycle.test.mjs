import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PermissionBroker } from "../runtime-src/permissions/permission-broker.ts";
import { createNativePermissionLifecycle } from "../src/native-permission-lifecycle.mjs";
import { createBrowserEntry } from "../src/human-loop-browser-entry.mjs";
import { requireSetupSession } from "../src/workflow-setup-discovery.mjs";
import { createHumanLoopProvider, HumanLoopEvents } from "../src/human-loop-provider.mjs";

const request = call => ({ kind: "custom-tool", toolName: "tandem_open_browser",
  toolDescription: "Open the local UI", args: {}, toolCallId: call });
const requested = (id, permissionRequest) => ({ type: "permission.requested", data: { requestId: id, permissionRequest } });
const completed = (id, toolCallId, kind = "approved") => ({ type: "permission.completed",
  data: { requestId: id, ...(toolCallId === undefined ? {} : { toolCallId }), result: { kind } } });
function fixture(attach = true) {
  const events = [], errors = [];
  const permissions = new PermissionBroker({ append: event => events.push(event) });
  const lifecycle = createNativePermissionLifecycle({ permissions, reportError: error => errors.push(error.message) });
  if (attach) lifecycle.attach("main");
  return { events, errors, permissions, lifecycle };
}
for (const kind of ["approved", "denied-interactively-by-user", "denied-no-approval-rule-and-could-not-request-from-user", "cancelled"]) {
  test(`externally ${kind} native request clears only its local UI without submitting another decision`, async () => {
    const f = fixture(), input = request("call");
    const pending = f.lifecycle.request(input, { sessionId: "main" });
    const localId = f.permissions.list()[0].id;
    f.lifecycle.observe(requested("native", input));
    f.lifecycle.observe(completed("native", "call", kind));
    f.lifecycle.observe(completed("native", "call", kind));
    assert.deepEqual(await pending, { kind: "no-result" });
    assert.deepEqual(f.permissions.list(), []);
    assert.deepEqual(f.permissions.remembered("main"), { all: false, tools: [] });
    assert.deepEqual(f.events.map(event => event.type), ["permission.requested", "permission.cancelled"]);
    assert.equal(f.events.at(-1).data.reason, "native-completion");
    await assert.rejects(f.permissions.decide(localId, "once"), /not pending/);
    assert.deepEqual(f.errors, []);
  });
}

test("same-name requests, cloned DTOs and wrong native/call/session identities never resolve another request", async () => {
  const f = fixture(), first = request("call-a"), second = request("call-b");
  const a = f.lifecycle.request(first, { sessionId: "main" });
  const b = f.lifecycle.request(second, { sessionId: "main" });
  const [aId, bId] = f.permissions.list().map(view => view.id);
  f.lifecycle.observe(requested("clone", structuredClone(first)));
  f.lifecycle.observe(completed("clone", "call-a"));
  assert.equal(f.permissions.list().length, 2);
  f.lifecycle.observe(requested("native-a", first));
  f.lifecycle.observe(requested("native-b", second));
  f.lifecycle.observe(completed("unrelated", "call-a"));
  f.lifecycle.observe(completed("native-b", "call-a"));
  f.lifecycle.observe(completed("native-a", "call-a", "approve-once"));
  f.lifecycle.observe(requested("native-a", second));
  await assert.rejects(f.lifecycle.request(request("foreign"), { sessionId: "other" }), /different attached session/);
  assert.throws(() => f.lifecycle.attach("other"), /exact attached session/);
  assert.deepEqual(f.permissions.list().map(view => view.id), [aId, bId]);
  assert.equal(f.errors.length, 3);
  f.lifecycle.observe(completed("native-a", "call-a"));
  assert.deepEqual(await a, { kind: "no-result" });
  assert.deepEqual(f.permissions.list().map(view => view.id), [bId]);
  f.lifecycle.observe(completed("native-a", "call-a"));
  assert.deepEqual(f.permissions.list().map(view => view.id), [bId]);
  f.lifecycle.observe(completed("native-b", "call-b", "denied-by-rules"));
  assert.deepEqual(await b, { kind: "no-result" });
});

test("early events wait for the actual joined identity and exact request IDs still work without optional call IDs", async () => {
  const f = fixture(false), input = { kind: "read", path: "package.json", intention: "Read package metadata" };
  const pending = f.lifecycle.request(input, { sessionId: "main" });
  f.lifecycle.observe(requested("early", input));
  f.lifecycle.observe(completed("early", undefined));
  assert.equal(f.permissions.list().length, 1);
  assert.throws(() => f.lifecycle.attach("other"), /exact attached session/);
  assert.equal(f.permissions.list().length, 1);
  f.lifecycle.attach("main");
  assert.deepEqual(await pending, { kind: "no-result" });
  assert.deepEqual(f.permissions.list(), []);
});

test("UI decisions and Stop/reset retain their results; old completions cannot remove a new generation", async () => {
  const f = fixture(), ui = request("ui-call");
  const decided = f.lifecycle.request(ui, { sessionId: "main" });
  f.lifecycle.observe(requested("ui-native", ui));
  await f.permissions.decide(f.permissions.list()[0].id, "once");
  assert.deepEqual(await decided, { kind: "approve-once", approvedInteractively: true });
  f.lifecycle.observe(completed("ui-native", "ui-call"));
  assert.equal(f.events.filter(event => event.type === "permission.cancelled").length, 0);
  const old = request("same-call");
  const stopped = f.lifecycle.request(old, { sessionId: "main" });
  f.lifecycle.observe(requested("old-native", old));
  f.permissions.resetSession("main");
  assert.equal((await stopped).kind, "reject");
  const next = request("same-call"), pending = f.lifecycle.request(next, { sessionId: "main" });
  f.lifecycle.observe(requested("new-native", next));
  f.lifecycle.observe(completed("old-native", "same-call"));
  assert.equal(f.permissions.list().length, 1);
  f.lifecycle.observe(completed("new-native", "same-call"));
  f.permissions.resetSession("main");
  assert.deepEqual(await pending, { kind: "no-result" });
  assert.equal(f.events.filter(event => event.type === "permission.cancelled").length, 2);
});

test("native settlement detaches both cancellation listeners and does not change task-abort semantics", async () => {
  const f = fixture(), stop = new AbortController(), native = new AbortController();
  const pending = f.permissions.request(request("owned"), { sessionId: "main" }, stop.signal, { nativeCompletion: native.signal });
  assert.equal(getEventListeners(stop.signal, "abort").length, 1);
  assert.equal(getEventListeners(native.signal, "abort").length, 1);
  native.abort(); stop.abort();
  assert.deepEqual(await pending, { kind: "no-result" });
  assert.equal(getEventListeners(stop.signal, "abort").length, 0);
  assert.equal(getEventListeners(native.signal, "abort").length, 0);
  assert.deepEqual(await f.permissions.request(request("already-resolved"), { sessionId: "main" }, undefined,
    { nativeCompletion: native.signal }), { kind: "no-result" });
  assert.equal((await f.permissions.request(request("stopped"), { sessionId: "main" }, stop.signal)).kind, "reject");
});

test("native completion racing remembered allow-all does not manufacture another grant", async () => {
  const f = fixture();
  const seed = f.permissions.request(request("seed"), { sessionId: "main" });
  await f.permissions.decide(f.permissions.list()[0].id, "all");
  await seed;
  const grantCount = f.events.filter(event => event.type === "permission.granted").length;
  const input = request("external"), pending = f.lifecycle.request(input, { sessionId: "main" });
  f.lifecycle.observe(requested("external-native", input));
  f.lifecycle.observe(completed("external-native", "external", "denied-by-rules"));
  assert.deepEqual(await pending, { kind: "no-result" });
  assert.equal(f.events.filter(event => event.type === "permission.granted").length, grantCount);
  assert.deepEqual(f.permissions.list(), []);
});

test("permission settlement does not start setup; explicit opening starts once and reports setup failure", async () => {
  const f = fixture(), errors = [];
  let busy = true, starts = 0;
  const main = { sessionId: "main", rpc: { mode: { get: async () => "interactive" },
    metadata: { isProcessing: async () => ({ processing: busy }), activity: async () => ({ hasActiveWork: busy }) },
    queue: { pendingItems: async () => ({ items: [], steeringMessages: [] }) } } };
  const entry = () => createBrowserEntry({ getSession: () => main,
    createProvider: async () => ({ url: "http://127.0.0.1:1/" }),
    start: async () => { await requireSetupSession({ mainSessionId: "main", attachedSession: main }); starts++; },
    reportError: error => errors.push(error.message) });
  const input = request("opening"), pending = f.lifecycle.request(input, { sessionId: "main" });
  f.lifecycle.observe(requested("native-opening", input));
  f.lifecycle.observe(completed("native-opening", "opening"));
  await pending;
  assert.equal(starts, 0);
  const rejected = entry();
  await rejected.tool.handler({}, { sessionId: "main" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(starts, 0); assert.match(errors[0], /idle main Session/);
  busy = false;
  await rejected.tool.handler({}, { sessionId: "main" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(starts, 0, "An earlier failure must not silently retry.");
  const admitted = entry();
  await admitted.tool.handler({}, { sessionId: "main" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(starts, 1);
});

test("private HTTP projection drops the exact completed prompt, keeps other private prompts and never infers Ready", async t => {
  const root = await mkdtemp(join(tmpdir(), "native-permission-projection-")), events = new HumanLoopEvents();
  const permissions = new PermissionBroker(events), errors = [];
  const lifecycle = createNativePermissionLifecycle({ permissions, reportError: error => errors.push(error.message) });
  lifecycle.attach("private");
  let starts = 0;
  const provider = await createHumanLoopProvider({ repositoryRoot: root,
    publicDirectory: fileURLToPath(new URL("../public/", import.meta.url)), surface: "browser",
    getInstallation: () => ({ read: async () => ({ status: "new" }), runtime: null,
      configuration: { owner: { privateSessionId: "private" } } }),
    events, permissions, start: async () => { starts++; } });
  t.after(async () => { await provider.close(); events.close(); await rm(root, { recursive: true, force: true }); });
  const a = request("first"), b = request("second");
  const first = lifecycle.request(a, { sessionId: "private" }), second = lifecycle.request(b, { sessionId: "private" });
  lifecycle.observe(requested("first-native", a)); lifecycle.observe(requested("second-native", b));
  const [firstId, secondId] = permissions.list().map(view => view.id);
  const snapshot = async () => (await (await fetch(new URL("/api/snapshot", provider.url))).json());
  assert.deepEqual((await snapshot()).accessRequests.map(view => view.id), [firstId, secondId]);
  lifecycle.observe(completed("first-native", "first"));
  assert.deepEqual(await first, { kind: "no-result" });
  const after = await snapshot();
  assert.deepEqual(after.accessRequests.map(view => view.id), [secondId]);
  assert.equal(after.installation.status, "new"); assert.equal(after.workflow, null);
  lifecycle.observe(completed("second-native", "second", "denied-interactively-by-user"));
  assert.deepEqual(await second, { kind: "no-result" });
  assert.deepEqual((await snapshot()).accessRequests, []);
  assert.equal(starts, 0); assert.deepEqual(errors, []);
});
