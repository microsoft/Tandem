import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { observedNativeCloseEvent, matchesNativeCloseEvent, nativeCloseEvents, validateNativeReopen } from "../src/human-loop-close.mjs";

test("SDK image interning binds exact bytes and preserves every user and event field", () => {
  const bytes = Buffer.from("owned image bytes"), data = bytes.toString("base64");
  const live = { id: "user", type: "user.message", timestamp: "2026-09-18T04:40:00Z", parentId: "previous", data: {
    content: "Describe this image.", transformedContent: "<user>Describe this image.</user>",
    messageId: "message", interactionId: "interaction", turnId: "0", delivery: "queued", agentMode: "interactive",
    attachments: [{ type: "blob", data, mimeType: "image/png", displayName: "owned.png" }],
  } };
  const retained = structuredClone(live);
  retained.data.attachments = [{ type: "blob", mimeType: "image/png", displayName: "owned.png",
    assetId: `sha256:${createHash("sha256").update(bytes).digest("hex")}`, byteLength: bytes.length }];
  const observed = observedNativeCloseEvent(live);
  assert.equal(matchesNativeCloseEvent(live, observed), true);
  assert.equal(matchesNativeCloseEvent(retained, observed), true);
  assert.equal(live.data.attachments[0].data, data);
  for (const change of [
    value => { value.data.content += " changed"; },
    value => { value.data.transformedContent += " changed"; },
    value => { value.data.messageId = "other"; },
    value => { value.data.interactionId = "other"; },
    value => { value.data.turnId = "other"; },
    value => { value.data.agentMode = "autopilot"; },
    value => { value.data.attachments[0].assetId = `sha256:${"0".repeat(64)}`; },
    value => { value.data.attachments[0].byteLength++; },
    value => { value.data.attachments[0].mimeType = "image/jpeg"; },
    value => { value.data.attachments[0].displayName = "other.png"; },
    value => { value.data.attachments = []; },
    value => { value.parentId = "other"; },
    value => { value.timestamp = "2026-09-18T04:40:01Z"; },
  ]) {
    const changed = structuredClone(retained); change(changed);
    assert.equal(matchesNativeCloseEvent(changed, observed), false);
  }
  const proof = { schemaVersion: "human-loop-native-close/v1", sessionId: "private", flushed: true,
    events: nativeCloseEvents([retained]),
    users: [{ id: "user", messageId: "message", interactionId: "interaction", turnId: "0" }] };
  assert.equal(validateNativeReopen([retained], proof), true);
  assert.equal(validateNativeReopen([live], proof), true);
  const wrongBytes = structuredClone(live);
  wrongBytes.data.attachments[0].data = Buffer.from("other image bytes").toString("base64");
  assert.throws(() => validateNativeReopen([wrongBytes], proof), /changed/);
  for (const patch of [{ data: "not canonical base64!" }, { assetId: "sha256:wrong" }, { byteLength: 999 }, { omittedReason: "size" }]) {
    const malformed = structuredClone(live);
    Object.assign(malformed.data.attachments[0], patch);
    assert.equal(observedNativeCloseEvent(malformed).allowedHistoryDigest, undefined);
  }
});
