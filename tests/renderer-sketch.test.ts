import assert from "node:assert/strict";
import { test } from "node:test";
import { reactHarness, state, decision, response, sketchFixture, sketchSetup, createScreen, addUi, createDocument,
    text, field, disabled, hidden, current, submit, browse, waitFor, type Harness } from "./renderer-fixtures.test.js";

const components = (h: Harness) => h.get("sketch-board").querySelector(".dsl-view")?.shadowRoot
    ?.querySelectorAll("[data-ui-id]:not([data-type=Screen])") ?? [];

test("Sketch is first-class after Requirements, loads separately, and never auto-generates", async (t) => {
    const h = await reactHarness(t);
    h.render(state());
    assert.equal(disabled(h, "sketch-tab"), true);
    assert.equal(h.requests.length, 0);
    const { value, document } = sketchFixture(2);
    let release!: (result: Response) => void;
    h.setFetch(() => new Promise((resolve) => { release = resolve; }));
    h.render(value);
    await h.flush();
    assert.equal(disabled(h, "sketch-tab"), false);
    assert.equal(hidden(h, "sketch-panel"), false);
    assert.equal(text(h, "current-stage-index"), "3");
    assert.equal(disabled(h, "sketch-approve"), true);
    assert.equal(disabled(h, "complete-stage"), true);
    assert.match(text(h, "sketch-status"), /Loading/);
    assert.equal(h.requests[0].path, "/api/sketch");
    release(response({ sketch: value.sketch, document }));
    await h.flush();
    assert.equal(components(h).length, 1);
    assert.equal(disabled(h, "sketch-approve"), false);
    assert.equal(disabled(h, "complete-stage"), true);
    assert.equal(hidden(h, "complete-stage"), true, "Unapproved designs must not show a duplicate Finish action.");
    assert.match(text(h, "next-action-guide"), /Approve designs/);
    assert.match(text(h, "sketch-history"), /Revision 2.*generated.*current/);
    assert.equal(h.requests.length, 1);
    assert.deepEqual(h.errors, []);
});

test("Designs naming covers actions, accessible copy and activity without renaming saved IDs or user history", async t => {
    const { h, value } = await sketchSetup(t);
    const assertNames = () => {
        const root = h.get("studio-workspace");
        const copy = [root.textContent, ...Array.from(root.querySelectorAll("[aria-label], [title], [placeholder], [data-status-help]"))
            .flatMap(element => ["aria-label", "title", "placeholder", "data-status-help"].map(name => element.getAttribute(name)))]
            .filter(Boolean).join("\n");
        assert.doesNotMatch(copy, /\bdrawings?\b/i, "Feature names must use Designs, including screen-reader and tooltip copy.");
    };
    assertNames();
    assert.equal(h.get("sketch-generate").getAttribute("aria-label"), "Regenerate designs");
    assert.equal(h.get("sketch-save").getAttribute("aria-label"), "Save designs");
    assert.equal(text(h, "sketch-approve"), "Approve designs and continue");
    assert.equal(field(h, "sketch-instruction").placeholder, "Describe a design change... (Enter to send)");
    assert.ok(h.get("sketch-revise-form").classList.contains("feedback-composer"));
    assert.equal(h.get("sketch-revise-form").lastElementChild, h.get("sketch-history-toggle"));
    await h.click("sketch-history-toggle");
    assert.equal(h.get("sketch-request-history-pane").getAttribute("aria-label"), "Design request history");
    await h.fire(h.get("sketch-request-history-pane"), "keydown", { key: "Escape" });
    assert.equal(h.get("sketch-request-history-pane").hidden, true);
    assert.equal(h.document.activeElement, h.get("sketch-history-toggle"));
    h.render({ ...value, revision: value.revision + 1, processing: {
        action: "generate-sketch", status: "running", requestId: "design-name-request", runId: "design-name-run",
        requestedAt: new Date().toISOString(),
    } });
    await h.flush();
    assert.match(text(h, "workflow-activity-title"), /Updating designs/);
    assertNames();
    const instruction = "Keep the original drawings as a reference.";
    const original = { requestId: "legacy-drawing-request", kind: "revise" as const, instruction,
        requestedAt: value.updatedAt, baseRevisionId: value.sketch.current!.id };
    h.render({ ...value, revision: value.revision + 2, sketch: { ...value.sketch, requests: [original] } });
    await h.flush();
    assert.ok(h.get("project-conversation").textContent!.includes(instruction), "User-authored historical text is not relabeled.");
    assert.deepEqual(current(h).sketch.requests, [original]);
    assert.equal(current(h).sketch.current!.id, "drawing-1");
    assert.ok(h.requests.every(request => request.path === "/api/sketch" && request.body === null), "Renaming copy performs no mutations.");
});

test("design approval status appears only in the bottom status bar for the viewed, unchanged designs", async t => {
    for (const [fidelity, message] of [["wireframe", "Layout and navigation approved"], ["styled", "Saved designs approved"]] as const) {
        await t.test(fidelity, async t => {
            const fixture = sketchFixture();
            fixture.document.fidelity = fidelity;
            fixture.value.sketch.status = "approved";
            fixture.value.sketch.approved = {
                revisionId: fixture.value.sketch.current.id,
                documentHash: fixture.value.sketch.current.documentHash,
                requirementsDigest: fixture.value.sketch.current.requirementsDigest,
            };
            const { h, value } = await sketchSetup(t, fixture);
            assert.equal(h.document.getElementById("sketch-focus"), null);
            assert.equal(h.document.querySelector(".sketch-approval-actions [role=status]"), null);
            assert.equal(text(h, "next-action-guide"), message);
            assert.equal(h.get("next-action-guide").title, message);
            assert.equal(hidden(h, "show-next-action"), false, "Moving the status must retain the next-action shortcut.");
            await h.fire(h.get("sketch-generate"), "pointerover");
            assert.equal(text(h, "next-action-guide"), "Regenerate designs");
            await h.fire(h.get("sketch-generate"), "pointerout");
            assert.equal(text(h, "next-action-guide"), message);
            h.store.setConnectionError("Connection interrupted.");
            await h.flush();
            assert.equal(h.get("next-action-bar").dataset.status, "error");
            assert.equal(text(h, "next-action-guide"), "Connection interrupted.");
            h.store.setConnectionError("");
            await h.flush();
            assert.equal(text(h, "next-action-guide"), message);
            await browse(h, "requirements");
            assert.notEqual(text(h, "next-action-guide"), message, "Approval status belongs only to the Designs view.");
            await browse(h, "sketch");
            assert.equal(text(h, "next-action-guide"), message);
            h.render({ ...value, revision: 2, sketch: { ...value.sketch,
                approved: { ...value.sketch.approved, documentHash: "older" } } });
            await h.flush();
            assert.notEqual(text(h, "next-action-guide"), message, "An approval must match the current saved revision.");
            h.render({ ...value, revision: 3 });
            await h.flush();
            assert.equal(text(h, "next-action-guide"), message);
            await h.input("sketch-title", "Local changes");
            assert.notEqual(text(h, "next-action-guide"), message, "Unsaved designs are not approved.");
            assert.ok(h.requests.every(request => request.path === "/api/sketch" && request.body === null));
        });
    }
});

test("Sketch retains drafts, focus and caret through SSE and tabs, with explicit conflict reload", async (t) => {
    const { h, value, document } = await sketchSetup(t);
    await h.input("sketch-title", "Local title");
    const title = field(h, "sketch-title");
    title.focus(); title.setSelectionRange(2, 5);
    h.render({ ...value, revision: 2 });
    assert.equal(title.value, "Local title");
    assert.equal(title.selectionStart, 2);
    assert.equal(h.document.activeElement, title);
    await browse(h, "requirements"); await browse(h, "sketch");
    assert.equal(field(h, "sketch-title").value, "Local title");
    const saved = { ...value.sketch, current: { ...value.sketch.current, id: "drawing-remote" } };
    h.render({ ...value, revision: 3, sketch: saved });
    assert.match(text(h, "sketch-status"), /Conflict.*local edits are retained/);
    assert.equal(disabled(h, "sketch-save"), true);
    assert.equal(disabled(h, "sketch-approve"), true);
    await h.click("sketch-reload"); await h.confirm(false);
    assert.equal(title.value, "Local title");
    h.setFetch(async () => response({ sketch: saved, document }));
    await h.click("sketch-reload"); await h.confirm();
    assert.equal(field(h, "sketch-title").value, "Screen 1");
    assert.equal(disabled(h, "sketch-save"), true);
    assert.equal(h.requests.length, 2);
});

test("incomplete Sketch fields remain editable across SSE and cannot silently approve", async (t) => {
    const { h, value } = await sketchSetup(t);
    await h.input("sketch-purpose", "");
    h.render({ ...value, revision: 2 });
    assert.equal(field(h, "sketch-purpose").value, "");
    assert.equal(field(h, "sketch-purpose").getAttribute("aria-invalid"), "true");
    assert.equal(disabled(h, "sketch-save"), true);
    await h.click("sketch-approve");
    assert.equal(h.requests.length, 1);
    await h.input("sketch-purpose", "Updated purpose");
    assert.equal(field(h, "sketch-purpose").getAttribute("aria-invalid"), "false");
    assert.equal(disabled(h, "sketch-save"), false);
    assert.equal(disabled(h, "sketch-approve"), false);
    await h.input("sketch-purpose", "");
    await h.click("sketch-undo");
    assert.equal(field(h, "sketch-purpose").value, "Updated purpose");
});

test("Sketch saves accepted mixed-case dotted DAG identities unchanged", async (t) => {
    const fixture = sketchFixture();
    fixture.value.decisionGraph.nodes = [decision("Requirement.Main_1", "answered")];
    fixture.document.screens[0].decisionIds = ["Requirement.Main_1"];
    const { h, value } = await sketchSetup(t, fixture);
    await h.input("sketch-notes", "Preserve identities");
    h.setFetch(async () => response({ ...value, revision: 2, sketch: { ...value.sketch, current: { ...value.sketch.current, id: "drawing-2" } } }));
    await h.click("sketch-save");
    assert.deepEqual(h.requests[1].body.document.screens[0].decisionIds, ["Requirement.Main_1"]);
    assert.equal(disabled(h, "sketch-save"), true);
});

test("manual Sketch screens use only accepted decisions and reject unaccepted references", async (t) => {
    const fixture = sketchFixture();
    fixture.value.decisionGraph.nodes.push(decision("proposal"), { ...decision("empty-answer", "answered"), answer: "" });
    const { h } = await sketchSetup(t, fixture);
    await h.click("sketch-add-screen");
    assert.equal(field(h, "sketch-decisions").value, "accepted");
    await h.input("sketch-decisions", "proposal");
    await h.click("sketch-save");
    assert.equal(h.requests.length, 1);
    assert.match(text(h, "sketch-message"), /outside the accepted requirements DAG/);
});

test("Sketch save errors retain edits; approving an older revision does not permit Finish", async (t) => {
    const fixture = sketchFixture();
    fixture.value.sketch.status = "approved";
    fixture.value.sketch.approved = { revisionId: "older", requirementsDigest: "requirements-digest", documentHash: "older" };
    const { h, value } = await sketchSetup(t, fixture);
    await h.input("sketch-title", "Keep this");
    h.setFetch(async () => response({ error: "The design revision changed. Reload designs." }, 409));
    await h.click("sketch-save");
    assert.equal(h.requests[1].body.expectedRevision, "drawing-1");
    assert.equal(h.requests[1].body.action, "save");
    h.render({ ...value, revision: 2 });
    assert.match(text(h, "sketch-message"), /revision changed/);
    assert.equal(field(h, "sketch-title").value, "Keep this");
    await h.click("complete-stage");
    assert.equal(h.requests.length, 2);
});

test("Sketch approval saves first, exports every canonical viewport, escapes text and continues", async (t) => {
    const fixture = sketchFixture();
    fixture.document.screens.push(createScreen(fixture.document, ["accepted"]));
    Object.assign(fixture.document.screens[1], { width: 375, height: 812 });
    addUi(fixture.document.screens[1], "label", "Text", { text: "Mobile" });
    addUi(fixture.document.screens[0], "label", "Text", { text: "<script>&unsafe" });
    const { h, value } = await sketchSetup(t, fixture);
    let server = value;
    h.enablePngExport();
    h.setFetch(async (path, options) => {
        const body = JSON.parse(String(options.body));
        if (body.action === "save") server = { ...server, revision: 2, sketch: { ...server.sketch,
            current: { ...server.sketch.current, id: "drawing-2", documentHash: "edited", source: "edited" } } };
        if (body.action === "approve") server = { ...server, revision: 3, sketch: { ...server.sketch, status: "approved",
            approved: { revisionId: "drawing-2", documentHash: "edited", requirementsDigest: "requirements-digest" } } };
        if (path === "/api/stage/complete") server = { ...server, revision: 4,
            lifecycle: { ...server.lifecycle, currentStage: "prototype", completedStages: [...server.lifecycle.completedStages, "sketch"] } };
        return response(server);
    });
    await h.input("sketch-title", "Edited"); await h.click("sketch-approve");
    assert.deepEqual(h.requests.slice(1).map((r) => [r.path, r.body.action || r.body.stageId]),
        [["/api/sketch", "save"], ["/api/sketch", "approve"], ["/api/stage/complete", "sketch"]]);
    assert.equal(h.requests[2].body.expectedRevision, "drawing-2");
    assert.equal(h.requests[2].body.previews.length, 2);
    assert.equal(h.requests[2].body.previews[0].data, "iVBORw0KGgo=");
    assert.deepEqual(h.pngExports.map(({ width, height }) => [width, height]), [[960, 640], [375, 812]]);
    const svg = decodeURIComponent(h.pngExports[0].source.split(",").slice(1).join(","));
    assert.match(svg, /&lt;script&gt;&amp;unsafe/); assert.doesNotMatch(svg, /<script>/);
    assert.equal(current(h).lifecycle.currentStage, "prototype");
});

test("blank Sketch screens save as drafts but cannot approve or complete", async (t) => {
    const fixture = sketchFixture(); fixture.document.screens[0].ui = createDocument();
    const { h, value } = await sketchSetup(t, fixture);
    h.enablePngExport();
    assert.equal(disabled(h, "sketch-approve"), true);
    assert.match(text(h, "sketch-status"), /UI components.*Empty screens can be saved/);
    await h.input("sketch-notes", "Draft layout pending");
    await h.click("sketch-approve"); assert.equal(h.requests.length, 1);
    h.setFetch(async () => response({ ...value, revision: 2 }));
    await h.click("sketch-save");
    assert.deepEqual(h.requests[1].body.document.screens[0].ui.nodes.screen.children, []);
    assert.equal(disabled(h, "sketch-approve"), true);
    assert.equal(disabled(h, "complete-stage"), true);
    assert.equal(h.pngExports.length, 0);
});

test("Sketch never claims approval when PNG export is unavailable", async (t) => {
    const { h } = await sketchSetup(t);
    h.window.HTMLCanvasElement.prototype.getContext = () => null;
    await h.click("sketch-approve");
    assert.equal(h.requests.length, 1);
    assert.match(text(h, "sketch-message"), /PNG export is unavailable.*not approved/);
    assert.equal(current(h).sketch.status, "draft");
    assert.equal(disabled(h, "complete-stage"), true);
});

test("failed Sketch continuation retains approval; Finish retries without another export", async (t) => {
    const { h, value } = await sketchSetup(t);
    let server = value, attempts = 0;
    h.enablePngExport();
    h.setFetch(async (path) => {
        if (path === "/api/sketch") server = { ...server, revision: 2, sketch: { ...server.sketch, status: "approved",
            approved: { revisionId: "drawing-1", documentHash: "document-1", requirementsDigest: "requirements-digest" } } };
        if (path === "/api/stage/complete" && ++attempts === 1) return response({ error: "Continuation failed. Retry Finish Sketch." }, 500);
        if (path === "/api/stage/complete") server = { ...server, revision: 3, lifecycle: { ...server.lifecycle, currentStage: "prototype" } };
        return response(server);
    });
    await h.click("sketch-approve");
    await waitFor(h, () => /Continuation failed/.test(text(h, "sketch-message")));
    assert.equal(current(h).sketch.status, "approved");
    assert.match(text(h, "sketch-message"), /Continuation failed/);
    assert.equal(disabled(h, "complete-stage"), false);
    assert.equal(hidden(h, "complete-stage"), false, "Retain Finish for retrying already-approved designs.");
    assert.equal(hidden(h, "sketch-approve"), true);
    await h.click("complete-stage");
    assert.equal(current(h).lifecycle.currentStage, "prototype");
    assert.equal(h.pngExports.length, 1);
    assert.equal(h.requests.filter((r) => r.body?.action === "approve").length, 1);
});

test("Sketch gates provider ownership, historical stages, workers, stale requirements and skips", async (t) => {
    const { h, value } = await sketchSetup(t);
    h.render({ ...value, revision: 2, provider: { source: "session", canSubmitAnswers: false } });
    assert.match(text(h, "sketch-status"), /session that owns this effort/);
    await h.click("sketch-approve"); await h.click("sketch-add-screen");
    assert.equal(h.requests.length, 1);
    h.render({ ...value, revision: 3, lifecycle: { ...value.lifecycle, currentStage: "prototype" } });
    assert.equal(hidden(h, "sketch-approve"), true, "The Designs approval does not appear in another stage's header.");
    await browse(h, "sketch");
    assert.equal(disabled(h, "sketch-approve"), true);
    assert.match(text(h, "sketch-status"), /Read only/);
    h.render({ ...value, revision: 4, processing: { action: "revise-sketch", status: "running", message: "Designing new screens" } });
    assert.equal(disabled(h, "sketch-approve"), true);
    assert.equal(hidden(h, "next-action-bar"), false, "The footer remains available for worker status.");
    assert.equal(hidden(h, "show-next-action"), true);
    await h.click("show-next-action");
    assert.equal(h.requests.length, 1, "Running work must not dispatch through next-action navigation.");
    assert.match(text(h, "sketch-status"), /Designing new screens/);
    h.render({ ...value, revision: 5, sketch: { ...value.sketch, status: "stale" } });
    assert.equal(disabled(h, "sketch-generate"), false);
    assert.match(text(h, "sketch-status"), /Stale.*requirements changed/);
    h.render({ ...value, revision: 6, lifecycle: { ...value.lifecycle, skippedStages: [{ stageId: "sketch", reason: "Legacy effort" }] } });
    assert.equal(disabled(h, "sketch-tab"), true);
    assert.match(h.get("sketch-tab").title, /Legacy/);
    assert.equal(disabled(h, "complete-stage"), true);
});

test("Sketch generation is explicit; revisions retain instructions and block duplicates", async (t) => {
    const { h, value } = await sketchSetup(t);
    await h.click("sketch-generate"); await h.confirm(false);
    assert.equal(h.requests.length, 1);
    h.setFetch(async () => response({ ...value, revision: 2, processing: { action: "generate-sketch", status: "running" } }));
    await h.click("sketch-generate"); await h.confirm();
    assert.deepEqual(h.requests[1].body, { action: "generate", expectedRevision: "drawing-1" });
    h.render({ ...value, revision: 3, processing: { action: "generate-sketch", status: "error", message: "Design worker failed" } });
    assert.match(text(h, "sketch-message"), /Design worker failed/);
    await h.input("sketch-instruction", "Move navigation left");
    let release!: (r: Response) => void;
    h.setFetch(() => new Promise((resolve) => { release = resolve; }));
    await submit(h, "sketch-revise-form");
    await submit(h, "sketch-revise-form"); await h.click("sketch-approve");
    assert.equal(h.requests.length, 3);
    assert.deepEqual(h.requests[2].body, { action: "revise", expectedRevision: "drawing-1", instruction: "Move navigation left",
        clientRequestId: h.requests[2].body.clientRequestId,
        sketchContext: { revisionId: "drawing-1", screenId: "screen-1", nodeId: null } });
    assert.match(h.requests[2].body.clientRequestId, /^[a-f0-9-]{36}$/);
    release(response({ error: "Cannot start revision." }, 500));
    await waitFor(h, () => /Cannot start revision/.test(text(h, "sketch-message")));
    assert.equal(field(h, "sketch-instruction").value, "Move navigation left");
    assert.match(text(h, "sketch-message"), /Cannot start revision/);
});

test("failed Sketch revisions retry persisted instruction and retain new unsent instructions", async (t) => {
    const fixture = sketchFixture();
    fixture.value.processing = { action: "revise-sketch", status: "error", answer: "Move navigation left", message: "Worker failed" };
    const { h, value } = await sketchSetup(t, fixture);
    await h.input("sketch-instruction", "A different unsent instruction");
    assert.equal(hidden(h, "sketch-failed-revision"), false);
    assert.match(text(h, "sketch-failed-instruction"), /Move navigation left/);
    assert.match(text(h, "next-action-guide"), /Retry the failed design revision/);
    assert.equal(hidden(h, "sketch-request-history-pane"), true);
    await h.click("show-next-action");
    await new Promise((resolve) => h.window.requestAnimationFrame(resolve)); await h.flush();
    assert.equal(hidden(h, "sketch-request-history-pane"), false);
    assert.equal(h.document.activeElement, h.get("sketch-retry-revision"));
    assert.equal(h.requests.length, 1, "Guidance only reveals/focuses the retry; it does not resubmit.");
    assert.equal(field(h, "sketch-instruction").value, "A different unsent instruction");
    await h.click("show-next-action");
    assert.equal(hidden(h, "sketch-request-history-pane"), false, "Repeated navigation does not collapse the target.");
    assert.equal(h.requests.length, 1);
    let release!: (r: Response) => void;
    h.setFetch(() => new Promise((resolve) => { release = resolve; }));
    await h.click("sketch-retry-revision"); await h.click("sketch-retry-revision");
    assert.equal(h.requests.length, 2);
    assert.deepEqual(h.requests[1].body, { action: "revise", expectedRevision: "drawing-1", instruction: "Move navigation left",
        clientRequestId: h.requests[1].body.clientRequestId,
        sketchContext: { revisionId: "drawing-1", screenId: "screen-1", nodeId: null } });
    assert.match(h.requests[1].body.clientRequestId, /^[a-f0-9-]{36}$/);
    release(response({ ...value, revision: 2, processing: { ...value.processing, status: "running" } })); await h.flush();
    assert.equal(field(h, "sketch-instruction").value, "A different unsent instruction");
    assert.equal(hidden(h, "sketch-failed-revision"), true);
    assert.equal(components(h).length, 1);
});

test("Sketch retry retains its failed instruction after transport errors and unrelated SSE", async (t) => {
    const fixture = sketchFixture();
    fixture.value.processing = { action: "revise-sketch", status: "error", answer: "Keep exact instruction", message: "Worker failed" };
    const { h, value } = await sketchSetup(t, fixture);
    h.setFetch(async () => response({ error: "Retry transport unavailable" }, 503));
    await h.click("sketch-retry-revision");
    h.render({ ...value, revision: 2 });
    assert.match(text(h, "sketch-message"), /Retry transport unavailable/);
    assert.match(text(h, "sketch-failed-instruction"), /Keep exact instruction/);
    await h.click("sketch-retry-revision");
    assert.equal(h.requests[2].body.instruction, h.requests[1].body.instruction);
    assert.equal(components(h).length, 1);
});

test("Sketch retry captures failed instructions before saving edits clears worker state", async (t) => {
    const fixture = sketchFixture();
    fixture.value.processing = { action: "revise-sketch", status: "error", answer: "Move navigation left", message: "Worker failed" };
    const { h, value } = await sketchSetup(t, fixture);
    let server = value;
    h.setFetch(async (_path, options) => {
        const body = JSON.parse(String(options.body));
        server = body.action === "save" ? { ...server, revision: 2, processing: null,
            sketch: { ...server.sketch, current: { ...server.sketch.current, id: "drawing-edited" } } }
            : { ...server, revision: 3, processing: { action: "revise-sketch", status: "running", answer: body.instruction } };
        return response(server);
    });
    await h.input("sketch-notes", "Preserve this local edit before retrying");
    await h.input("sketch-instruction", "A different later request");
    await h.click("sketch-retry-revision");
    assert.deepEqual(h.requests.slice(1).map((r) => r.body.action), ["save", "revise"]);
    assert.equal(h.requests[1].body.document.screens[0].notes, "Preserve this local edit before retrying");
    assert.equal(h.requests[2].body.expectedRevision, "drawing-edited");
    assert.equal(h.requests[2].body.instruction, "Move navigation left");
    assert.equal(field(h, "sketch-instruction").value, "A different later request");
    assert.equal(disabled(h, "sketch-save"), true);
});



test("Sketch clean DSL revisions refresh and no-GUI approaches skip designs", async (t) => {
    const { h, value, document } = await sketchSetup(t);
    assert.equal(disabled(h, "sketch-approve"), false);
    assert.equal(disabled(h, "sketch-save"), true);
    const saved = { ...value.sketch, current: { ...value.sketch.current, id: "updated" } };
    document.screens[0].title = "Remote title";
    h.setFetch(async () => response({ sketch: saved, document }));
    h.render({ ...value, revision: 2, sketch: saved }); await h.flush();
    assert.equal(field(h, "sketch-title").value, "Remote title");
    h.render({ ...value, revision: 3, prototypeApproach: { mode: "not-applicable", reason: "Command-line workflow" } });
    assert.equal(disabled(h, "sketch-tab"), true);
    assert.equal(disabled(h, "live-preview-tab"), true);
    assert.match(h.get("sketch-tab").title, /Command-line workflow/);
    assert.equal(h.requests.length, 2);
});

test("Sketch document errors stay visible until explicit reload", async (t) => {
    const h = await reactHarness(t);
    const { value, document } = sketchFixture();
    h.setFetch(async () => response({ error: "Design storage unavailable" }, 500));
    h.render(value); await h.flush();
    assert.match(text(h, "sketch-message"), /Design storage unavailable/);
    h.render({ ...value, revision: 2 }); await h.flush();
    assert.equal(h.requests.length, 1);
    assert.equal(disabled(h, "sketch-approve"), true);
    h.setFetch(async () => response({ sketch: value.sketch, document }));
    await h.click("sketch-reload");
    assert.equal(disabled(h, "sketch-approve"), false);
    assert.equal(h.requests.length, 2);
});
