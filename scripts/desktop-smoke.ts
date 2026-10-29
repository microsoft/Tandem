import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { CopilotClient } from "@github/copilot-sdk";
import { desktopRuntimeEnvironment } from "../src/desktop/environment.js";
import { validateDesktopUrl, type DesktopEvent } from "../src/desktop/protocol.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const metadata = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { version: string };
const workspace = await mkdtemp(join(tmpdir(), "tandem-desktop-smoke-"));
const host = join(root, "dist", "desktop", "runtime", "host.mjs");
const sessions = new Set<string>();
interface Snapshot {
    generation: string;
    goal: string;
    factoryRuns?: unknown[];
    provider: { canSubmitAnswers: boolean };
}

async function cycle(): Promise<{ sessionId: string; snapshot: Snapshot }> {
    const child = spawn(process.execPath, [host, "--workspace", workspace], { cwd: root, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const reader = createInterface({ input: child.stdout });
    let stderr = "";
    let permissionMode: string | undefined;
    child.stderr.on("data", (value: Buffer) => { stderr = (stderr + value.toString()).slice(-8000); });
    const exited = new Promise<number | null>((resolveExit, reject) => {
        child.once("exit", resolveExit);
        child.once("error", reject);
    });
    const timer = setTimeout(() => {
        if (child.pid && child.exitCode === null) {
            if (process.platform === "win32") spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
            else child.kill("SIGKILL");
        }
    }, 60_000);
    try {
        const ready = await new Promise<Extract<DesktopEvent, { type: "ready" }>>((resolveReady, reject) => {
            child.once("exit", (code) => reject(new Error(`Desktop host exited before readiness (${code}). ${stderr}`)));
            child.once("error", reject);
            reader.on("line", (line) => {
                try {
                    const event = JSON.parse(line) as DesktopEvent;
                    if (event.type === "error") {
                        stderr += `\n${event.message}`;
                        reject(new Error(event.message));
                    }
                    if (event.type === "ready") resolveReady(event);
                    if (event.type === "permission-mode") permissionMode = event.mode;
                    if (event.type === "permission") {
                        // The empty smoke workspace starts no agents; approve startup requests individually.
                        child.stdin.write(`${JSON.stringify({ type: "permission-response", id: event.id, approved: true })}\n`);
                    }
                    if (event.type === "question") reject(new Error("Idle startup must not ask an agent question."));
                } catch (error) { reject(error); }
            });
        });
        sessions.add(ready.sessionId);
        const url = validateDesktopUrl(ready.url);
        const html = await fetch(url).then((response) => response.text());
        assert.match(html, /Tandem/);
        const response = await fetch(new URL("api/state", url));
        assert.equal(response.status, 200);
        const snapshot = await response.json() as Snapshot;
        assert.equal(snapshot.goal, "");
        assert.equal(snapshot.provider.canSubmitAnswers, true);
        assert.equal(snapshot.factoryRuns?.length || 0, 0, "startup must not launch AI workers");
        const crossOrigin = await fetch(new URL("api/effort/start", url), {
            method: "POST", headers: { Origin: "https://untrusted.example", "Content-Type": "application/json" }, body: "{}",
        });
        assert.equal(crossOrigin.status, 403);
        return { sessionId: ready.sessionId, snapshot };
    } finally {
        if (child.exitCode === null) child.stdin.write('{"type":"shutdown"}\n');
        const exitCode = await exited;
        clearTimeout(timer);
        reader.close();
        assert.equal(exitCode, 0, `Desktop shutdown failed. ${stderr}`);
        assert.equal(permissionMode, "ask", "startup and resumed backends must not inherit allow-all");
    }
}

async function guiCycle(reportName: string, navigations: number, overrideHost?: string): Promise<void> {
    const report = join(workspace, reportName);
    const exitCode = await new Promise<number | null>((resolveGui, reject) => {
        const useDotnet = process.argv.includes("--dotnet");
        const program = useDotnet ? "dotnet" : join(root, "dist", "desktop", "Tandem.Desktop.exe");
        const args = ["--workspace", workspace, "--smoke-test", report];
        if (useDotnet) args.unshift("run", "--project", join(root, "src", "Tandem.Desktop", "Tandem.Desktop.csproj"), "--");
        const child = spawn(program, args, {
            cwd: root,
            stdio: "inherit",
            env: overrideHost ? { ...process.env, TANDEM_DESKTOP_HOST: overrideHost } : process.env,
        });
        child.once("error", reject);
        child.once("exit", resolveGui);
    });
    const result = await readFile(report, "utf8");
    console.info(result);
    assert.equal(exitCode, 0, `Windows Forms smoke test failed. ${result}`);
    const page = JSON.parse(result) as {
        success: boolean; version: string; rendered: boolean; topLevelNavigations: number; url: string; toolApprovalMode: string;
    };
    assert.equal(page.success, true);
    assert.equal(page.version, metadata.version, "the desktop version must come from package.json");
    assert.equal(page.toolApprovalMode, "ask");
    assert.equal(page.rendered, true);
    assert.equal(page.topLevelNavigations, navigations, "navigate only when the selected canvas changes");
    const diagnostics = await readFile(join(workspace, ".tandem", "desktop", "desktop.log"), "utf8");
    assert.doesNotMatch(diagnostics, /shutdown timed out|response could not be delivered/);
    await assert.rejects(fetch(validateDesktopUrl(page.url), { signal: AbortSignal.timeout(2000) }));
}

try {
    const first = await cycle();
    const second = await cycle();
    assert.equal(second.sessionId, first.sessionId, "desktop must resume its original SDK session");
    assert.equal(second.snapshot.generation, first.snapshot.generation, "restart must not reset the effort");
    if (process.argv.includes("--gui") || process.argv.includes("--dotnet")) {
        // Supply isolated startup consent without teaching the native unattended UI to approve requests.
        const startup = join(workspace, "gui-startup.mjs");
        await writeFile(startup, `
            import { spawn } from "node:child_process";
            import { createInterface } from "node:readline";
            const child = spawn(process.execPath, [${JSON.stringify(host)}, ...process.argv.slice(2)], {
                cwd: process.cwd(), stdio: ["pipe", "pipe", "inherit"], windowsHide: true
            });
            process.stdin.pipe(child.stdin);
            createInterface({ input: child.stdout }).on("line", line => {
                const event = JSON.parse(line);
                if (event.type !== "permission") { process.stdout.write(line + "\\n"); return; }
                const request = JSON.parse(event.details);
                const startupOnly = event.canAllowAllForSession === true &&
                    ["extension-management", "extension-permission-access"].includes(request.kind) &&
                    typeof request.extensionName === "string" && /(?:^|:)tandem$/i.test(request.extensionName);
                if (!startupOnly) throw new Error("Unexpected non-startup permission during GUI smoke.");
                child.stdin.write(JSON.stringify({ type: "permission-response", id: event.id, approved: true }) + "\\n");
            });
            child.on("error", error => { console.error(error); process.exit(1); });
            child.on("exit", code => process.exit(code ?? 1));
        `);
        await guiCycle("gui-smoke.json", 1, startup);
        const fixture = join(workspace, "canvas-transition.mjs");
        await writeFile(fixture, `
            import { createServer } from "node:http";
            import { createInterface } from "node:readline";
            const send = (url) => console.log(JSON.stringify({
                type: "ready", url, sessionId: "canvas-transition", workspace: process.cwd()
            }));
            console.log(JSON.stringify({ type: "permission-mode", mode: "ask" }));
            const page = '<title>Tandem</title><header><h1>Tandem</h1></header>' +
                '<section id="start-panel"><form id="start-form"><input></form></section>';
            const next = createServer((_, response) => {
                response.writeHead(200, { "Content-Type": "text/html" });
                response.end(page);
            });
            await new Promise(resolve => next.listen(0, "127.0.0.1", resolve));
            let changed = false;
            const first = createServer((_, response) => {
                response.writeHead(200, { "Content-Type": "text/html" });
                response.end("<title>Loading</title>Changing canvases...");
                if (!changed) {
                    changed = true;
                    setTimeout(() => send("http://127.0.0.1:" + next.address().port + "/"), 500);
                }
            });
            await new Promise(resolve => first.listen(0, "127.0.0.1", resolve));
            send("http://127.0.0.1:" + first.address().port + "/");
            send("http://127.0.0.1:" + first.address().port + "/");
            const input = createInterface({ input: process.stdin });
            input.on("line", line => {
                if (JSON.parse(line).type === "shutdown") {
                    first.close(); next.close();
                    first.closeAllConnections(); next.closeAllConnections();
                    input.close(); process.stdin.destroy();
                }
            });
        `);
        await guiCycle("gui-transition.json", 2, fixture);
    }
    console.info("Standalone runtime startup, writable UI, session recovery, cross-origin protection, and shutdown passed. No AI workers were started.");
} catch (error) {
    try {
        console.error(await readFile(join(workspace, ".tandem", "desktop", "desktop.log"), "utf8"));
    } catch (diagnosticError) {
        console.error("Native diagnostics unavailable:", diagnosticError);
    }
    throw error;
} finally {
    const client = new CopilotClient({ env: desktopRuntimeEnvironment(), logLevel: "error" });
    try {
        if (sessions.size) {
            await client.start();
            for (const sessionId of sessions) await client.deleteSession(sessionId);
        }
    } finally {
        const errors = await client.stop();
        await rm(workspace, { recursive: true, force: true });
        if (errors.length) throw new AggregateError(errors, "Smoke-test runtime cleanup failed.");
    }
}
