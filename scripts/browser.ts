import { spawn } from "node:child_process";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "dist", "browser");
const [operation, ...args] = process.argv.slice(2);
const metadata = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {
    version: string; dependencies: Record<string, string>;
};

async function run(program: string, args: string[], cwd = root): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        const child = spawn(program, args, { cwd, stdio: "inherit", shell: false });
        child.once("error", reject);
        child.once("exit", (code, signal) => code === 0 ? resolve() : reject(new Error(`Standalone command failed (${signal || code}).`)));
    });
}

if (operation === "run") {
    await run(process.execPath, [join(output, "cli.mjs"), ...args]);
} else if (operation === "pack") {
    const npm = process.env.npm_execpath;
    if (!npm) throw new Error("Run distribution packaging through npm run pack:browser.");
    await writeFile(join(output, "package.json"), `${JSON.stringify({
        name: "@tandem/standalone", version: metadata.version, description: "Tandem standalone local browser app",
        type: "module", license: "MIT", engines: { node: ">=24.0.0" }, bin: { tandem: "cli.mjs" },
        files: ["cli.mjs", "host.mjs", "extension.mjs", "payload.json", "stage2", "skills", "README.md", "LICENSE"],
        dependencies: metadata.dependencies,
    }, null, 2)}\n`);
    await copyFile(join(root, "README.md"), join(output, "README.md"));
    await copyFile(join(root, "LICENSE"), join(output, "LICENSE"));
    await run(process.execPath, [npm, "pack", "--ignore-scripts", "--pack-destination", join(root, "dist")], output);
    console.info(`Launch locally:\nnpx --yes --package "${join(root, "dist", `tandem-standalone-${metadata.version}.tgz`)}" tandem --workspace "<workspace-folder>"`);
} else {
    throw new Error("Expected run or pack.");
}
