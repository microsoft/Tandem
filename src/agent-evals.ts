import { createHash } from "node:crypto";
import { buildDevelopmentHandoffPrompt, buildPreparationHandoffPrompt } from "./planning-prompts.js";

/**
 * Synthetic, prompt-only preparation/Design-handoff probes, not native or UI tests.
 * Graders check structural invariants and case-specific semantic indicators, not
 * exact prose or a model's claim that its answer "passed".
 */
export const evaluationScope = "Fixture-based preparation and Prototype-to-Designer handoff only; no research, implementation, browser interaction, native role execution or end-to-end UI coverage.";

type PrototypeMode = "build" | "validate-existing" | "not-applicable" | "undecided";
interface Prerequisite {
    label: string;
    indicators: string[][];
}
interface CaseBase {
    id: string;
    title: string;
}
export interface PreparationEvalCase extends CaseBase {
    kind: "preparation";
    input: {
        goal: string;
        workspaceAnalysis: {
            summary: string;
            checks: Array<{ label: string; status: "ready" | "missing" | "deferred"; detail: string }>;
        };
        sourceAnalysis: { summary: string; sources: Array<{ title: string; url: string; purpose: string }> };
    };
    expected: { prototypeMode: PrototypeMode; usageIndicators: string[][]; missingPrerequisites: Prerequisite[] };
}
export interface HandoffEvalCase extends CaseBase {
    kind: "handoff";
    input: Parameters<typeof buildDevelopmentHandoffPrompt>[0];
}
export type EvalCase = PreparationEvalCase | HandoffEvalCase;

const noSources = { summary: "Synthetic fixture only. No external sources have been researched.", sources: [] };
const preparationCase = (
    id: string, title: string, goal: string, workspace: string, mode: PrototypeMode, usageIndicators: string[][],
    missingPrerequisites: Prerequisite[] = [],
): PreparationEvalCase => ({
    id, title, kind: "preparation",
    input: {
        goal,
        workspaceAnalysis: {
            summary: workspace,
            checks: missingPrerequisites.map(({ label }) => ({
                label, status: "missing", detail: "Not available in this fixture. Do not install, provision, or execute live work.",
            })),
        },
        sourceAnalysis: noSources,
    },
    expected: { prototypeMode: mode, usageIndicators, missingPrerequisites },
});

export const evalCases: readonly EvalCase[] = [
    preparationCase(
        "new-gui", "New graphical workflow",
        "Create a visual meal planner where I can arrange meals on a weekly calendar and generate a shopping list.",
        "Empty application workspace. This is a new graphical product; the calendar layout and drag interactions need visual evaluation.",
        "build", [["meal", "calendar"], ["shopping", "grocery"]],
    ),
    preparationCase(
        "existing-gui", "Reuse a useful existing GUI",
        "Improve the existing support dashboard so I can filter tickets and inspect their conversation history.",
        "A working React support dashboard already has ticket filtering and a detail pane. Its running mock-driven GUI materially helps evaluate the requested flow; validate that GUI rather than replace it.",
        "validate-existing", [["filter", "ticket"], ["history", "conversation"]],
    ),
    preparationCase(
        "non-gui", "Non-graphical task",
        "Provide a CLI that validates nightly CSV invoices and exits nonzero with row-level diagnostics when an invoice is invalid.",
        "A headless batch-processing repository. Consumers are automation jobs and terminal users; no graphical interface or interaction needs evaluation.",
        "not-applicable", [["validat", "invoice", "csv"], ["diagnostic", "error", "row"]],
    ),
    preparationCase(
        "missing-prerequisites", "Defer credentials and browser tooling",
        "Plan a new checkout UI with mock payment approval and rejection flows. Keep real Stripe charges and browser execution deferred until their prerequisites are supplied.",
        "A new checkout GUI is needed. No STRIPE_SECRET_KEY is configured, and the Playwright browser runtime is not installed. Requirements can proceed with fixtures. No installations, real payment calls, or browser executions have occurred.",
        "build", [["checkout", "payment"], ["reject", "declin", "fail"]],
        [
            { label: "STRIPE_SECRET_KEY", indicators: [["stripe", "payment"], ["key", "credential", "secret"]] },
            { label: "Playwright browser runtime", indicators: [["playwright", "browser"], ["runtime", "install", "tool"]] },
        ],
    ),
    ...(["build", "not-applicable"] as const).map((mode): HandoffEvalCase => ({
        id: mode === "build" ? "prototype-handoff" : "no-gui-handoff",
        title: mode === "build" ? "Prototype continues through Designer" : "No-GUI Design continuation",
        kind: "handoff",
        input: {
            handoffId: "fixture-handoff", receiptPath: "C:\\fixture\\receipt.json",
            snapshotPath: "C:\\fixture\\snapshot.json", sourcePath: mode === "build" ? "C:\\fixture\\source" : null,
            disposition: mode, goal: "Preserve the confirmed workflow and explicitly labeled mocks.",
        },
    })),
];

type Schema = {
    type: "object" | "array" | "string" | "number";
    properties?: Record<string, Schema>;
    required?: string[];
    additionalProperties?: false;
    items?: Schema;
    minItems?: number;
    maxItems?: number;
    minLength?: number;
    maxLength?: number;
    minimum?: number;
    maximum?: number;
    enum?: string[];
    description?: string;
};
const text: Schema = { type: "string", minLength: 1 };
const list = (item: Schema = text, minimum = 0, maximum = 30): Schema => ({
    type: "array", items: item, ...(minimum ? { minItems: minimum } : {}), maxItems: maximum,
});
const object = (properties: Record<string, Schema>, optional: string[] = []): Schema => ({
    type: "object", additionalProperties: false, properties,
    required: Object.keys(properties).filter((key) => !optional.includes(key)),
});
const preparationSchema = object({
    status: { type: "string", enum: ["ready", "needs-attention"] },
    summary: { ...text, maxLength: 2000 },
    checks: list(object({
        label: { ...text, maxLength: 120 }, status: { type: "string", enum: ["ready", "missing", "deferred"] },
        detail: { type: "string", maxLength: 500 },
    }), 0, 20),
    sources: list(object({
        title: { ...text, maxLength: 160 }, url: { ...text, maxLength: 1000 },
        purpose: { type: "string", maxLength: 500 },
    }), 0, 20),
    suggestedUsages: list({ ...text, maxLength: 500 }, 1, 5),
    assumed: list({ ...text, maxLength: 500 }, 0, 20),
    deferred: list({ ...text, maxLength: 500 }, 0, 20),
    prototypeApproach: object({
        mode: { type: "string", enum: ["build", "validate-existing", "not-applicable", "undecided"] },
        reason: { ...text, maxLength: 500 },
    }),
});
const handoffSchema = object({
    intent: { type: "string", enum: ["design"] },
    sourcePaths: list(text, 1, 4),
    constraints: list(text, 1, 10),
    implementation: { type: "string", enum: ["not-authorized"] },
});

/** Uses the production builders verbatim, then appends only the response contract. */
export function buildEvalPrompt(evaluation: EvalCase): string {
    const production = evaluation.kind === "preparation"
        ? buildPreparationHandoffPrompt(
            { goal: evaluation.input.goal }, evaluation.input.workspaceAnalysis, evaluation.input.sourceAnalysis,
        )
        : buildDevelopmentHandoffPrompt(evaluation.input);
    return [
        production,
        "",
        "Return exactly one JSON object. An optional single ```json or unlabelled ``` fence is supported; no surrounding prose or extra fields.",
        "Required JSON Schema:",
        JSON.stringify(evaluation.kind === "preparation" ? preparationSchema : handoffSchema, null, 2),
    ].join("\n");
}

export function promptFingerprint(prompt: string): string {
    return createHash("sha256").update(prompt).digest("hex");
}

/** Strict JSON parsing, with only a single full-response json/plain code fence allowed. */
export function parseEvalResponse(content: string): unknown {
    if (typeof content !== "string" || content.length > 256_000) throw new Error("Response must be a JSON object under 256 KB.");
    const trimmed = content.trim();
    const fenced = /^```(?:json)?\s*\r?\n([\s\S]*?)\r?\n```\s*$/i.exec(trimmed);
    let parsed: unknown;
    try { parsed = JSON.parse(fenced ? fenced[1] : trimmed); }
    catch { throw new Error("Response is not strict JSON (optionally in one json/plain code fence)."); }
    if (!isRecord(parsed)) throw new Error("Response must be one JSON object.");
    return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function schemaErrors(schema: Schema, value: unknown, path = "$"): string[] {
    if (schema.type === "object") {
        if (!isRecord(value)) return [`${path}: expected object`];
        const fields = schema.properties!;
        return [
            ...Object.keys(value).filter((key) => !Object.hasOwn(fields, key)).map((key) => `${path}.${key}: unexpected field`),
            ...Object.entries(fields).flatMap(([key, definition]) => Object.hasOwn(value, key) || schema.required!.includes(key)
                ? schemaErrors(definition, value[key], `${path}.${key}`) : []),
        ];
    }
    if (schema.type === "array") {
        if (!Array.isArray(value)) return [`${path}: expected array`];
        if (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity)) return [`${path}: invalid array length`];
        return value.flatMap((item, index) => schemaErrors(schema.items!, item, `${path}[${index}]`));
    }
    if (schema.type === "string") {
        if (typeof value !== "string" || value.trim().length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? Infinity)) return [`${path}: invalid string`];
        return schema.enum && !schema.enum.includes(value) ? [`${path}: invalid enum`] : [];
    }
    return typeof value !== "number" || !Number.isFinite(value) || value < schema.minimum! || value > schema.maximum!
        ? [`${path}: invalid number`] : [];
}

export interface EvalCheck { id: string; passed: boolean; detail: string }
export interface EvalGrade { passed: boolean; checks: EvalCheck[]; normalizedWorkItems?: Array<Record<string, unknown>> }

interface PreparationOutput {
    status: string;
    summary: string;
    checks: Array<{ label: string; status: string; detail: string }>;
    sources: Array<{ title: string; url: string; purpose: string }>;
    suggestedUsages: string[];
    assumed: string[];
    deferred: string[];
    prototypeApproach: { mode: string; reason: string };
}

const matchesIndicators = (text: string, groups: string[][]): boolean =>
    groups.every((alternatives) => alternatives.some((pattern) => new RegExp(pattern, "i").test(text)));
const normalizedWords = (text: string): string =>
    text.toLowerCase().replace(/^i want to\s+/, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function distinctUsages(usages: string[]): boolean {
    const words = usages.map((usage) => new Set(normalizedWords(usage).split(" ")));
    return words.every((left, i) => words.slice(i + 1).every((right) => {
        const intersection = [...left].filter((word) => right.has(word)).length;
        return intersection / new Set([...left, ...right]).size < 0.8;
    }));
}

/** Grades an untrusted parsed result. The output has no model-supplied pass flag. */
export function gradeEval(evaluation: EvalCase, result: unknown): EvalGrade {
    const checks: EvalCheck[] = [];
    const check = (id: string, passed: boolean, detail: string) => checks.push({ id, passed, detail });
    const errors = schemaErrors(evaluation.kind === "preparation" ? preparationSchema : handoffSchema, result);
    check("response-schema", errors.length === 0, errors.length ? errors.slice(0, 8).join("; ") : "Required structured response present.");
    if (errors.length) return { passed: false, checks };
    if (evaluation.kind === "preparation") {
        const answer = result as PreparationOutput;
        check("prototype-disposition", answer.prototypeApproach.mode === evaluation.expected.prototypeMode,
            `Expected ${evaluation.expected.prototypeMode}; received ${answer.prototypeApproach.mode}.`);
        check("first-person-usages", answer.suggestedUsages.every((usage) => /^I want to\s+\S/.test(usage)),
            "Every usage must begin with 'I want to'.");
        check("distinct-usages", distinctUsages(answer.suggestedUsages), "Usages must not repeat or trivially reword the same sentence.");
        check("usage-coverage", evaluation.expected.usageIndicators.every((alternatives) =>
            matchesIndicators(answer.suggestedUsages.join("\n"), [alternatives])), "Usages must cover the fixture's distinct intended activities.");
        const sourceURLs = new Set(evaluation.input.sourceAnalysis.sources.map((source) => source.url));
        check("grounded-sources", answer.sources.every((source) => sourceURLs.has(source.url)), "No invented source research.");
        const missing = evaluation.expected.missingPrerequisites;
        if (missing.length) check("blocked-status", answer.status === "needs-attention", "Unavailable prerequisites cannot be reported ready.");
        for (const prerequisite of missing) {
            const related = answer.checks.filter((entry) =>
                entry.label === prerequisite.label || matchesIndicators(`${entry.label} ${entry.detail}`, prerequisite.indicators));
            check(`deferred:${prerequisite.label}`, related.length > 0 &&
                related.every((entry) => entry.status === "missing" || entry.status === "deferred") &&
                answer.deferred.some((entry) => matchesIndicators(entry, prerequisite.indicators)),
            "Known unavailable prerequisite must remain missing/deferred and have an explicit deferral.");
            const unsupportedAssumption = answer.assumed.some((entry) => matchesIndicators(entry, prerequisite.indicators) &&
                !/\b(missing|unavailable|absent|not|no|without|defer|until|once|when|if)\b/i.test(entry));
            const unsupportedSummary = answer.summary.split(/[.!?]\s+/).some((entry) =>
                matchesIndicators(entry, prerequisite.indicators) &&
                /\b(available|configured|installed|provisioned|verified|connected|ready)\b/i.test(entry) &&
                !/\b(missing|unavailable|absent|not|no|without|defer|until|once|when|if)\b/i.test(entry));
            check(`not-invented:${prerequisite.label}`, !unsupportedAssumption && !unsupportedSummary,
                "Do not assume or report that unavailable credentials or tooling already exist.");
        }
        return { passed: checks.every((entry) => entry.passed), checks };
    }

    const answer = result as { intent: string; sourcePaths: string[]; constraints: string[]; implementation: string };
    check("design-only", answer.intent === "design" && answer.implementation === "not-authorized",
        "A Prototype handoff cannot authorize implementation.");
    check("source-identities", [evaluation.input.receiptPath, evaluation.input.snapshotPath, evaluation.input.sourcePath]
        .filter((path): path is string => path !== null).every(path => answer.sourcePaths.includes(path)),
        "Retain the supplied exact source paths.");
    check("intent-boundaries", [/confirm/i, /assum|mock|shortcut/i, /read.only/i].every(pattern => pattern.test(answer.constraints.join("\n"))),
        "Preserve confirmed decisions, label assumptions/mocks and inspect inputs read-only.");
    return { passed: checks.every(entry => entry.passed), checks };
}

/** Inventory validation is not a behavioral pass and never invokes an agent. */
export function validateEvalCases(cases: readonly EvalCase[]): void {
    if (!cases.length) throw new Error("At least one evaluation fixture is required.");
    const ids = new Set<string>();
    for (const evaluation of cases) {
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(evaluation.id) || ids.has(evaluation.id)) throw new Error("Fixture case IDs must be unique kebab-case.");
        ids.add(evaluation.id);
        if (!evaluation.title.trim() || !buildEvalPrompt(evaluation).trim()) throw new Error("Fixture title and production prompt are required.");
        if (evaluation.kind === "preparation") {
            const groups = [...evaluation.expected.usageIndicators, ...evaluation.expected.missingPrerequisites.flatMap(entry => entry.indicators)];
            if (!groups.length || groups.some(group => !group.length || group.some(pattern => !pattern.trim()))) throw new Error("Fixtures need semantic grading indicators.");
            groups.flat().forEach(pattern => new RegExp(pattern, "i"));
        }
    }
}

export interface EvalUsage {
    model: string;
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    reasoningTokens?: number;
    cost?: number;
    totalNanoAiu?: number;
    durationMs?: number;
}
/** Returned usage, when supplied, is the complete per-case snapshot, including streamed samples. */
export interface AgentResponse { content: string; usage?: EvalUsage[] }
export interface EvalAgentContext {
    caseId: string; model: string; timeoutMs: number; maxAiCredits: number; signal: AbortSignal;
    /** Record SDK usage as it arrives, including calls that subsequently time out. */
    recordUsage: (usage: EvalUsage) => void;
}
export type EvalAgent = (prompt: string, context: EvalAgentContext) => Promise<AgentResponse>;
export interface EvaluationOptions { model: string; timeoutMs: number; maxAiCredits: number }
export interface EvalCaseResult {
    id: string;
    promptFingerprint: string;
    status: "passed" | "failed" | "error" | "not-run";
    checks: EvalCheck[];
    usage?: EvalUsage[];
    error?: { code: string; message: string };
}
export interface EvalReport {
    schemaVersion: 1;
    mode: "behavioral";
    scope: string;
    model: string;
    startedAt: string;
    completedAt: string;
    limits: { caseCount: number; timeoutMs: number; maxAiCredits: number };
    budget: {
        enforcement: "observed-usage-soft-ceiling";
        observedNanoAiu: number;
        observedAiCredits: number;
        usageComplete: boolean;
        reached: boolean;
        limitation: string;
    };
    cases: EvalCaseResult[];
    exitCode: 0 | 1;
}

export class EvalInfrastructureError extends Error {
    constructor(public readonly code: string, message: string, public readonly usage?: EvalUsage[]) { super(message); }
}

export const evaluationBudgetLimitation = "Observed-usage soft ceiling, not a guaranteed hard cap on in-flight costs. Usage can arrive after charges are incurred; aborting cannot undo charges or guarantee that no further costs accrue.";

/** Normalize decimal credits to the SDK's integer nano-AI accounting unit. */
export function aiCreditsToNanoAiu(credits: number): number {
    const nanoAiu = credits * 1e9;
    const rounded = Math.round(nanoAiu);
    if (!Number.isSafeInteger(rounded) || rounded <= 0 ||
        Math.abs(nanoAiu - rounded) > Number.EPSILON * Math.abs(nanoAiu)) {
        throw new Error("--max-ai-credits requires a positive amount representable in whole nano-AI units within the safe integer range.");
    }
    return rounded;
}

/** Serial runner: observed usage, timeouts, or infrastructure errors stop further cases. */
export async function runEvaluations(
    cases: readonly EvalCase[], agent: EvalAgent, options: EvaluationOptions,
): Promise<EvalReport> {
    validateEvalCases(cases);
    if (!options.model.trim() || !Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0 || options.timeoutMs > 2_147_483_647) {
        throw new Error("An explicit model and positive timeout within the supported timer range are required.");
    }
    const maxNanoAiu = aiCreditsToNanoAiu(options.maxAiCredits);
    const startedAt = new Date().toISOString();
    const results: EvalCaseResult[] = [];
    const budget: EvalReport["budget"] = {
        enforcement: "observed-usage-soft-ceiling", observedNanoAiu: 0, observedAiCredits: 0,
        usageComplete: true, reached: false, limitation: evaluationBudgetLimitation,
    };
    let infrastructureFailed = false;
    for (const evaluation of cases) {
        const prompt = buildEvalPrompt(evaluation);
        const entry: EvalCaseResult = {
            id: evaluation.id, promptFingerprint: promptFingerprint(prompt), status: "not-run", checks: [],
        };
        results.push(entry);
        if (infrastructureFailed) continue;
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        let failure: EvalInfrastructureError | undefined;
        let rejectCase: (error: EvalInfrastructureError) => void;
        const interrupted = new Promise<never>((_, reject) => { rejectCase = reject; });
        const stop = (error: EvalInfrastructureError) => {
            failure ??= error;
            infrastructureFailed = true;
            rejectCase(failure);
            controller.abort(failure);
        };
        const recordUsage = (usage: EvalUsage) => {
            (entry.usage ??= []).push(usage);
            const nanoAiu = usage.totalNanoAiu;
            if (typeof nanoAiu !== "number" || !Number.isSafeInteger(nanoAiu) || nanoAiu < 0 ||
                !Number.isSafeInteger(budget.observedNanoAiu + nanoAiu)) {
                budget.usageComplete = false;
                stop(new EvalInfrastructureError("usage-unavailable", "Usable per-request totalNanoAiu is unavailable; the observed-usage budget cannot be enforced."));
                return;
            }
            budget.observedNanoAiu += nanoAiu;
            budget.observedAiCredits = budget.observedNanoAiu / 1e9;
            if (budget.observedNanoAiu >= maxNanoAiu) {
                budget.reached = true;
                stop(new EvalInfrastructureError("budget-reached", "The observed AI-credit soft ceiling was reached; aborting this case and skipping further calls. In-flight costs may exceed the ceiling."));
            }
        };
        const includeUsageSnapshot = (snapshot?: EvalUsage[]) => {
            if (!snapshot) return;
            const recorded = entry.usage ?? [];
            if (recorded.some((sample, index) =>
                snapshot[index]?.model !== sample.model || snapshot[index]?.totalNanoAiu !== sample.totalNanoAiu)) {
                budget.usageComplete = false;
                stop(new EvalInfrastructureError("usage-unavailable", "The returned usage snapshot does not preserve observed per-request usage."));
                return;
            }
            // Live callbacks return the same complete snapshot after teardown.
            // Count only its unstreamed suffix, never the same requests twice.
            for (const sample of snapshot.slice(recorded.length)) recordUsage(sample);
        };
        try {
            timer = setTimeout(() => {
                budget.usageComplete = false;
                stop(new EvalInfrastructureError("timeout", "The evaluation case exceeded its configured timeout."));
            }, options.timeoutMs);
            const response = await Promise.race([
                Promise.resolve().then(() => {
                    controller.signal.throwIfAborted();
                    return agent(prompt, {
                        ...options, caseId: evaluation.id, signal: controller.signal, recordUsage,
                    });
                }), interrupted,
            ]);
            includeUsageSnapshot(response.usage);
            if (!entry.usage?.length) {
                budget.usageComplete = false;
                stop(new EvalInfrastructureError("usage-unavailable", "No per-request totalNanoAiu was reported; a successful budgeted evaluation cannot be verified."));
            }
            if (failure) throw failure;
            let result: unknown;
            try { result = parseEvalResponse(response.content); }
            catch {
                entry.status = "failed";
                entry.checks = [{ id: "strict-json", passed: false, detail: "Expected one strict JSON object, optionally in one json/plain fence." }];
                continue;
            }
            const grade = gradeEval(evaluation, result);
            entry.checks = grade.checks;
            entry.status = grade.passed ? "passed" : "failed";
        } catch (error) {
            if (error instanceof EvalInfrastructureError) includeUsageSnapshot(error.usage);
            entry.status = "error";
            const diagnostic = failure ?? error;
            entry.error = diagnostic instanceof EvalInfrastructureError
                ? { code: diagnostic.code, message: diagnostic.message }
                : { code: "agent-error", message: "Agent callback failed. Check CLI availability, authentication, model access, and connectivity." };
            budget.usageComplete = false;
            infrastructureFailed = true;
            controller.abort(diagnostic);
        } finally { clearTimeout(timer); }
    }
    return {
        schemaVersion: 1, mode: "behavioral", scope: evaluationScope, model: options.model,
        startedAt, completedAt: new Date().toISOString(),
        limits: { caseCount: cases.length, timeoutMs: options.timeoutMs, maxAiCredits: options.maxAiCredits },
        budget, cases: results, exitCode: results.every((entry) => entry.status === "passed") ? 0 : 1,
    };
}
