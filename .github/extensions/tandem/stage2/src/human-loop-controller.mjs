import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { homedir } from "node:os";
import { PermissionBroker } from "../runtime-src/permissions/permission-broker.ts";
import { HumanLoopInstallation } from "./human-loop-installation.mjs";
import { HumanLoopRuntime } from "./human-loop-runtime.mjs";
import { HumanLoopEvents, createHumanLoopProvider, projectHumanProgress } from "./human-loop-provider.mjs";
import { createNativePermissionLifecycle } from "./native-permission-lifecycle.mjs";
import { HumanLoopPreferences, normalizeModelCatalog, validateProjectReasoningEffort } from "./human-loop-preferences.mjs";
import { MainSessionModel } from "./main-session-model.mjs";

export async function preparePrivateSessionConfiguration(client, configuration, mainModel) {
  if (typeof client.start !== "function") throw new Error("Installed SDK cannot start the private native client.");
  await client.start();
  if (!configuration.model && mainModel) {
    const current = await mainModel();
    if (!current || typeof current.modelId !== "string" || !current.modelId.trim()) {
      throw new Error("The main session has not reported its current model. Select a main model or an explicit Development override in Project settings before creating Development.");
    }
    configuration = { ...configuration, model: current.modelId };
  }
  if (configuration.model && mainModel && (typeof client.listModels !== "function"
    || !normalizeModelCatalog(await client.listModels()).some(model => model.id === configuration.model))) {
    throw new Error("The selected model is unavailable for private Development. Choose an available Development override in Project settings; no fallback was selected.");
  }
  if (typeof client.createSession !== "function" || typeof client.rpc?.sessions?.save !== "function") {
    throw new Error("Installed SDK lacks named, durable private-session creation APIs.");
  }
  return configuration;
}

export async function createDurablePrivateSession(client, configuration, onCreated, mainModel) {
  configuration = await preparePrivateSessionConfiguration(client, configuration, mainModel);
  return createPreparedPrivateSession(client, configuration, onCreated, Boolean(mainModel));
}

async function createPreparedPrivateSession(client, configuration, onCreated, verifyModel) {
  const session = await client.createSession({ ...configuration, clientName: "Tandem Development" });
  if (session.sessionId !== configuration.sessionId) {
    throw new Error("Native creation did not confirm the exact new private identity; no session was adopted.");
  }
  await onCreated?.(session.sessionId);
  if (typeof session.rpc?.name?.set !== "function") throw new Error("Installed SDK cannot name the private session durably.");
  await session.rpc.name.set({ name: "Tandem Development" });
  await client.rpc.sessions.save({ sessionId: configuration.sessionId });
  if (configuration.model && verifyModel) {
    if (typeof session.rpc?.model?.getCurrent !== "function"
      || (await session.rpc.model.getCurrent()).modelId !== configuration.model) {
      throw new Error("The created Development session did not confirm its requested model. Its original identity was retained; no project request was submitted.");
    }
  }
  return session;
}

/** Composition only: native scheduling, admission, consent and recovery remain runtime-owned. */
export function createHumanLoopController(options) {
  const repositoryRoot = options.workspacePath;
  const publicDirectory = options.publicDirectory ?? fileURLToPath(new URL("../public/", import.meta.url));
  const events = new HumanLoopEvents();
  const preferences = new HumanLoopPreferences(repositoryRoot);
  const permissions = new PermissionBroker(events);
  const nativePermissions = createNativePermissionLifecycle({
    permissions,
    reportError: error => events.append({ type: "human.permission-sync-failed", source: "system", summary: error.message }),
  });
  const providers = new Map(), providerStarts = new Map();
  let session, installation, starting, closing, ending = false, changingSettings = false, startupPhase = null;
  const mainModels = new MainSessionModel(() => session, async () => (await preferences.read()).projectReasoningEffort);
  const currentMainModel = () => {
    if (typeof session?.rpc?.model?.getCurrent !== "function") throw new Error("This host cannot read the main-session model for Development inheritance.");
    return session.rpc.model.getCurrent();
  };
  async function changeMainModel(input) {
    assertSettingsIdle(); changingSettings = true;
    try {
      const change = () => mainModels.select(input);
      return await (options.withMainModelChange ? options.withMainModelChange(change) : change());
    } finally { changingSettings = false; events.touch(); }
  }
  const reportError = error => events.append({ type: "human.setup-waiting", source: "system", summary: error.message });
  const toolHook = async input => installation?.guardMainTool(input);
  const permissionHandler = (request, invocation) => options.mainPermissionHandler
    ? options.mainPermissionHandler(request, invocation) : nativePermissions.request(request, invocation);

  async function attach(joinedSession) {
    if (session) throw new Error("The Development controller is already bound to its real main session.");
    session = joinedSession;
    nativePermissions.attach(session.sessionId);
    installation = new HumanLoopInstallation({
      workspacePath: repositoryRoot, mainSession: session,
      registration: { session, id: randomUUID(), toolHook, permissionHandler },
      sdkModulePath: options.sdkModulePath,
      privateExtensionPath: options.privateExtensionPath ?? fileURLToPath(new URL("./extension.mjs", import.meta.url)),
      runtimeRoot: options.runtimeRoot ?? join(process.env.COPILOT_HOME ?? join(homedir(), ".copilot"), "living-canvas", "human-loop-runtime"),
      ...(options.cliPath ? { cliPath: options.cliPath } : {}),
      ...(options.nodePath ? { nodePath: options.nodePath } : {}),
      inspectRepairAdmissions: options.inspectRepairAdmissions,
      withEmptyRepairExclusion: options.withEmptyRepairExclusion,
      permissionHandler: (request, invocation, lifetime) => permissions.request(request, invocation, lifetime?.signal,
        lifetime?.onceOnly ? { onceOnly: true, nativeSessionGrantEligible: lifetime.nativeSessionGrantEligible,
          provenance: lifetime.provenance } : {}),
      resetPermissions: sessionId => permissions.resetSession(sessionId),
      createRuntime: async runtimeOptions => new HumanLoopRuntime({
        ...runtimeOptions, contextProvider: options.contextProvider, withRequestAdmission: options.withRequestAdmission,
        projectEffortControl: options.projectEffortControl === true,
        preparePrivateSession: configuration => preparePrivateSessionConfiguration(runtimeOptions.client, configuration, currentMainModel),
        createPrivateSession: configuration => createPreparedPrivateSession(runtimeOptions.client, configuration, runtimeOptions.afterNativeCreate, true),
        onHandoff: async handoff => {
          events.append({ type: "human.handoff", source: "system", summary: handoff.result.outcome.summary,
            data: { requestId: handoff.requestId, resultId: handoff.result.resultId, kind: handoff.result.outcome.kind } });
          await options.onHandoff?.(handoff);
        },
        onProgress: event => {
          if (event.kind === "state" || event.kind === "assistant-message") { events.touch(); return; }
          events.append(projectHumanProgress(event));
        },
      }),
    });
  }
  async function start(openOptions = {}) {
    if (ending) throw new Error("The owning session is closing.");
    if (!installation) throw new Error("Development is still attaching to the current main session.");
    if (changingSettings) throw new Error("Wait for the Development settings change to finish before opening its runtime.");
    if (starting) return starting;
    starting = (async () => {
      const initializing = !installation.runtime || (await installation.read()).status !== "ready";
      if (initializing) { startupPhase = "starting"; events.touch(); }
      await options.beforeStart?.();
      const runtime = await installation.open(openOptions);
      if (initializing) { startupPhase = "verifying"; events.touch(); }
      if (options.projectEffortControl) await runtime.applyProjectEffort();
      events.enablePersistence(repositoryRoot);
      runtime.wake();
      const readiness = await runtime.readiness();
      events.append({ type: readiness.status === "ready" ? "human.ready" : "human.setup-waiting", source: "system",
        summary: readiness.status === "ready" ? "Ready for new instructions. Previous work is not resumed by recovery."
          : readiness.reason ?? "The workflow is not Ready." });
      return runtime;
    })().finally(() => { starting = null; startupPhase = null; events.touch(); });
    return starting;
  }
  async function openView(id, providerOptions = {}) {
    if (ending) throw new Error("The owning session is closing.");
    if (providers.has(id)) return providers.get(id);
    if (providerStarts.has(id)) return providerStarts.get(id);
    const opening = (async () => {
      const original = await createHumanLoopProvider({ repositoryRoot, publicDirectory, getInstallation: () => installation,
        events, permissions, start, modelSettings, changeModel, mainModelSettings: () => mainModels.read(), changeMainModel,
        getStartupPhase: () => startupPhase, finishEmptyRepair: async () => {
          const runtime = installation.runtime;
          if (!runtime) throw new Error("The repaired runtime is not available for readback.");
          if (options.projectEffortControl) await runtime.applyProjectEffort();
          const [readiness, model] = await Promise.all([runtime.readiness(), runtime.modelSettings()]);
          const verified = readiness.status === "ready" && !readiness.modelBlocked && typeof model.actual === "string" && Boolean(model.actual);
          events.enablePersistence(repositoryRoot);
          events.append({ type: "human.setup-repaired", source: "system",
            summary: verified ? "Empty Development setup reinitialized with the same reserved ID. The retained handoff remains unsent."
              : "Same-ID setup reinitialized. Verify the private model in Settings before continuing; the handoff remains unsent." });
          return { verified, model: model.actual, reasoningEffort: model.actualReasoningEffort ?? null,
            reason: verified ? null : model.error || model.reason || readiness.reason || "Select and apply a private model in Settings." };
        }, ...providerOptions });
      let closeWork;
      const provider = { ...original, close: () => closeWork ??= (async () => {
        if (providers.get(id) === provider) providers.delete(id);
        await original.close();
      })() };
      if (ending) { await provider.close(); throw new Error("The owning session began closing while the view opened."); }
      providers.set(id, provider);
      return provider;
    })().finally(() => providerStarts.delete(id));
    providerStarts.set(id, opening);
    return opening;
  }
  async function closeView(id) {
    const provider = providers.get(id);
    if (provider) { providers.delete(id); await provider.close(); }
  }
  async function status() {
    return installation ? { installation: await installation.read(), startup: startupPhase,
      workflow: installation.runtime ? await installation.runtime.readiness() : null,
      owner: installation.configuration ? {
        mainSessionId: installation.configuration.owner.mainSessionId,
        privateSessionId: installation.configuration.owner.privateSessionId,
        workspacePath: installation.configuration.owner.workspacePath,
      } : null }
      : { installation: { status: "attaching" }, workflow: null };
  }
  async function assertQuiet() {
    if (starting || closing) throw new Error("Development is opening or closing. Wait for its ownership boundary.");
    const current = await status();
    if (current.installation.status === "saved-state" || !["new", "prepared", "ready", "closed"].includes(current.installation.status)) {
      throw new Error("Retained Development ownership must be opened and explicitly settled or closed before upstream discovery can change.");
    }
    if (current.installation.status === "unknown") throw new Error("Development shutdown or ownership is uncertain; resolve it in its owning session.");
    if (installation?.runtime && current.installation.status !== "closed") {
      const state = await installation.runtime.store.load();
      if (state.activeTask || state.activeRequestId || state.stop || state.uncertainty
        || state.requests.some(request => ["waiting", "active", "handoff-pending"].includes(request.status))
        || state.implementationConfirmations?.some(confirmation => confirmation.status === "pending")) {
        throw new Error("Finish, cancel or explicitly close Development before changing upstream discovery.");
      }
      await installation.runtime.transport.inspectIdle();
    }
  }
  async function validateReasoningEffort(effort) {
    assertSettingsIdle();
    await validateEffortSelection(effort);
  }
  async function validateEffortSelection(effort) {
    validateProjectReasoningEffort(effort);
    if (!options.projectEffortControl) throw new Error("Project effort control is not enabled for this provider.");
    const current = await status();
    if (!["new", "prepared", "ready", "closed"].includes(current.installation.status)) throw new Error("Open and reconcile the original Development owner before changing its effort.");
    const saved = await preferences.read();
    if (saved.pendingModel) throw new Error("Reconcile the pending private model before changing project effort.");
    if (installation?.runtime && current.installation.status !== "closed") await installation.runtime.validateProjectEffort(effort);
    else if (saved.model) {
      const model = (await availableModels()).find(model => model.id === saved.model);
      if (!model?.supportedReasoningEfforts.includes(effort)) throw new Error("The saved private model does not advertise this reasoning effort.");
    }
  }
  async function selectReasoningEffort(effort) {
    assertSettingsIdle();
    changingSettings = true;
    try {
      await validateEffortSelection(effort);
      if (ending) throw new Error("The owning session is closing.");
      const current = await status();
      if (installation?.runtime && current.installation.status !== "closed") await installation.runtime.selectProjectEffort(effort);
      else {
        const saved = await preferences.read();
        await preferences.update({ projectReasoningEffort: effort, ...(saved.model ? { reasoningEffort: effort } : {}) });
      }
    } finally { changingSettings = false; events.touch(); }
    return reasoningEffortStatus();
  }
  function assertSettingsIdle() {
    if (starting || closing || ending || changingSettings) throw new Error("Development is opening, closing or changing settings.");
  }
  async function availableModels() {
    if (typeof session?.rpc?.model?.list !== "function") throw new Error("The main session cannot read the authenticated model catalog.");
    const catalog = await session.rpc.model.list();
    if (!Array.isArray(catalog?.list)) throw new Error("The SDK model list is unavailable or invalid.");
    return normalizeModelCatalog(catalog.list.map(model => ({ ...model,
      supportedReasoningEfforts: model?.capabilities?.supports?.reasoning_effort ?? [] })));
  }
  async function modelSettings() {
    const initializing = startupPhase;
    if (initializing) {
      const saved = await preferences.read();
      return { models: [], actual: null, desired: saved.model, pending: saved.pendingModel,
        actualReasoningEffort: null, desiredReasoningEffort: saved.reasoningEffort, pendingReasoningEffort: saved.pendingReasoningEffort,
        effortManaged: options.projectEffortControl === true, projectReasoningEffort: saved.projectReasoningEffort,
        canSetReasoningEffort: false, canChange: false, error: null, capabilities: null, startup: initializing,
        reason: "Development initialization and model verification are in progress." };
    }
    const current = await status();
    const deferred = ["new", "prepared"].includes(current.installation.status)
      || await installation.canConfigureBeforeNativeCreation();
    if (installation?.runtime && !deferred) {
      const value = await installation.runtime.modelSettings();
      return current.installation.status === "ready" && !starting && !closing && !ending && !changingSettings ? value
        : { ...value, canChange: false, reason: "Wait for the original Development runtime to be Ready before changing its model." };
    }
    const saved = await preferences.read();
    let models = [], error = null;
    try { models = await availableModels(); }
    catch (cause) { error = cause.message; }
    return { models, actual: null, desired: saved.model, pending: saved.pendingModel,
      actualReasoningEffort: null, desiredReasoningEffort: saved.reasoningEffort,
      pendingReasoningEffort: saved.pendingReasoningEffort, canSetReasoningEffort: true,
      effortManaged: options.projectEffortControl === true, projectReasoningEffort: saved.projectReasoningEffort,
      deferred, canChange: deferred && models.length > 0 && !error && !saved.pendingModel && !starting && !closing && !ending && !changingSettings,
      error, capabilities: null, reason: deferred
        ? current.installation.status === "unknown" || current.installation.status === "saved-state"
          ? "Native creation was not requested. Save an available Development override, then use Retry runtime; the reserved session and saved handoff are retained."
          : "Without an override, Development inherits the main model at first creation, then keeps its independent saved selection. Optional overrides are verified at startup."
        : "Open and reconcile the original Development owner before changing its model." };
  }
  async function requiresModelSelection() {
    // Older hosts may query this before opening; native defaults require no chooser.
    return false;
  }
  async function changeModel(selection) {
    assertSettingsIdle();
    changingSettings = true;
    try {
      const current = await status();
      if (installation?.runtime && current.installation.status === "ready") return await installation.runtime.changeModel(selection);
      if (!["new", "prepared"].includes(current.installation.status) && !await installation.canConfigureBeforeNativeCreation()) {
        throw new Error("Open and reconcile the original Development owner before changing its model.");
      }
      if (selection.acceptActual) throw new Error("There is no running private model to accept.");
      const saved = await preferences.read();
      if (saved.pendingModel) throw new Error("Reconcile the unconfirmed private model before saving another selection.");
      const effort = options.projectEffortControl && saved.projectReasoningEffort !== null
        ? saved.projectReasoningEffort : selection.reasoningEffort ?? null;
      if (options.projectEffortControl && saved.projectReasoningEffort !== null && selection.reasoningEffort != null
        && selection.reasoningEffort !== effort) throw new Error("Change reasoning effort through the single project control.");
      const selected = (await availableModels()).find(model => model.id === selection.model);
      if (!selected) throw new Error("Selected model is not in the authenticated SDK model list.");
      if (effort !== null && !selected.supportedReasoningEfforts.includes(effort)) throw new Error("Selected reasoning effort is not advertised for this model.");
      if (ending) throw new Error("The owning session is closing.");
      if (!["new", "prepared"].includes((await status()).installation.status) && !await installation.canConfigureBeforeNativeCreation()) {
        throw new Error("Development ownership changed. Review its current state before saving model settings.");
      }
      await preferences.update({ model: selected.id, reasoningEffort: effort });
    } finally { changingSettings = false; events.touch(); }
  }
  async function reasoningEffortStatus() {
    const preference = await preferences.read(), desired = preference.projectReasoningEffort;
    const current = await status();
    const settings = installation?.runtime && current.installation.status !== "closed" ? await installation.runtime.modelSettings() : null;
    const actual = settings?.actualReasoningEffort ?? null;
    return { desired, actual, model: settings?.actual ?? null,
      supported: settings?.models.find(item => item.id === settings.actual)?.supportedReasoningEfforts ?? [],
      status: settings?.error ? "error" : desired === null ? "unset" : actual === desired ? "applied" : "pending",
      error: settings?.error ?? null };
  }
  async function close() {
    if (closing) return closing;
    ending = true;
    closing = (async () => {
      const errors = [];
      if (starting) try { await starting; } catch (error) { errors.push(error); }
      await Promise.allSettled([...providerStarts.values()]);
      let result = { status: "not-started", warnings: [] };
      if (installation?.runtime) {
        const current = await installation.read();
        if (current.status !== "closed") {
          try { result = await installation.close(); } catch (error) { errors.push(error); }
        } else result = { status: "closed", warnings: current.reason ? [current.reason] : [] };
      }
      const views = [...providers.values()]; providers.clear();
      const settled = await Promise.allSettled(views.map(provider => provider.close()));
      errors.push(...settled.filter(value => value.status === "rejected").map(value => value.reason));
      if (errors.length) throw new AggregateError(errors, errors.map(error => error.message).join(" "));
      return result;
    })();
    try { return await closing; } finally { closing = null; }
  }
  return { attach, toolHook, permissionHandler, observe: nativePermissions.observe, start, openView, closeView,
    status, assertQuiet, close, reportError, events, validateReasoningEffort, selectReasoningEffort, reasoningEffortStatus, modelSettings, changeModel, requiresModelSelection,
    get installation() { return installation; } };
}
