import { lstat, realpath, readdir } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { readRetainedFile } from "./accepted-artifacts.js";

export interface PreviewStart {
    entrypoint: string;
    workingDirectory: string;
    args: string[];
}
export interface PreviewStartChoice extends PreviewStart {
    label: string;
    source: "package-script" | "server-file";
    detail: string;
}
export const previewStartSchema = {
    type: "object", additionalProperties: false,
    properties: {
        entrypoint: { type: "string", minLength: 1, maxLength: 2000 },
        workingDirectory: { type: "string", minLength: 1, maxLength: 2000 },
        args: { type: "array", maxItems: 31, items: { type: "string", maxLength: 4000 } },
    },
    required: ["entrypoint", "workingDirectory", "args"],
};
export const samePreviewPath = (a: string, b: string) => process.platform === "win32"
    ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b);
export const insidePreviewPath = (root: string, path: string) => {
    const part = relative(root, path);
    return part !== "" && !isAbsolute(part) && part !== ".." && !part.startsWith(`..${sep}`);
};
const relativePath = (path: unknown): path is string => typeof path === "string" && path.length > 0 &&
    path.length <= 2000 && !path.includes("\0") && !isAbsolute(path) && !/^[\\/]|[:\r\n]/.test(path) &&
    !path.startsWith("-") && !path.split(/[\\/]/).includes("..");

export function readPreviewStart(value: unknown): PreviewStart {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Preview start instructions must be an object.");
    const start = value as Record<string, unknown>;
    if (Object.keys(start).sort().join(",") !== "args,entrypoint,workingDirectory" ||
        !relativePath(start.entrypoint) || !/\.(?:mjs|cjs|js)$/i.test(start.entrypoint) ||
        !relativePath(start.workingDirectory) || !Array.isArray(start.args) || start.args.length > 31 ||
        start.args.some(arg => typeof arg !== "string" || arg.length > 4000 || arg.includes("\0")) ||
        Buffer.byteLength(JSON.stringify(start), "utf8") > 24_576) {
        throw new Error("Use an existing relative Node server file, a folder within the saved preview, and a bounded argument list.");
    }
    return { entrypoint: start.entrypoint, workingDirectory: start.workingDirectory, args: [...start.args] };
}

export async function materialized(path: string, kind: "file" | "directory"): Promise<void> {
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || !(kind === "file" ? stat.isFile() && stat.nlink === 1 : stat.isDirectory())
        || !samePreviewPath(await realpath(path), path)) throw new Error(`Preview launch ${kind} is missing, aliased or unsafe: ${path}`);
}

export async function verifyPreviewStart(root: string, value: unknown): Promise<PreviewStart> {
    const start = readPreviewStart(value);
    const cwd = resolve(root, start.workingDirectory), entrypoint = resolve(root, start.entrypoint);
    if (!insidePreviewPath(root, entrypoint) || !samePreviewPath(root, cwd) && !insidePreviewPath(root, cwd)) {
        throw new Error("Preview start instructions must stay inside this saved version.");
    }
    await materialized(root, "directory");
    await materialized(cwd, "directory");
    await materialized(entrypoint, "file");
    return start;
}

function directNodeCommand(command: string): string[] | null {
    // Only direct Node invocations: no shell expansion, pipelines, environment assignments or runtime flags.
    if (/[|&;<>()`$%!^\r\n]/.test(command)) return null;
    const args: string[] = [];
    let remaining = command.trim();
    while (remaining) {
        const token = /^(?:"([^"]*)"|([^\s"']+))(?=\s|$)/.exec(remaining);
        if (!token || token[1]?.endsWith("\\")) return null;
        args.push(token[1] ?? token[2]!);
        remaining = remaining.slice(token[0].length).trimStart();
    }
    return /^node(?:\.exe)?$/i.test(args[0] ?? "") && relativePath(args[1]) && /\.(?:mjs|cjs|js)$/i.test(args[1]!)
        ? args.slice(1) : null;
}

export async function discoverPreviewStarts(root: string): Promise<{
    choices: PreviewStartChoice[]; entrypoints: string[]; notices: string[];
}> {
    const choices: PreviewStartChoice[] = [], entrypoints: string[] = [], notices: string[] = [];
    let entries = 0;
    const skip = new Set(["node_modules", "dist", "build", "coverage", "vendor"]);
    await visit(root, 0);
    const unique = new Map<string, PreviewStartChoice>();
    const supported = choices.filter(choice => choice.source !== "server-file" ||
        !choices.some(other => other.source === "package-script" && other.entrypoint === choice.entrypoint));
    for (const choice of supported.sort((a, b) => a.source.localeCompare(b.source) || a.label.localeCompare(b.label))) {
        const key = JSON.stringify([choice.entrypoint, choice.workingDirectory, choice.args]);
        if (!unique.has(key)) unique.set(key, choice);
    }
    if (unique.size > 30 || entrypoints.length > 100) notices.push("Only the first startup choices and server files are shown. Use Advanced setup for another known path.");
    return { choices: [...unique.values()].slice(0, 30), entrypoints: entrypoints.sort().slice(0, 100), notices };

    async function visit(directory: string, depth: number): Promise<void> {
        if (entries > 3000) return;
        await materialized(directory, "directory");
        const children = await readdir(directory, { withFileTypes: true });
        entries += children.length;
        if (entries > 3000) {
            notices.push("Startup search reached its file limit. Use Advanced setup if your known server file is not listed.");
            return;
        }
        for (const entry of children) {
            if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
            const path = join(directory, entry.name), relativeFile = relative(root, path);
            if (entry.isDirectory() && depth < 3 && !skip.has(entry.name.toLowerCase())) {
                await visit(path, depth + 1);
            } else if (entry.isFile() && /\.(?:mjs|cjs|js)$/i.test(entry.name) && entry.name !== "tandem-preview-bridge.js") {
                await materialized(path, "file");
                entrypoints.push(relativeFile);
                if (/^(?:server|preview-server|dev-server|serve|preview)\.(?:mjs|cjs|js)$/i.test(entry.name)) {
                    choices.push({ entrypoint: relativeFile, workingDirectory: relative(root, directory) || ".", args: [],
                        label: "Preview server", source: "server-file",
                        detail: "Existing server file. Previous launch arguments were not saved; add any needed options in Advanced setup." });
                }
            }
        }
        const manifestEntry = children.find(entry => entry.name === "package.json");
        if (!manifestEntry || manifestEntry.isSymbolicLink() || !manifestEntry.isFile()) return;
        const manifestPath = join(directory, "package.json");
        const bytes = await readRetainedFile(manifestPath, 256 * 1024);
        let manifest: unknown;
        try { manifest = JSON.parse(bytes.toString("utf8")); }
        catch { notices.push(`${relative(root, manifestPath)} is not valid JSON. Its start commands could not be read.`); return; }
        if (!manifest || typeof manifest !== "object" || !("scripts" in manifest) ||
            !manifest.scripts || typeof manifest.scripts !== "object" || Array.isArray(manifest.scripts)) return;
        const scripts = manifest.scripts as Record<string, unknown>;
        for (const name of ["dev", "start", "preview", "serve"]) {
            const command = scripts[name];
            if (typeof command !== "string") continue;
            const args = directNodeCommand(command);
            if (!args || scripts[`pre${name}`] || scripts[`post${name}`]) {
                notices.push(`${relative(root, manifestPath)}: "${name}" needs a launch method this restart control does not support yet.`);
                continue;
            }
            const start = { entrypoint: relative(root, resolve(directory, args[0]!)),
                workingDirectory: relative(root, directory) || ".", args: args.slice(1) };
            await verifyPreviewStart(root, start);
            choices.push({ ...start, label: name === "dev" ? "Development preview" : name === "start" ? "Start preview" : "Preview server",
                source: "package-script", detail: `From "${name}" in ${relative(root, manifestPath)}. Uses its existing start arguments.` });
        }
    }
}
