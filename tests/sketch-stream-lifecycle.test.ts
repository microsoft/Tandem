import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { extensionHarness } from "./helpers/extension-harness.js";
import { sketchDocument, screenPng } from "./helpers/sketch-lifecycle-fixture.js";
import type { SketchWorkerEvent } from "../src/sketch-stream-worker.js";
import { SketchStore } from "../src/sketch-store.js";

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((accept) => { resolve = accept; });
    return { resolve, promise };
}

async function setup(legacyEvents = false) {
    const h = await extensionHarness();
    const state = h.api.createState("sample", "A task app");
    state.stage = state.lifecycle.currentStage = "sketch";
    state.lifecycle.completedStages = ["prepare", "requirements"];
    state.preparation.status = "ready";
    state.requirements = { substage: "dag", usageItems: ["I want to complete a task."], suggestions: [] };
    state.prototypeApproach = { mode: "build", reason: "New GUI." };
    state.decisionGraph = { nodes: [{
        id: "usage", title: "Primary task", dependencies: [], answer: "Complete a task",
        status: "answered", question: null,
    }] };
    await h.api.persistState(state);
    const saved = await h.api.sketchAction("sample", "project:tandem", {
        action: "save", expectedRevision: null, document: sketchDocument(),
    });
    const before = await h.api.sketchAction("sample", "project:tandem", {
        action: "approve", expectedRevision: saved.sketch.current!.id,
        previews: [{ screenId: "main", data: screenPng() }],
    });
    const ready = deferred<void>();
    const output = deferred<string>();
    const listeners = new Set<(event: SketchWorkerEvent) => void>();
    const signal = new AbortController().signal;
    const runtime = {
        ...h.session,
        factory: {
            getRunDetail: async (runId: string) => {
                assert.equal(runId, "stream-run");
                return { runId, agents: [{ runId, agentId: "stream-agent", toolCallId: "bg-stream-tool" }] };
            },
        },
        on(callback: (event: SketchWorkerEvent) => void) {
            listeners.add(callback);
            return () => { listeners.delete(callback); };
        },
        rpc: { ...h.session.rpc, factory: {
            run: async (request) => {
                h.requests.push(request);
                const result = await h.api.answerFactory.run({
                    args: request.args, runId: "stream-run", signal, session: runtime,
                    log() {}, phase() {},
                    step: async (_key: string, producer: () => Promise<unknown>) => producer(),
                    agent: async (prompt: string, options: { schema?: unknown; agent?: string }) => {
                        assert.equal(options.schema, undefined, "a whole-document schema would buffer the response");
                        assert.equal(options.agent, h.api.textWorkerAgent.name);
                        assert.match(prompt, /newline-delimited JSON drawing operations/);
                        ready.resolve();
                        return output.promise;
                    },
                });
                return { status: "completed", runId: "stream-run", result };
            },
        } },
    };
    h.api.setSession(runtime);
    const opened = await h.api.openTandem({
        instanceId: "streaming", extensionId: "project:tandem", sessionId: runtime.sessionId,
        input: { prototypeId: "sample" },
    });
    const emit = (event: SketchWorkerEvent) => { for (const listener of listeners) listener(event); };
    const delta = (text: string) => emit({
        type: "assistant.message_delta", agentId: "bg-stream-tool",
        data: { messageId: "drawing-message", deltaContent: text },
    });
    const operation = (x: number) => JSON.stringify({
        op: "upsert-shape", screenId: "main", shape: { ...sketchDocument().screens[0].shapes[0], x },
    }) + "\n";
    const start = async (action: "revise" | "generate" = "revise") => {
        const pending = await h.api.sketchAction("sample", "project:tandem", {
            action, expectedRevision: before.sketch.current!.id,
            ...(action === "revise" ? { instruction: "Move the primary action right." } : {}),
        });
        await Promise.race([ready.promise, h.api.waitForAnswer("sample").then(() => {
            throw new Error(`Drawing worker did not start: ${h.logs.join("\n")}`);
        })]);
        emit({ type: "subagent.started", agentId: "bg-stream-tool",
            data: { ...(legacyEvents ? {} : { factoryRunId: "stream-run" }), toolCallId: "bg-stream-tool" } });
        return pending;
    };
    return { h, before, url: opened.url, start, delta, operation, output, listeners };
}

async function eventReader(url: string, signal: AbortSignal) {
    const response = await fetch(new URL("events", url), { signal });
    assert.equal(response.status, 200);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    return async (matches: (value: any) => boolean) => {
        for (;;) {
            const boundary = buffer.indexOf("\n\n");
            if (boundary >= 0) {
                const frame = buffer.slice(0, boundary);
                buffer = buffer.slice(boundary + 2);
                if (!frame.startsWith("data: ")) continue;
                const value = JSON.parse(frame.slice(6));
                if (matches(value)) return value;
                continue;
            }
            const result = await reader.read();
            if (result.done) throw new Error("Drawing event stream closed before the expected update.");
            buffer += decoder.decode(result.value, { stream: true });
        }
    };
}

for (const legacyEvents of [false, true]) test(`a sketch factory streams intermediate SSE previews with ${legacyEvents ? "legacy" : "current"} runtime events`, { timeout: 15_000 }, async () => {
    const f = await setup(legacyEvents);
    const connection = new AbortController();
    try {
        const next = await eventReader(f.url, AbortSignal.any([connection.signal, AbortSignal.timeout(10_000)]));
        const pending = await f.start();
        const running = await f.h.api.loadState("sample");
        const statePath = join(f.h.root, ".tandem", "efforts", "sample", "state.json");
        const persisted = await readFile(statePath, "utf8");
        f.delta(f.operation(90));
        const first = await next((state) => state.sketchPreview?.sequence === 1);
        assert.equal(first.processing.status, "running");
        assert.equal(first.revision, running.revision, "preview transport must not create state revisions");
        assert.equal(first.sketchPreview.document.screens[0].shapes[0].x, 90);
        assert.equal(first.sketchPreview.requestId, pending.processing.requestId);
        assert.equal(first.sketchPreview.baseRevisionId, f.before.sketch.current!.id);
        assert.equal(first.sketch.current.id, f.before.sketch.current!.id);
        assert.equal(first.sketch.history.length, 1);
        assert.equal(await readFile(statePath, "utf8"), persisted, "partial output must never reach durable state");

        f.delta(f.operation(110));
        const second = await next((state) => state.sketchPreview?.sequence === 2);
        assert.equal(second.sketchPreview.document.screens[0].shapes[0].x, 110);
        const reconnected = await (await fetch(new URL("api/state", f.url))).json();
        assert.equal(reconnected.sketchPreview.sequence, 2, "a reconnect receives the latest preview");
        f.output.resolve(f.operation(90) + f.operation(110) + '{"op":"done"}');
        await f.h.api.waitForAnswer("sample");
        const completed = await next((state) => state.processing?.status === "success");
        assert.equal(completed.sketchPreview, null);
        assert.equal(completed.sketch.history.length, 2);
        assert.equal(completed.sketch.approved, null);
        assert.equal(completed.lifecycle.currentStage, "sketch");
        assert.equal(f.listeners.size, 0);
        const store = new SketchStore(f.h.root);
        assert.equal((await store.read("sample", completed.sketch.current)).screens[0].shapes[0].x, 110);
        assert.equal((await store.read("sample", f.before.sketch.current!)).screens[0].shapes[0].x, 20);
    } finally {
        connection.abort();
        f.output.resolve("");
        await f.h.api.waitForAnswer("sample");
        await f.h.close();
    }
});

test("regeneration streams a fresh drawing rather than carrying forward old shapes", { timeout: 15_000 }, async () => {
    const f = await setup();
    try {
        await f.start("generate");
        const { shapes, ...screen } = sketchDocument().screens[0];
        const first = JSON.stringify({ op: "upsert-screen", screen }) + "\n";
        f.delta(first);
        const preview = await (await fetch(new URL("api/state", f.url))).json();
        assert.equal(preview.sketchPreview.document.screens[0].shapes.length, 0);
        assert.equal(preview.sketch.current.id, f.before.sketch.current!.id);
        const second = JSON.stringify({
            op: "upsert-shape", screenId: screen.id, shape: { ...shapes[0], id: "replacement-action" },
        }) + "\n";
        f.delta(second);
        f.output.resolve(first + second + '{"op":"done"}');
        await f.h.api.waitForAnswer("sample");
        const saved = await f.h.api.loadState("sample");
        assert.equal(saved.processing.status, "success", saved.processing.message);
        assert.equal(saved.sketch.current!.source, "generated");
        const document = await new SketchStore(f.h.root).read("sample", saved.sketch.current!);
        assert.deepEqual(Array.from(document.screens[0].shapes, (shape) => shape.id), ["replacement-action"]);
    } finally {
        f.output.resolve("");
        await f.h.api.waitForAnswer("sample");
        await f.h.close();
    }
});

test("a malformed drawing tail discards previews while preserving the previously approved revision", { timeout: 15_000 }, async () => {
    const f = await setup();
    try {
        await f.start();
        f.delta(f.operation(90));
        const partial = await (await fetch(new URL("api/state", f.url))).json();
        assert.ok(partial.sketchPreview, JSON.stringify({ processing: partial.processing, logs: f.h.logs }));
        assert.equal(partial.sketchPreview.sequence, 1);
        f.delta('{"op":"upsert-shape","screenId":"missing"}\n');
        const cleared = await (await fetch(new URL("api/state", f.url))).json();
        assert.equal(cleared.sketchPreview, null);
        f.output.resolve(f.operation(90) + '{"op":"done"}');
        await f.h.api.waitForAnswer("sample");
        const failed = await f.h.api.loadState("sample");
        assert.equal(failed.processing.status, "error");
        assert.equal(failed.processing.answer, "Move the primary action right.");
        assert.equal(JSON.stringify(failed.sketch), JSON.stringify(f.before.sketch));
        assert.equal(f.listeners.size, 0);
    } finally {
        f.output.resolve("");
        await f.h.api.waitForAnswer("sample");
        await f.h.close();
    }
});

test("requirements replaced during streaming reject late drawing output and hide its preview", { timeout: 15_000 }, async () => {
    const f = await setup();
    try {
        await f.start();
        f.delta(f.operation(90));
        const state = await f.h.api.loadState("sample");
        state.decisionGraph.nodes[0].answer = "A different accepted task";
        await f.h.api.persistState(state);
        f.delta(f.operation(110));
        const current = await (await fetch(new URL("api/state", f.url))).json();
        assert.equal(current.sketchPreview, null);
        f.output.resolve(f.operation(90) + f.operation(110) + '{"op":"done"}');
        await f.h.api.waitForAnswer("sample");
        assert.equal((await f.h.api.loadState("sample")).sketch.current!.id, f.before.sketch.current!.id);
    } finally {
        f.output.resolve("");
        await f.h.api.waitForAnswer("sample");
        await f.h.close();
    }
});
