import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { WorkflowCommandRunner, workflowCommandTools, humanLoopCommandTools } from "../src/workflow-command-runner.mjs";
import { DEFAULT_POLICY, policyHash } from "../runtime-src/domain/workflow/policy.ts";
import { encodeRecord } from "../runtime-src/domain/workflow/foundation-storage.ts";
import { closeHostStateWal } from "../runtime-src/domain/host-state-wal.ts";

test("Reviewer retains process evidence retrieval but cannot execute or control runtime processes", async () => {
  let calls = 0;
  const runner = { read: async () => { calls++; return { apps: [], commands: [] }; } };
  const tools = humanLoopCommandTools(runner, DEFAULT_POLICY);
  const context = { task: { schemaVersion: "human-loop-task/v1", binding: { role: "reviewer" } },
    signal: new AbortController().signal, validatePaths() {} };
  for (const tool of tools) {
    if (tool.name === "read_workflow_apps") {
      assert.ok(tool.roles.includes("reviewer"));
      assert.deepEqual(JSON.parse(await tool.execute({}, context)), { apps: [], commands: [] });
    } else {
      assert.equal(tool.roles.includes("reviewer"), false, tool.name);
      await assert.rejects(tool.execute({}, context), /Reviewer may inspect/);
    }
  }
  assert.equal(calls, 1);
});

async function fixture(t, { human = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), "workflow-command-"));
  const source = join(root, "source");
  await mkdir(source);
  const owner = human ? {
    schemaVersion: "human-loop-owner/v1", id: "owner", mainSessionId: "main", privateSessionId: "private",
    workspacePath: source, policy: DEFAULT_POLICY,
  } : {
    ownerId: "owner", mainSessionId: "main", privateSessionId: "private", repositoryId: "repo",
    worktreePath: source, targetWorktreePath: join(root, "target"), policy: DEFAULT_POLICY,
  };
  const runner = new WorkflowCommandRunner({ owner, runtimeDirectory: join(root, "runtime"), nodeExecutable: process.execPath });
  const task = { taskId: "agent", coordination: { kind: "agent" }, assessmentOnly: { scope: ["read-only-project"] }, approval: null };
  const context = { owner, task, toolCallId: "call", signal: new AbortController().signal, validatePaths() {} };
  t.after(async () => {
    await runner.close();
    try { await closeHostStateWal(owner.targetWorktreePath ?? owner.workspacePath); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    await rm(root, { recursive: true, force: true });
  });
  return { root, source, owner, runner, context };
}

test("finite commands report actual exit status and bounded output without shell interpolation", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.source, "check.mjs"), "console.log(process.argv[2]); process.exitCode = 7;\n");
  const literal = "value & not-a-shell-command";
  const result = await f.runner.run({ command: "node", args: ["check.mjs", literal] }, f.context);
  assert.equal(result.status, "failed");
  assert.equal(result.exitCode, 7);
  assert.match(result.output, /value & not-a-shell-command/);
  assert.equal(await readFile(join(f.source, "check.mjs"), "utf8"), "console.log(process.argv[2]); process.exitCode = 7;\n");
  const replay = await f.runner.run({ command: "node", args: ["check.mjs", literal] }, f.context);
  assert.equal(replay.id, result.id);
});

test("installed npm runs a local dependency-free check through the pinned Node entrypoint", { skip: process.platform !== "win32", timeout: 20_000 }, async (t) => {
  const f = await fixture(t);
  await mkdir(join(f.source, "tank-game"));
  for (const path of ["answer.mjs", "tank-game/engine.mjs", "tank-game/app.mjs"]) {
    await writeFile(join(f.source, path), "export const fixture = true;\n");
  }
  await writeFile(join(f.source, "package.json"), JSON.stringify({ name: "local-check-fixture", version: "1.0.0", private: true,
    scripts: { check: "node --check answer.mjs && node --check tank-game/engine.mjs && node --check tank-game/app.mjs" } }));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const result = await f.runner.run({ command: "npm", args: ["run", "check"] }, { ...f.context, signal: controller.signal });
    assert.equal(result.status, "completed", JSON.stringify(result));
    assert.equal(result.exitCode, 0);
    assert.match(result.output, /node --check answer/);
  } finally { clearTimeout(timer); }
});

test("Windows npm.cmd uses the pinned JavaScript CLI rather than spawning a batch file", { skip: process.platform !== "win32", timeout: 20_000 }, async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.source, "package.json"), JSON.stringify({ name: "alias-check-fixture", version: "1.0.0", private: true,
    scripts: { check: "node --check check.mjs" } }));
  await writeFile(join(f.source, "check.mjs"), "export const checked = true;\n");
  const result = await f.runner.run({ command: "npm.cmd", args: ["run", "check"] }, f.context);
  assert.equal(result.status, "completed", JSON.stringify(result));
  assert.equal(result.exitCode, 0);
  const npm = await f.runner.validateCommand({ command: "npm", args: [] });
  for (const command of ["npm.cmd", "NPM.CMD", "npx.cmd"]) {
    const resolved = await f.runner.validateCommand({ command, args: [] });
    assert.equal(resolved.executable.file, process.execPath);
    assert.match(resolved.executable.prefix[0], /(?:npm|npx)-cli\.js$/);
  }
  assert.equal(npm.executable.prefix.length, 1);
});

test("unsupported batch launch is rejected during read-only preflight before permission or process creation", async (t) => {
  const f = await fixture(t);
  const tools = workflowCommandTools(f.runner, DEFAULT_POLICY);
  for (const name of ["run_workflow_command", "start_workflow_app"]) {
    const tool = tools.find((tool) => tool.name === name);
    for (const command of ["fixture.cmd", "fixture.BAT", "fixture.ps1", join(f.source, "fixture.cmd")]) {
      await assert.rejects(tool.validate({ command, args: ["literal & not interpolated"] }), /launch is unsupported/);
    }
  }
  assert.deepEqual((await f.runner.read()).commands, []);
  assert.deepEqual((await f.runner.read()).apps, []);
});

test("an existing app can keep running after its launch tool finishes and can be stopped by its owned ID", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.source, "server.mjs"),
    "import {createServer} from 'node:http';createServer((_q,r)=>r.end('ready')).listen(Number(process.env.PORT),'127.0.0.1');\n");
  const result = await f.runner.start({ command: "node", args: ["server.mjs"], port: 0 }, f.context);
  assert.equal(result.status, "running");
  assert.match(result.url, /^http:\/\/127\.0\.0\.1:\d+\//);
  assert.equal(await (await fetch(result.url)).text(), "ready");
  const listed = await f.runner.read();
  assert.equal(listed.apps.find(({ id }) => id === result.id).status, "running");
  const stopped = await f.runner.stop(result.id);
  assert.equal(stopped.status, "stopped");
  await assert.rejects(fetch(result.url));
  await assert.rejects(f.runner.stop("unowned-id"), /owned|unknown/i);
});

test("only static-preview registration is removed from both command tool surfaces", () => {
  const expected = ["run_workflow_command", "start_workflow_app", "read_workflow_apps", "stop_workflow_app"];
  for (const build of [workflowCommandTools, humanLoopCommandTools]) {
    const tools = build({}, DEFAULT_POLICY);
    assert.deepEqual(tools.map(({ name }) => name), expected);
    assert.equal(tools.some(({ name }) => name === "serve_workflow_app"), false);
  }
  assert.equal(WorkflowCommandRunner.prototype.serve, undefined);
});

test("permissions remain mandatory for execution tools, and Review cannot acquire them", async (t) => {
  const f = await fixture(t);
  const tools = workflowCommandTools(f.runner, DEFAULT_POLICY);
  for (const name of ["run_workflow_command", "start_workflow_app", "stop_workflow_app"]) {
    assert.equal(tools.find((tool) => tool.name === name).requiresPermission, true);
  }
  const run = tools.find(({ name }) => name === "run_workflow_command");
  await assert.rejects(run.execute({ command: "node", args: ["--version"] }, {
    ...f.context, task: { ...f.context.task, coordination: undefined, review: {} },
  }), /Agent|Implementation|role/i);
  await assert.rejects(f.runner.run({ command: "node", args: ["--version"], cwd: ".." }, f.context), /workspace|directory/i);
});

test("failed startup is visible and never claimed as a running app", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.source, "bad.mjs"), "console.error('startup failed'); process.exit(3);\n");
  const result = await f.runner.start({ command: "node", args: ["bad.mjs"], port: 0 }, f.context);
  assert.equal(result.status, "failed");
  assert.equal(result.exitCode, 3);
  assert.equal(result.url, null);
  assert.match(result.output, /startup failed/);
});

test("invalid readiness targets are rejected before any process is launched", async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.runner.start({
    command: "node", args: ["--version"], readinessPath: "https://external.invalid/", port: 0,
  }, f.context), /readiness|loopback/i);
  assert.equal((await f.runner.read()).apps.length, 0);
});

for (const human of [false, true]) test(`historical ${human ? "human-loop" : "workflow"} static-preview entries remain readable without adopting a server`, async (t) => {
  const f = await fixture(t, { human });
  const directory = join(f.root, "runtime", "commands");
  await mkdir(directory, { recursive: true });
  const record = { schemaVersion: human ? "human-loop-commands/v1" : "workflow-commands/v1", ownerDigest: policyHash(f.owner), entries: [
    { id: "old-stopped-preview", mode: "static", status: "stopped", command: "Serve index.html", pid: null,
      url: null, exitCode: null, output: "", reason: null, startedAt: "2026-09-10T00:00:00Z", endedAt: "2026-09-10T00:01:00Z" },
    { id: "old-unowned-preview", mode: "static", status: "running", command: "Serve old.html", pid: null,
      url: "http://127.0.0.1:1/", exitCode: null, output: "", reason: null, startedAt: "2026-09-10T00:00:00Z", endedAt: null },
  ] };
  await writeFile(join(directory, "commands.json"), encodeRecord(record));
  const history = await f.runner.read();
  assert.deepEqual(history.apps.map(({ id, mode, status, canStop }) => ({ id, mode, status, canStop })), [
    { id: "old-stopped-preview", mode: "static", status: "stopped", canStop: false },
    { id: "old-unowned-preview", mode: "static", status: "held", canStop: false },
  ]);
  assert.match(history.apps[1].reason, /will not be adopted or killed/);
  await assert.rejects(f.runner.stop("old-unowned-preview"), /No live owned process handle/);
  await f.runner.stopAll();
  assert.deepEqual(await f.runner.read(), history);
});

test("aborting a finite command stops only its owned child and keeps the result explicit", { timeout: 15000 }, async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.source, "wait.mjs"), "setInterval(()=>{},1000);\n");
  const controller = new AbortController();
  const pending = f.runner.run({ command: "node", args: ["wait.mjs"] }, { ...f.context, signal: controller.signal });
  while (!(await f.runner.read()).commands.some(({ status }) => status === "running")) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  controller.abort();
  const result = await pending;
  assert.equal(result.status, "stopped");
});
