import assert from "node:assert/strict";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { test, type TestContext } from "node:test";
import { reactHarness, state, response } from "./helpers/react-harness.js";
import { browserAvailable, openFixtureBrowser } from "../stage2/tandem/test/helpers/browser-fixture.mjs";

test("fresh projects open Development directly without creating Stage1 state or a handoff", async t => {
    const h = await reactHarness(t);
    const value = state("prepare");
    value.goal = "";
    h.setFetch(async path => {
        assert.equal(path, "/api/development/open");
        return response({ url: "http://127.0.0.1:8765/" });
    });
    h.render(value); await h.flush();
    assert.equal(h.requests.length, 0);
    await h.click("open-development");
    const frame = h.get<HTMLIFrameElement>("development-frame");
    assert.equal(frame.src, "http://127.0.0.1:8765/");
    assert.equal(h.document.querySelector("#continue-design"), null);
    assert.ok(h.get("capture-development"), "Direct projects retain the explicit capture/delivery controls.");
    await h.fire(h.get("preparation-tab"), "mousedown", { button: 0 });
    assert.equal(h.get("studio-workspace").hidden, true);
    assert.ok(h.get("open-development"));
    await h.click("open-development");
    assert.equal(h.get("development-frame"), frame);
    assert.equal(h.requests.length, 1);
    assert.equal(h.store.getSnapshot().state.lifecycle.currentStage, "prepare");
    assert.deepEqual(h.store.getSnapshot().state.lifecycle.completedStages, []);
    assert.deepEqual(h.errors, []);
});

test("idle unfinished Stage1 can browse Development but active work and read-only ownership cannot open it", async t => {
    const h = await reactHarness(t);
    h.setFetch(async path => {
        assert.equal(path, "/api/development/open");
        return response({ url: "http://127.0.0.1:8765/" });
    });
    const value = state("requirements");
    h.render({ ...value, preparation: { ...value.preparation, status: "running" } }); await h.flush();
    await h.fire(h.get("development-tab"), "mousedown", { button: 0 });
    assert.equal(h.requests.length, 0);
    assert.match(h.document.body.textContent!, /Finish upstream work/);
    h.render({ ...value, revision: 2, provider: { ...value.provider, canSubmitAnswers: false } }); await h.flush();
    assert.equal(h.requests.length, 0);
    assert.match(h.document.body.textContent!, /writable provider/);
    h.render({ ...value, revision: 3 }); await h.flush();
    assert.equal(h.requests.length, 1);
    assert.ok(h.get("development-frame"));
    assert.equal(h.document.querySelector("#continue-design"), null);
    assert.equal(h.store.getSnapshot().state.lifecycle.currentStage, "requirements");
    assert.deepEqual(h.errors, []);
});

for (const stage of ["requirements", "prototype"] as const) test(`${stage} completion and later reopen show retained output without automatically opening Stage2`, async t => {
    const h = await reactHarness(t);
    const before = state(stage);
    if (stage === "requirements") before.prototypeApproach = { mode: "not-applicable", reason: "CLI input fixture." };
    h.render(before); await h.flush();
    const completed = { ...before, revision: 2, stage: "development" as const, lifecycle: {
        ...before.lifecycle, currentStage: "development" as const,
        completedStages: state("development").lifecycle.completedStages,
        outputs: [{ stageId: "prototype" as const, path: ".tandem/efforts/fixture/stages/prototype-r2.json", completedAt: before.updatedAt }],
    } };
    h.render(completed); await h.flush();
    assert.equal(h.get(stage === "prototype" ? "live-preview-panel" : "design-tree-panel").hidden, false,
        "Completing upstream work cannot activate the private surface.");
    assert.equal(h.requests.length, 0);
    const reopened = await reactHarness(t);
    reopened.setFetch(async path => {
        assert.equal(path, "/api/development/open");
        return response({ url: "http://127.0.0.1:8765/" });
    });
    reopened.render(completed); await reopened.flush();
    assert.equal(reopened.get("content-panel").hidden, false);
    assert.equal(reopened.requests.length, 0);
    assert.equal(reopened.document.querySelector("#development-frame"), null);
    await reopened.fire(reopened.get("development-tab"), "mousedown", { button: 0 });
    assert.equal(reopened.requests.length, 1, "An explicit later Open initializes the runtime but does not submit the handoff.");
    assert.ok(reopened.get("continue-design"));
    assert.equal(reopened.get<HTMLIFrameElement>("development-frame").src, "http://127.0.0.1:8765/");
});

test("Development mounts one isolated full workspace and navigation keeps its original frame", async t => {
    const h = await reactHarness(t);
    h.setFetch(async path => {
        assert.equal(path, "/api/development/open", "Opening must not send a project request.");
        return response({ url: "http://127.0.0.1:8765/" });
    });
    h.render(state("development"));
    await h.flush();
    const frame = h.get<HTMLIFrameElement>("development-frame");
    assert.equal(frame.src, "http://127.0.0.1:8765/");
    assert.equal(h.get("studio-workspace").dataset.development, "true");
    assert.equal(h.get<HTMLButtonElement>("reset-effort").disabled, true);
    assert.equal(h.document.querySelector('[data-stage-id="design"]'), null);
    await h.fire(h.get("preparation-tab"), "mousedown", { button: 0 });
    await h.fire(h.get("development-tab"), "mousedown", { button: 0 });
    assert.ok(h.get("development-frame") === frame, "Unsent private state is retained with its iframe.");
    assert.equal(h.requests.length, 1);
    assert.deepEqual(h.errors, []);
});

async function serve(t: TestContext, handler: (request: IncomingMessage, response: ServerResponse) => void) {
    const server = createServer(handler);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
        server.closeAllConnections();
    }));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    return `http://127.0.0.1:${address.port}/`;
}

test("real React Development keeps handoff controls in view across long-status hover, keyboard focus and resize",
    { skip: !browserAvailable, timeout: 60_000 }, async t => {
        const value = state("development");
        const snapshotPath = ".tandem\\efforts\\fixture\\stages\\prototype-r7.json";
        value.lifecycle.outputs = [{ stageId: "prototype", path: snapshotPath, completedAt: value.updatedAt }];
        value.development = { handoffId: `handoff-${"a".repeat(64)}`, requestId: `handoff-${"a".repeat(64)}`, snapshotPath };
        value.status = "Tandem Development";
        const longStatus = "Design continuation needs attention. The exact handoff was retained: "
            + "Workflow: The saved local private session is unavailable; no replacement session was created. "
            + "Reserved private session be95789c-4bcf-4f23-833e-4b825697b4da; "
            + "handoff-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa. Select Retry runtime inside Development.";
        let snapshot = value;
        const requests: Array<{ path: string; body: unknown }> = [];
        const failures: string[] = [];
        let frameLoads = 0;
        const frameUrl = await serve(t, (_request, response) => {
            frameLoads++;
            response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            response.end('<!doctype html><html><body><label>Unsent Development draft<textarea id="draft"></textarea></label></body></html>');
        });
        const [styles, hostStyles, bundle] = await Promise.all([
            readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8"),
            build({ entryPoints: [fileURLToPath(new URL("../src/browser/styles.css", import.meta.url))],
                bundle: true, write: false, logLevel: "silent" }),
            build({
                stdin: {
                    contents: `
                        import React from "react";
                        import {createRoot} from "react-dom/client";
                        import {flushSync} from "react-dom";
                        import {App} from "./app.js";
                        import {StudioStore} from "./state-store.js";
                        const store = new StudioStore();
                        store.accept(await (await fetch("/api/state")).json());
                        const root = createRoot(document.getElementById("root"));
                        flushSync(() => root.render(React.createElement(App, {store, version:"layout-fixture", connect:false})));
                        window.developmentFixture = {
                            accept(value) { flushSync(() => store.accept(value)); },
                            events: [],
                        };
                        for (const type of ["pointerover", "pointerout", "focusin", "keydown"]) {
                            document.addEventListener(type, event => window.developmentFixture.events.push({
                                type, trusted: event.isTrusted, id: event.target.id,
                            }), true);
                        }
                    `,
                    loader: "tsx", resolveDir: fileURLToPath(new URL("../src/renderer/", import.meta.url)),
                },
                bundle: true, write: false, platform: "browser", format: "esm", target: "es2022",
                logLevel: "silent", define: { "process.env.NODE_ENV": '"production"' },
            }),
        ]);
        const appUrl = await serve(t, (request, response) => {
            const path = new URL(request.url || "/", "http://127.0.0.1").pathname;
            response.setHeader("Cache-Control", "no-store");
            if (path === "/host") {
                response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
                response.end('<!doctype html><html><head><link rel="stylesheet" href="/host.css"></head>'
                    + '<body><div class="host-shell"><main class="host-main"><iframe src="/" title="Tandem application"></iframe></main></div></body></html>');
            } else if (path === "/host.css") {
                response.writeHead(200, { "Content-Type": "text/css" }); response.end(hostStyles.outputFiles[0].text);
            } else if (path === "/") {
                response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
                response.end('<!doctype html><html><head><link rel="stylesheet" href="/styles.css"></head>'
                    + '<body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
            } else if (path === "/styles.css") {
                response.writeHead(200, { "Content-Type": "text/css" }); response.end(styles);
            } else if (path === "/app.js") {
                response.writeHead(200, { "Content-Type": "text/javascript" }); response.end(bundle.outputFiles[0].text);
            } else if (path === "/api/state" && request.method === "GET") {
                response.writeHead(200, { "Content-Type": "application/json" }); response.end(JSON.stringify(snapshot));
            } else if (request.method === "POST") {
                void (async () => {
                    const chunks: Buffer[] = [];
                    for await (const chunk of request) chunks.push(Buffer.from(chunk));
                    requests.push({ path, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
                    assert.ok(["/api/development/open", "/api/development/continue"].includes(path), `Unexpected mutation: ${path}`);
                    response.writeHead(200, { "Content-Type": "application/json" });
                    response.end(JSON.stringify(path === "/api/development/open" ? { url: frameUrl } : snapshot));
                })().catch(error => {
                    failures.push(error.message);
                    if (!response.headersSent) response.writeHead(500);
                    response.end();
                });
            } else {
                response.writeHead(404); response.end();
            }
        });
        const browser = await openFixtureBrowser(t);
        const version = await browser.call("Browser.getVersion");
        t.diagnostic(`Actual browser: ${version.product}`);
        await browser.call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
        await browser.call("Page.navigate", { url: appUrl });
        await browser.waitFor('Boolean(window.developmentFixture && document.querySelector("#development-frame")?.src)');
        await browser.evaluate('window.originalDevelopmentFrame = document.querySelector("#development-frame"); true');
        await browser.waitFor(`Boolean(document.querySelector("#development-frame")?.src === ${JSON.stringify(frameUrl)})`);
        const settle = () => browser.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))");
        const move = async (selector: string, nearLeft = false) => {
            const point = await browser.evaluate(`(() => {
                const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
                return { x: rect.left + ${nearLeft ? "16" : "rect.width / 2"}, y: rect.top + Math.min(16, rect.height / 2) };
            })()`);
            await browser.call("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
            await settle();
            return point;
        };
        const click = async (selector: string) => {
            const point = await move(selector);
            await browser.call("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
            await browser.call("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
            await settle();
        };
        const tab = async () => {
            await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
            await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
            await settle();
        };
        const measure = async (step: string) => {
            const geometry = await browser.evaluate(`(() => {
                const bounds = selector => {
                    const element = document.querySelector(selector), rect = element.getBoundingClientRect();
                    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
                    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width,
                        hit: hit === element || element.contains(hit) };
                };
                const guide = document.querySelector("#next-action-guide");
                return { viewport: innerWidth, app: bounds(".app"), workspace: bounds("#studio-workspace"),
                    iframe: bounds("#development-frame"), footer: bounds("#next-action-bar"),
                    button: bounds("#continue-design"), acceptance: bounds(".development-process > summary"),
                    guide: guide.textContent, guideTitle: guide.title, guideClipped: guide.scrollWidth > guide.clientWidth,
                    active: document.activeElement.id || document.activeElement.tagName,
                    frameRetained: window.originalDevelopmentFrame === document.querySelector("#development-frame") };
            })()`);
            t.diagnostic(JSON.stringify({ step, ...geometry }));
            return geometry;
        };
        const assertBounded = (geometry: Awaited<ReturnType<typeof measure>>) => {
            for (const part of ["app", "workspace", "iframe", "footer"] as const) {
                assert.ok(Math.abs(geometry[part].width - geometry.viewport) <= 1, `${part} expanded: ${JSON.stringify(geometry)}`);
            }
            for (const part of ["button", "acceptance"] as const) {
                assert.ok(geometry[part].left >= 0 && geometry[part].right <= geometry.viewport && geometry[part].hit,
                    `${part} is not visible and hit-testable: ${JSON.stringify(geometry)}`);
            }
            assert.equal(geometry.frameRetained, true);
        };
        await move("#development-frame", true);
        snapshot = { ...snapshot, revision: snapshot.revision + 1, status: longStatus };
        await browser.evaluate(`window.developmentFixture.accept(${JSON.stringify(snapshot)})`);
        await settle();
        const shortHelp = await measure("1280-pointer-over-iframe");
        await move(".development-toolbar > span", true);
        await browser.waitFor(`document.querySelector("#next-action-guide")?.textContent === ${JSON.stringify(longStatus)}`);
        const longHelp = await measure("1280-pointer-over-toolbar");
        await move("#development-frame", true);
        const restoredHelp = await measure("1280-pointer-back-over-iframe");
        for (const sample of [shortHelp, longHelp, restoredHelp]) assertBounded(sample);
        assert.equal(shortHelp.guide, "Tandem Development");
        assert.equal(longHelp.guide, longStatus);
        assert.equal(longHelp.guideTitle, longStatus, "Ellipsis must not remove the full diagnostic.");
        assert.equal(longHelp.guideClipped, true);
        assert.equal(restoredHelp.guide, "Tandem Development");

        const tree = await browser.call("Page.getFrameTree");
        const privateFrame = tree.frameTree.childFrames.find(frame => frame.frame.url === frameUrl);
        assert.ok(privateFrame);
        const world = await browser.call("Page.createIsolatedWorld", { frameId: privateFrame.frame.id, worldName: "development-draft-fixture" });
        const inFrame = async (expression: string) => {
            const result = await browser.call("Runtime.evaluate", { contextId: world.executionContextId, expression, returnByValue: true });
            assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
            return result.result.value;
        };
        await inFrame('document.querySelector("#draft").focus()');
        await browser.call("Input.insertText", { text: "Unsent private draft survives hover and navigation." });
        for (const width of [1280, 900, 640]) {
            await browser.call("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
            if (width === 640) {
                // Stress translated-length copy in the fixture without changing product labels.
                await browser.evaluate(`document.querySelector("#continue-design").textContent = "Reconcile the retained Prototype handoff and continue Design";
                    document.querySelector(".development-process > summary").textContent = "Acceptance and delivery history";`);
            }
            await settle();
            await move("#development-frame", true);
            assertBounded(await measure(`${width}-iframe-hover`));
            await move("#continue-design");
            assertBounded(await measure(`${width}-button-hover`));
            await move(".development-toolbar > span", true);
            await browser.evaluate('document.querySelector("#development-panel").focus()');
            await tab();
            const focused = await measure(`${width}-keyboard-button`);
            assert.equal(focused.active, "continue-design");
            assertBounded(focused);
            await tab();
            const acceptanceFocused = await measure(`${width}-keyboard-acceptance`);
            assert.equal(acceptanceFocused.active, "SUMMARY");
            assertBounded(acceptanceFocused);
        }
        assert.equal(requests.filter(request => request.path === "/api/development/continue").length, 0,
            "Hover, focus, resize and drafting must never submit a handoff.");
        await click(".development-process > summary");
        assert.equal(await browser.evaluate('document.querySelector(".development-process").open'), true);
        await click(".development-process > summary");
        await browser.call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
        await settle();
        await click("#preparation-tab");
        await click("#development-tab");
        await browser.waitFor('document.querySelector("#development-panel")?.hidden === false');
        assert.equal(await inFrame('document.querySelector("#draft").value'), "Unsent private draft survives hover and navigation.");
        assert.equal(frameLoads, 1, "The private iframe must not remount or reload.");
        assertBounded(await measure("1280-return-from-upstream"));
        await click("#continue-design");
        await browser.waitFor('document.querySelector("#continue-design")?.disabled === false');
        assert.deepEqual(requests.filter(request => request.path === "/api/development/continue"), [{
            path: "/api/development/continue",
            body: { generation: value.generation, expectedRevision: snapshot.revision, snapshotPath },
        }], "A deliberate hit-tested click submits exactly once to the recording fixture endpoint.");
        assert.equal(requests.filter(request => request.path === "/api/development/open").length, 1);
        const events = await browser.evaluate("window.developmentFixture.events");
        for (const type of ["pointerover", "pointerout", "focusin", "keydown"]) {
            assert.ok(events.some(event => event.type === type && event.trusted), `No trusted ${type} event was exercised.`);
        }
        await browser.call("Emulation.setDeviceMetricsOverride", { width: 640, height: 900, deviceScaleFactor: 1, mobile: false });
        await browser.call("Page.navigate", { url: new URL("host", appUrl).href });
        await browser.waitFor('Boolean(document.querySelector(".host-main > iframe")?.contentDocument?.querySelector("#development-frame"))');
        const hostTree = await browser.call("Page.getFrameTree");
        const appFrame = hostTree.frameTree.childFrames.find(frame => frame.frame.url === appUrl);
        assert.ok(appFrame);
        const appWorld = await browser.call("Page.createIsolatedWorld", { frameId: appFrame.frame.id, worldName: "host-layout-fixture" });
        const insideApp = async (expression: string) => {
            const result = await browser.call("Runtime.evaluate", { contextId: appWorld.executionContextId, expression, returnByValue: true });
            assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
            return result.result.value;
        };
        const hostLayout = await browser.evaluate(`(() => {
            const host = document.querySelector(".host-main"), frame = host.querySelector("iframe");
            host.scrollLeft = host.scrollWidth - host.clientWidth;
            return { viewport: innerWidth, hostWidth: host.clientWidth, appWidth: frame.getBoundingClientRect().width,
                scrollLeft: host.scrollLeft, appLeft: frame.getBoundingClientRect().left };
        })()`);
        const nested = await insideApp(`(() => {
            const button = document.querySelector("#continue-design").getBoundingClientRect();
            return { viewport: innerWidth, workspaceWidth: document.querySelector("#studio-workspace").getBoundingClientRect().width,
                frameWidth: document.querySelector("#development-frame").getBoundingClientRect().width,
                footerWidth: document.querySelector("#next-action-bar").getBoundingClientRect().width,
                buttonRight: button.right, x: button.left + button.width / 2, y: button.top + button.height / 2 };
        })()`);
        t.diagnostic(JSON.stringify({ step: "640-host-retains-900-application-viewport", hostLayout, nested }));
        assert.equal(hostLayout.viewport, 640);
        assert.equal(hostLayout.appWidth, 900, "Keep the browser host's deliberate minimum application viewport.");
        assert.equal(hostLayout.scrollLeft, 260, "The original host remains horizontally scrollable.");
        assert.equal(nested.viewport, 900);
        assert.equal(nested.workspaceWidth, 900);
        assert.equal(nested.frameWidth, 900);
        assert.equal(nested.footerWidth, 900);
        assert.ok(nested.buttonRight + hostLayout.appLeft <= hostLayout.viewport);
        await browser.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: nested.x + hostLayout.appLeft, y: nested.y });
        assert.equal(requests.filter(request => request.path === "/api/development/continue").length, 1);
        assert.deepEqual(browser.exceptions, []);
        assert.deepEqual(failures, []);
    });
