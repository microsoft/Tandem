import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Session } from "node:inspector";
import { promisify } from "node:util";
import { HumanLoopStore } from "../src/human-loop-store.mjs";
import { HostStateFile } from "../runtime-src/domain/host-state-file.ts";
import { getHostStateWal } from "../runtime-src/domain/host-state-wal.ts";
import { DEFAULT_POLICY } from "../runtime-src/domain/workflow/policy.ts";
import { replayHumanLoopLedger } from "../runtime-src/domain/human-loop/ledger.ts";
import { longHumanHistory } from "./helpers/human-loop-long-history.mjs";

async function fixture(t, rounds = 0) {
  const root = await mkdtemp(join(tmpdir(), "human-derived-"));
  const owner = { schemaVersion: "human-loop-owner/v1", id: "owner", mainSessionId: "main",
    privateSessionId: "private", workspacePath: root, policy: DEFAULT_POLICY };
  const store = new HumanLoopStore(owner);
  const file = new HostStateFile(root, join(root, ".tandem", "living-canvas", "human-loop", "ledger.json"));
  t.after(async () => { await store.close(); await rm(root, { recursive: true, force: true }); });
  const { ledger, state } = longHumanHistory(owner, rounds);
  await store.initialize(ledger.initialDesign);
  await file.mutate("fixture-history", () => ({ content: JSON.stringify(ledger), result: null }));
  assert.deepEqual(await store.load(), state);
  return { store, file, root, owner, state, ledger };
}
const request = id => ({ id, message: `  Exact ${id}\ncontent.`, receivedAt: "2026-09-23T10:00:00Z", answers: null });
const receive = (store, id) => store.dispatch("user", `receive:${id}`, "receive-request", request(id));
const replay = async file => replayHumanLoopLedger(JSON.parse(await file.read())).state;

test("normal long-session reads and successful appends apply transitions without replay", async t => {
  const f = await fixture(t, 72), inspector = new Session(); inspector.connect();
  const post = promisify(inspector.post.bind(inspector));
  try {
    await post("Profiler.enable");
    await post("Profiler.startPreciseCoverage", { callCount: true, detailed: false });
    await new HumanLoopStore(f.owner).load();
    const replayCalls = result => result.filter(script => script.url.endsWith("/human-loop/ledger.ts"))
      .flatMap(script => script.functions).filter(fn => fn.functionName === "replayHumanLoopLedger")
      .reduce((count, fn) => count + fn.ranges[0].count, 0);
    assert.equal(replayCalls((await post("Profiler.takePreciseCoverage")).result), 1, "Cold reconstruction is the positive profiler control.");
    for (let i = 0; i < 12; i++) {
      await f.store.load(); await receive(f.store, `new-${i}`); await f.store.load();
    }
    const { result } = await post("Profiler.takePreciseCoverage");
    assert.equal(replayCalls(result), 0);
    await post("Profiler.stopPreciseCoverage");
    assert.deepEqual(await f.store.load(), await replay(f.file));
    assert.equal((await f.store.load()).revision, f.state.revision + 12);
    const restored = new HumanLoopStore(f.owner);
    assert.deepEqual(await restored.load(), await f.store.load());
    assert.deepEqual((await restored.load()).handoffs, f.state.handoffs);
    assert.deepEqual((await restored.load()).executions, f.state.executions);
  } finally { inspector.disconnect(); }
});

test("derived state and subscribers cannot mutate committed data; retries and concurrent writes remain exact", async t => {
  const f = await fixture(t, 2);
  f.store.subscribe(state => { state.owner.id = "tampered"; state.requests.length = 0; });
  const observed = []; f.store.subscribe(state => observed.push(state));
  const result = await receive(f.store, "first");
  result.requests[0].message = "mutated returned object"; result.applied.length = 0;
  const loaded = await f.store.load(); loaded.owner.id = "changed owner";
  observed[0].requests.length = 0;
  assert.deepEqual(await f.store.load(), await replay(f.file));
  const before = await f.file.read();
  await receive(f.store, "first"); assert.equal(await f.file.read(), before);
  await assert.rejects(f.store.dispatch("user", "receive:first", "receive-request", { ...request("first"), message: "conflicting" }), /Conflicting retry/);
  await Promise.all(Array.from({ length: 12 }, (_, i) => receive(f.store, `parallel-${i}`)));
  assert.deepEqual(await f.store.load(), await replay(f.file));
  assert.equal((await f.store.load()).revision, f.state.revision + 13);
});

test("outer transaction rollback and commit-stage failure never publish uncommitted derived state", async t => {
  const f = await fixture(t, 1), notifications = [];
  f.store.subscribe(state => notifications.push(state.revision));
  await assert.rejects(f.file.run("outer-abort", async () => {
    await receive(f.store, "rolled-back");
    assert.equal((await f.store.load()).revision, f.state.revision + 1);
    assert.deepEqual(notifications, []);
    throw new Error("Abort outer transaction.");
  }), /Abort outer/);
  assert.deepEqual(await f.store.load(), f.state);
  const wal = getHostStateWal(f.root), original = wal.transaction.bind(wal);
  wal.transaction = (source, cause, update) => original(source, cause, async view => {
    await update(view);
    throw new Error("Injected commit-stage failure before append.");
  });
  try { await assert.rejects(receive(f.store, "failed-commit"), /commit-stage failure/); }
  finally { wal.transaction = original; }
  assert.deepEqual(notifications, []);
  assert.deepEqual(await f.store.load(), f.state);
  await receive(f.store, "committed");
  assert.deepEqual(notifications, [f.state.revision + 1]);
  assert.deepEqual(await f.store.load(), await replay(f.file));
});

test("authoritative replacement, other writer instances and corrupt documents invalidate derived state", async t => {
  const f = await fixture(t, 1), other = new HumanLoopStore(f.owner);
  await receive(other, "other-instance");
  assert.deepEqual(await f.store.load(), await replay(f.file));
  const valid = await f.file.read();
  const changed = JSON.parse(valid); changed.owner.id = "foreign";
  await f.file.mutate("foreign-owner", () => ({ content: JSON.stringify(changed), result: null }));
  await assert.rejects(f.store.load(), /owner changed/);
  await assert.rejects(receive(f.store, "must-not-write"), /owner changed/);
  await f.file.mutate("restore-test-document", () => ({ content: valid, result: null }));
  const corrupt = JSON.parse(valid); corrupt.events.at(-1).command.expectedRevision = 123456;
  await f.file.mutate("invalid-transition", () => ({ content: JSON.stringify(corrupt), result: null }));
  await assert.rejects(f.store.load(), /Stale lifecycle revision/);
  await f.file.mutate("remove-test-document", () => ({ content: null, result: null }));
  await assert.rejects(f.store.load(), /missing data/);
  await f.file.mutate("restore-test-document", () => ({ content: valid, result: null }));
  assert.deepEqual(await f.store.load(), await replay(f.file));
});
