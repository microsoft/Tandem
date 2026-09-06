export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface PreparationToken {
    requestId: string;
    generation: string;
    runId: string | null;
}

export function jsonResult(value: unknown): JsonValue {
    if (value === null) return null;
    if (typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (Array.isArray(value)) return value.map(jsonResult);
    if (typeof value === "object" && value !== null) {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonResult(item)]));
    }
    throw new Error("The worker returned a value that cannot be persisted as JSON.");
}
