import assert from "node:assert/strict";
import { mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { extensionHarness } from "./helpers/extension-harness.js";
import type { TandemState } from "../src/types.js";

const provider = "project:tandem";
const resetInput = (state: TandemState) => ({
    expectedRevision: state.revision, generation: state.generation, confirm: true,
});
const startInput = (state: TandemState, goal = "Build the next iteration") => ({
    expectedRevision: state.revision, generation: state.generation, goal,
});

function legacyPreparation(state: TandemState): TandemState {
    state.generation = `legacy-${state.prototypeId}`;
    state.preparation.status = "failed";
    state.preparation.processing = {
        requestId: null, generation: null, runId: "archived-run",
        requestedAt: "2026-09-04T16:31:22.249Z", completedAt: "2026-09-04T16:32:01.760Z",
    };
    state.preparation.error = "Factory usage accounting could not be completed";
    return state;
}

async function write(path: string, value: string) {
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, value);
}

test("Reset clears only current-effort operational files and persists a new empty generation", async () => {
    const fixture = await extensionHarness();
    try {
        const current = fixture.api.createState("sample", "Old goal");
        current.confirmed = ["Old requirement"];
        current.previewUrl = "http://127.0.0.1:3000/";
        current.openResetRequestId = "fixture-session:panel";
        await fixture.api.persistState(current);
        const other = fixture.api.createState("other", "Another effort");
        await fixture.api.persistState(other);
        const protectedPaths = [
            join(fixture.root, "src", "index.ts"),
            join(fixture.root, "tandem-records", "sample", "accepted.json"),
            join(fixture.root, ".tandem", "efforts", "other", "stages", "prepare-r1.json"),
        ];
        for (const path of protectedPaths) await write(path, "preserved");
        const effort = join(fixture.root, ".tandem", "efforts", "sample");
        await write(join(effort, "stages", "prepare-r1.json"), "snapshot");
        await write(join(effort, "accepted", "acceptance-id", "manifest.json"), "accepted");
        await write(join(effort, "evidence", "check.log"), "evidence");
        const empty = await fixture.api.resetEffort("sample", provider, resetInput(current));
        assert.equal(empty.goal, "");
        assert.equal(empty.stage, "prepare");
        assert.equal(empty.preparation.status, "not-started");
        assert.equal(empty.previewUrl, null);
        assert.equal(empty.confirmed.length, 0);
        assert.equal(empty.jobOwner, null);
        assert.equal(empty.effortReset, null);
        assert.equal(empty.openResetRequestId, current.openResetRequestId);
        assert.ok(empty.revision > current.revision);
        assert.notEqual(empty.generation, current.generation);
        assert.deepEqual(await readdir(effort), ["state.json"]);
        for (const path of protectedPaths) assert.equal(await readFile(path, "utf8"), "preserved");
        assert.equal((await fixture.api.loadState("other")).generation, other.generation);
        assert.equal((await fixture.api.loadState("sample")).generation, empty.generation);
        assert.equal((await fixture.api.ensurePreparationStarted(empty, true)).preparation.status, "not-started");
        assert.equal(fixture.requests.length, 0);
    } finally { await fixture.close(); }
});

test("Reset cancels every current-effort factory, including superseded suggestions, and waits for terminal confirmation", async () => {
    const fixture = await extensionHarness();
    try {
        const state = fixture.api.createState("sample", "Running goal");
        const names = ["prepare", "answer", "old-suggestion", "suggestion", "prototype", "design", "planning", "implementation", "testing"];
        state.factoryRuns = names.map((requestId) => ({
            requestId, runId: `run-${requestId}`, generation: state.generation,
        }));
        await fixture.api.persistState(state);
        const cancelled: string[] = [];
        const waited: string[] = [];
        fixture.api.setSession({ ...fixture.session, workflow: {
            getRun: async (runId: string) => ({ runId, status: "running" }),
            cancel: async (runId: string) => {
                cancelled.push(runId);
                const during = await fixture.api.loadState("sample");
                assert.equal(during.goal, state.goal);
                assert.ok(during.jobOwner);
                assert.ok(during.effortReset);
                await assert.rejects(fixture.api.updateTandem({
                    instanceId: "panel", extensionId: provider, input: { prototypeId: "sample", status: "late write" },
                }), /Reset is pending/);
                return { runId, status: "running" };
            },
            waitForRun: async (runId: string) => { waited.push(runId); return { runId, status: "cancelled" }; },
        } });
        const empty = await fixture.api.resetEffort("sample", provider, resetInput(state));
        assert.deepEqual(cancelled.sort(), names.map((name) => `run-${name}`).sort());
        assert.deepEqual(waited.sort(), cancelled);
        assert.equal(empty.goal, "");
        assert.equal(empty.factoryRuns?.length, 0);
    } finally { await fixture.close(); }
});

test("Reset retains data and ownership when termination is unconfirmed, blocks writes, and supports explicit retry", async () => {
    const fixture = await extensionHarness();
    try {
        const state = fixture.api.createState("sample", "Keep this until stopped");
        state.factoryRuns = [{ requestId: "active", runId: "run-active", generation: state.generation }];
        await fixture.api.persistState(state);
        const path = join(fixture.root, ".tandem", "efforts", "sample", "stages", "prepare-r1.json");
        await write(path, "saved snapshot");
        let terminal = false;
        fixture.api.setSession({ ...fixture.session, workflow: {
            getRun: async (runId: string) => ({ runId, status: "running" }),
            cancel: async (runId: string) => ({ runId, status: terminal ? "cancelled" : "running" }),
            waitForRun: async (runId: string) => ({ runId, status: "running" }),
        } });
        await assert.rejects(fixture.api.resetEffort("sample", provider, resetInput(state)), /unconfirmed/);
        const failed = await fixture.api.loadState("sample");
        assert.equal(failed.generation, state.generation);
        assert.equal(failed.goal, state.goal);
        assert.equal(failed.jobOwner?.sessionId, fixture.session.sessionId);
        assert.match(failed.effortReset!.error, /unconfirmed/);
        assert.equal(await readFile(path, "utf8"), "saved snapshot");
        await assert.rejects(fixture.api.startEffort("sample", provider, startInput(failed)), /Reset is pending/);
        terminal = true;
        assert.equal((await fixture.api.resetEffort("sample", provider, resetInput(failed))).goal, "");
    } finally { await fixture.close(); }
});

test("Reset rejects missing or foreign SDK run identity without deleting data", async () => {
    for (const runId of [null, "expected-run"]) {
        const fixture = await extensionHarness();
        try {
            const state = fixture.api.createState("sample", "Keep");
            state.factoryRuns = [{ requestId: "request", runId, generation: state.generation }];
            await fixture.api.persistState(state);
            fixture.api.setSession({ ...fixture.session, workflow: {
                getRun: async () => ({ runId: "different-run", status: "cancelled" }),
            } });
            await assert.rejects(fixture.api.resetEffort("sample", provider, resetInput(state)), /run ID|different factory/);
            const preserved = await fixture.api.loadState("sample");
            assert.equal(preserved.generation, state.generation);
            assert.ok(preserved.jobOwner);
        } finally { await fixture.close(); }
    }
});

test("Reset retries a migrated finalized Preparation without looking up its archived factory run", async () => {
    const fixture = await extensionHarness();
    try {
        const state = legacyPreparation(fixture.api.createState("sample", "Old goal"));
        state.effortReset = { requestId: "previous-reset", generation: state.generation,
            error: 'Factory run "archived-run" was not found' };
        await fixture.api.persistState(state);
        let lookups = 0;
        fixture.api.setSession({ ...fixture.session, workflow: {
            getRun: async () => { lookups++; throw new Error('Factory run "archived-run" was not found'); },
        } });
        const reset = await fixture.api.resetEffort("sample", provider, resetInput(state));
        assert.equal(lookups, 0);
        assert.equal(reset.goal, "");
        assert.equal(reset.preparation.status, "not-started");
        assert.equal(reset.effortReset, null);
        assert.notEqual(reset.generation, state.generation);
        assert.equal(fixture.requests.length, 0);
    } finally { await fixture.close(); }
});

test("Unsettled and modern Preparation records still require SDK termination despite a missing run", async () => {
    const cases: Array<(state: TandemState) => void> = [
        (state) => { state.preparation.status = "running"; },
        (state) => { state.preparation.processing!.completedAt = null; },
        (state) => { state.preparation.processing!.completedAt = "invalid"; },
        (state) => { state.preparation.processing!.completedAt = "2026-09-01T00:00:00Z"; },
        (state) => { state.preparation.processing!.requestId = "live-request"; },
        (state) => { state.preparation.processing!.generation = state.generation; },
        (state) => { state.generation = "modern-generation"; },
        (state) => { state.preparation.workItems = [
            { id: "workspace", title: "Still working", detail: "", result: "", status: "running" },
        ]; },
        (state) => { state.factoryRuns = [{ requestId: "receipt", generation: state.generation, runId: "archived-run" }]; },
    ];
    for (const change of cases) {
        const fixture = await extensionHarness();
        try {
            const state = legacyPreparation(fixture.api.createState("sample", "Must be retained"));
            change(state);
            await fixture.api.persistState(state);
            let lookups = 0;
            fixture.api.setSession({ ...fixture.session, workflow: {
                getRun: async () => { lookups++; throw new Error('Factory run "archived-run" was not found'); },
            } });
            await assert.rejects(fixture.api.resetEffort("sample", provider, resetInput(state)), /was not found/);
            assert.equal(lookups, 1);
            const retained = await fixture.api.loadState("sample");
            assert.equal(retained.goal, state.goal);
            assert.equal(retained.generation, state.generation);
            assert.ok(retained.effortReset);
            assert.ok(retained.jobOwner);
        } finally { await fixture.close(); }
    }
});

test("Reload remains available during a reset barrier without clearing data or resuming workers", async () => {
    const fixture = await extensionHarness();
    const entry = await fixture.api.startServer("reload", "sample", "user:tandem", true);
    try {
        const state = legacyPreparation(fixture.api.createState("sample", "Keep this goal"));
        state.effortReset = { requestId: "pending-reset", generation: state.generation, error: "Needs retry" };
        await fixture.api.persistState(state);
        let reloads = 0;
        fixture.api.setSession({ ...fixture.session, rpc: { ...fixture.session.rpc, extensions: {
            list: async () => ({ extensions: [{ id: "user:tandem", status: "running" }] }),
            reload: async () => { reloads++; },
        } } });
        const result = await fetch(new URL("api/reload", entry.url), {
            method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
        });
        assert.equal(result.status, 202);
        for (let attempt = 0; reloads === 0 && attempt < 100; attempt++) {
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        assert.equal(reloads, 1);
        const pending = await fixture.api.loadState("sample");
        assert.equal(pending.goal, state.goal);
        assert.equal(pending.effortReset!.requestId, "pending-reset");
        assert.equal(pending.reloadReceipt!.status, "reloading");
        pending.reloadReceipt!.requestedAt = "2020-01-01T00:00:00Z";
        await fixture.api.persistState(pending);
        await fixture.api.openTandem({ instanceId: "reload-panel", sessionId: fixture.session.sessionId,
            extensionId: "user:tandem", reason: "rehydrate", input: { prototypeId: "sample" } });
        const reloaded = await fixture.api.loadState("sample");
        assert.equal(reloaded.reloadReceipt!.status, "success");
        assert.equal(reloaded.goal, state.goal);
        assert.equal(reloaded.effortReset!.requestId, "pending-reset");
        assert.equal(fixture.requests.length, 0);
    } finally {
        clearInterval(entry.heartbeat);
        await new Promise<void>((resolve, reject) => entry.server.close((error) => error ? reject(error) : resolve()));
        await fixture.close();
    }
});

test("Reset validates confirmation, revisions, generations, provider and session ownership", async () => {
    const fixture = await extensionHarness();
    try {
        const state = fixture.api.createState("sample", "Goal");
        await fixture.api.persistState(state);
        for (const input of [
            { ...resetInput(state), confirm: false }, { ...resetInput(state), confirm: "true" },
            { ...resetInput(state), expectedRevision: -1 }, { ...resetInput(state), path: ".." },
        ]) {
            await assert.rejects(fixture.api.resetEffort("sample", provider, input),
                (error: unknown) => (error as { statusCode: number }).statusCode === 400);
        }
        for (const input of [
            { ...resetInput(state), expectedRevision: state.revision - 1 },
            { ...resetInput(state), generation: "old-generation" },
        ]) await assert.rejects(fixture.api.resetEffort("sample", provider, input), /changed/);
        await assert.rejects(fixture.api.resetEffort("sample", "user:tandem", resetInput(state)), /writable/);
        state.factoryRuns = [{ requestId: "owned", runId: "owned-run", generation: state.generation }];
        state.jobOwner = { sessionId: "another-session", workspaceRoot: fixture.root };
        await fixture.api.persistState(state);
        await assert.rejects(fixture.api.resetEffort("sample", provider, resetInput(state)), /another session/);
        assert.equal((await fixture.api.loadState("sample")).effortReset, null);
    } finally { await fixture.close(); }
});

test("An in-flight launch remains owned across reset failure and a late SDK receipt enables safe retry", async () => {
    const fixture = await extensionHarness();
    try {
        const state = fixture.api.createState("sample", "Launching");
        state.processing = { status: "running", action: "build-prototype", requestId: "launch-request",
            runId: null, requestedAt: new Date().toISOString() };
        await fixture.api.persistState(state);
        let release!: (run: unknown) => void;
        let dispatched = false;
        fixture.api.setSession({ ...fixture.session,
            rpc: { ...fixture.session.rpc, workflow: { run: async () => {
                dispatched = true;
                return new Promise((resolve) => { release = resolve; });
            } } },
            workflow: {
                getRun: async (runId: string) => ({ runId, status: "running" }),
                cancel: async (runId: string) => ({ runId, status: "cancelled" }),
            },
        });
        const launching = fixture.api.runEffortFactory("sample", "launch-request", { name: "test-launch", args: {} });
        for (let attempt = 0; !dispatched && attempt < 100; attempt++) {
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        assert.equal(dispatched, true);
        await assert.rejects(fixture.api.resetEffort("sample", provider,
            resetInput(await fixture.api.loadState("sample"))), /no confirmed run ID/);
        release({ runId: "late-run", status: "running" });
        await launching;
        const bound = await fixture.api.loadState("sample");
        assert.equal(bound.factoryRuns?.[0].runId, "late-run");
        assert.ok(bound.jobOwner);
        assert.ok(bound.effortReset);
        assert.equal((await fixture.api.resetEffort("sample", provider, resetInput(bound))).goal, "");
    } finally { await fixture.close(); }
});

test("Cancellation errors remain visible while Reset still requests termination of other workers", async () => {
    const fixture = await extensionHarness();
    try {
        const state = fixture.api.createState("sample", "Active");
        state.factoryRuns = ["first", "second"].map((runId) => ({
            requestId: runId, runId, generation: state.generation,
        }));
        await fixture.api.persistState(state);
        const cancelled: string[] = [];
        fixture.api.setSession({ ...fixture.session, workflow: {
            getRun: async (runId: string) => ({ runId, status: "running" }),
            cancel: async (runId: string) => {
                cancelled.push(runId);
                if (runId === "first") throw new Error("SDK unavailable");
                return { runId, status: "cancelled" };
            },
        } });
        await assert.rejects(fixture.api.resetEffort("sample", provider, resetInput(state)), /SDK unavailable/);
        assert.deepEqual(cancelled.sort(), ["first", "second"]);
        const retained = await fixture.api.loadState("sample");
        assert.equal(retained.goal, state.goal);
        assert.match(retained.effortReset!.error, /SDK unavailable/);
    } finally { await fixture.close(); }
});

test("Reset refuses redirected effort data and never follows its target", async () => {
    const fixture = await extensionHarness();
    try {
        const state = fixture.api.createState("sample", "Goal");
        await fixture.api.persistState(state);
        const target = join(fixture.root, "source");
        await write(join(target, "code.ts"), "preserved");
        await symlink(target, join(fixture.root, ".tandem", "efforts", "sample", "stages"), "junction");
        await assert.rejects(fixture.api.resetEffort("sample", provider, resetInput(state)), /linked operational/);
        assert.equal(await readFile(join(target, "code.ts"), "utf8"), "preserved");
        assert.equal((await fixture.api.loadState("sample")).goal, "Goal");
    } finally { await fixture.close(); }
});

test("Blank opens are durable and idle; rehydration cannot reapply a reset or an old goal", async () => {
    const fixture = await extensionHarness();
    try {
        const context = { instanceId: "blank-panel", sessionId: fixture.session.sessionId, extensionId: provider,
            input: { prototypeId: "sample" } };
        await fixture.api.openTandem(context);
        const blank = await fixture.api.loadState("sample");
        assert.equal(blank.preparation.status, "not-started");
        assert.equal((await fixture.api.loadState("sample")).generation, blank.generation);
        await fixture.api.openTandem({ ...context, reason: "rehydrate",
            input: { prototypeId: "sample", reset: true, goal: "An obsolete activation goal" } });
        const restored = await fixture.api.loadState("sample");
        assert.equal(restored.goal, "");
        assert.equal(restored.generation, blank.generation);
        assert.equal(restored.preparation.status, "not-started");
        assert.equal(fixture.requests.length, 0);
    } finally { await fixture.close(); }
});

test("Goal start trims, validates and atomically rejects duplicate or stale submissions", async () => {
    const fixture = await extensionHarness();
    try {
        const state = await fixture.api.loadState("sample");
        for (const goal of ["", "  ", "x".repeat(4001), null, 42]) {
            await assert.rejects(fixture.api.startEffort("sample", provider, { ...startInput(state), goal }),
                (error: unknown) => (error as { statusCode: number }).statusCode === 400);
        }
        await assert.rejects(fixture.api.startEffort("sample", "user:tandem", startInput(state)), /writable/);
        await assert.rejects(fixture.api.startEffort("sample", provider,
            { ...startInput(state), generation: "stale" }), /changed/);
        const results = await Promise.allSettled([
            fixture.api.startEffort("sample", provider, startInput(state, "  A focused goal  ")),
            fixture.api.startEffort("sample", provider, startInput(state, "  A focused goal  ")),
        ]);
        assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
        await fixture.waitForRequests();
        const started = await fixture.api.loadState("sample");
        assert.equal(started.goal, "A focused goal");
        assert.equal(started.preparation.status, "starting");
        assert.ok(started.preparation.processing?.requestId);
        assert.equal(fixture.requests.length, 1);
        await assert.rejects(fixture.api.startEffort("sample", provider, startInput(started)), /already started/);
    } finally { await fixture.close(); }
});

test("Explicit canvas goal activation still starts Preparation once", async () => {
    const fixture = await extensionHarness();
    try {
        await fixture.api.openTandem({ instanceId: "new-panel", sessionId: fixture.session.sessionId,
            extensionId: provider, input: { prototypeId: "sample", reset: true, goal: "Build a useful app" } });
        await fixture.waitForRequests();
        const started = await fixture.api.loadState("sample");
        assert.equal(started.goal, "Build a useful app");
        assert.equal(started.preparation.status, "starting");
        assert.equal(fixture.requests.length, 1);
    } finally { await fixture.close(); }
});

test("Old Preparation and answer callbacks cannot resurrect a successfully reset effort", async () => {
    const fixture = await extensionHarness();
    try {
        const state = fixture.api.createState("sample", "Prior goal");
        state.openResetRequestId = `${fixture.session.sessionId}:old-panel`;
        await fixture.api.persistState(state);
        const started = await fixture.api.ensurePreparationStarted(state, true);
        await fixture.waitForRequests();
        const token = { requestId: started.preparation.processing!.requestId!,
            generation: started.generation, runId: "prepare-run" };
        await fixture.api.bindPreparationRun("sample", token);
        fixture.api.setSession({ ...fixture.session, workflow: {
            getRun: async (runId: string) => ({ runId, status: "running" }),
            cancel: async (runId: string) => ({ runId, status: "cancelled" }),
        } });
        const empty = await fixture.api.resetEffort("sample", provider, resetInput(await fixture.api.loadState("sample")));
        assert.equal(await fixture.api.bindPreparationRun("sample", token), false);
        await assert.rejects(fixture.api.recordPreparationWorkItem("sample", "workspace", "running", token), /no longer owns/);
        await fixture.api.settlePreparationRun("sample", { runId: token.runId, status: "error", error: "Late result" }, token);
        await fixture.api.applyFactoryResult("sample", "old-answer", { runId: "old-run", status: "completed", result: {} });
        const current = await fixture.api.loadState("sample");
        assert.equal(current.revision, empty.revision);
        assert.equal(current.generation, empty.generation);
        assert.equal(current.goal, "");
        await fixture.api.openTandem({ instanceId: "old-panel", sessionId: fixture.session.sessionId,
            extensionId: provider, input: { prototypeId: "sample", reset: true, goal: "Prior goal" } });
        assert.equal((await fixture.api.loadState("sample")).goal, "");
    } finally { await fixture.close(); }
});

test("HTTP reset and start routes return public snapshots and preserve request validation", async () => {
    const fixture = await extensionHarness();
    const entry = await fixture.api.startServer("http", "sample", provider, true);
    try {
        const state = await fixture.api.loadState("sample");
        const reset = await fetch(new URL("api/effort/reset", entry.url), {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(resetInput(state)),
        });
        assert.equal(reset.status, 200);
        const empty = await reset.json() as TandemState & { provider: { canSubmitAnswers: boolean } };
        assert.equal(empty.provider.canSubmitAnswers, true);
        assert.equal(empty.goal, "");
        const invalid = await fetch(new URL("api/effort/start", entry.url), {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(startInput(empty, "  ")),
        });
        assert.equal(invalid.status, 400);
        const started = await fetch(new URL("api/effort/start", entry.url), {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(startInput(empty)),
        });
        assert.equal(started.status, 200);
        assert.equal(((await started.json()) as TandemState).preparation.status, "starting");
        await fixture.waitForRequests();
    } finally {
        clearInterval(entry.heartbeat);
        await new Promise<void>((resolve, reject) => entry.server.close((error) => error ? reject(error) : resolve()));
        await fixture.close();
    }
});
