import assert from "node:assert/strict";
import { test } from "node:test";
import { assertFactoryRequestEnvelope, rejectedFactoryLaunch, workflowReasoningEffort } from "../src/agent-runner.js";
import { extensionHarness } from "./helpers/extension-harness.js";

const schemaRejection = "unknown field `limits`, expected one of `name`, `args`, `options`";
const provider = "project:tandem";

test("programmatic Stage1 definitions have no product execution-time deadline", async () => {
    const fixture = await extensionHarness();
    try {
        for (const workflow of [fixture.api.preparationFactory, fixture.api.usageSuggestionFactory, fixture.api.answerFactory]) {
            assert.equal(workflow.meta.limits.timeoutSeconds, undefined);
        }
        const state = fixture.api.createState("sample", "A tracker");
        await fixture.api.persistState(state);
        await fixture.api.ensurePreparationStarted(state, true);
        await fixture.waitForRequests();
        const request = fixture.requests[0] as { options: { limits: { timeoutSeconds?: number } } };
        assert.equal(request.options.limits.timeoutSeconds, undefined);
    } finally { await fixture.close(); }
});

test("workflow workers honor explicit owning-session effort and retain defaults only when unset", async () => {
    for (const defaultEffort of ["low", "medium"] as const) {
        for (const reasoningEffort of [undefined, "low", "high"]) {
            const current = { modelId: "fixture-model", ...(reasoningEffort ? { reasoningEffort } : {}) };
            const session = { rpc: { model: { getCurrent: async () => current } } };
            assert.equal(await workflowReasoningEffort(session, defaultEffort), reasoningEffort ?? defaultEffort);
        }
    }
    for (const reasoningEffort of ["", "  "]) {
        await assert.rejects(workflowReasoningEffort({ rpc: { model: {
            getCurrent: async () => ({ modelId: "fixture-model", reasoningEffort }),
        } } }, "medium"), /invalid reasoning effort/);
    }
    await assert.rejects(workflowReasoningEffort({ rpc: { model: {
        getCurrent: async () => { throw new Error("Owning model snapshot unavailable"); },
    } } }, "low"), /Owning model snapshot unavailable/);
    // @ts-expect-error An incompatible native API must reject rather than invent a default.
    await assert.rejects(workflowReasoningEffort({ rpc: { model: {} } }, "low"), /getCurrent/);
});

async function prototypeFixture() {
    const fixture = await extensionHarness();
    const state = fixture.api.createLegacyState("sample", "Preserve the existing effort.");
    state.lifecycle.currentStage = state.stage = "prototype";
    state.lifecycle.completedStages = ["prepare", "requirements"];
    state.prototypeApproach = { mode: "build", reason: "New interface" };
    state.confirmed = ["Keep accepted requirements"];
    await fixture.api.persistState(state);
    return fixture;
}

test("factory RPC limits use the SDK options envelope, and malformed launches fail before recording ownership", async () => {
    assert.equal(rejectedFactoryLaunch(new Error(`Request session.workflow.run failed with message: ${schemaRejection}`)),
        `Request session.workflow.run failed with message: ${schemaRejection}`);
    assert.equal(rejectedFactoryLaunch(new Error(`Request session.factory.run failed with message: ${schemaRejection}`)),
        `Request session.factory.run failed with message: ${schemaRejection}`, "Historical launch rejection remains readable.");
    assert.doesNotThrow(() => assertFactoryRequestEnvelope({
        name: "worker", args: {}, options: { limits: { timeoutSeconds: 300 } },
    }));
    assert.throws(() => assertFactoryRequestEnvelope({
        // @ts-expect-error The SDK does not accept top-level resource ceilings.
        name: "worker", args: {}, limits: { timeoutSeconds: 300 },
    }), /limits belong inside options/);
    const fixture = await prototypeFixture();
    try {
        const invalid = { name: "worker", args: {}, limits: { timeoutSeconds: 300 } };
        await assert.rejects(fixture.api.runEffortFactory("sample", "unused", invalid), /limits belong inside options/);
        assert.equal((await fixture.api.loadState("sample")).factoryRuns?.length, 0);
        assert.equal(fixture.requests.length, 0);
    } finally { await fixture.close(); }
});

test("extension-owned workflow outcomes do not wake the foreground model and preserve exact limits", async () => {
    const fixture = await extensionHarness();
    try {
        const state = fixture.api.createState("sample", "An explicit UI request");
        state.preparation.status = "running";
        state.preparation.processing = { requestId: "owned-request", generation: state.generation,
            runId: null, requestedAt: state.updatedAt, completedAt: null };
        await fixture.api.persistState(state);
        const request = { name: "owned-workflow", args: { requestId: "owned-request" },
            options: { notifyOnComplete: true, limits: { timeoutSeconds: 240, maxConcurrentSubagents: 1, maxTotalSubagents: 3 } } };
        fixture.api.setSession({ ...fixture.session, rpc: { ...fixture.session.rpc, workflow: {
            run: async (actual) => {
                assert.equal(actual.options.notifyOnComplete, false);
                assert.deepEqual(JSON.parse(JSON.stringify(actual.options.limits)), request.options.limits);
                assert.equal(actual.args, request.args);
                return { runId: "owned-run", status: "completed", result: { confirmed: true } };
            },
        } } });
        const result = await fixture.api.runEffortFactory("sample", "owned-request", request);
        assert.equal(result.status, "completed");
        assert.equal(request.options.notifyOnComplete, true, "Caller input is not rewritten.");
        assert.equal((await fixture.api.loadState("sample")).factoryRuns[0].terminal, true);
    } finally { await fixture.close(); }
});
test("a definite pre-launch rejection releases its receipt and retries the prepared checkpoint", async () => {
    const fixture = await prototypeFixture();
    try {
        fixture.api.setSession({ ...fixture.session, rpc: { ...fixture.session.rpc, workflow: {
            run: async (request: unknown) => {
                fixture.requests.push(request);
                throw new Error(schemaRejection);
            },
        } } });
        await fixture.api.beginPrototypeBuild("sample", provider);
        await fixture.waitForRequests();
        await fixture.api.waitForAnswer("sample");
        const failed = await fixture.api.loadState("sample");
        assert.equal(failed.processing.status, "error");
        assert.equal(failed.factoryRuns![0].runId, null);
        assert.equal(failed.factoryRuns![0].terminal, true);
        assert.equal(failed.factoryRuns![0].launchRejection!.message, schemaRejection);
        assert.equal(failed.jobOwner, null);
        assert.equal(failed.prototypeFlow!.checkpoints[0].status, "failed");
        assert.equal(failed.prototypeFlow!.checkpoints[0].workspacePrepared, true);
        fixture.api.setSession(fixture.session);
        const retried = await fixture.api.prototypeAction("sample", provider, {
            action: "retry", checkpointId: failed.prototypeFlow!.checkpoints[0].id,
        });
        await fixture.waitForRequests(2);
        assert.equal(retried.processing.status, "running");
        assert.notEqual(retried.processing.requestId, failed.processing.requestId);
        assert.equal(retried.prototypeFlow!.checkpoints[1].sourceCheckpointId, failed.prototypeFlow!.checkpoints[0].id);
        const request = fixture.requests[1] as { options: { limits: { timeoutSeconds: number; maxAiCredits: number } } };
        assert.equal(request.options.limits.timeoutSeconds, undefined);
        assert.equal(request.options.limits.maxAiCredits, 10_000);
        assert.equal(Object.hasOwn(request, "limits"), false);
    } finally { await fixture.close(); }
});

test("owned workflow resume disables foreground notifications without changing its limits or identity", async () => {
    const fixture = await extensionHarness();
    try {
        const state = fixture.api.createState("sample", "Resume the owned stage only");
        state.preparation.status = "running";
        state.preparation.processing = { requestId: "saved-request", generation: state.generation,
            runId: "saved-run", requestedAt: state.updatedAt, completedAt: null };
        state.factoryRuns = [{ requestId: "saved-request", generation: state.generation, runId: "saved-run", terminal: false }];
        await fixture.api.persistState(state);
        fixture.api.setSession({ ...fixture.session, workflow: {
            resume: async (runId, options) => {
                assert.equal(runId, "saved-run");
                assert.deepEqual(JSON.parse(JSON.stringify(options)), { notifyOnComplete: false });
                return { runId, status: "completed", result: {} };
            },
        } });
        await fixture.api.resumeEffortRun("sample", "saved-run");
        const receipt = (await fixture.api.loadState("sample")).factoryRuns[0];
        assert.equal(receipt.runId, "saved-run");
        assert.equal(receipt.requestId, "saved-request");
        assert.equal(receipt.terminal, true);
    } finally { await fixture.close(); }
});

test("rehydration repairs a persisted 1.1.8 rejected launch without restarting workers or clearing history", async () => {
    const fixture = await prototypeFixture();
    try {
        fixture.api.setSession({ ...fixture.session, rpc: { ...fixture.session.rpc, workflow: {
            run: async (request: unknown) => {
                fixture.requests.push(request);
                throw new Error(schemaRejection);
            },
        } } });
        await fixture.api.beginPrototypeBuild("sample", provider);
        await fixture.waitForRequests();
        await fixture.api.waitForAnswer("sample");
        const stranded = await fixture.api.loadState("sample");
        stranded.factoryRuns![0] = { ...stranded.factoryRuns![0], terminal: false };
        delete stranded.factoryRuns![0].launchRejection;
        await fixture.api.persistState(stranded);
        assert.ok(stranded.jobOwner);
        const fresh = await extensionHarness({}, fixture.root);
        try {
            await fresh.api.openTandem({
                instanceId: "restored", extensionId: provider, sessionId: fixture.session.sessionId,
                reason: "rehydrate", input: { prototypeId: "sample" },
            });
            const repaired = await fresh.api.loadState("sample");
            assert.equal(repaired.generation, stranded.generation);
            assert.equal(repaired.goal, stranded.goal);
            assert.deepEqual(Array.from(repaired.confirmed), Array.from(stranded.confirmed));
            assert.equal(JSON.stringify(repaired.prototypeFlow), JSON.stringify(stranded.prototypeFlow));
            assert.equal(repaired.factoryRuns![0].requestId, stranded.processing.requestId);
            assert.equal(repaired.factoryRuns![0].terminal, true);
            assert.equal(repaired.factoryRuns![0].launchRejection!.message, schemaRejection);
            assert.equal(repaired.jobOwner, null);
            assert.equal(fresh.requests.length, 0);
            await fresh.api.beginPrototypeBuild("sample", provider);
            await fresh.waitForRequests();
        } finally { await fresh.close(); }
    } finally { await fixture.close(); }
});

test("unknown transport failures cannot release an unconfirmed launch or dispatch a duplicate", async () => {
    assert.equal(rejectedFactoryLaunch(new Error("Connection closed before receipt")), null);
    assert.equal(rejectedFactoryLaunch(new Error("Factory limit timeoutSeconds=300 was reached")), null);
    const fixture = await prototypeFixture();
    try {
        fixture.api.setSession({ ...fixture.session, rpc: { ...fixture.session.rpc, workflow: {
            run: async (request: unknown) => {
                fixture.requests.push(request);
                throw new Error("Connection closed before receipt");
            },
        } } });
        await fixture.api.beginPrototypeBuild("sample", provider);
        await fixture.waitForRequests();
        await fixture.api.waitForAnswer("sample");
        const failed = await fixture.api.loadState("sample");
        assert.equal(failed.factoryRuns![0].terminal, false);
        assert.ok(failed.jobOwner);
        await assert.rejects(fixture.api.beginPrototypeBuild("sample", provider), /already active/);
        assert.equal(fixture.requests.length, 1);
    } finally { await fixture.close(); }
});

test("a bound run and a foreign owning session cannot be cleared by rejected-launch recovery", async () => {
    for (const bound of [true, false]) {
        const fixture = await prototypeFixture();
        try {
            const state = await fixture.api.loadState("sample");
            state.processing = { status: "error", action: "build-prototype", requestId: "rejected-request",
                factoryName: "tandem-process-answer-project", message: schemaRejection,
                requestedAt: new Date().toISOString(), runId: bound ? "real-run" : null };
            state.factoryRuns = [{ generation: state.generation, requestId: "rejected-request",
                runId: bound ? "real-run" : null, terminal: false }];
            state.jobOwner = { sessionId: bound ? fixture.session.sessionId : "foreign-session", workspaceRoot: fixture.root };
            await fixture.api.persistState(state);
            await assert.rejects(fixture.api.beginPrototypeBuild("sample", provider), bound ? /already active/ : /another session/);
            assert.equal((await fixture.api.loadState("sample")).factoryRuns![0].terminal, false);
            assert.equal(fixture.requests.length, 0);
        } finally { await fixture.close(); }
    }
});
