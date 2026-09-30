import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { extensionHarness } from "./helpers/extension-harness.js";
import { migrateLifecycle, legacyCutoverError } from "../src/lifecycle.js";

test("all legacy downstream HTTP routes return retired without dispatch", async () => {
    const h = await extensionHarness();
    try {
        const { url } = await h.api.openTandem({ instanceId: "retired-view", sessionId: h.session.sessionId,
            extensionId: "project:tandem", input: { prototypeId: "retired" } });
        for (const path of ["/api/design-review", "/api/design-review/thread", "/api/design-review/finalize",
            "/api/plan/generate", "/api/plan/finalize", "/api/implementation/start", "/api/implementation/strategy",
            "/api/implementation/stop", "/api/implementation/status", "/api/test/start", "/api/test/stop", "/api/test/status"]) {
            const response = await fetch(new URL(path, url), { method: path.endsWith("/status") ? "GET" : "POST",
                ...(path.endsWith("/status") ? {} : { headers: { "Content-Type": "application/json" }, body: "{}" }) });
            assert.equal(response.status, 410, path);
            assert.equal((await response.json()).code, "stage_retired");
        }
        assert.equal(h.requests.length, 0);
        assert.equal(h.developmentRequests.length, 0);
    } finally { await h.close(); }
});

test("legacy canvas mutation/completion/reopen fields cannot run the old engine", async () => {
    const h = await extensionHarness();
    try {
        for (const stage of ["design", "plan", "implement", "test"]) {
            await assert.rejects(h.api.completeLifecycleStage("retired", stage, "project:tandem"), /retired/);
            await assert.rejects(h.api.reopenLifecycleStage("retired", stage, "project:tandem"), /retired/);
        }
        for (const key of ["designReview", "testDesignReview", "planning", "implementation", "testing"]) {
            await assert.rejects(h.api.updateTandem({ instanceId: "retired", extensionId: "project:tandem",
                input: { prototypeId: "retired", [key]: {} } }), /retired/);
        }
        assert.equal(h.requests.length, 0);
        const source = await readFile(new URL("../src/extension.ts", import.meta.url), "utf8");
        for (const factory of ["designReviewFactory", "planningFactory", "implementationFactory", "testFactory"]) {
            assert.doesNotMatch(source, new RegExp(`\\b${factory}\\b`));
        }
        assert.match(source, /generate-design-spec/);
    } finally { await h.close(); }
});

test("versioned migration preserves original legacy identities without making Development complete", () => {
    const original = { version: 2, currentStage: "test",
        completedStages: ["prepare", "requirements", "sketch", "prototype", "design", "plan", "implement", "test"],
        outputs: [{ stageId: "design", path: ".tandem\\efforts\\sample\\stages\\design-r2.json", completedAt: "then" },
            { stageId: "test", path: ".tandem\\efforts\\sample\\stages\\test-r3.json", completedAt: "later" }],
        history: [{ stageId: "plan", path: "exact-original-path", completedAt: "earlier" }], skippedStages: [] };
    const migrated = migrateLifecycle(original);
    assert.equal(migrated.version, 3);
    assert.equal(migrated.currentStage, "development");
    assert.deepEqual(migrated.completedStages, ["prepare", "requirements", "sketch", "prototype"]);
    assert.deepEqual(migrated.migration?.original, original);
    assert.equal(migrated.history.length, 3);
    assert.deepEqual(migrateLifecycle(migrated), migrated);
    assert.deepEqual(original.completedStages.at(-1), "test");
});

test("active, unknown and unterminated legacy owners block cutover without being rewritten", async () => {
    const h = await extensionHarness();
    try {
        const state = h.api.createState("legacy");
        for (const execution of [
            { status: "running", runId: "old", ownerSessionId: "original-owner" },
            { status: "completed", runId: "old", ownerSessionId: "original-owner" },
            { status: "failed", runId: "old", cancellation: { confirmedAt: null } },
        ]) {
            state.implementation = execution;
            const before = structuredClone(execution);
            assert.match(legacyCutoverError(state)!, /original owner/);
            assert.deepEqual(state.implementation, before);
        }
        state.implementation = { status: "completed", runId: "old", terminalConfirmedAt: "then" };
        assert.equal(legacyCutoverError(state), null);
    } finally { await h.close(); }
});
