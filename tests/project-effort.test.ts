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
        clearInterval(entry.heartbeat);
        await new Promise<void>((resolve, reject) => entry.server.close(error => error ? reject(error) : resolve()));
        await h.close();
    }
});

test("Settings effort bridge uses the existing public endpoint and preserves partial application", async t => {
    const h = await reactHarness(t, undefined, "development");
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
    assert.equal(h.document.querySelector("#project-effort-settings"), null, "There is no second navigation disclosure.");
    const { frame } = await h.projectSettings();
    const replies: Array<{ type: string; id: string; error?: string; settings?: typeof settings }> = [];
    frame.contentWindow!.postMessage = message => { replies.push(JSON.parse(JSON.stringify(message))); };
    const send = async (data: object, origin = "http://127.0.0.1:8765") => {
        h.window.dispatchEvent(new h.window.MessageEvent("message", { source: frame.contentWindow, origin,
            data: { protocol: "tandem-project/v1", channel: "fixture-project", ...data } }));
        await h.flush();
    };
    await send({ type: "project-effort-apply", id: "foreign", effort: "low" }, "http://127.0.0.1:9999");
    assert.equal(h.requests.length, 0);
    const status = h.get("project-current-work").getAttribute("aria-label");
    await send({ type: "status", status: "working", active: true });
    await send({ type: "discovery-send", id: "not-a-settings-action", key: "unrelated", text: "Do not dispatch" });
    await send({ type: "process-open" });
    assert.equal(h.get("project-current-work").getAttribute("aria-label"), status);
    assert.equal(h.document.querySelector(".process-dialog"), null);
    assert.equal(h.requests.length, 0);
    await send({ type: "project-effort-read", id: "read" });
    assert.equal(replies.find(reply => reply.id === "read")?.settings?.stage1.status, "unset");
    await send({ type: "project-effort-apply", id: "apply", effort: "low" });
    const result = replies.find(reply => reply.id === "apply")!;
    assert.equal(result.settings?.stage1.status, "applied");
    assert.equal(result.settings?.stage2.status, "error");
    assert.match(result.error!, /Private setting failed/);
    assert.equal(h.requests.some(request => /development\/open|effort\/start/.test(request.path)), false);
});

test("Open Development asks for a model in the same settings window and requires explicit continuation", async t => {
    const h = await reactHarness(t);
    h.render(state("requirements")); await h.flush();
    h.setModelSelectionFetch(async () => response({ required: true }));
    await h.fire(h.get("development-tab"), "mousedown", { button: 0 });
    await h.click("enter-development");
    assert.match(h.get("project-settings-description").textContent!, /Choose a private Development model/);
    assert.equal(h.document.querySelectorAll(".project-settings-dialog").length, 1);
    assert.equal(h.document.querySelector("#project-conversation-frame"), null);
    assert.equal(h.requests.length, 0);
    await h.click("start-development-after-model");
    assert.equal(h.requests.length, 0, "Continue rechecks the saved choice rather than creating an unselected session.");
    h.setModelSelectionFetch(async () => response({ required: false }));
    await h.flush();
    assert.equal(h.requests.length, 0, "Saving a model does not resume startup automatically.");
    h.setFetch(async path => { assert.equal(path, "/api/development/open"); return response({}); });
    await h.click("start-development-after-model");
    assert.equal(h.requests.length, 1);
    assert.equal(h.get("project-settings-title").closest("dialog")!.open, false);
    assert.ok(h.get("project-conversation-frame"));
});

test("direct Development entry waits for a model and closing settings cancels its continuation", async t => {
    const h = await reactHarness(t, undefined, null);
    h.render(state("prepare")); await h.flush();
    h.setModelSelectionFetch(async () => response({ required: true }));
    await h.click("entry-development");
    assert.equal(h.entryRequests.some(request => request.endsWith(":POST")), false);
    assert.equal(h.entryRequests.includes("/api/project-entry/open"), false);
    assert.ok(h.get("start-development-after-model"));
    await h.click("close-project-settings");
    await h.click("project-settings");
    assert.equal(h.document.querySelector("#start-development-after-model"), null);
    h.setModelSelectionFetch(async () => response({ required: false }));
    await h.click("close-project-settings");
    assert.equal(h.entryRequests.includes("/api/project-entry/open"), false);
    await h.click("entry-development");
    assert.equal(h.entryRequests.filter(request => request === "/api/project-entry/open").length, 1);
});

test("a saved direct starting path cannot auto-create an unselected private model on page restore", async t => {
    const h = await reactHarness(t, undefined, "development", true);
    h.render(state("prepare")); await h.flush();
    assert.ok(h.get("start-development-after-model"));
    assert.equal(h.entryRequests.includes("/api/project-entry/open"), false);
    assert.equal(h.document.querySelector("#project-conversation-frame"), null);
    h.setModelSelectionFetch(async () => response({ required: false }));
    await h.click("start-development-after-model");
    assert.equal(h.entryRequests.filter(request => request === "/api/project-entry/open").length, 1);
    assert.equal(h.entryRequests.some(request => request.endsWith(":POST")), false, "Continuing a saved entry does not rewrite its original starting choice.");
    assert.ok(h.get("project-conversation-frame"));
});

test("unavailable model preflight never starts Development or assumes a saved selection", async t => {
    const h = await reactHarness(t);
    h.render(state("requirements")); await h.flush();
    h.setModelSelectionFetch(async () => response({ error: "Model choice could not be read." }, 503));
    await h.fire(h.get("development-tab"), "mousedown", { button: 0 });
    await h.click("enter-development");
    assert.match(h.document.querySelector(".development-error")!.textContent!, /Model choice could not be read/);
    assert.equal(h.document.querySelector("#project-conversation-frame"), null);
    assert.equal(h.requests.length, 0);
});

test("the root model preflight reads the original controller without creating private work", async () => {
    const h = await extensionHarness();
    await h.api.persistState(h.api.createState("model-preflight"));
    const entry = await h.api.startServer("model-preflight", "model-preflight", "project:tandem", true);
    try {
        h.setDevelopmentModelRequired(true);
        const result = await fetch(new URL("api/development/model-selection", entry.url));
        assert.equal(result.status, 200);
        assert.deepEqual(await result.json(), { required: true });
        assert.equal(h.developmentOpens.length, 0);
        assert.equal(h.developmentRequests.length, 0);
    } finally {
        clearInterval(entry.heartbeat);
        await new Promise<void>((resolve, reject) => entry.server.close(error => error ? reject(error) : resolve()));
        await h.close();
    }
});

test("an existing unselected private session opens the same prompt without restarting or replacing it", async t => {
    const h = await reactHarness(t, undefined, "development");
    h.render(state("prepare")); await h.flush();
    const frame = h.get<HTMLIFrameElement>("project-conversation-frame");
    h.setModelSelectionFetch(async () => response({ required: true }));
    h.window.dispatchEvent(new h.window.MessageEvent("message", { source: frame.contentWindow, origin: "http://127.0.0.1:8765",
        data: { protocol: "tandem-project/v1", channel: "fixture-project", type: "status", status: "waiting-runtime", active: true } }));
    await h.flush();
    assert.equal(h.get("start-development-after-model").textContent, "Continue to Development");
    assert.match(h.get("project-settings-description").textContent!, /Choose a private Development model/);
    h.setModelSelectionFetch(async () => response({ required: false }));
    await h.click("start-development-after-model");
    assert.equal(h.get("project-conversation-frame"), frame);
    assert.equal(h.requests.length, 0);
});
