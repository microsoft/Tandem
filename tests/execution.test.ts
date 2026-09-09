import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import {
    assertExecutionRequest, executionDigest, executionToken, fingerprintWorkspace,
    newExecution, workerOutcome,
} from "../src/execution.js";
import { executionGraph, ownershipConflicts } from "../src/scheduling.js";
import { hasActiveWork } from "../src/workflow.js";
import { createProcessState } from "../src/process-state.js";
import { captureWorkspaceFiles } from "../src/worker-contracts.js";

const functions = [
    "isObject", "normalizeStringList", "normalizeTestScenarios", "scheduleTestScenarios",
    "normalizeTesting", "normalizePlanWorkItems", "schedulePlanWorkItems", "normalizePlanning",
    "normalizeImplementation", "resetImplementationForPlan", "implementationEvent", "executionInputRevision", "executionRuntime",
    "assertCurrentExecution", "bindExecutionRun", "recordExecutionFailure", "assertPreviousExecutionStopped",
    "requestExecutionCancellation", "cancellationRuntime", "finishExecutionCancellation", "performExecutionCancellation",
    "assertExecutionDispatch", "assertCurrentTestEvidence", "assertCurrentImplementationEvidence", "implementationPrompt",
    "runApprovedVerification", "runIndependentVerification",
    "protectedSourceFiles", "assertProtectedSources",
    "prepareImplementationWave", "recordImplementationWaveResults", "markFinalCodeStale",
    "finalCodeArtifact", "settleImplementationRun", "runImplementationFactory", "runExecutionFactory",
    "recordExecutionUsage",
    "resumeExecutionRun", "factoryErrorCode",
    "runEffortFactory", "recordEffortFactoryReceipt", "waitForEffortRun", "resumeEffortRun", "getEffortRun", "observeEffortRun",
    "recordRejectedFactoryLaunch",
    "trackExecution", "startImplementationFactory", "recoverExecutionFactory", "recoverImplementationFactory",
    "hasExecutionIdentity", "failLegacyExecutions",
    "testEvent", "markTestResultsStale", "testScenarioPrompt", "prepareTestWave", "recordTestWaveResults",
    "testResultsArtifact", "testFailureEnvelope", "testRunErrorDetails", "settleTestRun",
    "runTestFactory", "startTestFactory", "recoverTestFactory",
    "submitImplementationStart", "submitImplementationStop", "submitTestStart", "submitTestStop", "submitExecutionStop",
    "reopenLifecycleStage", "applyCanvasReset", "updateTandem", "completeLifecycleStage",
];
let compiled: Promise<string> | undefined;
async function compileHarness() {
    const lines = (await readFile(join("src", "extension.ts"), "utf8")).split(/\r?\n/);
    const extract = (name: string, constant = false) => {
        const start = lines.findIndex((line) => constant ? line.startsWith(`const ${name} =`)
            : new RegExp(`^(async )?function ${name}[<(]`).test(line));
        const end = lines.findIndex((line, index) => index > start && (constant ? /^}\);$|^};$/.test(line) : line === "}"));
        assert.ok(start >= 0 && end > start, `Cannot extract ${name}`);
        return lines.slice(start, end + 1).join("\n");
    };
    const code = `
        import { randomUUID } from "node:crypto";
        import { dirname, relative } from "node:path";
        import { mkdir } from "node:fs/promises";
        import { assertFactoryRequestEnvelope, rejectedFactoryLaunch, jsonResult } from "./agent-runner.js";
        import { executionGraph, ownershipConflicts, ownershipContains, ownershipPath } from "./scheduling.js";
        import { hasActiveWork, hasUnconfirmedExecution, sameOwner, invalidateArtifacts, lifecycleStages, reopenTestLifecycle } from "./workflow.js";
        import { normalizeProcessState, processEvent, currentAcceptances } from "./process-state.js";
        import { normalizeExecutionProof, hasCurrentEvidence, verificationCompletionError } from "./execution-proof.js";
        import { buildWorkerContract, contractInstruction, assertContractSkillsCurrent,
            captureWorkspaceFiles, assertChangedPathsOwned } from "./worker-contracts.js";
        import { runVerificationCheck, evidenceSummary } from "./verification.js";
        import {
            assertExecutionRequest, assertExecutionSources, executionDigest, executionToken,
            executionWorkspace, ExecutionCancellationPendingError, ExecutionSourceChangedError, ExecutionSupersededError,
            fingerprintWorkspace, newExecution, normalizeExecutionFields, workerOutcome
        } from "./execution.js";
        const IMPLEMENTATION_FACTORY_NAME = "implementation-fixture", TEST_FACTORY_NAME = "test-fixture";
        const readFixtureState = globalThis.loadState;
        const loadState = async () => JSON.parse(JSON.stringify(await readFixtureState()));
        const activeImplementationRuns = new Map(), activeTestRuns = new Map();
        const LIFECYCLE_STAGES = lifecycleStages;
        const defineFactory = value => value;
        function normalizeDesignReview(value) { return { ...value, scenarios: normalizeTestScenarios(value?.scenarios) }; }
        function normalizeArtifacts(value) { return value; }
        function normalizeLifecycle(value) { return value; }
        function stageCompletionError(value) { return value.testing.status === "completed" ? null : "Tests have not passed."; }
        function seedDefaultDesignReview(value) { return value; }
        class AnswerRequestError extends Error { constructor(statusCode, message) { super(message); this.statusCode = statusCode; } }
        class CanvasError extends Error { constructor(code, message) { super(message); this.code = code; } }
        ${functions.map((name) => extract(name)).join("\n")}
        ${["executionValidationSchema", "implementationAgentOutputSchema", "testAgentOutputSchema",
            "testScenarioSchema", "implementationFactory", "testFactory"].map((name) => extract(name, true)).join("\n")}
        module.exports = { ${functions.join(",")}, implementationFactory, testFactory, loadState,
            async drain() { await Promise.all([...activeImplementationRuns.values(), ...activeTestRuns.values()]); } };
    `;
    const result = await build({
        stdin: { contents: code, loader: "ts", resolveDir: resolve("src") },
        platform: "node", format: "cjs", target: "node20", bundle: true, write: false, logLevel: "silent",
        external: ["proper-lockfile"],
    });
    return result.outputFiles[0].text;
}

async function fixture() {
    const root = resolve("tests", `.execution-fixture-${randomUUID()}`);
    await mkdir(root, { recursive: true });
    const requests: any[] = [];
    const resumes: string[] = [];
    const session = {
        sessionId: "fixture-session",
        rpc: { factory: { run: async (request: any) => {
            requests.push(request);
            return { runId: "sdk-run", status: "halted" };
        } } },
        factory: {
            getRun: async (runId: string) => ({ runId, status: "completed" }),
            getRunDetail: async (runId: string) => ({ runId, consumed: { activeMs: 10, nanoAiu: 1000 }, agents: [] }),
            waitForRun: async (runId: string) => ({ runId, status: "completed", result: { status: "completed" } }),
            resume: async (runId: string) => { resumes.push(runId); return { runId, status: "completed", result: { status: "completed" } }; },
            cancel: async (runId: string) => ({ runId, status: "cancelled" }),
        },
    };
    let state: any;
    let lock = Promise.resolve();
    const module = { exports: {} as any };
    const errors: string[] = [];
    const responses: { status: number; body: any }[] = [];
    const sandbox = {
        module, exports: module.exports, require: createRequire(import.meta.url), process, Buffer, AbortController,
        TextDecoder, setTimeout, clearTimeout,
        WORKSPACE_ROOT: root, SHARED_PROJECT_ROOT: root, session,
        isFactoryRunTerminal: (status: string) => ["completed", "error", "cancelled", "halted"].includes(status),
        loadState: async () => structuredClone(state),
        persistState: async (next: any) => { state = structuredClone({ ...next, revision: (state?.revision || 0) + 1,
            jobOwner: hasActiveWork(next) ? next.jobOwner || { sessionId: session.sessionId, workspaceRoot: root } : null }); },
        withAnswerClaim: async (_id: string, operation: () => Promise<any>) => {
            const previous = lock;
            let release!: () => void;
            lock = new Promise<void>((done) => { release = done; });
            await previous;
            try { return await operation(); } finally { release(); }
        },
        publishState: () => {},
        isPreferredAnswerProvider: async () => true,
        sendJson: (_res: any, status: number, body: any) => {
            responses.push({ status, body });
            if (status >= 400) errors.push(body.error);
        },
        publicState: (_entry: any, value: any) => value,
        logSafely: async (message: string) => { errors.push(message); },
        factoryErrorMessage: (run: any) => run.error || run.status,
        resolvePrototypeId: async (_instanceId: string, id: string) => id || "fixture",
        createState: () => ({
            ...structuredClone(state), generation: randomUUID(),
            implementation: module.exports.normalizeImplementation({}, state.planning),
            testing: module.exports.normalizeTesting({}, state.testDesignReview),
        }),
        projectStore: { stagePath: (_id: string, stage: string, revision: number) => join(root, ".tandem", `${stage}-${revision}.json`) },
        writeJsonAtomically: async (path: string, value: unknown) => writeFile(path, JSON.stringify(value)),
    };
    try {
        runInNewContext(await (compiled ??= compileHarness()), sandbox);
    } catch (error) {
        await rm(root, { recursive: true, force: true });
        throw error;
    }
    const api = module.exports;
    function initialize(items = [work("a")], scenarios = [scenario("a")], testing = false) {
        state = {
            prototypeId: "fixture", generation: "generation-1", revision: 1, jobOwner: null, artifacts: [],
            prototypeApproach: { mode: "build", reason: "Validate the interface" },
            stage: testing ? "test" : "implement",
            lifecycle: {
                currentStage: testing ? "test" : "implement",
                completedStages: ["prepare", "requirements", "prototype", "design", "plan", ...(testing ? ["implement"] : [])],
                skippedStages: [], outputs: [], history: [],
            },
            planning: api.normalizePlanning({ status: "complete", finalizedArtifactId: "execution-plan", maxAgents: 2, workItems: items }),
            testDesignReview: { finalizedArtifactId: "test-spec", scenarios },
        };
        state.implementation = api.normalizeImplementation({}, state.planning);
        state.testing = api.normalizeTesting({}, state.testDesignReview);
    }
    function start(kind = "implementation", sourceFingerprint: string | null = null) {
        state[kind] = {
            ...state[kind], ...newExecution(api.executionInputRevision(state, kind), root, session.sessionId, sourceFingerprint),
            status: "starting", waveManifests: [],
        };
        return { ...executionToken(state[kind]), runId: "sdk-run" };
    }
    function context(kind = "implementation") {
        const journal = new Map<string, any>(), calls: string[] = [];
        const ctx: any = {
            runId: "sdk-run", signal: new AbortController().signal,
            args: { prototypeId: "fixture", projectRoot: root, execution: executionToken(state[kind]),
                plan: state.planning, scenarios: state.testDesignReview.scenarios },
            phase: () => {}, log: () => {},
            parallel: async (thunks: (() => Promise<any>)[]) => {
                const results = [];
                for (const thunk of thunks) results.push(await thunk());
                return results;
            },
            agent: async (_prompt: string, options: any) => {
                assert.equal(state[kind].runId, ctx.runId, "run ID must be bound before dispatch");
                calls.push(options.label);
                return outcome(options.label, kind === "testing");
            },
            step: async (key: string, producer: () => Promise<any>) => {
                if (!journal.has(key)) journal.set(key, await producer());
                return structuredClone(journal.get(key));
            },
        };
        return { ctx, journal, calls };
    }
    return { api, root, session, requests, resumes, errors, responses, initialize, start, context,
        get state() { return state; }, set state(value) { state = value; },
        close: () => rm(root, { recursive: true, force: true }) };
}

const work = (id: string, dependencies: string[] = [], files = [`${id}.ts`]) => ({
    id, title: id, description: `Implement ${id}`, dependencies, files, estimatedHours: 1,
    acceptanceCriteria: ["Observable result"], validation: ["check"],
});
const scenario = (id: string, dependencies: string[] = []) => ({
    id, title: id, description: `Exercise ${id}`, dependencies, type: "interaction",
    steps: ["Exercise the feature"], expectedOutcome: "Observable result", validation: ["check"],
});
const outcome = (summary: string, testing = false) => ({
    status: testing ? "passed" : "completed", summary, filesChanged: [], blockers: [],
    evidence: ["Observed expected outcome"],
    validation: [{ requirement: "check", status: "passed", evidence: "Command exited 0; expected output observed" }],
});

test("a delayed halted-run continuation cannot resume workers after their effort was reset", async () => {
    const f = await fixture();
    try {
        f.initialize();
        const token = f.start();
        await f.api.bindExecutionRun("fixture", "implementation", token);
        f.state = { ...f.state, generation: "replacement-generation", stage: "prepare",
            lifecycle: { ...f.state.lifecycle, currentStage: "prepare" },
            implementation: f.api.normalizeImplementation({}, f.state.planning), factoryRuns: [] };
        await assert.rejects(f.api.resumeEffortRun("fixture", token.runId), /no longer owns/);
        assert.equal(f.resumes.length, 0);
        assert.equal(f.state.generation, "replacement-generation");
    } finally { await f.close(); }
});

test("final factory persists real command evidence and fences changed verification inputs", async () => {
    const f = await fixture();
    try {
        f.initialize([work("a")], [scenario("a")], true);
        f.state.process = createProcessState();
        const profile = {
            enabled: true, independentReview: false, protectedPaths: [],
            checks: [{ id: "observed", program: "node", args: ["-e", "console.log('observed')"],
                stage: "test", afterWorkItems: [], timeoutSeconds: 10 }],
        };
        f.state.process.settings.verification = structuredClone(profile);
        f.state.testing.verificationProfile = structuredClone(profile);
        const token = f.start("testing", await fingerprintWorkspace(f.root));
        const { ctx } = f.context("testing");
        const result = await f.api.testFactory.run(ctx);
        assert.equal(result.status, "passed");
        assert.equal(f.state.testing.commandEvidence.length, 1);
        assert.equal(f.state.testing.commandEvidence[0].exitCode, 0);
        assert.match(f.state.testing.commandEvidence[0].output, /observed/);
        await f.api.settleTestRun("fixture", { runId: "sdk-run", status: "completed", result }, { ...token, runId: "sdk-run" });
        await f.api.assertCurrentTestEvidence(await f.api.loadState());
        f.state.process.settings.verification.checks[0].args = ["--version"];
        await assert.rejects(f.api.assertCurrentTestEvidence(await f.api.loadState()), /does not match/);
    } finally { await f.close(); }
});

test("an independent verifier finding rejects otherwise passing scenarios", async () => {
    const f = await fixture();
    try {
        f.initialize([work("a")], [scenario("a")], true);
        f.state.process = createProcessState();
        const profile = {
            enabled: true, independentReview: true, protectedPaths: [],
            checks: [{ id: "observed", program: "node", args: ["--version"], stage: "test", afterWorkItems: [], timeoutSeconds: 10 }],
        };
        f.state.process.settings.verification = structuredClone(profile);
        f.state.testing.verificationProfile = structuredClone(profile);
        f.start("testing", await fingerprintWorkspace(f.root));
        const { ctx } = f.context("testing");
        const original = ctx.agent;
        ctx.agent = (prompt, options) => options.label === "acceptance:independent"
            ? { status: "passed", summary: "A requirement is still missing.", findings: ["Missing failure flow."] }
            : original(prompt, options);
        await assert.rejects(f.api.testFactory.run(ctx), /Independent acceptance verification failed/);
        assert.equal(f.state.testing.independentVerdict.status, "failed");
    } finally { await f.close(); }
});

test("protected regression files cannot be weakened after the execution baseline", async () => {
    const f = await fixture();
    try {
        await writeFile(join(f.root, "regression.ts"), "assert.strictEqual(actual, expected);");
        const protectedSources = f.api.protectedSourceFiles(await captureWorkspaceFiles(f.root), ["regression.ts"]);
        const runtime = { verificationProfile: { enabled: true, protectedPaths: ["regression.ts"] }, protectedSources };
        await f.api.assertProtectedSources(runtime);
        await writeFile(join(f.root, "regression.ts"), "// assertion removed");
        await assert.rejects(f.api.assertProtectedSources(runtime), /Protected acceptance files changed/);
    } finally { await f.close(); }
});

test("implementation settlement rejects commands observed before the final source changes", async () => {
    const f = await fixture();
    try {
        f.initialize();
        f.state.process = createProcessState();
        const profile = {
            enabled: true, independentReview: false, protectedPaths: [],
            checks: [
                { id: "build", program: "node", args: ["--version"], stage: "implementation", afterWorkItems: [], timeoutSeconds: 10 },
                { id: "test", program: "node", args: ["--version"], stage: "test", afterWorkItems: [], timeoutSeconds: 10 },
            ],
        };
        f.state.process.settings.verification = structuredClone(profile);
        f.state.implementation.verificationProfile = structuredClone(profile);
        const token = f.start();
        const result = await f.api.implementationFactory.run(f.context().ctx);
        assert.equal(result.status, "completed");
        assert.equal(f.state.implementation.commandEvidence.length, 1);
        await writeFile(join(f.root, "a.ts"), "changed after verification");
        await f.api.settleImplementationRun("fixture", { runId: "sdk-run", status: "completed", result }, token);
        assert.equal(f.state.implementation.status, "failed");
        assert.match(f.state.implementation.error, /no passing tool-backed evidence/);
    } finally { await f.close(); }
});

test("completed implementation evidence is fenced against subsequent source edits", async () => {
    const f = await fixture();
    try {
        f.initialize();
        f.state.process = createProcessState();
        const profile = {
            enabled: true, independentReview: false, protectedPaths: [],
            checks: [{ id: "test", program: "node", args: ["--version"], stage: "test", afterWorkItems: [], timeoutSeconds: 10 }],
        };
        f.state.process.settings.verification = structuredClone(profile);
        f.state.implementation.verificationProfile = structuredClone(profile);
        const token = f.start();
        const result = await f.api.implementationFactory.run(f.context().ctx);
        await f.api.settleImplementationRun("fixture", { runId: "sdk-run", status: "completed", result }, token);
        assert.equal(f.state.implementation.status, "completed");
        await f.api.assertCurrentImplementationEvidence(await f.api.loadState());
        await writeFile(join(f.root, "a.ts"), "changed after completion");
        await assert.rejects(f.api.assertCurrentImplementationEvidence(await f.api.loadState()), /does not match/);
    } finally { await f.close(); }
});

test("changing verification commands does not silently replace a protected source baseline", async () => {
    const f = await fixture();
    try {
        f.initialize();
        f.state.process = createProcessState();
        await writeFile(join(f.root, "regression.ts"), "original regression check");
        const profile = {
            enabled: true, independentReview: false, protectedPaths: ["regression.ts"],
            checks: [{ id: "test", program: "node", args: ["--version"], stage: "test", afterWorkItems: [], timeoutSeconds: 10 }],
        };
        f.state.process.settings.verification = structuredClone(profile);
        f.state.implementation.verificationProfile = structuredClone(profile);
        f.state.implementation.protectedSources = f.api.protectedSourceFiles(await captureWorkspaceFiles(f.root), profile.protectedPaths);
        f.start();
        f.state.implementation.status = "failed";
        f.state.implementation.terminalConfirmedAt = new Date().toISOString();
        f.state.implementation.launchState = "settled";
        f.state.process.settings.verification.checks[0].timeoutSeconds = 20;
        await writeFile(join(f.root, "regression.ts"), "weakened regression check");
        await assert.rejects(f.api.submitImplementationStart({ prototypeId: "fixture" }, undefined), /Protected acceptance files changed/);
        assert.equal(f.requests.length, 0);
    } finally { await f.close(); }
});

test("actual unowned edits fail a wave even when the worker omits them from its report", async () => {
    const f = await fixture();
    try {
        f.initialize();
        f.start();
        const { ctx } = f.context();
        ctx.agent = async () => {
            await writeFile(join(f.root, "outside.ts"), "unreported edit");
            return outcome("Claims only owned changes");
        };
        await assert.rejects(f.api.implementationFactory.run(ctx), /outside the wave-owned scopes/);
        assert.equal(f.state.implementation.workItems[0].status, "failed");
    } finally { await f.close(); }
});

test("execution graphs normalize both ends and reject collisions, missing references, and cycles", () => {
    assert.equal(executionGraph([work("Setup"), work("Feature", ["Setup"])])[1].dependencies[0], "setup");
    assert.throws(() => executionGraph([work("A"), work("a")]), /collide/);
    assert.throws(() => executionGraph([work("a", ["missing"])]), /Invalid dependency/);
    assert.throws(() => executionGraph([work("a", ["b"]), work("b", ["a"])]), /cycle/);
    assert.throws(() => executionGraph(Array.from({ length: 31 }, (_, i) => work(`a${i}`))), /at most 30/);
});

test("Windows ownership includes aliases, directory descendants, unknown scopes, and wildcards", () => {
    for (const [left, right] of [
        [["SRC\\Widget.ts"], ["src/widget.ts"]],
        [["src\\feature"], ["src\\feature\\view.ts"]],
        [[".\\src\\a.ts"], ["src\\a.ts"]],
        [["src\\a.ts. "], ["src\\a.ts"]],
        [[], ["src\\a.ts"]],
        [["src\\*.ts"], ["other\\b.ts"]],
    ]) assert.equal(ownershipConflicts(left, right), true);
    assert.equal(ownershipConflicts(["src\\a.ts"], ["src\\b.ts"]), false);
    assert.throws(() => ownershipConflicts(["..\\escape.ts"], ["a.ts"]), /escape/);
});

test("actual schedulers preserve dependency edges and serialize unsafe scopes", async () => {
    const f = await fixture();
    try {
        const plan = f.api.normalizePlanning({ maxAgents: 2, workItems: [work("Setup"), work("Feature", ["Setup"])] });
        assert.deepEqual(Array.from(plan.waves, (wave: any) => Array.from(wave.workItemIds)), [["setup"], ["feature"]]);
        const overlapping = f.api.normalizePlanning({ maxAgents: 2,
            workItems: [work("a", [], ["src"]), work("b", [], ["src\\b.ts"])] });
        assert.equal(overlapping.waves.length, 2);
        const tests = f.api.normalizeTestScenarios([scenario("Setup"), scenario("Feature", ["Setup"])]);
        assert.equal(tests[1].dependencies[0], "setup");
    } finally { await f.close(); }
});

test("worker status alone cannot pass validation or conceal blockers", () => {
    assert.equal(workerOutcome(outcome("Verified"), ["check"]).status, "completed");
    for (const invalid of [
        { ...outcome(""), summary: "" }, { ...outcome("Done"), blockers: ["Build unavailable"] },
        { ...outcome("Done"), validation: [] },
        { ...outcome("Done"), validation: [{ requirement: "check", status: "skipped", evidence: "Not executed" }] },
        { ...outcome("Done", true), evidence: [] },
    ]) assert.equal(workerOutcome(invalid, ["check"], invalid.status === "passed").status, "failed");
});

test("source fingerprints cover dirty and untracked files but exclude generated state and output", async () => {
    const f = await fixture();
    try {
        await writeFile(join(f.root, "source.ts"), "one");
        const initial = await fingerprintWorkspace(f.root);
        for (const dir of [".tandem", ".git", "node_modules", "dist", "generated"]) {
            await mkdir(join(f.root, dir));
            await writeFile(join(f.root, dir, "ignored"), "anything");
        }
        assert.equal(await fingerprintWorkspace(f.root), initial);
        await writeFile(join(f.root, "source.ts"), "two");
        const dirty = await fingerprintWorkspace(f.root);
        assert.notEqual(dirty, initial);
        await writeFile(join(f.root, "untracked.ts"), "new source");
        assert.notEqual(await fingerprintWorkspace(f.root), dirty);
        const beforeBuildSource = await fingerprintWorkspace(f.root);
        await mkdir(join(f.root, "src", "build"), { recursive: true });
        await writeFile(join(f.root, "src", "build", "compiler.ts"), "real source, not generated output");
        assert.notEqual(await fingerprintWorkspace(f.root), beforeBuildSource);
    } finally { await f.close(); }
});

test("all durable identity fields participate in execution guards", () => {
    const token = { ...newExecution("revision", process.cwd(), "owner"), runId: "run" };
    assert.doesNotThrow(() => assertExecutionRequest(token, token, "revision", process.cwd(), "owner"));
    for (const key of ["requestId", "inputRevision", "ownerSessionId", "workspaceRoot", "runId", "sourceFingerprint"]) {
        assert.throws(() => assertExecutionRequest({ ...token, [key]: "different" }, token,
            "revision", process.cwd(), "owner"), /no longer active/);
    }
    assert.throws(() => assertExecutionRequest({ ...token, runId: null }, token,
        "revision", process.cwd(), "owner"), /no longer active/);
});

test("implementation recovery freezes a wave and replays work by ID, not changing batch positions", async () => {
    const f = await fixture();
    try {
        f.initialize([work("a"), work("b"), work("c", ["a", "b"])]);
        f.start();
        f.state.implementation.strategySuggestions = [{ id: "serial", text: "serial", status: "applied" }];
        const { ctx, calls, journal } = f.context();
        const step = ctx.step;
        let interrupted = false;
        ctx.step = async (key: string, producer: () => Promise<any>) => {
            const result = await step(key, producer);
            if (!interrupted) { interrupted = true; throw new Error("Simulated provider disconnect after journaling"); }
            return result;
        };
        await assert.rejects(f.api.implementationFactory.run(ctx), /disconnect/);
        f.state.implementation.strategySuggestions.push({ id: "priority", text: "prioritize b", status: "queued" });
        const resumed = await f.api.implementationFactory.run(ctx);
        assert.equal(resumed.status, "completed");
        assert.deepEqual(calls, ["work:a", "work:b", "work:c"]);
        assert.deepEqual(f.state.implementation.workItems.map((item: any) => item.summary), ["work:a", "work:b", "work:c"]);
        assert.deepEqual(f.state.implementation.waveManifests[0].itemIds, ["a", "b"]);
        assert.equal(f.state.implementation.strategySuggestions[1].waveIndex, 2);
        assert.ok([...journal.keys()].every((key) => key.includes(":item:")));
    } finally { await f.close(); }
});

test("test recovery uses immutable per-scenario journals and observed evidence", async () => {
    const f = await fixture();
    try {
        f.initialize(undefined, [scenario("a"), scenario("b")], true);
        f.start("testing", await fingerprintWorkspace(f.root));
        const { ctx, calls, journal } = f.context("testing");
        const step = ctx.step;
        let interrupted = false;
        ctx.step = async (key: string, producer: () => Promise<any>) => {
            const value = await step(key, producer);
            if (!interrupted) { interrupted = true; throw new Error("Simulated disconnect"); }
            return value;
        };
        await assert.rejects(f.api.testFactory.run(ctx), /disconnect/);
        const result = await f.api.testFactory.run(ctx);
        assert.equal(result.status, "passed");
        assert.deepEqual(calls, ["test:a", "test:b"]);
        assert.ok([...journal.keys()].every((key) => key.includes(":scenario:")));
    } finally { await f.close(); }
});

test("reset, cancellation, replanning and foreign owners reject all old implementation callbacks", async () => {
    const f = await fixture();
    try {
        for (const mutate of [
            () => { f.state.implementation.status = "cancelled"; },
            () => { f.state.implementation = f.api.normalizeImplementation({}, f.state.planning); },
            () => { f.state.planning.workItems[0].description = "Replacement requirements"; },
            () => { f.state.implementation.runId = "replacement-run"; },
            () => { f.state.implementation.ownerSessionId = "other-session"; },
            () => { f.state.lifecycle.currentStage = "plan"; },
        ]) {
            f.initialize();
            const token = f.start();
            await f.api.prepareImplementationWave("fixture", 1, ["a"], token);
            mutate();
            const before = executionDigest(f.state);
            await assert.rejects(f.api.prepareImplementationWave("fixture", 1, ["a"], token), /no longer active/);
            await assert.rejects(f.api.recordImplementationWaveResults("fixture", 1, [{ itemId: "a", result: outcome("Old") }], token), /no longer active/);
            await assert.rejects(f.api.settleImplementationRun("fixture", { runId: token.runId, status: "completed", result: { status: "completed" } }, token), /no longer active/);
            assert.equal(executionDigest(f.state), before);
        }
    } finally { await f.close(); }
});

test("a result cannot claim an item absent from its persisted manifest", async () => {
    const f = await fixture();
    try {
        f.initialize([work("a"), work("b", ["a"])]);
        const token = f.start();
        await f.api.prepareImplementationWave("fixture", 1, ["a"], token);
        await assert.rejects(f.api.recordImplementationWaveResults("fixture", 1,
            [{ itemId: "b", result: outcome("Wrong item") }], token), /dispatched wave/);
    } finally { await f.close(); }
});

test("implementation results report ownership violations and reject unsupported completion evidence", async () => {
    const f = await fixture();
    try {
        for (const result of [
            { ...outcome("Outside change"), filesChanged: ["other.ts"] },
            { ...outcome("No validation"), validation: [] },
            { ...outcome("Blocked"), blockers: ["Cannot build"] },
        ]) {
            f.initialize();
            const token = f.start();
            await f.api.prepareImplementationWave("fixture", 1, ["a"], token);
            await f.api.recordImplementationWaveResults("fixture", 1, [{ itemId: "a", result }], token);
            await f.api.settleImplementationRun("fixture",
                { runId: token.runId, status: "completed", result: { status: "completed" } }, token);
            assert.equal(f.state.implementation.status, "failed");
            assert.equal(f.state.implementation.finalizedArtifactId, null);
        }
    } finally { await f.close(); }
});

test("replacement test requests and specification changes fence every obsolete callback", async () => {
    const f = await fixture();
    try {
        for (const mutate of [
            () => { f.state.testing = f.api.normalizeTesting({}, f.state.testDesignReview); },
            () => { f.state.testing.requestId = "replacement-request"; },
            () => { f.state.testDesignReview.scenarios[0].expectedOutcome = "Replacement"; },
            () => { f.state.testing.workspaceRoot = resolve(f.root, "different"); },
            () => { f.state.testing.status = "failed"; },
        ]) {
            f.initialize(undefined, undefined, true);
            const token = f.start("testing", await fingerprintWorkspace(f.root));
            const wave = { index: 1, scenarioIds: ["a"] };
            await f.api.prepareTestWave("fixture", wave, token);
            mutate();
            const before = executionDigest(f.state);
            await assert.rejects(f.api.prepareTestWave("fixture", wave, token), /no longer active/);
            await assert.rejects(f.api.recordTestWaveResults("fixture", wave,
                [{ itemId: "a", result: outcome("Old pass", true) }], token), /no longer active/);
            await assert.rejects(f.api.settleTestRun("fixture",
                { runId: token.runId, status: "completed", result: { status: "passed" } }, token), /no longer active/);
            assert.equal(executionDigest(f.state), before);
        }
    } finally { await f.close(); }
});

test("source changes reject test results and invalidate earlier passes on retry", async () => {
    const f = await fixture();
    try {
        f.initialize(undefined, [scenario("a"), scenario("b")], true);
        const token = f.start("testing", await fingerprintWorkspace(f.root));
        const wave = { index: 1, scenarioIds: ["a", "b"] };
        await f.api.prepareTestWave("fixture", wave, token);
        await f.api.recordTestWaveResults("fixture", wave, [{ itemId: "a", result: outcome("Old pass", true) }], token);
        await writeFile(join(f.root, "changed.ts"), "new source breaks a");
        await assert.rejects(f.api.recordTestWaveResults("fixture", wave,
            [{ itemId: "b", result: outcome("New pass", true) }], token), /sources changed/);
        await assert.rejects(f.api.settleTestRun("fixture",
            { runId: token.runId, status: "completed", result: { status: "passed" } }, token), /sources changed/);
        f.state.testing.status = "failed";
        f.state.testing.terminalConfirmedAt = new Date().toISOString();
        await f.api.submitTestStart({ prototypeId: "fixture" }, {});
        await f.api.drain();
        assert.ok(f.state.testing.scenarios.every((item: any) => item.status === "pending"));
        assert.notEqual(f.state.testing.sourceFingerprint, token.sourceFingerprint);
    } finally { await f.close(); }
});

test("test retry preserves passes only for identical sources and specification", async () => {
    const f = await fixture();
    try {
        f.initialize(undefined, [scenario("a"), scenario("b")], true);
        const token = f.start("testing", await fingerprintWorkspace(f.root));
        await f.api.prepareTestWave("fixture", { index: 1, scenarioIds: ["a", "b"] }, token);
        await f.api.recordTestWaveResults("fixture", { index: 1 },
            [{ itemId: "a", result: outcome("Valid pass", true) }], token);
        f.state.testing.status = "failed";
        f.state.testing.terminalConfirmedAt = new Date().toISOString();
        f.state.testing.errorDetails = "Previous failed run details";
        await f.api.submitTestStart({ prototypeId: "fixture" }, {});
        await f.api.drain();
        assert.equal(f.state.testing.scenarios[0].status, "passed");
        assert.equal(f.state.testing.errorDetails, "");
        f.state.testing.status = "failed";
        f.state.testing.terminalConfirmedAt = new Date().toISOString();
        f.state.testDesignReview.scenarios[0].expectedOutcome = "New specification";
        await f.api.submitTestStart({ prototypeId: "fixture" }, {});
        await f.api.drain();
        assert.ok(f.state.testing.scenarios.every((item: any) => item.status === "pending"));
    } finally { await f.close(); }
});

test("factory run ID is persisted from ctx before a fast start response and finalization", async () => {
    const f = await fixture();
    try {
        f.initialize();
        f.start();
        f.session.rpc.factory.run = async (request: any) => {
            f.requests.push(request);
            const { ctx } = f.context();
            ctx.args = request.args;
            const result = await f.api.implementationFactory.run(ctx);
            return { runId: ctx.runId, status: "completed", result } as any;
        };
        await f.api.runImplementationFactory("fixture", structuredClone(f.state));
        assert.equal(f.state.implementation.status, "completed");
        assert.equal(f.state.implementation.runId, "sdk-run");
        assert.equal(f.state.implementation.finalizedArtifactId, "final-code");
        assert.equal(f.requests.length, 1);
    } finally { await f.close(); }
});

test("a late start response is cancelled and cannot claim a replacement request", async () => {
    const f = await fixture();
    try {
        f.initialize();
        f.start();
        const original = structuredClone(f.state);
        const cancelled: string[] = [];
        f.session.factory.cancel = async (runId: string) => {
            cancelled.push(runId);
            return { runId, status: "cancelled" };
        };
        f.session.rpc.factory.run = async () => {
            f.state.implementation = f.api.normalizeImplementation({}, f.state.planning);
            f.state.lifecycle.currentStage = "plan";
            return { runId: "obsolete-sdk-run", status: "running" };
        };
        await assert.rejects(f.api.runImplementationFactory("fixture", original), /no longer active/);
        assert.deepEqual(cancelled, ["obsolete-sdk-run"]);
        assert.equal(f.state.implementation.status, "idle");
        assert.equal(f.state.implementation.runId, null);
    } finally { await f.close(); }
});

test("halted recovery uses SDK resume, while missing/unknown runs never auto-dispatch duplicates", async () => {
    const f = await fixture();
    try {
        f.initialize();
        const token = f.start();
        await f.api.implementationFactory.run(f.context().ctx);
        f.session.factory.getRun = async (runId: string) => ({ runId, status: "halted" });
        f.api.recoverImplementationFactory(structuredClone(f.state), true);
        await f.api.drain();
        assert.deepEqual(f.resumes, [token.runId]);
        assert.equal(f.requests.length, 0);
        for (const unknownId of [null, "unknown-run"]) {
            f.initialize();
            f.start();
            f.state.implementation.runId = unknownId;
            f.session.factory.getRun = async () => { throw new Error("SDK run not found"); };
            f.api.recoverImplementationFactory(structuredClone(f.state), true);
            await f.api.drain();
            assert.equal(f.state.implementation.status, unknownId ? "running" : "failed");
            assert.match(f.state.implementation.error, /no durable SDK run ID|not found/);
            if (unknownId) assert.ok(f.state.implementation.cancellation && hasActiveWork(f.state));
            assert.equal(f.requests.length, 0);
        }
    } finally { await f.close(); }
});

test("concurrent recovery observes an already-active resume instead of cancelling it", async () => {
    const f = await fixture();
    try {
        f.initialize();
        f.start();
        await f.api.implementationFactory.run(f.context().ctx);
        let reads = 0;
        f.session.factory.getRun = async (runId: string) => ({ runId, status: reads++ === 0 ? "halted" : "running" });
        f.session.factory.resume = async () => { throw Object.assign(new Error("Already resumed"), { code: "already_active" }); };
        f.session.factory.cancel = async () => { assert.fail("An existing resume must not be cancelled"); };
        f.api.recoverImplementationFactory(structuredClone(f.state), true);
        await f.api.drain();
        assert.equal(f.state.implementation.status, "completed");
        assert.equal(f.requests.length, 0);
        assert.equal(f.errors.length, 0);
    } finally { await f.close(); }
});

test("ownerless legacy executions become visibly failed without dispatch or ownership takeover", async () => {
    const f = await fixture();
    try {
        for (const kind of ["implementation", "testing"]) {
            f.initialize(undefined, undefined, kind === "testing");
            f.state.jobOwner = null;
            f.state[kind].status = "running";
            const items = kind === "implementation" ? f.state[kind].workItems : f.state[kind].scenarios;
            items[0].status = "running";
            f.api.recoverExecutionFactory(structuredClone(f.state), true, kind);
            await f.api.drain();
            assert.equal(f.state[kind].status, "failed");
            assert.match(f.state[kind].error, /Legacy.*explicitly retry/);
            if (kind === "testing") {
                assert.match(JSON.parse(f.state.testing.errorDetails).summary, /Legacy testing/);
            }
            assert.equal(f.state.jobOwner, null);
            assert.equal(f.state[kind].requestId, null);
            assert.equal(f.requests.length, 0);
            assert.equal(f.resumes.length, 0);
        }
    } finally { await f.close(); }
});

test("legacy failure migration neither takes another owner's job nor overwrites a replacement", async () => {
    const f = await fixture();
    try {
        f.initialize();
        f.state.implementation.status = "running";
        f.state.jobOwner = { sessionId: "another-session", workspaceRoot: f.root };
        const foreign = executionDigest(f.state);
        await f.api.failLegacyExecutions(structuredClone(f.state));
        assert.equal(executionDigest(f.state), foreign);
        f.state.jobOwner = null;
        const old = structuredClone(f.state);
        f.start();
        const replaced = executionDigest(f.state);
        await f.api.failLegacyExecutions(old);
        assert.equal(executionDigest(f.state), replaced);
        assert.equal(f.requests.length, 0);
    } finally { await f.close(); }
});

test("legacy failure permits an explicit fresh retry but never starts it automatically", async () => {
    const f = await fixture();
    try {
        f.initialize();
        f.state.jobOwner = null;
        f.state.implementation.status = "running";
        f.api.recoverImplementationFactory(structuredClone(f.state), true);
        await f.api.drain();
        assert.equal(f.requests.length, 0);
        assert.equal(f.state.implementation.status, "failed");
        await f.api.submitImplementationStart({ prototypeId: "fixture" }, {});
        await f.api.drain();
        assert.equal(f.requests.length, 1);
        assert.ok(f.state.implementation.requestId);
        assert.equal(f.state.implementation.ownerSessionId, f.session.sessionId);
    } finally { await f.close(); }
});

test("Finish Test freshness guard rejects edits made after successful settlement", async () => {
    const f = await fixture();
    try {
        f.initialize(undefined, undefined, true);
        const token = f.start("testing", await fingerprintWorkspace(f.root));
        const result = await f.api.testFactory.run(f.context("testing").ctx);
        await f.api.settleTestRun("fixture", { runId: token.runId, status: "completed", result }, token);
        await f.api.assertCurrentTestEvidence(f.state);
        await writeFile(join(f.root, "later-edit.ts"), "changed after tests");
        await assert.rejects(f.api.assertCurrentTestEvidence(f.state), /sources changed/);
    } finally { await f.close(); }
});

test("explicitly starting a completed test run reruns every scenario", async () => {
    const f = await fixture();
    try {
        f.initialize(undefined, undefined, true);
        const token = f.start("testing", await fingerprintWorkspace(f.root));
        const result = await f.api.testFactory.run(f.context("testing").ctx);
        await f.api.settleTestRun("fixture", { runId: token.runId, status: "completed", result }, token);
        await f.api.submitTestStart({ prototypeId: "fixture" }, {});
        await f.api.drain();
        assert.equal(f.state.testing.scenarios[0].status, "pending");
        assert.notEqual(f.state.testing.requestId, token.requestId);
    } finally { await f.close(); }
});

test("merged test failure details retain SDK errors and interrupted scenarios", async () => {
    const f = await fixture();
    try {
        f.initialize(undefined, undefined, true);
        const token = f.start("testing", await fingerprintWorkspace(f.root));
        await f.api.prepareTestWave("fixture", { index: 1, scenarioIds: ["a"] }, token);
        await f.api.settleTestRun("fixture", {
            runId: token.runId, status: "error", error: "SDK connection interrupted",
            failure: { type: "connection_error", details: { transport: "stdio" } },
        }, token);
        const detail = JSON.parse(f.state.testing.errorDetails);
        assert.equal(detail.run.id, token.runId);
        assert.equal(detail.run.error, "SDK connection interrupted");
        assert.equal(detail.run.failure.details.transport, "stdio");
        assert.equal(detail.failedScenarios[0].id, "a");
        assert.equal(detail.failedScenarios[0].status, "failed");
        assert.equal(detail.failedAgents[0].scenarioId, "a");
    } finally { await f.close(); }
});

test("unexpected test orchestration failures persist fresh detailed diagnostics", async () => {
    const f = await fixture();
    try {
        f.initialize(undefined, undefined, true);
        const token = f.start("testing", await fingerprintWorkspace(f.root));
        await f.api.prepareTestWave("fixture", { index: 1, scenarioIds: ["a"] }, token);
        f.state.testing.errorDetails = "Obsolete diagnostics";
        const failure = Object.assign(new Error("Worker transport failed"), {
            code: "E_TEST_TRANSPORT", data: { stderr: "Protocol parse failed at frame 4" },
        });
        await f.api.recordExecutionFailure("fixture", "testing", token, failure);
        const detail = JSON.parse(f.state.testing.errorDetails);
        assert.match(detail.run.error, /Worker transport failed/);
        assert.equal(detail.run.failure.stderr, "Protocol parse failed at frame 4");
        assert.equal(detail.failedScenarios[0].id, "a");
        assert.equal(f.state.testing.status, "failed");
    } finally { await f.close(); }
});

test("execution settlement preserves Preparation decisions and skipped-stage history", async () => {
    const f = await fixture();
    try {
        f.initialize();
        f.state.prototypeApproach = { mode: "not-applicable", reason: "API-only implementation" };
        f.state.lifecycle.completedStages = ["prepare", "requirements", "design", "plan"];
        f.state.lifecycle.skippedStages = ["prototype"];
        f.state.lifecycle.history = [{ stageId: "prepare", path: "preparation-history.json", completedAt: "earlier" }];
        const lifecycle = structuredClone(f.state.lifecycle);
        const token = f.start();
        const result = await f.api.implementationFactory.run(f.context().ctx);
        await f.api.settleImplementationRun("fixture", { runId: token.runId, status: "completed", result }, token);
        assert.deepEqual(f.state.lifecycle, lifecycle);
        assert.equal(f.state.prototypeApproach.mode, "not-applicable");
        assert.equal(f.state.implementation.status, "completed");
    } finally { await f.close(); }
});

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
}

test("pending cancellation retains ownership and fences reset, reopen, dispatch and results for both kinds", async () => {
    for (const kind of ["implementation", "testing"] as const) {
        const f = await fixture();
        try {
            f.initialize(undefined, undefined, kind === "testing");
            const token = f.start(kind, kind === "testing" ? await fingerprintWorkspace(f.root) : null);
            if (kind === "implementation") await f.api.prepareImplementationWave("fixture", 1, ["a"], token);
            else await f.api.prepareTestWave("fixture", { index: 1, scenarioIds: ["a"] }, token);
            f.session.factory.getRun = async (runId: string) => ({ runId, status: "running" });
            const begun = deferred<void>();
            const termination = deferred<{ runId: string; status: string }>();
            f.session.factory.cancel = async (runId: string) => { begun.resolve(); return termination.promise; };
            const stopping = f.api.submitExecutionStop({ prototypeId: "fixture" }, {}, kind);
            await begun.promise;
            assert.equal(f.state[kind].status, "running");
            assert.equal(f.state[kind].runId, token.runId);
            assert.equal(f.state[kind].cancellation.confirmedAt, null);
            assert.equal(f.state.jobOwner.sessionId, f.session.sessionId);
            assert.equal(f.responses.length, 0, "Stop must not acknowledge termination while cancellation is pending");
            await assert.rejects(f.api.reopenLifecycleStage("fixture", "plan", "fixture"), /Finish or stop/);
            await assert.rejects(f.api.applyCanvasReset(f.state, { reset: true }, "reset-request", false, true), /Finish or stop/);
            await assert.rejects(f.api.updateTandem({ instanceId: "view", extensionId: "fixture",
                input: { prototypeId: "fixture", reset: true } }), /active Tandem/);
            await assert.rejects(f.api.assertExecutionDispatch("fixture", kind, token), /no longer active/);
            if (kind === "implementation") {
                await assert.rejects(f.api.recordImplementationWaveResults("fixture", 1,
                    [{ itemId: "a", result: outcome("late result") }], token), /no longer active/);
            } else {
                await assert.rejects(f.api.recordTestWaveResults("fixture", { index: 1 },
                    [{ itemId: "a", result: outcome("late result", true) }], token), /no longer active/);
            }
            termination.resolve({ runId: token.runId!, status: "cancelled" });
            await stopping;
            assert.equal(f.responses.at(-1)?.status, 200);
            assert.equal(f.responses.at(-1)?.body.stopped, true);
            assert.ok(f.state[kind].terminalConfirmedAt);
            assert.ok(f.state[kind].cancellation.confirmedAt);
            assert.equal(hasActiveWork(f.state), false);
            assert.equal(f.state.jobOwner, null);
            await f.api.reopenLifecycleStage("fixture", "plan", "fixture");
            assert.equal(f.state[kind].runId, null, "Only confirmed termination permits discarding the old identity");
        } finally { await f.close(); }
    }
});

test("failed or nonterminal SDK cancellation remains retryable without releasing ownership", async () => {
    for (const kind of ["implementation", "testing"] as const) {
        const f = await fixture();
        try {
            f.initialize(undefined, undefined, kind === "testing");
            const token = f.start(kind, kind === "testing" ? await fingerprintWorkspace(f.root) : null);
            await f.api.bindExecutionRun("fixture", kind, token);
            f.session.factory.getRun = async (runId: string) => ({ runId, status: "running" });
            f.session.factory.cancel = async () => { throw new Error("SDK cancellation unavailable"); };
            await f.api.submitExecutionStop({ prototypeId: "fixture" }, {}, kind);
            const cancellationId = f.state[kind].cancellation.requestId;
            assert.equal(f.responses.at(-1)?.status, 503);
            assert.equal(f.responses.at(-1)?.body.stopped, false);
            assert.match(f.state[kind].cancellation.error, /cancellation unavailable/);
            assert.equal(f.state[kind].status, "running");
            assert.equal(f.state.jobOwner.sessionId, f.session.sessionId);
            await assert.rejects(f.api.reopenLifecycleStage("fixture", "plan", "fixture"), /Finish or stop/);
            f.session.factory.cancel = async (runId: string) => ({ runId, status: "running" });
            await f.api.submitExecutionStop({ prototypeId: "fixture" }, {}, kind);
            assert.equal(f.responses.at(-1)?.status, 503);
            assert.equal(f.state[kind].cancellation.requestId, cancellationId);
            assert.equal(f.state[kind].terminalConfirmedAt, null);
            f.session.factory.cancel = async (runId: string) => ({ runId, status: "cancelled" });
            await f.api.submitExecutionStop({ prototypeId: "fixture" }, {}, kind);
            assert.equal(f.responses.at(-1)?.body.stopped, true);
            assert.equal(f.state[kind].cancellation.requestId, cancellationId);
            assert.equal(f.state.jobOwner, null);
        } finally { await f.close(); }
    }
});

test("late cancellation callbacks cannot stop or release a replacement request", async () => {
    for (const kind of ["implementation", "testing"] as const) {
        const f = await fixture();
        try {
            f.initialize(undefined, undefined, kind === "testing");
            const old = f.start(kind, kind === "testing" ? await fingerprintWorkspace(f.root) : null);
            await f.api.bindExecutionRun("fixture", kind, old);
            f.session.factory.getRun = async (runId: string) => ({ runId, status: "running" });
            const begun = deferred<void>(), finished = deferred<{ runId: string; status: string }>();
            const cancelled: string[] = [];
            f.session.factory.cancel = async (runId: string) => { cancelled.push(runId); begun.resolve(); return finished.promise; };
            const stop = f.api.submitExecutionStop({ prototypeId: "fixture" }, {}, kind);
            await begun.promise;
            f.initialize(undefined, undefined, kind === "testing");
            const replacement = { ...f.start(kind, kind === "testing" ? await fingerprintWorkspace(f.root) : null), runId: "new-sdk-run" };
            await f.api.bindExecutionRun("fixture", kind, replacement);
            const before = executionDigest(f.state);
            finished.resolve({ runId: old.runId!, status: "cancelled" });
            await stop;
            assert.equal(f.responses.at(-1)?.status, 409);
            assert.equal(executionDigest(f.state), before);
            assert.deepEqual(cancelled, [old.runId]);
            assert.equal(f.state[kind].runId, replacement.runId);
        } finally { await f.close(); }
    }
});

test("stop distinguishes an unlaunched request from an in-flight SDK launch without a run ID", async () => {
    const f = await fixture();
    try {
        f.initialize();
        f.start();
        const unlaunched = structuredClone(f.state);
        await f.api.submitImplementationStop({ prototypeId: "fixture" }, {});
        assert.equal(f.responses.at(-1)?.body.stopped, true);
        await assert.rejects(f.api.runImplementationFactory("fixture", unlaunched), /no longer active/);
        assert.equal(f.requests.length, 0);
        f.initialize();
        const token = f.start();
        f.state.implementation.launchState = "requested";
        await f.api.submitImplementationStop({ prototypeId: "fixture" }, {});
        assert.equal(f.responses.at(-1)?.status, 503);
        assert.equal(f.state.implementation.status, "running");
        assert.ok(f.state.jobOwner);
        await f.api.bindExecutionRun("fixture", "implementation", token);
        await assert.rejects(f.api.assertExecutionDispatch("fixture", "implementation", token), /no longer active/);
        await f.api.settleImplementationRun("fixture", { runId: token.runId, status: "error", error: "Dispatch cancelled" }, token);
        assert.equal(f.state.implementation.status, "cancelled");
        assert.ok(f.state.implementation.terminalConfirmedAt);
        assert.equal(f.state.jobOwner, null);
    } finally { await f.close(); }
});

test("legacy cancelled and interrupted known runs block destructive lifecycle boundaries", async () => {
    const f = await fixture();
    try {
        for (const status of ["cancelled", "failed"]) {
            f.initialize();
            f.state.implementation.status = status;
            f.state.implementation.runId = "legacy-sdk-run";
            assert.equal(hasActiveWork(f.state), true);
            await assert.rejects(f.api.reopenLifecycleStage("fixture", "plan", "fixture"), /Finish or stop/);
            await assert.rejects(f.api.applyCanvasReset(f.state, { reset: true }, "reset", false, true), /Finish or stop/);
            assert.throws(() => f.api.resetImplementationForPlan(f.state.planning, f.state.implementation), /Confirm termination/);
            assert.equal(f.state.implementation.runId, "legacy-sdk-run");
            assert.equal(f.state.jobOwner, null, "Blocking a legacy record must not take its ownership");
        }
    } finally { await f.close(); }
});

test("orchestration failure cannot release a live test run when compensating cancellation fails", async () => {
    const f = await fixture();
    try {
        f.initialize(undefined, undefined, true);
        const token = f.start("testing", await fingerprintWorkspace(f.root));
        await f.api.prepareTestWave("fixture", { index: 1, scenarioIds: ["a"] }, token);
        f.session.factory.getRun = async (runId: string) => ({ runId, status: "running" });
        f.session.factory.cancel = async () => { throw new Error("Transport cannot cancel"); };
        await assert.rejects(f.api.recordExecutionFailure("fixture", "testing", token,
            new Error("Result transport failed")), /Termination is unconfirmed/);
        assert.equal(f.state.testing.status, "running");
        assert.equal(f.state.testing.cancellation.outcome, "failed");
        assert.ok(f.state.jobOwner);
        assert.match(f.state.testing.errorDetails, /Result transport failed/);
        await assert.rejects(f.api.reopenLifecycleStage("fixture", "plan", "fixture"), /Finish or stop/);
        await f.api.submitTestStart({ prototypeId: "fixture" }, {});
        assert.equal(f.responses.at(-1)?.status, 409);
        f.session.factory.getRun = async (runId: string) => ({ runId, status: "error" });
        f.api.recoverTestFactory(structuredClone(f.state), true);
        await f.api.drain();
        assert.equal(f.state.testing.status, "failed");
        assert.ok(f.state.testing.terminalConfirmedAt);
        assert.equal(f.state.jobOwner, null);
        assert.equal(f.requests.length, 0);
    } finally { await f.close(); }
});

test("failed reruns reopen finished Test metadata and successful reruns write a fresh snapshot", async () => {
    const f = await fixture();
    try {
        f.initialize(undefined, undefined, true);
        f.state.prototypeApproach = { mode: "not-applicable", reason: "API-only work" };
        f.state.lifecycle.skippedStages = [{ stageId: "prototype", reason: "API-only work", skippedAt: "earlier" }];
        const preparationOutput = { stageId: "prepare", path: ".tandem\\prepare-previous.json", completedAt: "earlier" };
        f.state.lifecycle.outputs = [preparationOutput];
        const token = f.start("testing", await fingerprintWorkspace(f.root));
        let result = await f.api.testFactory.run(f.context("testing").ctx);
        await f.api.settleTestRun("fixture", { runId: token.runId, status: "completed", result }, token);
        await f.api.completeLifecycleStage("fixture", "test", "fixture");
        assert.equal(f.state.phase, "complete");
        const original = structuredClone(f.state.lifecycle.outputs.find((output: any) => output.stageId === "test"));
        const earlierStages = f.state.lifecycle.completedStages.filter((stage: string) => stage !== "test");
        const skipped = structuredClone(f.state.lifecycle.skippedStages);
        await f.api.submitTestStart({ prototypeId: "fixture" }, {});
        await f.api.drain();
        assert.equal(f.state.phase, "building");
        assert.deepEqual(f.state.lifecycle.completedStages, earlierStages);
        assert.deepEqual(f.state.lifecycle.history, [original]);
        assert.deepEqual(f.state.lifecycle.outputs, [preparationOutput]);
        assert.deepEqual(f.state.lifecycle.skippedStages, skipped);
        assert.equal(f.state.artifacts.find((artifact: any) => artifact.id === "test-results").reviewStatus, "stale");
        let retry = executionToken(f.state.testing);
        let run = f.context("testing").ctx;
        run.runId = retry.runId;
        run.agent = async () => ({ ...outcome("Regression detected", true), status: "failed" });
        result = await f.api.testFactory.run(run);
        await f.api.settleTestRun("fixture", { runId: retry.runId, status: "completed", result }, retry);
        assert.equal(f.state.testing.status, "failed");
        assert.notEqual(f.state.phase, "complete");
        assert.equal(f.state.lifecycle.completedStages.includes("test"), false);
        await assert.rejects(f.api.completeLifecycleStage("fixture", "test", "fixture"), /Test evidence/);
        assert.equal(f.state.lifecycle.outputs.some((output: any) => output.stageId === "test"), false);
        await f.api.submitTestStart({ prototypeId: "fixture" }, {});
        await f.api.drain();
        retry = executionToken(f.state.testing);
        run = f.context("testing").ctx;
        run.runId = retry.runId;
        result = await f.api.testFactory.run(run);
        await f.api.settleTestRun("fixture", { runId: retry.runId, status: "completed", result }, retry);
        await f.api.completeLifecycleStage("fixture", "test", "fixture");
        const replacement = f.state.lifecycle.outputs.find((output: any) => output.stageId === "test");
        assert.notEqual(replacement.path, original.path);
        assert.equal(f.state.phase, "complete");
        assert.deepEqual(f.state.lifecycle.history, [original]);
        assert.deepEqual(f.state.lifecycle.skippedStages, skipped);
        assert.equal(f.state.prototypeApproach.mode, "not-applicable");
        const snapshot = JSON.parse(await readFile(join(f.root, replacement.path), "utf8"));
        assert.equal(snapshot.result.testing.requestId, retry.requestId);
        assert.equal(snapshot.result.testing.status, "completed");
    } finally { await f.close(); }
});
