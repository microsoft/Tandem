import { build } from "esbuild";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import type { TandemState } from "../../src/types.js";
import type { PreparationToken } from "../../src/agent-runner.js";
import { assertFactoryRequestEnvelope, type FactoryLaunchRequest } from "../../src/agent-runner.js";

interface CanvasContext {
    instanceId: string;
    extensionId: string;
    input: Record<string, unknown>;
}

interface HarnessApi {
    createState(id: string, goal?: string): TandemState;
    createLegacyState(id: string, goal?: string): TandemState;
    loadState(id: string): Promise<TandemState>;
    persistState(state: TandemState): Promise<void>;
    completeLifecycleStage(id: string, stage: string, provider: string): Promise<TandemState>;
    reopenLifecycleStage(id: string, stage: string, provider: string): Promise<TandemState>;
    beginPrototypeBuild(id: string, provider: string): Promise<TandemState>;
    sketchAction(id: string, provider: string, input: Record<string, unknown>): Promise<TandemState>;
    ensureSketchStarted(state: TandemState, writable: boolean): Promise<TandemState>;
    readSketchImage(input: unknown): Promise<{ resultType: string; textResultForLlm: string; binaryResultsForLlm: { type: string; mimeType: string; data: string }[] }>;
    prototypeAction(id: string, provider: string, input: Record<string, unknown>): Promise<TandemState>;
    queuePrototypeRevision(id: string, provider: string, input: Record<string, unknown>): Promise<{ revisionId: string }>;
    stageCompletionError(state: TandemState, stage: string, options?: { requirePrototypeSpec: boolean }): string | null;
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
    recoverAnswerFactory(state: TandemState, writable: boolean): void;
    seedDefaultDesignReview(state: TandemState, createdAt?: string): TandemState;
    ensureDefaultDesignReview(state: TandemState, writable: boolean): Promise<TandemState>;
    waitForDesignReview(id: string): Promise<void>;
    answerFactoryPrompt(args: unknown): string;
    answerFactory: { run(ctx: Record<string, unknown>): Promise<unknown> };
    usageSuggestionFactory: { run(ctx: Record<string, unknown>): Promise<unknown> };
    textWorkerAgent: { name: string; tools: string[]; infer: boolean; prompt: string };
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
        live: { close(): void };
    }>;
    closeServers(): Promise<void>;
    runEffortFactory(id: string, requestId: string, request: FactoryLaunchRequest): Promise<unknown>;
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
            contents: `${prefix}\nmodule.exports = { createState, createLegacyState(id, goal) { const state = createState(id, goal); delete state.lifecycle.version; return state; }, loadState, persistState, completeLifecycleStage, reopenLifecycleStage, beginPrototypeBuild, sketchAction, ensureSketchStarted, readSketchImage, prototypeAction, queuePrototypeRevision, stageCompletionError, applyFactoryResult, updateTandem, readRequestBody, verifyPreviewIdentity, applyCanvasReset, isCanvasRehydration, ensurePreparationStarted, bindPreparationRun, recordPreparationWorkItem, settlePreparationRun, recoverPreparationFactory, recoverAnswerFactory, seedDefaultDesignReview, ensureDefaultDesignReview, preparationFactory, usageSuggestionFactory, textWorkerAgent, resetEffort, startEffort, startServer, runEffortFactory, waitForEffortRun, openTandem: ${openHandler}, async closeServers() { for (const entry of servers.values()) { clearInterval(entry.heartbeat); for (const client of entry.clients) client.end(); await new Promise(resolve => entry.server.close(resolve)); } servers.clear(); }, waitForPreparation(id) { return activePreparationRuns.get(id); }, waitForAnswer(id) { return activeAnswerRuns.get(id); }, waitForDesignReview(id) { return activeDesignReviewRuns.get(id); }, waitForExecution(id) { return Promise.all([activeImplementationRuns.get(id), activeTestRuns.get(id)]); }, answerFactory, answerFactoryPrompt, processAction, setSession(value) { session = value; } };`,
            loader: "ts", resolveDir: sourceRoot,
        },
        bundle: true, platform: "node", target: "node20", format: "cjs", write: false,
        external: ["@github/copilot-sdk/*", "proper-lockfile", "./renderer.js"],
        plugins: [{
            name: "fake-identity",
            setup(api) {
                api.onResolve({ filter: /^@azure\/identity$/ }, () => ({ path: "identity", namespace: "fake" }));
                api.onResolve({ filter: /^\.\/speech-browser\.js$/ }, () => ({ path: "browser", namespace: "fake" }));
                api.onLoad({ filter: /^identity$/, namespace: "fake" }, () => ({
                    contents: "export const { DefaultAzureCredential } = globalThis.speechIdentity;",
                }));
                api.onLoad({ filter: /^browser$/, namespace: "fake" }, () => ({
                    contents: "export const createBrowserSpeechCredential = options => globalThis.speechIdentity.createSpeechBrowser(options);",
                }));
            },
        }],
        logLevel: "silent",
        define: { __TANDEM_VERSION__: JSON.stringify("test") },
    });
    return result.outputFiles[0].text;
}

export async function extensionHarness(speechEnvironment: Record<string, string> = {}, sharedRoot?: string, rendererHtml = "") {
    const root = sharedRoot || resolve("node_modules", "tandem-test-fixtures", randomUUID());
    await mkdir(root, { recursive: true });
    const requests: unknown[] = [];
    const logs: string[] = [];
    let speechTokenRequests = 0;
    let browserSignIns = 0;
    let browserTokenRequests = 0;
    let previewHtml = '<html><meta name="tandem-prototype-id" content="sample"></html>';
    let signIn: (signal: AbortSignal) => Promise<void> = async () => {};
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
            factory: { run: async (request: FactoryLaunchRequest) => {
                assertFactoryRequestEnvelope(request);
                requests.push(request);
                return new Promise<never>(() => {});
            } },
        },
    };
    try {
        runInNewContext(await (compiled ??= compile()), {
            module, exports: module.exports, console, URL, Buffer, AbortController, AbortSignal, Response, Error, TextDecoder, TextEncoder, structuredClone,
            setTimeout, clearTimeout, setInterval, clearInterval,
            speechIdentity: {
                DefaultAzureCredential: class {
                    async getToken() {
                        speechTokenRequests++;
                        return { token: "fixture-speech-token", expiresOnTimestamp: Date.now() + 600_000 };
                    }
                },
                createSpeechBrowser() {
                    return {
                        async authenticate(_scope: string, options: { abortSignal: AbortSignal }) {
                            browserSignIns++;
                            await signIn(options.abortSignal);
                            return { token: "fixture-browser-token", expiresOnTimestamp: Date.now() + 600_000 };
                        },
                        async getToken() {
                            browserTokenRequests++;
                            return { token: "fixture-browser-token", expiresOnTimestamp: Date.now() + 600_000 };
                        },
                        async dispose() {},
                    };
                },
            },
            fetch: async () => new Response(previewHtml),
            process: new Proxy(process, {
                get(target, key) {
                    if (key === "cwd") return () => root;
                    if (key === "env") return {
                        ...target.env, TANDEM_Speech__ResourceId: "", TANDEM_Speech__Region: "",
                        TANDEM_Speech__Language: "", ...speechEnvironment,
                    };
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
                if (name === "./renderer.js") return { renderTandemHtml: () => rendererHtml };
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
        return { api, root, requests, logs, session, waitForRequests,
            setPreviewHtml(value: string) { previewHtml = value; },
            browserSignIns: () => browserSignIns,
            browserTokenRequests: () => browserTokenRequests,
            setSpeechSignIn(value: typeof signIn) { signIn = value; },
            speechTokenRequests: () => speechTokenRequests, close: async () => {
            await api.closeServers();
            if (!sharedRoot) await rm(root, { recursive: true, force: true });
        } };
    } catch (error) {
        if (!sharedRoot) await rm(root, { recursive: true, force: true });
        throw error;
    }
}
