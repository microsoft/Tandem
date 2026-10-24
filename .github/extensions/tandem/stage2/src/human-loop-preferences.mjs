import { resolve } from "node:path";
import { HostStateFile } from "../runtime-src/domain/host-state-file.ts";
import { getHostStateWal } from "../runtime-src/domain/host-state-wal.ts";

const defaults = () => ({ schemaVersion: "human-loop-preferences/v1", theme: "system", fontSize: "normal", model: null, pendingModel: null,
  reasoningEffort: null, pendingReasoningEffort: null, projectReasoningEffort: null });
export function normalizeModelCatalog(models) {
  if (!Array.isArray(models) || !models.length || models.length > 1000
    || !models.every(model => model && typeof model.id === "string" && model.id.trim() === model.id
      && model.id.length > 0 && model.id.length <= 200)
    || new Set(models.map(model => model.id)).size !== models.length) throw new Error("The SDK model list is unavailable or invalid.");
  return models.filter(model => model.policy?.state !== "disabled").map(({ id, name, supportedReasoningEfforts = [] }) => {
    if (!Array.isArray(supportedReasoningEfforts) || supportedReasoningEfforts.length > 40
      || !supportedReasoningEfforts.every(effort => typeof effort === "string" && effort.trim() === effort
        && effort.length > 0 && effort.length <= 40)
      || new Set(supportedReasoningEfforts).size !== supportedReasoningEfforts.length) {
      throw new Error("SDK supported reasoning efforts are invalid.");
    }
    return { id, name: typeof name === "string" ? name.slice(0, 200) : id, supportedReasoningEfforts };
  });
}
export function validateProjectReasoningEffort(value) {
  if (!["none", "minimal", "low", "medium", "high", "xhigh", "max"].includes(value)) throw new Error("Invalid Development reasoning effort.");
  return value;
}
export function parsePreferences(input) {
  const original = input === undefined ? defaults() : typeof input === "string" ? JSON.parse(input) : input;
  const value = original && { reasoningEffort: null, pendingReasoningEffort: null, projectReasoningEffort: null, ...original };
  if (!value || Object.keys(value).sort().join() !== Object.keys(defaults()).sort().join()
    || value.schemaVersion !== "human-loop-preferences/v1"
    || !["system", "light", "dark"].includes(value.theme) || !["normal", "larger", "largest"].includes(value.fontSize)
    || ![value.model, value.pendingModel].every((id) => id === null || typeof id === "string" && id.trim() === id && id.length > 0 && id.length <= 200)
    || ![value.reasoningEffort, value.pendingReasoningEffort].every((effort) => effort === null
      || typeof effort === "string" && effort.trim() === effort && effort.length > 0 && effort.length <= 40)
    || value.projectReasoningEffort !== null && !["none", "minimal", "low", "medium", "high", "xhigh", "max"].includes(value.projectReasoningEffort)
    || value.reasoningEffort !== null && !value.model || value.pendingReasoningEffort !== null && !value.pendingModel) {
    throw new Error("Canvas preferences are invalid; no defaults were substituted.");
  }
  return value;
}

export class HumanLoopPreferences {
  constructor(root) { this.file = new HostStateFile(root, resolve(root, ".tandem", "living-canvas", "preferences", "settings.json")); }
  async read() { return parsePreferences(await this.file.read()); }
  async isOnlySavedState() {
    const content = await this.file.read();
    if (content === undefined) return false;
    parsePreferences(content);
    const inventory = await getHostStateWal(this.file.root).inventory(null, 2);
    return inventory.next === null && inventory.entries.length === 1 && inventory.entries.every((entry) =>
      entry.namespace === this.file.namespace && entry.key === this.file.key && !entry.deleted);
  }
  async update(patch) {
    if (!patch || typeof patch !== "object" || Array.isArray(patch)
      || Object.keys(patch).some((key) => !["theme", "fontSize", "model", "pendingModel", "reasoningEffort", "pendingReasoningEffort", "projectReasoningEffort"].includes(key))) throw new Error("Unknown Canvas preference.");
    return this.file.mutate("canvas-preferences", (original) => {
      const result = parsePreferences({ ...parsePreferences(original), ...patch });
      return { content: JSON.stringify(result), result };
    });
  }
}
