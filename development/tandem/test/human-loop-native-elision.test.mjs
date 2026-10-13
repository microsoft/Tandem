import assert from "node:assert/strict";
import test from "node:test";
import { matchesNativeCloseEvent, nativeCloseEvents, observedNativeCloseEvent, validateNativeReopen } from "../src/human-loop-close.mjs";

const marker = (bytes) => `[copilot:elided textResultForLlm (${bytes} bytes) \u2014 pre-hook tool result; the final result may differ, see the adjacent tool.execution_complete event]`;
const event = (value = '{"exitCode":0,"output":"v24.14.0\\r\\n"}') => ({
  id: "hook", type: "hook.start", timestamp: "2026-09-15T03:42:02.580Z", parentId: "external-complete",
  data: { hookType: "postToolUse", hookInvocationId: "invocation", input: {
    sessionId: "private", toolName: "run_workflow_command", toolArgs: { command: "node", args: ["--version"] },
    toolResult: { textResultForLlm: value, resultType: "success" },
  } },
});
const withText = (input, value) => {
  const copy = structuredClone(input);
  copy.data.input.toolResult.textResultForLlm = value;
  return copy;
};

test("only the exact SDK post-tool-use elision is an additional callback-bound representation", () => {
  for (const value of ["ASCII", "\u5b8c\u6210\u{1f642}\n", ""]) {
    const original = event(value), before = structuredClone(original), expected = observedNativeCloseEvent(original);
    assert.equal(matchesNativeCloseEvent(original, expected), true);
    assert.equal(matchesNativeCloseEvent(withText(original, marker(Buffer.byteLength(value, "utf8"))), expected), true);
    assert.equal(typeof expected.allowedHistoryDigest, "string");
    assert.equal(JSON.stringify(expected).includes(value), value === "");
    assert.deepEqual(original, before, "Recording the alternate digest must not mutate or retain the raw result.");
  }
});

test("wrong marker, UTF8 byte count and same-length changed raw text remain mismatches", () => {
  const original = event("\u5b8c\u6210\u{1f642}\n"), expected = observedNativeCloseEvent(original);
  const canonical = marker(Buffer.byteLength(original.data.input.toolResult.textResultForLlm, "utf8"));
  for (const value of [
    marker(original.data.input.toolResult.textResultForLlm.length),
    marker(12), canonical.replace("copilot:elided", "other:elided"), canonical.replace("\u2014", "-"),
    canonical + " ", canonical.replace("pre-hook", "final"), "\u6210\u5b8c\u{1f642}\n",
  ]) assert.equal(matchesNativeCloseEvent(withText(original, value), expected), false, value);
});

test("the alias does not exclude other fields, hook kinds, event types, identities or final results", () => {
  const original = event(), expected = observedNativeCloseEvent(original);
  const canonical = withText(original, marker(Buffer.byteLength(original.data.input.toolResult.textResultForLlm, "utf8")));
  const mutations = [
    (e) => { e.id = "another"; }, (e) => { e.type = "hook.end"; }, (e) => { e.parentId = "another"; },
    (e) => { e.timestamp = "2026-09-15T03:42:02.581Z"; }, (e) => { e.agentId = "another"; },
    (e) => { e.data.hookInvocationId = "another"; }, (e) => { e.data.input.sessionId = "another"; },
    (e) => { e.data.input.toolArgs.args = ["--help"]; }, (e) => { e.data.input.toolResult.resultType = "failure"; },
    (e) => { e.data.input.toolResult.extra = "unexpected"; },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(canonical); mutate(changed);
    assert.equal(matchesNativeCloseEvent(changed, expected), false);
  }
  for (const [type, hookType] of [["hook.start", "preToolUse"], ["hook.end", "postToolUse"], ["tool.execution_complete", "postToolUse"]]) {
    const raw = event(); raw.type = type; raw.data.hookType = hookType;
    const recorded = observedNativeCloseEvent(raw);
    assert.equal(recorded.allowedHistoryDigest, undefined);
    assert.equal(matchesNativeCloseEvent(withText(raw, canonical.data.input.toolResult.textResultForLlm), recorded), false);
  }
  const final = { id: "final", type: "tool.execution_complete", timestamp: original.timestamp, parentId: "hook-end",
    data: { toolCallId: "call", success: true, result: { content: original.data.input.toolResult.textResultForLlm } } };
  const changed = structuredClone(final); changed.data.result.content = canonical.data.input.toolResult.textResultForLlm;
  assert.equal(matchesNativeCloseEvent(changed, observedNativeCloseEvent(final)), false);
  const wrongField = event(); wrongField.data.input.textResultForLlm = wrongField.data.input.toolResult.textResultForLlm;
  delete wrongField.data.input.toolResult.textResultForLlm;
  assert.equal(observedNativeCloseEvent(wrongField).allowedHistoryDigest, undefined);
});

test("canonical close receipts retain full event identity and still reject missing or changed history", () => {
  const user = { id: "user", type: "user.message", timestamp: "2026-09-15T03:42:00Z", parentId: null, data: { content: "Exact input." } };
  const raw = event(), canonical = withText(raw, marker(Buffer.byteLength(raw.data.input.toolResult.textResultForLlm, "utf8")));
  const history = [user, canonical];
  const proof = { schemaVersion: "human-loop-native-close/v1", sessionId: "private", flushed: true,
    events: nativeCloseEvents(history), users: [{ id: "user", messageId: "message", turnId: "0", interactionId: "interaction" }] };
  assert.equal(validateNativeReopen(history, proof), true);
  assert.equal(validateNativeReopen([user], proof), false);
  assert.throws(() => validateNativeReopen([user, withText(canonical, marker(999))], proof), /changed/);
  assert.throws(() => validateNativeReopen([canonical, user], proof), /order/);
  assert.equal(proof.events[1].allowedHistoryDigest, undefined, "The durable receipt hashes actual RPC history, not a wildcard.");
});

test("external tool traceparent omission matches only the exact callback-bound execution", () => {
  const original = {
    id: "external-request", type: "external_tool.requested", timestamp: "2026-09-16T10:12:56.879Z", parentId: "tool-start",
    data: { requestId: "request", sessionId: "private", toolCallId: "call", toolName: "submit_human_route",
      arguments: { inputDigest: "a".repeat(64), outcome: { kind: "route", intent: "design" } },
      workingDirectory: "C:\\fixture", traceparent: "00-abce8d47bbe4ea6c050a2198bb8a604a-77558d11f465ad4d-01" },
  };
  const before = structuredClone(original), current = structuredClone(original);
  delete current.data.traceparent;
  const expected = observedNativeCloseEvent(original);
  assert.equal(matchesNativeCloseEvent(original, expected), true);
  assert.equal(matchesNativeCloseEvent(current, expected), true);
  assert.deepEqual(original, before);
  assert.equal(JSON.stringify(expected).includes(original.data.traceparent), false);
  for (const mutate of [
    (e) => { e.id = "foreign"; }, (e) => { e.parentId = "foreign"; },
    (e) => { e.timestamp = "2026-09-16T10:12:56.880Z"; }, (e) => { e.agentId = "foreign"; },
    (e) => { e.data.requestId = "foreign"; }, (e) => { e.data.sessionId = "foreign"; },
    (e) => { e.data.toolCallId = "foreign"; }, (e) => { e.data.toolName = "replace_project_file"; },
    (e) => { e.data.arguments.inputDigest = "b".repeat(64); },
    (e) => { e.data.arguments.outcome.intent = "implement"; },
    (e) => { e.data.workingDirectory = "C:\\foreign"; },
    (e) => { e.data.traceparent = "00-abce8d47bbe4ea6c050a2198bb8a604a-77558d11f465ad4d-00"; },
    (e) => { e.data.tracestate = "unexpected"; },
  ]) {
    const changed = structuredClone(current); mutate(changed);
    assert.equal(matchesNativeCloseEvent(changed, expected), false);
  }
  for (const type of ["user.message", "tool.execution_complete", "external_tool.completed", "hook.start"]) {
    const other = structuredClone(original); other.type = type;
    const without = structuredClone(other); delete without.data.traceparent;
    assert.equal(matchesNativeCloseEvent(without, observedNativeCloseEvent(other)), false);
  }
  for (const traceparent of ["", "unexpected", null, 42]) {
    const invalid = structuredClone(original); invalid.data.traceparent = traceparent;
    const without = structuredClone(invalid); delete without.data.traceparent;
    assert.equal(matchesNativeCloseEvent(without, observedNativeCloseEvent(invalid)), false);
  }
  const withState = structuredClone(original); withState.data.tracestate = "vendor=value";
  const withoutBoth = structuredClone(current);
  assert.equal(matchesNativeCloseEvent(withoutBoth, observedNativeCloseEvent(withState)), false,
    "This observed SDK case does not authorize stripping other telemetry fields.");
  const proof = { schemaVersion: "human-loop-native-close/v1", sessionId: "private", flushed: true,
    events: nativeCloseEvents([current]), users: [] };
  assert.equal(proof.events[0].allowedHistoryDigest, undefined);
  assert.equal(matchesNativeCloseEvent(original, proof.events[0]), false,
    "Canonical persisted history cannot acquire new trace metadata after close.");
});
