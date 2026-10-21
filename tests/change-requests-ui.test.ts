import assert from "node:assert/strict";
import { test } from "node:test";
import { reactHarness, response, state } from "./helpers/react-harness.js";
import type { ChangeRequest } from "../src/change-requests.js";
import { createStageReview, type StageReviewReference } from "../src/stage-review.js";

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

test("impact review stays beside the existing prototype and submits the exact displayed proposal identity", async t => {
    const h = await reactHarness(t), initial = state("prototype");
    initial.previewStatus = "ready"; initial.previewUrl = "http://127.0.0.1:4321/";
    initial.changeRequests = [request()];
    h.render(initial); await h.flush();
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
    assert.match(h.get("design-tree-panel").textContent!, /Pinned draft review/);
    assert.equal(h.errors.length, 0, h.errors.join("\n"));
});

test("stale impact errors keep the request and clarification draft visible without navigation", async t => {
    const h = await reactHarness(t), initial = state("prototype");
    initial.changeRequests = [request()];
    h.render(initial); await h.flush();
    h.setFetch(async () => response({ error: "The project changed. Check the impact again." }, 409));
    await h.click("approve-change");
    assert.match(h.get("change-action-status").textContent!, /project changed/);
    assert.equal(h.store.getSnapshot().state.lifecycle.currentStage, "prototype");
    const refined = h.document.querySelector(".change-actions button:nth-child(2)")!;
    await h.click(refined);
    await h.input("change-detail", "Keep saving local to this device.");
    await h.fire(h.get("change-detail").closest("form")!, "submit");
    assert.equal(h.get<HTMLTextAreaElement>("change-detail").value, "Keep saving local to this device.");
    assert.equal(h.errors.length, 0, h.errors.join("\n"));
});
