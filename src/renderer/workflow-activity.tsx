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
    const title = binding.kind === "preparation" ? "Preparing project" : binding.kind === "suggestions" ? "Refreshing suggestions"
        : state.processing?.action === "generate-design-spec" ? "Finishing prototype"
        : state.lifecycle.currentStage === "prototype" ? "Building prototype"
        : state.lifecycle.currentStage === "sketch" ? "Updating designs" : "Updating requirements";
    const permissions = current?.agents.reduce((count, agent) => count + agent.pendingPermissions, 0) ?? 0;
    const savedStatus = binding.kind === "preparation" ? state.preparation.status
        : binding.kind === "suggestions" ? state.suggestionProcessing?.status : state.processing?.status;
    const savedFailure = ["error", "failed", "cancelled"].includes(savedStatus ?? "");
    const status = permissions ? "Waiting for permission" : current ? labels[current.status] || current.status
        : savedFailure ? labels[savedStatus!] : "Native activity not yet available";
    const savedError = savedFailure ? binding.kind === "preparation" ? state.preparation.error : state.processing?.message : "";
    const update = current?.agents.filter(agent => agent.update).sort((left, right) =>
        Date.parse(right.updateAt ?? "") - Date.parse(left.updateAt ?? ""))[0]?.update;
    const inactiveSeconds = current?.lastNativeActivityAt ? Math.floor((now - Date.parse(current.lastNativeActivityAt)) / 1000) : NaN;
    const failure = current?.agents.find(agent => ["failed", "error", "cancelled", "execution-unknown"].includes(agent.status));
    const singleAgent = current?.agents.length === 1 ? current.agents[0] : null;
    const sharedFreshness = singleAgent && (singleAgent.lastNativeActivityAt === current?.lastNativeActivityAt
        || Date.parse(singleAgent.lastNativeActivityAt ?? "") === Date.parse(current?.lastNativeActivityAt ?? ""));
    return <section id="native-workflow-activity" className="section" aria-label="Native workflow activity">
        <strong id="workflow-activity-title">{title}{Number.isFinite(elapsed) ? ` · ${Math.floor(elapsed / 60)}m ${elapsed % 60}s` : ""}</strong>
        <p id="workflow-activity-state" role="status">{status}</p>
        {permissions > 0 && <p role="alert">Review {permissions} pending native permission request(s) in the host.</p>}
        {current?.error && <p role="alert">{current.error}</p>}
        {!current?.error && savedError && <p role="alert">{savedError}</p>}
        {failure && <p role="alert">{failure.label}: {labels[failure.status] || failure.status}</p>}
        {update && <p id="workflow-latest-update">{update}</p>}
        {!ended && !permissions && inactiveSeconds >= 60 && <p className="muted">No new activity for {Math.floor(inactiveSeconds / 60)}m {inactiveSeconds % 60}s.</p>}
        <details id="workflow-activity-details"><summary>Details</summary>
            {ended && !Number.isFinite(elapsed) && <p>Request elapsed unavailable: terminal timestamp not available.</p>}
            <p className="muted">Workflow: {age(current?.lastNativeActivityAt ?? null, now)}</p>
            {current?.agents.map(agent => <div key={agent.id}>
                <strong>{agent.label}: {labels[agent.status] || agent.status}</strong>
                {agent.operation && <span> · {agent.operation}</span>}
                {!sharedFreshness && <p className="muted">Agent: {age(agent.lastNativeActivityAt, now)}</p>}
            </div>)}
            <p className="muted">Request: {binding.requestId} · Run: {binding.runId}</p>
            <p className="muted">Silence does not mean failure. Updates are not completion or verification evidence.</p>
        </details>
    </section>;
}
