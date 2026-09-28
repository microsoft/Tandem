import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { ensureMaterializedDirectories, readRetainedFile } from "./accepted-artifacts.js";
import { executionDigest } from "./execution.js";
import { writeBytesAtomically, writeJsonAtomically } from "./project-store.js";

export interface TandemPayload {
    schemaVersion: "tandem-composed-payload/v1";
    version: string;
    digest: string;
    files: Array<{ path: string; bytes: number; sha256: string }>;
}
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const manifestName = "payload.json";
function location(root: string, path: string): string {
    if (isAbsolute(path) || !path || path.includes("\\") || path.split("/").some(part => !part || part === "." || part === ".." || /[:\0]/.test(part))) {
        throw new Error("The composed payload contains an unsafe path.");
    }
    return join(root, ...path.split("/"));
}
export async function createPayload(root: string, version: string, paths: string[]): Promise<TandemPayload> {
    const files: TandemPayload["files"] = [];
    for (const path of [...new Set(paths)].sort()) {
        const bytes = await readRetainedFile(location(root, path), 64 * 1024 * 1024);
        files.push({ path, bytes: bytes.length, sha256: hash(bytes) });
    }
    const content = { schemaVersion: "tandem-composed-payload/v1" as const, version, files };
    const manifest = { ...content, digest: executionDigest(content) };
    await writeJsonAtomically(join(root, manifestName), manifest);
    return manifest;
}
export async function verifyPayload(root: string): Promise<TandemPayload> {
    const value: unknown = JSON.parse((await readRetainedFile(join(root, manifestName), 1024 * 1024)).toString("utf8"));
    if (!value || typeof value !== "object" || !("schemaVersion" in value) || value.schemaVersion !== "tandem-composed-payload/v1" ||
        !("version" in value) || typeof value.version !== "string" || !("files" in value) || !Array.isArray(value.files) ||
        !("digest" in value) || typeof value.digest !== "string" || value.files.length > 2000) throw new Error("The composed Tandem payload manifest is invalid.");
    const files: TandemPayload["files"] = [];
    for (const item of value.files) {
        if (!item || typeof item !== "object" || typeof item.path !== "string" || typeof item.sha256 !== "string" ||
            !/^[a-f0-9]{64}$/.test(item.sha256) || !Number.isSafeInteger(item.bytes) || item.bytes < 0 || item.bytes > 64 * 1024 * 1024) {
            throw new Error("Invalid composed payload file identity.");
        }
        const bytes = await readRetainedFile(location(root, item.path), item.bytes);
        if (bytes.length !== item.bytes || hash(bytes) !== item.sha256) throw new Error(`Tandem payload is missing or changed: ${item.path}`);
        files.push({ path: item.path, bytes: item.bytes, sha256: item.sha256 });
    }
    if (new Set(files.map(file => file.path.toLowerCase())).size !== files.length ||
        !files.some(file => file.path === "extension.mjs") ||
        !files.some(file => file.path === "stage2/src/human-loop-controller.mjs") ||
        !files.some(file => file.path === "stage2/public/human-loop.html") ||
        !files.some(file => file.path === "skills/tandem/SKILL.md")) throw new Error("The complete Tandem payload is required; a single-file extension is incompatible.");
    const content = { schemaVersion: "tandem-composed-payload/v1" as const, version: value.version, files };
    if (executionDigest(content) !== value.digest) throw new Error("Composed payload manifest digest changed.");
    return { ...content, digest: value.digest };
}

export async function stagePayload(source: string, destination: string): Promise<{ changed: boolean; manifest: TandemPayload }> {
    if (resolve(source) === resolve(destination)) throw new Error("Cannot stage Tandem over its package source.");
    const manifest = await verifyPayload(source);
    await ensureMaterializedDirectories(destination, true);
    let previous: TandemPayload | undefined;
    try {
        await lstat(join(destination, manifestName));
        previous = await verifyPayload(destination);
    } catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    }
    if (previous?.digest === manifest.digest) return { changed: false, manifest };
    // The entrypoint is replaced last; reload only occurs after all hashes verify.
    for (const file of [...manifest.files.filter(file => file.path !== "extension.mjs"), ...manifest.files.filter(file => file.path === "extension.mjs")]) {
        const target = location(destination, file.path);
        await ensureMaterializedDirectories(dirname(target), true);
        try {
            const stat = await lstat(target);
            if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error("Refusing an aliased staged payload file.");
        } catch (error) {
            if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
        }
        const bytes = await readRetainedFile(location(source, file.path), file.bytes);
        if (bytes.length !== file.bytes || hash(bytes) !== file.sha256) throw new Error("The package changed while staging. No provider reload was requested.");
        await writeBytesAtomically(target, bytes);
    }
    await writeJsonAtomically(join(destination, manifestName), manifest);
    await verifyPayload(destination);
    return { changed: true, manifest };
}
