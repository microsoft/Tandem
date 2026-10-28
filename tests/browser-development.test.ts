import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setImmediate } from "node:timers/promises";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import { watchBrowserAssets } from "../scripts/browser-dev.js";
import { readBrowserDevelopmentAssets, type BrowserDevelopmentAssets } from "../src/browser/development-assets.js";
import { watchBrowserDevelopment } from "../src/browser/development-client.js";
import { createBrowserHost } from "../src/browser/server.js";
import type { BackendOptions } from "../src/browser/backend.js";
import { writeJsonAtomically } from "../src/project-store.js";
import { browserAvailable, openFixtureBrowser } from "../development/tandem/test/helpers/browser-fixture.mjs";

async function temporary() {
    return mkdtemp(join(tmpdir(), "tandem-browser-development-"));
}

function assets(root: string, revision = "revision-one"): BrowserDevelopmentAssets {
    return {
        revision, publicDirectory: join(root, "public"),
        renderer: { template: "__TANDEM_STYLES__|__TANDEM_CLIENT__|__TANDEM_VERSION__", script: "rendererOne()", styles: "body{color:blue}" },
        browser: { script: "browserOne()", styles: "body{color:green}" },
    };
}

async function until(predicate: () => boolean, timeout = 10_000) {
    const deadline = Date.now() + timeout;
    while (!predicate()) {
        if (Date.now() >= deadline) throw new Error("The development frontend did not reach the expected revision.");
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
}

test("development assets are opt-in, atomically refreshed, and never silently replaced after an invalid write", async (t) => {
    const root = await temporary();
    t.after(() => rm(root, { recursive: true, force: true }));
    const path = join(root, "assets.json");
    const environment = { TANDEM_BROWSER_DEV_ASSETS: path };
    assert.equal(readBrowserDevelopmentAssets({}), undefined);
    assert.throws(() => readBrowserDevelopmentAssets({ TANDEM_BROWSER_DEV_ASSETS: "relative.json" }), /absolute/);
    assert.throws(() => readBrowserDevelopmentAssets(environment), /ENOENT/);
    const initial = assets(root);
    await writeJsonAtomically(path, initial);
    assert.deepEqual(readBrowserDevelopmentAssets(environment), initial);
    assert.equal(readBrowserDevelopmentAssets(environment), readBrowserDevelopmentAssets(environment), "unchanged assets use a cached snapshot");
    const next = assets(root, "revision-two");
    await writeJsonAtomically(path, next);
    assert.deepEqual(readBrowserDevelopmentAssets(environment), next);
    for (const invalid of [{ ...next, revision: '"><script>' }, { ...next, publicDirectory: "relative" }, { ...next, renderer: {} }]) {
        await writeJsonAtomically(path, invalid);
        assert.throws(() => readBrowserDevelopmentAssets(environment), /invalid/);
    }
    await writeFile(path, "{");
    assert.throws(() => readBrowserDevelopmentAssets(environment), SyntaxError);
    await writeJsonAtomically(path, initial);
    assert.deepEqual(readBrowserDevelopmentAssets(environment), initial);
});

test("the browser shell loads the current dev snapshot and hashes the exact refreshed script without weakening production CSP", async (t) => {
    const root = await temporary();
    t.after(() => rm(root, { recursive: true, force: true }));
    const path = join(root, "assets.json");
    await writeJsonAtomically(path, assets(root));
    const result = await build({
        entryPoints: [join(process.cwd(), "src", "browser", "assets.ts")],
        bundle: true, write: false, platform: "node", format: "cjs",
        plugins: [{
            name: "browser-asset-fixture",
            setup(api) {
                api.onResolve({ filter: /^tandem:browser-/ }, (args) => ({ path: args.path, namespace: "fixture" }));
                api.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
                    contents: `export default ${JSON.stringify(args.path.endsWith("client") ? "productionScript()" : "body{}")}`,
                    loader: "js",
                }));
            },
        }],
    });
    const load = (environment: NodeJS.ProcessEnv) => {
        const module = { exports: {} as { page: string; scriptHash: string; getBrowserAssets(): { page: string; scriptHash: string } } };
        runInNewContext(result.outputFiles[0].text, { module, exports: module.exports, require: createRequire(import.meta.url), process: { env: environment } });
        return module.exports;
    };
    const production = load({});
    assert.match(production.page, /productionScript/);
    assert.doesNotMatch(production.page, /tandem-development-revision/);
    assert.equal(production.getBrowserAssets().page, production.page);
    assert.equal(production.getBrowserAssets().scriptHash, production.scriptHash);
    const development = load({ TANDEM_BROWSER_DEV_ASSETS: path });
    const before = development.getBrowserAssets();
    assert.match(before.page, /revision-one/);
    assert.match(before.page, /browserOne/);
    assert.equal(before.scriptHash, `sha256-${createHash("sha256").update("browserOne()").digest("base64")}`);
    const next = assets(root, "revision-two");
    next.browser.script = "browserTwo('$&')\r\n// </script>";
    await writeJsonAtomically(path, next);
    const after = development.getBrowserAssets();
    assert.match(after.page, /revision-two/);
    assert.match(after.page, /browserTwo\('\$&'\)/);
    assert.equal(after.scriptHash, `sha256-${createHash("sha256").update("browserTwo('$&')\n// <\\/script>").digest("base64")}`);
    assert.notEqual(after.scriptHash, before.scriptHash);
});

test("development page and revision requests retain capability/origin checks without restarting or commanding the backend", async (t) => {
    const root = await temporary();
    let current = { page: "<html>first</html>", scriptHash: "sha256-first", revision: "revision-one" };
    let starts = 0, stops = 0, commands = 0;
    let backend: BackendOptions | undefined;
    const host = await createBrowserHost({
        version: "test", runtimeDirectory: root, initialDirectory: root, workspace: root,
        preferencesPath: join(root, "preferences"), page: "production", scriptHash: "sha256-production",
        assets: () => current, developmentRevision: () => current.revision,
        backendFactory: async (options) => {
            starts++;
            backend = options;
            options.event({ type: "permission-mode", mode: "ask" });
            options.event({ type: "ready", workspace: root, url: "http://127.0.0.1:5000/", sessionId: "retained-session" });
            return { async send() { commands++; }, async stop() { stops++; } };
        },
    });
    t.after(async () => { await host.close(); await rm(root, { recursive: true, force: true }); });
    host.start();
    await until(() => host.snapshot().phase === "ready");
    backend!.event({ type: "permission", id: "retained-consent", title: "Allow?", details: "Tool request", canAllowAllForSession: true });
    const before = host.snapshot();
    const headers = { Authorization: `Bearer ${host.capability}` };
    assert.equal((await fetch(new URL("host/development", host.url))).status, 401);
    assert.equal((await fetch(new URL("host/development", host.url), { headers: { ...headers, Origin: "https://untrusted.example" } })).status, 403);
    assert.deepEqual(await fetch(new URL("host/development", host.url), { headers }).then((response) => response.json()), { revision: "revision-one" });
    current = { page: "<html>second</html>", scriptHash: "sha256-second", revision: "revision-two" };
    const page = await fetch(host.url);
    assert.equal(await page.text(), current.page);
    assert.match(page.headers.get("content-security-policy")!, /script-src 'sha256-second'/);
    assert.match(page.headers.get("content-security-policy")!, /connect-src 'self'/);
    assert.equal(page.headers.get("cache-control"), "no-store");
    assert.deepEqual(await fetch(new URL("host/development", host.url), { headers }).then((response) => response.json()), { revision: "revision-two" });
    assert.deepEqual(host.snapshot(), before);
    assert.deepEqual({ starts, stops, commands }, { starts: 1, stops: 0, commands: 0 });
});

test("normal browser hosts do not expose a development revision endpoint", async (t) => {
    const root = await temporary();
    const host = await createBrowserHost({
        version: "test", runtimeDirectory: root, initialDirectory: root, preferencesPath: join(root, "preferences"),
        page: "<html>normal</html>", scriptHash: "sha256-normal",
    });
    t.after(async () => { await host.close(); await rm(root, { recursive: true, force: true }); });
    const response = await fetch(new URL("host/development", host.url), { headers: { Authorization: `Bearer ${host.capability}` } });
    assert.equal(response.status, 404);
});

test("development polling refreshes exactly once for a new successful build and aborts on disposal", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let revision = "revision-one", reloads = 0;
    const requests: RequestInit[] = [];
    const stop = watchBrowserDevelopment("t".repeat(43), revision, () => reloads++, async (input, init) => {
        assert.equal(input, "/host/development");
        requests.push(init!);
        return Response.json({ revision });
    });
    t.after(stop);
    t.mock.timers.tick(1000);
    await setImmediate();
    assert.equal(reloads, 0);
    assert.deepEqual(requests[0].headers, { Authorization: `Bearer ${"t".repeat(43)}` });
    assert.equal(requests[0].cache, "no-store");
    revision = "revision-two";
    t.mock.timers.tick(1000);
    await setImmediate();
    assert.equal(reloads, 1);
    assert.equal(requests[1].signal!.aborted, true);
    t.mock.timers.tick(10_000);
    await setImmediate();
    assert.equal(requests.length, 2);
});

test("development polling reports failures without refreshing, recovers, and ignores a late response after disposal", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const errors = t.mock.method(console, "error", () => {});
    let response = Response.json({ error: "unavailable" }, { status: 503 }), reloads = 0;
    const stop = watchBrowserDevelopment("t".repeat(43), "revision-one", () => reloads++, async () => response.clone());
    t.after(stop);
    for (let attempt = 0; attempt < 2; attempt++) {
        t.mock.timers.tick(1000);
        await setImmediate();
    }
    assert.equal(errors.mock.callCount(), 1, "repeated identical failures are reported once");
    assert.equal(reloads, 0);
    response = Response.json({ revision: "revision-two" });
    t.mock.timers.tick(1000);
    await setImmediate();
    assert.equal(reloads, 1);
    let receive!: (response: Response) => void;
    const close = watchBrowserDevelopment("t".repeat(43), "revision-one", () => reloads++, () => new Promise((resolve) => { receive = resolve; }));
    t.mock.timers.tick(1000);
    close();
    receive(Response.json({ revision: "revision-three" }));
    await setImmediate();
    assert.equal(reloads, 1);
});

test("the real browser entry refreshes the entire page at the same URL and reconnects with its retained capability and pending consent",
    { skip: !browserAvailable, timeout: 30_000 }, async (t) => {
        const root = await temporary();
        const bundle = await build({
            entryPoints: [join(process.cwd(), "src", "browser", "main.tsx")],
            bundle: true, write: false, platform: "browser", format: "iife",
            loader: { ".png": "dataurl" }, define: { "process.env.NODE_ENV": '"production"' },
        });
        const page = (revision: string) => {
            const script = `${bundle.outputFiles[0].text}\nwindow.__tandemDevelopmentMarker = ${JSON.stringify(revision)};`
                .replace(/\r\n?/g, "\n").replace(/<\/script/gi, "<\\/script");
            return {
                page: `<!doctype html><html><head><meta name="tandem-development-revision" content="${revision}"><link rel="icon" href="data:,"></head>
                    <body><div id="root"></div><script>${script}</script></body></html>`,
                scriptHash: `sha256-${createHash("sha256").update(script).digest("base64")}`,
                revision,
            };
        };
        let current = page("revision-one");
        let starts = 0, stops = 0, commands = 0, pageLoads = 0;
        const host = await createBrowserHost({
            version: "test", runtimeDirectory: root, initialDirectory: root, workspace: root,
            preferencesPath: join(root, "preferences"), ...current,
            assets: () => { pageLoads++; return current; }, developmentRevision: () => current.revision,
            backendFactory: async (options) => {
                starts++;
                options.event({ type: "permission-mode", mode: "ask" });
                options.event({ type: "permission", id: "retained-consent", title: "Retained permission", details: "Synthetic runtime fixture", canAllowAllForSession: true });
                return { async send() { commands++; }, async stop() { stops++; } };
            },
        });
        t.after(async () => { await host.close(); await rm(root, { recursive: true, force: true }); });
        host.start();
        const browser = await openFixtureBrowser(t);
        await browser.call("Page.navigate", { url: host.launchUrl });
        await browser.waitFor('window.__tandemDevelopmentMarker === "revision-one" && document.body.textContent.includes("Retained permission")');
        const before = host.snapshot();
        const loaded = pageLoads;
        assert.equal(await browser.evaluate("location.hash"), "");
        current = page("revision-two");
        await browser.waitFor('window.__tandemDevelopmentMarker === "revision-two" && document.body.textContent.includes("Retained permission")');
        assert.ok(pageLoads > loaded, "a rebuild must cause a real new document request");
        assert.equal(await browser.evaluate("performance.getEntriesByType('navigation')[0].type"), "reload");
        assert.equal(await browser.evaluate("location.href"), host.url);
        assert.equal(await browser.evaluate("sessionStorage.getItem('tandem-host-capability')"), host.capability);
        assert.deepEqual(host.snapshot(), before);
        assert.deepEqual({ starts, stops, commands }, { starts: 1, stops: 0, commands: 0 });
        assert.deepEqual(browser.exceptions, []);
    });

test("frontend watching follows transitive TS/CSS, shell, template and Development public edits, retaining the last good build on failure", async (t) => {
    const root = await temporary();
    const files: Record<string, string> = {
        [join("src", "renderer", "main.tsx")]: 'import {message} from "./message"; globalThis.rendererMessage = message;',
        [join("src", "renderer", "message.ts")]: 'export const message = "renderer-one";',
        [join("src", "renderer", "styles.css")]: '@import "./theme.css";',
        [join("src", "renderer", "theme.css")]: "body{color:blue}",
        [join("src", "renderer", "index.html")]: "__TANDEM_STYLES__|__TANDEM_CLIENT__|__TANDEM_VERSION__",
        [join("src", "browser", "main.tsx")]: 'globalThis.browserMessage = "shell-one";',
        [join("src", "browser", "styles.css")]: "body{display:grid}",
        [join("src", "vendor", "ui-dsl", "lucide-LICENSE")]: "Synthetic fixture license",
        [join("development", "tandem", "public", "nested", "widget.js")]: 'export const widget = "one";',
    };
    for (const [path, content] of Object.entries(files)) {
        await mkdir(dirname(join(root, path)), { recursive: true });
        await writeFile(join(root, path), content);
    }
    const path = join(root, "assets.json");
    const watcher = await watchBrowserAssets(root, path);
    t.after(async () => { await watcher.dispose(); await rm(root, { recursive: true, force: true }); });
    const current = () => readBrowserDevelopmentAssets({ TANDEM_BROWSER_DEV_ASSETS: path })!;
    assert.match(current().renderer.script, /renderer-one/);
    assert.match(current().browser.script, /shell-one/);
    const edit = async (relative: string, content: string) => {
        const revision = current().revision;
        await mkdir(dirname(join(root, relative)), { recursive: true });
        await writeFile(join(root, relative), content);
        await until(() => current().revision !== revision);
    };
    await edit(join("src", "renderer", "message.ts"), 'export const message = "renderer-two";');
    assert.match(current().renderer.script, /renderer-two/);
    assert.doesNotMatch(current().renderer.script, /renderer-one/);
    await edit(join("src", "renderer", "theme.css"), "body{color:red}");
    assert.match(current().renderer.styles, /color:red/);
    await edit(join("src", "browser", "main.tsx"), 'globalThis.browserMessage = "shell-two";');
    assert.match(current().browser.script, /shell-two/);
    await edit(join("src", "renderer", "index.html"), "new-template|__TANDEM_STYLES__|__TANDEM_CLIENT__|__TANDEM_VERSION__");
    assert.match(current().renderer.template, /^new-template/);
    await edit(join("development", "tandem", "public", "nested", "widget.js"), 'export const widget = "two";');
    assert.equal(current().publicDirectory, join(root, "development", "tandem", "public"));
    await edit(join("development", "tandem", "public", "added", "new.js"), 'export const added = "one";');
    await edit(join("development", "tandem", "public", "added", "new.js"), 'export const added = "two";');
    const lastGood = await readFile(path, "utf8");
    await writeFile(join(root, "src", "renderer", "message.ts"), "export const message = ;");
    await assert.rejects(watcher.rebuild(), /Build failed/);
    assert.equal(await readFile(path, "utf8"), lastGood, "a failed build cannot publish a new refresh revision or partial assets");
    await edit(join("src", "renderer", "message.ts"), 'export const message = "renderer-recovered";');
    assert.match(current().renderer.script, /renderer-recovered/);
    await writeFile(join(root, "src", "renderer", "main.tsx"), 'import {message} from "./created/message"; globalThis.rendererMessage = message;');
    await assert.rejects(watcher.rebuild(), /Build failed/);
    await edit(join("src", "renderer", "created", "message.ts"), 'export const message = "new-dependency-recovered";');
    assert.match(current().renderer.script, /new-dependency-recovered/);
});
