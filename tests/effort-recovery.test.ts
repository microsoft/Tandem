import assert from "node:assert/strict";
import { test } from "node:test";
import { extensionHarness } from "./helpers/extension-harness.js";
import { reactHarness, state, response } from "./helpers/react-harness.js";

async function recoveryFixture() {
    const h = await extensionHarness();
    const value = h.api.createState("recovery", "Keep this checklist");
    value.stage = value.lifecycle.currentStage = "requirements";
    value.lifecycle.completedStages = ["prepare"];
    value.preparation.status = "ready";
    value.requirements.usageItems = ["I want a local checklist."];
    value.confirmed = ["Retain confirmed validation"];
    value.factoryRuns = [{ requestId: "unknown-launch", generation: value.generation, runId: null, terminal: false }];
    value.jobOwner = { sessionId: h.session.sessionId, workspaceRoot: h.root };
    await h.api.persistState(value);
    const entry = await h.api.startServer("recovery", "recovery", "project:tandem", true);
    let changed: () => void = () => {};
    let reads = 0;
    const native: { processing: unknown; activity: unknown; queue: unknown; inventory: unknown; eventOnRead: boolean } = {
        processing: { processing: false }, activity: { hasActiveWork: false, abortable: false },
        queue: { items: [], steeringMessages: [] },
        inventory: { runs: [{ runId: "completed-run", status: "completed" }], omittedOlder: 0, hasMoreNewer: false },
        eventOnRead: false,
    };
    h.api.setSession({ ...h.session, on: (callback: () => void) => { changed = callback; return () => { changed = () => {}; }; },
        rpc: { ...h.session.rpc, metadata: {
            isProcessing: async () => native.processing, activity: async () => native.activity,
        }, queue: { pendingItems: async () => native.queue }, workflow: { ...h.session.rpc.workflow,
            listRuns: async () => { reads++; if (native.eventOnRead) changed(); return native.inventory; },
        } } });
    const input = { requestId: "unknown-launch", generation: value.generation, expectedRevision: value.revision,
        decisionId: "explicit-decision", owner: value.jobOwner, confirm: true };
    const post = (body: unknown, path = "api/effort/recover") => fetch(new URL(path, entry.url), {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    return { h, value, native, input, post, reads: () => reads, close: async () => {
        clearInterval(entry.heartbeat);
        await new Promise<void>(done => { entry.server.close(() => done()); entry.server.closeAllConnections(); });
        await h.close();
    } };
}

test("explicit recovery preserves unknown launch, Requirements and history without replay; duplicate decisions are idempotent", async () => {
    const f = await recoveryFixture();
    try {
        const before = await f.h.api.loadState("recovery");
        const results = await Promise.all([f.post(f.input), f.post(f.input)]);
        for (const result of results) assert.equal(result.status, 200, await result.clone().text());
        const saved = await f.h.api.loadState("recovery");
        assert.deepEqual(saved.requirements, before.requirements);
        assert.deepEqual(saved.lifecycle, before.lifecycle);
        assert.deepEqual(saved.confirmed, before.confirmed);
        assert.deepEqual(saved.processing, before.processing);
        assert.equal(saved.factoryRuns[0].runId, null);
        assert.equal(saved.factoryRuns[0].terminal, false, "Unknown launch does not become a successful or failed native run.");
        assert.equal(saved.factoryRuns[0].recovery.outcome, "abandoned-uncertain");
        assert.equal(saved.factoryRuns[0].recovery.decisionId, f.input.decisionId);
        assert.equal(saved.factoryRuns[0].recovery.observations.length, 2);
        assert.equal(f.reads(), 2, "Double delivery does not produce another recovery.");
        assert.equal(f.h.requests.length, 0);
        assert.equal(f.h.developmentRequests.length, 0);
        await assert.rejects(f.h.api.runEffortFactory("recovery", "unknown-launch", { name: "old", args: {} }), /cannot be replayed/);
        assert.equal((await f.post({ ...f.input, decisionId: "different-decision" })).status, 409);
        const next = await f.post({ questionId: "usage-intake", action: "generate-dag", answer: "Generate questions from the saved usages." }, "api/answer");
        assert.equal(next.status, 202, await next.clone().text());
        await f.h.waitForRequests();
        assert.notEqual((f.h.requests[0] as { args: { requestId: string } }).args.requestId, "unknown-launch");
    } finally { await f.close(); }
});

test("recovery rejects absent approval, stale identities and wrong owners without modifying saved state", async () => {
    const f = await recoveryFixture();
    try {
        const before = JSON.stringify(await f.h.api.loadState("recovery"));
        for (const input of [
            { ...f.input, confirm: false }, { ...f.input, requestId: "another-request" },
            { ...f.input, generation: "old-generation" }, { ...f.input, expectedRevision: 0 },
            { ...f.input, owner: { ...f.input.owner, sessionId: "foreign" } },
            { ...f.input, owner: { ...f.input.owner, workspaceRoot: "another-workspace" } },
        ]) {
            assert.ok((await f.post(input)).status >= 400);
            assert.equal(JSON.stringify(await f.h.api.loadState("recovery")), before);
        }
        assert.equal(f.reads(), 0);
    } finally { await f.close(); }
});

test("active, queued, incomplete or changing native observations keep recovery blocked", async () => {
    for (const kind of ["processing", "activity", "queue", "inventory", "pagination", "event", "unknown"] as const) {
        const f = await recoveryFixture();
        try {
            if (kind === "processing") f.native.processing = { processing: true };
            if (kind === "activity") f.native.activity = { hasActiveWork: true, abortable: true };
            if (kind === "queue") f.native.queue = { items: [{}], steeringMessages: [] };
            if (kind === "inventory") f.native.inventory = { runs: [{ runId: "live", status: "running" }], omittedOlder: 0, hasMoreNewer: false };
            if (kind === "pagination") f.native.inventory = { runs: [], omittedOlder: 1, hasMoreNewer: false };
            if (kind === "event") f.native.eventOnRead = true;
            if (kind === "unknown") f.native.activity = {};
            const before = JSON.stringify(await f.h.api.loadState("recovery"));
            const result = await f.post(f.input);
            assert.ok(result.status >= 400, kind);
            assert.equal(JSON.stringify(await f.h.api.loadState("recovery")), before, kind);
            assert.equal(f.h.requests.length, 0);
        } finally { await f.close(); }
    }
});

test("root recovery cancellation sends nothing and confirmation uses exact saved request and owner", async t => {
    const h = await reactHarness(t), value = state("requirements");
    value.factoryRuns = [{ requestId: "stranded", generation: value.generation, runId: null, terminal: false }];
    value.jobOwner = { sessionId: "main", workspaceRoot: "C:\\owned-project" };
    h.render(value); await h.flush();
    await h.click(h.document.querySelector("[data-recovery-request-id]")!);
    assert.match(h.document.querySelector('[role="alertdialog"]')!.textContent!, /uncertain outcome|does not claim success/);
    await h.fire(h.document.activeElement!, "keydown", { key: "Escape" });
    assert.equal(h.requests.length, 0);
    h.setFetch(async (path, options) => {
        assert.equal(path, "/api/effort/recover");
        const input = JSON.parse(String(options.body));
        assert.equal(input.requestId, "stranded");
        assert.equal(input.generation, value.generation);
        assert.equal(input.expectedRevision, value.revision);
        assert.deepEqual(input.owner, value.jobOwner);
        assert.equal(input.confirm, true);
        assert.ok(input.decisionId);
        return response(value);
    });
    await h.click(h.document.querySelector("[data-recovery-request-id]")!);
    await h.click(h.document.querySelector('[role="alertdialog"] button:last-child')!);
    assert.equal(h.requests.length, 1);
});
