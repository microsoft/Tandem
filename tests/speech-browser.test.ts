import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import { buildSpeechWorker } from "../scripts/speech-worker-build.js";
import type { createBrowserSpeechCredential } from "../src/speech-browser.js";

const scope = "https://cognitiveservices.azure.com/.default";
const moduleUrl = new URL("../src/speech-browser.ts", import.meta.url).href;

async function browserFactory(hang = false) {
    const worker = await buildSpeechWorker([{
        name: "fake-interactive-identity",
        setup(api) {
            api.onResolve({ filter: /^@azure\/identity$/ }, () => ({ path: "identity", namespace: "fake" }));
            api.onLoad({ filter: /.*/, namespace: "fake" }, () => ({
                contents: `
export class InteractiveBrowserCredential {
  authenticated = false;
  constructor(options) {
    if (!options.disableAutomaticAuthentication || options.tenantId !== "organizations") throw new Error("Unsafe options");
  }
  async authenticate() {
    if (${hang}) await new Promise(() => { setInterval(() => {}, 1000); });
    this.authenticated = true;
  }
  async getToken() {
    if (!this.authenticated) throw new Error("Sensitive SDK details");
    return { token: "browser-fixture", expiresOnTimestamp: Date.now() + 600000 };
  }
}`,
            }));
        },
    }]);
    const result = await build({
        entryPoints: [fileURLToPath(new URL("../src/speech-browser.ts", import.meta.url))],
        bundle: true, platform: "node", format: "cjs", write: false, target: "node20",
        define: { "import.meta.url": JSON.stringify(moduleUrl) },
        plugins: [{
            name: "inline-worker",
            setup(api) {
                api.onResolve({ filter: /^tandem:speech-worker$/ }, () => ({ path: "worker", namespace: "inline" }));
                api.onLoad({ filter: /.*/, namespace: "inline" }, () => ({
                    contents: `export default ${JSON.stringify(worker.outputFiles[0].text)}`,
                }));
            },
        }],
    });
    const module = { exports: {} as { createBrowserSpeechCredential: typeof createBrowserSpeechCredential } };
    runInNewContext(result.outputFiles[0].text, { module, exports: module.exports, require: createRequire(import.meta.url), Error });
    return module.exports.createBrowserSpeechCredential;
}

test("interactive worker opens no browser on token requests and keeps login state only until disposal", async () => {
    const create = await browserFactory();
    const credential = create({ tenantId: "organizations" });
    try {
        const options = { abortSignal: new AbortController().signal };
        await assert.rejects(credential.getToken(scope, options), (error) => {
            assert.doesNotMatch((error as Error).message, /Sensitive SDK/);
            return true;
        });
        assert.equal((await credential.authenticate(scope, options))!.token, "browser-fixture");
        assert.equal((await credential.getToken(scope, options))!.token, "browser-fixture");
    } finally { await credential.dispose(); }
    await assert.rejects(credential.getToken(scope, { abortSignal: new AbortController().signal }), /cancelled or expired/);
});

test("aborting a pending browser login terminates its worker and permits a fresh login", { timeout: 10000 }, async () => {
    const create = await browserFactory(true);
    const credential = create({ tenantId: "organizations" });
    const controller = new AbortController();
    const request = credential.authenticate(scope, { abortSignal: controller.signal });
    const failed = assert.rejects(request, /interrupted/);
    controller.abort();
    await failed;
    await credential.dispose();
    const retry = (await browserFactory())({ tenantId: "organizations" });
    try {
        assert.equal((await retry.authenticate(scope, { abortSignal: new AbortController().signal }))!.token, "browser-fixture");
    } finally { await retry.dispose(); }
});

test("production-bundled Azure Identity initializes in an isolated worker without external packages or interactive login", { timeout: 20000 }, async () => {
    const built = await buildSpeechWorker();
    const worker = new Worker(built.outputFiles[0].text, {
        eval: true, execArgv: [], workerData: { tenantId: "organizations", moduleUrl },
        stdout: true, stderr: true,
    });
    worker.stdout.resume();
    worker.stderr.resume();
    try {
        const reply = new Promise<unknown>((resolve, reject) => {
            worker.once("message", resolve);
            worker.once("error", reject);
            worker.once("exit", (code) => reject(new Error(`Worker exited before responding (${code})`)));
        });
        // No cached account: disableAutomaticAuthentication must fail without opening a browser.
        worker.postMessage({ id: 1, action: "getToken", scope });
        assert.deepEqual(await reply, { id: 1, ok: false });
    } finally { await worker.terminate(); }
});

test("the packaged browser launcher imports correctly from the evaluated worker", { timeout: 20000 }, async () => {
    const built = await buildSpeechWorker([{
        name: "load-browser-launcher-without-opening",
        setup(api) {
            api.onResolve({ filter: /^@azure\/identity$/ }, () => ({ path: "identity", namespace: "fake" }));
            api.onLoad({ filter: /.*/, namespace: "fake" }, () => ({
                resolveDir: fileURLToPath(new URL("../", import.meta.url)),
                contents: `export class InteractiveBrowserCredential {
                    async authenticate() {
                        const launcher = await import("open");
                        if (typeof launcher.default !== "function") throw new Error("Browser launcher unavailable");
                    }
                    async getToken() { return { token: "fixture", expiresOnTimestamp: Date.now() + 600000 }; }
                }`,
            }));
        },
    }]);
    const worker = new Worker(built.outputFiles[0].text, {
        eval: true, execArgv: [], workerData: { tenantId: "organizations", moduleUrl },
        stdout: true, stderr: true,
    });
    worker.stdout.resume();
    worker.stderr.resume();
    try {
        const reply = new Promise<{ ok: boolean }>((resolve, reject) => {
            worker.once("message", resolve);
            worker.once("error", reject);
            worker.once("exit", (code) => reject(new Error(`Browser launcher exited (${code})`)));
        });
        worker.postMessage({ id: 1, action: "authenticate", scope });
        assert.equal((await reply).ok, true);
    } finally { await worker.terminate(); }
});
