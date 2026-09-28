import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import test from "node:test";
import { HostStateFile } from "../runtime-src/domain/host-state-file.ts";
import { DEFAULT_POLICY, policyHash } from "../runtime-src/domain/workflow/policy.ts";
import { validatePolicyShape } from "../runtime-src/domain/workflow/policy-contracts.ts";
import { HumanLoopDesigner } from "../src/human-loop-design.mjs";
import { HumanLoopDesignStore } from "../src/human-loop-design-store.mjs";
import { HumanLoopStore } from "../src/human-loop-store.mjs";
import { createHumanTask } from "../src/human-loop-task.mjs";
import { designGenerationContract, validateDesign } from "../public/sketch/design-contract.js";
import { sharedDesign as legacySharedDesign, sharedDesignV3 as sharedDesign } from "./helpers/shared-design-fixture.mjs";
import { mailSketch, shapeSketch } from "./fixtures/sketch-v2.mjs";
import { createTemplate } from "../public/sketch/templates.js";
import { multiFormatDesign } from "./fixtures/multi-format.mjs";

const none = { revisionId: null, digest: null };
const baseline = { id: "existing-code", digest: "a".repeat(64) };
const roleResult = (packet, outcome) => ({ schemaVersion: "human-role-result/v1",
  resultId: `result-${packet.binding.id}`, inputDigest: packet.binding.inputDigest, outcome });
const changed = (packet, artifactRef) => roleResult(packet, { kind: "designer-changed", summary: "Updated Design.", artifactRef, questions: [] });
const unchanged = (packet) => roleResult(packet, { kind: "designer-unchanged", summary: "Design remains applicable.",
  explanation: "The existing Design already expresses the request.", questions: [] });

const headFile = (root) => new HostStateFile(root, resolve(root, ".tandem", "living-canvas", "design", "manifest.json"));
const revisionFile = (root, id) => new HostStateFile(root,
  resolve(root, ".tandem", "living-canvas", "design", "revisions", `${id}.json`), undefined, { artifact: true });
async function canonicalEvidence(root) {
  const names = await revisionFile(root, "probe").list();
  return { head: await headFile(root).read(), revisions: await Promise.all(names.map(async (name) => ({
    name, content: await revisionFile(root, name.slice(0, -".json".length)).read(),
  }))) };
}

async function publishCanonical(root, artifacts, input, previous) {
  const journal = new HostStateFile(root, resolve(root, ".tandem", "living-canvas", "human-loop", "design", "publication.json"));
  return journal.run("test-publish-design", () => artifacts.publish({ input, previous, requestId: "external-request",
    application: { id: randomUUID(), proposedAt: new Date().toISOString(), designDigest: policyHash(validateDesign(input)) } }));
}

async function driftCanonical(f) {
  const current = await f.adapter.read(), input = structuredClone(current.content);
  input.summary = "A newer canonical revision.";
  return publishCanonical(f.root, f.artifacts, input, current.binding);
}

function reuseConnectionAsBox(output) {
  output.artifacts[0].boxes.find(({ id }) => id === "prepare").id = "handoff-request";
  output.artifacts[0].connections[0].id = "new-handoff";
  output.artifacts[0].connections[0].from = "handoff-request";
}

async function fileEvidence(root) {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return Promise.all(entries.map(async (entry) => {
    const path = resolve(entry.parentPath, entry.name);
    return { path: relative(root, path), ...(entry.isDirectory() ? { directory: true } : {
      digest: policyHash((await readFile(path)).toString("base64")), modified: (await stat(path, { bigint: true })).mtimeNs.toString(),
    }) };
  })).then((records) => records.sort((a, b) => a.path.localeCompare(b.path)));
}

async function fixture(t, { initial = false } = {}) {
  const root = resolve(`.human-loop-design-test-${randomUUID()}`);
  await mkdir(root);
  const owner = { schemaVersion: "human-loop-owner/v1", id: "owner", mainSessionId: "main",
    privateSessionId: "private", workspacePath: root, policy: DEFAULT_POLICY };
  const store = new HumanLoopStore(owner), artifacts = new HumanLoopDesignStore(root);
  t.after(async () => { await store.close(); await rm(root, { recursive: true, force: true }); });
  await writeFile(resolve(root, "app.js"), "export const retainedDirtyCode = 2;\n");
  await writeFile(resolve(root, "TANDEM.md"), "Existing implementation index.\n");
  if (initial) {
    await publishCanonical(root, artifacts, legacySharedDesign(), none);
  }
  let authorized = true, sequence = 0;
  const verifyOwnership = async () => assert.ok(authorized, "Ownership was revoked.");
  const adapter = new HumanLoopDesigner({ owner, store, verifyOwnership });
  const design = await adapter.read();
  await store.initialize(design.binding);
  const dispatch = (authority, type, data) => store.dispatch(authority, `command-${++sequence}`, type, data);
  const start = async (role) => {
    const state = await store.load();
    const packet = createHumanTask({ id: `${role}-${++sequence}`, dispatchId: `dispatch-${sequence}`, sessionId: "private",
      requestId: "request", cycleId: null, role, internalTaskId: null, before: baseline, design: state.design },
    { instructions: ["Read-only product code."], design: design.content });
    await dispatch("host", "start-role", packet.binding);
    await dispatch("runtime", "role-acknowledged", { taskId: packet.binding.id, dispatchId: packet.binding.dispatchId, messageId: "message" });
    await dispatch("runtime", "role-started", { taskId: packet.binding.id, messageId: "message", interactionId: "interaction" });
    return packet;
  };
  const finish = async (packet, result) => {
    await dispatch("agent", "submit-result", result);
    await dispatch("host", "confirm-role-end", { proof: {
      taskId: packet.binding.id, dispatchId: packet.binding.dispatchId, sessionId: "private",
      messageId: "message", interactionId: "interaction", endEventId: `end-${packet.binding.id}`,
      quiescent: true, termination: "normal", abortAcknowledged: false,
    }, snapshot: baseline });
  };
  await dispatch("user", "receive-request", { id: "request", message: "Revise the Design.", receivedAt: new Date().toISOString(), answers: null });
  await dispatch("host", "admit-request", { requestId: "request" });
  const router = await start("router");
  const route = roleResult(router, { kind: "route", intent: "design", cycleId: null, summary: "Design request.", resolvedQuestions: [] });
  await finish(router, route);
  await dispatch("host", "apply-result", { resultId: route.resultId, designPublication: null });
  const packet = await start("designer");
  const stage = (output = sharedDesign(), task = packet, signal) => adapter.tools()[0].execute(output, { task, signal, toolCallId: "stage-call" });
  const publish = (result, previous = design.binding) => adapter.publish({ packet, result, previous });
  return { root, owner, store, adapter, artifacts, packet, design, dispatch, finish, stage, publish,
    verifyOwnership, revoke: () => { authorized = false; } };
}

test("Designer answers retain Router intent authority without automatically admitting implementation", async t => {
  const f = await fixture(t, { initial: true });
  const result = unchanged(f.packet);
  result.outcome.questions = [{ id: "content", context: "Missing business details.",
    question: "How should missing details be handled when implemented?", whyItMatters: "Draft accuracy.",
    importance: "advisory", allowFreeform: true,
    options: [{ id: "placeholder", label: "Build with clear placeholders", implication: "Draft before launch." }] }];
  await f.finish(f.packet, result);
  await f.dispatch("host", "apply-result", { resultId: result.resultId, designPublication: null });
  await f.dispatch("host", "present-handoff", { handoffId: (await f.store.load()).handoffs.at(-1).id });
  await f.dispatch("user", "receive-request", { id: "answer-only", message: "Question form submission.",
    receivedAt: new Date().toISOString(), answers: { schemaVersion: "human-question-answers/v1",
      answers: [{ questionId: "content", sourceResultId: result.resultId, kind: "option", value: "placeholder" }] } });
  await f.dispatch("host", "admit-request", { requestId: "answer-only" });
  const packet = createHumanTask({ id: "answer-router", dispatchId: "answer-dispatch", sessionId: "private",
    requestId: "answer-only", cycleId: null, role: "router", internalTaskId: null, before: baseline, design: f.design.binding }, {});
  await f.dispatch("host", "start-role", packet.binding);
  await f.dispatch("runtime", "role-acknowledged", { taskId: packet.binding.id, dispatchId: packet.binding.dispatchId, messageId: "answer-message" });
  await f.dispatch("runtime", "role-started", { taskId: packet.binding.id, messageId: "answer-message", interactionId: "answer-interaction" });
  const routed = roleResult(packet, { kind: "route", intent: "implement", cycleId: null, summary: "The user chose to build with placeholders.",
    resolvedQuestions: [{ questionId: "content", sourceResultId: result.resultId }] });
  const before = await f.store.load();
  for (const type of ["stage-result", "submit-result", "complete-role-result"]) {
    await f.store.validate("agent", type, routed);
    assert.deepEqual(await f.store.load(), before, "Validation does not alter durable state.");
  }
  assert.equal((await f.store.load()).cycles.length, 0);
  await f.store.dispatch("agent", "answer-result", "complete-role-result", routed);
  await f.dispatch("host", "record-result-snapshot", { taskId: packet.binding.id, resultId: routed.resultId, snapshot: baseline });
  await f.dispatch("host", "apply-result", { resultId: routed.resultId, designPublication: null });
  const retained = await f.store.load();
  assert.deepEqual(await f.store.dispatch("agent", "answer-result", "complete-role-result", routed), retained);
  assert.equal(retained.cycles.length, 0, "The Router result does not itself create an implementation cycle.");
  const cycle = { cycleId: "authorized-cycle", design: f.design.binding, baseline };
  await assert.rejects(f.dispatch("host", "start-cycle", cycle), /Explicit user confirmation/);
  await f.dispatch("host", "request-implementation-confirmation", { id: "answer-confirmation", requestId: "answer-only",
    routeResultId: routed.resultId, design: f.design.binding, createdAt: "2026-09-28T10:00:00Z" });
  await f.dispatch("user", "decide-implementation-confirmation", { confirmationId: "answer-confirmation",
    decision: "approved", decidedAt: "2026-09-28T10:01:00Z" });
  await f.dispatch("host", "start-cycle", cycle);
  const planning = createHumanTask({ id: "pending-planner", dispatchId: "pending-planner", sessionId: "private",
    requestId: "answer-only", cycleId: cycle.cycleId, role: "planner", internalTaskId: null,
    before: baseline, design: f.design.binding }, {});
  let saved = false;
  t.mock.method(f.store, "saveTask", async () => { saved = true; });
  await f.store.admitTask(planning);
  assert.equal(saved, true);
  assert.equal((await f.store.load()).activeTask.binding.id, planning.binding.id);
});

test("initial staging validates a generic collection without publishing or changing product files", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await f.adapter.read(), { binding: none, content: null, references: [] });
  const [tool] = f.adapter.tools();
  assert.equal(tool.name, "stage_human_design");
  assert.deepEqual(tool.roles, ["designer"]);
  assert.deepEqual(tool.parameters.required, ["schemaVersion", "goal", "summary", "outcomes", "artifacts"]);
  assert.deepEqual(f.adapter.generation(), designGenerationContract);
  const staged = await f.stage();
  assert.match(staged.artifactRef, /^human-design:[a-f0-9]{64}$/);
  assert.deepEqual(await f.stage(), staged);
  assert.equal(await f.artifacts.inspectCurrent(), null);
  assert.deepEqual(await f.adapter.read(), { binding: none, content: null, references: [] });
  assert.equal(await readFile(resolve(f.root, "app.js"), "utf8"), "export const retainedDirtyCode = 2;\n");
  assert.equal(await readFile(resolve(f.root, "TANDEM.md"), "utf8"), "Existing implementation index.\n");
  assert.deepEqual((await readdir(f.root)).sort(), [".tandem", "TANDEM.md", "app.js"]);
  const result = changed(f.packet, staged.artifactRef);
  assert.deepEqual(await f.adapter.validateOutcome(f.packet, result), result);
});

test("multi-format source retains legacy completion reads and exact prior revision across restart", async (t) => {
  const f = await fixture(t, { initial: true });
  const priorBytes = await revisionFile(f.root, f.design.binding.revisionId).read();
  const input = multiFormatDesign();
  const { artifactRef } = await f.stage(input), result = changed(f.packet, artifactRef);
  await assert.rejects(f.publish(result), /exact saved result/);
  await f.finish(f.packet, result);
  const publication = await f.publish(result);
  const reloaded = new HumanLoopDesigner({ owner: f.owner, store: f.store, verifyOwnership: f.verifyOwnership });
  assert.deepEqual((await reloaded.read()).content, input);
  assert.equal((await reloaded.read()).binding.digest, policyHash(input));
  assert.deepEqual(await reloaded.publish({ packet: f.packet, result, previous: f.design.binding }), publication);
  assert.equal(await revisionFile(f.root, f.design.binding.revisionId).read(), priorBytes);
  assert.deepEqual((await reloaded.readRevision(f.design.binding)).content, legacySharedDesign());
  await f.dispatch("host", "apply-result", { resultId: result.resultId, designPublication: publication });
  assert.equal((await f.store.load()).cycles.length, 0);
});

test("complete v2 mail, relationship and workflow compositions publish exact data while retaining the prior v1 revision", async (t) => {
  const f = await fixture(t, { initial: true }), prior = await f.artifacts.readRevision(f.design.binding);
  const input = {
    schemaVersion: "sketch-design/v3", goal: "Explain screens, relationships and work using one vocabulary.",
    summary: "Visible text roles, controlled icons, shapes, appearance and bounded group layout remain canonical data.",
    outcomes: [{ id: "same-vocabulary", description: "Inspect every composition through the same generic references.",
      references: ["mail-workspace#reader", "shared-shapes#decision", "workflow-example#deliver"] }],
    artifacts: [mailSketch, shapeSketch, createTemplate("workflow")],
  };
  const exact = JSON.stringify(input), staged = await f.stage(input);
  assert.deepEqual((await f.adapter.read()).binding, f.design.binding, "Staging alone does not publish.");
  const result = changed(f.packet, staged.artifactRef);
  await f.adapter.validateOutcome(f.packet, result);
  await f.finish(f.packet, result);
  const publication = await f.publish(result);
  const published = await f.adapter.read();
  assert.equal(JSON.stringify(published.content), exact, "No defaults, resolved geometry or rewritten visible text are persisted.");
  assert.equal(published.binding.digest, policyHash(input));
  assert.deepEqual(await f.artifacts.readRevision(f.design.binding), prior, "The producing v1 revision remains byte-equivalent data.");
  const reader = published.references.find(item => item.reference === "mail-workspace#reader");
  assert.equal(reader.body, mailSketch.boxes.find(box => box.id === "reader").body);
  assert.equal(reader.caption, mailSketch.boxes.find(box => box.id === "reader").caption);
  await f.dispatch("host", "apply-result", { resultId: result.resultId, designPublication: publication });
  assert.equal((await f.store.load()).cycles.length, 0, "Publication does not start implementation.");
  assert.equal(await readFile(resolve(f.root, "app.js"), "utf8"), "export const retainedDirtyCode = 2;\n");
});

test("exact positively ended task publishes once, survives adapter recreation, and hands off without Implementation", async (t) => {
  const f = await fixture(t);
  const { artifactRef } = await f.stage();
  const result = changed(f.packet, artifactRef);
  await f.finish(f.packet, result);
  const first = await f.publish(result);
  assert.deepEqual(first.previous, none);
  assert.equal(first.artifactRef, artifactRef);
  assert.equal((await f.adapter.read()).binding.revisionId, first.current.revisionId);
  assert.deepEqual((await f.adapter.read()).binding, first.current);
  assert.deepEqual((await f.artifacts.inspectCurrent()).input, validateDesign(sharedDesign()));
  assert.equal((await revisionFile(f.root, first.current.revisionId).list()).length, 1);
  const reloaded = new HumanLoopDesigner({ owner: f.owner, store: f.store, verifyOwnership: f.verifyOwnership });
  assert.deepEqual(await reloaded.publish({ packet: f.packet, result, previous: none }), first);
  assert.equal((await revisionFile(f.root, first.current.revisionId).list()).length, 1);
  await f.dispatch("host", "apply-result", { resultId: result.resultId, designPublication: first });
  const state = await f.store.load();
  assert.equal(state.activeTask, null);
  assert.equal(state.cycles.length, 0);
  assert.equal(state.handoffs.length, 1);
  assert.deepEqual(state.design, first.current);
  await assert.rejects(f.publish(result), /active task/);
  assert.equal(await readFile(resolve(f.root, "app.js"), "utf8"), "export const retainedDirtyCode = 2;\n");
  assert.equal(await readFile(resolve(f.root, "TANDEM.md"), "utf8"), "Existing implementation index.\n");
});

test("unchanged outcome keeps the actual revision/digest and still hands off", async (t) => {
  const f = await fixture(t, { initial: true });
  const result = unchanged(f.packet);
  await f.adapter.validateOutcome(f.packet, result);
  await f.finish(f.packet, result);
  await f.dispatch("host", "apply-result", { resultId: result.resultId, designPublication: null });
  assert.deepEqual(await f.adapter.read(), f.design);
  const state = await f.store.load();
  assert.equal(state.handoffs.length, 1);
  assert.equal(state.cycles.length, 0);
  await assert.rejects(f.publish(result), /Only a changed Design/);
});

test("revision retains immutable history and resolves exact artifact, box and connection references", async (t) => {
  const f = await fixture(t, { initial: true });
  const output = sharedDesign();
  output.summary = "Clarified source requirements.";
  output.outcomes[0].references = ["interaction", "interaction#deliver", "interaction#handoff-result"];
  const previousFile = revisionFile(f.root, f.design.binding.revisionId);
  const previousBytes = await previousFile.read();
  assert.equal(f.design.content.schemaVersion, "sketch-design/v1");
  assert.equal(f.design.binding.digest, policyHash(legacySharedDesign()));
  const { artifactRef } = await f.stage(output);
  const result = changed(f.packet, artifactRef);
  await f.adapter.validateOutcome(f.packet, result);
  await f.finish(f.packet, result);
  const publication = await f.publish(result);
  assert.deepEqual(publication.previous, f.design.binding);
  assert.notEqual(publication.current.revisionId, f.design.binding.revisionId);
  const current = await f.adapter.read();
  assert.deepEqual(current.content, validateDesign(output));
  assert.equal(current.content.schemaVersion, "sketch-design/v3");
  assert.equal(publication.current.digest, policyHash(output));
  for (const [reference, kind] of [["interaction", "artifact"], ["interaction#deliver", "box"], ["interaction#handoff-result", "connection"]]) {
    assert.equal(current.references.find((item) => item.reference === reference)?.kind, kind);
  }
  assert.deepEqual(await f.adapter.readRevision(f.design.binding), f.design);
  assert.equal(await previousFile.read(), previousBytes);
  assert.equal((await f.adapter.readRevision(f.design.binding)).binding.digest, policyHash(legacySharedDesign()));
  assert.equal((await previousFile.list()).length, 2);
  const head = JSON.parse(await headFile(f.root).read());
  assert.equal(head.schemaVersion, "sketch-design-head/v1");
  assert.deepEqual(head.current, publication.current);
  assert.deepEqual(head.previous, f.design.binding);
  const revision = await f.artifacts.readRevision(publication.current);
  assert.equal(revision.schemaVersion, "sketch-design-revision/v1");
  assert.equal(head.publishedAt, revision.proposedAt);
  await assert.rejects(f.adapter.readRevision({ ...f.design.binding, digest: "b".repeat(64) }), /content/);
  await assert.rejects(f.adapter.readRevision({ revisionId: randomUUID(), digest: f.design.binding.digest }), /missing/);
  await assert.rejects(f.adapter.readRevision(none), /exact published/);
});

test("new staging requires v3 without rewriting a retained v1 revision", async (t) => {
  const f = await fixture(t, { initial: true });
  const [tool] = f.adapter.tools(), context = { task: f.packet };
  const before = await canonicalEvidence(f.root);
  assert.equal(tool.parameters.properties.schemaVersion.const, "sketch-design/v3");
  assert.deepEqual(tool.parameters.properties.artifacts.items.oneOf.map(schema => schema.properties.schemaVersion.const),
    ["artifact/v1", "artifact/v2", "sketch/v2", "sketch/v1"]);
  await assert.rejects(tool.validate(legacySharedDesign(), context), { code: "version" });
  await assert.rejects(tool.execute(legacySharedDesign(), context), { code: "version" });
  assert.deepEqual(await canonicalEvidence(f.root), before);
  assert.deepEqual(await f.adapter.readRevision(f.design.binding), f.design);
});

test("invalid generic references, layout and unexpected fields are recoverable before acceptance", async (t) => {
  const f = await fixture(t);
  for (const ref of ["..\\manifest.json", "human-design:" + "b".repeat(64)]) {
    await assert.rejects(f.adapter.validateOutcome(f.packet, changed(f.packet, ref)), /reference|does not exist/);
  }
  const invalid = sharedDesign();
  invalid.artifacts[0].connections[0].to = "missing";
  await assert.rejects(f.stage(invalid), /missing|endpoint/i);
  const anchor = sharedDesign();
  anchor.outcomes[0].references = ["interaction#missing"];
  await assert.rejects(f.stage(anchor), /reference/i);
  const claim = sharedDesign();
  claim.artifacts[0].boxes[0].implementationState = "implemented";
  await assert.rejects(f.stage(claim), /unknown|additional|implementationState/i);
  const fields = sharedDesign();
  fields.applyApproval = true;
  await assert.rejects(f.stage(fields), /unknown|additional|applyApproval/i);
  const { artifactRef } = await f.stage();
  await f.adapter.validateOutcome(f.packet, changed(f.packet, artifactRef));
  assert.equal((await f.store.load()).activeTask.result, null);
  assert.equal(await f.artifacts.inspectCurrent(), null);
});

test("task, input and previous binding mismatches cannot stage, validate or publish", async (t) => {
  const f = await fixture(t);
  const { artifactRef } = await f.stage(), result = changed(f.packet, artifactRef);
  for (const change of [{ id: "another-task" }, { design: { revisionId: "other", digest: "b".repeat(64) } }]) {
    const { inputDigest, ...identity } = f.packet.binding;
    const packet = createHumanTask({ ...identity, ...change }, f.packet.context);
    await assert.rejects(f.stage(sharedDesign(), packet), /active task/);
    await assert.rejects(f.adapter.validateOutcome(packet, changed(packet, artifactRef)), /active task/);
  }
  const mutated = structuredClone(f.packet);
  mutated.context.instructions.push("Different input.");
  await assert.rejects(f.stage(sharedDesign(), mutated), /context digest/);
  await assert.rejects(f.adapter.validateOutcome(f.packet, { ...result, inputDigest: "b".repeat(64) }), /input digest/);
  await f.finish(f.packet, result);
  await assert.rejects(f.publish(result, { revisionId: "stale", digest: "c".repeat(64) }), /previous binding/);
  await assert.rejects(f.publish({ ...result, resultId: "other-result" }), /exact saved result/);
  assert.equal(await f.artifacts.inspectCurrent(), null);
});

test("publication requires a recorded result and rejects stopped, unknown and revoked work", async (t) => {
  const f = await fixture(t);
  const { artifactRef } = await f.stage(), result = changed(f.packet, artifactRef);
  await assert.rejects(f.publish(result), /exact saved result/);
  await f.dispatch("agent", "submit-result", result);
  await assert.rejects(f.publish(result), /exact saved result/);
  const state = await f.store.load();
  const denied = (patch) => new HumanLoopDesigner({ owner: f.owner, verifyOwnership: f.verifyOwnership,
    store: { load: async () => ({ ...state, ...patch }) } });
  await assert.rejects(denied({ stop: { id: "stop" } }).publish({ packet: f.packet, result, previous: none }), /stopped/);
  await assert.rejects(denied({ uncertainty: { reason: "Lost native ownership." } }).publish({ packet: f.packet, result, previous: none }), /uncertain/);
  await assert.rejects(denied({ activeTask: { ...state.activeTask, condition: "unknown" } }).publish({ packet: f.packet, result, previous: none }), /usable owned/);
  f.revoke();
  await assert.rejects(f.publish(result), /Ownership was revoked/);
  assert.equal(await f.artifacts.inspectCurrent(), null);
});

test("saved Designer result publishes without any native-end record", async t => {
  const f = await fixture(t), input = multiFormatDesign();
  const { artifactRef } = await f.stage(input), result = changed(f.packet, artifactRef);
  await f.dispatch("agent", "complete-role-result", result);
  await f.dispatch("host", "record-result-snapshot", {
    taskId: f.packet.binding.id, resultId: result.resultId, snapshot: baseline,
  });
  assert.equal((await f.store.load()).activeTask.end, null);
  const publication = await f.publish(result);
  assert.ok(publication);
  assert.deepEqual((await f.adapter.read()).content, validateDesign(input));
  assert.equal(await readFile(resolve(f.root, "app.js"), "utf8"), "export const retainedDirtyCode = 2;\n");
});

test("canonical revision drift rejects unchanged and staged publication", async (t) => {
  const f = await fixture(t, { initial: true });
  const { artifactRef } = await f.stage(), result = changed(f.packet, artifactRef);
  await driftCanonical(f);
  await assert.rejects(f.adapter.validateOutcome(f.packet, unchanged(f.packet)), /prior revision and digest/);
  await assert.rejects(f.adapter.validateOutcome(f.packet, result), /prior revision and digest/);
  await f.finish(f.packet, result);
  const drifted = await f.adapter.read();
  await assert.rejects(f.publish(result), /Canonical Design changed/);
  assert.deepEqual(await f.adapter.read(), drifted);
});

test("publication preparation is durable, failed promotion rolls back, and exact retry reuses its revision", async (t) => {
  const f = await fixture(t);
  const { artifactRef } = await f.stage(), result = changed(f.packet, artifactRef);
  await f.finish(f.packet, result);
  let checks = 0;
  const failing = new HumanLoopDesigner({ owner: f.owner, store: f.store, verifyOwnership: async () => {
    if (++checks === 3) throw new Error("Ownership lost at promotion checkpoint.");
  } });
  await assert.rejects(failing.publish({ packet: f.packet, result, previous: none }), /promotion checkpoint/);
  assert.equal(await f.artifacts.inspectCurrent(), null);
  const file = new HostStateFile(f.root, resolve(f.root, ".tandem", "living-canvas", "human-loop", "design",
    `${artifactRef.slice("human-design:".length)}.receipt.json`));
  const receipt = JSON.parse(await file.read());
  assert.equal(receipt.schemaVersion, "human-design-receipt/v2");
  assert.deepEqual(Object.keys(receipt.application).sort(), ["designDigest", "id", "proposedAt"]);
  assert.equal(receipt.application.designDigest, policyHash(validateDesign(sharedDesign())));
  assert.equal(receipt.publication, null);
  const publication = await f.publish(result);
  assert.equal(publication.current.revisionId, receipt.application.id);
  assert.deepEqual(await f.publish(result), publication);
});

test("artifact tampering and cancelled staging leave canonical content untouched", async (t) => {
  const f = await fixture(t);
  const signal = AbortSignal.abort(new Error("Cancelled staging."));
  await assert.rejects(f.stage(sharedDesign(), f.packet, signal), /Cancelled/);
  const { artifactRef } = await f.stage(), result = changed(f.packet, artifactRef);
  const file = new HostStateFile(f.root, resolve(f.root, ".tandem", "living-canvas", "human-loop", "design",
    `${artifactRef.slice("human-design:".length)}.json`), undefined, { artifact: true });
  await file.mutate("test-corrupt-artifact", (content) => {
    const artifact = JSON.parse(content);
    artifact.output.summary = "Tampered staged output.";
    return { content: JSON.stringify(artifact), result: null };
  });
  await assert.rejects(f.adapter.validateOutcome(f.packet, result), /integrity/);
  assert.equal(await f.artifacts.inspectCurrent(), null);
});

test("an intact artifact from another binding and a checksummed invalid proposal cannot be accepted", async (t) => {
  const f = await fixture(t);
  const { artifactRef } = await f.stage();
  const originalFile = new HostStateFile(f.root, resolve(f.root, ".tandem", "living-canvas", "human-loop", "design",
    `${artifactRef.slice("human-design:".length)}.json`), undefined, { artifact: true });
  const original = JSON.parse(await originalFile.read());
  assert.equal(original.schemaVersion, "human-design-artifact/v2");
  for (const [mutate, expected] of [
    [(artifact) => { artifact.binding.id = "another-task"; }, /another task/],
    [(artifact) => { artifact.binding.inputDigest = "b".repeat(64); }, /another task/],
    [(artifact) => { artifact.binding.design = { revisionId: "other", digest: "c".repeat(64) }; }, /another task/],
    [(artifact) => { artifact.output.outcomes[0].references = ["interaction#missing"]; }, /reference/i],
    [(artifact) => { artifact.previousContent = sharedDesign(); }, /prior content/i],
    [(artifact) => { artifact.ownerDigest = "b".repeat(64); }, /ownership/i],
  ]) {
    const artifact = structuredClone(original);
    mutate(artifact);
    const id = policyHash(artifact);
    const file = new HostStateFile(f.root, resolve(f.root, ".tandem", "living-canvas", "human-loop", "design", `${id}.json`),
      undefined, { artifact: true });
    await file.mutate("test-untrusted-artifact", () => ({ content: JSON.stringify(artifact), result: null }));
    await assert.rejects(f.adapter.validateOutcome(f.packet, changed(f.packet, `human-design:${id}`)), expected);
  }
  await f.adapter.validateOutcome(f.packet, changed(f.packet, artifactRef));
  assert.equal(await f.artifacts.inspectCurrent(), null);
});

test("mismatched or stopped native end cannot authorize publication and replay cannot overwrite newer content", async (t) => {
  const f = await fixture(t);
  const { artifactRef } = await f.stage(), result = changed(f.packet, artifactRef);
  await f.finish(f.packet, result);
  const state = await f.store.load();
  for (const patch of [{ taskId: "another-task" }, { dispatchId: "another-dispatch" }, { sessionId: "other" },
    { messageId: "other" }, { interactionId: "other" }, { quiescent: false },
    { termination: "user-stop", abortAcknowledged: true }]) {
    const adapter = new HumanLoopDesigner({ owner: f.owner, verifyOwnership: f.verifyOwnership,
      store: { load: async () => ({ ...state, activeTask: { ...state.activeTask, end: { ...state.activeTask.end, ...patch } } }) } });
    await assert.rejects(adapter.publish({ packet: f.packet, result, previous: none }), /execution binding|owned end/i);
  }
  const first = await f.publish(result);
  await driftCanonical(f);
  const newer = await f.adapter.read();
  assert.notEqual(newer.binding.revisionId, first.current.revisionId);
  assert.notEqual(newer.binding.digest, first.current.digest);
  await assert.rejects(f.publish(result), /Canonical Design changed/);
  assert.deepEqual(await f.adapter.read(), newer);
});

test("semantic preflight is read-only and a corrected same-task call can stage without accepting a result", async (t) => {
  const f = await fixture(t);
  const [tool] = f.adapter.tools(), context = { task: f.packet, toolCallId: "preflight" };
  const invalid = sharedDesign();
  invalid.outcomes[0].references = ["interaction#missing"];
  validatePolicyShape(tool.parameters, invalid);
  const before = await fileEvidence(f.root), state = await f.store.load();
  await assert.rejects(tool.validate(invalid, context), /Unknown Design reference: interaction#missing/);
  assert.deepEqual(await fileEvidence(f.root), before);
  assert.deepEqual(await f.store.load(), state);
  assert.equal(await tool.validate(sharedDesign(), context), undefined);
  assert.deepEqual(await fileEvidence(f.root), before);
  assert.deepEqual(await f.store.load(), state);
  await assert.rejects(tool.execute(invalid, context), /Unknown Design reference: interaction#missing/);
  assert.deepEqual(await fileEvidence(f.root), before);
  const staged = await tool.execute(sharedDesign(), context);
  assert.match(staged.artifactRef, /^human-design:[a-f0-9]{64}$/);
  const active = (await f.store.load()).activeTask;
  assert.equal(active.binding.id, f.packet.binding.id);
  assert.equal(active.result, null);
  assert.equal(active.stagedResult, null);
  assert.equal(active.end, null);
  assert.equal(await f.artifacts.inspectCurrent(), null);
});

test("preflight retains schema, exact references, layout feasibility and stable identity guards", async (t) => {
  const f = await fixture(t, { initial: true });
  const [tool] = f.adapter.tools(), context = { task: f.packet };
  const before = await fileEvidence(f.root);
  for (const [mutate, expected] of [
    [(output) => { output.artifacts[0].connections[0].to = "missing"; }, /missing|endpoint/i],
    [(output) => { output.outcomes[0].references = ["missing"]; }, /reference/i],
    [(output) => { output.outcomes[0].references = ["other#deliver"]; }, /reference/i],
    [(output) => { output.outcomes[0].references = ["interaction#deliver#accept"]; }, /Invalid ID/i],
    [(output) => { output.outcomes[0].references = ["interaction#deliver", "interaction#deliver"]; }, /unique/i],
    [(output) => { output.artifacts.push(structuredClone(output.artifacts[0])); }, /unique/i],
    [(output) => { delete output.outcomes; }, /outcomes/i],
    [(output) => { output.artifacts[0].boxes[1].x = 0; }, /overlap/i],
    [reuseConnectionAsBox, /identity/i],
    [(output) => { output.artifacts[0].boxes[0].implementationState = "verified"; }, /unknown|additional|implementationState/i],
    [(output) => { output.approval = "accepted"; }, /unknown|additional|approval/i],
  ]) {
    const output = sharedDesign();
    mutate(output);
    await assert.rejects(tool.validate(output, context), expected);
  }
  assert.equal(await tool.validate(sharedDesign(), context), undefined);
  assert.deepEqual(await fileEvidence(f.root), before);
  assert.deepEqual(await f.adapter.read(), f.design);
});

test("preflight checks exact ownership, task/input, cancellation, staging window and current Design binding", async (t) => {
  const f = await fixture(t, { initial: true });
  const [tool] = f.adapter.tools(), output = sharedDesign();
  const before = await fileEvidence(f.root);
  const { inputDigest, ...identity } = f.packet.binding;
  const wrong = createHumanTask({ ...identity, id: "another-task" }, f.packet.context);
  await assert.rejects(tool.validate(output, { task: wrong }), /active task/);
  const mutated = structuredClone(f.packet);
  mutated.context.instructions.push("Unbound context.");
  await assert.rejects(tool.validate(output, { task: mutated }), /context digest/);
  await assert.rejects(tool.validate(output, { task: f.packet, signal: AbortSignal.abort(new Error("Preflight cancelled.")) }), /cancelled/);
  const state = await f.store.load();
  for (const patch of [
    { stop: { id: "stop" } }, { uncertainty: { reason: "Unknown." } }, { owner: { ...f.owner, id: "other-owner" } },
    { activeTask: { ...state.activeTask, condition: "ended" } },
    { activeTask: { ...state.activeTask, result: unchanged(f.packet) } },
  ]) {
    const adapter = new HumanLoopDesigner({ owner: f.owner, verifyOwnership: f.verifyOwnership,
      store: { load: async () => ({ ...state, ...patch }) } });
    await assert.rejects(adapter.tools()[0].validate(output, { task: f.packet }), /stopped|uncertain|changed|window/);
  }
  assert.deepEqual(await fileEvidence(f.root), before);
  await tool.validate(output, { task: f.packet });
  await driftCanonical(f);
  const drifted = await fileEvidence(f.root);
  await assert.rejects(tool.validate(output, { task: f.packet }), /prior binding/);
  await assert.rejects(tool.execute(output, { task: f.packet }), /prior binding/);
  assert.deepEqual(await fileEvidence(f.root), drifted);
  f.revoke();
  await assert.rejects(tool.validate(output, { task: f.packet }), /Ownership was revoked/);
  assert.deepEqual(await fileEvidence(f.root), drifted);
});

test("preflight never initializes metadata or a WAL in a workspace without a Design", async (t) => {
  const f = await fixture(t);
  const root = resolve(f.root, "preflight-only");
  await mkdir(root);
  await writeFile(resolve(root, "app.js"), "Existing code.\n");
  const owner = { ...f.owner, workspacePath: root }, state = { ...await f.store.load(), owner };
  const adapter = new HumanLoopDesigner({ owner, verifyOwnership: f.verifyOwnership, store: { load: async () => state } });
  const before = await fileEvidence(root), [tool] = adapter.tools(), output = sharedDesign();
  const original = structuredClone(output);
  assert.equal(await tool.validate(output, { task: f.packet }), undefined);
  assert.deepEqual(output, original);
  assert.deepEqual(await fileEvidence(root), before);
  assert.deepEqual(await readdir(root), ["app.js"]);
});

test("Designer layout and reference rejection is actionable and correctable on the same uncompleted task", async (t) => {
  const f = await fixture(t);
  const [tool] = f.adapter.tools();
  const context = { task: f.packet, toolCallId: "call_Vmbp6ic3ZoWH6XcZh5irFDZs" };
  const output = sharedDesign();
  output.artifacts[0].boxes[1].x = 0;
  output.outcomes[0].references = ["interaction#missing"];
  validatePolicyShape(tool.parameters, output);
  const before = await fileEvidence(f.root), state = await f.store.load();
  await assert.rejects(tool.validate(output, context), /overlap/i);
  assert.deepEqual(await fileEvidence(f.root), before);
  assert.deepEqual(await f.store.load(), state);
  output.artifacts[0].boxes[1].x = 23;
  await assert.rejects(tool.validate(output, context), /Unknown Design reference: interaction#missing/);
  output.outcomes[0].references = ["interaction#deliver"];
  assert.equal(await tool.validate(output, context), undefined);
  assert.deepEqual(await fileEvidence(f.root), before);
  assert.deepEqual(await f.store.load(), state);
  const { artifactRef } = await tool.execute(output, context);
  await f.adapter.validateOutcome(f.packet, changed(f.packet, artifactRef));
  assert.deepEqual(await f.store.load(), state);
  assert.equal(state.activeTask.stagedResult, null);
  assert.equal(state.activeTask.result, null);
  assert.equal(state.activeTask.end, null);
  assert.deepEqual(await f.adapter.read(), { binding: none, content: null, references: [] });
});

test("publication failure rolls back head and revision while preserving the prepared receipt for exact retry", async (t) => {
  const f = await fixture(t, { initial: true });
  const output = sharedDesign();
  output.summary = "Atomic revision replacement.";
  const { artifactRef } = await f.stage(output), result = changed(f.packet, artifactRef);
  await f.finish(f.packet, result);
  const before = await canonicalEvidence(f.root);
  const publish = HumanLoopDesignStore.prototype.publish;
  HumanLoopDesignStore.prototype.publish = async function (args) {
    await publish.call(this, args);
    throw new Error("Injected failure after canonical writes.");
  };
  try {
    await assert.rejects(f.publish(result), /Injected failure/);
  } finally {
    HumanLoopDesignStore.prototype.publish = publish;
  }
  assert.deepEqual(await canonicalEvidence(f.root), before);
  assert.deepEqual(await f.adapter.read(), f.design);
  const receiptFile = new HostStateFile(f.root, resolve(f.root, ".tandem", "living-canvas", "human-loop", "design",
    `${artifactRef.slice("human-design:".length)}.receipt.json`));
  const prepared = JSON.parse(await receiptFile.read());
  assert.equal(prepared.publication, null);
  const publication = await f.publish(result);
  assert.equal(publication.current.revisionId, prepared.application.id);
  assert.deepEqual(JSON.parse(await receiptFile.read()).publication, publication);
});

test("same-revision digest drift and corrupted immutable content cannot pass stale guards", async (t) => {
  const f = await fixture(t, { initial: true });
  const { artifactRef } = await f.stage(), result = changed(f.packet, artifactRef);
  const headDocument = headFile(f.root), revisionDocument = revisionFile(f.root, f.design.binding.revisionId);
  const head = JSON.parse(await headDocument.read()), revision = JSON.parse(await revisionDocument.read());
  revision.input.summary = "Untrusted same-revision content.";
  await revisionDocument.mutate("test-corrupt-revision", () => ({ content: JSON.stringify(revision), result: null }));
  await assert.rejects(f.adapter.read(), /content/);
  await assert.rejects(f.adapter.readRevision(f.design.binding), /content/);
  head.current.digest = policyHash(validateDesign(revision.input));
  await headDocument.mutate("test-corrupt-head", () => ({ content: JSON.stringify(head), result: null }));
  const drifted = await f.adapter.read();
  assert.equal(drifted.binding.revisionId, f.design.binding.revisionId);
  assert.notEqual(drifted.binding.digest, f.design.binding.digest);
  await assert.rejects(f.adapter.tools()[0].validate(sharedDesign(), { task: f.packet }), /prior binding/);
  await assert.rejects(f.adapter.validateOutcome(f.packet, unchanged(f.packet)), /prior revision and digest/);
  await assert.rejects(f.adapter.validateOutcome(f.packet, result), /prior revision and digest/);
  await f.finish(f.packet, result);
  await assert.rejects(f.publish(result), /Canonical Design changed/);
  assert.deepEqual(await f.adapter.read(), drifted);
});

test("unsupported canonical manifests fail visibly without clearing or converting durable content", async (t) => {
  const f = await fixture(t, { initial: true });
  const headDocument = headFile(f.root);
  for (const schemaVersion of ["backbone-manifest/v1", "sketch-design-head/v2"]) {
    await headDocument.mutate("test-unsupported-head", () => ({
      content: JSON.stringify({ schemaVersion, retained: "Do not clear." }), result: null,
    }));
    const before = await fileEvidence(f.root);
    await assert.rejects(f.adapter.read(), /Unsupported canonical Design format.*no conversion or clearing/);
    await assert.rejects(f.adapter.tools()[0].validate(sharedDesign(), { task: f.packet }), /Unsupported canonical Design format/);
    await assert.rejects(f.stage(), /Unsupported canonical Design format/);
    assert.deepEqual(await fileEvidence(f.root), before);
  }
});
