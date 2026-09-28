import assert from "node:assert/strict";
import test from "node:test";
import { projectHumanHistory } from "../public/renderers/human-loop-history.js";

function routine(sequence, type = "permission.granted", data = {}) {
  return { id: `original-${sequence}`, sequence, type, source: "system",
    timestamp: new Date(Date.UTC(2026, 8, 21, 23, 59, sequence)).toISOString(), summary: `Exact detail ${sequence}`,
    data: { decision: "all", grantRequestId: "grant", permissionKind: "read", status: "succeeded",
      activity: { sessionId: "private", taskId: "task", requestId: "request", role: "designer", toolName: "view", toolCallId: `call-${sequence}` },
      ...data } };
}

test("routine history compacts only consecutive exact semantic and request/role provenance", () => {
  const input = [routine(1), routine(2), routine(3, "human.native-shell"), routine(4, "human.native-shell"),
    routine(5, "human.task-progress", { status: "progress", taskId: "internal" }),
    routine(6, "human.task-progress", { status: "progress", taskId: "internal" })];
  const original = structuredClone(input);
  const grouped = projectHumanHistory(input, [], "stream");
  assert.deepEqual(grouped.map(item => [item.label, item.members.length]),
    [["Automatic approval", 2], ["Tool update", 2], ["Task progress", 2]]);
  assert.deepEqual(grouped.flatMap(item => item.members.map(member => [member.source.eventId, member.timestamp, member.explanation])),
    original.map(event => [event.id, event.timestamp, event.summary]));
  assert.deepEqual(grouped.map(item => item.explanation), ["Exact detail 2", "Exact detail 4", "Exact detail 6"]);
  assert.deepEqual(projectHumanHistory(input, [], "stream"), grouped, "Snapshot rerenders do not accumulate counts.");
  assert.deepEqual(input, original);
});

test("important events, other types sharing icons, identity changes and unknown legacy provenance break groups", () => {
  const base = routine(3);
  const breaks = [
    ...["permission.requested", "permission.denied", "permission.cancelled", "permission.reset", "human.role",
      "human.handoff", "human.stopped", "human.execution-unknown", "human.internal-task", "unknown.event"]
      .map(type => ({ ...base, type })),
    { ...base, source: "user" },
    { ...base, data: { ...base.data, status: "failed" }, type: "human.native-shell" },
    { ...base, data: {} }, { ...base, sequence: undefined },
    ...["sessionId", "requestId", "role", "taskId", "toolName"].map(key => ({
      ...base, data: { ...base.data, activity: { ...base.data.activity, [key]: key === "role" ? "reviewer" : "other" } },
    })),
    { ...base, data: { ...base.data, activity: { ...base.data.activity, role: undefined } } },
    { ...base, data: { ...base.data, activity: { ...base.data.activity, toolName: {} } } },
    { ...base, data: { ...base.data, requestId: "contradicting-request" } },
    { ...base, data: { ...base.data, permissionKind: "write" } },
    { ...base, data: { ...base.data, grantRequestId: "different-grant" } },
  ];
  for (const boundary of breaks) {
    const result = projectHumanHistory([routine(1), routine(2), boundary, routine(4), routine(5)], [], "stream");
    assert.deepEqual(result.map(item => item.members?.length ?? 1), [2, 1, 2], JSON.stringify(boundary));
  }
  const legacy = [routine(1, "human.native-shell", {}), routine(2, "human.native-shell", {})]
    .map(event => ({ ...event, data: {} }));
  assert.ok(projectHumanHistory(legacy, [], "stream").every(item => !item.members));
  const markers = projectHumanHistory([routine(1), routine(3)], [], "stream",
    [{ id: "other-request", receivedAt: routine(2).timestamp }]);
  assert.deepEqual(markers.map(item => item.members?.length ?? 1), [1, 1, 1]);
});

test("group members retain exact date-spanning timestamps and the original bounded history window", () => {
  const input = Array.from({ length: 501 }, (_, index) => routine(index));
  const result = projectHumanHistory(input, [], "stream");
  assert.equal(result.length, 1); assert.equal(result[0].members.length, 500);
  assert.equal(result[0].members[0].timestamp, input[1].timestamp);
  assert.equal(result[0].timestamp, input.at(-1).timestamp);
  assert.equal(result[0].members.at(-1).source.eventId, input.at(-1).id);
});

test("history labels use semantic types and role/outcome fields, never summary parsing or truncation", () => {
  const cases = [
    ["human.setup-waiting", {}, "Setup waiting"], ["human.ready", {}, "Ready"],
    ["human.role", { role: "router" }, "Routing"], ["human.role", { role: "designer" }, "Designing"],
    ["human.role", { role: "planner" }, "Planning"], ["human.role", { role: "implementer" }, "Implementing"],
    ["human.role", { role: "reviewer" }, "Reviewing"], ["human.role", { role: "agent" }, "Read-only work"],
    ["human.role", { role: "unrecognized" }, "Host update"],
    ["human.task-progress", {}, "Task progress"], ["human.internal-task", {}, "Task progress"],
    ["human.plan-accepted", {}, "Plan ready"], ["human.answer-rejected", {}, "Answer not applied"],
    ["human.handoff", { kind: "design-concern" }, "Input needed"],
    ["human.handoff", { kind: "designer-changed" }, "Design updated"],
    ["human.handoff", { kind: "designer-unchanged" }, "Design unchanged"],
    ["human.handoff", { kind: "review-result" }, "Review result"],
    ["human.handoff", { kind: "answer" }, "Answer ready"],
    ["human.handoff", { kind: "execution-failure" }, "Work failed"],
    ["permission.requested", {}, "Permission needed"], ["permission.granted", {}, "Permission granted"],
    ["permission.denied", {}, "Permission denied"], ["permission.cancelled", {}, "Permission withdrawn"],
    ["human.stopping", {}, "Stopping"], ["human.stopped", {}, "Stopped"],
    ["human.execution-unknown", {}, "State unknown"], ["human.audit-failed", {}, "History issue"],
    ["unexpected.event", {}, "Host update"],
  ];
  for (const [type, data, label] of cases) {
    const summary = "  Ready! Waiting! Review failed! ".repeat(120) + "\nExact final explanation. ";
    const input = [{ type, data, summary, timestamp: "2026-09-15T00:00:00Z", sequence: 9 }];
    const before = structuredClone(input), result = projectHumanHistory(input, [], "stream")[0];
    assert.equal(result.label, label);
    assert.equal(result.explanation, summary);
    assert.equal(result.id, "event:stream:9");
    assert.equal(result.timestamp, input[0].timestamp);
    assert.ok(result.label.length <= 22);
    assert.deepEqual(input, before);
  }
});

test("history preserves identities without binding role events to nearby conversation records", () => {
  const timestamp = "2026-09-15T00:00:01Z";
  const messages = [
    { id: "original", requestId: "request", timestamp: "2026-09-15T00:00:00Z", text: "Original exact input." },
    { id: "future", requestId: "request", timestamp: "2026-09-15T00:00:02Z", text: "Do not bind an earlier event to a future result." },
  ];
  const items = [
    { id: "raw-id", type: "human.role", sequence: 1, timestamp, summary: "Exact role explanation.",
      data: { role: "designer", requestId: "request", cycleId: "cycle", resultId: "result", stopId: "stop" } },
    { type: "permission.granted", sequence: 2, timestamp, summary: "Permission decision.", data: { requestId: "request" } },
    { type: "human.ready", sequence: 3, timestamp, summary: "One-copy project workflow is ready.", data: {} },
    { type: "human.state", sequence: 4, timestamp, summary: "Snapshot invalidation only.", data: {} },
  ];
  const before = structuredClone({ items, messages });
  const result = projectHumanHistory(items, messages, "stream");
  assert.deepEqual(result.map(({ id }) => id), ["event:stream:1", "event:stream:2", "event:stream:3"]);
  assert.equal(result[0].entryId, "");
  assert.deepEqual(result[0].source, { eventId: "raw-id", streamId: "stream", sequence: 1,
    requestId: "request", cycleId: "cycle", resultId: "result", stopId: "stop" });
  assert.equal(result[1].entryId, "", "A broker permission ID is not a workflow request association.");
  assert.equal(result[2].entryId, "", "An unlinked setup/ready event must not be attached to an arbitrary last message.");
  assert.deepEqual({ items, messages }, before);
});

test("handoffs link only their exact persisted result message, including a later message timestamp", () => {
  const event = { type: "human.handoff", sequence: 1, timestamp: "2026-09-15T00:00:01Z",
    summary: "Same summary", data: { kind: "review-result", requestId: "request", resultId: "review-1" } };
  const messages = [
    { id: "other", requestId: "request", text: "Same summary", timestamp: "2026-09-15T00:00:00Z" },
    { id: "handoff:review-1", requestId: "request", timestamp: "2026-09-15T00:00:02Z" },
  ];
  assert.equal(projectHumanHistory([event], messages, "stream")[0].entryId, "handoff:review-1");
  assert.equal(projectHumanHistory([event], messages.slice(0, 1), "stream")[0].entryId, "");
  assert.equal(projectHumanHistory([event], [{ ...messages[1], requestId: "other" }], "stream")[0].entryId, "");
});

test("request markers use durable identities and receipt times across batching, reload and delayed entries", () => {
  const timestamp = "2026-09-18T00:00:01Z";
  const requests = ["a", "b", "image-only"].map(id => ({ id, receivedAt: timestamp }));
  const messages = ["a", "b"].map(id => ({ id: `request:${id}`, requestId: id, kind: "user", text: "Same text", timestamp }));
  const events = [
    { type: "human.role", sequence: 2, timestamp, data: { role: "planner", requestId: "a" } },
    { type: "human.role", sequence: 1, timestamp, data: { role: "router", requestId: "a" } },
  ];
  const result = projectHumanHistory(events, messages, "first", [...requests, requests[0]]);
  assert.deepEqual(result.map(item => item.label), ["Your request", "Your request", "Your request", "Routing", "Planning"]);
  assert.deepEqual(result.slice(0, 3).map(item => [item.id, item.timestamp, item.entryId]),
    [["request:a", timestamp, "request:a"], ["request:b", timestamp, "request:b"], ["request:image-only", timestamp, ""]]);
  assert.deepEqual(projectHumanHistory(events, messages, "reloaded", [...requests].reverse()).slice(0, 3), result.slice(0, 3));
  messages.push({ id: "request:image-only", requestId: "image-only", kind: "user", text: "", timestamp });
  assert.equal(projectHumanHistory(events, messages, "first", requests)[2].entryId, "request:image-only");
  assert.equal(projectHumanHistory([], [{ ...messages[0], requestId: "different" }], "first", requests)[0].entryId, "");
  const many = Array.from({ length: 501 }, (_, index) => ({ id: `${index}`, receivedAt: new Date(index * 1000).toISOString() }));
  const bounded = projectHumanHistory([], [], "first", many);
  assert.equal(bounded.length, 500);
  assert.equal(bounded[0].id, "request:1");
  const laterReceipt = "2026-09-18T00:00:02Z";
  const skewed = projectHumanHistory(events, messages, "first", [{ id: "a", receivedAt: laterReceipt }]);
  assert.deepEqual(skewed.map(item => item.label), ["Your request", "Routing", "Planning"]);
  assert.equal(skewed[0].timestamp, laterReceipt, "Causal display order must not rewrite the persisted receipt timestamp.");
});
