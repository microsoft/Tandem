import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { extensionHarness } from "./helpers/extension-harness.js";
import { chosenVisualPrototype, exploringPrototype, visualManifest } from "./helpers/visual-fixture.js";
import { prototypePreviewBridgeSource } from "../src/prototype-bridge.js";
import { restoreOriginalPrototype, updateVisualSelection } from "../src/prototype-flow.js";
import { visualManifestName, type VisualManifest } from "../src/visual-directions.js";
import { fingerprintPrototypeWorkspace } from "../src/prototype-runtime.js";
import { createStageReview, type StageReviewReference } from "../src/stage-review.js";
import type { TandemState } from "../src/types.js";
import { setup, response, current, submit, disabled, text, browse, waitFor } from "./renderer-fixtures.test.js";

const provider = "project:tandem";
const plain = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
type WorkerMode = "normal" | "failed" | "missing-manifest" | "wrong-default" | "unrelated-direction" | "wrong-served-manifest";

async function visualHarness(t: TestContext) {
    const h = await extensionHarness();
    t.after(() => h.close());
    const state = h.api.createLegacyState("sample", "A 3D geometry viewer");
    state.stage = state.lifecycle.currentStage = "prototype";
    state.lifecycle.completedStages = ["prepare", "requirements"];
    state.prototypeApproach = { mode: "build", reason: "Explore the working viewer" };
    state.previewStatus = "ready";
    state.previewUrl = "http://127.0.0.1:11000/";
    await h.api.persistState(state);
    let mode: WorkerMode = "normal";
    const previews = new Map<string, { checkpointId: string; manifest: VisualManifest; served: VisualManifest }>();
    h.setPreviewFetch(async input => {
        const url = new URL(String(input));
        const preview = previews.get(url.port);
        if (url.port === "11000") return new Response(`<meta name="tandem-prototype-id" content="sample"><meta name="tandem-prototype-checkpoint" content="legacy-interaction-${state.generation}">`);
        if (!preview) return new Response("Unknown preview", { status: 404 });
        if (url.pathname.endsWith(visualManifestName)) return Response.json(preview.served);
        if (url.pathname.endsWith("tandem-preview-bridge.js")) return new Response(prototypePreviewBridgeSource, { headers: { "Content-Type": "text/javascript" } });
        return new Response(`<meta name="tandem-prototype-id" content="sample"><meta name="tandem-prototype-checkpoint" content="${preview.checkpointId}">
            <meta name="tandem-visual-exploration" content="1"><script src="tandem-preview-bridge.js"></script>`);
    });
    h.api.setSession({ ...h.session, rpc: { ...h.session.rpc, workflow: {
        run: async (request: { args: { state: TandemState } }) => {
            h.requests.push(request);
            const checkpoint = request.args.state.prototypeFlow!.checkpoints.at(-1)!;
            if (mode === "failed") return { status: "failed", runId: `run-${h.requests.length}`, error: "Visual worker failed." };
            const visual = checkpoint.visual!;
            const baseId = visual.operation === "preserve" ? checkpoint.baseCheckpointId : visual.explorationCheckpointId;
            const base = request.args.state.prototypeFlow!.checkpoints.find(item => item.id === baseId);
            const manifest = plain(base?.visual?.manifest || visualManifest());
            if (visual.operation === "refine") manifest.directions.find(item => item.id === visual.selection!.directionId)!.summary = "Refined toolbar for this direction only.";
            if (["choose", "preserve"].includes(visual.operation) && mode !== "wrong-default") manifest.defaultSelection = plain(visual.selection!);
            if (mode === "unrelated-direction") manifest.directions[0].summary = "Unexpected rewrite of another direction.";
            if (mode !== "missing-manifest") await writeFile(join(checkpoint.workspacePath, visualManifestName), JSON.stringify(manifest));
            const served = plain(manifest);
            if (mode === "wrong-served-manifest") served.defaultSelection.settings.accent = "violet";
            const port = String(14000 + h.requests.length);
            previews.set(port, { checkpointId: checkpoint.id, manifest, served });
            return { status: "completed", runId: `run-${h.requests.length}`, result: {
                summary: `${visual.operation} complete`, focus: "Compare the same primary journey.",
                previewUrl: `http://127.0.0.1:${port}/`, question: null,
                artifactChanges: { upsert: [], remove: [] }, evidence: ["Fixture worker observation, not host proof."],
            } };
        },
    } } });
    async function settle(count: number) { await h.waitForRequests(count); await h.api.waitForAnswer("sample"); return h.api.loadState("sample"); }
    return { ...h, settle, mode(value: WorkerMode) { mode = value; } };
}

test("exploration, scoped refinement and explicit source-backed choice preserve the current prototype and other alternatives", async t => {
    const h = await visualHarness(t);
    await h.api.prototypeAction("sample", provider, { action: "visual" });
    let state = await h.settle(1);
    assert.equal(state.previewUrl, "http://127.0.0.1:11000/", JSON.stringify({ status: state.status, logs: h.logs }));
    assert.ok(state.prototypeFlow!.visualExploration, JSON.stringify({ status: state.status, logs: h.logs }));
    assert.equal(state.prototypeFlow!.pendingCheckpointId, null);
    assert.match(h.api.stageCompletionError(state, "prototype", { requirePrototypeSpec: false })!, /Choose and apply/);
    const originalId = state.prototypeFlow!.visualExploration!.checkpointId;
    const original = state.prototypeFlow!.checkpoints.find(item => item.id === originalId)!;
    const originalSource = await readFile(join(original.workspacePath, visualManifestName), "utf8");
    const selection = { directionId: "canvas", settings: { ...visualManifest().directions[1].defaults, textSize: "large" as const } };
    state = await h.api.prototypeAction("sample", provider, { action: "visual-preview", checkpointId: originalId, selection });
    assert.equal(h.requests.length, 1, "Comparison is not another worker run.");
    assert.equal(await readFile(join(original.workspacePath, visualManifestName), "utf8"), originalSource);
    assert.equal(state.prototypeFlow!.visualExploration!.activeDirectionId, "canvas");
    assert.deepEqual(plain((await h.api.loadState("sample")).prototypeFlow!.visualExploration), plain(state.prototypeFlow!.visualExploration));
    await assert.rejects(h.api.prototypeAction("sample", provider, { action: "apply-update", checkpointId: originalId }), /no longer pending/);
    const general = await h.api.queuePrototypeRevision("sample", provider, { suggestion: "Add keyboard feedback to the current workflow.", clientRequestId: "general" });
    const refinement = await h.api.queuePrototypeRevision("sample", provider, {
        suggestion: "Simplify only this toolbar.", clientRequestId: "visual-feedback", baseCheckpointId: originalId, visualSelection: selection,
    });
    const repeated = await h.api.queuePrototypeRevision("sample", provider, {
        suggestion: "Simplify only this toolbar.", clientRequestId: "visual-feedback", baseCheckpointId: originalId, visualSelection: selection,
    });
    assert.equal(repeated.revisionId, refinement.revisionId);
    await assert.rejects(h.api.queuePrototypeRevision("sample", provider, {
        suggestion: "Simplify only this toolbar.", clientRequestId: "visual-feedback", baseCheckpointId: originalId,
        visualSelection: { ...selection, directionId: "precision" },
    }), /another suggestion or visual target/);
    await h.api.prototypeAction("sample", provider, { action: "retry" });
    state = await h.settle(2);
    const refinedId = state.prototypeFlow!.visualExploration!.checkpointId;
    assert.notEqual(refinedId, originalId);
    assert.equal(state.prototypeReview.revisions.find(item => item.id === general.revisionId).status, "queued");
    assert.equal(state.prototypeReview.revisions.find(item => item.id === refinement.revisionId).status, "applied");
    assert.equal(state.previewUrl, "http://127.0.0.1:11000/");
    assert.equal(state.prototypeFlow!.checkpoints.at(-1)!.sourceCheckpointId, originalId);
    assert.deepEqual(plain(state.prototypeFlow!.checkpoints.at(-1)!.visual!.manifest!.directions[0]), visualManifest().directions[0]);
    assert.equal(await readFile(join(original.workspacePath, visualManifestName), "utf8"), originalSource);
    const request = h.requests[1] as { args: unknown };
    assert.match(h.api.answerFactoryPrompt(request.args), /VISUAL REFINEMENT/);
    await assert.rejects(h.api.prototypeAction("sample", provider, {
        action: "choose-visual", checkpointId: originalId, selection, expectedRevision: state.revision,
    }), /changed/);
    await h.api.prototypeAction("sample", provider, { action: "choose-visual", checkpointId: refinedId, selection, expectedRevision: state.revision });
    state = await h.settle(3);
    const chosen = state.prototypeFlow!.checkpoints.at(-1)!;
    assert.equal(chosen.visual!.operation, "choose");
    assert.equal(state.prototypeFlow!.pendingCheckpointId, chosen.id);
    assert.equal(state.previewUrl, "http://127.0.0.1:11000/");
    assert.deepEqual(JSON.parse(await readFile(join(chosen.workspacePath, visualManifestName), "utf8")).defaultSelection, selection);
    assert.ok(chosen.sourceFingerprint, "The chosen defaults belong to retained source, not a URL-only preference.");
    await h.api.prototypeAction("sample", provider, { action: "apply-update", checkpointId: chosen.id });
    state = await h.settle(4);
    const behaviorUpdate = state.prototypeFlow!.checkpoints.at(-1)!;
    assert.equal(behaviorUpdate.visual!.operation, "preserve");
    assert.equal(behaviorUpdate.revisionId, general.revisionId);
    assert.deepEqual(plain(behaviorUpdate.visual!.manifest!.defaultSelection), selection);
    state = await h.api.prototypeAction("sample", provider, { action: "apply-update", checkpointId: behaviorUpdate.id });
    assert.equal(h.api.stageCompletionError(state, "prototype", { requirePrototypeSpec: false }), null);
    assert.equal(state.prototypeFlow!.visualExploration!.appliedCheckpointId, behaviorUpdate.id);
    assert.equal(state.prototypeFlow!.checkpoints.find(item => item.id === originalId)!.visual!.manifest!.directions.length, 3);
});

test("missing/changed visual source contracts cannot turn worker-reported completion into a ready exploration", async t => {
    for (const mode of ["missing-manifest", "wrong-served-manifest"] as const) await t.test(mode, async t => {
        const h = await visualHarness(t); h.mode(mode);
        await h.api.prototypeAction("sample", provider, { action: "visual" });
        const state = await h.settle(1);
        assert.equal(state.prototypeFlow!.checkpoints.at(-1)!.status, "failed");
        assert.equal(state.prototypeFlow!.visualExploration, undefined);
        assert.equal(state.prototypeFlow!.pendingCheckpointId, null);
        assert.equal(state.previewUrl, "http://127.0.0.1:11000/");
    });
});

test("a chosen direction must bake the exact settings into source; retry preserves that choice and alternatives", async t => {
    const h = await visualHarness(t);
    await h.api.prototypeAction("sample", provider, { action: "visual" });
    let state = await h.settle(1);
    const explorationId = state.prototypeFlow!.visualExploration!.checkpointId;
    const selection = { directionId: "canvas", settings: visualManifest().directions[1].defaults };
    h.mode("wrong-default");
    await h.api.prototypeAction("sample", provider, { action: "choose-visual", checkpointId: explorationId, selection });
    state = await h.settle(2);
    assert.equal(state.prototypeFlow!.checkpoints.at(-1)!.status, "failed");
    assert.match(state.status, /defaults/);
    assert.equal(state.prototypeFlow!.pendingCheckpointId, null);
    h.mode("normal");
    const failed = state.prototypeFlow!.checkpoints.at(-1)!;
    await h.api.prototypeAction("sample", provider, { action: "retry", checkpointId: failed.id });
    state = await h.settle(3);
    assert.equal(state.prototypeFlow!.checkpoints.at(-1)!.sourceCheckpointId, failed.id);
    assert.deepEqual(plain(state.prototypeFlow!.checkpoints.at(-1)!.visual!.selection), selection);
    assert.equal(state.prototypeFlow!.visualExploration!.checkpointId, explorationId);
    const prepared = state.prototypeFlow!.pendingCheckpointId;
    state = await h.api.prototypeAction("sample", provider, { action: "visual-back", checkpointId: prepared });
    assert.equal(state.prototypeFlow!.pendingCheckpointId, null);
    assert.equal(state.prototypeFlow!.checkpoints.find(item => item.id === prepared)!.status, "ready");
    assert.equal(state.previewUrl, "http://127.0.0.1:11000/");
});

test("accepting Default restores the verified original without generating a replacement or discarding alternatives", async t => {
    const h = await visualHarness(t);
    await h.api.prototypeAction("sample", provider, { action: "visual" });
    let state = await h.settle(1);
    const originalId = state.prototypeFlow!.displayedCheckpointId!;
    const explorationId = state.prototypeFlow!.visualExploration!.checkpointId;
    const selection = { directionId: "canvas", settings: visualManifest().directions[1].defaults };
    await h.api.prototypeAction("sample", provider, { action: "choose-visual", checkpointId: explorationId, selection,
        expectedRevision: state.revision });
    state = await h.settle(2);
    const chosen = state.prototypeFlow!.pendingCheckpointId!;
    await assert.rejects(h.api.prototypeAction("sample", provider, { action: "visual-original", checkpointId: originalId,
        expectedRevision: state.revision }), /active or prepared/);
    state = await h.api.prototypeAction("sample", provider, { action: "apply-update", checkpointId: chosen });
    const before = plain(state);
    const server = await h.api.startServer("original-http", "sample", provider, true);
    t.after(async () => {
        clearInterval(server.heartbeat);
        await new Promise<void>(resolve => { server.server.close(() => resolve()); server.server.closeAllConnections(); });
    });
    const originalStatus = await (await fetch(new URL("/api/prototype/preview-status?target=original", server.url))).json();
    const currentStatus = await (await fetch(new URL("/api/prototype/preview-status", server.url))).json();
    assert.equal(originalStatus.available, true);
    assert.equal(originalStatus.checkpointId, originalId);
    assert.equal(currentStatus.checkpointId, chosen);
    assert.notEqual(originalStatus.url, currentStatus.url);
    await assert.rejects(h.api.prototypeAction("sample", provider, { action: "visual-original", checkpointId: originalId }), /changed/);
    await assert.rejects(h.api.prototypeAction("sample", provider, { action: "visual-original", checkpointId: chosen,
        expectedRevision: state.revision }), /original prototype no longer matches/);
    state = await h.api.prototypeAction("sample", provider, { action: "visual-original", checkpointId: originalId,
        expectedRevision: state.revision });
    assert.equal(state.previewUrl, "http://127.0.0.1:11000/");
    assert.equal(state.prototypeFlow!.displayedCheckpointId, originalId);
    assert.equal(state.prototypeFlow!.pendingCheckpointId, null);
    assert.equal(state.prototypeFlow!.visualRequested, false);
    assert.deepEqual(plain(state.prototypeFlow!.checkpoints), before.prototypeFlow!.checkpoints);
    assert.deepEqual(plain(state.prototypeFlow!.visualExploration!.selections), before.prototypeFlow!.visualExploration!.selections);
    assert.deepEqual(plain(state.prototypeReview.revisions), before.prototypeReview.revisions);
    assert.equal(h.requests.length, 2);
});

test("Default cannot restore an original whose retained source changed after verification", async t => {
    const h = await visualHarness(t);
    await h.api.prototypeAction("sample", provider, { action: "visual" });
    let state = await h.settle(1);
    const original = state.prototypeFlow!.checkpoints.find(item => item.id === state.prototypeFlow!.displayedCheckpointId)!;
    await writeFile(join(original.workspacePath, "original.mjs"), "// original source");
    original.sourceFingerprint = await fingerprintPrototypeWorkspace(original.workspacePath);
    await h.api.persistState(state);
    state = await h.api.loadState("sample");
    const explorationId = state.prototypeFlow!.visualExploration!.checkpointId;
    await h.api.prototypeAction("sample", provider, { action: "choose-visual", checkpointId: explorationId,
        selection: visualManifest().defaultSelection, expectedRevision: state.revision });
    state = await h.settle(2);
    state = await h.api.prototypeAction("sample", provider, { action: "apply-update", checkpointId: state.prototypeFlow!.pendingCheckpointId });
    const before = plain(state);
    await writeFile(join(original.workspacePath, "original.mjs"), "// source changed");
    await assert.rejects(h.api.prototypeAction("sample", provider, { action: "visual-original", checkpointId: original.id,
        expectedRevision: state.revision }), /source files changed/);
    assert.deepEqual(plain(await h.api.loadState("sample")), before);
});

test("accepting the initial Default resumes queued prototype feedback from the original source", async t => {
    const h = await visualHarness(t);
    await h.api.prototypeAction("sample", provider, { action: "visual" });
    let state = await h.settle(1);
    const originalId = state.prototypeFlow!.displayedCheckpointId!;
    const revision = await h.api.queuePrototypeRevision("sample", provider, {
        suggestion: "Improve the original primary workflow.", clientRequestId: "keep-default-feedback",
    });
    state = await h.api.loadState("sample");
    assert.equal(h.requests.length, 1);
    h.mode("failed");
    await h.api.prototypeAction("sample", provider, { action: "visual-original", checkpointId: originalId,
        expectedRevision: state.revision });
    state = await h.settle(2);
    const work = state.prototypeFlow!.checkpoints.at(-1)!;
    assert.equal(work.revisionId, revision.revisionId);
    assert.equal(work.baseCheckpointId, originalId);
    assert.equal(work.sourceCheckpointId, originalId);
    assert.equal(state.prototypeFlow!.displayedCheckpointId, originalId);
    assert.equal(state.prototypeFlow!.visualRequested, false);
    assert.equal(state.prototypeReview.revisions.find(item => item.id === revision.revisionId).status, "failed",
        "The resumed fixture failure is reported, not mistaken for a completed feedback update.");
});

test("visual refinement rejects changes to unrelated direction contracts and preserves the last-good bundle", async t => {
    const h = await visualHarness(t);
    await h.api.prototypeAction("sample", provider, { action: "visual" });
    let state = await h.settle(1);
    const explorationId = state.prototypeFlow!.visualExploration!.checkpointId;
    h.mode("unrelated-direction");
    await h.api.prototypeAction("sample", provider, { action: "refine-visual", checkpointId: explorationId,
        selection: { directionId: "canvas", settings: visualManifest().directions[1].defaults },
        suggestion: "Simplify the canvas toolbar.", clientRequestId: "one-direction" });
    state = await h.settle(2);
    assert.equal(state.prototypeFlow!.checkpoints.at(-1)!.status, "failed");
    assert.match(state.status, /unrelated direction/);
    assert.equal(state.prototypeFlow!.visualExploration!.checkpointId, explorationId);
    assert.equal(state.prototypeFlow!.pendingCheckpointId, null);
    assert.equal(state.previewUrl, "http://127.0.0.1:11000/");
});

test("HTTP visual preview checks and adjustments target only the retained exploration and launch no work", async t => {
    const h = await visualHarness(t);
    await h.api.prototypeAction("sample", provider, { action: "visual" });
    const state = await h.settle(1);
    const server = await h.api.startServer("visual-http", "sample", provider, true);
    t.after(async () => {
        clearInterval(server.heartbeat);
        await new Promise<void>(resolve => { server.server.close(() => resolve()); server.server.closeAllConnections(); });
    });
    const before = plain(await h.api.loadState("sample"));
    const status = await (await fetch(new URL("/api/prototype/preview-status?target=exploration", server.url))).json();
    assert.equal(status.available, true);
    assert.equal(status.checkpointId, state.prototypeFlow!.visualExploration!.checkpointId);
    assert.notEqual(status.url, state.previewUrl);
    const originalStatus = await (await fetch(new URL("/api/prototype/preview-status?target=original", server.url))).json();
    assert.equal(originalStatus.available, true);
    assert.equal(originalStatus.checkpointId, state.prototypeFlow!.displayedCheckpointId);
    assert.equal(originalStatus.url, state.previewUrl);
    assert.deepEqual(plain(await h.api.loadState("sample")), before);
    const selection = { directionId: "presentation", settings: visualManifest().directions[2].defaults };
    const result = await fetch(new URL("/api/prototype/action", server.url), { method: "POST",
        headers: { Origin: new URL(server.url).origin, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "visual-preview", checkpointId: status.checkpointId, selection, expectedRevision: state.revision }) });
    assert.equal(result.status, 200, await result.clone().text());
    assert.equal((await h.api.loadState("sample")).prototypeFlow!.visualExploration!.activeDirectionId, "presentation");
    assert.equal((await h.api.loadState("sample")).previewUrl, before.previewUrl);
    assert.equal(h.requests.length, 1);
    await assert.rejects(h.api.prototypeAction("sample", "foreign-provider", { action: "visual-preview",
        checkpointId: status.checkpointId, selection }), /active Tandem provider/);
});

test("keeping the current prototype explicitly puts aside failed visual feedback but retains drafts, source and history", async t => {
    const h = await visualHarness(t);
    await h.api.prototypeAction("sample", provider, { action: "visual" });
    let state = await h.settle(1);
    const explorationId = state.prototypeFlow!.visualExploration!.checkpointId;
    await h.api.queuePrototypeRevision("sample", provider, { suggestion: "Try a simpler toolbar.", clientRequestId: "refine",
        baseCheckpointId: explorationId, visualSelection: { directionId: "canvas", settings: visualManifest().directions[1].defaults } });
    h.mode("failed");
    await h.api.prototypeAction("sample", provider, { action: "retry" });
    state = await h.settle(2);
    assert.equal(state.prototypeReview.revisions[0].status, "failed");
    state = await h.api.prototypeAction("sample", provider, { action: "skip-visual" });
    assert.equal(state.prototypeReview.revisions[0].status, "dismissed");
    assert.equal(state.prototypeFlow!.visualRequested, false);
    assert.equal(state.prototypeFlow!.visualExploration!.checkpointId, explorationId);
    assert.equal(state.previewUrl, "http://127.0.0.1:11000/");
    assert.equal(h.api.stageCompletionError(state, "prototype", { requirePrototypeSpec: false }), null);
    await h.api.prototypeAction("sample", provider, { action: "visual" });
    assert.equal(h.requests.length, 2, "Reopening saved alternatives does not regenerate them.");
    await assert.rejects(h.api.prototypeAction("sample", provider, { action: "visual-preview", checkpointId: explorationId,
        selection: visualManifest().defaultSelection, expectedRevision: 0 }), /changed/);
    h.mode("normal");
    await h.api.prototypeAction("sample", provider, { action: "choose-visual", checkpointId: explorationId,
        selection: { directionId: "canvas", settings: visualManifest().directions[1].defaults } });
    state = await h.settle(3);
    assert.ok(state.prototypeFlow!.pendingCheckpointId, "Putting a failed attempt aside must not block choosing a retained alternative later.");
});

test("putting visual exploration aside cannot discard an ordinary revision's partial source or failure", async t => {
    const h = await visualHarness(t);
    await h.api.prototypeAction("sample", provider, { action: "visual" });
    let state = await h.settle(1);
    await h.api.prototypeAction("sample", provider, { action: "choose-visual",
        checkpointId: state.prototypeFlow!.visualExploration!.checkpointId, selection: visualManifest().defaultSelection });
    state = await h.settle(2);
    await h.api.prototypeAction("sample", provider, { action: "apply-update", checkpointId: state.prototypeFlow!.pendingCheckpointId });
    await h.api.queuePrototypeRevision("sample", provider, { suggestion: "Revise the main interaction.", clientRequestId: "ordinary" });
    h.mode("failed");
    await h.api.prototypeAction("sample", provider, { action: "retry" });
    state = await h.settle(3);
    const failed = state.prototypeFlow!.checkpoints.at(-1)!;
    assert.equal(failed.visual!.operation, "preserve");
    state = await h.api.prototypeAction("sample", provider, { action: "skip-visual" });
    assert.equal(state.prototypeReview.revisions[0].status, "failed");
    assert.equal(state.prototypeFlow!.checkpoints.at(-1)!.visualDismissedAt, undefined);
    h.mode("normal");
    await h.api.prototypeAction("sample", provider, { action: "retry", checkpointId: failed.id });
    state = await h.settle(4);
    assert.equal(state.prototypeFlow!.checkpoints.at(-1)!.sourceCheckpointId, failed.id);
});

test("React visual controls switch and persist per direction without changing the current iframe or accepting the design", async t => {
    const h = await setup(t, exploringPrototype());
    h.setFetch(async (_path, options) => {
        const body = JSON.parse(String(options.body));
        const value = current(h);
        if (body.action === "visual-preview") return response({ ...value, revision: value.revision + 1,
            prototypeFlow: updateVisualSelection(value.prototypeFlow!, body.checkpointId, body.selection) });
        return response({ ...value, revision: value.revision + 1 });
    });
    const accepted = h.get<HTMLIFrameElement>("preview-frame"), acceptedUrl = accepted.src;
    const accept = h.get("choose-visual-direction"), feedback = h.get<HTMLTextAreaElement>("revision-input");
    assert.equal(disabled(h, "complete-stage"), false, "Finishing can keep the original without accepting an optional direction.");
    assert.equal(h.document.querySelectorAll(".visual-direction-toggle").length, 4);
    assert.equal(h.get("compare-current-prototype").dataset.applied, "true");
    assert.equal(h.get("compare-current-prototype").getAttribute("aria-checked"), "true");
    assert.ok(h.document.querySelector(".visual-exploration-heading")!.contains(accept));
    assert.ok(accept.compareDocumentPosition(h.get("visual-preview-frame")) & h.window.Node.DOCUMENT_POSITION_FOLLOWING);
    assert.equal(h.document.querySelector(".visual-selection-actions"), null);
    await h.input("revision-input", "Keep this current-prototype draft.");
    await h.click("visual-direction-canvas");
    assert.equal(h.get("choose-visual-direction"), accept);
    assert.ok(h.document.querySelector(".visual-exploration-heading")!.contains(accept));
    assert.equal(h.document.querySelectorAll(".visual-exploration textarea, #revision-form textarea").length, 1);
    assert.equal(h.document.querySelector("#visual-feedback-form"), null);
    assert.equal(h.get("revision-input"), feedback);
    assert.equal(feedback.value, "");
    assert.equal(feedback.getAttribute("aria-label"), "Feedback for Canvas first");
    assert.match(text(h, "prototype-review"), /Feedback for Canvas firstSelected direction only/);
    assert.match(text(h, "revision-status"), /selected alternative, not the accepted prototype/);
    assert.equal(h.get("revision-status").dataset.essential, "true");
    await h.input("revision-input", "Keep this canvas draft.");
    assert.equal(h.get("preview-frame"), accepted);
    assert.equal(accepted.src, acceptedUrl);
    assert.equal(accepted.hidden, true);
    assert.match(text(h, "visual-selection-status"), /Previewing Canvas first.*Accept to apply/);
    assert.equal(h.document.querySelector("#restart-original-preview"), null);
    assert.ok(h.document.querySelector(".prototype-substage-bar")!.contains(h.get("restart-exploration-preview")));
    assert.equal(h.document.querySelector(".visual-exploration .preview-recovery-action"), null);
    const frame = h.get<HTMLIFrameElement>("visual-preview-frame"), frameUrl = frame.src;
    await h.input("visual-setting-textSize", "large");
    assert.equal(feedback.getAttribute("aria-label"), "Feedback for Custom");
    assert.equal(feedback.value, "Keep this canvas draft.");
    assert.equal(h.get("visual-preview-frame"), frame);
    assert.equal(frame.src, frameUrl, "Adjustments use the bridge, not iframe reloads.");
    await h.click("visual-direction-precision");
    assert.equal(h.get<HTMLSelectElement>("visual-setting-textSize").value, "standard");
    assert.equal(feedback.value, "");
    await h.input("revision-input", "Keep this precision draft.");
    await h.click("visual-custom-direction");
    assert.equal(h.get<HTMLSelectElement>("visual-setting-textSize").value, "large");
    assert.equal(feedback.value, "Keep this canvas draft.");
    assert.equal(disabled(h, "choose-visual-direction"), true, "The iframe must confirm the exact settings before UI choice.");
    const sent: Array<{ data: Record<string, any>; origin: string }> = [];
    frame.contentWindow!.postMessage = (data: Record<string, any>, origin: string) => sent.push({ data, origin });
    const receive = async (data: Record<string, unknown>, source: MessageEventSource | null = frame.contentWindow) => {
        h.window.dispatchEvent(new h.window.MessageEvent("message", { origin: new URL(frame.src).origin, source,
            data: { prototypeId: "fixture", checkpointId: "visual-bundle", ...data } }));
        await h.flush();
    };
    await receive({ type: "tandem:visual:ready" });
    const last = sent.at(-1)!;
    assert.equal(last.origin, "http://127.0.0.1:10000");
    await receive({ type: "tandem:visual:applied", requestId: last.data.requestId, selection: last.data.selection }, null);
    assert.equal(disabled(h, "choose-visual-direction"), true);
    await receive({ type: "tandem:visual:applied", requestId: last.data.requestId, selection: last.data.selection });
    assert.equal(disabled(h, "choose-visual-direction"), false);
    const shared = new URL(h.get<HTMLAnchorElement>("open-visual-preview").href);
    assert.equal(shared.searchParams.get("tandem-direction"), "canvas");
    assert.equal(shared.searchParams.get("tandem-textSize"), "large");
    await h.input("revision-input", "Simplify this toolbar.");
    await submit(h, "revision-form");
    assert.equal(h.requests.at(-1)!.path, "/api/revision");
    assert.equal(h.requests.at(-1)!.body.baseCheckpointId, "visual-bundle");
    assert.equal(h.requests.at(-1)!.body.visualSelection.directionId, "canvas");
    assert.equal(h.requests.at(-1)!.body.visualSelection.settings.textSize, "large");
    assert.equal(feedback.value, "");
    await h.click("compare-current-prototype");
    assert.equal(accepted.hidden, false);
    assert.equal(h.get("preview-frame"), accepted);
    assert.equal(accepted.src, acceptedUrl);
    assert.equal(h.get("compare-current-prototype").getAttribute("aria-checked"), "true");
    assert.ok(h.document.querySelector(".prototype-substage-bar")!.contains(h.get("restart-original-preview")));
    assert.equal(h.document.querySelector("#restart-exploration-preview"), null);
    assert.equal(h.get<HTMLTextAreaElement>("revision-input").value, "Keep this current-prototype draft.");
    assert.equal(feedback.getAttribute("aria-label"), "Prototype revision suggestion");
    assert.equal(h.get("choose-visual-direction"), accept);
    assert.ok(h.document.querySelector(".visual-exploration-heading")!.contains(accept));
    assert.equal(current(h).prototypeFlow!.displayedCheckpointId, "interaction");
    assert.equal(current(h).prototypeFlow!.pendingCheckpointId, null);
    assert.equal(h.requests.filter(item => item.body?.action === "choose-visual").length, 0);
    assert.equal(h.requests.filter(item => item.body?.selection?.settings.accent === "neutral").length, 0, "Default is not a generated neutral preset.");
});

test("shared feedback isolates retries, targets and drafts across directions, settings and Prototype tabs", async t => {
    const h = await setup(t, exploringPrototype());
    let fail = true;
    h.setFetch(async (path, options) => {
        const input = JSON.parse(String(options.body)), value = current(h);
        if (path === "/api/prototype/action") return response({ ...value, revision: value.revision + 1,
            prototypeFlow: updateVisualSelection(value.prototypeFlow!, input.checkpointId, input.selection) });
        assert.equal(path, "/api/revision");
        return fail ? response({ error: "Connection failed; retry this feedback." }, 503)
            : response({ ...value, revision: value.revision + 1 });
    });
    const feedback = h.get<HTMLTextAreaElement>("revision-input");
    const suggestion = "Simplify this toolbar.";
    await h.input("revision-input", suggestion);
    await submit(h, "revision-form");
    const original = h.requests.at(-1)!.body;
    assert.equal(original.baseCheckpointId, "interaction");
    assert.equal(original.visualSelection, undefined);
    await h.click("visual-direction-canvas");
    assert.equal(h.get("revision-status").dataset.status, "idle", "An accepted-prototype error must not follow the direction draft.");
    await h.input("revision-input", suggestion);
    await submit(h, "revision-form");
    const canvas = h.requests.at(-1)!.body;
    assert.notEqual(canvas.clientRequestId, original.clientRequestId);
    assert.equal(canvas.baseCheckpointId, "visual-bundle");
    assert.deepEqual(canvas.visualSelection, { directionId: "canvas", settings: visualManifest().directions[1].defaults });
    await h.input("visual-setting-textSize", "large");
    await submit(h, "revision-form");
    const custom = h.requests.at(-1)!.body;
    assert.notEqual(custom.clientRequestId, canvas.clientRequestId);
    assert.equal(custom.visualSelection.settings.textSize, "large");
    await h.click("visual-direction-precision");
    assert.equal(feedback.value, "");
    await h.input("revision-input", "Keep this precision draft.");
    await h.fire(h.get("prototype-prototype-tab"), "mousedown", { button: 0 });
    assert.equal(feedback.value, suggestion);
    assert.equal(feedback.getAttribute("aria-label"), "Prototype revision suggestion");
    fail = false;
    await submit(h, "revision-form");
    assert.deepEqual(h.requests.at(-1)!.body, original, "Returning to Prototype retries the original accepted-checkpoint submission.");
    assert.equal(feedback.value, "");
    await h.fire(h.get("prototype-visual-tab"), "mousedown", { button: 0 });
    assert.equal(feedback.value, "Keep this precision draft.");
    assert.equal(feedback.getAttribute("aria-label"), "Feedback for Precision workspace");
    await h.click("visual-direction-canvas");
    assert.equal(feedback.value, suggestion);
    await submit(h, "revision-form");
    assert.deepEqual(h.requests.at(-1)!.body, canvas, "Returning to a direction retries its exact saved submission.");
    assert.equal(feedback.value, "");
    await h.click("visual-direction-precision");
    assert.equal(feedback.value, "Keep this precision draft.");
    await h.click("visual-direction-canvas");
    await h.input("revision-input", "Send this canvas refinement.");
    let release!: (result: Response) => void;
    h.setFetch(() => new Promise(resolve => { release = resolve; }));
    await submit(h, "revision-form");
    await h.input("revision-input", "A newer canvas draft.");
    await h.fire(h.get("prototype-prototype-tab"), "mousedown", { button: 0 });
    await h.input("revision-input", "A newer accepted-prototype draft.");
    release(response({ ...current(h), revision: current(h).revision + 1 }));
    await waitFor(h, () => !disabled(h, "submit-revision"));
    assert.equal(feedback.value, "A newer accepted-prototype draft.");
    await h.fire(h.get("prototype-visual-tab"), "mousedown", { button: 0 });
    assert.equal(feedback.value, "A newer canvas draft.", "A completed submission cannot clear a replacement draft or another target's draft.");
});

test("Prototype review keeps Apply blocked for unsent feedback in other directions and views", async t => {
    let parent = chosenVisualPrototype();
    parent.stage = parent.lifecycle.currentStage = "development";
    parent.lifecycle.completedStages.push("prototype");
    const reference: StageReviewReference = { version: 1, id: "review-22222222-2222-2222-2222-222222222222",
        stage: "prototype", generation: parent.generation, createdAt: parent.updatedAt, appliedAt: null, discardedAt: null };
    const draft = { ...createStageReview(parent, reference), revision: 1, provider: parent.provider };
    const snapshot = () => plain({ ...draft, stageReviewStatus: {
        conflict: "", blocker: null, changed: true, currentStage: parent.lifecycle.currentStage, appliedAt: null, discardedAt: null,
    } });
    const h = await setup(t, parent);
    h.setFetch(async (path, options) => {
        if (path === "/api/reviews/open") {
            parent = { ...parent, revision: parent.revision + 1, stageReviews: [reference] };
            return response({ draft: snapshot() });
        }
        if (path === "/api/state") return response(parent);
        if (path.startsWith(`/api/reviews/${reference.id}/prototype/preview-status`)) {
            const target = new URL(path, "http://fixture").searchParams.get("target");
            const id = target === "exploration" ? "visual-bundle" : "interaction";
            return response({ generation: draft.generation, checkpointId: id, pendingCheckpointId: null,
                url: draft.prototypeFlow!.checkpoints.find(item => item.id === id)!.previewUrl, available: true, reason: "" });
        }
        if (path === `/api/reviews/${reference.id}/prototype/action`) {
            const input = JSON.parse(String(options.body));
            assert.equal(input.action, "visual-preview");
            draft.prototypeFlow = updateVisualSelection(draft.prototypeFlow!, input.checkpointId, input.selection);
            draft.revision++;
            return response(snapshot());
        }
        if (path === `/api/reviews/${reference.id}/state`) return response(snapshot());
        throw new Error("Unexpected review request: " + path);
    });
    await browse(h, "prototype");
    await h.click("review-stage");
    assert.equal(disabled(h, "apply-stage-review"), false);
    await h.input("revision-input", "Keep this accepted-prototype draft.");
    await h.click("visual-direction-canvas");
    assert.equal(h.get<HTMLTextAreaElement>("revision-input").value, "");
    assert.equal(disabled(h, "apply-stage-review"), true);
    await h.input("revision-input", "Keep this canvas draft.");
    await h.click("visual-direction-precision");
    assert.equal(h.get<HTMLTextAreaElement>("revision-input").value, "");
    assert.equal(disabled(h, "apply-stage-review"), true);
    await h.click("compare-current-prototype");
    assert.equal(h.get<HTMLTextAreaElement>("revision-input").value, "Keep this accepted-prototype draft.");
    await h.input("revision-input", "");
    assert.equal(disabled(h, "apply-stage-review"), true, "The hidden canvas draft is still unsent.");
    await h.click("visual-direction-canvas");
    assert.equal(h.get<HTMLTextAreaElement>("revision-input").value, "Keep this canvas draft.");
    await h.input("revision-input", "");
    assert.equal(disabled(h, "apply-stage-review"), false);
});

test("shared direction feedback preserves refinement guards and queues only behind compatible work", async t => {
    const value = exploringPrototype(), h = await setup(t, value);
    h.setFetch(async (_path, options) => {
        const input = JSON.parse(String(options.body)), value = current(h);
        return response({ ...value, revision: value.revision + 1,
            prototypeFlow: updateVisualSelection(value.prototypeFlow!, input.checkpointId, input.selection) });
    });
    await h.click("visual-direction-canvas");
    await h.input("revision-input", "Keep this direction draft.");
    const selected = plain(current(h));
    const flow = selected.prototypeFlow!;
    const original = flow.checkpoints.find(item => item.id === "interaction")!;
    const exploration = flow.checkpoints.find(item => item.id === "visual-bundle")!;
    const pending = chosenVisualPrototype();
    pending.prototypeFlow!.displayedCheckpointId = "interaction";
    pending.prototypeFlow!.pendingCheckpointId = "chosen";
    pending.prototypeFlow!.visualExploration!.appliedCheckpointId = null;
    const ordinary = chosenVisualPrototype();
    ordinary.prototypeReview.revisions = [{ id: "ordinary", status: "queued", suggestion: "Revise the accepted prototype." }];
    const blocked = [
        { state: { ...selected, prototypeFlow: { ...flow, visualRequested: false } }, reason: /saved directions cannot be refined/ },
        { state: { ...selected, prototypeFlow: { ...flow, displayedCheckpointId: "later",
            checkpoints: [...flow.checkpoints, { ...original, id: "later" }] } }, reason: /saved directions cannot be refined/ },
        { state: pending, reason: /pending update/ },
        { state: { ...selected, prototypeFlow: { ...flow, activeCheckpointId: "ordinary-update",
            checkpoints: [...flow.checkpoints, { ...original, id: "ordinary-update", status: "running" as const }] } }, reason: /current-prototype work/ },
        { state: ordinary, reason: /current-prototype work/ },
        { state: { ...selected, provider: { canSubmitAnswers: false } }, reason: /installed user-scoped Tandem/ },
        { state: { ...selected, processing: { ...selected.processing, action: "generate-design-spec", status: "running" } }, reason: /frozen input/ },
    ];
    for (const snapshot of blocked) {
        h.render({ ...snapshot.state, revision: current(h).revision + 1 });
        await h.flush();
        assert.equal(disabled(h, "submit-revision"), true);
        assert.equal(h.get<HTMLTextAreaElement>("revision-input").value, "Keep this direction draft.");
        assert.match(text(h, "revision-status"), snapshot.reason);
        const before = h.requests.length;
        await submit(h, "revision-form");
        assert.equal(h.requests.length, before, "Blocked direction feedback must not fall back to accepted-prototype feedback.");
    }
    h.render({ ...selected, revision: current(h).revision + 1, prototypeFlow: { ...flow, activeCheckpointId: "refining",
        checkpoints: [...flow.checkpoints, { ...exploration, id: "refining", status: "running",
            visual: { ...exploration.visual!, operation: "refine" } }] } });
    await h.flush();
    assert.equal(disabled(h, "submit-revision"), false);
    assert.equal(text(h, "submit-revision"), "Queue refinement");
    h.setFetch(async () => response({ ...current(h), revision: current(h).revision + 1 }));
    await submit(h, "revision-form");
    assert.equal(h.requests.at(-1)!.body.baseCheckpointId, "visual-bundle");
    assert.equal(h.requests.at(-1)!.body.visualSelection.directionId, "canvas");
    assert.equal(h.get<HTMLTextAreaElement>("revision-input").value, "");
});

test("Default remains the exact original after accepting a direction, and restoring it requires Accept", async t => {
    const value = chosenVisualPrototype();
    const h = await setup(t, value);
    const original = h.get<HTMLIFrameElement>("preview-frame");
    assert.equal(original.src, "http://127.0.0.1:9999/");
    assert.equal(original.dataset.checkpointId, "interaction");
    assert.equal(h.get("compare-current-prototype").dataset.preview, "true");
    assert.equal(h.get("visual-direction-canvas").dataset.applied, "true");
    assert.equal(h.get("visual-selection-status").classList.contains("visually-hidden"), false);
    assert.equal(disabled(h, "choose-visual-direction"), false);
    assert.equal(current(h).prototypeFlow!.displayedCheckpointId, "chosen", "Viewing Default does not roll back an accepted direction.");
    h.setFetch(async (path, options) => {
        assert.equal(path, "/api/prototype/action");
        const body = JSON.parse(String(options.body));
        assert.deepEqual(body, { action: "visual-original", checkpointId: "interaction", expectedRevision: 2 });
        return response({ ...value, revision: 3, previewUrl: original.src,
            prototypeFlow: restoreOriginalPrototype(value.prototypeFlow!, body.checkpointId) });
    });
    await h.click("choose-visual-direction");
    assert.equal(current(h).prototypeFlow!.displayedCheckpointId, "interaction");
    assert.equal(h.get("compare-current-prototype").dataset.applied, "true");
    assert.equal(disabled(h, "choose-visual-direction"), true);
    assert.equal(h.get("preview-frame"), original);
    assert.equal(current(h).prototypeFlow!.checkpoints.length, value.prototypeFlow!.checkpoints.length);
    assert.deepEqual(current(h).prototypeFlow!.visualExploration!.selections, value.prototypeFlow!.visualExploration!.selections);
});

test("Accept can explicitly keep the original Default without preparing a generated direction", async t => {
    const value = exploringPrototype();
    const h = await setup(t, value);
    assert.equal(disabled(h, "choose-visual-direction"), false);
    h.setFetch(async (_path, options) => {
        const input = JSON.parse(String(options.body));
        assert.deepEqual(input, { action: "visual-original", checkpointId: "interaction", expectedRevision: 1 });
        return response({ ...value, revision: 2, prototypeFlow: restoreOriginalPrototype(value.prototypeFlow!, input.checkpointId) });
    });
    const original = h.get("preview-frame");
    await h.click("choose-visual-direction");
    assert.equal(current(h).prototypeFlow!.displayedCheckpointId, "interaction");
    assert.equal(current(h).prototypeFlow!.visualRequested, false);
    assert.equal(h.get("preview-frame"), original);
    assert.equal(current(h).prototypeFlow!.checkpoints.length, value.prototypeFlow!.checkpoints.length);
    assert.equal(disabled(h, "choose-visual-direction"), true);
});

test("returning to Default puts aside a prepared choice without applying it or deleting its checkpoint", async t => {
    const value = chosenVisualPrototype();
    value.prototypeFlow!.displayedCheckpointId = "interaction";
    value.prototypeFlow!.pendingCheckpointId = "chosen";
    value.prototypeFlow!.visualExploration!.appliedCheckpointId = null;
    value.previewUrl = "http://127.0.0.1:9999/";
    const h = await setup(t, value);
    assert.equal(h.get<HTMLIFrameElement>("preview-frame").hidden, true);
    h.setFetch(async (_path, options) => {
        const input = JSON.parse(String(options.body));
        assert.deepEqual(input, { action: "visual-back", checkpointId: "chosen", expectedRevision: 2 });
        return response({ ...value, revision: 3, prototypeFlow: { ...value.prototypeFlow, pendingCheckpointId: null,
            checkpoints: value.prototypeFlow!.checkpoints.map(item => item.id === "chosen"
                ? { ...item, visualDismissedAt: value.updatedAt } : item) } });
    });
    await h.click("compare-current-prototype");
    assert.equal(h.get<HTMLIFrameElement>("preview-frame").hidden, false);
    assert.equal(current(h).prototypeFlow!.displayedCheckpointId, "interaction");
    assert.equal(current(h).prototypeFlow!.pendingCheckpointId, null);
    assert.ok(current(h).prototypeFlow!.checkpoints.find(item => item.id === "chosen")?.visualDismissedAt);
    assert.equal(disabled(h, "choose-visual-direction"), false, "Accept can keep Default after putting the prepared alternative aside.");
});

test("completed Prototype keeps showing its accepted checkpoint without labelling it as an original Default preview", async t => {
    const value = chosenVisualPrototype();
    value.lifecycle.completedStages.push("prototype");
    const h = await setup(t, value);
    assert.equal(h.get<HTMLIFrameElement>("preview-frame").src, value.previewUrl);
    assert.equal(h.get<HTMLIFrameElement>("preview-frame").dataset.checkpointId, "chosen");
    assert.equal(h.get("visual-direction-canvas").getAttribute("aria-checked"), "true");
    assert.equal(h.get("compare-current-prototype").getAttribute("aria-checked"), "false");
    assert.equal(h.get("visual-selection-status").classList.contains("visually-hidden"), true);
    assert.match(text(h, "visual-selection-status"), /saved accepted prototype/);
    assert.equal(disabled(h, "choose-visual-direction"), true);
    assert.equal(h.get<HTMLAnchorElement>("open-preview").href, value.previewUrl);
    assert.deepEqual(h.requests, []);
});

test("the shared toolbar rechecks and restarts only the preview currently on screen", async t => {
    const value = exploringPrototype();
    const h = await setup(t, value);
    const checks: string[] = [];
    for (const target of ["original", "exploration"] as const) h.setPreviewFetch(async () => {
        checks.push(target);
        const checkpoint = current(h).prototypeFlow!.checkpoints.find(item => item.id === (target === "original" ? "interaction" : "visual-bundle"))!;
        return response({ generation: value.generation, checkpointId: checkpoint.id, pendingCheckpointId: null,
            url: checkpoint.previewUrl, available: false, reason: `${target} server stopped` });
    }, target);
    h.setFetch(async (path, options) => {
        const body = JSON.parse(String(options.body));
        if (path === "/api/prototype/action") return response({ ...current(h), revision: current(h).revision + 1,
            prototypeFlow: updateVisualSelection(current(h).prototypeFlow!, body.checkpointId, body.selection) });
        assert.equal(path, "/api/prototype/preview-restart/inspect");
        return response({ needsRecipe: true, ...body, cwd: "C:\\fixture", url: "http://127.0.0.1:10000/",
            executable: "node", entrypoints: [], message: "Review this preview's start instructions." });
    });
    await h.click("retry-original-preview");
    assert.equal(checks.at(-1), "original");
    assert.equal(h.get("preview-availability").classList.contains("visually-hidden"), false);
    assert.match(text(h, "preview-availability"), /original server stopped/);
    await h.click("restart-original-preview");
    assert.equal(h.requests.at(-1)!.body.target, "original");
    assert.equal(h.requests.at(-1)!.body.checkpointId, "interaction");
    await h.click([...h.document.querySelectorAll<HTMLButtonElement>("dialog[open] button")].find(button => button.textContent === "Cancel")!);
    await h.click("visual-direction-canvas");
    await h.click("retry-visual-preview");
    assert.equal(checks.at(-1), "exploration");
    assert.match(text(h, "visual-preview-availability"), /exploration server stopped/);
    assert.equal(h.get("visual-preview-availability").classList.contains("visually-hidden"), false);
    await h.click("restart-exploration-preview");
    assert.equal(h.requests.at(-1)!.body.target, "exploration");
    assert.equal(h.requests.at(-1)!.body.checkpointId, "visual-bundle");
    assert.equal(h.document.querySelectorAll(".prototype-substage-bar .preview-recovery-action").length, 2);
    assert.equal(h.document.querySelector(".visual-exploration .preview-recovery-action"), null);
    assert.equal(current(h).prototypeFlow!.displayedCheckpointId, "interaction");
});
