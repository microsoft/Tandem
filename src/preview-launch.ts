import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { createServer } from "node:net";
import { fingerprintPrototypeWorkspace, PROTOTYPE_FINGERPRINT_PREFIX } from "./prototype-runtime.js";
import { fingerprintWorkspace } from "./execution.js";
import { readJsonFile, writeJsonAtomically } from "./project-store.js";
import { ensureMaterializedDirectories, readRetainedFile } from "./accepted-artifacts.js";
import type { TandemState } from "./types.js";
import { prototypePreviewCheckpointId, type PrototypePreviewTarget } from "./prototype-flow.js";
import {
    discoverPreviewStarts, insidePreviewPath, materialized, samePreviewPath, verifyPreviewStart,
    type PreviewStartChoice,
} from "./preview-start.js";
export { materialized } from "./preview-start.js";

export type PreviewTarget = PrototypePreviewTarget;
export interface PreviewLaunchBinding {
    prototypeId: string;
    generation: string;
    checkpointId: string;
    target: PreviewTarget;
    url: string;
    cwd: string;
    sourceFingerprint: string;
    mainSessionId: string;
}
export interface PreviewLaunchRecipe extends PreviewLaunchBinding {
    version: 1;
    executable: string;
    executableHash: string;
    args: string[];
    workingDirectory?: string;
}
export const launchDigest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const missing = (error: unknown) => error instanceof Error && "code" in error && error.code === "ENOENT";
export async function verifyLaunchRecipe(recipe: PreviewLaunchRecipe): Promise<void> {
    if (!recipe || ["prototypeId", "generation", "checkpointId", "mainSessionId", "url", "cwd", "sourceFingerprint", "executable", "executableHash"]
        .some(key => typeof Reflect.get(recipe, key) !== "string" || !Reflect.get(recipe, key))
        || Buffer.byteLength(JSON.stringify(recipe), "utf8") > 32768
        || recipe.version !== 1 || !isAbsolute(recipe.cwd) || !isAbsolute(recipe.executable) || !/^node(?:\.exe)?$/i.test(basename(recipe.executable)) || !Array.isArray(recipe.args)
        || recipe.args.length < 1 || recipe.args.length > 32 || recipe.args.some(arg => typeof arg !== "string" || arg.length > 4000 || arg.includes("\0"))
        || !isAbsolute(recipe.args[0]!) || !insidePreviewPath(recipe.cwd, recipe.args[0]!) || !/\.(?:mjs|cjs|js)$/i.test(recipe.args[0]!)
        || recipe.workingDirectory !== undefined && (typeof recipe.workingDirectory !== "string" || !isAbsolute(recipe.workingDirectory) ||
            !samePreviewPath(recipe.cwd, recipe.workingDirectory) && !insidePreviewPath(recipe.cwd, recipe.workingDirectory))) {
        throw new Error("A reviewed Node entrypoint and explicit argument list inside this checkpoint are required.");
    }
    await materialized(recipe.cwd, "directory");
    await materialized(recipe.executable, "file");
    await materialized(recipe.args[0]!, "file");
    if (recipe.workingDirectory) await materialized(recipe.workingDirectory, "directory");
    if (createHash("sha256").update(await readFile(recipe.executable)).digest("hex") !== recipe.executableHash) {
        throw new Error("The reviewed executable changed. Review a new launch recipe before restarting.");
    }
    const fingerprint = recipe.sourceFingerprint.startsWith(PROTOTYPE_FINGERPRINT_PREFIX)
        ? await fingerprintPrototypeWorkspace(recipe.cwd) : await fingerprintWorkspace(recipe.cwd);
    if (fingerprint !== recipe.sourceFingerprint) throw new Error("Saved checkpoint source changed. Restore its accepted source before restarting.");
    const url = new URL(recipe.url);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port) {
        throw new Error("Restart requires the saved explicit IPv4 loopback HTTP port; no URL or port is substituted.");
    }
}
export async function requireFreePreviewPort(url: string): Promise<void> {
    const address = new URL(url);
    const server = createServer();
    await new Promise<void>((done, reject) => {
        server.once("error", reject);
        server.listen({ host: "127.0.0.1", port: Number(address.port), exclusive: true }, () => {
            server.close(error => error ? reject(error) : done());
        });
    }).catch(error => { throw new Error(`The saved preview port is occupied or unavailable. No process was replaced: ${String(error)}`); });
}

interface NativeTools {
    execute(input: { name: string; arguments: Record<string, string | boolean>; toolCallId?: string }): Promise<unknown>;
}
export class PreviewLaunches {
    private proposals = new Map<string, { recipe: PreviewLaunchRecipe; expiresAt: number }>();
    private work = new Map<string, Promise<unknown>>();
    private shells = new Set<string>();
    private closed = false;
    constructor(private options: {
        root: string; storageRoot: string; mainSessionId: () => string; executable: string; launcher: string;
        tools: NativeTools; verifyIdentity(url: string, prototypeId: string, checkpointId: string): Promise<void>;
        readState(prototypeId: string): Promise<TandemState>;
        guard(): Promise<void>;
    }) {}
    async binding(state: TandemState, target: PreviewTarget): Promise<PreviewLaunchBinding> {
        if (!["current", "pending", "exploration"].includes(target)) throw new Error("Choose the current, pending or visual exploration saved version.");
        const flow = state.prototypeFlow;
        const id = prototypePreviewCheckpointId(flow, target);
        const checkpoint = flow?.checkpoints.find(item => item.id === id);
        if (!checkpoint || checkpoint.status !== "ready" || !checkpoint.previewUrl || !checkpoint.sourceFingerprint
            || checkpoint.generation !== state.generation) throw new Error("This saved version lacks a verified checkpoint/source identity. It cannot be restarted.");
        const expected = join(this.options.storageRoot, "efforts", state.prototypeId, "previews", checkpoint.requestId);
        if (!samePreviewPath(expected, checkpoint.workspacePath)) throw new Error("The checkpoint is not in its exact project-owned saved workspace.");
        await materialized(checkpoint.workspacePath, "directory");
        return { prototypeId: state.prototypeId, generation: state.generation, checkpointId: checkpoint.id,
            target, url: checkpoint.previewUrl, cwd: checkpoint.workspacePath, sourceFingerprint: checkpoint.sourceFingerprint,
            mainSessionId: this.options.mainSessionId() };
    }
    private path(binding: PreviewLaunchBinding): string {
        return join(this.options.root, ".tandem", "preview-launches", launchDigest([binding.prototypeId, binding.generation, binding.checkpointId]) + ".json");
    }
    private async savedRecipe(binding: PreviewLaunchBinding): Promise<unknown> {
        const path = this.path(binding);
        try { await lstat(dirname(path)); } catch (error) { if (missing(error)) return undefined; throw error; }
        await ensureMaterializedDirectories(dirname(path));
        try { return JSON.parse((await readRetainedFile(path, 65536)).toString("utf8")); }
        catch (error) { if (missing(error)) return undefined; throw error; }
    }
    private async assertBinding(binding: PreviewLaunchBinding): Promise<void> {
        if (this.closed || launchDigest(await this.binding(await this.options.readState(binding.prototypeId), binding.target)) !== launchDigest(binding)) {
            throw new Error("Preview selection or ownership changed. Review the selected saved version again.");
        }
    }
    async inspect(state: TandemState, target: PreviewTarget, entrypoint?: string, args: string[] = [], workingDirectory = ".", choiceId?: string) {
        await this.options.guard();
        if (!/^node(?:\.exe)?$/i.test(basename(this.options.executable))) {
            throw new Error("Saved preview restart requires the verified Node host executable. Open this project with the supported Node browser/desktop host; no executable is guessed.");
        }
        const binding = await this.binding(state, target);
        const saved = await this.savedRecipe(binding);
        if (saved && (typeof saved !== "object" || !("recipe" in saved) || !saved.recipe || typeof saved.recipe !== "object"
            || !("mainSessionId" in saved.recipe) || saved.recipe.mainSessionId !== binding.mainSessionId)) {
            throw new Error("The retained launch record has invalid or different ownership. It was not replaced.");
        }
        let recipe: PreviewLaunchRecipe;
        let description = "Use the server file and options you selected.";
        let selected: PreviewStartChoice | undefined;
        if (choiceId !== undefined) {
            if (entrypoint !== undefined) throw new Error("Choose a detected start option or manual setup, not both.");
            const discovery = await discoverPreviewStarts(binding.cwd);
            selected = discovery.choices.find(choice => launchDigest([binding, choice]) === choiceId);
            if (!selected) throw new Error("That start option changed. Review the available choices again.");
            entrypoint = selected.entrypoint; args = selected.args; workingDirectory = selected.workingDirectory;
        }
        const checkpoint = state.prototypeFlow!.checkpoints.find(item => item.id === binding.checkpointId)!;
        if (entrypoint === undefined && !saved && checkpoint.previewStart) {
            const start = await verifyPreviewStart(binding.cwd, checkpoint.previewStart);
            entrypoint = start.entrypoint; args = start.args; workingDirectory = start.workingDirectory;
            description = "Start instructions were saved with this prototype. You do not need to choose a file.";
        }
        if (entrypoint !== undefined) {
            const start = await verifyPreviewStart(binding.cwd, { entrypoint, args, workingDirectory });
            const executable = resolve(this.options.executable);
            await materialized(executable, "file");
            recipe = { version: 1, ...binding, executable, executableHash: createHash("sha256").update(await readFile(executable)).digest("hex"),
                args: [resolve(binding.cwd, start.entrypoint), ...start.args], workingDirectory: resolve(binding.cwd, start.workingDirectory) };
            if (selected) description = selected.detail;
        } else if (saved) {
            description = "Use the start instructions you previously reviewed.";
            if (typeof saved !== "object" || !("recipe" in saved) || !saved.recipe || typeof saved.recipe !== "object") {
                throw new Error("The recorded preview launch is invalid. It was preserved.");
            }
            recipe = saved.recipe as PreviewLaunchRecipe;
            const savedBinding = Object.fromEntries(Object.keys(binding).map(key => [key, Reflect.get(recipe, key)]));
            // Promotion changes the label from pending to current, not the underlying saved launch.
            savedBinding.target = target;
            if (launchDigest(savedBinding) !== launchDigest(binding)) throw new Error("The recorded launch belongs to different source or ownership. Review an explicit launch again.");
            recipe = { ...recipe, target };
        } else {
            const discovery = await discoverPreviewStarts(binding.cwd);
            return { needsRecipe: true, ...binding, executable: this.options.executable, entrypoints: discovery.entrypoints,
                choices: discovery.choices.map(choice => ({ ...choice, id: launchDigest([binding, choice]) })),
                notices: discovery.notices,
                message: discovery.choices.length ? "Choose how to start this saved preview. Your prototype and feedback will stay unchanged."
                    : "This older preview has no saved start instructions, and no supported start option was found. Nothing has been changed." };
        }
        await verifyLaunchRecipe(recipe);
        const confirmationId = randomUUID();
        this.proposals.set(confirmationId, { recipe, expiresAt: Date.now() + 300_000 });
        return { needsRecipe: false, confirmationId, ...binding, executable: recipe.executable, args: recipe.args,
            workingDirectory: recipe.workingDirectory ?? recipe.cwd,
            environment: { PORT: new URL(recipe.url).port },
            message: description + " This starts only the selected saved preview; it does not rebuild or apply changes." };
    }
    async decide(confirmationId: string, approve: boolean): Promise<unknown> {
        if (!approve) {
            this.proposals.delete(confirmationId);
            return { started: false, dismissed: true, previouslySubmitted: this.work.has(confirmationId) };
        }
        const existing = this.work.get(confirmationId);
        if (existing) return existing;
        const proposal = this.proposals.get(confirmationId);
        this.proposals.delete(confirmationId);
        if (!proposal || proposal.expiresAt < Date.now()) throw new Error("Preview restart confirmation expired or was consumed. Inspect again.");
        const key = launchDigest([proposal.recipe.prototypeId, proposal.recipe.checkpointId]);
        if (this.work.has(key)) throw new Error("This saved preview is already starting. Wait for its result.");
        const work = this.start(proposal.recipe, confirmationId);
        this.work.set(confirmationId, work); this.work.set(key, work);
        try { return await work; } finally { this.work.delete(key); }
    }
    private async start(recipe: PreviewLaunchRecipe, confirmationId: string) {
        const binding = await this.binding(await this.options.readState(recipe.prototypeId), recipe.target);
        await this.assertBinding(binding);
        if (Object.entries(binding).some(([key, value]) => Reflect.get(recipe, key) !== value)) throw new Error("The reviewed saved version changed.");
        await verifyLaunchRecipe(recipe);
        try {
            await this.options.verifyIdentity(recipe.url, recipe.prototypeId, recipe.checkpointId);
            return { started: false, alreadyRunning: true, ...binding };
        } catch (error) {
            if (!(error instanceof Error) || !("code" in error) || error.code !== "preview_unreachable") throw error;
        }
        await requireFreePreviewPort(recipe.url);
        await materialized(this.options.launcher, "file");
        // Native completion notifications can make the session busy after this launch.
        // Admission is checked before dispatch; readiness uses this launch's own evidence.
        await this.options.guard();
        await this.assertBinding(binding);
        const launchId = randomUUID(), shellId = `tandem-preview-${launchId}`;
        const manifest = { version: 1, launchId, confirmationId, recipe, requestedAt: new Date().toISOString() };
        const directory = join(dirname(this.path(binding)), "attempts", launchId);
        const path = join(directory, "launch.json"), receipt = join(directory, "process.json");
        await ensureMaterializedDirectories(directory, true);
        await writeJsonAtomically(this.path(binding), { version: 1, recipe, reviewedAt: manifest.requestedAt });
        await writeJsonAtomically(path, manifest);
        const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
        const command = `& ${quote(recipe.executable)} ${quote(this.options.launcher)} ${quote(path)} ${quote(launchDigest(manifest))}`;
        this.shells.add(shellId);
        try {
            const result = await this.options.tools.execute({ name: "powershell", toolCallId: launchId,
                arguments: { command, description: `Restart ${recipe.target} saved preview: ${recipe.checkpointId}`, mode: "async", shellId } });
            if (!result || typeof result !== "object" || !("resultType" in result) || result.resultType !== "success") {
                if (result && typeof result === "object" && "resultType" in result && result.resultType === "rejected") {
                    throw new Error("Native permission was denied. The saved preview was not started. Review a new restart attempt if you want to try again.");
                }
                const reason = result && typeof result === "object" && "error" in result && typeof result.error === "string" ? result.error.slice(0, 1000) : "The native tool did not confirm a launch.";
                throw new Error(`Saved preview could not start: ${reason}`);
            }
            for (let attempt = 0; attempt < 40; attempt++) {
                await this.assertBinding(binding);
                const result = await readJsonFile(receipt);
                if (result && typeof result === "object" && "status" in result) {
                    if (result.status === "failed" || result.status === "exited") throw new Error(`Saved preview did not remain running. ${"error" in result && typeof result.error === "string" ? result.error : "Inspect its recorded launch diagnostics."}`);
                    if (result.status === "running" && "launchId" in result && result.launchId === launchId) {
                        try {
                            await this.options.verifyIdentity(recipe.url, recipe.prototypeId, recipe.checkpointId);
                            await verifyLaunchRecipe(recipe);
                            return { started: true, shellId, launchId, ...binding };
                        } catch (error) {
                            if (!(error instanceof Error) || !("code" in error) || error.code !== "preview_unreachable") throw error;
                        }
                    }
                }
                await new Promise(resolve => setTimeout(resolve, 250));
            }
            throw new Error("The saved preview did not become identity-verified. Its owned launch was stopped; no other server was adopted.");
        } catch (error) {
            try { await this.stop(shellId); }
            catch (cleanupError) {
                throw new AggregateError([error, cleanupError],
                    `${error instanceof Error ? error.message : String(error)} Owned preview shutdown also failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
            }
            throw error;
        }
    }
    private async stop(shellId: string) {
        const stopped = await this.options.tools.execute({ name: "stop_powershell", arguments: { shellId } });
        if (!stopped || typeof stopped !== "object" || !("resultType" in stopped) || stopped.resultType !== "success") {
            throw new Error(`Owned preview shutdown could not be confirmed: ${JSON.stringify(stopped)}`);
        }
        this.shells.delete(shellId);
    }
    async close() {
        this.closed = true; this.proposals.clear();
        for (const shell of [...this.shells]) await this.stop(shell);
    }
}
