import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rename, rm, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { HostStateFile, hostDirectoryEntries } from "../runtime-src/domain/host-state-file.ts";
import { getHostStateWal } from "../runtime-src/domain/host-state-wal.ts";
import { ensureTandemWorkspace } from "../runtime-src/domain/product-paths.ts";
import { ImageAttachmentStore } from "../runtime-src/domain/workflow/image-attachment.ts";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "tandem-rename-"));
  t.after(async () => { await getHostStateWal(root).close(); await rm(root, { recursive: true, force: true }); });
  return root;
}

test("new projects use Tandem storage and no legacy namespace", async (t) => {
  const root = await fixture(t);
  const file = new HostStateFile(root, join(root, ".tandem", "living-canvas", "conversation.json"));
  await file.mutate("new", () => ({ content: '{"text":"new"}', result: null }));
  assert.equal(file.namespace, "workspace/.tandem/living-canvas");
  await access(join(root, ".tandem", "living-canvas", "host-state", "journal.wal"));
  await assert.rejects(access(join(root, ".teleos")), { code: "ENOENT" });
});

test("old workspace upgrades without rewriting WAL, historical Conversation, blob or index bytes", async (t) => {
  const root = await fixture(t);
  const historical = JSON.stringify({ text: "Exact TELEOS.md and .teleos history must remain unchanged.", data: "x".repeat(300000) });
  const file = new HostStateFile(root, join(root, ".tandem", "living-canvas", "human-loop", "conversation.json"),
    "workspace/.teleos/living-canvas/human-loop");
  await file.mutate("historical", () => ({ content: historical, result: null }));
  const journal = join(root, ".tandem", "living-canvas", "host-state", "journal.wal");
  await getHostStateWal(root).close();
  const bytes = await readFile(journal);
  await rename(join(root, ".tandem"), join(root, ".teleos"));
  const index = "# User notes\n\n<!-- teleos:human-loop:evidence:start -->\nRetained evidence\n<!-- teleos:human-loop:evidence:end -->\n";
  await writeFile(join(root, "TELEOS.md"), index);
  ensureTandemWorkspace(root);
  assert.deepEqual(await readFile(journal), bytes);
  assert.equal(await readFile(join(root, "TANDEM.md"), "utf8"), index);
  const current = new HostStateFile(root, join(root, ".tandem", "living-canvas", "human-loop", "conversation.json"));
  assert.equal(await current.read(), historical);
  assert.ok((await hostDirectoryEntries(root, join(root, ".tandem", "living-canvas"))).includes("human-loop"));
  await current.mutate("append", (old) => ({ content: JSON.stringify({ ...JSON.parse(old), next: "Tandem" }), result: null }));
  await getHostStateWal(root).close();
  assert.equal(JSON.parse(await current.read()).text, JSON.parse(historical).text);
  assert.deepEqual((await readFile(journal)).subarray(0, bytes.length), bytes);
  ensureTandemWorkspace(root);
  await assert.rejects(access(join(root, ".teleos")), { code: "ENOENT" });
  await assert.rejects(access(join(root, "TELEOS.md")), { code: "ENOENT" });
});

for (const collision of ["storage", "index"]) test(`dual ${collision} paths fail without overwriting either`, async (t) => {
  const root = await fixture(t);
  if (collision === "storage") {
    await mkdir(join(root, ".teleos")); await mkdir(join(root, ".tandem"));
  } else {
    await writeFile(join(root, "TELEOS.md"), "old"); await writeFile(join(root, "TANDEM.md"), "new");
  }
  assert.throws(() => ensureTandemWorkspace(root), /collision/);
  if (collision === "index") {
    assert.equal(await readFile(join(root, "TELEOS.md"), "utf8"), "old");
    assert.equal(await readFile(join(root, "TANDEM.md"), "utf8"), "new");
  }
  // Remove only the synthetic collision so ordinary fixture cleanup can acquire its WAL.
  await rm(join(root, collision === "storage" ? ".teleos" : "TELEOS.md"), { recursive: collision === "storage" });
});

test("migration refuses a live old writer and preserves its journal", async (t) => {
  const root = await fixture(t);
  const directory = join(root, ".teleos", "living-canvas", "host-state");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "writer.lock"), JSON.stringify({
    schemaVersion: "host-state-writer/v1", token: "00000000-0000-4000-8000-000000000001", pid: process.pid, workspace: root,
  }));
  assert.throws(() => ensureTandemWorkspace(root), /active legacy runtime/);
  await access(join(root, ".teleos"));
  await rm(join(directory, "writer.lock"));
});

test("migration preserves real image metadata identity and exact image bytes", async (t) => {
  const root = await fixture(t);
  await mkdir(join(root, ".teleos"));
  ensureTandemWorkspace(root);
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=", "base64");
  const store = new ImageAttachmentStore(root), ref = await store.put(png, "image/png");
  await getHostStateWal(root).close();
  assert.deepEqual(await new ImageAttachmentStore(root).read(ref), png);
});

test("migration excludes a legacy SQLite writer before its ownership file exists", async (t) => {
  const root = await fixture(t);
  const directory = join(root, ".teleos", "living-canvas", "host-state");
  await mkdir(directory, { recursive: true });
  const writer = new DatabaseSync(join(directory, "writer-lease.sqlite"));
  try {
    writer.exec("BEGIN EXCLUSIVE");
    assert.throws(() => ensureTandemWorkspace(root), /active legacy runtime/);
    await access(join(root, ".teleos"));
    await assert.rejects(access(join(root, ".tandem")), { code: "ENOENT" });
  } finally { writer.close(); }
});

test("migration retains live legacy exclusion during move and never overwrites a late index", async (t) => {
  const root = await fixture(t);
  await mkdir(join(root, ".teleos"));
  await writeFile(join(root, "TELEOS.md"), "retained index");
  const move = fs.renameSync;
  t.mock.method(fs, "renameSync", (from, to) => {
    const owner = JSON.parse(fs.readFileSync(join(from, "living-canvas", "host-state", "writer.lock"), "utf8"));
    assert.equal(owner.schemaVersion, "host-state-writer/v1");
    assert.equal(owner.pid, process.pid);
    assert.equal(owner.workspace, root);
    assert.ok(owner.token);
    // The old runtime refuses this live owner even after the SQLite guard closes.
    assert.doesNotThrow(() => process.kill(owner.pid, 0));
    fs.writeFileSync(join(root, "TANDEM.md"), "concurrent user index", { flag: "wx" });
    move(from, to);
  });
  syncBuiltinESMExports();
  try { assert.throws(() => ensureTandemWorkspace(root), { code: "EEXIST" }); }
  finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  assert.equal(await readFile(join(root, "TANDEM.md"), "utf8"), "concurrent user index");
  assert.equal(await readFile(join(root, "TELEOS.md"), "utf8"), "retained index");
  await assert.rejects(access(join(root, ".tandem", "living-canvas", "host-state", "writer.lock")), { code: "ENOENT" });
  await rm(join(root, "TELEOS.md"));
});
