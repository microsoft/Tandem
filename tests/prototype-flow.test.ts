import assert from "node:assert/strict";
import { test } from "node:test";
import {
    newPrototypeFlow, nextPrototypeMilestone, readPrototypeFlow, reservePrototypeCheckpoint,
    settlePrototypeCheckpoint, promotePrototypeCheckpoint, prototypeFlowCompletionError,
    prototypeRetrySource, type PrototypeCheckpoint,
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
    assert.equal(nextPrototypeMilestone(flow), "structure");
    flow = reservePrototypeCheckpoint(flow, pending("first", "structure"));
    assert.equal(flow.budget.usedSeconds, 300);
    flow = settlePrototypeCheckpoint(flow, "first", {
        status: "ready", previewUrl: "http://localhost:1", summary: "Wireframe", focus: "Try navigation",
    }, "2026-09-09T00:00:20Z");
    assert.equal(flow.displayedCheckpointId, "first");
    assert.equal(flow.budget.usedSeconds, 20);
    assert.equal(nextPrototypeMilestone(flow), "interaction");
    flow = reservePrototypeCheckpoint(flow, pending("second", "interaction", "first"));
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

test("failure preserves the working checkpoint and cannot consume an unlimited budget", () => {
    let flow = reservePrototypeCheckpoint(newPrototypeFlow(), pending("first", "structure"));
    flow = settlePrototypeCheckpoint(flow, "first", {
        status: "ready", previewUrl: "http://localhost:1", summary: "Ready", focus: "",
    }, "2026-09-09T00:00:10Z");
    flow = reservePrototypeCheckpoint(flow, pending("failed", "interaction", "first"));
    flow = settlePrototypeCheckpoint(flow, "failed", {
        status: "failed", previewUrl: null, summary: "Timed out", focus: "",
    }, "2026-09-09T01:00:00Z");
    assert.equal(flow.displayedCheckpointId, "first");
    assert.equal(flow.budget.usedSeconds, 310);
    assert.equal(nextPrototypeMilestone(flow), "interaction");
    assert.throws(() => settlePrototypeCheckpoint(flow, "failed", {
        status: "ready", previewUrl: "http://localhost:3", summary: "", focus: "",
    }, "2026-09-09T01:00:00Z"), /no longer owns/);
    flow.budget.usedSeconds = 900;
    assert.throws(() => reservePrototypeCheckpoint(flow, pending("retry", "interaction", "first")), /exhausted/);
});

test("legacy states remain readable and corrupted checkpoint references fail visibly", () => {
    assert.equal(readPrototypeFlow(undefined), null);
    assert.throws(() => readPrototypeFlow({ ...newPrototypeFlow(), displayedCheckpointId: "missing" }), /invalid/);
    assert.throws(() => readPrototypeFlow({ ...newPrototypeFlow(), budget: { limitSeconds: 900, usedSeconds: NaN } }), /invalid/);
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
