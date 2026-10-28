import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { copyFile, cp, mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ZipArchive } from "archiver";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const metadata = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { version: string };
const project = join(root, "src", "Tandem.Desktop", "Tandem.Desktop.csproj");
const output = join(root, "dist", "desktop");
const [operation, ...args] = process.argv.slice(2);

async function run(program: string, arguments_: string[], cwd = root): Promise<void> {
    await new Promise<void>((resolveRun, reject) => {
        const child = spawn(program, arguments_, { cwd, stdio: "inherit", windowsHide: true });
        child.once("error", reject);
        child.once("exit", (code, signal) => code === 0 ? resolveRun() : reject(new Error(`${program} failed (${signal || code}).`)));
    });
}

if (process.platform !== "win32") throw new Error("The Tandem Windows Forms host must be built and run on Windows.");
if (operation === "build") {
    await run("dotnet", ["build", project, "-c", "Release", "-o", output, `-p:Version=${metadata.version}`, "--nologo", "-v", "minimal"]);
} else if (operation === "run") {
    await run(join(output, "Tandem.Desktop.exe"), args);
} else if (operation === "check") {
    await run("dotnet", ["run", "--project", join(root, "src", "Tandem.Desktop", "Checks", "Tandem.Desktop.Checks.csproj"),
        "-c", "Release", `-p:Version=${metadata.version}`, "--no-launch-profile"]);
} else if (operation === "publish") {
    if (process.arch !== "x64") throw new Error("Build the Windows x64 distribution with an x64 Node installation.");
    const distribution = join(root, "dist", `tandem-${metadata.version}-windows-x64`);
    await run("dotnet", ["publish", project, "-c", "Release", "-r", "win-x64", "--self-contained", "true",
        "-o", distribution, `-p:Version=${metadata.version}`, "--nologo", "-v", "minimal"]);
    const runtime = join(distribution, "runtime");
    await mkdir(runtime, { recursive: true });
    await cp(join(output, "runtime"), runtime, { recursive: true });
    await copyFile(process.execPath, join(runtime, "node.exe"));
    await copyFile(join(dirname(process.execPath), "LICENSE"), join(runtime, "NODE-LICENSE.txt"));
    for (const file of ["package.json", "package-lock.json"]) {
        await copyFile(join(root, file), join(runtime, file));
    }
    // npm's JS entry point avoids cmd.exe interpolation of user-chosen checkout paths.
    const npmCli = process.env.npm_execpath;
    if (!npmCli) throw new Error("Run packaging through 'npm run pack:desktop' so the npm CLI can be located.");
    await run(process.execPath, [npmCli, "ci", "--omit=dev", "--no-audit", "--no-fund"], runtime);
    for (const file of ["README.md", "LICENSE.txt", "CONTRIBUTING.md", "CODE_OF_CONDUCT.md", "SECURITY.md", "SUPPORT.md"]) {
        await copyFile(join(root, file), join(distribution, file));
    }
    const path = `${distribution}.zip`;
    const stream = createWriteStream(path);
    const archive = new ZipArchive({ zlib: { level: 9 } });
    const completed = new Promise<void>((resolveZip, reject) => {
        stream.once("close", resolveZip);
        stream.once("error", reject);
        archive.once("error", reject);
    });
    archive.pipe(stream);
    archive.directory(distribution, false);
    await archive.finalize();
    await completed;
    console.info(`Created ${path}`);
} else {
    throw new Error("Expected build, run, check, or publish.");
}
