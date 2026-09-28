import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, rm, glob, link } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { HumanLoopRuntime } from "../src/human-loop-runtime.mjs";
import { DEFAULT_POLICY, policyHash, resolvePolicy } from "../runtime-src/domain/workflow/policy.ts";
import { NativeSession, git, waitFor } from "./helpers/native-session-fixture.mjs";
import { sharedDesignV3 as sharedDesign } from "./helpers/shared-design-fixture.mjs";
import { sharedDesignExampleV3 as sharedDesignExample } from "./helpers/shared-design-fixture.mjs";
import { sharedDesign as retainedDesignV1 } from "./helpers/shared-design-fixture.mjs";
import { createHumanLoopProvider, HumanLoopEvents, projectHumanLoopView, projectHumanConversation, projectHumanProgress } from "../src/human-loop-provider.mjs";
import { HostStateFile } from "../runtime-src/domain/host-state-file.ts";
import { PermissionBroker } from "../runtime-src/permissions/permission-broker.ts";
import { openFixtureBrowser, browserAvailable } from "./helpers/browser-fixture.mjs";
import { fileURLToPath } from "node:url";
import { designReferenceCatalog } from "../public/sketch/design-contract.js";
import { HumanLoopStore } from "../src/human-loop-store.mjs";
import { HumanLoopNativeWriter } from "../src/human-loop-native-writer.mjs";
import { decodeRecord } from "../runtime-src/domain/workflow/foundation-storage.ts";
import { WorkflowCommandRunner } from "../src/workflow-command-runner.mjs";
import { validateHumanImplementationAuthorization } from "../runtime-src/domain/human-loop/authorization.ts";

const designContent = sharedDesign();
const design = { binding: { revisionId: "design", digest: policyHash(designContent) }, content: designContent };
const question = { id: "scope", context: "The requested view might change the agreed behavior.",
  question: "Keep the current Design?", whyItMatters: "The interaction would otherwise change.",
  importance: "blocking", options: [
    { id: "keep", label: "Keep the current Design", implication: "Continue the remaining internal work." },
    { id: "change", label: "Change the Design", implication: "Discuss the new behavior." },
  ], allowFreeform: true };
const reviewDecisionQuestion = { ...question,
  context: "view.js only exports a flag instead of accepting the user's request required by interaction#accept.",
  question: "Should implementation accept the request, or should Design explicitly make this a non-interactive demonstration?",
  whyItMatters: "Users cannot perform the agreed request interaction.",
  designRefs: ["interaction#accept"],
  options: [
    { id: "design-word-in-id", resolutionTarget: "implementation",
      label: "Change implementation - accept user requests as the current Design requires",
      implication: "Keep the agreed interaction and correct the code." },
    { id: "fix-word-in-id", resolutionTarget: "design",
      label: "Change Design - describe this as a non-interactive demonstration",
      implication: "Review a changed product goal, with no automatic code changes." },
  ] };
const reviewDecisionFinding = { id: "request-interaction", kind: "design-conformance",
  summary: "The view is a static flag instead of the agreed request interaction.",
  designBasis: "interaction#accept requires accepting the user's request.",
  consequence: "Users cannot perform the agreed request interaction.", evidenceRefs: ["view.js:1"],
  designRefs: ["interaction#accept"], questionId: reviewDecisionQuestion.id };

const observedFiles = new WeakMap();
test("native Stop outcome survives local snapshot failure without claiming interruption failed", async t => {
  const reached = Promise.withResolvers(), release = Promise.withResolvers();
  const f = await fixture(t, async () => { reached.resolve(); await release.promise; });
  try {
    await f.send("stop-snapshot", "Read the current project.");
    await reached.promise;
    t.mock.method(f.runtime.workspace, "capture", async () => { throw new Error("Local snapshot unavailable"); });
    await f.runtime.stop("snapshot-failure", "immediate");
    const readiness = await f.runtime.whenIdle(), state = await f.runtime.state();
    assert.equal(state.stop.nativeResult.interrupted, true);
    assert.match(readiness.reason, /Native Stop responded.*interrupted=true.*local Stop recording failed.*Local snapshot unavailable/);
    assert.equal(f.session.foregroundInterrupted, true);
  } finally { release.resolve(); }
});

for (const failure of ["preparation", "state-read"]) test(`active Close attempts native shutdown despite local ${failure}`, async t => {
  const reached = Promise.withResolvers(), release = Promise.withResolvers();
  const f = await fixture(t, async () => { reached.resolve(); await release.promise; });
  try {
    await f.send("close-active", "Read the current project.");
    await reached.promise;
    if (failure === "state-read") t.mock.method(f.runtime.store, "load", async () => { throw new Error("Local state read failed"); });
    const receipt = await f.runtime.close("active-close", { beforeClose: failure === "preparation"
      ? async () => { throw new Error("Local close preparation failed"); } : undefined });
    assert.equal(receipt.native.closed, true);
    assert.ok(receipt.warnings.some(warning => /Local (state read|close preparation) failed/.test(warning)));
    assert.equal(receipt.schemaVersion, "human-loop-close/v2");
  } finally { release.resolve(); }
});

test("Close with a running attached app and unbound held row does not query the released native registry", async t => {
  const f = await fixture(t, ordinary);
  const packet = { binding: { id: "app-task", role: "agent", requestId: "app-request", cycleId: null } };
  const args = { command: "node fixture-server.mjs", mode: "async", shellId: "fixture-app" };
  let task;
  f.session.rpc.tasks = { list: async () => ({ tasks: task ? [structuredClone(task)] : [] }) };
  const admission = await f.runtime.commands.admit("powershell", args, packet, "close-app");
  task = { type: "shell", id: "fixture-app", command: args.command, status: "running",
    startedAt: new Date().toISOString(), attachmentMode: "attached", executionMode: "background" };
  await f.runtime.commands.settled(admission, {
    type: "tool.execution_complete", timestamp: new Date().toISOString(), data: { success: true, result: { contents: [] } },
  }, true);
  await f.runtime.commands.admit("powershell", { command: "node held.mjs", mode: "sync" }, packet, "held-read");
  const before = await f.runtime.commands.evidenceForCycle(null);
  assert.equal(before.find(row => row.id === admission.entryId).recordedStatus, "running");
  assert.equal(before.find(row => row.id === "native:held-read").controlUnbound, true);
  let registryReads = 0;
  f.runtime.commands.setTaskReader(async () => { registryReads++; throw new Error("Native registry unavailable"); });
  const receipt = await f.runtime.close("close-attached-app");
  assert.equal(receipt.native.saved, true);
  assert.equal(receipt.native.closed, true);
  assert.deepEqual(receipt.warnings, []);
  assert.equal(registryReads, 0);
  assert.deepEqual(await f.runtime.commands.evidenceForCycle(null), before);
});

for (const failure of ["storage", "writer"]) test(`Close preserves a local ${failure} error and releases the writer after command cleanup`, async t => {
  const f = await fixture(t, ordinary), order = [];
  const close = t.mock.method(WorkflowCommandRunner.prototype, "close", async () => {
    order.push("storage");
    if (failure === "storage") throw new Error("Local command storage failed");
  });
  const releaseWriter = f.runtime.commands.releaseWriter.bind(f.runtime.commands);
  const release = t.mock.method(f.runtime.commands, "releaseWriter", () => {
    order.push("writer");
    releaseWriter();
    if (failure === "writer") throw new Error("Local writer release failed");
  });
  try {
    const receipt = await f.runtime.close(`close-${failure}-error`);
    assert.equal(receipt.native.closed, true);
    assert.deepEqual(order, ["storage", "writer"]);
    assert.equal(receipt.warnings.length, 1);
    assert.match(receipt.warnings[0], failure === "storage"
      ? /Command storage did not close cleanly: Local command storage failed/
      : /Writer release failed: Local writer release failed/);
  } finally { close.mock.restore(); release.mock.restore(); }
});

test("Reviewer scope announcements and updates are retained root Conversation before inspection without an approval gate", async t => {
  const announcement = "I will review:\n1. The complete request path: agreed behavior, ownership and unnecessary machinery.";
  const update = "Review scope update:\n2. The data boundary: agreed values and avoidable duplication.";
  const f = await fixture(t, async (packet, session, runtime) => {
    if (packet.binding.role === "router") return route(session, packet, "implement");
    if (packet.binding.role === "reviewer") {
      for (const content of [announcement, update]) {
        session.emit("assistant.message", { messageId: `scope-${content.length}`, content });
        await waitFor(async () => (await runtime.conversation()).some(message => message.role === "reviewer" && message.kind === "assistant"
          && message.content === content), "Retained root announcement before the next inspection.");
        assert.equal((await runtime.state()).activeTask.binding.role, "reviewer");
        await session.call("read_cycle_changes", {});
      }
    }
    return ordinary(packet, session);
  });
  await f.send("announced-review", "Implement the agreed Design.");
  assert.equal((await f.runtime.whenIdle()).status, "ready");
  const conversation = await f.runtime.conversation();
  for (const content of [announcement, update]) assert.equal(conversation.filter(message => message.content === content).length, 1);
  assert.equal(f.handoffs.length, 1);
  assert.deepEqual(f.errors, []);
});

async function readProjectFile(session, path) {
  const content = await session.call("view", { path });
  const digest = createHash("sha256").update(content).digest("hex");
  const reads = observedFiles.get(session) ?? new Map();
  reads.set(digest, content); observedFiles.set(session, reads);
  return { content, digest };
}
async function patchFile(session, { path, expectedDigest, content }) {
  const lines = value => value.replace(/\n$/, "").split("\n");
  const before = expectedDigest === null ? null : observedFiles.get(session)?.get(expectedDigest);
  assert.notEqual(before, undefined, "Fixture patch must use actually observed context.");
  return session.call("apply_patch", `*** Begin Patch\n*** ${before === null ? "Add" : "Update"} File: ${path}\n`
    + (before === null ? "" : `@@\n${lines(before).map(line => `-${line}`).join("\n")}\n`)
    + `${lines(content).map(line => `+${line}`).join("\n")}\n*** End Patch\n`);
}

async function fixture(t, script, { onHandoff, onProgress, autoConfirm = true, permissionHandler, filePermissionHandler, nativeShell, nativeControl, nativePermissionRequired = true, omitCancelledNativeCompletion = false, realDesign = false, initialIndex, initialFiles = {}, readDesign, onStop, reviewGraceMs, reviewExcerptCharacters, beforeAdmission } = {}) {
  const root = await mkdtemp(join(process.cwd(), ".human-loop-runtime-")), project = join(root, "project");
  await mkdir(project); await git(project, "init", "--quiet");
  await writeFile(join(project, ".gitignore"), ".tandem/\n");
  await writeFile(join(project, "original.txt"), "pre-existing code\n");
  for (const [path, content] of Object.entries(initialFiles)) {
    const target = join(project, path);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, content);
  }
  if (initialIndex !== undefined) await writeFile(join(project, "TANDEM.md"), initialIndex);
  await git(project, "add", ".");
  await git(project, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "Fixture");
  await writeFile(join(project, "original.txt"), "pre-existing dirty code\n");
  const policy = reviewGraceMs === undefined && reviewExcerptCharacters === undefined ? DEFAULT_POLICY : resolvePolicy({
    ...(reviewGraceMs === undefined ? {} : { time: { reviewGraceMs } }),
    ...(reviewExcerptCharacters === undefined ? {} : { resources: { reviewExcerptCharacters } }),
  });
  const owner = { schemaVersion: "human-loop-owner/v1", id: "owner", mainSessionId: "main", privateSessionId: "private",
    workspacePath: project, policy };
  let runtime;
  const history = [], handoffs = [], errors = [], runs = [];
  class Session extends NativeSession {
    terminalIdle = true;
    suppressTurnEnd = false;
    turnId = "0";
    constructor() {
      super();
      this.rpc.abort = async input => {
        assert.deepEqual(input, { reason: "remote_command" });
        await this.abort(); return { success: true };
      };
      this.rpc.interruptMainTurn = async input => {
        assert.deepEqual(input, { flushQueued: true });
        this.foregroundInterrupted = true;
        await this.abort(); return { interrupted: true };
      };
      this.rpc.tools = { execute: async ({ name, arguments: args }) => {
        assert.equal(name, "stop_powershell");
        const hook = await this.config.hooks.onPreToolUse({
          sessionId: this.sessionId, toolName: name, toolArgs: args, workingDirectory: project,
        }, { sessionId: this.sessionId });
        assert.notEqual(hook.permissionDecision, "deny", hook.permissionDecisionReason);
        return { resultType: "success" };
      } };
    }
    emit(type, data, overrides = {}) {
      const event = { id: `event-${++this.count}`, type, data, parentId: this.events.at(-1)?.id ?? null, timestamp: new Date().toISOString(), ...overrides };
      if (type !== "assistant.idle") this.events.push(event);
      this.config.onEvent(event);
    }
    async send(options) {
      assert.equal(options.mode, "immediate");
      assert.equal(options.agentMode, "interactive");
      const id = await super.send(options);
      if (options.prompt.startsWith("The user requested Stop for this exact request and role.")) {
        this.stopMessage = { id, prompt: options.prompt };
        if (onStop) {
          const run = this.deliverStop().catch((error) => { errors.push(error); this.emit("session.error", { message: error.message }); });
          runs.push(run);
        }
        return id;
      }
      this.turnId = "0"; this.start();
      this.interactionId = id;
      const packet = JSON.parse(options.prompt.split("\n").at(-1));
      history.push({ role: packet.binding.role, taskId: packet.binding.internalTaskId, requestId: packet.binding.requestId,
        cycleId: packet.binding.cycleId, context: packet.context });
      const run = (async () => {
        await waitFor(async () => (await runtime.state()).activeTask?.interactionId, "owned native start");
        try { await script(packet, this, runtime); }
        catch (error) {
          const state = await runtime.state();
          if (state.stop?.mode === "after-step"
            || (!state.stop && !state.requests.some((request) => request.id === packet.binding.requestId && request.status === "stopped"))) {
            errors.push(error);
            this.emit("session.error", { message: "Fixture model failed." });
          }
        }
      })();
      runs.push(run);
      return id;
    }
    async call(name, args) {
      if (["read_powershell", "list_powershell", "stop_powershell"].includes(name)) {
        const toolCallId = `native-${++this.count}`;
        this.emit("tool.execution_start", { toolCallId, toolName: name, arguments: args, turnId: this.turnId });
        let success = false, result = { contents: [] };
        try {
          const hook = await this.config.hooks.onPreToolUse({
            sessionId: this.sessionId, toolName: name, toolArgs: args, workingDirectory: project,
          }, { sessionId: this.sessionId });
          assert.notEqual(hook.permissionDecision, "deny", hook.permissionDecisionReason);
          assert.equal(hook.modifiedArgs, undefined);
          result = await nativeControl?.(name, args) ?? result;
          success = true;
          return "Fixture native process observation/control completed.";
        } finally {
          this.emit("tool.execution_complete", { toolCallId, success, result,
            turnId: this.turnId, interactionId: this.interactionId });
          await runtime.transport.drain();
        }
      }
      if (name === "powershell") {
        const toolCallId = `native-${++this.count}`;
        this.emit("tool.execution_start", { toolCallId, toolName: name, arguments: args, turnId: this.turnId });
        let success = false, result = { contents: [] };
        try {
          const hook = await this.config.hooks.onPreToolUse({
            sessionId: this.sessionId, toolName: name, toolArgs: args, workingDirectory: project,
          }, { sessionId: this.sessionId });
          assert.notEqual(hook.permissionDecision, "deny", hook.permissionDecisionReason);
          if (nativePermissionRequired) {
            const decision = await this.config.onPermissionRequest({
              kind: "shell", toolCallId, fullCommandText: args.command, intention: "Fixture native command",
              possiblePaths: [], possibleUrls: [],
            }, { sessionId: this.sessionId });
            assert.equal(decision.kind, "approve-once", "Native permission denied");
          }
          if (nativeShell) result = await nativeShell(args, project);
          else {
            assert.equal(args.command, "node --version", "Only the explicit version command is emulated.");
            result = { contents: [{ type: "shell_exit", shellId: args.shellId, exitCode: 0 }], output: process.version };
          }
          success = true;
          return JSON.stringify({ ...result, id: `native:${toolCallId}`, exitCode: result.contents?.[0]?.exitCode ?? null });
        } finally {
          if (!omitCancelledNativeCompletion || !this.foregroundInterrupted) {
            this.emit("tool.execution_complete", { toolCallId, success, result, turnId: this.turnId, interactionId: this.interactionId });
          }
          await runtime.transport.drain();
        }
      }
      if (["view", "glob", "rg", "apply_patch"].includes(name)) {
        const toolCallId = `native-${++this.count}`;
        this.emit("tool.execution_start", { toolCallId, toolName: name, arguments: args, turnId: this.turnId });
        let success = false;
        try {
          const hook = await this.config.hooks.onPreToolUse({ sessionId: this.sessionId, toolName: name, toolArgs: args },
            { sessionId: this.sessionId });
          assert.notEqual(hook.permissionDecision, "deny", hook.permissionDecisionReason);
          const effective = hook.modifiedArgs ?? args;
          const path = name === "apply_patch" ? /^\*\*\* (?:Add|Update) File: (.+)$/m.exec(args)[1]
            : name === "view" ? effective.path : typeof effective.paths === "string" ? effective.paths : effective.paths?.[0] ?? project;
          const decision = await this.config.onPermissionRequest(name === "apply_patch"
            ? { kind: "write", toolCallId, fileName: join(project, path), intention: "Fixture native edit", diff: args, canOfferSessionApproval: false }
            : { kind: "read", toolCallId, path, intention: "Fixture native read" }, { sessionId: this.sessionId });
          assert.equal(decision.kind, "approve-once", "Native permission denied");
          let result;
          if (name === "view") result = await readFile(resolve(project, effective.path), "utf8");
          else if (name === "glob") result = JSON.stringify(await Array.fromAsync(glob(effective.pattern, { cwd: resolve(project, path) })));
          else if (name === "rg") result = await readFile(resolve(project, path), "utf8");
          else {
            const lines = args.split("\n"), body = lines.slice(2, -2);
            const added = body.filter(line => line.startsWith("+")).map(line => line.slice(1)).join("\n") + "\n";
            if (lines[1].startsWith("*** Update")) {
              const removed = body.filter(line => line.startsWith("-")).map(line => line.slice(1)).join("\n") + "\n";
              assert.equal(await readFile(join(project, path), "utf8"), removed, "Native patch context conflict");
            }
            await mkdir(join(project, path, ".."), { recursive: true });
            await writeFile(join(project, path), added);
            result = "Fixture native patch applied.";
          }
          success = true; return result;
        } finally {
          this.emit("tool.execution_complete", { toolCallId, success, turnId: this.turnId, interactionId: this.interactionId });
          await runtime.transport.drain();
        }
      }
      const result = await super.call(name, args);
      this.emit("tool.execution_complete", { toolCallId: `tool-${this.count}`, success: true, turnId: this.turnId,
        interactionId: this.interactionId });
      if (name.startsWith("submit_") && this.stopMessage && !onStop) await this.deliverStop();
      else if (this.config.tools.find(tool => tool.name === name)?.isTerminal) {
        if (!this.suppressTurnEnd) this.emit("assistant.turn_end", { turnId: this.turnId, interactionId: this.interactionId, aborted: false });
        if (this.terminalIdle) this.endIdle();
      }
      return result;
    }
    endIdle() { this.processing = false; this.emit("assistant.idle", { aborted: false }); }
    async deliverStop() {
      const message = this.stopMessage; this.stopMessage = null;
      this.emit("assistant.idle", {});
      this.interactionId = message.id; this.processing = true;
      this.emit("user.message", { content: message.prompt, messageId: message.id, interactionId: message.id, turnId: "0", delivery: "queued" });
      this.emit("assistant.turn_start", { turnId: "0", interactionId: message.id });
      await waitFor(async () => (await runtime.state()).stop?.injection?.delivery, "exact Stop delivery");
      const injection = (await runtime.state()).stop;
      const response = () => this.call("acknowledge_human_stop", { stopId: injection.id, taskId: injection.taskId,
        inputDigest: injection.injection.inputDigest, summary: "Only the actual current-step state is retained.", evidenceRefs: [] });
      if (onStop) await onStop(response, this, runtime);
      else await response();
    }
    async abort() { this.processing = false; this.emit("assistant.idle", { aborted: true }); }
    async disconnect() {}
  }
  const session = new Session();
  runtime = new HumanLoopRuntime({
    configuration: { schemaVersion: "human-loop-runtime/v1", owner, runtimeDirectory: join(root, "runtime"),
      node: { path: process.execPath }, sdk: {}, cli: {}, buildId: "fixture" },
    client: { createSession: async (config) => { session.config = config; return session; }, stop: async () => [],
      rpc: { sessions: { save: async () => {},
        readPersistedEvents: async () => ({ events: structuredClone(session.events), cursorStatus: "ok", hasMore: false }) } } },
    verifyOwnership: async () => {}, verifyAdmission: async () => { await beforeAdmission?.(); },
    ...(realDesign ? {} : { readDesign: readDesign ?? (async () => design) }),
    permissionHandler: (request, invocation, lifetime) => ["read", "write"].includes(request.kind)
      ? filePermissionHandler?.(request, invocation, lifetime) ?? { kind: "approve-once" }
      : permissionHandler?.(request, invocation, lifetime) ?? { kind: "reject" },
    onHandoff: async (handoff) => { handoffs.push(handoff); await onHandoff?.(handoff); },
    onProgress: (event) => {
      const observed = onProgress?.(event);
      if (autoConfirm && event.kind === "implementation-confirmation") {
        runs.push(runtime.state().then(state => {
          const confirmation = state.implementationConfirmations.findLast(c => c.status === "pending");
          return runtime.decideImplementation({ confirmationId: confirmation.id, decision: "approved" });
        }).catch(error => { errors.push(error); }));
      }
      return observed;
    },
  });
  await runtime.open();
  t.after(async () => {
    await Promise.allSettled(runs);
    await runtime.whenIdle();
    try { await runtime.close(); } catch { await runtime.store.close(); }
    await rm(root, { recursive: true, force: true });
  });
  const send = (id, message, answers = null) => runtime.send({ id, message, answers, receivedAt: new Date().toISOString() });
  return { runtime, session, project, history, handoffs, errors, send };
}

export { fixture as createHumanLoopRuntimeFixture };

const submit = (session, packet, name, outcome) => session.call(name, {
  schemaVersion: "human-role-result/v1", resultId: `result:${packet.binding.id}`, inputDigest: packet.binding.inputDigest,
  outcome: outcome.kind === "review-result" ? { reviewFormat: "decision-review/v2", coverageStatus: "complete", ...outcome } : outcome,
});
const route = (session, packet, intent, cycleId = null, resolvedQuestions = []) => submit(session, packet, "submit_human_route", {
  kind: "route", intent, cycleId, resolvedQuestions, summary: "Interpret this exact user request.",
});
const plan = (packet) => ({
  schemaVersion: "internal-plan/v1", id: "internal", version: 1, goal: "Implement both parts.",
  design: packet.context.design.binding, baseline: packet.context.code.current,
  tasks: [
    { id: "engine", title: "Implement engine", scope: ["engine.js"], dependsOn: [], designRefs: ["interaction#deliver"],
      criteria: [{ id: "engine-correct", description: "Engine is implemented and checked." }] },
    { id: "view", title: "Implement view", scope: ["view.js"], dependsOn: ["engine"], designRefs: ["interaction#accept"],
      criteria: [{ id: "view-correct", description: "View integrates with the engine." }] },
  ],
});
async function ordinary(packet, session) {
  const { role, internalTaskId } = packet.binding;
  if (role === "planner") return submit(session, packet, "submit_internal_plan", { kind: "internal-plan", plan: plan(packet) });
  if (role === "implementer" && internalTaskId) {
    await session.call("report_internal_task_progress", { schemaVersion: "human-task-progress/v1", taskId: internalTaskId,
      planDigest: packet.context.cycle.plan.digest, status: "progress", summary: "Implementing the selected task.", evidenceRefs: [] });
    const path = `${internalTaskId}.js`;
    const files = JSON.parse(await session.call("glob", { pattern: "**/*" }));
    const current = files.includes(path) ? await readProjectFile(session, path) : null;
    await patchFile(session, { path, expectedDigest: current?.digest ?? null, content: `export const ${internalTaskId} = true;\n` });
    return submit(session, packet, "submit_internal_task_result", { kind: "task-result", taskId: internalTaskId,
      planDigest: packet.context.cycle.plan.digest, summary: "Internal task reported complete.", evidenceRefs: [path] });
  }
  if (role === "implementer") return submit(session, packet, "submit_implementation_result", {
    kind: "implementation-result", planDigest: packet.context.cycle.plan.digest,
    completedTaskIds: packet.context.cycle.tasks.map(({ id }) => id), summary: "All internal work is complete.", evidenceRefs: ["engine.js", "view.js"],
  });
  if (role === "reviewer") {
    const evidence = JSON.parse(await session.call("read_cycle_changes", {}));
    assert.deepEqual(evidence.changes.map(({ path }) => path).sort(), ["engine.js", "view.js"]);
    return submit(session, packet, "submit_whole_plan_review", {
      kind: "review-result", planDigest: packet.context.cycle.plan.digest, summary: "Both parts were reviewed.",
      assessments: [], findings: [], verificationLimits: [], evidenceRefs: ["engine.js", "view.js"], questions: [],
    });
  }

  if (role === "agent") return submit(session, packet, "submit_readonly_answer", {
    kind: "answer", summary: "The requested status is explained.", report: "Both files are already in the project. Review is a whole-plan outcome, not an Apply request.",
    evidenceRefs: ["engine.js", "view.js"],
  });
  throw new Error(`Unexpected fixture role ${role}`);
}

for (const decision of ["approved", "design", "cancelled"]) test(`implementation confirmation pauses before code evidence and records ${decision} exactly once`,
  { timeout: 60_000 }, async t => {
    const f = await fixture(t, async (packet, session) => {
      if (packet.binding.role === "router") return route(session, packet, packet.context.request.id === "proposal" ? "implement" : "answer");
      if (packet.binding.role === "designer") return submit(session, packet, "submit_designer_outcome", {
        kind: "designer-unchanged", summary: "Design was inspected instead.", explanation: "No code was changed.", questions: [],
      });
      if (packet.context.request.id === "next") assert.equal(packet.context.implementationDecisions[0].status, decision);
      return ordinary(packet, session);
    }, { autoConfirm: false, realDesign: decision === "design", permissionHandler: async () => ({ kind: "approve-once" }) });
    const capture = t.mock.method(f.runtime.workspace, "capture");
    await f.send("proposal", "Let's use AKShare.");
    assert.equal((await f.runtime.whenIdle()).status, "waiting-confirmation");
    assert.deepEqual(f.history.map(h => h.role), ["router"]);
    assert.equal(capture.mock.callCount(), 0, "Neither Planner nor baseline capture may start before human confirmation.");
    const state = await f.runtime.state(), confirmation = state.implementationConfirmations[0];
    assert.equal(state.cycles.length, 0);
    assert.deepEqual(confirmation.requestIds, ["proposal"]);
    await assert.rejects(f.runtime.store.dispatch("host", "bypass", "start-cycle", {
      cycleId: "bypass", design: state.design, baseline: { id: "pretended", digest: "a".repeat(64) },
    }), /Explicit user confirmation/);
    await assert.rejects(f.runtime.store.dispatch("agent", "model-approval", "decide-implementation-confirmation", {
      confirmationId: confirmation.id, decision: "approved", decidedAt: new Date().toISOString(),
    }), /actor/);
    const input = { confirmationId: confirmation.id, decision };
    if (decision === "cancelled") {
      const brokenAudit = t.mock.method(f.runtime.store, "recordMessage", async () => { throw new Error("Audit write failed"); });
      await assert.rejects(f.runtime.decideImplementation(input), /Audit write failed/);
      brokenAudit.mock.restore();
      assert.equal((await f.runtime.state()).implementationConfirmations[0].status, "pending");
      assert.equal((await f.runtime.store.messages()).some(m => m.id === `implementation-decision:${confirmation.id}`), false);
    }
    await Promise.all([f.runtime.decideImplementation(input), f.runtime.decideImplementation(input)]);
    assert.equal((await f.runtime.whenIdle()).status, "ready", f.errors.map(e => e.stack).join("\n"));
    await f.runtime.decideImplementation(input);
    await assert.rejects(f.runtime.decideImplementation({ ...input, decision: decision === "approved" ? "cancelled" : "approved" }), /already decided/);
    assert.deepEqual(f.errors, []);
    assert.equal((await f.runtime.store.messages()).filter(m => m.id === `implementation-decision:${confirmation.id}`).length, 1);
    assert.equal(f.history.filter(h => h.role === "planner").length, decision === "approved" ? 1 : 0);
    if (decision === "cancelled") {
      assert.equal((await f.runtime.state()).requests[0].status, "cancelled");
      assert.deepEqual(f.history.map(h => h.role), ["router"], "Cancel itself must not send a native turn.");
    }
    if (decision === "design") assert.deepEqual(f.history.map(h => h.role), ["router", "designer"]);
    if (decision !== "approved") assert.equal(capture.mock.callCount(), 0);
    await f.send("next", "Explain the decision without changing anything.");
    assert.equal((await f.runtime.whenIdle()).status, "ready", f.errors.map(e => e.stack).join("\n"));
  });

test("mixed explicit Reviewer answers publish Design first, then confirmation binds exact answers to Planner and every Implementer",
  { timeout: 90_000 }, async t => {
    let revision = 0;
    const observed = [];
    const questions = [{ ...reviewDecisionQuestion, id: "freshness" }, { ...reviewDecisionQuestion, id: "retry" }];
    const f = await fixture(t, async (packet, session) => {
      if (packet.binding.role === "router") {
        if (packet.context.request.id === "mixed") {
          validateHumanImplementationAuthorization(await f.runtime.state(), "complete-role-result", {
            schemaVersion: "human-role-result/v1", resultId: "allowed-mixed-stop", inputDigest: packet.binding.inputDigest,
            outcome: { kind: "stopped-partial", stopId: "owned-stop", summary: "Stopped before interpreting mixed answers.", evidenceRefs: [] },
          });
          await assert.rejects(route(session, packet, "implement"), /Mixed Design and implementation answers/);
        }
        return route(session, packet, packet.context.request.id === "initial-build" ? "implement" : "design");
      }
      if (packet.binding.role === "designer") {
        const content = sharedDesign();
        content.summary = `Published revision ${++revision} from the user's exact choices.`;
        const raw = await session.call("stage_human_design", content);
        const staged = typeof raw === "string" ? JSON.parse(raw) : raw;
        return submit(session, packet, "submit_designer_outcome", { kind: "designer-changed", summary: content.summary,
          artifactRef: staged.artifactRef, questions: [] });
      }
      if (packet.binding.role === "reviewer") return submit(session, packet, "submit_whole_plan_review", {
        kind: "review-result", planDigest: packet.context.cycle.plan.digest, summary: "Review the current implementation.",
        assessments: [], findings: packet.context.request.id === "initial-build" ? questions.map(q => ({
          ...reviewDecisionFinding, id: `finding:${q.id}`, questionId: q.id,
        })) : [], verificationLimits: [], evidenceRefs: ["view.js"], questions: packet.context.request.id === "initial-build" ? questions : [],
      });
      if (packet.context.request.id === "mixed" && ["planner", "implementer"].includes(packet.binding.role)) {
        observed.push(packet.binding.role);
        assert.deepEqual(packet.context.questionAnswers.map(a => a.answer.selectedOption.resolutionTarget), ["design", "implementation"]);
        assert.deepEqual(packet.context.recordedQuestionAnswers.map(a => a.answer.selectedOption.label),
          [questions[0].options[1].label, questions[1].options[0].label]);
        assert.equal(packet.context.recordedQuestionAnswers[1].question.question, questions[1].question);
        assert.equal(packet.context.recordedQuestionAnswers[1].answer.selectedOption.implication, questions[1].options[0].implication);
        assert.equal(packet.context.implementationDecisions.at(-1).status, "approved");
        assert.equal(packet.context.design.content.summary, "Published revision 2 from the user's exact choices.");
      }
      return ordinary(packet, session);
    }, { autoConfirm: false, realDesign: true });
    await f.send("design", "Document the existing Design.");
    assert.equal((await f.runtime.whenIdle()).status, "ready", f.errors.map(e => e.stack).join("\n"));
    await f.send("initial-build", "Implement the agreed Design.");
    assert.equal((await f.runtime.whenIdle()).status, "waiting-confirmation");
    await f.runtime.decideImplementation({ confirmationId: (await f.runtime.state()).implementationConfirmations[0].id, decision: "approved" });
    assert.equal((await f.runtime.whenIdle()).status, "waiting-answer", f.errors.map(e => e.stack).join("\n"));
    assert.equal((await f.runtime.state()).questions[0].source.role, "reviewer");
    const source = (await f.runtime.state()).questions[0].source.resultId;
    await f.send("mixed", "Question form submission.", { schemaVersion: "human-question-answers/v1", answers: [
      { questionId: "freshness", sourceResultId: source, kind: "option", value: questions[0].options[1].id },
      { questionId: "retry", sourceResultId: source, kind: "option", value: questions[1].options[0].id },
    ] });
    assert.equal((await f.runtime.whenIdle()).status, "waiting-confirmation", f.errors.map(e => e.stack).join("\n"));
    const state = await f.runtime.state(), confirmation = state.implementationConfirmations.at(-1);
    assert.deepEqual(f.history.filter(h => h.requestId === "mixed").map(h => h.role), ["router", "designer"]);
    assert.equal(state.cycles.length, 1, "The completed original cycle is history; mixed answers must not create a new cycle before confirmation.");
    assert.deepEqual(confirmation.design, (await f.runtime.currentDesign()).binding);
    assert.equal(confirmation.afterDesignResultId, state.handoffs.at(-1).result.resultId);
    await f.runtime.decideImplementation({ confirmationId: confirmation.id, decision: "approved" });
    assert.equal((await f.runtime.whenIdle()).status, "ready", f.errors.map(e => e.stack).join("\n"));
    assert.deepEqual(observed, ["planner", "implementer", "implementer", "implementer"]);
    assert.deepEqual(f.errors, []);
  });

test("approved implementation pauses on presentation failure instead of automatically retrying or replaying work",
  { timeout: 60_000 }, async t => {
    let fail = true, presentations = 0;
    const f = await fixture(t, (packet, session) => packet.binding.role === "router" ? route(session, packet, "implement") : ordinary(packet, session),
      { onHandoff: async () => { presentations++; if (fail) throw new Error("Handoff presentation unavailable"); } });
    await f.send("build", "Implement the agreed Design.");
    assert.equal((await f.runtime.whenIdle()).status, "presentation-pending");
    assert.equal(presentations, 1);
    assert.equal(f.history.filter(h => h.role === "planner").length, 1);
    fail = false; f.runtime.wake();
    assert.equal((await f.runtime.whenIdle()).status, "ready");
    assert.equal(presentations, 2);
    assert.equal(f.history.filter(h => h.role === "planner").length, 1);
    assert.equal(f.history.filter(h => h.role === "reviewer").length, 1);
  });

test("pending confirmation survives durable reload, keeps queued work separate, and Stop invalidates stale clicks",
  { timeout: 60_000 }, async t => {
    const f = await fixture(t, (packet, session) => packet.binding.role === "router" ? route(session, packet, "implement") : ordinary(packet, session),
      { autoConfirm: false });
    await f.send("proposal", "Implement the agreed Design.");
    await f.runtime.whenIdle();
    await f.send("later", "This is an independent later request.");
    const state = await f.runtime.state(), confirmation = state.implementationConfirmations[0];
    const restored = new HumanLoopStore(state.owner);
    try { assert.deepEqual(await restored.load(), state); }
    finally { await restored.close(); }
    assert.deepEqual(confirmation.requestIds, ["proposal"]);
    assert.equal(state.requests[1].status, "waiting");
    await f.runtime.stop("stop-confirmation");
    assert.equal((await f.runtime.whenIdle()).status, "ready", f.errors.map(e => e.stack).join("\n"));
    assert.equal((await f.runtime.state()).implementationConfirmations[0].status, "invalidated");
    await assert.rejects(f.runtime.decideImplementation({ confirmationId: confirmation.id, decision: "approved" }), /invalidated/);
    assert.deepEqual(f.history.map(h => h.role), ["router"]);
  });

for (const queryError of [false, true]) test(`incomplete parent Review keeps implementation and admits queued normal work: query=${queryError}`, { timeout: 30_000 }, async t => {
  let enterReview, releaseReview;
  const reached = new Promise(resolve => { enterReview = resolve; });
  const release = new Promise(resolve => { releaseReview = resolve; });
  const f = await fixture(t, async (packet, session) => {
    if (packet.binding.role === "router") return route(session, packet,
      packet.context.request.id === "build" ? "implement" : "answer");
    if (packet.binding.role === "reviewer") {
      enterReview();
      await release;
      if (queryError) session.emit("session.error", { errorType: "query", message: "Native review query failed." });
      session.emit("assistant.turn_end", { turnId: session.turnId, interactionId: session.interactionId, aborted: false });
      session.endIdle();
      session.emit("session.idle", { mode: "interactive" });
      return;
    }
    return ordinary(packet, session);
  }, { initialIndex: "# Existing notes\n\nKeep recorded findings.\n" });
  await f.send("build", "Implement the agreed Design.");
  await Promise.race([reached, f.runtime.whenIdle().then(view => assert.fail(
    `Review was not reached: ${JSON.stringify({ view, errors: f.errors.map(error => error.message) })}`))]);
  await f.send("next", "Explain the retained implementation.");
  releaseReview();
  await waitFor(() => f.history.filter(entry => entry.role === "reviewer").length === (queryError ? 1 : 2),
    "expected single Reviewer continuation");
  assert.equal((await f.runtime.whenIdle()).status, "ready", f.errors.map(error => error.stack).join("\n"));
  const state = await f.runtime.state();
  assert.equal(state.cycles[0].phase, "completed");
  assert.ok(state.cycles[0].implementationResult);
  assert.equal(state.cycles[0].reviewResult.outcome.kind, "review-incomplete");
  assert.ok(state.cycles[0].tasks.every(task => task.status === "completed"));
  assert.deepEqual(state.requests.map(request => request.status), ["completed", "completed"]);
  assert.deepEqual(f.history.filter(entry => entry.requestId === "next").map(entry => entry.role), ["router", "agent"]);
  assert.match(f.handoffs[0].content, /Review did not complete.*not approval/s);
  assert.equal(await readFile(join(f.project, "TANDEM.md"), "utf8"), "# Existing notes\n\nKeep recorded findings.\n");
  assert.match(await readFile(join(f.project, "engine.js"), "utf8"), /export const engine/);
});

test("Router, Designer and Agent need no whole-workspace snapshot and empty wake creates no request", { timeout: 60_000 }, async t => {
  const f = await fixture(t, async (packet, session) => {
    assert.equal(packet.binding.before, null);
    assert.equal(packet.context.code.current, null);
    if (packet.binding.role === "router") return route(session, packet, packet.binding.requestId === "design" ? "design" : "answer");
    assert.match(await session.call("view", { path: "original.txt" }), /pre-existing dirty/);
    if (packet.binding.role === "designer") return submit(session, packet, "submit_designer_outcome", {
      kind: "designer-unchanged", summary: "No Design revision needed.", explanation: "This is a conversational fixture.", questions: [],
    });
    return ordinary(packet, session);
  }, { realDesign: true });
  const alias = join(f.project, "evidence-alias.txt");
  await link(join(f.project, "original.txt"), alias);
  try {
    await assert.rejects(f.runtime.workspace.capture(), /hardlink/);
    f.runtime.wake(); await f.runtime.whenIdle();
    assert.deepEqual((await f.runtime.state()).requests, []);
    for (const request of ["design", "answer"]) {
      await f.send(request, `Handle the ${request} fixture.`);
      assert.equal((await f.runtime.whenIdle()).status, "ready", f.errors.map(error => error.stack).join("\n"));
    }
    const state = await f.runtime.state();
    assert.deepEqual(f.errors, []);
    assert.ok(state.executions.every(task => task.completion === "result-submission" && task.binding.before === null && task.after === null));
    assert.ok(state.handoffs.every(handoff => handoff.snapshot === null));
    assert.equal((await f.runtime.readiness()).status, "ready");
  } finally { await rm(alias); }
});

test("failed implementation preparation is explicitly not dispatched and does not poison later requests", { timeout: 60_000 }, async t => {
  const f = await fixture(t, async (packet, session) => {
    if (packet.binding.role === "router") return route(session, packet, packet.binding.requestId === "implementation" ? "implement" : "answer");
    assert.equal(packet.binding.role, "agent", "Failed baseline capture must not dispatch Planner.");
    return ordinary(packet, session);
  });
  const capture = f.runtime.workspace.capture.bind(f.runtime.workspace);
  t.mock.method(f.runtime.workspace, "capture", () => { throw new Error("Fixture baseline capture failed."); });
  await f.send("implementation", "Implement the fixture.");
  assert.equal((await f.runtime.whenIdle()).status, "ready");
  let state = await f.runtime.state();
  assert.equal(state.uncertainty, null);
  assert.equal(state.requests[0].status, "rejected");
  assert.match(state.requests[0].rejectionReason, /not dispatched.*Fixture baseline capture failed/);
  assert.deepEqual(f.history.map(entry => entry.role), ["router"]);
  assert.ok((await f.runtime.conversation()).some(message => message.role === "host" && /not dispatched/.test(message.content)));
  await f.send("later", "Explain the current project instead.");
  assert.equal((await f.runtime.whenIdle()).status, "ready");
  state = await f.runtime.state();
  assert.equal(state.requests[1].status, "completed");
  assert.deepEqual(f.errors, []);
  f.runtime.workspace.capture = capture;
});

test("native dependency reads reach ordinary approval independently of snapshot eligibility", { timeout: 60_000 }, async t => {
  const events = new HumanLoopEvents(), permissions = new PermissionBroker(events), decisions = [];
  t.after(() => events.close());
  const f = await fixture(t, async (packet, session, runtime) => {
    if (packet.binding.role === "router") return route(session, packet, "answer");
    const before = await runtime.workspace.capture();
    const snapshot = await runtime.workspace.readSnapshot(before);
    assert.ok(snapshot.files.every(file => !file.path.startsWith("node_modules/")));
    assert.equal(await session.call("view", { path: "node_modules/dependency/package.json" }), '{"name":"fixture"}\n');
    await assert.rejects(session.call("view", { path: "node_modules/dependency/denied.txt" }), /Native permission denied/);
    assert.deepEqual(await runtime.workspace.capture(), before);
    return submit(session, packet, "submit_readonly_answer", {
      kind: "answer", summary: "Dependency inspected with native approval.", report: "Denied content was not read.", evidenceRefs: [],
    });
  }, { initialFiles: {
    "node_modules/dependency/package.json": '{"name":"fixture"}\n',
    "node_modules/dependency/denied.txt": "Denied fixture content\n",
  }, filePermissionHandler: async (request, invocation, lifetime) => {
    const result = permissions.request(request, invocation, lifetime.signal, lifetime);
    const pending = permissions.list()[0];
    assert.ok(pending);
    const denied = request.path.endsWith("denied.txt");
    decisions.push({ path: request.path, denied, role: lifetime.provenance.role });
    await permissions.decide(pending.id, denied ? "denied" : "once");
    return result;
  } });
  await f.send("dependency", "Inspect the dependency.");
  assert.equal((await f.runtime.whenIdle()).status, "ready", f.errors.map(error => error.stack).join("\n"));
  assert.deepEqual(f.errors, []);
  assert.deepEqual(decisions.map(({ role, denied }) => ({ role, denied })),
    [{ role: "agent", denied: false }, { role: "agent", denied: true }]);
  assert.deepEqual(permissions.remembered("private"), { all: false, tools: [] });
});

test("native capabilities retain ordinary permissions while Reviewer admits only read-only inspection", { timeout: 120_000 }, async t => {
  const events = new HumanLoopEvents(), permissions = new PermissionBroker(events), decisions = [], roles = new Set();
  t.after(() => events.close());
  const decide = async (request, invocation, lifetime) => {
    const result = permissions.request(request, invocation, lifetime.signal, lifetime);
    const pending = permissions.list()[0];
    assert.ok(pending, "Native access must reach the ordinary permission broker.");
    assert.equal(pending.canApproveForSession, false);
    const denied = request.fileName?.endsWith("-denied.js") || request.fileName?.endsWith("TANDEM.md")
      || request.fullCommandText === "node denied.mjs";
    decisions.push({ ...lifetime.provenance, kind: request.kind, denied });
    await permissions.decide(pending.id, denied ? "denied" : "once");
    return result;
  };
  const f = await fixture(t, async (packet, session, runtime) => {
    const { role, internalTaskId, requestId, id } = packet.binding;
    roles.add(role === "implementer" ? internalTaskId ? "implementer-task" : "implementer-aggregate" : role);
    const shellId = `role-${session.count}`;
    await session.call("view", { path: "original.txt" });
    await session.call("rg", { pattern: "pre-existing", paths: "original.txt" });
    await session.call("glob", { pattern: "*.txt" });
    if (role === "reviewer") {
      await session.call("list_powershell", {});
      await session.call("read_powershell", { shellId, delay: 5 });
      const prior = decisions.length;
      await assert.rejects(session.call("powershell", { command: "node --version", shellId }), /read-only/);
      await assert.rejects(session.call("stop_powershell", { shellId }), /read-only/);
      await assert.rejects(patchFile(session, { path: "reviewer-native.js", expectedDigest: null, content: "not allowed\n" }), /read-only/);
      assert.equal(decisions.length, prior, "Reviewer cannot request mutation permission.");
      return ordinary(packet, session);
    }
    await session.call("powershell", { command: "node --version", shellId, mode: "async" });
    await session.call("list_powershell", {});
    await session.call("read_powershell", { shellId, delay: 5 });
    await session.call("stop_powershell", { shellId });
    const process = (await runtime.commands.read()).nativeSessions.find(entry => entry.shellId === shellId);
    assert.equal(process.status, "held", "An empty fixture registry cannot prove a current process or a stopped outcome.");
    assert.equal(process.recordedStatus, "running");
    assert.equal(process.controlUnbound, false, "Absent exit metadata must not revoke a known label.");
    assert.match(process.reason, /registry|no completed-stop/);
    assert.equal((await runtime.state()).activeTask.binding.id, id);
    assert.equal((await runtime.state()).stop, null);
    if (role === "designer") {
      await patchFile(session, { path: `${role}-native.js`, expectedDigest: null, content: `export const ${role} = true;\n` });
      await assert.rejects(patchFile(session, { path: `${role}-denied.js`, expectedDigest: null, content: "denied\n" }), /Native permission denied/);
      await assert.rejects(session.call("powershell", { command: "node denied.mjs", shellId: `${shellId}-denied` }), /Native permission denied/);
      const prior = decisions.length;
      await assert.rejects(patchFile(session, { path: "TANDEM.md", expectedDigest: null, content: "not a domain publication\n" }), /Native permission denied/);
      assert.equal(decisions.length, prior + 1, "Even index-file access reaches the native permission decision.");
      const domain = await session.config.hooks.onPreToolUse({ sessionId: session.sessionId,
        toolName: "submit_internal_task_result", toolArgs: {} }, { sessionId: session.sessionId });
      assert.equal(domain.permissionDecision, "deny", "Domain result roles remain enforced.");
    }
    if (role === "router") return route(session, packet, requestId === "design" ? "design" : requestId === "implementation" ? "implement" : "answer");
    if (role === "designer") {
      const raw = await session.call("stage_human_design", sharedDesign());
      const staged = typeof raw === "string" ? JSON.parse(raw) : raw;
      return submit(session, packet, "submit_designer_outcome", {
        kind: "designer-changed", summary: "Publish through the canonical Design contract.", artifactRef: staged.artifactRef, questions: [],
      });
    }
    return ordinary(packet, session);
  }, { realDesign: true, permissionHandler: decide, filePermissionHandler: decide,
    nativeShell: async () => ({ contents: [] }) });
  for (const request of ["design", "implementation", "answer"]) {
    await f.send(request, `Perform the ${request} fixture request.`);
    assert.equal((await f.runtime.whenIdle()).status, "ready", f.errors.map(error => error.stack).join("\n"));
  }
  assert.deepEqual(f.errors, []);
  assert.deepEqual([...roles].sort(), ["agent", "designer", "implementer-aggregate", "implementer-task", "planner", "reviewer", "router"]);
  assert.deepEqual(permissions.remembered("private"), { all: false, tools: [] });
  await assert.rejects(readFile(join(f.project, "reviewer-native.js")), { code: "ENOENT" });
  for (const role of ["designer"]) {
    assert.equal(await readFile(join(f.project, `${role}-native.js`), "utf8"), `export const ${role} = true;\n`);
    await assert.rejects(readFile(join(f.project, `${role}-denied.js`)), { code: "ENOENT" });
    for (const kind of ["write", "shell"]) for (const denied of [false, true]) {
      assert.ok(decisions.some(item => item.role === role && item.kind === kind && item.denied === denied));
    }
  }
  const state = await f.runtime.state();
  assert.equal(state.uncertainty, null);
  assert.ok(state.requests.every(request => request.status === "completed"));
  assert.equal(state.cycles[0].acceptance.authority, "host");
  assert.ok(state.cycles[0].tasks.every(task => task.status === "completed"));
});

for (const success of [true, false]) test(`declared results progress independently of native compaction and idle: success=${success}`, { timeout: 90_000 }, async t => {
  const boundaries = [];
  const f = await fixture(t, async (packet, session, runtime) => {
    session.terminalIdle = false;
    session.emit("session.compaction_start", { trigger: "threshold" });
    assert.equal(runtime.transport.compaction.active, true);
    if (packet.binding.role === "router") await route(session, packet, packet.binding.requestId === "readonly" ? "answer" : "implement");
    else await ordinary(packet, session);
    await runtime.transport.drain();
    const state = await runtime.state();
    const completed = [state.activeTask, ...state.executions].find(task => task?.binding.id === packet.binding.id);
    assert.ok(completed.result, "Typed result is durable while compaction continues.");
    assert.equal(completed.completion, "result-submission");
    assert.equal(completed.end, null, "No native-end proof is fabricated.");
    boundaries.push(packet.binding.internalTaskId ?? packet.binding.role);
    session.emit("session.compaction_complete", { trigger: "threshold", success, ...(!success ? { error: "Fixture compaction failed" } : {}) });
    assert.equal(runtime.transport.compaction.error, success ? null : "Fixture compaction failed");
    session.endIdle();
  });
  t.mock.method(f.session, "abort", async () => { assert.fail("SDK natural completion must not use native abort."); });
  await f.send("implementation", "Implement both parts.");
  assert.equal((await f.runtime.whenIdle()).status, "ready");
  assert.deepEqual(boundaries, ["router", "planner", "engine", "view", "implementer", "reviewer"]);
  assert.equal((await f.runtime.state()).cycles[0].phase, "completed");
  await f.send("readonly", "Explain the resulting files.");
  assert.equal((await f.runtime.whenIdle()).status, "ready");
  assert.deepEqual(boundaries.slice(-2), ["router", "agent"]);
  for (const execution of (await f.runtime.state()).executions) {
    assert.equal(execution.completion, "result-submission", execution.binding.role);
  }
  assert.deepEqual(f.errors, []);
});

test("ordinary edits before routing and during read-only work neither freeze tools nor prevent settlement", { timeout: 60_000 }, async t => {
  const f = await fixture(t, async (packet, session, runtime) => {
    const root = (await runtime.readiness()).workspacePath;
    if (packet.binding.role === "router") {
      assert.equal((await readProjectFile(session, "original.txt")).content, "edited before Router\n");
      await writeFile(join(root, "notes.md"), "edited during Router\n");
      assert.equal((await readProjectFile(session, "notes.md")).content, "edited during Router\n");
      await patchFile(session, { path: "notes.md", expectedDigest: null, content: "Native fixture accepts Add on an existing path.\n" });
      assert.equal((await readProjectFile(session, "notes.md")).content, "Native fixture accepts Add on an existing path.\n");
      return route(session, packet, "answer");
    }
    await writeFile(join(root, "notes.md"), "edited during Agent\n");
    assert.equal((await readProjectFile(session, "notes.md")).content, "edited during Agent\n");
    return ordinary(packet, session);
  });
  await writeFile(join(f.project, "original.txt"), "edited before Router\n");
  await f.send("outside-readonly", "Explain the current files.");
  assert.equal((await f.runtime.whenIdle()).status, "ready");
  assert.equal((await f.runtime.state()).uncertainty, null);
  assert.equal(await readFile(join(f.project, "notes.md"), "utf8"), "edited during Agent\n");
  assert.deepEqual(f.errors, []);
});

for (const excerptLimit of [128, DEFAULT_POLICY.values.resources.reviewExcerptCharacters]) test(`current-code Review includes ordinary edits and bounded ${excerptLimit}-character excerpts`, { timeout: 120_000 }, async t => {
  let reviewed = false;
  const f = await fixture(t, async (packet, session, runtime) => {
    const root = (await runtime.readiness()).workspacePath;
    if (packet.binding.role === "router") return route(session, packet, "implement");
    if (packet.binding.internalTaskId === "engine") {
      const old = await readProjectFile(session, "original.txt");
      await writeFile(join(root, "original.txt"), "new external content\n");
      await assert.rejects(patchFile(session, { path: "original.txt", expectedDigest: old.digest, content: "stale replacement" }), /patch context conflict/);
      assert.equal(await readFile(join(root, "original.txt"), "utf8"), "new external content\n");
      await writeFile(join(root, "notes.md"), "unrelated doc edit\n");
    }
    if (packet.binding.role === "implementer" && !packet.binding.internalTaskId) {
      await writeFile(join(root, "engine.js"), "export const engine = 'current external edit';\n");
    }
    if (packet.binding.role === "reviewer") {
      const evidence = JSON.parse(await session.call("read_cycle_changes", {}));
      assert.deepEqual(evidence.changes.map(({ path }) => path).sort(), ["engine.js", "notes.md", "original.txt", "view.js"]);
      const fileTool = session.config.tools.find(tool => tool.name === "read_cycle_file");
      const limit = excerptLimit;
      assert.equal(fileTool.parameters.properties.length.maximum, limit);
      assert.match(fileTool.description, /omit length.*default/i);
      const bounded = JSON.parse(await session.call("read_cycle_file", { path: "engine.js", side: "after", length: limit }));
      assert.match(bounded.content, /current external edit/);
      await assert.rejects(session.call("read_cycle_file", { path: "engine.js", side: "after", length: 0 }), /input\.length/);
      for (const length of [limit + 1, 5000, 12000, 10000, 16000, 6000]) {
        await assert.rejects(session.call("read_cycle_file", { path: "engine.js", side: "after", length }), /bounded cycle-file excerpt/);
      }
      const current = JSON.parse(await session.call("read_cycle_file", { path: "engine.js", side: "after" }));
      assert.match(current.content, /current external edit/);
      reviewed = true;
      return submit(session, packet, "submit_whole_plan_review", {
        kind: "review-result", planDigest: packet.context.cycle.plan.digest, summary: "Reviewed current project content.",
        assessments: [], findings: [], verificationLimits: [], evidenceRefs: ["engine.js", "view.js"], questions: [],
      });
    }
    return ordinary(packet, session);
  }, { reviewExcerptCharacters: excerptLimit });
  await f.send("outside-cycle", "Implement and review.");
  const idle = await f.runtime.whenIdle();
  assert.deepEqual(f.errors, []);
  assert.equal(idle.status, "ready");
  assert.equal(reviewed, true);
  assert.deepEqual(f.errors, []);
});

test("task forecasts permit app startup data and immediate aggregate/Review dispatch while the attached app stays running", { timeout: 180_000 }, async (t) => {
  const forecast = ["index.html", "app.js", "style.css", "menu.js", "cart.js"].map(name => `beanflow-app/public/${name}`);
  const dataPath = "beanflow-app/data/state.json", extraPath = "src/extra.mjs";
  const permissions = [];
  let review, nativeTask, launchEventIndex;
  const successors = [];
  const f = await fixture(t, async (packet, session) => {
    if (nativeTask) {
      assert.equal(nativeTask.status, "running");
      assert.equal(session.sends.at(-1).mode, "immediate");
      successors.push(packet.binding.role);
    }
    if (packet.binding.role === "router") return route(session, packet, "implement");
    if (packet.binding.role === "planner") {
      const value = plan(packet);
      value.tasks.push({ id: "launch", title: "Start the app", scope: forecast, dependsOn: ["view"],
        designRefs: ["interaction#deliver"], criteria: [{ id: "app-ready", description: "The app serves its seeded state." }] });
      return submit(session, packet, "submit_internal_plan", { kind: "internal-plan", plan: value });
    }
    if (packet.binding.internalTaskId === "launch") {
      assert.deepEqual(packet.context.scope, forecast);
      await patchFile(session, { path: ".tandem/foreign-state", expectedDigest: null, content: "Native-authorized file, not a domain publication.\n" });
      await patchFile(session, { path: "../outside.txt", expectedDigest: null, content: "Native-authorized path outside snapshot scope.\n" });
      await patchFile(session, { path: extraPath, expectedDigest: null, content: "export const extra = true;\n" });
      await session.call("powershell", { command: "node beanflow-app/src/server.mjs", shellId: "fixture-app", mode: "async" });
      session.terminalIdle = false;
      session.suppressTurnEnd = true;
      launchEventIndex = session.events.length;
      return submit(session, packet, "submit_internal_task_result", { kind: "task-result", taskId: "launch",
        planDigest: packet.context.cycle.plan.digest, summary: "App is ready; startup data and necessary source are retained.",
        evidenceRefs: [dataPath, extraPath] });
    }
    if (packet.binding.role === "reviewer") {
      review = JSON.parse(await session.call("read_cycle_changes", {}));
      assert.deepEqual(review.files.map(({ path }) => path), [dataPath, "engine.js", extraPath, "view.js"]);
      assert.equal(review.files.find(({ path }) => path === dataPath).before, null);
      const data = JSON.parse(await session.call("read_cycle_file", { path: dataPath, side: "after" }));
      assert.equal(data.content, '{"seeded":true}\n');
      assert.equal(JSON.parse(await session.call("read_cycle_file", { path: dataPath, side: "before" })).exists, false);
      return submit(session, packet, "submit_whole_plan_review", { kind: "review-result", planDigest: packet.context.cycle.plan.digest,
        summary: "Reviewed all actual files, including startup data and extra source.", assessments: [],
        findings: [], verificationLimits: [], evidenceRefs: review.files.map(({ path }) => path), questions: [] });
    }
    return ordinary(packet, session);
  }, { initialFiles: { "beanflow-app/src/server.mjs": `
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
mkdirSync('data', { recursive: true });
writeFileSync('data/state.json', '{"seeded":true}\\n');
createServer((request, response) => response.end('ready')).listen(Number(process.env.PORT), process.env.HOST);
` }, nativeShell: async (args, project) => {
    assert.equal(args.command, "node beanflow-app/src/server.mjs");
 nativeTask = { type: "shell", id: args.shellId, command: args.command, status: "running",
   attachmentMode: "attached", executionMode: "background", startedAt: new Date().toISOString() };
    await mkdir(join(project, "beanflow-app", "data"), { recursive: true });
    await writeFile(join(project, dataPath), '{"seeded":true}\n');
    return { contents: [] };
  }, permissionHandler: async request => { permissions.push(request); return { kind: "approve-once" }; } });
  f.session.rpc.tasks = {
    list: async () => ({ tasks: nativeTask ? [structuredClone(nativeTask)] : [] }),
    cancel: async ({ id }) => {
      assert.equal(id, nativeTask.id);
      nativeTask.status = "cancelled"; nativeTask.completedAt = new Date().toISOString();
      return { cancelled: true };
    },
  };
  await f.send("forecast", "Implement and start the app.");
  const readiness = await f.runtime.whenIdle(), state = await f.runtime.state();
  assert.equal(readiness.status, "ready", readiness.reason ?? f.errors.map(error => error.stack).join("\n"));
  assert.equal(state.uncertainty, null); assert.deepEqual(f.errors, []);
  assert.equal(permissions.length, 1); assert.equal(permissions[0].fullCommandText, "node beanflow-app/src/server.mjs");
  const nativeApp = (await f.runtime.commands.read()).nativeSessions[0];
  assert.equal(nativeApp.status, "running");
  assert.equal((await f.runtime.readiness()).status, "ready");
  assert.equal((await f.runtime.commands.read()).nativeSessions[0].canStop, true);
  assert.deepEqual(successors, ["implementer", "reviewer"]);
  assert.ok(f.session.events.slice(launchEventIndex).every(event =>
    !["assistant.turn_end", "assistant.idle", "session.idle"].includes(event.type)));
  for (const execution of state.executions.filter(({ binding }) =>
    binding.internalTaskId === "launch" || (binding.role === "implementer" && !binding.internalTaskId) || binding.role === "reviewer")) {
    assert.equal(execution.completion, "result-submission");
    assert.equal(execution.end, null);
  }
  await f.runtime.commands.stop(nativeApp.id);
  assert.equal(state.cycles[0].phase, "completed"); assert.equal(state.cycles[0].reviewResult.outcome.kind, "review-result");
  assert.deepEqual(state.cycles[0].plan.tasks[2].scope, forecast);
  const launch = state.executions.find(({ binding }) => binding.internalTaskId === "launch");
  assert.equal(launch.result.outcome.kind, "task-result");
  assert.equal(launch.completion, "result-submission");
  assert.equal(launch.end, null);
  assert.deepEqual((await f.runtime.workspace.changes(launch.binding.before, launch.after)).map(({ path }) => path), [dataPath, extraPath]);
  assert.equal((await f.runtime.workspace.readSnapshot(launch.binding.before)).files.some(({ path }) => path === dataPath), false);
  assert.equal(await readFile(join(f.project, dataPath), "utf8"), '{"seeded":true}\n');
  assert.equal(await readFile(join(f.project, "original.txt"), "utf8"), "pre-existing dirty code\n");
  assert.match(await readFile(join(f.project, "TANDEM.md"), "utf8"), /whole-cycle implementation evidence/);
});

for (const boundary of ["agent", "aggregate", "reviewer", "protected", "interrupted"]) {
  test(`task forecast correction retains ${boundary} write or completion boundary`, { timeout: 120_000 }, async (t) => {
    const f = await fixture(t, async (packet, session, runtime) => {
      const { role, internalTaskId } = packet.binding;
      if (role === "router") return route(session, packet, boundary === "agent" ? "answer" : "implement");
      if (role === "planner") { const value = plan(packet); value.tasks = value.tasks.slice(0, 1);
        return submit(session, packet, "submit_internal_plan", { kind: "internal-plan", plan: value }); }
      const target = boundary === "agent" ? role === "agent" : boundary === "reviewer" ? role === "reviewer"
        : boundary === "aggregate" ? role === "implementer" && !internalTaskId : internalTaskId === "engine";
      if (!target) return ordinary(packet, session);
      if (boundary === "interrupted") {
        await patchFile(session, { path: "extra.mjs", expectedDigest: null, content: "export const partial = true;" });
      } else if (boundary === "protected") {
        await assert.rejects(session.call("powershell", { command: "Set-Content TANDEM.md 'not authorized'",
          shellId: "protected-command" }), /protected/);
      } else {
        await assert.rejects(patchFile(session, {
          path: "unexpected.mjs", expectedDigest: null, content: "not authorized",
        }), /apply_patch|accepted/);
      }
      session.emit("session.error", { message: "Fixture native interruption; no completion proof." });
    }, { permissionHandler: async () => ({ kind: "approve-once" }) });
    await f.send("boundary", "Perform the requested work.");
    assert.equal((await f.runtime.whenIdle()).status, "execution-unknown");
    const state = await f.runtime.state();
    assert.ok(state.uncertainty);
    assert.ok(state.cycles.every(cycle => cycle.phase !== "completed" && !cycle.reviewResult));
    if (boundary === "interrupted") {
      assert.notEqual(state.cycles[0].tasks.find(({ id }) => id === "engine").status, "completed");
      assert.equal(state.activeTask?.result ?? null, null);
    }
  });
}

for (const step of [
  { name: "router", role: "router", taskId: null },
  { name: "planner", role: "planner", taskId: null },
  { name: "first-task", role: "implementer", taskId: "engine" },
  { name: "last-task", role: "implementer", taskId: "view" },
  { name: "aggregate", role: "implementer", taskId: null },
  { name: "reviewer", role: "reviewer", taskId: null },
  { name: "designer", role: "designer", taskId: null },
  { name: "agent", role: "agent", taskId: null },
]) test(`after-step Stop settles ${step.name} only and releases new questions without losing answerability`, { timeout: 180_000 }, async (t) => {
  const reached = Promise.withResolvers(), release = Promise.withResolvers();
  const matches = (packet) => packet.binding.requestId === "work" && packet.binding.role === step.role
    && packet.binding.internalTaskId === step.taskId;
  const f = await fixture(t, async (packet, session) => {
    if (matches(packet)) { reached.resolve(packet); await release.promise; }
    if (packet.binding.role === "router") return route(session, packet, packet.binding.requestId !== "work" || step.role === "agent"
      ? "answer" : step.role === "designer" ? "design" : "implement");
    if (packet.binding.role === "designer") {
      const value = await session.call("stage_human_design", sharedDesignExample());
      const artifact = typeof value === "string" ? JSON.parse(value) : value;
      return submit(session, packet, "submit_designer_outcome", { kind: "designer-changed",
        summary: "The current Design step was completed.", artifactRef: artifact.artifactRef, questions: [question] });
    }
    if (packet.binding.role === "reviewer") return submit(session, packet, "submit_whole_plan_review", {
      kind: "review-result", planDigest: packet.context.cycle.plan.digest, summary: "The whole plan was reviewed.",
      assessments: [], findings: [reviewDecisionFinding], verificationLimits: [], evidenceRefs: ["engine.js", "view.js"], questions: [reviewDecisionQuestion],
    });
    return ordinary(packet, session);
  }, { realDesign: step.role === "designer" });
  const abort = f.session.abort.bind(f.session), aborts = [];
  t.mock.method(f.session, "abort", async () => { aborts.push((await f.runtime.state()).activeTask?.binding.id); return abort(); });
  try {
    await f.send("work", "Complete the requested work.");
    const packet = await reached.promise;
    await f.send("discarded", "Previously queued work must not run.");
    const acknowledgement = await f.runtime.stop("step-stop");
    assert.equal(acknowledgement.status, "stopping");
    assert.equal(acknowledgement.stopRequestId, "step-stop");
    assert.match(acknowledgement.reason, /waiting for its verified settlement/);
    assert.doesNotMatch(acknowledgement.reason, /may continue editing|step will finish/);
    assert.equal(aborts.includes(packet.binding.id), false, "User Stop does not abort the role.");
    await Promise.all([f.runtime.stop("step-stop"), f.runtime.stop("duplicate-click")]);
    const pending = await f.runtime.state();
    assert.equal(pending.stop.id, "step-stop");
    assert.equal(pending.stop.mode, "after-step");
    assert.equal(pending.stop.taskId, packet.binding.id);
    assert.equal(pending.requests.find(({ id }) => id === "discarded").status, "discarded");
    assert.equal(projectHumanLoopView(pending, await f.runtime.readiness()).canSend, false);
    release.resolve();
    const readiness = await f.runtime.whenIdle(), state = await f.runtime.state();
    assert.equal(readiness.status, "ready", readiness.reason ?? f.errors.map((error) => error.stack).join("\n"));
    assert.equal(state.uncertainty, null);
    assert.equal(f.errors.length, 0);
    assert.equal(state.stop, null);
    assert.equal(state.stops.length, 1);
    assert.equal(state.stops[0].taskId, packet.binding.id);
    assert.equal(state.stops[0].mode, "after-step");
    assert.equal(state.stops[0].acknowledged, false);
    const settled = state.executions.find(({ binding }) => binding.id === packet.binding.id);
    assert.equal(settled.completion, "result-submission");
    assert.equal(settled.end, null);
    assert.equal(aborts.filter((id) => id === packet.binding.id).length, 0, "After-step Stop needs no separate native interruption.");
    assert.deepEqual(f.history.at(-1), {
      role: packet.binding.role, taskId: packet.binding.internalTaskId, requestId: "work",
      cycleId: packet.binding.cycleId, context: packet.context,
    }, "No successor role starts.");
    if (state.cycles.length) {
      assert.equal(state.cycles[0].phase, step.role === "reviewer" ? "completed" : "stopped");
      if (step.role === "planner") assert.ok(state.cycles[0].acceptance, "Planner Host settlement retains its accepted plan.");
      if (step.role === "reviewer") {
        assert.ok(state.cycles[0].reviewResult);
        assert.ok(state.cycles[0].indexReceipt);
      } else assert.equal(state.cycles[0].reviewResult, null);
    }
    const view = projectHumanLoopView(state, readiness);
    assert.equal(view.canSend, true);
    assert.equal(view.questionCounts.blockers, 0);
    if (["designer", "reviewer"].includes(step.role)) {
      const producedQuestion = step.role === "reviewer" ? reviewDecisionQuestion : question;
      assert.deepEqual(settled.result.outcome.questions[0], producedQuestion, "Original result questions remain immutable audit.");
      const saved = state.questions.find(({ source }) => source.resultId === settled.result.resultId);
      assert.equal(saved.question, producedQuestion.question);
      assert.equal(saved.state, "open");
      assert.equal(saved.blockingActive, false);
      assert.equal(saved.answerRequestId, null);
      assert.equal(saved.invalidation, undefined);
      assert.equal(view.questionInteractions.find(group => group.resultId === saved.source.resultId).canAnswer, true);
      await f.send("later-answer", "Consider this saved answer afresh; do not resume old work.", {
        schemaVersion: "human-question-answers/v1",
        answers: [{ questionId: saved.id, sourceResultId: saved.source.resultId, kind: "option", value: saved.options[0].id }],
      });
      assert.equal((await f.runtime.whenIdle()).status, "ready");
      assert.equal(f.history.at(-1).requestId, "later-answer");
      assert.equal((await f.runtime.state()).questions.find(q => q.id === saved.id && q.source.resultId === saved.source.resultId).state, "answered");
      if (step.role === "designer") assert.ok((await f.runtime.currentDesign()).binding.revisionId);
    }
    await f.send("new", "Assess the retained result afresh without resuming stopped work.");
    await f.runtime.stop("step-stop");
    assert.equal((await f.runtime.whenIdle()).status, "ready");
    assert.equal((await f.runtime.state()).stops.length, 1, "A completed Stop ID cannot stop new work.");
    assert.equal((await f.runtime.state()).requests.find(({ id }) => id === "new").status, "completed");
  } finally { release.resolve(); }
});
for (const escalate of [false, true]) test(`immediate Stop ${escalate ? "escalates pending graceful intent" : "cancels without a model result"} and preserves partial work`, { timeout: 60_000 }, async t => {
  const started = Promise.withResolvers(), release = Promise.withResolvers();
  const f = await fixture(t, async (packet, session) => {
    if (packet.binding.requestId === "new") return route(session, packet, "design");
    started.resolve(packet);
    await release.promise;
  });
  let aborts = 0;
  const abort = f.session.abort.bind(f.session);
  f.session.abort = async () => { aborts++; await abort(); release.resolve(); };
  try {
    await f.send("first", "Investigate until interrupted.");
    await started.promise;
    await writeFile(join(f.project, "partial.txt"), "Keep this partial work.\n");
    if (escalate) {
      // Keep the current finite step admitted so graceful intent has no injected model acknowledgement.
      f.runtime.transport.requestCooperativeStop = () => {};
      const state = await f.runtime.stop("stop-now");
      assert.equal(state.stop.mode, "after-step");
      const view = projectHumanLoopView(await f.runtime.state(), state);
      assert.equal(view.canStop, false);
      assert.equal(view.canStopNow, true);
    }
    await Promise.all([f.runtime.stop("stop-now", "immediate"), f.runtime.stop("stop-now", "immediate")]);
    assert.equal((await f.runtime.whenIdle()).status, "ready");
    const state = await f.runtime.state();
    assert.equal(aborts, 1);
    assert.equal(state.stops.length, 1);
    assert.equal(state.executions[0].result, null);
    assert.equal(state.executions[0].completion, "native-stop");
    assert.equal(state.stops[0].nativeResult.interrupted, true);
    assert.equal(state.requests[0].status, "stopped");
    assert.equal(state.uncertainty, null);
    assert.equal(await readFile(join(f.project, "partial.txt"), "utf8"), "Keep this partial work.\n");
    assert.equal(projectHumanLoopView(state, await f.runtime.readiness()).canStopNow, false);
    await f.runtime.stop("stop-now", "immediate");
    assert.equal(aborts, 1);
  } finally { release.resolve(); }
});

test("Host background Stop uses current native identity and cancellation without command recertification or a model tool", { timeout: 60_000 }, async t => {
  let startedAt, mismatch = null, cancelled = false;
  const cancellations = [];
  const command = "node background-fixture.mjs";
  const f = await fixture(t, async (packet, session) => {
    if (packet.binding.role === "router") return route(session, packet, "answer");
    await session.call("powershell", { command, shellId: "owned-background", mode: "async" });
    return submit(session, packet, "submit_readonly_answer",
      { kind: "answer", summary: "Background started.", report: "The app can outlive this role.", evidenceRefs: [] });
  }, { permissionHandler: () => ({ kind: "approve-once" }), nativeShell: async () => {
    startedAt = new Date().toISOString(); return { contents: [] };
  } });
  f.session.rpc.tools.execute = async () => { assert.fail("Host control must not inherit an aborted model-tool context"); };
  f.session.rpc.tasks = {
    list: async () => ({ tasks: startedAt ? [{ type: "shell", id: mismatch === "identity" ? "foreign" : "owned-background",
      command: mismatch === "command" ? "foreign command" : command, attachmentMode: "attached",
      status: cancelled ? "cancelled" : "running", executionMode: "background",
      startedAt: mismatch === "generation" ? new Date(Date.parse(startedAt) + 1).toISOString() : startedAt,
      ...(cancelled ? { completedAt: new Date().toISOString() } : {}) },
    { type: "shell", id: "unrelated", command: "unrelated", status: "running", attachmentMode: "attached", startedAt }] : [] }),
    cancel: async ({ id }) => {
      cancellations.push(id);
      if (mismatch === "api-error") throw new Error("Fixture task service unavailable");
      cancelled = mismatch !== "negative"; return { cancelled };
    },
  };
  await f.send("first", "Start the background fixture.");
  assert.equal((await f.runtime.whenIdle()).status, "ready");
  const entry = (await f.runtime.commands.read()).nativeSessions[0];
  for (const value of ["identity", "generation", "negative"]) {
    mismatch = value; cancelled = false;
    await assert.rejects(f.runtime.commands.stop(entry.id), /not a current task|did not confirm/);
    assert.equal((await f.runtime.commands.read()).nativeSessions[0].status, value === "negative" ? "running" : "held");
  }
  assert.deepEqual(cancellations, [entry.shellId]);
  mismatch = "api-error"; cancelled = false;
  await assert.rejects(f.runtime.commands.stop(entry.id), /Fixture task service unavailable/);
  assert.equal((await f.runtime.commands.read()).nativeSessions[0].status, "running");
  assert.equal((await f.runtime.state()).uncertainty, null);
  assert.equal((await f.runtime.readiness()).status, "ready");
  mismatch = "command"; cancelled = false;
  await f.runtime.commands.stop(entry.id);
  assert.equal((await f.runtime.commands.read()).nativeSessions[0].status, "stopped");
  assert.equal(cancellations.every(id => id === entry.shellId), true);
});

test("background task Stop does not hold Designer completion, queued admission or another role's permission", { timeout: 60_000 }, async t => {
  const designing = Promise.withResolvers(), continueDesign = Promise.withResolvers();
  const decide = Promise.withResolvers();
  const cancelling = Promise.withResolvers(), finishCancel = Promise.withResolvers();
  const tasks = [], cancellations = [];
  let permissionPending = false;
  const f = await fixture(t, async (packet, session) => {
    if (packet.binding.role === "router") return route(session, packet, packet.binding.requestId === "design-work" ? "design" : "answer");
    if (packet.binding.role === "designer") {
      designing.resolve();
      await continueDesign.promise;
      assert.match(await session.call("view", { path: "original.txt" }), /pre-existing dirty code/);
      return submit(session, packet, "submit_designer_outcome", {
        kind: "designer-unchanged", summary: "Current Design is sufficient.", explanation: "No revision needed.", questions: [],
      });
    }
    if (packet.binding.requestId === "start") {
      for (const shellId of ["selected-background", "other-background"]) {
        await session.call("powershell", { command: `node ${shellId}.mjs`, shellId, mode: "async" });
      }
    } else await session.call("powershell", { command: "node --version", shellId: "foreground-check", mode: "sync" });
    return submit(session, packet, "submit_readonly_answer", {
      kind: "answer", summary: "Finished the requested work.", report: "Independent request completed.", evidenceRefs: [],
    });
  }, {
    realDesign: true,
    permissionHandler: request => {
      if (request.fullCommandText === "node --version") { permissionPending = true; return decide.promise; }
      return { kind: "approve-once" };
    },
    nativeShell: async args => {
      if (args.mode === "sync") return { contents: [{ type: "shell_exit", shellId: args.shellId, exitCode: 0 }] };
      tasks.push({ type: "shell", id: args.shellId, command: args.command, attachmentMode: "attached",
        status: "running", executionMode: "background", startedAt: new Date().toISOString() });
      return { contents: [] };
    },
  });
  f.session.rpc.tools.execute = async () => assert.fail("Process Stop must not dispatch a model tool.");
  f.session.rpc.tasks = {
    list: async () => ({ tasks: structuredClone(tasks) }),
    cancel: async ({ id }) => {
      cancellations.push(id);
      if (id === "selected-background") { cancelling.resolve(); await finishCancel.promise; }
      const task = tasks.find(task => task.id === id);
      task.status = "cancelled"; task.completedAt = new Date().toISOString();
      return { cancelled: true };
    },
  };
  let stopping;
  try {
    await f.send("start", "Start two independent background fixtures.");
    assert.equal((await f.runtime.whenIdle()).status, "ready");
    await f.send("design-work", "Review the existing Design.");
    await designing.promise;
    await f.send("later", "Check the runtime version afterwards.");
    const before = await f.runtime.state(), rows = (await f.runtime.commands.read()).nativeSessions;
    assert.equal(rows[0].canStop, true, "Active Designer does not withdraw background authority.");
    stopping = f.runtime.commands.stop(rows[0].id);
    await cancelling.promise;
    const during = await f.runtime.state();
    assert.deepEqual(during.activeTask, before.activeTask);
    assert.deepEqual(during.requests, before.requests);
    assert.equal(during.stop, null); assert.equal(during.uncertainty, null);
    assert.deepEqual(cancellations, ["selected-background"]);
    assert.equal((await f.runtime.commands.read()).nativeSessions[1].canStop, true);
    const denied = await f.session.config.hooks.onPreToolUse({ sessionId: "private",
      toolName: "stop_powershell", toolArgs: { shellId: "selected-background" } }, { sessionId: "private" });
    assert.equal(denied.permissionDecision, "deny", "Host cancellation does not substitute for an owned native invocation.");
    continueDesign.resolve();
    await waitFor(() => {
      assert.deepEqual(f.errors, []);
      return permissionPending;
    }, "queued role reaches its own permission while background cancellation is pending");
    const pendingPermission = await f.runtime.state();
    assert.equal(pendingPermission.activeTask.binding.role, "agent");
    assert.equal(pendingPermission.activeTask.binding.requestId, "later");
    assert.equal(pendingPermission.stop, null); assert.equal(pendingPermission.uncertainty, null);
    decide.resolve({ kind: "approve-once" });
    assert.equal((await f.runtime.whenIdle()).status, "ready", "Role completion does not wait for process control.");
    finishCancel.resolve(); await stopping;
    assert.deepEqual((await f.runtime.commands.read()).nativeSessions.map(row => row.status), ["stopped", "running", "completed"]);
    assert.deepEqual(f.errors, []);
  } finally {
    continueDesign.resolve(); decide.resolve({ kind: "approve-once" }); finishCancel.resolve();
    if (stopping) await stopping;
    for (const row of (await f.runtime.commands.read()).nativeSessions) if (row.canStop) await f.runtime.commands.stop(row.id);
  }
});

test("background Stop preserves already completed and naturally failed task outcomes without a false stop", { timeout: 60_000 }, async t => {
  const tasks = [], cancellations = [];
  const f = await fixture(t, async (packet, session) => {
    if (packet.binding.role === "router") return route(session, packet, "answer");
    for (const shellId of ["already-completed", "finishes-naturally"]) {
      await session.call("powershell", { command: `node ${shellId}.mjs`, shellId, mode: "async" });
    }
    return submit(session, packet, "submit_readonly_answer", { kind: "answer", summary: "Started.",
      report: "Independent tasks started.", evidenceRefs: [] });
  }, { permissionHandler: () => ({ kind: "approve-once" }), nativeShell: async args => {
    tasks.push({ type: "shell", id: args.shellId, command: args.command, status: "running",
      attachmentMode: "attached", startedAt: new Date().toISOString() });
    return { contents: [] };
  } });
  f.session.rpc.tasks = {
    list: async () => ({ tasks: structuredClone(tasks) }),
    cancel: async ({ id }) => {
      cancellations.push(id);
      const task = tasks.find(task => task.id === id);
      task.status = "failed"; task.completedAt = new Date().toISOString();
      return { cancelled: false };
    },
  };
  await f.send("start", "Start the fixtures.");
  await f.runtime.whenIdle();
  Object.assign(tasks[0], { status: "completed", completedAt: new Date().toISOString() });
  const rows = (await f.runtime.commands.read()).nativeSessions;
  assert.equal((await f.runtime.commands.stop(rows[0].id)).status, "completed");
  assert.deepEqual(cancellations, []);
  assert.equal((await f.runtime.commands.stop(rows[1].id)).status, "failed");
  assert.deepEqual(cancellations, ["finishes-naturally"]);
  assert.equal((await f.runtime.state()).uncertainty, null);
  assert.equal((await f.runtime.readiness()).status, "ready");
  assert.deepEqual(f.errors, []);
});

test("after-step Stop API acknowledges pending permission and keeps new input unavailable until settlement", { timeout: 90_000 }, async (t) => {
  const events = new HumanLoopEvents(), permissions = new PermissionBroker(events), requested = Promise.withResolvers();
  const f = await fixture(t, async (packet, session) => {
    if (packet.binding.role === "router") return route(session, packet, "answer");
    await assert.rejects(session.call("powershell", { command: "node --version", shellId: "version" }), /Native permission denied/);
    return submit(session, packet, "submit_readonly_answer", { kind: "answer", summary: "The check was denied.",
      report: "Permission was denied; no command ran. This role is settled.", evidenceRefs: [] });
  }, { permissionHandler: (request, invocation, lifetime) => {
    const decision = permissions.request(request, invocation, lifetime.signal, lifetime);
    requested.resolve(); return decision;
  } });
  const installation = { runtime: f.runtime, read: async () => ({ status: "ready" }) };
  const provider = await createHumanLoopProvider({ repositoryRoot: f.project,
    publicDirectory: fileURLToPath(new URL("../public", import.meta.url)), getInstallation: () => installation,
    events, permissions, start: async () => {} });
  t.after(async () => { await provider.close(); events.close(); });
  const post = (path, value) => fetch(new URL(path, provider.url), { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
  try {
    await f.send("check", "Check the current Node version.");
    await requested.promise;
    const permissionId = permissions.list()[0].id;
    const response = await post("/api/stop", { stopId: "http-stop" });
    assert.equal(response.status, 200, await response.clone().text());
    const pending = await response.json();
    assert.equal(pending.workflow.status, "stopping");
    assert.match(pending.workflow.reason, /waiting for its verified settlement/);
    assert.match(pending.workflow.reason, /Saved results and partial work are retained/);
    assert.doesNotMatch(pending.workflow.reason, /step will finish|may continue editing/);
    assert.equal(pending.workflow.stop.mode, "after-step");
    assert.equal(pending.workflow.canSend, false);
    assert.equal(pending.accessRequests[0].id, permissionId);
    assert.equal((await f.runtime.state()).activeTask.condition, "waiting-permission");
    const rejected = await post("/api/requests", { id: "premature", message: "Do not admit this yet.", receivedAt: new Date().toISOString() });
    assert.ok(rejected.status >= 400);
    assert.equal((await f.runtime.state()).requests.some(({ id }) => id === "premature"), false);
    assert.equal((await post(`/api/access/${permissionId}`, { decision: "denied" })).status, 200);
    assert.equal((await f.runtime.whenIdle()).status, "ready", f.errors.map((error) => error.stack).join("\n"));
    const completed = await (await fetch(new URL("/api/snapshot", provider.url))).json();
    assert.equal(completed.workflow.stop, null);
    assert.equal(completed.workflow.lastStop.id, "http-stop");
    assert.equal(completed.workflow.canSend, true);
    assert.equal((await f.runtime.commands.read()).commands.length, 0);
  } finally {
    for (const permission of permissions.list()) await permissions.decide(permission.id, "denied");
  }
});

test("after-step Stop never converts a genuine native failure into successful settlement", { timeout: 60_000 }, async (t) => {
  const started = Promise.withResolvers(), release = Promise.withResolvers();
  const f = await fixture(t, async (_packet, session) => {
    started.resolve(); await release.promise;
    session.emit("session.error", { message: "The admitted role failed." });
  });
  try {
    await f.send("failure", "Interpret the request.");
    await started.promise;
    assert.equal((await f.runtime.stop("failure-stop")).status, "stopping");
    release.resolve();
    const readiness = await f.runtime.whenIdle(), state = await f.runtime.state();
    assert.equal(readiness.status, "execution-unknown");
    assert.match(readiness.reason, /private runtime reported interruption/);
    assert.equal(state.stop.mode, "after-step");
    assert.equal(state.stops.length, 0);
    assert.equal(state.activeTask.end, null);
    assert.equal(f.session.sends.length, 1);
    assert.equal((await f.runtime.stop("failure-stop")).status, "execution-unknown");
  } finally { release.resolve(); }
});

async function deniedResult(session, packet, name, outcome, pattern) {
  const denied = await session.config.hooks.onPreToolUse({ sessionId: session.sessionId, toolName: name, toolArgs: {
    schemaVersion: "human-role-result/v1", resultId: `invalid:${packet.binding.id}`, inputDigest: packet.binding.inputDigest,
    outcome: outcome.kind === "review-result" ? { reviewFormat: "decision-review/v2", coverageStatus: "complete", ...outcome } : outcome,
  } }, { sessionId: session.sessionId });
  assert.equal(denied.permissionDecision, "deny");
  assert.match(denied.permissionDecisionReason, pattern);
}

test("shared references bind internal planning and whole-plan Review to exact generic elements and index evidence", { timeout: 120_000 }, async (t) => {
  const f = await fixture(t, async (packet, session, runtime) => {
    if (packet.binding.role === "router") return route(session, packet, "implement");
    if (packet.binding.role === "planner") {
      assert.ok(packet.context.design.references.some(({ reference }) => reference === "interaction#deliver"));
      const invalid = plan(packet); invalid.tasks[0].designRefs = ["interaction#missing"];
      await deniedResult(session, packet, "submit_internal_plan", { kind: "internal-plan", plan: invalid }, /Unknown Design reference/);
      assert.equal((await runtime.state()).activeTask.stagedResult, null);
      return ordinary(packet, session);
    }
    if (packet.binding.role === "reviewer") {
      const evidence = JSON.parse(await session.call("read_cycle_changes", {}));
      assert.equal(evidence.schemaVersion, "whole-plan-review-evidence/v2");
      assert.deepEqual(evidence.design.binding, packet.binding.design);
      assert.deepEqual(evidence.design.references, ["interaction#deliver", "interaction#accept"]);
      const outcome = { kind: "review-result", planDigest: packet.context.cycle.plan.digest,
        summary: "The complete generic Design and plan were reviewed.",
        assessments: [], findings: [], verificationLimits: [], evidenceRefs: ["engine.js", "view.js"], questions: [] };
      const badFinding = { ...outcome,
        findings: [{ ...reviewDecisionFinding, designRefs: ["unknown-artifact"] }],
        questions: [{ ...reviewDecisionQuestion, designRefs: ["unknown-artifact"] }] };
      await deniedResult(session, packet, "submit_whole_plan_review", badFinding, /Unknown Design reference/);
      await deniedResult(session, packet, "submit_whole_plan_review", { ...outcome,
        findings: [reviewDecisionFinding],
        questions: [{ ...reviewDecisionQuestion, designRefs: ["interaction#accept", "interaction#missing"] }] }, /Unknown Design reference/);
      assert.equal((await runtime.state()).activeTask.stagedResult, null);
      return submit(session, packet, "submit_whole_plan_review", outcome);
    }
    return ordinary(packet, session);
  });
  await f.send("referenced-plan", "Implement the complete referenced Design.");
  assert.equal((await f.runtime.whenIdle()).status, "ready", f.errors.map((e) => e.stack).join("\n"));
  assert.deepEqual(f.history.map(({ role }) => role), ["router", "planner", "implementer", "implementer", "implementer", "reviewer"]);
  const index = await readFile(join(f.project, "TANDEM.md"), "utf8");
  assert.match(index, /Design revision: `design`/);
  assert.match(index, /interaction#deliver/);
  assert.match(index, /interaction#accept/);
});

test("same-named elements in a later Design cannot receive a result from an older producing binding", { timeout: 60_000 }, async (t) => {
  let current = structuredClone(design);
  const f = await fixture(t, async (packet, session, runtime) => {
    if (packet.binding.role === "router") return route(session, packet, "answer");
    current = { ...current, binding: { revisionId: "later", digest: current.binding.digest } };
    await deniedResult(session, packet, "submit_readonly_answer", { kind: "answer", summary: "Stale.",
      report: "A same-named node is not proof of the same producing revision.", evidenceRefs: [], designRefs: ["interaction#deliver"] },
    /producing Design/);
    assert.equal((await runtime.state()).activeTask.stagedResult, null);
    current = structuredClone(design);
    return submit(session, packet, "submit_readonly_answer", { kind: "answer", summary: "Exact revision.",
      report: "The exact producing reference was retained.", evidenceRefs: [], designRefs: ["interaction#deliver"] });
  }, { readDesign: async () => current });
  await f.send("exact-revision", "Explain the referenced Design.");
  assert.equal((await f.runtime.whenIdle()).status, "ready", f.errors.map((e) => e.stack).join("\n"));
});

test("before Design exists generic references may be omitted but future element IDs cannot be invented", { timeout: 60_000 }, async (t) => {
  const f = await fixture(t, async (packet, session, runtime) => {
    if (packet.binding.role === "router") return route(session, packet, "answer");
    await deniedResult(session, packet, "submit_readonly_answer", { kind: "answer", summary: "Not yet defined.",
      report: "No canonical artifact exists.", evidenceRefs: [], designRefs: ["future#node"] }, /Unknown Design reference/);
    assert.equal((await runtime.state()).activeTask.stagedResult, null);
    return submit(session, packet, "submit_readonly_answer", { kind: "answer",
      summary: "No Design yet.", report: "A Design has not been created.", evidenceRefs: [] });
  }, { readDesign: async () => ({ binding: { revisionId: null, digest: null }, content: null }) });
  await f.send("no-design", "What is defined so far?");
  assert.equal((await f.runtime.whenIdle()).status, "ready", f.errors.map((e) => e.stack).join("\n"));
});

test("shared canonical Design flows through actual Canvas answers, complete internal work and whole-plan Review", { skip: !browserAvailable, timeout: 180_000 }, async (t) => {
  const events = new HumanLoopEvents(), permissions = new PermissionBroker(events);
  const buildQuestion = { ...question, id: "begin", question: "Begin implementing this Design?",
    context: "The shared Design is ready for a product decision.", designRefs: ["interaction#deliver"],
    options: [{ id: "build", label: "Implement now", implication: "Start the requested code work." },
      { id: "discuss", label: "Discuss first", implication: "Keep this as Design only." }] };
  const f = await fixture(t, async (packet, session) => {
    if (packet.binding.role === "router") {
      const refs = packet.context.request.answers?.answers.map(({ questionId, sourceResultId }) => ({ questionId, sourceResultId })) ?? [];
      return route(session, packet, packet.binding.requestId === "compose" ? "design"
        : packet.binding.requestId === "explicit-build" ? "implement" : "answer", null, refs);
    }
    if (packet.binding.role === "designer") {
      assert.equal(packet.context.designGeneration.schema.properties.schemaVersion.const, "sketch-design/v3");
      assert.equal(packet.context.designGeneration.templates.length, 3);
      const value = await session.call("stage_human_design", sharedDesignExample());
      const staged = typeof value === "string" ? JSON.parse(value) : value;
      return submit(session, packet, "submit_designer_outcome", { kind: "designer-changed",
        summary: "Shared artifacts describe the complete requested behavior.", artifactRef: staged.artifactRef, questions: [buildQuestion] });
    }
    return ordinary(packet, session);
  }, { realDesign: true, onHandoff: async () => events.touch() });
  const installation = { runtime: f.runtime, read: async () => ({ status: "ready", canStart: false, canReopen: false }) };
  const provider = await createHumanLoopProvider({ repositoryRoot: f.project,
    publicDirectory: fileURLToPath(new URL("../public", import.meta.url)), getInstallation: () => installation,
    events, permissions, start: async () => {} });
  const browserCleanups = [];
  t.after(async () => { for (const cleanup of browserCleanups) await cleanup(); await provider.close(); events.close(); });
  const browser = await openFixtureBrowser({ after: (cleanup) => browserCleanups.push(cleanup) });
  await browser.call("Emulation.setDeviceMetricsOverride", { width: 1450, height: 1050, deviceScaleFactor: 1, mobile: false });
  await browser.call("Page.navigate", { url: provider.url });
  await browser.waitFor("!document.querySelector('#send').disabled");
  const response = await fetch(new URL("/api/requests", provider.url), { method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "compose", message: "Design the complete feature and ask before coding.", receivedAt: new Date().toISOString() }) });
  assert.equal(response.status, 202);
  assert.equal((await f.runtime.whenIdle()).status, "waiting-answer", f.errors.map((e) => e.stack).join("\n"));
  events.touch();
  await browser.waitFor("document.querySelectorAll('[data-artifact-tab]').length === 3 && document.querySelector('.human-loop select')");
  assert.equal(await browser.evaluate("document.querySelectorAll('[data-design-perspective]').length"), 0);
  const produced = await f.runtime.currentDesign();
  assert.equal(produced.content.schemaVersion, "sketch-design/v3");
  assert.deepEqual(await browser.evaluate("JSON.parse(document.querySelector('#design-raw').textContent)"), produced.content);
  await browser.evaluate(`(() => {
    const select=document.querySelector('.human-loop select'); select.value='option:build'; select.dispatchEvent(new Event('change',{bubbles:true}));
    document.querySelector('[data-human-loop-action="submitAnswers"]').click();
  })()`);
  await waitFor(async () => (await f.runtime.state()).requests.length === 2, "source-bound Canvas answer admission");
  assert.equal((await f.runtime.whenIdle()).status, "ready", f.errors.map((e) => e.stack).join("\n"));
  assert.equal((await f.runtime.state()).cycles.length, 0, "A Designer answer is not implementation authorization.");
  assert.deepEqual(f.history.map(({ role }) => role), ["router", "designer", "router", "agent"]);
  const implementation = await fetch(new URL("/api/requests", provider.url), { method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "explicit-build", message: "Implement the agreed Design now.", receivedAt: new Date().toISOString() }) });
  assert.equal(implementation.status, 202);
  assert.equal((await f.runtime.whenIdle()).status, "ready", f.errors.map((e) => e.stack).join("\n"));
  events.touch();
  await browser.waitFor("document.querySelector('#current-state-title').textContent === 'Ready'");
  const state = await f.runtime.state();
  assert.deepEqual(f.history.map(({ role }) => role), ["router", "designer", "router", "agent", "router", "planner", "implementer", "implementer", "implementer", "reviewer"]);
  assert.equal(state.cycles[0].acceptance.authority, "host");
  assert.equal(state.cycles[0].tasks.every(({ status }) => status === "completed"), true);
  assert.equal(state.handoffs.at(-1).result.outcome.kind, "review-result");
  assert.match(await readFile(join(f.project, "TANDEM.md"), "utf8"), /interaction#deliver/);
  assert.equal((await f.runtime.currentDesign()).binding.digest, produced.binding.digest);
  assert.deepEqual(browser.exceptions, []);
});

test("Review preserves more than96 aggregate references while rejecting invalid or oversized individual lists", { timeout: 120_000 }, async (t) => {
  const content = retainedDesignV1();
  content.artifacts = ["catalog-a", "catalog-b", "catalog-c"].map((id) => ({
    schemaVersion: "sketch/v1", id, title: id,
    boxes: Array.from({ length: 40 }, (_, i) => ({ id: `element-${i}`, label: `Item ${i}`,
      x: (i % 8) * 7, y: Math.floor(i / 8) * 4, w: 6, h: 3 })),
    connections: [],
  }));
  content.outcomes[0].references = ["catalog-a"];
  const refs = designReferenceCatalog(content).map(({ reference }) => reference);
  assert.equal(refs.length, 123);
  const largeDesign = { binding: { revisionId: "large-design", digest: policyHash(content) }, content };
  const f = await fixture(t, async (packet, session, runtime) => {
    if (packet.binding.role === "router") return route(session, packet, "implement");
    if (packet.binding.role === "planner") {
      const value = plan(packet);
      value.tasks[0].designRefs = refs.slice(0, 60); value.tasks[1].designRefs = refs.slice(60, 120);
      const tooMany = structuredClone(value); tooMany.tasks[0].designRefs = refs.slice(0, 97);
      await deniedResult(session, packet, "submit_internal_plan", { kind: "internal-plan", plan: tooMany }, /96/);
      const unknown = structuredClone(value); unknown.tasks[0].designRefs[0] = "catalog-a#missing";
      await deniedResult(session, packet, "submit_internal_plan", { kind: "internal-plan", plan: unknown }, /Unknown Design reference/);
      assert.equal((await runtime.state()).activeTask.stagedResult, null);
      return submit(session, packet, "submit_internal_plan", { kind: "internal-plan", plan: value });
    }
    if (packet.binding.role === "reviewer") {
      const evidence = JSON.parse(await session.call("read_cycle_changes", {}));
      assert.deepEqual(evidence.design.references, refs.slice(0, 120));
      const outcome = { kind: "review-result", planDigest: packet.context.cycle.plan.digest,
        summary: "All120 unique producing references were considered.",
        assessments: [], findings: [], verificationLimits: [], evidenceRefs: ["engine.js", "view.js"], questions: [] };
      const tooMany = { ...outcome, findings: [{ ...reviewDecisionFinding, designRefs: refs.slice(0, 97) }],
        questions: [{ ...reviewDecisionQuestion, designRefs: refs.slice(0, 97) }] };
      await deniedResult(session, packet, "submit_whole_plan_review", tooMany, /96/);
      const unknown = { ...outcome, findings: [{ ...reviewDecisionFinding, designRefs: ["catalog-a#missing"] }],
        questions: [{ ...reviewDecisionQuestion, designRefs: ["catalog-a#missing"] }] };
      await deniedResult(session, packet, "submit_whole_plan_review", unknown, /Unknown Design reference/);
      assert.equal((await runtime.state()).activeTask.stagedResult, null);
      return submit(session, packet, "submit_whole_plan_review", outcome);
    }
    return ordinary(packet, session);
  }, { readDesign: async () => largeDesign });
  await f.send("large-reference-plan", "Implement both bounded tasks with the relevant Design references.");
  assert.equal((await f.runtime.whenIdle()).status, "ready", f.errors.map((e) => e.stack).join("\n"));
  const index = await readFile(join(f.project, "TANDEM.md"), "utf8");
  for (const reference of refs.slice(0, 120)) assert.ok(index.includes(`\`${reference}\``), reference);
  assert.equal((await f.runtime.state()).handoffs.at(-1).result.outcome.kind, "review-result");
});

test("prepare-replan keeps old plan reference buttons bound to DesignA while paused on targetDesignB", { skip: !browserAvailable, timeout: 180_000 }, async (t) => {
  const events = new HumanLoopEvents(), permissions = new PermissionBroker(events);
  let published = 0, plans = 0;
  const f = await fixture(t, async (packet, session) => {
    const { role, requestId, internalTaskId } = packet.binding;
    if (role === "router") {
      const refs = packet.context.request.answers?.answers.map(({ questionId, sourceResultId }) => ({ questionId, sourceResultId })) ?? [];
      const intent = requestId === "compose-a" || requestId === "change-design" ? "design"
        : requestId === "begin-a" ? "implement" : "replan-cycle";
      return route(session, packet, intent, intent === "replan-cycle" ? "cycle:begin-a" : null, refs);
    }
    if (role === "designer") {
      const value = sharedDesign();
      if (published++) value.artifacts[0].boxes.find(({ id }) => id === "deliver").details = "DesignB keeps this ID but changes its meaning.";
      const raw = await session.call("stage_human_design", value);
      const staged = typeof raw === "string" ? JSON.parse(raw) : raw;
      return submit(session, packet, "submit_designer_outcome", { kind: "designer-changed",
        summary: published === 1 ? "DesignA published." : "DesignB published.", artifactRef: staged.artifactRef,
        questions: published === 1 ? [] : [{ ...question, designRefs: ["interaction#deliver"] }] });
    }
    if (role === "planner" && plans++ > 0) return submit(session, packet, "raise_implementation_design_concern", {
      kind: "design-concern", reason: "The new target still needs a product decision.",
      summary: "Replanning is paused without replacing the old accepted plan.", questions: [{ ...question, designRefs: ["interaction#deliver"] }],
    });
    if (role === "implementer" && internalTaskId === "view") return submit(session, packet, "raise_implementation_design_concern", {
      kind: "design-concern", reason: "The Design must change before the remaining task.",
      summary: "Keep completed code and ask for a changed Design.", questions: [{ ...question, designRefs: ["interaction#deliver"] }],
    });
    return ordinary(packet, session);
  }, { realDesign: true });
  await f.send("compose-a", "Create DesignA only."); await f.runtime.whenIdle();
  const designA = (await f.runtime.currentDesign()).binding;
  await f.send("begin-a", "Begin implementing DesignA."); await f.runtime.whenIdle();
  const answer = async (id, text) => {
    const state = await f.runtime.state(), q = state.questions.findLast(q => q.state === "open");
    await f.send(id, text, { schemaVersion: "human-question-answers/v1", answers: [
      { questionId: q.id, sourceResultId: q.source.resultId, kind: "option", value: "change" },
    ] });
    await f.runtime.whenIdle();
  };
  await answer("change-design", "Change the Design as requested.");
  const designB = (await f.runtime.currentDesign()).binding;
  assert.notEqual(designA.revisionId, designB.revisionId);
  await answer("replan-b", "Replan remaining work for DesignB.");
  const state = await f.runtime.state();
  assert.equal(state.cycles[0].phase, "waiting-input", f.errors.map((e) => e.stack).join("\n"));
  assert.deepEqual(state.cycles[0].design, designB);
  assert.deepEqual(state.cycles[0].plan.design, designA);
  const installation = { runtime: f.runtime, read: async () => ({ status: "ready", canStart: false, canReopen: false }) };
  const provider = await createHumanLoopProvider({ repositoryRoot: f.project,
    publicDirectory: fileURLToPath(new URL("../public", import.meta.url)), getInstallation: () => installation, events, permissions, start: async () => {} });
  const browserCleanups = [];
  t.after(async () => { for (const cleanup of browserCleanups) await cleanup(); await provider.close(); events.close(); });
  const projected = await (await fetch(new URL("/api/snapshot", provider.url))).json();
  assert.deepEqual(projected.workflow.currentCycle.design, designB);
  assert.deepEqual(projected.workflow.currentCycle.plan.design, designA);
  const browser = await openFixtureBrowser({ after: (cleanup) => browserCleanups.push(cleanup) });
  await browser.call("Emulation.setDeviceMetricsOverride", { width: 1450, height: 1050, deviceScaleFactor: 1, mobile: false });
  await browser.call("Page.navigate", { url: provider.url });
  await browser.waitFor("document.querySelector('.human-loop [data-design-reference]') && document.querySelector('.shared-sketch')");
  await browser.evaluate(`(() => {
    const plan=[...document.querySelectorAll('#human-cycle-progress details')].find(d=>d.querySelector('summary')?.textContent.startsWith('Technical details'));
    plan.open=true;
    plan.querySelector('[data-design-reference="interaction#deliver"]').click();
  })()`);
  assert.match(await browser.evaluate("document.querySelector('#notice').textContent"), /another retained Design revision/);
  assert.equal(await browser.evaluate("document.querySelector('.artifact-element-details').hidden"), true);
  assert.equal(await browser.evaluate("document.querySelector('#current-state-title').textContent"), "Waiting for your answers");
  await browser.evaluate("document.querySelector('.human-loop-questions fieldset [data-design-reference=\"interaction#deliver\"]').click()");
  assert.match(await browser.evaluate("document.querySelector('.artifact-element-details').textContent"), /DesignB keeps this ID/);
  assert.deepEqual((await f.runtime.currentDesign()).binding, designB);
  assert.deepEqual(browser.exceptions, []);
});

test("Host completes internal tasks and whole-plan boundary before first Review, then presents before dequeuing user input", { timeout: 180_000 }, async (t) => {
  const firstTask = Promise.withResolvers(), continueTask = Promise.withResolvers();
  const handoffReached = Promise.withResolvers(), showHandoff = Promise.withResolvers();
  const f = await fixture(t, async (packet, session) => {
    if (packet.binding.role === "router") return route(session, packet, packet.binding.requestId === "implement" ? "implement" : "answer");
    if (packet.binding.internalTaskId === "engine") { firstTask.resolve(); await continueTask.promise; }
    return ordinary(packet, session);
  }, { onHandoff: async (handoff) => {
    if (handoff.result.outcome.kind === "review-result") { handoffReached.resolve(); await showHandoff.promise; }
  } });
  await f.send("implement", "Implement the complete requested feature.");
  await firstTask.promise;
  await f.send("follow-up", "When finished, explain what changed without editing anything.");
  continueTask.resolve();
  await handoffReached.promise;
  assert.deepEqual(f.history.map(({ role, taskId }) => [role, taskId]), [
    ["router", null], ["planner", null], ["implementer", "engine"], ["implementer", "view"], ["implementer", null], ["reviewer", null],
  ]);
  assert.equal((await f.runtime.state()).requests.find(({ id }) => id === "follow-up").status, "waiting");
  assert.equal((await f.runtime.state()).requests[0].status, "handoff-pending");
  showHandoff.resolve();
  assert.equal((await f.runtime.whenIdle()).status, "ready", f.errors.map((error) => error.stack).join("\n"));
  assert.equal(f.errors.length, 0);
  const state = await f.runtime.state();
  assert.equal(state.cycles.length, 1);
  assert.equal(state.cycles[0].acceptance.authority, "host");
  assert.equal(state.cycles[0].phase, "completed");
  assert.equal(state.requests.every(({ status }) => status === "completed"), true);
  assert.match(await readFile(join(f.project, "original.txt"), "utf8"), /pre-existing dirty/);
  assert.match(await readFile(join(f.project, "engine.js"), "utf8"), /engine/);
  assert.match(f.handoffs[0].content, /Code is already in your project workspace/);
  assert.match((await f.runtime.conversation()).at(-1).content, /not an Apply request/);
});

for (const phase of ["planning", "coding"]) for (const answerKind of ["option", "freeform"]) {
  test(`${phase} Design concern and question-UI ${answerKind} answer resume the same unfinished plan without replaying completed tasks`, { timeout: 180_000 }, async (t) => {
    let concerned = false;
    const f = await fixture(t, async (packet, session) => {
      if (packet.binding.role === "router") {
        if (packet.binding.requestId === "implement") return route(session, packet, "implement");
        if (!packet.context.request.answers) return route(session, packet, "answer");
        const cycle = packet.context.boundCycles[0], question = packet.context.questions[0];
        assert.equal(packet.context.originalRequest.message, "Implement both parts.");
        assert.equal(cycle.originRequestId, "implement");
        assert.equal(packet.context.request.answers.answers[0].kind, answerKind);
        return route(session, packet, "resume-cycle", cycle.id, [{
          questionId: question.id, sourceResultId: question.source.resultId,
        }]);
      }
      if (!concerned && ((phase === "planning" && packet.binding.role === "planner")
        || (phase === "coding" && packet.binding.internalTaskId === "view"))) {
        concerned = true;
        if (phase === "coding") await patchFile(session, { path: "view.js", expectedDigest: null, content: "// partial view retained\n" });
        return submit(session, packet, "raise_implementation_design_concern", { kind: "design-concern",
          reason: "This interaction needs the user's Design direction.", summary: "The work cycle is unfinished.", questions: [question] });
      }
      return ordinary(packet, session);
    });
    await f.send("implement", "Implement both parts.");
    assert.equal((await f.runtime.whenIdle()).status, "waiting-answer", f.errors.map((error) => error.stack).join("\n"));
    assert.equal(f.errors.length, 0);
    const waiting = await f.runtime.state(), cycleId = waiting.cycles[0].id;
    assert.equal(waiting.cycles[0].phase, "waiting-input");
    assert.equal(f.history.some(({ role }) => role === "reviewer" || role === "designer"), false);
    const q = waiting.questions[0];
    await f.send("answer", "Answers submitted from the shared question form.", {
      schemaVersion: "human-question-answers/v1",
      answers: [{ questionId: q.id, sourceResultId: q.source.resultId, kind: answerKind,
        value: answerKind === "option" ? "keep" : "Keep the current Design and continue the remaining work." }],
    });
    assert.equal((await f.runtime.whenIdle()).status, "ready", f.errors.map((error) => error.stack).join("\n"));
    assert.equal(f.errors.length, 0);
    const state = await f.runtime.state();
    assert.equal(state.cycles.length, 1);
    assert.equal(state.cycles[0].id, cycleId);
    assert.equal(state.cycles[0].phase, "completed");
    assert.equal(state.cycles[0].planHistory.length, 0);
    assert.equal(f.history.filter(({ taskId }) => taskId === "engine").length, 1);
    assert.equal(f.history.filter(({ role }) => role === "reviewer").length, 1);
  });
}

for (const envelopes of ["combined", "separate"]) test(`current Q&A ${envelopes} answer envelopes take FIFO priority as barriers before ordinary queued-message batching`, { timeout: 180_000 }, async (t) => {
  const planningReached = Promise.withResolvers(), releasePlanning = Promise.withResolvers();
  let admissionGate = null;
  let concerned = false;
  const f = await fixture(t, async (packet, session) => {
    const request = packet.context.request;
    if (packet.binding.role === "router") {
      if (request.id === "implement") return route(session, packet, "implement");
      if (!request.answers) {
        assert.deepEqual(packet.context.requests.map(({ id }) => id), ["ordinary-a", "ordinary-b"]);
        assert.deepEqual(packet.context.requests.map(({ message }) => message), [
          "  Keep the current Design and continue.\nThis is ordinary queued chat.", "When finished, explain without editing.",
        ]);
        return route(session, packet, "answer");
      }
      assert.deepEqual(packet.context.requests.map(({ id }) => id), [request.id], "Answer envelopes are never merged.");
      if (request.id === "answer-first") {
        assert.deepEqual(packet.context.pendingQuestionAnswers.map(answer => answer.requestId), ["answer-second"]);
        assert.equal(packet.context.pendingQuestionAnswers[0].status, "waiting");
      }
      const refs = request.answers.answers.map(({ questionId, sourceResultId }) => ({ questionId, sourceResultId }));
      const remaining = packet.context.questions.filter((q) => q.state === "open" && q.importance === "blocking"
        && !refs.some((ref) => ref.questionId === q.id && ref.sourceResultId === q.source.resultId));
      const pending = remaining.length || packet.context.pendingQuestionAnswers.some(answer =>
        answer.cycleIds.includes(packet.context.boundCycles[0]?.id));
      return route(session, packet, pending ? "answer" : "resume-cycle",
        pending ? null : packet.context.boundCycles[0].id, refs);
    }
    if (packet.binding.role === "planner" && !concerned) {
      concerned = true; planningReached.resolve(); await releasePlanning.promise;
      return submit(session, packet, "raise_implementation_design_concern", { kind: "design-concern",
        reason: "Two related product decisions are required.", summary: "Planning needs your direction.",
        questions: [question, { ...question, id: "second" }] });
    }
    if (packet.binding.role === "agent" && request.answers) {
      const readiness = await f.runtime.readiness();
      assert.equal(readiness.status, "working");
      const pending = await f.runtime.state();
      assert.equal(readiness.reason, pending.questions.some(q => q.state === "open" && q.blockingActive)
        ? "An effective prerequisite or its saved answer is still pending. Other queued messages remain preserved." : null,
      "Answers saved in another queued envelope are answered, but their processing still holds ordinary work.");
      assert.ok(pending.requests.filter(r => r.id.startsWith("ordinary-")).every(r => r.status === "waiting"));
      return submit(session, packet, "submit_readonly_answer", {
        kind: "answer", summary: "The partial answer was handled.", report: "The remaining current question still needs an answer in the form.", evidenceRefs: [],
      });
    }
    return ordinary(packet, session);
  }, { beforeAdmission: () => admissionGate?.promise });
  try {
    await f.send("implement", "Implement both parts.");
    await planningReached.promise;
    await f.send("ordinary-a", "  Keep the current Design and continue.\nThis is ordinary queued chat.");
    releasePlanning.resolve();
    assert.equal((await f.runtime.whenIdle()).status, "waiting-answer");
    await f.send("ordinary-b", "When finished, explain without editing.");
    assert.equal((await f.runtime.whenIdle()).status, "waiting-answer");
    assert.equal((await f.runtime.readiness()).reason, "An effective prerequisite or its saved answer is still pending. Other queued messages remain preserved.");
    assert.equal(f.history.length, 2, "No ordinary queued message ran while the current question was unanswered.");
    const questions = (await f.runtime.state()).questions;
    const answer = (q) => ({ questionId: q.id, sourceResultId: q.source.resultId, kind: "option", value: "keep" });
    if (envelopes === "combined") await f.send("answer-both", "Question form submission.",
      { schemaVersion: "human-question-answers/v1", answers: questions.map(answer) });
    else {
      admissionGate = Promise.withResolvers();
      await f.send("answer-first", "First question form submission.", { schemaVersion: "human-question-answers/v1", answers: [answer(questions[0])] });
      await f.send("answer-second", "Second question form submission.", { schemaVersion: "human-question-answers/v1", answers: [answer(questions[1])] });
      admissionGate.resolve(); admissionGate = null;
    }
    assert.equal((await f.runtime.whenIdle()).status, "ready", f.errors.map((error) => error.stack).join("\n"));
    assert.equal(f.errors.length, 0);
    const state = await f.runtime.state();
    assert.deepEqual(state.requests.map(({ id }) => id), envelopes === "combined"
      ? ["implement", "ordinary-a", "ordinary-b", "answer-both"]
      : ["implement", "ordinary-a", "ordinary-b", "answer-first", "answer-second"]);
    assert.equal(state.requests.every(({ status }) => status === "completed"), true);
    assert.deepEqual(f.history.filter(({ role }) => role === "router").map(({ requestId }) => requestId), envelopes === "combined"
      ? ["implement", "answer-both", "ordinary-a"] : ["implement", "answer-first", "answer-second", "ordinary-a"]);
    assert.deepEqual(f.handoffs.at(-1).requestIds, ["ordinary-a", "ordinary-b"]);
    assert.equal(f.history.filter(({ taskId }) => taskId === "engine").length, 1);
  } finally { admissionGate?.resolve(); releasePlanning.resolve(); }
});

test("product WAL atomically saves mixed answers, retries lost acknowledgement, holds processing and replays fresh v2", { timeout: 90_000 }, async (t) => {
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  const f = await fixture(t, async (packet, session) => {
    if (packet.binding.role === "router") {
      if (packet.binding.requestId === "saved-answer") { entered.resolve(packet); await release.promise; }
      return route(session, packet, packet.binding.requestId === "ask" ? "design" : "answer");
    }
    if (packet.binding.role === "designer") return submit(session, packet, "submit_designer_outcome", {
      kind: "designer-unchanged", summary: "Two choices.", explanation: "Current Design retained.",
      questions: [question, { ...question, id: "optional", importance: "advisory" }],
    });
    return ordinary(packet, session);
  }, { realDesign: true });
  try {
    await f.send("ask", "Discuss the choices.");
    assert.equal((await f.runtime.whenIdle()).status, "waiting-answer", f.errors.map(e => e.stack).join("\n"));
    await f.send("normal", "Explain current state after the prerequisite is processed."); await f.runtime.whenIdle();
    const before = await f.runtime.state(), sourceResultId = before.questions[0].source.resultId;
    const request = { id: "saved-answer", message: "Consider both selected answers in context.", receivedAt: new Date().toISOString(),
      answers: { schemaVersion: "human-question-answers/v1", answers: ["scope", "optional"].map(questionId => ({
        questionId, sourceResultId, kind: "option", value: "keep",
      })) } };
    let fault = "before";
    const transact = HostStateFile.prototype.transact;
    t.mock.method(HostStateFile.prototype, "transact", async function(cause, prepare) {
      if (cause !== "human-loop:receive-request") return transact.call(this, cause, prepare);
      const result = await transact.call(this, cause, async content => {
        const prepared = await prepare(content);
        if (fault === "before") throw new Error("Injected precommit answer failure.");
        return prepared;
      });
      if (fault === "after") throw new Error("Injected lost answer acknowledgement.");
      return result;
    });
    await assert.rejects(f.runtime.send(request), /precommit answer failure/);
    assert.deepEqual(await f.runtime.store.load(), before, "No partial answered state or request was published.");
    fault = "after";
    await assert.rejects(f.runtime.send(request), /lost answer acknowledgement/);
    const saved = await f.runtime.store.load(), accepted = saved.requests.find(r => r.id === request.id);
    assert.equal(accepted.status, "waiting");
    assert.deepEqual(accepted.blockingAnswerRefs, [{ questionId: "scope", sourceResultId }]);
    assert.equal(accepted.answers.answers.length, 2);
    assert.ok(saved.questions.every(q => q.state === "answered" && q.answerRequestId === request.id));
    fault = null;
    await Promise.all([f.runtime.send(request), f.runtime.send(structuredClone(request))]);
    const packet = await entered.promise;
    assert.equal(packet.context.questionAnswers.length, 2);
    assert.ok(packet.context.questionAnswers.every(answer => answer.originalRequests[0].id === "ask"
      && answer.answer.selectedOption.label === "Keep the current Design"));
    assert.equal(f.history.some(entry => entry.requestId === "normal"), false, "Saved answered state does not release unfinished processing.");
    await assert.rejects(f.runtime.send({ ...request, message: "Conflicting rewrite" }), /Conflicting retry/);
    release.resolve(); await f.runtime.whenIdle();
    assert.deepEqual(f.history.filter(entry => entry.role === "router").map(entry => entry.requestId), ["ask", request.id, "normal"]);
    assert.equal((await f.runtime.state()).requests.filter(r => r.id === request.id).length, 1);
    await f.runtime.close();
    const closed = await f.runtime.state(), store = new HumanLoopStore(closed.owner);
    assert.deepEqual(await store.load(), closed, "Fresh WAL reopen deterministically replays answers and canonical priorities.");
    const ledger = new HostStateFile(f.project, join(f.project, ".tandem", "living-canvas", "human-loop", "ledger.json"));
    await ledger.mutate("incompatible-fixture", content => {
      const value = JSON.parse(content); value.schemaVersion = "human-loop-ledger/v1";
      return { content: JSON.stringify(value), result: null };
    });
    const incompatible = await ledger.read();
    await assert.rejects(store.load(), /fresh workspace/);
    assert.equal(await ledger.read(), incompatible, "Incompatible-state rejection never converts saved state.");
    await store.close();
  } finally { release.resolve(); }
});

test("Runtime Stop while awaiting current question discards queued work and permits later new input without answering it", { timeout: 90_000 }, async (t) => {
  const f = await fixture(t, async (packet, session) => {
    if (packet.binding.role === "router") return route(session, packet, packet.context.request.id === "implement" ? "implement" : "answer");
    if (packet.binding.role === "planner") return submit(session, packet, "raise_implementation_design_concern", {
      kind: "design-concern", summary: "Planning is unfinished.", reason: "A product choice is needed.", questions: [question],
    });
    return submit(session, packet, "submit_readonly_answer", {
      kind: "answer", summary: "The old work was stopped.", report: "The prior work cycle is stopped; no code was rolled back.", evidenceRefs: [],
    });
  });
  await f.send("implement", "Implement both parts.");
  assert.equal((await f.runtime.whenIdle()).status, "waiting-answer");
  await f.send("old", "Keep the current Design and continue.");
  assert.equal((await f.runtime.whenIdle()).status, "waiting-answer");
  await f.runtime.stop("explicit-stop");
  await f.runtime.whenIdle();
  let state = await f.runtime.state();
  assert.equal(state.questions[0].state, "open");
  assert.equal(state.questions[0].blockingActive, false);
  assert.equal(state.cycles[0].phase, "stopped");
  assert.equal(state.requests.find(({ id }) => id === "old").status, "discarded");
  await f.send("new", "Explain the retained state.");
  assert.equal((await f.runtime.whenIdle()).status, "ready", f.errors.map((error) => error.stack).join("\n"));
  state = await f.runtime.state();
  assert.equal(state.requests.find(({ id }) => id === "new").status, "completed");
  assert.equal(state.cycles[0].phase, "stopped");
  assert.equal(f.errors.length, 0);
  assert.match(await readFile(join(f.project, "original.txt"), "utf8"), /pre-existing dirty/);
});

test("read-only command denial is reported honestly and does not start a command or enter recovery", { timeout: 90_000 }, async (t) => {
  const permissions = [];
  const f = await fixture(t, async (packet, session) => {
    if (packet.binding.role === "router") return route(session, packet, "answer");
    let denied = false;
    try { await session.call("powershell", { command: "node --version", shellId: "version" }); }
    catch { denied = true; }
    assert.equal(denied, true);
    return submit(session, packet, "submit_readonly_answer", {
      kind: "answer", summary: "Permission was denied.", report: "The Node version is unknown because the requested command was denied and did not run.", evidenceRefs: [],
    });
  }, { permissionHandler: async (request) => { permissions.push(request); return { kind: "reject", feedback: "The user denied this command." }; } });
  await f.send("check", "Check the Node version without editing files.");
  assert.equal((await f.runtime.whenIdle()).status, "ready", f.errors.map((error) => error.stack).join("\n"));
  assert.equal(f.errors.length, 0);
  assert.equal(permissions.length, 1);
  assert.equal(permissions[0].kind, "shell");
  assert.equal((await f.runtime.commands.read()).commands.length, 0);
  assert.match(f.handoffs[0].content, /unknown.*denied/);
  assert.equal((await f.runtime.state()).uncertainty, null);
});

test("safely rejected foreign pre-dispatch callbacks do not poison the owned workflow", { timeout: 90_000 }, async t => {
  const f = await fixture(t, async (packet, session, runtime) => {
    if (packet.binding.role === "router") {
      const denied = await session.config.hooks.onPreToolUse({ sessionId: "another", toolName: "powershell",
        toolArgs: { command: "not-executed" } }, { sessionId: "another" });
      assert.equal(denied.permissionDecision, "deny");
      const permission = await session.config.onPermissionRequest({ kind: "read", toolCallId: "not-admitted", path: "not-read" },
        { sessionId: "another" });
      assert.equal(permission.kind, "reject");
      assert.equal((await runtime.state()).uncertainty, null);
      return route(session, packet, "answer");
    }
    return ordinary(packet, session);
  });
  await f.send("safe-rejection", "Describe the existing workspace.");
  assert.equal((await f.runtime.whenIdle()).status, "ready", f.errors.map(error => error.stack).join("\n"));
  assert.equal((await f.runtime.commands.read()).nativeSessions.length, 0);
  assert.equal((await f.runtime.store.messages()).filter(message => message.id.startsWith("diagnostic:")).length, 0);
});

test("native command grant and completion retain the exact workspace and task provenance", { timeout: 90_000 }, async (t) => {
  const permissions = [], activity = [], provenance = [];
  const f = await fixture(t, async (packet, session) => {
    if (packet.binding.role === "router") return route(session, packet, "answer");
    const result = JSON.parse(await session.call("powershell", { command: "node --version", shellId: "version" }));
    assert.equal(result.exitCode, 0);
    return submit(session, packet, "submit_readonly_answer", {
      kind: "answer", summary: "The Node version was checked.", report: `The requested command succeeded: ${result.output.trim()}`, evidenceRefs: [result.id],
    });
  }, { permissionHandler: async (request, _invocation, lifetime) => {
    permissions.push(request); provenance.push(lifetime.provenance); return { kind: "approve-once" };
  }, onProgress: event => { if (event.kind === "native-shell") activity.push(projectHumanProgress(event)); } });
  await f.send("check", "Check the installed Node version without editing code.");
  assert.equal((await f.runtime.whenIdle()).status, "ready", f.errors.map((error) => error.stack).join("\n"));
  assert.equal(f.errors.length, 0);
  const commands = (await f.runtime.commands.read()).nativeSessions;
  assert.equal(commands.length, 1);
  assert.equal(commands[0].exitCode, 0);
  const evidence = await f.runtime.commands.evidenceForCycle(null);
  assert.equal(evidence[0].observations[0].requestId, "check");
  assert.equal(evidence[0].specification.command, "node --version");
  assert.equal(permissions.length, 1);
  assert.equal(permissions[0].kind, "shell");
  assert.equal(permissions[0].fullCommandText, "node --version");
  assert.deepEqual(provenance[0], { toolName: "powershell", taskId: commands[0].taskId, requestId: "check", role: "agent" });
  assert.equal(activity.length, 1);
  assert.deepEqual(activity[0].data.activity, { sessionId: "private", taskId: commands[0].taskId,
    requestId: "check", role: "agent", toolName: "powershell", toolCallId: commands[0].toolCallId });
  assert.equal(activity[0].data.status, "succeeded");
});

test("native optional labels, reuse and detached arguments pass hooks without false process authority or workflow holds", { timeout: 90_000 }, async t => {
  const invocations = [], permissions = [];
  const argumentsList = [
    { command: "fixture-only", mode: "async" },
    { command: "fixture-only", mode: "async", shellId: "reusable" },
    { command: "fixture-only", mode: "async", shellId: "reusable" },
    { command: "fixture-only", mode: "async", shellId: "native-detached", detach: true },
  ];
  const f = await fixture(t, async (packet, session, runtime) => {
    if (packet.binding.role === "router") return route(session, packet, "answer");
    if (packet.binding.requestId === "native-contract") {
      for (const args of argumentsList) await session.call("powershell", args);
      const before = structuredClone((await runtime.commands.read()).nativeSessions);
      session.emit("system.notification", { kind: { type: "shell_completed", shellId: "reusable", exitCode: 0 } });
      session.emit("assistant.message", { content: "", toolRequests: [{ toolCallId: "ambiguous-read", name: "read_powershell",
        arguments: { shellId: "reusable", delay: 0 } }] });
      session.emit("tool.execution_start", { toolCallId: "ambiguous-read", toolName: "read_powershell",
        arguments: { shellId: "reusable", delay: 0 } });
      await runtime.transport.drain();
      session.emit("tool.execution_complete", { toolCallId: "ambiguous-read", success: true });
      await runtime.transport.drain();
      assert.deepEqual((await runtime.commands.read()).nativeSessions, before, "A late reused label cannot settle either invocation.");
    }
    return submit(session, packet, "submit_readonly_answer", { kind: "answer", summary: "Native work reported.",
      report: "Unbound process outcomes are not inferred; this answer has its own normal root completion.", evidenceRefs: [] });
  }, { nativeShell: async args => { invocations.push(structuredClone(args)); return { contents: [] }; },
    permissionHandler: async request => { permissions.push(request); return { kind: "approve-once" }; } });
  await f.send("native-contract", "Use the scoped fixture native calls.");
  assert.equal((await f.runtime.whenIdle()).status, "ready", f.errors.map(error => error.stack).join("\n"));
  assert.deepEqual(invocations, argumentsList);
  assert.equal(permissions.length, argumentsList.length);
  assert.equal((await f.runtime.state()).uncertainty, null);
  const entries = (await f.runtime.commands.read()).nativeSessions;
  assert.equal(new Set(entries.map(entry => entry.toolCallId)).size, 4);
  assert.deepEqual(entries.map(entry => entry.status), ["held", "held", "held", "held"]);
  assert.ok(entries.every(entry => !entry.canStop && !entry.completionNotification));
  await f.send("independent", "Answer a later ordinary request.");
  assert.equal((await f.runtime.whenIdle()).status, "ready");
  assert.deepEqual((await f.runtime.state()).requests.map(request => request.status), ["completed", "completed"]);
  await f.runtime.close();
  assert.deepEqual(f.errors, []);
});

test("actual native agent Stop response clears process state while typed role completion remains independent", { timeout: 60_000 }, async t => {
  const tasks = [];
  const f = await fixture(t, async (packet, session, runtime) => {
    if (packet.binding.role === "router") return route(session, packet, "answer");
    await session.call("powershell", { command: "Write-Output native-fixture", mode: "async" });
    await session.call("read_powershell", { shellId: "11", delay: 0 });
    const before = (await runtime.commands.read()).nativeSessions[0];
    assert.equal(before.canStop, true);
    await session.call("stop_powershell", { shellId: "11" });
    const after = (await runtime.commands.read()).nativeSessions[0];
    assert.equal(after.status, "stopped"); assert.equal(after.exitCode, null);
    assert.equal(after.canStop, false); assert.equal(after.controlUnbound, false);
    const state = await runtime.state();
    assert.equal(state.activeTask.binding.id, packet.binding.id);
    assert.equal(state.activeTask.result, null); assert.equal(state.stop, null);
    return submit(session, packet, "submit_readonly_answer", { kind: "answer",
      summary: "Native work finished.", report: "The native command was stopped, not successfully exited.", evidenceRefs: [] });
  }, { permissionHandler: () => ({ kind: "approve-once" }),
    nativeShell: async args => {
      assert.equal(args.shellId, undefined);
      tasks.push({ id: "11", type: "shell", command: args.command, status: "running",
        startedAt: new Date().toISOString(), attachmentMode: "attached", executionMode: "background" });
      return { content: "<command started in background with shellId: 11>" };
    },
    nativeControl: async (name, args) => {
      assert.equal(args.shellId, "11");
      if (name === "stop_powershell") {
        tasks.length = 0;
        return { content: "<command with id: 11 stopped>" };
      }
      return { content: "<command with shellId: 11 is still running after 0 seconds.>" };
    } });
  f.session.rpc.tasks = { list: async () => ({ tasks: structuredClone(tasks) }),
    cancel: async () => assert.fail("Agent native Stop must not dispatch panel cancellation.") };
  await f.send("native-stop", "Run and stop the scoped native fixture.");
  const readiness = await f.runtime.whenIdle();
  assert.equal(readiness.status, "ready", f.errors.map(error => error.stack).join("\n"));
  const state = await f.runtime.state();
  assert.equal(state.uncertainty, null);
  assert.equal(state.executions.filter(execution => execution.result?.outcome.kind === "answer").length, 1);
  assert.equal(state.requests[0].status, "completed");
  assert.deepEqual(f.errors, []);
});

test("a declared result still completes while native shell continuation remains outstanding", async t => {
  const f = await fixture(t, async (packet, session) => {
    if (packet.binding.role === "router") return route(session, packet, "answer");
    await session.call("powershell", { command: "fixture-only", initial_wait: 180 });
    return submit(session, packet, "submit_readonly_answer", { kind: "answer",
      summary: "The requested background work has started.", report: "The native command is still running.", evidenceRefs: [] });
  }, { permissionHandler: () => ({ kind: "approve-once" }), nativeShell: async () => ({
    content: "<command with shellId:4 is still running after 180 seconds; end response with no tool calls to wait>",
  }) });
  f.session.rpc.tasks = { list: async () => ({ tasks: [] }) };
  const abort = t.mock.method(f.session, "abort");
  await f.send("declared", "Start the requested native work and report that it started.");
  assert.equal((await f.runtime.whenIdle()).status, "ready");
  const task = (await f.runtime.state()).executions.find(item => item.binding.role === "agent");
  assert.equal(task.completion, "result-submission");
  assert.equal(task.end, null);
  assert.equal(abort.mock.callCount(), 0);
  assert.deepEqual(f.errors, []);
});

for (const [mapping, notification, nativePermissionRequired = true] of [["unique", "before"], ["unique", "missing"], ["unique", "delayed"],
  ["unavailable", "before"], ["ambiguous", "before"], ["unique", "before", false]]) test(`native text-only sync rollover retains its role through natural same-interaction continuation (${mapping}, ${notification} notification, permission callback ${nativePermissionRequired})`, { timeout: 60_000 }, async t => {
  const continueModel = Promise.withResolvers(), waiting = Promise.withResolvers();
  const tasks = [], command = "node synthetic-install-fixture.mjs";
  const f = await fixture(t, async (packet, session, runtime) => {
    if (packet.binding.role === "router") return route(session, packet, "answer");
    await session.call("powershell", { command, initial_wait: 180 });
    waiting.resolve(packet);
    session.emit("assistant.message", { content: "", toolRequests: [] });
    session.emit("assistant.turn_end", { turnId: session.turnId, interactionId: session.interactionId, aborted: false });
    session.endIdle();
    await continueModel.promise;
    await session.call("read_powershell", { shellId: "4", delay: 0 });
    await session.call("list_powershell", {});
    return submit(session, packet, "submit_readonly_answer", { kind: "answer",
      summary: "Native command finished.", report: "Natural native continuation completed the requested check.", evidenceRefs: [] });
  }, { nativePermissionRequired, permissionHandler: () => {
    assert.equal(nativePermissionRequired, true, "A native-authorized command does not require an invented permission callback.");
    return { kind: "approve-once" };
  }, nativeShell: async args => {
    assert.deepEqual(args, { command, initial_wait: 180 }, "Do not inject a shell label or rewrite native arguments.");
    tasks.push({ type: "shell", id: "4", command, startedAt: new Date().toISOString(),
      status: "running", attachmentMode: "attached", executionMode: "background" });
    if (mapping === "ambiguous") tasks.push({ ...tasks[0], id: "another" });
    return { content: "<command with shellId:4 is still running after 180 seconds; end response with no tool calls to wait>" };
  } });
  f.session.rpc.tasks = { list: async () => {
    if (mapping === "unavailable") throw new Error("Fixture task registry unavailable");
    return { tasks: structuredClone(tasks) };
  }, cancel: async () => assert.fail("Natural completion must not cancel anything.") };
  try {
    await f.send("native-wait", "Run the synthetic finite command and report its result.");
    const packet = await waiting.promise;
    await f.runtime.transport.drain();
    const before = await f.runtime.state();
    assert.equal(before.activeTask?.binding.id, packet.binding.id, "Native end-and-wait is not a missing typed result.");
    assert.equal(before.activeTask.result, null); assert.equal(before.uncertainty, null);
    const row = (await f.runtime.commands.read()).nativeSessions[0];
    assert.equal(row.canStop, mapping === "unique");
    assert.equal(row.shellId, mapping === "unique" ? "4" : null);
    if (mapping !== "unique") assert.match(row.reason, /unavailable|ambiguous/i);
    const interactionId = f.session.interactionId, sends = f.session.sends.length;
    tasks.forEach(task => { task.status = "completed"; task.completedAt = new Date().toISOString(); });
    const completed = () => {
      f.session.emit("system.notification", { kind: { type: "shell_completed", shellId: "4", exitCode: 0 } });
      f.session.emit("assistant.message", { content: "", toolRequests: [{
        toolCallId: "native-rollover-auto-read", name: "read_powershell", arguments: { shellId: "4", delay: 0 },
      }] });
      f.session.emit("tool.execution_start", { toolCallId: "native-rollover-auto-read", toolName: "read_powershell",
        arguments: { shellId: "4", delay: 0 } });
      f.session.emit("tool.execution_complete", { toolCallId: "native-rollover-auto-read", success: true,
        result: { content: "Synthetic command completed with exit code 0." } });
    };
    if (notification === "before") completed();
    await f.runtime.transport.drain();
    assert.equal((await f.runtime.state()).activeTask?.binding.id, packet.binding.id);
    f.session.turnId = "native-continuation"; f.session.processing = true;
    f.session.emit("assistant.turn_start", { turnId: f.session.turnId, interactionId });
    f.session.config.onEvent(structuredClone(f.session.events.at(-1)));
    continueModel.resolve();
    const readiness = await f.runtime.whenIdle();
    assert.equal(readiness.status, "ready", JSON.stringify({ readiness, errors: f.errors.map(error => error.message),
      uncertainty: (await f.runtime.state()).uncertainty }));
    const after = await f.runtime.state();
    assert.equal(after.uncertainty, null);
    assert.equal(after.executions.filter(e => e.binding.id === packet.binding.id).length, 1);
    assert.equal(after.executions.find(e => e.binding.id === packet.binding.id).result.outcome.kind, "answer");
    assert.equal(after.requests.find(r => r.id === "native-wait").status, "completed");
    assert.equal(f.session.sends.length, sends, "The native continuation is not a redispatch or new request.");
    if (notification === "delayed") { completed(); await f.runtime.transport.drain(); }
    if (mapping === "unique") {
      const completedRow = (await f.runtime.commands.read()).nativeSessions[0];
      assert.equal(completedRow.status, "completed"); assert.equal(completedRow.canStop, false);
      assert.equal(completedRow.exitCode, notification === "missing" ? null : 0);
      assert.ok(completedRow.nativeStartedAt);
    }
    if (notification !== "missing") {
      for (const event of f.session.events.filter(event => event.type === "system.notification"
        || event.data?.toolCallId === "native-rollover-auto-read")) f.session.config.onEvent(structuredClone(event));
      await f.runtime.transport.drain();
    }
    assert.equal((await f.runtime.state()).uncertainty, null);
    assert.deepEqual(f.errors, []);
  } finally { continueModel.resolve(); }
});

for (const mode of ["process", "workflow"]) test(`registry-bound unlabeled rollover supports exact ${mode} Stop without redispatch`, { timeout: 60_000 }, async t => {
  const ready = Promise.withResolvers(), resume = Promise.withResolvers(), tasks = [], cancelled = [];
  const command = "node stop-rollover-fixture.mjs";
  const f = await fixture(t, async (packet, session, runtime) => {
    if (packet.binding.role === "router") return route(session, packet, "answer");
    await session.call("powershell", { command });
    session.emit("assistant.turn_end", { turnId: session.turnId, interactionId: session.interactionId, aborted: false });
    session.endIdle(); ready.resolve(packet);
    await resume.promise;
    if ((await runtime.state()).requests.find(r => r.id === packet.binding.requestId).status === "stopped") return;
    return submit(session, packet, "submit_readonly_answer", { kind: "answer", summary: "Selected process stopped.",
      report: "The independent process Stop did not stop the foreground workflow.", evidenceRefs: [] });
  }, { permissionHandler: () => ({ kind: "approve-once" }), nativeShell: async () => {
    tasks.push({ type: "shell", id: "native-generated", command, startedAt: new Date().toISOString(),
      status: "running", attachmentMode: "attached", executionMode: "background" });
    return { content: "Native background wait; this text is not used as handle authority." };
  } });
  const unrelated = { type: "shell", id: "unrelated", command: "node other.mjs", startedAt: new Date().toISOString(),
    status: "running", attachmentMode: "attached", executionMode: "background" };
  f.session.rpc.tasks = { list: async () => ({ tasks: structuredClone([unrelated, ...tasks]) }),
    cancel: async ({ id }) => {
      cancelled.push(id); assert.equal(id, "native-generated");
      tasks[0].status = "cancelled"; tasks[0].completedAt = new Date().toISOString();
      return { cancelled: true };
    } };
  try {
    await f.send("stop-rollover", "Run the scoped command.");
    const packet = await ready.promise;
    const row = (await f.runtime.commands.read()).nativeSessions[0];
    assert.equal(row.canStop, true); assert.ok(row.nativeStartedAt);
    if (mode === "workflow") await f.runtime.stop("stop-native-wait", "immediate");
    else {
      await f.runtime.commands.stop(row.id);
      const state = await f.runtime.state();
      assert.equal(state.activeTask.binding.id, packet.binding.id); assert.equal(state.stop, null);
      f.session.processing = true; f.session.turnId = "after-process-stop";
      f.session.emit("assistant.turn_start", { turnId: f.session.turnId, interactionId: f.session.interactionId });
    }
    resume.resolve();
    assert.equal((await f.runtime.whenIdle()).status, "ready");
    assert.deepEqual(cancelled, mode === "workflow" ? [] : ["native-generated"]);
    assert.equal(unrelated.status, "running");
    const state = await f.runtime.state(), finalRow = (await f.runtime.commands.read()).nativeSessions[0];
    assert.equal(finalRow.status, mode === "workflow" ? "running" : "stopped");
    assert.equal(finalRow.exitCode, null);
    assert.equal(finalRow.canStop, mode === "workflow");
    assert.equal(state.requests.find(r => r.id === "stop-rollover").status, mode === "workflow" ? "stopped" : "completed");
    assert.equal(state.uncertainty, null); assert.deepEqual(f.errors, []);
  } finally { resume.resolve(); }
});

for (const invalid of ["interaction", "session", "reused-turn"]) test(`native wait never admits a ${invalid} continuation`, { timeout: 60_000 }, async t => {
  const ready = Promise.withResolvers(), finish = Promise.withResolvers();
  const f = await fixture(t, async (packet, session) => {
    if (packet.binding.role === "router") return route(session, packet, "answer");
    await session.call("powershell", { command: "node unbound-wait-fixture.mjs" });
    session.emit("assistant.turn_end", { turnId: session.turnId, interactionId: session.interactionId, aborted: false });
    session.endIdle(); ready.resolve(packet); await finish.promise;
  }, { permissionHandler: () => ({ kind: "approve-once" }), nativeShell: async () => ({ content: "Native wait." }) });
  try {
    await f.send("invalid-resumption", "Wait for the command.");
    const packet = await ready.promise;
    f.session.emit("assistant.turn_start", {
      turnId: invalid === "reused-turn" ? "0" : "untrusted",
      interactionId: invalid === "interaction" ? "foreign-interaction" : f.session.interactionId,
    }, invalid === "session" ? { sessionId: "foreign-private" } : {});
    await assert.rejects(f.runtime.transport.drain(), /interaction|session|turn identity/);
    await waitFor(async () => (await f.runtime.state()).uncertainty, "durable rejection of foreign continuation");
    const state = await f.runtime.state();
    assert.ok(state.uncertainty); assert.equal(state.activeTask.binding.id, packet.binding.id);
    assert.equal(state.activeTask.result, null);
  } finally { finish.resolve(); }
});

test("automatic output collection settles its owned shell without model admission or false uncertainty", { timeout: 90_000 }, async t => {
  const collecting = Promise.withResolvers(), finish = Promise.withResolvers();
  let grants = 0;
  const f = await fixture(t, async (packet, session, runtime) => {
    if (packet.binding.role === "router") return route(session, packet, "answer");
    await session.call("powershell", { command: "fixture-only", shellId: "automatic", mode: "async" });
    session.emit("assistant.turn_start", { turnId: "10", interactionId: session.interactionId });
    session.emit("system.notification", { kind: { type: "shell_completed", shellId: "automatic", exitCode: 1 } });
    session.emit("assistant.message", { content: "", toolRequests: [{ toolCallId: "automatic-read", name: "read_powershell",
      arguments: { shellId: "automatic", delay: 0 } }] });
    session.emit("tool.execution_start", { toolCallId: "automatic-read", toolName: "read_powershell",
      arguments: { shellId: "automatic", delay: 0 } });
    await runtime.transport.drain(); collecting.resolve(); await finish.promise;
    // Failed output collection is not unknown execution: the process exit is independently known.
    session.emit("tool.execution_complete", { toolCallId: "automatic-read", success: false });
    session.config.onEvent(structuredClone(session.events.at(-1)));
    await runtime.transport.drain();
    return submit(session, packet, "submit_readonly_answer", { kind: "answer", summary: "The command failed.",
      report: "The process exited with code 1; automatic output collection failed.", evidenceRefs: [] });
  }, { permissionHandler: async () => { grants++; return { kind: "approve-once" }; },
    nativeShell: async () => ({ contents: [] }) });
  try {
    await f.send("collect", "Inspect without editing."); await collecting.promise;
    await assert.rejects(f.runtime.transport.inspectIdle(), /not quiescent/);
    assert.equal((await f.runtime.state()).uncertainty, null);
    const shell = (await f.runtime.commands.read()).nativeSessions[0];
    assert.equal(shell.status, "failed"); assert.equal(shell.exitCode, 1);
    finish.resolve();
    assert.equal((await f.runtime.whenIdle()).status, "ready", f.errors.map(e => e.stack).join("\n"));
    assert.equal(grants, 1);
    assert.equal((await f.runtime.commands.read()).nativeSessions.length, 1);
    assert.equal((await f.runtime.store.messages()).filter(m => m.id.startsWith("diagnostic:")).length, 0);
    const { recoveryNativeEvidence, validateRecoveryHistory } = await import("../src/human-loop-recovery.mjs");
    const evidence = recoveryNativeEvidence("private", f.session.events);
    assert.equal(validateRecoveryHistory(f.session.events, evidence), true);
    await f.runtime.close();
  } finally { finish.resolve(); }
});

for (const phase of ["idle", "native-hook-tail", "later-role", "queued-during-collection", "immediate-stop", "after-step-stop", "close"]) test(`owned background output after its original role ends remains passive during ${phase}`,
  { timeout: 90_000 }, async t => {
    const laterStarted = Promise.withResolvers(), finishLater = Promise.withResolvers();
    let originalTurn, grants = 0;
    const f = await fixture(t, async (packet, session) => {
      if (packet.binding.role === "router") return route(session, packet, "answer");
      if (packet.binding.requestId === "original-launch") {
        await session.call("powershell", { command: "fixture-only", shellId: "late-output", mode: "async" });
        originalTurn = session.events.findLast(event => event.type === "assistant.turn_start");
      } else { laterStarted.resolve(); await finishLater.promise; }
      return submit(session, packet, "submit_readonly_answer", { kind: "answer", summary: "Requested work handled.",
        report: "No automatic follow-up was requested.", evidenceRefs: [] });
    }, { nativeShell: async () => ({ contents: [] }),
      permissionHandler: async () => { grants++; return { kind: "approve-once" }; } });
    try {
      await f.send("original-launch", "Launch the owned background command.");
      assert.equal((await f.runtime.whenIdle()).status, "ready");
      const handoff = structuredClone((await f.runtime.state()).handoffs[0]);
      if (phase === "later-role") { await f.send("later", "Describe the status."); await laterStarted.promise; }
      const sends = f.session.sends.length;
      if (phase === "native-hook-tail") {
        // Observed SDK chain after a later role: no direct turn-start parent.
        for (const hookType of ["agentStop", "sessionEnd"]) {
          f.session.emit("hook.start", { hookInvocationId: hookType, hookType, input: {} });
          f.session.emit("hook.end", { hookInvocationId: hookType, hookType, success: true });
        }
        f.session.emit("session.usage_checkpoint", { totalNanoAiu: 0, totalPremiumRequests: 0 });
        f.session.emit("hook.start", { hookInvocationId: "notify", hookType: "userPromptSubmitted", input: {} });
        f.session.emit("hook.end", { hookInvocationId: "notify", hookType: "userPromptSubmitted", success: true });
      }
      f.session.emit("system.notification", { kind: { type: "shell_completed", shellId: "late-output", exitCode: 0 } },
        phase === "native-hook-tail" ? {} : { parentId: originalTurn.id });
      f.session.emit("assistant.message", { content: "", toolRequests: [{ toolCallId: "late-automatic-read", name: "read_powershell",
        arguments: { shellId: "late-output", delay: 0 } }] });
      f.session.emit("tool.execution_start", { toolCallId: "late-automatic-read", toolName: "read_powershell",
        arguments: { shellId: "late-output", delay: 0 } });
      const collectionStart = f.session.events.at(-1);
      await f.runtime.transport.drain();
      assert.equal((await f.runtime.state()).uncertainty, null);
      await assert.rejects(f.runtime.transport.inspectIdle(), /not quiescent/);
      if (phase === "queued-during-collection") {
        await f.send("later", "Describe the status after current collection.");
        await laterStarted.promise;
        const waiting = await f.runtime.state();
        assert.equal(waiting.uncertainty, null);
        assert.equal(waiting.requests.find(request => request.id === "later").status, "active");
        assert.equal(f.session.sends.length, sends + 2);
      }
      if (phase.endsWith("-stop")) {
        await f.runtime.stop("stop-passive-output", phase === "immediate-stop" ? "immediate" : "after-step");
        await f.runtime.whenIdle();
        assert.equal((await f.runtime.state()).uncertainty, null);
        assert.equal((await f.runtime.state()).stop, null, "Native Stop does not await passive tool bookkeeping.");
      } else if (phase === "close") {
        const closed = await f.runtime.close();
        assert.equal(closed.native.closed, true, "Native Close does not await passive tool bookkeeping.");
        assert.deepEqual((await f.runtime.state()).handoffs[0], handoff);
        return;
      }
      f.session.emit("tool.execution_complete", { toolCallId: "late-automatic-read", success: true }, { parentId: collectionStart.id });
      await f.runtime.transport.drain();
      if (phase !== "queued-during-collection") assert.equal(f.session.sends.length, sends);
      assert.equal(grants, 1);
      assert.deepEqual((await f.runtime.state()).handoffs[0], handoff, "Collection cannot replace a settled role outcome.");
      assert.equal((await f.runtime.commands.read()).nativeSessions[0].status, "completed");
      finishLater.resolve();
      assert.equal((await f.runtime.whenIdle()).status, "ready");
      const { recoveryNativeEvidence, validateRecoveryHistory } = await import("../src/human-loop-recovery.mjs");
      assert.equal(validateRecoveryHistory(f.session.events, recoveryNativeEvidence("private", f.session.events)), true);
      await f.runtime.close();
    } finally { finishLater.resolve(); f.runtime.commands.releaseWriter(); }
  });

test("an unbound native passive chain cannot authorize a command outcome or poison independent workflow completion", { timeout: 90_000 }, async t => {
  const f = await fixture(t, async (packet, session) => {
    if (packet.binding.role === "router") return route(session, packet, "answer");
    return submit(session, packet, "submit_readonly_answer", { kind: "answer",
      summary: "No command launched.", report: "No command ownership exists.", evidenceRefs: [] });
  });

  try {
    await f.send("explain", "Explain without launching commands.");
    assert.equal((await f.runtime.whenIdle()).status, "ready");
    const sends = f.session.sends.length;
    f.session.emit("system.notification", { kind: { type: "shell_completed", shellId: "unknown", exitCode: 0 } });
    f.session.emit("assistant.message", { content: "", toolRequests: [{
      toolCallId: "unowned-auto", name: "read_powershell", arguments: { shellId: "unknown", delay: 0 },
    }] });
    f.session.emit("tool.execution_start", { toolCallId: "unowned-auto", toolName: "read_powershell",
      arguments: { shellId: "unknown", delay: 0 } });
    await f.runtime.transport.drain();
    assert.equal((await f.runtime.state()).uncertainty, null);
    f.session.emit("tool.execution_complete", { toolCallId: "unowned-auto", success: true });
    await f.runtime.transport.drain();
    assert.equal((await f.runtime.whenIdle()).status, "ready");
    assert.equal(f.session.sends.length, sends);
    assert.deepEqual((await f.runtime.commands.read()).nativeSessions, []);
    await f.runtime.close();
  } finally { f.runtime.commands.releaseWriter(); }
});

test("pending native receipt does not veto new dispatch and failed persistence is disclosed independently", { timeout: 30_000 }, async t => {
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  const f = await fixture(t, async (packet, session) => {
    if (packet.binding.role === "router") return route(session, packet, "answer");
    if (packet.binding.requestId === "launch")
      await session.call("powershell", { command: "fixture-only", shellId: "receipt-failure", mode: "async" });
    return submit(session, packet, "submit_readonly_answer", { kind: "answer",
      summary: "Background work started.", report: "Not awaited.", evidenceRefs: [] });
  }, { nativeShell: async () => ({ contents: [] }), permissionHandler: async () => ({ kind: "approve-once" }) });
  const mutate = HumanLoopNativeWriter.prototype.mutate;
  try {
    await f.send("launch", "Launch the background command.");
    assert.equal((await f.runtime.whenIdle()).status, "ready");
    const sends = f.session.sends.length;
    t.mock.method(HumanLoopNativeWriter.prototype, "mutate", async function(before, after) {
      if (decodeRecord(after).entries.some(entry => entry.completionNotification)) {
        entered.resolve({ writer: this, before }); await release.promise;
        throw new Error("Native receipt persistence unavailable.");
      }
      return mutate.call(this, before, after);
    });
    f.session.emit("system.notification", { kind: { type: "shell_completed", shellId: "receipt-failure", exitCode: 0 } });
    const pending = await entered.promise;
    assert.equal(f.runtime.transport.passiveOutputPending, true);
    await f.send("later", "Answer independently of the background command.");
    await waitFor(() => f.session.sends.length === sends + 1, "next native dispatch does not wait for an unrelated receipt");
    assert.equal((await f.runtime.state()).requests.find(request => request.id === "later").status, "active");
    release.resolve();
    await assert.rejects(f.runtime.transport.drain(), /receipt persistence unavailable/);
    assert.equal((await f.runtime.whenIdle()).status, "execution-unknown");
    assert.equal(await pending.writer.read(), pending.before, "Failed receipt must not appear durably saved.");
    assert.equal(f.runtime.transport.passiveOutputPending, true);
    assert.equal(f.session.sends.length, sends + 1);
    assert.equal((await f.runtime.state()).requests.find(request => request.id === "launch").status, "completed");
  } finally { release.resolve(); f.runtime.commands.releaseWriter(); }
});

test("unprovable automatic collection retains a correlated durable unknown diagnostic, not fabricated completion", { timeout: 90_000 }, async t => {
  const ready = Promise.withResolvers(), finish = Promise.withResolvers();
  const f = await fixture(t, async (packet, session) => {
    if (packet.binding.role === "router") return route(session, packet, "answer");
    await session.call("powershell", { command: "fixture-only", shellId: "known-exit", mode: "async" });
    session.emit("system.notification", { kind: { type: "shell_completed", shellId: "known-exit", exitCode: 0 } });
    session.emit("tool.execution_start", { toolCallId: "unowned-read", toolName: "read_powershell",
      arguments: { shellId: "foreign", delay: 0 } }, { parentId: "missing-message" });
    ready.resolve(); await finish.promise;
  }, { permissionHandler: async () => ({ kind: "approve-once" }), nativeShell: async () => ({ contents: [] }) });
  try {
    await f.send("uncertain", "Inspect the existing workspace."); await ready.promise; finish.resolve();
    assert.equal((await f.runtime.whenIdle()).status, "execution-unknown");
    const state = await f.runtime.state();
    assert.match(state.uncertainty.reason, /exact owned notification ancestry/);
    assert.equal((await f.runtime.commands.read()).nativeSessions[0].status, "completed",
      "A later ownership failure must not drop independently proven native exit settlement.");
    const rows = (await f.runtime.store.messages()).filter(m => m.id.startsWith("diagnostic:"));
    assert.equal(rows.length, 1);
    const log = JSON.parse(rows[0].content);
    assert.equal(log.sessionId, "private"); assert.equal(log.requestId, "uncertain"); assert.equal(log.role, "agent");
    assert.match(log.reason, /unowned-read/); assert.match(log.reason, /missing-message/);
    assert.ok(Number.isFinite(Date.parse(log.timestamp)));
    assert.equal(log.reason.includes("foreign\""), false, "Full tool arguments are not logged.");
    assert.equal((await f.runtime.store.load()).uncertainty.reason, state.uncertainty.reason);
    assert.equal((await f.runtime.store.messages()).filter(m => m.id === rows[0].id).length, 1);
  } finally { finish.resolve(); f.runtime.commands.releaseWriter(); }
});

test("uncertainty diagnostic commits atomically, survives acknowledgement loss and logs only one durable transition", async t => {
  const f = await fixture(t, async () => {});
  await f.runtime.close();
  const state = await f.runtime.state(), store = new HumanLoopStore(state.owner);
  const data = { reason: "Dispatch acknowledgement is missing; resending could duplicate work.", evidenceRef: "private-session:private" };
  let fault = "before";
  const transact = HostStateFile.prototype.transact;
  t.mock.method(HostStateFile.prototype, "transact", async function(cause, prepare) {
    if (cause !== "human-loop:execution-unknown") return transact.call(this, cause, prepare);
    const result = await transact.call(this, cause, async content => {
      const prepared = await prepare(content);
      if (fault === "before") throw new Error("Diagnostic precommit failure.");
      return prepared;
    });
    if (fault === "after") throw new Error("Diagnostic acknowledgement lost.");
    return result;
  });
  await assert.rejects(store.dispatch("host", "queue-failure:fixture", "execution-unknown", data), /precommit/);
  assert.equal((await store.load()).uncertainty, null);
  assert.deepEqual(await store.messages(), []);
  fault = "after";
  await assert.rejects(store.dispatch("host", "queue-failure:fixture", "execution-unknown", data), /acknowledgement lost/);
  const saved = await store.messages();
  assert.equal(saved.length, 1);
  assert.equal(JSON.parse(saved[0].content).reason, data.reason);
  fault = null;
  await store.dispatch("host", "queue-failure:fixture", "execution-unknown", data);
  await store.close();
  const reopened = new HumanLoopStore(state.owner);
  assert.deepEqual(await reopened.messages(), saved);
  assert.equal((await reopened.load()).uncertainty.reason, data.reason);
  await reopened.close();
});

test("failed uncertainty writes retain the original runtime failure and report the recording failure", async t => {
  const f = await fixture(t, async () => {});
  const warnings = [], dispatch = f.runtime.store.dispatch.bind(f.runtime.store);
  t.mock.method(f.runtime.transport, "send", async () => { throw new Error("Original native dispatch failed."); });
  t.mock.method(process, "emitWarning", warning => warnings.push(String(warning)));
  t.mock.method(f.runtime.store, "dispatch", async (...args) => {
    if (args[2] === "execution-unknown") throw new Error("WAL recording unavailable.");
    return dispatch(...args);
  });
  try {
    await f.send("recording-failure", "Read the current status."); await f.runtime.whenIdle();
    const readiness = await f.runtime.readiness();
    assert.equal(readiness.status, "execution-unknown");
    assert.match(readiness.reason, /Original native dispatch failed/);
    assert.match(readiness.reason, /WAL recording unavailable/);
    assert.ok(warnings.some(message => message.includes("Original native dispatch failed") && message.includes("WAL recording unavailable")));
    assert.deepEqual((await f.runtime.store.messages()).filter(message => message.id.startsWith("diagnostic:")), [],
      "A failed durable write must not be presented as a saved diagnostic.");
  } finally { f.runtime.commands.releaseWriter(); }
});

test("existing-repository baseline preserves dirty code and questions before a separately requested normal implementation cycle", { timeout: 120_000 }, async t => {
  const initialFiles = {
    "package.json": '{"name":"existing-project","type":"module"}\n',
    "README.md": "Requests preserve leading and trailing spaces.\n",
    "src/request.js": "export const accept = input => input.trim();\n",
    "test/request.test.js": 'import assert from "node:assert/strict";\nimport { accept } from "../src/request.js";\nassert.equal(accept(" hello "), "hello");\n',
  };
  const dirtySource = `${initialFiles["src/request.js"]}// User's uncommitted note: confirm whitespace intent.\n`;
  const nativeAccess = [], inspected = [];
  const f = await fixture(t, async (packet, session) => {
    const { role, requestId } = packet.binding;
    if (role === "router") {
      const refs = packet.context.request.answers?.answers.map(({ questionId, sourceResultId }) => ({ questionId, sourceResultId })) ?? [];
      return route(session, packet, requestId === "implement-later" ? "implement" : "design", null, refs);
    }
    if (role !== "designer") return ordinary(packet, session);
    if (requestId === "baseline-answer") {
      assert.equal(packet.context.questionAnswers[0].question.id, "whitespace");
      assert.equal(packet.context.questionAnswers[0].answer.value, "keep");
      assert.match(packet.context.design.content.summary, /src\/request.js/);
      return submit(session, packet, "submit_designer_outcome", {
        kind: "designer-unchanged", summary: "Keep the observed trimming behavior in Design.",
        explanation: "The baseline already describes trimming; no implementation was requested.", questions: [],
      });
    }
    assert.equal(packet.context.design.content, null, "Existing product code is not a canonical Tandem Design.");
    assert.match(packet.context.instructions.join("\n"), /first explore the current project folder read-only/);
    const files = JSON.parse(await session.call("glob", { pattern: "src/**/*.js" }));
    assert.ok(files.some(path => path.replaceAll("\\", "/") === "src/request.js"));
    for (const [path, expected] of Object.entries({ ...initialFiles, "src/request.js": dirtySource })) {
      assert.equal(await session.call("view", { path }), expected);
      inspected.push(path);
    }
    const baseline = sharedDesign();
    baseline.goal = "Describe the existing request-processing behavior.";
    baseline.summary = "Observed: accept in src/request.js trims spaces; test/request.test.js checks this. README.md instead promises preserved spaces; desired intent is unresolved.";
    baseline.artifacts[0].boxes.find(box => box.id === "accept").body = "Trim spaces.\nConfirm intent.";
    const artifact = await session.call("stage_human_design", baseline);
    const { artifactRef } = typeof artifact === "string" ? JSON.parse(artifact) : artifact;
    return submit(session, packet, "submit_designer_outcome", {
      kind: "designer-changed", summary: baseline.summary, artifactRef,
      questions: [{
        id: "whitespace", context: baseline.summary, question: "Should requests keep their surrounding spaces?",
        whyItMatters: "The documented behavior and implemented input handling disagree.",
        importance: "blocking", allowFreeform: true, designRefs: ["interaction#accept"],
        options: [
          { id: "keep", label: "Keep trimming in Design", implication: "Retain the observed baseline; no code changes requested." },
          { id: "preserve", label: "Describe preserved spaces in Design", implication: "Revise the baseline before requesting implementation." },
        ],
      }],
    });
  }, { realDesign: true, initialFiles, filePermissionHandler: request => {
    nativeAccess.push(request.kind);
    return { kind: "approve-once" };
  } });
  await writeFile(join(f.project, "src", "request.js"), dirtySource);
  await writeFile(join(f.project, "notes.txt"), "Untracked user notes.\n");
  const beforeStatus = await git(f.project, "status", "--porcelain");
  const beforeHead = await git(f.project, "rev-parse", "HEAD");
  assert.deepEqual(f.history, [], "Opening an existing repository does not start model work.");

  await f.send("baseline", "Explore this repository and generate Design from the existing code. Raise questions without changing code.");
  assert.equal((await f.runtime.whenIdle()).status, "waiting-answer", f.errors.map(error => error.stack).join("\n"));
  const state = await f.runtime.state(), binding = state.design, q = state.questions[0];
  assert.ok(binding.revisionId);
  assert.equal(state.cycles.length, 0);
  assert.deepEqual(inspected.sort(), Object.keys(initialFiles).sort());
  assert.deepEqual(q.source.design, binding);
  assert.deepEqual(q.designRefs, ["interaction#accept"]);
  assert.equal(nativeAccess.includes("write"), false);
  assert.equal(await git(f.project, "status", "--porcelain"), beforeStatus);
  assert.equal(await git(f.project, "rev-parse", "HEAD"), beforeHead);
  assert.deepEqual(f.history.map(entry => entry.role), ["router", "designer"]);

  await f.send("baseline-answer", "Question form submission.", { schemaVersion: "human-question-answers/v1",
    answers: [{ questionId: q.id, sourceResultId: q.source.resultId, kind: "option", value: "keep" }] });
  assert.equal((await f.runtime.whenIdle()).status, "ready", f.errors.map(error => error.stack).join("\n"));
  assert.deepEqual((await f.runtime.state()).design, binding);
  assert.equal((await f.runtime.state()).cycles.length, 0, "A Design answer alone does not authorize a build.");
  assert.equal(nativeAccess.includes("write"), false);
  assert.equal(await git(f.project, "status", "--porcelain"), beforeStatus);

  await f.send("implement-later", "Implement the agreed Design.");
  assert.equal((await f.runtime.whenIdle()).status, "ready", f.errors.map(error => error.stack).join("\n"));
  assert.deepEqual(f.history.filter(entry => entry.requestId === "implement-later").map(entry => entry.role),
    ["router", "planner", "implementer", "implementer", "implementer", "reviewer"]);
  assert.equal((await f.runtime.state()).cycles[0].phase, "completed");
  assert.equal(await readFile(join(f.project, "src", "request.js"), "utf8"), dirtySource);
  assert.equal(await readFile(join(f.project, "notes.txt"), "utf8"), "Untracked user notes.\n");
  assert.deepEqual(f.errors, []);
});

test("R4 Designer changed and unchanged outcomes publish/preserve the real Design and use the shared question handoff", { timeout: 120_000 }, async (t) => {
  let first = true;
  const f = await fixture(t, async (packet, session) => {
    if (packet.binding.role === "router") {
      const refs = packet.context.request.answers?.answers.map(({ questionId, sourceResultId }) => ({ questionId, sourceResultId })) ?? [];
      return route(session, packet, "design", null, refs);
    }
    if (first) {
      first = false;
      const proposal = sharedDesign();
      const artifact = await session.call("stage_human_design", proposal);
      const value = typeof artifact === "string" ? JSON.parse(artifact) : artifact;
      assert.ok(value.artifactRef);
      return submit(session, packet, "submit_designer_outcome", { kind: "designer-changed",
        summary: "The complete shared Design is now available.", artifactRef: value.artifactRef,
        questions: [{ ...question, designRefs: ["interaction#deliver"] }] });
    }
    return submit(session, packet, "submit_designer_outcome", { kind: "designer-unchanged",
      summary: "The Design already supports that direction.", explanation: "No Design revision was necessary.", questions: [] });
  }, { realDesign: true });
  t.mock.method(f.session, "abort", async () => { assert.fail("Successful Designer and Router roles end natively."); });
  await f.send("idea", "Design a small measurement viewer; don't implement.");
  assert.equal((await f.runtime.whenIdle()).status, "waiting-answer", f.errors.map((error) => error.stack).join("\n"));
  const firstState = await f.runtime.state(), binding = firstState.design;
  assert.deepEqual(firstState.questions[0].designRefs, ["interaction#deliver"]);
  assert.deepEqual(firstState.questions[0].source.design, binding);
  assert.ok(binding.revisionId);
  assert.equal(firstState.cycles.length, 0);
  const q = firstState.questions[0];
  assert.equal(q.source.role, "designer");
  assert.deepEqual(q.source.design, binding);
  await f.send("design-answer", "Question form submission.", { schemaVersion: "human-question-answers/v1",
    answers: [{ questionId: q.id, sourceResultId: q.source.resultId, kind: "option", value: "keep" }] });
  assert.equal((await f.runtime.whenIdle()).status, "ready", f.errors.map((error) => error.stack).join("\n"));
  assert.equal(f.errors.length, 0);
  assert.deepEqual((await f.runtime.state()).design, binding);
  assert.equal((await f.runtime.state()).cycles.length, 0);
  assert.match(f.handoffs[1].content, /No Design revision was necessary/);
  for (const execution of (await f.runtime.state()).executions) {
    assert.equal(execution.completion, "result-submission", execution.binding.role);
  }
});

test("shared Designer semantic preflight rejects a dangling element and permits a valid same-task retry", { timeout: 60_000 }, async (t) => {
  const invalid = sharedDesign();
  invalid.artifacts[0].connections[0].to = "missing";
  let deniedReason;
  const f = await fixture(t, async (packet, session, runtime) => {
    if (packet.binding.role === "router") return route(session, packet, "design");
    const denied = await session.config.hooks.onPreToolUse({
      sessionId: session.sessionId, toolName: "stage_human_design", toolArgs: invalid,
    }, { sessionId: session.sessionId });
    assert.equal(denied.permissionDecision, "deny");
    deniedReason = denied.permissionDecisionReason;
    assert.match(deniedReason, /endpoint|reference/i);
    assert.doesNotMatch(deniedReason, /Tool execution failed/);
    assert.equal((await runtime.state()).activeTask.stagedResult, null);
    const valid = sharedDesign();
    const value = await session.call("stage_human_design", valid);
    const staged = typeof value === "string" ? JSON.parse(value) : value;
    return submit(session, packet, "submit_designer_outcome", { kind: "designer-changed",
      summary: "A valid Design was staged after the actionable rejection.", artifactRef: staged.artifactRef, questions: [] });
  }, { realDesign: true });
  await f.send("semantic-retry", "Design only; report validation errors accurately.");
  assert.equal((await f.runtime.whenIdle()).status, "ready", f.errors.map((error) => error.stack).join("\n"));
  assert.ok(deniedReason);
  assert.deepEqual(f.history.map(({ role }) => role), ["router", "designer"]);
  assert.equal(f.handoffs.length, 1);
});

for (const target of ["design", "implementation"]) test(`Review ${target} resolution preserves exact words and waits for Router before the normal role path`, { timeout: 180_000 }, async (t) => {
  let releaseRoute, reviewedQuestion, routerPacket;
  const gate = new Promise(resolve => { releaseRoute = resolve; });
  const f = await fixture(t, async (packet, session) => {
    if (packet.binding.role === "router") {
      if (packet.context.request.id === "seed-design") return route(session, packet, "design");
      if (packet.context.request.id !== "resolve") return route(session, packet, "implement");
      routerPacket = packet;
      await gate;
      return route(session, packet, target === "design" ? "design" : "implement", null,
        [{ questionId: reviewedQuestion.id, sourceResultId: reviewedQuestion.source.resultId }]);
    }
    if (packet.binding.role === "designer" && packet.context.request.id === "seed-design") {
      const staged = await session.call("stage_human_design", designContent);
      const { artifactRef } = typeof staged === "string" ? JSON.parse(staged) : staged;
      return submit(session, packet, "submit_designer_outcome", {
        kind: "designer-changed", summary: "The agreed interaction is published.", artifactRef, questions: [],
      });
    }
    if (packet.binding.role === "designer") return submit(session, packet, "submit_designer_outcome", {
      kind: "designer-unchanged", summary: "The requested Design alternative needs further specification.",
      explanation: "This fixture establishes the Designer handoff, not automatic implementation or inferred agreement.", questions: [],
    });
    if (packet.binding.role === "reviewer" && packet.context.request.id === "build") return submit(session, packet, "submit_whole_plan_review", {
      kind: "review-result", planDigest: packet.context.cycle.plan.digest, summary: "A concrete Design decision needs resolution.",
      assessments: [],
      findings: [reviewDecisionFinding], questions: [reviewDecisionQuestion], verificationLimits: [], evidenceRefs: ["view.js"],
    });
    if (packet.binding.role === "reviewer") return submit(session, packet, "submit_whole_plan_review", {
      kind: "review-result", planDigest: packet.context.cycle.plan.digest, summary: "The new cycle was reviewed.",
      assessments: [], findings: [], questions: [], verificationLimits: [], evidenceRefs: ["view.js"],
    });
    return ordinary(packet, session);
  }, { realDesign: true });
  try {
    await f.send("seed-design", "Describe the agreed interaction before implementation.");
    assert.equal((await f.runtime.whenIdle()).status, "ready", f.errors.map(error => error.stack).join("\n"));
    await f.send("build", "Implement the agreed interaction.");
    assert.equal((await f.runtime.whenIdle()).status, "waiting-answer", f.errors.map(error => error.stack).join("\n"));
    reviewedQuestion = (await f.runtime.state()).questions[0];
    const projected = projectHumanLoopView(await f.runtime.state(), await f.runtime.readiness());
    assert.equal(projected.lastHandoff.reviewFormat, "decision-review/v2");
    assert.deepEqual(projected.questionInteractions.find(group => group.resultId === reviewedQuestion.source.resultId).questions[0].options, reviewedQuestion.options);
    assert.deepEqual(reviewedQuestion.source.design, (await f.runtime.state()).design);
    assert.equal(reviewedQuestion.source.cycleId, (await f.runtime.state()).cycles[0].id);
    const chosen = reviewedQuestion.options.find(option => option.resolutionTarget === target);
    const { id, ...selectedOption } = chosen;
    await f.send("resolve", "Question form submission.", { schemaVersion: "human-question-answers/v1",
      answers: [{ questionId: reviewedQuestion.id, sourceResultId: reviewedQuestion.source.resultId, kind: "option", value: id }] });
    await waitFor(() => routerPacket, "Router receives the explicitly bound resolution");
    assert.deepEqual(routerPacket.context.request.answers.answers[0].selectedOption, selectedOption);
    assert.deepEqual(routerPacket.context.requests[0].answers.answers[0].selectedOption, selectedOption);
    assert.deepEqual(routerPacket.context.questions[0], { ...reviewedQuestion, state: "answered", answerRequestId: "resolve" });
    assert.deepEqual(f.history.filter(({ requestId }) => requestId === "resolve").map(({ role }) => role), ["router"],
      "No selected target may dispatch a role before Router interprets it.");
    const ledger = JSON.parse(await new HostStateFile(f.project,
      join(f.project, ".tandem", "living-canvas", "human-loop", "ledger.json")).read());
    const received = ledger.events.find(({ command }) => command.id === "receive:resolve");
    assert.deepEqual(received.command.data.answers.answers[0].selectedOption, selectedOption);
    releaseRoute();
    assert.equal((await f.runtime.whenIdle()).status, "ready", f.errors.map(error => error.stack).join("\n"));
    assert.equal(f.errors.length, 0);
    const roles = f.history.filter(({ requestId }) => requestId === "resolve").map(({ role }) => role);
    assert.deepEqual(roles, target === "design" ? ["router", "designer"]
      : ["router", "planner", "implementer", "implementer", "implementer", "reviewer"]);
    const state = await f.runtime.state();
    assert.equal(state.cycles.length, target === "design" ? 1 : 2);
    assert.deepEqual(state.design, reviewedQuestion.source.design);
    assert.deepEqual(state.requests.find(({ id }) => id === "resolve").answers.answers[0].selectedOption, selectedOption);
    assert.equal(state.questions[0].state, "answered");
    assert.equal(state.questions[0].answerRequestId, "resolve");
    assert.equal(state.cycles[0].reviewResult.outcome.findings.length, 1, "Historical Review is not rewritten.");
    const conversation = projectHumanConversation(state, await f.runtime.store.messages());
    const answer = conversation.find(({ id }) => id === "request:resolve").answerDetails[0];
    assert.equal(answer.answer, selectedOption.label);
    assert.equal(answer.implication, selectedOption.implication);
    assert.equal(answer.resolutionTarget, target);
    assert.deepEqual(answer.design, reviewedQuestion.source.design);
    assert.deepEqual(answer.designRefs, reviewedQuestion.designRefs);
  } finally { releaseRoute(); }
});

test("R4 whole-plan Review findings are a normal outcome and a UI-requested fix starts a new cycle without recovery", { timeout: 180_000 }, async (t) => {
  let reviewQuestion;
  const f = await fixture(t, async (packet, session, runtime) => {
    if (packet.binding.role === "router") {
      const refs = packet.context.request.answers?.answers.map(({ questionId, sourceResultId }) => ({ questionId, sourceResultId })) ?? [];
      return route(session, packet, "implement", null, refs);
    }
    const fixing = packet.context.request.id === "fix";
    if (fixing && packet.binding.role === "implementer" && packet.binding.internalTaskId === "engine") {
      const state = await runtime.state(), readiness = await runtime.readiness();
      assert.equal(state.activeTask.condition, "running");
      assert.equal(state.activeTask.binding.requestId, "fix");
      assert.deepEqual(state.requests.find(r => r.id === "fix").blockingAnswerRefs,
        [{ questionId: reviewQuestion.id, sourceResultId: reviewQuestion.source.resultId }], "Saved-answer processing retains the original gate obligation.");
      assert.deepEqual(state.questions[0], { ...reviewQuestion, state: "answered", answerRequestId: "fix" });
      assert.equal(readiness.status, "working");
      assert.equal(readiness.reason, null, "An answered Review question must not describe current corrective work as awaiting an answer.");
      const view = projectHumanLoopView(state, readiness);
      assert.equal(view.reason, null);
      assert.equal(view.activeRole, "implementer");
      const interaction = view.questionInteractions.find(group => group.resultId === reviewQuestion.source.resultId);
      assert.equal(interaction.canAnswer, false);
      assert.deepEqual(interaction.questions.map(({ id, state }) => ({ id, state })), [{ id: reviewQuestion.id, state: "answered" }]);
      await assert.rejects(session.call("powershell", { command: "node --version", shellId: "version" }),
        /Native permission denied/);
      assert.equal((await runtime.readiness()).status, "working");
      assert.equal((await runtime.readiness()).reason, null);
    }
    if (fixing && packet.binding.role === "implementer" && packet.binding.internalTaskId === "view") {
      const file = await readProjectFile(session, "view.js");
      await patchFile(session, { path: "view.js", expectedDigest: file.digest,
        content: "export const view = true;\nexport const verified = true;\n" });
      return submit(session, packet, "submit_internal_task_result", { kind: "task-result", taskId: "view",
        planDigest: packet.context.cycle.plan.digest, summary: "The requested correction is complete.", evidenceRefs: ["view.js"] });
    }
    if (packet.binding.role === "reviewer") {
      const evidence = JSON.parse(await session.call("read_cycle_changes", {}));
      assert.deepEqual(evidence.files.filter(({ hostManaged }) => !hostManaged).map(({ path }) => path).sort(),
        fixing ? ["view.js"] : ["engine.js", "view.js"]);
      const excerpt = JSON.parse(await session.call("read_cycle_file", { path: "view.js", side: "after", offset: 0, length: 100 }));
      assert.match(excerpt.content, /export const view/);
      return submit(session, packet, "submit_whole_plan_review", {
        kind: "review-result", planDigest: packet.context.cycle.plan.digest, summary: fixing ? "The correction is verified." : "The complete result has a Design decision finding.",
        assessments: [],
        findings: fixing ? [] : [reviewDecisionFinding],
        verificationLimits: [], evidenceRefs: ["engine.js", "view.js"], questions: fixing ? [] : [reviewDecisionQuestion],
      });
    }
    return ordinary(packet, session);
  }, { initialIndex: "# My existing notes\n\nKeep this user-owned content.\n",
    permissionHandler: async () => {
      const readiness = await f.runtime.readiness();
      assert.equal(readiness.status, "waiting-permission", "Answer resolution must not suppress the active permission gate.");
      assert.equal(readiness.reason, null, "Permission waiting must not revive the answered question's reason.");
      return { kind: "reject", feedback: "Do not run this optional version check." };
    },
  });
  await f.send("implement", "Implement both parts.");
  assert.equal((await f.runtime.whenIdle()).status, "waiting-answer", f.errors.map((error) => error.stack).join("\n"));
  let state = await f.runtime.state();
  assert.equal(state.cycles[0].phase, "completed");
  assert.equal(state.cycles[0].reviewResult.outcome.findings.length, 1);
  assert.ok(state.cycles[0].indexReceipt);
  assert.equal(state.uncertainty, null);
  const index = await readFile(join(f.project, "TANDEM.md"), "utf8");
  assert.match(index, /Keep this user-owned content/);
  assert.match(index, /Conformance to agreed Design/);
  const q = state.questions[0];
  reviewQuestion = structuredClone(q);
  assert.equal(q.state, "open");
  assert.equal((await f.runtime.readiness()).reason,
    "An effective prerequisite or its saved answer is still pending. Other queued messages remain preserved.");
  await f.send("fix", "Question form submission.", { schemaVersion: "human-question-answers/v1",
    answers: [{ questionId: q.id, sourceResultId: q.source.resultId, kind: "freeform", value: "Fix the reported problem under the current Design." }] });
  assert.equal((await f.runtime.whenIdle()).status, "ready", f.errors.map((error) => error.stack).join("\n"));
  assert.equal(f.errors.length, 0);
  state = await f.runtime.state();
  assert.equal(state.cycles.length, 2);
  assert.equal(state.cycles[1].phase, "completed");
  assert.equal(state.cycles[1].reviewResult.outcome.findings.length, 0);
  assert.deepEqual(state.questions[0], { ...reviewQuestion, state: "answered", answerRequestId: "fix" });
  assert.equal(state.cycles[0].reviewResult.resultId, reviewQuestion.source.resultId);
  assert.equal(state.cycles[0].reviewResult.outcome.findings.length, 1, "The original Review evidence remains historical.");
  assert.match(await readFile(join(f.project, "TANDEM.md"), "utf8"), /Conformance to agreed Design: None/);
  assert.match(await readFile(join(f.project, "view.js"), "utf8"), /verified/);
  assert.equal(f.history.filter(({ role }) => role === "reviewer").length, 2);
});

for (const boundary of ["error", "stop"]) test(`answered question readiness preserves the active ${boundary} boundary`, { timeout: 90_000 }, async (t) => {
  let observedBoundary;
  const f = await fixture(t, async (packet, session, runtime) => {
    if (packet.binding.role === "router") {
      const refs = packet.context.request.answers?.answers.map(({ questionId, sourceResultId }) => ({ questionId, sourceResultId })) ?? [];
      return route(session, packet, refs.length ? "answer" : "implement", null, refs);
    }
    if (packet.binding.role === "planner") return submit(session, packet, "raise_implementation_design_concern", {
      kind: "design-concern", summary: "A direction is needed.", reason: "The current Design needs a product decision.", questions: [question],
    });

    assert.equal((await runtime.readiness()).reason, null);
    if (boundary === "error") {
      session.emit("session.error", { message: "The current answer task was interrupted." });
    } else {
      await runtime.stop("answer-stop");
      observedBoundary = await runtime.readiness();
      return submit(session, packet, "submit_readonly_answer", {
        kind: "answer", summary: "The current answer step finished.", report: "The submitted answer was handled before Stop settled.", evidenceRefs: [],
      });
    }
  });
  await f.send("implement", "Implement the current Design.");
  assert.equal((await f.runtime.whenIdle()).status, "waiting-answer", f.errors.map((error) => error.stack).join("\n"));
  const source = (await f.runtime.state()).questions[0];
  await f.send("answer", "Question form submission.", { schemaVersion: "human-question-answers/v1",
    answers: [{ questionId: source.id, sourceResultId: source.source.resultId, kind: "option", value: "keep" }] });
  const readiness = await f.runtime.whenIdle(), state = await f.runtime.state();
  assert.equal(f.errors.length, 0, f.errors.map((error) => error.stack).join("\n"));
  assert.deepEqual(state.questions[0], { ...source, state: "answered", answerRequestId: "answer",
    blockingActive: boundary === "stop" ? false : source.blockingActive });
  if (boundary === "error") {
    assert.equal(readiness.status, "execution-unknown");
    assert.equal(readiness.reason, state.uncertainty.reason);
    assert.match(readiness.reason, /private runtime reported interruption.*session\.error/);
  } else {
    assert.equal(observedBoundary.status, "stopping");
    assert.match(observedBoundary.reason, /waiting for its verified settlement/);
    assert.doesNotMatch(observedBoundary.reason, /may continue editing|step will finish/);
    assert.ok(state.stops[0].requestIds.includes("answer"));
    assert.equal(state.questions[0].source.resultId, source.source.resultId, "Stop retains question source context without a singleton gate.");
    assert.equal(state.requests.find(({ id }) => id === "answer").status, "completed");
    assert.equal(readiness.status, "ready");
    assert.equal(readiness.reason, null);
  }
});

for (const boundary of ["role", "transport", "native-send", "failed-read"]) test(`Stop during aggregate ${boundary} preparation fences the stopped request before late dispatch and new input`, { timeout: 120_000 }, async (t) => {
  const preparing = Promise.withResolvers(), release = Promise.withResolvers();
  const f = await fixture(t, async (packet, session) => {
    if (packet.binding.role === "router") return route(session, packet, packet.binding.requestId === "implement" ? "implement" : "answer");
    return ordinary(packet, session);
  });
  const capture = f.runtime.workspace.capture.bind(f.runtime.workspace);
  const read = f.runtime.workspace.readSnapshot.bind(f.runtime.workspace);
  const transportSend = f.runtime.transport.send.bind(f.runtime.transport);
  let transportPreparing = false;
  f.runtime.transport.send = async (packet) => {
    if (packet.binding.role === "implementer" && packet.binding.internalTaskId === null) transportPreparing = true;
    return transportSend(packet);
  };
  const mode = f.session.rpc.mode.get;
  f.session.rpc.mode.get = async () => {
    const state = await f.runtime.state();
    if (boundary === "native-send" && state.activeTask?.binding.role === "implementer"
      && state.activeTask.binding.internalTaskId === null && state.activeTask.binding.requestId === "implement") {
      preparing.resolve(); await release.promise;
    }
    return mode();
  };
  let paused = false;
  const pausePreparation = async () => {
    const state = await f.runtime.state();
    if (boundary !== "native-send" && !paused && !state.activeTask && state.activeRequestId === "implement"
      && (boundary !== "transport" || transportPreparing)
      && state.cycles[0]?.tasks.length === 2 && state.cycles[0].tasks.every(({ status }) => status === "completed")) {
      paused = true; preparing.resolve(); await release.promise;
      if (boundary === "failed-read") throw new Error("Actual snapshot verification failed independently of Stop.");
    }
  };
  f.runtime.workspace.capture = async (...args) => {
    if (boundary === "role" || boundary === "failed-read") await pausePreparation();
    return capture(...args);
  };
  f.runtime.workspace.readSnapshot = async (...args) => {
    if (boundary === "transport") await pausePreparation();
    return read(...args);
  };
  const saved = [];
  const saveTask = f.runtime.store.saveTask.bind(f.runtime.store);
  f.runtime.store.saveTask = async (packet) => { saved.push(packet.binding); return saveTask(packet); };
  try {
    await f.send("implement", "Implement both parts.");
    await preparing.promise;
    const stopped = await f.runtime.stop("aggregate-preparation-stop");
    assert.equal(stopped.status, "stopping");
    if (boundary !== "native-send") await waitFor(async () => !(await f.runtime.state()).stop, "between-role Stop confirmation");
    const stoppedState = await f.runtime.state();
    if (boundary === "native-send") {
      assert.equal(stoppedState.stops.length, 0);
      assert.equal(stoppedState.activeTask.condition, "queued");
      assert.equal(stoppedState.activeTask.messageId, null);
    } else assert.equal(stoppedState.stops[0].taskId, null, "Both internal roles genuinely ended before Stop.");
    assert.equal(stoppedState.cycles[0].phase, boundary === "native-send" ? "implementing" : "stopped");
    assert.equal(stoppedState.cycles[0].tasks.filter(({ status }) => status === "completed").length, 2);
    assert.equal(projectHumanLoopView(stoppedState, await f.runtime.readiness()).canSend, boundary !== "native-send");
    if (boundary === "native-send") await assert.rejects(f.send("new", "Explain the retained code without resuming stopped work."), /Stop after current step is still settling/);
    else await f.send("new", "Explain the retained code without resuming stopped work.");
    assert.equal(f.history.some(({ requestId }) => requestId === "new"), false, "The old continuation has not drained yet.");
    release.resolve();
    let readiness = await f.runtime.whenIdle();
    if (boundary === "native-send") {
      await f.send("new", "Explain the retained code without resuming stopped work.");
      readiness = await f.runtime.whenIdle();
    }
    const state = await f.runtime.state();
    if (boundary === "failed-read") {
      const diagnostic = (await f.runtime.store.messages()).find(message => message.id === "preparation-failed:implement");
      assert.match(diagnostic.content, /Actual snapshot verification failed independently of Stop/);
      assert.match(diagnostic.content, /no next role was dispatched/);
    }
    assert.equal(readiness.status, "ready", readiness.reason ?? f.errors.map((error) => error.stack).join("\n"));
    assert.equal(state.uncertainty, null);
    assert.equal(f.errors.length, 0);
    assert.equal(state.cycles[0].phase, "stopped");
    assert.equal(Boolean(state.cycles[0].implementationResult), boundary === "native-send",
      "An admitted aggregate finishes; an unadmitted aggregate never starts.");
    assert.equal(state.cycles[0].reviewResult, null);
    assert.equal(saved.some(({ requestId, role, internalTaskId }) =>
      requestId === "implement" && role === "implementer" && internalTaskId === null), boundary === "native-send",
    "Only a task prepared before Stop may be persisted, never a stale continuation afterward.");
    assert.deepEqual(f.history.map(({ role }) => role), boundary === "native-send"
      ? ["router", "planner", "implementer", "implementer", "implementer", "router", "agent"]
      : ["router", "planner", "implementer", "implementer", "router", "agent"]);
    assert.equal(state.requests.find(({ id }) => id === "new").status, "completed");
    assert.equal(await readFile(join(f.project, "engine.js"), "utf8"), "export const engine = true;\n");
    assert.equal(await readFile(join(f.project, "view.js"), "utf8"), "export const view = true;\n");
  } finally { release.resolve(); }
});

test("after-step Stop of an active aggregate accepts its typed result without native quiescence", { timeout: 120_000 }, async (t) => {
  const aggregate = Promise.withResolvers(), release = Promise.withResolvers();
  const f = await fixture(t, async (packet, session) => {
    if (packet.binding.role === "router") return route(session, packet, packet.binding.requestId === "implement" ? "implement" : "answer");
    if (packet.binding.role === "implementer" && packet.binding.internalTaskId === null) {
      session.terminalIdle = false;
      aggregate.resolve(); await release.promise;
    }
    return ordinary(packet, session);
  }, { reviewGraceMs: 2_000 });
  try {
    await f.send("implement", "Implement both parts.");
    await aggregate.promise;
    f.session.abort = async () => { assert.fail("No native abort is required for after-step Stop."); };
    const stopping = await f.runtime.stop("active-aggregate-stop");
    assert.equal(stopping.status, "stopping");
    assert.equal((await f.runtime.state()).activeTask.terminal, null, "Stop itself does not request native cancellation.");
    release.resolve();
    assert.equal((await f.runtime.whenIdle()).status, "ready");
    assert.equal(f.session.processing, true, "Native processing is not a second completion gate.");
    f.session.terminalIdle = true;
    await f.send("new", "Explain the retained code.");
    const readiness = await f.runtime.whenIdle(), state = await f.runtime.state();
    assert.equal(readiness.status, "ready", readiness.reason ?? f.errors.map((error) => error.stack).join("\n"));
    assert.equal(state.uncertainty, null);
    assert.equal(state.cycles[0].phase, "stopped");
    assert.ok(state.cycles[0].implementationResult);
    assert.equal(state.cycles[0].reviewResult, null);
    const stoppedTask = state.executions.find(({ binding }) => binding.id === state.stops[0].taskId);
    assert.equal(stoppedTask.completion, "result-submission");
    assert.equal(stoppedTask.end, null);
    assert.equal(state.requests.find(({ id }) => id === "new").status, "completed");
    assert.equal(f.history.filter(({ role }) => role === "reviewer").length, 0);
    assert.equal(f.errors.length, 0);
  } finally {
    release.resolve();
    f.session.processing = false;
  }
});

for (const successor of [
  { name: "aggregate", role: "implementer", taskId: null, completed: 2 },
  { name: "next-task", role: "implementer", taskId: "view", completed: 1 },
  { name: "review", role: "reviewer", taskId: null, completed: 2 },
]) for (const cut of ["before-task-save", "before-native-send"]) {
  test(`after-step ordering survives retained pre-Stop load at ${cut} for ${successor.name}`, { timeout: 120_000 }, async (t) => {
    const selected = Promise.withResolvers(), release = Promise.withResolvers(), scope = new AsyncLocalStorage();
    const f = await fixture(t, async (packet, session) => {
      if (packet.binding.role === "router") return route(session, packet, packet.binding.requestId === "implement" ? "implement" : "answer");
      return ordinary(packet, session);
    });
    const load = f.runtime.store.load.bind(f.runtime.store);
    const transportSend = f.runtime.transport.send.bind(f.runtime.transport);
    const read = f.runtime.workspace.readSnapshot.bind(f.runtime.workspace);
    const mode = f.session.rpc.mode.get.bind(f.session.rpc.mode);
    const nativeSend = f.session.send.bind(f.session);
    const matches = (binding) => binding.requestId === "implement"
      && binding.role === successor.role && binding.internalTaskId === successor.taskId;
    let held = false;
    const cancelledSends = [];

    t.mock.method(f.runtime.transport, "send", (packet) => scope.run({
      binding: packet.binding, target: matches(packet.binding), armed: false,
    }, () => transportSend(packet)));
    t.mock.method(f.runtime.workspace, "readSnapshot", async (...args) => {
      const result = await read(...args), current = scope.getStore();
      if (current?.target && cut === "before-task-save") current.armed = true;
      return result;
    });
    t.mock.method(f.session.rpc.mode, "get", async () => {
      const result = await mode(), current = scope.getStore();
      if (current?.target && cut === "before-native-send") {
        const state = await load();
        if (state.activeTask?.binding.id === current.binding.id && state.activeTask.messageId === null) current.armed = true;
      }
      return result;
    });
    t.mock.method(f.runtime.store, "load", async () => {
      const state = await load(), current = scope.getStore();
      if (!held && current?.target && current.armed) {
        held = true;
        selected.resolve({ state, binding: current.binding });
        // Hold the selected value, not the read: Stop's independently scoped reads must finish normally.
        await release.promise;
      }
      return state;
    });
    t.mock.method(f.session, "send", async (options) => {
      const packet = JSON.parse(options.prompt.split("\n").at(-1));
      if (packet.binding && matches(packet.binding) && (await load()).requests.some(({ id, status }) => id === "implement" && status === "stopped")) {
        cancelledSends.push(packet.binding);
        // Record the SDK dispatch attempt without starting an orphan fixture script awaiting impossible ownership.
        return NativeSession.prototype.send.call(f.session, options);
      }
      return nativeSend(options);
    });

    try {
      await f.send("implement", "Implement both parts.");
      const retained = await selected.promise;
      assert.equal(retained.state.activeRequestId, "implement");
      assert.equal(retained.state.stop, null);
      assert.equal(retained.state.uncertainty, null);
      assert.equal(retained.state.cycles[0].tasks.filter(({ status }) => status === "completed").length, successor.completed);
      assert.equal(retained.state.activeTask?.binding.id ?? null, cut === "before-native-send" ? retained.binding.id : null);
      const stopped = await f.runtime.stop(`retained-${successor.name}-${cut}`);
      assert.equal(stopped.status, "stopping");
      const admitted = cut === "before-native-send";
      if (!admitted) await waitFor(async () => !(await load()).stop, "unadmitted successor Stop confirmation");
      const stoppedState = await load();
      if (admitted) {
        assert.equal(stoppedState.activeTask.binding.id, retained.binding.id);
        assert.equal(stoppedState.activeTask.condition, "queued");
        assert.equal(stoppedState.activeTask.messageId, null);
        assert.equal(stoppedState.stops.length, 0, "Admission-winning roles must finish, not be marked not-sent.");
      } else {
        assert.equal(stoppedState.cycles[0].phase, "stopped");
        assert.equal(stoppedState.activeTask, null);
      }
      if (admitted) await assert.rejects(f.send("new", "Explain retained code without continuing the stopped request."), /Stop after current step is still settling/);
      else await f.send("new", "Explain retained code without continuing the stopped request.");
      assert.deepEqual((await load()).requests.map(({ id, status }) => ({ id, status })), [
        { id: "implement", status: admitted ? "active" : "stopped" }, ...(!admitted ? [{ id: "new", status: "waiting" }] : []),
      ]);
      assert.equal(f.history.some(({ requestId }) => requestId === "new"), false);
      release.resolve();
      const settled = await f.runtime.whenIdle();
      assert.equal(settled.status, "ready", settled.reason);
      if (admitted) await f.send("new", "Explain retained code without continuing the stopped request.");
      const readiness = await f.runtime.whenIdle(), state = await load();
      const frames = (await readFile(join(f.project, ".tandem", "living-canvas", "host-state", "journal.wal"), "utf8"))
        .trimEnd().split("\n").map((line) => JSON.parse(line.slice(9)));
      const intentFrame = frames.find((frame) => frame.cause === "human-loop:request-step-stop");
      const taskFrames = frames.filter((frame) => frame.cause === "human-loop:start-role"
        && frame.updates.some(({ key }) => key === `${retained.binding.inputDigest}.json`));
      const facts = {
        cut, successor: successor.name, status: readiness.status, reason: readiness.reason,
        taskWritesAfterIntent: taskFrames.filter(({ seq }) => seq > intentFrame.seq).length,
        cancelledNativeSends: cancelledSends.length,
        taskPersistedCount: taskFrames.length,
        cycleRetained: admitted ? null : policyHash(state.cycles[0]) === policyHash(stoppedState.cycles[0]),
        successorSends: f.history.filter(({ role, taskId, requestId }) =>
          requestId === "implement" && role === successor.role && taskId === successor.taskId).length,
        requests: state.requests.map(({ id, status }) => ({ id, status })),
      };
      t.diagnostic(JSON.stringify(facts));
      assert.deepEqual(facts, {
        cut, successor: successor.name, status: "ready", reason: null,
        taskWritesAfterIntent: 0, cancelledNativeSends: 0,
        taskPersistedCount: admitted ? 1 : 0, successorSends: admitted ? 1 : 0,
        cycleRetained: admitted ? null : true,
        requests: [{ id: "implement", status: admitted && successor.role === "reviewer" ? "completed" : "stopped" },
          { id: "new", status: "completed" }],
      }, "Atomic admission determines the one permitted step; stale reads cannot authorize another or poison new input.");
      assert.equal(state.uncertainty, null);
      assert.equal(Boolean(state.cycles[0].reviewResult), admitted && successor.role === "reviewer");
      assert.equal(state.cycles[0].phase, admitted && successor.role === "reviewer" ? "completed" : "stopped");
      assert.equal(state.cycles[0].tasks.filter(({ status }) => status === "completed").length, admitted ? 2 : successor.completed);
      assert.equal(f.errors.length, 0);
    } finally { release.resolve(); }
  });
}
