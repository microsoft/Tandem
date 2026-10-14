import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmod, link, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { HumanLoopWorkspace } from "../src/human-loop-workspace.mjs";
import { DEFAULT_POLICY, policyHash } from "../runtime-src/domain/workflow/policy.ts";

const exec = promisify(execFile);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const git = async (root, ...args) => (await exec("git", ["-C", root, ...args], { windowsHide: true })).stdout.trim();

async function fixture(t, options = {}) {
  // Only newly created fixtures under this checkout are ever mutated or removed.
  const container = resolve(`.human-loop-workspace-fixture-${randomUUID()}`);
  await mkdir(container);
  t.after(() => rm(container, { recursive: true, force: true }));
  const root = join(await realpath(container), "workspace");
  await mkdir(root);
  await git(root, "init", "--quiet");
  await writeFile(join(root, "tracked.txt"), "committed\n");
  await writeFile(join(root, "untouched.txt"), "keep me\n");
  await writeFile(join(root, "TANDEM.md"), "human-owned index\n");
  await git(root, "add", ".");
  await git(root, "-c", "user.name=Workspace test", "-c", "user.email=workspace@example.invalid",
    "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "fresh fixture");
  await writeFile(join(root, "tracked.txt"), "pre-existing dirty edit\n");
  await writeFile(join(root, "untracked.txt"), "pre-existing untracked content\n");
  const owner = { schemaVersion: "human-loop-owner/v1", id: "owner", mainSessionId: "main",
    privateSessionId: "private", workspacePath: root, policy: DEFAULT_POLICY };
  const observations = [];
  const verifyOwnership = options.verifyOwnership ?? (async (value) => {
    assert.deepEqual(value, owner);
    observations.push(value);
  });
  const workspace = new HumanLoopWorkspace({ owner, verifyOwnership });
  if (options.initialize !== false) await workspace.initialize();
  return { root, container, owner, workspace, observations };
}

function artifact(root, ref) {
  return join(root, ".tandem", "living-canvas", "human-loop", "evidence", `${ref.id}.json`);
}

test("one-copy initialization and edits preserve dirty baseline, index, HEAD, unrelated files and worktree inventory", async (t) => {
  const { root, workspace, observations } = await fixture(t);
  const beforeWorktrees = await git(root, "worktree", "list", "--porcelain");
  const head = await git(root, "rev-parse", "HEAD");
  const index = await readFile(join(root, ".git", "index"));
  const before = await workspace.capture();
  const baseline = await workspace.readSnapshot(before);
  assert.equal(baseline.head, head);
  assert.equal(baseline.files.find(({ path }) => path === "tracked.txt").content, "pre-existing dirty edit\n");
  assert.equal(baseline.files.find(({ path }) => path === "untracked.txt").content, "pre-existing untracked content\n");
  const original = await workspace.read("tracked.txt");
  const result = await workspace.replace({ path: "tracked.txt", expectedDigest: original.digest, content: "direct edit\n" }, ["tracked.txt"]);
  assert.deepEqual(result, { path: "tracked.txt", digest: sha256("direct edit\n") });
  assert.equal(await readFile(join(root, "tracked.txt"), "utf8"), "direct edit\n");
  await workspace.replace({ path: "src\\new.txt", expectedDigest: null, content: "new file\n" }, ["src"]);
  assert.equal(await readFile(join(root, "src", "new.txt"), "utf8"), "new file\n");
  assert.equal(await readFile(join(root, "untracked.txt"), "utf8"), "pre-existing untracked content\n");
  assert.equal(await readFile(join(root, "untouched.txt"), "utf8"), "keep me\n");
  assert.equal(await readFile(join(root, "TANDEM.md"), "utf8"), "human-owned index\n");
  assert.deepEqual(await readFile(join(root, ".git", "index")), index);
  assert.equal(await git(root, "rev-parse", "HEAD"), head);
  assert.equal(await git(root, "worktree", "list", "--porcelain"), beforeWorktrees);
  assert(observations.length > 0);
  assert((await readdir(join(root, ".tandem", "living-canvas", "human-loop", "evidence")))
    .every((name) => /^snapshot-[a-f0-9]{64}\.json$/.test(name)));
});

test("snapshots are deterministic, immutable, complete for text/binary/ignored files, and exclude only reserved trees", async (t) => {
  const { root, owner, workspace } = await fixture(t);
  await writeFile(join(root, ".gitignore"), "ignored-product.txt\n");
  await writeFile(join(root, "ignored-product.txt"), "still evidence\n");
  await writeFile(join(root, "binary.bin"), Buffer.from([0, 0xff, 0x80, 1]));
  await mkdir(join(root, "dist"));
  await writeFile(join(root, "dist", "product.js"), "product output");
  await mkdir(join(root, "node_modules"));
  await writeFile(join(root, "node_modules", "dependency"), "excluded");
  await mkdir(join(root, ".tandem"));
  await writeFile(join(root, ".tandem", "old-state"), "excluded");
  const first = await workspace.capture();
  assert.deepEqual(await workspace.capture(), first);
  const record = await workspace.readSnapshot(first);
  assert.equal(record.ownerDigest, policyHash(owner));
  assert.equal(policyHash(record), first.digest);
  assert(Object.isFrozen(record));
  assert(Object.isFrozen(record.files));
  assert(Object.isFrozen(record.files[0]));
  assert.throws(() => { record.files[0].content = "changed"; }, TypeError);
  assert.deepEqual(await workspace.list(), [".gitignore", "TANDEM.md", "binary.bin", "dist/product.js",
    "ignored-product.txt", "tracked.txt", "untouched.txt", "untracked.txt"]);
  const binary = record.files.find(({ path }) => path === "binary.bin");
  assert.equal(binary.encoding, "base64");
  assert.equal(binary.bytes, 4);
  assert.equal(binary.digest, sha256(Buffer.from(binary.content, "base64")));
  await assert.rejects(workspace.read("binary.bin"), /binary file/);
  assert.deepEqual(await workspace.verifySnapshot(first), first);
});

test("changes report all actual additions, modifications, deletions without claiming unchanged dirty work", async (t) => {
  const { root, workspace } = await fixture(t);
  const before = await workspace.capture();
  await writeFile(join(root, "new.txt"), "added");
  await writeFile(join(root, "tracked.txt"), "changed");
  await rm(join(root, "untouched.txt"));
  const after = await workspace.capture();
  assert.deepEqual(await workspace.changes(before, after), [
    { path: "new.txt", beforeDigest: null, afterDigest: sha256("added") },
    { path: "tracked.txt", beforeDigest: sha256("pre-existing dirty edit\n"), afterDigest: sha256("changed") },
    { path: "untouched.txt", beforeDigest: sha256("keep me\n"), afterDigest: null },
  ]);
  assert.deepEqual(await workspace.changes(before, before), []);
  await assert.rejects(workspace.verifySnapshot(before), /snapshot conflict/);
  assert.deepEqual(await workspace.verifySnapshot(after), after);
  assert.equal((await workspace.readSnapshot(before)).files.find(({ path }) => path === "untouched.txt").content, "keep me\n");
});

test("snapshot references and retained content are integrity checked on every read and never repaired", async (t) => {
  const { root, owner, workspace } = await fixture(t);
  const ref = await workspace.capture();
  const path = artifact(root, ref);
  const original = await readFile(path, "utf8");
  const corrupt = JSON.parse(original);
  corrupt.files[0].content = "tampered";
  await writeFile(path, JSON.stringify(corrupt));
  await assert.rejects(workspace.readSnapshot(ref), /checksum/);
  await assert.rejects(workspace.capture(), /checksum/);
  assert.equal(await readFile(path, "utf8"), JSON.stringify(corrupt));
  await writeFile(path, original);
  await assert.rejects(workspace.readSnapshot({ ...ref, id: "../escape" }), /reference identity/);
  await assert.rejects(workspace.readSnapshot({ ...ref, digest: "0".repeat(64) }), /reference identity/);
  const forged = JSON.parse(original);
  forged.head = "0".repeat(40);
  await writeFile(path, JSON.stringify(forged));
  await assert.rejects(workspace.readSnapshot(ref), /integrity/);
  await writeFile(path, original);
  const other = new HumanLoopWorkspace({ owner: { ...owner, id: "other" }, verifyOwnership: async () => {} });
  await other.initialize();
  await assert.rejects(other.readSnapshot(ref), /owner differs/);
});

test("forecast-independent paths retain expected digests, concurrent writer and mutable input guards", async (t) => {
  const { root, owner, workspace } = await fixture(t);
  const original = await workspace.read("tracked.txt");
  await assert.rejects(workspace.replace({ path: "tracked.txt", expectedDigest: null, content: "no" }, ["tracked.txt"]), /conflict/);
  await assert.rejects(workspace.replace({ path: "new.txt", expectedDigest: original.digest, content: "no" }, ["new.txt"]), /conflict/);
  await workspace.replace({ path: "src-other/file.txt", expectedDigest: null, content: "forecast is not authorization" }, ["src"]);
  assert.equal((await workspace.read("src-other/file.txt")).content, "forecast is not authorization");
  const second = new HumanLoopWorkspace({ owner, verifyOwnership: async () => {} });
  await second.initialize();
  const pending = workspace.replace({ path: "tracked.txt", expectedDigest: original.digest, content: "first" }, ["tracked.txt"]);
  const conflict = second.replace({ path: "tracked.txt", expectedDigest: original.digest, content: "second" }, ["tracked.txt"]);
  const results = await Promise.allSettled([pending, conflict]);
  assert.equal(results[0].status, "fulfilled");
  assert.equal(results[1].status, "rejected");
  assert.match(results[1].reason.message, /conflict/);
  const request = { path: "new.txt", expectedDigest: null, content: "intended" };
  const write = workspace.replace(request);
  request.content = "mutated";
  await write;
  assert.equal(await readFile(join(root, "new.txt"), "utf8"), "intended");
  assert.equal(await readFile(join(root, "tracked.txt"), "utf8"), "first");
  assert.equal(await readFile(join(root, "untouched.txt"), "utf8"), "keep me\n");
});

test("ownership is required, called for every operation, and revocation prevents all mutations", async (t) => {
  let allowed = true, calls = 0;
  const { root, owner, workspace } = await fixture(t, { verifyOwnership: async () => { calls++; return allowed; } });
  assert.throws(() => new HumanLoopWorkspace({ owner }), /callback is required/);
  const sync = new HumanLoopWorkspace({ owner, verifyOwnership: () => true });
  await assert.rejects(sync.initialize(), /async trusted callback/);
  const ref = await workspace.capture();
  const original = await workspace.read("tracked.txt");
  const before = calls;
  allowed = false;
  for (const action of [
    () => workspace.initialize(), () => workspace.capture(), () => workspace.readSnapshot(ref),
    () => workspace.verifySnapshot(ref), () => workspace.changes(ref, ref), () => workspace.read("tracked.txt"),
    () => workspace.list(), () => workspace.replace({ path: "tracked.txt", expectedDigest: original.digest, content: "no" }, ["tracked.txt"]),
  ]) await assert.rejects(action(), /ownership verification failed/);
  assert.equal(calls - before, 8);
  assert.equal(await readFile(join(root, "tracked.txt"), "utf8"), original.content);
  const throwing = new HumanLoopWorkspace({ owner, verifyOwnership: async () => { throw new Error("owner revoked"); } });
  await assert.rejects(throwing.initialize(), /owner revoked/);
});

test("rejects subdirectories and lexical workspace aliases without creating or taking over worktrees", async (t) => {
  const { root, owner, workspace } = await fixture(t, { initialize: false });
  await assert.rejects(workspace.capture(), /initialize/);
  const before = await git(root, "worktree", "list", "--porcelain");
  await mkdir(join(root, "child"));
  const sub = new HumanLoopWorkspace({ owner: { ...owner, workspacePath: join(root, "child") }, verifyOwnership: async () => {} });
  await assert.rejects(sub.initialize(), /worktree root/);
  const alias = new HumanLoopWorkspace({ owner: { ...owner, workspacePath: `${root}\\child\\..` }, verifyOwnership: async () => {} });
  await assert.rejects(alias.initialize(), /canonical/);
  assert.equal(await git(root, "worktree", "list", "--porcelain"), before);
  assert(!(await readdir(root)).includes(".tandem"));
});

test("safe file tools reject traversal, ADS, wildcards, device names, case aliases and protected metadata", async (t) => {
  const { root, workspace } = await fixture(t);
  for (const path of ["../escape", "src/../escape", "./tracked.txt", "src//x", "/absolute", "C:\\absolute",
    "tracked.txt:stream", "src/*.txt", "src/?.txt", "src/NUL.txt", "src/COM1", "src/aux", "src/space ",
    "tracked.txt.", ".git/config", "src/.git/config", ".tandem/state", ".teleos/state",
    ".tandem-migration.lock", "node_modules/file", "TANDEM.md", "tandem.md", "TELEOS.md", "teleos.md"]) {
    assert.throws(() => workspace.replace({ path, expectedDigest: null, content: "no" }, ["src"]), /protected|unsafe|relative/);
  }
  for (const path of ["../escape", ".git/config", ".tandem/state"]) {
    assert.throws(() => workspace.read(path), /protected|unsafe/);
  }
  for (const path of ["../outside.txt", ".git/config", ".tandem/state", "TANDEM.md"]) {
    assert.throws(() => workspace.validateWrites([{ path }]), /protected|unsafe/);
  }
  workspace.validateWrites([{ path: "data/state.json" }, { path: "src-other/file.txt" }]);
  await assert.rejects(workspace.read("TRACKED.txt"), /alias/);
  await assert.rejects(workspace.replace({ path: "TRACKED.txt", expectedDigest: null, content: "no" }, ["TRACKED.txt"]), /alias/);
  assert.equal((await workspace.read("TANDEM.md")).content, "human-owned index\n");
  assert.equal(await readFile(join(root, "tracked.txt"), "utf8"), "pre-existing dirty edit\n");
});

test("hardlink file aliases fail reads, replacements and capture without affecting either name", async (t) => {
  const { root, workspace } = await fixture(t);
  await link(join(root, "tracked.txt"), join(root, "alias.txt"));
  await assert.rejects(workspace.read("alias.txt"), /hardlink alias/);
  await assert.rejects(workspace.replace({ path: "alias.txt", expectedDigest: null, content: "no" }, ["alias.txt"]), /hardlink alias/);
  await assert.rejects(workspace.capture(), /hardlink alias/);
  assert.equal(await readFile(join(root, "tracked.txt"), "utf8"), "pre-existing dirty edit\n");
  assert.equal(await readFile(join(root, "alias.txt"), "utf8"), "pre-existing dirty edit\n");
});

test("junction or symlink directories cannot redirect workspace tools or evidence publication", async (t) => {
  const { root, container, owner, workspace } = await fixture(t);
  const outside = join(container, "outside");
  await mkdir(outside);
  await writeFile(join(outside, "keep.txt"), "outside");
  const alias = join(root, "redirect");
  await symlink(outside, alias, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(workspace.read("redirect/keep.txt"), /aliases/);
  await assert.rejects(workspace.replace({ path: "redirect/new.txt", expectedDigest: null, content: "no" }, ["redirect"]), /aliases/);
  await assert.rejects(workspace.capture(), /aliases/);
  const rootAlias = join(container, "root-alias");
  await symlink(root, rootAlias, process.platform === "win32" ? "junction" : "dir");
  const aliased = new HumanLoopWorkspace({ owner: { ...owner, workspacePath: rootAlias }, verifyOwnership: async () => {} });
  await assert.rejects(aliased.initialize(), /aliased/);
  await rm(alias);
  await symlink(outside, join(root, ".tandem"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(workspace.capture(), /aliased/);
  assert.deepEqual(await readdir(outside), ["keep.txt"]);
  assert.equal(await readFile(join(outside, "keep.txt"), "utf8"), "outside");
});

test("evidence hardlinks are rejected without rewriting retained artifacts", async (t) => {
  const { root, container, workspace } = await fixture(t);
  const ref = await workspace.capture();
  const path = artifact(root, ref), original = await readFile(path, "utf8");
  await link(path, join(container, "artifact-alias"));
  await assert.rejects(workspace.readSnapshot(ref), /hardlink alias/);
  await assert.rejects(workspace.capture(), /hardlink alias/);
  assert.equal(await readFile(path, "utf8"), original);
});

test("capture retains observed bytes without fencing subsequent ordinary project edits", async (t) => {
  let root, mutate = false, version = 0;
  const fixtureValue = await fixture(t, { verifyOwnership: async () => {
    if (mutate) await writeFile(join(root, "tracked.txt"), `external-${++version}`);
  } });
  root = fixtureValue.root;
  const baseline = await fixtureValue.workspace.capture();
  mutate = true;
  const observed = await fixtureValue.workspace.capture();
  mutate = false;
  assert.equal((await fixtureValue.workspace.readSnapshot(baseline)).files.find(({ path }) => path === "tracked.txt").content,
    "pre-existing dirty edit\n");
  assert.match((await fixtureValue.workspace.readSnapshot(observed)).files.find(({ path }) => path === "tracked.txt").content, /^external-/);
  await assert.rejects(fixtureValue.workspace.verifySnapshot(baseline), /snapshot conflict/);
});

test("replacement rechecks the expected digest after preparing its temporary file and cleans only its own file", async (t) => {
  let root, interrupt = false;
  const fixtureValue = await fixture(t, { verifyOwnership: async () => {
    if (interrupt && (await readdir(root)).some((name) => /^\.human-loop-.*\.tmp$/.test(name))) {
      interrupt = false;
      await writeFile(join(root, "tracked.txt"), "external concurrent edit");
    }
  } });
  root = fixtureValue.root;
  const { workspace } = fixtureValue;
  const original = await workspace.read("tracked.txt");
  await writeFile(join(root, ".unrelated.tmp"), "not ours");
  interrupt = true;
  await assert.rejects(workspace.replace({ path: "tracked.txt", expectedDigest: original.digest, content: "agent edit" }, ["tracked.txt"]), /conflict/);
  assert.equal(await readFile(join(root, "tracked.txt"), "utf8"), "external concurrent edit");
  assert.equal(await readFile(join(root, ".unrelated.tmp"), "utf8"), "not ours");
  assert(!(await readdir(root)).some((name) => /^\.human-loop-.*\.tmp$/.test(name)));
});

test("ownership revoked after staging rejects publication and preserves the original file", async (t) => {
  let root, revoke = false;
  const fixtureValue = await fixture(t, { verifyOwnership: async () => {
    if (revoke && (await readdir(root)).some((name) => /^\.human-loop-.*\.tmp$/.test(name))) return false;
  } });
  root = fixtureValue.root;
  const original = await fixtureValue.workspace.read("tracked.txt");
  revoke = true;
  await assert.rejects(fixtureValue.workspace.replace({
    path: "tracked.txt", expectedDigest: original.digest, content: "not authorized",
  }, ["tracked.txt"]), /ownership verification failed/);
  assert.equal(await readFile(join(root, "tracked.txt"), "utf8"), original.content);
  assert(!(await readdir(root)).some((name) => /^\.human-loop-.*\.tmp$/.test(name)));
});

test("tampered staging bytes never replace the original source", async (t) => {
  let root, tamper = false;
  const fixtureValue = await fixture(t, { verifyOwnership: async () => {
    if (!tamper) return;
    const staged = (await readdir(root)).find((name) => /^\.human-loop-.*\.tmp$/.test(name));
    if (staged) {
      tamper = false;
      await writeFile(join(root, staged), "corrupt staging bytes");
    }
  } });
  root = fixtureValue.root;
  const original = await fixtureValue.workspace.read("tracked.txt");
  tamper = true;
  await assert.rejects(fixtureValue.workspace.replace({
    path: "tracked.txt", expectedDigest: original.digest, content: "intended",
  }, ["tracked.txt"]), /temporary replacement content changed/);
  assert.equal(await readFile(join(root, "tracked.txt"), "utf8"), original.content);
  assert(!(await readdir(root)).some((name) => /^\.human-loop-.*\.tmp$/.test(name)));
});

test("snapshot publication preserves observed evidence while ordinary project editing continues", async (t) => {
  let root, changeDuringPublication = false, changed = false;
  const fixtureValue = await fixture(t, { verifyOwnership: async () => {
    if (!changeDuringPublication) return;
    const directory = join(root, ".tandem", "living-canvas", "human-loop", "evidence");
    let entries = [];
    try { entries = await readdir(directory); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    if (entries.some((name) => name.endsWith(".tmp"))) {
      changeDuringPublication = false;
      changed = true;
      await writeFile(join(root, "tracked.txt"), "external publication-time edit");
    }
  } });
  root = fixtureValue.root;
  changeDuringPublication = true;
  const observed = await fixtureValue.workspace.capture();
  assert(changed);
  assert.equal(await readFile(join(root, "tracked.txt"), "utf8"), "external publication-time edit");
  assert.equal((await fixtureValue.workspace.readSnapshot(observed)).files.find(({ path }) => path === "tracked.txt").content, "pre-existing dirty edit\n");
});

test("unborn repositories retain an explicit null HEAD and executable mode changes affect evidence", async (t) => {
  const { root, owner, container } = await fixture(t);
  const empty = join(container, "empty");
  await mkdir(empty);
  await git(empty, "init", "--quiet");
  const workspace = new HumanLoopWorkspace({ owner: { ...owner, workspacePath: empty }, verifyOwnership: async () => {} });
  await workspace.initialize();
  const ref = await workspace.capture();
  assert.equal((await workspace.readSnapshot(ref)).head, null);
  assert.deepEqual(await workspace.list(), []);
  if (process.platform !== "win32") {
    const original = new HumanLoopWorkspace({ owner, verifyOwnership: async () => {} });
    await original.initialize();
    const before = await original.capture();
    await chmod(join(root, "tracked.txt"), 0o755);
    const after = await original.capture();
    assert.notEqual(before.digest, after.digest);
    assert.deepEqual(await original.changes(before, after), [{
      path: "tracked.txt", beforeDigest: sha256("pre-existing dirty edit\n"), afterDigest: sha256("pre-existing dirty edit\n"),
    }]);
  }
});
