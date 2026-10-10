import {
    build,
    context,
    transform,
    type BuildOptions,
    type Plugin,
} from "esbuild";
import { copyFile, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { buildSpeechWorker } from "./speech-worker-build.js";
import { packageExtension } from "../stage2/tandem/scripts/package-extension.mjs";
import { createPayload } from "../src/payload.js";

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
const clientEntry = join(repositoryRoot, "src", "renderer", "main.tsx");
const stylesEntry = join(repositoryRoot, "src", "renderer", "styles.css");
const packageMetadata = JSON.parse(
    await readFile(join(repositoryRoot, "package.json"), "utf8"),
);
if (Number(process.versions.node.split(".")[0]) < 24 || process.versions.electron || process.versions.bun) {
    throw new Error("Tandem requires actual Node 24 or newer, including its preserved Stage 2 runtime.");
}
const targetRoot = desktop || browser ? runtimeDirectory : extensionRoot;
async function stageComposition() {
    const destination = join(targetRoot, "stage2");
    await mkdir(targetRoot, { recursive: true });
    await rm(destination, { recursive: true, force: true });
    const { manifest } = await packageExtension({ outputDirectory: destination, repositoryRoot: join(repositoryRoot, "stage2") });
    const skillDirectory = join(targetRoot, "skills", "tandem");
    await mkdir(skillDirectory, { recursive: true });
    await copyFile(join(repositoryRoot, "skills", "tandem", "SKILL.md"), join(skillDirectory, "SKILL.md"));
    await createPayload(targetRoot, packageMetadata.version, [
        "extension.mjs", "skills/tandem/SKILL.md", "stage2/manifest.json",
        ...manifest.files.map((file: { path: string }) => `stage2/${file.path}`),
    ]);
}
const compositionPlugin: Plugin = {
    name: "tandem-stage2-composition",
    setup(api) {
        api.onResolve({ filter: /stage2\/tandem\/src\/human-loop-controller\.mjs$/ }, () => ({
            path: "./stage2/src/human-loop-controller.mjs", external: true,
        }));
        api.onEnd(async result => { if (!result.errors.length) await stageComposition(); });
    },
};
const bundledNotices: string[] = [];
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
for (const name of ["@azure/identity", "microsoft-cognitiveservices-speech-sdk", "ws"]) {
    const packageRoot = dirname(createRequire(import.meta.url).resolve(`${name}/package.json`));
    const license = await readFile(join(packageRoot, "LICENSE"), "utf8");
    bundledNotices.push(`/* ${name}\n${license.replaceAll("*/", "* /")}\n*/`);
}

const rendererAssetsPlugin: Plugin = {
    name: "tandem-renderer-assets",
    setup(buildApi) {
        buildApi.onResolve({ filter: /^tandem:speech-worker$/ }, () => ({
            path: "speech-login-worker.ts",
            namespace: "tandem-speech-worker",
        }));
        buildApi.onLoad({ filter: /.*/, namespace: "tandem-speech-worker" }, async () => {
            const compiled = await buildSpeechWorker();
            return {
                contents: `export default ${JSON.stringify(compiled.outputFiles[0].text)};`,
                loader: "js",
                watchFiles: Object.keys(compiled.metafile.inputs).map((path) => resolve(path)),
            };
        });
        buildApi.onResolve({ filter: /^tandem:(?:client|browser-client)$/ }, (args) => ({
            path: args.path === "tandem:browser-client" ? "browser-main.tsx" : "main.tsx",
            namespace: "tandem-client",
        }));
        buildApi.onResolve({ filter: /^tandem:styles$/ }, () => ({
            path: "styles.css",
            namespace: "tandem-styles",
        }));
        buildApi.onLoad(
            { filter: /.*/, namespace: "tandem-client" },
            async (args) => {
                const compiled = await build({
                    entryPoints: [args.path === "browser-main.tsx" ? join(repositoryRoot, "src", "browser", "main.tsx") : clientEntry],
                    bundle: true,
                    write: false,
                    metafile: true,
                    platform: "browser",
                    loader: { ".png": "dataurl" },
                    target: "es2020",
                    format: "iife",
                    minify: true,
                    legalComments: "inline",
                    define: { "process.env.NODE_ENV": JSON.stringify("production") },
                });
                const rendererInputs = Object.keys(compiled.metafile.inputs).filter((input) => !input.startsWith("(disabled):"));
                const packageRoots = new Set(rendererInputs.flatMap((input) => {
                    const parts = resolve(input).split(sep);
                    const index = parts.lastIndexOf("node_modules");
                    return index < 0 ? [] : [parts.slice(0, index + (parts[index + 1].startsWith("@") ? 3 : 2)).join(sep)];
                }));
                const rendererPackages = await Promise.all([...packageRoots].sort().map(async (root) => ({
                    root, metadata: JSON.parse(await readFile(join(root, "package.json"), "utf8")),
                })));
                const uiDependencies = new Set(["react", "react-dom", "radix-ui", "lucide-react"]);
                let previousSize = 0;
                while (previousSize !== uiDependencies.size) {
                    previousSize = uiDependencies.size;
                    for (const { metadata } of rendererPackages) {
                        if (uiDependencies.has(metadata.name)) {
                            for (const name of Object.keys(metadata.dependencies || {})) uiDependencies.add(name);
                        }
                    }
                }
                const notices = await Promise.all(rendererPackages.filter(({ metadata }) => uiDependencies.has(metadata.name)).map(async ({ root, metadata }) => {
                    const files = await readdir(root);
                    const licenseFile = files.find((file) => /^licen[cs]e(?:\.(?:md|txt))?$/i.test(file));
                    // This release omits the upstream MIT license from its npm tarball.
                    const licensePath = licenseFile ? join(root, licenseFile)
                        : metadata.name === "react-remove-scroll-bar" && metadata.version === "2.3.8"
                            ? join(repositoryRoot, "scripts", "licenses", "react-remove-scroll-bar.txt") : null;
                    if (!licensePath) throw new Error(`Bundled renderer dependency ${root} has no license file.`);
                    const license = await readFile(licensePath, "utf8");
                    return `/* ${metadata.name} ${metadata.version}\n${license.replaceAll("*/", "* /")}\n*/`;
                }));
                return {
                    contents: `export default ${JSON.stringify(notices.join("\n") + "\n" + compiled.outputFiles[0].text)};`,
                    loader: "js",
                    watchFiles: rendererInputs.map((path) => resolve(path)),
                };
            },
        );
        buildApi.onLoad(
            { filter: /.*/, namespace: "tandem-styles" },
            async () => {
                const source = await readFile(stylesEntry, "utf8");
                const compiled = await transform(source, {
                    loader: "css",
                    minify: true,
                });
                return {
                    contents: `export default ${JSON.stringify(compiled.code)};`,
                    loader: "js",
                    watchFiles: [stylesEntry],
                };
            },
        );
        buildApi.onResolve({ filter: /^tandem:browser-styles$/ }, () => ({
            path: "browser-styles.css", namespace: "tandem-browser-styles",
        }));
        buildApi.onLoad({ filter: /.*/, namespace: "tandem-browser-styles" }, async () => {
            const compiled = await build({ entryPoints: [join(repositoryRoot, "src", "browser", "styles.css")], bundle: true, write: false, minify: true, metafile: true });
            return { contents: `export default ${JSON.stringify(compiled.outputFiles[0].text)};`, loader: "js",
                watchFiles: Object.keys(compiled.metafile.inputs).map((path) => resolve(path)) };
        });
    },
};

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
