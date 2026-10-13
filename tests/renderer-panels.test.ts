import assert from "node:assert/strict";
import { test } from "node:test";
import { reactHarness, setup, state, response, text, field, disabled, hidden, current, submit, browse, waitFor } from "./renderer-fixtures.test.js";

test("process setting drafts survive SSE and stale-save errors without rebasing their revision", async (t) => {
    const value = state(), h = await setup(t, value);
    await h.input("handoff-adapter", "github"); await h.input("process-repository", "owner/repo");
    h.render({ ...value, revision: 2 });
    assert.equal(field(h, "handoff-adapter").value, "github");
    h.setFetch(async () => response({ error: "The effort changed. Review and retry." }, 409));
    await h.click("save-process"); await h.confirm();
    assert.equal(h.requests[0].body.expectedRevision, 1);
    assert.equal(h.requests[0].body.settings.adapters.status, "local");
    assert.match(text(h, "process-message"), /effort changed/);
    assert.equal(field(h, "process-repository").value, "owner/repo");
    await h.click("reset-process"); await h.confirm(); assert.equal(field(h, "handoff-adapter").value, "local");
});

test("handoff export accepts only current completed-stage acceptance and explicit confirmation", async (t) => {
    const value = state("prototype");
    value.lifecycle.outputs = [{ stageId: "requirements", path: ".tandem\\requirements-r2.json" }];
    value.process.acceptances = [{ id: "old", stageId: "requirements", snapshotPath: ".tandem\\requirements-r1.json",
        acceptedBy: { label: "Owner" }, acceptedAt: "earlier" }];
    const h = await setup(t, value);
    assert.equal(disabled(h, "export-handoff"), true);
    h.render({ ...value, revision: 2, process: { ...value.process, acceptances: [...value.process.acceptances,
        { id: "current", stageId: "requirements", snapshotPath: ".tandem\\requirements-r2.json", acceptedBy: { label: "Owner" }, acceptedAt: "now" }] } });
    assert.equal(disabled(h, "export-handoff"), false);
    await h.click("export-handoff"); await h.confirm(false); assert.equal(h.requests.length, 0);
    h.setFetch(async () => response({ ...value, revision: 3 }));
    await h.click("export-handoff"); await h.confirm();
    assert.equal(h.requests[0].body.acceptanceId, "current");
});

test("pending process mutation blocks completion while preserving newly edited settings", async (t) => {
    const value = state("prototype"); value.previewStatus = "ready";
    value.prototypeReview.designSpecArtifactId = "draft-feature-spec";
    const h = await setup(t, value);
    let release!: (r: Response) => void;
    h.setFetch(() => new Promise((resolve) => { release = resolve; }));
    await h.click("save-process"); await h.confirm(); await h.click("complete-stage");
    assert.equal(h.requests.length, 1);
    await h.input("process-repository", "replacement/repository");
    release(response({ ...value, revision: 2 })); await h.flush();
    assert.equal(field(h, "process-repository").value, "replacement/repository");
});

test("publication is explicit and adapter receipts survive adapter switching", async (t) => {
    const value = state("prototype");
    value.process.receipts = [{ id: "receipt", adapter: "local", block: "handoff", recordedAt: "now",
        reference: "tandem-records\\delivery\\local", summary: "Not published" }];
    value.process.settings.adapters.handoff = "github";
    value.lifecycle.outputs = [{ stageId: "development", path: ".tandem\\development-r1.json", completedAt: "now" }];
    value.process.deliveryDraft = { id: "delivery", title: "Delivery", body: "Reviewed delivery draft",
        sourceFingerprint: "source", acceptanceIds: ["accepted"], base: "main", head: "work" };
    const h = await setup(t, value);
    assert.match(text(h, "process-receipts"), /local \/ handoff/);
    await h.click("publish-delivery");
    await h.confirm(false);
    assert.equal(h.requests.length, 0);
    assert.match(text(h, "process-receipts"), /Not published/);
});

test("GitHub intake never sends stale Local JSON to the selected adapter", async (t) => {
    const value = state(); value.process.settings.adapters.intake = "github";
    const h = await setup(t, value);
    await h.input("intake-content", '{"title":"Old local data","body":"Do not send"}');
    await h.input("process-reference", "https://github.com/Example/Tandem/issues/23");
    h.setFetch(async () => response({ ...value, revision: 2 })); await h.click("import-intake"); await h.confirm();
    assert.equal(h.requests[0].path, "/api/process");
    assert.equal(h.requests[0].body.action, "intake");
    assert.equal(Object.hasOwn(h.requests[0].body, "content"), false);
});

test("artifact navigation has one empty state and only populated stage groups", async (t) => {
    const value = state("prototype"), h = await setup(t, value); h.setNarrowViewport(true);
    assert.equal(h.get("artifact-list").querySelectorAll(".artifact-empty").length, 1);
    assert.equal(h.get("artifact-list").querySelectorAll(".artifact-stage-group").length, 0);
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
    const before = renders;
    h.render({ ...value, revision: 2, status: "Unrelated" }); await h.flush();
    assert.equal(renders, before);
    h.render({ ...value, revision: 3, artifacts: [{ ...value.artifacts[0], mermaid: "flowchart LR\nA-->C" }] });
    await h.flush();
    assert.equal(renders, before + 1);
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
