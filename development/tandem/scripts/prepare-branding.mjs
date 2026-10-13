import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';
import jpeg from 'jpeg-js';

const original = await readFile(new URL('../public/branding/tandem-original.jpg', import.meta.url));
if (createHash('sha256').update(original).digest('hex') !== '3add413098bb0971cd751b6d79dccc50469c2d39afda0a6371065c24184eab0c') {
  throw new Error('Branding must be derived from the original supplied bicycle.');
}
const image = jpeg.decode(original, { useTArray: true });
const width = 472, height = 192, left = 28, top = 160;
const rows = Buffer.alloc((width * 4 + 1) * height);
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const source = ((y + top) * image.width + x + left) * 4;
    const target = y * (width * 4 + 1) + 1 + x * 4;
    const rgb = image.data.subarray(source, source + 3);
    // Only the near-white JPEG matte is removed; ink and pale wheel spokes stay intact.
    const alpha = Math.min(1, Math.max(0, (245 - Math.min(...rgb)) / 25));
    for (let channel = 0; channel < 3; channel++) {
      rows[target + channel] = alpha ? Math.max(0, Math.round((rgb[channel] - 255 * (1 - alpha)) / alpha)) : 0;
    }
    rows[target + 3] = Math.round(alpha * 255);
  }
}
function chunk(type, data) {
  const payload = Buffer.concat([Buffer.from(type), data]);
  const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  checksum.writeUInt32BE(crc32(payload));
  return Buffer.concat([length, payload, checksum]);
}
const header = Buffer.alloc(13);
header.writeUInt32BE(width); header.writeUInt32BE(height, 4);
header[8] = 8; header[9] = 6;
await writeFile(new URL('../public/branding/tandem-mark-transparent.png', import.meta.url), Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0)),
]));
