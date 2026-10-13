import { lstat, mkdir, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import lockfile from "proper-lockfile";
import { ProjectStoreError, readJsonFile, writeJsonAtomically } from "./project-store.js";

export type StartingPath = "preparation" | "development";
interface ProjectEntry { version: 1; projectPath: string; startingPath: StartingPath }
const identity = (path: string) => process.platform === "win32" ? path.toLowerCase() : path;

export async function readProjectEntry(folder: string) {
    const projectPath = await realpath(resolve(folder));
    const path = join(projectPath, ".tandem", "project-entry.json");
    try {
        if (identity(await realpath(join(projectPath, ".tandem"))) !== identity(join(projectPath, ".tandem"))
            || (await lstat(path)).isSymbolicLink()) throw new ProjectStoreError("aliased_project_entry", "Project entry metadata must belong to this folder.");
    } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    const value = await readJsonFile(path);
    if (value === undefined) return { projectPath, startingPath: null as StartingPath | null };
    if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1
        || !("projectPath" in value) || typeof value.projectPath !== "string" || identity(value.projectPath) !== identity(projectPath)
        || !("startingPath" in value) || typeof value.startingPath !== "string" || !["preparation", "development"].includes(value.startingPath)) {
        throw new ProjectStoreError("invalid_project_entry", `Invalid or conflicting project entry metadata in ${path}. It has been preserved.`, 422);
    }
    return { projectPath, startingPath: value.startingPath as StartingPath };
}

export async function chooseProjectEntry(folder: string, startingPath: unknown) {
    if (startingPath !== "preparation" && startingPath !== "development") {
        throw new ProjectStoreError("invalid_starting_path", "Choose Preparation or Development.", 400);
    }
    const projectPath = await realpath(resolve(folder));
    const directory = join(projectPath, ".tandem");
    await mkdir(directory, { recursive: true });
    if (identity(await realpath(directory)) !== identity(directory)) {
        throw new ProjectStoreError("aliased_project_entry", "Project entry metadata must belong to this folder.");
    }
    const path = join(directory, "project-entry.json");
    let compromised = false;
    const release = await lockfile.lock(path, { realpath: false, stale: 30000, update: 5000,
        retries: { retries: 5, minTimeout: 20, maxTimeout: 100 },
        onCompromised() { compromised = true; } });
    try {
        const current = await readProjectEntry(projectPath);
        if (current.startingPath && current.startingPath !== startingPath) {
            throw new ProjectStoreError("project_entry_already_chosen", "This folder already has a different starting path. Its choice and saved work were preserved.");
        }
        if (!current.startingPath) {
            const record: ProjectEntry = { version: 1, projectPath, startingPath };
            await writeJsonAtomically(path, record, () => {
                if (compromised) throw new ProjectStoreError("project_entry_ownership_lost", "Project entry ownership was lost.");
            });
        }
        return { projectPath, startingPath };
    } finally { if (!compromised) await release(); }
}
