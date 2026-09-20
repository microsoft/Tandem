import assert from "node:assert/strict";
import { test } from "node:test";
import { createScreen, createShape, resizeScreen, setShapeBounds, shapeBounds, SketchEditor, SKETCH_SIZE_PRESETS } from "../src/renderer/sketch-editor.js";
import { validateSketchDocument } from "../src/sketch.js";
import type { SketchDocument } from "../src/sketch.js";

function drawing(): SketchDocument {
    const document: SketchDocument = { version: 1, screens: [], transitions: [] };
    document.screens.push(createScreen(document, ["accepted"]));
    return document;
}

test("screen and shape tools produce bounded canonical documents with stable safe IDs", () => {
    const document = drawing();
    const screen = document.screens[0];
    screen.width = 240;
    screen.height = 240;
    for (const kind of ["rectangle", "ellipse", "text", "line", "arrow", "path"] as const) {
        screen.shapes.push(createShape(screen, kind));
    }
    screen.shapes.push(createShape(screen, "rectangle"));
    document.screens.push(createScreen(document, ["accepted"]));
    assert.equal(validateSketchDocument(document, ["accepted"]).screens.length, 2);
    assert.equal(screen.shapes[0].id, "rectangle-1");
    assert.equal(screen.shapes.at(-1)!.id, "rectangle-2");
    assert.equal(document.screens[1].id, "screen-2");
    assert.equal(screen.shapes.find((shape) => shape.kind === "text")!.text, "Label");
});

test("manual screen creation preserves accepted DAG identities without screen-slug normalization", () => {
    const decisionIds = ["Requirement.Main_1", "A".repeat(120)];
    const screen = createScreen({ version: 1, screens: [], transitions: [] }, decisionIds);
    assert.deepEqual(screen.decisionIds, decisionIds);
    assert.notEqual(screen.decisionIds, decisionIds);
    assert.equal(screen.id, "screen-1");
    assert.deepEqual(validateSketchDocument({ version: 1, screens: [screen], transitions: [] }, decisionIds)
        .screens[0].decisionIds, decisionIds);
});

test("moving and resizing shapes clamps the entire geometry and transforms point coordinates", () => {
    const screen = drawing().screens[0];
    const shape = createShape(screen, "arrow");
    const moved = setShapeBounds(screen, shape, { x: 10000, y: -50 });
    assert.equal(moved.x + moved.width, screen.width);
    assert.equal(moved.y, 0);
    assert.deepEqual(moved.points, [{ x: 800, y: 0 }, { x: 960, y: 80 }]);
    const resized = setShapeBounds(screen, moved, { width: 80, height: 40 });
    assert.deepEqual(resized.points, [{ x: 800, y: 0 }, { x: 880, y: 40 }]);
    assert.throws(() => setShapeBounds(screen, shape, { width: Infinity }), /finite/);
    assert.throws(() => setShapeBounds(screen, shape, { x: NaN }), /finite/);
});

test("stroke editing uses absolute points even when the declared box differs or is zero-sized", () => {
    const screen = drawing().screens[0];
    const shape = { ...createShape(screen, "arrow"), x: 0, y: 0, width: 0, height: 0,
        points: [{ x: 40, y: 50 }, { x: 200, y: 90 }] };
    assert.deepEqual(shapeBounds(shape), { x: 40, y: 50, width: 160, height: 40 });
    const moved = setShapeBounds(screen, shape, { x: 60, y: 80 });
    assert.deepEqual(moved.points, [{ x: 60, y: 80 }, { x: 220, y: 120 }]);
    assert.deepEqual(shapeBounds(moved), { x: 60, y: 80, width: 160, height: 40 });
    const resized = setShapeBounds(screen, shape, { width: 80, height: 20 });
    assert.deepEqual(resized.points, [{ x: 40, y: 50 }, { x: 120, y: 70 }]);
    const bounded = setShapeBounds(screen, shape, { x: 10000, y: 10000 });
    assert.deepEqual(bounded.points, [{ x: 800, y: 600 }, { x: 960, y: 640 }]);
});

test("moving zero-width strokes preserves their shape and explicit resizing can widen them", () => {
    const screen = drawing().screens[0];
    const line = { ...createShape(screen, "line"), points: [{ x: 10, y: 10 }, { x: 10, y: 100 }] };
    const moved = setShapeBounds(screen, line, { x: 20 });
    assert.equal(moved.width, 0);
    assert.deepEqual(moved.points, [{ x: 20, y: 10 }, { x: 20, y: 100 }]);
    const resized = setShapeBounds(screen, line, { width: 50 });
    assert.deepEqual(resized.points, [{ x: 10, y: 10 }, { x: 60, y: 100 }]);
});

test("editor snapshots isolate saved data and undo redo restore dirty state", () => {
    const document = drawing();
    const editor = new SketchEditor();
    editor.load(document);
    document.screens[0].title = "External mutation";
    assert.equal(editor.document!.screens[0].title, "Screen 1");
    editor.edit((draft) => { draft.screens[0].title = "Edited"; });
    assert.equal(editor.dirty, true);
    editor.undo();
    assert.equal(editor.document!.screens[0].title, "Screen 1");
    assert.equal(editor.dirty, false);
    editor.redo();
    assert.equal(editor.document!.screens[0].title, "Edited");
    editor.markSaved();
    assert.equal(editor.dirty, false);
    editor.undo();
    assert.equal(editor.dirty, true);
    editor.edit((draft) => { draft.screens[0].notes = "Branch"; });
    assert.equal(editor.canRedo, false);
});

test("invalid edits are atomic and do not enter undo history", () => {
    const editor = new SketchEditor();
    editor.load(drawing());
    assert.throws(() => editor.edit((draft) => { draft.screens[0].width = 0; }), /width/);
    assert.equal(editor.document!.screens[0].width, 960);
    assert.equal(editor.dirty, false);
    assert.equal(editor.canUndo, false);
    assert.throws(() => editor.edit((draft) => {
        draft.transitions.push({ id: "next", fromScreenId: "screen-1", toScreenId: "missing", trigger: "Next", description: "" });
    }), /unknown screen/);
});

test("undoing the first manually created screen restores an empty workspace", () => {
    const editor = new SketchEditor();
    editor.edit((draft) => { draft.screens.push(createScreen(draft, ["accepted"])); });
    assert.equal(editor.dirty, true);
    editor.undo();
    assert.equal(editor.document, null);
    assert.equal(editor.dirty, false);
    editor.redo();
    assert.equal(editor.document!.screens.length, 1);
});

test("canvas presets and custom sizes preserve every shape and resize in one undoable step", () => {
    const original = drawing();
    const screen = original.screens[0];
    for (const kind of ["rectangle", "ellipse", "text", "line", "arrow", "path"] as const) {
        screen.shapes.push(createShape(screen, kind));
    }
    const editor = new SketchEditor();
    editor.load(original);
    for (const size of [...SKETCH_SIZE_PRESETS, { width: 1, height: 1 }, { width: 10000, height: 10000 }]) {
        editor.edit((draft) => resizeScreen(draft.screens[0], size.width, size.height));
        const resized = editor.document!.screens[0];
        assert.equal(resized.width, size.width);
        assert.equal(resized.height, size.height);
        assert.deepEqual(resized.shapes, screen.shapes);
        assert.deepEqual(validateSketchDocument(editor.document), editor.document);
    }
    editor.load(original);
    editor.edit((draft) => resizeScreen(draft.screens[0], 100, 100));
    assert.equal(editor.dirty, true);
    editor.undo();
    assert.deepEqual(editor.document, original);
    assert.equal(editor.dirty, false);
    assert.equal(editor.canUndo, false);
    editor.redo();
    assert.equal(editor.document!.screens[0].width, 100);
    assert.deepEqual(editor.document!.screens[0].shapes, screen.shapes);
    for (const value of [0, -1, 10001, 1.5, NaN, Infinity]) {
        assert.throws(() => editor.edit((draft) => resizeScreen(draft.screens[0], value, 640)), /whole numbers/);
        assert.equal(editor.document!.screens[0].width, 100);
    }
});

test("editing shapes after a canvas shrink does not truncate hidden geometry or change the other axis", () => {
    const screen = drawing().screens[0];
    const arrow = createShape(screen, "arrow");
    resizeScreen(screen, 50, 50);
    assert.deepEqual(setShapeBounds(screen, arrow, {}), arrow);
    const moved = setShapeBounds(screen, arrow, { y: 30 });
    assert.equal(moved.x, arrow.x);
    assert.equal(moved.width, arrow.width);
    assert.equal(moved.height, arrow.height);
    assert.deepEqual(moved.points, arrow.points.map((point) => ({ x: point.x, y: point.y - 10 })));
});
