import { appendFile, mkdir, readdir, realpath, rename, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { readJsonFile, writeJsonAtomically } from "../project-store.js";
import type { WorkspaceListing } from "./contracts.js";

export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function redactDiagnostic(message: string): string {
    return message
        .replace(/(authorization["']?\s*[:=]\s*["']?(?:(?:bearer|basic|token)\s+)?|bearer\s+|(?:access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|client[_-]?secret|secret|password|token)\s*["']?\s*[:=]\s*["']?)[^\s"',]+/gi, "$1[redacted]")
        .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g, "[redacted]")
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
        .slice(0, 8192);
}

export class HostDiagnostics {
    private lines: string[] = [];
    private file: string | undefined;
    private pending = Promise.resolve();

    constructor(private readonly report: (message: string) => void) {}

    async setWorkspace(workspace: string): Promise<void> {
        await this.pending;
        this.file = join(workspace, ".tandem", "desktop", "browser.log");
        this.lines = [];
    }

    write(message: string): void {
        const line = `${new Date().toISOString()} ${redactDiagnostic(message)}`;
        this.lines.push(line);
        this.lines = this.lines.slice(-150);
        this.pending = this.pending.then(async () => {
            if (!this.file) return;
            await mkdir(dirname(this.file), { recursive: true });
            const size = await stat(this.file).then((value) => value.size, (error: NodeJS.ErrnoException) => {
                if (error.code === "ENOENT") return 0;
                throw error;
            });
            if (size > 512 * 1024) await rename(this.file, `${this.file}.previous`);
            await appendFile(this.file, `${line}\n`, "utf8");
        }).catch((error: unknown) => {
            this.file = undefined;
            const message = `Diagnostic file unavailable; recent messages remain in memory: ${redactDiagnostic(errorMessage(error))}`;
            this.lines.push(message);
            this.report(message);
        });
    }

    snapshot(): string { return this.lines.join("\n"); }
    flush(): Promise<void> { return this.pending; }
}

export function preferencesDirectory(): string {
    if (process.platform === "win32") return join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "Tandem");
    if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "Tandem");
    return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "tandem");
}

export class WorkspacePreferences {
    private writable = true;
    recent: string[] = [];
    constructor(private readonly directory: string, private readonly report: (message: string) => void) {}

    async load(): Promise<void> {
        try {
            const value = await readJsonFile(join(this.directory, "browser-workspaces.json"));
            if (value === undefined) {
                const legacy = await readJsonFile(join(this.directory, "last-workspace.json"));
                if (legacy === undefined) return;
                if (typeof legacy !== "string" || !isAbsolute(legacy)) throw new Error("The remembered desktop workspace is invalid.");
                this.recent = [legacy];
            } else {
                if (!Array.isArray(value) || value.length > 12 || !value.every((path) => typeof path === "string" && isAbsolute(path))) {
                    throw new Error("The recent workspace list is invalid.");
                }
                this.recent = value;
            }
        } catch (error) {
            this.writable = false;
            this.report(`Recent folders could not be loaded. The saved preferences are preserved: ${errorMessage(error)}`);
        }
    }

    async remember(workspace: string): Promise<void> {
        this.recent = [workspace, ...this.recent.filter((path) => !sameWorkspace(path, workspace))].slice(0, 12);
        if (!this.writable) return;
        try { await writeJsonAtomically(join(this.directory, "browser-workspaces.json"), this.recent); }
        catch (error) { this.report(`Could not remember this workspace: ${errorMessage(error)}`); }
    }
}

export function sameWorkspace(a: string, b: string): boolean {
    const normalize = (path: string) => process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path);
    return normalize(a) === normalize(b);
}

export async function workspacePath(path: string): Promise<string> {
    if (!path.trim() || !isAbsolute(path) || path.includes("\0")) throw new Error("Enter an absolute workspace folder path.");
    const canonical = await realpath(path);
    if (!(await stat(canonical)).isDirectory()) throw new Error("Select a workspace folder, not a file.");
    return canonical;
}

export async function listWorkspaceDirectories(path: string): Promise<WorkspaceListing> {
    const canonical = await workspacePath(path);
    const directories = (await readdir(canonical, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
        .sort((a, b) => a.name.localeCompare(b.name));
    const parent = dirname(canonical);
    return { path: canonical, parent: parent === canonical ? null : parent,
        directories: directories.slice(0, 500).map((entry) => ({ name: entry.name, path: join(canonical, entry.name) })),
        truncated: directories.length > 500 };
}

export async function createWorkspaceDirectory(parent: string, name: string): Promise<WorkspaceListing> {
    if (!name || name !== name.trim() || name.length > 255 || /[<>:"/\\|?*\u0000-\u001f]/.test(name)
        || name.endsWith(".") || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
        throw new Error("Enter a valid folder name without path separators, reserved names, or trailing dots/spaces.");
    }
    const path = join(await workspacePath(parent), name);
    await mkdir(path);
    try { return await listWorkspaceDirectories(path); }
    catch (error) { throw new Error(`Created ${path}, but it could not be opened: ${errorMessage(error)}`, { cause: error }); }
}
