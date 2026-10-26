import { randomUUID } from "node:crypto";
import { HumanLoopPreferences, validateProjectReasoningEffort } from "./human-loop-preferences.mjs";
import { humanLoopPrompts } from "../public/prompts/human-loop.js";
import { parseRequest, advisoryContinuationIssue } from "../runtime-src/domain/human-loop/contracts.ts";
import { bindSelectedOptions } from "./human-loop-answers.mjs";
import { decisionReportText } from "../public/review-decisions.js";
import { nextHumanRequest, isStaleAnswer, humanExecutionQueue, hasQuestionBlockers, isPriorityAnswer, requireHumanRequestRunning, allowsHumanRoleSettlement,
  currentImplementationConfirmation, requestsImplementationAfterDesign, questionBlocksNewWork } from "../runtime-src/domain/human-loop/model.ts";
import { policyHash } from "../runtime-src/domain/workflow/policy.ts";
import { requireCondition } from "../runtime-src/domain/workflow/validation.ts";
import { HumanLoopStore } from "./human-loop-store.mjs";
import { HumanLoopWorkspace } from "./human-loop-workspace.mjs";
import { HumanLoopTransport } from "./human-loop-transport.mjs";
import { createHumanTask } from "./human-loop-task.mjs";
import { WorkflowCommandRunner } from "./workflow-command-runner.mjs";
import { HumanLoopNativeShells } from "./human-loop-native-shells.mjs";
import { HumanLoopDesigner } from "./human-loop-design.mjs";
import { HumanLoopReview } from "./human-loop-review.mjs";
import { parseHumanCleanClose } from "./human-loop-close.mjs";
import { HumanLoopDesignStore, sharedDesignBinding } from "./human-loop-design-store.mjs";
import { readRequestAttachment } from "../runtime-src/domain/workflow/image-attachment.ts";
import { designReferenceCatalog, designGenerationContract, validateDesignReferences, validateArtifactAnnotationSource } from "../public/sketch/design-contract.js";

const roles = ["router", "designer", "planner", "implementer", "reviewer", "agent"];
const same = (a, b) => policyHash(a) === policyHash(b);
const objectSchema = (properties, required = Object.keys(properties)) => ({ type: "object", properties, required, additionalProperties: false });
const string = { type: "string", minLength: 1 };

export async function readHumanDesign(root) {
  const current = await new HumanLoopDesignStore(root).inspectCurrent();
  return { binding: sharedDesignBinding(current), content: current?.input ?? null,
    publication: current ? { requestId: current.requestId, previous: current.previous } : null,
    references: current ? designReferenceCatalog(current.input) : [] };
}

/** One outer queue; internal tasks never release it. Roles share one private conversation and one project workspace. */
export class HumanLoopRuntime {
  #configuration;
  #owner;
  #store;
  #workspace;
  #transport;
  #commands;
  #readDesign;
  #designer;
  #reviewEffects;
  #verify;
  #verifyAdmission;
  #onHandoff;
  #onProgress;
  #opened = false;
  #closed = false;
  #pump = null;
  #stopWork = null;
  #state = null;
  #presentationError = null;
  #availabilityError = null;
  #toolTail = Promise.resolve();
  #fences = new Map();
  #lastRole = null;
  #queueFailure = null;
  #review;
  #hostEffect = null;
  #settlingTaskId = null;
  #presentationWork = null;
  #closedCache = null;
  #closing = false;
  #admission = Promise.resolve();
  #confirmationWork = null;
  #preferences;
  #projectEffortControl;
  #modelChanging = false;
  #modelError = null;
  #repairModelReadback = false;
  #compactionBusy = false;
  #compactionApproval = null;
  #contextProvider;
  #withRequestAdmission;

  constructor({ configuration, client, workflowBootstrap, verifyOwnership, verifyAdmission, permissionHandler, onHandoff, onProgress,
    readDesign, designer, reviewEffects, now, contextProvider, withRequestAdmission = operation => operation(), createPrivateSession,
    beforeNativeCreate, afterNativeCreate, projectEffortControl = false }) {
    requireCondition(configuration?.schemaVersion === "human-loop-runtime/v1" && typeof onHandoff === "function",
      "The new runtime needs versioned one-copy configuration and a real handoff presenter.");
    this.#configuration = configuration; this.#owner = configuration.owner;
    this.#preferences = new HumanLoopPreferences(this.#owner.workspacePath);
    this.#projectEffortControl = projectEffortControl;
    this.#verify = verifyOwnership; this.#verifyAdmission = verifyAdmission ?? verifyOwnership;
    this.#onHandoff = onHandoff; this.#onProgress = onProgress;
    this.#contextProvider = contextProvider;
    this.#withRequestAdmission = withRequestAdmission;
    this.#store = new HumanLoopStore(this.#owner);
    this.#workspace = new HumanLoopWorkspace({ owner: this.#owner, verifyOwnership });
    this.#designer = designer ?? new HumanLoopDesigner({ owner: this.#owner, store: this.#store, verifyOwnership });
    this.#readDesign = readDesign ?? (() => this.#designer.read());
    const legacyCommands = new WorkflowCommandRunner({ owner: this.#owner, runtimeDirectory: configuration.runtimeDirectory,
      nodeExecutable: configuration.node.path, repositoryRoot: this.#owner.workspacePath });
    this.#commands = new HumanLoopNativeShells({ owner: this.#owner, workspace: this.#workspace,
      legacy: legacyCommands, runtimeDirectory: configuration.runtimeDirectory });
    this.#review = new HumanLoopReview({ owner: this.#owner, store: this.#store, workspace: this.#workspace,
      commands: this.#commands, verifyOwnership, readDesign: () => this.#readDesign() });
    this.#reviewEffects = reviewEffects ?? ((input) => this.#review.apply(input));
    const tools = [...this.#fileTools(), ...(this.#designer.tools?.() ?? [])].map((tool) => ({
      ...tool, execute: (args, context) => this.#executeTool(tool, args, context),
    }));
    this.#transport = new HumanLoopTransport({
      owner: this.#owner, client, workflowBootstrap, workspace: this.#workspace, store: this.#store, tools, nativeFiles: true, nativeShells: this.#commands,
      createPrivateSession, beforeNativeCreate, afterNativeCreate,
      verifyOwnership, authorizeTool: (packet) => this.#authorizeTool(packet), permissionHandler, now,
      onProgress: (event) => { this.#notify(event); if (event.kind === "native-shell") this.#kick(); },
      validateResult: async (packet, result) => {
        const conflict = this.#fences.get(packet.binding.id)?.conflict;
        requireCondition(!conflict, conflict ?? "Tool conflict prevents completion.");
        if (result.outcome.kind === "review-result") requireCondition(result.outcome.reviewFormat === "decision-review/v2",
          "New Whole Reviews must use decision-review/v2; historical formats are read-only.");
        if (packet.binding.role === "designer") await this.#designer.validateOutcome(packet, result);
        else {
          const producing = packet.context.design, current = await this.#readDesign();
          requireCondition(same(producing.binding, packet.binding.design) && same(current.binding, packet.binding.design)
            && (producing.content === null ? producing.binding.digest === null : policyHash(producing.content) === producing.binding.digest),
          "Result references require the exact producing Design revision and content.");
          const outcome = result.outcome;
          const groups = [
            ...(outcome.kind === "internal-plan" ? outcome.plan.tasks : []),
            ...("questions" in outcome ? outcome.questions : []),
            ...("findings" in outcome ? outcome.findings : []),
            ...("assessments" in outcome ? outcome.assessments : []),
            outcome,
          ];
          for (const group of groups) validateDesignReferences(producing.content, group.designRefs ?? []);
          if (outcome.kind === "review-result" && producing.content !== null) requireCondition(
            outcome.findings.filter(({ questionId }) => questionId !== undefined).every(({ designRefs }) => designRefs?.length > 0),
            "Each decision must identify the relevant exact Design anchors, including the scope of an omission.");
          if (outcome.kind === "internal-plan" && producing.content !== null) requireCondition(
            outcome.plan.tasks.every((task) => task.designRefs?.length > 0),
            "Each internal task must reference the relevant current artifact or element.");
        }
        if (result.outcome.kind === "route" && ["resume-cycle", "replan-cycle"].includes(result.outcome.intent)) {
          const cycle = (await this.#store.load()).cycles.find(({ id }) => id === result.outcome.cycleId);
          requireCondition(cycle, "The unfinished cycle is unavailable.");
        }
      },
      validateAttachment: async (ref, binding) => {
        const design = await this.#readDesign();
        requireCondition(same(design.binding, binding), "Annotation admission requires the exact current Design binding.");
        validateArtifactAnnotationSource(ref.source, binding, design.content);
      },
    });
    this.#store.subscribe((state) => { this.#state = state; this.#notify({ kind: "state", revision: state.revision }); });
  }

  get sessionId() { return this.#transport.sessionId; }
  get store() { return this.#store; }
  get transport() { return this.#transport; }
  get workspace() { return this.#workspace; }
  get commands() { return this.#commands; }
  async open() {
    if (this.#opened) return;
    const design = await this.#readDesign();
    this.#state = await this.#store.initialize(design.binding);
    requireCondition(this.#state.executions.length === 0 && this.#state.activeRequestId === null && !this.#state.stop && !this.#state.uncertainty,
      "Fresh runtime cannot adopt previously executed or unfinished work.");
    await this.#workspace.initialize(); await this.#transport.create();
    await this.#commands.prepareWriter(); this.#opened = true;
    await this.#checkModel();
  }
  async validateReopen(value) {
    const proof = parseHumanCleanClose(value);
    requireCondition(proof.ownerDigest === policyHash(this.#owner)
      && proof.native.sessionId === this.#owner.privateSessionId, "Close receipt belongs to another owner.");
    return this.validateRecovery();
  }
  async validateRecovery() {
    requireCondition(!this.#opened && !this.#closed && !this.#closing, "An active runtime cannot be replaced by recovery.");
    const [state] = await Promise.all([this.#store.load(), this.#store.messages()]);
    await this.#readDesign();
    await this.#workspace.initialize();
    await this.#verify();
    return state;
  }
  async validateInitialCreation() {
    requireCondition(!this.#opened && !this.#closed && !this.#closing, "A live runtime cannot become a new initial setup.");
    await this.#verify();
    const initial = await this.#store.inspectInitialCreation();
    const design = await this.#readDesign();
    requireCondition(design.binding.revisionId === null && design.binding.digest === null && design.content === null,
      "Initial setup recovery cannot replace an existing canonical Design.");
    if (!initial.initialized) await this.#store.initialize(design.binding);
  }
  async validateEmptyCreatedSetup(closeIds) {
    requireCondition(!this.#opened && !this.#closed && !this.#closing, "An active runtime cannot be reinitialized.");
    await this.#verify();
    await this.#store.inspectEmptyCreatedSetup(closeIds);
    const design = await this.#readDesign();
    requireCondition(design.binding.revisionId === null && design.binding.digest === null && design.content === null,
      "Empty-setup repair cannot replace a canonical Design.");
  }
  async recover(recoveryId, cleanNativeProof = null, allowMissingInitialSession = false, repairId = null) {
    this.#repairModelReadback = Boolean(repairId);
    const state = await this.validateRecovery();
    let diagnostic = 0;
    const diagnose = async (source, reason) => {
      const timestamp = new Date().toISOString();
      await this.#store.recordMessage({ id: `recovery-diagnostic:${recoveryId}:${++diagnostic}`,
        requestId: null, role: "host", kind: "status", timestamp,
        content: JSON.stringify({ kind: "recovery-diagnostic", recoveryId, source, timestamp,
          sessionId: this.#owner.privateSessionId,
          reason: String(reason).replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, this.#owner.policy.values.resources.reviewReasonCharacters) }) });
    };
    const messages = await this.#store.messages();
    for (const handoff of state.handoffs) if (handoff.presented
      && !messages.some(({ id }) => id === `handoff:${handoff.result.resultId}`)) {
      await diagnose("historical-handoff", "A historical result is absent from Conversation; saved records were preserved without fabricating a message.");
    }
    for (const request of state.requests) for (const attachment of request.attachments ?? []) {
      try { await readRequestAttachment(this.#owner.workspacePath, attachment); }
      catch { await diagnose("historical-attachment", "A historical attachment is unavailable or inconsistent; its saved reference was retained, not replayed."); }
    }
    const evidence = await this.#transport.recover(state, cleanNativeProof, diagnose, allowMissingInitialSession);
    await this.#commands.prepareWriter({ id: recoveryId, nativeEvidenceDigest: evidence.digest }, evidence.nativeControl);
    const design = await this.#readDesign();
    await this.#checkModel();
    this.#state = await this.#store.dispatch("host", `recovery:${recoveryId}`, "recover", {
      recoveryId, recoveredAt: new Date().toISOString(), evidenceRef: evidence.digest, nativeUsers: evidence.users, design: design.binding,
    });
    this.#opened = true;
    if (repairId) await this.#store.recordMessage({ id: `empty-setup-reinitialized:${repairId}`,
      requestId: null, role: "host", kind: "status", timestamp: new Date().toISOString(),
      content: "Empty Development setup reinitialized with the same reserved session ID. No native history was restored and no project request was submitted. Continue Design separately when ready." });
    this.#notify({ kind: "recovery", summary: repairId
      ? "Development setup repaired with the same reserved ID. The retained handoff has not been submitted."
      : currentImplementationConfirmation(this.#state)?.status === "pending"
      ? "Pending implementation confirmation retained. No planning or code changes will start without your decision; other interrupted work is retired."
      : "Ready for new instructions. Conversation and Design retained; previous work is retired, not resumed or certified." });
  }
  async reopen(value) {
    const proof = parseHumanCleanClose(value);
    await this.validateReopen(proof);
    await this.recover(`reopen:${proof.id}`, proof.native);
  }
  async releaseFailedStartup() {
    requireCondition(!this.#pump && !this.#stopWork && !this.#hostEffect && !this.#modelChanging && !this.#compactionBusy,
      "The current runtime has active operations; failed-start retry cannot release it.");
    const released = await this.#transport.releaseFailedStartup();
    this.#commands.releaseWriter();
    this.#opened = false;
    this.#closed = true;
    return released;
  }
  async #checkModel(verifyAvailability = true) {
    try {
      const preferences = await this.#preferences.read();
      requireCondition(!preferences.pendingModel, "A model change is unconfirmed. Retry the selection or explicitly accept the actual model in Settings.");
      if (this.#repairModelReadback) {
        const selection = await this.#transport.currentModelSelection();
        requireCondition(selection.model, "Repair needs a verified private model. Select it in Settings before continuing.");
      }
      if (this.#projectEffortControl && preferences.projectReasoningEffort !== null) {
        const actual = await this.#transport.currentModelSelection();
        if (verifyAvailability) {
          const selected = (await this.#transport.listModels()).find(item => item.id === actual.model);
          requireCondition(selected?.supportedReasoningEfforts.includes(preferences.projectReasoningEffort),
            "The selected private model does not support the saved project reasoning effort.");
        }
        requireCondition(actual.model && actual.reasoningEffort === preferences.projectReasoningEffort,
          "The project reasoning effort is pending or differs from the private session. Select a compatible private model or apply the project effort again.");
      }
      if (preferences.model) {
        if (verifyAvailability) {
          const selected = (await this.#transport.listModels()).find(({ id }) => id === preferences.model);
          requireCondition(selected, "Saved model is unavailable in the authenticated model list.");
          requireCondition(preferences.reasoningEffort === null || selected.supportedReasoningEfforts.includes(preferences.reasoningEffort),
            "Saved reasoning effort is unavailable for the selected model.");
        }
        const actual = await this.#transport.currentModelSelection();
        requireCondition(actual.model === preferences.model,
          "The actual private-session model differs from the saved preference. Reconcile it in Settings; the session was not replaced.");
        requireCondition(preferences.reasoningEffort === null || actual.reasoningEffort === preferences.reasoningEffort,
          "The actual private-session reasoning effort differs from the saved preference. Reconcile it in Settings; the session was not replaced.");
      }
      this.#modelError = null;
    } catch (error) { this.#modelError = error.message; }
    return this.#modelError;
  }
  #idleSettings(state) {
    return this.#opened && !this.#closed && !this.#closing && !this.#pump && !this.#stopWork
      && !this.#hostEffect && !this.#settlingTaskId && !this.#presentationWork && !this.#queueFailure
      && !this.#presentationError && !this.#availabilityError && !state.activeRequestId && !state.activeTask
      && !state.stop && !state.uncertainty && !nextHumanRequest(state)
      && !humanExecutionQueue(state).some(request => request.answers);
  }
  async #modelQuiet(operation = "Model changes") {
    requireCondition(this.#idleSettings(await this.#store.load()),
      `${operation} require an idle private runtime with no active request, task, work ready to run, pending answer, Stop, closing or unsettled effect.`);
    await this.#transport.inspectIdle();
    requireCondition(!this.#closing && !this.#stopWork, "Runtime began closing or stopping during model verification.");
  }
  async resetRememberedApprovals(resetBroker) {
    requireCondition(typeof resetBroker === "function" && !this.#pump && !this.#modelChanging && !this.#compactionBusy
      && !this.#state?.activeRequestId && !this.#state?.activeTask && !this.#state?.stop,
    "Reset remembered approvals requires an idle private runtime. Wait for current work to finish; this action does not stop commands.");
    const work = this.#admission.then(async () => {
      await this.#modelQuiet("Reset remembered approvals");
      await this.#transport.resetRememberedApprovals();
      resetBroker(this.sessionId);
    });
    this.#admission = work.then(() => undefined, () => undefined);
    await work;
    this.#notify({ kind: "permissions-reset" });
  }
  async modelSettings() {
    const preferences = await this.#preferences.read();
    if (!this.#opened || this.#closed || this.#closing) return { models: [], actual: null, desired: preferences.model,
      pending: preferences.pendingModel, actualReasoningEffort: null, desiredReasoningEffort: preferences.reasoningEffort,
      pendingReasoningEffort: preferences.pendingReasoningEffort, canSetReasoningEffort: false,
      error: this.#modelError, reason: "Private runtime is not open and Ready.", canChange: false, capabilities: null,
      effortManaged: this.#projectEffortControl, projectReasoningEffort: preferences.projectReasoningEffort };
    let models = [], actual = null, actualReasoningEffort = null, reason = null, capability = null, canChange = false;
    try {
      const selection = await this.#transport.currentModelSelection();
      actual = selection.model; actualReasoningEffort = selection.reasoningEffort;
    }
    catch (error) { reason = error.message; }
    try {
      models = await this.#transport.listModels();
      requireCondition(this.#transport.canSwitchModel, "Installed SDK cannot switch the private-session model.");
      requireCondition(!this.#compactionBusy && !this.#transport.compaction.active, "Wait for context compaction before changing models.");
      await this.#modelQuiet();
      requireCondition(!this.#modelChanging, "A model setting is being verified.");
      if (actual) capability = await this.#transport.attachmentCapabilities();
      canChange = true;
    } catch (error) { reason = [reason, error.message].filter(Boolean).join(" "); }
    if (!actual && canChange) reason += " Select a listed model in Settings; authoritative readback is required before image delivery.";
    const error = this.#modelError ?? (this.#projectEffortControl && preferences.projectReasoningEffort !== null && !actual
      ? reason : preferences.pendingModel ? "Unconfirmed model intent requires explicit reconciliation."
      : preferences.model && actual && (preferences.model !== actual
        || preferences.reasoningEffort !== null && preferences.reasoningEffort !== actualReasoningEffort)
        ? "Actual and saved model or reasoning effort differ. Reconcile before sending." : null);
    return { models, actual, desired: preferences.model, pending: preferences.pendingModel, error, reason,
      actualReasoningEffort, desiredReasoningEffort: preferences.reasoningEffort, pendingReasoningEffort: preferences.pendingReasoningEffort,
      canSetReasoningEffort: this.#transport.canSetReasoningEffort,
      effortManaged: this.#projectEffortControl, projectReasoningEffort: preferences.projectReasoningEffort,
      canChange, capabilities: capability };
  }
  async validateProjectEffort(effort) {
    validateProjectReasoningEffort(effort);
    const preferences = await this.#preferences.read();
    requireCondition(!preferences.pendingModel, "Reconcile the pending private model before changing project effort.");
    const settings = await this.modelSettings();
    requireCondition(settings.canChange, settings.reason ?? "Private native work is busy.");
    if (settings.actual) requireCondition(settings.models.find(item => item.id === settings.actual)?.supportedReasoningEfforts.includes(effort),
      "The private model does not advertise this reasoning effort.");
  }
  async applyProjectEffort() {
    const preferences = await this.#preferences.read();
    if (!this.#projectEffortControl || preferences.projectReasoningEffort === null) return;
    if (preferences.pendingModel) { await this.#checkModel(false); return; }
    let current;
    try { current = await this.#transport.currentModelSelection(); }
    catch (error) {
      this.#modelError = `Saved project effort is pending a verified private model. ${error.message}`;
      return;
    }
    if (preferences.model && current.model !== preferences.model) {
      this.#modelError = "Actual private model differs from the saved selection. Reconcile it in Settings before applying project effort.";
      return;
    }
    if (current.reasoningEffort === preferences.projectReasoningEffort) return this.#checkModel();
    return this.changeModel({ model: current.model, reasoningEffort: preferences.projectReasoningEffort, projectEffort: true });
  }
  async selectProjectEffort(effort) {
    await this.validateProjectEffort(effort);
    return this.changeModel({ model: null, reasoningEffort: effort, projectEffort: true });
  }
  async changeModel({ model, reasoningEffort = null, acceptActual = false, projectEffort = false }) {
    requireCondition(!this.#compactionBusy && !this.#transport.compaction.active, "Wait for context compaction before changing models.");
    requireCondition(!this.#modelChanging && !this.#closing && !this.#stopWork, "Another model change, close or Stop is in progress.");
    requireCondition(!this.#pump && !this.#state?.activeRequestId && !this.#state?.activeTask && !this.#state?.stop,
      "Model changes require Ready now; they are not queued behind active work.");
    this.#modelChanging = true;
    const work = this.#admission.then(async () => {
      let attempted = false, intent = false, previousPending = null, previousPendingEffort = null;
      try {
        await this.#modelQuiet();
        const models = await this.#transport.listModels();
        requireCondition(this.#transport.canSwitchModel, "Installed SDK cannot switch and verify the private model.");
        const previous = await this.#preferences.read();
        requireCondition(projectEffort || !this.#projectEffortControl || previous.projectReasoningEffort === null
          || reasoningEffort === null || reasoningEffort === previous.projectReasoningEffort,
        "Change reasoning effort through the single project control.");
        if (projectEffort) {
          requireCondition(this.#projectEffortControl && !previous.pendingModel, "Project effort cannot replace an unconfirmed private model.");
          validateProjectReasoningEffort(reasoningEffort);
        }
        let selection;
        if (projectEffort) {
          try { selection = await this.#transport.currentModelSelection(); }
          catch (error) {
            await this.#preferences.update({ projectReasoningEffort: reasoningEffort });
            this.#modelError = `Project effort is saved but private model readback is unavailable. Select a compatible model in Settings. ${error.message}`;
            return;
          }
        } else selection = acceptActual ? await this.#transport.currentModelSelection() : { model, reasoningEffort };
        const target = selection.model;
        const effort = projectEffort ? reasoningEffort : this.#projectEffortControl && previous.projectReasoningEffort !== null
          ? previous.projectReasoningEffort : selection.reasoningEffort;
        requireCondition(!acceptActual || !this.#projectEffortControl || previous.projectReasoningEffort === null
          || selection.reasoningEffort === previous.projectReasoningEffort,
        "Actual private effort differs from the project choice; use the project effort control.");
        const selected = models.find(({ id }) => id === target);
        requireCondition(selected, "Selected model is not in the authenticated SDK model list.");
        requireCondition(effort === null || selected.supportedReasoningEfforts.includes(effort),
          "Selected reasoning effort is not advertised for this model.");
        requireCondition(acceptActual || effort === null || this.#transport.canSetReasoningEffort,
          "Installed SDK cannot set reasoning effort.");
        if (projectEffort) await this.#preferences.update({ projectReasoningEffort: effort });
        previousPending = previous.pendingModel; previousPendingEffort = previous.pendingReasoningEffort;
        await this.#preferences.update({ pendingModel: target, pendingReasoningEffort: effort }); intent = true;
        await this.#modelQuiet();
        if (!acceptActual) { attempted = true; await this.#transport.setModel(target, effort); }
        const actual = await this.#transport.currentModelSelection();
        requireCondition(actual.model === target && (effort === null || actual.reasoningEffort === effort),
          "SDK model or reasoning effort readback did not match the selection; reconcile the actual model explicitly.");
        await this.#modelQuiet();
        await this.#preferences.update({ model: actual.model, reasoningEffort: effort, pendingModel: null, pendingReasoningEffort: null });
        this.#modelError = null;
      } catch (error) {
        this.#modelError = error.message;
        if (intent && !attempted && !acceptActual) {
          try { await this.#preferences.update({ pendingModel: previousPending, pendingReasoningEffort: previousPendingEffort }); }
          catch (failure) { this.#modelError += ` Pending intent could not be cleared: ${failure.message}`; }
        }
        throw new Error(this.#modelError);
      }
    });
    this.#admission = work.then(() => undefined, () => undefined);
    try { await work; }
    finally { this.#modelChanging = false; this.#notify({ kind: "settings" }); }
    return this.modelSettings();
  }
  async isBusy() {
    const state = this.#state ?? await this.#store.load();
    return Boolean(state.activeRequestId || state.activeTask || state.stop || this.#pump || this.#stopWork || this.#closing || this.#modelChanging
      || this.#compactionBusy || this.#transport.compaction.active);
  }
  async requestCompaction() {
    requireCondition(this.#transport.canCompact, "Installed SDK does not support explicit model-context compaction.");
    requireCondition(!this.#compactionBusy && !this.#transport.compaction.active && !this.#modelChanging,
      "Wait for the current model operation before requesting compaction.");
    await this.#admission;
    await this.#modelQuiet("Context compaction");
    this.#compactionApproval = { requestId: randomUUID(), revision: (await this.#store.load()).revision };
    return { requestId: this.#compactionApproval.requestId };
  }
  async decideCompaction({ requestId, approve }) {
    requireCondition(typeof approve === "boolean" && this.#compactionApproval?.requestId === requestId,
      "A fresh explicit compaction decision is required; no request was sent.");
    const approval = this.#compactionApproval;
    this.#compactionApproval = null;
    if (!approve) return { compacted: false };
    requireCondition(!this.#compactionBusy && !this.#modelChanging, "A model operation is already in progress.");
    this.#compactionBusy = true;
    this.#notify({ kind: "compaction-requested", summary: "Approved context compaction requested." });
    try {
      await this.#admission;
      requireCondition((await this.#store.load()).revision === approval.revision,
        "Work changed since the compaction request. Review a fresh approval; nothing was compacted.");
      await this.#modelQuiet("Context compaction");
      await this.#transport.compact();
      return { compacted: true };
    } finally {
      this.#compactionBusy = false;
      this.#notify({ kind: "state" });
    }
  }
  async state() { return this.#closedCache?.state ?? this.#store.load(); }
  async conversation() { return this.#closedCache?.messages ?? this.#store.messages(); }
  async currentDesign() { return this.#closedCache?.design ?? this.#readDesign(); }
  async readiness() {
    const state = this.#state ?? await this.#store.load();
    const confirmation = currentImplementationConfirmation(state);
    const awaitingAnswer = hasQuestionBlockers(state);
    const openPrerequisite = state.questions.some(q => questionBlocksNewWork(state, q));
    return {
      schemaVersion: "human-loop-runtime-view/v1",
      status: this.#closed ? "closed" : state.uncertainty || this.#queueFailure ? "execution-unknown"
        : this.#modelError ? "waiting-runtime"
        : state.stop ? "stopping" : this.#presentationError ? "presentation-pending"
          : this.#availabilityError ? "waiting-runtime" : state.activeTask?.condition === "waiting-permission"
            ? "waiting-permission" : confirmation?.status === "pending" ? "waiting-confirmation"
              : state.activeRequestId ? "working" : awaitingAnswer ? "waiting-answer" : "ready",
      modelBlocked: Boolean(this.#modelError || this.#modelChanging),
      reason: this.#modelError ?? state.uncertainty?.reason ?? this.#queueFailure ?? this.#presentationError ?? this.#availabilityError
        ?? (state.stop?.mode === "after-step"
          ? "Stop requested. Further steps are blocked. Current work may still be running or waiting for permission; waiting for its verified settlement. Saved results and partial work are retained."
          : confirmation?.status === "pending" ? "Awaiting your implementation decision. Planner has not started; queued requests remain preserved."
          : awaitingAnswer && (!state.activeRequestId || openPrerequisite)
            ? "An effective prerequisite or its saved answer is still pending. Other queued messages remain preserved." : null),
      stop: state.stop ? { id: state.stop.id, mode: state.stop.mode ?? "immediate", taskId: state.stop.taskId } : null,
      activeRequestId: state.activeRequestId, activeTaskId: state.activeTask?.binding.id ?? null,
      canResetApprovals: this.#idleSettings(state) && this.#transport.canResetApprovals
        && !this.#modelChanging && !this.#compactionBusy && !this.#transport.compaction.active,
      compaction: { ...this.#transport.compaction, requested: this.#compactionBusy,
        canRequest: this.#transport.canCompact && this.#idleSettings(state) && !this.#modelChanging
          && !this.#compactionBusy && !this.#transport.compaction.active },
      workspacePath: this.#owner.workspacePath,
    };
  }
  async send(value) {
    requireCondition(!this.#compactionBusy, "Approved context compaction is in progress; wait before sending.");
    requireCondition(!this.#modelChanging, "A private model change is being verified; retry after Settings settles.");
    requireCondition(this.#opened && !this.#closed && !this.#closing, "The owned runtime is not available for requests.");
    return this.#withRequestAdmission(async () => {
    const work = this.#admission.then(async () => {
      requireCondition(!await this.#checkModel(false), this.#modelError ?? "Model reconciliation is required.");
      const state = await this.#store.load();
      const request = bindSelectedOptions(parseRequest(value), state);
      requireCondition(state.stop?.mode !== "after-step" || state.requests.some(({ id }) => id === request.id),
        "Stop after current step is still settling; wait before sending a new request.");
      if (!state.requests.some(({ id }) => id === request.id)) await this.#transport.requestAttachments([request], state.design);
      requireCondition(!this.#closed && !this.#closing && !this.#compactionBusy, "Runtime is closing or compacting; this new request was not admitted.");
      await this.#store.dispatch("user", `receive:${request.id}`, "receive-request", request);
      this.#kick(); return request;
    });
    this.#admission = work.then(() => undefined, () => undefined);
    return work;
    });
  }
  async executionQueue() { return humanExecutionQueue(await this.#store.load()); }
  async decideImplementation({ confirmationId, decision }) {
    requireCondition(["approved", "design", "cancelled"].includes(decision), "Unknown implementation confirmation decision.");
    return this.#withRequestAdmission(async () => {
    const work = this.#admission.then(async () => {
      requireCondition(this.#opened && !this.#closed && !this.#closing && !this.#compactionBusy,
        "The owned runtime is unavailable for confirmation.");
      const state = await this.#store.load();
      const confirmation = state.implementationConfirmations?.find(c => c.id === confirmationId);
      requireCondition(confirmation, "Unknown implementation confirmation.");
      if (confirmation.status !== "pending") {
        requireCondition(confirmation.status === decision && confirmation.decidedAt,
          "This confirmation is already decided or invalidated; refresh before making another decision.");
        return { confirmationId, decision };
      }
      if (decision !== "cancelled") {
        const design = await this.#readDesign();
        requireCondition(same(design.binding, confirmation.design), "The Design changed outside this pending request. Reopen the runtime to reconcile it and confirm the current revision.");
        requireCondition(!await this.#checkModel(false), this.#modelError ?? "Model reconciliation is required.");
      }
      requireCondition(!this.#closing && !this.#closed, "Runtime is closing; confirmation was not accepted.");
      await this.#store.dispatch("user", `implementation-decision:${confirmationId}`, "decide-implementation-confirmation", {
        confirmationId, decision, decidedAt: new Date().toISOString(),
      });
      this.#notify({ kind: "implementation-decision", requestId: confirmation.requestId, status: decision });
      this.#kick();
      return { confirmationId, decision };
    });
    this.#admission = work.then(() => undefined, () => undefined);
    const completion = work.finally(() => { if (this.#confirmationWork === completion) this.#confirmationWork = null; });
    this.#confirmationWork = completion;
    return completion;
    });
  }
  wake() { this.#availabilityError = null; this.#kick(); }
  async whenIdle() {
    while (this.#pump || this.#stopWork || this.#confirmationWork) await (this.#stopWork ?? this.#pump ?? this.#confirmationWork);
    return this.readiness();
  }

  #kick() {
    if (this.#pump || !this.#opened || this.#closed || this.#closing || this.#stopWork || this.#queueFailure
      || this.#compactionBusy) return;
    this.#pump = this.#runQueue().catch(async (error) => {
      await this.#holdExecutionUnknown(`queue-failure:${randomUUID()}`,
        `The durable request queue could not safely continue: ${error.message}`, "human-loop-queue");
    }).finally(async () => {
      this.#pump = null;
      if (this.#queueFailure || this.#closing || this.#closed) return;
      const state = await this.#store.load();
      if (state.stop?.mode === "after-step") { this.#scheduleStepStop(); return; }
      const confirmation = currentImplementationConfirmation(state);
      if (!state.stop && !state.uncertainty && !this.#availabilityError && !this.#presentationError
        && (state.activeRequestId && !state.activeTask && ["approved", "design"].includes(confirmation?.status)
          || !state.activeRequestId && (nextHumanRequest(state)
            || state.requests.some((request) => request.status === "waiting" && isStaleAnswer(state, request))))) this.#kick();
    });
  }
  async #runQueue() {
    while (!this.#closed && !this.#closing) {
      let state = await this.#store.load();
      if (state.stop || state.uncertainty) return;
      const confirmation = currentImplementationConfirmation(state);
      if (confirmation?.status === "pending" && same(confirmation.design, state.design)) return;
      const stale = !state.activeRequestId && state.requests.find((request) => request.status === "waiting" && isStaleAnswer(state, request));
      if (stale) {
        const reason = "This question answer refers to an already handled or cancelled source. It was not applied.";
        await this.#store.dispatch("host", `stale-answer:${stale.id}`, "reject-stale-answer", { requestId: stale.id, reason });
        await this.#store.recordMessage({ id: `stale-answer:${stale.id}`, requestId: stale.id, role: "host", kind: "status",
          content: reason, timestamp: new Date().toISOString() });
        this.#notify({ kind: "answer-rejected", requestId: stale.id });
        continue;
      }
      let request = state.requests.find(({ id }) => id === state.activeRequestId);
      if (!request) {
        request = nextHumanRequest(state);
        if (!request) return;
        try { await this.#verifyAdmission(); this.#availabilityError = null; }
        catch (error) { this.#availabilityError = error.message; return; }
        if (this.#closing) return;
        state = await this.#store.dispatch("host", `admit:${request.id}`, "admit-request", { requestId: request.id });
        request = state.requests.find(({ id }) => id === request.id);
      }
      try {
        if (request.status === "handoff-pending") await this.#present(request);
        else await this.#runRequest(request);
      } catch (error) {
        if ((this.#closing || this.#closed) && error.code === "human-loop-stop") return;
        state = await this.#store.load();
        if (error.code === "human-loop-stop" && (!error.requestId || error.requestId === request.id)
          && (state.stop?.requestIds.includes(request.id) || state.stops.some((stop) => stop.requestIds.includes(request.id)))) return;
        if (state.requests.find(({ id }) => id === request.id)?.status === "handoff-pending") {
          this.#presentationError = error.message; return;
        }
        if (error.code === "human-loop-not-dispatched") {
          if (await this.#rejectPreparation(request, error)) continue;
          return;
        }
        if (!state.uncertainty) await this.#holdExecutionUnknown(`failed-request:${request.id}`,
          `The request could not safely continue: ${error.message}`, this.#lastRole?.binding.id ?? request.id);
        return;
      }
    }
  }

  async #prepare(stage, work) {
    try { return await work(); }
    catch (error) {
      if (error.code === "human-loop-stop") throw error;
      throw Object.assign(new Error(`${stage} was not dispatched: ${error.message}`, { cause: error }),
        { code: "human-loop-not-dispatched" });
    }
  }

  async #rejectPreparation(request, error) {
    let reason = `Preparation failed; no next role was dispatched. ${error.message}`;
    try {
      const state = await this.#store.load();
      if (state.activeTask?.binding.role === "reviewer") reason =
        `Review could not start. Your implementation is retained; this is not approval. No successful Review retry is required before another request. ${error.message}`;
      const stopped = state.requests.find(source => source.id === request.id)?.status === "stopped"
        && state.stops.some(stop => stop.requestIds.includes(request.id));
      if (!stopped) await this.#store.dispatch("host", `preparation-failed:${request.id}`, "reject-preparation", {
          requestId: request.id, taskId: state.activeTask?.binding.id ?? null, reason,
        });
      if (error.taskId) { this.#transport.release(error.taskId); this.#fences.delete(error.taskId); }
      if (this.#lastRole?.binding.requestId === request.id) this.#fences.delete(this.#lastRole.binding.id);
      await this.#store.recordMessage({ id: `preparation-failed:${request.id}`, requestId: request.id,
        role: "host", kind: "status", content: reason, timestamp: new Date().toISOString() });
      this.#notify({ kind: "preparation-failed", requestId: request.id, reason });
      return true;
    } catch (recordingError) {
      this.#availabilityError = `${reason} Recording that failure also failed: ${recordingError.message}`;
      process.emitWarning(this.#availabilityError, { code: "HUMAN_LOOP_PREPARATION_RECORDING" });
      this.#notify({ kind: "preparation-failed", requestId: request.id, reason: this.#availabilityError });
      return false;
    }
  }

  async #holdExecutionUnknown(id, reason, evidenceRef) {
    this.#queueFailure = reason;
    try {
      if (!(await this.#store.load()).uncertainty) {
        await this.#store.dispatch("host", id, "execution-unknown", { reason, evidenceRef });
      }
    } catch (error) {
      this.#queueFailure += ` Durable uncertainty recording also failed: ${String(error?.message ?? error)
        .slice(0, this.#owner.policy.values.resources.reviewReasonCharacters)}`;
      process.emitWarning(this.#queueFailure, { code: "HUMAN_LOOP_UNCERTAINTY_RECORDING" });
    }
    this.#notify({ kind: "execution-unknown", reason: this.#queueFailure });
  }

  async #runRequest(request) {
    let state = await this.#store.load();
    if (!request.route) await this.#runRole("router", request);
    state = await this.#store.load();
    this.#requireRunning(state, request.id);
    request = state.requests.find(({ id }) => id === request.id);
    if (request.status === "handoff-pending") { await this.#present(request); return; }
    let route = request.route.outcome;
    let confirmation = currentImplementationConfirmation(state);
    if (confirmation?.afterDesignResultId || !["design", "answer"].includes(route.intent)) {
      if (!confirmation || confirmation.status === "pending" && !same(confirmation.design, state.design)) {
        const id = `confirmation:${request.route.resultId}:${state.design.revisionId ?? "none"}:${confirmation?.afterDesignResultId ?? "route"}`;
        state = await this.#store.dispatch("host", id, "request-implementation-confirmation", {
          id, requestId: request.id, routeResultId: request.route.resultId,
          design: state.design, createdAt: new Date().toISOString(),
        });
        confirmation = currentImplementationConfirmation(state);
        this.#notify({ kind: "implementation-confirmation", requestId: request.id });
      }
      if (confirmation.status === "pending") return;
      if (confirmation.status === "design") route = { ...route, intent: "design", cycleId: null };
      else {
        requireCondition(confirmation.status === "approved", "Implementation has not been approved.");
        if (confirmation.afterDesignResultId) route = { ...route, intent: "implement", cycleId: null };
      }
    }
    if (route.intent === "design" || route.intent === "answer") {
      await this.#runRole(route.intent === "design" ? "designer" : "agent", request);
      this.#requireRunning(await this.#store.load(), request.id);
      await this.#present(request); return;
    }
    let cycle;
    if (route.intent === "implement") {
      cycle = state.cycles.find((cycle) => cycle.originRequestId === request.id);
      if (!cycle) {
        const baseline = await this.#prepare("Implementation baseline", () => this.#workspace.capture());
        this.#requireRunning(state, request.id);
        await this.#store.dispatch("host", `cycle:${request.id}`, "start-cycle", {
          cycleId: `cycle:${request.id}`, design: state.design, baseline,
        });
      }
      cycle = (await this.#store.load()).cycles.find((cycle) => cycle.originRequestId === request.id);
    } else {
      cycle = state.cycles.find(({ id }) => id === route.cycleId);
      requireCondition(cycle, "Routed work cycle is unavailable.");
      if (!cycle.requestIds.includes(request.id)) {
        await this.#workspace.readSnapshot(cycle.current);
        this.#requireRunning(state, request.id);
        await this.#store.dispatch("host", `continue:${request.id}`, route.intent === "resume-cycle" ? "resume-cycle" : "prepare-replan",
          { cycleId: cycle.id, design: state.design, snapshot: cycle.current });
      }
    }
    await this.#runCycle(request, cycle.id);
  }

  async #runCycle(request, cycleId) {
    while (true) {
      const state = await this.#store.load(); this.#requireRunning(state, request.id);
      const cycle = state.cycles.find(({ id }) => id === cycleId);
      requireCondition(cycle, "Work cycle disappeared.");
      if (state.requests.find(({ id }) => id === request.id).status === "handoff-pending") { await this.#present(request); return; }
      if (cycle.phase === "planning") {
        if (!cycle.pendingPlan) {
          await this.#runRole("planner", request, cycleId);
          continue;
        }
        await this.#acceptPlan(request, cycleId);
      } else if (cycle.phase === "implementing") {
        const next = cycle.plan.tasks.find((task) => cycle.tasks.some((record) => record.id === task.id && record.status === "pending")
          && task.dependsOn.every((id) => cycle.tasks.some((record) => record.id === id && record.status === "completed")));
        if (next) {
          await this.#runRole("implementer", request, cycleId, next.id);
          const updated = (await this.#store.load()).cycles.find(({ id }) => id === cycleId);
          this.#requireRunning(state, request.id);
          this.#notify({ kind: "internal-task", cycleId, taskId: next.id,
            completed: updated.tasks.filter(({ status }) => status === "completed").length, total: updated.tasks.length });
        } else {
          requireCondition(cycle.tasks.every(({ status }) => status === "completed"), "No internal task is eligible; unfinished work is not complete.");
          await this.#runRole("implementer", request, cycleId, null);
        }
      } else if (cycle.phase === "review-pending") {
        await this.#runRole("reviewer", request, cycleId);
        this.#requireRunning(await this.#store.load(), request.id);
        await this.#present(request); return;
      } else throw new Error(`Cycle ${cycle.id} needs a user handoff rather than automatic ${cycle.phase} continuation.`);
    }
  }

  async #acceptPlan(request, cycleId, taskId = null) {
    const state = await this.#store.load(); this.#requireRunning(state, request.id, taskId);
    const cycle = state.cycles.find(({ id }) => id === cycleId), plan = cycle?.pendingPlan;
    requireCondition(plan, "No pending internal plan is available for Host acceptance.");
    const source = state.requests.find(({ id }) => id === request.id);
    await this.#store.dispatch("host", `accept:${cycle.id}:${plan.digest}`, "accept-plan", { cycleId,
      acceptance: { schemaVersion: "internal-plan-acceptance/v1", authority: "host",
        cycleId, requestId: request.id, routeResultId: source.route.resultId,
        sourceRequestIds: [...state.activeBatchRequestIds],
        planId: plan.id, planDigest: plan.digest, design: cycle.design, baseline: cycle.current, policyDigest: this.#owner.policy.digest } });
    this.#notify({ kind: "plan-accepted", cycleId, total: plan.tasks.length });
  }

  async #runRole(role, request, cycleId = null, internalTaskId = null) {
    const state = await this.#store.load(); this.#requireRunning(state, request.id);
    const id = `role:${request.id}:${state.executions.length}:${role}`;
    const { currentDesign, before, packet } = await this.#prepare(`${role} preparation`, async () => {
      const currentDesign = await this.#readDesign();
      this.#requireRunning(state, request.id);
      requireCondition(same(currentDesign.binding, state.design), "Canonical Design changed outside the owned publication path.");
      const retainedCycle = cycleId ? state.cycles.find(({ id }) => id === cycleId) : null;
      const before = ["implementer", "reviewer"].includes(role) ? await this.#workspace.capture() : retainedCycle?.current ?? null;
      const cycle = retainedCycle ? { ...retainedCycle, current: before,
        ...(role === "reviewer" ? { reviewSnapshot: before } : {}) } : null;
      this.#requireRunning(state, request.id);
      const context = await this.#context(role, request, cycle, internalTaskId, before, currentDesign, state);
      this.#requireRunning(state, request.id);
      return { currentDesign, before, packet: createHumanTask({ id, dispatchId: `dispatch:${id}`, sessionId: this.#owner.privateSessionId,
        requestId: request.id, cycleId, role, internalTaskId, before, design: state.design }, context) };
    });
    this.#fences.set(id, { conflict: null });
    this.#settlingTaskId = id;
    try {
      this.#lastRole = packet;
      this.#notify({ kind: "role", role, requestId: request.id, cycleId, internalTaskId });
      await this.#transport.send(packet);
      this.#requireRunning(state, request.id, id);
      await this.#transport.waitForResult(id);
      let current = await this.#store.load(); this.#requireRunning(current, request.id, id);
      const after = role === "implementer" ? await this.#workspace.capture() : before;
      this.#requireRunning(current, request.id, id);
      await this.#store.dispatch("host", `snapshot:${id}`, "record-result-snapshot", {
        taskId: id, resultId: current.activeTask.result.resultId, snapshot: after,
      });
      current = await this.#store.load(); this.#requireRunning(current, request.id, id);
      const result = current.activeTask.result;
      let designPublication = null;
      if (result.outcome.kind === "designer-changed") {
        requireCondition(this.#designer?.publish, "Validated Designer publication adapter is unavailable.");
        designPublication = await this.#designer.publish({ packet, result, previous: currentDesign.binding });
      }
      if (result.outcome.kind === "review-result") {
        const effect = (async () => {
          const receipt = await this.#reviewEffects({ cycle: current.cycles.find(({ id }) => id === cycleId), result, snapshot: after });
          if (receipt && !receipt.cancelled) await this.#store.dispatch("host", `review-index:${id}`, "record-review-index", {
            taskId: id, resultId: result.resultId, receiptId: receipt.receiptId, before: receipt.before, after: receipt.after,
          });
        })();
        this.#hostEffect = effect;
        try { await effect; } finally { if (this.#hostEffect === effect) this.#hostEffect = null; }
      }
      this.#requireRunning(await this.#store.load(), request.id, id);
      await this.#store.dispatch("host", `apply:${id}`, "apply-result", { resultId: result.resultId, designPublication });
      this.#transport.release(id); this.#fences.delete(id);
      if (result.outcome.kind === "internal-plan") await this.#acceptPlan(request, cycleId, id);
      return result;
    } finally {
      if (this.#settlingTaskId === id) this.#settlingTaskId = null;
      this.#scheduleStepStop();
    }
  }

  async #context(role, request, cycle, internalTaskId, before, design, state) {
    const references = request.answers?.answers ?? [];
    const questions = state.questions.filter(q => q.state === "open"
      || references.some(ref => ref.questionId === q.id && ref.sourceResultId === q.source.resultId));
    const questionAnswers = references.map(answer => {
      const question = questions.find(q => q.id === answer.questionId && q.source.resultId === answer.sourceResultId);
      requireCondition(question, "A saved answer lost its canonical question context.");
      return { question, answer, originalRequests: question.source.requestIds.map(id => state.requests.find(r => r.id === id)) };
    });
    const pendingQuestionAnswers = state.requests.filter(r => r.id !== request.id && isPriorityAnswer(r)
      && ["waiting", "active", "handoff-pending"].includes(r.status)).map(r => ({
        requestId: r.id, status: r.status, questionRefs: r.blockingAnswerRefs,
        cycleIds: [...new Set(r.blockingAnswerRefs.map(ref => state.questions.find(q =>
          q.id === ref.questionId && q.source.resultId === ref.sourceResultId)?.source.cycleId).filter(Boolean))],
      }));
    const boundCycles = state.cycles.filter((cycle) => cycle.phase === "waiting-input"
      || questions.some((question) => question.source.cycleId === cycle.id))
      .map((cycle) => ({ ...cycle, originalRequest: state.requests.find(({ id }) => id === cycle.originRequestId) }));
    const internal = cycle?.plan?.tasks.find(({ id }) => id === internalTaskId);
    const instructions = {
      ...humanLoopPrompts.roles,
      implementer: internalTaskId ? humanLoopPrompts.roles.implementer.task : humanLoopPrompts.roles.implementer.aggregate,
    };
    return {
      request, requests: state.activeBatchRequestIds.map((id) => state.requests.find((request) => request.id === id)),
      originalRequests: cycle ? cycle.originRequestIds.map((id) => state.requests.find((request) => request.id === id)) : [],
      originalRequest: cycle ? state.requests.find(({ id }) => id === cycle.originRequestId)
        : boundCycles.length === 1 ? boundCycles[0].originalRequest : null,
      design: { ...design, references: design.content ? designReferenceCatalog(design.content) : [] },
      ...(role === "designer" ? { designGeneration: this.#designer.generation?.() ?? designGenerationContract } : {}),
      code: { baseline: cycle?.baseline ?? before, current: before }, cycle, boundCycles,
      questions,
      questionContinuations: questions.filter(q => q.importance === "advisory").map(q => ({
        questionId: q.id, sourceResultId: q.source.resultId, declaration: q.unanswered ?? null,
        issue: advisoryContinuationIssue(q, state.design),
        attribution: q.unanswered ? "Declared by the source role; not a user answer or approval." : "No continuation was recorded; do not invent one." })),
      questionAnswers, pendingQuestionAnswers, lastOutcome: state.handoffs.at(-1)?.result ?? null,
      recordedQuestionAnswers: state.requests.filter(source => source.id === request.id
        || ["completed", "cancelled"].includes(source.status)).flatMap(source => (source.answers?.answers ?? []).map(answer => ({
        requestId: source.id, requestStatus: source.status, answer,
        question: state.questions.find(q => q.id === answer.questionId && q.source.resultId === answer.sourceResultId),
      }))),
      implementationDecisions: (state.implementationConfirmations ?? []).filter(c => c.status !== "pending").map(c => ({
        ...c, requests: c.requestIds.map(id => {
          const source = state.requests.find(r => r.id === id);
          return { id, message: source.message };
        }),
      })),
      acceptance: cycle?.acceptance ?? null, scope: internal?.scope ?? [],
      ...(this.#contextProvider ? { sourceHandoffs: await this.#contextProvider({ role, request, cycle, state }) } : {}),
      instructions: [
        ...humanLoopPrompts.shared,
        ...instructions[role],
      ],
    };
  }

  async #authorizeTool(packet) {
    const state = await this.#store.load();
    requireCondition(state.activeTask?.binding.id === packet.binding.id && allowsHumanRoleSettlement(state, packet.binding.id) && !state.uncertainty,
      "Tool no longer belongs to the active work.");
    const fence = this.#fences.get(packet.binding.id);
    requireCondition(fence && !fence.conflict, fence?.conflict ?? "Tool has no owned workspace boundary.");
  }

  async #executeTool(tool, args, context) {
    const run = this.#toolTail.then(async () => {
      const packet = context.task, fence = this.#fences.get(packet.binding.id);
      await this.#authorizeTool(packet);
      const beforeIndex = await this.#workspace.protectedIndexDigest();
      try { return await tool.execute(args, context); }
      finally {
        if (await this.#workspace.protectedIndexDigest() !== beforeIndex) {
          fence.conflict = "Host-owned TANDEM.md changed during a tool operation. Its integrity must be restored before continuation.";
          throw new Error(fence.conflict);
        }
      }
    });
    this.#toolTail = run.then(() => undefined, () => undefined);
    return run;
  }

  #fileTools() {
    const tool = (name, description, parameters, execute, allowed = roles) => ({ name, description, parameters, execute, roles: allowed });
    return [
      tool("read_current_design", "Read the exact current validated product Design; absence remains explicit.", objectSchema({}),
        async () => JSON.stringify(await this.#readDesign())),
      tool("read_design_revision", "Read one exact retained Design revision and its generic references; never rebind an old reference to current content.",
        objectSchema({ revisionId: string, digest: string }),
        async (binding) => JSON.stringify(await this.#designer.readRevision(binding))),
      tool("read_work_cycle", "Read the original request, internal plan, completed/remaining tasks and retained result context.", objectSchema({}),
        async (_args, { task }) => {
          const state = await this.#store.load();
          return JSON.stringify({ cycle: state.cycles.find(({ id }) => id === task.binding.cycleId) ?? null,
            questions: state.questions, requests: state.requests.map(({ id, message, status }) => ({ id, message, status })) });
        }),
      tool("read_cycle_changes", "Read complete work-cycle change identities rather than only the latest task's diff.", objectSchema({}),
        async (_args, { task }) => {
          const state = await this.#store.load(), cycle = state.cycles.find(({ id }) => id === task.binding.cycleId);
          requireCondition(cycle, "This role has no work cycle.");
          return JSON.stringify(await this.#review.evidence(cycle));
        }),
      tool("read_cycle_file", `Read an immutable before/after excerpt from an actual cycle change, at most ${this.#owner.policy.values.resources.reviewExcerptCharacters} characters. Omit length for the bounded default; use nextOffset to continue. Read current project files with native view.`,
        objectSchema({ path: string, side: { enum: ["before", "after"] }, offset: { type: "integer", minimum: 0 },
          length: { type: "integer", minimum: 1, maximum: this.#owner.policy.values.resources.reviewExcerptCharacters } }, ["path", "side"]),
        async (args, { task }) => {
          const cycle = (await this.#store.load()).cycles.find(({ id }) => id === task.binding.cycleId);
          requireCondition(cycle, "This role has no cycle evidence.");
          return JSON.stringify(await this.#review.file(cycle, args));
        }, ["reviewer", "implementer"]),
    ];
  }

  async #present(request) {
    if (this.#presentationWork) return this.#presentationWork;
    this.#presentationWork = this.#presentHandoff(request).finally(() => { this.#presentationWork = null; });
    return this.#presentationWork;
  }

  async #presentHandoff(request) {
    const state = await this.#store.load();
    this.#requireRunning(state, request.id, state.stop?.taskId ?? null);
    const handoff = state.handoffs.findLast((handoff) => handoff.requestId === state.activeRequestId && !handoff.presented);
    requireCondition(handoff, "The user handoff has not been saved.");
    const taskId = state.executions.find((task) => task.result?.resultId === handoff.result.resultId)?.binding.id ?? null;
    this.#requireRunning(state, request.id, taskId);
    const outcome = handoff.result.outcome;
    let content = outcome.summary;
    if (outcome.kind === "answer") content = outcome.report;
    else if (outcome.kind === "designer-unchanged") content += `\n\n${outcome.explanation}`;
    else if (outcome.kind === "review-result" && outcome.reviewFormat) {
      content = decisionReportText(outcome);
    } else if (outcome.kind === "review-result") {
      content = `${outcome.findings.length ? "Review complete with findings." : "Review complete: no issues found."} Code is already in your project workspace.\n\n${content}`;
      for (const finding of outcome.findings) content += `\n\n${finding.summary}\n${finding.consequence}`;
      if (outcome.verificationLimits.length) content += `\n\nVerification limits: ${outcome.verificationLimits.join(" ")}`;
    } else if (outcome.kind === "design-concern") {
      const cycle = state.cycles.find(({ id }) => id === handoff.cycleId);
      const changes = await this.#workspace.changes(cycle.baseline, cycle.current);
      content += `\n\n${outcome.reason}\n\n${changes.length} changed path(s) are retained in the project. This work cycle is unfinished; no whole-plan Review or automatic Designer was started.`;
    } else if (outcome.kind === "discovery-change") {
      // Keep historical handoff bytes stable; no upstream callback is registered.
      content += `\n\n${outcome.reason}\n\nReview the affected discovery stages in Project changes. Existing Design and code are unchanged; implementation has not been authorized.`;
    } else if (outcome.kind === "stopped-partial") {
      content = `Stopped with partial work retained. This role did not complete its requested outcome; no completion or Review is inferred.\n\n${content}`;
    } else if (["execution-failure", "review-incomplete"].includes(outcome.kind)) content += `\n\n${outcome.reason}`;
    const previous = (await this.#store.messages()).find(({ id }) => id === handoff.id);
    this.#requireRunning(state, request.id, taskId);
    if (previous) requireCondition(previous.content === content, "Saved handoff content changed.");
    else await this.#store.recordMessage({ id: handoff.id, requestId: handoff.requestId,
      role: outcome.kind === "execution-failure" ? "host" : state.executions.find((task) => task.result?.resultId === handoff.result.resultId)?.binding.role ?? "host",
      kind: "assistant", content, timestamp: new Date().toISOString() });
    this.#requireRunning(state, request.id, taskId);
    await this.#onHandoff({ ...handoff, content, questions: state.questions.filter((q) => q.source.resultId === handoff.result.resultId) });
    this.#requireRunning(state, request.id, taskId);
    const confirmAfterDesign = !state.stop && ["designer-changed", "designer-unchanged"].includes(outcome.kind)
      && requestsImplementationAfterDesign(state, state.requests.find(r => r.id === request.id))
      && !state.questions.some(q => questionBlocksNewWork(state, q));
    await this.#store.dispatch("host", `present:${handoff.id}`, "present-handoff", { handoffId: handoff.id,
      ...(confirmAfterDesign ? { implementationConfirmation: {
        id: `confirmation-after-design:${handoff.result.resultId}`, createdAt: previous?.timestamp ?? new Date().toISOString(),
      } } : {}),
    });
    if (confirmAfterDesign) this.#notify({ kind: "implementation-confirmation", requestId: request.id });
    this.#presentationError = null;
  }

  async stop(stopId = randomUUID(), mode = "after-step") {
    requireCondition(["after-step", "immediate"].includes(mode), "Unknown Stop mode.");
    requireCondition(!this.#modelChanging, "Model verification is in progress at a quiet boundary; wait before Stop.");
    requireCondition(this.#opened && !this.#closed && !this.#closing, "No open work can be stopped while the runtime is closing.");
    let state;
    try {
      const previous = await this.#store.load();
      if (previous.stops.some(({ id }) => id === stopId)) return { ...await this.readiness(), stopRequestId: stopId };
      state = await this.#store.dispatch("user", `${mode}-stop:${stopId}`,
        mode === "immediate" ? "request-stop" : "request-step-stop", { stopId });
    } catch (error) {
      if (mode === "immediate") {
        const native = await this.#transport.stop(stopId);
        error.message = `Native Stop responded (interrupted=${native.interrupted}), but saving Stop intent failed: ${error.message}`;
        error.nativeOutcome = native;
      }
      throw error;
    }
    if (state.stop?.mode === "after-step") {
      this.#scheduleStepStop();
    } else this.#scheduleImmediateStop();
    return { ...await this.readiness(), stopRequestId: state.stop?.id ?? stopId };
  }

  #scheduleImmediateStop() {
    const stop = this.#state?.stop;
    if (!stop || stop.mode === "after-step" || this.#stopWork) return;
    this.#stopWork = this.#settleImmediateStop(stop.id).catch(async error => {
      const native = error.nativeOutcome;
      await this.#holdExecutionUnknown(`stop-uncertain:${stop.id}`, native
        ? `Native Stop responded (interrupted=${native.interrupted}); local Stop recording failed: ${error.message}`
        : `Native Stop could not be confirmed: ${error.message}`, stop.id);
    }).finally(() => { this.#stopWork = null; this.#kick(); });
  }

  async #settleImmediateStop(stopId) {
    const settled = await this.#transport.stop(stopId);
    try {
      await this.#store.dispatch("host", `native-stop:${stopId}`, "record-native-stop", { stopId, ...settled });
      if (this.#pump) await this.#pump;
      if (this.#hostEffect) await this.#hostEffect;
      if (this.#presentationWork) await this.#presentationWork;
      const state = await this.#store.load();
      requireCondition(state.stop?.id === stopId && state.stop.mode !== "after-step",
        "Immediate Stop lost its exact cancellation ownership.");
      const snapshot = await this.#workspace.capture();
      const task = state.activeTask;
      if (task) { this.#transport.release(task.binding.id); this.#fences.delete(task.binding.id); }
      await this.#store.dispatch("host", `stopped:${stopId}`, "confirm-stop", { stopId, snapshot });
      this.#notify({ kind: "stopped", stopId, mode: "immediate", codeRetained: true, nativeOutcome: settled });
    } catch (error) { error.nativeOutcome = settled; throw error; }
  }

  #scheduleStepStop() {
    const state = this.#state, stop = state?.stop;
    if (stop?.mode !== "after-step" || state.activeTask || state.uncertainty || this.#stopWork
      || (stop.taskId && this.#settlingTaskId === stop.taskId) || this.#queueFailure) return;
    this.#stopWork = this.#settleStepStop(stop.id).catch(async (error) => {
      if ((await this.#store.load()).stop?.mode !== "after-step" && error.code === "human-loop-stop") return;
      await this.#holdExecutionUnknown(`stop-uncertain:${stop.id}`, `Stop could not be settled safely: ${error.message}`, stop.id);
    }).finally(() => { this.#stopWork = null; this.#scheduleImmediateStop(); this.#kick(); });
  }

  async #settleStepStop(stopId) {
    if (this.#presentationWork) await this.#presentationWork;
    let state = await this.#store.load();
    if (state.stop?.id === stopId && state.stop.mode !== "after-step") return;
    requireCondition(state.stop?.id === stopId && state.stop.mode === "after-step" && !state.activeTask && !state.uncertainty,
      "After-step Stop must retain its exact settled ownership.");
    const stop = state.stop;
    const request = state.requests.find(({ id }) => id === stop.requestId);
    if (request && stop.cycleId && state.cycles.find(({ id }) => id === stop.cycleId)?.pendingPlan) {
      await this.#acceptPlan(request, stop.cycleId, stop.taskId);
    }
    if (request && state.handoffs.some((handoff) => handoff.requestId === request.id && !handoff.presented)) {
      await this.#present(request);
    }
    const snapshot = await this.#workspace.capture();
    await this.#store.dispatch("host", `stopped:${stopId}`, "confirm-stop", { stopId, snapshot });
    this.#notify({ kind: "stopped", stopId, mode: "after-step", codeRetained: true });
  }
  async close(closeId = randomUUID(), { releaseStore = true, beforeClose } = {}) {
    if (!this.#opened && !this.#closed && !this.#closing) {
      await this.#transport.releaseFailedStartup();
      throw new Error("The failed private startup was disconnected, but never reached Ready. Its saved ownership remains uncertain; no clean-close checkpoint is claimed.");
    }
    requireCondition(this.#opened && !this.#closed && !this.#closing, "No open runtime is available to close.");
    this.#closing = true;
    const warnings = [];
    const attempt = async (label, action) => {
      try { return await action(); }
      catch (error) { warnings.push(`${label}: ${error.message}`); }
    };
    const shutdown = this.#transport.close();
    shutdown.catch(() => {});
    try {
      await attempt("Close preparation failed", () => beforeClose?.());
      await attempt("Question gates could not be saved", () =>
        this.#store.dispatch("host", `close-questions:${closeId}`, "release-question-gates", {}));
      await attempt("Local state could not be read", async () => {
        this.#closedCache = { state: await this.#store.load(), messages: await this.#store.messages(), design: await this.#readDesign() };
      });
      const native = await shutdown;
      this.#closed = true; this.#opened = false;
      await attempt("Command storage did not close cleanly", () => this.#commands.close({ releaseStorage: false }));
      await attempt("Writer release failed", () => this.#commands.releaseWriter());
      if (releaseStore) await attempt("Local storage did not close cleanly", () => this.#store.close());
      const receipt = parseHumanCleanClose({ schemaVersion: "human-loop-close/v2", id: closeId,
        ownerDigest: policyHash(this.#owner), configurationDigest: policyHash(this.#configuration),
        native, warnings: [...warnings, ...native.warnings], closedAt: new Date().toISOString() });
      if (receipt.warnings.length) this.#notify({ kind: "close-warning", summary: receipt.warnings.join(" ") });
      return receipt;
    } catch (error) {
      error.message = [...warnings, error.message].join(" ");
      throw error;
    } finally { this.#closing = false; }
  }
  #requireRunning(state, requestId, taskId = null) {
    if (this.#closing || this.#closed) throw Object.assign(new Error("The runtime is closing."), { code: "human-loop-stop" });
    // Async preparation may retain a pre-Stop snapshot after confirm-stop has cleared active ownership.
    requireHumanRequestRunning(this.#state?.revision > state.revision ? this.#state : state, requestId, taskId);
  }
  #notify(event) {
    try { Promise.resolve(this.#onProgress?.(event)).catch(() => process.emitWarning("Human-loop UI observation failed; state remains durable.", { code: "HUMAN_LOOP_UI" })); }
    catch { process.emitWarning("Human-loop UI observation failed; state remains durable.", { code: "HUMAN_LOOP_UI" }); }
  }
}
