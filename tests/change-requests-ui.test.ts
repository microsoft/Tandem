import assert from "node:assert/strict";
import { test } from "node:test";
import { reactHarness, response, state } from "./helpers/react-harness.js";
import type { ChangeRequest } from "../src/change-requests.js";

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
    h.setFetch(async path => {
        assert.equal(path, "/api/change-requests/decision");
        const next = { ...initial, revision: 2, stage: "requirements" as const,
            lifecycle: { ...initial.lifecycle, currentStage: "requirements" as const, completedStages: ["prepare" as const] },
            changeRequests: [{ ...request(), status: "active" as const, remainingStages: ["requirements" as const, "prototype" as const] }] };
        return response(next);
    });
    await h.click("approve-change");
    const sent = h.requests.find(item => item.path === "/api/change-requests/decision")!;
    assert.deepEqual(sent.body, { requestId: "change", analysisId: "analysis", baselineDigest: "a".repeat(64), decision: "approve", answer: "" });
    assert.equal(h.store.getSnapshot().state.previewUrl, initial.previewUrl);
    assert.equal(h.store.getSnapshot().state.lifecycle.currentStage, "requirements");
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
