import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildUiDesignSkill } from "../src/planning-prompts.js";
import { sketchDocumentSchema } from "../src/sketch.js";
import { UI_DESIGN_SLOT } from "../src/ui-design.js";
import { CATALOG, OPERATION_SCHEMA, TOKEN_DEFINITIONS } from "../src/vendor/ui-dsl/index.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const target = join(root, "skills", "ui-design");
const check = process.argv.includes("--check");
const { version } = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const license = await readFile(join(root, "src", "vendor", "ui-dsl", "lucide-LICENSE"), "utf8");
const bundle = async (entry: string, platform: "node" | "browser") => (await build({
    absWorkingDir: root,
    entryPoints: [join(root, entry)], bundle: true, write: false, platform,
    format: platform === "browser" ? "iife" : "esm", target: platform === "browser" ? "es2023" : "node24",
    logLevel: "silent", legalComments: "inline",
    banner: { js: `/* UI design ${version} - generated from Tandem source. Bundled Lucide license:\n${license.replaceAll("*/", "* /")}\n*/` },
})).outputFiles[0].text;
const [helper, viewer, css] = await Promise.all([
    bundle("src/ui-design-cli.ts", "node"), bundle("src/renderer/ui-design-preview.ts", "browser"),
    readFile(join(root, "src", "renderer", "ui-design-preview.css"), "utf8").then(text => text.replaceAll("\r\n", "\n")),
]);
const template = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'">
<title>UI design preview</title><style>${css}</style></head>
<body><p id="error" role="alert" hidden></p><main id="preview"></main>
<noscript>This preview needs browser JavaScript. No rendered review is available.</noscript>
<script id="ui-design-data" type="application/json">${UI_DESIGN_SLOT}</script>
<script>${viewer.replace(/<\/script/gi, "<\\/script")}</script></body></html>
`;
const reference = `# UI design authoring

Generated from the production DSL and screen contracts. Users do not need to
author these files themselves; the agent uses ordinary temporary files.

Source reference IDs identify actual brief statements or supplied requirements.
Keep their meaning/attribution in chat and screen purpose/notes, not invented
answers. Screen IDs and source IDs are distinct.

## Operations

Outline uses upsert-screen for ALL screens first, then upsert-transition,
then {"op":"done"}. Screen metadata has id, title, purpose, decisionIds, width,
height and notes; do not include ui.

Content uses {"op":"ui","screenId":"home","edit":{...DSL operation...}}
and optional screen-status processing/ready, followed by {"op":"done"}.
It cannot change the outlined map. Every screen must have meaningful content.

Revision additionally supports upsert-screen, upsert-transition,
{"op":"remove-screen","screenId":"id"} and
{"op":"remove-transition","transitionId":"id"}. Patch existing IDs, never
rebuild unrelated nodes. Remove obsolete navigation actions when removing edges.

Button.action and Link.destination name exact outgoing transition IDs, not
URLs or executable handlers. Unlinked actions have no business behavior.
Components accept their own declared props, not arbitrary CSS/HTML.
Unknown icons fail validation; omit decoration rather than guess.

## DSL operations

\`\`\`json
${JSON.stringify(OPERATION_SCHEMA, null, 2)}
\`\`\`

## Component catalog

\`\`\`json
${JSON.stringify(CATALOG, null, 2)}
\`\`\`

## Tokens

\`\`\`json
${JSON.stringify(TOKEN_DEFINITIONS, null, 2)}
\`\`\`

## Existing multi-screen document

\`\`\`json
${JSON.stringify(sketchDocumentSchema, null, 2)}
\`\`\`
`;
const outputs: Record<string, string> = {
    "SKILL.md": buildUiDesignSkill(), "ui-design.mjs": helper, "preview.html": template,
    "references/authoring.md": reference,
    "references/ui-dsl-source.json": await readFile(join(root, "src", "vendor", "ui-dsl", "source.json"), "utf8"),
    "LICENSE.txt": (await readFile(join(root, "LICENSE.txt"), "utf8")).replaceAll("\r\n", "\n"),
    "lucide-LICENSE": license,
};
for (const [relative, content] of Object.entries(outputs)) {
    const path = join(target, relative);
    if (check) {
        if (await readFile(path, "utf8") !== content) throw new Error(`UI design ${relative} is stale. Run npm run build:ui-design.`);
    } else {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, content);
    }
}
console.log(`UI design ${version}: ${check ? "verified" : "generated"} standalone instructions and offline preview.`);
