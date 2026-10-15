import assert from "node:assert/strict";
import test from "node:test";
import { projectHumanLoopView } from "../development/tandem/src/human-loop-provider.mjs";
import { createHumanLoop } from "../development/tandem/runtime-src/domain/human-loop/model.ts";
import { DEFAULT_POLICY } from "../development/tandem/runtime-src/domain/workflow/policy.ts";
import { currentHandoffActivity, quietHandoff, validHandoffActivity } from "../development/tandem/public/handoff-presentation.js";
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

const requestId = `handoff-${"a".repeat(64)}`;
const nextRequestId = `handoff-${"b".repeat(64)}`;
const binding = { revisionId: "published-design", digest: "c".repeat(64) };
const previous = { revisionId: "previous-design", digest: "d".repeat(64) };

export function handoffFixture(kind = "designer-changed") {
  const state = createHumanLoop({ schemaVersion: "human-loop-owner/v1", id: "owner", mainSessionId: "main",
    privateSessionId: "private", workspacePath: process.cwd(), policy: DEFAULT_POLICY }, binding);
  const request = { id: requestId, message: "Saved Prototype", status: "completed", answers: null, receivedAt: "2026-10-15T00:00:00Z",
    blockingAnswerRefs: [], questionGatesReleased: false, route: null, stopId: null };
  const result = { resultId: "design-result", outcome: { kind, summary: "Synthetic published Design", questions: [] } };
  const execution = { binding: { requestId, role: "designer", design: kind === "designer-changed" ? previous : binding }, result };
  state.requests.push(request); state.executions.push(execution);
  state.handoffs.push({ id: "handoff:design-result", requestId, requestIds: [requestId], result, presented: true });
  const design = { binding, content: { summary: "Synthetic Design" }, publication: { requestId, previous } };
  const readiness = { status: "ready", reason: null };
  return { state, request, result, execution, design, readiness };
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

  test("actual root and private UI show zero completed banners and one owned active status without resetting Design or drafts",
    { skip: !browserAvailable, timeout: 90_000 }, async t => {
      const root = await mkdtemp(join(tmpdir(), "handoff-presentation-"));
      const f = handoffFixture(), events = new HumanLoopEvents(), rootEvents = new Set(), mutations = [], cleanups = [];
      const extraEntries = [];
      let accessRequests = [];
      f.state.owner.workspacePath = root;
      f.design.content = sharedDesignExampleV3();
      let installationStatus = "ready";
      const value = rootState("development");
      const snapshotPath = ".tandem/efforts/fixture/stages/prototype-r7.json";
      value.lifecycle.outputs = [{ stageId: "prototype", path: snapshotPath, completedAt: value.updatedAt }];
      value.development = { handoffId: requestId, requestId, snapshotPath };
      const runtime = { sessionId: "private", state: async () => structuredClone(f.state), readiness: async () => f.readiness,
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
        else if (path === "/api/development/preflight") json({ status: "ready", projectPath: root, initialize: false, message: "Synthetic Git preflight" });
        else if (path === "/api/development/view") json({ url: composed.url, channel: "handoff-fixture" });
        else if (path === "/api/development/handoff") json({ generation: value.generation,
          snapshotPath: value.development.snapshotPath, handoffId: value.development.handoffId,
          admission: { status: "admitted", handoffId: value.development.handoffId, requestId: value.development.requestId } });
        else if (path === "/api/sketch") json({ sketch: value.sketch, document: null });
        else { mutations.push({ path, method: request.method }); response.writeHead(404); response.end(); }
      });
      await new Promise(done => server.listen(0, "127.0.0.1", done));
      const url = `http://127.0.0.1:${server.address().port}/`;
      const options = { repositoryRoot: root, publicDirectory, surface: "browser", events,
        getInstallation: () => ({ runtime, read: async () => ({ status: installationStatus, reason: null }) }),
        permissions: { list: () => accessRequests } };
      try {
        composed = await providerFactory({ ...options, projectHost: { origin: new URL(url).origin, channel: "handoff-fixture" } });
        standalone = await providerFactory(options);
        const browser = await openFixtureBrowser({ after: cleanup => cleanups.push(cleanup) });
        const contexts = new Map();
        const evaluatePrivate = async expression => {
          const tree = await browser.call("Page.getFrameTree");
          const frame = tree.frameTree.childFrames?.find(item => item.frame.url.startsWith(composed.url))?.frame;
          if (!frame) return null;
          if (!contexts.has(frame.id)) contexts.set(frame.id, (await browser.call("Page.createIsolatedWorld",
            { frameId: frame.id, worldName: "handoff-regression" })).executionContextId);
          const result = await browser.call("Runtime.evaluate", { contextId: contexts.get(frame.id), expression, returnByValue: true });
          if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
          return result.result.value;
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
        await browser.call("Page.navigate", { url });
        await browser.waitFor('!!document.querySelector("#project-conversation-frame")');
        await browser.waitFor(`${visibleRootStatuses}.length===0`);
        await waitPrivate('document.querySelector("#backbone-state").textContent==="Current Design"');
        assert.equal(await evaluatePrivate('document.querySelector("#prototype-handoff-activity").getBoundingClientRect().height'), 0);
        assert.equal(await browser.evaluate('document.querySelector("#development-panel .development-handoff-status")'), null);
        await evaluatePrivate('window.retainedDesign=document.querySelector("#backbone-proposal"); document.querySelector("#message").value="Retained unsent draft"; document.querySelector("#message").dispatchEvent(new Event("input",{bubbles:true}))');
        for (let poll = 0; poll < 3; poll++) await push();
        assert.equal(await browser.evaluate(`${visibleRootStatuses}.length`), 0);
        f.state.questions.push({ id: "choice", context: "Synthetic behavior", question: "Keep the count?", whyItMatters: "Scope",
          importance: "blocking", options: [], allowFreeform: true, state: "open", answerRequestId: null, blockingActive: true,
          source: { role: "designer", resultId: f.result.resultId, requestId, requestIds: [requestId], cycleId: null,
            design: binding, planDigest: null } });
        await push();
        await browser.waitFor(`${visibleRootStatuses}.some(e=>e.textContent.includes("Questions: 1"))`);
        assert.equal(await evaluatePrivate('document.querySelector("#prototype-handoff-activity").hidden'), true);
        assert.equal(await evaluatePrivate('document.querySelector("#show-questions").disabled'), false);
        f.state.questions = [];
        const next = { ...f.request, id: nextRequestId, status: "active" };
        f.state.requests.push(next); f.state.activeRequestId = nextRequestId; f.state.activeBatchRequestIds = [nextRequestId];
        f.state.activeTask = { binding: { requestId: nextRequestId, role: "designer" }, condition: "running" };
        f.readiness.status = "working";
        value.lifecycle.outputs[0].path = ".tandem/efforts/fixture/stages/prototype-r8.json";
        value.development = { handoffId: nextRequestId, requestId: nextRequestId, snapshotPath: value.lifecycle.outputs[0].path };
        await push();
        await browser.waitFor(`${visibleRootStatuses}.some(e=>e.textContent.includes("Designer is reading"))`);
        await waitPrivate('document.querySelector("#prototype-handoff-activity").hidden');
        for (const [width, height] of [[1280, 800], [390, 520]]) {
          await browser.call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
          assert.equal(await browser.evaluate(`${visibleRootStatuses}.length`), 1);
          assert.equal(await evaluatePrivate('document.querySelector("#prototype-handoff-activity").getBoundingClientRect().height'), 0);
          assert.equal(await browser.evaluate("document.documentElement.scrollWidth<=innerWidth+1"), true);
          assert.equal(await evaluatePrivate('document.querySelector("#message").value'), "Retained unsent draft");
          assert.equal(await evaluatePrivate('document.querySelector("#backbone-proposal")===window.retainedDesign'), true);
        }
        f.state.activeTask.condition = "waiting-permission"; await push();
        await browser.waitFor(`${visibleRootStatuses}.some(e=>e.textContent.includes("waiting for native permission"))`);
        assert.equal(await evaluatePrivate('document.querySelector("#prototype-handoff-activity").hidden'), true);
        f.readiness.status = "execution-unknown"; f.readiness.reason = "Synthetic execution uncertain"; await push();
        await browser.waitFor(`${visibleRootStatuses}.some(e=>e.textContent.includes("Synthetic execution uncertain"))`);
        next.status = "rejected"; f.state.activeRequestId = null; f.state.activeBatchRequestIds = []; f.state.activeTask = null;
        f.readiness.status = "ready"; f.readiness.reason = null; await push();
        await browser.waitFor(`${visibleRootStatuses}.some(e=>e.textContent.includes("rejected"))`);
        installationStatus = "unknown"; await push();
        await browser.waitFor(`${visibleRootStatuses}.some(e=>e.textContent.includes("Waiting for verified Development activity"))`);
        await waitPrivate('document.querySelector("#backbone-state").textContent==="Design unverified"');
        installationStatus = "ready";
        // Reopen the successful exact source; the newer rejected request cannot lend completion evidence.
        f.state.requests = [f.request]; value.lifecycle.outputs[0].path = snapshotPath;
        value.development = { handoffId: requestId, requestId, snapshotPath }; await push();
        await browser.waitFor(`${visibleRootStatuses}.length===0`);
        await browser.call("Page.reload"); contexts.clear();
        await browser.waitFor('!!document.querySelector("#project-conversation-frame")');
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
        assert.equal(await browser.evaluate('document.querySelector("#prototype-handoff-activity").getBoundingClientRect().height'), 0);
        f.state.activeRequestId = requestId; f.state.activeBatchRequestIds = [requestId]; f.request.status = "active";
        f.state.activeTask = { binding: { requestId, role: "designer" }, condition: "running" }; f.readiness.status = "working";
        events.touch();
        await browser.waitFor('document.querySelector("#prototype-handoff-activity").checkVisibility()');
        assert.match(await browser.evaluate('document.querySelector("#prototype-handoff-activity").textContent'), /Designer is reading/);
        f.state.activeTask.condition = "waiting-permission"; events.touch();
        await browser.waitFor('document.querySelector("#prototype-handoff-activity").textContent.includes("waiting for native permission")');
        assert.equal(await browser.evaluate("document.documentElement.scrollWidth<=innerWidth+1"), true);
        f.state.activeRequestId = null; f.state.activeBatchRequestIds = []; f.state.activeTask = null;
        f.request.status = "completed"; f.readiness.status = "ready"; events.touch();
        await browser.call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
        await exerciseLatestNavigation({ browser, evaluate: browser.evaluate, waitFor: browser.waitFor, attention,
          grow: async () => { const selector = populate(1); await browser.waitFor(`!!document.querySelector(${JSON.stringify(selector)})`); } });
        assert.deepEqual(mutations, []);
        assert.deepEqual(browser.exceptions, []);
        t.diagnostic(`${(await browser.call("Browser.getVersion")).product}; completed 0 / active 1, 1280x800 and 390x520, polling/reopen and standalone verified.`);
      } finally {
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
