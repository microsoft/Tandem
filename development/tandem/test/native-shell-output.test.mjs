import assert from "node:assert/strict";
import test from "node:test";
import { NativeShellOutput } from "../src/native-shell-output.mjs";

function fixture() {
  const active = { user: { interactionId: "interaction" }, idle: null,
    starts: [{ id: "turn", interactionId: "interaction" }], nativeCalls: new Map() };
  const events = [
    { id: "notification", parentId: "turn", type: "system.notification",
      data: { kind: { type: "shell_completed", shellId: "shell", exitCode: 0 } } },
    { id: "message", parentId: "notification", type: "assistant.message",
      data: { content: "", toolRequests: [{ toolCallId: "call", name: "read_powershell", arguments: { shellId: "shell", delay: 0 } }] } },
    { id: "start", parentId: "message", type: "tool.execution_start",
      data: { toolCallId: "call", toolName: "read_powershell", arguments: { shellId: "shell", delay: 0 } } },
    { id: "complete", parentId: "start", type: "tool.execution_complete", data: { toolCallId: "call", success: true } },
  ];
  return { active, events };
}

test("automatic output keeps exact replay evidence beyond the former bookkeeping capacity", () => {
  const tracker = new NativeShellOutput(1);
  let first;
  for (let index = 0; index < 12; index++) {
    const { active, events } = fixture();
    for (const event of events) {
      event.id += `-${index}`;
      event.parentId += `-${index}`;
      if (event.data.toolCallId) event.data.toolCallId += `-${index}`;
      for (const request of event.data.toolRequests ?? []) request.toolCallId += `-${index}`;
    }
    first ??= events;
    assert.equal(events.map(event => tracker.observe(event, active, "private")).at(-1).kind, "complete");
  }
  assert.equal(tracker.observe(first[3], null, "private").kind, "duplicate");
  assert.throws(() => tracker.observe({ ...first[3], data: { ...first[3].data, success: false } }, null, "private"),
    /event identity changed/);
});

test("automatic shell output correlates exact runtime events, not model-call admissions", () => {
  const { active, events } = fixture(), tracker = new NativeShellOutput(40);
  const effects = events.map(event => tracker.observe(event, active, "private"));
  assert.deepEqual(effects.map(effect => effect?.kind ?? null), [null, null, "start", "complete"]);
  assert.equal(effects[2].notification, events[0]);
  assert.equal(active.nativeCalls.size, 0);
  assert.equal(tracker.observe(events[3], active, "private").kind, "duplicate");
  assert.throws(() => tracker.observe({ ...events[3], data: { ...events[3].data, success: false } }, active, "private"),
    /event identity changed/);
});

for (const [name, mutate] of [
  ["foreign notification", events => { events[0].sessionId = "foreign"; }],
  ["subagent notification", events => { events[0].agentId = "foreign"; }],
  ["missing exit", events => { delete events[0].data.kind.exitCode; }],
  ["different shell", events => { events[0].data.kind.shellId = "foreign"; }],
  ["missing message ancestry", events => { events[1].parentId = "foreign"; }],
  ["nonempty assistant text", events => { events[1].data.content = "Model instruction"; }],
  ["duplicate request", events => { events[1].data.toolRequests.push(events[1].data.toolRequests[0]); }],
  ["foreign message", events => { events[1].sessionId = "foreign"; }],
  ["subagent message", events => { events[1].agentId = "foreign"; }],
  ["different request ID", events => { events[1].data.toolRequests[0].toolCallId = "other"; }],
  ["different request arguments", events => { events[1].data.toolRequests[0].arguments.delay = 1; }],
  ["missing start ancestry", events => { events[2].parentId = "foreign"; }],
  ["foreign start", events => { events[2].sessionId = "foreign"; }],
  ["subagent start", events => { events[2].agentId = "foreign"; }],
  ["new-work arguments", events => { events[2].data.arguments.command = "forbidden"; }],
  ["wrong completion parent", events => { events[3].parentId = "foreign"; }],
  ["wrong completion call", events => { events[3].data.toolCallId = "foreign"; }],
  ["foreign completion", events => { events[3].sessionId = "foreign"; }],
  ["subagent completion", events => { events[3].agentId = "foreign"; }],
  ["completion not known", events => { delete events[3].data.success; }],
]) test(`automatic shell output rejects ${name}`, () => {
  const { active, events } = fixture(), tracker = new NativeShellOutput(40);
  mutate(events);
  assert.throws(() => events.forEach(event => tracker.observe(event, active, "private")), /Automatic output/);
});

test("ordinary turn-owned reads are not reclassified; unmatched completion is not proof", () => {
  const { active, events } = fixture(), tracker = new NativeShellOutput(40);
  assert.equal(tracker.observe({ ...events[2], data: { ...events[2].data, turnId: "owned" } }, active, "private"), null);
  assert.equal(tracker.observe(events[3], active, "private"), null);
});

test("notification parents are incidental; start still requires positive live-journal verification by the caller", () => {
  const { events } = fixture(), tracker = new NativeShellOutput(40);
  events[0].parentId = "native-userPromptSubmitted-hook";
  const effects = events.map(event => tracker.observe(event, null, "private"));
  assert.equal(effects[2].kind, "start");
  assert.equal(effects[2].notification, events[0]);
  assert.equal(effects[3].kind, "complete");
});
