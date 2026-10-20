import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { link, lstat, mkdir, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { isBuiltin } from "node:module";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { packageExtension } from "../scripts/package-extension.mjs";
import { humanLoopUiFixture } from "./helpers/human-loop-ui-fixture.mjs";
import { browserAvailable } from "./helpers/browser-fixture.mjs";

const run = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const script = join(repositoryRoot, "tandem", "scripts", "package-extension.mjs");
const portable = (path) => path.split(sep).join("/");

async function workspace(t) {
  const path = join(repositoryRoot, "tandem", "test", `.package-extension-${randomUUID()}`);
  await mkdir(path);
  t.after(() => rm(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
  return path;
}

async function put(root, path, content) {
  const target = join(root, ...path.split("/"));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content);
}

async function fixture(t) {
  const root = await workspace(t);
  const source = join(root, "checkout");
  await put(source, "tandem/INSTALL.md", "# Install the entire portable folder into a new project.\n");
  await put(source, "tandem/src/extension.mjs", [
    'import { answer } from "../runtime-src/domain/answer.ts";',
    'export { answer };',
    'export const publicDirectory = new URL("../public/", import.meta.url);',
    'export const skillDirectory = new URL("../skills/", import.meta.url);',
    "",
  ].join("\n"));
  await put(source, "tandem/runtime-src/domain/answer.ts",
    'import { seed } from "./seed.js";\nexport const answer: number = seed + 1;\n');
  await put(source, "tandem/runtime-src/domain/seed.ts", "export const seed = 41;\n");
  await put(source, "tandem/runtime-src/unused-server.ts", 'throw new Error("Do not ship the standalone host");\n');
  await put(source, "tandem/public/human-loop.html", '<script type="module" src="./app.js"></script>\n');
  await put(source, "tandem/public/app.js", [
    'import { action } from "./workflow-session-actions.js";',
    'export { render } from "./renderers/workflow-session.js";',
    'export { action };',
    "",
  ].join("\n"));
  await put(source, "tandem/public/workflow-session-actions.js", "export const action = 'close';\n");
  await put(source, "tandem/public/renderers/workflow-session.js", "export const render = () => 'session';\n");
  await put(source, "tandem/skills/example/SKILL.md", "# Example skill\n");
  return { root, source, output: join(root, "package") };
}

async function listFiles(root, directory = root) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await listFiles(root, path));
    else paths.push(portable(relative(root, path)));
  }
  return paths.sort();
}

async function verifyManifest(output) {
  const manifest = JSON.parse(await readFile(join(output, "manifest.json"), "utf8"));
  assert.equal(manifest.schemaVersion, "tandem-package/v1");
  const names = await listFiles(output);
  assert.deepEqual(manifest.files.map((file) => file.path), names.filter((name) => name !== "manifest.json"));
  for (const file of manifest.files) {
    assert.equal(isAbsolute(file.path), false);
    assert.equal(file.path.includes("\\"), false);
    assert.equal(file.path.split("/").includes(".."), false);
    const bytes = await readFile(join(output, ...file.path.split("/")));
    assert.equal(file.bytes, bytes.length, file.path);
    assert.equal(file.sha256, createHash("sha256").update(bytes).digest("hex"), file.path);
  }
  return manifest;
}

async function verifyRelativeGraph(output, files) {
  for (const file of files) {
    if (![".mjs", ".js", ".ts"].includes(extname(file))) continue;
    const path = join(output, ...file.split("/"));
    const source = await readFile(path, "utf8");
    assert.doesNotMatch(source, /\.\.\/\.\.\/apps\/living-canvas\//, file);
    assert.equal(source.includes(repositoryRoot), false, file);
    const literals = [
      ...source.matchAll(/(?<!["'`])(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["']([^"'\r\n]+)["']/g),
      ...source.matchAll(/new URL\(\s*["']([^"'\r\n]+)["']\s*,\s*import\.meta\.url/g),
    ];
    for (const match of literals) {
      const value = match[1];
      if (isBuiltin(value) || value.startsWith("@github/copilot-sdk")) continue;
      assert.match(value, /^\.\.?\//, `${file}: ${value}`);
      const target = resolve(dirname(path), value);
      const tail = relative(output, target);
      assert.equal(isAbsolute(tail) || tail === ".." || tail.startsWith(`..${sep}`), false, `${file}: ${value}`);
      await assert.doesNotReject(lstat(target), `${file}: ${value}`);
    }
  }
}

test("packages the current provider and complete renderer graph for relocation, without an SDK install", async (t) => {
  const root = await workspace(t);
  const output = join(root, "candidate");
  const result = await packageExtension({ outputDirectory: output });
  const relocated = join(root, "relocated");
  await rename(output, relocated);
  const manifest = await verifyManifest(relocated);
  assert.deepEqual(manifest, result.manifest);
  const names = manifest.files.map((file) => file.path);
  for (const required of [
    "INSTALL.md", "extension.mjs", "src/extension.mjs", "public/human-loop.html",
    "public/permission-presentation.js", "public/background-processes.js", "public/workflow-stop-control.js",
    "public/review-decisions.js", "src/human-loop-answers.mjs",
    "runtime-src/domain/backbone/artifact-store.ts",
    "runtime-src/domain/human-loop/model.ts", "runtime-src/domain/host-state-wal.ts",
    "runtime-src/permissions/permission-broker.ts", "runtime-src/event-store.ts",
    "skills/implementation-reviewer/SKILL.md", "skills/backbone-designer/SKILL.md",
  ]) assert.ok(names.includes(required), required);
  assert.deepEqual(await readFile(join(relocated, "INSTALL.md")), await readFile(join(repositoryRoot, "tandem", "INSTALL.md")));
  assert.match(await readFile(join(relocated, "src", "extension.mjs"), "utf8"),
    /id: "tandem", displayName: "Tandem"/);
  for (const source of await listFiles(join(repositoryRoot, "tandem", "src"))) {
    if (source.endsWith(".mjs")) assert.ok(names.includes(`src/${source}`), source);
  }
  for (const [input, target] of [
    [join(repositoryRoot, "tandem", "public"), "public"],
    [join(repositoryRoot, "tandem", "skills"), "skills"],
  ]) {
    for (const source of await listFiles(input)) {
      const packaged = `${target}/${source}`;
      assert.ok(names.includes(packaged), packaged);
      assert.deepEqual(await readFile(join(relocated, ...packaged.split("/"))),
        await readFile(join(input, ...source.split("/"))), packaged);
    }
  }
  assert.equal(names.some((name) => /(?:^|\/)(?:test|tests|node_modules|\.git|\.tandem)(?:\/|$)/.test(name)), false);
  for (const name of ["server.ts", "http-server.ts", "copilot-session-host.ts", "copilot-session-id-store.ts", "runtime.ts"]) {
    assert.equal(names.includes(`runtime-src/${name}`), false);
  }
  for (const retired of [
    "src/legacy-extension.mjs", "src/living-canvas-provider.mjs", "src/request-router.mjs",
    "src/workflow-host-runtime.mjs", "src/implementation-coordinator.mjs",
    "runtime-src/domain/workflow/private-sdk-transport.ts",
    "public/index.html", "public/app.js", "public/renderers/workflow-session.js",
  ]) assert.equal(names.includes(retired), false, retired);
  await verifyRelativeGraph(relocated, names);
  const modules = [
    "src/human-loop-store.mjs",
    "runtime-src/domain/workflow/policy.ts",
    "public/renderers/human-loop.js",
    "public/review-decisions.js",
    "src/human-loop-answers.mjs",
    "src/human-loop-provider.mjs",
  ].map((path) => pathToFileURL(join(relocated, ...path.split("/"))).href);
  const { stdout } = await run(process.execPath, ["--input-type=module", "-e",
    `for (const path of ${JSON.stringify(modules)}) await import(path); process.stdout.write("relocated imports passed");`,
  ], { cwd: root });
  assert.equal(stdout, "relocated imports passed");
});

test("one Tandem workspace has no standalone startup scripts or alternate host/UI entry points", async () => {
  assert.equal((await readFile(join(repositoryRoot, ".github", "extensions", "tandem", "extension.mjs"), "utf8")).trim(),
    'import "../../../tandem/src/extension.mjs";');
  await assert.rejects(lstat(join(repositoryRoot, ".github", "extensions", "living-canvas", "extension.mjs")), { code: "ENOENT" });
  const sharedRoot = join(repositoryRoot, "tandem");
  const shared = JSON.parse(await readFile(join(sharedRoot, "package.json"), "utf8"));
  assert.equal(shared.scripts.start, undefined);
  assert.equal(shared.scripts.dev, undefined);
  assert.equal(typeof shared.scripts.build, "string");
  assert.equal(typeof shared.scripts.test, "string");
  assert.equal(typeof shared.dependencies["@github/copilot-sdk"], "string");
  for (const path of [
    ["runtime-src", "server.ts"], ["runtime-src", "http-server.ts"], ["runtime-src", "copilot-session-host.ts"],
    ["runtime-src", "copilot-session-id-store.ts"], ["runtime-src", "runtime.ts"],
    ["src", "legacy-extension.mjs"], ["src", "workflow-host-runtime.mjs"],
    ["public", "index.html"], ["public", "app.js"],
  ]) await assert.rejects(lstat(join(sharedRoot, ...path)), { code: "ENOENT" });
  const canvas = JSON.parse(await readFile(join(repositoryRoot, "tandem", "package.json"), "utf8"));
  assert.equal(canvas.scripts["test:shared"], "node --import tsx --test test/shared/*.test.ts");
  assert.equal(canvas.scripts.test, "npm run test:shared && npm run test:canvas");
  assert.equal(canvas.scripts["test:legacy-oracle"], undefined);
  assert.equal(canvas.scripts["test:parity"], undefined);
  assert.equal(canvas.scripts.smoke, undefined);
  for (const retiredRoot of ["canvas-app", "apps/living-canvas"]) {
    await assert.rejects(lstat(join(repositoryRoot, ...retiredRoot.split("/"), "package.json")), { code: "ENOENT" });
  }
});

test("provider serves the packaged decision renderer and its shared module without missing imports", { skip: !browserAvailable }, async (t) => {
  const root = await workspace(t), output = join(root, "candidate");
  await packageExtension({ outputDirectory: output });
  const f = await humanLoopUiFixture(t, { publicDirectory: join(output, "public") });
  const result = { resultId: "packaged-review", outcome: {
    kind: "review-result", reviewFormat: "decision-review/v1", summary: "Verification-only review.",
    findings: [{ id: "browser", kind: "missing-evidence", summary: "Browser verification remains limited.",
      consequence: "Do not infer a verified user journey.", evidenceRefs: ["test-output.txt"] }],
    verificationLimits: ["Controller tests only."],
  } };
  f.state.executions.push({ binding: { role: "reviewer", design: f.state.design }, result });
  f.state.handoffs.push({ id: "review", requestId: "review-request", result });
  f.setStatus("ready");
  await f.until("document.querySelectorAll('[data-review-category]').length === 2");
  const rendered = await f.evaluate(`({
    sections: [...document.querySelectorAll('[data-review-category]')].map(node => ({
      title: node.querySelector('h4').textContent, body: node.querySelector('p').textContent
    })),
    modules: performance.getEntriesByType('resource').filter(entry =>
      new URL(entry.name).pathname === '/review-decisions.js').map(entry => entry.responseStatus),
    diagnostic: document.body.textContent.includes('Browser verification remains limited.')
  })`);
  assert.deepEqual(rendered.sections, [
    { title: "Decisions misaligned with agreed Design", body: "None" },
    { title: "Consequential implementation decisions not covered by agreed Design", body: "None" },
  ]);
  assert.ok(rendered.modules.length > 0);
  assert.ok(rendered.modules.every(status => status === 200));
  assert.equal(rendered.diagnostic, true);
  assert.deepEqual(f.browser.exceptions, []);
});

test("quoted schema keywords are not module references", async (t) => {
  const f = await fixture(t);
  const content = "export const keys = ['id', 'from', 'to', 'import'];\n"
    + 'export{answer}from"../runtime-src/domain/answer.ts";\n';
  await put(f.source, "tandem/public/schema.js", content);
  await packageExtension({ repositoryRoot: f.source, outputDirectory: f.output });
  await verifyManifest(f.output);
  assert.equal(await readFile(join(f.output, "public", "schema.js"), "utf8"),
    content);
});

test("escaped vendor attributes and template diagnostics retain their values in a portable package", async (t) => {
  const f = await fixture(t);
  const content = 'export const attribute = "data-fro\\u006d";\n'
    + 'export const diagnostic = value => `not fro\\u006d \'${value}\'.`;\n';
  await put(f.source, "tandem/public/vendor-strings.js", content);
  await packageExtension({ repositoryRoot: f.source, outputDirectory: f.output });
  await verifyManifest(f.output);
  const path = join(f.output, "public", "vendor-strings.js");
  assert.equal(await readFile(path, "utf8"), content);
  const vendor = await import(pathToFileURL(path).href);
  assert.equal(vendor.attribute, "data-from");
  assert.equal(vendor.diagnostic("frame"), "not from 'frame'.");
});

test("packages native JSON prompt imports with unchanged bytes and a closed relocatable graph", async (t) => {
  const f = await fixture(t);
  const promptsRoot = join(repositoryRoot, "tandem", "public", "prompts");
  for (const name of ["human-loop.js", "human-loop.json"]) {
    await put(f.source, `tandem/public/prompts/${name}`, await readFile(join(promptsRoot, name)));
  }
  await put(f.source, "tandem/src/prompt-consumer.mjs",
    'export { humanLoopPrompts } from "../public/prompts/human-loop.js";\n');
  await packageExtension({ repositoryRoot: f.source, outputDirectory: f.output });
  const relocated = join(f.root, "relocated");
  await rename(f.output, relocated);
  const manifest = await verifyManifest(relocated);
  await verifyRelativeGraph(relocated, manifest.files.map(({ path }) => path));
  for (const name of ["human-loop.js", "human-loop.json"]) {
    assert.deepEqual(await readFile(join(relocated, "public", "prompts", name)), await readFile(join(promptsRoot, name)));
  }
  const consumer = pathToFileURL(join(relocated, "src", "prompt-consumer.mjs")).href;
  const { stdout } = await run(process.execPath, ["--input-type=module", "-e",
    `const { humanLoopPrompts } = await import(${JSON.stringify(consumer)}); process.stdout.write(JSON.stringify(humanLoopPrompts));`,
  ], { cwd: f.root });
  assert.deepEqual(JSON.parse(stdout), JSON.parse(await readFile(join(promptsRoot, "human-loop.json"), "utf8")));
  await rm(join(f.source, "tandem", "public", "prompts", "human-loop.json"));
  await assert.rejects(packageExtension({ repositoryRoot: f.source, outputDirectory: join(f.root, "missing") }),
    /human-loop\.json/);
});

test("discovers new sources and nested imports, preserves bytes, and emits reproducible manifests", async (t) => {
  const f = await fixture(t);
  await put(f.source, "tandem/src/nested/addition.mjs", [
    'export { answer } from "../../runtime-src/domain/answer.ts";',
    'export const load = () => import("../../runtime-src/domain/seed.ts");',
    'export const skills = new URL("../../skills/", import.meta.url);',
    "",
  ].join("\n"));
  await put(f.source, "tandem/public/renderers/new-view.js", "export const label = '新画面';\n");
  await put(f.source, "tandem/public/icon.png", Buffer.from([0, 1, 128, 255]));
  await put(f.source, "tandem/skills/new-skill/SKILL.md", "# New skill\n");
  const original = await readFile(join(f.source, "tandem", "src", "extension.mjs"));
  const first = await packageExtension({ repositoryRoot: f.source, outputDirectory: f.output });
  const secondOutput = join(f.root, "second");
  await packageExtension({ repositoryRoot: f.source, outputDirectory: secondOutput });
  assert.deepEqual(await readFile(join(f.output, "manifest.json")), await readFile(join(secondOutput, "manifest.json")));
  const manifest = await verifyManifest(f.output);
  assert.deepEqual(manifest, first.manifest);
  const names = manifest.files.map((file) => file.path);
  assert.ok(names.includes("src/nested/addition.mjs"));
  assert.ok(names.includes("public/renderers/new-view.js"));
  assert.ok(names.includes("skills/new-skill/SKILL.md"));
  assert.ok(!names.includes("runtime-src/unused-server.ts"));
  await verifyRelativeGraph(f.output, names);
  assert.deepEqual(await readFile(join(f.output, "public", "icon.png")), Buffer.from([0, 1, 128, 255]));
  assert.deepEqual(await readFile(join(f.source, "tandem", "src", "extension.mjs")), original);
  const { stdout } = await run(process.execPath, ["--input-type=module", "-e",
    `const m = await import(${JSON.stringify(pathToFileURL(join(f.output, "src", "extension.mjs")).href)});
     if (m.answer !== 42) throw Error("Unexpected answer");
     process.stdout.write(m.skillDirectory.pathname.endsWith("/skills/") ? "ok" : "bad");`,
  ], { cwd: f.root });
  assert.equal(stdout, "ok");
});

test("excludes workspace data, tests, hidden metadata and dependencies from selected trees", async (t) => {
  const f = await fixture(t);
  for (const path of [
    ".tandem/living-context.json", ".git/config", "node_modules/sdk/index.mjs", "unrelated.txt",
    "tandem/test/example.test.mjs", "tandem/src/example.test.mjs",
    "tandem/src/test/helper.mjs", "tandem/src/node_modules/dependency/extension.mjs",
    "tandem/public/.tandem/session.json", "tandem/public/tests/browser.js",
    "tandem/public/sessions/private.json", "tandem/public/private.sqlite",
    "tandem/public/notes.txt", "tandem/skills/example/.env",
    "tandem/skills/example/node_modules/secret.md",
  ]) await put(f.source, path, "DO NOT PACKAGE");
  const { manifest } = await packageExtension({ repositoryRoot: f.source, outputDirectory: f.output });
  for (const file of manifest.files) {
    const bytes = await readFile(join(f.output, ...file.path.split("/")));
    assert.equal(bytes.includes(Buffer.from("DO NOT PACKAGE")), false, file.path);
  }
});

test("preserves existing destination directories and files exactly", async (t) => {
  const f = await fixture(t);
  for (const kind of ["empty", "populated", "file"]) {
    const output = join(f.root, kind);
    if (kind === "file") await writeFile(output, "keep file");
    else {
      await mkdir(output);
      if (kind === "populated") await writeFile(join(output, "keep.txt"), "keep directory");
    }
    const before = await readdir(f.root);
    await assert.rejects(packageExtension({ repositoryRoot: f.source, outputDirectory: output }), /Destination already exists/);
    assert.deepEqual(await readdir(f.root), before);
    if (kind === "file") assert.equal(await readFile(output, "utf8"), "keep file");
    else if (kind === "populated") assert.equal(await readFile(join(output, "keep.txt"), "utf8"), "keep directory");
    else assert.deepEqual(await readdir(output), []);
  }
});

test("exclusive reservation never replaces a racing destination, even an empty directory", async (t) => {
  for (const kind of ["empty", "populated", "file"]) {
    const f = await fixture(t);
    let competingIdentity;
    await assert.rejects(packageExtension({
      repositoryRoot: f.source,
      outputDirectory: f.output,
      onPublicationBoundary: async (phase, output) => {
        if (phase !== "before-reserve") return;
        if (kind === "file") await writeFile(output, "competing file");
        else {
          await mkdir(output);
          if (kind === "populated") await writeFile(join(output, "keep.txt"), "competing directory");
        }
        competingIdentity = await lstat(output);
      },
    }), /Destination already exists/);
    const after = await lstat(f.output);
    assert.equal(after.ino, competingIdentity.ino);
    assert.equal(after.dev, competingIdentity.dev);
    if (kind === "empty") assert.deepEqual(await readdir(f.output), []);
    else if (kind === "file") assert.equal(await readFile(f.output, "utf8"), "competing file");
    else assert.equal(await readFile(join(f.output, "keep.txt"), "utf8"), "competing directory");
    assert.deepEqual((await readdir(f.root)).sort(), ["checkout", "package"]);
  }
});

test("publishes complete payload before manifest and atomically publishes the root entrypoint last", async (t) => {
  const f = await fixture(t);
  const phases = [];
  const result = await packageExtension({
    repositoryRoot: f.source,
    outputDirectory: f.output,
    onPublicationBoundary: async (phase, output) => {
      phases.push(phase);
      await assert.rejects(lstat(join(output, "extension.mjs")), { code: "ENOENT" });
      if (phase !== "before-entrypoint") {
        await assert.rejects(lstat(join(output, "manifest.json")), { code: "ENOENT" });
      }
      if (phase === "reserved") assert.deepEqual(await readdir(output), []);
      if (phase === "payload-complete") {
        assert.equal(await readFile(join(output, "runtime-src", "domain", "seed.ts"), "utf8"), "export const seed = 41;\n");
        await lstat(join(output, "public", "renderers", "workflow-session.js"));
        await lstat(join(output, "skills", "example", "SKILL.md"));
      }
      if (phase === "before-entrypoint") {
        const manifest = JSON.parse(await readFile(join(output, "manifest.json"), "utf8"));
        assert.deepEqual(await listFiles(output),
          [...manifest.files.map((file) => file.path).filter((path) => path !== "extension.mjs"), "manifest.json"].sort());
        for (const file of manifest.files.filter((file) => file.path !== "extension.mjs")) {
          const bytes = await readFile(join(output, ...file.path.split("/")));
          assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256);
        }
      }
    },
  });
  assert.deepEqual(phases, ["before-reserve", "reserved", "payload-complete", "before-entrypoint"]);
  assert.deepEqual(await verifyManifest(f.output), result.manifest);
  assert.equal(await readFile(join(f.output, "extension.mjs"), "utf8"), 'import "./src/extension.mjs";\n');
  for (const path of await listFiles(f.output)) {
    assert.equal((await lstat(join(f.output, ...path.split("/")))).nlink, 1, path);
  }
  assert.deepEqual((await readdir(f.root)).sort(), ["checkout", "package"]);
});

test("retains and reports incomplete publication without overwriting competing files", async (t) => {
  for (const [boundary, competitor] of [
    ["reserved", "package.json"],
    ["payload-complete", "manifest.json"],
    ["before-entrypoint", "extension.mjs"],
  ]) {
    const f = await fixture(t);
    await assert.rejects(packageExtension({
      repositoryRoot: f.source,
      outputDirectory: f.output,
      onPublicationBoundary: async (phase, output) => {
        if (phase === boundary) await writeFile(join(output, competitor), "competing writer bytes", { flag: "wx" });
      },
    }), (error) => {
      assert.match(error.message, /publication is incomplete; output retained for inspection/);
      assert.deepEqual(error.publication, { status: "incomplete", outputDirectory: f.output });
      assert.equal(error.cause.code, "EEXIST");
      return true;
    });
    assert.equal(await readFile(join(f.output, competitor), "utf8"), "competing writer bytes");
    if (competitor !== "extension.mjs") {
      await assert.rejects(lstat(join(f.output, "extension.mjs")), { code: "ENOENT" });
    }
    assert.deepEqual((await readdir(f.root)).sort(), ["checkout", "package"]);
  }
});

test("detects replacement of the reserved directory and never cleans the competing output", async (t) => {
  const f = await fixture(t);
  const displaced = join(f.root, "displaced-reservation");
  await assert.rejects(packageExtension({
    repositoryRoot: f.source,
    outputDirectory: f.output,
    onPublicationBoundary: async (phase, output) => {
      if (phase !== "reserved") return;
      await rename(output, displaced);
      await mkdir(output);
      await writeFile(join(output, "keep.txt"), "replacement owner");
    },
  }), (error) => {
    assert.match(error.message, /Reserved publication directory changed/);
    assert.equal(error.publication.status, "incomplete");
    return true;
  });
  assert.deepEqual(await readdir(displaced), []);
  assert.deepEqual(await readdir(f.output), ["keep.txt"]);
  assert.equal(await readFile(join(f.output, "keep.txt"), "utf8"), "replacement owner");
  assert.deepEqual((await readdir(f.root)).sort(), ["checkout", "displaced-reservation", "package"]);
});

test("retains and reports staging when its directory identity no longer proves ownership", async (t) => {
  const f = await fixture(t);
  let replacedStaging;
  await assert.rejects(packageExtension({
    repositoryRoot: f.source,
    outputDirectory: f.output,
    onPublicationBoundary: async (phase) => {
      if (phase !== "before-reserve") return;
      const name = (await readdir(f.root)).find((name) => name.startsWith(".tandem-package-"));
      assert.ok(name);
      replacedStaging = join(f.root, name);
      await rename(replacedStaging, join(f.root, "displaced-staging"));
      await mkdir(replacedStaging);
      await writeFile(join(replacedStaging, "keep.txt"), "another staging owner");
      throw new Error("Injected publication stop");
    },
  }), (error) => {
    assert.match(error.message, /Staging ownership changed/);
    assert.equal(error.retainedStagingDirectory, replacedStaging);
    assert.equal(error.publication.status, "not-started");
    return true;
  });
  assert.equal(await readFile(join(replacedStaging, "keep.txt"), "utf8"), "another staging owner");
  await assert.rejects(lstat(f.output), { code: "ENOENT" });
});

test("rejects source overlap in both directions without creating output", async (t) => {
  const f = await fixture(t);
  for (const output of [
    f.source, join(f.source, "tandem"), join(f.source, "tandem", "src"),
    join(f.source, "tandem", "src", "packaged"), join(f.source, "tandem", "public", "packaged"),
    join(f.source, "tandem", "runtime-src", "packaged"),
    join(f.source, "tandem", "skills", "packaged"),
  ]) await assert.rejects(packageExtension({ repositoryRoot: f.source, outputDirectory: output }), /overlaps package source/);
  assert.deepEqual(await readdir(f.root), ["checkout"]);
});

test("rejects linked source files and directories, including junctions", async (t) => {
  for (const kind of ["hardlink", "directory"]) {
    const f = await fixture(t);
    if (kind === "hardlink") {
      await link(join(f.source, "tandem", "src", "extension.mjs"), join(f.source, "tandem", "src", "linked.mjs"));
    } else {
      await symlink(join(f.source, "tandem", "public"),
        join(f.source, "tandem", "src", "linked"), process.platform === "win32" ? "junction" : "dir");
    }
    await assert.rejects(packageExtension({ repositoryRoot: f.source, outputDirectory: f.output }), /Links are not package/);
    assert.deepEqual(await readdir(f.root), ["checkout"]);
  }
});

test("rejects linked output ancestors and linked source roots", async (t) => {
  const f = await fixture(t);
  const alias = join(f.root, "alias");
  await symlink(f.source, alias, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(packageExtension({ repositoryRoot: f.source, outputDirectory: join(alias, "package") }), /Links are not package/);
  await assert.rejects(packageExtension({ repositoryRoot: alias, outputDirectory: f.output }), /Links are not package/);
  assert.deepEqual((await readdir(f.root)).sort(), ["alias", "checkout"]);
});

test("cleans only its owned staging path on a late missing, escaping or excluded dependency", async (t) => {
  for (const specifier of [
    "./missing.mjs", "../../../unrelated.mjs", "./tests/excluded.mjs", "unavailable-package",
  ]) {
    const f = await fixture(t);
    await put(f.source, "tandem/src/z-broken.mjs", `import ${JSON.stringify(specifier)};\n`);
    await put(f.source, "tandem/src/tests/excluded.mjs", "export const secret = true;\n");
    const otherStaging = join(f.root, ".tandem-package-someone-else");
    await mkdir(otherStaging);
    await writeFile(join(otherStaging, "keep.txt"), "owned by another invocation");
    const before = (await readdir(f.root)).sort();
    await assert.rejects(packageExtension({ repositoryRoot: f.source, outputDirectory: f.output }),
      /Missing package reference|escapes package source|not a package source|Unsupported non-relative/);
    assert.deepEqual((await readdir(f.root)).sort(), before);
    assert.equal(await readFile(join(otherStaging, "keep.txt"), "utf8"), "owned by another invocation");
  }
});

test("rejects invalid UTF-8 modules without changing source bytes and cleans its staging", async (t) => {
  for (const path of [
    "tandem/src/z-invalid.mjs",
    "tandem/public/workflow-session-actions.js",
    "tandem/runtime-src/domain/seed.ts",
  ]) {
    const f = await fixture(t);
    const invalid = Buffer.concat([Buffer.from("export const text = '"), Buffer.from([0xc0, 0xaf]), Buffer.from("';\n")]);
    await put(f.source, path, invalid);
    const entrypoint = join(f.source, "tandem", "src", "extension.mjs");
    const originalEntrypoint = await readFile(entrypoint);
    const before = await listFiles(f.source);
    await assert.rejects(packageExtension({ repositoryRoot: f.source, outputDirectory: f.output }),
      /Invalid UTF-8 module bytes/);
    assert.deepEqual(await readFile(join(f.source, ...path.split("/"))), invalid);
    assert.deepEqual(await readFile(entrypoint), originalEntrypoint);
    assert.deepEqual(await listFiles(f.source), before);
    assert.deepEqual(await readdir(f.root), ["checkout"]);
  }
});

test("requires a regular unlinked UTF-8 installation guide and cleans rejected staging", async (t) => {
  for (const kind of ["missing", "directory", "linked", "invalid-utf8"]) {
    const f = await fixture(t);
    const guide = join(f.source, "tandem", "INSTALL.md");
    await rm(guide);
    if (kind === "directory") await mkdir(guide);
    if (kind === "linked") {
      const original = join(f.source, "guide-original.md");
      await writeFile(original, "# Keep this source intact\n");
      await link(original, guide);
    }
    if (kind === "invalid-utf8") await writeFile(guide, Buffer.from([0xc0, 0xaf]));
    const before = await listFiles(f.source);
    await assert.rejects(packageExtension({ repositoryRoot: f.source, outputDirectory: f.output }),
      /ENOENT|Expected an installation guide|Links are not package|Invalid UTF-8 installation guide/);
    assert.deepEqual(await listFiles(f.source), before);
    assert.deepEqual(await readdir(f.root), ["checkout"]);
    if (kind === "linked") assert.equal(await readFile(guide, "utf8"), "# Keep this source intact\n");
    if (kind === "invalid-utf8") assert.deepEqual(await readFile(guide), Buffer.from([0xc0, 0xaf]));
  }
});

test("requires explicit output and an existing output parent", async (t) => {
  const f = await fixture(t);
  await assert.rejects(packageExtension(), /outputDirectory is required/);
  await assert.rejects(packageExtension({ outputDirectory: " " }), /outputDirectory is required/);
  await assert.rejects(packageExtension({
    repositoryRoot: f.source, outputDirectory: join(f.root, "missing-parent", "package"),
  }), { code: "ENOENT" });
  assert.deepEqual(await readdir(f.root), ["checkout"]);
});

test("CLI requires one destination, creates a package, and refuses replacement", async (t) => {
  const root = await workspace(t);
  await assert.rejects(run(process.execPath, [script], { cwd: root }), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /Usage:/);
    return true;
  });
  const output = join(root, "cli-package");
  const { stdout } = await run(process.execPath, [script, output], { cwd: root });
  const response = JSON.parse(stdout);
  assert.equal(response.outputDirectory, output);
  assert.equal(response.manifest, "manifest.json");
  const manifest = await verifyManifest(output);
  assert.equal(response.files, manifest.files.length);
  await assert.rejects(run(process.execPath, [script, output], { cwd: root }), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /Destination already exists/);
    return true;
  });
});
