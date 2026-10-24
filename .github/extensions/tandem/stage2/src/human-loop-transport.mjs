import { humanLoopPrompts } from "../public/prompts/human-loop.js";
import { HumanLoopPreferences, normalizeModelCatalog } from "./human-loop-preferences.mjs";
import { parseHumanLoopOwner, requireHumanRequestRunning } from "../runtime-src/domain/human-loop/model.ts";
import { parseRoleResult } from "../runtime-src/domain/human-loop/contracts.ts";
import { humanLoopResultTools, humanLoopProgressTool, humanLoopStopTool } from "../runtime-src/domain/human-loop/tool-contracts.ts";
import { PrivateTaskBudget } from "../runtime-src/domain/workflow/private-task-budget.ts";
import { parseOwnedQueue } from "../runtime-src/domain/workflow/owned-execution-primitives.ts";
import { validatePolicyShape } from "../runtime-src/domain/workflow/policy-contracts.ts";
import { policyHash } from "../runtime-src/domain/workflow/policy.ts";
import { requireCondition, text } from "../runtime-src/domain/workflow/validation.ts";
import { parseHumanTask, humanTaskPrompt, humanInputEnvelope, nativeUserEvidence } from "./human-loop-task.mjs";
import { annotationCapabilities } from "../runtime-src/domain/workflow/annotation-attachment.ts";
import { isImageAttachment, readRequestAttachment } from "../runtime-src/domain/workflow/image-attachment.ts";
import { parseNativeClose } from "./human-loop-close.mjs";
import { readRecoveryHistory, recoveryReadinessSnapshot, retainRecoveryMessages, verifyNativeSessionAbsent } from "./human-loop-recovery.mjs";
import { HumanLoopCompaction, compactionInstructions } from "./human-loop-compaction.mjs";
import { nativeFileTools } from "./human-loop-native-files.mjs";
import { nativeShellTools, cancelNativeShellTask } from "./human-loop-native-shells.mjs";
import { NativeShellOutput } from "./native-shell-output.mjs";
import { captureNativeControlEvidence } from "./human-loop-native-recovery.mjs";
import { awaitWorkflowProvider, parseEvidenceScopes, reviewAgentName, reviewCollectorToolName, reviewWorkflowName, stageReviewProvider } from "./native-evidence-workflow.mjs";

const safeReason = (error, limit) => (error instanceof Error ? error.message : "Execution validation failed.")
  .replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, limit);
const reviewScopeTools = ["view", "grep", "glob"];
const reviewReadTools = new Set([...reviewScopeTools, "rg"]);
const reviewNativeTools = new Set([...reviewScopeTools, "rg", reviewCollectorToolName, "read_powershell", "list_powershell"]);
const workflowSettled = new Set(["completed", "error", "halted", "paused", "cancelled"]);

/** New one-copy protocol; shares cancellation, permission brokerage and active budgets with the preserved legacy adapter. */
export class HumanLoopTransport {
  #owner;
  #client;
  #workspace;
  #store;
  #verify;
  #authorize;
  #permissionHandler;
  #tools;
  #results = new Map(humanLoopResultTools().map((tool) => [tool.name, tool]));
  #session = null;
  #active = null;
  #failure = null;
  #failureWrite = null;
  #tail = Promise.resolve();
  #seen = new Map();
  #users = new Map();
  #closing = false;
  #now;
  #onProgress;
  #sessionApprovals = new Set();
  #sending = false;
  #admitting = null;
  #validateResult;
  #validateAttachment;
  #registrationStarted = false;
  #nativeRegistrationAttempted = false;
  #admittedWork = false;
  #startupDisconnected = false;
  #released = false;
  #historicEvents = new Map();
  #retiredHistory = new Set();
  #readingRecovery = false;
  #observedEvents = new Map();
  #retiredMessages = new Set();
  #retiredEnvelopes = new Map();
  #retiredInteractions = new Set();
  #retiredCalls = new Set();
  #retiredInputs = false;
  #retiredAgents = new Set();
  #nativeFiles;
  #nativeShells;
  #automaticOutput;
  #descendantCalls = new Map();
  #nativeAccess;
  #automaticReads = new Set();
  #workflowBootstrap;
  #workflowBatch = null;
  #retiredWorkflowRuns = new Set();
  #compaction = new HumanLoopCompaction((event) => this.#notify(event));
  #createPrivateSession;
  #beforeNativeCreate;
  #afterNativeCreate;

  constructor({ owner, client, workflowBootstrap, workspace, store, tools = [], nativeFiles = false, nativeShells = null, verifyOwnership, authorizeTool, permissionHandler, now, onProgress, validateResult, validateAttachment, createPrivateSession, beforeNativeCreate, afterNativeCreate }) {
    this.#owner = parseHumanLoopOwner(owner);
    requireCondition(typeof verifyOwnership === "function" && typeof authorizeTool === "function",
      "One-copy transport requires explicit ownership and tool-authority verifiers.");
    this.#client = client; this.#workspace = workspace; this.#store = store;
    this.#createPrivateSession = createPrivateSession ?? (configuration => client.createSession(configuration));
    this.#beforeNativeCreate = beforeNativeCreate;
    this.#afterNativeCreate = afterNativeCreate;
    this.#workflowBootstrap = workflowBootstrap;
    this.#verify = verifyOwnership; this.#authorize = authorizeTool; this.#permissionHandler = permissionHandler;
    this.#tools = new Map(tools.map((tool) => [tool.name, tool]));
    requireCondition(this.#tools.size === tools.length && tools.every(({ name }) =>
      !this.#results.has(name) && name !== humanLoopProgressTool.name && name !== humanLoopStopTool.name), "Private tools cannot replace typed lifecycle tools.");
    this.#now = now; this.#onProgress = onProgress;
    this.#validateResult = validateResult;
    this.#validateAttachment = validateAttachment;
    this.#nativeShells = nativeShells;
    this.#nativeAccess = {
      admit: async (name, args) => ({ name, args: structuredClone(args) }),
    };
    this.#nativeFiles = nativeFiles ? this.#nativeAccess : null;
    this.#automaticOutput = new NativeShellOutput();
    nativeShells?.setStopHandler(entry => this.#stopNativeShell(entry),
      () => Boolean(this.#session) && !this.#closing && !this.#released);
    nativeShells?.setTaskReader?.(async () => {
      requireCondition(this.#session && !this.#closing && !this.#released
        && typeof this.#session.rpc.tasks?.list === "function", "Native task registry is unavailable.");
      return this.#session.rpc.tasks.list();
    }, () => {
      if (!this.#closing && !this.#released) this.#notify({ kind: "state" });
    });
    requireCondition(!nativeFiles || tools.every(({ name }) => !nativeFileTools.includes(name)),
      "Custom tools cannot shadow native file tools.");
  }

  #nativePolicy(name) {
    if (this.#domainTool(name)) return null;
    return nativeFileTools.includes(name) ? this.#nativeFiles
      : nativeShellTools.includes(name) ? this.#nativeShells
        : this.#nativeFiles || this.#nativeShells ? this.#nativeAccess : null;
  }
  #domainTool(name) {
    return this.#results.has(name) || this.#tools.has(name) || name === humanLoopProgressTool.name || name === humanLoopStopTool.name;
  }
  #reviewParent(call) {
    if (!call.reviewTaskId) return null;
    const active = this.#active;
    requireCondition(active?.packet.binding.id === call.reviewTaskId && !active.stopId && !active.result
      && !active.controller.signal.aborted, "The parent Review no longer authorizes child work.");
    requireCondition(active.reviewBatches.some(batch => batch.status === "running"
      && batch.children.get(call.agentId)?.status === "running"),
    "The native Review child is no longer running.");
    return active;
  }
  async #admitDescendant(input) {
    requireCondition(!this.#domainTool(input.toolName), "Only the root owned role may invoke Tandem domain tools.");
    requireCondition(!this.#released && !this.#closing && this.#session, "The private connection is not available.");
    const active = this.#active;
    if (active?.packet.binding.role === "reviewer") {
      // Native child hooks precede delivery of their tool-start event to the parent.
      const call = { reviewTaskId: active.packet.binding.id, agentId: input.sessionId };
      this.#reviewParent(call);
      requireCondition(reviewReadTools.has(input.toolName),
        "Review children have read-only file tools; nested delegation and canonical publication are unavailable.");
      await this.#verify(); this.#reviewParent(call);
      return {};
    }
    const key = policyHash({ name: input.toolName, args: input.toolArgs });
    const call = [...this.#descendantCalls.values()].find(call => !call.claimed && !call.completed && call.key === key);
    requireCondition(call, "Descendant hook lacks its SDK-observed native invocation.");
    call.claimed = true;
    this.#reviewParent(call);
    requireCondition(!call.reviewTaskId || reviewReadTools.has(call.name),
      "Review children have read-only file tools; nested delegation and canonical publication are unavailable.");
    await this.#verify();
    this.#reviewParent(call);
    call.policy = nativeFileTools.includes(call.name) && this.#nativeFiles ? this.#nativeFiles : this.#nativeAccess;
    call.admission = await call.policy.admit(call.name, input.toolArgs);
    return {};
  }
  async #descendantPermission(request, invocation) {
    try {
      this.#requireSessionId(invocation.sessionId);
      const call = this.#descendantCalls.get(request.toolCallId);
      requireCondition(call && (call.admission || call.nativePermission) && !call.completed
        && !this.#released && !this.#closing && this.#permissionHandler,
        "Descendant permission lacks its live SDK invocation.");
      const parent = this.#reviewParent(call);
      requireCondition(!parent || request.kind === "read", "Review child permissions are read-only.");
      requireCondition(!call.nativePermission || request.kind === call.nativePermission.kind
        && request.path === call.nativePermission.path, "Child permission differs from its native request.");
      await this.#verify(); await call.policy.permission?.(call.admission, request);
      const decision = await this.#permissionHandler(request, invocation, {
        signal: parent ? AbortSignal.any([call.completion.signal, parent.controller.signal]) : call.completion.signal,
        onceOnly: true, nativeSessionGrantEligible: true,
        ...(parent ? { provenance: { toolName: call.name ?? request.kind, taskId: parent.packet.binding.id,
          requestId: parent.packet.binding.requestId, role: "reviewer" } } : {}),
      });
      requireCondition(!call.completed && !this.#released && !this.#closing, "Descendant permission ended.");
      this.#reviewParent(call);
      await call.policy.permission?.(call.admission, request);
      return ["approve-once", "reject"].includes(decision.kind) ? decision : { kind: "reject" };
    } catch (error) {
      return { kind: "reject", feedback: safeReason(error, this.#owner.policy.values.resources.reviewReasonCharacters) };
    }
  }

  get passiveOutputPending() { return this.#automaticReads.size > 0; }
  async #stopNativeShell(entry) {
    this.#healthy();
    requireCondition(!this.#closing && !this.#released && this.#session
      && entry.sessionId === this.#owner.privateSessionId, "Native stop requires an open owned session and a background task.");
    try {
      await this.#verify();
      requireCondition(await this.#session.rpc.mode.get() === "interactive", "Native stop requires the owned Interactive session.");
      return await cancelNativeShellTask(this.#session.rpc.tasks, entry);
    } finally { this.#notify({ kind: "native-shell" }); }
  }

  get sessionId() { return this.#session?.sessionId ?? null; }
  get compaction() { return this.#compaction.read(); }
  get canCompact() { return typeof this.#session?.rpc?.history?.compact === "function"; }
  async compact() {
    await this.inspectIdle();
    requireCondition(!this.compaction.active && typeof this.#session.rpc.history?.compact === "function",
      "Context compaction is already active or unsupported by the installed SDK.");
    try {
      const result = await this.#session.rpc.history.compact({ trigger: "manual", customInstructions: compactionInstructions });
      requireCondition(result?.success === true, this.compaction.error ?? "The native runtime did not confirm successful context compaction.");
      this.#compaction.confirmed();
      return { success: true };
    } catch (error) { this.#compaction.failed(error); throw error; }
  }
  async listModels() {
    requireCondition(typeof this.#client.start === "function" && typeof this.#client.listModels === "function",
      "Installed SDK cannot list authenticated private-session models.");
    await this.#client.start();
    return normalizeModelCatalog(await this.#client.listModels());
  }
  async currentModelSelection() {
    requireCondition(typeof this.#session?.rpc?.model?.getCurrent === "function", "SDK cannot verify the actual private-session model.");
    const current = await this.#session.rpc.model.getCurrent();
    requireCondition(typeof current?.modelId === "string" && current.modelId.trim() && current.modelId.length <= 200,
      "SDK did not positively identify the actual private-session model.");
    requireCondition(current.reasoningEffort == null || typeof current.reasoningEffort === "string"
      && current.reasoningEffort.trim() === current.reasoningEffort && current.reasoningEffort.length > 0
      && current.reasoningEffort.length <= 40, "SDK reasoning effort readback is invalid.");
    return { model: current.modelId, reasoningEffort: current.reasoningEffort ?? null };
  }
  async currentModel() { return (await this.currentModelSelection()).model; }
  get canSwitchModel() { return typeof this.#session?.setModel === "function" && typeof this.#session?.rpc?.model?.getCurrent === "function"; }
  get canSetReasoningEffort() { return typeof this.#session?.rpc?.model?.setReasoningEffort === "function"; }
  get canResetApprovals() { return typeof this.#session?.rpc?.permissions?.resetSessionApprovals === "function"; }
  async resetRememberedApprovals() {
    requireCondition(!this.#active && !this.#sending && !this.#closing,
      "Reset remembered approvals requires an idle private session; running commands are not cancelled.");
    await this.inspectIdle();
    requireCondition(typeof this.#session?.rpc?.permissions?.resetSessionApprovals === "function",
      "The SDK cannot reset remembered approvals.");
    const result = await this.#session.rpc.permissions.resetSessionApprovals({ includeLocation: false });
    requireCondition(result?.success === true, "SDK approval reset was not confirmed. No complete reset is claimed.");
    this.#sessionApprovals.clear();
  }
  async setModel(id, reasoningEffort = null) {
    requireCondition(this.canSwitchModel && !this.#closing && !this.#active && !this.#sending,
      "SDK model switching is unavailable, busy or closing.");
    requireCondition(reasoningEffort === null || this.canSetReasoningEffort, "SDK reasoning effort selection is unavailable.");
    await this.#session.setModel(id);
    if (reasoningEffort !== null) await this.#session.rpc.model.setReasoningEffort({ reasoningEffort });
  }
  async attachmentCapabilities(mimeType = "image/png") { return annotationCapabilities(this.#session, this.#client, mimeType); }
  async requestAttachments(requests, design) {
    const refs = [...new Map(requests.flatMap((request) => request?.attachments ?? []).map((ref) => [ref.id, ref])).values()];
    if (!refs.length) return undefined;
    requireCondition(refs.length <= 1, "This batch exceeds the supported image count.");
    return Promise.all(refs.map(async (ref) => {
      const capability = await this.attachmentCapabilities(ref.mimeType);
      requireCondition(capability.supported, capability.reason ?? "The selected model cannot receive this image type.");
      if (!isImageAttachment(ref)) {
        if (ref.source.revisionId !== design.revisionId) throw Object.assign(new Error("The retained diagram belongs to an earlier Design revision; no image was rebound."), { code: "annotation-stale-revision" });
        await this.#validateAttachment?.(ref, design);
      }
      requireCondition(ref.byteLength <= capability.limits.maxBytes, "The diagram exceeds the selected model's image-size limit.");
      return { type: "blob", data: (await readRequestAttachment(this.#owner.workspacePath, ref)).toString("base64"), mimeType: ref.mimeType,
        displayName: `${isImageAttachment(ref) ? "image" : "diagram"}-${ref.sha256}.${ref.mimeType === "image/jpeg" ? "jpg" : "png"}` };
    }));
  }
  timing(taskId) {
    const active = this.#requireActive();
    requireCondition(active.packet.binding.id === taskId, "Timing belongs to another role.");
    return active.budget.snapshot();
  }

  async create() { return this.#openSession(null); }
  async #createOwnedSession(configuration) {
    if (this.#beforeNativeCreate) {
      requireCondition(typeof this.#client.start === "function", "Native creation requires a started private client.");
      await this.#client.start();
    }
    await this.#beforeNativeCreate?.();
    this.#nativeRegistrationAttempted = true;
    this.#session = await this.#createPrivateSession(configuration);
    requireCondition(this.#session.sessionId === this.#owner.privateSessionId, "Native creation returned another private identity.");
    await this.#afterNativeCreate?.(this.#session.sessionId);
    return this.#session;
  }
  async recover(state, cleanNativeProof = null, diagnose, allowMissingInitialSession = false) {
    this.#healthy(); await this.#verify();
    requireCondition(!allowMissingInitialSession || (!cleanNativeProof && !state.executions.length
      && !state.requests.length && !state.cycles.length), "Only an unexecuted first creation may retry a missing native session.");
    requireCondition(typeof diagnose === "function", "Recovery needs a durable diagnostic recorder.");
    requireCondition(typeof this.#client.start === "function", "Installed SDK cannot resume the retained native session.");
    await this.#client.start();
    let history = [];
    if (allowMissingInitialSession) await verifyNativeSessionAbsent(this.#client, this.#owner.privateSessionId);
    else {
      try { history = await readRecoveryHistory(this.#client, this.#owner.privateSessionId); }
      catch (error) { await diagnose("retained-history", safeReason(error, this.#owner.policy.values.resources.reviewReasonCharacters)); }
    }
    await retainRecoveryMessages(this.#store, state, history, diagnose);
    this.#retiredInputs = Boolean(state.activeTask || state.executions.length || history.some(event => event.type === "user.message"));
    const retained = recoveryReadinessSnapshot(this.#owner.privateSessionId, history);
    this.#retiredHistory = new Set(retained.events.map(event => event.id));
    await this.#openSession(retained, true, allowMissingInitialSession);
    const evidence = { sessionId: this.#owner.privateSessionId, events: [...this.#historicEvents.values()],
      users: [...this.#users.values()] };
    evidence.digest = policyHash(evidence.events);
    const nativeControl = await this.#recoveryControl(evidence);
    return nativeControl ? { ...evidence, nativeControl } : evidence;
  }
  async #recoveryControl(evidence) {
    if (!await this.#nativeShells?.recoveryDiagnosticsRequired()) return;
    return captureNativeControlEvidence(this.#session, { sessionId: evidence.sessionId, digest: evidence.digest },
      () => this.inspectIdle(), this.#owner.policy.values.resources.reviewCollections);
  }
  async reopen(value) {
    const proof = parseNativeClose(value);
    requireCondition(proof.sessionId === this.#owner.privateSessionId, "Close receipt belongs to another private owner.");
    return this.recover(await this.#store.load(), proof, async (stage, reason) => {
      this.#notify({ kind: "recovery-warning", stage, reason });
    });
  }
  async #openSession(proof, recovering = false, allowMissingInitialSession = false) {
    this.#healthy();
    requireCondition(!this.#registrationStarted && !this.#session && !this.#active, "Private registration cannot be repeated.");
    this.#registrationStarted = true;
    await this.#verify();
    const tools = [...this.#results.values(), humanLoopProgressTool, ...this.#tools.values()].map((tool) => ({
      name: tool.name, description: tool.description, parameters: tool.parameters,
      skipPermission: !tool.requiresPermission,
      ...(this.#results.has(tool.name) ? { isTerminal: true } : {}),
      handler: (args, invocation) => this.#invoke(tool.name, args, invocation),
    }));
    try {
      const preferences = await new HumanLoopPreferences(this.#owner.workspacePath).read();
      if ((!proof || allowMissingInitialSession) && (preferences.model || preferences.pendingModel)) {
        requireCondition(!preferences.pendingModel, "Unsettled model selection requires the original session; no substitute was created.");
        const selected = (await this.listModels()).find(({ id }) => id === preferences.model);
        requireCondition(selected, "Saved Canvas model is unavailable; no fallback was selected.");
        requireCondition(preferences.reasoningEffort === null || selected.supportedReasoningEfforts.includes(preferences.reasoningEffort),
          "Saved reasoning effort is unavailable; no fallback was selected.");
      }
      const configuration = {
        sessionId: this.#owner.privateSessionId, workingDirectory: this.#owner.workspacePath,
        ...(!proof && preferences.model ? { model: preferences.model } : {}),
        ...(!proof && preferences.reasoningEffort !== null ? { reasoningEffort: preferences.reasoningEffort } : {}),
        enableConfigDiscovery: true, requestExtensions: false, tools, toolSearch: { enabled: false },
        ...(this.#workflowBootstrap ? { enableExperimentalMode: true,
          extensionSdkPath: this.#workflowBootstrap.extensionSdkPath } : {}),
        customAgents: [{ name: reviewAgentName, description: "Read-only evidence for one scoped Tandem Review.",
          tools: reviewScopeTools, prompt: humanLoopPrompts.reviewScope.join("\n") }],
        onEvent: (event) => this.#observe(event),
        hooks: { onPreToolUse: async (input, invocation) => {
          try {
            this.#requireSessionId(invocation.sessionId);
            // Native apply_patch uses raw patch grammar, not serialized JSON arguments.
            if (typeof input.toolArgs === "string" && input.toolName !== "apply_patch") {
              input = { ...input, toolArgs: JSON.parse(input.toolArgs) };
            }
            if (input.sessionId !== this.#owner.privateSessionId) {
              text(input.sessionId);
              return await this.#admitDescendant(input);
            }
            this.#requireSessionId(input.sessionId);
            if (this.#nativeShells && input.toolName === "powershell") requireCondition(
              input.workingDirectory === this.#owner.workspacePath, "Native command working directory differs from its owned project.");
            const admission = await this.#admit(input.toolName, input.toolArgs, "hook");
            if (this.#nativePolicy(input.toolName)) {
              return admission.modifiedArgs ? { modifiedArgs: admission.modifiedArgs } : {};
            }
            return this.#tools.get(input.toolName)?.requiresPermission ? {} : { permissionDecision: "allow" };
          } catch (error) {
            const active = this.#active;
            const hint = this.#results.has(input.toolName) && active && !this.#failure && !active.result && !active.stopId
              ? ` Current inputDigest: ${active.packet.binding.inputDigest}.` : "";
            return { permissionDecision: "deny", permissionDecisionReason:
              safeReason(error, this.#owner.policy.values.resources.reviewReasonCharacters) + hint };
          }
        } },
        onPermissionRequest: (request, invocation) => this.#permission(request, invocation),
      };
      if (proof) {
        this.#historicEvents = new Map(proof.events.map((event) => [event.id, event]));
        this.#users = new Map(proof.users.map((user) => [user.id, user]));
        requireCondition(typeof this.#client.start === "function" && typeof this.#client.getSessionMetadata === "function"
          && typeof this.#client.resumeSession === "function", "Installed SDK lacks explicit same-session resume APIs.");
        await this.#client.start();
        const metadata = await this.#client.getSessionMetadata(proof.sessionId);
        this.#readingRecovery = recovering;
        if (metadata === undefined && allowMissingInitialSession) {
          requireCondition(!proof.events.length && !proof.users.length,
            "Native first-creation retry cannot replace retained history.");
          await verifyNativeSessionAbsent(this.#client, this.#owner.privateSessionId);
          this.#session = await this.#createOwnedSession({
            ...configuration, ...(preferences.model ? { model: preferences.model } : {}),
            ...(preferences.reasoningEffort !== null ? { reasoningEffort: preferences.reasoningEffort } : {}),
          });
        } else {
          requireCondition(!allowMissingInitialSession,
            "Native session metadata conflicts with unused setup evidence; no existing session was adopted.");
          if (metadata === undefined) throw Object.assign(new Error("The saved local private session is unavailable; no replacement session was created."),
            { code: "human-loop-native-session-missing" });
          requireCondition(metadata?.sessionId === proof.sessionId && metadata.isRemote !== true,
            "The saved local private session is unavailable; no replacement session was created.");
          this.#nativeRegistrationAttempted = true;
          this.#session = await this.#client.resumeSession(proof.sessionId, {
            ...configuration, continuePendingWork: false, suppressResumeEvent: true,
          });
          await this.#afterNativeCreate?.(this.#session.sessionId);
        }
      } else {
        this.#session = await this.#createOwnedSession(configuration);
      }
      if (this.#workflowBootstrap) {
        requireCondition(this.#session.sessionId === this.#owner.privateSessionId, "Workflow bootstrap returned another private session owner.");
        await stageReviewProvider(this.#session, this.#workflowBootstrap.extensionPath);
        this.#session = await this.#client.resumeSession(this.#owner.privateSessionId, {
          ...configuration, requestExtensions: true, continuePendingWork: false, suppressResumeEvent: true,
        });
        await this.#session.rpc.extensions.reload();
        await awaitWorkflowProvider(this.#session);
        this.#session = await this.#client.resumeSession(this.#owner.privateSessionId, {
          ...configuration, requestExtensions: false, continuePendingWork: false, suppressResumeEvent: true,
        });
        await awaitWorkflowProvider(this.#session);
        requireCondition(typeof this.#session.workflow?.getRun === "function"
          && typeof this.#session.workflow?.cancel === "function", "Installed SDK lacks native workflow observation/cancellation.");
      }
      const session = this.#session;
      requireCondition(session.sessionId === this.#owner.privateSessionId && typeof session.abort === "function"
        && typeof session.rpc?.mode?.get === "function" && typeof session.rpc?.metadata?.isProcessing === "function"
        && typeof session.rpc?.metadata?.activity === "function" && typeof session.rpc?.queue?.pendingItems === "function"
        && typeof session.getEvents === "function", "Installed SDK lacks required owned execution/cancellation APIs.");
      requireCondition(await session.rpc.mode.get() === "interactive", "Use Interactive mode; the Host will not change it.");
      let history = await session.getEvents();
      if (proof) {
        const current = recoveryReadinessSnapshot(this.#owner.privateSessionId, history);
        for (const event of current.events) this.#retiredHistory.add(event.id);
        this.#historicEvents = new Map(current.events.map(event => [event.id, event]));
        this.#users = new Map(current.users.map(user => [user.id, user]));
        this.#readingRecovery = false;
        await this.inspectIdle();
        requireCondition(typeof session.rpc.permissions?.resetSessionApprovals === "function",
          "The SDK cannot renew permission prompts for this reopened private session.");
        const reset = await session.rpc.permissions.resetSessionApprovals({ includeLocation: false });
        requireCondition(reset?.success === true, "Private-session permission reset was not confirmed.");
        this.#sessionApprovals.clear();
      } else requireCondition(!history.some(({ type }) => type === "user.message"), "A fresh private identity already contains user work; no session adoption.");
      await this.inspectIdle();
    } catch (error) {
      await this.#fail(recovering ? "Restart cannot accept new work in the current private session."
        : proof ? "Private clean reopen is unconfirmed; do not resume again blindly." : "Private session creation/ownership is unconfirmed.", error);
      throw error;
    }
    return this.#session.sessionId;
  }

  async send(value) {
    requireCondition(!this.#sending, "Another dispatch admission is active.");
    this.#sending = true;
    try { return await this.#send(value); }
    catch (error) {
      if (error.code === "human-loop-stop" || this.#failure || this.#active?.sent) throw error;
      if (this.#active) this.#active.notSent = true;
      throw Object.assign(new Error(error.message, { cause: error }), {
        code: "human-loop-not-dispatched", taskId: this.#active?.packet.binding.id ?? null,
      });
    }
    finally { this.#sending = false; }
  }

  async #send(value) {
    this.#healthy();
    requireCondition(this.#session && !this.#active && !this.#closing, "Another task or close owns the private session.");
    const packet = parseHumanTask(value), binding = packet.binding;
    requireCondition(binding.sessionId === this.#owner.privateSessionId, "Task targets another private session.");
    requireCondition(Buffer.byteLength(JSON.stringify(packet)) <= this.#owner.policy.values.resources.reviewPromptCharacters * 4,
      "Task context exceeds its bounded packet size.");
    requireHumanRequestRunning(await this.#store.load(), binding.requestId);
    const currentRequests = packet.context.requests ?? [packet.context.request];
    const originRequests = binding.cycleId && packet.context.cycle?.id === binding.cycleId
      ? (packet.context.originalRequests ?? [packet.context.originalRequest]).filter(Boolean)
        .map(request => ({ ...request, attachments: request.attachments?.filter(isImageAttachment) }))
      : [];
    const attachments = await this.requestAttachments([...currentRequests, ...originRequests], binding.design);
    if (binding.before !== null) await this.#workspace.readSnapshot(binding.before);
    requireHumanRequestRunning(await this.#store.load(), binding.requestId);
    this.#admittedWork = true;
    this.#admitting = this.#store.admitTask(packet);
    await this.#admitting;
    const prompt = humanTaskPrompt(packet);
    const active = { packet, envelope: humanInputEnvelope(prompt, attachments), bound: false,
      messageId: null, user: null, starts: [], acknowledged: false, started: false,
      result: null, resultSubmitted: false, submitting: false, resultCallId: null,
      continuation: null, missingResultIdle: null,
      stopId: null, stopAcknowledged: false,
      controller: new AbortController(), budget: new PrivateTaskBudget(this.#now), tools: new Set(), grants: new Map(), admittedTools: new Map(), nativeCalls: new Map(), nativeRequests: new Map(),
      sent: false, notSent: false, reviewBatches: [], resultReady: Promise.withResolvers() };
    active.resultReady.promise.catch(() => {});
    this.#active = active;
    this.#admitting = null;
    const state = await this.#store.load();
    if (state.stop && state.stop.mode !== "after-step") {
      active.stopId = state.stop.id; active.notSent = true; active.controller.abort();
      return null;
    }
    try {
      this.#healthy(); await this.#verify();
      requireCondition(await this.#session.rpc.mode.get() === "interactive", "Private mode changed before dispatch.");
      requireHumanRequestRunning(await this.#store.load(), binding.requestId, binding.id);
      requireCondition(this.#active === active && !active.stopId && !active.controller.signal.aborted,
        "Native dispatch no longer belongs to the admitted role.");
      await this.#store.dispatch("host", `input:${binding.dispatchId}:initial`, "role-input-prepared",
        { taskId: binding.id, dispatchId: binding.dispatchId, inputDigest: binding.inputDigest, envelope: active.envelope });
      requireHumanRequestRunning(await this.#store.load(), binding.requestId, binding.id);
      requireCondition(this.#active === active && !active.stopId && !active.controller.signal.aborted,
        "Stop or ownership changed at the direct dispatch boundary.");
      active.sent = true;
      const acknowledgement = this.#session.send({
        mode: "immediate", agentMode: "interactive",
        ...(attachments ? { attachments } : {}),
        prompt,
      }).then(async value => {
        const messageId = text(value);
        if (this.#active !== active || active.resultSubmitted || active.stopId || this.#closing) return messageId;
        requireCondition(!active.user?.messageId || active.user.messageId === messageId, "Native acknowledgement conflicts with the delivered task.");
        active.messageId = messageId;
        await this.#store.dispatch("runtime", `ack:${binding.dispatchId}`, "role-acknowledged", { taskId: binding.id, dispatchId: binding.dispatchId, messageId });
        active.acknowledged = true; this.#pump(); await this.drain();
        return messageId;
      });
      acknowledgement.catch(error => {
        if (active.resultSubmitted || active.stopId || this.#closing || this.#released) this.#notify({ kind: "dispatch-diagnostic", summary: error.message });
        else void this.#fail("Private dispatch acknowledgement failed.", error);
      });
      return await Promise.race([acknowledgement, active.resultReady.promise.then(() => active.messageId)]);
    } catch (error) {
      if (error.code === "human-loop-stop") {
        if (!active.sent) active.notSent = true;
        active.controller.abort();
        throw error;
      }
      if (!active.sent) throw error;
      await this.#fail("Private dispatch acknowledgement is uncertain; do not resend.", error);
      throw error;
    }
  }

  async waitForResult(taskId) {
    const active = this.#requireActive();
    requireCondition(active.packet.binding.id === taskId, "Awaited task differs from the owned role.");
    this.#pump();
    return active.resultReady.promise;
  }

  async #continueMissingResult(active) {
    const prompt = humanTaskPrompt(active.packet, "continuation");
    const continuation = { envelope: humanInputEnvelope(prompt, [], "continuation"), bound: false,
      messageId: null, user: null, acknowledged: false, sent: false };
    active.continuation = continuation;
    const current = () => this.#active === active && !active.result
      && !active.stopId && !active.controller.signal.aborted && !this.#closing && !this.#released;
    try {
      await this.#store.recordMessage({ id: `continuation:${active.packet.binding.id}`,
        requestId: active.packet.binding.requestId, role: "host", kind: "status", timestamp: new Date().toISOString(),
        content: "The agent ended without reporting its required result. One continuation is allowed for this task; completed work is retained." });
      if (!current() || active.submitting) return;
      await this.#verify();
      requireCondition(await this.#session.rpc.mode.get() === "interactive", "Private mode changed before continuation.");
      const state = await this.#store.load();
      if (!current() || active.submitting || state.stop) return;
      const binding = active.packet.binding;
      await this.#store.dispatch("host", `input:${binding.dispatchId}:continuation`, "role-input-prepared",
        { taskId: binding.id, dispatchId: binding.dispatchId, inputDigest: binding.inputDigest, envelope: continuation.envelope });
      if (!current() || active.submitting || (await this.#store.load()).stop) return;
      continuation.sent = true;
      const messageId = text(await this.#session.send({
        mode: "immediate", agentMode: "interactive",
        prompt,
      }));
      continuation.messageId = messageId;
      if (!current()) {
        this.#retiredMessages.add(messageId);
        return;
      }
      requireCondition(!continuation.user?.messageId || continuation.user.messageId === messageId,
        "Native continuation acknowledgement differs from its delivered input.");
      await this.#store.dispatch("runtime", `ack:${binding.dispatchId}:continuation`, "continuation-acknowledged",
        { taskId: binding.id, dispatchId: binding.dispatchId, messageId });
      continuation.acknowledged = true;
      this.#notify({ kind: "role-continuation", requestId: active.packet.binding.requestId,
        summary: "Continuing the same work once to obtain its required result." });
      this.#pump();
    } catch (error) {
      if (!current()) this.#notify({ kind: "dispatch-diagnostic", summary: error.message });
      else await this.#fail("The required-result continuation could not be prepared or sent; no automatic resend.", error);
    }
  }

  async stop(stopId) {
    requireCondition(this.#session?.sessionId === this.#owner.privateSessionId, "The owned native session is unavailable.");
    const active = this.#active;
    if (active) {
      active.stopId = stopId; active.controller.abort();
      active.resultReady.reject(Object.assign(new Error("The user stopped this work."), { code: "human-loop-stop" }));
    }
    requireCondition(typeof this.#session.rpc.interruptMainTurn === "function",
      "Installed SDK cannot interrupt the foreground without stopping background apps.");
    const cancellation = this.#cancelReviewWorkflow(active);
    const [result] = await Promise.all([
      this.#session.rpc.interruptMainTurn({ flushQueued: true }),
      cancellation,
    ]);
    requireCondition(typeof result?.interrupted === "boolean", "Native interruption returned no supported operation outcome.");
    if (active) active.stopAcknowledged = true;
    return { sessionId: this.#owner.privateSessionId, interrupted: result.interrupted };
  }

  release(taskId) {
    const active = this.#active;
    requireCondition(active?.packet.binding.id === taskId && (active.resultSubmitted || active.stopAcknowledged || active.notSent || !active.sent),
      "Cannot release another role or an unreported operation.");
    for (const input of [active, active.continuation].filter(Boolean)) {
      if (input.user) this.#retiredInteractions.add(input.user.interactionId);
      if (input.messageId) this.#retiredMessages.add(input.messageId);
      if (input.sent) this.#retiredEnvelopes.set(input.envelope.promptDigest, {
        envelope: input.envelope, user: input.user, messageId: input.messageId });
    }
    if (active.continuation?.messageId) this.#retiredMessages.add(active.continuation.messageId);
    if (active.sent) this.#retiredInputs = true;
    for (const id of active.nativeRequests.keys()) this.#retiredCalls.add(id);
    for (const id of active.nativeCalls.keys()) this.#retiredCalls.add(id);
    for (const batch of active.reviewBatches) {
      if (batch.runId) this.#retiredWorkflowRuns.add(batch.runId);
      for (const id of batch.children.keys()) this.#retiredAgents.add(id);
    }
    if (active.resultCallId) this.#retiredCalls.add(active.resultCallId);
    active.controller.abort(); this.#active = null;
    void this.#cancelReviewWorkflow(active).catch(error => this.#notify({ kind: "dispatch-diagnostic",
      summary: `Native Review factory cancellation was not confirmed: ${error.message}` }));
  }

  async #cancelReviewWorkflow(active) {
    const batch = this.#workflowBatch;
    if (!active || batch?.active !== active || !batch.runId || workflowSettled.has(batch.status)) return;
    batch.cancelling ??= this.#session.workflow.cancel(batch.runId).then(run => {
      requireCondition(run.runId === batch.runId && workflowSettled.has(run.status),
        "Native factory cancellation did not confirm an ended attempt.");
      batch.status = run.status;
    });
    const cancelling = batch.cancelling;
    try { await cancelling; }
    catch (error) {
      if (batch.cancelling === cancelling) batch.cancelling = null;
      throw error;
    }
  }

  async #reviewCoverage(active) {
    for (const batch of active.reviewBatches) {
      if (batch.status === "completed" && !batch.collected) {
        try {
          const run = await this.#session.workflow.getRun(batch.runId);
          requireCondition(run.runId === batch.runId && run.status === "completed"
            && run.result?.toolCallId === batch.toolCallId
            && policyHash(run.result.binding) === policyHash(active.packet.binding)
            && Array.isArray(run.result.scopes) && run.result.scopes.length === batch.scopes.length,
          "Native factory result differs from its admitted Review.");
          for (const [index, scope] of batch.scopes.entries()) {
            const result = run.result.scopes[index];
            requireCondition(result.id === scope.label && (result.evidence === null || typeof result.evidence === "string"),
              "Native factory scope identity or evidence is invalid.");
          }
          for (const [index, scope] of batch.scopes.entries()) {
            scope.status = run.result.scopes[index].evidence?.trim() ? "completed" : "failed";
            scope.reason = scope.status === "completed" ? null : "Native worker returned no usable evidence";
          }
          batch.collected = true;
        } catch (error) {
          for (const scope of batch.scopes) {
            scope.status = "failed";
            scope.reason = safeReason(error, this.#owner.policy.values.resources.reviewReasonCharacters);
          }
        }
      } else if (workflowSettled.has(batch.status) && batch.status !== "completed") {
        for (const scope of batch.scopes) {
          scope.status = "failed"; scope.reason = batch.reason ?? `Native factory ended as ${batch.status}`;
        }
      }
    }
    return active.reviewBatches.flatMap(batch => batch.scopes);
  }

  async inspectIdle(admission = false) {
    this.#healthy(); await this.#verify();
    requireCondition(this.#session, "Private session is not initialized.");
    requireCondition((!this.#sending || admission) && !this.#active && await this.#quiescent(null), "Owned runtime is not quiescent.");
    return true;
  }
  async close() {
    requireCondition(!this.#closing && !this.#released, "Private close is already owned.");
    this.#closing = true;
    if (this.#active) {
      this.#active.controller.abort();
      this.#active.resultReady.reject(Object.assign(new Error("The runtime is closing."), { code: "human-loop-stop" }));
    }
    const warnings = [];
    let saved = false, saveFinished = false;
    try {
      void (async () => {
        try {
          requireCondition(typeof this.#client.rpc?.sessions?.save === "function", "Native explicit-save API is unavailable.");
          await this.#client.rpc.sessions.save({ sessionId: this.#owner.privateSessionId });
          saved = true;
        } catch (error) { warnings.push(`Native save was not confirmed: ${error.message}`); }
        finally { saveFinished = true; }
      })();
      const errors = await this.#client.stop();
      requireCondition(Array.isArray(errors) && errors.length === 0,
        `Owned client shutdown failed: ${Array.isArray(errors) ? errors.map(String).join("; ") : "No shutdown outcome"}`);
      if (!saveFinished) warnings.push("Native explicit save had not been confirmed when shutdown completed.");
      this.#session = null;
      this.#released = true;
      return { schemaVersion: "human-loop-native-close/v2", sessionId: this.#owner.privateSessionId, saved, closed: true, warnings: [...warnings] };
    } catch (error) {
      error.message = [...warnings, error.message].join(" ");
      throw error;
    } finally { this.#closing = false; }
  }
  async releaseFailedStartup() {
    requireCondition(!this.#admittedWork && !this.#active && !this.#sending && !this.#closing,
      "This attempt has admitted work; failed-start retry cannot replace its live owner.");
    if (this.#released) return { nativeSessionCreated: this.#startupDisconnected };
    await this.#tail;
    await this.#failureWrite;
    if (this.#session && !this.#startupDisconnected) {
      requireCondition(this.#session.sessionId === this.#owner.privateSessionId
        && typeof this.#session.disconnect === "function" && typeof this.#session.rpc.tasks?.list === "function",
      "Failed startup lacks native ownership or disconnect/status APIs. Restore the supported runtime and explicitly retry.");
      const [processing, activity, queue, catalog] = await Promise.all([
        this.#session.rpc.metadata.isProcessing(), this.#session.rpc.metadata.activity(),
        this.#session.rpc.queue.pendingItems(), this.#session.rpc.tasks.list(),
      ]);
      requireCondition(processing?.processing === false && activity?.hasActiveWork === false
        && parseOwnedQueue(queue).length === 0 && Array.isArray(queue.steeringMessages) && !queue.steeringMessages.length
        && (queue.inFlightSteeringCount === undefined || queue.inFlightSteeringCount === 0)
        && Array.isArray(catalog?.tasks) && catalog.tasks.every(task => ["completed", "failed", "cancelled"].includes(task.status))
        && !this.compaction.active && !this.#automaticReads.size,
      "The failed startup still has current native work. Let it settle before explicitly retrying; nothing was cancelled.");
      await this.#session.disconnect();
      this.#startupDisconnected = true;
    } else if (!this.#startupDisconnected && this.#nativeRegistrationAttempted) {
      requireCondition(typeof this.#client.getSessionMetadata === "function",
        "Creation acknowledgement was lost and native session lookup is unavailable. Resolve the exact owner before retrying.");
      requireCondition(await this.#client.getSessionMetadata(this.#owner.privateSessionId) === undefined,
        "Creation acknowledgement was lost, but the native session exists. Its current activity must be reconciled before this attempt can be released.");
    }
    const errors = await this.#client.stop();
    requireCondition(Array.isArray(errors) && errors.length === 0,
      "Failed-start client release was not confirmed. Explicitly retry cleanup; no replacement was started.");
    this.#session = null;
    this.#released = true;
    return { nativeSessionCreated: this.#startupDisconnected };
  }
  async drain() { let pending; do { pending = this.#tail; await pending; } while (pending !== this.#tail); this.#healthy(); }

  async #admit(name, args, early) {
    const active = this.#requireActive();
    requireCondition(!active.stopId && !active.controller.signal.aborted && !active.result && !active.submitting,
      "The role no longer permits tool work.");
    const resultTool = this.#results.get(name);
    if (resultTool) {
      requireCondition(resultTool.roles.includes(active.packet.binding.role), "Result tool is outside the current role.");
      validatePolicyShape(resultTool.parameters, args);
      const result = parseRoleResult(active.packet.binding.role, args);
      requireCondition(result.inputDigest === active.packet.binding.inputDigest, "Result inputDigest differs from the current Host task.");
      if (result.outcome.kind === "review-result") {
        const scopes = await this.#reviewCoverage(active);
        const failed = scopes.filter(scope => scope.status !== "completed");
        if (failed.length) {
          result.outcome.coverageStatus = failed.length === scopes.length ? "unavailable"
            : result.outcome.coverageStatus === "complete" ? "partial" : result.outcome.coverageStatus;
          result.outcome.verificationLimits = [...new Set([...result.outcome.verificationLimits,
            ...failed.map(scope => `Scope ${scope.label}: ${scope.reason ?? "No completed native scope outcome was available when the parent reported"}. This scope remains unreviewed.`)])];
        }
      }
      await this.#validateResult?.(active.packet, result);
      await this.#store.validate("agent", "complete-role-result", result);
      return result;
    }
    const admissionKey = policyHash({ name, args });
    requireCondition(active.acknowledged && active.started, "Tool work requires a positively delivered and acknowledged task.");
    if (name === humanLoopProgressTool.name) {
      requireCondition(active.packet.binding.role === "implementer", "Only implementation reports task progress.");
      validatePolicyShape(humanLoopProgressTool.parameters, args);
      await this.#store.validate("agent", "report-progress", args);
      return null;
    }
    const nativePolicy = this.#nativePolicy(name);
    if (nativePolicy) {
      requireCondition(early === "hook", "Native file access must enter through its real native hook.");
      const call = [...active.nativeCalls.values()].find(call => !call.claimed && call.name === name && call.key === admissionKey);
      requireCondition(call, "Native file hook has no matching owned invocation.");
      call.claimed = true;
      requireCondition(name !== reviewCollectorToolName || active.packet.binding.role === "reviewer",
        "Only the current Reviewer may collect scoped factory evidence.");
      requireCondition(name !== "run_dynamic_workflow" || args?.name !== reviewWorkflowName,
        "Use the permission-gated Review collector, not a background Review factory invocation.");
      if (active.packet.binding.role === "reviewer") {
        requireCondition(reviewNativeTools.has(name), "Reviewer permits read-only inspection and its bounded native scope fan-out only.");
        if (name === reviewCollectorToolName) {
          requireCondition(args && Object.keys(args).length === 1 && Object.hasOwn(args, "scopes"),
            "Use only Review scopes without model, limit, context overrides or resume.");
          const scopes = parseEvidenceScopes(args.scopes);
          requireCondition(!this.#workflowBatch || workflowSettled.has(this.#workflowBatch.status),
            "Collect the current native factory before starting another group of Review scopes.");
          const toolCallId = [...active.nativeCalls].find(([, value]) => value === call)[0];
          call.reviewBatch = { active, toolCallId, runId: null, status: "admitted", children: new Map(),
            scopes: scopes.map(scope => ({ label: scope.id, status: "admitted", reason: null })) };
          active.reviewBatches.push(call.reviewBatch);
          this.#workflowBatch = call.reviewBatch;
          call.modifiedArgs = { scopes, packet: structuredClone(active.packet), toolCallId };
        }
      }
      await this.#verify(); await this.#authorize(active.packet, name, args);
      const admission = nativePolicy === this.#nativeFiles ? await nativePolicy.admit(name, args)
        : await nativePolicy.admit(name, args, active.packet, [...active.nativeCalls].find(([, value]) => value === call)[0]);
      call.admission = admission;
      call.policy = nativePolicy;
      this.#healthy();
      requireCondition(this.#active === active && !active.stopId && !active.controller.signal.aborted
        && !active.result, "Native file authority ended during admission.");
      return call.modifiedArgs ? { ...admission, modifiedArgs: call.modifiedArgs } : admission;
    }
    const tool = this.#tools.get(name);
    requireCondition(tool?.roles.includes(active.packet.binding.role), "Tool is not permitted for this role.");
    validatePolicyShape(tool.parameters, args);
    await this.#verify(); await this.#authorize(active.packet, name, args);
    await tool.validate?.(args, { task: active.packet, signal: active.controller.signal });
    this.#healthy();
    requireCondition(this.#active === active && !active.stopId && !active.controller.signal.aborted && !active.result,
      "Task authority changed during tool admission.");
    if (early === "hook") {
      active.admittedTools.set(admissionKey, (active.admittedTools.get(admissionKey) ?? 0) + 1);
    }
    return null;
  }

  async #invoke(name, args, invocation) {
    this.#requireSessionId(invocation.sessionId);
    requireCondition(!this.#descendantCalls.has(invocation.toolCallId), "Descendants cannot submit root Tandem domain effects.");
    requireCondition(invocation.toolName === name, "Tool invocation identity changed.");
    const result = await this.#admit(name, args, false), active = this.#requireActive();
    if (this.#results.has(name)) {
      requireCondition(!active.result && !active.submitting, "A result was already submitted.");
      active.submitting = true;
      try {
        await this.#store.dispatch("agent", `complete:${result.resultId}`, "complete-role-result", result);
        active.result = result; active.resultCallId = text(invocation.toolCallId); active.resultSubmitted = true;
        active.resultReady.resolve(result);
      } finally { active.submitting = false; }
      return "The result is saved and this role is complete. Do not continue or call more tools.";
    }
    if (name === humanLoopProgressTool.name) {
      await this.#store.dispatch("agent", `progress:${invocation.toolCallId}`, "report-progress", args);
      this.#notify({ kind: "task-progress", requestId: active.packet.binding.requestId, ...args,
        activity: { sessionId: this.#owner.privateSessionId, taskId: active.packet.binding.id,
          requestId: active.packet.binding.requestId, role: active.packet.binding.role } });
      return "Task progress recorded; neither the task nor the whole plan was completed by this report.";
    }
    const tool = this.#tools.get(name), callId = text(invocation.toolCallId);
    this.#consumeAdmission(active, name, args);
    if (tool.requiresPermission && !this.#sessionApprovals.has(name)) {
      const key = policyHash({ input: active.packet.binding.inputDigest, name, args });
      const grants = active.grants.get(key) ?? 0;
      requireCondition(grants > 0, "This exact command requires a genuine permission grant.");
      active.grants.set(key, grants - 1);
    }
    requireCondition(!active.tools.has(callId), "Tool call identity is already executing.");
    active.tools.add(callId);
    try {
      return await tool.execute(args, { task: active.packet, signal: active.controller.signal, toolCallId: callId,
        validatePaths: () => { this.#healthy(); requireCondition(this.#active === active && !active.controller.signal.aborted && !active.result, "Tool authority ended."); } });
    } finally { active.tools.delete(callId); }
  }

  async #permission(request, invocation) {
    // SDK _dispatchEvent starts this callback before synchronously delivering that same event to onEvent.
    await Promise.resolve();
    if (this.#descendantCalls.has(request.toolCallId)) return this.#descendantPermission(request, invocation);
    if (this.#active?.nativeCalls.has(request.toolCallId)
      || (this.#nativeFiles || this.#nativeShells) && ["read", "write", "shell"].includes(request.kind)) return this.#nativePermission(request, invocation);
    let admittedActive, approved = false;
    try {
      this.#requireSessionId(invocation.sessionId);
      requireCondition(request.kind === "custom-tool" && !request.managedApprovalRequired, "Only scoped custom-tool permissions are available.");
      const active = this.#requireActive();
      admittedActive = active;
      await this.#admit(request.toolName, request.args, "permission");
      const tool = this.#tools.get(request.toolName);
      requireCondition(tool?.requiresPermission && this.#permissionHandler, "Permission has no owned command handler.");
      requireCondition(this.#active === active && !active.stopId && !active.controller.signal.aborted, "Permission belongs to an ended task.");
      const args = structuredClone(request.args);
      const key = policyHash({ input: active.packet.binding.inputDigest, name: request.toolName, args });
      const endWait = active.budget.beginPermission();
      await this.#store.dispatch("runtime", `permission-wait:${invocation.sessionId}:${request.toolCallId ?? key}:${active.budget.snapshot().elapsedMs}`,
        "permission-state", { taskId: active.packet.binding.id, waiting: true });
      let decision;
      try {
        decision = await this.#permissionHandler({
          ...request, args,
          toolDescription: `${request.toolDescription ?? tool.description}\nRequested arguments: ${JSON.stringify(args)}`
            + `\nProject working copy: ${this.#owner.workspacePath}\nRequested cwd: ${args?.cwd ?? ". (project working copy)"}`,
        }, invocation, { signal: active.controller.signal });
      } finally {
        endWait();
        if (this.#active === active && !active.stopId && !active.result && !active.budget.waiting) {
          await this.#store.dispatch("runtime", `permission-resolved:${request.toolCallId ?? key}:${active.budget.snapshot().elapsedMs}`,
            "permission-state", { taskId: active.packet.binding.id, waiting: false });
        }
      }
      this.#healthy();
      requireCondition(this.#active === active && !active.stopId && !active.controller.signal.aborted && !active.result,
        "Permission no longer belongs to a live role.");
      await this.#authorize(active.packet, request.toolName, args);
      if (["approve-once", "approve-for-session", "approved", "approved-for-session"].includes(decision.kind)) {
        approved = true;
        active.grants.set(key, (active.grants.get(key) ?? 0) + 1);
        if (["approve-for-session", "approved-for-session"].includes(decision.kind)) this.#sessionApprovals.add(request.toolName);
      } else this.#sessionApprovals.delete(request.toolName);
      return decision;
    } catch {
      return { kind: "reject", feedback: "Permission is withdrawn or outside the exact active task and project scope." };
    } finally {
      if (!approved && admittedActive && request.toolName && request.args !== undefined) {
        this.#consumeAdmission(admittedActive, request.toolName, request.args);
      }
    }
  }

  async #nativePermission(request, invocation) {
    let active, endWait;
    try {
      this.#requireSessionId(invocation.sessionId);
      active = this.#requireActive();
      const call = active.nativeCalls.get(text(request.toolCallId));
      requireCondition(call?.admission && !active.result && !active.stopId
        && !active.controller.signal.aborted && this.#permissionHandler, "Native permission has no live owned invocation.");
      requireCondition(call.name !== reviewCollectorToolName
        || request.kind === "custom-tool" && request.toolName === reviewCollectorToolName,
      "Review collection requires its exact native tool permission.");
      await call.policy.permission?.(call.admission, request);
      await this.#authorize(active.packet, call.name, call.args);
      endWait = active.budget.beginPermission();
      await this.#store.dispatch("runtime", `native-permission-wait:${request.toolCallId}:${active.budget.snapshot().elapsedMs}`,
        "permission-state", { taskId: active.packet.binding.id, waiting: true });
      const described = call.name === reviewCollectorToolName ? {
        ...request, toolDescription: `${request.toolDescription}\nReview scopes (${call.args.scopes.length}): `
          + call.args.scopes.map(scope => scope.id).join(", ") + ". Native concurrency limit: 3; no automatic retry.",
      } : request;
      const decision = await this.#permissionHandler(described, invocation, { signal: active.controller.signal, onceOnly: true,
        nativeSessionGrantEligible: true,
        provenance: { toolName: call.name, taskId: active.packet.binding.id, requestId: active.packet.binding.requestId,
          role: active.packet.binding.role } });
      this.#healthy();
      requireCondition(this.#active === active && !active.result && !active.stopId
        && !active.controller.signal.aborted, "Native permission was withdrawn.");
      await call.policy.permission?.(call.admission, request);
      await this.#authorize(active.packet, call.name, call.args);
      call.permissionApproved = decision.kind === "approve-once";
      return ["approve-once", "reject"].includes(decision.kind) ? decision
        : { kind: "reject", feedback: "Native access requires an exact once-only decision." };
    } catch {
      return { kind: "reject", feedback: "Native permission is outside the exact active invocation." };
    } finally {
      if (endWait) {
        endWait();
        if (this.#active === active && !active.stopId && !active.result && !active.budget.waiting) {
          await this.#store.dispatch("runtime", `native-permission-resolved:${request.toolCallId}:${active.budget.snapshot().elapsedMs}`,
            "permission-state", { taskId: active.packet.binding.id, waiting: false });
        }
      }
    }
  }

  #consumeAdmission(active, name, args) {
    const key = policyHash({ name, args }), remaining = (active.admittedTools.get(key) ?? 0) - 1;
    if (remaining > 0) active.admittedTools.set(key, remaining);
    else active.admittedTools.delete(key);
  }

  #observeWorkflow(event) {
    const batch = this.#workflowBatch, data = event.data ?? {};
    if (event.type === "workflow.run_started" && data.workflowName === reviewWorkflowName) {
      requireCondition(batch && !batch.runId && batch.status === "admitted" && data.attempt === 1,
        "Native factory start has no unique admitted Review invocation.");
      batch.runId = text(data.runId); batch.status = "running";
      if (batch.active !== this.#active || batch.active.controller.signal.aborted || batch.active.result) {
        this.#retiredWorkflowRuns.add(batch.runId);
        void this.#cancelReviewWorkflow(batch.active).catch(error => this.#notify({ kind: "dispatch-diagnostic",
          summary: `Late Review factory cancellation was not confirmed: ${error.message}` }));
      }
      return true;
    }
    if (event.type === "workflow.run_settled" && batch?.runId === data.runId) {
      requireCondition(workflowSettled.has(data.status), "Native factory settlement is invalid.");
      batch.status = data.status;
      return true;
    }
    if (event.type === "tool.execution_complete" && batch?.toolCallId === data.toolCallId && !batch.runId) {
      batch.status = "error"; batch.reason = data.error?.message ?? "No native factory start was observed";
    }
    return event.type.startsWith("workflow.");
  }

  #observe(event) {
    try {
      if (this.#released) return;
      requireCondition(!event.sessionId || event.sessionId === this.#owner.privateSessionId,
        "Native event belongs to another private session.");
      // Some runtimes emit this queue invalidation hint without an event identity.
      // It is not input or settlement evidence; queue RPCs remain authoritative.
      if (event.type === "pending_messages.modified" && event.id == null) return;
      if (this.#readingRecovery) return;
      if (this.#retiredHistory.has(event.id)) return;
      if (this.#closing) return;
      if (this.#historicEvents.has(event.id)) return;
      const fingerprint = policyHash(event), seen = this.#seen.get(text(event.id));
      if (seen) { requireCondition(seen === fingerprint, "Native event identity changed."); return; }
      this.#seen.set(event.id, fingerprint);
      // This chain marks idle-event freshness only; it is not input or tool ownership evidence.
      this.#observedEvents.set(event.id, event.type === "user.message" && !event.agentId
        ? event.id : this.#observedEvents.get(event.parentId) ?? null);
      if (!event.agentId && this.#observeWorkflow(event)) return;
      if (event.type === "user.message" && !event.agentId) {
        const digest = typeof event.data?.content === "string" ? humanInputEnvelope(event.data.content).promptDigest : null;
        const retired = this.#retiredEnvelopes.get(digest);
        if (retired) {
          const user = this.#matchInput(event, retired);
          requireCondition(!retired.user || retired.user.id === user.id, "A retired native input was repeated with a new identity.");
          retired.user = user; this.#retiredInteractions.add(user.interactionId);
          return;
        }
        requireCondition(!this.#retiredMessages.has(event.data?.messageId)
          && !this.#retiredInteractions.has(event.data?.interactionId), "Retired native input identity changed its envelope.");
      }
      if (this.#retiredCalls.has(event.data?.toolCallId)) {
        if (event.agentId) this.#retiredAgents.add(event.agentId);
        return;
      }
      if (this.#retiredAgents.has(event.agentId) || this.#retiredInteractions.has(event.data?.interactionId)) return;
      if (event.agentId) {
        if (event.type === "subagent.started" && event.data?.workflowRunId
          && (!this.#active || this.#active.resultSubmitted || this.#active.stopId
            || this.#retiredWorkflowRuns.has(event.data.workflowRunId)
            || event.data.workflowRunId === this.#workflowBatch?.runId && this.#workflowBatch.active !== this.#active)) {
          this.#retiredAgents.add(event.agentId);
          return;
        }
        if (this.#active?.resultSubmitted || this.#active?.stopId) return;
        const active = this.#active, data = event.data ?? {};
        if (event.type === "subagent.started" && active?.packet.binding.role === "reviewer") {
          const batch = active.reviewBatches.find(batch => batch.runId && batch.runId === data.workflowRunId);
          requireCondition(batch && batch.status === "running" && !data.parentId && data.agentName === reviewAgentName
            && !batch.children.has(event.agentId), "Review child differs from its admitted native factory.");
          batch.children.set(text(event.agentId), { status: "running" });
        }
        const reviewScope = active?.reviewBatches.flatMap(batch => {
          const scope = batch.children.get(event.agentId);
          return scope ? [scope] : [];
        })[0];
        if (reviewScope && event.type.startsWith("subagent.")) {
          const scope = reviewScope;
          if (event.type === "subagent.completed" && !["completed", "failed", "cancelled"].includes(scope.status)) {
            scope.status = data.cancelled ? "cancelled" : "completed";
            scope.reason = data.cancelled ? "Native scope was cancelled" : null;
          }
          if (event.type === "subagent.failed" && !["completed", "failed", "cancelled"].includes(scope.status)) {
            scope.status = "failed"; scope.reason = text(data.error);
          }
        }
        if (event.type === "permission.requested" && reviewScope && data.permissionRequest?.kind === "read") {
          // Native permissions can precede tool-start delivery, but already carry exact child/call identity.
          const request = data.permissionRequest, callId = text(request.toolCallId);
          const call = this.#descendantCalls.get(callId);
          requireCondition(!call || call.agentId === event.agentId && !call.completed,
            "Native child permission reused another invocation.");
          if (!call) this.#descendantCalls.set(callId, {
            agentId: text(event.agentId), reviewTaskId: active.packet.binding.id, name: null, key: null,
            claimed: false, completed: false, policy: this.#nativeAccess, admission: null,
            nativePermission: structuredClone(request), completion: new AbortController(),
          });
        }
        // The SDK tags descendant events; they are never root role input, output or completion proof.
        if (event.type === "tool.execution_start") {
          const data = event.data ?? {}, callId = text(data.toolCallId);
          requireCondition(active?.packet.binding.role !== "reviewer" || reviewScope,
            "Review child invocation has no admitted native scope.");
          const pending = this.#descendantCalls.get(callId);
          requireCondition(!pending || pending.nativePermission && pending.name === null && !pending.completed
            && pending.agentId === event.agentId && reviewReadTools.has(data.toolName),
          "Descendant native invocation identity was reused.");
          this.#descendantCalls.set(callId, Object.assign(pending ?? {}, { agentId: text(event.agentId), name: text(data.toolName),
            reviewTaskId: reviewScope ? active.packet.binding.id : null,
            key: policyHash({ name: data.toolName, args: data.arguments }), claimed: false, completed: false,
            policy: reviewScope ? this.#nativeAccess : null,
            admission: reviewScope && reviewReadTools.has(data.toolName)
              ? { name: data.toolName, args: structuredClone(data.arguments) } : null,
            ...(pending ? { nativePermission: pending.nativePermission } : {}),
            completion: pending?.completion ?? new AbortController() }));
        } else if (event.type === "tool.execution_complete") {
          const call = this.#descendantCalls.get(event.data?.toolCallId);
          requireCondition(call && call.agentId === event.agentId && !call.completed,
            "Descendant completion differs from its SDK invocation.");
          call.completed = true; call.completion.abort();
          if (call.admission) this.#enqueue(async () => {
            await call.policy.settled?.(call.admission, event);
            call.admission = null;
          });
        }
        return;
      }
      if (this.#compaction.observe(event)) return;
      if (this.#nativeShells && event.type === "system.notification" && event.data?.kind?.type === "shell_completed"
        && !event.agentId) {
        const receipt = `notification:${event.id}`;
        this.#automaticReads.add(receipt);
        this.#enqueue(async () => {
          await this.#nativeShells.observe(event);
          this.#automaticReads.delete(receipt);
          this.#notify({ kind: "native-shell" });
        }, true);
      }
      if (["session.error", "session.shutdown"].includes(event.type)) {
        const active = this.#active;
        if (event.type === "session.error" && event.data?.errorType === "query"
          && active?.packet.binding.role === "reviewer" && active.started && !active.result && !active.stopId) {
          active.reviewError = { id: text(event.id), message: text(event.data.message) };
          // A failed Reviewer attempt is advisory, never approval.
          this.#pump(); return;
        }
        if (this.compaction.active) this.#compaction.failed(new Error("Native session interrupted; compaction outcome is unconfirmed."));
        void this.#fail("The private runtime reported interruption.", new Error(event.type)); return;
      }
      const active = this.#active, data = event.data ?? {};
      const automatic = this.#nativeShells && this.#automaticOutput.observe(event, active, this.#owner.privateSessionId);
      if (automatic) {
        if (automatic.kind === "start") {
          // Visible to idle Settings, not a role-completion prerequisite.
          this.#automaticReads.add(automatic.toolCallId);
          this.#enqueue(async () => {
            const binding = await this.#nativeShells.automaticOutputBinding(automatic.notification);
            if (binding === null) this.#notify({ kind: "native-shell",
              summary: "Native output has no unique owned command binding; no process outcome or role completion was inferred." });
          });
        } else if (automatic.kind === "complete") {
          this.#enqueue(async () => {
            this.#automaticReads.delete(automatic.toolCallId);
            this.#notify({ kind: "native-shell" });
          });
          this.#pump();
        }
        return;
      }
      if (event.type === "tool.execution_complete" && !active) return;
      if (!active?.user && !["user.message", "assistant.turn_start"].includes(event.type)) return;
      if (event.type === "assistant.message") {
        if (event.agentId || !active?.user || !active.starts.length) return;
        if (!active.resultSubmitted && !active.stopId && Array.isArray(data.toolRequests) && data.toolRequests.length
          && typeof data.interactionId === "string" && (data.turnId === undefined || typeof data.turnId === "string")) {
          requireCondition(!data.parentToolCallId
            && [active.user, active.continuation?.user].some(user => user?.interactionId === data.interactionId)
            && active.starts.some(start => (data.turnId === undefined || start.turnId === data.turnId)
              && start.interactionId === data.interactionId),
          "Native tool requests have no exact owned assistant turn.");
          for (const request of data.toolRequests) {
            if (!this.#nativePolicy(request.name)) continue;
            const id = text(request.toolCallId), binding = { name: text(request.name), turnId: data.turnId ?? null,
              interactionId: data.interactionId,
              key: request.arguments === undefined ? null : policyHash({ name: request.name, args: request.arguments }) };
            const previous = active.nativeRequests.get(id), called = active.nativeCalls.get(id);
            requireCondition(!this.#retiredCalls.has(id) && (!previous || policyHash(previous) === policyHash(binding))
              && (!called || called.name === binding.name && (binding.turnId === null || called.turnId === binding.turnId)
                && called.interactionId === binding.interactionId && (binding.key === null || called.key === binding.key)),
            "Native tool request identity changed or belongs to a retired input.");
            active.nativeRequests.set(id, binding);
          }
        }
        if (typeof data.content !== "string" || !data.content.trim()) return;
        this.#enqueue(async () => {
          await this.#store.recordMessage({ id: `native:${text(event.id)}`, role: active.packet.binding.role,
            requestId: active.packet.binding.requestId, kind: "assistant", content: data.content, timestamp: text(event.timestamp) });
          this.#notify({ kind: "assistant-message", requestId: active.packet.binding.requestId });
        });
        return;
      }
      if (active?.resultSubmitted || active?.stopId) return;
      if (event.type === "session.idle") {
        requireCondition(data.aborted !== true, "The private runtime reported an unrequested cancellation.");
        const input = active.continuation?.user ?? active.user;
        if (this.#observedEvents.get(event.id) !== input.id) return;
        active.missingResultIdle = { id: text(event.id), inputId: input.id };
        this.#pump();
        return;
      }
      if (event.type === "tool.execution_start" && !this.#nativePolicy(data.toolName)) return;
      if (!["user.message", "assistant.turn_start", "tool.execution_start", "tool.execution_complete"].includes(event.type)) return;
      requireCondition(!event.agentId, "Unowned subagent events are not private task evidence.");
      requireCondition(active, "Unowned input/execution appeared in the private session.");
      if (event.type === "tool.execution_start") {
        const input = active.continuation?.user ?? active.user;
        const callId = text(data.toolCallId), request = active.nativeRequests.get(callId);
        const interactionId = data.interactionId === undefined ? request?.interactionId : data.interactionId;
        const turnId = data.turnId === undefined ? request?.turnId : data.turnId;
        const turns = active.starts.filter(start => start.turnId === turnId
          && (interactionId === undefined || start.interactionId === interactionId));
        requireCondition(input && turns.length === 1 && turns[0].interactionId === input.interactionId
          && (interactionId !== undefined || !this.#retiredInputs)
          && (!request || request.interactionId === input.interactionId && (request.turnId === null || request.turnId === turnId)
            && request.name === data.toolName && (request.key === null || request.key === policyHash({ name: data.toolName, args: data.arguments }))),
        "Native file invocation lacks an unambiguous owned role turn.");
        requireCondition(!active.nativeCalls.has(callId), "Native file invocation identity was reused.");
        active.nativeCalls.set(callId, { name: data.toolName, args: structuredClone(data.arguments),
          key: policyHash({ name: data.toolName, args: data.arguments }), turnId,
          interactionId: input.interactionId, claimed: false, admission: null });
        active.tools.add(callId);
      } else if (event.type === "user.message") {
        const continuation = active.user ? active.continuation : null;
        const input = continuation ?? active;
        requireCondition(input.sent && !input.user, "Foreign or repeated private input has no issued Host dispatch.");
        const identity = this.#matchInput(event, input);
        requireCondition(![...this.#users.values()].some(user => user.interactionId === identity.interactionId),
          "Native input reused an existing interaction.");
        requireCondition(active.starts.filter(start => start.interactionId !== active.user?.interactionId)
          .every(start => start.interactionId === identity.interactionId
            && (!identity.turnId || start.turnId === identity.turnId)),
        "Private input conflicts with its already observed native start.");
        if (continuation) {
          continuation.user = identity;
          active.missingResultIdle = null;
        } else active.user = identity;
        this.#users.set(identity.id, identity);
      } else if (event.type === "assistant.turn_start") {
        const input = active.continuation?.user ?? active.user;
        requireCondition(!active.starts.some(start => start.turnId === data.turnId && start.interactionId === data.interactionId),
          "Native continuation reused a previous turn identity.");
        const pending = active.continuation?.sent && !active.continuation.user;
        requireCondition(typeof data.turnId === "string" && data.turnId.length > 0
          && typeof data.interactionId === "string" && data.interactionId.length > 0
          && (!input || input.interactionId === data.interactionId || pending), "Native start has no matching interaction.");
        active.starts.push({ id: text(event.id), turnId: data.turnId, interactionId: data.interactionId });
      } else if (active.nativeCalls.has(data.toolCallId)) {
        const call = active.nativeCalls.get(data.toolCallId);
        requireCondition(active.tools.has(data.toolCallId) && data.turnId === call.turnId
          && data.interactionId === call.interactionId && (call.admission || data.success === false),
        "Native file completion lacks exact admitted invocation ownership.");
        this.#enqueue(async () => {
          if (call.admission) {
            await call.policy.settled?.(call.admission, event, call.permissionApproved);
          }
          active.tools.delete(data.toolCallId);
          this.#notify({ kind: "native-shell", status: data.success === true ? "succeeded" : "failed",
            summary: `${call.name} ${data.success === true ? "invocation succeeded" : "invocation failed"}`,
            activity: { sessionId: this.#owner.privateSessionId, taskId: active.packet.binding.id,
              requestId: active.packet.binding.requestId, role: active.packet.binding.role,
              toolName: call.name, toolCallId: data.toolCallId } });
        });
      }
      this.#pump();
    } catch (error) {
      const evidence = Object.fromEntries(Object.entries({ eventId: event?.id, eventType: event?.type,
        parentId: event?.parentId, toolCallId: event?.data?.toolCallId }).filter(([, value]) => typeof value === "string")
        .map(([key, value]) => [key, value.slice(0, 160)]));
      void this.#fail("Private native event ownership is uncertain.",
        new Error(`${error.message} Observed ${JSON.stringify(evidence)}.`));
    }
  }

  #matchInput(event, expected) {
    const data = event.data ?? {}, user = nativeUserEvidence(event);
    // parentAgentTaskId is background telemetry; source and event.agentId identify input origin.
    requireCondition(!event.agentId && user.interactionId
      && (user.messageId === null) === (user.turnId === null)
      && (data.delivery === undefined || data.delivery === "idle" || data.delivery === "queued")
      && (data.agentMode === undefined || data.agentMode === "interactive")
      && (data.isAutopilotContinuation === undefined || data.isAutopilotContinuation === false)
      && (data.parentAgentTaskId == null || typeof data.parentAgentTaskId === "string") && data.source == null
      && (!expected.messageId || !user.messageId || expected.messageId === user.messageId),
    "Private input has foreign, partial or incompatible native identities.");
    requireCondition(policyHash(humanInputEnvelope(data.content, data.attachments, expected.envelope.kind))
      === policyHash(expected.envelope), "Private input content or attachments differ from the exact Host dispatch.");
    return user;
  }

  #pump() {
    const active = this.#active;
    this.#enqueue(async () => {
      if (!active || this.#active !== active || active.resultSubmitted || active.submitting || active.stopId) return;
      const binding = active.packet.binding;
      if (!active.user) return;
      for (const input of [active, active.continuation].filter(Boolean)) {
        if (!input.user || input.bound) continue;
        const start = active.starts.find(start => start.interactionId === input.user.interactionId);
        if (!start) continue;
        requireCondition((!input.user.turnId || input.user.turnId === start.turnId)
          && (!input.messageId || !input.user.messageId || input.user.messageId === input.messageId),
        "Delivered input differs from its native turn or acknowledgement.");
        await this.#store.dispatch("runtime", `input-bound:${input.user.id}`, "role-input-bound", {
          taskId: binding.id, dispatchId: binding.dispatchId, kind: input.envelope.kind,
          user: input.user, turnId: start.turnId, startEventId: start.id,
        });
        input.bound = true;
      }
      if (this.#active !== active || !active.acknowledged || !active.bound || active.resultSubmitted || active.submitting || active.stopId) return;
      const start = active.starts.find(start => start.interactionId === active.user.interactionId);
      if (!start) return;
      if (!active.started) {
        await this.#store.dispatch("runtime", `native-start:${start.id}`, "role-started",
          { taskId: binding.id, messageId: active.messageId, interactionId: start.interactionId });
        active.started = true;
      }
      if (!active.result && active.missingResultIdle && !active.reviewError) {
        const state = await this.#store.load();
        if (this.#active !== active || active.result || active.submitting || active.stopId || state.stop || this.#closing) return;
        if (!active.continuation) {
          void this.#continueMissingResult(active);
          return;
        }
        if (!active.continuation.acknowledged || !active.continuation.bound || !active.continuation.user
          || active.missingResultIdle.inputId !== active.continuation.user.id) return;
      }
      const failure = active.reviewError ?? (active.missingResultIdle && active.continuation?.acknowledged
        && active.continuation.user?.id === active.missingResultIdle.inputId
        ? { id: active.missingResultIdle.id, message: "The role did not submit its required result after one same-role continuation." } : null);
      if (!active.result && !active.submitting && failure) {
        const state = await this.#store.dispatch("host", `native-failure:${binding.id}`, "execution-failed", {
          taskId: binding.id, completion: "reported-failure",
          reason: failure.message, evidenceRef: failure.id,
        });
        active.result = state.activeTask.result; active.resultSubmitted = true;
        active.resultReady.resolve(active.result);
      }
    }, false, active);
  }

  async #quiescent() {
    this.#healthy(); await this.#verify();
    const [mode, processing, activity, queue] = await Promise.all([
      this.#session.rpc.mode.get(), this.#session.rpc.metadata.isProcessing(), this.#session.rpc.metadata.activity(),
      this.#session.rpc.queue.pendingItems(),
    ]);
    requireCondition(mode === "interactive" && typeof processing?.processing === "boolean" && typeof activity?.hasActiveWork === "boolean",
      "Runtime mode/activity proof is unavailable.");
    requireCondition(Array.isArray(queue.steeringMessages), "Runtime queue status is unavailable.");
    return !this.#automaticReads.size && !processing.processing && !activity.hasActiveWork
      && parseOwnedQueue(queue).length === 0 && queue.steeringMessages.length === 0;
  }
  #enqueue(action, retainNativeSettlement = false, inputOwner = null) {
    this.#tail = this.#tail.then(async () => {
      if (!this.#failure || retainNativeSettlement) await action();
    }).catch((error) => {
      if (inputOwner && (inputOwner.resultSubmitted || inputOwner.stopId || this.#active !== inputOwner)) {
        this.#notify({ kind: "dispatch-diagnostic", summary: error.message });
      } else return this.#fail("Private event persistence/settlement failed.", error);
    });
  }
  async #fail(prefix, error) {
    if (this.#failure) return this.#failureWrite;
    this.#failure = new Error(`${prefix} ${safeReason(error, this.#owner.policy.values.resources.reviewReasonCharacters)}`);
    this.#active?.resultReady.reject(this.#failure);
    this.#failureWrite = (async () => {
      try {
        await this.#store.dispatch("host", `execution-unknown:${this.#active?.packet.binding.id ?? "session"}`, "execution-unknown",
          { reason: this.#failure.message, evidenceRef: `private-session:${this.#owner.privateSessionId}` });
      } catch (recordingError) {
        this.#failure = new Error(`${this.#failure.message} Durable uncertainty recording also failed: `
          + `${safeReason(recordingError, this.#owner.policy.values.resources.reviewReasonCharacters)} Ownership remains held.`);
        process.emitWarning(this.#failure.message, { code: "HUMAN_LOOP_UNCERTAINTY_RECORDING" });
      }
    })();
    this.#active?.controller.abort();
    await this.#failureWrite;
  }
  #healthy() { if (this.#failure) throw this.#failure; }
  #notify(event) {
    try { Promise.resolve(this.#onProgress?.(event)).catch(() => process.emitWarning("Human-loop progress could not be projected.", { code: "HUMAN_LOOP_PROGRESS" })); }
    catch { process.emitWarning("Human-loop progress could not be projected.", { code: "HUMAN_LOOP_PROGRESS" }); }
  }
  #requireActive() { this.#healthy(); requireCondition(this.#active, "No private role is active."); return this.#active; }
  #requireSessionId(id) {
    requireCondition(id === this.#owner.privateSessionId, "Callback belongs to another private session; execution was not admitted.");
    this.#healthy(); requireCondition(!this.#closing, "Callback belongs to a closing session.");
  }
}
