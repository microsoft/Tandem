import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, appendFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { promisify } from "node:util";
import test from "node:test";
import { getHostStateWal, closeHostStateWal, hostStateDigest } from "../runtime-src/domain/host-state-wal.ts";
import { HostStateFile, migrateHostState } from "../runtime-src/domain/host-state-file.ts";
import { mkdir } from "node:fs/promises";
import { FoundationStorage } from "../runtime-src/domain/workflow/foundation-storage.ts";

async function fixture(t, options) {
  const root = await mkdtemp(join(tmpdir(), "host-wal-"));
  const wal = getHostStateWal(root, options);
  t.after(async () => { await wal.close(); await rm(root, { recursive: true, force: true }); });
  return { root, wal };
}
const document = (count) => JSON.stringify({ schemaVersion: "counter/v1", count });

test("Foundation mutations never take a local queue ahead of a held shared WAL transaction", { timeout: 10_000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "host-wal-order-"));
  const wal = getHostStateWal(root);
  const file = new HostStateFile(root, join(root, ".tandem", "living-canvas", "module", "state.json"));
  const storage = new FoundationStorage(join(root, ".tandem", "living-canvas", "module"));
  await storage.acquireWriter();
  t.after(async () => { await storage.close(); await wal.close(); await rm(root, { recursive: true, force: true }); });
  let ready, release;
  const started = new Promise((done) => { ready = done; });
  const gate = new Promise((done) => { release = done; });
  const a = file.run("outer", async () => {
    ready(); await gate;
    await storage.mutate("state.json", "nested-a", () => ({ content: document(1), result: null }));
  });
  await started;
  const b = storage.mutate("state.json", "queued-b", (raw) =>
    ({ content: document(JSON.parse(raw).count + 1), result: null }));
  release();
  await Promise.all([a, b]);
  assert.equal(await file.read(), document(2));
});

test("reentrant close rejects without sealing the healthy writer", async (t) => {
  const { wal } = await fixture(t);
  await wal.transaction("module", "close-attempt", async () => {
    await assert.rejects(wal.close(), /reentrant close/);
    return { changes: [{ namespace: "a", key: "value", content: document(1) }], result: null };
  });
  await wal.mutate("a", "value", "continue", () => ({ content: document(2), result: null }));
  assert.equal(await wal.read("a", "value"), document(2));
  assert.equal(wal.failed, false);
});

test("canonical instances serialize complete read-modify-write transactions and reject stale races", async (t) => {
  const { root, wal } = await fixture(t);
  const same = getHostStateWal(join(root, "."));
  assert.equal(same, wal);
  await Promise.all(Array.from({ length: 20 }, (_, index) => (index % 2 ? same : wal).mutate("a", "counter", "increment", (old) => {
    const count = old ? JSON.parse(old).count : 0;
    return { content: document(count + 1), result: count + 1 };
  })));
  assert.equal(JSON.parse(await wal.read("a", "counter")).count, 20);
  const version = await wal.version("a", "counter");
  const raced = await Promise.allSettled([1, 2].map(() => wal.mutate("a", "counter", "expected-update",
    (old) => ({ content: document(JSON.parse(old).count + 1), result: null }), { expectedRevision: version })));
  assert.equal(raced.filter(({ status }) => status === "fulfilled").length, 1);
  assert.equal(raced.filter(({ status }) => status === "rejected").length, 1);
  assert.equal(JSON.parse(await wal.read("a", "counter")).count, 21);
});

test("multi-key groups replay atomically and exact accepted identities deduplicate", async (t) => {
  const { root, wal } = await fixture(t);
  const request = { id: "pair", source: "controller", cause: "paired-state", requestDigest: hostStateDigest("cause"),
    changes: [{ namespace: "controller", key: "state", content: document(1), expectedDigest: null },
      { namespace: "operation", key: "state", content: document(2), expectedDigest: null }] };
  const first = await wal.commit(request);
  assert.equal((await wal.commit(request)).seq, first.seq);
  assert.equal((await wal.commit(request)).duplicate, true);
  await assert.rejects(wal.commit({ ...request, changes: [{ ...request.changes[0], content: document(3) }] }), /conflicts/);
  await wal.close();
  const replay = getHostStateWal(root);
  assert.equal(await replay.read("controller", "state"), document(1));
  assert.equal(await replay.read("operation", "state"), document(2));
  await replay.mutate("controller", "state", "delete", () => ({ content: null, result: null }));
  assert.equal(await replay.read("controller", "state"), undefined);
  assert.equal(await replay.version("controller", "state"), 2);
  await closeHostStateWal(root);
});

test("reentrant reads are consistent, mutations reject rather than deadlock, notifications can write after commit", async (t) => {
  const { wal } = await fixture(t);
  await wal.mutate("a", "state", "seed", () => ({ content: document(1), result: null }));
  await wal.transaction("module", "group", async (view) => {
    assert.equal(await wal.read("a", "state"), view.read("a", "state"));
    await assert.rejects(wal.mutate("b", "state", "nested", () => ({ content: document(4), result: null })), /reentrant/);
    return { changes: [{ namespace: "a", key: "state", content: document(2) }], result: null };
  }).then(() => wal.mutate("b", "state", "post-commit", () => ({ content: document(3), result: null })));
  assert.equal(await wal.read("a", "state"), document(2));
  assert.equal(await wal.read("b", "state"), document(3));
});

test("another process cannot acquire the workspace writer and cannot take over a stale lock", async (t) => {
  const { root, wal } = await fixture(t);
  await wal.mutate("a", "state", "seed", () => ({ content: document(1), result: null }));
  const moduleUrl = pathToFileURL(fileURLToPath(new URL("../runtime-src/domain/host-state-wal.ts", import.meta.url))).href;
  const script = `import {getHostStateWal} from ${JSON.stringify(moduleUrl)};
    try { await getHostStateWal(${JSON.stringify(root)}).mutate('child','state','attempt',()=>({content:'{}',result:null}));process.exitCode=2; }
    catch(error){ console.log(error.message.includes('exclusive workspace writer')?'blocked':'unexpected'); }`;
  const run = () => promisify(execFile)(process.execPath, ["--input-type=module", "-e", script]);
  assert.equal((await run()).stdout.trim(), "blocked");
  await wal.close();
  await writeFile(join(root, ".tandem", "living-canvas", "host-state", "writer.lock"), JSON.stringify({ pid: 999999, token: "not-owned" }));
  assert.equal((await run()).stdout.trim(), "blocked");
});

test("a drained exiting owner releases only its WAL lease without creating a native close receipt", async (t) => {
  const { root, wal } = await fixture(t);
  const moduleUrl = pathToFileURL(fileURLToPath(new URL("../runtime-src/domain/host-state-wal.ts", import.meta.url))).href;
  const script = `import {getHostStateWal} from ${JSON.stringify(moduleUrl)};
    await getHostStateWal(${JSON.stringify(root)}).mutate('module','state','write',()=>({content:'{"pending":true}',result:null}));`;
  await promisify(execFile)(process.execPath, ["--input-type=module", "-e", script]);
  assert.equal(await wal.read("module", "state"), '{"pending":true}');
  assert.equal(await wal.version("module", "state"), 1);
});

test("hard-killed writer recovery preserves journal bytes and serializes competing reopeners", { timeout: 20_000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "host-wal-recovery-")), wal = getHostStateWal(root);
  const moduleUrl = new URL("../runtime-src/domain/host-state-wal.ts", import.meta.url).href;
  const children = [];
  const launch = async (body) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e",
      `import {getHostStateWal} from ${JSON.stringify(moduleUrl)}; const wal=getHostStateWal(${JSON.stringify(root)}); ${body}`],
    { stdio: ["ignore", "pipe", "ignore"] });
    children.push(child);
    return { child, output: (await once(child.stdout, "data"))[0].toString().trim() };
  };
  const terminate = async (child) => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, "exit");
    child.kill("SIGKILL"); await exited;
  };
  t.after(async () => {
    for (const child of children) await terminate(child);
    await wal.close(); await rm(root, { recursive: true, force: true });
  });
  const first = await launch(`await wal.mutate('work','state','admitted',()=>({content:'{"pending":true}',result:null}));
    process.stdout.write('ready\\n'); setInterval(()=>{},1000);`);
  assert.equal(first.output, "ready");
  const original = await readFile(wal.path);
  await terminate(first.child);
  await access(join(root, ".tandem", "living-canvas", "host-state", "writer.lock"));
  const contender = `try {
    if(await wal.read('work','state')!=='{"pending":true}') throw new Error('Lost history');
    process.stdout.write('acquired\\n'); setInterval(()=>{},1000);
  } catch(error) { process.stdout.write(error.message.includes('exclusive workspace writer')?'blocked\\n':'unexpected\\n'); }`;
  const races = await Promise.all([launch(contender), launch(contender)]);
  assert.deepEqual(races.map(({ output }) => output).sort(), ["acquired", "blocked"]);
  for (const { child } of races) await terminate(child);
  assert.equal(await wal.read("work", "state"), '{"pending":true}');
  assert.deepEqual(await readFile(wal.path), original);
});

test("append uncertainty latches queued writers without publishing or reusing sequence", async (t) => {
  const { root, wal } = await fixture(t, { boundary: (point) => { if (point === "after-append") throw new Error("Lost append outcome."); } });
  let secondComputed = false;
  const writes = await Promise.allSettled([
    wal.mutate("a", "state", "first", () => ({ content: document(1), result: null })),
    wal.mutate("a", "state", "later", () => { secondComputed = true; return { content: document(2), result: null }; }),
  ]);
  assert.ok(writes.every(({ status }) => status === "rejected"));
  assert.equal(secondComputed, false);
  assert.equal(wal.failed, true);
  await assert.rejects(wal.read("a", "state"), /uncertain/);
  await wal.close();
  await access(join(root, ".tandem", "living-canvas", "host-state", "writer.lock"));
});

for (const damage of ["tail", "checksum", "oversized"]) test(`replay rejects ${damage} without repairing old evidence`, async (t) => {
  const { root, wal } = await fixture(t);
  await wal.mutate("a", "state", "seed", () => ({ content: document(1), result: null }));
  await wal.close();
  if (damage === "tail") await appendFile(wal.path, "00000020:{");
  else if (damage === "oversized") await appendFile(wal.path, "ffffffff:");
  else {
    const bytes = await readFile(wal.path);
    bytes[bytes.length - 8] ^= 1;
    await writeFile(wal.path, bytes);
  }
  const before = await readFile(wal.path);
  const next = getHostStateWal(root);
  await assert.rejects(next.read("a", "state"), /replay failed/);
  assert.deepEqual(await readFile(wal.path), before);
  await next.close();
});

test("verified migration retains old bytes as backups and new state exists only in the WAL", async (t) => {
  const { root, wal } = await fixture(t);
  const path = join(root, ".tandem", "living-canvas", "legacy.json");
  await mkdir(join(root, ".tandem", "living-canvas"), { recursive: true });
  await writeFile(path, document(1));
  const file = new HostStateFile(root, path);
  assert.equal(await file.read(), document(1));
  await assert.rejects(file.transact("unsafe", () => ({ content: document(2), result: null })), /verified.*migration/);
  let verified = 0;
  const request = { workspaceRoot: root, id: "migration", sources: [{ file, validate: (raw) => {
    assert.equal(JSON.parse(raw).schemaVersion, "counter/v1");
  } }], verifyQuiescent: async () => { verified++; } };
  await migrateHostState(request);
  assert.equal(verified, 2);
  assert.equal((await migrateHostState(request)).duplicate, true);
  await file.transact("delete-imported", () => ({ content: null, result: null }));
  await assert.rejects(migrateHostState({ ...request, id: "resurrect" }), /stale expected document (revision|digest)/);
  await assert.rejects(wal.commit({ id: "direct-resurrection", source: "migration", cause: "import",
    changes: [{ namespace: file.namespace, key: file.key, content: document(1), expectedDigest: null, expectedRevision: 0 }] }),
  /stale expected document revision/);
  assert.equal((await migrateHostState(request)).duplicate, true);
  assert.equal(await file.read(), undefined);
  await file.transact("restore-explicitly", () => ({ content: document(1), result: null }));
  await file.transact("update", (raw) => ({ content: document(JSON.parse(raw).count + 1), result: null }));
  assert.equal(await file.read(), document(2));
  assert.equal(await readFile(path, "utf8"), document(1));
  await rm(path);
  await wal.close();
  assert.equal(await file.read(), document(2));
  await closeHostStateWal(root);
});

test("bounded document history retains all validated versions and refuses truncated recovery evidence", async t => {
  const { root, wal } = await fixture(t);
  assert.deepEqual(await wal.history("installation", "state"), []);
  await wal.mutate("installation", "state", "prepared", () => ({ content: document(1), result: null }));
  await wal.mutate("unrelated", "state", "other", () => ({ content: document(99), result: null }));
  await wal.mutate("installation", "state", "failed", () => ({ content: document(2), result: null }));
  const original = await readFile(wal.path);
  const history = await wal.history("installation", "state");
  assert.deepEqual(history.map(({ version, cause, content, seq }) => ({ version, cause, content, seq })),
    [{ version: 1, cause: "prepared", content: document(1), seq: 1 },
      { version: 2, cause: "failed", content: document(2), seq: 3 }]);
  await assert.rejects(wal.history("installation", "state", 1), /no evidence was truncated/);
  assert.deepEqual(await readFile(wal.path), original);
  await wal.close();
  const reopened = getHostStateWal(root);
  assert.deepEqual(await reopened.history("installation", "state"), history);
  await reopened.close();
});

test("specification documents are immutable referenced objects and nested document writes form one group", async (t) => {
  const { root, wal } = await fixture(t);
  const a = new HostStateFile(root, join(root, ".tandem", "living-canvas", "design", "blocks", "use-case.json"), undefined, { artifact: true });
  const b = new HostStateFile(root, join(root, ".tandem", "living-canvas", "design", "manifest.json"));
  await b.run("promote", async () => {
    await a.write("block", document(1));
    assert.equal(await a.read(), document(1));
    await b.write("manifest", document(2));
  });
  assert.equal(await a.read(), document(1));
  const stored = JSON.parse(await wal.read(a.namespace, a.key));
  assert.equal(stored.schemaVersion, "host-state-blob/v1");
  assert.equal(await wal.version(a.namespace, a.key), 1);
  await assert.rejects(access(a.path), { code: "ENOENT" });
  const raw = await readFile(wal.path, "utf8");
  assert.equal(raw.split('\n').filter(Boolean).length, 1);
});
