import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { setup, state, blankEffort, decision, response, text, field, disabled, hidden, current, submit, browse } from "./renderer-fixtures.test.js";

test("original brief belongs to Preparation, not duplicated global sidebar prose", async t => {
    const value = state("requirements");
    value.goal = "Keep my exact original project brief.\nIncluding its second line.";
    const h = await setup(t, value);
    assert.equal(h.document.querySelector("#requirements-pane .project-brief"), null);
    assert.equal(h.document.querySelector("#requirements-pane #goal"), null);
    assert.equal(h.document.querySelector("#requirements-pane #status"), null);
    assert.doesNotMatch(h.get("requirements-pane").textContent!, /Project overview|Brief and project details/);
    await browse(h, "prepare");
    assert.equal(h.get("goal").textContent, value.goal);
    assert.equal(h.document.querySelector("#start-goal"), null);
    assert.equal(h.requests.length, 0);
});

test("root branding embeds the existing Tandem bicycle artwork with accessible naming", async t => {
    const h = await setup(t);
    const image = h.document.querySelector<HTMLImageElement>(".brand-artwork")!;
    assert.ok(image);
    assert.equal(h.document.querySelector(".brand h1")?.textContent, "Tandem");
    assert.equal(h.document.querySelector(".brand .mark"), null);
    const encoded = image.src.split(",")[1];
    assert.deepEqual(Buffer.from(encoded, "base64"),
        await readFile(new URL("../development/tandem/public/branding/tandem-blue-dark.png", import.meta.url)));
});

test("compact workflow exposes progress and labeled stage icons without changing navigation", async (t) => {
    const value = state("prototype");
    value.lifecycle.completedStages = value.lifecycle.completedStages.filter((id: string) => id !== "sketch");
    value.lifecycle.skippedStages = [{ stageId: "sketch", reason: "Existing drawings were supplied." }];
    const h = await setup(t, value);
    assert.equal(h.get("project-contents").querySelectorAll("[data-stage-id]").length, 5);
    assert.equal(h.document.querySelectorAll('[data-stage-id="design"], [data-stage-id="plan"], [data-stage-id="implement"], [data-stage-id="test"]').length, 0);
    for (const button of h.document.querySelectorAll<HTMLButtonElement>("[data-stage-id]")) {
        assert.ok(button.getAttribute("aria-label"), "Icon navigation retains the stage name and status");
        assert.ok(button.querySelector("svg")?.closest('[aria-hidden="true"]'), "Stage icons are decorative");
    }
    const skipped = h.document.querySelector<HTMLButtonElement>('[data-stage-id="sketch"]')!;
    assert.equal(skipped.disabled, true);
    assert.match(skipped.getAttribute("aria-label")!, /not applicable.*Existing drawings/);
    await browse(h, "requirements");
    assert.equal(hidden(h, "design-tree-panel"), false);
    assert.equal(current(h).lifecycle.currentStage, "prototype");
    assert.equal(h.requests.length, 0);
});

test("artifact rows retain full metadata and distinguish stale records with icons", async (t) => {
    const value = state("prototype");
    value.artifacts = [{
        id: "design-spec", stage: "design", kind: "design-spec", title: "An intentionally long product specification title",
        path: "records/design/specification.md", reviewStatus: "stale", content: "Existing specification",
    }];
    const h = await setup(t, value);
    const button = h.document.querySelector<HTMLButtonElement>('[data-artifact-id="design-spec"]')!;
    assert.equal(button.dataset.stale, "true");
    assert.match(button.title, /An intentionally long.*records\/design\/specification\.md.*stale/);
    assert.ok(button.querySelector('svg[aria-hidden="true"]'));
    await h.click("artifact-group-discovery-design");
    await h.click(button);
    assert.equal(hidden(h, "content-panel"), false);
    assert.equal(text(h, "artifact-content"), "Existing specification");
    assert.equal(h.requests.length, 0);
});

test("artifact groups default closed and retain user choices, focus, counts and selected cues through updates", async t => {
    const value = state("requirements");
    value.artifacts = [{ id: "requirements", title: "Saved requirements", stage: "requirements", kind: "markdown",
        path: "requirements.md", language: "markdown", content: "Original", mermaid: "", sourceRevision: 1 }];
    const h = await setup(t, value);
    const group = h.get("artifact-group-discovery-requirements");
    assert.equal(group.getAttribute("aria-expanded"), "false");
    assert.equal(h.get("artifact-group-discovery-requirements-items").hidden, true);
    assert.match(group.getAttribute("aria-label")!, /1 items/);
    assert.ok(h.get("content-tab"));
    group.focus();
    h.render({ ...value, revision: 2, artifacts: [...value.artifacts, { ...value.artifacts[0], id: "more", title: "More requirements" }] });
    await h.flush();
    assert.equal(h.get("artifact-group-discovery-requirements"), group);
    assert.equal(h.document.activeElement, group);
    assert.equal(group.getAttribute("aria-expanded"), "false");
    assert.match(group.getAttribute("aria-label")!, /2 items.*new output/);
    await h.click(group);
    assert.equal(group.getAttribute("aria-expanded"), "true");
    await h.click(h.document.querySelector('[data-artifact-id="requirements"]')!);
    assert.equal(group.dataset.selected, "true");
    await h.click(group);
    h.render({ ...current(h), revision: 3, artifacts: current(h).artifacts.map(item => ({ ...item, sourceRevision: 2 })) });
    await h.flush();
    assert.equal(group.getAttribute("aria-expanded"), "false", "New versions cannot override a manual collapse.");
    assert.match(group.getAttribute("aria-label")!, /contains current selection.*new output/);
    await h.click(group);
    h.render({ ...current(h), revision: 4 }); await h.flush();
    assert.equal(group.getAttribute("aria-expanded"), "true");
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

test("header omits maintenance while supported reload belongs to advanced Project settings", async (t) => {
    const value = { ...state(), provider: { canSubmitAnswers: true, canReload: true },
        reloadReceipt: { status: "success", message: "Reloaded latest extension." } };
    const h = await setup(t, value);
    assert.equal(h.document.querySelector(".topbar #reload-extension, .topbar #reset-effort"), null);
    assert.ok(h.get("preparation-panel").contains(h.get("reset-effort")));
    assert.equal(text(h, "reset-effort"), "Restart Preparation...");
    await h.click("project-settings");
    assert.equal(text(h, "reload-status"), "");
    assert.equal(text(h, "reload-extension"), "Reload Tandem extension");
    assert.equal(disabled(h, "reload-extension"), false);
    assert.ok(h.get("root-maintenance").contains(h.get("reload-extension")));
    const actions = h.document.querySelector(".topbar-actions")!;
    assert.equal(actions.lastElementChild!.className, "build-version");
    h.render({ ...value, revision: 2, reloadReceipt: { status: "error", message: "Could not reload extension." } });
    assert.equal(text(h, "reload-status"), "Could not reload extension.");
    assert.equal(h.get("reload-status").dataset.status, "error");
});

test("React panels have unique IDs and Radix navigation includes direct Development", async (t) => {
    const h = await setup(t, state("prototype"));
    const ids = Array.from(h.document.querySelectorAll("[id]")).map((node) => node.id);
    assert.equal(new Set(ids).size, ids.length, "No duplicate component or tabpanel IDs");
    for (const tab of h.document.querySelectorAll('[role="tab"]')) {
        const panel = h.document.getElementById(tab.getAttribute("aria-controls")!);
        assert.ok(panel, "Each tab controls an existing panel");
        const label = h.document.getElementById(panel!.getAttribute("aria-labelledby")!);
        assert.equal(label?.getAttribute("role"), "tab");
        assert.equal(label?.getAttribute("aria-controls"), panel!.id, "Each panel is labelled by one of its navigation tabs");
    }
    h.get("live-preview-tab").focus();
    await h.fire(h.get("live-preview-tab"), "keydown", { key: "ArrowRight" });
    assert.equal(h.document.activeElement?.id, "development-tab", "Development never requires upstream completion.");
    assert.equal(h.get("development-panel").hidden, false);
    await h.fire(h.get("development-tab"), "keydown", { key: "ArrowRight" });
    assert.equal(h.document.activeElement?.id, "preparation-tab", "The workflow list does not include the cross-project library.");
    assert.equal(h.get("project-contents").querySelector("#content-tab"), null);
    assert.ok(h.get("project-artifact-library").contains(h.get("content-tab")));
    h.get("content-tab").focus();
    await h.fire(h.get("content-tab"), "keydown", { key: "Enter" });
    assert.equal(h.document.activeElement?.id, "content-tab");
    assert.equal(h.get("content-panel").hidden, false);
    assert.equal(h.get("content-tab").getAttribute("aria-selected"), "true");
    h.get("development-tab").focus();
    await h.fire(h.get("development-tab"), "keydown", { key: "Home" });
    assert.equal(h.document.activeElement?.id, "preparation-tab");
    assert.equal(h.get("preparation-panel").hidden, false);
    assert.deepEqual(h.requests, [], "Navigation does not activate Development or submit work.");
});

test("horizontal stage tabs retain drafts and current-stage identity without submitting work", async t => {
    const value = state(), h = await setup(t, value);
    const tabs = h.get("stage-workspace-tabs");
    assert.deepEqual(Array.from(tabs.querySelectorAll('[role="tab"]'), tab => tab.textContent),
        ["Preparation", "Requirements", "Drawings", "Prototype"]);
    assert.equal(tabs.getAttribute("aria-label"), "Pre-development stages");
    assert.equal(h.document.querySelector("#development-workspace-tab"), null);
    assert.equal(disabled(h, "sketch-workspace-tab"), true);
    assert.equal(disabled(h, "live-preview-workspace-tab"), true);
    assert.equal(h.get("design-tree-workspace-tab").getAttribute("aria-selected"), "true");
    const panel = h.get("design-tree-panel"), input = field(h, "usage-input");
    await h.input("usage-input", "Keep this unsent usage while I browse.");
    await h.fire(h.get("preparation-workspace-tab"), "mousedown", { button: 0 });
    assert.equal(hidden(h, "preparation-panel"), false);
    assert.equal(h.get("preparation-tab").getAttribute("aria-selected"), "true");
    assert.equal(h.get("design-tree-tab").getAttribute("aria-current"), "step");
    assert.match(text(h, "stage-browsing"), /read only/);
    h.render({ ...value, revision: 2 }); await h.flush();
    await h.fire(h.get("design-tree-workspace-tab"), "mousedown", { button: 0 });
    assert.equal(h.get("design-tree-panel"), panel);
    assert.equal(field(h, "usage-input"), input);
    assert.equal(input.value, "Keep this unsent usage while I browse.");
    assert.equal(panel.getAttribute("aria-labelledby"), "design-tree-workspace-tab");
    assert.deepEqual(current(h).lifecycle, value.lifecycle);
    assert.deepEqual(h.requests, []);
});

test("horizontal keyboard navigation skips unavailable stages and stays separate from Development", async t => {
    const value = state("prototype");
    value.lifecycle.skippedStages = [{ stageId: "sketch", reason: "Existing drawings were supplied." }];
    const h = await setup(t, value);
    assert.equal(disabled(h, "sketch-workspace-tab"), true);
    assert.match(h.get("sketch-workspace-tab").getAttribute("aria-label")!, /not applicable.*Existing drawings/);
    h.get("preparation-workspace-tab").focus();
    await h.fire(h.document.activeElement!, "keydown", { key: "End" });
    assert.equal(h.document.activeElement?.id, "live-preview-workspace-tab");
    await h.fire(h.document.activeElement!, "keydown", { key: "ArrowLeft" });
    assert.equal(h.document.activeElement?.id, "design-tree-workspace-tab");
    await h.fire(h.document.activeElement!, "keydown", { key: "Home" });
    assert.equal(h.document.activeElement?.id, "preparation-workspace-tab");
    await h.fire(h.document.activeElement!, "keydown", { key: "ArrowLeft" });
    assert.equal(h.document.activeElement?.id, "live-preview-workspace-tab");
    assert.equal(hidden(h, "live-preview-panel"), false);
    assert.equal(h.get("live-preview-tab").getAttribute("aria-selected"), "true");
    await browse(h, "development");
    assert.equal(h.document.querySelector("#stage-workspace-tabs"), null);
    assert.equal(h.get("preview-pane").dataset.stageTabs, "false");
    assert.equal(h.get("development-panel").getAttribute("aria-labelledby"), "development-tab");
    await browse(h, "requirements");
    assert.equal(h.get("design-tree-workspace-tab").getAttribute("aria-selected"), "true");
    assert.equal(current(h).lifecycle.currentStage, "prototype");
    assert.deepEqual(h.requests, []);
});

test("horizontal stage tabs do not change goal entry or the saved artifact library", async t => {
    const h = await setup(t, blankEffort());
    assert.equal(h.document.querySelector("#stage-workspace-tabs"), null);
    h.render(state("requirements", 2)); await h.flush();
    assert.ok(h.get("stage-workspace-tabs"));
    await h.fire(h.get("content-tab"), "mousedown", { button: 0 });
    assert.equal(h.document.querySelector("#stage-workspace-tabs"), null);
    assert.equal(hidden(h, "content-panel"), false);
    assert.equal(h.get("content-panel").getAttribute("aria-labelledby"), "content-tab");
    await browse(h, "requirements");
    assert.equal(h.get("preview-pane").dataset.stageTabs, "true");
    assert.deepEqual(h.requests, []);
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
    await h.click("project-settings");
    assert.equal(h.document.querySelector("#reload-extension"), null, "Unsupported reload is not a dead primary control.");
    assert.deepEqual(h.requests.map(request => request.path), ["/api/settings/project-effort"], "Only a settings read is attempted.");
});

test("goal entry waits for an explicit valid start and retains drafts, focus and caret", async (t) => {
    const value = blankEffort(), h = await setup(t, value);
    assert.equal(hidden(h, "start-panel"), false);
    assert.equal(hidden(h, "studio-workspace"), false);
    assert.equal(hidden(h, "lifecycle-status"), true);
    assert.equal(hidden(h, "next-action-bar"), false, "Status help stays available at goal entry.");
    assert.equal(hidden(h, "show-next-action"), true);
    await h.click("show-next-action");
    assert.equal(h.requests.length, 0);
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
    await submit(h, "start-form"); await submit(h, "start-form");
    assert.equal(h.document.querySelector("#reset-effort"), null, "An empty Preparation has nothing to archive.");
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
    await submit(h, "start-form");
    assert.equal(disabled(h, "start-goal"), true);
    assert.equal(h.document.querySelector("#reset-effort"), null);
    assert.equal(h.requests.length, 1);
});

test("reset during active work confirms first and only clears local drafts after success", async (t) => {
    const value = state("prototype"); value.processing = { status: "running" };
    const h = await setup(t, { ...value, preparationRuntime: { liveAgentCount: 2 } });
    assert.equal(disabled(h, "reset-effort"), false);
    await h.openProcess();
    await h.input("process-reference", "Previous reference");
    await h.input("process-repository", "owner/old");
    await h.click("close-acceptance-delivery");
    await h.click("reset-effort"); await h.confirm(false);
    assert.equal(h.requests.length, 0);
    await h.openProcess();
    assert.equal(field(h, "process-reference").value, "Previous reference");
    assert.equal(field(h, "process-repository").value, "owner/old");
    await h.click("close-acceptance-delivery");
    let release!: (r: Response) => void;
    h.setFetch(() => new Promise((resolve) => { release = resolve; }));
    await h.click("reset-effort"); await h.confirm();
    assert.equal(disabled(h, "reset-effort"), true);
    assert.match(text(h, "effort-message"), /Stopping active discovery work/);
    assert.equal(h.get("studio-workspace").hasAttribute("inert"), true);
    assert.equal(h.get("studio-workspace").getAttribute("aria-busy"), "true");
    await h.click("reset-effort");
    assert.equal(h.requests.length, 1);
    assert.deepEqual(h.requests[0].body, { expectedRevision: 1, generation: "fixture-generation", confirm: true });
    release(response(blankEffort(4, "reset-generation"))); await h.flush();
    assert.equal(hidden(h, "start-panel"), false);
    assert.equal(current(h).preparationRuntime, undefined);
    assert.equal(h.document.activeElement, h.get("start-goal"));
    assert.equal(h.render({ ...value, revision: 2 }), false);
    h.render({ ...state("requirements", 5), generation: "reset-generation" }); await h.flush();
    await h.openProcess();
    assert.equal(field(h, "process-reference").value, "");
    assert.equal(field(h, "process-repository").value, "");
    assert.equal(field(h, "usage-input").value, "");
});

test("reset cancellation failures persist without clearing the effort or its drafts", async (t) => {
    const value = state("prepare"); value.preparation.status = "running";
    const h = await setup(t, value);
    await h.openProcess();
    await h.input("process-reference", "Keep this draft");
    await h.click("close-acceptance-delivery");
    h.setFetch(async () => response({ error: "Worker termination could not be confirmed. Retry Reset." }, 409));
    await h.click("reset-effort"); await h.confirm();
    h.render({ ...value, revision: 2 });
    assert.equal(hidden(h, "start-panel"), true);
    await h.openProcess();
    assert.equal(field(h, "process-reference").value, "Keep this draft");
    await h.click("close-acceptance-delivery");
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
    assert.equal(h.get("studio-workspace").hasAttribute("inert"), false, "The pending recovery control must remain reachable.");
    assert.equal(h.get("preparation-panel").hidden, false);
    assert.equal((h.get("preparation-maintenance") as HTMLDetailsElement).open, true);
    assert.equal(disabled(h, "reset-effort"), false);
    assert.equal(hidden(h, "next-action-bar"), false, "Reset does not remove the status/help surface.");
    assert.equal(hidden(h, "show-next-action"), true);
    await h.click("show-next-action");
    assert.match(text(h, "effort-message"), /termination is unconfirmed/);
    await h.input("usage-input", "Should not submit"); await submit(h, "usage-form");
    assert.equal(h.requests.length, 0);
    h.render({ ...value, revision: 2, effortReset: { ...value.effortReset, error: "" } });
    assert.match(text(h, "effort-message"), /Preparation restart is pending/);
    h.setFetch(async () => response(blankEffort(4, "after-retry")));
    await h.click("reset-effort"); await h.confirm();
    assert.equal(h.requests[0].body.expectedRevision, 2);
    assert.equal(hidden(h, "start-panel"), false);
    assert.equal(disabled(h, "start-goal"), false);
});

test("supported diagnostic reload remains a recovery option without clearing a reset barrier", async t => {
    const value = { ...state(), provider: { canSubmitAnswers: true, canReload: true },
        effortReset: { requestId: "pending-reset", generation: "fixture-generation", error: "Worker termination is unconfirmed." },
        preparationRuntime: { liveAgentCount: 1 } };
    const h = await setup(t, value);
    h.setFetch(async path => path === "/api/reload" ? response({ accepted: true })
        : response({ error: "Effort readback unavailable during recovery." }, 503));
    await h.click("project-settings");
    assert.equal(disabled(h, "reload-extension"), false);
    await h.click("reload-extension");
    assert.equal(disabled(h, "reload-extension"), true);
    assert.deepEqual(h.requests.filter(request => request.path === "/api/reload").map(request => request.body), [{}]);
    assert.equal(current(h).effortReset?.requestId, "pending-reset");
    assert.equal(current(h).goal, value.goal);
    assert.equal(h.requests.some(request => request.path === "/api/effort/reset"), false);
});

test("snapshots reject older revisions and late equal-revision provider/runtime responses", async (t) => {
    const newer = state("prototype", 3), h = await setup(t, newer);
    h.render(newer, 10);
    assert.equal(h.render(state("prototype", 2), 11), false);
    assert.equal(current(h).lifecycle.currentStage, "prototype");
    h.render({ ...newer, provider: { ...newer.provider, canReload: true }, preparationRuntime: { liveAgentCount: 2 } }, 20);
    h.render({ ...newer, provider: { ...newer.provider, canReload: false }, preparationRuntime: { liveAgentCount: 1 } }, 19);
    assert.equal(current(h).provider.canReload, true);
    assert.equal(current(h).preparationRuntime.liveAgentCount, 2);
    await h.click("project-settings");
    assert.equal(disabled(h, "reload-extension"), false, "The accepted provider capability is retained; stale runtime counts are not a running-work signal.");
    const next = { ...newer, revision: 4 }; delete next.provider;
    h.render(next, 21);
    assert.equal(current(h).preparationRuntime.liveAgentCount, 2);
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

test("current phase is independent of browsing and does not label unopened Development as current", async t => {
    const value = state("requirements"), h = await setup(t, value);
    assert.equal(h.get("design-tree-tab").getAttribute("aria-current"), "step");
    await browse(h, "prepare");
    assert.equal(h.get("preparation-tab").getAttribute("aria-selected"), "true");
    assert.equal(h.get("preparation-tab").getAttribute("aria-current"), null);
    assert.match(h.get("design-tree-tab").getAttribute("aria-label")!, /Current phase/);
    h.render({ ...state("development"), revision: 2 }); await h.flush();
    assert.equal(h.get("development-tab").getAttribute("aria-current"), null);
    assert.equal(h.document.querySelectorAll('#project-contents [aria-current="step"]').length, 0);
    assert.equal(h.requests.length, 0);
});

test("compact context retains drafts and closes on navigation or Escape without mutation", async (t) => {
    const value = state(), h = await setup(t, value); h.setNarrowViewport(true);
    assert.equal(h.get("context-toggle").getAttribute("aria-expanded"), "false");
    assert.equal(text(h, "context-stage"), "Requirements");
    await h.click("context-toggle"); await h.openProcess();
    await h.input("process-reference", "Design reference");
    await h.click("close-acceptance-delivery");
    h.render({ ...value, revision: 2 });
    assert.equal(h.get("context-toggle").getAttribute("aria-expanded"), "true");
    await h.fire(h.get("requirements-pane"), "keydown", { key: "Escape" });
    assert.equal(h.get("studio-workspace").dataset.contextOpen, "false");
    assert.equal(h.document.activeElement, h.get("context-toggle"));
    await h.openProcess();
    assert.equal(field(h, "process-reference").value, "Design reference");
    await h.click("close-acceptance-delivery");
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
    assert.equal(hidden(h, "show-next-action"), false);
    assert.match(text(h, "next-action-guide"), /Retry preparation/);
    assert.equal(text(h, "preparation-stage-progress"), "Could not inspect workspace");
    await h.click("context-toggle"); await h.click("show-next-action");
    await new Promise((resolve) => h.window.requestAnimationFrame(resolve)); await h.flush();
    assert.equal(h.get("studio-workspace").dataset.contextOpen, "false");
    assert.equal(h.document.activeElement, h.get("retry-preparation"));
    assert.equal(h.requests.length, 0);
    h.render({ ...value, revision: 2, preparation: { ...value.preparation, status: "running" } });
    assert.equal(hidden(h, "next-action-bar"), false, "Running work can still expose status help.");
    assert.equal(hidden(h, "show-next-action"), true);
    await h.click("show-next-action");
    assert.equal(h.requests.length, 0);
});

test("owning phase toolbar completes the active stage without expanding context or losing drafts", async (t) => {
    const value = state();
    value.requirements.substage = "dag";
    value.decisionGraph.nodes = [decision("accepted", "answered")];
    const h = await setup(t, value);
    await h.openProcess();
    await h.input("process-reference", "Design reference");
    await h.click("close-acceptance-delivery");
    await h.click("toggle-context-pane");
    const button = h.get<HTMLButtonElement>("complete-stage");
    assert.equal(button.hidden, false);
    assert.equal(button.disabled, false);
    assert.equal(button.getAttribute("aria-label"), "Next stage: Finish requirements");
    assert.equal(button.title, button.getAttribute("aria-label"));
    assert.ok(button.querySelector('svg.lucide-check[aria-hidden="true"]'));
    assert.equal(button.closest('[role="tabpanel"]')?.id, "design-tree-panel");
    assert.equal(h.get("requirements-pane").contains(button), false);
    assert.doesNotMatch(h.get("requirements-pane").textContent || "", /Discovery actions/);
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
    assert.equal(text(h, "complete-stage"), "Finish Drawings and continue");
    assert.ok(button.querySelector('svg.lucide-check[aria-hidden="true"]'));
    await h.openProcess();
    assert.equal(field(h, "process-reference").value, "Design reference");
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
    assert.equal(h.get("project-contents").querySelectorAll("[data-stage-id]").length, 5);
    h.render({ ...value, revision: 2, lifecycle: { ...value.lifecycle, completedStages: [],
        history: [{ stageId: "prepare", path: "history\\preparation.md", completedAt: value.updatedAt }] } });
    const button = h.get("project-contents").querySelector<HTMLButtonElement>('[data-stage-id="prepare"]')!;
    assert.equal(button.disabled, false); assert.equal(button.title, "history\\preparation.md");
    await h.fire(button, "mousedown", { button: 0 });
    assert.equal(hidden(h, "preparation-panel"), false);
    assert.equal(h.requests.length, 0);
});
