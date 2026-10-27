import {
    build,
    context,
    type BuildOptions,
    type Plugin,
} from "esbuild";
import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { packageExtension } from "../development/tandem/scripts/package-extension.mjs";
import { createPayload } from "../src/payload.js";
import { createRendererAssetsPlugin } from "./renderer-assets.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionRoot = join(
    repositoryRoot,
    ".github",
    "extensions",
    "tandem",
);
const desktopRuntime = join(repositoryRoot, "dist", "desktop", "runtime");
const desktop = process.argv.includes("--desktop");
const browser = process.argv.includes("--browser");
if (desktop && browser) throw new Error("Choose one standalone build target at a time.");
const runtimeDirectory = browser ? join(repositoryRoot, "dist", "browser") : desktopRuntime;
const packageMetadata = JSON.parse(
    await readFile(join(repositoryRoot, "package.json"), "utf8"),
);
if (Number(process.versions.node.split(".")[0]) < 24 || process.versions.electron || process.versions.bun) {
    throw new Error("Tandem requires actual Node 24 or newer, including its preserved Stage 2 runtime.");
}
const targetRoot = desktop || browser ? runtimeDirectory : extensionRoot;
async function stageComposition() {
    // Source lives in development/; stage2/ remains the installed payload contract.
    const destination = join(targetRoot, "stage2");
    await mkdir(targetRoot, { recursive: true });
    await rm(destination, { recursive: true, force: true });
    const { manifest } = await packageExtension({ outputDirectory: destination, repositoryRoot: join(repositoryRoot, "development") });
    const skillDirectory = join(targetRoot, "skills", "tandem");
    await mkdir(skillDirectory, { recursive: true });
    await copyFile(join(repositoryRoot, "skills", "tandem", "SKILL.md"), join(skillDirectory, "SKILL.md"));
    await build({ entryPoints: [join(repositoryRoot, "src", "preview-launcher.ts")],
        outfile: join(targetRoot, "preview-launcher.mjs"), bundle: true, platform: "node", format: "esm", target: "node24",
        banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' } });
    await createPayload(targetRoot, packageMetadata.version, [
        "extension.mjs", "preview-launcher.mjs", "skills/tandem/SKILL.md", "stage2/manifest.json",
        ...manifest.files.map((file: { path: string }) => `stage2/${file.path}`),
    ]);
}
const compositionPlugin: Plugin = {
    name: "tandem-stage2-composition",
    setup(api) {
        api.onResolve({ filter: /development\/tandem\/src\/human-loop-controller\.mjs$/ }, () => ({
            path: "./stage2/src/human-loop-controller.mjs", external: true,
        }));
        api.onEnd(async result => { if (!result.errors.length) await stageComposition(); });
    },
};
const bundledNotices: string[] = [];
const dslNotice = `/* Chat UI DSL bundled Lucide icons\n${(await readFile(
    join(repositoryRoot, "src", "vendor", "ui-dsl", "lucide-LICENSE"), "utf8")).replaceAll("*/", "* /")}\n*/`;
bundledNotices.push(dslNotice);
const dependencyRequire = createRequire(
    createRequire(import.meta.url).resolve("proper-lockfile/package.json"),
);
for (const [name, licenseFile] of [
    ["proper-lockfile", "LICENSE"],
    ["graceful-fs", "LICENSE"],
    ["retry", "License"],
    ["signal-exit", "LICENSE.txt"],
]) {
    const packageRoot = dirname(dependencyRequire.resolve(`${name}/package.json`));
    const license = await readFile(join(packageRoot, licenseFile), "utf8");
    bundledNotices.push(`/* ${name}\n${license.replaceAll("*/", "* /")}\n*/`);
}
const rendererAssetsPlugin = createRendererAssetsPlugin(repositoryRoot, dslNotice);

const options: BuildOptions = {
    entryPoints: [join(repositoryRoot, "src", "extension.ts")],
    outfile: join(desktop || browser ? runtimeDirectory : extensionRoot, "extension.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    external: ["@github/copilot-sdk/*"],
    loader: { ".html": "text" },
    plugins: [rendererAssetsPlugin, compositionPlugin],
    define: {
        __TANDEM_VERSION__: JSON.stringify(packageMetadata.version),
    },
    sourcemap: false,
    banner: {
        js: [
            "// Generated from the project-root src/ directory by npm run build. Do not edit directly.",
            ...bundledNotices,
            'import { createRequire as createBundledRequire } from "node:module";',
            "const require = createBundledRequire(import.meta.url);",
        ].join("\n"),
    },
};

if (process.argv.includes("--watch")) {
    const buildContext = await context(options);
    await buildContext.watch();
    console.info("Watching Tandem TypeScript sources...");
} else {
    await build(options);
    if (desktop || browser) {
        await build({
            entryPoints: [join(repositoryRoot, "src", "desktop", "host.ts")],
            outfile: join(runtimeDirectory, "host.mjs"),
            bundle: true, platform: "node", format: "esm", target: "node24",
            external: ["@github/copilot-sdk", "@github/copilot-sdk/*"],
            banner: options.banner,
        });
        await build({
            entryPoints: [join(repositoryRoot, "src", "desktop", "source-preview-extension.ts")],
            outfile: join(runtimeDirectory, "source-preview-extension.mjs"),
            bundle: true, platform: "node", format: "esm", target: "node24", banner: options.banner,
        });
        const skillDirectory = join(runtimeDirectory, "skills", "tandem");
        await mkdir(skillDirectory, { recursive: true });
        await copyFile(join(repositoryRoot, "skills", "tandem", "SKILL.md"), join(skillDirectory, "SKILL.md"));
        if (browser) {
            await build({
                entryPoints: [join(repositoryRoot, "src", "browser", "cli.ts")],
                outfile: join(runtimeDirectory, "cli.mjs"), bundle: true, platform: "node", format: "esm", target: "node24",
                external: ["@github/copilot-sdk", "@github/copilot-sdk/*", "@github/copilot/*", "koffi"],
                plugins: [rendererAssetsPlugin], define: { __TANDEM_VERSION__: JSON.stringify(packageMetadata.version) },
                banner: options.banner,
            });
        }
    }
}
