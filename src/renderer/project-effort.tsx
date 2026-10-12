import { useEffect, useState } from "react";
import { AlertDialog } from "radix-ui";
import { useUi } from "./ui-context.js";

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

export function DiscoveryProjectSettings({ close }: { close(): void }) {
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
      </AlertDialog.Content></AlertDialog.Portal>
    </AlertDialog.Root>;
}
