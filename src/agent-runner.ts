import type { joinSession } from "@github/copilot-sdk/extension";

type RpcWorkflowRequest = Parameters<Awaited<ReturnType<typeof joinSession>>["rpc"]["workflow"]["run"]>[0];
export type FactoryLaunchRequest = Omit<RpcWorkflowRequest, "args"> & { args: unknown };

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface PreparationToken {
    requestId: string;
    generation: string;
    runId: string | null;
}

export function isPendingFactoryRun(receipt: { terminal?: boolean; recovery?: { outcome: string } }): boolean {
    return !receipt.terminal && receipt.recovery?.outcome !== "abandoned-uncertain";
}

export async function workflowReasoningEffort(
    session: { rpc: { model: Pick<Awaited<ReturnType<typeof joinSession>>["rpc"]["model"], "getCurrent"> } },
    defaultEffort: "low" | "medium",
): Promise<string> {
    const { reasoningEffort } = await session.rpc.model.getCurrent();
    if (reasoningEffort === undefined) return defaultEffort;
    if (typeof reasoningEffort !== "string" || !reasoningEffort.trim()) {
        throw new Error("The owning session returned an invalid reasoning effort; the worker was not started.");
    }
    return reasoningEffort;
}

export function assertFactoryRequestEnvelope(request: FactoryLaunchRequest): void {
    if (!request || typeof request !== "object" || typeof request.name !== "string" || !request.name.trim() ||
        !Object.hasOwn(request, "args") || Object.keys(request).some((key) => !["name", "args", "options"].includes(key))) {
        throw new Error("A factory RPC request requires name, args, and optional options; limits belong inside options.");
    }
}

export function rejectedFactoryLaunch(error: unknown): string | null {
    const message = typeof error === "string" ? error : error instanceof Error ? error.message : "";
    // This exact RPC deserialization rejection happens before a durable run exists.
    // Timeouts, missing receipts, and transport failures do not prove non-execution.
    return /^(?:Request (?:session\.)?(?:factory|workflow)\.run failed with message: )?unknown field `limits`, expected one of `name`, `args`, `options`$/.test(message)
        ? message : null;
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
