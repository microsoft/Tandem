import { useEffect, useRef, useState } from "react";
import { hasActiveJobs, useUi } from "./ui-context.js";

export interface StageEffort {
    desired: string | null;
    actual: string | null;
    model: string | null;
    supported: string[];
    status: string;
    error: string | null;
}
export interface ProjectEffort { desired: string | null; stage1: StageEffort; stage2: StageEffort; changing: boolean }
export class ProjectEffortError extends Error {
    constructor(message: string, readonly settings?: ProjectEffort) { super(message); }
}

export async function requestProjectEffort(effort?: string): Promise<ProjectEffort> {
    const response = await fetch("/api/settings/project-effort", effort === undefined ? { cache: "no-store" } : {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ effort }),
    });
    const value = await response.json();
    if (!response.ok) throw new ProjectEffortError(value.error || "Project effort is unavailable.", value.settings);
    return value;
}

export function useProviderReload(blocked: boolean) {
    const { state, pending, setBusy } = useUi();
    const [requested, setRequested] = useState(false), [error, setError] = useState("");
    const requesting = useRef(false);
    const scope = JSON.stringify([state.prototypeId, state.generation, state.provider?.extensionId]);
    const receipt = state.reloadReceipt;
    useEffect(() => {
        if (["success", "error"].includes(receipt?.status)) { requesting.current = false; setRequested(false); }
    }, [receipt?.status]);
    const view = {
        scope, supported: state.provider?.canReload === true,
        disabled: blocked || (pending || hasActiveJobs(state)) && !state.effortReset || state.provider?.canReload !== true || requested || receipt?.status === "reloading",
        label: requested || receipt?.status === "reloading" ? "Reloading Tandem extension..." : "Reload Tandem extension",
        title: "Reloads this Copilot session's extensions, including Tandem, and reconnects the canvas. Other extension connections may restart and unsent form text may be lost. Tandem's saved files and history are not archived or reset. This does not download updates or refresh your app preview. "
            + (state.effortReset ? "Use to reconnect during this interrupted Preparation restart; it does not clear the restart barrier or resume workers. Close Development first."
                : "Use after a local extension update. Finish discovery work and close Development first."),
        message: error || (receipt?.status === "error" || receipt?.status === "reloading" ? receipt.message : ""),
        error: Boolean(error || receipt?.status === "error"),
    };
    const latest = useRef(view); latest.current = view;
    async function reload(expectedScope: string): Promise<{ accepted: true } | { error: string }> {
        if (requesting.current || latest.current.disabled || expectedScope !== latest.current.scope) {
            const message = "Reload is no longer available. Review the current project and runtime before retrying.";
            setError(message);
            return { error: message };
        }
        requesting.current = true; setRequested(true); setError(""); setBusy("reload", true);
        try {
            const response = await fetch("/api/reload", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "Provider reload failed.");
            return { accepted: true };
        } catch (cause) {
            const message = cause instanceof Error ? cause.message : "Provider reload failed.";
            requesting.current = false; setRequested(false); setError(message);
            return { error: message };
        } finally { setBusy("reload", false); }
    }
    return { view, reload };
}
export type ProviderReload = ReturnType<typeof useProviderReload>;
