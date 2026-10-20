import { useState } from "react";
import { ArrowRight, RefreshCw, X } from "lucide-react";
import type { ChangeRequest } from "../change-requests.js";
import type { LifecycleStageId } from "../types.js";
import { lifecycleStages } from "../workflow.js";
import { hasActiveJobs, useAction, useDraft, useUi, type UiState } from "./ui-context.js";
import { useProjectView } from "./project-conversation.js";
import { SpeechTextarea } from "./speech-textarea.js";

const label = (stage: LifecycleStageId) => stage === "sketch" ? "Drawings" : lifecycleStages.find(item => item.id === stage)?.label || stage;
const statuses: Record<ChangeRequest["status"], string> = {
    queued: "Queued for impact review", analyzing: "Checking affected stages", proposed: "Review change impact",
    active: "Updating affected work", completed: "Change handled", cancelled: "Cancelled", failed: "Impact assessment failed",
};

export function ChangeRequestsPanel() {
    const { state, post, pending, browseStage } = useUi();
    const project = useProjectView();
    const action = useAction("change-request");
    const requests = state.changeRequests ?? [];
    const current = requests.find(item => !["completed", "cancelled"].includes(item.status));
    const [refining, setRefining] = useState<string | null>(null);
    const [drafts, setDrafts] = useDraft<Record<string, string>>("change-request-details", {});
    if (!requests.length) return null;
    const plan = current?.assessment;
    const busy = pending || hasActiveJobs(state) || state.provider?.canSubmitAnswers === false;
    async function decide(decision: string) {
        if (!current) return;
        const next = await action.run(() => post<UiState>("/api/change-requests/decision", {
            requestId: current.id, analysisId: current.analysisId, baselineDigest: current.baselineDigest,
            decision, answer: drafts[current.id] ?? "",
        }));
        if (!next) return;
        setRefining(null);
        if (decision === "approve") {
            project.resumeDiscovery();
            browseStage(next.lifecycle.currentStage);
        }
    }
    async function continueDevelopment(approve: boolean) {
        if (!current || !await project.requireDevelopmentGit()) return;
        await action.run(async () => {
            if (approve) await post("/api/change-requests/decision", { requestId: current.id, decision: "approve",
                analysisId: current.analysisId, baselineDigest: current.baselineDigest });
            await post("/api/change-requests/development", { requestId: current.id }, 120000);
            project.prepareDevelopmentView();
            await project.activate();
        });
    }
    return <section className="change-requests" aria-label="Project changes">
        {current && <div className="change-impact" data-status={current.status}>
            <div className="change-heading">
                <h2 id="change-impact-title">{statuses[current.status]}</h2>
                <span className="muted">From {label(current.originStage)}</span>
            </div>
            <p className="change-original">{current.message}</p>
            {current.sourceRequests.length > 0 && <details><summary>Original Development requests</summary>
                {current.sourceRequests.map(request => <p key={request.id}>{request.message}</p>)}
                <p className="muted">Original answers and attachment references remain linked to their Development requests.</p>
            </details>}
            {plan ? <>
                <p>{plan.summary}</p>
                <ol className="change-stage-path" aria-label="Affected stages">
                    {plan.stages.map(item => <li key={item.stage} title={item.reason}>
                        <strong>{label(item.stage)}</strong>
                        <span>{current.status === "active"
                            ? current.remainingStages.includes(item.stage) ? "Update pending" : "Saved"
                            : item.stage === plan.startStage ? "Start here" : "Review / update"}</span>
                    </li>)}
                </ol>
                {plan.preserved.length > 0 && <p className="change-preserved"><strong>Keep:</strong> {plan.preserved.join("; ")}</p>}
                <details><summary>Why these stages?</summary><p>{plan.reason}</p>
                    {plan.stages.map(item => <p key={item.stage}><strong>{label(item.stage)}:</strong> {item.reason}</p>)}
                    {plan.requirements && <p>{plan.requirements.usages.add.length} added usages; {plan.requirements.upsert.length} new or revised decisions.
                        Independent answers stay unchanged. Previous answers remain visible when review is needed.</p>}
                </details>
            </> : <p role="status">{current.status === "failed" ? "Your saved request can be assessed again."
                : "Your existing decisions, drawings and prototype stay unchanged while the request is assessed."}</p>}
            {current.status === "proposed" && (plan?.question || refining === current.id) ? <form className="change-detail-form" onSubmit={event => {
                event.preventDefault(); void decide(plan?.question ? "clarify" : "refine");
            }}>
                <label htmlFor="change-detail">{plan?.question || "Add or correct the instructions for this change"}</label>
                <SpeechTextarea id="change-detail" value={drafts[current.id] ?? ""} rows={2} maxLength={4000}
                    onValueChange={value => setDrafts(previous => ({ ...previous, [current.id]: value }))}
                    disabled={busy} aria-describedby="change-action-status" />
                <button className="plan-button" disabled={busy || !drafts[current.id]?.trim()} type="submit">Check impact with this detail</button>
            </form> : current.status === "proposed" && plan && <div className="change-actions">
                {plan.startStage !== "development" && <button id="approve-change" className="plan-button" disabled={busy}
                    onClick={() => void decide("approve")}><ArrowRight size={15} aria-hidden="true" />
                    Review {plan.startStage === "none" ? "change" : label(plan.startStage)} changes</button>}
                {plan.startStage === "development" && <button className="plan-button" disabled={busy}
                    onClick={() => void continueDevelopment(true)}>Review in Development</button>}
                <button className="plan-button secondary" disabled={busy} onClick={() => setRefining(current.id)}>Refine request</button>
            </div>}
            {current.status === "active" && <div className="change-actions">
                {current.remainingStages.length === 1 && current.remainingStages[0] === "development"
                    ? <button className="plan-button" disabled={busy} onClick={() => void continueDevelopment(false)}>Continue change in Development</button>
                    : <button className="plan-button secondary" disabled={pending} onClick={() => {
                    project.resumeDiscovery(); browseStage(state.lifecycle.currentStage);
                }}>Go to {label(state.lifecycle.currentStage)}</button>}
                <span className="muted">Only affected work is revisited. Saved versions remain available.</span>
            </div>}
            <div className="change-actions">
                {["queued", "failed", "proposed"].includes(current.status) && <button className="plan-button secondary" disabled={busy}
                    onClick={() => void decide("retry")}><RefreshCw size={14} aria-hidden="true" />Check impact again</button>}
                <button className="plan-button secondary" disabled={busy} onClick={() => void decide("cancel")}
                    title={current.status === "active" ? "Stop the remaining change request without undoing saved work." : "Leave accepted work unchanged."}>
                    <X size={14} aria-hidden="true" />{current.status === "active" ? "Cancel remaining change" : "Cancel request"}</button>
            </div>
            {(current.error || action.error) && <p id="change-action-status" className="error" role="alert">{action.error || current.error}</p>}
        </div>}
        <details className="change-history"><summary>Change history ({requests.length})</summary>
            <ul>{requests.slice().reverse().map(request => <li key={request.id}>
                <strong>{request.message}</strong><span>{request.developmentAdmission === "admitted"
                    ? "Sent to Development - implementation confirmation remains separate" : statuses[request.status]}</span>
                {request.assessment && <p>{request.assessment.summary}</p>}
                {request.clarifications.map((item, index) => <p key={index}>{item.question}: {item.answer}</p>)}
            </li>)}</ul>
        </details>
    </section>;
}
