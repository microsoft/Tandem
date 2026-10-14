import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { matchesNativeCloseEvent, nativeCloseEvents, nativeCloseMismatch, nativeEventDigest, observedNativeCloseEvent, parseNativeClose,
  validateNativeReopen } from "../src/human-loop-close.mjs";
import { nativeShellHookFixture, retainedShellHook } from "./helpers/native-shell-history-fixture.mjs";
import { capturedNativeShellFinal } from "./helpers/captured-native-shell-final.mjs";
import { syntheticAssistantOpaqueFields } from "./helpers/native-assistant-history-fixture.mjs";

const bytes = Buffer.from("synthetic owned image");
const image = { type: "image", mimeType: "image/png", description: "probe", data: bytes.toString("base64") };
const reference = { type: "image", mimeType: image.mimeType, description: image.description,
  assetId: `sha256:${createHash("sha256").update(bytes).digest("hex")}`, byteLength: bytes.length };
function fixture(hook) {
  const result = { textResultForLlm: "café 漢字", binaryResultsForLlm: [image], resultType: "success" };
  const event = { id: "event", parentId: "parent", timestamp: "2026-09-20T10:00:00Z", agentId: "agent",
    type: hook ? "hook.start" : "tool.execution_complete",
    data: hook ? { hookType: "postToolUse", input: { toolName: "inspect_probe", toolArgs: { exact: true }, toolResult: result } }
      : { toolCallId: "call", success: true, result } };
  const retained = structuredClone(event);
  const resultOf = value => hook ? value.data.input.toolResult : value.data.result;
  resultOf(retained).binaryResultsForLlm = [reference];
  if (hook) resultOf(retained).textResultForLlm =
    `[copilot:elided textResultForLlm (${Buffer.byteLength(result.textResultForLlm, "utf8")} bytes) — pre-hook tool result; the final result may differ, see the adjacent tool.execution_complete event]`;
  return { event, retained, resultOf };
}

for (const hook of [false, true]) test(`native ${hook ? "postToolUse combined elision" : "final result"} image interning remains exact`, () => {
  const { event, retained, resultOf } = fixture(hook);
  const before = structuredClone(event), expected = observedNativeCloseEvent(event);
  assert.equal(matchesNativeCloseEvent(event, expected), true);
  assert.equal(matchesNativeCloseEvent(retained, expected), true);
  if (hook) {
    const imageOnly = structuredClone(retained);
    resultOf(imageOnly).textResultForLlm = resultOf(event).textResultForLlm;
    assert.equal(matchesNativeCloseEvent(imageOnly, expected), true);
    resultOf(imageOnly).textResultForLlm += " changed";
    assert.equal(matchesNativeCloseEvent(imageOnly, expected), false);
  }
  assert.equal(nativeCloseMismatch(retained, expected), null);
  assert.deepEqual(event, before);
  const changeImage = patch => value => Object.assign(resultOf(value).binaryResultsForLlm[0], patch);
  for (const change of [
    changeImage({ assetId: `sha256:${"0".repeat(64)}` }), changeImage({ byteLength: bytes.length + 1 }),
    changeImage({ mimeType: "image/jpeg" }), changeImage({ description: "changed" }), changeImage({ type: "resource" }),
    value => { resultOf(value).textResultForLlm += " changed"; },
    value => { resultOf(value).resultType = "failure"; },
    value => { resultOf(value).binaryResultsForLlm = []; },
    value => { value.data.unexpected = true; },
    value => { value.id = "changed"; }, value => { value.parentId = "changed"; },
    value => { value.timestamp += "changed"; }, value => { value.agentId = "changed"; },
    value => { if (hook) value.data.input.toolArgs.exact = false; else value.data.toolCallId = "changed"; },
  ]) {
    const changed = structuredClone(retained); change(changed);
    assert.equal(matchesNativeCloseEvent(changed, expected), false);
    assert.ok(nativeCloseMismatch(changed, expected));
  }
});

test("postToolUse text-only elision preserves baseline acceptance with exact inline images", () => {
  const { event, retained, resultOf } = fixture(true);
  const expected = observedNativeCloseEvent(event), textOnly = structuredClone(event);
  resultOf(textOnly).textResultForLlm = resultOf(retained).textResultForLlm;
  assert.equal(matchesNativeCloseEvent(textOnly, expected), true);
  assert.equal(nativeCloseMismatch(textOnly, expected), null);
  assert.notEqual(expected.allowedTextHistoryDigest, expected.allowedImageHistoryDigest);
  assert.notEqual(expected.allowedTextHistoryDigest, expected.allowedHistoryDigest);
  for (const change of [
    value => { resultOf(value).binaryResultsForLlm[0].data = Buffer.from("changed bytes").toString("base64"); },
    value => { resultOf(value).binaryResultsForLlm[0].mimeType = "image/jpeg"; },
    value => { resultOf(value).binaryResultsForLlm[0].description = "changed"; },
    value => { resultOf(value).binaryResultsForLlm[0].byteLength = bytes.length + 1; },
    value => { resultOf(value).binaryResultsForLlm = []; },
    value => { resultOf(value).textResultForLlm += " changed"; },
    value => { resultOf(value).resultType = "failure"; },
    value => { value.data.input.toolArgs.exact = false; },
    value => { value.data.input.toolName = "changed"; },
    value => { value.data.hookType = "preToolUse"; },
    value => { value.id = "changed"; },
    value => { value.timestamp += "changed"; },
    value => { value.agentId = "changed"; },
    value => { value.parentId = "changed"; },
  ]) {
    const changed = structuredClone(textOnly); change(changed);
    assert.equal(matchesNativeCloseEvent(changed, expected), false);
    assert.ok(nativeCloseMismatch(changed, expected));
  }
});

test("native pre-hook sessionLog elision is independent and preserves every unrelated field and ancestor", () => {
  const { event, retained, resultOf } = fixture(true);
  resultOf(event).sessionLog = "Read café 漢字\n";
  const original = structuredClone(event), expected = observedNativeCloseEvent(event);
  for (const images of [false, true]) for (const text of [false, true]) for (const log of [false, true]) {
    const candidate = structuredClone(event);
    if (images) resultOf(candidate).binaryResultsForLlm = [reference];
    if (text) resultOf(candidate).textResultForLlm = resultOf(retained).textResultForLlm;
    if (log) resultOf(candidate).sessionLog =
      `[copilot:elided sessionLog (${Buffer.byteLength(resultOf(event).sessionLog, "utf8")} bytes) — pre-hook tool result; the final result may differ, see the adjacent tool.execution_complete event]`;
    assert.equal(matchesNativeCloseEvent(candidate, expected), true, JSON.stringify({ images, text, log }));
    for (const mutate of [
      value => { resultOf(value).sessionLog += " changed"; },
      value => { resultOf(value).sessionLog = "[copilot:elided sessionLog (999 bytes) — pre-hook tool result; the final result may differ, see the adjacent tool.execution_complete event]"; },
      value => { delete resultOf(value).sessionLog; },
      value => { resultOf(value).textResultForLlm += " changed"; },
      value => { resultOf(value).binaryResultsForLlm = []; },
      value => { resultOf(value).resultType = "failure"; },
      value => { value.data.input.toolArgs.exact = false; },
      value => { value.parentId = "foreign"; },
      value => { value.timestamp = "changed"; },
      value => { value.agentId = "foreign"; },
    ]) {
      const changed = structuredClone(candidate); mutate(changed);
      assert.equal(matchesNativeCloseEvent(changed, expected), false);
    }
  }
  assert.deepEqual(event, original);
  for (const type of ["preToolUse", "other"]) {
    const other = structuredClone(event); other.data.hookType = type;
    assert.equal(observedNativeCloseEvent(other).allowedSessionLogHistoryDigests, undefined);
  }
  const final = fixture(false).event;
  final.data.result.sessionLog = resultOf(event).sessionLog;
  const finalExpected = observedNativeCloseEvent(final);
  final.data.result.sessionLog =
    `[copilot:elided sessionLog (${Buffer.byteLength(resultOf(event).sessionLog, "utf8")} bytes) — pre-hook tool result; the final result may differ, see the adjacent tool.execution_complete event]`;
  assert.equal(matchesNativeCloseEvent(final, finalExpected), false);
});

test("native duplicated pre-hook marker binds exact field lengths and all remaining event data", () => {
  const { event, resultOf } = fixture(true);
  event.agentId = undefined;
  event.data.input.toolName = "apply_patch";
  resultOf(event).sessionLog = "Read café 漢字\n";
  const original = structuredClone(event), expected = observedNativeCloseEvent(event);
  for (const images of [false, true]) for (const text of [false, true]) for (const log of [false, true]) {
    if (!text && !log) continue;
    const candidate = structuredClone(event);
    if (images) resultOf(candidate).binaryResultsForLlm = [reference];
    for (const [field, enabled] of [["textResultForLlm", text], ["sessionLog", log]]) if (enabled) {
      resultOf(candidate)[field] = `[copilot:elided ${field} (${Buffer.byteLength(resultOf(event)[field], "utf8")} bytes) - duplicated pre-hook tool-result field; canonical data remains in adjacent tool and skill events]`;
    }
    assert.equal(matchesNativeCloseEvent(candidate, expected), true, JSON.stringify({ images, text, log }));
    for (const mutate of [
      value => { resultOf(value)[text ? "textResultForLlm" : "sessionLog"] += " changed"; },
      value => { resultOf(value)[text ? "textResultForLlm" : "sessionLog"] =
        resultOf(value)[text ? "textResultForLlm" : "sessionLog"].replace(/\(\d+ bytes\)/, "(999 bytes)"); },
      value => { resultOf(value)[text ? "textResultForLlm" : "sessionLog"] =
        resultOf(value)[text ? "textResultForLlm" : "sessionLog"].replace("duplicated", "unknown"); },
      value => { resultOf(value)[text ? "textResultForLlm" : "sessionLog"] =
        resultOf(value)[text ? "textResultForLlm" : "sessionLog"].replace(
          text ? "elided textResultForLlm" : "elided sessionLog", text ? "elided sessionLog" : "elided textResultForLlm"); },
      value => { resultOf(value).resultType = "failure"; },
      value => { value.data.input.toolArgs.exact = false; },
      value => { value.data.input.toolName = "another-tool"; },
      value => { value.data.hookType = "preToolUse"; },
      value => { value.id = "foreign"; }, value => { value.parentId = "foreign"; },
      value => { value.timestamp += "changed"; }, value => { value.agentId = "foreign"; },
    ]) {
      const changed = structuredClone(candidate); mutate(changed);
      assert.equal(matchesNativeCloseEvent(changed, expected), false);
    }
    // Sealed history remains byte-exact; compatibility is only for a positively observed pre-hook copy.
    assert.equal(matchesNativeCloseEvent(candidate, nativeCloseEvents([event])[0]), false);
  }
  assert.deepEqual(event, original);
});

test("tool image close/reopen proof binds inline bytes and retained references", () => {
  const { event, retained } = fixture(false);
  const user = { id: "user", type: "user.message", timestamp: event.timestamp, parentId: null, data: { content: "probe" } };
  const proof = { schemaVersion: "human-loop-native-close/v1", sessionId: "private", flushed: true,
    events: nativeCloseEvents([user, retained]),
    users: [{ id: "user", messageId: "message", turnId: "turn", interactionId: "interaction" }] };
  assert.equal(validateNativeReopen([user, retained], proof), true);
  assert.equal(validateNativeReopen([user, event], proof), true);
  for (const change of [
    value => { value.data.result.binaryResultsForLlm[0].data = Buffer.from("wrong bytes").toString("base64"); },
    value => { value.parentId = "unbound"; },
    value => { value.data.result.textResultForLlm = "changed final text"; },
  ]) {
    const changed = structuredClone(event); change(changed);
    assert.throws(() => validateNativeReopen([user, changed], proof), /changed/);
  }
});

test("image transformation does not normalize other types, paths or invalid references", () => {
  const { event } = fixture(false);
  for (const patch of [{ type: "resource" }, { mimeType: "application/octet-stream" }, { data: "invalid base64!" },
    { assetId: "sha256:wrong" }, { byteLength: 0 }, { omittedReason: "size" }]) {
    const changed = structuredClone(event);
    Object.assign(changed.data.result.binaryResultsForLlm[0], patch);
    assert.equal(observedNativeCloseEvent(changed).allowedHistoryDigest, undefined);
  }
  const changed = structuredClone(event);
  changed.type = "external_tool.completed";
  assert.equal(observedNativeCloseEvent(changed).allowedHistoryDigest, undefined);
  const hook = fixture(true).event;
  hook.data.hookType = "preToolUse";
  assert.equal(observedNativeCloseEvent(hook).allowedHistoryDigest, undefined);
});

test("close mismatch diagnostics expose only event bindings and hashes", () => {
  const { event, retained } = fixture(false);
  const expected = observedNativeCloseEvent(event);
  retained.data.result.textResultForLlm = "SECRET tool output";
  const diagnostic = nativeCloseMismatch(retained, expected);
  assert.equal(diagnostic.category, "digest");
  assert.equal(diagnostic.id, event.id);
  assert.match(diagnostic.actualDigest, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(diagnostic).includes("SECRET"), false);
  assert.equal(JSON.stringify(diagnostic).includes(image.data), false);
  assert.deepEqual(Object.keys(diagnostic).sort(), ["category", "id", "type", "expectedDigest", "allowedHistoryDigest", "allowedImageHistoryDigest", "allowedTextHistoryDigest", "allowedSessionLogHistoryDigests", "allowedShellExitHistoryDigest", "allowedShellExitElisionHistoryDigests", "allowedColdShellResultDigest", "allowedColdDuplicateResultDigest", "allowedColdAssistantOpaqueDigest",
    "actualId", "actualType", "actualDigest", "expectedParentIds", "actualParentId"].sort());
  assert.equal(nativeCloseMismatch(undefined, expected).category, "missing");
  assert.equal(nativeCloseMismatch({ ...retained, id: "other" }, expected).category, "identity");
  assert.equal(nativeCloseMismatch({ ...retained, type: "other" }, expected).category, "type");
  assert.equal(nativeCloseMismatch({ ...retained, parentId: "other" }, expected).category, "ancestry");
});

for (const name of ["powershell", "read_powershell"]) test(`pre-hook ${name} composes exact text/log elision with eligible exit omission`, () => {
  const event = nativeShellHookFixture(name), before = structuredClone(event);
  const expected = observedNativeCloseEvent(event);
  assert.equal(expected.allowedShellExitElisionHistoryDigests.length, 3);
  for (const duplicate of [false, true]) for (const omit of [false, true]) for (const text of [false, true]) for (const log of [false, true]) {
    const retained = retainedShellHook(event, { omit, text, log });
    if (duplicate) for (const field of ["textResultForLlm", "sessionLog"]) {
      retained.data.input.toolResult[field] = retained.data.input.toolResult[field].replace(
        "— pre-hook tool result; the final result may differ, see the adjacent tool.execution_complete event",
        "- duplicated pre-hook tool-result field; canonical data remains in adjacent tool and skill events");
    }
    assert.equal(matchesNativeCloseEvent(retained, expected), true, JSON.stringify({ omit, text, log }));
    assert.equal(nativeCloseMismatch(retained, expected), null);
    for (const change of [
      e => { e.id += "-other"; }, e => { e.type = "hook.end"; }, e => { e.parentId = "other"; },
      e => { e.timestamp += "changed"; }, e => { e.agentId = "other"; },
      e => { e.data.hookInvocationId = "other"; }, e => { e.data.hookType = "preToolUse"; },
      e => { e.data.input.sessionId = "other"; }, e => { e.data.input.timestamp++; },
      e => { e.data.input.cwd = "C:\\other"; }, e => { e.data.input.toolName = "other"; },
      e => { e.data.input.toolArgs.shellId = "other"; }, e => { e.data.input.toolArgs.extra = true; },
      e => { e.data.input.toolResult.resultType = "failure"; },
      e => { e.data.input.toolResult.toolTelemetry.metrics.commandTimeout++; },
      e => { e.data.input.toolResult.textResultForLlm += "x"; },
      e => { e.data.input.toolResult.sessionLog += "x"; },
      e => { delete e.data.input.toolResult.sessionLog; },
      e => { e.data.input.toolResult.contents = [{ type: "text", text: "changed" }]; },
    ]) {
      const changed = structuredClone(retained); change(changed);
      assert.equal(matchesNativeCloseEvent(changed, expected), false, change.toString());
    }
  }
  for (const field of ["textResultForLlm", "sessionLog"]) {
    const changed = retainedShellHook(event);
    changed.data.input.toolResult[field] = changed.data.input.toolResult[field].replace(
      `${Buffer.byteLength(event.data.input.toolResult[field], "utf8")} bytes`,
      `${event.data.input.toolResult[field].length} bytes`);
    assert.equal(matchesNativeCloseEvent(changed, expected), false, "UTF-8 length is not character count.");
  }
  for (const change of [
    e => { e.data.hookType = "preToolUse"; }, e => { e.data.input.toolName = "view"; },
    e => { e.type = "tool.execution_complete"; },
    e => { e.data.input.toolResult.contents[0].shellId = "foreign"; },
    e => { e.data.input.toolResult.contents[0].type = "text"; },
    e => { e.data.input.toolResult.contents[0].exitCode = "0"; },
    e => { e.data.input.toolResult.contents[0].cwd = null; },
    e => { e.data.input.toolResult.contents[0].outputPreview = null; },
    e => { e.data.input.toolResult.contents[0].extra = true; },
    e => { e.data.input.toolResult.contents.push({ type: "text", text: "must remain" }); },
  ]) {
    const changed = structuredClone(event); change(changed);
    const refused = observedNativeCloseEvent(changed);
    assert.equal(refused.allowedShellExitElisionHistoryDigests, undefined);
    assert.equal(matchesNativeCloseEvent(retainedShellHook(changed), refused), false);
  }
  const final = { ...event, type: "tool.execution_complete",
    data: { toolCallId: "call", success: true, result: structuredClone(event.data.input.toolResult) } };
  const finalExpected = observedNativeCloseEvent(final);
  final.data.result = retainedShellHook(event).data.input.toolResult;
  assert.equal(matchesNativeCloseEvent(final, finalExpected), false, "Final results do not receive hook normalization.");
  assert.deepEqual(event, before);
});

test("successful empty-output powershell pre-hook omission retains exact four-field exit authority", () => {
  const event = nativeShellHookFixture("powershell"), input = event.data.input;
  delete event.agentId;
  delete input.toolResult.contents[0].outputPreview;
  input.toolResult.textResultForLlm = "\n<shellId: owned completed with exit code 0>";
  input.toolResult.sessionLog = input.toolResult.textResultForLlm;
  const before = structuredClone(event), expected = observedNativeCloseEvent(event);
  const retained = retainedShellHook(event, { text: false, log: false });
  assert.equal(matchesNativeCloseEvent(retained, expected), true);
  assert.equal(matchesNativeCloseEvent(retained, nativeCloseEvents([event])[0]), false, "Sealed history is still exact.");
  for (const change of [
    e => { e.id = "foreign"; }, e => { e.parentId = "foreign"; }, e => { e.agentId = "foreign"; },
    e => { e.timestamp += "changed"; }, e => { e.data.input.sessionId = "foreign"; },
    e => { e.data.input.cwd = "C:\\other"; }, e => { e.data.input.toolArgs.shellId = "foreign"; },
    e => { e.data.input.toolArgs.command = "changed"; },
    e => { e.data.input.toolResult.textResultForLlm += "changed"; },
    e => { e.data.input.toolResult.sessionLog += "changed"; },
    e => { e.data.input.toolResult.extra = true; },
  ]) {
    const changed = structuredClone(retained); change(changed);
    assert.equal(matchesNativeCloseEvent(changed, expected), false);
  }
  for (const change of [
    e => { e.data.input.toolName = "read_powershell"; },
    e => { e.data.input.toolArgs.mode = "async"; },
    e => { e.data.input.toolResult.resultType = "failure"; },
    e => { e.data.input.toolResult.contents[0].exitCode = 1; },
    e => { e.data.input.toolResult.contents[0].cwd = "C:\\other"; },
    e => { delete e.data.input.toolResult.contents[0].cwd; },
    e => { e.data.input.toolResult.contents[0].shellId = "foreign"; },
    e => { e.data.input.toolResult.contents[0].extra = true; },
    e => { e.data.input.toolResult.contents[0].outputPreview = null; },
    e => { e.data.input.toolResult.textResultForLlm = "not empty"; },
    e => { e.data.input.toolResult.sessionLog = "not empty"; },
  ]) {
    const changed = structuredClone(event); change(changed);
    const refused = observedNativeCloseEvent(changed);
    assert.equal(refused.allowedShellExitHistoryDigest, undefined);
    assert.equal(matchesNativeCloseEvent(retainedShellHook(changed, { text: false, log: false }), refused), false);
  }
  assert.deepEqual(event, before);
});

test("new assistant seals record only the exact three-field opaque resume projection", () => {
  const user = { id: "user", type: "user.message", parentId: null, timestamp: "2026-09-22T15:58:40.539Z",
    data: { content: "Fixture request", messageId: "request", interactionId: "interaction", turnId: "0" } };
  const event = { id: "assistant", type: "assistant.message", parentId: user.id, timestamp: "2026-09-22T15:58:41.539Z",
    data: { messageId: "message", content: "Visible response.", originatingMessageId: "request", model: "fixture-model",
      interactionId: "interaction", turnId: "0", apiCallId: "api", rte: true,
      toolRequests: [{ toolCallId: "call", name: "submit_human_route", type: "function", arguments: { resultId: "result" } }],
      ...syntheticAssistantOpaqueFields([{ type: "summary_text", text: "Synthetic fixture sentinel." }]) } };
  const before = structuredClone(event), fields = ["reasoningOpaque", "encryptedContent", "reasoningBlocks"];
  const proof = { schemaVersion: "human-loop-native-close/v1", sessionId: "private", flushed: true,
    events: nativeCloseEvents([user, event]), users: [{ id: user.id, messageId: "request", turnId: "0", interactionId: "interaction" }] };
  const check = (events, value = proof) => validateNativeReopen([user, ...events], value, "sdk-fixture", "sdk");
  assert.ok(proof.events[1].allowedColdAssistantOpaqueDigest);
  let resumed;
  for (let mask = 0; mask < 8; mask++) {
    const candidate = structuredClone(event);
    fields.forEach((key, index) => { if (mask & (1 << index)) delete candidate.data[key]; });
    assert.equal(nativeEventDigest(candidate) === proof.events[1].allowedColdAssistantOpaqueDigest, mask === 7);
    if (mask === 0 || mask === 7) assert.equal(check([candidate]), true);
    else assert.throws(() => check([candidate]), /history changed/);
    if (mask === 7) resumed = candidate;
  }
  assert.throws(() => validateNativeReopen([user, resumed], proof, "persisted-fixture", "persisted"), /history changed/);
  const changedOpaque = structuredClone(event); changedOpaque.data.encryptedContent += "changed";
  assert.throws(() => validateNativeReopen([user, changedOpaque], proof), /history changed/);
  const old = structuredClone(proof); delete old.events[1].allowedColdAssistantOpaqueDigest;
  assert.throws(() => check([resumed], old), /history changed/);
  assert.deepEqual(nativeCloseEvents([user, event], new Map(old.events.map(e => [e.id, e]))), old.events,
    "Resealing cannot retrofit an old canonical anchor.");
  assert.deepEqual(nativeCloseEvents([user, resumed], new Map(proof.events.map(e => [e.id, e]))), proof.events);
  for (const mutate of [
    e => { e.data.content += "changed"; }, e => { e.data.messageId = "foreign"; },
    e => { e.data.originatingMessageId = "foreign"; }, e => { e.data.model = "foreign"; },
    e => { e.data.interactionId = "foreign"; }, e => { e.data.turnId = "foreign"; },
    e => { e.data.apiCallId = "foreign"; }, e => { e.data.rte = false; },
    e => { e.data.toolRequests[0].arguments.resultId = "foreign"; },
    e => { e.data.toolRequests[0].name = "foreign"; }, e => { e.data.toolRequests[0].toolCallId = "foreign"; },
    e => { e.data.toolRequests[0].type = "custom"; }, e => { e.data.extra = true; },
    e => { e.id = "foreign"; }, e => { e.agentId = "foreign"; },
    e => { e.parentId = "foreign"; }, e => { e.timestamp += "changed"; },
    e => { e.type = "user.message"; },
  ]) {
    const changed = structuredClone(resumed); mutate(changed);
    assert.throws(() => check([changed]));
    assert.throws(() => nativeCloseEvents([changed], new Map([[changed.id, proof.events[1]]])), /seal-retention/);
  }
  for (const mutate of [
    e => { e.data.reasoningOpaque = null; }, e => { e.data.reasoningOpaque = {}; },
    e => { e.data.encryptedContent = 1; }, e => { e.data.encryptedContent = []; },
    e => { e.data.reasoningBlocks = null; }, e => { e.data.reasoningBlocks = []; },
    e => { e.data.reasoningBlocks.provider = 1; }, e => { delete e.data.reasoningBlocks.provider; },
    e => { e.data.reasoningBlocks.extra = true; },
    e => { e.data.reasoningBlocks.blocks = {}; }, e => { e.data.reasoningBlocks.blocks = null; },
    e => { e.data.reasoningBlocks.blocks[0].extra = undefined; },
    e => { e.data.reasoningBlocks.blocks.push(NaN); },
    e => { e.data.reasoningBlocks.blocks.push(new Date()); },
    e => { e.data.messageId = null; }, e => { e.data.content = null; },
    e => { e.type = "user.message"; },
  ]) {
    const changed = structuredClone(event); mutate(changed);
    assert.equal(nativeCloseEvents([changed])[0].allowedColdAssistantOpaqueDigest, undefined);
  }
  for (const value of ["invalid", null, 1]) {
    const changed = structuredClone(proof); changed.events[1].allowedColdAssistantOpaqueDigest = value;
    assert.throws(() => parseNativeClose(changed));
  }
  const wrongType = structuredClone(proof); wrongType.events[1].type = "tool.execution_complete";
  assert.throws(() => parseNativeClose(wrongType), /another event type/);
  const additional = { ...event, id: "next", parentId: event.id };
  const ordered = { ...proof, events: nativeCloseEvents([user, event, additional]) };
  assert.throws(() => check([additional, resumed], ordered), /order changed/);
  assert.deepEqual(event, before);
});

test("assistant SDK projection follows optional typed metadata, not opaque block contents", () => {
  const fields = ["reasoningOpaque", "encryptedContent", "reasoningBlocks"];
  const variants = Array.from({ length: 8 }, (_, mask) => {
    const metadata = syntheticAssistantOpaqueFields();
    fields.forEach((key, index) => { if (!(mask & (1 << index))) delete metadata[key]; });
    return metadata;
  });
  variants.push(
    { reasoningOpaque: "", encryptedContent: "", reasoningBlocks: { provider: "fixture-provider" } },
    { reasoningBlocks: { provider: "fixture-provider", blocks: [] } },
    { reasoningBlocks: { provider: "fixture-provider", blocks: [null, "fixture", 1, false, [],
      { type: "reasoning", summary: [
        { type: "summary_text", text: "Synthetic first sentinel." },
        { type: "summary_text", text: "Synthetic second sentinel." },
      ] }, { fixture: { nested: ["opaque JSON"] } }] } },
  );
  for (const metadata of variants) {
    const event = { id: "assistant", type: "assistant.message", parentId: null, timestamp: "2026-09-22T15:58:41Z",
      data: { messageId: "response", content: "Visible content.", ...metadata } };
    const expected = nativeCloseEvents([event])[0], present = fields.filter(key => Object.hasOwn(metadata, key));
    for (let mask = 0; mask < 1 << present.length; mask++) {
      const candidate = structuredClone(event);
      present.forEach((key, index) => { if (mask & (1 << index)) delete candidate.data[key]; });
      const all = mask === (1 << present.length) - 1;
      assert.equal(matchesNativeCloseEvent(candidate, expected, "sdk"), mask === 0 || all);
      assert.equal(matchesNativeCloseEvent(candidate, expected, "persisted"), mask === 0);
    }
    assert.equal(Boolean(expected.allowedColdAssistantOpaqueDigest), present.length > 0);
  }
});

test("cold final duplicate detailed text is derived before sealing and preserves canonical result bytes", () => {
  const user = { id: "user", type: "user.message", timestamp: "2026-09-22T14:38:50.307Z", parentId: null, data: { content: "Design only" } };
  const start = { ...user, id: "start", type: "tool.execution_start", parentId: "user",
    data: { toolName: "submit_human_route", toolCallId: "call", arguments: { resultId: "exact-result" } } };
  const result = { content: "The typed result is saved.", detailedContent: "The typed result is saved." };
  const final = { ...user, id: "final", type: "tool.execution_complete", parentId: "start",
    data: { toolCallId: "call", success: true, model: "owned", interactionId: "interaction", result, toolTelemetry: {} } };
  const history = [user, start, final], before = structuredClone(history);
  const proof = { schemaVersion: "human-loop-native-close/v1", sessionId: "private", flushed: true,
    events: nativeCloseEvents(history), users: [{ id: "user", messageId: "message", turnId: "turn", interactionId: "interaction" }] };
  const cold = structuredClone(history); delete cold[2].data.result.detailedContent;
  assert.equal(validateNativeReopen(cold, proof), true);
  assert.equal(validateNativeReopen(history, proof), true);
  const oldProof = structuredClone(proof); delete oldProof.events[2].allowedColdDuplicateResultDigest;
  assert.throws(() => validateNativeReopen(cold, oldProof), /history changed/);
  assert.equal(validateNativeReopen(history, oldProof), true);
  for (const mutate of [
    p => { p.events[2].allowedColdDuplicateResultDigest = "invalid"; },
    p => { p.events[0].allowedColdDuplicateResultDigest = p.events[2].allowedColdDuplicateResultDigest; },
    p => { p.events[2].unrecognizedAlternative = p.events[2].allowedColdDuplicateResultDigest; },
  ]) {
    const invalid = structuredClone(proof); mutate(invalid);
    assert.throws(() => parseNativeClose(invalid));
  }
  for (const mutate of [
    h => { h[2].data.result.content += "changed"; }, h => { h[2].data.result.extra = true; },
    h => { h[2].data.extra = true; }, h => { h[2].data.success = false; },
    h => { h[2].data.toolCallId = "foreign"; }, h => { h[2].parentId = "foreign"; },
    h => { h[2].id = "foreign"; }, h => { h[2].agentId = "foreign"; },
    h => { h[2].timestamp += "changed"; }, h => { h[2].data.model = "foreign"; },
    h => { h[1].data.arguments.resultId = "foreign"; },
    h => { [h[1], h[2]] = [h[2], h[1]]; },
  ]) {
    const changed = structuredClone(cold); mutate(changed);
    assert.throws(() => validateNativeReopen(changed, proof));
  }
  for (const mutate of [
    h => { h[2].data.result.detailedContent = "distinct authoritative details"; },
    h => { h[2].data.result.extra = "unqualified result shape"; },
    h => { h[2].data.success = false; },
    h => { h[1].data.toolCallId = "unbound"; },
    h => { h[1].agentId = "another-agent"; },
    h => { [h[1], h[2]] = [h[2], h[1]]; },
    h => { h.splice(2, 0, { ...h[1], id: "duplicate-start" }); },
  ]) {
    const changed = structuredClone(history); mutate(changed);
    const alteredProof = { ...proof, events: nativeCloseEvents(changed) };
    const reduced = structuredClone(changed); delete reduced.find(e => e.type === "tool.execution_complete").data.result.detailedContent;
    assert.throws(() => validateNativeReopen(reduced, alteredProof));
  }
  assert.deepEqual(history, before);
});

test("cold empty-output final composes only exact duplicate text and the bound four-field exit omission", () => {
  const hook = nativeShellHookFixture("powershell");
  delete hook.agentId;
  const input = hook.data.input;
  delete input.toolResult.contents[0].outputPreview;
  input.toolResult.textResultForLlm = "\n<shellId: owned completed with exit code 0>";
  input.toolResult.sessionLog = input.toolResult.textResultForLlm;
  const user = { id: "user", type: "user.message", timestamp: hook.timestamp, parentId: null, data: { content: "Implement and check silently" } };
  const start = { ...user, id: "start", type: "tool.execution_start", parentId: "user",
    data: { toolName: "powershell", toolCallId: "call", arguments: structuredClone(input.toolArgs) } };
  hook.parentId = "start";
  const final = { ...user, id: "final", type: "tool.execution_complete", parentId: hook.id,
    data: { toolCallId: "call", success: true, result: { content: input.toolResult.textResultForLlm,
      detailedContent: input.toolResult.sessionLog, contents: structuredClone(input.toolResult.contents) } } };
  const history = [user, start, hook, final], before = structuredClone(history);
  const proof = { schemaVersion: "human-loop-native-close/v1", sessionId: "private", flushed: true,
    events: nativeCloseEvents(history), users: [{ id: "user", messageId: "message", turnId: "turn", interactionId: "interaction" }] };
  const cold = structuredClone(history); delete cold[3].data.result.contents; delete cold[3].data.result.detailedContent;
  assert.equal(validateNativeReopen(cold, proof), true);
  const oldProof = structuredClone(proof); delete oldProof.events[3].allowedColdDuplicateResultDigest;
  assert.throws(() => validateNativeReopen(cold, oldProof), /history changed/);
  for (const mutate of [
    h => { h[3].data.result.contents[0].cwd = "C:\\foreign"; },
    h => { h[3].data.result.contents[0].exitCode = 1; },
    h => { h[3].data.result.contents[0].extra = true; },
    h => { h[3].data.result.contents[0].outputPreview = null; },
    h => { h[3].data.result.contents[0].shellId = "foreign"; },
    h => { h[3].data.result.content = "not empty"; },
    h => { h[3].data.result.detailedContent = "different"; },
    h => { h[3].data.result.extra = true; },
    h => { h[3].data.success = false; },
    h => { h[1].data.arguments.mode = "async"; },
    h => { h[2].data.input.toolArgs.command = "different"; },
    h => { h.splice(2, 1); },
    h => { h.splice(3, 0, { ...structuredClone(h[2]), id: "ambiguous-hook" }); },
  ]) {
    const changed = structuredClone(history); mutate(changed);
    const alteredProof = { ...proof, events: nativeCloseEvents(changed) };
    const reduced = structuredClone(changed); delete reduced.at(-1).data.result.contents; delete reduced.at(-1).data.result.detailedContent;
    assert.throws(() => validateNativeReopen(reduced, alteredProof));
  }
  assert.deepEqual(history, before);
});

for (const name of ["powershell", "read_powershell"]) test(`cold final ${name} shell-exit omission requires exact invocation identity and redundant exit text`, () => {
  const user = { id: "user", type: "user.message", timestamp: "2026-09-21T05:00:00Z", parentId: null, data: { content: "Run fixture" } };
  const start = { ...user, id: "start", parentId: "user", type: "tool.execution_start",
    data: { toolCallId: "call", toolName: name, arguments: { shellId: "owned", ...(name === "powershell" ? { command: "node --version" } : { delay: 1 }) } } };
  const final = { ...user, id: "end", parentId: "start", type: "tool.execution_complete", data: { toolCallId: "call",
    success: true, model: "owned-model", interactionId: "interaction", toolTelemetry: { properties: { executionMode: "sync" } },
    result: { content: "v24\n<shellId: owned completed with exit code 0>", detailedContent: "v24\n<shellId: owned completed with exit code 0>",
      contents: [{ type: "shell_exit", shellId: "owned", exitCode: 0, cwd: "C:\\owned", outputPreview: "v24\n" }] } } };
  const history = [user, start, final], before = structuredClone(history);
  const proof = { schemaVersion: "human-loop-native-close/v1", sessionId: "private", flushed: true,
    events: nativeCloseEvents(history), users: [{ id: "user", messageId: "message", turnId: "turn", interactionId: "interaction" }] };
  assert.ok(proof.events.at(-1).allowedColdShellResultDigest);
  const cold = structuredClone(history); delete cold.at(-1).data.result.contents;
  assert.equal(validateNativeReopen(cold, proof), true);
  assert.equal(validateNativeReopen(history, proof), true);
  for (const change of [
    h => { h[2].data.result.content += "changed"; },
    h => { h[2].data.result.detailedContent += "changed"; },
    h => { h[2].data.success = false; },
    h => { h[2].data.toolCallId = "foreign"; },
    h => { h[2].data.model = "changed"; },
    h => { h[2].data.interactionId = "changed"; },
    h => { h[2].data.toolTelemetry.properties.executionMode = "async"; },
    h => { h[2].parentId = "foreign"; },
    h => { h[2].timestamp = "changed"; },
    h => { h[1].data.arguments.shellId = "foreign"; },
    h => { h[1].data.arguments.command = "changed"; },
    h => { [h[1], h[2]] = [h[2], h[1]]; },
  ]) {
    const changed = structuredClone(cold); change(changed);
    assert.throws(() => validateNativeReopen(changed, proof), /changed/);
  }
  for (const change of [
    h => { h.splice(1, 1); },
    h => { h[1].data.toolName = "custom"; },
    h => { h[1].data.arguments.shellId = "foreign"; },
    h => { h[2].data.result.contents[0].extra = true; },
    h => { h[2].data.result.contents.push({ type: "text", text: "must remain" }); },
    h => { h[2].data.result.contents[0].exitCode = 1; },
    h => { h[2].data.result.contents[0].outputPreview += "missing"; },
    h => { h[2].data.result.detailedContent += "changed"; },
    h => { h[2].data.result.extra = true; },
  ]) {
    const changed = structuredClone(history); change(changed);
    assert.equal(nativeCloseEvents(changed).at(-1).allowedColdShellResultDigest, undefined);
  }
  assert.deepEqual(history, before);
});

for (const name of ["powershell", "read_powershell"]) test(`captured ${name} final permits only exact single-LF preview compatibility`, () => {
  const { start, final, disk } = capturedNativeShellFinal();
  start.data.toolName = name;
  if (name === "read_powershell") start.data.arguments = { shellId: start.data.arguments.shellId, delay: 1 };
  const result = final.data.result, exit = result.contents[0];
  assert.equal(Buffer.byteLength(result.content, "utf8"), 223);
  assert.equal(exit.outputPreview.slice(-4), "\n}\n\n");
  const withoutPreview = structuredClone(final);
  delete withoutPreview.data.result.contents;
  assert.deepEqual(withoutPreview, disk);
  assert.equal(matchesNativeCloseEvent(disk, observedNativeCloseEvent(final)), false);
  const entry = nativeCloseEvents([start, final]).at(-1);
  assert.ok(entry.allowedColdShellResultDigest);
  assert.equal(matchesNativeCloseEvent(disk, entry), true);
  const user = { id: "owned-user", type: "user.message", timestamp: start.timestamp, parentId: null, data: { content: "Read package" } };
  const proof = { schemaVersion: "human-loop-native-close/v1", sessionId: "owned-private", flushed: true,
    events: nativeCloseEvents([user, start, final]),
    users: [{ id: user.id, messageId: "owned-message", turnId: "0", interactionId: "owned-interaction" }] };
  assert.equal(validateNativeReopen([user, start, disk], proof), true);
  const oldProof = structuredClone(proof);
  delete oldProof.events.at(-1).allowedColdShellResultDigest;
  assert.throws(() => validateNativeReopen([user, start, disk], oldProof), /changed after clean close/);
  for (const mutate of [
    e => { e.data.result.contents[0].outputPreview += "\n"; },
    e => { e.data.result.contents[0].outputPreview += "\r\n"; },
    e => { e.data.result.contents[0].outputPreview += " "; },
    e => { e.data.result.contents[0].outputPreview += "\t"; },
    e => { e.data.result.contents[0].outputPreview = e.data.result.contents[0].outputPreview.replace("module", "Module"); },
    e => { e.data.result.contents[0].shellId += "-foreign"; },
    e => { e.data.result.contents[0].exitCode = 1; },
    e => { e.data.result.contents[0].exitCode = 0.5; },
    e => { e.data.result.contents[0].type = "text"; },
    e => { e.data.result.contents[0].cwd = null; },
    e => { e.data.result.contents[0].extra = true; },
    e => { e.data.result.contents.push({ type: "text", text: "retained" }); },
    e => { e.data.result.extra = true; },
    e => { e.data.result.detailedContent += "\n"; },
    e => { e.data.result.content += "\n"; e.data.result.detailedContent += "\n"; },
    e => { e.data.success = false; },
  ]) {
    const changed = structuredClone(final); mutate(changed);
    assert.equal(nativeCloseEvents([start, changed]).at(-1).allowedColdShellResultDigest, undefined);
  }
  const marker = `<shellId: ${exit.shellId} completed with exit code ${exit.exitCode}>`;
  const prefix = result.content.slice(0, -marker.length);
  for (const ending of ["", "\r\n", "\n\n", "\n\n\n", " \n", "\t\n"]) {
    const changed = structuredClone(final);
    const changedPrefix = prefix.slice(0, -1) + ending;
    changed.data.result.content = changed.data.result.detailedContent = changedPrefix + marker;
    // Preserve the captured preview for space/tab changes to reject substantive output differences.
    if (!ending.includes(" ") && !ending.includes("\t")) changed.data.result.contents[0].outputPreview = `${changedPrefix}\n`;
    assert.equal(nativeCloseEvents([start, changed]).at(-1).allowedColdShellResultDigest, undefined);
  }
  for (const mutate of [
    s => { s.data.toolName = "custom"; },
    s => { s.data.arguments.shellId = "foreign"; },
    s => { s.data.arguments.shellId = "invalid/id"; },
    s => { s.data.toolCallId = "foreign"; },
  ]) {
    const changed = structuredClone(start); mutate(changed);
    assert.equal(nativeCloseEvents([changed, final]).at(-1).allowedColdShellResultDigest, undefined);
  }
  assert.equal(nativeCloseEvents([final]).at(-1).allowedColdShellResultDigest, undefined);
  assert.equal(nativeCloseEvents([start, { ...start, id: "duplicate-start" }, final]).at(-1).allowedColdShellResultDigest, undefined);
  // Existing exact redundancy remains supported; it is not evidence about the captured formatter.
  const exact = structuredClone(final);
  exact.data.result.contents[0].outputPreview = exit.outputPreview.slice(0, -1);
  const exactEntry = nativeCloseEvents([start, exact]).at(-1);
  assert.ok(exactEntry.allowedColdShellResultDigest);
  assert.equal(matchesNativeCloseEvent(disk, exactEntry), true);
  assert.equal(nativeCloseEvents([start, { ...start, id: "duplicate-start" }, exact]).at(-1).allowedColdShellResultDigest, undefined);
  for (const mutate of [
    e => { e.id = "foreign"; }, e => { e.parentId = "foreign"; },
    e => { e.data.toolCallId = "foreign"; }, e => { e.data.success = false; },
    e => { e.timestamp += "changed"; }, e => { e.data.model = "foreign"; },
    e => { e.data.interactionId = "foreign"; },
    e => { e.data.result.content += "\n"; }, e => { e.data.result.detailedContent += "\n"; },
    e => { e.data.toolTelemetry.properties.executionMode = "async"; },
  ]) {
    const changed = structuredClone(disk); mutate(changed);
    assert.equal(matchesNativeCloseEvent(changed, entry), false);
    assert.throws(() => validateNativeReopen([user, start, changed], proof), /changed|Unowned input/);
  }
  const changedStart = structuredClone(start);
  changedStart.data.arguments.command = "different command";
  assert.throws(() => validateNativeReopen([user, changedStart, disk], proof), /changed/);
  assert.throws(() => validateNativeReopen([user, disk, start], proof), /order changed/);
});

for (const name of ["powershell", "read_powershell"]) test(`only the evidenced pre-hook ${name} shell-exit preview may be omitted from native history`, () => {
  const event = { id: "shell-hook", type: "hook.start", timestamp: "2026-09-21T04:00:00Z", parentId: "parent",
    data: { hookType: "postToolUse", input: { toolName: name, toolArgs: { shellId: "owned", ...(name === "powershell" ? { command: "node --version" } : { delay: 1 }) },
      toolResult: { resultType: "success", textResultForLlm: "v24.0.0", sessionLog: "v24.0.0",
        contents: [{ type: "shell_exit", shellId: "owned", exitCode: 0, cwd: "C:\\owned", outputPreview: "v24.0.0" }] } } } };
  const expected = observedNativeCloseEvent(event);
  const retained = structuredClone(event); delete retained.data.input.toolResult.contents;
  assert.equal(matchesNativeCloseEvent(event, expected), true);
  assert.equal(matchesNativeCloseEvent(retained, expected), true);
  for (const mutate of [
    e => { e.parentId = "foreign"; }, e => { e.id = "foreign"; },
    e => { e.data.input.toolArgs.command = "changed"; },
    e => { e.data.input.toolResult.textResultForLlm = "changed"; },
    e => { e.data.input.toolResult.sessionLog = "changed"; },
    e => { e.data.input.toolResult.resultType = "failure"; },
  ]) {
    const changed = structuredClone(retained); mutate(changed);
    assert.equal(matchesNativeCloseEvent(changed, expected), false);
  }
  const changedPreview = structuredClone(event);
  changedPreview.data.input.toolResult.contents[0].exitCode = 1;
  assert.equal(matchesNativeCloseEvent(changedPreview, expected), false);
  for (const mutate of [
    e => { e.data.hookType = "preToolUse"; },
    e => { e.data.input.toolName = "another_tool"; },
    e => { e.data.input.toolResult.contents[0].type = "terminal"; },
    e => { e.data.input.toolResult.contents[0].shellId = "foreign"; },
    e => { e.data.input.toolResult.contents[0].extra = "unexpected"; },
    e => { e.data.input.toolResult.contents.push({ type: "text", text: "must remain" }); },
  ]) {
    const changed = structuredClone(event); mutate(changed);
    assert.equal(observedNativeCloseEvent(changed).allowedShellExitHistoryDigest, undefined);
  }
  const final = { ...event, type: "tool.execution_complete", data: { toolCallId: "call", success: true, result: structuredClone(event.data.input.toolResult) } };
  const finalExpected = observedNativeCloseEvent(final);
  delete final.data.result.contents;
  assert.equal(matchesNativeCloseEvent(final, finalExpected), false);
});
