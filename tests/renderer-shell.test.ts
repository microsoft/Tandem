import assert from "node:assert/strict";
import { test } from "node:test";
import { setup, state, blankEffort, decision, response, text, field, disabled, hidden, current, submit, browse } from "./renderer-fixtures.test.js";

test("compact workflow exposes progress and labeled stage icons without changing navigation", async (t) => {
    const value = state("plan");
    value.lifecycle.completedStages = value.lifecycle.completedStages.filter((id: string) => id !== "sketch");
    value.lifecycle.skippedStages = [{ stageId: "sketch", reason: "Existing drawings were supplied." }];
    const h = await setup(t, value);
    const progress = h.document.querySelector('[role="progressbar"][aria-label="Lifecycle progress"]')!;
    assert.equal(progress.getAttribute("aria-valuenow"), "5");
    assert.equal(progress.getAttribute("aria-valuemax"), "8");
    assert.equal(progress.getAttribute("aria-valuetext"), "4 complete, 1 skipped, 3 remaining");
    assert.equal(progress.querySelectorAll('[data-status="complete"]').length, 4);
    assert.equal(progress.querySelectorAll('[data-status="skipped"]').length, 1);
    for (const button of h.document.querySelectorAll<HTMLButtonElement>(".stage-step")) {
        assert.ok(button.getAttribute("aria-label"), "Icon navigation retains the stage name and status");
        assert.ok(button.querySelector("svg")?.closest('[aria-hidden="true"]'), "Stage icons are decorative");
    }
    const skipped = h.document.querySelector<HTMLButtonElement>('[data-stage-id="sketch"]')!;
    assert.equal(skipped.disabled, true);
    assert.match(skipped.getAttribute("aria-label")!, /not applicable.*Existing drawings/);
    await browse(h, "requirements");
    assert.equal(hidden(h, "design-tree-panel"), false);
    assert.equal(current(h).lifecycle.currentStage, "plan");
    assert.equal(h.requests.length, 0);
});

test("artifact rows retain full metadata and distinguish stale records with icons", async (t) => {
    const value = state("design");
    value.artifacts = [{
        id: "design-spec", stage: "design", kind: "design-spec", title: "An intentionally long product specification title",
        path: "records/design/specification.md", reviewStatus: "stale", content: "Existing specification",
    }];
    const h = await setup(t, value);
    const button = h.document.querySelector<HTMLButtonElement>('[data-artifact-id="design-spec"]')!;
    assert.equal(button.dataset.stale, "true");
    assert.match(button.title, /An intentionally long.*records\/design\/specification\.md.*stale/);
    assert.ok(button.querySelector('svg[aria-hidden="true"]'));
    await h.click(button);
    assert.equal(hidden(h, "content-panel"), false);
    assert.equal(text(h, "artifact-content"), "Existing specification");
    assert.equal(h.requests.length, 0);
});

test("confirmation actions keep visible names alongside decorative icons", async (t) => {
    const h = await setup(t);
    await h.click("reset-effort");
    const buttons = h.document.querySelectorAll('[role="alertdialog"] button');
    assert.deepEqual(Array.from(buttons, (button) => button.textContent), ["Cancel", "Confirm"]);
    for (const button of buttons) assert.ok(button.querySelector('svg[aria-hidden="true"]'));
    await h.confirm(false);
    assert.equal(h.requests.length, 0);
});

test("header suppresses reload success text and places version after Reset", async (t) => {
    const value = { ...state(), provider: { canSubmitAnswers: true, canReload: true },
        reloadReceipt: { status: "success", message: "Reloaded latest extension." } };
    const h = await setup(t, value);
    assert.equal(text(h, "reload-status"), "");
    assert.equal(text(h, "reload-extension"), "Reload");
    assert.equal(disabled(h, "reload-extension"), false);
    const actions = h.document.querySelector(".topbar-actions")!;
    assert.equal(actions.lastElementChild!.className, "build-version");
    assert.equal(actions.lastElementChild!.previousElementSibling, h.get("reset-effort"));
    h.render({ ...value, revision: 2, reloadReceipt: { status: "error", message: "Could not reload extension." } });
    assert.equal(text(h, "reload-status"), "Could not reload extension.");
    assert.equal(h.get("reload-status").dataset.status, "error");
});

test("React panels have unique IDs and Radix navigation skips locked tabs", async (t) => {
    const h = await setup(t, state("plan"));
    const ids = Array.from(h.document.querySelectorAll("[id]")).map((node) => node.id);
    assert.equal(new Set(ids).size, ids.length, "No duplicate component or tabpanel IDs");
    for (const tab of h.document.querySelectorAll('[role="tab"]')) {
        const panel = h.document.getElementById(tab.getAttribute("aria-controls")!);
        assert.ok(panel, "Each tab controls an existing panel");
        assert.equal(panel!.getAttribute("aria-labelledby"), tab.id);
    }
    h.get("plan-tab").focus();
    await h.fire(h.get("plan-tab"), "keydown", { key: "ArrowRight" });
    assert.equal(h.document.activeElement?.id, "content-tab", "Locked Implement and Test tabs are skipped");
    assert.equal(h.get("content-panel").hidden, false);
    await h.fire(h.get("content-tab"), "keydown", { key: "Home" });
    assert.equal(h.document.activeElement?.id, "preparation-tab");
    assert.equal(h.get("preparation-panel").hidden, false);
    assert.equal(h.requests.length, 0);
});

test("Radix confirmation has a safe initial focus and restores its invoker on Escape", async (t) => {
    const h = await setup(t);
    h.get("reset-effort").focus();
    await h.click("reset-effort");
    const dialog = h.document.querySelector('[role="alertdialog"]')!;
    assert.ok(dialog);
    assert.equal(h.document.activeElement?.textContent, "Cancel");
    await h.fire(h.document.activeElement!, "keydown", { key: "Escape" });
    assert.equal(h.document.querySelector('[role="alertdialog"]'), null);
    assert.equal(h.document.activeElement?.id, "reset-effort");
    assert.equal(h.requests.length, 0);
});

test("standalone read-only guidance returns to its owning session", async (t) => {
    const h = await setup(t, { ...state(), provider: { source: "session", canSubmitAnswers: false, canReload: false } });
    assert.match(text(h, "usage-message"), /Tandem session that owns this effort/);
    assert.match(text(h, "reload-status"), /Reopen the workspace/);
    assert.equal(disabled(h, "reload-extension"), true);
    assert.equal(h.requests.length, 0);
});

test("goal entry waits for an explicit valid start and retains drafts, focus and caret", async (t) => {
    const value = blankEffort(), h = await setup(t, value);
    assert.equal(hidden(h, "start-panel"), false);
    assert.equal(hidden(h, "studio-workspace"), true);
    assert.equal(hidden(h, "lifecycle-status"), true);
    assert.equal(hidden(h, "next-action-bar"), true);
    assert.equal(disabled(h, "start-effort"), true);
    await h.input("start-goal", "   "); await submit(h, "start-form");
    assert.match(text(h, "start-message"), /Enter a project goal/);
    assert.equal(field(h, "start-goal").getAttribute("aria-invalid"), "true");
    assert.equal(h.requests.length, 0);
    await h.input("start-goal", "  Build a team task board  ");
    const input = field(h, "start-goal"); input.focus(); input.setSelectionRange(3, 8);
    h.render({ ...value, revision: 2 });
    assert.equal(input.value, "  Build a team task board  ");
    assert.equal(input.selectionStart, 3);
    let release!: (r: Response) => void;
    h.setFetch(() => new Promise((resolve) => { release = resolve; }));
    await submit(h, "start-form"); await submit(h, "start-form"); await h.click("reset-effort");
    assert.equal(disabled(h, "start-effort"), true);
    assert.equal(h.requests.length, 1);
    assert.deepEqual(h.requests[0].body, { expectedRevision: 2, generation: "fixture-generation", goal: "Build a team task board" });
    assert.equal(h.requests[0].path, "/api/effort/start");
    const started = state("prepare", 3); started.preparation.status = "starting";
    release(response(started)); await h.flush();
    assert.equal(hidden(h, "start-panel"), true);
    assert.equal(hidden(h, "studio-workspace"), false);
    assert.equal(hidden(h, "preparation-panel"), false);
    assert.equal(h.document.activeElement, h.get("preparation-panel"));
});

test("invalid and rejected goals retain drafts and read-only goal entry cannot submit", async (t) => {
    const value = blankEffort(), h = await setup(t, value);
    await h.input("start-goal", "x".repeat(4001)); await submit(h, "start-form");
    assert.equal(h.requests.length, 0);
    await h.input("start-goal", "Build a focused app");
    h.setFetch(async () => response({ error: "The effort changed. Reload and retry." }, 409));
    await submit(h, "start-form");
    h.render({ ...value, revision: 2 });
    assert.equal(field(h, "start-goal").value, "Build a focused app");
    assert.match(text(h, "start-message"), /effort changed/);
    h.render({ ...value, revision: 3, provider: { canSubmitAnswers: false } });
    await submit(h, "start-form"); await h.click("reset-effort");
    assert.equal(disabled(h, "start-goal"), true);
    assert.equal(disabled(h, "reset-effort"), true);
    assert.equal(h.requests.length, 1);
});

test("reset during active work confirms first and only clears local drafts after success", async (t) => {
    const value = state("implement"); value.implementation.status = "running";
    const h = await setup(t, { ...value, implementationRuntime: { liveAgentCount: 2 } });
    assert.equal(disabled(h, "reset-effort"), false);
    await h.input("handoff-approver", "Previous owner");
    await h.input("process-repository", "owner/old");
    await h.click("reset-effort"); await h.confirm(false);
    assert.equal(h.requests.length, 0);
    assert.equal(field(h, "handoff-approver").value, "Previous owner");
    let release!: (r: Response) => void;
    h.setFetch(() => new Promise((resolve) => { release = resolve; }));
    await h.click("reset-effort"); await h.confirm();
    assert.equal(disabled(h, "reset-effort"), true);
    assert.match(text(h, "effort-message"), /Stopping active work/);
    assert.equal(h.get("studio-workspace").hasAttribute("inert"), true);
    assert.equal(h.get("studio-workspace").getAttribute("aria-busy"), "true");
    assert.equal(field(h, "process-repository").value, "owner/old");
    await h.click("reset-effort");
    assert.equal(h.requests.length, 1);
    assert.deepEqual(h.requests[0].body, { expectedRevision: 1, generation: "fixture-generation", confirm: true });
    release(response(blankEffort(4, "reset-generation"))); await h.flush();
    assert.equal(hidden(h, "start-panel"), false);
    assert.equal(current(h).implementationRuntime, undefined);
    assert.equal(h.document.activeElement, h.get("start-goal"));
    assert.equal(h.render({ ...value, revision: 2 }), false);
    h.render({ ...state("requirements", 5), generation: "reset-generation" }); await h.flush();
    assert.equal(field(h, "handoff-approver").value, "");
    assert.equal(field(h, "process-repository").value, "");
    assert.equal(field(h, "usage-input").value, "");
});

test("reset cancellation failures persist without clearing the effort or its drafts", async (t) => {
    const value = state("prepare"); value.preparation.status = "running";
    const h = await setup(t, value);
    await h.input("handoff-approver", "Keep this draft");
    h.setFetch(async () => response({ error: "Worker termination could not be confirmed. Retry Reset." }, 409));
    await h.click("reset-effort"); await h.confirm();
    h.render({ ...value, revision: 2 });
    assert.equal(hidden(h, "start-panel"), true);
    assert.equal(field(h, "handoff-approver").value, "Keep this draft");
    assert.equal(disabled(h, "reset-effort"), false);
    assert.match(text(h, "effort-message"), /termination could not be confirmed/);
    assert.equal(h.get("effort-message").dataset.status, "error");
});

test("reset cannot claim success without a new empty generation", async (t) => {
    const value = state(), h = await setup(t, value);
    h.setFetch(async () => response(value));
    await h.click("reset-effort"); await h.confirm();
    assert.match(text(h, "effort-message"), /has not been confirmed/);
    assert.equal(h.get("effort-message").dataset.status, "error");
});

test("persisted reset barriers block ordinary actions while leaving Reset retry available", async (t) => {
    const value = { ...state(), effortReset: { requestId: "reset-request", generation: "fixture-generation", error: "Worker termination is unconfirmed." } };
    const h = await setup(t, value);
    assert.equal(h.get("studio-workspace").hasAttribute("inert"), true);
    assert.equal(disabled(h, "reset-effort"), false);
    assert.equal(hidden(h, "next-action-bar"), true);
    assert.match(text(h, "effort-message"), /termination is unconfirmed/);
    await h.input("usage-input", "Should not submit"); await submit(h, "usage-form");
    assert.equal(h.requests.length, 0);
    h.render({ ...value, revision: 2, effortReset: { ...value.effortReset, error: "" } });
    assert.match(text(h, "effort-message"), /Reset is pending/);
    h.setFetch(async () => response(blankEffort(4, "after-retry")));
    await h.click("reset-effort"); await h.confirm();
    assert.equal(h.requests[0].body.expectedRevision, 2);
    assert.equal(hidden(h, "start-panel"), false);
    assert.equal(disabled(h, "start-goal"), false);
});

test("snapshots reject older revisions and late equal-revision provider/runtime responses", async (t) => {
    const newer = state("design", 3), h = await setup(t, newer);
    h.render(newer, 10);
    assert.equal(h.render(state("prototype", 2), 11), false);
    assert.equal(current(h).lifecycle.currentStage, "design");
    h.render({ ...newer, provider: { ...newer.provider, canReload: true }, implementationRuntime: { liveAgentCount: 2 } }, 20);
    h.render({ ...newer, provider: { ...newer.provider, canReload: false }, implementationRuntime: { liveAgentCount: 1 } }, 19);
    assert.equal(current(h).provider.canReload, true);
    assert.equal(current(h).implementationRuntime.liveAgentCount, 2);
    assert.equal(disabled(h, "reload-extension"), false);
    const next = { ...newer, revision: 4 }; delete next.provider;
    h.render(next, 21);
    assert.equal(current(h).implementationRuntime.liveAgentCount, 2);
});

test("legacy snapshots use revision zero and cannot replace revisioned state", async (t) => {
    const legacy = state(); delete legacy.revision;
    const h = await setup(t, legacy);
    assert.equal(current(h).revision, 0);
    h.render(state("prototype", 1));
    h.render({ ...legacy, updatedAt: "2030-01-01T00:00:00Z" });
    assert.equal(current(h).revision, 1);
});

test("an in-flight poll cannot roll back SSE and polling deduplicates requests", async (t) => {
    const h = await setup(t);
    let release!: (r: Response) => void;
    h.setFetch(() => new Promise((resolve) => { release = resolve; }));
    const poll = h.store.refresh();
    assert.equal(h.store.refresh(), poll);
    h.render(state("prototype", 2));
    release(response(state())); await poll; await h.flush();
    assert.equal(current(h).revision, 2);
    assert.equal(h.requests.length, 1);
    assert.equal(text(h, "stage"), "Prototype");
});

test("accepted mutations wait for a fresh post-mutation poll, not the older in-flight read", async (t) => {
    const value = state(), h = await setup(t, value);
    let release!: (r: Response) => void, reads = 0;
    h.setFetch(async (path) => {
        if (path === "/api/answer") return response({ accepted: true }, 202);
        if (++reads === 1) return new Promise((resolve) => { release = resolve; });
        return response({ ...value, revision: 2 });
    });
    const old = h.store.refresh(), mutation = h.store.post("/api/answer", { answer: "accepted" });
    await h.flush(); release(response(value)); await Promise.all([old, mutation]); await h.flush();
    assert.equal(reads, 2);
    assert.equal(current(h).revision, 2);
});

test("stage browsing is read-only; reopening confirms invalidation and blocks during active jobs", async (t) => {
    const value = state("test"); value.planning.workItems = [{ id: "work", title: "Saved plan" }];
    value.implementation.workItems = [{ id: "work", status: "completed" }];
    const h = await setup(t, value);
    await browse(h, "plan");
    assert.equal(current(h).lifecycle.currentStage, "test");
    assert.equal(hidden(h, "plan-panel"), false);
    assert.equal(disabled(h, "generate-plan"), true);
    await h.click("generate-plan"); assert.equal(h.requests.length, 0);
    await h.click("reopen-stage");
    assert.match(h.document.querySelector('[role="alertdialog"]')!.textContent!, /dependent stage outputs will be marked stale/);
    await h.confirm(false);
    h.setFetch(async () => response(state("plan", 2)));
    await h.click("reopen-stage"); await h.confirm();
    assert.equal(h.requests[0].path, "/api/stage/reopen");
    assert.equal(h.requests[0].body.stageId, "plan");
    const busy = state("test", 3); busy.testing.status = "running";
    h.render(busy); await browse(h, "plan");
    assert.equal(disabled(h, "reopen-stage"), true);
    await h.click("reopen-stage"); assert.equal(h.requests.length, 1);
});

test("compact context retains drafts and closes on navigation or Escape without mutation", async (t) => {
    const value = state(), h = await setup(t, value); h.setNarrowViewport(true);
    assert.equal(h.get("context-toggle").getAttribute("aria-expanded"), "false");
    assert.equal(text(h, "context-stage"), "Requirements");
    await h.click("context-toggle"); await h.input("handoff-approver", "Design owner");
    h.render({ ...value, revision: 2 });
    assert.equal(h.get("context-toggle").getAttribute("aria-expanded"), "true");
    await h.fire(h.get("requirements-pane"), "keydown", { key: "Escape" });
    assert.equal(h.get("studio-workspace").dataset.contextOpen, "false");
    assert.equal(h.document.activeElement, h.get("context-toggle"));
    assert.equal(field(h, "handoff-approver").value, "Design owner");
    await h.click("context-toggle"); await browse(h, "prepare");
    assert.equal(h.get("studio-workspace").dataset.contextOpen, "false");
    assert.equal(hidden(h, "preparation-panel"), false);
    assert.equal(current(h).lifecycle.currentStage, "requirements");
    assert.equal(h.requests.length, 0);
});

test("next-step guidance navigates and focuses without executing its mutation", async (t) => {
    const value = state("prepare"); value.preparation.status = "failed"; value.preparation.error = "Could not inspect workspace";
    const h = await setup(t, value); h.setNarrowViewport(true);
    assert.equal(hidden(h, "next-action-bar"), false);
    assert.match(text(h, "next-action-guide"), /Retry preparation/);
    assert.equal(text(h, "preparation-stage-progress"), "Could not inspect workspace");
    await h.click("context-toggle"); await h.click("show-next-action");
    await new Promise((resolve) => h.window.requestAnimationFrame(resolve)); await h.flush();
    assert.equal(h.get("studio-workspace").dataset.contextOpen, "false");
    assert.equal(h.document.activeElement, h.get("retry-preparation"));
    assert.equal(h.requests.length, 0);
    h.render({ ...value, revision: 2, preparation: { ...value.preparation, status: "running" } });
    assert.equal(hidden(h, "next-action-bar"), true);
});

test("collapsed activity bar completes the active stage without expanding or losing drafts", async (t) => {
    const value = state();
    value.requirements.substage = "dag";
    value.decisionGraph.nodes = [decision("accepted", "answered")];
    const h = await setup(t, value);
    await h.input("handoff-approver", "Design owner");
    await h.click("toggle-context-pane");
    const button = h.get<HTMLButtonElement>("complete-stage");
    assert.equal(button.hidden, false);
    assert.equal(button.disabled, false);
    assert.equal(button.getAttribute("aria-label"), "Next stage: Finish requirements");
    assert.equal(button.title, button.getAttribute("aria-label"));
    assert.ok(button.querySelector('svg.lucide-arrow-right[aria-hidden="true"]'));
    button.focus();
    assert.equal(h.document.activeElement, button);

    let release!: (result: Response) => void;
    h.setFetch(() => new Promise((resolve) => { release = resolve; }));
    await h.click(button); await h.click(button);
    assert.equal(button.disabled, true);
    assert.equal(button.title, "Saving stage output...");
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].path, "/api/stage/complete");
    assert.deepEqual(h.requests[0].body, { stageId: "requirements" });
    assert.equal(h.get("studio-workspace").dataset.contextCollapsed, "true");

    release(response(state("sketch", 2))); await h.flush();
    assert.equal(current(h).lifecycle.currentStage, "sketch");
    assert.equal(hidden(h, "sketch-panel"), false);
    assert.equal(h.get("studio-workspace").dataset.contextCollapsed, "true");
    assert.equal(h.get("toggle-context-pane").getAttribute("aria-expanded"), "false");
    assert.equal(button.disabled, true, "The new stage still requires its own completion evidence");
    await h.click("toggle-context-pane");
    assert.equal(text(h, "complete-stage"), "Finish sketch");
    assert.ok(button.querySelector('svg.lucide-check[aria-hidden="true"]'));
    assert.equal(field(h, "handoff-approver").value, "Design owner");
});

test("collapsed completion retains readiness, provider, busy, and historical-view guards", async (t) => {
    const value = state();
    value.requirements.substage = "dag";
    value.decisionGraph.nodes = [decision("accepted", "answered")];
    const h = await setup(t, value);
    await h.click("toggle-context-pane");
    await browse(h, "prepare");
    assert.equal(hidden(h, "complete-stage"), true);
    await browse(h, "requirements");
    assert.equal(hidden(h, "complete-stage"), false);
    let revision = value.revision;
    for (const snapshot of [
        { ...value, provider: { canSubmitAnswers: false } },
        { ...value, processing: { status: "running", action: "generate-dag" } },
        { ...value, decisionGraph: { nodes: [decision("unanswered")] } },
        { ...value, effortReset: { requestId: "reset", generation: value.generation } },
        state("prepare"),
    ]) {
        h.render({ ...snapshot, revision: ++revision }); await h.flush();
        assert.equal(disabled(h, "complete-stage"), true);
        await h.click("complete-stage");
        assert.equal(h.get("studio-workspace").dataset.contextCollapsed, "true");
    }
    assert.equal(h.requests.length, 0);
});

test("collapsed completion surfaces failures and permits retry without expanding", async (t) => {
    const value = state();
    value.requirements.substage = "dag";
    value.decisionGraph.nodes = [decision("accepted", "answered")];
    const h = await setup(t, value);
    await h.click("toggle-context-pane");
    h.setFetch(async () => response({ error: "Stage output could not be saved." }, 409));
    await h.click("complete-stage");
    assert.equal(current(h).lifecycle.currentStage, "requirements");
    assert.equal(h.get("next-action-bar").dataset.status, "error");
    assert.match(text(h, "next-action-guide"), /Stage output could not be saved/);
    assert.equal(disabled(h, "complete-stage"), false);
    assert.equal(h.get("studio-workspace").dataset.contextCollapsed, "true");
    h.setFetch(async () => response(state("sketch", 2)));
    await h.click("complete-stage");
    assert.equal(h.requests.filter((request) => request.path === "/api/stage/complete").length, 2);
    assert.equal(current(h).lifecycle.currentStage, "sketch");
    assert.equal(h.get("studio-workspace").dataset.contextCollapsed, "true");
    assert.equal(h.get("next-action-bar").dataset.status, "idle");
});

test("collapsed final-stage completion uses a checkmark and cannot advance past the workflow", async (t) => {
    const value = state("test");
    value.testing = { ...value.testing, status: "completed", finalizedArtifactId: "test-results", scenarios: [{ id: "passed", status: "passed" }] };
    const h = await setup(t, value);
    await h.click("toggle-context-pane");
    assert.equal(h.get("complete-stage").title, "Finish test");
    assert.ok(h.get("complete-stage").querySelector('svg.lucide-check[aria-hidden="true"]'));
    h.setFetch(async () => response({ ...value, revision: 2,
        lifecycle: { ...value.lifecycle, completedStages: [...value.lifecycle.completedStages, "test"] } }));
    await h.click("complete-stage");
    assert.deepEqual(h.requests[0].body, { stageId: "test" });
    assert.equal(h.get("complete-stage").title, "All stages complete");
    assert.equal(disabled(h, "complete-stage"), true);
    assert.equal(h.get("studio-workspace").dataset.contextCollapsed, "true");
    await h.click("complete-stage");
    assert.equal(h.requests.length, 1);
});

test("next-step guidance reveals completion from historical views in compact context", async (t) => {
    const value = state(); value.requirements.substage = "dag"; value.decisionGraph.nodes = [decision("accepted", "answered")];
    const h = await setup(t, value); h.setNarrowViewport(true);
    await browse(h, "prepare"); assert.equal(hidden(h, "complete-stage"), true);
    await h.click("show-next-action");
    await new Promise((resolve) => h.window.requestAnimationFrame(resolve)); await h.flush();
    assert.equal(hidden(h, "complete-stage"), false);
    assert.equal(h.get("context-toggle").getAttribute("aria-expanded"), "true");
    assert.equal(h.document.activeElement, h.get("complete-stage"));
    assert.equal(h.requests.length, 0);
});

test("legacy optional history fields and archived Preparation remain browsable", async (t) => {
    const value = state(); delete value.lifecycle.skippedStages; delete value.lifecycle.history;
    const h = await setup(t, value);
    assert.equal(h.get("stage-list").querySelectorAll("button").length, 8);
    h.render({ ...value, revision: 2, lifecycle: { ...value.lifecycle, completedStages: [],
        history: [{ stageId: "prepare", path: "history\\preparation.md", completedAt: value.updatedAt }] } });
    const button = h.get("stage-list").querySelector<HTMLButtonElement>('[data-stage-id="prepare"]')!;
    assert.equal(button.disabled, false); assert.equal(button.title, "history\\preparation.md");
    await h.click(button);
    assert.equal(hidden(h, "preparation-panel"), false);
    assert.equal(h.requests.length, 0);
});
