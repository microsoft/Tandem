import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { runSketchStreamWorker, type SketchWorkerEvent } from "../src/sketch-stream-worker.js";
import type { SketchDocument } from "../src/sketch.js";
import { sketchDocument } from "./helpers/sketch-lifecycle-fixture.js";

function operation(x = 90) {
    return JSON.stringify({
        op: "ui", screenId: "main", edit: { op: "setToken", key: "space.1", value: x },
    }) + "\n";
}
const done = '{"op":"done"}\n';

function harness(base: SketchDocument | null = sketchDocument(), getRunDetail = async () => ({
    runId: "drawing-run", agents: [{ runId: "drawing-run", toolCallId: "drawing-tool" }],
})) {
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
        getRunDetail,
        run: () => new Promise((accept, fail) => { resolve = accept; reject = fail; }),
        preview: (document, sequence) => previews.push({ document, sequence }),
        failed: (error) => failures.push(error),
    });
    const emit = (event: SketchWorkerEvent) => handler?.(event);
    const start = (run = "drawing-run", agentId = "drawing-agent", parentId?: string) => {
        emit({ type: "subagent.started", agentId, data: { workflowRunId: run, toolCallId: "drawing-tool", parentId } });
        emit({ type: "assistant.message_start", agentId, data: { messageId: "drawing-message", phase: "final_answer" } });
    };
    const delta = (text: string, agentId = "drawing-agent", messageId = "drawing-message") => emit({
        type: "assistant.message_delta", agentId, data: { messageId, deltaContent: text },
    });
    return { previews, failures, result, resolve, reject, emit, start, delta, controller,
        get unsubscribed() { return unsubscribed; } };
}

test("design operations become visible before the worker settles and full messages do not replay them", async () => {
    const h = harness();
    h.start();
    const first = operation();
    h.delta(first.slice(0, 45));
    assert.equal(h.previews.length, 0);
    h.delta(first.slice(45));
    assert.equal(h.previews.length, 1);
    assert.equal(h.previews[0].document.screens[0].ui.tokens["space.1"], 90);
    assert.equal(h.unsubscribed, false, "the worker has not resolved yet");
    h.delta(operation(100) + done);
    assert.deepEqual(h.previews.map((preview) => preview.sequence), [1, 2]);
    const full = first + operation(100) + done;
    for (let count = 0; count < 2; count++) h.emit({
        type: "assistant.message", agentId: "drawing-agent", data: { messageId: "drawing-message", content: full },
    });
    h.resolve(full.trimEnd());
    assert.equal((await h.result).screens[0].ui.tokens["space.1"], 100);
    assert.equal(h.previews.length, 2);
    assert.equal(h.unsubscribed, true);
    assert.equal(h.failures.length, 0);
});

test("a legacy Lucide icon cannot abort an otherwise valid design worker", async () => {
    const h = harness();
    h.start();
    const source = JSON.stringify({
        op: "ui", screenId: "main", edit: { op: "update", id: "primary-action", props: { icon: "trash-2" } },
    }) + "\n" + done;
    h.delta(source);
    h.resolve(source);
    assert.equal((await h.result).screens[0].ui.nodes["primary-action"].props.icon, "trash");
    assert.equal(h.previews[0].document.screens[0].ui.nodes["primary-action"].props.icon, "trash");
    assert.equal(h.failures.length, 0);
    assert.equal(h.unsubscribed, true);
});

test("explicit native commentary stays separate from design deltas and authoritative final NDJSON", async () => {
    const h = harness();
    h.start();
    h.emit({ type: "assistant.intent", agentId: "drawing-agent", data: { intent: "Laying out the screens." } });
    h.emit({ type: "assistant.message_start", agentId: "drawing-agent",
        data: { messageId: "progress", phase: "commentary" } });
    h.delta("The layout is ready.", "drawing-agent", "progress");
    h.emit({ type: "assistant.message", agentId: "drawing-agent",
        data: { messageId: "progress", phase: "commentary", content: "The layout is ready." } });
    assert.equal(h.previews.length, 0);
    h.emit({ type: "assistant.message_start", agentId: "drawing-agent",
        data: { messageId: "drawing-message", phase: "final_answer" } });
    h.delta(operation() + done);
    assert.equal(h.previews.length, 1);
    h.resolve(operation() + done);
    assert.equal((await h.result).screens[0].ui.tokens["space.1"], 90);
    assert.equal(h.failures.length, 0);
});

test("untagged prose cannot be guessed away as progress or rescued by a valid final payload", async () => {
    const h = harness();
    h.start();
    h.delta("The layout is ready.\n");
    h.resolve(operation() + done);
    await assert.rejects(h.result);
    assert.equal(h.previews.length, 0);
});

test("optional or later native phase buffers commentary without parsing it as design operations", async () => {
    const h = harness();
    h.emit({ type: "subagent.started", agentId: "drawing-agent", data: { workflowRunId: "drawing-run", toolCallId: "drawing-tool" } });
    h.emit({ type: "assistant.message_start", agentId: "drawing-agent", data: { messageId: "late-phase" } });
    h.delta("The layout is ready.\n", "drawing-agent", "late-phase");
    assert.equal(h.previews.length, 0);
    assert.equal(h.failures.length, 0);
    h.emit({ type: "assistant.message", agentId: "drawing-agent",
        data: { messageId: "late-phase", phase: "commentary", content: "The layout is ready.\n" } });
    h.emit({ type: "assistant.message_start", agentId: "drawing-agent",
        data: { messageId: "drawing-message", phase: "final_answer" } });
    h.delta(operation() + done);
    h.resolve(operation() + done);
    assert.equal((await h.result).screens[0].ui.tokens["space.1"], 90);
    assert.equal(h.failures.length, 0);
});

test("root, unrelated factories and nested agents cannot contribute design commands", async () => {
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
    assert.equal((await h.result).screens[0].ui.tokens["space.1"], 90);
    assert.equal(h.failures.length, 0);
});

test("design streams support tool-call correlation on runtimes without an agent ID", async () => {
    const h = harness();
    h.emit({ type: "subagent.started", data: { workflowRunId: "drawing-run", toolCallId: "drawing-tool" } });
    h.emit({ type: "assistant.message_delta",
        data: { messageId: "drawing-message", parentToolCallId: "drawing-tool", deltaContent: operation() } });
    assert.equal(h.previews.length, 1, "Protocol-shaped unphased data streams without waiting for the completed message.");
    h.emit({ type: "assistant.message",
        data: { messageId: "drawing-message", parentToolCallId: "drawing-tool", content: operation() } });
    assert.equal(h.previews.length, 1);
    h.resolve(operation() + done);
    await h.result;
});

test("unphased workers publish formatted page titles before any page design or final result arrives", async () => {
    const h = harness(null);
    h.emit({ type: "subagent.started", agentId: "drawing-agent",
        data: { workflowRunId: "drawing-run", toolCallId: "drawing-tool" } });
    h.emit({ type: "assistant.message_start", agentId: "drawing-agent", data: { messageId: "drawing-message" } });
    const { ui: _ui, ...screen } = sketchDocument().screens[0];
    const titles = [screen, { ...screen, id: "details", title: "Details" }]
        .map(screen => JSON.stringify({ op: "upsert-screen", screen }, null, 2) + "\n").join("");
    for (const character of titles) h.delta(character);
    assert.equal(h.previews.length, 2);
    assert.deepEqual(h.previews[1].document.screens.map(item => item.title), ["Main", "Details"]);
    assert.ok(h.previews[1].document.screens.every(item => item.ui.nodes.screen.children.length === 0));
    assert.equal(h.unsubscribed, false);
    assert.equal(h.failures.length, 0);
    h.resolve(titles + done);
    await h.result;
});

test("a later commentary phase cannot reclassify JSON that already contributed to a preview", async () => {
    const h = harness();
    h.emit({ type: "subagent.started", agentId: "drawing-agent",
        data: { workflowRunId: "drawing-run", toolCallId: "drawing-tool" } });
    h.delta(operation());
    assert.equal(h.previews.length, 1);
    h.emit({ type: "assistant.message", agentId: "drawing-agent",
        data: { messageId: "drawing-message", phase: "commentary", content: operation() } });
    h.resolve(operation() + done);
    await assert.rejects(h.result, /changed its native commentary\/data phase/);
    assert.equal(h.failures.length, 1);
});

test("worker starts without factory IDs stream after verified factory lookup, before completion", async () => {
    let verify!: (detail: { runId: string; agents: { runId: string; toolCallId: string }[] }) => void;
    const detail = new Promise<Parameters<typeof verify>[0]>((resolve) => { verify = resolve; });
    const h = harness(sketchDocument(), () => detail);
    h.emit({ type: "subagent.started", agentId: "drawing-agent", data: { toolCallId: "drawing-tool" } });
    h.emit({ type: "assistant.message_start", agentId: "drawing-agent", data: { messageId: "drawing-message", phase: "final_answer" } });
    h.delta(operation().slice(0, 45));
    h.delta(operation().slice(45));
    assert.equal(h.previews.length, 0, "unverified workers must not publish designs");
    verify({ runId: "drawing-run", agents: [{ runId: "drawing-run", toolCallId: "drawing-tool" }] });
    await setImmediate();
    assert.equal(h.previews.length, 1, "buffered operations appear without waiting for the final answer");
    assert.equal(h.previews[0].document.screens[0].ui.tokens["space.1"], 90);
    assert.equal(h.unsubscribed, false);
    h.delta(operation(100) + done);
    assert.deepEqual(h.previews.map((preview) => preview.sequence), [1, 2]);
    h.resolve(operation() + operation(100) + done);
    assert.equal((await h.result).screens[0].ui.tokens["space.1"], 100);
    assert.equal(h.previews.length, 2);
    assert.equal(h.failures.length, 0);
    assert.equal(h.unsubscribed, true);
});

test("factory lookup excludes unrelated and nested workers even if their labels match", async () => {
    const h = harness();
    for (const [agentId, toolCallId] of [["other-agent", "other-tool"], ["drawing-agent", "drawing-tool"]]) {
        h.emit({ type: "subagent.started", agentId, data: { toolCallId, agentName: "general-purpose" } });
        h.emit({ type: "assistant.message_start", agentId, data: { messageId: "drawing-message", phase: "final_answer" } });
        h.delta(agentId === "drawing-agent" ? operation() : "not design operations\n", agentId);
    }
    h.emit({ type: "subagent.started", agentId: "nested",
        data: { toolCallId: "nested-tool", parentId: "drawing-agent" } });
    h.delta("not design operations\n", "nested");
    await setImmediate();
    assert.equal(h.previews.length, 1);
    assert.equal(h.failures.length, 0);
    h.resolve(operation() + done);
    await h.result;
});

test("legacy worker lookup retains parent-tool correlation and completed-message deduplication", async () => {
    const h = harness();
    h.emit({ type: "subagent.started", data: { toolCallId: "drawing-tool" } });
    h.emit({ type: "assistant.message_delta",
        data: { messageId: "drawing-message", parentToolCallId: "drawing-tool", deltaContent: operation() } });
    h.emit({ type: "assistant.message",
        data: { messageId: "drawing-message", parentToolCallId: "drawing-tool", content: operation() + done } });
    await setImmediate();
    assert.equal(h.previews.length, 1);
    h.resolve(operation() + done);
    await h.result;
    assert.equal(h.previews.length, 1);
});

test("a failed or wrong-run identity lookup cannot fall back to a successful final design", async () => {
    for (const getRunDetail of [
        async () => { throw new Error("Factory lookup unavailable"); },
        async () => ({ runId: "another-run", agents: [{ runId: "drawing-run", toolCallId: "drawing-tool" }] }),
    ]) {
        const h = harness(sketchDocument(), getRunDetail);
        h.emit({ type: "subagent.started", agentId: "drawing-agent", data: { toolCallId: "drawing-tool" } });
        h.delta(operation());
        h.resolve(operation() + done);
        await assert.rejects(h.result, /lookup unavailable|different factory run/);
        assert.equal(h.previews.length, 0);
        assert.equal(h.failures.length, 1);
        assert.equal(h.unsubscribed, true);
    }
});

test("an agent record from another run does not authorize uncorrelated design events", async () => {
    const h = harness(sketchDocument(), async () => ({
        runId: "drawing-run", agents: [{ runId: "other-run", toolCallId: "drawing-tool" }],
    }));
    h.emit({ type: "subagent.started", agentId: "drawing-agent", data: { toolCallId: "drawing-tool" } });
    h.delta("unrelated content\n");
    await setImmediate();
    assert.equal(h.previews.length, 0);
    assert.equal(h.failures.length, 0);
    h.resolve(operation() + done);
    await h.result;
});

test("final output waits for buffered event validation and cannot repair a malformed stream", async () => {
    let verify!: () => void;
    const gate = new Promise<void>((resolve) => { verify = resolve; });
    const h = harness(sketchDocument(), async () => {
        await gate;
        return { runId: "drawing-run", agents: [{ runId: "drawing-run", toolCallId: "drawing-tool" }] };
    });
    h.emit({ type: "subagent.started", agentId: "drawing-agent", data: { toolCallId: "drawing-tool" } });
    h.delta(operation() + '{"op":"invalid"}\n');
    h.resolve(operation() + done);
    await setImmediate();
    assert.equal(h.unsubscribed, false);
    verify();
    await assert.rejects(h.result, /unknown operation/);
    assert.equal(h.failures.length, 1);
});

test("late identity lookups cannot publish after cancellation or worker failure", async () => {
    for (const cancelled of [false, true]) {
        let verify!: () => void;
        const gate = new Promise<void>((resolve) => { verify = resolve; });
        const h = harness(sketchDocument(), async () => {
            await gate;
            return { runId: "drawing-run", agents: [{ runId: "drawing-run", toolCallId: "drawing-tool" }] };
        });
        h.emit({ type: "subagent.started", agentId: "drawing-agent", data: { toolCallId: "drawing-tool" } });
        h.delta(operation());
        if (cancelled) h.controller.abort();
        h.reject(new Error("Worker stopped"));
        await assert.rejects(h.result, /Worker stopped/);
        verify();
        await setImmediate();
        assert.equal(h.previews.length, 0);
        assert.equal(h.failures.length, 1);
        assert.equal(h.unsubscribed, true);
    }
});

test("unverified stream buffers are bounded and two verified workers are rejected", async () => {
    for (const multipleWorkers of [false, true]) {
        const h = harness(sketchDocument(), async () => ({
            runId: "drawing-run", agents: ["drawing-tool", "second-tool"].map((toolCallId) => ({ runId: "drawing-run", toolCallId })),
        }));
        h.emit({ type: "subagent.started", agentId: "drawing-agent", data: { toolCallId: "drawing-tool" } });
        if (multipleWorkers) {
            h.emit({ type: "subagent.started", agentId: "second-agent", data: { toolCallId: "second-tool" } });
        } else {
            h.delta("x".repeat(1024 * 1024));
        }
        h.resolve(operation() + done);
        await assert.rejects(h.result, /buffer limit|More than one worker/);
        assert.equal(h.failures.length, 1);
        assert.equal(h.unsubscribed, true);
    }
});

test("completed-only and journaled worker output still undergoes operation validation", async () => {
    const h = harness();
    h.resolve(operation() + done);
    assert.equal((await h.result).screens[0].ui.tokens["space.1"], 90);
    const empty = harness();
    empty.resolve(null);
    await assert.rejects(empty.result, /no design operations/);
    assert.equal(empty.unsubscribed, true);
});

test("SDK trimming of outer whitespace cannot reject an otherwise identical streamed result", async () => {
    const h = harness();
    h.start();
    h.delta("\n  " + operation() + done);
    h.resolve((operation() + done).trim());
    assert.equal((await h.result).screens[0].ui.tokens["space.1"], 90);
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
        getRunDetail: async () => ({ runId: "run", agents: [] }),
        preview: () => { throw new Error("Request was replaced"); },
        failed: (error) => failures.push(error),
        run: async () => {
            receive({ type: "subagent.started", agentId: "worker", data: { workflowRunId: "run", toolCallId: "call" } });
            receive({ type: "assistant.message_delta", agentId: "worker",
                data: { messageId: "message", deltaContent: operation() } });
            return operation() + done;
        },
    });
    await assert.rejects(output, /Request was replaced/);
    assert.equal(failures.length, 1);
    assert.equal(closed, true);
});
