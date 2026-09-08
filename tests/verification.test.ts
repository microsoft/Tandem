import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fingerprintWorkspace } from "../src/execution.js";
import type { VerificationCheck } from "../src/process-state.js";
import { evidenceSummary, normalizeCommandEvidence, runVerificationCheck } from "../src/verification.js";

const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

async function fixture(t: TestContext) {
    const workspaceRoot = join(process.cwd(), ".tandem", `verification-tests-${randomUUID()}`);
    await mkdir(join(workspaceRoot, ".tandem"), { recursive: true });
    t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
    const controller = new AbortController();
    return {
        workspaceRoot, controller,
        context: { workspaceRoot, requestId: "request", runId: "run", inputRevision: "approved-input",
            signal: controller.signal },
    };
}

function check(script: string, overrides: Partial<VerificationCheck> = {}): VerificationCheck {
    return { id: "unit", program: "node", args: ["-e", script], stage: "test",
        afterWorkItems: ["implement"], timeoutSeconds: 10, ...overrides };
}

async function waitFor<T>(probe: () => Promise<T | undefined>): Promise<T> {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
        const result = await probe();
        if (result !== undefined) return result;
        await delay(20);
    }
    throw new Error("Test subprocess did not become ready.");
}

function alive(pid: number): boolean {
    try { process.kill(pid, 0); return true; }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
        throw error;
    }
}

async function cleanupPid(pid: number) {
    if (!alive(pid)) return;
    if (process.platform !== "win32") { process.kill(pid, "SIGKILL"); return; }
    await new Promise<void>((done, reject) => {
        const child = spawn(join(process.env.SystemRoot!, "System32", "taskkill.exe"),
            ["/PID", String(pid), "/T", "/F"], { shell: false, stdio: "ignore" });
        child.once("error", reject);
        child.once("close", () => done());
    });
}

async function processTree(t: TestContext, workspaceRoot: string) {
    const path = join(workspaceRoot, ".tandem", "pids.json");
    const childScript = `require('node:fs').writeFileSync(${JSON.stringify(path)}, JSON.stringify({parent:process.ppid, child:process.pid})); setInterval(()=>{},1000);`;
    const script = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(childScript)}], {stdio:'inherit'}); setInterval(()=>{},1000);`;
    let recorded: { parent: number; child: number } | undefined;
    const pids = async () => waitFor(async () => {
        try {
            recorded = JSON.parse(await readFile(path, "utf8")) as { parent: number; child: number };
            return recorded;
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return undefined;
            throw error;
        }
    });
    t.after(async () => {
        if (recorded) {
            await cleanupPid(recorded.parent);
            await cleanupPid(recorded.child);
            return;
        }
        try {
            const remaining = JSON.parse(await readFile(path, "utf8")) as { parent: number; child: number };
            await cleanupPid(remaining.parent);
            await cleanupPid(remaining.child);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
    });
    return { script, pids };
}

test("approved node argv is literal, source-bound, and returns observed stdout/stderr with durable identity", async (t) => {
    const { context } = await fixture(t);
    const argv = ["a b", "x\"y", "$(echo unsafe)", "hello & echo unsafe", "line\nbreak"];
    const script = "const fs=require('node:fs'); fs.writeSync(1,JSON.stringify(process.argv.slice(1))); fs.writeSync(2,'\\nstderr observed');";
    const evidence = await runVerificationCheck(check(script, { args: ["-e", script, ...argv] }), context);
    assert.equal(evidence.status, "passed");
    assert.equal(evidence.exitCode, 0);
    assert.equal(evidence.error, "");
    assert.ok(evidence.output.includes(JSON.stringify(argv)));
    assert.ok(evidence.output.includes("stderr observed"));
    assert.equal(evidence.outputHash, hash(evidence.output));
    assert.equal(evidence.outputTruncated, false);
    assert.equal(evidence.sourceFingerprint, await fingerprintWorkspace(context.workspaceRoot));
    assert.equal(evidence.requestId, context.requestId);
    assert.equal(evidence.runId, context.runId);
    assert.equal(evidence.inputRevision, context.inputRevision);
    assert.ok(Date.parse(evidence.completedAt) >= Date.parse(evidence.startedAt));
    assert.deepEqual(evidence.args, ["-e", script, ...argv]);
    assert.deepEqual(normalizeCommandEvidence([evidence]), [evidence]);
    const summary = evidenceSummary(evidence);
    assert.match(summary, /Tool-observed.*passed; exit 0/);
    assert.ok(summary.includes(evidence.outputHash));
    assert.ok(summary.includes("stderr observed"));
});

test("nonzero exit and launch failure produce failed records rather than throwing or fabricated passes", async (t) => {
    const { context } = await fixture(t);
    const failed = await runVerificationCheck(check("process.stderr.write('actual failure'); process.exitCode=7"), context);
    assert.equal(failed.status, "failed");
    assert.equal(failed.exitCode, 7);
    assert.equal(failed.output, "actual failure");
    assert.match(failed.error, /code 7/);
    const missing = await runVerificationCheck(check("", { program: "tandem-missing-command-979233.exe", args: [] }), context);
    assert.equal(missing.status, "failed");
    assert.equal(missing.exitCode, null);
    assert.match(missing.error, /ENOENT|launch/i);
    assert.equal(missing.outputHash, hash(""));
    assert.deepEqual(normalizeCommandEvidence([failed, missing]), [failed, missing]);
});

test("a successful command that changes sources is failed, but durable output directories are excluded", async (t) => {
    const { context, workspaceRoot } = await fixture(t);
    await writeFile(join(workspaceRoot, "source.txt"), "before");
    const before = await fingerprintWorkspace(workspaceRoot);
    const changed = await runVerificationCheck(check("require('node:fs').writeFileSync('source.txt','after')"), context);
    assert.equal(changed.exitCode, 0);
    assert.equal(changed.status, "failed");
    assert.equal(changed.sourceFingerprint, before);
    assert.match(changed.error, /sources changed/i);
    const record = await runVerificationCheck(check(`
        const fs=require('node:fs');
        fs.writeFileSync('.tandem/record.json','observed');
        fs.mkdirSync('tandem-records',{recursive:true});
        fs.writeFileSync('tandem-records/evidence.json','observed');
    `), context);
    assert.equal(record.status, "passed", record.error);
});

test("merged output is bounded in bytes while SHA-256 covers the complete observed stream", async (t) => {
    const { context } = await fixture(t);
    const output = "é".repeat(50000);
    const evidence = await runVerificationCheck(check("require('node:fs').writeSync(1,'é'.repeat(50000))"), context);
    assert.equal(evidence.status, "passed");
    assert.equal(evidence.outputTruncated, true);
    assert.equal(Buffer.byteLength(evidence.output), 64 * 1024);
    assert.equal(evidence.outputHash, hash(output));
    assert.ok(output.startsWith(evidence.output));
    const binary = await runVerificationCheck(check("require('node:fs').writeSync(1,Buffer.alloc(65536,255))"), context);
    assert.equal(binary.status, "passed");
    assert.ok(Buffer.byteLength(binary.output) <= 64 * 1024);
    assert.equal(binary.outputHash, hash(Buffer.alloc(65536, 255)));
    assert.equal(binary.outputTruncated, true);
});

test("batch and PowerShell scripts are rejected with actionable native-executable guidance", async (t) => {
    const { context } = await fixture(t);
    for (const program of ["build.cmd", "build.bat", "build.ps1"]) {
        const evidence = await runVerificationCheck(check("", { program, args: [] }), context);
        assert.equal(evidence.status, "failed");
        assert.equal(evidence.exitCode, null);
        assert.match(evidence.error, /shell:false.*native executable/);
    }
    const commandString = await runVerificationCheck(check("", { program: "node --version", args: [] }), context);
    assert.equal(commandString.status, "failed");
});

test("npm uses installed npm-cli.js instead of interpolating a shell shim", async (t) => {
    const { context } = await fixture(t);
    const evidence = await runVerificationCheck(check("", { program: "npm", args: ["--version"] }), context);
    assert.equal(evidence.status, "passed", evidence.error);
    assert.match(evidence.output.trim(), /^\d+\.\d+\.\d+/);
    assert.equal(evidence.program, "npm");
    assert.deepEqual(evidence.args, ["--version"]);
});

test("an already aborted check cannot start a subprocess", async (t) => {
    const { context, controller, workspaceRoot } = await fixture(t);
    controller.abort();
    const evidence = await runVerificationCheck(check("require('node:fs').writeFileSync('.tandem/started','yes')"), context);
    assert.equal(evidence.status, "failed");
    assert.equal(evidence.exitCode, null);
    assert.match(evidence.error, /cancelled before launch/);
    await assert.rejects(readFile(join(workspaceRoot, ".tandem", "started")), { code: "ENOENT" });
});

test("cancellation terminates and confirms both the approved process and its child before returning", async (t) => {
    const { context, controller, workspaceRoot } = await fixture(t);
    const tree = await processTree(t, workspaceRoot);
    const running = runVerificationCheck(check(tree.script), context);
    const pids = await tree.pids();
    assert.equal(alive(pids.parent), true);
    assert.equal(alive(pids.child), true);
    controller.abort();
    const evidence = await running;
    assert.equal(evidence.status, "failed");
    assert.match(evidence.error, /cancelled/);
    assert.equal(alive(pids.parent), false);
    await waitFor(async () => alive(pids.child) ? undefined : true);
    assert.deepEqual(normalizeCommandEvidence([evidence]), [evidence]);
});

test("timeouts terminate the subprocess tree and persist failed command evidence", async (t) => {
    const { context, workspaceRoot } = await fixture(t);
    const tree = await processTree(t, workspaceRoot);
    const running = runVerificationCheck(check(tree.script, { timeoutSeconds: 1 }), context);
    const pids = await tree.pids();
    const evidence = await running;
    assert.equal(evidence.status, "failed");
    assert.match(evidence.error, /timed out after 1 seconds/);
    assert.equal(alive(pids.parent), false);
    await waitFor(async () => alive(pids.child) ? undefined : true);
    assert.deepEqual(normalizeCommandEvidence([evidence]), [evidence]);
});

test("stored evidence rejects inconsistent passes and oversized output, without treating validation as provenance", async (t) => {
    const { context } = await fixture(t);
    const evidence = await runVerificationCheck(check("process.stdout.write('observed')"), context);
    assert.throws(() => normalizeCommandEvidence([{ ...evidence, exitCode: 3 }]), /inconsistent/);
    assert.throws(() => normalizeCommandEvidence([{ ...evidence, error: "failed check" }]), /inconsistent/);
    assert.throws(() => normalizeCommandEvidence([{ ...evidence, output: "é".repeat(64 * 1024) }]), /inconsistent/);
    assert.deepEqual(normalizeCommandEvidence(undefined), []);
});

test("evidence normalization accepts at most 300 records and rejects malformed shapes without dropping entries", async (t) => {
    const { context } = await fixture(t);
    const evidence = await runVerificationCheck(check("require('node:fs').writeSync(1,'x'.repeat(65536))"), context);
    assert.equal(evidence.status, "passed", evidence.error);
    assert.equal(Buffer.byteLength(evidence.output), 64 * 1024);
    const maximum = Array.from({ length: 300 }, () => evidence);
    assert.deepEqual(normalizeCommandEvidence(maximum), maximum);
    assert.throws(() => normalizeCommandEvidence([...maximum, evidence]), /at most 300/);
    assert.deepEqual(normalizeCommandEvidence([]), []);
    for (const value of [
        null, false, "", {}, [null], [evidence, null], new Array(1),
        [{ ...evidence, ignored: true }],
        [{ ...evidence, args: new Array(1) }],
        [{ ...evidence, args: [123] }],
        [{ ...evidence, exitCode: Number.MAX_SAFE_INTEGER + 1 }],
        [{ ...evidence, output: `${evidence.output}x` }],
        [{ ...evidence, outputTruncated: "false" }],
        [{ ...evidence, outputHash: "not-a-hash" }],
        [{ ...evidence, sourceFingerprint: null }],
    ]) {
        assert.throws(() => normalizeCommandEvidence(value));
    }
    for (const field of Object.keys(evidence)) {
        const missing: Record<string, unknown> = { ...evidence };
        delete missing[field];
        assert.throws(() => normalizeCommandEvidence([missing]), /Invalid stored command evidence/);
    }
});
