import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { check: { type: "boolean", default: false } } });
const root = new URL("../", import.meta.url);
const { version } = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
if (typeof version !== "string" || !version.trim()) throw new Error("The root package.json must declare the release version.");
const manifests = [
  "skills/brainstorm-whiteboard/.claude-plugin/plugin.json",
  "skills/brainstorm-whiteboard/.codex-plugin/plugin.json",
];
const entries = await Promise.all(manifests.map(async (path) => ({
  path, manifest: JSON.parse(await readFile(new URL(path, root), "utf8")),
})));
const stale = entries.filter(({ manifest }) => manifest.version !== version);
if (values.check && stale.length) {
  throw new Error(`Plugin versions differ from root package.json (${version}): ${stale.map(({ path }) => path).join(", ")}. Run node scripts/sync-skill-plugins.mjs.`);
}
for (const { path, manifest } of stale) {
  await writeFile(new URL(path, root), `${JSON.stringify({ ...manifest, version }, null, 2)}\n`);
}
console.log(`Skill plugin versions ${values.check ? "checked against" : "derived from"} root package.json: ${version}.`);
