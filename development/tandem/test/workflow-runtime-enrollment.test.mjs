import assert from "node:assert/strict";
import { link, mkdir, mkdtemp, readFile as readDiskFile, readdir, rm, symlink, writeFile as writeDiskFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";
import test from "node:test";
import { WorkflowRuntimeEnrollment, parseRuntimeEnrollmentConfiguration } from "../src/workflow-runtime-enrollment.mjs";
import { decodeRecord, encodeRecord } from "../runtime-src/domain/workflow/foundation-storage.ts";
import { DEFAULT_POLICY, policyHash, resolvePolicy } from "../runtime-src/domain/workflow/policy.ts";
import { HostStateFile, hostDirectoryEntries, workspaceForHostPath } from "../runtime-src/domain/host-state-file.ts";
import { closeHostStateWal } from "../runtime-src/domain/host-state-wal.ts";

async function readFile(path, encoding) {
  if (path.endsWith("runtime-enrollment.json")) {
    const content = await new HostStateFile(workspaceForHostPath(path), path).read();
    if (content !== undefined) return encoding ? content : Buffer.from(content);
  }
  return readDiskFile(path, encoding);
}

async function writeFile(path, content, encoding) {
  if (path.endsWith("runtime-enrollment.json")) {
    await new HostStateFile(workspaceForHostPath(path), path).transact("test-enrollment-fixture",
      () => ({ content, result: undefined }));
  } else await writeDiskFile(path, content, encoding);
}

async function setup(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), "workflow-enrollment-"));
  const project = join(root, "project");
  const tools = join(root, "tools");
  await mkdir(project); await mkdir(tools);
  const marker = join(root, "must-not-execute");
  await writeFile(join(tools, "sdk.mjs"), `throw new Error("SDK must not be imported during enrollment");\n`);
  const configuration = {
    schemaVersion: "workflow-runtime-config/v1",
    owner: {
      ownerId: "registration", mainSessionId: "main", privateSessionId: "private", repositoryId: "project",
      worktreePath: join(root, "private-source"), targetWorktreePath: project, policy: DEFAULT_POLICY,
    },
    runtimeDirectory: join(root, "private-artifacts"), baseCommit: "a".repeat(40), buildId: "build-8a",
    sdk: { modulePath: join(tools, "sdk.mjs"), digest: "b".repeat(64) },
    cli: { path: join(tools, "copilot.exe"), digest: "c".repeat(64) }, node: null,
  };
  const instances = [];
  const create = (extra = {}) => {
    const instance = new WorkflowRuntimeEnrollment({ repositoryRoot: project, mainSessionId: "main", ...options, ...extra });
    instances.push(instance);
    return instance;
  };
  const enrollment = create();
  t.after(async () => {
    for (const instance of instances) await instance.close();
    await closeHostStateWal(project);
    await rm(root, { recursive: true, force: true });
  });
  const base = join(project, ".tandem", "living-canvas");
  const directory = join(base, "workflow", "runtime");
  return {
    root, project, tools, marker, configuration, enrollment, create, base, directory,
    path: join(directory, "runtime-enrollment.json"),
    save: (id = "save-1", expectedRevision = 0, config = configuration) => ({
      request: { id, message: `Exact enrollment request ${id}.\n  Preserve whitespace.`, receivedAt: "2026-09-09T10:33:05.840+08:00" },
      expectedRevision, configuration: config,
    }),
  };
}

test("missing enrollment inspection creates no state and advertises configuration only", async (t) => {
  const f = await setup(t);
  assert.deepEqual(await f.enrollment.read(), {
    schemaVersion: "workflow-runtime-enrollment-view/v1", status: "missing", revision: 0,
    configuration: null, reason: null, canSave: true, executionEnabled: false,
  });
  assert.deepEqual(await readdir(f.project), []);
});

test("save retains exact declared inputs without importing binaries, creating worktrees or claiming execution", async (t) => {
  const f = await setup(t);
  const input = f.save();
  const result = await f.enrollment.save(input);
  assert.equal(result.duplicate, false);
  assert.equal(result.view.status, "configured");
  assert.equal(result.view.canSave, true);
  assert.equal(result.view.executionEnabled, false);
  assert.deepEqual(result.view.configuration, f.configuration);
  assert.deepEqual(result.receipt, { requestId: input.request.id, revision: 1, configurationDigest: policyHash(f.configuration) });
  const saved = decodeRecord(await readFile(f.path, "utf8"));
  assert.equal(saved.schemaVersion, "workflow-runtime-enrollment/v1");
  assert.deepEqual(saved.versions[0].request, input.request);
  assert.deepEqual(saved.versions[0].configuration, f.configuration);
  assert.equal(saved.versions[0].expectedRevision, 0);
  assert.deepEqual(Object.keys(saved).sort(), ["mainSessionId", "repositoryRoot", "revision", "schemaVersion", "versions"]);
  assert.deepEqual((await readdir(join(f.base, "workflow"))).sort(), ["runtime"]);
  assert.deepEqual((await hostDirectoryEntries(f.project, f.directory)).sort(), [".writer-lock", "runtime-enrollment.json"]);
  await assert.rejects(readDiskFile(f.path), { code: "ENOENT" });
  await assert.rejects(readFile(join(f.configuration.owner.worktreePath, ".git")), { code: "ENOENT" });
  await assert.rejects(readdir(f.configuration.runtimeDirectory), { code: "ENOENT" });
  await assert.rejects(readFile(f.marker), { code: "ENOENT" });
  assert.equal("request" in result.view, false);
  assert.equal("hooksAvailable" in result.view, false);
});

test("unprovisioned revisions keep fixed identity and exact historical retries return their original receipt", async (t) => {
  const f = await setup(t);
  const first = f.save();
  const firstSaved = await f.enrollment.save(first);
  const original = decodeRecord(await readFile(f.path, "utf8")).versions[0];
  const config = {
    ...f.configuration, baseCommit: "d".repeat(40), buildId: "build-8a-2",
    owner: { ...f.configuration.owner, policy: resolvePolicy({ execution: { implementationAttempts: 7 } }) },
    node: { path: join(f.tools, "node.exe"), digest: "e".repeat(64) },
  };
  const latest = await f.enrollment.save(f.save("save-2", 1, config));
  const bytes = await readFile(f.path, "utf8");
  assert.equal(latest.view.revision, 2);
  assert.deepEqual(decodeRecord(bytes).versions[0], original);
  const retried = await f.enrollment.save(first);
  assert.equal(retried.duplicate, true);
  assert.deepEqual(retried.receipt, firstSaved.receipt);
  assert.deepEqual(retried.view, latest.view);
  assert.equal(await readFile(f.path, "utf8"), bytes);
  await assert.rejects(f.enrollment.save(f.save("new-stale", 0, config)), /stale/);
  await assert.rejects(f.enrollment.save({ ...first, request: { ...first.request, message: "Changed original text." } }), /conflicting/);
  await assert.rejects(f.enrollment.save(f.save("save-1", 1, config)), /conflicting/);
  await f.enrollment.close();
  assert.deepEqual(await f.create().read(), latest.view);
});

for (const [name, modify] of [
  ["main owner", (config) => { config.owner.mainSessionId = "other-main"; }],
  ["private owner", (config) => { config.owner.privateSessionId = "other-private"; }],
  ["registration", (config) => { config.owner.ownerId = "other-registration"; }],
  ["source", (config) => { config.owner.worktreePath += "-other"; }],
  ["target", (config) => { config.owner.targetWorktreePath += "-other"; }],
  ["artifacts", (config) => { config.runtimeDirectory += "-other"; }],
]) test(`configuration revisions cannot replace fixed ${name}`, async (t) => {
  const f = await setup(t);
  await f.enrollment.save(f.save());
  const bytes = await readFile(f.path, "utf8");
  const next = structuredClone(f.configuration); modify(next);
  await assert.rejects(async () => f.enrollment.save(f.save("replacement", 1, next)), /another main|fixed original/);
  assert.equal(await readFile(f.path, "utf8"), bytes);
});

for (const [name, modify] of [
  ["relative source", (config) => { config.owner.worktreePath = "relative"; }],
  ["nested artifacts", (config) => { config.runtimeDirectory = join(config.owner.worktreePath, "artifacts"); }],
  ["root artifacts", (config) => { config.runtimeDirectory = parse(config.runtimeDirectory).root; }],
  ["mutable SDK", (config) => { config.sdk.modulePath = join(config.owner.targetWorktreePath, "sdk.mjs"); }],
  ["short commit", (config) => { config.baseCommit = "4ba02f3"; }],
  ["unknown schema", (config) => { config.schemaVersion = "workflow-runtime-config/v99"; }],
  ["unknown capability claim", (config) => { config.hooksAvailable = true; }],
  ["unknown owner readiness", (config) => { config.owner.ready = true; }],
  ["bad hash", (config) => { config.cli.digest = "trusted"; }],
  ["same private/main session", (config) => { config.owner.privateSessionId = config.owner.mainSessionId; }],
]) test(`runtime config rejects ${name} without creating project state`, async (t) => {
  const f = await setup(t);
  const config = structuredClone(f.configuration); modify(config);
  assert.throws(() => parseRuntimeEnrollmentConfiguration(config));
  await assert.rejects(async () => f.enrollment.save(f.save("invalid", 0, config)));
  assert.deepEqual(await readdir(f.project), []);
});

for (const [name, evidence] of [
  ["selected authority", (f) => join(f.base, "workflow", "authority", "authority.json")],
  ["orphan controller", (f) => join(f.base, "workflow", "controller", "operation-ledger.json")],
  ["prepared provisioning", (f) => join(f.directory, "provisioning.json")],
  ["legacy operation", (f) => join(f.base, "active-operation.json")],
  ["legacy Review", (f) => join(f.base, "implementation-review.json")],
  ["legacy run", (f) => join(f.base, "implementation-run.json")],
  ["private artifacts", (f) => join(f.configuration.runtimeDirectory, "private-state", "private-execution.json")],
]) test(`${name} freezes enrollment while exact receipt replay remains non-mutating`, async (t) => {
  const f = await setup(t);
  const input = f.save();
  await f.enrollment.save(input);
  const original = await readFile(f.path, "utf8");
  const path = evidence(f);
  await mkdir(parse(path).dir, { recursive: true });
  await writeFile(path, "unknown retained evidence must not be removed");
  const view = await f.enrollment.read();
  assert.equal(view.status, "blocked");
  assert.equal(view.canSave, false);
  assert.deepEqual(view.configuration, f.configuration);
  await assert.rejects(f.enrollment.save(f.save("replacement", 1)));
  const retry = await f.enrollment.save(input);
  assert.equal(retry.duplicate, true);
  assert.equal(retry.view.status, "blocked");
  assert.equal(await readFile(f.path, "utf8"), original);
  assert.equal(await readFile(path, "utf8"), "unknown retained evidence must not be removed");
});

test("existing private source and unknown writer locks are not adopted or reset", async (t) => {
  const f = await setup(t);
  await mkdir(f.configuration.owner.worktreePath);
  await assert.rejects(f.enrollment.save(f.save()), /private source path already exists/);
  assert.deepEqual(await readdir(f.project), []);
  await rm(f.configuration.owner.worktreePath, { recursive: true });
  await mkdir(f.directory, { recursive: true });
  await writeFile(join(f.directory, ".writer-lock"), "orphan");
  assert.equal((await f.enrollment.read()).status, "blocked");
  await assert.rejects(f.enrollment.save(f.save()), /orphan writer/);
  assert.equal(await readFile(join(f.directory, ".writer-lock"), "utf8"), "orphan");
});

test("checksum, schema, version history and owner corruption fail closed without replacing bytes", async (t) => {
  const f = await setup(t);
  await f.enrollment.save(f.save());
  const valid = decodeRecord(await readFile(f.path, "utf8"));
  await f.enrollment.close();
  const reader = f.create();
  await assert.rejects(writeFile(f.path, "{malformed"), /JSON/);
  for (const content of [
    '{"malformed":"record"}',
    encodeRecord({ ...valid, schemaVersion: "workflow-runtime-enrollment/v99" }),
    encodeRecord({ ...valid, revision: 2 }),
    encodeRecord({ ...valid, mainSessionId: "foreign" }),
    encodeRecord({ ...valid, versions: [{ ...valid.versions[0], configurationDigest: "0".repeat(64) }] }),
  ]) {
    await writeFile(f.path, content);
    const blocked = await reader.read();
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.revision, null);
    assert.equal(blocked.configuration, null);
    await assert.rejects(reader.save(f.save()));
    assert.equal(await readFile(f.path, "utf8"), content);
  }
});

for (const point of ["before-rename", "after-rename"]) {
  test(`explicit save retry preserves exact request after ${point} failure`, async (t) => {
    let failed = false;
    const f = await setup(t, { boundary: (boundary) => {
      if (!failed && boundary.point === point) { failed = true; throw new Error("Injected enrollment publication failure."); }
    } });
    const input = f.save();
    await assert.rejects(f.enrollment.save(input), /Injected/);
    if (point === "before-rename") await assert.rejects(readFile(f.path), { code: "ENOENT" });
    const retry = await f.enrollment.save(input);
    assert.equal(retry.receipt.revision, 1);
    assert.equal(retry.duplicate, point === "after-rename");
    assert.equal(decodeRecord(await readFile(f.path, "utf8")).versions.length, 1);
    assert.deepEqual((await hostDirectoryEntries(f.project, f.directory)).sort(), [".writer-lock", "runtime-enrollment.json"]);
  });
}

test("late provisioning evidence prevents publication after staging configuration", async (t) => {
  let path;
  const f = await setup(t, { boundary: async ({ point }) => {
    if (point === "before-rename") await writeFile(path, "provisioning owns this registration");
  } });
  path = join(f.directory, "provisioning.json");
  await assert.rejects(f.enrollment.save(f.save()), /provisioning|unknown evidence/);
  await assert.rejects(readFile(f.path), { code: "ENOENT" });
  assert.equal(await readFile(path, "utf8"), "provisioning owns this registration");
});

test("one cooperative writer owns saves and admitted caller input is privately cloned", async (t) => {
  const f = await setup(t);
  const input = f.save();
  const saving = f.enrollment.save(input);
  input.request.message = "mutated";
  input.configuration.buildId = "mutated";
  const result = await saving;
  assert.equal(result.view.configuration.buildId, "build-8a");
  const competitor = f.create();
  assert.equal((await competitor.read()).canSave, false);
  await assert.rejects(competitor.save(f.save("other-save", 1, result.view.configuration)), /orphan writer/);
  const bytes = await readFile(f.path, "utf8");
  assert.equal(decodeRecord(bytes).versions[0].request.message, "Exact enrollment request save-1.\n  Preserve whitespace.");
  await f.enrollment.close();
  const next = await competitor.save(f.save("other-save", 1, result.view.configuration));
  assert.equal(next.receipt.revision, 2);
  await assert.rejects(async () => f.enrollment.save(f.save("closed", 2)), /closing/);
});

test("simultaneous exact saves append once and closing drains already admitted publication only", async (t) => {
  let release;
  const blocked = new Promise((done) => { release = done; });
  let entered;
  const staged = new Promise((done) => { entered = done; });
  const f = await setup(t, { boundary: async ({ point }) => {
    if (point === "before-rename") { entered(); await blocked; }
  } });
  const input = f.save();
  const first = f.enrollment.save(input);
  const second = f.enrollment.save(input);
  await staged;
  const closing = f.enrollment.close();
  await assert.rejects(async () => f.enrollment.save(f.save("after-close", 1)), /closing/);
  release();
  assert.equal((await first).duplicate, false);
  assert.equal((await second).duplicate, true);
  await closing;
  assert.equal(decodeRecord(await readFile(f.path, "utf8")).versions.length, 1);
  assert.deepEqual(await hostDirectoryEntries(f.project, f.directory), ["runtime-enrollment.json"]);
});

test("invalid request timestamps and undeclared execution fields cannot create enrollment state", async (t) => {
  const f = await setup(t);
  const input = f.save();
  await assert.rejects(async () => f.enrollment.save({ ...input, request: { ...input.request, receivedAt: "not-a-date" } }), /timestamp/);
  await assert.rejects(async () => f.enrollment.save({ ...input, executionEnabled: true }), /exactly these fields/);
  assert.deepEqual(await readdir(f.project), []);
});

test("junctions and hardlinked enrollment files fail closed and do not write through aliases", async (t) => {
  const f = await setup(t);
  const elsewhere = join(f.root, "elsewhere");
  await mkdir(elsewhere);
  await symlink(elsewhere, join(f.project, ".tandem"), process.platform === "win32" ? "junction" : "dir");
  assert.equal((await f.enrollment.read()).status, "blocked");
  await assert.rejects(f.enrollment.save(f.save()), /junction/);
  assert.deepEqual(await readdir(elsewhere), []);
  await rm(join(f.project, ".tandem"));
  await f.enrollment.save(f.save());
  await f.enrollment.close();
  const alias = join(elsewhere, "aliased.json");
  await writeDiskFile(f.path, await readFile(f.path, "utf8"));
  await link(f.path, alias);
  const reader = f.create();
  assert.equal((await reader.read()).status, "blocked");
  await assert.rejects(reader.save(f.save("aliased", 1)), /hardlink/);
  assert.equal(await readFile(alias, "utf8"), await readFile(f.path, "utf8"));
});
