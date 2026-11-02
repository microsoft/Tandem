import assert from "node:assert/strict";
import test from "node:test";
import { createTopics, DEFAULT_TOPIC_ID } from "../shared/topics.mjs";
import { flowElements } from "../scripts/example.mjs";

test("named topics have independent working scenes, seals, latest state and exact comparisons", () => {
  const pages = createTopics();
  const defaultBefore = pages.state();
  const a = pages.create({ name: "Architecture" }), b = pages.create({ name: "  Error flow  " });
  assert.equal(pages.get(b.topicId).name, "Error flow");
  assert.equal(pages.list().topics.length, 3);
  assert.equal(pages.list().defaultTopicId, DEFAULT_TOPIC_ID);
  assert.deepEqual(pages.state(), defaultBefore);
  const boardA = pages.get(a.topicId).board, boardB = pages.get(b.topicId).board;
  const bBefore = boardB.state(), baselineA = boardA.read();
  const edit = boardA.edit({ expectedVersionId: baselineA.versionId, operations: flowElements().map((element) => ({ op: "add", element })) });
  assert.deepEqual(boardB.state(), bBefore);
  boardA.seal({ expectedVersionId: edit.versionId });
  const sealedA = boardA.read();
  const pending = boardA.edit({ expectedVersionId: edit.versionId, operations: [{ op: "update", id: "label-2", set: { text: "Human discussion" } }] });
  assert.equal(boardA.read().hasUnsealedChanges, true);
  assert.equal(boardB.read().hasUnsealedChanges, false);
  boardA.seal({ expectedVersionId: pending.versionId });
  const diff = boardA.read({ compareTo: sealedA.versionId });
  assert.equal(diff.changes.changed[0].id, "label-2");
  assert.throws(() => boardB.read({ target: sealedA.versionId }), /unavailable or unsealed/);
  assert.throws(() => boardB.read({ compareTo: sealedA.versionId }), /unavailable or unsealed/);
  assert.throws(() => boardB.edit({ expectedVersionId: pending.versionId, operations: [] }), /Working version changed/);
  assert.deepEqual(boardB.state(), bBefore);
  assert.equal(pages.state(a.topicId).topicId, a.topicId);
  assert.equal(pages.state(a.topicId).topicName, "Architecture");
});
test("unknown/invalid topic selection is not a fallback or creation", () => {
  const pages = createTopics(), before = pages.list();
  for (const id of ["missing", "", null, 123]) assert.throws(() => pages.get(id));
  for (const body of [{ name: "" }, { name: " " }, { name: "x".repeat(81) }, { name: 7 }, { name: "A", source: "file" }]) {
    assert.throws(() => pages.create(body), /nonempty name/);
  }
  assert.deepEqual(pages.list(), before);
  assert.equal(pages.get().topicId, DEFAULT_TOPIC_ID);
  assert.equal(createTopics().list().topics.length, 1);
});
