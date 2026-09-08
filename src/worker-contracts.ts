import { createHash } from "node:crypto";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep, win32 } from "node:path";
import { ExecutionSourceChangedError, executionDigest } from "./execution.js";
import { ownershipContains, ownershipPath } from "./scheduling.js";

export interface WorkerContract {
    version: 1;
    id: string;
    itemId: string;
    inputRevision: string;
    ownedPaths: string[];
    skills: Array<{ name: string; path: string; hash: string; content: string }>;
    acceptedInputs: Array<{ id: string; hash: string }>;
    enforcement: "host-permissions-and-postflight";
}

const maxSkillBytes = 64 * 1024;
const maxWorkerSkillBytes = 128 * 1024;
const skillSlug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const sha256 = (content: string | Buffer) => createHash("sha256").update(content).digest("hex");
const portable = (path: string) => path.split(sep).join("/");
const comparable = (path: string) => process.platform === "win32" ? path.toLowerCase() : path;

// Matches fingerprintWorkspace's private exclusion policy; keep these lists in sync.
const ignoredSourceNames = new Set([".git", ".tandem", "node_modules", ".next", ".nuxt", ".cache"]);
const rootSourceOutputs = new Set(["dist", "build", "out", "coverage", "generated", "tandem-records"]);

function text(value: unknown, name: string): asserts value is string {
    if (typeof value !== "string" || !value.trim() || /[\0\r\n]/.test(value)) {
        throw new Error(`Invalid ${name}.`);
    }
}

function recordFields(value: unknown, keys: string[], name: string): asserts value is Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) ||
        Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) {
        throw new Error(`Invalid ${name}: expected exactly ${keys.join(", ")}.`);
    }
}

function accumulatedSkillBytes(total: number, content: string): number {
    const combined = total + Buffer.byteLength(content);
    if (combined > maxWorkerSkillBytes) throw new Error("Combined skill content exceeds the 128 KiB limit per worker.");
    return combined;
}

function nameOf(value: unknown): asserts value is string {
    if (typeof value !== "string" || value.length > 100 || !skillSlug.test(value) ||
        /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(value)) {
        throw new Error("Skill names must be simple lowercase slugs, not paths.");
    }
}

function isInside(root: string, path: string): boolean {
    const suffix = relative(root, path);
    return suffix !== ".." && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix);
}

function portableSkillPath(path: unknown, name: string): path is string {
    if (typeof path !== "string" || /[\0\r\n\\]/.test(path)) return false;
    const scope = /^(project:|user:|installed:\d+\/)/.exec(path)?.[0];
    if (!scope) return false;
    const suffix = path.slice(scope.length);
    return !suffix.includes(":") && suffix.split("/").every((part) => !!part && part !== "." && part !== "..") &&
        (suffix === `${name}/SKILL.md` || (scope === "project:" && suffix.endsWith(`/${name}/SKILL.md`)));
}

function rootsFor(workspaceRoot: string, skillRoots?: string[]) {
    const workspace = resolve(workspaceRoot);
    if (skillRoots) return skillRoots.map((root, index) => {
        const path = resolve(workspace, root);
        return { path, scope: isInside(workspace, path)
            ? `project:${portable(relative(workspace, path))}` : `installed:${index}` };
    });
    // The first installed match wins: project overrides bundled project skills, then user skills.
    return [
        { path: join(workspace, ".github", "skills"), scope: "project:.github/skills" },
        { path: join(workspace, "skills"), scope: "project:skills" },
        { path: join(process.env.COPILOT_HOME || join(homedir(), ".copilot"), "skills"), scope: "user:" },
    ];
}

async function skillAt(root: { path: string; scope: string }, name: string) {
    try {
        const rootStat = await lstat(root.path);
        if (rootStat.isSymbolicLink() || comparable(await realpath(root.path)) !== comparable(resolve(root.path))) {
            throw new Error(`Linked skill roots are not allowed (${root.scope}). Use materialized installed skills.`);
        }
        if (!rootStat.isDirectory()) throw new Error(`Skill root is not a directory (${root.scope}).`);
        const directory = join(root.path, name);
        const directoryStat = await lstat(directory);
        if (directoryStat.isSymbolicLink()) throw new Error(`Linked skill directory is not allowed: ${name}.`);
        if (!directoryStat.isDirectory()) throw new Error(`Skill is not a directory: ${name}.`);
        const path = join(directory, "SKILL.md");
        const stat = await lstat(path);
        if (stat.isSymbolicLink()) throw new Error(`Linked SKILL.md is not allowed: ${name}.`);
        if (!stat.isFile() || !isInside(root.path, await realpath(path))) {
            throw new Error(`Skill must be a regular file inside its installed root: ${name}.`);
        }
        if (stat.size > maxSkillBytes) throw new Error(`Skill ${name} exceeds the 64 KiB limit.`);
        const file = await open(path, "r");
        try {
            const before = await file.stat();
            if (!before.isFile() || before.dev !== stat.dev || before.ino !== stat.ino) {
                throw new Error(`Skill ${name} changed while being opened.`);
            }
            const buffer = Buffer.alloc(maxSkillBytes + 1);
            let size = 0;
            while (size < buffer.length) {
                const result = await file.read(buffer, size, buffer.length - size, size);
                if (!result.bytesRead) break;
                size += result.bytesRead;
            }
            const after = await file.stat();
            if (size > maxSkillBytes) throw new Error(`Skill ${name} exceeds the 64 KiB limit.`);
            if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || size !== after.size) {
                throw new Error(`Skill ${name} changed while being read; retry against its current contents.`);
            }
            const bytes = buffer.subarray(0, size);
            const content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
            return {
                name, path: `${root.scope}${root.scope.endsWith(":") ? "" : "/"}${name}/SKILL.md`,
                hash: sha256(bytes), content,
            };
        } finally {
            await file.close();
        }
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
    }
}

async function resolveSkill(name: string, workspaceRoot: string, skillRoots?: string[]) {
    nameOf(name);
    for (const root of rootsFor(workspaceRoot, skillRoots)) {
        const skill = await skillAt(root, name);
        if (skill) return skill;
    }
    throw new Error(`Installed skill "${name}" was not found. Install it in .github/skills, skills, or the Copilot user skills directory.`);
}

export async function buildWorkerContract(input: {
    workspaceRoot: string;
    item: { id: string; files: string[]; skills: string[] };
    inputRevision: string;
    acceptedInputs: Array<{ id: string; hash: string }>;
    skillRoots?: string[];
}): Promise<WorkerContract> {
    text(input.item.id, "work item ID");
    text(input.inputRevision, "input revision");
    const ownedPaths = [...new Set(Array.from(input.item.files, (path) => {
        text(path, "owned path");
        return ownershipPath(path);
    }))];
    const skills: WorkerContract["skills"] = [];
    let totalSkillBytes = 0;
    for (const name of [...new Set(input.item.skills)]) {
        const skill = await resolveSkill(name, input.workspaceRoot, input.skillRoots);
        totalSkillBytes = accumulatedSkillBytes(totalSkillBytes, skill.content);
        skills.push(skill);
    }
    const acceptedInputs = Array.from(input.acceptedInputs, ({ id, hash }) => {
        text(id, "accepted input ID");
        text(hash, "accepted input hash");
        return { id, hash };
    });
    if (new Set(acceptedInputs.map((input) => input.id)).size !== acceptedInputs.length) {
        throw new Error("Accepted input IDs must be unique.");
    }
    const body: Omit<WorkerContract, "id"> = {
        version: 1, itemId: input.item.id, inputRevision: input.inputRevision,
        ownedPaths, skills, acceptedInputs, enforcement: "host-permissions-and-postflight",
    };
    return { ...body, id: executionDigest(body) };
}

export function contractInstruction(contract: WorkerContract): string {
    return [
        `Worker contract ${contract.id} (version ${contract.version}) for ${JSON.stringify(contract.itemId)}.`,
        `Approved input revision: ${JSON.stringify(contract.inputRevision)}.`,
        `Owned paths (workspace-relative; empty means whole workspace): ${JSON.stringify(contract.ownedPaths)}.`,
        `Accepted input IDs and exact hashes: ${JSON.stringify(contract.acceptedInputs)}.`,
        "Only modify owned paths. Treat accepted inputs and other workers' files as read-only.",
        "Do not create git commits, push, publish, or deploy.",
        "Guard levels: host tool permissions are the execution boundary; these ownership and skill instructions are advisory.",
        "The host may check ownership, accepted-input hashes, and source changes after execution (postflight).",
        "Actual file changes are compared at a settled wave barrier against the union of wave-owned scopes, not attributed to individual workers in a shared workspace.",
        "This contract does not install per-worker tool hooks, grant tools, or create enforced filesystem/process isolation.",
        "Skill contents below are the exact installed instructions bound by this contract, not SDK skill options.",
        "Skill precedence: .github/skills, then bundled project skills, then Copilot user skills; explicit roots use their supplied order.",
        ...contract.skills.map((skill) => [
            `\nBEGIN INSTALLED SKILL ${JSON.stringify(skill.name)} (${skill.path}; SHA-256 ${skill.hash})`,
            skill.content,
            `END INSTALLED SKILL ${JSON.stringify(skill.name)}`,
        ].join("\n")),
        "Worker reports are claims, not tool-backed verification evidence. The host must run approved checks separately.",
    ].join("\n");
}

export async function assertContractSkillsCurrent(
    contract: WorkerContract, workspaceRoot: string, skillRoots?: string[],
): Promise<void> {
    normalizeWorkerContracts([contract]);
    for (const bound of contract.skills) {
        const current = await resolveSkill(bound.name, workspaceRoot, skillRoots);
        if (current.path !== bound.path || current.hash !== bound.hash) {
            throw new Error(`Installed skill "${bound.name}" changed since contract ${contract.id}; rebuild the contract before retrying.`);
        }
    }
}

/**
 * Hashes live files, including dirty/untracked bytes, at a settled wave barrier.
 * This traversal is not an atomic filesystem snapshot or an edit history.
 */
export async function captureWorkspaceFiles(root: string): Promise<Record<string, string>> {
    const workspace = resolve(root);
    const files = new Map<string, string>();
    const sourceNames = new Map<string, string>();
    async function materialized(path: string) {
        const metadata = await lstat(path);
        if (metadata.isSymbolicLink() || comparable(await realpath(path)) !== comparable(resolve(path))) {
            throw new Error(`Cannot capture linked source ${relative(workspace, path) || "."}; use materialized workspace sources.`);
        }
        return metadata;
    }
    if (!(await materialized(workspace)).isDirectory()) throw new Error("Workspace capture requires a directory.");
    async function visit(directory: string, prefix: string) {
        const entries = (await readdir(directory)).sort((a, b) => a.localeCompare(b));
        for (const entry of entries) {
            const name = entry.toLowerCase();
            if (ignoredSourceNames.has(name) || (!prefix && rootSourceOutputs.has(name)) || name.endsWith(".tsbuildinfo")) continue;
            const path = join(directory, entry);
            const relativePath = prefix ? win32.join(prefix, entry) : entry;
            const before = await materialized(path);
            if (before.isDirectory()) {
                await visit(path, relativePath);
            } else if (before.isFile()) {
                const file = await open(path, "r");
                try {
                    const opened = await file.stat();
                    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino ||
                        opened.size !== before.size || opened.mtimeMs !== before.mtimeMs ||
                        (process.platform !== "win32" && opened.ctimeMs !== before.ctimeMs)) {
                        throw new ExecutionSourceChangedError();
                    }
                    const hash = createHash("sha256");
                    for await (const chunk of file.createReadStream({ autoClose: false })) hash.update(chunk);
                    const after = await materialized(path);
                    // Windows may flush a pending ctime update on open; fence reads against the opened handle.
                    if (!after.isFile() || opened.dev !== after.dev || opened.ino !== after.ino ||
                        opened.size !== after.size || opened.mtimeMs !== after.mtimeMs || opened.ctimeMs !== after.ctimeMs) {
                        throw new ExecutionSourceChangedError();
                    }
                    const normalized = ownershipPath(relativePath);
                    if (normalized !== "*" && sourceNames.has(normalized)) {
                        throw new Error(`Workspace paths are ambiguous under Windows ownership rules: ${sourceNames.get(normalized)} and ${relativePath}.`);
                    }
                    sourceNames.set(normalized, relativePath);
                    files.set(relativePath, hash.digest("hex"));
                } finally {
                    await file.close();
                }
            } else {
                throw new Error(`Cannot capture non-regular workspace source ${relativePath}.`);
            }
        }
    }
    await visit(workspace, "");
    return Object.fromEntries(files);
}

/** Returns actual added, modified, and deleted paths; snapshots preserve path spelling with Windows separators. */
export function changedWorkspacePaths(before: Record<string, string>, after: Record<string, string>): string[] {
    for (const snapshot of [before, after]) {
        if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) ||
            Object.values(snapshot).some((hash) => typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash))) {
            throw new Error("Workspace snapshots must map relative file paths to SHA-256 hashes.");
        }
    }
    return [...new Set([...Object.keys(before), ...Object.keys(after)])]
        .filter((path) => !Object.hasOwn(before, path) || !Object.hasOwn(after, path) || before[path] !== after[path])
        .sort();
}

/**
 * Call at a settled wave barrier with the union of wave-owned scopes (include "*" if any worker owns
 * the whole workspace). This is postflight detection, not OS isolation or individual-worker attribution.
 */
export function assertChangedPathsOwned(
    before: Record<string, string>, after: Record<string, string>, ownedPaths: string[],
): void {
    const scopes = Array.from(ownedPaths, (path) => {
        text(path, "wave owned path");
        return ownershipPath(path);
    });
    const unowned = changedWorkspacePaths(before, after).filter((path) => !ownershipContains(scopes, path));
    if (unowned.length) {
        throw new Error(`Postflight detected changes outside the wave-owned scopes: ${unowned.map((path) => JSON.stringify(path)).join(", ")}. Shared-workspace changes cannot be attributed to an individual worker.`);
    }
}

export function normalizeWorkerContracts(value: unknown): WorkerContract[] {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > 30) throw new Error("Stored worker contracts must be an array of at most 30 contracts.");
    return Array.from(value, (contract: unknown) => {
        recordFields(contract, ["version", "id", "itemId", "inputRevision", "ownedPaths", "skills", "acceptedInputs", "enforcement"],
            "stored worker contract");
        if (contract.version !== 1 || contract.enforcement !== "host-permissions-and-postflight" ||
            !Array.isArray(contract.skills) || !Array.isArray(contract.ownedPaths) || !Array.isArray(contract.acceptedInputs)) {
            throw new Error("Unsupported or malformed stored worker contract.");
        }
        text(contract.itemId, "contract work item ID");
        text(contract.inputRevision, "contract input revision");
        const ownedPaths = Array.from(contract.ownedPaths, (path: unknown) => {
            text(path, "contract owned path");
            if (ownershipPath(path) !== path) throw new Error("Stored contract ownership is not normalized.");
            return path;
        });
        let totalSkillBytes = 0;
        const skills = Array.from(contract.skills, (skill: unknown) => {
            recordFields(skill, ["name", "path", "hash", "content"], "stored skill");
            nameOf(skill.name);
            if (!portableSkillPath(skill.path, skill.name) || typeof skill.content !== "string" ||
                typeof skill.hash !== "string" || Buffer.byteLength(skill.content) > maxSkillBytes ||
                sha256(skill.content) !== skill.hash) {
                throw new Error("Stored skill path, content, or hash is invalid.");
            }
            totalSkillBytes = accumulatedSkillBytes(totalSkillBytes, skill.content);
            return { name: skill.name, path: skill.path, hash: skill.hash, content: skill.content };
        });
        const acceptedInputs = Array.from(contract.acceptedInputs, (input: unknown) => {
            recordFields(input, ["id", "hash"], "stored accepted input");
            text(input.id, "accepted input ID");
            text(input.hash, "accepted input hash");
            return { id: input.id, hash: input.hash };
        });
        if (new Set(skills.map((skill) => skill.name)).size !== skills.length ||
            new Set(acceptedInputs.map((input) => input.id)).size !== acceptedInputs.length) {
            throw new Error("Stored contract skills and accepted input IDs must be unique.");
        }
        const body: Omit<WorkerContract, "id"> = {
            version: 1, itemId: contract.itemId, inputRevision: contract.inputRevision,
            ownedPaths, skills, acceptedInputs, enforcement: "host-permissions-and-postflight",
        };
        if (typeof contract.id !== "string" || executionDigest(body) !== contract.id) {
            throw new Error("Stored worker contract hash does not match its contents.");
        }
        return { ...body, id: contract.id };
    });
}
