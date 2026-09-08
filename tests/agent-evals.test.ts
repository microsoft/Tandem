import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import {
    aiCreditsToNanoAiu, buildEvalPrompt, evalCases, EvalInfrastructureError, gradeEval, parseEvalResponse,
    promptFingerprint, runEvaluations, validateEvalCases,
    type EvalCase, type EvalUsage, type PlanningEvalCase, type PreparationEvalCase,
} from "../src/agent-evals.js";
import { buildPlanningPrompt, buildPreparationHandoffPrompt } from "../src/planning-prompts.js";
import { evaluationInventory, evaluationSessionConfig, isolatedEnvironment, parseArguments } from "../scripts/evaluate.js";

function preparationAnswer(evaluation: PreparationEvalCase) {
    const usages: Record<string, string[]> = {
        "new-gui": ["I want to arrange meals on a weekly calendar.", "I want to generate a shopping list."],
        "existing-gui": ["I want to filter support tickets.", "I want to inspect a conversation history."],
        "non-gui": ["I want to validate CSV invoices.", "I want to receive row-level error diagnostics."],
        "missing-prerequisites": ["I want to approve a mock checkout payment.", "I want to see a declined payment flow."],
    };
    return {
        status: evaluation.expected.missingPrerequisites.length ? "needs-attention" : "ready",
        summary: "Requirements can proceed with synthetic evidence; unavailable live work remains deferred.",
        checks: evaluation.expected.missingPrerequisites.map(({ label }) => ({ label, status: "deferred", detail: "Unavailable; defer live work." })),
        sources: [], suggestedUsages: usages[evaluation.id], assumed: [],
        deferred: evaluation.expected.missingPrerequisites.map(({ label }) => `Defer ${label} work until its missing prerequisite is supplied.`),
        prototypeApproach: { mode: evaluation.expected.prototypeMode, reason: "Grounded in the supplied workspace evidence." },
    };
}

function planningAnswer(evaluation: PlanningEvalCase) {
    const workItems = evaluation.expected.acceptance.map((acceptance, index, entries) => ({
        id: acceptance.id.toLowerCase(),
        title: acceptance.description,
        description: `Implement the accepted scope: ${acceptance.description}`,
        dependencies: index ? [entries[index - 1].id.toLowerCase()] : [],
        agentRole: "Implementation",
        estimatedHours: 2,
        files: [`src/${acceptance.id.toLowerCase()}.ts`],
        skills: [] as string[],
        acceptanceCriteria: [acceptance.description],
        validation: [evaluation.expected.validation[0]],
    }));
    return {
        summary: "A complete fixture implementation plan.",
        strategy: "Merge in dependency order. After implementation, hand off the accepted test-spec to the separate Test factory for independent final integration and interaction acceptance.",
        workItems, risks: [] as string[],
    };
}

const answerFor = (evaluation: EvalCase) => evaluation.kind === "preparation" ? preparationAnswer(evaluation) : planningAnswer(evaluation);
const prepCases = evalCases.filter((evaluation): evaluation is PreparationEvalCase => evaluation.kind === "preparation");
const planCases = evalCases.filter((evaluation): evaluation is PlanningEvalCase => evaluation.kind === "planning");
const failedCheck = (evaluation: EvalCase, answer: unknown, id: string) => {
    const grade = gradeEval(evaluation, answer);
    assert.equal(grade.passed, false);
    assert.equal(grade.checks.find((entry) => entry.id === id)?.passed, false, JSON.stringify(grade));
};

test("inventory validates six fixtures without claiming behavioral success", () => {
    validateEvalCases(evalCases);
    const inventory = evaluationInventory();
    assert.equal(inventory.mode, "inventory");
    assert.equal(inventory.fixtureFormat, "valid");
    assert.equal(inventory.behavioralEvaluationRun, false);
    assert.equal(inventory.cases.length, 6);
    assert.match(inventory.scope, /no research, implementation, browser interaction, or end-to-end UI coverage/);
    for (const entry of inventory.cases) assert.match(entry.promptFingerprint, /^[a-f0-9]{64}$/);
    assert.throws(() => validateEvalCases([]), /fixture/);
    assert.throws(() => validateEvalCases([evalCases[0], evalCases[0]]), /unique/);
});

test("eval prompts use the exact production builders followed by an explicit JSON schema", () => {
    for (const evaluation of evalCases) {
        const production = evaluation.kind === "preparation"
            ? buildPreparationHandoffPrompt({ goal: evaluation.input.goal }, evaluation.input.workspaceAnalysis, evaluation.input.sourceAnalysis)
            : buildPlanningPrompt(evaluation.input);
        const prompt = buildEvalPrompt(evaluation);
        assert.ok(prompt.startsWith(`${production}\n\n`));
        const schema = JSON.parse(prompt.split("Required JSON Schema:\n")[1]);
        assert.equal(prompt.slice(production.length), [
            "", "",
            "Return exactly one JSON object. An optional single ```json or unlabelled ``` fence is supported; no surrounding prose or extra fields.",
            "Required JSON Schema:",
            JSON.stringify(schema, null, 2),
        ].join("\n"));
        assert.equal(schema.type, "object");
        assert.equal(schema.additionalProperties, false);
        assert.ok(schema.required.length > 0);
        assert.notEqual(promptFingerprint(prompt), promptFingerprint(`${prompt} changed`));
    }
});

test("planning response schema matches the production factory, including optional agentId", async () => {
    const source = await readFile(resolve("src", "extension.ts"), "utf8");
    const declaration = (name: string) => {
        const start = source.indexOf(`const ${name} = {`);
        const end = source.indexOf("\n};", start);
        assert.ok(start >= 0 && end > start, `Missing production schema ${name}`);
        return source.slice(start, end + 3);
    };
    const productionSchema = JSON.parse(runInNewContext([
        declaration("planWorkItemSchema"), declaration("planningFactoryOutputSchema"),
        "JSON.stringify(planningFactoryOutputSchema);",
    ].join("\n")));
    const schema = JSON.parse(buildEvalPrompt(planCases[0]).split("Required JSON Schema:\n")[1]);
    assert.deepEqual(schema, productionSchema);
    const answer = planningAnswer(planCases[0]);
    const withAgentIds = { ...answer, workItems: answer.workItems.map((item) => ({ ...item, agentId: "" })) };
    assert.equal(gradeEval(planCases[0], withAgentIds).passed, true);
});

test("good synthetic answers satisfy every case without calling a model", () => {
    for (const evaluation of evalCases) {
        const grade = gradeEval(evaluation, answerFor(evaluation));
        assert.equal(grade.passed, true, `${evaluation.id}: ${JSON.stringify(grade.checks.filter((entry) => !entry.passed))}`);
    }
});

test("prototype disposition is case-specific for new, existing, and non-GUI tasks", () => {
    for (const evaluation of prepCases) {
        const answer = preparationAnswer(evaluation);
        answer.prototypeApproach.mode = evaluation.expected.prototypeMode === "build" ? "not-applicable" : "build";
        failedCheck(evaluation, answer, "prototype-disposition");
    }
});

test("usages must be distinct first-person activities, not matching exact prose", () => {
    const evaluation = prepCases[0];
    const answer = preparationAnswer(evaluation);
    answer.suggestedUsages = ["I want to schedule meals across my calendar.", "I want to assemble groceries into a shopping list."];
    assert.equal(gradeEval(evaluation, answer).passed, true);
    answer.suggestedUsages[0] = "The user wants to arrange meals on a calendar.";
    failedCheck(evaluation, answer, "first-person-usages");
    answer.suggestedUsages = ["I want to plan meals and shopping.", "I want to plan meals and shopping!"];
    failedCheck(evaluation, answer, "distinct-usages");
    answer.suggestedUsages = ["I want to click the first button.", "I want to close a window."];
    failedCheck(evaluation, answer, "usage-coverage");
});

test("missing credentials and tooling stay deferred, never invented or reported ready", () => {
    const evaluation = prepCases.find((entry) => entry.id === "missing-prerequisites")!;
    const answer = preparationAnswer(evaluation);
    answer.status = "ready";
    failedCheck(evaluation, answer, "blocked-status");
    answer.status = "needs-attention";
    answer.checks[0].status = "ready";
    failedCheck(evaluation, answer, "deferred:STRIPE_SECRET_KEY");
    answer.checks[0].status = "deferred";
    answer.deferred = answer.deferred.filter((value) => !value.includes("Playwright"));
    failedCheck(evaluation, answer, "deferred:Playwright browser runtime");
    const invented = preparationAnswer(evaluation);
    invented.assumed.push("Assume STRIPE_SECRET_KEY is already configured.");
    failedCheck(evaluation, invented, "not-invented:STRIPE_SECRET_KEY");
    invented.assumed = [];
    invented.summary = "The Playwright browser runtime is installed.";
    failedCheck(evaluation, invented, "not-invented:Playwright browser runtime");
});

test("preparation rejects invented research and model-supplied pass flags", () => {
    const evaluation = prepCases[0];
    const answer = preparationAnswer(evaluation);
    const invented = { ...answer, sources: [{ title: "Invented", url: "https://not-researched.invalid", purpose: "Pretended research" }] };
    failedCheck(evaluation, invented, "grounded-sources");
    failedCheck(evaluation, { ...answer, passed: true }, "response-schema");
    failedCheck(evaluation, { ...answer, prototypeApproach: null }, "response-schema");
});

test("JSON accepts only a whole object, optionally in a single json or plain code fence", () => {
    assert.deepEqual(parseEvalResponse('{"a":1}'), { a: 1 });
    assert.deepEqual(parseEvalResponse('```json\n{"a":1}\n```'), { a: 1 });
    assert.deepEqual(parseEvalResponse('```\r\n{"a":1}\r\n```'), { a: 1 });
    for (const malformed of [
        "not json", '{"a":1,}', '{"a":1} trailing', "null", "[]", 'true',
        'Here is JSON: {"a":1}', '```javascript\n{"a":1}\n```',
        '```json\n{"a":1}\n```\nExplanation', '{"a":1}\n{"b":2}', '{"a":NaN}',
    ]) assert.throws(() => parseEvalResponse(malformed), undefined, malformed);
    assert.throws(() => parseEvalResponse(`{"a":"${"x".repeat(256_000)}"}`));
});

test("planning rejects cycles, unknown references, self edges, and normalized ID collisions", () => {
    const evaluation = planCases[0];
    for (const corrupt of [
        (answer: ReturnType<typeof planningAnswer>) => { answer.workItems[0].dependencies = [answer.workItems[1].id]; },
        (answer: ReturnType<typeof planningAnswer>) => { answer.workItems[0].dependencies = ["missing-node"]; },
        (answer: ReturnType<typeof planningAnswer>) => { answer.workItems[0].dependencies = [answer.workItems[0].id]; },
        (answer: ReturnType<typeof planningAnswer>) => { answer.workItems[1].id = ` ${answer.workItems[0].id.toUpperCase()} `; },
    ]) {
        const answer = planningAnswer(evaluation);
        corrupt(answer);
        failedCheck(evaluation, answer, "dependency-graph");
    }
});

test("production normalization is reused but returned IDs must already be stable", () => {
    const evaluation = planCases[0];
    const answer = planningAnswer(evaluation);
    answer.workItems[0].id = " Notes Search ";
    answer.workItems[1].dependencies = [" Notes Search "];
    const grade = gradeEval(evaluation, answer);
    assert.equal(grade.normalizedWorkItems![0].id, "notes-search");
    failedCheck(evaluation, answer, "stable-ids");
});

test("semantic acceptance and dependency coverage do not require echoed requirement IDs", () => {
    for (const evaluation of planCases) {
        const answer = planningAnswer(evaluation);
        const ids = new Map(answer.workItems.map((item, index) => [item.id, `work-${index + 1}`]));
        answer.workItems = answer.workItems.map((item) => ({
            ...item, id: ids.get(item.id)!, dependencies: item.dependencies.map((id) => ids.get(id)!),
        }));
        assert.ok(answer.workItems.every((item) => item.acceptanceCriteria.every((criterion) => !/^[A-Z-]+:/.test(criterion))));
        assert.equal(gradeEval(evaluation, answer).passed, true);
    }
});

test("revision cannot drop accepted constraints or merely repeat their ID", () => {
    const evaluation = planCases.find((entry) => entry.id === "revised-plan")!;
    for (const criterion of ["NO-UPLOAD: Done.", "NO-UPLOAD: Drop the rule preventing note upload to telemetry."]) {
        const answer = planningAnswer(evaluation);
        answer.workItems.find((entry) => entry.id === "no-upload")!.acceptanceCriteria = [criterion];
        failedCheck(evaluation, answer, "acceptance:NO-UPLOAD");
    }
    const answer = planningAnswer(evaluation);
    answer.workItems.find((entry) => entry.id === "keyboard")!.acceptanceCriteria = ["KEYBOARD: Buttons look good."];
    failedCheck(evaluation, answer, "acceptance:KEYBOARD");
});

test("implementation validation and existing final test-spec coverage cannot be omitted", () => {
    const evaluation = planCases[0];
    const noChecks = planningAnswer(evaluation);
    noChecks.workItems[0].validation = [];
    failedCheck(evaluation, noChecks, "existing-validation");
    const noCriteria = planningAnswer(evaluation);
    noCriteria.workItems[0].acceptanceCriteria = [];
    failedCheck(evaluation, noCriteria, "observable-acceptance");
    const invented = planningAnswer(evaluation);
    invented.workItems[0].validation = ["npm run imaginary-tests"];
    failedCheck(evaluation, invented, "existing-validation");
    const missing = planningAnswer(evaluation);
    missing.strategy = "After implementation, the separate Test factory performs independent final integration and interaction acceptance.";
    failedCheck(evaluation, missing, "validation-coverage");
});

test("final Test handoff belongs in strategy or risks, not an implementation work item", () => {
    const evaluation = planCases[0];
    const noHandoff = planningAnswer(evaluation);
    noHandoff.strategy = "Merge the implementation in dependency order.";
    failedCheck(evaluation, noHandoff, "final-test-handoff");
    const inRisks = planningAnswer(evaluation);
    inRisks.risks = [inRisks.strategy];
    inRisks.strategy = "Merge in dependency order.";
    assert.equal(gradeEval(evaluation, inRisks).passed, true);
    const separate = planningAnswer(evaluation);
    separate.strategy = "After implementation, the Test stage performs independent final integration and interaction acceptance against the approved test specification.";
    assert.equal(gradeEval(evaluation, separate).passed, true);
    const omitted = planningAnswer(evaluation);
    omitted.strategy = "Skip independent final integration and interaction acceptance after implementation in the Test stage; ignore the accepted test-spec.";
    failedCheck(evaluation, omitted, "final-test-handoff");
    const misplaced = planningAnswer(evaluation);
    misplaced.workItems.push({
        id: "final-validation", title: "Run independent final validation",
        description: "Execute final integration and interaction acceptance in the Test stage.",
        dependencies: [misplaced.workItems.at(-1)!.id], agentRole: "Test", estimatedHours: 1,
        files: ["tests/final.test.ts"], skills: [],
        acceptanceCriteria: ["Independent final acceptance succeeds."],
        validation: [...evaluation.expected.validation],
    });
    failedCheck(evaluation, misplaced, "implementation-stage-boundary");
    misplaced.workItems.at(-1)!.agentRole = "Implementation";
    failedCheck(evaluation, misplaced, "implementation-stage-boundary");
});

test("authoring integration tests remains legitimate implementation work", () => {
    const evaluation = planCases[0];
    const answer = planningAnswer(evaluation);
    answer.workItems.push({
        id: "author-integration-tests", title: "Author integration tests",
        description: "Build the integration harness and prepare the handoff for independent final acceptance in the Test stage.",
        dependencies: [answer.workItems.at(-1)!.id], agentRole: "Test", estimatedHours: 2,
        files: ["tests/integration.test.ts"], skills: [],
        acceptanceCriteria: ["Integration tests cover the implemented note search contract."],
        validation: [evaluation.expected.validation[1]],
    });
    assert.equal(gradeEval(evaluation, answer).passed, true);
});

test("independent approved integration checks at a ready boundary are not the final Test factory", () => {
    const evaluation = planCases[0];
    const answer = planningAnswer(evaluation);
    answer.workItems.push({
        id: "check-search-integration", title: "Run independent search integration checks",
        description: "Execute approved checks at the dependency-ready implementation boundary, before the remaining privacy work.",
        dependencies: [answer.workItems[0].id], agentRole: "Test", estimatedHours: 1,
        files: ["tests/search-integration.test.ts"], skills: [],
        acceptanceCriteria: ["Search integration checks exercise existing title and body behavior."],
        validation: [evaluation.expected.validation[1]],
    });
    assert.equal(gradeEval(evaluation, answer).passed, true);
});

test("PR triggers include every source, test, and workflow while live stays manually gated", async () => {
    const workflow = await readFile(resolve(".github", "workflows", "agent-evals.yml"), "utf8");
    const pullRequest = workflow.split("  workflow_dispatch:")[0];
    for (const path of [
        "src/**", "tests/**", "scripts/evaluate.ts", "skills/**", ".github/workflows/**",
        ".github/copilot-instructions.md", "package.json", "package-lock.json", "tsconfig*.json",
    ]) assert.ok(pullRequest.includes(`- "${path}"`));
    assert.match(workflow, /if: github\.event_name == 'workflow_dispatch' && github\.ref == format/);
    assert.match(workflow, /environment: copilot-evals/);
    assert.match(workflow, /secrets\.COPILOT_EVAL_TOKEN/);
    assert.match(workflow, /max_ai_credits:/);
    assert.match(workflow, /--max-ai-credits "\$EVAL_MAX_AI_CREDITS"/);
    assert.match(workflow, /in-flight costs can exceed it/);
    assert.doesNotMatch(workflow, /max_tokens|max-tokens/);
    assert.doesNotMatch(workflow, /^\s*(pull_request_target|schedule):/m);
});

test("dependency fixture enforces consumer-after-producer order and safe ownership", () => {
    const evaluation = planCases.find((entry) => entry.id === "dependency-validation")!;
    const answer = planningAnswer(evaluation);
    answer.workItems.find((entry) => entry.id === "flow-api")!.dependencies = [];
    failedCheck(evaluation, answer, "dependency:FLOW-CONTRACT->FLOW-API");
    answer.workItems[0].files = ["src/shared.ts"];
    answer.workItems[1].files = ["src/shared.ts"];
    failedCheck(evaluation, answer, "safe-ownership");
    const escaping = planningAnswer(evaluation);
    escaping.workItems[0].files = ["..\\outside.ts"];
    failedCheck(evaluation, escaping, "safe-ownership");
    const skills = planningAnswer(evaluation);
    skills.workItems[0].skills = ["made-up-skill"];
    failedCheck(evaluation, skills, "installed-skills");
});

test("fake runner reports model, prompt fingerprints, actual usage, and a successful exit code", async () => {
    const calls: string[] = [];
    const report = await runEvaluations(evalCases, async (_prompt, context) => {
        calls.push(context.caseId);
        assert.equal(context.model, "fixture-model");
        assert.equal(context.maxAiCredits, 1);
        assert.equal(context.signal.aborted, false);
        return {
            content: JSON.stringify(answerFor(evalCases.find((entry) => entry.id === context.caseId)!)),
            usage: [{ model: "reported-fixture-model", inputTokens: 17, outputTokens: 23, totalNanoAiu: 100 }],
        };
    }, { model: "fixture-model", timeoutMs: 1000, maxAiCredits: 1 });
    assert.equal(report.exitCode, 0);
    assert.equal(report.model, "fixture-model");
    assert.equal(report.limits.caseCount, evalCases.length);
    assert.equal(report.limits.maxAiCredits, 1);
    assert.equal(report.budget.enforcement, "observed-usage-soft-ceiling");
    assert.equal(report.budget.observedNanoAiu, 600);
    assert.equal(report.budget.observedAiCredits, 600 / 1e9);
    assert.equal(report.budget.usageComplete, true);
    assert.equal(report.budget.reached, false);
    assert.match(report.budget.limitation, /not a guaranteed hard cap on in-flight costs/);
    assert.deepEqual(calls, evalCases.map((entry) => entry.id));
    assert.equal(report.cases[0].usage![0].inputTokens, 17);
    assert.equal(report.cases[0].usage![0].model, "reported-fixture-model");
    assert.equal(report.cases[0].promptFingerprint, promptFingerprint(buildEvalPrompt(evalCases[0])));
});

test("behavior failures and malformed JSON are nonzero, not infrastructure successes", async () => {
    const report = await runEvaluations(evalCases.slice(0, 2), async (_prompt, context) => ({
        content: context.caseId === "new-gui" ? "```json\nbroken\n```" : JSON.stringify({ ...preparationAnswer(prepCases[1]), passed: true }),
        usage: [{ model: "fake", totalNanoAiu: 100 }],
    }), { model: "fake", timeoutMs: 1000, maxAiCredits: 1 });
    assert.equal(report.exitCode, 1);
    assert.deepEqual(report.cases.map((entry) => entry.status), ["failed", "failed"]);
    assert.equal(report.cases[0].checks[0].id, "strict-json");
    assert.equal(report.budget.observedNanoAiu, 200);
});

test("infrastructure failures stop subsequent calls and redact arbitrary error messages", async () => {
    let calls = 0;
    const report = await runEvaluations(evalCases, async () => {
        calls++;
        throw new Error("sensitive-token-must-not-appear");
    }, { model: "fake", timeoutMs: 1000, maxAiCredits: 1 });
    assert.equal(report.exitCode, 1);
    assert.equal(calls, 1);
    assert.equal(report.cases[0].status, "error");
    assert.ok(report.cases.slice(1).every((entry) => entry.status === "not-run"));
    assert.doesNotMatch(JSON.stringify(report), /sensitive-token/);
    const auth = await runEvaluations([evalCases[0]], async () => {
        throw new EvalInfrastructureError("authentication", "Explicit Copilot token is unavailable.");
    }, { model: "fake", timeoutMs: 1000, maxAiCredits: 1 });
    assert.equal(auth.exitCode, 1);
    assert.equal(auth.cases[0].error!.code, "authentication");
});

test("callbacks are time-bounded, aborted, and retain usage observed before timeout", async () => {
    let signal: AbortSignal | undefined;
    const start = Date.now();
    const report = await runEvaluations(evalCases.slice(0, 2), async (_prompt, context) => {
        signal = context.signal;
        context.recordUsage({ model: "fake", inputTokens: 7, totalNanoAiu: 25 });
        return new Promise(() => {});
    }, { model: "fake", timeoutMs: 20, maxAiCredits: 1 });
    assert.ok(Date.now() - start < 2000);
    assert.equal(signal!.aborted, true);
    assert.equal(report.exitCode, 1);
    assert.equal(report.cases[0].error!.code, "timeout");
    assert.equal(report.cases[0].usage![0].inputTokens, 7);
    assert.equal(report.budget.observedNanoAiu, 25);
    assert.equal(report.budget.usageComplete, false);
    assert.equal(report.cases[1].status, "not-run");
    await assert.rejects(runEvaluations(evalCases, async () => ({ content: "{}" }), { model: "", timeoutMs: 1000, maxAiCredits: 1 }));
});

test("observed nano-AI usage crosses the shared credit ceiling and aborts a hung callback", async () => {
    let calls = 0;
    let signal: AbortSignal | undefined;
    const report = await runEvaluations(evalCases, async (_prompt, context) => {
        calls++;
        signal = context.signal;
        if (calls === 1) {
            return { content: JSON.stringify(answerFor(evalCases[0])), usage: [{ model: "fake", totalNanoAiu: 600_000_000 }] };
        }
        context.recordUsage({ model: "fake", totalNanoAiu: 200_000_000 });
        assert.equal(context.signal.aborted, false);
        context.recordUsage({ model: "fake", totalNanoAiu: 500_000_000 });
        assert.equal(context.signal.aborted, true);
        return new Promise(() => {});
    }, { model: "fake", timeoutMs: 1000, maxAiCredits: 1 });
    assert.equal(calls, 2);
    assert.equal(signal!.reason.code, "budget-reached");
    assert.equal(report.exitCode, 1);
    assert.equal(report.cases[0].status, "passed");
    assert.equal(report.cases[1].error?.code, "budget-reached");
    assert.ok(report.cases.slice(2).every((entry) => entry.status === "not-run"));
    assert.equal(report.budget.observedNanoAiu, 1_300_000_000);
    assert.equal(report.budget.observedAiCredits, 1.3);
    assert.equal(report.budget.reached, true);
});

test("the exact ceiling also fails closed when usage is available only with a completed response", async () => {
    let calls = 0;
    let signal: AbortSignal | undefined;
    const report = await runEvaluations(evalCases, async (_prompt, context) => {
        calls++;
        signal = context.signal;
        return { content: JSON.stringify(answerFor(evalCases[0])), usage: [{ model: "fake", totalNanoAiu: 1 }] };
    }, { model: "fake", timeoutMs: 1000, maxAiCredits: 0.000000001 });
    assert.equal(calls, 1);
    assert.equal(signal!.aborted, true);
    assert.equal(report.exitCode, 1);
    assert.equal(report.cases[0].error?.code, "budget-reached");
    assert.equal(report.budget.observedNanoAiu, 1);
    assert.equal(report.budget.reached, true);
});

test("completed usage snapshots count only the unstreamed suffix, including on errors", async () => {
    const first = { model: "fake", totalNanoAiu: 100 };
    const second = { model: "fake", totalNanoAiu: 200 };
    for (const throwError of [false, true]) {
        const report = await runEvaluations([evalCases[0]], async (_prompt, context) => {
            context.recordUsage(first);
            const usage = [{ ...first }, second];
            if (throwError) throw new EvalInfrastructureError("session-error", "Fixture session error.", usage);
            return { content: JSON.stringify(answerFor(evalCases[0])), usage };
        }, { model: "fake", timeoutMs: 1000, maxAiCredits: 1 });
        assert.equal(report.exitCode, throwError ? 1 : 0);
        assert.equal(report.budget.observedNanoAiu, 300);
        assert.deepEqual(report.cases[0].usage, [first, second]);
    }
});

test("missing, malformed, partial, or overflowed credit usage cannot produce success or further calls", async () => {
    const valid: EvalUsage = { model: "fake", totalNanoAiu: 100 };
    const unmetered: EvalUsage = { model: "fake", inputTokens: 12, outputTokens: 10, cost: 0.25 };
    const snapshots: Array<EvalUsage[] | undefined> = [
        undefined, [], [unmetered], [valid, unmetered],
        ...[NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1].map((totalNanoAiu) => [{ model: "fake", totalNanoAiu }]),
        [{ model: "fake", totalNanoAiu: Number.MAX_SAFE_INTEGER - 2 }, { model: "fake", totalNanoAiu: 3 }],
    ];
    for (const usage of snapshots) {
        let calls = 0;
        let signal: AbortSignal | undefined;
        const report = await runEvaluations(evalCases, async (_prompt, context) => {
            calls++;
            signal = context.signal;
            return { content: JSON.stringify(answerFor(evalCases[0])), usage };
        }, { model: "fake", timeoutMs: 1000, maxAiCredits: Number.MAX_SAFE_INTEGER / 1e9 });
        assert.equal(calls, 1);
        assert.equal(signal!.aborted, true);
        assert.equal(report.exitCode, 1);
        assert.equal(report.cases[0].error?.code, "usage-unavailable");
        assert.equal(report.budget.usageComplete, false);
        assert.ok(report.cases.slice(1).every((entry) => entry.status === "not-run"));
    }
});

test("a missing streamed credit sample aborts immediately without waiting for a response", async () => {
    const report = await runEvaluations(evalCases, async (_prompt, context) => {
        context.recordUsage({ model: "fake", inputTokens: 1_000_000, outputTokens: 1_000_000, cost: 0 });
        assert.equal(context.signal.aborted, true);
        return new Promise(() => {});
    }, { model: "fake", timeoutMs: 1000, maxAiCredits: 1 });
    assert.equal(report.cases[0].error?.code, "usage-unavailable");
    assert.equal(report.budget.observedNanoAiu, 0);
    assert.equal(report.budget.reached, false);
});

test("explicit zero-credit usage is usable and tokens or billing multipliers never substitute for credits", async () => {
    const report = await runEvaluations([evalCases[0]], async (_prompt, context) => {
        context.recordUsage({ model: "fake", totalNanoAiu: 0, inputTokens: 100_000, outputTokens: 100_000, cost: 10_000 });
        return { content: JSON.stringify(answerFor(evalCases[0])) };
    }, { model: "fake", timeoutMs: 1000, maxAiCredits: 1 });
    assert.equal(report.exitCode, 0);
    assert.equal(report.budget.observedNanoAiu, 0);
    assert.equal(report.budget.usageComplete, true);
});

test("returned usage cannot erase or change already observed samples", async () => {
    for (const usage of [[], [{ model: "fake", totalNanoAiu: 1 }]]) {
        const report = await runEvaluations(evalCases, async (_prompt, context) => {
            context.recordUsage({ model: "fake", totalNanoAiu: 100 });
            return { content: JSON.stringify(answerFor(evalCases[0])), usage };
        }, { model: "fake", timeoutMs: 1000, maxAiCredits: 1 });
        assert.equal(report.exitCode, 1);
        assert.equal(report.cases[0].error?.code, "usage-unavailable");
        assert.equal(report.budget.observedNanoAiu, 100);
        assert.ok(report.cases.slice(1).every((entry) => entry.status === "not-run"));
    }
});

test("credit budgets require safe positive nano-AI precision before invoking an agent", async () => {
    assert.equal(aiCreditsToNanoAiu(1), 1_000_000_000);
    assert.equal(aiCreditsToNanoAiu(1.001), 1_001_000_000);
    assert.equal(aiCreditsToNanoAiu(0.000000001), 1);
    for (const maxAiCredits of [0, -1, NaN, Infinity, 0.0000000001, 1.0000000001, Number.MAX_SAFE_INTEGER]) {
        await assert.rejects(runEvaluations(evalCases, async () => {
            assert.fail("Invalid budgets must not invoke an agent.");
        }, { model: "fake", timeoutMs: 1000, maxAiCredits }), /--max-ai-credits/);
    }
});

test("CLI requires explicit live bounds and rejects invalid or ambiguous input", () => {
    assert.deepEqual(parseArguments([]), { live: false, help: false });
    const options = parseArguments(["--live", "--model", "my-model", "--max-cases", "2", "--timeout-seconds", "90", "--max-ai-credits", "1.25"]);
    assert.equal(options.live, true);
    assert.equal(options.maxAiCredits, 1.25);
    assert.equal(parseArguments(["--max-ai-credits", "0.000000001"]).maxAiCredits, 0.000000001);
    for (const argv of [
        ["--live"], ["--live", "--model", "fake"], ["--max-cases", "0"], ["--max-cases", "7"],
        ["--live", "--model", "fake", "--max-cases", "1", "--timeout-seconds", "90"],
        ["--timeout-seconds", "Infinity"], ["--timeout-seconds", "9999999999"], ["--max-tokens", "2048"],
        ...["-1", "0", "Infinity", "NaN", "1e2", "0.0000000001", "999999999999"].map((value) => ["--max-ai-credits", value]),
        ["--max-ai-credits", "1", "--max-ai-credits", "2"],
        ["--model", "--live"], ["--live", "--live"], ["--other"], ["--model", "hello\nworld"],
    ]) assert.throws(() => parseArguments(argv), undefined, argv.join(" "));
});

test("session configuration denies all tools and disables inherited ambient features without opening a session", async () => {
    const config = evaluationSessionConfig({ model: "fake" }, resolve("fixture-empty"), resolve("fixture-config"));
    assert.deepEqual(config.availableTools, []);
    assert.deepEqual(config.excludedTools, ["builtin:*", "mcp:*", "custom:*"]);
    assert.deepEqual(config.tools, []);
    assert.deepEqual(config.mcpServers, {});
    assert.deepEqual(config.customAgents, []);
    assert.equal(config.enableConfigDiscovery, false);
    assert.equal(config.enableSkills, false);
    assert.equal(config.enableFileHooks, false);
    assert.equal(config.skipCustomInstructions, true);
    assert.equal(config.enableSessionStore, false);
    assert.equal(config.requestExtensions, false);
    assert.equal(config.remoteSession, "off");
    assert.equal(config.modelCapabilities, undefined);
    const result = await config.onPermissionRequest!({ kind: "read" } as never, { sessionId: "fake" });
    assert.equal(result.kind, "denied-no-approval-rule-and-could-not-request-from-user");
    assert.equal(evaluationSessionConfig({ model: "fake" }, "empty", "config").modelCapabilities, undefined);
});

test("runtime environment does not inherit secrets, config locations, or permission switches", () => {
    const home = resolve("fixture-home");
    const environment = isolatedEnvironment({
        PATH: "safe-path", SYSTEMROOT: "system", COPILOT_HOME: "host-config", GH_CONFIG_DIR: "host-gh",
        GITHUB_TOKEN: "secret", COPILOT_ALLOW_ALL: "1", NODE_OPTIONS: "--require arbitrary-code",
        COPILOT_CLI_PATH: "untrusted-cli", RANDOM_SECRET: "another-secret",
    }, home);
    assert.equal(environment.PATH, "safe-path");
    assert.equal(environment.COPILOT_HOME, home);
    assert.equal(environment.HOME, home);
    assert.equal(environment.GITHUB_TOKEN, undefined);
    assert.equal(environment.GH_CONFIG_DIR, undefined);
    assert.equal(environment.COPILOT_ALLOW_ALL, undefined);
    assert.equal(environment.NODE_OPTIONS, undefined);
    assert.equal(environment.COPILOT_CLI_PATH, undefined);
    assert.doesNotMatch(JSON.stringify(environment), /secret|host-config|host-gh|arbitrary-code/);
});

test("invalid live invocation exits nonzero before SDK startup or a paid call", () => {
    const child = spawnSync(process.execPath, ["--import", "tsx", resolve("scripts", "evaluate.ts"), "--live"], {
        cwd: resolve("."), encoding: "utf8", timeout: 10_000,
    });
    assert.equal(child.status, 1, child.stderr);
    assert.match(child.stderr, /require explicit --model, --max-cases, --timeout-seconds, and --max-ai-credits/);
});

test("help and inventory work without network or SDK subprocess access", () => {
    for (const argv of [[], ["--help"], ["--live", "--help"]]) {
        const source = `
            import net from "node:net";
            import tls from "node:tls";
            import http from "node:http";
            import https from "node:https";
            import childProcess from "node:child_process";
            import { syncBuiltinESMExports } from "node:module";
            import { basename } from "node:path";
            const forbidden = () => { throw new Error("Network and subprocess access are forbidden in this test."); };
            const allowCompiler = (operation) => (command, ...args) =>
                ["esbuild", "esbuild.exe"].includes(basename(String(command))) ? operation(command, ...args) : forbidden();
            net.Socket.prototype.connect = forbidden;
            tls.connect = forbidden;
            http.request = forbidden;
            https.request = forbidden;
            childProcess.spawn = allowCompiler(childProcess.spawn);
            childProcess.spawnSync = allowCompiler(childProcess.spawnSync);
            childProcess.exec = forbidden;
            childProcess.execSync = forbidden;
            childProcess.execFile = allowCompiler(childProcess.execFile);
            childProcess.execFileSync = allowCompiler(childProcess.execFileSync);
            childProcess.fork = forbidden;
            syncBuiltinESMExports();
            const { main } = await import(${JSON.stringify(pathToFileURL(resolve("scripts", "evaluate.ts")).href)});
            process.exitCode = await main(${JSON.stringify(argv)});
        `;
        const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", source], {
            cwd: resolve("."), encoding: "utf8", timeout: 10_000, env: { ...process.env, TSX_DISABLE_CACHE: "1" },
        });
        assert.equal(child.status, 0, child.stderr);
        if (argv.length) {
            assert.match(child.stdout, /--max-ai-credits N/);
            assert.match(child.stdout, /not a guaranteed hard cap on in-flight costs/);
            assert.match(child.stdout, /actual per-request totalNanoAiu \/ 1e9/);
            assert.match(child.stdout, /Missing or invalid usage fails closed/);
            assert.doesNotMatch(child.stdout, /--max-tokens/);
            assert.match(child.stdout, /not a behavioral pass/);
        } else {
            assert.equal(JSON.parse(child.stdout).behavioralEvaluationRun, false);
        }
    }
});
