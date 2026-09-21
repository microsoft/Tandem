import assert from "node:assert/strict";
import { test } from "node:test";
import { runSketchStreamWorker, type SketchWorkerEvent } from "../src/sketch-stream-worker.js";
import type { SketchDocument } from "../src/sketch.js";
import { sketchDocument } from "./helpers/sketch-lifecycle-fixture.js";

function operation(x = 90) {
    return JSON.stringify({
        op: "upsert-shape", screenId: "main", shape: { ...sketchDocument().screens[0].shapes[0], x },
    }) + "\n";
}
const done = '{"op":"done"}\n';

function harness(base: SketchDocument | null = sketchDocument()) {
    let handler: ((event: SketchWorkerEvent) => void) | undefined;
    let resolve!: (value: unknown) => void;
    let reject!: (error: Error) => void;
    let unsubscribed = false;
    const controller = new AbortController();
    const previews: Array<{ document: SketchDocument; sequence: number }> = [];
    const failures: Error[] = [];
    const result = runSketchStreamWorker({
        runId: "drawing-run", signal: controller.signal, base, decisionIds: ["usage"],
        subscribe: (callback) => { handler = callback; return () => { handler = undefined; unsubscribed = true; }; },
        run: () => new Promise((accept, fail) => { resolve = accept; reject = fail; }),
        preview: (document, sequence) => previews.push({ document, sequence }),
        failed: (error) => failures.push(error),
    });
    const emit = (event: SketchWorkerEvent) => handler?.(event);
    const start = (run = "drawing-run", agentId = "drawing-agent", parentId?: string) => emit({
        type: "subagent.started", agentId, data: { factoryRunId: run, toolCallId: "drawing-tool", parentId },
    });
    const delta = (text: string, agentId = "drawing-agent", messageId = "drawing-message") => emit({
        type: "assistant.message_delta", agentId, data: { messageId, deltaContent: text },
    });
    return { previews, failures, result, resolve, reject, emit, start, delta, controller,
        get unsubscribed() { return unsubscribed; } };
}

test("drawing operations become visible before the worker settles and full messages do not replay them", async () => {
    const h = harness();
    h.start();
    const first = operation();
    h.delta(first.slice(0, 45));
    assert.equal(h.previews.length, 0);
    h.delta(first.slice(45));
    assert.equal(h.previews.length, 1);
    assert.equal(h.previews[0].document.screens[0].shapes[0].x, 90);
    assert.equal(h.unsubscribed, false, "the worker has not resolved yet");
    h.delta(operation(100) + done);
    assert.deepEqual(h.previews.map((preview) => preview.sequence), [1, 2]);
    const full = first + operation(100) + done;
    for (let count = 0; count < 2; count++) h.emit({
        type: "assistant.message", agentId: "drawing-agent", data: { messageId: "drawing-message", content: full },
    });
    h.resolve(full.trimEnd());
    assert.equal((await h.result).screens[0].shapes[0].x, 100);
    assert.equal(h.previews.length, 2);
    assert.equal(h.unsubscribed, true);
    assert.equal(h.failures.length, 0);
});

test("root, unrelated factories and nested agents cannot contribute drawing commands", async () => {
    const h = harness();
    h.start("other-run", "other");
    h.delta("malformed", "other");
    h.emit({ type: "assistant.message_delta", data: { messageId: "root", deltaContent: "malformed" } });
    h.start("drawing-run", "nested", "parent");
    h.delta("malformed", "nested");
    assert.equal(h.previews.length, 0);
    h.start();
    h.delta(operation());
    h.resolve(operation() + done);
    assert.equal((await h.result).screens[0].shapes[0].x, 90);
    assert.equal(h.failures.length, 0);
});

test("drawing streams support tool-call correlation on runtimes without an agent ID", async () => {
    const h = harness();
    h.emit({ type: "subagent.started", data: { factoryRunId: "drawing-run", toolCallId: "drawing-tool" } });
    h.emit({ type: "assistant.message_delta",
        data: { messageId: "drawing-message", parentToolCallId: "drawing-tool", deltaContent: operation() } });
    assert.equal(h.previews.length, 1);
    h.resolve(operation() + done);
    await h.result;
});

test("completed-only and journaled worker output still undergoes operation validation", async () => {
    const h = harness();
    h.resolve(operation() + done);
    assert.equal((await h.result).screens[0].shapes[0].x, 90);
    const empty = harness();
    empty.resolve(null);
    await assert.rejects(empty.result, /no drawing operations/);
    assert.equal(empty.unsubscribed, true);
});

test("SDK trimming of outer whitespace cannot reject an otherwise identical streamed result", async () => {
    const h = harness();
    h.start();
    h.delta("\n  " + operation() + done);
    h.resolve((operation() + done).trim());
    assert.equal((await h.result).screens[0].shapes[0].x, 90);
    assert.equal(h.previews.length, 1);
});

test("malformed partial output cannot be rescued by a different final result", async () => {
    const h = harness();
    h.start();
    h.delta(operation());
    h.delta('{"op":"invalid"}\n');
    assert.equal(h.failures.length, 1);
    h.resolve(operation() + done);
    await assert.rejects(h.result, /operation|unsupported|unknown/i);
    assert.equal(h.unsubscribed, true);
});

test("a changed final message or result is rejected rather than saved", async () => {
    for (const changedMessage of [false, true]) {
        const h = harness();
        h.start();
        h.delta(operation());
        if (changedMessage) h.emit({ type: "assistant.message", agentId: "drawing-agent",
            data: { messageId: "drawing-message", content: operation(120) + done } });
        h.resolve(operation(120) + done);
        await assert.rejects(h.result, /does not match/);
        assert.equal(h.failures.length, 1);
    }
});

test("stream errors, cancellation and denied preview publication release the listener and fail closed", async () => {
    const h = harness();
    h.start();
    h.delta(operation());
    h.controller.abort();
    assert.match(h.failures[0].message, /cancelled/);
    h.delta(operation(110));
    assert.equal(h.previews.length, 1);
    h.resolve(operation() + done);
    await assert.rejects(h.result, /abort/i);
    assert.equal(h.unsubscribed, true);
    const rejected = harness();
    rejected.reject(new Error("Worker failed"));
    await assert.rejects(rejected.result, /Worker failed/);
    assert.equal(rejected.failures.length, 1);
    assert.equal(rejected.unsubscribed, true);
});

test("a preview rejected by its owner cannot become a successful final result", async () => {
    let receive!: (event: SketchWorkerEvent) => void;
    let closed = false;
    const failures: Error[] = [];
    const output = runSketchStreamWorker({
        runId: "run", signal: new AbortController().signal, base: sketchDocument(), decisionIds: ["usage"],
        subscribe: (handler) => { receive = handler; return () => { closed = true; }; },
        preview: () => { throw new Error("Request was replaced"); },
        failed: (error) => failures.push(error),
        run: async () => {
            receive({ type: "subagent.started", agentId: "worker", data: { factoryRunId: "run", toolCallId: "call" } });
            receive({ type: "assistant.message_delta", agentId: "worker",
                data: { messageId: "message", deltaContent: operation() } });
            return operation() + done;
        },
    });
    await assert.rejects(output, /Request was replaced/);
    assert.equal(failures.length, 1);
    assert.equal(closed, true);
});
