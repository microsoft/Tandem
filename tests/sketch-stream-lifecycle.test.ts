import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { extensionHarness } from "./helpers/extension-harness.js";
import { sketchDocument, screenPng } from "./helpers/sketch-lifecycle-fixture.js";
import type { SketchWorkerEvent } from "../src/sketch-stream-worker.js";
import { SketchStore } from "../src/sketch-store.js";
import { requirementsInputDigest } from "../src/requirements-reconciliation.js";
import { applyOperations } from "./helpers/ui-dsl-fixture.js";

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((accept) => { resolve = accept; });
    return { resolve, promise };
}

async function setup(legacyEvents = false, document = sketchDocument()) {
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
        action: "save", expectedRevision: null, document,
    });
    const before = await h.api.sketchAction("sample", "project:tandem", {
        action: "approve", expectedRevision: saved.sketch.current!.id,
        previews: document.screens.map(screen => ({ screenId: screen.id, data: screenPng(screen.width, screen.height) })),
    });
    const ready = deferred<void>();
    const output = deferred<string>();
    const listeners = new Set<(event: SketchWorkerEvent) => void>();
    const prompts: string[] = [];
    const signal = new AbortController().signal;
    const runtime = {
        ...h.session,
        workflow: {
            getRunDetail: async (runId: string) => {
                assert.equal(runId, "stream-run");
                return { runId, agents: [{ runId, agentId: "stream-agent", toolCallId: "bg-stream-tool" }] };
            },
        },
        on(callback: (event: SketchWorkerEvent) => void) {
            listeners.add(callback);
            return () => { listeners.delete(callback); };
        },
        rpc: { ...h.session.rpc, model: { getCurrent: async () => ({ modelId: "fixture-model", reasoningEffort: "low" }) }, workflow: {
            run: async (request) => {
                h.requests.push(request);
                const result = await h.api.answerFactory.run({
                    args: request.args, runId: "stream-run", signal, session: runtime,
                    log() {}, phase() {},
                    step: async (_key: string, producer: () => Promise<unknown>) => producer(),
                    agent: async (prompt: string, options: { schema?: unknown; agent?: string; reasoningEffort: string }) => {
                        prompts.push(prompt);
                        assert.equal(options.schema, undefined, "a whole-document schema would buffer the response");
                        assert.equal(options.agent, h.api.textWorkerAgent.name);
                        assert.equal(options.reasoningEffort, "low");
                        assert.match(prompt, /newline-delimited JSON design operations/);
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
        op: "ui", screenId: "main", edit: { op: "setToken", key: "space.1", value: x },
    }) + "\n";
    const start = async (action: "revise" | "generate" | "update" | "automatic" = "revise", prototypeId = "sample") => {
        const pending = action === "automatic"
            ? await h.api.ensureSketchStarted(await h.api.loadState(prototypeId), true)
            : await h.api.sketchAction(prototypeId, "project:tandem", {
            action, expectedRevision: before.sketch.current!.id,
            ...(action === "revise" ? { instruction: "Move the primary action right." } : {}),
        });
        await Promise.race([ready.promise, h.api.waitForAnswer(prototypeId).then(() => {
            throw new Error(`Design worker did not start: ${h.logs.join("\n")}`);
        })]);
        emit({ type: "subagent.started", agentId: "bg-stream-tool",
            data: { ...(legacyEvents ? {} : { workflowRunId: "stream-run" }), toolCallId: "bg-stream-tool" } });
        emit({ type: "assistant.message_start", agentId: "bg-stream-tool",
            data: { messageId: "drawing-message", phase: "final_answer" } });
        return pending;
    };
    return { h, before, url: opened.url, start, delta, operation, output, listeners, prompts };
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
            if (result.done) throw new Error("Design event stream closed before the expected update.");
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
        assert.equal(first.sketchPreview.document.screens[0].ui.tokens["space.1"], 90);
        assert.equal(first.sketchPreview.requestId, pending.processing.requestId);
        assert.equal(first.sketchPreview.baseRevisionId, f.before.sketch.current!.id);
        assert.equal(first.sketch.current.id, f.before.sketch.current!.id);
        assert.equal(first.sketch.history.length, 1);
        assert.equal(await readFile(statePath, "utf8"), persisted, "partial output must never reach durable state");

        f.delta(f.operation(110));
        const second = await next((state) => state.sketchPreview?.sequence === 2);
        assert.equal(second.sketchPreview.document.screens[0].ui.tokens["space.1"], 110);
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
        assert.equal((await store.read("sample", completed.sketch.current)).screens[0].ui.tokens["space.1"], 110);
        assert.equal((await store.read("sample", f.before.sketch.current!)).screens[0].ui.tokens["space.1"], 20);
    } finally {
        connection.abort();
        f.output.resolve("");
        await f.h.api.waitForAnswer("sample");
        await f.h.close();
    }
});

test("regeneration streams a fresh UI document rather than carrying forward old components", { timeout: 15_000 }, async () => {
    const f = await setup();
    try {
        await f.start("generate");
        const { ui, ...screen } = sketchDocument().screens[0];
        const first = JSON.stringify({ op: "upsert-screen", screen }) + "\n";
        f.delta(first);
        const preview = await (await fetch(new URL("api/state", f.url))).json();
        assert.deepEqual(preview.sketchPreview.document.screens[0].ui.nodes.screen.children, []);
        assert.equal(preview.sketch.current.id, f.before.sketch.current!.id);
        const second = JSON.stringify({
            op: "ui", screenId: screen.id, edit: { op: "add", parent: "screen",
                component: { id: "replacement-action", type: "Button", props: ui.nodes["primary-action"].props } },
        }) + "\n";
        f.delta(second);
        f.output.resolve(first + second + '{"op":"done"}');
        await f.h.api.waitForAnswer("sample");
        const saved = await f.h.api.loadState("sample");
        assert.equal(saved.processing.status, "success", saved.processing.message);
        assert.equal(saved.sketch.current!.source, "generated");
        const document = await new SketchStore(f.h.root).read("sample", saved.sketch.current!);
        assert.deepEqual(document.screens[0].ui.nodes.screen.children, ["replacement-action"]);
    } finally {
        f.output.resolve("");
        await f.h.api.waitForAnswer("sample");
        await f.h.close();
    }
});

for (const pinned of [false, true]) test(`requirements updates preserve the reviewed design set ${pinned ? "in an unlinked review" : "in the current stage"}`, {
    timeout: 15_000,
}, async () => {
    const document = sketchDocument();
    document.screens[0].notes = "Reviewed spacing and primary action.";
    document.screens.push({ ...structuredClone(document.screens[0]), id: "help", title: "Reviewed help", width: 480 });
    const f = await setup(false, document);
    let prototypeId = "sample";
    try {
        const parent = await f.h.api.loadState("sample");
        parent.assumed.push("Show updated task details.");
        parent.sketch = { ...parent.sketch, status: "stale", approved: null };
        if (pinned) {
            parent.stage = parent.lifecycle.currentStage = "prototype";
            parent.lifecycle.completedStages = ["prepare", "requirements", "sketch"];
        }
        await f.h.api.persistState(parent);
        if (pinned) {
            const draft = await f.h.api.openStageReview("sample", "project:tandem", {
                stageId: "sketch", expectedGeneration: parent.generation,
            });
            prototypeId = draft.prototypeId;
            assert.equal(draft.stageReview!.changeRequestId, undefined);
            assert.deepEqual(JSON.parse(JSON.stringify(draft.changeRequests)), []);
        }
        await assert.rejects(f.h.api.sketchAction(prototypeId, "project:tandem", {
            action: "update", expectedRevision: "replaced-revision",
        }), /another view/);
        assert.equal(f.h.requests.length, 0);
        const pending = await f.start(pinned ? "update" : "automatic", prototypeId);
        assert.equal(pending.processing.action, "revise-sketch");
        assert.match(pending.processing.message, /Updating existing designs/);
        assert.equal(pending.sketch.requests!.at(-1)!.kind, "update");
        assert.match(f.prompts[0], /INCREMENTAL UPDATE/);
        assert.match(f.prompts[0], /"title":"Reviewed help"/);
        assert.doesNotMatch(f.prompts[0], /Start from an empty sketch set|TITLE-FIRST ORDER/);
        f.delta(f.operation(90));
        const endpoint = pinned ? `/api/reviews/${prototypeId}/state` : "/api/state";
        const response = await fetch(new URL(endpoint, f.url));
        assert.equal(response.status, 200);
        const preview = await response.json();
        assert.equal(preview.sketchPreview.document.screens.length, 2);
        assert.deepEqual(preview.sketchPreview.document.screens[0].ui.nodes, document.screens[0].ui.nodes);
        assert.equal(preview.sketchPreview.document.screens[0].ui.tokens["space.1"], 90);
        assert.deepEqual(preview.sketchPreview.document.screens[1], document.screens[1]);
        assert.deepEqual(preview.sketchPreview.screenStatuses, { main: "processing", help: "ready" });
        assert.equal(preview.sketchPreview.baseRevisionId, f.before.sketch.current!.id);
        assert.equal(preview.sketch.current.id, f.before.sketch.current!.id);
        f.output.resolve(f.operation(90) + '{"op":"done"}');
        await f.h.api.waitForAnswer(prototypeId);
        const saved = await f.h.api.loadState(prototypeId);
        assert.equal(saved.processing.status, "success", saved.processing.message);
        assert.equal(saved.sketch.current!.source, "revised");
        assert.equal(saved.sketch.current!.requirementsDigest, requirementsInputDigest(parent));
        assert.equal(saved.sketch.status, "draft");
        assert.equal(saved.sketch.approved, null);
        const expected = structuredClone(document);
        expected.screens[0].ui = applyOperations(expected.screens[0].ui, [{ op: "setToken", key: "space.1", value: 90 }]);
        const store = new SketchStore(f.h.root);
        assert.deepEqual(await store.read("sample", saved.sketch.current!), expected);
        assert.deepEqual(await store.read("sample", f.before.sketch.current!), document);
        assert.equal((await f.h.api.loadState("sample")).lifecycle.currentStage, pinned ? "prototype" : "sketch");
        if (pinned) assert.equal((await f.h.api.loadState("sample")).sketch.current!.id, f.before.sketch.current!.id);
        assert.equal(f.h.requests.length, 1);
    } finally {
        f.output.resolve("");
        await f.h.api.waitForAnswer(prototypeId);
        await f.h.close();
    }
});

test("legacy Lucide names survive the real design factory as canonical previews and immutable saved revisions", { timeout: 15_000 }, async () => {
    const f = await setup();
    try {
        const pending = await f.start();
        const operation = JSON.stringify({
            op: "ui", screenId: "main", edit: { op: "update", id: "primary-action", props: { icon: "trash-2" } },
        }) + "\n";
        f.delta(operation);
        const preview = await (await fetch(new URL("api/state", f.url))).json();
        assert.equal(preview.sketchPreview.document.screens[0].ui.nodes["primary-action"].props.icon, "trash");
        assert.equal(preview.sketchPreview.requestId, pending.processing.requestId);
        assert.equal(preview.sketch.current.id, f.before.sketch.current!.id, "A preview does not replace accepted designs.");
        f.output.resolve(operation + '{"op":"done"}');
        await f.h.api.waitForAnswer("sample");
        const saved = await f.h.api.loadState("sample");
        assert.equal(saved.processing.status, "success", saved.processing.message);
        assert.equal(saved.sketch.approved, null, "Canonicalizing an alias does not approve the new revision.");
        assert.equal(saved.sketch.history.length, 2);
        assert.equal(saved.lifecycle.currentStage, "sketch");
        const store = new SketchStore(f.h.root);
        assert.equal((await store.read("sample", saved.sketch.current!)).screens[0].ui.nodes["primary-action"].props.icon, "trash");
        assert.equal((await store.read("sample", f.before.sketch.current!)).screens[0].ui.nodes["primary-action"].props.icon, "");
        assert.equal(f.listeners.size, 0);
    } finally {
        f.output.resolve("");
        await f.h.api.waitForAnswer("sample");
        await f.h.close();
    }
});

test("formatted title-first generation publishes per-page progress before saving through the real factory", { timeout: 15_000 }, async () => {
    const f = await setup();
    try {
        await f.start("generate");
        const { ui, ...screen } = sketchDocument().screens[0];
        const record = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
        const titles = record({ op: "upsert-screen", screen: { ...screen, title: "Menu" } })
            + record({ op: "upsert-screen", screen: { ...screen, id: "details", title: "Drink details" } });
        f.delta(titles);
        const read = async () => (await (await fetch(new URL("api/state", f.url))).json()).sketchPreview;
        const outlined = await read();
        assert.deepEqual(outlined.document.screens.map(item => item.title), ["Menu", "Drink details"]);
        assert.deepEqual(outlined.screenStatuses, { main: "waiting", details: "waiting" });
        const first = record({ op: "screen-status", screenId: "main", status: "processing" })
            + record({ op: "ui", screenId: "main", edit: { op: "add", parent: "screen",
                component: { id: "primary-action", type: "Button", props: ui.nodes["primary-action"].props } } })
            + record({ op: "screen-status", screenId: "main", status: "ready" });
        f.delta(first);
        assert.deepEqual((await read()).screenStatuses, { main: "ready", details: "waiting" });
        const second = record({ op: "screen-status", screenId: "details", status: "processing" })
            + record({ op: "ui", screenId: "details", edit: { op: "add", parent: "screen",
                component: { id: "heading", type: "Heading", props: { text: "Drink details" } } } })
            + record({ op: "screen-status", screenId: "details", status: "ready" });
        f.delta(second);
        assert.deepEqual((await read()).screenStatuses, { main: "ready", details: "ready" });
        f.output.resolve(titles + first + second + '{"op":"done"}');
        await f.h.api.waitForAnswer("sample");
        const saved = await f.h.api.loadState("sample");
        assert.equal(saved.processing.status, "success", saved.processing.message);
        assert.equal(await read(), null);
        const document = await new SketchStore(f.h.root).read("sample", saved.sketch.current!);
        assert.deepEqual(document.screens.map(item => item.title), ["Menu", "Drink details"]);
        assert.equal(Object.hasOwn(document, "screenStatuses"), false);
        assert.equal(saved.sketch.approved, null);
    } finally {
        f.output.resolve("");
        await f.h.api.waitForAnswer("sample");
        await f.h.close();
    }
});

test("a malformed design tail discards previews while preserving the previously approved revision", { timeout: 15_000 }, async () => {
    const f = await setup();
    try {
        const assets = await Promise.all(f.before.sketch.approved!.assets.map(async asset =>
            ({ path: asset.path, bytes: await readFile(join(f.h.root, asset.path)) })));
        const pending = await f.start();
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
        const { requests, ...preserved } = failed.sketch;
        assert.equal(JSON.stringify(preserved), JSON.stringify(f.before.sketch));
        assert.equal(JSON.stringify(requests), JSON.stringify(pending.sketch.requests),
            "The failed revision retains its exact submitted request audit.");
        assert.equal(requests!.length, 1);
        assert.equal(requests![0].instruction, "Move the primary action right.");
        assert.equal(requests![0].baseRevisionId, f.before.sketch.current!.id);
        for (const asset of assets) assert.deepEqual(await readFile(join(f.h.root, asset.path)), asset.bytes,
            `Approved asset ${asset.path} must remain unchanged.`);
        assert.equal(f.listeners.size, 0);
    } finally {
        f.output.resolve("");
        await f.h.api.waitForAnswer("sample");
        await f.h.close();
    }
});

test("requirements replaced during streaming reject late design output and hide its preview", { timeout: 15_000 }, async () => {
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
