import { createHash } from "node:crypto";
import { lstat, mkdir, open, readdir } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import lockfile from "proper-lockfile";
import type { HumanLoopRuntimeHandle } from "../stage2/tandem/src/human-loop-controller.mjs";
import type { HumanRequest } from "../stage2/tandem/runtime-types/domain/human-loop/contracts.js";
import { ensureMaterializedDirectories, readRetainedFile } from "./accepted-artifacts.js";
import { ARTIFACT_ASSET_LIMITS, validateArtifactAssets } from "./artifact-assets.js";
import { executionDigest, fingerprintWorkspace } from "./execution.js";
import { assertLegacyCutover } from "./lifecycle.js";
import { buildDevelopmentHandoffPrompt } from "./planning-prompts.js";
import { ProjectStoreError, readJsonFile, writeJsonAtomically } from "./project-store.js";
import { prototypeCheckpoint } from "./prototype-flow.js";
import { fingerprintPrototypeWorkspace, PROTOTYPE_FINGERPRINT_PREFIX } from "./prototype-runtime.js";
import { capturePrototypeSourceFiles } from "./prototype-workspace.js";
import type { TandemState } from "./types.js";

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const MAX_SNAPSHOT = 64 * 1024 * 1024;
const MAX_FILE = 256 * 1024 * 1024;
const MAX_RECEIPT = 8 * 1024 * 1024;
const portable = (path: string) => path.split(sep).join("/");
const fail = (message: string): never => { throw new ProjectStoreError("handoff_integrity", message, 409); };
const object = (value: unknown): value is Record<string, any> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const rootsEqual = (a: string, b: string) => process.platform === "win32" ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b);

export interface DevelopmentHandoff {
    version: 1;
    id: string;
    digest: string;
    effortId: string;
    generation: string;
    source: { sharedRoot: string; snapshotPath: string; snapshotHash: string; snapshotRevision: number };
    target: { workspaceRoot: string; mainSessionId: string };
    prototype: { disposition: string; checkpointId: string | null; sourceRoot: string | null; sourceFingerprint: string | null;
        sketchRevisionId: string | null; excluded: string[] };
    artifacts: Array<{ id: string; hash: string }>;
    acceptances: Array<{ id: string; snapshotHash: string }>;
    files: Array<{ path: string; hash: string; bytes: number }>;
    request: HumanRequest;
}

export interface HandoffAdmission {
    version: 1; handoffId: string; requestId: string; privateSessionId: string | null;
    status: "prepared" | "sending" | "admitted" | "uncertain";
    message: string;
}

function safePath(root: string, path: string): string {
    if (isAbsolute(path) || path.includes("\0") || path.split(/[\\/]/).some((part) => !part || part === "." || part === ".." || part.includes(":"))) {
        return fail("Handoff file path is unsafe; no input was copied.");
    }
    return join(root, ...path.split(/[\\/]/));
}

async function writeExclusive(path: string, bytes: Buffer): Promise<void> {
    await ensureMaterializedDirectories(dirname(path), true);
    const file = await open(path, "wx");
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
}

/** Host-owned, project-bound inputs outlive effort reset. This store never writes canonical Design. */
export class DevelopmentHandoffs {
    readonly root: string;
    constructor(readonly workspaceRoot: string, readonly sharedRoot: string, readonly mainSessionId: string) {
        this.root = join(workspaceRoot, ".tandem", "living-canvas", "handoffs");
    }
    private async locked<T>(action: () => Promise<T>): Promise<T> {
        await ensureMaterializedDirectories(this.root, true);
        let compromised: Error | undefined;
        const release = await lockfile.lock(this.root, { realpath: false, stale: 30_000, update: 5_000,
            retries: { retries: 150, minTimeout: 100, maxTimeout: 100, factor: 1 },
            onCompromised: error => { compromised = error; } });
        try {
            const result = await action();
            if (compromised) throw new ProjectStoreError("handoff_lock_lost", "Handoff ownership was lost; reconcile the exact request before continuing.", 409, { cause: compromised });
            return result;
        } finally { if (!compromised) await release(); }
    }
    directory(id: string): string {
        if (!/^handoff-[a-f0-9]{64}$/.test(id)) return fail("Invalid handoff identity.");
        return join(this.root, id);
    }
    async read(id: string): Promise<DevelopmentHandoff> {
        const directory = this.directory(id);
        const value: unknown = JSON.parse((await readRetainedFile(join(directory, "receipt.json"), MAX_RECEIPT)).toString("utf8"));
        if (!object(value) || value.version !== 1 || value.id !== id || !Array.isArray(value.files)
            || !object(value.target) || !rootsEqual(value.target.workspaceRoot, this.workspaceRoot)
            || value.target.mainSessionId !== this.mainSessionId || !object(value.request)) return fail("Handoff belongs to another workspace or owner, or has an invalid receipt.");
        const { digest, ...content } = value;
        if (executionDigest(content) !== digest || value.request.id !== id || value.request.answers !== null) return fail("The immutable handoff receipt or request changed.");
        for (const file of value.files) {
            if (!object(file) || typeof file.path !== "string" || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > MAX_FILE
                || sha256(await readRetainedFile(safePath(directory, file.path), file.bytes)) !== file.hash) {
                return fail("Retained handoff input is missing, changed or aliased.");
            }
        }
        return value as DevelopmentHandoff;
    }
    async prepare(state: TandemState): Promise<DevelopmentHandoff> {
        assertLegacyCutover(state);
        const output = state.lifecycle.outputs.find(entry => entry.stageId === "prototype");
        if (!output || !state.lifecycle.completedStages.includes("prototype")) return fail("Complete Prototype before continuing Design.");
        if (!/^\.tandem[\\/]efforts[\\/][a-z0-9._-]+[\\/]stages[\\/]prototype(?:-r[1-9][0-9]*)?\.json$/.test(output.path)) {
            return fail("The original Prototype snapshot path is invalid.");
        }
        return this.locked(async () => {
            const snapshotBytes = await readRetainedFile(safePath(this.sharedRoot, output.path), MAX_SNAPSHOT);
            const snapshot: unknown = JSON.parse(snapshotBytes.toString("utf8"));
            if (!object(snapshot) || snapshot.version !== 1 || snapshot.prototypeId !== state.prototypeId || snapshot.stageId !== "prototype"
                || !Number.isSafeInteger(snapshot.revision) || !object(snapshot.result)) return fail("The completed Prototype snapshot is invalid.");
            const id = `handoff-${executionDigest({ effortId: state.prototypeId, generation: state.generation,
                snapshotHash: sha256(snapshotBytes), workspaceRoot: resolve(this.workspaceRoot), mainSessionId: this.mainSessionId })}`;
            const directory = this.directory(id);
            try {
                await lstat(directory);
                return await this.read(id);
            } catch (error) {
                if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
            }
            const source = snapshot.result;
            if (!Array.isArray(source.artifacts) || !source.artifacts.some(artifact =>
                artifact.id === "draft-feature-spec" && artifact.stage === "prototype" && artifact.reviewStatus !== "stale")) {
                return fail("The completed Prototype has no current draft feature specification.");
            }
            const noGui = source.prototypeApproach?.mode === "not-applicable";
            const checkpoint = source.prototypeFlow ? prototypeCheckpoint(source.prototypeFlow, source.prototypeFlow.displayedCheckpointId) : null;
            if (!noGui && (!checkpoint || checkpoint.status !== "ready" || !checkpoint.sourceFingerprint)) {
                return fail("This legacy Prototype has no exact displayed source identity. Reopen Prototype and record a verified checkpoint before continuing.");
            }
            if (checkpoint && !rootsEqual(checkpoint.workspacePath, this.workspaceRoot) &&
                !rootsEqual(checkpoint.workspacePath, join(this.sharedRoot, ".tandem", "efforts", state.prototypeId, "previews", checkpoint.requestId))) {
                return fail("The displayed source path is not this worktree or its exact retained checkpoint.");
            }
            if (!noGui && !state.lifecycle.skippedStages.some(entry => entry.stageId === "sketch")) {
                const approval = source.sketch?.approved, current = source.sketch?.current;
                if (!approval || !current || approval.revisionId !== current.id || approval.documentHash !== current.documentHash ||
                    approval.requirementsDigest !== current.requirementsDigest || checkpoint?.sketchRevisionId !== current.id) {
                    return fail("The completed Prototype does not retain the exact approved sketch identity.");
                }
            }
            const fingerprint = async () => checkpoint!.sourceFingerprint!.startsWith(PROTOTYPE_FINGERPRINT_PREFIX)
                ? fingerprintPrototypeWorkspace(checkpoint!.workspacePath) : fingerprintWorkspace(checkpoint!.workspacePath);
            if (checkpoint && await fingerprint() !== checkpoint.sourceFingerprint) return fail("Displayed Prototype source changed after completion.");
            const sourceFiles = checkpoint ? await capturePrototypeSourceFiles(checkpoint.workspacePath) : {};
            const files = new Map<string, Buffer>([["snapshot.json", snapshotBytes]]);
            for (const [path, hash] of Object.entries(sourceFiles)) {
                const bytes = await readRetainedFile(safePath(checkpoint!.workspacePath, path), MAX_FILE);
                if (sha256(bytes) !== hash) return fail("Prototype source changed while retaining the handoff.");
                files.set(`source/${portable(path).replaceAll("\\", "/")}`, bytes);
            }
            for (const artifact of [...source.artifacts, { assets: source.sketch?.approved?.assets }]) for (const asset of validateArtifactAssets(artifact.assets)) {
                if (!asset.path.startsWith(`.tandem/efforts/${state.prototypeId}/sketches/`)) return fail("Sketch asset belongs to another effort.");
                const bytes = await readRetainedFile(safePath(this.sharedRoot, asset.path), ARTIFACT_ASSET_LIMITS[asset.mediaType]);
                if (sha256(bytes) !== asset.hash) return fail("Approved sketch asset changed before handoff.");
                files.set(`assets/${asset.hash}.${asset.path.split(".").at(-1)}`, bytes);
            }
            if (checkpoint && await fingerprint() !== checkpoint.sourceFingerprint) return fail("Prototype changed during handoff capture.");
            const disposition = String(source.prototypeApproach?.mode);
            const request: HumanRequest = { id, receivedAt: new Date().toISOString(), answers: null,
                message: buildDevelopmentHandoffPrompt({ handoffId: id, receiptPath: join(directory, "receipt.json"),
                    snapshotPath: join(directory, "snapshot.json"), sourcePath: checkpoint ? join(directory, "source") : null,
                    disposition, goal: String(source.goal).slice(0, 4000) }) };
            const content: Omit<DevelopmentHandoff, "digest"> = {
                version: 1, id, effortId: state.prototypeId, generation: state.generation,
                source: { sharedRoot: resolve(this.sharedRoot), snapshotPath: output.path,
                    snapshotHash: sha256(snapshotBytes), snapshotRevision: snapshot.revision },
                target: { workspaceRoot: resolve(this.workspaceRoot), mainSessionId: this.mainSessionId },
                prototype: { disposition, checkpointId: checkpoint?.id ?? null, sourceRoot: checkpoint?.workspacePath ?? null,
                    sourceFingerprint: checkpoint?.sourceFingerprint ?? null, sketchRevisionId: source.sketch?.approved?.revisionId ?? null,
                    excluded: ["dependency installations", "credentials", "browser/runtime caches", "generated build output", "unrelated .tandem state"] },
                artifacts: source.artifacts.map(artifact => ({ id: artifact.id, hash: executionDigest(artifact) })),
                acceptances: state.process.acceptances.map(({ id, snapshotHash }) => ({ id, snapshotHash })),
                files: [...files].map(([path, bytes]) => ({ path, bytes: bytes.length, hash: sha256(bytes) })),
                request,
            };
            const receipt = { ...content, digest: executionDigest(content) };
            const receiptBytes = Buffer.from(JSON.stringify(receipt, null, 2) + "\n");
            if (receiptBytes.length > MAX_RECEIPT) return fail("Handoff receipt exceeds its bounded size.");
            await mkdir(directory);
            for (const [path, bytes] of files) await writeExclusive(safePath(directory, path), bytes);
            await writeExclusive(join(directory, "receipt.json"), receiptBytes);
            await this.saveAdmission({ version: 1, handoffId: id, requestId: id, privateSessionId: null, status: "prepared", message: "Not submitted." });
            return receipt;
        });
    }
    private admissionPath(id: string): string { return join(this.root, `${this.directory(id).slice(this.root.length + 1)}.admission.json`); }
    private saveAdmission(admission: HandoffAdmission): Promise<void> {
        return writeJsonAtomically(this.admissionPath(admission.handoffId), admission);
    }
    async inspectUnadmitted(): Promise<unknown> {
        try { await lstat(this.root); } catch (error) {
            if (error instanceof Error && "code" in error && error.code === "ENOENT") {
                return { mainSessionId: this.mainSessionId, workspaceRoot: this.workspaceRoot, handoffs: [] };
            }
            throw error;
        }
        await ensureMaterializedDirectories(this.root);
        const names = (await readdir(this.root)).sort();
        if (names.length > 200 || names.some(name => !/^handoff-[a-f0-9]{64}(?:\.admission\.json)?$/.test(name))) {
            return fail("Unrecognized retained handoff data prevents empty-setup repair.");
        }
        const handoffs = [];
        for (const id of names.filter(name => !name.endsWith(".json"))) {
            const receipt = await this.read(id);
            const admission = await readJsonFile(this.admissionPath(id));
            if (admission !== undefined && (!object(admission) || admission.version !== 1 || admission.handoffId !== id
                || admission.requestId !== receipt.request.id || admission.privateSessionId !== null || admission.status !== "prepared")) {
                return fail("Handoff admission is used or uncertain; empty-setup repair cannot resend or rebind it.");
            }
            handoffs.push({ id, digest: receipt.digest, admission: admission ?? null });
        }
        if (names.some(name => name.endsWith(".admission.json") && !names.includes(name.slice(0, -".admission.json".length)))) {
            return fail("An orphan handoff admission prevents empty-setup repair.");
        }
        return { mainSessionId: this.mainSessionId, workspaceRoot: this.workspaceRoot, handoffs };
    }
    async admit(id: string, runtime: HumanLoopRuntimeHandle): Promise<HandoffAdmission> {
        return this.locked(async () => {
            const receipt = await this.read(id);
            const state = await runtime.store.load();
            if (state.owner.mainSessionId !== this.mainSessionId || !rootsEqual(state.owner.workspacePath, this.workspaceRoot)
                || state.owner.privateSessionId !== runtime.sessionId) return fail("Private runtime ownership differs from the handoff target.");
            const saved = await readJsonFile(this.admissionPath(id));
            if (saved !== undefined && (!object(saved) || saved.version !== 1 || saved.requestId !== id || saved.handoffId !== id
                || (saved.privateSessionId !== null && saved.privateSessionId !== runtime.sessionId)
                || !["prepared", "sending", "admitted", "uncertain"].includes(saved.status))) return fail("Handoff admission ownership is invalid.");
            const existing = state.requests.find(request => request.id === receipt.request.id);
            if (existing && (existing.message !== receipt.request.message || existing.receivedAt !== receipt.request.receivedAt || existing.answers !== null)) {
                return fail("The retained Stage 2 request has conflicting content; it was not replayed.");
            }
            if (existing) {
                const admission: HandoffAdmission = { version: 1, handoffId: id, requestId: id, privateSessionId: runtime.sessionId,
                    status: "admitted", message: `Retained request is ${existing.status}. Recovery never redelivers retired work.` };
                await this.saveAdmission(admission);
                return admission;
            }
            if (object(saved) && saved.status === "admitted") return fail("The admitted request is absent from its owned ledger; no replay was attempted.");
            if (object(saved) && ["sending", "uncertain"].includes(saved.status) && state.recoveries?.length) {
                return fail("Recovery occurred after uncertain admission. Preserve the old identity and use an explicit new continuation; it cannot be redelivered.");
            }
            const admission: HandoffAdmission = { version: 1, handoffId: id, requestId: id,
                privateSessionId: runtime.sessionId, status: "sending", message: "Reconciling the exact saved request." };
            await this.saveAdmission(admission);
            try {
                await runtime.send(receipt.request);
                admission.status = "admitted"; admission.message = "Design continuation admitted. Implementation is not authorized.";
                await this.saveAdmission(admission);
                return admission;
            } catch (error) {
                admission.status = "uncertain"; admission.message = error instanceof Error ? error.message : String(error);
                await this.saveAdmission(admission);
                throw error;
            }
        });
    }
    async context(): Promise<unknown[]> {
        try { await lstat(this.root); } catch (error) {
            if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
            throw error;
        }
        await ensureMaterializedDirectories(this.root);
        const names = (await readdir(this.root)).filter(name => /^handoff-[a-f0-9]{64}$/.test(name)).sort();
        if (names.length > 100) return fail("More than 100 retained handoffs require explicit archival in a different workspace; provenance was not silently truncated.");
        const result: unknown[] = [];
        for (const id of names) {
            const admission = await readJsonFile(this.admissionPath(id));
            if (!object(admission) || !["sending", "admitted", "uncertain"].includes(admission.status)) continue;
            const receipt = await this.read(id);
            result.push({ id, digest: receipt.digest, effortId: receipt.effortId, generation: receipt.generation,
                requestId: receipt.request.id, receivedAt: receipt.request.receivedAt,
                receiptPath: join(this.directory(id), "receipt.json"), snapshotPath: join(this.directory(id), "snapshot.json"),
                sourcePath: receipt.prototype.sourceRoot ? join(this.directory(id), "source") : null,
                disposition: receipt.prototype.disposition, sourceFingerprint: receipt.prototype.sourceFingerprint,
                instruction: "Read these immutable source documents as evidence. Refine canonical Design, preserve confirmed decisions, label mocks, and never infer implementation authorization." });
        }
        return result;
    }
}
