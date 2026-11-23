import { randomUUID } from "node:crypto";
import { lstat, open, readFile, rename, rm } from "node:fs/promises";
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import {
    createUiDesign, parseUiDesignHtml, patchUiDesign, readUiDesign, renderUiDesignHtml,
    uiDesignReadiness, uiDesignVersion, type UiDesignPreview,
} from "./ui-design.js";

const help = `UI design - transient current document and offline preview
  create --operations outline.ndjson --references refs.json --output preview.html
  load --document design.json --references refs.json --output preview.html
  read --preview preview.html
  update --preview preview.html --base <id:version> --operations edits.ndjson
         --phase content|revision [--references refs.json] [--recover-retained]

Use an ordinary host/session temporary output path. Open or refresh the same HTML
preview after updating. The output version is not proof of rendering or approval.
read returns the exact current/retained structured state; save it only on request.
No server, model, approval records, durable history or automatic export.`;

async function main() {
    if (Number(process.versions.node.split(".")[0]) < 24) throw new Error("The packaged helper requires Node 24+.");
    const { values, positionals } = parseArgs({
        allowPositionals: true, options: {
            operations: { type: "string" }, references: { type: "string" },
            output: { type: "string" }, preview: { type: "string" }, document: { type: "string" },
            base: { type: "string" }, phase: { type: "string" }, help: { type: "boolean" },
            "recover-retained": { type: "boolean" },
        },
    });
    if (values.help || positionals.length === 0) { console.log(help); return; }
    const command = positionals[0];
    const allowed: Record<string, string[]> = {
        create: ["operations", "references", "output"], load: ["document", "references", "output"],
        read: ["preview"], update: ["preview", "base", "operations", "phase", "references", "recover-retained"],
    };
    if (positionals.length !== 1 || !Object.hasOwn(allowed, command)
        || Object.keys(values).some(key => !allowed[command].includes(key))) throw new Error(help);
    const required = (key: keyof typeof values): string => {
        const value = values[key];
        if (typeof value !== "string" || !value.trim()) throw new Error(`Missing --${key}.\n${help}`);
        return value;
    };
    const json = async (path: string) => JSON.parse(await readFile(path, "utf8")) as unknown;
    let preview: UiDesignPreview;
    let original: string | null = null;
    const path = resolve(required(command === "read" || command === "update" ? "preview" : "output"));
    if (!path.endsWith(".html")) throw new Error("Use an explicit .html preview artifact path.");
    if (command === "read" || command === "update") {
        if (!(await lstat(path)).isFile()) throw new Error("The preview must be an ordinary file, not a redirected path.");
        original = await readFile(path, "utf8");
        preview = parseUiDesignHtml(original);
        if (command === "read") { console.log(JSON.stringify(preview, null, 2)); return; }
        const phase = required("phase");
        if (phase !== "content" && phase !== "revision") throw new Error("Use --phase content or revision.");
        const expected = required("base");
        const base = values["recover-retained"] ? preview.previous : preview.current;
        if (!base || uiDesignVersion(base) !== expected) {
            throw new Error(`Stale design. Read the current preview before editing (${uiDesignVersion(preview.current)}). Recovery must explicitly select the retained version.`);
        }
        const current = patchUiDesign(base, expected, await readFile(required("operations"), "utf8"), phase,
            values.references ? await json(values.references) : base.referenceIds);
        current.version = preview.current.version + 1;
        preview = { current, previous: base };
    } else {
        const referenceIds = await json(required("references"));
        const id = randomUUID().slice(0, 8);
        const current = command === "create"
            ? createUiDesign(id, referenceIds, await readFile(required("operations"), "utf8"))
            : readUiDesign({ id, version: 1, referenceIds, document: await json(required("document")) });
        preview = { current, previous: null };
    }
    const template = await readFile(new URL("./preview.html", import.meta.url), "utf8");
    const html = renderUiDesignHtml(template, preview);
    if (original === null) {
        const file = await open(path, "wx");
        try { await file.writeFile(html, "utf8"); } finally { await file.close(); }
    } else {
        const pending = `${path}.pending`;
        const file = await open(pending, "wx");
        try {
            await file.writeFile(html, "utf8");
            await file.close();
            if (await readFile(path, "utf8") !== original) throw new Error("The preview changed during this edit. Read it again.");
            await rename(pending, path);
        } finally {
            await file.close();
            await rm(pending, { force: true });
        }
    }
    console.log(JSON.stringify({
        path, version: uiDesignVersion(preview.current), issues: uiDesignReadiness(preview.current),
        next: "Refresh the same preview and inspect the displayed version. File generation is not visual review or confirmation.",
    }, null, 2));
}

main().catch(error => {
    console.error(`UI design: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
});
