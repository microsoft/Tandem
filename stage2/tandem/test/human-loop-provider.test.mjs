import assert from "node:assert/strict";
import { mkdtemp, rm, access, mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createHumanLoopProvider, HumanLoopEvents, projectHumanLoopView, projectHumanProgress } from "../src/human-loop-provider.mjs";
import { projectHumanHistory } from "../public/renderers/human-loop-history.js";
import { createHumanLoop } from "../runtime-src/domain/human-loop/model.ts";
import { DEFAULT_POLICY, policyHash } from "../runtime-src/domain/workflow/policy.ts";
import { PermissionBroker } from "../runtime-src/permissions/permission-broker.ts";
import { sharedDesignExample, sharedDesignExampleV2 } from "./helpers/shared-design-fixture.mjs";
import { openFixtureBrowser, browserAvailable } from "./helpers/browser-fixture.mjs";
import { getHostStateWal } from "../runtime-src/domain/host-state-wal.ts";
import { AnnotationAttachmentStore } from "../runtime-src/domain/workflow/annotation-attachment.ts";
import { multiFormatDesign } from "./fixtures/multi-format.mjs";
import jpeg from "../node_modules/jpeg-js/index.js";

test("routine activity projection retains exact individual events across durable reload and UI grouping", async t => {
  const root = await mkdtemp(join(tmpdir(), "human-history-provenance-"));
  const events = new HumanLoopEvents(), restored = new HumanLoopEvents();
  let closed = false;
  t.after(async () => { if (!closed) events.close(); restored.close(); await rm(root, { recursive: true, force: true }); });
  events.enablePersistence(root);
  const activity = { sessionId: "private", taskId: "task", requestId: "request", role: "designer", toolName: "view", toolCallId: "call-1" };
  for (let i = 0; i < 2; i++) events.append({ ...projectHumanProgress({
    kind: "native-shell", status: "succeeded", summary: `view invocation ${i} succeeded`,
    activity: { ...activity, toolCallId: `call-${i}` }, secretArguments: "must not project",
  }), timestamp: `2026-09-21T11:35:0${i}Z` });
  events.append({ ...projectHumanProgress({ kind: "native-shell" }), timestamp: "2026-09-21T11:35:02Z" });
  const originals = events.list();
  assert.ok(originals.every(event => !JSON.stringify(event).includes("must not project")));
  const before = projectHumanHistory(originals, [], events.streamId);
  assert.equal(before[0].members.length, 2); assert.equal(before[1].members, undefined);
  events.close(); closed = true; restored.enablePersistence(root);
  assert.deepEqual(restored.list(), originals);
  const after = projectHumanHistory(restored.list(), [], restored.streamId);
  assert.deepEqual(after.flatMap(item => item.members ?? [item]).map(item => [item.source.streamId, item.source.sequence, item.timestamp]),
    originals.map(event => [restored.streamId, event.sequence, event.timestamp]));
});

async function fixture(t, { onSend, content = sharedDesignExample(), openProjectFolder, surface } = {}) {
  const root = await mkdtemp(join(tmpdir(), "human-loop-provider-"));
  const events = new HumanLoopEvents(), permissions = new PermissionBroker(events);
  const owner = { schemaVersion: "human-loop-owner/v1", id: "owner", mainSessionId: "main", privateSessionId: "private",
    workspacePath: root, policy: DEFAULT_POLICY };
  const state = createHumanLoop(owner, { revisionId: "design", digest: policyHash(content) });
  state.requests.push({ id: "original", message: "  Exact original\nmessage.", receivedAt: "2026-09-14T00:00:00Z",
    answers: null, status: "completed", stopId: null, route: null, rejectionReason: null,
    blockingAnswerRefs: [], questionGatesReleased: false });
  state.questions.push({ id: "choice", context: "Current product choice.", question: "Choose the current direction.",
    whyItMatters: "Behavior changes.", importance: "blocking", allowFreeform: true, options: [
      { id: "keep", label: "Keep the current direction", implication: "Continue with the agreed Design." },
      { id: "change", label: "Change the direction", implication: "Revise the Design." },
    ], state: "open", answerRequestId: null, blockingActive: true, source: { role: "designer", resultId: "design-result", requestId: "original",
      requestIds: ["original"], cycleId: null, design: state.design, planDigest: null } });
  state.handoffs.push({ id: "handoff:design-result", requestId: "original", requestIds: ["original"], cycleId: null,
    presented: true, snapshot: { id: "before", digest: "b".repeat(64) },
    result: { schemaVersion: "human-role-result/v1", resultId: "design-result", inputDigest: "c".repeat(64),
      outcome: { kind: "designer-unchanged", summary: "Choose a product direction.", explanation: "No change yet.", questions: [] } } });
  const design = { binding: state.design, content };
  const received = [];
  let status = "waiting-answer";
  const runtime = {
    sessionId: "private",
    transport: { attachmentCapabilities: async () => ({ supported: true, limits: { maxBytes: 4 * 1024 * 1024, maxImages: 1 } }) },
    state: async () => structuredClone(state),
    readiness: async () => ({ status, reason: null, activeRequestId: null, workspacePath: root }),
    conversation: async () => [],
    currentDesign: async () => design,
    commands: { read: async () => ({ apps: [], commands: [] }), stop: async () => ({ status: "stopped" }) },
    send: async (input) => {
      received.push(input); await onSend?.(input);
      if (!state.requests.some(({ id }) => id === input.id)) state.requests.push({ ...input, status: "waiting", stopId: null,
        route: null, rejectionReason: null, blockingAnswerRefs: [], questionGatesReleased: false });
      events.touch();
    },
    stop: async () => { status = "ready"; for (const question of state.questions) question.blockingActive = false; events.touch(); },
  };
  let installationStatus = "ready", starts = 0;
  const installation = { runtime, read: async () => ({ status: installationStatus, reason: null,
    canStart: installationStatus === "saved-state", canReopen: installationStatus === "closed" }),
    close: async () => { status = "closed"; installationStatus = "closed"; } };
  const provider = await createHumanLoopProvider({ repositoryRoot: root,
    publicDirectory: fileURLToPath(new URL("../public", import.meta.url)), events, permissions, getInstallation: () => installation,
    start: async () => { starts++; installationStatus = "ready"; status = "waiting-answer"; }, openProjectFolder, surface });
  const browserCleanups = [];
  const openBrowser = () => openFixtureBrowser({ after: (cleanup) => browserCleanups.push(cleanup) });
  t.after(async () => {
    // Close browser HTTP/SSE clients before awaiting the provider's server.close().
    try { for (const cleanup of browserCleanups) await cleanup(); }
    finally { await provider.close(); events.close(); await getHostStateWal(root).close(); await rm(root, { recursive: true, force: true }); }
  });
  const post = (path, value, origin) => fetch(new URL(path, provider.url), { method: "POST",
    headers: { "content-type": "application/json", ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(value) });
  return { root, provider, received, state, design, post, events, permissions, openBrowser, runtime, starts: () => starts,
    setInstallationStatus: (value) => { installationStatus = value; events.touch(); } };
}

test("implementation confirmation has its own endpoint, never a tool-permission or text-request side effect", async t => {
  const f = await fixture(t), decisions = [];
  f.runtime.decideImplementation = async input => { decisions.push(input); return input; };
  const path = "/api/implementation-confirmations/confirmation%3Aone";
  let response = await f.post(path, { decision: "approved" });
  assert.equal(response.status, 200);
  assert.deepEqual(decisions, [{ confirmationId: "confirmation:one", decision: "approved" }]);
  assert.deepEqual(f.received, []);
  response = await f.post(path, { decision: "once" });
  assert.equal(response.status, 409);
  response = await f.post(path, { decision: "cancelled", message: "hidden user text" });
  assert.equal(response.status, 409);
  f.setInstallationStatus("closed");
  response = await f.post(path, { decision: "approved" });
  assert.equal(response.status, 409);
  assert.equal(decisions.length, 1);
});

test("delivery surface is provider-bound on every shell URL without startup, workflow dispatch or mutable source", async t => {
  const canvas = await fixture(t);
  const browser = await fixture(t, { surface: "browser" });
  for (const path of ["/", "/index.html", "/human-loop.html"]) {
    assert.match(await (await fetch(new URL(path, canvas.provider.url))).text(), /data-tandem-surface="canvas"/);
    assert.match(await (await fetch(new URL(path, browser.provider.url))).text(), /data-tandem-surface="browser"/);
  }
  assert.equal(await (await fetch(new URL("human-loop-app.js", canvas.provider.url))).text(),
    await (await fetch(new URL("human-loop-app.js", browser.provider.url))).text());
  assert.equal(browser.starts(), 0); assert.equal(canvas.starts(), 0);
  assert.deepEqual(browser.received, []); assert.deepEqual(canvas.received, []);
  await assert.rejects(createHumanLoopProvider({ surface: "remote" }), /Unsupported Tandem delivery surface/);
});

test("private permission UI captures exact IDs, rejects foreign ownership and exposes broker session access with live Off",
  { skip: !browserAvailable, timeout: 60_000 }, async t => {
    const f = await fixture(t), pending = [];
    const source = (await readFile(new URL("../src/extension.mjs", import.meta.url), "utf8")).replaceAll("\r\n", "\n");
    const start = source.indexOf("  permissionHandler: (request, invocation, lifetime) => permissions.request(");
    const end = source.indexOf(",\n  resetPermissions:", start);
    assert.ok(start >= 0 && end > start);
    const handler = new Function("permissions", `return ${source.slice(start + "  permissionHandler: ".length, end)};`)(f.permissions);
    const request = (id, { signal, sessionId = "private", managedSettingsEnabled = false } = {}) => {
      const result = handler({ kind: "read", path: `${id}.txt`, intention: `Read ${id}`, toolCallId: `call-${id}` },
        { sessionId, managedSettingsEnabled }, { signal, onceOnly: true, nativeSessionGrantEligible: true,
          provenance: { toolName: "view", taskId: "task", requestId: "request" } });
      pending.push(result); return result;
    };
    const withdrawn = new AbortController();
    request("single"); request("first"); request("withdrawn", { signal: withdrawn.signal }); request("third");
    request("foreign", { sessionId: "other" });
    try {
      const ids = f.permissions.list("private").map(r => r.id), foreign = f.permissions.list("other")[0].id;
      assert.equal((await f.post("/api/permissions/once", { requestIds: [ids[0], foreign] })).status, 409);
      assert.equal((await f.post(`/api/access/${foreign}`, { decision: "all" })).status, 409);
      assert.equal(f.permissions.list().length, 5);
      const browser = await f.openBrowser();
      await browser.call("Page.navigate", { url: f.provider.url });
      await browser.waitFor('document.querySelector("[data-access-batch=once]")?.textContent.includes("(4)")');
      assert.equal(await browser.evaluate('document.querySelectorAll("[data-access-decision=session],[data-access-decision=all]").length'), 0);
      const point = await browser.evaluate(`(async () => {
        const button=document.querySelector('[data-request-id="${ids[0]}"][data-access-decision="once"]');
        button.scrollIntoView({block:'center'});
        await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));
        const r=button.getBoundingClientRect(), point={x:r.x+r.width/2,y:r.y+r.height/2};
        if(button.disabled||!button.contains(document.elementFromPoint(point.x,point.y)))throw new Error('Individual approval is unreachable.');
        return point;
      })()`);
      for (const type of ["mousePressed", "mouseReleased"]) {
        await browser.call("Input.dispatchMouseEvent", { type, button: "left", clickCount: 1, ...point });
      }
      await browser.waitFor('document.querySelector("[data-access-batch=once]")?.textContent.includes("(3)")');
      assert.deepEqual(f.permissions.list("private").map(r => r.id), ids.slice(1),
        "Individual once approval leaves every other request undecided.");
      const unsubscribe = f.events.subscribe(event => {
        if (event.type === "permission.granted") { unsubscribe(); withdrawn.abort(); request("late"); }
      });
      await browser.evaluate('document.querySelector("[data-access-batch=once]").click()');
      await browser.waitFor('document.body.textContent.includes("1 were no longer pending")');
      assert.equal(f.permissions.list("private").length, 1);
      assert.ok(!ids.includes(f.permissions.list("private")[0].id));
      await browser.waitFor('document.querySelector("[data-access-batch=all]")?.disabled === false');
      await browser.evaluate('document.querySelector("[data-access-batch=all]").click()');
      await browser.waitFor('!!document.querySelector("[data-session-access-off]")');
      assert.equal(f.permissions.remembered("private").all, true);
      assert.equal((await request("future")).kind, "approve-once");
      request("managed", { managedSettingsEnabled: true });
      await browser.waitFor('document.querySelector("[data-access-batch=all]")?.disabled === true');
      const managedId = f.permissions.list("private")[0].id;
      await browser.evaluate('document.querySelector("[data-session-access-off]").click()');
      await browser.waitFor('!document.querySelector("[data-session-access-off]")');
      assert.equal(f.permissions.remembered("private").all, false);
      assert.deepEqual(f.permissions.list("private").map(r => r.id), [managedId], "Off did not deny the pending managed request.");
      request("after-off");
      assert.equal(f.permissions.list("private").length, 2);
      assert.equal(f.permissions.list("other").length, 1);
      assert.deepEqual(browser.exceptions, []);
    } finally { f.permissions.denyAll("Fixture ended."); await Promise.all(pending); }
  });

test("Open project folder is a bound UI action, rejects supplied paths and retains origin protection", async (t) => {
  const targets = [];
  const f = await fixture(t, { openProjectFolder: async (path) => { targets.push(path); return { requested: true, path }; } });
  assert.equal((await f.post("/api/project/open-folder", {})).status, 200);
  assert.deepEqual(targets, [f.root]);
  assert.ok((await f.post("/api/project/open-folder", { path: "main-checkout" })).status >= 400);
  assert.ok((await f.post("/api/project/open-folder", {}, "https://foreign.example")).status >= 400);
  assert.deepEqual(targets, [f.root]);
  assert.deepEqual(f.received, []);
  assert.equal(f.starts(), 0);
});

test("Settings folder button uses real clicks and reports launch failure without workflow dispatch",
  { skip: !browserAvailable, timeout: 60_000 }, async (t) => {
    const targets = []; let fail = false;
    const f = await fixture(t, { openProjectFolder: async (path) => {
      if (fail) throw new Error("Explorer fixture denied launch.");
      targets.push(path); return { requested: true, path };
    } });
    const browser = await f.openBrowser();
    await browser.call("Page.navigate", { url: f.provider.url });
    await browser.waitFor("document.querySelector('#send').disabled === false");
    const click = async (selector) => {
      const point = await browser.evaluate(`(() => { const node=document.querySelector(${JSON.stringify(selector)});
        node.scrollIntoView({block:'center'});const r=node.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
      await browser.call("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
      await browser.call("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
    };
    await click("#canvas-settings > summary"); await click("#open-project-folder");
    await browser.waitFor("document.querySelector('#project-folder-status').textContent.startsWith('Explorer requested')");
    assert.deepEqual(targets, [f.root]);
    fail = true; await click("#open-project-folder");
    await browser.waitFor("document.querySelector('#project-folder-status').textContent.includes('Explorer fixture denied launch')");
    assert.deepEqual(f.received, []); assert.equal(f.starts(), 0);
    assert.deepEqual(browser.exceptions, []);
  });

test("Tandem supplied branding is served faithfully with a readable responsive header and favicon", { skip: !browserAvailable, timeout: 60_000 }, async t => {
  const f = await fixture(t), browser = await f.openBrowser();
  const original = await fetch(new URL('branding/tandem-original.jpg', f.provider.url));
  assert.equal(original.headers.get('content-type'), 'image/jpeg');
  const bytes = Buffer.from(await original.arrayBuffer());
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '3add413098bb0971cd751b6d79dccc50469c2d39afda0a6371065c24184eab0c');
  for (const theme of ['light', 'dark']) {
    const mark = await fetch(new URL(`branding/tandem-blue-${theme}.png`, f.provider.url));
    assert.equal(mark.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await mark.arrayBuffer()), await readFile(new URL(`../public/branding/tandem-blue-${theme}.png`, import.meta.url)));
  }
  for (const width of [1400, 660, 480, 320]) for (const theme of ['light', 'dark']) {
    await browser.call('Emulation.setDeviceMetricsOverride', { width, height: 950, deviceScaleFactor: 1, mobile: width === 320 });
    await browser.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    await browser.call('Page.navigate', { url: f.provider.url });
    await browser.waitFor(`document.querySelector('.brand-mark').naturalWidth === 1200 && document.querySelector('.brand-mark').src.endsWith('tandem-blue-${theme}.png') && !document.querySelector('#send').disabled`);
    const facts = await browser.evaluate(`(()=>{
      const image=document.querySelector('.brand-mark'), slogan=document.querySelector('.brand-slogan');
      const brand=document.querySelector('.brand').getBoundingClientRect(), n=image.getBoundingClientRect(), s=slogan.getBoundingClientRect(), h=document.querySelector('.human-header').getBoundingClientRect();
      const project=document.querySelector('#project-name'), p=project.getBoundingClientRect(), i=image.getBoundingClientRect();
      const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
      const context=canvas.getContext('2d');context.drawImage(image,0,0);const rgba=context.getImageData(0,0,canvas.width,canvas.height).data;
      let transparent=0,ink=0;for(let j=0;j<rgba.length;j+=4){if(rgba[j+3]===0)transparent++;if(rgba[j+3]===255)ink++;}
      const luminance=color=>{context.fillStyle=color;context.fillRect(0,0,1,1);const rgb=Array.from(context.getImageData(0,0,1,1).data).slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};
      const foreground=luminance(getComputedStyle(slogan).color),background=luminance(getComputedStyle(document.querySelector('.human-header')).backgroundColor);
      const overlap=(a,b)=>a.left<b.right&&b.left<a.right&&a.top<b.bottom&&b.top<a.bottom;
      const controls=[document.querySelector('#canvas-settings')].map(e=>e.getBoundingClientRect());
      return {title:document.title,duplicateName:!!document.querySelector('.brand strong'),alt:image.alt,slogan:slogan.textContent,count:document.querySelectorAll('.brand-slogan').length,
        favicon:document.querySelector('link[rel="icon"]').getAttribute('href'), image:[image.naturalWidth,image.naturalHeight],
        pageWidth:document.documentElement.scrollWidth,nameFits:n.left>=brand.left&&n.right<=brand.right,sloganFits:s.left>=0&&s.right<=innerWidth&&s.bottom<=h.bottom,
        aligned:Math.abs(n.left-s.left)<1,stacked:s.top>=n.bottom,projectSeparate:!project.closest('.brand'),height:h.height,
        imageWidth:i.width,transparent,ink,imageBackground:getComputedStyle(image).backgroundColor,
        noOverlap:!overlap(brand,p)&&controls.every(c=>!overlap(c,brand)&&c.right<=innerWidth),
        contrast:(Math.max(foreground,background)+.05)/(Math.min(foreground,background)+.05),
        font:parseFloat(getComputedStyle(slogan).fontSize), color:getComputedStyle(slogan).color, background:getComputedStyle(document.querySelector('.human-header')).backgroundColor};
    })()`);
    assert.equal(facts.title, 'Tandem'); assert.equal(facts.duplicateName, false);
    assert.equal(facts.alt, 'Tandem'); assert.equal(facts.slogan, 'two minds, one direction.');
    assert.equal(facts.count, 1); assert.equal(facts.favicon, 'branding/tandem-original.jpg');
    assert.deepEqual(facts.image, [1200, 260]);
    assert.ok(facts.pageWidth <= width && facts.nameFits && facts.sloganFits, JSON.stringify(facts));
    assert.ok(facts.aligned && facts.stacked && facts.projectSeparate && facts.noOverlap, JSON.stringify(facts));
    assert.ok(facts.height <= 76 && facts.imageWidth >= 180, JSON.stringify(facts));
    assert.equal(facts.imageBackground, 'rgba(0, 0, 0, 0)');
    assert.ok(facts.transparent > 200_000 && facts.ink > 30_000, JSON.stringify(facts));
    assert.ok(facts.font >= 12);
    assert.ok(facts.contrast >= 4.5, JSON.stringify(facts));
    if (process.env.TANDEM_BRAND_EVIDENCE) {
      await mkdir(process.env.TANDEM_BRAND_EVIDENCE, { recursive: true });
      const shot = await browser.call('Page.captureScreenshot', { format: 'png' });
      await writeFile(join(process.env.TANDEM_BRAND_EVIDENCE, `tandem-${width}-${theme}.png`), Buffer.from(shot.data, 'base64'));
      await writeFile(join(process.env.TANDEM_BRAND_EVIDENCE, `tandem-${width}-${theme}.json`), JSON.stringify(facts, null, 2));
    }
    for (const size of ['normal', 'larger', 'largest']) {
      const overflow = await browser.evaluate(`(()=>{
        document.body.dataset.fontSize=${JSON.stringify(size)};
        document.querySelector('#project-name').textContent='A long project context that must not displace the Tandem brand or header actions';
        const brand=document.querySelector('.brand').getBoundingClientRect(), slogan=document.querySelector('.brand-slogan').getBoundingClientRect();
        const settings=document.querySelector('#canvas-settings').getBoundingClientRect();
        return {page:document.documentElement.scrollWidth,slogan:slogan.right,brand:brand.right,action:settings.left};
      })()`);
      assert.ok(overflow.page <= width && overflow.slogan <= overflow.action && overflow.brand <= overflow.action, JSON.stringify({ width, size, overflow }));
    }
  }
  for (const [preference, host, expected] of [['system', 'light', 'light'], ['dark', 'light', 'dark'], ['system', 'dark', 'dark'], ['light', 'dark', 'light']]) {
    await browser.evaluate(`document.body.dataset.theme=${JSON.stringify(preference)};document.documentElement.dataset.colorMode=${JSON.stringify(host)}`);
    await browser.waitFor(`document.querySelector('.brand-mark').src.endsWith('tandem-blue-${expected}.png') && document.querySelector('.brand-mark').complete`);
  }
  assert.deepEqual(browser.exceptions, []);
});

test("clipboard-event PNG preview, removal, image-only retry and retained Conversation use exact general image refs", {
  skip: !browserAvailable, timeout: 60_000,
}, async t => {
  const f = await fixture(t), browser = await f.openBrowser();
  await browser.call('Page.navigate', { url: f.provider.url });
  await browser.waitFor("!document.querySelector('#send').disabled");
  await browser.evaluate(`(()=>{
    globalThis.pasteImage=(mime='image/png',bytes=null)=>{
      const data=new DataTransfer();
      const raw=bytes??Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII='),c=>c.charCodeAt(0));
      data.items.add(new File([raw],'clipboard',{type:mime}));
      return document.querySelector('#message').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
    };
    const text=new DataTransfer();text.setData('text/plain','ordinary text');
    globalThis.textPasteAllowed=document.querySelector('#message').dispatchEvent(new ClipboardEvent('paste',{clipboardData:text,bubbles:true,cancelable:true}));
    pasteImage('image/svg+xml',new TextEncoder().encode('<svg/>'));
  })()`);
  assert.equal(await browser.evaluate('textPasteAllowed'), true);
  await browser.waitFor("document.querySelector('#notice').textContent.includes('unsupported')");
  await browser.evaluate('pasteImage()');
  await browser.waitFor("document.querySelector('#clipboard-caption').textContent.includes('Ready to send')");
  if (process.env.TANDEM_CLIPBOARD_EVIDENCE_DIR) {
    await mkdir(process.env.TANDEM_CLIPBOARD_EVIDENCE_DIR, { recursive: true });
    const screenshot = await browser.call('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(process.env.TANDEM_CLIPBOARD_EVIDENCE_DIR, 'clipboard-preview.png'), Buffer.from(screenshot.data, 'base64'));
  }
  assert.equal(await browser.evaluate("document.querySelector('#clipboard-image').alt"), 'Unsent pasted image');
  await browser.evaluate("document.querySelector('#clipboard-remove').click()");
  assert.equal(await browser.evaluate("document.querySelector('#clipboard-preview').hidden"), true);
  assert.equal(f.received.length, 0);
  await browser.evaluate(`pasteImage('image/png',new Uint8Array([1,2,3]))`);
  await browser.waitFor("document.querySelector('#notice').textContent.includes('Invalid')");
  f.runtime.transport.attachmentCapabilities = async () => ({ supported: false, reason: 'Fixture model cannot receive images.' });
  await browser.evaluate('pasteImage()');
  await browser.waitFor("document.querySelector('#notice').textContent.includes('cannot receive')");
  f.runtime.transport.attachmentCapabilities = async () => ({ supported: true, limits: { maxBytes: 4 * 1024 * 1024, maxImages: 1 } });
  await browser.evaluate('pasteImage()');
  await browser.waitFor("!document.querySelector('#clipboard-preview').hidden && document.querySelector('#clipboard-caption').textContent.includes('Ready')");
  await browser.evaluate(`(()=>{
    const original=fetch;globalThis.blockImageSnapshot=true;let lost=true;
    globalThis.fetch=async (url,options)=>{
      if(String(url)==='/api/snapshot'&&blockImageSnapshot)throw new Error('Snapshot unavailable');
      const response=await original(url,options);
      if(String(url)==='/api/requests'&&lost){lost=false;throw new Error('Lost acknowledgement');}
      return response;
    };
    document.querySelector('#composer').requestSubmit();
  })()`);
  await browser.waitFor("document.querySelector('#send').dataset.retry === 'true' && !document.querySelector('#send').disabled");
  assert.equal(f.received[0].message, '');
  assert.equal(f.received[0].attachments[0].schemaVersion, 'image-attachment/v1');
  assert.equal(Object.hasOwn(f.received[0].attachments[0], 'source'), false);
  await browser.evaluate("blockImageSnapshot=false;document.querySelector('#composer').requestSubmit()");
  await browser.waitFor("document.querySelector('#clipboard-preview').hidden && document.querySelector('#send').dataset.retry === 'false'");
  assert.equal(f.received.length, 2);
  assert.deepEqual(f.received[0], f.received[1]);
  const id = f.received[0].id;
  assert.equal(f.state.requests.filter(request => request.id === id).length, 1);
  await browser.call('Page.reload', {});
  await browser.waitFor(`document.querySelector('[data-entry-id="request:${id}"] img')?.naturalWidth===1`);
  assert.equal(await browser.evaluate(`document.querySelector('[data-entry-id="request:${id}"] img').alt`), 'Attached image');
  await browser.waitFor(`document.querySelector('[data-transition-id="request:${id}"] button')?.textContent === 'Your request'`);
  const retainedSnapshot = await (await fetch(new URL('/api/snapshot', f.provider.url))).json();
  assert.deepEqual(retainedSnapshot.historyRequests.find(request => request.id === id),
    { id, receivedAt: f.received[0].receivedAt });
  await browser.evaluate(`document.querySelector('[data-transition-id="request:${id}"] button').click()`);
  assert.equal(await browser.evaluate("document.querySelector('#messages .state-focused').dataset.entryId"), `request:${id}`);
  if (process.env.TANDEM_CLIPBOARD_EVIDENCE_DIR) {
    const screenshot = await browser.call('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(process.env.TANDEM_CLIPBOARD_EVIDENCE_DIR, 'clipboard-conversation.png'), Buffer.from(screenshot.data, 'base64'));
  }
  await browser.evaluate(`(()=>{
    const data=new DataTransfer();data.items.add(new File([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII='),c=>c.charCodeAt(0))],'p.png',{type:'image/png'}));
    document.querySelector('#message').value='Explain this screenshot.';
    document.querySelector('#message').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
  })()`);
  await browser.waitFor("document.querySelector('#clipboard-caption').textContent.includes('Ready')");
  await browser.evaluate("document.querySelector('#composer').requestSubmit()");
  await browser.waitFor("document.querySelector('#clipboard-preview').hidden");
  assert.equal(f.received.at(-1).message, 'Explain this screenshot.');
  const jpegBytes = jpeg.encode({ width: 1, height: 1, data: Buffer.from([255, 0, 0, 255]) }, 80).data;
  await browser.evaluate(`(()=>{
    const data=new DataTransfer();data.items.add(new File([Uint8Array.from(atob(${JSON.stringify(jpegBytes.toString('base64'))}),c=>c.charCodeAt(0))],'clipboard.jpg',{type:'image/jpg'}));
    document.querySelector('#message').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
  })()`);
  await browser.waitFor("document.querySelector('#clipboard-caption').textContent.includes('Pasted JPEG')");
  await browser.evaluate("document.querySelector('#composer').requestSubmit()");
  await browser.waitFor("document.querySelector('#clipboard-preview').hidden");
  const jpgRef = f.received.at(-1).attachments[0];
  assert.equal(jpgRef.mimeType, 'image/jpeg');
  const imageResponse = await fetch(new URL(`/api/image-attachments/${jpgRef.id}`, f.provider.url));
  assert.equal(imageResponse.headers.get('content-type'), 'image/jpeg');
  assert.deepEqual(Buffer.from(await imageResponse.arrayBuffer()), jpegBytes);
  assert.deepEqual(browser.exceptions, []);
});

for (const [version, createContent] of [["v1", sharedDesignExample], ["v2", sharedDesignExampleV2]]) {
  test(`legacy shared Design ${version} captures its navigated visible view into the static editor`,
    { skip: !browserAvailable, timeout: 60_000 }, async t => {
      const f = await fixture(t, { content: createContent() }), browser = await f.openBrowser();
      await browser.call("Emulation.setDeviceMetricsOverride", { width: 1100, height: 700, deviceScaleFactor: 1, mobile: false });
      await browser.call("Page.navigate", { url: f.provider.url });
      await browser.waitFor("document.querySelector('[data-annotate-artifact=\"interaction\"]')");
      assert.deepEqual(await browser.evaluate("[...document.querySelectorAll('[data-artifact-group]')].map(n=>n.textContent)"), ["Ungrouped"]);
      assert.ok(await browser.evaluate("document.querySelectorAll('[data-artifact-tab]:not([hidden])').length > 0"));
      await browser.evaluate(`(() => {
        const toolbar=document.querySelector('[data-design-artifact="interaction"] .perspective-toolbar');
        const spacer=document.createElement('div');spacer.style.height='800px';toolbar.after(spacer);
        document.querySelector('#design-panel').scrollTop=0;
        document.querySelector('.shared-sketch svg').scrollIntoView({block:'center'});
        toolbar.querySelector('[data-annotate-artifact]').click();
      })()`);
      await browser.waitFor("document.querySelector('.annotation-editor').open && !document.querySelector('[data-annotation-action=attach]').disabled");
      await browser.evaluate("document.querySelector('[data-annotation-action=attach]').click()");
      await browser.waitFor("!document.querySelector('#annotation-preview').hidden");
      assert.match(await browser.evaluate("document.querySelector('#annotation-caption').textContent"), /interaction.*design/);
      assert.equal(f.received.length, 0);
      assert.deepEqual(browser.exceptions, []);
    });
}

test("User story and UI use explicit purpose while notes and annotation bindings follow their original artifact",
  { skip: !browserAvailable, timeout: 60_000 }, async t => {
    const content = multiFormatDesign(), screen = content.artifacts.find(item => item.format === "html");
    screen.category = "ui"; screen.title = "Configure, complete, and review";
    content.artifacts.find(item => item.format === "mermaid").category = "workflows";
    content.artifacts.find(item => item.format === "svg").category = "system";
    content.artifacts.push({ ...screen, id: "journey", title: "Today workspace", category: "user-story",
      source: '<section id="journey"><h1>Complete a checklist</h1><ol><li>Choose a checklist; system opens a preview.<div>Screen thumbnail: checklist</div></li><li>Complete items; system saves progress.</li><li>If saving fails, retry; saved items remain completed.</li><li>Review the outcome.</li></ol></section>' },
      { schemaVersion: "artifact/v2", format: "markdown", id: "journey-note", title: "Rationale", category: "contracts-data",
        source: "Retry preserves completed items.", noteForArtifactId: "journey" },
      { ...screen, id: "retained-experience", category: "experience" },
      { ...screen, id: "uncategorized", category: undefined });
    delete content.artifacts.at(-1).category;
    const before = JSON.stringify(content), digest = policyHash(content);
    const f = await fixture(t, { content }), browser = await f.openBrowser();
    await browser.call("Page.navigate", { url: f.provider.url });
    await browser.waitFor("document.querySelector('[data-artifact-group=\"user-story\"]')");
    const click = selector => browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const visible = () => browser.evaluate("[...document.querySelectorAll('[data-artifact-tab]')].filter(n=>!n.hidden).map(n=>n.dataset.artifactTab)");
    assert.deepEqual(await browser.evaluate("[...document.querySelectorAll('[data-artifact-group]')].map(n=>n.textContent)"),
      ["User story", "UI", "Workflows", "System", "Ungrouped"]);
    await click('[data-artifact-group="user-story"]');
    assert.deepEqual(await visible(), ["journey"]);
    await browser.waitFor("!document.querySelector('[data-annotate-artifact=\"journey\"]').disabled");
    await browser.evaluate("document.querySelector('.source-artifact iframe').scrollIntoView({block:'center'})");
    await click('[data-annotate-artifact="journey"]');
    await browser.waitFor("document.querySelector('.annotation-editor').open && !document.querySelector('[data-annotation-action=attach]').disabled");
    await click('[data-annotation-action="attach"]');
    await browser.waitFor("!document.querySelector('#annotation-preview').hidden");
    await click('[data-artifact-note="journey-note"]');
    await browser.waitFor("document.querySelector('[data-note-primary=\"journey\"]')");
    assert.equal(await browser.evaluate("document.querySelector('[data-artifact-group=\"user-story\"]').getAttribute('aria-pressed')"), "true");
    assert.equal(await browser.evaluate("document.querySelector('[data-artifact-tab=\"journey-note\"]')"), null);
    await click('[data-note-primary="journey"]');
    await click('[data-artifact-group="ui"]');
    assert.deepEqual(await visible(), [screen.id]);
    await click('[data-artifact-group="ungrouped"]');
    assert.deepEqual(await visible(), ["retained-experience", "uncategorized"]);
    assert.match(await browser.evaluate("document.querySelector('.artifact-category-notice').textContent"), /original content is unchanged/);
    await click('[data-artifact-group="ui"]');
    await browser.evaluate("document.querySelector('#message').value='Keep the journey source binding';document.querySelector('#composer').requestSubmit()");
    await browser.waitFor("document.querySelector('#annotation-preview').hidden");
    const reference = f.received[0].attachments[0];
    assert.equal(reference.source.artifactId, "journey");
    assert.equal(reference.source.revisionId, "design");
    assert.equal(reference.source.designDigest, digest);
    assert.equal(JSON.stringify(content), before, "Navigation never rewrites legacy metadata, IDs, source or notes.");
    for (const width of [390, 1280]) {
      await browser.call("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
      for (const group of ["user-story", "ui", "ungrouped"]) {
        await click(`[data-artifact-group="${group}"]`);
        await browser.waitFor("!document.querySelector('[data-annotate-artifact]').disabled");
        if (process.env.PURPOSE_SPLIT_EVIDENCE) {
          await mkdir(process.env.PURPOSE_SPLIT_EVIDENCE, { recursive: true });
          await writeFile(join(process.env.PURPOSE_SPLIT_EVIDENCE, `${width}-${group}.png`), await browser.screenshot());
        }
      }
    }
    assert.deepEqual(browser.exceptions, []);
  });

test("purpose groups retain exact titles, per-group selection, references and native keyboard navigation",
  { skip: !browserAvailable, timeout: 60_000 }, async t => {
    const content = multiFormatDesign();
    content.artifacts[0].category = "workflows";
    content.artifacts[1].category = "ui";
    content.artifacts[2].category = "ui";
    content.artifacts.push({ ...content.artifacts[1], id: "html-workflow", title: "Process in HTML", category: "workflows" },
      { ...content.artifacts[1], id: "uncategorized", title: "System architecture screen workflow", category: undefined });
    delete content.artifacts.at(-1).category;
    const f = await fixture(t, { content }), browser = await f.openBrowser();
    await browser.call("Emulation.setDeviceMetricsOverride", { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });
    await browser.call("Page.navigate", { url: f.provider.url });
    await browser.waitFor("document.querySelector('[data-artifact-group]')");
    const visible = () => browser.evaluate("[...document.querySelectorAll('[data-artifact-tab]')].filter(n=>!n.hidden).map(n=>n.textContent)");
    const click = selector => browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const selected = () => browser.evaluate("document.querySelector('[data-artifact-tab][aria-pressed=\"true\"]').dataset.artifactTab");
    assert.deepEqual(await browser.evaluate("[...document.querySelectorAll('[data-artifact-group]')].map(n=>n.textContent)"),
      ["UI", "Workflows", "Ungrouped"]);
    assert.deepEqual(await visible(), ["Order workflow", "Process in HTML"]);
    await click('[data-artifact-tab="html-workflow"]');
    await click('[data-artifact-group="ui"]');
    assert.deepEqual(await visible(), ["Checkout screen", "Pickup geometry"]);
    const tabPoint = await browser.evaluate(`(() => {
      const r=document.querySelector('[data-artifact-tab="pickup-plan"]').getBoundingClientRect();
      return {x:r.left+r.width/2,y:r.top+r.height/2};
    })()`);
    await browser.call("Input.dispatchMouseEvent", { type: "mousePressed", ...tabPoint, button: "left", buttons: 1, clickCount: 1 });
    await browser.call("Input.dispatchMouseEvent", { type: "mouseReleased", ...tabPoint, button: "left", buttons: 0, clickCount: 1 });
    assert.equal(await browser.evaluate("document.activeElement.dataset.artifactTab"), "pickup-plan", "Click retains tab focus");
    const height = await browser.evaluate("document.querySelector('#backbone-tabs').getBoundingClientRect().height");
    await click('[data-artifact-group="workflows"]');
    assert.equal(await selected(), "html-workflow");
    await click('[data-artifact-group="ui"]');
    assert.equal(await selected(), "pickup-plan");
    await click('[data-artifact-group="ungrouped"]');
    assert.deepEqual(await visible(), ["System architecture screen workflow"]);
    await browser.evaluate(`(() => {
      const reference=[...document.querySelectorAll('.design-reference')].find(n=>n.textContent==='checkout');
      reference.closest('details').open=true;
      reference.focus(); reference.click();
    })()`);
    assert.equal(await selected(), "checkout");
    assert.deepEqual(await visible(), ["Checkout screen", "Pickup geometry"]);
    assert.equal(await browser.evaluate("document.activeElement.textContent"), "checkout", "Artifact reference does not steal focus");
    await browser.evaluate("document.querySelector('[data-artifact-group=\"ui\"]').focus()");
    await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    assert.equal(await browser.evaluate("document.activeElement.dataset.artifactGroup"), "workflows");
    await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
    await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    assert.equal(await selected(), "html-workflow");
    assert.equal(await browser.evaluate("document.activeElement.dataset.artifactGroup"), "workflows");
    assert.equal(await browser.evaluate("document.activeElement.matches(':focus-visible') && getComputedStyle(document.activeElement).outlineStyle !== 'none'"), true);
    await browser.evaluate("document.querySelector('[data-artifact-tab=\"order-flow\"]').focus()");
    await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
    await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    assert.equal(await selected(), "order-flow");
    assert.equal(await browser.evaluate("document.activeElement.dataset.artifactTab"), "order-flow");
    await click('[data-artifact-tab="html-workflow"]');
    await browser.call("Emulation.setDeviceMetricsOverride", { width: 360, height: 780, deviceScaleFactor: 1, mobile: false });
    assert.equal(await browser.evaluate("document.querySelector('#backbone-tabs').getBoundingClientRect().height"), height);
    assert.equal(await browser.evaluate("[...document.querySelectorAll('.artifact-navigation-row')].every(n=>n.clientWidth<=360 && getComputedStyle(n).overflowX==='auto')"), true);
    if (process.env.TANDEM_GROUP_SCREENSHOTS) {
      await mkdir(process.env.TANDEM_GROUP_SCREENSHOTS, { recursive: true });
      const shot = await browser.call("Page.captureScreenshot", { format: "png" });
      await writeFile(join(process.env.TANDEM_GROUP_SCREENSHOTS, "purpose-groups-narrow.png"), Buffer.from(shot.data, "base64"));
    }
    f.design.content = structuredClone(content);
    f.design.content.artifacts = f.design.content.artifacts.filter(({ id }) => id !== "html-workflow");
    f.design.binding = { revisionId: "next-design", digest: policyHash(f.design.content) };
    f.state.design = f.design.binding;
    f.events.touch();
    await browser.waitFor("!document.querySelector('[data-artifact-tab=\"html-workflow\"]')");
    await click('[data-artifact-group="ui"]');
    assert.equal(await selected(), "checkout", "Revision changes clear remembered category selections");
    await click('[data-artifact-group="workflows"]');
    assert.equal(await selected(), "order-flow", "Removed selections cannot survive a revision");
    assert.deepEqual(browser.exceptions, []);
  });

test("portrait HTML retains its captured bitmap and strokes across shorter tabs and live resize",
  { skip: !browserAvailable, timeout: 60_000 }, async t => {
    const content = multiFormatDesign();
    const html = content.artifacts.find(({ format }) => format === "html");
    html.category = "ui";
    content.artifacts.find(({ format }) => format === "svg").category = "system";
    content.artifacts.find(({ format }) => format === "mermaid").category = "workflows";
    content.artifacts.push({ ...content.artifacts.find(({ format }) => format === "svg"), id: "experience-detail", category: "ui" });
    html.width = 1440; html.height = 1480;
    content.artifacts.sort((a, b) => Number(b === html) - Number(a === html));
    const f = await fixture(t, { content }), browser = await f.openBrowser();
    await browser.call("Emulation.setDeviceMetricsOverride", { width: 1800, height: 1000, deviceScaleFactor: 1, mobile: false });
    await browser.call("Page.navigate", { url: f.provider.url });
    await browser.waitFor("document.querySelector('iframe[data-artifact-surface]')");
    await browser.evaluate(`(() => {
      const mount=document.querySelector('#backbone-proposal'), scroll=document.createElement('div');
      scroll.id='test-artifact-scroll';scroll.style.cssText='height:350px;overflow:auto';
      mount.replaceWith(scroll);scroll.append(mount);
      document.querySelector('iframe[data-artifact-surface]').scrollIntoView({block:'end',behavior:'instant'});
    })()`);
    await browser.evaluate("new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))");
    await browser.evaluate("document.querySelector('[data-annotate-artifact=checkout]').click()");
    await browser.waitFor("document.querySelector('.annotation-editor').open && !document.querySelector('[data-annotation-action=attach]').disabled");
    const point = await browser.evaluate(`(() => {const r=document.querySelector('.annotation-editor-ink').getBoundingClientRect();
      return {x:r.left+20,y:r.top+20};})()`);
    await browser.call("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", buttons: 1, clickCount: 1 });
    await browser.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x + 30, y: point.y + 20, buttons: 1 });
    await browser.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x + 30, y: point.y + 20, button: "left", buttons: 0 });
    const before = await browser.evaluate(`({scroll:document.querySelector('#test-artifact-scroll').scrollTop,
      image:document.querySelector('.annotation-editor-ink').toDataURL()})`);
    assert.ok(before.scroll > 0);
    await browser.evaluate("document.querySelector('[data-annotation-action=close]').click()");
    await browser.evaluate("document.querySelector('[data-artifact-tab=\"experience-detail\"]').click()");
    await browser.waitFor("document.querySelector('iframe[data-artifact-surface]')");
    await browser.evaluate("document.querySelector('[data-artifact-tab=\"checkout\"]').click()");
    await browser.waitFor("document.querySelector('iframe[data-artifact-surface]')");
    assert.deepEqual(await browser.evaluate(`({scroll:document.querySelector('#test-artifact-scroll').scrollTop,
      image:document.querySelector('.annotation-editor-ink').toDataURL()})`), before);
    await browser.evaluate("document.querySelector('[data-artifact-group=\"system\"]').click()");
    await browser.waitFor("document.querySelector('iframe[data-artifact-surface]')");
    await browser.evaluate("document.querySelector('[data-artifact-group=\"ui\"]').click()");
    await browser.waitFor("document.querySelector('iframe[data-artifact-surface]')");
    assert.deepEqual(await browser.evaluate(`({scroll:document.querySelector('#test-artifact-scroll').scrollTop,
      image:document.querySelector('.annotation-editor-ink').toDataURL()})`), before,
    "Tab replacement restores the existing crop and strokes, not a newly bound draft.");
    await browser.evaluate("document.querySelector('[data-annotate-artifact=checkout]').click();document.querySelector('[data-annotation-action=attach]').click()");
    await browser.waitFor("!document.querySelector('#annotation-preview').hidden");
    assert.match(await browser.evaluate("document.querySelector('#annotation-caption').textContent"), /checkout.*design/);
    await browser.call("Emulation.setDeviceMetricsOverride", { width: 900, height: 700, deviceScaleFactor: 1, mobile: false });
    await browser.evaluate("document.querySelector('iframe[data-artifact-surface]').scrollIntoView({block:'center'})");
    await browser.evaluate("document.querySelector('[data-annotate-artifact=checkout]').click()");
    await browser.waitFor("document.querySelector('.annotation-editor').open && !document.querySelector('[data-annotation-action=attach]').disabled");
    assert.equal(await browser.evaluate("(()=>{const c=document.querySelector('.annotation-editor-ink');return c.getContext('2d').getImageData(0,0,c.width,c.height).data.some((value,index)=>index%4===3&&value)})()"), false,
      "Successful attachment finishes the prior sketch; the next annotation starts empty.");
    assert.equal(f.received.length, 0);
    assert.deepEqual(browser.exceptions, []);
  });

for (const format of ["mermaid", "html", "svg"]) test(`isolated ${format} snapshots capture the navigated visible view and upload their exact source`,
  { skip: !browserAvailable, timeout: 90_000 }, async (t) => {
    const content = multiFormatDesign();
    content.artifacts = content.artifacts.filter(artifact => artifact.format === format);
    content.outcomes[0].references = [content.artifacts[0].id];
    const f = await fixture(t, { content }), browser = await f.openBrowser();
    const id = content.artifacts[0].id;
    await browser.call("Emulation.setDeviceMetricsOverride", { width: 1100, height: 700, deviceScaleFactor: 1, mobile: false });
    await browser.call("Page.navigate", { url: f.provider.url });
    await browser.waitFor(`document.querySelector('[data-annotate-artifact="${id}"]')?.disabled === false`);
    // An invisible surface cannot silently substitute a different crop.
    await browser.evaluate(`(() => {
      const section=document.querySelector('[data-design-artifact="${id}"]');
      const spacer=document.createElement('div');spacer.style.height='800px';
      section.querySelector('.perspective-toolbar').after(spacer);
      document.querySelector('#design-panel').scrollTop=0;
      section.querySelector('[data-annotate-artifact]').click();
    })()`);
    await browser.waitFor("document.querySelector('.annotation-editor').open && document.querySelector('.annotation-editor-status').textContent.includes('Bring the supported artifact into view')");
    await browser.evaluate("document.querySelector('[data-annotation-action=close]').click();document.querySelector('.source-artifact iframe').scrollIntoView({block:'center'})");
    await browser.evaluate("new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))");
    const region = await browser.evaluate(`(async () => {
      const frame=document.querySelector('[data-design-artifact] iframe'),bounds=frame.getBoundingClientRect();
      const {visibleDiagramRegion}=await import('/annotation-controller.js');
      const r=visibleDiagramRegion(frame,document.querySelector('#design-panel'));
      const target=frame.contentDocument.getElementById('${format === "html" ? "drink" : "counter"}');
      const b=target?.getBoundingClientRect();
      const visibleTop=b ? Math.max(r.top,bounds.top+b.top*bounds.height/frame.clientHeight) : 0;
      const visibleBottom=b ? Math.min(r.top+r.height,bounds.top+b.bottom*bounds.height/frame.clientHeight) : 0;
      if(b && visibleBottom-visibleTop<4)throw new Error('The colored geometry must intersect the captured viewport.');
      const colorPoint=b ? {x:Math.round(bounds.left+(b.left+b.width*.75)*bounds.width/frame.clientWidth-r.left),
        y:Math.floor(visibleBottom-r.top-3)} : null;
      return {width:r.width,height:r.height,colorPoint};
    })()`);
    assert.ok(region.width > 20 && region.height > 20);
    await browser.evaluate("document.querySelector('[data-annotate-artifact]').click()");
    await browser.waitFor("document.querySelector('.annotation-editor-base').naturalWidth>0 && !document.querySelector('[data-annotation-action=attach]').disabled");
    const point=await browser.evaluate(`(()=>{
      const c=document.querySelector('.annotation-editor-ink'),r=c.getBoundingClientRect();
      return {x:r.left+10*r.width/c.width,y:r.top+10*r.height/c.height,dx:10*r.width/c.width,dy:10*r.height/c.height};
    })()`);
    await browser.call("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, x: point.x, y: point.y });
    await browser.call("Input.dispatchMouseEvent", { type: "mouseMoved", button: "left", buttons: 1, x: point.x + point.dx, y: point.y + point.dy });
    await browser.call("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, x: point.x + point.dx, y: point.y + point.dy });
    await browser.evaluate("document.querySelector('[data-annotation-action=attach]').click()");
    await browser.waitFor("!document.querySelector('#annotation-preview').hidden");
    const pixels = await browser.evaluate(`(async () => {
      const image=document.querySelector('#annotation-image');await image.decode();
      const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
      const c=canvas.getContext('2d');c.drawImage(image,0,0);
      const stroke=[...c.getImageData(15,15,1,1).data];
      const p=${JSON.stringify(region.colorPoint)};
      return {width:canvas.width,height:canvas.height,stroke,color:p&&[...c.getImageData(p.x,p.y,1,1).data]};
    })()`);
    assert.equal(pixels.width, region.width);
    assert.equal(pixels.height, region.height);
    assert.ok(pixels.stroke[0] > 180 && pixels.stroke[1] < 130, JSON.stringify(pixels));
    if (format !== "mermaid") {
      assert.ok(region.colorPoint.x >= 0 && region.colorPoint.x < pixels.width);
      assert.ok(region.colorPoint.y >= 0 && region.colorPoint.y < pixels.height, JSON.stringify({ region, pixels }));
      assert.deepEqual(pixels.color, [224, 48, 48, 255], 'CSS/SVG geometry retains its source-to-crop pixel position');
    }
    await browser.evaluate("document.querySelector('#message').value='Explain this exact marked artifact.';document.querySelector('#message').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))");
    await browser.waitFor("document.querySelector('#message').value === ''");
    assert.equal(f.received.length, 1);
    const ref = f.received[0].attachments[0];
    assert.equal(ref.source.artifactId, id);
    assert.equal(ref.source.designDigest, policyHash(content));
    assert.equal(ref.source.revisionId, f.state.design.revisionId);
    const saved = await new AnnotationAttachmentStore(f.root).get(ref.id);
    assert.equal(saved.bytes.readUInt32BE(16), pixels.width);
    assert.equal(saved.bytes.readUInt32BE(20), pixels.height);
    const revised = structuredClone(content);
    revised.artifacts[0].source += "\n";
    f.design.content = revised;
    f.design.binding = { revisionId: "new-design", digest: policyHash(revised) };
    f.state.design = f.design.binding;
    const response = await fetch(new URL("/api/annotation-attachments", f.provider.url), {
      method: "POST", headers: { "content-type": "image/png",
        "x-annotation-source": encodeURIComponent(JSON.stringify(ref.source)) },
      body: saved.bytes,
    });

    assert.equal(response.status, 409);
    assert.equal(f.received.length, 1);
    assert.deepEqual(browser.exceptions, []);
    if (process.env.MULTI_FORMAT_EVIDENCE_DIR) {
      await mkdir(process.env.MULTI_FORMAT_EVIDENCE_DIR, { recursive: true });
      await writeFile(join(process.env.MULTI_FORMAT_EVIDENCE_DIR, `${format}-panel.png`), await browser.screenshot());
      await writeFile(join(process.env.MULTI_FORMAT_EVIDENCE_DIR, `${format}-capture.png`), saved.bytes);
      await writeFile(join(process.env.MULTI_FORMAT_EVIDENCE_DIR, `${format}-binding.json`), JSON.stringify(ref.source, null, 2));
    }
  });

test("source-reference navigation awaits rendering and resolves data-ref before conflicting DOM IDs",
  { skip: !browserAvailable, timeout: 60_000 }, async t => {
    const content = multiFormatDesign();
    content.artifacts = [content.artifacts[0], {
      schemaVersion: "artifact/v1", format: "html", id: "reference-screen", title: "Reference screen",
      width: 800, height: 480,
      source: '<div style="width:200px;height:100px;overflow:clip"><div style="height:200px">Spacer</div><button id="first" data-ref="target" type="button">A</button><button id="target" data-ref="other" type="button">B</button></div>',
    }];
    content.outcomes[0].references = ["reference-screen#target"];
    const f = await fixture(t, { content }), browser = await f.openBrowser();
    await browser.call("Page.navigate", { url: f.provider.url });
    await browser.waitFor("document.querySelector('.design-reference')");
    await browser.evaluate("document.querySelector('.design-reference').click()");
    await browser.waitFor(`document.querySelector('[data-design-artifact="reference-screen"] iframe')?.contentDocument?.activeElement?.id === 'first'`);
    const state = await browser.evaluate(`(() => {
      const frame=document.querySelector('[data-design-artifact="reference-screen"] iframe'),doc=frame.contentDocument;
      return {id:doc.activeElement.id,ref:doc.activeElement.dataset.ref,
        scroll:[doc.documentElement.scrollTop,doc.body.scrollTop,doc.activeElement.parentElement.scrollTop]};
    })()`);
    assert.deepEqual(state, { id: "first", ref: "target", scroll: [0, 0, 0] });
    assert.equal(f.received.length, 0);
    assert.deepEqual(browser.exceptions, []);
  });

test("new provider separates ordinary/answer APIs, rejects all stale approval/Apply paths and projects only the new lifecycle", async (t) => {
  const f = await fixture(t);
  const input = { id: "request", message: "Keep the current direction.", receivedAt: new Date().toISOString() };
  assert.equal((await f.post("/api/requests", input)).status, 202);
  assert.equal(f.received[0].answers, null);
  const batch = { schemaVersion: "human-question-answers/v1", answers: [{ questionId: "choice", sourceResultId: "design-result", kind: "option", value: "keep" }] };
  assert.equal((await f.post("/api/requests", { ...input, id: "hidden", answers: batch })).status, 409);
  assert.equal((await f.post("/api/answers", { ...input, id: "answer", answers: batch })).status, 202);
  assert.deepEqual(f.received[1].answers, batch);
  for (const path of ["/api/change-plan/approve", "/api/workflow-delivery/apply", "/api/workflow-recovery", "/api/change-plan/display"]) {
    assert.equal((await f.post(path, {})).status, 409);
  }
  assert.equal((await f.post("/api/requests", { ...input, id: "cross-origin" }, "https://example.invalid")).status, 409);
  const view = (await (await fetch(new URL("/api/snapshot", f.provider.url))).json());
  assert.equal(view.schemaVersion, "human-loop-snapshot-view/v1");
  assert.equal(view.workflow.status, "waiting-answer");
  assert.equal(view.workflow.canStop, true);
  assert.equal(view.changePlan, undefined);
  assert.equal(view.workflowDelivery, undefined);
  assert.equal(view.messages[0].text, "  Exact original\nmessage.");
  const answered = view.messages.find(({ requestId }) => requestId === "answer");
  assert.equal(answered.text, input.message);
  assert.equal(answered.answerDetails[0].question, "Choose the current direction.");
  assert.equal(answered.answerDetails[0].answer, "Keep the current direction");
  f.state.questions[0].privatePrompt = "SECRET";
  assert.doesNotMatch(JSON.stringify(projectHumanLoopView(f.state, { status: "waiting-answer", reason: null })), /SECRET/);
  const inventory = await (await fetch(new URL("/api/host-state", f.provider.url))).json();
  assert.equal(inventory.schemaVersion, "host-state-inventory/v1");
  assert.equal(inventory.owned, false);
  assert.doesNotMatch(JSON.stringify(inventory), /Exact original|SECRET/);
  await assert.rejects(access(join(f.root, ".tandem", "living-canvas", "host-state", "journal.wal")), { code: "ENOENT" });
});

async function clickBrowser(browser, selector) {
  const point = await browser.evaluate(`(async () => { const n=document.querySelector(${JSON.stringify(selector)}); n.scrollIntoView({block:'center'}); await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))); const r=n.getBoundingClientRect(); const p={x:r.x+r.width/2,y:r.y+r.height/2}; if(!n.contains(document.elementFromPoint(p.x,p.y))) throw new Error('Control is not hit-testable: '+${JSON.stringify(selector)}); return p; })()`);
  await browser.call("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
  await browser.call("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
}

test("browser exposes verified reopen for closed workflow and saved-state startup without replaying requests", { skip: !browserAvailable, timeout: 60_000 }, async (t) => {
  const f = await fixture(t), browser = await f.openBrowser();
  await browser.call("Emulation.setDeviceMetricsOverride", { width: 1500, height: 1100, deviceScaleFactor: 1, mobile: false });
  await browser.call("Page.navigate", { url: f.provider.url });
  await browser.waitFor("!document.querySelector('#shutdown').disabled");
  await clickBrowser(browser, "#canvas-settings > summary");
  await clickBrowser(browser, "#open-diagnostics");
  await clickBrowser(browser, "#shutdown");
  try { await browser.waitFor("!document.querySelector('#initialize').hidden && document.querySelector('#initialize').textContent === 'Reopen runtime'"); }
  catch (error) { throw new Error(`${error.message}\n${JSON.stringify(await browser.evaluate("({body: document.body.innerText, button: document.querySelector('#initialize').outerHTML})"))}`); }
  assert.equal(await browser.evaluate("document.querySelector('#send').disabled"), true);
  await clickBrowser(browser, "#initialize");
  await browser.waitFor("document.querySelector('#initialize').hidden");
  assert.equal(f.starts(), 1); assert.deepEqual(f.received, []);
  f.setInstallationStatus("saved-state");
  await browser.waitFor("document.querySelector('#initialize').textContent === 'Verify saved runtime'");
  await clickBrowser(browser, "#initialize");
  await browser.waitFor("document.querySelector('#initialize').hidden");
  assert.equal(f.starts(), 2); assert.deepEqual(f.received, []);
  assert.deepEqual(browser.exceptions, []);
});

test("composer retains the exact envelope after lost acknowledgement and failed refresh instead of generating a duplicate", { skip: !browserAvailable, timeout: 60_000 }, async (t) => {
  const f = await fixture(t), browser = await f.openBrowser();
  await browser.call("Emulation.setDeviceMetricsOverride", { width: 1500, height: 1100, deviceScaleFactor: 1, mobile: false });
  await browser.call("Page.navigate", { url: f.provider.url });
  await browser.waitFor("!document.querySelector('#send').disabled");
  await browser.evaluate(`(() => {
    const original = window.fetch.bind(window); window.blockSnapshots = false; let lose = true;
    window.fetch = async (url, options) => {
      if (url === '/api/snapshot' && window.blockSnapshots) throw new Error('Snapshot unavailable');
      if (url === '/api/requests' && lose) { lose = false; window.blockSnapshots = true; await original(url, options); throw new Error('Acknowledgement lost'); }
      return original(url, options);
    };
  })()`);
  await clickBrowser(browser, "#message");
  await browser.call("Input.insertText", { text: "Keep this exact request." });
  assert.equal(await browser.evaluate("document.querySelector('#message').value"), "Keep this exact request.");
  await clickBrowser(browser, "#send");
  await browser.waitFor("document.querySelector('#send').textContent === 'Retry exact request'");
  assert.equal(f.received.length, 1);
  assert.equal(await browser.evaluate("document.querySelector('#message').disabled"), true);
  await browser.evaluate("window.blockSnapshots = false");
  await clickBrowser(browser, "#send");
  await browser.waitFor("document.querySelector('#message').value === ''");
  assert.equal(f.received.length, 2);
  assert.deepEqual(f.received[1], f.received[0]);
  assert.equal(f.state.requests.filter(({ id }) => id === f.received[0].id).length, 1);
});

test("composer is locked during bounded admission so user typing cannot be cleared by an unrelated success", { skip: !browserAvailable, timeout: 60_000 }, async (t) => {
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  const f = await fixture(t, { onSend: async () => { entered.resolve(); await release.promise; } });
  const browser = await f.openBrowser();
  await browser.call("Emulation.setDeviceMetricsOverride", { width: 1500, height: 1100, deviceScaleFactor: 1, mobile: false });
  try {
    await browser.call("Page.navigate", { url: f.provider.url });
    await browser.waitFor("!document.querySelector('#send').disabled");
    await clickBrowser(browser, "#message");
    await browser.call("Input.insertText", { text: "The submitted draft." });
    assert.equal(await browser.evaluate("document.querySelector('#message').value"), "The submitted draft.");
    await clickBrowser(browser, "#send"); await entered.promise;
    assert.equal(await browser.evaluate("document.querySelector('#message').disabled"), true);
    await browser.call("Input.insertText", { text: "Not admitted as a new draft" });
    assert.equal(await browser.evaluate("document.querySelector('#message').value"), "The submitted draft.");
    release.resolve();
    await browser.waitFor("document.querySelector('#message').value === '' && !document.querySelector('#message').disabled");
    assert.equal(f.received[0].message, "The submitted draft.");
  } finally { release.resolve(); }
});

test("actual browser entrypoint renders dynamic shared artifacts, answers and ordinary composer with no approval/Apply controls", { skip: !browserAvailable, timeout: 60_000 }, async (t) => {
  const f = await fixture(t);
  const browser = await f.openBrowser();
  await browser.call("Emulation.setDeviceMetricsOverride", { width: 1500, height: 1100, deviceScaleFactor: 1, mobile: false });
  await browser.call("Page.navigate", { url: f.provider.url });
  await browser.waitFor("document.querySelector('#current-state-title').textContent === 'Waiting for your answers'");
  const controls = await browser.evaluate("({notice:document.querySelector('#notice').textContent, inputs:[...document.querySelectorAll('.human-loop-questions input,.human-loop-questions select,.human-loop-questions button')].map(n=>({tag:n.tagName,type:n.type,text:n.textContent}))})");
  assert.ok(await browser.evaluate("!document.querySelector('#send').disabled"), JSON.stringify(controls));
  assert.ok(await browser.evaluate("Boolean(document.querySelector('.human-loop-questions select'))"), JSON.stringify(controls));
  assert.equal(browser.exceptions.length, 0, JSON.stringify(browser.exceptions));
  const labels = await browser.evaluate("[...document.querySelectorAll('button')].map(b=>b.textContent).filter(x=>/Approve plan|Apply changes|Approve version/.test(x))");
  assert.deepEqual(labels, []);
  const click = async (selector) => {
    const point = await browser.evaluate(`(() => { const n=document.querySelector(${JSON.stringify(selector)}); n.scrollIntoView({block:'center'}); const r=n.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
    await browser.call("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
    await browser.call("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
  };
  await click(".human-loop-questions select");
  await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 });
  await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 });
  await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  const submitSelector = await browser.evaluate("(() => { const b=[...document.querySelectorAll('.human-loop-questions button')].find(b=>/send.*answer|submit.*answer/i.test(b.textContent)); if(!b) throw new Error('No answer submission control'); b.id='answer-submit-test'; return '#answer-submit-test'; })()");
  await click(submitSelector);
  await browser.waitFor("document.querySelectorAll('#messages [data-kind=user]').length >= 2");
  assert.equal(f.received[0].answers.schemaVersion, "human-question-answers/v1");
  assert.match(await browser.evaluate("document.querySelector('.question-answer-record').textContent"), /Choose the current direction/);
  await click("#message"); await browser.call("Input.insertText", { text: "This is ordinary discussion, not a question answer." });
  await click("#send");
  await browser.waitFor("document.querySelector('#message').value === ''");
  assert.equal(f.received.at(-1).answers, null);
  for (const artifact of sharedDesignExample().artifacts) {
    await click(`[data-artifact-tab="${artifact.id}"]`);
    assert.equal(await browser.evaluate("document.querySelector('[data-sketch-id]').dataset.sketchId"), artifact.id);
  }
  assert.equal(browser.exceptions.length, 0, JSON.stringify(browser.exceptions));
  assert.ok(await browser.evaluate("document.querySelector('.shared-sketch svg').children.length > 0"));
});

test("artifact PNG stays bound to its producing Design and artifact when selection changes before explicit Send", { skip: !browserAvailable, timeout: 60_000 }, async (t) => {
  const f = await fixture(t), browser = await f.openBrowser();
  await browser.call("Emulation.setDeviceMetricsOverride", { width: 1500, height: 1100, deviceScaleFactor: 1, mobile: false });
  await browser.call("Page.navigate", { url: f.provider.url });
  await browser.waitFor("document.querySelector('[data-annotate-artifact=\"interaction\"]')");
  await clickBrowser(browser, '[data-annotate-artifact="interaction"]');
  await browser.waitFor("document.querySelector('.annotation-editor').open && !document.querySelector('[data-annotation-action=attach]').disabled");
  await clickBrowser(browser, "[data-annotation-action=attach]");
  await browser.waitFor("!document.querySelector('#annotation-preview').hidden");
  assert.equal(f.received.length, 0);
  await clickBrowser(browser, '[data-artifact-tab="architecture-example"]');
  await clickBrowser(browser, "#message");
  await browser.call("Input.insertText", { text: "Explain this marked interaction without editing." });
  await clickBrowser(browser, "#send");
  await browser.waitFor("document.querySelector('#message').value === ''");
  assert.equal(f.received.length, 1);
  const ref = f.received[0].attachments[0];
  assert.equal(ref.source.schemaVersion, "artifact-annotation/v1");
  assert.equal(ref.source.artifactId, "interaction");
  assert.equal(ref.source.designDigest, f.state.design.digest);
  assert.equal(ref.source.revisionId, f.state.design.revisionId);
  const saved = await new AnnotationAttachmentStore(f.root).get(ref.id);
  const upload = (source) => fetch(new URL("/api/annotation-attachments", f.provider.url), {
    method: "POST", headers: { "content-type": "image/png", "x-annotation-source": encodeURIComponent(JSON.stringify(source)) },
    body: saved.bytes,
  });
  for (const source of [
    { ...ref.source, artifactId: "missing" },
    { ...ref.source, designDigest: "b".repeat(64) },
    { revisionId: ref.source.revisionId, perspective: "use-case", selectionId: null, viewport: ref.source.viewport },
  ]) {
    const response = await upload(source);
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /artifact|revision|reference/i);
  }
  assert.equal(f.received.length, 1);
  assert.deepEqual((await new AnnotationAttachmentStore(f.root).get(ref.id)).bytes, saved.bytes);
  assert.deepEqual(browser.exceptions, []);
});
