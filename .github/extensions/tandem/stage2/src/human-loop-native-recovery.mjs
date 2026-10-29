import { parseOwnedQueue } from "../runtime-src/domain/workflow/owned-execution-primitives.ts";
import { requireCondition as check } from "../runtime-src/domain/workflow/validation.ts";

const keys = (value, expected) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).sort().join(",") === expected.split(",").sort().join(",");
const text = value => typeof value === "string" && value.length > 0;
const timestamp = value => text(value) && Number.isFinite(Date.parse(value));
const digest = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const generation = value => keys(value, "writerId,instanceId") && digest(value.writerId)
  && typeof value.instanceId === "string" && /^[a-f0-9-]{36}$/.test(value.instanceId);
const validTasks = (tasks, maximum, observedAt) => Array.isArray(tasks) && tasks.length <= maximum
  && tasks.every(task => keys(task, "id,type,status,startedAt,completedAt")
    && text(task.id) && ["shell", "agent"].includes(task.type)
    && ["completed", "failed", "cancelled"].includes(task.status)
    && (task.startedAt === null || timestamp(task.startedAt))
    && (task.completedAt === null || timestamp(task.completedAt))
    && (task.completedAt === null || Date.parse(task.completedAt) <= Date.parse(observedAt))
    && (task.startedAt === null || task.completedAt === null || Date.parse(task.completedAt) >= Date.parse(task.startedAt)))
  && new Set(tasks.map(task => task.id)).size === tasks.length;
const unavailable = reason => ({ tasks: null, taskDiagnostics: { state: "unavailable", reason } });

async function observeTasks(session, maximumTasks, maximumMs) {
  if (typeof session.rpc?.tasks?.list !== "function") return unavailable("SDK task diagnostics are unavailable.");
  let timer;
  const diagnostic = await Promise.race([
    Promise.resolve().then(() => session.rpc.tasks.list()).then(
      listed => ({ listed }),
      error => unavailable(`Task diagnostics failed: ${String(error?.message ?? error).replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 300)}`)),
    new Promise(resolve => { timer = setTimeout(() => resolve(unavailable("Task diagnostics timed out; historical outcomes remain unknown.")), maximumMs); }),
  ]).finally(() => clearTimeout(timer));
  if (diagnostic.taskDiagnostics) return diagnostic;
  const tasks = diagnostic.listed?.tasks;
  check(!Array.isArray(tasks) || !tasks.slice(0, maximumTasks).some(task =>
    text(task?.id) && ["running", "idle"].includes(task?.status)),
  "The current native registry reports active work; recovery cannot adopt or interrupt it.");
  const observedAt = new Date().toISOString();
  const projected = Array.isArray(tasks) && tasks.length <= maximumTasks
    ? tasks.map(task => ({ id: task?.id, type: task?.type, status: task?.status,
      startedAt: task?.startedAt ?? null, completedAt: task?.completedAt ?? null })) : null;
  if (!validTasks(projected, maximumTasks, observedAt)) {
    return unavailable("Task diagnostics are incomplete, ambiguous, or exceed their observation bound.");
  }
  return { tasks: projected, taskDiagnostics: { state: "observed", reason: null } };
}

export function validateNativeControlEvidence(value, sessionId, historyDigest, maximumTasks) {
  check(keys(value, "schemaVersion,sessionId,historyDigest,observedAt,mode,processing,hasActiveWork,queue,tasks,taskDiagnostics,registryScope")
    && value.schemaVersion === "native-control-evidence/v1" && value.sessionId === sessionId
    && digest(value.historyDigest) && value.historyDigest === historyDigest && timestamp(value.observedAt)
    && value.registryScope === "current-runtime-not-process-exit-proof"
    && value.mode === "interactive" && value.processing === false && value.hasActiveWork === false
    && keys(value.queue, "items,steeringMessages,inFlightSteeringCount")
    && value.queue.items === 0 && value.queue.steeringMessages === 0
    && (value.queue.inFlightSteeringCount === 0 || value.queue.inFlightSteeringCount === null),
  "Historical native control retirement requires exact same-session history and current foreground/queue admission evidence.");
  check(keys(value.taskDiagnostics, "state,reason")
    && (value.taskDiagnostics.state === "unavailable" && text(value.taskDiagnostics.reason)
      && value.taskDiagnostics.reason.length <= 400 && value.tasks === null
      || value.taskDiagnostics.state === "observed" && value.taskDiagnostics.reason === null
        && validTasks(value.tasks, maximumTasks, value.observedAt)),
  "Native recovery task observation is invalid or conceals unknown/current work.");
  return value;
}

/** Observes only the resumed registry; absence never establishes an old process's termination. */
export async function captureNativeControlEvidence(session, history, verify, maximumTasks, maximumMs = 5000) {
  check(session?.sessionId === history.sessionId, "Native recovery diagnostics belong to another session.");
  check(Number.isSafeInteger(maximumMs) && maximumMs > 0 && maximumMs <= 5000, "Invalid native diagnostic observation bound.");
  await verify();
  const diagnostic = await observeTasks(session, maximumTasks, maximumMs);
  const [mode, processing, activity, queue] = await Promise.all([
    session.rpc.mode.get(), session.rpc.metadata.isProcessing(),
    session.rpc.metadata.activity(), session.rpc.queue.pendingItems(),
  ]);
  const items = parseOwnedQueue(queue);
  const evidence = {
    schemaVersion: "native-control-evidence/v1", sessionId: session.sessionId, historyDigest: history.digest,
    observedAt: new Date().toISOString(), registryScope: "current-runtime-not-process-exit-proof",
    mode, processing: processing?.processing, hasActiveWork: activity?.hasActiveWork,
    queue: { items: items.length, steeringMessages: queue.steeringMessages.length,
      inFlightSteeringCount: queue.inFlightSteeringCount ?? null },
    ...diagnostic,
  };
  validateNativeControlEvidence(evidence, history.sessionId, history.digest, maximumTasks);
  await verify();
  return evidence;
}

export function validateControlRetirement(value, sessionId, maximumTasks) {
  check(keys(value, "schemaVersion,outcome,recoveryId,previousGeneration,generation,evidence")
    && value.schemaVersion === "native-control-retirement/v1"
    && value.outcome === "authority-retired-process-state-unconfirmed" && text(value.recoveryId)
    && keys(value.previousGeneration, "journalDigest,writerClaim,legacyLockDigest")
    && digest(value.previousGeneration.journalDigest)
    && (value.previousGeneration.writerClaim === null || generation(value.previousGeneration.writerClaim))
    && (value.previousGeneration.legacyLockDigest === null || digest(value.previousGeneration.legacyLockDigest))
    && generation(value.generation)
    && value.previousGeneration.writerClaim?.instanceId !== value.generation.instanceId,
  "Native control retirement provenance is invalid.");
  validateNativeControlEvidence(value.evidence, sessionId, value.evidence?.historyDigest, maximumTasks);
  return true;
}
