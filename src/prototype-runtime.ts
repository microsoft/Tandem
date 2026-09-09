import { readdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fingerprintWorkspace } from "./execution.js";

export const PROTOTYPE_FINGERPRINT_PREFIX = "prototype-v2:";
const runtimeDirectories = new Set([
    ".browser-checkpoint", ".browser-profile", ".vite-checkpoint", ".vite", ".cache", ".tandem-runtime",
]);

export function prototypeRuntimePath(checkpointRoot: string): string {
    return join(dirname(dirname(checkpointRoot)), "runtime", basename(checkpointRoot));
}

export async function isPrototypeRuntimeDirectory(path: string): Promise<boolean> {
    if (runtimeDirectories.has(basename(path).toLowerCase())) return true;
    // Inspect names and entry types, never browser databases or locked profile files.
    const entries = await readdir(path, { withFileTypes: true });
    const files = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name.toLowerCase()));
    const directories = new Set(entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name.toLowerCase()));
    return files.has("local state") && directories.has("default") &&
        (files.has("devtoolsactiveport") || files.has("crashpadmetrics.pma") ||
            directories.has("crashpad") || directories.has("browsermetrics"));
}

export async function fingerprintPrototypeWorkspace(root: string): Promise<string> {
    return PROTOTYPE_FINGERPRINT_PREFIX + await fingerprintWorkspace(root, {
        excludeDirectory: isPrototypeRuntimeDirectory,
    });
}
