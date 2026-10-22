import assert from "node:assert/strict";
import test from "node:test";
import { projectHumanLoopView } from "../development/tandem/src/human-loop-provider.mjs";
import { createHumanLoop } from "../development/tandem/runtime-src/domain/human-loop/model.ts";
import { DEFAULT_POLICY } from "../development/tandem/runtime-src/domain/workflow/policy.ts";
import { currentHandoffActivity, handoffProgress, quietHandoff, validHandoffActivity } from "../development/tandem/public/handoff-presentation.js";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import { state as rootState } from "./helpers/react-harness.ts";
import { createHumanLoopProvider, HumanLoopEvents } from "../development/tandem/src/human-loop-provider.mjs";
import { getHostStateWal } from "../development/tandem/runtime-src/domain/host-state-wal.ts";
import { sharedDesignExampleV3 } from "../development/tandem/test/helpers/shared-design-fixture.mjs";
import { browserAvailable, openFixtureBrowser } from "../development/tandem/test/helpers/browser-fixture.mjs";
import { exerciseLatestNavigation } from "./helpers/latest-navigation-browser.mjs";
import { exerciseRoleHintDraft } from "../development/tandem/test/helpers/role-hint-browser.mjs";
import { exerciseDevelopmentChrome } from "./helpers/development-chrome-browser.mjs";
import { developmentStatus, validDevelopmentStatus } from "../development/tandem/public/development-status.js";

const requestId = `handoff-${"a".repeat(64)}`;
const nextRequestId = `handoff-${"b".repeat(64)}`;
const binding = { revisionId: "published-design", digest: "c".repeat(64) };
const previous = { revisionId: "previous-design", digest: "d".repeat(64) };

test("Development status prioritizes required decisions and exact current activity over acknowledgments", () => {
  const snapshot = { conversationStatus: "verified", installation: { status: "ready" }, accessRequests: [],
    workflow: { status: "ready", activeRequestId: null, activeRole: null, activeCondition: null } };
  const acknowledgement = { text: "Request received; awaiting workflow activity.", requestId: "new-request" };
  assert.equal(developmentStatus(snapshot).text, "Ready");
  assert.equal(developmentStatus(snapshot, acknowledgement).kind, "acknowledgement");
  Object.assign(snapshot.workflow, { status: "working", activeRequestId: "actual-request", activeRole: "designer", activeCondition: "queued" });
  assert.deepEqual(developmentStatus(snapshot, acknowledgement), { kind: "active", text: "Request awaiting role dispatch", requestId: "actual-request" });
  snapshot.workflow.activeCondition = "running";
  assert.equal(developmentStatus(snapshot, acknowledgement).text, "Designer working...");
  snapshot.workflow.compaction = { requested: true };
  assert.equal(developmentStatus(snapshot, acknowledgement).text, "Compaction requested");
  snapshot.workflow.compaction.active = true;
  assert.equal(developmentStatus(snapshot, acknowledgement).text, "Compacting context...");
  snapshot.accessRequests = [{ id: "permission" }];
  assert.equal(developmentStatus(snapshot, acknowledgement).text, "Permission response needed");
  snapshot.accessRequests = []; snapshot.workflow.questionCounts = { unanswered: 1, blockers: 1 };
  assert.equal(developmentStatus(snapshot, acknowledgement).text, "Questions need your answer");
  snapshot.workflow.questionCounts.blockers = 0;
  assert.equal(developmentStatus(snapshot, acknowledgement).text, "Compacting context...", "Advisory historical questions do not override current activity.");
  snapshot.workflow.questionCounts.unanswered = 0;
  snapshot.workflow.implementationConfirmations = [{ status: "pending" }];
  assert.equal(developmentStatus(snapshot, acknowledgement).text, "Implementation confirmation needed");
  snapshot.workflow.implementationConfirmations = []; snapshot.workflow.reason = "Exact recovery diagnosis";
  assert.equal(developmentStatus(snapshot, acknowledgement).text, "Development needs attention");
  snapshot.conversationStatus = "unverified";
  assert.equal(developmentStatus(snapshot, acknowledgement).text, "Connecting to Development...");
  assert.equal(validDevelopmentStatus(developmentStatus(snapshot)), true);
  assert.equal(validDevelopmentStatus({ kind: "active", text: "Pretend", requestId: {} }), false);
});

export function handoffFixture(kind = "designer-changed") {
  const state = createHumanLoop({ schemaVersion: "human-loop-owner/v1", id: "owner", mainSessionId: "main",
    privateSessionId: "private", workspacePath: process.cwd(), policy: DEFAULT_POLICY }, binding);
  const request = { id: requestId, message: "Saved Prototype", status: "completed", answers: null, receivedAt: "2026-10-15T00:00:00Z",
    blockingAnswerRefs: [], questionGatesReleased: false, route: null, stopId: null };
  const result = { resultId: "design-result", outcome: { kind, summary: "Synthetic published Design", questions: [] } };
  const execution = { binding: { requestId, role: "designer", design: kind === "designer-changed" ? previous : binding },
    completion: "result-submission", result };
  state.requests.push(request); state.executions.push(execution);
  state.handoffs.push({ id: "handoff:design-result", requestId, requestIds: [requestId], result, presented: true });
  const design = { binding, content: { summary: "Synthetic Design" }, publication: { requestId, previous } };
  const readiness = { status: "ready", reason: null };
  return { state, request, result, execution, design, readiness };
}

function reviseDesign(f) {
  const requestId = "later-design-request";
  const before = f.design.binding;
  const result = { resultId: "later-design-result", outcome: { kind: "designer-changed", summary: "Later requested refinement", questions: [] } };
  f.state.requests.push({ ...f.request, id: requestId });
  f.state.executions.push({ binding: { requestId, role: "designer", design: before }, completion: "result-submission", result });
  f.state.handoffs.push({ id: "handoff:later-design-result", requestId, requestIds: [requestId], result, presented: true });
  f.state.design = { revisionId: "later-design", digest: "e".repeat(64) };
  f.design = { ...f.design, binding: f.state.design, publication: { requestId, previous: before } };
}

test("handoff completion is quiet only for its verified published or unchanged current Design", () => {
  for (const kind of ["designer-changed", "designer-unchanged"]) {
    const f = handoffFixture(kind);
    const read = () => projectHumanLoopView(f.state, f.readiness, f.design).handoffActivity[0];
    const before = structuredClone(f);
    assert.deepEqual(read().quietDesign, binding);
    assert.equal(quietHandoff(read(), binding), true);
    assert.equal(quietHandoff(read(), binding, 1), false, "Permission remains visible.");
    assert.equal(quietHandoff(read(), previous), false, "A visible unrelated Design is not enough.");
    assert.equal(quietHandoff(read(), { ...binding, digest: previous.digest }), false);
    assert.deepEqual(read(), read(), "Polling does not change presentation.");
    assert.deepEqual(projectHumanLoopView(structuredClone(f.state), f.readiness, f.design).handoffActivity[0], read(), "Reopen uses saved evidence, not transient UI state.");
    assert.deepEqual(f, before, "Projection cannot rewrite requests, receipts or history.");
    for (const change of [
      f => { f.design.content = null; },
      f => { f.design.binding = previous; },
      f => { f.state.design = previous; },
      f => { f.state.executions = []; },
      f => { delete f.execution.completion; },
      f => { f.execution.result = { ...f.result, resultId: "foreign-result" }; },
      f => { f.execution.binding.requestId = nextRequestId; },
      f => { f.state.handoffs[0].presented = false; },
      f => { f.state.activeRequestId = requestId; f.state.activeBatchRequestIds = [requestId]; },
      f => { f.state.stop = { id: "stopped" }; },
      f => { f.state.uncertainty = { reason: "Unverified", evidenceRef: "fixture" }; },
      ...["waiting", "active", "handoff-pending", "rejected", "retired", "stopped", "cancelled", "discarded"].map(status => f => { f.request.status = status; }),
      ...["working", "waiting-answer", "execution-unknown", "stopping", "presentation-pending", "failed"].map(status => f => { f.readiness.status = status; }),
      ...["agent-answer", "execution-failure", "review-result"].map(kind => f => { f.result.outcome.kind = kind; }),
    ]) {
      const changed = handoffFixture(kind); change(changed);
      assert.equal(projectHumanLoopView(changed.state, changed.readiness, changed.design).handoffActivity[0].quietDesign, null);
    }
  }
  for (const change of [
    f => { delete f.design.publication; },
    f => { f.design.publication.requestId = nextRequestId; },
    f => { f.design.publication.previous = binding; },
    f => { f.state.handoffs.push({ requestIds: [nextRequestId], presented: true, result: { resultId: "newer", outcome: { kind: "designer-changed" } } }); },
  ]) {
    const f = handoffFixture(); change(f);
    assert.equal(projectHumanLoopView(f.state, f.readiness, f.design).handoffActivity[0].quietDesign, null);
  }
});

test("completed changed and unchanged handoffs remain quiet after a later verified Design and reopen", () => {
  for (const kind of ["designer-changed", "designer-unchanged"]) {
    const f = handoffFixture(kind);
    assert.equal(quietHandoff(projectHumanLoopView(f.state, f.readiness, f.design).handoffActivity[0], binding), true);
    reviseDesign(f);
    const retained = structuredClone(f);
    for (const status of ["ready", "closed"]) {
      const activity = projectHumanLoopView(structuredClone(f.state), { status }, f.design).handoffActivity[0];
      assert.deepEqual(activity.quietDesign, f.design.binding);
      assert.equal(quietHandoff(activity, f.design.binding), true);
      assert.doesNotMatch(activity.label, /Implementation has not been authorized/);
      assert.equal(quietHandoff(activity, binding), false, "A stale displayed snapshot is still unverified.");
      assert.equal(quietHandoff(activity, f.design.binding, 1), false);
    }
    assert.deepEqual(f, retained, "No stored request, publication or completion state is changed.");
    const working = structuredClone(f);
    working.state.activeRequestId = "later-implementation-request";
    working.state.activeBatchRequestIds = [working.state.activeRequestId];
    assert.equal(quietHandoff(projectHumanLoopView(working.state, { status: "working" }, working.design).handoffActivity[0], working.design.binding), true,
      "Later active work must not revive the old successful handoff strip.");
    for (const change of [
      f => { f.state.handoffs.at(-1).presented = false; },
      f => { f.design.publication.requestId = "unrelated"; },
      f => { delete f.state.executions.at(-1).completion; },
      f => { delete f.execution.completion; },
      f => { f.state.uncertainty = { reason: "Unknown", evidenceRef: "fixture" }; },
    ]) {
      const changed = structuredClone(f); change(changed);
      assert.equal(projectHumanLoopView(changed.state, changed.readiness, changed.design).handoffActivity[0].quietDesign, null);
    }
  }
});

  test("actual root and private UI show zero completed banners and one owned active status without resetting Design or drafts",
    { skip: !browserAvailable, timeout: 90_000 }, async t => {
      const root = await mkdtemp(join(tmpdir(), "handoff-presentation-"));
      const f = handoffFixture(), events = new HumanLoopEvents(), rootEvents = new Set(), mutations = [], cleanups = [];
      const extraEntries = [];
      const receivedRequests = [];
      let accessRequests = [];
      f.state.owner.workspacePath = root;
      f.design.content = sharedDesignExampleV3();
      f.design.content.artifacts.unshift({ schemaVersion: "artifact/v1", id: "checkout-ui", title: "Checkout",
        category: "ui", format: "html", width: 640, height: 360, description: "Synthetic checkout screen.",
        source: '<div style="padding:24px;background:#f5f8ff"><h2>Checkout</h2><p>Your bag</p><button>Continue</button></div>' });
      let installationStatus = "ready";
      let releaseReceipt, receiptGate = new Promise(resolve => { releaseReceipt = resolve; });
      let releasePrivate;
      const privateGate = new Promise(resolve => { releasePrivate = resolve; });
      const receiptMessage = "Synthetic exact admission message";
      let receiptFailure = false;
      const value = rootState("development");
      const snapshotPath = ".tandem/efforts/fixture/stages/prototype-r7.json";
      value.lifecycle.outputs = [{ stageId: "prototype", path: snapshotPath, completedAt: value.updatedAt }];
      value.development = { handoffId: requestId, requestId, snapshotPath };
      const runtime = { sessionId: "private", state: async () => { await privateGate; return structuredClone(f.state); }, readiness: async () => f.readiness,
        send: async request => { receivedRequests.push(request); },
        currentDesign: async () => f.design, commands: { read: async () => ({ apps: [], commands: [] }) },
        conversation: async () => [{ id: "handoff:design-result", kind: "assistant", role: "designer", requestId,
          content: f.result.outcome.summary, timestamp: "2026-10-15T00:00:01Z" }, ...extraEntries],
        transport: { attachmentCapabilities: async () => ({ supported: false, limits: { maxBytes: 0, maxImages: 0 } }) },
        modelSettings: async () => ({ models: [], actual: null, canChange: false }),
      };
      let client, css, providerFactory = createHumanLoopProvider, closeWal = getHostStateWal;
      let publicDirectory = resolve("development", "tandem", "public");
      if (process.env.TANDEM_PACKAGED_EXTENSION) {
        const file = process.env.TANDEM_PACKAGED_EXTENSION, packaged = await readFile(file, "utf8");
        const extract = (marker, variable) => {
          const start = packaged.indexOf(`// ${marker}\n`), end = packaged.indexOf("\n// ", start + 3);
          assert.ok(start >= 0 && end > start);
          return runInNewContext(`${packaged.slice(start, end)}\n${variable}`, {}, { timeout: 1000 });
        };
        client = extract("tandem-client:main.tsx", "main_default"); css = extract("tandem-styles:styles.css", "styles_default");
        const stage2 = join(dirname(file), "stage2");
        ({ createHumanLoopProvider: providerFactory } = await import(pathToFileURL(join(stage2, "src", "human-loop-provider.mjs")).href));
        ({ getHostStateWal: closeWal } = await import(pathToFileURL(join(stage2, "runtime-src", "domain", "host-state-wal.ts")).href));
        publicDirectory = join(stage2, "public");
        t.diagnostic(`Actual root bundle and private provider/assets from ${file}; synthetic state, no model or native work.`);
      } else {
        client = (await build({ entryPoints: ["src/renderer/main.tsx"], bundle: true, write: false, format: "iife",
          platform: "browser", loader: { ".png": "dataurl" }, define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent" })).outputFiles[0].text;
        css = (await build({ entryPoints: ["src/renderer/styles.css"], bundle: true, write: false, logLevel: "silent" })).outputFiles[0].text;
      }
      const html = (await readFile(new URL("../src/renderer/index.html", import.meta.url), "utf8"))
        .replace("__TANDEM_STYLES__", () => css).replace("__TANDEM_VERSION__", "synthetic")
        .replace("__TANDEM_CLIENT__", () => client);
      let composed, standalone;
      const server = createServer(async (request, response) => {
        const path = new URL(request.url, "http://127.0.0.1").pathname;
        const json = data => { response.writeHead(200, { "Content-Type": "application/json" }); response.end(JSON.stringify(data)); };
        if (path === "/") { response.writeHead(200, { "Content-Type": "text/html" }); response.end(html); }
        else if (path === "/favicon.ico") { response.writeHead(204); response.end(); }
        else if (path === "/api/state") json(value);
        else if (path === "/events") {
          response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
          rootEvents.add(response); response.write(`data: ${JSON.stringify(value)}\n\n`);
          request.on("close", () => rootEvents.delete(response));
        } else if (path === "/api/project-entry") json({ projectPath: root, startingPath: "development" });
        else if (path === "/api/project-entry/open") json({ developmentContext: true, developmentStarted: false });
        else if (path === "/api/settings/project-effort") json({ desired: null, changing: false,
          stage1: { desired: null, actual: null, model: null, supported: [], status: "pending", error: null },
          stage2: { desired: null, actual: null, model: null, supported: [], status: "pending", error: null } });
        else if (path === "/api/development/preflight") json({ status: "ready", projectPath: root, initialize: false, message: "Synthetic Git preflight" });
        else if (path === "/api/development/view") json({ url: composed.url, channel: "handoff-fixture" });
        else if (path === "/api/development/handoff") {
          await receiptGate;
          if (receiptFailure) { response.writeHead(503, { "Content-Type": "application/json" }); response.end(JSON.stringify({ error: "Synthetic receipt unavailable" })); return; }
          json({ generation: value.generation,
          snapshotPath: value.development.snapshotPath, handoffId: value.development.handoffId,
          admission: { status: "admitted", handoffId: value.development.handoffId, requestId: value.development.requestId, message: receiptMessage } });
        }
        else if (path === "/api/sketch") json({ sketch: value.sketch, document: null });
        else { mutations.push({ path, method: request.method }); response.writeHead(404); response.end(); }
      });
      await new Promise(done => server.listen(0, "127.0.0.1", done));
      const url = `http://127.0.0.1:${server.address().port}/`;
      const options = { repositoryRoot: root, publicDirectory, surface: "browser", events,
        getInstallation: () => ({ runtime, read: async () => ({ status: installationStatus, reason: null }) }),
        permissions: { list: () => accessRequests, decide: async id => { accessRequests = accessRequests.filter(item => item.id !== id); } } };
      try {
        composed = await providerFactory({ ...options, projectHost: { origin: new URL(url).origin, channel: "handoff-fixture" } });
        standalone = await providerFactory(options);
        const browser = await openFixtureBrowser({ after: cleanup => cleanups.push(cleanup) });
        await browser.call("Page.addScriptToEvaluateOnNewDocument", { source: `{
          const EventSource = window.EventSource;
          window.EventSource = class extends EventSource {
            constructor(...args) { super(...args); document.addEventListener("fixture-stream-error", () => this.dispatchEvent(new Event("error"))); }
          };
        }` });
        const contexts = new Map();
        const navigating = error => ["Inspected target navigated or closed", "Cannot find context with specified id"].includes(error.message);
        const waitReload = async expression => {
          for (let attempt = 0; attempt < 150; attempt++) {
            try { if (await browser.evaluate(expression)) return; }
            catch (error) { if (!navigating(error)) throw error; }
            await new Promise(done => setTimeout(done, 30));
          }
          assert.fail(`Reload did not settle: ${expression}`);
        };
        const evaluatePrivate = async expression => {
          const tree = await browser.call("Page.getFrameTree");
          const frame = tree.frameTree.childFrames?.find(item => item.frame.url.startsWith(composed.url))?.frame;
          if (!frame) return null;
          try {
            if (!contexts.has(frame.id)) contexts.set(frame.id, (await browser.call("Page.createIsolatedWorld",
              { frameId: frame.id, worldName: "handoff-regression" })).executionContextId);
            const result = await browser.call("Runtime.evaluate", { contextId: contexts.get(frame.id), expression, returnByValue: true });
            if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
            return result.result.value;
          } catch (error) {
            if (!navigating(error)) throw error;
            contexts.delete(frame.id);
            return null;
          }
        };
        const waitPrivate = async expression => {
          for (let attempt = 0; attempt < 150; attempt++) {
            if (await evaluatePrivate(expression)) return;
            await new Promise(done => setTimeout(done, 30));
          }
          assert.fail(`Private UI did not settle: ${expression}\n${JSON.stringify(await evaluatePrivate(`({
            scroll:["messages","state-history"].map(id=>{const e=document.getElementById(id);return {id,top:e.scrollTop,height:e.scrollHeight,viewport:e.clientHeight}}),
            focus:document.activeElement?.outerHTML.slice(0,200),latest:document.querySelector("#newer").outerHTML
          })`))}`);
        };
        const push = async () => {
          value.revision++;
          for (const response of rootEvents) response.write(`data: ${JSON.stringify(value)}\n\n`);
          events.touch();
          await browser.evaluate("new Promise(resolve => setTimeout(resolve, 150))");
        };
        const visibleRootStatuses = '[...document.querySelectorAll(".development-handoff-status [role=status]")].filter(e=>e.checkVisibility())';
        const bottom = 'document.querySelector("#next-action-guide")?.textContent';
        const geometry = `["project-conversation-frame","studio-workspace"].map(id=>{const r=document.getElementById(id).getBoundingClientRect();return {id,top:r.top,height:r.height}})`;
        const privateGeometry = `["design-panel","conversation-panel","canvas-scroll","backbone-proposal","messages"].map(id=>{const r=document.getElementById(id).getBoundingClientRect();return {id,top:r.top,height:r.height}})`;
        await browser.call("Page.navigate", { url });
        await browser.waitFor('!!document.querySelector("#project-conversation-frame")');
        await browser.waitFor(`${bottom}==="Checking saved handoff..."`);
        await waitPrivate('!!document.querySelector("#design-panel")');
        const cold = await browser.evaluate(geometry);
        releaseReceipt();
        await browser.waitFor(`${bottom}==="Waiting for verified Development activity..."`);
        assert.deepEqual(await browser.evaluate(geometry), cold, "Waiting for private status cannot move the workspace.");
        releasePrivate();
        await waitPrivate('document.querySelector("#backbone-state").textContent==="Current Design"');
        await browser.waitFor(`${bottom}==="Ready"`);
        assert.deepEqual(await browser.evaluate(geometry), cold, "Delayed receipt cannot move the workspace.");
        const addQuickRequest = () => evaluatePrivate('document.querySelector("#quick-requests").open=true; document.querySelector("[data-quick-request]").click()');
        await addQuickRequest();
        await browser.waitFor(`${bottom}==="Request added to draft; not sent."`);
        assert.equal(await evaluatePrivate('document.querySelector("#notice").hidden'), true);
        assert.equal(await evaluatePrivate('document.querySelector("#current-state-title").checkVisibility()'), false);
        await evaluatePrivate('document.querySelector("#message").value=""; document.querySelector("#message").dispatchEvent(new Event("input",{bubbles:true}))');
        await browser.waitFor(`${bottom}==="Ready"`);
        await addQuickRequest();
        await browser.waitFor(`${bottom}==="Request added to draft; not sent."`);
        await evaluatePrivate('document.querySelector("#composer").requestSubmit()');
        await browser.waitFor(`${bottom}==="Request received; awaiting workflow activity."`);
        assert.equal(receivedRequests.length, 1);
        assert.equal(await evaluatePrivate('document.querySelector("#notice").hidden'), true);
        const originalGeneration = value.generation;
        value.generation = "new-status-generation"; await push();
        await browser.waitFor(`${bottom}==="Ready"`);
        value.generation = originalGeneration; await push();
        await browser.waitFor(`${bottom}==="Ready"`);
        accessRequests = [{ id: "status-permission", title: "Synthetic status permission", scopes: ["Read fixture only"], description: "Fixture", canApproveAll: false }];
        await push();
        await browser.waitFor(`${bottom}==="Permission response needed"`);
        await evaluatePrivate('document.querySelector("[data-access-decision=once]").click()');
        await browser.waitFor(`${bottom}==="Permission response saved."`);
        assert.equal(accessRequests.length, 0);
        await evaluatePrivate('document.querySelector("#message").dispatchEvent(new Event("input",{bubbles:true}))');
        await browser.waitFor(`${bottom}==="Ready"`);
        await browser.waitFor(`${visibleRootStatuses}.length===0`);
        await waitPrivate('document.querySelector("#backbone-state").textContent==="Current Design"');
        assert.equal(await evaluatePrivate('document.querySelector("#prototype-handoff-activity").getBoundingClientRect().height'), 0);
        assert.equal(await browser.evaluate('document.querySelector("#development-panel .development-handoff-status")'), null);
        const checkEmptyChrome = async () => {
          for (const [width, height] of [[1280, 800], [1280, 520], [390, 520]]) {
            await browser.call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
            assert.equal(await browser.evaluate('document.querySelector(".development-workspace").getBoundingClientRect().height'), 0);
            assert.equal(await browser.evaluate('document.querySelector("#development-panel").getBoundingClientRect().height'), 0);
            assert.equal(await browser.evaluate('document.querySelector(".development-provenance")'), null);
            assert.equal(await evaluatePrivate('document.querySelector("#prototype-handoff-activity").getBoundingClientRect().height'), 0);
            assert.equal(await browser.evaluate("document.documentElement.scrollWidth<=innerWidth+1"), true);
          }
        };
        await checkEmptyChrome();
        await exerciseDevelopmentChrome({ browser, evaluate: evaluatePrivate, waitFor: waitPrivate, diagnostic: text => t.diagnostic(text),
          baselineCss: process.env.TANDEM_BASELINE_SHELL_CSS ? await readFile(process.env.TANDEM_BASELINE_SHELL_CSS, "utf8") : null,
          baselineProjectCss: process.env.TANDEM_BASELINE_PROJECT_CSS ? await readFile(process.env.TANDEM_BASELINE_PROJECT_CSS, "utf8") : null });
        await exerciseRoleHintDraft({ browser, evaluate: evaluatePrivate,
          click: selector => evaluatePrivate(`{const e=document.querySelector(${JSON.stringify(selector)});if(e.matches("textarea")) e.focus();e.click()}`) });
        await evaluatePrivate('window.retainedDesign=document.querySelector("#backbone-proposal"); document.querySelector("#message").value="Retained unsent draft"; document.querySelector("#message").dispatchEvent(new Event("input",{bubbles:true}))');
        for (let poll = 0; poll < 3; poll++) await push();
        assert.equal(await browser.evaluate(`${visibleRootStatuses}.length`), 0);
        reviseDesign(f); await push();
        await waitPrivate('document.querySelector("#backbone-state").textContent==="Current Design"');
        await browser.waitFor(`${visibleRootStatuses}.length===0`);
        await checkEmptyChrome();
        assert.equal(await browser.evaluate('document.querySelector("#acceptance-delivery, .process-dialog")'), null);
        assert.equal(f.state.requests.some(request => request.id === requestId), true);
        await checkEmptyChrome();
        f.state.questions.push({ id: "choice", context: "Synthetic behavior", question: "Keep the count?", whyItMatters: "Scope",
          importance: "blocking", options: [], allowFreeform: true, state: "open", answerRequestId: null, blockingActive: true,
          source: { role: "designer", resultId: f.result.resultId, requestId, requestIds: [requestId], cycleId: null,
            design: binding, planDigest: null } });
        await push();
        await waitPrivate('document.querySelector("#prototype-handoff-activity").textContent.includes("Questions: 1")');
        assert.equal(await browser.evaluate(`${visibleRootStatuses}.length`), 0);
        assert.equal(await evaluatePrivate('document.querySelector("#show-questions").disabled'), false);
        f.state.questions = [];
        const next = { ...f.request, id: nextRequestId, status: "active" };
        f.state.requests.push(next); f.state.activeRequestId = nextRequestId; f.state.activeBatchRequestIds = [nextRequestId];
        f.state.activeTask = { binding: { requestId: nextRequestId, role: "designer" }, condition: "running" };
        f.readiness.status = "working";
        value.lifecycle.outputs[0].path = ".tandem/efforts/fixture/stages/prototype-r8.json";
        value.development = { handoffId: nextRequestId, requestId: nextRequestId, snapshotPath: value.lifecycle.outputs[0].path };
        await push();
        t.diagnostic(`Active transition: ${await browser.evaluate(bottom)} / ${await evaluatePrivate('document.querySelector("#current-state-title").textContent')}`);
        await browser.waitFor(`${bottom}==="Designer working..."`);
        const beforeReconnect = await browser.evaluate(geometry);
        await evaluatePrivate('document.dispatchEvent(new Event("fixture-stream-error"))');
        await browser.waitFor(`${bottom}==="Reconnecting to Development..."`);
        assert.deepEqual(await browser.evaluate(geometry), beforeReconnect);
        events.touch();
        await browser.waitFor(`${bottom}==="Designer working..."`);
        assert.deepEqual(await browser.evaluate(geometry), beforeReconnect);
        await addQuickRequest();
        assert.equal(await browser.evaluate(bottom), "Designer working...", "Draft acknowledgment cannot mask actual role activity.");
        await evaluatePrivate('document.querySelector("#composer").requestSubmit()');
        await waitPrivate('document.querySelector("#message").value===""');
        assert.equal(await browser.evaluate(bottom), "Designer working...", "Receipt of a queued request cannot replace the actual running role.");
        await evaluatePrivate('document.querySelector("#message").value="Retained unsent draft"; document.querySelector("#message").dispatchEvent(new Event("input",{bubbles:true}))');
        value.status = receiptMessage; await push();
        assert.equal(await browser.evaluate(bottom), "Designer working...", "Only the exact receipt-owned root message yields to current progress.");
        value.status = "Synthetic unrelated operation needs attention"; await push();
        assert.equal(await browser.evaluate(bottom), value.status, "Unknown current operation text must not be classified or overwritten.");
        value.status = receiptMessage; await push();
        f.readiness.compaction = { active: true };
        await push();
        await waitPrivate('document.querySelector("#current-state-title").textContent.includes("Compacting")');
        assert.equal(await browser.evaluate(bottom), "Compacting context...", "Private compaction has priority over routine handoff progress.");
        f.readiness.compaction = undefined; await push();
        await browser.waitFor(`${bottom}==="Designer working..."`);
        await waitPrivate('document.querySelector("#prototype-handoff-activity").hidden');
        for (const [width, height] of [[1280, 800], [390, 520]]) {
          await browser.call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
          assert.equal(await browser.evaluate(`${visibleRootStatuses}.length`), 0);
          assert.equal(await browser.evaluate(bottom), "Designer working...");
          assert.equal(await evaluatePrivate('document.querySelector("#prototype-handoff-activity").getBoundingClientRect().height'), 0);
          assert.equal(await browser.evaluate("document.documentElement.scrollWidth<=innerWidth+1"), true);
          assert.equal(await evaluatePrivate('document.querySelector("#message").value'), "Retained unsent draft");
          assert.equal(await evaluatePrivate('document.querySelector("#backbone-proposal")===window.retainedDesign'), true);
        }
        f.state.activeTask.condition = "waiting-permission"; await push();
        await waitPrivate('document.querySelector("#prototype-handoff-activity").textContent.includes("waiting for native permission")');
        assert.notEqual(await browser.evaluate(bottom), "Designer working...");
        f.readiness.status = "execution-unknown"; f.readiness.reason = "Synthetic execution uncertain"; await push();
        await browser.waitFor(`${bottom}==="Development needs attention"`);
        next.status = "rejected"; f.state.activeRequestId = null; f.state.activeBatchRequestIds = []; f.state.activeTask = null;
        f.readiness.status = "ready"; f.readiness.reason = null; await push();
        await waitPrivate('document.querySelector("#prototype-handoff-activity").textContent.includes("rejected")');
        installationStatus = "unknown"; await push();
        await browser.waitFor(`${bottom}==="Connecting to Development..."`);
        await waitPrivate('document.querySelector("#backbone-state").textContent==="Design unverified"');
        installationStatus = "ready";
        // Reopen the successful exact source; the newer rejected request cannot lend completion evidence.
        f.state.requests = f.state.requests.filter(request => request.id !== nextRequestId); value.lifecycle.outputs[0].path = snapshotPath;
        value.development = { handoffId: requestId, requestId, snapshotPath }; await push();
        await browser.waitFor(`${visibleRootStatuses}.length===0`);
        await checkEmptyChrome();
        for (const [width, height] of [[1360, 800], [920, 800], [390, 800], [1360, 480]]) {
          await browser.call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
          receiptGate = new Promise(resolve => { releaseReceipt = resolve; });
          await browser.call("Page.reload"); contexts.clear();
          await waitReload(`${bottom}===${JSON.stringify(receiptMessage)}`);
          await waitPrivate('document.querySelector("#backbone-state").textContent==="Current Design"');
          await browser.evaluate("new Promise(resolve=>setTimeout(resolve,200))");
          const before = await browser.evaluate(geometry), privateBefore = await evaluatePrivate(privateGeometry);
          assert.deepEqual(await browser.evaluate(geometry), before);
          f.state.activeRequestId = requestId; f.state.activeBatchRequestIds = [requestId]; f.request.status = "active";
          f.state.activeTask = { binding: { requestId, role: "designer" }, condition: "running" }; f.readiness.status = "working";
          releaseReceipt(); events.touch();
          await browser.waitFor(`${bottom}==="Designer working..."`);
          assert.deepEqual(await browser.evaluate(geometry), before);
          assert.deepEqual(await evaluatePrivate(privateGeometry), privateBefore);
          assert.equal(await evaluatePrivate('document.querySelector("#prototype-handoff-activity").hidden'), true);
          assert.equal(await evaluatePrivate('document.querySelector("#current-state-title").checkVisibility()'), false);
          for (let poll = 0; poll < 2; poll++) await push();
          assert.equal(await browser.evaluate(bottom), "Designer working...");
          f.state.activeRequestId = null; f.state.activeBatchRequestIds = []; f.state.activeTask = null;
          f.request.status = "completed"; f.readiness.status = "ready"; events.touch();
          await browser.waitFor(`${bottom}==="Ready"`);
          assert.deepEqual(await browser.evaluate(geometry), before);
          assert.deepEqual(await evaluatePrivate(privateGeometry), privateBefore);
          assert.equal(await browser.evaluate('document.querySelector("#next-action-guide").getAttribute("role")'), "status");
          f.state.activeRequestId = "unrelated-current-work"; f.state.activeBatchRequestIds = [f.state.activeRequestId];
          f.state.activeTask = { binding: { requestId: f.state.activeRequestId, role: "implementer" }, condition: "running" };
          f.readiness.status = "working"; events.touch();
          await browser.waitFor(`${bottom}==="Implementer working..."`);
          assert.equal(await browser.evaluate(bottom), "Implementer working...", "Historical handoff must not compete with unrelated ongoing work.");
          assert.deepEqual(await browser.evaluate(geometry), before);
          f.state.activeRequestId = null; f.state.activeBatchRequestIds = []; f.state.activeTask = null;
          f.readiness.status = "ready"; events.touch();
          t.diagnostic(`Stable receipt/working/polling/completed geometry ${width}x${height}: ${JSON.stringify(before)} / ${JSON.stringify(privateBefore)}`);
        }
        receiptFailure = true; await push();
        await browser.waitFor('!!document.querySelector("#check-design-handoff")');
        assert.match(await browser.evaluate('document.querySelector(".development-handoff-status [role=alert]").textContent'), /Synthetic receipt unavailable/);
        assert.equal(await browser.evaluate(bottom), "Synthetic receipt unavailable", "Actionable receipt errors outrank progress and status help.");
        receiptFailure = false;
        await browser.evaluate('document.querySelector("#check-design-handoff").focus(); document.querySelector("#check-design-handoff").click()');
        await browser.waitFor('!document.querySelector("#check-design-handoff")');
        await browser.call("Page.reload"); contexts.clear();
        await waitReload('!!document.querySelector("#project-conversation-frame")');
        await waitPrivate('document.querySelector("#backbone-state").textContent==="Current Design"');
        await browser.waitFor(`${visibleRootStatuses}.length===0`);
        const populate = count => {
          for (let index = 0; index < count; index++) {
            const id = `synthetic-history-${extraEntries.length}`, timestamp = new Date(Date.parse("2026-10-15T00:01:00Z") + extraEntries.length * 1000).toISOString();
            extraEntries.push({ id, kind: "assistant", role: "designer", requestId, timestamp,
              content: `Synthetic retained reply ${id}.\n\n` + "This is fixture conversation content, not model work. ".repeat(8) });
            events.append({ type: "human.role", source: "system", timestamp, summary: `Synthetic role ${id}`,
              data: { role: "designer", requestId } });
          }
          events.touch();
          return `[data-entry-id="${extraEntries.at(-1).id}"]`;
        };
        const attention = async enabled => {
          f.state.questions = enabled ? [{ id: "navigation-question", context: "Synthetic context", question: "Keep the Design?",
            whyItMatters: "Scope", importance: "blocking", options: [], allowFreeform: true, state: "open", answerRequestId: null, blockingActive: true,
            source: { role: "designer", resultId: f.result.resultId, requestId, requestIds: [requestId], cycleId: null,
              design: binding, planDigest: null } }] : [];
          accessRequests = enabled ? [{ id: "synthetic-permission", title: "Synthetic permission, not native work",
            scopes: ["Inspect fixture file only"], canApproveAll: false, canApproveTool: false }] : [];
          events.touch();
        };
        populate(30);
        await browser.call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
        await exerciseLatestNavigation({ browser, evaluate: evaluatePrivate, waitFor: waitPrivate, attention,
          grow: async () => { const selector = populate(1); await waitPrivate(`!!document.querySelector(${JSON.stringify(selector)})`); } });
        // A standalone private surface must not rely on the root's ownership.
        await browser.call("Page.navigate", { url: standalone.url });
        await browser.waitFor('document.querySelector("#backbone-state")?.textContent==="Current Design"');
        const standaloneGeometry = `["messages","conversation-panel"].map(id=>{const r=document.getElementById(id).getBoundingClientRect();return {id,top:r.top+scrollY,height:r.height}})`;
        for (const [width, height] of [[1360, 800], [920, 800], [390, 800], [390, 480]]) {
          await browser.call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
          await browser.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
          const before = await browser.evaluate(standaloneGeometry);
          await browser.evaluate('document.querySelector("#quick-requests").open=true; document.querySelector("[data-quick-request]").click()');
          await browser.waitFor('document.querySelector("#current-state-title").textContent==="Request added to draft; not sent."');
          assert.deepEqual(await browser.evaluate(standaloneGeometry), before);
          assert.equal(await browser.evaluate('document.querySelector("#notice").hidden'), true);
          await browser.evaluate('document.querySelector("#composer").requestSubmit()');
          await browser.waitFor('document.querySelector("#current-state-title").textContent==="Request received; awaiting workflow activity."');
          assert.deepEqual(await browser.evaluate(standaloneGeometry), before);
          f.readiness.compaction = { requested: true }; events.touch();
          await browser.waitFor('document.querySelector("#current-state-title").textContent==="Compaction requested"');
          assert.equal(await browser.evaluate('document.querySelector("#compaction-status").hidden'), true);
          assert.deepEqual(await browser.evaluate(standaloneGeometry), before);
          f.readiness.compaction = { active: true }; events.touch();
          await browser.waitFor('document.querySelector("#current-state-title").textContent==="Compacting context..."');
          f.readiness.compaction = undefined; events.touch();
          await browser.waitFor('document.querySelector("#current-state-title").textContent==="Ready"');
        }
        await exerciseRoleHintDraft({ browser, evaluate: browser.evaluate,
          click: selector => browser.evaluate(`{const e=document.querySelector(${JSON.stringify(selector)});if(e.matches("textarea")) e.focus();e.click()}`) });
        assert.equal(await browser.evaluate('document.querySelector("#prototype-handoff-activity").getBoundingClientRect().height'), 0);
        for (const [width, height] of [[1280, 800], [1280, 520], [390, 520]]) {
          await browser.call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
          assert.equal(await browser.evaluate('document.querySelector("#prototype-handoff-activity").getBoundingClientRect().height'), 0);
        }
        await browser.call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
        await browser.evaluate("new Promise(resolve=>setTimeout(resolve,150))");
        const standaloneBefore = await browser.evaluate(privateGeometry);
        f.state.activeRequestId = requestId; f.state.activeBatchRequestIds = [requestId]; f.request.status = "active";
        f.state.activeTask = { binding: { requestId, role: "designer" }, condition: "running" }; f.readiness.status = "working";
        events.touch();
        await browser.waitFor('document.querySelector("#current-state-title").textContent==="Designer working..."');
        assert.equal(await browser.evaluate('document.querySelector("#prototype-handoff-activity").hidden'), true);
        assert.deepEqual(await browser.evaluate(privateGeometry), standaloneBefore, "Standalone routine status does not move artifact or conversation.");
        f.state.activeTask.condition = "waiting-permission"; events.touch();
        await browser.waitFor('document.querySelector("#prototype-handoff-activity").textContent.includes("waiting for native permission")');
        assert.equal(await browser.evaluate("document.documentElement.scrollWidth<=innerWidth+1"), true);
        f.state.activeRequestId = null; f.state.activeBatchRequestIds = []; f.state.activeTask = null;
        f.request.status = "completed"; f.readiness.status = "ready"; events.touch();
        await browser.call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
        await browser.evaluate("new Promise(resolve=>setTimeout(resolve,150))");
        await browser.evaluate('if (document.querySelector("#newer").checkVisibility()) document.querySelector("#newer").click()');
        await exerciseLatestNavigation({ browser, evaluate: browser.evaluate, waitFor: browser.waitFor, attention,
          grow: async () => { const selector = populate(1); await browser.waitFor(`!!document.querySelector(${JSON.stringify(selector)})`); } });
        assert.deepEqual(mutations, []);
        assert.deepEqual(browser.exceptions, []);
        t.diagnostic(`${(await browser.call("Browser.getVersion")).product}; completed 0 / active 1, 1280x800 and 390x520, polling/reopen and standalone verified.`);
      } finally {
        releaseReceipt(); releasePrivate();
        for (const cleanup of cleanups) await cleanup();
        for (const response of rootEvents) response.end();
        server.closeAllConnections(); await new Promise(done => server.close(done));
        await composed?.close(); await standalone?.close(); events.close(); await closeWal(root).close();
        await rm(root, { recursive: true, force: true });
      }
    });

test("open questions stay actionable and updated Prototype progress wins over unrelated completed requests", () => {
  const f = handoffFixture();
  for (const importance of ["advisory", "blocking"]) f.state.questions.push({
    id: importance, context: "Synthetic choice", question: "Keep this behavior?", whyItMatters: "Scope", options: [], allowFreeform: true,
    importance, state: "open", answerRequestId: null, blockingActive: importance === "blocking",
    source: { role: "designer", resultId: f.result.resultId, requestId, requestIds: [requestId], cycleId: null, design: binding, planDigest: null },
  });
  let activities = projectHumanLoopView(f.state, f.readiness, f.design).handoffActivity;
  assert.equal(activities[0].quietDesign, null);
  assert.match(activities[0].label, /Questions: 2/);
  f.state.requests.push({ ...f.request, id: nextRequestId, status: "active" });
  f.state.activeRequestId = nextRequestId; f.state.activeBatchRequestIds = [nextRequestId];
  f.state.activeTask = { binding: { role: "designer", requestId: nextRequestId }, condition: "running" };
  // Array order is not authority: an older request may be the one actually running.
  f.state.requests.reverse();
  activities = projectHumanLoopView(f.state, { status: "working" }, f.design).handoffActivity;
  const current = currentHandoffActivity(activities, requestId);
  assert.equal(current.requestId, nextRequestId);
  assert.match(current.label, /Designer is reading/);
  assert.equal(quietHandoff(current, binding), false);
  f.state.activeTask.condition = "waiting-permission";
  assert.match(currentHandoffActivity(projectHumanLoopView(f.state, { status: "working" }, f.design).handoffActivity).label, /waiting for native permission/);
  assert.equal(validHandoffActivity({ requestId, label: "Legacy activity" }), true);
  assert.equal(quietHandoff({ requestId, label: "Design ready from the saved Prototype." }, binding), false, "English text is never completion evidence.");
  assert.equal(validHandoffActivity({ requestId, label: "Invalid", quietDesign: { revisionId: binding.revisionId } }), false);
});

test("routine progress is structured, exact and quiet only with matching Design evidence", () => {
  const f = handoffFixture();
  const read = () => projectHumanLoopView(f.state, f.readiness, f.design).handoffActivity[0];
  assert.equal(read().statusKind, "settled");
  assert.equal(handoffProgress(read(), binding), "");
  assert.equal(handoffProgress(read(), previous), "Current Design evidence is unverified.");
  assert.equal(handoffProgress({ requestId, label: "Designer working..." }, binding), "", "No classification of legacy English.");
  assert.equal(validHandoffActivity({ requestId, label: "Legacy" }), true);
  assert.equal(validHandoffActivity({ requestId, label: "Bad", statusKind: "progress" }), false);
  assert.equal(validHandoffActivity({ requestId, label: "Bad", statusKind: "invented", statusText: "Ready" }), false);
  f.state.activeRequestId = requestId; f.state.activeBatchRequestIds = [requestId]; f.request.status = "active";
  f.state.activeTask = { binding: { requestId, role: "designer" }, condition: "running" }; f.readiness.status = "working";
  assert.equal(handoffProgress(read(), previous), "Designer working...", "An existing older Design does not hide the new request.");
  assert.equal(handoffProgress(read(), previous, 1), "");
  for (const condition of ["waiting-permission", "unknown", "failed"]) {
    f.state.activeTask.condition = condition;
    assert.equal(read().statusKind, "attention");
    assert.equal(handoffProgress(read(), binding), "");
  }
  f.state.activeTask = null; f.state.activeRequestId = null; f.state.activeBatchRequestIds = [];
  f.request.status = "completed"; f.readiness.status = "ready";
  f.result.outcome.kind = "agent-answer";
  assert.equal(handoffProgress(read(), binding), "", "No idle completion prose for historical non-Design responses.");
});
