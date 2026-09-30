import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, lstat, link, unlink, open } from 'node:fs/promises';
import { HostStateFile } from '../host-state-file.ts';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import { object, requireCondition, text } from './validation.ts';
import { policyHash } from './policy.ts';

export const annotationLimits = Object.freeze({ maxImages: 1, maxBytes: 4 * 1024 * 1024, maxPixels: 4_000_000, maxEdge: 4096 });
interface AnnotationViewport {
  x: number; y: number; width: number; height: number; scale: number;
}
export interface LegacyAnnotationSource {
  revisionId: string; perspective: string; selectionId: string | null;
  viewport: AnnotationViewport;
}
export interface ArtifactAnnotationSource {
  schemaVersion: 'artifact-annotation/v1'; revisionId: string; designDigest: string; artifactId: string;
  selectionId: string | null; viewport: AnnotationViewport;
}
export type AnnotationSource = LegacyAnnotationSource | ArtifactAnnotationSource;
export interface AnnotationAttachment {
  id: string; sha256: string; mimeType: 'image/png'; byteLength: number; width: number; height: number; source: AnnotationSource;
}
export class StaleAnnotationError extends Error {
  readonly code = 'annotation-stale-revision';
  constructor() {
    super('Annotation snapshot belongs to a stale Design revision. The original image is retained; it cannot be rebound to the current Design.');
  }
}
export function parseAnnotationSource(value: unknown): AnnotationSource {
  const generic = value !== null && typeof value === 'object' && Object.hasOwn(value, 'schemaVersion');
  const data = object(value, generic
    ? ['schemaVersion', 'revisionId', 'designDigest', 'artifactId', 'selectionId', 'viewport']
    : ['revisionId', 'perspective', 'selectionId', 'viewport']);
  const viewport = object(data.viewport, ['x', 'y', 'width', 'height', 'scale']);
  const coordinate = (value: unknown) => {
    requireCondition(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0, 'Invalid annotation viewport.');
    return value;
  };
  const parsedViewport = { x: coordinate(viewport.x), y: coordinate(viewport.y),
    width: coordinate(viewport.width), height: coordinate(viewport.height), scale: coordinate(viewport.scale) };
  requireCondition(parsedViewport.width > 0 && parsedViewport.height > 0 && parsedViewport.scale === 1
    && Math.max(parsedViewport.width, parsedViewport.height) <= annotationLimits.maxEdge
    && parsedViewport.width * parsedViewport.height <= annotationLimits.maxPixels, 'Unsupported annotation viewport.');
  const base = { revisionId: text(data.revisionId),
    selectionId: data.selectionId === null ? null : text(data.selectionId), viewport: parsedViewport };
  let result: AnnotationSource;
  if (generic) {
    requireCondition(data.schemaVersion === 'artifact-annotation/v1', 'Unsupported artifact annotation version.');
    const designDigest = text(data.designDigest);
    requireCondition(/^[a-f0-9]{64}$/.test(designDigest), 'Invalid annotation Design digest.');
    result = { schemaVersion: 'artifact-annotation/v1', ...base, designDigest, artifactId: text(data.artifactId) };
  } else {
    const perspective = text(data.perspective);
    requireCondition(['use-case', 'contract', 'flow', 'gui', 'system'].includes(perspective), 'Invalid annotation perspective.');
    result = { ...base, perspective };
  }
  requireCondition(Buffer.byteLength(JSON.stringify(result)) <= 8192, 'Annotation source metadata is too large.');
  return result;
}
export function parseAnnotationAttachments(value: unknown): AnnotationAttachment[] {
  requireCondition(Array.isArray(value) && value.length === 1, 'Exactly one annotation PNG is required.');
  return value.map((item) => {
    const data = object(item, ['id', 'sha256', 'mimeType', 'byteLength', 'width', 'height', 'source']);
    requireCondition(data.mimeType === 'image/png' && /^[a-f0-9]{64}$/.test(text(data.sha256)), 'Invalid annotation PNG identity.');
    const source = parseAnnotationSource(data.source);
    const result = { id: text(data.id), sha256: data.sha256 as string, mimeType: 'image/png' as const,
      byteLength: Number(data.byteLength), width: Number(data.width), height: Number(data.height), source };
    requireCondition(['byteLength', 'width', 'height'].every((key) => typeof data[key] === 'number' && Number.isSafeInteger(data[key]) && Number(data[key]) > 0),
      'Invalid annotation dimensions or size.');
    requireCondition(result.byteLength <= annotationLimits.maxBytes && result.width * result.height <= annotationLimits.maxPixels
      && Math.max(result.width, result.height) <= annotationLimits.maxEdge, 'Annotation exceeds local image limits.');
    requireCondition(result.width === source.viewport.width && result.height === source.viewport.height,
      'Annotation image dimensions differ from its pinned viewport.');
    requireCondition(result.id === policyHash({ sha256: result.sha256, source }), 'Annotation source identity differs.');
    return result;
  });
}
export function inspectAnnotationPng(bytes: Buffer, allowInterlaced = false): { width: number; height: number } {
  requireCondition(bytes.length <= annotationLimits.maxBytes && bytes.length >= 45
    && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'Invalid or oversized annotation PNG.');
  let offset = 8, width = 0, height = 0, image = false, end = false;
  const passes: { rowBytes: number; rows: number }[] = [];
  const imageData: Buffer[] = [];
  while (offset + 12 <= bytes.length) {
    const size = bytes.readUInt32BE(offset), kind = bytes.toString('ascii', offset + 4, offset + 8);
    requireCondition(size <= bytes.length - offset - 12, 'Truncated annotation PNG chunk.');
    let crc = 0xffffffff;
    for (const byte of bytes.subarray(offset + 4, offset + size + 8)) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    requireCondition(((crc ^ 0xffffffff) >>> 0) === bytes.readUInt32BE(offset + size + 8), 'Invalid annotation PNG checksum.');
    if (offset === 8) {
      requireCondition(kind === 'IHDR' && size === 13, 'Annotation PNG needs an IHDR.');
      width = bytes.readUInt32BE(offset + 8); height = bytes.readUInt32BE(offset + 12);
      const depth = bytes[offset + 16]!, color = bytes[offset + 17]!;
      const depths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      const interlace = bytes[offset + 20];
      requireCondition(depths[color]?.includes(depth) && bytes[offset + 18] === 0
        && bytes[offset + 19] === 0 && (interlace === 0 || allowInterlaced && interlace === 1),
      allowInterlaced ? 'Invalid PNG encoding.' : 'Annotation requires a non-interlaced PNG encoding.');
      const channels: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
      requireCondition(width > 0 && height > 0 && width * height <= annotationLimits.maxPixels
        && Math.max(width, height) <= annotationLimits.maxEdge, 'Annotation PNG dimensions exceed limits.');
      const layout: readonly (readonly [number, number, number, number])[] = interlace === 1
        ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]]
        : [[0, 0, 1, 1]];
      for (const [x, y, dx, dy] of layout) {
        const columns = Math.max(0, Math.ceil((width - x) / dx)), rows = Math.max(0, Math.ceil((height - y) / dy));
        if (columns && rows) passes.push({ rowBytes: Math.ceil(columns * channels[color]! * depth / 8) + 1, rows });
      }
    } else requireCondition(kind !== 'IHDR', 'Duplicate annotation PNG header.');
    if (kind === 'IDAT') { image = true; imageData.push(bytes.subarray(offset + 8, offset + 8 + size)); }
    offset += size + 12;
    if (kind === 'IEND') { requireCondition(size === 0, 'Invalid annotation PNG end.'); end = true; break; }
  }
  requireCondition(image && end && offset === bytes.length, 'Incomplete annotation PNG.');
  const decodedLength = passes.reduce((sum, pass) => sum + pass.rowBytes * pass.rows, 0);
  const decoded = inflateSync(Buffer.concat(imageData), { maxOutputLength: decodedLength });
  requireCondition(decoded.length === decodedLength, 'Annotation PNG pixel data differs from its dimensions.');
  let rowOffset = 0;
  for (const { rowBytes, rows } of passes) for (let row = 0; row < rows; row++, rowOffset += rowBytes)
    requireCondition(decoded[rowOffset]! <= 4, 'Invalid annotation PNG row filter.');
  return { width, height };
}
/**
 * Originals, including uploaded-but-unsent snapshots, are retained across restarts.
 * Removing a composer draft does not delete them. There is intentionally no automatic
 * cleanup: accepted or uncertain request/history references must never race deletion.
 */
export class AnnotationAttachmentStore {
  readonly #directory: string;
  readonly #root: string;
  constructor(repositoryRoot: string) {
    this.#root = resolve(repositoryRoot);
    this.#directory = resolve(this.#root, '.tandem', 'living-canvas', 'annotation-attachments');
  }
  async #checkDirectory(create = false): Promise<void> {
    let path = this.#root;
    for (const name of ['.tandem', 'living-canvas', 'annotation-attachments']) {
      path = resolve(path, name);
      if (create) {
        try { await mkdir(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      }
      const stat = await lstat(path);
      requireCondition(stat.isDirectory() && !stat.isSymbolicLink(), 'Annotation storage is not an owned directory.');
    }
  }
  async put(bytes: Buffer, sourceValue: unknown): Promise<AnnotationAttachment> {
    const source = parseAnnotationSource(sourceValue), dimensions = inspectAnnotationPng(bytes);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const ref: AnnotationAttachment = { id: policyHash({ sha256, source }), sha256, mimeType: 'image/png', byteLength: bytes.length, ...dimensions, source };
    parseAnnotationAttachments([ref]);
    await this.#checkDirectory(true);
    const metadata = new HostStateFile(this.#root, resolve(this.#directory, `${ref.id}.json`));
    await metadata.run('register-annotation', async () => {
      const existing = await metadata.read();
      if (existing !== undefined) requireCondition(policyHash(parseAnnotationAttachments([JSON.parse(existing)])[0]) === policyHash(ref),
        'Stored annotation metadata differs from its original.');
      const pending = resolve(this.#directory, `${randomUUID()}.pending`);
      const handle = await open(pending, 'wx');
      try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
      try {
        // Publish a complete immutable file without replacing a concurrent original.
        await link(pending, resolve(this.#directory, `${ref.id}.png`));
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      finally { await unlink(pending); }
      await this.read(ref);
      await metadata.write('register-annotation', JSON.stringify(ref));
    });
    const saved = await this.get(ref.id);
    requireCondition(policyHash(saved.attachment) === policyHash(ref), 'Stored annotation metadata differs from its original.');
    return ref;
  }
  async get(id: string): Promise<{ attachment: AnnotationAttachment; bytes: Buffer }> {
    requireCondition(/^[a-f0-9]{64}$/.test(id), 'Invalid annotation identifier.');
    await this.#checkDirectory();
    const path = resolve(this.#directory, `${id}.json`);
    const content = await new HostStateFile(this.#root, path).read();
    requireCondition(content !== undefined && Buffer.byteLength(content) <= 16384, 'Annotation metadata is not a bounded owned record.');
    const attachment = parseAnnotationAttachments([JSON.parse(content)])[0]!;
    requireCondition(attachment.id === id, 'Annotation metadata identity differs.');
    return { attachment, bytes: await this.read(attachment) };
  }
  async read(value: AnnotationAttachment): Promise<Buffer> {
    const ref = parseAnnotationAttachments([value])[0]!, path = resolve(this.#directory, `${ref.id}.png`);
    await this.#checkDirectory();
    const stat = await lstat(path);
    requireCondition(stat.isFile() && stat.size === ref.byteLength, 'Annotation file is missing or changed.');
    const bytes = await readFile(path), dimensions = inspectAnnotationPng(bytes);
    requireCondition(createHash('sha256').update(bytes).digest('hex') === ref.sha256
      && dimensions.width === ref.width && dimensions.height === ref.height, 'Annotation original bytes have changed.');
    return bytes;
  }
}

export async function annotationCapabilities(session: { rpc?: { model?: { get?: () => Promise<unknown>; getCurrent?: () => Promise<unknown> } } } | null,
  client: { listModels?: () => Promise<unknown> }, mimeType = 'image/png'): Promise<{ supported: boolean; limits: typeof annotationLimits; reason: string | null }> {
  try {
    const model = session?.rpc?.model;
    const get = model?.get ?? model?.getCurrent;
    requireCondition(typeof get === 'function' && typeof client.listModels === 'function', 'Selected runtime cannot verify image capabilities.');
    const selected = await get.call(model) as { modelId?: string };
    requireCondition(selected.modelId && selected.modelId !== 'auto', 'Select an explicit image-capable model; automatic or unknown model capabilities are unsupported.');
    const models = await client.listModels();
    requireCondition(Array.isArray(models), 'Model capabilities are unavailable.');
    const capabilities = models.find((model) => model.id === selected.modelId)?.capabilities;
    const vision = capabilities?.limits?.vision;
    requireCondition(capabilities?.supports?.vision === true && vision?.supported_media_types?.includes(mimeType)
      && Number.isSafeInteger(vision.max_prompt_images) && vision.max_prompt_images >= 1
      && Number.isSafeInteger(vision.max_prompt_image_size) && vision.max_prompt_image_size > 0,
    `Selected model does not positively report ${mimeType} support and image size/count limits.`);
    return { supported: true, limits: { ...annotationLimits, maxBytes: Math.min(annotationLimits.maxBytes, vision.max_prompt_image_size) }, reason: null };
  } catch (error) { return { supported: false, limits: annotationLimits, reason: error instanceof Error ? error.message : 'Image capabilities unavailable.' }; }
}
