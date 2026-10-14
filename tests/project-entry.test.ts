import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chooseProjectEntry, readProjectEntry } from "../src/project-entry.js";
import { reactHarness, state } from "./helpers/react-harness.js";
import { extensionHarness } from "./helpers/extension-harness.js";

for (const path of ["preparation", "development"] as const) test(`folder starting path ${path} is immutable and independent of saved stage history`, async t => {
    const root = await mkdtemp(join(tmpdir(), "tandem-entry-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    await mkdir(join(root, ".tandem"));
    await writeFile(join(root, ".tandem", "unrelated.json"), '{"saved":"unchanged"}');
    assert.equal((await readProjectEntry(root)).startingPath, null);
    await chooseProjectEntry(root, path);
    const bytes = await readFile(join(root, ".tandem", "project-entry.json"), "utf8");
    await chooseProjectEntry(root, path);
    assert.equal(await readFile(join(root, ".tandem", "project-entry.json"), "utf8"), bytes);
    assert.equal((await readProjectEntry(root)).startingPath, path);
    await assert.rejects(chooseProjectEntry(root, path === "preparation" ? "development" : "preparation"), /different starting path/);
    assert.equal(await readFile(join(root, ".tandem", "unrelated.json"), "utf8"), '{"saved":"unchanged"}');
});

test("concurrent conflicting folder choices admit one winner and invalid metadata is preserved", async t => {
    const root = await mkdtemp(join(tmpdir(), "tandem-entry-race-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const results = await Promise.allSettled([chooseProjectEntry(root, "preparation"), chooseProjectEntry(root, "development")]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    const path = join(root, ".tandem", "project-entry.json");
    for (const body of ["{", JSON.stringify({ version: 1, projectPath: root, startingPath: ["preparation"] }),
        JSON.stringify({ version: 1, projectPath: "C:\\other-folder", startingPath: "development" })]) {
        await writeFile(path, body);
        await assert.rejects(readProjectEntry(root));
        await assert.rejects(chooseProjectEntry(root, "preparation"));
        assert.equal(await readFile(path, "utf8"), body);
    }
});

test("first project selection shows path and recommendations without private view or model work", async t => {
    const h = await reactHarness(t, undefined, null);
    const value = state("prepare"); value.goal = "";
    h.render(value); await h.flush();
    assert.match(h.document.body.textContent || "", /C:\\fixture-project/);
    assert.match(h.document.body.textContent || "", /rough idea/);
    assert.equal(h.presentationRequests.length, 0);
    assert.equal(h.requests.length, 0);
    await h.click("entry-preparation");
    assert.ok(h.get("start-goal"));
    assert.equal(h.document.querySelector("#entry-development"), null);
    assert.equal(h.presentationRequests.length, 0, "Preparation has no Stage2 renderer dependency.");
    assert.equal(h.requests.length, 0, "A valid goal is still required.");
});

test("persisted Development entry opens one view automatically without another setup button or Preparation starter", async t => {
    const h = await reactHarness(t, undefined, "development");
    const value = state("prepare"); value.goal = "";
    h.render(value); await h.flush();
    assert.equal(h.get("development-tab").getAttribute("aria-selected"), "true");
    assert.ok(h.get("project-conversation-frame"));
    assert.equal(h.document.querySelector("#entry-development"), null);
    assert.equal(h.document.querySelector("#activate-development"), null);
    await h.fire(h.get("preparation-tab"), "mousedown", { button: 0 });
    assert.equal(h.document.querySelector("#start-goal"), null);
    assert.equal(h.presentationRequests.length, 1);
    assert.equal(h.entryRequests.filter(path => path === "/api/project-entry/open").length, 1);
    assert.equal(h.requests.length, 0);
});

test("public folder entry requires selection and deduplicates initialization across UI reloads", async () => {
    const h = await extensionHarness({}, undefined, "", undefined, true, true);
    const value = h.api.createState("entry");
    await h.api.persistState(value);
    const server = await h.api.startServer("entry", "entry", "project:tandem", true);
    const post = (path: string, body: unknown = {}) => fetch(new URL(path, server.url), {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });

    test("Development entry failure exposes one contextual retry without implicit requests", async t => {
        const h = await reactHarness(t);
        const value = state("requirements");
        let attempts = 0;
        h.setFetch(async (path, options) => {
            assert.equal(path, "/api/development/open");
            attempts++;
            if (attempts === 1) return { ok: false, status: 409, json: async () => ({ error: "Owned startup unavailable." }) } as Response;
            assert.deepEqual(JSON.parse(String(options.body)), { retry: true });
            return { ok: true, status: 200, json: async () => ({ url: "http://127.0.0.1:8765/" }) } as Response;
        });
        h.render(value); await h.flush();
        await h.fire(h.get("development-tab"), "mousedown", { button: 0 });
        assert.equal(attempts, 0);
        await h.click("enter-development");
        assert.match(h.document.body.textContent || "", /Owned startup unavailable/);
        await h.flush();
        assert.equal(attempts, 1);
        await h.click("retry-development");
        assert.equal(attempts, 2);
        h.render({ ...value, revision: 2 }); await h.flush();
        assert.equal(attempts, 2, "Renders do not retry initialization.");
    });
    let starts = 0;
    h.setBeforeDevelopmentStart(async () => { starts++; });
    try {
        assert.equal((await (await fetch(new URL("api/project-entry", server.url))).json()).startingPath, null);
        assert.equal((await post("api/development/open")).status, 409);
        assert.equal(starts, 0); assert.equal(h.requests.length, 0);
        assert.equal((await post("api/project-entry", { startingPath: "development" })).status, 200);
        const opened = await Promise.all([post("api/project-entry/open"), post("api/project-entry/open")]);
        assert.ok(opened.every(response => response.status === 200));
        await post("api/project-entry/open");
        assert.equal(starts, 1, "Neither concurrent opens nor UI refresh start another native session.");
        assert.equal((await post("api/project-entry", { startingPath: "preparation" })).status, 409);
        assert.equal((await h.api.loadState("entry")).goal, "");
        assert.equal(h.requests.length, 0, "No goal/model prompt was generated by choosing Development.");
    } finally {
        clearInterval(server.heartbeat); server.live.close();
        await new Promise<void>(done => server.server.close(() => done()));
        await h.close();
    }
});
