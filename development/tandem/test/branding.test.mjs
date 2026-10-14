import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import jpeg from 'jpeg-js';
import { transparentLogo } from '../scripts/prepare-themed-branding.mjs';

for (const [theme, hash, background] of [
  ['light', '4620af75c80ffa0da2b5861355cda54bee89a4f21beb191106e1e77e68a1d7d0', [255, 255, 255]],
  ['dark', '3815d81cbf55c13ba76bfb63600d6d24a50378d12401f3a571eafeab6b304636', [16, 23, 39]],
]) test(`${theme} logo preserves exact original, reproducible transparency, opaque ink and enclosed cutouts`, async () => {
  const source = await readFile(new URL(`../public/branding/tandem-blue-${theme}-original.jpg`, import.meta.url));
  assert.equal(createHash('sha256').update(source).digest('hex'), hash);
  const output = await readFile(new URL(`../public/branding/tandem-blue-${theme}.png`, import.meta.url));
  assert.deepEqual(transparentLogo(source, background), output);
  const image = jpeg.decode(source, { useTArray: true });
  assert.equal(output.readUInt32BE(16), image.width);
  assert.equal(output.readUInt32BE(20), image.height);
  const chunks = [];
  for (let p = 8; p < output.length;) {
    const length = output.readUInt32BE(p);
    if (output.toString('ascii', p + 4, p + 8) === 'IDAT') chunks.push(output.subarray(p + 8, p + 8 + length));
    p += 12 + length;
  }
  const rows = inflateSync(Buffer.concat(chunks));
  let ink = 0, transparent = 0, edges = 0;
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const i = (y * image.width + x) * 4, p = y * (image.width * 4 + 1) + 1 + x * 4, alpha = rows[p + 3];
    assert.equal(rows[y * (image.width * 4 + 1)], 0);
    if (alpha === 255) {
      ink++;
      assert.deepEqual(rows.subarray(p, p + 3), Buffer.from(image.data.subarray(i, i + 3)));
    } else if (alpha === 0) transparent++;
    else edges++;
    const distance = Math.hypot(...background.map((b, c) => image.data[i + c] - b));
    if (distance <= 12) assert.equal(alpha, 0, `Matte/cutout at ${x},${y} must be transparent.`);
  }
  assert.ok(ink > 30_000 && transparent > 200_000 && edges > 1_000);
});
