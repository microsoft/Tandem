/** @typedef {{ status: "reported" | "unavailable" | "not-started", modelId: string | null, reasoningEffort: string | null, error: string | null }} ModelSelection */

/** @returns {value is ModelSelection} */
export function validModelSelection(value) {
  return Boolean(value && ["reported", "unavailable", "not-started"].includes(value.status)
    && ["modelId", "reasoningEffort", "error"].every(key => value[key] === null
      || typeof value[key] === "string" && value[key].length <= 2000));
}
/** @returns {Promise<ModelSelection>} */
export async function readModelSelection(read) {
  try {
    const value = await read();
    if (!value || value.modelId !== undefined && (typeof value.modelId !== "string" || !value.modelId.trim())
      || value.reasoningEffort !== undefined && value.reasoningEffort !== null && typeof value.reasoningEffort !== "string") {
      throw new Error("Native model/effort readback is invalid.");
    }
    return { status: "reported", modelId: value.modelId ?? null, reasoningEffort: value.reasoningEffort ?? null, error: null };
  } catch (error) {
    return { status: "unavailable", modelId: null, reasoningEffort: null, error: String(error.message ?? error).slice(0, 2000) };
  }
}
export function modelSelectionLabel(value, owner) {
  if (!validModelSelection(value) || value.status === "unavailable") return `${owner}: model/effort unavailable`;
  if (value.status === "not-started") return `${owner}: not started`;
  return `${owner}: ${value.modelId ?? "model not yet reported"} · Effort: ${value.reasoningEffort ?? "native default (not reported)"}`;
}
