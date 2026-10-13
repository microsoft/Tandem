import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { projectOutputs } from "../stage2/tandem/public/project-outputs.js";
import { installProjectPresentation } from "../stage2/tandem/public/project-presentation.js";
import { projectHumanCycle } from "../stage2/tandem/src/human-loop-provider.mjs";

const binding = { revisionId: "design-one", digest: "a".repeat(64) };
const cycle = () => ({ id: "cycle-one", originRequestId: "request-one", design: binding, phase: "completed",
  plan: { id: "plan-one", version: 2, digest: "b".repeat(64), design: binding, goal: "Saved plan", tasks: [] },
  planHistory: [{ id: "plan-one", version: 1 }], tasks: [], current: { id: "snapshot-one" },
  implementationResult: { resultId: "implementation-one", outcome: { kind: "implementation-result", summary: "Reported output", evidenceRefs: ["test-output"] } } });
const snapshot = () => ({ installation: { status: "ready" }, workflow: {}, design: { binding, content: { artifacts: [
  { id: "screen", title: "Screen" }, { id: "contract", title: "Contract" }] } },
  cycles: [projectHumanCycle(cycle())], messages: [
    { id: "native:review-progress", role: "reviewer", text: "Checking" },
    { id: "handoff:review-one", role: "reviewer", requestId: "request-one", timestamp: "2026-10-10T10:00:00Z" }] });

test("project output index references actual current Design, cycle plans/results and canonical Review records once", () => {
  const source = snapshot(), before = structuredClone(source);
  const result = projectOutputs(source);
  assert.deepEqual(result.items.map(item => item.group), ["Design", "Design", "Plan", "Implementation", "Review"]);
  assert.equal(new Set(result.items.map(item => item.id)).size, 5);
  assert.equal(result.items.filter(item => item.group === "Plan").length, 1, "Do not count previous plan revisions again.");
  assert.deepEqual(source, before, "Projection does not mutate either engine.");
  delete source.cycles[0].implementation;
  assert.equal(projectOutputs(source).items.some(item => item.group === "Implementation"), false, "Completion status alone is not an output receipt.");
});

test("cold output state is unverified rather than an empty or deleted library", () => {
  assert.equal(projectOutputs({ installation: { status: "saved" }, workflow: null }).status, "unverified");
  assert.equal(projectOutputs({ installation: { status: "new" }, workflow: null }).status, "not-started");
  const source = snapshot(); source.installation.status = "closed";
  assert.equal(projectOutputs(source).items.length, 5);
  assert.match(projectOutputs(source).reason, /retained.*closed/);
});

test("bound output navigation rejects stale, foreign and cold requests without activation or draft changes", t => {
  const dom = new JSDOM('<body data-project-panel="workspace" data-project-origin="http://127.0.0.1:4000" data-project-channel="outputs"><form id="composer"><textarea id="message"></textarea></form>');
  t.after(() => dom.window.close());
  const sent = [], opened = [], parent = { postMessage: value => sent.push(value) };
  Object.defineProperty(dom.window, "parent", { value: parent });
  const api = installProjectPresentation({ document: dom.window.document, window: dom.window,
    changed() {}, settings() {}, currentWork() {}, openOutput: item => opened.push(item) });
  const receive = (data, source = parent) => dom.window.dispatchEvent(new dom.window.MessageEvent("message",
    { source, origin: "http://127.0.0.1:4000", data: { protocol: "tandem-project/v1", channel: "outputs", ...data } }));
  dom.window.document.querySelector("#message").value = "Unsent original draft";
  const source = snapshot(); api.publish(source);
  const item = sent.find(item => item.type === "outputs").items[0];
  assert.equal(item.target, undefined, "The parent receives references, not arbitrary renderer commands.");
  receive({ type: "output-open", ...item }, null); assert.equal(opened.length, 0);
  receive({ type: "output-open", id: item.id, binding: "stale" });
  assert.match(sent.at(-1).error, /no longer verified/);
  receive({ type: "output-open", id: item.id, binding: item.binding }); assert.equal(opened.length, 1);
  api.publish({ installation: { status: "saved" }, workflow: null });
  receive({ type: "output-open", id: item.id, binding: item.binding }); assert.equal(opened.length, 1);
  assert.equal(dom.window.document.querySelector("#message").value, "Unsent original draft");
  assert.equal(sent.some(item => ["activate", "discovery-send"].includes(item.type)), false);
});
