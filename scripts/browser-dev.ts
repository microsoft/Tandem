import { context, type BuildContext, type Plugin } from "esbuild";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, readdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { BrowserDevelopmentAssets } from "../src/browser/development-assets.js";
import { errorMessage, redactDiagnostic } from "../src/browser/local-state.js";
import { createProcessTree } from "../src/browser/process-tree.js";
import { writeJsonAtomically } from "../src/project-store.js";
import { createRendererAssetsPlugin, type RendererAssetName } from "./renderer-assets.js";

export async function watchBrowserAssets(repositoryRoot: string, assetsPath: string): Promise<BuildContext> {
    const assets = new Map<RendererAssetName, string>();
    const publicDirectory = join(repositoryRoot, "development", "tandem", "public");
    const dslNotice = `/* Chat UI DSL bundled Lucide icons\n${(await readFile(
        join(repositoryRoot, "src", "vendor", "ui-dsl", "lucide-LICENSE"), "utf8")).replaceAll("*/", "* /")}\n*/`;
    let ready!: () => void;
    let failed!: (error: Error) => void;
    const firstBuild = new Promise<void>((resolveBuild, rejectBuild) => { ready = resolveBuild; failed = rejectBuild; });
    const developmentPlugin: Plugin = {
        name: "tandem-browser-development",
        setup(api) {
            api.onResolve({ filter: /^tandem:development-public$/ }, () => ({ path: publicDirectory, namespace: "tandem-development-public" }));
            api.onLoad({ filter: /.*/, namespace: "tandem-development-public" }, async () => {
                const entries = await readdir(publicDirectory, { recursive: true, withFileTypes: true });
                return {
                    contents: "export {};",
                    loader: "js",
                    watchFiles: entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name)),
                    watchDirs: [publicDirectory, ...entries.filter((entry) => entry.isDirectory()).map((entry) => join(entry.parentPath, entry.name))],
                };
            });
            api.onEnd(async (result) => {
                if (result.errors.length) { failed(new Error("The frontend build failed. See the build errors above.")); return; }
                try {
                    const asset = (name: RendererAssetName) => {
                        const value = assets.get(name);
                        if (value === undefined) throw new Error(`The development build did not produce ${name}.`);
                        return value;
                    };
                    const payload: BrowserDevelopmentAssets = {
                        revision: randomUUID(), publicDirectory,
                        renderer: {
                            template: await readFile(join(repositoryRoot, "src", "renderer", "index.html"), "utf8"),
                            script: asset("client"), styles: asset("styles"),
                        },
                        browser: { script: asset("browser-client"), styles: asset("browser-styles") },
                    };
                    await writeJsonAtomically(assetsPath, payload);
                    console.info("Tandem frontend rebuilt. Connected development tabs will refresh.");
                    ready();
                } catch (error) {
                    failed(error instanceof Error ? error : new Error(String(error)));
                    throw error;
                }
            });
        },
    };
    const buildContext = await context({
        stdin: {
            contents: `
                import client from "tandem:client";
                import styles from "tandem:styles";
                import browserClient from "tandem:browser-client";
                import browserStyles from "tandem:browser-styles";
                import template from "./src/renderer/index.html";
                import "tandem:development-public";
                export {client, styles, browserClient, browserStyles, template};
            `,
            resolveDir: repositoryRoot,
        },
        bundle: true, write: false, format: "esm", platform: "node",
        loader: { ".html": "text" }, logLevel: "info",
        plugins: [createRendererAssetsPlugin(repositoryRoot, dslNotice, (name, content) => assets.set(name, content)), developmentPlugin],
    });
    try {
        await buildContext.watch();
        await firstBuild;
        return buildContext;
    } catch (error) {
        await buildContext.dispose();
        throw error;
    }
}

async function runNode(
    repositoryRoot: string,
    args: string[],
    signal: AbortSignal,
    environment: NodeJS.ProcessEnv = process.env,
    graceful = false,
): Promise<void> {
    signal.throwIfAborted();
    const tree = await createProcessTree();
    let child: ChildProcess | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cleanupError: unknown;
    const terminate = () => {
        try { tree.close(); }
        catch (error) {
            cleanupError = error;
            console.error(`Development process cleanup failed: ${redactDiagnostic(errorMessage(error))}`);
            child?.kill("SIGKILL");
        }
    };
    const stop = () => {
        if (graceful && child?.connected) {
            child.send("tandem:development:stop", (error) => {
                if (error && child?.exitCode === null) {
                    console.error(`Development shutdown request failed: ${redactDiagnostic(error.message)}`);
                    terminate();
                }
            });
            timer = setTimeout(() => {
                console.error("Development shutdown timed out; terminating only the owned process tree.");
                terminate();
            }, 45_000);
        } else terminate();
    };
    process.once("exit", terminate);
    try {
        child = spawn(process.execPath, args, {
            cwd: repositoryRoot, env: environment,
            stdio: graceful ? ["inherit", "inherit", "inherit", "ipc"] : "inherit",
            detached: process.platform !== "win32", windowsHide: true,
        });
        const completed = new Promise<number | null>((resolveExit, rejectExit) => {
            child!.once("error", rejectExit);
            child!.once("close", resolveExit);
        });
        try {
            if (child.pid) tree.assign(child.pid);
            signal.addEventListener("abort", stop, { once: true });
            if (signal.aborted) stop();
            const code = await completed;
            if (code !== 0 && !signal.aborted) throw new Error(`Development command exited with code ${code ?? "unknown"}.`);
        } catch (error) {
            child.kill("SIGKILL");
            await completed;
            throw error;
        }
    } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", stop);
        process.off("exit", terminate);
        terminate();
        if (cleanupError) throw cleanupError;
    }
}

async function main(): Promise<void> {
    const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const runtimeDirectory = join(repositoryRoot, "dist", "browser");
    const assetsPath = join(runtimeDirectory, "development", `${randomUUID()}.json`);
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    let watcher: BuildContext | undefined;
    try {
        await runNode(repositoryRoot, ["--import", "tsx", join(repositoryRoot, "scripts", "build.ts"), "--browser"], controller.signal);
        controller.signal.throwIfAborted();
        watcher = await watchBrowserAssets(repositoryRoot, assetsPath);
        console.info("Watching Preparation, Development and browser-shell frontend assets.\nSaves refresh the whole page; unsent UI input may be lost. Copilot runtimes keep running.\nBackend/runtime source changes require restarting this command.");
        await runNode(repositoryRoot, [join(runtimeDirectory, "cli.mjs"), ...process.argv.slice(2)], controller.signal,
            { ...process.env, TANDEM_BROWSER_DEV_ASSETS: assetsPath }, true);
    } catch (error) {
        if (!(controller.signal.aborted && error instanceof Error && error.name === "AbortError")) throw error;
    } finally {
        await watcher?.dispose();
        await rm(assetsPath, { force: true });
        process.off("SIGINT", stop);
        process.off("SIGTERM", stop);
    }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    void main().catch((error: unknown) => {
        console.error(redactDiagnostic(errorMessage(error)));
        process.exitCode = 1;
    });
}
