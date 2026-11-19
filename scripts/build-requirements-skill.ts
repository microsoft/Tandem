import { readFile, writeFile } from "node:fs/promises";
import { buildRequirementsSkill } from "../src/planning-prompts.js";

const skill = new URL("../skills/requirements/SKILL.md", import.meta.url);
const { version } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const content = buildRequirementsSkill();
if (process.argv.includes("--check")) {
    if (await readFile(skill, "utf8") !== content) throw new Error("Requirements SKILL.md is stale. Run npm run build:requirements.");
    console.log(`Requirements ${version}: canonical chat instructions verified.`);
} else {
    await writeFile(skill, content);
    console.log(`Requirements ${version}: static chat skill generated. Consumers need no build or runtime.`);
}
