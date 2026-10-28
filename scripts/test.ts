import { spawn } from "node:child_process";
import { readFile, access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const inventory = await readFile(join(root, "tests", "index.test.ts"), "utf8");
const suites = inventory.trim().split(/\r?\n/).map(line => {
    const match = /^import "\.\/([a-z0-9.-]+\.test\.(?:js|mjs))";$/.exec(line);
    if (!match) throw new Error(`Unrecognized root test inventory entry: ${line}`);
    return join(root, "tests", match[1].replace(/\.js$/, ".ts"));
});
const files = [...suites, ...[
    "execution-panels-react.test.tsx", "requirements-panel.test.ts", "review-process-panels.test.tsx",
    "sketch-panel.test.tsx", "browser-ui.test.ts", "ui-primitives.test.ts", "ui-consistency.test.ts",
].map(name => join(root, "tests", name))];
if (new Set(files).size !== files.length) throw new Error("The root test inventory contains duplicate entry files.");
await Promise.all(files.map(file => access(file)));
// Isolate the inventory's suites instead of accumulating every JSDOM in index's process.
const child = spawn(process.execPath, ["--import", "tsx", "--test", "--test-concurrency=2", ...process.argv.slice(2), ...files],
    { cwd: root, stdio: "inherit", shell: false });
child.on("error", error => { console.error(error); process.exitCode = 1; });
child.on("exit", (code, signal) => {
    if (signal) console.error(`Root test runner terminated by ${signal}.`);
    process.exitCode = code ?? 1;
});
