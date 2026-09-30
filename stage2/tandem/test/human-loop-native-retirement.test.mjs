import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { HumanLoopNativeShells } from "../src/human-loop-native-shells.mjs";
import { captureNativeControlEvidence } from "../src/human-loop-native-recovery.mjs";
import { HostStateFile } from "../runtime-src/domain/host-state-file.ts";
import { closeHostStateWal } from "../runtime-src/domain/host-state-wal.ts";
import { DEFAULT_POLICY } from "../runtime-src/domain/workflow/policy.ts";
import { decodeRecord, encodeRecord } from "../runtime-src/domain/workflow/foundation-storage.ts";

const recovery = { id: "explicit-recovery", nativeEvidenceDigest: "a".repeat(64) };
const evidence = () => ({
  schemaVersion: "native-control-evidence/v1", sessionId: "private", historyDigest: recovery.nativeEvidenceDigest,
  observedAt: new Date().toISOString(), registryScope: "current-runtime-not-process-exit-proof",
  mode: "interactive", processing: false, hasActiveWork: false,
  queue: { items: 0, steeringMessages: 0, inFlightSteeringCount: 0 }, tasks: [],
  taskDiagnostics: { state: "observed", reason: null },
});
const packet = { binding: { id: "old-task", role: "agent", requestId: "request", cycleId: "cycle" } };
const args = { command: "node server.mjs", shellId: "old-handle", mode: "async" };
const complete = (contents = []) => ({ type: "tool.execution_complete", timestamp: new Date().toISOString(),
  data: { success: true, result: { contents } } });
const notification = shellId => ({ type: "system.notification", timestamp: new Date().toISOString(),
  data: { kind: { type: "shell_completed", shellId, exitCode: 0 } } });
async function fixture(t) {
  const root = resolve(`.native-retirement-${randomUUID()}`), runtimeDirectory = join(root, ".tandem", "runtime");
  await mkdir(root, { recursive: true });
  const owner = { schemaVersion: "human-loop-owner/v1", id: "owner", mainSessionId: "main",
    privateSessionId: "private", workspacePath: root, policy: DEFAULT_POLICY };
  const options = { owner, runtimeDirectory,
    workspace: { protectedIndexDigest: async () => "b".repeat(64), inspectNativePath: async () => {} },
    legacy: { read: async () => ({ apps: [], commands: [] }), evidenceForCycle: async () => [],
      cleanCloseDigest: async () => "c".repeat(64), close: async () => {} } };
  const instances = [];
  const create = () => { const value = new HumanLoopNativeShells(options); instances.push(value); return value; };
  const document = new HostStateFile(root, join(runtimeDirectory, "native-shells", "sessions.json"));
  t.after(async () => { instances.forEach(value => value.releaseWriter()); await closeHostStateWal(root);
    await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); });
  return { root, create, document, first: create() };
}

for (const variant of ["async", "sync-rollover", "sync-incomplete"]) {
  test(`historical ${variant} loses control, not original outcome, across repeated recovery and Close`, async t => {
    const f = await fixture(t);
    const admission = await f.first.admit("powershell", { ...args, mode: variant === "async" ? "async" : "sync" }, packet, "old-call");
    if (variant !== "sync-incomplete") await f.first.settled(admission, complete(), true);
    const original = decodeRecord(await f.document.read()).entries[0];
    f.first.releaseWriter(); await closeHostStateWal(f.root);
    const restored = f.create(), proof = evidence();
    assert.equal(await restored.recoveryDiagnosticsRequired(), true);
    await restored.prepareWriter(recovery, proof);
    const bytes = await f.document.read(), saved = decodeRecord(bytes).entries[0];
    const { controlRetirement, ...unchanged } = saved;
    assert.deepEqual(unchanged, original);
    assert.equal(saved.exitCode, null); assert.equal(saved.endedAt, null);
    assert.equal(controlRetirement.outcome, "authority-retired-process-state-unconfirmed");
    assert.deepEqual(controlRetirement.evidence, proof);
    assert.notEqual(controlRetirement.previousGeneration.writerClaim.writerId, controlRetirement.generation.writerId);
    assert.notEqual(controlRetirement.previousGeneration.writerClaim.instanceId, controlRetirement.generation.instanceId);
    await restored.prepareWriter(recovery, proof);
    assert.equal(await f.document.read(), bytes, "Repeated preparation never rewrites historical provenance.");
    assert.equal(await restored.recoveryDiagnosticsRequired(), true, "Repeated recovery still observes current admission safety.");
    const row = (await restored.read()).nativeSessions[0];
    assert.equal(row.status, "held"); assert.equal(row.recordedStatus, original.status); assert.equal(row.canStop, false);
    assert.match(row.reason, /no exit, completion, adoption or stop/);
    assert.deepEqual(await restored.pendingSync("old-task"), []);
    assert.equal((await restored.evidenceForCycle("cycle"))[0].recordedStatus, original.status);
    await restored.assertSettled();
    const digest = await restored.cleanCloseDigest();
    await restored.close();
    const reopened = f.create();
    await assert.rejects(reopened.prepareWriter({ ...recovery, id: "later-recovery" }), /evidence/);
    await reopened.prepareWriter({ ...recovery, id: "later-recovery" }, evidence());
    assert.equal(await reopened.cleanCloseDigest(), digest);
    assert.deepEqual(decodeRecord(await f.document.read()).entries[0], saved);
    await reopened.close();
  });
}

for (const corrupt of ["same-generation", "foreign-session", "fake-completion", "live-evidence"]) {
  test(`persisted ${corrupt} retirement provenance fails closed`, async t => {
    const f = await fixture(t);
    await f.first.admit("powershell", args, packet, "old-call");
    f.first.releaseWriter();
    const restored = f.create();
    await restored.prepareWriter(recovery, evidence());
    const saved = decodeRecord(await f.document.read()), retirement = saved.entries[0].controlRetirement;
    restored.releaseWriter();
    if (corrupt === "same-generation") retirement.generation = retirement.previousGeneration.writerClaim;
    if (corrupt === "foreign-session") retirement.evidence.sessionId = "foreign";
    if (corrupt === "fake-completion") retirement.outcome = "process-completed";
    if (corrupt === "live-evidence") retirement.evidence.processing = true;
    await f.document.transact("corrupt-test-fixture", () => ({ content: encodeRecord(saved), result: null }));
    await assert.rejects(f.create().read(), /provenance|evidence/);
  });
}

test("retired identities remain unadopted while ordinary native reads and stops pass through", async t => {
  const f = await fixture(t);
  const old = await f.first.admit("powershell", args, packet, "old-call");
  await f.first.settled(old, complete(), true);
  f.first.releaseWriter();
  const current = f.create();
  await current.prepareWriter(recovery, evidence());
  const tasks = [];
  current.setTaskReader(async () => ({ tasks: structuredClone(tasks) }));
  current.setStopHandler(async entry => {
    const task = tasks.find(task => task.id === entry.shellId);
    task.status = "cancelled"; task.completedAt = new Date().toISOString();
    return { resultType: "success", status: "stopped", endedAt: task.completedAt };
  }, () => true);
  const beforeNativeRead = await current.read();
  for (const name of ["read_powershell", "stop_powershell"]) {
    const native = await current.admit(name, { shellId: args.shellId }, packet, `late-${name}`);
    assert.deepEqual(native.args, { shellId: args.shellId });
    assert.equal(native.entryId, null);
    await current.settled(native, complete([{ type: "shell_exit", shellId: args.shellId, exitCode: 0 }]));
  }
  assert.deepEqual(await current.read(), beforeNativeRead, "Native access does not adopt or settle a retired journal entry.");
  await assert.rejects(current.permission(old, { kind: "shell", fullCommandText: args.command }), /not owned/);
  await assert.rejects(current.stop(old.entryId), /not a current task/);
  const reusedLabel = await current.admit("powershell", args, packet, "new-reused-label");
  await current.permission(reusedLabel, { kind: "shell", fullCommandText: args.command });
  await current.settled(reusedLabel, complete([{ type: "shell_exit", shellId: args.shellId, exitCode: 0 }]), true);
  assert.equal((await current.read()).nativeSessions[0].exitCode, null, "Reusing a caller label cannot settle a retired invocation.");
  await assert.rejects(current.admit("powershell", { ...args, shellId: "different" }, packet, "old-call"), /invocation identity/);
  const fresh = await current.admit("powershell", { ...args, shellId: "fresh-sync", mode: "sync" },
    { binding: { ...packet.binding, id: "new-task" } }, "new-call");
  tasks.push({ type: "shell", id: "fresh-sync", command: args.command, status: "running",
    startedAt: new Date().toISOString(), attachmentMode: "attached", executionMode: "sync" });
  await current.currentTarget(fresh);
  await current.observe(notification("old-handle"));
  await assert.rejects(current.settled(old, complete([{ type: "shell_exit", shellId: "old-handle", exitCode: 0 }])), /another control generation/);
  await assert.rejects(f.first.observe(notification("old-handle")), /changed outside its writer|live runtime writer/);
  assert.equal((await current.pendingSync("new-task")).length, 1);
  assert.equal((await current.read()).nativeSessions[0].exitCode, null);
  await assert.rejects(current.prepareWriter({ ...recovery, id: "bad-retire-current" }, evidence()), /current owned work/);
  await assert.rejects(current.assertSettled(), /before Close/);
  tasks[0].status = "completed"; tasks[0].completedAt = new Date().toISOString();
  await current.settled(fresh, complete([{ type: "shell_exit", shellId: "fresh-sync", exitCode: 0 }]), true);
  const background = await current.admit("powershell", { ...args, shellId: "fresh-background" }, packet, "new-background");
  tasks.push({ type: "shell", id: "fresh-background", command: args.command, status: "running",
    startedAt: new Date().toISOString(), attachmentMode: "attached", executionMode: "background" });
  await current.settled(background, complete(), true);
  await assert.rejects(current.close(), /before Close/);
  await current.stop(background.entryId);
  await current.close();
});

test("retirement cannot bypass a competing writer or unsupported recovery proof", async t => {
  const f = await fixture(t);
  await f.first.admit("powershell", args, packet, "old-call");
  const before = await f.document.read(), other = f.create();
  await assert.rejects(other.prepareWriter(recovery, evidence()), /live runtime writer/);
  assert.equal(await f.document.read(), before);
  f.first.releaseWriter();
  await assert.rejects(other.prepareWriter({ ...recovery, nativeEvidenceDigest: "b".repeat(64) }, evidence()), /exact same-session/);
  await assert.rejects(other.prepareWriter({ ...recovery, extra: true }, evidence()), /exact supported recovery/);
  await assert.rejects(other.prepareWriter(recovery), /exact same-session/);
  assert.equal(await f.document.read(), before);
  await other.prepareWriter(recovery, evidence());
});

for (const invalid of ["session", "history", "processing", "activity", "queue", "steering", "inflight", "running-sync", "running-background", "idle-agent", "missing-tasks", "unknown-status"]) {
  test(`retirement rejects ${invalid} evidence without changing historical records`, async t => {
    const f = await fixture(t);
    await f.first.admit("powershell", args, packet, "old-call");
    const before = await f.document.read();
    f.first.releaseWriter();
    const proof = evidence();
    if (invalid === "session") proof.sessionId = "foreign";
    if (invalid === "history") proof.historyDigest = "b".repeat(64);
    if (invalid === "processing") proof.processing = true;
    if (invalid === "activity") proof.hasActiveWork = true;
    if (invalid === "queue") proof.queue.items = 1;
    if (invalid === "steering") proof.queue.steeringMessages = 1;
    if (invalid === "inflight") proof.queue.inFlightSteeringCount = 1;
    if (invalid === "missing-tasks") delete proof.tasks;
    if (["running-sync", "running-background", "idle-agent", "unknown-status"].includes(invalid)) {
      proof.tasks = [{ id: "native-task", type: invalid === "idle-agent" ? "agent" : "shell",
        status: invalid === "idle-agent" ? "idle" : invalid === "unknown-status" ? "unknown" : "running",
        startedAt: proof.observedAt, completedAt: proof.observedAt }];
    }
    const restored = f.create();
    await assert.rejects(restored.prepareWriter(recovery, proof), /evidence|observation/);
    assert.equal(await f.document.read(), before);
    await assert.rejects(restored.assertSettled(), /before Close/);
  });
}

function diagnosticSession() {
  return { sessionId: "private", rpc: {
    tasks: { list: async () => ({ tasks: [] }) }, mode: { get: async () => "interactive" },
    metadata: { isProcessing: async () => ({ processing: false }), activity: async () => ({ hasActiveWork: false }) },
    queue: { pendingItems: async () => ({ items: [], steeringMessages: [], inFlightSteeringCount: 0 }) },
  } };
}
const history = { sessionId: "private", digest: recovery.nativeEvidenceDigest };
test("supported task diagnostics are bracketed by history/idle verification and never imply prior process death", async () => {
  const session = diagnosticSession(), checks = [];
  session.rpc.tasks.list = async () => { checks.push("list"); return { tasks: [] }; };
  const proof = await captureNativeControlEvidence(session, history, async () => { checks.push("history+idle"); }, 20);
  assert.deepEqual(checks, ["history+idle", "list", "history+idle"]);
  assert.equal(proof.registryScope, "current-runtime-not-process-exit-proof");
  assert.deepEqual(proof.tasks, []);
  const terminal = { id: "actual-terminal", type: "shell", status: "failed",
    startedAt: "2026-01-01T00:00:00Z", completedAt: "2026-01-01T00:00:01Z", command: "private command not projected" };
  session.rpc.tasks.list = async () => ({ tasks: [terminal] });
  const observed = await captureNativeControlEvidence(session, history, async () => {}, 20);
  assert.equal(observed.tasks[0].status, "failed");
  assert.equal("command" in observed.tasks[0], false);
});

for (const invalid of ["missing-queue", "queued", "active-task", "changed-history", "changed-session"]) {
  test(`native diagnostic capture fails visibly for ${invalid}`, async () => {
    const session = diagnosticSession();
    if (invalid === "missing-queue") session.rpc.queue.pendingItems = async () => ({});
    if (invalid === "queued") session.rpc.queue.pendingItems = async () => ({ items: [{ id: "pending", kind: "message", messageId: "foreign" }],
      steeringMessages: [], inFlightSteeringCount: 0 });
    if (invalid === "active-task") session.rpc.tasks.list = async () => ({ tasks: [{ id: "active", type: "shell", status: "running" }] });
    if (invalid === "changed-session") session.sessionId = "foreign";
    let checks = 0;
    await assert.rejects(captureNativeControlEvidence(session, history, async () => {
      if (++checks === 2 && invalid === "changed-history") throw new Error("History changed.");
    }, 20), /evidence|diagnostics|History changed|active work|queue/i);
  });
}

for (const mode of ["missing-api", "failed-list", "missing-list", "malformed-list", "timeout"]) {
  test(`optional ${mode} task diagnostics preserve unknown history and permit fresh admission`, async t => {
    const f = await fixture(t);
    await f.first.admit("powershell", { ...args, mode: "sync" }, packet, "old-call");
    f.first.releaseWriter();
    const session = diagnosticSession();
    let finish;
    if (mode === "missing-api") delete session.rpc.tasks;
    if (mode === "failed-list") session.rpc.tasks.list = async () => { throw new Error("Task diagnostics failed."); };
    if (mode === "missing-list") session.rpc.tasks.list = async () => ({});
    if (mode === "malformed-list") session.rpc.tasks.list = async () => ({ tasks: [{ id: "old", type: "shell" }] });
    if (mode === "timeout") session.rpc.tasks.list = () => new Promise(resolve => { finish = resolve; });
    const observed = await captureNativeControlEvidence(session, history, async () => {}, 20, 10);
    assert.equal(observed.taskDiagnostics.state, "unavailable");
    assert.equal(observed.tasks, null, "Unavailable observation is not an empty successful registry.");
    const current = f.create();
    await current.prepareWriter(recovery, observed);
    const before = await f.document.read();
    finish?.({ tasks: [{ id: "old", type: "shell", status: "completed" }] });
    await Promise.resolve();
    assert.equal(await f.document.read(), before, "Late optional diagnostics have no control or write authority.");
    const row = (await current.read()).nativeSessions[0];
    assert.equal(row.recordedStatus, "starting"); assert.equal(row.exitCode, null); assert.equal(row.endedAt, null);
    assert.equal(row.canStop, false); assert.match(row.reason, /diagnostics/i);
    const fresh = await current.admit("powershell", { ...args, shellId: "fresh" }, packet, "fresh-call");
    await current.settled(fresh, complete([{ type: "shell_exit", shellId: "fresh", exitCode: 0 }]), true);
    await current.close();
  });
}

for (const unsafe of ["processing", "activity", "queue", "history"]) {
  test(`unavailable historical diagnostics do not weaken required current ${unsafe} safety`, async () => {
    const session = diagnosticSession();
    session.rpc.tasks.list = async () => { throw new Error("Optional old task information unavailable."); };
    if (unsafe === "processing") session.rpc.metadata.isProcessing = async () => ({ processing: true });
    if (unsafe === "activity") session.rpc.metadata.activity = async () => ({ hasActiveWork: true });
    if (unsafe === "queue") session.rpc.queue.pendingItems = async () => { throw new Error("Current queue unavailable."); };
    await assert.rejects(captureNativeControlEvidence(session, history, async () => {
      if (unsafe === "history") throw new Error("Required history proof failed.");
    }, 20), /evidence|Current queue|Required history/);
  });
}

test("optional native queue count remains explicitly unreported rather than fabricated as zero", async () => {
  const session = diagnosticSession();
  session.rpc.queue.pendingItems = async () => ({ items: [], steeringMessages: [] });
  const observed = await captureNativeControlEvidence(session, history, async () => {}, 20);
  assert.equal(observed.queue.inFlightSteeringCount, null);
});
