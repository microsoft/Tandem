import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { HumanLoopPreferences, parsePreferences } from "../src/human-loop-preferences.mjs";
import { HumanLoopRuntime } from "../src/human-loop-runtime.mjs";
import { createHumanLoopController } from "../src/human-loop-controller.mjs";
import { DEFAULT_POLICY, policyHash } from "../runtime-src/domain/workflow/policy.ts";
import { getHostStateWal } from "../runtime-src/domain/host-state-wal.ts";
import { NativeSession, git } from "./helpers/native-session-fixture.mjs";
import { installComposerEnter } from "../public/composer-enter.js";
import { createHumanLoopProvider, HumanLoopEvents } from "../src/human-loop-provider.mjs";
import { openFixtureBrowser, browserAvailable } from "./helpers/browser-fixture.mjs";

async function fixture(t, initial = {}, projectEffortControl = false, open = true) {
  const root = resolve(".settings-fixtures", randomUUID());
  await mkdir(root, { recursive: true }); await git(root, "init", "--quiet");
  t.after(async () => { await getHostStateWal(root).close(); await rm(root, { recursive: true, force: true }); });
  const preferences = new HumanLoopPreferences(root);
  if (Object.keys(initial).length) await preferences.update(initial);
  const session = new NativeSession(); session.abort = async () => {};
  let actual = "one", effort = null, switchImpl = async (id) => { actual = id; effort = null; },
    listImpl = async () => [{ id: "one", name: "One", supportedReasoningEfforts: ["low", "high"] }, { id: "two", name: "Two" }];
  session.rpc.model = { getCurrent: async () => ({ modelId: actual, reasoningEffort: effort }),
    setReasoningEffort: async ({ reasoningEffort }) => { effort = reasoningEffort; return { reasoningEffort }; } };
  session.setModel = (id) => switchImpl(id);
  const client = { start: async () => {}, listModels: () => listImpl(),
    createSession: async (config) => { session.config = config; actual = config.model ?? actual; effort = config.reasoningEffort ?? null; return session; }, stop: async () => [] };
  const configuration = { schemaVersion: "human-loop-runtime/v1", owner: { schemaVersion: "human-loop-owner/v1", id: "owner",
    mainSessionId: "main", privateSessionId: "private", workspacePath: root, policy: DEFAULT_POLICY },
    runtimeDirectory: root, node: { path: process.execPath }, sdk: {}, cli: {}, buildId: "fixture" };
  const runtime = new HumanLoopRuntime({ configuration, client, verifyOwnership: async () => {}, onHandoff: async () => {},
    projectEffortControl,
    readDesign: async () => ({ binding: { revisionId: null, digest: null }, content: null }) });
  if (open) await runtime.open();
  return { root, preferences, session, runtime, configuration, client,
    actual: (id) => { actual = id; }, effort: (value) => { effort = value; },
    switch: (fn) => { switchImpl = fn; }, list: (fn) => { listImpl = fn; } };
}

async function unopenedController(t, f, catalog = async () => ({ list: [
  { id: "one", name: "One", capabilities: { supports: { reasoning_effort: ["low", "high"] } } },
  { id: "two", name: "Two", capabilities: { supports: { reasoning_effort: [] } } },
  { id: "disabled", name: "Disabled", policy: { state: "disabled" } },
] })) {
  const controller = createHumanLoopController({ workspacePath: f.root, projectEffortControl: true,
    sdkModulePath: import.meta.resolve("@github/copilot-sdk") });
  await controller.attach({ sessionId: "main", on() { return () => {}; }, getEvents: async () => [],
    rpc: { model: { list: catalog, setCurrent() { assert.fail("Private settings must not change the main model."); } } } });
  t.after(() => controller.close());
  return controller;
}

test("unopened model settings save authenticated preferences without reserving a private session and apply at startup", async t => {
  const f = await fixture(t, {}, true, false), controller = await unopenedController(t, f);
  const provider = await controller.openView("settings", { surface: "browser" });
  const get = async () => (await fetch(new URL("api/settings", provider.url))).json();
  const initial = await get();
  assert.equal(initial.model.deferred, true);
  assert.equal(initial.model.canChange, true);
  assert.equal(initial.model.actual, null);
  assert.deepEqual(initial.model.models.map(model => model.id), ["one", "two"]);
  const result = await fetch(new URL("api/settings/model", provider.url), { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "select", model: "one" }) });
  assert.equal(result.status, 200, await result.clone().text());
  assert.equal((await result.json()).model.desired, "one");
  await controller.selectReasoningEffort("high");
  assert.equal((await f.preferences.read()).reasoningEffort, "high");
  assert.equal((await controller.status()).installation.status, "new");
  assert.equal(controller.installation.runtime, null);
  assert.equal(controller.installation.configuration, null);
  assert.equal(await f.preferences.isOnlySavedState(), true);
  assert.equal(f.session.config, undefined);
  assert.equal(f.session.sends.length, 0);
  await controller.close();
  const restored = await unopenedController(t, f);
  assert.equal((await restored.modelSettings()).desired, "one");
  await restored.close();
  await f.runtime.open();
  assert.equal(f.session.config.model, "one");
  assert.equal(f.session.config.reasoningEffort, "high");
  assert.equal(f.session.config.requestExtensions, false);
  const actual = await f.runtime.modelSettings();
  assert.equal(actual.actual, "one");
  assert.equal(actual.actualReasoningEffort, "high");
  assert.equal(actual.error, null);
  assert.equal(f.session.sends.length, 0);
});

test("first Development startup asks for a model before reserving ownership, even with saved effort", async t => {
  const f = await fixture(t, { projectReasoningEffort: "low" }, true, false), controller = await unopenedController(t, f);
  assert.equal(await controller.requiresModelSelection(), true);
  await assert.rejects(controller.start(), error => error.code === "development_model_required");
  assert.equal(controller.installation.runtime, null);
  assert.equal(controller.installation.configuration, null);
  const provider = await controller.openView("settings");
  const response = await fetch(new URL("api/runtime/start", provider.url), { method: "POST",
    headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "development_model_required");
  await controller.changeModel({ model: "one" });
  assert.equal(await controller.requiresModelSelection(), false);
  assert.equal(controller.installation.configuration, null);
  assert.equal(f.session.sends.length, 0);
});

test("a ready but unselected private model asks for selection without replacing its existing session", async t => {
  const f = await fixture(t, {}, true), controller = await unopenedController(t, f);
  f.actual(undefined);
  t.mock.method(controller.installation, "read", async () => ({ status: "ready" }));
  const runtime = t.mock.getter(controller.installation, "runtime", () => f.runtime);
  assert.equal(await controller.requiresModelSelection(), true);
  await f.runtime.changeModel({ model: "one" });
  assert.equal(await controller.requiresModelSelection(), false);
  assert.equal(f.runtime.sessionId, "private");
  assert.equal(f.session.sends.length, 0);
  runtime.mock.restore();
});

test("unopened model choices reject unsupported, disabled and unverified inputs without changing preferences", async t => {
  const f = await fixture(t, { projectReasoningEffort: "low" }, true, false), controller = await unopenedController(t, f);
  const provider = await controller.openView("settings");
  const before = await f.preferences.read();
  for (const selection of [{ action: "select", model: "missing" }, { action: "select", model: "disabled" },
    { action: "select", model: "two" }, { action: "accept-actual", model: null },
    { action: "select", model: "one", reasoningEffort: "high" }, { action: "select", model: 42 }]) {
    const result = await fetch(new URL("api/settings/model", provider.url), { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify(selection) });
    assert.equal(result.status, 409, JSON.stringify(selection));
    assert.deepEqual(await f.preferences.read(), before);
  }
  await controller.changeModel({ model: "one" });
  assert.equal((await f.preferences.read()).reasoningEffort, "low");
  await assert.rejects(controller.selectReasoningEffort("max"), /saved private model/);
  assert.equal((await f.preferences.read()).projectReasoningEffort, "low");
  assert.equal(controller.installation.configuration, null);
  assert.equal(f.session.sends.length, 0);
});

test("unopened model save excludes startup and other settings; unavailable catalog remains an explicit error", async t => {
  const f = await fixture(t, {}, true, false);
  let release, entered;
  const listed = new Promise(resolve => { entered = resolve; });
  const controller = await unopenedController(t, f, () => { entered(); return new Promise(resolve => { release = resolve; }); });
  const saving = controller.changeModel({ model: "one" });
  await listed;
  await assert.rejects(controller.start(), /settings change/);
  await assert.rejects(controller.changeModel({ model: "two" }), /changing settings/);
  await assert.rejects(controller.selectReasoningEffort("low"), /changing settings/);
  release({ list: [{ id: "one" }] });
  await saving;
  assert.equal((await f.preferences.read()).model, "one");
  assert.equal(controller.installation.runtime, null);
  await controller.close();
  const unavailable = await unopenedController(t, f, async () => { throw new Error("Catalog unavailable"); });
  const value = await unavailable.modelSettings();
  assert.equal(value.canChange, false);
  assert.equal(value.desired, "one");
  assert.match(value.error, /Catalog unavailable/);
  await assert.rejects(unavailable.changeModel({ model: "two" }), /Catalog unavailable/);
  assert.equal((await f.preferences.read()).model, "one");
});

test("saving a future model never overwrites retained or changing private ownership", async t => {
  const f = await fixture(t, {}, true, false);
  let release, entered;
  const listed = new Promise(resolve => { entered = resolve; });
  const controller = await unopenedController(t, f, () => { entered(); return new Promise(resolve => { release = resolve; }); });
  const saving = controller.changeModel({ model: "one" });
  await listed;
  const read = t.mock.method(controller.installation, "read", async () => ({ status: "saved-state" }));
  release({ list: [{ id: "one" }] });
  await assert.rejects(saving, /ownership changed/);
  assert.equal((await f.preferences.read()).model, null);
  for (const status of ["saved-state", "unknown", "failed", "closed"]) {
    read.mock.mockImplementation(async () => ({ status }));
    await assert.rejects(controller.changeModel({ model: "one" }), /original Development owner/);
    assert.equal((await f.preferences.read()).model, null);
  }
});

test("future effort validation holds its saved-model binding until persistence", async t => {
  const f = await fixture(t, { model: "one" }, true, false);
  let release, entered;
  const listed = new Promise(resolve => { entered = resolve; });
  const controller = await unopenedController(t, f, () => { entered(); return new Promise(resolve => { release = resolve; }); });
  const saving = controller.selectReasoningEffort("high");
  await listed;
  await assert.rejects(controller.changeModel({ model: "two" }), /changing settings/);
  await assert.rejects(controller.start(), /settings change/);
  release({ list: [{ id: "one", capabilities: { supports: { reasoning_effort: ["high"] } } }] });
  await saving;
  assert.equal((await f.preferences.read()).reasoningEffort, "high");
  assert.equal((await f.preferences.read()).model, "one");
});

test("a saved startup model never authorizes fallback or claims a mismatched native readback", async t => {
  const f = await fixture(t, { model: "two" }, false, false);
  f.list(async () => [{ id: "one" }]);
  await assert.rejects(f.runtime.open(), /unavailable.*no fallback/);
  assert.equal(f.session.config, undefined);
  assert.equal((await f.preferences.read()).model, "two");
  const mismatch = await fixture(t, { model: "two" }, false, false);
  mismatch.client.createSession = async config => { mismatch.session.config = config; return mismatch.session; };
  await mismatch.runtime.open();
  assert.equal(mismatch.session.config.model, "two");
  assert.match((await mismatch.runtime.modelSettings()).error, /differs from the saved/);
  assert.equal((await mismatch.runtime.readiness()).modelBlocked, true);
  assert.equal(mismatch.session.sends.length, 0);
});

test("Settings can save a model before Development exists and retains it across view reload", { skip: !browserAvailable }, async t => {
  const f = await fixture(t, {}, true, false), controller = await unopenedController(t, f);
  const provider = await controller.openView("settings", { surface: "browser" });
  const browser = await openFixtureBrowser(t);
  await browser.call("Page.navigate", { url: provider.url });
  await browser.waitFor("!document.querySelector('#setting-model').disabled");
  assert.equal(await browser.evaluate("document.querySelector('#apply-model').textContent"), "Save model for Development");
  await browser.evaluate(`document.querySelector('#canvas-settings').open=true;
    document.querySelector('#setting-model').value='two';
    document.querySelector('#setting-model').dispatchEvent(new Event('change'));
    document.querySelector('#apply-model').click();`);
  await browser.waitFor("document.querySelector('#model-setting-status').textContent.includes('Saved selection: two (applies at startup)')");
  assert.match(await browser.evaluate("document.querySelector('#model-setting-status').textContent"), /Saving does not start Development/);
  assert.equal(await browser.evaluate("document.querySelector('#accept-actual-model').hidden"), true);
  await browser.call("Page.reload");
  await browser.waitFor("document.querySelector('#setting-model').value==='two'");
  assert.equal((await controller.modelSettings()).actual, null);
  assert.equal(controller.installation.configuration, null);
  assert.equal(f.session.sends.length, 0);
  assert.deepEqual(browser.exceptions, []);
});

test("standalone Start Development opens its existing model settings instead of failing after private creation", { skip: !browserAvailable }, async t => {
  const f = await fixture(t, {}, true, false), controller = await unopenedController(t, f);
  const provider = await controller.openView("settings", { surface: "browser" });
  const browser = await openFixtureBrowser(t);
  await browser.call("Page.navigate", { url: provider.url });
  await browser.waitFor("document.querySelector('#initialize').checkVisibility() && !document.querySelector('#initialize').disabled && !document.querySelector('#setting-model').disabled");
  await browser.evaluate("document.querySelector('#initialize').click()");
  await browser.waitFor("document.querySelector('#canvas-settings').open && !document.querySelector('#setting-model').disabled");
  assert.equal(controller.installation.configuration, null);
  assert.equal(controller.installation.runtime, null);
  assert.match(await browser.evaluate("document.querySelector('#notice').textContent"), /Choose and save a Development model/);
  await browser.evaluate(`document.querySelector('#setting-model').value='one';
    document.querySelector('#setting-model').dispatchEvent(new Event('change'));
    document.querySelector('#apply-model').click();`);
  await browser.waitFor("document.querySelector('#model-setting-status').textContent.includes('Saved selection: one')");
  assert.equal(await controller.requiresModelSelection(), false);
  assert.equal(controller.installation.configuration, null);
  assert.equal(f.session.sends.length, 0);
  assert.deepEqual(browser.exceptions, []);
});

test("composed private effort validates and applies its own intent without changing model or workflow history", async t => {
  const f = await fixture(t, { model: "one", projectReasoningEffort: "low" }, true);
  const before = await f.runtime.store.load();
  await f.runtime.applyProjectEffort();
  let settings = await f.runtime.modelSettings();
  assert.equal(settings.actual, "one");
  assert.equal(settings.actualReasoningEffort, "low");
  assert.equal(settings.effortManaged, true);
  await assert.rejects(f.runtime.changeModel({ model: "one", reasoningEffort: "high" }), /single project control/);
  await assert.rejects(f.runtime.changeModel({ model: "two" }), /not advertised/);
  await f.runtime.selectProjectEffort("high");
  settings = await f.runtime.modelSettings();
  assert.equal(settings.actual, "one");
  assert.equal(settings.actualReasoningEffort, "high");
  assert.equal((await f.preferences.read()).projectReasoningEffort, "high");
  assert.deepEqual(await f.runtime.store.load(), before);
});

test("composed effort preserves busy and pending-model state instead of silently overriding it", async t => {
  const f = await fixture(t, {}, true), before = await f.preferences.read();
  f.session.processing = true;
  await assert.rejects(f.runtime.selectProjectEffort("low"), /quiescent|idle/);
  assert.deepEqual(await f.preferences.read(), before);
  f.session.processing = false;
  await f.preferences.update({ pendingModel: "one", pendingReasoningEffort: "low" });
  await assert.rejects(f.runtime.selectProjectEffort("high"), /pending private model/);
  assert.equal((await f.preferences.read()).pendingReasoningEffort, "low");
});

test("composed effort can wait for a private model, then uses the saved choice without a second selector", async t => {
  const f = await fixture(t, {}, true);
  f.actual(null);
  await f.runtime.selectProjectEffort("low");
  assert.equal((await f.preferences.read()).projectReasoningEffort, "low");
  assert.equal((await f.runtime.modelSettings()).actual, null);
  await f.runtime.changeModel({ model: "one" });
  assert.equal((await f.runtime.modelSettings()).actualReasoningEffort, "low");
});

test("unopened Development persists only its own effort intent and reserves no private identity", async t => {
  const root = resolve(".settings-fixtures", randomUUID());
  await mkdir(root, { recursive: true }); await git(root, "init", "--quiet");
  t.after(async () => { await getHostStateWal(root).close(); await rm(root, { recursive: true, force: true }); });
  const controller = createHumanLoopController({ workspacePath: root, projectEffortControl: true,
    sdkModulePath: import.meta.resolve("@github/copilot-sdk") });
  await controller.attach({ sessionId: "main", on() { return () => {}; }, getEvents: async () => [] });
  await controller.selectReasoningEffort("low");
  assert.equal((await controller.status()).installation.status, "new");
  assert.equal(controller.installation.runtime, null);
  assert.equal(controller.installation.configuration, null);
  assert.equal((await controller.reasoningEffortStatus()).status, "pending");
  assert.equal(await new HumanLoopPreferences(root).isOnlySavedState(), true);
  await controller.close();
});

test("saved project effort never replaces an unresolved or different saved private model", async t => {
  const f = await fixture(t, { model: "one", reasoningEffort: "low", projectReasoningEffort: "high" }, true);
  const before = await f.preferences.read();
  f.actual("two");
  f.switch(async () => assert.fail("Saved project intent cannot adopt another actual model."));
  await f.runtime.applyProjectEffort();
  assert.match((await f.runtime.modelSettings()).error, /differs from the saved selection/);
  assert.deepEqual(await f.preferences.read(), before);
  await f.preferences.update({ pendingModel: "one", pendingReasoningEffort: "high" });
  const pending = await f.preferences.read();
  await f.runtime.applyProjectEffort();
  assert.match((await f.runtime.modelSettings()).error, /unconfirmed/);
  assert.deepEqual(await f.preferences.read(), pending);
});

test("failed private readback retains project intent visibly without native setting effects", async t => {
  const f = await fixture(t, {}, true);
  f.session.rpc.model.getCurrent = async () => { throw new Error("Native read unavailable"); };
  f.switch(async () => assert.fail("No model may be inferred from a failed read."));
  const settings = await f.runtime.selectProjectEffort("low");
  assert.match(settings.error, /Native read unavailable/);
  assert.equal(settings.actualReasoningEffort, null);
  assert.equal((await f.preferences.read()).projectReasoningEffort, "low");
  assert.equal((await f.preferences.read()).pendingModel, null);
  await f.runtime.applyProjectEffort();
  assert.match((await f.runtime.modelSettings()).error, /Native read unavailable/);
});

test("legacy preferences retain native effort defaults; explicit effort is validated and read back", async t => {
  const old = { schemaVersion: "human-loop-preferences/v1", theme: "system", fontSize: "normal", model: "one", pendingModel: null };
  assert.equal(parsePreferences(old).reasoningEffort, null);
  assert.throws(() => parsePreferences({ ...old, model: null, reasoningEffort: "low" }), /invalid/);
  const f = await fixture(t, { model: "one" });
  assert.equal(Object.hasOwn(f.session.config, "reasoningEffort"), false);
  await f.runtime.changeModel({ model: "one", reasoningEffort: "low" });
  assert.equal((await f.preferences.read()).reasoningEffort, "low");
  assert.equal((await f.runtime.modelSettings()).actualReasoningEffort, "low");
  assert.deepEqual((await f.runtime.modelSettings()).models[0].supportedReasoningEfforts, ["low", "high"]);
  f.effort("high");
  await assert.rejects(f.runtime.send({}), /reasoning effort differs/);
  await f.runtime.changeModel({ acceptActual: true });
  assert.equal((await f.preferences.read()).reasoningEffort, "high");
  await f.runtime.changeModel({ model: "two" });
  assert.equal((await f.preferences.read()).reasoningEffort, null);
});

test("fresh explicit effort is passed to native creation and unsupported effort never causes a native switch", async t => {
  const f = await fixture(t, { model: "one", reasoningEffort: "low" });
  assert.equal(f.session.config.reasoningEffort, "low");
  f.switch(async () => assert.fail("Unsupported selection must not switch."));
  for (const selection of [{ model: "one", reasoningEffort: "invented" }, { model: "two", reasoningEffort: "low" }])
    await assert.rejects(f.runtime.changeModel(selection), /not advertised/);
  delete f.session.rpc.model.setReasoningEffort;
  await assert.rejects(f.runtime.changeModel({ model: "one", reasoningEffort: "high" }), /cannot set/);
  assert.equal((await f.preferences.read()).pendingModel, null);
});

test("failed effort effect and readback preserve pending intent and require explicit reconciliation", async t => {
  const f = await fixture(t);
  f.session.rpc.model.setReasoningEffort = async () => { throw new Error("effort failed"); };
  await assert.rejects(f.runtime.changeModel({ model: "one", reasoningEffort: "low" }), /effort failed/);
  assert.equal((await f.preferences.read()).pendingReasoningEffort, "low");
  await assert.rejects(f.runtime.send({}), /unconfirmed/);
  await f.runtime.changeModel({ acceptActual: true });
  assert.equal((await f.preferences.read()).pendingReasoningEffort, null);
  f.session.rpc.model.setReasoningEffort = async () => ({ reasoningEffort: "low" });
  await assert.rejects(f.runtime.changeModel({ model: "one", reasoningEffort: "low" }), /readback/);
  assert.equal((await f.preferences.read()).pendingReasoningEffort, "low");
  f.effort("low");
  await f.runtime.changeModel({ acceptActual: true });
  assert.equal((await f.preferences.read()).reasoningEffort, "low");
});

test("effort changes share busy and unavailable-metadata guards", async t => {
  const f = await fixture(t);
  f.session.processing = true;
  await assert.rejects(f.runtime.changeModel({ model: "one", reasoningEffort: "low" }), /quiescent/);
  assert.equal((await f.preferences.read()).pendingReasoningEffort, null);
  f.session.processing = false;
  f.list(async () => [{ id: "one", supportedReasoningEfforts: ["low", "low"] }]);
  await assert.rejects(f.runtime.changeModel({ model: "one", reasoningEffort: "low" }), /efforts are invalid/);
});

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

test("standalone Settings has labelled mouse Close and Escape with focus return and no mutations", { skip: !browserAvailable }, async t => {
  const f = await fixture(t), events = new HumanLoopEvents(), cleanups = [];
  let closes = 0, modelChanges = 0;
  f.switch(async () => { modelChanges++; });
  const before = await f.preferences.read();
  const provider = await createHumanLoopProvider({ repositoryRoot: f.root, publicDirectory: resolve(import.meta.dirname, "..", "public"), events,
    getInstallation: () => ({ runtime: f.runtime, read: async () => ({ status: "ready" }), close: async () => { closes++; } }),
    permissions: { list: () => [] } });
  try {
    const browser = await openFixtureBrowser({ after: cleanup => cleanups.push(cleanup) });
    await browser.call("Page.navigate", { url: provider.url });
    await browser.waitFor('document.querySelector("#model-setting-status").textContent.includes("Actual private model: one")');
    const click = async selector => {
      const point = await browser.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:"nearest"});
        const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
        return {x:r.x+r.width/2,y:r.y+r.height/2,visible:r.width>0&&r.height>0&&(hit===e||e.contains(hit))};})()`);
      assert.ok(point.visible, selector);
      for (const type of ["mousePressed", "mouseReleased"]) await browser.call("Input.dispatchMouseEvent",
        { type, x: point.x, y: point.y, button: "left", clickCount: 1 });
    };
    await click("#canvas-settings > summary");
    await browser.waitFor('document.querySelector("#canvas-settings").open');
    await browser.evaluate('document.querySelector("#setting-theme").value="dark"');
    await click("#close-settings");
    await browser.waitFor('!document.querySelector("#canvas-settings").open');
    assert.equal(await browser.evaluate('document.activeElement===document.querySelector("#canvas-settings > summary")'), true);
    assert.equal(await browser.evaluate('document.querySelector("#setting-theme").value'), "dark");
    await click("#canvas-settings > summary");
    await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await browser.waitFor('!document.querySelector("#canvas-settings").open');
    assert.equal(await browser.evaluate('document.activeElement===document.querySelector("#canvas-settings > summary")'), true);
    assert.deepEqual(await f.preferences.read(), before);
    assert.equal(closes, 0); assert.equal(modelChanges, 0); assert.equal(f.session.sends.length, 0);
    assert.deepEqual(browser.exceptions, []);
  } finally {
    for (const cleanup of cleanups) await cleanup();
    await provider.close(); events.close();
  }
});

test("model HTTP actions validate inputs and target only the verified private runtime", async (t) => {
  const f = await fixture(t), events = new HumanLoopEvents();
  const provider = await createHumanLoopProvider({ repositoryRoot: f.root, publicDirectory: resolve(import.meta.dirname, "..", "public"), events,
    getInstallation: () => ({ runtime: f.runtime, read: async () => ({ status: "ready" }) }), permissions: { list: () => [] } });
  const post = (data) => fetch(new URL("api/settings/model", provider.url), { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
  try {
    for (const data of [{ action: "select", model: 42 }, { action: "select", model: "two", hidden: true },
      { action: "accept-actual", model: "two" }, { action: "unknown", model: null },
      { action: "select", model: "one", reasoningEffort: 3 }, { action: "select", model: "two", reasoningEffort: "low" },
      { action: "accept-actual", model: null, reasoningEffort: "low" }]) {
      assert.equal((await post(data)).status, 409);
    }
    const response = await post({ action: "select", model: "two" });
    assert.equal(response.status, 200); assert.equal((await response.json()).model.actual, "two");
    f.switch(async () => { throw new Error("API switch rejected"); });
    assert.equal((await post({ action: "select", model: "one" })).status, 409);
    assert.equal((await f.preferences.read()).pendingModel, "one");
    assert.equal((await post({ action: "accept-actual", model: null })).status, 200);
    f.switch(async id => { f.actual(id); f.effort(null); });
    const effort = await post({ action: "select", model: "one", reasoningEffort: "low" });
    assert.equal(effort.status, 200);
    assert.equal((await effort.json()).model.actualReasoningEffort, "low");
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
    await browser.waitFor("document.querySelector('#model-setting-status').textContent.includes('Actual private model: two.') && !document.querySelector('#apply-model').disabled");
    assert.equal((await f.preferences.read()).model, "two");
    await browser.evaluate(`document.querySelector('#setting-model').value='one';
      document.querySelector('#setting-model').dispatchEvent(new Event('change'));`);
    assert.deepEqual(await browser.evaluate("Array.from(document.querySelector('#setting-effort').options).map(o=>o.value)"), ["", "low", "high"]);
    await browser.evaluate(`document.querySelector('#setting-effort').value='low'; document.querySelector('#apply-model').click();`);
    await browser.waitFor("document.querySelector('#model-setting-status').textContent.includes('Actual reasoning effort: low.')");
    assert.equal((await f.preferences.read()).reasoningEffort, "low");
    await browser.call("Page.reload");
    await browser.waitFor("document.querySelector('#setting-effort').value==='low'");
    assert.equal(f.runtime.sessionId, "private");
    assert.deepEqual(browser.exceptions, []);
  } finally {
    for (const cleanup of cleanups) await cleanup();
    await provider.close(); events.close();
  }
});

test("composed browser Settings keeps effort read-only while model selection applies project intent", { skip: !browserAvailable }, async t => {
  const f = await fixture(t, { projectReasoningEffort: "low" }, true), events = new HumanLoopEvents(), cleanups = [];
  f.actual(undefined);
  const provider = await createHumanLoopProvider({ repositoryRoot: f.root, publicDirectory: resolve(import.meta.dirname, "..", "public"), events,
    getInstallation: () => ({ runtime: f.runtime, read: async () => ({ status: "ready" }) }), permissions: { list: () => [] } });
  try {
    const browser = await openFixtureBrowser({ after: cleanup => cleanups.push(cleanup) });
    await browser.call("Page.navigate", { url: provider.url });
    await browser.waitFor("!document.querySelector('#setting-model').disabled");
    assert.equal(await browser.evaluate("document.querySelector('#setting-effort').disabled"), true);
    await browser.evaluate(`document.querySelector('#canvas-settings').open=true;
      document.querySelector('#setting-model').value='one';
      document.querySelector('#setting-model').dispatchEvent(new Event('change'));
      document.querySelector('#apply-model').click();`);
    await browser.waitFor("document.querySelector('#model-setting-status').textContent.includes('Actual reasoning effort: low.')");
    assert.equal((await f.runtime.modelSettings()).actualReasoningEffort, "low");
    assert.equal(await browser.evaluate("document.querySelector('#setting-effort').disabled"), true);
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
