import { build } from "esbuild";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
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
    answerFactoryPrompt(args: unknown): string;
    processAction(id: string, provider: string, input: unknown): Promise<TandemState>;
    preparationFactory: {
        meta: { argsSchema: { properties: Record<string, unknown> } };
        run(ctx: Record<string, unknown>): Promise<unknown>;
    };
    waitForExecution(id: string): Promise<void>;
    isCanvasRehydration(ctx: { instanceId: string; reason?: unknown }): boolean;
    setSession(session: unknown): void;
}

let compiled: Promise<string> | undefined;
async function compile(): Promise<string> {
    const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");
    const source = await readFile(join(sourceRoot, "extension.ts"), "utf8");
    const end = source.indexOf("session = await joinSession(");
    if (end === -1) throw new Error("The extension session entry point could not be located.");
    const prefix = source.slice(0, end).replaceAll("import.meta.url", JSON.stringify("file:///project/.github/extensions/tandem/extension.mjs"));
    const result = await build({
        stdin: {
            contents: `${prefix}\nmodule.exports = { createState, loadState, persistState, completeLifecycleStage, reopenLifecycleStage, beginPrototypeBuild, applyFactoryResult, updateTandem, readRequestBody, verifyPreviewIdentity, applyCanvasReset, isCanvasRehydration, ensurePreparationStarted, bindPreparationRun, recordPreparationWorkItem, settlePreparationRun, recoverPreparationFactory, preparationFactory, waitForPreparation(id) { return activePreparationRuns.get(id); }, waitForExecution(id) { return Promise.all([activeImplementationRuns.get(id), activeTestRuns.get(id)]); }, answerFactoryPrompt, processAction, setSession(value) { session = value; } };`,
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
    const root = await mkdtemp(join(tmpdir(), "tandem-extension-"));
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
        return { api, root, requests, logs, session, close: () => rm(root, { recursive: true, force: true }) };
    } catch (error) {
        await rm(root, { recursive: true, force: true });
        throw error;
    }
}
