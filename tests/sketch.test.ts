import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import {
    emptySketchState, readSketchState, renderSketchSvg, legacySketchDocumentSchema as sketchDocumentSchema, validateSketchDocument,
    type SketchApproval, type SketchDocument, type SketchRevision, type SketchShape,
} from "../src/sketch.js";

function shape(overrides: Partial<SketchShape> = {}): SketchShape {
    return {
        id: "heading", kind: "text", x: 10, y: 10, width: 200, height: 40,
        text: "Welcome", points: [], stroke: "none", fill: "#123abc", fontSize: 20, ...overrides,
    };
}

function document(): SketchDocument {
    return {
        version: 1,
        screens: [{
            id: "home", title: "Home", purpose: "Start an accepted workflow", decisionIds: ["entry-point"],
            width: 320, height: 240, shapes: [shape()], notes: "",
        }],
        transitions: [],
    };
}

function revision(number = 1): SketchRevision {
    return {
        id: randomUUID(), number, requirementsDigest: "a".repeat(64), documentHash: "b".repeat(64),
        createdAt: "2026-09-20T06:00:00.000Z", source: "generated",
    };
}

function approval(current: SketchRevision): SketchApproval {
    const path = `.tandem/efforts/example/sketches/${current.id}`;
    return {
        revisionId: current.id, requirementsDigest: current.requirementsDigest, documentHash: current.documentHash,
        approvedAt: "2026-09-20T06:01:00.000Z",
        assets: [
            { id: "document", path: `${path}/document.json`, hash: current.documentHash, mediaType: "application/json" },
            { id: "home-svg", path: `${path}/home.svg`, hash: "c".repeat(64), mediaType: "image/svg+xml" },
            { id: "home-png", path: `${path}/home.png`, hash: "d".repeat(64), mediaType: "image/png" },
        ],
    };
}

test("sketch validates a complete scene, transitions, and accepted decision references without mutating inputs", () => {
    const input = document();
    input.screens.push({ ...structuredClone(input.screens[0]), id: "details", decisionIds: ["details-view"] });
    input.transitions.push({ id: "open-details", fromScreenId: "home", toScreenId: "details", trigger: "Select details", description: "" });
    const before = structuredClone(input);
    const result = validateSketchDocument(input, ["entry-point", "details-view"]);
    assert.deepEqual(result, before);
    assert.notEqual(result.screens[0], input.screens[0]);
    assert.deepEqual(input, before);
    assert.deepEqual(sketchDocumentSchema.required, ["version", "screens", "transitions"]);
    assert.equal(sketchDocumentSchema.additionalProperties, false);
});

test("sketch accepts cross-realm plain documents, state, and approval metadata but rejects class instances", () => {
    const inRealm = (value: unknown) => runInNewContext("JSON.parse(serialized)", { serialized: JSON.stringify(value) });
    const input = document();
    assert.deepEqual(validateSketchDocument(inRealm(input)), input);
    assert.equal(renderSketchSvg(inRealm(input.screens[0])), renderSketchSvg(input.screens[0]));
    const current = revision();
    const state = { version: 1, status: "approved", current, approved: approval(current), history: [current] };
    assert.deepEqual(readSketchState(inRealm(state)), state);
    assert.deepEqual(validateSketchDocument(Object.assign(Object.create(null), input)), input);
    const instance = runInNewContext("new (class Scene { constructor(value) { Object.assign(this, JSON.parse(value)); } })(serialized)", {
        serialized: JSON.stringify(input),
    });
    assert.throws(() => validateSketchDocument(instance), /plain object/);
    class Scene { constructor() { Object.assign(this, input); } }
    assert.throws(() => validateSketchDocument(new Scene()), /plain object/);
    const nested = inRealm(input);
    nested.screens[0].shapes[0] = Object.assign(Object.create({ custom: true }), nested.screens[0].shapes[0]);
    assert.throws(() => validateSketchDocument(nested), /plain object/);
});

test("sketch renders every native primitive deterministically and escapes untrusted text", () => {
    const input = document().screens[0];
    input.title = 'Home <script>"&\'';
    input.shapes = [
        shape({ text: '<script>alert("hello")</script>&\'', id: "label" }),
        shape({ kind: "rectangle", id: "box", text: "" }),
        shape({ kind: "ellipse", id: "oval", text: "" }),
        shape({ kind: "line", id: "divider", x: 0, y: 0, width: 0, height: 40, points: [{ x: 0, y: 0 }, { x: 0, y: 40 }] }),
        shape({ kind: "arrow", id: "next", points: [{ x: 10, y: 10 }, { x: 200, y: 40 }] }),
        shape({ kind: "path", id: "freehand", points: [{ x: 10, y: 10 }, { x: 20, y: 15 }, { x: 40, y: 40 }] }),
    ];
    const svg = renderSketchSvg(input);
    assert.equal(svg, renderSketchSvg(structuredClone(input)));
    assert.match(svg, /width="320" height="240" viewBox="0 0 320 240"/);
    for (const item of input.shapes) assert.ok(svg.includes(`<g data-shape-id="${item.id}">`));
    for (const tag of ["<rect ", "<ellipse ", "<text ", "<line ", '<path d="M 10 10 L 20 15 L 40 40"']) {
        assert.ok(svg.includes(tag));
    }
    assert.match(svg, /&lt;script&gt;alert\(&quot;hello&quot;\)&lt;\/script&gt;&amp;&apos;/);
    assert.doesNotMatch(svg, /<script|foreignObject|<image|href=|onload=/);
    assert.throws(() => renderSketchSvg({ ...input, shapes: [shape({ fill: 'url("https://example.test")' })] }), /color/);
});

test("sketch preserves accepted Requirements IDs independently of safe scene filename IDs", () => {
    const input = document();
    const ids = ["Requirement.Entry_Point", "Decision_2", "D".repeat(120)];
    input.screens[0].decisionIds = ids;
    assert.deepEqual(validateSketchDocument(input, ids).screens[0].decisionIds, ids);
    assert.throws(() => validateSketchDocument(input, ids.map((id) => id.toLowerCase())), /accepted requirements DAG/);
    for (const id of ["x".repeat(121), "contains spaces", "path/to/decision"]) {
        input.screens[0].decisionIds = [id];
        assert.throws(() => validateSketchDocument(input, [id]), /decision ID/);
    }
    input.screens[0].decisionIds = ids;
    input.screens[0].id = "Uppercase_screen";
    assert.throws(() => validateSketchDocument(input, ids), /safe lowercase slug/);
});

test("sketch curve metadata is optional, path-only, preserved without defaults, and exposed in the schema", () => {
    const input = document();
    const points = [{ x: 10, y: 10 }, { x: 20, y: 30 }, { x: 40, y: 10 }];
    input.screens[0].shapes = [
        shape({ id: "legacy", kind: "path", points }),
        shape({ id: "quadratic", kind: "path", points, curve: "quadratic", closed: true }),
        shape({ id: "cubic", kind: "path", points: [...points, { x: 50, y: 20 }], curve: "cubic", closed: false }),
        shape({ id: "spline", kind: "path", points, curve: "catmull-rom", tension: 0.5, closed: true }),
    ];
    assert.deepEqual(validateSketchDocument(input), input);
    const svg = renderSketchSvg(input.screens[0]);
    assert.match(svg, /<path d="M 10 10 L 20 30 L 40 10"/, "legacy filled paths keep their original open stroke");
    assert.match(svg, /<path d="M 10 10 Q 20 30 40 10 Z"/);
    assert.match(svg, /<path d="M 10 10 C 20 30 40 10 50 20"/);
    assert.equal(Object.hasOwn(validateSketchDocument(input).screens[0].shapes[0], "curve"), false);
    const schema = sketchDocumentSchema.properties.screens.items.properties.shapes.items;
    assert.deepEqual(schema.properties.curve.enum, ["linear", "quadratic", "cubic", "catmull-rom"]);
    assert.equal(schema.required.includes("curve"), false);
    assert.deepEqual(schema.properties.tension, { type: "number", minimum: 0, maximum: 1 });
});

test("sketch rejects malformed curve segments, non-path metadata, and invalid tension atomically", () => {
    const points = [{ x: 10, y: 10 }, { x: 20, y: 30 }, { x: 40, y: 10 }];
    const invalid: Array<Record<string, unknown>> = [
        { curve: "bezier" }, { curve: null }, { curve: undefined }, { closed: null }, { closed: 1 }, { closed: "true" },
        { curve: "quadratic", points: points.slice(0, 2) }, { curve: "quadratic", points: [...points, points[0]] },
        { curve: "cubic", points }, { curve: "cubic", points: [...points, ...points] },
        { tension: 0 }, { curve: "linear", tension: 0 }, { curve: "quadratic", tension: 0 },
        ...[-0.01, 1.01, NaN, Infinity, null, "0", undefined].map((tension) => ({ curve: "catmull-rom", tension })),
        ...["rectangle", "ellipse", "text", "line", "arrow"].flatMap((kind) =>
            [{ kind, curve: "linear" }, { kind, closed: false }, { kind, tension: 0 }]),
        { curve: "catmull-rom", pathData: "M 0 0 C 1 2 3 4 5 6" },
    ];
    for (const metadata of invalid) {
        const input = document();
        Object.assign(input.screens[0].shapes[0], { kind: "path", points }, metadata);
        const before = structuredClone(input);
        assert.throws(() => validateSketchDocument(input), /Invalid sketch/, JSON.stringify(metadata));
        assert.deepEqual(input, before);
    }
});

test("sketch text uses solid ink rather than outlined glyphs for wireframe defaults", () => {
    const screen = document().screens[0];
    screen.shapes = [shape({ fill: "none", stroke: "#222222" })];
    assert.match(renderSketchSvg(screen), /<text [^>]*fill="#222222" stroke="none"/);
    assert.doesNotMatch(renderSketchSvg(screen), /<text [^>]*stroke-width=/);
    screen.shapes[0].fill = "#abcdef";
    assert.match(renderSketchSvg(screen), /<text [^>]*fill="#abcdef" stroke="none"/);
});

test("sketch rejects unsupported fields, references, duplicate identities, and unsafe slugs", () => {
    const invalid: Array<(input: SketchDocument) => void> = [
        (input) => { input.version = 2 as 1; },
        (input) => { (input as unknown as Record<string, unknown>).html = "<svg/>"; },
        (input) => { input.screens[0].decisionIds = []; },
        (input) => { input.screens[0].decisionIds.push("entry-point"); },
        (input) => { input.screens.push(structuredClone(input.screens[0])); },
        (input) => { input.screens[0].shapes.push(structuredClone(input.screens[0].shapes[0])); },
        (input) => { input.screens[0].id = "../escape"; },
        (input) => { input.screens[0].id = "con"; },
        (input) => { input.screens[0].shapes[0].id = "a".repeat(81); },
        (input) => { input.screens[0].shapes[0].id = "Uppercase"; },
        (input) => { delete (input.screens[0].shapes[0] as Partial<SketchShape>).text; },
        (input) => { input.transitions = [{ id: "missing", fromScreenId: "home", toScreenId: "unknown", trigger: "Go", description: "" }]; },
        (input) => {
            const transition = { id: "loop", fromScreenId: "home", toScreenId: "home", trigger: "Refresh", description: "" };
            input.transitions = [transition, { ...transition }];
        },
    ];
    for (const mutate of invalid) {
        const input = document();
        mutate(input);
        assert.throws(() => validateSketchDocument(input), /Invalid sketch/);
    }
    assert.throws(() => validateSketchDocument(document(), ["another-decision"]), /accepted requirements DAG/);
    for (const value of [null, {}, undefined, [], "text"]) assert.throws(() => validateSketchDocument(value), /Invalid sketch/);
});

test("sketch rejects nonfinite, out-of-range, malformed, and zero box geometry", () => {
    for (const change of [
        { x: -1 }, { y: Number.NaN }, { width: Infinity }, { height: 0 }, { width: 0 },
        { x: 9999, width: 2 }, { y: 9990, height: 20 }, { fontSize: 0 }, { fontSize: 501 },
        { fill: "#fff" }, { stroke: "red" }, { points: [{ x: 0, y: 0 }] },
        { kind: "line", points: [] }, { kind: "arrow", points: [{ x: 0, y: 0 }] },
        { kind: "line", points: [{ x: 0, y: 0 }, { x: 10001, y: 0 }] },
        { kind: "path", points: [] }, { text: "\ud800" }, { text: "\0" },
    ] as Array<Partial<SketchShape>>) {
        const input = document();
        input.screens[0].shapes[0] = shape(change);
        assert.throws(() => validateSketchDocument(input), /Invalid sketch/);
    }
    for (const size of [{ width: 0 }, { height: 10001 }, { width: 320.5 }, { height: NaN }]) {
        const input = document();
        Object.assign(input.screens[0], size);
        assert.throws(() => validateSketchDocument(input), /screen/);
    }
});

test("sketch supports canvas size boundaries and preserves clipped geometry without changing serialized SVG format", () => {
    const input = document();
    const shapes = structuredClone(input.screens[0].shapes);
    for (const dimension of [1, 10000]) {
        input.screens[0].width = dimension;
        input.screens[0].height = dimension;
        assert.deepEqual(validateSketchDocument(input).screens[0].shapes, shapes);
        assert.match(renderSketchSvg(input.screens[0]), new RegExp(`width="${dimension}" height="${dimension}" viewBox="0 0 ${dimension} ${dimension}"`));
    }
    assert.deepEqual(sketchDocumentSchema.properties.screens.items.properties.width, { type: "integer", minimum: 1, maximum: 10000 });
    assert.deepEqual(sketchDocumentSchema.properties.screens.items.properties.height, { type: "integer", minimum: 1, maximum: 10000 });
});

test("sketch enforces collection, text, point, and UTF-8 document byte limits", () => {
    const invalid: Array<(input: SketchDocument) => void> = [
        (input) => { input.screens = Array.from({ length: 9 }, (_, index) => ({ ...input.screens[0], id: `screen-${index}` })); },
        (input) => { input.screens[0].notes = "n".repeat(4001); },
        (input) => { input.screens[0].shapes[0].text = "t".repeat(501); },
        (input) => { input.screens[0].shapes = Array.from({ length: 101 }, (_, index) => shape({ id: `shape-${index}` })); },
        (input) => { input.screens[0].shapes = [shape({ kind: "path", points: Array.from({ length: 513 }, () => ({ x: 0, y: 0 })) })]; },
        (input) => { input.transitions = Array.from({ length: 41 }, (_, index) => ({ id: `loop-${index}`, fromScreenId: "home", toScreenId: "home", trigger: "Refresh", description: "" })); },
    ];
    for (const mutate of invalid) {
        const input = document();
        mutate(input);
        assert.throws(() => validateSketchDocument(input), /Invalid sketch/);
    }
    const large = document();
    large.screens = Array.from({ length: 3 }, (_, screen) => ({
        ...large.screens[0], id: `screen-${screen}`,
        shapes: Array.from({ length: 100 }, (_, index) => shape({ id: `shape-${index}`, text: "界".repeat(500) })),
    }));
    assert.throws(() => validateSketchDocument(large), /256 KiB/);
    const boundary = document();
    boundary.screens[0].shapes = [shape({
        kind: "path", text: "t".repeat(500), points: Array.from({ length: 512 }, () => ({ x: 320, y: 240 })),
    })];
    boundary.screens[0].notes = "n".repeat(4000);
    assert.doesNotThrow(() => validateSketchDocument(boundary));
});

test("sketch state migrates only undefined and preserves validated revision and approval history", () => {
    assert.deepEqual(readSketchState(undefined), emptySketchState());
    assert.notEqual(emptySketchState().history, emptySketchState().history);
    const current = revision();
    const approved = approval(current);
    const state = { version: 1, status: "approved", current, approved, history: [current] };
    assert.deepEqual(readSketchState(state), state);
    const next = revision(2);
    assert.deepEqual(readSketchState({ ...state, status: "stale", current: next, history: [current, next] }).approved, approved);
    assert.throws(() => readSketchState({ ...state, current: next }), /approval does not match/);
    const labeledAssets = {
        ...approved,
        assets: approved.assets.map((asset, index) => ({ ...asset, id: ["Canonical document", "Home.svg", "screen:home:preview"][index] })),
    };
    assert.deepEqual(readSketchState({ ...state, approved: labeledAssets }).approved, labeledAssets);
});

test("sketch state rejects malformed persistence, mismatched metadata, and history overflow", () => {
    const current = revision();
    const base = { version: 1, status: "draft", current, approved: null, history: [current] };
    const cases = [
        null, {}, [], { ...emptySketchState(), current }, { ...base, version: 2 },
        { ...base, status: "approved" }, { ...base, current: null },
        { ...base, current: { ...current, documentHash: "bad" } },
        { ...base, current: { ...current, id: "../outside" } },
        { ...base, current: { ...current, source: "uploaded" } },
        { ...base, current: { ...current, createdAt: "2026-02-30T00:00:00.000Z" } },
        { ...base, current: { ...current, number: 0 } },
        { ...base, current: { ...current, source: "edited" } },
        { ...base, history: [current, current] },
        { ...base, history: [current, { ...revision(2), number: 1 }] },
        { ...base, history: Array.from({ length: 201 }, (_, index) => revision(index + 1)) },
    ];
    for (const value of cases) assert.throws(() => readSketchState(value), /Invalid sketch/);
    const validApproval = approval(current);
    for (const altered of [
        { ...validApproval, requirementsDigest: "c".repeat(64) },
        { ...validApproval, documentHash: "c".repeat(64) },
        { ...validApproval, assets: validApproval.assets.slice(0, 2) },
        { ...validApproval, assets: [validApproval.assets[0], validApproval.assets[0], validApproval.assets[2]] },
        { ...validApproval, assets: validApproval.assets.map((asset) => ({ ...asset, path: "../outside.png" })) },
        { ...validApproval, assets: validApproval.assets.map((asset) => ({ ...asset, path: ".tandem" })) },
        { ...validApproval, assets: validApproval.assets.map((asset) => ({ ...asset, path: asset.path.replace(current.id, randomUUID()) })) },
        { ...validApproval, assets: validApproval.assets.map((asset) => ({ ...asset, mediaType: "image/png" })) },
    ]) {
        assert.throws(() => readSketchState({ ...base, status: "approved", approved: altered }), /Invalid sketch/);
    }
});
