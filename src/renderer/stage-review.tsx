import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, Check, Pin, Play, X } from "lucide-react";
import type { LifecycleStageId } from "../types.js";
import { renderSketchSvg, type SketchDocument } from "../sketch.js";
import { lifecycleStages, type DecisionNode } from "../workflow.js";
import { StudioStore } from "./state-store.js";
import { DraftProvider, hasActiveJobs, UiContext, useAction, useDraft, useUi, type UiContextValue, type UiState } from "./ui-context.js";
import { PreparationPanel } from "./preparation-panel.js";
import { RequirementsPanel } from "./requirements-panel.js";
import { SketchCompletionContext, SketchPanel } from "./sketch-panel.js";
import { PrototypePanel, prototypeCompletionBlocked } from "./prototype-panel.js";
import { ChangeRequestsPanel } from "./change-requests-panel.js";
import { DiscoveryRecovery } from "./discovery-recovery.js";

export const reviewStageLabel = (stage: LifecycleStageId) => stage === "sketch" ? "Drawings"
  : lifecycleStages.find(item => item.id === stage)?.label ?? stage;

interface Props {
  initial: UiState;
  parent: UiContextValue;
  active: boolean;
  actionsContainer: HTMLElement | null;
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
    ...props.parent, state, post, refresh: store.refresh, apiUrl, setBusy, setReviewDirty,
    pending: busy.size > 0,
    canEdit: stage => stage === state.stageReview?.stage && state.lifecycle.currentStage === stage
      && state.provider?.canSubmitAnswers !== false && !props.parent.state.effortReset,
    guidance: () => "This review draft is read-only. Accepted work has not been changed.",
    browseStage: stage => {
      if (stage !== state.stageReview?.stage) throw new Error("Use the project tabs to leave this pinned review.");
      if (props.active) props.parent.browseStage(stage);
    },
  };
  return <UiContext.Provider value={value}><DraftProvider>
    <ReviewEditor {...props} dirty={dirty.size > 0} connectionError={connectionError} />
  </DraftProvider></UiContext.Provider>;
}

function ReviewEditor({ parent, active, actionsContainer, workingStage, onExit, onReturn, dirty, connectionError }: Props & {
  dirty: boolean; connectionError: string;
}) {
  const ui = useUi();
  const { state, post, pending, confirm } = ui;
  const stage = state.stageReview!.stage;
  const label = reviewStageLabel(stage);
  const action = useAction("review");
  const [sketchBlocked, setSketchBlocked] = useState(true);
  const status = state.stageReviewStatus;
  const settled = Boolean(status?.appliedAt || status?.discardedAt);
  const blocked = pending || hasActiveJobs(state) || state.provider?.canSubmitAnswers === false;
  const unsaved = dirty || stage === "sketch" && sketchBlocked;
  const latest = useRef({ dirty, state }); latest.current = { dirty, state };
  const error = action.error || connectionError;
  const applyDisabled = blocked || parent.pending || hasActiveJobs(parent.state) || !status || settled
    || Boolean(status.conflict || status.blocker) || !status.changed || unsaved;
  const prototypeReady = stage === "prototype" && !prototypeCompletionBlocked(state) && !state.prototypeNeedsUpdate;
  const queuedPreview = state.prototypeReview.revisions.some((item: { status: string }) => ["queued", "failed"].includes(item.status));
  const requestedChange = state.changeRequests?.find(item => item.id === state.stageReview?.changeRequestId);
  async function apply() {
    if (applyDisabled) return;
    const revision = state.revision;
    if (!await confirm(`Apply the saved ${label} draft? ${reviewStageLabel(workingStage)} stays current. Affected downstream outputs will need review; existing versions and Development work are retained. This does not authorize implementation.`, "Apply draft changes")) return;
    void action.run(async () => {
      if (latest.current.dirty || latest.current.state.revision !== revision) throw new Error("The draft changed while confirmation was open. Review it before applying.");
      await parent.post("/api/reviews/apply", { reviewId: state.prototypeId, expectedRevision: revision });
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
    {!settled && <button id="apply-stage-review" className="complete-stage" type="button" disabled={applyDisabled}
      title={unsaved ? "Save or finish draft edits before applying." : status?.conflict || status?.blocker || "Apply the saved draft without moving the current stage."}
      onClick={() => void apply()}><Check size={15} aria-hidden="true" />Apply changes</button>}
    {stage === "prototype" && !settled && <>
      <button id="build-review-preview" className="complete-stage" type="button"
        disabled={blocked || Boolean(state.prototypeFlow?.pendingCheckpointId) || !queuedPreview && !state.prototypeNeedsUpdate}
        onClick={() => void action.run(() => post("/api/prototype/start", {}))}><Play size={15} aria-hidden="true" />Build draft preview</button>
      {!state.prototypeReview.designSpecArtifactId && <button id="finish-review-prototype" className="complete-stage" type="button"
        disabled={blocked || !prototypeReady} onClick={() => void action.run(() => post("/api/stage/complete", { stageId: "prototype" }))}>
        Save draft outputs</button>}
    </>}
    {stage === "sketch" && requestedChange && !requestedChange.workStarted.includes("sketch") && !settled
      && <button id="prepare-review-drawings" className="complete-stage" type="button" disabled={blocked || dirty}
        onClick={() => void action.run(() => post("/api/sketch", {
          action: state.sketch.status === "stale" || !state.sketch.current ? "generate" : "revise",
          expectedRevision: state.sketch.current?.id ?? null,
          ...(state.sketch.status !== "stale" && state.sketch.current ? { instruction: requestedChange.message } : {}),
        }))}>Prepare draft drawings</button>}
    <button id="return-to-current-stage" className="complete-stage review-secondary" type="button" onClick={onReturn}>
      <ArrowRight size={15} aria-hidden="true" />Current work</button>
    <button id="exit-stage-review" className="complete-stage review-secondary" type="button" onClick={async () => {
      if (dirty && !await confirm("Leave this review? Saved draft edits are kept, but unsaved editor changes will be lost. Switching to Current work instead keeps the editor open.", "Leave draft review")) return;
      onExit();
    }}><X size={15} aria-hidden="true" />Exit review</button>
  </>;
  return <div className="stage-review-workspace" data-review-stage={stage}>
    {active && actionsContainer && createPortal(controls, actionsContainer)}
    <section className="stage-review-banner" aria-label={`${label} draft review`}>
      <strong><Pin size={14} aria-hidden="true" />{label} - {status?.appliedAt ? "Applied review" : "Pinned draft review"}</strong>
      <span>Current work: {reviewStageLabel(workingStage)}</span>
      <p>{status?.appliedAt ? "Changes applied. This review stays pinned until you leave it."
        : "Draft only. Apply changes updates accepted work without moving the current stage."}</p>
      {requestedChange && <p><strong>Requested change:</strong> {requestedChange.message}</p>}
      {error && <p id="stage-review-error" role="alert">{error}</p>}
      {!settled && status?.conflict && <p role="alert">{status.conflict}</p>}
      {!settled && !status?.conflict && status?.blocker && <p role="status">{status.blocker}</p>}
      {hasActiveJobs(state) && <p role="status">{state.status}</p>}
      {stage === "sketch" && <p className="muted">GPT-live stays with current-stage editing. Use the drawing editor or revision instructions in this draft.</p>}
      <div className="stage-review-tools"><BaselineComparison />
        {!settled && <button id="discard-stage-review" className="plan-button secondary" type="button" disabled={blocked}
          onClick={() => void discard()}>Discard draft</button>}</div>
    </section>
    <DiscoveryRecovery />
    {stage === "prepare" ? <><DraftBrief /><PreparationPanel /></>
      : stage === "requirements" ? <><DraftRequirementRequest /><ChangeRequestsPanel /><RequirementsPanel /></>
        : stage === "sketch" ? <SketchCompletionContext.Provider value={setSketchBlocked}><SketchPanel /></SketchCompletionContext.Provider>
          : <PrototypePanel active={active} connected={!connectionError}
              renderActions={active && actionsContainer ? actions => createPortal(actions, actionsContainer) : undefined} />}
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
    <textarea id="review-brief" value={goal} onChange={event => setGoal(event.target.value)} rows={3}
      maxLength={4000} disabled={blocked} />
    <button className="plan-button" type="submit" disabled={blocked || !goal.trim() || goal === state.goal}>Save draft brief</button>
    <button id="analyze-review-brief" className="plan-button secondary" type="button" disabled={blocked || goal !== state.goal}
      onClick={() => void action.run(() => post("/api/preparation/retry", {}))}>Analyze draft brief</button>
    {action.error && <p role="alert">{action.error}</p>}
  </form>;
}

function DraftRequirementRequest() {
  const ui = useUi(), { state, post, pending } = ui;
  const action = useAction("review-requirements");
  const [text, setText] = useDraft("review-requirement-request", "");
  useEffect(() => {
    ui.setReviewDirty?.("requirement-request", Boolean(text.trim()));
    return () => ui.setReviewDirty?.("requirement-request", false);
  }, [text, ui.setReviewDirty]);
  if (state.requirements.substage !== "dag") return null;
  return <details className="stage-review-request"><summary>Add or reshape draft requirements</summary>
    <form className="stage-review-form" onSubmit={event => {
      event.preventDefault();
      const message = text.trim();
      if (!message) return;
      void action.run(async () => {
        await post("/api/change-requests", { message, originStage: "requirements", expectedGeneration: state.generation });
        setText("");
      });
    }}>
      <label htmlFor="review-requirement-request">Change only this draft</label>
      <textarea id="review-requirement-request" rows={2} maxLength={4000} value={text} onChange={event => setText(event.target.value)}
        disabled={pending || hasActiveJobs(state) || !ui.canEdit("requirements")} />
      <button className="plan-button" type="submit" disabled={pending || hasActiveJobs(state) || !text.trim() || !ui.canEdit("requirements")}>
        Prepare requirement changes</button>
      {action.error && <p role="alert">{action.error}</p>}
    </form>
  </details>;
}

function BaselineComparison() {
  const { state, apiUrl } = useUi();
  const [baseline, setBaseline] = useState<{ state: UiState; document: SketchDocument | null } | null>(null);
  const [error, setError] = useState(""), [loading, setLoading] = useState(false);
  const request = useRef(false);
  const stage = state.stageReview!.stage;
  async function load() {
    if (baseline || request.current) return;
    request.current = true; setLoading(true); setError("");
    try {
      const response = await fetch(apiUrl!("/api/baseline"), { cache: "no-store", signal: AbortSignal.timeout(15000) });
      const result = await response.json();
      if (!response.ok || !result.state?.lifecycle) throw new Error(result.error || "The accepted baseline is unavailable.");
      setBaseline(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The accepted baseline is unavailable."); }
    finally { request.current = false; setLoading(false); }
  }
  const oldNodes = baseline?.state.decisionGraph.nodes ?? [];
  const content = (node: DecisionNode | undefined) => node && ({
    title: node.title, question: node.question, answer: node.answer, dependencies: node.dependencies,
  });
  const description = (node: DecisionNode | undefined) => node ? [
    node.question?.text, `Answer: ${node.answer || "Unanswered"}`,
    node.question?.choices.length ? `Choices: ${node.question.choices.join(" / ")}` : "",
    node.dependencies.length ? `Depends on: ${node.dependencies.join(", ")}` : "",
  ].filter(Boolean).join("\n") : "Not present";
  const changed = [...new Set([...oldNodes.map(node => node.id), ...state.decisionGraph.nodes.map(node => node.id)])]
    .map(id => ({ before: oldNodes.find(node => node.id === id), after: state.decisionGraph.nodes.find(node => node.id === id) }))
    .filter(({ before, after }) => JSON.stringify(content(before)) !== JSON.stringify(content(after)))
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
  return <details className="stage-review-comparison" onToggle={event => { if (event.currentTarget.open) void load(); }}>
    <summary>Compare with the accepted baseline</summary>
    {loading && <p role="status">Reading the saved baseline...</p>}
    {error && <p role="alert">{error} <button type="button" onClick={() => void load()}>Retry</button></p>}
    {baseline && <>
      <p className="muted">Accepted revision {state.stageReview!.baselineRevision}; draft revision {state.revision}.</p>
      {stage === "requirements" ? changed.length ? <table><thead><tr><th>Requirement</th><th>Accepted</th><th>Draft</th></tr></thead>
        <tbody>{changed.map(row => <tr key={row.id}><th>{row.title}</th><td>{row.before}</td><td>{row.after}</td></tr>)}</tbody>
      </table> : <p>No requirement changes saved in this draft.</p>
        : stage === "sketch" ? baseline.document?.screens.map(screen => <figure key={screen.id}>
          <img alt={`Accepted drawing: ${screen.title}`} src={"data:image/svg+xml;charset=utf-8," + encodeURIComponent(renderSketchSvg(screen))} />
          <figcaption>{screen.title} - accepted baseline</figcaption></figure>)
          : stage === "prepare" ? <><h3>Accepted brief</h3><p>{baseline.state.goal}</p><p>{baseline.state.preparation.summary}</p></>
            : <><p>{baseline.state.prototypeFlow?.checkpoints.find(item => item.id === baseline.state.prototypeFlow?.displayedCheckpointId)?.summary}</p>
              {baseline.state.previewUrl && <a href={baseline.state.previewUrl} target="_blank" rel="noreferrer">Open accepted preview</a>}</>}
    </>}
  </details>;
}
