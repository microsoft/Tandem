#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { desktopRuntimeEnvironment } from "../desktop/environment.js";
import { page, scriptHash } from "./assets.js";
import { createBrowserHost } from "./server.js";
import { errorMessage, redactDiagnostic } from "./local-state.js";

declare const __TANDEM_VERSION__: string;

async function openBrowser(url: string): Promise<void> {
    const program = process.platform === "win32" ? join(process.env.SystemRoot || "C:\\Windows", "System32", "rundll32.exe")
        : process.platform === "darwin" ? "open" : "xdg-open";
    const args = process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
    await new Promise<void>((resolve, reject) => {
        const child = spawn(program, args, { shell: false, stdio: "ignore", windowsHide: true });
        const timer = setTimeout(() => reject(new Error("The browser launcher did not confirm opening within ten seconds.")), 10_000);
        timer.unref();
        child.unref();
        child.once("error", (error) => { clearTimeout(timer); reject(error); });
        child.once("exit", (code) => {
            clearTimeout(timer);
            if (code === 0) resolve();
            else reject(new Error(`Browser launcher exited with code ${code}.`));
        });
    });
}

async function main(): Promise<void> {
    const { values, positionals } = parseArgs({
        options: { workspace: { type: "string" }, "no-open": { type: "boolean" },
            help: { type: "boolean", short: "h" }, version: { type: "boolean", short: "v" } },
        strict: true, allowPositionals: true,
    });
    if (values.help) {
        console.info("Tandem standalone\n\nUsage: tandem [--workspace <folder>] [--no-open]\n       tandem login\n\nUses the current directory when --workspace is omitted.\nClosing a tab keeps the backend running. Use Stop or Ctrl+C to exit.\nThe private launch URL grants host access; do not share it.");
        return;
    }
    if (values.version) { console.info(__TANDEM_VERSION__); return; }
    if (positionals.length) {
        if (positionals.length !== 1 || positionals[0] !== "login" || values.workspace || values["no-open"]) {
            throw new Error("Usage: tandem [--workspace <folder>] [--no-open], or tandem login.");
        }
        const cli = createRequire(import.meta.url).resolve("@github/copilot/npm-loader.js");
        await new Promise<void>((resolve, reject) => {
            const child = spawn(process.execPath, [cli, "login"], { stdio: "inherit", env: desktopRuntimeEnvironment() });
            child.once("error", reject);
            child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Copilot sign-in exited with code ${code}.`)));
        });
        return;
    }
    const host = await createBrowserHost({
        runtimeDirectory: dirname(fileURLToPath(import.meta.url)), version: __TANDEM_VERSION__,
        workspace: resolve(values.workspace || process.cwd()), initialDirectory: process.cwd(), page, scriptHash,
    });
    const stop = () => { void host.close().catch((error: unknown) => {
        process.exitCode = 1;
        console.error(redactDiagnostic(errorMessage(error)));
    }); };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    try {
        console.info(`Tandem ${__TANDEM_VERSION__}\nOpen this private local URL:\n${host.launchUrl}\n\nKeep this terminal open. Use Stop in Tandem or Ctrl+C to exit.`);
        host.start();
        if (!values["no-open"]) {
            void openBrowser(host.launchUrl).catch((error: unknown) => {
                const message = `Could not open the browser. Use the private URL printed in this terminal. ${redactDiagnostic(errorMessage(error))}`;
                host.report(message);
                console.error(message);
            });
        }
        await host.finished;
    } finally {
        process.off("SIGINT", stop);
        process.off("SIGTERM", stop);
    }
}

void main().catch((error: unknown) => {
    console.error(redactDiagnostic(errorMessage(error)));
    process.exitCode = 1;
});
