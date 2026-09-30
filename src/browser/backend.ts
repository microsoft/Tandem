import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { Readable } from "node:stream";
import { desktopRuntimeEnvironment } from "../desktop/environment.js";
import type { DesktopEvent } from "../desktop/protocol.js";
import { parseBackendEvent, type BackendCommand } from "./contracts.js";
import { errorMessage } from "./local-state.js";
import { createProcessTree } from "./process-tree.js";
import { PRIVATE_CLOSE_DEADLINE_MS, MAIN_CLOSE_DEADLINE_MS } from "../desktop/runtime.js";

export interface Backend {
    send(command: BackendCommand): Promise<void>;
    stop(): Promise<void>;
}

export interface BackendOptions {
    workspace: string;
    runtimeDirectory: string;
    event(event: DesktopEvent): void;
    diagnostic(message: string): void;
    exited(code: number | null, error?: string): void;
}

export type BackendFactory = (options: BackendOptions) => Promise<Backend>;

export function consumeLines(stream: Readable, limit: number, receive: (line: string) => void, oversized: () => void): void {
    const decoder = new StringDecoder("utf8");
    let pending = "";
    let discarding = false;
    const consume = (text: string) => {
        for (const [index, part] of text.split("\n").entries()) {
            if (index > 0) {
                if (!discarding && pending.trim()) receive(pending.replace(/\r$/, ""));
                pending = "";
                discarding = false;
            }
            if (discarding) continue;
            pending += part;
            if (pending.length > limit) {
                pending = "";
                discarding = true;
                oversized();
            }
        }
    };
    stream.on("data", (chunk: Buffer) => consume(decoder.write(chunk)));
    stream.on("end", () => { consume(decoder.end()); if (!discarding && pending.trim()) receive(pending); });
}

export const startBackend: BackendFactory = async (options) => {
    const host = join(options.runtimeDirectory, "host.mjs");
    await access(host);
    const require = createRequire(import.meta.url);
    const cli = require.resolve("@github/copilot/npm-loader.js");
    const environment = desktopRuntimeEnvironment();
    environment.COPILOT_CLI_PATH = cli;
    environment.COPILOT_SDK_DEFAULT_CONNECTION = "stdio";
    const tree = await createProcessTree();
    const child = spawn(process.execPath, [host, "--workspace", options.workspace], {
        cwd: options.workspace, env: environment, stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true, detached: process.platform !== "win32",
    });
    let stopped = false;
    let stopping: Promise<void> | undefined;
    let cleanupError: string | undefined;
    let processError: string | undefined;
    const closeTree = () => {
        try { tree.close(); cleanupError = undefined; }
        catch (error) { cleanupError = errorMessage(error); options.diagnostic(cleanupError); }
    };
    process.once("exit", closeTree);
    const completed = new Promise<void>((resolve) => {
        child.once("error", (error) => {
            processError = error.message;
            options.diagnostic(`Backend process error: ${error.message}`);
        });
        child.once("exit", closeTree);
        child.once("close", (code) => {
            stopped = true;
            closeTree();
            process.off("exit", closeTree);
            options.exited(code, cleanupError || processError);
            resolve();
        });
    });
    child.stdin.on("error", (error: Error) => {
        if (!stopped && !stopping) options.diagnostic(`Backend input closed: ${error.message}`);
    });
    const send = async (command: BackendCommand) => {
        if (stopped || !child.stdin.writable) throw new Error("The backend connection is closed.");
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("The backend did not accept the command within two seconds.")), 2000);
            child.stdin.write(`${JSON.stringify(command)}\n`, (error) => {
                clearTimeout(timer);
                if (error) reject(error);
                else resolve();
            });
        });
    };
    const stop = (): Promise<void> => stopping ??= (async () => {
        if (!stopped) {
            try { await send({ type: "shutdown" }); }
            catch (error) { options.diagnostic(`Graceful shutdown request failed: ${errorMessage(error)}`); closeTree(); }
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
                await Promise.race([completed, new Promise<void>((resolve) => {
                    timer = setTimeout(() => {
                        options.diagnostic("Backend shutdown timed out; terminating only its owned process tree.");
                        closeTree();
                        resolve();
                    }, PRIVATE_CLOSE_DEADLINE_MS + MAIN_CLOSE_DEADLINE_MS + 2_000);
                })]);
            } finally { clearTimeout(timer); }
            let finalTimer: ReturnType<typeof setTimeout> | undefined;
            try {
                await Promise.race([completed, new Promise<never>((_, reject) => {
                    finalTimer = setTimeout(() => reject(new Error("Backend termination remains unconfirmed. Workspace switching is blocked.")), 3000);
                })]);
            } finally { clearTimeout(finalTimer); }
        }
        if (cleanupError) throw new Error(`Backend cleanup could not be confirmed: ${cleanupError}`);
    })().catch((error: unknown) => { stopping = undefined; throw error; });
    try {
        if (!child.pid) {
            await completed;
            throw new Error(processError || cleanupError || "The Node backend could not be started.");
        }
        tree.assign(child.pid);
        consumeLines(child.stdout, 64 * 1024, (line) => {
            try { options.event(parseBackendEvent(JSON.parse(line))); }
            catch (error) {
                options.diagnostic(errorMessage(error));
                options.event({ type: "error", message: "The backend protocol failed. Restart this workspace." });
                closeTree();
            }
        }, () => {
            options.event({ type: "error", message: "The backend returned an oversized host event. Restart this workspace." });
            closeTree();
        });
        consumeLines(child.stderr, 8192, (line) => options.diagnostic(`Backend: ${line}`),
            () => options.diagnostic("An oversized backend diagnostic line was omitted."));
        return { send, stop };
    } catch (error) {
        closeTree();
        if (child.pid && child.exitCode === null) child.kill("SIGKILL");
        await completed;
        throw error;
    }
};
