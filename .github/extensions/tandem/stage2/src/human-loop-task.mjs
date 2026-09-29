import { createHash } from "node:crypto";
import { humanLoopPrompts } from "../public/prompts/human-loop.js";
import { parseTaskBinding, parseNativeUserEvidence } from "../runtime-src/domain/human-loop/contracts.ts";
import { policyHash } from "../runtime-src/domain/workflow/policy.ts";
import { object, requireCondition } from "../runtime-src/domain/workflow/validation.ts";

export function humanTaskPrompt(packet, kind = "initial") {
  requireCondition(kind === "initial" || kind === "continuation", "Unknown private input kind.");
  return [...humanLoopPrompts.wrapper, ...(kind === "continuation" ? humanLoopPrompts.missingResultRecovery : []),
    JSON.stringify(packet)].join("\n");
}

function inputAttachment(value) {
  requireCondition(value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).every(key => ["type", "mimeType", "data", "displayName", "assetId", "byteLength"].includes(key))
    && value.type === "blob" && ["image/png", "image/jpeg"].includes(value.mimeType)
    && (value.displayName === undefined || typeof value.displayName === "string"),
  "Private input attachment is not an exact supported image.");
  let digest, bytes;
  if (typeof value.data === "string") {
    const content = Buffer.from(value.data, "base64");
    requireCondition(content.length > 0 && content.toString("base64") === value.data, "Private input attachment bytes are invalid.");
    digest = createHash("sha256").update(content).digest("hex"); bytes = content.length;
    requireCondition((value.assetId === undefined || value.assetId === `sha256:${digest}`)
      && (value.byteLength === undefined || value.byteLength === bytes), "Private input attachment identity conflicts with its bytes.");
  } else {
    requireCondition(value.data === undefined && /^sha256:[a-f0-9]{64}$/.test(value.assetId)
      && Number.isSafeInteger(value.byteLength) && value.byteLength > 0, "Private input attachment bytes are unavailable.");
    digest = value.assetId.slice(7); bytes = value.byteLength;
  }
  return { type: "blob", mimeType: value.mimeType, displayName: value.displayName ?? null, digest, bytes };
}

export function humanInputEnvelope(prompt, attachments = [], kind = "initial") {
  requireCondition(typeof prompt === "string" && prompt.length > 0 && Array.isArray(attachments), "Private input envelope is invalid.");
  return { schemaVersion: "human-role-input/v1", kind,
    promptDigest: createHash("sha256").update(prompt, "utf8").digest("hex"), promptBytes: Buffer.byteLength(prompt, "utf8"),
    attachmentsDigest: policyHash(attachments.map(inputAttachment)) };
}

export function nativeUserEvidence(event) {
  const data = event.data ?? {};
  if (typeof data.messageId === "string" && typeof data.turnId === "string" && typeof data.interactionId === "string") {
    return parseNativeUserEvidence({ id: event.id, messageId: data.messageId, turnId: data.turnId, interactionId: data.interactionId });
  }
  return parseNativeUserEvidence({ schemaVersion: "human-loop-native-user/v2", id: event.id,
    messageId: data.messageId ?? null, turnId: data.turnId ?? null, interactionId: data.interactionId ?? null });
}

export function createHumanTask(identity, context) {
  const exactContext = JSON.parse(JSON.stringify(context));
  const binding = parseTaskBinding({ ...identity, inputDigest: policyHash({ binding: identity, context: exactContext }) });
  return { schemaVersion: "human-loop-task/v1", binding, context: exactContext };
}

export function parseHumanTask(value) {
  const data = object(value, ["schemaVersion", "binding", "context"]);
  requireCondition(data.schemaVersion === "human-loop-task/v1", "Incompatible private task; legacy approvals are not accepted.");
  const binding = parseTaskBinding(data.binding);
  const { inputDigest, ...identity } = binding;
  const context = JSON.parse(JSON.stringify(data.context));
  requireCondition(inputDigest === policyHash({ binding: identity, context }), "Private task context digest changed.");
  return { schemaVersion: "human-loop-task/v1", binding, context };
}
