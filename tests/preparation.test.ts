import assert from "node:assert/strict";
import { link, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { extensionHarness } from "./helpers/extension-harness.js";
import type { PreparationToken } from "../src/agent-runner.js";
import type { TandemState } from "../src/types.js";
import { inspectEmptyPreparationWorkspace } from "../src/preparation.js";
import { buildPreparationIntentPrompt } from "../src/planning-prompts.js";

function tokenFor(state: TandemState, runId: string | null): PreparationToken {
    assert.ok(state.preparation.processing?.requestId);
    return { requestId: state.preparation.processing.requestId, generation: state.generation, runId };
}

function readyRequirements(state: TandemState) {
    state.stage = "requirements";
    state.lifecycle = { ...state.lifecycle, currentStage: "requirements", completedStages: ["prepare"] };
    state.requirements = { substage: "dag", usageItems: ["I want to use the deliverable."], suggestions: [] };
    state.decisionGraph.nodes = [{ id: "usage", title: "Usage", dependencies: [], question: null, answer: "Confirmed", status: "answered" }];
    return state;
}

function goalOnlyHandoff() {
    return {
        status: "ready", summary: "Ready to define the coffee shop website.",
        checks: [], sources: [],
        suggestedUsages: ["I want to browse the coffee shop menu.", "I want to find opening hours and the shop location."],
        prototypeApproach: { mode: "build", reason: "The new website needs graphical validation." },
        assumed: ["The website is a new application."],
        deferred: ["Research accepted usages in Requirements; select the stack and verify execution prerequisites in Development."],
    };
}

async function requestPreparation(fixture: Awaited<ReturnType<typeof extensionHarness>>, state: TandemState) {
    await fixture.api.persistState(state);
    const pending = await fixture.api.ensurePreparationStarted(state, true);
    await fixture.waitForRequests();
    const request = fixture.requests[0];
    assert.ok(request && typeof request === "object" && "args" in request);
    assert.ok(request.args && typeof request.args === "object");
    return { pending, args: request.args };
}

for (const effort of [undefined, "low"]) test(`automatic Preparation binds its run, preserves ${effort ?? "default"} effort and writes a versioned Requirements handoff`, async () => {
    const fixture = await extensionHarness();
    try {
        await writeFile(join(fixture.root, "package.json"), '{"name":"existing-app"}');
        fixture.api.setSession({ ...fixture.session, rpc: { ...fixture.session.rpc, model: {
            getCurrent: async () => ({ modelId: "fixture-model", ...(effort ? { reasoningEffort: effort } : {}) }),
        } } });
        const state = fixture.api.createState("sample", "Build an app");
        await fixture.api.persistState(state);
        const pending = await fixture.api.ensurePreparationStarted(state, true);
        await fixture.waitForRequests();
        assert.equal(fixture.requests.length, 1);
        const request = fixture.requests[0];
        assert.ok(request && typeof request === "object" && "args" in request);
        assert.ok(request.args && typeof request.args === "object");
        assert.ok(Object.keys(request.args).every((key) =>
            Object.hasOwn(fixture.api.preparationFactory.meta.argsSchema.properties, key)));
        const results = [
            { summary: "Workspace inspected", checks: [{ label: "Node", status: "ready", detail: "Available" }] },
            { requiresSourceResearch: false, handoff: {
                ...goalOnlyHandoff(), summary: "Ready for Requirements", suggestedUsages: ["I want to inspect my tasks."],
            } },
        ];
        const keys: string[] = [];
        const labels: string[] = [];
        const result = await fixture.api.preparationFactory.run({
            args: request.args, runId: "prepare-run", phase() {}, log() {},
            step: async (key: string, work: () => Promise<unknown>) => { keys.push(key); return work(); },
            agent: async (_prompt: string, options: { label: string; agent?: string; reasoningEffort: string }) => {
                labels.push(options.label);
                assert.equal((await fixture.api.loadState("sample")).preparation.processing?.runId, "prepare-run");
                assert.equal(options.agent, options.label === "prepare:context" ? fixture.api.textWorkerAgent.name : undefined);
                assert.equal(options.reasoningEffort, effort ?? "low");
                return results.shift();
            },
        });
        assert.deepEqual(labels, ["prepare:workspace", "prepare:context"]);
        assert.equal(keys.length, 4);
        assert.ok(keys.every((key) => key.startsWith(pending.preparation.processing!.requestId!)));
        fixture.api.setSession({ ...fixture.session, workflow: {
            waitForRun: async () => ({ runId: "prepare-run", status: "completed", result }),
        } });
        await fixture.api.waitForEffortRun("sample", "prepare-run");
        await fixture.api.settlePreparationRun("sample", { runId: "prepare-run", status: "completed", result }, tokenFor(pending, "prepare-run"));
        const ready = await fixture.api.loadState("sample");
        assert.equal(ready.lifecycle.currentStage, "requirements");
        assert.equal(ready.preparation.status, "ready");
        assert.equal(ready.preparation.sources.length, 0);
        assert.equal(ready.requirements.suggestions[0], "I want to inspect my tasks.");
        assert.equal(ready.jobOwner, null);
        const output = ready.lifecycle.outputs[0];
        assert.match(output.path, /efforts[\\/]sample[\\/]stages[\\/]prepare-r\d+\.json$/);
        const snapshot = JSON.parse(await readFile(join(fixture.root, output.path), "utf8"));
        assert.equal(snapshot.revision, ready.revision);
    } finally { await fixture.close(); }
});

test("missing workspace prerequisites override a ready worker label without blocking Requirements", async () => {
    const fixture = await extensionHarness();
    try {
        await writeFile(join(fixture.root, "package.json"), '{"name":"synthetic-checkout"}');
        const state = fixture.api.createState("missing-prerequisites", "Plan a mock checkout without live payments.");
        const { pending, args } = await requestPreparation(fixture, state);
        const checks = [
            { label: "Payment credentials", status: "missing", detail: "No credentials configured; use mocks." },
            { label: "Browser runtime", status: "missing", detail: "No browser installed; defer execution." },
        ];
        const deferred = ["Supply payment credentials before real charges.", "Install a browser before browser execution."];
        const labels: string[] = [];
        const result = await fixture.api.preparationFactory.run({
            args, runId: "missing-prerequisites-run", phase() {}, log() {},
            step: async (_key: string, work: () => Promise<unknown>) => work(),
            agent: async (_prompt: string, options: { label: string }) => {
                labels.push(options.label);
                if (options.label === "prepare:workspace") return { summary: "Execution prerequisites are missing.", checks };
                assert.equal(options.label, "prepare:context");
                return { requiresSourceResearch: false, handoff: {
                    ...goalOnlyHandoff(), summary: "Ready to discuss mock checkout requirements.",
                    suggestedUsages: ["I want to try mock payment approval and rejection."], deferred,
                } };
            },
        });
        assert.deepEqual(labels, ["prepare:workspace", "prepare:context"]);
        fixture.api.setSession({ ...fixture.session, workflow: {
            waitForRun: async () => ({ runId: "missing-prerequisites-run", status: "completed", result }),
        } });
        await fixture.api.waitForEffortRun(state.prototypeId, "missing-prerequisites-run");
        await fixture.api.settlePreparationRun(state.prototypeId,
            { runId: "missing-prerequisites-run", status: "completed", result },
            tokenFor(pending, "missing-prerequisites-run"));
        const current = await fixture.api.loadState(state.prototypeId);
        assert.equal(current.preparation.status, "needs-attention");
        assert.deepEqual(JSON.parse(JSON.stringify(current.preparation.checks)), checks);
        assert.deepEqual(Array.from(current.deferred), deferred);
        assert.equal(current.lifecycle.currentStage, "requirements");
        assert.equal(current.generation, pending.generation);
        assert.equal(current.preparation.processing?.requestId, pending.preparation.processing?.requestId);
        assert.equal(current.preparation.processing?.runId, "missing-prerequisites-run");
        assert.equal(fixture.developmentRequests.length, 0);
    } finally { await fixture.close(); }
});

test("empty and metadata-only projects use one goal-only worker and persist a replayable handoff", async (t) => {
    for (const metadata of ["none", "Git", "guided Git setup"]) await t.test(metadata, async () => {
        const fixture = await extensionHarness({}, undefined, "", undefined, false, metadata === "guided Git setup");
        try {
            if (metadata === "Git") await mkdir(join(fixture.root, ".git"));
            const state = fixture.api.createState("sample", "Build a coffee shop website");
            const { pending, args } = await requestPreparation(fixture, state);
            const workspace = await inspectEmptyPreparationWorkspace(fixture.root);
            assert.ok(workspace);
            const labels: string[] = [];
            const journal = new Map<string, unknown>();
            const context = {
                args, runId: "goal-only-run", phase() {}, log() {},
                step: async (key: string, work: () => Promise<unknown>) => {
                    if (!journal.has(key)) journal.set(key, await work());
                    return journal.get(key);
                },
                agent: async (prompt: string, options: { label: string; agent?: string }) => {
                    labels.push(options.label);
                    assert.equal(options.agent, fixture.api.textWorkerAgent.name);
                    assert.equal(fixture.api.textWorkerAgent.tools.length, 0);
                    assert.equal(prompt, buildPreparationIntentPrompt({ goal: state.goal }, workspace));
                    assert.equal((await fixture.api.loadState("sample")).preparation.processing?.runId, context.runId);
                    return { requiresSourceResearch: false, handoff: goalOnlyHandoff() };
                },
            };
            const result = await fixture.api.preparationFactory.run(context);
            assert.deepEqual(labels, ["prepare:goal-only"]);
            assert.deepEqual(await fixture.api.preparationFactory.run(context), result);
            assert.deepEqual(labels, ["prepare:goal-only"], "durable replay must not repeat agent work");
            assert.ok([...journal.keys()].every((key) => key.startsWith(pending.preparation.processing!.requestId!)));
            fixture.api.setSession({ ...fixture.session, workflow: {
                waitForRun: async () => ({ runId: context.runId, status: "completed", result }),
            } });
            await fixture.api.waitForEffortRun("sample", context.runId);
            await fixture.api.settlePreparationRun("sample", { runId: context.runId, status: "completed", result },
                tokenFor(pending, context.runId));
            const ready = await fixture.api.loadState("sample");
            assert.equal(ready.lifecycle.currentStage, "requirements");
            assert.equal(ready.preparation.status, "ready");
            assert.equal(ready.preparation.sources.length, 0);
            assert.equal(ready.preparation.workItems.length, 3);
            assert.ok(ready.preparation.workItems.every((item) => item.status === "completed"));
            assert.match(ready.preparation.workItems.find((item) => item.id === "sources")!.result, /No external sources were consulted/);
            assert.equal(ready.preparation.checks.find((check) => check.label === "Implementation tooling")?.status, "deferred");
            assert.equal(ready.prototypeApproach.mode, "build");
            assert.deepEqual(Array.from(ready.requirements.suggestions), goalOnlyHandoff().suggestedUsages);
            assert.deepEqual(Array.from(ready.deferred), goalOnlyHandoff().deferred);
            assert.equal(ready.generation, pending.generation);
            assert.equal(ready.preparation.processing?.requestId, pending.preparation.processing?.requestId);
            assert.equal(ready.preparation.processing?.runId, context.runId);
            assert.ok(ready.preparation.processing?.completedAt);
            assert.equal(ready.jobOwner, null);
            const snapshot = JSON.parse(await readFile(join(fixture.root, ready.lifecycle.outputs[0].path), "utf8"));
            assert.equal(snapshot.revision, ready.revision);
            assert.equal(snapshot.result.preparation.processing.requestId, pending.preparation.processing?.requestId);
            assert.deepEqual(snapshot.result.preparation.checks, JSON.parse(JSON.stringify(workspace.checks)));
        } finally { await fixture.close(); }
    });
});

test("Preparation permits only a small lookup needed to understand an unfamiliar reference", async () => {
    const fixture = await extensionHarness();
    try {
        const { args } = await requestPreparation(fixture, fixture.api.createState("sample", "Explore the unfamiliar coordinate convention in the supplied reference"));
        const labels: string[] = [];
        const source = { title: "Primary reference", url: "https://example.com/reference", purpose: "Meaning of the named convention" };
        const result = await fixture.api.preparationFactory.run({
            args, runId: "sources-run", phase() {}, log() {},
            step: async (_key: string, work: () => Promise<unknown>) => work(),
            agent: async (prompt: string, options: { label: string }) => {
                labels.push(options.label);
                if (options.label === "prepare:goal-only") return { requiresSourceResearch: true, handoff: null };
                if (options.label === "prepare:sources") {
                    assert.match(prompt, /at most one source call total, then stop/);
                    assert.match(prompt, /Defer substantive research to Requirements/);
                    return { summary: "Identified the meaning of the reference.", sources: [source], checks: [] };
                }
                return goalOnlyHandoff();
            },
        });
        assert.deepEqual(labels, ["prepare:goal-only", "prepare:sources", "prepare:requirements"]);
        assert.ok(result && typeof result === "object" && "status" in result && "sources" in result);
        assert.equal(result.status, "ready");
        assert.deepEqual(JSON.parse(JSON.stringify(result.sources)), [source]);
    } finally { await fixture.close(); }
});

test("an imported source record receives local inspection but does not force substantive research", async () => {
    const fixture = await extensionHarness();
    try {
        const state = fixture.api.createState("sample", "Build the requested app");
        state.artifacts.push({ id: "intake-record", title: "Imported request", kind: "source",
            stage: "prepare", path: "", language: "json", content: "A source-specific request", mermaid: "" });
        const { args } = await requestPreparation(fixture, state);
        const labels: string[] = [];
        await fixture.api.preparationFactory.run({
            args, runId: "import-run", phase() {}, log() {},
            step: async (_key: string, work: () => Promise<unknown>) => work(),
            agent: async (prompt: string, options: { label: string }) => {
                labels.push(options.label);
                if (options.label === "prepare:workspace") {
                    assert.match(prompt, /A source-specific request/);
                    return { summary: "Imported workspace inspected", checks: [], emptyWorkspace: true };
                }
                assert.equal(options.label, "prepare:context");
                assert.match(prompt, /A source-specific request/);
                return { requiresSourceResearch: false, handoff: goalOnlyHandoff() };
            },
        });
        assert.deepEqual(labels, ["prepare:workspace", "prepare:context"],
            "worker-supplied emptyWorkspace flags are not local filesystem evidence");
    } finally { await fixture.close(); }
});

test("named integrations defer substantive research in both empty and existing workspaces", async (t) => {
    for (const existing of [false, true]) await t.test(existing ? "existing" : "empty", async () => {
        const fixture = await extensionHarness();
        try {
            if (existing) await writeFile(join(fixture.root, "package.json"), '{"name":"checkout"}');
            const { args } = await requestPreparation(fixture, fixture.api.createState("sample", "Research Stripe checkout for my store"));
            const labels: string[] = [];
            await fixture.api.preparationFactory.run({
                args, runId: "deferred-sources", phase() {}, log() {},
                step: (_key: string, work: () => Promise<unknown>) => work(),
                agent: async (prompt: string, options: { label: string; agent?: string }) => {
                    labels.push(options.label);
                    if (options.label === "prepare:workspace") return { summary: "Checkout project", checks: [] };
                    assert.equal(options.agent, fixture.api.textWorkerAgent.name);
                    assert.match(prompt, /does not by itself require early research/);
                    assert.match(prompt, /Defer substantive domain\/product research until the user has accepted/);
                    return { requiresSourceResearch: false, handoff: goalOnlyHandoff() };
                },
            });
            assert.deepEqual(labels, existing ? ["prepare:workspace", "prepare:context"] : ["prepare:goal-only"]);
        } finally { await fixture.close(); }
    });
});

test("only the small setup-only ignore file is excluded from empty-workspace inspection", async (t) => {
    for (const content of [".tandem/", ".tandem/\n", ".tandem/\r\n", "\n.tandem/\n\n"]) {
        await t.test(JSON.stringify(content), async () => {
            const fixture = await extensionHarness();
            try {
                await writeFile(join(fixture.root, ".gitignore"), content);
                assert.ok(await inspectEmptyPreparationWorkspace(fixture.root));
            } finally { await fixture.close(); }
        });
    }
    for (const content of [".tandem/\nnode_modules/\n", "# Existing project guidance\n.tandem/\n", "!.tandem/\n",
        ".tandem/*\n", ".tandem/\n" + " ".repeat(1024)]) {
        await t.test(`retains ${JSON.stringify(content.slice(0, 50))}`, async () => {
            const fixture = await extensionHarness();
            try {
                await writeFile(join(fixture.root, ".gitignore"), content);
                assert.equal(await inspectEmptyPreparationWorkspace(fixture.root), null);
            } finally { await fixture.close(); }
        });
    }
    await t.test("hardlinked ignore file", async () => {
        const fixture = await extensionHarness();
        try {
            const target = join(fixture.root, ".tandem", "shared-ignore");
            await writeFile(target, ".tandem/\n");
            await link(target, join(fixture.root, ".gitignore"));
            assert.equal(await inspectEmptyPreparationWorkspace(fixture.root), null);
        } finally { await fixture.close(); }
    });
});

test("empty-workspace inspection preserves guidance, hidden files, subdirectories, and linked metadata", async (t) => {
    for (const name of ["AGENTS.md", "README.md", "package.json", ".gitignore", ".env", ".git", ".tandem", "src"]) {
        await t.test(name, async () => {
            const fixture = await extensionHarness({}, undefined, "", undefined, true);
            try {
                if (name === "src") await mkdir(join(fixture.root, name));
                else await writeFile(join(fixture.root, name), "Existing project context");
                assert.equal(await inspectEmptyPreparationWorkspace(fixture.root), null);
            } finally { await fixture.close(); }
        });
    }
    await t.test("metadata junction", async () => {
        const fixture = await extensionHarness({}, undefined, "", undefined, true);
        try {
            const target = join(fixture.root, ".tandem");
            await mkdir(target);
            await symlink(target, join(fixture.root, ".git"), "junction");
            assert.equal(await inspectEmptyPreparationWorkspace(fixture.root), null);
        } finally { await fixture.close(); }
    });
    await t.test("unreadable root", async () => {
        const fixture = await extensionHarness();
        try {
            await assert.rejects(inspectEmptyPreparationWorkspace(join(fixture.root, "missing")), { code: "ENOENT" });
        } finally { await fixture.close(); }
    });
});

test("goal-only preparation rejects invalid decisions and fabricated research without advancing", async (t) => {
    const handoff = goalOnlyHandoff();
    for (const candidate of [
        null,
        { handoff },
        { requiresSourceResearch: "false", handoff },
        { requiresSourceResearch: false, handoff: null },
        { requiresSourceResearch: true, handoff },
        { requiresSourceResearch: false, handoff: { ...handoff, sources: [{ title: "Invented", url: "https://example.com", purpose: "Not researched" }] } },
    ]) await t.test(JSON.stringify(candidate), async () => {
        const fixture = await extensionHarness();
        try {
            const { args } = await requestPreparation(fixture, fixture.api.createState("sample", "Build a coffee shop website"));
            let calls = 0;
            await assert.rejects(fixture.api.preparationFactory.run({
                args, runId: "invalid-run", phase() {}, log() {},
                step: async (_key: string, work: () => Promise<unknown>) => work(),
                agent: async () => { calls++; return candidate; },
            }), /invalid source-research decision or unsupported sources/);
            assert.equal(calls, 1);
            assert.equal((await fixture.api.loadState("sample")).lifecycle.currentStage, "prepare");
        } finally { await fixture.close(); }
    });
});

test("Preparation rejects superseded callbacks and foreign-session ownership", async () => {
    const fixture = await extensionHarness();
    try {
        const state = fixture.api.createState("sample", "Analyze the workspace");
        await fixture.api.persistState(state);
        const pending = await fixture.api.ensurePreparationStarted(state, true);
        const token = tokenFor(pending, "prepare-run");
        assert.equal(await fixture.api.bindPreparationRun("sample", token), true);
        assert.equal(await fixture.api.bindPreparationRun("sample", { ...token, runId: "other-run" }), false);
        const before = await fixture.api.loadState("sample");
        await fixture.api.settlePreparationRun("sample", { runId: "other-run", status: "error", error: "old failure" }, { ...token, runId: "other-run" });
        assert.equal((await fixture.api.loadState("sample")).revision, before.revision);
        await assert.rejects(fixture.api.recordPreparationWorkItem("sample", "workspace", "running", { ...token, generation: "old" }), /no longer owns/);
        fixture.session.sessionId = "foreign";
        await assert.rejects(fixture.api.recordPreparationWorkItem("sample", "workspace", "running", token), /another session/);
    } finally { await fixture.close(); }
});

test("interrupted Preparation without a durable run becomes visibly retryable, not duplicated", async () => {
    const fixture = await extensionHarness();
    try {
        const state = fixture.api.createState("sample");
        state.preparation.status = "starting";
        state.preparation.processing = { requestId: null, generation: null, runId: null, requestedAt: "before", completedAt: null };
        await fixture.api.persistState(state);
        fixture.api.recoverPreparationFactory(state, true);
        await fixture.api.waitForPreparation("sample");
        const failed = await fixture.api.loadState("sample");
        assert.equal(failed.preparation.status, "failed");
        assert.match(failed.preparation.error, /retry explicitly/);
        assert.equal(fixture.requests.length, 0);
    } finally { await fixture.close(); }
});

test("canvas reset preserves revisions and cannot repeat during rehydration or an existing open", async () => {
    const fixture = await extensionHarness();
    try {
        const state = fixture.api.createState("sample", "Original");
        await fixture.api.persistState(state);
        const input = { reset: true, goal: "Reset goal" };
        fixture.session.openCanvases.push({ instanceId: "legacy-panel" });
        assert.equal(fixture.api.isCanvasRehydration({ instanceId: "legacy-panel" }), true);
        assert.equal(fixture.api.isCanvasRehydration({ instanceId: "new-panel" }), false);
        const reset = await fixture.api.applyCanvasReset(state, input, "session:panel", false, true);
        assert.ok(reset.revision > state.revision);
        assert.notEqual(reset.generation, state.generation);
        reset.goal = "Newly edited goal";
        await fixture.api.persistState(reset);
        const loaded = await fixture.api.loadState("sample");
        assert.equal((await fixture.api.applyCanvasReset(loaded, input, "session:panel", false, true)).goal, reset.goal);
        assert.equal((await fixture.api.applyCanvasReset(loaded, input, "other:panel", true, true)).goal, reset.goal);
        const pending = await fixture.api.ensurePreparationStarted(loaded, true);
        await fixture.waitForRequests();
        await assert.rejects(fixture.api.applyCanvasReset(pending, input, "new:panel", false, true), /active work/);
    } finally { await fixture.close(); }
});

test("non-GUI Requirements finish with durable source snapshots without starting Stage2", async () => {
    const fixture = await extensionHarness();
    try {
        const state = readyRequirements(fixture.api.createState("sample", "Build a CLI"));
        state.prototypeApproach = { mode: "not-applicable", reason: "Command-line contract only." };
        await fixture.api.persistState(state);
        fixture.setBeforeDevelopmentStart(async () => { throw new Error("Stage2 must not start as part of Stage1 completion."); });
        const completed = await fixture.api.completeLifecycleStage("sample", "requirements", "project:tandem");
        assert.equal(completed.lifecycle.currentStage, "development");
        assert.equal(fixture.developmentRequests.length, 0);
        assert.ok(completed.development == null);
        assert.deepEqual(Array.from(completed.lifecycle.skippedStages, (stage) => stage.stageId), ["sketch", "prototype"]);
        assert.equal(completed.lifecycle.outputs.length, 3);
        assert.ok(completed.artifacts.some((artifact) => artifact.id === "draft-feature-spec"));
        assert.notEqual(completed.processing?.action, "build-prototype");
        for (const output of completed.lifecycle.outputs) {
            const snapshot = JSON.parse(await readFile(join(fixture.root, output.path), "utf8"));
            assert.equal(snapshot.result.prototypeApproach.mode, "not-applicable");
        }
    } finally { await fixture.close(); }
});

test("existing GUI validation does not request a separate app", async () => {
    const fixture = await extensionHarness();
    try {
        const state = readyRequirements(fixture.api.createState("sample"));
        state.prototypeApproach = { mode: "validate-existing", reason: "The repository already has a GUI." };
        await fixture.api.persistState(state);
        const pending = await fixture.api.completeLifecycleStage("sample", "requirements", "project:tandem");
        assert.equal(pending.processing.action, "generate-sketch");
        await fixture.waitForRequests();
        const request = fixture.requests[0];
        assert.ok(request && typeof request === "object" && "args" in request);
        const prompt = fixture.api.answerFactoryPrompt(request.args);
        assert.match(prompt, /existing GUI/);
        assert.match(prompt, /not a replacement application/);
    } finally { await fixture.close(); }
});

test("reopening Preparation invalidates downstream decisions and starts a fresh owned request", async () => {
    const fixture = await extensionHarness();
    try {
        const state = readyRequirements(fixture.api.createState("sample", "Goal"));
        state.lifecycle.outputs = [{ stageId: "prepare", path: "old.json", completedAt: "before" }];
        state.prototypeApproach = { mode: "build", reason: "Old analysis" };
        await fixture.api.persistState(state);
        const reopened = await fixture.api.reopenLifecycleStage("sample", "prepare", "project:tandem");
        assert.equal(reopened.lifecycle.currentStage, "prepare");
        assert.equal(reopened.preparation.status, "starting");
        assert.equal(reopened.decisionGraph.nodes.length, 0);
        assert.equal(reopened.prototypeApproach.mode, "undecided");
        assert.equal(reopened.lifecycle.history[0].path, "old.json");
        assert.notEqual(reopened.generation, state.generation);
        assert.ok(reopened.preparation.processing?.requestId);
        await fixture.waitForRequests();
    } finally { await fixture.close(); }
});
