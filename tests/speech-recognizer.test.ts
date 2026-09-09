import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import type { SpeechEvents, SpeechSessionFactory } from "../src/renderer/speech-recognizer.js";

let compiled: Promise<string> | undefined;
async function compile() {
    const result = await build({
        entryPoints: [fileURLToPath(new URL("../src/renderer/speech-recognizer.ts", import.meta.url))],
        bundle: true, format: "cjs", target: "es2022", write: false, logLevel: "silent",
        plugins: [{
            name: "fake-azure-sdk",
            setup(api) {
                api.onResolve({ filter: /^microsoft-cognitiveservices-speech-sdk$/ }, () => ({ path: "sdk", namespace: "fake" }));
                api.onLoad({ filter: /.*/, namespace: "fake" }, () => ({
                    contents: `export const {SpeechConfig, AudioConfig, SpeechRecognizer, ResultReason, CancellationReason} = globalThis.sdk;`,
                }));
            },
        }],
    });
    return result.outputFiles[0].text;
}

async function fixture() {
    let tracksStopped = 0;
    let audioClosed = 0;
    let recognizerClosed = 0;
    let telemetry = true;
    let constructorFails = false;
    let config: any;
    let recognizer: any;
    let response: any = {
        ok: true, json: async () => ({
            authorizationToken: "aad#/resource#fake-token", region: "eastus", language: "zh-CN",
            expiresAt: Date.now() + 600_000,
        }),
    };
    const requests: { url: string; options: any }[] = [];
    const stream = { getTracks: () => [{ stop: () => { tracksStopped++; } }] };
    let getMedia: () => Promise<any> = async () => stream;
    const results: [string, boolean][] = [];
    const errors: string[] = [];
    let ended = 0;
    class Recognizer {
        static enableTelemetry(value: boolean) { telemetry = value; }
        constructor() {
            if (constructorFails) throw new Error("Internal token-bearing error");
            recognizer = this;
        }
        close() { recognizerClosed++; }
        startContinuousRecognitionAsync(success: () => void) { success(); }
        stopContinuousRecognitionAsync(success: () => void) { success(); }
    }
    const context = {
        module: { exports: {} }, exports: {}, Error, DOMException, console,
        navigator: { mediaDevices: { getUserMedia: () => getMedia() } },
        fetch: async (url: string, options: any) => { requests.push({ url, options }); return response; },
        sdk: {
            SpeechConfig: { fromAuthorizationToken: (token: string, region: string) => (config = { token, region }) },
            AudioConfig: { fromStreamInput: () => ({ close() { audioClosed++; } }) },
            SpeechRecognizer: Recognizer,
            ResultReason: { RecognizedSpeech: 1 },
            CancellationReason: { Error: 1 },
        },
    };
    runInNewContext(await (compiled ??= compile()), context);
    const create = (context.module.exports as { createAzureSpeechSession: SpeechSessionFactory }).createAzureSpeechSession;
    const events: SpeechEvents = {
        transcript: (text, final) => { results.push([text, final]); },
        error: (message) => { errors.push(message); },
        ended: () => { ended++; },
    };
    return {
        create, events, results, errors, requests, stream,
        stats: () => ({ tracksStopped, audioClosed, recognizerClosed, telemetry, ended }),
        recognizer: () => recognizer, config: () => config,
        setMedia(value: typeof getMedia) { getMedia = value; },
        setResponse(value: typeof response) { response = value; },
        failConstructor() { constructorFails = true; },
    };
}

test("Azure recognizer uses Entra token, configured language, continuous results, and explicit disposal", async () => {
    const h = await fixture();
    const abort = new AbortController();
    const session = await h.create(h.events, abort.signal);
    assert.equal(h.requests[0].url, "/api/speech/token");
    assert.equal(h.requests[0].options.headers["X-Tandem-Speech"], "1");
    assert.equal(h.requests[0].options.cache, "no-store");
    assert.equal(h.config().token, "aad#/resource#fake-token");
    assert.equal(h.config().speechRecognitionLanguage, "zh-CN");
    assert.equal(h.stats().telemetry, false);
    await session.start();
    h.recognizer().recognizing(null, { result: { text: "Partial" } });
    h.recognizer().recognized(null, { result: { reason: 1, text: "Final." } });
    h.recognizer().recognized(null, { result: { reason: 0, text: "No match" } });
    assert.deepEqual(h.results, [["Partial", false], ["Final.", true]]);
    await session.stop();
    session.close();
    abort.abort();
    h.recognizer().recognizing(null, { result: { text: "Late" } });
    assert.equal(h.results.length, 2);
    assert.equal(h.stats().tracksStopped, 1);
    assert.equal(h.stats().audioClosed, 1);
    assert.equal(h.stats().recognizerClosed, 1);
});

test("authentication failure does not request the microphone", async () => {
    const h = await fixture();
    let requested = false;
    h.setMedia(async () => { requested = true; return h.stream; });
    h.setResponse({ ok: false, json: async () => ({ error: "Configure your Speech resource." }) });
    await assert.rejects(h.create(h.events, new AbortController().signal), /Configure your Speech resource/);
    assert.equal(requested, false);
});

test("pending microphone permission is cleaned up after cancellation", async () => {
    const h = await fixture();
    let resolve!: (value: unknown) => void;
    h.setMedia(() => new Promise((done) => { resolve = done; }));
    const abort = new AbortController();
    const request = h.create(h.events, abort.signal);
    await new Promise<void>((done) => setImmediate(done));
    abort.abort();
    resolve(h.stream);
    await assert.rejects(request, { name: "AbortError" });
    assert.equal(h.stats().tracksStopped, 1);
    assert.equal(h.recognizer(), undefined);
});

test("permission denial is actionable and SDK initialization failure releases microphone resources", async () => {
    const h = await fixture();
    h.setMedia(async () => { throw new DOMException("Denied", "NotAllowedError"); });
    await assert.rejects(h.create(h.events, new AbortController().signal), /Allow microphone access/);
    h.setMedia(async () => h.stream);
    h.failConstructor();
    await assert.rejects(h.create(h.events, new AbortController().signal), /Could not initialize Azure Speech/);
    assert.equal(h.stats().tracksStopped, 1);
    assert.equal(h.stats().audioClosed, 1);
});

test("service failures are sanitized and abort releases the actual MediaStream", async () => {
    const h = await fixture();
    const abort = new AbortController();
    await h.create(h.events, abort.signal);
    h.recognizer().canceled(null, { reason: 1, errorDetails: "Secret token" });
    assert.match(h.errors[0], /Azure Speech recognition failed/);
    assert.doesNotMatch(h.errors[0], /Secret/);
    abort.abort();
    assert.equal(h.stats().tracksStopped, 1);
    assert.equal(h.stats().recognizerClosed, 1);
});
