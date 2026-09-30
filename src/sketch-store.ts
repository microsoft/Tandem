import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, rmdir } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, resolve, sep } from "node:path";
import { setTimeout } from "node:timers/promises";
import { inflateSync } from "node:zlib";
import type { ArtifactAsset } from "./artifact-assets.js";
import { normalizeProjectId, ProjectStoreError } from "./project-store.js";
import {
    readSketchState, renderSketchSvg, validateSketchDocument,
    type SketchApproval, type SketchDocument, type SketchRevision, type SketchScreen,
} from "./sketch.js";

const MAX_DOCUMENT_BYTES = 256 * 1024;
const MAX_SVG_BYTES = 1024 * 1024;
const MAX_PNG_BYTES = 1024 * 1024;
const MAX_PREVIEW_BYTES = 8 * MAX_PNG_BYTES;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    return value >>> 0;
});

function failure(code: string, message: string, statusCode = 422): never {
    throw new ProjectStoreError(`sketch_${code}`, message, statusCode);
}

function hasCode(error: unknown, code: string): boolean {
    return error instanceof Error && "code" in error && error.code === code;
}

async function io<T>(operation: () => Promise<T>): Promise<T> {
    try {
        return await operation();
    } catch (error) {
        if (error instanceof ProjectStoreError) throw error;
        if (error instanceof Error && error.message.startsWith("Invalid sketch:")) {
            throw new ProjectStoreError("sketch_invalid", error.message, 422, { cause: error });
        }
        throw new ProjectStoreError("sketch_io", "Cannot safely access the sketch files. Existing files were preserved.", 503, { cause: error });
    }
}

function hash(bytes: Buffer): string {
    return createHash("sha256").update(bytes).digest("hex");
}

function json(value: unknown): Buffer {
    return Buffer.from(JSON.stringify(value), "utf8");
}

function decode(bytes: Buffer): unknown {
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    catch { return failure("integrity", "A saved sketch file is not valid UTF-8 JSON."); }
}

function checkedRevision(revision: SketchRevision): SketchRevision {
    return readSketchState({ version: 1, status: "draft", current: revision, approved: null, history: [] }).current!;
}

function checkedApproval(revision: SketchRevision, approval: SketchApproval): SketchApproval {
    return readSketchState({ version: 1, status: "approved", current: revision, approved: approval, history: [] }).approved!;
}

function unsafe(): never {
    return failure("path_unsafe", "Sketch storage requires materialized directories and regular, unlinked files.", 409);
}

async function directories(path: string, create = false): Promise<void> {
    const absolute = resolve(path);
    const root = parse(absolute).root;
    let current = root;
    for (const part of ["", ...absolute.slice(root.length).split(sep).filter(Boolean)]) {
        if (part) current = join(current, part);
        const entry = await lstat(current).catch(async (error: unknown) => {
            if (!create || !part || !hasCode(error, "ENOENT")) throw error;
            try { await mkdir(current); }
            catch (error) { if (!hasCode(error, "EEXIST")) throw error; }
            return lstat(current);
        });
        if (entry.isSymbolicLink() || !entry.isDirectory()) unsafe();
    }
}

async function bytes(path: string, max: number): Promise<Buffer> {
    await directories(dirname(path));
    const before = await lstat(path, { bigint: true });
    if (before.isSymbolicLink() || !before.isFile() || before.nlink !== 1n) unsafe();
    if (before.size > BigInt(max)) return failure("integrity", "A sketch file exceeds its byte limit.");
    const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
        const opened = await file.stat({ bigint: true });
        if (!opened.isFile() || opened.nlink !== 1n || opened.ino !== before.ino || opened.dev !== before.dev) unsafe();
        const buffer = Buffer.alloc(Number(before.size) + 1);
        let length = 0;
        while (length < buffer.length) {
            const { bytesRead } = await file.read(buffer, length, buffer.length - length, length);
            if (!bytesRead) break;
            length += bytesRead;
        }
        const after = await file.stat({ bigint: true });
        const current = await lstat(path, { bigint: true });
        await directories(dirname(path));
        if (current.isSymbolicLink() || !current.isFile() || current.nlink !== 1n ||
            current.ino !== before.ino || current.dev !== before.dev) unsafe();
        const changedMetadata = process.platform !== "win32" &&
            (after.ctimeNs !== before.ctimeNs || current.ctimeNs !== after.ctimeNs);
        if (BigInt(length) !== before.size || after.size !== before.size || current.size !== after.size ||
            after.mtimeNs !== before.mtimeNs || current.mtimeNs !== after.mtimeNs || changedMetadata) {
            return failure("integrity", "A sketch file changed while being read.");
        }
        return buffer.subarray(0, length);
    } finally {
        await file.close();
    }
}

async function optionalBytes(path: string, max: number): Promise<Buffer | undefined> {
    try { return await bytes(path, max); }
    catch (error) {
        if (hasCode(error, "ENOENT")) return undefined;
        throw error;
    }
}

async function writeImmutable(path: string, content: Buffer): Promise<void> {
    await directories(dirname(path));
    const existing = await optionalBytes(path, content.length);
    if (existing !== undefined) {
        if (!existing.equals(content)) failure("conflict", "An immutable sketch file already contains different bytes; it was not overwritten.", 409);
        return;
    }
    const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    try {
        const opened = await file.stat({ bigint: true });
        if (!opened.isFile() || opened.nlink !== 1n) unsafe();
        await file.writeFile(content);
        await file.sync();
        const current = await lstat(path, { bigint: true });
        await directories(dirname(path));
        if (current.isSymbolicLink() || current.nlink !== 1n || current.ino !== opened.ino || current.dev !== opened.dev) unsafe();
    } finally {
        await file.close();
    }
    if (!(await bytes(path, content.length)).equals(content)) return failure("integrity", "A sketch file changed while being saved.");
}

async function locked<T>(directory: string, operation: () => Promise<T>): Promise<T> {
    const lock = join(directory, ".approval.lock");
    for (let attempt = 0; ; attempt++) {
        await directories(directory);
        try { await mkdir(lock); break; }
        catch (error) {
            if (!hasCode(error, "EEXIST")) throw error;
            try {
                const entry = await lstat(lock);
                if (entry.isSymbolicLink() || !entry.isDirectory()) unsafe();
            } catch (error) { if (!hasCode(error, "ENOENT")) throw error; }
            if (attempt >= 250) return failure("busy", "Another operation owns this sketch approval. Retry later; abandoned locks require inspection.", 409);
            await setTimeout(20);
        }
    }
    const owner = await lstat(lock, { bigint: true });
    if (owner.isSymbolicLink() || !owner.isDirectory()) unsafe();
    try { return await operation(); }
    finally {
        await directories(directory);
        const current = await lstat(lock, { bigint: true });
        if (current.isSymbolicLink() || !current.isDirectory() || current.ino !== owner.ino || current.dev !== owner.dev) unsafe();
        await rmdir(lock);
    }
}

function crc(bytes: Buffer): number {
    let value = 0xffffffff;
    for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 255] ^ (value >>> 8);
    return (value ^ 0xffffffff) >>> 0;
}

function paeth(a: number, b: number, c: number): number {
    const p = a + b - c;
    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function validatePng(content: Buffer, screen: SketchScreen): void {
    if (content.length > MAX_PNG_BYTES || !content.subarray(0, 8).equals(PNG_SIGNATURE)) {
        return failure("png_invalid", "Preview must be a PNG of at most 1 MiB.");
    }
    let offset = 8, depth = 0, color = 0, palette = 0;
    let header = false, ended = false, seenData = false, dataEnded = false, seenTransparency = false;
    const compressed: Buffer[] = [];
    while (offset < content.length) {
        if (offset + 12 > content.length) return failure("png_invalid", "Truncated PNG chunk.");
        const size = content.readUInt32BE(offset);
        if (size > content.length - offset - 12) return failure("png_invalid", "PNG chunk exceeds its input bounds.");
        const type = content.toString("latin1", offset + 4, offset + 8);
        if (!/^[A-Za-z]{4}$/.test(type) || type[2] !== type[2].toUpperCase() ||
            crc(content.subarray(offset + 4, offset + 8 + size)) !== content.readUInt32BE(offset + 8 + size)) {
            return failure("png_invalid", "PNG chunk type or CRC integrity is invalid.");
        }
        const data = content.subarray(offset + 8, offset + 8 + size);
        if (!header && type !== "IHDR") return failure("png_invalid", "PNG must start with its image header.");
        if (type === "IHDR") {
            if (header || size !== 13) return failure("png_invalid", "PNG image header is invalid.");
            header = true;
            if (data.readUInt32BE(0) !== screen.width || data.readUInt32BE(4) !== screen.height) {
                return failure("png_dimensions", "PNG dimensions must equal the sketch screen viewport.");
            }
            depth = data[8]; color = data[9];
            const depths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
            if (!depths[color]?.includes(depth) || data[10] !== 0 || data[11] !== 0 || data[12] !== 0) {
                return failure("png_invalid", "Preview must use a supported, non-interlaced static PNG encoding.");
            }
        } else if (type === "PLTE") {
            if (palette || seenData || size === 0 || size % 3 || size > 768 || color === 0 || color === 4 ||
                (color === 3 && size / 3 > 2 ** depth)) return failure("png_invalid", "Invalid PNG palette.");
            palette = size / 3;
        } else if (type === "tRNS") {
            if (seenTransparency || seenData || !((color === 0 && size === 2) || (color === 2 && size === 6) ||
                (color === 3 && palette > 0 && size > 0 && size <= palette))) {
                return failure("png_invalid", "Invalid PNG transparency.");
            }
            seenTransparency = true;
        } else if (type === "IDAT") {
            if (dataEnded || (color === 3 && !palette)) return failure("png_invalid", "Invalid PNG image data ordering.");
            seenData = true;
            compressed.push(data);
        } else if (type === "IEND") {
            if (!seenData || size !== 0 || offset + 12 !== content.length) return failure("png_invalid", "Invalid PNG end marker or trailing bytes.");
            ended = true;
        } else if (type[0] === type[0].toUpperCase() || ["acTL", "fcTL", "fdAT"].includes(type)) {
            return failure("png_invalid", "Unsupported critical or animated PNG chunk.");
        }
        if (seenData && type !== "IDAT") dataEnded = true;
        offset += size + 12;
    }
    if (!ended) return failure("png_invalid", "PNG is missing its end marker.");
    const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[color];
    const rowBytes = Math.ceil(screen.width * channels * depth / 8);
    const expectedBytes = (rowBytes + 1) * screen.height;
    const encoded = Buffer.concat(compressed);
    let raster: Buffer;
    try {
        const inflated = inflateSync(encoded, { maxOutputLength: expectedBytes + 1, info: true }) as unknown as {
            buffer: Buffer; engine: { bytesWritten: number };
        };
        raster = inflated.buffer;
        if (raster.length !== expectedBytes || inflated.engine.bytesWritten !== encoded.length) {
            return failure("png_invalid", "PNG raster length or compressed stream is invalid.");
        }
    } catch (error) {
        if (error instanceof ProjectStoreError) throw error;
        return failure("png_invalid", "PNG compressed raster is invalid or exceeds its viewport bounds.");
    }
    const pixelBytes = Math.max(1, Math.ceil(channels * depth / 8));
    let previous = Buffer.alloc(rowBytes);
    for (let y = 0; y < screen.height; y++) {
        const start = y * (rowBytes + 1);
        const filter = raster[start];
        if (filter > 4) return failure("png_invalid", "PNG scanline has an invalid filter.");
        if (color !== 3) continue;
        const row = Buffer.from(raster.subarray(start + 1, start + 1 + rowBytes));
        for (let x = 0; x < rowBytes; x++) {
            const left = x < pixelBytes ? 0 : row[x - pixelBytes];
            const up = previous[x];
            const corner = x < pixelBytes ? 0 : previous[x - pixelBytes];
            row[x] = (row[x] + (filter === 1 ? left : filter === 2 ? up : filter === 3 ?
                Math.floor((left + up) / 2) : filter === 4 ? paeth(left, up, corner) : 0)) & 255;
        }
        for (let x = 0; x < screen.width; x++) {
            const index = (row[Math.floor(x * depth / 8)] >>> (8 - depth - (x * depth % 8))) & (2 ** depth - 1);
            if (index >= palette) return failure("png_invalid", "PNG raster references a missing palette color.");
        }
        previous = row;
    }
}

function previewsFor(document: SketchDocument, previews: Array<{ screenId: string; data: string }>): Map<string, Buffer> {
    if (!Array.isArray(previews) || previews.length !== document.screens.length) {
        return failure("previews_invalid", "Provide exactly one PNG preview per sketch screen.");
    }
    const result = new Map<string, Buffer>();
    let total = 0;
    for (const preview of previews) {
        if (!preview || typeof preview !== "object" || Object.keys(preview).length !== 2 ||
            !Object.hasOwn(preview, "screenId") || !Object.hasOwn(preview, "data")) {
            return failure("previews_invalid", "A preview must contain only screenId and base64 data.");
        }
        const screen = document.screens.find((screen) => screen.id === preview.screenId);
        if (!screen || result.has(screen.id) || typeof preview.data !== "string" ||
            preview.data.length > Math.ceil(MAX_PNG_BYTES / 3) * 4 ||
            preview.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(preview.data)) {
            return failure("previews_invalid", "Preview identities or base64 encoding are invalid.");
        }
        const content = Buffer.from(preview.data, "base64");
        if (content.toString("base64") !== preview.data) return failure("previews_invalid", "PNG base64 must be canonical, without a data URL.");
        total += content.length;
        if (total > MAX_PREVIEW_BYTES) return failure("previews_invalid", "PNG previews exceed 8 MiB in total.");
        validatePng(content, screen);
        result.set(screen.id, content);
    }
    return result;
}

export class SketchStore {
    private readonly root: string;

    constructor(sharedRoot: string) {
        if (typeof sharedRoot !== "string" || !isAbsolute(sharedRoot) || sharedRoot.includes("\0")) {
            failure("path_invalid", "Sketch shared root must be an absolute trusted directory.", 400);
        }
        this.root = join(resolve(sharedRoot), ".tandem");
    }

    private location(prototypeId: string, revision: SketchRevision): { directory: string; relative: string } {
        if (typeof prototypeId !== "string" || normalizeProjectId(prototypeId) !== prototypeId) {
            return failure("path_invalid", "Sketch project ID must use its canonical stored identity.", 400);
        }
        checkedRevision(revision);
        return {
            directory: join(this.root, "efforts", prototypeId, "sketches", revision.id),
            relative: `.tandem/efforts/${prototypeId}/sketches/${revision.id}`,
        };
    }

    async save(prototypeId: string, document: SketchDocument, options: {
        requirementsDigest: string; source: SketchRevision["source"]; number: number;
    }): Promise<SketchRevision> {
        return io(async () => {
            const validated = validateSketchDocument(document);
            const content = json(validated);
            const revision = checkedRevision({
                id: randomUUID(), number: options.number, requirementsDigest: options.requirementsDigest,
                documentHash: hash(content), createdAt: new Date().toISOString(), source: options.source,
            });
            const { directory } = this.location(prototypeId, revision);
            await directories(dirname(directory), true);
            try { await mkdir(directory); }
            catch (error) {
                if (hasCode(error, "EEXIST")) return failure("conflict", "Sketch revision directory already exists; it was not overwritten.", 409);
                throw error;
            }
            await writeImmutable(join(directory, "document.json"), content);
            for (const screen of validated.screens) {
                await writeImmutable(join(directory, `${screen.id}.svg`), Buffer.from(renderSketchSvg(screen), "utf8"));
            }
            // The final metadata file commits the revision only after all scene assets are durable.
            await writeImmutable(join(directory, "revision.json"), json(revision));
            await this.read(prototypeId, revision);
            return revision;
        });
    }

    async read(prototypeId: string, revision: SketchRevision): Promise<SketchDocument> {
        return io(async () => {
            revision = checkedRevision(revision);
            const { directory } = this.location(prototypeId, revision);
            const savedRevision = await bytes(join(directory, "revision.json"), 4096);
            if (!savedRevision.equals(json(revision))) return failure("integrity", "Saved sketch revision metadata does not match this revision.");
            const content = await bytes(join(directory, "document.json"), MAX_DOCUMENT_BYTES);
            if (hash(content) !== revision.documentHash) return failure("integrity", "Saved sketch document hash does not match this revision.");
            const document = validateSketchDocument(decode(content));
            if (!content.equals(json(document))) return failure("integrity", "Saved sketch document bytes are not canonical.");
            for (const screen of document.screens) {
                const svg = await bytes(join(directory, `${screen.id}.svg`), MAX_SVG_BYTES);
                if (!svg.equals(Buffer.from(renderSketchSvg(screen), "utf8"))) return failure("integrity", "Saved SVG no longer matches its sketch scene.");
            }
            return document;
        });
    }

    private async assets(prototypeId: string, revision: SketchRevision, document: SketchDocument): Promise<ArtifactAsset[]> {
        const { directory, relative } = this.location(prototypeId, revision);
        const assets: ArtifactAsset[] = [{
            id: "document", path: `${relative}/document.json`,
            hash: hash(await bytes(join(directory, "document.json"), MAX_DOCUMENT_BYTES)), mediaType: "application/json",
        }];
        for (const screen of document.screens) {
            for (const extension of ["svg", "png"] as const) {
                const name = `${screen.id}.${extension}`;
                const content = await bytes(join(directory, name), extension === "svg" ? MAX_SVG_BYTES : MAX_PNG_BYTES);
                if (extension === "png") validatePng(content, screen);
                else if (!content.equals(Buffer.from(renderSketchSvg(screen), "utf8"))) return failure("integrity", "SVG bytes do not match the sketch scene.");
                assets.push({
                    id: `${screen.id}-${extension}`, path: `${relative}/${name}`, hash: hash(content),
                    mediaType: extension === "svg" ? "image/svg+xml" : "image/png",
                });
            }
        }
        if (assets[0].hash !== revision.documentHash) return failure("integrity", "Sketch document changed while its assets were being read.");
        return assets;
    }

    async approve(prototypeId: string, revision: SketchRevision, previews: Array<{ screenId: string; data: string }>): Promise<SketchApproval> {
        return io(async () => {
            revision = checkedRevision(revision);
            const document = await this.read(prototypeId, revision);
            const images = previewsFor(document, previews);
            const { directory } = this.location(prototypeId, revision);
            return locked(directory, async () => {
                await this.read(prototypeId, revision);
                const persisted = await optionalBytes(join(directory, "approval.json"), 20 * 1024);
                if (persisted !== undefined) {
                    const approval = checkedApproval(revision, decode(persisted) as SketchApproval);
                    await this.verifyApproval(prototypeId, revision, approval);
                    for (const [id, content] of images) {
                        if (!(await bytes(join(directory, `${id}.png`), MAX_PNG_BYTES)).equals(content)) {
                            return failure("conflict", "This sketch revision already has different approved PNG bytes; it was not overwritten.", 409);
                        }
                    }
                    return approval;
                }
                for (const [id, content] of images) await writeImmutable(join(directory, `${id}.png`), content);
                const approval = checkedApproval(revision, {
                    revisionId: revision.id, requirementsDigest: revision.requirementsDigest, documentHash: revision.documentHash,
                    approvedAt: new Date().toISOString(), assets: await this.assets(prototypeId, revision, document),
                });
                await writeImmutable(join(directory, "approval.json"), json(approval));
                await this.verifyApproval(prototypeId, revision, approval);
                return approval;
            });
        });
    }

    async verifyApproval(prototypeId: string, revision: SketchRevision, approval: SketchApproval): Promise<SketchDocument> {
        return io(async () => {
            revision = checkedRevision(revision);
            approval = checkedApproval(revision, approval);
            const document = await this.read(prototypeId, revision);
            const { directory } = this.location(prototypeId, revision);
            const saved = await bytes(join(directory, "approval.json"), 20 * 1024);
            if (!saved.equals(json(approval))) return failure("integrity", "Saved sketch approval metadata does not match the requested approval.");
            const assets = await this.assets(prototypeId, revision, document);
            if (!json(assets).equals(json(approval.assets))) return failure("integrity", "Approved sketch asset identities or hashes no longer match their bound files.");
            return document;
        });
    }

    async readImage(prototypeId: string, revision: SketchRevision, approval: SketchApproval, screenId: string): Promise<Buffer> {
        return io(async () => {
            revision = checkedRevision(revision);
            approval = checkedApproval(revision, approval);
            const document = await this.verifyApproval(prototypeId, revision, approval);
            const screen = document.screens.find((screen) => screen.id === screenId);
            if (!screen) return failure("image_unknown", "The requested screen is not part of this approved sketch.", 404);
            const { directory, relative } = this.location(prototypeId, revision);
            const image = await bytes(join(directory, `${screen.id}.png`), MAX_PNG_BYTES);
            const asset = approval.assets.find((asset) => asset.path === `${relative}/${screen.id}.png` && asset.mediaType === "image/png");
            if (!asset || hash(image) !== asset.hash) return failure("integrity", "Sketch PNG changed after its approval was verified.");
            validatePng(image, screen);
            return image;
        });
    }
}
