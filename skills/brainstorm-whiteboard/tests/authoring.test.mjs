import assert from "node:assert/strict";
import test from "node:test";
import { createBoard } from "../shared/store.mjs";
import { fingerprint } from "../shared/scene.mjs";
import { addLabeledBox, connectNodes, deleteNode, moveResizeNode, renameLabel } from "../shared/authoring.mjs";
import { recipes } from "../scripts/cookbook.mjs";

const peer = { id: "peer-ink", type: "freedraw", x: 90, y: 80, width: 50, height: 20,
  points: [[0, 0], [50, 20]], pressures: [], simulatePressure: true,
  groupIds: ["peer-group"], customData: { human: { note: "Keep this unexplained mark" } } };
function edit(board, operations) { return board.edit({ expectedVersionId: board.state().versionId, operations }); }
function seeded() {
  const board = createBoard();
  edit(board, [{ op: "add", element: peer }]);
  return board;
}
test("flow/insert/rename/geometry/delete recipes keep IDs, bindings, seals and unrelated user input", () => {
  const board = seeded(), originalPeer = board.state().scene.elements[0];
  const first = edit(board, recipes.flow(board.state().scene));
  assert.equal(first.effects.added.length, 5);
  board.seal({ expectedVersionId: first.versionId });
  const sealed = board.read();
  const inserted = edit(board, recipes.insert(board.state().scene));
  assert.equal(inserted.effects.added.length, 3);
  assert.equal(board.state().scene.elements.find((element) => element.id === "request-decision").endBinding.elementId, "review");
  assert.ok(board.state().scene.elements.find((element) => element.id === "decision").boundElements.some((entry) => entry.id === "review-decision"));
  const rename = edit(board, recipes.rename(board.state().scene));
  assert.equal(rename.scene.elements.find((element) => element.id === "review-label").text, "Discuss together");
  const prior = board.state();
  const moved = edit(board, recipes.move(prior.scene));
  assert.equal(moved.effects.added.length, 0); assert.equal(moved.effects.removed.length, 0);
  assert.ok(moved.effects.changed.find((entry) => entry.id === "review").fields.some((field) => field.path === "y"));
  assert.ok(moved.effects.changed.find((entry) => entry.id === "request-decision").fields.some((field) => field.path === "points"));
  assert.deepEqual(moved.scene.elements.find((element) => element.id === "peer-ink"), originalPeer);
  assert.deepEqual(board.read({ target: sealed.versionId }).scene, sealed.scene);
  const deleted = edit(board, recipes.remove(board.state().scene));
  assert.deepEqual(new Set(deleted.effects.removed.map((element) => element.id)),
    new Set(["review", "review-label", "request-decision", "review-decision"]));
  assert.ok(deleted.scene.elements.some((element) => element.id === "decision"));
  assert.deepEqual(deleted.scene.elements.find((element) => element.id === "peer-ink"), originalPeer);
});
test("helpers preserve metadata/groups/frame membership and leave spatial/group neighbors alone", () => {
  const board = seeded();
  edit(board, [{ op: "add", element: { id: "frame", type: "frame", x: 0, y: 0, width: 1500, height: 1100, name: "Existing frame" } }]);
  edit(board, addLabeledBox(board.state().scene, { id: "a", labelId: "a-label", text: "One", x: 100, y: 200, width: 240, height: 100,
    frameId: "frame", groupIds: ["peer-group"], customData: { peer: { label: "Keep" } } }));
  edit(board, addLabeledBox(board.state().scene, { id: "b", labelId: "b-label", text: "Two", x: 650, y: 200, width: 240, height: 100, frameId: "frame" }));
  edit(board, connectNodes(board.state().scene, { id: "a-b", fromId: "a", toId: "b" }));
  edit(board, [{ op: "update", id: "a-b", set: { customData: { ...board.state().scene.elements.find((element) => element.id === "a-b").customData, peer: { source: "User" } } } }]);
  const before = board.state().scene;
  const moved = edit(board, moveResizeNode(before, "a", { x: 120, y: 310, width: 280, height: 130 }));
  const a = moved.scene.elements.find((element) => element.id === "a");
  assert.deepEqual(a.customData, { peer: { label: "Keep" } });
  assert.deepEqual(a.groupIds, ["peer-group"]); assert.equal(a.frameId, "frame");
  assert.deepEqual(moved.scene.elements.find((element) => element.id === "a-b").customData.peer, { source: "User" });
  for (const id of ["peer-ink", "frame", "b", "b-label"]) {
    assert.deepEqual(moved.scene.elements.find((element) => element.id === id), before.elements.find((element) => element.id === id));
  }
  const renamed = edit(board, renameLabel(board.state().scene, "a-label", "First choice"));
  assert.equal(renamed.scene.elements.find((element) => element.id === "a-label").containerId, "a");
});
test("unsupported complex editing is explicit and pure instead of breaking or guessing native relationships", () => {
  const board = seeded();
  edit(board, recipes.flow(board.state().scene));
  const before = board.state().scene;
  const unchanged = fingerprint(board.state());
  for (const action of [
    () => addLabeledBox(board.state().scene, { id: "request", labelId: "duplicate", text: "Bad", x: 0, y: 0, width: 200, height: 100 }),
    () => renameLabel(board.state().scene, "peer-ink", "Invented meaning"),
    () => moveResizeNode(board.state().scene, "request", { width: 30 }),
    () => moveResizeNode(board.state().scene, "request", { angle: 1 }),
    () => connectNodes(board.state().scene, { id: "loop", fromId: "request", toId: "request" }),
  ]) assert.throws(action, /Authoring helper/);
  assert.equal(fingerprint(board.state()), unchanged);
  edit(board, [{ op: "update", id: "request-decision", set: { points: [[0, 0], [50, 40], [400, 0]], width: 400, height: 40 } }]);
  const complex = board.state();
  assert.throws(() => moveResizeNode(complex.scene, "request", { x: 100 }), /simple unlocked/);
  assert.deepEqual(board.state(), complex);
  assert.throws(() => deleteNode(board.state().scene, "peer-ink"), /rectangle/);
  const declaredButMoved = structuredClone(before);
  declaredButMoved.elements.find((element) => element.id === "request-decision").x += 50;
  const preserved = fingerprint(declaredButMoved);
  assert.throws(() => moveResizeNode(declaredButMoved, "request", { x: 100 }), /no longer matches its declared side/);
  assert.equal(fingerprint(declaredButMoved), preserved);
});
test("native UX creation and targeted refinement append elements and preserve user content", () => {
  const board = seeded(), originalPeer = board.state().scene.elements[0];
  assert.deepEqual(recipes.ux(board.state().scene), recipes.ux(board.state().scene));
  const ux = edit(board, recipes.ux(board.state().scene));
  assert.equal(ux.effects.added.length, 15);
  assert.ok(ux.scene.elements.filter((element) => element.type === "text").every((element) => element.containerId));
  const before = board.state().scene;
  const refined = edit(board, recipes["ux-edit"](before));
  assert.equal(refined.effects.added.length, 0); assert.equal(refined.effects.removed.length, 0);
  assert.equal(refined.scene.elements.find((element) => element.id === "ux-primary-label").text, "Save settings");
  assert.deepEqual(refined.scene.elements.find((element) => element.id === "peer-ink"), originalPeer);
  for (const id of ["ux-name", "ux-name-label", "ux-email", "ux-email-label", "ux-nav", "ux-nav-label"]) {
    assert.deepEqual(refined.scene.elements.find((element) => element.id === id), before.elements.find((element) => element.id === id));
  }
});
