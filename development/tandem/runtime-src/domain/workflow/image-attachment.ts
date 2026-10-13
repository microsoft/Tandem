import { createHash, randomUUID } from 'node:crypto';
import { mkdir, lstat, open, readFile, link, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { decode } from '../../../public/artifacts/vendor/jpeg.js';
import { HostStateFile } from '../host-state-file.ts';
import { ensureTandemWorkspace } from '../product-paths.ts';
import { annotationLimits, inspectAnnotationPng, parseAnnotationAttachments, AnnotationAttachmentStore, type AnnotationAttachment } from './annotation-attachment.ts';
import { object, requireCondition, text } from './validation.ts';
import { policyHash } from './policy.ts';

export interface ImageAttachment {
  schemaVersion: 'image-attachment/v1';
  id: string; sha256: string; mimeType: 'image/png' | 'image/jpeg';
  byteLength: number; width: number; height: number;
}
export type RequestAttachment = AnnotationAttachment | ImageAttachment;
export function isImageAttachment(value: RequestAttachment): value is ImageAttachment {
  return 'schemaVersion' in value && value.schemaVersion === 'image-attachment/v1';
}
export function parseImageAttachment(value: unknown): ImageAttachment {
  const data = object(value, ['schemaVersion', 'id', 'sha256', 'mimeType', 'byteLength', 'width', 'height']);
  requireCondition(data.schemaVersion === 'image-attachment/v1' && ['image/png', 'image/jpeg'].includes(String(data.mimeType)),
    'Unsupported composer image version or MIME type.');
  const ref: ImageAttachment = { schemaVersion: 'image-attachment/v1', id: text(data.id), sha256: text(data.sha256),
    mimeType: data.mimeType as ImageAttachment['mimeType'], byteLength: Number(data.byteLength), width: Number(data.width), height: Number(data.height) };
  requireCondition(/^[a-f0-9]{64}$/.test(ref.sha256) && ref.id === policyHash({ schemaVersion: ref.schemaVersion, sha256: ref.sha256, mimeType: ref.mimeType }),
    'Composer image identity differs.');
  requireCondition(['byteLength', 'width', 'height'].every(key => typeof data[key] === 'number' && Number.isSafeInteger(data[key]) && Number(data[key]) > 0)
    && ref.byteLength <= annotationLimits.maxBytes && Math.max(ref.width, ref.height) <= annotationLimits.maxEdge
    && ref.width * ref.height <= annotationLimits.maxPixels, 'Composer image exceeds image limits.');
  return ref;
}
export function parseRequestAttachments(value: unknown): RequestAttachment[] {
  requireCondition(Array.isArray(value) && value.length === 1, 'Exactly one image is supported per request.');
  return value.map(item => item?.schemaVersion === 'image-attachment/v1' ? parseImageAttachment(item) : parseAnnotationAttachments([item])[0]!);
}
export function inspectComposerImage(bytes: Buffer, mimeType: string): { width: number; height: number } {
  requireCondition(bytes.length > 0 && bytes.length <= annotationLimits.maxBytes, 'Image must be at most 4 MiB.');
  if (mimeType === 'image/png') return inspectAnnotationPng(bytes, true);
  requireCondition(mimeType === 'image/jpeg', 'Paste a PNG or JPEG image. Other formats, including SVG, are unsupported.');
  requireCondition(bytes[0] === 255 && bytes[1] === 216 && bytes.at(-2) === 255 && bytes.at(-1) === 217, 'Invalid JPEG image.');
  const { width, height } = decode(bytes, { useTArray: true, formatAsRGBA: false, tolerantDecoding: false,
    maxResolutionInMP: annotationLimits.maxPixels / 1_000_000, maxMemoryUsageInMB: 64 });
  requireCondition(width > 0 && height > 0 && Math.max(width, height) <= annotationLimits.maxEdge
    && width * height <= annotationLimits.maxPixels, 'Image exceeds 4096 pixels per edge or 4 million pixels.');
  return { width, height };
}
export class ImageAttachmentStore {
  private readonly root: string;
  constructor(root: string) { ensureTandemWorkspace(root); this.root = resolve(root); }
  private async directory(create = false): Promise<string> {
    let path = resolve(this.root);
    for (const name of ['.tandem', 'living-canvas', 'image-attachments']) {
      path = resolve(path, name);
      if (create) try { await mkdir(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      const stat = await lstat(path);
      requireCondition(stat.isDirectory() && !stat.isSymbolicLink(), 'Image storage must be an owned directory.');
    }
    return path;
  }
  async put(bytes: Buffer, mimeType: string): Promise<ImageAttachment> {
    const dimensions = inspectComposerImage(bytes, mimeType), sha256 = createHash('sha256').update(bytes).digest('hex');
    const identity = { schemaVersion: 'image-attachment/v1' as const, sha256, mimeType };
    const ref = parseImageAttachment({ ...identity, id: policyHash(identity), byteLength: bytes.length, ...dimensions });
    const directory = await this.directory(true), metadata = new HostStateFile(this.root, resolve(directory, `${ref.id}.json`));
    await metadata.run('register-composer-image', async () => {
      const existing = await metadata.read();
      if (existing !== undefined) requireCondition(policyHash(parseImageAttachment(JSON.parse(existing))) === policyHash(ref), 'Stored image metadata differs.');
      const pending = resolve(directory, `${randomUUID()}.pending`), handle = await open(pending, 'wx');
      try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
      try { await link(pending, resolve(directory, `${ref.id}.image`)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      finally { await unlink(pending); }
      await this.readBytes(ref, directory);
      await metadata.write('register-composer-image', JSON.stringify(ref));
    });
    await this.read(ref);
    return ref;
  }
  async read(value: ImageAttachment): Promise<Buffer> {
    const ref = parseImageAttachment(value), directory = await this.directory();
    const saved = await new HostStateFile(this.root, resolve(directory, `${ref.id}.json`)).read();
    requireCondition(saved !== undefined && policyHash(parseImageAttachment(JSON.parse(saved))) === policyHash(ref), 'Image metadata is missing or changed.');
    return this.readBytes(ref, directory);
  }
  private async readBytes(ref: ImageAttachment, directory: string): Promise<Buffer> {
    const path = resolve(directory, `${ref.id}.image`);
    const stat = await lstat(path);
    requireCondition(stat.isFile() && !stat.isSymbolicLink() && stat.size === ref.byteLength, 'Image file is missing or changed.');
    const bytes = await readFile(path), dimensions = inspectComposerImage(bytes, ref.mimeType);
    requireCondition(createHash('sha256').update(bytes).digest('hex') === ref.sha256
      && dimensions.width === ref.width && dimensions.height === ref.height, 'Image bytes or dimensions changed.');
    return bytes;
  }
}
export function readRequestAttachment(root: string, ref: RequestAttachment): Promise<Buffer> {
  return isImageAttachment(ref) ? new ImageAttachmentStore(root).read(ref) : new AnnotationAttachmentStore(root).read(ref);
}
