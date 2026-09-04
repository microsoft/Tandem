import {
    build,
    context,
    transform,
    type BuildOptions,
    type Plugin,
} from "esbuild";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionRoot = join(
    repositoryRoot,
    ".github",
    "extensions",
    "tandem",
);
const clientEntry = join(repositoryRoot, "src", "renderer", "client.ts");
const stylesEntry = join(repositoryRoot, "src", "renderer", "styles.css");
const packageMetadata = JSON.parse(
    await readFile(join(repositoryRoot, "package.json"), "utf8"),
);

const rendererAssetsPlugin: Plugin = {
    name: "tandem-renderer-assets",
    setup(buildApi) {
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
                const source = await readFile(clientEntry, "utf8");
                const compiled = await transform(source, {
                    loader: "ts",
                    target: "es2020",
                    format: "iife",
                    minify: true,
                });
                return {
                    contents: `export default ${JSON.stringify(compiled.code)};`,
                    loader: "js",
                    watchFiles: [clientEntry],
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
    outfile: join(extensionRoot, "extension.mjs"),
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
        js: "// Generated from the project-root src/ directory by npm run build. Do not edit directly.",
    },
};

if (process.argv.includes("--watch")) {
    const buildContext = await context(options);
    await buildContext.watch();
    console.info("Watching Tandem TypeScript sources...");
} else {
    await build(options);
}
