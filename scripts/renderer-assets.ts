import { build, type BuildFailure, type BuildOptions, type Plugin } from "esbuild";
import { readFile, readdir } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";

export type RendererAssetName = "client" | "styles" | "browser-client" | "browser-styles";

function isBuildFailure(error: unknown): error is BuildFailure {
    return error instanceof Error && "errors" in error && Array.isArray(error.errors)
        && "warnings" in error && Array.isArray(error.warnings);
}

async function compileRenderer(entryPoint: string, options: BuildOptions) {
    const watchFiles = new Set([resolve(entryPoint)]);
    const watchDirs = new Set([dirname(resolve(entryPoint))]);
    const watchPlugin: Plugin = {
        name: "tandem-renderer-inputs",
        setup(api) {
            api.onLoad({ filter: /.*/ }, (args) => { if (isAbsolute(args.path)) watchFiles.add(args.path); return undefined; });
            api.onResolve({ filter: /.*/ }, (args) => {
                if (!args.resolveDir.split(sep).includes("node_modules") && (args.path.startsWith(".") || isAbsolute(args.path))) {
                    watchDirs.add(dirname(resolve(args.resolveDir, args.path)));
                }
                return undefined;
            });
        },
    };
    try {
        const result = await build({ ...options, entryPoints: [entryPoint], write: false, metafile: true, plugins: [watchPlugin] });
        return { result, watchFiles: [...watchFiles], watchDirs: [...watchDirs] };
    } catch (error) {
        if (!isBuildFailure(error)) throw error;
        return { errors: error.errors, warnings: error.warnings, watchFiles: [...watchFiles], watchDirs: [...watchDirs] };
    }
}

export function createRendererAssetsPlugin(
    repositoryRoot: string,
    dslNotice: string,
    onAsset?: (name: RendererAssetName, content: string) => void,
): Plugin {
    return {
        name: "tandem-renderer-assets",
        setup(buildApi) {
            buildApi.onResolve({ filter: /^tandem:(?:client|browser-client)$/ }, (args) => ({
                path: args.path === "tandem:browser-client" ? "browser-main.tsx" : "main.tsx",
                namespace: "tandem-client",
            }));
            buildApi.onResolve({ filter: /^tandem:(?:styles|browser-styles)$/ }, (args) => ({
                path: args.path === "tandem:browser-styles" ? "browser-styles.css" : "styles.css",
                namespace: "tandem-styles",
            }));
            buildApi.onLoad({ filter: /.*/, namespace: "tandem-client" }, async (args) => {
                const browser = args.path === "browser-main.tsx";
                const compilation = await compileRenderer(join(repositoryRoot, "src", browser ? "browser" : "renderer", "main.tsx"), {
                    bundle: true,
                    platform: "browser",
                    loader: { ".png": "dataurl" },
                    target: "es2020",
                    format: "iife",
                    minify: true,
                    legalComments: "inline",
                    define: { "process.env.NODE_ENV": JSON.stringify("production") },
                });
                if (!compilation.result) return compilation;
                const compiled = compilation.result;
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
                const content = [dslNotice, ...notices].join("\n") + "\n" + compiled.outputFiles[0].text;
                onAsset?.(browser ? "browser-client" : "client", content);
                return {
                    contents: `export default ${JSON.stringify(content)};`,
                    loader: "js",
                    watchFiles: compilation.watchFiles,
                    watchDirs: compilation.watchDirs,
                };
            });
            buildApi.onLoad({ filter: /.*/, namespace: "tandem-styles" }, async (args) => {
                const browser = args.path === "browser-styles.css";
                const compilation = await compileRenderer(join(repositoryRoot, "src", browser ? "browser" : "renderer", "styles.css"), {
                    bundle: true, minify: true,
                });
                if (!compilation.result) return compilation;
                const compiled = compilation.result;
                const content = compiled.outputFiles[0].text;
                onAsset?.(browser ? "browser-styles" : "styles", content);
                return {
                    contents: `export default ${JSON.stringify(content)};`,
                    loader: "js",
                    watchFiles: compilation.watchFiles,
                    watchDirs: compilation.watchDirs,
                };
            });
        },
    };
}
