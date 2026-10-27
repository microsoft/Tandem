import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import {
    createProcessState, normalizeProcessSettings, normalizeProcessState, processEvent, processMetrics,
} from "../src/process-state.js";
import { extensionHarness } from "./helpers/extension-harness.js";

test("legacy efforts have local adapters and no automatic execution", () => {
    const state = normalizeProcessState(undefined);
    assert.equal(state.settings.adapters.handoff, "local");
    assert.equal(state.settings.autoStartImplementation, false);
    assert.equal(state.settings.autoStartTests, false);
    assert.equal(state.settings.verification.enabled, false);
    assert.deepEqual(normalizeProcessState(JSON.parse(JSON.stringify(state))), state);
    assert.throws(() => normalizeProcessState({ version: 2 }), /Unsupported/);
});

test("retired process HTTP actions cannot mutate retained history or dispatch work", async () => {
    const h = await extensionHarness();
    const state = h.api.createState("retired-process", "Keep saved history");
    state.process.settings.autoStartImplementation = true;
    state.process.settings.adapters.handoff = "github";
    state.process.settings.githubRepository = "example/repo";
    state.implementation.protectedSources = { "tests\\regression.ts": "original-hash" };
    state.process.receipts = [{ id: "saved", adapter: "local", block: "handoff",
        recordedAt: "2026-10-14T00:00:00Z", reference: "tandem-records\\saved", summary: "Historical receipt", inputHash: "saved-input" }];
    await h.api.persistState(state);
    const entry = await h.api.startServer(state.prototypeId, state.prototypeId, "project:tandem", true);
    try {
        const saved = await h.api.loadState(state.prototypeId);
        for (const action of ["configure", "capture-development", "accept", "export", "prepare-handoff", "handoff", "status", "intake", "open-intake"]) {
            const result = await fetch(new URL("api/process", entry.url), { method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action, expectedRevision: state.revision }) });
            assert.equal(result.status, 410);
            assert.equal((await result.json()).code, "process_retired");
        }
        assert.deepEqual(await h.api.loadState(state.prototypeId), saved);
        assert.equal(h.requests.length, 0);
        assert.equal(h.developmentRequests.length, 0);
        assert.equal(h.developmentOpens.length, 0);
        const source = await readFile(new URL("../src/extension.ts", import.meta.url), "utf8");
        assert.doesNotMatch(source, /name:\s*"process_action"/);
        assert.doesNotMatch(source, /function processAction(?:Locked)?\(/);
    } finally {
        clearInterval(entry.heartbeat);
        await new Promise<void>((resolve, reject) => entry.server.close(error => error ? reject(error) : resolve()));
        await h.close();
    }
});

test("process block selection is independent and invalid configuration fails closed", () => {
    const initial = createProcessState().settings;
    const settings = normalizeProcessSettings({ ...initial, adapters: { handoff: "github", status: "local", intake: "github" } });
    assert.equal(settings.adapters.status, "local");
    assert.throws(() => normalizeProcessSettings({ ...settings, adapters: { ...settings.adapters, intake: "unknown" } }), /registered/);
    assert.throws(() => normalizeProcessSettings({ ...settings, verification: { enabled: true, independentReview: true, checks: [] } }), /Test command/);
    assert.throws(() => normalizeProcessSettings({ ...settings, githubRepository: "https://evil.example/a/b" }), /owner\/repo/);
});

test("process events are idempotent and acceptance waiting is measured from readiness", () => {
    let state = processEvent(createProcessState(), "plan", "ready", "Ready", "revision1", "2026-09-08T00:00:00Z");
    state = processEvent(state, "plan", "ready", "Repeated", "revision1", "2026-09-08T00:10:00Z");
    state = processEvent(state, "plan", "accepted", "Accepted", "acceptance1", "2026-09-08T00:02:00Z");
    assert.equal(state.events.length, 2);
    assert.equal(processMetrics(state).acceptanceWaitingMs, 120000);
});
