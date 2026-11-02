import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const skillPath = join("skills", "brainstorm-whiteboard");
const hosts = [
  { catalog: ".claude-plugin/marketplace.json", manifest: ".claude-plugin/plugin.json", skills: "./" },
  { catalog: ".agents/plugins/marketplace.json", manifest: ".codex-plugin/plugin.json", skills: "./." },
];
const json = async (path) => JSON.parse(await readFile(path, "utf8"));

function contained(base, path) {
  assert.equal(typeof path, "string");
  assert.ok(path.startsWith("./"), `Expected a plugin-relative path: ${path}`);
  assert.ok(!/[\\:]/.test(path) && !path.split("/").includes(".."), `Unportable or escaping path: ${path}`);
  const resolved = resolve(base, path);
  const tail = relative(base, resolved);
  assert.ok(!isAbsolute(tail) && tail !== ".." && !tail.startsWith(`..${sep}`), `Path escapes package: ${path}`);
  return resolved;
}

async function sourceFiles(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith("dist-")) continue;
    const path = join(prefix, entry.name);
    if (path === join("public", "excalidraw")) continue;
    assert.ok(!entry.isSymbolicLink(), `Standalone package must not depend on symlinks: ${path}`);
    if (entry.isDirectory()) files.push(...await sourceFiles(join(directory, entry.name), path));
    else files.push(path);
  }
  return files.sort();
}

async function temporary(t) {
  const directory = await mkdtemp(join(tmpdir(), "tandem-skill-plugin-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function checkPlugin(directory, version) {
  const files = await sourceFiles(directory);
  assert.deepEqual(files.filter((path) => path.endsWith("SKILL.md")), ["SKILL.md"], "Only one canonical skill is shipped.");
  for (const host of hosts) {
    const manifest = await json(join(directory, host.manifest));
    assert.equal(manifest.name, "brainstorm-whiteboard");
    assert.equal(manifest.version, version);
    assert.equal(typeof manifest.description, "string");
    assert.ok(manifest.description.length);
    assert.equal(manifest.skills, host.skills);
    assert.equal(contained(directory, manifest.skills), resolve(directory));
    const allowed = host.manifest.startsWith(".claude-plugin")
      ? ["name", "displayName", "version", "description", "author", "repository", "license", "skills"]
      : ["name", "version", "description", "skills", "interface"];
    assert.deepEqual(Object.keys(manifest).sort(), allowed.sort(), "No hooks, MCP, agents, accounts or autostart components.");
    if (manifest.author) {
      assert.equal(typeof manifest.author.name, "string");
      assert.equal(manifest.license, "MIT");
      assert.equal(manifest.repository, "https://github.com/microsoft/Tandem");
    } else {
      assert.equal(typeof manifest.interface.displayName, "string");
      assert.equal(typeof manifest.interface.shortDescription, "string");
      assert.equal(typeof manifest.interface.developerName, "string");
    }
  }
  assert.ok(!files.some((path) => path.startsWith(`skills${sep}`)), "No default sub-skill scan or duplicate implementation.");
  for (const path of [
    "LICENSE.txt", "package.json", "package-lock.json", "index.html", "tsconfig.json", "vite.config.ts",
    "server.mjs", "src/main.tsx", "src/style.css", "scripts/assets.mjs", "scripts/whiteboard.mjs",
    "scripts/cookbook.mjs", "scripts/example.mjs", "shared/authoring.mjs",
    "shared/scene.mjs", "shared/store.mjs", "shared/topics.mjs",
    "references/api-and-elements.md", "references/editing-cookbook.md",
  ]) {
    assert.ok(files.includes(join(...path.split("/"))), `Missing standalone resource: ${path}`);
  }
  assert.match(await readFile(join(directory, "LICENSE.txt"), "utf8"), /MIT License/);
  for (const path of files.filter((path) => /\.(?:md|mjs|tsx?|html)$/.test(path))) {
    const content = await readFile(join(directory, path), "utf8");
    const links = path.endsWith(".md")
      ? [...content.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)].map((match) => match[1]).filter((link) => !/^[a-z]+:/i.test(link))
      : [...content.matchAll(/(?:from\s+|import\s*\(|new URL\(\s*)["'](\.[^"']+)["']/g)].map((match) => match[1]);
    for (const link of links) {
      const target = contained(directory, `./${relative(directory, resolve(directory, dirname(path), link)).split(sep).join("/")}`);
      const local = relative(directory, target);
      // These contained resources are prepared by npm ci/build, not shipped as source.
      const top = local.split(sep)[0];
      if (top === "node_modules" || top === "dist" || top.startsWith("dist-") || local.startsWith(join("public", "excalidraw") + sep)) continue;
      assert.ok(local === "" || files.includes(local) || files.some((file) => file.startsWith(`${local}${sep}`)), `Missing relative resource in ${path}: ${link}`);
    }
  }
  return files;
}

test("Claude and Codex catalogs resolve exactly the canonical whiteboard from the repository root", async () => {
  const { version } = await json(join(root, "package.json"));
  for (const host of hosts) {
    const catalog = await json(join(root, host.catalog));
    assert.equal(catalog.name, "tandem-skills");
    assert.deepEqual(catalog.plugins.map(({ name }) => name), ["brainstorm-whiteboard"]);
    assert.equal(catalog.plugins[0].source, "./skills/brainstorm-whiteboard");
    assert.equal(contained(root, catalog.plugins[0].source), join(root, skillPath));
    if (host.catalog.startsWith(".claude-plugin")) assert.equal(typeof catalog.owner.name, "string");
  }
  await checkPlugin(join(root, skillPath), version);
  execFileSync(process.execPath, [join(root, "scripts", "sync-skill-plugins.mjs"), "--check"]);
});

test("a clean extracted plugin subtree retains both manifests, all resources and standalone tests without Tandem", async (t) => {
  const extracted = await temporary(t);
  const original = join(root, skillPath);
  for (const file of await sourceFiles(original)) {
    await mkdir(dirname(join(extracted, file)), { recursive: true });
    await copyFile(join(original, file), join(extracted, file));
  }
  const { version } = await json(join(root, "package.json"));
  await checkPlugin(extracted, version);
  const pkg = await json(join(extracted, "package.json"));
  const [runner, ...args] = pkg.scripts.test.split(/\s+/);
  assert.equal(runner, "node");
  assert.equal(args[0], "--test");
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const output = execFileSync(process.execPath, args, { cwd: extracted, env, encoding: "utf8", timeout: 30_000 });
  assert.match(output, /\btests [1-9]\d*/, "The extracted package must actually execute its standalone tests.");
});

test("root release version is checked and explicitly synchronized without changing standalone metadata", async (t) => {
  const fixture = await temporary(t);
  const script = join(fixture, "scripts", "sync-skill-plugins.mjs");
  await mkdir(dirname(script), { recursive: true });
  await copyFile(join(root, "scripts", "sync-skill-plugins.mjs"), script);
  await writeFile(join(fixture, "package.json"), JSON.stringify({ version: "9.8.7" }));
  for (const host of hosts) {
    const path = join(fixture, skillPath, host.manifest);
    await mkdir(dirname(path), { recursive: true });
    await copyFile(join(root, skillPath, host.manifest), path);
  }
  const before = await Promise.all(hosts.map((host) => json(join(fixture, skillPath, host.manifest))));
  const failed = spawnSync(process.execPath, [script, "--check"], { encoding: "utf8" });
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /Plugin versions differ from root package.json/);
  assert.deepEqual(await Promise.all(hosts.map((host) => json(join(fixture, skillPath, host.manifest)))), before, "--check never writes.");
  execFileSync(process.execPath, [script]);
  execFileSync(process.execPath, [script, "--check"]);
  for (const [index, host] of hosts.entries()) {
    const manifest = await json(join(fixture, skillPath, host.manifest));
    assert.deepEqual(manifest, { ...before[index], version: "9.8.7" });
  }
});

test("package path checks reject parent traversal and absolute/platform-specific paths", () => {
  for (const path of ["../other", "./../other", "./safe/../../other", "/tmp/other", "C:\\other", "./C:/other", "./\\other"]) {
    assert.throws(() => contained(root, path));
  }
});
