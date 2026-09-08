import assert from "node:assert/strict";
import { test } from "node:test";
import { extensionHarness } from "./helpers/extension-harness.js";

test("completing requirements schedules exactly one prototype build and guards replacement", async () => {
    const fixture = await extensionHarness();
    try {
        const state = fixture.api.createState("sample", "Sample app");
        state.lifecycle = { ...state.lifecycle, currentStage: "requirements", completedStages: ["prepare"] };
        state.stage = "requirements";
        state.prototypeApproach = { mode: "build", reason: "A new interface is needed." };
        state.requirements = { substage: "dag", usageItems: ["Use the app"], suggestions: [] };
        state.decisionGraph.nodes = [{ id: "usage", title: "Usage", dependencies: [], question: null, answer: "Chosen", status: "answered" }];
        await fixture.api.persistState(state);
        const pending = await fixture.api.completeLifecycleStage("sample", "requirements", "project:tandem");
        await fixture.waitForRequests();
        assert.equal(pending.lifecycle.currentStage, "prototype");
        assert.equal(pending.processing.action, "build-prototype");
        assert.equal(pending.previewStatus, "starting");
        assert.equal(fixture.requests.length, 1);
        await assert.rejects(fixture.api.beginPrototypeBuild("sample", "project:tandem"), /already active/);
        await assert.rejects(fixture.api.updateTandem({ instanceId: "view", extensionId: "project:tandem", input: { prototypeId: "sample", reset: true } }), /active Tandem/);
        fixture.session.sessionId = "different-session";
        await assert.rejects(fixture.api.updateTandem({ instanceId: "view", extensionId: "project:tandem", input: { prototypeId: "sample", reset: true } }), /another session/);
    } finally { await fixture.close(); }
});

test("prototype results cannot rewrite requirements and must publish a verified preview", { timeout: 10000 }, async () => {
    const fixture = await extensionHarness();
    try {
        const state = fixture.api.createState("sample", "User goal");
        state.lifecycle.completedStages = ["requirements"];
        state.lifecycle.currentStage = "prototype";
        state.stage = "prototype";
        state.prototypeApproach = { mode: "build", reason: "A new interface is needed." };
        state.confirmed = ["User decision"];
        await fixture.api.persistState(state);
        fixture.api.setSession({ ...fixture.session, rpc: { ...fixture.session.rpc, factory: {
            run: async (request: unknown) => {
                fixture.requests.push(request);
                return { status: "completed", runId: "fake-run", result: {
                    ...state, goal: "Worker goal", confirmed: ["Invented"],
                    previewUrl: "http://127.0.0.1:12345", previewStatus: "ready",
                    artifactChanges: { upsert: [], remove: [] },
                } };
            },
        } } });
        await fixture.api.beginPrototypeBuild("sample", "project:tandem");
        await fixture.waitForRequests();
        await fixture.api.waitForAnswer("sample");
        const ready = await fixture.api.loadState("sample");
        assert.equal(ready.previewStatus, "ready", JSON.stringify({ status: ready.status, logs: fixture.logs }));
        assert.equal(ready.goal, "User goal");
        assert.deepEqual(Array.from(ready.confirmed), ["User decision"]);
        assert.equal(ready.jobOwner, null);
    } finally { await fixture.close(); }
});

test("explicit reopening preserves history and invalidates downstream work", async () => {
    const fixture = await extensionHarness();
    try {
        const state = fixture.api.createState("sample", "User goal");
        state.lifecycle.completedStages = ["requirements", "prototype", "design", "plan"];
        state.lifecycle.currentStage = "implement";
        state.stage = "implement";
        state.lifecycle.outputs = [{ stageId: "prototype", path: "old-snapshot.json", completedAt: "before" }];
        state.previewStatus = "ready";
        state.previewUrl = "http://localhost:12345";
        state.artifacts = [{ id: "design-spec", title: "Design", stage: "design", kind: "design-spec", path: "", language: "markdown", content: "Keep history", mermaid: "", reviewStatus: "current" }];
        await fixture.api.persistState(state);
        const reopened = await fixture.api.reopenLifecycleStage("sample", "requirements", "project:tandem");
        assert.equal(reopened.lifecycle.currentStage, "requirements");
        assert.deepEqual(Array.from(reopened.lifecycle.completedStages), ["prepare"]);
        assert.equal(reopened.lifecycle.history[0].path, "old-snapshot.json");
        assert.equal(reopened.artifacts[0].content, "Keep history");
        assert.equal(reopened.artifacts[0].reviewStatus, "stale");
        assert.equal(reopened.previewStatus, "waiting");
        assert.notEqual(reopened.generation, state.generation);
    } finally { await fixture.close(); }
});

test("UTF-8 request input survives transport chunk boundaries", async () => {
    const fixture = await extensionHarness();
    try {
        const encoded = Buffer.from(JSON.stringify({ answer: "\u4f60\u597d" }));
        async function* chunks() { for (const byte of encoded) yield Buffer.from([byte]); }
        const result = await fixture.api.readRequestBody(chunks());
        assert.equal(JSON.stringify(result), '{"answer":"\u4f60\u597d"}');
    } finally { await fixture.close(); }
});
