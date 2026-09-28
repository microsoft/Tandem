import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { test, type TestContext } from "node:test";
import { BrowserStore, parseHostSnapshot, readLaunchCapability } from "../src/browser/client.js";
import type { HostSnapshot } from "../src/browser/contracts.js";
import type { ApplicationHeader } from "../src/renderer/standalone-header.js";

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
    assert.ok(header.querySelector(".mark .lucide-layers"), "reuse the application's logo");
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
    assert.equal(permissions.title, "Tool permissions: Ask each time");
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
    assert.equal(permissionControl.getAttribute("title"), "Tool permissions: Allow all for this session");
    assert.ok(permissionControl.querySelector(".lucide-shield-alert"));
    await h.select('select[aria-label="Tool permissions"]', "ask");
    assert.deepEqual(h.requests[1].body, { type: "set-permission-mode", mode: "ask", generation: "generation-one" });
    assert.equal(permissionControl.getAttribute("title"), "Tool permissions: Ask each time");
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
    for (const label of ["Reload extension", "Reset effort", "Sign in with Microsoft"]) {
        const button = h.button(label);
        assert.ok(h.document.querySelector(".host-header-actions")!.contains(button));
        assert.equal(button.textContent, "");
    }
    await h.click("Reset effort");
    assert.deepEqual(sent.at(-1), { origin: "http://127.0.0.1:5000",
        data: { type: "tandem:header:action", channel: sent[0].data.channel, scope: applicationHeader.scope, action: "reset" } });
    assert.equal(h.requests.length, 0, "application actions must not bypass existing iframe handlers through host HTTP");
    await h.fromApplication({ type: "tandem:header:state", header: {
        ...applicationHeader, controls: { ...applicationHeader.controls, signIn: { ...applicationHeader.controls.signIn, disabled: true, busy: true },
            cancelSignIn: { label: "Cancel Microsoft sign-in", title: "Cancel", disabled: false, busy: false } },
        messages: [{ id: "speech", text: "Complete Microsoft sign-in", error: false }],
    } });
    assert.equal(h.button("Sign in with Microsoft").disabled, true);
    assert.match(h.document.body.textContent!, /Complete Microsoft sign-in/);
    await h.click("Cancel Microsoft sign-in");
    assert.equal(sent.at(-1)!.data.action, "cancelSignIn");
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
