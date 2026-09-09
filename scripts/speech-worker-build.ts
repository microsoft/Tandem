import { build, type Plugin } from "esbuild";
import { fileURLToPath } from "node:url";

export function buildSpeechWorker(plugins: Plugin[] = []) {
    return build({
        entryPoints: [fileURLToPath(new URL("../src/speech-login-worker.ts", import.meta.url))],
        bundle: true,
        write: false,
        metafile: true,
        platform: "node",
        format: "cjs",
        target: "node20",
        plugins,
        define: { "import.meta.url": "__tandemWorkerModuleUrl" },
        banner: { js: 'const __tandemWorkerModuleUrl = require("node:worker_threads").workerData.moduleUrl;' },
    });
}
