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
    requestExtensions: false, tools, hooks, onPermissionRequest: permission, onEvent };
  const client = {
    async start() { started = true; calls.push("start"); },
    get rpc() {
      assert.ok(started, "RPC access before start is unsupported by the installed SDK.");
      return { sessions: {
        async open(input) { calls.push("create"); assert.equal(input.kind, "create"); assert.equal(input.options.sessionId, "owned-private");
          return { status: "created", sessionId: "owned-private" }; },
        async save(input) { calls.push("save"); assert.deepEqual(input, { sessionId: "owned-private" }); },
      } };
    },
    async resumeSession(id, input) {
      calls.push("attach"); assert.equal(id, "owned-private");
      assert.equal(input.tools, tools); assert.equal(input.hooks, hooks);
      assert.equal(input.onPermissionRequest, permission); assert.equal(input.onEvent, onEvent);
      assert.equal(input.requestExtensions, false);
      assert.equal(input.continuePendingWork, false); assert.equal(input.suppressResumeEvent, true);
      return { sessionId: id };
    },
  };
  assert.equal((await createDurablePrivateSession(client, configuration)).sessionId, "owned-private");
  assert.deepEqual(calls, ["start", "create", "save", "attach"]);
});

test("failed or conflicting native creation never attaches a substitute identity or sends a turn", async () => {
  for (const response of [{ status: "resumed", sessionId: "expected" }, { status: "created", sessionId: "foreign" }]) {
    let attached = false, saved = false;
    const client = { start: async () => {}, rpc: { sessions: {
      open: async () => response, save: async () => { saved = true; },
    } }, resumeSession: async () => { attached = true; }, send() { assert.fail("No dummy model turn is allowed."); } };
    await assert.rejects(createDurablePrivateSession(client, { sessionId: "expected", requestExtensions: false }), /no session was adopted/);
    assert.equal(attached, false); assert.equal(saved, false);
  }
  let attached = false;
  await assert.rejects(createDurablePrivateSession({ start: async () => {}, rpc: { sessions: {
    open: async () => ({ status: "created", sessionId: "expected" }), save: async () => { throw new Error("Durability unavailable"); },
  } }, resumeSession: async () => { attached = true; } }, { sessionId: "expected", requestExtensions: false }), /Durability unavailable/);
  assert.equal(attached, false);
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
