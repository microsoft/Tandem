import assert from "node:assert/strict";
import { test } from "node:test";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { extensionHarness } from "./helpers/extension-harness.js";
import { newPrototypeFlow } from "../src/prototype-flow.js";

test("retired budget extension cannot rewrite historical limits or secretly launch work", async () => {
    const fixture = await extensionHarness();
    try {
        const state = fixture.api.createState("sample", "Retain failed work");
        state.stage = state.lifecycle.currentStage = "prototype";
        state.lifecycle.completedStages = ["prepare", "requirements", "sketch"];
        state.preparation.status = "ready";
        state.prototypeFlow = { ...newPrototypeFlow(), budget: { limitSeconds: 900, usedSeconds: 900 } };
        await fixture.api.persistState(state);
        const before = JSON.stringify(await fixture.api.loadState("sample"));
        await assert.rejects(fixture.api.prototypeAction("sample", "project:tandem", {
            action: "extend-budget", expectedRevision: state.revision,
        }), /no longer has an automatic time limit/);
        assert.equal(JSON.stringify(await fixture.api.loadState("sample")), before);
        assert.equal(fixture.requests.length, 0);
    } finally { await fixture.close(); }
});

test("completing requirements schedules exactly one sketch job and guards replacement", async () => {
    const fixture = await extensionHarness();
    try {
        const state = fixture.api.createState("sample", "Sample app");
        state.lifecycle = { ...state.lifecycle, currentStage: "requirements", completedStages: ["prepare"] };
        state.stage = "requirements";
        state.prototypeApproach = { mode: "build", reason: "A new interface is needed." };
        state.requirements = { substage: "dag", usageItems: ["Use the app"], suggestions: [] };
        state.decisionGraph.nodes = [{ id: "usage", title: "Usage", dependencies: [], question: null, answer: "Chosen", status: "answered" }];
        await fixture.api.persistState(state);
        const pending = await fixture.api.completeLifecycleStage("sample", "requirements", "project:tandem");
        await fixture.waitForRequests();
        assert.equal(pending.lifecycle.currentStage, "sketch");
        assert.equal(pending.processing.action, "generate-sketch");
        assert.equal(pending.previewStatus, "waiting");
        assert.equal(fixture.requests.length, 1);
        await assert.rejects(fixture.api.beginPrototypeBuild("sample", "project:tandem"), /Prototype stage/);
        await assert.rejects(fixture.api.updateTandem({ instanceId: "view", extensionId: "project:tandem", input: { prototypeId: "sample", reset: true } }), /active Tandem/);
        fixture.session.sessionId = "different-session";
        await assert.rejects(fixture.api.updateTandem({ instanceId: "view", extensionId: "project:tandem", input: { prototypeId: "sample", reset: true } }), /another session/);
    } finally { await fixture.close(); }
});

test("prototype results cannot rewrite requirements and must publish a verified preview", { timeout: 10000 }, async () => {
    const fixture = await extensionHarness();
    try {
        const state = fixture.api.createLegacyState("sample", "User goal");
        state.lifecycle.completedStages = ["requirements"];
        state.lifecycle.currentStage = "prototype";
        state.stage = "prototype";
        state.prototypeApproach = { mode: "build", reason: "A new interface is needed." };
        state.confirmed = ["User decision"];
        await fixture.api.persistState(state);
        fixture.api.setSession({ ...fixture.session, rpc: { ...fixture.session.rpc, workflow: {
            run: async (request: { args: { state: typeof state } }) => {
                fixture.requests.push(request);
                const checkpointId = request.args.state.processing.prototypeCheckpointId;
                fixture.setPreviewHtml(`<meta name="tandem-prototype-id" content="sample"><meta name="tandem-prototype-checkpoint" content="${checkpointId}">`);
                return { status: "completed", runId: `fake-run-${fixture.requests.length}`, result: {
                    goal: "Worker goal", confirmed: ["Invented"],
                    summary: "Primary flow is available.", focus: "Try selecting an item.",
                    previewUrl: `http://127.0.0.1:${12345 + fixture.requests.length}`, question: null,
                    artifactChanges: { upsert: [], remove: [] }, evidence: ["Exercised selection."],
                } };
            },
        } } });
        await fixture.api.beginPrototypeBuild("sample", "project:tandem");
        await fixture.waitForRequests();
        await fixture.api.waitForAnswer("sample");
        await fixture.waitForRequests(2);
        await fixture.api.waitForAnswer("sample");
        const ready = await fixture.api.loadState("sample");
        assert.equal(ready.previewStatus, "ready", JSON.stringify({ status: ready.status, logs: fixture.logs }));
        assert.equal(ready.goal, "User goal");
        assert.deepEqual(Array.from(ready.confirmed), ["User decision"]);
        assert.equal(ready.jobOwner, null);
        assert.equal(ready.prototypeFlow!.checkpoints.length, 2);
        assert.equal(ready.previewUrl, "http://127.0.0.1:12346/");
        assert.equal(ready.prototypeFlow!.pendingCheckpointId, ready.prototypeFlow!.checkpoints[1].id);
    } finally { await fixture.close(); }
});

test("ready checkpoints retain their own validated server start instructions for future restart", async () => {
    const fixture = await extensionHarness();
    try {
        const state = fixture.api.createLegacyState("sample", "Keep restart simple");
        state.stage = state.lifecycle.currentStage = "prototype";
        state.lifecycle.completedStages = ["prepare", "requirements"];
        state.prototypeApproach = { mode: "build", reason: "New GUI" };
        await fixture.api.persistState(state);
        fixture.api.setSession({ ...fixture.session, rpc: { ...fixture.session.rpc, workflow: {
            run: async (request: { args: { state: typeof state } }) => {
                fixture.requests.push(request);
                const checkpoint = request.args.state.prototypeFlow!.checkpoints.at(-1)!;
                await mkdir(join(checkpoint.workspacePath, "app"), { recursive: true });
                await writeFile(join(checkpoint.workspacePath, "app", "server.mjs"), "// Fixture startup source");
                const port = String(12500 + fixture.requests.length);
                fixture.setPreviewHtml(`<meta name="tandem-prototype-id" content="sample"><meta name="tandem-prototype-checkpoint" content="${checkpoint.id}">`);
                return { status: "completed", runId: `start-instructions-${fixture.requests.length}`, result: {
                    summary: "Saved mock preview", focus: "Inspect the primary action.",
                    previewUrl: `http://127.0.0.1:${port}/`, question: null, artifactChanges: { upsert: [], remove: [] }, evidence: [],
                    previewStart: { entrypoint: "app\\server.mjs", workingDirectory: "app", args: ["--port", port] },
                } };
            },
        } } });
        await fixture.api.beginPrototypeBuild("sample", "project:tandem");
        await fixture.waitForRequests(); await fixture.api.waitForAnswer("sample");
        await fixture.waitForRequests(2); await fixture.api.waitForAnswer("sample");
        const saved = await fixture.api.loadState("sample");
        for (const [index, checkpoint] of saved.prototypeFlow!.checkpoints.entries()) {
            assert.equal(checkpoint.status, "ready", saved.processing.message);
            assert.deepEqual(JSON.parse(JSON.stringify(checkpoint.previewStart)), {
                entrypoint: "app\\server.mjs", workingDirectory: "app", args: ["--port", String(12501 + index)],
            });
        }
        assert.notDeepEqual(saved.prototypeFlow!.checkpoints[0].previewStart, saved.prototypeFlow!.checkpoints[1].previewStart);
    } finally { await fixture.close(); }
});

test("explicit reopening preserves history and invalidates downstream work", async () => {
    const fixture = await extensionHarness();
    try {
        const state = fixture.api.createLegacyState("sample", "User goal");
        state.lifecycle.completedStages = ["requirements", "prototype", "design", "plan"];
        state.lifecycle.currentStage = "implement";
        state.stage = "implement";
        state.lifecycle.outputs = [{ stageId: "prototype", path: "old-snapshot.json", completedAt: "before" }];
        state.previewStatus = "ready";
        state.previewUrl = "http://localhost:12345";
        state.artifacts = [{ id: "design-spec", title: "Design", stage: "design", kind: "design-spec", path: "", language: "markdown", content: "Keep history", mermaid: "", reviewStatus: "current" }];
        await fixture.api.persistState(state);
        const reopened = await fixture.api.reopenLifecycleStage("sample", "requirements", "project:tandem");
        assert.equal(reopened.lifecycle.currentStage, "requirements");
        assert.deepEqual(Array.from(reopened.lifecycle.completedStages), ["prepare"]);
        assert.equal(reopened.lifecycle.history[0].path, "old-snapshot.json");
        assert.equal(reopened.artifacts[0].content, "Keep history");
        assert.equal(reopened.artifacts[0].reviewStatus, "current", "Historical records retain their original identity/status, without Stage 2 authority.");
        assert.equal(reopened.previewStatus, "waiting");
        assert.notEqual(reopened.generation, state.generation);
    } finally { await fixture.close(); }
});

test("UTF-8 request input survives transport chunk boundaries", async () => {
    const fixture = await extensionHarness();
    try {
        const encoded = Buffer.from(JSON.stringify({ answer: "\u4f60\u597d" }));
        async function* chunks() { for (const byte of encoded) yield Buffer.from([byte]); }
        const result = await fixture.api.readRequestBody(chunks());
        assert.equal(JSON.stringify(result), '{"answer":"\u4f60\u597d"}');
    } finally { await fixture.close(); }
});

test("feedback stays durable and idempotent while the first build or a clarification is active", async () => {
    const fixture = await extensionHarness();
    try {
        const state = fixture.api.createLegacyState("sample", "Sample app");
        state.stage = state.lifecycle.currentStage = "prototype";
        state.lifecycle.completedStages = ["prepare", "requirements"];
        state.prototypeApproach = { mode: "build", reason: "New UI" };
        await fixture.api.persistState(state);
        await fixture.api.beginPrototypeBuild("sample", "project:tandem");
        await fixture.waitForRequests();
        const first = await fixture.api.queuePrototypeRevision("sample", "project:tandem", {
            suggestion: "Make the camera keyboard reachable.", baseCheckpointId: null, clientRequestId: "feedback-1",
        });
        const repeated = await fixture.api.queuePrototypeRevision("sample", "project:tandem", {
            suggestion: "Make the camera keyboard reachable.", baseCheckpointId: null, clientRequestId: "feedback-1",
        });
        assert.equal(first.revisionId, repeated.revisionId);
        const pending = await fixture.api.loadState("sample");
        assert.equal(pending.prototypeReview.revisions.length, 1);
        assert.equal(pending.prototypeReview.revisions[0].status, "queued");
        assert.equal(pending.processing.status, "running");
        assert.equal(fixture.requests.length, 1);
        await assert.rejects(fixture.api.queuePrototypeRevision("sample", "project:tandem", {
            suggestion: "Different text", clientRequestId: "feedback-1",
        }), /already contains another/);
        await assert.rejects(fixture.api.queuePrototypeRevision("sample", "project:tandem", {
            suggestion: "Unknown view", baseCheckpointId: "not-a-checkpoint",
        }), /unknown preview/);
    } finally { await fixture.close(); }
});

test("later timeout retains the first preview and retry only rebuilds the failed milestone", async () => {
    const fixture = await extensionHarness();
    try {
        const state = fixture.api.createLegacyState("sample", "Sample app");
        state.stage = state.lifecycle.currentStage = "prototype";
        state.lifecycle.completedStages = ["prepare", "requirements"];
        state.prototypeApproach = { mode: "build", reason: "New UI" };
        await fixture.api.persistState(state);
        fixture.api.setSession({ ...fixture.session, rpc: { ...fixture.session.rpc, workflow: {
            run: async (request: { args: { state: typeof state }; options: { limits: { timeoutSeconds: number } } }) => {
                fixture.requests.push(request);
                const count = fixture.requests.length;
                if (count === 2 || count === 4) return { status: "failed", runId: `run-${count}`, error: "Factory limit timeoutSeconds=300 was reached" };
                const checkpoint = request.args.state.prototypeFlow!.checkpoints.at(-1)!;
                fixture.setPreviewHtml(`<meta name="tandem-prototype-id" content="sample"><meta name="tandem-prototype-checkpoint" content="${checkpoint.id}">`);
                assert.equal(request.options.limits.timeoutSeconds, undefined);
                assert.equal(Object.hasOwn(request, "limits"), false);
                return { status: "completed", runId: `run-${count}`, result: {
                    summary: `${checkpoint.milestone} ready`, focus: "Try the primary action.",
                    previewUrl: `http://127.0.0.1:${12400 + count}`, question: null,
                    artifactChanges: { upsert: [], remove: [] }, evidence: [],
                } };
            },
        } } });
        await fixture.api.beginPrototypeBuild("sample", "project:tandem");
        await fixture.waitForRequests();
        await fixture.api.waitForAnswer("sample");
        await fixture.waitForRequests(2);
        await fixture.api.waitForAnswer("sample");
        const paused = await fixture.api.loadState("sample");
        assert.equal(paused.previewStatus, "ready");
        assert.equal(paused.previewUrl, "http://127.0.0.1:12401/");
        assert.match(paused.status, /working preview is still available/);
        assert.equal(paused.prototypeFlow!.checkpoints[1].status, "failed");
        await fixture.api.prototypeAction("sample", "project:tandem", {
            action: "retry", checkpointId: paused.prototypeFlow!.checkpoints[1].id,
        });
        await fixture.waitForRequests(3);
        await fixture.api.waitForAnswer("sample");
        const prepared = await fixture.api.loadState("sample");
        assert.equal(prepared.prototypeFlow!.checkpoints[2].milestone, "interaction");
        assert.equal(prepared.prototypeFlow!.checkpoints[2].sourceCheckpointId, paused.prototypeFlow!.checkpoints[1].id);
        assert.equal(prepared.previewUrl, paused.previewUrl);
        assert.match(fixture.api.stageCompletionError(prepared, "prototype", { requirePrototypeSpec: false })!, /Apply/);
        await assert.rejects(fixture.api.prototypeAction("sample", "project:tandem", {
            action: "apply-update", checkpointId: paused.prototypeFlow!.checkpoints[0].id,
        }), /no longer pending/);
        const promoted = await fixture.api.prototypeAction("sample", "project:tandem", {
            action: "apply-update", checkpointId: prepared.prototypeFlow!.pendingCheckpointId,
        });
        assert.equal(promoted.previewUrl, "http://127.0.0.1:12403/");
        assert.equal(fixture.api.stageCompletionError(promoted, "prototype", { requirePrototypeSpec: false }), null);
        await fixture.api.prototypeAction("sample", "project:tandem", { action: "visual" });
        await fixture.waitForRequests(4);
        await fixture.api.waitForAnswer("sample");
        const visualFailure = await fixture.api.loadState("sample");
        assert.equal(visualFailure.prototypeFlow!.checkpoints.at(-1)!.milestone, "visual");
        assert.equal(visualFailure.previewUrl, promoted.previewUrl);
        const skipped = await fixture.api.prototypeAction("sample", "project:tandem", { action: "skip-visual" });
        assert.equal(skipped.prototypeFlow!.visualRequested, false);
        assert.equal(skipped.prototypeFlow!.checkpoints.at(-1)!.status, "failed");
        assert.equal(fixture.api.stageCompletionError(skipped, "prototype", { requirePrototypeSpec: false }), null);
    } finally { await fixture.close(); }
});

test("a checkpoint cannot publish another checkpoint's identity", async () => {
    const fixture = await extensionHarness();
    try {
        const state = fixture.api.createLegacyState("sample", "Sample app");
        state.stage = state.lifecycle.currentStage = "prototype";
        state.lifecycle.completedStages = ["prepare", "requirements"];
        state.prototypeApproach = { mode: "build", reason: "New UI" };
        await fixture.api.persistState(state);
        fixture.api.setSession({ ...fixture.session, rpc: { ...fixture.session.rpc, workflow: {
            run: async (request: unknown) => {
                fixture.requests.push(request);
                return { status: "completed", runId: "wrong-preview", result: {
                    summary: "Claimed ready", focus: "", previewUrl: "http://127.0.0.1:12000", question: null,
                    artifactChanges: { upsert: [], remove: [] }, evidence: [],
                } };
            },
        } } });
        await fixture.api.beginPrototypeBuild("sample", "project:tandem");
        await fixture.waitForRequests();
        await fixture.api.waitForAnswer("sample");
        const failed = await fixture.api.loadState("sample");
        assert.equal(failed.previewStatus, "error");
        assert.equal(failed.prototypeFlow!.displayedCheckpointId, null);
        assert.match(failed.status, /does not identify this checkpoint/);
    } finally { await fixture.close(); }
});

test("queued feedback is reconciled in order and the active item survives snapshot truncation", async () => {
    const fixture = await extensionHarness();
    try {
        const state = fixture.api.createLegacyState("sample", "Sample app");
        state.stage = state.lifecycle.currentStage = "prototype";
        state.lifecycle.completedStages = ["prepare", "requirements"];
        state.prototypeApproach = { mode: "build", reason: "New UI" };
        await fixture.api.persistState(state);
        let finishFirst: (value: unknown) => void = () => { throw new Error("First run has not started."); };
        fixture.api.setSession({ ...fixture.session, rpc: { ...fixture.session.rpc, workflow: {
            run: async (request: unknown) => {
                fixture.requests.push(request);
                if (fixture.requests.length === 1) return new Promise((resolve) => { finishFirst = resolve; });
                return new Promise<never>(() => {});
            },
        } } });
        await fixture.api.beginPrototypeBuild("sample", "project:tandem");
        await fixture.waitForRequests();
        for (let index = 0; index < 7; index++) await fixture.api.queuePrototypeRevision("sample", "project:tandem", {
            suggestion: `Feedback item ${index}`, clientRequestId: `feedback-${index}`, baseCheckpointId: null,
        });
        const running = await fixture.api.loadState("sample");
        fixture.setPreviewHtml(`<meta name="tandem-prototype-id" content="sample"><meta name="tandem-prototype-checkpoint" content="${running.prototypeFlow!.activeCheckpointId}">`);
        finishFirst({ status: "completed", runId: "first-run", result: {
            summary: "Structure ready", focus: "Try a part", previewUrl: "http://127.0.0.1:12200", question: null,
            artifactChanges: { upsert: [], remove: [] }, evidence: [],
        } });
        await fixture.api.waitForAnswer("sample");
        await fixture.waitForRequests(2);
        const request = fixture.requests[1] as { args: { action: string; state: typeof state } };
        assert.equal(request.args.action, "submit-revision");
        assert.equal(request.args.state.prototypeReview.revisions[0].suggestion, "Feedback item 0");
        assert.match(fixture.api.answerFactoryPrompt(request.args), /Feedback item 0/);
        const current = await fixture.api.loadState("sample");
        assert.equal(current.prototypeReview.revisions[0].status, "processing");
        assert.equal(current.prototypeReview.revisions.slice(1).filter((item) => item.status === "queued").length, 6);
        assert.equal(current.previewStatus, "ready");
    } finally { await fixture.close(); }
});

test("new prototype state rejects direct preview replacement", async () => {
    const fixture = await extensionHarness();
    try {
        const state = fixture.api.createLegacyState("sample", "Sample app");
        state.stage = state.lifecycle.currentStage = "prototype";
        state.lifecycle.completedStages = ["prepare", "requirements"];
        state.prototypeApproach = { mode: "build", reason: "New UI" };
        await fixture.api.persistState(state);
        await fixture.api.queuePrototypeRevision("sample", "project:tandem", { suggestion: "Use keyboard navigation." });
        await assert.rejects(fixture.api.updateTandem({
            instanceId: "view", extensionId: "project:tandem",
            input: { prototypeId: "sample", previewUrl: "http://127.0.0.1:12300" },
        }), /checkpoint previews/);
    } finally { await fixture.close(); }
});

test("legacy previews can queue feedback through an open clarification without losing it", async () => {
    const fixture = await extensionHarness();
    try {
        const state = fixture.api.createLegacyState("sample", "Existing app");
        state.stage = state.lifecycle.currentStage = "prototype";
        state.lifecycle.completedStages = ["prepare", "requirements"];
        state.previewStatus = "ready";
        state.previewUrl = "http://127.0.0.1:12300/";
        state.prototypeApproach = { mode: "validate-existing", reason: "Existing UI" };
        state.prototypeReview = { ...state.prototypeReview, activeRevisionId: "older",
            revisions: [{ id: "older", suggestion: "Change selection.", status: "clarifying", summary: "",
                submittedAt: state.updatedAt, completedAt: null, clarifications: [] }],
            question: { id: "clarification", text: "Which selection?", rationale: "",
                choices: ["Single", "Multiple", "Range"], recommended: "Single",
                allowFreeText: true, answerPlaceholder: "" } };
        await fixture.api.persistState(state);
        await fixture.api.queuePrototypeRevision("sample", "project:tandem", { suggestion: "Keep the current labels." });
        const queued = await fixture.api.loadState("sample");
        assert.equal(queued.prototypeReview.question.id, "clarification");
        assert.equal(queued.prototypeReview.activeRevisionId, "older");
        assert.equal(queued.prototypeReview.revisions[1].status, "queued");
        assert.equal(queued.previewUrl, state.previewUrl);
        assert.equal(queued.prototypeFlow!.checkpoints[1].milestone, "interaction");
        assert.equal(queued.prototypeReview.revisions[1].baseCheckpointId, queued.prototypeFlow!.displayedCheckpointId);
        assert.equal(fixture.requests.length, 0);
    } finally { await fixture.close(); }
});

test("a prepared revision is not marked applied until its preview is promoted", async () => {
    const fixture = await extensionHarness();
    try {
        const state = fixture.api.createLegacyState("sample", "Existing app");
        state.stage = state.lifecycle.currentStage = "prototype";
        state.lifecycle.completedStages = ["prepare", "requirements"];
        state.previewStatus = "ready";
        state.previewUrl = "http://127.0.0.1:12100/";
        state.prototypeApproach = { mode: "validate-existing", reason: "Existing UI" };
        await fixture.api.persistState(state);
        const queued = await fixture.api.queuePrototypeRevision("sample", "project:tandem", {
            suggestion: "Add a visible selected state.", clientRequestId: "selected-state",
        });
        fixture.api.setSession({ ...fixture.session, rpc: { ...fixture.session.rpc, workflow: {
            run: async (request: { args: { state: typeof state } }) => {
                fixture.requests.push(request);
                const checkpoint = request.args.state.prototypeFlow!.checkpoints.at(-1)!;
                fixture.setPreviewHtml(`<meta name="tandem-prototype-id" content="sample"><meta name="tandem-prototype-checkpoint" content="${checkpoint.id}">`);
                return { status: "completed", runId: "revision-run", result: {
                    summary: "Selection is visible.", focus: "Select an item.", previewUrl: "http://127.0.0.1:12101",
                    question: null, artifactChanges: { upsert: [], remove: [] }, evidence: [],
                } };
            },
        } } });
        await fixture.api.beginPrototypeBuild("sample", "project:tandem");
        await fixture.waitForRequests();
        await fixture.api.waitForAnswer("sample");
        const prepared = await fixture.api.loadState("sample");
        assert.equal(prepared.prototypeReview.revisions[0].id, queued.revisionId);
        assert.equal(prepared.prototypeReview.revisions[0].status, "ready");
        assert.equal(prepared.previewUrl, state.previewUrl);
        const checkpoint = prepared.prototypeFlow!.checkpoints.at(-1)!;
        assert.match(checkpoint.sourceFingerprint!, /^prototype-v2:/);
        await mkdir(join(checkpoint.workspacePath, ".browser-checkpoint"));
        await writeFile(join(checkpoint.workspacePath, ".browser-checkpoint", "CrashpadMetrics.pma"), "mutable browser runtime");
        const driftFile = join(checkpoint.workspacePath, "unreviewed-source.txt");
        await writeFile(driftFile, "Changed after verification.");
        await assert.rejects(fixture.api.prototypeAction("sample", "project:tandem", {
            action: "apply-update", checkpointId: checkpoint.id,
        }), /source files changed/);
        assert.equal((await fixture.api.loadState("sample")).previewUrl, state.previewUrl);
        await rm(driftFile);
        const applied = await fixture.api.prototypeAction("sample", "project:tandem", {
            action: "apply-update", checkpointId: prepared.prototypeFlow!.pendingCheckpointId,
        });
        assert.equal(applied.prototypeReview.revisions[0].status, "applied");
        assert.equal(applied.previewUrl, "http://127.0.0.1:12101/");
        assert.equal(fixture.requests.length, 1);
    } finally { await fixture.close(); }
});
