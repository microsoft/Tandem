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
    assert.equal(h.document.querySelector(".brand h1")!.textContent, "Tandem");
    assert.ok(h.document.querySelector(".mark .lucide-layers"));
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
    await h.sendHeaderMessage({ type: "tandem:header:connect" });
    assert.equal(h.document.querySelector<HTMLDivElement>(".topbar")!.hidden, true);
    const value = header(h.headerMessages);
    assert.match(value.lifecycle, /Requirements/);
    assert.equal(value.controls.reload?.disabled, true);
    assert.equal(value.controls.reset?.disabled, false);
    await h.sendHeaderMessage({ type: "tandem:header:disconnect" });
    assert.equal(h.document.querySelector<HTMLDivElement>(".topbar")!.hidden, false);
    assert.equal(h.requests.length, 0);
});

test("hosted reset uses the existing confirmation and cannot bypass stale or read-only state", async (t) => {
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
    assert.match(h.document.querySelector('[role="alertdialog"]')!.textContent!, /cannot be undone/);
    assert.equal(h.requests.length, 0);
    await h.confirm(false);
    assert.equal(h.requests.length, 0);
    h.render({ ...initial, revision: 2, provider: { ...initial.provider, canSubmitAnswers: false } });
    await h.flush();
    assert.equal(header(h.headerMessages).controls.reset?.disabled, true);
    await h.sendHeaderMessage({ type: "tandem:header:action", scope: value.scope, action: "reset" });
    assert.equal(h.document.querySelector('[role="alertdialog"]'), null);
    assert.equal(h.requests.length, 0);
});

test("hosted reload reuses the provider action and reports failures instead of hiding them", async (t) => {
    const h = await reactHarness(t, host);
    h.render({ ...state(), provider: { canSubmitAnswers: true, canReload: true } });
    h.setFetch(async () => response({ error: "Provider reload failed." }, 503));
    await h.flush();
    await h.sendHeaderMessage({ type: "tandem:header:connect" });
    await h.sendHeaderMessage({ type: "tandem:header:action", scope: header(h.headerMessages).scope, action: "reload" });
    assert.equal(h.requests[0].path, "/api/reload");
    assert.ok(header(h.headerMessages).messages.some((message) => message.error && message.text === "Provider reload failed."));
});

test("hosted speech sign-in and cancellation preserve the existing auth and microphone boundaries", async (t) => {
    const h = await reactHarness(t, host);
    h.render(state());
    let aborted = false;
    h.setSpeechFactory(async () => { throw new Error("Sign-in must not start microphone capture."); });
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
    assert.equal(h.requests.length, 1);
    assert.equal(header(h.headerMessages).controls.signIn?.busy, true);
    assert.equal(header(h.headerMessages).controls.signIn?.disabled, true);
    assert.ok(header(h.headerMessages).controls.cancelSignIn);
    await h.sendHeaderMessage({ type: "tandem:header:action", scope, action: "cancelSignIn" });
    assert.equal(aborted, true);
    assert.equal(header(h.headerMessages).controls.cancelSignIn, null);
    assert.ok(header(h.headerMessages).messages.some((message) => /sign-in cancelled/.test(message.text)));
});

test("standalone header configuration cannot target arbitrary websites or carry unbounded controls", () => {
    assert.deepEqual(standaloneHeaderHost("#" + new URLSearchParams({ "tandem-host": host.origin, "header-channel": host.channel })), host);
    for (const origin of ["https://example.com", "http://localhost:9000", "http://127.0.0.1:9000/path", "http://127.0.0.1:0"]) {
        assert.equal(standaloneHeaderHost("#" + new URLSearchParams({ "tandem-host": origin, "header-channel": host.channel })), null);
    }
    assert.equal(isApplicationHeader({ scope: "effort", version: "test", lifecycle: "", controls: null, messages: [] }), false);
});
