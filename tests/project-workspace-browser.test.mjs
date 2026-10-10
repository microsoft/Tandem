import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { build } from "esbuild";
import { state as discoveryState } from "./helpers/react-harness.ts";
import { createHumanLoopProvider, HumanLoopEvents } from "../stage2/tandem/src/human-loop-provider.mjs";
import { createHumanLoopLedger, replayHumanLoopLedger } from "../stage2/tandem/runtime-src/domain/human-loop/ledger.ts";
import { DEFAULT_POLICY } from "../stage2/tandem/runtime-src/domain/workflow/policy.ts";
import { getHostStateWal } from "../stage2/tandem/runtime-src/domain/host-state-wal.ts";
import { browserAvailable, openFixtureBrowser } from "../stage2/tandem/test/helpers/browser-fixture.mjs";
import { JSDOM } from "jsdom";
import { installProjectPresentation } from "../stage2/tandem/public/project-presentation.js";
import { createConversationRenderer } from "../stage2/tandem/public/renderers/conversation.js";

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
    let nativeState = replayHumanLoopLedger(createHumanLoopLedger(owner, { revisionId: null, digest: null })).state;
    let active = false, stopped = false, installationStatus = "new";
    const value = discoveryState("requirements");
    value.requirements.substage = "usage";
    const runtime = {
      sessionId: "private", state: async () => nativeState,
      readiness: async () => ({ status: stopped ? "closed" : nativeState.activeRequestId ? "working" : "ready",
        workspacePath: root, reason: stopped ? "Closed; saved history retained. Reopen explicitly." : null }),
      conversation: async () => [], currentDesign: async () => ({ binding: { revisionId: null, digest: null }, content: null }),
      commands: { read: async () => ({ apps: [], commands: [] }) },
      modelSettings: async () => ({ models: [{ id: "fixture", name: "Fixture", supportedReasoningEfforts: ["low"] }],
        actual: "fixture", actualReasoningEffort: "low", desired: "fixture", canChange: true,
        canSetReasoningEffort: true, effortManaged: true, projectReasoningEffort: "low" }),
      async send(request) {
        nativeRequests.push(request);
        nativeState.requests.push({ ...request, status: "active", blockingAnswerRefs: [] });
        nativeState.activeRequestId = request.id; events.touch();
        if (request.answers) for (const question of nativeState.questions) {
          question.state = "answered"; question.answerRequestId = request.id; question.blockingActive = false;
        }
      },
      async stop(id, options) {
        mutations.push({ path: "native-stop", id, options });
        nativeState.activeRequestId = null;
        nativeState.requests.forEach(request => { request.status = "completed"; });
        events.touch();
      },
      async decideImplementation(input) {
        mutations.push({ path: "native-confirmation", ...input });
        nativeState.implementationConfirmations.find(item => item.id === input.confirmationId).status = input.decision;
        nativeState.activeRequestId = null; events.touch(); return {};
      },
    };
    let provider;
    const css = await readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
    const template = (await readFile(new URL("../src/renderer/index.html", import.meta.url), "utf8"))
      .replace("__TANDEM_STYLES__", () => css).replace("__TANDEM_VERSION__", "unified-fixture")
      .replace("<script>__TANDEM_CLIENT__</script>", '<script type="module" src="/app.js"></script>');
    const bundle = await build({ stdin: { contents: `
      import React from "react"; import {createRoot} from "react-dom/client";
      import {App} from "./app.js"; import {StudioStore} from "./state-store.js";
      const store = new StudioStore(); store.accept(await (await fetch("/api/state")).json());
      createRoot(document.getElementById("root")).render(React.createElement(App,{store,version:"unified-fixture",connect:false}));
      `, loader: "tsx", resolveDir: resolve("src", "renderer") },
      bundle: true, write: false, format: "esm", platform: "browser", target: "es2022", logLevel: "silent",
      loader: { ".png": "dataurl" },
      define: { "process.env.NODE_ENV": '"production"' } });
    const server = createServer(async (request, response) => {
      const path = new URL(request.url, "http://127.0.0.1").pathname;
      const json = data => { response.writeHead(200, { "Content-Type": "application/json" }); response.end(JSON.stringify(data)); };
      try {
        if (path === "/") { response.writeHead(200, { "Content-Type": "text/html" }); response.end(template); }
        else if (path === "/styles.css") { response.writeHead(200, { "Content-Type": "text/css" }); response.end(css); }
        else if (path === "/app.js") { response.writeHead(200, { "Content-Type": "text/javascript" }); response.end(bundle.outputFiles[0].text); }
        else if (path === "/api/state") json(value);
        else if (path === "/api/development/view") json({ url: provider.url, channel: "whole-project-fixture" });
        else if (path === "/api/settings/project-effort") json({ desired: "low", changing: false,
          stage1: { actual: "low", desired: "low", model: "fixture", status: "applied", supported: ["low"], error: null },
          stage2: { actual: null, desired: "low", model: null, status: "pending", supported: [], error: null } });
        else if (request.method === "POST") {
          const chunks = []; for await (const chunk of request) chunks.push(chunk);
          const body = JSON.parse(Buffer.concat(chunks).toString() || "{}"); mutations.push({ path, body });
          if (path === "/api/development/open") { active = true; stopped = false; installationStatus = "ready"; events.touch(); json({ url: provider.url }); }
          else if (path === "/api/answer") { value.requirements.usageItems.push(body.answer); value.revision++; json(value); }
          else { response.writeHead(404); response.end(); }
        } else { response.writeHead(404); response.end(); }
      } catch (error) { response.writeHead(500); response.end(JSON.stringify({ error: error.message })); }
    });
    await new Promise(done => server.listen(0, "127.0.0.1", done));
    const url = `http://127.0.0.1:${server.address().port}/`;
    provider = await createHumanLoopProvider({ repositoryRoot: root, publicDirectory: resolve("stage2", "tandem", "public"),
      surface: "browser", projectHost: { origin: new URL(url).origin, channel: "whole-project-fixture" }, events,
      getInstallation: () => ({ runtime: active ? runtime : null,
        close: async () => { stopped = true; installationStatus = "closed"; events.touch(); return {}; },
        read: async () => ({ status: installationStatus,
        canStart: !active, canReopen: stopped, reason: stopped ? "Closed; saved history retained." : null }) }),
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
      const click = async (selector, embedded = false) => {
        const evaluate = embedded ? inside : browser.evaluate;
        const local = await evaluate(`(() => {const e=document.querySelector(${JSON.stringify(selector)}); e.scrollIntoView({block:"nearest"});
          const r=e.getBoundingClientRect(); const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
          return {x:r.x+r.width/2,y:r.y+r.height/2,ok:r.width>0&&r.height>0&&(hit===e||e.contains(hit))&&!e.disabled};})()`);
        assert.ok(local.ok, `${selector} must be visible and hit-testable.`);
        const offset = embedded ? await browser.evaluate(`(() => {const e=document.querySelector("#project-conversation-frame");
          e.scrollIntoView({block:"nearest"}); const r=e.getBoundingClientRect(); return {x:r.x,y:r.y};})()`) : { x: 0, y: 0 };
        for (const type of ["mousePressed", "mouseReleased"]) await browser.call("Input.dispatchMouseEvent",
          { type, x: local.x + offset.x, y: local.y + offset.y, button: "left", clickCount: 1 });
      };
      await waitInside('document.querySelector("#project-message-target")?.options[0].textContent==="Add requirement usage"');
      await waitInside('document.querySelector("#current-state").textContent==="Development not activated"');
      assert.equal(await inside('document.querySelector("#current-state").textContent'), "Development not activated");
      await click("#project-message-target", true);
      await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      assert.equal(await browser.evaluate('document.querySelector("#project-effort-settings")===null'), true);
      await click("#project-settings");
      await waitInside('document.querySelector("#project-effort-status").textContent.includes("Stage 1: applied")');
      assert.equal(await inside('document.querySelectorAll("#project-effort").length'), 1);
      assert.equal(await inside('document.querySelector("#private-effort-setting").hidden'), true);
      assert.equal(active, false, "Opening shared Settings must not activate Development.");
      await click("#apply-project-effort", true);
      await waitInside('document.querySelector("#project-effort-settings").getAttribute("aria-busy")==="false"');
      assert.equal(active, false, "Saving future private effort must not activate Development.");
      await click("#close-settings", true);
      await waitInside('!document.querySelector("#canvas-settings").open');
      await browser.waitFor('document.activeElement.id==="project-settings"');
      assert.equal(active, false);
      await click("#message", true); await browser.call("Input.insertText", { text: "As a user, I keep my draft while viewing Design." });
      assert.equal(await inside('document.querySelector("#message").value'), "As a user, I keep my draft while viewing Design.");
      await click("#development-tab");
      await waitInside('document.body.dataset.projectDesign==="true"');
      assert.equal(await inside('document.querySelector("#message").value'), "As a user, I keep my draft while viewing Design.");
      assert.equal(await inside('document.querySelector("#project-message-target").value'), "discovery");
      assert.equal(active, false, "Browsing Design is not activation.");
      await click("#design-tree-tab");
      await waitInside('document.body.dataset.projectDesign==="false"');
      await click("#send", true);
      await waitInside('document.querySelector("#message").value===""');
      assert.equal(mutations.at(-1).path, "/api/answer");
      assert.equal(nativeRequests.length, 0);
      await waitInside('document.querySelector("#messages").textContent.includes("As a user, I keep my draft")');
      await click("#activate-project-development", true);
      await waitInside('document.querySelector("#project-message-target").value==="development" && !document.querySelector("#send").disabled');
      assert.equal(mutations.filter(x => x.path === "/api/development/open").length, 1);
      await click("#project-settings");
      await waitInside('document.querySelector("#canvas-settings").open');
      assert.equal(await inside("document.activeElement.id"), "setting-theme");
      assert.equal(await inside('document.querySelector("#setting-effort").disabled'), true);
      assert.equal(await inside('getComputedStyle(document.querySelector(".brand")).display'), "none");
      assert.equal(await inside('getComputedStyle(document.querySelector("#browser-session-guidance")).display'), "none");
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
      await click("#message", true); await browser.call("Input.insertText", { text: "Review current implementation without changes." });
      await click("#send", true);
      await waitInside('document.querySelector("#message").value===""');
      assert.equal(nativeRequests.length, 1); assert.match(nativeRequests[0].message, /Review current/);
      await waitInside('!document.querySelector("#stop-current-flow").disabled');
      await click("#stop-current-flow", true);
      await waitInside('document.querySelector("#stop-current-flow").disabled');
      assert.equal(mutations.filter(x => x.path === "native-stop").length, 1);
      const requestId = nativeRequests[0].id;
      nativeState.handoffs.push({ id: "handoff:question-result", presented: true,
        result: { resultId: "question-result", outcome: { kind: "designer-questions", summary: "Confirm scope." } } });
      nativeState.questions.push({ id: "scope-question", question: "Which scope should we retain?", context: "Saved project scope",
        whyItMatters: "Avoid unintended changes", importance: "blocking", options: [], allowFreeform: true,
        state: "open", blockingActive: true, source: { role: "designer", resultId: "question-result",
          requestId, requestIds: [requestId], cycleId: null, design: { revisionId: null, digest: null }, planDigest: null } });
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
      await click("#show-questions", true);
      nativeState.requests.at(-1).route = { resultId: "route-confirmation", outcome: { summary: "Implement the approved scope." } };
      nativeState.implementationConfirmations = [{ id: "confirmation-one", requestId: nativeRequests[1].id,
        requestIds: [nativeRequests[1].id], routeResultId: "route-confirmation", status: "pending",
        design: { revisionId: null, digest: null } }];
      accessRequests = [{ id: "permission-one", title: "Read project files", scopes: ["Purpose: Inspect the current source"], canApproveAll: false }];
      events.touch();
      await waitInside('Boolean(document.querySelector("[data-access-decision=denied]"))');
      await click('[data-access-decision="denied"]', true);
      await waitInside('!document.querySelector("[data-request-id=permission-one]")');
      assert.deepEqual(mutations.find(x => x.path === "native-consent"),
        { path: "native-consent", id: "permission-one", decision: "denied", sessionId: "private" });
      await waitInside('Boolean(document.querySelector("[data-implementation-decision=cancelled]:not(:disabled)"))');
      await click('[data-implementation-decision="cancelled"]', true);
      await waitInside('document.querySelector(".implementation-confirmation").textContent.includes("Implementation declined")');
      assert.equal(mutations.find(x => x.path === "native-confirmation").confirmationId, "confirmation-one");
      for (const width of [980, 390, 1360]) {
        await browser.call("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: width < 600 });
        assert.equal(await browser.evaluate("innerWidth"), width, "Exercise the real CSS viewport, not mobile page scaling.");
        await click("#development-tab");
        await waitInside('document.body.dataset.projectDesign==="true"');
        assert.equal(await browser.evaluate('document.querySelectorAll("#project-conversation-frame").length'), 1);
        assert.equal(await inside('document.documentElement.scrollWidth<=innerWidth+1'), true, `No embedded overflow at ${width}.`);
        await click("#message", true);
        if (width === 980) await browser.call("Input.insertText", { text: "Keep this draft through narrow navigation." });
        assert.equal(await inside('document.querySelector("#message").value'), "Keep this draft through narrow navigation.");
        await click("#project-message-target", true);
        await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        if (process.env.TANDEM_UI_EVIDENCE) await writeFile(join(process.env.TANDEM_UI_EVIDENCE, `project-workspace-${width}.png`), await browser.screenshot());
      }
      await click("#project-settings");
      await waitInside('document.querySelector("#canvas-settings").open');
      await click("#open-diagnostics", true);
      await click("#shutdown", true);
      await waitInside('document.querySelector("#initialize").textContent==="Reopen runtime"');
      assert.equal(stopped, true);
      await click("#initialize", true);
      await waitInside('document.querySelector("#current-state").textContent.includes("Ready")');
      assert.equal(stopped, false); assert.equal(nativeRequests.length, 2, "Reopen does not replay conversation.");
      assert.deepEqual(browser.exceptions, []);
      t.diagnostic(JSON.stringify({ rootMutations: mutations.map(x => x.path), nativeRequests: nativeRequests.length,
        preservedIframe: frame.frame.id, widths: [1360, 980, 390], independentDiscoveryAndNativeTargets: true }));
    } finally {
      for (const cleanup of cleanups) await cleanup();
      await provider.close(); events.close();
      await new Promise(done => { server.close(done); server.closeAllConnections(); });
      await getHostStateWal(root).close(); await rm(root, { recursive: true, force: true });
    }
  });
