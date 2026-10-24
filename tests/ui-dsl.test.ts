import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { SketchStore } from "../src/sketch-store.js";
import { hasScreenContent, readSketchState, sketchDocumentSchema, validateSketchDocument } from "../src/sketch.js";
import { sketchDocument, screenPng } from "./helpers/sketch-lifecycle-fixture.js";
import { createDocument } from "./helpers/ui-dsl-fixture.js";
import rendererCss from "../src/vendor/ui-dsl/styles.js";

test("DSL documents validate exact component contracts across realms without weakening legacy reads", () => {
    const value = sketchDocument();
    const before = JSON.stringify(value);
    assert.deepEqual(validateSketchDocument(value, ["usage"]), value);
    assert.deepEqual(validateSketchDocument(runInNewContext(`JSON.parse(${JSON.stringify(before)})`), ["usage"]), value);
    assert.equal(JSON.stringify(value), before);
    assert.equal(hasScreenContent(value.screens[0]), true);
    assert.equal(hasScreenContent({ ...value.screens[0], ui: createDocument() }), false);
    assert.deepEqual(sketchDocumentSchema.properties.version.enum, [2]);
    assert.ok(sketchDocumentSchema.properties.screens.items.required.includes("ui"));
    assert.equal(Object.hasOwn(sketchDocumentSchema.properties.screens.items.properties, "shapes"), false);
    for (const mutate of [
        (value: any) => { value.screens[0].shapes = []; },
        (value: any) => { value.screens[0].ui.nodes["primary-action"].props.onclick = "alert(1)"; },
        (value: any) => { value.screens[0].ui.nodes["primary-action"].props.background = "#ffffff"; },
        (value: any) => { value.screens[0].ui.nodes.screen.children.push("absent"); },
        (value: any) => { value.screens[0].ui.nodes["primary-action"].parent = "primary-action"; },
        (value: any) => { value.screens[0].ui.nodes["primary-action"].children = ["screen"]; },
        (value: any) => { value.screens[0].ui.tokens["color.primary"] = "url(https://example.test)"; },
        (value: any) => { value.screens[0].ui.nodes["primary-action"].props.icon = "unbundled-icon"; },
    ]) {
        const invalid = structuredClone(value);
        mutate(invalid);
        assert.throws(() => validateSketchDocument(invalid), /Invalid sketch:/);
    }
    const { ui: _ui, ...metadata } = value.screens[0];
    const legacy = { version: 1, screens: [{ ...metadata, shapes: [] }], transitions: [] };
    assert.deepEqual(validateSketchDocument(legacy), legacy);
});

test("DSL approval binds immutable JSON sources and PNGs without generating geometry assets", async t => {
    const root = await mkdtemp(join(tmpdir(), "tandem-dsl-store-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const store = new SketchStore(root), document = sketchDocument();
    const revision = await store.save("dsl", document, { requirementsDigest: "a".repeat(64), source: "generated", number: 1 });
    const directory = join(root, ".tandem", "efforts", "dsl", "sketches", revision.id);
    assert.deepEqual((await readdir(directory)).sort(), ["document.json", "main.ui.json", "revision.json"]);
    const source = await readFile(join(directory, "main.ui.json"));
    assert.deepEqual(JSON.parse(source.toString("utf8")), document.screens[0].ui);
    const approved = await store.approve("dsl", revision, [{ screenId: "main", data: screenPng() }]);
    assert.deepEqual(approved.assets.map(asset => [asset.id, asset.mediaType]), [
        ["document", "application/json"], ["main-ui", "application/json"], ["main-png", "image/png"],
    ]);
    assert.equal(approved.assets[1].hash, createHash("sha256").update(source).digest("hex"));
    assert.equal(readSketchState({ version: 1, status: "approved", current: revision, approved, history: [revision] }).approved!.documentHash, revision.documentHash);
    assert.deepEqual(await store.verifyApproval("dsl", revision, approved), document);
    assert.deepEqual(await store.readImage("dsl", revision, approved, "main"), Buffer.from(screenPng(), "base64"));
    await writeFile(join(directory, "main.ui.json"), "{}");
    await assert.rejects(store.verifyApproval("dsl", revision, approved), /UI DSL source bytes/);
    assert.deepEqual(JSON.parse(await readFile(join(directory, "document.json"), "utf8")), document);
});

test("vendored DSL modules are hash-pinned and rendering CSS has one upstream source", async () => {
    const root = new URL("../src/vendor/ui-dsl/", import.meta.url);
    const manifest = JSON.parse(await readFile(new URL("source.json", root), "utf8"));
    assert.equal(manifest.name, "chat-ui-dsl");
    for (const [file, digest] of Object.entries(manifest.files)) {
        const bytes = await readFile(new URL(file, root));
        assert.equal(createHash("sha256").update(bytes).digest("hex"), digest, file);
    }
    assert.equal(rendererCss, await readFile(new URL("renderer.css", root), "utf8"));
    assert.match(await readFile(new URL("lucide-LICENSE", root), "utf8"), /ISC|MIT/);
});
