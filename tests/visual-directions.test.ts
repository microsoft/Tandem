import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { isPrototypePreviewTarget, originalPrototypeCheckpointId, readVisualManifest, readVisualSelection, visualExplorationIsCurrent, visualPreviewUrl, type VisualCheckpoint } from "../src/visual-directions.js";
import { newPrototypeFlow, readPrototypeFlow, reservePrototypeCheckpoint, settlePrototypeCheckpoint,
    updateVisualSelection, prototypeFlowCompletionError, promotePrototypeCheckpoint, restoreOriginalPrototype,
    prototypePreviewCheckpointId, type PrototypeCheckpoint } from "../src/prototype-flow.js";
import { prototypePreviewBridgeSource } from "../src/prototype-bridge.js";
import { buildPrototypeCheckpointPrompt } from "../src/planning-prompts.js";
import { visualManifest } from "./helpers/visual-fixture.js";

function pending(id: string, milestone: PrototypeCheckpoint["milestone"], base: string | null, visual?: VisualCheckpoint) {
    return { id, requestId: id, generation: "generation", milestone, revisionId: null,
        baseCheckpointId: base, sourceCheckpointId: base, workspacePath: `C:\\fixture\\.tandem\\${id}`,
        workspacePrepared: true, status: "running" as const, previewUrl: null, summary: "", focus: "",
        requestedAt: "2026-10-15T00:00:00Z", completedAt: null, ...(visual ? { visual } : {}) };
}
function readyFlow() {
    let flow = newPrototypeFlow();
    for (const milestone of ["structure", "interaction"] as const) {
        flow = reservePrototypeCheckpoint(flow, pending(milestone, milestone, flow.displayedCheckpointId));
        flow = settlePrototypeCheckpoint(flow, milestone, { status: "ready", previewUrl: `http://127.0.0.1:${milestone === "structure" ? 9001 : 9002}/`,
            summary: "Ready", focus: "" }, "2026-10-15T00:01:00Z");
        if (flow.pendingCheckpointId) flow = promotePrototypeCheckpoint(flow, flow.pendingCheckpointId);
    }
    const visual: VisualCheckpoint = { operation: "explore", explorationCheckpointId: null, selection: null, manifest: null };
    flow = reservePrototypeCheckpoint({ ...flow, visualRequested: true }, pending("visual", "visual", "interaction", visual));
    return settlePrototypeCheckpoint(flow, "visual", { status: "ready", previewUrl: "http://127.0.0.1:9003/",
        summary: "Alternatives", focus: "", visual: { ...visual, manifest: visualManifest() } }, "2026-10-15T00:01:00Z");
}

test("milestone preview targets resolve saved results without replacing the accepted checkpoint", () => {
    const flow = readyFlow(), before = structuredClone(flow);
    assert.equal(prototypePreviewCheckpointId(flow, "structure"), "structure");
    assert.equal(prototypePreviewCheckpointId(flow, "interaction"), "interaction");
    assert.equal(prototypePreviewCheckpointId(flow, "prototype"), "interaction");
    assert.equal(prototypePreviewCheckpointId(flow, "visual"), "visual");
    assert.equal(prototypePreviewCheckpointId(null, "structure"), null);
    assert.deepEqual(flow, before);
    flow.checkpoints.push({ ...flow.checkpoints[1], id: "next-interaction" });
    flow.pendingCheckpointId = "next-interaction";
    assert.equal(prototypePreviewCheckpointId(flow, "interaction"), "interaction", "The accepted milestone wins over an unapplied revision of that same milestone.");
    assert.equal(prototypePreviewCheckpointId(flow, "prototype"), "interaction");
    flow.displayedCheckpointId = "structure";
    assert.equal(prototypePreviewCheckpointId(flow, "prototype"), "structure", "Merging tabs cannot silently promote a waiting version.");
    flow.displayedCheckpointId = "visual";
    assert.equal(prototypePreviewCheckpointId(flow, "interaction"), "next-interaction");
    flow.checkpoints.at(-1)!.status = "failed";
    assert.equal(prototypePreviewCheckpointId(flow, "interaction"), "interaction");
    flow.checkpoints[2].visualDismissedAt = "2026-10-15T00:02:00Z";
    assert.equal(prototypePreviewCheckpointId(flow, "visual"), null);
    for (const target of ["current", "pending", "exploration", "original", "prototype", "structure", "interaction", "visual"]) {
        assert.equal(isPrototypePreviewTarget(target), true);
    }
    for (const target of ["checkpoint-id", "../structure", null, {}]) assert.equal(isPrototypePreviewTarget(target), false);
});

test("visual manifests require a bounded set of genuinely different design contracts and exact settings", () => {
    const valid = visualManifest();
    assert.deepEqual(readVisualManifest(JSON.parse(JSON.stringify(valid))), valid);
    assert.throws(() => readVisualManifest({ ...valid, directions: valid.directions.slice(0, 1) }), /two or three/);
    assert.throws(() => readVisualManifest({ ...valid, directions: [...valid.directions, valid.directions[0]] }), /two or three/);
    for (const patch of [
        { id: "precision" }, { layout: valid.directions[0].layout }, { name: "PRECISION WORKSPACE" },
        { typography: valid.directions[0].typography, effects: valid.directions[0].effects },
        { sketchChanges: "" }, { defaults: { ...valid.directions[1].defaults, effects: "unlimited" } }, { extra: true },
    ]) {
        assert.throws(() => readVisualManifest({ ...valid, directions: valid.directions.map((item, index) => index === 1 ? { ...item, ...patch } : item) }));
    }
    assert.throws(() => readVisualManifest({ ...valid, defaultSelection: { ...valid.defaultSelection, directionId: "missing" } }), /does not belong/);
    assert.throws(() => readVisualSelection({ directionId: "__proto__", settings: valid.defaultSelection.settings }), /exact direction/);
    assert.throws(() => readVisualSelection({ ...valid.defaultSelection, settings: { ...valid.defaultSelection.settings, css: "anything" } }), /valid visual/);
});

test("comparison and adjustments persist without promotion; choice defaults survive a source-bound checkpoint", () => {
    const flow = readyFlow();
    assert.equal(flow.displayedCheckpointId, "interaction");
    assert.equal(flow.pendingCheckpointId, null);
    assert.match(prototypeFlowCompletionError(flow)!, /Choose and apply/);
    const selection = { directionId: "canvas", settings: { ...visualManifest().directions[1].defaults, textSize: "large" as const } };
    const compared = updateVisualSelection(flow, "visual", selection);
    assert.equal(compared.displayedCheckpointId, "interaction");
    assert.deepEqual(compared.checkpoints, flow.checkpoints);
    assert.deepEqual(compared.visualExploration!.selections[0], flow.visualExploration!.selections[0]);
    assert.equal(compared.visualExploration!.activeDirectionId, "canvas");
    assert.deepEqual(readPrototypeFlow(JSON.parse(JSON.stringify(compared))), compared);
    assert.throws(() => updateVisualSelection(compared, "missing", selection), /changed/);
    assert.throws(() => updateVisualSelection(compared, "visual", { ...selection, directionId: "missing" }), /changed/);
    assert.throws(() => promotePrototypeCheckpoint(compared, "visual"), /no longer pending/);
    const visual: VisualCheckpoint = { operation: "choose", explorationCheckpointId: "visual", selection, manifest: null };
    const prepared = settlePrototypeCheckpoint(reservePrototypeCheckpoint(compared, pending("chosen", "visual", "interaction", visual)),
        "chosen", { status: "ready", previewUrl: "http://127.0.0.1:9004/", summary: "Prepared", focus: "",
            visual: { ...visual, manifest: { ...visualManifest(), defaultSelection: selection } } }, "2026-10-15T00:01:00Z");
    assert.equal(prepared.displayedCheckpointId, "interaction");
    assert.equal(prepared.pendingCheckpointId, "chosen");
    const applied = promotePrototypeCheckpoint(prepared, "chosen");
    assert.equal(applied.visualExploration!.appliedCheckpointId, "chosen");
    assert.equal(prototypeFlowCompletionError(applied), null);
    assert.deepEqual(readPrototypeFlow(JSON.parse(JSON.stringify(applied))), applied);
    assert.equal(applied.checkpoints.find(item => item.id === "visual")!.visual!.manifest!.defaultSelection.directionId, "precision");
    assert.equal(prototypePreviewCheckpointId(applied, "original"), "interaction");
    const restored = restoreOriginalPrototype(applied, "interaction");
    assert.equal(restored.displayedCheckpointId, "interaction");
    assert.equal(restored.visualRequested, false);
    assert.equal(restored.visualExploration!.appliedCheckpointId, null);
    assert.deepEqual(restored.checkpoints, applied.checkpoints);
    assert.deepEqual(restored.visualExploration!.selections, applied.visualExploration!.selections);
    assert.deepEqual(readPrototypeFlow(JSON.parse(JSON.stringify(restored))), restored);
    assert.equal(prototypeFlowCompletionError(restored), null);
    assert.throws(() => restoreOriginalPrototype(prepared, "interaction"), /active or prepared/);
    assert.throws(() => restoreOriginalPrototype(applied, "chosen"), /original prototype no longer matches/);
});

test("refining an accepted visual direction retains the original Default source rather than replacing it with that direction", () => {
    const flow = readyFlow();
    const selection = visualManifest().directions[1];
    const choice: VisualCheckpoint = { operation: "choose", explorationCheckpointId: "visual",
        selection: { directionId: selection.id, settings: selection.defaults }, manifest: null };
    const prepared = settlePrototypeCheckpoint(reservePrototypeCheckpoint(flow, pending("chosen", "visual", "interaction", choice)),
        "chosen", { status: "ready", previewUrl: "http://127.0.0.1:9004/", summary: "", focus: "",
            visual: { ...choice, manifest: { ...visualManifest(), defaultSelection: choice.selection! } } }, "2026-10-15T00:01:00Z");
    const applied = promotePrototypeCheckpoint(prepared, "chosen");
    const refinement: VisualCheckpoint = { ...choice, operation: "refine" };
    const refined = settlePrototypeCheckpoint(reservePrototypeCheckpoint(applied, pending("refined", "visual", "chosen", refinement)),
        "refined", { status: "ready", previewUrl: "http://127.0.0.1:9005/", summary: "", focus: "",
            visual: { ...refinement, manifest: visualManifest() } }, "2026-10-15T00:02:00Z");
    assert.equal(originalPrototypeCheckpointId(refined), "interaction");
    const restored = restoreOriginalPrototype(refined, "interaction");
    assert.equal(visualExplorationIsCurrent(restored), true);
    assert.equal(originalPrototypeCheckpointId(restored), "interaction");
    assert.deepEqual(readPrototypeFlow(JSON.parse(JSON.stringify(restored))), restored);
    const cyclic = { ...refined, checkpoints: refined.checkpoints.map(item => item.id === "refined"
        ? { ...item, visual: { ...refinement, explorationCheckpointId: "refined" } } : item) };
    assert.throws(() => originalPrototypeCheckpointId(cyclic), /source chain contains a cycle/);
});

test("visual reload rejects dangling alternatives, changed choices and incomplete source/default identities", () => {
    const flow = readyFlow();
    for (const patch of [
        { checkpointId: "interaction" }, { appliedCheckpointId: "interaction" }, { activeDirectionId: "missing" },
        { selections: [] }, { selections: [flow.visualExploration!.selections[0], flow.visualExploration!.selections[0], flow.visualExploration!.selections[2]] },
    ]) assert.throws(() => readPrototypeFlow({ ...flow, visualExploration: { ...flow.visualExploration, ...patch } }));
    assert.throws(() => readPrototypeFlow({ ...flow, checkpoints: flow.checkpoints.map(item => item.id === "visual"
        ? { ...item, visual: { ...item.visual, manifest: null } } : item) }), /invalid/);
});

test("the shared production prompt asks for layout/style exploration and narrowly scoped refinement/choice", () => {
    const visual: VisualCheckpoint = { operation: "explore", explorationCheckpointId: null, selection: null, manifest: null };
    const args: Parameters<typeof buildPrototypeCheckpointPrompt>[0] = {
        prototypeId: "fixture", projectRoot: "C:\\fixture", checkpoint: pending("visual", "visual", "interaction", visual),
        goal: "3D viewer", approach: "build", requirements: {}, confirmed: [],
    };
    const prompt = buildPrototypeCheckpointPrompt(args);
    for (const expected of ["two or three genuinely distinct", "Do not offer palette swaps", "sketchChanges",
        "tandem-visual-directions.json", "data-tandem-direction", "--tandem-text-scale", "EVERY direction", "same primary journey"]) {
        assert.match(prompt.toLowerCase(), new RegExp(expected.toLowerCase()));
    }
    assert.match(prompt, /Default option shows the exact original prototype checkpoint/);
    assert.doesNotMatch(prompt, /additional Default wireframe preset/);
    const selection = visualManifest().defaultSelection;
    const choice = buildPrototypeCheckpointPrompt({ ...args, checkpoint: { ...args.checkpoint,
        visual: { ...visual, operation: "choose", explorationCheckpointId: "visual", selection } }, visualBase: visualManifest() });
    assert.match(choice, /without query parameters, localStorage/);
    assert.doesNotMatch(choice, /VISUAL EXPLORATION \(optional\): implement/);
    const revision = buildPrototypeCheckpointPrompt({ ...args, checkpoint: { ...args.checkpoint,
        visual: { ...visual, operation: "refine", explorationCheckpointId: "visual", selection } },
        visualBase: visualManifest(), revision: { suggestion: "Simplify the selected toolbar." } });
    assert.match(revision, /revise ONLY the selected direction/);
    assert.match(revision, /Simplify the selected toolbar/);
    assert.doesNotMatch(revision, /VISUAL EXPLORATION \(optional\): implement/);
});

test("visual bridge applies standalone defaults, trusted in-place adjustments and reduced motion without losing interaction state", async t => {
    const manifest = visualManifest();
    const dom = new JSDOM('<!doctype html><head><meta name="tandem-prototype-id" content="fixture"><meta name="tandem-prototype-checkpoint" content="visual"><meta name="tandem-visual-exploration" content="1"></head><body><input id="shape" value="retained"></body>', {
        url: "http://127.0.0.1:9003/", referrer: "http://127.0.0.1:4567/", runScripts: "outside-only", pretendToBeVisual: true,
    });
    t.after(() => dom.window.close());
    const replies: Array<{ data: Record<string, unknown>; origin: string }> = [], errors: string[] = [];
    const parent = { postMessage: (data: Record<string, unknown>, origin: string) => replies.push({ data, origin }) };
    Object.defineProperty(dom.window, "parent", { value: parent });
    let reduced = false;
    Object.assign(dom.window, { TextEncoder, TextDecoder, AbortSignal, fetch: async () => Response.json(manifest),
        matchMedia: () => ({ get matches() { return reduced; }, addEventListener() {} }) });
    dom.window.console.error = (...args) => errors.push(args.join(" "));
    dom.window.eval(prototypePreviewBridgeSource);
    for (let i = 0; !replies.length && i < 20; i++) await new Promise(resolve => setTimeout(resolve, 0));
    const root = dom.window.document.documentElement;
    assert.equal(root.getAttribute("data-tandem-direction"), "precision");
    const selection = { directionId: "canvas", settings: { ...manifest.directions[1].defaults, textSize: "large" as const } };
    const send = (overrides: Record<string, unknown> = {}, source: unknown = parent, origin = "http://127.0.0.1:4567") =>
        dom.window.dispatchEvent(new dom.window.MessageEvent("message", { source, origin, data: {
            type: "tandem:visual:apply", prototypeId: "fixture", checkpointId: "visual", requestId: "adjust", selection, ...overrides,
        } }));
    send({}, null); send({}, parent, "http://evil.example"); send({ checkpointId: "other" });
    assert.equal(root.getAttribute("data-tandem-direction"), "precision");
    reduced = true;
    send();
    assert.equal(root.getAttribute("data-tandem-direction"), "canvas");
    assert.equal(root.getAttribute("data-tandem-color-mode"), "dark");
    assert.equal(root.getAttribute("data-tandem-effects"), "none");
    assert.equal(root.style.getPropertyValue("--tandem-text-scale"), "1.125");
    assert.equal(dom.window.document.querySelector<HTMLInputElement>("#shape")!.value, "retained");
    assert.equal(replies.at(-1)!.data.type, "tandem:visual:applied");
    assert.equal(replies.at(-1)!.origin, "http://127.0.0.1:4567");
    assert.equal(new URL(dom.window.location.href).searchParams.get("tandem-direction"), "canvas");
    assert.equal(visualPreviewUrl("http://127.0.0.1:9003/", selection), dom.window.location.href);
    send({ selection: { ...selection, settings: { ...selection.settings, accent: "invalid" } } });
    assert.equal(replies.at(-1)!.data.type, "tandem:visual:error");
    assert.match(dom.window.document.querySelector("[role=alert]")!.textContent!, /do not match/);
    assert.equal(errors.length, 1);
});
