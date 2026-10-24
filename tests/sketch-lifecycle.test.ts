import assert from "node:assert/strict";
import { test } from "node:test";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { extensionHarness } from "./helpers/extension-harness.js";
import { sketchDocument, screenPng } from "./helpers/sketch-lifecycle-fixture.js";
import { SketchStore } from "../src/sketch-store.js";
import { buildPrototypeCheckpointPrompt, buildSketchPrompt } from "../src/planning-prompts.js";
import { newPrototypeFlow } from "../src/prototype-flow.js";
import { fingerprintPrototypeWorkspace } from "../src/prototype-runtime.js";
import { completeSavedChange, type ChangeAssessment } from "../src/change-requests.js";
import { addUi, applyOperations, createDocument } from "./helpers/ui-dsl-fixture.js";
import { searchIcons } from "../src/vendor/ui-dsl/index.js";

async function readyRequirements(fixture: Awaited<ReturnType<typeof extensionHarness>>, noGui = false) {
    const state = fixture.api.createState("sample", "A task app");
    state.stage = state.lifecycle.currentStage = "requirements";
    state.lifecycle.completedStages = ["prepare"];
    state.preparation.status = "ready";
    state.requirements = { substage: "dag", usageItems: ["I want to complete a task."], suggestions: [] };
    state.prototypeApproach = noGui ? { mode: "not-applicable", reason: "CLI only." } : { mode: "build", reason: "New GUI." };
    state.decisionGraph = { nodes: [{
        id: "usage", title: "Primary task", dependencies: [], answer: "Complete a task",
        status: "answered", question: null,
    }] };
    await fixture.api.persistState(state);
    return state;
}

function generateDrawings(fixture: Awaited<ReturnType<typeof extensionHarness>>) {
    fixture.api.setSession({ ...fixture.session, rpc: { ...fixture.session.rpc, workflow: {
        run: async (request) => {
            fixture.requests.push(request);
            return { status: "completed", runId: `drawing-${fixture.requests.length}`, result: sketchDocument() };
        },
    } } });
}

async function approveDrawings(fixture: Awaited<ReturnType<typeof extensionHarness>>) {
    const draft = await fixture.api.loadState("sample");
    assert.ok(draft.sketch.current, JSON.stringify({ processing: draft.processing, logs: fixture.logs }));
    return fixture.api.sketchAction("sample", "project:tandem", {
        action: "approve", expectedRevision: draft.sketch.current!.id,
        previews: [{ screenId: "main", data: screenPng() }],
    });
}

test("public design revisions pass workflow action validation before assessment and revision", async () => {
    const fixture = await extensionHarness();
    let server: Awaited<ReturnType<typeof fixture.api.startServer>> | undefined;
    try {
        await readyRequirements(fixture);
        const instruction = "Move the primary action below the title.";
        const revised = sketchDocument();
        revised.screens[0].ui = applyOperations(revised.screens[0].ui, [{ op: "setToken", key: "space.1", value: 100 }]);
        const assessment: ChangeAssessment = {
            version: 1, summary: "Move only the primary action.", reason: "The agreed behavior is unchanged.",
            startStage: "sketch", stages: [{ stage: "sketch", reason: "Adjust the existing screen layout." }],
            preserved: ["Accepted requirements"], affectedScreenIds: ["main"], question: null, requirements: null,
        };
        fixture.api.setSession({ ...fixture.session, rpc: { ...fixture.session.rpc, workflow: {
            run: async (request: { args: { action: string } }) => {
                fixture.requests.push(request);
                const action = request.args.action;
                assert.ok(fixture.api.answerFactory.meta.argsSchema.properties.action.enum.includes(action),
                    `Workflow argument validation rejected action "${action}".`);
                const runId = `drawing-${fixture.requests.length}`;
                if (action === "assess-change") {
                    const result = await fixture.api.answerFactory.run({
                        args: request.args, runId, phase() {}, log() {},
                        step: (_: string, work: () => Promise<unknown>) => work(),
                        agent: async (prompt: string) => {
                            assert.ok(prompt.includes(instruction));
                            assert.match(prompt, /Do not use tools/);
                            return assessment;
                        },
                    });
                    return { status: "completed", runId, result };
                }
                assert.ok(action === "generate-sketch" || action === "revise-sketch");
                return { status: "completed", runId, result: action === "revise-sketch" ? revised : sketchDocument() };
            },
        } } });
        await fixture.api.completeLifecycleStage("sample", "requirements", "project:tandem");
        await fixture.api.waitForAnswer("sample");
        const first = await fixture.api.loadState("sample");
        assert.equal(first.processing.status, "success", first.processing.message);
        server = await fixture.api.startServer("drawing-revision-http", "sample", "project:tandem", true);
        const response = await fetch(new URL("/api/sketch", server.url), {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "revise", clientRequestId: "drawing-composer-message", expectedRevision: first.sketch.current!.id,
                expectedGeneration: first.generation, instruction }),
        });
        assert.equal(response.status, 200, await response.text());
        await fixture.waitForRequests(2);
        await fixture.api.waitForAnswer("sample");
        const assessed = await fixture.api.loadState("sample");
        assert.notEqual(assessed.processing.status, "error", assessed.processing.message);
        await fixture.waitForRequests(3);
        await fixture.api.waitForAnswer("sample");
        const saved = await fixture.api.loadState("sample");
        assert.equal(saved.processing.status, "success", saved.processing.message);
        assert.equal(saved.processing.action, "revise-sketch");
        assert.equal(saved.sketch.history.length, 2);
        assert.equal(saved.sketch.current!.source, "revised");
        assert.notEqual(saved.sketch.current!.id, first.sketch.current!.id);
        assert.equal(saved.changeRequests![0].message, instruction);
        assert.equal(saved.changeRequests![0].clientRequestId, "drawing-composer-message");
        assert.equal(saved.sketch.requests.at(-1)!.baseRevisionId, first.sketch.current!.id);
        assert.deepEqual(saved.requirements, first.requirements);
        assert.deepEqual(saved.decisionGraph, first.decisionGraph);
        assert.equal(saved.generation, first.generation);
        assert.equal(saved.lifecycle.currentStage, "sketch");
        assert.equal(saved.jobOwner, null);
        assert.equal(saved.factoryRuns!.length, 3);
        assert.ok(saved.factoryRuns!.every(receipt => receipt.runId && receipt.terminal));
        const store = new SketchStore(fixture.root);
        assert.deepEqual(await store.read("sample", first.sketch.current!), sketchDocument());
        assert.deepEqual(await store.read("sample", saved.sketch.current!), revised);
        assert.equal(saved.changeRequests![0].status, "completed", "Saving a local revision must release the edit queue, not approve the stage.");
        assert.equal(saved.sketch.approved, null);
        const duplicate = await fetch(new URL("/api/sketch", server.url), {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "revise", clientRequestId: "drawing-composer-message",
                expectedRevision: first.sketch.current!.id, expectedGeneration: first.generation, instruction }),
        });
        assert.equal(duplicate.status, 200);
        const repeated = await duplicate.json();
        assert.equal(repeated.changeRequests.length, 1, "An acknowledged or retried message must keep its exact ledger identity.");
        assert.equal(repeated.changeRequests[0].id, saved.changeRequests![0].id);
        assert.equal(fixture.requests.length, 3, "A lost acknowledgement cannot repeat assessment or design work.");
        const conflict = await fetch(new URL("/api/sketch", server.url), {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "revise", clientRequestId: "drawing-composer-message",
                expectedRevision: first.sketch.current!.id, instruction: "A different change with the same ID." }),
        });
        assert.ok(conflict.status >= 400);
        assert.match((await conflict.json()).error, /different content/);
        const legacy = { ...saved, changeRequests: saved.changeRequests!.map(item => ({
            ...item, status: "active" as const, completedAt: null, remainingStages: ["sketch" as const],
        })) };
        for (const unproven of [
            { ...legacy, processing: { ...legacy.processing, status: "error" } },
            { ...legacy, processing: { ...legacy.processing, changeRequestId: "another-change" } },
            { ...legacy, factoryRuns: legacy.factoryRuns!.map(receipt => ({ ...receipt, terminal: false })) },
            { ...legacy, sketch: { ...legacy.sketch, requests: [] } },
        ]) assert.equal(completeSavedChange(unproven), unproven, "Only matching saved output and terminal receipts release a legacy request.");
        await fixture.api.persistState(legacy);
        const reopened = await extensionHarness({}, fixture.root);
        try {
            reopened.api.setSession({ ...reopened.session, sessionId: "new-drawing-session" });
            await reopened.api.openTandem({ instanceId: "legacy-drawing-change", sessionId: "new-drawing-session",
                extensionId: "project:tandem", input: { prototypeId: "sample" }, reason: "rehydrate" });
            let recovered = await reopened.api.loadState("sample");
            for (let attempt = 0; recovered.changeRequests![0].status === "active" && attempt < 300; attempt++) {
                await new Promise(resolve => setTimeout(resolve, 10));
                recovered = await reopened.api.loadState("sample");
            }
            assert.equal(recovered.changeRequests![0].status, "completed");
            assert.equal(recovered.sketch.current!.id, saved.sketch.current!.id);
            assert.equal(recovered.sketch.approved, null);
            assert.equal(reopened.requests.length, 0, "A saved legacy edit is settled, never regenerated or re-approved.");
        } finally { await reopened.close(); }
        const followUp = await fetch(new URL("/api/sketch", server.url), {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "revise", expectedRevision: saved.sketch.current!.id,
                instruction: "Use a larger gap below the primary action." }),
        });
        assert.equal(followUp.status, 200, await followUp.text());
        await fixture.waitForRequests(5);
        await fixture.api.waitForAnswer("sample");
        const updated = await fixture.api.loadState("sample");
        assert.equal(updated.sketch.history.length, 3);
        assert.ok(updated.changeRequests!.every(item => item.status === "completed"));
        assert.equal(updated.sketch.approved, null);
        assert.equal(updated.lifecycle.currentStage, "sketch");
        assert.deepEqual(await store.read("sample", saved.sketch.current!), revised);
    } finally {
        if (server) {
            clearInterval(server.heartbeat);
            await new Promise<void>((resolve, reject) => server.server.close(error => error ? reject(error) : resolve()));
        }
        await fixture.close();
    }
});

test("design requests retain original text and identity through successful and failed revisions", async () => {
    const fixture = await extensionHarness();
    try {
        await readyRequirements(fixture);
        generateDrawings(fixture);
        await fixture.api.completeLifecycleStage("sample", "requirements", "project:tandem");
        await fixture.api.waitForAnswer("sample");
        const first = await fixture.api.loadState("sample");
        const instruction = "Move the save status below the title.";
        const context = { revisionId: first.sketch.current!.id, screenId: "main", nodeId: "primary-action" };
        const pending = await fixture.api.sketchAction("sample", "project:tandem", {
            action: "revise", expectedRevision: first.sketch.current.id, instruction, sketchContext: context,
        });
        const request = pending.sketch.requests.at(-1);
        assert.equal(request.instruction, instruction);
        assert.equal(request.requestId, pending.processing.requestId);
        assert.equal(request.baseRevisionId, first.sketch.current.id);
        await fixture.api.waitForAnswer("sample");
        const saved = await fixture.api.loadState("sample");
        assert.deepEqual(saved.sketch.requests.at(-1), request);
        assert.deepEqual(JSON.parse(JSON.stringify(saved.processing.sketchContext)), context);
        assert.ok(fixture.api.answerFactoryPrompt((fixture.requests[1] as { args: unknown }).args).includes(JSON.stringify(context)));
        fixture.api.setSession({ ...fixture.session, rpc: { ...fixture.session.rpc, workflow: {
            run: async () => ({ runId: "failed-drawing", status: "failed", error: "Synthetic failure" }),
        } } });
        await fixture.api.sketchAction("sample", "project:tandem", {
            action: "revise", expectedRevision: saved.sketch.current.id, instruction: "Retain this failed request too.",
        });
        await fixture.api.waitForAnswer("sample");
        const failed = await fixture.api.loadState("sample");
        assert.equal(failed.processing.status, "error");
        assert.equal(failed.sketch.requests.at(-1).instruction, "Retain this failed request too.");
        assert.deepEqual(failed.sketch.requests[1], request);
    } finally { await fixture.close(); }
});

test("Requirements generates designs once and cannot start Prototype before explicit approval", async () => {
    const fixture = await extensionHarness();
    try {
        await readyRequirements(fixture);
        generateDrawings(fixture);
        const pending = await fixture.api.completeLifecycleStage("sample", "requirements", "project:tandem");
        assert.equal(pending.lifecycle.currentStage, "sketch");
        assert.equal(pending.processing.action, "generate-sketch");
        await fixture.waitForRequests();
        assert.deepEqual(JSON.parse(JSON.stringify((fixture.requests[0] as { options: unknown }).options)), {
            notifyOnComplete: false,
            limits: { maxConcurrentSubagents: 1, maxTotalSubagents: 1, maxAiCredits: 128 },
        });
        await fixture.api.waitForAnswer("sample");
        const draft = await fixture.api.loadState("sample");
        assert.equal(draft.sketch.status, "draft", JSON.stringify({ processing: draft.processing, logs: fixture.logs }));
        assert.equal(draft.previewUrl, null);
        assert.equal(draft.sketch.history.length, 1);
        await fixture.api.ensureSketchStarted(draft, true);
        assert.equal(fixture.requests.length, 1);
        await assert.rejects(fixture.api.beginPrototypeBuild("sample", "project:tandem"), /Prototype stage/);
        await assert.rejects(fixture.api.completeLifecycleStage("sample", "sketch", "project:tandem"), /Approve/);
        const approved = await approveDrawings(fixture);
        assert.equal(approved.sketch.status, "approved");
        assert.ok(approved.artifacts.find((artifact) => artifact.id === "sketch-spec")!.assets!.length >= 3);
        fixture.api.setSession(fixture.session);
        const prototype = await fixture.api.completeLifecycleStage("sample", "sketch", "project:tandem");
        await fixture.waitForRequests(2);
        assert.equal(prototype.lifecycle.currentStage, "prototype");
        assert.equal(prototype.prototypeFlow!.checkpoints[0].sketchRevisionId, approved.sketch.current!.id);
        const request = fixture.requests[1] as { args: { sketchInput: { document: unknown } } };
        assert.deepEqual(JSON.parse(JSON.stringify(request.args.sketchInput.document)), sketchDocument());
    } finally { await fixture.close(); }
});

test("graphical Prototype completion saves approved evidence without starting or requesting Stage2", async () => {
    const fixture = await extensionHarness();
    try {
        await readyRequirements(fixture);
        generateDrawings(fixture);
        await fixture.api.completeLifecycleStage("sample", "requirements", "project:tandem");
        await fixture.api.waitForAnswer("sample");
        const ready = await approveDrawings(fixture);
        const source = join(fixture.root, ".tandem", "efforts", "sample", "previews", "completed-fixture");
        await mkdir(source, { recursive: true });
        const html = "<!doctype html><button>Complete task</button>";
        await writeFile(join(source, "index.html"), html);
        ready.stage = ready.lifecycle.currentStage = "prototype";
        ready.lifecycle.completedStages.push("sketch");
        ready.previewStatus = "ready";
        ready.prototypeFlow = { ...newPrototypeFlow(), displayedCheckpointId: "completed-fixture", checkpoints: [{
            id: "completed-fixture", requestId: "completed-fixture", generation: ready.generation,
            milestone: "interaction", status: "ready", revisionId: null, baseCheckpointId: null, sourceCheckpointId: null,
            workspacePath: source, workspacePrepared: true, previewUrl: "http://127.0.0.1:12345/", summary: "Synthetic retained HTML fixture",
            focus: "", requestedAt: ready.updatedAt, completedAt: ready.updatedAt, timeoutSeconds: 300,
            sourceFingerprint: await fingerprintPrototypeWorkspace(source),
            sketchRevisionId: ready.sketch.current!.id, sketchInputHash: ready.sketch.current!.documentHash,
        }] };
        ready.prototypeFlow.checkpoints.unshift({ ...ready.prototypeFlow.checkpoints[0],
            id: "structure-fixture", requestId: "structure-fixture", milestone: "structure" });
        ready.prototypeReview.designSpecArtifactId = "draft-feature-spec";
        ready.artifacts.push({ id: "draft-feature-spec", title: "Feature evidence", stage: "prototype",
            kind: "design-spec", path: "", language: "markdown", content: "Confirmed task interaction.", mermaid: "" });
        await fixture.api.persistState(ready);
        fixture.setBeforeDevelopmentStart(async () => { throw new Error("Stage1 cannot depend on private startup."); });
        const completed = await fixture.api.completeLifecycleStage("sample", "prototype", "project:tandem");
        assert.equal(completed.lifecycle.currentStage, "development");
        assert.equal(completed.status, "Prototype saved. Continue in Development when you're ready.");
        assert.ok(completed.development == null);
        assert.equal(fixture.developmentRequests.length, 0);
        assert.equal(fixture.requests.length, 1, "Only the explicitly mocked Stage1 sketch generation ran.");
        await assert.rejects(access(join(fixture.root, ".tandem", "living-canvas")), { code: "ENOENT" });
        const output = completed.lifecycle.outputs.find(value => value.stageId === "prototype")!;
        const snapshot = JSON.parse(await readFile(join(fixture.root, output.path), "utf8"));
        assert.equal(snapshot.result.prototypeFlow.checkpoints[0].sourceFingerprint, ready.prototypeFlow.checkpoints[0].sourceFingerprint);
        assert.equal(snapshot.result.sketch.approved.revisionId, ready.sketch.approved!.revisionId);
        assert.equal(await readFile(join(source, "index.html"), "utf8"), html);
        await new SketchStore(fixture.root).verifyApproval("sample", ready.sketch.current!, ready.sketch.approved!);
    } finally { await fixture.close(); }
});

test("design edits create immutable revisions and stale saves or previews cannot be approved", async () => {
    const fixture = await extensionHarness();
    try {
        await readyRequirements(fixture);
        generateDrawings(fixture);
        await fixture.api.completeLifecycleStage("sample", "requirements", "project:tandem");
        await fixture.api.waitForAnswer("sample");
        const approved = await approveDrawings(fixture);
        const revised = sketchDocument();
        revised.screens[0].notes = "The user changed the layout.";
        const edited = await fixture.api.sketchAction("sample", "project:tandem", {
            action: "save", expectedRevision: approved.sketch.current!.id, document: revised,
        });
        assert.equal(edited.sketch.approved, null);
        assert.equal(edited.sketch.history.length, 2);
        assert.notEqual(edited.sketch.current!.id, approved.sketch.current!.id);
        const store = new SketchStore(fixture.root);
        assert.equal((await store.read("sample", approved.sketch.current!)).screens[0].notes, sketchDocument().screens[0].notes);
        await assert.rejects(fixture.api.sketchAction("sample", "project:tandem", {
            action: "save", expectedRevision: approved.sketch.current!.id, document: revised,
        }), /changed in another view/);
        await assert.rejects(fixture.api.sketchAction("sample", "project:tandem", {
            action: "approve", expectedRevision: edited.sketch.current!.id,
            previews: [{ screenId: "main", data: screenPng(240, 240) }],
        }), /dimensions|viewport|size/i);
    } finally { await fixture.close(); }
});

test("design requests retain generation and revision boundaries and use the existing worker", async () => {
    const fixture = await extensionHarness();
    try {
        await readyRequirements(fixture);
        generateDrawings(fixture);
        await fixture.api.completeLifecycleStage("sample", "requirements", "project:tandem");
        await fixture.api.waitForAnswer("sample");
        const before = await fixture.api.loadState("sample");
        for (const action of ["save", "revise"]) {
            await assert.rejects(fixture.api.sketchAction("sample", "project:tandem", {
                action, expectedRevision: before.sketch.current!.id, expectedGeneration: "old-effort",
                ...(action === "save" ? { document: sketchDocument() } : { instruction: "Move the primary action." }),
            }), /effort changed/);
        }
        assert.equal(fixture.requests.length, 1);
        await fixture.api.sketchAction("sample", "project:tandem", {
            action: "revise", expectedRevision: before.sketch.current!.id, expectedGeneration: before.generation,
            instruction: "Move the primary action to the right.",
        });
        await fixture.api.waitForAnswer("sample");
        const after = await fixture.api.loadState("sample");
        assert.equal(after.processing.status, "success");
        assert.equal(after.sketch.current!.source, "revised");
        assert.equal(after.sketch.history.length, 2);
        assert.equal(after.sketch.approved, null);
        assert.equal(after.lifecycle.currentStage, "sketch");
        assert.equal(after.generation, before.generation);
    } finally { await fixture.close(); }
});

async function strandedDrawing(fixture: Awaited<ReturnType<typeof extensionHarness>>) {
    await readyRequirements(fixture);
    generateDrawings(fixture);
    await fixture.api.completeLifecycleStage("sample", "requirements", "project:tandem");
    await fixture.api.waitForAnswer("sample");
    const approved = await approveDrawings(fixture);
    const state = await fixture.api.loadState("sample");
    state.processing = {
        status: "error", action: "revise-sketch", requestId: "stranded-drawing",
        factoryName: "tandem-process-answer-session", runId: "stranded-run",
        requestedAt: new Date().toISOString(), completedAt: new Date().toISOString(),
        message: "EPERM: operation not permitted, rename state.json.tmp -> state.json",
        answer: "Improve the coffee cup.",
        sketchRequest: { generation: state.generation, baseRevisionId: state.sketch.current!.id,
            requirementsDigest: state.sketch.current!.requirementsDigest },
    };
    state.factoryRuns!.push({ requestId: state.processing.requestId, generation: state.generation,
        runId: state.processing.runId, terminal: false });
    await fixture.api.persistState(state);
    return { approved, state: await fixture.api.loadState("sample") };
}

test("a failed terminal-receipt save releases design work only after SDK verification on retry", async () => {
    const fixture = await extensionHarness();
    let blockedWrites = 0;
    let verified = 0;
    try {
        await readyRequirements(fixture);
        generateDrawings(fixture);
        await fixture.api.completeLifecycleStage("sample", "requirements", "project:tandem");
        await fixture.api.waitForAnswer("sample");
        const before = await approveDrawings(fixture);
        const statePath = join(fixture.root, ".tandem", "efforts", "sample", "state.json");
        const run = { status: "completed", runId: "failed-save-run", result: sketchDocument() };
        fixture.api.setSession({ ...fixture.session, workflow: {
            getRun: async (id: string) => { assert.equal(id, run.runId); verified++; return run; },
        }, rpc: { ...fixture.session.rpc, workflow: {
            run: async (request) => {
                fixture.requests.push(request);
                const current = await fixture.api.loadState("sample");
                current.processing.runId = run.runId;
                current.factoryRuns!.at(-1)!.runId = run.runId;
                await fixture.api.persistState(current);
                return run;
            },
        } } });
        fixture.setRename(async (source, target) => {
            if (target === statePath) {
                const next = JSON.parse(await readFile(source, "utf8"));
                if (next.processing?.runId === run.runId && next.processing.status === "running"
                    && next.factoryRuns.at(-1).terminal) {
                    blockedWrites++;
                    throw Object.assign(new Error("EPERM: state file is locked"), { code: "EPERM" });
                }
            }
            await rename(source, target);
        });
        await fixture.api.sketchAction("sample", "project:tandem", {
            action: "revise", expectedRevision: before.sketch.current!.id, instruction: "Improve the coffee cup.",
        });
        await fixture.api.waitForAnswer("sample");
        const failed = await fixture.api.loadState("sample");
        assert.ok(blockedWrites > 0);
        assert.equal(failed.processing.status, "error");
        assert.match(failed.processing.message, /EPERM|Cannot replace/);
        assert.equal(failed.factoryRuns!.at(-1)!.terminal, false);
        assert.ok(failed.jobOwner);
        const drawing = (sketch: typeof before.sketch) => {
            const { requests, ...result } = sketch;
            return JSON.stringify(result);
        };
        assert.equal(drawing(failed.sketch), drawing(before.sketch));
        assert.equal(failed.sketch.requests.at(-1).instruction, "Improve the coffee cup.");
        fixture.setRename(rename);
        fixture.api.setSession({ ...fixture.session, workflow: {
            getRun: async (id: string) => { assert.equal(id, run.runId); verified++; return run; },
        } });
        const retried = await fixture.api.sketchAction("sample", "project:tandem", {
            action: "revise", expectedRevision: before.sketch.current!.id, instruction: "Improve the cup handle.",
        });
        await fixture.waitForRequests(3);
        assert.equal(verified, 1);
        assert.notEqual(retried.processing.requestId, failed.processing.requestId);
        assert.equal(retried.factoryRuns!.find((receipt) => receipt.requestId === failed.processing.requestId)!.terminal, true);
        assert.equal(drawing(retried.sketch), drawing(before.sketch), "Recovery must not apply an uncommitted result.");
        assert.equal(retried.sketch.requests.at(-1).instruction, "Improve the cup handle.");
        assert.equal(retried.generation, before.generation);
    } finally { await fixture.close(); }
});

test("rehydration releases failed design receipts for SDK-confirmed terminal runs without launching workers", async (t) => {
    for (const status of ["completed", "failed", "cancelled", "halted"]) {
        await t.test(status, async () => {
            const fixture = await extensionHarness();
            try {
                const { state } = await strandedDrawing(fixture);
                const fresh = await extensionHarness({}, fixture.root);
                let reads = 0;
                try {
                    fresh.api.setSession({ ...fresh.session, workflow: {
                        getRun: async (runId: string) => {
                            assert.equal(runId, state.processing.runId);
                            reads++;
                            return { runId, status, result: sketchDocument() };
                        },
                    } });
                    await fresh.api.openTandem({ instanceId: "recovered-sketch", extensionId: "project:tandem",
                        sessionId: fresh.session.sessionId, reason: "rehydrate", input: { prototypeId: "sample" } });
                    await fresh.api.waitForAnswer("sample");
                    const recovered = await fresh.api.loadState("sample");
                    assert.equal(reads, 1);
                    assert.equal(recovered.jobOwner, null);
                    assert.equal(recovered.factoryRuns!.at(-1)!.terminal, true);
                    assert.equal(recovered.factoryRuns!.at(-1)!.runId, state.processing.runId);
                    assert.equal(JSON.stringify(recovered.processing), JSON.stringify(state.processing));
                    assert.equal(JSON.stringify(recovered.sketch), JSON.stringify(state.sketch));
                    assert.equal(JSON.stringify(recovered.factoryRuns!.slice(0, -1)), JSON.stringify(state.factoryRuns!.slice(0, -1)));
                    assert.equal(recovered.generation, state.generation);
                    assert.equal(fresh.requests.length, 0);
                } finally { await fresh.close(); }
            } finally { await fixture.close(); }
        });
    }
});

test("running, unknown, conflicting, and foreign design jobs cannot be released or duplicated", async (t) => {
    for (const kind of ["running", "unavailable", "wrong-run", "conflicting", "foreign"]) {
        await t.test(kind, async () => {
            const fixture = await extensionHarness();
            try {
                const { state } = await strandedDrawing(fixture);
                if (kind === "conflicting") state.factoryRuns!.at(-1)!.runId = "different-run";
                if (kind === "foreign") state.jobOwner = { sessionId: "foreign-session", workspaceRoot: fixture.root };
                await fixture.api.persistState(state);
                let reads = 0;
                fixture.api.setSession({ ...fixture.session, workflow: {
                    getRun: async (runId: string) => {
                        reads++;
                        if (kind === "unavailable") throw new Error("SDK connection closed");
                        return { runId: kind === "wrong-run" ? "different-run" : runId,
                            status: kind === "running" ? "running" : "completed" };
                    },
                } });
                await assert.rejects(fixture.api.sketchAction("sample", "project:tandem", {
                    action: "revise", expectedRevision: state.sketch.current!.id, instruction: "Improve the handle.",
                }), kind === "running" ? /Wait for active/ : kind === "foreign" ? /another session/
                    : kind === "conflicting" ? /conflicting factory run identities/ : /could not be verified/);
                assert.equal(reads, ["conflicting", "foreign"].includes(kind) ? 0 : 1);
                assert.equal(JSON.stringify(await fixture.api.loadState("sample")), JSON.stringify(state));
                assert.equal(fixture.requests.length, 1);
            } finally { await fixture.close(); }
        });
    }
});

test("failed design recovery correlates missing run IDs using SDK request logs, never by timing alone", async (t) => {
    for (const matching of [true, false]) {
        await t.test(matching ? "matching request" : "unrelated request", async () => {
            const fixture = await extensionHarness();
            try {
                const { state } = await strandedDrawing(fixture);
                state.processing.runId = null;
                state.factoryRuns!.at(-1)!.runId = null;
                await fixture.api.persistState(state);
                let verified = false;
                fixture.api.setSession({ ...fixture.session, workflow: {
                    listRuns: async () => [{ runId: "correlated-run", workflowName: state.processing.factoryName,
                        createdAt: Date.parse(state.processing.requestedAt) }],
                    getRunProgress: async () => ({ records: [{
                        text: `Request ${matching ? state.processing.requestId : "unrelated-request"}; prototype sample;`,
                    }] }),
                    getRun: async (runId: string) => { verified = true; return { runId, status: "failed" }; },
                } });
                if (matching) {
                    fixture.api.recoverAnswerFactory(state, true);
                    await fixture.api.waitForAnswer("sample");
                    const recovered = await fixture.api.loadState("sample");
                    assert.equal(verified, true);
                    assert.equal(recovered.factoryRuns!.at(-1)!.terminal, true);
                    assert.equal(recovered.factoryRuns!.at(-1)!.runId, "correlated-run");
                    assert.equal(recovered.processing.runId, "correlated-run");
                    assert.equal(recovered.processing.status, "error");
                    assert.equal(recovered.jobOwner, null);
                    assert.equal(JSON.stringify(recovered.sketch), JSON.stringify(state.sketch));
                } else {
                    await assert.rejects(fixture.api.sketchAction("sample", "project:tandem", {
                        action: "revise", expectedRevision: state.sketch.current!.id, instruction: "Improve the cup.",
                    }), /could not be verified/);
                    assert.equal(verified, false);
                    assert.equal(JSON.stringify(await fixture.api.loadState("sample")), JSON.stringify(state));
                }
                assert.equal(fixture.requests.length, 1);
            } finally { await fixture.close(); }
        });
    }
});

test("design recovery waits for termination and rechecks the request before releasing its receipt", async (t) => {
    for (const replaced of [false, true]) {
        await t.test(replaced ? "replaced request" : "same request", async () => {
            const fixture = await extensionHarness();
            try {
                const { state } = await strandedDrawing(fixture);
                let finish!: (run: { runId: string; status: string }) => void;
                let started!: () => void;
                const waiting = new Promise<void>((resolve) => { started = resolve; });
                const terminal = new Promise<{ runId: string; status: string }>((resolve) => { finish = resolve; });
                fixture.api.setSession({ ...fixture.session, workflow: {
                    getRun: async (runId: string) => ({ runId, status: "running" }),
                    waitForRun: async (runId: string) => { assert.equal(runId, state.processing.runId); started(); return terminal; },
                } });
                fixture.api.recoverAnswerFactory(state, true);
                await waiting;
                const current = await fixture.api.loadState("sample");
                assert.equal(current.factoryRuns!.at(-1)!.terminal, false);
                assert.ok(current.jobOwner);
                if (replaced) {
                    current.processing = { ...current.processing, requestId: "replacement-request", runId: "replacement-run" };
                    current.factoryRuns!.push({ generation: current.generation, requestId: "replacement-request",
                        runId: "replacement-run", terminal: false });
                    await fixture.api.persistState(current);
                }
                finish({ runId: state.processing.runId, status: "cancelled" });
                await fixture.api.waitForAnswer("sample");
                const recovered = await fixture.api.loadState("sample");
                if (replaced) {
                    assert.equal(JSON.stringify(recovered), JSON.stringify(current));
                } else {
                    assert.equal(recovered.factoryRuns!.at(-1)!.terminal, true);
                    assert.equal(recovered.jobOwner, null);
                    assert.equal(JSON.stringify(recovered.sketch), JSON.stringify(state.sketch));
                }
                assert.equal(fixture.requests.length, 1);
            } finally { await fixture.close(); }
        });
    }
});

test("no-GUI efforts skip both graphical stages with snapshots and a reason", async () => {
    const fixture = await extensionHarness();
    try {
        await readyRequirements(fixture, true);
        const state = await fixture.api.completeLifecycleStage("sample", "requirements", "project:tandem");
        assert.equal(state.lifecycle.currentStage, "development");
        assert.deepEqual(Array.from(state.lifecycle.skippedStages, (stage) => stage.stageId), ["sketch", "prototype"]);
        for (const stageId of ["sketch", "prototype"]) {
            const output = state.lifecycle.outputs.find((entry) => entry.stageId === stageId)!;
            const snapshot = JSON.parse(await readFile(join(fixture.root, output.path), "utf8"));
            assert.equal(snapshot.skipped, true);
            assert.equal(snapshot.skipReason, "CLI only.");
        }
    } finally { await fixture.close(); }
});

test("legacy progressed efforts retain stage/history without invented sketch approval", async () => {
    const fixture = await extensionHarness();
    try {
        const state = fixture.api.createLegacyState("sample");
        state.stage = state.lifecycle.currentStage = "plan";
        state.lifecycle.completedStages = ["prepare", "requirements", "prototype", "design"];
        state.lifecycle.outputs = [{ stageId: "prototype", path: "existing.json", completedAt: "before" }];
        await fixture.api.persistState(state);
        const migrated = await fixture.api.loadState("sample");
        assert.equal(migrated.lifecycle.currentStage, "development");
        assert.equal(migrated.lifecycle.version, 3);
        assert.ok(migrated.lifecycle.completedStages.includes("sketch"));
        assert.match(migrated.lifecycle.skippedStages.find((entry) => entry.stageId === "sketch")!.reason, /before Designs/);
        assert.equal(migrated.sketch.approved, null);
        assert.equal(migrated.lifecycle.outputs[0].path, "existing.json");
        const reopened = await fixture.api.reopenLifecycleStage("sample", "requirements", "project:tandem");
        assert.equal(reopened.lifecycle.skippedStages.length, 0);
        assert.deepEqual(Array.from(reopened.lifecycle.completedStages), ["prepare"]);
    } finally { await fixture.close(); }
});

test("reopening Sketch invalidates prototype checkpoints but preserves design and stage history", async () => {
    const fixture = await extensionHarness();
    try {
        await readyRequirements(fixture);
        generateDrawings(fixture);
        await fixture.api.completeLifecycleStage("sample", "requirements", "project:tandem");
        await fixture.api.waitForAnswer("sample");
        const approved = await approveDrawings(fixture);
        approved.stage = approved.lifecycle.currentStage = "design";
        approved.lifecycle.completedStages = ["prepare", "requirements", "sketch", "prototype"];
        approved.lifecycle.outputs.push({ stageId: "sketch", path: "sketch.json", completedAt: "before" });
        approved.previewUrl = "http://127.0.0.1:12345/";
        approved.previewStatus = "ready";
        await fixture.api.persistState(approved);
        const reopened = await fixture.api.reopenLifecycleStage("sample", "sketch", "project:tandem");
        assert.equal(reopened.sketch.status, "draft");
        assert.equal(reopened.sketch.current!.id, approved.sketch.current!.id);
        assert.equal(reopened.sketch.approved, null);
        assert.equal(reopened.previewUrl, null);
        assert.equal(reopened.prototypeFlow, null);
        assert.ok(reopened.lifecycle.history.some((entry) => entry.path === "sketch.json"));
        assert.equal(reopened.artifacts.find((entry) => entry.id === "sketch-spec")!.reviewStatus, "stale");
    } finally { await fixture.close(); }
});

test("legacy non-GUI efforts preserve their applicability reason for Sketch", async () => {
    const fixture = await extensionHarness();
    try {
        const state = fixture.api.createLegacyState("sample");
        state.stage = state.lifecycle.currentStage = "design";
        state.lifecycle.completedStages = ["prepare", "requirements", "prototype"];
        state.prototypeApproach = { mode: "not-applicable", reason: "CLI only." };
        state.lifecycle.skippedStages = [{ stageId: "prototype", reason: "CLI only.", skippedAt: state.updatedAt }];
        await fixture.api.persistState(state);
        const migrated = await fixture.api.loadState("sample");
        assert.equal(migrated.lifecycle.currentStage, "development");
        assert.equal(migrated.lifecycle.skippedStages.find((entry) => entry.stageId === "sketch")!.reason, "CLI only.");
    } finally { await fixture.close(); }
});

test("prototype readiness requires actual approved image delivery, not worker claims", async () => {
    const fixture = await extensionHarness();
    try {
        await readyRequirements(fixture);
        generateDrawings(fixture);
        await fixture.api.completeLifecycleStage("sample", "requirements", "project:tandem");
        await fixture.api.waitForAnswer("sample");
        await approveDrawings(fixture);
        let deliverImage = false;
        let imageCalls = 0;
        fixture.api.setSession({ ...fixture.session, rpc: { ...fixture.session.rpc, workflow: {
            run: async (request) => {
                fixture.requests.push(request);
                const checkpoint = request.args.state.prototypeFlow.checkpoints.at(-1);
                if (deliverImage) {
                    const imageRequest = {
                        prototypeId: "sample", checkpointId: checkpoint.id,
                        revisionId: checkpoint.sketchRevisionId, screenId: "main",
                    };
                    if (imageCalls === 0) {
                        const running = await fixture.api.loadState("sample");
                        const bound = running.prototypeFlow!.checkpoints.find((item) => item.id === checkpoint.id)!;
                        bound.generation = "superseded-generation";
                        await fixture.api.persistState(running);
                        await assert.rejects(fixture.api.readSketchImage(imageRequest), /does not match/);
                        bound.generation = running.generation;
                        bound.requestId = "superseded-request";
                        await fixture.api.persistState(running);
                        await assert.rejects(fixture.api.readSketchImage(imageRequest), /does not match/);
                        bound.requestId = running.processing.requestId;
                        await fixture.api.persistState(running);
                    }
                    const image = await fixture.api.readSketchImage(imageRequest);
                    assert.equal(image.binaryResultsForLlm[0].mimeType, "image/png");
                    assert.equal(image.binaryResultsForLlm[0].data, screenPng());
                    imageCalls++;
                }
                fixture.setPreviewHtml(`<meta name="tandem-prototype-id" content="sample"><meta name="tandem-prototype-checkpoint" content="${checkpoint.id}">`);
                return { status: "completed", runId: `prototype-${fixture.requests.length}`, result: {
                    summary: "Implemented approved designs.", focus: "Try the primary action.",
                    previewUrl: `http://127.0.0.1:${13000 + fixture.requests.length}`,
                    question: null, artifactChanges: { upsert: [], remove: [] }, evidence: ["I viewed the sketches."],
                } };
            },
        } } });
        await fixture.api.completeLifecycleStage("sample", "sketch", "project:tandem");
        await fixture.api.waitForAnswer("sample");
        let state = await fixture.api.loadState("sample");
        assert.equal(state.previewStatus, "error");
        assert.match(state.processing.message, /did not read every approved sketch image/);
        deliverImage = true;
        await fixture.api.prototypeAction("sample", "project:tandem", { action: "retry" });
        await fixture.api.waitForAnswer("sample");
        await fixture.waitForRequests(4);
        await fixture.api.waitForAnswer("sample");
        state = await fixture.api.loadState("sample");
        assert.equal(state.previewStatus, "ready", state.processing?.message);
        assert.ok(imageCalls >= 2);
        await assert.rejects(fixture.api.readSketchImage({
            prototypeId: "sample", checkpointId: "wrong", revisionId: state.sketch.current!.id, screenId: "main",
        }), /does not match/);
    } finally { await fixture.close(); }
});

test("changed approved asset bytes block the sketch-to-prototype handoff", async () => {
    const fixture = await extensionHarness();
    try {
        await readyRequirements(fixture);
        generateDrawings(fixture);
        await fixture.api.completeLifecycleStage("sample", "requirements", "project:tandem");
        await fixture.api.waitForAnswer("sample");
        const approved = await approveDrawings(fixture);
        const png = approved.sketch.approved!.assets.find((asset) => asset.mediaType === "image/png")!;
        await writeFile(join(fixture.root, png.path), "tampered");
        await assert.rejects(fixture.api.completeLifecycleStage("sample", "sketch", "project:tandem"), /hash|changed|integrity|PNG/i);
        assert.equal((await fixture.api.loadState("sample")).lifecycle.currentStage, "sketch");
    } finally { await fixture.close(); }
});

test("the real Sketch stage snapshot accepts and exports frozen image bytes", async () => {
    const fixture = await extensionHarness();
    try {
        await readyRequirements(fixture);
        generateDrawings(fixture);
        await fixture.api.completeLifecycleStage("sample", "requirements", "project:tandem");
        await fixture.api.waitForAnswer("sample");
        const approved = await approveDrawings(fixture);
        fixture.api.setSession({ ...fixture.session, rpc: { ...fixture.session.rpc, workflow: {
            run: async () => ({ status: "failed", runId: "prototype-paused", error: "No AI in this fixture." }),
        } } });
        await fixture.api.completeLifecycleStage("sample", "sketch", "project:tandem");
        await fixture.api.waitForAnswer("sample");
        const current = await fixture.api.loadState("sample");
        const accepted = await fixture.api.processAction("sample", "project:tandem", {
            action: "accept", expectedRevision: current.revision, stageId: "sketch", approver: "Product owner",
        });
        const record = accepted.process.acceptances[0];
        const png = approved.sketch.approved!.assets.find((asset) => asset.mediaType === "image/png")!;
        await writeFile(join(fixture.root, png.path), "Changed after acceptance.");
        const exported = await fixture.api.processAction("sample", "project:tandem", {
            action: "export", expectedRevision: accepted.revision, acceptanceId: record.id,
        });
        const directory = join(fixture.root, exported.process.acceptances[0].exportPath!);
        const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
        const image = manifest.assetFiles.find((file) => file.asset.mediaType === "image/png");
        assert.equal((await readFile(join(directory, image.path))).toString("base64"), screenPng());
        const ui = manifest.assetFiles.find((file) => file.asset.path.endsWith(".ui.json"));
        const source = manifest.assetFiles.find((file) => file.asset.id === "document");
        assert.deepEqual(JSON.parse(await readFile(join(directory, ui.path), "utf8")), sketchDocument().screens[0].ui);
        assert.equal(JSON.parse(await readFile(join(directory, source.path), "utf8")).version, 2);
        assert.equal(manifest.assetFiles.some((file) => file.asset.mediaType === "image/svg+xml"), false);
        assert.equal(manifest.acceptance.stageId, "sketch");
    } finally { await fixture.close(); }
});

test("failed design jobs preserve drafts and never retry implicitly after reload", async () => {
    const fixture = await extensionHarness();
    try {
        await readyRequirements(fixture);
        generateDrawings(fixture);
        await fixture.api.completeLifecycleStage("sample", "requirements", "project:tandem");
        await fixture.api.waitForAnswer("sample");
        const draft = await fixture.api.loadState("sample");
        fixture.api.setSession({ ...fixture.session, rpc: { ...fixture.session.rpc, workflow: {
            run: async (request) => {
                fixture.requests.push(request);
                return { status: "failed", runId: "failed-revision", error: "Design worker exceeded its budget." };
            },
        } } });
        await fixture.api.sketchAction("sample", "project:tandem", {
            action: "revise", expectedRevision: draft.sketch.current!.id, instruction: "Place the button below the content.",
        });
        await fixture.api.waitForAnswer("sample");
        const failed = await fixture.api.loadState("sample");
        assert.equal(failed.sketch.current!.id, draft.sketch.current!.id);
        assert.equal(failed.processing.status, "error");
        assert.match(failed.processing.message, /budget/);
        await fixture.api.ensureSketchStarted(failed, true);
        assert.equal(fixture.requests.length, 2);
        const saved = await fixture.api.sketchAction("sample", "project:tandem", {
            action: "save", expectedRevision: draft.sketch.current!.id, document: sketchDocument(),
        });
        assert.equal(saved.processing, null);
    } finally { await fixture.close(); }
});

test("sketch HTTP transport accepts bounded scenes above the ordinary request limit and rejects stale edits", async () => {
    const fixture = await extensionHarness();
    try {
        await readyRequirements(fixture);
        generateDrawings(fixture);
        await fixture.api.completeLifecycleStage("sample", "requirements", "project:tandem");
        await fixture.api.waitForAnswer("sample");
        const opened = await fixture.api.openTandem({
            instanceId: "sketch-http", extensionId: "project:tandem", sessionId: "fixture-session",
            input: { prototypeId: "sample" },
        });
        const url = new URL("/api/sketch", opened.url);
        const loaded = await (await fetch(url)).json();
        assert.equal(loaded.document.screens[0].id, "main");
        const document = sketchDocument();
        document.screens[0].ui = createDocument();
        for (let index = 0; index < 80; index++) addUi(document.screens[0], `label-${index}`, "Text", { text: "x".repeat(500) });
        const body = JSON.stringify({ action: "save", expectedRevision: loaded.sketch.current.id, document });
        assert.ok(Buffer.byteLength(body) > 32 * 1024);
        const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
        assert.equal(response.status, 200, await response.text());
        const conflict = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
        assert.equal(conflict.status, 409);
        assert.match((await conflict.json()).error, /changed in another view/);
    } finally { await fixture.close(); }
});

test("production design/prototype prompts bind UI DSL semantics and derived image transport", () => {
    const sketch = buildSketchPrompt({
        prototypeId: "sample", projectRoot: "C:\\app", action: "generate-sketch", instruction: "Draw it.",
        requirements: { decisions: ["Accepted decision"] }, approach: "validate-existing", document: null,
    });
    assert.match(sketch, /decision DAG is NOT a navigation graph/);
    assert.match(sketch, /SAME existing GUI/);
    assert.match(sketch, /whole-number dimensions from 1 to 10000/);
    assert.match(sketch, /Preserve user-selected dimensions/);
    assert.match(sketch, /Component catalog:/);
    assert.match(sketch, /wrap EVERY DSL edit/);
    assert.match(sketch, /upsert-screen metadata for ALL planned pages.*before ANY ui edit/);
    assert.match(sketch, /build one page at a time.*screen-status processing.*screen-status ready/);
    assert.match(sketch, /"op":"screen-status","screenId":"home","status":"processing"/);
    assert.match(sketch, /"op":"screen-status","screenId":"home","status":"ready"/);
    assert.match(sketch, /"op":"ui"/);
    assert.match(sketch, /tool-free worker has no get_icons or searchIcons tool/);
    assert.match(sketch, /Use trash, not trash-2, and funnel, not filter/);
    const prefix = "Bundled icon names available to this tool-free worker: ";
    const palette = sketch.split("\n").find(line => line.startsWith(prefix));
    assert.ok(palette);
    const names: unknown = JSON.parse(palette.slice(prefix.length));
    assert.ok(Array.isArray(names) && names.length > 0 && names.length <= 100, "The worker receives a bounded palette, not the registry.");
    assert.equal(new Set(names).size, names.length);
    assert.ok(names.includes("trash") && !names.includes("trash-2"));
    for (const name of names) assert.equal(searchIcons({ query: name, limit: 1 }).names[0], name);
    assert.doesNotMatch(sketch, /Shapes use rectangle|Quadratic Bezier|Cubic Bezier|Catmull-Rom/);
    const update = buildSketchPrompt({
        prototypeId: "sample", projectRoot: "C:\\app", action: "revise-sketch", instruction: "Update for accepted requirements.",
        requirements: { decisions: ["Accepted decision"] }, approach: "build", document: sketchDocument(),
    });
    assert.match(update, /INCREMENTAL UPDATE.*previousDocument as the editable baseline/);
    assert.match(update, /reviewed choices and user refinements/);
    assert.match(update, /Use ui edits against existing node IDs/);
    assert.match(update, /Retain unrelated screens, layout, styling/);
    assert.match(update, /Keep each existing screen's viewport dimensions/);
    assert.doesNotMatch(update, /Start from an empty sketch set|TITLE-FIRST ORDER|upsert-screen metadata for ALL planned pages|commonly 960x640/);
    assert.match(sketch, /Start from an empty sketch set/);
    const prototype = buildPrototypeCheckpointPrompt({
        prototypeId: "sample", projectRoot: "C:\\app", goal: "Task app", approach: "build",
        requirements: {}, confirmed: [],
        checkpoint: { id: "checkpoint", milestone: "structure", workspacePath: "C:\\app\\.tandem\\previews\\checkpoint",
            timeoutSeconds: 300, baseCheckpointId: null },
        sketch: { revisionId: "approved", documentHash: "hash", requirementsDigest: "digest",
            imageTool: "tandem_read_sketch_image_project", document: sketchDocument() },
    });
    assert.match(prototype, /Read EVERY approved screen image/);
    assert.match(prototype, /tandem_read_sketch_image_project/);
    assert.match(prototype, /Keep the primary action visible/);
    assert.match(prototype, /APPROVED UI DSL/);
    assert.match(prototype, /approvedUiDsl\.document.*authoritative structured UI input/);
    assert.match(prototype, /"version": 2/);
    assert.doesNotMatch(prototype, /"shapes":/);
});

test("legacy approvals remain intact and require explicit DSL regeneration before editing or continuing", async () => {
    const fixture = await extensionHarness();
    try {
        await readyRequirements(fixture);
        generateDrawings(fixture);
        await fixture.api.completeLifecycleStage("sample", "requirements", "project:tandem");
        await fixture.api.waitForAnswer("sample");
        const draft = await approveDrawings(fixture);
        const { ui: _ui, ...metadata } = sketchDocument().screens[0];
        const legacy = { version: 1 as const, screens: [{ ...metadata, shapes: [{
            id: "original", kind: "rectangle" as const, x: 20, y: 20, width: 120, height: 40,
            text: "", points: [], stroke: "#333333", fill: "#eeeeee", fontSize: 16,
        }] }], transitions: [] };
        const store = new SketchStore(fixture.root);
        const revision = await store.save("sample", legacy, {
            number: 2, source: "edited", requirementsDigest: draft.sketch.current!.requirementsDigest,
        });
        const approved = await store.approve("sample", revision, [{ screenId: "main", data: screenPng() }]);
        const state = { ...draft, processing: null, sketch: { ...draft.sketch, status: "approved" as const,
            current: revision, approved, history: [...draft.sketch.history, revision] } };
        await fixture.api.persistState(state);
        const files = await Promise.all(approved.assets.map(async asset =>
            ({ path: join(fixture.root, asset.path), content: await readFile(join(fixture.root, asset.path)) })));
        for (const input of [
            { action: "save", document: legacy },
            { action: "update" },
            { action: "revise", instruction: "Move the action." },
            { action: "approve", previews: [{ screenId: "main", data: screenPng() }] },
        ]) await assert.rejects(fixture.api.sketchAction("sample", "project:tandem", {
            ...input, expectedRevision: revision.id,
        }), /UI DSL/);
        await assert.rejects(fixture.api.completeLifecycleStage("sample", "sketch", "project:tandem"), /regenerate UI DSL/);
        const stale = { ...state, sketch: { ...state.sketch, status: "stale" as const } };
        await fixture.api.persistState(stale);
        const before = fixture.requests.length;
        await fixture.api.ensureSketchStarted(stale, true);
        assert.equal(fixture.requests.length, before, "opening stale legacy designs must not trigger conversion");
        await fixture.api.sketchAction("sample", "project:tandem", { action: "generate", expectedRevision: revision.id });
        await fixture.api.waitForAnswer("sample");
        const next = await fixture.api.loadState("sample");
        assert.equal(next.processing?.status, "success", next.processing?.message);
        assert.equal(next.sketch.status, "draft");
        assert.equal(next.sketch.approved, null);
        assert.ok(next.sketch.history.some(item => item.id === revision.id));
        assert.equal((await store.read("sample", next.sketch.current!)).version, 2);
        assert.deepEqual(await store.verifyApproval("sample", revision, approved), legacy);
        for (const file of files) assert.deepEqual(await readFile(file.path), file.content);
    } finally { await fixture.close(); }
});

test("requirements updates never fall back to generating designs without a saved baseline", async () => {
    const fixture = await extensionHarness();
    try {
        const state = fixture.api.createState("sample", "A task app");
        state.stage = state.lifecycle.currentStage = "sketch";
        state.lifecycle.completedStages = ["prepare", "requirements"];
        state.preparation.status = "ready";
        state.prototypeApproach = { mode: "build", reason: "Task UI" };
        await fixture.api.persistState(state);
        await assert.rejects(fixture.api.sketchAction("sample", "project:tandem", {
            action: "update", expectedRevision: null,
        }), /Generate or save designs before requesting an incremental update/);
        assert.equal((await fixture.api.loadState("sample")).sketch.current, null);
        assert.equal(fixture.requests.length, 0);
    } finally { await fixture.close(); }
});
