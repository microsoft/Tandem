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
import { createHumanLoopProvider, HumanLoopEvents } from "../development/tandem/src/human-loop-provider.mjs";
import { createHumanLoopLedger, replayHumanLoopLedger } from "../development/tandem/runtime-src/domain/human-loop/ledger.ts";
import { DEFAULT_POLICY } from "../development/tandem/runtime-src/domain/workflow/policy.ts";
import { getHostStateWal } from "../development/tandem/runtime-src/domain/host-state-wal.ts";
import { browserAvailable, openFixtureBrowser } from "../development/tandem/test/helpers/browser-fixture.mjs";
import { JSDOM } from "jsdom";
import { installProjectPresentation } from "../development/tandem/public/project-presentation.js";
import { createConversationRenderer } from "../development/tandem/public/renderers/conversation.js";
import { sharedDesignExampleV3 } from "../development/tandem/test/helpers/shared-design-fixture.mjs";
import { exerciseRoleHintDraft } from "../development/tandem/test/helpers/role-hint-browser.mjs";

test("one latest control tracks both viewports, manual scrollback and delayed growth without stealing follow intent", t => {
  const dom = new JSDOM('<div><div id="history"></div></div><div id="messages"></div><div id="current"></div><div id="detail"></div><button id="newer"></button>');
  t.after(() => dom.window.close());
  const frames = [], observers = [];
  dom.window.requestAnimationFrame = callback => { frames.push(callback); return frames.length; };
  dom.window.ResizeObserver = class {
    constructor(callback) { observers.push(callback); }
    observe() {} unobserve() {} disconnect() {}
  };
  const get = id => dom.window.document.getElementById(id);
  const geometry = id => {
    const value = { height: 1000, viewport: 100, top: 0 }, element = get(id);
    Object.defineProperties(element, {
      scrollHeight: { get: () => value.height }, clientHeight: { get: () => value.viewport },
      scrollTop: { get: () => value.top, set: top => { value.top = Math.max(0, Math.min(top, value.height - value.viewport)); } },
    });
    return value;
  };
  const messages = geometry("messages"), history = geometry("history");
  let allowed = true;
  const renderer = createConversationRenderer({ messages: get("messages"), history: get("history"),
    current: get("current"), currentDetail: get("detail"), newer: get("newer"), canFollowMessages: () => allowed });
  const flush = () => { while (frames.length) frames.shift()(); };
  const resize = () => { for (const observe of observers) observe(); flush(); };
  const scroll = (id, top) => { get(id).scrollTop = top; get(id).dispatchEvent(new dom.window.Event("scroll")); };
  renderer.refreshLayout(); flush();
  assert.deepEqual([messages.top, history.top, get("newer").hidden], [900, 900, true]);
  assert.equal(get("newer").getAttribute("aria-controls"), "messages history");
  assert.equal(dom.window.document.querySelector(".state-history-return"), null);
  for (const targets of [["messages"], ["history"], ["messages", "history"]]) {
    for (const target of targets) scroll(target, 100);
    assert.equal(get("newer").hidden, false, "Manual scrollback alone reveals the control.");
    renderer.refreshLayout(); flush();
    for (const target of targets) assert.equal(get(target).scrollTop, 100);
    get("newer").click(); flush();
    assert.deepEqual([messages.top, history.top, get("newer").hidden], [900, 900, true]);
  }
  // A delayed event for our latest click arrives after content grows.
  messages.height += 200; history.height += 200;
  get("messages").dispatchEvent(new dom.window.Event("scroll"));
  get("history").dispatchEvent(new dom.window.Event("scroll"));
  resize();
  assert.deepEqual([messages.top, history.top], [1100, 1100]);
  renderer.refreshLayout();
  get("messages").scrollTop = 100; get("history").scrollTop = 100;
  flush();
  assert.deepEqual([messages.top, history.top], [100, 100], "Scroll before the next frame wins even before its event.");
  messages.height += 200; history.height += 200; resize();
  assert.deepEqual([messages.top, history.top, get("newer").hidden], [100, 100, false]);
  get("newer").click(); flush();
  get("messages").dispatchEvent(new dom.window.WheelEvent("wheel", { deltaY: -100 }));
  get("messages").scrollTop = 1200; messages.height += 200;
  resize();
  assert.equal(messages.top, 1200, "User scrolling wins even when content grows before its scroll event.");
  get("newer").click(); flush();
  allowed = false; messages.height += 200; history.height += 200; resize();
  assert.deepEqual([messages.top, history.top], [1500, 1500], "Existing question/focus policy still gates automatic message following.");
  get("newer").click(); flush();
  assert.equal(messages.top, 1700, "Explicit latest remains available with blockers.");
  allowed = true;
  get("messages").dispatchEvent(new dom.window.WheelEvent("wheel", { deltaY: 100 }));
  messages.height += 100; resize();
  assert.equal(messages.top, 1800, "Scrolling down at the bottom without movement does not disable follow.");
  messages.height = history.height = 50; messages.viewport = history.viewport = 100;
  get("messages").scrollTop = get("history").scrollTop = 0; resize();
  assert.equal(get("newer").hidden, true, "Nonoverflowing viewports reserve no latest-control row.");
});

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
  assert.equal(api.handoffStatusOwner(), null);
  const handoffStatusOwner = `handoff-${"a".repeat(64)}`;
  receive({ ...context, handoffStatusOwner }, null); assert.equal(api.handoffStatusOwner(), null);
  receive({ ...context, handoffStatusOwner }, parent, "http://127.0.0.1:5000"); assert.equal(api.handoffStatusOwner(), null);
  receive({ ...context, handoffStatusOwner, channel: "foreign" }); assert.equal(api.handoffStatusOwner(), null);
  receive({ ...context, handoffStatusOwner }); assert.equal(api.handoffStatusOwner(), handoffStatusOwner);
  receive({ ...context, handoffStatusOwner: "invalid" }); assert.equal(api.handoffStatusOwner(), null);
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

test("composer context omits idle instructions but retains startup, conflict and uncertain-submission states", async t => {
  const dom = new JSDOM('<body data-project-panel="workspace" data-project-origin="http://127.0.0.1:4000" data-project-channel="quiet"><form id="composer"><textarea id="message"></textarea></form>');
  t.after(() => dom.window.close());
  const sent = [], parent = { postMessage: data => sent.push(data) };
  Object.defineProperty(dom.window, "parent", { value: parent });
  const api = installProjectPresentation({ document: dom.window.document, window: dom.window, changed() {} });
  const receive = data => dom.window.dispatchEvent(new dom.window.MessageEvent("message", { source: parent, origin: "http://127.0.0.1:4000",
    data: { protocol: "tandem-project/v1", channel: "quiet", ...data } }));
  const help = dom.window.document.querySelector("#project-message-context p");
  assert.equal(help.hidden, false);
  assert.equal(help.textContent, "Waiting for the project workspace.");
  const context = { type: "context", entries: [], viewedStage: "development", viewLabel: "Development",
    developmentEntered: true, developmentEnabled: true,
    discovery: { key: "usage", label: "Requirements", help: "Waiting for project ownership.", enabled: false } };
  receive({ ...context, starting: true });
  assert.equal(help.hidden, false); assert.equal(help.textContent, "Starting Development...");
  assert.equal(dom.window.document.querySelector("#project-message-context").hidden, false);
  assert.equal(api.developmentEnabled(), false);
  receive(context);
  assert.equal(help.hidden, true); assert.equal(help.textContent, "");
  assert.equal(dom.window.document.querySelector("#project-message-context").hidden, true);
  assert.equal(dom.window.document.querySelector("#project-message-context strong").hidden, true);
  assert.match(api.placeholder(), /Ask about the Design/);
  const input = dom.window.document.querySelector("#message");
  input.value = "Retain this draft."; input.dispatchEvent(new dom.window.Event("input"));
  input.focus(); input.setSelectionRange(2, 7);
  api.nativePending(true); receive(context);
  assert.equal(help.hidden, true);
  assert.deepEqual([input.value, input.selectionStart, input.selectionEnd, dom.window.document.activeElement === input],
    ["Retain this draft.", 2, 7, true]);
  api.nativePending(false);
  receive({ ...context, viewedStage: "requirements", viewLabel: "Requirements" });
  assert.equal(help.hidden, false); assert.match(help.textContent, /draft belongs to Development/);
  assert.equal(dom.window.document.querySelector("#project-message-context").hidden, false);
  assert.equal(api.canSend(), false);
  input.value = ""; input.dispatchEvent(new dom.window.Event("input"));
  assert.equal(help.hidden, false); assert.equal(help.textContent, "Waiting for project ownership.");
  receive({ ...context, viewedStage: "requirements", viewLabel: "Requirements",
    discovery: { ...context.discovery, enabled: true } });
  const request = api.submit("Exact request");
  const envelope = sent.find(item => item.type === "discovery-send");
  assert.equal(help.hidden, false); assert.match(help.textContent, /Awaiting the exact discovery action result/);
  receive({ type: "discovery-unknown", id: envelope.id });
  assert.equal(help.hidden, false); assert.match(help.textContent, /cannot confirm the submission/);
  receive({ type: "discovery-result", id: envelope.id, ok: false, error: "Explicit failure" });
  await assert.rejects(request, /Explicit failure/);
  assert.equal(sent.filter(item => item.type === "discovery-send").length, 1);
});

test("project layout accepts responsive defaults without treating invalid widths as defaults", t => {
  const dom = new JSDOM('<body data-project-panel="workspace" data-project-origin="http://127.0.0.1:4000" data-project-channel="layout"><form id="composer"><textarea id="message"></textarea></form>');
  t.after(() => dom.window.close());
  const layouts = [], parent = { postMessage() {} };
  Object.defineProperty(dom.window, "parent", { value: parent });
  installProjectPresentation({ document: dom.window.document, window: dom.window, changed() {},
    layoutChanged: layout => layouts.push(layout) });
  const receive = conversationWidth => dom.window.dispatchEvent(new dom.window.MessageEvent("message", {
    source: parent, origin: "http://127.0.0.1:4000",
    data: { protocol: "tandem-project/v1", channel: "layout", type: "layout", stacked: false, conversationWidth },
  }));
  for (const width of [undefined, "400", -1, NaN, Infinity, 20001]) receive(width);
  assert.deepEqual(layouts, []);
  for (const width of [null, 420, null]) receive(width);
  assert.deepEqual(layouts, [null, 420, null].map(conversationWidth => ({ stacked: false, conversationWidth })));
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

test("composed diagnostics presents only the validated supported root reload action", t => {
  const dom = new JSDOM(`<body data-project-panel="workspace" data-project-origin="http://127.0.0.1:4000" data-project-channel="maintenance">
    <form id="composer"><textarea id="message"></textarea></form>
    <div id="project-provider-maintenance" hidden><button id="project-reload-extension" disabled></button>
    <p id="project-reload-purpose"></p><p id="project-reload-status"></p></div>`);
  t.after(() => dom.window.close());
  const sent = [], parent = { postMessage: data => sent.push(data) };
  Object.defineProperty(dom.window, "parent", { value: parent });
  installProjectPresentation({ document: dom.window.document, window: dom.window, changed() {} });
  const get = id => dom.window.document.getElementById(id);
  const receive = (data, origin = "http://127.0.0.1:4000") => dom.window.dispatchEvent(new dom.window.MessageEvent("message",
    { source: parent, origin, data: { protocol: "tandem-project/v1", channel: "maintenance", ...data } }));
  const context = { type: "context", entries: [], discovery: { key: "none", label: "Discovery", help: "Use phase controls", enabled: false },
    providerReload: { scope: "exact-root", supported: true, disabled: false, label: "Reload Tandem extension",
      title: "Installed provider only; no download or page refresh.", message: "", error: false } };
  receive(context, "http://127.0.0.1:9999");
  assert.equal(get("project-provider-maintenance").hidden, true);
  receive({ ...context, providerReload: { ...context.providerReload, supported: false } });
  assert.equal(get("project-provider-maintenance").hidden, true);
  receive({ ...context, providerReload: { ...context.providerReload, scope: null } });
  assert.equal(get("project-reload-extension").disabled, true);
  receive(context);
  assert.equal(get("project-reload-extension").textContent, "Reload Tandem extension");
  get("project-reload-extension").click();
  const request = sent.at(-1);
  assert.equal(request.type, "project-reload");
  assert.equal(request.scope, "exact-root");
  assert.equal(get("project-reload-extension").disabled, true);
  receive({ type: "project-reload-result", id: "foreign", error: "Not ours" });
  assert.equal(get("project-reload-extension").disabled, true);
  receive({ type: "project-reload-result", id: request.id, error: "Provider reload refused: runtime is not quiet." });
  assert.match(get("project-reload-status").textContent, /runtime is not quiet/);
  receive({ ...context, providerReload: { ...context.providerReload, disabled: true } });
  get("project-reload-extension").click();
  assert.equal(sent.filter(value => value.type === "project-reload").length, 1);
});

test("handoff settings entry is composed-only and sends only a presentation request", t => {
  const markup = `<body><details id="canvas-settings" open><section id="project-process-settings" hidden>
    <button id="acceptance-delivery"></button></section></details><form id="composer"><textarea id="message"></textarea></form>`;
  const dom = new JSDOM(markup);
  t.after(() => dom.window.close());
  const sent = [], parent = { postMessage: data => sent.push(data) };
  Object.defineProperty(dom.window, "parent", { value: parent });
  assert.equal(installProjectPresentation({ document: dom.window.document, window: dom.window, changed() {} }), null);
  assert.equal(dom.window.document.querySelector("#project-process-settings").hidden, true);
  Object.assign(dom.window.document.body.dataset, { projectPanel: "workspace", projectOrigin: "http://127.0.0.1:4000", projectChannel: "handoffs" });
  installProjectPresentation({ document: dom.window.document, window: dom.window, changed() {} });
  assert.equal(dom.window.document.querySelector("#project-process-settings").hidden, false);
  dom.window.document.querySelector("#acceptance-delivery").click();
  assert.equal(dom.window.document.querySelector("#canvas-settings").open, false);
  assert.deepEqual(sent.at(-1), { protocol: "tandem-project/v1", channel: "handoffs", type: "process-open" });
});

test("whole project workspace uses one actual embedded renderer for navigation, drafting, activation and recovery",
  { skip: !browserAvailable, timeout: 150_000 }, async t => {
    const root = await mkdtemp(join(tmpdir(), "tandem-project-ui-"));
    const events = new HumanLoopEvents(), mutations = [], nativeRequests = [];
    let voiceLoginAborted = false;
    let accessRequests = [];
    const owner = { schemaVersion: "human-loop-owner/v1", id: "owner", mainSessionId: "main", privateSessionId: "private",
      workspacePath: root, policy: DEFAULT_POLICY };
    const designBinding = { revisionId: "fixture-design", digest: "a".repeat(64) };
    let currentDesignBinding = designBinding;
    let emptyDesign = false;
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
    value.provider = { ...value.provider, canReload: true };
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
      currentDesign: async () => emptyDesign ? null : ({ binding: currentDesignBinding, content: sharedDesignExampleV3() }),
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
        else if (path === "/host-fixture") {
          const channel = "11111111-1111-4111-8111-111111111111", origin = new URL(url).origin;
          const source = `${url}#${new URLSearchParams({ "tandem-host": origin, "header-channel": channel })}`;
          response.writeHead(200, { "Content-Type": "text/html" });
          response.end(`<!doctype html><body style="margin:0"><header id="host-project"></header>
            <iframe id="hosted-app" style="width:100%;height:calc(100vh - 30px);border:0"></iframe><script>
            document.querySelector("#host-project").textContent=${JSON.stringify(root)};
            const frame=document.querySelector("#hosted-app");
            window.addEventListener("message",event=>{
              if(event.source===frame.contentWindow && event.data?.type==="tandem:header:ready")
                frame.contentWindow.postMessage({type:"tandem:header:connect",channel:${JSON.stringify(channel)}},${JSON.stringify(origin)});
            });
            frame.src=${JSON.stringify(source)};
            </script></body>`);
        }
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
        else if (path === "/api/project-entry/open") json({ developmentContext: startingPath === "development", developmentStarted: false });
        else if (path === "/api/development/preflight") json({ status: "ready", projectPath: root, initialize: false, message: "Fixture Git working copy is ready." });
        else if (path === "/api/development/view") json({ url: provider.url, channel: "whole-project-fixture" });
        else if (path === "/api/settings/project-effort") json({ desired: "low", changing: false,
          stage1: { actual: "low", desired: "low", model: "fixture", status: "applied", supported: ["low"], error: null },
          stage2: { actual: null, desired: "low", model: null, status: "pending", supported: [], error: null } });
        else if (request.method === "POST") {
          const chunks = []; for await (const chunk of request) chunks.push(chunk);
          const body = JSON.parse(Buffer.concat(chunks).toString() || "{}"); mutations.push({ path, body });
          if (path === "/api/speech/token") {
            response.writeHead(503, { "Content-Type": "application/json" });
            response.end(JSON.stringify({ error: "Voice input needs Azure Speech sign-in.", speechSignInRequired: true }));
          }
          else if (path === "/api/speech/login") {
            response.on("close", () => { voiceLoginAborted = true; });
          }
          else if (path === "/api/reload") {
            value.reloadReceipt = { status: "success", message: "Fixture provider reload accepted." };
            value.revision++; json({ scheduled: true });
          }
          else if (path === "/api/development/open") {
            const first = mutations.filter(item => item.path === "/api/development/open").length === 1;
            active = !first; stopped = false; installationStatus = first ? "starting" : "ready";
            events.touch(); json({ url: provider.url });
          }
          else if (path === "/api/answer") { value.requirements.usageItems.push(body.answer); value.revision++; json(value); }
          else if (path === "/api/process") {
            if (body.action === "configure") {
              response.writeHead(409, { "Content-Type": "application/json" });
              response.end(JSON.stringify({ error: "Fixture adapter conflict; saved settings and history retained." }));
            } else if (body.action === "accept") {
              const output = value.lifecycle.outputs.find(output => output.stageId === body.stageId);
              assert.ok(output);
              value.process.acceptances.push({ id: "fixture-accepted", stageId: body.stageId, snapshotPath: output.path,
                snapshotHash: "fixture-hash", acceptedBy: { label: body.approver }, acceptedAt: "2026-10-14T00:00:00Z",
                source: { fingerprint: "fixture-source" }, producer: { version: "fixture" }, artifactHashes: [], upstream: [] });
              value.revision++; json(value);
            } else if (body.action === "export") {
              const acceptance = value.process.acceptances.find(record => record.id === body.acceptanceId);
              assert.ok(acceptance); acceptance.exportPath = "tandem-records\\fixture";
              value.revision++; json(value);
            } else { response.writeHead(400); response.end(JSON.stringify({ error: "Unsupported fixture process action." })); }
          }
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
      ? join(dirname(process.env.TANDEM_PACKAGED_EXTENSION), "stage2", "public") : resolve("development", "tandem", "public"),
      surface: "browser", projectHost: { origin: new URL(url).origin, channel: "whole-project-fixture" }, events,
      getInstallation: () => ({ runtime: active ? runtime : null,
        close: async () => { stopped = true; installationStatus = "closed"; events.touch(); return {}; },
        read: async () => ({ status: installationStatus,
        canStart: !active, canRetry: installationStatus === "prepared", canReopen: stopped,
        reason: installationStatus === "prepared" ? "Git observation failed: fatal: not a git repository (or any of the parent directories): .git" : stopped ? "Closed; saved history retained." : null }) }),
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
      await browser.call("Page.navigate", { url: new URL("host-fixture", url).href });
      await browser.waitFor('document.querySelector("#hosted-app")?.contentDocument?.querySelector(".project-folder")?.hidden');
      const identity = await browser.evaluate(`(() => {
        const doc=document.querySelector("#hosted-app").contentDocument, heading=doc.querySelector(".context-pane-heading");
        return {height:heading.getBoundingClientRect().height,margin:doc.defaultView.getComputedStyle(heading).marginBottom,
          header:document.querySelector("#host-project").textContent,settings:doc.querySelector("#project-settings").textContent};
      })()`);
      assert.deepEqual(identity, { height: 0, margin: "0px", header: root, settings: "Project settings" });
      await browser.evaluate(`document.querySelector("#hosted-app").contentWindow.postMessage({
        type:"tandem:header:disconnect",channel:"11111111-1111-4111-8111-111111111111"},location.origin)`);
      await browser.waitFor('document.querySelector("#hosted-app").contentDocument.querySelector(".project-folder").checkVisibility()');
      await browser.waitFor(`document.querySelector("#hosted-app").contentDocument.querySelector(".project-folder").title===${JSON.stringify(root)}`);
      assert.equal(await browser.evaluate('document.querySelector("#hosted-app").contentDocument.querySelector(".project-folder").title'), root);
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
        await browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:"nearest"})`);
        await browser.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
        const point = await browser.evaluate(`(() => {const e=document.querySelector(${JSON.stringify(selector)});
          e.scrollIntoView({block:"nearest"});const r=e.getBoundingClientRect();
          const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
          return {x:r.x+r.width/2,y:r.y+r.height/2,element:e.outerHTML.slice(0,300),hit:hit?.outerHTML.slice(0,300),
            ok:!e.disabled&&r.width>0&&(hit===e||e.contains(hit))};})()`);
        if (!point.ok && process.env.TANDEM_UI_EVIDENCE) await writeFile(join(process.env.TANDEM_UI_EVIDENCE, "root-unreachable-control.png"), await browser.screenshot());
        assert.ok(point.ok, `Root control reachable: ${selector}: ${JSON.stringify(point)}`);
        for (const type of ["mousePressed", "mouseReleased"]) await browser.call("Input.dispatchMouseEvent", { type, x: point.x, y: point.y, button: "left", clickCount: 1 });
      };
      await browser.waitFor('Boolean(document.querySelector("#entry-preparation"))');
      assert.equal(await browser.evaluate('document.querySelector("#project-conversation-frame")===null'), true);
      await clickRoot("#entry-preparation");
      await browser.waitFor('!document.querySelector("#entry-preparation")');
      const push = async () => {
        value.revision++;
        for (const response of rootEvents) response.write(`data: ${JSON.stringify(value)}\n\n`);
        await browser.evaluate("new Promise(resolve => setTimeout(resolve, 80))");
      };
      const assertCleanSidebar = async () => {
        assert.equal(await browser.evaluate('document.querySelector("#requirements-pane .process-controls, #requirements-pane #handoff-stage, #requirements-pane #process-metrics")'), null);
        assert.equal(await browser.evaluate('document.querySelector("#export-handoff")'), null);
        assert.equal(await browser.evaluate('document.querySelector(".ledger-details").checkVisibility()'), false);
      };
      await assertCleanSidebar();
      await clickRoot("#preparation-tab");
      assert.equal(await browser.evaluate('document.querySelector("#preparation-tab").getAttribute("aria-selected")'), "true");
      assert.equal(await browser.evaluate('document.querySelector("#design-tree-tab").getAttribute("aria-current")'), "step");
      assert.equal(await browser.evaluate('document.querySelector("#preparation-tab").getAttribute("aria-current")'), null);
      await browser.evaluate('document.querySelector("#studio-workspace").style.setProperty("--requirements-width","180px")');
      for (const theme of ["light", "dark"]) {
        await browser.evaluate(`document.documentElement.dataset.projectTheme=${JSON.stringify(theme)}`);
        const marker = await browser.evaluate(`(() => {
          const row=document.querySelector("#design-tree-tab"), marker=row.querySelector(".current-phase"),
            label=row.querySelector(".project-tab-name"), m=marker.getBoundingClientRect(), l=label.getBoundingClientRect(), r=row.getBoundingClientRect();
          return {width:document.querySelector("#requirements-pane").getBoundingClientRect().width,
            rowHeight:r.height, fullLabel:label.scrollWidth<=label.clientWidth, title:marker.title,
            sameRow:Math.abs((m.top+m.bottom)/2-(l.top+l.bottom)/2)<1,
            fits:m.left>=r.left&&m.right<=r.right,color:getComputedStyle(marker).color,background:getComputedStyle(row).backgroundColor};
        })()`);
        assert.equal(marker.width, 180);
        assert.equal(marker.title, "Current phase");
        assert.ok(marker.sameRow && marker.fits && marker.fullLabel && marker.rowHeight <= 38, `${theme}: ${JSON.stringify(marker)}`);
        const luminance = color => color.match(/[\d.]+/g).slice(0, 3).map(Number).map(c => c / 255)
          .map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((sum, c, index) => sum + c * [.2126, .7152, .0722][index], 0);
        const [bright, dark] = [luminance(marker.color), luminance(marker.background)].sort((a, b) => b - a);
        assert.ok((bright + .05) / (dark + .05) >= 3, `${theme}: current phase marker contrast`);
      }
      await browser.evaluate('delete document.documentElement.dataset.projectTheme;document.querySelector("#studio-workspace").style.setProperty("--requirements-width","220px")');
      const prepared = structuredClone(value);
      Object.assign(value, discoveryState("prepare"), { goal: "", revision: value.revision, provider: prepared.provider });
      await push();
      await clickRoot("#preparation-tab");
      await browser.waitFor('Boolean(document.querySelector("#start-goal"))');
      assert.doesNotMatch(await browser.evaluate('document.querySelector("#start-panel").innerText'), /Describe the project here|Implementation remains a separate/);
      await assertCleanSidebar();
      await clickRoot("#project-settings");
      assert.doesNotMatch(await browser.evaluate('document.querySelector("[role=alertdialog]").innerText'), /Not needed for everyday project work/);
      await clickRoot("#acceptance-delivery");
      await browser.waitFor('!!document.querySelector(".process-dialog")');
      assert.equal(await browser.evaluate('document.querySelector("#handoff-approver, #export-handoff")'), null);
      assert.match(await browser.evaluate('document.querySelector(".process-dialog").textContent'), /No saved snapshots to accept/);
      await clickRoot("#close-acceptance-delivery");
      await browser.waitFor('document.activeElement.id==="project-settings"');
      value.goal = "Populated Preparation fixture"; value.preparation.status = "ready";
      await push(); await assertCleanSidebar();
      Object.assign(value, prepared, { revision: value.revision });
      value.lifecycle.outputs = [{ stageId: "prepare", path: ".tandem\\prepare-fixture.json", completedAt: value.updatedAt }];
      value.process.acceptances = [{ id: "historic", stageId: "prepare", snapshotPath: ".tandem\\prepare-old.json",
        acceptedBy: { label: "Historical attribution" }, acceptedAt: "2026-10-13T00:00:00Z" }];
      value.confirmed = ["A useful confirmed requirement"]; value.assumed = []; value.deferred = [];
      await push();
      await browser.waitFor('document.querySelector(".ledger-details").checkVisibility()');
      await clickRoot(".ledger-details > summary");
      assert.equal(await browser.evaluate('document.querySelector("#assumed, #deferred")'), null);
      assert.equal(await browser.evaluate('document.querySelector("#confirmed").checkVisibility()'), true);
      value.confirmed = []; await push();
      assert.equal(await browser.evaluate('document.querySelector(".ledger-details").checkVisibility()'), false);
      value.confirmed = ["A useful confirmed requirement"]; await push();
      assert.equal(await browser.evaluate('document.querySelector(".ledger-details").open'), true);
      await clickRoot("#project-settings"); await clickRoot("#acceptance-delivery");
      await browser.waitFor('!!document.querySelector("#handoff-approver")');
      assert.equal(await browser.evaluate('document.querySelector("#export-handoff")'), null, "Historical acceptance cannot export a newer snapshot.");
      await clickRoot("#process-history-toggle");
      await clickRoot('[data-ui-key="acceptance:historic"] > summary');
      await clickRoot("#handoff-approver"); await browser.call("Input.insertText", { text: "Fixture reviewer" });
      await clickRoot("#accept-handoff");
      await browser.waitFor('!!document.querySelector("[role=alertdialog]")');
      assert.match(await browser.evaluate('document.querySelector("[role=alertdialog]").textContent'), /not authenticated.*test pass.*Nothing will execute/s);
      await clickRoot('[role="alertdialog"] .dialog-actions button:last-child');
      await browser.waitFor('!!document.querySelector("#export-handoff") && !document.querySelector("#export-handoff").disabled');
      await clickRoot("#export-handoff");
      await browser.waitFor('!!document.querySelector("[role=alertdialog]")');
      await clickRoot('[role="alertdialog"] .dialog-actions button:first-child');
      assert.equal(mutations.some(item => item.body?.action === "export"), false);
      await clickRoot("#export-handoff");
      await browser.waitFor('!!document.querySelector("[role=alertdialog]")');
      await clickRoot('[role="alertdialog"] .dialog-actions button:last-child');
      await browser.waitFor('document.querySelector("#handoff-record").textContent.includes("tandem-records")');
      assert.equal(mutations.filter(item => item.body?.action === "accept").length, 1);
      assert.equal(mutations.filter(item => item.body?.action === "export").length, 1);
      await clickRoot("#process-settings-toggle");
      await clickRoot("#process-repository"); await browser.call("Input.insertText", { text: "owner/retained-draft" });
      await clickRoot("#save-process");
      await browser.waitFor('!!document.querySelector("[role=alertdialog]")');
      await clickRoot('[role="alertdialog"] .dialog-actions button:last-child');
      await browser.waitFor('document.querySelector("#process-message").textContent.includes("Fixture adapter conflict")');
      await browser.waitFor('(() => {const r=document.querySelector("#process-message").getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;})()');
      await clickRoot("#close-acceptance-delivery");
      await browser.waitFor('document.querySelector("#requirements-pane [role=alert]")?.textContent.includes("Fixture adapter conflict")');
      await clickRoot("#requirements-pane [role=alert] button");
      await browser.waitFor('!!document.querySelector(".process-dialog")');
      assert.equal(await browser.evaluate('document.querySelector("#process-repository").value'), "owner/retained-draft");
      assert.equal(await browser.evaluate('document.querySelector(\'[data-ui-key="acceptance:historic"]\').open'), true);
      assert.equal(await browser.evaluate('document.querySelector("#process-settings-toggle").getAttribute("aria-expanded")'), "true");
      await clickRoot("#close-acceptance-delivery");
      await browser.waitFor('document.activeElement.id==="project-settings"');
      await reloadRoot();
      await browser.waitFor('document.querySelector("#studio-workspace") && !document.querySelector("#studio-workspace").inert');
      assert.equal(await browser.evaluate('document.querySelector(".topbar #reload-extension, .topbar #reset-effort, .topbar #speech-sign-in")'), null);
      await clickRoot("#preparation-tab");
      await clickRoot("#preparation-maintenance > summary");
      await clickRoot("#reset-effort");
      await browser.waitFor('Boolean(document.querySelector("[role=alertdialog]"))');
      assert.match(await browser.evaluate('document.querySelector("[role=alertdialog]").textContent'),
        /Restart Preparation.*first stop active discovery work.*state\/files are archived.*Design, conversation, application files and admitted handoffs are preserved/s);
      await clickRoot('[role="alertdialog"] button');
      await browser.waitFor('document.activeElement.id==="reset-effort"');
      assert.equal(mutations.some(item => item.path === "/api/effort/reset"), false);
      await clickRoot("#project-settings");
      await browser.waitFor('Boolean(document.querySelector("#root-maintenance"))');
      await clickRoot("#root-maintenance > summary");
      assert.equal(await browser.evaluate('document.querySelector("#reload-extension").textContent.trim()'), "Reload Tandem extension");
      await clickRoot("#reload-extension");
      await browser.waitFor('!document.querySelector("#reload-extension").disabled');
      assert.equal(mutations.filter(item => item.path === "/api/reload").length, 1);
      assert.equal(active, false);
      if (process.env.TANDEM_UI_EVIDENCE) await writeFile(join(process.env.TANDEM_UI_EVIDENCE, "root-maintenance-settings.png"), await browser.screenshot());
      await clickRoot('[role="alertdialog"] button');
      await browser.waitFor('document.activeElement.id==="project-settings"');
      await browser.waitFor('!document.querySelector("[role=alertdialog]")');
      value.effortReset = { requestId: "retained-reset", generation: value.generation, error: "Worker termination is unconfirmed." };
      value.revision++;
      await browser.waitFor('document.querySelector("#preparation-maintenance").open && document.querySelector("#effort-message").textContent.includes("unconfirmed")');
      assert.equal(await browser.evaluate('document.querySelector("#studio-workspace").inert'), false);
      await clickRoot("#reset-effort");
      await browser.waitFor('Boolean(document.querySelector("[role=alertdialog]"))');
      await clickRoot('[role="alertdialog"] button');
      if (process.env.TANDEM_UI_EVIDENCE) await writeFile(join(process.env.TANDEM_UI_EVIDENCE, "preparation-restart-recovery.png"), await browser.screenshot());
      value.effortReset = null; value.revision++;
      await browser.waitFor('!document.querySelector("#effort-message").textContent.includes("unconfirmed")');
      await clickRoot("#design-tree-tab");
      await clickRoot("#usage-input"); await browser.call("Input.insertText", { text: "As a user, I retain the original Requirements input." });
      assert.equal(mutations.some(item => item.path.startsWith("/api/speech/")), false, "Typing and opening Settings do not start voice auth.");
      assert.equal(await browser.evaluate('document.querySelector("[data-ui-key=usage-input-speech-sign-in]")'), null);
      await clickRoot('[data-ui-key="usage-input-speech-toggle"]');
      await browser.waitFor('document.querySelector("[data-ui-key=usage-input-speech-sign-in]")?.textContent==="Sign in for voice input"');
      assert.equal(await browser.evaluate('document.querySelector("#usage-input").value'), "As a user, I retain the original Requirements input.");
      assert.equal(await browser.evaluate('document.querySelector("[data-ui-key=usage-input-speech-toggle]").getAttribute("aria-pressed")'), "false");
      if (process.env.TANDEM_UI_EVIDENCE) await writeFile(join(process.env.TANDEM_UI_EVIDENCE, "contextual-voice-sign-in.png"), await browser.screenshot());
      await clickRoot('[data-ui-key="usage-input-speech-sign-in"]');
      await browser.waitFor('!document.querySelector("[data-ui-key=usage-input-speech-cancel]").hidden');
      await clickRoot('[data-ui-key="usage-input-speech-cancel"]');
      await browser.waitFor('document.querySelector("#usage-input").closest(".voice-composer").textContent.includes("sign-in cancelled")');
      await browser.waitFor('document.activeElement.id==="usage-input"');
      for (let attempt = 0; !voiceLoginAborted && attempt < 100; attempt++) await new Promise(resolve => setTimeout(resolve, 20));
      assert.equal(voiceLoginAborted, true);
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
      let world = await browser.call("Page.createIsolatedWorld", { frameId: frame.frame.id, worldName: "project-ui" });
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
        assert.fail(`Embedded condition did not settle: ${expression}\n${JSON.stringify(browser.exceptions)}\nRoot style: ${await browser.evaluate('document.querySelector("#studio-workspace").getAttribute("style")')}\nPrivate layout: ${await inside('JSON.stringify({width:innerWidth,style:document.querySelector(".human-layout").getAttribute("style"),conversation:document.querySelector("#conversation-panel").getBoundingClientRect().width})')}\n${await inside('document.body.innerText')}\n${await (await fetch(new URL("api/snapshot", provider.url))).text()}`);
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
        if (!activate) return { local, offset };
        for (const type of ["mousePressed", "mouseReleased"]) await browser.call("Input.dispatchMouseEvent",
          { type, x: local.x + offset.x, y: local.y + offset.y, button: "left", clickCount: 1 });
      };
      const checkDevelopmentLayout = async label => {
        for (const [width, height] of [[1893, 1000], [1360, 1000], [980, 620], [920, 620], [841, 620], [840, 620], [390, 620], [1360, 480]]) {
          await browser.call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
          await browser.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
          const frameWidth = await browser.evaluate('document.querySelector("#project-conversation-frame").clientWidth');
          const preferred = await browser.evaluate('parseFloat(document.querySelector("#studio-workspace").style.getPropertyValue("--development-conversation-width")) || null');
          await waitInside(`innerWidth === ${frameWidth} && document.body.dataset.projectStacked === "${frameWidth <= 660}"`);
          await inside('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
          const fit = await inside(`(() => {
            const box = selector => { const e=document.querySelector(selector), r=e.getBoundingClientRect();
              return {width:r.width,height:r.height,left:r.left,right:r.right,top:r.top,bottom:r.bottom}; };
            return {design:box("#design-panel"),conversation:box("#conversation-panel"),layout:box(".human-layout"),
              composer:box("#composer"),messages:box(".conversation-layout"),
              scrollable:document.querySelector("#conversation-panel").scrollHeight>document.querySelector("#conversation-panel").clientHeight
                && getComputedStyle(document.querySelector("#conversation-panel")).overflowY==="auto",
              stacked:document.body.dataset.projectStacked==="true",
              separatorHidden:document.querySelector("#workspace-divider").hidden,
              overflow:document.documentElement.scrollWidth>innerWidth+1};
          })()`);
          assert.equal(fit.overflow, false, `${label} ${width}x${height}: ${JSON.stringify(fit)}`);
          assert.equal(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth+1'), true);
          if (!fit.stacked) {
            const share = frameWidth <= 950 ? .53 : .45;
            const expected = preferred === null ? fit.layout.width * share : Math.max(300, Math.min(fit.layout.width - 280, preferred));
            assert.ok(Math.abs(fit.conversation.width - expected) < 2,
              `Development uses its own default or explicit width: ${label} ${width}x${height} ${JSON.stringify(fit)}`);
            assert.ok(fit.conversation.width >= (preferred === null ? 340 : 300) && fit.design.width >= 280);
            assert.ok(fit.design.right <= fit.conversation.left + 1);
            assert.ok(fit.composer.bottom <= fit.conversation.bottom + 1 || fit.scrollable,
              `Composer fits or has an explicit scrolling path: ${JSON.stringify(fit)}`);
          } else {
            assert.ok(Math.abs(fit.conversation.width - fit.layout.width) <= 20);
            assert.ok(fit.design.bottom <= fit.conversation.top + 1);
          }
          assert.equal(fit.separatorHidden, fit.stacked);
          assert.ok(fit.messages.height >= 60, `Conversation retains a readable scrolling region: ${JSON.stringify(fit)}`);
          if (label.startsWith("active-question")) {
            const question = await inside(`(() => {
              const panel=document.querySelector("#question-panel"), content=document.querySelector("#questions-content"),
                row=document.querySelector("#question-panel fieldset:not([hidden])"), rect=panel.getBoundingClientRect();
              return {left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,height:rect.height,
                scroll:getComputedStyle(content).overflowY,rows:document.querySelectorAll("#question-panel fieldset:not([hidden])").length,
                overflow:content.scrollWidth>content.clientWidth+1,disabled:row.querySelector("textarea").disabled,
                draft:row.querySelector("textarea").value,theme:document.body.dataset.theme};
            })()`);
            assert.equal(question.rows, 1); assert.equal(question.overflow, false); assert.equal(question.disabled, false);
            assert.equal(question.draft, "Keep the current approved scope.");
            if (fit.stacked) {
              assert.equal(question.scroll, "visible");
              assert.ok(question.bottom <= fit.conversation.top + 1);
            } else {
              assert.ok(question.right <= fit.conversation.left + 1);
              assert.ok(question.height >= fit.design.height - 2);
            }
            if (process.env.TANDEM_UI_EVIDENCE) await writeFile(join(process.env.TANDEM_UI_EVIDENCE, `${label}-${width}x${height}.json`),
              JSON.stringify({ synthetic: true, width, height, question, ...fit }, null, 2));
          }
          for (const selector of ["#message", "#send"]) {
            const geometry = await inside(`(() => { const e=document.querySelector("${selector}"); e.scrollIntoView({block:"nearest"});
              const r=e.getBoundingClientRect(), hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
              return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,reachable:hit===e||e.contains(hit)}; })()`);
            assert.ok(geometry.left >= 0 && geometry.right <= frameWidth + 1 && geometry.width > 20 && geometry.height > 20);
            assert.ok(geometry.reachable, `Composer control is reachable at ${label} ${width}x${height}: ${JSON.stringify(geometry)}`);
          }
          t.diagnostic(`${label} ${width}x${height}: Design ${Math.round(fit.design.width)}px, Conversation ${Math.round(fit.conversation.width)}px, stacked=${fit.stacked}`);
          if (label.startsWith("active-question")) await inside(`document.querySelector("#questions-content").scrollTop=0;
            document.querySelector(".human-layout").scrollTop=0`);
          if (process.env.TANDEM_UI_EVIDENCE) await writeFile(join(process.env.TANDEM_UI_EVIDENCE, `${label}-${width}x${height}.png`), await browser.screenshot());
        }
        await browser.call("Emulation.setDeviceMetricsOverride", { width: 1360, height: 1000, deviceScaleFactor: 1, mobile: false });
        await waitInside('document.body.dataset.projectStacked==="false"');
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
      await checkDevelopmentLayout("startup-error");
      assert.equal(await inside('document.querySelector("#message").disabled && document.querySelector("#send").disabled'), true);
      assert.equal(nativeRequests.length, 0);
      await click("#initialize", true);
      await waitInside('!document.querySelector("#send").disabled');
      emptyDesign = true; events.touch();
      await waitInside('document.querySelector("#assessment-card").textContent.includes("No Design has been published")');
      await checkDevelopmentLayout("verified-empty-design");
      emptyDesign = false; events.touch();
      await waitInside('document.querySelector(".shared-sketch") !== null');
      await checkDevelopmentLayout("active-design");
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
        await waitInside('document.body.dataset.projectStacked==="true"');
        assert.equal(await browser.evaluate('document.querySelector("#project-conversation-frame").hidden && document.querySelector("#project-conversation-frame").getBoundingClientRect().height === 0'), true,
          `Private chat is not visible in an earlier phase at ${width}px.`);
        await browser.waitFor('document.querySelector("#discovery-history").hidden');
        assert.equal(await browser.evaluate('document.querySelector("#discovery-history").checkVisibility()'), false,
          "Unchosen secondary history collapses at a constrained width rather than taking artifact space.");
      }
      await browser.call("Emulation.setDeviceMetricsOverride", { width: 1360, height: 1000, deviceScaleFactor: 1, mobile: false });
      await click("#development-tab");
      await waitInside('document.body.dataset.projectDesign==="true" && document.body.dataset.projectStacked==="false"');
      assert.equal(await inside('document.querySelector("#messages").textContent.includes("Discovery evidence")'), false);
      assert.equal(await browser.evaluate('document.querySelector("#discovery-history") === null'), true);
      const checkRootChrome = async () => {
        const styles = await browser.evaluate(`["#project-settings","#project-current-work",".topbar"].map(selector=>{
          const element=document.querySelector(selector), style=getComputedStyle(element);
          return {selector,background:style.backgroundColor,color:style.color,height:element.getBoundingClientRect().height};
        })`);
        const luminance = color => {
          const channels = color.match(/[\d.]+/g).slice(0, 3).map(value => {
            const channel = Number(value) / (color.startsWith("color(srgb ") ? 1 : 255);
            return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
          });
          return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
        };
        for (const item of styles) {
          assert.match(item.background, /^rgb\(/, `${item.selector} needs an opaque background, not ${item.background}`);
          const values = [luminance(item.background), luminance(item.color)].sort((a, b) => b - a);
          assert.ok((values[0] + .05) / (values[1] + .05) >= 4.5, `${item.selector} needs readable contrast.`);
          assert.ok(item.height >= 30, `${item.selector} uses the actual shared control geometry.`);
        }
        await browser.waitFor('Boolean(document.querySelector("#development-tab .current-phase"))');
        const marker = await browser.evaluate(`(() => {const row=document.querySelector("#development-tab"),
          dot=row.querySelector(".current-phase");return {color:getComputedStyle(dot).color,
            background:getComputedStyle(row).backgroundColor,title:dot.title,name:row.getAttribute("aria-label"),
            current:row.getAttribute("aria-current"),passive:row.querySelectorAll(".project-availability").length};})()`);
        for (const color of [marker.color, marker.background]) assert.match(color, /^(rgb\(|color\(srgb )/);
        const values = [luminance(marker.color), luminance(marker.background)].sort((a, b) => b - a);
        assert.ok((values[0] + .05) / (values[1] + .05) >= 3, `Current-phase marker contrast: ${JSON.stringify(marker)}`);
        assert.equal(marker.title, "Current phase");
        assert.equal(marker.current, "step");
        assert.equal(marker.passive, 0, "Current Development uses one marker while retaining Design availability in its accessible name.");
        assert.equal(marker.name, "Development, Current phase, Design available");
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
      for (const [width, height] of [[1360, 900], [920, 620], [390, 620], [1360, 480], [390, 480]]) {
        await browser.call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
        await click("#project-settings");
        await waitInside('document.querySelector("#canvas-settings").open');
        await click("#acceptance-delivery", true);
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
        await browser.waitFor('!document.querySelector(".process-dialog") && document.activeElement.id==="project-settings"');
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
      assert.equal(await inside('document.querySelector("#project-message-context p").hidden'), true);
      assert.equal(await inside('document.querySelector("#project-message-context p").textContent'), "");
      assert.equal(await inside('document.querySelector("#project-message-context").checkVisibility()'), false);
      await click("#design-tree-tab");
      await waitInside('document.body.dataset.projectDesign==="false"');
      assert.equal(await browser.evaluate('document.querySelector("#project-conversation-frame").hidden'), true);
      assert.equal(await inside('document.querySelector("#message").value'), "As a user, I keep my draft while viewing Design.");
      const returnedWidth = await conversationWidth();
      assert.ok(Math.abs(returnedWidth - 320) < 2, "Development resizing must not widen Discovery's read-only history.");
      await click("#project-conversation-divider");
      await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowRight", windowsVirtualKeyCode: 39 });
      await browser.waitFor(`Math.abs(document.querySelector("#project-conversation").getBoundingClientRect().width-300)<2`);
      await click("#development-tab");
      await waitInside(`document.body.dataset.projectDesign==="true" && Math.abs(document.querySelector("#conversation-panel").getBoundingClientRect().width-${initialWidth + 10})<2`);
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
      value.provider = { ...value.provider, canReload: true }; value.revision++;
      await waitInside('!document.querySelector("#project-provider-maintenance").hidden');
      assert.equal(await inside('document.querySelector("#project-reload-extension").textContent'), "Reload Tandem extension");
      assert.equal(await inside('document.querySelector("#project-reload-extension").disabled'), true,
        "Composed diagnostics cannot reload an active private runtime.");
      assert.equal(await inside('document.querySelector("#project-provider-maintenance").closest("section").getAttribute("aria-labelledby")'), "diagnostics-settings-title");
      await inside('document.querySelector("#project-provider-maintenance").scrollIntoView({block:"nearest"})');
      if (process.env.TANDEM_UI_EVIDENCE) await writeFile(join(process.env.TANDEM_UI_EVIDENCE, "composed-maintenance-settings.png"), await browser.screenshot());
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
        if (process.env.TANDEM_UI_EVIDENCE) await writeFile(join(process.env.TANDEM_UI_EVIDENCE, `design-marker-theme-${theme}.png`), await browser.screenshot());
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
      const longDraft = "UnbrokenComposerDraft".repeat(35) + "\nA short second line";
      for (const [width, height] of [[1360, 1000], [920, 620], [390, 620], [1360, 480]]) for (const theme of ["light", "dark"]) {
        await browser.call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
        await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        const frameWidth = await browser.evaluate('document.querySelector("#project-conversation-frame").clientWidth');
        await waitInside(`innerWidth===${frameWidth} && document.body.dataset.projectStacked==="${frameWidth <= 660}"`);
        await inside('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        await browser.evaluate(`document.documentElement.dataset.projectTheme=${JSON.stringify(theme)}`);
        await inside(`document.body.dataset.theme=${JSON.stringify(theme)};
          document.querySelector("#message").value=${JSON.stringify(longDraft)};
          document.querySelector("#message").dispatchEvent(new Event("input",{bubbles:true}))`);
        await click("#message", true);
        await inside('document.querySelector("#message").setSelectionRange(3,9);document.querySelector("#message").scrollTop=0');
        const focus = await inside(`(() => {
          const input=document.querySelector("#message"),r=input.getBoundingClientRect(),send=document.querySelector("#send").getBoundingClientRect(),
            style=getComputedStyle(input),outline=parseFloat(style.outlineWidth),offset=parseFloat(style.outlineOffset);
          return {outline,offset,color:style.outlineColor,right:r.right+outline+offset,sendLeft:send.left,
            padding:parseFloat(style.paddingLeft),horizontalOverflow:input.scrollWidth>input.clientWidth+1,
            idleContextHeight:document.querySelector("#project-message-context p").getBoundingClientRect().height,
            contextHeight:document.querySelector("#project-message-context").getBoundingClientRect().height,
            roleHelpHeight:document.querySelector("#role-hint-help").getBoundingClientRect().height,
            describedBy:input.getAttribute("aria-describedby"),
            start:input.selectionStart,end:input.selectionEnd,text:input.value,focused:document.activeElement===input};
        })()`);
        assert.ok(focus.outline >= 2 && focus.offset <= -focus.outline && focus.padding >= 4, JSON.stringify({ width, height, theme, ...focus }));
        assert.ok(focus.right <= focus.sendLeft + 1 && !focus.horizontalOverflow, JSON.stringify({ width, height, theme, ...focus }));
        assert.deepEqual([focus.start, focus.end, focus.text, focus.focused], [3, 9, longDraft, true]);
        assert.deepEqual([focus.contextHeight, focus.idleContextHeight, focus.roleHelpHeight, focus.describedBy], [0, 0, 0, null]);
        if (process.env.TANDEM_UI_EVIDENCE) {
          await inside('document.querySelector("#composer").scrollIntoView({block:"end"})');
          await browser.evaluate('document.querySelector("#project-conversation-frame").scrollIntoView({block:"end"})');
          await writeFile(join(process.env.TANDEM_UI_EVIDENCE, `composer-focus-${width}x${height}-${theme}.png`), await browser.screenshot());
          await writeFile(join(process.env.TANDEM_UI_EVIDENCE, `composer-focus-${width}x${height}-${theme}.json`), JSON.stringify(focus, null, 2));
        }
      }
      assert.equal(nativeRequests.length, 1, "Focus and long-text editing do not send or duplicate a request.");
      await inside('document.querySelector("#message").value="";document.querySelector("#message").dispatchEvent(new Event("input",{bubbles:true}))');
      await browser.call("Emulation.setDeviceMetricsOverride", { width: 1360, height: 1000, deviceScaleFactor: 1, mobile: false });
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
      nativeState.questions.push({ id: "scope-question", question: "Which scope should we retain?",
        context: "Saved project scope: the reader must understand the consequences before choosing a change. ".repeat(8),
        whyItMatters: "Avoid unintended changes", importance: "blocking",
        options: Array.from({ length: 8 }, (_, i) => ({ id: `scope-${i}`, label: `Scope ${i + 1}`,
          implication: `Scope ${i + 1} keeps the agreed behavior and makes this navigation choice explicit.` })), allowFreeform: true,
        state: "open", blockingActive: true, source: { role: "designer", resultId: "question-result",
          requestId, requestIds: [requestId], cycleId: null, design: designBinding, planDigest: null } });
      events.touch();
      await waitInside('!document.querySelector("#show-questions").disabled');
      assert.equal(await inside('document.querySelector("#question-panel").hidden'), true, "New questions cannot switch the workspace.");
      await click("#show-questions", true);
      await click("#question-panel fieldset select", true);
      for (const [key, windowsVirtualKeyCode] of [["End", 35], ["Enter", 13]]) {
        await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key, windowsVirtualKeyCode });
        await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key, windowsVirtualKeyCode });
      }
      await click('#question-panel textarea', true);
      await browser.call("Input.insertText", { text: "Keep the current approved scope." });
      for (const theme of ["light", "dark"]) {
        await inside(`document.body.dataset.theme=${JSON.stringify(theme)}`);
        await browser.evaluate(`document.documentElement.dataset.projectTheme=${JSON.stringify(theme)}`);
        await checkDevelopmentLayout(`active-question-${theme}`);
      }
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
      await checkDevelopmentLayout("active-permissions");
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
          const conversation = document.querySelector("#conversation-panel").getBoundingClientRect();
          return { width: bounds.width, panel: {left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom},
            conversation: {left: conversation.left, right: conversation.right, width: conversation.width},
            viewport: {width: innerWidth, height: innerHeight}, overflow: panel.scrollWidth > panel.clientWidth + 1,
            clipped: nodes.filter(node => { const rect = node.getBoundingClientRect();
              return rect.left < bounds.left || rect.right > bounds.right || node.scrollWidth > node.clientWidth + 1;
            }).map(node => ({ tag: node.tagName, text: node.textContent.slice(0, 60), width: node.getBoundingClientRect().width })) };
        })()`);
        if (process.env.TANDEM_UI_EVIDENCE) await writeFile(join(process.env.TANDEM_UI_EVIDENCE, `permission-multiple-${width}.png`), await browser.screenshot());
        assert.ok(!fit.overflow && !fit.clipped.length, `Permission contents fit at ${width}: ${JSON.stringify(fit)}`);
        await click("#access-requests > .access-card:not([hidden]) .access-request-details > summary", true);
        await click("#access-requests > .access-card:not([hidden]) .access-request-details > summary", true);
        const decisions = {};
        for (const decision of ["once", "denied"]) decisions[decision] =
          await click(`#access-requests > .access-card:not([hidden]) [data-access-decision=${decision}]`, true, false);
        if (process.env.TANDEM_UI_EVIDENCE) {
          await writeFile(join(process.env.TANDEM_UI_EVIDENCE, `permission-geometry-${width}.json`), JSON.stringify({
            rootViewport: { width, height: 620 }, fixture: process.env.TANDEM_PERMISSION_FIXTURE ?? "synthetic",
            requestIds: permissionIds, fit, decisions, nativeDecisionsIssued: false,
          }, null, 2));
          await writeFile(join(process.env.TANDEM_UI_EVIDENCE, `permission-controls-${width}.png`), await browser.screenshot());
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
        for (const mode of ["available", "new-output"]) {
          if (mode === "new-output") {
            await click("#preparation-tab");
            currentDesignBinding = { revisionId: `fixture-design-${width}`, digest: "e".repeat(64) };
            nativeState.design = currentDesignBinding;
            events.touch();
            await browser.waitFor('document.querySelector("#development-tab .artifact-count")?.textContent==="New output"');
          }
          const fit = await browser.evaluate(`(() => {
            const row=document.querySelector("#development-tab"), list=document.querySelector("#project-contents");
            const badge=row.querySelector(".artifact-count") ?? row.querySelector(".current-phase"), label=row.querySelector(".project-tab-label");
            const r=row.getBoundingClientRect(), b=badge.getBoundingClientRect(), l=label.getBoundingClientRect();
            return {sidebar:document.querySelector("#requirements-pane").getBoundingClientRect().width,
              rowFits:row.scrollWidth<=row.clientWidth+1,listFits:list.scrollWidth<=list.clientWidth+1,
              labelFits:l.left>=r.left&&l.right<=r.right,label:label.textContent,
              badgeFits:b.left>=r.left&&b.right<=r.right,badge:badge.textContent,title:badge.title,
              sameRow:Math.abs((b.top+b.bottom)/2-(l.top+l.bottom)/2)<1,
              name:row.getAttribute("aria-label"),selected:row.getAttribute("aria-selected"),
              current:row.getAttribute("aria-current"),passive:row.querySelectorAll(".project-availability").length};
          })()`);
          assert.equal(fit.label, "Development");
          assert.equal(fit.badge, mode === "available" ? "" : "New output");
          assert.equal(fit.selected, mode === "available" ? "true" : "false");
          assert.equal(fit.name, `Development, Current phase, ${mode === "available" ? "Design available" : "New Design output"}`);
          assert.equal(fit.current, "step");
          assert.equal(fit.passive, 0);
          if (mode === "available") {
            assert.equal(fit.title, "Current phase");
            assert.equal(fit.sameRow, true, "The current-phase marker stays beside Development, not on a second row.");
          }
          assert.ok(fit.rowFits && fit.listFits && fit.labelFits && fit.badgeFits,
            `Navigation keeps full labels and ${mode} without horizontal scrolling at ${width}: ${JSON.stringify(fit)}`);
          if (width === 980) assert.equal(fit.sidebar, 180);
          if (process.env.TANDEM_UI_EVIDENCE) await writeFile(join(process.env.TANDEM_UI_EVIDENCE, `design-marker-${mode}-${width}.png`), await browser.screenshot());
        }
        await click("#development-tab");
        await browser.waitFor('Boolean(document.querySelector("#development-tab .current-phase")) && !document.querySelector("#development-tab .artifact-count")');
        assert.equal(await browser.evaluate('document.activeElement.id'), "development-tab");
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
      startingPath = "development"; active = false; installationStatus = "prepared";
      await reloadRoot();
      await browser.waitFor('document.querySelector("#studio-workspace")?.dataset.development==="true" && Boolean(document.querySelector("#project-conversation-frame"))');
      for (let attempt = 0; attempt < 100; attempt++) {
        const tree = await browser.call("Page.getFrameTree");
        const next = tree.frameTree.childFrames?.find(item => item.frame.url.startsWith(provider.url));
        if (next) { frame = next; break; }
        await new Promise(done => setTimeout(done, 30));
      }
      world = await browser.call("Page.createIsolatedWorld", { frameId: frame.frame.id, worldName: "direct-development-ui" });
      await waitInside('document.body.dataset.projectWorking==="development" && document.querySelector("#notice").textContent.includes("not a git repository")');
      await checkDevelopmentLayout("direct-development-error");
      assert.equal(nativeRequests.length, 2, "Direct entry and layout cannot send model requests or repair Git.");
      const beforeDrag = await inside('document.querySelector("#conversation-panel").getBoundingClientRect().width');
      const drag = async cancel => {
        const point = await click("#workspace-divider", true, false);
        const x = point.local.x + point.offset.x, y = point.local.y + point.offset.y;
        await browser.call("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
        await browser.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: x - 80, y, button: "left", buttons: 1 });
        await waitInside(`Math.abs(document.querySelector("#conversation-panel").getBoundingClientRect().width-${beforeDrag + 80})<2`);
        if (cancel) await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", windowsVirtualKeyCode: 27 });
        await browser.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: x - 80, y, button: "left", clickCount: 1 });
      };
      await drag(true);
      await waitInside(`Math.abs(document.querySelector("#conversation-panel").getBoundingClientRect().width-${beforeDrag})<2`);
      await browser.waitFor('document.querySelector("#studio-workspace").style.getPropertyValue("--development-conversation-width")===""');
      assert.equal(await browser.evaluate('document.querySelector("#studio-workspace").style.getPropertyValue("--development-conversation-width")'), "",
        "Cancelling the first drag restores responsive defaults, not a fixed pixel width.");
      await drag(false);
      await browser.call("Emulation.setDeviceMetricsOverride", { width: 390, height: 620, deviceScaleFactor: 1, mobile: false });
      await waitInside('document.body.dataset.projectStacked==="true"');
      await browser.call("Emulation.setDeviceMetricsOverride", { width: 1893, height: 1000, deviceScaleFactor: 1, mobile: false });
      await waitInside(`!document.querySelector("#workspace-divider").hidden && Math.abs(document.querySelector("#conversation-panel").getBoundingClientRect().width-${beforeDrag + 80})<2`);
      await click("#workspace-divider", true);
      for (const [key, code, conversation] of [["End", 35, 300], ["Home", 36, null]]) {
        await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key, windowsVirtualKeyCode: code });
        await waitInside(conversation ? `Math.abs(document.querySelector("#conversation-panel").getBoundingClientRect().width-${conversation})<2`
          : 'Math.abs(document.querySelector("#design-panel").getBoundingClientRect().width-280)<2');
        assert.equal(await inside('document.activeElement.id'), "workspace-divider");
        assert.match(await inside('document.querySelector("#workspace-divider").getAttribute("aria-valuetext")'), /Design \d+%, Conversation \d+%/);
      }
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
