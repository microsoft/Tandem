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
import { reactHarness, state as workspaceState } from "./helpers/react-harness.js";

const applicationHeader: ApplicationHeader = {
    scope: "effort-generation", version: "1.1.15", lifecycle: "2. Requirements | discovery",
    permissionScope: "main",
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

test("browser shell preserves the application origin, microphone delegation and host controls", async (t) => {
    const h = await fixture(t);
    await h.fromApplication({ type: "tandem:header:state", header: applicationHeader });
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

test("speech failure can be dismissed while the production workspace retains Preparation and its typed draft", async (t) => {
    const h = await fixture(t);
    const app = await reactHarness(t);
    const initial = workspaceState();
    app.render(initial);
    await app.flush();
    const stored = app.store.getSnapshot().state;
    const input = app.get<HTMLTextAreaElement>("usage-input");
    const preparation = app.get("preparation-panel");
    assert.ok(input.matches("textarea[data-speech-input]"), "test the production input, not a substitute textarea");
    await app.input(input, "Continue by typing");
    const frame = h.document.querySelector("#tandem-application");
    const message = "Tandem request failed: Configure TANDEM_Speech__ResourceId and TANDEM_Speech__Region for an Azure Speech resource, then restart Tandem. Subscription keys are not used.";
    let speechAttempts = 0;
    app.setSpeechFactory(async () => { speechAttempts++; throw new app.window.Error(message); });
    await app.click(input.closest(".voice-composer")!.querySelector(".speech-toggle")!);
    await app.fire(app.get("preparation-tab"), "mousedown", { button: 0, ctrlKey: false });
    assert.equal(preparation.hidden, false);
    await h.accept(state({ revision: 2, notice: { id: "speech-one", message } }));
    h.setDiagnostics(message);
    assert.match(h.document.querySelector('.host-notification [role="alert"]')!.textContent!, /Subscription keys are not used/);
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
    assert.equal(speechAttempts, 1);
    assert.deepEqual(app.requests, [], "dismissal must not configure voice, start a model, sign in or submit typed input");
    assert.deepEqual(h.requests.map(request => request.body), [{ type: "dismiss-notice", id: "speech-one", generation: "generation-one" }]);
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
    await h.accept(state({ revision: 6, notice: { id: "voice", message: "Voice unavailable" }, error: "Runtime needs attention" }));
    h.setCommandHandler(undefined);
    await h.click("Dismiss notification");
    assert.match(h.document.querySelector('[role="alert"]')!.textContent!, /Runtime needs attention/);
    await h.accept(state({ revision: 8, notice: { id: "voice-again", message: "Voice unavailable" } }));
    await h.disconnect();
    assert.match(h.document.querySelector('[role="alert"]')!.textContent!, /Host connection lost/);
    assert.equal([...h.document.querySelectorAll("button")].some(button => button.textContent === "Dismiss notification"), false);
});

test("embedded failed actions have local occurrences but persistent recovery and connection messages stay visible", async (t) => {
    const h = await fixture(t);
    await h.fromApplication({ type: "tandem:header:state", header: { ...applicationHeader, messages: [
        { id: "maintenance", text: "Provider reload remains unconfirmed", error: true },
        { id: "connection", text: "Application disconnected", error: true },
        { id: "speech", text: "Complete Microsoft sign-in", error: false },
    ] } });
    const message = "The application header action failed.";
    await h.fromApplication({ type: "tandem:header:error", message });
    const dismiss = h.button("Dismiss notification");
    await h.click("Dismiss notification");
    assert.match(h.document.body.textContent!, /Provider reload remains unconfirmed/);
    assert.match(h.document.body.textContent!, /Application disconnected/);
    assert.match(h.document.body.textContent!, /Complete Microsoft sign-in/);
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
    await h.accept(state({ revision: 2, notice: { id: "voice", message: "Voice unavailable" } }));
    h.setCommandHandler(async () => Response.json({ error: "Acknowledgment delivery failed. token=private" }, { status: 503 }));
    await h.click("Dismiss notification");
    const banners = [...h.document.querySelectorAll(".host-notification")];
    assert.equal(banners.length, 2);
    assert.ok(banners.some(banner => banner.textContent!.includes("Voice unavailable")));
    const local = banners.find(banner => banner.textContent!.includes("Acknowledgment delivery failed"))!;
    local.querySelector<HTMLButtonElement>("button")!.click();
    await h.flush();
    assert.equal(h.requests.length, 1, "dismissing the local failure does not retry its request");
    assert.equal(h.document.querySelector(".host-notification")!.textContent, "Voice unavailableDismiss notification");
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
    await h.accept(state({ revision: 2, notice: { id: "voice", message: "Voice unavailable" }, requests: [prompt] }));
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
