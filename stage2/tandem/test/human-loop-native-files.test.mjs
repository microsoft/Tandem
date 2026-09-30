import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { link, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { HumanLoopWorkspace } from "../src/human-loop-workspace.mjs";
import { nativeFileTools } from "../src/human-loop-native-files.mjs";
import { DEFAULT_POLICY } from "../runtime-src/domain/workflow/policy.ts";
import { PermissionBroker } from "../runtime-src/permissions/permission-broker.ts";
import { InMemoryEventStore } from "../runtime-src/event-store.ts";

async function fixture(t, verifyOwnership = async () => {}) {
  const root = resolve(process.env.TANDEM_TEST_ROOT ?? process.cwd(), `.native-files-${randomUUID()}`);
  await mkdir(root, { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 }));
  await promisify(execFile)("git", ["init", "--quiet", root]);
  for (const dir of ["src", ".tandem", ".teleos", "node_modules"]) await mkdir(join(root, dir));
  await writeFile(join(root, "src", "app.js"), "export const value = 1;\n");
  await writeFile(join(root, "README.md"), "Project\n");
  await writeFile(join(root, "TANDEM.md"), "Host index\n");
  await writeFile(join(root, ".tandem", "secret"), "Host state\n");
  const owner = { schemaVersion: "human-loop-owner/v1", id: "owner", mainSessionId: "main",
    privateSessionId: "private", workspacePath: root, policy: DEFAULT_POLICY };
  const workspace = new HumanLoopWorkspace({ owner, verifyOwnership });
  await workspace.initialize();
  return { root, workspace };
}

test("native file names identify host tools without a second file policy", () => {
  assert.deepEqual(nativeFileTools, ["view", "glob", "rg", "apply_patch"]);
});

test("snapshot evidence retains its own alias restrictions independently of native file tools", async t => {
  const { root, workspace } = await fixture(t);
  await link(join(root, "README.md"), join(root, "alias.txt"));
  assert.equal((await workspace.inspectNativePaths(["src/app.js", "README.md"]))[1].exists, true);
  await assert.rejects(workspace.capture(), /hardlink/);
  await rm(join(root, "alias.txt"));
  const paths = await workspace.inspectNativePaths(["src/../README.md", "README.md"]);
  assert.equal(paths[0].absolute, paths[1].absolute);
  if (process.platform === "win32") {
    assert.equal((await workspace.inspectNativePath("readme.md")).absolute, paths[1].absolute);
  }
});

test("dependency aliases and native-valid names do not widen canonical snapshot selection", async t => {
  const { root, workspace } = await fixture(t);
  const dependency = join(root, "node_modules", "dependency");
  await mkdir(dependency);
  await writeFile(join(dependency, "package.json"), '{"name":"fixture-dependency"}\n');
  const noncanonical = "e\u0301.txt";
  await writeFile(join(dependency, noncanonical), "Native-valid decomposed name\n");
  await link(join(dependency, "package.json"), join(dependency, "linked.json"));
  await symlink(dependency, join(root, "node_modules", "alias"), process.platform === "win32" ? "junction" : "dir");
  const before = await workspace.capture();
  assert.ok((await workspace.readSnapshot(before)).files.every(file => !/^node_modules\/|^\.git\//.test(file.path)));
  await writeFile(join(dependency, "package.json"), '{"name":"changed-but-still-excluded"}\n');
  assert.deepEqual(await workspace.capture(), before);
});

test("native batch settlement waits for its final ownership check and rejects revocation", async t => {
  let enabled = false, checks = 0, release, entered;
  const held = new Promise(resolve => { release = resolve; });
  const boundary = new Promise(resolve => { entered = resolve; });
  const { workspace } = await fixture(t, async () => {
    if (enabled && ++checks === 3) { entered(); await held; return false; }
  });
  enabled = true;
  let finished = false;
  const inspection = workspace.inspectNativePaths(["README.md", "src/app.js"]);
  const rejected = assert.rejects(inspection, /ownership verification failed/).finally(() => { finished = true; });
  await boundary;
  assert.equal(finished, false);
  release();
  await rejected;
});

test("once-only native permissions neither inherit custom approve-all nor offer broader grants", async () => {
  const broker = new PermissionBroker(new InMemoryEventStore());
  const invocation = { sessionId: "private" };
  const custom = broker.request({ kind: "custom-tool", toolName: "retained-command", toolDescription: "A custom command", args: {} }, invocation);
  await broker.decide(broker.list()[0].id, "all");
  await custom;
  const controller = new AbortController();
  const native = broker.request({ kind: "read", toolCallId: "native-view", intention: "Read exact project file", path: "app.js" },
    invocation, controller.signal, { onceOnly: true });
  const pending = broker.list()[0];
  assert.equal(pending.kind, "read");
  assert.equal(pending.canApproveAll, false);
  assert.equal(pending.canApproveForSession, false);
  await assert.rejects(broker.decide(pending.id, "session"), /cannot be approved for the session/);
  await assert.rejects(broker.decide(pending.id, "all"), /policy/);
  controller.abort();
  assert.equal((await native).kind, "reject");
  assert.deepEqual(broker.list(), []);
});
