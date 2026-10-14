import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createBrowserEntry } from "../src/human-loop-browser-entry.mjs";
import { createHumanLoopProvider, HumanLoopEvents } from "../src/human-loop-provider.mjs";
import { getHostStateWal } from "../runtime-src/domain/host-state-wal.ts";
import { browserAvailable, openFixtureBrowser } from "./helpers/browser-fixture.mjs";

function fixture(overrides = {}) {
  let mode = "interactive", active = false, queued = false, starts = 0, providers = 0, closes = 0;
  const errors = [];
  const session = { sessionId: "real-main", rpc: {
    mode: { get: async () => mode },
    metadata: { isProcessing: async () => ({ processing: active }), activity: async () => ({ hasActiveWork: active }) },
    queue: { pendingItems: async () => ({ items: queued ? [{}] : [], steeringMessages: [] }) },
  } };
  const entry = createBrowserEntry({ getSession: () => session,
    createProvider: async () => { providers++; return { url: "http://127.0.0.1:43210/", close: async () => { closes++; } }; },
    start: async () => { starts++; },
    reportError: error => errors.push(error.message), ...overrides });
  return { entry, session, errors, starts: () => starts, providers: () => providers, closes: () => closes,
    mode(value) { mode = value; }, active(value) { active = value; }, queued(value) { queued = value; },
    open: () => entry.tool.handler({}, { sessionId: session.sessionId }),
  };
}

test("browser opening returns a reusable independent URL and starts setup without a main-idle prerequisite", async () => {
  const f = fixture();
  f.active(true);
  const result = JSON.parse(await f.open());
  assert.equal(result.url, "http://127.0.0.1:43210/");
  assert.equal(result.setup, "starting");
  assert.match(result.instructions, /same foreground session/);
  assert.equal(f.starts(), 1);
  assert.equal(f.entry.onIdle, undefined);
  await f.open(); assert.equal(f.providers(), 1);
  assert.equal(f.starts(), 1);
  assert.equal((await f.entry.open({ sessionId: "real-main" })).url, result.url, "Canvas action and tool share the browser owner.");
  assert.deepEqual(f.errors, []);
  await f.entry.close(); await f.entry.close();
  assert.equal(f.closes(), 1);
  await assert.rejects(f.open(), /exact attached/);
});

test("opening rejects foreign invocation and arguments, never inspecting or changing main mode", async () => {
  const f = fixture();
  await assert.rejects(f.entry.tool.handler({}, { sessionId: "foreign" }), /exact attached/);
  for (const args of [null, [], { url: "https://example.com/" }, { sessionId: "foreign" }]) {
    await assert.rejects(f.entry.tool.handler(args, { sessionId: "real-main" }), /no arguments/);
  }
  assert.equal(f.providers(), 0); assert.equal(f.starts(), 0);
  for (const mode of ["autopilot", "plan"]) {
    f.mode(mode); await f.open();
    assert.equal(await f.session.rpc.mode.get(), mode);
  }
  assert.equal(f.providers(), 1); assert.equal(f.starts(), 1);
});

test("startup failure remains visible and another URL lookup does not automatically retry it", async () => {
  let starts = 0;
  const f = fixture({ start: async () => { starts++; throw new Error("Private startup failed."); } });
  await f.open();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.errors, ["Private startup failed."]);
  await f.open();
  assert.equal(starts, 1);
});

test("concurrent openings share provider creation and one startup", async () => {
  const gate = Promise.withResolvers(); let count = 0;
  const f = fixture({ createProvider: async () => { count++; return gate.promise; } });
  const first = f.open(), second = f.open();
  await new Promise(done => setImmediate(done));
  assert.equal(f.starts(), 0);
  gate.resolve({ url: "http://127.0.0.1:43210/" });
  assert.equal(await first, await second); assert.equal(count, 1);
  assert.equal(f.starts(), 1);
});

test("provider failure remains visible and only an explicit later opening retries creation", async () => {
  let count = 0;
  const f = fixture({ createProvider: async () => { if (++count === 1) throw new Error("Listen failed"); return { url: "http://127.0.0.1:43210/" }; } });
  await assert.rejects(f.open(), /Listen failed/);
  assert.equal(f.starts(), 0);
  await f.open();
  assert.equal(count, 2); assert.equal(f.starts(), 1);
});

test("owning-session close waits for an in-flight listen and leaves no orphan provider", async () => {
  const gate = Promise.withResolvers(); let closes = 0;
  const f = fixture({ createProvider: () => gate.promise });
  const open = assert.rejects(f.open(), /owning session is closing/);
  const close = f.entry.close();
  gate.resolve({ url: "http://127.0.0.1:43210/", close: async () => { closes++; } });
  await Promise.all([open, close]);
  assert.equal(closes, 1);
  assert.equal(f.starts(), 0);
});

test("provider close releases its exact HTTP connections even during an unfinished status read", { timeout: 10_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), "human-browser-closing-")), events = new HumanLoopEvents();
  const entered = Promise.withResolvers(), status = Promise.withResolvers();
  const provider = await createHumanLoopProvider({ repositoryRoot: root, publicDirectory: resolve(import.meta.dirname, "..", "public"),
    getInstallation: () => ({ read: async () => { entered.resolve(); return status.promise; } }),
    permissions: { list: () => [] }, events });
  t.after(async () => {
    status.resolve({ status: "closed" }); await provider.close(); events.close();
    await getHostStateWal(root).close(); await rm(root, { recursive: true, force: true });
  });
  const pending = fetch(new URL("api/snapshot", provider.url)).then(() => "response", () => "disconnected");
  await entered.promise;
  await provider.close();
  assert.equal(await pending, "disconnected");
  await assert.rejects(fetch(provider.url));
});

test("regular browser reload survives canvas-server close and its own session close releases the endpoint",
  { skip: !browserAvailable, timeout: 60_000 }, async t => {
    const root = await mkdtemp(join(tmpdir(), "human-browser-lifetime-")), events = new HumanLoopEvents();
    const options = { repositoryRoot: root, publicDirectory: resolve(import.meta.dirname, "..", "public"),
      getInstallation: () => null, permissions: { list: () => [] }, events, start: async () => {} };
    const panel = await createHumanLoopProvider(options);
    const entry = createBrowserEntry({ getSession: () => ({ sessionId: "fixture-owner" }),
      createProvider: () => createHumanLoopProvider({ ...options, surface: "browser" }),
      start: options.start, reportError: error => assert.fail(error.message) });
    t.after(async () => {
      await entry.close(); await panel.close(); events.close();
      await getHostStateWal(root).close(); await rm(root, { recursive: true, force: true });
    });
    const local = await entry.open({ sessionId: "fixture-owner" });
    assert.notEqual(local.url, panel.url);
    assert.match(await (await fetch(panel.url)).text(), /data-tandem-surface="canvas"/);
    const browser = await openFixtureBrowser(t);
    await browser.call("Page.navigate", { url: local.url });
    await browser.waitFor("document.body.dataset.tandemSurface === 'browser' && document.querySelector('#message')");
    await panel.close();
    await assert.rejects(fetch(panel.url));
    assert.equal((await fetch(new URL("api/snapshot", local.url))).status, 200);
    await browser.evaluate("window.beforeReload = true");
    await browser.call("Page.reload");
    await browser.waitFor("!window.beforeReload && document.body.dataset.tandemSurface === 'browser' && document.querySelector('#connection-status')?.textContent === 'Live updates'");
    await entry.close();
    await assert.rejects(fetch(local.url));
    await browser.call("Page.reload");
    await assert.rejects(entry.open({ sessionId: "fixture-owner" }), /exact attached foreground session/);
    await assert.rejects(fetch(local.url));
  });
