import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildSketchPrompt, buildUiDesignSkill } from "../src/planning-prompts.js";
import {
    parseUiDesignHtml, patchUiDesign, readUiDesign, renderUiDesignHtml, uiDesignReadiness, uiDesignVersion,
} from "../src/ui-design.js";
import { designContents, designOperations, designOutline, designReferences, uiDesignFixture, uiDesignOutline } from "./helpers/ui-design-fixture.js";

const skill = new URL("../skills/ui-design/", import.meta.url);

test("standalone instructions share the production design method and generate without drift", async () => {
    const instructions = buildUiDesignSkill();
    assert.equal(await readFile(new URL("SKILL.md", skill), "utf8"), instructions);
    const args = { prototypeId: "example", projectRoot: "C:\\example", action: "generate-sketch",
        instruction: "", requirements: {}, approach: "build", document: null };
    const outline = buildSketchPrompt(args);
    const revision = buildSketchPrompt({ ...args, action: "revise-sketch", document: uiDesignFixture().document });
    for (const sentence of [
        "Plan the complete page structure and navigation before any page contents are generated.",
        "Keep real task headings, action labels and enough representative content to judge the information hierarchy.",
        "These designs contain reviewed choices and user refinements.",
        "Retain unrelated screens, layout, styling, content, viewport sizes, annotations, stable IDs and transitions exactly.",
    ]) {
        assert.ok(instructions.includes(sentence));
        assert.ok(outline.includes(sentence) || revision.includes(sentence));
    }
    execFileSync(process.execPath, ["--import", "tsx", "scripts/build-ui-design-skill.ts", "--check"], { encoding: "utf8" });
});

test("map-first content fills every planned screen without changing metadata or navigation", () => {
    const outline = uiDesignOutline();
    assert.deepEqual(outline.document.screens.map(screen => screen.id), ["workshops", "booking", "profile"]);
    assert.equal(uiDesignReadiness(outline).length, 3);
    const complete = uiDesignFixture();
    assert.deepEqual(complete.document.transitions, outline.document.transitions);
    assert.deepEqual(complete.document.screens.map(({ ui, ...screen }) => screen), outline.document.screens.map(({ ui, ...screen }) => screen));
    assert.deepEqual(uiDesignReadiness(complete), []);
    assert.throws(() => patchUiDesign(outline, uiDesignVersion(outline), designOperations({
        op: "ui", screenId: "workshops", edit: { op: "add", parent: "screen", component: { id: "one", type: "Heading", props: { text: "Only one page" } } },
    }), "content"), /fill every outlined page/);
    assert.throws(() => patchUiDesign(outline, uiDesignVersion(outline), designOutline, "content"), /cannot change/);
    assert.throws(() => patchUiDesign(outline, uiDesignVersion(outline), designOperations(
        ...outline.document.screens.map(screen => ({ op: "ui", screenId: screen.id,
            edit: { op: "add", parent: "screen", component: { id: "spacer", type: "Spacer", props: {} } } })),
    ), "content"), /content is still needed/, "Layout-only nodes do not make a useful screen.");
    assert.equal(outline.document.screens[0].ui.nodes.screen.children.length, 0);
});

test("incremental styled changes retain unrelated nodes and support reference rebinding without fake UI edits", () => {
    const base = uiDesignFixture();
    delete base.document.fidelity;
    base.document.screens[0].ui = { ...base.document.screens[0].ui,
        tokens: { ...base.document.screens[0].ui.tokens, "color.primary": "#123456" } };
    const before = JSON.stringify(base);
    const next = patchUiDesign(base, uiDesignVersion(base), designOperations({
        op: "ui", screenId: "workshops", edit: { op: "update", id: "details", props: { text: "Pottery basics - 2 places available" } },
    }), "revision");
    assert.equal(Object.hasOwn(next.document, "fidelity"), false);
    assert.deepEqual(next.document.screens.slice(1), base.document.screens.slice(1));
    assert.deepEqual(next.document.screens[0].ui.nodes.book, base.document.screens[0].ui.nodes.book);
    assert.deepEqual(next.document.screens[0].ui.tokens, base.document.screens[0].ui.tokens);
    assert.deepEqual(next.document.transitions, base.document.transitions);
    assert.equal(JSON.stringify(base), before);
    const rebound = patchUiDesign(next, uiDesignVersion(next), designOperations(
        ...next.document.screens.filter(screen => screen.id !== "profile").map(({ ui, ...screen }) => ({
            op: "upsert-screen", screen: { ...screen, decisionIds: ["brief-booking-updated"] },
        })),
    ), "revision", ["brief-booking-updated", "brief-profile"]);
    assert.deepEqual(rebound.document.screens.map(screen => screen.ui), next.document.screens.map(screen => screen.ui));
    const contextOnly = patchUiDesign(rebound, uiDesignVersion(rebound), designOperations(), "revision");
    assert.deepEqual(contextOnly.document, rebound.document);
    assert.notEqual(uiDesignVersion(contextOnly), uiDesignVersion(rebound));
    assert.throws(() => patchUiDesign(next, uiDesignVersion(next), designOperations(), "revision", ["brief-profile"]), /outside/);
    const references = Array.from({ length: 250 }, (_, index) => `supplied-${index}`);
    const supplied = structuredClone(base);
    supplied.referenceIds = references;
    supplied.document.screens[0].decisionIds = references.slice(0, 125);
    supplied.document.screens[1].decisionIds = references.slice(125);
    supplied.document.screens[2].decisionIds = references.slice(0, 1);
    assert.deepEqual(readUiDesign(supplied), supplied, "The existing per-screen reference limit is not a new whole-design limit.");
});

test("stale edits, invalid tails, empty new screens and dangling actions cannot become a ready candidate", () => {
    const base = uiDesignFixture(), before = JSON.stringify(base);
    assert.throws(() => patchUiDesign(base, "example:1", designOperations(), "revision"), /Stale/);
    assert.throws(() => patchUiDesign(base, uiDesignVersion(base), JSON.stringify({
        op: "ui", screenId: "workshops", edit: { op: "update", id: "details", props: { text: "Valid prefix" } },
    }) + "\nnot json", "revision"), /not valid JSON/);
    assert.throws(() => patchUiDesign(base, uiDesignVersion(base), designOperations({
        op: "ui", screenId: "workshops", edit: { op: "update", id: "book", props: { action: "missing" } },
    }), "revision"), /outgoing preview transition/);
    assert.throws(() => patchUiDesign(base, uiDesignVersion(base), designOperations({
        op: "upsert-screen", screen: { id: "empty", title: "Empty", purpose: "Not yet drawn",
            decisionIds: ["brief-booking"], width: 960, height: 640, notes: "" },
    }), "revision"), /content is still needed/);
    assert.equal(JSON.stringify(base), before);
});

test("template escapes document text, keeps current state readable, and contains no consent record", async () => {
    const base = uiDesignFixture();
    const next = patchUiDesign(base, uiDesignVersion(base), designOperations({
        op: "ui", screenId: "workshops", edit: { op: "update", id: "details",
            props: { text: '</script><img src="https://invalid.example/" onerror="alert(1)">' } },
    }), "revision");
    const html = renderUiDesignHtml(await readFile(new URL("preview.html", skill), "utf8"), { current: next, previous: base });
    assert.ok(!html.includes('</script><img src="https://invalid.example/"'));
    assert.deepEqual(parseUiDesignHtml(html), { current: next, previous: base });
    assert.deepEqual(Object.keys(parseUiDesignHtml(html)).sort(), ["current", "previous"]);
    assert.throws(() => parseUiDesignHtml("<html>lost</html>"), /state is missing/);
    assert.throws(() => readUiDesign({ ...base, approved: true }), /fields/);
});

test("copied helper updates only the current temporary artifact and failed commands preserve it", async t => {
    const root = await mkdtemp(join(tmpdir(), "ui-design-skill-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const copied = join(root, "skill");
    await cp(skill, copied, { recursive: true });
    const refs = join(root, "refs.json"), outline = join(root, "outline.ndjson"), edits = join(root, "edits.ndjson");
    const preview = join(root, "preview.html"), helper = join(copied, "ui-design.mjs");
    await writeFile(refs, JSON.stringify(designReferences));
    await writeFile(outline, designOutline);
    await writeFile(edits, designContents);
    const run = (...args: string[]) => execFileSync(process.execPath, [helper, ...args], { cwd: root, encoding: "utf8" });
    const created = JSON.parse(run("create", "--operations", outline, "--references", refs, "--output", preview));
    assert.equal(created.issues.length, 3);
    const updated = JSON.parse(run("update", "--preview", preview, "--base", created.version, "--phase", "content", "--operations", edits));
    const actual = JSON.parse(run("read", "--preview", preview));
    assert.equal(updated.version, uiDesignVersion(actual.current));
    assert.equal(actual.previous.document.screens[0].ui.nodes.screen.children.length, 0);
    const bytes = await readFile(preview);
    for (const args of [
        ["update", "--preview", preview, "--base", created.version, "--phase", "revision", "--operations", edits],
        ["update", "--preview", preview, "--base", created.version + "-stale", "--phase", "revision", "--operations", edits],
        ["create", "--operations", outline, "--references", refs, "--output", preview],
        ["approve", "--preview", preview],
    ]) {
        const failed = spawnSync(process.execPath, [helper, ...args], { cwd: root, encoding: "utf8" });
        assert.notEqual(failed.status, 0);
        assert.match(failed.stderr, /UI design:/);
        assert.deepEqual(await readFile(preview), bytes);
    }
    await writeFile(edits, "malformed");
    assert.notEqual(spawnSync(process.execPath, [helper, "update", "--preview", preview,
        "--base", updated.version, "--phase", "revision", "--operations", edits], { encoding: "utf8" }).status, 0);
    assert.deepEqual(await readFile(preview), bytes);
    await writeFile(edits, designContents);
    const recovered = JSON.parse(run("update", "--preview", preview, "--base", created.version,
        "--recover-retained", "--phase", "content", "--operations", edits));
    assert.equal(recovered.version, updated.version.replace(/:2$/, ":3"));
    const retained = JSON.parse(run("read", "--preview", preview));
    assert.equal(uiDesignVersion(retained.previous), created.version);
    const imported = uiDesignFixture().document;
    delete imported.fidelity;
    const input = join(root, "import.json"), importedPreview = join(root, "import.html");
    await writeFile(input, JSON.stringify(imported));
    run("load", "--document", input, "--references", refs, "--output", importedPreview);
    assert.deepEqual(JSON.parse(run("read", "--preview", importedPreview)).current.document, imported,
        "Loading an actual styled source preserves its missing fidelity and exact reviewed components.");
    await rm(input);
    await rm(importedPreview);
    assert.deepEqual((await readdir(root)).sort(), ["edits.ndjson", "outline.ndjson", "preview.html", "refs.json", "skill"]);
});
