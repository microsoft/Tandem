import { createHash } from "node:crypto";
import script from "tandem:browser-client";
import styles from "tandem:browser-styles";

// HTML normalizes line endings before the browser hashes inline script text.
const source = script.replace(/\r\n?/g, "\n").replace(/<\/script/gi, "<\\/script");
export const scriptHash = `sha256-${createHash("sha256").update(source).digest("base64")}`;
export const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tandem standalone</title><link rel="icon" href="data:,"><style>${styles}</style></head>
<body><div id="root"></div><noscript>Tandem requires JavaScript to display the workspace.</noscript>
<script>${source}</script></body></html>`;
