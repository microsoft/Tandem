import assert from "node:assert/strict";
import test from "node:test";
import { createBoard } from "../shared/store.mjs";
import { canonicalScene, editorOperationsBetween, fingerprint, latestSealedEdit, operationsBetween } from "../shared/scene.mjs";
import { flowElements } from "../scripts/example.mjs";

function drawn() {
  const board = createBoard(), empty = board.read();
  const edit = board.edit({ expectedVersionId: empty.versionId, operations: flowElements().map((element) => ({ op: "add", element })) });
  board.seal({ expectedVersionId: edit.versionId });
  return { board, empty, v1: edit.versionId };
}
test("empty sealed baseline, latest pending read, same-ID seal, repeatable old snapshot", () => {
  const { board, empty, v1 } = drawn();
  assert.equal(empty.scene.elements.length, 0); assert.equal(empty.hasUnsealedChanges, false);
  const before = board.read({ target: v1 });
  const edit = board.edit({ expectedVersionId: v1, operations: [{ op: "update", id: "label-2", set: { text: "Review" } }] });
  assert.notEqual(edit.versionId, v1);
  const pending = board.read();
  assert.equal(pending.versionId, v1); assert.equal(pending.hasUnsealedChanges, true);
  assert.equal(pending.scene.elements.find((element) => element.id === "label-2").text, "Discuss");
  assert.throws(() => board.read({ target: edit.versionId }), /unavailable or unsealed/);
  const sealed = board.seal({ expectedVersionId: edit.versionId });
  assert.equal(sealed.versionId, edit.versionId);
  assert.equal(board.seal({ expectedVersionId: edit.versionId }).versionId, edit.versionId);
  assert.deepEqual(board.read({ target: v1 }).scene, before.scene);
  assert.equal(board.read({ target: v1 }).hasUnsealedChanges, false);
  const diff = board.read({ target: edit.versionId, compareTo: v1 });
  assert.equal(diff.changes.changed.find((change) => change.id === "label-2").fields.find((field) => field.path === "text").after, "Review");
});
test("stale edit/seal rejects without touching newer unsealed work", () => {
  const { board, v1 } = drawn();
  const edit = board.edit({ expectedVersionId: v1, operations: [{ op: "update", id: "node-2", set: { x: 420 } }] });
  const state = board.state();
  assert.throws(() => board.edit({ expectedVersionId: v1, operations: [{ op: "remove", id: "label-1" }] }), /Working version changed/);
  assert.throws(() => board.seal({ expectedVersionId: v1 }), /Working version changed/);
  assert.deepEqual(board.state(), state); assert.equal(board.state().versionId, edit.versionId);
});
test("the entire batch is validated before commit; invalid IDs/fields/relationships are atomic", () => {
  const { board, v1 } = drawn(), before = board.state();
  for (const bad of [
    { op: "remove", id: "missing" },
    { op: "update", id: "node-1", set: { unexpected: true } },
    { op: "add", element: { ...flowElements()[0] } },
    { op: "add", element: { id: "bad", type: "image", x: 0, y: 0, width: 10, height: 10 } },
    { op: "update", id: "label-1", set: { containerId: "missing" } },
  ]) {
    assert.throws(() => board.edit({ expectedVersionId: v1, operations: [{ op: "update", id: "label-2", set: { text: "Must not commit" } }, bad] }));
    assert.deepEqual(board.state(), before);
  }
});
test("missing compareTo is an error, not empty diff; unknown reads never substitute latest", () => {
  const { board } = drawn();
  assert.throws(() => board.read({ compareTo: "missing" }), /unavailable or unsealed/);
  assert.throws(() => board.read({ target: "missing" }), /unavailable or unsealed/);
  assert.throws(() => board.read({ target: null }), /Invalid read/);
  assert.throws(() => board.read({ compareTo: "latest" }), /exact sealed/);
  assert.equal("changes" in board.read(), false);
});
test("snapshot/result aliases cannot mutate working state or seals", () => {
  const { board, v1 } = drawn();
  const exposed = board.read(); exposed.scene.elements[0].x = -999; exposed.scene.elements.splice(1);
  assert.equal(board.read({ target: v1 }).scene.elements.length, 8);
  assert.equal(board.read({ target: v1 }).scene.elements[0].x, 80);
  const current = board.state(); current.scene.elements[0].groupIds.push("foreign");
  assert.deepEqual(board.state().scene.elements[0].groupIds, []);
});
test("camera/selection/native bookkeeping and empty binding normalization do not change versions", () => {
  const { board, v1 } = drawn();
  const raw = structuredClone(board.state().scene);
  raw.appState = { scrollX: 120, scrollY: 10, zoom: { value: 0.3 }, selectedElementIds: { "node-1": true } };
  for (const element of raw.elements) {
    element.version = 100; element.updated = Date.now(); element.index = "a1";
    if (!element.boundElements.length) element.boundElements = null;
  }
  const normalized = canonicalScene(raw);
  assert.equal(fingerprint(normalized), fingerprint(board.state().scene));
  assert.deepEqual(operationsBetween(board.state().scene, normalized), []);
  assert.equal(board.edit({ expectedVersionId: v1, operations: [] }).versionId, v1);
});
test("factual diffs retain geometry/style/binding/ink/custom-data fields, not semantic intent", () => {
  const { board, v1 } = drawn();
  const changed = board.edit({ expectedVersionId: v1, operations: [
    { op: "update", id: "node-1", set: { x: 95, backgroundColor: "#fff3bf", customData: { id: "annotation", version: 2 } } },
    { op: "add", element: { id: "ink", type: "freedraw", x: 100, y: 340, width: 40, height: 10, points: [[0, 0], [40, 10]], pressures: [], simulatePressure: true } },
    { op: "remove", id: "arrow-2" },
    ...["node-2", "node-3"].map((id) => ({ op: "update", id, set: {
      boundElements: board.state().scene.elements.find((element) => element.id === id).boundElements.filter((binding) => binding.id !== "arrow-2"),
    } })),
  ] });
  board.seal({ expectedVersionId: changed.versionId });
  const diff = board.read({ compareTo: v1 });
  assert.equal(diff.changes.added[0].id, "ink"); assert.equal(diff.changes.removed[0].id, "arrow-2");
  assert.ok(diff.changes.changed.some((entry) => entry.fields.some((field) => field.path === "x")));
  assert.ok(diff.changes.changed.some((entry) => entry.fields.some((field) => field.path === "backgroundColor")));
  assert.equal("intent" in diff.changes, false);
});
test("normal diagram authoring declares shape labels and arrow endpoints explicitly", () => {
  const { board } = drawn();
  const scene = board.state().scene;
  for (let index = 1; index <= 3; index++) {
    const node = scene.elements.find((element) => element.id === `node-${index}`);
    const label = scene.elements.find((element) => element.id === `label-${index}`);
    assert.equal(label.containerId, node.id);
    assert.ok(node.boundElements.some((binding) => binding.id === label.id && binding.type === "text"));
  }
  for (let index = 1; index <= 2; index++) {
    const arrow = scene.elements.find((element) => element.id === `arrow-${index}`);
    assert.equal(arrow.startBinding.elementId, `node-${index}`);
    assert.equal(arrow.endBinding.elementId, `node-${index + 1}`);
  }
});
test("discarded working states are not retained, seals survive later edits, restart is empty", () => {
  const { board, v1 } = drawn();
  const transient = board.edit({ expectedVersionId: v1, operations: [{ op: "update", id: "label-1", set: { text: "First" } }] });
  const next = board.edit({ expectedVersionId: transient.versionId, operations: [{ op: "update", id: "label-1", set: { text: "Second" } }] });
  assert.throws(() => board.read({ target: transient.versionId }), /unavailable or unsealed/);
  assert.equal(board.state().sealedCount, 2);
  assert.equal(board.read({ target: v1 }).scene.elements.find((element) => element.id === "label-1").text, "Idea");
  assert.equal(createBoard().read().scene.elements.length, 0);
  assert.notEqual(next.versionId, v1);
});
test("latest-seal reset is an ordinary guarded edit, not a seal or history deletion", () => {
  const { board, empty, v1 } = drawn();
  const old = board.read({ target: v1 });
  board.edit({ expectedVersionId: v1, operations: [
    { op: "update", id: "node-2", set: { customData: { scratch: true }, strokeColor: "#e03131" } },
    { op: "add", element: { id: "extra", type: "text", x: 0, y: 0, width: 100, height: 23, text: "Unsealed" } },
  ] });
  const inspected = board.state();
  const result = board.edit(latestSealedEdit(inspected, board.read()));
  assert.notEqual(result.versionId, inspected.versionId);
  assert.notEqual(result.versionId, v1);
  assert.equal(result.latestSealedVersionId, v1);
  assert.equal(result.hasUnsealedChanges, true);
  assert.equal(result.sealedCount, inspected.sealedCount);
  assert.deepEqual(result.scene, old.scene);
  assert.equal(board.read({ target: empty.versionId }).scene.elements.length, 0);
  assert.deepEqual(board.read({ target: v1 }).scene, old.scene);
  const repeated = board.edit(latestSealedEdit(board.state(), board.read()));
  assert.equal(repeated.versionId, result.versionId);
  assert.equal(repeated.hasUnsealedChanges, true);
});
test("reset uses the last seal, including the fresh empty baseline; identical content is a no-op", () => {
  const board = createBoard(), empty = board.read();
  assert.equal(board.edit(latestSealedEdit(board.state(), empty)).versionId, empty.versionId);
  board.edit({ expectedVersionId: empty.versionId, operations: flowElements().map((element) => ({ op: "add", element })) });
  const reset = board.edit(latestSealedEdit(board.state(), board.read()));
  assert.deepEqual(reset.scene.elements, []);
  assert.equal(reset.hasUnsealedChanges, true);
  assert.equal(board.read().versionId, empty.versionId);
  board.seal({ expectedVersionId: reset.versionId });
  const later = board.edit({ expectedVersionId: reset.versionId, operations: flowElements().map((element) => ({ op: "add", element })) });
  board.seal({ expectedVersionId: later.versionId });
  board.edit({ expectedVersionId: later.versionId, operations: [{ op: "update", id: "label-2", set: { text: "Working" } }] });
  const newest = board.edit(latestSealedEdit(board.state(), board.read()));
  assert.deepEqual(newest.scene, later.scene);
});
test("reset refuses newer working content or a newer seal even when the working ID did not change", () => {
  const { board, v1 } = drawn();
  const draft = board.edit({ expectedVersionId: v1, operations: [{ op: "update", id: "label-2", set: { text: "Newer" } }] });
  const request = latestSealedEdit(board.state(), board.read());
  board.seal({ expectedVersionId: draft.versionId });
  const sealed = board.state();
  assert.throws(() => board.edit(request), /Latest sealed version changed/);
  assert.deepEqual(board.state(), sealed);
  assert.throws(() => latestSealedEdit(board.state(), board.read({ target: v1 })), /Latest sealed version changed/);
  const nextRequest = latestSealedEdit(board.state(), board.read());
  board.edit({ expectedVersionId: sealed.versionId, operations: [{ op: "update", id: "label-2", set: { text: "Newest" } }] });
  const newest = board.state();
  assert.throws(() => board.edit(nextRequest), /Working version changed/);
  assert.deepEqual(board.state(), newest);
});
test("native path edits keep rebased origins and points together without restyling unrelated source elements", () => {
  const board = createBoard(), empty = board.read();
  const added = board.edit({ expectedVersionId: empty.versionId, operations: [
    { op: "add", element: { id: "path", type: "line", x: 200, y: 200, width: 100, height: 120,
      points: [[100, 50], [30, 0], [0, 120]], customData: { keep: true } } },
    { op: "add", element: { id: "fill", type: "ellipse", x: 420, y: 300, width: 70, height: 100, strokeWidth: 0 } },
  ] });
  board.seal({ expectedVersionId: added.versionId });
  const displayed = canonicalScene({ elements: added.scene.elements.map((element) => element.id === "path"
    ? { ...element, x: 300, y: 250, points: [[0, 0], [-70, -50], [-100, 70]] } : element) });
  assert.deepEqual(editorOperationsBetween(displayed, displayed), []);
  const edited = structuredClone(displayed);
  edited.elements[0].x += 30; edited.elements[0].y += 20;
  const result = board.edit({ expectedVersionId: added.versionId, operations: editorOperationsBetween(displayed, edited) });
  assert.deepEqual(result.scene.elements[0], edited.elements[0]);
  assert.deepEqual(result.scene.elements[1], added.scene.elements[1]);
  assert.deepEqual(result.scene.elements[0].points.map(([x, y]) => [x + result.scene.elements[0].x, y + result.scene.elements[0].y]),
    added.scene.elements[0].points.map(([x, y]) => [x + added.scene.elements[0].x + 30, y + added.scene.elements[0].y + 20]));
  assert.equal(result.hasUnsealedChanges, true);
  assert.throws(() => board.seal({ expectedVersionId: added.versionId }), /Working version changed/);
  assert.deepEqual(board.read({ target: added.versionId }).scene, added.scene);
  const styled = structuredClone(edited); styled.elements[1].strokeWidth = 1;
  const operations = editorOperationsBetween(edited, styled);
  assert.equal(operations[0].set.strokeWidth, 1, "Real stroke edits must not be suppressed.");
});
