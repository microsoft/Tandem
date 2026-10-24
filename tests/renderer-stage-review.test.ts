import assert from "node:assert/strict";
import { test } from "node:test";
import { createStageReview, mergeStageReview, stageReviewDigest, type StageReviewReference } from "../src/stage-review.js";
import { setup, state, decision, response, browse, disabled, hidden, field, current, sketchSetup } from "./renderer-fixtures.test.js";
import type { UiState } from "../src/renderer/ui-context.js";

async function fixture(t: Parameters<typeof setup>[0], changed = false, usageMode = false, blocker: string | null = null) {
    let parent = state("prototype");
    parent.requirements.substage = "dag";
    parent.decisionGraph.nodes = [decision("task", "answered")];
    const reference: StageReviewReference = { version: 1, id: "review-11111111-1111-1111-1111-111111111111",
        stage: "requirements", generation: parent.generation, createdAt: parent.updatedAt, appliedAt: null, discardedAt: null };
    const draft: UiState = { ...createStageReview(parent, reference), revision: 1, provider: parent.provider };
    if (usageMode) {
        draft.requirements = { substage: "usage", usageItems: ["I want to complete a task."], suggestions: [] };
        draft.decisionGraph.nodes = [];
    }
    if (changed) {
        draft.decisionGraph.nodes[0].answer = "Draft task behavior";
        draft.requirements.usageItems.push("I want to share a task list.");
        draft.revision++;
    }
    let failure = "";
    let mutate = async (path: string, _options: RequestInit): Promise<Response> => { throw new Error("Unexpected draft mutation: " + path); };
    const snapshot = () => structuredClone({
        ...draft, provider: { ...draft.provider, canSubmitAnswers: !reference.appliedAt },
        stageReviewStatus: { conflict: "", blocker,
            changed: stageReviewDigest(draft, "requirements") !== draft.stageReview!.baselineDigest,
            currentStage: parent.lifecycle.currentStage, appliedAt: reference.appliedAt, discardedAt: reference.discardedAt },
    });
    const h = await setup(t, parent);
    h.setFetch(async (path, options) => {
        if (path === "/api/reviews/open") {
            parent = { ...parent, revision: parent.revision + 1, stageReviews: [{ ...reference }] };
            return response({ draft: snapshot() });
        }
        if (path === "/api/state") return response(parent);
        if (path === "/api/reviews/apply") {
            if (failure) return response({ error: failure }, 409);
            const body = JSON.parse(String(options.body));
            assert.equal(body.reviewId, reference.id);
            assert.equal(body.expectedRevision, draft.revision);
            parent = mergeStageReview(parent, draft, new Date().toISOString());
            parent.lifecycle.completedStages.push("requirements");
            parent.revision++;
            reference.appliedAt = parent.stageReviews![0].appliedAt;
            return response(parent);
        }
        if (path.startsWith(`/api/reviews/${reference.id}/`)) {
            if (path.endsWith("/baseline")) return response({ state: parent, document: null });
            if (options.method === "POST") return mutate(path, options);
            return response(snapshot());
        }
        throw new Error("Unexpected request: " + path);
    });
    await browse(h, "requirements");
    await h.click("review-stage");
    return { h, draft, reference, failApply(message: string) { failure = message; },
        setDraftMutation(handler: typeof mutate) { mutate = handler; } };
}

test("review mode pins an earlier-stage editor without unlocking accepted work or redirecting current work", async t => {
    const { h, reference } = await fixture(t);
    assert.equal(h.get("project-contents").querySelector('[data-stage-id="requirements"]')!.getAttribute("data-status"), "complete");
    assert.equal(h.get("live-preview-tab").getAttribute("aria-current"), "step");
    assert.equal(h.get("design-tree-tab").getAttribute("aria-current"), null);
    assert.equal(current(h).lifecycle.currentStage, "prototype");
    assert.equal(hidden(h, "reopen-stage"), true);
    assert.equal(hidden(h, "complete-stage"), true);
    assert.match(h.get("design-tree-panel").textContent!, /Pinned draft review.*Current work: Prototype/);
    assert.equal(disabled(h, "review-requirement-request"), false);
    await h.input("review-requirement-request", "Keep this unsent draft while I work on Prototype.");
    const input = field(h, "review-requirement-request");
    await h.click("return-to-current-stage");
    assert.equal(hidden(h, "live-preview-panel"), false);
    await browse(h, "requirements");
    assert.equal(field(h, "review-requirement-request"), input);
    assert.equal(input.value, "Keep this unsent draft while I work on Prototype.");
    h.render({ ...current(h), revision: current(h).revision + 1, stage: "development",
        lifecycle: { ...current(h).lifecycle, currentStage: "development", completedStages: ["prepare", "requirements", "sketch", "prototype"] } });
    await h.flush();
    assert.equal(hidden(h, "design-tree-panel"), false, "Current-stage progress cannot unpin the review.");
    assert.equal(field(h, "review-requirement-request").value, input.value);
    assert.equal(h.requests.some(item => /stage\/reopen|stage\/complete|change-requests/.test(item.path)), false);
    assert.ok(h.requests.some(item => item.path === `/api/reviews/${reference.id}/state`));
});

test("background draft DAG completion cannot steal the current-work view", async t => {
    const { h, draft, setDraftMutation } = await fixture(t, false, true);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    setDraftMutation(async (path, options) => {
        assert.match(path, /\/answer$/);
        assert.equal(JSON.parse(String(options.body)).action, "generate-dag");
        await gate;
        return response({ accepted: true });
    });
    await h.click("generate-dag");
    await h.click("return-to-current-stage");
    assert.equal(hidden(h, "live-preview-panel"), false);
    draft.requirements.substage = "dag";
    draft.decisionGraph.nodes = [decision("new-task", "active")];
    draft.revision++;
    release();
    await h.flush(); await h.flush();
    assert.equal(hidden(h, "live-preview-panel"), false);
    assert.equal(current(h).lifecycle.currentStage, "prototype");
    await browse(h, "requirements");
    assert.match(h.get("design-tree-panel").textContent!, /new-task/);
});

test("Apply is explicit, refuses unsent edits, and leaves the reviewed view pinned after updating accepted work", async t => {
    const { h } = await fixture(t, true);
    assert.equal(disabled(h, "apply-stage-review"), false);
    assert.equal(h.get("apply-stage-review").closest("#stage-input-review") !== null, true);
    assert.ok(h.get("review-requirement-request").compareDocumentPosition(h.get("apply-stage-review")) & h.window.Node.DOCUMENT_POSITION_FOLLOWING);
    assert.equal(h.document.querySelector(".previewbar #apply-stage-review"), null);
    await h.input("review-requirement-request", "Unsent requirement");
    assert.equal(disabled(h, "apply-stage-review"), true);
    await h.input("review-requirement-request", "");
    await h.click("apply-stage-review");
    assert.ok(h.document.querySelector('[role="alertdialog"]'));
    assert.equal(h.requests.some(item => item.path === "/api/reviews/apply"), false);
    await h.confirm(false);
    assert.equal(h.requests.some(item => item.path === "/api/reviews/apply"), false);
    await h.click("apply-stage-review"); await h.confirm(true);
    assert.equal(current(h).lifecycle.currentStage, "prototype");
    assert.equal(current(h).decisionGraph.nodes[0].answer, "Draft task behavior");
    assert.match(h.get("design-tree-panel").textContent!, /Applied review/);
    assert.equal(hidden(h, "design-tree-panel"), false);
    assert.equal(disabled(h, "review-requirement-request"), true);
    const ids = Array.from(h.document.querySelectorAll("[id]"), node => node.id);
    assert.equal(ids.length, new Set(ids).size, "The scoped editor must not duplicate accepted-editor IDs.");
    assert.equal(h.requests.filter(item => item.path === "/api/reviews/apply").length, 1);
});

test("a rejected Apply retains the draft and current-stage identity with an explicit error", async t => {
    const { h, failApply } = await fixture(t, true);
    failApply("Accepted inputs changed; nothing was applied.");
    await h.click("apply-stage-review"); await h.confirm(true);
    assert.match(h.get("stage-review-error").textContent!, /Accepted inputs changed/);
    assert.equal(current(h).lifecycle.currentStage, "prototype");
    assert.notEqual(current(h).decisionGraph.nodes[0].answer, "Draft task behavior");
    assert.equal(hidden(h, "design-tree-panel"), false);
    assert.equal(disabled(h, "review-requirement-request"), false);
});

test("a real parent work blocker is shown before Apply rather than as a failed request afterward", async t => {
    const blocker = "Finish the change already being applied before applying this draft. Your draft remains separate.";
    const { h } = await fixture(t, true, false, blocker);
    assert.equal(disabled(h, "apply-stage-review"), true);
    assert.equal(h.get("apply-stage-review").title, blocker);
    assert.match(h.get("stage-input-review").textContent!, /change already being applied/);
    await h.click("apply-stage-review");
    assert.equal(h.document.querySelector('[role="alertdialog"]'), null);
    assert.equal(h.requests.some(item => item.path === "/api/reviews/apply"), false);
    assert.equal(current(h).lifecycle.currentStage, "prototype");
});

test("baseline comparison includes usage changes as well as changed decisions", async t => {
    const { h } = await fixture(t, true);
    const comparison = h.document.querySelector<HTMLDetailsElement>(".stage-review-comparison")!;
    comparison.open = true;
    await h.fire(comparison, "toggle");
    assert.match(comparison.textContent!, /Usages.*I want to share a task list/s);
    assert.match(comparison.textContent!, /Draft task behavior/);
});

test("read-only providers can inspect earlier content but cannot open an editable review", async t => {
    const value = state("prototype");
    value.provider.canSubmitAnswers = false;
    const h = await setup(t, value);
    await browse(h, "requirements");
    assert.equal(disabled(h, "review-stage"), true);
    assert.equal(h.get("live-preview-tab").getAttribute("aria-current"), "step");
    await h.click("review-stage");
    assert.equal(h.requests.some(item => item.path === "/api/reviews/open"), false);
});

test("stale Designs review exposes a confirmed update scoped to its draft, not current Prototype work", async t => {
    const { h, value, document } = await sketchSetup(t);
    const parent: UiState = { ...value, revision: value.revision + 1, stage: "prototype",
        lifecycle: { ...value.lifecycle, currentStage: "prototype", completedStages: ["prepare", "requirements", "sketch"] },
        sketch: { ...value.sketch, status: "stale" } };
    const reference: StageReviewReference = { version: 1, id: "review-22222222-2222-2222-2222-222222222222",
        stage: "sketch", generation: parent.generation, createdAt: parent.updatedAt, appliedAt: null, discardedAt: null };
    const draft: UiState = { ...createStageReview(parent, reference), revision: 1, provider: parent.provider };
    const snapshot = (): UiState => structuredClone({ ...draft, stageReviewStatus: {
        conflict: "", blocker: "The designs refer to older requirements.", changed: false,
        appliedAt: null, discardedAt: null, currentStage: "prototype",
    } });
    const prefix = `/api/reviews/${reference.id}`;
    h.setFetch(async (path, options) => {
        if (path === "/api/reviews/open") {
            parent.stageReviews = [reference];
            parent.revision++;
            return response({ draft: snapshot() });
        }
        if (path === "/api/state") return response(parent);
        if (path === "/api/sketch") return response({ sketch: parent.sketch, document });
        if (path === `${prefix}/state`) return response(snapshot());
        if (path === `${prefix}/sketch`) {
            if (options.method === "POST") {
                assert.deepEqual(JSON.parse(String(options.body)), { action: "update", expectedRevision: "drawing-1" });
                draft.processing = { action: "revise-sketch", status: "running", message: "Updating draft designs." };
                draft.revision++;
                return response(snapshot());
            }
            return response({ sketch: draft.sketch, document });
        }
        throw new Error("Unexpected draft request: " + path);
    });
    h.render(parent);
    await h.flush();
    await browse(h, "sketch");
    await h.click("review-stage");
    assert.equal(disabled(h, "sketch-update-requirements"), false);
    assert.equal(disabled(h, "apply-stage-review"), true);
    assert.equal(disabled(h, "sketch-approve"), true);
    assert.equal(h.document.querySelector("#prepare-review-drawings"), null);
    await h.click("sketch-update-requirements");
    assert.match(h.document.querySelector('[role="alertdialog"]')!.textContent!, /latest accepted requirements and DAG/);
    await h.confirm(false);
    assert.equal(h.requests.some(item => item.path === `${prefix}/sketch` && item.options.method === "POST"), false);
    await h.click("sketch-update-requirements");
    await h.confirm(true);
    assert.equal(h.requests.filter(item => item.path === `${prefix}/sketch` && item.options.method === "POST").length, 1);
    assert.equal(current(h).lifecycle.currentStage, "prototype");
    assert.equal(current(h).sketch.current!.id, parent.sketch.current!.id);
    assert.equal(current(h).sketch.status, "stale");
    assert.equal(disabled(h, "apply-stage-review"), true);
    assert.equal(disabled(h, "sketch-approve"), true);
    assert.equal(h.requests.some(item => item.path === "/api/reviews/apply" || item.path === "/api/stage/complete"), false);
});
