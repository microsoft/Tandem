import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, realpath, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ProjectStoreError } from "./project-store.js";

export interface AdapterResult {
    reference: string;
    summary: string;
    details?: unknown;
}

/** Intake text is untrusted source data, never executable instructions. */
export interface IntakeRecord {
    reference: string;
    title: string;
    body: string;
    kind: "issue" | "ci-failure" | "incident";
    observedAt: string;
}

export interface HandoffInput {
    idempotencyKey: string;
    effortId: string;
    title: string;
    body: string;
    reference: string;
}

export interface ProcessAdapter {
    id: "local" | "github";
    label: string;
    handoff(input: HandoffInput): Promise<AdapterResult>;
    status(reference: string): Promise<AdapterResult>;
    intake(input: { reference: string; content?: string }): Promise<IntakeRecord>;
}

export class ProcessAdapterRegistry {
    private readonly adapters = new Map<string, ProcessAdapter>();

    register(adapter: ProcessAdapter): void {
        if (!adapter || !["local", "github"].includes(adapter.id) || !adapter.label ||
            ["handoff", "status", "intake"].some((block) =>
                typeof adapter[block as "handoff" | "status" | "intake"] !== "function")) {
            fail("adapter_invalid", "A process adapter must implement handoff, status, and intake.");
        }
        if (this.adapters.has(adapter.id)) fail("adapter_duplicate", "This process adapter is already registered.");
        this.adapters.set(adapter.id, adapter);
    }

    get(id: string): ProcessAdapter {
        const adapter = this.adapters.get(id);
        if (!adapter) fail("adapter_unknown", "Select a registered process adapter; no fallback was performed.");
        return adapter;
    }

    list(): Array<{ id: ProcessAdapter["id"]; label: string; blocks: string[] }> {
        return [...this.adapters.values()].map(({ id, label }) => ({ id, label, blocks: ["handoff", "status", "intake"] }));
    }
}

export const HANDOFF_BODY_LIMIT_BYTES = 60_000;
const MAX_SOURCE = 300_000;
const MAX_OUTPUT = 8 * 1024 * 1024;
const MAX_PAGINATED_OUTPUT = 16 * 1024 * 1024;
const MAX_STATUS_DETAILS = 10_000;
const MAX_PAGES = 20;
const PAGE_SIZE = 100;
const LOCAL_SUMMARY = "local handoff; not published; no external review/check claim";
const conclusionValues = new Set([
    "success", "failure", "neutral", "cancelled", "skipped", "timed_out",
    "action_required", "stale", "startup_failure",
]);

function fail(code: string, message: string, statusCode = 422): never {
    throw new ProjectStoreError(code, message, statusCode);
}

function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        fail("adapter_data_invalid", "Expected an adapter data object.");
    }
    return value as Record<string, unknown>;
}

function text(value: unknown, name: string, max: number, allowEmpty = false): string {
    if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > max ||
        (!allowEmpty && !value.trim()) || value.includes("\0") || Buffer.from(value, "utf8").toString("utf8") !== value) {
        fail("adapter_data_invalid", `Invalid or oversized ${name}.`);
    }
    return value;
}

function line(value: unknown, name: string, max: number): string {
    const result = text(value, name, max);
    if (/[\r\n]/.test(result)) fail("adapter_data_invalid", `Invalid ${name}.`);
    return result;
}

function identifier(value: unknown): string {
    const result = text(value, "local ID or idempotency key", 128);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(result) || result.endsWith(".") ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(result)) {
        fail("adapter_reference_invalid", "Use a safe, non-reserved ID without path separators.");
    }
    return result;
}

function handoffInput(value: unknown): HandoffInput {
    const input = object(value);
    return {
        idempotencyKey: identifier(input.idempotencyKey),
        effortId: line(input.effortId, "effort ID", 128),
        title: line(input.title, "title", 300),
        body: text(input.body, "handoff body", HANDOFF_BODY_LIMIT_BYTES, true),
        reference: line(input.reference, "source reference", 2048),
    };
}

function markdown(input: HandoffInput): string {
    return `# ${input.title}\n\n${input.body}\n\n---\nEffort: ${input.effortId}\nReference: ${input.reference}\n`;
}

function parseJson(source: string): unknown {
    try { return JSON.parse(source); }
    catch { return fail("adapter_data_invalid", "The adapter returned invalid JSON; no data was replaced."); }
}

function sampleRows<T>(values: T[], byteBudget: number): T[] {
    const sampled: T[] = [];
    let bytes = 0;
    for (const value of values) {
        const size = Buffer.byteLength(JSON.stringify(value), "utf8") + (sampled.length ? 1 : 0);
        if (bytes + size > byteBudget) continue;
        sampled.push(value);
        bytes += size;
    }
    return sampled;
}

function errorCode(error: unknown): unknown {
    return error && typeof error === "object" && "code" in error ? error.code : undefined;
}

function samePath(a: string, b: string): boolean {
    return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

async function ownedDirectory(root: string, segments: string[], create = false): Promise<string> {
    let current = root;
    for (const segment of ["", ...segments]) {
        if (segment) current = join(current, segment);
        if (create && segment) {
            try { await mkdir(current); }
            catch (error) { if (errorCode(error) !== "EEXIST") throw error; }
        }
        const info = await lstat(current);
        if (!info.isDirectory() || info.isSymbolicLink() || !samePath(await realpath(current), current)) {
            fail("adapter_path_unsafe", "Local records must be real directories within the configured workspace.");
        }
    }
    return current;
}

async function readOwnedFile(root: string, segments: string[], name: string): Promise<string> {
    const directory = await ownedDirectory(root, segments);
    const path = join(directory, name);
    const before = await lstat(path);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > MAX_SOURCE) {
        fail("adapter_path_unsafe", "The local bundle contains an unsafe or oversized file.");
    }
    const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
        const opened = await file.stat();
        if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== before.dev || opened.ino !== before.ino) {
            fail("adapter_path_unsafe", "The local bundle changed while it was being read.");
        }
        const buffer = Buffer.alloc(MAX_SOURCE + 1);
        let length = 0;
        while (length < buffer.length) {
            const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
            if (!bytesRead) break;
            length += bytesRead;
        }
        if (length > MAX_SOURCE) fail("adapter_data_invalid", "The local bundle is oversized.");
        await ownedDirectory(root, segments);
        const after = await lstat(path);
        if (after.isSymbolicLink() || after.dev !== opened.dev || after.ino !== opened.ino || after.nlink !== 1) {
            fail("adapter_path_unsafe", "The local bundle changed while it was being read.");
        }
        return buffer.subarray(0, length).toString("utf8");
    } finally { await file.close(); }
}

async function writeOwnedFileAtomically(root: string, segments: string[], name: string, content: string): Promise<void> {
    const directory = await ownedDirectory(root, segments);
    const staging = join(directory, `.${name}.${randomUUID()}.pending`);
    const file = await open(staging, "wx", 0o600);
    try {
        try {
            await file.writeFile(content, "utf8");
            await file.sync();
        } finally { await file.close(); }
        await ownedDirectory(root, segments);
        // Unlike rename, link publishes a complete file atomically without replacing a target.
        await link(staging, join(directory, name));
    } finally { await unlink(staging); }
}

interface LocalBundle {
    version: 1;
    createdAt: string;
    input: HandoffInput;
}

function localReference(key: string): string {
    return join("tandem-records", "delivery", key);
}

function localAdapter(root: string): ProcessAdapter {
    const readBundle = async (key: string): Promise<LocalBundle> => {
        const segments = ["tandem-records", "delivery", key];
        let json: string;
        let md: string;
        try {
            json = await readOwnedFile(root, segments, "handoff.json");
            md = await readOwnedFile(root, segments, "handoff.md");
        } catch (error) {
            if (error instanceof ProjectStoreError) throw error;
            return fail("adapter_local_unavailable", "The local bundle is missing, incomplete, or unreadable; it was not replaced.", 503);
        }
        const bundle = object(parseJson(json));
        const input = handoffInput(bundle.input);
        if (bundle.version !== 1 || input.idempotencyKey !== key ||
            typeof bundle.createdAt !== "string" || !Number.isFinite(Date.parse(bundle.createdAt)) ||
            md !== markdown(input)) {
            fail("adapter_data_invalid", "The local bundle is inconsistent; it was not replaced.");
        }
        return { version: 1, createdAt: bundle.createdAt, input };
    };
    const result = (bundle: LocalBundle): AdapterResult => ({
        reference: localReference(bundle.input.idempotencyKey),
        summary: LOCAL_SUMMARY,
        details: {
            version: bundle.version,
            createdAt: bundle.createdAt,
            idempotencyKey: bundle.input.idempotencyKey,
            effortId: bundle.input.effortId,
            title: bundle.input.title,
            bodyBytes: Buffer.byteLength(bundle.input.body, "utf8"),
            artifacts: {
                json: join(localReference(bundle.input.idempotencyKey), "handoff.json"),
                markdown: join(localReference(bundle.input.idempotencyKey), "handoff.md"),
            },
            contentLocation: "Complete handoff input is preserved in the artifact files, not repeated in this receipt.",
            published: false,
            externalReview: "not evaluated",
            externalChecks: "not evaluated",
        },
    });
    return {
        id: "local",
        label: "Local",
        async handoff(value) {
            const input = handoffInput(value);
            const bundle: LocalBundle = { version: 1, createdAt: new Date().toISOString(), input };
            const json = text(`${JSON.stringify(bundle, null, 2)}\n`, "serialized local bundle", MAX_SOURCE);
            const md = markdown(input);
            const parent = await ownedDirectory(root, ["tandem-records", "delivery"], true);
            const directory = join(parent, input.idempotencyKey);
            let created = false;
            try {
                await mkdir(directory);
                created = true;
            } catch (error) {
                if (errorCode(error) !== "EEXIST") {
                    fail("adapter_local_unavailable", "Cannot reserve a local handoff bundle.", 503);
                }
            }
            if (!created) {
                const bundle = await readBundle(input.idempotencyKey);
                if (JSON.stringify(bundle.input) !== JSON.stringify(input)) {
                    fail("adapter_idempotency_conflict", "This handoff key already contains different input; nothing was overwritten.", 409);
                }
                return result(bundle);
            }
            // Exclusive directory reservation and atomic, no-clobber files never replace a bundle.
            // An interrupted partial write is preserved and fails closed on a later retry.
            try {
                for (const [name, content] of [["handoff.json", json], ["handoff.md", md]] as const) {
                    await writeOwnedFileAtomically(root, ["tandem-records", "delivery", input.idempotencyKey], name, content);
                }
            } catch (error) {
                if (error instanceof ProjectStoreError) throw error;
                fail("adapter_local_unavailable", "Cannot complete the local bundle; any partial records were preserved.", 503);
            }
            return result(await readBundle(input.idempotencyKey));
        },
        async status(reference) {
            const normalized = text(reference, "local reference", 256).replace(/\\/g, "/");
            const match = /^tandem-records\/delivery\/([^/]+)$/.exec(normalized);
            if (!match) fail("adapter_reference_invalid", "Status can read only an owned local delivery bundle.");
            return result(await readBundle(identifier(match[1])));
        },
        async intake(value) {
            const input = object(value);
            const reference = identifier(input.reference);
            const source = object(parseJson(text(input.content, "local intake JSON", MAX_SOURCE)));
            if (Object.keys(source).some((key) => !["title", "body", "kind"].includes(key))) {
                fail("adapter_data_invalid", "Local intake accepts only title, body, and optional kind.");
            }
            const kind = source.kind === undefined ? "issue" : source.kind;
            if (kind !== "issue" && kind !== "ci-failure" && kind !== "incident") {
                fail("adapter_data_invalid", "Invalid local intake kind.");
            }
            return {
                reference,
                title: text(source.title, "intake title", 300).trim(),
                body: text(source.body, "intake body", HANDOFF_BODY_LIMIT_BYTES, true),
                kind,
                observedAt: new Date().toISOString(),
            };
        },
    };
}

function defaultGh(workspaceRoot: string): (args: string[]) => Promise<string> {
    return (args) => new Promise((resolveRequest, reject) => {
        let commandArgs = [...args];
        let input: string | undefined;
        const field = commandArgs.indexOf("-f");
        if (field >= 0 && commandArgs[field + 1]?.startsWith("body=")) {
            // Keep the injectable argument contract, but avoid Windows' command-line size limit
            // and exposing the handoff body in the default child's process arguments.
            input = JSON.stringify({ body: commandArgs[field + 1]!.slice("body=".length) });
            commandArgs.splice(field, 2, "--input", "-");
        }
        const child = execFile("gh", commandArgs, {
            cwd: workspaceRoot,
            shell: false,
            timeout: 30_000,
            maxBuffer: MAX_OUTPUT,
            encoding: "utf8",
            windowsHide: true,
            env: { ...process.env, GH_PROMPT_DISABLED: "1" },
        }, (error, stdout) => {
            if (error) {
                // gh errors can contain args, stderr, or credentials. Do not propagate them.
                reject(new ProjectStoreError("adapter_github_unavailable",
                    "GitHub request failed or timed out. Check gh authentication, repository access, and availability.", 503));
            } else resolveRequest(stdout);
        });
        child.stdin?.on("error", () => {
            reject(new ProjectStoreError("adapter_github_unavailable", "Cannot send the GitHub request body.", 503));
        });
        child.stdin?.end(input);
    });
}

function repository(value: string): string {
    // An unconfigured GitHub adapter remains selectable without disabling Local.
    if (value === "") return value;
    if (typeof value !== "string" || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9_.-]{1,100}$/.test(value) ||
        [".", ".."].includes(value.split("/")[1]!)) {
        fail("adapter_repository_invalid", "Configure GitHub with an owner/repo name, not a URL or path.");
    }
    return value;
}

function positiveInteger(value: unknown, name: string): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
        fail("adapter_data_invalid", `Invalid GitHub ${name}.`);
    }
    return value;
}

function numericReference(value: string): number {
    if (!/^[1-9]\d*$/.test(value)) fail("adapter_reference_invalid", "Use a positive GitHub reference number.");
    return positiveInteger(Number(value), "reference number");
}

function githubResource(value: string, repo: string): string | null {
    if (/[\r\n\0]/.test(value)) return null;
    const parts = /^https:\/\/github\.com\/([^/]+\/[^/]+)(\/.*)$/.exec(value);
    return parts && parts[1]!.toLowerCase() === repo.toLowerCase() ? parts[2]! : null;
}

function githubReference(value: unknown, repo: string, kind: "pull" | "issues" | "actions/runs"): number {
    const reference = line(value, "GitHub reference", 512);
    const resource = githubResource(reference, repo);
    const prefix = `/${kind}/`;
    if (resource?.startsWith(prefix)) return numericReference(resource.slice(prefix.length));
    if (kind === "actions/runs" && reference.startsWith("run:")) return numericReference(reference.slice(4));
    if (kind !== "actions/runs" && /^[1-9]\d*$/.test(reference)) return numericReference(reference);
    return fail("adapter_reference_invalid", "Use an exact reference for the configured GitHub repository.");
}

function exactUrl(value: unknown, expected: string): string {
    const target = /^https:\/\/github\.com\/([^/]+\/[^/]+)(\/.*)$/.exec(expected);
    if (typeof value !== "string" || !target || githubResource(value, target[1]!) !== target[2]) {
        fail("adapter_data_invalid", "GitHub returned an unexpected target URL.");
    }
    return value;
}

function sha(value: unknown): string {
    if (typeof value !== "string" || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(value)) {
        fail("adapter_data_invalid", "GitHub returned an invalid commit SHA.");
    }
    return value;
}

function account(value: unknown): { login: string; type: string } | null {
    if (value === null) return null;
    const user = object(value);
    const login = text(user.login, "account name", 100);
    const type = text(user.type, "account type", 100);
    return { login, type };
}

function conclusion(value: unknown): string | null {
    if (value === null) return null;
    if (typeof value !== "string" || !conclusionValues.has(value)) {
        fail("adapter_data_invalid", "GitHub returned an unknown conclusion.");
    }
    return value;
}

function jobStatus(value: unknown): string {
    if (typeof value !== "string" ||
        !["queued", "in_progress", "completed", "waiting", "requested", "pending"].includes(value)) {
        fail("adapter_data_invalid", "GitHub returned an unknown check or job status.");
    }
    return value;
}

function githubAdapter(repo: string, runGh: (args: string[]) => Promise<string>): ProcessAdapter {
    const requireRepo = () => {
        repository(repo);
        if (!repo) fail("adapter_repository_missing", "Configure owner/repo before using GitHub; Local was not substituted.");
    };
    const request = async (endpoint: string, body?: string): Promise<{ value: unknown; bytes: number }> => {
        requireRepo();
        const args = ["api", "--hostname", "github.com", "--method", body === undefined ? "GET" : "POST", endpoint];
        if (body !== undefined) args.push("-f", `body=${body}`);
        let output: string;
        try { output = await runGh(args); }
        catch {
            return fail("adapter_github_unavailable",
                "GitHub request failed or timed out. Check gh authentication, repository access, and availability; no fallback was performed.", 503);
        }
        if (typeof output !== "string" || Buffer.byteLength(output, "utf8") > MAX_OUTPUT) {
            fail("adapter_data_invalid", "GitHub returned an oversized or invalid response.");
        }
        return { value: parseJson(output), bytes: Buffer.byteLength(output, "utf8") };
    };
    const pages = async (endpoint: string, collection?: string): Promise<unknown[]> => {
        const all: unknown[] = [];
        let bytes = 0;
        let expectedTotal: number | undefined;
        for (let page = 1; page <= MAX_PAGES; page++) {
            const response = await request(`${endpoint}${endpoint.includes("?") ? "&" : "?"}per_page=${PAGE_SIZE}&page=${page}`);
            bytes += response.bytes;
            if (bytes > MAX_PAGINATED_OUTPUT) fail("adapter_data_invalid", "GitHub pagination exceeded the response budget.");
            const envelope = collection ? object(response.value) : undefined;
            const values = envelope ? envelope[collection!] : response.value;
            if (!Array.isArray(values) || values.length > PAGE_SIZE) {
                fail("adapter_data_invalid", "GitHub returned an invalid page.");
            }
            if (envelope) {
                const total = envelope.total_count;
                if (typeof total !== "number" || !Number.isSafeInteger(total) || total < 0 || total > MAX_PAGES * PAGE_SIZE ||
                    (expectedTotal !== undefined && total !== expectedTotal)) {
                    fail("adapter_data_invalid", "GitHub returned incomplete, changing, or oversized pagination data.");
                }
                expectedTotal = total;
            }
            all.push(...values);
            if (expectedTotal !== undefined) {
                if (all.length > expectedTotal || (values.length < PAGE_SIZE && all.length !== expectedTotal)) {
                    fail("adapter_data_invalid", "GitHub pagination was incomplete.");
                }
                if (all.length === expectedTotal) return all;
            } else if (values.length < PAGE_SIZE) return all;
        }
        return fail("adapter_data_invalid", "GitHub pagination limit exceeded; no partial result was used.");
    };
    const pull = async (number: number) => {
        const data = object((await request(`repos/${repo}/pulls/${number}`)).value);
        if (data.number !== number || !["open", "closed"].includes(String(data.state)) ||
            typeof data.draft !== "boolean" || typeof data.merged !== "boolean" ||
            (data.mergeable !== null && typeof data.mergeable !== "boolean")) {
            fail("adapter_data_invalid", "GitHub returned an invalid pull request.");
        }
        return {
            number,
            url: exactUrl(data.html_url, `https://github.com/${repo}/pull/${number}`),
            state: data.state as "open" | "closed",
            draft: data.draft,
            merged: data.merged,
            mergeable: data.mergeable as boolean | null,
            headSha: sha(object(data.head).sha),
            author: account(data.user),
        };
    };
    const comment = (value: unknown, number: number) => {
        const data = object(value);
        const id = positiveInteger(data.id, "comment ID");
        return {
            id,
            url: exactUrl(data.html_url, `https://github.com/${repo}/pull/${number}#issuecomment-${id}`),
            body: text(data.body, "comment body", MAX_SOURCE, true),
        };
    };
    return {
        id: "github",
        label: "GitHub",
        async handoff(value) {
            requireRepo();
            const input = handoffInput(value);
            const number = githubReference(input.reference, repo, "pull");
            const marker = `<!-- tandem-handoff:${input.idempotencyKey} -->`;
            const body = text(`${marker}\n\n${markdown(input)}`, "GitHub handoff comment", HANDOFF_BODY_LIMIT_BYTES);
            const target = await pull(number);
            const comments = (await pages(`repos/${repo}/issues/${number}/comments`)).map((value) => comment(value, number));
            const matching = comments.filter((current) => current.body.includes(marker));
            if (matching.some((current) => current.body !== body)) {
                fail("adapter_idempotency_conflict", "This GitHub handoff key has different content; no comment was changed or posted.", 409);
            }
            const existing = matching[0];
            const posted = existing ?? comment((await request(`repos/${repo}/issues/${number}/comments`, body)).value, number);
            if (posted.body !== body) fail("adapter_data_invalid", "GitHub did not return the expected handoff comment. Retry to recover its receipt.");
            return {
                reference: target.url,
                summary: existing ? "Existing GitHub PR handoff recovered; no duplicate comment posted." : "Handoff comment attached to the existing GitHub PR.",
                details: { pullRequest: target.url, commentReference: posted.url, commentId: posted.id, idempotencyKey: input.idempotencyKey, reused: Boolean(existing) },
            };
        },
        async status(reference) {
            requireRepo();
            const number = githubReference(reference, repo, "pull");
            const target = await pull(number);
            const [reviewValues, checkValues, statusValues] = await Promise.all([
                pages(`repos/${repo}/pulls/${number}/reviews`),
                pages(`repos/${repo}/commits/${target.headSha}/check-runs?filter=latest`, "check_runs"),
                pages(`repos/${repo}/commits/${target.headSha}/statuses`),
            ]);
            const reviews = reviewValues.map((value) => {
                const review = object(value);
                const state = text(review.state, "review state", 40);
                if (!["APPROVED", "CHANGES_REQUESTED", "COMMENTED", "DISMISSED", "PENDING"].includes(state)) {
                    fail("adapter_data_invalid", "GitHub returned an unknown review state.");
                }
                return {
                    id: positiveInteger(review.id, "review ID"),
                    user: account(review.user),
                    state,
                    commitSha: review.commit_id === null && state === "PENDING" ? null : sha(review.commit_id),
                };
            }).sort((a, b) => a.id - b.id);
            const decisive = new Map<string, typeof reviews[number]>();
            for (const review of reviews) {
                if (review.user && ["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(review.state)) {
                    decisive.set(review.user.login.toLowerCase(), review);
                }
            }
            const independent = [...decisive.values()].filter((review) =>
                review.user?.type === "User" && !review.user.login.toLowerCase().endsWith("[bot]") &&
                target.author !== null && review.user.login.toLowerCase() !== target.author.login.toLowerCase());
            const approvals = independent.filter((review) => review.state === "APPROVED" && review.commitSha === target.headSha)
                .map((review) => review.user!.login);
            const changesRequested = independent.filter((review) => review.state === "CHANGES_REQUESTED")
                .map((review) => review.user!.login);
            type Check = { id: number; name: string; source: "check-run" | "commit-status"; state: "passing" | "failing" | "pending"; conclusion: string | null };
            const checks: Check[] = checkValues.map((value) => {
                const check = object(value);
                if (sha(check.head_sha) !== target.headSha) fail("adapter_data_invalid", "GitHub returned checks for a different commit.");
                const status = jobStatus(check.status);
                const outcome = conclusion(check.conclusion);
                return {
                    id: positiveInteger(check.id, "check ID"),
                    name: text(check.name, "check name", 1000),
                    source: "check-run",
                    state: status !== "completed" || outcome === null ? "pending" :
                        ["success", "neutral", "skipped"].includes(outcome) ? "passing" : "failing",
                    conclusion: outcome,
                };
            });
            const latestStatuses = new Map<string, Check>();
            for (const value of statusValues) {
                const data = object(value);
                if (!["success", "failure", "error", "pending"].includes(String(data.state))) {
                    fail("adapter_data_invalid", "GitHub returned an unknown commit status.");
                }
                const check: Check = {
                    id: positiveInteger(data.id, "status ID"),
                    name: text(data.context, "status context", 1000),
                    source: "commit-status",
                    state: data.state === "success" ? "passing" : data.state === "pending" ? "pending" : "failing",
                    conclusion: data.state as string,
                };
                if ((latestStatuses.get(check.name)?.id ?? 0) < check.id) latestStatuses.set(check.name, check);
            }
            checks.push(...latestStatuses.values());
            const failing = checks.filter((check) => check.state === "failing");
            const pending = checks.filter((check) => check.state === "pending");
            const baseDetails = {
                pullRequest: target,
                approvals: [],
                changesRequested: [],
                checks: [],
                blocking: { failing: [], pending: [] },
                counts: {
                    reviewsObserved: reviews.length,
                    approvals: approvals.length,
                    changesRequested: changesRequested.length,
                    checks: {
                        total: checks.length,
                        passing: checks.length - failing.length - pending.length,
                        failing: failing.length,
                        pending: pending.length,
                    },
                },
                omitted: {
                    approvals: approvals.length,
                    changesRequested: changesRequested.length,
                    checks: checks.length,
                    failingChecks: failing.length,
                    pendingChecks: pending.length,
                },
                truncated: false,
                reviewScope: "Latest decisive reviews by non-author User accounts; approvals must match the current head SHA.",
                detailScope: "Counts cover all fetched pages. Arrays are byte-bounded samples; omitted counts identify undisplayed entries.",
                requiredCheckPolicy: "not evaluated",
                mergeAuthorization: "not evaluated",
            };
            // Reserve the exact serialized metadata size, including worst-case omission counts.
            // Each of the five arrays shares the remainder, accounting for JSON escaping and UTF-8.
            const sampleBudget = Math.floor((MAX_STATUS_DETAILS - Buffer.byteLength(JSON.stringify(baseDetails), "utf8")) / 5);
            if (sampleBudget < 0) fail("adapter_data_invalid", "GitHub status metadata exceeded the receipt budget.");
            const approvalSample = sampleRows(approvals, sampleBudget);
            const changeSample = sampleRows(changesRequested, sampleBudget);
            const checkSample = sampleRows(checks, sampleBudget);
            const failingSample = sampleRows(failing, sampleBudget);
            const pendingSample = sampleRows(pending, sampleBudget);
            const omitted = {
                approvals: approvals.length - approvalSample.length,
                changesRequested: changesRequested.length - changeSample.length,
                checks: checks.length - checkSample.length,
                failingChecks: failing.length - failingSample.length,
                pendingChecks: pending.length - pendingSample.length,
            };
            const truncated = Object.values(omitted).some((count) => count > 0);
            return {
                reference: target.url,
                summary: `GitHub PR #${number}: ${target.state}${target.merged ? ", merged" : ""}${target.draft ? ", draft" : ""}; ` +
                    `mergeable: ${target.mergeable === null ? "unknown" : target.mergeable}; ` +
                    `${approvals.length} independent human approval(s) on the current head; ${changesRequested.length} change request(s); ` +
                    `${failing.length} failing and ${pending.length} pending checks (conservative blockers). ` +
                    "Required-check policy not evaluated; not merge authorization." +
                    (truncated ? " Details are sampled; counts cover all fetched pages." : ""),
                details: {
                    ...baseDetails,
                    approvals: approvalSample,
                    changesRequested: changeSample,
                    checks: checkSample,
                    blocking: { failing: failingSample, pending: pendingSample },
                    omitted,
                    truncated,
                },
            };
        },
        async intake(value) {
            requireRepo();
            const input = object(value);
            if (input.content !== undefined) fail("adapter_data_invalid", "GitHub intake reads GitHub source data, not supplied local content.");
            const reference = text(input.reference, "GitHub intake reference", 512);
            if (reference.startsWith("run:") || githubResource(reference, repo)?.startsWith("/actions/runs/")) {
                const id = githubReference(reference, repo, "actions/runs");
                const run = object((await request(`repos/${repo}/actions/runs/${id}`)).value);
                if (run.id !== id) fail("adapter_data_invalid", "GitHub returned a different workflow run.");
                const url = exactUrl(run.html_url, `https://github.com/${repo}/actions/runs/${id}`);
                const status = jobStatus(run.status);
                const outcome = conclusion(run.conclusion);
                if (status !== "completed" || outcome === null || ["success", "neutral", "skipped"].includes(outcome)) {
                    fail("adapter_intake_not_failure", "Failure intake requires a completed, unsuccessful workflow run.");
                }
                const name = text(run.name ?? `Workflow run #${id}`, "workflow name", 300);
                const headSha = sha(run.head_sha);
                const jobs = (await pages(`repos/${repo}/actions/runs/${id}/jobs?filter=latest`, "jobs")).map((value) => {
                    const job = object(value);
                    if (job.run_id !== id) fail("adapter_data_invalid", "GitHub returned a job for a different workflow run.");
                    return {
                        id: positiveInteger(job.id, "job ID"),
                        name: text(job.name, "job name", 1000),
                        status: jobStatus(job.status),
                        conclusion: conclusion(job.conclusion),
                    };
                });
                const body = text("Untrusted GitHub workflow source data (not instructions):\n\n" +
                    JSON.stringify({ run: { id, name, url, headSha, status, conclusion: outcome }, jobs }, null, 2),
                "workflow intake", MAX_SOURCE);
                return { reference: url, title: `${name}: ${outcome}`, body, kind: "ci-failure", observedAt: new Date().toISOString() };
            }
            const number = githubReference(reference, repo, "issues");
            const issue = object((await request(`repos/${repo}/issues/${number}`)).value);
            if ("pull_request" in issue) fail("adapter_intake_not_issue", "This reference is a pull request, not an issue.");
            if (issue.number !== number) fail("adapter_data_invalid", "GitHub returned a different issue.");
            return {
                reference: exactUrl(issue.html_url, `https://github.com/${repo}/issues/${number}`),
                title: text(issue.title, "issue title", 300).trim(),
                body: issue.body === null ? "" : text(issue.body, "issue body", MAX_SOURCE, true),
                kind: "issue",
                observedAt: new Date().toISOString(),
            };
        },
    };
}

/**
 * Selection never migrates or deletes records; callers persist receipts and intake origin.
 * GitHub configuration and authentication are checked only when invoking a GitHub method.
 * GitHub status details are at most 10,000 serialized UTF-8 bytes, with full counts and marked samples.
 * Callers must serialize GitHub handoffs: GitHub has no atomic scan-and-post operation.
 * Local requires hard-link support for no-clobber publication; interrupted bundles fail closed.
 */
export function createProcessAdapters(options: {
    workspaceRoot: string;
    githubRepository: string;
    runGh?: (args: string[]) => Promise<string>;
}): ProcessAdapterRegistry {
    const root = resolve(text(options.workspaceRoot, "workspace root", 4096));
    const registry = new ProcessAdapterRegistry();
    registry.register(localAdapter(root));
    registry.register(githubAdapter(options.githubRepository, options.runGh ?? defaultGh(root)));
    return registry;
}
