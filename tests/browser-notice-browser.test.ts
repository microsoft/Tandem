import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { createBrowserHost } from "../src/browser/server.js";
import type { BackendOptions } from "../src/browser/backend.js";
import { state } from "./helpers/react-harness.js";
import { browserAvailable, openFixtureBrowser } from "../development/tandem/test/helpers/browser-fixture.mjs";

test("real browser dismissal preserves the embedded workspace, accessible controls and pointer targets across themes and widths",
    { skip: !browserAvailable, timeout: 60_000 }, async t => {
        const root = await mkdtemp(join(tmpdir(), "tandem-notice-browser-"));
        let closeHost = async () => {};
        t.after(async () => { await closeHost(); await rm(root, { recursive: true, force: true }); });
        const value = state();
        value.goal = "I hope to build a markdown viewer";
        const failure = "Tandem request failed: The saved prototype preview is unavailable. Restart the saved preview from its workspace controls, then retry the operation. Existing designs, decisions, and draft text are unchanged.";
        const source = fileURLToPath(new URL("../src/", import.meta.url));
        const [hostCss, appCss, hostBundle, appBundle] = await Promise.all([
            build({ entryPoints: [join(source, "browser", "styles.css")], bundle: true, write: false, logLevel: "silent" }),
            build({ entryPoints: [join(source, "renderer", "styles.css")], bundle: true, write: false, logLevel: "silent" }),
            build({
                stdin: { contents: `
                    import React from "react"; import {createRoot} from "react-dom/client";
                    import {BrowserApp} from "./browser/app.js";
                    import {BrowserStore,readLaunchCapability} from "./browser/client.js";
                    const store=new BrowserStore(readLaunchCapability(location,sessionStorage,history));
                    createRoot(document.getElementById("root")).render(React.createElement(BrowserApp,{store}));
                `, resolveDir: source, loader: "tsx" },
                bundle: true, write: false, platform: "browser", format: "iife", loader: { ".png": "dataurl" },
                define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent",
            }),
            build({
                stdin: { contents: `
                    import React from "react"; import {createRoot} from "react-dom/client";
                    import {App} from "./renderer/app.js"; import {StudioStore} from "./renderer/state-store.js";
                    const store=new StudioStore(); store.accept(await (await fetch("/api/state")).json());
                    createRoot(document.getElementById("root")).render(React.createElement(App,{store,version:"test",connect:false}));
                `, resolveDir: source, loader: "tsx" },
                bundle: true, write: false, platform: "browser", format: "esm", loader: { ".png": "dataurl" },
                define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent",
            }),
        ]);
        let backend!: BackendOptions;
        let backendCommands = 0, stops = 0;
        const writes: string[] = [];
        const application = createServer((request, response) => {
            if (request.url === "/") {
                response.setHeader("Content-Type", "text/html");
                response.end(`<!doctype html><html><head><style>${appCss.outputFiles[0].text}</style></head>
                    <body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`);
                return;
            }
            if (request.url === "/app.js") {
                response.setHeader("Content-Type", "text/javascript"); response.end(appBundle.outputFiles[0].text); return;
            }
            response.setHeader("Content-Type", "application/json");
            if (request.method === "POST") writes.push(request.url || "");
            if (request.url === "/api/state") response.end(JSON.stringify(value));
            else if (request.url === "/api/project-entry" || request.url === "/api/project-entry/open") {
                response.end(JSON.stringify({ projectPath: root, startingPath: "preparation", developmentContext: false, developmentStarted: false }));
            } else if (request.url === "/api/development/view") {
                response.end(JSON.stringify({ url: "http://127.0.0.1:1/", channel: "fixture" }));
            } else { response.writeHead(404); response.end(JSON.stringify({ error: "No such fixture operation" })); }
        });
        await new Promise<void>(resolve => application.listen(0, "127.0.0.1", resolve));
        t.after(() => new Promise<void>(resolve => { application.close(() => resolve()); application.closeAllConnections(); }));
        const address = application.address(); assert.ok(address && typeof address !== "string");
        const appUrl = `http://127.0.0.1:${address.port}/`;
        const script = hostBundle.outputFiles[0].text.replace(/\r\n?/g, "\n").replace(/<\/script/gi, "<\\/script");
        const host = await createBrowserHost({
            version: "test", runtimeDirectory: root, initialDirectory: root, workspace: root, preferencesPath: join(root, "preferences"),
            page: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
                <style>${hostCss.outputFiles[0].text}</style></head><body><div id="root"></div><script>${script}</script></body></html>`,
            scriptHash: `sha256-${createHash("sha256").update(script).digest("base64")}`,
            backendFactory: async options => {
                backend = options;
                options.event({ type: "permission-mode", mode: "ask" });
                options.event({ type: "ready", url: appUrl, workspace: root, sessionId: "notice-fixture" });
                return { async send() { backendCommands++; }, async stop() { stops++; } };
            },
        });
        closeHost = host.close;
        host.start();
        const browser = await openFixtureBrowser(t);
        await browser.call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
        await browser.call("Page.navigate", { url: host.launchUrl });
        await browser.waitFor('Boolean(document.querySelector(".host-lifecycle"))');
        // Separate frame execution keeps production postMessage origin/channel checks intact.
        const { frameTree } = await browser.call("Page.getFrameTree");
        const { executionContextId } = await browser.call("Page.createIsolatedWorld", { frameId: frameTree.childFrames[0].frame.id, worldName: "notice-test" });
        const inFrame = async (expression: string) => {
            const result = await browser.call("Runtime.evaluate", { expression, contextId: executionContextId, returnByValue: true, awaitPromise: true });
            assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
            return result.result.value;
        };
        for (let index = 0; index < 150 && !await inFrame('Boolean(document.querySelector("#usage-input")) && !document.querySelector("#studio-workspace").inert'); index++) {
            await new Promise(resolve => setTimeout(resolve, 30));
        }
        assert.equal(await inFrame('Boolean(document.querySelector("#usage-input")) && !document.querySelector("#studio-workspace").inert'), true);
        await inFrame(`(()=>{
            const input=document.querySelector("#usage-input");
            Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(input,"Keep my typed draft");
            input.dispatchEvent(new Event("input",{bubbles:true}));
        })()`);
        backend.event({ type: "error", message: failure, notificationId: "notice-one" });
        await browser.waitFor('Boolean(document.querySelector(".host-notification button"))');
        await inFrame('document.querySelector("#preparation-tab").dispatchEvent(new MouseEvent("mousedown",{bubbles:true,button:0}))');
        const before = host.snapshot();
        const initialWrites = [...writes];
        await browser.evaluate('void (window.retainedFrame=document.querySelector("#tandem-application"))');
        const dismiss = ".host-notification button";
        for (const theme of ["light", "dark"]) {
            await browser.evaluate(`document.documentElement.dataset.projectTheme=${JSON.stringify(theme)}`);
            for (const width of [1440, 320]) {
                await browser.call("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
                await browser.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
                const geometry = await browser.evaluate(`(()=>{
                    const button=document.querySelector(${JSON.stringify(dismiss)}),r=button.getBoundingClientRect();
                    const message=document.querySelector(".host-notification > span"),s=getComputedStyle(button);
                    return {left:r.left,right:r.right,width:r.width,hit:button.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),
                        textFits:message.scrollWidth<=message.clientWidth,fg:s.color,bg:s.backgroundColor};
                })()`);
                assert.ok(geometry.left >= 0 && geometry.right <= width && geometry.width > 40 && geometry.hit, JSON.stringify(geometry));
                assert.equal(geometry.textFits, true, "long failure messages wrap without displacing Dismiss");
                assert.notEqual(geometry.fg, geometry.bg);
            }
        }
        const accessibility = await browser.call("Accessibility.getFullAXTree");
        assert.ok(accessibility.nodes.some(node => node.role?.value === "button" && node.name?.value === "Dismiss notification"));
        await browser.evaluate('document.querySelector(".host-notification > span").focus()');
        await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
        await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
        assert.equal(await browser.evaluate(`document.activeElement.matches(${JSON.stringify(dismiss)})`), true);
        assert.equal(await browser.evaluate('getComputedStyle(document.activeElement).outlineStyle'), "solid");
        await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
        await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
        await browser.waitFor('!document.querySelector(".host-notification")');
        assert.equal(await browser.evaluate('document.activeElement.matches(".host-main")'), true);
        assert.equal(await browser.evaluate('window.retainedFrame===document.querySelector("#tandem-application")'), true);
        assert.deepEqual(host.snapshot(), { ...before, revision: before.revision + 1, notice: null });
        assert.equal(await inFrame('document.querySelector("#preparation-panel").hidden'), false);
        assert.equal(await inFrame('document.querySelector("#usage-input").value'), "Keep my typed draft");
        assert.equal(await inFrame('document.querySelector("#usage-input").readOnly || document.querySelector("#usage-input").disabled'), false);
        assert.deepEqual(writes, initialWrites);
        assert.equal(backendCommands, 0);
        assert.equal(stops, 0);
        backend.event({ type: "error", notificationId: "notice-new", message: failure });
        await browser.waitFor('Boolean(document.querySelector(".host-notification button"))');
        const point = await browser.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(dismiss)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
        const stopTop = await browser.evaluate('document.querySelector("button[aria-label=Stop]").getBoundingClientRect().top');
        await browser.evaluate(`void (window.pressedDismiss=document.querySelector(${JSON.stringify(dismiss)}))`);
        await browser.call("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
        backend.event({ type: "error", notificationId: "notice-newer", message: failure });
        await browser.waitFor('window.pressedDismiss!==document.querySelector(".host-notification button")');
        await browser.call("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
        assert.equal(host.snapshot().notice?.id, "notice-newer", "pointer release cannot acknowledge a replaced notification");
        assert.equal(await browser.evaluate('document.querySelector("button[aria-label=Stop]").getBoundingClientRect().top'), stopTop);
        assert.equal(stops, 0);
        await browser.evaluate(`void (window.retryDismiss=document.querySelector(${JSON.stringify(dismiss)}))`);
        await browser.evaluate(`(()=>{
            const original=window.fetch;
            window.fetch=(url,options)=>url==="/host/command"
                ? Promise.resolve(Response.json({error:"Synthetic acknowledgment failure"},{status:503}))
                : original(url,options);
            window.retryDismiss.focus();
        })()`);
        await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
        await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
        await browser.waitFor('document.querySelectorAll(".host-notification").length===2 && !window.retryDismiss.disabled');
        assert.equal(await browser.evaluate('document.activeElement===window.retryDismiss'), true, "a failed acknowledgment restores keyboard focus to its retryable Dismiss control");
        assert.equal(host.snapshot().notice?.id, "notice-newer");
        assert.deepEqual(browser.exceptions, []);
    });
