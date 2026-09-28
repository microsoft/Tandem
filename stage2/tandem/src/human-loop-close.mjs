import { createHash } from "node:crypto";
import { policyHash } from "../runtime-src/domain/workflow/policy.ts";
import { object, text, list, unique, requireCondition } from "../runtime-src/domain/workflow/validation.ts";
import { digest, parseDesignBinding, parseSnapshotRef } from "../runtime-src/domain/human-loop/contracts.ts";
import { requireHumanQuiescence } from "../runtime-src/domain/human-loop/model.ts";

export const durableNativeEvent = (event) => event.ephemeral !== true && event.type !== "system.message"
  && !["assistant.idle", "session.idle"].includes(event.type) && !event.type.endsWith("_delta");
export const nativeExecutionEvent = (type) => ["user.message", "abort", "session.error"].includes(type) || type.startsWith("assistant.")
  || type.startsWith("tool.") || type.startsWith("external_tool.") || type.startsWith("permission.") || type.startsWith("subagent.");
export const nativeEventDigest = (event) => policyHash({
  id: event.id, type: event.type, timestamp: event.timestamp,
  agentId: event.agentId ?? null, data: event.data,
});
const preHookElision = (field, value) =>
  `[copilot:elided ${field} (${Buffer.byteLength(value, "utf8")} bytes) — pre-hook tool result; the final result may differ, see the adjacent tool.execution_complete event]`;
function duplicatePreHookHistory(event) {
  if (event.type !== "hook.start" || event.data?.hookType !== "postToolUse") return null;
  const result = event.data?.input?.toolResult;
  let replacement = null;
  for (const field of ["textResultForLlm", "sessionLog"]) {
    if (typeof result?.[field] !== "string") continue;
    const match = /^\[copilot:elided (textResultForLlm|sessionLog) \((0|[1-9]\d*) bytes\) - duplicated pre-hook tool-result field; canonical data remains in adjacent tool and skill events\]$/.exec(result[field]);
    if (!match || match[1] !== field) continue;
    replacement ??= { ...result };
    replacement[field] = `[copilot:elided ${field} (${match[2]} bytes) — pre-hook tool result; the final result may differ, see the adjacent tool.execution_complete event]`;
  }
  return replacement ? { ...event, data: { ...event.data, input: { ...event.data.input, toolResult: replacement } } } : null;
}
function matchesObservedPreHookDigest(hash, expected) {
  return hash === expected.allowedHistoryDigest || hash === expected.allowedTextHistoryDigest
    || expected.allowedShellExitElisionHistoryDigests?.includes(hash) === true
    || expected.allowedSessionLogHistoryDigests?.includes(hash) === true;
}
function internedImages(values, type) {
  if (!Array.isArray(values)) return null;
  let changed = false;
  const attachments = values.map((attachment) => {
    if (attachment?.type !== type || !["image/png", "image/jpeg"].includes(attachment.mimeType)
      || typeof attachment.data !== "string" || !attachment.data.length || attachment.data.length > 6 * 1024 * 1024
      || attachment.omittedReason !== undefined) return attachment;
    const bytes = Buffer.from(attachment.data, "base64");
    if (bytes.toString("base64") !== attachment.data) return attachment;
    const assetId = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    if (attachment.assetId !== undefined && attachment.assetId !== assetId
      || attachment.byteLength !== undefined && attachment.byteLength !== bytes.length) return attachment;
    changed = true;
    const { data, ...metadata } = attachment;
    return { ...metadata, assetId, byteLength: bytes.length };
  });
  return changed ? attachments : null;
}
function internedNativeImages(event) {
  if (event.type === "user.message") {
    const attachments = internedImages(event.data?.attachments, "blob");
    return attachments ? { ...event, data: { ...event.data, attachments } } : null;
  }
  if (event.type === "tool.execution_complete") {
    const binaryResultsForLlm = internedImages(event.data?.result?.binaryResultsForLlm, "image");
    return binaryResultsForLlm ? { ...event, data: { ...event.data,
      result: { ...event.data.result, binaryResultsForLlm } } } : null;
  }
  if (event.type === "hook.start" && event.data?.hookType === "postToolUse") {
    const binaryResultsForLlm = internedImages(event.data?.input?.toolResult?.binaryResultsForLlm, "image");
    return binaryResultsForLlm ? { ...event, data: { ...event.data, input: { ...event.data.input,
      toolResult: { ...event.data.input.toolResult, binaryResultsForLlm } } } } : null;
  }
  return null;
}
function emptyOutputShellExit(input, exit) {
  return input?.toolName === "powershell" && input.toolArgs?.mode === "sync"
    && input.toolResult?.resultType === "success" && exit?.exitCode === 0
    && exit.cwd === input.cwd && !Object.hasOwn(exit, "outputPreview") && Object.keys(exit).length === 4
    && input.toolResult.textResultForLlm === `\n<shellId: ${exit.shellId} completed with exit code 0>`
    && input.toolResult.sessionLog === input.toolResult.textResultForLlm;
}
export function observedNativeCloseEvent(event) {
  const entry = { id: event.id, type: event.type, digest: nativeEventDigest(event), parentIds: [event.parentId ?? null] };
  const interned = internedNativeImages(event);
  // SDK history interns user, final-result and postToolUse-input images by exact SHA-256/length.
  if (interned) entry.allowedHistoryDigest = nativeEventDigest(interned);
  const value = event.data?.input?.toolResult?.textResultForLlm;
  if (event.type === "hook.start" && event.data?.hookType === "postToolUse" && typeof value === "string") {
    // RPC history elides this pre-hook copy; final tool results remain fully hashed.
    // Short pre-hook text can remain inline even when its images are interned.
    if (interned) entry.allowedImageHistoryDigest = entry.allowedHistoryDigest;
    const text = preHookElision("textResultForLlm", value);
    // Preserve the previously accepted text-only transform with exact inline image bytes.
    if (interned) entry.allowedTextHistoryDigest = nativeEventDigest({ ...event, data: { ...event.data,
      input: { ...event.data.input, toolResult: { ...event.data.input.toolResult, textResultForLlm: text } } } });
    const history = interned ?? event;
    entry.allowedHistoryDigest = nativeEventDigest({ ...history, data: { ...history.data,
      input: { ...history.data.input, toolResult: { ...history.data.input.toolResult, textResultForLlm: text } } } });
  }
  const sessionLog = event.data?.input?.toolResult?.sessionLog;
  if (event.type === "hook.start" && event.data?.hookType === "postToolUse" && typeof sessionLog === "string") {
    // Native file tools also elide the independent pre-hook UI log, using its exact UTF-8 length.
    const variants = interned ? [event, interned] : [event];
    if (typeof value === "string") for (const variant of [...variants]) {
      variants.push({ ...variant, data: { ...variant.data, input: { ...variant.data.input,
        toolResult: { ...variant.data.input.toolResult, textResultForLlm: preHookElision("textResultForLlm", value) } } } });
    }
    entry.allowedSessionLogHistoryDigests = [...new Set(variants.map(variant => nativeEventDigest({
      ...variant, data: { ...variant.data, input: { ...variant.data.input,
        toolResult: { ...variant.data.input.toolResult, sessionLog: preHookElision("sessionLog", sessionLog) } } },
    })))];
  }
  if (event.type === "external_tool.requested" && typeof event.data?.traceparent === "string"
    && /^00-(?!0{32}-)[a-f0-9]{32}-(?!0{16}-)[a-f0-9]{16}-[a-f0-9]{2}$/.test(event.data.traceparent)) {
    // SDK history omits callback-only tracing; execution identity and arguments remain exact.
    const { traceparent, ...data } = event.data;
    entry.allowedHistoryDigest = nativeEventDigest({ ...event, data });
  }
  const input = event.data?.input, contents = input?.toolResult?.contents, exit = contents?.[0];
  const emptyOutputExit = emptyOutputShellExit(input, exit);
  if (event.type === "hook.start" && event.data?.hookType === "postToolUse" && ["powershell", "read_powershell"].includes(input?.toolName)
    && Array.isArray(contents) && contents.length === 1 && exit?.type === "shell_exit"
    && typeof exit.shellId === "string" && exit.shellId === input.toolArgs?.shellId
    && Number.isInteger(exit.exitCode) && typeof exit.cwd === "string"
    && (typeof exit.outputPreview === "string" && Object.keys(exit).length === 5 || emptyOutputExit)) {
    // Empty successful sync output has the same DTO without outputPreview.
    // Only the pre-hook copy is omitted; final results remain fully hashed.
    const { contents: omitted, ...toolResult } = input.toolResult;
    entry.allowedShellExitHistoryDigest = nativeEventDigest({ ...event, data: { ...event.data,
      input: { ...input, toolResult } } });
    if (!emptyOutputExit) {
      const variants = [toolResult];
      for (const field of ["textResultForLlm", "sessionLog"]) if (typeof toolResult[field] === "string") {
        for (const variant of [...variants]) variants.push({
          ...variant, [field]: preHookElision(field, toolResult[field]),
        });
      }
      // History can independently elide both strings while omitting the same validated preview.
      entry.allowedShellExitElisionHistoryDigests = variants.slice(1).map(result =>
        nativeEventDigest({ ...event, data: { ...event.data, input: { ...input, toolResult: result } } }));
    }
  }
  return entry;
}
export function matchesNativeCloseEvent(event, expected, boundary = "persisted") {
  requireCondition(boundary === "persisted" || boundary === "sdk", "Unknown native history comparison boundary.");
  const hash = nativeEventDigest(event);
  const interned = internedNativeImages(event);
  // The SDK has two exact elision wordings. Only observed byte-length alternatives
  // authorize this representation change; a sealed/reopened history stays exact.
  const duplicate = duplicatePreHookHistory(event);
  return event.type === expected.type && (hash === expected.digest || matchesObservedPreHookDigest(hash, expected)
    || hash === expected.allowedImageHistoryDigest
    || hash === expected.allowedShellExitHistoryDigest
    || hash === expected.allowedColdShellResultDigest
    || hash === expected.allowedColdDuplicateResultDigest
    || boundary === "sdk" && hash === expected.allowedColdAssistantOpaqueDigest
    || duplicate !== null && matchesObservedPreHookDigest(nativeEventDigest(duplicate), expected)
    || interned !== null && nativeEventDigest(interned) === expected.digest)
    && expected.parentIds.includes(event.parentId ?? null);
}

export function nativeCloseMismatch(event, expected, boundary = "persisted") {
  if (event && matchesNativeCloseEvent(event, expected, boundary)) return null;
  return {
    category: !event ? "missing" : event.id !== expected.id ? "identity"
      : event.type !== expected.type ? "type"
        : !expected.parentIds.includes(event.parentId ?? null) ? "ancestry" : "digest",
    id: expected.id, type: expected.type, expectedDigest: expected.digest,
    allowedHistoryDigest: expected.allowedHistoryDigest ?? null,
    allowedImageHistoryDigest: expected.allowedImageHistoryDigest ?? null,
    allowedTextHistoryDigest: expected.allowedTextHistoryDigest ?? null,
    allowedShellExitHistoryDigest: expected.allowedShellExitHistoryDigest ?? null,
    allowedShellExitElisionHistoryDigests: expected.allowedShellExitElisionHistoryDigests ?? null,
    allowedColdShellResultDigest: expected.allowedColdShellResultDigest ?? null,
    allowedColdDuplicateResultDigest: expected.allowedColdDuplicateResultDigest ?? null,
    allowedColdAssistantOpaqueDigest: expected.allowedColdAssistantOpaqueDigest ?? null,
    allowedSessionLogHistoryDigests: expected.allowedSessionLogHistoryDigests ?? null,
    actualId: event?.id ?? null, actualType: event?.type ?? null,
    actualDigest: event ? nativeEventDigest(event) : null,
    expectedParentIds: expected.parentIds, actualParentId: event?.parentId ?? null,
  };
}

export function requireNativeCloseEvent(event, expected, stage, message, boundary = "persisted") {
  const mismatch = nativeCloseMismatch(event, expected, boundary);
  requireCondition(!mismatch, `${message} ${JSON.stringify({ stage, boundary, ...mismatch })}`);
}

export function requireNativeHistoryOrder(retained, expected, stage) {
  const index = expected.findIndex((id, position) => retained[position] !== id);
  requireCondition(index < 0, `Retained native history order changed. ${JSON.stringify({
    stage, category: "order", index, expectedId: expected[index] ?? null, actualId: retained[index] ?? null,
  })}`);
}

function redundantShellResult(content, exit) {
  const marker = `<shellId: ${exit.shellId} completed with exit code ${exit.exitCode}>`;
  if (content === `${exit.outputPreview}${marker}`) return true;
  if (typeof content !== "string" || !content.endsWith(marker)) return false;
  const prefix = content.slice(0, -marker.length);
  // Captured native output also has exactly one extra preview LF after a single retained LF.
  return prefix.endsWith("\n") && !prefix.endsWith("\n\n") && !prefix.endsWith("\r\n")
    && exit.outputPreview === `${prefix}\n`;
}

function jsonMetadata(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return Array.from(value).every(jsonMetadata);
  return typeof value === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(value))
    && Object.values(value).every(jsonMetadata);
}

function assistantOpaqueProjection(event) {
  const data = event.data;
  if (event.type !== "assistant.message" || typeof data?.messageId !== "string" || !data.messageId
    || typeof data.content !== "string") return null;
  const fields = ["reasoningOpaque", "encryptedContent", "reasoningBlocks"].filter(key => Object.hasOwn(data, key));
  if (!fields.length) return null;
  for (const key of fields) {
    if (key !== "reasoningBlocks") {
      if (typeof data[key] !== "string") return null;
      continue;
    }
    const value = data[key];
    if (!value || Array.isArray(value) || !jsonMetadata(value) || typeof value.provider !== "string"
      || Object.keys(value).some(key => !["provider", "blocks"].includes(key))
      || Object.hasOwn(value, "blocks") && !Array.isArray(value.blocks)) return null;
  }
  const { reasoningOpaque, encryptedContent, reasoningBlocks, ...retained } = data;
  return { ...event, data: retained };
}

export function nativeCloseEvents(history, anchors = new Map()) {
  const byId = new Map(history.map((event) => [event.id, event]));
  const starts = new Map();
  for (const event of history) if (event.type === "tool.execution_start") {
    const id = event.data?.toolCallId;
    starts.set(id, starts.has(id) ? null : event);
  }
  return history.filter(durableNativeEvent).map((event) => {
    const original = event.parentId ?? null, visited = new Set();
    let parent = original;
    // The SDK omits rebuilt system messages and relinks their children on resume.
    while (parent && byId.get(parent)?.type === "system.message") {
      requireCondition(!visited.has(parent), "Native system-message ancestry is cyclic.");
      visited.add(parent); parent = byId.get(parent).parentId ?? null;
    }
    const entry = { id: event.id, type: event.type, digest: nativeEventDigest(event), parentIds: [...new Set([original, parent])] };
    const anchor = anchors.get(event.id);
    if (anchor && (entry.digest === anchor.digest || anchor.allowedColdDuplicateResultDigest
      || anchor.allowedColdShellResultDigest || anchor.allowedColdAssistantOpaqueDigest)) {
      requireNativeCloseEvent(event, anchor, "seal-retention", "Retained native history changed while sealing.", "sdk");
      return { id: anchor.id, type: anchor.type, digest: anchor.digest, parentIds: [...anchor.parentIds],
        ...(anchor.allowedColdDuplicateResultDigest ? { allowedColdDuplicateResultDigest: anchor.allowedColdDuplicateResultDigest } : {}),
        ...(anchor.allowedColdAssistantOpaqueDigest ? { allowedColdAssistantOpaqueDigest: anchor.allowedColdAssistantOpaqueDigest } : {}),
        ...(anchor.allowedColdShellResultDigest ? { allowedColdShellResultDigest: anchor.allowedColdShellResultDigest } : {}) };
    }
    const assistant = assistantOpaqueProjection(event);
    // The SDK strips this bounded session-bound container on resume, not from disk.
    if (assistant) entry.allowedColdAssistantOpaqueDigest = nativeEventDigest(assistant);
    const start = starts.get(event.data?.toolCallId), result = event.data?.result, exit = result?.contents?.[0];
    const boundFinal = event.type === "tool.execution_complete" && event.data.success === true
      && typeof event.data.toolCallId === "string" && event.data.toolCallId.length > 0
      && typeof start?.data?.toolName === "string" && start.data.toolName.length > 0
      && (start.agentId ?? null) === (event.agentId ?? null) && history.indexOf(start) < history.indexOf(event);
    let duplicateResult = boundFinal && typeof result?.content === "string"
      && result.content === result.detailedContent && Object.keys(result).length === 2 ? result : null;
    if (event.type === "tool.execution_complete" && event.data.success === true && ["powershell", "read_powershell"].includes(start?.data?.toolName)
      && typeof start.data.arguments?.shellId === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(start.data.arguments.shellId)
      && Array.isArray(result?.contents) && result.contents.length === 1 && exit?.type === "shell_exit"
      && exit.shellId === start.data.arguments.shellId && Number.isInteger(exit.exitCode)
      && typeof exit.cwd === "string" && typeof exit.outputPreview === "string" && Object.keys(exit).length === 5
      && Object.keys(result).length === 3 && result.content === result.detailedContent
      && redundantShellResult(result.content, exit)) {
      // Cold history omits this redundant native exit DTO. Bind the alternative to its
      // exact invocation and bounded redundant exit text; every other result/event byte stays hashed.
      const { contents, ...retained } = result;
      entry.allowedColdShellResultDigest = nativeEventDigest({ ...event, data: { ...event.data, result: retained } });
    }
    if (boundFinal && start.data.toolName === "powershell" && start.data.arguments?.mode === "sync"
      && typeof start.data.arguments.shellId === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(start.data.arguments.shellId)
      && Array.isArray(result?.contents) && result.contents.length === 1 && exit?.type === "shell_exit"
      && exit.shellId === start.data.arguments.shellId && typeof exit.cwd === "string"
      && Object.keys(result).length === 3 && typeof result.content === "string" && result.content === result.detailedContent) {
      const hooks = history.slice(history.indexOf(start) + 1, history.indexOf(event)).filter(candidate =>
        candidate.type === "hook.start" && candidate.data?.hookType === "postToolUse"
        && (candidate.agentId ?? null) === (event.agentId ?? null)
        && candidate.data.input?.toolName === start.data.toolName
        && policyHash(candidate.data.input.toolArgs) === policyHash(start.data.arguments));
      if (hooks.length === 1 && emptyOutputShellExit(hooks[0].data.input, exit)
        && result.content === hooks[0].data.input.toolResult.textResultForLlm) {
        const { contents, ...retained } = result;
        duplicateResult = retained;
      }
    }
    if (duplicateResult) {
      // Record the SDK's lossless duplicate-text omission only at seal creation.
      // Readers compare this recorded hash, never manufacture allowances for old seals.
      const { detailedContent, ...retained } = duplicateResult;
      entry.allowedColdDuplicateResultDigest = nativeEventDigest({ ...event, data: { ...event.data, result: retained } });
    }
    return entry;
  });
}

export function parseNativeClose(value) {
  if (value?.schemaVersion === "human-loop-native-close/v2") {
    const data = object(value, ["schemaVersion", "sessionId", "saved", "closed", "warnings"]);
    requireCondition(typeof data.saved === "boolean" && data.closed === true, "Native shutdown has not succeeded.");
    return { schemaVersion: data.schemaVersion, sessionId: text(data.sessionId), saved: data.saved, closed: true,
      warnings: list(data.warnings, text) };
  }
  const data = object(value, ["schemaVersion", "sessionId", "flushed", "events", "users"]);
  requireCondition(data.schemaVersion === "human-loop-native-close/v1" && typeof data.flushed === "boolean",
    "Missing or incompatible native clean-close proof.");
  const events = list(data.events, (value) => {
    const event = object(value, ["id", "type", "digest", "parentIds",
      ...(value && Object.hasOwn(value, "allowedColdShellResultDigest") ? ["allowedColdShellResultDigest"] : []),
      ...(value && Object.hasOwn(value, "allowedColdDuplicateResultDigest") ? ["allowedColdDuplicateResultDigest"] : []),
      ...(value && Object.hasOwn(value, "allowedColdAssistantOpaqueDigest") ? ["allowedColdAssistantOpaqueDigest"] : [])]);
    const parentIds = list(event.parentIds, (value) => value === null ? null : text(value));
    requireCondition(parentIds.length >= 1 && parentIds.length <= 2 && new Set(parentIds).size === parentIds.length,
      "Native history has invalid parent bindings.");
    const parsed = { id: text(event.id), type: text(event.type), digest: digest(event.digest), parentIds };
    if (event.allowedColdShellResultDigest !== undefined) {
      requireCondition(parsed.type === "tool.execution_complete", "Cold shell result alternative targets another event type.");
      parsed.allowedColdShellResultDigest = digest(event.allowedColdShellResultDigest);
    }
    if (event.allowedColdDuplicateResultDigest !== undefined) {
      requireCondition(parsed.type === "tool.execution_complete", "Cold duplicate result alternative targets another event type.");
      parsed.allowedColdDuplicateResultDigest = digest(event.allowedColdDuplicateResultDigest);
    }
    if (event.allowedColdAssistantOpaqueDigest !== undefined) {
      requireCondition(parsed.type === "assistant.message", "Cold assistant projection targets another event type.");
      parsed.allowedColdAssistantOpaqueDigest = digest(event.allowedColdAssistantOpaqueDigest);
    }
    return parsed;
  });
  const users = list(data.users, (value) => {
    const user = object(value, ["id", "messageId", "turnId", "interactionId"]);
    return { id: text(user.id), messageId: text(user.messageId), turnId: text(user.turnId), interactionId: text(user.interactionId) };
  });
  unique(events.map(({ id }) => id)); unique(users.map(({ id }) => id)); unique(users.map(({ messageId }) => messageId));
  requireCondition(users.every((user) => events.some((event) => event.id === user.id && event.type === "user.message")),
    "Native close has unbound user history.");
  return { schemaVersion: "human-loop-native-close/v1", sessionId: text(data.sessionId), flushed: data.flushed, events, users };
}

export function validateNativeReopen(history, value, stage = "clean-reopen", boundary = "persisted") {
  const proof = parseNativeClose(value);
  requireCondition(proof.flushed && proof.users.length > 0, "The closed session has no flushed used-session history; it will not be recreated.");
  requireCondition(Array.isArray(history), "Native history is unavailable.");
  const known = new Map(proof.events.map((event) => [event.id, event]));
  const seen = new Set(), retained = [];
  for (const event of history) {
    requireCondition(event?.id && event.type && !seen.has(event.id), "Native history has missing or duplicate identity.");
    seen.add(event.id);
    if (!durableNativeEvent(event)) continue;
    const expected = known.get(event.id);
    if (expected) {
      requireNativeCloseEvent(event, expected, stage, "Retained native history changed after clean close.", boundary);
      retained.push(event.id);
    } else requireCondition(!nativeExecutionEvent(event.type), "Unowned input or execution appeared while the private session was closed.");
  }
  const complete = proof.events.every(({ id }) => seen.has(id));
  if (complete) requireNativeHistoryOrder(retained, proof.events.map(({ id }) => id), stage);
  return complete;
}

export function parseHumanCleanClose(value) {
  if (value?.schemaVersion === "human-loop-close/v2") {
    const data = object(value, ["schemaVersion", "id", "ownerDigest", "configurationDigest", "native", "warnings", "closedAt"]);
    requireCondition(Number.isFinite(Date.parse(data.closedAt)), "Invalid close timestamp.");
    return { schemaVersion: data.schemaVersion, id: text(data.id), ownerDigest: digest(data.ownerDigest),
      configurationDigest: digest(data.configurationDigest), native: parseNativeClose(data.native),
      warnings: list(data.warnings, text), closedAt: text(data.closedAt) };
  }
  const data = object(value, ["schemaVersion", "id", "ownerDigest", "configurationDigest", "stateDigest", "conversationDigest",
    "commandsDigest", "workspace", "design", "native", "closedAt"]);
  requireCondition(data.schemaVersion === "human-loop-clean-close/v1", "A compatible new-model clean-close checkpoint is required.");
  const closedAt = text(data.closedAt);
  requireCondition(Number.isFinite(Date.parse(closedAt)), "Invalid clean-close timestamp.");
  return {
    schemaVersion: "human-loop-clean-close/v1", id: text(data.id), ownerDigest: digest(data.ownerDigest),
    configurationDigest: digest(data.configurationDigest), stateDigest: digest(data.stateDigest),
    conversationDigest: digest(data.conversationDigest), commandsDigest: digest(data.commandsDigest),
    workspace: parseSnapshotRef(data.workspace), design: parseDesignBinding(data.design),
    native: parseNativeClose(data.native), closedAt,
  };
}

export function requireCleanHumanState(state) {
  requireHumanQuiescence(state);
}

export function validateCleanBindings(proofValue, configuration, state, messages, commandsDigest) {
  const proof = parseHumanCleanClose(proofValue);
  requireCleanHumanState(state);
  requireCondition(proof.ownerDigest === policyHash(configuration.owner) && proof.configurationDigest === policyHash(configuration)
    && proof.native.sessionId === configuration.owner.privateSessionId, "Clean-close proof belongs to another owner or runtime configuration.");
  requireCondition(proof.stateDigest === policyHash(state) && proof.conversationDigest === policyHash(messages)
    && proof.commandsDigest === commandsDigest, "Saved workflow, conversation or command evidence changed after clean close.");
  const recovered = new Map((state.recoveries ?? []).flatMap(({ nativeUsers }) => nativeUsers).map((user) => [user.id, user]));
  requireCondition([...recovered.values()].every((user) => proof.native.users.some((entry) => policyHash(entry) === policyHash(user))),
    "Native close lost retained Recovery history.");
  const recoveredMessages = new Set([...recovered.values()].map(({ messageId }) => messageId));
  const delivered = state.executions.filter((task) => task.messageId !== null && !recoveredMessages.has(task.messageId));
  const injections = state.stops.flatMap((stop) => stop.injection && !recoveredMessages.has(stop.injection.messageId) ? [stop.injection] : []);
  requireCondition(delivered.length + injections.length === proof.native.users.length - recovered.size && delivered.every((task) =>
    task.end && proof.native.users.some((user) => user.messageId === task.messageId && user.interactionId === task.interactionId)),
  "Native close history does not match the exact completed task records.");
  requireCondition(injections.every((injection) => injection.delivery && injection.acknowledgement && injection.endEventId
    && delivered.some((task) => task.binding.id === injection.taskId && task.binding.requestId === injection.requestId
      && task.binding.inputDigest === injection.inputDigest && task.end.endEventId === injection.endEventId)
    && proof.native.users.some((user) => user.id === injection.delivery.eventId && user.messageId === injection.messageId
      && user.turnId === injection.delivery.turnId && user.interactionId === injection.delivery.interactionId)),
  "Native close history does not match the exact settled Stop messages.");
  return proof;
}
