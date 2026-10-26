import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { extensionHarness } from "./helpers/extension-harness.js";
import { sketchDocument, screenPng } from "./helpers/sketch-lifecycle-fixture.js";
import { SketchStore } from "../src/sketch-store.js";
import { requirementsInputDigest } from "../src/requirements-reconciliation.js";
import { readPrototypeFlow } from "../src/prototype-flow.js";
import type { TandemState } from "../src/types.js";

async function setup(fidelity: "wireframe" | "styled" | null = "wireframe") {
    const h = await extensionHarness();
    const state = h.api.createState("sample", "Complete a task");
    state.stage = state.lifecycle.currentStage = "prototype";
    state.lifecycle.completedStages = ["prepare", "requirements", "sketch"];
    state.preparation.status = "ready";
    state.prototypeApproach = { mode: "build", reason: "New GUI" };
    state.requirements = { substage: "dag", usageItems: ["Complete a task"], suggestions: [] };
    state.decisionGraph.nodes = [{ id: "usage", title: "Primary task", status: "answered",
        answer: "Complete a task", dependencies: [], question: null }];
    const document = sketchDocument();
    if (fidelity) document.fidelity = fidelity;
    await h.api.persistState(state);
    const bound = await h.api.loadState("sample");
    const store = new SketchStore(h.root);
    const current = await store.save("sample", document, {
        requirementsDigest: requirementsInputDigest(bound), source: "generated", number: 1,
    });
    const approved = await store.approve("sample", current, [{ screenId: "main", data: screenPng() }]);
    bound.sketch = { version: 1, status: "approved", current, approved, history: [current] };
    await h.api.persistState(bound);
    return h;
}

function output(id: string, port: number) {
    return { summary: `${id} ready`, focus: "Try the primary task.",
        previewUrl: `http://127.0.0.1:${port}/`, question: null,
        artifactChanges: { upsert: [], remove: [] }, evidence: ["Mock primary task observed."] };
}

type Harness = Awaited<ReturnType<typeof setup>>;
function runtime(h: Harness, agent: (prompt: string, runId: string) => Promise<unknown>, legacyProgressive = true) {
    const session = { ...h.session, rpc: { ...h.session.rpc, workflow: {
        run: async (request: { args: Record<string, unknown> }) => {
            h.requests.push(request);
            const runId = `progressive-${h.requests.length}`;
            if (legacyProgressive && h.requests.length === 1) {
                // Rehydrate the pre-merge protocol without asking production dispatch to create it.
                const admitted = await h.api.loadState("sample");
                const checkpoint = admitted.prototypeFlow!.checkpoints[0];
                checkpoint.milestone = "structure";
                checkpoint.continuation = "interaction";
                await h.api.persistState(admitted);
                request.args = { ...request.args, state: admitted };
            }
            try {
                const result = await h.api.answerFactory.run({
                    args: request.args, runId, signal: new AbortController().signal,
                    phase() {}, log() {}, step: (_: string, work: () => Promise<unknown>) => work(),
                    agent: (prompt: string) => agent(prompt, runId),
                });
                return { status: "completed", runId, result };
            } catch (error) {
                return { status: "failed", runId, error: error instanceof Error ? error.message : String(error) };
            }
        },
    } } };
    h.api.setSession(session);
}

async function publish(h: Harness, runId: string) {
    const state = await h.api.loadState("sample");
    const source = state.prototypeFlow!.checkpoints.find(item => item.id === state.prototypeFlow!.activeCheckpointId)!;
    await h.api.readSketchImage({ prototypeId: "sample", checkpointId: source.id, revisionId: source.sketchRevisionId, screenId: "main" });
    await writeFile(join(source.workspacePath, "app.mjs"), "// First usable slice\n");
    h.setPreviewHtml(`<meta name="tandem-prototype-id" content="sample"><meta name="tandem-prototype-checkpoint" content="${source.id}">`);
    const input = { prototypeId: "sample", checkpointId: source.id, runId, result: output(source.id, 12346) };
    const published = await h.api.publishPrototypeStructure(input);
    return { source, input, continuation: JSON.parse(published.textResultForLlm) as {
        checkpointId: string; workspacePath: string; sourceCheckpointId: string; prompt: string;
    } };
}

test("new and historical designs build one complete Prototype checkpoint with one worker and no split-stage continuation", async () => {
    for (const fidelity of ["wireframe", "styled", null] as const) {
        const h = await setup(fidelity);
        try {
            let workers = 0;
            runtime(h, async prompt => {
                workers++;
                assert.match(prompt, /PROTOTYPE: build one small, runnable end-to-end primary journey/);
                assert.match(prompt, /single checkpoint/);
                assert.doesNotMatch(prompt, /PROGRESSIVE BUILD|Call tandem_publish_structure/);
                const state = await h.api.loadState("sample");
                const checkpoint = state.prototypeFlow!.checkpoints[0];
                assert.equal(checkpoint.milestone, "prototype");
                assert.equal(checkpoint.continuation, undefined);
                await h.api.readSketchImage({ prototypeId: "sample", checkpointId: checkpoint.id, revisionId: checkpoint.sketchRevisionId, screenId: "main" });
                await writeFile(join(checkpoint.workspacePath, "app.mjs"), "// Complete mocked primary task\n");
                h.setPreviewHtml(`<meta name="tandem-prototype-id" content="sample"><meta name="tandem-prototype-checkpoint" content="${checkpoint.id}">`);
                return output(checkpoint.id, 12346);
            }, false);
            await h.api.beginPrototypeBuild("sample", "project:tandem");
            await h.api.waitForAnswer("sample");
            const ready = await h.api.loadState("sample");
            assert.equal(ready.processing.status, "success", ready.processing.message);
            assert.equal(workers, 1);
            assert.equal(h.requests.length, 1);
            assert.equal(ready.prototypeFlow!.checkpoints.length, 1);
            assert.equal(ready.prototypeFlow!.pendingCheckpointId, null);
            assert.equal(ready.prototypeFlow!.displayedCheckpointId, ready.prototypeFlow!.checkpoints[0].id);
            assert.equal(h.api.stageCompletionError(ready, "prototype", { requirePrototypeSpec: false }), null);
        } finally { await h.close(); }
    }
});

test("combined Prototype revisions reuse source and remain pending explicit acceptance", async () => {
    const h = await setup();
    try {
        runtime(h, async prompt => {
            const state = await h.api.loadState("sample");
            const checkpoint = state.prototypeFlow!.checkpoints.at(-1)!;
            assert.equal(checkpoint.milestone, "prototype");
            if (h.requests.length > 1) {
                assert.match(prompt, /REVISION: apply ONLY/);
                assert.match(prompt, /Do not scaffold a replacement app/);
                assert.equal(await readFile(join(checkpoint.workspacePath, "app.mjs"), "utf8"), "// Initial task\n");
            }
            await h.api.readSketchImage({ prototypeId: "sample", checkpointId: checkpoint.id, revisionId: checkpoint.sketchRevisionId, screenId: "main" });
            await writeFile(join(checkpoint.workspacePath, "app.mjs"), h.requests.length === 1 ? "// Initial task\n" : "// Requested task update\n");
            h.setPreviewHtml(`<meta name="tandem-prototype-id" content="sample"><meta name="tandem-prototype-checkpoint" content="${checkpoint.id}">`);
            return output(checkpoint.id, 12345 + h.requests.length);
        }, false);
        await h.api.beginPrototypeBuild("sample", "project:tandem");
        await h.api.waitForAnswer("sample");
        const first = await h.api.loadState("sample");
        await h.api.queuePrototypeRevision("sample", "project:tandem", {
            suggestion: "Show an error for an empty task name.", clientRequestId: "focused-update",
            baseCheckpointId: first.prototypeFlow!.displayedCheckpointId,
        });
        await h.api.prototypeAction("sample", "project:tandem", { action: "retry" });
        await h.waitForRequests(2);
        await h.api.waitForAnswer("sample");
        const pending = await h.api.loadState("sample");
        assert.equal(pending.processing.status, "success", pending.processing.message);
        assert.equal(pending.previewUrl, first.previewUrl);
        assert.equal(pending.prototypeFlow!.checkpoints.length, 2);
        assert.match(h.api.stageCompletionError(pending, "prototype", { requirePrototypeSpec: false })!, /Apply/);
        await h.api.prototypeAction("sample", "project:tandem", {
            action: "apply-update", checkpointId: pending.prototypeFlow!.pendingCheckpointId,
        });
        const applied = await h.api.loadState("sample");
        assert.equal(applied.prototypeFlow!.pendingCheckpointId, null);
        assert.equal(applied.prototypeFlow!.displayedCheckpointId, pending.prototypeFlow!.pendingCheckpointId);
        assert.equal(h.requests.length, 2);
    } finally { await h.close(); }
});

test("an already-admitted legacy progressive worker retains its early preview and explicit later acceptance", async () => {
    const h = await setup();
    try {
        let workers = 0;
        let intermediate: TandemState | undefined;
        runtime(h, async (prompt, runId) => {
            workers++;
            assert.match(prompt, /PROGRESSIVE BUILD/);
            assert.match(prompt, /tandem_publish_structure_project/);
            assert.match(prompt, /WIREFRAME APPROVAL/);
            const { source, input, continuation } = await publish(h, runId);
            intermediate = await h.api.loadState("sample");
            assert.equal(intermediate.processing.status, "running");
            assert.equal(intermediate.prototypeFlow!.displayedCheckpointId, source.id);
            assert.equal(intermediate.prototypeFlow!.pendingCheckpointId, null);
            assert.equal(intermediate.prototypeFlow!.activeCheckpointId, continuation.checkpointId);
            assert.equal(intermediate.factoryRuns!.at(-1)!.terminal, false);
            assert.match(continuation.prompt, /INCREMENTAL BEHAVIOR ONLY/);
            assert.match(continuation.prompt, /tool-backed reads retain that original identity/);
            assert.doesNotMatch(continuation.prompt, /PROGRESSIVE BUILD/);
            assert.ok(continuation.prompt.length < prompt.length / 2, "Continuation should reuse context instead of resending the full design and requirements.");
            assert.equal(await readFile(join(continuation.workspacePath, "app.mjs"), "utf8"), "// First usable slice\n");
            const again = JSON.parse((await h.api.publishPrototypeStructure(input)).textResultForLlm);
            assert.equal(again.checkpointId, continuation.checkpointId);
            assert.equal((await h.api.loadState("sample")).prototypeFlow!.checkpoints.length, 2);
            await writeFile(join(continuation.workspacePath, "app.mjs"), "// Add behavior without changing the published slice\n");
            assert.equal(await readFile(join(source.workspacePath, "app.mjs"), "utf8"), "// First usable slice\n");
            h.setPreviewHtml(`<meta name="tandem-prototype-id" content="sample"><meta name="tandem-prototype-checkpoint" content="${continuation.checkpointId}">`);
            return output(continuation.checkpointId, 12347);
        });
        await h.api.beginPrototypeBuild("sample", "project:tandem");
        await h.api.waitForAnswer("sample");
        const ready = await h.api.loadState("sample");
        assert.equal(ready.processing.status, "success", ready.processing.message);
        assert.ok(intermediate, "Structure must be available before the worker's final result.");
        assert.equal(workers, 1);
        assert.equal(h.requests.length, 1);
        const [structure, interaction] = ready.prototypeFlow!.checkpoints;
        assert.deepEqual([structure.status, interaction.status], ["ready", "ready"]);
        assert.equal(structure.requestId, interaction.requestId);
        assert.deepEqual(Array.from(structure.sketchImagesRead!), ["main"]);
        assert.deepEqual(Array.from(interaction.sketchImagesRead!), []);
        assert.equal(ready.prototypeFlow!.displayedCheckpointId, structure.id);
        assert.equal(ready.prototypeFlow!.pendingCheckpointId, interaction.id);
        assert.equal(ready.factoryRuns!.at(-1)!.terminal, true);
        assert.ok(structure.sourceFingerprint && interaction.sourceFingerprint);
        assert.deepEqual(readPrototypeFlow(JSON.parse(JSON.stringify(ready.prototypeFlow))), JSON.parse(JSON.stringify(ready.prototypeFlow)));
        await assert.rejects(h.api.publishPrototypeStructure({
            prototypeId: "sample", checkpointId: structure.id, runId: "progressive-1", result: output(structure.id, 12346),
        }), /no longer owns/);
    } finally { await h.close(); }
});

test("failed Interaction retains the published Structure and explicit retry only runs missing behavior", async () => {
    const h = await setup();
    try {
        runtime(h, async (_prompt, runId) => {
            await publish(h, runId);
            throw new Error("Interaction worker interrupted");
        });
        await h.api.beginPrototypeBuild("sample", "project:tandem");
        await h.api.waitForAnswer("sample");
        const failed = await h.api.loadState("sample");
        const [structure, interaction] = failed.prototypeFlow!.checkpoints;
        assert.equal(failed.processing.status, "error");
        assert.equal(structure.status, "ready");
        assert.equal(interaction.status, "failed");
        assert.equal(failed.previewUrl, structure.previewUrl);
        runtime(h, async prompt => {
            assert.match(prompt, /PROTOTYPE: build one small/);
            assert.doesNotMatch(prompt, /PROGRESSIVE BUILD|tool-backed reads retain/);
            const state = await h.api.loadState("sample");
            const checkpoint = state.prototypeFlow!.checkpoints.at(-1)!;
            await h.api.readSketchImage({ prototypeId: "sample", checkpointId: checkpoint.id, revisionId: checkpoint.sketchRevisionId, screenId: "main" });
            h.setPreviewHtml(`<meta name="tandem-prototype-id" content="sample"><meta name="tandem-prototype-checkpoint" content="${checkpoint.id}">`);
            return output(checkpoint.id, 12348);
        });
        await h.api.prototypeAction("sample", "project:tandem", {
            action: "retry", checkpointId: interaction.id, expectedRevision: failed.revision,
        });
        await h.api.waitForAnswer("sample");
        const retried = await h.api.loadState("sample");
        assert.equal(retried.processing.status, "success", retried.processing.message);
        assert.equal(retried.prototypeFlow!.checkpoints.length, 3);
        assert.equal(retried.prototypeFlow!.checkpoints[0].id, structure.id);
        assert.equal(retried.prototypeFlow!.checkpoints[2].milestone, "prototype");
        assert.equal(h.requests.length, 2);
    } finally { await h.close(); }
});

test("a resumed workflow continues the active Interaction copy instead of replaying its original Structure arguments", async () => {
    const h = await setup();
    try {
        runtime(h, async (_prompt, runId) => {
            const { source, continuation } = await publish(h, runId);
            const state = await h.api.loadState("sample");
            state.prototypeFlow!.checkpoints.find(item => item.id === continuation.checkpointId)!.workspacePrepared = false;
            await h.api.persistState(state);
            const request = h.requests[0] as { args: Record<string, unknown> };
            return h.api.answerFactory.run({
                args: request.args, runId, signal: new AbortController().signal,
                phase() {}, log() {}, step: (_: string, work: () => Promise<unknown>) => work(),
                agent: async (prompt: string) => {
                    assert.match(prompt, /Milestone: interaction/);
                    assert.doesNotMatch(prompt, /PROGRESSIVE BUILD/);
                    assert.ok(prompt.includes(continuation.workspacePath));
                    assert.equal(await readFile(join(continuation.workspacePath, "app.mjs"), "utf8"), "// First usable slice\n");
                    const running = await h.api.loadState("sample");
                    assert.equal(running.prototypeFlow!.checkpoints.length, 2);
                    assert.equal(running.prototypeFlow!.checkpoints[0].id, source.id);
                    assert.equal(running.prototypeFlow!.checkpoints[1].workspacePrepared, true);
                    h.setPreviewHtml(`<meta name="tandem-prototype-id" content="sample"><meta name="tandem-prototype-checkpoint" content="${continuation.checkpointId}">`);
                    return output(continuation.checkpointId, 12347);
                },
            });
        });
        await h.api.beginPrototypeBuild("sample", "project:tandem");
        await h.api.waitForAnswer("sample");
        const ready = await h.api.loadState("sample");
        assert.equal(ready.processing.status, "success", ready.processing.message);
        assert.equal(ready.prototypeFlow!.checkpoints.length, 2);
        assert.equal(h.requests.length, 1);
    } finally { await h.close(); }
});

test("early publication rejects missing image evidence and stale run identities without advancing", async () => {
    const h = await setup();
    try {
        runtime(h, async (_prompt, runId) => {
            const state = await h.api.loadState("sample");
            const checkpoint = state.prototypeFlow!.checkpoints[0];
            h.setPreviewHtml(`<meta name="tandem-prototype-id" content="sample"><meta name="tandem-prototype-checkpoint" content="${checkpoint.id}">`);
            const input = { prototypeId: "sample", checkpointId: checkpoint.id, runId, result: output(checkpoint.id, 12346) };
            await assert.rejects(h.api.publishPrototypeStructure({ ...input, runId: "foreign-run" }), /no longer owns/);
            await assert.rejects(h.api.publishPrototypeStructure(input), /read every approved/);
            assert.equal((await h.api.loadState("sample")).prototypeFlow!.displayedCheckpointId, null);
            throw new Error("No valid publication");
        });
        await h.api.beginPrototypeBuild("sample", "project:tandem");
        await h.api.waitForAnswer("sample");
        assert.match((await h.api.loadState("sample")).processing.message, /No valid publication/);
        assert.equal(h.requests.length, 1);
    } finally { await h.close(); }
});

test("progressive completion cannot skip the early checkpoint or mutate its published source", async () => {
    for (const mutate of [false, true]) {
        const h = await setup();
        try {
            runtime(h, async (_prompt, runId) => {
                if (!mutate) return output("unpublished", 12346);
                const { source, continuation } = await publish(h, runId);
                await writeFile(join(source.workspacePath, "app.mjs"), "// Forbidden published-source change\n");
                h.setPreviewHtml(`<meta name="tandem-prototype-id" content="sample"><meta name="tandem-prototype-checkpoint" content="${continuation.checkpointId}">`);
                return output(continuation.checkpointId, 12347);
            });
            await h.api.beginPrototypeBuild("sample", "project:tandem");
            await h.api.waitForAnswer("sample");
            const failed = await h.api.loadState("sample");
            assert.equal(failed.processing.status, "error");
            assert.match(failed.processing.message, mutate ? /source files changed/ : /Publish the Structure preview/);
            assert.equal(failed.prototypeFlow!.pendingCheckpointId, null);
            assert.equal(h.requests.length, 1);
        } finally { await h.close(); }
    }
});
