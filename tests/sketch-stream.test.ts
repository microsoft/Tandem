import assert from "node:assert/strict";
import { test } from "node:test";
import {
    MAX_SKETCH_STREAM_OPERATIONS, MAX_SKETCH_STREAM_RECORD_BYTES,
    MAX_SKETCH_STREAM_RESPONSE_BYTES, SketchEditValidationError, SketchOperationStream, readSketchRecovery,
    type SketchScreenStatus,
} from "../src/sketch-stream.js";
import { validateSketchDocument, type DslSketchDocument, type SketchDocument } from "../src/sketch.js";
import { sketchDocument } from "./helpers/sketch-lifecycle-fixture.js";
import { addUi, createDocument, applyOperations } from "./helpers/ui-dsl-fixture.js";

const decisions = ["usage"];
const done = '{"op":"done"}';
const line = (value: unknown) => JSON.stringify(value) + "\n";
const metadata = (id = "main") => {
    const { ui: _ui, ...screen } = sketchDocument().screens[0];
    return { ...screen, id };
};
const edit = (value: unknown, screenId = "main") => ({ op: "ui", screenId, edit: value });
const update = (label = "Updated") => edit({ op: "update", id: "primary-action", props: { label } });
const add = (id = "primary-action", label = "Continue") =>
    edit({ op: "add", parent: "screen", component: { id, type: "Button", props: { label } } });
const generation = () => line({ op: "upsert-screen", screen: metadata() }) + line(add("primary-action", "首頁 👩‍💻")) + done;

test("host-selected wireframe fidelity is available with the first outline and survives content, revision and recovery", () => {
    const outline = new SketchOperationStream(null, decisions, undefined, "outline", undefined, false, "wireframe");
    outline.append(line({ op: "upsert-screen", screen: metadata() }) + done);
    const pages = outline.complete() as DslSketchDocument;
    assert.equal(pages.fidelity, "wireframe");
    assert.equal(pages.screens[0].ui.tokens["color.primary"], "#333333");
    const content = new SketchOperationStream(pages, decisions, undefined, "content");
    content.append(line(add()) + done);
    const design = content.complete() as DslSketchDocument;
    const revision = new SketchOperationStream(design, decisions);
    revision.append(line(update("Save task")) + done);
    const changed = revision.complete() as DslSketchDocument;
    assert.equal(changed.fidelity, "wireframe");
    assert.deepEqual(changed.screens[0].ui.tokens, pages.screens[0].ui.tokens);
    const legacy = sketchDocument(), preserved = new SketchOperationStream(legacy, decisions, undefined, "revision", undefined, false, "wireframe");
    preserved.append(line(update()) + done);
    const old = preserved.complete() as DslSketchDocument;
    assert.equal(Object.hasOwn(old, "fidelity"), false, "A new default cannot migrate an existing design.");
    assert.deepEqual(old.screens[0].ui.tokens, legacy.screens[0].ui.tokens);
});

function poisoned(stream: SketchOperationStream, pattern: RegExp) {
    assert.throws(() => stream.append(done), pattern);
    assert.throws(() => stream.complete(), pattern);
}

test("DSL generation publishes validated components before completion without saving a whole-document result", () => {
    const previews: Array<{ document: SketchDocument; sequence: number }> = [];
    const stream = new SketchOperationStream(null, decisions, (document, sequence) => previews.push({ document, sequence }));
    const first = line({ op: "upsert-screen", screen: metadata() });
    stream.append(first.slice(0, -1));
    assert.equal(previews.length, 0);
    stream.append("\n");
    assert.equal(previews.length, 1);
    assert.equal(previews[0].document.version, 2);
    stream.append(line(add()));
    assert.equal(previews.length, 2);
    assert.deepEqual(previews.map(item => item.sequence), [1, 2]);
    assert.deepEqual(previews[0].document.screens[0].ui.nodes.screen.children, []);
    assert.deepEqual(previews[1].document.screens[0].ui.nodes.screen.children, ["primary-action"]);
    stream.append(done);
    assert.deepEqual(stream.complete(), previews[1].document);
});

test("DSL stream accepts every UTF-16 split, split UTF-8 and CRLF boundaries", () => {
    const source = "\r\n" + generation().replaceAll("\n", "\r\n");
    const whole = new SketchOperationStream(null, decisions);
    whole.append(source);
    const expected = whole.complete();
    for (let split = 0; split <= source.length; split++) {
        const stream = new SketchOperationStream(null, decisions);
        stream.append(source.slice(0, split));
        stream.append("");
        stream.append(source.slice(split));
        assert.deepEqual(stream.complete(), expected, `split ${split}`);
    }
    const stream = new SketchOperationStream(null, decisions), decoder = new TextDecoder();
    for (const byte of new TextEncoder().encode(source)) stream.append(decoder.decode(Uint8Array.of(byte), { stream: true }));
    stream.append(decoder.decode());
    assert.deepEqual(stream.complete(), expected);
});

test("formatted JSON records stream atomically across line breaks and arbitrary chunk boundaries", () => {
    const outline = JSON.stringify({ op: "upsert-screen", screen: {
        ...metadata(), title: 'Menu {today} "specials"', notes: "First line\nSecond line",
    } }, null, 2);
    const ui = JSON.stringify(add(), null, 2);
    const source = outline + "\r\n" + ui + "\r\n" + done;
    const whole = new SketchOperationStream(null, decisions);
    whole.append(source);
    const expected = whole.complete();
    for (let split = 0; split <= source.length; split++) {
        const stream = new SketchOperationStream(null, decisions);
        stream.append(source.slice(0, split));
        stream.append(source.slice(split));
        assert.deepEqual(stream.complete(), expected, `split ${split}`);
    }
    const previews: SketchDocument[] = [];
    const stream = new SketchOperationStream(null, decisions, document => previews.push(document));
    stream.append(outline.slice(0, -1));
    assert.equal(previews.length, 0, "Incomplete formatted JSON is not an error or a preview.");
    stream.append("}\n");
    assert.equal(previews.length, 1);
    assert.deepEqual(previews[0].screens[0].ui.nodes.screen.children, []);
    stream.append(ui + "\n" + done);
    assert.deepEqual(stream.complete(), expected);
});

test("title-first pages report waiting, processing and ready without persisting progress in the document", () => {
    const previews: Array<{ document: SketchDocument; statuses: Record<string, SketchScreenStatus> }> = [];
    const stream = new SketchOperationStream(null, decisions, (document, _sequence, statuses) => {
        previews.push({ document, statuses });
    });
    stream.append(line({ op: "upsert-screen", screen: metadata() })
        + line({ op: "upsert-screen", screen: { ...metadata("details"), title: "Details" } }));
    assert.deepEqual(previews.at(-1)!.statuses, { main: "waiting", details: "waiting" });
    assert.deepEqual(previews.at(-1)!.document.screens.map(screen => screen.title), ["Main", "Details"]);
    assert.ok(previews.at(-1)!.document.screens.every(screen => screen.ui.nodes.screen.children.length === 0));
    stream.append(line({ op: "screen-status", screenId: "main", status: "processing" }));
    assert.deepEqual(previews.at(-1)!.statuses, { main: "processing", details: "waiting" });
    stream.append(line(add()) + line({ op: "screen-status", screenId: "main", status: "ready" }));
    assert.deepEqual(previews.at(-1)!.statuses, { main: "ready", details: "waiting" });
    previews.at(-1)!.statuses.details = "ready";
    stream.append(line(update()));
    assert.deepEqual(previews.at(-1)!.statuses, { main: "processing", details: "waiting" }, "Later edits reset ready; callback mutations do not.");
    stream.append(line({ op: "remove-screen", screenId: "details" }) + done);
    assert.deepEqual(previews.at(-1)!.statuses, { main: "processing" });
    assert.deepEqual(Object.keys(stream.complete()), ["version", "screens", "transitions"]);
});

test("screen progress cannot reference missing pages, mark empty pages ready or introduce arbitrary states", () => {
    for (const operation of [
        { op: "screen-status", screenId: "missing", status: "processing" },
        { op: "screen-status", screenId: "main", status: "ready" },
        { op: "screen-status", screenId: "main", status: "approved" },
        { op: "screen-status", screenId: "main", status: "waiting" },
        { op: "screen-status", screenId: "main", status: "processing", extra: true },
    ]) {
        const stream = new SketchOperationStream(null, decisions);
        stream.append(line({ op: "upsert-screen", screen: metadata() }));
        assert.throws(() => stream.append(line(operation)));
        assert.equal(stream.sequence, 1);
        assert.throws(() => stream.complete());
    }
    const stream = new SketchOperationStream(sketchDocument(), decisions);
    stream.append(line({ op: "screen-status", screenId: "main", status: "processing" })
        + line({ op: "screen-status", screenId: "main", status: "ready" }) + done);
    assert.throws(() => stream.complete(), /at least one document-changing operation/, "Progress alone is not a design revision.");
});

test("outline and content phases enforce structure before content instead of trusting worker ordering", () => {
    const outline = new SketchOperationStream(null, decisions, undefined, "outline");
    outline.append(line({ op: "upsert-screen", screen: metadata() })
        + line({ op: "upsert-screen", screen: metadata("details") })
        + line({ op: "upsert-transition", transition: {
            id: "next", fromScreenId: "main", toScreenId: "details", trigger: "Continue", description: "",
        } }) + done);
    const base = outline.complete();
    assert.ok(base.screens.every(screen => screen.ui.nodes.screen.children.length === 0));
    for (const operation of [add(), { op: "screen-status", screenId: "main", status: "processing" }]) {
        const invalid = new SketchOperationStream(null, decisions, undefined, "outline");
        invalid.append(line({ op: "upsert-screen", screen: metadata() }));
        assert.throws(() => invalid.append(line(operation)), /only page metadata and navigation/);
        assert.equal(invalid.sequence, 1);
    }
    for (const operation of [
        { op: "upsert-screen", screen: metadata("late-page") },
        { op: "remove-screen", screenId: "details" },
        { op: "remove-transition", transitionId: "next" },
    ]) {
        const invalid = new SketchOperationStream(base, decisions, undefined, "content");
        assert.throws(() => invalid.append(line(operation)), /cannot change the published page outline/);
        assert.deepEqual(invalid.document, base);
    }
    const incomplete = new SketchOperationStream(base, decisions, undefined, "content");
    incomplete.append(line(add()) + done);
    assert.throws(() => incomplete.complete(), /fill every outlined page/);
    const content = new SketchOperationStream(base, decisions, undefined, "content");
    content.append(line(add()) + line(edit({
        op: "add", parent: "screen", component: { id: "title", type: "Heading", props: { text: "Details" } },
    }, "details")) + done);
    assert.deepEqual(content.complete().transitions, base.transitions);
});

test("List.size produces actionable correction data without applying invalid props or losing valid content", () => {
    const stream = new SketchOperationStream(sketchDocument(), decisions);
    stream.append(line(update("Kept")));
    const invalid = edit({ op: "add", parent: "screen",
        component: { id: "items", type: "List", props: { items: ["One"], size: "font.size.body" } } });
    assert.throws(() => stream.append(line(invalid)), (error: unknown) => {
        assert.ok(error instanceof SketchEditValidationError);
        assert.match(error.repair.message, /'size' is not a prop of List/);
        assert.deepEqual(error.repair.operation, invalid);
        return true;
    });
    assert.equal(stream.document!.screens[0].ui.nodes["primary-action"].props.label, "Kept");
    assert.equal(stream.document!.screens[0].ui.nodes.items, undefined);
    assert.throws(() => stream.complete(), /not a prop of List/);
});

test("explicit recovery can finish already-complete retained content without redrawing it", () => {
    const base = sketchDocument();
    const resumed = new SketchOperationStream(base, decisions, undefined, "content", { main: "ready" }, true);
    resumed.append(done);
    assert.deepEqual(resumed.complete(), base);
    const empty = structuredClone(base);
    empty.screens[0].ui = createDocument();
    const incomplete = new SketchOperationStream(empty, decisions, undefined, "content", { main: "waiting" }, true);
    incomplete.append(done);
    assert.throws(() => incomplete.complete(), /fill every outlined page/);
});

test("durable recovery validates identity, page status and its complete UI DSL document", () => {
    const checkpoint = {
        phase: "content", preview: {
            prototypeId: "sample", generation: "generation", requestId: "request", runId: "run",
            baseRevisionId: null, requirementsDigest: "requirements", sequence: 2,
            document: sketchDocument(), screenStatuses: { main: "processing" },
        },
    };
    assert.deepEqual(readSketchRecovery(checkpoint), checkpoint);
    for (const invalid of [
        { ...checkpoint, phase: "unknown" },
        { ...checkpoint, preview: { ...checkpoint.preview, baseRevisionId: "" } },
        { ...checkpoint, preview: { ...checkpoint.preview, screenStatuses: { main: "approved" } } },
        { ...checkpoint, preview: { ...checkpoint.preview, document: {} } },
        { ...checkpoint, repair: { message: "bad", operation: null } },
    ]) assert.throws(() => readSketchRecovery(invalid));
});

test("all five library operations preserve unrelated nodes and metadata while revisions use the current DSL base", () => {
    const base = sketchDocument();
    const stream = new SketchOperationStream(base, decisions);
    stream.append(line(edit({ op: "add", parent: "screen", component: { id: "card", type: "Card", props: {} } })));
    stream.append(line(edit({ op: "add", parent: "card", component: { id: "hint", type: "Text", props: { text: "Keep me" } } })));
    stream.append(line(update("Start")));
    stream.append(line(edit({ op: "move", id: "primary-action", parent: "card", after: null })));
    stream.append(line(edit({ op: "setToken", key: "color.primary", value: "#166534" })));
    stream.append(line(edit({ op: "remove", id: "hint" })) + done);
    const result = stream.complete();
    assert.equal(result.version, 2);
    const ui = result.screens[0].ui;
    assert.deepEqual(ui.nodes.card.children, ["primary-action"]);
    assert.equal(ui.nodes["primary-action"].props.label, "Start");
    assert.equal(ui.tokens["color.primary"], "#166534");
    assert.equal(ui.nodes.hint, undefined);
    assert.equal(result.screens[0].notes, base.screens[0].notes);
    assert.equal(base.screens[0].ui.nodes["primary-action"].props.label, "Continue");
});

test("official legacy Lucide aliases become canonical names for Icon, Button and Link edits", () => {
    const aliases = {
        "trash-2": "trash", filter: "funnel", "more-horizontal": "ellipsis", "more-vertical": "ellipsis-vertical",
        home: "house", edit: "square-pen", "edit-2": "pen", "edit-3": "pen-line",
        "help-circle": "circle-question-mark", "alert-circle": "circle-alert", "alert-triangle": "triangle-alert",
        "check-circle": "circle-check-big", "check-circle-2": "circle-check", "x-circle": "circle-x",
        "user-circle": "circle-user", "user-circle-2": "circle-user-round",
    };
    for (const [alias, canonical] of Object.entries(aliases)) {
        for (const type of ["Icon", "Button", "Link"]) {
            const base = sketchDocument(), stream = new SketchOperationStream(base, decisions);
            const field = type === "Icon" ? "name" : "icon";
            stream.append(line(edit({ op: "add", parent: "screen",
                component: { id: "icon-action", type, props: { label: "Action", [field]: alias } } })));
            assert.equal(stream.document!.screens[0].ui.nodes["icon-action"].props[field], canonical, `${type}: ${alias}`);
            stream.append(line(edit({ op: "update", id: "icon-action", props: { [field]: alias } })) + done);
            const result = stream.complete();
            assert.equal(result.screens[0].ui.nodes["icon-action"].props[field], canonical);
            assert.deepEqual(result.screens[0].ui.nodes["primary-action"], base.screens[0].ui.nodes["primary-action"]);
            assert.deepEqual(validateSketchDocument(result, decisions), result, "Only canonical names reach previews and saved documents.");
        }
    }
});

test("screen metadata and transitions retain UI documents, order, accepted decisions and incident-edge semantics", () => {
    const base = sketchDocument();
    const stream = new SketchOperationStream(base, decisions);
    stream.append(line({ op: "upsert-screen", screen: { ...metadata(), title: "Renamed", width: 375, height: 812 } }));
    stream.append(line({ op: "upsert-screen", screen: metadata("details") }));
    stream.append(line({ op: "upsert-transition", transition: {
        id: "next", fromScreenId: "main", toScreenId: "details", trigger: "Continue", description: "",
    } }));
    assert.deepEqual(stream.document!.screens.map(item => item.id), ["main", "details"]);
    assert.deepEqual(stream.document!.screens[0].ui, base.screens[0].ui);
    stream.append(line({ op: "remove-screen", screenId: "details" }) + done);
    assert.deepEqual(stream.complete().transitions, []);
    const last = new SketchOperationStream(base, decisions);
    assert.throws(() => last.append(line({ op: "remove-screen", screenId: "main" })), /last screen/);
    poisoned(last, /last screen/);
});

test("invalid DSL edits and unknown references fail atomically and cannot be rescued by a valid tail", () => {
    for (const operation of [
        update(""),
        edit({ op: "update", id: "missing", props: { label: "No" } }),
        edit({ op: "add", parent: "missing", component: { id: "new", type: "Text", props: { text: "No" } } }),
        edit({ op: "add", parent: "screen", component: { id: "primary-action", type: "Text", props: { text: "Duplicate" } } }),
        edit({ op: "update", id: "primary-action", props: { onclick: "alert(1)" } }),
        edit({ op: "update", id: "primary-action", props: { icon: "trash-2", onclick: "alert(1)" } }),
        edit({ op: "update", id: "primary-action", props: { icon: "not-a-bundled-icon" } }),
        edit({ op: "remove", id: "screen" }),
        edit({ op: "move", id: "screen", parent: "primary-action" }),
        edit({ op: "setToken", key: "color.primary", value: "url(https://example.test)" }),
        edit({ op: "setToken", key: "space.1", value: 129 }),
        edit({ op: "setToken", key: "arbitrary", value: 1 }),
    ]) {
        const base = sketchDocument(), stream = new SketchOperationStream(base, decisions);
        assert.throws(() => stream.append(line(operation)));
        assert.deepEqual(stream.document, base);
        assert.equal(stream.sequence, 0);
        assert.throws(() => stream.complete());
    }
    for (const input of [
        '{"op":"ui","screenId":"main","edit":{"op":"update","id":"primary-action","props":{"__proto__":{}}}}\n',
        line(edit({ op: "update", id: "constructor", props: { label: "No" } })),
        line({ op: "ui", screenId: "absent", edit: { op: "remove", id: "primary-action" } }),
    ]) assert.throws(() => new SketchOperationStream(sketchDocument(), decisions).append(input));
});

test("geometry streams and legacy bases are explicitly rejected rather than silently migrated", () => {
    assert.throws(() => new SketchOperationStream({
        version: 1, screens: [{ ...metadata(), shapes: [] }], transitions: [],
    }, decisions), /legacy geometry.*regenerate/);
    for (const op of ["upsert-shape", "remove-shape"]) {
        assert.throws(() => new SketchOperationStream(sketchDocument(), decisions).append(line({ op })), /unknown operation/);
    }
});

test("transport records enforce exact fields and accepted requirements after every operation", () => {
    for (const operation of [
        { ...update(), extra: true }, { op: "ui", screenId: "main" },
        { op: "done", extra: true }, { op: "upsert-screen", screen: { ...metadata(), ui: createDocument() } },
        { op: "upsert-screen", screen: { ...metadata(), width: 0 } },
        { op: "upsert-screen", screen: { ...metadata(), height: 10001 } },
        { op: "upsert-screen", screen: { ...metadata(), decisionIds: ["unaccepted"] } },
        { op: "upsert-screen", screen: { ...metadata(), id: "../unsafe" } },
        { op: "upsert-transition", transition: { id: "next", fromScreenId: "main", toScreenId: "missing", trigger: "Go", description: "" } },
        { op: "remove-transition", transitionId: "missing" },
    ]) {
        const stream = new SketchOperationStream(sketchDocument(), decisions);
        assert.throws(() => stream.append(line(operation)));
        assert.equal(stream.sequence, 0);
    }
    const stream = new SketchOperationStream(sketchDocument(), decisions);
    for (let i = 1; i < 8; i++) stream.append(line({ op: "upsert-screen", screen: metadata(`screen-${i}`) }));
    assert.throws(() => stream.append(line({ op: "upsert-screen", screen: metadata("ninth") })), /screens/);
    assert.equal(stream.document!.screens.length, 8);
});

test("caller and callback mutation cannot alter the stream, and callback failures stay latched", () => {
    const base = structuredClone(sketchDocument());
    const stream = new SketchOperationStream(base, decisions, value => { value.screens[0].title = "External"; });
    base.screens[0].title = "Other";
    stream.append(line(update()));
    stream.document!.screens[0].title = "Mutated getter";
    stream.append(done);
    assert.equal(stream.complete().screens[0].title, "Main");
    const failed = new SketchOperationStream(sketchDocument(), decisions, () => { throw new Error("Ownership lost"); });
    assert.throws(() => failed.append(line(update()) + line(update("Later"))), /Ownership lost/);
    assert.equal(failed.sequence, 1);
    poisoned(failed, /Ownership lost/);
});

test("prose, markdown, malformed records, missing done, and content after done are rejected", () => {
    for (const text of ["```json", "Here is the view", '{"op":"done",}', '{"op":"bad\nstring"}']) {
        const stream = new SketchOperationStream(sketchDocument(), decisions);
        assert.throws(() => stream.append(text + "\n"), /not valid JSON/);
        poisoned(stream, /not valid JSON/);
    }
    for (const text of ["{", '{\n"op":', '{\n"op":"done",\n}']) {
        const stream = new SketchOperationStream(sketchDocument(), decisions);
        stream.append(text);
        assert.throws(() => stream.complete(), /not valid JSON/);
        poisoned(stream, /not valid JSON/);
    }
    for (const base of [null, sketchDocument()]) {
        const empty = new SketchOperationStream(base, decisions);
        assert.throws(() => empty.complete(), /missing done/);
        const noEdits = new SketchOperationStream(base, decisions);
        noEdits.append(done);
        assert.throws(() => noEdits.complete(), /at least one/);
    }
    for (const tail of [done, "{", "prose", line(update())]) {
        const stream = new SketchOperationStream(null, decisions);
        assert.throws(() => stream.append(generation() + "\n" + tail), /after done/);
        poisoned(stream, /after done/);
    }
});

test("1024 DSL operations are accepted and the next operation cannot mutate the last valid preview", () => {
    const operation = line(update());
    const stream = new SketchOperationStream(sketchDocument(), decisions);
    stream.append(operation.repeat(MAX_SKETCH_STREAM_OPERATIONS));
    const last = stream.document;
    assert.throws(() => stream.append(operation), /1024 operations/);
    assert.deepEqual(stream.document, last);
    const complete = new SketchOperationStream(sketchDocument(), decisions);
    complete.append(operation.repeat(MAX_SKETCH_STREAM_OPERATIONS) + done);
    assert.equal(complete.complete().screens[0].ui.nodes["primary-action"].props.label, "Updated");
});

test("record limits count exact UTF-8 bytes even with split surrogate pairs", () => {
    const operation = JSON.stringify(update("Ink 🖊"));
    const record = operation + " ".repeat(MAX_SKETCH_STREAM_RECORD_BYTES - Buffer.byteLength(operation));
    const stream = new SketchOperationStream(sketchDocument(), decisions);
    const split = record.indexOf("🖊") + 1;
    stream.append(record.slice(0, split)); stream.append(record.slice(split)); stream.append("\n" + done);
    assert.equal(stream.complete().screens[0].ui.nodes["primary-action"].props.label, "Ink 🖊");
    for (const ending of ["", "\n"]) {
        const overflow = new SketchOperationStream(sketchDocument(), decisions);
        assert.throws(() => overflow.append(record + " " + ending), /record exceeds 256 KiB/);
        assert.equal(overflow.sequence, 0);
    }
});

test("formatted records count internal line breaks against the same bounded record size", () => {
    const operation = JSON.stringify(update(), null, 2);
    const padding = MAX_SKETCH_STREAM_RECORD_BYTES - Buffer.byteLength(operation);
    const source = operation.slice(0, -1) + "\n".repeat(padding) + "}";
    const stream = new SketchOperationStream(sketchDocument(), decisions);
    stream.append(source + "\n" + done);
    assert.equal(stream.complete().screens[0].ui.nodes["primary-action"].props.label, "Updated");
    const overflow = new SketchOperationStream(sketchDocument(), decisions);
    assert.throws(() => overflow.append(source.slice(0, -1) + "\n}\n"), /record exceeds 256 KiB/);
    assert.equal(overflow.sequence, 0);
});

test("response limits count exactly 512 KiB across whitespace records and fragmented Unicode", () => {
    const input = generation() + "\n";
    let remaining = MAX_SKETCH_STREAM_RESPONSE_BYTES - Buffer.byteLength(input);
    let padding = "";
    while (remaining > 0) {
        const size = Math.min(remaining, MAX_SKETCH_STREAM_RECORD_BYTES);
        padding += " ".repeat(size - 1) + "\n"; remaining -= size;
    }
    const stream = new SketchOperationStream(null, decisions);
    for (const character of input.split("")) stream.append(character);
    stream.append(padding);
    assert.equal(stream.complete().version, 2);
    assert.throws(() => stream.append(" "), /response exceeds 512 KiB/);
});

test("the full DSL design retains the actual 256 KiB UTF-8 document limit on every edit", () => {
    const base = sketchDocument();
    base.screens[0].ui = createDocument();
    for (let i = 0; i < 150; i++) addUi(base.screens[0], `label-${i}`, "Text", { text: "" });
    const value = structuredClone(base);
    let remaining = 256 * 1024 - 1 - Buffer.byteLength(JSON.stringify(value));
    for (const node of Object.values(value.screens[0].ui.nodes)) {
        if (node.type !== "Text") continue;
        const length = Math.min(2000, remaining);
        node.props.text = "x".repeat(length);
        remaining -= length;
    }
    assert.equal(remaining, 0);
    assert.equal(value.screens[0].ui.nodes["label-149"].props.text, "");
    validateSketchDocument(value);
    const stream = new SketchOperationStream(value, decisions);
    stream.append(line(edit({ op: "update", id: "label-149", props: { text: "x" } })) + done);
    assert.equal(Buffer.byteLength(JSON.stringify(stream.complete())), 256 * 1024);
    const overflow = new SketchOperationStream(stream.complete(), decisions);
    assert.throws(() => overflow.append(line(edit({ op: "update", id: "label-149", props: { text: "xx" } }))), /document exceeds 256 KiB/);
    assert.equal(overflow.sequence, 0);
});
