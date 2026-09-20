import {
    build,
    context,
    transform,
    type BuildOptions,
    type Plugin,
} from "esbuild";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { buildSpeechWorker } from "./speech-worker-build.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionRoot = join(
    repositoryRoot,
    ".github",
    "extensions",
    "tandem",
);
const desktopRuntime = join(repositoryRoot, "dist", "desktop", "runtime");
const desktop = process.argv.includes("--desktop");
const clientEntry = join(repositoryRoot, "src", "renderer", "client.ts");
const stylesEntry = join(repositoryRoot, "src", "renderer", "styles.css");
const packageMetadata = JSON.parse(
    await readFile(join(repositoryRoot, "package.json"), "utf8"),
);
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
for (const name of ["@azure/identity", "microsoft-cognitiveservices-speech-sdk"]) {
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
        buildApi.onResolve({ filter: /^tandem:client$/ }, () => ({
            path: "client.ts",
            namespace: "tandem-client",
        }));
        buildApi.onResolve({ filter: /^tandem:styles$/ }, () => ({
            path: "styles.css",
            namespace: "tandem-styles",
        }));
        buildApi.onLoad(
            { filter: /.*/, namespace: "tandem-client" },
            async () => {
                const compiled = await build({
                    entryPoints: [clientEntry],
                    bundle: true,
                    write: false,
                    metafile: true,
                    platform: "browser",
                    target: "es2020",
                    format: "iife",
                    minify: true,
                    legalComments: "inline",
                });
                return {
                    contents: `export default ${JSON.stringify(compiled.outputFiles[0].text)};`,
                    loader: "js",
                    watchFiles: Object.keys(compiled.metafile.inputs).map((path) => resolve(path)),
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
    },
};

const options: BuildOptions = {
    entryPoints: [join(repositoryRoot, "src", "extension.ts")],
    outfile: join(desktop ? desktopRuntime : extensionRoot, "extension.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    external: ["@github/copilot-sdk/*"],
    loader: { ".html": "text" },
    plugins: [rendererAssetsPlugin],
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
    if (desktop) {
        await build({
            entryPoints: [join(repositoryRoot, "src", "desktop", "host.ts")],
            outfile: join(desktopRuntime, "host.mjs"),
            bundle: true, platform: "node", format: "esm", target: "node22",
            external: ["@github/copilot-sdk", "@github/copilot-sdk/*"],
            banner: options.banner,
        });
        const skillDirectory = join(desktopRuntime, "skills", "tandem");
        await mkdir(skillDirectory, { recursive: true });
        await copyFile(join(repositoryRoot, "skills", "tandem", "SKILL.md"), join(skillDirectory, "SKILL.md"));
    }
}
