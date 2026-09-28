import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHumanLoopProvider, HumanLoopEvents } from "../../src/human-loop-provider.mjs";
import { createHumanLoop } from "../../runtime-src/domain/human-loop/model.ts";
import { DEFAULT_POLICY } from "../../runtime-src/domain/workflow/policy.ts";
import { PermissionBroker } from "../../runtime-src/permissions/permission-broker.ts";
import { getHostStateWal } from "../../runtime-src/domain/host-state-wal.ts";
import { openFixtureBrowser } from "./browser-fixture.mjs";

export async function humanLoopUiFixture(t, { openBrowser, sandbox = false, surface = "canvas",
  publicDirectory = fileURLToPath(new URL("../../public/", import.meta.url)) } = {}) {
  const root = await mkdtemp(join(tmpdir(), "human-loop-ui-"));
  const events = new HumanLoopEvents(), permissions = new PermissionBroker(events);
  const state = createHumanLoop({ schemaVersion: "human-loop-owner/v1", id: "owner",
    mainSessionId: "main", privateSessionId: "private", workspacePath: root, policy: DEFAULT_POLICY },
  { revisionId: null, digest: null });
  let status = "ready", destinationRequests = 0, provider;
  const requests = [];
  const outer = createServer((request, response) => {
    response.setHeader("content-type", "text/html");
    if (request.url === "/destination") { destinationRequests++; response.end("Fixture destination"); return; }
    response.end(`<!doctype html><body style="margin:0"><iframe style="border:0;width:1280px;height:900px" sandbox="allow-scripts allow-same-origin" src="${provider.url}"></iframe></body>`);
  });
  await new Promise(done => outer.listen(0, "127.0.0.1", done));
  const destination = `http://127.0.0.1:${outer.address().port}/destination`;
  const runtime = {
    state: async () => state,
    readiness: async () => ({ status, reason: null, workspacePath: root }),
    conversation: async () => [{ id: "review", requestId: "review-request", role: "reviewer", kind: "assistant",
      timestamp: "2026-09-16T00:00:00Z", content: `Review complete. Open ${destination} to inspect the result.` }],
    currentDesign: async () => ({ binding: state.design, content: null }),
    commands: { read: async () => ({ apps: [{ id: "preview", command: "Local preview", status: "running",
      url: destination, canStop: false }], commands: [] }) },
    send: async input => { requests.push(input); throw new Error("No workflow requests are expected."); },
  };
  provider = await createHumanLoopProvider({ repositoryRoot: root,
    publicDirectory,
    getInstallation: () => ({ runtime, read: async () => ({ status: "ready", canStart: false, canReopen: false }) }),
    events, permissions, start: async () => assert.fail("No runtime startup is expected."), openBrowser, surface });
  t.after(async () => {
    await provider.close(); outer.closeAllConnections(); await new Promise(done => outer.close(done));
    events.close(); await getHostStateWal(root).close(); await rm(root, { recursive: true, force: true });
  });
  const browser = await openFixtureBrowser(t);
  await browser.call("Emulation.setDeviceMetricsOverride", { width: 1320, height: 960, deviceScaleFactor: 1, mobile: false });
  await browser.call("Page.navigate", { url: sandbox ? `http://127.0.0.1:${outer.address().port}/` : provider.url });
  let contextId;
  if (sandbox) {
    let frame;
    for (let i = 0; i < 100; i++) {
      frame = (await browser.call("Page.getFrameTree")).frameTree.childFrames?.[0]?.frame;
      if (frame?.url.startsWith(provider.url)) break;
      await new Promise(done => setTimeout(done, 30));
    }
    assert.ok(frame?.id);
    contextId = (await browser.call("Page.createIsolatedWorld", { frameId: frame.id, worldName: "fixture-inspection" })).executionContextId;
  }
  const evaluate = async expression => {
    if (contextId === undefined) return browser.evaluate(expression);
    const result = await browser.call("Runtime.evaluate", { expression, contextId, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const until = async expression => {
    for (let i = 0; i < 200; i++) { if (await evaluate(expression)) return; await new Promise(done => setTimeout(done, 30)); }
    throw new Error(`Fixture condition did not settle: ${expression}`);
  };
  await until("document.querySelector('#messages a') && document.querySelector('#current-state-title').textContent==='Ready'");
  const click = async (selector, { button = "left", modifiers = 0 } = {}) => {
    const point = await evaluate(`(async()=>{
      const n=document.querySelector(${JSON.stringify(selector)});n.scrollIntoView({block:'center'});
      await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));
      const r=n.getBoundingClientRect(),p={x:r.x+r.width/2,y:r.y+r.height/2};
      if(!n.contains(document.elementFromPoint(p.x,p.y)))throw new Error('Control is obscured');
      return p;
    })()`);
    if (sandbox) {
      const offset = await browser.evaluate("(()=>{const f=document.querySelector('iframe'),r=f.getBoundingClientRect();return{x:r.x+f.clientLeft,y:r.y+f.clientTop}})()");
      point.x += offset.x; point.y += offset.y;
    }
    await browser.call("Input.dispatchMouseEvent", { type: "mousePressed", button, modifiers, clickCount: 1, ...point });
    await browser.call("Input.dispatchMouseEvent", { type: "mouseReleased", button, modifiers, clickCount: 1, ...point });
  };
  return { browser, evaluate, until, click, provider, destination, state, requests,
    destinationRequests: () => destinationRequests,
    setStatus(value) { status = value; events.touch(); },
    post: (data, headers = {}) => fetch(new URL("/api/navigation/open", provider.url), { method: "POST",
      headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(data) }) };
}
