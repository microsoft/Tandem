import assert from "node:assert/strict";
import { test } from "node:test";
import { projectApplicationCapabilities } from "../src/application-interface.js";
import { newPrototypeFlow, type PrototypeCheckpoint, type PrototypeMilestone } from "../src/prototype-flow.js";
import type { LifecycleStageId, PreparationState, PrototypeApproachMode } from "../src/types.js";
import type { SketchState } from "../src/sketch.js";
import { lifecycleStages, type DecisionNode } from "../src/workflow.js";
import { canBrowseStage, canOpenDevelopment, hasActiveJobs, type UiState } from "../src/renderer/ui-context.js";
import { projectDiscovery } from "../src/renderer/project-conversation.js";
import { reactHarness, response, state } from "./helpers/react-harness.js";
import { extensionHarness } from "./helpers/extension-harness.js";
import { sketchFixture, sketchSetup } from "./renderer-fixtures.test.js";
import { exploringPrototype } from "./helpers/visual-fixture.js";

function answered(): DecisionNode {
    return { id: "task", title: "Task behavior", status: "answered", answer: "Save locally", dependencies: [],
        question: { id: "task", text: "How are tasks saved?", rationale: "", choices: ["Save locally", "Use a server", "Do not save"],
            recommended: "Save locally", allowFreeText: true, answerPlaceholder: "" } };
}

function readyRequirements(): UiState {
    const value = state("requirements");
    value.requirements = { substage: "dag", usageItems: ["I want to save tasks."], suggestions: [] };
    value.decisionGraph.nodes = [answered()];
    return value;
}

function checkpoint(milestone: PrototypeMilestone, status: PrototypeCheckpoint["status"]): PrototypeCheckpoint {
    return { id: `${milestone}-${status}`, requestId: "build", generation: "fixture-generation", milestone, status,
        revisionId: null, baseCheckpointId: null, sourceCheckpointId: null, workspacePath: "workspaces\\prototype",
        workspacePrepared: true, previewUrl: status === "ready" ? "http://127.0.0.1:9999/" : null,
        summary: "Saved checkpoint", focus: "Primary task", requestedAt: "2026-10-28T00:00:00Z",
        completedAt: status === "running" ? null : "2026-10-28T00:01:00Z", timeoutSeconds: null };
}

function prototype(milestone: PrototypeMilestone = "prototype", status: PrototypeCheckpoint["status"] = "ready"): UiState {
    const value = state("prototype"), item = checkpoint(milestone, status);
    value.prototypeFlow = { ...newPrototypeFlow(), checkpoints: [item],
        displayedCheckpointId: status === "ready" ? item.id : null, activeCheckpointId: status === "running" ? item.id : null };
    value.previewStatus = status === "ready" ? "ready" : status === "running" ? "starting" : "waiting";
    value.previewUrl = item.previewUrl;
    return value;
}

const activeJobs: Record<string, (value: UiState) => void> = {
    "starting request": value => { value.processing = { status: "starting" }; },
    "running request": value => { value.processing = { status: "running" }; },
    "starting Preparation": value => { value.preparation.status = "starting"; },
    "running Preparation": value => { value.preparation.status = "running"; },
    "unsettled Preparation": value => { value.preparation.processing = {
        requestId: "prepare", generation: value.generation, runId: "prepare-run", requestedAt: value.updatedAt, completedAt: null,
    }; },
    "usage suggestions": value => { value.suggestionProcessing = { status: "running" }; },
    "planning": value => { value.planning.processing = { requestId: "plan" }; },
    "starting implementation": value => { value.implementation.status = "starting"; },
    "running implementation": value => { value.implementation.status = "running"; },
    "starting tests": value => { value.testing.status = "starting"; },
    "running tests": value => { value.testing.status = "running"; },
    "starting preview": value => { value.previewStatus = "starting"; },
    "running checkpoint": value => { value.prototypeFlow = prototype("prototype", "running").prototypeFlow; },
    ...Object.fromEntries((["designReview", "testDesignReview"] as const).flatMap(key => [
        [`${key} worker`, (value: UiState) => { value[key].processing = { requestId: "review" }; }],
        [`${key} finalizing`, (value: UiState) => { value[key].finalizeRequested = true; }],
        ...["queued", "processing"].map(status => [`${key} ${status}`, (value: UiState) => { value[key].threads = [{ status }]; }]),
    ])),
    ...Object.fromEntries((["implementation", "testing"] as const).flatMap(key => [
        [`${key} unconfirmed cancellation`, (value: UiState) => { value[key] = { status: "cancelled", runId: "run" }; }],
        [`${key} unconfirmed failure`, (value: UiState) => { value[key] = { status: "failed", runId: "run" }; }],
        [`${key} cancellation pending`, (value: UiState) => { value[key] = {
            status: "completed", terminalConfirmedAt: value.updatedAt, cancellation: { confirmedAt: null },
        }; }],
    ])),
};

test("all active-work sources fence completion and Development, then release on a settled snapshot", async t => {
    const h = await reactHarness(t);
    let revision = 0;
    for (const [name, apply] of Object.entries(activeJobs)) {
        await t.test(name, async () => {
            const value = readyRequirements();
            value.revision = ++revision;
            value.application = projectApplicationCapabilities(value);
            apply(value);
            assert.equal(hasActiveJobs(value), true, name);
            assert.equal(canOpenDevelopment(value), false, name);
            h.render(value); await h.flush();
            assert.equal(h.get<HTMLButtonElement>("complete-stage").disabled, true, name);
            await h.click("complete-stage");
            const settled = readyRequirements(); settled.revision = ++revision;
            h.render(settled); await h.flush();
            assert.equal(h.get<HTMLButtonElement>("complete-stage").disabled, false, `${name}: released`);
            assert.equal(canOpenDevelopment(settled), true);
        });
    }
    assert.deepEqual(h.requests, [], "Rendering and clicking blocked controls must not submit or retry work.");
    assert.deepEqual(h.errors, []);
});

test("settled and failed-without-launch work does not strand the UI", () => {
    const value = readyRequirements();
    for (const key of ["implementation", "testing"] as const) {
        for (const execution of [
            { status: "completed" }, { status: "failed", runId: null },
            { status: "failed", runId: "run", terminalConfirmedAt: value.updatedAt },
            { status: "cancelled", runId: "run", terminalConfirmedAt: value.updatedAt, cancellation: { confirmedAt: value.updatedAt } },
        ]) {
            const settled = { ...value, [key]: execution };
            assert.equal(hasActiveJobs(settled), false, `${key}: ${JSON.stringify(execution)}`);
            assert.equal(canOpenDevelopment(settled), true);
        }
    }
    for (const receipt of [
        { requestId: "launch", generation: value.generation, runId: null },
        { requestId: "launch", generation: value.generation, runId: "run" },
    ]) {
        assert.equal(canOpenDevelopment({ ...value, factoryRuns: [receipt] }), false);
        assert.equal(canOpenDevelopment({ ...value, factoryRuns: [{ ...receipt, terminal: true }] }), true);
    }
    assert.equal(canOpenDevelopment({ ...value, developmentBlocker: "Inspect saved ownership." }), false);
    assert.equal(canOpenDevelopment({ ...value, provider: { canSubmitAnswers: false } }), false);
    assert.equal(canOpenDevelopment({ ...value, effortReset: { requestId: "reset", generation: value.generation, error: "" } }), false);
});

test("all lifecycle stages keep current, historical, skipped and future navigation distinct", () => {
    const stages: Record<LifecycleStageId, number> = { prepare: 0, requirements: 1, sketch: 2, prototype: 3, development: 4 };
    assert.deepEqual(lifecycleStages.map(item => item.id), Object.keys(stages));
    for (const current of Object.keys(stages) as LifecycleStageId[]) {
        const value = state(current);
        for (const target of Object.keys(stages) as LifecycleStageId[]) {
            assert.equal(canBrowseStage(value, target), target === "development" || stages[target] <= stages[current], `${current} -> ${target}`);
            if (target === "development") continue;
            const skipped = { ...value, lifecycle: { ...value.lifecycle,
                skippedStages: [{ stageId: target, reason: "Not applicable", skippedAt: value.updatedAt }] } };
            assert.equal(canBrowseStage(skipped, target), false, `${target}: explicitly skipped`);
            const historical = state("prepare");
            historical.lifecycle.history.push({ stageId: target, path: "saved.md", completedAt: value.updatedAt });
            assert.equal(canBrowseStage(historical, target), true, `${target}: retained history`);
            historical.lifecycle.history = [];
            historical.artifacts.push({ id: "saved", stage: target, kind: "markdown", title: "Saved evidence",
                path: "saved.md", content: "", language: "markdown", mermaid: "" });
            assert.equal(canBrowseStage(historical, target), true, `${target}: saved artifact`);
        }
    }
    const nonGraphical = state("requirements");
    nonGraphical.prototypeApproach = { mode: "not-applicable", reason: "Command-line tool" };
    for (const target of ["sketch", "prototype"] as const) assert.equal(canBrowseStage(nonGraphical, target), false);
});

test("the conversation composer projects every stage without borrowing another stage's input authority", () => {
    const cases: Array<[UiState, string, boolean]> = [
        [{ ...state("prepare"), goal: "" }, "goal", true],
        [state("prepare"), "none", false],
        [state("requirements"), "usage", true],
        [readyRequirements(), "change", true],
        [state("sketch"), "sketch", true],
        [prototype(), "prototype", true],
        [state("development"), "none", false],
    ];
    for (const [value, action, enabled] of cases) {
        const original = structuredClone(value);
        assert.equal(projectDiscovery(value, false).action, action);
        assert.equal(projectDiscovery(value, false).enabled, enabled);
        assert.equal(projectDiscovery(value, true).enabled, false, `${action}: local request pending`);
        assert.equal(projectDiscovery({ ...value, provider: { canSubmitAnswers: false } }, false).enabled, false, `${action}: read-only`);
        assert.equal(projectDiscovery({ ...value, lifecycle: { ...value.lifecycle, completedStages: [value.stage] } }, false).enabled, false,
            `${action}: completed`);
        for (const { id: viewed } of lifecycleStages) {
            if (viewed !== value.stage) {
                assert.equal(projectDiscovery(value, false, viewed).action, "none", `${action}: browsing ${viewed}`);
                assert.equal(projectDiscovery(value, false, viewed).enabled, false);
            }
        }
        assert.deepEqual(value, original);
    }
    const value = prototype();
    value.processing = { action: "build-prototype", status: "running" };
    assert.equal(projectDiscovery(value, false).enabled, true, "Prototype feedback can queue behind a build.");
    value.processing.action = "generate-design-spec";
    assert.equal(projectDiscovery(value, false).enabled, false, "Frozen handoff input cannot accept more feedback.");
});

test("every Preparation status has truthful results, retry availability and no automatic UI mutation", async t => {
    const cases: Record<PreparationState["status"], { title: string; retry: boolean; message: RegExp }> = {
        "not-started": { title: "Preparing Tandem context", retry: false, message: /Preparation is starting/ },
        starting: { title: "Preparing Tandem context", retry: false, message: /Preparation is starting/ },
        running: { title: "Preparing Tandem context", retry: false, message: /Preparation is starting/ },
        ready: { title: "Preparation results", retry: false, message: /Preparation has completed/ },
        "needs-attention": { title: "Preparation results", retry: false, message: /Preparation has completed/ },
        failed: { title: "Preparation needs attention", retry: true, message: /stopped before completion/ },
    };
    const h = await reactHarness(t);
    let revision = 0;
    for (const [status, expected] of Object.entries(cases)) {
        const value = state("prepare", ++revision);
        value.preparation.status = status as PreparationState["status"];
        h.render(value); await h.flush();
        assert.equal(h.get("preparation-stage-status").dataset.status, status);
        assert.equal(h.get("preparation-stage-title").textContent, expected.title);
        assert.match(h.get("preparation-stage-progress").textContent, expected.message);
        assert.equal(h.get("retry-preparation").hidden, !expected.retry);
        assert.equal(h.get("show-next-action").hidden, !expected.retry);
        assert.equal(h.get<HTMLButtonElement>("complete-stage").disabled, true);
        if (status === "needs-attention") assert.match(h.get("preparation-stage-message").textContent, /completed with blockers/);
        value.provider = { ...value.provider, canSubmitAnswers: false };
        h.render({ ...value, revision: ++revision }); await h.flush();
        assert.equal(h.get<HTMLButtonElement>("retry-preparation").disabled, true, `${status}: read-only`);
        assert.equal(h.get("show-next-action").hidden, true);
        await h.click("retry-preparation");
    }
    assert.deepEqual(h.requests, []);
    assert.deepEqual(h.errors, []);
});

test("Requirements completion follows every substage, answer and prototype-approach gate", async t => {
    const h = await reactHarness(t);
    let revision = 0;
    const approaches: Record<PrototypeApproachMode, boolean> = {
        undecided: false, build: true, "validate-existing": true, "not-applicable": true,
    };
    for (const [approach, ready] of Object.entries(approaches)) {
        for (const substage of ["usage", "dag"] as const) {
            for (const nodes of [[], [answered()], [{ ...answered(), answer: null, status: "active" as const }]]) {
                const value = readyRequirements();
                value.revision = ++revision;
                value.requirements.substage = substage;
                value.prototypeApproach.mode = approach as PrototypeApproachMode;
                value.decisionGraph.nodes = nodes;
                h.render(value); await h.flush();
                assert.equal(h.get<HTMLButtonElement>("complete-stage").disabled,
                    !(ready && substage === "dag" && nodes.length && nodes.every(node => node.answer)),
                    `${approach}: ${substage}: ${JSON.stringify(nodes.map(node => node.answer))}`);
            }
        }
    }
    assert.deepEqual(h.requests, []);
    assert.deepEqual(h.errors, []);
});

test("all Designs states and each approval identity field control completion independently", async t => {
    const cases: Record<SketchState["status"], boolean> = { empty: false, draft: false, approved: true, stale: false };
    for (const [status, complete] of Object.entries(cases)) {
        await t.test(status, async t => {
            const fixture = sketchFixture();
            fixture.value.sketch.status = status;
            if (status === "empty") fixture.value.sketch.current = null;
            else if (status === "approved" || status === "stale") {
                const current = fixture.value.sketch.current;
                fixture.value.sketch.approved = { revisionId: current.id, documentHash: current.documentHash,
                    requirementsDigest: current.requirementsDigest, approvedAt: fixture.value.updatedAt, assets: [] };
            }
            const { h, value } = await sketchSetup(t, fixture);
            assert.equal(h.get<HTMLButtonElement>("complete-stage").disabled, !complete);
            assert.equal(h.get("sketch-empty").hidden, status !== "empty");
            if (status === "stale") {
                assert.equal(h.get<HTMLButtonElement>("sketch-approve").disabled, true);
                assert.equal(h.get<HTMLButtonElement>("sketch-update-requirements").disabled, false);
            }
            if (complete) {
                let revision = value.revision;
                for (const field of ["revisionId", "documentHash", "requirementsDigest"] as const) {
                    h.render({ ...value, revision: ++revision, sketch: { ...value.sketch,
                        approved: { ...value.sketch.approved, [field]: "different" } } });
                    await h.flush();
                    assert.equal(h.get<HTMLButtonElement>("complete-stage").disabled, true, field);
                    await h.click("complete-stage");
                }
                h.render({ ...value, revision: ++revision }); await h.flush();
                assert.equal(h.get<HTMLButtonElement>("complete-stage").disabled, false);
            }
            assert.ok(h.requests.every(request => request.path === "/api/sketch" && !request.body));
        });
    }
});

test("all Prototype checkpoint states preserve the applied preview and never invent readiness", async t => {
    const statuses: Record<PrototypeCheckpoint["status"], boolean> = { running: false, ready: true, failed: false, clarifying: false };
    const milestones: Record<PrototypeMilestone, boolean> = { prototype: true, structure: false, interaction: true, visual: false };
    for (const [milestone, complete] of Object.entries(milestones)) {
        await t.test(milestone, async t => {
            const h = await reactHarness(t);
            let revision = 0;
            for (const [status, ready] of Object.entries(statuses)) {
                const value = prototype(milestone as PrototypeMilestone, status as PrototypeCheckpoint["status"]);
                value.revision = ++revision;
                h.render(value); await h.flush();
                assert.equal(h.get<HTMLButtonElement>("complete-stage").disabled, !(complete && ready), `${milestone}: ${status}`);
                if (!ready) await h.click("complete-stage");
                assert.equal(h.store.getSnapshot().state.prototypeFlow.displayedCheckpointId, value.prototypeFlow!.displayedCheckpointId);
            }
            assert.deepEqual(h.requests, []);
            assert.deepEqual(h.errors, []);
        });
    }
});

test("Prototype preview and feedback states gate Finish without discarding the accepted version", async t => {
    const h = await reactHarness(t);
    let revision = 0;
    const previews: Record<UiState["previewStatus"], boolean> = { waiting: false, starting: false, ready: true, error: false };
    for (const [previewStatus, complete] of Object.entries(previews)) {
        const value = prototype(); value.revision = ++revision;
        value.previewStatus = previewStatus as UiState["previewStatus"];
        h.render(value); await h.flush();
        assert.equal(h.get<HTMLButtonElement>("complete-stage").disabled, !complete, previewStatus);
    }
    for (const status of ["queued", "processing", "clarifying", "ready", "failed", "applied", "dismissed"]) {
        const value = prototype(); value.revision = ++revision;
        value.prototypeReview.revisions = [{ id: "feedback", status, suggestion: "Keep my exact request." }];
        h.render(value); await h.flush();
        const blocked = !["applied", "dismissed"].includes(status);
        assert.equal(h.get<HTMLButtonElement>("complete-stage").disabled, blocked, status);
        if (blocked) await h.click("complete-stage");
        assert.equal(h.store.getSnapshot().state.previewUrl, value.previewUrl);
        assert.deepEqual(h.store.getSnapshot().state.prototypeReview.revisions, value.prototypeReview.revisions);
    }
    assert.deepEqual(h.requests, []);
    assert.deepEqual(h.errors, []);
});

test("authoritative completion blockers disable Finish and guidance until a fresh capability allows it", async t => {
    const h = await reactHarness(t), value = readyRequirements();
    const blocker = "Reconcile the saved whole-graph defaults successfully before completing Requirements.";
    value.application = projectApplicationCapabilities({ ...value, stageCompletionBlocker: blocker });
    h.render(value); await h.flush();
    assert.equal(h.get<HTMLButtonElement>("complete-stage").disabled, true);
    assert.equal(h.get("show-next-action").hidden, true);
    assert.match(h.get("stage-message").textContent, /Reconcile the saved whole-graph defaults/);
    assert.equal(h.get("complete-stage").title, blocker);
    assert.equal(h.get("next-action-guide").textContent, blocker);
    await h.click("complete-stage");
    assert.deepEqual(h.requests, []);
    h.render({ ...value, application: projectApplicationCapabilities(value) });
    await h.flush();
    assert.equal(h.get<HTMLButtonElement>("complete-stage").disabled, false, "Transport-only capability updates do not need a new saved revision.");
    assert.equal(h.get("show-next-action").hidden, false);
    assert.doesNotMatch(h.get("stage-message").textContent, /Reconcile the saved whole-graph defaults/);
    assert.deepEqual(h.requests, []);
    assert.deepEqual(h.errors, []);
});

test("real host completion policy and rendered Finish agree on failed reconciliation and artifact capacity", async t => {
    const host = await extensionHarness(); t.after(() => host.close());
    const h = await reactHarness(t);
    const cases: Array<[string, (value: UiState) => void, RegExp]> = [
        ["failed defaults", value => { value.processing = { action: "apply-defaults", status: "error" }; }, /Reconcile the saved whole-graph defaults/],
        ["artifact capacity", value => { value.artifacts = Array.from({ length: 30 }, (_, index) => ({
            id: `artifact-${index}`, title: `Artifact ${index}`, kind: "markdown", stage: "requirements",
            path: `artifact-${index}.md`, language: "markdown", content: "", mermaid: "",
        })); }, /Remove 1 artifact/],
    ];
    let revision = 0;
    for (const [name, mutate, message] of cases) {
        const value = readyRequirements(); value.revision = ++revision; mutate(value);
        const blocker = host.api.stageCompletionError(value, "requirements");
        assert.ok(blocker, name);
        assert.match(blocker, message, name);
        value.application = projectApplicationCapabilities({ ...value, stageCompletionBlocker: blocker });
        h.render(value); await h.flush();
        assert.equal(h.get<HTMLButtonElement>("complete-stage").disabled, true, name);
        assert.match(h.get("stage-message").textContent, message);
        await h.click("complete-stage");
    }
    assert.deepEqual(h.requests, []);
    assert.deepEqual(host.requests, []);
    assert.deepEqual(h.errors, []);
});

test("Finish can explicitly keep optional visuals without bypassing other host completion blockers", async t => {
    const host = await extensionHarness(); t.after(() => host.close());
    const h = await reactHarness(t), value = exploringPrototype();
    const project = (snapshot: UiState) => projectApplicationCapabilities({
        ...snapshot, stageCompletionBlocker: host.api.stageCompletionError(snapshot, "prototype", { requirePrototypeSpec: false }),
    }, { canFinishPrototypeWithCurrentVisual: !host.api.stageCompletionError(snapshot, "prototype",
        { requirePrototypeSpec: false, keepCurrentVisual: true }) });
    value.application = project(value);
    assert.equal(value.application.operations["stages.complete"].status, "blocked", "The primitive still requires a visual decision.");
    assert.equal(value.application.canFinishPrototypeWithCurrentVisual, true);
    h.render(value); await h.flush();
    assert.equal(h.get<HTMLButtonElement>("complete-stage").disabled, false);
    const blocked = { ...value, revision: 2, prototypeReview: { ...value.prototypeReview,
        revisions: [{ id: "feedback", status: "failed", suggestion: "Unresolved work" }] } };
    blocked.application = project(blocked);
    assert.equal(blocked.application.canFinishPrototypeWithCurrentVisual, false, "Keeping visuals cannot waive unresolved feedback.");
    h.render(blocked); await h.flush();
    assert.equal(h.get<HTMLButtonElement>("complete-stage").disabled, true);
    await h.click("complete-stage");
    const readonly = { ...value, revision: 3, provider: { canSubmitAnswers: false } };
    readonly.application = project(readonly);
    h.render(readonly); await h.flush();
    assert.equal(h.get<HTMLButtonElement>("complete-stage").disabled, true, "Readiness is not write authority.");
    assert.equal(h.requests.length, 0);
    const ready = { ...value, revision: 4 };
    h.render(ready); await h.flush();
    h.setFetch(async (path, options) => {
        const body = JSON.parse(String(options.body));
        if (path === "/api/prototype/action") {
            assert.deepEqual(body, { action: "skip-visual", expectedRevision: ready.revision });
            const kept = { ...ready, revision: 5, prototypeFlow: { ...ready.prototypeFlow!, visualRequested: false } };
            kept.application = project(kept);
            return response(kept);
        }
        assert.equal(path, "/api/stage/complete");
        assert.deepEqual(body, { stageId: "prototype", continueDevelopment: true });
        return response({ ...h.store.getSnapshot().state, revision: 6,
            processing: { status: "running", action: "generate-design-spec" } });
    });
    await h.click("complete-stage"); await h.flush();
    assert.deepEqual(h.requests.map(request => request.path), ["/api/prototype/action", "/api/stage/complete"]);
    assert.equal(h.store.getSnapshot().state.prototypeFlow.displayedCheckpointId, value.prototypeFlow!.displayedCheckpointId);
    assert.deepEqual(host.requests, []);
    assert.deepEqual(h.errors, []);
});

test("initial loading, disconnected, invalid and recovered snapshots retain saved work without implicit mutations", async t => {
    const h = await reactHarness(t);
    assert.match(h.get("start-loading").textContent, /Loading your project/);
    h.setFetch(async () => response({ error: "Unavailable" }, 503));
    await assert.rejects(h.store.refresh(), /Could not load studio state/); await h.flush();
    assert.match(h.get("start-loading").textContent, /Connection interrupted/);
    const value = readyRequirements();
    h.setFetch(async () => response(value));
    await h.store.refresh(); await h.flush();
    assert.equal(h.store.getSnapshot().connectionError, "");
    h.setFetch(async () => response({ prototypeId: value.prototypeId, lifecycle: { currentStage: "unsupported" } }));
    await assert.rejects(h.store.refresh(), /invalid state/); await h.flush();
    assert.equal(h.store.getSnapshot().state.revision, value.revision);
    assert.match(h.get("connection-status").textContent, /Connection interrupted/);
    assert.equal(h.get("next-action-bar").dataset.status, "error");
    h.setFetch(async () => response(value));
    await h.store.refresh(); await h.flush();
    assert.equal(h.get("connection-status").textContent, "");
    assert.equal(h.get("next-action-bar").dataset.status, "idle");
    assert.ok(h.requests.every(request => !request.options.method));
    assert.deepEqual(h.errors, []);
});
