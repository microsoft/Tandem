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
import { requirementsResearchInput } from "../src/requirements-research.js";
import { decision, reactHarness, rendererFixtureScript, state as rendererState } from "./helpers/react-harness.js";
import { browserAvailable, openFixtureBrowser } from "../development/tandem/test/helpers/browser-fixture.mjs";

const applicationHeader: ApplicationHeader = {
    scope: "effort-generation", version: "1.1.15", lifecycle: "2. Requirements | discovery",
    permissionScope: "main",
    controls: {
        reload: { label: "Reload", title: "Reload the extension", disabled: false, busy: false },
        reset: { label: "Reset", title: "Reset effort", disabled: false, busy: false },
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
    let diagnosticText = "Redacted diagnostic output";
    let commandHandler: ((body: Record<string, unknown>) => Promise<Response>) | undefined;
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
            if (path === "/host/diagnostics") return Response.json({ text: diagnosticText });
            if (path === "/host/events") return Response.json({ error: "Host connection lost. Reconnecting..." }, { status: 503 });
            if (commandHandler) return commandHandler(body);
            if (body.type === "dismiss-notice" && body.generation === snapshot.generation && body.id === snapshot.notice?.id) {
                snapshot = { ...snapshot, notice: null };
            }
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
    return { window, document: window.document, requests, errors, accept, button, flush,
        setDiagnostics(text: string) { diagnosticText = text; },
        setCommandHandler(handler: typeof commandHandler) { commandHandler = handler; },
        async disconnect() { const close = mounted.store.connect(); t.after(close); await flush(); },
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

test("browser shell preserves the application origin and host controls without device permission delegation", async (t) => {
    const h = await fixture(t);
    await h.fromApplication({ type: "tandem:header:state", header: applicationHeader });
    const frame = h.document.querySelector<HTMLIFrameElement>("#tandem-application")!;
    assert.equal(new URL(frame.src).origin, "http://127.0.0.1:5000");
    assert.equal(new URL(frame.src).pathname, "/");
    assert.equal(new URLSearchParams(new URL(frame.src).hash.slice(1)).get("tandem-host"), "http://127.0.0.1:4567");
    assert.equal(frame.getAttribute("allow"), null);
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

test("operation failure can be dismissed while the production workspace retains Preparation and its typed draft", async (t) => {
    const h = await fixture(t);
    const app = await reactHarness(t);
    const initial = rendererState();
    app.render(initial);
    await app.flush();
    const stored = app.store.getSnapshot().state;
    const input = app.get<HTMLTextAreaElement>("usage-input");
    const preparation = app.get("preparation-panel");
    assert.ok(input.matches("textarea.composer-input"), "test the production input, not a substitute textarea");
    assert.equal(app.document.querySelector(".speech-toggle, .speech-sign-in, #sketch-live-toggle, #sketch-voice-options"), null);
    await app.input(input, "Continue by typing");
    const frame = h.document.querySelector("#tandem-application");
    const message = "Tandem request failed: The saved prototype preview is unavailable. Existing designs, decisions, and draft text are unchanged.";
    await app.fire(app.get("preparation-tab"), "mousedown", { button: 0, ctrlKey: false });
    assert.equal(preparation.hidden, false);
    await h.accept(state({ revision: 2, notice: { id: "notice-one", message } }));
    h.setDiagnostics(message);
    assert.match(h.document.querySelector('.host-notification [role="alert"]')!.textContent!, /preview is unavailable/);
    const dismiss = h.button("Dismiss notification");
    assert.equal(dismiss.type, "button");
    assert.equal(dismiss.disabled, false);
    assert.match(dismiss.title, /Diagnostics/);
    dismiss.focus();
    assert.equal(h.document.activeElement, dismiss);
    await h.click("Dismiss notification");
    assert.equal(h.document.querySelector(".host-notification"), null);
    assert.equal(h.document.activeElement, h.document.querySelector(".host-main"), "keyboard focus returns to the workspace");
    assert.equal(h.document.querySelector("#tandem-application"), frame, "dismissal does not remount or reload the workspace");
    assert.equal(app.get("preparation-panel"), preparation);
    assert.equal(preparation.hidden, false);
    assert.equal(app.get("goal").textContent, initial.goal);
    assert.equal(input.value, "Continue by typing");
    assert.equal(input.readOnly, false);
    assert.equal(input.disabled, false);
    await app.fire(app.get("design-tree-tab"), "mousedown", { button: 0, ctrlKey: false });
    await app.input(input, "Continue by typing after the failure");
    assert.equal(input.value, "Continue by typing after the failure");
    assert.deepEqual(app.requests, [], "dismissal must not start a model, restart the preview or submit typed input");
    assert.deepEqual(h.requests.map(request => request.body), [{ type: "dismiss-notice", id: "notice-one", generation: "generation-one" }]);
    assert.equal(app.store.getSnapshot().state, stored);
    await h.click("Diagnostics");
    assert.ok(h.document.querySelector(".host-log")!.textContent!.includes(message));
    assert.deepEqual(h.errors, []);
});

test("dismissal is occurrence-scoped across polling, identical new errors and a newer-error race", async (t) => {
    const h = await fixture(t);
    const message = "The optional operation failed.";
    await h.accept(state({ revision: 2, notice: { id: "one", message } }));
    await h.click("Dismiss notification");
    await h.accept(state({ revision: 4, notice: null, status: "Working" }));
    assert.equal(h.document.querySelector(".host-notification"), null);
    await h.accept(state({ revision: 5, notice: { id: "two", message } }));
    assert.ok(h.button("Dismiss notification"));
    let finish!: (response: Response) => void;
    h.setCommandHandler(() => new Promise(resolve => { finish = resolve; }));
    await h.click("Dismiss notification");
    assert.equal(h.button("Dismiss notification").disabled, true);
    const newer = state({ revision: 6, notice: { id: "three", message } });
    await h.accept(newer);
    assert.equal(h.button("Dismiss notification").disabled, false, "a newer notification has its own independent control");
    finish(Response.json(newer));
    await h.flush();
    assert.deepEqual(h.requests.at(-1)!.body, { type: "dismiss-notice", id: "two", generation: "generation-one" });
    assert.ok(h.document.querySelector(".host-notification"));
    h.setCommandHandler(undefined);
    const oldButton = h.button("Dismiss notification");
    oldButton.dispatchEvent(new h.window.MouseEvent("pointerdown", { bubbles: true }));
    await h.accept(state({ revision: 7, notice: { id: "four", message } }));
    assert.equal(oldButton.isConnected, false, "do not retarget an in-progress click to a new occurrence");
    const requests = h.requests.length;
    oldButton.click();
    await h.flush();
    assert.equal(h.requests.length, requests);
    assert.ok(h.button("Dismiss notification"));
});

test("old notification replies cannot clear a new workspace or hide fatal and connection blockers", async (t) => {
    const h = await fixture(t);
    await h.accept(state({ revision: 2, notice: { id: "same-id", message: "Old operation failed" } }));
    let finish!: (response: Response) => void;
    h.setCommandHandler(() => new Promise(resolve => { finish = resolve; }));
    await h.click("Dismiss notification");
    await h.accept(state({ revision: 4, generation: "new-workspace", notice: { id: "same-id", message: "New operation failed" } }));
    finish(Response.json(state({ revision: 3, notice: null })));
    await h.flush();
    assert.match(h.document.querySelector(".host-notification")!.textContent!, /New operation/);
    await h.accept(state({ revision: 5, generation: "new-workspace", phase: "error", canvasUrl: null, notice: null, error: "Startup failed" }));
    assert.match(h.document.querySelector('[role="alert"]')!.textContent!, /Startup failed/);
    assert.equal([...h.document.querySelectorAll("button")].some(button => button.textContent === "Dismiss notification"), false);
    assert.ok(h.button("Retry"));
    await h.accept(state({ revision: 6, notice: { id: "preview", message: "Preview unavailable" }, error: "Runtime needs attention" }));
    h.setCommandHandler(undefined);
    await h.click("Dismiss notification");
    assert.match(h.document.querySelector('[role="alert"]')!.textContent!, /Runtime needs attention/);
    await h.accept(state({ revision: 8, notice: { id: "preview-again", message: "Preview unavailable" } }));
    await h.disconnect();
    assert.match(h.document.querySelector('[role="alert"]')!.textContent!, /Host connection lost/);
    assert.equal([...h.document.querySelectorAll("button")].some(button => button.textContent === "Dismiss notification"), false);
});

test("embedded failed actions have local occurrences but persistent recovery and connection messages stay visible", async (t) => {
    const h = await fixture(t);
    await h.fromApplication({ type: "tandem:header:state", header: { ...applicationHeader, messages: [
        { id: "maintenance", text: "Provider reload remains unconfirmed", error: true },
        { id: "connection", text: "Application disconnected", error: true },
        { id: "preview", text: "Review the saved preview", error: false },
    ] } });
    const message = "The application header action failed.";
    await h.fromApplication({ type: "tandem:header:error", message });
    const dismiss = h.button("Dismiss notification");
    await h.click("Dismiss notification");
    assert.match(h.document.body.textContent!, /Provider reload remains unconfirmed/);
    assert.match(h.document.body.textContent!, /Application disconnected/);
    assert.match(h.document.body.textContent!, /Review the saved preview/);
    await h.accept(state({ revision: 2, status: "Still working" }));
    assert.equal(h.document.querySelector(".host-notification"), null);
    await h.fromApplication({ type: "tandem:header:error", message });
    assert.notEqual(h.button("Dismiss notification"), dismiss);
    const frame = h.document.querySelector<HTMLIFrameElement>("#tandem-application")!;
    const oldChannel = new URLSearchParams(new URL(frame.src).hash.slice(1)).get("header-channel");
    await h.accept(state({ revision: 3, generation: "next" }));
    assert.equal(h.document.querySelector(".host-notification"), null);
    await h.fromApplication({ type: "tandem:header:error", channel: oldChannel, message });
    assert.equal(h.document.querySelector(".host-notification"), null);
    await h.fromApplication({ type: "tandem:header:error", message });
    await h.click("Dismiss notification");
    await h.click("Diagnostics");
    assert.match(h.document.querySelector(".host-log")!.textContent!, /Browser: The application header action failed/);
    assert.deepEqual(h.requests.filter(request => request.body), [], "local dismissal sends no runtime commands");
});

test("failed acknowledgments leave the original notice and a dismissible diagnostic, without reviving old-workspace errors", async (t) => {
    const h = await fixture(t);
    await h.accept(state({ revision: 2, notice: { id: "preview", message: "Preview unavailable" } }));
    h.setCommandHandler(async () => Response.json({ error: "Acknowledgment delivery failed. token=private" }, { status: 503 }));
    await h.click("Dismiss notification");
    const banners = [...h.document.querySelectorAll(".host-notification")];
    assert.equal(banners.length, 2);
    assert.ok(banners.some(banner => banner.textContent!.includes("Preview unavailable")));
    const local = banners.find(banner => banner.textContent!.includes("Acknowledgment delivery failed"))!;
    local.querySelector<HTMLButtonElement>("button")!.click();
    await h.flush();
    assert.equal(h.requests.length, 1, "dismissing the local failure does not retry its request");
    assert.equal(h.document.querySelector(".host-notification")!.textContent, "Preview unavailableDismiss notification");
    await h.click("Diagnostics");
    assert.match(h.document.querySelector(".host-log")!.textContent!, /Acknowledgment delivery failed\. token=\[redacted\]/);
    assert.doesNotMatch(h.document.querySelector(".host-log")!.textContent!, /private/);
    await h.click("Close");
    let finish!: (response: Response) => void;
    h.setCommandHandler(() => new Promise(resolve => { finish = resolve; }));
    await h.click("Dismiss notification");
    await h.accept(state({ revision: 3, generation: "next", notice: { id: "next", message: "New notice" } }));
    finish(Response.json({ error: "Old-workspace delivery failed" }, { status: 503 }));
    await h.flush();
    assert.doesNotMatch(h.document.body.textContent!, /Old-workspace delivery failed/);
    assert.equal(h.document.querySelectorAll(".host-notification").length, 1);
});

test("dismissing a notification never resolves a pending permission prompt", async (t) => {
    const h = await fixture(t);
    const prompt = { type: "permission", id: "consent", title: "Permission still required", details: "Review this operation.", canAllowAllForSession: false } as const;
    await h.accept(state({ revision: 2, notice: { id: "preview", message: "Preview unavailable" }, requests: [prompt] }));
    const allow = h.button("Allow once"), deny = h.button("Deny");
    assert.equal(h.document.activeElement, deny);
    // Simulate another tab acknowledging the notice while this tab owns the prompt.
    await h.accept(state({ revision: 3, notice: null, requests: [prompt] }));
    assert.equal(h.button("Allow once"), allow);
    assert.equal(h.button("Deny"), deny);
    assert.equal(h.document.activeElement, deny);
    assert.match(h.document.querySelector('[role="dialog"]')!.textContent!, /Permission still required/);
    assert.deepEqual(h.requests, []);
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
    await h.fromApplication({ type: "tandem:header:state", header: applicationHeader });
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

for (const permissionMode of ["ask", "allow-all"] as const) {
    test(`private Development hides only the host mode control; ${permissionMode} fallback stays fail-closed`, async (t) => {
        const h = await fixture(t);
        await h.accept(state({ revision: 2, permissionMode }));
        const selector = () => h.document.querySelector<HTMLSelectElement>('select[aria-label="Tool permissions"]');
        assert.equal(selector()!.disabled, true, "No handshake is not evidence of main-session ownership.");
        await h.fromApplication({ type: "tandem:header:state", header: applicationHeader });
        assert.equal(selector()!.disabled, false);
        assert.equal(selector()!.value, permissionMode);
        const privateHeader = { ...applicationHeader, permissionScope: "development" };
        await h.fromApplication({ type: "tandem:header:state", header: privateHeader }, "https://untrusted.example");
        assert.ok(selector(), "A foreign origin cannot hide controls.");
        await h.fromApplication({ type: "tandem:header:state", header: privateHeader });
        assert.equal(selector(), null);
        assert.equal(h.document.querySelector(".host-permissions"), null, "No label, icon, focus target or layout spacer remains.");
        assert.ok(h.button("Reload page"));
        await h.accept(state({ revision: 3, permissionMode, requests: [
            { type: "permission", id: "native", title: "Native consent", details: "Still requires approval.", canAllowAllForSession: false },
        ] }));
        assert.ok(h.button("Allow once"));
        assert.ok(h.button("Deny"));
        assert.equal(selector(), null, "Actual prompts are independent of the hidden mode selector.");
        assert.deepEqual(h.requests, [], "Hiding the control never sends consent or changes the mode.");
        await h.accept(state({ revision: 4, permissionMode }));
        await h.fromApplication({ type: "tandem:header:unavailable" });
        assert.equal(selector()!.disabled, true);
        assert.equal(selector()!.value, permissionMode, "Losing ownership evidence does not reset remembered mode.");
        await h.fromApplication({ type: "tandem:header:state", header: { ...applicationHeader, permissionScope: undefined } });
        assert.equal(selector()!.disabled, true, "Legacy headers cannot infer ownership.");
        await h.fromApplication({ type: "tandem:header:state", header: { ...applicationHeader, permissionScope: "unknown" } });
        assert.equal(selector()!.disabled, true, "Invalid headers fail closed.");
        await h.fromApplication({ type: "tandem:header:state", header: applicationHeader });
        assert.equal(selector()!.disabled, false);
        await h.disconnect();
        assert.equal(selector()!.disabled, true);
        assert.equal(selector()!.value, permissionMode);
        assert.ok(h.requests.every(request => request.body?.type !== "set-permission-mode" && request.body?.type !== "permission-response"));
    });
}

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
        ...applicationHeader, controls: { ...applicationHeader.controls,
            reload: { label: "Reload", title: "Reload the extension", disabled: true, busy: true } },
        messages: [{ id: "maintenance", text: "Reload is in progress", error: false }],
    } });
    assert.equal(h.document.querySelector('[aria-label="Reload extension"]'), null);
    assert.match(h.document.body.textContent!, /Reload is in progress/);
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
        const activeRequirements = rendererState("requirements", 3);
        activeRequirements.goal = "Build a menu and ordering app.\n" + "Keep the accepted workflow and earlier decisions available for reference. ".repeat(40);
        activeRequirements.requirements = {
            substage: "dag", usageItems: ["Browse the menu and inspect drink details.", "Place a pickup order."], suggestions: [],
        };
        activeRequirements.decisionGraph.nodes = Array.from({ length: 16 }, (_, index) => ({
            ...decision(index ? `Pickup ordering decision ${index}` : "Menu browsing and drink details", index ? "toAnswer" : "active"),
            dependencies: index ? ["Menu browsing and drink details"] : [],
            question: {
                id: `question-${index}`, text: "How should customers browse the menu and inspect each drink?",
                choices: [
                    "Show a menu list with prices and an expandable detail view for each drink.",
                    "Group the menu into categories, with prices and separate drink detail views.",
                    "Show prices and complete drink details inline in one menu.",
                ],
                recommended: "Show a menu list with prices and an expandable detail view for each drink.",
                allowFreeText: true,
            },
        }));
        await browser.evaluate(`(() => {
            const frame = document.querySelector("#tandem-application").contentWindow;
            frame.__renderMermaid = async () => ({ svg: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600" viewBox="0 0 1200 1600"><rect width="1200" height="1600" fill="white" /></svg>' });
            frame.workspaceFixture.flushSync(() => frame.workspaceFixture.store.accept(${JSON.stringify(activeRequirements)}));
        })()`);
        await browser.waitFor('Boolean(document.querySelector("#tandem-application").contentDocument.querySelector("#decision-submit"))');
        for (const width of [1920, 1280, 1024, 942, 768, 375]) {
            await browser.call("Emulation.setDeviceMetricsOverride", { width, height: 760, deviceScaleFactor: 1, mobile: false });
            const layout = await browser.evaluate(`(() => {
                const frame = document.querySelector("#tandem-application"), inner = frame.contentDocument;
                const panel = inner.querySelector("#design-tree-panel"), card = inner.querySelector("#design-tree-card");
                const question = inner.querySelector(".design-tree-inspector"), graph = inner.querySelector(".design-tree-body");
                const bounds = element => { const r = element.getBoundingClientRect(); return { left:r.left, right:r.right, top:r.top, bottom:r.bottom, width:r.width, height:r.height }; };
                return { frame:bounds(frame), panel:bounds(panel), card:bounds(card), question:bounds(question), graph:bounds(graph),
                    header:bounds(inner.querySelector(".previewbar")), finish:bounds(inner.querySelector("#complete-stage")),
                    review:bounds(inner.querySelector("#stage-input-review")),
                    outerFits: document.querySelector(".host-main").scrollWidth <= document.querySelector(".host-main").clientWidth + 1,
                    panelFits:panel.scrollWidth <= panel.clientWidth + 1, cardFits:card.scrollWidth <= card.clientWidth + 1,
                    noOuterScroll: inner.documentElement.scrollHeight <= inner.documentElement.clientHeight + 1
                        && inner.querySelector("#studio-workspace").scrollHeight <= inner.querySelector("#studio-workspace").clientHeight + 1
                        && panel.scrollHeight <= panel.clientHeight + 1,
                    dagPanel:bounds(inner.querySelector("#requirements-dag-panel")) };
            })()`);
            assert.equal(layout.outerFits, true, `The browser frame must fit the window at ${width}: ${JSON.stringify(layout)}`);
            assert.equal(layout.panelFits, true, `Requirements must not clip horizontally at ${width}: ${JSON.stringify(layout)}`);
            assert.equal(layout.cardFits, true, `The question and DAG must fit their card at ${width}: ${JSON.stringify(layout)}`);
            assert.equal(layout.noOuterScroll, true, `Only the inner panes scroll at ${width}: ${JSON.stringify(layout)}`);
            assert.ok(Math.abs(layout.card.height - layout.dagPanel.height) <= 1, "The DAG fills its tab's remaining height.");
            assert.equal(layout.review.height, 0, "An empty review area must not leave a bottom action strip.");
            assert.ok(layout.finish.left >= layout.header.left - 1 && layout.finish.right <= layout.header.right + 1
                && layout.finish.top >= layout.header.top - 1 && layout.finish.bottom <= layout.header.bottom + 1,
                `Finish requirements stays inside the tab bar at ${width}: ${JSON.stringify(layout)}`);
            if (layout.panel.width <= 680) {
                assert.ok(layout.question.bottom <= layout.graph.top + 1, `The question comes before the long DAG on narrow workspaces: ${JSON.stringify(layout)}`);
            } else {
                assert.ok(layout.question.width >= 260, "The answer inspector has enough room for realistic choices.");
            }
            for (const selector of ["#decision-question-title", "#decision-submit", ".all-recommended", "#decision-list li:last-child button"]) {
                const reachable = await browser.evaluate(`(() => {
                    const inner = document.querySelector("#tandem-application").contentDocument, target = inner.querySelector(${JSON.stringify(selector)});
                    target.scrollIntoView({block:"center", inline:"nearest"});
                    const r = target.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
                    const hit = inner.elementFromPoint(x, y);
                    return { visible: Boolean(hit && (hit === target || target.contains(hit))), disabled: target.disabled };
                })()`);
                assert.equal(reachable.visible, true, `${selector} must be reachable without an overlapping panel at ${width}.`);
                assert.notEqual(reachable.disabled, true);
            }
            const scroll = await browser.evaluate(`(() => {
                const inner = document.querySelector("#tandem-application").contentDocument;
                const diagram = inner.querySelector(".design-tree-host .diagram-scroll-area");
                const question = inner.querySelector(".design-tree-inspector");
                const toolbar = inner.querySelector(".design-tree-host .diagram-toolbar");
                const history = inner.querySelector("#discovery-history");
                const context = inner.querySelector("#requirements-pane");
                inner.querySelector('[aria-label="Actual size"]').click();
                diagram.scrollTop = 0; question.scrollTop = 0; history.scrollTop = 0;
                const top = toolbar.getBoundingClientRect().top, contextTop = context.scrollTop;
                diagram.scrollTop = diagram.scrollHeight;
                const independent = question.scrollTop === 0 && history.scrollTop === 0 && context.scrollTop === contextTop;
                const diagramTop = diagram.scrollTop;
                question.scrollTop = question.scrollHeight;
                return { diagramTop, questionTop:question.scrollTop, independent,
                    toolbarFixed: toolbar.getBoundingClientRect().top === top,
                    diagramUnchanged: diagram.scrollTop === diagramTop,
                    diagramStyle: inner.defaultView.getComputedStyle(diagram).overflowY,
                    questionStyle: inner.defaultView.getComputedStyle(question).overflowY };
            })()`);
            assert.ok(scroll.diagramTop > 0, `The diagram has its own scrolling area at ${width}: ${JSON.stringify(scroll)}`);
            assert.equal(scroll.independent, true);
            assert.equal(scroll.toolbarFixed, true, "Zoom controls stay fixed when the diagram scrolls.");
            assert.equal(scroll.diagramUnchanged, true, "Question scrolling does not move the diagram.");
            assert.equal(scroll.diagramStyle, "auto");
            assert.equal(scroll.questionStyle, "auto");
            await browser.evaluate(`(() => {
                const inner = document.querySelector("#tandem-application").contentDocument;
                inner.querySelector(".design-tree-host .diagram-source").open = true;
            })()`);
            const fixedPanes = await browser.evaluate(`(() => {
                const inner = document.querySelector("#tandem-application").contentDocument;
                const selectors = [".design-tree-host .diagram-scroll-area", ".design-tree-host .diagram-source pre",
                    ".decision-list-pane", ".design-tree-inspector"];
                const panes = selectors.map(selector => inner.querySelector(selector));
                const toolbar = inner.querySelector(".diagram-toolbar"), summary = inner.querySelector(".diagram-source summary");
                const top = toolbar.getBoundingClientRect().top, sourceTop = summary.getBoundingClientRect().top;
                panes.forEach(pane => { pane.scrollTop = 0; });
                const independent = panes.map((pane, index) => {
                    const before = panes.map(other => other.scrollTop);
                    pane.scrollTop = pane.scrollHeight;
                    return panes.every((other, otherIndex) => index === otherIndex || other.scrollTop === before[otherIndex]);
                });
                return {
                    heights: panes.map(pane => pane.getBoundingClientRect().height),
                    scrolled: panes.map(pane => pane.scrollTop), independent,
                    scrollStyles: panes.map(pane => inner.defaultView.getComputedStyle(pane).overflowY),
                    headersFixed: top === toolbar.getBoundingClientRect().top && sourceTop === summary.getBoundingClientRect().top,
                    noOuterScroll: inner.querySelector("#design-tree-panel").scrollHeight <= inner.querySelector("#design-tree-panel").clientHeight + 1
                        && inner.querySelector(".design-tree-body").scrollHeight <= inner.querySelector(".design-tree-body").clientHeight + 1,
                };
            })()`);
            assert.ok(fixedPanes.heights.every((height: number) => height >= 20), `Every pane retains usable height at ${width}: ${JSON.stringify(fixedPanes)}`);
            assert.ok(fixedPanes.independent.every(Boolean), `All pane scroll positions are independent at ${width}: ${JSON.stringify(fixedPanes)}`);
            assert.ok(fixedPanes.scrolled.slice(0, 3).every((top: number) => top > 0), "Graph, source and decision list each scroll their own content.");
            assert.deepEqual(fixedPanes.scrollStyles, ["auto", "auto", "auto", "auto"]);
            assert.equal(fixedPanes.headersFixed, true);
            assert.equal(fixedPanes.noOuterScroll, true);
            const afterGrowth = await browser.evaluate(`(async () => {
                const inner = document.querySelector("#tandem-application").contentDocument;
                const source = inner.querySelector(".design-tree-host .diagram-source pre"), saved = source.textContent;
                source.textContent += "\\n" + "Additional source line\\n".repeat(300);
                inner.querySelector(".design-tree-host [aria-label='Zoom in']").click();
                await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                const heights = [".design-tree-host .diagram-scroll-area", ".design-tree-host .diagram-source pre",
                    ".decision-list-pane", ".design-tree-inspector"].map(selector => inner.querySelector(selector).getBoundingClientRect().height);
                source.textContent = saved;
                return heights;
            })()`);
            assert.deepEqual(afterGrowth, fixedPanes.heights, `Zoom and long source must not resize panes at ${width}.`);
            if (process.env.TANDEM_UI_EVIDENCE) {
                await writeFile(join(process.env.TANDEM_UI_EVIDENCE, `requirements-independent-panes-${width}.png`), await browser.screenshot());
            }
            await browser.evaluate('document.querySelector("#tandem-application").contentDocument.querySelector(".design-tree-host .diagram-source").open = false');
            if (width >= 1000) {
                const historyScroll = await browser.evaluate(`(() => {
                    const inner = document.querySelector("#tandem-application").contentDocument;
                    const history = inner.querySelector("#discovery-history"), diagram = inner.querySelector(".diagram-scroll-area");
                    const question = inner.querySelector(".design-tree-inspector"), context = inner.querySelector("#requirements-pane");
                    history.querySelector("details").open = true;
                    const before = [diagram.scrollTop, question.scrollTop, context.scrollTop];
                    history.scrollTop = history.scrollHeight;
                    return {top:history.scrollTop, independent:JSON.stringify(before) === JSON.stringify([diagram.scrollTop, question.scrollTop, context.scrollTop])};
                })()`);
                assert.ok(historyScroll.top > 0, "Discovery history owns its scrolling area.");
                assert.equal(historyScroll.independent, true, "History scrolling does not move the other panes.");
            }
            if (process.env.TANDEM_UI_EVIDENCE) {
                await browser.evaluate('document.querySelector("#tandem-application").contentDocument.querySelector("#decision-question-title").scrollIntoView({block:"center"})');
                await writeFile(join(process.env.TANDEM_UI_EVIDENCE, `requirements-active-${width}.png`), await browser.screenshot());
            }
        }
        const usageIntake = rendererState("requirements", 4);
        usageIntake.requirements.suggestions = [
            "I want to organize image-transition filter plugins so I can find and manage my work.",
            "I want to preview a transition between two images and adjust its progress and parameters.",
        ];
        await browser.evaluate(`(() => {
            const frame = document.querySelector("#tandem-application").contentWindow;
            frame.workspaceFixture.flushSync(() => frame.workspaceFixture.store.accept(${JSON.stringify(usageIntake)}));
        })()`);
        await browser.waitFor('Boolean(document.querySelector(".host-status-action"))');
        await browser.evaluate('document.querySelector(".host-status-action").focus()');
        await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
        await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
        await browser.waitFor('document.querySelector("#tandem-application").contentDocument.activeElement.id === "add-usage"');
        await browser.call("Page.navigate", { url: `${origin}/` });
        await browser.waitFor("Boolean(window.workspaceFixture?.store.getSnapshot().state)");
        await browser.evaluate(`workspaceFixture.flushSync(() => workspaceFixture.store.accept(${JSON.stringify(usageIntake)}))`);
        for (const width of [1920, 1024, 375]) {
            await browser.call("Emulation.setDeviceMetricsOverride", { width, height: 800, deviceScaleFactor: 1, mobile: false });
            await browser.evaluate('document.querySelector("#usage-input").focus()');
            const layout = await browser.evaluate(`(() => {
                const bounds = selector => {
                    const rect = document.querySelector(selector).getBoundingClientRect();
                    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, height: rect.height };
                };
                return { entry: bounds(".usage-entry"), suggestions: bounds("#usage-suggestion-area"),
                    intake: bounds("#usage-intake"), input: bounds("#usage-input"), viewportWidth: innerWidth,
                    fits: document.querySelector("#usage-intake").scrollWidth <= document.querySelector("#usage-intake").clientWidth + 1 };
            })()`);
            assert.equal(layout.viewportWidth, width);
            assert.ok(layout.input.height > 0 && layout.suggestions.height > 0, "The input and suggestions remain visible.");
            assert.ok(layout.suggestions.top >= layout.entry.bottom, `Suggestions occupy a separate row at ${width}: ${JSON.stringify(layout)}`);
            assert.ok(Math.abs(layout.suggestions.left - layout.entry.left) <= 1, "Both rows share the same left edge.");
            assert.ok(Math.abs(layout.suggestions.right - layout.entry.right) <= 1, "Both rows use the full intake width.");
            assert.ok(layout.suggestions.bottom <= layout.intake.bottom + 1, "The intake contains the suggestion list.");
            assert.equal(layout.fits, true, `Usage intake does not overflow at ${width}.`);
            if (process.env.TANDEM_UI_EVIDENCE) {
                await writeFile(join(process.env.TANDEM_UI_EVIDENCE, `requirements-usage-rows-${width}.png`), await browser.screenshot());
            }
        }
        await browser.call("Emulation.setDeviceMetricsOverride", { width: 1920, height: 800, deviceScaleFactor: 1, mobile: false });
        await browser.call("Page.navigate", { url: `${origin}/host` });
        await browser.waitFor('Boolean(document.querySelector("#tandem-application")?.contentWindow.workspaceFixture?.store.getSnapshot().state)');
        const savedRequirements = rendererState("prototype", 5);
        savedRequirements.requirements = { substage: "dag", usageItems: ["Validate the simulator's interaction and visualization."], suggestions: [] };
        savedRequirements.requirements.research = {
            generation: savedRequirements.generation, requestId: "research", runId: "research",
            input: requirementsResearchInput(savedRequirements), completedAt: savedRequirements.updatedAt,
            summary: "Retained findings for the accepted usages.", checks: [], sources: [],
        };
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
        for (const width of [1920, 1024, 375]) {
            await browser.call("Emulation.setDeviceMetricsOverride", { width, height: 800, deviceScaleFactor: 1, mobile: false });
            const layout = await browser.evaluate(`(() => {
                const inner = document.querySelector("#tandem-application").contentDocument;
                const header = inner.querySelector(".design-tree-host .diagram-header");
                const legend = header.querySelector(".design-tree-legend"), toolbar = header.querySelector(".diagram-toolbar");
                const bounds = element => {
                    const rect = element.getBoundingClientRect();
                    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
                };
                return { header: bounds(header), legend: bounds(legend), toolbar: bounds(toolbar),
                    controls: Array.from(toolbar.children, bounds), fits: header.scrollWidth <= header.clientWidth + 1 };
            })()`);
            assert.equal(layout.fits, true, `Diagram controls do not overflow at ${width}: ${JSON.stringify(layout)}`);
            assert.ok(layout.legend.left >= layout.header.left && layout.toolbar.right <= layout.header.right + 1);
            for (const control of layout.controls) {
                assert.ok(control.left >= layout.header.left && control.right <= layout.header.right + 1,
                    `Every zoom control remains within the header at ${width}.`);
            }
            if (width === 1920) {
                assert.ok(layout.legend.top < layout.toolbar.bottom && layout.toolbar.top < layout.legend.bottom,
                    "The legend and zoom controls share one row when space allows.");
                assert.ok(layout.legend.right <= layout.toolbar.left, "The legend and zoom controls do not overlap.");
            } else if (width === 375) {
                assert.ok(layout.toolbar.top >= layout.legend.bottom, "Zoom controls wrap below the legend on narrow panels.");
            }
            if (process.env.TANDEM_UI_EVIDENCE) {
                await writeFile(join(process.env.TANDEM_UI_EVIDENCE, `requirements-diagram-controls-${width}.png`), await browser.screenshot());
            }
        }
        await browser.call("Emulation.setDeviceMetricsOverride", { width: 1920, height: 800, deviceScaleFactor: 1, mobile: false });
        await browser.evaluate(`(() => {
            const frame = document.querySelector("#tandem-application").contentWindow;
            frame.document.querySelector("#usage-substage").dispatchEvent(new frame.MouseEvent("mousedown", { bubbles: true, button: 0 }));
        })()`);
        await browser.waitFor('document.querySelector("#tandem-application").contentDocument.querySelector("#usage-substage").getAttribute("aria-selected") === "true"');
        for (const expanded of [false, true]) {
            const initiallyExpanded = await browser.evaluate('document.querySelector("#tandem-application").contentDocument.querySelector("#requirements-substage-section .usage-suggestion[aria-expanded]").getAttribute("aria-expanded") === "true"');
            if (initiallyExpanded !== expanded) {
                await browser.evaluate('document.querySelector("#tandem-application").contentDocument.querySelector("#requirements-substage-section .usage-suggestion[aria-expanded]").click()');
                await browser.waitFor(`document.querySelector("#tandem-application").contentDocument.querySelector("#requirements-substage-section .usage-suggestion[aria-expanded]")?.getAttribute("aria-expanded") === "${expanded}"`);
            }
            const layout = await browser.evaluate(`(() => {
                const inner = document.querySelector("#tandem-application").contentDocument;
                const bounds = selector => {
                    const rect = inner.querySelector(selector).getBoundingClientRect();
                    return { top: rect.top, bottom: rect.bottom, height: rect.height };
                };
                return { actions: bounds("#stage-workflow-actions"), intake: bounds("#requirements-substage-section"),
                    trigger: bounds("#requirements-substage-section .usage-suggestion[aria-expanded]"), graph: bounds("#design-tree-card"),
                    panel: bounds("#design-tree-panel"), usage: bounds("#requirements-usage-panel"),
                    research: bounds("#requirements-research") };
            })()`);
            assert.ok(layout.trigger.height > 0, "Accepted usages remain accessible.");
            assert.ok(layout.intake.height > layout.trigger.height, `Usage history must not collapse into a border strip: ${JSON.stringify(layout)}`);
            assert.ok(layout.trigger.bottom <= layout.intake.bottom, "The accepted usages control remains visible.");
            assert.ok(layout.actions.bottom <= layout.panel.top + 1, "Stage actions stay in the tab bar above the input workspace.");
            assert.equal(layout.graph.height, 0, "The DAG is not mixed into the usage tab.");
            assert.ok(layout.research.height > 0 && layout.research.top >= layout.intake.bottom, "Research stays with Requirements in Usage list.");
            assert.ok(layout.usage.bottom <= layout.panel.bottom, "Usage history has a bounded scrolling pane.");
        }
        await browser.evaluate(`(() => {
            const frame = document.querySelector("#tandem-application").contentWindow;
            frame.document.querySelector("#dag-substage").dispatchEvent(new frame.MouseEvent("mousedown", { bubbles: true, button: 0 }));
        })()`);
        await browser.waitFor('document.querySelector("#tandem-application").contentDocument.querySelector("#dag-substage").getAttribute("aria-selected") === "true"');
        assert.equal(await browser.evaluate('document.querySelector("#tandem-application").contentDocument.querySelector("#requirements-research").getBoundingClientRect().height'), 0);
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
                    const header = inner.querySelector(".previewbar"), actions = inner.querySelector("#stage-workflow-actions");
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
                assert.ok(layout.actions.top >= layout.header.top - 1 && layout.actions.bottom <= layout.header.bottom + 1,
                    "Stage controls remain inside the tab bar, not in a bottom strip.");
                assert.ok(layout.selected.left >= layout.tabs.left - 1 && layout.selected.right <= layout.tabs.right + 1,
                    "The focused stage tab stays visible in the horizontal scroller.");
                assert.ok(layout.panel.top >= layout.header.bottom - 1, "Content begins below the shared header.");
                for (const control of layout.controls) {
                    assert.ok(control.left >= layout.actions.left - 1 && control.right <= layout.actions.right + 1);
                    assert.ok(control.top >= layout.actions.top - 1 && control.bottom <= layout.actions.bottom + 1);
                }
                if (width === 1920) {
                    assert.ok(layout.actions.bottom <= layout.panel.top + 1, "Wide layouts keep stage controls above the inputs.");
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
    for (const notice of [{ id: "", message: "error" }, { id: 1, message: "error" }, { id: "valid", message: {} },
        { id: "x".repeat(513), message: "error" }, { id: "valid", message: "x".repeat(8193) }]) {
        assert.throws(() => parseHostSnapshot({ ...state(), notice }), /invalid notification/);
    }
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
