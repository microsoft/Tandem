import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DevelopmentGit } from "../src/development-git.js";
import { chooseProjectEntry } from "../src/project-entry.js";
import { reactHarness, response, state } from "./helpers/react-harness.js";
import { extensionHarness } from "./helpers/extension-harness.js";

const git = async (root: string, ...args: string[]) => (await promisify(execFile)("git", ["-C", root, ...args])).stdout;
async function folder(t: TestContext) {
    const root = await mkdtemp(join(tmpdir(), "tandem-git-"));
    t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
    return root;
}
async function repository(root: string) { await git(root, "init", "--quiet", "--template="); }

for (const populated of [false, true]) test(`guided setup preserves ${populated ? "populated" : "empty"} non-Git folder and creates no commit or remote`, async t => {
    const root = await folder(t), setup = new DevelopmentGit(root);
    if (populated) {
        await writeFile(join(root, "app.txt"), "Existing project\n");
        await writeFile(join(root, ".gitignore"), "# my rules\r\ncache/\r\n!.tandem/\r\n");
    }
    const original = await readdir(root);
    const check = await setup.preflight();
    assert.equal(check.status, "setup"); assert.equal(check.initialize, true);
    assert.deepEqual(await readdir(root), original, "Read/cancel makes no project-entry, Git, ignore or lock writes.");
    await assert.rejects(setup.setup("not-consented"), /Check this folder again/);
    assert.deepEqual(await readdir(root), original);
    const results = await Promise.all([setup.setup(check.token), setup.setup(check.token)]);
    assert.ok(results.every(result => result.status === "ready"));
    await setup.setup(check.token);
    const text = await readFile(join(root, ".gitignore"), "utf8");
    assert.equal(text, populated ? "# my rules\r\ncache/\r\n!.tandem/\r\n.tandem/\r\n" : ".tandem/\n");
    if (populated) assert.equal(await readFile(join(root, "app.txt"), "utf8"), "Existing project\n");
    assert.equal(await git(root, "remote"), "");
    await assert.rejects(git(root, "rev-parse", "--verify", "HEAD"));
    assert.equal((await setup.preflight()).status, "ready");
    await assert.rejects(lstat(join(root, ".tandem")), { code: "ENOENT" });
    await assert.rejects(lstat(join(root, ".tandem-git-setup.lock")), { code: "ENOENT" });
});

test("existing effective ignore rules remain byte-identical; missing rule appends without a final newline", async t => {
    const root = await folder(t); await repository(root);
    const setup = new DevelopmentGit(root);
    await writeFile(join(root, ".gitignore"), "# retained\ncache/");
    await mkdir(join(root, ".git", "info"), { recursive: true });
    await writeFile(join(root, ".git", "info", "exclude"), ".tandem/\n");
    assert.equal((await setup.preflight()).status, "ready");
    assert.equal(await readFile(join(root, ".gitignore"), "utf8"), "# retained\ncache/");
    await writeFile(join(root, ".git", "info", "exclude"), "");
    const check = await setup.preflight();
    assert.equal(check.initialize, false);
    await setup.setup(check.token);
    assert.equal(await readFile(join(root, ".gitignore"), "utf8"), "# retained\ncache/\n.tandem/\n");
});

test("root and linked worktree are reused; parent membership offers the correct root without writes", async t => {
    const root = await folder(t); await repository(root);
    await writeFile(join(root, ".gitignore"), ".tandem/\n");
    await git(root, "add", ".gitignore");
    await git(root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "Fixture base");
    const worktree = join(await folder(t), "linked");
    await git(root, "worktree", "add", "--quiet", worktree);
    const head = await git(worktree, "rev-parse", "HEAD");
    assert.equal((await lstat(join(worktree, ".git"))).isFile(), true);
    assert.equal((await new DevelopmentGit(worktree).preflight()).status, "ready");
    assert.equal(await git(worktree, "rev-parse", "HEAD"), head);
    const child = join(root, "child"); await mkdir(child);
    const check = await new DevelopmentGit(child).preflight();
    assert.equal(check.status, "blocked");
    assert.equal(check.repositoryRoot?.replaceAll("\\", "/"), root.replaceAll("\\", "/"));
    assert.deepEqual(await readdir(child), []);
});

test("tracked state, bare and corrupt repositories are blocked, never initialized or untracked", async t => {
    const root = await folder(t); await repository(root);
    await mkdir(join(root, ".tandem")); await writeFile(join(root, ".tandem", "saved"), "retained");
    await git(root, "add", ".tandem");
    await writeFile(join(root, ".gitignore"), ".tandem/\n");
    const before = await git(root, "ls-files", "--stage");
    const check = await new DevelopmentGit(root).preflight();
    assert.equal(check.status, "blocked"); assert.match(check.message, /tracks files/);
    assert.equal(await git(root, "ls-files", "--stage"), before);
    const bare = await folder(t); await git(bare, "init", "--bare", "--quiet", "--template=");
    assert.equal((await new DevelopmentGit(bare).preflight()).status, "blocked");
    const corrupt = await folder(t); await mkdir(join(corrupt, ".git"));
    assert.equal((await new DevelopmentGit(corrupt).preflight()).status, "blocked");
    assert.deepEqual(await readdir(join(corrupt, ".git")), []);
});

test("changed consent never overwrites ignore rules, initializes a new parent member or changes a saved choice", async t => {
    for (const change of ["ignore", "parent", "entry", "replacement"] as const) {
        const parent = await folder(t), root = join(parent, "project"); await mkdir(root);
        const setup = new DevelopmentGit(root), check = await setup.preflight();
        if (change === "ignore") await writeFile(join(root, ".gitignore"), "new-rule\n");
        if (change === "parent") await repository(parent);
        if (change === "entry") await chooseProjectEntry(root, "preparation");
        if (change === "replacement") { await rm(root, { recursive: true }); await mkdir(root); }
        await assert.rejects(setup.setup(check.token), /changed/);
        await assert.rejects(lstat(join(root, ".git")), { code: "ENOENT" });
    }
});

test("aliased selected folder, Git metadata and ignore file are blocked without touching the target", async t => {
    const parent = await folder(t), target = join(parent, "target"), alias = join(parent, "alias");
    await mkdir(target);
    await symlink(target, alias, process.platform === "win32" ? "junction" : "dir");
    assert.equal((await new DevelopmentGit(alias).preflight()).status, "blocked");
    const root = await folder(t);
    await symlink(target, join(root, ".tandem"), process.platform === "win32" ? "junction" : "dir");
    assert.equal((await new DevelopmentGit(root).preflight()).status, "blocked");
    await rm(join(root, ".tandem"));
    await symlink(target, join(root, ".git"), process.platform === "win32" ? "junction" : "dir");
    assert.equal((await new DevelopmentGit(root).preflight()).status, "blocked");
    assert.deepEqual(await readdir(target), []);
});

test("hardlinked ignore files, invalid indexes and unreadable HEAD commits are preserved and blocked", async t => {
    const root = await folder(t), outside = join(await folder(t), "ignore");
    await writeFile(outside, "# externally owned bytes\n");
    await link(outside, join(root, ".gitignore"));
    assert.equal((await new DevelopmentGit(root).preflight()).status, "blocked");
    assert.equal(await readFile(outside, "utf8"), "# externally owned bytes\n");
    await rm(join(root, ".gitignore"));
    await repository(root);
    await writeFile(join(root, ".gitignore"), ".tandem/\n");
    await writeFile(join(root, ".git", "index"), "not an index");
    assert.equal((await new DevelopmentGit(root).preflight()).status, "blocked");
    assert.equal(await readFile(join(root, ".git", "index"), "utf8"), "not an index");
    await rm(join(root, ".git", "index"));
    await writeFile(join(root, ".git", "HEAD"), "a".repeat(40) + "\n");
    assert.equal((await new DevelopmentGit(root).preflight()).status, "blocked");
});

test("separate providers cannot append duplicate rules from concurrent consent", async t => {
    const root = await folder(t), left = new DevelopmentGit(root), right = new DevelopmentGit(root);
    const [a, b] = await Promise.all([left.preflight(), right.preflight()]);
    const results = await Promise.allSettled([left.setup(a.token), right.setup(b.token)]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(await readFile(join(root, ".gitignore"), "utf8"), ".tandem/\n");
    assert.equal((await right.preflight()).status, "ready");
});

test("replacing a ready folder after setup cannot redirect the pending entry into another valid repository", async t => {
    const parent = await folder(t), root = join(parent, "selected"); await mkdir(root);
    const setup = new DevelopmentGit(root), consent = await setup.preflight();
    await setup.setup(consent.token);
    await rename(root, join(parent, "original"));
    await mkdir(root); await repository(root);
    await writeFile(join(root, ".gitignore"), ".tandem/\n");
    await assert.rejects(setup.requireReady(), /identity changed/);
    await assert.rejects(lstat(join(root, ".tandem")), { code: "ENOENT" });
});

test("saved Development choice survives setup cancellation without another starting-path choice", async t => {
    const h = await reactHarness(t, undefined, "development");
    h.setGitPreflight(async () => response({ status: "setup", initialize: false, token: "bound",
        projectPath: "C:\\fixture-project", message: "Add the missing ignore rule." }));
    h.render(state("prepare")); await h.flush();
    await h.click("cancel-git-setup");
    assert.ok(h.get("resume-project-entry"));
    assert.equal(h.document.querySelector("#entry-preparation"), null);
    assert.equal(h.presentationRequests.length, 0);
    assert.equal(h.entryRequests.filter(path => path === "/api/project-entry/open").length, 0);
});

test("returning Preparation can cancel Development setup and still browse its retained evidence", async t => {
    const h = await reactHarness(t, undefined, "preparation");
    h.setGitPreflight(async () => response({ status: "setup", initialize: false, token: "bound",
        projectPath: "C:\\fixture-project", message: "Add the missing ignore rule." }));
    h.render(state("development")); await h.flush();
    assert.equal(h.document.querySelector("#cancel-git-setup"), null, "Completed discovery alone does not activate Development.");
    await h.click("enter-development");
    await h.click("cancel-git-setup");
    assert.equal(h.document.querySelector('[role="alertdialog"]'), null);
    assert.equal(h.get("studio-workspace").hasAttribute("inert"), false);
    assert.equal(h.presentationRequests.length, 0);
    assert.equal(h.entryRequests.filter(path => path === "/api/project-entry/open").length, 1);
});

test("missing Git is an explicit blocked result, not setup eligibility", async t => {
    const root = await folder(t);
    const script = `import { DevelopmentGit } from './src/development-git.ts'; console.log(JSON.stringify(await new DevelopmentGit(process.argv[1]).preflight()));`;
    const result = await promisify(execFile)(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script, root],
        { env: { ...process.env, PATH: "", Path: "" } });
    const check = JSON.parse(result.stdout);
    assert.equal(check.status, "blocked"); assert.match(check.message, /Git.*unavailable/);
    assert.deepEqual(await readdir(root), []);
});

test("partial ignore-write failure retains initialized Git and offers an explicit safe retry", async t => {
    if (process.getuid?.() === 0) return t.skip("Root bypasses the fixture file's read-only permissions.");
    const root = await folder(t), path = join(root, ".gitignore");
    await writeFile(path, "# preserve\n");
    await chmod(path, 0o444);
    const setup = new DevelopmentGit(root), check = await setup.preflight();
    await assert.rejects(setup.setup(check.token), /Setup did not finish.*Git metadata.*retained/);
    assert.equal((await lstat(join(root, ".git"))).isDirectory(), true);
    assert.equal(await readFile(path, "utf8"), "# preserve\n");
    await chmod(path, 0o644);
    const retry = await setup.preflight();
    assert.equal(retry.initialize, false);
    await setup.setup(retry.token);
    assert.equal(await readFile(path, "utf8"), "# preserve\n.tandem/\n");
});

for (const startingPath of ["preparation", "development"]) test(`public ${startingPath} entry checks before saving; setup does not start; chosen entry opens once`, async t => {
    const root = await folder(t);
    const h = await extensionHarness({}, undefined, "", root, true);
    t.after(() => h.close());
    const value = h.api.createState("git-entry"); await h.api.persistState(value);
    const server = await h.api.startServer("git-entry", "git-entry", "project:tandem", true);
    t.after(async () => { clearInterval(server.heartbeat); await new Promise<void>(done => server.server.close(() => done())); });
    const post = (path: string, body: unknown = {}) => fetch(new URL(path, server.url), {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    let starts = 0; h.setBeforeDevelopmentStart(async () => { starts++; });
    assert.equal((await post("api/project-entry", { startingPath })).status, 409);
    await assert.rejects(lstat(join(root, ".tandem", "project-entry.json")), { code: "ENOENT" });
    const check = await (await fetch(new URL("api/development/preflight", server.url))).json();
    assert.equal(check.status, "setup");
    assert.equal((await post("api/development/setup", { token: check.token })).status, 200);
    assert.equal(starts, 0); assert.equal(h.requests.length, 0);
    await assert.rejects(lstat(join(root, ".tandem", "project-entry.json")), { code: "ENOENT" });
    assert.equal((await post("api/project-entry", { startingPath })).status, 200);
    await Promise.all([post("api/project-entry/open"), post("api/project-entry/open")]);
    await post("api/project-entry/open");
    assert.equal(starts, startingPath === "development" ? 1 : 0);
    assert.equal(h.requests.length, 0); assert.equal(h.developmentRequests.length, 0);
});

for (const startingPath of ["preparation", "development"]) test(`initial ${startingPath} consent cancels without saving choice, then resumes once`, async t => {
    const h = await reactHarness(t, undefined, null);
    let ready = false, setups = 0;
    h.setGitPreflight(async () => response({ status: ready ? "ready" : "setup", initialize: true, projectPath: "C:\\fixture-project",
        message: "Create local Git metadata and add .tandem/ to .gitignore.", token: "bound-consent" }));
    h.setFetch(async (path, options) => {
        assert.equal(path, "/api/development/setup"); assert.deepEqual(JSON.parse(String(options.body)), { token: "bound-consent" });
        setups++; ready = true; return response({ status: "ready" });
    });
    h.render(state("prepare")); await h.flush();
    await h.click(`entry-${startingPath}`);
    assert.ok(h.get("confirm-git-setup"));
    assert.equal(h.entryRequests.filter(path => path.endsWith(":POST")).length, 0);
    await h.click("cancel-git-setup");
    assert.ok(h.get("entry-preparation")); assert.equal(setups, 0);
    assert.equal(h.presentationRequests.length, 0);
    await h.click(`entry-${startingPath}`);
    await h.click("confirm-git-setup"); await h.flush();
    assert.equal(setups, 1);
    assert.equal(h.entryRequests.filter(path => path.endsWith(":POST")).length, 1);
    assert.equal(h.entryRequests.filter(path => path === "/api/project-entry/open").length, 1);
    assert.equal(h.document.querySelector("#activate-development"), null);
    if (startingPath === "preparation") assert.equal(h.presentationRequests.length, 0, "Project setup cannot open private Development.");
});

test("Preparation stays independent; later Development cancel and partial-failure retry retain the original action", async t => {
    const h = await reactHarness(t);
    let ready = false, attempts = 0, starts = 0;
    h.setGitPreflight(async () => response({ status: ready ? "ready" : "setup", initialize: attempts === 0,
        projectPath: "C:\\fixture-project", message: "Git setup needed.", token: `consent-${attempts}` }));
    h.setFetch(async path => {
        if (path === "/api/development/setup") {
            attempts++;
            if (attempts === 1) return response({ error: "Git metadata was retained. Ignore write failed." }, 409);
            ready = true; return response({ status: "ready" });
        }
        assert.equal(path, "/api/development/open"); starts++; return response({ url: "http://127.0.0.1:8765/" });
    });
    h.render(state("requirements")); await h.flush();
    assert.equal(h.document.querySelector("#confirm-git-setup"), null);
    await h.fire(h.get("development-tab"), "mousedown", { button: 0 });
    await h.click("enter-development"); await h.click("cancel-git-setup");
    assert.equal(starts, 0); assert.equal(h.presentationRequests.length, 0);
    await h.click("enter-development"); await h.click("confirm-git-setup");
    assert.match(h.document.body.textContent || "", /Ignore write failed/);
    assert.equal(starts, 0);
    await h.click("retry-git-preflight"); await h.click("confirm-git-setup"); await h.flush();
    assert.equal(starts, 1); assert.equal(attempts, 2);
});
