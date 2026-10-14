import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runInNewContext } from "node:vm";
import { extensionHarness } from "./helpers/extension-harness.js";
import { browserAvailable, openFixtureBrowser } from "../stage2/tandem/test/helpers/browser-fixture.mjs";

test("packaged guided Git entry uses actual folder APIs and the original startup boundary",
    { skip: !browserAvailable || !process.env.TANDEM_PACKAGED_EXTENSION, timeout: 180_000 }, async t => {
        const packaged = await readFile(process.env.TANDEM_PACKAGED_EXTENSION!, "utf8");
        function asset(marker: string, name: string) {
            const start = packaged.indexOf(`// ${marker}\n`), end = packaged.indexOf("\n// ", start + 3);
            assert.ok(start >= 0 && end > start, `Locate packaged ${marker}, without executing registration.`);
            return runInNewContext(`${packaged.slice(start, end)}\n${name}`, {}, { timeout: 1000 }) as string;
        }
        const client = asset("tandem-client:main.tsx", "main_default"), styles = asset("tandem-styles:styles.css", "styles_default");
        const html = (await readFile(new URL("../src/renderer/index.html", import.meta.url), "utf8"))
            .replace("__TANDEM_CLIENT__", () => client).replace("__TANDEM_STYLES__", () => styles).replace("__TANDEM_VERSION__", "packaged-git-check");
        const browser = await openFixtureBrowser(t);
        const waitForEntry = async () => {
            for (let attempt = 0; attempt < 150; attempt++) {
                if (await browser.evaluate('Boolean(document.querySelector("#project-conversation-frame"))')) return;
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
                    await browser.evaluate('document.querySelector("#entry-development").click()');
                    const needsSetup = !["ready", "worktree"].includes(scenario);
                    if (needsSetup) {
                        await browser.waitFor('Boolean(document.querySelector("#cancel-git-setup"))');
                        assert.equal(starts, 0);
                        assert.deepEqual(await readdir(workspace), before);
                        await browser.evaluate('document.querySelector("#cancel-git-setup").click()');
                        await browser.waitFor('Boolean(document.querySelector("#entry-development"))');
                        assert.deepEqual(await readdir(workspace), before);
                        await assert.rejects(lstat(join(workspace, ".tandem", "project-entry.json")), { code: "ENOENT" });
                        await browser.evaluate('document.querySelector("#entry-development").click()');
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
                    assert.equal(starts, 1);
                    assert.equal(h.requests.length, 0); assert.equal(h.developmentRequests.length, 0);
                    assert.equal(JSON.parse(await readFile(join(workspace, ".tandem", "project-entry.json"), "utf8")).startingPath, "development");
                    await browser.call("Page.reload");
                    await waitForEntry();
                    assert.equal(starts, 1, "Refresh does not duplicate native startup.");
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
