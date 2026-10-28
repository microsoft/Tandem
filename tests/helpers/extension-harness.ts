import { build } from "esbuild";
import { randomUUID } from "node:crypto";
import fs, { mkdir, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import type { TandemState } from "../../src/types.js";
import type { PreparationToken } from "../../src/agent-runner.js";
import { assertFactoryRequestEnvelope, type FactoryLaunchRequest } from "../../src/agent-runner.js";
import { chooseProjectEntry } from "../../src/project-entry.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ApplicationOperation } from "../../development/tandem/runtime-src/application-interface.js";

interface CanvasContext {
    instanceId: string;
    extensionId: string;
    input: Record<string, unknown>;
}

interface HarnessApi {
    inspectApplication(value?: unknown): Promise<{
        protocol: string; owner: string; state: TandemState; binding: { generation: string; revision: number };
        operations: Array<{ id: string; availability: { status: string; blockers: Array<{ code: string; message: string }> }; inputSchema?: unknown }>;
    }>;
    executeApplication(value: unknown): Promise<{ protocol: string; operation: string; outcome: string; data: unknown }>;
    openStageReview(id: string, provider: string, input: Record<string, unknown>): Promise<TandemState>;
    applyStageReview(id: string, provider: string, input: Record<string, unknown>): Promise<TandemState>;
    discardStageReview(id: string, provider: string, input: Record<string, unknown>): Promise<TandemState>;
    submitChangeRequest(id: string, provider: string, input: Record<string, unknown>): Promise<{ requestId: string }>;
    decideChangeRequest(id: string, provider: string, input: Record<string, unknown>): Promise<TandemState>;
    continueChangeWork(id: string): Promise<void>;
    sendChangeToDevelopment(id: string, provider: string, requestId: string): Promise<TandemState>;
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
    publishPrototypeStructure(input: unknown): Promise<{ resultType: string; textResultForLlm: string }>;
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
    answerFactoryPrompt(args: unknown): string;
    answerFactory: {
        meta: {
            argsSchema: { properties: { action: { type: string; enum: string[] } } };
            limits: { timeoutSeconds?: number };
        };
        run(ctx: Record<string, unknown>): Promise<unknown>;
    };
    usageSuggestionFactory: { meta: { limits: { timeoutSeconds?: number } }; run(ctx: Record<string, unknown>): Promise<unknown> };
    textWorkerAgent: { name: string; tools: string[]; infer: boolean; prompt: string };
    preparationFactory: {
        meta: { argsSchema: { properties: Record<string, unknown> }; limits: { timeoutSeconds?: number } };
        run(ctx: Record<string, unknown>): Promise<unknown>;
    };
    continueDevelopment(id: string, provider: string, input?: Record<string, unknown>): Promise<TandemState>;
    assertDevelopmentAvailable(): Promise<void>;
    isCanvasRehydration(ctx: { instanceId: string; reason?: unknown }): boolean;
    setSession(session: unknown): void;
    resetEffort(id: string, provider: string, input: unknown): Promise<TandemState>;
    startEffort(id: string, provider: string, input: unknown): Promise<TandemState>;
    openTandem(ctx: CanvasContext & { sessionId: string; reason?: string }): Promise<{ url: string }>;
    startServer(instance: string, id: string, provider: string, writable: boolean): Promise<{
        url: string; server: import("node:http").Server; heartbeat: ReturnType<typeof setInterval>;
    }>;
    closeServers(): Promise<void>;
    runEffortFactory(id: string, requestId: string, request: FactoryLaunchRequest): Promise<unknown>;
    resumeEffortRun(id: string, runId: string): Promise<unknown>;
    waitForEffortRun(id: string, runId: string): Promise<unknown>;
}

let compiled: Promise<string> | undefined;
async function compile(): Promise<string> {
    const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");
    const source = (await readFile(join(sourceRoot, "extension.ts"), "utf8")).replaceAll("\r\n", "\n");
    const end = source.indexOf("const privateRegistration = privateReviewRegistration(");
    if (end === -1) throw new Error("The extension session entry point could not be located.");
    const prefix = source.slice(0, end).replaceAll("import.meta.url", JSON.stringify(pathToFileURL(join(sourceRoot, "..", ".github", "extensions", "tandem", "extension.mjs")).href))
        .replaceAll('import.meta.resolve("@github/copilot-sdk")', JSON.stringify("file:///fixture-sdk/index.mjs"));
    const openStart = source.lastIndexOf("open: async (ctx) => {");
    const openEnd = source.indexOf(",\n            onClose:", openStart);
    if (openStart === -1 || openEnd === -1) throw new Error("The canvas open handler could not be located.");
    const openHandler = source.slice(openStart + "open: ".length, openEnd);
    const result = await build({
        stdin: {
            contents: `${prefix}\nmodule.exports = { createState, createLegacyState(id, goal) { const state = createState(id, goal); delete state.lifecycle.version; return state; }, loadState, persistState, completeLifecycleStage, reopenLifecycleStage, beginPrototypeBuild, sketchAction, ensureSketchStarted, readSketchImage, publishPrototypeStructure, prototypeAction, queuePrototypeRevision, stageCompletionError, applyFactoryResult, updateTandem, readRequestBody, verifyPreviewIdentity, applyCanvasReset, isCanvasRehydration, ensurePreparationStarted, bindPreparationRun, recordPreparationWorkItem, settlePreparationRun, recoverPreparationFactory, recoverAnswerFactory, preparationFactory, usageSuggestionFactory, textWorkerAgent, resetEffort, startEffort, startServer, runEffortFactory, waitForEffortRun, continueDevelopment, openTandem: ${openHandler}, async closeServers() { for (const entry of servers.values()) { clearInterval(entry.heartbeat); for (const client of entry.clients) client.end(); await new Promise(resolve => entry.server.close(resolve)); } servers.clear(); }, waitForPreparation(id) { return activePreparationRuns.get(id); }, waitForAnswer(id) { return activeAnswerRuns.get(id); }, answerFactory, answerFactoryPrompt, setSession(value) { session = value; handoffs = new DevelopmentHandoffs(WORKSPACE_ROOT, SHARED_PROJECT_ROOT, value.sessionId); } };`,
            loader: "ts", resolveDir: sourceRoot,
        },
        bundle: true, platform: "node", target: "node20", format: "cjs", write: false,
        external: ["@github/copilot-sdk/*", "proper-lockfile", "./renderer.js"],
        plugins: [{
            name: "fixture-controller",
            setup(api) {
                api.onResolve({ filter: /human-loop-controller\.mjs$/ }, () => ({ path: "development", namespace: "fake" }));
                api.onLoad({ filter: /^development$/, namespace: "fake" }, () => ({
                    contents: "export const createHumanLoopController = options => globalThis.developmentFixture(options);",
                }));
            },
        }],
        logLevel: "silent",
        define: { __TANDEM_VERSION__: JSON.stringify("test") },
    });
    return result.outputFiles[0].text + "\nObject.assign(module.exports, { inspectApplication, executeApplication, openStageReview, applyStageReview, discardStageReview, submitChangeRequest, decideChangeRequest, continueChangeWork, sendChangeToDevelopment }); module.exports.assertDevelopmentAvailable = assertDevelopmentAvailable; module.exports.resumeEffortRun = resumeEffortRun; module.exports.waitForSuggestion = id => activeSuggestionRuns.get(id);";
}

export async function extensionHarness(environment: Record<string, string> = {}, sharedRoot?: string, rendererHtml = "", workspaceRoot?: string, unselectedEntry = false, gitReady = false) {
    const root = sharedRoot || resolve("node_modules", "tandem-test-fixtures", randomUUID());
    await mkdir(root, { recursive: true });
    const workspace = workspaceRoot ?? root;
    await mkdir(workspace, { recursive: true });
    if (gitReady) {
        await promisify(execFile)("git", ["-C", workspace, "init", "--quiet", "--template="]);
        try { await fs.writeFile(join(workspace, ".gitignore"), ".tandem/\n", { flag: "wx" }); }
        catch (error) { if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error; }
    }
    if (!unselectedEntry) await chooseProjectEntry(workspace, "preparation");
    const requests: unknown[] = [];
    const developmentRequests: Array<Record<string, unknown>> = [];
    let sendDevelopment = async (request: Record<string, unknown>) => { developmentRequests.push(request); return request; };
    const developmentOpens: string[] = [];
    let mainReasoningEffort: string | undefined;
    let developmentReasoningEffort: string | null = null, developmentEffortActive = false, developmentEffortError: string | null = null;
    let beforeDevelopmentStart: () => Promise<void> = async () => {};
    let developmentApplication: {
        operations: readonly ApplicationOperation[];
        inspect(input?: Record<string, unknown>): Promise<unknown>;
        execute(input: unknown): Promise<unknown>;
    } | undefined;
    let developmentModelRequired = false;
    let developmentOptions: { contextProvider(): Promise<unknown> } | undefined;
    const logs: string[] = [];
    let previewHtml = '<html><meta name="tandem-prototype-id" content="sample"></html>';
    let previewFetch: typeof fetch = async () => new Response(previewHtml);
    let rename = fs.rename;
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
            model: {
                getCurrent: async () => ({ modelId: "fixture-model", reasoningEffort: mainReasoningEffort }),
                list: async () => ({ list: [{ id: "fixture-model", capabilities: { supports: { reasoning_effort: ["low", "high"] } } }] }),
                setReasoningEffort: async ({ reasoningEffort }: { reasoningEffort: string }) => { mainReasoningEffort = reasoningEffort; return { reasoningEffort }; },
            },
            metadata: { isProcessing: async () => ({ processing: false }), activity: async () => ({ hasActiveWork: false }) },
            extensions: { list: async () => ({ extensions: [{ id: "project:tandem", status: "running" }] }) },
            workflow: { run: async (request: FactoryLaunchRequest) => {
                assertFactoryRequestEnvelope(request);
                requests.push(request);
                return new Promise<never>(() => {});
            } },
        },
    };
    try {
        runInNewContext(await (compiled ??= compile()), {
            module, exports: module.exports, console, URL, URLSearchParams, Buffer, AbortController, AbortSignal, Response, Error, TextDecoder, TextEncoder, structuredClone,
            setTimeout, clearTimeout, setInterval, clearInterval,
            developmentFixture: (options: NonNullable<typeof developmentOptions>) => {
                developmentOptions = options;
                return {
                    toolHook: async () => undefined, permissionHandler: async () => ({ kind: "denied-no-approval-rule-and-could-not-request-from-user" }),
                    observe: () => {}, assertQuiet: async () => {
                        if (developmentRequests.length) throw new Error("Finish or close Development before changing upstream discovery.");
                    },
                    status: async () => ({ installation: { status: "new" }, workflow: null }),
                    requiresModelSelection: async () => developmentModelRequired,
                    validateReasoningEffort: async () => {
                        if (developmentRequests.length) throw new Error("Private native work is busy.");
                    },
                    selectReasoningEffort: async (effort: string) => {
                        if (developmentEffortError) throw new Error(developmentEffortError);
                        developmentReasoningEffort = effort;
                    },
                    reasoningEffortStatus: async () => ({ desired: developmentReasoningEffort,
                        actual: developmentEffortActive ? developmentReasoningEffort : null, model: developmentEffortActive ? "private-model" : null,
                        supported: ["low", "high"], status: developmentEffortError ? "error" : developmentReasoningEffort === null ? "unset" : developmentEffortActive ? "applied" : "pending",
                        error: developmentEffortError }),
                    openView: async (id: string) => { developmentOpens.push(id); return { url: "http://127.0.0.1:8765/", application: developmentApplication }; },
                    reportError: (error: Error) => { logs.push(error.message); },
                    close: async () => ({ status: "closed", warnings: [] }),
                    start: async () => { await beforeDevelopmentStart(); return {
                        sessionId: "fixture-private",
                        store: { load: async () => ({
                            owner: { mainSessionId: session.sessionId, privateSessionId: "fixture-private", workspacePath: workspace },
                            requests: developmentRequests.map(request => ({ ...request, status: "waiting" })), recoveries: [],
                        }) },
                        send: (request: Record<string, unknown>) => sendDevelopment(request),
                    }; },
                };
            },
            fetch: (input: Parameters<typeof fetch>[0], init?: RequestInit) => previewFetch(input, init),
            process: new Proxy(process, {
                get(target, key) {
                    if (key === "cwd") return () => workspace;
                    if (key === "env") return { ...target.env, ...environment };
                    const value = Reflect.get(target, key);
                    return typeof value === "function" ? value.bind(target) : value;
                },
            }),
            require(name: string) {
                if (name === "node:fs/promises") return { ...fs, rename: (...args: Parameters<typeof fs.rename>) => rename(...args) };
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
                    CanvasError, defineWorkflow: (value: unknown) => value,
                    isWorkflowRunTerminal: (status: string) => ["completed", "failed", "cancelled", "halted", "error"].includes(status),
                };
                if (name === "./renderer.js") return { renderTandemHtml: () => rendererHtml };
                return require(name);
            },
        });
        const api = module.exports as HarnessApi;
        api.setSession(session);
        if (!developmentOptions) throw new Error("The composed Development controller was not configured.");
        const waitForRequests = async (count = 1) => {
            for (let attempt = 0; requests.length < count && attempt < 300; attempt++) {
                await new Promise((resolve) => setTimeout(resolve, 10));
            }
            if (requests.length < count) throw new Error("The expected factory dispatch was not observed.");
        };
        return { api, root, requests, developmentRequests, developmentOpens, developmentOptions, logs, session, waitForRequests,
            setDevelopmentSend(handler: typeof sendDevelopment) { sendDevelopment = handler; },
            setDevelopmentEffortActive(value: boolean) { developmentEffortActive = value; },
            setDevelopmentEffortError(value: string | null) { developmentEffortError = value; },
            setBeforeDevelopmentStart(handler: () => Promise<void>) { beforeDevelopmentStart = handler; },
            setDevelopmentModelRequired(value: boolean) { developmentModelRequired = value; },
            setDevelopmentApplication(value: NonNullable<typeof developmentApplication>) { developmentApplication = value; },
            setRename(value: typeof fs.rename) { rename = value; },
            setPreviewHtml(value: string) { previewHtml = value; },
            setPreviewFetch(value: typeof fetch) { previewFetch = value; },
            close: async () => {
            await api.closeServers();
            if (!sharedRoot) await rm(root, { recursive: true, force: true });
        } };
    } catch (error) {
        if (!sharedRoot) await rm(root, { recursive: true, force: true });
        throw error;
    }
}
