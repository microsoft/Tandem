import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { BrowserStore, parseHostSnapshot, readLaunchCapability } from "../src/browser/client.js";
import type { HostSnapshot } from "../src/browser/contracts.js";
import type { ApplicationHeader } from "../src/renderer/standalone-header.js";
import { decision, rendererFixtureScript, state as rendererState } from "./helpers/react-harness.js";
import { browserAvailable, openFixtureBrowser } from "../development/tandem/test/helpers/browser-fixture.mjs";

const applicationHeader: ApplicationHeader = {
    scope: "effort-generation", version: "1.1.15", lifecycle: "2. Requirements | discovery",
    controls: {
        reload: { label: "Reload", title: "Reload the extension", disabled: false, busy: false },
        reset: { label: "Reset", title: "Reset effort", disabled: false, busy: false },
        signIn: { label: "Sign in", title: "Sign in with Microsoft", disabled: false, busy: false },
        cancelSignIn: null,
    },
    messages: [],
};

function state(overrides: Partial<HostSnapshot> = {}): HostSnapshot {
    return { revision: 1, generation: "generation-one", version: "1.1.15", phase: "ready", workspace: "C:\\workspace",
        canvasUrl: "http://127.0.0.1:5000/", sessionId: "session-one", status: "Ready", error: null, warning: null,
        permissionMode: "ask", requests: [], recentWorkspaces: ["C:\\workspace"], ...overrides };
}

let compiled: Promise<string> | undefined;
function compile(): Promise<string> {
    return compiled ??= build({
        stdin: { contents: `
            import React from "react";
            import {createRoot} from "react-dom/client";
            import {flushSync} from "react-dom";
            import {BrowserApp} from "./app.js";
            import {BrowserStore} from "./client.js";
            export function mount() {
                const store = new BrowserStore("t".repeat(43));
                const root = createRoot(document.getElementById("root"));
                flushSync(() => root.render(React.createElement(BrowserApp, {store, connect:false})));
                return {store, flushSync, dispose: () => flushSync(() => root.unmount())};
            }
        `, loader: "tsx", resolveDir: fileURLToPath(new URL("../src/browser/", import.meta.url)) },
        bundle: true, write: false, platform: "browser", format: "iife", globalName: "HostTest",
        loader: { ".png": "dataurl" },
        target: "es2022", logLevel: "silent", define: { "process.env.NODE_ENV": '"development"' },
    }).then((result) => result.outputFiles[0].text);
}

async function fixture(t: TestContext) {
    const dom = new JSDOM('<html><body><div id="root"></div></body></html>', {
        url: "http://127.0.0.1:4567/", runScripts: "outside-only", pretendToBeVisual: true,
    });
    const window = dom.window;
    const requests: Array<{ path: string; body: Record<string, unknown> | null; headers: Record<string, string> }> = [];
    const errors: string[] = [];
    let snapshot = state();
    window.console.error = (...args: unknown[]) => errors.push(args.map(String).join(" "));
    Object.assign(window, {
        AbortController, AbortSignal, TextEncoder, TextDecoder,
        ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
        fetch: async function(this: Window | undefined, path: string, options: RequestInit) {
            assert.ok(this === undefined || this === window || this.window === this,
                "browser fetch must not be invoked with the store as its receiver");
            const body = options.body ? JSON.parse(String(options.body)) : null;
            requests.push({ path, body, headers: options.headers as Record<string, string> });
            if (path.startsWith("/host/directories")) return Response.json(body?.name
                ? { path: `${body.parent}\\${body.name}`, parent: body.parent, directories: [], truncated: false }
                : { path: "C:\\workspace", parent: "C:\\", directories: [{ name: "nested", path: "C:\\workspace\\nested" }], truncated: false });
            if (path === "/host/diagnostics") return Response.json({ text: "Redacted diagnostic output" });
            if (body.type === "permission-response" || body.type === "question-response") {
                snapshot = { ...snapshot, requests: snapshot.requests.filter((request) => request.id !== body.id) };
            }
            if (body.type === "set-permission-mode") snapshot = { ...snapshot, permissionMode: body.mode };
            if (body.type === "stop") snapshot = { ...snapshot, phase: "stopped", status: "Tandem stopped", canvasUrl: null };
            return Response.json({ ...snapshot, revision: ++snapshot.revision });
        },
    });
    window.eval(await compile());
    const mounted = window.HostTest.mount();
    const flush = async () => {
        for (let index = 0; index < 4; index++) { await new Promise((resolve) => setTimeout(resolve, 0)); mounted.flushSync(() => {}); }
    };
    const accept = async (value: HostSnapshot) => {
        snapshot = value;
        mounted.flushSync(() => mounted.store.accept(value));
        await flush();
    };
    await accept(snapshot);
    t.after(() => { mounted.dispose(); window.close(); });
    const button = (text: string) => {
        const element = [...window.document.querySelectorAll<HTMLButtonElement>("button")]
            .find((button) => (button.getAttribute("aria-label") || button.textContent) === text);
        assert.ok(element, `Missing button ${text}`);
        return element;
    };
    return { window, document: window.document, requests, errors, accept, button,
        async click(text: string) { mounted.flushSync(() => button(text).click()); await flush(); },
        async input(selector: string, value: string) {
            const element = window.document.querySelector<HTMLInputElement>(selector)!;
            Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(element, value);
            mounted.flushSync(() => element.dispatchEvent(new window.Event("input", { bubbles: true })));
            await flush();
        },
        async select(selector: string, value: string) {
            const element = window.document.querySelector<HTMLSelectElement>(selector)!;
            Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")!.set!.call(element, value);
            mounted.flushSync(() => element.dispatchEvent(new window.Event("change", { bubbles: true })));
            await flush();
        },
        async fromApplication(data: Record<string, unknown>, origin = "http://127.0.0.1:5000", source?: MessageEventSource | null) {
            const frame = window.document.querySelector<HTMLIFrameElement>("#tandem-application")!;
            const channel = new URLSearchParams(new URL(frame.src).hash.slice(1)).get("header-channel");
            const event = new window.MessageEvent("message", { data: { channel, ...data }, origin, source: source === undefined ? frame.contentWindow : source });
            mounted.flushSync(() => window.dispatchEvent(event));
            await flush();
        },
    };
}

test("browser shell preserves the application origin, microphone delegation and host controls", async (t) => {
    const h = await fixture(t);
    const frame = h.document.querySelector<HTMLIFrameElement>("#tandem-application")!;
    assert.equal(new URL(frame.src).origin, "http://127.0.0.1:5000");
    assert.equal(new URL(frame.src).pathname, "/");
    assert.equal(new URLSearchParams(new URL(frame.src).hash.slice(1)).get("tandem-host"), "http://127.0.0.1:4567");
    assert.match(frame.getAttribute("allow")!, /microphone http:\/\/127\.0\.0\.1:5000/);
    assert.equal(frame.getAttribute("referrerpolicy"), "no-referrer");
    assert.equal(h.document.querySelector(".host-main")!.getAttribute("tabindex"), "0");
    assert.ok(!frame.src.includes("token"));
    const header = h.document.querySelector(".host-header")!;
    assert.equal(header.querySelector("h1")!.textContent, "Tandem");
    assert.match(header.querySelector<HTMLImageElement>(".brand-artwork")!.src, /^data:image\/png;base64,/, "reuse the application's bicycle artwork");
    assert.ok(!header.textContent!.includes("Standalone"), "the duplicate host branding is removed");
    assert.ok(header.querySelector('nav[aria-label="Workspace controls"]'));
    assert.equal(h.document.querySelector(".host-toolbar"), null, "workspace controls must not occupy a second row");
    for (const label of ["Open folder", "Reload page", "Diagnostics", "About", "Stop"]) {
        const control = h.button(label);
        assert.ok(header.contains(control));
        assert.ok(control.title.includes(label));
        assert.equal(control.textContent, "", "header buttons use icons instead of visible labels");
        assert.equal(control.querySelector("svg")?.getAttribute("aria-hidden"), "true");
    }
    const permissions = header.querySelector<HTMLSelectElement>('select[aria-label="Tool permissions"]')!;
    assert.equal(permissions.title, "Upstream tool permissions: Ask each time");
    assert.equal(permissions.value, "ask");
    await h.click("Reload page");
    assert.notEqual(h.document.querySelector("#tandem-application"), frame);
    assert.equal(h.requests.length, 0, "reloading the page must not restart the runtime");
    await h.click("About");
    assert.match(h.document.querySelector('[role="dialog"]')!.textContent!, /Closing a tab leaves the backend running/);
    assert.deepEqual(h.errors, []);
});

test("permission dialog approves only the displayed ID and does not offer policy bypass", async (t) => {
    const h = await fixture(t);
    await h.accept(state({ phase: "starting", canvasUrl: null, requests: [
        { type: "permission", id: "policy", title: "Allow managed action?", details: "Managed policy requires an explicit decision.", canAllowAllForSession: false },
    ] }));
    assert.match(h.document.querySelector('[role="dialog"]')!.textContent!, /Managed policy/);
    assert.equal([...h.document.querySelectorAll("button")].some((button) => button.textContent === "Allow all for this session"), false);
    await h.click("Allow once");
    assert.deepEqual(h.requests[0].body, { type: "permission-response", id: "policy", approved: true, generation: "generation-one" });
    assert.equal(h.requests[0].headers.Authorization, `Bearer ${"t".repeat(43)}`);
    assert.equal(h.document.querySelector('[role="dialog"]'), null);
    assert.deepEqual(h.errors, []);
});

test("allow-all and Stop require confirmation while workspace selection remains usable", async (t) => {
    const h = await fixture(t);
    await h.select('select[aria-label="Tool permissions"]', "allow-all");
    assert.match(h.document.querySelector('[role="dialog"]')!.textContent!, /without further tool confirmation/);
    await h.click("Cancel");
    assert.equal(h.requests.length, 0);
    await h.select('select[aria-label="Tool permissions"]', "allow-all");
    await h.click("Confirm");
    assert.deepEqual(h.requests[0].body, { type: "set-permission-mode", mode: "allow-all", generation: "generation-one" });
    const permissionControl = h.document.querySelector(".host-permissions")!;
    assert.equal(permissionControl.getAttribute("data-mode"), "allow-all");
    assert.equal(permissionControl.getAttribute("title"), "Upstream tool permissions: Allow all for this session");
    assert.ok(permissionControl.querySelector(".lucide-shield-alert"));
    await h.select('select[aria-label="Tool permissions"]', "ask");
    assert.deepEqual(h.requests[1].body, { type: "set-permission-mode", mode: "ask", generation: "generation-one" });
    assert.equal(permissionControl.getAttribute("title"), "Upstream tool permissions: Ask each time");
    await h.click("Open folder");
    assert.ok(h.button("nested"));
    await h.click("Cancel");
    await h.click("Stop");
    assert.match(h.document.querySelector('[role="dialog"]')!.textContent!, /Closing a tab alone does not stop/);
    await h.click("Confirm");
    assert.equal(h.requests.at(-1)!.body!.type, "stop");
    assert.equal(h.document.querySelector("#tandem-application"), null);
    assert.match(h.document.querySelector(".host-notice h1")!.textContent!, /Tandem stopped/);
    assert.deepEqual(h.errors, []);
});

test("header icon controls retain their disabled states while the backend is unavailable", async (t) => {
    const h = await fixture(t);
    await h.accept(state({ revision: 2, phase: "stopped", canvasUrl: null }));
    for (const label of ["Open folder", "Reload page", "Diagnostics", "Stop"]) assert.equal(h.button(label).disabled, true);
    assert.equal(h.button("About").disabled, false);
    assert.equal(h.document.querySelector<HTMLSelectElement>('select[aria-label="Tool permissions"]')!.disabled, true);
    assert.equal(h.document.querySelector(".host-permissions")!.getAttribute("data-disabled"), "true");
});

test("folder picker can create and select a new folder without switching the running workspace", async (t) => {
    const h = await fixture(t);
    await h.click("Open folder");
    await h.click("New folder");
    await h.input("#new-folder-name", "A new workspace");
    await h.click("Create folder");
    const request = h.requests.find((request) => request.body?.name === "A new workspace");
    assert.deepEqual(request?.body, { generation: "generation-one", parent: "C:\\workspace", name: "A new workspace" });
    assert.equal(h.document.querySelector<HTMLInputElement>("#workspace-path")!.value, "C:\\workspace\\A new workspace");
    assert.equal(new URL(h.document.querySelector("iframe")!.src).origin, "http://127.0.0.1:5000");
    assert.deepEqual(h.errors, []);
});

test("combined header delegates application icons only to the current frame and keeps errors visible", async (t) => {
    const h = await fixture(t);
    const frame = h.document.querySelector<HTMLIFrameElement>("#tandem-application")!;
    const sent: Array<{ data: Record<string, unknown>; origin: string }> = [];
    frame.contentWindow!.postMessage = (data: Record<string, unknown>, origin: string) => { sent.push({ data: JSON.parse(JSON.stringify(data)), origin }); };
    await h.fromApplication({ type: "tandem:header:state", header: applicationHeader }, "https://untrusted.example");
    await h.fromApplication({ type: "tandem:header:state", header: applicationHeader }, undefined, null);
    assert.equal(h.document.querySelector('[aria-label="Reset effort"]'), null);
    await h.fromApplication({ type: "tandem:header:ready" });
    assert.equal(sent.at(-1)!.data.type, "tandem:header:connect");
    await h.fromApplication({ type: "tandem:header:state", header: applicationHeader });
    for (const label of ["Reload extension", "Reset effort", "Sign in with Microsoft", "Cancel Microsoft sign-in"]) {
        assert.equal(h.document.querySelector(`[aria-label="${label}"]`), null, "Maintenance is not recreated in hosted chrome.");
    }
    assert.equal(sent.some(item => item.data.type === "tandem:header:action"), false);
    assert.equal(h.requests.length, 0, "application actions must not bypass existing iframe handlers through host HTTP");
    await h.fromApplication({ type: "tandem:header:state", header: {
        ...applicationHeader, controls: { ...applicationHeader.controls, signIn: { ...applicationHeader.controls.signIn, disabled: true, busy: true },
            cancelSignIn: { label: "Cancel Microsoft sign-in", title: "Cancel", disabled: false, busy: false } },
        messages: [{ id: "speech", text: "Complete Microsoft sign-in", error: false }],
    } });
    assert.equal(h.document.querySelector('[aria-label="Sign in with Microsoft"]'), null);
    assert.match(h.document.body.textContent!, /Complete Microsoft sign-in/);
    assert.equal(h.document.querySelector('[aria-label="Cancel Microsoft sign-in"]'), null, "Voice cancellation belongs to the requesting input.");
    await h.fromApplication({ type: "tandem:header:state", header: {
        ...applicationHeader, messages: [{ id: "reset", text: "Reset could not stop the active work.", error: true }],
    } });
    assert.match(h.document.querySelector('.host-error[role="alert"]')!.textContent!, /could not stop/);
    const oldChannel = sent[0].data.channel;
    await h.click("Reload page");
    await h.fromApplication({ type: "tandem:header:state", channel: oldChannel, header: applicationHeader });
    assert.equal(h.document.querySelector('[aria-label="Reset effort"]'), null, "stale iframe state cannot restore old controls");
});

test("an incompatible header response restores the application's own controls", async (t) => {
    const h = await fixture(t);
    const frame = h.document.querySelector<HTMLIFrameElement>("#tandem-application")!;
    const sent: Record<string, unknown>[] = [];
    frame.contentWindow!.postMessage = (data: Record<string, unknown>) => { sent.push(data); };
    await h.fromApplication({ type: "tandem:header:state", header: applicationHeader });
    await h.fromApplication({ type: "tandem:header:state", header: { ...applicationHeader, controls: null } });
    assert.equal(sent.at(-1)!.type, "tandem:header:disconnect");
    assert.equal(h.document.querySelector('[aria-label="Reset effort"]'), null);
    assert.match(h.document.querySelector('[role="alert"]')!.textContent!, /original controls remain available/);
});

test("browser footer combines workspace help, navigation and host status without reviving stale controls", async (t) => {
    const h = await fixture(t);
    const frame = h.document.querySelector<HTMLIFrameElement>("#tandem-application")!;
    const sent: Array<{ data: Record<string, unknown>; origin: string }> = [];
    frame.contentWindow!.postMessage = (data: Record<string, unknown>, origin: string) => {
        sent.push({ data: JSON.parse(JSON.stringify(data)), origin });
    };
    await h.fromApplication({ type: "tandem:header:ready" });
    assert.equal(sent.at(-1)!.data.statusBar, true);
    const status = { text: ".tandem\\efforts\\active\\stages\\requirements-r53.json", error: false, action: "Add the first usage" };
    await h.fromApplication({ type: "tandem:header:state", header: { ...applicationHeader, status } }, "https://untrusted.example");
    assert.equal(h.document.querySelector(".host-application-status"), null);
    await h.fromApplication({ type: "tandem:header:state", header: { ...applicationHeader, status } });
    const footer = h.document.querySelector(".host-status")!;
    assert.equal(footer.querySelector(".host-status-state")!.textContent, "Ready");
    assert.equal(footer.querySelector(".host-application-status > span")!.textContent, status.text);
    assert.equal(footer.querySelector<HTMLElement>(".host-application-status > span")!.title, status.text);
    assert.match(footer.querySelector(".host-status-hint")!.textContent!, /Tab close keeps running/);
    assert.ok(footer.contains(h.button("Go to action")));
    assert.equal(h.button("Go to action").title, "Go to action: Add the first usage");
    await h.click("Go to action");
    const channel = sent[0].data.channel;
    assert.deepEqual(sent.at(-1), { data: { type: "tandem:status:action", channel, scope: applicationHeader.scope },
        origin: "http://127.0.0.1:5000" });
    assert.equal(h.requests.length, 0);
    await h.fromApplication({ type: "tandem:header:state", header: { ...applicationHeader,
        status: { text: "Stage output could not be saved.", error: true, action: null } } });
    assert.equal(footer.querySelector(".host-application-status")!.getAttribute("data-status"), "error");
    assert.match(footer.querySelector(".host-application-status > span")!.textContent!, /could not be saved/);
    assert.equal(footer.querySelector(".host-status-action"), null);
    await h.click("Reload page");
    assert.equal(footer.querySelector(".host-application-status"), null);
    await h.fromApplication({ type: "tandem:header:state", channel, header: { ...applicationHeader, status } });
    assert.equal(footer.querySelector(".host-status-action"), null);
    assert.deepEqual(h.errors, []);
});

test("real browser keeps merged status and Requirements layouts bounded with working keyboard navigation",
    { skip: !browserAvailable, timeout: 60_000 }, async (t) => {
        const snapshot = rendererState();
        const savedPath = ".tandem\\efforts\\active\\stages\\requirements-r53.json";
        snapshot.status = savedPath;
        snapshot.provider = { ...snapshot.provider, canSubmitAnswers: false };
        const [hostScript, applicationScript, styles, applicationStyles] = await Promise.all([
            compile(), rendererFixtureScript(),
            build({ entryPoints: [fileURLToPath(new URL("../src/browser/styles.css", import.meta.url))],
                bundle: true, write: false, logLevel: "silent" }),
            build({ entryPoints: [fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url))],
                bundle: true, write: false, logLevel: "silent" }),
        ]);
        let origin: string;
        const unexpected: string[] = [];
        const server = createServer((request, response) => {
            const path = new URL(request.url || "/", "http://127.0.0.1").pathname;
            const send = (type: string, body: string) => {
                response.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
                response.end(body);
            };
            request.resume();
            if (path === "/host") send("text/html", '<!doctype html><html><head><link rel="stylesheet" href="/host.css"></head>'
                + '<body><div id="root"></div><script src="/host.js"></script><script>'
                + `window.hostFixture = HostTest.mount(); hostFixture.flushSync(() => hostFixture.store.accept(${JSON.stringify(state({ canvasUrl: `${origin}/` }))}));`
                + '</script></body></html>');
            else if (path === "/") send("text/html", '<!doctype html><html><head><link rel="stylesheet" href="/application.css"></head>'
                + '<body><div id="root"></div><script src="/application.js"></script><script>'
                + `window.workspaceFixture = TandemTest.mount(); workspaceFixture.flushSync(() => workspaceFixture.store.accept(${JSON.stringify(snapshot)}));`
                + '</script></body></html>');
            else if (path === "/host.js") send("text/javascript", hostScript);
            else if (path === "/application.js") send("text/javascript", applicationScript);
            else if (path === "/host.css") send("text/css", styles.outputFiles[0].text);
            else if (path === "/application.css") send("text/css", applicationStyles.outputFiles[0].text);
            else if (path === "/api/project-entry") send("application/json", JSON.stringify({ projectPath: "C:\\fixture-project", startingPath: "preparation" }));
            else if (path === "/api/project-entry/open") send("application/json", JSON.stringify({ developmentStarted: false, developmentContext: false }));
            else if (path === "/api/development/view") send("application/json", JSON.stringify({ url: `${origin}/conversation`, channel: "fixture-project" }));
            else if (path === "/conversation") send("text/html", "<!doctype html><html><body>Private Development</body></html>");
            else if (path === "/favicon.ico") { response.writeHead(204); response.end(); }
            else { unexpected.push(`${request.method} ${path}`); response.writeHead(404); response.end(); }
        });
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        t.after(() => new Promise<void>((resolve, reject) => {
            server.close((error) => error ? reject(error) : resolve());
            server.closeAllConnections();
        }));
        const address = server.address();
        assert.ok(address && typeof address !== "string");
        origin = `http://127.0.0.1:${address.port}`;
        const browser = await openFixtureBrowser(t);
        await browser.call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
        await browser.call("Page.navigate", { url: `${origin}/host` });
        await browser.waitFor(`document.querySelector(".host-application-status > span")?.textContent === ${JSON.stringify(savedPath)}
            && document.querySelector("#tandem-application")?.contentDocument.querySelector("#next-action-bar")?.hidden`);
        const longStatus = `${savedPath} ${"Saved workspace status and help. ".repeat(40)}`;
        await browser.evaluate(`(() => {
            const frame = document.querySelector("#tandem-application").contentWindow;
            frame.workspaceFixture.flushSync(() => frame.workspaceFixture.store.accept(${JSON.stringify({ ...snapshot, revision: 2, status: longStatus })}));
        })()`);
        await browser.waitFor(`document.querySelector(".host-application-status > span")?.title === ${JSON.stringify(longStatus)}`);
        for (const width of [1280, 375]) {
            await browser.call("Emulation.setDeviceMetricsOverride", { width, height: 800, deviceScaleFactor: 1, mobile: false });
            const geometry = await browser.evaluate(`(() => {
                const footer = document.querySelector(".host-status"), text = footer.querySelector(".host-application-status > span");
                const frame = document.querySelector("#tandem-application"), inner = frame.contentDocument;
                return { width: footer.getBoundingClientRect().width, height: footer.getBoundingClientRect().height,
                    hiddenHeight: inner.querySelector("#next-action-bar").getBoundingClientRect().height,
                    workspaceHeight: inner.querySelector("#studio-workspace").getBoundingClientRect().height,
                    frameHeight: frame.clientHeight, clipped: text.scrollWidth > text.clientWidth,
                    title: text.title, hintVisible: getComputedStyle(footer.querySelector(".host-status-hint")).display !== "none" };
            })()`);
            assert.equal(geometry.width, width);
            assert.equal(geometry.height, 28, "The merged footer remains a single compact row.");
            assert.equal(geometry.hiddenHeight, 0, "The old upper bar occupies no space.");
            assert.equal(geometry.workspaceHeight, geometry.frameHeight, "The workspace reclaims the removed row.");
            assert.equal(geometry.clipped, true);
            assert.equal(geometry.title, longStatus);
            assert.equal(geometry.hintVisible, width > 680);
        }
        await browser.evaluate(`(() => {
            const frame = document.querySelector("#tandem-application").contentWindow;
            frame.workspaceFixture.flushSync(() => frame.workspaceFixture.store.accept(${JSON.stringify(rendererState("requirements", 3))}));
        })()`);
        await browser.waitFor('Boolean(document.querySelector(".host-status-action"))');
        await browser.evaluate('document.querySelector(".host-status-action").focus()');
        await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
        await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
        await browser.waitFor('document.querySelector("#tandem-application").contentDocument.activeElement.id === "add-usage"');
        await browser.call("Emulation.setDeviceMetricsOverride", { width: 1920, height: 800, deviceScaleFactor: 1, mobile: false });
        const savedRequirements = rendererState("prototype", 4);
        savedRequirements.requirements = { substage: "dag", usageItems: ["Validate the simulator's interaction and visualization."], suggestions: [] };
        savedRequirements.decisionGraph.nodes = [decision("Interface validation approach", "answered")];
        await browser.evaluate(`(() => {
            const frame = document.querySelector("#tandem-application").contentWindow;
            frame.__renderMermaid = async () => ({ svg: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700" viewBox="0 0 1200 700"><rect width="1200" height="700" fill="white" /></svg>' });
            frame.workspaceFixture.flushSync(() => frame.workspaceFixture.store.accept(${JSON.stringify(savedRequirements)}));
        })()`);
        await browser.waitFor('document.querySelector("#tandem-application").contentDocument.querySelector("#live-preview-panel")?.hidden === false');
        await browser.evaluate(`(() => {
            const frame = document.querySelector("#tandem-application").contentWindow;
            frame.document.querySelector("#design-tree-workspace-tab").dispatchEvent(new frame.MouseEvent("mousedown", { bubbles: true, button: 0 }));
        })()`);
        await browser.waitFor('document.querySelector("#tandem-application").contentDocument.querySelector("#reopen-stage")?.hidden === false');
        await browser.waitFor('Boolean(document.querySelector("#tandem-application").contentDocument.querySelector("#design-tree-host svg"))');
        for (const expanded of [false, true]) {
            if (expanded) {
                await browser.evaluate('document.querySelector("#tandem-application").contentDocument.querySelector("#requirements-substage-section .usage-suggestion[aria-expanded]").click()');
                await browser.waitFor('document.querySelector("#tandem-application").contentDocument.querySelector("#requirements-substage-section .usage-suggestion[aria-expanded]")?.getAttribute("aria-expanded") === "true"');
            }
            const layout = await browser.evaluate(`(() => {
                const inner = document.querySelector("#tandem-application").contentDocument;
                const bounds = selector => {
                    const rect = inner.querySelector(selector).getBoundingClientRect();
                    return { top: rect.top, bottom: rect.bottom, height: rect.height };
                };
                return { actions: bounds(".previewbar > .phase-actions"), intake: bounds("#requirements-substage-section"),
                    trigger: bounds("#requirements-substage-section .usage-suggestion[aria-expanded]"), graph: bounds("#design-tree-card"),
                    panel: bounds("#design-tree-panel") };
            })()`);
            assert.ok(layout.trigger.height > 0, "Accepted usages remain accessible.");
            assert.ok(layout.intake.height > layout.trigger.height, `Usage history must not collapse into a border strip: ${JSON.stringify(layout)}`);
            assert.ok(layout.trigger.bottom <= layout.intake.bottom, "The accepted usages control remains visible.");
            assert.ok(layout.actions.bottom <= layout.intake.top, "Stage actions do not overlap usage history.");
            assert.ok(layout.intake.bottom <= layout.graph.top, "The decision card does not overlap usage history.");
            assert.ok(layout.graph.bottom <= layout.panel.bottom, "The decision card stays within its stage workspace.");
        }
        for (const width of [1920, 1024, 375]) {
            await browser.call("Emulation.setDeviceMetricsOverride", { width, height: 800, deviceScaleFactor: 1, mobile: false });
            if (width === 375) {
                await browser.call("Page.navigate", { url: `${origin}/` });
                await browser.waitFor("Boolean(window.workspaceFixture?.store.getSnapshot().state)");
                await browser.evaluate(`workspaceFixture.flushSync(() => workspaceFixture.store.accept(${JSON.stringify(savedRequirements)}))`);
            }
            for (const tab of ["preparation", "design-tree", "sketch", "live-preview"]) {
                await browser.evaluate(`(() => {
                    const inner = document.querySelector("#tandem-application")?.contentDocument ?? document;
                    const frame = inner.defaultView;
                    const trigger = inner.querySelector("#${tab}-workspace-tab");
                    trigger.dispatchEvent(new frame.MouseEvent("mousedown", { bubbles: true, button: 0 }));
                    trigger.focus();
                })()`);
                await browser.waitFor(`(document.querySelector("#tandem-application")?.contentDocument ?? document).querySelector("#${tab}-workspace-tab")?.getAttribute("aria-selected") === "true"`);
                const layout = await browser.evaluate(`(() => {
                    const inner = document.querySelector("#tandem-application")?.contentDocument ?? document;
                    const header = inner.querySelector(".previewbar"), actions = header.querySelector(".phase-actions");
                    const tabs = inner.querySelector("#stage-workspace-tabs"), selected = inner.querySelector("#${tab}-workspace-tab");
                    const panel = inner.getElementById(selected.getAttribute("aria-controls"));
                    const bounds = element => {
                        const rect = element.getBoundingClientRect();
                        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, height: rect.height };
                    };
                    return { header: bounds(header), actions: bounds(actions), tabs: bounds(tabs), selected: bounds(selected), panel: bounds(panel),
                        controls: Array.from(actions.querySelectorAll(":scope > button:not([hidden])"), bounds),
                        headerBorder: inner.defaultView.getComputedStyle(header).borderBottomWidth,
                        actionsBorder: inner.defaultView.getComputedStyle(actions).borderBottomWidth,
                        viewportWidth: inner.defaultView.innerWidth,
                        fits: header.scrollWidth <= header.clientWidth + 1,
                        inPanel: Boolean(panel.querySelector(".phase-actions")) };
                })()`);
                assert.equal(layout.headerBorder, "0px");
                assert.equal(layout.actionsBorder, "0px");
                assert.equal(layout.viewportWidth, width);
                assert.equal(layout.fits, true, `Stage header fits at ${width}: ${JSON.stringify(layout)}`);
                assert.ok(layout.header.left >= 0 && layout.header.right <= width + 1, "The whole header stays within the actual application viewport.");
                assert.equal(layout.inPanel, false);
                assert.ok(layout.actions.height > 0 && layout.controls.length > 0);
                assert.ok(layout.actions.left >= layout.header.left && layout.actions.right <= layout.header.right + 1);
                assert.ok(layout.selected.left >= layout.tabs.left - 1 && layout.selected.right <= layout.tabs.right + 1,
                    "The focused stage tab stays visible in the horizontal scroller.");
                assert.ok(layout.panel.top >= layout.header.bottom - 1, "Content begins below the shared header.");
                for (const control of layout.controls) {
                    assert.ok(control.left >= layout.actions.left - 1 && control.right <= layout.actions.right + 1);
                    assert.ok(control.top >= layout.actions.top - 1 && control.bottom <= layout.actions.bottom + 1);
                }
                if (width === 1920) {
                    assert.ok(layout.actions.left >= layout.tabs.right, "Wide layouts keep actions to the right of the tabs.");
                    assert.ok(layout.actions.top < layout.tabs.bottom && layout.actions.bottom > layout.tabs.top);
                    if (tab === "preparation" && process.env.TANDEM_UI_EVIDENCE) {
                        await writeFile(join(process.env.TANDEM_UI_EVIDENCE, "preparation-workflow-actions-1920.png"), await browser.screenshot());
                    }
                }
            }
            if (process.env.TANDEM_UI_EVIDENCE) {
                await writeFile(join(process.env.TANDEM_UI_EVIDENCE, `stage-workflow-actions-${width}.png`), await browser.screenshot());
            }
        }
        assert.deepEqual(unexpected, []);
        assert.deepEqual(browser.exceptions, []);
    });

test("browser capability survives same-tab reload but is removed from the address", () => {
    const token = "a".repeat(43);
    const dom = new JSDOM("", { url: `http://127.0.0.1:4567/#token=${token}` });
    try {
        const { location, sessionStorage, history } = dom.window;
        assert.equal(readLaunchCapability(location, sessionStorage, history), token);
        assert.equal(location.hash, "");
        assert.equal(readLaunchCapability(location, sessionStorage, history), token);
        sessionStorage.clear();
        assert.throws(() => readLaunchCapability(location, sessionStorage, history), /private launch URL/);
    } finally { dom.window.close(); }
});

test("browser host state rejects unsafe URLs and ignores out-of-order snapshots", () => {
    const store = new BrowserStore("a".repeat(43));
    store.accept(state({ revision: 5 }));
    store.accept(state({ revision: 4, permissionMode: "allow-all" }));
    assert.equal(store.getSnapshot().host!.permissionMode, "ask");
    assert.throws(() => parseHostSnapshot(state({ canvasUrl: "https://untrusted.example/" })), /unsafe/);
    assert.throws(() => parseHostSnapshot({ ...state(), requests: [{ type: "stopped" }] }), /invalid pending request/);
});

test("inline-script CSP hashes the text the HTML parser actually executes, including Windows licenses", async () => {
    const compiled = await build({
        entryPoints: [fileURLToPath(new URL("../src/browser/assets.ts", import.meta.url))],
        bundle: true, platform: "node", format: "cjs", write: false,
        plugins: [{
            name: "browser-assets-fixture",
            setup(api) {
                api.onResolve({ filter: /^tandem:browser-/ }, (args) => ({ path: args.path, namespace: "fixture" }));
                api.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
                    contents: `export default ${JSON.stringify(args.path.endsWith("client")
                        ? '/* License\r\nWindows CRLF\r\n*/\r\nconsole.log("</script>");\r\n' : "body { margin: 0; }")};`,
                }));
            },
        }],
    });
    const module = { exports: {} as { page: string; scriptHash: string } };
    runInNewContext(compiled.outputFiles[0].text, { module, require: createRequire(import.meta.url) });
    const dom = new JSDOM(module.exports.page);
    try {
        const scripts = dom.window.document.querySelectorAll("script");
        assert.equal(scripts.length, 1);
        assert.equal(module.exports.scriptHash, `sha256-${createHash("sha256").update(scripts[0].textContent!).digest("base64")}`);
        assert.match(scripts[0].textContent!, /console\.log/);
    } finally { dom.window.close(); }
});
