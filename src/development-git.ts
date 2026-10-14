import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readFile, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import lockfile from "proper-lockfile";
import { ProjectStoreError } from "./project-store.js";
import { readProjectEntry } from "./project-entry.js";
import { requireIgnoredApplicationState } from "../development/tandem/src/workflow-runtime-preconditions.mjs";
import { DEFAULT_POLICY } from "../development/tandem/runtime-src/domain/workflow/policy.js";

export interface DevelopmentGitPreflight {
    status: "ready" | "setup" | "blocked";
    projectPath: string;
    message: string;
    initialize: boolean;
    token?: string;
    repositoryRoot?: string;
}
const identity = (path: string) => process.platform === "win32" ? path.toLowerCase() : path;
const missing = (error: unknown) => error instanceof Error && "code" in error && error.code === "ENOENT";
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

// Match the runtime's isolated Git observation; inherited Git overrides must not retarget setup.
async function git(folder: string, args: string[]) {
    try {
        return await promisify(execFile)("git", ["--no-optional-locks", "-C", folder, "-c", "core.fsmonitor=false", ...args], {
            windowsHide: true, timeout: 15_000, maxBuffer: 4 * 1024 * 1024,
            env: { ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^GIT_/i.test(name))),
                LC_ALL: "C", LANG: "C", GIT_TERMINAL_PROMPT: "0" },
        });
    } catch (error) {
        if (missing(error)) throw new Error("Git is unavailable. Install Git or repair its executable path before continuing.", { cause: error });
        throw error;
    }
}
async function stat(path: string) {
    try { return await lstat(path); } catch (error) { if (missing(error)) return null; throw error; }
}
async function inspectPath(path: string, directory: boolean) {
    const value = await stat(path);
    if (value && (value.isSymbolicLink() || (directory ? !value.isDirectory() : !value.isFile() || value.nlink !== 1))) {
        throw new Error(`${path} is aliased or has an unsupported file type. Resolve it explicitly before continuing.`);
    }
    if (value && process.getuid && value.uid !== process.getuid()) {
        throw new Error(`${path} is owned by another user. No ownership or permissions were changed.`);
    }
    return value;
}
async function ignoreFile(folder: string) {
    const path = join(folder, ".gitignore");
    const info = await inspectPath(path, false);
    if (!info) return null;
    if (info.size > 1024 * 1024) throw new Error(".gitignore is too large for guided setup. Review its rules manually.");
    const bytes = await readFile(path);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (text.includes("\0")) throw new Error(".gitignore is not a supported UTF-8 text file. It was preserved.");
    return bytes;
}
async function inspect(folder: string) {
    const projectPath = resolve(folder);
    const canonical = await realpath(projectPath);
    if (canonical !== projectPath) throw new Error(`The selected folder is an alias. Open its real folder ${canonical} explicitly before setting up Development.`);
    const info = await inspectPath(projectPath, true);
    if (!info) throw new Error("The selected project folder no longer exists.");
    const folderIdentity = digest({ projectPath, dev: info.dev, ino: info.ino, birthtime: info.birthtimeMs });
    await inspectPath(join(projectPath, ".tandem"), true);
    const entry = await readProjectEntry(projectPath);
    const ignore = await ignoreFile(projectPath);
    let marker = false;
    for (let path = projectPath;; path = dirname(path)) {
        const metadata = await stat(join(path, ".git"));
        if (metadata) {
            if (metadata.isSymbolicLink() || (!metadata.isFile() && !metadata.isDirectory())) {
                throw new Error(`Git metadata at ${path} is aliased or unsupported. No nested repository was created.`);
            }
            marker = true;
        }
        // A damaged bare repository must not become a new ordinary repository.
        if (await stat(join(path, "HEAD")) && (await stat(join(path, "objects")) || await stat(join(path, "refs")))) marker = true;
        if (dirname(path) === path) break;
    }
    let initialize = false, repositoryRoot: string | undefined, gitDirectory = "";
    try {
        const kind = (await git(projectPath, ["rev-parse", "--is-inside-work-tree", "--is-bare-repository"])).stdout.trim();
        if (kind !== "true\nfalse") throw new Error("Development needs a non-bare Git working copy. Open a repository or worktree root explicitly.");
        repositoryRoot = (await git(projectPath, ["rev-parse", "--show-toplevel"])).stdout.trim();
        if (identity(await realpath(repositoryRoot)) !== identity(projectPath)) {
            return { view: { status: "blocked", projectPath, repositoryRoot, initialize: false,
                message: `This folder belongs to the repository at ${repositoryRoot}. Open that repository/worktree root as the project folder to continue. Tandem will not switch folders or create a nested repository.` } satisfies DevelopmentGitPreflight,
                fingerprint: "", folderIdentity, ignore };
        }
        gitDirectory = (await git(projectPath, ["rev-parse", "--absolute-git-dir"])).stdout.trim();
        await inspectPath(gitDirectory, true);
    } catch (error) {
        if (error instanceof Error && "code" in error && error.code === 128 && "stderr" in error
            && /^fatal: not a git repository \(or any of the parent directories\): \.git\s*$/.test(String(error.stderr)) && !marker) {
            initialize = true;
        } else throw error;
    }
    let ignored = false;
    if (!initialize) {
        try { await git(projectPath, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]); }
        catch (error) {
            if (!(error instanceof Error && "code" in error && error.code === 1)) throw error;
            const branch = (await git(projectPath, ["symbolic-ref", "--quiet", "HEAD"])).stdout.trim();
            let unborn = false;
            try { await git(projectPath, ["show-ref", "--verify", "--quiet", "--", branch]); }
            catch (failure) {
                if (failure instanceof Error && "code" in failure && failure.code === 1) unborn = true;
                else throw failure;
            }
            if (!unborn) throw new Error("Git HEAD is not a readable commit. Repair the repository before continuing.");
        }
        const tracked = await git(projectPath, ["ls-files", "--cached", "-z", "--", ".tandem"]);
        if (tracked.stdout) throw new Error("Git tracks files inside .tandem/. Deliberately untrack the application state yourself before continuing. Tandem will not untrack or delete files.");
        try { await git(projectPath, ["check-ignore", "--quiet", "--", ".tandem/"]); ignored = true; }
        catch (error) { if (!(error instanceof Error && "code" in error && error.code === 1)) throw error; }
        if (ignored) await requireIgnoredApplicationState({ repositoryRoot: projectPath, targetWorktreePath: projectPath, policy: DEFAULT_POLICY });
    }
    const view: DevelopmentGitPreflight = { status: ignored ? "ready" : "setup", projectPath, initialize,
        message: ignored ? "This Git working copy is ready for Development."
            : initialize ? "This folder is not in a Git repository. Set up this folder to create local Git metadata and add .tandem/ to .gitignore."
                : "This Git working copy needs a .tandem/ exclusion. Setup will preserve existing rules and add it to .gitignore." };
    const scope = digest({ folderIdentity, entry });
    const gitInfo = gitDirectory ? await stat(gitDirectory) : null;
    return { view, ignore, scope, folderIdentity, fingerprint: digest({ scope, gitDirectory,
        gitIdentity: gitInfo && [gitInfo.dev, gitInfo.ino, gitInfo.birthtimeMs], initialize,
        ignore: ignore?.toString("base64") ?? null }) };
}

/** Consent is ephemeral and bound to the observed folder, repository, choice and ignore bytes. */
export class DevelopmentGit {
    private readonly consents = new Map<string, { fingerprint: string; expires: number; work?: Promise<DevelopmentGitPreflight> }>();
    private folderIdentity: string | undefined;
    constructor(private readonly folder: string) {}
    private async observe() {
        const result = await inspect(this.folder);
        if (this.folderIdentity && result.folderIdentity !== this.folderIdentity) {
            throw new ProjectStoreError("changed_project_folder", "The selected folder's identity changed. Reopen the intended project folder explicitly before continuing.", 409);
        }
        this.folderIdentity ??= result.folderIdentity;
        return result;
    }
    async preflight(): Promise<DevelopmentGitPreflight> {
        try {
            const observed = await this.observe();
            if (observed.view.status !== "setup") return observed.view;
            for (const [token, consent] of this.consents) if (consent.expires < Date.now()) this.consents.delete(token);
            if (this.consents.size >= 64) this.consents.delete(this.consents.keys().next().value!);
            const token = randomUUID();
            this.consents.set(token, { fingerprint: observed.fingerprint, expires: Date.now() + 10 * 60_000 });
            return { ...observed.view, token };
        } catch (error) {
            return { status: "blocked", projectPath: resolve(this.folder), initialize: false,
                message: `Development could not verify this folder. ${missing(error) ? "The selected folder or its metadata is unavailable. Check the folder before continuing." : error instanceof Error ? error.message : String(error)} This check changed no files.` };
        }
    }
    async requireReady() {
        const result = await this.preflight();
        if (result.status !== "ready") throw new ProjectStoreError("development_git_required", result.message, 409);
    }
    async setup(token: unknown): Promise<DevelopmentGitPreflight> {
        const consent = typeof token === "string" ? this.consents.get(token) : undefined;
        if (!consent || consent.expires < Date.now()) throw new ProjectStoreError("stale_git_setup", "Check this folder again before authorizing setup.", 409);
        // Retransmission shares the same operation, including an honest partial-failure result.
        return consent.work ??= this.performSetup(consent.fingerprint);
    }
    private async performSetup(fingerprint: string): Promise<DevelopmentGitPreflight> {
        const before = await this.observe();
        if (before.fingerprint !== fingerprint || before.view.status !== "setup") {
            throw new ProjectStoreError("stale_git_setup", "The folder, Git metadata, starting choice or ignore rules changed. Check again before authorizing setup.", 409);
        }
        let compromised = false, initAttempted = false, initializedGit = false, ignoreAttempted = false, appendedIgnore = false;
        const assertOwned = () => { if (compromised) throw new Error("Git setup ownership was lost. Check the folder before retrying."); };
        const release = await lockfile.lock(this.folder, { realpath: false, lockfilePath: join(this.folder, ".tandem-git-setup.lock"),
            stale: 30_000, update: 5_000, retries: 0, onCompromised() { compromised = true; } });
        try {
            const current = await this.observe();
            if (current.fingerprint !== fingerprint) throw new Error("The folder changed while acquiring setup ownership. Check it again.");
            assertOwned();
            if (current.view.initialize) {
                initAttempted = true;
                // No template hooks, separate Git directory, remote, commit, or push.
                await git(this.folder, ["-c", "init.templateDir=", "init", "--template=", "--", this.folder]);
                initializedGit = true;
            }
            const initialized = await this.observe();
            if (initialized.view.initialize || initialized.view.status === "blocked") throw new Error(initialized.view.message);
            if (initialized.scope !== current.scope) throw new Error("The selected folder or starting choice changed during setup. Check it again.");
            if (!current.ignore?.equals(initialized.ignore ?? Buffer.alloc(0)) && (current.ignore !== null || initialized.ignore !== null)) {
                throw new Error("Ignore rules changed during setup. Existing content was preserved; check again.");
            }
            assertOwned();
            if (initialized.view.status !== "ready") {
                const path = join(this.folder, ".gitignore");
                const previous = initialized.ignore;
                const newline = previous?.includes(Buffer.from("\r\n")) ? "\r\n" : "\n";
                const addition = (previous?.length && previous.at(-1) !== 10 ? newline : "") + ".tandem/" + newline;
                const file = await open(path, previous === null ? "wx+" : constants.O_RDWR | constants.O_APPEND);
                if (previous === null) ignoreAttempted = true;
                try {
                    const actual = await file.readFile();
                    const opened = await file.stat(), named = await inspectPath(path, false);
                    if (!named || named.ino !== opened.ino || named.dev !== opened.dev || !actual.equals(previous ?? Buffer.alloc(0))) {
                        throw new Error(".gitignore changed before the write. Check again; no rules were replaced.");
                    }
                    assertOwned();
                    ignoreAttempted = true;
                    await file.writeFile(addition);
                    appendedIgnore = true;
                    await file.sync();
                } finally { await file.close(); }
            }
            assertOwned();
            await this.requireReady();
            return { status: "ready", projectPath: resolve(this.folder), initialize: false,
                message: "Local Git setup is ready. No commit, remote or push was created." };
        } catch (error) {
            throw new ProjectStoreError("git_setup_incomplete",
                `Setup did not finish. ${initializedGit ? "Local Git metadata was created and has been retained. "
                    : initAttempted ? "Local Git initialization was attempted; any Git metadata created has been retained. " : ""}${appendedIgnore
                    ? "The .tandem/ rule was appended to .gitignore and has been retained. "
                    : ignoreAttempted ? "The .gitignore write was attempted; inspect its retained content. " : ""}${error instanceof Error ? error.message : String(error)} Check again for a safe retry.`, 409);
        } finally { if (!compromised) await release(); }
    }
}
