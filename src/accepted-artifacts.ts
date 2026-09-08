import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, rmdir } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, resolve, sep } from "node:path";
import { setTimeout } from "node:timers/promises";
import { executionDigest } from "./execution.js";
import { normalizeProjectId, ProjectStoreError } from "./project-store.js";
import type { LifecycleStageId } from "./types.js";
import { lifecycleStages } from "./workflow.js";

export interface AcceptanceRecord {
    id: string;
    stageId: LifecycleStageId;
    /** Original stage path, relative to the shared project root; never the archived copy. */
    snapshotPath: string;
    snapshotHash: string;
    acceptedAt: string;
    /** Recorded attribution, not authenticated code-owner approval. */
    acceptedBy: { label: string; sessionId: string };
    source: { commit: string | null; fingerprint: string };
    producer: { version: string; configurationHash: string };
    upstream: Array<{ id: string; hash: string }>;
    artifactHashes: Array<{ id: string; hash: string }>;
    /** Workspace-relative bundle directory containing snapshot.json and manifest.json; null before export. */
    exportPath: string | null;
}

export interface AcceptStageSnapshotInput {
    workspaceRoot: string;
    sharedRoot: string;
    effortId: string;
    stageId: LifecycleStageId;
    snapshotPath: string;
    acceptedBy: AcceptanceRecord["acceptedBy"];
    source: AcceptanceRecord["source"];
    producer: AcceptanceRecord["producer"];
    upstream: AcceptanceRecord["upstream"];
}

const MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 512 * 1024;
const ATTRIBUTION = "The acceptedBy label is recorded attribution, not authenticated code-owner approval. "
    + "Acceptance and export do not commit, publish, merge, or authorize deployment.";
const RECORD_KEYS = [
    "id", "stageId", "snapshotPath", "snapshotHash", "acceptedAt", "acceptedBy",
    "source", "producer", "upstream", "artifactHashes", "exportPath",
];

function invalid(message: string): never {
    throw new ProjectStoreError("acceptance_invalid", message, 422);
}

function integrity(message: string): never {
    throw new ProjectStoreError("acceptance_integrity", message, 422);
}

function object(value: unknown, keys?: string[]): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return invalid("Expected an acceptance object.");
    const result = value as Record<string, unknown>;
    if (keys && (Object.keys(result).length !== keys.length ||
        keys.some((key) => !Object.hasOwn(result, key)))) return invalid("Unexpected or missing acceptance fields.");
    return result;
}

function text(value: unknown, name: string, max: number, allowEmpty = false, multiline = false): string {
    if (typeof value !== "string" || value.length > max || (!allowEmpty && !value.trim()) ||
        (multiline ? /[\0]/ : /[\x00-\x1f\x7f]/).test(value)) return invalid(`Invalid ${name}.`);
    return value;
}

function digest(value: unknown, name: string): string {
    const result = text(value, name, 64);
    if (!/^[a-f0-9]{64}$/.test(result)) return invalid(`Invalid SHA256 ${name}.`);
    return result;
}

function timestamp(value: unknown): string {
    const result = text(value, "acceptance timestamp", 24);
    const time = Date.parse(result);
    if (!Number.isFinite(time) || new Date(time).toISOString() !== result) return invalid("Invalid acceptance timestamp.");
    return result;
}

function stageId(value: unknown): LifecycleStageId {
    const stage = lifecycleStages.find((stage) => stage.id === value);
    if (!stage) return invalid("Unsupported lifecycle stage.");
    return stage.id;
}

function effortId(value: unknown): string {
    const id = text(value, "effort ID", 80);
    if (normalizeProjectId(id) !== id) return invalid("Effort IDs must use their canonical stored identity.");
    return id;
}

function list(value: unknown, max: number): unknown[] {
    if (!Array.isArray(value) || value.length > max) return invalid("Invalid or oversized acceptance list.");
    return Array.from(value);
}

function pairs(value: unknown, max: number, acceptanceIds: boolean): Array<{ id: string; hash: string }> {
    const result = list(value, max).map((value) => {
        const pair = object(value, ["id", "hash"]);
        return {
            id: acceptanceIds ? digest(pair.id, "upstream ID") : text(pair.id, "artifact ID", 120),
            hash: digest(pair.hash, "content hash"),
        };
    });
    if (new Set(result.map((pair) => pair.id)).size !== result.length) return invalid("Duplicate acceptance references.");
    return result.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function provenance(input: {
    acceptedBy: unknown; source: unknown; producer: unknown; upstream: unknown;
}): Pick<AcceptanceRecord, "acceptedBy" | "source" | "producer" | "upstream"> {
    const approver = object(input.acceptedBy, ["label", "sessionId"]);
    const source = object(input.source, ["commit", "fingerprint"]);
    const producer = object(input.producer, ["version", "configurationHash"]);
    const commit = source.commit === null ? null : text(source.commit, "source commit", 64);
    if (commit !== null && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit)) return invalid("Invalid Git commit identity.");
    const sessionId = text(approver.sessionId, "accepting session", 200);
    const version = text(producer.version, "producer version", 80);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(sessionId) ||
        !/^[A-Za-z0-9][A-Za-z0-9.+_-]*$/.test(version)) return invalid("Invalid session or producer identity.");
    return {
        acceptedBy: { label: text(approver.label, "accepting label", 200), sessionId },
        source: { commit, fingerprint: digest(source.fingerprint, "source fingerprint") },
        producer: { version, configurationHash: digest(producer.configurationHash, "configuration hash") },
        upstream: pairs(input.upstream, 100, true),
    };
}

function snapshotLocation(value: unknown, stage: LifecycleStageId, expectedEffort?: string) {
    const original = text(value, "snapshot path", 300);
    const portable = original.replace(/\\/g, "/");
    const match = /^\.tandem\/efforts\/([^/]+)\/stages\/([a-z]+)(?:-r([1-9][0-9]*))?\.json$/.exec(portable);
    if (!match || match[2] !== stage || (expectedEffort !== undefined && match[1] !== expectedEffort)) {
        throw new ProjectStoreError("acceptance_path_invalid", "Select an existing snapshot for this effort and stage.", 400);
    }
    const id = effortId(match[1]);
    const revision = match[3] === undefined ? undefined : Number(match[3]);
    if (revision !== undefined && !Number.isSafeInteger(revision)) return invalid("Invalid snapshot revision.");
    return { original, portable, effortId: id, revision };
}

function exportLocation(effort: string, id: string): string {
    return `tandem-records/${effort}/${id}`;
}

function portableRecord(record: AcceptanceRecord): AcceptanceRecord {
    return { ...record, snapshotPath: record.snapshotPath.replace(/\\/g, "/") };
}

function acceptanceId(record: Omit<AcceptanceRecord, "id" | "acceptedAt" | "exportPath">): string {
    return executionDigest({ version: 1, ...record, snapshotPath: record.snapshotPath.replace(/\\/g, "/") });
}

function normalizeRecord(value: unknown): AcceptanceRecord {
    const record = object(value, RECORD_KEYS);
    const stage = stageId(record.stageId);
    const location = snapshotLocation(record.snapshotPath, stage);
    const result: AcceptanceRecord = {
        id: digest(record.id, "acceptance ID"),
        stageId: stage,
        snapshotPath: location.original,
        snapshotHash: digest(record.snapshotHash, "snapshot hash"),
        acceptedAt: timestamp(record.acceptedAt),
        ...provenance({
            acceptedBy: record.acceptedBy, source: record.source, producer: record.producer, upstream: record.upstream,
        }),
        artifactHashes: pairs(record.artifactHashes, 30, false),
        exportPath: record.exportPath === null ? null : text(record.exportPath, "export path", 300),
    };
    if (result.exportPath !== null && result.exportPath !== exportLocation(location.effortId, result.id)) {
        return invalid("Export path does not match the accepted bundle.");
    }
    const { id, acceptedAt: _at, exportPath: _export, ...identity } = result;
    if (id !== acceptanceId(identity)) return integrity("Acceptance metadata does not match its content-addressed ID.");
    return result;
}

/** Undefined is an empty history; malformed, oversized, or duplicate records are never silently discarded. */
export function validateAcceptanceRecords(value: unknown): AcceptanceRecord[] {
    if (value === undefined) return [];
    const records = list(value, 1000).map(normalizeRecord);
    if (new Set(records.map((record) => record.id)).size !== records.length) return invalid("Duplicate acceptance IDs.");
    return records;
}

function sha256(bytes: Buffer): string {
    return createHash("sha256").update(bytes).digest("hex");
}

function jsonBytes(value: unknown): Buffer {
    return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function decode(bytes: Buffer): unknown {
    try {
        return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch (error) {
        throw new ProjectStoreError("acceptance_corrupt", "Invalid saved acceptance JSON; the file was preserved.", 422, { cause: error });
    }
}

interface SnapshotArtifact {
    id: string;
    title: string;
    content: string;
    language: string;
    mermaid: string;
}

function snapshotArtifacts(bytes: Buffer, effort: string, stage: LifecycleStageId, path: string): SnapshotArtifact[] {
    const snapshot = object(decode(bytes));
    const location = snapshotLocation(path, stage, effort);
    if (snapshot.version !== 1 || snapshot.prototypeId !== effort || snapshot.stageId !== stage) {
        return invalid("The stage snapshot has an unsupported version or mismatched identity.");
    }
    if ((snapshot.revision !== undefined && (!Number.isSafeInteger(snapshot.revision) || Number(snapshot.revision) < 0)) ||
        (location.revision !== undefined && snapshot.revision !== location.revision)) return invalid("Snapshot revision does not match its filename.");
    timestamp(snapshot.completedAt);
    const result = object(snapshot.result);
    text(result.goal, "snapshot goal", 20000, true, true);
    const artifacts = list(stage === "prepare" && result.artifacts === undefined ? [] : result.artifacts, 30);
    const selected: SnapshotArtifact[] = [];
    for (const value of artifacts) {
        const artifact = object(value);
        const artifactStage = stageId(artifact.stage);
        const validated = {
            id: text(artifact.id, "artifact ID", 120),
            title: text(artifact.title, "artifact title", 200, false, true),
            content: text(artifact.content, "artifact content", 200000, true, true),
            language: text(artifact.language, "artifact language", 80, true),
            mermaid: text(artifact.mermaid, "artifact diagram", 50000, true, true),
        };
        text(artifact.kind, "artifact kind", 80, true);
        text(artifact.path, "artifact source path", 500, true);
        if (artifactStage === stage) selected.push(validated);
    }
    if (new Set(selected.map((artifact) => artifact.id)).size !== selected.length) return invalid("Duplicate stage artifact IDs.");
    return selected;
}

function artifactHashes(artifacts: SnapshotArtifact[]): AcceptanceRecord["artifactHashes"] {
    return pairs(artifacts.map((artifact) => ({ id: artifact.id, hash: executionDigest(artifact.content) })), 30, false);
}

function hasCode(error: unknown, code: string): boolean {
    return error instanceof Error && "code" in error && error.code === code;
}

async function io<T>(operation: () => Promise<T>): Promise<T> {
    try {
        return await operation();
    } catch (error) {
        if (error instanceof ProjectStoreError) throw error;
        throw new ProjectStoreError("acceptance_io", "Cannot safely access the acceptance files. Existing files were not overwritten.", 503, { cause: error });
    }
}

function unsafe(): never {
    throw new ProjectStoreError("acceptance_path_unsafe", "Acceptance paths must use materialized directories and regular, unlinked files.", 409);
}

// Check every existing ancestor, including the supplied root: recursive mkdir and
// checking only the leaf would allow junctions/symlinks to redirect the operation.
async function directories(path: string, create = false): Promise<void> {
    const absolute = resolve(path);
    const root = parse(absolute).root;
    let current = root;
    const parts = absolute.slice(root.length).split(sep).filter(Boolean);
    for (const part of ["", ...parts]) {
        if (part) current = join(current, part);
        const stat = await lstat(current).catch(async (error: unknown) => {
            if (!create || !part || !hasCode(error, "ENOENT")) throw error;
            try { await mkdir(current); }
            catch (error) { if (!hasCode(error, "EEXIST")) throw error; }
            return lstat(current);
        });
        if (stat.isSymbolicLink() || !stat.isDirectory()) unsafe();
    }
}

async function roots(workspaceRoot: string, sharedRoot: string): Promise<void> {
    for (const root of [workspaceRoot, sharedRoot]) {
        if (typeof root !== "string" || !isAbsolute(root) || root.includes("\0")) {
            throw new ProjectStoreError("acceptance_path_invalid", "Acceptance roots must be absolute existing directories.", 400);
        }
        await directories(root);
    }
}

async function fileBytes(path: string, max: number): Promise<Buffer> {
    await directories(dirname(path));
    const before = await lstat(path, { bigint: true });
    if (before.isSymbolicLink() || !before.isFile() || before.nlink !== 1n) unsafe();
    if (before.size > BigInt(max)) return invalid("Acceptance file exceeds its size limit.");
    const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
        const opened = await file.stat({ bigint: true });
        if (!opened.isFile() || opened.nlink !== 1n || opened.ino !== before.ino || opened.dev !== before.dev) unsafe();
        // Bounded reads also reject a file growing after the initial size check.
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
        if (current.isSymbolicLink() || current.nlink !== 1n || current.ino !== before.ino || current.dev !== before.dev) unsafe();
        // Windows can update change-time when a newly created file is first read.
        const changedMetadata = process.platform !== "win32" &&
            (after.ctimeNs !== before.ctimeNs || current.ctimeNs !== after.ctimeNs);
        if (BigInt(length) !== before.size || after.size !== before.size || current.size !== after.size ||
            after.mtimeNs !== before.mtimeNs || current.mtimeNs !== after.mtimeNs || changedMetadata) {
            return integrity("An acceptance file changed while it was being read.");
        }
        return buffer.subarray(0, length);
    } finally {
        await file.close();
    }
}

async function exists(path: string): Promise<boolean> {
    await directories(dirname(path));
    try {
        const stat = await lstat(path);
        if (stat.isSymbolicLink() || !stat.isDirectory()) unsafe();
        return true;
    } catch (error) {
        if (hasCode(error, "ENOENT")) return false;
        throw error;
    }
}

async function locked<T>(parent: string, id: string, operation: () => Promise<T>): Promise<T> {
    await directories(parent, true);
    const lock = join(parent, `.${id}.lock`);
    for (let attempt = 0; ; attempt++) {
        await directories(parent);
        try { await mkdir(lock); break; }
        catch (error) {
            if (!hasCode(error, "EEXIST")) throw error;
            try {
                const stat = await lstat(lock);
                if (stat.isSymbolicLink() || !stat.isDirectory()) unsafe();
            } catch (error) {
                if (!hasCode(error, "ENOENT")) throw error;
            }
            if (attempt >= 100) {
                throw new ProjectStoreError("acceptance_busy", "Another operation owns this acceptance. Retry after it finishes; abandoned locks require inspection.", 409);
            }
            await setTimeout(20);
        }
    }
    const owner = await lstat(lock, { bigint: true });
    if (owner.isSymbolicLink() || !owner.isDirectory()) unsafe();
    try {
        return await operation();
    } finally {
        await directories(parent);
        const stat = await lstat(lock, { bigint: true });
        if (stat.isSymbolicLink() || !stat.isDirectory() || stat.ino !== owner.ino || stat.dev !== owner.dev) unsafe();
        await rmdir(lock);
    }
}

async function verifyFiles(directory: string, files: Map<string, Buffer>): Promise<void> {
    await directories(directory);
    const names = await readdir(directory);
    if (names.length !== files.size || names.some((name) => !files.has(name))) {
        throw new ProjectStoreError("acceptance_conflict", "The immutable bundle contains missing or unexpected files; it was preserved.", 409);
    }
    for (const [name, bytes] of files) {
        if (!(await fileBytes(join(directory, name), Math.max(bytes.length, MAX_MANIFEST_BYTES))).equals(bytes)) {
            return integrity("The immutable bundle differs from its accepted bytes; it was preserved.");
        }
    }
}

async function createFiles(directory: string, files: Map<string, Buffer>): Promise<void> {
    await directories(dirname(directory));
    // Reserve the final directory exclusively. Unlike rename, mkdir cannot replace
    // even an empty conflicting directory. The manifest is the last, durable commit marker.
    try { await mkdir(directory); }
    catch (error) {
        if (hasCode(error, "EEXIST")) throw new ProjectStoreError("acceptance_conflict", "The immutable destination already exists; it was preserved.", 409);
        throw error;
    }
    for (const [name, bytes] of files) {
        await directories(directory);
        const file = await open(join(directory, name), "wx", 0o600);
        try { await file.writeFile(bytes); await file.sync(); }
        finally { await file.close(); }
    }
    await verifyFiles(directory, files);
}

function savedManifest(effort: string, record: AcceptanceRecord): Buffer {
    const acceptance = portableRecord(normalizeRecord({ ...record, exportPath: null }));
    return jsonBytes({
        version: 1, effortId: effort, acceptance, acceptanceHash: executionDigest(acceptance),
        snapshot: { path: "snapshot.json", hash: acceptance.snapshotHash },
        attribution: ATTRIBUTION,
    });
}

async function savedAcceptance(directory: string, effort: string): Promise<AcceptanceRecord> {
    const bytes = await fileBytes(join(directory, "manifest.json"), MAX_MANIFEST_BYTES);
    const manifest = object(decode(bytes), ["version", "effortId", "acceptance", "acceptanceHash", "snapshot", "attribution"]);
    const record = normalizeRecord(manifest.acceptance);
    if (record.exportPath !== null || !bytes.equals(savedManifest(effort, record))) {
        return integrity("The saved acceptance manifest or its metadata hash has changed.");
    }
    snapshotLocation(record.snapshotPath, record.stageId, effort);
    return record;
}

async function verifiedSnapshot(directory: string, effort: string, record: AcceptanceRecord): Promise<{
    bytes: Buffer; artifacts: SnapshotArtifact[];
}> {
    const bytes = await fileBytes(join(directory, "snapshot.json"), MAX_SNAPSHOT_BYTES);
    if (sha256(bytes) !== record.snapshotHash) return integrity("The archived snapshot hash has changed.");
    const artifacts = snapshotArtifacts(bytes, effort, record.stageId, record.snapshotPath);
    if (executionDigest(artifactHashes(artifacts)) !== executionDigest(record.artifactHashes)) {
        return integrity("The accepted artifact hashes do not match the snapshot.");
    }
    await verifyFiles(directory, new Map([
        ["snapshot.json", bytes], ["manifest.json", savedManifest(effort, record)],
    ]));
    return { bytes, artifacts };
}

/** Explicitly archive an existing stage revision; no state, lifecycle, or Git mutation. */
export async function acceptStageSnapshot(input: AcceptStageSnapshotInput): Promise<AcceptanceRecord> {
    return io(async () => {
        const effort = effortId(input.effortId);
        const stage = stageId(input.stageId);
        const location = snapshotLocation(input.snapshotPath, stage, effort);
        const metadata = provenance(input);
        await roots(input.workspaceRoot, input.sharedRoot);
        const bytes = await fileBytes(join(input.sharedRoot, ...location.portable.split("/")), MAX_SNAPSHOT_BYTES);
        const artifacts = snapshotArtifacts(bytes, effort, stage, location.original);
        const identity = {
            stageId: stage, snapshotPath: location.original, snapshotHash: sha256(bytes),
            ...metadata, artifactHashes: artifactHashes(artifacts),
        };
        const id = acceptanceId(identity);
        const parent = join(input.sharedRoot, ".tandem", "efforts", effort, "accepted");
        return locked(parent, id, async () => {
            const directory = join(parent, id);
            if (await exists(directory)) {
                const record = await savedAcceptance(directory, effort);
                if (record.id !== id) return integrity("The stored acceptance identity has changed.");
                const saved = await verifiedSnapshot(directory, effort, record);
                if (!saved.bytes.equals(bytes)) return integrity("The stored snapshot differs from the requested acceptance.");
                return { ...record, snapshotPath: location.original };
            }
            const record: AcceptanceRecord = { id, ...identity, acceptedAt: new Date().toISOString(), exportPath: null };
            await createFiles(directory, new Map([
                ["snapshot.json", bytes], ["manifest.json", savedManifest(effort, record)],
            ]));
            return record;
        });
    });
}

function markdownText(value: string): string {
    return value.replace(/[\r\n\u2028\u2029]+/g, " ")
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/[\\`*_[\]{}()#+.!|~-]/g, "\\$&");
}

function fenced(content: string, language: string): string {
    let longest = 2;
    for (const match of content.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
    const fence = "`".repeat(longest + 1);
    return `${fence}${/^[a-zA-Z0-9_+-]*$/.test(language) ? language : ""}\n${content}\n${fence}`;
}

function exportedFiles(effort: string, record: AcceptanceRecord, snapshot: Buffer, artifacts: SnapshotArtifact[]): Map<string, Buffer> {
    const files = new Map<string, Buffer>([["snapshot.json", snapshot]]);
    const artifactFiles = artifacts.map((artifact, index) => {
        const slug = artifact.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "artifact";
        const path = `${String(index + 1).padStart(3, "0")}-${slug}.md`;
        const content = ["", "markdown", "md"].includes(artifact.language.toLowerCase())
            ? artifact.content : fenced(artifact.content, artifact.language);
        const bytes = Buffer.from([
            `# ${markdownText(artifact.title)}`, "", content,
            ...(artifact.mermaid ? ["", fenced(artifact.mermaid, "mermaid")] : []), "",
        ].join("\n"));
        files.set(path, bytes);
        return { id: artifact.id, path, contentHash: executionDigest(artifact.content), fileHash: sha256(bytes) };
    });
    const readme = Buffer.from([
        "# Tandem accepted stage", "", ATTRIBUTION, "",
        `Stage: ${record.stageId}`, `Acceptance: ${record.id}`,
        `Accepted by: ${markdownText(record.acceptedBy.label)}`, `Accepted at: ${record.acceptedAt}`,
        `Source commit: ${record.source.commit ?? "uncommitted repository"}`,
        `Source fingerprint: ${record.source.fingerprint}`,
        `Snapshot SHA256: ${record.snapshotHash}`, "",
        "manifest.json records approval attribution, producing configuration, upstream acceptance hashes, and bundle-relative files.",
        "Its acceptance.snapshotPath remains the original path relative to the shared project root.",
        "snapshot.json preserves the original bytes and may contain sensitive project content. Review this bundle before sharing it.",
        "",
    ].join("\n"));
    files.set("README.md", readme);
    const acceptance = portableRecord(record);
    files.set("manifest.json", jsonBytes({
        version: 1, effortId: effort, acceptance, acceptanceHash: executionDigest(acceptance),
        snapshot: { path: "snapshot.json", hash: record.snapshotHash },
        artifactFiles, readme: { path: "README.md", hash: sha256(readme) }, attribution: ATTRIBUTION,
    }));
    return files;
}

/** Export verified bytes to a local, immutable bundle; the source snapshotPath is retained. */
export async function exportAcceptedSnapshot(
    workspaceRoot: string, sharedRoot: string, inputEffortId: string, inputRecord: AcceptanceRecord,
): Promise<AcceptanceRecord> {
    return io(async () => {
        const effort = effortId(inputEffortId);
        const record = normalizeRecord(inputRecord);
        const location = snapshotLocation(record.snapshotPath, record.stageId, effort);
        await roots(workspaceRoot, sharedRoot);
        const parent = join(sharedRoot, ".tandem", "efforts", effort, "accepted");
        // Export never creates a missing acceptance hierarchy.
        await directories(parent);
        const snapshot = await locked(parent, record.id, async () => {
            const directory = join(parent, record.id);
            const saved = await savedAcceptance(directory, effort);
            if (executionDigest(portableRecord({ ...record, exportPath: null })) !== executionDigest(saved)) {
                return integrity("The supplied approval or provenance differs from the saved manifest.");
            }
            const snapshot = await verifiedSnapshot(directory, effort, saved);
            const original = await fileBytes(join(sharedRoot, ...location.portable.split("/")), MAX_SNAPSHOT_BYTES);
            if (!original.equals(snapshot.bytes)) return integrity("The original stage snapshot changed after acceptance.");
            return snapshot;
        });
        const exported = { ...record, exportPath: exportLocation(effort, record.id) };
        const exportParent = join(workspaceRoot, "tandem-records", effort);
        await locked(exportParent, record.id, async () => {
            const directory = join(exportParent, record.id);
            const files = exportedFiles(effort, exported, snapshot.bytes, snapshot.artifacts);
            if (await exists(directory)) await verifyFiles(directory, files);
            else await createFiles(directory, files);
        });
        return exported;
    });
}
