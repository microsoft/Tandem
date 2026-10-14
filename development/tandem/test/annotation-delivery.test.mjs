import assert from "node:assert/strict";
import { getHostStateWal } from "../runtime-src/domain/host-state-wal.ts";
import test from "node:test";
import { mkdtemp, rm, writeFile, readdir, mkdir, symlink } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { crc32 } from "node:zlib";
import { AnnotationAttachmentStore, annotationCapabilities, inspectAnnotationPng, parseAnnotationAttachments } from "../runtime-src/domain/workflow/annotation-attachment.ts";
import { DEFAULT_POLICY } from "../runtime-src/domain/workflow/policy.ts";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=", "base64");
const source = { revisionId: "r1", perspective: "contract", selectionId: null, viewport: { x: 0, y: 0, width: 1, height: 1, scale: 1 } };
const model = { id: "vision", capabilities: { supports: { vision: true }, limits: { vision: {
  supported_media_types: ["image/png"], max_prompt_images: 1, max_prompt_image_size: 1024,
} } } };

test("unsent uploads remain immutable across concurrent upload, draft removal and restart without automatic cleanup", async (t) => {
  const root = await mkdtemp(resolve(".annotation-retention-test-"));
  t.after(async () => { await getHostStateWal(root).close(); await rm(root, { recursive: true, force: true }); });
  const store = new AnnotationAttachmentStore(root);
  const refs = await Promise.all([store.put(png, source), store.put(png, source)]);
  assert.deepEqual(refs[0], refs[1]);
  const restarted = new AnnotationAttachmentStore(root);
  assert.deepEqual(await restarted.get(refs[0].id), { attachment: refs[0], bytes: png });
  const files = await readdir(join(root, ".tandem", "living-canvas", "annotation-attachments"));
  assert.deepEqual(files, [`${refs[0].id}.png`]);
  assert.equal(typeof restarted.delete, "undefined");
});

test("annotation parser rejects signature, dimensions, checksum, truncation and byte overflows", () => {
  assert.deepEqual(inspectAnnotationPng(png), { width: 1, height: 1 });
  assert.throws(() => inspectAnnotationPng(Buffer.alloc(4194305)), /oversized/);
  assert.throws(() => inspectAnnotationPng(png.subarray(0, -1)), /Incomplete/);
  const bad = Buffer.from(png); bad[40] ^= 1;
  assert.throws(() => inspectAnnotationPng(bad), /checksum/);
  const large = Buffer.from(png); large.writeUInt32BE(4097, 16);
  large.writeUInt32BE(crc32(large.subarray(12, 29)), 29);
  assert.throws(() => inspectAnnotationPng(large), /dimensions/);
});

test("selected native model requires positive PNG, image count and byte limits without switching", async () => {
  const session = (id) => ({ rpc: { model: { get: async () => ({ modelId: id }) } } });
  const client = { listModels: async () => [model] };
  assert.equal((await annotationCapabilities(session("vision"), client)).limits.maxBytes, 1024);
  for (const id of ["auto", "unknown", undefined]) {
    assert.equal((await annotationCapabilities(session(id), client)).supported, false);
  }
  for (const invalid of [
    { ...model, capabilities: { ...model.capabilities, supports: { vision: false } } },
    { ...model, capabilities: { supports: { vision: true }, limits: {} } },
    { ...model, capabilities: { supports: { vision: true }, limits: { vision: { ...model.capabilities.limits.vision, max_prompt_images: 0 } } } },
  ]) assert.equal((await annotationCapabilities(session("vision"), { listModels: async () => [invalid] })).supported, false);
});

test("annotation storage rejects redirected directories and mismatched viewport dimensions before publication", async (t) => {
  const root = await mkdtemp(resolve(".annotation-owned-test-"));
  const elsewhere = await mkdtemp(resolve(".annotation-outside-test-"));
  t.after(async () => { await rm(root, { recursive: true, force: true }); await rm(elsewhere, { recursive: true, force: true }); });
  await symlink(elsewhere, join(root, ".tandem"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(new AnnotationAttachmentStore(root).put(png, source), /owned directory/);
  assert.deepEqual(await readdir(elsewhere), []);
  const clean = join(root, "clean");
  await mkdir(clean);
  await assert.rejects(new AnnotationAttachmentStore(clean).put(png, {
    ...source, viewport: { ...source.viewport, width: 2 },
  }), /dimensions differ/);
  assert.deepEqual(await readdir(clean), []);
});
