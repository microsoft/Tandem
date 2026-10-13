import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { build } from "esbuild";
import { runInNewContext } from "node:vm";
import { state as discoveryState } from "./helpers/react-harness.ts";
import { progressivePrototype, readyPrototype, sketchFixture } from "./renderer-fixtures.test.ts";
import { createHumanLoopProvider, HumanLoopEvents } from "../stage2/tandem/src/human-loop-provider.mjs";
import { createHumanLoopLedger, replayHumanLoopLedger } from "../stage2/tandem/runtime-src/domain/human-loop/ledger.ts";
import { DEFAULT_POLICY } from "../stage2/tandem/runtime-src/domain/workflow/policy.ts";
import { getHostStateWal } from "../stage2/tandem/runtime-src/domain/host-state-wal.ts";
import { browserAvailable, openFixtureBrowser } from "../stage2/tandem/test/helpers/browser-fixture.mjs";
import { JSDOM } from "jsdom";
import { installProjectPresentation } from "../stage2/tandem/public/project-presentation.js";
import { createConversationRenderer } from "../stage2/tandem/public/renderers/conversation.js";
import { sharedDesignExampleV3 } from "../stage2/tandem/test/helpers/shared-design-fixture.mjs";
import { exerciseRoleHintDraft } from "../stage2/tandem/test/helpers/role-hint-browser.mjs";

test("saved evidence updates without rewriting immutable native conversation", t => {
  const dom = new JSDOM('<div><div id="history"></div></div><div id="messages"></div><div id="current"></div><div id="detail"></div><button id="newer"></button>', { pretendToBeVisual: true });
  t.after(() => dom.window.close());
  dom.window.ResizeObserver = class { observe() {} disconnect() {} };
  const get = id => dom.window.document.getElementById(id);
  const renderer = createConversationRenderer({ messages: get("messages"), history: get("history"),
    current: get("current"), currentDetail: get("detail"), newer: get("newer") });
  const evidence = { id: "discovery:g:checkpoint", kind: "status", text: "Interaction: running.",
    timestamp: "2026-10-10T00:00:00.000Z", savedEvidenceProjection: true };
  const native = { id: "native-message", kind: "assistant", text: "Original native answer.", timestamp: evidence.timestamp };
  renderer.render([evidence, native], []);
  renderer.render([{ ...evidence, text: "Interaction: ready.", timestamp: "2026-10-10T00:01:00.000Z" },
    { ...native, text: "Must not replace the original." }], []);
  assert.match(get("messages").textContent, /Interaction: ready/);
  assert.doesNotMatch(get("messages").textContent, /Interaction: running|Must not replace/);
  assert.match(get("messages").textContent, /Original native answer/);
});

test("presentation binding preserves drafts, exact pending receipts and standalone behavior", async t => {
  const dom = new JSDOM('<body data-project-panel="workspace" data-project-origin="http://127.0.0.1:4000" data-project-channel="binding"><form id="composer"><textarea id="message"></textarea></form>');
  t.after(() => dom.window.close());
  const sent = [], parent = { postMessage: (data, origin) => sent.push({ data, origin }) };
  Object.defineProperty(dom.window, "parent", { value: parent });
  const api = installProjectPresentation({ document: dom.window.document, window: dom.window,
    changed() {}, settings() {}, currentWork() {} });
  const receive = (data, source = parent, origin = "http://127.0.0.1:4000") =>
    dom.window.dispatchEvent(new dom.window.MessageEvent("message", {
      source, origin, data: { protocol: "tandem-project/v1", channel: "binding", ...data },
    }));
  const context = { type: "context", entries: [], discovery: { key: "generation:usage", label: "Usage", help: "Add a usage", enabled: true } };
  receive(context, null); assert.equal(api.canSend(), false);
  receive(context, parent, "http://127.0.0.1:5000"); assert.equal(api.canSend(), false);
  receive({ ...context, channel: "foreign" }); assert.equal(api.canSend(), false);
  receive(context); assert.equal(api.canSend(), true);
  dom.window.document.querySelector("#message").value = "Preserve my discovery draft.";
  receive({ type: "command", command: "development-target" });
  assert.equal(api.discovery(), true, "Activation cannot silently retarget an existing draft.");
  receive({ ...context, designVisible: true });
  assert.equal(dom.window.document.querySelector("#message").value, "Preserve my discovery draft.");
  assert.equal(api.discovery(), true);
  assert.equal(dom.window.document.querySelector("#project-message-target"), null);
  assert.equal(api.canSend(), false, "A retained draft cannot silently change working context.");
  receive(context);
  const work = api.submit("Exact usage");
  const envelope = sent.find(item => item.data.type === "discovery-send").data;
  assert.equal(api.canSend(), false);
  dom.window.document.querySelector("#composer button:last-child").click();
  assert.equal(sent.at(-1).data.type, "discovery-status");
  assert.equal(sent.at(-1).data.id, envelope.id);
  assert.equal(sent.filter(item => item.data.type === "discovery-send").length, 1);
  receive({ type: "discovery-result", id: "different", ok: true }); assert.equal(api.canSend(), false);
  receive({ type: "discovery-result", id: envelope.id, ok: true }); await work;
  assert.equal(api.canSend(), true);
  dom.window.document.body.removeAttribute("data-project-panel");
  const count = sent.length;
  assert.equal(installProjectPresentation({ document: dom.window.document, window: dom.window }), null);
  assert.equal(sent.length, count);
});

test("attachment-only drafts and pending native submissions cannot be silently moved to a discovery phase", t => {
  const dom = new JSDOM('<body data-project-panel="workspace" data-project-origin="http://127.0.0.1:4000" data-project-channel="attachments"><form id="composer"><textarea id="message"></textarea></form>');
  t.after(() => dom.window.close());
  const sent = [], parent = { postMessage: data => sent.push(data) };
  let attachments = 0;
  Object.defineProperty(dom.window, "parent", { value: parent });
  const api = installProjectPresentation({ document: dom.window.document, window: dom.window, changed() {}, hasAttachments: () => attachments > 0 });
  const receive = data => dom.window.dispatchEvent(new dom.window.MessageEvent("message", { source: parent, origin: "http://127.0.0.1:4000",
    data: { protocol: "tandem-project/v1", channel: "attachments", ...data } }));
  const context = { type: "context", entries: [], designVisible: true, developmentEntered: true, developmentEnabled: true,
    discovery: { key: "prototype", label: "Prototype", action: "prototype", help: "Use the original Prototype feedback form.", enabled: true } };
  receive(context);
  attachments = 1; api.nativePending(false);
  receive({ ...context, designVisible: false, developmentEntered: false, viewedStage: "prototype", viewLabel: "Prototype" });
  assert.equal(api.discovery(), false);
  assert.equal(api.canSend(), false);
  assert.equal(dom.window.document.querySelector("#use-draft-here").hidden, true);
  assert.equal(attachments, 1, "Changing context cannot remove the attachment.");
  dom.window.document.querySelector("#message").value = "Retain this exact native draft.";
  attachments = 0; api.nativePending(true);
  const move = dom.window.document.querySelector("#use-draft-here");
  assert.equal(move.disabled, true);
  move.click();
  assert.equal(api.discovery(), false);
  api.nativePending(false);
  assert.equal(api.discovery(), false, "A resolved submission does not implicitly move the remaining draft.");
  move.click();
  assert.equal(api.discovery(), true, "Only the explicit one-time draft action changes its context.");
  assert.equal(dom.window.document.querySelector("#message").value, "Retain this exact native draft.");
  assert.equal(dom.window.document.querySelector("#project-message-target"), null);
  assert.equal(sent.some(item => ["activate", "discovery-send"].includes(item.type)), false);
});

test("embedded Settings exposes one shared effort choice with busy, unsupported and partial-error readback", t => {
  const dom = new JSDOM(`<body data-project-panel="workspace" data-project-origin="http://127.0.0.1:4000" data-project-channel="effort">
    <form id="composer"><textarea id="message"></textarea></form><label id="private-effort-setting"></label>
    <section id="project-effort-settings" hidden><select id="project-effort"></select><button id="apply-project-effort"></button>
    <button id="refresh-project-effort"></button><div id="project-effort-status"></div><p id="project-effort-error"></p></section>`);
  t.after(() => dom.window.close());
  const sent = [], parent = { postMessage: message => sent.push(message) };
  Object.defineProperty(dom.window, "parent", { value: parent });
  installProjectPresentation({ document: dom.window.document, window: dom.window, changed() {}, settings() {}, currentWork() {} });
  const get = id => dom.window.document.getElementById(id);
  const receive = data => dom.window.dispatchEvent(new dom.window.MessageEvent("message", { source: parent, origin: "http://127.0.0.1:4000",
    data: { protocol: "tandem-project/v1", channel: "effort", ...data } }));
  const context = { type: "context", entries: [], discovery: { key: "none", label: "Discovery", help: "Use controls", enabled: false }, canChangeEffort: true };
  receive(context); receive({ type: "command", command: "settings" });
  assert.equal(sent.at(-1).type, "project-effort-read");
  assert.equal(get("apply-project-effort").disabled, true);
  const stage = { desired: "low", actual: "low", model: "one", supported: ["low", "high"], status: "applied", error: null };
  receive({ type: "project-effort-result", id: sent.at(-1).id,
    settings: { desired: "low", stage1: stage, stage2: { ...stage, actual: null, model: null, status: "pending" } } });
  assert.equal(get("private-effort-setting").hidden, true);
  assert.equal(get("project-effort").value, "low");
  get("apply-project-effort").click();
  assert.equal(sent.at(-1).type, "project-effort-apply");
  assert.equal(sent.at(-1).effort, "low");
  assert.equal(get("project-effort").disabled, true);
  receive({ type: "project-effort-result", id: sent.at(-1).id, error: "Private model does not support low.",
    settings: { desired: "low", stage1: stage, stage2: { ...stage, actual: null, supported: ["high"], status: "error", error: "Unsupported effort" } } });
  assert.match(get("project-effort-status").textContent, /Stage 1: applied.*Stage 2: error.*Unsupported effort/);
  assert.match(get("project-effort-error").textContent, /does not support low/);
  assert.deepEqual([...get("project-effort").options].map(option => option.value), ["", "high"]);
  receive({ ...context, canChangeEffort: false });
  assert.equal(get("project-effort").disabled, true);
  assert.equal(get("apply-project-effort").disabled, true);
  assert.equal(sent.some(message => message.type === "activate"), false);
});

test("whole project workspace uses one actual embedded renderer for navigation, drafting, activation and recovery",
  { skip: !browserAvailable, timeout: 90_000 }, async t => {
    const root = await mkdtemp(join(tmpdir(), "tandem-project-ui-"));
    const events = new HumanLoopEvents(), mutations = [], nativeRequests = [];
    let accessRequests = [];
    const owner = { schemaVersion: "human-loop-owner/v1", id: "owner", mainSessionId: "main", privateSessionId: "private",
      workspacePath: root, policy: DEFAULT_POLICY };
    const designBinding = { revisionId: "fixture-design", digest: "a".repeat(64) };
    let nativeState = replayHumanLoopLedger(createHumanLoopLedger(owner, designBinding)).state;
    nativeState.requests.push({ id: "fixture-origin", message: "Previously saved work", receivedAt: "2026-10-10T08:00:00Z", status: "completed", stopId: null,
      blockingAnswerRefs: [], questionGatesReleased: true });
    nativeState.cycles.push({ id: "fixture-cycle", originRequestId: "fixture-origin", design: designBinding, phase: "completed",
      plan: { id: "fixture-plan", version: 2, digest: "b".repeat(64), design: designBinding, goal: "Original saved plan", tasks: [] },
      tasks: [], current: { id: "fixture-snapshot" },
      implementationResult: { resultId: "fixture-implementation", outcome: { kind: "implementation-result", summary: "Original reported implementation", evidenceRefs: ["fixture-test-receipt"] } } });
    let active = false, stopped = false, installationStatus = "new";
    let startingPath = null;
    const value = discoveryState("requirements");
    const drawings = sketchFixture();
    value.requirements.substage = "usage";
    let previewAvailable = true, holdPreviewChecks = false, previewChecks = 0;
    const heldPreviewChecks = [];
    const runtime = {
      sessionId: "private", state: async () => nativeState,
      transport: { attachmentCapabilities: async () => ({ supported: true, limits: { maxBytes: 4 * 1024 * 1024, maxImages: 1 } }) },
      readiness: async () => ({ status: stopped ? "closed" : nativeState.activeRequestId ? "working" : "ready",
        workspacePath: root, reason: stopped ? "Closed; saved history retained. Reopen explicitly." : null }),
      conversation: async () => [{ id: "handoff:fixture-review", kind: "assistant", role: "reviewer", requestId: "fixture-origin",
        content: "Original saved Review record.", timestamp: "2026-10-10T08:01:00Z" },
        ...nativeRequests.filter(request => request.roleHint).map(request => ({
          id: `actual:${request.id}`, kind: "assistant", role: "agent", requestId: request.id,
          content: "Read-only Agent response; deterministic fixture, not a model.",
          timestamp: new Date(Date.parse(request.receivedAt) + 1).toISOString(),
        }))],
      currentDesign: async () => ({ binding: designBinding, content: sharedDesignExampleV3() }),
      commands: { read: async () => ({ apps: [], commands: [] }) },
      modelSettings: async () => ({ models: [{ id: "fixture", name: "Fixture", supportedReasoningEfforts: ["low"] }],
        actual: "fixture", actualReasoningEffort: "low", desired: "fixture", canChange: true,
        canSetReasoningEffort: true, effortManaged: true, projectReasoningEffort: "low" }),
      async send(request) {
        nativeRequests.push(request);
        nativeState.requests.push({ ...request, status: "active", queueAdmitted: true, blockingAnswerRefs: [] });
        nativeState.activeRequestId = request.id; events.touch();
        if (request.answers) for (const question of nativeState.questions) {
          question.state = "answered"; question.answerRequestId = request.id; question.blockingActive = false;
        }
      },
      async stop(id, options) {
        mutations.push({ path: "native-stop", id, options });
        nativeState.activeRequestId = null;
        nativeState.requests.forEach(request => {
          if (request.status === "waiting") request.status = "discarded";
          else if (request.status === "active") request.status = "stopped";
        });
        events.touch();
      },
      async decideImplementation(input) {
        mutations.push({ path: "native-confirmation", ...input });
        nativeState.implementationConfirmations.find(item => item.id === input.confirmationId).status = input.decision;
        nativeState.activeRequestId = null; events.touch(); return {};
      },
    };
    let provider;
    let css, client;
    if (process.env.TANDEM_PACKAGED_EXTENSION) {
      const packaged = await readFile(process.env.TANDEM_PACKAGED_EXTENSION, "utf8");
      const start = packaged.indexOf("// tandem-styles:styles.css\n");
      assert.ok(start >= 0, "Locate the production stylesheet module, without executing extension startup.");
      const end = packaged.indexOf("\n// ", start + 3);
      assert.ok(end > start);
      const stylesheetModule = packaged.slice(start, end);
      assert.match(stylesheetModule, /^\/\/ tandem-styles:styles.css\nvar styles_default = /);
      css = runInNewContext(`${stylesheetModule}\nstyles_default`, {}, { timeout: 1000 });
      const clientStart = packaged.indexOf("// tandem-client:main.tsx\n");
      assert.ok(clientStart >= 0, "Locate the actual production renderer without running extension startup.");
      const clientEnd = packaged.indexOf("\n// ", clientStart + 3);
      assert.ok(clientEnd > clientStart);
      const clientModule = packaged.slice(clientStart, clientEnd);
      assert.match(clientModule, /^\/\/ tandem-client:main.tsx\nvar main_default = /);
      client = runInNewContext(`${clientModule}\nmain_default`, {}, { timeout: 1000 });
      assert.equal(typeof client, "string");
      assert.equal(typeof css, "string");
      assert.doesNotMatch(css, /@import\b/, "The packaged inline stylesheet must contain its imports, not request source-tree URLs.");
      t.diagnostic(`Production renderer and stylesheet from ${process.env.TANDEM_PACKAGED_EXTENSION}; fixture APIs/checkpoints, no native work.`);
    } else css = (await build({ entryPoints: [resolve("src", "renderer", "styles.css")],
      bundle: true, write: false, logLevel: "silent" })).outputFiles[0].text;
    const template = (await readFile(new URL("../src/renderer/index.html", import.meta.url), "utf8"))
      .replace("__TANDEM_STYLES__", () => css).replace("__TANDEM_VERSION__", "unified-fixture")
      .replace("<script>__TANDEM_CLIENT__</script>", '<script type="module" src="/app.js"></script>');
    if (!client) client = (await build({ entryPoints: [resolve("src", "renderer", "main.tsx")],
      bundle: true, write: false, format: "esm", platform: "browser", target: "es2022", logLevel: "silent",
      loader: { ".png": "dataurl" },
      define: { "process.env.NODE_ENV": '"production"' } })).outputFiles[0].text;
    const rootEvents = new Set();
    const server = createServer(async (request, response) => {
      const path = new URL(request.url, "http://127.0.0.1").pathname;
      const json = data => { response.writeHead(200, { "Content-Type": "application/json" }); response.end(JSON.stringify(data)); };
      try {
        if (path === "/") { response.writeHead(200, { "Content-Type": "text/html" }); response.end(template); }
        else if (path === "/styles.css") { response.writeHead(200, { "Content-Type": "text/css" }); response.end(css); }
        else if (path === "/app.js") { response.writeHead(200, { "Content-Type": "text/javascript" }); response.end(client); }
        else if (path === "/preview-current" || path === "/preview-candidate") {
          response.writeHead(200, { "Content-Type": "text/html" });
          response.end(`<!doctype html><html><body><button id="preview-button" onclick="this.textContent='Preview interaction accepted'">${path === "/preview-current" ? "Current" : "Candidate"} prototype</button></body></html>`);
        }
        else if (["/api/state", "/api/preparation/status", "/api/workflow/status"].includes(path)) json(value);
        else if (path === "/events") {
          response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
          rootEvents.add(response);
          response.write(`data: ${JSON.stringify(value)}\n\n`);
          request.on("close", () => rootEvents.delete(response));
        }
        else if (path === "/api/sketch") json({ sketch: value.sketch, document: value.sketch.current ? drawings.document : null });
        else if (path === "/api/prototype/preview-status") {
          const pendingTarget = new URL(request.url, url).searchParams.get("target") === "pending";
          if (!pendingTarget) previewChecks++;
          const checkpoint = value.prototypeFlow?.checkpoints.find(item => item.id === (pendingTarget ? value.prototypeFlow.pendingCheckpointId : value.prototypeFlow.displayedCheckpointId));
          const binding = { generation: value.generation, checkpointId: checkpoint?.id ?? null,
            pendingCheckpointId: value.prototypeFlow?.pendingCheckpointId ?? null, url: checkpoint?.previewUrl || value.previewUrl };
          const reply = available => json({ ...binding, available, reason: available ? "" : "The saved preview is not reachable." });
          if (holdPreviewChecks && !pendingTarget) heldPreviewChecks.push(reply);
          else reply(previewAvailable);
        }
        else if (path === "/api/project-entry") {
          if (request.method === "POST") {
            const chunks = []; for await (const chunk of request) chunks.push(chunk);
            const body = JSON.parse(Buffer.concat(chunks).toString());
            assert.ok(!startingPath || startingPath === body.startingPath);
            startingPath = body.startingPath;
          }
          json({ projectPath: root, startingPath });
        }
        else if (path === "/api/project-entry/open") json({ developmentContext: false, developmentStarted: false });
        else if (path === "/api/development/view") json({ url: provider.url, channel: "whole-project-fixture" });
        else if (path === "/api/settings/project-effort") json({ desired: "low", changing: false,
          stage1: { actual: "low", desired: "low", model: "fixture", status: "applied", supported: ["low"], error: null },
          stage2: { actual: null, desired: "low", model: null, status: "pending", supported: [], error: null } });
        else if (request.method === "POST") {
          const chunks = []; for await (const chunk of request) chunks.push(chunk);
          const body = JSON.parse(Buffer.concat(chunks).toString() || "{}"); mutations.push({ path, body });
          if (path === "/api/development/open") {
            const first = mutations.filter(item => item.path === "/api/development/open").length === 1;
            active = !first; stopped = false; installationStatus = first ? "starting" : "ready";
            events.touch(); json({ url: provider.url });
          }
          else if (path === "/api/answer") { value.requirements.usageItems.push(body.answer); value.revision++; json(value); }
          else if (path === "/api/prototype/action") {
            assert.deepEqual(body, { action: "apply-update", checkpointId: "interaction", expectedRevision: value.revision });
            value.prototypeFlow.displayedCheckpointId = body.checkpointId;
            value.prototypeFlow.pendingCheckpointId = null;
            value.previewUrl = value.prototypeFlow.checkpoints.find(item => item.id === body.checkpointId).previewUrl;
            value.revision++; json(value);
          }
          else { response.writeHead(404); response.end(); }
        } else { response.writeHead(404); response.end(); }
      } catch (error) { response.writeHead(500); response.end(JSON.stringify({ error: error.message })); }
    });
    await new Promise(done => server.listen(0, "127.0.0.1", done));
    const url = `http://127.0.0.1:${server.address().port}/`;
    provider = await createHumanLoopProvider({ repositoryRoot: root, publicDirectory: process.env.TANDEM_PACKAGED_EXTENSION
      ? join(dirname(process.env.TANDEM_PACKAGED_EXTENSION), "stage2", "public") : resolve("stage2", "tandem", "public"),
      surface: "browser", projectHost: { origin: new URL(url).origin, channel: "whole-project-fixture" }, events,
      getInstallation: () => ({ runtime: active ? runtime : null,
        close: async () => { stopped = true; installationStatus = "closed"; events.touch(); return {}; },
        read: async () => ({ status: installationStatus,
        canStart: !active, canRetry: installationStatus === "prepared", canReopen: stopped,
        reason: installationStatus === "prepared" ? "Owned startup failed; retry is available." : stopped ? "Closed; saved history retained." : null }) }),
      permissions: { list: () => accessRequests, async decide(id, decision, sessionId) {
        mutations.push({ path: "native-consent", id, decision, sessionId });
        accessRequests = accessRequests.filter(item => item.id !== id); events.touch();
      } },
      close: async () => { stopped = true; installationStatus = "closed"; events.touch(); return {}; } });
    const cleanups = [];
    try {
      const browser = await openFixtureBrowser({ after: cleanup => cleanups.push(cleanup) });
      t.diagnostic(`Actual integrated root ${url}; ${(await browser.call("Browser.getVersion")).product}; synthetic runtime, no model calls.`);
      await browser.call("Emulation.setDeviceMetricsOverride", { width: 1360, height: 1000, deviceScaleFactor: 1, mobile: false });
      await browser.call("Page.navigate", { url });
      const reloadRoot = async () => {
        const previous = await browser.evaluate("performance.timeOrigin");
        await browser.call("Page.reload");
        for (let attempt = 0; attempt < 150; attempt++) {
          try {
            if (await browser.evaluate(`performance.timeOrigin !== ${previous} && document.readyState === "complete"`)) return;
          } catch (error) {
            if (!/Inspected target navigated|Cannot find context|Execution context was destroyed/.test(String(error))) throw error;
          }
          await new Promise(done => setTimeout(done, 30));
        }
        assert.fail("Root reload did not reach a new, loaded document.");
      };
      const clickRoot = async selector => {
        const point = await browser.evaluate(`(() => {const e=document.querySelector(${JSON.stringify(selector)});
          e.scrollIntoView({block:"nearest"});const r=e.getBoundingClientRect();
          const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
          return {x:r.x+r.width/2,y:r.y+r.height/2,ok:!e.disabled&&r.width>0&&(hit===e||e.contains(hit))};})()`);
        assert.ok(point.ok, `Root control reachable: ${selector}`);
        for (const type of ["mousePressed", "mouseReleased"]) await browser.call("Input.dispatchMouseEvent", { type, x: point.x, y: point.y, button: "left", clickCount: 1 });
      };
      await browser.waitFor('Boolean(document.querySelector("#entry-preparation"))');
      assert.equal(await browser.evaluate('document.querySelector("#project-conversation-frame")===null'), true);
      await clickRoot("#entry-preparation");
      await browser.waitFor('!document.querySelector("#entry-preparation")');
      await clickRoot("#design-tree-tab");
      await clickRoot("#usage-input"); await browser.call("Input.insertText", { text: "As a user, I retain the original Requirements input." });
      await clickRoot("#add-usage");
      await browser.waitFor('document.querySelector("#usage-input").value===""');
      assert.equal(mutations.at(-1).path, "/api/answer");
      assert.equal(active, false);
      assert.equal(await browser.evaluate('document.querySelector("#project-conversation-frame")===null'), true);
      await clickRoot("#project-settings");
      await browser.waitFor('Boolean(document.querySelector("#project-effort option[value=low]"))');
      await clickRoot(".root-effort-actions button");
      await browser.waitFor('!document.querySelector(".root-effort-actions button").disabled');
      assert.equal(active, false, "Stage1 Settings never starts Development.");
      await clickRoot('[role="alertdialog"] button');
      await browser.waitFor('document.activeElement.id==="project-settings"');
      for (const phase of ["sketch", "prototype"]) {
        value.lifecycle.currentStage = phase;
        value.lifecycle.completedStages = phase === "sketch" ? ["prepare", "requirements"] : ["prepare", "requirements", "sketch"];
        if (phase === "sketch") {
          value.sketch = structuredClone(drawings.value.sketch);
          value.sketch.status = "approved";
          value.sketch.approved = { revisionId: value.sketch.current.id, documentHash: value.sketch.current.documentHash,
            requirementsDigest: value.sketch.current.requirementsDigest, approvedAt: value.updatedAt, assets: [] };
        }
        value.revision++;
        await reloadRoot();
        await browser.waitFor('document.querySelector("#studio-workspace") && !document.querySelector("#studio-workspace").inert');
        await browser.waitFor(`document.querySelector(${JSON.stringify(phase === "sketch" ? "#sketch-tab" : "#live-preview-tab")})?.getAttribute("aria-selected")==="true"`);
        const geometry = await browser.evaluate(`(() => {
          const panel=document.querySelector(${JSON.stringify(phase === "sketch" ? "#sketch-panel" : "#live-preview-panel")});
          const toolbar=panel.querySelector(".phase-actions").getBoundingClientRect();
          const body=panel.querySelector(${JSON.stringify(phase === "sketch" ? ".sketch-stage" : ".preview-surface")}).getBoundingClientRect();
          return {toolbarHeight:toolbar.height,toolbarBottom:toolbar.bottom,bodyTop:body.top,bodyWidth:body.width,panelWidth:panel.clientWidth};
        })()`);
        assert.ok(geometry.toolbarHeight < 100 && geometry.bodyTop >= geometry.toolbarBottom - 1,
          `${phase} actions occupy a compact top row: ${JSON.stringify(geometry)}`);
        assert.ok(geometry.bodyWidth >= geometry.panelWidth - 30, `${phase} retains its original full-width view: ${JSON.stringify(geometry)}`);
        assert.equal(active, false);
        if (phase === "sketch") {
          await browser.waitFor('!document.querySelector("#complete-stage").disabled');
          assert.equal(await browser.evaluate('document.querySelector("#sketch-approve").hidden'), true,
            "A clean approved drawing revision offers Finish, not another primary approval.");
          const beforeHistory = await browser.evaluate('({artifact:document.querySelector("#preview-pane").clientWidth,history:document.querySelector("#project-conversation").clientWidth})');
          assert.ok(beforeHistory.artifact > beforeHistory.history);
          await clickRoot("#toggle-discovery-history");
          await browser.waitFor('document.querySelector("#studio-workspace").dataset.historyCollapsed==="true"');
          assert.ok(await browser.evaluate('document.querySelector("#project-conversation").clientWidth <= 44'));
          assert.ok(await browser.evaluate(`document.querySelector("#preview-pane").clientWidth >= ${beforeHistory.artifact + 200}`));
          assert.equal(await browser.evaluate('document.activeElement.id'), "toggle-discovery-history");
          await clickRoot("#toggle-discovery-history");
          await browser.waitFor('document.querySelector("#studio-workspace").dataset.historyCollapsed==="false"');
          assert.equal(await browser.evaluate('document.querySelector("#project-conversation").clientWidth'), beforeHistory.history);
          for (const theme of ["light", "dark"]) {
            await browser.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
            const primary = await browser.evaluate('(() => {const b=document.querySelector("#complete-stage"),s=getComputedStyle(b),r=b.getBoundingClientRect();return {background:s.backgroundColor,color:s.color,hit:b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};})()');
            const luminance = color => color.match(/[\d.]+/g).slice(0, 3).map(Number).map(c => c / 255)
              .map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((sum, c, index) => sum + c * [.2126, .7152, .0722][index], 0);
            const [bright, dark] = [luminance(primary.background), luminance(primary.color)].sort((a, b) => b - a);
            assert.ok((bright + .05) / (dark + .05) >= 4.5, `${theme} primary phase contrast: ${JSON.stringify(primary)}`);
            assert.equal(primary.hit, true);
          }
          await browser.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
        }
      }
      assert.equal(await browser.evaluate('document.querySelector("#preview-frame").hidden && document.querySelector("#preview-frame").getBoundingClientRect().height === 0'), true,
        "Absent previews have no visible frame.");
      const pushPrototype = async prototype => {
        Object.assign(value, { phase: "building", previewStatus: prototype.previewStatus, previewUrl: prototype.previewUrl,
          prototypeFlow: prototype.prototypeFlow, processing: null });
        value.revision++;
        for (const response of rootEvents) response.write(`data: ${JSON.stringify(value)}\n\n`);
        await browser.waitFor(`document.querySelector("#preview-frame").dataset.checkpointId === ${JSON.stringify(prototype.prototypeFlow.displayedCheckpointId || "")}
          && document.querySelector("#apply-prototype-update").hidden === ${!prototype.prototypeFlow.pendingCheckpointId}
          && document.querySelector("#prototype-building").hidden === ${!prototype.prototypeFlow.activeCheckpointId}`);
      };
      const loading = progressivePrototype();
      loading.previewUrl = null; loading.previewStatus = "starting";
      loading.prototypeFlow.displayedCheckpointId = null;
      loading.prototypeFlow.activeCheckpointId = "structure";
      loading.prototypeFlow.checkpoints = [{ ...loading.prototypeFlow.checkpoints[0], status: "running", previewUrl: null }];
      await pushPrototype(loading);
      assert.equal(await browser.evaluate('document.querySelector("#preview-frame").hidden && document.querySelector("#preview-frame").getBoundingClientRect().height === 0'), true,
        "A loading first checkpoint cannot expose an empty inline browser.");
      const currentPrototype = progressivePrototype();
      for (const checkpoint of currentPrototype.prototypeFlow.checkpoints) checkpoint.requestedAt = new Date().toISOString();
      currentPrototype.previewUrl = currentPrototype.prototypeFlow.checkpoints[0].previewUrl = new URL("preview-current", url).href;
      const restoredPrototype = readyPrototype(1, true);
      restoredPrototype.previewUrl = restoredPrototype.prototypeFlow.checkpoints[0].previewUrl = currentPrototype.previewUrl;
      restoredPrototype.prototypeFlow.checkpoints[1].previewUrl = new URL("preview-candidate", url).href;
      previewAvailable = false;
      const mutationsBeforeAvailability = mutations.length;
      await pushPrototype(restoredPrototype);
      await browser.waitFor('document.querySelector("#preview-availability").textContent.includes("Current preview unavailable")');
      assert.equal(await browser.evaluate('document.querySelector("#preview-frame").hidden && !document.querySelector("#preview-frame").getAttribute("src")'), true);
      assert.equal(await browser.evaluate('document.querySelector("#open-preview") === null'), true);
      assert.equal(value.prototypeFlow.pendingCheckpointId, "interaction");
      assert.equal(value.prototypeFlow.displayedCheckpointId, "structure");
      if (process.env.TANDEM_UI_EVIDENCE) await writeFile(join(process.env.TANDEM_UI_EVIDENCE, "unavailable-current-with-pending.png"), await browser.screenshot());
      previewAvailable = true;
      await clickRoot("#check-live-preview");
      await browser.waitFor('document.querySelector("#preview-availability").textContent.includes("Current preview verified")');
      await browser.call("Emulation.setDeviceMetricsOverride", { width: 920, height: 620, deviceScaleFactor: 1, mobile: false });
      await browser.evaluate('window.beforePendingReload = true');
      await reloadRoot();
      await browser.waitFor('window.beforePendingReload === undefined && document.querySelector("#preview-availability")?.textContent.includes("Current preview verified") && document.querySelector("#studio-workspace")?.dataset.historyCollapsed==="true"');
      const pendingGeometry = async () => browser.evaluate(`(() => {
        const pane=document.querySelector("#live-preview-panel").getBoundingClientRect(), frame=document.querySelector("#preview-frame").getBoundingClientRect(),
          feedback=document.querySelector("#prototype-review").getBoundingClientRect(), input=document.querySelector("#revision-input").getBoundingClientRect(),
          send=document.querySelector("#submit-revision").getBoundingClientRect();
        return {paneBottom:pane.bottom,previewHeight:frame.height,previewBottom:frame.bottom,feedbackTop:feedback.top,feedbackBottom:feedback.bottom,
          inputBottom:input.bottom,sendBottom:send.bottom};
      })()`);
      for (const expanded of [false, true]) {
        if (expanded) {
          await clickRoot("#revision-input");
          await browser.call("Input.insertText", { text: "First feedback line.\nSecond feedback line.\nThird feedback line." });
        }
        const geometry = await pendingGeometry();
        assert.ok(geometry.previewHeight >= 180 && geometry.previewBottom <= geometry.feedbackTop, JSON.stringify(geometry));
        assert.ok(geometry.feedbackBottom <= geometry.paneBottom + 1 && geometry.inputBottom <= geometry.paneBottom
          && geometry.sendBottom <= geometry.paneBottom, `920x620 pending preview and Feedback must initially fit: ${JSON.stringify(geometry)}`);
        if (process.env.TANDEM_UI_EVIDENCE) await writeFile(join(process.env.TANDEM_UI_EVIDENCE, `pending-920x620-${expanded ? "expanded-feedback" : "initial"}.png`), await browser.screenshot());
      }
      await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "a", windowsVirtualKeyCode: 65, modifiers: 2 });
      await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "a", windowsVirtualKeyCode: 65, modifiers: 2 });
      await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Backspace", windowsVirtualKeyCode: 8 });
      await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Backspace", windowsVirtualKeyCode: 8 });
      await browser.call("Emulation.setDeviceMetricsOverride", { width: 1360, height: 1000, deviceScaleFactor: 1, mobile: false });
      await pushPrototype(currentPrototype);
      await browser.waitFor('document.querySelector("#preview-frame").contentDocument?.querySelector("#preview-button")');
      for (const [width, height] of [[1360, 1000], [390, 1000], [1360, 580], [390, 600]]) {
        await browser.call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
        await browser.evaluate('document.querySelector("#preview-frame").scrollIntoView({block:"center"})');
        const rect = await browser.evaluate('(() => {const e=document.querySelector("#preview-frame"),r=e.getBoundingClientRect();return {hidden:e.hidden,display:getComputedStyle(e).display,width:r.width,height:r.height};})()');
        assert.ok(!rect.hidden && rect.display !== "none" && rect.width > 100 && rect.height >= 180, JSON.stringify(rect));
        assert.equal(await browser.evaluate('document.querySelector("#preview-frame").getBoundingClientRect().bottom <= document.querySelector("#prototype-review").getBoundingClientRect().top'), true,
          "The restored inline frame must not cover the original feedback form.");
        const footer = await browser.evaluate(`(() => {
          const pane=document.querySelector("#live-preview-panel"), review=document.querySelector("#prototype-review");
          const bottomPadding=parseFloat(getComputedStyle(pane).paddingBottom);
          return {scrollHeight:pane.scrollHeight,height:pane.clientHeight,padding:bottomPadding,
            bottomGap:pane.getBoundingClientRect().bottom-review.getBoundingClientRect().bottom};
        })()`);
        if (footer.scrollHeight <= footer.height + 1) assert.ok(Math.abs(footer.bottomGap - footer.padding) <= 2, JSON.stringify(footer));
        if (width === 1360 && height === 1000) assert.ok(rect.height > 300, "The preview must grow, not leave blank space below Feedback.");
        await clickRoot("#revision-input");
        assert.equal(await browser.evaluate("document.activeElement.id"), "revision-input");
        await browser.evaluate('document.querySelector("#submit-revision").scrollIntoView({block:"nearest"}); document.querySelector("#submit-revision").focus()');
        assert.equal(await browser.evaluate("document.activeElement.id"), "submit-revision");
        if (process.env.TANDEM_UI_EVIDENCE) await writeFile(join(process.env.TANDEM_UI_EVIDENCE, `inline-current-prototype-${width}-${height}.png`), await browser.screenshot());
      }
      await browser.call("Emulation.setDeviceMetricsOverride", { width: 1360, height: 1000, deviceScaleFactor: 1, mobile: false });
      await browser.evaluate('document.querySelector("#preview-frame").scrollIntoView({block:"center"})');
      const point = await browser.evaluate('(() => {const f=document.querySelector("#preview-frame"),r=f.getBoundingClientRect(),b=f.contentDocument.querySelector("#preview-button").getBoundingClientRect();return {x:r.x+f.clientLeft+b.x+b.width/2,y:r.y+f.clientTop+b.y+b.height/2};})()');
      for (const type of ["mousePressed", "mouseReleased"]) await browser.call("Input.dispatchMouseEvent", { type, ...point, button: "left", clickCount: 1 });
      await browser.waitFor('document.querySelector("#preview-frame").contentDocument.querySelector("#preview-button").textContent==="Preview interaction accepted"');
      const checksBeforeRevisit = previewChecks;
      await clickRoot("#design-tree-tab");
      await clickRoot("#live-preview-tab");
      await browser.waitFor('document.querySelector("#preview-availability").textContent.includes("Current preview verified")');
      assert.ok(previewChecks > checksBeforeRevisit);
      assert.equal(await browser.evaluate('document.querySelector("#preview-frame").contentDocument.querySelector("#preview-button").textContent'), "Preview interaction accepted");
      const checksBeforeReconnect = previewChecks;
      for (const response of rootEvents) response.end();
      await browser.waitFor('document.querySelector("#connection-status").textContent.includes("Reconnecting")');
      await browser.waitFor('document.querySelector("#connection-status").textContent === "" && document.querySelector("#preview-availability").textContent.includes("Current preview verified")');
      assert.ok(previewChecks > checksBeforeReconnect);
      assert.equal(await browser.evaluate('document.querySelector("#preview-frame").contentDocument.querySelector("#preview-button").textContent'), "Preview interaction accepted");
      await browser.call("Emulation.setDeviceMetricsOverride", { width: 390, height: 1000, deviceScaleFactor: 1, mobile: false });
      holdPreviewChecks = true;
      await clickRoot("#prototype-progress-details > summary");
      await clickRoot("#check-live-preview");
      await browser.waitFor('document.querySelector("#preview-availability").textContent.includes("Checking current preview")');
      const pendingPrototype = readyPrototype(1, true);
      pendingPrototype.previewUrl = pendingPrototype.prototypeFlow.checkpoints[0].previewUrl = currentPrototype.previewUrl;
      pendingPrototype.prototypeFlow.checkpoints[1].previewUrl = new URL("preview-candidate", url).href;
      await pushPrototype(pendingPrototype);
      for (let attempt = 0; heldPreviewChecks.length < 2 && attempt < 100; attempt++) await new Promise(resolve => setTimeout(resolve, 20));
      assert.equal(heldPreviewChecks.length, 2);
      heldPreviewChecks[1](true);
      await browser.waitFor('document.querySelector("#preview-availability").textContent.includes("Current preview verified")');
      assert.equal(await browser.evaluate('document.querySelector("#preview-frame").src'), currentPrototype.previewUrl);
      assert.equal(await browser.evaluate('document.querySelector("#open-preview").href'), currentPrototype.previewUrl);
      assert.equal(await browser.evaluate('document.querySelector("#preview-frame").contentDocument.querySelector("#preview-button").textContent'), "Preview interaction accepted",
        "A pending version preserves the working iframe and its interaction state.");
      assert.match(await browser.evaluate('document.querySelector("#prototype-progress-message").textContent'), /Interaction prototype ready to inspect.*current version until you choose Show Interaction prototype/);
      assert.equal(await browser.evaluate('document.querySelector("#preview-frame").getBoundingClientRect().bottom <= document.querySelector("#prototype-review").getBoundingClientRect().top'), true);
      if (process.env.TANDEM_UI_EVIDENCE) await writeFile(join(process.env.TANDEM_UI_EVIDENCE, "inline-pending-prototype-390.png"), await browser.screenshot());
      assert.equal(mutations.some(item => item.path === "/api/prototype/action"), false);
      assert.equal(mutations.length, mutationsBeforeAvailability, "Availability, revisit and reconnect call no mutation/start endpoint.");
      holdPreviewChecks = false;
      await clickRoot("#apply-prototype-update");
      await browser.waitFor('document.querySelector("#preview-frame").contentDocument?.querySelector("#preview-button")?.textContent==="Candidate prototype"');
      assert.equal(await browser.evaluate('document.querySelector("#preview-frame").src'), pendingPrototype.prototypeFlow.checkpoints[1].previewUrl);
      heldPreviewChecks[0](false);
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(await browser.evaluate('!document.querySelector("#preview-frame").hidden && document.querySelector("#preview-frame").src'), pendingPrototype.prototypeFlow.checkpoints[1].previewUrl,
        "A late response for the previous current checkpoint cannot hide or replace the verified candidate after explicit promotion.");
      assert.equal(mutations.filter(item => item.path === "/api/prototype/action").length, 1);
      assert.equal(active, false, "Prototype viewing and explicit promotion remain Stage1-owned.");
      await browser.call("Emulation.setDeviceMetricsOverride", { width: 1360, height: 1000, deviceScaleFactor: 1, mobile: false });
      await clickRoot("#development-tab");
      assert.equal(active, false, "Artifact navigation is not initialization.");
      await clickRoot("#enter-development");
      await browser.waitFor('Boolean(document.querySelector("#project-conversation-frame"))');
      await browser.waitFor('document.querySelector(".brand-artwork").naturalWidth > 0');
      let frame;
      for (let attempt = 0; attempt < 100 && !frame; attempt++) {
        const tree = await browser.call("Page.getFrameTree");
        frame = tree.frameTree.childFrames?.find(item => item.frame.url.startsWith(provider.url));
        if (!frame) await new Promise(done => setTimeout(done, 30));
      }
      assert.ok(frame);
      const world = await browser.call("Page.createIsolatedWorld", { frameId: frame.frame.id, worldName: "project-ui" });
      const inside = async expression => {
        const result = await browser.call("Runtime.evaluate", { contextId: world.executionContextId, expression,
          returnByValue: true, awaitPromise: true });
        assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
        return result.result.value;
      };
      const waitInside = async expression => {
        for (let count = 0; count < 150; count++) {
          if (await inside(expression)) return;
          await new Promise(done => setTimeout(done, 30));
        }
        assert.fail(`Embedded condition did not settle: ${expression}\n${JSON.stringify(browser.exceptions)}\n${await inside('document.body.innerText')}\n${await (await fetch(new URL("api/snapshot", provider.url))).text()}`);
      };
      const click = async (selector, embedded = false, activate = true) => {
        const evaluate = embedded ? inside : browser.evaluate;
        const local = await evaluate(`(() => {const e=document.querySelector(${JSON.stringify(selector)}); e.scrollIntoView({block:"nearest"});
          const r=e.getBoundingClientRect(); const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
          return {x:r.x+r.width/2,y:r.y+r.height/2,rect:{left:r.left,right:r.right,top:r.top,bottom:r.bottom},hit:hit?.outerHTML.slice(0,300),
            viewport:{width:innerWidth,height:innerHeight},disabled:e.disabled,ok:r.width>0&&r.height>0&&(hit===e||e.contains(hit))&&!e.disabled};})()`);
        if (!local.ok && process.env.TANDEM_UI_EVIDENCE) await writeFile(join(process.env.TANDEM_UI_EVIDENCE, "unreachable-control.png"), await browser.screenshot());
        assert.ok(local.ok, `${selector} must be visible and hit-testable: ${JSON.stringify(local)}`);
        const offset = embedded ? await browser.evaluate(`(() => {const e=document.querySelector("#project-conversation-frame");
          e.scrollIntoView({block:"nearest"}); const r=e.getBoundingClientRect(); return {x:r.x,y:r.y};})()`) : { x: 0, y: 0 };
        if (!activate) return;
        for (const type of ["mousePressed", "mouseReleased"]) await browser.call("Input.dispatchMouseEvent",
          { type, x: local.x + offset.x, y: local.y + offset.y, button: "left", clickCount: 1 });
      };
      await waitInside('document.body.dataset.projectWorking==="development"');
      await waitInside('document.querySelector("#backbone-state").textContent==="Design unverified"');
      assert.equal(await inside('document.querySelector("#backbone-state").textContent'), "Design unverified");
      assert.match(await inside('document.querySelector("#assessment-card").textContent'), /not yet verified/);
      assert.doesNotMatch(await inside('document.querySelector("#assessment-card").textContent'), /No Design has been published/);
      await browser.call("Emulation.setDeviceMetricsOverride", { width: 390, height: 620, deviceScaleFactor: 1, mobile: false });
      await waitInside('document.body.dataset.projectStacked==="true"');
      assert.ok(await inside('document.querySelector("#design-panel").getBoundingClientRect().height <= 180'),
        "Unverified/empty Design cannot consume the narrow viewport before recovery controls.");
      await browser.call("Emulation.setDeviceMetricsOverride", { width: 1360, height: 1000, deviceScaleFactor: 1, mobile: false });
      await waitInside('document.body.dataset.projectStacked==="false"');
      assert.equal(await inside('document.querySelector("#message").disabled && document.querySelector("#send").disabled'), true,
        "The chosen Development context is not actionable before runtime readiness.");
      assert.equal(await inside('document.querySelector("#initialize").hidden'), true, "No redundant setup action while entry initializes.");
      installationStatus = "prepared"; events.touch();
      await waitInside('!document.querySelector("#initialize").hidden && !document.querySelector("#initialize").disabled');
      assert.equal(await inside('document.querySelector("#message").disabled && document.querySelector("#send").disabled'), true);
      assert.equal(nativeRequests.length, 0);
      await click("#initialize", true);
      await waitInside('!document.querySelector("#send").disabled');
      await browser.call("Emulation.setDeviceMetricsOverride", { width: 1233, height: 620, deviceScaleFactor: 1, mobile: false });
      await waitInside('document.querySelector(".shared-sketch") !== null');
      const designGeometry = await inside(`(() => {const figure=document.querySelector(".shared-sketch").getBoundingClientRect(),
        pane=document.querySelector("#design-panel").getBoundingClientRect();return {top:figure.top,visibleHeight:Math.min(figure.bottom,pane.bottom)-Math.max(figure.top,pane.top),paneHeight:pane.height};})()`);
      assert.ok(designGeometry.visibleHeight >= 160, `Design must be useful without scrolling its overview away: ${JSON.stringify(designGeometry)}`);
      assert.equal(await inside('document.querySelector("#design-overview").open'), false);
      await inside('window.verifiedDesignNode = document.querySelector("#design-artifacts").firstElementChild; true');
      installationStatus = "unknown"; events.touch();
      await waitInside('document.querySelector("#backbone-state").textContent === "Design unverified"');
      assert.equal(await inside('window.verifiedDesignNode === document.querySelector("#design-artifacts").firstElementChild'), true,
        "A temporarily unverified runtime retains the previously displayed Design without claiming it is empty.");
      assert.equal(await inside('document.querySelector("#message").disabled'), true);
      installationStatus = "ready"; events.touch();
      await waitInside('!document.querySelector("#send").disabled');
      await browser.call("Emulation.setDeviceMetricsOverride", { width: 1360, height: 1000, deviceScaleFactor: 1, mobile: false });
      assert.deepEqual(mutations.filter(item => item.path === "/api/development/open").map(item => item.body), [{ retry: false }, { retry: true }],
        "The installation's public retry capability releases the failed starting state without a new routing control.");
      assert.equal(await inside('document.querySelector("#project-message-target")===null'), true);
      await click("#design-tree-tab");
      await waitInside('document.body.dataset.projectDesign==="false"');
      assert.equal(await browser.evaluate('document.querySelector("#usage-input").disabled'), true, "Earlier inputs are read-only while Development owns current work.");
      for (const width of [920, 390]) {
        await browser.call("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false });
        await waitInside(`document.body.dataset.projectStacked==="${width < 800}"`);
        assert.equal(await browser.evaluate('document.querySelector("#project-conversation-frame").hidden && document.querySelector("#project-conversation-frame").getBoundingClientRect().height === 0'), true,
          `Private chat is not visible in an earlier phase at ${width}px.`);
        await browser.waitFor('document.querySelector("#discovery-history").hidden');
        assert.equal(await browser.evaluate('document.querySelector("#discovery-history").checkVisibility()'), false,
          "Unchosen secondary history collapses at a constrained width rather than taking artifact space.");
      }
      await browser.call("Emulation.setDeviceMetricsOverride", { width: 1360, height: 1000, deviceScaleFactor: 1, mobile: false });
      await waitInside('document.body.dataset.projectStacked==="false"');
      await click("#development-tab");
      await waitInside('document.body.dataset.projectDesign==="true"');
      assert.equal(await inside('document.querySelector("#messages").textContent.includes("Discovery evidence")'), false);
      assert.equal(await browser.evaluate('document.querySelector("#discovery-history") === null'), true);
      const checkRootChrome = async () => {
        const styles = await browser.evaluate(`["#project-settings","#project-current-work",".topbar"].map(selector=>{
          const element=document.querySelector(selector), style=getComputedStyle(element);
          return {selector,background:style.backgroundColor,color:style.color,height:element.getBoundingClientRect().height};
        })`);
        const luminance = color => {
          const channels = color.match(/[\d.]+/g).slice(0, 3).map(value => {
            const channel = Number(value) / 255; return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
          });
          return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
        };
        for (const item of styles) {
          assert.match(item.background, /^rgb\(/, `${item.selector} needs an opaque background, not ${item.background}`);
          const values = [luminance(item.background), luminance(item.color)].sort((a, b) => b - a);
          assert.ok((values[0] + .05) / (values[1] + .05) >= 4.5, `${item.selector} needs readable contrast.`);
          assert.ok(item.height >= 30, `${item.selector} uses the actual shared control geometry.`);
        }
      };
      const checkEffortLayout = async () => {
        const geometry = await inside(`(() => {const panel=document.querySelector("#canvas-settings").getBoundingClientRect();
          const ids=["project-effort","apply-project-effort","refresh-project-effort"];
          return {panel:{left:panel.left,right:panel.right},items:ids.map(id=>{const e=document.getElementById(id),r=e.getBoundingClientRect();
            const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
            return {id,left:r.left,right:r.right,top:r.top,bottom:r.bottom,hit:hit===e||e.contains(hit)};})};})()`);
        const [field, apply, refresh] = geometry.items;
        assert.ok(apply.top >= field.bottom && refresh.top >= field.bottom, JSON.stringify(geometry));
        for (const item of geometry.items) assert.ok(item.hit && item.left >= geometry.panel.left && item.right <= geometry.panel.right, JSON.stringify(geometry));
        assert.ok(apply.right <= refresh.left || refresh.right <= apply.left || apply.bottom <= refresh.top || refresh.bottom <= apply.top, "Actions wrap rather than overlap.");
      };
      await checkRootChrome();
      assert.equal(await inside('document.querySelector("#current-state").textContent'), "Ready");
      assert.equal(await browser.evaluate('document.querySelector("#project-effort-settings")===null'), true);
      await click("#project-settings");
      await waitInside('document.querySelector("#project-effort-status").textContent.includes("Stage 1: applied")');
      await inside('document.querySelector("#project-effort option[value=low]").textContent="No shared choice; native defaults unchanged"');
      await checkEffortLayout();
      assert.equal(await inside('document.querySelectorAll("#project-effort").length'), 1);
      assert.equal(await inside('document.querySelector("#private-effort-setting").hidden'), true);
      const startsBeforeSettings = mutations.filter(item => item.path === "/api/development/open").length;
      await click("#apply-project-effort", true);
      await waitInside('document.querySelector("#project-effort-settings").getAttribute("aria-busy")==="false"');
      assert.equal(mutations.filter(item => item.path === "/api/development/open").length, startsBeforeSettings);
      await click("#close-settings", true);
      await waitInside('!document.querySelector("#canvas-settings").open');
      await browser.waitFor('document.activeElement.id==="project-settings"');
      const beforeAdvanced = mutations.length;
      for (const [width, height] of [[1360, 900], [920, 620], [390, 620]]) {
        await browser.call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
        await click("#acceptance-delivery");
        await browser.waitFor('!!document.querySelector(".process-dialog") && getComputedStyle(document.querySelector(".process-dialog")).pointerEvents !== "none"');
        const advanced = await browser.evaluate(`(() => {
          const d=document.querySelector(".process-dialog"),r=d.getBoundingClientRect(),b=document.querySelector("#close-acceptance-delivery"),
            c=b.getBoundingClientRect(),hit=document.elementFromPoint(c.x+c.width/2,c.y+c.height/2);
          return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight,
            closeHit:hit===b||b.contains(hit),hit:hit?.outerHTML.slice(0,500),pointerEvents:getComputedStyle(d).pointerEvents,
            zIndex:getComputedStyle(d).zIndex,overlayZ:getComputedStyle(document.querySelector(".process-dialog-overlay")).zIndex,
            close:{top:c.top,bottom:c.bottom,left:c.left,right:c.right},count:document.querySelectorAll("#handoff-approver").length,
            rootToggle:!!d.querySelector(".process-controls > button.ledger-summary")};
        })()`);
        assert.ok(advanced.left>=0 && advanced.right<=advanced.width && advanced.top>=0 && advanced.bottom<=advanced.height, JSON.stringify(advanced));
        if (process.env.TANDEM_UI_EVIDENCE) await writeFile(join(process.env.TANDEM_UI_EVIDENCE, `advanced-delivery-open-${width}.png`), await browser.screenshot());
        assert.equal(advanced.closeHit, true, JSON.stringify(advanced));
        assert.equal(advanced.count, 1);
        assert.equal(advanced.rootToggle, false, "Opening advanced delivery must expose controls, not an empty nested disclosure.");
        await click("#handoff-approver");
        await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", windowsVirtualKeyCode: 9 });
        await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", windowsVirtualKeyCode: 9 });
        assert.equal(await browser.evaluate('document.querySelector(".process-dialog").contains(document.activeElement)'), true);
        if (process.env.TANDEM_UI_EVIDENCE) await writeFile(join(process.env.TANDEM_UI_EVIDENCE, `advanced-delivery-${width}.png`), await browser.screenshot());
        await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", windowsVirtualKeyCode: 27 });
        await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", windowsVirtualKeyCode: 27 });
        await browser.waitFor('!document.querySelector(".process-dialog") && document.activeElement.id==="acceptance-delivery"');
      }
      assert.equal(mutations.length, beforeAdvanced);
      await browser.call("Emulation.setDeviceMetricsOverride", { width: 1360, height: 1000, deviceScaleFactor: 1, mobile: false });
      await waitInside('document.body.dataset.projectStacked==="false"');
      await browser.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))');
      await click("#message", true);
      await waitInside('document.activeElement.id==="message"');
      await browser.call("Input.insertText", { text: "As a user, I keep my draft while viewing Design." });
      assert.equal(await inside('document.querySelector("#message").value'), "As a user, I keep my draft while viewing Design.");
      await inside(`(() => {
        const transfer = new DataTransfer();
        transfer.items.add(new File([Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII="), c => c.charCodeAt(0))], "clipboard.png", {type:"image/png"}));
        document.querySelector("#message").dispatchEvent(new ClipboardEvent("paste", {clipboardData:transfer,bubbles:true,cancelable:true}));
        document.querySelector("#message").setSelectionRange(3, 8);
      })()`);
      await waitInside('document.querySelector("#clipboard-caption").textContent.includes("Ready to send")');
      const attachment = await inside('document.querySelector("#clipboard-image").src');
      const beforeBrowse = mutations.length;
      for (const tab of ["#preparation-tab", "#design-tree-tab", "#sketch-tab", "#live-preview-tab"]) {
        await click(tab);
        await browser.waitFor('document.querySelector("#project-conversation-frame").hidden');
        assert.equal(await browser.evaluate('document.querySelector("#discovery-history").checkVisibility()'), true);
        assert.equal(await inside('document.querySelector("#message").value'), "As a user, I keep my draft while viewing Design.");
        assert.equal(await inside('document.querySelector("#message").selectionStart'), 3);
        assert.equal(await inside('document.querySelector("#clipboard-image").src'), attachment);
        assert.equal(await inside('document.querySelector("#clipboard-preview").hidden'), false);
        if (process.env.TANDEM_UI_EVIDENCE) await writeFile(join(process.env.TANDEM_UI_EVIDENCE, `isolated-${tab.slice(1)}.png`), await browser.screenshot());
        await click("#development-tab");
        await browser.waitFor('!document.querySelector("#project-conversation-frame").hidden');
        await waitInside('document.body.dataset.projectDesign==="true" && document.querySelector("#conversation-panel").getBoundingClientRect().width < innerWidth - 100');
        assert.equal(await inside('document.querySelector("#messages").textContent.includes("Discovery evidence")'), false);
      }
      assert.equal(mutations.length, beforeBrowse);
      assert.equal(nativeRequests.length, 0);
      await click("#message", true);
      assert.equal(await inside('document.activeElement.id'), "message");
      await click("#clipboard-remove", true);
      if (process.env.TANDEM_UI_EVIDENCE) await writeFile(join(process.env.TANDEM_UI_EVIDENCE, "isolated-development-private-chat.png"), await browser.screenshot());
      const conversationWidth = () => browser.evaluate('document.querySelector("#project-conversation").getBoundingClientRect().width');
      const initialWidth = await inside('document.querySelector("#conversation-panel").getBoundingClientRect().width');
      await click("#development-tab");
      await waitInside('document.body.dataset.projectDesign==="true"');
      await waitInside(`Math.abs(document.querySelector("#conversation-panel").getBoundingClientRect().width-${initialWidth})<2`);
      await click("#workspace-divider", true);
      await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowLeft", windowsVirtualKeyCode: 37 });
      await waitInside(`Math.abs(document.querySelector("#conversation-panel").getBoundingClientRect().width-${initialWidth + 10})<2`);
      assert.equal(await inside('document.querySelector("#message").value'), "As a user, I keep my draft while viewing Design.");
      assert.equal(await inside('document.querySelector("#project-message-context strong").textContent'), "Development");
      await click("#design-tree-tab");
      await waitInside('document.body.dataset.projectDesign==="false"');
      assert.equal(await browser.evaluate('document.querySelector("#project-conversation-frame").hidden'), true);
      assert.equal(await inside('document.querySelector("#message").value'), "As a user, I keep my draft while viewing Design.");
      const returnedWidth = await conversationWidth();
      assert.ok(Math.abs(returnedWidth - initialWidth - 10) < 2,
        `Development resizing follows the conversation into discovery: initial ${initialWidth}, returned ${returnedWidth}, ${await browser.evaluate('document.querySelector("#studio-workspace").getAttribute("style")')}.`);
      await click("#project-conversation-divider");
      await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowRight", windowsVirtualKeyCode: 39 });
      await browser.waitFor(`Math.abs(document.querySelector("#project-conversation").getBoundingClientRect().width-${initialWidth - 14})<2`);
      await click("#development-tab");
      await waitInside(`document.body.dataset.projectDesign==="true" && Math.abs(document.querySelector("#conversation-panel").getBoundingClientRect().width-${initialWidth - 14})<2`);
      await click("#message", true);
      await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "a", windowsVirtualKeyCode: 65, modifiers: 2 });
      await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "a", windowsVirtualKeyCode: 65, modifiers: 2 });
      await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Backspace", windowsVirtualKeyCode: 8 });
      await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Backspace", windowsVirtualKeyCode: 8 });
      assert.equal(nativeRequests.length, 0);
      assert.equal(mutations.filter(x => x.path === "/api/development/open").length, 2);
      await browser.waitFor('Boolean(document.querySelector("[data-development-output=\'plan:fixture-cycle\']"))');
      const beforeOutputNavigation = mutations.length;
      for (const group of ["design", "plan", "implementation", "review"]) {
        assert.equal(await browser.evaluate(`document.querySelector("#artifact-group-development-${group}").getAttribute("aria-expanded")`), "false");
      }
      await click("#artifact-group-development-plan");
      await click('[data-development-output="plan:fixture-cycle"]');
      await waitInside('!document.querySelector("#project-output-view").hidden && document.querySelector("#project-output-view").textContent.includes("Original saved plan")');
      await click("#artifact-group-development-plan");
      await browser.evaluate('window.retainedArtifactGroup = document.querySelector("#artifact-group-development-plan"); true');
      nativeState.cycles[0].plan = { ...nativeState.cycles[0].plan, version: 3, digest: "c".repeat(64) }; events.touch();
      await browser.waitFor('document.querySelector("#artifact-group-development-plan").textContent.includes("New")');
      assert.equal(await browser.evaluate('document.querySelector("#artifact-group-development-plan").getAttribute("aria-expanded")'), "false");
      assert.equal(await browser.evaluate('document.activeElement === window.retainedArtifactGroup'), true);
      for (const width of [920, 390]) {
        await browser.call("Emulation.setDeviceMetricsOverride", { width, height: 620, deviceScaleFactor: 1, mobile: false });
        await browser.evaluate('document.querySelector("#artifact-group-development-plan").scrollIntoView({block:"nearest"})');
        const group = await browser.evaluate('(() => {const e=document.querySelector("#artifact-group-development-plan"),r=e.getBoundingClientRect();return {left:r.left,right:r.right,overflow:e.scrollWidth-e.clientWidth,label:e.getAttribute("aria-label")};})()');
        assert.ok(group.left >= 0 && group.right <= width && group.overflow <= 1, JSON.stringify(group));
        assert.match(group.label, /1 items.*new output/);
        if (process.env.TANDEM_UI_EVIDENCE) await writeFile(join(process.env.TANDEM_UI_EVIDENCE, `collapsed-artifact-groups-${width}.png`), await browser.screenshot());
      }
      await browser.call("Emulation.setDeviceMetricsOverride", { width: 1360, height: 1000, deviceScaleFactor: 1, mobile: false });
      await browser.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))');
      await click("#artifact-group-development-plan");
      await browser.waitFor('document.activeElement.id==="artifact-group-development-plan"');
      for (const type of ["keyDown", "keyUp"]) await browser.call("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13,
        ...(type === "keyDown" ? { text: "\r" } : {}) });
      await browser.waitFor('document.querySelector("#artifact-group-development-plan").getAttribute("aria-expanded")==="false"');
      for (const type of ["keyDown", "keyUp"]) await browser.call("Input.dispatchKeyEvent", { type, key: " ", code: "Space", windowsVirtualKeyCode: 32,
        ...(type === "keyDown" ? { text: " " } : {}) });
      await browser.waitFor('document.querySelector("#artifact-group-development-plan").getAttribute("aria-expanded")==="true"');
      await click("#artifact-group-development-implementation");
      await click('[data-development-output="implementation:fixture-cycle"]');
      await waitInside('document.querySelector("#project-output-view").textContent.includes("Original reported implementation")');
      await waitInside('document.activeElement.hasAttribute("data-implementation-result")');
      await click("#artifact-group-development-review");
      await click('[data-development-output="review:handoff:fixture-review"]');
      await waitInside('document.querySelector("[data-entry-id=\'handoff:fixture-review\']").classList.contains("state-focused")');
      await click("#artifact-group-development-design");
      await click('[data-development-output="design:interaction"]');
      await waitInside('document.querySelector("#project-output-view").hidden && document.querySelector("[data-artifact-tab=interaction]").getAttribute("aria-pressed")==="true"');
      assert.equal(mutations.length, beforeOutputNavigation, "Artifact viewing dispatches no work or runtime activation.");
      await click("#project-settings");
      await waitInside('document.querySelector("#canvas-settings").open');
      assert.equal(await inside("document.activeElement.id"), "setting-theme");
      assert.equal(await inside('document.querySelector("#setting-effort").disabled'), true);
      assert.equal(await inside('getComputedStyle(document.querySelector(".brand")).display'), "none");
      assert.equal(await inside('getComputedStyle(document.querySelector("#browser-session-guidance")).display'), "none");
      for (const [theme, index] of [["light", 1], ["dark", 2]]) {
        await click("#setting-theme", true);
        for (const key of ["Home", ...Array(index).fill("ArrowDown"), "Enter"]) {
          const windowsVirtualKeyCode = { Home: 36, ArrowDown: 40, Enter: 13 }[key];
          await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key, windowsVirtualKeyCode });
          await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key, windowsVirtualKeyCode });
        }
        assert.equal(await inside('document.querySelector("#setting-theme").value'), theme);
        await click("#save-appearance", true);
        await browser.waitFor(`document.documentElement.dataset.projectTheme==="${theme}"`);
        await checkRootChrome();
        assert.equal(await inside('getComputedStyle(document.querySelector("#design-panel")).backgroundColor'),
          await browser.evaluate('getComputedStyle(document.documentElement).backgroundColor'), `${theme}: shared surface palette`);
        assert.equal(await inside('getComputedStyle(document.body).fontSize'),
          await browser.evaluate('getComputedStyle(document.documentElement).fontSize'), "Shared shell typography");
        assert.equal(await inside('document.querySelector("#close-settings").getBoundingClientRect().height'),
          await browser.evaluate('document.querySelector("#project-settings").getBoundingClientRect().height'), "Shared control height");
      }
      const beforeDismissal = mutations.length;
      await inside('document.querySelector("#setting-theme").value="dark"');
      await click("#close-settings", true);
      await waitInside('!document.querySelector("#canvas-settings").open');
      await browser.waitFor('document.activeElement.id==="project-settings"');
      assert.equal(await inside('document.querySelector("#setting-theme").value'), "dark", "Dismissal does not discard the field value.");
      assert.equal(mutations.length, beforeDismissal, "Settings dismissal cannot mutate settings or runtime.");
      await click("#project-settings");
      await waitInside('document.querySelector("#canvas-settings").open');
      await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await waitInside('!document.querySelector("#canvas-settings").open');
      await browser.waitFor('document.activeElement.id==="project-settings"');
      const beforeHintDrafts = mutations.length;
      await exerciseRoleHintDraft({ browser, evaluate: inside, click: selector => click(selector, true) });
      assert.equal(nativeRequests.length, 0);
      assert.equal(mutations.length, beforeHintDrafts, "Role-hint editing never mutates Stage1 or dispatches a request.");
      await click("#message", true); await browser.call("Input.insertText", { text: "@designer Review current implementation without changes." });
      await click("#send", true);
      await waitInside('document.querySelector("#message").value===""');
      assert.equal(nativeRequests.length, 1); assert.match(nativeRequests[0].message, /Review current/);
      assert.deepEqual(nativeRequests[0].roleHint, { schemaVersion: "human-role-hint/v1", role: "designer" });
      await waitInside('[...document.querySelectorAll(".conversation-assistant .conversation-role")].some(node => node.textContent === "agent")');
      assert.match(await inside('[...document.querySelectorAll(".conversation-user .conversation-role")].at(-1).textContent'), /Preference: @designer/);
      if (process.env.TANDEM_UI_EVIDENCE) await writeFile(join(process.env.TANDEM_UI_EVIDENCE, "role-hint-integrated.png"), await browser.screenshot());
      const queuedInputs = [
        { id: "queued-one", message: "@agent Rerun the game after update.", receivedAt: new Date().toISOString(),
          answers: null, roleHint: { schemaVersion: "human-role-hint/v1", role: "agent" } },
        { id: "queued-two", message: "  Keep this exact second request.\nDo not start yet.", receivedAt: new Date().toISOString(), answers: null },
      ];
      nativeState.requests.push(...queuedInputs.map(request => ({ ...request, status: "waiting", blockingAnswerRefs: [], questionGatesReleased: false })));
      events.touch();
      await waitInside('document.querySelectorAll("[data-queued-waiting] [data-queued-request-id]").length === 2');
      assert.equal(await inside('document.querySelector("#messages [data-request-id=queued-one]")'), null);
      assert.deepEqual(await inside('[...document.querySelectorAll("[data-queued-waiting] [data-queued-request-id]")].map(node=>node.dataset.queuedRequestId)'), ["queued-one", "queued-two"]);
      await click('[data-queued-request-id=queued-one] > details > summary', true);
      assert.match(await inside('document.querySelector("[data-queued-request-id=queued-one] .conversation-role").textContent'), /Preference: @agent/);
      for (const width of [980, 390, 1360]) {
        await browser.call("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false });
        const geometry = await inside(`(() => { const q=document.querySelector("#queued-requests").getBoundingClientRect(),
          c=document.querySelector("#composer").getBoundingClientRect(); return {bottom:q.bottom,top:c.top,height:q.height,overflow:document.documentElement.scrollWidth>innerWidth}; })()`);
        assert.ok(geometry.bottom <= geometry.top + 1 && geometry.height <= 181 && !geometry.overflow, JSON.stringify(geometry));
      }
      if (process.env.TANDEM_UI_EVIDENCE) await writeFile(join(process.env.TANDEM_UI_EVIDENCE, "queued-integrated.png"), await browser.screenshot());
      await waitInside('!document.querySelector("#stop-current-flow").disabled');
      await click("#stop-current-flow", true);
      await waitInside('document.querySelector("#stop-current-flow").disabled');
      assert.equal(mutations.filter(x => x.path === "native-stop").length, 1);
      await waitInside('document.querySelectorAll("[data-queued-history] [data-queued-request-id]").length === 2');
      assert.equal(await inside('document.querySelector("#messages [data-request-id=queued-one]")'), null);
      assert.equal(await inside('document.querySelector("#messages [data-request-id=queued-two]")'), null);
      const requestId = nativeRequests[0].id;
      nativeState.handoffs.push({ id: "handoff:question-result", presented: true,
        result: { resultId: "question-result", outcome: { kind: "designer-questions", summary: "Confirm scope." } } });
      nativeState.questions.push({ id: "scope-question", question: "Which scope should we retain?", context: "Saved project scope",
        whyItMatters: "Avoid unintended changes", importance: "blocking", options: [], allowFreeform: true,
        state: "open", blockingActive: true, source: { role: "designer", resultId: "question-result",
          requestId, requestIds: [requestId], cycleId: null, design: designBinding, planDigest: null } });
      events.touch();
      await waitInside('!document.querySelector("#show-questions").disabled');
      if (await inside('document.querySelector("#question-panel").hidden')) await click("#show-questions", true);
      await click("#question-panel select", true);
      for (const [key, windowsVirtualKeyCode] of [["End", 35], ["Enter", 13]]) {
        await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key, windowsVirtualKeyCode });
        await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key, windowsVirtualKeyCode });
      }
      await click('#question-panel textarea', true);
      await browser.call("Input.insertText", { text: "Keep the current approved scope." });
      await click('[data-human-loop-action="submitAnswers"]', true);
      await waitInside('document.querySelector("#question-panel").textContent.includes("Submitted answer:")');
      assert.equal(nativeRequests.length, 2);
      assert.equal(nativeRequests[1].answers.answers[0].sourceResultId, "question-result");
      assert.equal(Object.hasOwn(nativeRequests[1], "roleHint"), false, "Hints never persist into question answers.");
      await click("#show-questions", true);
      nativeState.requests.at(-1).route = { resultId: "route-confirmation", outcome: { summary: "Implement the approved scope." } };
      nativeState.implementationConfirmations = [{ id: "confirmation-one", requestId: nativeRequests[1].id,
        requestIds: [nativeRequests[1].id], routeResultId: "route-confirmation", status: "pending",
        design: designBinding }];
      nativeState.requests.push({ id: "queued-during-consent", message: "Keep this queued while I decide.",
        receivedAt: new Date().toISOString(), answers: null, status: "waiting", blockingAnswerRefs: [], questionGatesReleased: false });
      accessRequests = [{ id: "permission-one", title: "Read project files", scopes: ["Purpose: Inspect the current source"], canApproveAll: false }];
      events.touch();
      await waitInside('document.querySelectorAll("[data-queued-waiting] [data-queued-request-id]").length === 1');
      await waitInside('Boolean(document.querySelector("[data-access-decision=denied]"))');
      await click('[data-access-decision="denied"]', true);
      await waitInside('!document.querySelector("[data-request-id=permission-one]")');
      assert.deepEqual(mutations.find(x => x.path === "native-consent"),
        { path: "native-consent", id: "permission-one", decision: "denied", sessionId: "private" });
      const capturedPermissions = process.env.TANDEM_PERMISSION_FIXTURE
        ? JSON.parse(await readFile(process.env.TANDEM_PERMISSION_FIXTURE, "utf8")).accessRequests : null;
      if (process.env.TANDEM_PERMISSION_FIXTURE) assert.ok(Array.isArray(capturedPermissions) && capturedPermissions.length >= 2,
        "An explicit captured-state qualification must contain real pending requests, never fall back to synthetic ones.");
      accessRequests = capturedPermissions ?? ["layout-read", "layout-shell"].map((id, index) => ({
        id, kind: index ? "shell" : "read",
        title: index ? "Allow the agent to run this shell command?" : "Allow the agent to read this path?",
        description: "Inspect the exact project scope before deciding.",
        scopes: [index ? "node --test test\\counter.test.js && git --no-pager diff -- public\\app.js"
          : `C:\\qualification\\${"retained-project-directory\\".repeat(12)}public\\app.js`],
        canApproveAll: true, canApproveForSession: false,
        nativeInvocation: { sessionId: "private", taskId: "selected-role", requestId: "selected-request", toolCallId: id,
          toolName: index ? "powershell" : "view" },
      }));
      assert.ok(accessRequests.length >= 2);
      const permissionIds = accessRequests.map(request => request.id);
      const consentCount = mutations.filter(item => item.path === "native-consent").length;
      events.touch();
      await waitInside('Boolean(document.querySelector(".access-request-picker select"))');
      await click("#development-tab");
      await waitInside('document.body.dataset.projectDesign==="true"');
      await click("#workspace-divider", true);
      for (let step = 0; step < 60 && await inside('document.querySelector("#conversation-panel").getBoundingClientRect().width > 325'); step++) {
        for (const type of ["keyDown", "keyUp"]) await browser.call("Input.dispatchKeyEvent",
          { type, key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
      }
      assert.ok(await inside('document.querySelector("#conversation-panel").getBoundingClientRect().width <= 325'),
        "Exercise the actual narrow conversation column, not a widened permission workaround.");
      for (const width of [1360, 980, 920, 390]) {
        await browser.call("Emulation.setDeviceMetricsOverride", { width, height: 620, deviceScaleFactor: 1, mobile: false });
        await waitInside(`document.body.dataset.projectStacked==="${width < 800}"`);
        await waitInside('document.querySelector("#conversation-panel").getBoundingClientRect().width > 200 && document.querySelector("#access-approval").clientWidth > 150');
        const fit = await inside(`(() => {
          const panel = document.querySelector("#access-approval"), bounds = panel.getBoundingClientRect();
          const nodes = [...panel.querySelectorAll("#access-requests, .access-request-picker, .access-request-decisions, button, select, p, pre")]
            .filter(node => node.getClientRects().length && !node.closest("[hidden]"));
          return { width: bounds.width, overflow: panel.scrollWidth > panel.clientWidth + 1,
            clipped: nodes.filter(node => { const rect = node.getBoundingClientRect();
              return rect.left < bounds.left || rect.right > bounds.right || node.scrollWidth > node.clientWidth + 1;
            }).map(node => ({ tag: node.tagName, text: node.textContent.slice(0, 60), width: node.getBoundingClientRect().width })) };
        })()`);
        if (process.env.TANDEM_UI_EVIDENCE) await writeFile(join(process.env.TANDEM_UI_EVIDENCE, `permission-multiple-${width}.png`), await browser.screenshot());
        assert.ok(!fit.overflow && !fit.clipped.length, `Permission contents fit at ${width}: ${JSON.stringify(fit)}`);
        await click("#access-requests > .access-card:not([hidden]) .access-request-details > summary", true);
        await click("#access-requests > .access-card:not([hidden]) .access-request-details > summary", true);
        for (const decision of ["once", "denied"]) {
          await click(`#access-requests > .access-card:not([hidden]) [data-access-decision=${decision}]`, true, false);
        }
      }
      assert.equal(mutations.filter(item => item.path === "native-consent").length, consentCount,
        "Layout, navigation and disclosure never imply consent.");
      await browser.call("Emulation.setDeviceMetricsOverride", { width: 1360, height: 1000, deviceScaleFactor: 1, mobile: false });
      await waitInside('document.body.dataset.projectStacked==="false"');
      await click(".access-request-picker select", true);
      for (const [key, code] of [["End", 35], ["Enter", 13]]) {
        for (const type of ["keyDown", "keyUp"]) await browser.call("Input.dispatchKeyEvent",
          { type, key, windowsVirtualKeyCode: code, ...(key === "Enter" && type === "keyDown" ? { text: "\r" } : {}) });
      }
      await waitInside(`document.querySelector("#access-requests > .access-card:not([hidden])").dataset.permissionId===${JSON.stringify(permissionIds.at(-1))}`);
      for (let step = 0; step < 12 && !await inside('document.activeElement.dataset.accessDecision==="once"'); step++) {
        for (const type of ["keyDown", "keyUp"]) await browser.call("Input.dispatchKeyEvent",
          { type, key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
      }
      assert.equal(await inside('document.activeElement.dataset.accessDecision'), "once");
      accessRequests = [...accessRequests, { id: "layout-later-arrival", kind: "read", title: "Later synthetic request",
        scopes: ["Not part of the captured set or the selected decision."], canApproveAll: false }];
      events.touch();
      await waitInside(`document.querySelector(".access-request-picker select").options.length===${permissionIds.length + 1}`);
      await waitInside('document.activeElement.dataset.accessDecision==="once"');
      for (const type of ["keyDown", "keyUp"]) await browser.call("Input.dispatchKeyEvent",
        { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, ...(type === "keyDown" ? { text: "\r" } : {}) });
      await waitInside(`!document.querySelector('[data-request-id="${permissionIds.at(-1)}"]')`);
      assert.deepEqual(mutations.at(-1), { path: "native-consent", id: permissionIds.at(-1), decision: "once", sessionId: "private" });
      await click("#access-requests > .access-card:not([hidden]) [data-access-decision=denied]", true);
      await waitInside(`!document.querySelector('[data-request-id="${permissionIds[0]}"]')`);
      assert.deepEqual(mutations.at(-1), { path: "native-consent", id: permissionIds[0], decision: "denied", sessionId: "private" });
      assert.equal(mutations.filter(item => item.path === "native-consent").length, consentCount + 2,
        "Only the two explicitly selected requests were decided; later arrivals remain pending.");
      accessRequests = [];
      events.touch();
      await waitInside('document.querySelector("#access-approval").hidden');
      await waitInside('Boolean(document.querySelector("[data-implementation-decision=cancelled]:not(:disabled)"))');
      await click('[data-implementation-decision="cancelled"]', true);
      await waitInside('document.querySelector(".implementation-confirmation").textContent.includes("Implementation declined")');
      assert.equal(mutations.find(x => x.path === "native-confirmation").confirmationId, "confirmation-one");
      assert.equal(nativeRequests.length, 2, "Pinned queue presentation cannot dispatch work while approvals are decided.");
      for (const width of [980, 390, 1360]) {
        await browser.call("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: width < 600 });
        assert.equal(await browser.evaluate("innerWidth"), width, "Exercise the real CSS viewport, not mobile page scaling.");
        await click("#development-tab");
        await waitInside('document.body.dataset.projectDesign==="true"');
        await waitInside(`document.body.dataset.projectStacked==="${width < 800}"`);
        assert.equal(await browser.evaluate('document.activeElement.id'), "development-tab");
        for (const badge of ["Available", "New output", "Update ready"]) {
          const fit = await browser.evaluate(`(() => {
            const row=document.querySelector("#development-tab"), list=document.querySelector("#project-contents");
            const badge=row.querySelector(".artifact-count"), label=row.querySelector(".project-tab-label");
            badge.textContent=${JSON.stringify(badge)};
            const r=row.getBoundingClientRect(), b=badge.getBoundingClientRect(), l=label.getBoundingClientRect();
            return {sidebar:document.querySelector("#requirements-pane").getBoundingClientRect().width,
              rowFits:row.scrollWidth<=row.clientWidth+1,listFits:list.scrollWidth<=list.clientWidth+1,
              labelFits:l.left>=r.left&&l.right<=r.right,label:label.textContent,
              badgeFits:b.left>=r.left&&b.right<=r.right,badge:badge.textContent,
              selected:row.getAttribute("aria-selected")};
          })()`);
          assert.equal(fit.label, "Development");
          assert.equal(fit.badge, badge);
          assert.equal(fit.selected, "true");
          assert.ok(fit.rowFits && fit.listFits && fit.labelFits && fit.badgeFits,
            `Navigation keeps full labels and ${badge} without horizontal scrolling at ${width}: ${JSON.stringify(fit)}`);
          if (width === 980) assert.equal(fit.sidebar, 180);
        }
        if (width < 800) {
          assert.equal(await inside('document.querySelector("#workspace-divider").hidden'), true);
          const sizes = await inside('({conversation:document.querySelector("#conversation-panel").getBoundingClientRect().width, layout:document.querySelector(".human-layout").clientWidth})');
          assert.ok(Math.abs(sizes.conversation - sizes.layout) < 2 && Math.abs(sizes.conversation - await conversationWidth()) <= 20,
            `Constrained conversation fills available width, allowing the vertical scrollbar: ${JSON.stringify(sizes)}, root ${await conversationWidth()}.`);
        }
        assert.equal(await browser.evaluate('document.querySelectorAll("#project-conversation-frame").length'), 1);
        assert.equal(await inside('document.documentElement.scrollWidth<=innerWidth+1'), true, `No embedded overflow at ${width}.`);
        await click("#message", true);
        if (width === 980) await browser.call("Input.insertText", { text: "Keep this draft through narrow navigation." });
        assert.equal(await inside('document.querySelector("#message").value'), "Keep this draft through narrow navigation.");
        assert.equal(await inside('document.querySelector("#project-message-target")===null'), true);
        await click("#project-settings");
        await waitInside('document.querySelector("#canvas-settings").open');
        await checkEffortLayout();
        await click("#close-settings", true);
        await waitInside('!document.querySelector("#canvas-settings").open');
        if (process.env.TANDEM_UI_EVIDENCE) await writeFile(join(process.env.TANDEM_UI_EVIDENCE, `project-workspace-${width}.png`), await browser.screenshot());
      }
      await click("#project-settings");
      await waitInside('document.querySelector("#canvas-settings").open');
      await click("#open-diagnostics", true);
      await click("#shutdown", true);
      await waitInside('document.querySelector("#initialize").textContent==="Reopen Development"');
      assert.equal(stopped, true);
      assert.equal(await inside('document.querySelector("#message").disabled'), true);
      assert.equal(await inside('document.querySelector("#send").disabled'), true);
      assert.equal(await inside('document.querySelector("#message").value'), "Keep this draft through narrow navigation.");
      const opensBeforeReopen = mutations.filter(item => item.path === "/api/development/open").length;
      await new Promise(done => setTimeout(done, 300));
      assert.equal(mutations.filter(item => item.path === "/api/development/open").length, opensBeforeReopen, "Close never auto-reopens during polling.");
      await click("#initialize", true);
      await waitInside('document.querySelector("#current-state").textContent.includes("Ready")');
      assert.equal(stopped, false); assert.equal(nativeRequests.length, 2, "Reopen does not replay conversation.");
      assert.deepEqual(browser.exceptions, []);
      t.diagnostic(JSON.stringify({ rootMutations: mutations.map(x => x.path), nativeRequests: nativeRequests.length,
        preservedIframe: frame.frame.id, widths: [1360, 980, 390], permissionWidths: [1360, 980, 920, 390],
        permissionCases: permissionIds.length, permissionFixture: process.env.TANDEM_PERMISSION_FIXTURE ?? "synthetic",
        independentDiscoveryAndNativeTargets: true }));
    } finally {
      for (const cleanup of cleanups) await cleanup();
      await provider.close(); events.close();
      await new Promise(done => { server.close(done); server.closeAllConnections(); });
      await getHostStateWal(root).close(); await rm(root, { recursive: true, force: true });
    }
  });
