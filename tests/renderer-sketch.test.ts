import assert from "node:assert/strict";
import { test } from "node:test";
import { reactHarness, state, decision, response, sketchFixture, sketchSetup, createScreen, createShape,
    text, field, disabled, hidden, current, submit, browse, waitFor, type Harness } from "./renderer-fixtures.test.js";

const shapes = (h: Harness) => h.get("sketch-board").querySelectorAll("[data-shape-id]");
const rect = (h: Harness) => shapes(h)[0].querySelector("rect")!;
const selectShape = (h: Harness, index: number) => h.click(h.get("sketch-shapes").querySelectorAll("button")[index]);

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
    assert.equal(shapes(h).length, 1);
    assert.equal(disabled(h, "sketch-approve"), false);
    assert.equal(disabled(h, "complete-stage"), true);
    assert.equal(hidden(h, "complete-stage"), true, "Unapproved drawings must not show a duplicate Finish action.");
    assert.match(text(h, "next-action-guide"), /Approve drawings/);
    assert.match(text(h, "sketch-history"), /Revision 2.*generated.*current/);
    assert.equal(h.requests.length, 1);
    assert.deepEqual(h.errors, []);
});

test("Sketch manual screens, every shape tool, inspector, transitions and undo redo serialize correctly", async (t) => {
    const fixture = sketchFixture();
    fixture.value.sketch.current = null;
    fixture.value.sketch.status = "empty";
    fixture.document.screens = [];
    const { h, value } = await sketchSetup(t, fixture);
    await h.click("sketch-add-screen");
    assert.equal(h.get("sketch-screens").querySelectorAll("button").length, 1);
    for (const kind of ["rectangle", "ellipse", "text", "line", "arrow"]) await h.click("sketch-add-" + kind);
    assert.equal(shapes(h).length, 5);
    await selectShape(h, 2);
    await h.input("sketch-text", "Go next");
    assert.equal(shapes(h)[2].querySelector("text")!.textContent, "Go next");
    await selectShape(h, 4);
    await h.input("sketch-x", "10000");
    assert.equal(Number(shapes(h)[4].querySelector("line")!.getAttribute("x2")), 960);
    await h.click("sketch-undo");
    assert.equal(field(h, "sketch-x").value, "40");
    await h.click("sketch-redo");
    for (const [name, value] of [["title", "Home"], ["purpose", "Overview"], ["notes", "Keep it compact"]]) {
        await h.input("sketch-" + name, value);
    }
    await h.click("sketch-add-screen");
    await h.click("sketch-add-transition");
    await h.input(h.get("sketch-transitions").querySelector("input")!, "Open home");
    assert.equal(disabled(h, "sketch-save"), false);
    assert.equal(disabled(h, "sketch-generate"), true);
    h.setFetch(async () => response({ ...value, revision: 2 }));
    await h.click("sketch-save");
    const document = h.requests.at(-1)!.body.document;
    assert.equal(document.screens[0].title, "Home");
    assert.equal(document.screens[0].purpose, "Overview");
    assert.equal(document.screens[0].notes, "Keep it compact");
    assert.deepEqual(document.screens[0].shapes.map((shape: any) => shape.kind), ["rectangle", "ellipse", "text", "line", "arrow"]);
    assert.equal(document.transitions[0].trigger, "Open home");
    assert.equal(document.transitions[0].fromScreenId, "screen-2");
    assert.equal(document.transitions[0].toScreenId, "screen-1");
});

test("Sketch drag, keyboard nudging, bounded freehand and grouped undo use actual pointer events", async (t) => {
    const { h } = await sketchSetup(t);
    const board = h.get("sketch-board");
    await h.fire(shapes(h)[0], "pointerdown", { pointerId: 1, button: 0, clientX: 50, clientY: 50 });
    await h.fire(board, "pointermove", { pointerId: 1, clientX: 70, clientY: 80 });
    await h.fire(board, "pointerup", { pointerId: 1, clientX: 70, clientY: 80 });
    assert.equal(rect(h).getAttribute("x"), "60");
    assert.equal(rect(h).getAttribute("y"), "70");
    await h.fire(board, "keydown", { key: "ArrowRight", shiftKey: true });
    assert.equal(rect(h).getAttribute("x"), "70");
    await h.fire(board, "keydown", { key: "z", ctrlKey: true });
    assert.equal(rect(h).getAttribute("x"), "60");
    await h.click("sketch-freehand");
    await h.fire(board, "pointerdown", { pointerId: 2, button: 0, clientX: 10, clientY: 10 });
    await h.fire(board, "pointermove", { pointerId: 2, clientX: 25, clientY: 25 });
    await h.fire(board, "pointerup", { pointerId: 2, clientX: 10000, clientY: 10000 });
    assert.match(shapes(h)[1].querySelector("path")!.getAttribute("d")!, /960 640$/);
    await h.click("sketch-undo");
    assert.equal(shapes(h).length, 1);
    await h.fire(board, "keydown", { key: "Escape" });
    assert.equal(h.get("sketch-freehand").getAttribute("aria-pressed"), "false");
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
    h.setFetch(async () => response({ error: "The drawing revision changed. Reload drawings." }, 409));
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
    fixture.document.screens[1].shapes.push(createShape(fixture.document.screens[1], "text"));
    fixture.document.screens[0].shapes.push({ ...createShape(fixture.document.screens[0], "text"), text: "<script>&unsafe" });
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
    const fixture = sketchFixture(); fixture.document.screens[0].shapes = [];
    const { h, value } = await sketchSetup(t, fixture);
    h.enablePngExport();
    assert.equal(disabled(h, "sketch-approve"), true);
    assert.match(text(h, "sketch-status"), /at least one shape.*Empty screens can be saved/);
    await h.input("sketch-notes", "Draft layout pending");
    await h.click("sketch-approve"); assert.equal(h.requests.length, 1);
    h.setFetch(async () => response({ ...value, revision: 2 }));
    await h.click("sketch-save");
    assert.equal(h.requests[1].body.document.screens[0].shapes.length, 0);
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
    assert.equal(hidden(h, "complete-stage"), false, "Retain Finish for retrying already-approved drawings.");
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
    assert.equal(disabled(h, "sketch-approve"), true);
    assert.match(text(h, "sketch-status"), /Read only/);
    h.render({ ...value, revision: 4, processing: { action: "revise-sketch", status: "running", message: "Drawing new screens" } });
    assert.equal(disabled(h, "sketch-approve"), true);
    assert.equal(hidden(h, "next-action-bar"), false, "The footer remains available for worker status.");
    assert.equal(hidden(h, "show-next-action"), true);
    await h.click("show-next-action");
    assert.equal(h.requests.length, 1, "Running work must not dispatch through next-action navigation.");
    assert.match(text(h, "sketch-status"), /Drawing new screens/);
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
    h.render({ ...value, revision: 3, processing: { action: "generate-sketch", status: "error", message: "Drawing worker failed" } });
    assert.match(text(h, "sketch-message"), /Drawing worker failed/);
    await h.input("sketch-instruction", "Move navigation left");
    let release!: (r: Response) => void;
    h.setFetch(() => new Promise((resolve) => { release = resolve; }));
    await submit(h, "sketch-revise-form");
    await submit(h, "sketch-revise-form"); await h.click("sketch-approve");
    assert.equal(h.requests.length, 3);
    assert.deepEqual(h.requests[2].body, { action: "revise", expectedRevision: "drawing-1", instruction: "Move navigation left" });
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
    assert.match(text(h, "next-action-guide"), /Retry the failed drawing revision/);
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
    assert.deepEqual(h.requests[1].body, { action: "revise", expectedRevision: "drawing-1", instruction: "Move navigation left" });
    release(response({ ...value, revision: 2, processing: { ...value.processing, status: "running" } })); await h.flush();
    assert.equal(field(h, "sketch-instruction").value, "A different unsent instruction");
    assert.equal(hidden(h, "sketch-failed-revision"), true);
    assert.equal(shapes(h).length, 1);
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
    assert.equal(shapes(h).length, 1);
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

test("remote Sketch revisions cannot overwrite or rebase an active pointer gesture", async (t) => {
    const { h, value } = await sketchSetup(t);
    await h.fire(shapes(h)[0], "pointerdown", { pointerId: 1, button: 0, clientX: 50, clientY: 50 });
    h.render({ ...value, revision: 2, sketch: { ...value.sketch, current: { ...value.sketch.current, id: "remote" } } });
    assert.equal(h.requests.length, 1);
    assert.match(text(h, "sketch-status"), /Conflict/);
    await h.fire(h.get("sketch-board"), "pointerup", { pointerId: 1, clientX: 70, clientY: 80 });
    assert.equal(rect(h).getAttribute("x"), "60");
    assert.equal(disabled(h, "sketch-save"), true);
    assert.equal(disabled(h, "sketch-approve"), true);
});

test("Sketch clean revisions refresh, gestures cancel safely, and no-GUI approaches skip drawings", async (t) => {
    const { h, value, document } = await sketchSetup(t);
    await h.fire(shapes(h)[0], "pointerdown", { pointerId: 1, button: 0, clientX: 50, clientY: 50 });
    assert.equal(disabled(h, "sketch-approve"), true);
    await h.fire(h.get("sketch-board"), "pointercancel", { pointerId: 1 });
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
    h.setFetch(async () => response({ error: "Drawing storage unavailable" }, 500));
    h.render(value); await h.flush();
    assert.match(text(h, "sketch-message"), /Drawing storage unavailable/);
    h.render({ ...value, revision: 2 }); await h.flush();
    assert.equal(h.requests.length, 1);
    assert.equal(disabled(h, "sketch-approve"), true);
    h.setFetch(async () => response({ sketch: value.sketch, document }));
    await h.click("sketch-reload");
    assert.equal(disabled(h, "sketch-approve"), false);
    assert.equal(h.requests.length, 2);
});
