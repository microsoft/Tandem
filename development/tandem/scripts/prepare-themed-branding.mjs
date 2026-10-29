import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import jpeg from 'jpeg-js';

const sources = [
  ['light', '4620af75c80ffa0da2b5861355cda54bee89a4f21beb191106e1e77e68a1d7d0', [255, 255, 255]],
  ['dark', '3815d81cbf55c13ba76bfb63600d6d24a50378d12401f3a571eafeab6b304636', [16, 23, 39]],
];
const root = new URL('../public/branding/', import.meta.url);
function chunk(type, data) {
  const payload = Buffer.concat([Buffer.from(type), data]);
  const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  checksum.writeUInt32BE(crc32(payload));
  return Buffer.concat([length, payload, checksum]);
}
export function transparentLogo(original, background) {
  const { width, height, data } = jpeg.decode(original, { useTArray: true });
  if (width !== 1200 || height !== 260) throw new Error('Unexpected logo dimensions.');
  const distance = new Float64Array(width * height), core = new Uint8Array(width * height);
  for (let i = 0; i < distance.length; i++) {
    distance[i] = Math.hypot(...background.map((b, channel) => data[i * 4 + channel] - b));
  }
  // Eroded foreground samples preserve ink; background-coloured holes are matte too.
  for (let y = 2; y < height - 2; y++) for (let x = 2; x < width - 2; x++) {
    const i = y * width + x;
    if (distance[i] < 60) continue;
    let interior = true;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (distance[(y + dy) * width + x + dx] <= 12) interior = false;
    }
    core[i] = Number(interior);
  }
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x, target = y * (width * 4 + 1) + 1 + x * 4;
    const color = Array.from(data.subarray(i * 4, i * 4 + 3));
    if (distance[i] <= 12) continue;
    let alpha = 1, foreground = color;
    if (!core[i]) {
      let best = Infinity;
      for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height || !core[ny * width + nx]) continue;
        const offset = (ny * width + nx) * 4;
        const vector = background.map((b, c) => data[offset + c] - b);
        const denominator = vector.reduce((sum, v) => sum + v * v, 0);
        const a = Math.max(0, Math.min(1, vector.reduce((sum, v, c) => sum + (color[c] - background[c]) * v, 0) / denominator));
        const residual = vector.reduce((sum, v, c) => sum + (color[c] - background[c] - a * v) ** 2, 0);
        const score = residual + dx * dx + dy * dy;
        if (score < best) { best = score; alpha = a; foreground = Array.from(data.subarray(offset, offset + 3)); }
      }
      if (best === Infinity && distance[i] < 60) alpha = 0;
    }
    if (alpha < .04) continue;
    if (alpha > .98) alpha = 1;
    // Sample existing adjacent ink for partial-alpha edges, avoiding amplified JPEG chroma halos.
    for (let c = 0; c < 3; c++) rows[target + c] = alpha === 1 ? color[c] : foreground[c];
    rows[target + 3] = Math.round(alpha * 255);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  for (const [theme, expectedHash, background] of sources) {
    const original = await readFile(new URL(`tandem-blue-${theme}-original.jpg`, root));
    if (createHash('sha256').update(original).digest('hex') !== expectedHash) throw new Error(`Unexpected ${theme} logo source.`);
    await writeFile(new URL(`tandem-blue-${theme}.png`, root), transparentLogo(original, background));
  }
}
