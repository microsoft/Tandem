import { useEffect, useState } from "react";
import { workflowBinding } from "../workflow-activity.js";
import { useUi } from "./ui-context.js";

const labels: Record<string, string> = {
    queued: "Queued", running: "Running", "waiting-permission": "Waiting for permission",
    paused: "Paused", halted: "Paused", completed: "Completed", error: "Failed", failed: "Failed", cancelled: "Cancelled",
};
function age(value: string | null, now: number): string {
    if (!value || !Number.isFinite(Date.parse(value))) return "No native activity observed yet.";
    const seconds = Math.max(0, Math.floor((now - Date.parse(value)) / 1000));
    return `Last native activity ${seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`} ago.`;
}

export function WorkflowActivity() {
    const { state } = useUi();
    const [now, setNow] = useState(Date.now);
    const binding = workflowBinding(state), runtime = state.workflowRuntime;
    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, []);
    if (state.lifecycle.currentStage === "development" || !binding) return null;
    const current = runtime && runtime.runId === binding.runId && runtime.requestId === binding.requestId
        && runtime.generation === binding.generation ? runtime : null;
    const ended = Boolean(binding.completedAt) || ["completed", "error", "failed", "cancelled"].includes(current?.status || "");
    const completedAt = current?.completedAt ?? binding.completedAt;
    const end = ended ? completedAt ? Date.parse(completedAt) : NaN : now;
    const start = Date.parse(binding.requestedAt);
    const elapsed = end >= start ? Math.floor((end - start) / 1000) : NaN;
    return <section id="native-workflow-activity" className="section" aria-label="Native workflow activity">
        <strong>{current ? labels[current.status] || current.status : "Native activity not yet available"}</strong>
        <p className="muted">{Number.isFinite(elapsed) ? `Request elapsed: ${Math.floor(elapsed / 60)}m ${elapsed % 60}s. `
            : ended ? "Request elapsed unavailable: terminal timestamp not available. " : ""}
            {age(current?.lastNativeActivityAt ?? null, now)}</p>
        {current?.error && <p role="alert">{current.error}</p>}
        {current?.agents.map(agent => <div key={agent.id}>
            <strong>{agent.label}: {labels[agent.status] || agent.status}</strong>
            {agent.operation && <span> · {agent.operation}</span>}
            {agent.pendingPermissions > 0 && <p>Review {agent.pendingPermissions} pending native permission request(s) in the host.</p>}
            {agent.update && <p>Model update: {agent.update} <span className="muted">{age(agent.updateAt, now).replace("native activity", "update")}</span></p>}
            <p className="muted">{age(agent.lastNativeActivityAt, now)}</p>
        </div>)}
        <p className="muted">Silence does not mean failure. Updates are not completion or verification evidence.</p>
    </section>;
}
