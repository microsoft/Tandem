import { createHash } from "node:crypto";
import script from "tandem:browser-client";
import styles from "tandem:browser-styles";
import { readBrowserDevelopmentAssets } from "./development-assets.js";

// HTML normalizes line endings before the browser hashes inline script text.
function createAssets(script: string, styles: string, revision?: string) {
    const source = script.replace(/\r\n?/g, "\n").replace(/<\/script/gi, "<\\/script");
    const scriptHash = `sha256-${createHash("sha256").update(source).digest("base64")}`;
    const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
${revision ? `<meta name="tandem-development-revision" content="${revision}">` : ""}
<title>Tandem standalone</title><link rel="icon" href="data:,"><style>${styles}</style></head>
<body><div id="root"></div><noscript>Tandem requires JavaScript to display the workspace.</noscript>
<script>${source}</script></body></html>`;
    return { page, scriptHash };
}

export const { page, scriptHash } = createAssets(script, styles);
let development: { revision: string; assets: ReturnType<typeof createAssets> } | undefined;

export function getBrowserAssets() {
    const current = readBrowserDevelopmentAssets();
    if (!current) return { page, scriptHash };
    if (!development || development.revision !== current.revision) {
        development = { revision: current.revision, assets: createAssets(current.browser.script, current.browser.styles, current.revision) };
    }
    return development.assets;
}
