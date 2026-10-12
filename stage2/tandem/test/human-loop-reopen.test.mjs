import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, rm, rename } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { HumanLoopInstallation } from "../src/human-loop-installation.mjs";
import { HumanLoopRuntime } from "../src/human-loop-runtime.mjs";
import { HumanLoopPreferences } from "../src/human-loop-preferences.mjs";
import { validateNativeReopen } from "../src/human-loop-close.mjs";
import { HostStateFile } from "../runtime-src/domain/host-state-file.ts";
import { getHostStateWal } from "../runtime-src/domain/host-state-wal.ts";
import { NativeSession, git, waitFor } from "./helpers/native-session-fixture.mjs";
import { policyHash } from "../runtime-src/domain/workflow/policy.ts";
import { sharedDesign } from "./helpers/shared-design-fixture.mjs";
import { createHumanTask } from "../src/human-loop-task.mjs";
import { ImageAttachmentStore } from "../runtime-src/domain/workflow/image-attachment.ts";
import { projectHumanConversation } from "../src/human-loop-provider.mjs";

const content = sharedDesign();
const design = { binding: { revisionId: "design", digest: policyHash(content) }, content };
const hash = (value) => createHash("sha256").update(value).digest("hex");
const question = { id: "scope", context: "Product scope is not decided.", question: "Which scope?",
  whyItMatters: "Implementation depends on the choice.", importance: "blocking",
  options: [{ id: "small", label: "Small", implication: "Keep a small scope." },
    { id: "large", label: "Large", implication: "Discuss a larger scope." }], allowFreeform: true };

async function fixture(t, { ask = false, autoConfirm = true, stopDelivery = null, model = null, legacyNamespaces = false,
  reasoningEffort = null, deferred = false, failCreate = false, failStartup = false, empty = false } = {}) {
  const root = await mkdtemp(join(process.cwd(), ".human-reopen-")), workspace = join(root, "project");
  await mkdir(workspace); await git(workspace, "init", "--quiet");
  await writeFile(join(workspace, "original.txt"), "existing work\n");
  await git(workspace, "add", ".");
  await git(workspace, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "Fixture");
  const file = join(root, "installed.mjs");
  await writeFile(file, "installed fixture");
  const installed = { sdk: { modulePath: file, digest: hash("installed fixture") },
    cli: { path: file, digest: hash("installed fixture") }, node: { path: file, digest: hash("installed fixture") }, buildId: "fixture" };
  let runtime, native, saved = null, mode = "interactive", nativeMissing = false, failReset = false, currentDesign = design;
  if (empty) currentDesign = { binding: { revisionId: null, digest: null }, content: null };
  const counts = { creates: 0, resumes: 0, clients: 0, stops: 0, saves: 0, resets: 0, brokerResets: 0, sends: 0, compactions: 0, disconnects: 0 };
  let failDisconnect = false, failClientStop = false;
  let compactWork = async () => ({ success: true });
  let nativeDiagnostics = async () => ({ tasks: [] });
  let coldHistory = (events) => events;
  let resumeState = {};
  const errors = [], sessions = [];
  let actualModel = model ?? "one", actualEffort = reasoningEffort;
  class Session extends NativeSession {
    emit(type, data) {
      const event = { id: `event-${++this.count}`, type, data, parentId: this.events.at(-1)?.id ?? null, timestamp: new Date().toISOString() };
      if (type !== "assistant.idle") this.events.push(event);
      this.config.onEvent(event);
    }
    constructor(config) {
      super(); this.config = config; this.sessionId = config.sessionId;
      this.rpc.abort = async input => {
        assert.deepEqual(input, { reason: "remote_command" });
        await this.abort(); return { success: true };
      };
      this.rpc.interruptMainTurn = async input => {
        assert.deepEqual(input, { flushQueued: true });
        await this.abort(); return { interrupted: true };
      };
      this.rpc.permissions = { resetSessionApprovals: async () => { counts.resets++; return { success: !failReset }; } };
      this.queuedItems = [];
      this.rpc.queue.pendingItems = async () => ({ items: this.queuedItems, steeringMessages: [], inFlightSteeringCount: 0 });
      this.rpc.queue.clear = async () => { this.queuedItems = []; };
      this.rpc.tasks = { list: async () => nativeDiagnostics() };
      this.rpc.metadata.activity = async () => {
        if (failStartup) throw new Error("Startup activity observation failed.");
        return { hasActiveWork: false };
      };
      this.rpc.history = { compact: async (input) => {
        counts.compactions++;
        assert.equal(input.trigger, "manual");
        assert.match(input.customInstructions, /Historical requests.*not new instructions/);
        this.emit("session.compaction_start", { trigger: "manual" });
        const result = await compactWork();
        this.emit("session.compaction_complete", { success: result.success, trigger: "manual",
          ...(result.success ? {} : { error: "Fixture compaction failed." }) });
        return result;
      } };
      if (model) this.rpc.model = { getCurrent: async () => ({ modelId: actualModel, reasoningEffort: actualEffort }),
        setReasoningEffort: async ({ reasoningEffort }) => { actualEffort = reasoningEffort; return { reasoningEffort }; } };
    }
    async setModel(id) { actualModel = id; }
    async send(input) {
      counts.sends++;
      const id = await super.send(input);
      if (input.prompt.startsWith("The user requested Stop for this exact request and role.")) {
        assert.ok(stopDelivery);
        if (stopDelivery === "queued") { this.emit("assistant.idle", {}); this.interactionId = id; }
        this.emit("user.message", { content: input.prompt, messageId: id, interactionId: this.interactionId, turnId: "0", delivery: stopDelivery });
        if (stopDelivery === "queued") this.emit("assistant.turn_start", { interactionId: id, turnId: "0" });
        void (async () => {
          await waitFor(async () => (await runtime.state()).stop?.injection?.delivery, "exact Stop delivery");
          const stop = (await runtime.state()).stop;
          await this.call("acknowledge_human_stop", { stopId: stop.id, taskId: stop.taskId, inputDigest: stop.injection.inputDigest,
            summary: "Stopped before finishing the first request.", evidenceRefs: [] });
        })().catch((error) => { errors.push(error); this.emit("session.error", { message: error.message }); });
        return id;
      }
      this.start();
      this.interactionId = id;
      const packet = JSON.parse(input.prompt.split("\n").at(-1));
      if (stopDelivery && packet.binding.requestId === "first") return id;
      void (async () => {
        await waitFor(async () => (await runtime.state()).activeTask?.interactionId, "owned start");
        const role = packet.binding.role;
        const outcome = role === "router" ? { kind: "route", intent: ask ? "implement" : "answer", cycleId: null,
          summary: "Interpret the original request.", resolvedQuestions: [] }
          : role === "planner" ? { kind: "design-concern", reason: "A product choice is still needed.",
            summary: "No Design change; the product question remains.", questions: [question] }
            : { kind: "answer", summary: "Read-only response.", report: "The original project remains unchanged.", evidenceRefs: ["original.txt"] };
        const name = role === "router" ? "submit_human_route" : role === "planner" ? "raise_implementation_design_concern" : "submit_readonly_answer";
        await this.call(name, { schemaVersion: "human-role-result/v1", resultId: `result:${packet.binding.id}`,
          inputDigest: packet.binding.inputDigest, outcome });
      })().catch((error) => { errors.push(error); this.emit("session.error", { message: error.message }); });
      return id;
    }
    async call(name, args) {
      const value = await super.call(name, args);
      this.emit("tool.execution_complete", { toolCallId: `tool-${this.count}`, success: true, turnId: "0",
        interactionId: this.interactionId });
      if (this.config.tools.find(tool => tool.name === name)?.isTerminal) {
        this.emit("assistant.turn_end", { turnId: "0", interactionId: this.interactionId, aborted: false });
        this.processing = false;
        this.emit("assistant.idle", { aborted: false });
      }
      return value;
    }
    async abort() { this.processing = false; this.emit("assistant.idle", { aborted: true }); }
    async disconnect() {
      counts.disconnects++;
      if (failDisconnect) throw new Error("Native disconnect failed.");
      saved = { sessionId: this.sessionId, events: structuredClone(this.events), sends: structuredClone(this.sends), count: this.count };
    }
  }
  class Client {
    constructor() { counts.clients++; }
    async createSession(config) {
      counts.creates++;
      if (failCreate === true) throw new Error("Native creation failed before creating the session.");
      native = new Session(config); sessions.push(native);
      if (empty) nativeMissing = false;
      if (failCreate === "after-create") throw new Error("Native creation acknowledgement was lost after creation.");
      return native;
    }
    async start() {}
    async listModels() { return [{ id: "one", supportedReasoningEfforts: ["low", "high"] }, { id: "two", supportedReasoningEfforts: ["low", "high"] }]; }
    async getSessionMetadata(sessionId) { return nativeMissing || (!native && !saved) ? undefined : { sessionId, isRemote: false }; }
    async resumeSession(id, config) {
      counts.resumes++; assert.equal(config.continuePendingWork, false); assert.equal(id, saved.sessionId);
      native = new Session(config); native.events = structuredClone(saved.events);
      native.queuedItems = structuredClone(saved.queuedItems ?? []);
      if (resumeState.processing) native.processing = true;
      if (resumeState.activity) native.rpc.metadata.activity = async () => ({ hasActiveWork: true });
      if (resumeState.sessionId) native.sessionId = resumeState.sessionId;
      if (resumeState.queue) native.queuedItems = structuredClone(resumeState.queue);
      native.sends = structuredClone(saved.sends); native.count = saved.count; sessions.push(native);
      // Native resume metadata appears in active history but may not persist.
      if (!config.suppressResumeEvent) native.emit("session.resume", { eventCount: native.events.length });
      return native;
    }
    rpc = { sessions: {
      ...(empty ? { checkInUse: async () => ({ inUse: [] }),
        getSizes: async () => ({ sizes: nativeMissing || !saved ? {} : { [saved.sessionId]: 100 } }) } : {}),
      readPersistedEvents: async () => {
      if (nativeMissing || !saved) throw new Error("Retained native history is unavailable.");
      return { events: coldHistory(structuredClone(saved.events)), cursor: "complete", cursorStatus: "ok", hasMore: false };
    }, save: async () => {
      counts.saves++; saved = { sessionId: native.sessionId, events: structuredClone(native.events.filter(event => event.type !== "session.resume")),
        sends: structuredClone(native.sends), count: native.count };
    } } };
    async stop() { counts.stops++; return failClientStop ? [new Error("Native client release failed.")] : []; }
  }
  const main = { sessionId: "main", rpc: { mode: { get: async () => mode },
    metadata: { isProcessing: async () => ({ processing: false }), activity: async () => ({ hasActiveWork: false }) },
    queue: { pendingItems: async () => ({ items: [], steeringMessages: [] }) } } };
  const options = {
    workspacePath: workspace, mainSession: main, runtimeRoot: join(root, "runtime"),
    registration: { session: main, id: "receipt", toolHook() {}, permissionHandler() {} },
    discoverRuntime: async () => installed,
    loadSdk: async () => ({ CopilotClient: Client, RuntimeConnection: { forStdio: () => ({ kind: "stdio" }) } }),
    resetPermissions: () => { counts.brokerResets++; },
    createRuntime: async (input) => new HumanLoopRuntime({ ...input, readDesign: async () => currentDesign, onHandoff: async () => {},
      onProgress: async event => {
        if (!autoConfirm || event.kind !== "implementation-confirmation") return;
        try {
          const confirmation = (await runtime.state()).implementationConfirmations.findLast(c => c.status === "pending");
          await runtime.decideImplementation({ confirmationId: confirmation.id, decision: "approved" });
        } catch (error) { errors.push(error); }
      },
    }),
  };
  if (legacyNamespaces) await mkdir(join(workspace, ".teleos"));
  let installation = new HumanLoopInstallation(options);
  if (model) await new HumanLoopPreferences(workspace).update({ model, reasoningEffort, theme: "dark" });
  if (!deferred) runtime = await installation.open();
  const send = async (id, answers = null) => {
    await runtime.send({ id, message: `Exact request ${id}.`, receivedAt: new Date().toISOString(), answers });
    const result = await runtime.whenIdle();
    assert.equal(errors.length, 0, errors.map((e) => e.stack).join("\n"));
    return result;
  };
  t.after(async () => {
    if ((await installation.read()).status === "ready") await installation.close();
    await getHostStateWal(workspace).close(); await rm(root, { recursive: true, force: true });
  });
  return { workspace, options, counts, sessions, send, errors,
    setDesign: value => { currentDesign = value; },
    setAsk: value => { ask = value; },
    setCompaction: (work) => { compactWork = work; },
    setNativeDiagnostics: (work) => { nativeDiagnostics = work; },
    setColdHistory: (transform) => { coldHistory = transform; },
    setResumeState: value => { resumeState = value; },
    setActualModel: (id) => { actualModel = id; },
    setActualEffort: value => { actualEffort = value; },
    setCreateFailure: value => { failCreate = value; },
    setStartupFailure: value => { failStartup = value; },
    setDisconnectFailure: value => { failDisconnect = value; },
    setClientStopFailure: value => { failClientStop = value; },
    get installation() { return installation; }, get runtime() { return runtime; },
    record: () => new HostStateFile(workspace, join(workspace, ".tandem", "living-canvas", "human-loop", "installation.json")),
    setMode: (value) => { mode = value; }, missing: () => { nativeMissing = true; }, failReset: () => { failReset = true; },
    mutateHistory: (action) => action(saved.events),
    async interrupt(events = [], queuedItems = []) {
      saved = { sessionId: native.sessionId, events: [...structuredClone(native.events), ...events],
        sends: structuredClone(native.sends), count: native.count + events.length, queuedItems };
      // This same-process fixture must retire memory ownership that a real process crash destroys.
      (runtime ?? installation.runtime).commands.releaseWriter();
      await getHostStateWal(workspace).close();
    },
    async reopen(cold = false, retry = false) {
      if (cold) installation = new HumanLoopInstallation(options);
      runtime = await installation.open({ retry }); return runtime;
    },
  };
}

async function emptyCreatedFixture(t) {
  const f = await fixture(t, { empty: true, model: "one", reasoningEffort: "low" });
  await f.installation.close();
  f.missing();
  await assert.rejects(f.reopen(true), /private session is unavailable/);
  return f;
}

test("verified empty-created repair is same-ID, one-use and preserves all original audit without a request", async t => {
  const f = await emptyCreatedFixture(t);
  const file = f.record(), wal = getHostStateWal(f.workspace);
  const before = await wal.history(file.namespace, file.key);
  const owner = structuredClone(f.installation.configuration.owner);
  const inspect = await f.installation.requestEmptySetupRepair();
  assert.equal(inspect.privateSessionId, owner.privateSessionId);
  assert.match(inspect.message, /not restore nonexistent history/);
  assert.deepEqual(await f.installation.decideEmptySetupRepair({ confirmationId: inspect.confirmationId, approve: false }), { repaired: false });
  assert.deepEqual(await wal.history(file.namespace, file.key), before, "Inspection and cancellation append no installation mutation.");
  const next = await f.installation.requestEmptySetupRepair();
  const decisions = await Promise.allSettled([
    f.installation.decideEmptySetupRepair({ confirmationId: next.confirmationId, approve: true }),
    f.installation.decideEmptySetupRepair({ confirmationId: next.confirmationId, approve: true }),
  ]);
  assert.equal(decisions.filter(value => value.status === "fulfilled").length, 1);
  const runtime = f.installation.runtime, record = JSON.parse(await file.read());
  assert.deepEqual(f.installation.configuration.owner, owner);
  assert.equal(record.nativeCreation.authorization.repair.kind, "verified-empty-created");
  assert.equal(record.nativeCreation.authorization.id, next.confirmationId);
  assert.equal(f.counts.creates, 2); assert.equal(f.counts.resumes, 0); assert.equal(f.counts.sends, 0);
  assert.equal((await runtime.state()).requests.length, 0);
  assert.equal((await runtime.state()).design.revisionId, null);
  assert.match((await runtime.conversation()).at(-1).content, /reinitialized.*No native history was restored/);
  assert.deepEqual((await wal.history(file.namespace, file.key)).slice(0, before.length), before);
  assert.deepEqual(await f.installation.decideEmptySetupRepair({ confirmationId: next.confirmationId, approve: true }), { repaired: true, duplicate: true });
  assert.equal(f.counts.creates, 2);
});

test("empty repair keeps text admission blocked until actual private model readback succeeds", async t => {
  const f = await emptyCreatedFixture(t);
  f.setActualModel(null);
  const proposal = await f.installation.requestEmptySetupRepair();
  await f.installation.decideEmptySetupRepair({ confirmationId: proposal.confirmationId, approve: true });
  const runtime = f.installation.runtime;
  assert.equal((await runtime.readiness()).modelBlocked, true);
  await assert.rejects(runtime.send({ id: "must-not-send", message: "Do not admit while model is unverified.",
    receivedAt: new Date().toISOString() }), /model|SDK/);
  assert.equal((await runtime.state()).requests.length, 0);
  await runtime.changeModel({ model: "one", reasoningEffort: "low" });
  assert.equal((await runtime.readiness()).modelBlocked, false);
  assert.equal((await runtime.modelSettings()).actualReasoningEffort, "low");
  assert.equal(f.counts.sends, 0);
});

test("empty repair rejects changed handoff proof and authoritative absence API failures", async t => {
  const f = await emptyCreatedFixture(t);
  let admission = "prepared";
  f.options.inspectRepairAdmissions = async () => ({ admission });
  const proposal = await f.installation.requestEmptySetupRepair();
  admission = "changed-proof";
  await assert.rejects(f.installation.decideEmptySetupRepair({ confirmationId: proposal.confirmationId, approve: true }), /evidence changed/);
  assert.equal(f.counts.creates, 1);
  const sdk = await f.options.loadSdk();
  f.options.loadSdk = async () => ({ ...sdk, CopilotClient: class extends sdk.CopilotClient {
    constructor(...args) { super(...args); this.rpc.sessions.getSizes = async () => { throw new Error("Native inventory unavailable"); }; }
  } });
  await assert.rejects(f.installation.requestEmptySetupRepair(), /Native inventory unavailable/);
  assert.equal(f.counts.creates, 1);
});

test("empty repair refuses native conversation or unknown retained Design instead of deleting it", async t => {
  const f = await emptyCreatedFixture(t);
  const store = f.installation.runtime.store;
  await store.recordMessage({ id: "native:foreign", role: "assistant", kind: "assistant", requestId: null,
    content: "Retained native content", timestamp: new Date().toISOString() });
  await assert.rejects(f.installation.requestEmptySetupRepair(), /conversation/);
  assert.equal((await store.messages()).some(message => message.id === "native:foreign"), true);
  assert.equal(f.counts.creates, 1);
});

test("created-session repair never replaces a used request", async t => {
  const f = await fixture(t, { empty: true });
  await f.send("used");
  await f.installation.close(); f.missing();
  await assert.rejects(f.reopen(true), /private session is unavailable/);
  await assert.rejects(f.installation.requestEmptySetupRepair(), /used setup/);
  assert.equal(f.counts.creates, 1);
});

for (const change of ["design", "owner", "live-native", "extra-state"]) test(`empty repair blocks ${change} evidence`, async t => {
  const f = await emptyCreatedFixture(t);
  if (change === "design") {
    const file = new HostStateFile(f.workspace, join(f.workspace, ".tandem", "living-canvas", "design", "document.json"));
    await file.mutate("fixture-design", () => ({ content: JSON.stringify(design), result: null }));
  } else if (change === "owner") f.options.mainSession.sessionId = "different-main";
  else if (change === "live-native") {
    const sdk = await f.options.loadSdk();
    f.options.loadSdk = async () => ({ ...sdk, CopilotClient: class extends sdk.CopilotClient {
      constructor(...args) { super(...args); this.rpc.sessions.checkInUse = async () => ({ inUse: [f.installation.configuration.owner.privateSessionId] }); }
    } });
  } else {
    const file = new HostStateFile(f.workspace, join(f.workspace, ".tandem", "living-canvas", "unknown-state.json"));
    await file.mutate("fixture-extra", () => ({ content: "{}", result: null }));
  }
  await assert.rejects(f.installation.requestEmptySetupRepair(), /Design|unknown state|main session|owner|active|unverified/i);
  assert.equal(f.counts.creates, 1); assert.equal(f.counts.sends, 0);
});

test("failure after repair creation consumes its decision and preserves uncertainty", async t => {
  const f = await emptyCreatedFixture(t);
  const proposal = await f.installation.requestEmptySetupRepair();
  f.setCreateFailure("after-create");
  await assert.rejects(f.installation.decideEmptySetupRepair({ confirmationId: proposal.confirmationId, approve: true }), /acknowledgement was lost/);
  const record = JSON.parse(await f.record().read());
  assert.equal(record.nativeCreation.status, "requested");
  assert.equal(record.nativeCreation.authorization.id, proposal.confirmationId);
  assert.equal((await f.installation.read()).status, "unknown");
  await assert.rejects(f.installation.decideEmptySetupRepair({ confirmationId: proposal.confirmationId, approve: true }), /stale or consumed/);
  assert.equal(f.counts.creates, 2); assert.equal(f.counts.sends, 0);
});

for (const changed of [false, true]) test(`reopen retains a pending human confirmation without dispatch and replaces stale Design approval: changed=${changed}`, async t => {
  const f = await fixture(t, { ask: true, autoConfirm: false });
  assert.equal((await f.send("proposal")).status, "waiting-confirmation");
  const original = (await f.runtime.state()).implementationConfirmations[0], sends = f.counts.sends;
  await f.installation.close();
  if (changed) f.setDesign({ ...design, binding: { ...design.binding, revisionId: "changed-design" } });
  await f.reopen(true);
  f.runtime.wake();
  assert.equal((await f.runtime.whenIdle()).status, "waiting-confirmation");
  const current = (await f.runtime.state()).implementationConfirmations.at(-1);
  assert.equal(f.counts.sends, sends, "Reopen and replacement of a pending card send no native turn.");
  if (changed) {
    assert.notEqual(current.id, original.id);
    assert.equal(current.design.revisionId, "changed-design");
    assert.equal((await f.runtime.state()).implementationConfirmations[0].status, "invalidated");
    await assert.rejects(f.runtime.decideImplementation({ confirmationId: original.id, decision: "approved" }), /invalidated/);
  } else assert.equal(current.id, original.id);
  await f.runtime.decideImplementation({ confirmationId: current.id, decision: "cancelled" });
  assert.equal((await f.runtime.whenIdle()).status, "ready");
  assert.equal(f.counts.sends, sends);
  assert.equal((await f.runtime.state()).requests[0].status, "cancelled");
});

function assertRecovered(current, previous) {
  const { revision: _oldRevision, applied: _oldApplied, recoveries: oldRecoveries = [], ...oldState } = previous;
  const { revision, applied, recoveries, ...state } = current;
  assert.deepEqual(state, oldState);
  assert.equal(revision, previous.revision + 1);
  assert.equal(applied.length, previous.applied.length + 1);
  assert.equal(recoveries.length, oldRecoveries.length + 1);
}

test("an issued native creation with a lost outcome cannot use the create-missing retry path", async t => {
  const f = await fixture(t, { deferred: true, failCreate: true });
  await assert.rejects(f.reopen(), /before creating/);
  const owner = structuredClone(f.installation.configuration.owner);
  assert.equal((await f.installation.read()).canRetry, true);
  await assert.rejects(f.reopen(), /explicit Retry/);
  f.setCreateFailure(false);
  await assert.rejects(f.reopen(false, true), /session is unavailable/);
  assert.deepEqual(f.installation.configuration.owner, owner);
  assert.equal(f.counts.creates, 1);
  assert.equal(f.counts.resumes, 0);
  assert.equal(f.counts.sends, 0);
  assert.equal((await f.installation.read()).status, "unknown");
  await assert.rejects(f.installation.requestInitialCreationRecovery(), /legacy incomplete/);
});

test("cold retry of an issued creation resumes an existing exact native identity without a second create", async t => {
  const f = await fixture(t, { deferred: true, failCreate: "after-create" });
  await assert.rejects(f.reopen(), /acknowledgement was lost/);
  const owner = structuredClone(f.installation.configuration.owner);
  assert.equal(JSON.parse(await f.record().read()).nativeCreation.status, "requested");
  await f.interrupt();
  f.setCreateFailure(false);
  await f.reopen(true, true);
  assert.deepEqual(f.installation.configuration.owner, owner);
  assert.equal((await f.installation.read()).status, "ready");
  assert.equal(JSON.parse(await f.record().read()).nativeCreation.status, "created");
  assert.equal(f.counts.creates, 1);
  assert.equal(f.counts.resumes, 1);
  assert.equal(f.counts.sends, 0);
});

test("post-create startup retry refuses current native work and resumes the same session after it settles", async t => {
  const f = await fixture(t, { deferred: true, failStartup: true });
  await assert.rejects(f.reopen(), /activity observation/);
  const owner = structuredClone(f.installation.configuration.owner), native = f.sessions[0];
  f.setStartupFailure(false);
  native.processing = true;
  await assert.rejects(f.reopen(false, true), /current native work/);
  native.processing = false;
  f.setNativeDiagnostics(async () => ({ tasks: [{ id: "actual-current-task", type: "shell", status: "running" }] }));
  await assert.rejects(f.reopen(false, true), /current native work/);
  assert.equal(f.counts.stops, 0);
  assert.equal(f.counts.disconnects, 0);
  f.setNativeDiagnostics(async () => ({ tasks: [] }));
  await f.reopen(false, true);
  assert.deepEqual(f.installation.configuration.owner, owner);
  assert.equal(f.counts.creates, 1);
  assert.equal(f.counts.resumes, 1);
  assert.equal(f.counts.sends, 0);
});

test("failed-start disconnect and client-release errors stay actionable and retry cleanup without another writer", async t => {
  const f = await fixture(t, { deferred: true, failStartup: true });
  await assert.rejects(f.reopen(), /activity observation/);
  f.setStartupFailure(false);
  f.setDisconnectFailure(true);
  await assert.rejects(f.reopen(false, true), /disconnect failed/);
  assert.equal(f.counts.stops, 0);
  f.setDisconnectFailure(false); f.setClientStopFailure(true);
  await assert.rejects(f.reopen(false, true), /release was not confirmed/);
  const disconnects = f.counts.disconnects;
  assert.equal(f.counts.clients, 1);
  assert.equal((await f.installation.read()).canRetry, true);
  f.setClientStopFailure(false);
  await f.reopen(false, true);
  assert.equal(f.counts.disconnects, disconnects, "Do not detach an already detached native session again.");
  assert.equal(f.counts.clients, 2);
  assert.equal(f.counts.creates, 1);
  assert.equal(f.counts.resumes, 1);
  assert.equal(f.counts.sends, 0);
});

test("failed recovery retry preserves used history and ignores historical Running labels for release", async t => {
  const f = await fixture(t);
  await f.send("used-history");
  const admission = await f.runtime.commands.admit("powershell", { command: "node old.mjs", mode: "async", shellId: "historical" },
    { binding: { id: "historical-role", role: "agent", requestId: "used-history", cycleId: null } }, "historical-call");
  await f.runtime.commands.settled(admission, { timestamp: new Date().toISOString(),
    data: { success: true, result: { contents: [] } } }, true);
  const messages = await f.runtime.conversation(), design = await f.runtime.currentDesign();
  const owner = structuredClone(f.installation.configuration.owner), sends = f.counts.sends;
  await f.interrupt();
  f.setStartupFailure(true);
  await assert.rejects(f.reopen(true), /activity observation/);
  f.setStartupFailure(false);
  await f.reopen(false, true);
  assert.deepEqual(f.installation.configuration.owner, owner);
  assert.deepEqual(await f.runtime.currentDesign(), design);
  const current = await f.runtime.conversation();
  for (const message of messages) assert.deepEqual(current.find(entry => entry.id === message.id), message);
  assert.equal(f.counts.creates, 1);
  assert.equal(f.counts.resumes, 2);
  assert.equal(f.counts.sends, sends);
  const old = (await f.runtime.commands.read()).nativeSessions.find(entry => entry.shellId === "historical");
  assert.equal(old.recordedStatus, "running");
  assert.equal(old.canStop, false);
  assert.ok(old.controlRetirement);
});

for (const samePath of [false, true]) test(`compatible selected runtime ${samePath ? "byte update" : "path update"} retains provenance and same-session recovery`, async t => {
  const f = await fixture(t);
  await f.send("before-upgrade");
  await f.installation.close();
  const original = JSON.parse(await f.record().read());
  const path = samePath ? original.configuration.sdk.modulePath : join(f.workspace, "..", "selected-upgrade.mjs");
  await writeFile(path, "compatible updated fixture");
  if (!samePath) await rm(original.configuration.sdk.modulePath);
  f.options.discoverRuntime = async () => ({
    sdk: { modulePath: path, digest: hash("compatible updated fixture") },
    cli: { path, digest: hash("compatible updated fixture") },
    node: { path, digest: hash("compatible updated fixture") }, buildId: "compatible-upgrade",
  });
  f.setStartupFailure(true);
  await assert.rejects(f.reopen(true), /activity observation/);
  const attempted = JSON.parse(await f.record().read());
  assert.deepEqual(attempted.runtimeHistory, [original.configuration]);
  assert.deepEqual(attempted.closeProof, original.closeProof, "Do not rebind or rewrite an old close receipt.");
  f.setStartupFailure(false);
  await f.reopen(false, true);
  assert.deepEqual(f.installation.configuration.owner, original.configuration.owner);
  assert.equal(f.installation.configuration.buildId, "compatible-upgrade");
  assert.equal(f.counts.creates, 1);
  assert.equal(f.counts.sends, 2);
  assert.deepEqual(JSON.parse(await f.record().read()).runtimeHistory, [original.configuration]);
});

test("private create and same-ID resume retain repository discovery but opt out of recursive extensions", async t => {
  const f = await fixture(t, { model: "one" });
  const owner = structuredClone(f.installation.configuration.owner);
  const assertPrivate = session => {
    assert.equal(session.config.requestExtensions, false);
    assert.deepEqual(session.config.toolSearch, { enabled: false });
    assert.equal(session.config.enableConfigDiscovery, true);
    assert.equal(session.config.workingDirectory, f.workspace);
    assert.equal(typeof session.config.hooks.onPreToolUse, "function");
    assert.equal(typeof session.config.onPermissionRequest, "function");
  };
  assertPrivate(f.sessions.at(-1));
  await f.send("before-private-reopen");
  const before = await f.runtime.conversation(), sends = f.counts.sends;
  await f.installation.close(); await f.reopen(true);
  assert.deepEqual(f.installation.configuration.owner, owner);
  assert.equal(f.counts.creates, 1); assert.equal(f.counts.resumes, 1);
  assert.equal(f.counts.sends, sends, "Reopen must not replay old work.");
  assert.deepEqual(await f.runtime.conversation(), before);
  assertPrivate(f.sessions.at(-1));
  assert.equal((await f.send("after-private-reopen")).status, "ready");
  assert.equal(f.counts.sends, sends + 2, "The first explicit post-reopen request starts Router then Agent.");
  assert.deepEqual(f.errors, []);
});

test("busy main does not gate private admission while private mode and activity still do", async t => {
  const f = await fixture(t, { model: "one" });
  f.options.mainSession.rpc = new Proxy({}, { get: () => assert.fail("Do not inspect main readiness for private work.") });
  const native = f.sessions.at(-1);
  await f.send("independent-main");
  assert.equal((await f.runtime.modelSettings()).canChange, true);
  native.processing = true;
  assert.equal((await f.runtime.modelSettings()).canChange, false);
  await assert.rejects(f.runtime.changeModel({ model: "two" }), /quiescent/);
  native.processing = false;
  const getMode = native.rpc.mode.get;
  native.rpc.mode.get = async () => "autopilot";
  assert.equal((await f.runtime.modelSettings()).canChange, false);
  await assert.rejects(f.runtime.changeModel({ model: "two" }), /mode\/activity/);
  native.rpc.mode.get = getMode;
  await f.runtime.changeModel({ acceptActual: true });
  await f.send("still-independent");
});

for (const blockedQueue of [false, true]) test(`idle Settings preserve an unanswered question and unfinished cycle${blockedQueue ? " with blocked ordinary requests" : ""} without sending or completing work`, async t => {
  const f = await fixture(t, { ask: true, model: "one" });
  assert.equal((await f.send("still-needs-decision")).status, "waiting-answer");
  if (blockedQueue) {
    await f.send("blocked-first");
    await f.send("blocked-second");
    assert.deepEqual((await f.runtime.executionQueue()).map(request => request.id), ["blocked-first", "blocked-second"]);
  }
  const state = await f.runtime.state(), messages = await f.runtime.conversation(), design = await f.runtime.currentDesign();
  const ledger = new HostStateFile(f.workspace, join(f.workspace, ".tandem", "living-canvas", "human-loop", "ledger.json"));
  const originalLedger = await ledger.read();
  const sends = f.counts.sends, sessionId = f.runtime.sessionId;
  assert.ok(state.questions.some(question => question.state === "open" && question.blockingActive));
  assert.ok(state.cycles.some(cycle => !["completed", "stopped", "failed", "retired"].includes(cycle.phase)));
  assert.equal((await f.runtime.modelSettings()).canChange, true);
  await f.runtime.changeModel({ model: "two" });
  const pending = new HumanLoopPreferences(f.workspace);
  await pending.update({ pendingModel: "one" });
  assert.equal((await f.runtime.readiness()).compaction.canRequest, true);
  const approval = await f.runtime.requestCompaction();
  assert.deepEqual(await f.runtime.decideCompaction({ ...approval, approve: true }), { compacted: true });
  assert.equal((await f.runtime.readiness()).canResetApprovals, true);
  await f.runtime.resetRememberedApprovals(id => { assert.equal(id, sessionId); });
  assert.equal((await pending.read()).pendingModel, "one", "Other Settings actions must not clear model intent.");
  assert.deepEqual(await f.runtime.state(), state);
  assert.deepEqual(await f.runtime.conversation(), messages);
  assert.deepEqual(await f.runtime.currentDesign(), design);
  assert.equal(await ledger.read(), originalLedger, "Settings must not rewrite or advance the retained queue and questions.");
  assert.equal(f.counts.sends, sends);
  assert.equal(f.runtime.sessionId, sessionId);
  assert.equal((await f.runtime.readiness()).status, "waiting-answer");
  await f.runtime.changeModel({ acceptActual: true });
});

for (const blockedBy of ["dispatchable-request", "queued-answer", "native-processing", "native-queue", "native-activity"]) {
  test(`idle Settings still reject ${blockedBy} without native effects`, async t => {
    const f = await fixture(t, { ask: blockedBy !== "dispatchable-request", model: "one" });
    if (blockedBy !== "dispatchable-request") {
      await f.send("question");
      await f.send("blocked-request");
    }
    const approval = await f.runtime.requestCompaction(), native = f.sessions.at(-1);
    const activity = native.rpc.metadata.activity;
    if (blockedBy === "dispatchable-request" || blockedBy === "queued-answer") {
      const source = (await f.runtime.state()).questions[0];
      await f.runtime.store.dispatch("user", `receive:${blockedBy}`, "receive-request", {
        id: blockedBy, message: "Keep this exact waiting request.", receivedAt: new Date().toISOString(),
        answers: blockedBy === "queued-answer" ? { schemaVersion: "human-question-answers/v1", answers: [{
          questionId: source.id, sourceResultId: source.source.resultId, kind: "option", value: "small",
        }] } : null,
      });
    } else if (blockedBy === "native-processing") native.processing = true;
    else if (blockedBy === "native-queue") native.queuedItems = [{ id: "native-pending", messageId: "pending-message", kind: "message" }];
    else native.rpc.metadata.activity = async () => ({ hasActiveWork: true });
    const state = await f.runtime.state(), sends = f.counts.sends;
    const busyReason = /idle private runtime|quiescent|mode\/activity|Runtime queue contains unowned work/;
    try {
      assert.equal((await f.runtime.modelSettings()).canChange, false);
      await assert.rejects(f.runtime.changeModel({ model: "two" }), busyReason);
      await assert.rejects(f.runtime.requestCompaction(), busyReason);
      await assert.rejects(f.runtime.decideCompaction({ ...approval, approve: true }),
        ["dispatchable-request", "queued-answer"].includes(blockedBy) ? /changed since/ : busyReason);
      await assert.rejects(f.runtime.resetRememberedApprovals(() => assert.fail("No broker reset while busy.")),
        busyReason);
      assert.equal((await new HumanLoopPreferences(f.workspace).read()).pendingModel, null);
      assert.equal((await f.runtime.modelSettings()).actual, "one");
      assert.equal(f.counts.compactions, 0);
      assert.equal(f.counts.resets, 0);
      assert.equal(f.counts.sends, sends);
      assert.deepEqual(await f.runtime.state(), state);
    } finally {
      native.processing = false; native.queuedItems = []; native.rpc.metadata.activity = activity;
    }
  });
}

for (const operation of ["model", "compaction", "reset"]) {
  test(`blocked-queue ${operation} preserves admission ordering when a question answer arrives`, async t => {
    const f = await fixture(t, { ask: true, model: "one" });
    await f.send("question");
    await f.send("blocked-request");
    const state = await f.runtime.state(), source = state.questions[0], sends = f.counts.sends;
    const answer = { id: "new-answer", message: "Use the small scope.", receivedAt: new Date().toISOString(),
      answers: { schemaVersion: "human-question-answers/v1", answers: [{
        questionId: source.id, sourceResultId: source.source.resultId, kind: "option", value: "small",
      }] } };
    const native = f.sessions.at(-1), entered = Promise.withResolvers(), release = Promise.withResolvers();
    let work, pendingAnswer;
    if (operation === "model") {
      const setModel = native.setModel.bind(native);
      native.setModel = async id => { entered.resolve(); await release.promise; await setModel(id); };
      work = f.runtime.changeModel({ model: "two" });
    } else if (operation === "compaction") {
      f.setCompaction(async () => { entered.resolve(); await release.promise; return { success: true }; });
      const approval = await f.runtime.requestCompaction();
      work = f.runtime.decideCompaction({ ...approval, approve: true });
    } else {
      const reset = native.rpc.permissions.resetSessionApprovals;
      native.rpc.permissions.resetSessionApprovals = async args => { entered.resolve(); await release.promise; return reset(args); };
      work = f.runtime.resetRememberedApprovals(() => {});
    }
    try {
      await entered.promise;
      if (operation === "reset") {
        f.setAsk(false);
        pendingAnswer = f.runtime.send(answer);
      } else await assert.rejects(f.runtime.send(answer), /model change|compaction.*progress/);
      f.runtime.wake();
      await f.runtime.whenIdle();
      assert.deepEqual(await f.runtime.state(), state);
      assert.equal(f.counts.sends, sends);
    } finally { release.resolve(); }
    await work;
    if (pendingAnswer) {
      await pendingAnswer; await f.runtime.whenIdle();
      assert.equal((await f.runtime.state()).questions[0].answerRequestId, answer.id);
      const first = JSON.parse(native.sends[sends].prompt.split("\n").at(-1));
      assert.equal(first.binding.requestId, answer.id, "Only after reset does the explicit answer enter the normal queue.");
    } else {
      assert.deepEqual(await f.runtime.state(), state);
      assert.equal(f.counts.sends, sends);
    }
  });
}

for (const stopFirst of [false, true]) test(`unanswered source remains answerable as new work after ${stopFirst ? "Stop and " : ""}verified Close/reopen`,
  { timeout: 60_000 }, async t => {
    const f = await fixture(t, { ask: true });
    assert.equal((await f.send("original-question")).status, "waiting-answer");
    const original = (await f.runtime.state()).questions[0], sends = f.counts.sends;
    if (stopFirst) { await f.runtime.stop("release-question"); await f.runtime.whenIdle(); }
    await f.installation.close(); await f.reopen(true);
    assert.equal(f.counts.sends, sends, "Reopening must not dispatch retired work.");
    const pending = (await f.runtime.state()).questions[0];
    assert.equal(pending.state, "open"); assert.equal(pending.blockingActive, false);
    f.setAsk(false);
    assert.equal((await f.send("later-answer", { schemaVersion: "human-question-answers/v1", answers: [{
      questionId: original.id, sourceResultId: original.source.resultId, kind: "option", value: "small",
    }] })).status, "ready");
    const state = await f.runtime.state(), saved = state.questions[0];
    assert.equal(saved.state, "answered"); assert.equal(saved.answerRequestId, "later-answer");
    assert.equal(f.counts.sends, sends + 2, "Only the new Router and Agent requests executed.");
    const packet = JSON.parse(f.sessions.at(-1).sends.at(-2).prompt.split("\n").at(-1));
    assert.equal(packet.binding.requestId, "later-answer");
    assert.equal(packet.context.questionAnswers[0].question.question, original.question);
    assert.equal(packet.context.questionAnswers[0].originalRequests[0].id, "original-question");
    assert.equal(packet.context.questionAnswers[0].answer.selectedOption.label, "Small");
    assert.ok(state.cycles.every(cycle => ["retired", "stopped"].includes(cycle.phase)));
  });

test("cold runtime accepts an exact legacy option-envelope retry without rewriting its audit", { timeout: 60_000 }, async t => {
  const f = await fixture(t, { ask: true });
  await f.send("original-question");
  const source = (await f.runtime.state()).questions[0];
  f.setAsk(false);
  const original = { id: "legacy-answer", message: "  Exact original answer.\n", receivedAt: "2026-09-23T10:00:00Z",
    answers: { schemaVersion: "human-question-answers/v1", answers: [{
      questionId: source.id, sourceResultId: source.source.resultId, kind: "option", value: "small",
    }] } };
  await f.runtime.send(original); await f.runtime.whenIdle();
  const ledger = new HostStateFile(f.workspace, join(f.workspace, ".tandem", "living-canvas", "human-loop", "ledger.json"));
  const conversation = new HostStateFile(f.workspace, join(f.workspace, ".tandem", "living-canvas", "human-loop", "conversation.json"));
  // Seed the valid historical wire representation, not a new model result or rewritten live record.
  await ledger.mutate("fixture-legacy-envelope", content => {
    const saved = JSON.parse(content);
    saved.events.find(({ command }) => command.id === "receive:legacy-answer").command.data = structuredClone(original);
    return { content: JSON.stringify(saved), result: null };
  });
  const historicalEvents = JSON.parse(await ledger.read()).events;
  await f.installation.close(); await f.reopen(true);
  const before = await ledger.read(), messages = await conversation.read(), sends = f.counts.sends;
  const state = await f.runtime.state();
  assert.equal(state.requests.find(({ id }) => id === original.id).answers.answers[0].selectedOption.label, "Small");
  const event = JSON.parse(before).events.find(({ command }) => command.id === "receive:legacy-answer");
  assert.deepEqual(event.command.data, original);
  assert.deepEqual(JSON.parse(before).events.slice(0, historicalEvents.length), historicalEvents);
  await f.runtime.send(original); await f.runtime.whenIdle();
  assert.equal(await ledger.read(), before);
  assert.equal(await conversation.read(), messages);
  assert.equal(f.counts.sends, sends, "A completed original request is not replayed.");
  assert.equal((await f.runtime.state()).requests.filter(({ id }) => id === original.id).length, 1);
  const enriched = structuredClone(original);
  enriched.answers.answers[0].selectedOption = { label: "Small", implication: "Keep a small scope." };
  await f.runtime.send(enriched); await f.runtime.whenIdle();
  for (const altered of [
    { ...original, message: "Changed text." },
    { ...original, receivedAt: "2026-09-23T10:00:01Z" },
    { ...original, answers: { ...original.answers, answers: [{ ...original.answers.answers[0], value: "large" }] } },
    { ...enriched, answers: { ...enriched.answers, answers: [{ ...enriched.answers.answers[0],
      selectedOption: { label: "Forged wording", implication: "Not the canonical choice." } }] } },
  ]) await assert.rejects(f.runtime.send(altered), /Conflicting retry|differs from the canonical/);
  assert.equal(await ledger.read(), before);
  assert.equal(await conversation.read(), messages);
  assert.equal(f.counts.sends, sends);
});

test("installation fixture recovery retires historical async control, preserves history, admits fresh work and clean reopens", { timeout: 90_000 }, async t => {
  const f = await fixture(t);
  await f.send("first");
  const sessionId = f.sessions.at(-1).sessionId;
  const admission = await f.runtime.commands.admit("powershell",
    { command: "node server.mjs", shellId: "previous-app", mode: "async" },
    { binding: { id: "old-agent", role: "agent", requestId: "first", cycleId: null } }, "prior-background");
  await f.runtime.commands.settled(admission, { timestamp: new Date().toISOString(),
    data: { success: true, result: { contents: [] } } }, true);
  const conversation = await f.runtime.conversation(), sends = f.counts.sends;
  await f.interrupt();
  await f.reopen(true);
  assert.equal((await f.runtime.readiness()).status, "ready");
  assert.equal(f.counts.sends, sends, "Recovery must not replay any workflow request.");
  assert.deepEqual(await f.runtime.conversation(), conversation);
  assert.equal(f.sessions.at(-1).config.continuePendingWork, false);
  assert.deepEqual(f.sessions.at(-1).queuedItems, []);
  const old = (await f.runtime.commands.read()).nativeSessions[0];
  assert.equal(old.canStop, false); assert.equal(old.status, "held"); assert.equal(old.recordedStatus, "running");
  assert.equal(old.exitCode, null); assert.equal(old.endedAt, null);
  assert.equal(old.controlRetirement.evidence.sessionId, f.sessions.at(-1).sessionId);
  assert.equal(sessionId, f.sessions.at(-1).sessionId);
  await f.send("fresh-instruction");
  await f.installation.close();
  await f.reopen(true);
  assert.deepEqual((await f.runtime.commands.read()).nativeSessions[0].controlRetirement, old.controlRetirement);
});

for (const invalid of ["current-background", "new-queued-input"]) {
  test(`installation recovery stays unknown for ${invalid}, without replay or process adoption`, { timeout: 60_000 }, async t => {
    const f = await fixture(t);
    await f.send("first");
    await f.runtime.commands.admit("powershell", { command: "node server.mjs", shellId: "old-app", mode: "async" },
      { binding: { id: "old-agent", role: "agent", requestId: "first", cycleId: null } }, "old-background");
    await f.interrupt();
    const sends = f.counts.sends;
    f.setNativeDiagnostics(async () => {
      if (invalid === "new-queued-input") {
        f.sessions.at(-1).queuedItems = [{ id: "new-input", kind: "message", messageId: "foreign" }];
        return { tasks: [] };
      }
      return { tasks: [{ id: "running-background", type: "shell", status: "running",
        command: "node current.mjs", attachmentMode: "attached", executionMode: "background",
        startedAt: new Date().toISOString() }] };
    });
    await assert.rejects(f.reopen(true), /active work|evidence/);
    assert.equal((await f.installation.read()).status, "unknown");
    assert.equal(f.counts.sends, sends);
    assert.equal(f.counts.creates, 1, "Recovery cannot replace the private session.");
  });
}

for (const diagnostic of ["failed", "timed-out"]) {
  test(`installation recovery accepts fresh instructions with ${diagnostic} historical task diagnostics`, { timeout: 60_000 }, async t => {
    const f = await fixture(t);
    await f.send("first");
    const sessionId = f.sessions.at(-1).sessionId, sends = f.counts.sends;
    await f.runtime.commands.admit("powershell", { command: "node prior.mjs", shellId: "old-sync" },
      { binding: { id: "old-agent", role: "agent", requestId: "first", cycleId: null } }, "old-sync-call");
    await f.interrupt();
    f.setNativeDiagnostics(() => {
      if (diagnostic === "failed") throw new Error("Historical native task diagnostics unavailable.");
      return new Promise(() => {});
    });
    await f.reopen(true);
    assert.equal((await f.installation.read()).status, "ready");
    assert.equal(f.sessions.at(-1).sessionId, sessionId);
    assert.equal(f.counts.sends, sends);
    const old = (await f.runtime.commands.read()).nativeSessions[0];
    assert.equal(old.controlRetirement.evidence.taskDiagnostics.state, "unavailable");
    assert.equal(old.controlRetirement.evidence.tasks, null);
    assert.equal(old.recordedStatus, "starting"); assert.equal(old.exitCode, null); assert.equal(old.endedAt, null);
    assert.equal(old.canStop, false);
    await f.send("new-instruction");
  });
}

test("repeated quiet close and cold reopen never seals nonpersisted resume metadata", { timeout: 90_000 }, async (t) => {
  const f = await fixture(t);
  await f.send("first");
  const sends = f.counts.sends, messages = await f.runtime.conversation();
  for (let cycle = 0; cycle < 3; cycle++) {
    await f.installation.close();
    await f.reopen(true);
    assert.equal(f.sessions.at(-1).config.suppressResumeEvent, true);
    assert.equal(f.sessions.at(-1).config.continuePendingWork, false);
    assert.deepEqual(await f.runtime.conversation(), messages);
    assert.equal(f.counts.sends, sends);
  }
  assert.equal(f.counts.creates, 1);
  assert.equal(f.counts.resumes, 3);
});

test("restart preserves Conversation without treating Close as an asset-history certificate", { timeout: 60_000 }, async (t) => {
  const f = await fixture(t);
  await f.send("first");
  const conversation = await f.runtime.conversation();
  f.sessions.at(-1).emit("session.binary_asset", {
    assetId: `sha256:${hash("image")}`, type: "image", mimeType: "image/png", byteLength: 5,
    data: Buffer.from("image").toString("base64"),
  });
  await f.installation.close();
  f.setColdHistory((events) => events.filter(({ type }) => type !== "session.binary_asset"));
  const sends = f.counts.sends;
  await f.reopen(true);
  assert.equal((await f.runtime.readiness()).status, "ready");
  assert.equal(f.counts.sends, sends);
  await f.installation.close();
  f.mutateHistory((events) => {
    events.find(({ type }) => type === "session.binary_asset").data.data = Buffer.from("other").toString("base64");
  });
  await f.reopen(true);
  assert.equal((await f.runtime.readiness()).status, "ready");
  assert.deepEqual(await f.runtime.conversation(), conversation);
  assert.equal(f.counts.sends, sends);
});

test("failed Close-intent persistence cannot prevent shutdown or break the final same-ID receipt", async t => {
  const f = await fixture(t);
  await f.send("first");
  const original = HostStateFile.prototype.mutate;
  let failed = false;
  t.mock.method(HostStateFile.prototype, "mutate", function (cause, ...args) {
    if (cause === "human-loop-installation:closing" && !failed) {
      failed = true;
      throw new Error("Close intent could not be saved");
    }
    return original.call(this, cause, ...args);
  });
  const result = await f.installation.close();
  assert.equal(result.status, "closed");
  assert.match(result.warnings.join("\n"), /Close intent could not be saved/);
  const stored = JSON.parse(await f.record().read());
  assert.equal(stored.closeId, stored.closeProof.id);
  assert.equal(stored.closeProof.native.closed, true);
  assert.equal(stored.closeProof.schemaVersion, "human-loop-close/v2");
  const sends = f.counts.sends;
  await f.reopen(true);
  assert.equal((await f.runtime.readiness()).status, "ready");
  assert.equal(f.counts.sends, sends);
});

test("a pre-recovery failure cannot revive a legacy ready record's superseded close proof", { timeout: 60_000 }, async (t) => {
  const f = await fixture(t);
  await f.send("first");
  await f.installation.close();
  const closed = JSON.parse(await f.record().read());
  await f.reopen(true);
  await f.send("second");
  await f.record().mutate("legacy-ready-proof", (content) => ({ content: JSON.stringify({
    ...JSON.parse(content), closeId: closed.closeId, closeProof: closed.closeProof,
  }), result: null }));
  await f.interrupt();
  const discover = f.options.discoverRuntime;
  f.options.discoverRuntime = async () => { throw new Error("Transient discovery failure"); };
  await assert.rejects(f.reopen(true), /Transient discovery failure/);
  const failed = JSON.parse(await f.record().read());
  assert.equal(failed.phase, "unknown");
  assert.equal(failed.closeProof, null);
  assert.equal(failed.closeId, null);
  f.options.discoverRuntime = discover;
  const sends = f.counts.sends;
  await getHostStateWal(f.workspace).close();
  await f.reopen(true, true);
  assert.equal((await f.runtime.readiness()).status, "ready");
  assert.equal(f.counts.sends, sends);
  assert.equal((await f.runtime.state()).requests.length, 2);
});

test("native journal writer binding fails before recovery Ready and never dispatches old or new work", { timeout: 60_000 }, async t => {
  const f = await fixture(t);
  await f.send("completed");
  const directory = join(f.installation.configuration.runtimeDirectory, "native-shells");
  await f.interrupt();
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, ".writer-lock"), JSON.stringify({
    schemaVersion: "workflow-foundation-lock/v1", token: "b".repeat(36), pid: process.pid,
  }));
  const sends = f.counts.sends, resumes = f.counts.resumes;
  await assert.rejects(f.reopen(true), /ownership or retained lock changed/);
  assert.equal(f.counts.resumes, resumes + 1);
  assert.equal(f.counts.sends, sends);
  assert.notEqual((await f.installation.read()).status, "ready");
});

test("each explicit compaction requires fresh approval, preserves history and allows new work", { timeout: 60_000 }, async (t) => {
  const f = await fixture(t); await f.send("first");
  const before = await f.runtime.state(), messages = await f.runtime.conversation();
  await assert.rejects(f.runtime.decideCompaction({ requestId: "not-approved", approve: true }), /fresh explicit/);
  const rejected = await f.runtime.requestCompaction();
  assert.deepEqual(await f.runtime.decideCompaction({ ...rejected, approve: false }), { compacted: false });
  assert.equal(f.counts.compactions, 0);
  const gate = Promise.withResolvers();
  f.setCompaction(() => gate.promise);
  const approval = await f.runtime.requestCompaction();
  assert.equal(f.counts.compactions, 0);
  const work = f.runtime.decideCompaction({ ...approval, approve: true });
  await waitFor(() => f.runtime.transport.compaction.active, "native compaction start");
  assert.equal((await f.runtime.readiness()).compaction.requested, true);
  await assert.rejects(f.runtime.send({}), /compaction.*progress/);
  await assert.rejects(f.runtime.decideCompaction({ ...approval, approve: true }), /fresh explicit/);
  gate.resolve({ success: true });
  assert.deepEqual(await work, { compacted: true });
  assert.equal((await f.runtime.readiness()).compaction.active, false);
  assert.equal((await f.runtime.readiness()).compaction.requested, false);
  assert.deepEqual(await f.runtime.conversation(), messages);
  assert.deepEqual(await f.runtime.state(), before);
  assert.equal(f.counts.compactions, 1);
  assert.equal((await f.send("after-compaction")).status, "ready");
  const stale = await f.runtime.requestCompaction();
  await f.send("changed-before-approval");
  await assert.rejects(f.runtime.decideCompaction({ ...stale, approve: true }), /changed since/);
  assert.equal(f.counts.compactions, 1);
});

test("native automatic compaction visibility does not replace ongoing workflow state", { timeout: 60_000 }, async (t) => {
  const f = await fixture(t, { stopDelivery: "steering" });
  await f.runtime.send({ id: "first", message: "Start work.", receivedAt: new Date().toISOString(), answers: null });
  await waitFor(async () => (await f.runtime.state()).activeTask?.interactionId, "running Router");
  const before = await f.runtime.state(), native = f.sessions.at(-1);
  native.emit("session.compaction_start", { trigger: "threshold" });
  assert.equal((await f.runtime.readiness()).status, "working");
  assert.equal((await f.runtime.readiness()).compaction.active, true);
  assert.deepEqual(await f.runtime.state(), before);
  native.emit("session.compaction_complete", { success: false, error: "Native compaction unavailable." });
  assert.equal((await f.runtime.readiness()).status, "working");
  assert.equal((await f.runtime.readiness()).compaction.active, false);
  assert.match((await f.runtime.readiness()).compaction.error, /unavailable/);
  assert.deepEqual(await f.runtime.state(), before);
  await f.runtime.stop("cleanup-stop", "immediate");
  await f.runtime.whenIdle();
});

for (const legacyNamespaces of [false, true]) test(`interrupted recovery retains exact Conversation, images, results and current files without any old send (legacy upgrade: ${legacyNamespaces})`, { timeout: 60_000 }, async (t) => {
  const f = await fixture(t, { legacyNamespaces });
  await f.send("completed");
  const store = f.runtime.store, before = await f.runtime.state();
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=", "base64");
  const attachment = await new ImageAttachmentStore(f.workspace).put(png, "image/png");
  const request = { id: "interrupted", message: "  Exact retained image request.\n", receivedAt: new Date().toISOString(),
    answers: null, attachments: [attachment] };
  await store.dispatch("user", "receive-interrupted", "receive-request", request);
  await store.dispatch("host", "admit-interrupted", "admit-request", { requestId: request.id });
  const packet = createHumanTask({ id: "interrupted-role", dispatchId: "interrupted-dispatch", sessionId: f.runtime.sessionId,
    requestId: request.id, cycleId: null, role: "router", internalTaskId: null,
    before: before.executions.at(-1).binding.before, design: before.design }, { request });
  await store.admitTask(packet);
  await store.dispatch("runtime", "interrupted-ack", "role-acknowledged",
    { taskId: packet.binding.id, dispatchId: packet.binding.dispatchId, messageId: "interrupted-message" });
  await store.dispatch("runtime", "interrupted-start", "role-started",
    { taskId: packet.binding.id, messageId: "interrupted-message", interactionId: "interrupted-interaction" });
  await store.dispatch("user", "receive-old-queue", "receive-request",
    { id: "old-queue", message: "Keep this exact queued text.", receivedAt: new Date().toISOString(), answers: null });
  await store.dispatch("host", "old-uncertainty", "execution-unknown",
    { reason: "Historical outcome remains unconfirmed.", evidenceRef: "retained-fixture" });
  const retained = await f.runtime.conversation(), interrupted = await store.load(), sends = f.counts.sends;
  const timestamp = new Date().toISOString();
  await f.interrupt([
    { id: "interrupted-user", type: "user.message", timestamp, parentId: null,
      data: { content: JSON.stringify(packet), messageId: "interrupted-message", turnId: "0", interactionId: "interrupted-interaction" } },
    { id: "unobserved-tail", type: "assistant.message", timestamp, parentId: "interrupted-user", data: { content: "Exact retained partial response." } },
  ]);
  if (legacyNamespaces) {
    await rm(join(f.workspace, ".tandem", "product-migration.json"));
    await rename(join(f.workspace, ".tandem"), join(f.workspace, ".teleos"));
    await writeFile(join(f.workspace, "TELEOS.md"), "Unchanged historical index mentioning .teleos.\n");
  }
  await writeFile(join(f.workspace, "original.txt"), "Current externally edited file; do not restore.\n");
  await f.reopen(true);
  f.runtime.wake(); await f.runtime.whenIdle();
  const recovered = await f.runtime.state(), messages = await f.runtime.conversation();
  assert.equal(f.counts.sends, sends);
  assert.equal(f.counts.creates, 1);
  assert.equal((await f.runtime.readiness()).status, "ready");
  assert.deepEqual(recovered.executions, [...interrupted.executions, interrupted.activeTask]);
  assert.deepEqual(recovered.requests.slice(-2).map(({ status }) => status), ["retired", "retired"]);
  assert.deepEqual(messages.slice(0, retained.length), retained);
  assert.equal(messages.at(-1).content, "Exact retained partial response.");
  assert.equal(messages.at(-1).requestId, request.id);
  assert.deepEqual(await new ImageAttachmentStore(f.workspace).read(attachment), png);
  const visible = projectHumanConversation(recovered, messages);
  assert.deepEqual(visible.find(({ requestId }) => requestId === request.id).attachments, [attachment]);
  assert.equal(recovered.recoveries[0].taskId, packet.binding.id);
  assert.deepEqual(recovered.recoveries[0].uncertainty, interrupted.uncertainty);
  assert.equal(recovered.uncertainty, null);
  assert.equal(await readFile(join(f.workspace, "original.txt"), "utf8"), "Current externally edited file; do not restore.\n");
  if (legacyNamespaces) assert.equal(await readFile(join(f.workspace, "TANDEM.md"), "utf8"),
    "Unchanged historical index mentioning .teleos.\n");
  assert.equal((await f.send("new-work")).status, "ready");
  assert.equal(f.counts.sends, sends + 2);
});

test("persisted model preferences allow original automatic creation and same-session matching or mismatched reopen", { timeout: 90_000 }, async (t) => {
  const f = await fixture(t, { model: "two" });
  assert.equal(f.sessions[0].config.model, "two");
  await f.send("first");
  const identity = f.runtime.sessionId, messages = await f.runtime.conversation();
  await f.installation.close(); await f.reopen(true);
  assert.equal(f.runtime.sessionId, identity);
  assert.equal((await f.runtime.modelSettings()).actual, "two");
  assert.deepEqual(await f.runtime.conversation(), messages);
  await f.installation.close(); f.setActualModel("one"); await f.reopen(true);
  assert.equal(f.counts.creates, 1); assert.equal(f.runtime.sessionId, identity);
  assert.match((await f.runtime.modelSettings()).error, /differs/);
  await assert.rejects(f.runtime.send({}), /differs/);
  await f.runtime.changeModel({ acceptActual: true });
  assert.equal((await new HumanLoopPreferences(f.workspace).read()).model, "one");
  assert.deepEqual(await f.runtime.conversation(), messages);
});

test("explicit effort survives cold reopen without overwriting native history or replaying work", async t => {
  const f = await fixture(t, { model: "one", reasoningEffort: "low" });
  assert.equal(f.sessions[0].config.reasoningEffort, "low");
  await f.send("first");
  const identity = f.runtime.sessionId, sends = f.counts.sends, messages = await f.runtime.conversation();
  await f.installation.close(); await f.reopen(true);
  assert.equal(f.runtime.sessionId, identity);
  assert.equal(f.counts.sends, sends);
  assert.equal((await f.runtime.modelSettings()).actualReasoningEffort, "low");
  assert.equal(Object.hasOwn(f.sessions.at(-1).config, "reasoningEffort"), false);
  await f.installation.close(); f.setActualEffort("high"); await f.reopen(true);
  await assert.rejects(f.runtime.send({}), /reasoning effort differs/);
  assert.equal(f.counts.creates, 1);
  await f.runtime.changeModel({ model: "one", reasoningEffort: "low" });
  assert.equal((await f.runtime.modelSettings()).actualReasoningEffort, "low");
  assert.deepEqual(await f.runtime.conversation(), messages);
  const preferences = new HumanLoopPreferences(f.workspace);
  await preferences.update({ pendingModel: "one", pendingReasoningEffort: "high" });
  await f.installation.close(); await f.reopen(true);
  await assert.rejects(f.runtime.send({}), /unconfirmed/);
  assert.equal((await preferences.read()).pendingReasoningEffort, "high");
  assert.equal(f.counts.sends, sends);
  await f.runtime.changeModel({ acceptActual: true });
  assert.equal((await preferences.read()).reasoningEffort, "low");
  assert.equal((await preferences.read()).pendingReasoningEffort, null);
});

test("same-ID reopen retains an actual immediate Stop without reinjection", { timeout: 90_000 }, async (t) => {
  const f = await fixture(t, { stopDelivery: "steering" });
  await f.runtime.send({ id: "first", message: "Start a read-only explanation.", receivedAt: new Date().toISOString(), answers: null });
  await waitFor(async () => (await f.runtime.state()).activeTask?.interactionId, "running Router");
  await f.runtime.stop("stop-first", "immediate");
  assert.equal((await f.runtime.whenIdle()).status, "ready");
  const state = await f.runtime.state(), sends = f.counts.sends;
  assert.equal(state.requests[0].status, "stopped");
  assert.equal(state.stops[0].nativeResult.interrupted, true);
  assert.equal(state.stops[0].injection, undefined);
  await f.installation.close();
  const closedState = await f.runtime.state();
  await f.reopen(true);
  assertRecovered(await f.runtime.state(), closedState);
  assert.equal(f.counts.sends, sends);
  assert.equal((await f.send("second")).status, "ready");
  assert.equal(f.counts.sends, sends + 2);
  assert.equal(f.errors.length, 0);
});

test("used new-model warm and cold reopen preserve owner, exact history and completed tasks without replay", { timeout: 90_000 }, async (t) => {
  const f = await fixture(t);
  assert.equal((await f.send("first")).status, "ready");
  const state = await f.runtime.state(), messages = await f.runtime.conversation(), owner = f.installation.configuration.owner;
  const closeEntered = Promise.withResolvers(), continueClose = Promise.withResolvers();
  f.options.beforeClose = async () => { closeEntered.resolve(); await continueClose.promise; };
  const closing = f.installation.close(), concurrent = f.installation.close();
  await closeEntered.promise;
  await assert.rejects(f.runtime.send({ id: "during-close", message: "Not admitted.", receivedAt: new Date().toISOString(), answers: null }), /not available/);
  await assert.rejects(f.runtime.stop("during-close"), /closing/);
  continueClose.resolve(); await Promise.all([closing, concurrent]); delete f.options.beforeClose;
  const closedState = await f.runtime.state();
  assert.equal(f.counts.stops, 1);
  assert.equal(getHostStateWal(f.workspace).writerId, null);
  assert.equal((await f.installation.read()).canReopen, true);
  await f.runtime.conversation(); await f.runtime.commands.read(); await f.runtime.state();
  assert.equal(getHostStateWal(f.workspace).writerId, null, "Closed views must not reacquire the WAL.");
  const oldSession = f.sessions[0], before = f.counts.sends;
  await f.reopen();
  assert.equal(f.counts.sends, before);
  assertRecovered(await f.runtime.state(), closedState); assert.deepEqual(await f.runtime.conversation(), messages);
  assert.deepEqual(f.installation.configuration.owner, owner);
  oldSession.emit("user.message", { content: "late released callback" });
  assertRecovered(await f.runtime.state(), closedState);
  assert.equal((await f.send("second")).status, "ready");
  await f.installation.close();
  const second = await f.runtime.state();
  await f.reopen(true);
  assertRecovered(await f.runtime.state(), second);
  assert.equal(f.counts.creates, 1); assert.equal(f.counts.resumes, 2); assert.equal(f.counts.resets, 2);
  assert.equal(f.counts.sends, 4);
  assert.equal((await f.send("third")).status, "ready");
});

test("cold recovery retains old questions and backlog as history, but Ready admits only new instructions", { timeout: 60_000 }, async (t) => {
  const f = await fixture(t, { ask: true });
  assert.equal((await f.send("question")).status, "waiting-answer");
  assert.equal((await f.send("ordinary")).status, "waiting-answer");
  const state = await f.runtime.state(), messages = await f.runtime.conversation(), sends = f.counts.sends;
  assert.equal(state.requests[1].status, "waiting");
  await f.installation.close(); await f.reopen(true);
  f.runtime.wake(); await f.runtime.whenIdle();
  const recovered = await f.runtime.state();
  assert.equal(Object.hasOwn(recovered, "awaitedQuestionResultId"), false);
  assert.equal(recovered.requests[1].status, "retired");
  assert.equal(recovered.cycles[0].phase, "retired");
  assert.equal(recovered.questions[0].state, "open");
  assert.equal(recovered.questions[0].blockingActive, false);
  assert.equal(recovered.questions[0].question, state.questions[0].question);
  const historical = projectHumanConversation(recovered, await f.runtime.conversation())
    .flatMap((entry) => entry.questionHistory ?? []);
  assert.equal(historical[0].question, state.questions[0].question);
  assert.deepEqual(historical[0].options, state.questions[0].options);
  assert.deepEqual(recovered.executions, state.executions);
  assert.deepEqual(await f.runtime.conversation(), messages);
  assert.equal(f.counts.sends, sends);
  assert.equal((await f.runtime.readiness()).status, "ready");
});

test("clean reopen permits ordinary project edits but never adopts another main owner", { timeout: 60_000 }, async (t) => {
  const f = await fixture(t); await f.send("first"); await f.installation.close();
  const clients = f.counts.clients;
  await writeFile(join(f.workspace, "original.txt"), "outside edit\n");
  await f.reopen(true);
  assert.equal(f.counts.clients, clients + 1); assert.equal(f.counts.resumes, 1);
  assert.equal((await f.send("after-edit")).status, "ready");
  await f.installation.close();
  const main = { ...f.options.mainSession, sessionId: "different-main" };
  const other = new HumanLoopInstallation({ ...f.options, mainSession: main, registration: { ...f.options.registration, session: main } });
  await assert.rejects(other.open(), /another main session/);
  assert.equal(f.counts.clients, clients + 1);
});

for (const failure of ["missing-native", "permission-reset"]) test(`restart fails visibly for ${failure} without create fallback or replay`, { timeout: 60_000 }, async (t) => {
  const f = await fixture(t); await f.send("first"); await f.installation.close();
  if (failure === "missing-native") f.missing();
  if (failure === "permission-reset") f.failReset();
  await assert.rejects(f.reopen(true), /unavailable|reset|Unowned|changed/);
  assert.equal((await f.installation.read()).status, "unknown");
  assert.equal(f.counts.creates, 1); assert.equal(f.counts.sends, 2);
  await assert.rejects(f.installation.open(), /explicit Retry/);
  await assert.rejects(f.reopen(true), /unavailable|reset|Unowned|changed/);
  assert.equal(f.counts.creates, 1); assert.equal(f.counts.sends, 2);
});

for (const difference of ["changed-history", "foreign-history", "missing-admission", "conversation-conflict", "unavailable-history"]) {
  test(`restart Ready does not certify ${difference} and preserves original Conversation and Design`, { timeout: 60_000 }, async t => {
    const f = await fixture(t); await f.send("original");
    let response;
    if (difference === "conversation-conflict") {
      const session = f.sessions.at(-1);
      session.emit("assistant.message", { content: "Exact stored original response.", messageId: "response" });
      response = session.events.at(-1);
      await f.runtime.store.recordMessage({ id: `native:${response.id}`, requestId: "original", role: "agent",
        kind: "assistant", content: response.data.content, timestamp: response.timestamp });
    }
    await f.installation.close();
    const before = await f.runtime.state(), messages = await f.runtime.conversation(), owner = f.installation.configuration.owner;
    const sends = f.counts.sends, code = await readFile(join(f.workspace, "original.txt"), "utf8");
    if (difference === "changed-history") f.mutateHistory(events => { events.find(event => event.type === "tool.execution_complete").data.success = false; });
    if (difference === "foreign-history") f.mutateHistory(events => events.push({ id: "historical-foreign", type: "assistant.message",
      timestamp: new Date().toISOString(), parentId: null, data: { content: "Unattributed historical response." } }));
    if (difference === "missing-admission") f.mutateHistory(events => events.push({ id: "historical-unadmitted", type: "user.message",
      timestamp: new Date().toISOString(), parentId: null, data: { content: "Old unmatched input.", isAutopilotContinuation: true } }));
    if (difference === "conversation-conflict") f.mutateHistory(events => { events.find(event => event.id === response.id).data.content = "Changed native projection."; });
    if (difference === "unavailable-history") f.setColdHistory(() => { throw new Error("Fixture historical RPC unavailable."); });
    await f.reopen(true);
    const recovered = await f.runtime.state(), retained = await f.runtime.conversation();
    assert.equal((await f.runtime.readiness()).status, "ready");
    assert.deepEqual(f.installation.configuration.owner, owner);
    assert.equal(f.runtime.sessionId, owner.privateSessionId);
    assert.equal(f.counts.sends, sends); assert.equal(f.counts.creates, 1);
    assert.deepEqual(recovered.design, before.design); assert.deepEqual(recovered.executions, before.executions);
    assert.deepEqual(retained.slice(0, messages.length), messages);
    assert.equal(recovered.uncertainty, null, "Recovery is not conditional on history-equivalence certification.");
    if (response) assert.equal(retained.find(message => message.id === `native:${response.id}`).content, response.data.content);
    assert.equal(await readFile(join(f.workspace, "original.txt"), "utf8"), code);
    assert.equal((await f.send("new-instructions")).status, "ready");
    assert.equal(f.counts.sends, sends + 2);
    if (difference === "unavailable-history") f.setColdHistory(events => events);
  });
}

for (const current of ["processing", "activity", "queue", "foreign-session"]) {
  test(`restart refuses current ${current} without clearing native work or replacing the session`, { timeout: 60_000 }, async t => {
    const f = await fixture(t); await f.send("original"); await f.installation.close();
    const before = await f.runtime.state(), sends = f.counts.sends;
    const queued = [{ id: "current-queued-input", message: "Current native work must not be discarded." }];
    f.setResumeState(current === "processing" ? { processing: true } : current === "activity" ? { activity: true }
      : current === "queue" ? { queue: queued } : { sessionId: "foreign-private" });
    await assert.rejects(f.reopen(true), /quiescent|queue|owned|session/i);
    assert.equal((await f.installation.read()).status, "unknown");
    assert.equal(f.counts.sends, sends); assert.equal(f.counts.creates, 1);
    assert.equal((await f.runtime.state()).recoveries?.length ?? 0, before.recoveries?.length ?? 0);
    if (current === "queue") assert.deepEqual(f.sessions.at(-1).queuedItems, queued);
  });
}

test("native close fingerprint rejects missing, modified and reordered execution rather than inventing completion", async () => {
  const { nativeCloseEvents } = await import("../src/human-loop-close.mjs");
  const events = [
    { id: "u", type: "user.message", timestamp: "2026-09-15T00:00:00Z", data: { content: "exact" } },
    { id: "a", type: "assistant.message", timestamp: "2026-09-15T00:00:01Z", data: { content: "answer" } },
  ];
  const proof = { schemaVersion: "human-loop-native-close/v1", sessionId: "private", flushed: true,
    events: nativeCloseEvents(events),
    users: [{ id: "u", messageId: "message", turnId: "0", interactionId: "interaction" }] };
  assert.equal(validateNativeReopen(events, proof), true);
  assert.equal(validateNativeReopen(events.slice(0, 1), proof), false);
  assert.throws(() => validateNativeReopen([...events].reverse(), proof), /order/);
  assert.throws(() => validateNativeReopen([{ ...events[0], data: { content: "changed" } }, events[1]], proof), /changed/);
  assert.throws(() => validateNativeReopen([{ ...events[0], parentId: "foreign" }, events[1]], proof), /changed/);
  const system = { id: "system", type: "system.message", parentId: "u", timestamp: "2026-09-15T00:00:01Z", data: { content: "Rebuilt instructions" } };
  const original = [events[0], system, { ...events[1], parentId: "system" }];
  const relinked = [events[0], { ...events[1], parentId: "u" }];
  assert.equal(validateNativeReopen(relinked, { ...proof, events: nativeCloseEvents(original) }), true);
});
