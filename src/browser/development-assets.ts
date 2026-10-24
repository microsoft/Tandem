import { readFileSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { isRecord } from "./contracts.js";

export interface BrowserDevelopmentAssets {
    revision: string;
    publicDirectory: string;
    renderer: { template: string; script: string; styles: string };
    browser: { script: string; styles: string };
}

let cached: { path: string; signature: string; assets: BrowserDevelopmentAssets } | undefined;

export function readBrowserDevelopmentAssets(environment: NodeJS.ProcessEnv = process.env): BrowserDevelopmentAssets | undefined {
    const path = environment.TANDEM_BROWSER_DEV_ASSETS;
    if (path === undefined) return undefined;
    if (!isAbsolute(path)) throw new Error("TANDEM_BROWSER_DEV_ASSETS must name an absolute development assets file.");
    const info = statSync(path, { bigint: true });
    const signature = `${info.ino}:${info.mtimeNs}:${info.size}`;
    if (cached?.path === path && cached.signature === signature) return cached.assets;
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!isRecord(value) || typeof value.revision !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(value.revision)
        || typeof value.publicDirectory !== "string" || !isAbsolute(value.publicDirectory)
        || !isRecord(value.renderer) || typeof value.renderer.template !== "string"
        || typeof value.renderer.script !== "string" || typeof value.renderer.styles !== "string"
        || !isRecord(value.browser) || typeof value.browser.script !== "string" || typeof value.browser.styles !== "string") {
        throw new Error("The browser development assets file is invalid. Restart npm run dev:browser to rebuild it.");
    }
    const assets: BrowserDevelopmentAssets = {
        revision: value.revision, publicDirectory: value.publicDirectory,
        renderer: { template: value.renderer.template, script: value.renderer.script, styles: value.renderer.styles },
        browser: { script: value.browser.script, styles: value.browser.styles },
    };
    cached = { path, signature, assets };
    return assets;
}
