import { useEffect, useRef, useState } from "react";
import { Dialog } from "radix-ui";
import { ArrowRight, Check, ListChecks, RefreshCw, X } from "lucide-react";
import type { LifecycleStageId } from "../types.js";
import { lifecycleStages } from "../workflow.js";
import { changeReviewNeedsAttention, currentChangeReview } from "../change-request-policy.js";
import { hasActiveJobs, useAction, useChangeRequestDialog, useDraft, useUi, type UiState } from "./ui-context.js";
import { useProjectView } from "./project-conversation.js";
import { changeRequestResponse, changeRequestStatus } from "./change-request-feedback.js";

const label = (stage: LifecycleStageId) => lifecycleStages.find(item => item.id === stage)?.label || stage;

export function ChangeRequestsPanel({ compact = false, showTrigger = true }: { compact?: boolean; showTrigger?: boolean }) {
    const { state, post, pending, browseStage, reviewStage, changeRequestDialog } = useUi();
    const project = useProjectView();
    const action = useAction("change-request");
    const requests = state.changeRequests ?? [];
    const localDialog = useChangeRequestDialog();
    const dialog = changeRequestDialog ?? localDialog;
    const required = currentChangeReview(state);
    const current = required ?? requests.find(item => item.id === dialog.requestId) ?? requests.at(-1);
    const [refining, setRefining] = useState<string | null>(null);
    const [actionRequestId, setActionRequestId] = useState<string | null>(null);
    const [drafts, setDrafts] = useDraft<Record<string, string>>("change-request-details", {});
    const attention = changeReviewNeedsAttention(state);
    const reviewKey = attention && current
        ? JSON.stringify([current.id, current.analysisId, current.status, current.assessment?.question, current.error]) : null;
    const seenReviews = useRef(new Set(reviewKey ? [reviewKey] : []));
    const dialogRef = useRef(dialog);
    dialogRef.current = dialog;
    const working = hasActiveJobs(state);
    useEffect(() => {
        if (!current || !reviewKey || seenReviews.current.has(reviewKey)) return;
        if (dialog.requestId !== null) { seenReviews.current.add(reviewKey); return; }
        if (pending || working) return;
        const timer = window.setTimeout(() => {
            seenReviews.current.add(reviewKey);
            dialogRef.current.open(current.id, document.getElementById(showTrigger ? "toggle-change-details" : "sketch-review-change"));
        }, 0);
        return () => window.clearTimeout(timer);
    }, [current?.id, reviewKey, pending, working, dialog.requestId, showTrigger]);
    if (!current) return null;
    const settled = ["completed", "cancelled"].includes(current.status);
    const plan = current.assessment;
    const error = (actionRequestId === current.id ? action.error : "") || current.error
        || (state.processing?.changeRequestId === current.id && state.processing.status === "error" ? state.processing.message : "");
    const busy = pending || working || state.provider?.canSubmitAnswers === false;
    const draftBusy = pending || state.provider?.canSubmitAnswers === false;
    const needsDetail = current.status === "proposed" && Boolean(plan?.question || refining === current.id);
    const earlier = (stage: string) => stage !== "none" && lifecycleStages.findIndex(item => item.id === stage)
        < lifecycleStages.findIndex(item => item.id === state.lifecycle.currentStage);
    const opensDraft = Boolean(!state.stageReview && reviewStage && plan && earlier(plan.startStage));

    async function decide(decision: string) {
        if (!current) return;
        setActionRequestId(current.id);
        const next = await action.run(() => post<UiState>("/api/change-requests/decision", {
            requestId: current.id, analysisId: current.analysisId, baselineDigest: current.baselineDigest,
            decision, answer: drafts[current.id] ?? "",
        }));
        if (!next) return;
        setRefining(null);
        if (decision === "clarify" || decision === "refine") {
            setDrafts(previous => ({ ...previous, [current.id]: "" }));
        }
        if (decision === "cancel" || decision === "approve") dialog.close();
        if (decision === "approve") {
            if (!state.stageReview) project.resumeDiscovery();
            browseStage(next.lifecycle.currentStage);
        }
    }
    async function continueDevelopment(approve: boolean) {
        if (!current) return;
        setActionRequestId(current.id);
        dialog.close();
        if (!await project.requireDevelopmentGit()) return;
        await action.run(async () => {
            if (approve) await post("/api/change-requests/decision", { requestId: current.id, decision: "approve",
                analysisId: current.analysisId, baselineDigest: current.baselineDigest });
            await post("/api/change-requests/development", { requestId: current.id }, 120000);
            project.prepareDevelopmentView();
            await project.activate();
        });
    }
    async function approve() {
        if (!current || !plan) return;
        if (plan.startStage === "development") return continueDevelopment(true);
        if (opensDraft && reviewStage && plan.startStage !== "none") {
            const stage = plan.startStage;
            setActionRequestId(current.id);
            await action.run(async () => {
                await reviewStage(stage, current);
                dialog.close();
            });
        } else await decide("approve");
    }
    async function continueReview() {
        if (!current) return;
        if (current.remainingStages.length === 1 && current.remainingStages[0] === "development") return continueDevelopment(false);
        const next = current.remainingStages[0];
        if (current.status === "reviewing" && next && earlier(next) && reviewStage) {
            setActionRequestId(current.id);
            await action.run(async () => { await reviewStage(next, current); dialog.close(); });
        } else {
            dialog.close();
            if (!state.stageReview) project.resumeDiscovery();
            browseStage(state.lifecycle.currentStage);
        }
    }
    const waiting = ["queued", "analyzing"].includes(current.status);
    const title = needsDetail ? "Clarify this change" : current.status === "reviewing" ? "Complete change review"
        : current.status === "failed" || error ? "Review needs attention" : settled ? "Saved change"
        : waiting ? "Checking your request" : current.status === "active" ? "Preparing your update" : "Review this change";
    const primaryLabel = opensDraft && plan?.startStage !== "none" && plan
        ? `Review ${label(plan.startStage)} draft`
        : state.stageReview ? "Update this draft" : plan?.startStage === "development" ? "Review in Development" : "Apply change";
    return <Dialog.Root open={dialog.requestId !== null} onOpenChange={open => open ? dialog.open(current.id) : dialog.close()}>
        <section className="change-requests" aria-label="Project changes" hidden={!showTrigger && !error} data-compact={compact || undefined}>
            <div className="change-summary" hidden={!showTrigger}>
                <h2 id="change-impact-title" className="visually-hidden">{changeRequestStatus(current)}</h2>
                <Dialog.Trigger asChild>
                    <button id="toggle-change-details" type="button" className="plan-button secondary review-trigger"
                        aria-controls="change-request-details" data-status={attention ? "attention" : "idle"}
                        aria-label={attention ? "Review required" : "Open change review"}>
                        <ListChecks size={16} aria-hidden="true" />Review
                    </button>
                </Dialog.Trigger>
            </div>
            {error && <p id="change-action-status" className="error change-summary-error" role="alert">{error}</p>}
        </section>
        <Dialog.Portal><Dialog.Overlay className="dialog-overlay" />
            <Dialog.Content id="change-request-details" className="dialog-content change-details-dialog" aria-modal="true"
                onCloseAutoFocus={event => { if (dialog.restoreFocus()) event.preventDefault(); }}>
                <header className="change-details-heading">
                    <span className="review-heading-icon" data-attention={attention || undefined}><ListChecks size={22} aria-hidden="true" /></span>
                    <div className="review-heading-copy">
                        <span className="review-eyebrow">{attention ? "Review required" : required ? "Change in progress" : "Change record"}</span>
                        <Dialog.Title>{title}</Dialog.Title>
                    </div>
                    <Dialog.Close asChild><button id="close-change-details" className="review-close" type="button" aria-label="Close review">
                        <X size={18} aria-hidden="true" />
                    </button></Dialog.Close>
                </header>
                <Dialog.Description className="review-description">{required
                    ? waiting ? "Your request is being checked. You can close this dialog and inspect your work while it runs."
                        : "Resolve this review before sending another change. You can close this dialog to inspect your work."
                    : "This saved record is read-only. Your decisions and previous versions are retained."}</Dialog.Description>
                <div className="change-request-details">
                    {error && <p id="change-dialog-error" className="review-error" role="alert">{error}</p>}
                    <section className="review-request-summary" aria-label="Your request">
                        <div className="review-section-heading"><h3>Your request</h3><span className="review-stage-badge">{label(current.originStage)}</span></div>
                        <p className="change-original">{current.message}</p>
                    </section>
                    <div className="change-impact" data-status={current.status}>
                        {plan ? <section className="review-proposal" aria-label="Proposed update">
                            <h3>{settled ? "Recorded outcome" : "Proposed update"}</h3>
                            <p>{plan.summary}</p>
                            <ol className="change-stage-path" aria-label="Affected stages">
                                {plan.stages.map(item => <li key={item.stage}>
                                    <strong>{label(item.stage)}</strong>
                                    <span>{["active", "reviewing"].includes(current.status)
                                        ? current.remainingStages.includes(item.stage) ? "Review pending" : "Saved"
                                        : settled ? "Recorded" : item.stage === plan.startStage ? "Starts here" : "Updates after review"}</span>
                                </li>)}
                            </ol>
                            <details className="review-supporting"><summary>Impact details</summary>
                                <p>{plan.reason}</p>
                                {plan.stages.map(item => <p key={item.stage}><strong>{label(item.stage)}:</strong> {item.reason}</p>)}
                                {plan.preserved.length > 0 && <><h4>Preserved</h4><ul>{plan.preserved.map(item => <li key={item}>{item}</li>)}</ul></>}
                                {plan.requirements && <p>{plan.requirements.usages.add.length} added usages and {plan.requirements.upsert.length} new or revised decisions. Independent answers stay unchanged.</p>}
                            </details>
                        </section> : <p role="status">{changeRequestResponse(current)}</p>}
                        {needsDetail && <form id="change-detail-form" className="change-detail-form" onSubmit={event => {
                            event.preventDefault(); void decide(plan?.question ? "clarify" : "refine");
                        }}>
                            <label htmlFor="change-detail">{plan?.question || "What should change in this request?"}</label>
                            <textarea className="composer-input" id="change-detail" rows={3} maxLength={4000}
                                value={drafts[current.id] ?? ""} disabled={busy}
                                placeholder={current.originStage === "sketch" ? "Name the screen and element, or describe its position." : "Add the detail needed for this change."}
                                aria-describedby={error ? "change-dialog-error" : undefined}
                                onChange={event => {
                                    const value = event.currentTarget.value;
                                    setDrafts(previous => ({ ...previous, [current.id]: value }));
                                }} />
                        </form>}
                        {["active", "reviewing"].includes(current.status) && <p className="review-next-step">
                            {current.status === "reviewing"
                                ? "Open the draft to review it, then apply its changes. Accepted work stays unchanged until you apply."
                                : "Review the updated work before continuing. Existing versions remain available."}
                        </p>}
                        {current.sourceRequests.length > 0 && <details className="review-supporting"><summary>Original Development request</summary>
                            {current.sourceRequests.map(request => <p key={request.id}>{request.message}</p>)}
                        </details>}
                        {current.clarifications.length > 0 && <details className="review-supporting"><summary>Previous clarifications</summary>
                            {current.clarifications.map((item, index) => <p key={index}><strong>{item.question}</strong><br />{item.answer}</p>)}
                        </details>}
                    </div>
                </div>
                <footer className="review-dialog-footer">
                    {!settled && <button id="cancel-change" className="plan-button secondary review-cancel" type="button"
                        disabled={current.status === "reviewing" ? draftBusy : busy} onClick={() => void decide("cancel")}>
                        {current.status === "active" ? "Cancel remaining change" : "Cancel request"}
                    </button>}
                    <div className="review-footer-actions">
                        {current.status === "proposed" && !needsDetail && <button className="plan-button secondary" disabled={busy}
                            onClick={() => setRefining(current.id)}>Edit request</button>}
                        {current.status === "proposed" && <button id="recheck-change" className="plan-button secondary" disabled={busy}
                            onClick={() => void decide("retry")}><RefreshCw size={14} aria-hidden="true" />Recheck impact</button>}
                        {needsDetail ? <button className="plan-button" form="change-detail-form" type="submit"
                            disabled={busy || !drafts[current.id]?.trim()}><ArrowRight size={15} aria-hidden="true" />Submit detail</button>
                            : current.status === "proposed" && plan ? <button id="approve-change" className="plan-button" disabled={opensDraft ? draftBusy : busy}
                                onClick={() => void approve()}><Check size={15} aria-hidden="true" />{primaryLabel}</button>
                            : ["active", "reviewing"].includes(current.status) ? <button id="continue-change-review" className="plan-button"
                                disabled={current.status === "reviewing" ? draftBusy : busy} onClick={() => void continueReview()}>
                                <ArrowRight size={15} aria-hidden="true" />Continue review</button>
                            : ["failed", "deferred"].includes(current.status) ? <button className="plan-button" disabled={busy}
                                onClick={() => void decide("retry")}><RefreshCw size={15} aria-hidden="true" />{current.status === "failed" ? "Retry review" : "Resume request"}</button>
                            : settled ? <Dialog.Close asChild><button className="plan-button" type="button">Done</button></Dialog.Close>
                            : <button className="plan-button" disabled>Checking request...</button>}
                    </div>
                </footer>
            </Dialog.Content>
        </Dialog.Portal>
    </Dialog.Root>;
}
