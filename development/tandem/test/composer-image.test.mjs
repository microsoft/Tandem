import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import jpeg from '../node_modules/jpeg-js/index.js';
import { deflateSync } from 'node:zlib';
import { inspectAnnotationPng } from '../runtime-src/domain/workflow/annotation-attachment.ts';
import { ImageAttachmentStore, inspectComposerImage, parseRequestAttachments } from '../runtime-src/domain/workflow/image-attachment.ts';
import { parseRequest } from '../runtime-src/domain/human-loop/contracts.ts';
import { HumanLoopStore } from '../src/human-loop-store.mjs';
import { DEFAULT_POLICY } from '../runtime-src/domain/workflow/policy.ts';
import { getHostStateWal } from '../runtime-src/domain/host-state-wal.ts';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');
const jpg = jpeg.encode({ width: 2, height: 1, data: Buffer.from([255, 0, 0, 255, 0, 255, 0, 255]) }, 80).data;
for (const [mime, bytes] of [['image/png', png], ['image/jpeg', jpg]]) {
  test(`composer ${mime} retains exact bytes and image-only request across durable reload`, async t => {
    const root = await mkdtemp(join(tmpdir(), 'composer-image-'));
    t.after(async () => { await getHostStateWal(root).close(); await rm(root, { recursive: true, force: true }); });
    const images = new ImageAttachmentStore(root), attachment = await images.put(bytes, mime);
    assert.equal(attachment.schemaVersion, 'image-attachment/v1');
    assert.equal(Object.hasOwn(attachment, 'source'), false);
    assert.deepEqual(await images.read(attachment), bytes);
    assert.deepEqual(await images.put(bytes, mime), attachment);
    const input = { id: 'request-image', message: '', receivedAt: new Date().toISOString(), answers: null, attachments: [attachment] };
    assert.deepEqual(parseRequest(input), input);
    const owner = { schemaVersion: 'human-loop-owner/v1', id: 'owner', mainSessionId: 'main', privateSessionId: 'private',
      workspacePath: root, policy: DEFAULT_POLICY };
    const store = new HumanLoopStore(owner);
    await store.initialize({ revisionId: null, digest: null });
    await store.dispatch('user', 'receive-image', 'receive-request', input);
    await store.dispatch('user', 'receive-image', 'receive-request', input);
    const restored = await new HumanLoopStore(owner).load();
    assert.equal(restored.requests.length, 1);
    assert.equal(restored.requests[0].message, '');
    assert.deepEqual(restored.requests[0].attachments, [attachment]);
    assert.deepEqual(await new ImageAttachmentStore(root).read(restored.requests[0].attachments[0]), bytes);
    assert.throws(() => parseRequest({ ...input, attachments: undefined }));
    assert.throws(() => parseRequestAttachments([{ ...attachment, source: {} }]));
    assert.throws(() => parseRequestAttachments([{ ...attachment, id: '0'.repeat(64) }]));
    await writeFile(join(root, '.tandem', 'living-canvas', 'image-attachments', `${attachment.id}.image`), Buffer.alloc(bytes.length));
    await assert.rejects(images.read(attachment), /Invalid|changed/);
    await store.close();
  });
}
test('composer raster validation rejects corruption, active formats and excessive bytes', () => {
  for (const [bytes, mime] of [[Buffer.from('<svg onload="alert(1)"/>'), 'image/svg+xml'], [png, 'image/jpeg'],
    [jpg.subarray(0, jpg.length - 2), 'image/jpeg'], [Buffer.alloc(4 * 1024 * 1024 + 1), 'image/png']]) {
    assert.throws(() => inspectComposerImage(bytes, mime));
  }
});

function adam7Png(width, height, filter = 0) {
  const chunk = (kind, content) => {
    const value = Buffer.alloc(content.length + 12); value.writeUInt32BE(content.length);
    value.write(kind, 4); content.copy(value, 8);
    let crc = 0xffffffff;
    for (const byte of value.subarray(4, -4)) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    value.writeUInt32BE((crc ^ 0xffffffff) >>> 0, value.length - 4); return value;
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6; header[12] = 1;
  const rows = [];
  for (const [x, y, dx, dy] of [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]]) {
    const columns = Math.max(0, Math.ceil((width - x) / dx));
    if (columns) for (let row = y; row < height; row += dy) {
      const data = Buffer.alloc(columns * 4 + 1); data[0] = filter; rows.push(data);
    }
  }
  return Buffer.concat([png.subarray(0, 8), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}
test('general PNG accepts bounded Adam7 passes without relaxing annotation encoding', () => {
  for (const [width, height] of [[1, 1], [2, 7], [17, 19]]) {
    const bytes = adam7Png(width, height);
    assert.deepEqual(inspectComposerImage(bytes, 'image/png'), { width, height });
    assert.throws(() => inspectAnnotationPng(bytes), /non-interlaced/);
    assert.throws(() => inspectComposerImage(adam7Png(width, height, 5), 'image/png'), /filter/);
  }
  assert.throws(() => inspectComposerImage(adam7Png(4097, 1), 'image/png'), /dimensions/);
});
