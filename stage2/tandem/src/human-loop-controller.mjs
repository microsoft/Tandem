import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { homedir } from "node:os";
import { PermissionBroker } from "../runtime-src/permissions/permission-broker.ts";
import { HumanLoopInstallation } from "./human-loop-installation.mjs";
import { HumanLoopRuntime } from "./human-loop-runtime.mjs";
import { HumanLoopEvents, createHumanLoopProvider, projectHumanProgress } from "./human-loop-provider.mjs";
import { createNativePermissionLifecycle } from "./native-permission-lifecycle.mjs";
import { HumanLoopPreferences, validateProjectReasoningEffort } from "./human-loop-preferences.mjs";

export async function createDurablePrivateSession(client, configuration, onCreated) {
  if (typeof client.start !== "function") throw new Error("Installed SDK cannot start the private native client.");
  await client.start();
  if (typeof client.createSession !== "function" || typeof client.rpc?.sessions?.save !== "function") {
    throw new Error("Installed SDK lacks named, durable private-session creation APIs.");
  }
  const session = await client.createSession({ ...configuration, clientName: "Tandem Development" });
  if (session.sessionId !== configuration.sessionId) {
    throw new Error("Native creation did not confirm the exact new private identity; no session was adopted.");
  }
  await onCreated?.(session.sessionId);
  if (typeof session.rpc?.name?.set !== "function") throw new Error("Installed SDK cannot name the private session durably.");
  await session.rpc.name.set({ name: "Tandem Development" });
  await client.rpc.sessions.save({ sessionId: configuration.sessionId });
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
  const providers = new Map(), providerStarts = new Map(), originals = new Map(), seenOriginals = new Set();
  let session, installation, starting, flushing, closing, auditPaused = false, ending = false;
  const reportError = error => events.append({ type: "human.setup-waiting", source: "system", summary: error.message });
  const toolHook = async input => installation?.guardMainTool(input);
  const permissionHandler = (request, invocation) => options.mainPermissionHandler
    ? options.mainPermissionHandler(request, invocation) : nativePermissions.request(request, invocation);

  function observeOriginal(event) {
    if (event.agentId || !["user.message", "assistant.message"].includes(event.type)
      || typeof event.data?.content !== "string" || !event.data.content || seenOriginals.has(event.id)) return;
    originals.set(event.id, event);
    if (installation?.runtime) void flushOriginals().catch(error =>
      events.append({ type: "human.audit-failed", source: "system", summary: error.message }));
  }
  async function flushOriginals() {
    if (flushing) return flushing;
    const runtime = installation?.runtime;
    if (!runtime || auditPaused) return;
    flushing = (async () => {
      if ((await installation.read()).status !== "ready") return;
      for (const [id, event] of originals) {
        if (auditPaused) break;
        await runtime.store.recordMessage({ id: `main:${id}`, requestId: null,
          role: event.type === "user.message" ? "host-user" : "host-assistant",
          kind: event.type === "user.message" ? "user" : "assistant", content: event.data.content, timestamp: event.timestamp });
        originals.delete(id); seenOriginals.add(id);
      }
      events.touch();
    })().finally(() => { flushing = null; });
    return flushing;
  }
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
      permissionHandler: (request, invocation, lifetime) => permissions.request(request, invocation, lifetime?.signal,
        lifetime?.onceOnly ? { onceOnly: true, nativeSessionGrantEligible: lifetime.nativeSessionGrantEligible,
          provenance: lifetime.provenance } : {}),
      inspectRepairAdmissions: options.inspectRepairAdmissions,
      withEmptyRepairExclusion: options.withEmptyRepairExclusion,
      resetPermissions: sessionId => permissions.resetSession(sessionId),
      beforeClose: async () => { auditPaused = true; await flushing; },
      afterReady: () => { auditPaused = false; },
      createRuntime: async runtimeOptions => new HumanLoopRuntime({
        ...runtimeOptions, contextProvider: options.contextProvider, withRequestAdmission: options.withRequestAdmission,
        projectEffortControl: options.projectEffortControl === true,
        createPrivateSession: configuration => createDurablePrivateSession(runtimeOptions.client, configuration, runtimeOptions.afterNativeCreate),
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
    session.on(observeOriginal);
    for (const event of await session.getEvents()) observeOriginal(event);
  }
  async function start(openOptions = {}) {
    if (ending) throw new Error("The owning session is closing.");
    if (!installation) throw new Error("Development is still attaching to the current main session.");
    if (starting) return starting;
    starting = (async () => {
      await options.beforeStart?.();
      const runtime = await installation.open(openOptions);
      if (options.projectEffortControl) await runtime.applyProjectEffort();
      events.enablePersistence(repositoryRoot);
      for (const event of await session.getEvents()) observeOriginal(event);
      await flushOriginals();
      runtime.wake();
      const readiness = await runtime.readiness();
      events.append({ type: readiness.status === "ready" ? "human.ready" : "human.setup-waiting", source: "system",
        summary: readiness.status === "ready" ? "Ready for new instructions. Previous work is not resumed by recovery."
          : readiness.reason ?? "The workflow is not Ready." });
      return runtime;
    })().finally(() => { starting = null; });
    return starting;
  }
  async function openView(id, providerOptions = {}) {
    if (ending) throw new Error("The owning session is closing.");
    if (providers.has(id)) return providers.get(id);
    if (providerStarts.has(id)) return providerStarts.get(id);
    const opening = (async () => {
      const original = await createHumanLoopProvider({ repositoryRoot, publicDirectory, getInstallation: () => installation,
        events, permissions, start, finishEmptyRepair: async () => {
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
    return installation ? { installation: await installation.read(),
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
    validateProjectReasoningEffort(effort);
    if (!options.projectEffortControl) throw new Error("Project effort control is not enabled for this provider.");
    if (starting || closing) throw new Error("Development is opening or closing.");
    const current = await status();
    if (!["new", "prepared", "ready", "closed"].includes(current.installation.status)) throw new Error("Open and reconcile the original Development owner before changing its effort.");
    if ((await preferences.read()).pendingModel) throw new Error("Reconcile the pending private model before changing project effort.");
    if (installation?.runtime && current.installation.status !== "closed") await installation.runtime.validateProjectEffort(effort);
  }
  async function selectReasoningEffort(effort) {
    await validateReasoningEffort(effort);
    const current = await status();
    if (installation?.runtime && current.installation.status !== "closed") await installation.runtime.selectProjectEffort(effort);
    else await preferences.update({ projectReasoningEffort: effort });
    events.touch();
    return reasoningEffortStatus();
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
    status, assertQuiet, close, reportError, events, validateReasoningEffort, selectReasoningEffort, reasoningEffortStatus,
    get installation() { return installation; } };
}
