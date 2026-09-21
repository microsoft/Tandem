import assert from "node:assert/strict";
import { test } from "node:test";
import {
    MAX_SKETCH_STREAM_OPERATIONS,
    MAX_SKETCH_STREAM_RECORD_BYTES,
    MAX_SKETCH_STREAM_RESPONSE_BYTES,
    SketchOperationStream,
    type SketchPreview,
} from "../src/sketch-stream.js";
import {
    validateSketchDocument,
    type SketchDocument,
    type SketchScreen,
    type SketchShape,
    type SketchTransition,
} from "../src/sketch.js";

const decisions = ["entry-point", "details-view"];
const done = JSON.stringify({ op: "done" });

function shape(overrides: Partial<SketchShape> = {}): SketchShape {
    return {
        id: "heading", kind: "text", x: 10, y: 10, width: 200, height: 40,
        text: "Welcome", points: [], stroke: "none", fill: "#123abc", fontSize: 20, ...overrides,
    };
}

function screen(overrides: Partial<SketchScreen> = {}): SketchScreen {
    return {
        id: "home", title: "Home", purpose: "Start an accepted workflow", decisionIds: ["entry-point"],
        width: 320, height: 240, shapes: [shape()], notes: "Keep this annotation", ...overrides,
    };
}

function metadata(overrides: Partial<Omit<SketchScreen, "shapes">> = {}): Omit<SketchScreen, "shapes"> {
    const { shapes: _shapes, ...value } = screen();
    return { ...value, ...overrides };
}

function transition(overrides: Partial<SketchTransition> = {}): SketchTransition {
    return { id: "open-details", fromScreenId: "home", toScreenId: "details", trigger: "Select details", description: "Keep this flow", ...overrides };
}

function document(): SketchDocument {
    return {
        version: 1,
        screens: [
            screen({
                shapes: [shape(), shape({
                    id: "annotation", kind: "path", text: "Handwritten note", stroke: "#222222", fill: "none",
                    points: [{ x: 10, y: 10 }, { x: 20, y: 15 }, { x: 40, y: 40 }],
                })],
            }),
            screen({ id: "details", title: "Details", decisionIds: ["details-view"], notes: "Do not replace this screen" }),
        ],
        transitions: [transition(), transition({ id: "return-home", fromScreenId: "details", toScreenId: "home", trigger: "Back" })],
    };
}

function line(value: unknown): string {
    return `${JSON.stringify(value)}\n`;
}

function generation(): string {
    return line({ op: "upsert-screen", screen: metadata({ title: "首頁 👋", notes: "Draw 漢字 and emoji 🖊️" }) })
        + line({ op: "upsert-shape", screenId: "home", shape: shape({ text: "Hello 👩‍💻" }) })
        + done;
}

function expectPoisoned(stream: SketchOperationStream, error: RegExp): void {
    assert.throws(() => stream.append(`${done}\n`), error);
    assert.throws(() => stream.append(""), error);
    assert.throws(() => stream.complete(), error);
}

test("sketch stream generates a screen and shapes, publishing the first preview before completion", () => {
    const snapshots: Array<{ document: SketchDocument; sequence: number }> = [];
    const stream = new SketchOperationStream(null, decisions, (document, sequence) => snapshots.push({ document, sequence }));
    assert.equal(stream.document, null);
    assert.equal(stream.sequence, 0);
    const first = line({ op: "upsert-screen", screen: metadata() });
    stream.append(first.slice(0, -1));
    assert.equal(snapshots.length, 0);
    stream.append("\n");
    assert.equal(snapshots.length, 1);
    assert.deepEqual(snapshots[0], {
        document: { version: 1, screens: [screen({ shapes: [] })], transitions: [] },
        sequence: 1,
    });
    stream.append(line({ op: "upsert-shape", screenId: "home", shape: shape() }));
    assert.equal(snapshots.length, 2);
    assert.equal(stream.sequence, 2);
    assert.deepEqual(snapshots[0].document.screens[0].shapes, []);
    stream.append(done);
    assert.equal(snapshots.length, 2);
    assert.deepEqual(stream.complete(), { version: 1, screens: [screen()], transitions: [] });
    assert.equal(stream.sequence, 2);
    const preview: SketchPreview = {
        prototypeId: "prototype", generation: "generation", requestId: "request", runId: "run",
        baseRevisionId: null, requirementsDigest: "a".repeat(64), sequence: stream.sequence, document: stream.complete(),
    };
    assert.equal(preview.document.screens[0].id, "home");
});

test("sketch stream accepts every character split, including surrogate-pair and CRLF boundaries", () => {
    const input = `\r\n \t\r\n${generation().replaceAll("\n", "\r\n")}`;
    const whole = new SketchOperationStream(null, decisions);
    whole.append(input);
    const expected = whole.complete();
    for (let split = 0; split <= input.length; split++) {
        const stream = new SketchOperationStream(null, decisions);
        stream.append(input.slice(0, split));
        stream.append("");
        stream.append(input.slice(split));
        assert.deepEqual(stream.complete(), expected, `split at code unit ${split}`);
    }
    const singleCharacters = new SketchOperationStream(null, decisions);
    for (const character of input.split("")) singleCharacters.append(character);
    assert.deepEqual(singleCharacters.complete(), expected);
    const singleBytes = new SketchOperationStream(null, decisions);
    const decoder = new TextDecoder();
    for (const byte of new TextEncoder().encode(input)) {
        singleBytes.append(decoder.decode(Uint8Array.of(byte), { stream: true }));
    }
    singleBytes.append(decoder.decode());
    assert.deepEqual(singleBytes.complete(), expected);
});

test("sketch stream revises one shape without losing screens, annotations, transitions, or shape order", () => {
    const base = document();
    const before = structuredClone(base);
    const snapshots: SketchDocument[] = [];
    const stream = new SketchOperationStream(base, decisions, (snapshot) => snapshots.push(snapshot));
    const replacement = shape({ text: "Updated heading", width: 180 });
    stream.append(line({ op: "upsert-shape", screenId: "home", shape: replacement }));
    stream.append(done);
    const expected = structuredClone(before);
    expected.screens[0].shapes[0] = replacement;
    assert.deepEqual(stream.complete(), expected);
    assert.deepEqual(base, before);
    assert.deepEqual(snapshots, [expected]);
});

test("sketch streams preserve curve metadata through previews and complete-segment replacements", () => {
    const base = document();
    const snapshots: SketchDocument[] = [];
    const stream = new SketchOperationStream(base, decisions, (snapshot) => snapshots.push(snapshot));
    const points = [{ x: 10, y: 20 }, { x: 30, y: 40 }, { x: 50, y: 20 }, { x: 70, y: 40 }];
    const cubic = shape({ id: "bezier", kind: "path", points, curve: "cubic", closed: true });
    const spline = shape({ id: "spline", kind: "path", points, curve: "catmull-rom", closed: false, tension: 0.4 });
    const quadratic = shape({ id: "quadratic", kind: "path", points: points.slice(0, 3), curve: "quadratic" });
    for (const value of [cubic, spline, quadratic]) stream.append(line({ op: "upsert-shape", screenId: "home", shape: value }));
    const appended = { ...cubic, points: [...points, ...points.slice(1)] };
    stream.append(line({ op: "upsert-shape", screenId: "home", shape: appended }));
    stream.append(done);
    assert.deepEqual(stream.complete().screens[0].shapes.slice(2), [appended, spline, quadratic]);
    assert.deepEqual(snapshots[0].screens[0].shapes.at(-1), cubic);
    assert.deepEqual(base, document());
    const invalid = new SketchOperationStream(stream.complete(), decisions);
    const before = invalid.document;
    assert.throws(() => invalid.append(line({
        op: "upsert-shape", screenId: "home", shape: { ...appended, points: [...appended.points, points[0]] },
    })), /cubic/);
    assert.deepEqual(invalid.document, before);
    assert.equal(invalid.sequence, 0);
});

test("sketch stream upserts screen metadata without replacing shapes or changing screen order", () => {
    const base = document();
    const stream = new SketchOperationStream(base, decisions);
    const replacement = metadata({ title: "Revised home", notes: "Revised notes", width: 1, height: 1 });
    stream.append(line({ op: "upsert-screen", screen: replacement }));
    stream.append(line({ op: "upsert-screen", screen: metadata({ id: "summary", title: "Summary" }) }));
    stream.append(done);
    const expected = structuredClone(base);
    expected.screens[0] = { ...replacement, shapes: expected.screens[0].shapes };
    expected.screens.push({ ...metadata({ id: "summary", title: "Summary" }), shapes: [] });
    assert.deepEqual(stream.complete(), expected);
    assert.deepEqual(stream.complete().screens.map((item) => item.id), ["home", "details", "summary"]);
});

test("sketch stream upserts transitions and shapes in place and appends new identities", () => {
    const base = document();
    const stream = new SketchOperationStream(base, decisions);
    const editedTransition = transition({ trigger: "Tap heading", description: "Updated flow" });
    const addedTransition = transition({ id: "refresh", toScreenId: "home", trigger: "Refresh" });
    stream.append(line({ op: "upsert-transition", transition: editedTransition }));
    stream.append(line({ op: "upsert-transition", transition: addedTransition }));
    stream.append(line({ op: "upsert-shape", screenId: "details", shape: shape({ id: "new-shape" }) }));
    stream.append(line({ op: "upsert-shape", screenId: "details", shape: shape({ text: "Updated details heading" }) }));
    stream.append(done);
    const result = stream.complete();
    assert.deepEqual(result.transitions, [editedTransition, base.transitions[1], addedTransition]);
    assert.deepEqual(result.screens[1].shapes.map((item) => item.id), ["heading", "new-shape"]);
    assert.equal(result.screens[1].shapes[0].text, "Updated details heading");
    assert.equal(stream.sequence, 4);
});

test("sketch stream removes shapes and transitions and only removes transitions incident to a removed screen", () => {
    const base = document();
    base.screens.push(screen({ id: "summary" }));
    const unaffected = transition({ id: "details-summary", fromScreenId: "details", toScreenId: "summary" });
    base.transitions.push(unaffected);
    const stream = new SketchOperationStream(base, decisions);
    stream.append(line({ op: "remove-shape", screenId: "home", shapeId: "heading" }));
    assert.deepEqual(stream.document!.screens[0].shapes.map((item) => item.id), ["annotation"]);
    stream.append(line({ op: "remove-transition", transitionId: "open-details" }));
    assert.deepEqual(stream.document!.transitions.map((item) => item.id), ["return-home", "details-summary"]);
    stream.append(line({ op: "remove-screen", screenId: "home" }));
    stream.append(done);
    assert.deepEqual(stream.complete(), { version: 1, screens: base.screens.slice(1), transitions: [unaffected] });
    assert.equal(stream.sequence, 3);
});

test("sketch stream forbids removing the last screen but allows adding its replacement first", () => {
    const base: SketchDocument = { version: 1, screens: [screen()], transitions: [] };
    const stream = new SketchOperationStream(base, decisions);
    assert.throws(() => stream.append(line({ op: "remove-screen", screenId: "home" })), /last screen.*replacement first/);
    assert.deepEqual(stream.document, base);
    assert.equal(stream.sequence, 0);
    expectPoisoned(stream, /last screen/);
    const replacement = new SketchOperationStream(base, decisions);
    replacement.append(line({ op: "upsert-screen", screen: metadata({ id: "replacement" }) }));
    replacement.append(line({ op: "remove-screen", screenId: "home" }));
    replacement.append(done);
    assert.deepEqual(replacement.complete().screens.map((item) => item.id), ["replacement"]);
});

test("sketch stream rejects unknown references and removals atomically", () => {
    const cases = [
        { op: "remove-screen", screenId: "missing" },
        { op: "upsert-shape", screenId: "missing", shape: shape() },
        { op: "remove-shape", screenId: "missing", shapeId: "heading" },
        { op: "remove-shape", screenId: "home", shapeId: "missing" },
        { op: "remove-transition", transitionId: "missing" },
        { op: "upsert-transition", transition: transition({ fromScreenId: "missing" }) },
        { op: "upsert-transition", transition: transition({ toScreenId: "missing" }) },
    ];
    for (const operation of cases) {
        const base = document();
        const stream = new SketchOperationStream(base, decisions, () => assert.fail("Invalid operations must not publish a preview"));
        assert.throws(() => stream.append(line(operation)), /unknown/, JSON.stringify(operation));
        assert.deepEqual(stream.document, base);
        assert.equal(stream.sequence, 0);
        expectPoisoned(stream, /unknown/);
    }
    const empty = new SketchOperationStream(null, decisions);
    assert.throws(() => empty.append(line({ op: "upsert-shape", screenId: "home", shape: shape() })), /unknown screen/);
    assert.equal(empty.document, null);
});

test("sketch stream validates and clones its base and accepted decisions", () => {
    const base = document();
    const before = structuredClone(base);
    const accepted = [...decisions];
    const stream = new SketchOperationStream(base, accepted);
    assert.deepEqual(stream.document, before);
    assert.equal(stream.sequence, 0);
    base.screens[0].shapes[1].points[0].x = 999;
    base.screens[0].decisionIds[0] = "not-accepted";
    base.transitions[0].trigger = "Changed caller input";
    accepted.splice(0, accepted.length, "not-accepted");
    stream.append(line({ op: "upsert-shape", screenId: "home", shape: shape({ text: "New label" }) }));
    stream.append(done);
    const expected = structuredClone(before);
    expected.screens[0].shapes[0].text = "New label";
    assert.deepEqual(stream.complete(), expected);
    assert.throws(() => new SketchOperationStream(base, decisions), /accepted requirements DAG/);
    assert.throws(() => new SketchOperationStream({ ...before, screens: [] }, decisions), /screens/);
    for (const value of [null, "entry-point", [1]]) {
        assert.throws(() => new SketchOperationStream(null, value as unknown as string[]), /accepted decision IDs/);
    }
});

test("sketch stream snapshots, getters, and completed documents cannot mutate internal state or each other", () => {
    const snapshots: SketchDocument[] = [];
    const stream = new SketchOperationStream(document(), decisions, (snapshot) => snapshots.push(snapshot));
    stream.append(line({ op: "upsert-shape", screenId: "home", shape: shape({ text: "First" }) }));
    const first = structuredClone(snapshots[0]);
    const exposed = stream.document!;
    exposed.screens[0].shapes[1].points[0].x = 999;
    exposed.screens[0].decisionIds.push("outside-dag");
    exposed.transitions.length = 0;
    stream.append(line({ op: "upsert-shape", screenId: "home", shape: shape({ text: "Second" }) }));
    assert.deepEqual(snapshots[0], first);
    snapshots[0].screens[0].shapes[1].points[0].x = 888;
    snapshots[1].screens[0].decisionIds.length = 0;
    snapshots[1].transitions[0].trigger = "Corrupt callback snapshot";
    stream.append(done);
    const result = stream.complete();
    const expected = document();
    expected.screens[0].shapes[0].text = "Second";
    assert.deepEqual(result, expected);
    result.screens[0].shapes[1].points[0].x = 777;
    result.transitions.length = 0;
    assert.deepEqual(stream.document, expected);
    assert.deepEqual(stream.complete(), expected);
});

test("sketch stream isolates immediate callback mutation and latches callback errors", () => {
    const stream = new SketchOperationStream(null, decisions, (snapshot) => {
        snapshot.screens[0].decisionIds.length = 0;
        snapshot.screens.length = 0;
    });
    stream.append(line({ op: "upsert-screen", screen: metadata() }));
    stream.append(line({ op: "upsert-shape", screenId: "home", shape: shape() }));
    stream.append(done);
    assert.deepEqual(stream.complete().screens, [screen()]);
    const failed = new SketchOperationStream(null, decisions, () => { throw new Error("Preview delivery failed"); });
    assert.throws(() => failed.append(line({ op: "upsert-screen", screen: metadata() })), /Preview delivery failed/);
    expectPoisoned(failed, /Preview delivery failed/);
});

test("sketch stream cannot complete after a preview ownership callback fails partway through a response", () => {
    const ownershipFailure = new Error("Preview ownership lost");
    const sequences: number[] = [];
    const stream = new SketchOperationStream(null, decisions, (_document, sequence) => {
        sequences.push(sequence);
        if (sequence === 2) throw ownershipFailure;
    });
    assert.throws(() => stream.append(`${generation()}\n`), (error) => error === ownershipFailure);
    assert.deepEqual(sequences, [1, 2]);
    assert.throws(() => stream.append(""), (error) => error === ownershipFailure);
    assert.throws(() => stream.complete(), (error) => error === ownershipFailure);
    assert.throws(() => stream.append(done), (error) => error === ownershipFailure);
    assert.throws(() => stream.complete(), (error) => error === ownershipFailure);
    assert.deepEqual(sequences, [1, 2]);
});

test("sketch stream enforces exact operation, metadata, shape, and transition fields", () => {
    const valid = [
        { op: "upsert-screen", screen: metadata() },
        { op: "remove-screen", screenId: "home" },
        { op: "upsert-shape", screenId: "home", shape: shape() },
        { op: "remove-shape", screenId: "home", shapeId: "heading" },
        { op: "upsert-transition", transition: transition() },
        { op: "remove-transition", transitionId: "open-details" },
        { op: "done" },
    ];
    const cases: unknown[] = valid.flatMap((operation) => [
        { ...operation, unexpected: true },
        ...Object.keys(operation).map((key) => Object.fromEntries(Object.entries(operation).filter(([name]) => name !== key))),
    ]);
    cases.push(
        { op: "upsert-screen", screen: screen() },
        { op: "upsert-screen", screen: { ...metadata(), html: "<script/>" } },
        { op: "upsert-screen", screen: { ...metadata(), notes: undefined } },
        { op: "upsert-shape", screenId: "home", shape: { ...shape(), onload: "alert(1)" } },
        { op: "upsert-shape", screenId: "home", shape: { ...shape(), text: undefined } },
        { op: "upsert-transition", transition: { ...transition(), url: "javascript:alert(1)" } },
        { op: "upsert-transition", transition: { ...transition(), trigger: undefined } },
    );
    for (const operation of cases) {
        const stream = new SketchOperationStream(document(), decisions);
        assert.throws(() => stream.append(line(operation)), /unexpected or missing fields|unknown operation/, JSON.stringify(operation));
        assert.equal(stream.sequence, 0);
        assert.deepEqual(stream.document, document());
    }
});

test("sketch stream rejects invalid operation and field types", () => {
    const cases: unknown[] = [null, [], 1, true, "prose", {}, { op: "replace-document", document: document() }];
    for (const value of [null, [], 123, true, "text"]) {
        cases.push(
            { op: "upsert-screen", screen: value },
            { op: "upsert-shape", screenId: "home", shape: value },
            { op: "upsert-transition", transition: value },
        );
        if (typeof value !== "string") {
            cases.push(
                { op: "remove-screen", screenId: value },
                { op: "remove-shape", screenId: "home", shapeId: value },
                { op: "remove-transition", transitionId: value },
            );
        }
    }
    for (const operation of cases) {
        const stream = new SketchOperationStream(document(), decisions);
        assert.throws(() => stream.append(line(operation)), /Invalid sketch operation stream/, JSON.stringify(operation));
        expectPoisoned(stream, /Invalid sketch operation stream/);
    }
    const invalidFragment = new SketchOperationStream(null, decisions);
    assert.throws(() => invalidFragment.append(null as unknown as string), /string fragment/);
    expectPoisoned(invalidFragment, /string fragment/);
});

test("sketch stream rejects prototype injection without using identities as dynamic object keys", () => {
    const attacks = [
        '{"op":"done","__proto__":{"polluted":true}}',
        '{"op":"done","constructor":{"prototype":{"polluted":true}}}',
        JSON.stringify({ op: "upsert-screen", screen: metadata() }).replace('"notes":', '"__proto__":{"polluted":true},"notes":'),
        JSON.stringify({ op: "upsert-shape", screenId: "home", shape: shape() }).replace('"kind":', '"__proto__":{"polluted":true},"kind":'),
        JSON.stringify({ op: "upsert-shape", screenId: "home", shape: shape({ kind: "line", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }) })
            .replace('"x":0', '"x":0,"constructor":{"prototype":{"polluted":true}}'),
        JSON.stringify({ op: "upsert-transition", transition: transition() }).replace('"trigger":', '"prototype":{"polluted":true},"trigger":'),
    ];
    for (const attack of attacks) {
        const stream = new SketchOperationStream(document(), decisions);
        assert.throws(() => stream.append(`${attack}\n`), /unexpected or missing fields/);
        assert.equal(({} as Record<string, unknown>).polluted, undefined);
        assert.deepEqual(stream.document, document());
    }
    const stream = new SketchOperationStream(null, decisions);
    stream.append(line({ op: "upsert-screen", screen: metadata({ id: "constructor" }) }));
    stream.append(line({ op: "upsert-shape", screenId: "constructor", shape: shape({ id: "constructor" }) }));
    stream.append(line({ op: "upsert-shape", screenId: "constructor", shape: shape({ id: "constructor", text: "Safe replacement" }) }));
    stream.append(done);
    assert.equal(stream.complete().screens[0].shapes.length, 1);
    assert.equal(stream.complete().screens[0].shapes[0].text, "Safe replacement");
});

test("sketch stream reuses document validation for dimensions, colors, kinds, text, IDs, and accepted decisions", () => {
    const screenChanges = [
        { id: "../escape" }, { id: "__proto__" }, { id: "con" }, { width: 0 }, { height: 10001 }, { width: 2.5 },
        { title: "" }, { purpose: "x".repeat(501) }, { notes: "n".repeat(4001) }, { decisionIds: ["outside-dag"] },
        { decisionIds: [] }, { decisionIds: ["entry-point", "entry-point"] }, { decisionIds: "entry-point" },
    ];
    const shapeChanges = [
        { kind: "image" }, { stroke: "red" }, { fill: 'url("https://example.test")' }, { id: "../escape" },
        { width: 0 }, { x: -1 }, { y: 10001 }, { x: 9999, width: 2 }, { fontSize: 0 }, { fontSize: 501 },
        { text: "\ud800" }, { text: "\0" }, { text: "x".repeat(501) }, { width: "200" },
        { kind: "line", points: [] }, { kind: "arrow", points: [{ x: 0, y: 0 }] },
        { kind: "path", points: Array.from({ length: 513 }, () => ({ x: 0, y: 0 })) },
    ];
    for (const operation of [
        ...screenChanges.map((change) => ({ op: "upsert-screen", screen: { ...metadata(), ...change } })),
        ...shapeChanges.map((change) => ({ op: "upsert-shape", screenId: "home", shape: { ...shape(), ...change } })),
    ]) {
        const stream = new SketchOperationStream(document(), decisions);
        assert.throws(() => stream.append(line(operation)), /Invalid sketch:/, JSON.stringify(operation));
        assert.deepEqual(stream.document, document());
        assert.equal(stream.sequence, 0);
    }
});

test("sketch stream validates per-document and per-screen collection limits after each operation", () => {
    const cases: Array<{ base: SketchDocument; replacement: unknown; addition: unknown; error: RegExp }> = [
        {
            base: { version: 1, screens: Array.from({ length: 8 }, (_, index) => screen({ id: `screen-${index}` })), transitions: [] },
            replacement: { op: "upsert-screen", screen: metadata({ id: "screen-0", title: "Updated" }) },
            addition: { op: "upsert-screen", screen: metadata({ id: "ninth-screen" }) }, error: /screens must contain/,
        },
        {
            base: { version: 1, screens: [screen({ shapes: Array.from({ length: 100 }, (_, index) => shape({ id: `shape-${index}` })) })], transitions: [] },
            replacement: { op: "upsert-shape", screenId: "home", shape: shape({ id: "shape-0", text: "Updated" }) },
            addition: { op: "upsert-shape", screenId: "home", shape: shape({ id: "extra-shape" }) }, error: /screen shapes must contain/,
        },
        {
            base: { ...document(), transitions: Array.from({ length: 40 }, (_, index) => transition({ id: `transition-${index}` })) },
            replacement: { op: "upsert-transition", transition: transition({ id: "transition-0", trigger: "Updated" }) },
            addition: { op: "upsert-transition", transition: transition({ id: "extra-transition" }) }, error: /transitions must contain/,
        },
    ];
    for (const { base, replacement, addition, error } of cases) {
        const stream = new SketchOperationStream(base, decisions);
        stream.append(line(replacement));
        const lastGood = stream.document;
        assert.throws(() => stream.append(line(addition)), error);
        assert.deepEqual(stream.document, lastGood);
        assert.equal(stream.sequence, 1);
        expectPoisoned(stream, error);
    }
});

test("sketch stream rejects markdown, prose, malformed records, and malformed unterminated tails", () => {
    for (const malformed of [
        "```json", "Here is the sketch:", "{", '{"op":', '{"op":"done",}', '{"op":"done"} {"op":"done"}',
        '{"op":"done"} // finished', '{"op":\n"done"}',
    ]) {
        const terminated = new SketchOperationStream(document(), decisions);
        assert.throws(() => terminated.append(`${malformed}\n`), /not valid JSON/, malformed);
        expectPoisoned(terminated, /not valid JSON/);
        const tail = new SketchOperationStream(document(), decisions);
        tail.append(line({ op: "upsert-shape", screenId: "home", shape: shape() }));
        assert.throws(() => { tail.append(malformed); tail.complete(); }, /not valid JSON/, malformed);
        expectPoisoned(tail, /not valid JSON/);
    }
});

test("sketch stream requires done and at least one edit even when revising a valid base", () => {
    for (const base of [null, document()]) {
        for (const input of ["", "\r\n \t\r\n"]) {
            const stream = new SketchOperationStream(base, decisions);
            stream.append(input);
            assert.throws(() => stream.complete(), /missing done/);
            expectPoisoned(stream, /missing done/);
        }
        const noEdits = new SketchOperationStream(base, decisions);
        noEdits.append(done);
        assert.throws(() => noEdits.complete(), /at least one document-changing operation/);
        expectPoisoned(noEdits, /at least one document-changing operation/);
        const unfinished = new SketchOperationStream(base, decisions);
        unfinished.append(JSON.stringify({ op: "upsert-screen", screen: metadata() }));
        assert.throws(() => unfinished.complete(), /missing done/);
        assert.equal(unfinished.sequence, 1);
        expectPoisoned(unfinished, /missing done/);
    }
});

test("sketch stream rejects duplicate done and any non-whitespace content after done, including unterminated fragments", () => {
    for (const suffix of [done, `${done}\n`, "x", "{", "```", line({ op: "remove-screen", screenId: "home" })]) {
        for (const together of [true, false]) {
            const stream = new SketchOperationStream(null, decisions);
            const prefix = `${generation()}\n`;
            assert.throws(() => {
                if (together) stream.append(prefix + suffix);
                else { stream.append(prefix); stream.append(suffix); }
            }, /after done/, suffix);
            assert.equal(stream.sequence, 2);
            expectPoisoned(stream, /after done/);
        }
    }
    const whitespace = new SketchOperationStream(null, decisions);
    whitespace.append(`${generation()}\r\n \t\r\n`);
    const expected = whitespace.complete();
    whitespace.append(" \t\r\n");
    assert.deepEqual(whitespace.complete(), expected);
    assert.throws(() => whitespace.append(done), /after done/);
    expectPoisoned(whitespace, /after done/);
});

test("sketch stream accepts empty de-duplicated full-message and done fragments without publishing additional previews", () => {
    for (const ending of ["", "\n", "\r\n"]) {
        const sequences: number[] = [];
        const stream = new SketchOperationStream(null, decisions, (_document, sequence) => sequences.push(sequence));
        stream.append(generation() + ending);
        const before = stream.document;
        stream.append("");
        stream.append("");
        assert.equal(stream.sequence, 2);
        assert.deepEqual(stream.document, before);
        assert.deepEqual(stream.complete(), before);
        stream.append("");
        assert.equal(stream.sequence, 2);
        assert.deepEqual(sequences, [1, 2]);
    }
});

test("sketch stream accepts all 1024 edit operations and rejects the next without changing the last valid snapshot", () => {
    assert.equal(MAX_SKETCH_STREAM_OPERATIONS, 1024);
    const edit = line({ op: "upsert-shape", screenId: "home", shape: shape() });
    const complete = new SketchOperationStream(document(), decisions);
    complete.append(edit.repeat(MAX_SKETCH_STREAM_OPERATIONS));
    complete.append(done);
    assert.deepEqual(complete.complete(), document());
    assert.equal(complete.sequence, MAX_SKETCH_STREAM_OPERATIONS);
    const overflow = new SketchOperationStream(document(), decisions);
    overflow.append(edit.repeat(MAX_SKETCH_STREAM_OPERATIONS));
    assert.throws(() => overflow.append(edit), /1024 document-changing operations/);
    assert.equal(overflow.sequence, MAX_SKETCH_STREAM_OPERATIONS);
    assert.deepEqual(overflow.document, document());
    expectPoisoned(overflow, /1024 document-changing operations/);
});

test("sketch stream accepts a 256 KiB path record and rejects a record one byte larger even without a newline", () => {
    assert.equal(MAX_SKETCH_STREAM_RECORD_BYTES, 256 * 1024);
    const path = shape({
        kind: "path", text: "Ink 🖊", points: Array.from({ length: 512 }, (_, index) => ({ x: index / 3, y: index / 7 })),
    });
    const operation = JSON.stringify({ op: "upsert-shape", screenId: "home", shape: path });
    const record = operation + " ".repeat(MAX_SKETCH_STREAM_RECORD_BYTES - Buffer.byteLength(operation));
    assert.equal(Buffer.byteLength(record), MAX_SKETCH_STREAM_RECORD_BYTES);
    const stream = new SketchOperationStream(document(), decisions);
    const split = record.indexOf("🖊") + 1;
    stream.append(record.slice(0, split));
    stream.append("");
    stream.append(record.slice(split));
    assert.equal(stream.sequence, 0);
    stream.append(`\n${done}`);
    assert.deepEqual(stream.complete().screens[0].shapes[0], path);
    for (const newline of ["", "\n"]) {
        const overflow = new SketchOperationStream(document(), decisions);
        assert.throws(() => overflow.append(`${record} ${newline}`), /record exceeds 256 KiB/);
        assert.equal(overflow.sequence, 0);
        expectPoisoned(overflow, /record exceeds 256 KiB/);
    }
    const fragmented = new SketchOperationStream(document(), decisions);
    fragmented.append(record);
    assert.throws(() => fragmented.append(" "), /record exceeds 256 KiB/);
    expectPoisoned(fragmented, /record exceeds 256 KiB/);
});

function whitespaceBytes(bytes: number): string {
    const records: string[] = [];
    while (bytes > 0) {
        const spaces = Math.min(bytes - 1, MAX_SKETCH_STREAM_RECORD_BYTES - 1);
        records.push(`${" ".repeat(spaces)}\n`);
        bytes -= spaces + 1;
    }
    return records.join("");
}

test("sketch stream measures the actual 512 KiB UTF-8 response limit across surrogate splits and blank records", () => {
    assert.equal(MAX_SKETCH_STREAM_RESPONSE_BYTES, 512 * 1024);
    const input = `${generation()}\n`;
    const padding = whitespaceBytes(MAX_SKETCH_STREAM_RESPONSE_BYTES - Buffer.byteLength(input));
    assert.equal(Buffer.byteLength(input + padding), MAX_SKETCH_STREAM_RESPONSE_BYTES);
    const whole = new SketchOperationStream(null, decisions);
    whole.append(input + padding);
    const expected = whole.complete();
    const fragmented = new SketchOperationStream(null, decisions);
    for (const character of input.split("")) {
        fragmented.append(character);
        fragmented.append("");
    }
    fragmented.append(padding);
    fragmented.append("");
    assert.deepEqual(fragmented.complete(), expected);
    fragmented.append("");
    assert.throws(() => fragmented.append(" "), /response exceeds 512 KiB/);
    expectPoisoned(fragmented, /response exceeds 512 KiB/);
    const overflow = new SketchOperationStream(null, decisions);
    assert.throws(() => overflow.append(`${input}${padding} `), /response exceeds 512 KiB/);
    expectPoisoned(overflow, /response exceeds 512 KiB/);
    const oversizedFragment = new SketchOperationStream(null, decisions);
    assert.throws(() => oversizedFragment.append(" ".repeat(MAX_SKETCH_STREAM_RESPONSE_BYTES + 1)), /response exceeds 512 KiB/);
});

function documentWithBytes(bytes: number): SketchDocument {
    const value: SketchDocument = {
        version: 1,
        screens: Array.from({ length: 2 }, (_, index) => screen({
            id: `screen-${index}`,
            shapes: Array.from({ length: 100 }, (_, index) => shape({ id: `shape-${index}`, text: "" })),
        })),
        transitions: [],
    };
    let remaining = bytes - Buffer.byteLength(JSON.stringify(value));
    for (const item of value.screens.flatMap((screen) => screen.shapes)) {
        const budget = Math.min(1500, remaining);
        item.text = "界".repeat(Math.floor(budget / 3)) + (budget % 3 === 2 ? "é" : budget % 3 === 1 ? "x" : "");
        remaining -= budget;
    }
    assert.equal(remaining, 0);
    assert.equal(Buffer.byteLength(JSON.stringify(value)), bytes);
    return validateSketchDocument(value, decisions);
}

test("sketch stream enforces the document validator's actual 256 KiB UTF-8 boundary on each edit", () => {
    const base = documentWithBytes(256 * 1024 - 1);
    assert.equal(base.screens[1].shapes[99].text, "");
    const stream = new SketchOperationStream(base, decisions);
    const finalShape = { ...base.screens[1].shapes[99], text: "x" };
    stream.append(line({ op: "upsert-shape", screenId: "screen-1", shape: finalShape }));
    stream.append(done);
    const boundary = stream.complete();
    assert.equal(Buffer.byteLength(JSON.stringify(boundary)), 256 * 1024);
    const overflow = new SketchOperationStream(boundary, decisions);
    assert.throws(() => overflow.append(line({
        op: "upsert-shape", screenId: "screen-1", shape: { ...finalShape, text: "xx" },
    })), /document exceeds 256 KiB/);
    assert.deepEqual(overflow.document, boundary);
    assert.equal(overflow.sequence, 0);
    expectPoisoned(overflow, /document exceeds 256 KiB/);
});
