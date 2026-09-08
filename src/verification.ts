import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { access, realpath, stat } from "node:fs/promises";
import { delimiter, dirname, extname, isAbsolute, join, resolve, win32 } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { ExecutionSourceChangedError, fingerprintWorkspace } from "./execution.js";
import type { VerificationCheck } from "./process-state.js";

export interface CommandEvidence {
    id: string;
    checkId: string;
    requestId: string;
    runId: string;
    inputRevision: string;
    sourceFingerprint: string;
    program: string;
    args: string[];
    startedAt: string;
    completedAt: string;
    exitCode: number | null;
    status: "passed" | "failed";
    output: string;
    outputTruncated: boolean;
    outputHash: string;
    error: string;
}

const maxOutputBytes = 64 * 1024;
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);
const executableName = (program: string) => win32.basename(program).toLowerCase();

async function npmCommand(workspaceRoot: string): Promise<string> {
    const candidates = [
        process.env.npm_execpath,
        join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
        join(dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
    ].filter((path): path is string => !!path);
    for (const entry of (process.env.PATH || "").split(delimiter).filter(Boolean)) {
        const directory = resolve(workspaceRoot, entry.replace(/^"|"$/g, ""));
        candidates.push(join(directory, "node_modules", "npm", "bin", "npm-cli.js"));
        if (process.platform !== "win32") candidates.push(join(directory, "npm"));
    }
    for (const candidate of candidates) {
        try {
            const path = await realpath(candidate);
            if (executableName(path) === "npm-cli.js" && (await stat(path)).isFile()) return path;
        } catch (error) {
            if (!["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code || "")) throw error;
        }
    }
    throw new Error("Cannot resolve installed npm-cli.js safely. Install npm alongside Node, or approve node with an explicit npm-cli.js path and argv; npm shell shims are not executed.");
}

async function approvedCommand(check: VerificationCheck, workspaceRoot: string) {
    if (typeof check.program !== "string" || !check.program.trim() || /[\0\r\n]/.test(check.program) ||
        !Array.isArray(check.args) || check.args.some((arg) => typeof arg !== "string" || arg.includes("\0"))) {
        throw new Error("Verification requires one executable and an explicit string argv array; command strings are not split.");
    }
    if (!Number.isFinite(check.timeoutSeconds) || check.timeoutSeconds <= 0 || check.timeoutSeconds > 3600) {
        throw new Error("Verification timeout must be greater than zero and at most 3600 seconds.");
    }
    if (check.program === "node") return { program: process.execPath, args: [...check.args] };
    if (check.program === "npm") {
        return { program: process.execPath, args: [await npmCommand(workspaceRoot), ...check.args] };
    }
    if (/\.(?:bat|cmd|ps1)$/i.test(check.program)) {
        throw new Error("Batch, .cmd, and .ps1 verification programs cannot be launched unambiguously with shell:false. Approve a native executable with explicit argv; use program \"npm\" for the installed npm CLI.");
    }
    // Resolve only native executables; do not interpret shell shims or command text.
    if (process.platform === "win32" && !extname(check.program)) {
        const directories = isAbsolute(check.program) || /[\\/]/.test(check.program)
            ? [""] : [workspaceRoot, ...(process.env.PATH || "").split(delimiter).filter(Boolean)];
        for (const directory of directories) {
            const candidate = resolve(workspaceRoot, directory.replace(/^"|"$/g, ""), `${check.program}.exe`);
            try {
                if ((await stat(candidate)).isFile()) return { program: candidate, args: [...check.args] };
            } catch (error) {
                if (!["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code || "")) throw error;
            }
        }
        throw new Error(`Cannot resolve native executable "${check.program}". Specify its .exe path and argv, or use program "npm"; shell command strings and batch shims are not supported.`);
    }
    return { program: check.program, args: [...check.args] };
}

function processExists(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
        throw error;
    }
}

function windowsTaskkill(): string {
    if (!process.env.SystemRoot) throw new Error("Cannot confirm Windows process-tree termination: SystemRoot is not configured.");
    return join(process.env.SystemRoot, "System32", "taskkill.exe");
}

async function terminateTree(child: ChildProcess): Promise<void> {
    if (!child.pid) return;
    if (process.platform !== "win32") {
        try {
            process.kill(-child.pid, "SIGKILL");
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        }
        return;
    }
    const pid = child.pid;
    await new Promise<void>((done, reject) => {
        const killer = spawn(windowsTaskkill(), ["/PID", String(pid), "/T", "/F"], {
            shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
        });
        let detail = "";
        const capture = (chunk: Buffer) => { detail = (detail + chunk.toString("utf8")).slice(-4000); };
        killer.stdout!.on("data", capture);
        killer.stderr!.on("data", capture);
        killer.once("error", reject);
        killer.once("close", (code) => {
            try {
                if (code === 0 || !processExists(pid)) done();
                else reject(new Error(`Could not terminate verification process tree ${pid}: ${detail.trim() || `taskkill exit ${code}`}.`));
            } catch (error) {
                reject(error);
            }
        });
    });
}

async function execute(
    command: { program: string; args: string[] },
    context: { workspaceRoot: string; signal: AbortSignal },
    timeoutSeconds: number,
    capture: (chunk: Buffer) => void,
): Promise<{ exitCode: number | null; error: string }> {
    if (context.signal.aborted) return { exitCode: null, error: "Verification cancelled before launch." };
    if (process.platform === "win32") await access(windowsTaskkill());
    return new Promise((done) => {
        const errors: string[] = [];
        let child: ChildProcess;
        try {
            child = spawn(command.program, command.args, {
                cwd: context.workspaceRoot, shell: false, windowsHide: true,
                detached: process.platform !== "win32",
                stdio: ["ignore", "pipe", "pipe"],
            });
        } catch (error) {
            done({ exitCode: null, error: `Verification launch failed: ${errorMessage(error)}` });
            return;
        }
        child.stdout!.on("data", capture);
        child.stderr!.on("data", capture);
        let termination: Promise<void> | undefined;
        let closed = false;
        const stop = (reason: string) => {
            if (closed || termination) return;
            errors.push(reason);
            termination = terminateTree(child).catch(async (error) => {
                errors.push(errorMessage(error));
                // A transient utility failure must not silently abandon a running tree.
                await terminateTree(child).catch((retryError) => {
                    errors.push(`Process-tree termination remains unconfirmed: ${errorMessage(retryError)}`);
                    child.kill("SIGKILL");
                });
            });
        };
        const cancel = () => stop("Verification cancelled; subprocess-tree termination requested.");
        const timer = setTimeout(() => stop(`Verification timed out after ${timeoutSeconds} seconds; subprocess-tree termination requested.`),
            timeoutSeconds * 1000);
        context.signal.addEventListener("abort", cancel, { once: true });
        if (context.signal.aborted) cancel();
        child.on("error", (error) => errors.push(`Verification launch or process error: ${errorMessage(error)}`));
        child.once("exit", () => {
            // A POSIX process group survives its leader, so clean up background children as well.
            if (process.platform !== "win32" && !termination && child.pid) {
                termination = terminateTree(child).catch((error) => { errors.push(errorMessage(error)); });
            }
        });
        child.once("close", async (code, signal) => {
            closed = true;
            clearTimeout(timer);
            context.signal.removeEventListener("abort", cancel);
            await termination;
            if (signal && !errors.length) errors.push(`Verification terminated by ${signal}.`);
            if (code !== 0 && !errors.length) errors.push(`Verification exited with code ${code === null ? "unknown" : code}.`);
            done({ exitCode: child.pid ? code : null, error: errors.join(" ") });
        });
    });
}

export async function runVerificationCheck(check: VerificationCheck, context: {
    workspaceRoot: string;
    requestId: string;
    runId: string;
    inputRevision: string;
    signal: AbortSignal;
}): Promise<CommandEvidence> {
    const evidence: CommandEvidence = {
        id: randomUUID(), checkId: check.id, requestId: context.requestId, runId: context.runId,
        inputRevision: context.inputRevision, sourceFingerprint: "", program: check.program, args: [...check.args],
        startedAt: new Date().toISOString(), completedAt: "", exitCode: null, status: "failed",
        output: "", outputTruncated: false, outputHash: "", error: "",
    };
    const hash = createHash("sha256");
    const chunks: Buffer[] = [];
    let storedBytes = 0;
    const capture = (chunk: Buffer) => {
        hash.update(chunk);
        const remaining = maxOutputBytes - storedBytes;
        if (chunk.length > remaining) evidence.outputTruncated = true;
        if (remaining > 0) {
            const part = chunk.subarray(0, remaining);
            chunks.push(Buffer.from(part));
            storedBytes += part.length;
        }
    };
    try {
        const command = await approvedCommand(check, context.workspaceRoot);
        if (context.signal.aborted) throw new Error("Verification cancelled before launch.");
        evidence.sourceFingerprint = await fingerprintWorkspace(context.workspaceRoot);
        const result = await execute(command, context, check.timeoutSeconds, capture);
        evidence.exitCode = result.exitCode;
        evidence.error = result.error;
        try {
            if (await fingerprintWorkspace(context.workspaceRoot) !== evidence.sourceFingerprint) {
                throw new ExecutionSourceChangedError();
            }
        } catch (error) {
            evidence.error = [evidence.error, errorMessage(error)].filter(Boolean).join(" ");
        }
        if (context.signal.aborted && !evidence.error.includes("cancelled")) {
            evidence.error = [evidence.error, "Verification cancelled before evidence was finalized."].filter(Boolean).join(" ");
        }
        evidence.status = evidence.exitCode === 0 && !evidence.error ? "passed" : "failed";
    } catch (error) {
        evidence.error = errorMessage(error);
    }
    const decoded = Buffer.concat(chunks).toString("utf8");
    const encoded = Buffer.from(decoded);
    if (encoded.length > maxOutputBytes) evidence.outputTruncated = true;
    evidence.output = new StringDecoder("utf8").write(encoded.subarray(0, maxOutputBytes));
    evidence.outputHash = hash.digest("hex");
    evidence.completedAt = new Date().toISOString();
    return evidence;
}

export function evidenceSummary(evidence: CommandEvidence): string {
    const output = evidence.output.length > 1600 ? `${evidence.output.slice(0, 1600)}…` : evidence.output;
    return [
        `Tool-observed check ${JSON.stringify(evidence.checkId)}: ${evidence.status}; exit ${evidence.exitCode ?? "unavailable"}; SHA-256 ${evidence.outputHash}.`,
        `Command: ${JSON.stringify(evidence.program)} argv=${JSON.stringify(evidence.args)}.`,
        `Observed output${evidence.outputTruncated ? " (capture truncated)" : ""}: ${JSON.stringify(output)}`,
        ...(evidence.error ? [`Error: ${evidence.error}`] : []),
    ].join("\n");
}

export function normalizeCommandEvidence(value: unknown): CommandEvidence[] {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > 300) throw new Error("Stored command evidence must be an array of at most 300 records.");
    const fields: Array<keyof CommandEvidence> = [
        "id", "checkId", "requestId", "runId", "inputRevision", "sourceFingerprint", "program", "args",
        "startedAt", "completedAt", "exitCode", "status", "output", "outputTruncated", "outputHash", "error",
    ];
    return Array.from(value, (candidate: unknown) => {
        if (!candidate || typeof candidate !== "object" || Array.isArray(candidate) ||
            (Object.getPrototypeOf(candidate) !== Object.prototype && Object.getPrototypeOf(candidate) !== null) ||
            Object.keys(candidate).length !== fields.length || fields.some((key) => !Object.hasOwn(candidate, key))) {
            throw new Error("Invalid stored command evidence: expected exactly the CommandEvidence fields.");
        }
        const record = candidate as CommandEvidence;
        for (const key of ["id", "checkId", "requestId", "runId", "inputRevision", "program", "startedAt", "completedAt"] as const) {
            if (typeof record[key] !== "string" || !record[key].trim()) throw new Error(`Invalid command evidence ${key}.`);
        }
        if (!Array.isArray(record.args) || Array.from(record.args).some((arg) => typeof arg !== "string" || arg.includes("\0")) ||
            !["passed", "failed"].includes(record.status) ||
            (record.exitCode !== null && !Number.isSafeInteger(record.exitCode)) ||
            typeof record.error !== "string" || typeof record.output !== "string" ||
            Buffer.byteLength(record.output) > maxOutputBytes || typeof record.outputTruncated !== "boolean" ||
            typeof record.outputHash !== "string" || !/^[a-f0-9]{64}$/.test(record.outputHash) ||
            typeof record.sourceFingerprint !== "string" ||
            (record.sourceFingerprint !== "" && !/^[a-f0-9]{64}$/.test(record.sourceFingerprint)) ||
            !Number.isFinite(Date.parse(record.startedAt)) || !Number.isFinite(Date.parse(record.completedAt)) ||
            Date.parse(record.completedAt) < Date.parse(record.startedAt) ||
            (record.status === "passed" && (record.exitCode !== 0 || !!record.error || !record.sourceFingerprint)) ||
            (record.status === "failed" && !record.error.trim())) {
            throw new Error("Malformed or inconsistent stored command evidence.");
        }
        // Shape validation is not provenance: only the host's durable execution state may supply records.
        return {
            id: record.id, checkId: record.checkId, requestId: record.requestId, runId: record.runId,
            inputRevision: record.inputRevision, sourceFingerprint: record.sourceFingerprint,
            program: record.program, args: [...record.args], startedAt: record.startedAt, completedAt: record.completedAt,
            exitCode: record.exitCode, status: record.status, output: record.output,
            outputTruncated: record.outputTruncated, outputHash: record.outputHash, error: record.error,
        };
    });
}
