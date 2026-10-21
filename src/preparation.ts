import { opendir } from "node:fs/promises";
import type { PreparationCheck } from "./types.js";

export async function inspectEmptyPreparationWorkspace(projectRoot: string) {
    const directory = await opendir(projectRoot);
    for await (const entry of directory) {
        if (entry.isDirectory() && [".git", ".tandem"].includes(entry.name)) continue;
        return null;
    }
    return {
        emptyWorkspace: true,
        summary: "The workspace has no project files. Only Git and Tandem metadata directories are excluded.",
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
