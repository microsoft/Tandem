import assert from "node:assert/strict";
import { test } from "node:test";
import { reactHarness, setup, state, response, text, field, disabled, hidden, current, submit, browse, waitFor } from "./renderer-fixtures.test.js";

test("everyday discovery hides process controls and empty ledger categories without losing ledger expansion", async t => {
    const value = state("prepare"), h = await setup(t, value);
    for (const stage of ["prepare", "requirements", "sketch", "prototype"] as const) {
        h.render({ ...state(stage), revision: ++value.revision }); await h.flush();
        assert.equal(h.document.querySelector("#handoff-stage, #acceptance-delivery, #process-metrics, #export-handoff"), null);
        assert.equal(h.document.querySelector<HTMLDetailsElement>(".ledger-details")!.hidden, true);
    }
    const populated = { ...state("requirements"), revision: ++value.revision, confirmed: ["Keep the verified requirement"], assumed: [], deferred: [] };
    h.render(populated); await h.flush();
    const ledger = h.document.querySelector<HTMLDetailsElement>(".ledger-details")!;
    ledger.open = true;
    assert.equal(ledger.hidden, false);
    assert.equal(h.document.querySelector("#assumed, #deferred"), null);
    assert.match(ledger.textContent!, /Keep the verified requirement/);
    h.render({ ...populated, revision: ++value.revision, confirmed: [] }); await h.flush();
    assert.equal(ledger.hidden, true);
    h.render({ ...populated, revision: ++value.revision }); await h.flush();
    assert.equal(ledger.open, true);
    assert.equal(ledger.hidden, false);
    assert.equal(h.requests.filter(request => request.options.method === "POST").length, 0);
});

test("artifact navigation keeps the zero count, viewer empty state and only populated stage groups", async (t) => {
    const value = state("prototype"), h = await setup(t, value); h.setNarrowViewport(true);
    assert.equal(text(h, "artifact-count"), "0");
    assert.equal(text(h, "content-tab"), "Saved artifacts 0");
    assert.equal(text(h, "artifact-list"), "");
    assert.doesNotMatch(text(h, "project-artifact-library"), /No artifacts yet/);
    assert.equal(h.get("artifact-list").querySelectorAll(".artifact-stage-group").length, 0);
    await h.fire(h.get("content-tab"), "keydown", { key: "Enter" });
    assert.equal(hidden(h, "content-panel"), false);
    assert.equal(text(h, "content-empty"), "No artifacts yet");
    h.render({ ...value, revision: 2, artifacts: [
        { id: "intent", title: "User intent", stage: "requirements", kind: "intent", content: "Intent" },
        { id: "contract", title: "UI contract", stage: "design", kind: "contract", content: "Contract", reviewStatus: "stale" },
    ] });
    assert.equal(h.get("artifact-list").querySelectorAll(".artifact-stage-group").length, 2);
    assert.match(text(h, "artifact-list"), /stale/);
    await h.click("context-toggle"); await h.click("artifact-group-discovery-design");
    await h.click(h.get("artifact-list").querySelector('[data-artifact-id="contract"]')!);
    assert.equal(h.get("studio-workspace").dataset.contextOpen, "false");
    assert.equal(text(h, "artifact-heading"), "UI contract");
    assert.equal(hidden(h, "content-panel"), false); assert.equal(h.requests.length, 0);
});

test("diagram redraws preserve user zoom and unrelated updates reuse generated SVG", async (t) => {
    const h = await reactHarness(t); let renders = 0;
    h.setMermaid(async () => { renders++; return { svg: '<svg viewBox="0 0 800 300"><rect /></svg>' }; });
    const value = state("prototype"); value.artifacts = [{ id: "diagram", title: "Flow", stage: "requirements", kind: "diagram",
        mermaid: "flowchart LR\nA-->B", content: "" }];
    h.render(value); await h.flush();
    await h.click("content-tab");
    const section = h.get("artifact-diagram");
    await h.click(section.querySelector('[aria-label="Actual size"]')!);
    await h.click(section.querySelector('[aria-label="Zoom in"]')!);
    const diagram = section.querySelector<HTMLElement>(".react-diagram")!;
    assert.equal(diagram.style.getPropertyValue("--diagram-width"), "1000px");
    const sourceButton = section.querySelector<HTMLButtonElement>('button[title="Mermaid source"]')!;
    assert.ok(sourceButton.previousElementSibling!.classList.contains("diagram-toolbar-output"));
    assert.equal(sourceButton.previousElementSibling!.textContent, "125%");
    assert.equal(sourceButton.parentElement!.lastElementChild, sourceButton);
    const sourceDialogId = sourceButton.getAttribute("aria-controls")!;
    await h.click(sourceButton);
    const source = h.get(sourceDialogId).querySelector("pre")!;
    assert.equal(source.textContent, value.artifacts[0].mermaid);
    assert.equal(section.contains(source), false, "The popup source must not resize the diagram.");
    const before = renders;
    h.render({ ...value, revision: 2, status: "Unrelated" }); await h.flush();
    assert.equal(renders, before);
    h.render({ ...value, revision: 3, artifacts: [{ ...value.artifacts[0], mermaid: "flowchart LR\nA-->C" }] });
    await h.flush();
    assert.equal(renders, before + 1);
    assert.equal(diagram.style.getPropertyValue("--diagram-width"), "1000px");
    assert.equal(h.get(sourceDialogId).querySelector("pre"), source);
    assert.equal(source.textContent, "flowchart LR\nA-->C");
    await h.fire(h.get(sourceDialogId), "keydown", { key: "Escape" });
    assert.equal(h.document.getElementById(sourceDialogId), null);
    assert.equal(h.document.activeElement, sourceButton);
    assert.equal(diagram.style.getPropertyValue("--diagram-width"), "1000px");
    assert.deepEqual(h.errors, []);
});

test("failed Preparation without an error never reports success", async (t) => {
    const value = state("prepare"); value.preparation.status = "failed";
    const h = await setup(t, value);
    assert.match(text(h, "preparation-stage-progress"), /stopped before completion/);
});

test("Preparation runtime stays ordered and advances automatically to Requirements", async (t) => {
    const value = state("prepare"); value.preparation.status = "running";
    value.preparation.workItems = [{ id: "context", title: "Inspect context", status: "running", detail: "Read guidance" }];
    const h = await setup(t, value); h.render(value, 10);
    assert.equal(h.get("project-contents").querySelectorAll("[data-stage-id]").length, 5);
    assert.equal(text(h, "current-stage-index"), "1");
    assert.equal(disabled(h, "design-tree-tab"), true);
    assert.equal(disabled(h, "complete-stage"), true);
    await h.click("complete-stage"); assert.equal(h.requests.length, 0);
    h.render({ ...value, preparationRuntime: {
        currentPhase: "analyze-sources", agents: [{ label: "prepare:context", status: "running", activity: "Reading docs" }],
    } }, 12);
    assert.match(text(h, "preparation-stage-progress"), /analyze sources/);
    assert.match(text(h, "preparation-work-items"), /Reading docs/);
    h.render({ ...value, preparationRuntime: { currentPhase: "old-phase" } }, 11);
    assert.match(text(h, "preparation-stage-progress"), /analyze sources/);
    const ready = state("requirements", 2); ready.preparation.suggestedUsages = ["Suggested requirement"];
    h.render(ready, 13); await h.flush();
    assert.equal(text(h, "current-stage-index"), "2");
    assert.equal(hidden(h, "design-tree-panel"), false);
    assert.equal(disabled(h, "design-tree-tab"), false);
    await browse(h, "prepare");
    assert.match(text(h, "stage-browsing"), /read only/);
    assert.equal(hidden(h, "retry-preparation"), true);
    h.setFetch(async () => response(state("prepare", 3)));
    await h.click("reopen-stage"); await h.confirm();
    assert.equal(h.requests[0].path, "/api/stage/reopen");
    assert.equal(h.requests[0].body.stageId, "prepare");
});

test("Preparation polling uses its status route and retry errors stay visible", async (t) => {
    const value = state("prepare"); value.preparation.status = "failed";
    const h = await setup(t, value);
    h.setFetch(async (path) => path === "/api/preparation/status" ? response(value) : response({ error: "Preparation unavailable" }, 503));
    await h.store.refresh(); await h.flush();
    assert.equal(h.requests[0].path, "/api/preparation/status");
    await h.click("retry-preparation");
    assert.equal(h.requests[1].path, "/api/preparation/retry");
    assert.match(text(h, "preparation-stage-message"), /Preparation unavailable/);
    assert.equal(disabled(h, "retry-preparation"), false);
    h.render({ ...state("requirements", 2), preparation: value.preparation });
    await h.click("retry-preparation"); assert.equal(h.requests.length, 2);
});
