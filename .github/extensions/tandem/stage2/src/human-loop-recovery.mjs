import { requireCondition, text } from "../runtime-src/domain/workflow/validation.ts";
import { policyHash } from "../runtime-src/domain/workflow/policy.ts";
import { durableNativeEvent, nativeCloseEvents, observedNativeCloseEvent, requireNativeCloseEvent, requireNativeHistoryOrder,
  parseNativeClose, nativeExecutionEvent } from "./human-loop-close.mjs";
import { parseHumanTask, nativeUserEvidence, humanInputEnvelope } from "./human-loop-task.mjs";

export async function verifyNativeSessionAbsent(client, sessionId) {
  requireCondition(typeof client.start === "function" && typeof client.getSessionMetadata === "function",
    "Initial setup recovery requires authoritative native session lookup.");
  await client.start();
  requireCondition(typeof client.rpc?.sessions?.checkInUse === "function"
    && typeof client.rpc.sessions.getSizes === "function",
  "Initial setup recovery requires native in-use and persisted-storage inventory APIs.");
  requireCondition(await client.getSessionMetadata(sessionId) === undefined,
    "The reserved private session exists or its metadata is indeterminate; no session was created.");
  const active = await client.rpc.sessions.checkInUse({ sessionIds: [sessionId] });
  requireCondition(active && typeof active === "object" && Object.keys(active).length === 1
    && Array.isArray(active.inUse) && active.inUse.length === 0,
    "The reserved private identity is active or its ownership is unverified; no session was created.");
  const inventory = await client.rpc.sessions.getSizes();
  requireCondition(inventory && typeof inventory === "object" && Object.keys(inventory).length === 1
    && inventory.sizes && typeof inventory.sizes === "object" && !Array.isArray(inventory.sizes)
    && Object.values(inventory.sizes).every(bytes => Number.isSafeInteger(bytes) && bytes >= 0)
    && !Object.hasOwn(inventory.sizes, sessionId),
  "The reserved private identity has retained native storage or its history is indeterminate; no session was created.");
  requireCondition(await client.getSessionMetadata(sessionId) === undefined,
    "Native session metadata changed during absence verification; no session was created.");
  return { sessionId, metadata: "not-found", inUse: [], storage: "not-found" };
}

export async function readRecoveryHistory(client, sessionId, { allowEmpty = false } = {}) {
  requireCondition(typeof client.rpc?.sessions?.readPersistedEvents === "function",
    "The installed SDK cannot read saved native history.");
  const history = [], ids = new Set(), cursors = new Set();
  let cursor;
  for (;;) {
    const page = await client.rpc.sessions.readPersistedEvents({ sessionId, ...(cursor ? { cursor } : {}), max: 200 });
    requireCondition(page?.cursorStatus === "ok" && Array.isArray(page.events) && typeof page.hasMore === "boolean",
      "Saved native history is unavailable or its pinned snapshot expired.");
    for (const event of page.events) {
      text(event?.id); text(event?.type);
      requireCondition(!ids.has(event.id), "Retained history contains duplicate event identities.");
      ids.add(event.id); history.push(event);
    }
    if (!page.hasMore) break;
    cursor = text(page.cursor);
    requireCondition(!cursors.has(cursor), "Retained history cursor did not advance.");
    cursors.add(cursor);
  }
  requireCondition(allowEmpty || history.length > 0, "The retained native session history is empty; no replacement was created.");
  return history;
}

export function recoveryNativeEvidence(sessionId, history, cleanNativeProof = null) {
  const originals = new Map(history.map((event) => [event.id, event]));
  const proof = cleanNativeProof ? parseNativeClose(cleanNativeProof) : null;
  requireCondition(!proof || proof.sessionId === sessionId && proof.flushed,
    "Recovery history belongs to another or unflushed clean-close proof.");
  const anchors = new Map(proof?.events.map(event => [event.id, event]) ?? []);
  const events = nativeCloseEvents(history).map((event) => {
    const original = originals.get(event.id), anchor = anchors.get(event.id);
    if (anchor) {
      requireNativeCloseEvent(original, anchor, "recovery-evidence", "Retained native history changed while binding recovery evidence.", "persisted");
      return anchor;
    }
    return { ...observedNativeCloseEvent(original), parentIds: event.parentIds };
  });
  const users = history.filter(({ type, agentId }) => type === "user.message" && !agentId).map(nativeUserEvidence);
  return { sessionId, events, users, digest: policyHash(events) };
}

export function validateRecoveryHistory(history, evidence, stage = "recovery-history") {
  requireCondition(Array.isArray(history), "Native history is unavailable after recovery.");
  const expected = new Map(evidence.events.map((event) => [event.id, event]));
  const ids = new Set(), retained = [];
  for (const event of history) {
    text(event?.id); text(event?.type);
    requireCondition(!ids.has(event.id), "Reopened native history contains duplicate identities.");
    ids.add(event.id);
    if (!durableNativeEvent(event)) continue;
    const previous = expected.get(event.id);
    if (previous) {
      requireNativeCloseEvent(event, previous, stage, "Retained native history changed during recovery.", "sdk");
      retained.push(event.id);
    } else requireCondition(!nativeExecutionEvent(event.type), "Unexpected execution appeared during recovery.");
  }
  const complete = evidence.events.every(({ id }) => ids.has(id));
  if (complete) requireNativeHistoryOrder(retained, evidence.events.map(({ id }) => id), stage);
  return complete;
}

export function recoveryReadinessSnapshot(sessionId, history) {
  requireCondition(Array.isArray(history), "The current native history API returned an invalid snapshot.");
  const identified = history.filter(event => event && typeof event.id === "string" && event.id
    && typeof event.type === "string" && event.type);
  const unique = [...new Map(identified.map(event => [event.id, event])).values()];
  const events = unique.filter(durableNativeEvent).map(event => observedNativeCloseEvent(event));
  const users = unique.filter(event => event.type === "user.message" && !event.agentId).map(nativeUserEvidence);
  return { sessionId, events, users, digest: policyHash(events) };
}

export async function retainRecoveryMessages(store, state, history, diagnose) {
  const originals = new Map((await store.messages()).map((entry) => [entry.id, entry]));
  const stops = [...state.stops, ...(state.stop ? [state.stop] : []),
    ...(state.recoveries ?? []).flatMap(({ stop }) => stop ? [stop] : [])];
  const executions = [...state.executions, ...(state.activeTask ? [state.activeTask] : [])];
  let execution = null;
  for (const event of history) {
    if (!event || typeof event !== "object") continue;
    if (event.agentId) continue;
    if (event.type === "user.message") {
      if (event.data?.isAutopilotContinuation) await diagnose("historical-input",
        "Historical synthetic input was retained, not adopted as a new request.");
      execution = executions.find((task) => task.messageId && task.messageId === event.data?.messageId
        || task.interactionId && task.interactionId === event.data?.interactionId) ?? null;
      if (!execution && typeof event.data?.content === "string") {
        execution = executions.find(task => task.inputs?.some(input => {
          try {
            const envelope = humanInputEnvelope(event.data.content, event.data.attachments, input.kind);
            return envelope.promptDigest === input.promptDigest && envelope.promptBytes === input.promptBytes
              && envelope.attachmentsDigest === input.attachmentsDigest;
          } catch { return false; }
        })) ?? null;
      }
      const stop = stops.find(({ injection }) => injection?.messageId === event.data?.messageId);
      if (stop) execution = executions.find(({ binding }) => binding.id === stop.taskId) ?? null;
      if (!execution) {
        let packet;
        try { packet = parseHumanTask(JSON.parse(String(event.data?.content ?? "").split("\n").at(-1))); }
        catch { packet = null; }
        execution = packet ? executions.find(({ binding }) => policyHash(binding) === policyHash(packet.binding)) ?? null : null;
        if (!execution) await diagnose("historical-input", "Retained native input has no durably admitted task; no old work was adopted.");
      }
    }
    if (event.type !== "assistant.message" || typeof event.data?.content !== "string" || !event.data.content.trim()) continue;
    if (typeof event.id !== "string" || !event.id || !Number.isFinite(Date.parse(event.timestamp))) {
      await diagnose("historical-message", "A historical message lacks a usable identity or timestamp; its native record was not changed.");
      continue;
    }
    const id = `native:${event.id}`, original = originals.get(id);
    if (original) {
      if (original.content !== event.data.content || original.timestamp !== event.timestamp) await diagnose("conversation-conflict",
        "Retained Conversation differs from native history. The existing exact message was preserved.");
      continue;
    }
    await store.recordMessage({ id, role: execution?.binding.role ?? "assistant",
      requestId: execution?.binding.requestId ?? null, kind: "assistant",
      content: event.data.content, timestamp: text(event.timestamp) });
  }
}
