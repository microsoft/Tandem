import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile, writeFile, rm, lstat, link } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { HumanLoopNativeWriter } from "../src/human-loop-native-writer.mjs";
import { HumanLoopNativeShells } from "../src/human-loop-native-shells.mjs";
import { HostStateFile } from "../runtime-src/domain/host-state-file.ts";
import { closeHostStateWal } from "../runtime-src/domain/host-state-wal.ts";
import { DEFAULT_POLICY, policyHash } from "../runtime-src/domain/workflow/policy.ts";
import { encodeRecord, decodeRecord } from "../runtime-src/domain/workflow/foundation-storage.ts";

const recovery = { id: "explicit-recovery", nativeEvidenceDigest: "a".repeat(64) };
const moduleUrl = (...segments) => pathToFileURL(resolve(import.meta.dirname, "..", ...segments)).href;
async function fixture(t) {
  const root = resolve(`.native-writer-${randomUUID()}`), runtime = join(root, ".tandem", "runtime");
  await mkdir(join(runtime, "native-shells"), { recursive: true });
  const owner = { schemaVersion: "human-loop-owner/v1", id: "owner", mainSessionId: "main",
    privateSessionId: "private", workspacePath: root, policy: DEFAULT_POLICY };
  const writers = [];
  const writer = (identity = owner) => {
    const value = new HumanLoopNativeWriter(identity, runtime); writers.push(value); return value;
  };
  const document = new HostStateFile(root, join(runtime, "native-shells", "sessions.json"));
  const receipt = new HostStateFile(root, join(runtime, "native-shells", "writer-reconciliation.json"));
  const content = encodeRecord({ schemaVersion: "human-loop-native-shells/v1", ownerDigest: policyHash(owner), entries: [] });
  t.after(async () => { for (const value of writers) value.close(); await closeHostStateWal(root);
    await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); });
  return { root, runtime, owner, writer, document, receipt, content, lock: join(runtime, "native-shells", ".writer-lock") };
}

async function childWriter(f, legacy) {
  const source = legacy
    ? `import { FoundationStorage } from ${JSON.stringify(moduleUrl("runtime-src", "domain", "workflow", "foundation-storage.ts"))};
       const storage = new FoundationStorage(${JSON.stringify(join(f.runtime, "native-shells"))},undefined,owner.policy,{workspaceRoot:owner.workspacePath});
       await storage.acquireWriter(); await storage.mutate("sessions.json","seed",()=>({content,result:null}));`
    : `import { HumanLoopNativeWriter } from ${JSON.stringify(moduleUrl("src", "human-loop-native-writer.mjs"))};
       const storage = new HumanLoopNativeWriter(owner,${JSON.stringify(f.runtime)});
       await storage.mutate(undefined,content);`;
  const child = spawn(process.execPath, ["--input-type=module", "--eval",
    `const owner=${JSON.stringify(f.owner)}, content=${JSON.stringify(f.content)};${source}
     console.log("READY"); setInterval(()=>{},10000);`], { stdio: ["ignore", "pipe", "pipe"] });
  let output = "", errors = "";
  child.stderr.on("data", data => { errors += data; });
  await new Promise((resolve, reject) => {
    child.stdout.on("data", data => { output += data; if (output.includes("READY")) resolve(); });
    child.once("error", reject);
    child.once("exit", (code, signal) => reject(new Error(`Writer exited before ready: ${code}/${signal}: ${errors}`)));
  });
  return { child, stop: async () => { const ended = once(child, "close"); child.kill("SIGKILL"); await ended; } };
}

test("real legacy writer crash recovers exact journal before first native admission without modifying old lock", async t => {
  const f = await fixture(t), process = await childWriter(f, true);
  const bytes = await readFile(f.lock), before = await lstat(f.lock);
  await process.stop();
  const shells = new HumanLoopNativeShells({ owner: f.owner, runtimeDirectory: f.runtime,
    workspace: { protectedIndexDigest: async () => "b".repeat(64), inspectNativePath: async () => {} },
    legacy: { read: async () => ({ apps: [], commands: [] }), close: async () => {} } });
  t.after(() => shells.releaseWriter());
  await shells.prepareWriter(recovery);
  const admission = await shells.admit("powershell", { shellId: "new-command", command: "node --version" },
    { binding: { id: "task", role: "agent", requestId: "request", cycleId: null } }, "call");
  await shells.settled(admission, { timestamp: new Date().toISOString(), data: { success: false } });
  assert.equal(decodeRecord(await f.document.read()).entries[0].status, "failed");
  assert.deepEqual(await readFile(f.lock), bytes);
  assert.equal((await lstat(f.lock)).ino, before.ino);
  const proof = JSON.parse(await f.receipt.read());
  assert.equal(proof.ownerDigest, policyHash(f.owner)); assert.deepEqual(proof.recovery, recovery);
  await shells.close();
});

test("lifetime OS WAL lease refuses another live process and supported recovery reacquires after its crash", async t => {
  const f = await fixture(t), process = await childWriter(f, false);
  try { await assert.rejects(f.writer().prepare(f.content, recovery), /exclusive workspace writer|locked/); }
  finally { await process.stop(); }
  const writer = f.writer();
  await writer.prepare(f.content, recovery);
  await writer.mutate(f.content, f.content);
  assert.equal(await writer.read(), f.content);
});

test("two local instances cannot alternate journal mutation and a released WAL generation cannot silently reacquire", async t => {
  const f = await fixture(t), first = f.writer(), other = f.writer();
  await first.mutate(undefined, f.content);
  await assert.rejects(other.prepare(f.content, recovery), /live runtime writer/);
  await closeHostStateWal(f.root);
  await assert.rejects(first.mutate(f.content, f.content), /generation changed/);
  first.close();
  await other.prepare(f.content, recovery);
  await other.mutate(f.content, f.content);
});

test("live legacy PID, malformed lock and wrong original session never establish reconciliation", async t => {
  const f = await fixture(t);
  await f.document.transact("seed", () => ({ content: f.content, result: null }));
  await writeFile(f.lock, JSON.stringify({ schemaVersion: "workflow-foundation-lock/v1", token: randomUUID(), pid: process.pid }));
  await assert.rejects(f.writer().prepare(f.content, recovery), /live or its liveness/);
  await writeFile(f.lock, "{}");
  await assert.rejects(f.writer().prepare(f.content, recovery), /identity is invalid/);
  await rm(f.lock);
  const first = f.writer();
  await first.prepare(f.content, recovery); first.close();
  await assert.rejects(f.writer({ ...f.owner, privateSessionId: "foreign" }).prepare(f.content, recovery),
    /ownership or retained lock changed/);
  assert.equal(await f.document.read(), f.content);
});

test("changed legacy lock between inspection and claim rolls back durable receipt and releases local claim", async t => {
  const f = await fixture(t), process = await childWriter(f, true);
  await process.stop();
  const original = await readFile(f.lock, "utf8"), write = HostStateFile.prototype.write;
  HostStateFile.prototype.write = async function(cause, content) {
    await write.call(this, cause, content);
    if (this.path === f.receipt.path) await writeFile(f.lock, original.replace(JSON.parse(original).token, randomUUID()));
  };
  try { await assert.rejects(f.writer().prepare(f.content, recovery), /replaced during reconciliation/); }
  finally { HostStateFile.prototype.write = write; }
  assert.equal(await f.receipt.read(), undefined);
  assert.equal(await f.document.read(), f.content);
  await writeFile(f.lock, original);
  await f.writer().prepare(f.content, recovery);
});

test("legacy lock replacement after claim and during mutation cannot publish changed journal", async t => {
  const f = await fixture(t), process = await childWriter(f, true);
  await process.stop();
  const writer = f.writer();
  await writer.prepare(f.content, recovery);
  const original = await readFile(f.lock, "utf8"), write = HostStateFile.prototype.write;
  HostStateFile.prototype.write = async function(cause, content) {
    await write.call(this, cause, content);
    if (this.path === f.document.path) await writeFile(f.lock, original.replace(JSON.parse(original).token, randomUUID()));
  };
  try { await assert.rejects(writer.mutate(f.content, '{"changed":true}'), /ownership or retained lock changed/); }
  finally { HostStateFile.prototype.write = write; }
  assert.equal(await f.document.read(), f.content);
  await assert.rejects(writer.mutate(f.content, f.content), /ownership or retained lock changed/);
});

test("historical shell without required same-session foreground recovery proof cannot become Ready", async t => {
  const f = await fixture(t), entry = { id: "native:old", sessionId: "private", shellId: "old", command: "node app.mjs",
    mode: "async", status: "running", exitCode: null, taskId: "task", requestId: "request", cycleId: null,
    toolCallId: "old", startedAt: new Date().toISOString(), endedAt: null, reason: null };
  await f.document.transact("seed", () => ({ content: encodeRecord({ ...decodeRecord(f.content), entries: [entry] }), result: null }));
  const shells = new HumanLoopNativeShells({ owner: f.owner, runtimeDirectory: f.runtime, workspace: {}, legacy: {} });
  await assert.rejects(shells.prepareWriter(recovery), /exact same-session history/);
  assert.equal(await f.receipt.read(), undefined);
});

for (const legacy of [false, true]) test(`real ${legacy ? "legacy" : "current"} writer crash permits retirement without asserting its historical app exited`, async t => {
  const f = await fixture(t), entry = { id: "native:old", sessionId: "private", shellId: "old", command: "node app.mjs",
    mode: "async", status: "running", exitCode: null, taskId: "task", requestId: "request", cycleId: null,
    toolCallId: "old", startedAt: new Date().toISOString(), endedAt: null, reason: null };
  f.content = encodeRecord({ ...decodeRecord(f.content), entries: [entry] });
  const process = await childWriter(f, legacy);
  const lock = legacy ? await readFile(f.lock) : null;
  await process.stop();
  const shells = new HumanLoopNativeShells({ owner: f.owner, runtimeDirectory: f.runtime,
    workspace: {}, legacy: { read: async () => ({ apps: [], commands: [] }), close: async () => {} } });
  t.after(() => shells.releaseWriter());
  const evidence = { schemaVersion: "native-control-evidence/v1", sessionId: "private",
    historyDigest: recovery.nativeEvidenceDigest, observedAt: new Date().toISOString(),
    registryScope: "current-runtime-not-process-exit-proof", mode: "interactive", processing: false, hasActiveWork: false,
    queue: { items: 0, steeringMessages: 0, inFlightSteeringCount: 0 }, tasks: [],
    taskDiagnostics: { state: "observed", reason: null } };
  await shells.prepareWriter(recovery, evidence);
  const { controlRetirement, ...preserved } = decodeRecord(await f.document.read()).entries[0];
  assert.deepEqual(preserved, entry);
  assert.equal(controlRetirement.previousGeneration.writerClaim === null, legacy);
  assert.equal(controlRetirement.previousGeneration.legacyLockDigest === null, !legacy);
  if (legacy) assert.deepEqual(await readFile(f.lock), lock);
  assert.equal((await shells.read()).nativeSessions[0].canStop, false);
  await shells.close();
});

test("unknown process liveness and aliased retained locks remain fenced without writing reconciliation", async t => {
  const f = await fixture(t);
  await f.document.transact("seed", () => ({ content: f.content, result: null }));
  await writeFile(f.lock, JSON.stringify({ schemaVersion: "workflow-foundation-lock/v1", token: randomUUID(), pid: process.pid }));
  const kill = process.kill;
  process.kill = () => { throw Object.assign(new Error("Liveness denied"), { code: "EPERM" }); };
  try { await assert.rejects(f.writer().prepare(f.content, recovery), /liveness is unverified/); }
  finally { process.kill = kill; }
  await link(f.lock, `${f.lock}.alias`);
  await assert.rejects(f.writer().prepare(f.content, recovery), /aliased or invalid/);
  assert.equal(await f.receipt.read(), undefined);
});

test("a foreign saved journal cannot be reconciled under the new session even without an existing receipt", async t => {
  const f = await fixture(t);
  await f.document.transact("seed", () => ({ content: f.content, result: null }));
  const shells = new HumanLoopNativeShells({ owner: { ...f.owner, privateSessionId: "foreign" },
    runtimeDirectory: f.runtime, workspace: {}, legacy: {} });
  await assert.rejects(shells.prepareWriter(recovery), /ownership journal is invalid/);
  assert.equal(await f.receipt.read(), undefined);
});

test("an explicit recovery receipt cannot hide deletion or same-byte inode replacement of the retained lock", async t => {
  const f = await fixture(t), process = await childWriter(f, true);
  await process.stop();
  const writer = f.writer(), bytes = await readFile(f.lock);
  await writer.prepare(f.content, recovery);
  await writeFile(`${f.lock}.new`, bytes);
  await rm(f.lock);
  await assert.rejects(writer.mutate(f.content, f.content), /ownership or retained lock changed/);
  await link(`${f.lock}.new`, f.lock);
  await rm(`${f.lock}.new`);
  await assert.rejects(writer.mutate(f.content, f.content), /ownership or retained lock changed/);
  assert.equal(await f.document.read(), f.content);
});
