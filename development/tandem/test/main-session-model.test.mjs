import assert from "node:assert/strict";
import test from "node:test";
import { MainSessionModel, initializeMainSessionModel } from "../src/main-session-model.mjs";
import { createDurablePrivateSession } from "../src/human-loop-controller.mjs";

function fixture() {
  let actual = "main-one", effort = "low", busy = false, desired = null;
  const calls = [];
  const session = { sessionId: "main", rpc: {
    model: {
      getCurrent: async () => ({ modelId: actual, reasoningEffort: effort }),
      list: async () => ({ list: [
        { id: "main-one", capabilities: { supports: { reasoning_effort: ["low", "high"] } } },
        { id: "main-two", capabilities: { supports: { reasoning_effort: ["low"] } } },
        { id: "disabled", policy: { state: "disabled" } },
      ] }),
      switchTo: async input => { calls.push(input); actual = input.modelId; effort = input.reasoningEffort ?? effort; return { modelId: actual }; },
    },
    metadata: { isProcessing: async () => ({ processing: busy }), activity: async () => ({ hasActiveWork: false }) },
    queue: { pendingItems: async () => ({ items: [], steeringMessages: [] }) },
  } };
  return { session, calls, model: new MainSessionModel(() => session, async () => desired),
    busy(value) { busy = value; }, desired(value) { desired = value; }, actual(value) { actual = value; }, effort(value) { effort = value; } };
}

test("fresh standalone main selects and verifies its native preferred model before direct Development inherits it", async () => {
  const f = fixture();
  f.actual(undefined); f.effort(undefined);
  await initializeMainSessionModel(f.session);
  assert.deepEqual(await f.session.rpc.model.getCurrent(), { modelId: "main-one", reasoningEffort: undefined });
  assert.deepEqual(f.calls, [{ modelId: "main-one", requireAvailable: true, runCompactionPreflight: true }]);
  const configurations = [];
  let privateModel;
  const client = { start: async () => {}, listModels: async () => [{ id: "main-one" }],
    createSession: async configuration => {
      configurations.push(configuration); privateModel = configuration.model;
      return { sessionId: configuration.sessionId, rpc: { name: { set: async () => {} },
        model: { getCurrent: async () => ({ modelId: privateModel }) } } };
    }, rpc: { sessions: { save: async () => {} } } };
  await createDurablePrivateSession(client, { sessionId: "private" }, undefined, f.session.rpc.model.getCurrent);
  assert.equal(configurations[0].model, "main-one");
  assert.equal(Object.hasOwn(configurations[0], "reasoningEffort"), false);
  f.actual("main-two");
  assert.equal(privateModel, "main-one");
  assert.equal(configurations.length, 1);
});

test("standalone startup preserves an existing native selection without replacing it from a catalog", async () => {
  const f = fixture();
  f.session.rpc.model.list = async () => assert.fail("A saved selection must not be replaced by a preferred default.");
  await initializeMainSessionModel(f.session);
  assert.equal((await f.session.rpc.model.getCurrent()).modelId, "main-one");
  assert.equal(f.calls.length, 0);
});

test("standalone default activation refuses missing choices and unconfirmed native switches", async () => {
  const f = fixture();
  f.actual(undefined); f.effort(undefined);
  const list = f.session.rpc.model.list;
  f.session.rpc.model.list = async () => ({ list: [] });
  await assert.rejects(initializeMainSessionModel(f.session), /model list is unavailable or invalid/);
  assert.equal(f.calls.length, 0);
  f.session.rpc.model.list = list;
  f.session.rpc.model.switchTo = async () => ({ deferred: true, queueId: "pending" });
  await assert.rejects(initializeMainSessionModel(f.session), /pending|confirmation/);
  assert.equal((await f.session.rpc.model.getCurrent()).modelId, undefined);
});

test("main settings read actual native selection and switch only that idle owned session with effort readback", async () => {
  const f = fixture();
  const before = await f.model.read();
  assert.equal(before.actual, "main-one"); assert.equal(before.reasoningEffort, "low");
  assert.deepEqual(before.models.map(model => model.id), ["main-one", "main-two"]);
  assert.equal(f.calls.length, 0);
  const result = await f.model.select({ model: "main-two", sessionId: "main", expectedModel: "main-one" });
  assert.equal(result.actual, "main-two"); assert.equal(result.reasoningEffort, "low");
  assert.deepEqual(f.calls, [{ modelId: "main-two", reasoningEffort: "low", requireAvailable: true, runCompactionPreflight: true }]);
  assert.equal(result.error, null);
});

test("main model changes reject stale owner, busy native work, unsupported effort and unavailable APIs without substitution", async () => {
  const f = fixture(), input = { model: "main-two", sessionId: "main", expectedModel: "main-one" };
  await assert.rejects(f.model.select({ ...input, sessionId: "private" }), /owner changed/);
  await assert.rejects(f.model.select({ ...input, expectedModel: "old" }), /owner changed/);
  await assert.rejects(f.model.select({ ...input, model: "disabled" }), /unavailable or disabled/);
  f.busy(true); assert.equal((await f.model.read()).canChange, false);
  await assert.rejects(f.model.select(input), /Wait for main-session work/); f.busy(false);
  f.desired("high"); await assert.rejects(f.model.select(input), /does not support/);
  delete f.session.rpc.model.switchTo;
  assert.equal((await f.model.read()).canChange, false);
  assert.equal(f.calls.length, 0);
});

for (const outcome of ["deferred", "confirmation", "wrong-readback", "persistence"]) test(`main ${outcome} does not masquerade as an applied selection`, async () => {
  const f = fixture();
  f.session.rpc.model.switchTo = async () => outcome === "deferred" ? { deferred: true, queueId: "queued" }
    : outcome === "confirmation" ? { confirmation: {} }
      : outcome === "persistence" ? { persistenceError: "Native persistence failed." } : { modelId: "main-two" };
  await assert.rejects(f.model.select({ model: "main-two", sessionId: "main", expectedModel: "main-one" }));
  const status = await f.model.read();
  assert.equal(status.actual, "main-one");
  assert.ok(status.error);
});

for (const override of [undefined, "private-override"]) test(`first private creation ${override ? "honors override" : "inherits current main model"} without copying main effort`, async () => {
  let main = "main-current", actual;
  const calls = [];
  const privateSession = { sessionId: "private", rpc: {
    name: { set: async () => {} }, model: { getCurrent: async () => ({ modelId: actual }) },
  } };
  const client = { start: async () => {}, listModels: async () => [{ id: "main-current" }, { id: "private-override" }],
    createSession: async config => { calls.push(config); actual = config.model; return privateSession; },
    rpc: { sessions: { save: async () => {} } } };
  const inherited = async () => { if (override) assert.fail("An explicit override must not read main."); return { modelId: main, reasoningEffort: "high" }; };
  const created = await createDurablePrivateSession(client, { sessionId: "private", ...(override ? { model: override } : {}) }, undefined, inherited);
  assert.equal(created, privateSession);
  assert.equal(calls[0].model, override ?? "main-current");
  assert.equal(Object.hasOwn(calls[0], "reasoningEffort"), false);
  main = "main-later";
  assert.equal((await privateSession.rpc.model.getCurrent()).modelId, override ?? "main-current");
  assert.equal(calls.length, 1, "Later main changes do not recreate or retarget Development.");
});

test("missing, unavailable or mismatched inherited model fails without fallback or project work", async () => {
  let creations = 0, recorded = false;
  const client = { start: async () => {}, listModels: async () => [{ id: "available" }],
    createSession: async () => { creations++; return { sessionId: "private", rpc: {
      name: { set: async () => {} }, model: { getCurrent: async () => ({ modelId: "different" }) },
    } }; }, rpc: { sessions: { save: async () => {} } } };
  await assert.rejects(createDurablePrivateSession(client, { sessionId: "private" }, undefined, async () => ({})), /not reported/);
  await assert.rejects(createDurablePrivateSession(client, { sessionId: "private" }, undefined, async () => ({ modelId: "missing" })), /unavailable/);
  assert.equal(creations, 0);
  await assert.rejects(createDurablePrivateSession(client, { sessionId: "private" }, async () => { recorded = true; },
    async () => ({ modelId: "available" })), /did not confirm/);
  assert.equal(creations, 1); assert.equal(recorded, true, "A created native identity remains recorded even if model verification fails.");
});
