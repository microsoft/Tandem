import { build } from "esbuild";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import type { TandemState } from "../../src/types.js";
import type { PreparationToken } from "../../src/agent-runner.js";

interface CanvasContext {
    instanceId: string;
    extensionId: string;
    input: Record<string, unknown>;
}

interface HarnessApi {
    createState(id: string, goal?: string): TandemState;
    loadState(id: string): Promise<TandemState>;
    persistState(state: TandemState): Promise<void>;
    completeLifecycleStage(id: string, stage: string, provider: string): Promise<TandemState>;
    reopenLifecycleStage(id: string, stage: string, provider: string): Promise<TandemState>;
    beginPrototypeBuild(id: string, provider: string): Promise<TandemState>;
    applyFactoryResult(id: string, request: string, result: unknown): Promise<void>;
    updateTandem(ctx: CanvasContext): Promise<TandemState>;
    readRequestBody(chunks: AsyncIterable<Buffer>): Promise<unknown>;
    verifyPreviewIdentity(url: string, id: string): Promise<void>;
    applyCanvasReset(state: TandemState, input: Record<string, unknown>, requestId: string, rehydrating: boolean, writable: boolean): Promise<TandemState>;
    ensurePreparationStarted(state: TandemState, writable: boolean): Promise<TandemState>;
    bindPreparationRun(id: string, token: PreparationToken): Promise<boolean>;
    recordPreparationWorkItem(id: string, item: string, status: string, token: PreparationToken, result?: string): Promise<void>;
    settlePreparationRun(id: string, run: unknown, token: PreparationToken): Promise<void>;
    recoverPreparationFactory(state: TandemState, writable: boolean): void;
    waitForPreparation(id: string): Promise<void>;
    waitForAnswer(id: string): Promise<void>;
    answerFactoryPrompt(args: unknown): string;
    processAction(id: string, provider: string, input: unknown): Promise<TandemState>;
    preparationFactory: {
        meta: { argsSchema: { properties: Record<string, unknown> } };
        run(ctx: Record<string, unknown>): Promise<unknown>;
    };
    waitForExecution(id: string): Promise<void>;
    isCanvasRehydration(ctx: { instanceId: string; reason?: unknown }): boolean;
    setSession(session: unknown): void;
    resetEffort(id: string, provider: string, input: unknown): Promise<TandemState>;
    startEffort(id: string, provider: string, input: unknown): Promise<TandemState>;
    openTandem(ctx: CanvasContext & { sessionId: string; reason?: string }): Promise<{ url: string }>;
    startServer(instance: string, id: string, provider: string, writable: boolean): Promise<{
        url: string; server: import("node:http").Server; heartbeat: ReturnType<typeof setInterval>;
    }>;
    closeServers(): Promise<void>;
    runEffortFactory(id: string, requestId: string, request: unknown): Promise<unknown>;
    waitForEffortRun(id: string, runId: string): Promise<unknown>;
}

let compiled: Promise<string> | undefined;
async function compile(): Promise<string> {
    const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");
    const source = (await readFile(join(sourceRoot, "extension.ts"), "utf8")).replaceAll("\r\n", "\n");
    const end = source.indexOf("session = await joinSession(");
    if (end === -1) throw new Error("The extension session entry point could not be located.");
    const prefix = source.slice(0, end).replaceAll("import.meta.url", JSON.stringify("file:///project/.github/extensions/tandem/extension.mjs"));
    const openStart = source.lastIndexOf("open: async (ctx) => {");
    const openEnd = source.indexOf(",\n            onClose:", openStart);
    if (openStart === -1 || openEnd === -1) throw new Error("The canvas open handler could not be located.");
    const openHandler = source.slice(openStart + "open: ".length, openEnd);
    const result = await build({
        stdin: {
            contents: `${prefix}\nmodule.exports = { createState, loadState, persistState, completeLifecycleStage, reopenLifecycleStage, beginPrototypeBuild, applyFactoryResult, updateTandem, readRequestBody, verifyPreviewIdentity, applyCanvasReset, isCanvasRehydration, ensurePreparationStarted, bindPreparationRun, recordPreparationWorkItem, settlePreparationRun, recoverPreparationFactory, preparationFactory, resetEffort, startEffort, startServer, runEffortFactory, waitForEffortRun, openTandem: ${openHandler}, async closeServers() { for (const entry of servers.values()) { clearInterval(entry.heartbeat); for (const client of entry.clients) client.end(); await new Promise(resolve => entry.server.close(resolve)); } servers.clear(); }, waitForPreparation(id) { return activePreparationRuns.get(id); }, waitForAnswer(id) { return activeAnswerRuns.get(id); }, waitForExecution(id) { return Promise.all([activeImplementationRuns.get(id), activeTestRuns.get(id)]); }, answerFactoryPrompt, processAction, setSession(value) { session = value; } };`,
            loader: "ts", resolveDir: sourceRoot,
        },
        bundle: true, platform: "node", target: "node20", format: "cjs", write: false,
        external: ["@github/copilot-sdk/*", "proper-lockfile", "./renderer.js"],
        logLevel: "silent",
        define: { __TANDEM_VERSION__: JSON.stringify("test") },
    });
    return result.outputFiles[0].text;
}

export async function extensionHarness() {
    const root = resolve("node_modules", "tandem-test-fixtures", randomUUID());
    await mkdir(root, { recursive: true });
    const requests: unknown[] = [];
    const logs: string[] = [];
    const require = createRequire(import.meta.url);
    class CanvasError extends Error {
        constructor(readonly code: string, message: string) { super(message); }
    }
    const module = { exports: {} };
    const session = {
        sessionId: "fixture-session",
        openCanvases: [] as { instanceId: string }[],
        log: async (message: string) => { logs.push(message); },
        rpc: {
            extensions: { list: async () => ({ extensions: [{ id: "project:tandem", status: "running" }] }) },
            factory: { run: async (request: unknown) => {
                requests.push(request);
                return new Promise<never>(() => {});
            } },
        },
    };
    try {
        runInNewContext(await (compiled ??= compile()), {
            module, exports: module.exports, console, URL, Buffer, AbortController, Response, Error, TextDecoder,
            setTimeout, clearTimeout, setInterval, clearInterval,
            fetch: async () => new Response('<html><meta name="tandem-prototype-id" content="sample"></html>'),
            process: new Proxy(process, {
                get(target, key) {
                    if (key === "cwd") return () => root;
                    const value = Reflect.get(target, key);
                    return typeof value === "function" ? value.bind(target) : value;
                },
            }),
            require(name: string) {
                if (name === "node:child_process") {
                    const childProcess = require(name);
                    return { ...childProcess, execFileSync(command: string, args: string[], options: unknown) {
                        if (command === "git" && args[0] === "rev-parse" && args[1] === "--git-common-dir") {
                            return join(root, ".git");
                        }
                        return childProcess.execFileSync(command, args, options);
                    } };
                }
                if (name === "@github/copilot-sdk/extension") return {
                    CanvasError, defineFactory: (value: unknown) => value,
                    isFactoryRunTerminal: (status: string) => ["completed", "failed", "cancelled", "halted", "error"].includes(status),
                };
                if (name === "./renderer.js") return { renderTandemHtml: () => "" };
                return require(name);
            },
        });
        const api = module.exports as HarnessApi;
        api.setSession(session);
        const waitForRequests = async (count = 1) => {
            for (let attempt = 0; requests.length < count && attempt < 300; attempt++) {
                await new Promise((resolve) => setTimeout(resolve, 10));
            }
            if (requests.length < count) throw new Error("The expected factory dispatch was not observed.");
        };
        return { api, root, requests, logs, session, waitForRequests, close: async () => {
            await api.closeServers();
            await rm(root, { recursive: true, force: true });
        } };
    } catch (error) {
        await rm(root, { recursive: true, force: true });
        throw error;
    }
}
