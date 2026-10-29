import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { HumanLoopNativeShells, cancelNativeShellTask } from "../src/human-loop-native-shells.mjs";
import { DEFAULT_POLICY, resolvePolicy } from "../runtime-src/domain/workflow/policy.ts";
import { closeHostStateWal } from "../runtime-src/domain/host-state-wal.ts";
import { HumanLoopNativeWriter } from "../src/human-loop-native-writer.mjs";

const nativeOutcome = task => ({ resultType: "success", nativeTask: task, cancelled: false,
  status: task.status === "cancelled" ? "stopped" : task.status,
  endedAt: task.completedAt ?? new Date().toISOString() });
const exitNotification = exitCode => ({ id: "native-exit", type: "system.notification",
  timestamp: new Date().toISOString(), sessionId: null, agentId: null,
  data: { kind: { type: "shell_completed", shellId: "owned", exitCode } } });

async function fixture(t, policy = DEFAULT_POLICY) {
  const root = resolve(`.native-shells-${randomUUID()}`);
  await mkdir(root, { recursive: true });
  const owner = { schemaVersion: "human-loop-owner/v1", id: "owner", mainSessionId: "main",
    privateSessionId: "private", workspacePath: root, policy };
  let index = "a".repeat(64);
  const workspace = { protectedIndexDigest: async () => index, inspectNativePath: async () => ({}) };
  const legacy = { read: async () => ({ apps: [], commands: [] }), evidenceForCycle: async () => [],
    cleanCloseDigest: async () => "b".repeat(64), close: async () => {} };
  const options = { owner, workspace, legacy, runtimeDirectory: join(root, ".tandem", "runtime") };
  const shells = new HumanLoopNativeShells(options);
  const tasks = [];
  shells.setTaskReader(async () => ({ tasks: structuredClone(tasks) }));
  const start = admission => {
    const task = { type: "shell", id: admission.args.shellId ?? "assigned", command: admission.args.command,
      status: "running", startedAt: new Date().toISOString(), attachmentMode: "attached", executionMode: "background" };
    tasks.push(task);
    return task;
  };
  const stopResult = (entry, status = "stopped") => {
    const task = tasks.find(task => task.id === entry.shellId);
    task.status = status === "stopped" ? "cancelled" : status; task.completedAt = new Date().toISOString();
    return { resultType: "success", status, endedAt: task.completedAt };
  };
  t.after(async () => {
    shells.setTaskReader(async () => ({ tasks: [] }));
    await shells.close();
    await closeHostStateWal(root);
    await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  });
  const packet = { binding: { id: "task", role: "agent", requestId: "request", cycleId: null } };
  const args = { command: "node server.mjs", description: "Owned fixture", mode: "async", shellId: "owned" };
  const complete = (success = true, contents = []) => ({
    type: "tool.execution_complete", timestamp: new Date().toISOString(), data: { success, result: { contents } },
  });
  return { root, options, shells, packet, args, complete, tasks, start, stopResult,
    mutateIndex: (value = "c".repeat(64)) => { index = value; } };
}

test("local Close retains running and unbound records without consulting the shut-down native registry", async t => {
  const f = await fixture(t);
  const running = await f.shells.admit("powershell", f.args, f.packet, "running");
  f.start(running);
  await f.shells.settled(running, f.complete(), true);
  const held = await f.shells.admit("powershell", { command: "node held.mjs", mode: "sync" }, f.packet, "held");
  const before = await f.shells.evidenceForCycle(null);
  assert.equal(before.find(row => row.id === running.entryId).recordedStatus, "running");
  assert.equal(before.find(row => row.id === held.entryId).recordedStatus, "starting");
  assert.equal(before.find(row => row.id === held.entryId).controlUnbound, true);
  let reads = 0, closed = 0;
  f.shells.setTaskReader(async () => { reads++; throw new Error("Native registry is shut down"); });
  const close = t.mock.method(f.options.legacy, "close", async () => { closed++; });
  try {
    await f.shells.close();
    assert.equal(reads, 0);
    assert.equal(closed, 1);
    assert.deepEqual(await f.shells.evidenceForCycle(null), before, "Cleanup cannot fabricate terminal shell outcomes.");
  } finally { close.mock.restore(); }
});

test("local Close drains an admitted native journal write before legacy cleanup and writer release", async t => {
  const f = await fixture(t), entered = Promise.withResolvers(), release = Promise.withResolvers();
  await f.shells.prepareWriter();
  const original = HumanLoopNativeWriter.prototype.mutate;
  const writing = t.mock.method(HumanLoopNativeWriter.prototype, "mutate", async function (...args) {
    entered.resolve(); await release.promise; return original.apply(this, args);
  });
  let legacyClosed = false;
  const closingLegacy = t.mock.method(f.options.legacy, "close", async () => { legacyClosed = true; });
  let admission, closing;
  try {
    admission = f.shells.admit("powershell", f.args, f.packet, "pending-write");
    await entered.promise;
    closing = f.shells.close();
    await Promise.resolve();
    assert.equal(legacyClosed, false);
    release.resolve();
    await admission; await closing;
    assert.equal(legacyClosed, true);
    assert.equal((await f.shells.evidenceForCycle(null)).length, 1);
  } finally {
    release.resolve();
    await Promise.allSettled([admission, closing]);
    writing.mock.restore(); closingLegacy.mock.restore();
  }
});

test("local storage cleanup errors propagate while the native writer is still released", async t => {
  const f = await fixture(t);
  await f.shells.prepareWriter();
  let releases = 0;
  const original = HumanLoopNativeWriter.prototype.close;
  const release = t.mock.method(HumanLoopNativeWriter.prototype, "close", function () {
    releases++; return original.call(this);
  });
  const close = t.mock.method(f.options.legacy, "close", async () => { throw new Error("Local storage close failed"); });
  try {
    await assert.rejects(f.shells.close(), /Local storage close failed/);
    assert.equal(releases, 1);
  } finally { close.mock.restore(); release.mock.restore(); }
});

test("native reads and stops pass through when Tandem has no process-control binding", async t => {
  const f = await fixture(t);
  for (const name of ["read_powershell", "stop_powershell"]) {
    const args = { shellId: "native-assigned", ...(name === "read_powershell" ? { delay: 0 } : {}) };
    const admission = await f.shells.admit(name, args, f.packet, `${name}-call`);
    assert.deepEqual(admission.args, args);
    assert.equal(admission.entryId, null);
    await f.shells.settled(admission, f.complete(), true);
  }
  assert.deepEqual((await f.shells.read()).nativeSessions, []);
  await assert.rejects(f.shells.stop("native:unowned"), /not a current task/);
});

test("registry binding requires one new exact generation, excludes ambiguity and is never adopted on reload", async t => {
  for (const variant of ["unique", "existing", "duplicate", "concurrent", "detached"]) await t.test(variant, async t => {
    const f = await fixture(t), tasks = [];
    f.shells.setTaskReader(async () => ({ tasks: structuredClone(tasks) }));
    const { shellId: _label, ...args } = f.args;
    if (variant === "detached") args.detach = true;
    if (variant === "existing") tasks.push({ type: "shell", id: "assigned", command: args.command,
      startedAt: new Date().toISOString(), status: "running", attachmentMode: "attached", executionMode: "background" });
    const launch = await f.shells.admit("powershell", args, f.packet, "first");
    let competing;
    if (variant === "concurrent") competing = await f.shells.admit("powershell", args, f.packet, "second");
    const task = { type: "shell", id: "assigned", command: args.command,
      startedAt: variant === "existing" ? tasks[0].startedAt : new Date().toISOString(),
      status: "running", attachmentMode: variant === "detached" ? "detached" : "attached", executionMode: "background" };
    tasks.splice(0, tasks.length, task);
    if (variant === "duplicate") tasks.push({ ...task, id: "other-assigned" });
    await f.shells.settled(launch, f.complete(true, [{ type: "terminal", text: "shellId:fake-id" }]), true);
    if (competing) await f.shells.settled(competing, f.complete(), true);
    let row = (await f.shells.read()).nativeSessions.find(row => row.id === "native:first");
    assert.equal(row.shellId, variant === "unique" ? "assigned" : null);
    if (variant === "unique") {
      assert.equal(row.nativeStartedAt, task.startedAt);
      assert.equal(row.taskBinding, undefined);
      const recovered = new HumanLoopNativeShells(f.options);
      const old = (await recovered.read()).nativeSessions[0];
      assert.equal(old.nativeStartedAt, row.nativeStartedAt); assert.equal(old.canStop, false);
      await assert.rejects(recovered.stop(old.id), /not a current task/);
      task.status = "completed"; task.completedAt = new Date().toISOString();
      await f.shells.refreshTasks("task");
      row = (await f.shells.read()).nativeSessions[0];
      assert.equal(row.status, "completed"); assert.equal(row.exitCode, null);
      assert.equal(row.completionNotification, undefined);
    } else {
      assert.equal(row.taskBinding, undefined); assert.equal(row.controlUnbound, true);
    }
    tasks.length = 0;
    await f.shells.assertSettled();
  });
});

test("automatic output requires the exact live settled generation, not a reused or recovered shell handle", async t => {
  const f = await fixture(t);
  const admission = await f.shells.admit("powershell", f.args, f.packet, "call");
  await f.shells.settled(admission, f.complete(), true);
  const notification = { id: "completion-notification", type: "system.notification", timestamp: new Date().toISOString(), sessionId: "private",
    data: { kind: { type: "shell_completed", shellId: "owned", exitCode: 0 } } };
  await assert.rejects(f.shells.assertAutomaticOutput(notification), /settled shell/);
  await assert.rejects(f.shells.observe({ ...notification, sessionId: "foreign" }), /different private session/);
  await f.shells.observe(notification);
  await f.shells.assertAutomaticOutput(notification);
  await assert.rejects(f.shells.settled(admission,
    f.complete(true, [{ type: "shell_exit", shellId: "owned", exitCode: 1 }]), true), /recorded exit evidence/);
  await f.shells.assertAutomaticOutput(notification);
  await f.shells.observe(structuredClone(notification));
  for (const patch of [{ id: "other-notification" }, { parentId: "changed" },
    { agentId: "subagent" }, { sessionId: "foreign" }]) {
    await assert.rejects(f.shells.assertAutomaticOutput({ ...notification, ...patch }), /Automatic output/);
    await assert.rejects(f.shells.observe({ ...notification, ...patch }), /notification/);
  }
  await assert.rejects(f.shells.assertAutomaticOutput({ ...notification,
    data: { kind: { ...notification.data.kind, exitCode: 1 } } }), /settled shell/);
  await assert.rejects(f.shells.assertAutomaticOutput({ ...notification,
    data: { kind: { ...notification.data.kind, shellId: "foreign" } } }), /owned|control/i);
  const reused = await f.shells.admit("powershell", f.args, f.packet, "reused");
  await f.shells.permission(reused, { kind: "shell", fullCommandText: f.args.command });
  await f.shells.settled(reused, f.complete(true, [{ type: "shell_exit", shellId: "owned", exitCode: 0 }]), true);
  assert.equal(await f.shells.automaticOutputBinding(notification), null);
  const recovered = new HumanLoopNativeShells(f.options);
  assert.deepEqual((await recovered.read()).nativeSessions[0].completionNotification,
    (await f.shells.read()).nativeSessions[0].completionNotification);
  await assert.rejects(recovered.assertAutomaticOutput(notification), /owned|control/i);
});

test("native shell remains visible after role completion and exact host stop permits a fresh restart", async t => {
  const f = await fixture(t);
  let canStop = true;
  const stops = [];
  f.shells.setStopHandler(async entry => { stops.push({ id: entry.id, shellId: entry.shellId, request: entry.stopRequestId }); return f.stopResult(entry); }, () => canStop);
  const admission = await f.shells.admit("powershell", f.args, f.packet, "call-1");
  f.start(admission);
  await f.shells.permission(admission, { kind: "shell", fullCommandText: f.args.command });
  await assert.rejects(f.shells.permission(admission, { kind: "shell", fullCommandText: "other" }), /differs/);
  await f.shells.settled(admission, f.complete(), true);
  const row = (await f.shells.read()).nativeSessions[0];
  assert.equal(row.status, "running"); assert.equal(row.canStop, true); assert.equal(row.shellId, "owned");
  assert.equal(row.backgroundOrigin, "explicit-async");
  assert.deepEqual(await f.shells.pendingSync("task"), []);
  await assert.rejects(f.shells.assertSettled(), /before Close/);
  canStop = false;
  await assert.rejects(f.shells.stop(row.id), /private session is unavailable/);
  canStop = true;
  await f.shells.stop(row.id);
  assert.equal(stops.length, 1); assert.ok(stops[0].request.startsWith("native-stop-"));
  assert.equal((await f.shells.read()).nativeSessions[0].status, "stopped");
  const restart = await f.shells.admit("powershell", f.args, f.packet, "call-2");
  await f.shells.settled(restart, f.complete(true, [{ type: "shell_exit", shellId: "owned", exitCode: 0 }]), true);
});

test("completion receipt is single-writer and cannot be replaced by concurrent or unobserved notifications", async t => {
  const f = await fixture(t);
  const admission = await f.shells.admit("powershell", f.args, f.packet, "call");
  await f.shells.settled(admission, f.complete(true, [{ type: "shell_exit", shellId: "owned", exitCode: 0 }]), true);
  const notification = { id: "first", type: "system.notification", timestamp: new Date().toISOString(),
    sessionId: "private", data: { kind: { type: "shell_completed", shellId: "owned", exitCode: 0 } } };
  await assert.rejects(f.shells.assertAutomaticOutput(notification), /exact recorded completion/);
  const results = await Promise.allSettled([
    f.shells.observe(notification), f.shells.observe({ ...notification, id: "second" }),
  ]);
  assert.deepEqual(results.map(result => result.status), ["fulfilled", "rejected"]);
  assert.match(results[1].reason.message, /notification identity changed/);
  await f.shells.assertAutomaticOutput(notification);
  assert.equal((await f.shells.read()).nativeSessions[0].completionNotification.eventId, "first");
});

test("native shell control is single-flight per process and errors preserve its reported status", async t => {
  const f = await fixture(t);
  const admission = await f.shells.admit("powershell", f.args, f.packet, "call-1");
  f.start(admission);
  await f.shells.settled(admission, f.complete(), true);
  const id = (await f.shells.read()).nativeSessions[0].id;
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  f.shells.setStopHandler(async () => { entered.resolve(); await release.promise; throw new Error("unconfirmed fixture response"); }, () => true);
  const stop = f.shells.stop(id);
  const rejected = assert.rejects(stop, /unconfirmed fixture response/);
  await entered.promise;
  assert.equal((await f.shells.read()).nativeSessions[0].canStop, false);
  await assert.rejects(f.shells.stop(id), /current process control/);
  release.resolve(); await rejected;
  assert.equal((await f.shells.read()).nativeSessions[0].status, "running");
  assert.match((await f.shells.read()).nativeSessions[0].reason, /Native stop failed: unconfirmed fixture response/);
  await assert.rejects(f.shells.stop("native:foreign"), /not a current task/);
  f.shells.setStopHandler(async entry => f.stopResult(entry), () => true);
  await f.shells.stop(id);
});

test("a confirmed natural outcome during process cancellation retains status, exit code and source receipt", async t => {
  const f = await fixture(t);
  const admission = await f.shells.admit("powershell", f.args, f.packet, "natural-stop");
  f.start(admission);
  await f.shells.settled(admission, f.complete(), true);
  const row = (await f.shells.read()).nativeSessions[0];
  const timestamp = new Date().toISOString();
  const event = { id: "natural-exit", type: "system.notification", sessionId: "private", timestamp,
    data: { kind: { type: "shell_completed", shellId: row.shellId, exitCode: 7 } } };
  f.shells.setStopHandler(async () => {
    f.stopResult(row, "failed");
    await f.shells.observe(event);
    return { resultType: "success", status: "stopped", endedAt: timestamp };
  }, () => true);
  const result = await f.shells.stop(row.id);
  assert.equal(result.status, "failed"); assert.equal(result.exitCode, 7);
  assert.equal(result.endedAt, timestamp);
  assert.equal(result.completionNotification.eventId, event.id);
  assert.equal(result.canStop, false);
  assert.equal((await new HumanLoopNativeShells(f.options).read()).nativeSessions[0].status, "failed");
});

test("native journal never adopts retained live handles and preserves the protected-index fence", async t => {
  const f = await fixture(t);
  const admission = await f.shells.admit("powershell", f.args, f.packet, "call-1");
  f.start(admission);
  f.mutateIndex();
  await assert.rejects(f.shells.settled(admission, f.complete(), true), /TANDEM/);
  f.mutateIndex("a".repeat(64));
  await f.shells.settled(admission, f.complete(), true);
  const recovered = new HumanLoopNativeShells(f.options);
  recovered.setStopHandler(async () => { assert.fail("No adopted handle may be stopped"); }, () => true);
  const retained = (await recovered.read()).nativeSessions[0];
  assert.equal(retained.status, "held"); assert.equal(retained.canStop, false);
  await assert.rejects(recovered.stop(retained.id), /not a current task/);
  await assert.rejects(recovered.admit("powershell", { ...f.args, shellId: "new" }, f.packet, "new-call"), /reconciliation/);
  f.shells.setStopHandler(async entry => f.stopResult(entry), () => true);
  await f.shells.stop(retained.id);
});

test("native timed-sync retains its completion barrier until an exact shell exit", async t => {
  const f = await fixture(t);
  const admission = await f.shells.admit("powershell", { ...f.args, mode: "sync" }, f.packet, "call-1");
  const task = f.start(admission);
  assert.equal((await f.shells.read()).nativeSessions[0].backgroundOrigin, null);
  await f.shells.settled(admission, f.complete(), true);
  assert.equal((await f.shells.read()).nativeSessions[0].backgroundOrigin, "sync-rollover");
  const recovered = new HumanLoopNativeShells(f.options);
  const retained = (await recovered.read()).nativeSessions[0];
  assert.equal(retained.backgroundOrigin, "sync-rollover");
  assert.equal(retained.status, "held");
  assert.equal(retained.canStop, false);
  assert.equal((await f.shells.pendingSync("task")).length, 1);
  await f.shells.observe({ type: "system.notification", timestamp: "2026-09-21T04:00:00Z",
    data: { kind: { type: "shell_completed", shellId: "foreign", exitCode: 0 } } });
  assert.equal((await f.shells.pendingSync("task")).length, 1);
  await f.shells.observe({ type: "system.notification", timestamp: "2026-09-21T04:00:01Z",
    data: { kind: { type: "shell_completed", shellId: "owned", exitCode: 0 } } });
  task.status = "completed"; task.completedAt = new Date().toISOString();
  assert.deepEqual(await f.shells.pendingSync("task"), []);
  assert.equal((await f.shells.read()).nativeSessions[0].backgroundOrigin, "sync-rollover");
  await f.shells.assertSettled();
});

test("foreground sync completion or failed invocation does not establish background lifetime", async t => {
  const f = await fixture(t);
  for (const [shellId, success] of [["finite", true], ["denied", false]]) {
    const admission = await f.shells.admit("powershell", { ...f.args, mode: "sync", shellId }, f.packet, shellId);
    await f.shells.settled(admission, f.complete(success, success
      ? [{ type: "shell_exit", shellId, exitCode: 0 }] : []), success);
    assert.equal((await f.shells.read()).nativeSessions.find(e => e.shellId === shellId).backgroundOrigin, null);
  }
});

test("native shell capabilities are independent of role while retaining invocation integrity", async t => {
  const f = await fixture(t);
  for (const role of ["router", "designer", "planner", "implementer", "reviewer", "agent"]) {
    const packet = { binding: { ...f.packet.binding, role, id: `${role}-task` } };
    const launch = await f.shells.admit("powershell", { ...f.args, shellId: role }, packet, `${role}-launch`);
    await f.shells.permission(launch, { kind: "shell", fullCommandText: f.args.command });
    await f.shells.settled(launch, f.complete(), true);
    for (const [name, args] of [
      ["list_powershell", {}], ["read_powershell", { shellId: role, delay: 5 }],
      ["stop_powershell", { shellId: role }],
    ]) {
      const admission = await f.shells.admit(name, args, packet, `${role}-${name}`);
      await f.shells.settled(admission, f.complete(true,
        name === "read_powershell" ? [{ type: "shell_exit", shellId: role, exitCode: 0 }] : []), true);
    }
    assert.equal((await f.shells.read()).nativeSessions.find(entry => entry.shellId === role).status, "completed");
  }
});

test("native shell preserves detached arguments without claiming control or a shutdown barrier", async t => {
  const f = await fixture(t);
  const args = { ...f.args, detach: true };
  const detached = await f.shells.admit("powershell", args, f.packet, "detached");
  assert.deepEqual(detached.args, args);
  await f.shells.permission(detached, { kind: "shell", fullCommandText: args.command });
  await f.shells.settled(detached, f.complete(), true);
  f.shells.setStopHandler(async () => assert.fail("Detached work must not use unverified task cancellation."), () => true);
  const row = (await f.shells.read()).nativeSessions[0];
  assert.equal(row.status, "held"); assert.equal(row.recordedStatus, "running"); assert.equal(row.canStop, false);
  await assert.rejects(f.shells.stop(row.id), /not a current task/);
  await f.shells.assertSettled();
  assert.equal((await f.shells.admit("stop_powershell", { shellId: "native-only" }, f.packet, "native-stop")).entryId, null);
  const admission = await f.shells.admit("powershell", { ...f.args, shellId: "denied" }, f.packet, "denied");
  await f.shells.settled(admission, f.complete(false), false);
  assert.equal((await f.shells.read()).nativeSessions[1].status, "failed");
});

test("omitted native labels retain invocation identity and raw output never supplies handles", async t => {
  const f = await fixture(t);
  const { shellId: _label, ...args } = f.args;
  const launch = await f.shells.admit("powershell", args, f.packet, "anonymous");
  assert.deepEqual(launch.args, args);
  await f.shells.permission(launch, { kind: "shell", fullCommandText: args.command });
  await f.shells.settled(launch, f.complete(true, [{ type: "terminal", text: '{"shellId":"not-authority"}' }]), true);
  let row = (await f.shells.read()).nativeSessions[0];
  assert.equal(row.id, "native:anonymous"); assert.equal(row.shellId, null);
  assert.equal(row.status, "held"); assert.equal(row.canStop, false);
  await f.shells.assertSettled();
  const finite = await f.shells.admit("powershell", { ...args, mode: "sync" }, f.packet, "finite-anonymous");
  await f.shells.settled(finite, f.complete(true, [{ type: "shell_exit", shellId: "native-assigned", exitCode: 7 }]), true);
  row = (await f.shells.read()).nativeSessions[1];
  assert.equal(row.shellId, "native-assigned"); assert.equal(row.status, "failed"); assert.equal(row.exitCode, 7);
  assert.equal((await new HumanLoopNativeShells(f.options).read()).nativeSessions[0].shellId, null);
});

test("reused labels cannot attribute late notifications or stop a different invocation", async t => {
  const f = await fixture(t);
  f.shells.setStopHandler(async () => assert.fail("Ambiguous labels must not select a native task."), () => true);
  for (const call of ["old", "new"]) {
    const admission = await f.shells.admit("powershell", f.args, f.packet, call);
    await f.shells.permission(admission, { kind: "shell", fullCommandText: f.args.command });
    await f.shells.settled(admission, f.complete(), true);
  }
  const before = (await f.shells.read()).nativeSessions;
  const late = { id: "late-old-exit", type: "system.notification", timestamp: new Date().toISOString(),
    sessionId: "private", data: { kind: { type: "shell_completed", shellId: "owned", exitCode: 0 } } };
  await f.shells.observe(late);
  assert.equal(await f.shells.automaticOutputBinding(late), null);
  assert.deepEqual((await f.shells.read()).nativeSessions, before);
  for (const row of before) {
    assert.equal(row.status, "held"); assert.equal(row.canStop, false);
    await assert.rejects(f.shells.stop(row.id), /not a current task/);
  }
  assert.deepEqual(await f.shells.pendingSync("task"), []);
  await f.shells.assertSettled();
});

test("native stop success without a terminal receipt never invents a stopped outcome", async t => {
  const f = await fixture(t);
  const launch = await f.shells.admit("powershell", f.args, f.packet, "launch");
  const task = f.start(launch);
  f.shells.setStopHandler(async entry => f.stopResult(entry), () => true);
  await f.shells.settled(launch, f.complete(), true);
  const stop = await f.shells.admit("stop_powershell", { shellId: "owned" }, f.packet, "stop");
  await f.shells.settled(stop, f.complete(true), true);
  const row = (await f.shells.read()).nativeSessions[0];
  assert.equal(row.status, "running"); assert.equal(row.exitCode, null);
  assert.equal(row.canStop, true, "A generic successful response must not disable a known native handle.");
  task.status = "cancelled"; task.completedAt = new Date().toISOString();
  assert.equal((await f.shells.read()).nativeSessions[0].status, "stopped");
  await f.shells.assertSettled();
});

test("actual native stopped responses settle omitted and reused labels without an exit or retained registry row", async t => {
  const f = await fixture(t);
  f.shells.setStopHandler(async () => assert.fail("Native agent Stop is not panel cancellation."), () => true);
  for (const [index, shellId] of [undefined, "reused", "reused"].entries()) {
    const args = { command: f.args.command, mode: "async", ...(shellId ? { shellId } : {}) };
    const launch = await f.shells.admit("powershell", args, f.packet, `launch-${index}`);
    assert.deepEqual(launch.args, args);
    const task = f.start(launch);
    const started = f.complete();
    started.data.result.content = `<command started in background with shellId: ${task.id}>`;
    await f.shells.settled(launch, started, true);
    const row = (await f.shells.read()).nativeSessions.find(row => row.id === launch.entryId);
    assert.equal(row.canStop, true);
    assert.equal(row.nativeStartedAt, task.startedAt);
    const read = await f.shells.admit("read_powershell", { shellId: task.id, delay: 0 }, f.packet, `read-${index}`);
    assert.equal(read.entryId, launch.entryId);
    await f.shells.settled(read, f.complete(), true);
    const stop = await f.shells.admit("stop_powershell", { shellId: task.id }, f.packet, `stop-${index}`);
    f.tasks.length = 0;
    const stopped = f.complete();
    stopped.data.result.content = `<command with id: ${task.id} stopped>`;
    await f.shells.settled(stop, stopped, true);
    const actual = (await f.shells.read()).nativeSessions.find(row => row.id === launch.entryId);
    assert.equal(actual.status, "stopped"); assert.equal(actual.exitCode, null);
    assert.equal(actual.canStop, false); assert.equal(actual.controlUnbound, false);
    await assert.rejects(f.shells.stop(actual.id), /not a current task/);
  }
  assert.deepEqual((await new HumanLoopNativeShells(f.options).read()).nativeSessions.map(row => row.status),
    ["stopped", "stopped", "stopped"]);
});

test("unattributed current native tasks remain controllable and stale cards cannot target reused IDs", async t => {
  const f = await fixture(t), cancelled = [];
  const task = f.start({ args: f.args });
  const rpc = {
    list: async () => ({ tasks: structuredClone(f.tasks) }),
    cancel: async ({ id }) => { cancelled.push(id); f.tasks.length = 0; return { cancelled: true }; },
  };
  f.shells.setStopHandler(entry => cancelNativeShellTask(rpc, entry), () => true);
  const row = (await f.shells.read()).nativeSessions[0];
  assert.equal(row.backgroundOrigin, "native-task"); assert.equal(row.taskId, null);
  assert.equal(row.canStop, true);
  task.startedAt = "2099-01-01T00:00:00.000Z";
  await assert.rejects(f.shells.stop(row.id), /not a current task/);
  assert.deepEqual(cancelled, []);
  const current = (await f.shells.read()).nativeSessions[0];
  assert.notEqual(current.id, row.id);
  const result = await f.shells.stop(current.id);
  assert.equal(result.status, "stopped"); assert.equal(result.exitCode, null);
  assert.deepEqual(cancelled, ["owned"]);
  assert.deepEqual((await f.shells.read()).nativeSessions, []);
});

test("native task control remains single-flight when launch attribution arrives during cancellation", async t => {
  const f = await fixture(t), entered = Promise.withResolvers(), release = Promise.withResolvers();
  const launch = await f.shells.admit("powershell", f.args, f.packet, "late-attribution");
  f.start(launch);
  f.shells.setStopHandler(async () => {
    entered.resolve(); await release.promise; f.tasks.length = 0;
    return { resultType: "success", status: "stopped", endedAt: new Date().toISOString() };
  }, () => true);
  const nativeRow = (await f.shells.read()).nativeSessions.find(row => row.canStop);
  assert.ok(nativeRow.id.startsWith("native-task:"));
  const stopping = f.shells.stop(nativeRow.id);
  try {
    await entered.promise;
    await f.shells.settled(launch, f.complete(), true);
    const attributed = (await f.shells.read()).nativeSessions.find(row => row.id === launch.entryId);
    assert.equal(attributed.canStop, false);
    await assert.rejects(f.shells.stop(attributed.id), /control is still pending/);
  } finally { release.resolve(); await stopping; }
  assert.equal((await f.shells.read()).nativeSessions[0].status, "stopped");
});

test("current catalog terminal history respects the existing display window without a lifetime quota", async t => {
  const f = await fixture(t, resolvePolicy({ resources: { reviewCollections: 1 } }));
  for (let index = 0; index < 3; index++) {
    const task = f.start({ args: { ...f.args, shellId: `native-${index}` } });
    task.status = "completed"; task.completedAt = new Date().toISOString();
  }
  f.start({ args: { ...f.args, shellId: "still-running" } });
  assert.deepEqual((await f.shells.read()).nativeSessions.map(row => row.shellId), ["native-2", "still-running"]);
  assert.equal(f.tasks.length, 4, "Display bounds do not remove native tasks.");
});

test("native errors and requested-only stop responses keep current status and control available", async t => {
  const f = await fixture(t);
  const launch = await f.shells.admit("powershell", f.args, f.packet, "launch");
  const task = f.start(launch);
  await f.shells.settled(launch, f.complete(), true);
  f.shells.setStopHandler(entry => f.stopResult(entry), () => true);
  for (const success of [true, false]) {
    const stop = await f.shells.admit("stop_powershell", { shellId: task.id }, f.packet, `stop-${success}`);
    const result = f.complete(success);
    result.data.result.content = "Cancellation requested";
    await f.shells.settled(stop, result, true);
    const row = (await f.shells.read()).nativeSessions[0];
    assert.equal(row.status, "running"); assert.equal(row.canStop, true);
    assert.equal(row.controlUnbound, false);
    if (!success) assert.match(row.reason, /Native stop failed/);
  }
  await f.shells.stop(launch.entryId);
});

test("an unavailable native catalog is visible uncertainty, not stale Running or permanent loss of control", async t => {
  const f = await fixture(t);
  f.start({ args: f.args });
  f.shells.setStopHandler(entry => f.stopResult(entry), () => true);
  const current = (await f.shells.read()).nativeSessions[0];
  f.shells.setTaskReader(async () => { throw new Error("Native registry temporarily unavailable"); });
  const unavailable = (await f.shells.read()).nativeSessions[0];
  assert.equal(unavailable.id, current.id);
  assert.equal(unavailable.status, "held"); assert.equal(unavailable.canStop, false);
  assert.match(unavailable.reason, /temporarily unavailable/);
  await assert.rejects(f.shells.assertSettled(), /Current native task status is unavailable/);
  f.shells.setTaskReader(async () => ({ tasks: structuredClone(f.tasks) }));
  const restored = (await f.shells.read()).nativeSessions[0];
  assert.equal(restored.id, current.id);
  assert.equal(restored.status, "running"); assert.equal(restored.canStop, true);
  await f.shells.stop(restored.id);
});

for (const rejected of [false, true]) test(`pending catalog observation is shared and optional until ${rejected ? "rejection" : "completion"}`, async t => {
  const f = await fixture(t), pending = Promise.withResolvers();
  f.start({ args: f.args });
  const original = (await f.shells.read()).nativeSessions[0];
  let reads = 0;
  f.shells.setTaskReader(() => { reads++; return pending.promise; });
  try {
    const [first, second] = await Promise.all([f.shells.read(), f.shells.read(),
      f.shells.refreshTasks("unrelated-role"), f.shells.pendingSync("unrelated-role")]);
    assert.equal(reads, 1);
    for (const snapshot of [first, second]) {
      assert.equal(snapshot.nativeSessions[0].id, original.id);
      assert.match(snapshot.nativeSessions[0].reason, /Refreshing.*last native observation/);
    }
    const args = { command: "Write-Output finite", mode: "sync" };
    const launch = await f.shells.admit("powershell", args, f.packet, "while-observation-pending");
    assert.deepEqual(launch.args, args);
    await f.shells.permission(launch, { kind: "shell", fullCommandText: args.command });
    await f.shells.settled(launch, f.complete(true, [{ type: "shell_exit", shellId: "finite", exitCode: 0 }]), true);
    assert.equal(reads, 1, "Ordinary native work and repeated snapshots do not duplicate the unresolved RPC.");
    if (rejected) pending.reject(new Error("Native catalog read rejected"));
    else {
      f.tasks[0].status = "completed"; f.tasks[0].completedAt = new Date().toISOString();
      pending.resolve({ tasks: structuredClone(f.tasks) });
    }
    await pending.promise.catch(() => {});
    const after = await f.shells.read();
    const row = after.nativeSessions.find(row => row.shellId === "owned");
    assert.equal(row.status, rejected ? "held" : "completed");
    if (rejected) assert.match(row.reason, /rejected/);
    assert.equal(after.nativeSessions.find(row => row.shellId === "finite").status, "completed");
  } finally { pending.resolve({ tasks: [] }); }
});

test("native cancellation uses current task identity and its explicit result, not duplicate terminal certification", async () => {
  const task = { type: "shell", id: "native", startedAt: "2026-01-01T00:00:00Z",
    command: "native command metadata", attachmentMode: "attached", status: "running" };
  const entry = { shellId: task.id, nativeStartedAt: task.startedAt, command: "different audit metadata" };
  let lists = 0, calls = 0;
  const rpc = { list: async () => {
    lists++;
    assert.equal(lists, 1, "Successful native cancellation needs no second registry observation.");
    return { tasks: [task] };
  }, cancel: async args => { calls++; assert.deepEqual(args, { id: task.id }); return { cancelled: true }; } };
  const result = await cancelNativeShellTask(rpc, entry);
  assert.equal(result.status, "stopped"); assert.equal(calls, 1);
  lists = 0;
  await assert.rejects(cancelNativeShellTask(rpc, { ...entry, nativeStartedAt: "2026-01-02T00:00:00Z" }), /no longer current/);
  assert.equal(calls, 1);
  let status = "running";
  const racing = { list: async () => ({ tasks: [{ ...task, status }] }),
    cancel: async () => { status = "failed"; return { cancelled: false }; } };
  assert.equal((await cancelNativeShellTask(racing, entry)).status, "failed");
  await assert.rejects(cancelNativeShellTask({ ...racing, list: async () => ({ tasks: [task] }),
    cancel: async () => ({ cancelled: false }) }, entry), /did not confirm/);
});

test("native command text is not a managed-record mutation classifier", async t => {
  const f = await fixture(t);
  for (const [index, command] of ['Write-Output "TANDEM.md"', "Get-Content docs\\TANDEM.md",
    "git status --short", 'Write-Output ".tandem .teleos TELEOS.md"'].entries()) {
    const args = { ...f.args, command, mode: "sync", initial_wait: 60, shellId: `literal-${index}` };
    const admission = await f.shells.admit("powershell", args, f.packet, args.shellId);
    assert.deepEqual(admission.args, args);
    await f.shells.permission(admission, { kind: "shell", fullCommandText: command });
    await f.shells.settled(admission, f.complete(true, [{ type: "shell_exit", shellId: args.shellId, exitCode: 0 }]), true);
  }
});

test("retained command history is not a lifetime launch quota and display truncation preserves evidence", async t => {
  const f = await fixture(t, resolvePolicy({ resources: { reviewCollections: 1 } }));
  for (let index = 0; index < 3; index++) {
    const shellId = `history-${index}`;
    const admission = await f.shells.admit("powershell", { ...f.args, mode: "sync", shellId }, f.packet, shellId);
    await f.shells.settled(admission, f.complete(true, [{ type: "shell_exit", shellId, exitCode: 0 }]), true);
  }
  assert.deepEqual((await f.shells.read()).nativeSessions.map(entry => entry.shellId), ["history-2"]);
  assert.equal((await f.shells.evidenceForCycle(null)).length, 3);
  const recovered = new HumanLoopNativeShells(f.options);
  assert.equal((await recovered.evidenceForCycle(null)).length, 3);
  await assert.rejects(f.shells.admit("powershell", { ...f.args, shellId: "history-0" }, f.packet, "history-0"), /invocation identity/);
  const active = await f.shells.admit("powershell", { ...f.args, shellId: "active" }, f.packet, "active");
  await f.shells.settled(active, f.complete(), true);
  assert.deepEqual((await f.shells.read()).nativeSessions.map(entry => entry.shellId), ["history-2", "active"]);
  const stop = await f.shells.admit("stop_powershell", { shellId: "active" }, f.packet, "stop-active");
  await f.shells.settled(stop, f.complete(), true);
});

test("interrupted shell accounting requires exact live cancelled generation and retains no exit success", async t => {
  const f = await fixture(t);
  const admission = await f.shells.admit("powershell", { ...f.args, mode: "sync" }, f.packet, "interrupted");
  const running = f.start(admission);
  await f.shells.currentTarget(admission);
  const entry = (await f.shells.read()).nativeSessions[0];
  const task = { type: "shell", id: "owned", command: f.args.command, status: "cancelled", attachmentMode: "attached",
    executionMode: "sync", startedAt: running.startedAt, completedAt: new Date().toISOString() };
  const evidence = { stopId: "stop", endEventId: "real-idle", observedAt: new Date().toISOString() };
  for (const patch of [{ id: "foreign" }, { status: "running" },
    { attachmentMode: "detached" }, { startedAt: "2000-01-01T00:00:00Z" }]) {
    await assert.rejects(f.shells.interrupted(entry.id, nativeOutcome({ ...task, ...patch }), evidence), /live invocation/);
    assert.equal((await f.shells.pendingSync("task")).length, 1);
  }
  Object.assign(running, task);
  await f.shells.interrupted(entry.id, nativeOutcome(task), evidence);
  const stopped = (await f.shells.read()).nativeSessions[0];
  assert.equal(stopped.exitCode, null);
  assert.equal(stopped.status, "stopped");
  assert.equal(stopped.interruption.endEventId, "real-idle");
  const recovered = new HumanLoopNativeShells(f.options);
  assert.deepEqual((await recovered.read()).nativeSessions[0].interruption, stopped.interruption);
  await f.shells.assertSettled();
});

for (const status of ["completed", "failed"]) test(`interrupted reader retains exact natural ${status} task evidence across recovery`, async t => {
  const f = await fixture(t);
  const admission = await f.shells.admit("powershell", { ...f.args, mode: "sync" }, f.packet, "natural");
  const running = f.start(admission);
  await f.shells.settled(admission, f.complete(true));
  const entry = (await f.shells.read()).nativeSessions[0], exitCode = status === "completed" ? 0 : 7;
  await f.shells.observe({ type: "system.notification", timestamp: new Date().toISOString(),
    data: { kind: { type: "shell_completed", shellId: "owned", exitCode } } });
  assert.equal((await f.shells.pendingSync("task")).length, 0);
  assert.equal((await f.shells.pendingSync("task", [entry.id])).length, 1);
  const task = { type: "shell", id: "owned", command: f.args.command, status, attachmentMode: "attached",
    executionMode: "background", startedAt: running.startedAt, completedAt: new Date().toISOString() };
  const evidence = { stopId: "stop", endEventId: "real-idle", observedAt: new Date().toISOString() };
  for (const patch of [{ id: "other" }, { status: "running" }, { status: "cancelled" },
    { attachmentMode: "detached" }, { startedAt: "2000-01-01T00:00:00Z" }, { startedAt: "2100-01-01T00:00:00Z" }]) {
    await assert.rejects(f.shells.interrupted(entry.id, nativeOutcome({ ...task, ...patch }), evidence), /live invocation/);
  }
  Object.assign(running, task);
  await f.shells.interrupted(entry.id, nativeOutcome(task), evidence);
  const result = (await f.shells.read()).nativeSessions[0];
  assert.equal(result.status, status); assert.equal(result.exitCode, exitCode);
  assert.equal(result.interruption.nativeStatus, status);
  assert.equal((await new HumanLoopNativeShells(f.options).read()).nativeSessions[0].interruption.nativeStatus, status);
});

for (const order of ["binding-first", "refresh-first", "exit-first"]) for (const registryStatus of ["completed", "failed"])
  for (const exitCode of [0, 1]) test(`native exit ${exitCode} supersedes lifecycle ${registryStatus} (${order})`, async t => {
    const f = await fixture(t);
    const admission = await f.shells.admit("powershell", f.args, f.packet, "late-exit");
    const task = f.start(admission), notification = exitNotification(exitCode);
    if (order === "binding-first") {
      task.status = registryStatus; task.completedAt = new Date().toISOString();
    }
    await f.shells.settled(admission, f.complete(), true);
    if (order === "exit-first") {
      await f.shells.observe(notification);
      f.shells.setStopHandler(async () => assert.fail("Recorded exits cannot be cancelled."), () => true);
      const [row] = (await f.shells.read()).nativeSessions;
      assert.equal(row.status, exitCode === 0 ? "completed" : "failed");
      assert.equal(row.endedAt, notification.timestamp);
      assert.equal(row.canStop, false, "A stale running registry row cannot override the concrete exit.");
    }
    task.status = registryStatus; task.completedAt ??= new Date().toISOString();
    await f.shells.refreshTasks("task");
    if (order !== "exit-first") {
      const [before] = await f.shells.evidenceForCycle(null);
      assert.equal(before.status, registryStatus); assert.equal(before.exitCode, null);
      await assert.rejects(f.shells.assertAutomaticOutput(notification), /settled shell/);
      await f.shells.observe(notification);
    }
    await f.shells.observe(structuredClone(notification));
    assert.equal(await f.shells.automaticOutputBinding(notification), admission.entryId);
    const [saved] = await f.shells.evidenceForCycle(null);
    assert.equal(saved.status, exitCode === 0 ? "completed" : "failed");
    assert.equal(saved.exitCode, exitCode); assert.equal(saved.nativeStartedAt, task.startedAt);
    const [display] = (await f.shells.read()).nativeSessions;
    assert.equal(display.status, saved.status); assert.equal(display.canStop, false);
    const [reloaded] = await new HumanLoopNativeShells(f.options).evidenceForCycle(null);
    assert.deepEqual(reloaded, saved);
    await assert.rejects(f.shells.observe({ ...notification, id: "different-event" }), /identity changed/);
    await assert.rejects(f.shells.observe({ ...notification, sessionId: "foreign" }), /different private session/);
    await f.shells.observe({ ...notification, data: { kind: { ...notification.data.kind, shellId: "foreign" } } });
    assert.deepEqual(await f.shells.evidenceForCycle(null), [saved]);
  });

test("tool settlement cannot replace a bound shell generation or notification identity", async t => {
  const f = await fixture(t);
  const launch = await f.shells.admit("powershell", f.args, f.packet, "bound-launch");
  f.start(launch);
  await f.shells.settled(launch, f.complete(), true);
  const read = await f.shells.admit("read_powershell", { shellId: "owned", delay: 0 }, f.packet, "bound-read");
  for (const admission of [launch, read]) {
    const before = await f.shells.evidenceForCycle(null);
    await assert.rejects(f.shells.settled(admission,
      f.complete(true, [{ type: "shell_exit", shellId: "foreign", exitCode: 1 }]), true), /binding|another shell/);
    assert.deepEqual(await f.shells.evidenceForCycle(null), before);
  }
  await f.shells.observe(exitNotification(1));
  const before = await f.shells.evidenceForCycle(null);
  await assert.rejects(f.shells.settled(launch,
    f.complete(true, [{ type: "shell_exit", shellId: "foreign", exitCode: 1 }]), true), /binding/);
  assert.deepEqual(await new HumanLoopNativeShells(f.options).evidenceForCycle(null), before);
});

for (const source of ["notification", "tool"]) for (const order of ["interruption-first", "exit-first"])
  for (const nativeStatus of ["completed", "failed", "cancelled"]) for (const exitCode of [0, 1])
    test(`${source} exit ${exitCode} retains ${nativeStatus} interruption evidence (${order})`, async t => {
      const f = await fixture(t);
      const admission = await f.shells.admit("powershell", { ...f.args, mode: "sync" }, f.packet, "interrupted-exit");
      const task = f.start(admission);
      await f.shells.settled(admission, f.complete(), true);
      const notification = exitNotification(exitCode);
      const exit = () => source === "notification" ? f.shells.observe(notification)
        : f.shells.settled(admission, f.complete(true, [{ type: "shell_exit", shellId: "owned", exitCode }]), true);
      if (order === "exit-first") await exit();
      task.status = nativeStatus; task.completedAt = new Date().toISOString();
      const evidence = { stopId: "stop", endEventId: "real-idle", observedAt: new Date().toISOString() };
      if (order === "exit-first" && nativeStatus === "cancelled") {
        const before = await f.shells.evidenceForCycle(null);
        await assert.rejects(f.shells.interrupted(admission.entryId, nativeOutcome(task), evidence), /live invocation/);
        assert.deepEqual(await new HumanLoopNativeShells(f.options).evidenceForCycle(null), before);
        return;
      }
      await f.shells.interrupted(admission.entryId, nativeOutcome(task), evidence);
      await exit();
      const [saved] = await f.shells.evidenceForCycle(null);
      assert.equal(saved.status, nativeStatus === "cancelled" ? "stopped" : exitCode === 0 ? "completed" : "failed");
      assert.equal(saved.exitCode, exitCode); assert.equal(saved.interruption.nativeStatus, nativeStatus);
      assert.deepEqual(await new HumanLoopNativeShells(f.options).evidenceForCycle(null), [saved]);
      assert.equal((await f.shells.read()).nativeSessions[0].status, saved.status);
      if (source === "notification") await f.shells.assertAutomaticOutput(notification);
    });

for (const first of ["notification", "tool"]) for (const exitCode of [0, 1])
  test(`concrete ${first} exit ${exitCode} rejects contradictory tool and notification exits`, async t => {
    const f = await fixture(t);
    const admission = await f.shells.admit("powershell", f.args, f.packet, "concrete-exit");
    await f.shells.settled(admission, f.complete(), true);
    // Legacy notifications without an event ID still carry concrete exit evidence.
    const { id, ...notification } = exitNotification(exitCode);
    const toolExit = code => f.complete(true, [{ type: "shell_exit", shellId: "owned", exitCode: code }]);
    if (first === "notification") await f.shells.observe(notification);
    else await f.shells.settled(admission, toolExit(exitCode), true);
    const before = await f.shells.evidenceForCycle(null);
    for (const contradictory of exitCode === 0 ? [1] : [0, 2]) {
      await assert.rejects(f.shells.observe({ ...notification,
        data: { kind: { ...notification.data.kind, exitCode: contradictory } } }), /conflicts/);
      await assert.rejects(f.shells.settled(admission, toolExit(contradictory), true), /conflicts/);
      assert.deepEqual(await f.shells.evidenceForCycle(null), before);
    }
    await f.shells.observe(notification);
    await f.shells.settled(admission, toolExit(exitCode), true);
    assert.equal((await new HumanLoopNativeShells(f.options).read()).nativeSessions[0].exitCode, exitCode);
  });
