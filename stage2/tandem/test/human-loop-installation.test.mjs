import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { HumanLoopInstallation, parseHumanLoopConfiguration } from "../src/human-loop-installation.mjs";
import { HostStateFile } from "../runtime-src/domain/host-state-file.ts";
import { getHostStateWal } from "../runtime-src/domain/host-state-wal.ts";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const git = async (cwd, ...args) => (await promisify(execFile)("git", ["-C", cwd, ...args])).stdout.trim();
async function fixture(t, { failOpen = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), "human-loop-installation-")), workspace = join(root, "project");
  const installed = join(root, "installed");
  await mkdir(workspace); await mkdir(installed);
  await git(workspace, "init", "--quiet");
  await writeFile(join(workspace, "app.js"), "baseline");
  await git(workspace, "add", ".");
  await git(workspace, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "Baseline");
  await writeFile(join(workspace, "app.js"), "pre-existing dirty work");
  const sdk = join(installed, "sdk.mjs"), cli = join(installed, "copilot.exe"), node = join(installed, "node.exe");
  for (const path of [sdk, cli, node]) await writeFile(path, "trusted installed fixture");
  let mode = "interactive", busy = false, clients = 0, starts = 0, closes = 0;
  const main = { sessionId: "main", rpc: {
    mode: { get: async () => mode }, metadata: {
      isProcessing: async () => ({ processing: false }), activity: async () => ({ hasActiveWork: false }),
    }, queue: { pendingItems: async () => ({ items: [], steeringMessages: [] }) },
  } };
  const installedValues = { sdk: { modulePath: sdk, digest: hash("trusted installed fixture") },
    cli: { path: cli, digest: hash("trusted installed fixture") }, node: { path: node, digest: hash("trusted installed fixture") }, buildId: "fixture" };
  const options = {
    workspacePath: workspace, mainSession: main,
    registration: { session: main, id: "registration", toolHook() {}, permissionHandler() {} },
    discoverRuntime: async () => installedValues, runtimeRoot: join(root, "runtime-data"),
    loadSdk: async () => ({
      RuntimeConnection: { forStdio: ({ path }) => ({ kind: "stdio", path }) },
      CopilotClient: class {
        constructor(input) { clients++; assert.equal(input.workingDirectory, workspace); assert.equal(input.connection.path, cli); }
      },
    }),
    createRuntime: async ({ configuration, verifyOwnership }) => ({
      sessionId: configuration.owner.privateSessionId,
      async open() {
        starts++; await verifyOwnership();
        const file = new HostStateFile(workspace, join(workspace, ".tandem", "living-canvas", "human-loop", "installation.json"));
        assert.equal(JSON.parse(await file.read()).phase, "creating");
        if (failOpen) throw new Error("Private open acknowledgement lost.");
      },
      async isBusy() { return busy; },
      async close() { closes++; await verifyOwnership(); },
    }),
  };
  const installation = new HumanLoopInstallation(options);
  t.after(async () => { await getHostStateWal(workspace).close(); await rm(root, { recursive: true, force: true }); });
  return { root, workspace, installation, options, sdk, main, setMode: (value) => { mode = value; }, setBusy: (value) => { busy = value; },
    counts: () => ({ clients, starts, closes }) };
}

test("new one-copy installation preserves dirty files and separates setup from live creation without another worktree", async (t) => {
  const f = await fixture(t);
  const config = await f.installation.prepare();
  assert.equal(config.schemaVersion, "human-loop-runtime/v1");
  assert.equal(config.owner.workspacePath, f.workspace);
  assert.equal(config.owner.worktreePath, undefined);
  assert.equal(config.owner.targetWorktreePath, undefined);
  assert.equal(config.baseCommit, undefined);
  assert.deepEqual(f.counts(), { clients: 0, starts: 0, closes: 0 });
  await assert.rejects(access(config.runtimeDirectory), { code: "ENOENT" });
  assert.equal(await readFile(join(f.workspace, "app.js"), "utf8"), "pre-existing dirty work");
  const runtime = await f.installation.open();
  assert.equal(await f.installation.open(), runtime);
  assert.deepEqual(f.counts(), { clients: 1, starts: 1, closes: 0 });
  assert.equal((await f.installation.read()).status, "ready");
  f.setBusy(true);
  assert.equal(await f.installation.guardMainTool({ toolName: "apply_patch" }), undefined);
  assert.equal(await f.installation.guardMainTool({ toolName: "ask_user" }), undefined);
  assert.equal(await f.installation.guardMainTool({ toolName: "functions.view" }), undefined);
  f.setBusy(false);
  assert.equal(await f.installation.guardMainTool({ toolName: "apply_patch" }), undefined);
  assert.equal((await git(f.workspace, "worktree", "list", "--porcelain")).split("\n").filter((line) => line.startsWith("worktree ")).length, 1);
  await f.installation.close();
  assert.equal((await f.installation.read()).status, "closed");
  await assert.rejects(f.installation.open(), /does not support retained-history recovery/);
});

test("changed installed runtime and missing hook receipt cannot create a private session", async (t) => {
  const f = await fixture(t);
  await f.installation.prepare();
  await writeFile(f.sdk, "changed runtime");
  await assert.rejects(f.installation.open(), /content changed/);
  assert.equal(f.counts().clients, 0);
  f.setMode("autopilot");
  await assert.rejects(f.installation.verifyOwnership(), /no live/);
  const missing = new HumanLoopInstallation({ ...f.options, registration: null });
  await assert.rejects(missing.prepare(), /hook\/permission receipt/);
  assert.equal(f.counts().clients, 0);
});

test("private installation never observes main mode, activity or queue as private readiness", async t => {
  const f = await fixture(t);
  f.main.rpc = new Proxy({}, { get: () => assert.fail("Main readiness is unrelated to the private runtime.") });
  await f.installation.open();
  await f.installation.verifyOwnership();
  assert.equal((await f.installation.read()).status, "ready");
  assert.deepEqual(f.counts(), { clients: 1, starts: 1, closes: 0 });
  f.setBusy(true);
  await f.installation.close();
  assert.equal(f.counts().closes, 1);
});

test("uncertain private creation is retained and cannot silently retry or manufacture a new owner", async (t) => {
  const f = await fixture(t, { failOpen: true });
  await assert.rejects(f.installation.open(), /acknowledgement lost/);
  const id = f.installation.configuration.owner.privateSessionId;
  assert.equal((await f.installation.read()).status, "unknown");
  await assert.rejects(f.installation.open(), /explicit Retry/);
  assert.equal(f.installation.configuration.owner.privateSessionId, id);
  assert.deepEqual(f.counts(), { clients: 1, starts: 1, closes: 0 });
});

test("old two-copy enrollment and existing journals fail visibly instead of becoming empty new-model state", async (t) => {
  const f = await fixture(t);
  const directory = join(f.workspace, ".tandem", "living-canvas", "workflow", "runtime");
  await mkdir(directory, { recursive: true });
  const old = JSON.stringify({ schemaVersion: "workflow-runtime-config/v1", owner: { worktreePath: "old-source", targetWorktreePath: f.workspace } });
  const path = join(directory, "runtime-enrollment.json");
  await writeFile(path, old);
  await assert.rejects(f.installation.prepare(), /Legacy runtime enrollment/);
  assert.equal(await readFile(path, "utf8"), old);
  assert.equal(f.counts().clients, 0);
  assert.throws(() => parseHumanLoopConfiguration(JSON.parse(old)), /exactly these fields|Incompatible/);
});

test("cold recovery rejects incompatible records and missing recovery capability without creating a replacement client", async (t) => {
  const f = await fixture(t);
  await f.installation.prepare();
  const file = new HostStateFile(f.workspace, join(f.workspace, ".tandem", "living-canvas", "human-loop", "installation.json"));
  const original = JSON.parse(await file.read());
  const save = (value) => file.mutate("fixture:installation", () => ({ content: JSON.stringify(value), result: null }));
  for (const phase of ["creating", "ready", "closing", "reopening", "recovering", "unknown"]) {
    await save({ ...original, phase });
    const cold = new HumanLoopInstallation(f.options);
    assert.equal((await cold.read()).status, "saved-state");
    await assert.rejects(cold.open(), /does not support retained-history recovery/);
  }
  await save({ ...original, schemaVersion: "human-loop-installation/v1", phase: "closed" });
  await assert.rejects(new HumanLoopInstallation(f.options).open(), /positively closed/);
  await save({ ...original, phase: "closed" });
  await assert.rejects(new HumanLoopInstallation(f.options).open(), /does not support retained-history recovery/);
  assert.equal(f.counts().clients, 0);
});

test("concurrent close remains single-writer even while private work is busy", async (t) => {
  const f = await fixture(t); await f.installation.open();
  f.setBusy(true);
  await Promise.all([f.installation.close(), f.installation.close()]);
  assert.equal(f.counts().closes, 1);
});

test("main-chat tools are independent of private work and unanswered Tandem questions", async t => {
  const f = await fixture(t), runtime = await f.installation.open();
  f.setBusy(true);
  runtime.state = async () => ({ questions: [{ state: "open" }] });
  for (const toolName of ["ask_user", "functions.ask_user", "main__ask_user", "apply_patch"]) {
    assert.equal(await f.installation.guardMainTool({ toolName }), undefined);
  }
  runtime.state = async () => assert.fail("Main tools must not depend on loading private state.");
  assert.equal(await f.installation.guardMainTool({ toolName: "ask_user" }), undefined);
});

test("actual Close failure stays unknown and retains the same runtime for an explicit retry", async t => {
  const f = await fixture(t), runtime = await f.installation.open();
  const close = runtime.close.bind(runtime);
  runtime.close = async () => {
    throw new Error("Native shutdown failed.");
  };
  await assert.rejects(f.installation.close(), /Native shutdown failed/);
  assert.equal((await f.installation.read()).status, "unknown");
  assert.equal(f.installation.runtime, runtime);
  await assert.rejects(f.installation.verifyOwnership(), /no live one-copy authority/);
  runtime.close = close;
  await f.installation.close();
  assert.equal((await f.installation.read()).status, "closed");
});
