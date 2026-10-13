import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createDurablePrivateSession, createHumanLoopController } from "../src/human-loop-controller.mjs";

test("durable composition starts the actual client before RPC access and preserves exact private configuration", async () => {
  const calls = [];
  let started = false;
  const tools = [{ name: "terminal", isTerminal: true }], hooks = { onPreToolUse() {} };
  const permission = () => ({ kind: "reject" }), onEvent = () => {};
  const configuration = { sessionId: "owned-private", workingDirectory: "C:\\fixture",
    requestExtensions: false, toolSearch: { enabled: false }, tools, hooks, onPermissionRequest: permission, onEvent };
  const client = {
    async start() { started = true; calls.push("start"); },
    get rpc() {
      assert.ok(started, "RPC access before start is unsupported by the installed SDK.");
      return { sessions: {
        async save(input) { calls.push("save"); assert.deepEqual(input, { sessionId: "owned-private" }); },
      } };
    },
    async createSession(input) {
      calls.push("create"); assert.equal(input.sessionId, "owned-private");
      assert.equal(input.tools, tools); assert.equal(input.hooks, hooks);
      assert.equal(input.onPermissionRequest, permission); assert.equal(input.onEvent, onEvent);
      assert.equal(input.requestExtensions, false);
      assert.equal(input.toolSearch, configuration.toolSearch);
      return { sessionId: input.sessionId, rpc: { name: { async set(value) {
        calls.push("name"); assert.deepEqual(value, { name: "Tandem Development" });
      } } } };
    },
  };
  assert.equal((await createDurablePrivateSession(client, configuration, async id => {
    assert.equal(id, "owned-private"); calls.push("record-created");
  })).sessionId, "owned-private");
  assert.deepEqual(calls, ["start", "create", "record-created", "name", "save"]);
});

test("failed or conflicting native creation never attaches a substitute identity or sends a turn", async () => {
  for (const response of [{}, { sessionId: "foreign" }]) {
    let created = false, saved = false;
    const client = { start: async () => {}, rpc: { sessions: {
      save: async () => { saved = true; },
    } }, createSession: async () => { created = true; return response; }, send() { assert.fail("No dummy model turn is allowed."); } };
    await assert.rejects(createDurablePrivateSession(client, { sessionId: "expected", requestExtensions: false }), /no session was adopted/);
    assert.equal(created, true); assert.equal(saved, false);
  }
  await assert.rejects(createDurablePrivateSession({ start: async () => {}, rpc: { sessions: {
    save: async () => { throw new Error("Durability unavailable"); },
  } }, createSession: async () => ({ sessionId: "expected", rpc: { name: { set: async () => {} } } }) },
  { sessionId: "expected", requestExtensions: false }), /Durability unavailable/);
});

for (const failure of ["name", "save"]) test(`native creation is recorded before a later ${failure} failure`, async () => {
  const calls = [];
  const client = { start: async () => {}, createSession: async () => {
    calls.push("create");
    return { sessionId: "reserved", rpc: { name: { set: async () => {
      calls.push("name");
      if (failure === "name") throw new Error("name failed");
    } } } };
  }, rpc: { sessions: { save: async () => { calls.push("save"); throw new Error("save failed"); } } } };
  await assert.rejects(createDurablePrivateSession(client, { sessionId: "reserved" },
    async id => { assert.equal(id, "reserved"); calls.push("record-created"); }), new RegExp(`${failure} failed`));
  assert.deepEqual(calls.slice(0, 3), ["create", "record-created", "name"]);
  assert.equal(calls.filter(call => call === "create").length, 1);
});

test("unopened saved ownership and uncertainty are not quiet upstream reset boundaries", async t => {
  const root = await mkdtemp(join(tmpdir(), "tandem-controller-boundary-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const controller = createHumanLoopController({ workspacePath: root, sdkModulePath: "fixture-only" });
  await controller.attach({ sessionId: "main", getEvents: async () => [], on() {} });
  const read = t.mock.method(controller.installation, "read", async () => ({ status: "saved-state" }));
  await assert.rejects(controller.assertQuiet(), /Retained Development ownership/);
  read.mock.mockImplementation(async () => ({ status: "unknown" }));
  await assert.rejects(controller.assertQuiet(), /Retained Development ownership/);
  read.mock.mockImplementation(async () => ({ status: "new" }));
  await controller.assertQuiet();
});

test("duplicate Development opens share one view without initializing or submitting private work", async t => {
  const root = await mkdtemp(join(tmpdir(), "tandem-direct-view-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const controller = createHumanLoopController({ workspacePath: root, sdkModulePath: "fixture-only" });
  t.after(() => controller.close());
  const [first, duplicate] = await Promise.all([
    controller.openView("development-browser", { surface: "browser" }),
    controller.openView("development-browser", { surface: "browser" }),
  ]);
  assert.equal(first, duplicate);
  assert.equal(await controller.openView("development-browser"), first);
  assert.equal(controller.installation, undefined);
  const state = await fetch(new URL("api/snapshot", first.url)).then(response => response.json());
  assert.equal(state.installation.status, "attaching");
  assert.equal(state.workflow, null);
});

test("attaching Development never reads or subscribes to foreground conversation for private copying", async t => {
  const root = await mkdtemp(join(tmpdir(), "tandem-private-provenance-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const controller = createHumanLoopController({ workspacePath: root, sdkModulePath: "fixture-only" });
  t.after(() => controller.close());
  await controller.attach({ sessionId: "main",
    getEvents: async () => assert.fail("Main conversation must not be read for private history."),
    on: () => assert.fail("Foreground conversation must not be subscribed for copying."),
  });
  assert.equal((await controller.status()).installation.status, "new");
});
