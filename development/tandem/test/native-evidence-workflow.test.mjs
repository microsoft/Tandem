import assert from "node:assert/strict";
import test from "node:test";
import { access, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { awaitWorkflowProvider, collectScopedEvidence, createReviewCollector, createReviewWorkflow, parseEvidenceScopes,
  privateReviewRegistration, stageReviewProvider } from "../src/native-evidence-workflow.mjs";
import { createHumanTask } from "../src/human-loop-task.mjs";

const packet = createHumanTask({
  id: "review", dispatchId: "dispatch", sessionId: "private", requestId: "request", role: "reviewer",
  cycleId: "cycle", internalTaskId: null, before: { id: "snapshot", digest: "a".repeat(64) },
  design: { revisionId: "design", digest: "b".repeat(64) },
}, { design: "Exact complete Design", implementation: "Exact implementation context" });

test("private workflow registration contributes no canvas, hooks or second runtime", () => {
  const register = (environment) => privateReviewRegistration(value => value, () => ({ sessionId: "private" }), environment);
  assert.equal(register({}), null);
  assert.throws(() => register({ TANDEM_PRIVATE_WORKFLOW_SESSION: "private", SESSION_ID: "foreign" }), /another native session/);
  const result = register({ TANDEM_PRIVATE_WORKFLOW_SESSION: "private", SESSION_ID: "private" });
  assert.deepEqual(Object.keys(result).sort(), ["tools", "workflows"]);
  assert.equal(result.workflows[0].meta.name, "tandem-review-scopes");
  assert.equal(result.tools[0].name, "tandem_collect_review_scopes");
});

test("session-owned private bootstrap is idempotent and refuses unrelated retained extensions", async t => {
  const root = await mkdtemp(join(tmpdir(), "tandem-review-bootstrap-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspacePath = join(root, "private");
  await mkdir(workspacePath);
  const source = join(root, "extension.mjs");
  await writeFile(source, "// Controlled fixture, never loaded.");
  await stageReviewProvider({ workspacePath }, source);
  const path = join(workspacePath, "extensions", "tandem", "extension.mjs");
  const bytes = await readFile(path, "utf8");
  assert.match(bytes, /^import "file:/);
  await stageReviewProvider({ workspacePath }, source);
  assert.equal(await readFile(path, "utf8"), bytes);
  await writeFile(path, "// Unrelated retained extension");
  await assert.rejects(stageReviewProvider({ workspacePath }, source), /nothing was overwritten/);
  assert.equal(await readFile(path, "utf8"), "// Unrelated retained extension");
});

test("private bootstrap refuses an aliased extensions directory before writing through it", async t => {
  const root = await mkdtemp(join(tmpdir(), "tandem-review-alias-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspacePath = join(root, "private"), other = join(root, "other"), source = join(root, "extension.mjs");
  await mkdir(workspacePath); await mkdir(other); await writeFile(source, "// Never executed.");
  await symlink(other, join(workspacePath, "extensions"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(stageReviewProvider({ workspacePath }, source), /aliased/);
  await assert.rejects(access(join(other, "tandem")), { code: "ENOENT" });
});

test("factory delegates all seven scopes to native scheduling with a concurrency-only cap and distinct labels", async () => {
  const factory = createReviewWorkflow(value => value);
  assert.deepEqual(factory.meta.limits, { maxConcurrentSubagents: 3 });
  const scopes = Array.from({ length: 7 }, (_, i) => ({ id: `scope-${i}`, prompt: "Identical independent inquiry" }));
  const calls = [];
  let parallelCalls = 0;
  const result = await factory.run({
    args: { scopes, packet, toolCallId: "native-call" }, session: { sessionId: "private" },
    phase: title => assert.equal(title, "Collect scoped evidence"),
    parallel: thunks => { parallelCalls++; assert.equal(thunks.length, 7); return Promise.all(thunks.map(thunk => thunk())); },
    agent: async (prompt, options) => {
      assert.deepEqual(Object.keys(options).sort(), ["agent", "label"]);
      assert.equal(options.agent, "tandem-review-scope");
      assert.ok(prompt.includes(JSON.stringify(packet)));
      calls.push(options.label);
      return options.label === "scope-2" ? null : `Evidence for ${options.label}`;
    },
  });
  assert.equal(parallelCalls, 1, "Tandem must not implement its own batching/refill scheduler.");
  assert.equal(new Set(calls).size, 7);
  assert.deepEqual(result.binding, packet.binding);
  assert.equal(result.toolCallId, "native-call");
  assert.equal(result.scopes[2].evidence, null);
  assert.equal(result.scopes.filter(scope => scope.evidence !== null).length, 6);
});

test("factory rejects altered parent context, wrong sessions, duplicate scopes and unbound invocations", async () => {
  const factory = createReviewWorkflow(value => value);
  const args = { scopes: [{ id: "one", prompt: "Inspect" }], packet, toolCallId: "call" };
  const ctx = { args, session: { sessionId: "private" } };
  await assert.rejects(factory.run({ ...ctx, args: { scopes: args.scopes } }), /exactly these fields/);
  await assert.rejects(factory.run({ ...ctx, session: { sessionId: "foreign" } }), /exact owned/);
  await assert.rejects(factory.run({ ...ctx, args: { ...args,
    packet: { ...packet, context: { design: "substituted" } } } }), /digest changed/);
  assert.throws(() => parseEvidenceScopes([args.scopes[0], args.scopes[0]]), /duplicate/);
  assert.throws(() => parseEvidenceScopes([]), /between one and 4096/);
});

test("hard native failures and cancellation propagate instead of becoming successful empty coverage", async () => {
  const aborted = new Error("Native factory cancelled");
  await assert.rejects(collectScopedEvidence({
    parallel: thunks => Promise.all(thunks.map(thunk => thunk())),
    agent: async () => { throw aborted; },
  }, [{ id: "one", prompt: "Inspect" }], packet, "tandem-review-scope"), error => error === aborted);
});

test("permission-gated collector waits for the native result and disables automatic parent notifications", async () => {
  const pending = Promise.withResolvers(), calls = [];
  const collector = createReviewCollector(() => ({
    sessionId: "private", workflow: { run: async (...args) => { calls.push(args); return pending.promise; } },
  }));
  assert.equal(collector.skipPermission, false);
  const args = { scopes: [{ id: "scope", prompt: "Inspect" }], packet, toolCallId: "call" };
  let returned = false;
  const operation = collector.handler(args).then(result => { returned = true; return result; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(returned, false, "A background-start acknowledgement is not collected evidence.");
  assert.deepEqual(calls, [["tandem-review-scopes", { args,
    notifyOnComplete: false, logPhaseNames: false }]]);
  const run = { runId: "run", status: "completed", result: { binding: packet.binding,
    toolCallId: "call", scopes: [{ id: "scope", evidence: "Read-only evidence" }] } };
  pending.resolve(run);
  assert.deepEqual(await operation, { resultType: "success", textResultForLlm: JSON.stringify(run) });
  const failed = createReviewCollector(() => ({ sessionId: "private",
    workflow: { run: async () => ({ runId: "failed", status: "error", error: "Native failure" }) } }));
  assert.equal((await failed.handler(args)).resultType, "failure");
});

test("bounded startup tolerates failed then starting, but requires a current running provider PID", async () => {
  const observations = ["failed", "running", "starting", "running"];
  let count = 0;
  const tools = { initializeAndValidate: async () => ({}),
    getCurrentMetadata: async () => ({ tools: [{ name: "tandem_collect_review_scopes" }] }) };
  const session = { rpc: { tools, extensions: { list: async () => ({ extensions: [{
    name: "tandem", status: observations[count++], ...(count > 2 ? { pid: 123 } : {}),
  }] }) } } };
  await awaitWorkflowProvider(session, { timeoutMs: 1000, intervalMs: 1 });
  assert.equal(count, 4, "A stale running entry without a current PID must not qualify.");
  await assert.rejects(awaitWorkflowProvider({ rpc: { tools, extensions: { list: async () => ({
    extensions: [{ name: "tandem", status: "failed" }],
  }) } } }, { timeoutMs: 2, intervalMs: 1 }), /did not become ready.*failed/);
  await assert.rejects(awaitWorkflowProvider({ rpc: {} }), /cannot observe/);
  await assert.rejects(awaitWorkflowProvider({ rpc: {
    extensions: { list: async () => ({ extensions: [{ name: "tandem", status: "running", pid: 123 }] }) },
    tools: { ...tools, getCurrentMetadata: async () => ({ tools: [] }) },
  } }, { timeoutMs: 2, intervalMs: 1 }), /collector did not become ready/);
});
