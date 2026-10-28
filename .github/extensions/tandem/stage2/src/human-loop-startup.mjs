import { join } from "node:path";
import { lstat } from "node:fs/promises";
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
      "installationDigest", "ledgerDigest", "inventoryDigest", "nativeAbsenceDigest",
      ...(Object.hasOwn(entry.authorization, "repair") ? ["repair"] : [])]);
    text(authorization.id);
    requireCondition(typeof authorization.confirmedAt === "string" && Number.isFinite(Date.parse(authorization.confirmedAt))
      && authorization.consumedAt === entry.requestedAt && Date.parse(authorization.consumedAt) >= Date.parse(authorization.confirmedAt)
      && ["ownerDigest", "configurationDigest", "installationDigest", "ledgerDigest", "inventoryDigest", "nativeAbsenceDigest"]
        .every(key => typeof authorization[key] === "string" && /^[a-f0-9]{64}$/.test(authorization[key])),
    "One-time initial-creation authorization is invalid or not consumed by this exact native attempt.");
    if (authorization.repair !== undefined) {
      const repair = object(authorization.repair, ["kind", "admissionDigest", "previousCreationDigest"]);
      requireCondition(repair.kind === "verified-empty-created"
        && [repair.admissionDigest, repair.previousCreationDigest].every(value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value)),
      "Empty-created repair must preserve its original creation and nonadmitted handoff proof.");
    }
  }

  return structuredClone(entry);
}

export async function inspectEmptyCreatedSetup(configuration, closeIds) {
    const root = configuration.owner.workspacePath, wal = getHostStateWal(root);
    const store = new HumanLoopStore(configuration.owner);
    const ledger = await store.inspectEmptyCreatedSetup(closeIds);
    const preferences = await new HumanLoopPreferences(root).read();
    requireCondition(preferences.pendingModel === null, "An unconfirmed model selection requires the original native session.");
    const permitted = [
      ["human-loop", "installation.json"], ["human-loop", "ledger.json"], ["human-loop", "conversation.json"],
      ["preferences", "settings.json"], ["policy", "project-policy.json"],
    ].map(parts => new HostStateFile(root, join(root, ".tandem", "living-canvas", ...parts)));
    const directory = join(configuration.runtimeDirectory, "native-shells");
    const receipt = new HostStateFile(root, join(directory, "writer-reconciliation.json"));
    const journal = new HostStateFile(root, join(directory, "sessions.json"));
    requireCondition(await journal.read() === undefined, "A native command journal prevents empty-setup repair.");
    try {
      await lstat(join(directory, ".writer-lock"));
      throw new Error("A retained native writer lock prevents empty-setup repair.");
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    const raw = await receipt.read();
    if (raw !== undefined) {
      const value = object(JSON.parse(raw), ["schemaVersion", "ownerDigest", "sessionId", "path", "legacyLock", "recovery", "establishedAt", "claim"]);
      const claim = object(value.claim, ["writerId", "instanceId"]);
      requireCondition(value.schemaVersion === "human-loop-native-writer/v1" && value.ownerDigest === policyHash(configuration.owner)
        && value.sessionId === configuration.owner.privateSessionId && value.path === journal.path
        && value.legacyLock === null && value.recovery === null && Number.isFinite(Date.parse(value.establishedAt))
        && typeof claim.writerId === "string" && /^[a-f0-9]{64}$/.test(claim.writerId)
        && typeof claim.instanceId === "string" && /^[a-f0-9-]{36}$/.test(claim.instanceId),
      "Only the original empty native writer preparation may accompany an empty setup.");
      const history = await wal.history(receipt.namespace, receipt.key);
      requireCondition(history.length === 1 && history[0].content === raw
        && history[0].cause === "prepare-native-journal-writer", "Native writer history contains more than empty preparation.");
    }
    permitted.push(receipt);
    const inventory = await wal.inventory(null, 100);
    requireCondition(inventory.next === null && inventory.entries.every(entry => !entry.deleted
      && permitted.some(file => file.namespace === entry.namespace && file.key === entry.key)),
    "Empty-setup repair found other retained Design, control, approval or unknown state.");
    return { ledger, inventoryDigest: policyHash(inventory.entries.filter(entry =>
      entry.namespace !== permitted[0].namespace || entry.key !== permitted[0].key)), ownerDigest: policyHash(configuration.owner) };
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
