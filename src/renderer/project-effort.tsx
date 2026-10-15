import { useEffect, useRef, useState } from "react";
import { AlertDialog } from "radix-ui";
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

export function DiscoveryProjectSettings({ close, providerReload, openProcess }: { close(): void; providerReload: ProviderReload; openProcess(): void }) {
    const { pending, state, setBusy } = useUi();
    const [value, setValue] = useState<ProjectEffort | null>(null);
    const [choice, setChoice] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    async function load(apply = false) {
        if (loading) return;
        setLoading(true); setError("");
        if (apply) setBusy("project-effort", true);
        try {
            const result = await requestProjectEffort(apply ? choice : undefined);
            setValue(result); setChoice(result.desired ?? "");
        } catch (error) {
            if (error instanceof ProjectEffortError && error.settings) setValue(error.settings);
            setError(error instanceof Error ? error.message : "Project settings could not be read.");
        } finally { setLoading(false); if (apply) setBusy("project-effort", false); }
    }
    useEffect(() => { void load(); }, []);
    const available = value?.stage1.supported.length ? value.stage1.supported : value?.stage2.supported ?? [];
    const levels = value?.stage2.model && value.stage2.supported.length ? available.filter(level => value.stage2.supported.includes(level)) : available;
    return <AlertDialog.Root open onOpenChange={open => { if (!open) close(); }}>
      <AlertDialog.Portal><AlertDialog.Overlay className="dialog-overlay" /><AlertDialog.Content className="dialog-content"
        onCloseAutoFocus={event => { event.preventDefault(); document.getElementById("project-settings")?.focus(); }}>
        <div className="root-settings-heading"><AlertDialog.Title>Project settings</AlertDialog.Title>
          <AlertDialog.Cancel className="plan-button secondary" onClick={close}>Close</AlertDialog.Cancel></div>
        <AlertDialog.Description>One shared reasoning effort; each stage keeps its own model, application and readback. This does not start Development.</AlertDialog.Description>
        <label className="root-effort-field">Reasoning effort for both stages<select id="project-effort" value={choice}
          disabled={loading || pending || state.provider?.canSubmitAnswers === false} onChange={event => setChoice(event.target.value)}>
          <option value="" disabled>No shared choice; native defaults unchanged</option>
          {levels.map(level => <option key={level} value={level}>{level}</option>)}
        </select></label>
        <div className="root-effort-actions">
          <button className="plan-button" disabled={!choice || loading || pending || state.provider?.canSubmitAnswers === false} onClick={() => void load(true)}>Apply to both stages</button>
          <button className="plan-button secondary" disabled={loading} onClick={() => void load()}>Refresh status</button>
        </div>
        <div role="status">{value && [value.stage1, value.stage2].map((stage, index) =>
          <p key={index}>Stage {index + 1}: {stage.status}. Actual: {stage.actual || "not yet available"}. {stage.model ? `Model: ${stage.model}.` : ""} {stage.error}</p>)}</div>
        {error && <p role="alert">{error}</p>}
        <section className="root-maintenance">
          <button id="acceptance-delivery" type="button" className="plan-button secondary" onClick={openProcess}>Advanced handoffs &amp; history</button>
        </section>
        {(providerReload.view.supported || providerReload.view.message) && <details className="root-maintenance" id="root-maintenance">
          <summary>Advanced project diagnostics</summary>
          <p>{providerReload.view.title}</p>
          {providerReload.view.supported && <button id="reload-extension" className="plan-button secondary" type="button"
            disabled={providerReload.view.disabled} onClick={() => void providerReload.reload(providerReload.view.scope)}>
            {providerReload.view.label}
          </button>}
          <p id="reload-status" role="status" data-status={providerReload.view.error ? "error" : "idle"}>{providerReload.view.message}</p>
        </details>}
      </AlertDialog.Content></AlertDialog.Portal>
    </AlertDialog.Root>;
}
