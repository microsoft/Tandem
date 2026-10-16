import assert from "node:assert/strict";
import { test } from "node:test";
import { isApplicationHeader, standaloneHeaderHost, type ApplicationHeader } from "../src/renderer/standalone-header.js";
import { reactHarness, response, state } from "./helpers/react-harness.js";

const host = { origin: "http://127.0.0.1:9000", channel: "11111111-1111-4111-8111-111111111111" };
const header = (messages: Array<Record<string, unknown>>): ApplicationHeader => {
    const value = messages.findLast((message) => message.type === "tandem:header:state")?.header;
    assert.ok(isApplicationHeader(value));
    return value;
};

test("regular canvas retains its own logo, title and controls without standalone opt-in", async (t) => {
    const h = await reactHarness(t);
    h.render(state());
    await h.flush();
    assert.equal(h.document.querySelector<HTMLDivElement>(".topbar")!.hidden, false);
    const identity = h.document.querySelector<HTMLElement>(".project-folder")!;
    assert.equal(identity.hidden, false);
    assert.equal(identity.textContent, "fixture-project");
    assert.equal(identity.title, "C:\\fixture-project");
    assert.equal(h.document.querySelector(".brand h1")!.textContent, "Tandem");
    const artwork = h.document.querySelector<HTMLImageElement>(".brand .brand-artwork")!;
    assert.ok(artwork);
    assert.match(artwork.src, /^data:image\/png;base64,/);
    assert.equal(artwork.alt, "");
    assert.equal(artwork.getAttribute("aria-hidden"), "true", "The heading names Tandem without duplicating decorative artwork.");
    await h.sendHeaderMessage({ type: "tandem:header:connect", channel: host.channel });
    assert.equal(h.document.querySelector<HTMLDivElement>(".topbar")!.hidden, false);
    assert.equal(h.headerMessages.length, 0);
});

test("standalone handshake requires its exact parent, origin and channel before merging the header", async (t) => {
    const h = await reactHarness(t, host);
    h.render(state());
    await h.flush();
    assert.equal(h.headerMessages[0].type, "tandem:header:ready");
    assert.equal(h.document.querySelector<HTMLDivElement>(".topbar")!.hidden, false);
    await h.sendHeaderMessage({ type: "tandem:header:connect" }, "https://untrusted.example");
    await h.sendHeaderMessage({ type: "tandem:header:connect" }, host.origin, {});
    await h.sendHeaderMessage({ type: "tandem:header:connect", channel: "stale" });
    assert.equal(h.document.querySelector<HTMLDivElement>(".topbar")!.hidden, false);
    assert.equal(h.document.querySelector<HTMLElement>(".project-folder")!.hidden, false);
    await h.sendHeaderMessage({ type: "tandem:header:connect" });
    assert.equal(h.document.querySelector<HTMLDivElement>(".topbar")!.hidden, true);
    assert.equal(h.document.querySelector<HTMLElement>(".project-folder")!.hidden, true);
    assert.equal(h.document.querySelector<HTMLElement>(".context-pane-heading")!.dataset.hosted, "true");
    assert.equal(h.get("toggle-context-pane").getAttribute("aria-label"), "Collapse project context");
    assert.equal(h.get("project-settings").textContent, "Project settings");
    const value = header(h.headerMessages);
    assert.match(value.lifecycle, /Requirements/);
    assert.equal(value.controls.reload, null);
    assert.equal(value.controls.reset, null);
    await h.sendHeaderMessage({ type: "tandem:header:disconnect" });
    assert.equal(h.document.querySelector<HTMLDivElement>(".topbar")!.hidden, false);
    assert.equal(h.document.querySelector<HTMLElement>(".project-folder")!.hidden, false);
    assert.equal(h.document.querySelector<HTMLElement>(".project-folder")!.title, "C:\\fixture-project");
    assert.equal(h.document.querySelector<HTMLElement>(".context-pane-heading")!.dataset.hosted, undefined);
    assert.equal(h.requests.length, 0);
});

test("saved Prototype does not project a legacy building phase into Development", async (t) => {
    const h = await reactHarness(t, host);
    const saved = state("development");
    saved.phase = "building";
    saved.lifecycle.outputs = [{ stageId: "prototype", path: ".tandem/efforts/fixture/stages/prototype-r1.json", completedAt: saved.updatedAt }];
    h.render(saved);
    await h.flush();
    await h.sendHeaderMessage({ type: "tandem:header:connect" });
    assert.equal(header(h.headerMessages).lifecycle, "5. Development");
    assert.equal(h.get("phase").hidden, true);
    assert.equal(saved.phase, "building", "Presentation must not rewrite retained discovery state.");

    h.render({ ...state("prototype", 2), phase: "building" });
    await h.flush();
    assert.equal(header(h.headerMessages).lifecycle, "4. Prototype | building");
    assert.equal(h.get("phase").hidden, false);
    assert.equal(h.get("phase").textContent, "building");
});

test("permission ownership follows the private session, not the viewed discovery tab or viewport", async (t) => {
    const h = await reactHarness(t, host, "development");
    h.render(state("development"));
    await h.flush();
    await h.sendHeaderMessage({ type: "tandem:header:connect" });
    assert.equal(header(h.headerMessages).permissionScope, undefined, "Starting is not verified ownership.");
    const frame = h.get<HTMLIFrameElement>("project-conversation-frame");
    const status = async (active: boolean, status: string) => h.sendHeaderMessage({
        protocol: "tandem-project/v1", channel: "fixture-project", type: "status", active, status,
    }, "http://127.0.0.1:8765", frame.contentWindow);
    await status(true, "ready");
    assert.equal(header(h.headerMessages).permissionScope, "development");
    await h.fire(h.get("preparation-tab"), "mousedown", { button: 0, ctrlKey: false });
    assert.equal(h.get("preparation-panel").hidden, false);
    assert.equal(header(h.headerMessages).permissionScope, "development");
    h.setNarrowViewport(true);
    await h.flush();
    assert.equal(header(h.headerMessages).permissionScope, "development");
    await status(false, "unknown");
    assert.equal(header(h.headerMessages).permissionScope, undefined, "Unknown private state never enables host permissions.");
    await status(false, "unavailable");
    assert.equal(header(h.headerMessages).permissionScope, undefined);
    await status(true, "ready");
    assert.equal(header(h.headerMessages).permissionScope, "development");
    assert.equal(h.requests.length, 0, "Presentation does not submit work or grant permissions.");
});

test("hosted maintenance messages cannot revive removed primary actions; Preparation keeps confirmation", async (t) => {
    const h = await reactHarness(t, host);
    const initial = state();
    h.render(initial);
    await h.flush();
    await h.sendHeaderMessage({ type: "tandem:header:connect" });
    const value = header(h.headerMessages);
    await h.sendHeaderMessage({ type: "tandem:header:action", scope: "old-effort", action: "reset" });
    assert.equal(h.document.querySelector('[role="alertdialog"]'), null);
    assert.ok(h.headerMessages.some((message) => message.type === "tandem:header:error"));
    await h.sendHeaderMessage({ type: "tandem:header:action", scope: value.scope, action: "reset" });
    assert.equal(h.document.querySelector('[role="alertdialog"]'), null);
    assert.ok(h.get("preparation-panel").contains(h.get("reset-effort")));
    await h.click("reset-effort");
    assert.match(h.document.querySelector('[role="alertdialog"]')!.textContent!, /first stop active discovery work.*state\/files are archived/s);
    assert.equal(h.requests.length, 0);
    await h.confirm(false);
    assert.equal(h.requests.length, 0);
    h.render({ ...initial, revision: 2, provider: { ...initial.provider, canSubmitAnswers: false } });
    await h.flush();
    assert.equal(header(h.headerMessages).controls.reset, null);
    assert.equal((h.get("reset-effort") as HTMLButtonElement).disabled, true);
    await h.sendHeaderMessage({ type: "tandem:header:action", scope: value.scope, action: "reset" });
    assert.equal(h.document.querySelector('[role="alertdialog"]'), null);
    assert.equal(h.requests.length, 0);
});

test("hosted reload cannot bypass the relocated Project settings control", async (t) => {
    const h = await reactHarness(t, host);
    h.render({ ...state(), provider: { canSubmitAnswers: true, canReload: true } });
    h.setFetch(async () => response({ error: "Provider reload failed." }, 503));
    await h.flush();
    await h.sendHeaderMessage({ type: "tandem:header:connect" });
    await h.sendHeaderMessage({ type: "tandem:header:action", scope: header(h.headerMessages).scope, action: "reload" });
    assert.equal(h.requests.length, 0);
    await h.click("project-settings");
    await h.click("reload-extension");
    assert.equal(h.requests.at(-1)!.path, "/api/reload");
    assert.equal(h.get("reload-status").textContent, "Provider reload failed.");
    assert.ok(header(h.headerMessages).messages.some(message => message.id === "maintenance" && message.error));
    await h.click(h.document.querySelector('[role="alertdialog"] button')!);
    assert.match(h.get("next-action-guide").textContent!, /Provider reload failed/);
    assert.equal(h.document.querySelector(".topbar #reload-extension"), null);
});

test("hosted speech login stays at its requesting input and cannot be invoked from chrome", async (t) => {
    const h = await reactHarness(t, host);
    h.render(state());
    let aborted = false;
    h.setSpeechFactory(async () => { throw Object.assign(new h.window.Error("Voice sign-in required."), { speechSignInRequired: true }); });
    h.setFetch(async (path, options) => {
        assert.equal(path, "/api/speech/login");
        return new Promise((_resolve, reject) => {
            options.signal?.addEventListener("abort", () => { aborted = true; reject(new Error("Cancelled")); }, { once: true });
        });
    });
    await h.flush();
    await h.sendHeaderMessage({ type: "tandem:header:connect" });
    const scope = header(h.headerMessages).scope;
    await h.sendHeaderMessage({ type: "tandem:header:action", scope, action: "signIn" });
    assert.equal(h.requests.length, 0);
    const input = h.get<HTMLTextAreaElement>("usage-input");
    const composer = input.closest(".voice-composer")!;
    await h.click(composer.querySelector(".speech-toggle")!);
    await h.click(composer.querySelector(".speech-sign-in")!);
    assert.equal(h.requests.length, 1);
    assert.equal(header(h.headerMessages).controls.signIn, null);
    assert.equal(header(h.headerMessages).controls.cancelSignIn, null);
    await h.sendHeaderMessage({ type: "tandem:header:action", scope, action: "cancelSignIn" });
    assert.equal(aborted, false, "Hosted messages do not invoke a removed header control.");
    await h.click(composer.querySelector(".speech-cancel")!);
    assert.equal(aborted, true);
    assert.equal(header(h.headerMessages).controls.cancelSignIn, null);
    assert.match(composer.querySelector(".speech-status")!.textContent!, /sign-in cancelled/);
});

test("standalone header configuration cannot target arbitrary websites or carry unbounded controls", () => {
    assert.deepEqual(standaloneHeaderHost("#" + new URLSearchParams({ "tandem-host": host.origin, "header-channel": host.channel })), host);
    for (const origin of ["https://example.com", "http://localhost:9000", "http://127.0.0.1:9000/path", "http://127.0.0.1:0"]) {
        assert.equal(standaloneHeaderHost("#" + new URLSearchParams({ "tandem-host": origin, "header-channel": host.channel })), null);
    }
    assert.equal(isApplicationHeader({ scope: "effort", version: "test", lifecycle: "", controls: null, messages: [] }), false);
});
