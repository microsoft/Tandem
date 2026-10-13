import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { HumanLoopStore } from "../src/human-loop-store.mjs";
import { HumanLoopWorkspace } from "../src/human-loop-workspace.mjs";
import { HumanLoopTransport } from "../src/human-loop-transport.mjs";
import { createHumanTask, humanInputEnvelope } from "../src/human-loop-task.mjs";
import { DEFAULT_POLICY, resolvePolicy } from "../runtime-src/domain/workflow/policy.ts";
import { PermissionBroker } from "../runtime-src/permissions/permission-broker.ts";
import { InMemoryEventStore } from "../runtime-src/event-store.ts";
import { AnnotationAttachmentStore } from "../runtime-src/domain/workflow/annotation-attachment.ts";
import { ImageAttachmentStore } from "../runtime-src/domain/workflow/image-attachment.ts";
import jpeg from "../node_modules/jpeg-js/index.js";
import { replayHumanLoopLedger } from "../runtime-src/domain/human-loop/ledger.ts";
import { waitFor } from "./helpers/native-session-fixture.mjs";
import { humanLoopResultTools } from "../runtime-src/domain/human-loop/tool-contracts.ts";
import { nativeShellHookFixture, retainedShellHook } from "./helpers/native-shell-history-fixture.mjs";
import { nativeCloseEvents, validateNativeReopen } from "../src/human-loop-close.mjs";
import { syntheticAssistantOpaqueFields } from "./helpers/native-assistant-history-fixture.mjs";
import { HostStateFile } from "../runtime-src/domain/host-state-file.ts";

async function replayDurableState(root) {
  const file = new HostStateFile(root, join(root, ".tandem", "living-canvas", "human-loop", "ledger.json"));
  return replayHumanLoopLedger(JSON.parse(await file.read()));
}

async function observeLongRole(t, f, task) {
  const completion = f.transport.waitForResult(task.binding.id);
  completion.catch(() => {});
  await f.transport.drain();
  assert.equal((await f.store.load()).activeTask.result, null);
  assert.equal(f.session.aborts, 0);
  return { completion };
}

const git = async (root, ...args) => (await promisify(execFile)("git", ["-C", root, ...args])).stdout.trim();
const design = { revisionId: "design", digest: "a".repeat(64) };
class Session {
  factoryRuns = new Map();
  scopeRoots = new Map();
  scopeEnds = new Map();
  cancelledFactories = [];
  workflow = {
    getRun: async id => structuredClone(this.factoryRuns.get(id)),
    cancel: async id => {
      this.cancelledFactories.push(id);
      const run = this.factoryRuns.get(id);
      assert.ok(run);
      run.status = "cancelled";
      this.emit("workflow.run_settled", { runId: id, status: "cancelled" });
      return structuredClone(run);
    },
  };
  internImages = false;
  terminalIdle = true;
  suppressTurnEnd = false;
  turnId = "0";
  completeTool = true;
  stopPending = false;
  serializedHookArgs = false;
  sessionId = "private"; history = []; calls = 0; processing = false; sends = []; onSend = null; onImmediate = null; aborts = 0;
  rpc = {
    name: { set: async () => {} },
    interruptMainTurn: async input => {
      assert.deepEqual(input, { flushQueued: true });
      await this.abort(); return { interrupted: true };
    },
    abort: async (input) => {
      assert.deepEqual(input, { reason: "remote_command" });
      await this.abort(); return { success: true };
    },
    mode: { get: async () => "interactive" },
    metadata: { isProcessing: async () => ({ processing: this.processing }), activity: async () => ({ hasActiveWork: false }) },
    queue: { pendingItems: async () => ({ items: [], steeringMessages: [] }) },
  };
  emit(type, data, parentId = this.history.at(-1)?.id ?? null, overrides = {}) {
    const event = { id: `event-${++this.calls}`, type, data, parentId, timestamp: new Date().toISOString(), ...overrides };
    if (type !== "assistant.idle") this.history.push(event);
    this.config.onEvent(event);
  }
  async getEvents() {
    const events = structuredClone(this.history);
    if (this.internImages) for (const event of events) {
      if (event.type !== "user.message" || !event.data.attachments) continue;
      event.data.attachments = event.data.attachments.map(({ data, ...attachment }) => {
        const bytes = Buffer.from(data, "base64");
        return { ...attachment, assetId: `sha256:${createHash("sha256").update(bytes).digest("hex")}`, byteLength: bytes.length };
      });
    }
    return events;
  }
  async send(options) {
    if (options.prompt.startsWith("The user requested Stop for this exact request and role.")) {
      this.stopPending = true;
      assert.equal(options.agentMode, "interactive");
      this.sends.push(options);
      const messageId = `message-${this.sends.length}`;
      if (this.onImmediate) return this.onImmediate(options, messageId);
      this.emit("user.message", { content: options.prompt, messageId, interactionId: this.interactionId, turnId: "0", delivery: "steering" });
      return messageId;
    }
    assert.equal(options.mode, "immediate"); assert.equal(options.agentMode, "interactive");
    this.sends.push(options); this.processing = true;
    this.messageId = `message-${this.sends.length}`; this.interactionId = `interaction-${this.sends.length}`; this.turnId = "0";
    const messageId = this.messageId;
    this.emit("user.message", { content: options.prompt, messageId: this.messageId, interactionId: this.interactionId, turnId: this.turnId, delivery: "idle",
      ...(options.attachments ? { attachments: structuredClone(options.attachments) } : {}) });
    this.emit("assistant.turn_start", { turnId: this.turnId, interactionId: this.interactionId });
    await this.onSend?.(JSON.parse(options.prompt.split("\n").at(-1)));
    return messageId;
  }

  async abort() { this.aborts++; this.processing = false; this.emit("assistant.idle", { aborted: true }); }
  async disconnect() {}
  async call(name, args) {
    const tool = this.config.tools.find((tool) => tool.name === name);
    const invocation = { sessionId: this.sessionId, toolName: name, toolCallId: `call-${++this.calls}`, arguments: args };
    const allowed = await this.config.hooks.onPreToolUse({
      sessionId: this.sessionId, toolName: name, toolArgs: this.serializedHookArgs ? JSON.stringify(args) : args,
    }, { sessionId: this.sessionId });
    assert.notEqual(allowed.permissionDecision, "deny", allowed.permissionDecisionReason);
    if (tool.skipPermission === false) {
      const permission = await this.config.onPermissionRequest({
        kind: "custom-tool", toolName: name, toolDescription: tool.description, toolCallId: invocation.toolCallId, args,
      }, { sessionId: this.sessionId });
      if (!["approve-once", "approve-for-session"].includes(permission.kind)) throw new Error("Permission rejected or withdrawn.");
    }
    let result;
    try { result = await tool.handler(args, invocation); }
    catch (error) {
      if (this.completeTool) this.emit("tool.execution_complete", { toolCallId: invocation.toolCallId, success: false,
        turnId: this.turnId, interactionId: this.interactionId });
      throw error;
    }
    if (this.completeTool) {
      this.emit("tool.execution_complete", { toolCallId: invocation.toolCallId, success: true,
        turnId: this.turnId, interactionId: this.interactionId });
      if (tool.isTerminal && !this.stopPending) {
        if (!this.suppressTurnEnd) this.endTurn();
        if (this.terminalIdle) this.endIdle();
      }
      if (name === "acknowledge_human_stop") this.stopPending = false;
    }
    return result;
  }
  endTurn() { this.emit("assistant.turn_end", { turnId: this.turnId, interactionId: this.interactionId, aborted: false }); }
  endIdle() { this.processing = false; this.emit("assistant.idle", { aborted: false }); }
  endNormally() { this.endTurn(); this.endIdle(); }
}

async function fixture(t, { permission = false, nativeFiles = false, now, terminalIdle = true, suppressTurnEnd = false, reviewGraceMs, closeInCleanup = true,
  privateSessionId = "private" } = {}) {
  const root = await mkdtemp(join(process.cwd(), ".human-loop-transport-"));
  await git(root, "init", "--quiet");
  await writeFile(join(root, "app.js"), "export const original = 1;\n");
  await git(root, "add", ".");
  await git(root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "Fixture");
  await writeFile(join(root, "app.js"), "export const original = 2; // pre-existing edit\n");
  const policy = reviewGraceMs === undefined ? DEFAULT_POLICY : resolvePolicy({ time: { reviewGraceMs } });
  const owner = { schemaVersion: "human-loop-owner/v1", id: "owner", mainSessionId: "main", privateSessionId,
    workspacePath: root, policy };
  let authorized = true;
  const verifyOwnership = async () => { assert.equal(authorized, true, "Owner is not authorized."); };
  const store = new HumanLoopStore(owner);
  await store.initialize(design);
  const workspace = new HumanLoopWorkspace({ owner, verifyOwnership });
  await workspace.initialize();
  const baseline = await workspace.capture();
  const session = new Session(), broker = new PermissionBroker(new InMemoryEventStore()), progress = [];
  session.sessionId = privateSessionId;
  session.terminalIdle = terminalIdle;
  session.suppressTurnEnd = suppressTurnEnd;
  const tools = [
    { name: "read_project_file", description: "Read a project file.", roles: ["agent", "implementer", "reviewer", "planner"],
      parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false },
      execute: ({ path }) => workspace.read(path) },
    { name: "replace_project_file", description: "Replace an internally accepted scoped file.", roles: ["implementer"],
      parameters: { type: "object", properties: { path: { type: "string" }, expectedDigest: { type: "string" }, content: { type: "string" } },
        required: ["path", "expectedDigest", "content"], additionalProperties: false },
      execute: (args, { task }) => workspace.replace(args, task.context.scope) },
    ...(permission ? [{ name: "run_owned_check", description: "Run the requested check.", roles: ["agent"], requiresPermission: true,
      parameters: { type: "object", properties: {}, additionalProperties: false }, execute: async () => "Checked" }] : []),
  ];
  const client = { createSession: async (config) => { session.config = config; return session; }, stop: async () => [],
    rpc: { sessions: { save: async () => {},
      readPersistedEvents: async () => ({ events: structuredClone(session.history), cursorStatus: "ok", hasMore: false }) } } };
  const transport = new HumanLoopTransport({
    owner, client, workspace, store, tools: nativeFiles ? [] : tools, nativeFiles, verifyOwnership, now,
    onProgress: event => { progress.push(event); },
    permissionHandler: (request, invocation, lifetime) => broker.request(request, invocation, lifetime.signal,
      lifetime.onceOnly ? { onceOnly: true, provenance: lifetime.provenance,
        nativeSessionGrantEligible: lifetime.nativeSessionGrantEligible } : {}),
    authorizeTool: async (packet, name) => {
      const state = await store.load();
      assert.equal(state.activeTask.binding.id, packet.binding.id);
      if (name === "replace_project_file") {
        const cycle = state.cycles.find(({ id }) => id === packet.binding.cycleId);
        assert.equal(cycle.acceptance.authority, "host");
        assert.equal(cycle.plan.digest, cycle.acceptance.planDigest);
      }
    },
  });
  await transport.create();
  t.after(async () => {
    if (closeInCleanup) {
      try { await transport.close(); } catch { assert.ok((await store.load()).uncertainty || (await store.load()).activeTask); }
    }
    await store.close(); await rm(root, { recursive: true, force: true });
  });
  let sequence = 0;
  const dispatch = (authority, type, data) => store.dispatch(authority, `command-${++sequence}`, type, data);
  const begin = async (role, cycleId = null, internalTaskId = null, context = {}) => {
    const state = await store.load();
    const packet = createHumanTask({ id: `task-${++sequence}`, dispatchId: `dispatch-${sequence}`, sessionId: privateSessionId,
      requestId: state.activeRequestId, role, cycleId, internalTaskId, design: state.design,
      before: cycleId ? state.cycles.find(({ id }) => id === cycleId).current : await workspace.capture() }, context);
    await transport.send(packet); return packet;
  };
  const finish = async (packet, name, outcome) => {
    await session.call(name, { schemaVersion: "human-role-result/v1", resultId: `result-${packet.binding.id}`,
      inputDigest: packet.binding.inputDigest, outcome });
    await transport.drain();
    const result = await transport.waitForResult(packet.binding.id);
    await dispatch("host", "record-result-snapshot", {
      taskId: packet.binding.id, resultId: result.resultId, snapshot: await workspace.capture(),
    });
    const state = await store.load();
    await dispatch("host", "apply-result", { resultId: state.activeTask.result.resultId, designPublication: null });
    transport.release(packet.binding.id);
    if (outcome.kind === "route" && ["implement", "resume-cycle", "replan-cycle"].includes(outcome.intent)) {
      const confirmationId = `confirmation:${result.resultId}`;
      await dispatch("host", "request-implementation-confirmation", { id: confirmationId,
        requestId: packet.binding.requestId, routeResultId: result.resultId, design: packet.binding.design,
        createdAt: "2026-09-28T10:00:00Z" });
      await dispatch("user", "decide-implementation-confirmation", { confirmationId,
        decision: "approved", decidedAt: "2026-09-28T10:01:00Z" });
    }
    return result;
  };
  const request = async () => {
    const id = `request-${++sequence}`;
    await dispatch("user", "receive-request", { id, message: "Exact request.", receivedAt: new Date().toISOString(), answers: null });
    await dispatch("host", "admit-request", { requestId: id }); return id;
  };
  return { root, owner, store, workspace, baseline, transport, session, client, broker, progress, dispatch, begin, finish, request,
    revoke: () => { authorized = false; } };
}

function capturedDispatch(session, order = ["user", "start", "ack"], change = () => {}, turnFor = number => String(number - 1)) {
  const pending = [];
  session.send = async options => {
    session.sends.push(options);
    const number = session.sends.length, acknowledgement = `sdk-ack-${number}`;
    session.messageId = acknowledgement; session.interactionId = `native-interaction-${number}`;
    session.turnId = turnFor(number);
    const { turnId, interactionId } = session;
    const user = { content: options.prompt, transformedContent: options.prompt,
      attachments: structuredClone(options.attachments ?? []), supportedNativeDocumentMimeTypes: [],
      agentMode: "interactive", delivery: "idle", interactionId: session.interactionId,
      parentAgentTaskId: "00000000-0000-4000-8000-000000000111" };
    change(user, options);
    const emit = type => type === "user"
      ? session.emit("user.message", user)
      : session.emit("assistant.turn_start", { turnId, interactionId });
    let acknowledged = false;
    for (const part of order) {
      if (part === "ack") acknowledged = true;
      else if (acknowledged) pending.push(() => emit(part));
      else emit(part);
    }
    return acknowledgement;
  };
  return () => { for (const emit of pending.splice(0)) emit(); };
}

const capturedOrders = [
  ["user", "start", "ack"], ["start", "user", "ack"], ["ack", "user", "start"],
  ["ack", "start", "user"], ["user", "ack", "start"], ["start", "ack", "user"],
];
test("serialized SDK hook arguments admit the exact Router result without changing its handler payload", async t => {
  const f = await fixture(t);
  capturedDispatch(f.session);
  await f.request(); const packet = await f.begin("router");
  f.session.serializedHookArgs = true;
  const result = await f.finish(packet, "submit_human_route", { kind: "route", intent: "design", cycleId: null,
    summary: "Continue the retained Design.", resolvedQuestions: [] });
  assert.equal(result.inputDigest, packet.binding.inputDigest);
  assert.equal(result.outcome.intent, "design");
  assert.equal((await f.store.load()).uncertainty, null);
  assert.deepEqual((await replayDurableState(f.root)).state, await f.store.load());
});

test("serialized SDK hook arguments preserve exact native invocation matching", async t => {
  const f = await fixture(t, { nativeFiles: true });
  await f.request(); const packet = await f.begin("router");
  const args = { path: "app.js" };
  f.session.emit("tool.execution_start", { toolCallId: "serialized-read", toolName: "view", arguments: args,
    turnId: f.session.turnId, interactionId: f.session.interactionId });
  assert.deepEqual(await f.session.config.hooks.onPreToolUse({
    sessionId: "private", toolName: "view", toolArgs: JSON.stringify(args),
  }, { sessionId: "private" }), {});
  f.session.emit("tool.execution_complete", { toolCallId: "serialized-read", success: true,
    turnId: f.session.turnId, interactionId: f.session.interactionId });
  await f.finish(packet, "submit_human_route", { kind: "route", intent: "answer", cycleId: null,
    summary: "Read complete.", resolvedQuestions: [] });
});

test("serialized SDK hook admission matches object permission and handler arguments without granting consent", async t => {
  const f = await fixture(t, { permission: true });
  await f.request();
  const route = await f.begin("router");
  await f.finish(route, "submit_human_route", { kind: "route", intent: "answer", cycleId: null,
    summary: "Read only.", resolvedQuestions: [] });
  const packet = await f.begin("agent");
  f.session.serializedHookArgs = true;
  const result = f.session.call("run_owned_check", {});
  await waitFor(() => f.broker.list().length === 1, "real permission after serialized hook");
  await f.broker.decide(f.broker.list()[0].id, "once");
  assert.equal(await result, "Checked");
  const tool = f.session.config.tools.find(tool => tool.name === "run_owned_check");
  await assert.rejects(tool.handler({}, { sessionId: "private", toolName: tool.name, toolCallId: "unapproved-second" }),
    /genuine permission grant/);
  await f.finish(packet, "submit_readonly_answer", { kind: "answer", summary: "One consented call.",
    report: "The once-only grant authorized exactly the admitted arguments.", evidenceRefs: [] });
});

test("serialized SDK hook arguments do not grant malformed, primitive, foreign or mismatched result authority", async t => {
  const f = await fixture(t);
  await f.request(); const packet = await f.begin("router");
  const valid = { schemaVersion: "human-role-result/v1", resultId: "valid", inputDigest: packet.binding.inputDigest,
    outcome: { kind: "route", intent: "design", cycleId: null, summary: "Design only.", resolvedQuestions: [] } };
  for (const [toolArgs, sessionId] of [
    ["{bad-json", "private"], ["null", "private"], ["[]", "private"], ['"text"', "private"], ["42", "private"],
    [JSON.stringify(valid), "foreign"],
    [JSON.stringify({ ...valid, inputDigest: "f".repeat(64) }), "private"],
  ]) {
    const denied = await f.session.config.hooks.onPreToolUse({
      sessionId, toolName: "submit_human_route", toolArgs,
    }, { sessionId: "private" });
    assert.equal(denied.permissionDecision, "deny");
    assert.ok(denied.permissionDecisionReason);
    assert.equal((await f.store.load()).activeTask.result, null);
  }
  f.session.serializedHookArgs = true;
  await f.finish(packet, "submit_human_route", valid.outcome);
});

test("private controlled roles preload tools instead of relying on deferred discovery", async t => {
  const f = await fixture(t);
  assert.deepEqual(f.session.config.toolSearch, { enabled: false });
  assert.ok(f.session.config.tools.some(tool => tool.name === "submit_human_route"));
  assert.ok(f.session.config.tools.some(tool => tool.name === "submit_designer_outcome"));
  assert.equal(f.session.config.requestExtensions, false);
});

test("native system steering is not accepted as another Host input or completion", async t => {
  const f = await fixture(t);
  capturedDispatch(f.session);
  await f.request();
  await f.begin("router");
  f.session.emit("user.message", { content: "", transformedContent: "Native deferred-tool catalog context.",
    source: "system", delivery: "steering", interactionId: f.session.interactionId });
  await assert.rejects(f.transport.drain(), /Private input envelope is invalid/);
  await waitFor(async () => (await f.store.load()).uncertainty, "system injection remains unowned");
  const state = await f.store.load();
  assert.equal(state.activeTask.inputs.length, 1);
  assert.equal(state.activeTask.result, null);
  assert.equal(f.session.sends.length, 1);
});

for (const id of [undefined, null]) test(`identityless queue notifications do not become role evidence: id=${id}`, async t => {
  const f = await fixture(t, { nativeFiles: true });
  const queueChanged = () => f.session.config.onEvent({
    type: "pending_messages.modified", data: {}, ...(id === undefined ? {} : { id }),
  });
  queueChanged();
  await f.transport.drain();
  const deliver = capturedDispatch(f.session, ["user", "ack", "start"], queueChanged);
  await f.request();
  const packet = await f.begin("router");
  queueChanged();
  deliver();
  await f.transport.drain();
  const state = await f.store.load();
  assert.equal(state.activeTask.messageId, "sdk-ack-1");
  assert.equal(state.activeTask.interactionId, "native-interaction-1");
  assert.equal(state.activeTask.inputs[0].native.user.id,
    f.session.history.find(event => event.type === "user.message").id);
  assert.equal(state.activeTask.result, null);
  assert.equal(f.session.sends.length, 1);
  await f.finish(packet, "submit_human_route", { kind: "route", intent: "answer", cycleId: null,
    summary: "Queue status hints did not settle the role.", resolvedQuestions: [] });
  queueChanged();
  await f.transport.drain();
  assert.equal((await f.store.load()).uncertainty, null);
  assert.deepEqual((await replayDurableState(f.root)).state, await f.store.load());
});

test("identityless notifications cannot bypass foreign-session or role-event identity checks", async t => {
  for (const event of [
    { type: "pending_messages.modified", data: {}, sessionId: "foreign" },
    { type: "pending_messages.modified", data: {}, id: "" },
    { type: "user.message", data: {}, ephemeral: true },
    { type: "assistant.turn_start", data: { turnId: "0", interactionId: "native-interaction-1" }, ephemeral: true },
    { type: "tool.execution_start", data: { toolCallId: "call", toolName: "view" }, ephemeral: true },
    { type: "tool.execution_complete", data: { toolCallId: "result", success: true }, ephemeral: true },
  ]) {
    await t.test(event.type, async t => {
      const f = await fixture(t);
      f.session.config.onEvent(event);
      await assert.rejects(f.transport.drain(), /another private session|expected non-empty text/);
      await waitFor(async () => (await f.store.load()).uncertainty, "invalid native identity is retained");
      assert.equal(f.session.sends.length, 0);
    });
  }
});

for (const order of capturedOrders) test(`captured native input binds exact envelope independently of ACK order: ${order.join(",")}`, async t => {
  const f = await fixture(t, { nativeFiles: true });
  const deliver = capturedDispatch(f.session, order);
  await f.request(); const packet = await f.begin("router");
  deliver(); await f.transport.drain();
  const state = await f.store.load(), user = f.session.history.find(event => event.type === "user.message");
  assert.notEqual(user.id, state.activeTask.messageId);
  assert.equal(Object.hasOwn(user.data, "messageId"), false);
  assert.equal(Object.hasOwn(user.data, "turnId"), false);
  assert.equal(state.activeTask.messageId, "sdk-ack-1");
  assert.equal(state.activeTask.interactionId, "native-interaction-1");
  assert.equal(state.activeTask.inputs[0].native.user.parentAgentTaskId, "00000000-0000-4000-8000-000000000111");
  f.session.emit("tool.execution_start", { toolCallId: "owned-read", toolName: "view",
    arguments: { path: "app.js" }, turnId: f.session.turnId });
  assert.deepEqual(await f.session.config.hooks.onPreToolUse({ sessionId: "private", toolName: "view",
    toolArgs: { path: "app.js" } }, { sessionId: "private" }), {});
  f.session.emit("tool.execution_complete", { toolCallId: "owned-read", success: true,
    turnId: f.session.turnId, interactionId: f.session.interactionId });
  await f.finish(packet, "submit_human_route", { kind: "route", intent: "answer", cycleId: null,
    summary: "The real-shaped Router dispatch completed.", resolvedQuestions: [] });
  assert.equal((await f.store.load()).uncertainty, null);
  assert.deepEqual((await replayDurableState(f.root)).state, await f.store.load());
});

for (const order of capturedOrders) test(`captured continuation binds its own input and ACK: ${order.join(",")}`, async t => {
  const f = await fixture(t, { nativeFiles: true });
  const deliver = capturedDispatch(f.session, order);
  await f.request(); const packet = await f.begin("router");
  deliver(); await f.transport.drain();
  f.session.emit("session.idle", {});
  await waitFor(() => f.session.sends.length === 2, "captured continuation");
  deliver(); await f.transport.drain();
  await waitFor(async () => (await f.store.load()).activeTask.inputs[1]?.acknowledgementId, "continuation acknowledgement");
  const inputs = (await f.store.load()).activeTask.inputs;
  assert.deepEqual(inputs.map(input => [input.kind, input.acknowledgementId, input.native.user.interactionId,
    input.native.turnId]), [
    ["initial", "sdk-ack-1", "native-interaction-1", "0"],
    ["continuation", "sdk-ack-2", "native-interaction-2", "1"],
  ]);
  assert.notEqual(inputs[0].promptDigest, inputs[1].promptDigest);
  f.session.emit("tool.execution_start", { toolCallId: "continuation-read", toolName: "view",
    arguments: { path: "app.js" }, turnId: "1" });
  assert.deepEqual(await f.session.config.hooks.onPreToolUse({ sessionId: "private", toolName: "view",
    toolArgs: { path: "app.js" } }, { sessionId: "private" }), {});
  f.session.emit("tool.execution_complete", { toolCallId: "continuation-read", success: true,
    turnId: "1", interactionId: "native-interaction-2" });
  await f.finish(packet, "submit_human_route", { kind: "route", intent: "answer", cycleId: null,
    summary: "One continuation reported the required result.", resolvedQuestions: [] });
  assert.equal(f.session.sends.length, 2);
  assert.equal((await f.store.load()).uncertainty, null);
  assert.deepEqual((await replayDurableState(f.root)).state, await f.store.load());
});

test("captured input duplicate delivery is idempotent but changed same-ID evidence fails closed", async t => {
  const f = await fixture(t);
  capturedDispatch(f.session);
  await f.request(); await f.begin("router");
  const user = structuredClone(f.session.history.find(event => event.type === "user.message"));
  const before = await f.store.load();
  f.session.config.onEvent(user); await f.transport.drain();
  assert.deepEqual(await f.store.load(), before);
  user.data.content += " changed";
  f.session.config.onEvent(user);
  await assert.rejects(f.transport.drain(), /event identity changed/);
  await waitFor(async () => (await f.store.load()).uncertainty, "changed event audit");
});

test("captured input attachments bind inline and interned bytes without accepting changed metadata", () => {
  const data = Buffer.from("synthetic exact image bytes");
  const inline = { type: "blob", mimeType: "image/png", displayName: "approved.png", data: data.toString("base64") };
  const interned = { type: "blob", mimeType: inline.mimeType, displayName: inline.displayName,
    assetId: `sha256:${createHash("sha256").update(data).digest("hex")}`, byteLength: data.length };
  const expected = humanInputEnvelope("Exact Host input", [inline]);
  assert.deepEqual(humanInputEnvelope("Exact Host input", [interned]), expected);
  for (const change of [{ mimeType: "image/jpeg" }, { displayName: "other.png" }, { byteLength: data.length + 1 }]) {
    assert.notDeepEqual(humanInputEnvelope("Exact Host input", [{ ...interned, ...change }]), expected);
  }
  for (const change of [{ assetId: "sha256:" + "f".repeat(64) }, { byteLength: data.length + 1 }, { data: inline.data + "\n" }]) {
    assert.throws(() => humanInputEnvelope("Exact Host input", [{ ...inline, ...change }]), /attachment/);
  }
  assert.throws(() => humanInputEnvelope("Exact Host input", [{ ...interned, byteLength: undefined }]), /unavailable/);
});

test("captured continuation cannot reuse the original sent envelope", async t => {
  const f = await fixture(t);
  capturedDispatch(f.session, undefined, user => {
    if (f.session.sends.length === 2) user.content = f.session.sends[0].prompt;
  });
  await f.request(); await f.begin("router");
  f.session.emit("session.idle", {});
  await waitFor(async () => (await f.store.load()).uncertainty, "changed continuation envelope");
  assert.equal(f.session.sends.length, 2);
  assert.equal((await f.store.load()).activeTask.result, null);
});

test("captured native tools cannot choose a reused turn by recency", async t => {
  const f = await fixture(t, { nativeFiles: true });
  capturedDispatch(f.session);
  await f.request(); await f.begin("router");
  f.session.emit("session.idle", {});
  await waitFor(() => f.session.sends.length === 2, "captured continuation");
  await f.transport.drain();
  f.session.emit("assistant.turn_start", { turnId: "0", interactionId: f.session.interactionId });
  f.session.emit("tool.execution_start", { toolCallId: "ambiguous-read", toolName: "view",
    arguments: { path: "app.js" }, turnId: "0" });
  await assert.rejects(f.transport.drain(), /unambiguous owned role turn/);
});

test("captured queued Host inputs preserve exact initial and continuation ownership without allowing steering", async t => {
  const f = await fixture(t);
  capturedDispatch(f.session, undefined, user => { user.delivery = "queued"; });
  await f.request(); const packet = await f.begin("router");
  f.session.emit("session.idle", {});
  await waitFor(() => f.session.sends.length === 2, "owned queued continuation");
  await f.transport.drain();
  await f.finish(packet, "submit_human_route", { kind: "route", intent: "answer", cycleId: null,
    summary: "Delivery describes timing, not foreign origin.", resolvedQuestions: [] });
  assert.equal((await f.store.load()).uncertainty, null);
  assert.deepEqual((await f.store.load()).executions[0].inputs.map(input => input.native.user.interactionId),
    ["native-interaction-1", "native-interaction-2"]);
});

for (const evidence of ["explicit-interaction", "assistant-request", "assistant-request-without-start-turn", "assistant-request-without-message-turn"]) {
  test(`captured same-role turn zero reuse requires exact ${evidence}`, async t => {
    const f = await fixture(t, { nativeFiles: true });
    capturedDispatch(f.session, undefined, undefined, () => "0");
    await f.request(); const packet = await f.begin("router");
    f.session.emit("session.idle", {});
    await waitFor(() => f.session.sends.length === 2, "same-role repeated turn zero");
    await f.transport.drain();
    const callId = "continuation-zero-read", args = { path: "app.js" };
    if (evidence !== "explicit-interaction") f.session.emit("assistant.message", {
      messageId: "native-tool-request", content: "",
      ...(evidence === "assistant-request-without-message-turn" ? {} : { turnId: "0" }), interactionId: f.session.interactionId,
      toolRequests: [{ name: "view", toolCallId: callId, arguments: args }],
    });
    f.session.emit("tool.execution_start", { toolCallId: callId, toolName: "view", arguments: args,
      ...(evidence === "assistant-request-without-start-turn" ? {} : { turnId: "0" }),
      ...(evidence === "explicit-interaction" ? { interactionId: f.session.interactionId } : {}) });
    assert.deepEqual(await f.session.config.hooks.onPreToolUse({ sessionId: "private", toolName: "view",
      toolArgs: args }, { sessionId: "private" }), {});
    f.session.emit("tool.execution_complete", { toolCallId: callId, success: true,
      turnId: "0", interactionId: f.session.interactionId });
    await f.finish(packet, "submit_human_route", { kind: "route", intent: "answer", cycleId: null,
      summary: "Tool-call identity disambiguates a repeated numeric turn.", resolvedQuestions: [] });
    assert.equal((await f.store.load()).uncertainty, null);
    assert.deepEqual((await f.store.load()).executions[0].inputs.map(input => input.native.turnId), ["0", "0"]);
  });
}

for (const variant of ["missing-interaction", "missing-both-turns", "wrong-call", "changed-arguments", "conflicting-interaction"]) {
  test(`captured repeated-turn tool requests reject ${variant} evidence`, async t => {
    const f = await fixture(t, { nativeFiles: true });
    capturedDispatch(f.session, undefined, undefined, () => "0");
    await f.request(); await f.begin("router");
    f.session.emit("session.idle", {});
    await waitFor(() => f.session.sends.length === 2, "same-role repeated turn zero");
    await f.transport.drain();
    const request = { messageId: "native-tool-request", content: "", turnId: "0", interactionId: f.session.interactionId,
      toolRequests: [{ name: "view", toolCallId: "requested-read", arguments: { path: "app.js" } }] };
    if (variant === "missing-interaction") delete request.interactionId;
    if (variant === "missing-both-turns") delete request.turnId;
    f.session.emit("assistant.message", request);
    f.session.emit("tool.execution_start", { toolCallId: variant === "wrong-call" ? "not-requested" : "requested-read",
      toolName: "view", ...(variant === "missing-both-turns" ? {} : { turnId: "0" }),
      arguments: { path: variant === "changed-arguments" ? "other.js" : "app.js" },
      ...(variant === "conflicting-interaction" ? { interactionId: "native-interaction-1" } : {}) });
    await assert.rejects(f.transport.drain(), /unambiguous owned role turn/);
  });
}

test("captured pending tool-request IDs retire with their role and cannot be rebound to a reused successor turn", async t => {
  const f = await fixture(t, { nativeFiles: true });
  capturedDispatch(f.session, undefined, undefined, () => "0");
  await f.request(); const old = await f.begin("router");
  f.session.emit("assistant.message", { messageId: "old-assistant", content: "", turnId: "0",
    interactionId: f.session.interactionId, toolRequests: [{ toolCallId: "late-owned-read", name: "view", arguments: { path: "app.js" } }] });
  await f.finish(old, "submit_human_route", { kind: "route", intent: "answer", cycleId: null,
    summary: "A terminal result completes without waiting for another requested tool.", resolvedQuestions: [] });
  const next = await f.begin("agent"), before = await f.store.load();
  f.session.emit("tool.execution_start", { toolCallId: "late-owned-read", toolName: "view", turnId: "0",
    arguments: { path: "app.js" } });
  await f.transport.drain();
  assert.equal((await f.session.config.hooks.onPreToolUse({ sessionId: "private", toolName: "view",
    toolArgs: { path: "app.js" } }, { sessionId: "private" })).permissionDecision, "deny");
  assert.deepEqual(await f.store.load(), before);
  assert.deepEqual(await nativeAdmission(f, "fresh-owned-read", "view", { path: "app.js" }), {});
  nativeCompletion(f, "fresh-owned-read");
  await f.finish(next, "submit_readonly_answer", { kind: "answer", summary: "Successor retained its own authority.",
    report: "The late old request was not adopted.", evidenceRefs: [] });
  assert.equal((await f.store.load()).uncertainty, null);
});

test("captured unscoped successor turn cannot identify an unknown old invocation by recency", async t => {
  const f = await fixture(t, { nativeFiles: true });
  capturedDispatch(f.session, undefined, undefined, () => "0");
  await f.request(); const old = await f.begin("router");
  await f.finish(old, "submit_human_route", { kind: "route", intent: "answer", cycleId: null,
    summary: "First role is complete.", resolvedQuestions: [] });
  await f.begin("agent");
  f.session.emit("tool.execution_start", { toolCallId: "unscoped-read", toolName: "view", turnId: "0",
    arguments: { path: "app.js" } });
  await assert.rejects(f.transport.drain(), /unambiguous owned role turn/);
});

test("captured input binding persistence does not become a terminal-result completion gate", async t => {
  const f = await fixture(t);
  capturedDispatch(f.session, ["ack", "user", "start"]);
  await f.request(); const packet = await f.begin("router");
  const reached = Promise.withResolvers(), release = Promise.withResolvers(), dispatch = f.store.dispatch.bind(f.store);
  f.store.dispatch = async (...args) => {
    if (args[2] === "role-input-bound") { reached.resolve(); await release.promise; }
    return dispatch(...args);
  };
  f.session.emit("user.message", { content: f.session.sends[0].prompt, interactionId: f.session.interactionId, delivery: "idle" });
  f.session.emit("assistant.turn_start", { turnId: f.session.turnId, interactionId: f.session.interactionId });
  await reached.promise;
  try {
    await f.session.call("submit_human_route", { schemaVersion: "human-role-result/v1", resultId: "early-bound-result",
      inputDigest: packet.binding.inputDigest, outcome: { kind: "route", intent: "answer", cycleId: null,
        summary: "Terminal result is authoritative before bookkeeping settles.", resolvedQuestions: [] } });
    assert.equal((await f.transport.waitForResult(packet.binding.id)).resultId, "early-bound-result");
  } finally { release.resolve(); }
  await f.transport.drain();
  assert.equal((await f.store.load()).uncertainty, null);
  assert.equal((await f.store.load()).activeTask.completion, "result-submission");
  assert.ok(f.progress.some(event => event.kind === "dispatch-diagnostic"));
});

test("captured late user and start evidence after terminal release cannot bind or poison the successor", async t => {
  const f = await fixture(t);
  const deliverOld = capturedDispatch(f.session, ["ack", "user", "start"]);
  await f.request(); const old = await f.begin("router");
  await f.finish(old, "submit_human_route", { kind: "route", intent: "answer", cycleId: null,
    summary: "The terminal result does not wait for input bookkeeping.", resolvedQuestions: [] });
  capturedDispatch(f.session);
  const next = await f.begin("agent"), before = await f.store.load();
  deliverOld(); await f.transport.drain();
  assert.deepEqual(await f.store.load(), before);
  assert.equal((await f.store.load()).activeTask.binding.id, next.binding.id);
  await f.finish(next, "submit_readonly_answer", { kind: "answer", summary: "New task completed.",
    report: "Late evidence did not change its authority.", evidenceRefs: [] });
  assert.equal((await f.store.load()).uncertainty, null);
});

for (const variant of ["missing-start-interaction", "foreign-session"]) {
  test(`captured native input rejects ${variant} rather than guessing identity`, async t => {
    const f = await fixture(t);
    capturedDispatch(f.session);
    const emit = f.session.emit.bind(f.session);
    f.session.emit = (type, data, parent, overrides = {}) => {
      if (type === "assistant.turn_start" && variant === "missing-start-interaction") {
        data = { ...data }; delete data.interactionId;
      }
      if (type === "user.message" && variant === "foreign-session") overrides.sessionId = "foreign-private";
      emit(type, data, parent, overrides);
    };
    await f.request();
    await assert.rejects(f.begin("router"), /matching interaction|another private session/);
    await waitFor(async () => (await f.store.load()).uncertainty, "rejected event identity");
    assert.equal(f.session.sends.length, 1);
  });
}

test("captured descendant input never binds a root role even with the exact Host content and telemetry", async t => {
  const f = await fixture(t, { nativeFiles: true });
  capturedDispatch(f.session);
  const emit = f.session.emit.bind(f.session);
  f.session.emit = (type, data, parent, overrides = {}) => {
    emit(type, data, parent, ["user.message", "assistant.turn_start"].includes(type)
      ? { ...overrides, agentId: "synthetic-child" } : overrides);
  };
  await f.request(); const packet = await f.begin("router");
  assert.equal((await f.store.load()).activeTask.inputs[0].native, null);
  const denied = await f.session.config.hooks.onPreToolUse({ sessionId: "synthetic-child",
    toolName: "submit_human_route", toolArgs: { inputDigest: packet.binding.inputDigest } }, { sessionId: "private" });
  assert.equal(denied.permissionDecision, "deny");
  assert.match(denied.permissionDecisionReason, /root owned role/);
  assert.equal((await f.store.load()).activeTask.result, null);
  assert.equal((await f.store.load()).uncertainty, null);
});

for (const [name, change] of [
  ["changed content", user => { user.content += " foreign"; }],
  ["missing interaction", user => { delete user.interactionId; }],
  ["steering", user => { user.delivery = "steering"; }],
  ["autopilot", user => { user.isAutopilotContinuation = true; }],
  ["injected source", user => { user.source = "skill"; }],
  ["inter-agent source", user => { user.source = "agent-foreign"; }],
  ["malformed parent telemetry", user => { user.parentAgentTaskId = 42; }],
  ["foreign mode", user => { user.agentMode = "autopilot"; }],
  ["partial legacy identity", user => { user.messageId = "sdk-ack-1"; }],
  ["conflicting legacy ACK", user => { user.messageId = "foreign-ack"; user.turnId = "0"; }],
  ["conflicting legacy turn", user => { user.messageId = "sdk-ack-1"; user.turnId = "foreign-turn"; }],
  ["changed attachments", user => { user.attachments = [{ type: "blob", mimeType: "image/png", data: "Zm9yZWlnbg==" }]; }],
]) test(`captured native input fails closed for ${name}`, async t => {
  const f = await fixture(t);
  capturedDispatch(f.session, undefined, change);
  await f.request();
  await assert.rejects(f.begin("router"), /input|interaction|attachment|identity|ownership|acknowledgement/i);
  await waitFor(async () => (await f.store.load()).uncertainty, "durable rejected native input");
  assert.equal((await f.store.load()).activeTask.result, null);
  assert.equal(f.session.sends.length, 1);
});

test("missing-result exception uses one same-role continuation, never assistant idle or post-result idle", { timeout: 30_000 }, async t => {
  const f = await fixture(t);
  await f.request();
  const packet = await f.begin("router"), before = await readFile(join(f.root, "app.js"), "utf8");
  f.session.endNormally();
  await f.transport.drain();
  assert.equal(f.session.sends.length, 1);
  assert.equal((await f.store.load()).activeTask.result, null);
  f.session.emit("session.idle", { mode: "interactive" });
  await waitFor(() => f.session.sends.length === 2, "one continuation send");
  await f.transport.drain();
  assert.equal(f.session.sends.length, 2);
  assert.equal(f.session.sends[1].mode, "immediate");
  assert.deepEqual(JSON.parse(f.session.sends[1].prompt.split("\n").at(-1)), packet);
  assert.match(f.session.sends[1].prompt, /Exception recovery.*SAME active role/);
  assert.equal((await f.store.load()).activeTask.binding.id, packet.binding.id);
  assert.equal((await f.store.load()).requests.length, 1);
  assert.equal(await readFile(join(f.root, "app.js"), "utf8"), before);
  await f.finish(packet, "submit_human_route", {
    kind: "route", intent: "answer", cycleId: null, summary: "Recovered result.", resolvedQuestions: [],
  });
  f.session.emit("session.idle", { mode: "interactive" });
  await f.transport.drain();
  assert.equal(f.session.sends.length, 2);
  assert.equal((await f.store.load()).executions[0].completion, "result-submission");
  assert.equal((await f.store.messages()).filter(item => item.id === `continuation:${packet.binding.id}`).length, 1);
});

test("missing-result exception ignores duplicate and delayed old idle, then reports exhaustion without a third send", { timeout: 30_000 }, async t => {
  const f = await fixture(t);
  await f.request(); const packet = await f.begin("router");
  const result = f.transport.waitForResult(packet.binding.id);
  f.session.emit("session.idle", { mode: "interactive" });
  const originalIdle = structuredClone(f.session.history.at(-1));
  await waitFor(() => f.session.sends.length === 2, "one continuation send");
  await f.transport.drain();
  assert.equal(f.session.sends.length, 2);
  f.session.config.onEvent(originalIdle);
  f.session.emit("session.idle", { mode: "interactive" }, originalIdle.parentId);
  f.session.emit("session.idle", { mode: "interactive" });
  await f.transport.drain();
  assert.equal((await f.store.load()).activeTask.result, null);
  f.session.emit("assistant.message", { content: "Still no required result.", toolRequests: [] },
    f.session.history.find(event => event.type === "user.message" && event.data.messageId === f.session.messageId).id);
  f.session.emit("session.idle", { mode: "interactive" });
  await f.transport.drain();
  const failure = await result;
  assert.equal(failure.outcome.kind, "execution-failure");
  assert.match(failure.outcome.reason, /required result after one same-role continuation/);
  assert.equal(f.session.sends.length, 2);
});

for (const winner of ["result", "stop", "close"]) test(`missing-result exception never nudges after racing ${winner}`, { timeout: 30_000 }, async t => {
  const f = await fixture(t);
  await f.request(); const packet = await f.begin("router");
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  const record = f.store.recordMessage.bind(f.store);
  t.mock.method(f.store, "recordMessage", async value => {
    if (value.id === `continuation:${packet.binding.id}`) { entered.resolve(); await release.promise; }
    return record(value);
  });
  const waiting = f.transport.waitForResult(packet.binding.id);
  waiting.catch(() => {});
  f.session.emit("session.idle", { mode: "interactive" });
  await entered.promise;
  try {
    if (winner === "result") {
      await f.session.call("submit_human_route", { schemaVersion: "human-role-result/v1",
        resultId: "race-result", inputDigest: packet.binding.inputDigest,
        outcome: { kind: "route", intent: "answer", cycleId: null, summary: "Result won.", resolvedQuestions: [] } });
      assert.equal((await waiting).resultId, "race-result");
    } else if (winner === "stop") {
      assert.equal((await f.transport.stop("race-stop")).interrupted, true);
      await assert.rejects(waiting, /stopped/);
    } else {
      assert.equal((await f.transport.close()).closed, true);
      await assert.rejects(waiting, /closing/);
    }
  } finally { release.resolve(); }
  await new Promise(resolve => setImmediate(resolve));
  await f.transport.drain();
  assert.equal(f.session.sends.length, 1);
});

test("missing-result continuation send failure is explicit and is never automatically retried", { timeout: 30_000 }, async t => {
  const f = await fixture(t);
  await f.request(); const packet = await f.begin("router");
  const waiting = f.transport.waitForResult(packet.binding.id);
  const rejected = assert.rejects(waiting, /continuation.*could not be prepared or sent|continuation RPC failed/);
  f.session.onSend = async () => { throw new Error("continuation RPC failed"); };
  f.session.emit("session.idle", { mode: "interactive" });
  await rejected;
  await waitFor(async () => (await f.store.load()).uncertainty, "durable continuation failure");
  assert.equal(f.session.sends.length, 2);
  assert.match((await f.store.load()).uncertainty.reason, /continuation.*could not be prepared or sent/);
});

test("missing-result continuation acknowledgement never blocks a valid result or successor tools", { timeout: 30_000 }, async t => {
  const f = await fixture(t);
  await f.request();
  let packet = await f.begin("router");
  await f.finish(packet, "submit_human_route", { kind: "route", intent: "answer", cycleId: null, summary: "Explain.", resolvedQuestions: [] });
  packet = await f.begin("agent");
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  f.session.onSend = async () => { entered.resolve(); await release.promise; };
  f.session.emit("session.idle", { mode: "interactive" });
  await entered.promise;
  try {
    await f.finish(packet, "submit_readonly_answer", { kind: "answer",
      summary: "Completed independently of the pending acknowledgement.", report: "Existing files retained.", evidenceRefs: [] });
    await f.dispatch("host", "present-handoff", { handoffId: (await f.store.load()).handoffs.at(-1).id });
    f.session.onSend = null;
    await f.request(); packet = await f.begin("router");
    await f.finish(packet, "submit_human_route", { kind: "route", intent: "answer", cycleId: null, summary: "Next request.", resolvedQuestions: [] });
    packet = await f.begin("agent");
    assert.match((await f.session.call("read_project_file", { path: "app.js" })).content, /original = 2/);
    await f.finish(packet, "submit_readonly_answer", { kind: "answer",
      summary: "Next authorized work completed.", report: "Read the existing file.", evidenceRefs: [] });
  } finally { release.resolve(); }
  await new Promise(resolve => setImmediate(resolve));
  await f.transport.drain();
  assert.equal((await f.store.load()).uncertainty, null);
});

async function beginReview(f, inspect = async () => {}) {
  await f.request();
  let packet = await f.begin("router");
  await inspect("router");
  await f.finish(packet, "submit_human_route", { kind: "route", intent: "implement", cycleId: null, summary: "Build.", resolvedQuestions: [] });
  await f.dispatch("host", "start-cycle", { cycleId: "cycle", design, baseline: f.baseline });
  packet = await f.begin("planner", "cycle");
  await inspect("planner");
  await f.finish(packet, "submit_internal_plan", { kind: "internal-plan", plan: {
    schemaVersion: "internal-plan/v1", id: "plan", version: 1, goal: "Keep the existing implementation.",
    design, baseline: f.baseline, tasks: [{ id: "edit", title: "Account for implementation", scope: ["app.js"], dependsOn: [],
      criteria: [{ id: "design", description: "Preserve agreed behavior." }] }],
  } });
  let state = await f.store.load(), cycle = state.cycles[0];
  await f.dispatch("host", "accept-plan", { cycleId: cycle.id, acceptance: {
    schemaVersion: "internal-plan-acceptance/v1", authority: "host", cycleId: cycle.id, requestId: state.activeRequestId,
    sourceRequestIds: state.activeBatchRequestIds, routeResultId: state.requests[0].route.resultId,
    planId: cycle.pendingPlan.id, planDigest: cycle.pendingPlan.digest, design, baseline: f.baseline, policyDigest: f.owner.policy.digest,
  } });
  cycle = (await f.store.load()).cycles[0];
  packet = await f.begin("implementer", cycle.id, "edit");
  await inspect("implementer");
  await f.finish(packet, "submit_internal_task_result", { kind: "task-result", taskId: "edit",
    planDigest: cycle.plan.digest, summary: "Implementation retained.", evidenceRefs: ["app.js"] });
  packet = await f.begin("implementer", cycle.id);
  await f.finish(packet, "submit_implementation_result", { kind: "implementation-result", planDigest: cycle.plan.digest,
    completedTaskIds: ["edit"], summary: "Implementation retained.", evidenceRefs: ["app.js"] });
  packet = await f.begin("reviewer", cycle.id);
  await inspect("reviewer");
  return { packet, outcome: { kind: "review-result", reviewFormat: "decision-review/v2", coverageStatus: "complete",
    planDigest: cycle.plan.digest, summary: "Compared Design and implementation.", assessments: [], findings: [],
    verificationLimits: [], evidenceRefs: ["app.js"], questions: [] } };
}

async function nativeAdmission(f, id, name, args, agentId = null) {
  if (!agentId) f.session.emit("assistant.message", { messageId: `assistant-${id}`, content: "",
    turnId: "0", interactionId: f.session.interactionId, toolRequests: [{ name, arguments: args, toolCallId: id }] });
  f.session.emit("tool.execution_start", { toolName: name, arguments: args, toolCallId: id, turnId: "0" },
    undefined, agentId ? { agentId } : {});
  return f.session.config.hooks.onPreToolUse({ sessionId: agentId ?? f.session.sessionId,
    toolName: name, toolArgs: args }, { sessionId: f.session.sessionId });
}
function nativeCompletion(f, id, success = true, agentId = null) {
  f.session.emit("tool.execution_complete", { toolCallId: id, success, turnId: "0", interactionId: f.session.interactionId,
    ...(success ? {} : { error: { message: "Observed native invocation failure." } }) },
  undefined, agentId ? { agentId } : {});
}
async function reviewFactory(f, id, scopes, start = true) {
  const args = { scopes: scopes.map(id => ({ id, prompt: "Inspect both Review goals." })) };
  const hook = await nativeAdmission(f, id, "tandem_collect_review_scopes", args);
  if (hook.permissionDecision === "deny") return hook;
  const input = hook.modifiedArgs;
  assert.equal(input.toolCallId, id);
  assert.equal(input.packet.binding.role, "reviewer");
  for (const scope of scopes) f.session.scopeRoots.set(scope, id);
  if (start) {
    f.session.factoryRuns.set(`factory:${id}`, { runId: `factory:${id}`, status: "running",
      result: { binding: input.packet.binding, toolCallId: id, scopes: scopes.map(id => ({ id, evidence: null })) } });
    f.session.scopeEnds.set(id, new Set());
    f.session.emit("workflow.run_started", { runId: `factory:${id}`, workflowName: "tandem-review-scopes", attempt: 1 });
  }
  return {};
}
async function reviewScope(f, id, { start = true, factoryId = id } = {}) {
  const hook = factoryId === id ? await reviewFactory(f, id, [id], start) : {};
  if (hook.permissionDecision !== "deny" && start) f.session.emit("subagent.started", {
    toolCallId: `native-factory-child:${id}`, workflowRunId: `factory:${factoryId}`,
    agentName: "tandem-review-scope", executionMode: "sync",
  }, undefined, { agentId: `agent:${id}` });
  return hook;
}
function scopeEnd(f, id, status = "completed") {
  f.session.emit(status === "failed" ? "subagent.failed" : "subagent.completed", {
    toolCallId: id, agentName: "tandem-review-scope",
    ...(status === "failed" ? { error: "Observed native scope failure." } : status === "cancelled" ? { cancelled: true } : {}),
  }, undefined, { agentId: `agent:${id}` });
  const root = f.session.scopeRoots.get(id), run = f.session.factoryRuns.get(`factory:${root}`);
  if (run?.status !== "running" || f.session.scopeEnds.get(root).has(id)) return;
  f.session.scopeEnds.get(root).add(id);
  run.result.scopes.find(scope => scope.id === id).evidence = status === "completed" ? `Observed evidence for ${id}` : null;
  if (f.session.scopeEnds.get(root).size === run.result.scopes.length) {
    run.status = status === "cancelled" ? "cancelled" : "completed";
    f.session.emit("workflow.run_settled", { runId: run.runId, status: run.status });
  }
}

test("Reviewer admits seven scopes as one native factory, rejects competing factories and denies nested/write/domain work", async t => {
  const f = await fixture(t, { nativeFiles: true });
  const { packet, outcome } = await beginReview(f);
  assert.deepEqual(f.session.config.customAgents[0].tools, ["view", "grep", "glob"]);
  const ids = ["one", "two", "three", "four", "five", "six", "seven"];
  assert.deepEqual(await reviewFactory(f, "group", ids), {});
  for (const id of ids.slice(0, 3)) assert.deepEqual(await reviewScope(f, id, { factoryId: "group" }), {});
  const denied = await reviewScope(f, "fourth");
  assert.match(denied.permissionDecisionReason, /Collect the current native factory/);
  nativeCompletion(f, "fourth", false);
  const nested = await nativeAdmission(f, "nested", "task", {}, "agent:one");
  assert.match(nested.permissionDecisionReason, /nested delegation/);
  nativeCompletion(f, "nested", false, "agent:one");
  const write = await nativeAdmission(f, "child-write", "edit", {}, "agent:one");
  assert.equal(write.permissionDecision, "deny");
  nativeCompletion(f, "child-write", false, "agent:one");
  const domain = await nativeAdmission(f, "child-result", "submit_whole_plan_review", {}, "agent:one");
  assert.match(domain.permissionDecisionReason, /Only the root/);
  nativeCompletion(f, "child-result", false, "agent:one");
  for (const type of ["assistant.turn_end", "assistant.idle", "session.error"]) f.session.emit(type, {},
    undefined, { agentId: "agent:one" });
  assert.equal((await f.store.load()).activeTask.result, null);
  scopeEnd(f, "one");
  const duplicate = f.session.history.at(-1);
  f.session.config.onEvent(duplicate);
  scopeEnd(f, "one", "cancelled");
  for (const id of ["two", "three"]) scopeEnd(f, id);
  await f.transport.drain();
  for (const id of ["four", "five", "six"]) assert.deepEqual(await reviewScope(f, id, { factoryId: "group" }), {});
  for (const id of ["four", "five", "six"]) scopeEnd(f, id);
  await f.transport.drain();
  assert.deepEqual(await reviewScope(f, "seven", { factoryId: "group" }), {});
  scopeEnd(f, "seven"); nativeCompletion(f, "group"); await f.transport.drain();
  await f.finish(packet, "submit_whole_plan_review", outcome);
  const state = await f.store.load();
  assert.equal(state.handoffs.length, 1);
  assert.equal(state.cycles[0].reviewResult.outcome.coverageStatus, "complete");
  assert.equal(state.uncertainty, null);
  assert.equal(f.session.sends.filter(send => send.prompt.includes('"role":"reviewer"')).length, 1);
});

test("native Review child pre-hook precedes bridged tool start but remains identity-bound and permission-gated", async t => {
  const f = await fixture(t, { nativeFiles: true });
  const { packet, outcome } = await beginReview(f);
  await reviewScope(f, "native-order");
  const args = { path: join(f.root, "app.js") };
  const hook = { sessionId: "agent:native-order", toolName: "view", toolArgs: args };
  const invoke = { sessionId: f.session.sessionId };
  assert.equal((await f.session.config.hooks.onPreToolUse({ ...hook, sessionId: "unknown-child" }, invoke)).permissionDecision, "deny");
  assert.deepEqual(await f.session.config.hooks.onPreToolUse(hook, invoke), {});
  const premature = await f.session.config.onPermissionRequest({ kind: "read", toolCallId: "not-observed", path: args.path }, invoke);
  assert.equal(premature.kind, "reject", "Known child identity cannot fabricate an invocation permission.");
  f.session.emit("tool.execution_start", { toolCallId: "observed-after-hook", toolName: "view",
    arguments: args, turnId: "0", parentToolCallId: "native-order" }, undefined, { agentId: hook.sessionId });
  const decision = f.session.config.onPermissionRequest({ kind: "read", toolCallId: "observed-after-hook",
    path: args.path, intention: "Read after the native hook" }, invoke);
  await waitFor(() => f.broker.list().length === 1, "ordinary child read permission");
  await f.broker.decide(f.broker.list()[0].id, "once");
  assert.equal((await decision).kind, "approve-once");
  nativeCompletion(f, "observed-after-hook", true, hook.sessionId);
  assert.deepEqual(await f.session.config.hooks.onPreToolUse({ ...hook, toolName: "rg", toolArgs: { pattern: "original" } }, invoke), {});
  assert.equal((await f.session.config.hooks.onPreToolUse({ ...hook, toolName: "powershell" }, invoke)).permissionDecision, "deny");
  scopeEnd(f, "native-order"); nativeCompletion(f, "native-order"); await f.transport.drain();
  assert.equal((await f.session.config.hooks.onPreToolUse(hook, invoke)).permissionDecision, "deny");
  await f.finish(packet, "submit_whole_plan_review", outcome);
});

test("Review factory admission rejects model/limit/context overrides and old-run resume", async t => {
  const f = await fixture(t, { nativeFiles: true });
  const { packet, outcome } = await beginReview(f);
  const args = { scopes: [{ id: "one", prompt: "Inspect" }] };
  const invalid = [
    { ...args, limits: { maxConcurrentSubagents: 4 } },
    { ...args, model: "other" },
    { ...args, resumeFromRunId: "old" },
    { ...args, packet: { binding: {} } },
    { ...args, name: "unrelated-factory" },
  ];
  for (const [index, input] of invalid.entries()) {
    const id = `invalid-factory-${index}`;
    assert.equal((await nativeAdmission(f, id, "tandem_collect_review_scopes", input)).permissionDecision, "deny");
    nativeCompletion(f, id, false);
  }
  assert.equal((await nativeAdmission(f, "legacy-task", "task", {
    agent_type: "tandem-review-scope", mode: "sync", prompt: "Inspect",
  })).permissionDecision, "deny");
  nativeCompletion(f, "legacy-task", false);
  assert.equal((await nativeAdmission(f, "background-factory", "run_dynamic_workflow", {
    name: "tandem-review-scopes", args,
  })).permissionDecision, "deny");
  nativeCompletion(f, "background-factory", false);
  await f.transport.drain();
  await f.finish(packet, "submit_whole_plan_review", outcome);
});

test("factory consent remains native and altered result bindings become unavailable coverage", async t => {
  const f = await fixture(t, { nativeFiles: true });
  const { packet, outcome } = await beginReview(f);
  await reviewScope(f, "bound");
  const request = { kind: "custom-tool", toolCallId: "bound", toolName: "tandem_collect_review_scopes",
    toolDescription: "Run the declared read-only factory with at most three workers.", args: {} };
  assert.equal((await f.session.config.onPermissionRequest({ ...request, kind: "factory" },
    { sessionId: "private" })).kind, "reject");
  const consent = f.session.config.onPermissionRequest(request, { sessionId: "private" });
  await waitFor(() => f.broker.list().length === 1, "native factory consent");
  assert.match(f.broker.list()[0].description, /Review scopes \(1\): bound.*concurrency limit: 3/);
  await f.broker.decide(f.broker.list()[0].id, "once");
  assert.equal((await consent).kind, "approve-once");
  scopeEnd(f, "bound"); nativeCompletion(f, "bound"); await f.transport.drain();
  f.session.factoryRuns.get("factory:bound").result.binding.inputDigest = "f".repeat(64);
  await f.finish(packet, "submit_whole_plan_review", outcome);
  const report = (await f.store.load()).cycles[0].reviewResult.outcome;
  assert.equal(report.coverageStatus, "unavailable");
  assert.match(report.verificationLimits.join("\n"), /differs from its admitted Review/);
});

test("failed factory cancellation cannot prevent foreground interruption or claim a successful Stop", async t => {
  const f = await fixture(t, { nativeFiles: true });
  await beginReview(f);
  await reviewScope(f, "cancel-fails");
  t.mock.method(f.session.workflow, "cancel", async () => { throw new Error("Factory cancellation unavailable"); });
  await assert.rejects(f.transport.stop("stop-failed-cancel"), /Factory cancellation unavailable/);
  assert.equal(f.session.aborts, 1);
  assert.equal((await f.session.config.hooks.onPreToolUse({
    sessionId: "agent:cancel-fails", toolName: "view", toolArgs: { path: "app.js" },
  }, { sessionId: "private" })).permissionDecision, "deny");
});

test("explicit Stop retries a failed Review cancellation while concurrent attempts share the native call", async t => {
  const f = await fixture(t, { nativeFiles: true });
  await beginReview(f);
  await reviewScope(f, "retry-cancel");
  const first = Promise.withResolvers();
  let calls = 0;
  const cancel = f.session.workflow.cancel;
  t.mock.method(f.session.workflow, "cancel", async id => {
    calls++;
    if (calls === 1) return first.promise;
    return cancel(id);
  });
  const one = f.transport.stop("explicit-stop");
  const duplicate = f.transport.stop("explicit-stop");
  const observed = Promise.allSettled([one, duplicate]);
  assert.equal(calls, 1, "Concurrent Stop requests must share the in-flight cancellation.");
  first.reject(new Error("Transient native cancellation failure"));
  const results = await observed;
  assert.ok(results.every(result => result.status === "rejected"));
  assert.equal(calls, 1, "Failure must not trigger an automatic retry.");
  const retried = await f.transport.stop("explicit-stop-retry");
  assert.equal(calls, 2);
  assert.equal(retried.interrupted, true);
  assert.equal(f.session.factoryRuns.get("factory:retry-cancel").status, "cancelled");
});

test("parent publication does not await a factory and late factory children cannot borrow the next role", async t => {
  const f = await fixture(t, { nativeFiles: true });
  const { packet, outcome } = await beginReview(f);
  await reviewFactory(f, "late-group", ["late-child"]);
  await f.finish(packet, "submit_whole_plan_review", outcome);
  assert.deepEqual(f.session.cancelledFactories, ["factory:late-group"]);
  const state = await f.store.load();
  assert.equal(state.cycles[0].reviewResult.outcome.coverageStatus, "unavailable");
  await f.dispatch("host", "present-handoff", { handoffId: state.handoffs[0].id });
  await f.request();
  const next = await f.begin("router");
  f.session.emit("subagent.started", { workflowRunId: "factory:late-group",
    toolCallId: "late-native-child", agentName: "tandem-review-scope" }, undefined, { agentId: "late-child" });
  assert.equal((await nativeAdmission(f, "late-read", "view", { path: "app.js" }, "late-child")).permissionDecision, "deny");
  nativeCompletion(f, "late-read", false, "late-child");
  await f.finish(next, "submit_human_route", { kind: "route", intent: "answer", cycleId: null,
    summary: "Independent authorized request.", resolvedQuestions: [] });
});

for (const callbackFirst of [false, true]) test(`native Review consent precedes tool-start: SDK callback first=${callbackFirst}`, async t => {
  const f = await fixture(t, { nativeFiles: true });
  const { packet, outcome } = await beginReview(f);
  await reviewScope(f, "early-permission");
  const agentId = "agent:early-permission", path = join(f.root, "app.js"), toolCallId = "read-before-start";
  const request = { kind: "read", toolCallId, path, intention: "Read native scope source." };
  assert.equal((await f.session.config.onPermissionRequest({ ...request, toolCallId: "unattributed" },
    { sessionId: "private" })).kind, "reject");
  let consent = callbackFirst ? f.session.config.onPermissionRequest(request, { sessionId: "private" }) : null;
  f.session.emit("permission.requested", { requestId: "native-permission", permissionRequest: request }, undefined, { agentId });
  assert.equal((await f.session.config.onPermissionRequest({ ...request, kind: "write" }, { sessionId: "private" })).kind, "reject");
  assert.equal((await f.session.config.onPermissionRequest({ ...request, path: "changed" }, { sessionId: "private" })).kind, "reject");
  consent ??= f.session.config.onPermissionRequest(request, { sessionId: "private" });
  await waitFor(() => f.broker.list().length === 1, "native early child consent");
  assert.equal(f.broker.list()[0].nativeInvocation.toolCallId, toolCallId);
  assert.equal(f.broker.list()[0].nativeInvocation.taskId, packet.binding.id);
  f.session.emit("tool.execution_start", { toolCallId, toolName: "view", arguments: { path },
    parentToolCallId: "early-permission" }, undefined, { agentId });
  await f.broker.decide(f.broker.list()[0].id, "once");
  assert.equal((await consent).kind, "approve-once");
  nativeCompletion(f, toolCallId, true, agentId);
  scopeEnd(f, "early-permission"); nativeCompletion(f, "early-permission"); await f.transport.drain();
  assert.equal((await f.session.config.onPermissionRequest(request, { sessionId: "private" })).kind, "reject");
  await f.finish(packet, "submit_whole_plan_review", outcome);
});

for (const all of [false, true]) test(`Reviewer retains native scope failure coverage without gating the parent: all=${all}`, async t => {
  const f = await fixture(t, { nativeFiles: true });
  const { packet, outcome } = await beginReview(f);
  assert.deepEqual(await reviewScope(f, "failed-start", { start: false }), {});
  nativeCompletion(f, "failed-start", false); await f.transport.drain();
  assert.deepEqual(await reviewScope(f, "failed-child"), {});
  scopeEnd(f, "failed-child", "failed"); nativeCompletion(f, "failed-child", false);
  assert.deepEqual(await reviewScope(f, "cancelled-child"), {});
  scopeEnd(f, "cancelled-child", "cancelled"); nativeCompletion(f, "cancelled-child", false);
  await f.transport.drain();
  if (!all) {
    assert.deepEqual(await reviewScope(f, "useful-remaining-scope"), {});
    scopeEnd(f, "useful-remaining-scope"); nativeCompletion(f, "useful-remaining-scope"); await f.transport.drain();
  }
  await f.finish(packet, "submit_whole_plan_review", outcome);
  const state = await f.store.load(), review = state.cycles[0].reviewResult.outcome;
  assert.equal(review.coverageStatus, all ? "unavailable" : "partial");
  assert.equal(review.verificationLimits.length, 3);
  for (const id of ["failed-start", "failed-child", "cancelled-child"]) assert.ok(review.verificationLimits.some(line => line.includes(id)));
  assert.equal(state.cycles[0].phase, "completed");
  assert.ok(state.cycles[0].implementationResult);
  await f.dispatch("host", "present-handoff", { handoffId: state.handoffs[0].id });
  await f.request();
  const next = await f.begin("router");
  await f.finish(next, "submit_human_route", { kind: "route", intent: "answer", cycleId: null, summary: "Next authorized request.", resolvedQuestions: [] });
});

for (const grant of ["all", "once"]) test(`same-session grants survive roles and supported child callbacks without upgrading once: ${grant}`, async t => {
  const f = await fixture(t, { nativeFiles: true });
  let sequence = 0;
  const read = async (role, agentId = null) => {
    const id = `read:${++sequence}`, path = join(f.root, "app.js");
    assert.deepEqual(await nativeAdmission(f, id, "view", { path }, agentId), {});
    const permission = f.session.config.onPermissionRequest({ kind: "read", toolCallId: id, path, intention: role },
      { sessionId: f.session.sessionId });
    if (role === "router" || grant === "once") {
      await waitFor(() => f.broker.list().length === 1, "explicit existing session grant");
      assert.equal(f.broker.list()[0].canApproveAll, true);
      await f.broker.decide(f.broker.list()[0].id, grant);
    }
    assert.equal((await permission).kind, "approve-once");
    assert.deepEqual(f.broker.remembered(f.session.sessionId), { all: grant === "all", tools: [] });
    assert.deepEqual(f.broker.list(), []);
    nativeCompletion(f, id, true, agentId); await f.transport.drain();
  };
  const { packet, outcome } = await beginReview(f, role => read(role));
  assert.deepEqual(await reviewScope(f, "read-only-child"), {});
  await read("child", "agent:read-only-child");
  scopeEnd(f, "read-only-child"); nativeCompletion(f, "read-only-child"); await f.transport.drain();
  await f.finish(packet, "submit_whole_plan_review", outcome);
  assert.deepEqual(f.broker.remembered(f.session.sessionId), { all: grant === "all", tools: [] });
});

for (const queryError of [false, true]) test(`whole parent Review failure ends advisably and releases a distinct request: query=${queryError}`, { timeout: 30_000 }, async t => {
  const f = await fixture(t, { nativeFiles: true });
  const { packet } = await beginReview(f);
  const implementation = structuredClone((await f.store.load()).cycles[0].implementationResult);
  if (queryError) f.session.emit("session.error", { errorType: "query", message: "Native model query failed." });
  else {
    const sends = f.session.sends.length;
    f.session.emit("session.idle", { mode: "interactive" });
    await waitFor(() => f.session.sends.length === sends + 1, "same-role recovery");
    await f.transport.drain();
    f.session.emit("session.idle", { mode: "interactive" });
  }
  const result = await f.transport.waitForResult(packet.binding.id);
  await f.dispatch("host", "record-result-snapshot", { taskId: packet.binding.id, resultId: result.resultId, snapshot: f.baseline });
  const failed = (await f.store.load()).activeTask.result;
  assert.equal(failed.outcome.kind, "review-incomplete");
  await f.dispatch("host", "apply-result", { resultId: failed.resultId, designPublication: null });
  f.transport.release(packet.binding.id);
  let state = await f.store.load();
  assert.deepEqual(state.cycles[0].implementationResult, implementation);
  assert.equal(state.cycles[0].phase, "completed");
  assert.equal(state.uncertainty, null);
  await f.dispatch("host", "present-handoff", { handoffId: state.handoffs[0].id });
  await f.request();
  const next = await f.begin("router");
  await f.finish(next, "submit_human_route", { kind: "route", intent: "answer", cycleId: null, summary: "Independent request.", resolvedQuestions: [] });
  state = await f.store.load();
  assert.deepEqual(await new HumanLoopStore(f.owner).load(), state, "A fresh store replays the incomplete attempt and next request.");
});

for (const taskReturn of [true, false]) test(`Stop during Review children withdraws permission and prohibits late publication: task return=${taskReturn}`, async t => {
  const f = await fixture(t, { nativeFiles: true });
  const { packet, outcome } = await beginReview(f);
  await reviewScope(f, "stopped-child");
  const path = join(f.root, "app.js");
  await nativeAdmission(f, "pending-child-read", "view", { path }, "agent:stopped-child");
  const permission = f.session.config.onPermissionRequest({ kind: "read", toolCallId: "pending-child-read", path,
    intention: "Read-only child" }, { sessionId: f.session.sessionId });
  await waitFor(() => f.broker.list().length === 1, "child permission before Stop");
  t.mock.method(f.session, "abort", async () => {
    f.session.aborts++;
    nativeCompletion(f, "pending-child-read", false, "agent:stopped-child");
    scopeEnd(f, "stopped-child", taskReturn ? "cancelled" : "completed");
    if (taskReturn) nativeCompletion(f, "stopped-child", false);
    f.session.processing = false; f.session.emit("assistant.idle", { aborted: true });
  });
  await f.dispatch("user", "request-stop", { stopId: "stop-review" });
  const stopped = await f.transport.stop("stop-review");
  assert.equal(stopped.interrupted, true);
  assert.deepEqual(f.session.cancelledFactories, ["factory:stopped-child"]);
  if (!taskReturn) {
    assert.equal(f.session.history.some(event => event.type === "tool.execution_complete"
      && event.data.toolCallId === "stopped-child"), false, "Interrupted task return must not be synthesized.");
    nativeCompletion(f, "stopped-child", false);
    const completion = f.session.history.at(-1);
    f.session.config.onEvent(completion);
    await f.transport.drain();
  }
  assert.equal((await permission).kind, "reject");
  assert.deepEqual(f.broker.list(), []);
  await assert.rejects(f.session.call("submit_whole_plan_review", { schemaVersion: "human-role-result/v1",
    resultId: "late-report", inputDigest: packet.binding.inputDigest, outcome }), /no longer permits tool work/);
  await f.dispatch("host", "record-native-stop", { stopId: "stop-review", ...stopped });
  await f.dispatch("host", "confirm-stop", { stopId: "stop-review", snapshot: f.baseline });
  f.transport.release(packet.binding.id);
  const state = await f.store.load();
  assert.equal(state.handoffs.length, 0);
  assert.equal(state.cycles[0].reviewResult, null);
  assert.ok(state.cycles[0].implementationResult);
});

test("native file invocation retains its permission boundary independently of terminal submission", async t => {
  const f = await fixture(t, { nativeFiles: true });
  assert.equal(f.session.config.availableTools, undefined);
  assert.equal(f.session.config.enableConfigDiscovery, true);
  assert.ok(!f.session.config.tools.some(tool => ["view", "read_project_file"].includes(tool.name)));
  await f.request();
  const task = await f.begin("router");
  const args = { path: join(f.root, "app.js") }, toolCallId = "owned-native-view";
  f.session.emit("tool.execution_start", { toolName: "view", arguments: args, toolCallId, turnId: f.session.turnId });
  const hook = await f.session.config.hooks.onPreToolUse({ sessionId: "private", toolName: "view", toolArgs: args }, { sessionId: "private" });
  assert.notEqual(hook.permissionDecision, "deny");
  const outcome = { kind: "route", intent: "answer", cycleId: null, summary: "Read only.", resolvedQuestions: [] };
  const permission = f.session.config.onPermissionRequest({ kind: "read", toolCallId, path: args.path, intention: "Read exact file" }, { sessionId: "private" });
  await waitFor(() => f.broker.list().length === 1, "native file permission");
  const request = f.broker.list()[0];
  assert.equal(request.canApproveForSession, false);
  assert.equal(request.canApproveAll, true);
  assert.equal(request.nativeInvocation.toolCallId, toolCallId);
  assert.equal(request.nativeInvocation.taskId, task.binding.id);
  await f.broker.decide(request.id, "once");
  assert.equal((await permission).kind, "approve-once");
  await f.finish(task, "submit_human_route", outcome);
  f.session.emit("tool.execution_complete", { toolCallId, success: true, turnId: f.session.turnId, interactionId: f.session.interactionId });
  await f.transport.drain();
  const after = await f.session.config.hooks.onPreToolUse({ sessionId: "private", toolName: "view", toolArgs: args }, { sessionId: "private" });
  assert.equal(after.permissionDecision, "deny");
  const next = await f.begin("agent");
  await f.finish(next, "submit_readonly_answer", { kind: "answer", summary: "Done.", report: "The read-only request is complete.", evidenceRefs: [] });
  await f.dispatch("host", "present-handoff", { handoffId: (await f.store.load()).handoffs.at(-1).id });
});

test("native catalog and SDK descendant callbacks retain permissions without becoming root role evidence", async t => {
  const f = await fixture(t, { nativeFiles: true });
  await f.request();
  const task = await f.begin("router"), calls = [];
  assert.equal(f.session.config.availableTools, undefined);
  assert.equal(Object.hasOwn(f.session.config, "systemMessage"), false);
  const unobserved = await f.session.config.hooks.onPreToolUse({ sessionId: "unobserved-descendant",
    toolName: "view", toolArgs: { path: join(f.root, "app.js") } }, { sessionId: "private" });
  assert.equal(unobserved.permissionDecision, "deny");
  const invoke = async (toolName, toolArgs, request, agentId = null, decision = "once") => {
    const toolCallId = `catalog-${calls.length}`;
    calls.push(toolCallId);
    const scope = agentId ? { agentId } : {};
    f.session.emit("tool.execution_start", { toolName, arguments: toolArgs, toolCallId, turnId: "0" }, undefined, scope);
    const input = { sessionId: agentId ? "sdk-descendant-session" : "private", toolName, toolArgs };
    const foreign = await f.session.config.hooks.onPreToolUse(input, { sessionId: "foreign" });
    assert.equal(foreign.permissionDecision, "deny");
    const hook = await f.session.config.hooks.onPreToolUse(input, { sessionId: "private" });
    assert.deepEqual(hook, {});
    const permission = f.session.config.onPermissionRequest({ ...request, toolCallId }, { sessionId: "private" });
    await waitFor(() => f.broker.list().length === 1, "normal native catalog permission");
    assert.equal(f.broker.list()[0].canApproveForSession, false);
    await f.broker.decide(f.broker.list()[0].id, decision);
    assert.equal((await permission).kind, decision === "once" ? "approve-once" : "reject");
    f.session.emit("tool.execution_complete", { toolCallId, success: decision === "once",
      turnId: "0", interactionId: f.session.interactionId }, undefined, scope);
    await f.transport.drain();
    if (agentId) {
      const stale = await f.session.config.onPermissionRequest({ ...request, toolCallId }, { sessionId: "private" });
      assert.equal(stale.kind, "reject");
      assert.deepEqual(f.broker.list(), []);
    }
  };
  await invoke("configured-mcp-tool", { topic: "fixture" }, {
    kind: "mcp", serverName: "configured-fixture", toolName: "lookup", toolTitle: "Fixture lookup", readOnly: true,
  }, null, "denied");
  await invoke("native-inspection-tool", { exact: "native arguments" }, {
    kind: "url", url: "https://example.invalid/fixture", intention: "Scripted native request only",
  });
  for (const decision of ["once", "denied"]) {
    await invoke("view", { path: join(f.root, "app.js") },
      { kind: "read", path: join(f.root, "app.js"), intention: "SDK descendant read" }, "sdk-descendant-instance", decision);
  }
  for (const type of ["user.message", "assistant.message", "assistant.reasoning", "assistant.turn_end",
    "assistant.idle", "session.error", "session.compaction_start"]) {
    f.session.emit(type, { content: "Private descendant content", turnId: "child", interactionId: "child",
      message: "Descendant-local event" }, undefined, { agentId: "sdk-descendant-instance" });
  }
  const domainId = "child-domain";
  f.session.emit("tool.execution_start", { toolCallId: domainId, toolName: "submit_human_route", arguments: {}, turnId: "0" },
    undefined, { agentId: "sdk-descendant-instance" });
  const denied = await f.session.config.hooks.onPreToolUse({ sessionId: "sdk-descendant-session",
    toolName: "submit_human_route", toolArgs: {} }, { sessionId: "private" });
  assert.equal(denied.permissionDecision, "deny");
  await assert.rejects(f.session.config.tools.find(tool => tool.name === "submit_human_route").handler({}, {
    sessionId: "private", toolName: "submit_human_route", toolCallId: domainId,
  }), /Descendants cannot submit/);
  f.session.emit("tool.execution_complete", { toolCallId: domainId, success: false },
    undefined, { agentId: "sdk-descendant-instance" });
  await f.transport.drain();
  const state = await f.store.load();
  assert.equal(state.activeTask.binding.id, task.binding.id);
  assert.equal(state.activeTask.result, null);
  assert.equal(state.activeTask.end, null);
  assert.equal(state.uncertainty, null);
  assert.equal(state.requests.length, 1);
  assert.doesNotMatch(JSON.stringify(await f.store.messages()), /Private descendant content/);
  await f.finish(task, "submit_human_route", { kind: "route", intent: "answer", cycleId: null, summary: "Root route.", resolvedQuestions: [] });
  const answer = await f.begin("agent");
  await f.finish(answer, "submit_readonly_answer", { kind: "answer", summary: "Root answer.",
    report: "Only root domain tools finalized the request.", evidenceRefs: [] });
  await f.dispatch("host", "present-handoff", { handoffId: (await f.store.load()).handoffs.at(-1).id });
});

test("native patch grammar, targets and outcomes pass unchanged without file preflight or index recertification", async t => {
  const f = await fixture(t, { nativeFiles: true });
  await f.request();
  const task = await f.begin("router");
  for (const method of ["inspectNativePath", "inspectNativePaths", "protectedIndexDigest"]) {
    t.mock.method(f.workspace, method, () => assert.fail("Native file operations must reach the host without a second file policy."));
  }
  const cases = [
    ["*** Begin Patch\n*** Add File: app.js\n+native replacement\n*** End Patch", true],
    ["*** Begin Patch\r\n*** Update File: app.js\r\n*** Move to: existing.js\r\n@@\r\n-old\r\n+new\r\n*** End Patch\r\n", true],
    ["*** Begin Patch\n*** Add File: TANDEM.md\n+native index edit\n*** End Patch\n", true],
    ["invalid native patch syntax", false],
    ["*** Begin Patch\n*** Update File: absent.js\n@@\n-stale\n+new\n*** End Patch\n", false],
  ];
  for (const [index, [args, success]] of cases.entries()) {
    const toolCallId = `native-patch-${index}`;
    f.session.emit("tool.execution_start", { toolName: "apply_patch", arguments: args, toolCallId, turnId: f.session.turnId });
    assert.deepEqual(await f.session.config.hooks.onPreToolUse(
      { sessionId: "private", toolName: "apply_patch", toolArgs: args }, { sessionId: "private" }), {});
    const permission = f.session.config.onPermissionRequest({ kind: "write", toolCallId,
      fileName: join(f.root, index === 2 ? "TANDEM.md" : "app.js"), intention: "Native-selected write target", diff: args },
    { sessionId: "private" });
    await waitFor(() => f.broker.list().length === 1, "native patch permission");
    await f.broker.decide(f.broker.list()[0].id, "once");
    assert.equal((await permission).kind, "approve-once");
    if (index === 2) await writeFile(join(f.root, "TANDEM.md"), "Native-authorized edit\n");
    f.session.emit("tool.execution_complete", { toolCallId, success,
      result: { content: success ? "Native patch applied." : "Native validation error." },
      turnId: f.session.turnId, interactionId: f.session.interactionId });
    await f.transport.drain();
    assert.equal((await f.store.load()).uncertainty, null);
  }
  await f.finish(task, "submit_human_route", { kind: "route", intent: "answer", cycleId: null,
    summary: "Native outcomes observed without substituting domain publication.", resolvedQuestions: [] });
});

test("native file denials drain their real failed invocation without granting foreign permissions", async t => {
  const f = await fixture(t, { nativeFiles: true });
  await f.request();
  const task = await f.begin("router");
  for (const [name, args] of [
    ["apply_patch", "*** Begin Patch\n*** Add File: TANDEM.md\n+code\n*** End Patch\n"],
    ["view", { path: join(f.root, ".tandem", "living-canvas", "human-loop", "ledger.json") }],
  ]) {
    const toolCallId = `denied-${name}`;
    f.session.emit("tool.execution_start", { toolName: name, arguments: args, toolCallId, turnId: f.session.turnId });
    const hook = await f.session.config.hooks.onPreToolUse({ sessionId: "private", toolName: name, toolArgs: args }, { sessionId: "private" });
    assert.deepEqual(hook, {}, "Native permissions, not Tandem path policy, decide file access.");
    const permission = f.session.config.onPermissionRequest({ toolCallId, intention: "Native file request",
      ...(name === "apply_patch" ? { kind: "write", fileName: join(f.root, "TANDEM.md"), diff: args }
        : { kind: "read", path: args.path }) }, { sessionId: "private" });
    await waitFor(() => f.broker.list().length === 1, "native denial decision");
    await f.broker.decide(f.broker.list()[0].id, "denied");
    assert.equal((await permission).kind, "reject");
    f.session.emit("tool.execution_complete", { toolCallId, success: false, turnId: f.session.turnId, interactionId: f.session.interactionId });
    await f.transport.drain();
  }
  assert.equal((await f.session.config.onPermissionRequest({ kind: "read", toolCallId: "unowned",
    path: join(f.root, "app.js"), intention: "Foreign request" }, { sessionId: "private" })).kind, "reject");
  assert.deepEqual(f.broker.list(), []);
  assert.equal((await f.store.load()).uncertainty, null);
  await f.finish(task, "submit_human_route", { kind: "route", intent: "answer", cycleId: null, summary: "No writes.", resolvedQuestions: [] });
});

test("native view rg and glob reach the host hook unchanged without enumerating matches", async t => {
  const f = await fixture(t, { nativeFiles: true });
  await f.request();
  const task = await f.begin("router");
  t.mock.method(f.workspace, "list", () => assert.fail("Native search must not enumerate Tandem snapshot targets."));
  for (const method of ["inspectNativePath", "inspectNativePaths", "protectedIndexDigest"]) {
    t.mock.method(f.workspace, method, () => assert.fail("Native file hooks must not run a second filesystem or index policy."));
  }
  const cases = [
    ["rg", { pattern: "\\.profile|1120|630", paths: [f.root], glob: "!node_modules/**", head_limit: 17,
      output_mode: "content", "-n": true, "-i": true, "-A": 2, "-B": 1, "-C": 3, multiline: true }, f.root, ""],
    ["rg", { pattern: "", paths: "app.js", type: "js", output_mode: "count" }, join(f.root, "app.js"), "0"],
    ["glob", { pattern: "**/*.{not-present,missing}", paths: [f.root] }, f.root, "[]"],
    ["glob", { pattern: "*.js" }, join(f.root, "app.js"), '["app.js"]'],
    ["view", { path: ".", forceReadLargeFiles: true }, f.root, "app.js"],
    ["view", { path: "app.js", view_range: [1, -1] }, join(f.root, "app.js"), "export const initial = true;"],
  ];
  for (const [index, [name, args, path, output]] of cases.entries()) {
    const original = structuredClone(args), toolCallId = `native-selection-${index}`;
    f.session.emit("tool.execution_start", { toolName: name, arguments: args, toolCallId, turnId: f.session.turnId });
    const hook = await f.session.config.hooks.onPreToolUse(
      { sessionId: "private", toolName: name, toolArgs: args }, { sessionId: "private" });
    assert.deepEqual(hook, {}, `${name} must leave arguments and native permission behavior untouched`);
    assert.deepEqual(hook.modifiedArgs ?? args, original);
    const permission = f.session.config.onPermissionRequest(
      { kind: "read", toolCallId, path, intention: "Native-selected read scope" }, { sessionId: "private" });
    await waitFor(() => f.broker.list().length === 1, "ordinary native selection permission");
    assert.equal(f.broker.list()[0].nativeInvocation.toolCallId, toolCallId);
    await f.broker.decide(f.broker.list()[0].id, "once");
    assert.equal((await permission).kind, "approve-once");
    f.session.emit("tool.execution_complete", { toolCallId, success: true, result: { content: output },
      turnId: f.session.turnId, interactionId: f.session.interactionId });
    await f.transport.drain();
    assert.deepEqual(args, original);
    assert.equal((await f.store.load()).uncertainty, null);
  }
  assert.deepEqual(f.broker.list(), []);
  await f.finish(task, "submit_human_route", {
    kind: "route", intent: "answer", cycleId: null, summary: "Native selections preserved.", resolvedQuestions: [],
  });
});

async function pendingTerminalRouter(t, options = {}) {
  const f = await fixture(t, { terminalIdle: false, suppressTurnEnd: true, ...options });
  await f.request();
  const task = await f.begin("router");
  await f.session.call("submit_human_route", {
    schemaVersion: "human-role-result/v1", resultId: `result-${task.binding.id}`, inputDigest: task.binding.inputDigest,
    outcome: { kind: "route", intent: "answer", cycleId: null, summary: "Retained route.", resolvedQuestions: [] },
  });
  await f.transport.drain();
  return { ...f, task };
}

for (const pending of ["native-tool", "permission", "processing-and-queue", "no-terminal-events"]) {
  test(`saved terminal submission alone completes despite ${pending}`, async t => {
    const f = await fixture(t, { nativeFiles: true, terminalIdle: false, suppressTurnEnd: true });
    await f.request();
    const task = await f.begin("router");
    f.session.completeTool = false;
    let permission;
    if (["native-tool", "permission"].includes(pending)) {
      const path = join(f.root, "app.js");
      await nativeAdmission(f, "unfinished-read", "view", { path });
      if (pending === "permission") {
        permission = f.session.config.onPermissionRequest({ kind: "read", toolCallId: "unfinished-read", path },
          { sessionId: "private" });
        await waitFor(() => f.broker.list().length === 1, "unanswered permission");
      }
    }
    if (pending === "processing-and-queue") {
      f.session.rpc.metadata.activity = async () => ({ hasActiveWork: true });
      f.session.rpc.queue.pendingItems = async () => { throw new Error("Completion must not inspect the native queue"); };
    }
    const result = await f.finish(task, "submit_human_route", {
      kind: "route", intent: "answer", cycleId: null, summary: "Declared result.", resolvedQuestions: [],
    });
    const state = await f.store.load(), execution = state.executions.at(-1);
    assert.equal(execution.completion, "result-submission");
    assert.equal(execution.end, null);
    assert.equal(execution.result.resultId, result.resultId);
    assert.equal(f.session.aborts, 0);
    assert.equal(f.session.processing, true);
    if (permission) assert.equal((await permission).kind, "reject");
    const next = await f.begin("agent");
    assert.equal(f.session.sends.at(-1).mode, "immediate");
    await f.finish(next, "submit_readonly_answer", { kind: "answer", summary: "Next role.", report: "Authorized next work.", evidenceRefs: [] });
  });
}

test("unfinished native scopes disclose unavailable coverage but cannot veto the parent result", async t => {
  const f = await fixture(t, { nativeFiles: true });
  const { packet, outcome } = await beginReview(f);
  await reviewScope(f, "unfinished-scope");
  f.session.completeTool = false;
  await f.finish(packet, "submit_whole_plan_review", outcome);
  const state = await f.store.load(), report = state.cycles[0].reviewResult.outcome;
  assert.equal(report.coverageStatus, "unavailable");
  assert.match(report.verificationLimits.join("\n"), /unfinished-scope.*unreviewed/);
  assert.equal(state.executions.at(-1).end, null);
  assert.equal(state.handoffs.length, 1);
});

test("terminal submission retains role schema identity duplicate and real persistence checks", async t => {
  const f = await fixture(t);
  await f.request();
  const task = await f.begin("router");
  const result = { schemaVersion: "human-role-result/v1", resultId: "validated-result",
    inputDigest: task.binding.inputDigest, outcome: {
      kind: "route", intent: "answer", cycleId: null, summary: "Valid result.", resolvedQuestions: [],
    } };
  await assert.rejects(f.session.call("submit_readonly_answer", result), /outside the current role/);
  await assert.rejects(f.session.call("submit_human_route", { ...result, inputDigest: "0".repeat(64) }), /inputDigest/);
  await assert.rejects(f.session.call("submit_human_route", { ...result, outcome: {} }));
  const dispatch = f.store.dispatch.bind(f.store);
  const fault = t.mock.method(f.store, "dispatch", (...args) => {
    if (args[2] === "complete-role-result") throw new Error("Actual result save failed");
    return dispatch(...args);
  });
  await assert.rejects(f.session.call("submit_human_route", result), /Actual result save failed/);
  assert.equal((await f.store.load()).activeTask.result, null);
  fault.mock.restore();
  await f.session.call("submit_human_route", result);
  await assert.rejects(f.session.call("submit_human_route", result), /no longer permits|already submitted/);
  assert.equal((await f.store.load()).activeTask.result.resultId, result.resultId);
});

for (const interrupted of [false, true]) test(`native Stop outcome ${interrupted} needs no task or history certification`, async t => {
  const f = await fixture(t);
  await f.request();
  const task = await f.begin("router");
  f.session.getEvents = async () => { throw new Error("History is unavailable"); };
  f.session.rpc.metadata.activity = async () => ({ hasActiveWork: true });
  f.session.rpc.interruptMainTurn = async input => {
    assert.deepEqual(input, { flushQueued: true });
    return { interrupted };
  };
  await f.dispatch("host", "execution-unknown", { reason: "Retained historical uncertainty", evidenceRef: "history-problem" });
  await f.dispatch("user", "request-stop", { stopId: "native-outcome" });
  const outcome = await f.transport.stop("native-outcome");
  assert.deepEqual(outcome, { sessionId: "private", interrupted });
  await f.dispatch("host", "record-native-stop", { stopId: "native-outcome", ...outcome });
  await f.dispatch("host", "confirm-stop", { stopId: "native-outcome", snapshot: f.baseline });
  f.transport.release(task.binding.id);
  assert.equal((await f.store.load()).executions.at(-1).end, null);
});

for (const failure of ["history", "save", "pending-save", "shutdown"]) test(`Close attempts native shutdown despite ${failure}`, async t => {
  const f = await fixture(t, { closeInCleanup: false });
  await f.request();
  await f.begin("router");
  let shutdowns = 0;
  f.session.getEvents = async () => { throw new Error("History read unavailable"); };
  f.client.rpc.sessions.readPersistedEvents = async () => { throw new Error("Saved history unavailable"); };
  if (failure === "save") f.client.rpc.sessions.save = async () => { throw new Error("Explicit save failed"); };
  if (failure === "pending-save") f.client.rpc.sessions.save = () => new Promise(() => {});
  f.client.stop = async () => { shutdowns++; return failure === "shutdown" ? [new Error("Native shutdown failed")] : []; };
  if (failure === "shutdown") await assert.rejects(f.transport.close(), /Native shutdown failed/);
  else {
    const receipt = await f.transport.close();
    assert.equal(receipt.closed, true);
    assert.equal(receipt.saved, !["save", "pending-save"].includes(failure));
    assert.equal(receipt.warnings.length > 0, ["save", "pending-save"].includes(failure));
    assert.equal(receipt.events, undefined);
  }
  assert.equal(shutdowns, 1);
});

test("intentional Stop during pending native send acknowledgement does not poison the next request", async t => {
  const f = await fixture(t), release = Promise.withResolvers();
  await f.request();
  f.session.onSend = () => release.promise;
  const starting = f.begin("router");
  const cancelled = assert.rejects(starting, { code: "human-loop-stop" });
  await waitFor(() => f.session.sends.length === 1, "native send before acknowledgement");
  await f.dispatch("user", "request-stop", { stopId: "during-ack" });
  const outcome = await f.transport.stop("during-ack");
  await cancelled;
  const task = (await f.store.load()).activeTask;
  await f.dispatch("host", "record-native-stop", { stopId: "during-ack", ...outcome });
  await f.dispatch("host", "confirm-stop", { stopId: "during-ack", snapshot: f.baseline });
  f.transport.release(task.binding.id);
  release.resolve(); f.session.onSend = null;
  await f.transport.drain();
  await f.request();
  const next = await f.begin("router");
  await f.finish(next, "submit_human_route", { kind: "route", intent: "answer", cycleId: null,
    summary: "New authorized request.", resolvedQuestions: [] });
  assert.equal((await f.store.load()).uncertainty, null);
});

test("a contextual Designer answer uses ordinary Router authority, without automatic implementation from the Designer", async t => {
  const f = await fixture(t);
  await f.request();
  await f.finish(await f.begin("router"), "submit_human_route",
    { kind: "route", intent: "design", cycleId: null, summary: "Design first.", resolvedQuestions: [] });
  const designer = await f.begin("designer");
  await f.finish(designer, "submit_designer_outcome", { kind: "designer-unchanged", summary: "Clarify content.",
    explanation: "The current layout is sufficient.", questions: [{ id: "content",
      context: "Business details are missing.", question: "How should missing details be handled when implemented?",
      whyItMatters: "Draft accuracy.", importance: "advisory", allowFreeform: true,
      unanswered: { action: "keep-current-design", explanation: "Retain the agreed draft without applying a proposed change." },
      options: [{ id: "placeholder", label: "Build with clear placeholders", implication: "Draft before launch." }] }] });
  await f.dispatch("host", "present-handoff", { handoffId: (await f.store.load()).handoffs.at(-1).id });
  assert.equal((await f.store.load()).cycles.length, 0);
  const sourceResultId = `result-${designer.binding.id}`;
  await f.dispatch("user", "receive-request", { id: "answer-only", message: "Question form submission.",
    receivedAt: new Date().toISOString(), answers: { schemaVersion: "human-question-answers/v1",
      answers: [{ questionId: "content", sourceResultId, kind: "option", value: "placeholder" }] } });
  await f.dispatch("host", "admit-request", { requestId: "answer-only" });
  const router = await f.begin("router"), sends = f.session.sends.length;
  const args = { schemaVersion: "human-role-result/v1", resultId: `result-${router.binding.id}`,
    inputDigest: router.binding.inputDigest, outcome: { kind: "route", intent: "implement", cycleId: null,
      summary: "The selected wording requests building with clear placeholders.", resolvedQuestions: [{ questionId: "content", sourceResultId }] } };
  const before = await f.store.load();
  const invalid = { ...args, outcome: { ...args.outcome, resolvedQuestions: [{ questionId: "not-saved", sourceResultId }] } };
  await assert.rejects(f.session.call("submit_human_route", invalid), /durably saved answer/);
  const tool = f.session.config.tools.find(({ name }) => name === "submit_human_route");
  await assert.rejects(tool.handler(invalid, { sessionId: "private", toolName: tool.name, toolCallId: "bypass-hook" }),
    /durably saved answer/);
  assert.deepEqual(await f.store.load(), before, "Removing role-origin vetoes does not admit fabricated answer acknowledgements.");
  await f.finish(router, "submit_human_route", args.outcome);
  assert.equal(f.session.sends.length, sends, "The request still passes through the ordinary owned Router turn.");
  const state = await f.store.load();
  assert.equal(state.questions[0].state, "answered");
  assert.equal(state.requests.find(r => r.id === "answer-only").route.outcome.intent, "implement");
  assert.equal(state.cycles.length, 0, "Router routing alone does not bypass Host cycle/plan admission.");
});

test("one-copy private execution uses real Host acceptance, preserves dirty baseline and records exact owned terminal boundaries", async (t) => {
  let now = 0;
  const f = await fixture(t, { now: () => now });
  await f.request();
  let task = await f.begin("router");
  await f.finish(task, "submit_human_route", { kind: "route", intent: "implement", cycleId: null, summary: "Implement the user's request.", resolvedQuestions: [] });
  await f.dispatch("host", "start-cycle", { cycleId: "cycle", design, baseline: f.baseline });
  task = await f.begin("planner", "cycle");
  await f.finish(task, "submit_internal_plan", { kind: "internal-plan", plan: {
    schemaVersion: "internal-plan/v1", id: "plan", version: 1, goal: "Update the existing app.",
    design, baseline: f.baseline, tasks: [{ id: "edit", title: "Update app", scope: ["app.js"], dependsOn: [],
      criteria: [{ id: "correct", description: "The requested behavior works." }] }],
  } });
  const state = await f.store.load(), cycle = state.cycles[0], request = state.requests[0];
  await f.dispatch("host", "accept-plan", { cycleId: "cycle", acceptance: {
    schemaVersion: "internal-plan-acceptance/v1", authority: "host", cycleId: "cycle", requestId: request.id,
    sourceRequestIds: [...state.activeBatchRequestIds],
    routeResultId: request.route.resultId, planId: cycle.pendingPlan.id, planDigest: cycle.pendingPlan.digest,
    design, baseline: f.baseline, policyDigest: DEFAULT_POLICY.digest,
  } });
  task = await f.begin("implementer", "cycle", "edit", { scope: ["app.js"] });
  now = DEFAULT_POLICY.values.time.reviewMaximumMs + DEFAULT_POLICY.values.time.attemptMaximumMs;
  const { completion } = await observeLongRole(t, f, task);
  assert.deepEqual((await f.store.load()).owner.policy, DEFAULT_POLICY, "The stored legacy policy is not rewritten.");
  const read = await f.session.call("read_project_file", { path: "app.js" });
  assert.match(read.content, /pre-existing edit/);
  await f.session.call("replace_project_file", { path: "app.js", expectedDigest: read.digest,
    content: "export const original = 3; // requested change\n" });
  assert.match(await readFile(join(f.root, "app.js"), "utf8"), /requested change/);
  const proof = await f.finish(task, "submit_internal_task_result", { kind: "task-result", taskId: "edit",
    planDigest: (await f.store.load()).cycles[0].plan.digest, summary: "The internal task is reported complete.", evidenceRefs: ["app.js"] });
  assert.equal(proof.outcome.kind, "task-result");
  assert.equal((await completion).resultId, proof.resultId);
  assert.equal((await f.store.load()).executions.at(-1).end, null);
  assert.equal((await f.store.load()).cycles[0].phase, "implementing");
  assert.equal((await git(f.root, "worktree", "list", "--porcelain")).split("\n").filter((line) => line.startsWith("worktree ")).length, 1);
  assert.equal(f.owner.worktreePath, undefined);
  assert.equal(f.owner.targetWorktreePath, undefined);
  assert.equal(f.session.aborts, 0);
});

for (const ending of ["stop", "transport-error"]) test(`long active work remains ${ending === "stop" ? "natively stoppable" : "subject to real transport errors"}`, async t => {
  let now = 0;
  const f = await fixture(t, { now: () => now });
  await f.request();
  const task = await f.begin("router");
  now = DEFAULT_POLICY.values.time.reviewMaximumMs * 3;
  const { completion } = await observeLongRole(t, f, task);
  if (ending === "stop") {
    const rejected = assert.rejects(completion, { code: "human-loop-stop" });
    await f.dispatch("user", "request-stop", { stopId: "long-stop" });
    assert.equal((await f.transport.stop("long-stop")).interrupted, true);
    await rejected;
    assert.equal((await f.store.load()).activeTask.result, null);
    assert.equal((await f.store.load()).uncertainty, null);
  } else {
    const failed = assert.rejects(completion, /private runtime reported interruption.*session\.error/i);
    f.session.emit("session.error", { message: "Fixture connection lost." });
    await failed;
    await waitFor(async () => (await f.store.load()).uncertainty, "durable native failure");
    assert.match((await f.store.load()).uncertainty.reason, /private runtime reported interruption.*session\.error/i);
  }
});

test("an early typed result completes durably before send acknowledgement without inventing native end", async (t) => {
  const f = await fixture(t);
  await f.request();
  f.session.onSend = async (packet) => {
    await f.session.call("submit_human_route", { schemaVersion: "human-role-result/v1", resultId: "early",
      inputDigest: packet.binding.inputDigest, outcome: { kind: "route", intent: "answer", cycleId: null, summary: "Read-only request.", resolvedQuestions: [] } });
    const state = await f.store.load();
    assert.equal(state.activeTask.messageId, null);
    assert.equal(state.activeTask.result.resultId, "early");
    const durable = await new HumanLoopStore(f.owner).load();
    assert.deepEqual(durable.activeTask.result, state.activeTask.result);
    assert.equal(durable.activeTask.completion, "result-submission");
    assert.equal(durable.activeTask.end, null);
  };
  const task = await f.begin("router");
  const result = await f.transport.waitForResult(task.binding.id);
  await f.dispatch("host", "record-result-snapshot", { taskId: task.binding.id, resultId: result.resultId, snapshot: f.baseline });
  await f.dispatch("host", "apply-result", { resultId: "early", designPublication: null });
  f.transport.release(task.binding.id);
  assert.equal(f.session.sends.length, 1);
});

test("new-model Stop withdraws owned permission, discards old queue and leaves later requests new", async (t) => {
  let now = 0;
  const f = await fixture(t, { permission: true, now: () => now });
  t.mock.method(f.session.rpc, "abort", async () => { assert.fail("Explicit Stop must retain session.abort()."); });
  await f.request();
  let task = await f.begin("router");
  await f.finish(task, "submit_human_route", { kind: "route", intent: "answer", cycleId: null, summary: "Run requested check.", resolvedQuestions: [] });
  task = await f.begin("agent");
  const pending = f.session.call("run_owned_check", {}).then((value) => ({ value }), (error) => ({ error }));
  while (!f.broker.list().length) await new Promise((resolve) => setImmediate(resolve));
  const permissionId = f.broker.list()[0].id;
  assert.ok(f.broker.list()[0].description.includes(`Project working copy: ${f.root}`));
  assert.ok(f.broker.list()[0].description.includes("Requested arguments: {}"));
  now = 400_000;
  assert.equal(f.transport.timing(task.binding.id).activeMs, 0);
  await f.dispatch("user", "receive-request", { id: "old", message: "Old queued request.", receivedAt: new Date().toISOString(), answers: null });
  await f.dispatch("user", "request-stop", { stopId: "stop" });
  await f.dispatch("user", "receive-request", { id: "new", message: "Later input.", receivedAt: new Date().toISOString(), answers: null });
  const stopped = await f.transport.stop("stop");
  await f.dispatch("host", "record-native-stop", { stopId: "stop", ...stopped });
  await f.dispatch("host", "confirm-stop", { stopId: "stop", snapshot: await f.workspace.capture() });
  f.transport.release(task.binding.id);
  assert.ok((await pending).error);
  assert.deepEqual(f.broker.list(), []);
  await assert.rejects(f.broker.decide(permissionId, "once"), /not pending/);
  const state = await f.store.load();
  assert.equal(state.requests.find(({ id }) => id === "old").status, "discarded");
  assert.equal(state.requests.find(({ id }) => id === "new").status, "waiting");
  assert.equal(state.uncertainty, null);
});

test("Ready reset clears SDK and local per-tool grants so subsequent commands need new permission", async t => {
  const f = await fixture(t, { permission: true });
  let resets = 0;
  f.session.rpc.permissions = { resetSessionApprovals: async args => {
    assert.deepEqual(args, { includeLocation: false }); resets++; return { success: true };
  } };
  async function agent() {
    await f.request();
    await f.finish(await f.begin("router"), "submit_human_route",
      { kind: "route", intent: "answer", cycleId: null, summary: "Check.", resolvedQuestions: [] });
    return f.begin("agent");
  }
  const task = await agent();
  const pending = f.session.call("run_owned_check", {});
  while (!f.broker.list().length) await new Promise(resolve => setImmediate(resolve));
  await f.broker.decide(f.broker.list()[0].id, "session"); await pending;
  await assert.rejects(f.transport.resetRememberedApprovals(), /idle/);
  assert.equal(resets, 0);
  await f.finish(task, "submit_readonly_answer", { kind: "answer", summary: "Checked", report: "Checked", evidenceRefs: [] });
  await f.dispatch("host", "present-handoff", { handoffId: (await f.store.load()).handoffs.at(-1).id });
  await f.transport.resetRememberedApprovals(); f.broker.resetSession("private");
  assert.equal(resets, 1);
  await agent();
  const tool = f.session.config.tools.find(item => item.name === "run_owned_check");
  tool.skipPermission = true;
  await assert.rejects(f.session.call("run_owned_check", {}), /genuine permission grant/);
  tool.skipPermission = false;
  const next = f.session.call("run_owned_check", {});
  while (!f.broker.list().length) await new Promise(resolve => setImmediate(resolve));
  await f.broker.decide(f.broker.list()[0].id, "once");
  assert.equal(await next, "Checked");
});

test("long permission waits remain measured and later active work can complete beyond the old role limit", async t => {
  let now = 0;
  const f = await fixture(t, { permission: true, now: () => now });
  await f.request();
  await f.finish(await f.begin("router"), "submit_human_route",
    { kind: "route", intent: "answer", cycleId: null, summary: "Run the requested check.", resolvedQuestions: [] });
  const task = await f.begin("agent");
  now = 200_000;
  const pending = f.session.call("run_owned_check", {});
  while (!f.broker.list().length) await new Promise(resolve => setImmediate(resolve));
  now += 900_000;
  assert.equal(f.transport.timing(task.binding.id).permissionWaitMs, 900_000);
  await f.broker.decide(f.broker.list()[0].id, "once");
  assert.equal(await pending, "Checked");
  now += 300_000;
  assert.equal(f.transport.timing(task.binding.id).activeMs, 500_000);
  const { completion } = await observeLongRole(t, f, task);
  await f.finish(task, "submit_readonly_answer", { kind: "answer", summary: "Completed the requested check.",
    report: "The granted tool returned successfully; long elapsed time did not cancel the role.", evidenceRefs: [] });
  assert.equal((await completion).inputDigest, task.binding.inputDigest);
  assert.equal((await f.store.load()).uncertainty, null);
});

test("session idle after one missing-result continuation reports failure rather than partial success or a Design concern", { timeout: 30_000 }, async (t) => {
  const f = await fixture(t);
  await f.request();
  const task = await f.begin("router");
  f.session.processing = false;
  f.session.emit("session.idle", { mode: "interactive" });
  await waitFor(() => f.session.sends.length === 2, "same-role recovery");
  await f.transport.drain();
  f.session.emit("session.idle", { mode: "interactive" });
  await f.transport.waitForResult(task.binding.id);
  const failed = (await f.store.load()).activeTask.result;
  assert.equal(failed.outcome.kind, "execution-failure");
  await f.dispatch("host", "record-result-snapshot", { taskId: task.binding.id, resultId: failed.resultId, snapshot: await f.workspace.capture() });
  await f.dispatch("host", "apply-result", { resultId: failed.resultId, designPublication: null });
  f.transport.release(task.binding.id);
  assert.equal((await f.store.load()).questions.length, 0);
  assert.equal((await f.store.load()).uncertainty, null);
  assert.equal((await f.store.load()).handoffs[0].result.outcome.kind, "execution-failure");
});

test("after-step intent leaves the admitted role authorized until its typed result", { timeout: 60_000 }, async (t) => {
  const f = await fixture(t);
  await f.request();
  const task = await f.begin("router");
  await f.dispatch("user", "request-step-stop", { stopId: "after-role" });
  const pending = (await replayDurableState(f.root)).state;
  assert.equal(pending.stop.mode, "after-step");
  assert.equal(pending.stop.taskId, task.binding.id);
  assert.equal(pending.activeTask.condition, "running");
  assert.equal(f.session.aborts, 0);
  await assert.rejects(f.dispatch("host", "confirm-stop", { stopId: "after-role", snapshot: f.baseline }), /actual native operation response/);
  await f.finish(task, "submit_human_route", { kind: "route", intent: "answer", cycleId: null,
    summary: "Current role completed normally.", resolvedQuestions: [] });
  const settled = await f.store.load();
  assert.equal(settled.executions[0].completion, "result-submission");
  assert.equal(settled.executions[0].end, null);
  assert.equal(settled.stop.acknowledged, false, "Result-owned cancellation is not a user Stop acknowledgement.");
  assert.equal(f.session.aborts, 0);
  assert.equal(f.session.sends.length, 1);
  await f.dispatch("host", "confirm-stop", { stopId: "after-role", snapshot: f.baseline });
  const stopped = (await replayDurableState(f.root)).state;
  assert.equal(stopped.stops[0].mode, "after-step");
  assert.equal(stopped.requests[0].status, "stopped");
  assert.equal(stopped.uncertainty, null);
});

test("after-step intent retains the settling role permission instead of aborting or withdrawing it", { timeout: 60_000 }, async (t) => {
  const f = await fixture(t, { permission: true }), requested = Promise.withResolvers();
  await f.request();
  const router = await f.begin("router");
  await f.finish(router, "submit_human_route", { kind: "route", intent: "answer", cycleId: null,
    summary: "Run the requested check.", resolvedQuestions: [] });
  const agent = await f.begin("agent");
  const request = f.broker.request.bind(f.broker);
  t.mock.method(f.broker, "request", (...args) => {
    const decision = request(...args); requested.resolve(); return decision;
  });
  const checking = f.session.call("run_owned_check", {});
  await requested.promise;
  const permissionId = f.broker.list()[0].id;
  await f.dispatch("user", "request-step-stop", { stopId: "permission-step" });
  assert.equal((await f.store.load()).activeTask.condition, "waiting-permission");
  assert.equal(f.broker.list()[0].id, permissionId);
  assert.equal(f.session.aborts, 0, "The prior Router result ended natively.");
  await f.broker.decide(permissionId, "once");
  assert.equal(await checking, "Checked");
  await f.finish(agent, "submit_readonly_answer", { kind: "answer", summary: "Check finished.",
    report: "The user-approved check ran before this step ended.", evidenceRefs: [] });
  const state = await f.store.load();
  assert.equal(state.executions.at(-1).binding.id, agent.binding.id);
  assert.equal(state.executions.at(-1).completion, "result-submission");
  assert.equal(state.stop.taskId, agent.binding.id);
  assert.equal(state.handoffs.at(-1).result.outcome.kind, "answer");
  assert.equal(state.uncertainty, null);
});

for (const winner of ["intent", "admission"]) test(`after-step ${winner} wins the atomic task admission boundary`, { timeout: 60_000 }, async (t) => {
  const selected = Promise.withResolvers(), release = Promise.withResolvers();
  const f = await fixture(t);
  await f.request();
  const verify = f.workspace.readSnapshot.bind(f.workspace);
  const mode = f.session.rpc.mode.get.bind(f.session.rpc.mode);
  let held = false;
  if (winner === "intent") t.mock.method(f.workspace, "readSnapshot", async (...args) => {
    await verify(...args);
    if (!held) { held = true; selected.resolve(); await release.promise; }
  });
  else t.mock.method(f.session.rpc.mode, "get", async () => {
    const value = await mode(), state = await f.store.load();
    if (!held && state.activeTask?.condition === "queued") { held = true; selected.resolve(); await release.promise; }
    return value;
  });
  const starting = f.begin("router").then((task) => ({ task }), (error) => ({ error }));
  try {
    await selected.promise;
    await f.dispatch("user", "request-step-stop", { stopId: "ordered-stop" });
    const pending = await f.store.load();
    assert.equal(pending.stop.mode, "after-step");
    assert.equal(Boolean(pending.stop.taskId), winner === "admission");
    if (winner === "intent") {
      await f.transport.inspectIdle(true);
      await f.dispatch("host", "confirm-stop", { stopId: "ordered-stop", snapshot: f.baseline });
    } else await assert.rejects(f.dispatch("host", "confirm-stop", { stopId: "ordered-stop", snapshot: f.baseline }), /actual native operation response/);
    release.resolve();
    const outcome = await starting;
    if (winner === "intent") {
      assert.equal(outcome.error?.code, "human-loop-stop");
      assert.equal(f.session.sends.length, 0);
    } else {
      assert.equal(outcome.error, undefined);
      assert.equal(f.session.aborts, 0);
      assert.equal(f.session.sends.filter(({ prompt }) => !prompt.startsWith("The user requested Stop")).length, 1);
      assert.equal(f.session.sends.filter(({ prompt }) => prompt.startsWith("The user requested Stop")).length, 0);
      await f.finish(outcome.task, "submit_human_route", { kind: "route", intent: "answer", cycleId: null,
        summary: "Only the admitted role finished.", resolvedQuestions: [] });
      await f.dispatch("host", "confirm-stop", { stopId: "ordered-stop", snapshot: f.baseline });
    }
    const frames = (await readFile(join(f.root, ".tandem", "living-canvas", "host-state", "journal.wal"), "utf8"))
      .trimEnd().split("\n").map((line) => JSON.parse(line.slice(9)));
    const admissions = frames.filter(({ cause }) => cause === "human-loop:start-role");
    assert.equal(admissions.length, winner === "admission" ? 1 : 0);
    for (const frame of admissions) {
      assert.equal(frame.updates.some(({ key }) => key === "ledger.json"), true);
      assert.equal(frame.updates.some(({ namespace }) => namespace.endsWith("/human-loop/tasks")), true,
        "Task artifact and role admission commit together.");
    }
    assert.equal((await f.store.load()).uncertainty, null);
  } finally { release.resolve(); await starting; }
});

test("duplicate completion and turn-end delivery and late old results cannot mutate the successor role", { timeout: 60_000 }, async (t) => {
  const f = await fixture(t);
  const emit = f.session.emit.bind(f.session), completions = [], turnEnds = [];
  t.mock.method(f.session, "emit", (type, data) => {
    emit(type, data);
    if (["tool.execution_complete", "assistant.turn_end"].includes(type)) {
      const event = structuredClone(f.session.history.at(-1));
      (type === "tool.execution_complete" ? completions : turnEnds).push(event);
      f.session.config.onEvent(structuredClone(event));
      f.session.config.onEvent(structuredClone(event));
    }
  });
  await f.request();
  const router = await f.begin("router");
  await f.finish(router, "submit_human_route", { kind: "route", intent: "answer", cycleId: null,
    summary: "Read-only request.", resolvedQuestions: [] });
  const agent = await f.begin("agent"), before = await f.store.load();
  f.session.config.onEvent(structuredClone(completions[0]));
  f.session.config.onEvent(structuredClone(turnEnds[0]));
  await f.transport.drain();
  const rejected = await f.session.config.hooks.onPreToolUse({
    sessionId: "private", toolName: "submit_readonly_answer", toolArgs: {
      schemaVersion: "human-role-result/v1", resultId: "late-old-input", inputDigest: router.binding.inputDigest,
      outcome: { kind: "answer", summary: "Old result.", report: "Must not be attributed to the new role.", evidenceRefs: [] },
    },
  }, { sessionId: "private" });
  assert.equal(rejected.permissionDecision, "deny");
  assert.match(rejected.permissionDecisionReason, /inputDigest/);
  assert.deepEqual(await f.store.load(), before);
  await f.finish(agent, "submit_readonly_answer", { kind: "answer", summary: "Current answer.",
    report: "The current role completed once.", evidenceRefs: [] });
  const handoff = (await f.store.load()).handoffs.at(-1);
  await f.dispatch("host", "present-handoff", { handoffId: handoff.id });
  const replayed = await replayDurableState(f.root);
  assert.deepEqual(replayed.state, await f.store.load());
  for (const task of [router, agent]) for (const type of ["complete-role-result", "apply-result"]) {
    assert.equal(replayed.ledger.events.filter(({ command }) => command.type === type
      && command.data.resultId === `result-${task.binding.id}`).length, 1, `${type} is durable exactly once for ${task.binding.id}`);
  }
  assert.equal(replayed.state.uncertainty, null);
  assert.equal(replayed.ledger.events.filter(({ command }) => command.type === "record-role-turn-end").length, 0);
  assert.equal(f.session.sends.length, 2);
  assert.equal(f.session.aborts, 0);
});

test("foreign native input preserves owned evidence and holds execution instead of adopting a completion", { timeout: 60_000 }, async (t) => {
  const f = await fixture(t);
  const recorded = Promise.withResolvers();
  const unsubscribe = f.store.subscribe((state) => { if (state.uncertainty) recorded.resolve(); });
  t.after(unsubscribe);
  await f.request();
  const task = await f.begin("router"), before = await f.store.load();
  f.session.emit("user.message", { content: "Foreign input.", messageId: "foreign-message",
    interactionId: "foreign-interaction", turnId: "0", delivery: "idle" });
  await assert.rejects(f.transport.drain(), /foreign|unidentified/i);
  await recorded.promise;
  const state = await f.store.load();
  assert.equal(state.activeTask.binding.id, task.binding.id);
  assert.equal(state.activeTask.messageId, before.activeTask.messageId);
  assert.equal(state.activeTask.result, null);
  assert.equal(state.activeTask.end, null);
  assert.ok(state.uncertainty);
  assert.deepEqual((await replayDurableState(f.root)).state, state);
  assert.equal(f.session.sends.length, 1);
  assert.equal(f.session.aborts, 0);
});

for (const mimeType of ["image/png", "image/jpeg"]) test(`general ${mimeType} reaches Router and downstream Agent byte-for-byte without a Design identity`, async t => {
  const f = await fixture(t);
  f.session.internImages = true;
  f.session.rpc.model = { getCurrent: async () => ({ modelId: "vision-fixture" }) };
  let mimeTypes = ["image/webp"], maxBytes = 4096;
  f.client.listModels = async () => [{ id: "vision-fixture", capabilities: { supports: { vision: true },
    limits: { vision: { supported_media_types: mimeTypes, max_prompt_images: 1, max_prompt_image_size: maxBytes } } } }];
  const bytes = mimeType === "image/png" ? Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=", "base64")
    : jpeg.encode({ width: 1, height: 1, data: Buffer.from([255, 0, 0, 255]) }, 80).data;
  const ref = await new ImageAttachmentStore(f.root).put(bytes, mimeType);
  const request = { id: "image-only", message: "", receivedAt: new Date().toISOString(), answers: null, attachments: [ref] };
  await assert.rejects(f.transport.requestAttachments([request], { revisionId: null, digest: null }), /support/);
  mimeTypes = [mimeType]; maxBytes = 1;
  await assert.rejects(f.transport.requestAttachments([request], { revisionId: null, digest: null }), /size/);
  maxBytes = 4096;
  assert.deepEqual(Buffer.from((await f.transport.requestAttachments([request], { revisionId: null, digest: null }))[0].data, "base64"), bytes);
  await f.dispatch("user", "receive-request", request);
  await f.dispatch("host", "admit-request", { requestId: request.id });
  const router = await f.begin("router", null, null, { request, requests: [request] });
  await f.finish(router, "submit_human_route", { kind: "route", intent: "answer", cycleId: null, summary: "Inspect image.", resolvedQuestions: [] });
  const agent = await f.begin("agent", null, null, { request, requests: [request] });
  for (const send of f.session.sends) {
    assert.deepEqual(Buffer.from(send.attachments[0].data, "base64"), bytes);
    assert.equal(send.attachments[0].mimeType, mimeType);
  }
  await f.finish(agent, "submit_readonly_answer", { kind: "answer", summary: "Image inspected.", report: "Image inspected.", evidenceRefs: [] });
});

test("bound cycle origin images reach a text-only Planner but never an unrelated Router", async t => {
  const f = await fixture(t);
  f.session.rpc.model = { getCurrent: async () => ({ modelId: "vision-fixture" }) };
  f.client.listModels = async () => [{ id: "vision-fixture", capabilities: { supports: { vision: true },
    limits: { vision: { supported_media_types: ["image/png"], max_prompt_images: 1, max_prompt_image_size: 4096 } } } }];
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=", "base64");
  const attachment = await new ImageAttachmentStore(f.root).put(bytes, "image/png");
  await f.request();
  const request = (await f.store.load()).requests[0];
  const originalRequests = [{ ...request, attachments: [attachment] }];
  const context = { request, requests: [request], originalRequests, cycle: { id: "cycle" } };
  const router = await f.begin("router", null, null, context);
  assert.equal(f.session.sends[0].attachments, undefined);
  await f.finish(router, "submit_human_route", { kind: "route", intent: "implement", cycleId: null, summary: "Implement request.", resolvedQuestions: [] });
  await f.dispatch("host", "start-cycle", { cycleId: "cycle", design, baseline: f.baseline });
  await f.begin("planner", "cycle", null, context);
  assert.deepEqual(Buffer.from(f.session.sends.at(-1).attachments[0].data, "base64"), bytes);
  await assert.rejects(f.transport.requestAttachments([{ attachments: [attachment, { ...attachment, id: "distinct-image" }] }], design), /image count/);
});

test("one-copy requests send the exact bound annotation blob only to a positively image-capable model", async (t) => {
  const f = await fixture(t);
  f.session.internImages = true;
  f.session.rpc.model = { getCurrent: async () => ({ modelId: "vision-fixture" }) };
  f.client.listModels = async () => [{ id: "vision-fixture", capabilities: { supports: { vision: true },
    limits: { vision: { supported_media_types: ["image/png"], max_prompt_images: 1, max_prompt_image_size: 4096 } } } }];
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=", "base64");
  const attachment = await new AnnotationAttachmentStore(f.root).put(png, { revisionId: "design", perspective: "gui",
    selectionId: null, viewport: { x: 0, y: 0, width: 1, height: 1, scale: 1 } });
  const request = { id: "image", message: "Explain this diagram.", receivedAt: new Date().toISOString(), answers: null, attachments: [attachment] };
  await f.dispatch("user", "receive-request", request);
  await f.dispatch("host", "admit-request", { requestId: request.id });
  const task = await f.begin("router", null, null, { request, requests: [request] });
  assert.equal(f.session.sends[0].attachments[0].type, "blob");
  assert.deepEqual(Buffer.from(f.session.sends[0].attachments[0].data, "base64"), png);
  await f.finish(task, "submit_human_route", { kind: "route", intent: "answer", cycleId: null, summary: "Read-only diagram question.", resolvedQuestions: [] });
});
