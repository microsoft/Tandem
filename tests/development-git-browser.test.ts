import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runInNewContext } from "node:vm";
import { extensionHarness } from "./helpers/extension-harness.js";
import { browserAvailable, openFixtureBrowser } from "../development/tandem/test/helpers/browser-fixture.mjs";

async function packagedHtml() {
    const packaged = await readFile(process.env.TANDEM_PACKAGED_EXTENSION!, "utf8");
    function asset(marker: string, name: string) {
        const start = packaged.indexOf(`// ${marker}\n`), end = packaged.indexOf("\n// ", start + 3);
        assert.ok(start >= 0 && end > start, `Locate packaged ${marker}, without executing registration.`);
        return runInNewContext(`${packaged.slice(start, end)}\n${name}`, {}, { timeout: 1000 }) as string;
    }
    return (await readFile(new URL("../src/renderer/index.html", import.meta.url), "utf8"))
        .replace("__TANDEM_CLIENT__", () => asset("tandem-client:main.tsx", "main_default"))
        .replace("__TANDEM_STYLES__", () => asset("tandem-styles:styles.css", "styles_default")).replace("__TANDEM_VERSION__", "packaged-handoff-check");
}

for (const startingPath of ["preparation", "development"]) test(`packaged guided Git ${startingPath} entry uses actual folder APIs and the original startup boundary`,
    { skip: !browserAvailable || !process.env.TANDEM_PACKAGED_EXTENSION, timeout: 180_000 }, async t => {
        const html = await packagedHtml();
        const browser = await openFixtureBrowser(t);
        const waitForEntry = async () => {
            for (let attempt = 0; attempt < 150; attempt++) {
                if (await browser.evaluate(startingPath === "development"
                    ? 'Boolean(document.querySelector("#project-conversation-frame"))'
                    : 'Boolean(document.querySelector("#start-goal")) && !document.querySelector("#studio-workspace").hasAttribute("inert")')) return;
                await new Promise(done => setTimeout(done, 100));
            }
            assert.fail(`Development entry did not settle: ${await browser.evaluate("document.body.textContent")}`);
        };
        t.diagnostic(`Actual ${(await browser.call("Browser.getVersion")).product}; production packaged renderer, real Git/files/API, fixture native runtime, no model calls.`);
        const git = async (root: string, ...args: string[]) => (await promisify(execFile)("git", ["-C", root, ...args])).stdout;
        for (const scenario of ["empty", "populated", "ready", "missing-ignore", "parent", "worktree", "tracked", "write-failure"] as const) {
            await t.test(scenario, async s => {
                const parent = await mkdtemp(join(tmpdir(), "tandem-packaged-git-"));
                const root = join(parent, "selected"); await mkdir(root);
                let workspace = root;
                const initialize = (path: string) => git(path, "init", "--quiet", "--template=");
                if (scenario === "populated" || scenario === "write-failure") {
                    await writeFile(join(root, "project.txt"), "Keep original project bytes.\n");
                    await writeFile(join(root, ".gitignore"), "# original\r\ncache/\r\n");
                }
                if (["ready", "missing-ignore", "worktree", "tracked"].includes(scenario)) await initialize(root);
                if (["ready", "worktree", "tracked"].includes(scenario)) await writeFile(join(root, ".gitignore"), ".tandem/\n");
                if (scenario === "parent") await initialize(parent);
                if (scenario === "worktree") {
                    await git(root, "add", ".gitignore");
                    await git(root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "Fixture base");
                    workspace = join(parent, "linked");
                    await git(root, "worktree", "add", "--quiet", workspace);
                }
                if (scenario === "tracked") {
                    await mkdir(join(root, ".tandem")); await writeFile(join(root, ".tandem", "retained.txt"), "Saved state");
                    await git(root, "add", "--force", ".tandem");
                }
                if (scenario === "write-failure") await chmod(join(root, ".gitignore"), 0o444);
                const h = await extensionHarness({}, undefined, html, workspace, true);
                let starts = 0; h.setBeforeDevelopmentStart(async () => { starts++; });
                const value = h.api.createState("packaged-git"); await h.api.persistState(value);
                const server = await h.api.startServer("packaged-git", "packaged-git", "project:tandem", true);
                try {
                    const before = await readdir(workspace);
                    await browser.call("Page.navigate", { url: server.url });
                    await browser.waitFor('Boolean(document.querySelector("#entry-development"))');
                    await browser.evaluate(`document.querySelector("#entry-${startingPath}").click()`);
                    const needsSetup = !["ready", "worktree"].includes(scenario);
                    if (needsSetup) {
                        await browser.waitFor('Boolean(document.querySelector("#cancel-git-setup"))');
                        assert.equal(starts, 0);
                        assert.deepEqual(await readdir(workspace), before);
                        await browser.evaluate('document.querySelector("#cancel-git-setup").click()');
                        await browser.waitFor('Boolean(document.querySelector("#entry-development"))');
                        assert.deepEqual(await readdir(workspace), before);
                        await assert.rejects(lstat(join(workspace, ".tandem", "project-entry.json")), { code: "ENOENT" });
                        await browser.evaluate(`document.querySelector("#entry-${startingPath}").click()`);
                        await browser.waitFor('Boolean(document.querySelector("#cancel-git-setup"))');
                        if (["parent", "tracked"].includes(scenario)) {
                            assert.equal(await browser.evaluate('Boolean(document.querySelector("#confirm-git-setup"))'), false);
                            assert.match(await browser.evaluate("document.body.textContent"), scenario === "parent" ? /Open that repository\/worktree root/ : /tracks files/);
                            assert.equal(starts, 0);
                            return;
                        }
                        await browser.evaluate('document.querySelector("#confirm-git-setup").click(); document.querySelector("#confirm-git-setup")?.click()');
                        if (scenario === "write-failure") {
                            await browser.waitFor('Boolean(document.querySelector("#retry-git-preflight"))');
                            assert.match(await browser.evaluate("document.body.textContent"), /Setup did not finish.*Git metadata.*retained/s);
                            assert.equal(starts, 0);
                            assert.equal((await lstat(join(root, ".git"))).isDirectory(), true);
                            assert.equal(await readFile(join(root, ".gitignore"), "utf8"), "# original\r\ncache/\r\n");
                            await chmod(join(root, ".gitignore"), 0o644);
                            await browser.evaluate('document.querySelector("#retry-git-preflight").click()');
                            await browser.waitFor('Boolean(document.querySelector("#confirm-git-setup"))');
                            await browser.evaluate('document.querySelector("#confirm-git-setup").click()');
                        }
                    }
                    await waitForEntry();
                    assert.equal(starts, startingPath === "development" ? 1 : 0);
                    assert.equal(h.requests.length, 0); assert.equal(h.developmentRequests.length, 0);
                    assert.equal(JSON.parse(await readFile(join(workspace, ".tandem", "project-entry.json"), "utf8")).startingPath, startingPath);
                    await browser.call("Page.reload");
                    await waitForEntry();
                    assert.equal(starts, startingPath === "development" ? 1 : 0, "Refresh does not duplicate native startup.");
                    assert.equal(await git(workspace, "remote"), "");
                    if (scenario !== "worktree") await assert.rejects(git(workspace, "rev-parse", "--verify", "HEAD"));
                    if (["populated", "write-failure"].includes(scenario)) {
                        assert.equal(await readFile(join(root, "project.txt"), "utf8"), "Keep original project bytes.\n");
                        assert.equal(await readFile(join(root, ".gitignore"), "utf8"), "# original\r\ncache/\r\n.tandem/\r\n");
                    }
                } finally {
                    await browser.call("Page.navigate", { url: "about:blank" });
                    clearInterval(server.heartbeat);
                    server.live.close();
                    server.server.closeAllConnections();
                    await new Promise<void>(done => server.server.close(() => done()));
                    await h.close();
                    if (scenario === "write-failure") await chmod(join(root, ".gitignore"), 0o644);
                    await rm(parent, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
                }
            });
        }
    });

test("packaged handoff review cancels without startup and confirms the exact real saved input once",
    { skip: !browserAvailable || !process.env.TANDEM_PACKAGED_EXTENSION, timeout: 90_000 }, async t => {
        const h = await extensionHarness({}, undefined, await packagedHtml(), undefined, false, true);
        const state = h.api.createState("packaged-handoff", "Synthetic command-line counter");
        state.stage = state.lifecycle.currentStage = "requirements";
        state.lifecycle.completedStages = ["prepare"]; state.preparation.status = "ready";
        state.requirements = { substage: "dag", usageItems: ["Increment a counter"], suggestions: [] };
        state.decisionGraph.nodes = [{ id: "counter", title: "Counter", dependencies: [], question: null, answer: "Local data only", status: "answered" }];
        state.prototypeApproach = { mode: "not-applicable", reason: "CLI only" };
        state.assumed = ["In-memory count"]; state.deferred = ["Synchronization"];
        await h.api.persistState(state);
        await h.api.completeLifecycleStage(state.prototypeId, "requirements", "project:tandem");
        let starts = 0;
        const gate = Promise.withResolvers<void>(), started = Promise.withResolvers<void>();
        h.setBeforeDevelopmentStart(async () => { starts++; started.resolve(); await gate.promise; });
        const server = await h.api.startServer("packaged-handoff", state.prototypeId, "project:tandem", true);
        const browser = await openFixtureBrowser(t);
        try {
            await browser.call("Emulation.setDeviceMetricsOverride", { width: 640, height: 520, deviceScaleFactor: 1, mobile: false });
            await browser.call("Page.navigate", { url: server.url });
            await browser.waitFor('Boolean(document.querySelector("#development-tab")) && !document.querySelector("#studio-workspace").hasAttribute("inert")');
            await browser.evaluate('document.querySelector("#development-tab").dispatchEvent(new MouseEvent("mousedown", {bubbles:true,button:0})); document.querySelector("#development-tab").click()');
            await browser.waitFor('Boolean(document.querySelector("#continue-design"))');
            assert.equal(starts, 0);
            await browser.evaluate('document.querySelector("#continue-design").focus(); document.querySelector("#continue-design").click()');
            await browser.waitFor('Boolean(document.querySelector("#confirm-design-handoff"))');
            assert.match(await browser.evaluate('document.querySelector(".handoff-review-dialog").textContent'), /In-memory count.*Synchronization/s);
            await browser.evaluate('document.querySelector("#cancel-design-handoff").click()');
            await browser.waitFor('!document.querySelector(".handoff-review-dialog")');
            assert.equal(starts, 0); assert.equal(h.developmentRequests.length, 0);
            await assert.rejects(lstat(join(h.root, ".tandem", "living-canvas", "handoffs")), { code: "ENOENT" });
            await browser.evaluate('document.querySelector("#continue-design").click()');
            await browser.waitFor('document.querySelector("#confirm-design-handoff")?.disabled === false');
            await browser.evaluate('document.querySelector("#confirm-design-handoff").click(); document.querySelector("#confirm-design-handoff")?.click()');
            await browser.waitFor('document.querySelector("#next-action-guide").textContent==="Opening Development..."');
            await started.promise;
            assert.equal(starts, 1); assert.equal(h.developmentRequests.length, 0);
            gate.resolve();
            await browser.waitFor('document.querySelector("#next-action-guide").textContent==="Waiting for verified Development activity..."');
            assert.equal(h.developmentRequests.length, 1);
            assert.equal(await browser.evaluate('document.querySelector("#continue-design") === null'), true);
            const current = await h.api.loadState(state.prototypeId);
            assert.equal(current.development?.requestId, h.developmentRequests[0].id);
            assert.equal(h.requests.length, 0);
            assert.equal(JSON.parse(await readFile(join(h.root, ".tandem", "project-entry.json"), "utf8")).startingPath, "preparation");
            t.diagnostic("Production packaged root UI, real snapshot/receipt/Git APIs, deterministic native-start gate; no models.");
        } finally {
            gate.resolve();
            await browser.call("Page.navigate", { url: "about:blank" });
            clearInterval(server.heartbeat); server.live.close(); server.server.closeAllConnections();
            await new Promise<void>(done => server.server.close(() => done()));
            await h.close();
        }
    });
