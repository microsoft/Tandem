import { join } from "node:path";
import { HostStateFile } from "../runtime-src/domain/host-state-file.ts";
import { getHostStateWal } from "../runtime-src/domain/host-state-wal.ts";
import { policyHash } from "../runtime-src/domain/workflow/policy.ts";
import { object, requireCondition, text } from "../runtime-src/domain/workflow/validation.ts";
import { HumanLoopStore } from "./human-loop-store.mjs";
import { HumanLoopPreferences } from "./human-loop-preferences.mjs";

export function newNativeCreation(sessionId) {
  return { schemaVersion: "human-loop-native-creation/v1", sessionId, status: "not-requested",
    requestId: null, requestedAt: null, createdAt: null };
}

export function parseNativeCreation(value, sessionId) {
  const entry = object(value, ["schemaVersion", "sessionId", "status", "requestId", "requestedAt", "createdAt",
    ...(Object.hasOwn(value ?? {}, "authorization") ? ["authorization"] : [])]);
  requireCondition(entry.schemaVersion === "human-loop-native-creation/v1" && entry.sessionId === sessionId
    && ["not-requested", "requested", "created"].includes(entry.status), "Native creation receipt has an invalid identity or phase.");
  requireCondition(entry.status === "not-requested"
    ? entry.requestId === null && entry.requestedAt === null && entry.createdAt === null && entry.authorization === undefined
    : typeof entry.requestId === "string" && entry.requestId.length > 0
      && typeof entry.requestedAt === "string" && Number.isFinite(Date.parse(entry.requestedAt))
      && (entry.status === "requested" ? entry.createdAt === null
        : typeof entry.createdAt === "string" && Date.parse(entry.createdAt) >= Date.parse(entry.requestedAt)),
  "Native creation receipt cannot imply an unissued request after creation was attempted.");
  if (entry.authorization !== undefined) {
    const authorization = object(entry.authorization, ["id", "confirmedAt", "consumedAt", "ownerDigest", "configurationDigest",
      "installationDigest", "ledgerDigest", "inventoryDigest", "nativeAbsenceDigest"]);
    text(authorization.id);
    requireCondition(typeof authorization.confirmedAt === "string" && Number.isFinite(Date.parse(authorization.confirmedAt))
      && authorization.consumedAt === entry.requestedAt && Date.parse(authorization.consumedAt) >= Date.parse(authorization.confirmedAt)
      && ["ownerDigest", "configurationDigest", "installationDigest", "ledgerDigest", "inventoryDigest", "nativeAbsenceDigest"]
        .every(key => typeof authorization[key] === "string" && /^[a-f0-9]{64}$/.test(authorization[key])),
    "One-time initial-creation authorization is invalid or not consumed by this exact native attempt.");
  }
  return structuredClone(entry);
}

export async function inspectUnusedStartup(configuration) {
  const root = configuration.owner.workspacePath, wal = getHostStateWal(root);
  const store = new HumanLoopStore(configuration.owner);
  const ledger = await store.inspectInitialCreation();
  const preferences = await new HumanLoopPreferences(root).read();
  requireCondition(preferences.pendingModel === null, "An unconfirmed model selection requires the original native session.");
  const permitted = [
    ["human-loop", "installation.json"], ["human-loop", "ledger.json"], ["human-loop", "conversation.json"],
    ["preferences", "settings.json"], ["policy", "project-policy.json"],
  ].map(parts => new HostStateFile(root, join(root, ".tandem", "living-canvas", ...parts)));
  const inventory = await wal.inventory(null, 100);
  requireCondition(inventory.next === null && inventory.entries.every(entry => !entry.deleted
    && permitted.some(file => file.namespace === entry.namespace && file.key === entry.key)),
  "Initial setup recovery found retained Design, native control, approval or other Host state; no empty replacement is allowed.");
  return { ledger, inventoryDigest: policyHash(inventory.entries), ownerDigest: policyHash(configuration.owner) };
}
