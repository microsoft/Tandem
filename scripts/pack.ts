import { ZipArchive } from "archiver";
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionRoot = join(
    repositoryRoot,
    ".github",
    "extensions",
    "tandem",
);
const outputDirectory = join(repositoryRoot, "dist");
const outputPath = join(outputDirectory, "tandem-extension.zip");

await mkdir(outputDirectory, { recursive: true });
await rm(outputPath, { force: true });

const output = createWriteStream(outputPath);
const archive = new ZipArchive({ zlib: { level: 9 } });
const completed = new Promise<void>((resolveArchive, rejectArchive) => {
    output.on("close", resolveArchive);
    output.on("error", rejectArchive);
    archive.on("error", rejectArchive);
});

archive.pipe(output);
archive.file(join(extensionRoot, "copilot-extension.json"), {
    name: "extensions/tandem/copilot-extension.json",
});
archive.file(join(extensionRoot, "extension.mjs"), {
    name: "extensions/tandem/extension.mjs",
});
archive.file(join(extensionRoot, "payload.json"), { name: "extensions/tandem/payload.json" });
archive.directory(join(extensionRoot, "stage2"), "extensions/tandem/stage2");
archive.directory(join(extensionRoot, "skills"), "extensions/tandem/skills");
archive.file(join(repositoryRoot, "README.md"), {
    name: "extensions/tandem/README.md",
});
archive.file(join(repositoryRoot, "skills", "tandem", "SKILL.md"), {
    name: "skills/tandem/SKILL.md",
});
archive.glob("src/**/*", { cwd: repositoryRoot, ignore: ["**/bin/**", "**/obj/**"] }, { prefix: "source" });
archive.glob("scripts/**/*", { cwd: repositoryRoot }, { prefix: "source" });
archive.glob("stage2/**/*", { cwd: repositoryRoot, ignore: ["**/node_modules/**", "**/.tandem/**"] }, { prefix: "source" });
archive.glob("tests/**/*", { cwd: repositoryRoot }, { prefix: "source" });
for (const fileName of [
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "tsconfig.core.json",
]) {
    archive.file(join(repositoryRoot, fileName), {
        name: `source/${fileName}`,
    });
}
archive.file(join(repositoryRoot, "README.md"), { name: "README.md" });
await archive.finalize();
await completed;

console.info(`Created ${outputPath}`);
