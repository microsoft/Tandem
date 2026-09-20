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
    const value = state("implement");
    value.lifecycle.outputs = [{ stageId: "plan", path: ".tandem\\plan-r2.json" }];
    value.process.acceptances = [{ id: "old", stageId: "plan", snapshotPath: ".tandem\\plan-r1.json",
        acceptedBy: { label: "Owner" }, acceptedAt: "earlier" }];
    const h = await setup(t, value);
    assert.equal(disabled(h, "export-handoff"), true);
    h.render({ ...value, revision: 2, process: { ...value.process, acceptances: [...value.process.acceptances,
        { id: "current", stageId: "plan", snapshotPath: ".tandem\\plan-r2.json", acceptedBy: { label: "Owner" }, acceptedAt: "now" }] } });
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
    await h.input("verification-checks", "[unfinished");
    release(response({ ...value, revision: 2 })); await h.flush();
    assert.equal(field(h, "verification-checks").value, "[unfinished");
});

test("publication is explicit and adapter receipts survive adapter switching", async (t) => {
    const value = state("test");
    value.process.receipts = [{ id: "receipt", adapter: "local", block: "handoff", recordedAt: "now",
        reference: "tandem-records\\delivery\\local", summary: "Not published" }];
    value.process.settings.adapters.handoff = "github";
    value.lifecycle.completedStages.push("test");
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

test("stage finalization cannot overtake a pending artifact review", async (t) => {
    const value = state("design");
    value.artifacts = [{ id: "design", title: "Design", stage: "design", content: "Spec", mermaid: "" }];
    const h = await setup(t, value);
    await h.click(h.get("artifact-list").querySelector("button")!);
    await h.input("design-review-input", "Review this behavior");
    let release!: (r: Response) => void;
    h.setFetch(() => new Promise((resolve) => { release = resolve; }));
    await submit(h, "design-review-form"); await h.click("finish-review");
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].path, "/api/design-review");
    release(response({ ...value, revision: 2 })); await h.flush();
    assert.equal(disabled(h, "finish-review"), false);
});

test("Test design explains automatic drafts and only finalizes resolved review evidence", async (t) => {
    const value = state("design"); value.design.substage = "test"; value.designReview.finalizedArtifactId = "design-spec";
    const h = await setup(t, value);
    assert.match(text(h, "design-review-threads"), /Preparing integration and interaction test-design drafts/);
    assert.match(text(h, "design-review-stage-status"), /automatically before finalization/);
    assert.equal(disabled(h, "finish-review"), true); await h.click("finish-review"); assert.equal(h.requests.length, 0);
    const thread = { id: "default-project-integration-tests", type: "artifact", artifactKind: "test-scenario",
        prompt: "Generate integration drafts", status: "queued", artifactIds: [] };
    h.render({ ...value, revision: 2, testDesignReview: { ...value.testDesignReview, threads: [thread] } });
    assert.match(text(h, "design-review-stage-status"), /Generating design artifacts/);
    assert.equal(disabled(h, "finish-review"), true);
    const answered = { ...value, revision: 3, testDesignReview: { ...value.testDesignReview,
        threads: [{ ...thread, status: "answered", artifactIds: ["integration-draft"] }] },
        artifacts: [{ id: "integration-draft", title: "Integration test draft", stage: "design", kind: "test-scenario",
            content: "Reviewable integration scenarios", mermaid: "", sourceThreadIds: [thread.id], reviewStatus: "current" }] };
    h.render(answered);
    assert.match(text(h, "design-review-stage-status"), /Open each generated artifact/);
    assert.equal(disabled(h, "finish-review"), true);
    await h.click(h.get("design-review-threads").querySelector(".review-artifact-link")!);
    assert.equal(hidden(h, "content-panel"), false);
    assert.equal(text(h, "artifact-heading"), "Integration test draft");
    const resolve = h.get("artifact-review-threads").querySelector('[data-thread-action="resolve"]')!;
    assert.match(resolve.textContent!, /Mark resolved/);
    h.setFetch(async (path) => response({ ...answered, revision: 4, testDesignReview: {
        ...answered.testDesignReview, threads: [{ ...answered.testDesignReview.threads[0], status: "resolved" }],
    } }));
    await h.click(resolve);
    assert.equal(h.requests[0].path, "/api/design-review/thread");
    assert.deepEqual(h.requests[0].body, { threadId: thread.id, action: "resolve" });
    assert.equal(disabled(h, "finish-review"), false);
    assert.match(text(h, "finish-review"), /Finish test design/);
    await h.input("design-review-input", "Also cover invalid requests");
    await h.input("review-request-kind", "test-scenario"); await submit(h, "design-review-form");
    assert.equal(h.requests[1].body.artifactId, "integration-draft");
    assert.equal(h.requests[1].body.artifactKind, "test-scenario");
});

test("artifact review drafts and request kinds are scoped to artifact identity", async (t) => {
    const value = state("design"); value.artifacts = ["a", "b"].map((id) => ({ id, title: id, stage: "design", content: "Spec", mermaid: "" }));
    const h = await setup(t, value);
    const link = (id: string) => h.get("artifact-list").querySelector(`[data-artifact-id="${id}"]`)!;
    await h.click(link("a")); await h.input("design-review-input", "Question about A"); await h.input("review-request-kind", "contract");
    await h.click(link("b")); assert.equal(field(h, "design-review-input").value, "");
    await h.input("design-review-input", "Question about B");
    h.render({ ...value, revision: 2, status: "Updated elsewhere" });
    assert.equal(text(h, "artifact-heading"), "b");
    await h.click(link("a"));
    assert.equal(field(h, "design-review-input").value, "Question about A");
    assert.equal(field(h, "review-request-kind").value, "contract");
});

test("artifact navigation has one empty state and only populated stage groups", async (t) => {
    const value = state("design"), h = await setup(t, value); h.setNarrowViewport(true);
    assert.equal(h.get("artifact-list").querySelectorAll(".artifact-empty").length, 1);
    assert.equal(h.get("artifact-list").querySelectorAll(".artifact-stage-group").length, 0);
    h.render({ ...value, revision: 2, artifacts: [
        { id: "intent", title: "User intent", stage: "requirements", kind: "intent", content: "Intent" },
        { id: "contract", title: "UI contract", stage: "design", kind: "contract", content: "Contract", reviewStatus: "stale" },
    ] });
    assert.equal(h.get("artifact-list").querySelectorAll(".artifact-stage-group").length, 2);
    assert.match(text(h, "artifact-list"), /stale/);
    await h.click("context-toggle"); await h.click(h.get("artifact-list").querySelector('[data-artifact-id="contract"]')!);
    assert.equal(h.get("studio-workspace").dataset.contextOpen, "false");
    assert.equal(text(h, "artifact-heading"), "UI contract");
    assert.equal(hidden(h, "content-panel"), false); assert.equal(h.requests.length, 0);
});

test("failed initial plan requests remain visible and retain revision instructions", async (t) => {
    const h = await setup(t, state("plan"));
    await h.input("plan-revision-input", "Preserve this plan instruction");
    h.setFetch(async () => response({ error: "Rejected" }, 503));
    await submit(h, "plan-revision-form");
    assert.equal(field(h, "plan-revision-input").value, "Preserve this plan instruction");
    assert.match(text(h, "plan-status"), /Rejected/);
    assert.equal(h.get("plan-status").closest("[hidden]"), null);
});

test("draft agent limits survive blur and finalization errors are visible in Design", async (t) => {
    const value = state("plan"), h = await setup(t, value);
    await h.input("plan-max-agents", "9"); field(h, "plan-revision-input").focus();
    h.render({ ...value, revision: 2, status: "Refreshed" });
    assert.equal(field(h, "plan-max-agents").value, "9");
    h.render(state("design", 3)); await h.flush();
    h.setFetch(async () => response({ error: "Could not capture specification" }, 503));
    await h.click("finish-review");
    assert.match(text(h, "design-review-stage-status"), /Could not capture specification/);
    assert.equal(h.get("design-review-stage-status").closest("[hidden]"), null);
});

test("diagram redraws preserve user zoom and unrelated updates reuse generated SVG", async (t) => {
    const h = await reactHarness(t); let renders = 0;
    h.setMermaid(async () => { renders++; return { svg: '<svg viewBox="0 0 800 300"><rect /></svg>' }; });
    const value = state("plan"); value.planning.workItems = [{ id: "work", title: "Build", dependencies: [] }];
    h.render(value); await h.flush();
    const section = h.get("plan-dag-section");
    await h.click(section.querySelector('[aria-label="Actual size"]')!);
    await h.click(section.querySelector('[aria-label="Zoom in"]')!);
    assert.equal(h.get("plan-dag").style.getPropertyValue("--diagram-width"), "1000px");
    const before = renders;
    h.render({ ...value, revision: 2, status: "Unrelated" }); await h.flush();
    assert.equal(renders, before);
    h.render({ ...value, revision: 3, planning: { ...value.planning, workItems: [{ id: "work", title: "Changed title", dependencies: [] }] } });
    await h.flush();
    assert.equal(renders, before + 1);
    assert.equal(h.get("plan-dag").style.getPropertyValue("--diagram-width"), "1000px");
    assert.deepEqual(h.errors, []);
});

test("runtime-only updates preserve expanded implementation and test evidence with focus", async (t) => {
    const value = state("implement"); value.planning.workItems = [{ id: "done", title: "Completed work" }];
    value.implementation = { status: "running", workItems: [{ id: "done", status: "completed", summary: "Evidence" }] };
    const h = await setup(t, value);
    const card = h.get("implementation-work-items").querySelector(".implementation-card")!;
    const toggle = card.querySelector<HTMLButtonElement>("button")!;
    await h.click(toggle); toggle.focus();
    h.render({ ...value, implementationRuntime: { liveAgentCount: 0, progress: [{ seq: 1, text: "Another task updated" }] } });
    assert.equal(toggle.getAttribute("aria-expanded"), "true"); assert.equal(h.document.activeElement, toggle);
    assert.match(text(h, "implementation-progress"), /0 live agents/);
    const testState = state("test", 2);
    testState.testDesignReview.scenarios = [{ id: "passed", title: "Passed scenario" }];
    testState.testing = { status: "running", scenarios: [{ id: "passed", status: "passed" }] };
    h.render(testState); await h.flush();
    const scenario = h.get("test-scenarios").querySelector(".implementation-card")!;
    const scenarioToggle = scenario.querySelector<HTMLButtonElement>("button")!;
    await h.click(scenarioToggle);
    h.render({ ...testState, testRuntime: { liveAgentCount: 1 } });
    assert.equal(scenarioToggle.getAttribute("aria-expanded"), "true");
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
    assert.equal(h.get("stage-list").querySelectorAll("button").length, 8);
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

test("completed Tests can run again while historical test views cannot mutate", async (t) => {
    const value = state("test"); value.lifecycle.completedStages.push("test");
    value.testDesignReview.scenarios = [{ id: "scenario", title: "Scenario" }];
    value.testing = { status: "completed", scenarios: [{ id: "scenario", status: "passed" }] };
    const h = await setup(t, value);
    assert.equal(text(h, "start-tests").trim(), "Run tests again");
    assert.equal(disabled(h, "start-tests"), false);
    h.setFetch(async () => response({ ...value, revision: 2, testing: { ...value.testing, status: "starting" } }));
    await h.click("start-tests");
    assert.equal(h.requests[0].path, "/api/test/start");
    assert.equal(disabled(h, "start-tests"), true);
    h.render({ ...value, revision: 3, lifecycle: { ...value.lifecycle, currentStage: "implement" } }); await browse(h, "test");
    assert.equal(hidden(h, "test-panel"), false); assert.equal(disabled(h, "start-tests"), true);
    await h.click("start-tests"); assert.equal(h.requests.length, 1);
});

test("detailed test diagnostics preserve expansion and focus until a new run replaces them", async (t) => {
    const value = state("test");
    value.testing = { status: "failed", requestId: "run-one", error: "Test failed", errorDetails: "Command: npm test\nExit code: 1", scenarios: [] };
    const h = await setup(t, value);
    assert.equal(hidden(h, "test-error-toggle"), false);
    await h.click("test-error-toggle");
    assert.equal(hidden(h, "test-error-details"), false);
    assert.equal(h.document.activeElement, h.get("test-error-details"));
    h.render({ ...value, testRuntime: { progress: [{ seq: 1, text: "Agent stopped" }] } });
    assert.equal(hidden(h, "test-error-details"), false);
    assert.equal(h.document.activeElement, h.get("test-error-details"));
    assert.match(text(h, "test-error-details"), /Exit code: 1/);
    h.render({ ...value, revision: 2, testing: { ...value.testing, requestId: "run-two" } }); await h.flush();
    assert.equal(hidden(h, "test-error-details"), true);
});
