import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import {
    createProcessState, normalizeProcessSettings, normalizeProcessState, processEvent, processMetrics,
} from "../src/process-state.js";
import { extensionHarness } from "./helpers/extension-harness.js";
import { writeJsonAtomically } from "../src/project-store.js";

test("legacy efforts have local adapters and no automatic execution", () => {
    const state = normalizeProcessState(undefined);
    assert.equal(state.settings.adapters.handoff, "local");
    assert.equal(state.settings.autoStartImplementation, false);
    assert.equal(state.settings.autoStartTests, false);
    assert.equal(state.settings.verification.enabled, false);
    assert.deepEqual(normalizeProcessState(JSON.parse(JSON.stringify(state))), state);
    assert.throws(() => normalizeProcessState({ version: 2 }), /Unsupported/);
});

test("process block selection is independent and invalid configuration fails closed", () => {
    const initial = createProcessState().settings;
    const settings = normalizeProcessSettings({ ...initial, adapters: { handoff: "github", status: "local", intake: "github" } });
    assert.equal(settings.adapters.status, "local");
    assert.throws(() => normalizeProcessSettings({ ...settings, adapters: { ...settings.adapters, intake: "unknown" } }), /registered/);
    assert.throws(() => normalizeProcessSettings({ ...settings, verification: { enabled: true, independentReview: true, checks: [] } }), /Test command/);
    assert.throws(() => normalizeProcessSettings({ ...settings, githubRepository: "https://evil.example/a/b" }), /owner\/repo/);
});

test("process events are idempotent and acceptance waiting is measured from readiness", () => {
    let state = processEvent(createProcessState(), "plan", "ready", "Ready", "revision1", "2026-09-08T00:00:00Z");
    state = processEvent(state, "plan", "ready", "Repeated", "revision1", "2026-09-08T00:10:00Z");
    state = processEvent(state, "plan", "accepted", "Accepted", "acceptance1", "2026-09-08T00:02:00Z");
    assert.equal(state.events.length, 2);
    assert.equal(processMetrics(state).acceptanceWaitingMs, 120000);
});

test("process mutation validates provider, revision and active-job ownership", async () => {
    const h = await extensionHarness();
    try {
        const state = h.api.createState("process", "A goal");
        await h.api.persistState(state);
        const settings = { ...state.process.settings, adapters: { handoff: "github", status: "local", intake: "local" } };
        const next = await h.api.processAction("process", "project:tandem", { action: "configure", expectedRevision: state.revision, settings });
        assert.equal(next.process.settings.adapters.handoff, "github");
        assert.equal((await h.api.loadState("process")).process.settings.adapters.handoff, "github");
        await assert.rejects(h.api.processAction("process", "project:tandem", {
            action: "configure", expectedRevision: state.revision, settings,
        }), /effort changed/);
        await assert.rejects(h.api.processAction("process", "wrong-provider", {
            action: "configure", expectedRevision: next.revision, settings,
        }), /active Tandem provider/);
        await assert.rejects(h.api.processAction("process", "project:tandem", {
            action: "accept", expectedRevision: next.revision, stageId: "plan", approver: "Owner",
        }), /Finish the stage/);
    } finally { await h.close(); }
});

test("explicit acceptance and export persist without committing or changing the active stage", async () => {
    const h = await extensionHarness();
    try {
        execFileSync("git", ["init", "--quiet", h.root]);
        const state = h.api.createState("accept", "Preserve accepted intent");
        state.stage = "prototype";
        state.lifecycle.currentStage = "prototype";
        state.lifecycle.completedStages = ["prepare", "requirements"];
        const snapshotPath = join(h.root, ".tandem", "efforts", "accept", "stages", "requirements-r1.json");
        await mkdir(dirname(snapshotPath), { recursive: true });
        await writeJsonAtomically(snapshotPath, {
            version: 1, prototypeId: "accept", stageId: "requirements", revision: 1, completedAt: new Date().toISOString(),
            result: { goal: state.goal, artifacts: [{
                id: "requirements-result", title: "Requirements", kind: "requirements", stage: "requirements",
                path: "", language: "markdown", content: "# Requirements\n\nPreserve intent.", mermaid: "",
            }] },
        });
        state.lifecycle.outputs = [{ stageId: "requirements", path: relative(h.root, snapshotPath), completedAt: new Date().toISOString() }];
        await h.api.persistState(state);
        const accepted = await h.api.processAction("accept", "project:tandem", {
            action: "accept", stageId: "requirements", approver: "Product owner", expectedRevision: state.revision,
        });
        const record = accepted.process.acceptances[0];
        assert.equal(record.acceptedBy.label, "Product owner");
        assert.equal(accepted.lifecycle.currentStage, "prototype");
        const repeated = await h.api.processAction("accept", "project:tandem", {
            action: "accept", stageId: "requirements", approver: "Product owner", expectedRevision: accepted.revision,
        });
        assert.equal(repeated.process.acceptances.length, 1);
        assert.equal(repeated.process.acceptances[0].id, record.id);
        const exported = await h.api.processAction("accept", "project:tandem", {
            action: "export", acceptanceId: record.id, expectedRevision: repeated.revision,
        });
        assert.ok(exported.process.acceptances[0].exportPath?.startsWith("tandem-records"));
        const manifest = JSON.parse(await readFile(join(h.root, exported.process.acceptances[0].exportPath!, "manifest.json"), "utf8"));
        assert.ok(manifest);
        assert.equal(execFileSync("git", ["rev-list", "--all", "--count"], { cwd: h.root, encoding: "utf8" }).trim(), "0");
        assert.equal(h.requests.length, 0);
    } finally { await h.close(); }
});

test("local intake is idempotent, preserves the active effort and does not start agents", async () => {
    const h = await extensionHarness();
    try {
        const state = h.api.createState("origin", "Existing work");
        await h.api.persistState(state);
        const input = { action: "intake", reference: "incident-42",
            content: JSON.stringify({ title: "A failing flow", body: "Observed a 500 response.", kind: "incident" }) };
        const first = await h.api.processAction("origin", "project:tandem", { ...input, expectedRevision: state.revision });
        const receipt = first.process.receipts[0];
        assert.ok(receipt.followupId);
        const followup = await h.api.loadState(receipt.followupId!);
        assert.equal(followup.process.source?.parentEffortId, "origin");
        assert.equal(followup.artifacts[0].content, "Observed a 500 response.");
        assert.equal(followup.preparation.status, "not-started");
        const repeated = await h.api.processAction("origin", "project:tandem", { ...input, expectedRevision: first.revision });
        assert.equal(repeated.process.receipts.length, 1);
        assert.equal(repeated.goal, "Existing work");
        assert.equal(h.requests.length, 0);
        const opened: unknown[] = [];
        h.api.setSession({ ...h.session, rpc: { ...h.session.rpc, canvas: {
            open: async (request: unknown) => { opened.push(request); return {}; },
        } } });
        await h.api.processAction("origin", "project:tandem", {
            action: "open-intake", receiptId: receipt.id, expectedRevision: repeated.revision,
        });
        assert.deepEqual(JSON.parse(JSON.stringify(opened)), [{
            canvasId: "tandem", extensionId: "project:tandem",
            instanceId: `linked-${receipt.followupId}`, input: { prototypeId: receipt.followupId },
        }]);
        await h.api.ensurePreparationStarted(followup, true);
        await new Promise((resolve) => setImmediate(resolve));
        const request = h.requests[0];
        assert.ok(request && typeof request === "object" && "args" in request);
        assert.ok(request.args && typeof request.args === "object" && "intake" in request.args);
        assert.equal(JSON.parse(JSON.stringify(request.args.intake)).content, "Observed a 500 response.");
        assert.ok(Object.hasOwn(h.api.preparationFactory.meta.argsSchema.properties, "intake"));
    } finally { await h.close(); }
});

for (const stage of ["plan", "implement"] as const) {
    test(`${stage} automation requires explicit acceptance and never repeats the same accepted handoff`, async () => {
        const h = await extensionHarness();
        try {
            execFileSync("git", ["init", "--quiet", h.root]);
            const state = h.api.createState("automatic", "Exercise explicit handoff automation");
            state.stage = stage === "plan" ? "implement" : "test";
            state.lifecycle.currentStage = state.stage;
            state.lifecycle.completedStages = ["prepare", "requirements", "prototype", "design", "plan",
                ...(stage === "implement" ? ["implement" as const] : [])];
            state.planning = {
                ...state.planning, status: "complete", finalizedArtifactId: "execution-plan",
                workItems: [{ id: "feature", title: "Feature", description: "Implement one behavior",
                    dependencies: [], files: ["feature.ts"], skills: [], acceptanceCriteria: ["Expected behavior"],
                    validation: ["Existing check"], estimatedHours: 1, agentRole: "implementation" }],
            };
            state.testDesignReview = {
                ...state.testDesignReview, finalizedArtifactId: "test-spec",
                scenarios: [{ id: "flow", title: "Flow", description: "Exercise behavior", type: "interaction",
                    dependencies: [], steps: ["Exercise the flow"], expectedOutcome: "Expected behavior", validation: ["Existing check"] }],
            };
            const path = join(h.root, ".tandem", "efforts", state.prototypeId, "stages", `${stage}-r1.json`);
            await mkdir(dirname(path), { recursive: true });
            await writeJsonAtomically(path, {
                version: 1, prototypeId: state.prototypeId, stageId: stage, revision: 1, completedAt: new Date().toISOString(),
                result: { goal: state.goal, artifacts: [] },
            });
            state.lifecycle.outputs = [{ stageId: stage, path: relative(h.root, path), completedAt: new Date().toISOString() }];
            await h.api.persistState(state);
            const configured = await h.api.processAction(state.prototypeId, "project:tandem", {
                action: "configure", expectedRevision: state.revision,
                settings: { ...state.process.settings, autoStartImplementation: stage === "plan", autoStartTests: stage === "implement" },
            });
            assert.equal(h.requests.length, 0);
            h.api.setSession({
                ...h.session,
                rpc: { ...h.session.rpc, factory: { run: async (request: unknown) => {
                    h.requests.push(request);
                    return { runId: "automatic-run", status: "error", error: "Fixture launch failed" };
                } } },
                factory: { getRunDetail: async () => ({
                    runId: "automatic-run", consumed: { activeMs: 12, nanoAiu: 0 }, agents: [],
                }) },
            });
            await h.api.processAction(state.prototypeId, "project:tandem", {
                action: "accept", stageId: stage, approver: "Owner", expectedRevision: configured.revision,
            });
            await h.api.waitForExecution(state.prototypeId);
            assert.equal(h.requests.length, 1);
            const failed = await h.api.loadState(state.prototypeId);
            assert.equal((stage === "plan" ? failed.implementation : failed.testing).status, "failed");
            assert.equal(failed.process.acceptances.length, 1, "Dispatch failure must preserve the accepted handoff");
            await h.api.processAction(state.prototypeId, "project:tandem", {
                action: "accept", stageId: stage, approver: "Owner", expectedRevision: failed.revision,
            });
            await h.api.waitForExecution(state.prototypeId);
            assert.equal(h.requests.length, 1, "Retry is explicit Start, not another dispatch of the same acceptance");
        } finally { await h.close(); }
    });
}

test("protected paths remain locked through Implement reopening and can be reviewed after reopening Plan", async () => {
    const h = await extensionHarness();
    try {
        const state = h.api.createState("protected", "Protect accepted regression tests");
        state.stage = "test";
        state.lifecycle.currentStage = "test";
        state.lifecycle.completedStages = ["prepare", "requirements", "prototype", "design", "plan", "implement"];
        const profile = {
            enabled: true, independentReview: false, protectedPaths: ["tests"],
            checks: [{ id: "test", program: "node", args: ["--version"], stage: "test" as const, afterWorkItems: [], timeoutSeconds: 10 }],
        };
        state.process.settings.verification = profile;
        state.implementation.verificationProfile = profile;
        state.implementation.protectedSources = { "tests\\regression.ts": "0".repeat(64) };
        await h.api.persistState(state);
        const settings = { ...state.process.settings, verification: { ...profile, protectedPaths: [] } };
        await assert.rejects(h.api.processAction(state.prototypeId, "project:tandem", {
            action: "configure", expectedRevision: state.revision, settings,
        }), /Reopen Plan/);
        const reopened = await h.api.reopenLifecycleStage(state.prototypeId, "implement", "project:tandem");
        assert.equal(reopened.implementation.protectedSources["tests\\regression.ts"], "0".repeat(64));
        await assert.rejects(h.api.processAction(state.prototypeId, "project:tandem", {
            action: "configure", expectedRevision: reopened.revision, settings,
        }), /Reopen Plan/);
        const plan = await h.api.reopenLifecycleStage(state.prototypeId, "plan", "project:tandem");
        const updated = await h.api.processAction(state.prototypeId, "project:tandem", {
            action: "configure", expectedRevision: plan.revision, settings,
        });
        assert.equal(updated.process.settings.verification.protectedPaths.length, 0);
    } finally { await h.close(); }
});
