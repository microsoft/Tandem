import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { discoverSetupConfiguration } from "../src/workflow-setup-discovery.mjs";
import { parseRuntimeEnrollmentConfiguration } from "../src/workflow-runtime-enrollment.mjs";
import { ProjectPolicyStore } from "../runtime-src/domain/workflow/project-policy-store.ts";
import { DEFAULT_POLICY } from "../runtime-src/domain/workflow/policy.ts";
import { closeHostStateWal } from "../runtime-src/domain/host-state-wal.ts";

const git = async (root, ...args) => (await promisify(execFile)("git", ["-C", root, ...args])).stdout.trim();
const hash = (value) => createHash("sha256").update(value).digest("hex");

async function fixture(t, { ignored = true, committed = true } = {}) {
  const root = resolve(`.setup-discovery-test-${randomUUID()}`);
  const project = join(root, "project"), tools = join(root, "tools");
  t.after(async () => { await closeHostStateWal(project); await rm(root, { recursive: true, force: true }); });
  await mkdir(project, { recursive: true }); await mkdir(tools);
  await git(project, "init", "--quiet");
  await git(project, "config", "core.autocrlf", "false");
  await writeFile(join(project, "app.txt"), "committed application\n");
  if (ignored) await writeFile(join(project, ".gitignore"), ".tandem/\n");
  if (committed) {
    await git(project, "add", ".");
    await git(project, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
      "commit", "--quiet", "-m", "Initial application");
  }
  const sdkModulePath = join(tools, "index.mjs"), cliPath = join(tools, "copilot.exe");
  await writeFile(sdkModulePath, 'var COPILOT_CLI_VERSION = "1.0.83";\nthrow new Error("Discovery must never import the SDK");\n');
  await writeFile(cliPath, "Installed CLI fixture; never executed.");
  const attachedSession = {
    sessionId: "main", rpc: {
      mode: { get: async () => "interactive" },
      metadata: { isProcessing: async () => ({ processing: false }), activity: async () => ({ hasActiveWork: false }) },
      queue: { pendingItems: async () => ({ items: [], steeringMessages: [] }) },
    }, send: () => assert.fail("Discovery must never send a main-session message."),
  };
  const options = {
    repositoryRoot: project, mainSessionId: "main", attachedSession, sdkModulePath, cliPath,
    managedRoot: join(root, "managed"), nodePath: process.execPath, environment: {},
  };
  return { root, project, tools, options, attachedSession, discover: (extra = {}) => discoverSetupConfiguration({ ...options, ...extra }) };
}

test("discovery reads actual Git, policy and file identities without importing SDK, creating paths or changing legacy Canvas state", async (t) => {
  const f = await fixture(t);
  const state = join(f.project, ".tandem", "living-canvas");
  await mkdir(join(state, "design"), { recursive: true });
  await writeFile(join(state, "living-context.json"),
    JSON.stringify({ schemaVersion: "living-context/v2", messages: [], requests: [], outcomes: [], activeRuns: [] }));
  await writeFile(join(state, "design", "existing.txt"), "Existing Design remains unchanged.");
  const before = await readdir(f.root, { recursive: true });
  const configuration = await f.discover();
  assert.deepEqual(parseRuntimeEnrollmentConfiguration(configuration), configuration);
  assert.equal(configuration.baseCommit, await git(f.project, "rev-parse", "HEAD"));
  assert.equal(configuration.owner.mainSessionId, "main");
  assert.equal(configuration.owner.targetWorktreePath, f.project);
  assert.notEqual(configuration.owner.privateSessionId, "main");
  assert.deepEqual(configuration.owner.policy, DEFAULT_POLICY);
  for (const binding of [configuration.sdk, configuration.cli, configuration.node]) {
    assert.equal(binding.digest, hash(await readFile(binding.modulePath ?? binding.path)));
  }
  assert.match(configuration.buildId, /1\.0\.83/);
  assert.notEqual(configuration.runtimeDirectory, configuration.owner.worktreePath);
  assert.ok(configuration.runtimeDirectory.startsWith(f.options.managedRoot));
  assert.ok(configuration.owner.worktreePath.startsWith(f.options.managedRoot));
  assert.deepEqual(await readdir(f.root, { recursive: true }), before);
  assert.equal(await git(f.project, "status", "--porcelain"), "");
  assert.equal(await readFile(join(state, "design", "existing.txt"), "utf8"), "Existing Design remains unchanged.");
  const again = await f.discover({ previousConfiguration: configuration });
  assert.deepEqual(again, configuration, "Revalidation must reuse the same generated identities and paths.");
});

test("discovery honors the SDK-supported CLI environment override and never guesses a cached binary", async (t) => {
  const f = await fixture(t);
  const actual = await f.discover({ cliPath: undefined, environment: { COPILOT_CLI_PATH: f.options.cliPath } });
  assert.equal(actual.cli.path, f.options.cliPath);
  await assert.rejects(f.discover({ cliPath: undefined }), /COPILOT_CLI_PATH.*(?:installed|path)|(?:installed|path).*COPILOT_CLI_PATH/i);
  await assert.rejects(f.discover({ sdkModulePath: undefined }), /sdkModulePath|supplied.*SDK/i);
  assert.deepEqual(await readdir(f.root), ["project", "tools"]);
});

test("attached CLI executable and installed PATH Node are discovered without user configuration", async (t) => {
  const f = await fixture(t);
  const before = await readdir(f.root, { recursive: true });
  const actual = await f.discover({
    cliPath: undefined, nodePath: undefined,
    hostExecutable: f.options.cliPath,
    environment: { PATH: resolve(process.execPath, "..") },
  });
  assert.equal(actual.cli.path, f.options.cliPath);
  assert.equal(actual.node.path.toLowerCase(), process.execPath.toLowerCase());
  assert.deepEqual(await readdir(f.root, { recursive: true }), before);
});

test("automatic Node discovery ignores project-owned executables and reports a missing installation", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.project, process.platform === "win32" ? "node.exe" : "node"), "Never execute this project file.");
  await git(f.project, "add", ".");
  await git(f.project, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "Untrusted tool fixture");
  await assert.rejects(f.discover({
    nodePath: undefined, hostExecutable: f.options.cliPath, environment: { PATH: f.project },
  }), /Node 24.*not found on PATH/);
  const actual = await f.discover({
    nodePath: undefined, hostExecutable: f.options.cliPath,
    environment: { PATH: `${f.project}${process.platform === "win32" ? ";" : ":"}${resolve(process.execPath, "..")}` },
  });
  assert.equal(actual.node.path.toLowerCase(), process.execPath.toLowerCase());
});

test("a PATH junction with no Node executable does not block the later actual installation", async (t) => {
  const f = await fixture(t);
  const alias = join(f.root, "unrelated-tools-link");
  await symlink(f.tools, alias, process.platform === "win32" ? "junction" : "dir");
  const actual = await f.discover({
    cliPath: undefined, nodePath: undefined, hostExecutable: f.options.cliPath,
    environment: { PATH: `${alias}${process.platform === "win32" ? ";" : ":"}${resolve(process.execPath, "..")}` },
  });
  assert.equal(actual.node.path.toLowerCase(), process.execPath.toLowerCase());
  assert.equal(actual.cli.path, f.options.cliPath);
});

for (const [name, options, mutate, expected] of [
  ["uncommitted Git repository", { committed: false }, async () => {}, /committed.*HEAD|HEAD.*commit/i],
  ["dirty repository", {}, async (f) => writeFile(join(f.project, "app.txt"), "local edits"), /clean|dirty|uncommitted/i],
  ["missing .tandem exclusion", { ignored: false }, async () => {}, /\.tandem.*ignor|ignor.*\.tandem/i],
  ["wrong attached Session", {}, async (f) => { f.attachedSession.sessionId = "different"; }, /session.*(?:identity|owner)|attached.*session/i],
  ["wrong actual mode", {}, async (f) => { f.attachedSession.rpc.mode.get = async () => "autopilot"; }, /Interactive/i],
  ["queued main work", {}, async (f) => { f.attachedSession.rpc.queue.pendingItems = async () => ({ items: [{}], steeringMessages: [] }); }, /quiet|queued|idle/i],
  ["missing observation API", {}, async (f) => { delete f.attachedSession.rpc.metadata.activity; }, /observation|activity|API/i],
  ["missing actual CLI file", {}, async (f) => rm(f.options.cliPath), /CLI|file|missing/i],
  ["retained legacy operation", {}, async (f) => {
    await mkdir(join(f.project, ".tandem", "living-canvas"), { recursive: true });
    await writeFile(join(f.project, ".tandem", "living-canvas", "active-operation.json"), "{}");
  }, /legacy|retained|existing|reconcil/i],
  ["foreign provisioning evidence", {}, async (f) => {
    const runtime = join(f.project, ".tandem", "living-canvas", "workflow", "runtime");
    await mkdir(runtime, { recursive: true });
    await writeFile(join(runtime, "runtime-provisioning.json"), "{}");
  }, /existing|provision|reconcil/i],
  ["corrupt project policy", {}, async (f) => {
    const policy = join(f.project, ".tandem", "living-canvas", "policy");
    await mkdir(policy, { recursive: true }); await writeFile(join(policy, "project-policy.json"), "corrupt");
  }, /policy.*validat|recovery/i],
]) test(`discovery rejects ${name} without changing the project`, async (t) => {
  const f = await fixture(t, options);
  await mutate(f);
  const before = await readdir(f.root, { recursive: true });
  await assert.rejects(f.discover(), expected);
  assert.deepEqual(await readdir(f.root, { recursive: true }), before);
});

test("discovery reads selected project policy and detects changed policy and executable bytes on recheck", async (t) => {
  const f = await fixture(t);
  const configuration = await f.discover();
  const policy = new ProjectPolicyStore(f.project);
  await policy.acquireWriter();
  try { await policy.select({ time: { attemptMaximumMs: 240000 } }, "select-policy", 0); }
  finally { await policy.close(); }
  const changed = await f.discover({ previousConfiguration: configuration });
  assert.notEqual(changed.owner.policy.digest, configuration.owner.policy.digest);
  await writeFile(f.options.cliPath, "changed installed bytes");
  const binaries = await f.discover({ previousConfiguration: configuration });
  assert.notEqual(binaries.cli.digest, configuration.cli.digest);
  assert.equal(binaries.owner.privateSessionId, configuration.owner.privateSessionId);
});

test("discovery refuses an already-created managed location rather than adopting it", async (t) => {
  const f = await fixture(t);
  const configuration = await f.discover();
  await mkdir(configuration.owner.worktreePath, { recursive: true });
  await assert.rejects(f.discover({ previousConfiguration: configuration }), /exist|adopt|reconcil/i);
});
