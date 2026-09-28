import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { HumanLoopPreferences, parsePreferences } from "../src/human-loop-preferences.mjs";
import { HumanLoopRuntime } from "../src/human-loop-runtime.mjs";
import { DEFAULT_POLICY, policyHash } from "../runtime-src/domain/workflow/policy.ts";
import { getHostStateWal } from "../runtime-src/domain/host-state-wal.ts";
import { NativeSession, git } from "./helpers/native-session-fixture.mjs";
import { installComposerEnter } from "../public/composer-enter.js";
import { createHumanLoopProvider, HumanLoopEvents } from "../src/human-loop-provider.mjs";
import { openFixtureBrowser, browserAvailable } from "./helpers/browser-fixture.mjs";

async function fixture(t, initial = {}) {
  const root = resolve(".settings-fixtures", randomUUID());
  await mkdir(root, { recursive: true }); await git(root, "init", "--quiet");
  t.after(async () => { await getHostStateWal(root).close(); await rm(root, { recursive: true, force: true }); });
  const preferences = new HumanLoopPreferences(root);
  if (Object.keys(initial).length) await preferences.update(initial);
  const session = new NativeSession(); session.abort = async () => {};
  let actual = "one", switchImpl = async (id) => { actual = id; }, listImpl = async () => [{ id: "one", name: "One" }, { id: "two", name: "Two" }];
  session.rpc.model = { getCurrent: async () => ({ modelId: actual }) };
  session.setModel = (id) => switchImpl(id);
  const client = { start: async () => {}, listModels: () => listImpl(),
    createSession: async (config) => { session.config = config; actual = config.model ?? actual; return session; }, stop: async () => [] };
  const configuration = { schemaVersion: "human-loop-runtime/v1", owner: { schemaVersion: "human-loop-owner/v1", id: "owner",
    mainSessionId: "main", privateSessionId: "private", workspacePath: root, policy: DEFAULT_POLICY },
    runtimeDirectory: root, node: { path: process.execPath }, sdk: {}, cli: {}, buildId: "fixture" };
  const runtime = new HumanLoopRuntime({ configuration, client, verifyOwnership: async () => {}, onHandoff: async () => {},
    readDesign: async () => ({ binding: { revisionId: null, digest: null }, content: null }) });
  await runtime.open();
  return { root, preferences, session, runtime, configuration, client,
    actual: (id) => { actual = id; }, switch: (fn) => { switchImpl = fn; }, list: (fn) => { listImpl = fn; } };
}

test("remembered approval reset excludes active work before touching SDK or broker and reports SDK failure", async t => {
  const f = await fixture(t), original = f.runtime.store.load.bind(f.runtime.store), state = await original();
  const calls = [];
  f.session.rpc.permissions = { resetSessionApprovals: async args => { calls.push(["sdk", args]); return { success: true }; } };
  for (const patch of [{ activeRequestId: "request" }, { activeTask: {} }, { stop: {} }]) {
    f.runtime.store.load = async () => ({ ...state, ...patch });
    await assert.rejects(f.runtime.resetRememberedApprovals(id => calls.push(["broker", id])), /idle private runtime/);
    assert.deepEqual(calls, []);
  }
  f.runtime.store.load = original;
  await f.runtime.resetRememberedApprovals(id => calls.push(["broker", id]));
  assert.deepEqual(calls, [["sdk", { includeLocation: false }], ["broker", "private"]]);
  f.session.rpc.permissions.resetSessionApprovals = async () => ({ success: false });
  await assert.rejects(f.runtime.resetRememberedApprovals(() => assert.fail("Unconfirmed reset must not clear broker")), /not confirmed/);
});

test("versioned preferences merge appearance without clobbering pending model", async (t) => {
  const f = await fixture(t);
  await Promise.all([f.preferences.update({ theme: "dark" }), f.preferences.update({ pendingModel: "two" })]);
  const value = await new HumanLoopPreferences(f.root).read();
  assert.equal(value.theme, "dark"); assert.equal(value.pendingModel, "two");
  for (const patch of [{ fontSize: "99px" }, { theme: "auto" }, { unexpected: true }]) await assert.rejects(f.preferences.update(patch));
  assert.throws(() => parsePreferences("{"), SyntaxError);
  assert.throws(() => parsePreferences({ schemaVersion: "unknown" }), /invalid/);
});

test("fresh selection is passed to SDK; verified switch leaves owner/configuration unchanged", async (t) => {
  const f = await fixture(t, { model: "two" }), digest = policyHash(f.configuration);
  assert.equal(f.session.config.model, "two");
  const state = await f.runtime.state();
  await f.runtime.changeModel({ model: "one" });
  assert.equal((await f.preferences.read()).model, "one");
  assert.equal((await f.runtime.modelSettings()).actual, "one");
  assert.equal(policyHash(f.configuration), digest);
  assert.deepEqual(await f.runtime.state(), state);
});

test("ordinary text admission checks actual saved model intent without refetching the model catalog", async t => {
  const f = await fixture(t, { model: "one" });
  f.list(async () => assert.fail("Ordinary Send must not refetch the model catalog."));
  let admissions = 0;
  f.runtime.store.dispatch = async () => { admissions++; throw new Error("Reached durable admission fixture."); };
  const input = { id: "latency", message: "An ordinary text request.", receivedAt: new Date().toISOString(), answers: null };
  await assert.rejects(f.runtime.send(input), /Reached durable admission fixture/);
  assert.equal(admissions, 1);
  f.actual("two");
  await assert.rejects(f.runtime.send(input), /differs from the saved preference/);
  f.actual("one"); await f.preferences.update({ pendingModel: "two" });
  await assert.rejects(f.runtime.send(input), /unconfirmed/);
  assert.equal(admissions, 1);
});

test("an unselected native model permits explicit selection but never assumed image capabilities", async t => {
  const f = await fixture(t);
  f.actual(undefined);
  const before = await f.runtime.modelSettings();
  assert.equal(before.actual, null);
  assert.deepEqual(before.models.map(model => model.id), ["one", "two"]);
  assert.equal(before.canChange, true);
  assert.match(before.reason, /positively identify/);
  assert.equal(before.capabilities, null);
  assert.equal((await f.runtime.transport.attachmentCapabilities()).supported, false);
  assert.equal((await f.preferences.read()).model, null);
  f.session.processing = true;
  assert.equal((await f.runtime.modelSettings()).canChange, false);
  await assert.rejects(f.runtime.changeModel({ model: "two" }), /quiescent/);
  f.session.processing = false;
  await f.runtime.changeModel({ model: "two" });
  assert.equal((await f.runtime.modelSettings()).actual, "two");
  assert.equal((await f.preferences.read()).model, "two");
  assert.equal((await f.preferences.read()).pendingModel, null);
  assert.equal(f.runtime.sessionId, "private");
});

test("SDK failure and mismatched readback retain intent and require explicit same-session reconciliation", async (t) => {
  const f = await fixture(t);
  f.switch(async () => { throw new Error("SDK failed"); });
  await assert.rejects(f.runtime.changeModel({ model: "two" }), /SDK failed/);
  assert.equal((await f.preferences.read()).pendingModel, "two");
  await assert.rejects(f.runtime.send({}), /unconfirmed/);
  assert.equal(f.runtime.sessionId, "private");
  await f.runtime.changeModel({ acceptActual: true });
  assert.equal((await f.preferences.read()).model, "one");
  f.switch(async () => {});
  await assert.rejects(f.runtime.changeModel({ model: "two" }), /readback/);
  f.actual("two");
  await f.runtime.changeModel({ acceptActual: true });
  assert.equal((await f.preferences.read()).pendingModel, null);
});

test("positive native quiet proof blocks processing and native queues; list failures disable setting", async (t) => {
  const f = await fixture(t);
  f.session.processing = true;
  await assert.rejects(f.runtime.changeModel({ model: "two" }), /quiescent/);
  assert.equal((await f.preferences.read()).pendingModel, null);
  f.session.processing = false;
  f.session.rpc.queue.pendingItems = async () => ({ items: [{ id: "queued" }], steeringMessages: [] });
  await assert.rejects(f.runtime.changeModel({ model: "two" }));
  f.session.rpc.queue.pendingItems = async () => ({ items: [], steeringMessages: [] });
  f.list(async () => { throw new Error("listing unavailable"); });
  assert.equal((await f.runtime.modelSettings()).canChange, false);
  await assert.rejects(f.runtime.changeModel({ model: "two" }), /listing unavailable/);
});

test("displayed and admission image capabilities follow the actual switched model", async (t) => {
  const f = await fixture(t);
  f.list(async () => [{ id: "one", capabilities: { supports: { vision: true },
    limits: { vision: { supported_media_types: ["image/png"], max_prompt_images: 2, max_prompt_image_size: 1000000 } } } }, { id: "two" }]);
  assert.equal((await f.runtime.modelSettings()).capabilities.supported, true);
  await f.runtime.changeModel({ model: "two" });
  assert.equal((await f.runtime.modelSettings()).capabilities.supported, false);
  await assert.rejects(f.runtime.transport.requestAttachments([{ attachments: [{ id: "image" }] }], {}), /image\/png support/);
});

test("queued execution, active tasks, Stop and uncertainty cannot switch models later silently", async (t) => {
  const f = await fixture(t), original = f.runtime.store.load.bind(f.runtime.store), state = await original();
  for (const patch of [
    { activeRequestId: "request" }, { activeTask: {} }, { stop: { id: "stop" } }, { uncertainty: { reason: "unknown" } },
    { requests: [{ id: "queued", status: "waiting", answers: null, blockingAnswerRefs: [] }] },
  ]) {
    f.runtime.store.load = async () => ({ ...state, ...patch });
    await assert.rejects(f.runtime.changeModel({ model: "two" }), /Model changes require an idle private runtime/);
    assert.equal((await f.preferences.read()).pendingModel, null);
  }
  f.runtime.store.load = original;
  assert.equal((await f.runtime.modelSettings()).actual, "one");
});

test("missing authoritative modelId and unavailable selected models never become successful preferences", async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.runtime.changeModel({ model: "not-listed" }), /authenticated/);
  f.session.rpc.model.getCurrent = async () => ({ model: "two" });
  await assert.rejects(f.runtime.changeModel({ model: "two" }), /positively identify/);
  assert.equal((await f.preferences.read()).pendingModel, "two");
  await assert.rejects(f.runtime.send({}), /unconfirmed/);
  delete f.session.setModel;
  assert.equal((await f.runtime.modelSettings()).canChange, false);
});

test("model change excludes simultaneous send, Stop and another selection", async (t) => {
  const f = await fixture(t);
  let release, entered;
  const arrived = new Promise((resolve) => { entered = resolve; });
  f.switch(async (id) => { entered(); await new Promise((resolve) => { release = resolve; }); f.actual(id); });
  const change = f.runtime.changeModel({ model: "two" });
  await arrived;
  await assert.rejects(f.runtime.send({}), /model change/);
  await assert.rejects(f.runtime.stop(), /Model verification/);
  await assert.rejects(f.runtime.changeModel({ model: "one" }), /Another model/);
  release(); await change;
});

test("Close does not wait for model verification and preserves an unconfirmed selection", async t => {
  const f = await fixture(t);
  let release, entered, closed = false;
  const arrived = new Promise(resolve => { entered = resolve; });
  f.switch(async () => { entered(); await new Promise(resolve => { release = resolve; }); });
  const readModel = f.session.rpc.model.getCurrent;
  f.session.rpc.model.getCurrent = async () => {
    if (closed) throw new Error("Native session closed during model verification.");
    return readModel();
  };
  f.client.stop = async () => { closed = true; return []; };
  const change = f.runtime.changeModel({ model: "two" });
  const rejected = assert.rejects(change, /cannot verify the actual private-session model/);
  await arrived;
  try {
    const result = await f.runtime.close("close-pending-model");
    assert.equal(result.native.closed, true);
    assert.equal(closed, true);
  } finally { release(); }
  await rejected;
  assert.equal((await f.preferences.read()).pendingModel, "two");
});

test("preference commit failure after SDK effect never reports success", async (t) => {
  const f = await fixture(t);
  const original = HumanLoopPreferences.prototype.update;
  HumanLoopPreferences.prototype.update = function (patch) {
    if (patch.model === "two") throw new Error("commit failed");
    return original.call(this, patch);
  };
  try { await assert.rejects(f.runtime.changeModel({ model: "two" }), /commit failed/); }
  finally { HumanLoopPreferences.prototype.update = original; }
  assert.equal((await f.runtime.modelSettings()).actual, "two");
  assert.equal((await f.preferences.read()).pendingModel, "two");
  await assert.rejects(f.runtime.send({}), /unconfirmed/);
  await f.runtime.changeModel({ acceptActual: true });
});

test("appearance survives provider restart and new port; API rejects malformed and cross-origin mutations", async (t) => {
  const f = await fixture(t), events = new HumanLoopEvents();
  const options = { repositoryRoot: f.root, publicDirectory: resolve(import.meta.dirname, "..", "public"), events,
    getInstallation: () => null, permissions: { list: () => [] } };
  let provider = await createHumanLoopProvider(options);
  const post = (url, data, origin) => fetch(new URL("api/settings", url), { method: "POST",
    headers: { "content-type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify(data) });
  try {
    assert.equal((await post(provider.url, { theme: "light", fontSize: "larger" })).status, 200);
    assert.notEqual((await post(provider.url, { theme: "red", fontSize: "normal" })).status, 200);
    assert.notEqual((await post(provider.url, { theme: "dark", fontSize: "normal" }, "https://other.invalid")).status, 200);
    const old = provider.url; await provider.close(); provider = await createHumanLoopProvider(options);
    assert.notEqual(provider.url, old);
    const value = await (await fetch(new URL("api/settings", provider.url))).json();
    assert.equal(value.preferences.theme, "light"); assert.equal(value.preferences.fontSize, "larger");
  } finally { await provider.close(); events.close(); }
});

test("model HTTP actions validate inputs and target only the verified private runtime", async (t) => {
  const f = await fixture(t), events = new HumanLoopEvents();
  const provider = await createHumanLoopProvider({ repositoryRoot: f.root, publicDirectory: resolve(import.meta.dirname, "..", "public"), events,
    getInstallation: () => ({ runtime: f.runtime, read: async () => ({ status: "ready" }) }), permissions: { list: () => [] } });
  const post = (data) => fetch(new URL("api/settings/model", provider.url), { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
  try {
    for (const data of [{ action: "select", model: 42 }, { action: "select", model: "two", hidden: true },
      { action: "accept-actual", model: "two" }, { action: "unknown", model: null }]) {
      assert.equal((await post(data)).status, 409);
    }
    const response = await post({ action: "select", model: "two" });
    assert.equal(response.status, 200); assert.equal((await response.json()).model.actual, "two");
    f.switch(async () => { throw new Error("API switch rejected"); });
    assert.equal((await post({ action: "select", model: "one" })).status, 409);
    assert.equal((await f.preferences.read()).pendingModel, "one");
    assert.equal((await post({ action: "accept-actual", model: null })).status, 200);
    assert.equal(f.runtime.sessionId, "private");
  } finally { await provider.close(); events.close(); }
});

test("native-unselected model remains explicit in browser Settings until verified Apply", { skip: !browserAvailable }, async t => {
  const f = await fixture(t), events = new HumanLoopEvents(), cleanups = [];
  f.actual(undefined);
  const provider = await createHumanLoopProvider({ repositoryRoot: f.root, publicDirectory: resolve(import.meta.dirname, "..", "public"), events,
    getInstallation: () => ({ runtime: f.runtime, read: async () => ({ status: "ready" }) }), permissions: { list: () => [] } });
  try {
    const browser = await openFixtureBrowser({ after: cleanup => cleanups.push(cleanup) });
    await browser.call("Page.navigate", { url: provider.url });
    await browser.waitFor("!document.querySelector('#setting-model').disabled");
    assert.equal(await browser.evaluate("document.querySelector('#setting-model').value"), "");
    assert.equal(await browser.evaluate("document.querySelector('#apply-model').disabled"), true);
    assert.match(await browser.evaluate("document.querySelector('#model-setting-status').textContent"), /not yet verified/);
    assert.equal((await f.preferences.read()).model, null);
    await browser.evaluate(`document.querySelector('#canvas-settings').open=true;
      document.querySelector('#setting-model').value='two';
      document.querySelector('#setting-model').dispatchEvent(new Event('change'));
      document.querySelector('#apply-model').click();`);
    await browser.waitFor("document.querySelector('#model-setting-status').textContent.includes('Actual private model: two.')");
    assert.equal((await f.preferences.read()).model, "two");
    assert.equal(f.runtime.sessionId, "private");
    assert.deepEqual(browser.exceptions, []);
  } finally {
    for (const cleanup of cleanups) await cleanup();
    await provider.close(); events.close();
  }
});

test("composer Enter preserves submit path, IME, Shift newline, held/repeat, disabled and in-flight guards", () => {
  const textarea = new EventTarget(); textarea.disabled = false;
  let sends = 0, allowed = true;
  installComposerEnter(textarea, { requestSubmit: () => { sends++; } }, () => allowed);
  const key = (type = "keydown", extra = {}) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { key: "Enter", ...extra }); textarea.dispatchEvent(event); return event;
  };
  assert.equal(key("keydown", { shiftKey: true }).defaultPrevented, false);
  assert.equal(key("keydown", { isComposing: true }).defaultPrevented, false);
  assert.equal(key("keydown", { keyCode: 229 }).defaultPrevented, false);
  textarea.dispatchEvent(new Event("compositionstart")); key(); assert.equal(sends, 0);
  textarea.dispatchEvent(new Event("compositionend"));
  key(); key(); key("keydown", { repeat: true }); assert.equal(sends, 1);
  key("keyup"); textarea.disabled = true; key(); assert.equal(sends, 1);
  key("keyup"); textarea.disabled = false; allowed = false; key(); assert.equal(sends, 1);
  key("keyup"); allowed = true; key(); assert.equal(sends, 2);
});
