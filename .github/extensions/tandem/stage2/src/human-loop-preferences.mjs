import { resolve } from "node:path";
import { HostStateFile } from "../runtime-src/domain/host-state-file.ts";
import { getHostStateWal } from "../runtime-src/domain/host-state-wal.ts";

const defaults = () => ({ schemaVersion: "human-loop-preferences/v1", theme: "system", fontSize: "normal", model: null, pendingModel: null });
export function parsePreferences(input) {
  const value = input === undefined ? defaults() : typeof input === "string" ? JSON.parse(input) : input;
  if (!value || Object.keys(value).sort().join() !== Object.keys(defaults()).sort().join()
    || value.schemaVersion !== "human-loop-preferences/v1"
    || !["system", "light", "dark"].includes(value.theme) || !["normal", "larger", "largest"].includes(value.fontSize)
    || ![value.model, value.pendingModel].every((id) => id === null || typeof id === "string" && id.trim() === id && id.length > 0 && id.length <= 200)) {
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
      || Object.keys(patch).some((key) => !["theme", "fontSize", "model", "pendingModel"].includes(key))) throw new Error("Unknown Canvas preference.");
    return this.file.mutate("canvas-preferences", (original) => {
      const result = parsePreferences({ ...parsePreferences(original), ...patch });
      return { content: JSON.stringify(result), result };
    });
  }
}
