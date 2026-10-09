import assert from "node:assert/strict";
import { test } from "node:test";
import { assertFactoryRequestEnvelope, rejectedFactoryLaunch } from "../src/agent-runner.js";
import { extensionHarness } from "./helpers/extension-harness.js";

const schemaRejection = "unknown field `limits`, expected one of `name`, `args`, `options`";
const provider = "project:tandem";

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
        assert.equal(request.options.limits.timeoutSeconds, 300);
        assert.equal(request.options.limits.maxAiCredits, 10_000);
        assert.equal(Object.hasOwn(request, "limits"), false);
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
