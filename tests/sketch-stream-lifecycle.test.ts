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
    const workers: Array<{ ready: ReturnType<typeof deferred<void>>; output: ReturnType<typeof deferred<string>> }> = [];
    const worker = (index: number) => workers[index] ??= { ready: deferred<void>(), output: deferred<string>() };
    let activeWorker = 0;
    const listeners = new Set<(event: SketchWorkerEvent) => void>();
    const prompts: string[] = [];
    const signal = new AbortController().signal;
    const runtime = {
        ...h.session,
        workflow: {
            getRunDetail: async (runId: string) => {
                assert.equal(runId, "stream-run");
                return { runId, agents: workers.map((_worker, index) => ({ runId, toolCallId: `bg-stream-tool-${index}` })) };
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
                        const current = worker(prompts.length);
                        prompts.push(prompt);
                        assert.equal(options.schema, undefined, "a whole-document schema would buffer the response");
                        assert.equal(options.agent, h.api.textWorkerAgent.name);
                        assert.equal(options.reasoningEffort, "low");
                        assert.match(prompt, /newline-delimited JSON design operations/);
                        current.ready.resolve();
                        return current.output.promise;
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
        type: "assistant.message_delta", agentId: `bg-stream-tool-${activeWorker}`,
        data: { messageId: `drawing-message-${activeWorker}`, deltaContent: text },
    });
    const operation = (x: number) => JSON.stringify({
        op: "ui", screenId: "main", edit: { op: "setToken", key: "space.1", value: x },
    }) + "\n";
    const waitForWorker = async (prototypeId = "sample") => {
        await Promise.race([worker(activeWorker).ready.promise, h.api.waitForAnswer(prototypeId).then(() => {
            throw new Error(`Design worker did not start: ${h.logs.join("\n")}`);
        })]);
        emit({ type: "subagent.started", agentId: `bg-stream-tool-${activeWorker}`,
            data: { ...(legacyEvents ? {} : { workflowRunId: "stream-run" }), toolCallId: `bg-stream-tool-${activeWorker}` } });
        emit({ type: "assistant.message_start", agentId: `bg-stream-tool-${activeWorker}`,
            data: { messageId: `drawing-message-${activeWorker}`, phase: "final_answer" } });
    };
    const nextWorker = async (source: string) => {
        worker(activeWorker).output.resolve(source);
        activeWorker++;
        await waitForWorker();
    };
    const start = async (action: "revise" | "generate" | "update" | "automatic" = "revise", prototypeId = "sample") => {
        const pending = action === "automatic"
            ? await h.api.ensureSketchStarted(await h.api.loadState(prototypeId), true)
            : await h.api.sketchAction(prototypeId, "project:tandem", {
            action, expectedRevision: before.sketch.current!.id,
            ...(action === "revise" ? { instruction: "Move the primary action right." } : {}),
        });
        await waitForWorker(prototypeId);
        return pending;
    };
    return { h, before, url: opened.url, start, delta, operation, nextWorker,
        get output() { return worker(activeWorker).output; }, listeners, prompts };
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
        await f.nextWorker(first + '{"op":"done"}');
        const second = JSON.stringify({
            op: "ui", screenId: screen.id, edit: { op: "add", parent: "screen",
                component: { id: "replacement-action", type: "Button", props: ui.nodes["primary-action"].props } },
        }) + "\n";
        f.delta(second);
        f.output.resolve(second + '{"op":"done"}');
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
        const navigation = record({ op: "upsert-transition", transition: {
            id: "open-details", fromScreenId: "main", toScreenId: "details", trigger: "Choose a drink", description: "",
        } });
        const connection = new AbortController();
        const next = await eventReader(f.url, AbortSignal.any([connection.signal, AbortSignal.timeout(10_000)]));
        f.delta(titles + navigation);
        const read = async () => (await (await fetch(new URL("api/state", f.url))).json()).sketchPreview;
        const outlined = await read();
        assert.deepEqual(outlined.document.screens.map(item => item.title), ["Menu", "Drink details"]);
        assert.deepEqual(outlined.screenStatuses, { main: "waiting", details: "waiting" });
        assert.equal(f.prompts.length, 1, "No content worker may start before the outline is complete.");
        const published = await next(state => state.sketchPreview?.document.transitions.length === 1);
        assert.ok(published.sketchPreview.document.screens.every(item => item.ui.nodes.screen.children.length === 0));
        connection.abort();
        await f.nextWorker(titles + navigation + '{"op":"done"}');
        assert.match(f.prompts[0], /OUTLINE ONLY/);
        assert.match(f.prompts[1], /CONTENTS ONLY/);
        assert.match(f.prompts[1], /"id":"open-details"/);
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
        f.output.resolve(first + second + '{"op":"done"}');
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

test("a malformed design tail retains its last valid preview and recovery checkpoint without changing approved revisions", { timeout: 15_000 }, async () => {
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
        const retained = await (await fetch(new URL("api/state", f.url))).json();
        assert.equal(retained.sketchPreview.sequence, 1);
        f.output.resolve(f.operation(90) + '{"op":"done"}');
        await f.h.api.waitForAnswer("sample");
        const failed = await f.h.api.loadState("sample");
        assert.equal(failed.processing.status, "error");
        assert.equal(failed.processing.answer, "Move the primary action right.");
        assert.equal(failed.processing.sketchRecovery.phase, "revision");
        assert.equal(failed.processing.sketchRecovery.preview.document.screens[0].ui.tokens["space.1"], 90);
        const reloaded = await (await fetch(new URL("api/state", f.url))).json();
        assert.deepEqual(reloaded.sketchPreview, partial.sketchPreview);
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

test("the factory corrects List.size once from the last valid content instead of losing or replaying it", { timeout: 15_000 }, async () => {
    const f = await setup();
    try {
        await f.start();
        const invalid = JSON.stringify({ op: "ui", screenId: "main", edit: { op: "add", parent: "screen",
            component: { id: "items", type: "List", props: { items: ["One", "Two"], size: "font.size.body" } },
        } }) + "\n";
        f.delta(f.operation(90) + invalid);
        const retained = await (await fetch(new URL("api/state", f.url))).json();
        assert.equal(retained.sketchPreview.document.screens[0].ui.tokens["space.1"], 90);
        await f.nextWorker(f.operation(90) + invalid + '{"op":"done"}');
        assert.match(f.prompts[1], /COMPONENT CORRECTION \(one attempt\)/);
        assert.match(f.prompts[1], /'size' is not a prop of List/);
        assert.match(f.prompts[1], /"space.1":90/);
        const corrected = JSON.stringify({ op: "ui", screenId: "main", edit: { op: "add", parent: "screen",
            component: { id: "items", type: "List", props: { items: ["One", "Two"] } },
        } }) + "\n";
        f.delta(corrected);
        const preview = await (await fetch(new URL("api/state", f.url))).json();
        assert.equal(preview.sketchPreview.sequence, 2, "Correction keeps one monotonic preview sequence.");
        f.output.resolve(corrected + '{"op":"done"}');
        await f.h.api.waitForAnswer("sample");
        const saved = await f.h.api.loadState("sample");
        assert.equal(saved.processing.status, "success", saved.processing.message);
        const document = await new SketchStore(f.h.root).read("sample", saved.sketch.current!);
        assert.equal(document.screens[0].ui.tokens["space.1"], 90);
        assert.deepEqual(document.screens[0].ui.nodes.items.props.items, ["One", "Two"]);
        assert.equal(Object.hasOwn(document.screens[0].ui.nodes.items.props, "size"), false);
        assert.equal(f.prompts.length, 2);
        assert.equal(saved.sketch.history.length, 2);
    } finally {
        f.output.resolve("");
        await f.h.api.waitForAnswer("sample");
        await f.h.close();
    }
});

test("a second invalid component stops with durable pages, and explicit retry after restart finishes only retained content", { timeout: 20_000 }, async () => {
    const f = await setup();
    let restarted: Awaited<ReturnType<typeof extensionHarness>> | undefined;
    try {
        await f.start("generate");
        const { ui: _ui, ...screen } = sketchDocument().screens[0];
        const line = (value: unknown) => JSON.stringify(value) + "\n";
        const titles = line({ op: "upsert-screen", screen })
            + line({ op: "upsert-screen", screen: { ...screen, id: "details", title: "Details" } })
            + line({ op: "upsert-transition", transition: {
                id: "next", fromScreenId: "main", toScreenId: "details", trigger: "Next", description: "",
            } });
        f.delta(titles);
        await f.nextWorker(titles + '{"op":"done"}');
        const valid = line({ op: "ui", screenId: "main", edit: { op: "add", parent: "screen",
            component: { id: "kept-heading", type: "Heading", props: { text: "Keep this content" } } } })
            + line({ op: "screen-status", screenId: "main", status: "ready" });
        const invalid = line({ op: "ui", screenId: "details", edit: { op: "add", parent: "screen",
            component: { id: "items", type: "List", props: { items: ["One"], size: "font.size.body" } } } });
        f.delta(valid + invalid);
        await f.nextWorker(valid + invalid + '{"op":"done"}');
        f.delta(invalid);
        f.output.resolve(invalid + '{"op":"done"}');
        await f.h.api.waitForAnswer("sample");
        const failed = await f.h.api.loadState("sample");
        assert.equal(failed.processing.status, "error");
        assert.equal(f.prompts.length, 3, "Exactly one correction attempt, not an unbounded retry loop.");
        const checkpoint = failed.processing.sketchRecovery;
        assert.equal(checkpoint.phase, "content");
        assert.deepEqual(JSON.parse(JSON.stringify(checkpoint.preview.screenStatuses)), { main: "ready", details: "waiting" });
        assert.equal(failed.sketch.current!.id, f.before.sketch.current!.id);
        restarted = await extensionHarness({}, f.h.root);
        restarted.api.setSession({ ...restarted.session, workflow: {
            getRun: async (runId: string) => {
                assert.equal(runId, "stream-run");
                return { runId, status: "failed" };
            },
        } });
        const reopened = await restarted.api.openTandem({
            instanceId: "restarted", extensionId: "project:tandem", sessionId: restarted.session.sessionId,
            input: { prototypeId: "sample" },
        });
        await restarted.api.waitForAnswer("sample");
        const visible = await (await fetch(new URL("api/state", reopened.url))).json();
        assert.deepEqual(visible.sketchPreview, JSON.parse(JSON.stringify(checkpoint.preview)), "Restart restores the last validated pages.");
        const retryInput = { action: "retry", expectedRevision: failed.sketch.current!.id,
            expectedGeneration: failed.generation, requestId: failed.processing.requestId };
        await assert.rejects(restarted.api.sketchAction("sample", "project:tandem", { ...retryInput, requestId: "obsolete" }), /matching recovery checkpoint/);
        const retryPrompts: string[] = [];
        const h = restarted;
        const runtime = {
            ...h.session, on: () => () => {},
            workflow: { getRunDetail: async () => ({ runId: "retry-run", agents: [] }) },
            rpc: { ...h.session.rpc, workflow: { run: async (request) => {
                const result = await h.api.answerFactory.run({
                    args: request.args, runId: "retry-run", signal: new AbortController().signal, session: runtime,
                    phase() {}, log() {}, step: async (_key: string, work: () => Promise<unknown>) => work(),
                    agent: async (prompt: string) => {
                        retryPrompts.push(prompt);
                        return line({ op: "ui", screenId: "details", edit: { op: "add", parent: "screen",
                            component: { id: "items", type: "List", props: { items: ["One"] } } } })
                            + line({ op: "screen-status", screenId: "details", status: "ready" }) + '{"op":"done"}';
                    },
                });
                return { status: "completed", runId: "retry-run", result };
            } } },
        };
        h.api.setSession(runtime);
        await h.api.sketchAction("sample", "project:tandem", retryInput);
        await h.api.waitForAnswer("sample");
        const saved = await h.api.loadState("sample");
        assert.equal(saved.processing.status, "success", saved.processing.message);
        assert.equal(retryPrompts.length, 1, "Retry does not repeat page planning or finished pages.");
        assert.match(retryPrompts[0], /RESUME RETAINED GENERATION/);
        assert.match(retryPrompts[0], /"kept-heading"/);
        const document = await new SketchStore(h.root).read("sample", saved.sketch.current!);
        assert.equal(document.screens[0].ui.nodes["kept-heading"].props.text, "Keep this content");
        assert.deepEqual(document.transitions, JSON.parse(JSON.stringify(checkpoint.preview.document.transitions)));
        assert.deepEqual(document.screens[1].ui.nodes.items.props.items, ["One"]);
        assert.equal(saved.sketch.history.length, 2, "A recovery checkpoint is not a saved design revision.");
        assert.equal(saved.sketch.approved, null);
    } finally {
        f.output.resolve("");
        await f.h.api.waitForAnswer("sample");
        if (restarted) await restarted.close();
        await f.h.close();
    }
});
