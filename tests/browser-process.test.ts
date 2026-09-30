import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createProcessTree } from "../src/browser/process-tree.js";

function exists(pid: number): boolean {
    try { process.kill(pid, 0); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return false; throw error; }
}

test("standalone process containment terminates only the owned backend tree", { timeout: 15000 }, async () => {
    const tree = await createProcessTree();
    const child = spawn(process.execPath, ["-e", `
        const {spawn} = require("node:child_process");
        process.stdin.once("data", () => {
            const worker = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {stdio:"ignore"});
            console.log(JSON.stringify({pid:worker.pid}));
        });
        setInterval(() => {}, 1000);
    `], { stdio: ["pipe", "pipe", "pipe"], detached: process.platform !== "win32", windowsHide: true });
    const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
    try {
        assert.ok(child.pid);
        tree.assign(child.pid);
        const reader = createInterface({ input: child.stdout });
        const worker = new Promise<number>((resolve, reject) => {
            reader.once("line", (line) => { try { resolve(JSON.parse(line).pid); } catch (error) { reject(error); } });
            child.once("error", reject);
        });
        child.stdin.write("start\n");
        const workerPid = await worker;
        assert.ok(Number.isInteger(workerPid) && exists(workerPid));
        tree.close();
        await closed;
        const deadline = Date.now() + 3000;
        while (exists(workerPid) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
        assert.equal(exists(workerPid), false, "background workers must not outlive the owned backend");
        assert.ok(exists(process.pid), "the host/test process must not belong to the backend job");
        reader.close();
    } finally {
        tree.close();
        if (child.pid && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        await closed;
    }
});

test("Windows closes the backend job even when the Node supervisor is killed", { skip: process.platform !== "win32", timeout: 15000 }, async () => {
    const helper = new URL("../src/browser/process-tree.ts", import.meta.url).href;
    const supervisor = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
        import {spawn} from "node:child_process";
        import {createProcessTree} from ${JSON.stringify(helper)};
        const tree = await createProcessTree();
        const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {stdio:"ignore"});
        try { tree.assign(child.pid); } catch (error) { child.kill("SIGKILL"); throw error; }
        console.log(JSON.stringify({pid:child.pid}));
        setInterval(() => {}, 1000);
    `], { cwd: fileURLToPath(new URL("..", import.meta.url)), stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const closed = new Promise<void>((resolve) => supervisor.once("close", () => resolve()));
    let diagnostic = "";
    supervisor.stderr.on("data", (chunk: Buffer) => { diagnostic += chunk.toString(); });
    const reader = createInterface({ input: supervisor.stdout });
    try {
        const workerPid = await new Promise<number>((resolve, reject) => {
            reader.once("line", (line) => { try { resolve(JSON.parse(line).pid); } catch (error) { reject(error); } });
            supervisor.once("error", reject);
            supervisor.once("exit", () => reject(new Error(`Supervisor exited before creating the owned worker. ${diagnostic}`)));
        });
        assert.ok(exists(workerPid));
        supervisor.kill("SIGKILL");
        await closed;
        const deadline = Date.now() + 3000;
        while (exists(workerPid) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
        assert.equal(exists(workerPid), false);
    } finally {
        if (supervisor.pid && supervisor.exitCode === null && supervisor.signalCode === null) supervisor.kill("SIGKILL");
        await closed;
        reader.close();
    }
});
