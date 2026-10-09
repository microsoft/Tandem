import assert from "node:assert/strict";
import { test } from "node:test";
import { extensionHarness } from "./helpers/extension-harness.js";
import { reactHarness, state, response } from "./helpers/react-harness.js";

test("one project endpoint applies both independent interfaces without starting either stage", async () => {
    const h = await extensionHarness();
    const value = h.api.createState("settings");
    await h.api.persistState(value);
    const entry = await h.api.startServer("settings", "settings", "project:tandem", true);
    const post = (effort: string) => fetch(new URL("api/settings/project-effort", entry.url), {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ effort }),
    });
    try {
        const unopened = await post("low");
        assert.equal(unopened.status, 200, await unopened.clone().text());
        const first = await unopened.json();
        assert.equal(first.stage1.actual, "low");
        assert.equal(first.stage2.desired, "low");
        assert.equal(first.stage2.status, "pending");
        assert.equal(h.requests.length, 0);
        assert.equal(h.developmentRequests.length, 0);
        assert.equal(h.developmentOpens.length, 0);
        h.setDevelopmentEffortActive(true);
        const live = await post("high");
        assert.equal(live.status, 200);
        const both = await live.json();
        assert.equal(both.stage1.actual, "high");
        assert.equal(both.stage2.actual, "high");
        assert.equal((await h.api.loadState("settings")).goal, "");
        assert.equal((await post("invented")).status, 409);
        h.setDevelopmentEffortError("Private setting failed");
        const partial = await post("low");
        assert.equal(partial.status, 409);
        const failure = await partial.json();
        assert.match(failure.error, /not fully applied/);
        assert.equal(failure.settings.stage1.actual, "low");
        assert.equal(failure.settings.stage2.status, "error");
    } finally {
        clearInterval(entry.heartbeat); entry.live.close();
        await new Promise<void>((resolve, reject) => entry.server.close(error => error ? reject(error) : resolve()));
        await h.close();
    }
});

test("project effort UI offers one choice and exposes delayed or partial application", async t => {
    const h = await reactHarness(t);
    const value = state("prepare"); value.goal = "";
    const stage = { desired: null, actual: null, model: "one", supported: ["low", "high"], status: "unset", error: null };
    const settings = { desired: null, stage1: stage, stage2: { ...stage, model: null }, changing: false };
    h.setFetch(async (path, options) => {
        assert.equal(path, "/api/settings/project-effort");
        if (!options.method) return response(settings);
        assert.equal(JSON.parse(String(options.body)).effort, "low");
        return response({ error: "Private setting failed", settings: { ...settings, desired: "low",
            stage1: { ...stage, desired: "low", actual: "low", status: "applied" },
            stage2: { ...stage, desired: "low", status: "error", error: "Private setting failed" } } }, 409);
    });
    h.render(value); await h.flush();
    assert.equal(h.requests.length, 0);
    h.get<HTMLDetailsElement>("project-effort-settings").open = true;
    await h.fire(h.get("project-effort-settings"), "toggle");
    await h.input("project-effort", "low");
    await h.click("apply-project-effort");
    assert.equal(h.document.querySelectorAll("#project-effort").length, 1);
    assert.match(h.get("project-effort-settings").textContent!, /Stage 1: applied/);
    assert.match(h.get("project-effort-settings").textContent!, /Stage 2: error/);
    assert.match(h.get("project-effort-settings").textContent!, /Private setting failed/);
    assert.equal(h.requests.some(request => /development\/open|effort\/start/.test(request.path)), false);
});
