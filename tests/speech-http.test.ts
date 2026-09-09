import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { extensionHarness } from "./helpers/extension-harness.js";

test("canvas speech endpoint enforces origin and provider access without persisting tokens", async () => {
    const h = await extensionHarness({
        TANDEM_Speech__ResourceId: "/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/speech/providers/Microsoft.CognitiveServices/accounts/tandem",
        TANDEM_Speech__Region: "eastus",
        TANDEM_Speech__Language: "en-US",
    });
    const entry = await h.api.startServer("speech-http", "sample", "project:tandem", true);
    try {
        await h.api.loadState("sample");
        const statePath = join(h.root, ".tandem", "efforts", "sample", "state.json");
        const before = await readFile(statePath, "utf8");
        const url = new URL("api/speech/token", entry.url);
        const headers = { "Content-Type": "application/json", "X-Tandem-Speech": "1", Origin: url.origin };
        assert.equal(h.speechTokenRequests(), 0);
        const crossSite = await fetch(url, {
            method: "POST", headers: { ...headers, Origin: "https://unrelated.example" }, body: "{}",
        });
        assert.equal(crossSite.status, 403);
        const missingHeader = await fetch(url, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
        });
        assert.equal(missingHeader.status, 403);
        const override = await fetch(url, { method: "POST", headers, body: '{"region":"elsewhere"}' });
        assert.equal(override.status, 400);
        assert.equal(h.speechTokenRequests(), 0);
        const success = await fetch(url, { method: "POST", headers, body: "{}" });
        assert.equal(success.status, 200);
        assert.equal(success.headers.get("cache-control"), "no-store");
        assert.equal(success.headers.get("access-control-allow-origin"), null);
        const token = await success.json() as { authorizationToken: string; region: string };
        assert.match(token.authorizationToken, /^aad#.*#fixture-speech-token$/);
        assert.equal(token.region, "eastus");
        assert.equal(h.speechTokenRequests(), 1);
        assert.equal(await readFile(statePath, "utf8"), before);
        assert.equal(h.logs.some((line) => line.includes("fixture-speech-token")), false);
        assert.equal(h.requests.length, 0, "authentication cannot start lifecycle work");
        h.api.setSession({ ...h.session, rpc: { ...h.session.rpc, extensions: {
            list: async () => ({ extensions: [
                { id: "project:tandem", status: "running" }, { id: "user:tandem", status: "running" },
            ] }),
        } } });
        const readOnly = await fetch(url, { method: "POST", headers, body: "{}" });
        assert.equal(readOnly.status, 409);
        assert.equal(h.speechTokenRequests(), 1);
    } finally {
        clearInterval(entry.heartbeat);
        await new Promise<void>((resolve, reject) => entry.server.close((error) => error ? reject(error) : resolve()));
        await h.close();
    }
});

test("missing speech configuration fails visibly without Azure access", async () => {
    const h = await extensionHarness();
    const entry = await h.api.startServer("speech-missing", "sample", "project:tandem", true);
    try {
        const result = await fetch(new URL("api/speech/token", entry.url), {
            method: "POST", headers: { "Content-Type": "application/json", "X-Tandem-Speech": "1" }, body: "{}",
        });

        assert.equal(result.status, 503);
        assert.match((await result.json() as { error: string }).error, /TANDEM_Speech__ResourceId/);
        assert.equal(h.speechTokenRequests(), 0);
    } finally {
        clearInterval(entry.heartbeat);
        await new Promise<void>((resolve, reject) => entry.server.close((error) => error ? reject(error) : resolve()));
        await h.close();
    }
});

test("explicit browser sign-in is guarded, returns no credentials, and supplies later speech tokens", async () => {
    const h = await extensionHarness({
        TANDEM_Speech__ResourceId: "/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/speech/providers/Microsoft.CognitiveServices/accounts/tandem",
        TANDEM_Speech__Region: "eastus",
    });
    const entry = await h.api.startServer("browser-login", "sample", "project:tandem", true);
    try {
        const url = new URL("api/speech/sign-in", entry.url);
        const headers = { "Content-Type": "application/json", "X-Tandem-Speech": "1", Origin: url.origin };
        const badOrigin = await fetch(url, { method: "POST", headers: { ...headers, Origin: "https://example.com" }, body: "{}" });
        assert.equal(badOrigin.status, 403);
        assert.equal(h.browserSignIns(), 0);
        const login = await fetch(url, { method: "POST", headers, body: "{}" });
        const loginResult = await login.json();
        assert.equal(login.status, 200, JSON.stringify(loginResult));
        assert.equal(login.headers.get("cache-control"), "no-store");
        assert.deepEqual(loginResult, { authenticated: true });
        assert.equal(h.browserSignIns(), 1);
        const speech = await fetch(new URL("api/speech/token", entry.url), { method: "POST", headers, body: "{}" });
        assert.match((await speech.json() as { authorizationToken: string }).authorizationToken, /#fixture-browser-token$/);
        assert.equal(h.speechTokenRequests(), 0);
        assert.equal(h.browserTokenRequests(), 1);
        assert.equal(h.requests.length, 0);
        const persisted = await readFile(join(h.root, ".tandem", "efforts", "sample", "state.json"), "utf8");
        assert.doesNotMatch(persisted, /fixture-browser-token|authenticated/);
        assert.equal(h.logs.some((message) => message.includes("fixture-browser-token")), false);
    } finally {
        clearInterval(entry.heartbeat);
        await new Promise<void>((resolve, reject) => entry.server.close((error) => error ? reject(error) : resolve()));
        await h.close();
    }
});

test("disconnecting a sign-in request cancels its identity operation", { timeout: 10000 }, async () => {
    const h = await extensionHarness({
        TANDEM_Speech__ResourceId: "/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/speech/providers/Microsoft.CognitiveServices/accounts/tandem",
        TANDEM_Speech__Region: "eastus",
    });
    const entry = await h.api.startServer("cancel-login", "sample", "project:tandem", true);
    try {
        let started!: () => void;
        const ready = new Promise<void>((resolve) => { started = resolve; });
        let cancelled!: () => void;
        const cancellation = new Promise<void>((resolve) => { cancelled = resolve; });
        h.setSpeechSignIn((signal) => new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => { cancelled(); reject(new Error("Cancelled")); });
            started();
        }));
        const controller = new AbortController();
        const request = fetch(new URL("api/speech/sign-in", entry.url), {
            method: "POST", headers: { "Content-Type": "application/json", "X-Tandem-Speech": "1" }, body: "{}",
            signal: controller.signal,
        });
        await Promise.race([ready, request.then(async (result) => { throw new Error(JSON.stringify(await result.json())); })]);
        controller.abort();
        await assert.rejects(request, { name: "AbortError" });
        await cancellation;
        assert.equal(h.browserSignIns(), 1);
        assert.equal(h.browserTokenRequests(), 0);
    } finally {
        clearInterval(entry.heartbeat);
        entry.server.closeAllConnections();
        await new Promise<void>((resolve, reject) => entry.server.close((error) => error ? reject(error) : resolve()));
        await h.close();
    }
});
