import { access } from "node:fs/promises";
import { registerHooks } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { verifyPayload } from "../payload.js";

async function main(): Promise<void> {
    const [entrypoint, expectedDigest] = process.argv.slice(2);
    const parent = Number(process.env.COPILOT_EXTENSION_PARENT_PID);
    const sdk = process.env.COPILOT_SDK_PATH;
    if (!entrypoint || !expectedDigest || !sdk || !Number.isSafeInteger(parent) || parent <= 0 || process.ppid !== parent) {
        throw new Error("Source-preview extension requires its native parent, injected SDK and exact payload identity.");
    }
    await Promise.all([access(join(sdk, "index.js")), access(join(sdk, "extension.js"))]);
    const manifest = await verifyPayload(dirname(resolve(entrypoint)));
    if (manifest.digest !== expectedDigest) throw new Error("Source-preview extension payload changed; no alternate package was loaded.");
    const modules = new Map([
        ["@github/copilot-sdk", pathToFileURL(join(sdk, "index.js")).href],
        ["@github/copilot-sdk/extension", pathToFileURL(join(sdk, "extension.js")).href],
    ]);
    registerHooks({
        resolve(specifier, context, nextResolve) {
            return nextResolve(modules.get(specifier) ?? specifier, context);
        },
    });
    // Native extensions use stdio, not an IPC channel that enforces parent lifetime.
    const parentWatch = setInterval(() => {
        if (process.ppid !== parent) {
            console.error("Source-preview extension's native parent changed; stopping.");
            process.exit(0);
        }
        try { process.kill(parent, 0); }
        catch (error) {
            if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) {
                console.error("Could not verify the source-preview extension's native parent:", error);
            }
            process.exit(1);
        }
    }, 1000);
    try { await import(pathToFileURL(resolve(entrypoint)).href); }
    catch (error) { clearInterval(parentWatch); throw error; }
}

void main().catch((error: unknown) => {
    console.error("Source-preview extension could not start:", error);
    process.exit(1);
});
