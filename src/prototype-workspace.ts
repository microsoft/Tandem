import { constants } from "node:fs";
import { copyFile, lstat, mkdir, readFile, readdir, realpath, symlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, parse, relative, resolve, sep } from "node:path";
import { prototypePreviewBridgeSource } from "./prototype-bridge.js";
import { isPrototypeRuntimeDirectory, prototypeRuntimePath } from "./prototype-runtime.js";

const preparationMarker = ".tandem-prototype-workspace.json";
const completionMarker = ".tandem-prototype-workspace.complete.json";
const bridgeName = "tandem-preview-bridge.js";
const maxSourceFiles = 20_000;
const maxSourceBytes = 256 * 1024 * 1024;
const maxSourceEntries = 50_000;
const maxDependencyEntries = 200_000;
const maxMaterializedDependencyBytes = 1024 * 1024 * 1024;
const ignoredDirectories = new Set([".git", ".tandem", ".ssh", ".aws", ".azure", ".gnupg"]);
const generatedDirectories = new Set(["dist", "build", "coverage", ".next", "out"]);
const reservedFiles = new Set([preparationMarker, completionMarker, bridgeName]);

interface PreparationIdentity {
    version: 1;
    projectRoot: string;
    storageRoot: string;
    sourceRoot: string;
    checkpointRoot: string;
}

function identity(path: string): string {
    const normalized = normalize(resolve(path));
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function contained(root: string, path: string): boolean {
    const remainder = relative(identity(root), identity(path));
    return remainder === "" || (!isAbsolute(remainder) && remainder !== ".." && !remainder.startsWith(`..${sep}`));
}

function missing(error: unknown): boolean {
    return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function exists(path: string): Promise<boolean> {
    try {
        await lstat(path);
        return true;
    } catch (error) {
        if (missing(error)) return false;
        throw error;
    }
}

async function assertDirectory(path: string): Promise<void> {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isDirectory() || identity(await realpath(path)) !== identity(path)) {
        throw new Error(`Unsupported linked or non-directory prototype source/path: ${path}`);
    }
}

async function checkAncestors(root: string, path: string, create: boolean): Promise<void> {
    let current = root;
    for (const component of relative(root, path).split(sep).filter(Boolean)) {
        current = join(current, component);
        if (create) await mkdir(current, { recursive: true });
        await assertDirectory(current);
    }
}

function isCheckpoint(root: string, path: string): boolean {
    const parts = relative(root, path).split(sep);
    return contained(root, path) && parts.length === 4 && parts[0] === "efforts" &&
        Boolean(parts[1]) && parts[2] === "previews" && Boolean(parts[3]);
}

function isDependencyPath(path: string, projectRoot: string, storageRoot: string): boolean {
    if (contained(projectRoot, path) && relative(projectRoot, path).split(sep).includes("node_modules")) return true;
    const parts = relative(storageRoot, path).split(sep);
    return contained(storageRoot, path) && isCheckpoint(storageRoot, join(storageRoot, ...parts.slice(0, 4))) &&
        parts.slice(4).includes("node_modules");
}

function isPrivateFile(name: string): boolean {
    return /^\.env(?:\.|$)/i.test(name) || [".npmrc", ".pypirc", ".netrc", "id_rsa", "id_ed25519"].includes(name.toLowerCase()) ||
        /\.(?:pem|key|p12|pfx)$/i.test(name);
}

async function readMarker(path: string): Promise<unknown> {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 16_384) {
        throw new Error(`Invalid prototype preparation marker: ${path}`);
    }
    return JSON.parse(await readFile(path, "utf8")) as unknown;
}

function sameIdentity(value: unknown, expected: PreparationIdentity, complete: boolean): boolean {
    if (!value || typeof value !== "object") return false;
    const record = value as Record<string, unknown>;
    return record.version === expected.version && record.projectRoot === expected.projectRoot &&
        record.storageRoot === expected.storageRoot &&
        record.sourceRoot === expected.sourceRoot && record.checkpointRoot === expected.checkpointRoot &&
        record.complete === complete;
}

// Workspace installations must be copied together: sharing even an ordinary
// dependency can resolve its peers through the original workspace's node_modules.
async function checkDependencies(path: string, projectRoot: string, storageRoot: string,
    budget: { entries: number; materialize: boolean }, visited: Set<string>,
    mappedTarget: (target: string) => string | null): Promise<string> {
    const installation = await realpath(path);
    if (!isDependencyPath(installation, projectRoot, storageRoot)) {
        throw new Error(`Unsupported dependency installation outside the project/checkpoint node_modules layout: ${path}`);
    }
    await scan(installation);
    return installation;

    async function scan(directory: string): Promise<void> {
        const key = identity(directory);
        if (visited.has(key)) return;
        visited.add(key);
        for (const entry of await readdir(directory, { withFileTypes: true })) {
            if (++budget.entries > maxDependencyEntries) throw new Error("Prototype dependency inspection exceeds 200000 entries; use a smaller installation.");
            const entryPath = join(directory, entry.name);
            if (entry.isSymbolicLink()) {
                const target = await realpath(entryPath);
                if (!isDependencyPath(target, projectRoot, storageRoot)) {
                    if (!mappedTarget(target)) throw new Error(`Unsupported workspace/external dependency link: ${entryPath}. Dependencies cannot resolve source outside this project.`);
                    budget.materialize = true;
                    continue;
                }
                const info = await lstat(target);
                if (info.isDirectory()) await scan(target);
                else if (!info.isFile()) throw new Error(`Unsupported dependency link target: ${entryPath}`);
            } else if (entry.isDirectory()) {
                await scan(entryPath);
            } else if (!entry.isFile()) {
                throw new Error(`Unsupported dependency entry: ${entryPath}`);
            }
        }
    }
}

export async function preparePrototypeWorkspace(args: {
    projectRoot: string;
    checkpointRoot: string;
    sourceRoot?: string | null;
    storageRoot?: string;
}): Promise<void> {
    for (const path of [args.projectRoot, args.checkpointRoot, args.sourceRoot ?? args.projectRoot, args.storageRoot ?? join(args.projectRoot, ".tandem")]) {
        if (!isAbsolute(path)) throw new Error(`Prototype workspace paths must be absolute: ${path}`);
    }
    const projectRoot = resolve(args.projectRoot);
    const storageRoot = resolve(args.storageRoot ?? join(projectRoot, ".tandem"));
    const checkpointRoot = resolve(args.checkpointRoot);
    const sourceRoot = resolve(args.sourceRoot ?? projectRoot);
    await assertDirectory(projectRoot);
    if (!isCheckpoint(storageRoot, checkpointRoot)) {
        throw new Error("Checkpoint path must be under storageRoot/efforts/<id>/previews/<unique-request-id> (storageRoot defaults to projectRoot/.tandem).");
    }
    if (contained(storageRoot, projectRoot)) throw new Error("Prototype storageRoot must not contain the original project source.");
    const priorCheckpoint = identity(sourceRoot) !== identity(projectRoot);
    if ((priorCheckpoint && !isCheckpoint(storageRoot, sourceRoot)) ||
        contained(checkpointRoot, sourceRoot)) {
        throw new Error("Prototype source must be the project or a distinct checkpoint inside the trusted storageRoot; path escape is not allowed.");
    }
    await checkAncestors(contained(projectRoot, storageRoot) ? projectRoot : parse(storageRoot).root, storageRoot, !priorCheckpoint);
    if (priorCheckpoint) await checkAncestors(storageRoot, sourceRoot, false);
    await checkAncestors(storageRoot, prototypeRuntimePath(checkpointRoot), true);
    const expected: PreparationIdentity = {
        version: 1, projectRoot: identity(projectRoot), storageRoot: identity(storageRoot),
        sourceRoot: identity(sourceRoot), checkpointRoot: identity(checkpointRoot),
    };
    if (await exists(checkpointRoot)) {
        await checkAncestors(storageRoot, checkpointRoot, false);
        if (!(await exists(join(checkpointRoot, preparationMarker))) || !(await exists(join(checkpointRoot, completionMarker)))) {
            throw new Error(`Incomplete prototype workspace preparation; checkpoint preserved without overwriting edits: ${checkpointRoot}. Choose a new request ID.`);
        }
        if (!sameIdentity(await readMarker(join(checkpointRoot, preparationMarker)), expected, false) ||
            !sameIdentity(await readMarker(join(checkpointRoot, completionMarker)), expected, true)) {
            throw new Error(`Prototype workspace preparation identity mismatch; existing checkpoint preserved: ${checkpointRoot}`);
        }
        const bridge = await lstat(join(checkpointRoot, bridgeName));
        if (!bridge.isFile() || bridge.isSymbolicLink()) throw new Error(`Prepared preview bridge is missing or linked: ${checkpointRoot}`);
        return;
    }

    await checkAncestors(storageRoot, resolve(checkpointRoot, ".."), true);
    // Exclusive directory creation prevents competing preparations from merging copies.
    await mkdir(checkpointRoot);
    await writeFile(join(checkpointRoot, preparationMarker), JSON.stringify({ ...expected, complete: false }), { flag: "wx" });
    const directories: string[] = [];
    const files: Array<{ path: string; size: number; mtimeMs: number }> = [];
    const dependencies: Array<{ path: string; installation: string }> = [];
    const dependencyBudget = { entries: 0, materialize: false };
    const visitedDependencies = new Set<string>();
    let bytes = 0;
    let entries = 0;
    await inspect("");
    for (const path of directories) await mkdir(join(checkpointRoot, path));
    for (const file of files) {
        const source = join(sourceRoot, file.path);
        const info = await lstat(source);
        if (!info.isFile() || info.isSymbolicLink() || info.size !== file.size || info.mtimeMs !== file.mtimeMs) {
            throw new Error(`Prototype source changed during preparation; partial checkpoint preserved: ${source}`);
        }
        await copyFile(source, join(checkpointRoot, file.path), constants.COPYFILE_EXCL);
        const after = await lstat(source);
        if (after.size !== info.size || after.mtimeMs !== info.mtimeMs) {
            throw new Error(`Prototype source changed during preparation: ${source}`);
        }
    }
    const mappedLinks: string[] = [];
    let dependencyBytes = 0;
    let dependencyEntries = 0;
    for (const dependency of dependencies) {
        const target = join(checkpointRoot, dependency.path);
        if (dependencyBudget.materialize) await copyDependencies(dependency.installation, target);
        else await symlink(dependency.installation, target, process.platform === "win32" ? "junction" : "dir");
    }
    for (const path of mappedLinks) {
        if (!contained(checkpointRoot, await realpath(path))) throw new Error(`A copied dependency escaped its checkpoint: ${path}`);
    }
    await writeFile(join(checkpointRoot, bridgeName), prototypePreviewBridgeSource, { flag: "wx" });
    await writeFile(join(checkpointRoot, completionMarker), JSON.stringify({ ...expected, complete: true }), { flag: "wx" });

    async function inspect(directory: string): Promise<void> {
        await assertDirectory(join(sourceRoot, directory));
        for (const entry of await readdir(join(sourceRoot, directory), { withFileTypes: true })) {
            if (++entries > maxSourceEntries) throw new Error("Prototype source exceeds 50000 entries; checkpoint preserved. Select a smaller source.");
            const path = join(directory, entry.name);
            if (!priorCheckpoint && identity(join(sourceRoot, path)) === identity(storageRoot)) continue;
            if (ignoredDirectories.has(entry.name) || isPrivateFile(entry.name) ||
                (!directory && entry.isDirectory() && generatedDirectories.has(entry.name))) continue;
            if (entry.isDirectory() && entry.name !== "node_modules" &&
                await isPrototypeRuntimeDirectory(join(sourceRoot, path))) continue;
            if (!directory && reservedFiles.has(entry.name)) {
                if (priorCheckpoint) continue;
                throw new Error(`Prototype source uses a reserved preparation filename: ${entry.name}. Source was not modified.`);
            }
            if (entry.name === "node_modules") {
                const installation = await checkDependencies(join(sourceRoot, path), projectRoot, storageRoot,
                    dependencyBudget, visitedDependencies, mappedDependencyTarget);
                dependencies.push({ path, installation });
                continue;
            }
            if (entry.isSymbolicLink()) throw new Error(`Unsupported source symlink/junction: ${join(sourceRoot, path)}. Source links are never followed.`);
            if (entry.isDirectory()) {
                directories.push(path);
                await inspect(path);
            } else if (entry.isFile()) {
                const info = await lstat(join(sourceRoot, path));
                bytes += info.size;
                if (files.length >= maxSourceFiles || bytes > maxSourceBytes) {
                    throw new Error("Prototype source exceeds the 20000-file / 256 MiB copy limit; partial checkpoint preserved.");
                }
                files.push({ path, size: info.size, mtimeMs: info.mtimeMs });
            } else {
                throw new Error(`Unsupported prototype source entry: ${join(sourceRoot, path)}`);
            }
        }
    }

    function mappedDependencyTarget(target: string): string | null {
        if (contained(storageRoot, target)) {
            const parts = relative(storageRoot, target).split(sep);
            const owner = join(storageRoot, ...parts.slice(0, 4));
            const effort = relative(storageRoot, checkpointRoot).split(sep)[1];
            if (isCheckpoint(storageRoot, owner) && parts[1] === effort) {
                return join(checkpointRoot, ...parts.slice(4));
            }
            return null;
        }
        if (contained(projectRoot, target)) return join(checkpointRoot, relative(projectRoot, target));
        return null;
    }

    async function copyDependencies(source: string, target: string): Promise<void> {
        await assertDirectory(source);
        await mkdir(target);
        for (const entry of await readdir(source, { withFileTypes: true })) {
            if (++dependencyEntries > maxDependencyEntries) throw new Error("Prototype dependency copy exceeds 200000 entries; partial checkpoint preserved.");
            const from = join(source, entry.name);
            const to = join(target, entry.name);
            if (entry.isSymbolicLink()) {
                const actual = await realpath(from);
                const mapped = mappedDependencyTarget(actual);
                if (!mapped) throw new Error(`Unsupported external dependency link during copy: ${from}`);
                const metadata = await lstat(actual);
                if (!metadata.isDirectory() && !metadata.isFile()) throw new Error(`Unsupported dependency link target: ${from}`);
                await symlink(process.platform === "win32" ? mapped : relative(dirname(to), mapped), to,
                    metadata.isDirectory() ? process.platform === "win32" ? "junction" : "dir" : "file");
                mappedLinks.push(to);
            } else if (entry.isDirectory()) {
                await copyDependencies(from, to);
            } else if (entry.isFile()) {
                const before = await lstat(from);
                if (!before.isFile() || before.isSymbolicLink()) throw new Error(`Dependencies changed during checkpoint preparation: ${from}`);
                dependencyBytes += before.size;
                if (dependencyBytes > maxMaterializedDependencyBytes) throw new Error("Workspace dependencies exceed the 1 GiB local copy limit; partial checkpoint preserved.");
                await copyFile(from, to, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE);
                const after = await lstat(from);
                if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
                    throw new Error(`Dependencies changed during checkpoint preparation: ${from}`);
                }
            } else throw new Error(`Unsupported dependency entry during copy: ${from}`);
        }
    }
}
