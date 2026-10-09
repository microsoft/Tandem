import { useState } from "react";
import { useUi } from "./ui-context.js";

interface StageEffort {
    desired: string | null;
    actual: string | null;
    model: string | null;
    supported: string[];
    status: string;
    error: string | null;
}
interface ProjectEffort { desired: string | null; stage1: StageEffort; stage2: StageEffort; changing: boolean }

export function ProjectEffortControl() {
    const { state, pending, setBusy: setProjectBusy } = useUi();
    const [settings, setSettings] = useState<ProjectEffort | null>(null);
    const [selected, select] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    async function load() {
        try {
            const response = await fetch("/api/settings/project-effort", { cache: "no-store" });
            const value = await response.json();
            if (!response.ok) throw new Error(value.error || "Project effort settings are unavailable.");
            setSettings(value); select(value.desired || "");
        } catch (error) { setError(error instanceof Error ? error.message : "Could not read project effort."); }
    }
    async function apply() {
        setBusy(true); setProjectBusy("project-effort", true); setError("");
        try {
            const response = await fetch("/api/settings/project-effort", { method: "POST",
                headers: { "Content-Type": "application/json" }, body: JSON.stringify({ effort: selected }) });
            const value = await response.json();
            if (value.settings) setSettings(value.settings);
            if (!response.ok) throw new Error(value.error || "Project effort was not fully applied.");
            setSettings(value);
        } catch (error) { setError(error instanceof Error ? error.message : "Project effort was not applied."); }
        finally { setBusy(false); setProjectBusy("project-effort", false); }
    }
    const available = settings?.stage1.supported.length ? settings.stage1.supported : settings?.stage2.supported || [];
    const supported = settings?.stage2.model && settings.stage2.supported.length
        ? available.filter(value => settings.stage2.supported.includes(value)) : available;
    return <details id="project-effort-settings" className="project-effort-control"
        onToggle={event => { if (event.currentTarget.open) { setError(""); void load(); } }}>
        <summary>Project effort</summary>
        <div>
            <label htmlFor="project-effort">Reasoning effort for both stages</label>
            <select id="project-effort" value={selected} onChange={event => select(event.target.value)}
                disabled={busy || pending || state.provider?.canSubmitAnswers === false}>
                <option value="" disabled>No shared choice; native defaults unchanged</option>
                {supported.map(value => <option key={value} value={value}>{value}</option>)}
            </select>
            <button id="apply-project-effort" type="button" onClick={() => void apply()}
                disabled={busy || pending || !selected || state.provider?.canSubmitAnswers === false}>Apply to both stages</button>
            <button type="button" disabled={busy} onClick={() => { setError(""); void load(); }}>Refresh status</button>
            {settings && [settings.stage1, settings.stage2].map((stage, index) =>
                <p key={index}>Stage {index + 1}: {stage.status}. Actual: {stage.actual || "not yet available"}.
                    {stage.model && ` Model: ${stage.model}.`} {stage.error}</p>)}
            <p>Stages keep independent sessions and settings. Opening Stage2 is still explicit; a pending choice does not start it.</p>
            <p role="alert">{error}</p>
        </div>
    </details>;
}
