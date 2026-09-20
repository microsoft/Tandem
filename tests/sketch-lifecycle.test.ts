import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { extensionHarness } from "./helpers/extension-harness.js";
import { sketchDocument, screenPng } from "./helpers/sketch-lifecycle-fixture.js";
import { SketchStore } from "../src/sketch-store.js";
import { buildPrototypeCheckpointPrompt, buildSketchPrompt } from "../src/planning-prompts.js";

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
    fixture.api.setSession({ ...fixture.session, rpc: { ...fixture.session.rpc, factory: {
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

test("Requirements generates drawings once and cannot start Prototype before explicit approval", async () => {
    const fixture = await extensionHarness();
    try {
        await readyRequirements(fixture);
        generateDrawings(fixture);
        const pending = await fixture.api.completeLifecycleStage("sample", "requirements", "project:tandem");
        assert.equal(pending.lifecycle.currentStage, "sketch");
        assert.equal(pending.processing.action, "generate-sketch");
        await fixture.waitForRequests();
        assert.deepEqual(JSON.parse(JSON.stringify((fixture.requests[0] as { options: unknown }).options)), {
            limits: { maxConcurrentSubagents: 1, maxTotalSubagents: 1, timeoutSeconds: 300, maxAiCredits: 128 },
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

test("drawing edits create immutable revisions and stale saves or previews cannot be approved", async () => {
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

test("no-GUI efforts skip both graphical stages with snapshots and a reason", async () => {
    const fixture = await extensionHarness();
    try {
        await readyRequirements(fixture, true);
        const state = await fixture.api.completeLifecycleStage("sample", "requirements", "project:tandem");
        assert.equal(state.lifecycle.currentStage, "design");
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
        assert.equal(migrated.lifecycle.currentStage, "plan");
        assert.equal(migrated.lifecycle.version, 2);
        assert.ok(migrated.lifecycle.completedStages.includes("sketch"));
        assert.match(migrated.lifecycle.skippedStages.find((entry) => entry.stageId === "sketch")!.reason, /before Sketch/);
        assert.equal(migrated.sketch.approved, null);
        assert.equal(migrated.lifecycle.outputs[0].path, "existing.json");
        const reopened = await fixture.api.reopenLifecycleStage("sample", "requirements", "project:tandem");
        assert.equal(reopened.lifecycle.skippedStages.length, 0);
        assert.deepEqual(Array.from(reopened.lifecycle.completedStages), ["prepare"]);
    } finally { await fixture.close(); }
});

test("reopening Sketch invalidates prototype checkpoints but preserves drawing and stage history", async () => {
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
        assert.equal(migrated.lifecycle.currentStage, "design");
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
        fixture.api.setSession({ ...fixture.session, rpc: { ...fixture.session.rpc, factory: {
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
                    summary: "Implemented approved drawings.", focus: "Try the primary action.",
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
        fixture.api.setSession({ ...fixture.session, rpc: { ...fixture.session.rpc, factory: {
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
        assert.equal(manifest.acceptance.stageId, "sketch");
    } finally { await fixture.close(); }
});

test("failed drawing jobs preserve drafts and never retry implicitly after reload", async () => {
    const fixture = await extensionHarness();
    try {
        await readyRequirements(fixture);
        generateDrawings(fixture);
        await fixture.api.completeLifecycleStage("sample", "requirements", "project:tandem");
        await fixture.api.waitForAnswer("sample");
        const draft = await fixture.api.loadState("sample");
        fixture.api.setSession({ ...fixture.session, rpc: { ...fixture.session.rpc, factory: {
            run: async (request) => {
                fixture.requests.push(request);
                return { status: "failed", runId: "failed-revision", error: "Drawing worker exceeded its budget." };
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
        document.screens[0].shapes = Array.from({ length: 80 }, (_, index) => ({
            ...document.screens[0].shapes[0], id: `label-${index}`, kind: "text" as const, text: "x".repeat(500),
        }));
        const body = JSON.stringify({ action: "save", expectedRevision: loaded.sketch.current.id, document });
        assert.ok(Buffer.byteLength(body) > 32 * 1024);
        const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
        assert.equal(response.status, 200, await response.text());
        const conflict = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
        assert.equal(conflict.status, 409);
        assert.match((await conflict.json()).error, /changed in another view/);
    } finally { await fixture.close(); }
});

test("production sketch/prototype prompts bind scene semantics and actual image transport", () => {
    const sketch = buildSketchPrompt({
        prototypeId: "sample", projectRoot: "C:\\app", action: "generate-sketch", instruction: "Draw it.",
        requirements: { decisions: ["Accepted decision"] }, approach: "validate-existing", document: null,
    });
    assert.match(sketch, /decision DAG is NOT a navigation graph/);
    assert.match(sketch, /SAME existing GUI/);
    assert.match(sketch, /whole-number dimensions from 1 to 10000/);
    assert.match(sketch, /Preserve user-selected dimensions and any existing clipped content/);
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
});
