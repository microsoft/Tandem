import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { CopilotClient, CopilotSession, SessionConfig, SessionEvent } from "@github/copilot-sdk";
import {
    aiCreditsToNanoAiu, buildEvalPrompt, evalCases, evaluationBudgetLimitation, evaluationScope, EvalInfrastructureError, promptFingerprint,
    runEvaluations, validateEvalCases,
    type AgentResponse, type EvalAgent, type EvalAgentContext, type EvalReport, type EvalUsage,
} from "../src/agent-evals.js";

export interface EvaluationArguments {
    live: boolean;
    help: boolean;
    model?: string;
    maxCases?: number;
    timeoutSeconds?: number;
    maxAiCredits?: number;
}

export function parseArguments(argv: string[]): EvaluationArguments {
    const options: EvaluationArguments = { live: false, help: false };
    const seen = new Set<string>();
    for (let index = 0; index < argv.length; index++) {
        const flag = argv[index];
        if (seen.has(flag)) throw new Error(`Duplicate option: ${flag}`);
        seen.add(flag);
        if (flag === "--live") { options.live = true; continue; }
        if (flag === "--help") { options.help = true; continue; }
        if (!["--model", "--max-cases", "--timeout-seconds", "--max-ai-credits"].includes(flag)) throw new Error("Unknown evaluation option. Use --help.");
        const value = argv[++index];
        if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}.`);
        if (flag === "--model") {
            if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/.test(value)) throw new Error("Invalid model label.");
            options.model = value;
            continue;
        }
        if (flag === "--max-ai-credits") {
            if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,9})?$/.test(value)) throw new Error("--max-ai-credits requires a positive decimal with at most nine fractional digits.");
            options.maxAiCredits = aiCreditsToNanoAiu(Number(value)) / 1e9;
            continue;
        }
        if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error(`${flag} requires a positive integer.`);
        if (flag === "--max-cases") options.maxCases = Number(value);
        else if (flag === "--timeout-seconds") options.timeoutSeconds = Number(value);
    }
    if (options.help) return options;
    if (options.maxCases !== undefined && options.maxCases > evalCases.length) throw new Error(`--max-cases cannot exceed the ${evalCases.length} available fixtures.`);
    if (options.timeoutSeconds !== undefined && options.timeoutSeconds > Math.floor(2_147_483_647 / 1000)) throw new Error("Timeout exceeds the supported timer range.");
    if (options.live && (!options.model || !options.maxCases || !options.timeoutSeconds || !options.maxAiCredits)) {
        throw new Error("Live evaluations require explicit --model, --max-cases, --timeout-seconds, and --max-ai-credits.");
    }
    return options;
}

/** No SDK import, CLI startup, credentials, filesystem writes, or model calls. */
export function evaluationInventory(maxCases = evalCases.length) {
    validateEvalCases(evalCases);
    return {
        mode: "inventory", fixtureFormat: "valid", behavioralEvaluationRun: false,
        scope: evaluationScope,
        cases: evalCases.slice(0, maxCases).map((evaluation) => ({
            id: evaluation.id, kind: evaluation.kind, title: evaluation.title,
            promptFingerprint: promptFingerprint(buildEvalPrompt(evaluation)),
        })),
    };
}

/** Source-qualified exclusions deny all tools, including tools discovered outside the allowlist. */
export function evaluationSessionConfig(
    context: Pick<EvalAgentContext, "model">, workingDirectory: string, configDirectory: string,
): SessionConfig {
    return {
        model: context.model,
        workingDirectory, configDirectory, availableTools: [], excludedTools: ["builtin:*", "mcp:*", "custom:*"],
        tools: [], mcpServers: {}, customAgents: [], skillDirectories: [], instructionDirectories: [], pluginDirectories: [],
        onPermissionRequest: () => ({ kind: "denied-no-approval-rule-and-could-not-request-from-user" }),
        enableConfigDiscovery: false, skipCustomInstructions: true, customAgentsLocalOnly: true,
        enableSkills: false, enableFileHooks: false, enableHostGitOperations: false,
        enableOnDemandInstructionDiscovery: false, enableSessionStore: false,
        requestExtensions: false, requestCanvasRenderer: false, enableMcpApps: false,
        enableSessionTelemetry: false, enableExperimentalMode: false, skipEmbeddingRetrieval: true,
        embeddingCacheStorage: "in-memory", memory: { enabled: false }, infiniteSessions: { enabled: false },
        remoteSession: "off", largeOutput: { enabled: false },
    };
}

/** Allowlist process essentials; never inherit repository MCP, agent config, or permission variables. */
export function isolatedEnvironment(source: NodeJS.ProcessEnv, home: string): Record<string, string> {
    const environment: Record<string, string> = {};
    const allowed = /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|LANG|LC_ALL|HTTPS_PROXY|HTTP_PROXY|NO_PROXY|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE)$/i;
    for (const [key, value] of Object.entries(source)) if (value !== undefined && allowed.test(key)) environment[key] = value;
    return {
        ...environment, HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home,
        XDG_CONFIG_HOME: home, XDG_CACHE_HOME: home, COPILOT_HOME: home,
        TMP: home, TEMP: home, TMPDIR: home, COPILOT_DISABLE_KEYTAR: "1", NO_COLOR: "1",
    };
}

async function bounded<T>(promise: Promise<T>, milliseconds: number, signal?: AbortSignal): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<never>((_, reject) => {
                onAbort = () => reject(signal?.aborted && signal.reason instanceof EvalInfrastructureError
                    ? signal.reason : new EvalInfrastructureError("timeout", "The configured evaluation deadline was reached."));
                if (signal?.aborted) { onAbort(); return; }
                signal?.addEventListener("abort", onAbort, { once: true });
                timer = setTimeout(onAbort, milliseconds);
            }),
        ]);
    } finally {
        clearTimeout(timer);
        if (onAbort) signal?.removeEventListener("abort", onAbort);
    }
}

function actualUsage(event: Extract<SessionEvent, { type: "assistant.usage" }>): EvalUsage {
    const data = event.data;
    return {
        model: data.model, inputTokens: data.inputTokens, outputTokens: data.outputTokens,
        cacheReadTokens: data.cacheReadTokens, cacheWriteTokens: data.cacheWriteTokens,
        reasoningTokens: data.reasoningTokens, cost: data.cost,
        totalNanoAiu: data.copilotUsage?.totalNanoAiu, durationMs: data.duration,
    };
}

async function liveAgent(prompt: string, context: EvalAgentContext, root: string): Promise<AgentResponse> {
    const token = process.env.COPILOT_GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
    if (!token) throw new EvalInfrastructureError("authentication", "Set COPILOT_GITHUB_TOKEN (or GH_TOKEN/GITHUB_TOKEN) to an explicit token with Copilot access. Host login/config is intentionally not inherited.");
    const runDirectory = join(root, "runs", randomUUID());
    const workingDirectory = join(runDirectory, "workspace");
    const home = join(runDirectory, "home");
    let client: CopilotClient | undefined;
    let session: CopilotSession | undefined;
    let failure: EvalInfrastructureError | undefined;
    let content: string | undefined;
    let forceStop: Promise<void> | undefined;
    const usage: EvalUsage[] = [];
    const stopOwnedClient = () => {
        if (client && !forceStop) {
            forceStop = bounded(client.forceStop(), 5_000);
            // Observe immediately; the error is still inspected and reported below.
            void forceStop.catch(() => { failure ??= new EvalInfrastructureError("cleanup", "Failed to stop the evaluation-owned CLI.", usage); });
        }
    };
    context.signal.addEventListener("abort", stopOwnedClient, { once: true });
    try {
        await mkdir(workingDirectory, { recursive: true });
        await mkdir(home, { recursive: true });
        context.signal.throwIfAborted();
        const sdk = await import("@github/copilot-sdk");
        context.signal.throwIfAborted();
        client = new sdk.CopilotClient({
            mode: "empty", connection: sdk.RuntimeConnection.forStdio(),
            workingDirectory, baseDirectory: home, env: isolatedEnvironment(process.env, home),
            gitHubToken: token, useLoggedInUser: false, builtinPluginDirectories: [], logLevel: "none",
        });
        try { await bounded(client.start(), context.timeoutMs, context.signal); }
        catch {
            context.signal.throwIfAborted();
            throw new EvalInfrastructureError("cli-start", "Copilot CLI could not start. Restore the locked SDK/CLI packages and check platform support.", usage);
        }
        context.signal.throwIfAborted();
        const auth = await bounded(client.getAuthStatus(), context.timeoutMs, context.signal);
        if (!auth.isAuthenticated) throw new EvalInfrastructureError("authentication", "Copilot authentication failed; use an explicit token with Copilot access.", usage);
        const usageEvents = new Set<string>();
        const onEvent = (event: SessionEvent) => {
            if (event.type === "assistant.usage") {
                if (usageEvents.has(event.id)) return;
                usageEvents.add(event.id);
                const sample = actualUsage(event);
                usage.push(sample);
                context.recordUsage(sample);
            } else if (event.type === "session.error") {
                failure = new EvalInfrastructureError("session-error", "Copilot reported a session error. Check model access, token permissions, and connectivity.", usage);
            } else if (["tool.execution_start", "external_tool.requested", "permission.requested", "subagent.started"].includes(event.type)) {
                failure = new EvalInfrastructureError("tool-attempt", "A prompt-only evaluation unexpectedly requested tools or delegation; the owned CLI was stopped.", usage);
                stopOwnedClient();
            }
        };
        context.signal.throwIfAborted();
        session = await bounded(client.createSession({
            ...evaluationSessionConfig(context, workingDirectory, home), sessionId: randomUUID(), onEvent,
        }), context.timeoutMs, context.signal);
        context.signal.throwIfAborted();
        const response = await bounded(session.sendAndWait({ prompt }, context.timeoutMs), context.timeoutMs, context.signal);
        if (!response?.data.content) throw new EvalInfrastructureError("empty-response", "Copilot returned no final response.", usage);
        content = response.data.content;
    } catch (error) {
        failure ??= error instanceof EvalInfrastructureError
            ? error : new EvalInfrastructureError("copilot-error", "Copilot evaluation failed. Check CLI installation, authentication, model access, and connectivity.", usage);
    } finally {
        if (client) {
            try {
                if (forceStop) await forceStop;
                else if (context.signal.aborted) await bounded(client.forceStop(), 5_000);
                else {
                    if (session) {
                        await bounded(session.disconnect(), 5_000);
                        await bounded(client.deleteSession(session.sessionId), 5_000);
                    }
                    const errors = await bounded(client.stop(), 5_000);
                    if (errors.length) throw new Error("SDK cleanup reported errors.");
                }
            } catch {
                failure ??= new EvalInfrastructureError("cleanup", "Evaluation CLI/session cleanup failed.", usage);
                try { await bounded(client.forceStop(), 5_000); }
                catch { failure = new EvalInfrastructureError("cleanup", "The evaluation-owned CLI did not confirm shutdown.", usage); }
            }
        }
        context.signal.removeEventListener("abort", stopOwnedClient);
        try { await rm(runDirectory, { recursive: true, force: true, maxRetries: 2 }); }
        catch { failure ??= new EvalInfrastructureError("cleanup", "Could not remove the evaluation-owned workspace.", usage); }
    }
    if (failure) throw failure;
    return { content: content!, usage };
}

export async function writeEvaluationReport(report: EvalReport, root: string): Promise<string> {
    await mkdir(root, { recursive: true });
    const timestamp = report.startedAt.replace(/[:.]/g, "-");
    const nonce = randomUUID();
    const path = join(root, `${timestamp}-${nonce}.json`);
    const pending = join(root, `.${nonce}.pending`);
    try {
        await writeFile(pending, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
        await rename(pending, path);
    } finally { await rm(pending, { force: true }); }
    return path;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
    const options = parseArguments(argv);
    if (options.help) {
        console.log(`Inventory (no model cost; not a behavioral pass): npm run eval\nLive (explicit opt-in): npm run eval -- --live --model MODEL --max-cases N --timeout-seconds N --max-ai-credits N\n--max-ai-credits is required: a positive decimal with up to nine fractional digits, summed across cases from actual per-request totalNanoAiu / 1e9 (not token estimates).\n${evaluationBudgetLimitation}\nReaching the ceiling aborts the owned CLI and skips remaining cases. Missing or invalid usage fails closed; no success or further cases. Timeout is per case, including startup. Live requires an explicit Copilot-capable token.`);
        return 0;
    }
    if (!options.live) {
        console.log(JSON.stringify(evaluationInventory(options.maxCases), null, 2));
        return 0;
    }
    const root = resolve(".tandem", "evals");
    console.log(evaluationBudgetLimitation);
    const pending: Array<Promise<void>> = [];
    const cleanupFailures: EvalInfrastructureError[] = [];
    const agent: EvalAgent = (prompt, context) => {
        const operation = liveAgent(prompt, context, root);
        pending.push(operation.then(() => undefined, (error: unknown) => {
            if (error instanceof EvalInfrastructureError && error.code === "cleanup") cleanupFailures.push(error);
        }));
        return operation;
    };
    const report = await runEvaluations(evalCases.slice(0, options.maxCases), agent, {
        model: options.model!, timeoutMs: options.timeoutSeconds! * 1000, maxAiCredits: options.maxAiCredits!,
    });
    // The callback runner may time out before SDK teardown; wait for bounded teardown before publishing.
    await Promise.all(pending);
    if (cleanupFailures.length) {
        report.exitCode = 1;
        console.error("Evaluation cleanup failed; see failed case diagnostics.");
    }
    report.completedAt = new Date().toISOString();
    const path = await writeEvaluationReport(report, root);
    for (const entry of report.cases) console.log(`${entry.id}: ${entry.status}${entry.error ? ` (${entry.error.code}: ${entry.error.message})` : ""}`);
    console.log(`Observed AI credits: ${report.budget.observedAiCredits} / ${report.limits.maxAiCredits} (soft ceiling; usage ${report.budget.usageComplete ? "complete" : "incomplete"}).`);
    console.log(`Report: ${path}`);
    return report.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    main().then((code) => { process.exitCode = code; }, (error: unknown) => {
        console.error(error instanceof EvalInfrastructureError ? error.message
            : error instanceof Error && /^(Live evaluations|Duplicate option|Unknown evaluation|Missing value|Invalid model|--|Timeout exceeds)/.test(error.message)
                ? error.message : "Evaluation runner failed; check arguments, fixture format, and report-directory permissions.");
        process.exitCode = 1;
    });
}
