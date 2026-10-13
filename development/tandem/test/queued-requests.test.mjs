import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { packageExtension } from "../scripts/package-extension.mjs";
import { HumanLoopStore } from "../src/human-loop-store.mjs";
import { HumanLoopEvents, projectHumanConversation } from "../src/human-loop-provider.mjs";
import { DEFAULT_POLICY } from "../runtime-src/domain/workflow/policy.ts";
import { PermissionBroker } from "../runtime-src/permissions/permission-broker.ts";
import { ImageAttachmentStore } from "../runtime-src/domain/workflow/image-attachment.ts";
import { browserAvailable, openFixtureBrowser } from "./helpers/browser-fixture.mjs";

const request = (id, text = `Exact ${id}\nrequest.`, extra = {}) => ({
  id, message: text, receivedAt: "2026-10-13T00:00:00Z", answers: null, ...extra,
});
const design = { revisionId: null, digest: null };
const snapshot = { id: "stop-snapshot", digest: "a".repeat(64) };

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "queued-requests-"));
  const owner = { schemaVersion: "human-loop-owner/v1", id: "owner", mainSessionId: "main", privateSessionId: "private",
    workspacePath: root, policy: DEFAULT_POLICY };
  let store = new HumanLoopStore(owner), sequence = 0;
  const cleanups = [];
  await store.initialize(design);
  t.after(async () => { for (const cleanup of cleanups) await cleanup(); await store.close(); await rm(root, { recursive: true, force: true }); });
  return { root, owner, get store() { return store; }, cleanup: callback => cleanups.push(callback),
    send: input => store.dispatch("user", `receive:${input.id}`, "receive-request", input),
    admit: requestId => store.dispatch("host", `admit:${++sequence}`, "admit-request", { requestId }),
    async stop() {
      const stopId = `stop:${++sequence}`;
      await store.dispatch("user", stopId, "request-stop", { stopId });
      await store.dispatch("host", `confirm:${stopId}`, "confirm-stop", { stopId, snapshot });
    },
    async recover() {
      await store.dispatch("host", `recover:${++sequence}`, "recover", {
        recoveryId: `recovery:${sequence}`, recoveredAt: "2026-10-13T01:00:00Z", evidenceRef: "fixture-only",
        design, nativeUsers: [],
      });
    },
    async reconnect() { await store.close(); store = new HumanLoopStore(owner); return store.load(); },
  };
}

for (const end of ["stop", "recover"]) test(`queue presentation reconstructs exact picked-up batches and never-started ${end} audit`, async t => {
  const f = await fixture(t);
  const inputs = [request("first"), request("batch"), request("waiting", "@agent Retain my queued request.",
    { roleHint: { schemaVersion: "human-role-hint/v1", role: "agent" } })];
  await f.send(inputs[0]); await f.send(inputs[1]);
  let state = await f.store.load();
  assert.deepEqual(projectHumanConversation(state, []).map(entry => entry.queuedStatus), ["queued", "queued"]);
  await f.admit("first"); await f.send(inputs[2]);
  state = await f.store.load();
  assert.deepEqual(state.requests.map(entry => entry.queueAdmitted), [true, true, undefined]);
  assert.deepEqual(projectHumanConversation(state, []).map(entry => entry.queuedStatus), [undefined, undefined, "queued"]);
  assert.equal(state.executions.length, 0, "Queue pickup is not invented native model execution.");
  await f[end]();
  const before = await f.store.load();
  assert.deepEqual(await f.reconnect(), before);
  const visible = projectHumanConversation(before, []);
  assert.deepEqual(visible.map(entry => entry.queuedStatus), [undefined, undefined,
    end === "stop" ? "cancelled-before-start" : "retired-before-start"]);
  for (const input of inputs) {
    const entry = visible.find(entry => entry.requestId === input.id);
    assert.equal(entry.text, input.message);
    assert.equal(entry.timestamp, input.receivedAt);
    assert.deepEqual(entry.roleHint, input.roleHint);
  }
  await f.send(inputs[2]);
  assert.deepEqual(await f.store.load(), before, "An exact old receipt does not restart or reclassify a request.");
  await assert.rejects(f.send({ ...request("forged"), queueAdmitted: true }), /Unknown|keys|fields|unexpected/i);
});

test("packaged queue remains above the composer through receipts, pickup, Stop, reconnect and narrow layout",
  { skip: !browserAvailable, timeout: 90_000 }, async t => {
    const f = await fixture(t), staging = await mkdtemp(join(tmpdir(), "queued-package-")), outputDirectory = join(staging, "tandem");
    const cleanups = [];
    const events = new HumanLoopEvents(), permissions = new PermissionBroker(events);
    const { manifest } = await packageExtension({ outputDirectory });
    assert.ok(manifest.files.some(file => file.path === "public/queued-requests.js"));
    const { createHumanLoopProvider } = await import(pathToFileURL(join(outputDirectory, "src", "human-loop-provider.mjs")).href);
    const { getHostStateWal } = await import(pathToFileURL(join(outputDirectory, "runtime-src", "domain", "host-state-wal.ts")).href);
    const runtime = { sessionId: "private", state: () => f.store.load(),
      readiness: async () => ({ status: (await f.store.load()).activeRequestId ? "working" : "ready", reason: null, workspacePath: f.root }),
      conversation: async () => [], currentDesign: async () => ({ binding: design, content: null }),
      commands: { read: async () => ({ apps: [], commands: [] }) },
      transport: { attachmentCapabilities: async () => ({ supported: true, limits: { maxImages: 1, maxBytes: 4 * 1024 * 1024 } }) },
      send: async input => { await f.send(input); events.touch(); },
      stop: async () => { await f.stop(); events.touch(); },
    };
    const provider = await createHumanLoopProvider({ repositoryRoot: f.root, publicDirectory: join(outputDirectory, "public"), surface: "browser",
      events, permissions, getInstallation: () => ({ runtime, read: async () => ({ status: "ready" }) }), start: async () => assert.fail("No startup expected.") });
    f.cleanup(async () => {
      for (const cleanup of cleanups) await cleanup();
      await provider.close(); events.close(); await getHostStateWal(f.root).close();
      await rm(staging, { recursive: true, force: true });
    });
    const browser = await openFixtureBrowser({ after: cleanup => cleanups.push(cleanup) });
    await f.send(request("working")); await f.admit("working");
    await browser.call("Emulation.setDeviceMetricsOverride", { width: 1360, height: 1000, deviceScaleFactor: 1, mobile: false });
    await browser.call("Page.navigate", { url: provider.url });
    await browser.waitFor('!document.querySelector("#send").disabled');
    const click = async selector => {
      const point = await browser.evaluate(`(() => { const node=document.querySelector(${JSON.stringify(selector)}); node.scrollIntoView({block:"nearest"});
        const r=node.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
      for (const type of ["mousePressed", "mouseReleased"]) await browser.call("Input.dispatchMouseEvent", { type, ...point, button: "left", clickCount: 1 });
    };
    await browser.evaluate(`window.queueFetch = window.fetch.bind(window); window.holdQueueSnapshots = false;
      window.loseQueueReceipt = true; window.queuedEnvelopes = [];
      window.fetch = async (url, options) => {
        if (url === "/api/snapshot" && window.holdQueueSnapshots) throw new Error("Injected snapshot outage");
        if (url === "/api/requests") {
          window.queuedEnvelopes.push(JSON.parse(options.body));
          if (window.loseQueueReceipt) { window.loseQueueReceipt=false; window.holdQueueSnapshots=true;
            await window.queueFetch(url, options); throw new Error("Injected lost queued receipt"); }
        }
        return window.queueFetch(url, options);
      };`);
    await click("#message");
    await browser.call("Input.insertText", { text: "@agent Rerun after the update.\nKeep this exact text." });
    await click("#send");
    await browser.waitFor('document.querySelector("#send").textContent === "Retry exact request"');
    assert.equal(await browser.evaluate('document.querySelectorAll("[data-queued-request-id]").length'), 0,
      "An unconfirmed local envelope is not an invented accepted queue row.");
    assert.equal(await browser.evaluate('document.querySelector("#message").disabled'), true);
    await browser.evaluate("window.holdQueueSnapshots = false");
    await click("#send");
    await browser.waitFor('document.querySelectorAll("[data-queued-request-id]").length === 1 && document.querySelector("#message").value === ""');
    const sent = await browser.evaluate("window.queuedEnvelopes");
    assert.deepEqual(sent[0], sent[1]);
    const queuedId = sent[0].id;
    assert.equal(await browser.evaluate(`document.querySelector('#messages [data-request-id="${queuedId}"]')`), null);
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=", "base64");
    const attachment = await new ImageAttachmentStore(f.root).put(png, "image/png");
    await runtime.send(request("image", "@designer Keep this image.", {
      roleHint: { schemaVersion: "human-role-hint/v1", role: "designer" }, attachments: [attachment],
    }));
    await browser.waitFor('document.querySelectorAll("[data-queued-waiting] [data-queued-request-id]").length === 2');
    assert.deepEqual(await browser.evaluate('[...document.querySelectorAll("[data-queued-waiting] [data-queued-request-id]")].map(node=>node.dataset.queuedRequestId)'), [queuedId, "image"]);
    await click('[data-queued-request-id="image"] > details > summary');
    assert.equal(await browser.evaluate('document.querySelector("[data-queued-request-id=image] img").getAttribute("src")'),
      `/api/image-attachments/${attachment.id}`);
    assert.match(await browser.evaluate('document.querySelector("[data-queued-request-id=image] .conversation-role").textContent'), /Preference: @designer/);
    for (const width of [1360, 390, 320]) {
      await browser.call("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
      const geometry = await browser.evaluate(`(() => {
        const q=document.querySelector("#queued-requests").getBoundingClientRect(), c=document.querySelector("#composer").getBoundingClientRect();
        return {queueBottom:q.bottom,composerTop:c.top,height:q.height,overflow:document.documentElement.scrollWidth>innerWidth};
      })()`);
      assert.ok(geometry.queueBottom <= geometry.composerTop + 1 && geometry.height <= 181 && !geometry.overflow, JSON.stringify(geometry));
    }
    await click("#message"); await browser.call("Input.insertText", { text: "Keep my unsent draft." });
    await click("#stop-options"); await click("#stop-now");
    await browser.waitFor('document.querySelector("[data-queued-history] summary").textContent === "Not started history (2)"');
    assert.deepEqual(await browser.evaluate('[...document.querySelectorAll("[data-queued-history] [data-queued-request-id]")].map(node=>node.dataset.queuedRequestId)'), [queuedId, "image"]);
    assert.equal(await browser.evaluate('document.querySelector("#message").value'), "Keep my unsent draft.");
    assert.equal(await browser.evaluate('document.querySelectorAll("#messages .conversation-user").length'), 1, "Only the picked-up request is a conversation turn.");
    assert.equal(await browser.evaluate('document.querySelector("[data-queued-request-id=image]").dataset.queuedStatus'), "cancelled-before-start");
    await f.reconnect();
    await browser.call("Page.reload");
    await browser.waitFor('document.querySelectorAll("[data-queued-history] [data-queued-request-id]").length === 2');
    assert.equal((await f.store.load()).requests.length, 3);
    const next = request("next", "@agent Process this new request.", { roleHint: { schemaVersion: "human-role-hint/v1", role: "agent" } });
    await runtime.send(next);
    await browser.waitFor('!!document.querySelector("[data-queued-waiting] [data-queued-request-id=next]")');
    await f.admit("next"); events.touch();
    await browser.waitFor('!!document.querySelector("#messages [data-request-id=next]") && !document.querySelector("[data-queued-request-id=next]")');
    events.touch(); await browser.evaluate('document.querySelector("#refresh").click()');
    assert.equal(await browser.evaluate('document.querySelectorAll("#messages [data-request-id=next]").length'), 1);
    await browser.call("Page.reload");
    await browser.waitFor('document.querySelectorAll("#messages [data-request-id=next]").length === 1');
    assert.equal(await browser.evaluate('document.querySelector("[data-queued-request-id=next]")'), null);
    if (process.env.TANDEM_UI_EVIDENCE) await writeFile(join(process.env.TANDEM_UI_EVIDENCE, "queued-standalone.png"), await browser.screenshot());
    assert.deepEqual(browser.exceptions, []);
    t.diagnostic(`Actual packaged standalone queue, ${(await browser.call("Browser.getVersion")).product}; durable fixture transitions, no models.`);
  });
