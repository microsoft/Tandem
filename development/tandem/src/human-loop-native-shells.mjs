import { randomUUID } from "node:crypto";
import { decodeRecord, encodeRecord } from "../runtime-src/domain/workflow/foundation-storage.ts";
import { HumanLoopNativeWriter } from "./human-loop-native-writer.mjs";
import { validateControlRetirement, validateNativeControlEvidence } from "./human-loop-native-recovery.mjs";
import { policyHash } from "../runtime-src/domain/workflow/policy.ts";
import { requireCondition as check } from "../runtime-src/domain/workflow/validation.ts";

export const nativeShellTools = ["powershell", "read_powershell", "list_powershell", "stop_powershell"];
const ended = new Set(["completed", "failed", "stopped"]);
const controlSettled = entry => ended.has(entry.status) || entry.controlRetirement !== undefined
  || entry.detached === true || entry.controlUnbound === true;
const nonempty = value => typeof value === "string" && value.length > 0;
const timestamp = value => nonempty(value) && Number.isFinite(Date.parse(value));
const nativeStart = entry => entry.nativeStartedAt ?? entry.taskBinding?.startedAt;
const sameTask = (task, entry) => task.type === "shell" && task.id === entry.shellId
  && (!nativeStart(entry) || task.startedAt === nativeStart(entry));
const taskStatus = task => task.status === "cancelled" ? "stopped" : task.status;
const taskViewId = task => `native-task:${encodeURIComponent(task.id)}:${encodeURIComponent(task.startedAt)}`;

/** Cancellation is authoritative; a second terminal registry row is not required. */
export async function cancelNativeShellTask(tasks, entry) {
  check(nonempty(entry.shellId) && timestamp(nativeStart(entry)), "Native control requires a current task identity.");
  check(typeof tasks?.list === "function" && typeof tasks?.cancel === "function",
    "Installed SDK has no supported native task control API.");
  const find = listed => listed?.tasks?.find(task => sameTask(task, entry));
  let task = find(await tasks.list());
  check(task && task.attachmentMode === "attached",
    "The selected native task is no longer current; refresh process status.");
  if (task.status === "running") {
    const result = await tasks.cancel({ id: task.id });
    if (result?.cancelled === true) return { resultType: "success", status: "stopped",
      endedAt: new Date().toISOString(), nativeTask: task, cancelled: true };
    check(result?.cancelled === false, "Native task cancellation returned an invalid result.");
    task = find(await tasks.list());
  }
  check(task && ended.has(taskStatus(task)), "Native task cancellation did not confirm an outcome.");
  return { resultType: "success", status: taskStatus(task),
    endedAt: task.completedAt ?? new Date().toISOString(), nativeTask: task, cancelled: false };
}

const entryKeys = new Set(["id", "sessionId", "shellId", "command", "mode", "status", "exitCode",
  "taskId", "requestId", "cycleId", "toolCallId", "startedAt", "endedAt", "reason", "stopRequestedAt", "stopRequestId",
  "backgroundOrigin", "interruption", "controlRetirement", "completionNotification",
  "detached", "controlUnbound", "launchCompletedAt", "taskBinding", "nativeStartedAt"]);
function validEntry(e, sessionId, maximumTasks) {
  return e && typeof e === "object" && Object.keys(e).every(key => entryKeys.has(key))
    && nonempty(e.toolCallId) && e.id === `native:${e.toolCallId}` && e.sessionId === sessionId
    && (e.shellId === null || nonempty(e.shellId))
    && (e.detached === undefined || typeof e.detached === "boolean")
    && (e.controlUnbound === undefined || typeof e.controlUnbound === "boolean")
    && (e.launchCompletedAt === undefined || timestamp(e.launchCompletedAt))
    && (e.nativeStartedAt === undefined || timestamp(e.nativeStartedAt) && nonempty(e.shellId))
    && (e.taskBinding === undefined || e.taskBinding
      && Object.keys(e.taskBinding).sort().join(",") === "afterDigest,beforeDigest,observedAt,startedAt"
      && [e.taskBinding.beforeDigest, e.taskBinding.afterDigest].every(value => /^[a-f0-9]{64}$/.test(value))
      && timestamp(e.taskBinding.startedAt) && timestamp(e.taskBinding.observedAt)
      && nonempty(e.shellId) && timestamp(e.launchCompletedAt)
      && Date.parse(e.taskBinding.startedAt) >= Date.parse(e.startedAt)
      && Date.parse(e.taskBinding.startedAt) <= Date.parse(e.launchCompletedAt)
      && Date.parse(e.taskBinding.observedAt) >= Date.parse(e.launchCompletedAt))
    && nonempty(e.command) && ["sync", "async"].includes(e.mode)
    && (e.backgroundOrigin === undefined || e.backgroundOrigin === null
      || e.backgroundOrigin === "explicit-async" && e.mode === "async"
      || e.backgroundOrigin === "sync-rollover" && e.mode === "sync")
    && (e.completionNotification === undefined || e.completionNotification
      && Object.keys(e.completionNotification).sort().join(",") === "digest,eventId"
      && nonempty(e.completionNotification.eventId) && e.completionNotification.eventId.length <= 512
      && /^[a-f0-9]{64}$/.test(e.completionNotification.digest)
      && ended.has(e.status) && Number.isInteger(e.exitCode))
    && (e.interruption === undefined || e.interruption && typeof e.interruption === "object" && e.mode === "sync"
      && (e.interruption.nativeStatus === undefined && e.status === "stopped"
        || ["cancelled", "completed", "failed"].includes(e.interruption.nativeStatus)
          && e.status === (e.interruption.nativeStatus === "cancelled" ? "stopped" : e.interruption.nativeStatus))
      && ["endEventId,nativeStatus,observedAt,stopId", "endEventId,nativeCompletedAt,nativeStartedAt,observedAt,stopId",
        "endEventId,nativeCompletedAt,nativeStartedAt,nativeStatus,observedAt,stopId"].includes(Object.keys(e.interruption).sort().join(","))
      && nonempty(e.interruption.stopId) && nonempty(e.interruption.endEventId)
      && timestamp(e.interruption.observedAt)
      && (e.interruption.nativeStartedAt === undefined && e.interruption.nativeCompletedAt === undefined
        || timestamp(e.interruption.nativeStartedAt) && timestamp(e.interruption.nativeCompletedAt)))
    && ["starting", "running", "held", ...ended].includes(e.status)
    && (e.controlRetirement === undefined || !ended.has(e.status)
      && validateControlRetirement(e.controlRetirement, sessionId, maximumTasks))
    && (e.exitCode === null || Number.isInteger(e.exitCode))
    && nonempty(e.taskId) && nonempty(e.requestId) && (e.cycleId === null || nonempty(e.cycleId))
    && timestamp(e.startedAt) && (e.endedAt === null || timestamp(e.endedAt))
    && (!ended.has(e.status) || timestamp(e.endedAt))
    && (e.reason === null || typeof e.reason === "string")
    && (e.stopRequestedAt === undefined && e.stopRequestId === undefined
      || timestamp(e.stopRequestedAt) && nonempty(e.stopRequestId) && e.stopRequestId.startsWith("native-stop-"));
}

/** Native invocation policy and durable ownership; execution remains entirely in the SDK. */
export class HumanLoopNativeShells {
  #owner; #workspace; #legacy; #storage; #record; #content; #loading;
  #tail = Promise.resolve(); #live = new Set(); #stopping = new Set(); #stop; #canStop = () => false; #failure;
  #taskReader;
  #registry = { tasks: null, reason: "Native task registry has not been read." };
  #lastTasks = [];
  #taskRead = null; #tasksChanged = () => {};
  constructor({ owner, workspace, legacy, runtimeDirectory }) {
    this.#owner = owner; this.#workspace = workspace; this.#legacy = legacy;
    this.#storage = new HumanLoopNativeWriter(owner, runtimeDirectory);
  }
  setStopHandler(stop, canStop) { this.#stop = stop; this.#canStop = canStop; }
  setTaskReader(reader, changed = () => {}) { this.#taskReader = reader; this.#tasksChanged = changed; }
  #observeTasks() {
    if (this.#taskRead) return this.#taskRead;
    const previous = JSON.stringify({ tasks: this.#registry.tasks, reason: this.#registry.reason });
    this.#registry.pending = true;
    const observation = (async () => {
      try {
        check(this.#taskReader, "Native task registry is unavailable.");
        const listed = await this.#taskReader();
        check(Array.isArray(listed?.tasks) && listed.tasks.every(task => task && nonempty(task.id))
          && new Set(listed.tasks.map(task => task.id)).size === listed.tasks.length,
        "Native task registry is incomplete or ambiguous.");
        this.#lastTasks = listed.tasks.map(task => ({ id: task.id, type: task.type, command: task.command ?? null,
          status: task.status, startedAt: task.startedAt ?? null, completedAt: task.completedAt ?? null,
          attachmentMode: task.attachmentMode ?? null, executionMode: task.executionMode ?? null }));
        this.#registry = { tasks: this.#lastTasks, observedAt: new Date().toISOString(), reason: null, pending: false };
      } catch (error) {
        this.#registry = { tasks: null, pending: false,
          reason: String(error.message ?? error).replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 400) };
      }
      return this.#registry;
    })();
    this.#taskRead = observation;
    void observation.then(() => {
      this.#taskRead = null;
      if (previous !== JSON.stringify({ tasks: this.#registry.tasks, reason: this.#registry.reason })) this.#tasksChanged(this.#registry.reason);
    });
    return observation;
  }
  async #tasks() {
    this.#observeTasks();
    await this.#tail;
    return structuredClone(this.#registry);
  }
  async #load() {
    this.#loading ??= (async () => {
      this.#content = await this.#storage.read();
      this.#record = this.#content === undefined
        ? { schemaVersion: "human-loop-native-shells/v1", ownerDigest: policyHash(this.#owner), entries: [] }
        : decodeRecord(this.#content);
      check(this.#record.schemaVersion === "human-loop-native-shells/v1"
        && this.#record.ownerDigest === policyHash(this.#owner) && Array.isArray(this.#record.entries)
        && this.#record.entries.every(e => validEntry(e, this.#owner.privateSessionId, this.#owner.policy.values.resources.reviewCollections))
        && new Set(this.#record.entries.map(e => e.id)).size === this.#record.entries.length,
      "Native shell ownership journal is invalid; no process can be adopted.");
    })();
    await this.#loading;
    if (this.#failure) throw this.#failure;
  }
  #write(work) {
    const run = this.#tail.then(async () => {
      await this.#load();
      const result = await work();
      const content = encodeRecord(this.#record);
      try {
        await this.#storage.mutate(this.#content, content);
      } catch (error) { this.#failure = error; throw error; }
      this.#content = content;
      return result;
    });
    this.#tail = run.catch(() => {});
    return run;
  }
  async recoveryDiagnosticsRequired() {
    await this.#load(); await this.#tail;
    return this.#record.entries.length > 0;
  }
  async prepareWriter(recovery, nativeEvidence) {
    await this.#load(); await this.#tail;
    const historical = this.#record.entries.filter(e => !controlSettled(e));
    if (historical.length) {
      check(recovery && historical.every(e => !this.#live.has(e.id)),
        "Unresolved historical native shells require reconciliation; current owned work cannot be retired.");
    }
    if (recovery && this.#record.entries.length) {
      validateNativeControlEvidence(nativeEvidence, this.#owner.privateSessionId, recovery.nativeEvidenceDigest,
        this.#owner.policy.values.resources.reviewCollections);
    }
    const previousDigest = this.#content === undefined ? null : policyHash(this.#content);
    const authority = await this.#storage.prepare(this.#content, recovery);
    if (historical.length) {
      const retirement = { schemaVersion: "native-control-retirement/v1",
        outcome: "authority-retired-process-state-unconfirmed", recoveryId: recovery.id,
        previousGeneration: { journalDigest: previousDigest, writerClaim: authority.previousClaim,
          legacyLockDigest: authority.legacyLockDigest },
        generation: authority.claim, evidence: structuredClone(nativeEvidence) };
      validateControlRetirement(retirement, this.#owner.privateSessionId, this.#owner.policy.values.resources.reviewCollections);
      await this.#write(() => {
        for (const entry of historical) entry.controlRetirement = structuredClone(retirement);
      });
    }
  }
  releaseWriter() { this.#storage.close(); }
  async #entry(shellId) {
    await this.#load(); await this.#tail;
    const entry = this.#record.entries.findLast(e => e.shellId === shellId);
    check(entry && this.#live.has(entry.id) && !entry.controlRetirement, "Native shell handle is not owned by this live runtime.");
    return entry;
  }
  async admit(name, args, packet, callId) {
    check(nativeShellTools.includes(name) && args && typeof args === "object" && !Array.isArray(args),
      "Invalid native shell invocation.");
    const keys = name === "powershell" ? ["command", "description", "shellId", "mode", "detach", "initial_wait"]
      : name === "read_powershell" ? ["shellId", "delay"] : name === "stop_powershell" ? ["shellId"] : [];
    check(Object.keys(args).every(key => keys.includes(key)), "Unknown native shell argument.");
    const admission = { name, args: structuredClone(args), indexDigest: await this.#workspace.protectedIndexDigest(), entryId: null };
    if (name === "powershell") {
      check(typeof args.command === "string" && args.command.trim() && !args.command.includes("\0"),
        "Native command is missing.");
      check(["sync", "async"].includes(args.mode ?? "sync"), "Invalid native execution mode.");
      check(args.shellId === undefined || typeof args.shellId === "string", "Invalid native shell label.");
      await this.#workspace.inspectNativePath(this.#owner.workspacePath, { allowDirectory: true });
      admission.taskBaseline = await this.#tasks();
      await this.#write(() => {
        check(this.#record.entries.every(e => controlSettled(e) || this.#live.has(e.id)),
          "Unresolved historical native shells require reconciliation; stored handles are not adopted.");
        check(!this.#record.entries.some(e => e.id === `native:${callId}`), "Native invocation identity was reused.");
        const shellId = nonempty(args.shellId) ? args.shellId : null;
        const reused = shellId !== null && this.#record.entries.some(e => e.shellId === shellId);
        const reason = args.detach === true ? "Detached lifetime remains native-owned; Tandem has no verified detached task-control capability."
          : shellId === null ? "No authoritative native handle is available. Tandem cannot control or infer this process outcome."
            : reused ? "Native label reused across invocations. Tandem cannot infer process control or completion from that label." : null;
        if (reused) for (const previous of this.#record.entries.filter(e => e.shellId === shellId && !ended.has(e.status))) {
          previous.controlUnbound = true;
          previous.status = "held";
          previous.reason = reason;
        }
        const entry = { id: `native:${callId}`, sessionId: this.#owner.privateSessionId, shellId,
          command: args.command, mode: args.mode ?? "sync", status: "starting", exitCode: null,
          detached: args.detach === true, controlUnbound: shellId === null || reused,
          backgroundOrigin: args.mode === "async" ? "explicit-async" : null,
          taskId: packet.binding.id, requestId: packet.binding.requestId, cycleId: packet.binding.cycleId,
          toolCallId: callId, startedAt: new Date().toISOString(), endedAt: null, reason };
        this.#record.entries.push(entry); this.#live.add(entry.id); admission.entryId = entry.id;
      });
      if (admission.taskBaseline.pending && !this.#registry.pending) admission.taskBaseline = structuredClone(this.#registry);
    } else if (name !== "list_powershell") {
      check(typeof args.shellId === "string", "Native shell handle is missing.");
      await this.#load(); await this.#tail;
      const registry = await this.#tasks();
      const task = registry.tasks?.find(task => task.type === "shell" && task.id === args.shellId);
      const entries = this.#record.entries.filter(e => e.shellId === args.shellId
        && this.#live.has(e.id) && !e.controlRetirement && !e.detached);
      const entry = task ? entries.findLast(e => nativeStart(e) && sameTask(task, e))
        : entries.length === 1 && entries[0];
      if (entry) admission.entryId = entry.id;
    }
    return admission;
  }
  async permission(admission, request) {
    if (admission.name !== "powershell") return;
    check(admission.name === "powershell" && request.kind === "shell"
      && request.fullCommandText === admission.args.command, "Native permission differs from its exact admitted command.");
    await this.#load(); await this.#tail;
    const entry = this.#record.entries.find(e => e.id === admission.entryId);
    check(entry && this.#live.has(entry.id) && !entry.controlRetirement && entry.command === admission.args.command,
      "Native permission is not owned by this live invocation.");
    await this.#workspace.inspectNativePath(this.#owner.workspacePath, { allowDirectory: true });
  }
  async settled(admission, event, approved = false) {
    check(await this.#workspace.protectedIndexDigest() === admission.indexDigest,
      "Host-owned TANDEM.md changed during native shell execution.");
    if (!admission.entryId) { await this.refreshTasks(); return; }
    const registry = await this.#tasks();
    await this.#write(() => {
      const entry = this.#record.entries.find(e => e.id === admission.entryId);
      check(entry && this.#live.has(entry.id) && !entry.controlRetirement,
        "Native completion belongs to another control generation.");
      const contents = event.data?.result?.contents ?? [];
      const nativeExits = contents.filter(c => c.type === "shell_exit");
      check(nativeExits.length <= 1 && nativeExits.every(c => nonempty(c.shellId)),
        "Native completion contains ambiguous shell exit identities.");
      const exit = nativeExits[0]
        ?? contents.find(c => c.type === "terminal" && Number.isInteger(c.exitCode));
      if (admission.name === "powershell") {
        entry.launchCompletedAt = event.timestamp;
        if (nativeExits.length) {
          check(!entry.taskBinding || nativeExits[0].shellId === entry.shellId,
            "Native launch exit differs from its exact registry binding.");
          entry.shellId = nativeExits[0].shellId;
          entry.controlUnbound = false;
        }
      } else if (nativeExits.length) check(nativeExits[0].shellId === entry.shellId,
        "Native read/stop completion names another shell.");
      check(!exit || Number.isInteger(exit.exitCode)
        && (!entry.completionNotification || entry.exitCode === exit.exitCode),
      "Native tool exit conflicts with its recorded completion notification.");
      if (exit) { entry.exitCode = exit.exitCode; entry.status = exit.exitCode === 0 ? "completed" : "failed"; }
      else if (admission.name === "stop_powershell" && event.data.success === true && !ended.has(entry.status)) {
        const content = event.data.result?.content ?? event.data.result?.textResultForLlm;
        if (content === `<command with id: ${admission.args.shellId} stopped>`) {
          entry.status = "stopped"; entry.reason = null;
        } else entry.reason = "Native stop returned no completed-stop result; current status comes from the native task registry.";
      }
      else if (admission.name === "stop_powershell" && event.data.success !== true && !ended.has(entry.status)) {
        entry.reason = "Native stop failed: the native process status is unchanged.";
      }
      else if (admission.name === "powershell" && !ended.has(entry.status)) {
        entry.status = event.data.success === true ? "running" : approved ? "held" : "failed";
        if (entry.mode === "sync" && entry.status === "running") entry.backgroundOrigin = "sync-rollover";
        if (entry.controlUnbound && entry.status === "running") entry.status = "held";
        if (!entry.detached && !entry.controlUnbound) entry.reason = entry.status === "held"
          ? "Native invocation ended without process-exit proof; explicitly stop this owned handle." : null;
      }
      if (ended.has(entry.status)) entry.endedAt ??= event.timestamp;
    });
    if (admission.name === "powershell" && event.data.success === true) {
      if (registry.pending && this.#taskRead) {
        void this.#taskRead.then(observed => this.#bindLaunch(admission, observed)).catch(error => {
          this.#failure = error; this.#tasksChanged(error.message);
        });
      } else await this.#bindLaunch(admission, this.#registry);
    }
    await this.refreshTasks();
    return structuredClone(this.#record.entries.find(entry => entry.id === admission.entryId));
  }
  async #bindLaunch(admission, registry) {
    let changed = false;
    await this.#write(() => {
      const entry = this.#record.entries.find(entry => entry.id === admission.entryId);
      if (!entry || !this.#live.has(entry.id) || entry.controlRetirement || entry.detached
        || nativeStart(entry) || ended.has(entry.status)) return;
      const candidates = !admission.taskBaseline.pending && admission.taskBaseline.tasks && registry.tasks
        ? registry.tasks.filter(task => task.type === "shell" && task.command === entry.command
        && task.attachmentMode === "attached" && timestamp(task.startedAt)
        && (!entry.shellId || task.id === entry.shellId)
        && !admission.taskBaseline.tasks.some(old => old.id === task.id && old.startedAt === task.startedAt)) : [];
      if (candidates.length !== 1 || this.#record.entries.some(other => other.id !== entry.id && other.command === entry.command
        && Date.parse(other.startedAt) <= Date.parse(entry.launchCompletedAt)
        && (!other.launchCompletedAt || Date.parse(other.launchCompletedAt) >= Date.parse(entry.startedAt)))) {
        if (entry.controlUnbound) entry.reason = `Native invocation attribution is unbound: ${
          registry.reason ?? admission.taskBaseline.reason ?? "native task mapping is pending, absent or ambiguous"}. Native tools remain available.`;
        return;
      }
      const task = candidates[0];
      entry.shellId = task.id; entry.nativeStartedAt = task.startedAt; entry.controlUnbound = false; entry.reason = null;
      entry.status = taskStatus(task);
      if (ended.has(entry.status)) entry.endedAt = task.completedAt ?? registry.observedAt;
      changed = true;
    });
    if (changed) this.#tasksChanged(null);
  }
  async observe(event) {
    const kind = event.type === "system.notification" ? event.data?.kind : null;
    if (kind?.type !== "shell_completed") return;
    check(!event.agentId && (!event.sessionId || event.sessionId === this.#owner.privateSessionId),
      "Native exit notification names a different private session.");
    await this.#load();
    const candidates = this.#record.entries.filter(e => e.shellId === kind.shellId);
    const entry = candidates.length === 1 && candidates[0];
    if (entry?.controlUnbound || entry?.detached || entry && (!this.#live.has(entry.id) || entry.controlRetirement)) return;
    if (!entry) return;
    check(kind.exitCode === undefined || Number.isInteger(kind.exitCode), "Native process exit code is invalid.");
    check(timestamp(event.timestamp), "Native exit notification timestamp is invalid.");
    check(event.id === undefined || nonempty(event.id) && event.id.length <= 512,
      "Native exit notification identity is invalid.");
    const receipt = nonempty(event.id) && Number.isInteger(kind.exitCode)
      ? { eventId: event.id, digest: policyHash(event) } : null;
    await this.#write(() => {
      check(!entry.completionNotification || receipt
        && policyHash(entry.completionNotification) === policyHash(receipt),
      "Native completion notification identity changed.");
      if (ended.has(entry.status)) {
        if (kind.exitCode === undefined) return;
        check((entry.status === "stopped" || entry.status === (kind.exitCode === 0 ? "completed" : "failed"))
          && (entry.exitCode === null || entry.exitCode === kind.exitCode),
        "Native exit notification conflicts with the exact terminal task evidence.");
        entry.exitCode = kind.exitCode;
        if (receipt) entry.completionNotification = receipt;
        return;
      }
      entry.exitCode = kind.exitCode ?? null;
      entry.status = kind.exitCode === undefined ? "held" : kind.exitCode === 0 ? "completed" : "failed";
      if (ended.has(entry.status)) entry.endedAt = event.timestamp;
      if (receipt) entry.completionNotification = receipt;
    });
  }
  async assertAutomaticOutput(notification) {
    const kind = notification.data?.kind;
    check(notification.type === "system.notification" && kind?.type === "shell_completed"
      && !notification.agentId && (!notification.sessionId || notification.sessionId === this.#owner.privateSessionId)
      && nonempty(notification.id) && Number.isInteger(kind.exitCode),
    "Automatic output needs a concrete root private-session exit notification.");
    const entry = await this.#entry(kind.shellId);
    check(entry.sessionId === this.#owner.privateSessionId && ended.has(entry.status) && entry.exitCode === kind.exitCode,
      "Automatic output does not identify a settled shell owned by this private session.");
    check(entry.completionNotification?.eventId === notification.id
      && entry.completionNotification.digest === policyHash(notification),
    "Automatic output lacks its exact recorded completion notification.");
  }
  async automaticOutputBinding(notification) {
    await this.#load(); await this.#tail;
    const entries = this.#record.entries.filter(e => e.shellId === notification.data?.kind?.shellId);
    if (entries.length !== 1 || entries[0].controlUnbound || entries[0].detached
      || !this.#live.has(entries[0].id) || entries[0].controlRetirement) return null;
    await this.assertAutomaticOutput(notification);
    return entries[0].id;
  }
  async refreshTasks(taskId) {
    await this.#load(); await this.#tail;
    const entries = this.#record.entries.filter(entry => (taskId === undefined || entry.taskId === taskId)
      && nativeStart(entry) && this.#live.has(entry.id) && !entry.controlRetirement && !ended.has(entry.status));
    if (taskId !== undefined && !entries.length) return;
    const registry = await this.#tasks();
    const updates = [];
    for (const entry of entries) {
      const task = registry.tasks?.find(task => sameTask(task, entry));
      if (task && ended.has(taskStatus(task))) {
        updates.push({ entry, patch: { status: taskStatus(task),
          endedAt: task.completedAt ?? registry.observedAt, reason: null } });
      }
    }
    if (!updates.length) return;
    await this.#write(() => {
      for (const { entry, patch } of updates) if (!ended.has(entry.status)) Object.assign(entry, patch);
    });
  }
  async pendingSync(taskId, pendingEntryIds = []) {
    await this.#load(); await this.#tail;
    if (!this.#record.entries.some(entry => entry.taskId === taskId && this.#live.has(entry.id)
      && entry.mode === "sync" && (!ended.has(entry.status) || pendingEntryIds.includes(entry.id)))) return [];
    await this.refreshTasks(taskId);
    return this.#record.entries.filter(e => !e.controlRetirement && !e.controlUnbound && !e.detached
      && e.mode === "sync" && e.taskId === taskId
      && ((!ended.has(e.status) && this.#registry.tasks?.some(task => sameTask(task, e) && task.status === "running"))
        || pendingEntryIds.includes(e.id)));
  }
  async currentTarget(admission) {
    await this.#load(); await this.#tail;
    const entry = this.#record.entries.find(entry => entry.id === admission.entryId);
    check(entry && this.#live.has(entry.id) && !entry.controlRetirement,
      "Native task has no current invocation context.");
    check(this.#taskReader, "Native task registry is unavailable for the requested interruption.");
    const registry = await this.#taskReader();
    const candidates = registry.tasks?.filter(task => task.type === "shell" && (nativeStart(entry)
      ? sameTask(task, entry) : task.command === entry.command
        && (!entry.shellId || task.id === entry.shellId)
        && admission.taskBaseline?.tasks
        && !admission.taskBaseline.tasks.some(old => old.id === task.id && old.startedAt === task.startedAt)));
    check(candidates?.length === 1 && timestamp(candidates[0].startedAt),
      "Native task cannot be associated with this interrupted invocation.");
    const task = candidates[0];
    await this.#write(() => {
      entry.shellId = task.id; entry.nativeStartedAt = task.startedAt; entry.controlUnbound = false;
    });
    return { ...entry };
  }
  async interrupted(entryId, outcome, evidence) {
    await this.#load(); await this.#tail;
    const entry = this.#record.entries.find(e => e.id === entryId);
    const task = outcome?.nativeTask;
    check(entry && this.#live.has(entryId) && entry.mode === "sync"
      && (!ended.has(entry.status) || entry.status === outcome.status)
      && task && sameTask(task, entry) && task.attachmentMode === "attached"
      && outcome.resultType === "success" && ended.has(outcome.status) && timestamp(outcome.endedAt)
      && (outcome.cancelled === true && outcome.status === "stopped"
        || ended.has(taskStatus(task)) && outcome.status === taskStatus(task))
      && nonempty(evidence?.stopId) && nonempty(evidence?.endEventId) && timestamp(evidence?.observedAt),
    "Native cancellation lacks its live invocation and native operation outcome.");
    await this.#write(() => {
      entry.status = outcome.status; entry.endedAt = outcome.endedAt;
      entry.reason = outcome.status === "stopped"
        ? "Foreground invocation interrupted by Stop now; no successful tool completion is claimed."
        : "Native finite task ended naturally while its reader was interrupted; its recorded exit code is retained, not inferred.";
      entry.interruption = { stopId: evidence.stopId, endEventId: evidence.endEventId, observedAt: evidence.observedAt,
        nativeStatus: outcome.status === "stopped" ? "cancelled" : outcome.status };
    });
  }
  async assertSettled() {
    await this.refreshTasks();
    check(this.#record.entries.every(entry => controlSettled(entry) || this.#live.has(entry.id)),
      "Historical native control authority requires canonical recovery before Close.");
    check(this.#registry.tasks !== null || !this.#record.entries.some(entry => this.#live.has(entry.id)
      && !controlSettled(entry)) && !this.#lastTasks.some(task => task.status === "running" && task.attachmentMode === "attached"),
    `Current native task status is unavailable: ${this.#registry.reason}`);
    check(!(this.#registry.tasks ?? []).some(task => task.type === "shell"
      && task.status === "running" && task.attachmentMode === "attached"),
    "Native shell work remains live. Stop the current native process before Close.");
  }
  #view(entry) {
    const live = this.#live.has(entry.id) && !entry.controlRetirement;
    return { ...entry, backgroundOrigin: entry.backgroundOrigin ?? (entry.mode === "async" ? "explicit-async" : null),
      status: !ended.has(entry.status) ? "held" : entry.status, canStop: false,
      ...(!ended.has(entry.status) ? { recordedStatus: entry.status } : {}),
      reason: entry.controlRetirement
        ? "Historical control authority retired during recovery. Process state remains unconfirmed; no exit, completion, adoption or stop is claimed."
          + (entry.controlRetirement.evidence.taskDiagnostics.state === "unavailable"
            ? ` ${entry.controlRetirement.evidence.taskDiagnostics.reason}` : "")
        : !live && !ended.has(entry.status) ? "Historical shell ownership is unverified; it will not be adopted or killed."
          : !ended.has(entry.status) ? this.#registry.reason ?? entry.reason
            ?? "No current native task is listed. The recorded outcome remains unconfirmed." : entry.reason };
  }
  #currentRows() {
    return (this.#registry.tasks ?? this.#lastTasks).filter(task => task.type === "shell").map(task => {
      const entry = this.#record.entries.findLast(entry => this.#live.has(entry.id) && !entry.controlRetirement
        && nativeStart(entry) && sameTask(task, entry));
      const id = entry?.id ?? taskViewId(task);
      if (this.#registry.tasks === null && entry && ended.has(entry.status)) return this.#view(entry);
      return { ...entry, id, sessionId: this.#owner.privateSessionId, shellId: task.id,
        nativeStartedAt: task.startedAt, command: task.command,
        status: this.#registry.tasks === null ? "held" : taskStatus(task),
        startedAt: task.startedAt, endedAt: task.completedAt, exitCode: entry?.exitCode ?? null,
        mode: entry?.mode ?? (task.executionMode === "background" ? "async" : "sync"),
        backgroundOrigin: entry?.backgroundOrigin ?? (task.executionMode === "background" ? "native-task" : null),
        taskId: entry?.taskId ?? null, requestId: entry?.requestId ?? null,
        cycleId: entry?.cycleId ?? null, toolCallId: entry?.toolCallId ?? null,
        canStop: this.#registry.tasks !== null && task.status === "running" && task.attachmentMode === "attached"
          && timestamp(task.startedAt) && !this.#stopping.has(taskViewId(task)) && Boolean(this.#stop) && Boolean(this.#canStop()),
        reason: this.#registry.pending ? "Refreshing native task status; displaying the last native observation."
          : this.#registry.reason ?? (entry?.reason?.startsWith("Native stop failed:") ? entry.reason : null) };
    });
  }
  async read() {
    await this.refreshTasks();
    const displaySettled = entry => ended.has(entry.status) || entry.controlRetirement !== undefined;
    const recent = new Set(this.#record.entries.filter(displaySettled)
      .slice(-this.#owner.policy.values.resources.reviewCollections).map(entry => entry.id));
    const current = new Map(this.#currentRows().map(entry => [entry.id, entry]));
    const sessions = this.#record.entries.filter(entry => current.has(entry.id) || !displaySettled(entry) || recent.has(entry.id))
      .map(entry => {
        const row = current.get(entry.id) ?? this.#view(entry);
        current.delete(entry.id);
        return row;
      });
    const rows = [...sessions, ...current.values()];
    const visibleSettled = new Set(rows.filter(displaySettled)
      .slice(-this.#owner.policy.values.resources.reviewCollections).map(row => row.id));
    return { ...await this.#legacy.read(), nativeSessions: rows.filter(row => !displaySettled(row) || visibleSettled.has(row.id)) };
  }
  async evidenceForCycle(cycleId) {
    await this.#load(); await this.#tail;
    return [...await this.#legacy.evidenceForCycle(cycleId),
      ...this.#record.entries.filter(e => e.cycleId === cycleId).map(e => ({ ...this.#view(e), specification: { command: e.command },
        observations: [{ taskId: e.taskId, cycleId: e.cycleId, requestId: e.requestId, toolCallId: e.toolCallId }] }))];
  }
  async stop(id) {
    check(nonempty(id), "Native process control requires an exact process identity.");
    await this.refreshTasks();
    let entry = this.#record.entries.find(e => e.id === id);
    if (!entry && !id.startsWith("native:") && !id.startsWith("native-task:")) {
      return this.#legacy.stop(id);
    }
    const target = this.#currentRows().find(row => row.id === id);
    check(target && this.#stop, "Native process identity is not a current task; historical handles cannot be stopped.");
    if (ended.has(target.status)) return target;
    const controlId = taskViewId({ id: target.shellId, startedAt: target.nativeStartedAt });
    check(!this.#stopping.has(controlId) && this.#canStop(), "The private session is unavailable or current process control is still pending.");
    check(target.canStop, "The current native task does not support this control.");
    this.#stopping.add(controlId);
    try {
      if (entry) await this.#write(() => { entry.stopRequestedAt = new Date().toISOString(); entry.stopRequestId = `native-stop-${randomUUID()}`; });
      const result = await this.#stop({ ...target,
        ...(entry?.stopRequestId ? { stopRequestId: entry.stopRequestId } : {}) });
      check(result?.resultType === "success" && ended.has(result.status) && timestamp(result.endedAt),
        "The native runtime did not confirm this process outcome.");
      entry ??= this.#record.entries.findLast(candidate => this.#live.has(candidate.id) && !candidate.controlRetirement
        && candidate.shellId === target.shellId && nativeStart(candidate) === target.nativeStartedAt);
      if (entry) await this.#write(() => {
        if (!ended.has(entry.status)) {
          entry.status = result.status; entry.endedAt = result.endedAt; entry.reason = null;
        }
      });
      return entry && ended.has(entry.status) ? this.#view(entry)
        : { ...target, status: result.status, endedAt: result.endedAt, canStop: false, reason: null };
    } catch (error) {
      if (entry) await this.#write(() => {
        if (!ended.has(entry.status)) entry.reason = `Native stop failed: ${error.message}`;
      });
      throw error;
    } finally { this.#stopping.delete(controlId); }
  }
  async cleanCloseDigest() {
    await this.assertSettled();
    const legacy = await this.#legacy.cleanCloseDigest();
    return this.#record.entries.length ? policyHash({ legacy, native: this.#record }) : legacy;
  }
  async close(options = {}) {
    try {
      await this.#tail;
      await this.#load();
      await this.#legacy.close(options);
    } finally {
      if (options.releaseStorage !== false) await this.#storage.close();
    }
  }
}
