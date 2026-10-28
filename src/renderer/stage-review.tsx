import { Button, DialogParts as Dialog, Disclosure, IconButton, Textarea } from "./ui/index.js";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { ArrowRight, Check, ChevronRight, ListChecks, Pin, Play, Send, ShieldCheck, X } from "lucide-react";
import type { LifecycleStageId } from "../types.js";
import type { ChangeRequest } from "../change-requests.js";
import type { SketchDocument } from "../sketch.js";
import { DslView } from "./dsl-view.js";
import { lifecycleStages, type DecisionNode } from "../workflow.js";
import { StudioStore } from "./state-store.js";
import { canBrowseStage, DraftProvider, hasActiveJobs, UiContext, useAction, useChangeRequestDialog, useDraft, useUi, type UiContextValue, type UiState } from "./ui-context.js";
import { PreparationPanel } from "./preparation-panel.js";
import { RequirementsPanel } from "./requirements-panel.js";
import { requirementChange } from "./requirements-model.js";
import { isSketchRevisionApproved, SketchPanel, type DraftDesignApproval } from "./sketch-panel.js";
import { PrototypePanel, prototypeCompletionBlocked } from "./prototype-panel.js";
import { AbandonChangeReview, ChangeRequestsPanel, ChangeReviewPath } from "./change-requests-panel.js";
import { DiscoveryRecovery } from "./discovery-recovery.js";
import { changeReviewBlocksEditing, changeReviewNeedsAttention, changeReviewWaitsForPrototype, currentChangeReview, isLocalChange, pendingUpstreamReviewStage } from "../change-request-policy.js";
import { changeRequestHistoryStatus, changeRequestResponse, changeRequestReviewStage } from "./change-request-feedback.js";
import { FeedbackHistory, FeedbackHistoryButton } from "./feedback-history.js";

export const reviewStageLabel = (stage: LifecycleStageId) => lifecycleStages.find(item => item.id === stage)?.label ?? stage;

export function PendingReviewPane({ viewedStage, pinnedReview, onActionsContainer }: {
  viewedStage: LifecycleStageId; pinnedReview: UiState | null;
  onActionsContainer?: (container: HTMLElement | null) => void;
}) {
  const ui = useUi();
  const { state, changeRequestDialog, browseStage, reviewStage, confirm } = ui;
  const action = useAction("pending-review");
  const request = currentChangeReview(state);
  const reference = state.stageReviews?.find(item => item.generation === state.generation && !item.appliedAt && !item.discardedAt
    && (!request || item.changeRequestId === request.id));
  const prototypePending = Boolean(state.prototypeNeedsUpdate || state.prototypeFlow?.pendingCheckpointId || state.prototypeReview?.question
    || state.prototypeReview?.revisions?.some((item: { status: string }) => ["queued", "processing", "clarifying", "ready", "failed"].includes(item.status)));
  const waitingForPrototype = changeReviewWaitsForPrototype(state);
  const target = waitingForPrototype ? "prototype" : request ? changeRequestReviewStage(request)
    : pendingUpstreamReviewStage(state) ?? reference?.stage ?? (prototypePending ? "prototype" : undefined);
  const waiting = request && !waitingForPrototype && ["queued", "analyzing"].includes(request.status);
  if (!request && !target || waiting && !request.replacesRequestId
    || request && isLocalChange(state, request) && !changeReviewNeedsAttention(state)) return null;
  const earlier = target !== undefined && lifecycleStages.findIndex(item => item.id === target)
    < lifecycleStages.findIndex(item => item.id === state.lifecycle.currentStage);
  const inThisTab = target === viewedStage;
  const needsDialog = Boolean(request && !waitingForPrototype && (request.assessment?.question || request.error || !target || target === "development"
    || !["proposed", "reviewing", "active"].includes(request.status)
    || request.status === "proposed" && !earlier || request.status === "active" && earlier));
  const targetLabel = target ? reviewStageLabel(target) : "";
  const instructions: Record<LifecycleStageId, string> = {
    prepare: "Review the project brief above before continuing.",
    requirements: "Review the updated decisions above and answer any highlighted questions before finishing Requirements.",
    sketch: "Inspect the updated designs above, save your edits, then approve the reviewed version.",
    prototype: state.prototypeFlow?.pendingCheckpointId ? "Inspect the prepared prototype above, then show the updated version before finishing."
      : state.prototypeReview?.question ? "Answer the prototype clarification above to continue the review."
        : state.prototypeNeedsUpdate ? "Update the prototype for the reviewed inputs, then inspect its prepared version."
          : "Review the prototype above. Send feedback to re-evaluate this change, or finish when you are satisfied.",
    development: "Review the change in Development before authorizing further work.",
  };
  const guidance = request?.replacesRequestId && request.status === "queued" && (hasActiveJobs(state)
    || state.changeRequests?.some(item => item.id === request.replacesRequestId && !["completed", "cancelled"].includes(item.status)))
    ? "Your feedback is saved for re-evaluation after active work finishes. Applied changes and earlier drafts are retained."
    : waitingForPrototype ? "Resolve the existing prototype update or clarification first. Your new change is queued and will be checked afterwards."
    : waiting ? "Checking which stages this change affects. Your saved work is retained."
    : needsDialog && request ? changeRequestResponse(request)
      : inThisTab && target ? earlier ? `Open the ${targetLabel} draft to review it in this tab. Accepted work stays unchanged until you apply.`
        : instructions[target]
        : `Continue the review in ${targetLabel}. You can return to ${reviewStageLabel(viewedStage)} without changing its accepted work.`;
  const disabled = ui.pending || hasActiveJobs(state) || Boolean(state.effortReset) || state.provider?.canSubmitAnswers === false
    || Boolean(waiting) || (needsDialog ? !changeRequestDialog : !target || !canBrowseStage(state, target) || earlier && !reviewStage);
  async function continueReview(source: HTMLElement) {
    await action.run(async () => {
      if (needsDialog && request) {
        if (!changeRequestDialog) throw new Error("The change review dialog is unavailable.");
        changeRequestDialog.open(request.id, source);
        return;
      }
      if (!target) throw new Error("The next review stage is not available yet.");
      if (pinnedReview?.stageReview?.stage === target) {
        browseStage(target);
      } else if (earlier) {
        if (!reviewStage) throw new Error("This provider cannot open the review draft.");
        const openPinned = state.stageReviews?.find(item => item.id === pinnedReview?.prototypeId && !item.appliedAt && !item.discardedAt);
        if (openPinned && !await confirm("Switch to the next review draft? Saved edits in the previous draft are kept; unsaved editor changes will be lost.", "Switch review draft")) return;
        await reviewStage(target, request);
        return;
      } else browseStage(target);
      window.requestAnimationFrame(() => {
        const targetIds: Record<LifecycleStageId, string[]> = {
          prepare: ["review-brief", "preparation-panel"],
          requirements: ["decision-submit", "design-tree-panel"],
          sketch: ["apply-stage-review", "sketch-approve", "sketch-panel"],
          prototype: ["apply-prototype-update", "submit-clarification", "retry-prototype-checkpoint", "live-preview-panel"],
          development: ["development-panel"],
        };
        const control = targetIds[target].map(id => document.getElementById(id)).find(element =>
          element && !element.closest("[hidden], [inert]") && !element.matches(":disabled"));
        control?.scrollIntoView({ block: "nearest" });
        control?.focus({ preventScroll: true });
      });
    });
  }
  return <section className="review-guidance-pane" aria-labelledby="pending-review-title">
    <div className="stage-review-heading">
      <span className="review-panel-icon"><ListChecks size={20} aria-hidden="true" /></span>
      <div className="review-panel-title"><span className="review-eyebrow">{waiting ? "Preparing review" : "Review required"}</span>
        <div className="review-title-row">
          <h2 id="pending-review-title">{target ? `${targetLabel} review` : "Change review"}</h2>
          {request && <ChangeReviewPath request={request} />}
        </div></div>
      {target && <span className="stage-review-status">{inThisTab ? "This tab" : "Up next"}</span>}
    </div>
    <p className="review-pane-guidance" role="status">{guidance}</p>
    <div className="review-pane-actions">
      {(!inThisTab || earlier || needsDialog || waiting) && <Button variant="primary" id="continue-pending-review" className="plan-button" type="button" disabled={disabled}
        onClick={event => void continueReview(event.currentTarget)}>
        {inThisTab ? <ListChecks size={15} aria-hidden="true" /> : <ArrowRight size={15} aria-hidden="true" />}
        {waiting ? "Preparing review..." : needsDialog ? "Review change" : earlier ? `${inThisTab ? "Open" : "Review"} ${targetLabel} draft`
          : inThisTab ? "Review in this tab" : `Go to ${targetLabel} review`}
      </Button>}
      {inThisTab && !earlier && !needsDialog && !waiting
        && <span className="review-stage-actions" ref={onActionsContainer} aria-label="Current stage review actions" />}
      <AbandonChangeReview />
      <ReviewDetailsDialog request={request} />
    </div>
    {action.error && <p className="error" role="alert">{action.error}</p>}
  </section>;
}

interface Props {
  initial: UiState;
  parent: UiContextValue;
  active: boolean;
  actionsContainer: HTMLElement | null;
  headerActionsContainer?: HTMLElement | null;
  workingStage: LifecycleStageId;
  onExit(): void;
  onReturn(): void;
}

export function StageReviewWorkspace(props: Props) {
  const id = props.initial.prototypeId;
  const apiUrl = useCallback((endpoint: string) => {
    if (!endpoint.startsWith("/api/")) throw new Error("A draft request must use its scoped Tandem API.");
    return `/api/reviews/${id}${endpoint.slice(4)}`;
  }, [id]);
  const [store] = useState(() => {
    const instance = new StudioStore(undefined, { apiUrl, events: false });
    instance.accept(props.initial);
    return instance;
  });
  const { state, connectionError } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [busy, setBusyKeys] = useState<Set<string>>(() => new Set());
  const changeRequestDialog = useChangeRequestDialog();
  const [dirty, setDirtyKeys] = useState<Set<string>>(() => new Set());
  const setBusy = useCallback((key: string, value: boolean) => setBusyKeys(previous => {
    if (previous.has(key) === value) return previous;
    const next = new Set(previous);
    if (value) next.add(key); else next.delete(key);
    return next;
  }), []);
  const setReviewDirty = useCallback((key: string, value: boolean) => setDirtyKeys(previous => {
    if (previous.has(key) === value) return previous;
    const next = new Set(previous);
    if (value) next.add(key); else next.delete(key);
    return next;
  }), []);
  const post = useCallback(async <T = UiState,>(endpoint: string, body: unknown, timeout?: number): Promise<T> => {
    const result = await store.post<T>(endpoint, body, timeout);
    await store.refresh();
    return result;
  }, [store]);
  useEffect(() => store.connect(), [store]);
  if (!state?.stageReview) return <p role="alert">The saved review draft is unavailable.</p>;
  const value: UiContextValue = {
    ...props.parent, state, post, refresh: store.refresh, apiUrl, setBusy, setReviewDirty, changeRequestDialog,
    pending: busy.size > 0,
    canEdit: stage => stage === state.stageReview?.stage && state.lifecycle.currentStage === stage
      && !changeReviewBlocksEditing(state)
      && state.provider?.canSubmitAnswers !== false && !props.parent.state.effortReset,
    guidance: () => state.stageReviewStatus?.abandonedAt
      ? "This review's changes were abandoned. The saved draft is read-only history."
      : state.stageReviewStatus?.appliedAt
      ? "This applied review is read-only. Its saved changes are now part of accepted work."
      : state.stageReviewStatus?.discardedAt ? "This discarded review is read-only. Its draft changes were not applied."
        : "This review draft is read-only. Accepted work has not been changed.",
    browseStage: stage => {
      if (stage !== state.stageReview?.stage) throw new Error("Use the project tabs to leave this pinned review.");
      if (props.active) props.parent.browseStage(stage);
    },
  };
  return <UiContext.Provider value={value}><DraftProvider>
    <ReviewEditor {...props} dirty={dirty.size > 0} connectionError={connectionError} />
  </DraftProvider></UiContext.Provider>;
}

function ReviewEditor({ parent, active, actionsContainer, headerActionsContainer, workingStage, onExit, onReturn, dirty, connectionError }: Props & {
  dirty: boolean; connectionError: string;
}) {
  const ui = useUi();
  const { state, post, pending, confirm } = ui;
  const stage = state.stageReview!.stage;
  const label = reviewStageLabel(stage);
  const action = useAction("review");
  const [comparisonReady, setComparisonReady] = useState(false);
  const [draftDesignApproval, setDraftDesignApproval] = useState<DraftDesignApproval | null>(null);
  const [reviewControlsContainer, setReviewControlsContainer] = useState<HTMLElement | null>(null);
  const [reviewSummaryContainer, setReviewSummaryContainer] = useState<HTMLElement | null>(null);
  const status = state.stageReviewStatus;
  const settled = Boolean(status?.appliedAt || status?.discardedAt);
  const blocked = pending || hasActiveJobs(state) || state.provider?.canSubmitAnswers === false;
  const unsaved = dirty;
  const needsDesignApproval = stage === "sketch" && !isSketchRevisionApproved(state.sketch, state.requirementsDigest);
  const canApproveDesign = needsDesignApproval && draftDesignApproval?.ready === true;
  const applicationBlockers = state.application?.operations["reviews.apply"]?.blockers.filter(blocker =>
    !(canApproveDesign && blocker.code === "review_not_ready"));
  const latest = useRef({ dirty, state }); latest.current = { dirty, state };
  const error = action.error || connectionError;
  const applyDisabled = blocked || parent.pending || hasActiveJobs(parent.state) || !status || settled
    || Boolean(status.conflict || status.blocker && !canApproveDesign) || !status.changed || unsaved
    || stage === "sketch" && draftDesignApproval?.ready !== true || stage === "requirements" && !comparisonReady
    || Boolean(applicationBlockers?.length);
  const prototypeReady = stage === "prototype" && !prototypeCompletionBlocked(state);
  const queuedPreview = state.prototypeReview.revisions.some((item: { status: string }) => ["queued", "failed"].includes(item.status));
  const requestedChange = state.changeRequests?.find(item => item.id === state.stageReview?.changeRequestId);
  const parentRequest = parent.state.changeRequests?.find(item => item.id === state.stageReview?.changeRequestId);
  const reviewRequest = parentRequest ?? requestedChange;
  const continuingRequest = parentRequest?.status === "reviewing" ? parentRequest : undefined;
  const nextStage = status?.appliedAt && !status.abandonedAt ? pendingUpstreamReviewStage(parent.state) ?? continuingRequest?.remainingStages[0]
    ?? (parent.state.prototypeNeedsUpdate ? "prototype" : undefined) : undefined;
  const nextIsEarlier = nextStage !== undefined && lifecycleStages.findIndex(item => item.id === nextStage)
    < lifecycleStages.findIndex(item => item.id === parent.state.lifecycle.currentStage);
  const canContinue = nextStage !== undefined && Boolean(nextIsEarlier && parent.reviewStage || nextStage === workingStage);
  const step = reviewRequest?.assessment?.stages.findIndex(item => item.stage === stage) ?? -1;
  const returnLabel = `Return to ${reviewStageLabel(workingStage)}`;
  async function apply() {
    if (applyDisabled) return;
    const revision = state.revision;
    if (!await confirm(`Apply the saved ${label} draft? ${needsDesignApproval ? "This also approves the saved design draft. " : ""}${reviewStageLabel(workingStage)} stays current. Affected downstream outputs will need review; existing versions and Development work are retained. This does not authorize implementation.`, "Apply draft changes")) return;
    if (latest.current.dirty || latest.current.state.revision !== revision) {
      action.setError("The draft changed while confirmation was open. Review it before applying.");
      return;
    }
    let draft = latest.current.state;
    if (needsDesignApproval) {
      const approvedDraft = await draftDesignApproval?.approve();
      if (!approvedDraft) {
        action.setError("The design draft could not be approved. Accepted work is unchanged; review the design error before retrying.");
        return;
      }
      draft = approvedDraft;
    }
    void action.run(async () => {
      if (latest.current.dirty || draft.prototypeId !== state.prototypeId || draft.generation !== state.generation) {
        throw new Error("The draft changed. Review its current state before applying.");
      }
      const blocker = draft.stageReviewStatus?.conflict || draft.stageReviewStatus?.blocker;
      if (blocker) throw new Error(blocker);
      if (stage === "sketch" && !isSketchRevisionApproved(draft.sketch, draft.requirementsDigest)) throw new Error("The saved design draft approval could not be confirmed.");
      await parent.post("/api/reviews/apply", { reviewId: draft.prototypeId, expectedRevision: draft.revision });
      await ui.refresh();
    });
  }
  async function discard() {
    if (blocked || settled) return;
    if (!await confirm("Discard this review draft? Accepted work stays unchanged. Saved draft records are retained; unsaved editor changes will be lost.", "Discard review draft")) return;
    void action.run(async () => {
      await parent.post("/api/reviews/discard", { reviewId: state.prototypeId, expectedRevision: state.revision });
      onExit();
    });
  }
  const controls = <>
    {canContinue && nextStage && <Button variant="primary" id="continue-stage-review" className="complete-stage" type="button"
      disabled={pending || parent.pending || hasActiveJobs(parent.state)}
      onClick={() => void action.run(async () => {
        if (nextIsEarlier && parent.reviewStage) await parent.reviewStage(nextStage,
          continuingRequest?.remainingStages[0] === nextStage ? continuingRequest : undefined);
        else { onExit(); onReturn(); }
      })}><ArrowRight size={15} aria-hidden="true" />Review {reviewStageLabel(nextStage)}{nextIsEarlier ? " draft" : " update"}</Button>}
    {!settled && <Button variant="primary" id="apply-stage-review" className="complete-stage" type="button" disabled={applyDisabled}
      title={unsaved ? "Save or finish draft edits before applying." : status?.conflict
        || (canApproveDesign ? "Approve and apply the saved design draft." : status?.blocker)
        || (stage === "requirements" && !comparisonReady ? "Wait for the saved requirements review to load before applying." : "")
        || "Apply the saved draft without moving the current stage."}
      onClick={() => void apply()}><Check size={15} aria-hidden="true" />Apply changes</Button>}
    {stage === "prototype" && !settled && <>
      <Button variant="primary" id="build-review-preview" className="complete-stage" type="button"
        disabled={blocked || Boolean(state.prototypeFlow?.pendingCheckpointId) || !queuedPreview && !state.prototypeNeedsUpdate}
        onClick={() => void action.run(() => post("/api/prototype/start", {}))}><Play size={15} aria-hidden="true" />Build draft preview</Button>
      {!state.prototypeReview.designSpecArtifactId && <Button variant="primary" id="finish-review-prototype" className="complete-stage" type="button"
        disabled={blocked || !prototypeReady} onClick={() => void action.run(() => post("/api/stage/complete", { stageId: "prototype" }))}>
        Save draft outputs</Button>}
    </>}
    {stage === "sketch" && !state.sketch.current && requestedChange && !requestedChange.workStarted.includes("sketch") && !settled
      && <Button variant="primary" id="prepare-review-drawings" className="complete-stage" type="button" disabled={blocked || dirty}
        onClick={() => void action.run(() => post("/api/sketch", {
          action: "generate", expectedRevision: null,
        }))}>Prepare draft designs</Button>}
    <Button variant="secondary" id="return-to-current-stage" className="complete-stage review-secondary" type="button" onClick={onReturn}>
      <ArrowRight size={15} aria-hidden="true" />{returnLabel}</Button>
    <Button variant="secondary" id="exit-stage-review" className="complete-stage review-secondary" type="button" onClick={async () => {
      if (dirty && !await confirm("Leave this review? Saved draft edits are kept, but unsaved editor changes will be lost. Switching to Current work instead keeps the editor open.", "Leave draft review")) return;
      onExit();
    }}><X size={15} aria-hidden="true" />Close review</Button>
  </>;
  const mergedReview = Boolean(actionsContainer);
  const reviewHeading = <div className="stage-review-heading">
    <span className="review-panel-icon"><ListChecks size={20} aria-hidden="true" /></span>
    <div className="review-panel-title">
      <span className="review-eyebrow">{settled ? "Review progress" : "Review in this tab"}{step >= 0 ? ` - Step ${step + 1} of ${reviewRequest!.assessment!.stages.length}` : ""}</span>
      <div className="review-title-row">
        <h2>{label} review</h2>
        {reviewRequest && <ChangeReviewPath request={reviewRequest} reviewingStage={status?.appliedAt ? undefined : stage} />}
      </div>
    </div><span className="stage-review-status" data-status={status?.abandonedAt ? "discarded" : status?.appliedAt ? "applied" : status?.discardedAt ? "discarded" : "draft"}>
      {status?.abandonedAt ? <X size={14} aria-hidden="true" /> : status?.appliedAt ? <Check size={14} aria-hidden="true" /> : <Pin size={14} aria-hidden="true" />}
      {status?.abandonedAt ? "Abandoned" : status?.appliedAt ? "Applied" : status?.discardedAt ? "Discarded" : "Draft only"}</span>
  </div>;
  const reviewBanner = <section className="stage-review-banner" aria-label={`${label} draft review`}>
      <div className="stage-review-breadcrumb"><span>{reviewStageLabel(reviewRequest?.originStage ?? workingStage)}</span>
        <ChevronRight size={12} aria-hidden="true" /><span>Change review</span>
        <ChevronRight size={12} aria-hidden="true" /><span>{label}</span></div>
      {reviewHeading}
      {reviewRequest && <p className="stage-review-request-copy">{reviewRequest.message}</p>}
      <p className="stage-review-safety"><ShieldCheck size={14} aria-hidden="true" />
        {status?.abandonedAt ? "Changes abandoned. The work from before the original request is restored."
          : status?.appliedAt ? `Changes applied. ${reviewStageLabel(workingStage)} is still your current stage.`
          : status?.discardedAt ? "Draft discarded. Accepted work is unchanged."
          : `Accepted work is unchanged until you apply. ${reviewStageLabel(workingStage)} stays current.`}</p>
      {hasActiveJobs(state) && <p role="status">{state.status}</p>}
    </section>;
  const reviewActions = <section className="pinned-review-actions" aria-label={`${label} review and approval`}>
    {mergedReview ? reviewHeading : reviewBanner}
    {stage === "requirements" && <div className="pinned-review-summary" ref={setReviewSummaryContainer} />}
    <ChangeRequestsPanel compact showTrigger={false} />
    <div className="pinned-review-buttons">
      {!settled && <span className="review-stage-actions" ref={setReviewControlsContainer} aria-label="Draft review actions" />}
      {controls}<ReviewDetailsDialog request={reviewRequest} />
      {parentRequest && <UiContext.Provider value={parent}>
        <AbandonChangeReview requestId={parentRequest.id} disabled={blocked} onAbandoned={onExit} />
      </UiContext.Provider>}
      {!settled && <Button variant="secondary" id="discard-stage-review" className="plan-button secondary" type="button" disabled={blocked}
        onClick={() => void discard()}>Discard draft</Button>}
    </div>
    {error && <p id="stage-review-error" role="alert">{error}</p>}
    {!settled && status?.conflict && <p className="error" role="alert">{status.conflict}</p>}
    {!settled && !status?.conflict && status?.blocker && !canApproveDesign && <p className="muted" role="status">{status.blocker}</p>}
    {!settled && status && !status.changed && <p role="status">No saved changes to apply. Edit this draft or discard it to keep accepted work.</p>}
  </section>;
  return <div className="stage-review-workspace" data-review-stage={stage}>
    {active && actionsContainer && createPortal(reviewActions, actionsContainer)}
    <DiscoveryRecovery />
    {stage === "prepare" ? <><PreparationPanel /><DraftBrief /></>
      : stage === "requirements" ? <><BaselineComparison onReadyChange={setComparisonReady}
          renderSummary={summary => active && reviewSummaryContainer ? createPortal(summary, reviewSummaryContainer) : null}>
          {baseline => <RequirementsPanel reviewBaseline={baseline} />}
        </BaselineComparison><DraftRequirementRequest /></>
        : stage === "sketch" ? <SketchPanel onDraftApprovalChange={setDraftDesignApproval}
            renderReviewActions={active && reviewControlsContainer ? actions => createPortal(actions, reviewControlsContainer) : undefined} />
          : <PrototypePanel active={active} connected={!connectionError}
              renderReviewActions={active && reviewControlsContainer ? actions => createPortal(actions, reviewControlsContainer) : undefined}
              renderStageActions={active && headerActionsContainer ? actions => createPortal(actions, headerActionsContainer) : undefined} />}
    {active && !actionsContainer && reviewActions}
  </div>;
}

function DraftBrief() {
  const ui = useUi(), { state, post, pending } = ui;
  const action = useAction("review-brief");
  const [goal, setGoal] = useDraft("review-brief", state.goal);
  useEffect(() => {
    ui.setReviewDirty?.("brief", goal !== state.goal);
    return () => ui.setReviewDirty?.("brief", false);
  }, [goal, state.goal, ui.setReviewDirty]);
  const blocked = pending || hasActiveJobs(state) || !ui.canEdit("prepare");
  return <form className="stage-review-form" onSubmit={event => {
    event.preventDefault();
    void action.run(() => post("/api/goal", { goal, expectedRevision: state.revision }));
  }}>
    <label htmlFor="review-brief">Draft project brief</label>
    <Textarea submitOnEnter id="review-brief" value={goal} onChange={event => setGoal(event.target.value)} rows={3}
      maxLength={4000} disabled={blocked} />
    <Button variant="primary" className="plan-button" type="submit" disabled={blocked || !goal.trim() || goal === state.goal}>Save draft brief</Button>
    <Button variant="secondary" id="analyze-review-brief" className="plan-button secondary" type="button" disabled={blocked || goal !== state.goal}
      onClick={() => void action.run(() => post("/api/preparation/retry", {}))}>Analyze draft brief</Button>
    {action.error && <p role="alert">{action.error}</p>}
  </form>;
}

function DraftRequirementRequest() {
  const ui = useUi(), { state, post, pending } = ui;
  const action = useAction("review-requirements");
  const [text, setText] = useDraft("review-requirement-request", "");
  const [historyOpen, setHistoryOpen] = useDraft("review-requirement-history", false);
  useEffect(() => {
    ui.setReviewDirty?.("requirement-request", Boolean(text.trim()));
    return () => ui.setReviewDirty?.("requirement-request", false);
  }, [text, ui.setReviewDirty]);
  if (state.requirements.substage !== "dag") return null;
  const history = (state.changeRequests ?? []).filter(item => item.originStage === "requirements").slice().reverse();
  return <Disclosure className="stage-review-request"><summary>Add or reshape draft requirements</summary>
    <FeedbackHistory id="requirements-request-history" triggerId="requirements-history-toggle" inline
      label="Requirements request history" open={historyOpen} onClose={() => setHistoryOpen(false)}>
      <ol className="feedback-request-history">{history.map(item => <li key={item.id} data-status={changeRequestHistoryStatus(item)}>
        <p><b>Request:</b> {item.message}</p><p><b>Response:</b> {changeRequestResponse(item)}</p>
        {ui.changeRequestDialog && <Button variant="secondary" className="plan-button secondary" type="button"
          onClick={event => ui.changeRequestDialog!.open(item.id, event.currentTarget)}>View this request</Button>}
      </li>)}</ol>
      {!history.length && <p className="muted">No requirement change requests yet.</p>}
    </FeedbackHistory>
    <form className="stage-review-form feedback-composer" onSubmit={event => {
      event.preventDefault();
      const message = text.trim();
      if (!message) return;
      void action.run(async () => {
        await post("/api/change-requests", { message, originStage: "requirements", expectedGeneration: state.generation });
        setText("");
      });
    }}>
      <label className="visually-hidden" htmlFor="review-requirement-request">Change only this draft</label>
      <Textarea submitOnEnter id="review-requirement-request" className="composer-input" rows={1} maxLength={4000} value={text} onChange={event => setText(event.target.value)}
        placeholder="Describe a requirement change... (Enter to send)"
        disabled={pending || hasActiveJobs(state) || !ui.canEdit("requirements")} />
      <Button variant="primary" className="plan-button feedback-send" type="submit" aria-label="Prepare requirement changes"
        title="Prepare requirement changes (Enter)" disabled={pending || hasActiveJobs(state) || !text.trim() || !ui.canEdit("requirements")}>
        <Send size={15} aria-hidden="true" />Send</Button>
      <FeedbackHistoryButton id="requirements-history-toggle" target="requirements-request-history" open={historyOpen}
        error={Boolean(action.error || history.some(item => changeRequestHistoryStatus(item) === "error"))}
        onToggle={() => setHistoryOpen(open => !open)} />
    </form>
    {action.error && <p role="alert">{action.error}</p>}
  </Disclosure>;
}

function ReviewDetailsDialog({ request }: { request?: ChangeRequest }) {
  const { state } = useUi();
  const pendingCheckpoint = state.prototypeFlow?.checkpoints.find(item => item.id === state.prototypeFlow?.pendingCheckpointId);
  const drafts = state.stageReviews?.filter(item => item.generation === state.generation && !item.appliedAt && !item.discardedAt) ?? [];
  return <Dialog.Root>
    <Dialog.Trigger asChild><Button variant="secondary" className="plan-button secondary" type="button">Details</Button></Dialog.Trigger>
    <Dialog.Portal><Dialog.Overlay className="dialog-overlay" />
      <Dialog.Content className="dialog-content review-details-dialog">
        <header className="review-details-heading"><div>
          <Dialog.Title>Review details</Dialog.Title>
          <Dialog.Description>Inspect the change and its saved context. Viewing details does not apply changes.</Dialog.Description>
        </div><Dialog.Close asChild><IconButton variant="ghost" className="review-close" type="button" aria-label="Close review details"><X size={18} aria-hidden="true" /></IconButton></Dialog.Close></header>
        <div className="review-details-body">
          {request && <section aria-label="Requested change">
            <h3>Change from {reviewStageLabel(request.originStage)}</h3>
            <p className="review-details-request">{request.message}</p>
            {request.assessment && <>
              <p>{request.assessment.summary}</p>
              <p className="muted">{request.assessment.reason}</p>
              <ChangeReviewPath request={request} detailed />
              {request.assessment.preserved.length > 0 && <><h3>Kept unchanged</h3>
                <ul>{request.assessment.preserved.map(item => <li key={item}>{item}</li>)}</ul></>}
            </>}
            {request.clarifications.length > 0 && <><h3>Clarifications</h3>
              {request.clarifications.map((item, index) => <p key={index}><strong>{item.question}</strong><br />{item.answer}</p>)}</>}
          </section>}
          {state.stageReview ? <BaselineComparison /> : !request && <>
            {drafts.length > 0 && <section><h3>Saved review drafts</h3><ul>{drafts.map(draft =>
              <li key={draft.id}>{reviewStageLabel(draft.stage)} - opened {draft.createdAt}</li>)}</ul></section>}
            {pendingCheckpoint && <section><h3>Prepared prototype update</h3><p>{pendingCheckpoint.summary}</p></section>}
            {state.prototypeReview?.question && <section><h3>Clarification needed</h3><p>{state.prototypeReview.question.text}</p></section>}
            {state.prototypeReview?.revisions?.length > 0 && <section><h3>Prototype feedback</h3>
              <ul>{state.prototypeReview.revisions.map((item: { id: string; suggestion?: string; summary?: string; status: string }) =>
                <li key={item.id}>{item.suggestion || item.summary} - {item.status}</li>)}</ul></section>}
          </>}
        </div>
        <footer className="review-details-footer"><Dialog.Close asChild><Button variant="primary" className="plan-button" type="button">Done</Button></Dialog.Close></footer>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

function BaselineComparison({ onReadyChange, renderSummary, children }: {
  onReadyChange?: (ready: boolean) => void;
  renderSummary?: (summary: ReactNode) => ReactNode;
  children?: (baseline: UiState) => ReactNode;
} = {}) {
  const { state, apiUrl } = useUi();
  const [baseline, setBaseline] = useState<{ state: UiState; document: SketchDocument | null } | null>(null);
  const [error, setError] = useState(""), [loading, setLoading] = useState(false);
  const request = useRef(false);
  const stage = state.stageReview!.stage;
  const load = useCallback(async () => {
    if (baseline || request.current) return;
    request.current = true; setLoading(true); setError("");
    try {
      const response = await fetch(apiUrl!("/api/baseline"), { cache: "no-store", signal: AbortSignal.timeout(15000) });
      const result = await response.json();
      if (!response.ok || !result.state?.lifecycle || result.state.prototypeId !== state.stageReview!.parentId
        || result.state.generation !== state.generation || result.state.revision !== state.stageReview!.baselineRevision
        || !Array.isArray(result.state.decisionGraph?.nodes)) {
        throw new Error(result.error || "The accepted baseline is unavailable or no longer matches this draft.");
      }
      setBaseline(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The accepted baseline is unavailable."); }
    finally { request.current = false; setLoading(false); }
  }, [apiUrl, baseline, state.stageReview, state.generation]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { onReadyChange?.(Boolean(baseline)); }, [baseline, onReadyChange]);
  const oldNodes = baseline?.state.decisionGraph.nodes ?? [];
  const description = (node: DecisionNode | undefined) => node ? [
    `Title: ${node.title}`, node.question?.text, `Answer: ${node.answer || "Unanswered"}`,
    node.question?.rationale ? `Reason: ${node.question.rationale}` : "",
    node.question?.choices.length ? `Choices: ${node.question.choices.join(" / ")}` : "",
    node.question?.recommended ? `Recommended: ${node.question.recommended}` : "",
    node.question ? `Free-text answers: ${node.question.allowFreeText === false ? "Not allowed" : "Allowed"}` : "",
    node.question?.answerPlaceholder ? `Answer guidance: ${node.question.answerPlaceholder}` : "",
    node.dependencies.length ? `Depends on: ${node.dependencies.join(", ")}` : "",
  ].filter(Boolean).join("\n") : "Not present";
  const changed = [...new Set([...oldNodes.map(node => node.id), ...state.decisionGraph.nodes.map(node => node.id)])]
    .map(id => ({ before: oldNodes.find(node => node.id === id), after: state.decisionGraph.nodes.find(node => node.id === id) }))
    .filter(({ before, after }) => requirementChange(before, after))
    .map(({ before, after }) => ({ id: `decision:${before?.id ?? after!.id}`, title: after?.title ?? before!.title,
      before: description(before), after: description(after) }));
  if (baseline) {
    for (const [id, title, before, after] of [
      ["usages", "Usages", baseline.state.requirements.usageItems.join("\n"), state.requirements.usageItems.join("\n")],
      ["assumed", "Assumptions", baseline.state.assumed.join("\n"), state.assumed.join("\n")],
      ["deferred", "Deferred work", baseline.state.deferred.join("\n"), state.deferred.join("\n")],
      ["approach", "Prototype approach", `${baseline.state.prototypeApproach.mode}: ${baseline.state.prototypeApproach.reason}`,
        `${state.prototypeApproach.mode}: ${state.prototypeApproach.reason}`],
    ]) if (before !== after) changed.push({ id, title, before: before || "None", after: after || "None" });
  }
  const unanswered = state.decisionGraph.nodes.filter(node => !node.answer).length;
  const abandoned = Boolean(state.stageReviewStatus?.abandonedAt);
  const applied = Boolean(state.stageReviewStatus?.appliedAt);
  const discarded = Boolean(state.stageReviewStatus?.discardedAt);
  const removedQuestions = oldNodes.filter(node => !state.decisionGraph.nodes.some(candidate => candidate.id === node.id));
  const otherChanges = [
    ...(removedQuestions.length ? [`${removedQuestions.length} question${removedQuestions.length === 1 ? "" : "s"} removed`] : []),
    ...changed.filter(row => ["assumed", "deferred", "approach"].includes(row.id)).map(row => row.title),
  ];
  const comparison = <section className="stage-review-comparison" aria-label={children ? "Requirements review summary" : "Accepted baseline comparison"}
    data-unanswered={stage === "requirements" ? unanswered : undefined}>
    <h3 className={renderSummary ? "visually-hidden" : undefined}>{stage === "requirements" ? abandoned ? "Abandoned requirement changes" : applied ? "Applied requirement changes"
      : discarded ? "Discarded requirement draft" : "Review saved requirement changes" : "Compare with the accepted baseline"}</h3>
    {loading && <p role="status">Reading the saved baseline...</p>}
    {error && <p role="alert">{error} <Button variant="secondary" type="button" onClick={() => void load()}>Retry</Button></p>}
    {baseline && <>
      <p className={stage === "requirements" ? "visually-hidden" : "muted"}>Accepted revision {state.stageReview!.baselineRevision}; draft revision {state.revision}.</p>
      {stage === "requirements" && <p role="status">{abandoned ? "These changes were abandoned. The pre-request work is restored; this comparison is retained as history."
        : applied ? "These saved changes have been applied. Independent answers were retained."
        : discarded ? "These draft changes were not applied. The comparison is retained for reference."
        : unanswered
        ? `${unanswered} requirement question${unanswered === 1 ? "" : "s"} still need${unanswered === 1 ? "s" : ""} an answer before Apply. Independent answers are retained.`
        : "No new questions need answers. Review the saved changes before applying."}</p>}
      {stage === "requirements" ? changed.length ? children
        ? otherChanges.length > 0 && <p className="muted">Also changed: {otherChanges.join("; ")}. See Details for the comparison.</p>
        : <table><thead><tr><th scope="col">Requirement</th><th scope="col">Accepted</th><th scope="col">Draft</th></tr></thead>
        <tbody>{changed.map(row => <tr key={row.id}><th scope="row">{row.title}</th><td>{row.before}</td><td>{row.after}</td></tr>)}</tbody>
      </table> : <p>No requirement values differ from the accepted baseline.{state.stageReviewStatus?.changed
        ? " This stage still needs confirmation against the reviewed upstream inputs." : " There are no requirement changes to apply."}</p>
        : stage === "sketch" ? baseline.document?.version === 1
          ? <p>The accepted baseline uses retired geometry. Its files and approval remain in history; regenerate UI DSL views in the draft.</p>
          : baseline.document?.screens.map(screen => <figure key={screen.id} style={{ overflow: "auto" }}>
            <div style={{ width: screen.width, height: screen.height }}><DslView screen={screen} /></div>
            <figcaption>{screen.title} - accepted UI DSL baseline</figcaption></figure>)
          : stage === "prepare" ? <><h3>Accepted brief</h3><p>{baseline.state.goal}</p><p>{baseline.state.preparation.summary}</p></>
            : <><p>{baseline.state.prototypeFlow?.checkpoints.find(item => item.id === baseline.state.prototypeFlow?.displayedCheckpointId)?.summary}</p>
              {baseline.state.previewUrl && <a href={baseline.state.previewUrl} target="_blank" rel="noreferrer">Open accepted preview</a>}</>}
    </>}
  </section>;
  return <>{renderSummary ? renderSummary(comparison) : comparison}{baseline && children?.(baseline.state)}</>;
}
