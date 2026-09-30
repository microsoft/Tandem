import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { reactHarness, state as initialState, decision, response } from "./helpers/react-harness.js";
import { createScreen, createShape } from "../src/renderer/sketch-editor.js";
import type { SketchDocument } from "../src/sketch.js";

export { reactHarness, decision, response, createScreen, createShape };
export type Harness = Awaited<ReturnType<typeof reactHarness>>;
export const state = (stage: Parameters<typeof initialState>[0] = "requirements", revision = 1): any => initialState(stage, revision);
export const text = (h: Harness, id: string) => h.get(id).textContent!;
export const field = (h: Harness, id: string) => h.get<HTMLInputElement>(id);
export const disabled = (h: Harness, id: string) => h.get<HTMLButtonElement>(id).disabled;
export const hidden = (h: Harness, id: string) => !h.document.getElementById(id) || h.get(id).hidden;
export const current = (h: Harness) => h.store.getSnapshot().state;
export const submit = (h: Harness, id: string) => h.fire(h.get(id), "submit");
export const browse = (h: Harness, stage: string) => h.click(h.document.querySelector(`[data-stage-id="${stage}"]`)!);
export async function waitFor(h: Harness, predicate: () => boolean) {
    for (let attempt = 0; attempt < 50; attempt++) {
        await h.flush();
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(predicate(), "React did not settle into the expected DOM state");
}
export async function setup(t: TestContext, value = state()) {
    const h = await reactHarness(t);
    t.after(() => assert.deepEqual(h.errors, [], "React must render without console errors"));
    h.render(value);
    await h.flush();
    return h;
}
export function blankEffort(revision = 1, generation = "fixture-generation") {
    return { ...state("prepare", revision), goal: "", generation };
}
export function checkpoint(id: string, milestone: string, status = "ready", extra: any = {}) {
    return { id, milestone, revisionId: null, requestId: `request-${id}`, generation: "fixture-generation", status,
        baseCheckpointId: null, workspacePath: `workspaces\\${id}`,
        previewUrl: status === "ready" ? `http://127.0.0.1:${id === "structure" ? 9998 : 9999}/` : null,
        summary: `${milestone} checkpoint`, focus: `Building ${milestone}`, requestedAt: "2026-09-09T00:00:00Z",
        completedAt: status === "running" ? null : "2026-09-09T00:01:00Z", timeoutSeconds: 300, ...extra };
}
export function progressivePrototype(revision = 1): any {
    return { ...state("prototype", revision), previewStatus: "ready", previewUrl: "http://127.0.0.1:9998/",
        prototypeFlow: { version: 1, checkpoints: [checkpoint("structure", "structure"), checkpoint("interaction", "interaction", "running")],
            displayedCheckpointId: "structure", pendingCheckpointId: null, activeCheckpointId: "interaction",
            visualRequested: false, budget: { limitSeconds: 900, usedSeconds: 90 } } };
}
export function readyPrototype(revision = 1, pending = false): any {
    const value = progressivePrototype(revision);
    value.prototypeFlow.checkpoints[1] = checkpoint("interaction", "interaction");
    value.prototypeFlow.activeCheckpointId = null;
    value.prototypeFlow.pendingCheckpointId = pending ? "interaction" : null;
    value.prototypeFlow.displayedCheckpointId = pending ? "structure" : "interaction";
    value.previewUrl = value.prototypeFlow.checkpoints[pending ? 0 : 1].previewUrl;
    return value;
}
export function sketchFixture(revision = 1) {
    const value = state("sketch", revision);
    value.requirements.substage = "dag";
    value.decisionGraph.nodes = [decision("accepted", "answered")];
    value.sketch.current = { id: "drawing-" + revision, number: revision, requirementsDigest: "requirements-digest",
        documentHash: "document-" + revision, createdAt: value.updatedAt, source: "generated" };
    value.sketch.status = "draft";
    const document: SketchDocument = { version: 1, screens: [], transitions: [] };
    document.screens.push(createScreen(document, ["accepted"]));
    document.screens[0].shapes.push(createShape(document.screens[0], "rectangle"));
    return { value, document };
}
export async function sketchSetup(t: TestContext, fixture = sketchFixture()) {
    const h = await reactHarness(t);
    t.after(() => assert.deepEqual(h.errors, []));
    h.window.SVGElement.prototype.getBoundingClientRect = function () {
        const width = Number(this.getAttribute("width")) || 960;
        const height = Number(this.getAttribute("height")) || 640;
        return { x: 0, y: 0, left: 0, top: 0, width, height, right: width, bottom: height, toJSON() {} };
    };
    h.setFetch(async () => response({ sketch: fixture.value.sketch, document: fixture.value.sketch.current ? fixture.document : null }));
    h.render(fixture.value);
    await h.flush();
    return { h, ...fixture };
}
