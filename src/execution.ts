import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

export interface ExecutionToken {
    requestId: string;
    inputRevision: string;
    ownerSessionId: string;
    workspaceRoot: string;
    runId: string | null;
    sourceFingerprint: string | null;
}

export interface WaveManifest {
    index: number;
    itemIds: string[];
    strategy: string[];
    handoffs: string[];
    maxConcurrency: number;
}

export interface ExecutionCancellation {
    requestId: string;
    runId: string | null;
    requestedAt: string;
    confirmedAt: string | null;
    outcome: "cancelled" | "failed";
    reason: string;
    error: string;
}

export class ExecutionSupersededError extends Error {
    constructor() { super("This execution request is no longer active or belongs to another workspace/session."); }
}

export class ExecutionSourceChangedError extends Error {
    constructor() { super("Workspace sources changed during testing. Previous passes are invalid; retry against the new sources."); }
}

export class ExecutionCancellationPendingError extends Error {
    readonly statusCode = 503;
}

function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
            .map(([key, item]) => [key, canonical(item)]));
    }
    return value;
}

export function executionDigest(value: unknown): string {
    return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

export function executionWorkspace(root: string): string {
    const path = resolve(root);
    return process.platform === "win32" ? path.toLowerCase() : path;
}

export function newExecution(inputRevision: string, workspaceRoot: string, ownerSessionId: string,
    sourceFingerprint: string | null = null): ExecutionToken & {
        launchState: "unrequested"; terminalConfirmedAt: null; cancellation: null;
    } {
    if (!ownerSessionId) throw new Error("Execution requires an owning session.");
    return { requestId: randomUUID(), inputRevision, workspaceRoot: executionWorkspace(workspaceRoot),
        ownerSessionId, sourceFingerprint, runId: null, launchState: "unrequested",
        terminalConfirmedAt: null, cancellation: null };
}

export function normalizeExecutionFields(value: Record<string, any>) {
    for (const key of ["requestId", "inputRevision", "ownerSessionId", "workspaceRoot", "sourceFingerprint", "runId"]) {
        if (value[key] !== undefined && value[key] !== null &&
            (typeof value[key] !== "string" || !value[key].trim() ||
                (key === "runId" && value[key].trim().length > 200))) {
            throw new Error(`Stored execution identity field ${key} is invalid.`);
        }
    }
    const text = (key: string) => typeof value[key] === "string" && value[key].trim() ? value[key].trim() : null;
    const cancellation: ExecutionCancellation | null = value.cancellation ?? null;
    if (cancellation && (
        typeof cancellation.requestId !== "string" || !cancellation.requestId ||
        (cancellation.runId !== null && typeof cancellation.runId !== "string") ||
        typeof cancellation.requestedAt !== "string" || !cancellation.requestedAt ||
        (cancellation.confirmedAt !== null && typeof cancellation.confirmedAt !== "string") ||
        !["cancelled", "failed"].includes(cancellation.outcome) ||
        typeof cancellation.reason !== "string" || typeof cancellation.error !== "string"
    )) throw new Error("Stored execution cancellation is invalid.");
    const waveManifests: WaveManifest[] = value.waveManifests ?? [];
    if (!Array.isArray(waveManifests) || waveManifests.some((wave) =>
        !wave || !Number.isInteger(wave.index) || wave.index < 1 ||
        !Array.isArray(wave.itemIds) || wave.itemIds.some((id) => typeof id !== "string") ||
        new Set(wave.itemIds).size !== wave.itemIds.length ||
        !Array.isArray(wave.strategy) || wave.strategy.some((text) => typeof text !== "string") ||
        !Array.isArray(wave.handoffs) || wave.handoffs.some((text) => typeof text !== "string") ||
        !Number.isInteger(wave.maxConcurrency) || wave.maxConcurrency < 1 || wave.maxConcurrency > 30) ||
        new Set(waveManifests.map((wave) => wave.index)).size !== waveManifests.length) {
        throw new Error("Stored execution wave manifests are invalid.");
    }
    return { requestId: text("requestId"), inputRevision: text("inputRevision"),
        ownerSessionId: text("ownerSessionId"), workspaceRoot: text("workspaceRoot"),
        sourceFingerprint: text("sourceFingerprint"), waveManifests,
        cancellation, terminalConfirmedAt: text("terminalConfirmedAt"),
        launchState: ["unrequested", "requested", "bound", "settled"].includes(value.launchState)
            ? value.launchState as "unrequested" | "requested" | "bound" | "settled" : "unknown" as const };
}

export function executionToken(value: Record<string, any>): ExecutionToken {
    const fields = normalizeExecutionFields(value);
    if (!fields.requestId || !fields.inputRevision || !fields.workspaceRoot || !fields.ownerSessionId) {
        throw new Error("Execution recovery requires a durable request and owner identity. Inspect the previous run before retrying.");
    }
    return { requestId: fields.requestId, inputRevision: fields.inputRevision,
        workspaceRoot: fields.workspaceRoot, ownerSessionId: fields.ownerSessionId,
        sourceFingerprint: fields.sourceFingerprint, runId: typeof value.runId === "string" ? value.runId.trim() : null };
}

export function assertExecutionRequest(runtime: Record<string, any>, token: ExecutionToken,
    inputRevision: string, workspaceRoot: string, sessionId: string, allowUnbound = false): void {
    if (!token || !token.requestId || !token.inputRevision ||
        runtime.requestId !== token.requestId || runtime.inputRevision !== token.inputRevision ||
        inputRevision !== token.inputRevision || runtime.ownerSessionId !== token.ownerSessionId ||
        token.ownerSessionId !== sessionId || runtime.workspaceRoot !== token.workspaceRoot ||
        token.workspaceRoot !== executionWorkspace(workspaceRoot) ||
        runtime.sourceFingerprint !== token.sourceFingerprint ||
        (!allowUnbound && (!token.runId || runtime.runId !== token.runId)) ||
        (allowUnbound && runtime.runId && runtime.runId !== token.runId)) {
        throw new ExecutionSupersededError();
    }
}

const ignoredDirectories = new Set([
    ".git", ".tandem", "node_modules", ".next", ".nuxt", ".cache",
]);
const rootOutputs = new Set(["dist", "build", "out", "coverage", "generated"]);

export async function fingerprintWorkspace(root: string): Promise<string> {
    const hash = createHash("sha256");
    async function visit(directory: string, prefix: string) {
        const entries = (await readdir(directory, { withFileTypes: true }))
            .sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
            const name = entry.name.toLowerCase();
            if (ignoredDirectories.has(name) || (!prefix && rootOutputs.has(name)) || name.endsWith(".tsbuildinfo")) continue;
            const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
            const path = join(directory, entry.name);
            if (entry.isDirectory()) {
                await visit(path, relativePath);
            } else if (entry.isSymbolicLink()) {
                throw new Error(`Cannot safely fingerprint linked source ${relativePath}; use a workspace with materialized sources.`);
            } else if (entry.isFile()) {
                const before = await lstat(path);
                hash.update(JSON.stringify([relativePath, before.size]));
                for await (const chunk of createReadStream(path)) hash.update(chunk);
                const after = await lstat(path);
                if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
                    throw new ExecutionSourceChangedError();
                }
                hash.update("\0");
            }
        }
    }
    await visit(root, "");
    return hash.digest("hex");
}

export async function assertExecutionSources(token: ExecutionToken): Promise<void> {
    if (!token.sourceFingerprint || await fingerprintWorkspace(token.workspaceRoot) !== token.sourceFingerprint) {
        throw new ExecutionSourceChangedError();
    }
}

export function workerOutcome(value: unknown, requirements: string[], testing = false) {
    const object = (input: unknown): Record<string, unknown> =>
        input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
    const result = object(value);
    const strings = (input: unknown): string[] => Array.isArray(input)
        ? input.filter((item): item is string => typeof item === "string" && !!item.trim()).map((item) => item.trim()) : [];
    const summary = typeof result.summary === "string" ? result.summary.trim() : "";
    const blockers = strings(result.blockers);
    const evidence = strings(result.evidence);
    const checks = Array.isArray(result.validation) ? result.validation.map(object) : [];
    const validation = checks.flatMap((check) => typeof check.requirement === "string" &&
        typeof check.evidence === "string" && check.evidence.trim()
        ? [`${check.requirement}: ${check.status} — ${check.evidence.trim()}`] : []);
    const errors: string[] = [];
    if (!summary) errors.push("A nonempty result summary is required.");
    if (!Array.isArray(result.blockers) || result.blockers.some((item) => typeof item !== "string")) {
        errors.push("An explicit blocker list is required.");
    }
    if (blockers.length) errors.push(...blockers);
    if (testing && !evidence.length) errors.push("Passing tests require observed outcome evidence.");
    for (const requirement of requirements) {
        const matching = checks.filter((check) => check?.requirement === requirement);
        if (matching.length !== 1 || matching[0].status !== "passed" ||
            typeof matching[0].evidence !== "string" || !matching[0].evidence.trim()) {
            errors.push(`Missing passing validation evidence for: ${requirement}`);
        }
    }
    if (!requirements.length || checks.some((check) => check?.status !== "passed")) {
        errors.push("All required validation checks must pass.");
    }
    const succeeded = result.status === (testing ? "passed" : "completed") && errors.length === 0;
    return { status: succeeded ? (testing ? "passed" : "completed") : "failed",
        summary: succeeded ? summary : [summary || "Worker returned no valid result.", ...errors].join(" "),
        validation, evidence: [...evidence, ...validation], filesChanged: strings(result.filesChanged),
        blockers: succeeded ? [] : errors.length ? errors : ["Worker reported failure."] };
}
