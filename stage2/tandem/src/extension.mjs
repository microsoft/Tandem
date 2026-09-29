import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { createCanvas, defineFactory, joinSession } from "@github/copilot-sdk/extension";
import { PermissionBroker } from "../runtime-src/permissions/permission-broker.ts";
import { HumanLoopInstallation } from "./human-loop-installation.mjs";
import { HumanLoopRuntime } from "./human-loop-runtime.mjs";
import { HumanLoopEvents, createHumanLoopProvider, projectHumanProgress } from "./human-loop-provider.mjs";
import { openBrowserCanvas } from "./browser-navigation.mjs";
import { createBrowserEntry } from "./human-loop-browser-entry.mjs";
import { createNativePermissionLifecycle } from "./native-permission-lifecycle.mjs";
import { createReviewCollector, createReviewFactory, privateWorkflowEnvironment } from "./native-evidence-factory.mjs";

const repositoryRoot = process.cwd();
const publicDirectory = fileURLToPath(new URL("../public/", import.meta.url));
const events = new HumanLoopEvents();
const permissions = new PermissionBroker(events);
const nativePermissions = createNativePermissionLifecycle({
  permissions,
  reportError: error => events.append({ type: "human.permission-sync-failed", source: "system", summary: error.message }),
});
const providers = new Map();
const originals = new Map();
const seenOriginals = new Set();
let session, installation, opened = false, starting = null, flushing = null, auditPaused = false, ending = false;

function observeOriginal(event) {
  if (event.agentId || !["user.message", "assistant.message"].includes(event.type)
    || typeof event.data?.content !== "string" || !event.data.content) return;
  if (seenOriginals.has(event.id)) return;
  originals.set(event.id, event);
  if (installation?.runtime) void flushOriginals().catch((error) => events.append({
    type: "human.audit-failed", source: "system", summary: error.message,
  }));
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
async function start(options = {}) {
  if (!installation) throw new Error("Canvas is still attaching to the current main session.");
  if (starting) return starting;
  starting = (async () => {
    const runtime = await installation.open(options);
    events.enablePersistence(repositoryRoot);
    for (const event of await session.getEvents()) observeOriginal(event);
    await flushOriginals();
    runtime.wake();
    const readiness = await runtime.readiness();
    events.append({ type: readiness.status === "ready" ? "human.ready" : "human.setup-waiting",
      source: "system", summary: readiness.status === "ready"
        ? "Ready for new instructions. Previous work is not resumed by recovery." : readiness.reason ?? "The workflow is not Ready." });
  })().finally(() => { starting = null; });
  return starting;
}
const browserEntry = createBrowserEntry({
  getSession: () => session, start,
  createProvider: () => createHumanLoopProvider({
    repositoryRoot, publicDirectory, getInstallation: () => installation, events, permissions, start,
    surface: "browser",
  }),
  reportError: error => events.append({ type: "human.setup-waiting", source: "system", summary: error.message }),
});
const canvas = createCanvas({
  id: "tandem", displayName: "Tandem",
  description: "Project Design, implementation and whole-plan Review in one working copy.",
  actions: [{ name: "get_status", description: "Read the current one-copy workflow status without effects.",
    handler: async () => installation ? { installation: await installation.read(),
      workflow: installation.runtime ? await installation.runtime.readiness() : null } : { installation: { status: "attaching" } } },
  { name: "open_browser", description: "Get a regular-browser URL that stays available after closing this canvas panel.",
    inputSchema: browserEntry.tool.parameters, handler: context => browserEntry.open(context) }],
  open: async (context) => {
    if (ending) throw new Error("The owning session is closing.");
    opened = true;
    let provider = providers.get(context.instanceId);
    if (!provider) {
      provider = await createHumanLoopProvider({
        repositoryRoot, publicDirectory, getInstallation: () => installation, events, permissions, start,
        openBrowser: (url, options) => openBrowserCanvas(session, url, options),
      });
      providers.set(context.instanceId, provider);
    }
    if (installation) void start().catch((error) => events.append({ type: "human.setup-waiting", source: "system", summary: error.message }));
    return { url: provider.url };
  },
  onClose: async (context) => {
    const provider = providers.get(context.instanceId);
    if (provider) { providers.delete(context.instanceId); await provider.close(); }
  },
});
const toolHook = async (input) => installation?.guardMainTool(input);
const permissionHandler = (request, invocation) => nativePermissions.request(request, invocation);
if (process.env[privateWorkflowEnvironment]) {
  if (process.env[privateWorkflowEnvironment] !== process.env.SESSION_ID) {
    throw new Error("Private factory provider belongs to another native session.");
  }
  session = await joinSession({
    factories: [createReviewFactory(defineFactory)],
    tools: [createReviewCollector(() => session)],
  });
} else {
  session = await joinSession({
    canvases: [canvas], tools: [browserEntry.tool],
    hooks: { onPreToolUse: toolHook, onSessionEnd: async (input, invocation) => {
      if (input.reason !== "user_exit" || invocation.sessionId !== session?.sessionId) return;
      ending = true;
      const closing = [...providers.values()]; providers.clear();
      await Promise.all([...closing.map(provider => provider.close()), browserEntry.close()]);
    } },
    onPermissionRequest: permissionHandler,
    onEvent: nativePermissions.observe,
  });
  nativePermissions.attach(session.sessionId);
  installation = new HumanLoopInstallation({
    workspacePath: repositoryRoot, mainSession: session,
    registration: { session, id: randomUUID(), toolHook, permissionHandler },
    sdkModulePath: import.meta.resolve("@github/copilot-sdk"),
    permissionHandler: (request, invocation, lifetime) => permissions.request(request, invocation, lifetime?.signal,
      lifetime?.onceOnly ? { onceOnly: true, nativeSessionGrantEligible: lifetime.nativeSessionGrantEligible,
        provenance: lifetime.provenance } : {}),
    resetPermissions: (sessionId) => permissions.resetSession(sessionId),
    beforeClose: async () => { auditPaused = true; await flushing; },
    afterReady: () => { auditPaused = false; },
    createRuntime: async (options) => new HumanLoopRuntime({
      ...options,
      onHandoff: async (handoff) => events.append({ type: "human.handoff", source: "system",
        summary: handoff.result.outcome.summary, data: { requestId: handoff.requestId, resultId: handoff.result.resultId,
          kind: handoff.result.outcome.kind } }),
      onProgress: (event) => {
        if (event.kind === "state" || event.kind === "assistant-message") { events.touch(); return; }
        events.append(projectHumanProgress(event));
      },
    }),
  });
  session.on(observeOriginal);
  for (const event of await session.getEvents()) observeOriginal(event);
  if (opened) void start().catch((error) => events.append({ type: "human.setup-waiting", source: "system", summary: error.message }));
}
