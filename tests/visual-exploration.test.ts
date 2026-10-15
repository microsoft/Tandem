import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { extensionHarness } from "./helpers/extension-harness.js";
import { exploringPrototype, visualManifest } from "./helpers/visual-fixture.js";
import { prototypePreviewBridgeSource } from "../src/prototype-bridge.js";
import { updateVisualSelection } from "../src/prototype-flow.js";
import { visualManifestName, type VisualManifest } from "../src/visual-directions.js";
import type { TandemState } from "../src/types.js";
import { setup, response, current, submit, disabled, text } from "./renderer-fixtures.test.js";

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
        clearInterval(server.heartbeat); server.live.close();
        await new Promise<void>(resolve => { server.server.close(() => resolve()); server.server.closeAllConnections(); });
    });
    const before = plain(await h.api.loadState("sample"));
    const status = await (await fetch(new URL("/api/prototype/preview-status?target=exploration", server.url))).json();
    assert.equal(status.available, true);
    assert.equal(status.checkpointId, state.prototypeFlow!.visualExploration!.checkpointId);
    assert.notEqual(status.url, state.previewUrl);
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
    assert.equal(disabled(h, "complete-stage"), true);
    assert.equal(h.document.querySelectorAll(".visual-direction-card").length, 3);
    await h.input("revision-input", "Keep this current-prototype draft.");
    await h.click("visual-direction-canvas");
    assert.equal(h.get("preview-frame"), accepted);
    assert.equal(accepted.src, acceptedUrl);
    assert.equal(accepted.hidden, true);
    assert.match(text(h, "visual-selection-status"), /Exploring: Canvas first.*Not applied/);
    const frame = h.get<HTMLIFrameElement>("visual-preview-frame"), frameUrl = frame.src;
    await h.input("visual-setting-textSize", "large");
    assert.equal(h.get("visual-preview-frame"), frame);
    assert.equal(frame.src, frameUrl, "Adjustments use the bridge, not iframe reloads.");
    await h.click("visual-direction-precision");
    assert.equal(h.get<HTMLSelectElement>("visual-setting-textSize").value, "standard");
    await h.click("visual-direction-canvas");
    assert.equal(h.get<HTMLSelectElement>("visual-setting-textSize").value, "large");
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
    await h.input("visual-feedback-input", "Simplify this toolbar.");
    await submit(h, "visual-feedback-form");
    assert.equal(h.requests.at(-1)!.path, "/api/revision");
    assert.equal(h.requests.at(-1)!.body.baseCheckpointId, "visual-bundle");
    assert.equal(h.requests.at(-1)!.body.visualSelection.directionId, "canvas");
    await h.click("compare-current-prototype");
    assert.equal(accepted.hidden, false);
    assert.equal(h.get<HTMLTextAreaElement>("revision-input").value, "Keep this current-prototype draft.");
    assert.equal(current(h).prototypeFlow!.displayedCheckpointId, "interaction");
    assert.equal(current(h).prototypeFlow!.pendingCheckpointId, null);
    assert.equal(h.requests.filter(item => item.body?.action === "choose-visual").length, 0);
});
