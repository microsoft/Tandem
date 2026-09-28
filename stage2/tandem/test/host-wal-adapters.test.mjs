import assert from "node:assert/strict";
import { mkdtemp, rm, access, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { getHostStateWal, closeHostStateWal } from "../runtime-src/domain/host-state-wal.ts";
import { BackboneArtifactStore } from "../runtime-src/domain/backbone/artifact-store.ts";
import { AnnotationAttachmentStore } from "../runtime-src/domain/workflow/annotation-attachment.ts";
import { healthDesign } from "./helpers/design-bootstrap-fixture.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "host-wal-adapters-"));
  t.after(async () => { await closeHostStateWal(root); await rm(root, { recursive: true, force: true }); });
  return root;
}
const absent = (root, name) => assert.rejects(access(join(root, ".tandem", "living-canvas", name)), { code: "ENOENT" });

test("Design promotion and annotation metadata use central records with external immutable content", async (t) => {
  const root = await fixture(t), artifacts = new BackboneArtifactStore(root), design = healthDesign();
  for (const [name, block] of Object.entries(design)) if (name !== "conclusion") await artifacts.writeBlock("initial", name, block);
  const before = (await getHostStateWal(root).inventory()).sequence;
  const current = await artifacts.conclude("initial", "request", design.conclusion);
  assert.equal((await getHostStateWal(root).inventory()).sequence, before + 1, "Canonical promotion is one correlated group.");
  assert.equal((await new BackboneArtifactStore(root).inspectCurrent()).id, current.id);
  assert.deepEqual(await artifacts.stagedBlocks("initial"), []);
  await absent(root, "design/manifest.json");
  await absent(root, "design/blocks/use-case.json");
  const reviewSnapshot = await artifacts.materializeReviewSnapshot(current.id);
  assert.equal(JSON.parse(await readFile(join(root, reviewSnapshot), "utf8")).id, current.id);
  assert.equal(await artifacts.materializeReviewSnapshot(current.id), reviewSnapshot);
  await absent(root, "design/manifest.json");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=", "base64");
  const store = new AnnotationAttachmentStore(root);
  const ref = await store.put(png, { revisionId: current.id, perspective: "gui", selectionId: null,
    viewport: { x: 0, y: 0, width: 1, height: 1, scale: 1 } });
  assert.deepEqual(await store.put(png, ref.source), ref);
  await absent(root, `annotation-attachments/${ref.id}.json`);
  assert.deepEqual((await new AnnotationAttachmentStore(root).get(ref.id)).bytes, png);
});
