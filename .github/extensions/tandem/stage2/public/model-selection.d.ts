export interface ModelSelection {
  status: "reported" | "unavailable" | "not-started";
  modelId: string | null;
  reasoningEffort: string | null;
  error: string | null;
}
export function validModelSelection(value: unknown): value is ModelSelection;
export function readModelSelection(read: () => Promise<unknown>): Promise<ModelSelection>;
export function modelSelectionLabel(value: unknown, owner: string): string;
