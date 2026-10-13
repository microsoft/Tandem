import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { readRecoveryHistory, recoveryNativeEvidence, validateRecoveryHistory } from "../src/human-loop-recovery.mjs";
import { HumanLoopCompaction } from "../src/human-loop-compaction.mjs";
import { projectHumanHistory } from "../public/renderers/human-loop-history.js";
import { nativeCloseEvents, nativeEventDigest, validateNativeReopen } from "../src/human-loop-close.mjs";
import { syntheticAssistantOpaqueFields } from "./helpers/native-assistant-history-fixture.mjs";

test("derived native recovery fixture keeps synthetic correlations without private telemetry", async () => {
  const bytes = await readFile(join(import.meta.dirname, "helpers", "captured-native-recovery-history.json"), "utf8");
  const fixture = JSON.parse(bytes);
  assert.deepEqual(Object.keys(fixture), ["schemaVersion", "sourceReceiptSha256", "note", "sessionId", "live", "changes"]);
  assert.equal(fixture.schemaVersion, "captured-native-recovery-fixture/v1");
  assert.match(fixture.sourceReceiptSha256, /^[a-f0-9]{64}$/);
  assert.match(fixture.note, /^Derived SDK serialization regression fixture, not a raw capture\./);
  for (const id of bytes.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi) ?? []) {
    assert.match(id, /^00000000-0000-4000-8000-\d{12}$/);
  }
  for (const id of bytes.match(/\b(?:custom_)?call_[A-Za-z0-9_-]+\b/g) ?? []) assert.match(id, /^call_fixture_\d{3}$/);
  assert.doesNotMatch(bytes, /"(?:reasoningOpaque|reasoningBlocks|encryptedContent|modelCacheState|promptCacheBreakState|tokenDetails|modelMetrics|agentMetrics|totalNanoAiu|totalPremiumRequests)"\s*:/);
  assert.doesNotMatch(bytes, /[A-Z]:\\+(?:Users|home)\\+/i);
  const known = new Set();
  for (const event of fixture.live) {
    assert.equal(typeof event.id, "string");
    assert.equal(typeof event.type, "string");
    assert.ok(Number.isFinite(Date.parse(event.timestamp)));
    assert.equal(typeof event.data, "object");
    assert.ok(event.parentId === null || known.has(event.parentId));
    assert.ok(!known.has(event.id)); known.add(event.id);
    if (event.type === "session.usage_checkpoint") assert.deepEqual(event.data, {});
  }
  for (const change of fixture.changes) {
    if (change.event) {
      assert.equal(change.event.type, "session.shutdown");
      assert.deepEqual(Object.keys(change.event.data), ["shutdownType"]);
    } else {
      const original = fixture.live.find(event => event.id === change.id);
      assert.equal(original.type, "tool.execution_complete");
      assert.equal(original.data.result.content, change.result.content);
    }
  }
});

test("clean recovery binds opaque disk authority before allowing the exact SDK projection", () => {
  const user = { id: "user", type: "user.message", parentId: null, timestamp: "2026-09-22T15:58:40Z",
    data: { content: "Fixture", messageId: "message", interactionId: "interaction", turnId: "0" } };
  const assistant = { ...user, id: "assistant", type: "assistant.message", parentId: user.id,
    data: { messageId: "response", content: "Visible response", ...syntheticAssistantOpaqueFields() } };
  const persisted = [user, assistant], proof = { schemaVersion: "human-loop-native-close/v1", sessionId: "private",
    flushed: true, events: nativeCloseEvents(persisted), users: [{ id: user.id, messageId: "message", interactionId: "interaction", turnId: "0" }] };
  const sdk = structuredClone(persisted);
  for (const key of ["reasoningOpaque", "encryptedContent", "reasoningBlocks"]) delete sdk[1].data[key];
  const evidence = recoveryNativeEvidence("private", persisted, proof);
  assert.equal(validateRecoveryHistory(sdk, evidence), true);
  assert.throws(() => recoveryNativeEvidence("private", sdk, proof), /"boundary":"persisted"/);
  const tampered = structuredClone(persisted); tampered[1].data.reasoningOpaque += "changed";
  assert.throws(() => recoveryNativeEvidence("private", tampered, proof), /"boundary":"persisted"/);
  const unsealed = recoveryNativeEvidence("private", persisted);
  assert.throws(() => validateRecoveryHistory(sdk, unsealed), /history changed/);
});

test("clean recovery borrows only recorded seal authority and diagnoses the exact rejected stage without tool bodies", async () => {
  const captured = JSON.parse(await readFile(join(import.meta.dirname, "helpers", "captured-native-recovery-history.json"), "utf8"));
  const cold = structuredClone(captured.live);
  for (const change of captured.changes) {
    if (change.event) cold.push(change.event);
    else cold.find(event => event.id === change.id).data.result = change.result;
  }
  const user = captured.live.find(event => event.type === "user.message");
  const proof = { schemaVersion: "human-loop-native-close/v1", sessionId: captured.sessionId, flushed: true,
    events: nativeCloseEvents(captured.live), users: [{
      id: user.id, messageId: user.data.messageId, turnId: user.data.turnId, interactionId: user.data.interactionId,
    }] };
  const before = structuredClone(proof);
  const evidence = recoveryNativeEvidence(captured.sessionId, cold, proof);
  const canonical = cold.map(event => captured.live.find(original => original.id === event.id) ?? event);
  assert.equal(validateRecoveryHistory(cold, evidence), true);
  assert.equal(validateRecoveryHistory(canonical, evidence), true);
  assert.deepEqual(proof, before);
  const unsealed = recoveryNativeEvidence(captured.sessionId, cold);
  assert.throws(() => validateRecoveryHistory(canonical, unsealed), /changed during recovery/);
  assert.throws(() => recoveryNativeEvidence("another-owner", cold, proof), /another/);
  assert.throws(() => recoveryNativeEvidence(captured.sessionId, cold, { ...proof, flushed: false }), /unflushed/);
  const old = structuredClone(proof);
  for (const event of old.events) delete event.allowedColdDuplicateResultDigest;
  assert.throws(() => validateNativeReopen(cold, old), /history changed/);
  assert.throws(() => recoveryNativeEvidence(captured.sessionId, cold, old), /binding recovery evidence/);
  const target = proof.events.find(event => event.allowedColdDuplicateResultDigest);
  for (const stage of ["resumed-recovery", "permission-renewal", "recovery-control"]) {
    const changed = structuredClone(cold);
    const event = changed.find(event => event.id === target.id);
    event.data.result.content = "SECRET changed tool body";
    assert.throws(() => validateRecoveryHistory(changed, evidence, stage), error => {
      const diagnostic = JSON.parse(error.message.slice(error.message.indexOf("{")));
      assert.equal(diagnostic.stage, stage);
      assert.equal(diagnostic.id, event.id);
      assert.equal(diagnostic.expectedDigest, target.digest);
      assert.equal(diagnostic.actualDigest, nativeEventDigest(event));
      assert.doesNotMatch(error.message, /SECRET/);
      return true;
    });
    assert.throws(() => recoveryNativeEvidence(captured.sessionId, changed, proof), /"stage":"recovery-evidence"/);
    assert.throws(() => nativeCloseEvents(changed, new Map(evidence.events.map(event => [event.id, event]))), /"stage":"seal-retention"/);
  }
  for (const mutate of [
    events => { events.find(event => event.id === target.id).parentId = "foreign-parent"; },
    events => { events.find(event => event.id === target.id).data.result.extra = true; },
    events => { events.find(event => event.id === target.id).agentId = "foreign-agent"; },
    events => { [events[0], events[1]] = [events[1], events[0]]; },
  ]) {
    const changed = structuredClone(cold); mutate(changed);
    assert.throws(() => validateRecoveryHistory(changed, evidence, "resumed-recovery"), /"stage":"resumed-recovery"/);
  }
});

test("recovery reads every retained page, including history beyond the display window", async () => {
  const events = Array.from({ length: 621 }, (_, index) => ({ id: `event-${index}`, type: "assistant.message" }));
  const calls = [];
  const client = { rpc: { sessions: { readPersistedEvents: async ({ cursor, max }) => {
    assert.equal(max, 200); calls.push(cursor);
    const start = cursor === undefined ? 0 : Number(cursor);
    return { events: events.slice(start, start + 170), cursor: String(start + 170),
      cursorStatus: "ok", hasMore: start + 170 < events.length };
  } } } };
  assert.deepEqual(await readRecoveryHistory(client, "private"), events);
  assert.deepEqual(calls, [undefined, "170", "340", "510"]);
});

for (const mode of ["expired", "duplicate", "empty", "missing"]) test(`recovery fails honestly for ${mode} native history`, async () => {
  const client = { rpc: { sessions: { readPersistedEvents: async () => {
    if (mode === "missing") throw new Error("Missing journal.");
    return { cursorStatus: mode === "expired" ? "expired" : "ok", hasMore: false, cursor: "done",
      events: mode === "duplicate" ? [{ id: "same", type: "assistant.message" }, { id: "same", type: "assistant.message" }] : [] };
  } } } };
  await assert.rejects(readRecoveryHistory(client, "private"), /history|journal/i);
});

test("Recovery transition projects from the durable record even without an in-memory event", () => {
  const transitions = projectHumanHistory([{
    type: "human.ready", sequence: 1, timestamp: "2026-09-20T04:00:01Z", summary: "Ready for new instructions.",
  }], [], "new-stream", [], [{ id: "recovered", recoveredAt: "2026-09-20T04:00:00Z" }]);
  assert.deepEqual(transitions.map(({ label }) => label), ["Recovery", "Ready"]);
  assert.match(transitions[0].explanation, /not resumed/);
});

test("cold inline images match exact native interned assets without accepting changed bytes or metadata", () => {
  const bytes = Buffer.from("retained image bytes");
  const attachment = { type: "blob", mimeType: "image/png", displayName: "retained.png", data: bytes.toString("base64") };
  const cold = [{ id: "image-input", type: "user.message", parentId: null, timestamp: "2026-09-20T04:00:00Z",
    data: { messageId: "message", turnId: "turn", interactionId: "interaction", content: "Exact request", attachments: [attachment] } }];
  const active = structuredClone(cold);
  const { data, ...metadata } = attachment;
  active[0].data.attachments = [{ ...metadata,
    assetId: `sha256:${createHash("sha256").update(bytes).digest("hex")}`, byteLength: bytes.length }];
  const evidence = recoveryNativeEvidence("private", cold);
  assert.equal(validateRecoveryHistory(active, evidence), true);
  assert.equal(validateRecoveryHistory(cold, evidence), true);
  for (const patch of [{ assetId: `sha256:${"0".repeat(64)}` }, { byteLength: 1 }, { displayName: "changed.png" }]) {
    const changed = structuredClone(active);
    Object.assign(changed[0].data.attachments[0], patch);
    assert.throws(() => validateRecoveryHistory(changed, evidence), /changed during recovery/);
  }
  const changed = structuredClone(cold);
  changed[0].data.attachments[0].data = Buffer.from("different image bytes").toString("base64");
  assert.throws(() => validateRecoveryHistory(changed, evidence), /changed during recovery/);
});

test("compaction lifecycle observations are deduplicated and never expose the model summary", () => {
  const observations = [], compaction = new HumanLoopCompaction((event) => observations.push(event));
  const start = { id: "start", type: "session.compaction_start", timestamp: "2026-09-20T04:00:00Z", data: { trigger: "threshold" } };
  const complete = { id: "complete", type: "session.compaction_complete", data: { success: true, summary: "Private model context." } };
  compaction.observe(start); compaction.observe(start);
  assert.equal(compaction.read().active, true);
  compaction.observe(complete); compaction.observe(start);
  assert.equal(compaction.read().active, false);
  assert.equal(observations.length, 2);
  assert.doesNotMatch(JSON.stringify(compaction.read()), /Private model/);
  assert.doesNotMatch(JSON.stringify(observations), /Private model/);
  assert.equal(compaction.observe({ ...start, id: "subagent", agentId: "child" }), false);
  assert.equal(compaction.read().active, false);
});
