import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { decision, reactHarness, rendererFixtureScript, response, state } from "./helpers/react-harness.js";
import type { ChangeRequest } from "../src/change-requests.js";
import { createStageReview, type StageReviewReference } from "../src/stage-review.js";
import { sketchFixture, createScreen } from "./renderer-fixtures.test.js";
import { discoveryEntries } from "../src/renderer/project-conversation.js";
import { applyOperations } from "./helpers/ui-dsl-fixture.js";
import { browserAvailable, openFixtureBrowser } from "../development/tandem/test/helpers/browser-fixture.mjs";

function request(): ChangeRequest {
    return { version: 1, id: "change", clientRequestId: "client", originStage: "prototype", message: "Add save and reload.",
        submittedAt: "2026-10-15T12:00:00Z", baseCheckpointId: null, baseSketchRevisionId: null, visualSelection: null,
        sourceResultId: null, sourceRequests: [], baselineDigest: "a".repeat(64), analysisId: "analysis", status: "proposed",
        error: "", clarifications: [], remainingStages: [], workStarted: [], affectedDecisionIds: [], snapshotPath: null,
        completedAt: null, developmentAdmission: null, developmentRequest: null, assessment: {
            version: 1, summary: "Add saving while preserving playback.", reason: "This introduces new behavior.",
            startStage: "requirements", stages: [{ stage: "requirements", reason: "Define saving." }, { stage: "prototype", reason: "Add mock interaction." }],
            preserved: ["Joint controls", "Playback"], affectedScreenIds: [], question: null, requirements: null,
        } };
}

test("completed reviews hide the review pane and retain explicit abandonment in request history", async t => {
    const h = await reactHarness(t), initial = state("prototype");
    const change: ChangeRequest = { ...request(), status: "completed", completedAt: initial.updatedAt,
        restorePoint: { requestId: "change", generation: initial.generation, digest: "b".repeat(64) } };
    initial.changeRequests = [change];
    h.render(initial); await h.flush();
    assert.equal(h.document.querySelector(".review-guidance-pane"), null);
    assert.equal(h.document.getElementById("abandon-change-review"), null);
    await h.click("toggle-change-details");
    await h.click("abandon-change-dialog");
    const confirmation = h.document.querySelector('[role="alertdialog"]')!;
    assert.match(confirmation.textContent!, /before the original request/);
    assert.match(confirmation.textContent!, /already applied/);
    assert.equal(h.requests.filter(item => item.options.method === "POST").length, 0);
    await h.confirm(false);
    assert.equal(h.requests.filter(item => item.options.method === "POST").length, 0);
    const restored = { ...initial, revision: initial.revision + 1, changeRequests: [{ ...change, status: "cancelled" as const,
        abandonment: { abandonedAt: initial.updatedAt, snapshotPath: ".tandem\\retained-review.json" } }] };
    h.setFetch(async () => response(restored));
    await h.click("abandon-change-dialog"); await h.confirm();
    const sent = h.requests.find(item => item.path === "/api/change-requests/abandon")!;
    assert.deepEqual(sent.body, { requestId: change.id, generation: initial.generation, expectedRevision: initial.revision,
        restorePointDigest: change.restorePoint!.digest, confirm: true });
    assert.equal(h.document.getElementById("abandon-change-review"), null);
    assert.equal(h.store.getSnapshot().state.lifecycle.currentStage, "prototype");
    await h.click("toggle-change-details");
    assert.match(h.get("change-request-details").textContent!, /Changes abandoned/);
    assert.equal(h.document.getElementById("abandon-change-dialog"), null);
    assert.deepEqual(h.errors, []);
});

test("single-stage edits use normal stage controls without a change-review pane", async t => {
    const h = await reactHarness(t), drawing = sketchFixture();
    const change: ChangeRequest = { ...request(), originStage: "sketch", baseSketchRevisionId: drawing.value.sketch.current.id,
        assessment: { ...request().assessment!, startStage: "sketch",
            stages: [{ stage: "sketch", reason: "Update the current layout." }] } };
    h.setFetch(async () => response({ sketch: drawing.value.sketch, document: drawing.document }));
    for (const [index, status] of (["queued", "analyzing", "proposed", "active", "completed"] as const).entries()) {
        h.render({ ...drawing.value, revision: index + 1, changeRequests: [{ ...change, status,
            assessment: ["queued", "analyzing"].includes(status) ? null : change.assessment,
            remainingStages: status === "active" ? ["sketch"] : [],
            completedAt: status === "completed" ? drawing.value.updatedAt : null,
            restorePoint: { requestId: change.id, generation: drawing.value.generation, digest: "b".repeat(64) },
        }] });
        await h.flush();
        assert.equal(h.document.querySelector(".review-guidance-pane"), null, status);
        assert.equal(h.document.getElementById("change-request-details"), null, status);
    }
    assert.deepEqual(h.errors, []);
});

test("returning from Requirements exposes the pending Designs update and blocks the old design", async t => {
    const h = await reactHarness(t), drawing = sketchFixture();
    const change: ChangeRequest = { ...request(), originStage: "sketch", status: "reviewing",
        baseSketchRevisionId: drawing.value.sketch.current.id, remainingStages: ["sketch"],
        reviewId: "review-11111111-1111-4111-8111-111111111111",
        assessment: { ...request().assessment!, stages: [
            { stage: "requirements", reason: "Review the changed product behavior." },
            { stage: "sketch", reason: "Update the saved screens." },
        ] },
    };
    const initial = { ...drawing.value, changeRequests: [change] };
    h.setFetch(async () => response({ sketch: initial.sketch, document: drawing.document }));
    h.render(initial); await h.flush();
    const update = h.get<HTMLButtonElement>("sketch-update-requirements");
    assert.ok(update.closest("#stage-input-review"));
    assert.equal(update.disabled, false);
    assert.equal(h.get<HTMLButtonElement>("sketch-approve").disabled, true);
    assert.equal(h.get<HTMLButtonElement>("complete-stage").disabled, true);
    assert.match(h.get("stage-input-review").textContent!, /Designs review/);
    h.render({ ...initial, revision: 2, processing: { action: "revise-sketch", status: "error",
        requestId: "failed-update", changeRequestId: change.id, message: "The design update failed." } });
    await h.flush();
    assert.equal(h.get<HTMLButtonElement>("sketch-approve").disabled, true);
    assert.equal(h.get<HTMLButtonElement>("complete-stage").disabled, true);
    assert.deepEqual(h.errors, []);
});

test("abandonment is disabled during owned work and refuses changed confirmation without posting", async t => {
    const h = await reactHarness(t), initial = state("prototype");
    const change = { ...request(), restorePoint: { requestId: "change", generation: initial.generation, digest: "b".repeat(64) } };
    initial.changeRequests = [change];
    initial.processing = { action: "assess-change", status: "running" };
    h.render(initial); await h.flush();
    assert.equal(h.get<HTMLButtonElement>("abandon-change-review").disabled, true);
    const quiet = { ...initial, revision: initial.revision + 1, processing: null };
    h.render(quiet); await h.flush();
    await h.click("abandon-change-review");
    h.render({ ...quiet, revision: quiet.revision + 1 }); await h.flush();
    await h.confirm();
    assert.equal(h.requests.filter(item => item.options.method === "POST").length, 0);
    assert.match(h.get("stage-input-review").textContent!, /review changed while confirmation was open/i);
    assert.deepEqual(h.errors, []);
});

test("abandonment failures leave the review open and committed history has no abandon action", async t => {
    const h = await reactHarness(t), initial = state("prototype");
    const change = { ...request(), restorePoint: { requestId: "change", generation: initial.generation, digest: "b".repeat(64) } };
    initial.changeRequests = [change];
    h.render(initial); await h.flush();
    await h.click("toggle-change-details");
    assert.equal(h.document.getElementById("cancel-change"), null, "The restore action is distinct from cancelling remaining work.");
    h.setFetch(async () => response({ error: "The original prototype source files changed outside this review." }, 409));
    await h.click("abandon-change-dialog"); await h.confirm();
    assert.match(h.get("change-request-details").textContent!, /source files changed outside this review/);
    assert.equal(h.store.getSnapshot().state.changeRequests![0].status, "proposed");
    h.render({ ...initial, revision: initial.revision + 1, changeRequests: [
        { ...change, status: "cancelled", replacedByRequestId: "replacement" },
        { ...change, id: "replacement", clientRequestId: "replacement-client", replacesRequestId: change.id },
    ] }); await h.flush();
    assert.doesNotMatch(h.get("change-request-details").textContent!, /source files changed outside this review/);
    await h.click("close-change-details");
    h.render({ ...initial, revision: initial.revision + 2, changeRequests: [{ ...change, status: "completed",
        committedAt: initial.updatedAt, completedAt: initial.updatedAt }] }); await h.flush();
    assert.equal(h.document.getElementById("abandon-change-review"), null);
    await h.click("toggle-change-details");
    assert.equal(h.document.getElementById("abandon-change-dialog"), null);
    assert.deepEqual(h.errors, []);
});

test("Abandon from a pinned draft targets the whole parent review and returns to restored work", async t => {
    const h = await reactHarness(t), initial = state("prototype");
    const change = { ...request(), restorePoint: { requestId: "change", generation: initial.generation, digest: "b".repeat(64) } };
    initial.changeRequests = [change];
    const reference: StageReviewReference = { version: 1, id: "review-22222222-2222-2222-2222-222222222222",
        stage: "requirements", generation: initial.generation, createdAt: initial.updatedAt, appliedAt: null, discardedAt: null,
        changeRequestId: change.id };
    const draft = { ...createStageReview(initial, reference), revision: 1, provider: initial.provider,
        stageReviewStatus: { conflict: "", blocker: null, changed: true, currentStage: "prototype",
            appliedAt: null, discardedAt: null } };
    const parent = { ...initial, revision: initial.revision + 1, stageReviews: [reference],
        changeRequests: [{ ...change, status: "reviewing" as const, reviewId: reference.id, remainingStages: ["requirements", "prototype"] }] };
    h.setFetch(async (path, options) => {
        if (path === "/api/reviews/open") return response({ draft });
        if (path.endsWith("/baseline")) return response({ state: initial, document: null });
        if (path.startsWith(`/api/reviews/${reference.id}/`)) return response(draft);
        if (path === "/api/change-requests/abandon") {
            const body = JSON.parse(String(options.body));
            assert.equal(body.expectedRevision, parent.revision);
            assert.equal(body.requestId, change.id);
            return response({ ...initial, revision: parent.revision + 1,
                stageReviews: [{ ...reference, discardedAt: initial.updatedAt }],
                changeRequests: [{ ...change, status: "cancelled", abandonment: {
                    abandonedAt: initial.updatedAt, snapshotPath: ".tandem\\retained-review.json",
                } }] });
        }
        assert.equal(path, "/api/state");
        return response(parent);
    });
    h.render(initial); await h.flush();
    await h.click("toggle-change-details"); await h.click("approve-change");
    assert.ok(h.get("stage-input-review").contains(h.get("abandon-change-review")));
    await h.click("abandon-change-review"); await h.confirm();
    assert.equal(h.requests.filter(item => item.path === "/api/change-requests/abandon").length, 1);
    assert.equal(h.document.querySelector(".stage-review-workspace"), null);
    assert.equal(h.store.getSnapshot().state.lifecycle.currentStage, "prototype");
    assert.equal(h.get("live-preview-workspace-tab").getAttribute("aria-selected"), "true");
    assert.deepEqual(h.errors, []);
});

test("review titles share a compact stage path while the impact dialog retains detailed reasons", async t => {
    const h = await reactHarness(t), initial = state("prototype");
    const change: ChangeRequest = { ...request(), status: "reviewing", remainingStages: ["prototype"],
        assessment: { ...request().assessment!, stages: [
            { stage: "requirements", reason: "Define saving." },
            { stage: "sketch", reason: "Design the save control." },
            { stage: "prototype", reason: "Add mock interaction." },
        ] } };
    initial.changeRequests = [change];
    h.render(initial); await h.flush();
    const title = h.get("pending-review-title");
    assert.equal(title.textContent, "Prototype review");
    const row = title.closest(".review-title-row")!;
    const path = row.querySelector(".change-stage-path")!;
    assert.equal(path.getAttribute("aria-label"), "Affected stages");
    assert.equal(path.hasAttribute("data-detailed"), false);
    assert.deepEqual([...path.querySelectorAll("li")].map(item => item.getAttribute("aria-label")),
        ["Requirements: Saved", "Designs: Saved", "Prototype: Up next"]);
    assert.equal(path.querySelector('[aria-current="step"] strong')!.textContent, "Prototype");
    assert.equal(path.querySelectorAll('[data-status="saved"] .change-step-marker svg').length, 2);
    assert.equal(path.querySelectorAll('.change-step-separator[aria-hidden="true"]').length, 2);
    assert.equal(path.querySelector("p, button, a"), null, "Header badges remain read-only summaries.");
    assert.equal(h.document.querySelector(".review-guidance-pane > .change-stage-path"), null);
    await h.click("toggle-change-details");
    const detailed = h.get("change-request-details").querySelector('.change-stage-path[data-detailed="true"]')!;
    assert.equal(detailed.querySelectorAll("li").length, 3);
    assert.match(detailed.textContent!, /Define saving.*Design the save control.*Add mock interaction/);
    assert.equal(detailed.querySelector(".change-step-separator"), null);
    assert.equal(h.requests.filter(item => item.options.method === "POST").length, 0);
    assert.deepEqual(h.errors, []);
});

test("a legacy backlog exposes one unresolved review without letting another proposal replace it", async t => {
    const h = await reactHarness(t), initial = state("prototype");
    const older = { ...request(), message: "Replace the illustrative block.", assessment: {
        ...request().assessment!, question: "Which block should change?",
    } };
    const newer: ChangeRequest = { ...request(), id: "about", clientRequestId: "about-client", message: "Create an About Us page.",
        status: "analyzing", assessment: null };
    initial.changeRequests = [older, newer];
    h.render(initial); await h.flush();
    assert.equal(h.get("change-impact-title").textContent, "Checking your request");
    h.render({ ...initial, revision: 2, changeRequests: [older, { ...newer, status: "proposed", assessment: request().assessment }] });
    await h.flush();
    assert.equal(h.get("change-request-details").getAttribute("role"), "dialog", "The new proposal opens its review automatically.");
    assert.match(h.document.querySelector(".change-original")!.textContent!, /Replace the illustrative block/);
    assert.equal(h.document.getElementById("approve-change"), null);
    assert.ok(h.get("change-detail"));
    assert.equal(h.document.getElementById("change-request-picker"), null, "Only the current review is actionable.");
    assert.equal(h.requests.filter(item => item.options.method === "POST").length, 0);
    assert.deepEqual(h.errors, []);
});

test("new requests needing review open the popup once without reopening dismissed or historical reviews", async t => {
    const h = await reactHarness(t), initial = state("prototype");
    const change: ChangeRequest = { ...request(), status: "analyzing", assessment: null };
    initial.changeRequests = [change];
    h.render(initial); await h.flush();
    assert.equal(h.document.getElementById("change-request-details"), null);
    h.render({ ...initial, revision: 2, changeRequests: [request()] }); await h.flush();
    assert.equal(h.get("change-request-details").getAttribute("role"), "dialog");
    assert.equal(h.document.querySelector(".change-original")!.textContent, change.message);
    await h.click("close-change-details");
    h.render({ ...initial, revision: 3, changeRequests: [request()] }); await h.flush();
    assert.equal(h.document.getElementById("change-request-details"), null, "Closing review must survive routine state refreshes.");
    assert.equal(h.requests.filter(item => item.options.method === "POST").length, 0);
    assert.deepEqual(h.errors, []);
});

test("automatic same-stage changes do not open redundant approval but a blocked attempt does", async t => {
    const h = await reactHarness(t), initial = state("prototype");
    const change: ChangeRequest = { ...request(), status: "analyzing", assessment: null };
    initial.changeRequests = [change];
    h.render(initial); await h.flush();
    const local: ChangeRequest = { ...change, status: "proposed", assessment: {
        ...request().assessment!, startStage: "prototype", stages: [{ stage: "prototype", reason: "Change appearance only." }],
    } };
    h.render({ ...initial, revision: 2, changeRequests: [local] }); await h.flush();
    assert.equal(h.document.getElementById("change-request-details"), null);
    h.render({ ...initial, revision: 3, changeRequests: [{ ...local, error: "The project changed before this update could start." }] });
    await h.flush();
    assert.equal(h.get("change-request-details").getAttribute("role"), "dialog");
    assert.match(h.get("change-dialog-error").textContent!, /project changed/);
    assert.equal(h.requests.filter(item => item.options.method === "POST").length, 0);
    assert.deepEqual(h.errors, []);
});

test("a completed latest message cannot hide an unresolved review and remains available afterward", async t => {
    const h = await reactHarness(t), initial = state("prototype");
    const older = { ...request(), assessment: { ...request().assessment!, question: "Which block?" } };
    const completed: ChangeRequest = { ...request(), id: "sugar", clientRequestId: "sugar-client", originStage: "sketch",
        message: "Add a sugar option.", status: "completed", completedAt: initial.updatedAt,
        assessment: { ...request().assessment!, startStage: "sketch", stages: [{ stage: "sketch", reason: "Revise customization." }] } };
    initial.changeRequests = [older, completed];
    h.render(initial); await h.flush();
    assert.match(h.get("change-impact-title").textContent!, /A detail is needed/);
    await h.click("toggle-change-details");
    assert.match(h.get("change-detail").closest("form")!.textContent!, /Which block/);
    await h.click("close-change-details");
    h.render({ ...initial, revision: 2, changeRequests: [{ ...older, status: "cancelled" }, completed] });
    await h.flush(); await h.click("toggle-change-details");
    assert.equal(h.document.querySelector(".change-original")!.textContent, completed.message);
    assert.equal(h.document.getElementById("cancel-change"), null, "Settled records have no mutation controls.");
    assert.equal(h.requests.filter(item => item.options.method === "POST").length, 0);
    assert.deepEqual(h.errors, []);
});

for (const status of ["queued", "analyzing", "proposed", "reviewing", "active", "failed", "deferred"] as const) {
    test(`historical Development ${status} requests are inspectable without review actions or attention`, async t => {
        const h = await reactHarness(t), initial = state("prototype");
        const historical: ChangeRequest = { ...request(), originStage: "development", status,
            error: "Retained assessment failure.", assessment: { ...request().assessment!, question: "Where should saving happen?" },
            sourceRequests: [{ id: "original", message: "The exact original Development request.",
                receivedAt: initial.updatedAt, context: JSON.stringify({ answers: null, attachments: [] }) }] };
        initial.changeRequests = [historical];
        h.render(initial); await h.flush();
        assert.equal(h.document.getElementById("change-request-details"), null);
        assert.equal(h.get("toggle-change-details").dataset.status, "idle");
        assert.equal(h.document.getElementById("change-action-status"), null, "Historical errors do not create a current review alert.");
        await h.click("toggle-change-details");
        const dialog = h.get("change-request-details");
        assert.match(dialog.textContent!, /Development request history/);
        assert.match(dialog.textContent!, /read-only history/);
        assert.match(dialog.textContent!, /Recorded proposal/);
        assert.match(dialog.textContent!, /Recorded question:.*Where should saving happen/);
        assert.match(dialog.textContent!, /exact original Development request/);
        assert.match(h.get("change-dialog-error").textContent!, /Retained assessment failure/);
        assert.equal(dialog.querySelector("form, textarea"), null);
        assert.deepEqual([...dialog.querySelectorAll("button")].map(button => button.textContent), ["", "Done"]);
        assert.equal(dialog.querySelector("[aria-current='step']"), null);
        assert.equal(h.requests.filter(item => item.options.method === "POST").length, 0);
        assert.deepEqual(h.errors, []);
    });
}

test("Designs keeps required review in its pane, separate from History and tab-header approval", async t => {
    const h = await reactHarness(t), drawing = sketchFixture();
    const change: ChangeRequest = { ...request(), originStage: "sketch", message: "Create an About Us page." };
    const initial = { ...drawing.value, changeRequests: [change] };
    h.setFetch(async () => response({ sketch: initial.sketch, document: drawing.document }));
    h.render(initial); await h.flush();
    assert.equal(h.document.getElementById("sketch-change-feedback"), null);
    assert.equal(h.document.getElementById("sketch-review-change"), null);
    assert.equal(h.get("sketch-revise-form").lastElementChild, h.get("sketch-history-toggle"));
    assert.ok(h.get("continue-pending-review").closest("#stage-input-review"));
    assert.ok(h.get("sketch-approve").closest(".previewbar"));
    assert.ok(h.get("stage-workspace-tabs").compareDocumentPosition(h.get("sketch-approve")) & h.window.Node.DOCUMENT_POSITION_FOLLOWING);
    assert.match(h.get("stage-input-review").textContent!, /Review required.*Requirements review/);
    assert.match(h.get("continue-pending-review").textContent!, /Review Requirements draft/);
    assert.equal(h.get<HTMLTextAreaElement>("sketch-instruction").disabled, true);
    assert.equal(h.get<HTMLButtonElement>("sketch-approve").disabled, true);
    assert.match(h.get("next-action-guide").textContent!, /Continue the required review/);
    const details = [...h.get("stage-input-review").querySelectorAll("button")].find(button => button.textContent === "Details")!;
    await h.click(details);
    assert.equal(h.document.querySelector(".review-details-request")!.textContent, change.message);
    assert.equal(h.document.getElementById("approve-change"), null, "Details alone never applies an earlier-stage change.");
    await h.click(h.document.querySelector<HTMLButtonElement>('[aria-label="Close review details"]')!);
    assert.equal(h.document.activeElement, details);
    assert.equal(h.get<HTMLTextAreaElement>("sketch-instruction").disabled, true, "Closing permits inspection, not more changes.");
    await h.click(h.get("sketch-screens").querySelector("button")!);
    await h.click("sketch-history-toggle");
    assert.match(h.get("sketch-request-history").textContent!, /Create an About Us page/);
    assert.match(h.get("sketch-request-history").textContent!, /not applied/i);
    assert.equal(h.requests.filter(item => item.options.method === "POST").length, 0);
    assert.deepEqual(h.errors, []);
});

test("a design review action error stays visible after closing the compact dialog", async t => {
    const h = await reactHarness(t), drawing = sketchFixture();
    const change: ChangeRequest = { ...request(), originStage: "sketch", error: "The automatic design update could not start.", assessment: {
        ...request().assessment!, startStage: "sketch", stages: [{ stage: "sketch", reason: "Update the current design." }],
    } };
    h.setFetch(async () => response({ sketch: drawing.value.sketch, document: drawing.document }));
    h.render({ ...drawing.value, changeRequests: [change] }); await h.flush();
    await h.click("continue-pending-review");
    h.setFetch(async () => response({ error: "The review could not be applied. Your design was preserved." }, 409));
    await h.click("approve-change");
    await h.click("close-change-details");
    assert.match(h.get("change-action-status").textContent!, /could not be applied/);
    assert.equal(h.get("change-action-status").closest("[hidden]"), null);
    assert.deepEqual(h.errors, []);
});

test("the single review and its unsent answer stay persistent across new legacy records and close/reopen", async t => {
    const h = await reactHarness(t), initial = state("prototype");
    const older = { ...request(), assessment: { ...request().assessment!, question: "Which block should change?" } };
    initial.changeRequests = [older];
    h.render(initial); await h.flush();
    await h.click("toggle-change-details");
    await h.input("change-detail", "Keep this unsent clarification.");
    const input = h.get<HTMLTextAreaElement>("change-detail");
    const newer = { ...request(), id: "new-change", clientRequestId: "new-client", message: "Create an About Us page." };
    h.render({ ...initial, revision: 2, changeRequests: [older, newer] }); await h.flush();
    assert.equal(h.document.querySelector(".change-original")!.textContent, older.message);
    assert.equal(h.get("change-detail") === input, true);
    assert.equal(input.value, "Keep this unsent clarification.");
    assert.equal(h.store.getSnapshot().state.changeRequests!.length, 2, "Existing history is preserved, not silently discarded.");
    await h.click("close-change-details");
    await h.click("toggle-change-details");
    assert.equal(h.document.querySelector(".change-original")!.textContent, older.message);
    assert.equal(h.get<HTMLTextAreaElement>("change-detail").value, "Keep this unsent clarification.");
    assert.equal(h.requests.filter(item => item.options.method === "POST").length, 0);
    assert.deepEqual(h.errors, []);
});

test("design feedback reflects its exact submitted request without leaving stale local history entries", async t => {
    const h = await reactHarness(t), drawing = sketchFixture();
    h.setFetch(async () => response({ sketch: drawing.value.sketch, document: drawing.document }));
    h.render(drawing.value); await h.flush();
    let submitted: ChangeRequest | undefined;
    h.setFetch(async (path, options) => {
        assert.equal(path, "/api/sketch");
        const body = JSON.parse(String(options.body));
        assert.match(body.clientRequestId, /^[a-f0-9-]{36}$/);
        submitted = { ...request(), id: "exact-composer-change", clientRequestId: body.clientRequestId,
            originStage: "sketch", message: body.instruction, assessment: null, status: "analyzing" };
        return response({ ...drawing.value, revision: 2, changeRequests: [submitted],
            processing: { status: "running", action: "assess-change", requestId: submitted.analysisId, changeRequestId: submitted.id,
                message: "Checking the new request." } });
    });
    await h.input("sketch-instruction", "Create an About Us page.");
    await h.fire(h.get("sketch-instruction").closest("form")!, "submit");
    assert.ok(submitted);
    assert.equal(h.get<HTMLTextAreaElement>("sketch-instruction").disabled, true);
    h.render({ ...drawing.value, revision: 3, changeRequests: [{ ...submitted, status: "proposed", assessment: request().assessment }],
        processing: { status: "success", action: "assess-change", requestId: submitted.analysisId } });
    await h.flush();
    assert.equal(h.document.querySelector(".change-original")!.textContent, submitted.message);
    await h.click("close-change-details");
    await h.click("sketch-history-toggle");
    assert.equal(h.get("sketch-request-history").querySelectorAll("li").length, 1, "A saved request replaces its local submission row.");
    assert.equal(h.get("sketch-request-history").querySelector("li")!.dataset.status, "waiting");
    await h.click(h.get("sketch-request-history").querySelector("button")!);
    assert.equal(h.document.querySelector(".change-original")!.textContent, submitted.message);
    assert.equal(h.requests.filter(item => item.options.method === "POST").length, 1);
    assert.deepEqual(h.errors, []);
});

test("completed design feedback remains inspectable without an inline status card or automatic approval", async t => {
    const h = await reactHarness(t), drawing = sketchFixture();
    const second = createScreen(drawing.document, ["accepted"]);
    second.title = "Drink customization";
    drawing.document.screens.push(second);
    const change: ChangeRequest = { ...request(), originStage: "sketch", message: "Add a sugar option.",
        status: "completed", completedAt: drawing.value.updatedAt, assessment: {
            ...request().assessment!, startStage: "sketch", stages: [{ stage: "sketch", reason: "Update customization." }],
            affectedScreenIds: [second.id],
        } };
    const initial = { ...drawing.value, changeRequests: [change] };
    h.setFetch(async () => response({ sketch: initial.sketch, document: drawing.document }));
    h.render(initial); await h.flush();
    assert.equal(h.get<HTMLInputElement>("sketch-title").value, drawing.document.screens[0].title);
    assert.equal(h.document.getElementById("sketch-change-feedback"), null);
    await h.click(h.get("sketch-screens").querySelectorAll("button")[1]);
    assert.equal(h.get<HTMLInputElement>("sketch-title").value, second.title);
    assert.equal(h.store.getSnapshot().state.sketch.approved, null);
    await h.click("sketch-history-toggle");
    await h.click(h.get("sketch-request-history").querySelector("button")!);
    assert.equal(h.document.querySelector(".change-original")!.textContent, change.message);
    assert.equal(h.document.getElementById("approve-change"), null);
    assert.equal(h.requests.filter(item => item.options.method === "POST").length, 0);
    assert.deepEqual(h.errors, []);
});

test("Discovery history retains unstarted chat requests, clarification and their next action", () => {
    const initial = state("sketch");
    initial.changeRequests = [{ ...request(), originStage: "sketch", message: "Create an About Us page.",
        clarifications: [{ question: "Where should it open?", answer: "From the menu." }] }];
    const entries = discoveryEntries(initial);
    const saved = entries.find(item => item.changeRequestId === initial.changeRequests![0].id);
    assert.ok(saved);
    assert.match(saved.text, /Create an About Us page/);
    assert.match(saved.text, /Not applied yet/);
    assert.match(saved.text, /From the menu/);
    assert.equal(saved.timestamp, initial.changeRequests![0].submittedAt);
});

test("failed design work is not presented as still progressing and links to the original retry controls", async t => {
    const h = await reactHarness(t), drawing = sketchFixture();
    const change: ChangeRequest = { ...request(), originStage: "sketch", status: "active",
        message: "Replace the selected illustration.", workStarted: ["sketch"], remainingStages: ["sketch"] };
    const initial = { ...drawing.value, changeRequests: [change],
        processing: { action: "revise-sketch", status: "error", requestId: "failed-revision", changeRequestId: change.id,
            answer: change.message, message: "The design worker could not complete the revision." } };
    h.setFetch(async () => response({ sketch: initial.sketch, document: drawing.document }));
    h.render(initial); await h.flush();
    assert.match(h.get("stage-input-review").textContent!, /Review required/);
    assert.equal(h.get<HTMLButtonElement>("sketch-approve").disabled, true, "A failed scoped change cannot be skipped by approving the old design.");
    await h.click("sketch-history-toggle");
    await h.click(h.get("sketch-request-history").querySelector("button")!);
    assert.match(h.get("change-dialog-error").textContent!, /could not complete/);
    await h.click("close-change-details");
    assert.equal(h.get("sketch-request-history-pane").hidden, false);
    assert.equal(h.get("sketch-request-history").querySelector("li")!.dataset.status, "error");
    assert.equal(h.requests.filter(item => item.options.method === "POST").length, 0, "Opening failure details cannot retry implicitly.");
    assert.deepEqual(h.errors, []);
});

test("change details open in a bounded dialog without moving stage navigation or design controls", {
    skip: !browserAvailable, timeout: 60000,
}, async t => {
    const drawing = sketchFixture();
    const screen = drawing.document.screens[0];
    screen.ui = applyOperations(screen.ui, [
        { op: "add", parent: "screen", after: null, component: { id: "heading", type: "Heading", props: { text: "Your workspace" } } },
        { op: "add", parent: "screen", component: { id: "form", type: "Card", props: {} } },
        { op: "add", parent: "form", component: { id: "name", type: "Input", props: { label: "Task name" } } },
        { op: "move", id: "primary-action", parent: "form" },
    ]);
    const change: ChangeRequest = {
        ...request(), originStage: "sketch", message: "Move the primary action below the title.", status: "active",
        remainingStages: ["sketch"], workStarted: ["sketch"], assessment: {
            version: 1, summary: "Adjust the primary action.", reason: "The agreed behavior is unchanged.",
            startStage: "sketch", stages: [{ stage: "sketch", reason: "Adjust the layout." }],
            preserved: ["Accepted requirements"], affectedScreenIds: [drawing.document.screens[0].id], question: null, requirements: null,
        },
    };
    const initial = { ...drawing.value, changeRequests: [change] };
    const [script, styles] = await Promise.all([
        rendererFixtureScript(),
        build({ entryPoints: [fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url))],
            bundle: true, write: false, logLevel: "silent" }),
    ]);
    const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
        <style>${styles.outputFiles[0].text}</style></head><body><div id="root"></div>
        <script>${script.replaceAll("</script", "<\\/script")}
        window.workspaceFixture = TandemTest.mount();
        workspaceFixture.flushSync(() => workspaceFixture.store.accept(${JSON.stringify(initial)}));
        </script></body></html>`;
    const unexpected: string[] = [];
    const server = createServer((req, res) => {
        const path = new URL(req.url || "/", "http://127.0.0.1").pathname;
        req.resume();
        const send = (body: unknown) => {
            res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
            res.end(JSON.stringify(body));
        };
        if (path === "/") { res.writeHead(200, { "Content-Type": "text/html" }); res.end(html); }
        else if (path === "/api/project-entry") send({ projectPath: "C:\\fixture-project", startingPath: "preparation" });
        else if (path === "/api/project-entry/open") send({ developmentStarted: false, developmentContext: false });
        else if (path === "/api/sketch") send({ sketch: initial.sketch, document: drawing.document });
        else if (path === "/favicon.ico") { res.writeHead(204); res.end(); }
        else { unexpected.push(`${req.method} ${path}`); res.writeHead(404); res.end(); }
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
        server.closeAllConnections();
    }));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const browser = await openFixtureBrowser(t);
    await browser.call("Emulation.setDeviceMetricsOverride", { width: 1686, height: 900, deviceScaleFactor: 1, mobile: false });
    await browser.call("Page.navigate", { url: `http://127.0.0.1:${address.port}/` });
    await browser.waitFor('Boolean(document.querySelector("#sketch-board .dsl-view")?.shadowRoot?.querySelector("[data-ui-id]")) && !document.querySelector("#studio-workspace").inert');
    assert.equal(await browser.evaluate('document.querySelector("#sketch-structure").open'), true);
    assert.equal(await browser.evaluate('document.querySelector("#sketch-structure").previousElementSibling.classList.contains("sketch-screen-details")'), true);
    assert.equal(await browser.evaluate('document.querySelector("#sketch-selection")'), null);
    assert.equal(await browser.evaluate('document.querySelector("#sketch-board .dsl-view").shadowRoot.querySelector(".uidl-surface").dataset.mode'), "select");
    let revision = initial.revision;
    for (const width of [1686, 1024, 375]) {
        await browser.call("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
        for (const history of ["active", "completed", "expanded", "none"]) {
            const changes = history === "none" ? [] : [{
                ...change, ...(history !== "active" ? { status: "completed", completedAt: initial.updatedAt } : {}),
            }];
            await browser.evaluate(`workspaceFixture.flushSync(() => workspaceFixture.store.accept(${JSON.stringify({
                ...initial, revision: ++revision, changeRequests: changes,
            })}))`);
            await browser.evaluate(`(async () => {
                if (${history === "expanded"}) {
                    document.querySelector("#sketch-history-toggle").click();
                    await new Promise(resolve => requestAnimationFrame(resolve));
                    document.querySelector("#sketch-request-history button").click();
                } else document.querySelector("#close-change-details")?.click();
                await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                const history = document.querySelector(".change-history");
                if (history) history.open = ${history === "expanded"};
                return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            })()`);
            const layout = await browser.evaluate(`(() => {
                const bounds = selector => {
                    const rect = document.querySelector(selector)?.getBoundingClientRect();
                    return rect ? { top: rect.top, bottom: rect.bottom, height: rect.height, left: rect.left, right: rect.right } : null;
                };
                return { changes: bounds("#stage-input-review"), tabs: bounds(".previewbar"), panel: bounds("#sketch-panel"),
                    input: bounds("#sketch-revise-form"), history: bounds("#sketch-history-toggle"),
                    retiredTrigger: Boolean(document.querySelector("#sketch-review-change")),
                    approve: bounds("#sketch-approve"),
                    controls: bounds(".sketch-header-actions"), board: bounds(".sketch-board-wrap"), viewport: bounds("#preview-pane"),
                    pageFits: document.documentElement.scrollWidth <= innerWidth + 1 };
            })()`);
            if (process.env.TANDEM_UI_EVIDENCE) {
                await writeFile(join(process.env.TANDEM_UI_EVIDENCE, `change-layout-${width}-${history}.png`), await browser.screenshot());
            }
            const context = `${width}px / ${history}: ${JSON.stringify(layout)}`;
            if (layout.changes && layout.changes.height > 0) assert.ok(layout.changes.top >= layout.panel.bottom - 1, context);
            assert.ok(layout.approve.top >= layout.tabs.top - 1 && layout.approve.bottom <= layout.tabs.bottom + 1, context);
            assert.equal(layout.retiredTrigger, false, context);
            assert.ok(layout.history.top >= layout.input.top && layout.history.bottom <= layout.input.bottom + 1, context);
            assert.ok(layout.panel.top >= layout.tabs.bottom - 1, context);
            assert.ok(layout.controls.top >= layout.tabs.bottom - 1, context);
            assert.ok(layout.panel.height > layout.controls.height, context);
            assert.ok(layout.board.height > 0, context);
            assert.ok(layout.controls.bottom <= layout.viewport.bottom + 1, context);
            assert.equal(layout.pageFits, true, context);
            if (history === "expanded") {
                assert.equal(await browser.evaluate('document.querySelector("#change-request-details")?.getAttribute("role")'), "dialog");
                await browser.evaluate('document.querySelector("#close-change-details").click()');
                await browser.evaluate('document.querySelector("#sketch-history-toggle").click()');
            }
        }
    }
    const longChange: ChangeRequest = {
        ...change, status: "proposed", error: "Retained Development ownership must be opened and explicitly settled or closed before upstream discovery can change.",
        assessment: { ...change.assessment!, summary: "Improve alignment and text layout while preserving the accepted workflows.",
            reason: "This changes the draft screen layout, not product capabilities. ".repeat(8),
            preserved: Array.from({ length: 8 }, (_, index) => `Accepted behavior ${index + 1}: keep saved screens, navigation, explicit saves and validation unchanged.`) },
    };
    for (const [width, height, fontSize] of [
        [1556, 900, "standard"], [1024, 600, "standard"], [760, 700, "standard"], [375, 700, "standard"],
        [1024, 600, "largest"], [375, 700, "largest"],
    ] as const) {
        await browser.call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
        await browser.evaluate(`document.documentElement.dataset.projectFontSize = ${JSON.stringify(fontSize)}`);
        await browser.evaluate(`workspaceFixture.flushSync(() => workspaceFixture.store.accept(${JSON.stringify({
            ...initial, revision: ++revision, changeRequests: [longChange],
        })}))`);
        await browser.evaluate('new Promise(resolve => setTimeout(resolve, 500))');
        await browser.evaluate('document.querySelector("#close-change-details")?.click()');
        await browser.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
        const compact = await browser.evaluate(`(() => {
            const panel = document.querySelector("#stage-input-review").getBoundingClientRect();
            const workspace = document.querySelector("#preview-pane").getBoundingClientRect();
            const board = document.querySelector("#sketch-board-wrap").getBoundingClientRect();
            const header = document.querySelector(".sketch-header-actions");
            const bounds = header.getBoundingClientRect();
            return { height: panel.height, workspaceHeight: workspace.height, boardHeight: board.height,
                boardTop: board.top, boardWidth: board.width,
                finishVisible: document.querySelector("#complete-stage").checkVisibility(),
                approveVisible: document.querySelector("#sketch-approve").checkVisibility(),
                controlsFit: [...header.querySelectorAll("button:not([hidden])")].every(button => {
                    const rect = button.getBoundingClientRect();
                    return rect.left >= bounds.left && rect.right <= bounds.right + 1 && rect.bottom <= bounds.bottom + 1;
                }) };
        })()`);
        const context = `${width}x${height} / ${fontSize}: ${JSON.stringify(compact)}`;
        if (process.env.TANDEM_UI_EVIDENCE) {
            await writeFile(join(process.env.TANDEM_UI_EVIDENCE, `long-impact-${width}-${fontSize}-collapsed.png`), await browser.screenshot());
        }
        assert.ok(compact.height <= Math.min(height * 0.4, 320) + 1,
            `The review pane must obey its 40vh / 320px cap, even with long reports: ${context}`);
        assert.ok(compact.boardHeight >= (width > 600 ? 200 : 80), `Keep usable design space: ${context}`);
        assert.equal(compact.finishVisible, false, context);
        assert.equal(compact.approveVisible, true, context);
        assert.equal(compact.controlsFit, true, context);
        const attention = await browser.evaluate(`(() => {
            const button = document.querySelector("#continue-pending-review"), style = getComputedStyle(button);
            const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
            const ctx = canvas.getContext("2d");
            const rgb = color => { ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3); };
            const luminance = color => rgb(color).map(x => x / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4)
                .reduce((sum, x, i) => sum + x * [.2126, .7152, .0722][i], 0);
            const fg = luminance(style.color), bg = luminance(style.backgroundColor);
            return {
                contrast: (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05),
                label: button.textContent, blocked: document.querySelector("#sketch-instruction").disabled,
                inlineCard: Boolean(document.querySelector("#sketch-change-feedback")),
                approvalHeader: Boolean(document.querySelector(".previewbar #sketch-approve")) };
        })()`);
        assert.equal(attention.blocked, true);
        assert.equal(attention.inlineCard, false);
        assert.equal(attention.approvalHeader, true);
        assert.equal(attention.label, "Review change");
        assert.ok(attention.contrast >= 4.5, JSON.stringify(attention));
        await browser.evaluate('document.querySelector("#continue-pending-review").scrollIntoView({block:"nearest"}); document.querySelector("#continue-pending-review").focus()');
        const beforePopup = await browser.evaluate(`(() => {
            const board = document.querySelector("#sketch-board-wrap").getBoundingClientRect();
            return { boardHeight: board.height, boardTop: board.top, boardWidth: board.width };
        })()`);
        await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
        await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
        await browser.waitFor('Boolean(document.querySelector("#change-request-details"))');
        const popup = await browser.evaluate(`(() => {
            const dialog = document.querySelector("#change-request-details"), rect = dialog.getBoundingClientRect();
            const board = document.querySelector("#sketch-board-wrap").getBoundingClientRect();
            return { role: dialog.getAttribute("role"), modal: dialog.getAttribute("aria-modal"),
                inWorkspace: Boolean(dialog.closest("#preview-pane")),
                focusInside: dialog.contains(document.activeElement), initialFocus: document.activeElement.id,
                top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom,
                boardHeight: board.height, boardTop: board.top, boardWidth: board.width };
        })()`);
        assert.equal(popup.role, "dialog");
        assert.equal(popup.modal, "true");
        assert.equal(popup.inWorkspace, false, "Dialog content must not participate in the workspace grid.");
        assert.equal(popup.focusInside, true);
        assert.equal(popup.initialFocus, "close-change-details", "Opening details cannot focus an approval action.");
        assert.equal(await browser.evaluate('document.querySelector("#change-request-picker")'), null);
        assert.ok(popup.top >= 0 && popup.left >= 0 && popup.right <= width && popup.bottom <= height, JSON.stringify(popup));
        for (const key of ["boardHeight", "boardTop", "boardWidth"] as const) {
            assert.ok(Math.abs(popup[key] - beforePopup[key]) <= 1, `${key} changed when the dialog opened: ${context}`);
        }
        await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
        await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
        assert.equal(await browser.evaluate('document.querySelector("#change-request-details").contains(document.activeElement)'), true);
        await browser.evaluate('document.querySelector("#approve-change").scrollIntoView({block:"nearest"})');
        assert.equal(await browser.evaluate(`(() => {
            const button = document.querySelector("#approve-change"), rect = button.getBoundingClientRect();
            const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
            return button === hit || button.contains(hit);
        })()`), true, `Explicit review remains reachable at ${width}px`);
        await browser.evaluate('document.querySelector("#cancel-change").scrollIntoView({block:"nearest"})');
        assert.equal(await browser.evaluate(`(() => {
            const button = document.querySelector("#cancel-change"), rect = button.getBoundingClientRect();
            const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
            return !button.disabled && (button === hit || button.contains(hit));
        })()`), true, `Cancel request must remain reachable at ${width}px / ${fontSize}`);
        if (process.env.TANDEM_UI_EVIDENCE) {
            await writeFile(join(process.env.TANDEM_UI_EVIDENCE, `change-dialog-${width}-${fontSize}.png`), await browser.screenshot());
        }
        await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        await browser.waitFor('!document.querySelector("#change-request-details") && document.activeElement.id === "continue-pending-review"');
    }
    const cleanReview: ChangeRequest = { ...change, status: "reviewing", message: "Create a page of about us.",
        restorePoint: { requestId: change.id, generation: initial.generation, digest: "b".repeat(64) },
        remainingStages: ["requirements", "sketch", "prototype"], assessment: { ...change.assessment!,
            summary: "Add an About Us page with navigation from the menu and a way back.",
            startStage: "requirements", stages: [
                { stage: "requirements", reason: "Record the new informational page." },
                { stage: "sketch", reason: "Design its page content and navigation." },
                { stage: "prototype", reason: "Preview its navigation." },
            ] } };
    for (const [width, mode] of [[1280, "light"], [375, "light"], [1280, "dark"], [375, "dark"]] as const) {
        await browser.call("Emulation.setDeviceMetricsOverride", { width, height: 800, deviceScaleFactor: 1, mobile: false });
        await browser.evaluate(`document.documentElement.dataset.projectFontSize = "standard"; document.documentElement.dataset.colorMode = "${mode}";
            workspaceFixture.flushSync(() => workspaceFixture.store.accept(${JSON.stringify({
                ...initial, revision: ++revision, changeRequests: [cleanReview],
            })}))`);
        await browser.evaluate('new Promise(resolve => setTimeout(resolve, 50))');
        await browser.evaluate(`(async () => { if (!document.querySelector("#change-request-details")) {
            document.querySelector("#sketch-history-toggle").click();
            await new Promise(resolve => requestAnimationFrame(resolve));
            document.querySelector("#sketch-request-history button").click();
        } })()`);
        await browser.waitFor('Boolean(document.querySelector("#continue-change-review"))');
        assert.equal(await browser.evaluate('Boolean(document.querySelector("#change-request-picker, #sketch-change-feedback"))'), false);
        const footer = await browser.evaluate(`(() => {
            const dialog = document.querySelector("#change-request-details").getBoundingClientRect();
            const footer = document.querySelector(".review-dialog-footer").getBoundingClientRect();
            const primary = document.querySelector("#continue-change-review");
            const rect = primary.getBoundingClientRect(), hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
            const abandon = document.querySelector("#abandon-change-dialog"), abandonRect = abandon.getBoundingClientRect();
            const abandonHit = document.elementFromPoint(abandonRect.left + abandonRect.width / 2, abandonRect.top + abandonRect.height / 2);
            return { fits: dialog.left >= 0 && dialog.right <= innerWidth && dialog.top >= 0 && dialog.bottom <= innerHeight,
                footerInside: footer.top >= dialog.top && footer.bottom <= dialog.bottom + 1,
                actionable: !primary.disabled && (hit === primary || primary.contains(hit)),
                abandonActionable: !abandon.disabled && abandonRect.left >= 0 && abandonRect.right <= innerWidth
                    && (abandonHit === abandon || abandon.contains(abandonHit)) };
        })()`);
        assert.deepEqual(footer, { fits: true, footerInside: true, actionable: true, abandonActionable: true });
        if (process.env.TANDEM_UI_EVIDENCE) await writeFile(
            join(process.env.TANDEM_UI_EVIDENCE, `single-review-${width}-${mode}.png`), await browser.screenshot());
        await browser.evaluate('document.querySelector("#close-change-details").click()');
        await browser.evaluate('document.querySelector("#sketch-history-toggle").click()');
        await browser.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
        const header = await browser.evaluate(`(() => {
            const title = document.querySelector("#pending-review-title");
            const row = title.closest(".review-title-row"), path = row.querySelector(".change-stage-path");
            const titleRect = title.getBoundingClientRect();
            const badges = [...path.querySelectorAll(".change-step-content")].map(badge => badge.getBoundingClientRect());
            const pane = document.querySelector(".review-guidance-pane").getBoundingClientRect();
            return { count: badges.length, separators: path.querySelectorAll(".change-step-separator").length,
                sameRow: badges.every(rect => Math.abs((rect.top + rect.bottom - titleRect.top - titleRect.bottom) / 2) <= 1),
                compact: badges.every(rect => rect.width < 160 && rect.height <= 20),
                fits: badges.every(rect => rect.left >= pane.left && rect.right <= pane.right + 1),
                pageFits: document.documentElement.scrollWidth <= innerWidth + 1,
                clip: { x: pane.x, y: pane.y, width: pane.width, height: pane.height, scale: 1 } };
        })()`);
        assert.equal(header.count, 3);
        assert.equal(header.separators, 2);
        assert.ok(header.compact && header.fits && header.pageFits, JSON.stringify(header));
        if (width === 1280) assert.equal(header.sameRow, true, JSON.stringify(header));
        if (process.env.TANDEM_UI_EVIDENCE) {
            const image = await browser.call("Page.captureScreenshot", { format: "png", clip: header.clip, captureBeyondViewport: true });
            await writeFile(join(process.env.TANDEM_UI_EVIDENCE, `review-header-${width}-${mode}.png`), Buffer.from(image.data, "base64"));
        }
    }
    await browser.evaluate('document.documentElement.dataset.colorMode = "light"');
    await browser.evaluate(`workspaceFixture.flushSync(() => workspaceFixture.store.accept(${JSON.stringify({
        ...initial, revision: ++revision,
    })}))`);
    await browser.call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await browser.evaluate('document.documentElement.dataset.projectFontSize = "standard"');
    await browser.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const targetId = Object.values(drawing.document.screens[0].ui.nodes).find(node => node.type === "Button")!.id;
    await browser.evaluate('document.querySelector("#sketch-pick-element").click()');
    await browser.waitFor('document.querySelector("#sketch-pick-element").getAttribute("aria-pressed") === "true"');
    await browser.evaluate(`document.querySelector("#sketch-board .dsl-view").shadowRoot.querySelector('[data-ui-id="${targetId}"]').scrollIntoView({block:"nearest",inline:"nearest"})`);
    await browser.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const target = await browser.evaluate(`(() => {
        const element = document.querySelector("#sketch-board .dsl-view").shadowRoot.querySelector('[data-ui-id="${targetId}"]');
        const rect = element.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    await browser.call("Input.dispatchMouseEvent", { type: "mousePressed", ...target, button: "left", clickCount: 1 });
    await browser.call("Input.dispatchMouseEvent", { type: "mouseReleased", ...target, button: "left", clickCount: 1 });
    await browser.waitFor(`document.querySelector('#sketch-structure-tree [aria-selected="true"]')?.dataset.nodeId === "${targetId}"`);
    assert.equal(await browser.evaluate('document.querySelector("#sketch-pick-element").getAttribute("aria-pressed")'), "true");
    assert.equal(await browser.evaluate('document.querySelector("#sketch-save").disabled'), true, "Picking context cannot modify the design.");
    assert.equal(await browser.evaluate(`document.querySelector("#sketch-board .dsl-view").shadowRoot.querySelector("[data-selected]").dataset.uiId`), targetId);
    assert.equal(await browser.evaluate(`document.querySelector('#sketch-structure-tree [data-node-id="${targetId}"]').getAttribute("aria-selected")`), "true");
    assert.equal(await browser.evaluate('document.querySelector(\'#sketch-structure-tree [aria-selected="true"]\')?.dataset.nodeId'), targetId);
    assert.deepEqual(await browser.evaluate(`(() => {
        const node=document.querySelector("#sketch-board .dsl-view").shadowRoot.querySelector("[data-selected]");
        const style=getComputedStyle(node); return [style.outlineStyle,style.outlineWidth];
    })()`), ["solid", "2px"], "The selection outline must remain visible after the click.");
    await browser.evaluate('document.querySelector("#sketch-interact").click()');
    await browser.waitFor('document.querySelector("#sketch-board .dsl-view").shadowRoot.querySelector(".uidl-surface").dataset.mode === "interact"');
    await browser.evaluate('document.querySelector("#sketch-board .dsl-view").shadowRoot.querySelector("[data-ui-id=heading]").click()');
    assert.equal(await browser.evaluate('document.querySelector(\'#sketch-structure-tree [aria-selected="true"]\')?.dataset.nodeId'), targetId);
    await browser.evaluate('document.querySelector("#sketch-structure-tree [data-node-id=heading]").focus()');
    await browser.waitFor('document.querySelector(\'#sketch-structure-tree [aria-selected="true"]\')?.dataset.nodeId === "heading"');
    assert.equal(await browser.evaluate('document.querySelector("#sketch-board .dsl-view").shadowRoot.querySelector(".uidl-surface").dataset.mode'), "select");
    await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "End", code: "End", windowsVirtualKeyCode: 35 });
    await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "End", code: "End", windowsVirtualKeyCode: 35 });
    await browser.waitFor(`document.querySelector('#sketch-structure-tree [aria-selected="true"]')?.dataset.nodeId === "${targetId}"`);
    await browser.evaluate('document.querySelector("#sketch-zoom-actual").click()');
    await browser.evaluate('document.querySelector("#sketch-zoom-out").click()');
    await browser.waitFor('document.querySelector("#sketch-zoom").textContent === "80%"');
    assert.equal(await browser.evaluate('document.querySelector(\'#sketch-structure-tree [aria-selected="true"]\')?.dataset.nodeId'), targetId);
    await browser.evaluate('document.querySelector("#sketch-structure-tree [data-node-id=heading]").click()');
    await browser.evaluate(`document.querySelector('#sketch-structure-tree [data-node-id="${targetId}"]').click()`);
    await browser.waitFor(`document.querySelector('#sketch-structure-tree [aria-selected="true"]')?.dataset.nodeId === "${targetId}"`);
    assert.equal(await browser.evaluate(`(() => {
        const viewport=document.querySelector("#sketch-board-wrap").getBoundingClientRect();
        const element=document.querySelector("#sketch-board .dsl-view").shadowRoot.querySelector("[data-selected]").getBoundingClientRect();
        return element.left >= viewport.left - 1 && element.right <= viewport.right + 1
            && element.top >= viewport.top - 1 && element.bottom <= viewport.bottom + 1;
    })()`), true, "Selecting a structure item reveals it in the zoomed view.");
    await browser.evaluate('document.querySelector("#sketch-zoom-fit").click()');
    await browser.waitFor('document.querySelector("#sketch-zoom-fit").getAttribute("aria-pressed") === "true"');
    if (process.env.TANDEM_UI_EVIDENCE) {
        await writeFile(join(process.env.TANDEM_UI_EVIDENCE, "change-selected-element.png"), await browser.screenshot());
    }
    await browser.call("Emulation.setDeviceMetricsOverride", { width: 480, height: 760, deviceScaleFactor: 1, mobile: false });
    await browser.evaluate('document.querySelector("#sketch-zoom-fit").click()');
    await browser.waitFor('parseFloat(document.querySelector("#sketch-zoom").textContent) < 100');
    assert.equal(await browser.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), true);
    assert.equal(await browser.evaluate('document.querySelector("#sketch-structure-tree").getBoundingClientRect().height > 0'), true);
    if (process.env.TANDEM_UI_EVIDENCE) {
        await writeFile(join(process.env.TANDEM_UI_EVIDENCE, "change-selected-element-narrow.png"), await browser.screenshot());
    }
    await browser.evaluate('document.querySelector("#content-tab").dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))');
    await browser.waitFor('document.querySelector("#content-panel").hidden === false');
    assert.equal(await browser.evaluate('document.querySelector("#stage-workspace-tabs")'), null);
    assert.ok(await browser.evaluate(`document.querySelector("#stage-input-review").getBoundingClientRect().top
        >= document.querySelector("#content-panel").getBoundingClientRect().bottom - 1`));
    assert.deepEqual(unexpected, []);
    assert.deepEqual(browser.exceptions, []);
    await browser.call("Page.navigate", { url: "about:blank" });
});

test("impact dialog preserves clarification drafts and errors across closing, reopening and updates", async t => {
    const h = await reactHarness(t), initial = state("prototype");
    initial.changeRequests = [request()];
    h.render(initial); await h.flush();
    const toggle = h.get("toggle-change-details");
    assert.equal(toggle.getAttribute("aria-expanded"), "false");
    assert.equal(toggle.getAttribute("aria-haspopup"), "dialog");
    assert.equal(h.document.getElementById("change-request-details"), null);
    assert.match(h.get("change-impact-title").textContent!, /Review change impact/);
    await h.click(toggle);
    const details = h.get("change-request-details");
    assert.equal(details.getAttribute("role"), "dialog");
    assert.equal(details.closest("#preview-pane"), null);
    assert.equal(toggle.getAttribute("aria-expanded"), "true");
    const refine = [...details.querySelectorAll("button")].find(button => button.textContent === "Edit request")!;
    await h.click(refine);
    await h.input("change-detail", "Keep my unsent clarification.");
    const field = h.get<HTMLTextAreaElement>("change-detail");
    h.render({ ...initial, revision: 2, changeRequests: [{ ...request(), error: "Retained Development ownership needs attention." }] });
    await h.flush();
    assert.equal(h.get("change-detail"), field, "A state update must not replace an open editor.");
    assert.match(h.get("change-dialog-error").textContent!, /Retained Development ownership/);
    await h.click("close-change-details");
    assert.equal(h.document.getElementById("change-request-details"), null);
    assert.equal(h.document.activeElement, toggle);
    h.render({ ...initial, revision: 3, changeRequests: [{ ...request(), error: "Retained Development ownership needs attention." }] });
    await h.flush();
    const error = h.get("change-action-status");
    assert.equal(error.closest("[hidden]"), null, "Errors remain visible after the dialog closes.");
    assert.match(error.textContent!, /Retained Development ownership/);
    assert.equal(h.document.getElementById("change-request-details"), null, "An update must not reopen the dialog.");
    await h.click(toggle);
    assert.equal(h.get<HTMLTextAreaElement>("change-detail").value, "Keep my unsent clarification.");
    await h.fire(h.get("close-change-details"), "keydown", { key: "Escape" });
    assert.equal(h.document.getElementById("change-request-details"), null);
    assert.equal(h.requests.filter(item => item.options.method === "POST").length, 0);
    assert.equal(h.store.getSnapshot().state.lifecycle.currentStage, "prototype");
    assert.deepEqual(h.errors, []);
});

test("impact review stays beside the existing prototype and submits the exact displayed proposal identity", async t => {
    const h = await reactHarness(t), initial = state("prototype");
    initial.previewStatus = "ready"; initial.previewUrl = "http://127.0.0.1:4321/";
    initial.changeRequests = [request()];
    h.render(initial); await h.flush();
    await h.click("toggle-change-details");
    assert.match(h.document.querySelector(".change-impact")!.textContent!, /Joint controls/);
    assert.equal(h.store.getSnapshot().state.lifecycle.currentStage, "prototype");
    assert.equal(h.requests.filter(item => item.options.method === "POST").length, 0);
    const reference: StageReviewReference = { version: 1, id: "review-22222222-2222-2222-2222-222222222222",
        stage: "requirements", generation: initial.generation, createdAt: initial.updatedAt, appliedAt: null, discardedAt: null,
        changeRequestId: "change" };
    const draft = { ...createStageReview(initial, reference), revision: 1, provider: initial.provider,
        stageReviewStatus: { conflict: "", blocker: "Review the draft decisions.", changed: true, currentStage: "prototype",
            appliedAt: null, discardedAt: null } };
    h.setFetch(async path => {
        if (path === "/api/reviews/open") return response({ draft });
        if (path.startsWith(`/api/reviews/${reference.id}/`)) return response(draft);
        assert.equal(path, "/api/state");
        return response({ ...initial, revision: 2, stageReviews: [reference],
            changeRequests: [{ ...request(), status: "reviewing", reviewId: reference.id, remainingStages: ["requirements", "prototype"] }] });
    });
    await h.click("approve-change");
    const sent = h.requests.find(item => item.path === "/api/reviews/open")!;
    assert.deepEqual(sent.body, { stageId: "requirements", expectedGeneration: initial.generation,
        changeRequestId: "change", analysisId: "analysis", baselineDigest: "a".repeat(64) });
    assert.equal(h.store.getSnapshot().state.previewUrl, initial.previewUrl);
    assert.equal(h.store.getSnapshot().state.lifecycle.currentStage, "prototype");
    const heading = h.get("stage-input-review").querySelector(".stage-review-heading")!;
    assert.equal(heading.querySelector("h2")!.textContent, "Requirements review");
    assert.equal(heading.querySelector(".stage-review-status")!.textContent, "Draft only");
    const path = heading.querySelector(".review-title-row .change-stage-path")!;
    assert.equal(path.querySelector('[aria-current="step"]')!.getAttribute("aria-label"), "Requirements: Reviewing draft");
    assert.equal(path.querySelectorAll(".change-step-separator").length, 1);
    assert.equal(h.get("stage-input-review").querySelectorAll(".change-stage-path").length, 1);
    assert.match(h.get("design-tree-workspace-tab").getAttribute("aria-label")!, /pinned draft review/);
    assert.equal(h.document.getElementById("change-request-details"), null, "The dialog must close to reveal the opened draft.");
    assert.equal(h.errors.length, 0, h.errors.join("\n"));
});

test("same-stage approval and return-to-work actions close the dialog without losing the request", async t => {
    const h = await reactHarness(t), initial = state("prototype");
    const change: ChangeRequest = { ...request(), assessment: { ...request().assessment!,
        startStage: "prototype", stages: [{ stage: "prototype", reason: "Adjust the current preview only." }] } };
    initial.changeRequests = [change];
    h.render(initial); await h.flush();
    const active = { ...initial, revision: 2, changeRequests: [{ ...change, status: "active" as const, remainingStages: ["prototype" as const] }] };
    h.setFetch(async () => response(active));
    await h.click("toggle-change-details");
    await h.click("approve-change");
    assert.equal(h.document.getElementById("change-request-details"), null);
    const sent = h.requests.find(item => item.path === "/api/change-requests/decision")!;
    assert.deepEqual(sent.body, { requestId: change.id, analysisId: change.analysisId, baselineDigest: change.baselineDigest,
        decision: "approve", answer: "" });
    await h.click("toggle-change-details");
    const go = h.get("continue-change-review");
    assert.ok(go);
    await h.click(go);
    assert.equal(h.document.getElementById("change-request-details"), null);
    assert.equal(h.store.getSnapshot().state.changeRequests![0].id, change.id);
    assert.equal(h.store.getSnapshot().state.lifecycle.currentStage, "prototype");
    assert.equal(h.requests.filter(item => item.options.method === "POST").length, 1);
    assert.deepEqual(h.errors, []);
});

test("stale impact errors keep the request and clarification draft visible without navigation", async t => {
    const h = await reactHarness(t), initial = state("prototype");
    initial.changeRequests = [request()];
    h.render(initial); await h.flush();
    await h.click("toggle-change-details");
    h.setFetch(async () => response({ error: "The project changed. Check the impact again." }, 409));
    await h.click("approve-change");
    assert.match(h.get("change-action-status").textContent!, /project changed/);
    assert.match(h.get("change-dialog-error").textContent!, /project changed/);
    assert.equal(h.get("change-request-details").getAttribute("role"), "dialog");
    assert.equal(h.store.getSnapshot().state.lifecycle.currentStage, "prototype");
    const refined = [...h.get("change-request-details").querySelectorAll("button")].find(button => button.textContent === "Edit request")!;
    await h.click(refined);
    await h.input("change-detail", "Keep saving local to this device.");
    await h.fire(h.get("change-detail").closest("form")!, "submit");
    assert.equal(h.get<HTMLTextAreaElement>("change-detail").value, "Keep saving local to this device.");
    assert.equal(h.errors.length, 0, h.errors.join("\n"));
});

test("closing an ambiguous review preserves its answer draft and blocks Continue until cancellation", async t => {
    const h = await reactHarness(t), initial = state("requirements");
    initial.requirements = { substage: "dag", usageItems: ["I want to save a sequence."], suggestions: [] };
    initial.decisionGraph.nodes = [decision("save", "answered")];
    const change: ChangeRequest = { ...request(), originStage: "requirements", assessment: {
        ...request().assessment!, question: "Which existing sequence should be replaced?",
    } };
    initial.changeRequests = [change];
    h.render(initial); await h.flush();
    assert.equal(h.get<HTMLButtonElement>("complete-stage").disabled, true);
    assert.equal(h.get("toggle-change-details").textContent, "Review");
    assert.equal(h.get("toggle-change-details").dataset.status, "attention");
    await h.click("toggle-change-details");
    assert.equal(h.document.getElementById("approve-change"), null, "A genuine question cannot be bypassed with approval.");
    const submit = h.document.querySelector<HTMLButtonElement>('button[form="change-detail-form"]')!;
    assert.equal(submit.disabled, true);
    await h.input("change-detail", "Keep this unsent answer.");
    assert.equal(h.document.getElementById("defer-change"), null);
    await h.click("close-change-details");
    assert.equal(h.get<HTMLButtonElement>("complete-stage").disabled, true);
    assert.equal(h.get("toggle-change-details").dataset.status, "attention");
    await h.click("toggle-change-details");
    assert.equal(h.get<HTMLTextAreaElement>("change-detail").value, "Keep this unsent answer.");
    const cancelled = { ...initial, revision: 2, changeRequests: [{ ...change, status: "cancelled" as const }] };
    h.setFetch(async () => response(cancelled));
    await h.click("cancel-change");
    const sent = h.requests.find(item => item.path === "/api/change-requests/decision")!;
    assert.equal(sent.body.decision, "cancel");
    assert.equal(sent.body.requestId, change.id);
    assert.equal(h.document.getElementById("change-request-details"), null);
    assert.equal(h.get<HTMLButtonElement>("complete-stage").disabled, false);
    assert.equal(h.store.getSnapshot().state.lifecycle.currentStage, "requirements");
    assert.equal(h.get("toggle-change-details").dataset.status, "idle");
    assert.equal(h.requests.filter(item => item.options.method === "POST").length, 1);
    assert.deepEqual(h.errors, []);
});

test("legacy multiple requests are reviewed one at a time with admitted work first", async t => {
    const h = await reactHarness(t), initial = state("prototype");
    const first = { ...request(), assessment: { ...request().assessment!, question: "Which sequence?" } };
    const later: ChangeRequest = { ...request(), id: "later", clientRequestId: "later-client", message: "Adjust the preview spacing.",
        status: "active", remainingStages: ["prototype"], workStarted: ["prototype"] };
    initial.changeRequests = [first, later];
    h.render(initial); await h.flush();
    assert.match(h.get("change-impact-title").textContent!, /Updating affected work/);
    await h.click("toggle-change-details");
    assert.equal(h.document.getElementById("change-request-picker"), null);
    assert.match(h.get("change-request-details").textContent!, /Adjust the preview spacing/);
    assert.equal(h.document.getElementById("change-detail"), null);
    h.render({ ...initial, revision: 2, changeRequests: [first, { ...later, status: "completed" }] });
    await h.flush();
    assert.equal(h.document.querySelector(".change-original")!.textContent, first.message);
    assert.ok(h.get("change-detail"));
    assert.equal(h.requests.filter(item => item.options.method === "POST").length, 0);
    assert.deepEqual(h.errors, []);
});

test("an earlier request's action error cannot masquerade as a blocker on later work", async t => {
    const h = await reactHarness(t), initial = state("prototype");
    const first = { ...request(), assessment: { ...request().assessment!, question: "Which sequence?" } };
    initial.changeRequests = [first];
    h.render(initial); await h.flush();
    await h.click("toggle-change-details");
    h.setFetch(async () => response({ error: "The old assessment is unavailable." }, 409));
    const retry = h.get("recheck-change");
    await h.click(retry);
    assert.match(h.get("change-action-status").textContent!, /old assessment/);
    h.render({ ...initial, revision: 2, changeRequests: [first, {
        ...request(), id: "new-change", clientRequestId: "new-client", status: "active", message: "A later independent update.",
    }] });
    await h.flush();
    assert.match(h.get("change-impact-title").textContent!, /Updating affected work/);
    assert.equal(Boolean(h.document.getElementById("change-action-status")), false);
    assert.equal(Boolean(h.document.getElementById("change-dialog-error")), false);
    assert.deepEqual(h.errors, []);
});
