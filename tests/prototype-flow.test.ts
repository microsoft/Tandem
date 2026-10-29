import assert from "node:assert/strict";
import { test } from "node:test";
import {
    newPrototypeFlow, nextPrototypeMilestone, readPrototypeFlow, reservePrototypeCheckpoint,
    settlePrototypeCheckpoint, promotePrototypeCheckpoint, prototypeFlowCompletionError,
    prototypeRetrySource, prototypeSketchEvidenceCheckpoint, prototypeMilestoneReady, type PrototypeCheckpoint,
} from "../src/prototype-flow.js";

function pending(id: string, milestone: PrototypeCheckpoint["milestone"], baseCheckpointId: string | null = null) {
    return {
        id, requestId: id, generation: "generation", milestone, revisionId: null, baseCheckpointId,
        sourceCheckpointId: baseCheckpointId, workspacePath: `C:\\project\\.tandem\\${id}`,
        workspacePrepared: true, status: "running" as const, previewUrl: null, summary: "", focus: "",
        requestedAt: "2026-09-09T00:00:00Z", completedAt: null,
    };
}

test("prototype checkpoints publish the first slice and require explicit later promotion", () => {
    let flow = newPrototypeFlow();
    assert.equal(nextPrototypeMilestone(flow), "prototype");
    flow = reservePrototypeCheckpoint(flow, pending("first", "prototype"));
    assert.equal(flow.budget.usedSeconds, 0);
    assert.equal(flow.checkpoints[0].timeoutSeconds, null);
    assert.equal(flow.budget.limitSeconds, null);
    flow = settlePrototypeCheckpoint(flow, "first", {
        status: "ready", previewUrl: "http://localhost:1", summary: "Wireframe", focus: "Try navigation",
    }, "2026-09-09T00:00:20Z");
    assert.equal(flow.displayedCheckpointId, "first");
    assert.equal(flow.budget.usedSeconds, 20);
    assert.equal(nextPrototypeMilestone(flow), null, "One combined checkpoint completes the functional sub-stage.");
    flow = reservePrototypeCheckpoint(flow, pending("second", "prototype", "first"));
    flow = settlePrototypeCheckpoint(flow, "second", {
        status: "ready", previewUrl: "http://localhost:2", summary: "Interaction", focus: "Try selection",
    }, "2026-09-09T00:00:30Z");
    assert.equal(flow.displayedCheckpointId, "first");
    assert.equal(flow.pendingCheckpointId, "second");
    assert.match(prototypeFlowCompletionError(flow)!, /Apply/);
    assert.throws(() => promotePrototypeCheckpoint(flow, "first"), /no longer pending/);
    flow = promotePrototypeCheckpoint(flow, "second");
    assert.equal(prototypeFlowCompletionError(flow), null);
    assert.deepEqual(readPrototypeFlow(JSON.parse(JSON.stringify(flow))), flow);
    assert.equal(nextPrototypeMilestone({ ...flow, visualRequested: true }), "visual");
});

test("failure preserves the working checkpoint and records elapsed time without a product cap", () => {
    let flow = reservePrototypeCheckpoint(newPrototypeFlow(), pending("first", "structure"));
    flow = settlePrototypeCheckpoint(flow, "first", {
        status: "ready", previewUrl: "http://localhost:1", summary: "Ready", focus: "",
    }, "2026-09-09T00:00:10Z");
    flow = reservePrototypeCheckpoint(flow, pending("failed", "interaction", "first"));
    flow = settlePrototypeCheckpoint(flow, "failed", {
        status: "failed", previewUrl: null, summary: "Timed out", focus: "",
    }, "2026-09-09T01:00:00Z");
    assert.equal(flow.displayedCheckpointId, "first");
    assert.equal(flow.budget.usedSeconds, 3610);
    assert.equal(nextPrototypeMilestone(flow), "prototype");
    assert.throws(() => settlePrototypeCheckpoint(flow, "failed", {
        status: "ready", previewUrl: "http://localhost:3", summary: "", focus: "",
    }, "2026-09-09T01:00:00Z"), /no longer owns/);
    const retried = reservePrototypeCheckpoint(flow, pending("retry", "interaction", "first"));
    assert.equal(retried.checkpoints.at(-1)!.timeoutSeconds, null);
    assert.equal(retried.budget.usedSeconds, 3610);
    assert.deepEqual(readPrototypeFlow(JSON.parse(JSON.stringify(retried))), retried);
});

test("exhausted historical budgets and timed-out checkpoints survive explicit unbounded retry", () => {
    const old: PrototypeCheckpoint = { ...pending("legacy", "structure"), timeoutSeconds: 300,
        status: "failed", summary: "Workflow limit timeoutSeconds=300 was reached", completedAt: "2026-09-09T00:05:00Z" };
    const historical = { ...newPrototypeFlow(), checkpoints: [old], budget: { limitSeconds: 900, usedSeconds: 900 } };
    assert.deepEqual(readPrototypeFlow(historical), historical);
    const retried = reservePrototypeCheckpoint(historical, pending("new", "structure"));
    assert.deepEqual(retried.checkpoints[0], old);
    assert.deepEqual(retried.budget, historical.budget);
    const settled = settlePrototypeCheckpoint(retried, "new", {
        status: "ready", previewUrl: "http://localhost:1", summary: "New request completed", focus: "",
    }, "2026-09-09T01:00:00Z");
    assert.equal(settled.budget.usedSeconds, 4500);
    assert.equal(settled.budget.limitSeconds, 900, "Historical policy is retained, not enforced or reset.");
    assert.deepEqual(readPrototypeFlow(settled), settled);
    assert.throws(() => readPrototypeFlow({ ...historical, budget: { limitSeconds: 900, usedSeconds: 1000 } }), /invalid/);
});

test("legacy states remain readable and corrupted checkpoint references fail visibly", () => {
    assert.equal(readPrototypeFlow(undefined), null);
    assert.throws(() => readPrototypeFlow({ ...newPrototypeFlow(), displayedCheckpointId: "missing" }), /invalid/);
    assert.throws(() => readPrototypeFlow({ ...newPrototypeFlow(), budget: { limitSeconds: 900, usedSeconds: NaN } }), /invalid/);
});

test("legacy Interaction satisfies unified readiness without rewriting history, while Structure alone remains partial", () => {
    let flow = reservePrototypeCheckpoint(newPrototypeFlow(), pending("old-structure", "structure"));
    flow = settlePrototypeCheckpoint(flow, "old-structure", {
        status: "ready", previewUrl: "http://localhost:1/", summary: "Original Structure", focus: "",
    }, "2026-09-09T00:00:10Z");
    assert.equal(prototypeMilestoneReady(flow, "prototype"), false);
    assert.equal(nextPrototypeMilestone(flow), "prototype");
    flow = reservePrototypeCheckpoint(flow, pending("old-interaction", "interaction", "old-structure"));
    flow = settlePrototypeCheckpoint(flow, "old-interaction", {
        status: "ready", previewUrl: "http://localhost:2/", summary: "Original Interaction", focus: "",
    }, "2026-09-09T00:00:20Z");
    assert.equal(prototypeMilestoneReady(flow, "prototype"), true);
    assert.match(prototypeFlowCompletionError(flow)!, /Apply/);
    flow = promotePrototypeCheckpoint(flow, "old-interaction");
    assert.equal(prototypeFlowCompletionError(flow), null);
    assert.deepEqual(readPrototypeFlow(flow), flow);
    assert.deepEqual(flow.checkpoints.map(item => item.milestone), ["structure", "interaction"]);
});

test("checkpoint start instructions survive reload without reusing another checkpoint's command", () => {
    const flow = reservePrototypeCheckpoint(newPrototypeFlow(), {
        ...pending("server", "structure"),
        previewStart: { entrypoint: "app\\server.mjs", workingDirectory: "app", args: ["--port", "4321"] },
    });
    assert.deepEqual(readPrototypeFlow(JSON.parse(JSON.stringify(flow))), flow);
    const previous = { ...flow.checkpoints[0], previewStart: { entrypoint: "../other.mjs", workingDirectory: ".", args: [] } };
    assert.throws(() => readPrototypeFlow({ ...flow, checkpoints: [previous] }), /saved preview/);
});

test("checkpoint sketch bindings and delivered-image receipts survive reload without partial identities", () => {
    const flow = reservePrototypeCheckpoint(newPrototypeFlow(), {
        ...pending("drawn", "structure"), sketchRevisionId: "approved-revision",
        sketchInputHash: "a".repeat(64), sketchImagesRead: ["main"],
    });
    assert.deepEqual(readPrototypeFlow(JSON.parse(JSON.stringify(flow))), flow);
    for (const patch of [
        { sketchInputHash: null }, { sketchRevisionId: null }, { sketchInputHash: "wrong" },
        { sketchImagesRead: ["main", "main"] }, { sketchImagesRead: [42] },
    ]) {
        assert.throws(() => readPrototypeFlow({
            ...flow, checkpoints: [{ ...flow.checkpoints[0], ...patch }],
        }), /invalid/);
    }
});

test("progressive image evidence retains its source identity and cannot cross requests or approvals", () => {
    const source: PrototypeCheckpoint = { ...pending("structure", "structure"),
        continuation: "interaction", timeoutSeconds: null, status: "ready", previewUrl: "http://localhost:12346/",
        completedAt: "2026-09-09T00:01:00Z", sketchRevisionId: "approved", sketchInputHash: "a".repeat(64), sketchImagesRead: ["main"] };
    const next: PrototypeCheckpoint = { ...pending("interaction", "interaction", source.id),
        requestId: source.requestId, timeoutSeconds: null, sketchRevisionId: source.sketchRevisionId, sketchInputHash: source.sketchInputHash };
    const flow = { ...newPrototypeFlow(), displayedCheckpointId: source.id, activeCheckpointId: next.id, checkpoints: [source, next] };
    assert.deepEqual(readPrototypeFlow(flow), flow);
    assert.equal(prototypeSketchEvidenceCheckpoint(flow, next), source);
    for (const change of [
        { requestId: "new-worker" }, { generation: "new-generation" }, { sketchRevisionId: "other" },
        { sketchInputHash: "b".repeat(64) }, { sourceCheckpointId: null },
    ]) {
        const isolated = { ...next, ...change };
        assert.equal(prototypeSketchEvidenceCheckpoint(flow, isolated), isolated);
    }
    for (const continuation of [true, "visual", "structure"]) {
        assert.throws(() => readPrototypeFlow({ ...flow, checkpoints: [{ ...source, continuation }, next] }), /invalid/);
    }
});

test("retry traverses preparation failures without discarding the last worker's source changes", () => {
    const prepared: PrototypeCheckpoint = { ...pending("worker-failed", "interaction"),
        status: "failed", timeoutSeconds: 300 };
    const partial: PrototypeCheckpoint = { ...pending("copy-failed", "interaction"),
        status: "failed", workspacePrepared: false, sourceCheckpointId: prepared.id, timeoutSeconds: 300 };
    const newerPartial = { ...partial, id: "newer-copy-failed", sourceCheckpointId: partial.id };
    const flow = { ...newPrototypeFlow(), checkpoints: [prepared, partial, newerPartial] };
    assert.equal(prototypeRetrySource(flow, newerPartial)?.id, prepared.id);
    assert.equal(prototypeRetrySource(flow, { ...partial, sourceCheckpointId: null }), null);
    assert.throws(() => prototypeRetrySource(flow, { ...partial, sourceCheckpointId: "missing" }), /source is missing/);
    assert.throws(() => prototypeRetrySource(flow, { ...partial, sourceCheckpointId: partial.id }), /cycle/);
    assert.throws(() => prototypeRetrySource(flow, { ...prepared, status: "running" }), /active checkpoint/);
});
