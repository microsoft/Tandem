import { isUtf8 } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import { link, lstat as readStat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { isBuiltin } from "node:module";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultRepositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const excludedDirectories = new Set(["test", "tests", "__tests__", "node_modules", "session-data", "sessions"]);
const rendererExtensions = new Set([
  ".js", ".mjs", ".css", ".html", ".json", ".svg", ".png", ".jpg", ".jpeg",
  ".gif", ".ico", ".webp", ".avif", ".woff", ".woff2", ".ttf", ".otf",
]);
const moduleExtensions = new Set([".mjs", ".js", ".ts"]);
const sdkImports = new Set(["@github/copilot-sdk", "@github/copilot-sdk/extension"]);
// Preserve exact inode identities when proving ownership of staging/publication directories.
const lstat = (path) => readStat(path, { bigint: true });

const portable = (path) => path.split(sep).join("/");
const within = (root, path) => {
  const tail = relative(root, path);
  return tail === "" || (!isAbsolute(tail) && tail !== ".." && !tail.startsWith(`..${sep}`));
};

async function statIfPresent(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function rejectLink(path, stat) {
  if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink > 1)) {
    throw new Error(`Links are not package inputs or destinations: ${path}`);
  }
}

async function checkAncestors(path) {
  const parent = dirname(path);
  if (parent !== path) await checkAncestors(parent);
  const stat = await lstat(path);
  rejectLink(path, stat);
  if (!stat.isDirectory()) throw new Error(`Expected an existing directory: ${path}`);
}

function excluded(path) {
  return path.split(sep).some((part) =>
    part.startsWith(".")
    || excludedDirectories.has(part.toLowerCase())
    || /\.(?:test|spec)\.[^.]+$/i.test(part));
}

function accepts(group, path) {
  if (excluded(path)) return false;
  const extension = extname(path).toLowerCase();
  if (group.target === "src") return extension === ".mjs";
  if (group.target === "runtime-src") return extension === ".ts";
  if (group.target === "public") return rendererExtensions.has(extension) || path.endsWith(".d.ts");
  return extension === ".md";
}

async function collect(group, directory = group.source) {
  const result = [];
  for (const name of (await readdir(directory)).sort()) {
    const path = join(directory, name);
    const stat = await lstat(path);
    rejectLink(path, stat);
    const tail = relative(group.source, path);
    if (excluded(tail)) continue;
    if (stat.isDirectory()) result.push(...await collect(group, path));
    else if (!stat.isFile()) throw new Error(`Unsupported package input: ${path}`);
    else if (accepts(group, tail)) result.push(path);
  }
  return result;
}

// Recognizes the repository's literal ESM imports/re-exports and import.meta.url resources.
// Computed imports (such as the explicitly configured SDK loader) remain runtime-owned.
function references(source) {
  const pattern = /(?<!["'`])(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)(["'])([^"'\r\n]+)\1|\bnew\s+URL\(\s*(["'])([^"'\r\n]+)\3\s*,\s*import\.meta\.url\s*\)/g;
  return [...source.matchAll(pattern)].map((match) => ({
    value: match[2] ?? match[4],
    offset: match.index + match[0].indexOf(match[1] ?? match[3]) + 1,
    resource: match[4] !== undefined,
  }));
}

function sameDirectory(current, owned) {
  return owned !== undefined && current?.isDirectory() && !current.isSymbolicLink()
    && current.dev === owned.dev && current.ino === owned.ino;
}

async function publishFile(staging, output, path, ownedDirectories) {
  const ensureDirectory = async (directory) => {
    if (directory !== output) await ensureDirectory(dirname(directory));
    const owned = ownedDirectories.get(directory);
    if (owned) {
      if (!sameDirectory(await statIfPresent(directory), owned)) {
        throw new Error(`Reserved publication directory changed: ${directory}`);
      }
    } else {
      // Never merge an independently created directory into this publication.
      await mkdir(directory);
      ownedDirectories.set(directory, await lstat(directory));
    }
  };
  const destination = join(output, path);
  await ensureDirectory(dirname(destination));
  // A same-volume hard link publishes complete bytes atomically and fails if the
  // destination exists. Removing staging later leaves ordinary single-link files.
  await link(join(staging, path), destination);
}

/**
 * Build, but never install or activate, a relocatable Living Canvas package.
 * outputDirectory must be new and its parent must already exist. repositoryRoot
 * defaults to this checkout; an explicit root supports source fixtures.
 * manifest.json lists every payload file (not itself), in path order, with byte hashes.
 * The destination is reserved by exclusive mkdir and is visible while filling.
 * Every file is published without replacement; manifest and then root entrypoint
 * appear only after the payload is complete. Failed reserved outputs are retained
 * and reported: concurrent additions make recursive destination cleanup unsafe.
 * onPublicationBoundary is an optional deterministic test seam, not a live hook.
 */
export async function packageExtension({
  outputDirectory, repositoryRoot = defaultRepositoryRoot, onPublicationBoundary,
} = {}) {
  if (typeof outputDirectory !== "string" || !outputDirectory.trim()) {
    throw new Error("A new outputDirectory is required.");
  }
  const root = resolve(repositoryRoot);
  const output = resolve(outputDirectory);
  const groups = [
    { source: join(root, "tandem", "src"), target: "src" },
    { source: join(root, "tandem", "public"), target: "public" },
    { source: join(root, "tandem", "runtime-src"), target: "runtime-src" },
    { source: join(root, "tandem", "skills"), target: "skills" },
  ];
  for (const group of groups) {
    if (within(group.source, output) || within(output, group.source)) {
      throw new Error(`Output overlaps package source: ${group.source}`);
    }
    await checkAncestors(group.source);
  }
  await checkAncestors(dirname(output));
  if (await statIfPresent(output)) throw new Error(`Destination already exists: ${output}`);

  const staging = join(dirname(output), `.tandem-package-${randomUUID()}`);
  await mkdir(staging);
  let stagingIdentity;
  let publicationStatus = "not-started";
  const cleanupStaging = async () => {
    const current = await statIfPresent(staging);
    if (!current) return;
    if (!sameDirectory(current, stagingIdentity)) {
      throw new Error(`Staging ownership changed; retained for inspection: ${staging}`);
    }
    await rm(staging, { recursive: true, force: true });
  };
  try {
    stagingIdentity = await lstat(staging);
    const queue = [];
    const queued = new Set();
    const files = [];
    const mapInput = (path) => {
      const group = groups.find((candidate) => within(candidate.source, path));
      if (!group) throw new Error(`Reference escapes package source roots: ${path}`);
      const tail = relative(group.source, path);
      return { group, tail, destination: join(group.target, tail) };
    };
    const enqueue = (path) => {
      const { group, tail } = mapInput(path);
      if (!accepts(group, tail)) throw new Error(`Reference is not a package source/asset: ${path}`);
      if (!queued.has(path)) {
        queued.add(path);
        queue.push(path);
      }
    };
    const writePayload = async (path, bytes) => {
      await mkdir(dirname(join(staging, path)), { recursive: true });
      await writeFile(join(staging, path), bytes, { flag: "wx" });
      files.push({
        path: portable(path),
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    };
    for (const group of groups.filter((group) => group.target !== "runtime-src")) {
      for (const path of await collect(group)) enqueue(path);
    }
    for (const required of [
      join(groups[0].source, "extension.mjs"),
      join(groups[1].source, "human-loop.html"),
    ]) {
      if (!queued.has(required)) throw new Error(`Missing required package input: ${required}`);
    }
    if (!queue.some((path) => within(groups[3].source, path) && basename(path) === "SKILL.md")) {
      throw new Error("No SKILL.md files found in the package skills source.");
    }
    await writePayload("extension.mjs", Buffer.from('import "./src/extension.mjs";\n'));
    await writePayload("package.json", Buffer.from('{\n  "private": true,\n  "type": "module"\n}\n'));
    const installationPath = join(root, "tandem", "INSTALL.md");
    await checkAncestors(dirname(installationPath));
    const installationStat = await lstat(installationPath);
    rejectLink(installationPath, installationStat);
    if (!installationStat.isFile()) throw new Error(`Expected an installation guide: ${installationPath}`);
    const installationGuide = await readFile(installationPath);
    if (!isUtf8(installationGuide)) throw new Error(`Invalid UTF-8 installation guide: ${installationPath}`);
    await writePayload("INSTALL.md", installationGuide);

    for (const path of queue) {
      await checkAncestors(dirname(path));
      const stat = await lstat(path);
      rejectLink(path, stat);
      if (!stat.isFile()) throw new Error(`Expected a package source file: ${path}`);
      let bytes = await readFile(path);
      const { destination } = mapInput(path);
      if (moduleExtensions.has(extname(path))) {
        if (!isUtf8(bytes)) throw new Error(`Invalid UTF-8 module bytes: ${path}`);
        const source = bytes.toString("utf8");
        let rewritten = "";
        let cursor = 0;
        for (const reference of references(source)) {
          const specifier = reference.value;
          if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
            if (!reference.resource && (isBuiltin(specifier) || sdkImports.has(specifier))) continue;
            throw new Error(`Unsupported non-relative package reference in ${path}: ${specifier}`);
          }
          let target = resolve(dirname(path), specifier);
          let mapped = mapInput(target);
          await checkAncestors(dirname(target));
          let targetStat = await statIfPresent(target);
          // Legacy type-only .js edges refer to source .ts files; keep the emitted graph self-contained.
          if (!targetStat && mapped.group.target === "runtime-src" && extname(target) === ".js") {
            target = `${target.slice(0, -3)}.ts`;
            mapped = mapInput(target);
            targetStat = await statIfPresent(target);
          }
          if (!targetStat) throw new Error(`Missing package reference in ${path}: ${specifier}`);
          rejectLink(target, targetStat);
          if (reference.resource && targetStat.isDirectory()) {
            for (const resource of await collect(mapped.group, target)) enqueue(resource);
          } else {
            if (!targetStat.isFile()) throw new Error(`Expected a package module/asset: ${target}`);
            enqueue(target);
          }
          let rebased = portable(relative(dirname(destination), mapped.destination));
          if (!rebased.startsWith(".")) rebased = `./${rebased}`;
          if (specifier.endsWith("/")) rebased += "/";
          rewritten += source.slice(cursor, reference.offset) + rebased;
          cursor = reference.offset + specifier.length;
        }
        rewritten += source.slice(cursor);
        if (/\.\.\/\.\.\/apps\/living-canvas\//.test(rewritten)) {
          throw new Error(`Unrebased checkout reference in ${path}`);
        }
        bytes = Buffer.from(rewritten);
      }
      await writePayload(destination, bytes);
    }
    files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    const manifest = { schemaVersion: "tandem-package/v1", files };
    await writeFile(join(staging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
    await checkAncestors(dirname(output));
    if (await statIfPresent(output)) throw new Error(`Destination already exists: ${output}`);
    await onPublicationBoundary?.("before-reserve", output);
    try {
      await mkdir(output);
    } catch (error) {
      if (error.code === "EEXIST") throw new Error(`Destination already exists: ${output}`, { cause: error });
      throw error;
    }
    publicationStatus = "incomplete";
    const ownedDirectories = new Map([[output, await lstat(output)]]);
    await onPublicationBoundary?.("reserved", output);
    for (const file of files) {
      if (file.path !== "extension.mjs") {
        await publishFile(staging, output, join(...file.path.split("/")), ownedDirectories);
      }
    }
    await onPublicationBoundary?.("payload-complete", output);
    await publishFile(staging, output, "manifest.json", ownedDirectories);
    await onPublicationBoundary?.("before-entrypoint", output);
    await publishFile(staging, output, "extension.mjs", ownedDirectories);
    publicationStatus = "complete";
    await cleanupStaging();
    return { outputDirectory: output, manifest };
  } catch (error) {
    let cleanupFailure;
    try {
      await cleanupStaging();
    } catch (failure) {
      cleanupFailure = failure;
    }
    if (publicationStatus !== "not-started" || cleanupFailure) {
      const details = publicationStatus === "not-started" ? [] : [
        `Package publication is ${publicationStatus}; output retained for inspection: ${output}.`,
      ];
      if (cleanupFailure) details.push(`Staging cleanup could not be proven/completed; retained: ${staging}. ${cleanupFailure.message}`);
      const failure = new Error(`${error.message} ${details.join(" ")}`, { cause: error });
      failure.publication = { status: publicationStatus, outputDirectory: output };
      if (cleanupFailure) failure.retainedStagingDirectory = staging;
      throw failure;
    }
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) {
      throw new Error("Usage: node tandem\\scripts\\package-extension.mjs <new-output-directory>");
    }
    const { outputDirectory, manifest } = await packageExtension({ outputDirectory: process.argv[2] });
    process.stdout.write(`${JSON.stringify({ outputDirectory, files: manifest.files.length, manifest: "manifest.json" })}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
