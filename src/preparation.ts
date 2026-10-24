import { lstat, opendir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PreparationCheck } from "./types.js";

export async function inspectEmptyPreparationWorkspace(projectRoot: string) {
    const directory = await opendir(projectRoot);
    for await (const entry of directory) {
        if (entry.isDirectory() && [".git", ".tandem"].includes(entry.name)) continue;
        if (entry.isFile() && entry.name === ".gitignore") {
            const path = join(projectRoot, entry.name);
            const info = await lstat(path);
            if (info.isFile() && info.nlink === 1 && info.size <= 1024 &&
                (await readFile(path, "utf8")).trim() === ".tandem/") continue;
        }
        return null;
    }
    return {
        emptyWorkspace: true,
        summary: "The workspace has no project files. Only Git and Tandem metadata directories and a .gitignore containing only .tandem/ are excluded.",
        checks: [
            {
                label: "Workspace",
                status: "ready",
                detail: "A local directory inspection found no project files, guidance, manifests, or existing application to analyze.",
            },
            {
                label: "Implementation tooling",
                status: "deferred",
                detail: "Runtime, dependency, credential, and execution checks are deferred to Development unless they affect a requirements decision. No tooling readiness was verified.",
            },
        ] satisfies PreparationCheck[],
    };
}
