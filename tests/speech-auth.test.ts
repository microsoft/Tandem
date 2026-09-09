import assert from "node:assert/strict";
import { build } from "esbuild";
import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import {
    createSpeechTokenService,
    SpeechAuthError,
    type SpeechCredential,
    validateSpeechTokenRequest,
} from "../src/speech-auth.js";

const resourceId = "/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/speech/providers/Microsoft.CognitiveServices/accounts/tandem";
const environment = { TANDEM_Speech__ResourceId: resourceId, TANDEM_Speech__Region: "eastus" };
const timestamp = 1_800_000_000_000;
const expectedOrigin = "http://127.0.0.1:43127";
const token = { token: "fixture-access-token", expiresOnTimestamp: timestamp + 600_000 };

function request(headers: IncomingHttpHeaders = {}, method = "POST"): IncomingMessage {
    return {
        method,
        headers: {
            host: "127.0.0.1:43127",
            origin: expectedOrigin,
            "content-type": "application/json",
            "x-tandem-speech": "1",
            "sec-fetch-site": "same-origin",
            ...headers,
        },
        rawHeaders: [],
    } as unknown as IncomingMessage;
}

function errorWithStatus(statusCode: number) {
    return (error: unknown) => {
        assert.ok(error instanceof SpeechAuthError);
        assert.equal(error.name, "SpeechAuthError");
        assert.equal(error.statusCode, statusCode);
        assert.equal(error.cause, undefined);
        return true;
    };
}

test("speech service construction does not validate configuration, construct credentials, or authenticate", () => {
    let constructions = 0;
    const getToken = createSpeechTokenService({
        env: {},
        createCredential: () => {
            constructions++;
            throw new Error("Construction must be lazy.");
        },
    });
    assert.equal(typeof getToken, "function");
    assert.equal(constructions, 0);
    assert.equal(typeof createSpeechTokenService(), "function", "default construction must not authenticate either");
});

test("the VM bundle loads Azure Identity only on demand", async () => {
    const result = await build({
        entryPoints: [fileURLToPath(new URL("../src/speech-auth.ts", import.meta.url))],
        bundle: true, platform: "node", format: "cjs", target: "node20", write: false,
        plugins: [{
            name: "fake-identity",
            setup(api) {
                api.onResolve({ filter: /^@azure\/identity$/ }, () => ({ path: "identity", namespace: "fake" }));
                api.onLoad({ filter: /.*/, namespace: "fake" }, () => ({
                    contents: "export const { DefaultAzureCredential } = globalThis.loadIdentity();",
                }));
            },
        }],
        logLevel: "silent",
    });
    let loads = 0;
    let constructions = 0;
    let requests = 0;
    const module = { exports: {} as typeof import("../src/speech-auth.js") };
    runInNewContext(result.outputFiles[0].text, {
        module, exports: module.exports, AbortController, setTimeout, clearTimeout,
        loadIdentity() {
            loads++;
            return {
                DefaultAzureCredential: class {
                    constructor(options: { processTimeoutInMs: number }) {
                        assert.equal(options.processTimeoutInMs, 15_000);
                        constructions++;
                    }
                    async getToken(scope: string) {
                        assert.equal(scope, "https://cognitiveservices.azure.com/.default");
                        requests++;
                        return token;
                    }
                },
            };
        },
    });
    const getToken = module.exports.createSpeechTokenService({ env: environment, now: () => timestamp });
    assert.equal(loads, 0);
    assert.equal(constructions, 0);
    assert.equal(requests, 0);
    assert.equal((await getToken()).authorizationToken, `aad#${resourceId}#${token.token}`);
    assert.equal(loads, 1);
    assert.equal(constructions, 1);
    assert.equal(requests, 1);
});

test("Entra tokens use the Cognitive Services scope and ARM composite with a lazy reused credential", async () => {
    let constructions = 0;
    const calls: { scope: string; signal: AbortSignal }[] = [];
    const getToken = createSpeechTokenService({
        env: environment,
        now: () => timestamp,
        createCredential: () => {
            constructions++;
            return {
                async getToken(scope, options) {
                    calls.push({ scope, signal: options.abortSignal });
                    return { ...token, token: `${token.token}-${calls.length}` };
                },
            };
        },
    });
    assert.deepEqual(await getToken(), {
        authorizationToken: `aad#${resourceId}#fixture-access-token-1`,
        region: "eastus", language: "en-US", expiresAt: token.expiresOnTimestamp,
    });
    assert.equal((await getToken()).authorizationToken, `aad#${resourceId}#fixture-access-token-2`);
    assert.equal(constructions, 1);
    assert.equal(calls.length, 2, "the service must not cache access tokens");
    assert.ok(calls.every((call) => call.scope === "https://cognitiveservices.azure.com/.default"));
    assert.ok(calls.every((call) => call.signal instanceof AbortSignal && !call.signal.aborted));
    assert.notEqual(calls[0].signal, calls[1].signal);
});

test("configuration is read on demand and supports strict speech locales", async () => {
    const env: Record<string, string> = {};
    const getToken = createSpeechTokenService({
        env, now: () => timestamp, createCredential: () => ({ getToken: async () => token }),
    });
    Object.assign(env, environment);
    for (const language of ["", "en-US", "zh-TW", "yue-CN", "sr-Latn-RS", "es-419"]) {
        env.TANDEM_Speech__Language = language;
        assert.equal((await getToken()).language, language || "en-US");
    }
    env.TANDEM_Speech__Region = "westus2";
    assert.equal((await getToken()).region, "westus2");
});

test("missing and invalid configuration fails before credential construction", async () => {
    const invalid = [
        {},
        { ...environment, TANDEM_Speech__ResourceId: "" },
        { ...environment, TANDEM_Speech__Region: "" },
        ...[
            "https://example.cognitiveservices.azure.com",
            resourceId.replace("11111111-1111-1111-1111-111111111111", "subscription"),
            resourceId.replace("Microsoft.CognitiveServices", "Microsoft.Storage"),
            resourceId.replace("/accounts/", "/services/"),
            resourceId.replace("/speech/", "/../"),
            `${resourceId}/`,
            `${resourceId}#secret`,
            `${resourceId}?api-key=secret`,
            `${resourceId}\n`,
            ` ${resourceId}`,
        ].map((value) => ({ ...environment, TANDEM_Speech__ResourceId: value })),
        ...["East US", "EASTUS", "east-us", "https://eastus.example", "eastus\n", "a", "a".repeat(33)]
            .map((value) => ({ ...environment, TANDEM_Speech__Region: value })),
        ...[" ", "en", "en_US", "en-us", "EN-US", "en-US#secret", "en-US\n", "en-US?key=secret"]
            .map((value) => ({ ...environment, TANDEM_Speech__Language: value })),
    ];
    let constructions = 0;
    for (const env of invalid) {
        const getToken = createSpeechTokenService({
            env, now: () => timestamp,
            createCredential: () => {
                constructions++;
                return { getToken: async () => token };
            },
        });
        await assert.rejects(getToken, (error) => {
            errorWithStatus(503)(error);
            assert.match((error as Error).message, /TANDEM_Speech__/);
            assert.doesNotMatch((error as Error).message, /secret/);
            return true;
        });
    }
    assert.equal(constructions, 0);
});

test("null, malformed, expired, and nearly expired identity results are rejected without exposing tokens", async () => {
    const invalid: unknown[] = [
        null, {}, { ...token, token: "" }, { ...token, token: "secret#suffix" },
        { ...token, token: "secret token" }, { ...token, token: "secret\n" },
        { ...token, token: 123 }, { ...token, token: "s".repeat(32_769) },
        ...[timestamp - 1, timestamp, timestamp + 60_000, timestamp + 150_000,
            timestamp + 179_999, timestamp + 180_000, NaN, Infinity, "9999999999999", undefined]
            .map((expiresOnTimestamp) => ({ ...token, expiresOnTimestamp })),
    ];
    for (const value of invalid) {
        const getToken = createSpeechTokenService({
            env: environment, now: () => timestamp,
            createCredential: () => ({ getToken: async () => value as Awaited<ReturnType<SpeechCredential["getToken"]>> }),
        });
        await assert.rejects(getToken, (error) => {
            errorWithStatus(502)(error);
            assert.match((error as Error).message, /expired Entra token/);
            assert.doesNotMatch((error as Error).stack ?? "", /fixture-access-token|secret/);
            return true;
        });
    }
});

test("tokens must exceed the 180-second margin for startup, capture, and transport", async () => {
    const expiresOnTimestamp = timestamp + 180_001;
    const getToken = createSpeechTokenService({
        env: environment, now: () => timestamp,
        createCredential: () => ({ getToken: async () => ({ ...token, expiresOnTimestamp }) }),
    });
    assert.equal((await getToken()).expiresAt, expiresOnTimestamp);
});

test("token lifetime is evaluated after authentication completes", async () => {
    let now = timestamp;
    const getToken = createSpeechTokenService({
        env: environment, now: () => now,
        createCredential: () => ({
            async getToken() {
                now = token.expiresOnTimestamp - 180_000;
                return token;
            },
        }),
    });
    await assert.rejects(getToken, errorWithStatus(502));
});

test("credential construction and authentication failures are sanitized, actionable, and retriable", async () => {
    const secret = "raw-secret-from-credential";
    const failures = [
        new Error(secret),
        new SpeechAuthError(secret, 418),
        { message: secret, statusCode: 401, token: secret },
        secret,
    ];
    for (const failDuringConstruction of [false, true]) {
        for (const failure of failures) {
            let shouldFail = true;
            const getToken = createSpeechTokenService({
                env: environment, now: () => timestamp,
                createCredential: () => {
                    if (shouldFail && failDuringConstruction) throw failure;
                    return { async getToken() { if (shouldFail) throw failure; return token; } };
                },
            });
            await assert.rejects(getToken, (error) => {
                errorWithStatus(503)(error);
                const safeError = error as SpeechAuthError;
                assert.match(safeError.message, /az login/);
                assert.match(safeError.message, /Cognitive Services Speech User/);
                assert.match(safeError.message, /tenant/);
                assert.doesNotMatch(`${safeError.stack} ${JSON.stringify(safeError)}`, /raw-secret/);
                return true;
            });
            shouldFail = false;
            assert.equal((await getToken()).authorizationToken, `aad#${resourceId}#${token.token}`);
        }
    }
});

test("identity has a 15-second aborting deadline even when a credential ignores cancellation", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let signal: AbortSignal | undefined;
    let resolveToken: (value: typeof token) => void;
    let credentialStarted: () => void;
    const started = new Promise<void>((resolve) => { credentialStarted = resolve; });
    let calls = 0;
    const getToken = createSpeechTokenService({
        env: environment, now: () => timestamp,
        createCredential: () => ({
            getToken(_scope, options) {
                calls++;
                signal = options.abortSignal;
                credentialStarted();
                return calls === 1 ? new Promise((resolve) => { resolveToken = resolve; }) : Promise.resolve(token);
            },
        }),
    });
    const pending = getToken();
    const rejected = assert.rejects(pending, (error) => {
        errorWithStatus(504)(error);
        assert.match((error as Error).message, /timed out/);
        return true;
    });
    await started;
    t.mock.timers.tick(14_999);
    assert.equal(signal?.aborted, false);
    t.mock.timers.tick(1);
    await rejected;
    assert.equal(signal?.aborted, true);
    resolveToken!(token);
    assert.equal((await getToken()).authorizationToken, `aad#${resourceId}#${token.token}`);
});

test("lazy asynchronous credential loading shares one instance across concurrent token requests", async () => {
    let constructions = 0;
    let requests = 0;
    const getToken = createSpeechTokenService({
        env: environment, now: () => timestamp,
        createCredential: async () => {
            constructions++;
            return { async getToken() { requests++; return token; } };
        },
    });
    await Promise.all([getToken(), getToken()]);
    assert.equal(constructions, 1);
    assert.equal(requests, 2);
});

test("a credential loaded after the deadline cannot start authentication", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let finishLoading: (value: SpeechCredential) => void;
    let loadingStarted: () => void;
    const started = new Promise<void>((resolve) => { loadingStarted = resolve; });
    let requests = 0;
    const getToken = createSpeechTokenService({
        env: environment, now: () => timestamp,
        createCredential: () => {
            loadingStarted();
            return new Promise((resolve) => { finishLoading = resolve; });
        },
    });
    const rejected = assert.rejects(getToken(), errorWithStatus(504));
    await started;
    t.mock.timers.tick(15_000);
    await rejected;
    finishLoading!({ async getToken() { requests++; return token; } });
    await getToken();
    assert.equal(requests, 1, "only the new request may authenticate, not the timed-out request");
});

test("successful authentication cancels its timeout", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let signal: AbortSignal | undefined;
    const getToken = createSpeechTokenService({
        env: environment, now: () => timestamp,
        createCredential: () => ({
            async getToken(_scope, options) { signal = options.abortSignal; return token; },
        }),
    });
    await getToken();
    t.mock.timers.tick(15_000);
    assert.equal(signal?.aborted, false);
});

test("same-origin POST JSON requests require the exact custom header, with optional browser metadata", () => {
    for (const contentType of ["application/json", "application/json; charset=utf-8", 'Application/JSON; charset="UTF-8"']) {
        for (const origin of [expectedOrigin, undefined]) {
            for (const fetchSite of ["same-origin", "none", undefined]) {
                assert.doesNotThrow(() => validateSpeechTokenRequest(request({
                    "content-type": contentType, origin, "sec-fetch-site": fetchSite,
                }), expectedOrigin));
            }
        }
    }
});

test("the token guard rejects non-POST requests and untrusted origins or hosts", () => {
    for (const method of ["GET", "HEAD", "OPTIONS", "PUT", "post"]) {
        assert.throws(() => validateSpeechTokenRequest(request({}, method), expectedOrigin), errorWithStatus(405));
    }
    const invalidHeaders: IncomingHttpHeaders[] = [
        { host: undefined }, { host: "evil.example:43127" }, { host: "localhost:43127" },
        { host: "127.0.0.1" }, { host: "127.0.0.1:43128" }, { host: "127.0.0.1:43127.evil.example" },
        { origin: "https://evil.example" }, { origin: "null" }, { origin: `${expectedOrigin}/` },
        { origin: "http://127.0.0.1:43128" }, { origin: `${expectedOrigin}, https://evil.example` },
        { "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-site" }, { "sec-fetch-site": "" },
        { "x-tandem-speech": undefined }, { "x-tandem-speech": "0" }, { "x-tandem-speech": "1, 1" },
        { "x-tandem-speech": " 1" }, { "x-tandem-speech": "1\n" },
    ];
    for (const headers of invalidHeaders) {
        assert.throws(() => validateSpeechTokenRequest(request(headers), expectedOrigin), errorWithStatus(403));
    }
});

test("form submissions, missing JSON content type, and ambiguous guarded headers are rejected", () => {
    for (const contentType of [undefined, "", "text/plain", "application/x-www-form-urlencoded",
        "multipart/form-data; boundary=abc", "application/jsonp", "application/json, text/plain",
        "application/json; charset=utf-16", "application/json; charset=utf-8; charset=utf-8"]) {
        assert.throws(() => validateSpeechTokenRequest(request({
            "content-type": contentType,
        }), expectedOrigin), errorWithStatus(415));
    }
    for (const name of ["host", "origin", "sec-fetch-site", "x-tandem-speech", "content-type"]) {
        const ambiguous = request();
        const value = ambiguous.headers[name] as string;
        ambiguous.rawHeaders = [name, value, name.toUpperCase(), value];
        assert.throws(() => validateSpeechTokenRequest(ambiguous, expectedOrigin), errorWithStatus(403));
        assert.throws(() => validateSpeechTokenRequest(request({
            [name]: [value, value],
        }), expectedOrigin), errorWithStatus(403));
    }
});

test("invalid server origins fail closed without reflecting their contents", () => {
    for (const origin of ["not-a-url-secret", "file://secret", "ftp://secret", `${expectedOrigin}/`,
        `${expectedOrigin}/secret`, `${expectedOrigin}?secret`, "http://secret@127.0.0.1:43127"]) {
        assert.throws(() => validateSpeechTokenRequest(request(), origin), (error) => {
            errorWithStatus(500)(error);
            assert.doesNotMatch((error as Error).message, /secret/);
            return true;
        });
    }
});
