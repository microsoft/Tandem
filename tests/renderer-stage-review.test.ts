import assert from "node:assert/strict";
import { test } from "node:test";
import { createStageReview, mergeStageReview, stageReviewDigest, type StageReviewReference } from "../src/stage-review.js";
import { setup, state, decision, response, browse, disabled, hidden, field, current, sketchSetup } from "./renderer-fixtures.test.js";
import type { UiState } from "../src/renderer/ui-context.js";

async function fixture(t: Parameters<typeof setup>[0], changed: boolean | "usage-only" | ((draft: UiState) => void) = false, usageMode = false,
    blocker: string | null = null, baselineError = "", waitForBaseline?: Promise<void>) {
    let parent = state("prototype");
    parent.requirements.substage = "dag";
    parent.requirements.usageItems = ["I want to complete a task."];
    parent.decisionGraph.nodes = [decision("task", "answered")];
    const baseline = structuredClone(parent);
    const reference: StageReviewReference = { version: 1, id: "review-11111111-1111-1111-1111-111111111111",
        stage: "requirements", generation: parent.generation, createdAt: parent.updatedAt, appliedAt: null, discardedAt: null };
    const draft: UiState = { ...createStageReview(parent, reference), revision: 1, provider: parent.provider };
    if (usageMode) {
        draft.requirements = { substage: "usage", usageItems: ["I want to complete a task."], suggestions: [] };
        draft.decisionGraph.nodes = [];
    }
    if (typeof changed === "function") {
        changed(draft);
        draft.revision++;
    } else if (changed) {
        if (changed !== "usage-only") draft.decisionGraph.nodes[0].answer = "Draft task behavior";
        draft.requirements.usageItems.push("I want to share a task list.");
        draft.revision++;
    }
    let failure = "";
    let mutate = async (path: string, _options: RequestInit): Promise<Response> => { throw new Error("Unexpected draft mutation: " + path); };
    const snapshot = () => structuredClone({
        ...draft, provider: { ...draft.provider, canSubmitAnswers: !reference.appliedAt },
        stageReviewStatus: { conflict: "", blocker: blocker ?? (draft.decisionGraph.nodes.some(node => !node.answer)
            ? "Answer the remaining requirement questions before applying." : null),
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
            if (path.endsWith("/baseline")) {
                await waitForBaseline;
                return baselineError ? response({ error: baselineError }, 409) : response({ state: baseline, document: null });
            }
            if (options.method === "POST") return mutate(path, options);
            return response(snapshot());
        }
        throw new Error("Unexpected request: " + path);
    });
    await browse(h, "requirements");
    await h.click("review-stage");
    return { h, draft, reference, failApply(message: string) { failure = message; },
        restoreBaseline() { baselineError = ""; },
        setDraftMutation(handler: typeof mutate) { mutate = handler; } };
}

test("draft requirement changes share the input, Send and History structure without mutating on history browsing", async t => {
    const { h } = await fixture(t);
    const input = h.get("review-requirement-request"), form = input.closest("form")!;
    assert.ok(form.classList.contains("feedback-composer"));
    assert.equal(form.lastElementChild, h.get("requirements-history-toggle"));
    assert.equal(form.querySelector('button[type="submit"]')!.textContent, "Send");
    await h.input(input, "Keep this requirements draft.");
    const before = h.requests.length;
    await h.click("requirements-history-toggle");
    assert.equal(h.get("requirements-request-history").hidden, false);
    assert.match(h.get("requirements-request-history").textContent!, /No requirement change requests yet/);
    await h.fire(h.get("requirements-request-history"), "keydown", { key: "Escape" });
    assert.equal(h.get("requirements-request-history").hidden, true);
    assert.equal(h.document.activeElement, h.get("requirements-history-toggle"));
    assert.equal(field(h, "review-requirement-request").value, "Keep this requirements draft.");
    assert.equal(h.requests.length, before);
});

test("review mode pins an earlier-stage editor without unlocking accepted work or redirecting current work", async t => {
    const { h, reference } = await fixture(t);
    assert.equal(h.get("project-contents").querySelector('[data-stage-id="requirements"]')!.getAttribute("data-status"), "complete");
    assert.equal(h.get("live-preview-tab").getAttribute("aria-current"), "step");
    assert.equal(h.get("design-tree-tab").getAttribute("aria-current"), null);
    assert.equal(current(h).lifecycle.currentStage, "prototype");
    assert.equal(hidden(h, "reopen-stage"), true);
    assert.equal(hidden(h, "complete-stage"), true);
    assert.match(h.get("stage-input-review").textContent!, /Requirements review.*Draft only/);
    assert.equal(disabled(h, "review-requirement-request"), false);
    await h.input("review-requirement-request", "Keep this unsent draft while I work on Prototype.");
    const input = field(h, "review-requirement-request");
    await h.click("return-to-current-stage");
    assert.equal(hidden(h, "live-preview-panel"), false);
    assert.equal(h.document.querySelector('[aria-label="Requirements review summary"]'), null, "Inactive reviews cannot leave summary information in the current-work pane.");
    await browse(h, "requirements");
    assert.ok(h.get("stage-input-review").querySelector('[aria-label="Requirements review summary"]'));
    assert.equal(h.requests.filter(item => item.path.endsWith("/baseline")).length, 1, "The baseline stays loaded while its summary moves with the review pane.");
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
    assert.match(h.get("stage-input-review").textContent!, /Applied requirement changes/);
    assert.match(h.get("design-tree-panel").textContent!, /saved changes are now part of accepted work/);
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

test("requirement review uses the existing usages and questions instead of a top comparison table", async t => {
    const { h } = await fixture(t, true);
    const comparison = h.document.querySelector(".stage-review-comparison")!;
    assert.ok(comparison.closest("#stage-input-review"), "Review information belongs with the review and approval controls.");
    assert.equal(h.get("design-tree-panel").querySelector(".stage-review-comparison, .stage-review-banner"), null);
    assert.equal(comparison.querySelector("table"), null);
    const usages = h.document.querySelector('[aria-label="Draft usages"]')!;
    assert.equal(usages.closest("[hidden]"), null, "Usage changes open in the normal Usage list.");
    assert.match(usages.querySelector('[data-change="retained"]')!.textContent!, /I want to complete a task.*Existing/);
    assert.match(usages.querySelector('[data-change="added"]')!.textContent!, /I want to share a task list.*Added/);
    await h.click("review-requirement-questions");
    assert.equal(h.get("requirements-dag-panel").hidden, false);
    assert.equal(h.get("requirements-usage-panel").hidden, true);
    assert.equal(h.document.querySelector('[data-decision-id="task"]')!.getAttribute("data-change"), "changed");
    assert.match(h.get("question-host").textContent!, /Draft task behavior/);
    assert.equal(h.document.querySelectorAll("#decision-submit").length, 1, "Review reuses the existing answer form.");
    const details = Array.from(h.get("stage-input-review").querySelectorAll("button")).find(button => button.textContent === "Details")!;
    await h.click(details);
    const fullComparison = h.document.querySelector('[role="dialog"] .stage-review-comparison')!;
    assert.match(fullComparison.textContent!, /Accepted.*Draft.*Previous answer.*Draft task behavior/s);
    assert.match(fullComparison.textContent!, /Usages.*I want to share a task list/s);
    await h.click(h.document.querySelector('[role="dialog"] [aria-label="Close review details"]')!);
    assert.equal(h.document.activeElement, details);
    assert.equal(h.requests.filter(item => /\/answer$|\/apply$/.test(item.path)).length, 0, "Inspecting changes does not accept them.");
});

test("a usage-only review explains why no questions are needed and shows the actual delta before Apply", async t => {
    const { h, draft } = await fixture(t, "usage-only");
    const comparison = h.document.querySelector(".stage-review-comparison")!;
    assert.match(comparison.textContent!, /No new questions need answers/);
    assert.match(h.document.querySelector('[aria-label="Draft usages"] [data-change="added"]')!.textContent!, /I want to share a task list/);
    assert.equal(h.get("decision-list").querySelectorAll("[data-change]").length, 0, "Unchanged answers are not presented as changes.");
    assert.equal(h.document.querySelector("#review-requirement-questions"), null);
    assert.equal(draft.decisionGraph.nodes[0].answer, decision("task", "answered").answer);
    assert.equal(disabled(h, "apply-stage-review"), false);
    await h.click("apply-stage-review");
    await h.confirm(true);
    assert.ok(current(h).requirements.usageItems.includes("I want to share a task list."));
    assert.equal(current(h).lifecycle.currentStage, "prototype");
    assert.equal(h.requests.filter(item => item.options.method === "POST" && /prototype/.test(item.path)).length, 0);
    assert.match(comparison.textContent!, /Accepted revision 1/, "The comparison stays bound to its immutable baseline.");
});

test("a missing baseline keeps Apply disabled with an explicit retry instead of a blind acceptance", async t => {
    const { h, restoreBaseline } = await fixture(t, "usage-only", false, null, "The saved baseline could not be read.");
    const comparison = h.document.querySelector(".stage-review-comparison")!;
    assert.ok(comparison.closest("#stage-input-review"));
    assert.equal(h.get("design-tree-panel").querySelector(".stage-review-comparison"), null);
    assert.match(comparison.textContent!, /saved baseline could not be read/);
    assert.equal(disabled(h, "apply-stage-review"), true);
    assert.equal(h.requests.some(item => item.path === "/api/reviews/apply"), false);
    restoreBaseline();
    await h.click(comparison.querySelector("button")!);
    assert.equal(disabled(h, "apply-stage-review"), false);
    assert.match(h.document.querySelector('[aria-label="Draft usages"]')!.textContent!, /I want to share a task list/);
});

test("baseline loading appears only in the bottom review pane and keeps Apply disabled", async t => {
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    t.after(() => release());
    const { h } = await fixture(t, "usage-only", false, null, "", waiting);
    assert.match(h.get("stage-input-review").textContent!, /Reading the saved baseline/);
    assert.doesNotMatch(h.get("design-tree-panel").textContent!, /Reading the saved baseline|Review saved requirement changes/);
    assert.equal(disabled(h, "apply-stage-review"), true);
    release();
    await h.flush();
    assert.doesNotMatch(h.get("stage-input-review").textContent!, /Reading the saved baseline/);
    assert.match(h.get("stage-input-review").textContent!, /No new questions need answers/);
    assert.equal(disabled(h, "apply-stage-review"), false);
});

test("new review questions keep prerequisites and answer only the scoped draft while retaining accepted answers", async t => {
    const { h, draft, reference, setDraftMutation } = await fixture(t, value => {
        value.requirements.usageItems.push("I want to share a task list.");
        value.decisionGraph.nodes.push(decision("sharing"), { ...decision("permissions", "toAnswer"), dependencies: ["sharing"] });
    });
    assert.equal(disabled(h, "apply-stage-review"), true);
    assert.match(h.document.querySelector(".stage-review-comparison")!.textContent!, /2 requirement questions/);
    await h.click("review-requirement-questions");
    assert.equal(h.get("requirements-dag-panel").hidden, false);
    assert.ok(h.get("question-host").contains(h.document.activeElement), "Moving to questions focuses the existing answer control.");
    assert.match(h.document.querySelector(".design-tree-inspector .eyebrow")!.textContent!, /New question/);
    assert.equal(h.get("decision-list").querySelectorAll('[data-change="added"]').length, 2);
    await h.click(h.document.querySelector('[data-decision-id="permissions"]')!);
    assert.equal(disabled(h, "decision-submit"), true);
    assert.match(h.get("question-host").textContent!, /Blocked until.*sharing/);
    await h.click(h.document.querySelector('[data-decision-id="task"]')!);
    assert.match(h.document.querySelector(".design-tree-inspector .eyebrow")!.textContent!, /answer retained/);
    assert.match(h.get("question-host").textContent!, /Previous answer/);
    await h.click(h.document.querySelector('[data-decision-id="sharing"]')!);
    setDraftMutation(async (path, options) => {
        assert.equal(path, `/api/reviews/${reference.id}/answer`);
        const body = JSON.parse(String(options.body));
        assert.equal(body.action, "answer-decision");
        const node = draft.decisionGraph.nodes.find(item => item.question?.id === body.questionId)!;
        node.answer = body.answer;
        node.status = "answered";
        const next = draft.decisionGraph.nodes.find(item => !item.answer);
        if (next) next.status = "active";
        draft.revision++;
        return response({ accepted: true });
    });
    await h.click("decision-submit");
    assert.equal(h.document.querySelector('[data-decision-id="permissions"]')!.getAttribute("aria-pressed"), "true");
    assert.equal(disabled(h, "decision-submit"), false);
    assert.equal(disabled(h, "apply-stage-review"), true);
    await h.click("decision-submit");
    assert.equal(disabled(h, "apply-stage-review"), false);
    assert.equal(draft.decisionGraph.nodes[0].answer, "Previous answer");
    assert.equal(current(h).decisionGraph.nodes.length, 1, "Accepted work is untouched until Apply.");
    assert.equal(h.requests.filter(item => item.path === "/api/answer").length, 0);
    await h.click("apply-stage-review"); await h.confirm(true);
    assert.deepEqual(current(h).decisionGraph.nodes.map((node: { answer: string }) => node.answer), ["Previous answer", "A", "A"]);
    assert.equal(current(h).lifecycle.currentStage, "prototype");
});

test("changed questions open in the existing answer form without repeating the accepted answers", async t => {
    const { h } = await fixture(t, value => {
        const node = value.decisionGraph.nodes[0];
        node.question!.text = "How should the revised task behave?";
        node.answer = null;
        node.status = "active";
    });
    assert.equal(h.get("requirements-dag-panel").hidden, false);
    assert.equal(h.get("decision-list").querySelector('[data-decision-id="task"]')!.getAttribute("data-change"), "changed");
    assert.match(h.document.querySelector(".design-tree-inspector .eyebrow")!.textContent!, /Changed question/);
    assert.match(h.get("question-host").textContent!, /How should the revised task behave/);
    assert.equal(h.document.querySelectorAll("#decision-submit").length, 1);
    assert.equal(disabled(h, "apply-stage-review"), true);
});

test("removed usages are visible in the usage list and other requirement changes remain available in Details", async t => {
    const { h } = await fixture(t, value => {
        value.requirements.usageItems = ["I want to share a task list."];
        value.decisionGraph.nodes = [];
        value.assumed.push("One shared list per team.");
        value.deferred.push("Offline editing.");
        value.prototypeApproach.reason = "Explore shared lists.";
    });
    assert.match(h.document.querySelector('[aria-label="Removed usages"]')!.textContent!, /I want to complete a task.*Removed/);
    const summary = h.document.querySelector(".stage-review-comparison")!;
    assert.ok(summary.closest("#stage-input-review"));
    assert.match(summary.textContent!, /1 question removed.*Assumptions.*Deferred work.*Prototype approach.*Details/);
    assert.equal(summary.querySelector("table"), null);
    await h.click(Array.from(h.get("stage-input-review").querySelectorAll("button")).find(button => button.textContent === "Details")!);
    const comparison = h.document.querySelector('[role="dialog"] .stage-review-comparison')!;
    assert.match(comparison.textContent!, /Previous answer.*Not present/s);
    assert.match(comparison.textContent!, /One shared list per team/);
    assert.match(comparison.textContent!, /Offline editing/);
    assert.match(comparison.textContent!, /Explore shared lists/);
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
    assert.equal(h.document.getElementById("sketch-approve"), null, "Draft approval is part of Apply, not a second approval action.");
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
    assert.equal(h.document.getElementById("sketch-approve"), null);
    assert.equal(h.requests.some(item => item.path === "/api/reviews/apply" || item.path === "/api/stage/complete"), false);
});
