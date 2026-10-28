import assert from "node:assert/strict";
import { test } from "node:test";
import { setup, state, decision, response, progressivePrototype, readyPrototype, checkpoint,
    text, field, disabled, hidden, current, submit, browse, waitFor, type Harness } from "./renderer-fixtures.test.js";
import { exploringPrototype } from "./helpers/visual-fixture.js";
import type { ChangeRequest } from "../src/change-requests.js";

const frame = (h: Harness) => h.get<HTMLIFrameElement>("preview-frame");

for (const legacy of [false, true]) test(`${legacy ? "legacy" : "tracked"} previews expose the required update rather than Finish after review`, async t => {
    const value = legacy ? state("prototype") : readyPrototype();
    value.previewStatus = "ready";
    value.previewUrl = "http://127.0.0.1:9999/";
    value.prototypeNeedsUpdate = true;
    value.lifecycle.reviewId = "review-11111111-1111-4111-8111-111111111111";
    const h = await setup(t, value);
    assert.equal(hidden(h, "retry-prototype-checkpoint"), false);
    assert.equal(disabled(h, "retry-prototype-checkpoint"), false);
    assert.equal(text(h, "retry-prototype-checkpoint"), "Update for reviewed inputs");
    assert.equal(disabled(h, "complete-stage"), true);
    assert.match(text(h, "prototype-progress-message"), /does not yet include the reviewed inputs/);
    assert.match(text(h, "next-action-guide"), /Update the prototype for reviewed inputs/);
    assert.equal(disabled(h, "request-prototype-visual"), true, "Optional appearance work cannot bypass the required update.");
    h.setFetch(async () => response({ ...value, revision: value.revision + 1,
        processing: { status: "running", action: "submit-revision", requestedAt: value.updatedAt } }));
    await h.click("retry-prototype-checkpoint");
    assert.deepEqual(h.requests.find(item => item.path === "/api/prototype/action")!.body,
        { action: "retry", expectedRevision: value.revision });
    assert.equal(current(h).previewUrl, value.previewUrl);
});

test("an unlinked upstream review points to stale Designs before offering a prototype update", async t => {
    const value = readyPrototype();
    value.prototypeNeedsUpdate = true;
    value.lifecycle.reviewId = "review-11111111-1111-4111-8111-111111111111";
    value.lifecycle.completedStages = ["prepare", "requirements"];
    const h = await setup(t, value);
    assert.equal(text(h, "continue-pending-review"), "Review Designs draft");
    assert.equal(disabled(h, "continue-pending-review"), false);
    assert.equal(disabled(h, "retry-prototype-checkpoint"), true);
    assert.equal(disabled(h, "complete-stage"), true);
    assert.match(text(h, "pending-review-title"), /Designs review/);
    assert.equal(h.requests.length, 0, "Opening the view never starts a build.");
});

test("a queued change leaves the earlier prepared prototype actionable instead of waiting on itself", async t => {
    const value = readyPrototype(1, true);
    value.changeRequests = [{
        version: 1, id: "queued-change", clientRequestId: "queued-client", originStage: "prototype",
        message: "Add saving.", submittedAt: value.updatedAt, status: "queued", assessment: null,
        analysisId: null, baselineDigest: null, error: "", clarifications: [], remainingStages: [], workStarted: [],
        affectedDecisionIds: [], snapshotPath: null, completedAt: null, baseCheckpointId: "structure",
        baseSketchRevisionId: null, visualSelection: null, sourceResultId: null, sourceRequests: [],
        developmentAdmission: null, developmentRequest: null,
    }];
    const h = await setup(t, value);
    assert.equal(disabled(h, "apply-prototype-update"), false);
    assert.equal(disabled(h, "submit-revision"), false, "Feedback can revise the queued review without bypassing the earlier candidate.");
    assert.equal(disabled(h, "complete-stage"), true);
    assert.match(h.document.querySelector(".review-pane-guidance")!.textContent!, /existing prototype.*queued/);
    assert.match(text(h, "next-action-guide"), /Show the prepared prototype version/);
    h.setFetch(async () => response({ ...value, revision: 2,
        changeRequests: [{ ...value.changeRequests[0], status: "analyzing" }],
        prototypeFlow: { ...value.prototypeFlow, pendingCheckpointId: null, displayedCheckpointId: "interaction" },
        processing: { status: "running", action: "assess-change", requestedAt: value.updatedAt } }));
    await h.click("apply-prototype-update");
    await waitFor(h, () => h.requests.some(item => item.path === "/api/prototype/action"));
    assert.equal(h.requests.find(item => item.path === "/api/prototype/action")!.body.action, "apply-update");
    assert.equal(current(h).prototypeFlow.displayedCheckpointId, "interaction");
});

function prototypeReviewState() {
    const value = readyPrototype();
    const review: ChangeRequest = {
        version: 1, id: "current-review", clientRequestId: "original-client", originStage: "prototype",
        message: "Add saving.", submittedAt: value.updatedAt, status: "reviewing",
        assessment: { version: 1, summary: "Add saving.", reason: "A new capability.", startStage: "requirements",
            stages: [{ stage: "requirements", reason: "Record saving." }, { stage: "prototype", reason: "Try saving." }],
            preserved: ["Existing task behavior"], affectedScreenIds: [], question: null,
            requirements: { usages: { add: ["I want to save tasks."], remove: [] }, upsert: [], remove: [],
                assumptions: { add: [], remove: [] }, deferred: { add: [], remove: [] }, prototypeApproach: null } },
        reviewId: "review-11111111-1111-4111-8111-111111111111",
        analysisId: "analysis", baselineDigest: "a".repeat(64), error: "", clarifications: [],
        remainingStages: ["prototype"], workStarted: ["requirements", "prototype"], affectedDecisionIds: [],
        snapshotPath: "retained-review.json", completedAt: null, baseCheckpointId: "interaction",
        baseSketchRevisionId: null, visualSelection: null, sourceResultId: null, sourceRequests: [],
        developmentAdmission: null, developmentRequest: null,
    };
    value.changeRequests = [review];
    return value;
}

test("Prototype feedback re-evaluates the current review without requiring Finish Prototype", async t => {
    const value = prototypeReviewState(), h = await setup(t, value);
    assert.equal(disabled(h, "complete-stage"), false);
    assert.equal(disabled(h, "submit-revision"), false);
    assert.equal(h.get("submit-revision").getAttribute("aria-label"), "Re-evaluate change");
    assert.match(text(h, "revision-status"), /without finishing Prototype/);
    assert.match(h.document.querySelector(".review-pane-guidance")!.textContent!, /Send feedback to re-evaluate/);
    h.setFetch(async () => response(value));
    await h.input("revision-input", "Add a milk option.");
    await h.click("submit-revision");
    const sent = h.requests.find(item => item.path === "/api/revision")!;
    assert.equal(sent.body.replacesRequestId, value.changeRequests[0].id);
    assert.equal(sent.body.suggestion, "Add a milk option.");
    assert.equal(sent.body.baseCheckpointId, "interaction");
    assert.equal(field(h, "revision-input").value, "");
    assert.equal(h.requests.some(item => item.path === "/api/stage/complete"), false);
    assert.equal(current(h).lifecycle.currentStage, "prototype");
});

test("feedback stays interactive in the bottom pane while an upstream review makes the prototype read-only", async t => {
    const value = prototypeReviewState();
    value.changeRequests[0].remainingStages = ["requirements", "prototype"];
    const h = await setup(t, value);
    assert.equal(h.get("live-preview-panel").hasAttribute("inert"), true);
    assert.ok(h.get("revision-input").closest("#stage-input-review"));
    assert.equal(h.get("revision-input").closest("[inert]"), null);
    assert.equal(h.document.querySelectorAll("#revision-input").length, 1);
    assert.equal(disabled(h, "submit-revision"), false);
    assert.equal(disabled(h, "complete-stage"), true);
    h.setFetch(async () => response(value));
    await h.input("revision-input", "Reconsider the saving workflow.");
    await h.click("submit-revision");
    assert.equal(h.requests.find(item => item.path === "/api/revision")!.body.replacesRequestId, "current-review");
    assert.equal(current(h).prototypeFlow.displayedCheckpointId, "interaction");
});

test("review feedback transport retries keep the original request binding after the current review changes", async t => {
    const value = prototypeReviewState(), h = await setup(t, value);
    h.setFetch(async () => { throw new Error("Lost feedback acknowledgement"); });
    await h.input("revision-input", "Add a milk option.");
    await h.click("submit-revision");
    const original = h.requests.find(item => item.path === "/api/revision")!.body;
    const next = { ...value, revision: 2, changeRequests: [
        { ...value.changeRequests[0], status: "cancelled", replacedByRequestId: "new-review" },
        { ...value.changeRequests[0], id: "new-review", clientRequestId: original.clientRequestId,
            message: original.suggestion, replacesRequestId: "current-review", status: "queued",
            assessment: null, remainingStages: [], reviewId: null },
    ] };
    h.render(next); await h.flush();
    assert.equal(field(h, "revision-input").value, "Add a milk option.");
    h.setFetch(async () => response(next));
    await h.click("submit-revision");
    assert.deepEqual(h.requests.filter(item => item.path === "/api/revision")[1].body, original);
    assert.equal(field(h, "revision-input").value, "");
});

test("re-evaluation cannot bypass read-only ownership or the frozen Prototype handoff", async t => {
    const value = prototypeReviewState(), h = await setup(t, value);
    h.render({ ...value, revision: 2, provider: { ...value.provider, canSubmitAnswers: false } });
    await h.flush();
    assert.equal(disabled(h, "submit-revision"), true);
    h.render({ ...value, revision: 3, processing: { status: "running", action: "generate-design-spec" } });
    await h.flush();
    assert.equal(disabled(h, "submit-revision"), true);
    assert.match(text(h, "revision-status"), /frozen input/);
    assert.equal(h.requests.some(item => item.path === "/api/revision"), false);
});

test("one Prototype tab combines layout and behavior while preserving accepted legacy checkpoints", async t => {
    const h = await setup(t, readyPrototype(1, true));
    assert.deepEqual(Array.from(h.get("prototype-milestones").querySelectorAll("[role=tab]"), item => item.getAttribute("data-milestone")), ["prototype", "visual"]);
    assert.ok(h.get("prototype-visual-tab").classList.contains("substage-tab"));
    assert.deepEqual(Array.from(h.get("prototype-milestones").querySelectorAll(".substage-index"), item => item.textContent), ["1", "2"]);
    assert.equal(h.get("prototype-milestones").querySelector("strong"), null);
    const status = h.get("prototype-prototype-tab").querySelector(".substage-status")!;
    assert.equal(status.getAttribute("role"), "img");
    assert.equal(status.getAttribute("title"), "Ready to inspect - not applied");
    assert.equal(h.get("prototype-prototype-tab").getAttribute("aria-label"), "Prototype, Ready to inspect - not applied");
    assert.ok(status.querySelector('svg[aria-hidden="true"]'));
    assert.equal(h.document.getElementById("prototype-structure-tab"), null);
    assert.equal(h.document.getElementById("prototype-interaction-tab"), null);
    assert.equal(h.document.getElementById("prototype-focus"), null);
    assert.equal(text(h, "prototype-review").includes("Task flow & behavior"), false);
    assert.match(field(h, "revision-input").placeholder, /task flow, controls or state feedback/);
    await h.fire(h.get("prototype-prototype-tab"), "mousedown", { button: 0 });
    assert.equal(current(h).prototypeFlow.displayedCheckpointId, "structure");
    assert.deepEqual(h.requests, []);
    h.render(readyPrototype(2));
    await h.flush();
    assert.equal(current(h).prototypeFlow.displayedCheckpointId, "interaction");
    assert.match(field(h, "revision-input").placeholder, /task flow, controls or state feedback/);
});

test("one ready combined checkpoint enables completion and optional visuals without a second mandatory milestone", async t => {
    const value = readyPrototype();
    const combined = { ...value.prototypeFlow.checkpoints[1], id: "combined", requestId: "combined",
        milestone: "prototype" as const, baseCheckpointId: null, sourceCheckpointId: null };
    value.prototypeFlow.checkpoints = [combined];
    value.prototypeFlow.displayedCheckpointId = combined.id;
    const h = await setup(t, value);
    assert.equal(text(h, "prototype-milestones"), "1Prototype2Visual exploration");
    assert.equal(h.get("prototype-prototype-tab").querySelector(".substage-status")!.getAttribute("aria-label"), "Ready");
    assert.equal(h.get("prototype-visual-tab").querySelector(".substage-status")!.getAttribute("aria-label"), "Optional");
    assert.equal(disabled(h, "complete-stage"), false);
    assert.equal(hidden(h, "request-prototype-visual"), false);
    assert.equal(frame(h).dataset.checkpointId, "combined");
    const partial = { ...value, revision: 2, prototypeFlow: { ...value.prototypeFlow,
        checkpoints: [{ ...combined, milestone: "structure" as const }] } };
    h.render(partial); await h.flush();
    assert.equal(h.get("prototype-prototype-tab").querySelector(".substage-status")!.getAttribute("aria-label"), "Partial preview");
    assert.equal(disabled(h, "complete-stage"), true);
    assert.equal(hidden(h, "request-prototype-visual"), true);
});
function bridge(h: Harness, owner = frame(h), onCapture?: () => void) {
    const messages: { data: any; origin: string }[] = [];
    owner.contentWindow!.postMessage = (data: any, origin: any) => { messages.push({ data, origin }); onCapture?.(); };
    return messages;
}
async function message(h: Harness, details: Record<string, unknown>) {
    h.window.dispatchEvent(new h.window.MessageEvent("message", details)); await h.flush();
}
async function reply(h: Harness, capture: { data: any; origin: string }, saved: unknown = null, owner = frame(h)) {
    await message(h, { source: owner.contentWindow, origin: capture.origin, data: {
        type: "tandem:preview:state", requestId: capture.data.requestId, prototypeId: "fixture", state: saved,
    } });
}

test("Prototype substage tabs revisit saved results without promoting versions or remounting the current preview", async t => {
    const value = exploringPrototype(), h = await setup(t, value);
    const before = structuredClone(current(h).prototypeFlow), accepted = frame(h);
    await h.input("revision-input", "Retain this feedback.");
    assert.equal(h.get("prototype-visual-tab").getAttribute("aria-selected"), "true");
    await h.fire(h.get("prototype-prototype-tab"), "mousedown", { button: 0 });
    assert.equal(frame(h), accepted);
    assert.equal(accepted.hidden, false);
    assert.equal(accepted.dataset.checkpointId, "interaction");
    assert.equal(h.get("prototype-substage-panel").getAttribute("aria-labelledby"), "prototype-prototype-tab");
    await h.fire(h.get("prototype-prototype-tab"), "keydown", { key: "ArrowRight" });
    assert.equal(h.get("prototype-visual-tab").getAttribute("aria-selected"), "true");
    assert.equal(h.get("visual-exploration-title").closest("[hidden]"), null);
    await h.fire(h.get("prototype-prototype-tab"), "mousedown", { button: 0 });
    assert.equal(frame(h), accepted);
    assert.equal(field(h, "revision-input").value, "Retain this feedback.");
    assert.deepEqual(current(h).prototypeFlow, before);
    assert.deepEqual(h.requests, []);
});

test("a verified pending prototype can be opened without replacing or accepting the current preview", async t => {
    const value = readyPrototype(1, true), h = await setup(t, value), accepted = frame(h);
    const before = structuredClone(current(h).prototypeFlow);
    const pending = h.get<HTMLAnchorElement>("open-pending-preview");
    assert.equal(pending.href, value.prototypeFlow.checkpoints[1].previewUrl);
    assert.match(pending.textContent!, /not applied/);
    assert.equal(pending.target, "_blank");
    assert.equal(disabled(h, "complete-stage"), true);
    await h.fire(h.get("prototype-prototype-tab"), "mousedown", { button: 0 });
    assert.equal(frame(h), accepted);
    assert.equal(accepted.hidden, false);
    assert.deepEqual(current(h).prototypeFlow, before);
    assert.deepEqual(h.requests, []);
});

test("saved Prototype milestone tabs remain browsable after continuing into Development", async t => {
    const value = readyPrototype(), h = await setup(t, value);
    h.render({ ...value, revision: 2, lifecycle: { ...value.lifecycle,
        currentStage: "development", completedStages: ["prepare", "requirements", "sketch", "prototype"] } });
    await browse(h, "prototype");
    const requestsBefore = h.requests.length;
    await h.fire(h.get("prototype-prototype-tab"), "mousedown", { button: 0 });
    assert.equal(frame(h).hidden, false);
    assert.equal(current(h).lifecycle.currentStage, "development");
    assert.equal(current(h).prototypeFlow.displayedCheckpointId, "interaction");
    assert.equal(h.requests.length, requestsBefore);
});

test("prototype waits honestly, starts explicitly and shows actual progress with elapsed time", async (t) => {
    const value = state("prototype"); value.phase = "building";
    const h = await setup(t, value);
    assert.equal(hidden(h, "prototype-building"), true);
    assert.equal(hidden(h, "start-prototype"), false);
    h.setFetch(async () => response({ ...value, revision: 2, previewStatus: "starting", processing: {
        action: "build-prototype", status: "running", message: "Installing app dependencies", requestedAt: new Date(Date.now() - 5000).toISOString(),
    } }));
    await h.click("start-prototype");
    assert.equal(h.requests[0].path, "/api/prototype/start");
    assert.equal(hidden(h, "prototype-building"), false);
    assert.equal(text(h, "prototype-building-message"), "Installing app dependencies");
    assert.match(text(h, "prototype-building-elapsed"), /Elapsed:/);
    h.render({ ...value, revision: 3, previewStatus: "error", processing: { action: "build-prototype", status: "error", message: "Build failed" } });
    assert.equal(text(h, "start-prototype"), "Retry prototype build");
    assert.match(text(h, "prototype-build-status"), /Build failed/);
});

test("progressive Prototype reports honest milestones and keeps its iframe while updates build", async (t) => {
    const first = progressivePrototype();
    first.previewUrl = null; first.previewStatus = "starting";
    first.prototypeFlow.checkpoints = [checkpoint("first", "structure", "running")];
    first.prototypeFlow.displayedCheckpointId = null; first.prototypeFlow.activeCheckpointId = "first";
    const h = await setup(t, first);
    assert.equal(hidden(h, "prototype-progress"), false);
    assert.equal(text(h, "prototype-milestones"), "1Prototype2Visual exploration");
    assert.equal(h.get("prototype-prototype-tab").querySelector(".substage-status")!.getAttribute("aria-label"), "Building");
    assert.ok(h.get("prototype-prototype-tab").querySelector(".substage-status .tandem-spin"));
    assert.match(text(h, "preview-empty-message"), /first checkpoint/);
    assert.equal(frame(h).hidden, true);
    assert.equal(disabled(h, "revision-input"), false);
    assert.equal(disabled(h, "submit-revision"), false);
    const value = progressivePrototype(2); h.render(value); await h.flush();
    const displayed = frame(h);
    assert.equal(displayed.hidden, false); assert.equal(displayed.src, value.previewUrl);
    assert.equal(text(h, "prototype-building-title"), "Building Prototype");
    assert.equal(h.get("prototype-milestones").querySelector<HTMLElement>('[aria-current="step"]')!.dataset.milestone, "prototype");
    await h.input("revision-input", "Keep this draft");
    field(h, "revision-input").focus(); field(h, "revision-input").setSelectionRange(2, 5);
    h.render({ ...value, revision: 3, status: "Verifying the update" });
    assert.equal(frame(h), displayed);
    assert.equal(field(h, "revision-input").value, "Keep this draft");
    assert.equal(field(h, "revision-input").selectionStart, 2);
    h.render(readyPrototype(4, true));
    assert.equal(frame(h), displayed);
    assert.equal(frame(h).src, value.previewUrl);
    assert.match(text(h, "prototype-progress-message"), /Prototype ready to inspect.*automatically generated milestone, not a response to feedback/);
    assert.equal(hidden(h, "apply-prototype-update"), false);
    assert.equal(disabled(h, "apply-prototype-update"), false);
    assert.equal(hidden(h, "request-prototype-visual"), true);
    assert.equal(disabled(h, "complete-stage"), true);
});

test("compact prototype layout retains expanded details, drafts and iframe across tabs", async (t) => {
    const value = progressivePrototype();
    value.prototypeReview.revisions = [{ id: "queued", suggestion: "Keep the camera position.", status: "queued" }];
    const h = await setup(t, value), displayed = frame(h);
    assert.equal(h.document.body.classList.contains("prototype-view"), true);
    assert.equal(h.document.getElementById("prototype-focus"), null);
    assert.equal(h.get("revision-history-details").hidden, true);
    assert.equal(h.get("revision-form").lastElementChild, h.get("prototype-history-toggle"));
    assert.equal(text(h, "submit-revision"), "Send");
    assert.match(text(h, "revision-queue-summary"), /1 queued/);
    assert.equal(h.get("revision-status").dataset.essential, "false");
    assert.equal(field(h, "revision-input").getAttribute("rows"), "1");
    await submit(h, "revision-form");
    assert.equal(h.get("revision-status").dataset.essential, "true");
    assert.match(text(h, "revision-status"), /Enter a revision suggestion/);
    await h.click("prototype-history-toggle");
    assert.equal(h.get("prototype-history-toggle").getAttribute("aria-expanded"), "true");
    await h.input("revision-input", "Draft stays here.");
    field(h, "revision-input").focus(); field(h, "revision-input").setSelectionRange(3, 5);
    h.render({ ...value, revision: 2 });
    assert.equal(h.get("revision-history-details").hidden, false);
    assert.equal(field(h, "revision-input").selectionStart, 3);
    await browse(h, "requirements");
    assert.equal(h.document.body.classList.contains("prototype-view"), false);
    await browse(h, "prototype");
    assert.equal(h.document.body.classList.contains("prototype-view"), true);
    assert.equal(h.get("revision-history-details").hidden, false);
    assert.equal(field(h, "revision-input").value, "Draft stays here.");
    assert.equal(frame(h), displayed);
    await h.fire(h.get("revision-history-details"), "keydown", { key: "Escape" });
    assert.equal(h.get("revision-history-details").hidden, true);
    assert.equal(h.document.activeElement, h.get("prototype-history-toggle"));
    assert.equal(field(h, "revision-input").value, "Draft stays here.");
});

test("Prototype history stays available when empty and keyboard submission retains the feedback target", async t => {
    const value = readyPrototype(), h = await setup(t, value);
    await h.click("prototype-history-toggle");
    assert.equal(h.get("revision-history-details").hidden, false);
    assert.match(text(h, "revision-history-details"), /No prototype requests yet/);
    await h.fire(h.get("prototype-history-toggle"), "keydown", { key: "Escape" });
    assert.equal(h.get("revision-history-details").hidden, true);
    assert.deepEqual(h.requests, []);
    await h.input("revision-input", "Keep this keyboard feedback.");
    h.setFetch(async () => response({ ...value, revision: 2 }));
    await h.fire(h.get("revision-input"), "keydown", { key: "Enter" });
    assert.equal(h.requests[0].path, "/api/revision");
    assert.equal(h.requests[0].body.suggestion, "Keep this keyboard feedback.");
    assert.equal(h.requests[0].body.baseCheckpointId, "interaction");
    assert.equal(field(h, "revision-input").value, "");
});

test("prototype completion stays in the stage header while preview controls share the substage tab bar", async t => {
    const value = readyPrototype();
    const h = await setup(t, value), displayed = frame(h);
    const actions = h.document.querySelector(".prototype-substage-bar")!;
    const open = h.get<HTMLAnchorElement>("open-preview");
    assert.ok(h.document.querySelector(".previewbar")!.contains(h.get("complete-stage")));
    assert.equal(actions.contains(h.get("complete-stage")), false);
    assert.ok(actions.contains(open));
    assert.equal(open.href, value.previewUrl);
    assert.equal(h.get("live-preview-panel").querySelector(".prototype-preview-actions"), actions.querySelector(".prototype-preview-actions"));
    h.render({ ...value, revision: 2, status: "Current preview stays available." });
    await h.flush();
    assert.equal(h.get("open-preview"), open);
    assert.equal(frame(h), displayed);
    await browse(h, "requirements");
    assert.ok(actions.closest("[hidden]"));
    await browse(h, "prototype");
    assert.ok(actions.contains(h.get("open-preview")));
    assert.equal(frame(h), displayed);
    assert.deepEqual(h.requests, []);
});

test("pending Prototype copy distinguishes automatic milestones from recorded feedback revisions", async t => {
    const value = readyPrototype(1, true);
    const h = await setup(t, value);
    assert.match(text(h, "prototype-progress-message"), /automatically generated milestone, not a response to feedback/);
    assert.equal(text(h, "apply-prototype-update"), "Show Prototype");
    assert.equal(h.document.getElementById("prototype-feedback-help"), null);
    assert.equal(field(h, "revision-input").placeholder, "Describe a change to the task flow, controls or state feedback.");
    assert.equal(field(h, "revision-input").getAttribute("aria-label"), "Prototype revision suggestion");
    const requested = readyPrototype(2, true);
    requested.prototypeFlow.checkpoints[1].revisionId = "feedback-one";
    requested.prototypeReview.revisions = [{ id: "feedback-one", suggestion: "Use a larger button.", status: "ready" }];
    h.render(requested); await h.flush();
    assert.match(text(h, "prototype-progress-message"), /Requested prototype revision ready to inspect/);
    assert.doesNotMatch(text(h, "prototype-progress-message"), /automatically generated/);
    assert.equal(text(h, "apply-prototype-update"), "Show requested revision");
    h.render({ ...requested, revision: 3, prototypeReview: { ...requested.prototypeReview, revisions: [] } });
    await h.flush();
    assert.match(text(h, "prototype-progress-message"), /Saved prototype version ready to inspect/);
    assert.doesNotMatch(text(h, "prototype-progress-message"), /Requested|automatically generated/);
    assert.equal(h.requests.length, 0);
});

test("unavailable current preview reviews an explicit legacy recipe and native denial remains dismissible without promotion", async t => {
    const value = readyPrototype(1, true), h = await setup(t, value);
    h.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    h.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
    h.setPreviewFetch(async () => response({ generation: value.generation, checkpointId: "structure", pendingCheckpointId: "interaction",
        url: value.previewUrl, available: false, reason: "Saved preview server is stopped." }));
    await h.click("retry-current-preview");
    const before = JSON.stringify(value.prototypeFlow);
    let inspected = 0;
    h.setFetch(async (path, options) => {
        const input = JSON.parse(String(options.body));
        if (path.endsWith("/inspect")) {
            assert.equal(input.target, "current"); assert.equal(input.checkpointId, "structure");
            inspected++;
            return response({ needsRecipe: inspected === 1, target: "current", checkpointId: "structure", cwd: "fixture",
                url: value.previewUrl, executable: "node.exe", args: ["server.mjs"], entrypoints: ["server.mjs"],
                message: "Review this saved launch; no generation or promotion.", ...(inspected === 1 ? {} : { confirmationId: "reviewed-once" }) });
        }
        assert.equal(path, "/api/prototype/preview-restart/decision");
        assert.equal(input.confirmationId, "reviewed-once");
        return input.approve ? response({ error: "Native permission was denied. The saved preview was not started." }, 409)
            : response({ dismissed: true, previouslySubmitted: true });
    });
    await h.click("restart-current-preview");
    assert.equal(h.document.querySelector("#confirm-current-restart"), null);
    assert.equal(h.document.querySelector<HTMLDetailsElement>(".preview-restart-advanced")!.open, false);
    await h.click(h.document.querySelector(".preview-restart-advanced > summary")!);
    await h.input("restart-current-entrypoint", "server.mjs");
    await h.input("restart-current-arguments", "--port\n4321\nA name with spaces");
    await h.fire(h.document.querySelector(".preview-restart-dialog[open] form")!, "submit");
    assert.deepEqual(h.requests.find(item => item.path.endsWith("/inspect") && item.body.entrypoint)?.body.args, ["--port", "4321", "A name with spaces"]);
    assert.ok(h.get("confirm-current-restart"));
    await h.click("confirm-current-restart");
    assert.match(h.document.querySelector(".preview-restart-dialog[open]")!.textContent!, /Native permission was denied/);
    const cancel = [...h.document.querySelectorAll<HTMLButtonElement>(".preview-restart-dialog[open] button")].find(button => button.textContent === "Cancel")!;
    await h.click(cancel);
    assert.equal(h.document.querySelector(".preview-restart-dialog[open]"), null);
    assert.equal(JSON.stringify(current(h).prototypeFlow), before);
    assert.equal(h.requests.some(item => ["/api/prototype/action", "/api/prototype/start", "/api/development/open"].includes(item.path)), false);
});

test("detected preview startup is selectable without entering a path and saved launches hide technical details", async t => {
    const value = readyPrototype(1, true), h = await setup(t, value);
    h.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    h.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
    h.setPreviewFetch(async () => response({ generation: value.generation, checkpointId: "structure", pendingCheckpointId: "interaction",
        url: value.previewUrl, available: false, reason: "Stopped" }));
    await h.click("retry-current-preview");
    let attempts = 0;
    h.setFetch(async (path, options) => {
        const input = JSON.parse(String(options.body));
        if (path.endsWith("/decision")) return response({ started: true });
        attempts++;
        return response({ needsRecipe: attempts === 1, target: "current", checkpointId: "structure", cwd: "fixture",
            url: value.previewUrl, executable: "node.exe", args: ["app\\server.mjs", "--port", "4321"], workingDirectory: "fixture\\app",
            environment: { PORT: "4321" },
            choices: [{ id: "detected-option", label: "Development preview", entrypoint: "app\\server.mjs", workingDirectory: "app",
                args: ["--port", "4321"], source: "package-script", detail: "From dev in app\\package.json." }],
            entrypoints: ["app\\server.mjs"], message: "Your existing preview stays unchanged.",
            ...(input.choiceId ? { confirmationId: "detected-confirmation" } : {}) });
    });
    await h.click("restart-current-preview");
    assert.ok(h.document.querySelector<HTMLInputElement>(".preview-start-choice input")!.checked);
    assert.equal(h.document.querySelector<HTMLDetailsElement>(".preview-restart-advanced")!.open, false);
    await h.click("review-current-restart");
    const sent = h.requests.filter(item => item.path.endsWith("/inspect")).at(-1)!;
    assert.equal(sent.body.choiceId, "detected-option");
    assert.equal(sent.body.entrypoint, undefined);
    assert.equal(h.document.querySelector("#restart-current-entrypoint"), null, "normal confirmation requires no technical input");
    assert.equal(h.document.querySelector<HTMLDetailsElement>(".preview-restart-advanced")!.open, false);
    assert.match(h.document.querySelector(".preview-restart-dialog[open]")!.textContent!, /PORT=4321/);
    await h.click("confirm-current-restart");
    assert.equal(h.document.querySelector(".preview-restart-dialog[open]"), null);
    assert.equal(h.requests.filter(item => item.path.endsWith("/decision")).length, 1);
    assert.deepEqual(current(h).prototypeFlow, value.prototypeFlow);
});

test("multiple restart options require selection and a stale preview cannot consume an old confirmation", async t => {
    const value = readyPrototype(1, true), h = await setup(t, value);
    h.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    h.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
    h.setPreviewFetch(async () => response({ generation: value.generation, checkpointId: "structure", pendingCheckpointId: "interaction",
        url: value.previewUrl, available: false, reason: "Stopped" }));
    await h.click("retry-current-preview");
    h.setFetch(async (path, options) => {
        const input = JSON.parse(String(options.body));
        return response({ needsRecipe: !input.choiceId, generation: value.generation, target: "current", checkpointId: "structure",
            cwd: "fixture", url: value.previewUrl, executable: "node.exe", message: "Choose a start option.",
            choices: ["one", "two"].map(id => ({ id, label: "Preview server", entrypoint: `${id}\\server.mjs`,
                workingDirectory: id, args: [], source: "server-file", detail: "Existing server file" })),
            ...(input.choiceId ? { confirmationId: "selected" } : {}) });
    });
    await h.click("restart-current-preview");
    assert.equal(disabled(h, "review-current-restart"), true);
    await h.click(h.document.querySelectorAll<HTMLInputElement>(".preview-start-choice input")[1]!);
    assert.equal(disabled(h, "review-current-restart"), false);
    await h.click("review-current-restart");
    h.render({ ...value, revision: 2, prototypeFlow: { ...value.prototypeFlow, displayedCheckpointId: "interaction", pendingCheckpointId: null } });
    await h.flush();
    assert.equal(disabled(h, "confirm-current-restart"), true);
    assert.match(h.document.querySelector(".preview-restart-dialog[open]")!.textContent!, /saved version changed/);
    assert.equal(h.requests.filter(item => item.path.endsWith("/decision")).length, 0);
});

test("compact prototype controls never hide pending candidates, failures or clarification", async (t) => {
    const h = await setup(t, readyPrototype(1, true));
    assert.equal(hidden(h, "apply-prototype-update"), false);
    assert.equal(h.get("prototype-progress-message").dataset.essential, "true");
    const failed = progressivePrototype(2);
    failed.prototypeFlow.activeCheckpointId = null;
    Object.assign(failed.prototypeFlow.checkpoints[1], { status: "failed", summary: "Build failed; preview retained." });
    h.render(failed);
    assert.equal(hidden(h, "retry-prototype-checkpoint"), false);
    assert.equal(h.get("prototype-progress-message").dataset.essential, "true");
    assert.equal(frame(h).hidden, false);
    const clarification = readyPrototype(3); clarification.prototypeReview.question = decision("clarify").question;
    h.render(clarification);
    assert.equal(hidden(h, "revision-question"), false);
    assert.equal(h.get("revision-status").dataset.essential, "true");
    await h.input("revision-input", "Keep this failed submission.");
    h.setFetch(async () => response({ error: "Submission was rejected." }, 409));
    await submit(h, "revision-form");
    assert.equal(h.get("revision-status").dataset.status, "error");
    assert.equal(field(h, "revision-input").value, "Keep this failed submission.");
});

test("clarification keeps draft and selected choice through pending SSE and transport failure", async (t) => {
    const value = readyPrototype(); value.prototypeReview.question = decision("clarify").question;
    const h = await setup(t, value);
    await h.click(h.get("revision-question-choices").querySelectorAll('[role="radio"]')[1]);
    h.render({ ...value, revision: 2 });
    assert.equal(h.get("revision-question-choices").querySelectorAll('[role="radio"]')[1].getAttribute("aria-checked"), "true");
    await h.input("revision-question-detail", "A precise clarification");
    let release!: (r: Response) => void;
    h.setFetch(() => new Promise((resolve) => { release = resolve; }));
    await submit(h, "revision-question-form");
    h.render({ ...value, revision: 3 }); await h.flush();
    assert.equal(disabled(h, "submit-clarification"), true);
    assert.equal(field(h, "revision-question-detail").value, "A precise clarification");
    release(response({ error: "Please retry" }, 503)); await waitFor(h, () => !disabled(h, "submit-clarification"));
    assert.equal(field(h, "revision-question-detail").value, "A precise clarification");
    assert.match(h.get("revision-question-form").textContent!, /Please retry/);
    assert.equal(disabled(h, "submit-clarification"), false);
});

test("feedback queues before preview and during clarification without losing replacement drafts", async (t) => {
    const value = progressivePrototype(); value.previewUrl = null; value.previewStatus = "starting"; value.prototypeFlow.displayedCheckpointId = null;
    const h = await setup(t, value);
    await h.input("revision-input", "Make the primary action obvious");
    let release!: (r: Response) => void;
    h.setFetch(() => new Promise((resolve) => { release = resolve; }));
    await submit(h, "revision-form");
    assert.equal(h.requests[0].path, "/api/revision");
    assert.equal(h.requests[0].body.baseCheckpointId, null);
    assert.match(h.requests[0].body.clientRequestId, /^[\da-f-]{36}$/);
    assert.equal(disabled(h, "revision-input"), false);
    await h.input("revision-input", "A second observation");
    const queued = { ...value, revision: 2, prototypeReview: {
        revisions: [{ id: "r1", suggestion: h.requests[0].body.suggestion, status: "queued" }], question: decision("clarify").question,
    } };
    release(response(queued)); await h.flush();
    assert.equal(field(h, "revision-input").value, "A second observation");
    assert.equal(disabled(h, "submit-revision"), false);
    assert.match(text(h, "revision-history"), /Make the primary action obviousQueued/);
    assert.match(text(h, "revision-queue-summary"), /1 queued/);
    h.setFetch(async () => response({ ...queued, revision: 3 })); await submit(h, "revision-form");
    assert.equal(h.requests[1].body.suggestion, "A second observation");
    assert.notEqual(h.requests[1].body.clientRequestId, h.requests[0].body.clientRequestId);
    assert.equal(field(h, "revision-input").value, "");
});

test("revision transport retries preserve request identity and original base checkpoint", async (t) => {
    const h = await setup(t, progressivePrototype());
    await h.input("revision-input", "Keep the filter visible");
    h.setFetch(async () => response({ error: "Connection failed; retry saved draft" }, 503));
    await submit(h, "revision-form"); h.render(readyPrototype(2));
    assert.match(text(h, "revision-status"), /Connection failed/);
    h.setFetch(async () => response(readyPrototype(3))); await submit(h, "revision-form");
    assert.equal(h.requests[1].body.clientRequestId, h.requests[0].body.clientRequestId);
    assert.equal(h.requests[1].body.baseCheckpointId, "structure");
    assert.equal(field(h, "revision-input").value, "");
    await h.input("revision-input", "Keep the filter visible"); await submit(h, "revision-form");
    assert.notEqual(h.requests[2].body.clientRequestId, h.requests[0].body.clientRequestId);
    assert.equal(h.requests[2].body.baseCheckpointId, "interaction");
});

test("revision queue reports unresolved history honestly and preserves full-queue drafts", async (t) => {
    const value = readyPrototype();
    value.prototypeReview.revisions = ["queued", "processing", "clarifying", "ready", "applied", "failed"].map((status, index) => ({ id: `r${index}`, suggestion: `Suggestion ${index}`, status }));
    const h = await setup(t, value);
    assert.equal(h.get("revision-history").children.length, 6);
    for (const expected of [/Building update/, /Update ready . not applied/, /Applied/, /Needs clarification/]) assert.match(text(h, "revision-history"), expected);
    const full = { ...value, revision: 2, prototypeReview: { ...value.prototypeReview,
        revisions: Array.from({ length: 50 }, (_, index) => ({ id: `q${index}`, suggestion: `Queued ${index}`, status: "queued" })) } };
    h.render(full); await h.input("revision-input", "Never lose this draft");
    assert.equal(disabled(h, "revision-input"), false);
    assert.equal(disabled(h, "submit-revision"), true);
    assert.equal(h.get("revision-history").children.length, 50);
    await submit(h, "revision-form"); h.render({ ...full, revision: 3 });
    assert.equal(h.requests.length, 0);
    assert.equal(field(h, "revision-input").value, "Never lose this draft");
    assert.match(text(h, "revision-status"), /queue is full/);
});

test("read-only, final-spec generation, historical stages and reset block sends but retain drafts", async (t) => {
    const value = readyPrototype(), h = await setup(t, value);
    const snapshots = [
        { ...value, provider: { canSubmitAnswers: false } },
        { ...value, processing: { action: "generate-design-spec", status: "running" } },
        { ...value, lifecycle: { ...value.lifecycle, currentStage: "development" } },
        { ...value, effortReset: { requestId: "reset" } },
    ];
    for (const [index, snapshot] of snapshots.entries()) {
        h.render({ ...snapshot, revision: index + 2 });
        await h.input("revision-input", "Keep the draft");
        assert.equal(disabled(h, "revision-input"), Boolean(snapshot.effortReset));
        assert.equal(disabled(h, "submit-revision"), true);
        if (snapshot.processing) assert.match(text(h, "revision-status"), /frozen input.*Keep drafting/);
        await submit(h, "revision-form");
        assert.equal(field(h, "revision-input").value, "Keep the draft");
    }
    assert.equal(h.requests.filter(request => request.path !== "/api/development/open").length, 0);
});

test("Finish Prototype requires promoted milestones and resolved feedback, not optional visual work", async (t) => {
    const value = readyPrototype(), h = await setup(t, value);
    assert.equal(disabled(h, "complete-stage"), false);
    const snapshots = [progressivePrototype(), readyPrototype(1, true),
        { ...value, prototypeFlow: { ...value.prototypeFlow, checkpoints: [checkpoint("structure", "structure")] } },
        { ...value, prototypeFlow: { ...value.prototypeFlow, visualRequested: true } },
        { ...value, prototypeReview: { ...value.prototypeReview, question: decision("clarify").question } },
        ...["queued", "processing", "clarifying", "ready", "failed"].map((status) => ({
            ...value, prototypeReview: { revisions: [{ id: status, status, suggestion: status }], question: null },
        }))];
    for (const [index, snapshot] of snapshots.entries()) {
        h.render({ ...snapshot, revision: index + 2 });
        assert.equal(disabled(h, "complete-stage"), true, JSON.stringify(snapshot.prototypeReview));
        await h.click("complete-stage");
    }
    assert.equal(h.requests.length, 0);
    h.render({ ...value, revision: 20, prototypeReview: { revisions: [{ id: "done", status: "applied", suggestion: "Done" }], question: null } });
    assert.equal(disabled(h, "complete-stage"), false);
    h.render({ ...value, revision: 21, prototypeFlow: null });
    assert.equal(hidden(h, "prototype-milestones"), true);
    assert.equal(disabled(h, "complete-stage"), false);
});

test("visual direction is optional and failed retries preserve the displayed preview", async (t) => {
    const value = readyPrototype(), h = await setup(t, value), displayed = frame(h);
    assert.equal(hidden(h, "request-prototype-visual"), false);
    const visual = { ...value, revision: 2, prototypeFlow: { ...value.prototypeFlow, visualRequested: true,
        activeCheckpointId: "visual", checkpoints: [...value.prototypeFlow.checkpoints, checkpoint("visual", "visual", "running")] } };
    h.setFetch(async () => response(visual)); await h.click("request-prototype-visual");
    assert.deepEqual(h.requests[0].body, { action: "visual", expectedRevision: 1 });
    assert.equal(disabled(h, "complete-stage"), true); assert.equal(frame(h), displayed);
    h.render({ ...visual, revision: 3, prototypeFlow: { ...visual.prototypeFlow, activeCheckpointId: null,
        checkpoints: [...value.prototypeFlow.checkpoints, checkpoint("visual", "visual", "failed", { summary: "Worker timed out" })] } });
    assert.match(text(h, "prototype-progress-message"), /Worker timed out.*preview is unchanged/);
    assert.equal(hidden(h, "retry-prototype-checkpoint"), false);
    h.setFetch(async () => response({ ...visual, revision: 4 })); await h.click("retry-prototype-checkpoint");
    assert.equal(h.requests[1].body.action, "retry");
    assert.equal(h.requests[1].body.checkpointId, "visual");
    assert.equal(frame(h), displayed);
});

test("legacy ready feedback leaves checkpoint binding to the host", async (t) => {
    const value = { ...readyPrototype(), prototypeFlow: null }, h = await setup(t, value);
    await h.input("revision-input", "Keep my selected item.");
    h.setFetch(async () => response({ ...value, revision: 2 })); await submit(h, "revision-form");
    assert.equal(Object.hasOwn(h.requests[0].body, "baseCheckpointId"), false);
    assert.equal(h.requests[0].body.suggestion, "Keep my selected item.");
});

for (const legacy of [true, false]) test(`${legacy ? "legacy" : "progressive"} failed feedback retries without inventing a checkpoint`, async (t) => {
    const value = readyPrototype(); if (legacy) value.prototypeFlow = null;
    value.prototypeReview.revisions = [{ id: "oldest-failure", suggestion: "Keep first filter", status: "failed" },
        { id: "later-failure", suggestion: "Keep second filter", status: "failed" }];
    const h = await setup(t, value), displayed = frame(h);
    assert.equal(hidden(h, "prototype-progress"), false);
    if (legacy) assert.equal(hidden(h, "prototype-milestones"), true);
    assert.equal(text(h, "retry-prototype-checkpoint"), "Retry failed revision");
    assert.equal(hidden(h, "start-prototype"), true); assert.equal(disabled(h, "complete-stage"), true);
    await h.input("revision-input", "Keep draft while retrying");
    h.setFetch(async () => response({ ...value, revision: 2, processing: { action: "submit-revision", status: "running" } }));
    await h.click("retry-prototype-checkpoint");
    assert.equal(h.requests[0].path, "/api/prototype/action");
    assert.equal(h.requests[0].body.action, "retry");
    assert.equal(Object.hasOwn(h.requests[0].body, "checkpointId"), false);
    assert.equal(h.requests[0].body.expectedRevision, 1);
    assert.equal(field(h, "revision-input").value, "Keep draft while retrying");
    assert.equal(frame(h), displayed); assert.equal(displayed.hidden, false);
    assert.equal(hidden(h, "retry-prototype-checkpoint"), true);
});

test("historically exhausted work remains visible and allows only explicit new retry without extending a cap", async (t) => {
    const value = progressivePrototype(); value.prototypeFlow.activeCheckpointId = null;
    value.prototypeFlow.checkpoints[1] = checkpoint("interaction", "interaction", "failed"); value.prototypeFlow.budget.usedSeconds = 900;
    const h = await setup(t, value), displayed = frame(h);
    assert.equal(h.document.querySelector("#extend-prototype-budget"), null);
    assert.equal(hidden(h, "retry-prototype-checkpoint"), false);
    assert.equal(current(h).prototypeFlow.budget.usedSeconds, 900);
    assert.equal(text(h, "retry-prototype-checkpoint"), "Retry Prototype");
    assert.equal(h.requests.length, 0);
    h.setFetch(async () => response({ ...value, revision: 2 }));
    await h.click("retry-prototype-checkpoint");
    assert.equal(h.requests[0].body.action, "retry");
    assert.equal(frame(h), displayed); assert.equal(disabled(h, "revision-input"), false);
});

test("failed optional visual work can be skipped without losing history, preview or drafts", async (t) => {
    const value = readyPrototype(); value.prototypeFlow.visualRequested = true;
    value.prototypeFlow.checkpoints.push(checkpoint("visual", "visual", "failed"));
    value.prototypeFlow.budget.usedSeconds = 900;
    const h = await setup(t, value), displayed = frame(h);
    assert.equal(hidden(h, "skip-prototype-visual"), false);
    assert.equal(h.get("prototype-visual-tab").querySelector(".substage-status")!.getAttribute("aria-label"), "Failed - retry available");
    assert.equal(disabled(h, "complete-stage"), true);
    await h.input("revision-input", "Keep future feedback");
    h.setFetch(async () => response({ ...value, revision: 2, prototypeFlow: { ...value.prototypeFlow, visualRequested: false } }));
    await h.click("skip-prototype-visual");
    assert.deepEqual(h.requests[0].body, { action: "skip-visual", expectedRevision: 1 });
    assert.equal(hidden(h, "skip-prototype-visual"), true);
    assert.equal(hidden(h, "retry-prototype-checkpoint"), true);
    assert.equal(h.document.querySelector("#extend-prototype-budget"), null);
    assert.equal(disabled(h, "request-prototype-visual"), false);
    assert.equal(disabled(h, "complete-stage"), false);
    assert.equal(h.get("prototype-visual-tab").querySelector(".substage-status")!.getAttribute("aria-label"), "Skipped (optional)");
    assert.equal(h.document.querySelector("#prototype-progress-message"), null);
    assert.equal(current(h).prototypeFlow.checkpoints.at(-1).status, "failed");
    assert.equal(field(h, "revision-input").value, "Keep future feedback");
    assert.equal(frame(h), displayed);
});

test("Skip visual work is unavailable before failure or during any active job", async (t) => {
    const ready = readyPrototype(), h = await setup(t, ready);
    const failed = { ...ready, prototypeFlow: { ...ready.prototypeFlow, visualRequested: true,
        checkpoints: [...ready.prototypeFlow.checkpoints, checkpoint("visual", "visual", "failed")] } };
    for (const [index, value] of [ready, { ...ready, prototypeFlow: { ...ready.prototypeFlow, visualRequested: true } },
        { ...failed, processing: { action: "submit-revision", status: "running" } },
        { ...failed, prototypeFlow: { ...failed.prototypeFlow, activeCheckpointId: "retry",
            checkpoints: [...failed.prototypeFlow.checkpoints, checkpoint("retry", "visual", "running")] } }].entries()) {
        h.render({ ...value, revision: index + 2 });
        assert.equal(hidden(h, "skip-prototype-visual"), true);
    }
    h.render({ ...failed, revision: 8, provider: { canSubmitAnswers: false } });
    assert.equal(disabled(h, "skip-prototype-visual"), true);
    await h.click("skip-prototype-visual"); assert.equal(h.requests.length, 0);
});

test("explicit promotion trusts only current iframe origin and restores bounded ephemeral state after load", async (t) => {
    const h = await setup(t, readyPrototype(1, true)), oldFrame = frame(h), messages = bridge(h);
    assert.equal(oldFrame.getAttribute("referrerpolicy"), "origin");
    h.setFetch(async () => response(readyPrototype(2)));
    await h.click("apply-prototype-update");
    const capture = messages[0];
    assert.equal(capture.data.type, "tandem:preview:capture");
    assert.equal(capture.origin, "http://127.0.0.1:9998");
    assert.equal(h.requests.length, 0);
    const data = { type: "tandem:preview:state", requestId: capture.data.requestId, prototypeId: "fixture",
        state: { route: "/items/7", scroll: { x: 0, y: 400 }, fields: { search: "private draft" } } };
    for (const invalid of [
        { source: h.window, origin: capture.origin, data },
        { source: oldFrame.contentWindow, origin: "http://127.0.0.1:1234", data },
        { source: oldFrame.contentWindow, origin: capture.origin, data: { ...data, requestId: "stale" } },
        { source: oldFrame.contentWindow, origin: capture.origin, data: { ...data, prototypeId: "another-effort" } },
        { source: oldFrame.contentWindow, origin: capture.origin, data: { ...data, state: "x".repeat(65 * 1024) } },
    ]) h.window.dispatchEvent(new h.window.MessageEvent("message", invalid));
    await h.flush();
    assert.equal(h.requests.length, 0);
    await message(h, { source: oldFrame.contentWindow, origin: capture.origin, data });
    assert.equal(h.requests[0].body.action, "apply-update");
    assert.equal(h.requests[0].body.checkpointId, "interaction");
    assert.equal(h.requests[0].body.expectedRevision, 1);
    assert.equal(JSON.stringify(h.requests).includes("private draft"), false);
    assert.notEqual(frame(h), oldFrame);
    assert.equal(frame(h).src, readyPrototype().previewUrl);
    const restores = bridge(h);
    assert.equal(restores.length, 0);
    await h.fire(frame(h), "load");
    assert.equal(restores[0].origin, "http://127.0.0.1:9999");
    assert.equal(restores[0].data.type, "tandem:preview:restore");
    assert.equal(restores[0].data.prototypeId, "fixture");
    assert.deepEqual(JSON.parse(JSON.stringify(restores[0].data.state)), data.state);
    const promoted = frame(h);
    h.render(readyPrototype(3)); await h.fire(frame(h), "load");
    assert.equal(frame(h), promoted); assert.equal(restores.length, 1);
});

test("unsupported and oversized UTF-8 preview responses cannot block explicit promotion", async (t) => {
    const h = await setup(t, readyPrototype(1, true)), messages = bridge(h);
    h.setFetch(async () => response(readyPrototype(2)));
    await h.click("apply-prototype-update"); await reply(h, messages[0], "😀".repeat(20 * 1024));
    await new Promise((resolve) => setTimeout(resolve, 400)); await h.flush();
    assert.equal(h.requests.length, 1);
    const restores = bridge(h); await h.fire(frame(h), "load");
    assert.equal(restores.length, 0);
    assert.equal(frame(h).src, readyPrototype().previewUrl);
    assert.equal(disabled(h, "complete-stage"), false);
});

test("changed candidates are rejected during capture without mutation or preview replacement", async (t) => {
    const h = await setup(t, readyPrototype(1, true)), displayed = frame(h);
    const changed = readyPrototype(2, true);
    changed.prototypeFlow.checkpoints.push(checkpoint("new-interaction", "interaction")); changed.prototypeFlow.pendingCheckpointId = "new-interaction";
    const messages = bridge(h, displayed, () => h.render(changed));
    await h.click("apply-prototype-update");
    await reply(h, messages[0], { scroll: 20 });
    assert.equal(h.requests.length, 0); assert.equal(frame(h), displayed);
    assert.match(text(h, "prototype-action-status"), /update changed/);
    h.render({ ...changed, revision: 3 });
    assert.match(text(h, "prototype-action-status"), /update changed/);
});

test("rejected promotions retain preview, discard captured state and permit retry", async (t) => {
    const h = await setup(t, readyPrototype(1, true)), displayed = frame(h), messages = bridge(h);
    h.setFetch(async () => response({ error: "Stale pending checkpoint; review new update" }, 409));
    await h.click("apply-prototype-update"); await reply(h, messages[0], { field: "ephemeral" });
    await waitFor(h, () => !disabled(h, "apply-prototype-update"));
    assert.equal(frame(h), displayed); assert.equal(disabled(h, "apply-prototype-update"), false);
    assert.match(text(h, "prototype-action-status"), /Stale pending checkpoint/);
    h.render(readyPrototype(2)); const restores = bridge(h); await h.fire(frame(h), "load");
    assert.equal(restores.length, 0);
});

test("same-URL checkpoints reload only after explicit promotion and can restore null state", async (t) => {
    const value = readyPrototype(1, true); value.prototypeFlow.checkpoints[1].previewUrl = value.previewUrl;
    const h = await setup(t, value), displayed = frame(h), messages = bridge(h);
    h.setFetch(async () => response({ ...value, revision: 2, prototypeFlow: { ...value.prototypeFlow,
        displayedCheckpointId: "interaction", pendingCheckpointId: null } }));
    await h.click("apply-prototype-update");
    assert.equal(frame(h), displayed);
    const oldUrl = displayed.src; await reply(h, messages[0], null);
    assert.notEqual(frame(h), displayed); assert.equal(frame(h).src, oldUrl);
    const restores = bridge(h); await h.fire(frame(h), "load");
    assert.equal(restores[0].data.state, null);
});

test("not-applicable prototypes never expose start, finish or reopen mutations", async (t) => {
    const value = state("development"); value.prototypeApproach = { mode: "not-applicable", reason: "Command-line app" };
    value.lifecycle.skippedStages = [{ stageId: "prototype", reason: "Command-line app", skippedAt: value.updatedAt }];
    value.previewStatus = "ready"; value.previewUrl = "http://127.0.0.1:9999/stale";
    value.artifacts = [{ id: "old-preview", title: "Old preview", stage: "prototype", content: "Old output", mermaid: "" }];
    const h = await setup(t, value);
    assert.equal(disabled(h, "live-preview-tab"), true); assert.equal(hidden(h, "start-prototype"), true);
    assert.equal(frame(h).hidden, true); assert.match(text(h, "preview-empty-message"), /Command-line app/);
    const skipped = h.get("project-contents").querySelector<HTMLButtonElement>('[data-stage-id="prototype"]')!;
    assert.equal(skipped.disabled, true); assert.match(skipped.getAttribute("aria-label")!, /not applicable/);
    await h.click(h.get("artifact-list").querySelector("button")!); assert.equal(hidden(h, "reopen-stage"), true);
    h.render({ ...value, revision: 2, lifecycle: { ...value.lifecycle, currentStage: "prototype" } });
    const finish = h.document.querySelector<HTMLButtonElement>("#complete-stage");
    assert.ok(!finish || finish.disabled);
    if (finish) await h.click(finish);
    assert.equal(h.requests.filter(request => request.path !== "/api/development/open").length, 0);
});

test("validate-existing uses the safe start route without claiming to replace the app", async (t) => {
    const value = state("prototype"); value.prototypeApproach = { mode: "validate-existing", reason: "App already exists" };
    const h = await setup(t, value);
    assert.equal(text(h, "start-prototype"), "Validate existing prototype");
    assert.match(text(h, "preview-empty-message"), /without replacing/);
    h.setFetch(async () => response({ ...value, revision: 2, previewStatus: "starting",
        processing: { action: "build-prototype", status: "running", message: "Checking existing app" } }));
    await h.click("start-prototype");
    assert.equal(h.requests[0].path, "/api/prototype/start"); assert.deepEqual(h.requests[0].body, {});
    assert.equal(text(h, "prototype-building-title"), "Validating existing prototype");
    assert.equal(text(h, "prototype-building-message"), "Checking existing app");
    h.render({ ...value, revision: 3, previewStatus: "error" });
    assert.equal(text(h, "start-prototype"), "Retry existing prototype validation");
    h.render({ ...value, revision: 4, prototypeApproach: { mode: "undecided", reason: "" } });
    assert.equal(disabled(h, "start-prototype"), true); await h.click("start-prototype");
    assert.equal(h.requests.length, 1);
});
