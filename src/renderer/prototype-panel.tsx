import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowUpRight, Check, ExternalLink, LoaderCircle, Play, RefreshCw, Send, SkipForward, Sparkles } from "lucide-react";
import { RadioGroup, Tooltip } from "radix-ui";
import type { DecisionQuestion } from "../workflow.js";
import { hasActiveJobs, hasStageData, skippedStage, useAction, useDraft, useUi, type UiState } from "./ui-context.js";
import { PreviewRestart } from "./preview-restart.js";
import { awaitingVisualChoice, originalPrototypeCheckpointId, visualExplorationIsCurrent } from "../visual-directions.js";
import { VisualExplorationPanel } from "./visual-exploration-panel.js";
import { HandoffControls } from "./handoff-review.js";

const milestones = [
  { id: "structure", label: "Structure" }, { id: "interaction", label: "Interaction" }, { id: "visual", label: "Visual exploration" },
] as const;
const unresolvedStatuses = ["queued", "processing", "clarifying", "ready", "failed"];
interface Revision { id: string; status: string; suggestion?: string; summary?: string; visualSelection?: unknown }
interface Submission { suggestion: string; baseCheckpointId?: string | null; clientRequestId: string }
function PendingPreviewAvailability({ active, connected }: { active: boolean; connected: boolean }) {
  const { state, apiUrl } = useUi();
  const candidate = state.prototypeFlow?.checkpoints.find(item => item.id === state.prototypeFlow?.pendingCheckpointId);
  const [result, setResult] = useState({ binding: "", available: false, busy: false, reason: "" });
  const [refresh, setRefresh] = useState(0);
  const binding = JSON.stringify([state.generation, candidate?.id, candidate?.previewUrl]);
  useEffect(() => {
    if (!active || !connected || !candidate?.previewUrl) return;
    const controller = new AbortController(); let current = true;
    setResult({ binding, available: false, busy: true, reason: "" });
    void (async () => {
      try {
        const endpoint = "/api/prototype/preview-status?target=pending";
        const response = await fetch(apiUrl?.(endpoint) ?? endpoint, { cache: "no-store", redirect: "error",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(7000)]) });
        const value = await response.json();
        if (!response.ok || value.generation !== state.generation || value.checkpointId !== candidate.id
          || value.pendingCheckpointId !== candidate.id || value.url !== candidate.previewUrl || typeof value.available !== "boolean") {
          throw new Error(value.error || "Pending preview identity changed. Check again.");
        }
        if (current) setResult({ binding, available: value.available, busy: false, reason: String(value.reason || "") });
      } catch (error) {
        if (current) setResult({ binding, available: false, busy: false, reason: error instanceof Error ? error.message : "Pending preview is unavailable." });
      }
    })();
    return () => { current = false; controller.abort(); };
  }, [active, connected, binding, refresh]);
  if (!candidate) return null;
  const verified = result.binding === binding && result.available && !result.busy;
  return <details id="pending-preview-availability" className="preview-verification-details" open={!verified}>
    <summary>{verified ? "Pending preview verified" : result.busy ? "Checking pending preview..." : "Pending preview unavailable"}</summary>
    <p role="status">{result.binding !== binding || result.busy ? "Checking pending saved preview..."
      : result.available ? "Pending saved version: live preview verified (not displayed)." : `Pending saved version is unavailable. ${result.reason} Restarting it will not change the displayed version.`}</p>
    {candidate.visual?.operation === "choose" && candidate.visual.selection && <p id="prepared-visual-settings">
      Prepared choice: {candidate.visual.manifest?.directions.find(item => item.id === candidate.visual?.selection?.directionId)?.name}.
      {" "}{Object.values(candidate.visual.selection.settings).join(" / ")}. These saved settings will be applied, not any later comparison draft.
    </p>}
    <button className="plan-button secondary" type="button" disabled={result.busy || !connected} onClick={() => setRefresh(value => value + 1)}>Check pending preview</button>
    {verified && candidate.visual?.operation === "choose" && candidate.previewUrl &&
      <a id="open-prepared-visual" href={candidate.previewUrl} target="_blank" rel="noreferrer">Open prepared direction (not applied)</a>}
    <PreviewRestart target="pending" unavailable={result.binding === binding && !result.available && !result.busy} changed={() => setRefresh(value => value + 1)} />
  </details>;
}

export function milestoneReady(state: UiState, milestone: string): boolean {
  return (state.prototypeFlow?.checkpoints || []).some((checkpoint) => checkpoint.milestone === milestone && checkpoint.status === "ready");
}
export function prototypeCompletionBlocked(state: UiState): boolean {
  const flow = state.prototypeFlow;
  return hasActiveJobs(state) || Boolean(state.prototypeReview?.question)
    || (state.prototypeReview?.revisions || []).some((revision: Revision) => unresolvedStatuses.includes(revision.status))
    || Boolean(flow && (flow.pendingCheckpointId || !milestoneReady(state, "structure") || !milestoneReady(state, "interaction")
      || (flow.visualRequested && !milestoneReady(state, "visual"))));
}
function originOf(url: string | null | undefined) {
  try { const parsed = new URL(url || ""); return ["http:", "https:"].includes(parsed.protocol) ? parsed.origin : null; }
  catch { return null; }
}

function Clarification({ question }: { question: DecisionQuestion }) {
  const { state, pending, post, canEdit } = useUi();
  const action = useAction("prototype-clarification");
  const [draft, setDraft] = useDraft("clarification:" + JSON.stringify(question), { choice: question.recommended || "", detail: "", version: 0 });
  const blocked = pending || !canEdit("prototype") || state.processing?.status === "running";
  return <div id="revision-question" className="revision-question">
    <p id="revision-question-title" className="revision-question-title">{question.text}</p>
    {question.rationale && <p id="revision-question-rationale" className="rationale">{question.rationale}</p>}
    <form id="revision-question-form" className="revision-question-form inline-composer" onSubmit={(event) => {
      event.preventDefault();
      if (blocked) return;
      const answer = draft.detail.trim() || draft.choice;
      if (!answer) { action.setError("Choose an option or enter clarification."); return; }
      const submitted = draft.version;
      void action.run(async () => {
        await post("/api/answer", { questionId: question.id, answer, action: "clarify-revision" });
        setDraft((current) => current.version === submitted ? { choice: "", detail: "", version: submitted + 1 } : current);
      });
    }}>
      <RadioGroup.Root id="revision-question-choices" className="revision-question-choices" name="revision-clarification"
        aria-label={question.text} value={draft.choice} disabled={blocked}
        onValueChange={(choice) => setDraft((current) => ({ choice, detail: "", version: current.version + 1 }))}>
        {(question.choices || []).map((choice, index) => <label key={choice} className="revision-question-choice">
          <RadioGroup.Item className="radio-control" value={choice} id={"clarification-choice-" + index}><RadioGroup.Indicator className="radio-dot" /></RadioGroup.Item>
          <span>{choice}</span>
        </label>)}
      </RadioGroup.Root>
      {question.allowFreeText !== false && <textarea className="composer-input" id="revision-question-detail" value={draft.detail}
        onChange={(event) => {
          const detail = event.currentTarget.value;
          setDraft((current) => ({ detail, choice: detail.trim() ? "" : current.choice, version: current.version + 1 }));
        }}
        maxLength={4000} disabled={blocked} placeholder={question.answerPlaceholder || "Optional clarification"} aria-label="Prototype clarification" />}
      <button id="submit-clarification" type="submit" disabled={blocked}><Check size={16} />{action.busy ? "Sending..." : "Use this answer"}</button>
      <p role="status" className="revision-status" data-status={action.error ? "error" : "idle"}>{action.error}</p>
    </form>
  </div>;
}

export function PrototypePanel({ active: visible, connected, renderActions }: {
  active: boolean; connected: boolean; renderActions?: (actions: ReactNode) => ReactNode;
}) {
  const ui = useUi();
  const { state, pending, post, canEdit, guidance } = ui;
  const previewOwner = state.stageReview?.parentId ?? state.prototypeId;
  const canRequestChange = state.provider?.canSubmitAnswers !== false && !state.effortReset
    && (canEdit("prototype") || state.lifecycle.completedStages.includes("prototype"));
  const latest = useRef(state);
  latest.current = state;
  const latestUi = useRef(ui);
  latestUi.current = ui;
  const action = useAction("prototype-action");
  const revisionAction = useAction("prototype-revision");
  const [draft, setDraft] = useDraft("prototype-revision", { value: "", version: 0 });
  useEffect(() => {
    ui.setReviewDirty?.("prototype-feedback", Boolean(draft.value.trim()));
    return () => ui.setReviewDirty?.("prototype-feedback", false);
  }, [draft.value, ui.setReviewDirty]);
  const submissions = useRef(new Map<string, Submission>());
  const frame = useRef<HTMLIFrameElement>(null);
  const capture = useRef<{ finish: (value?: { state: unknown }) => void } | null>(null);
  const restore = useRef<{ generation: string; checkpointId: string; state: unknown } | null>(null);
  const [elapsed, setElapsed] = useState("");
  const [inspectingVisual, setInspectingVisual] = useState(false);
  const [previewActionsContainer, setPreviewActionsContainer] = useState<HTMLDivElement | null>(null);
  const [previewCheck, setPreviewCheck] = useState({ binding: "", available: false, busy: false, reason: "" });
  const checkSequence = useRef(0);
  const checkController = useRef<AbortController | null>(null);
  const flow = state.prototypeFlow;
  const checkpoints = flow?.checkpoints || [];
  const displayed = checkpoints.find((item) => item.id === flow?.displayedCheckpointId);
  const candidate = checkpoints.find((item) => item.id === flow?.pendingCheckpointId);
  const active = checkpoints.find((item) => item.id === flow?.activeCheckpointId || item.status === "running");
  const failed = checkpoints.filter((item, index) => item.status === "failed" && !item.visualDismissedAt && (item.milestone !== "visual" || flow?.visualRequested)
    && !state.prototypeReview.revisions.some((revision: Revision) => revision.id === item.revisionId && revision.status === "dismissed")
    && !checkpoints.slice(index + 1).some((next) => next.milestone === item.milestone && next.revisionId === item.revisionId)).at(-1);
  const revisions: Revision[] = state.prototypeReview?.revisions || [];
  const candidateMilestone = milestones.find(item => item.id === candidate?.milestone)?.label || "Saved";
  const chosenCandidate = candidate?.visual?.operation === "choose";
  const automaticCandidate = candidate?.revisionId === null && !chosenCandidate;
  const requestedCandidate = Boolean(candidate?.revisionId && revisions.some(item => item.id === candidate.revisionId));
  const candidateLabel = chosenCandidate ? "Selected visual direction ready to accept"
    : automaticCandidate ? `${candidateMilestone} prototype ready to inspect`
    : requestedCandidate ? "Requested prototype revision ready to inspect" : "Saved prototype version ready to inspect";
  const switchLabel = chosenCandidate ? "Accept" : automaticCandidate ? `Show ${candidateMilestone} prototype`
    : requestedCandidate ? "Show requested revision" : "Show saved version";
  const failedRevision = revisions.find((item) => item.status === "failed");
  const unresolved = revisions.filter((item) => unresolvedStatuses.includes(item.status));
  const question: DecisionQuestion | null = state.prototypeReview?.question || null;
  const unavailable = skippedStage(state, "prototype");
  const undecided = state.prototypeApproach?.mode === "undecided";
  const finalizing = ["starting", "running"].includes(state.processing?.status) && state.processing?.action === "generate-design-spec";
  const building = !unavailable && !undecided && state.lifecycle.currentStage === "prototype"
    && (active?.status === "running" || state.previewStatus === "starting"
      || (["build-prototype", "submit-revision", "clarify-revision"].includes(state.processing?.action) && state.processing?.status === "running"));
  const savedOnly = state.lifecycle.completedStages.includes("prototype");
  const original = flow && !savedOnly && visualExplorationIsCurrent(flow)
    ? checkpoints.find(item => item.id === originalPrototypeCheckpointId(flow)) : undefined;
  const shownCheckpoint = original ?? displayed;
  const previewTarget = original ? "original" : "current";
  const previewLabel = original ? "original prototype" : "current preview";
  const url = flow ? shownCheckpoint?.previewUrl || (shownCheckpoint === displayed && displayed ? state.previewUrl : null) : state.previewUrl;
  const readyUrl = originOf(url) && !unavailable && !undecided ? url : null;
  const generation = state.generation;
  const previewId = shownCheckpoint?.id ?? null;
  const pendingId = flow?.pendingCheckpointId ?? null;
  const previewBinding = JSON.stringify([generation, previewId, readyUrl]);
  const checkBinding = JSON.stringify([previewBinding, pendingId]);
  const latestCheckBinding = useRef(checkBinding);
  latestCheckBinding.current = checkBinding;
  const showLivePreview = Boolean(readyUrl) && previewCheck.binding === previewBinding && previewCheck.available;
  const previewUnavailable = previewCheck.binding === previewBinding && !previewCheck.available && !previewCheck.busy;
  const checkPreview = useCallback(async () => {
    if (!readyUrl) return;
    checkController.current?.abort();
    const controller = new AbortController();
    checkController.current = controller;
    const sequence = ++checkSequence.current;
    setPreviewCheck(previous => ({ binding: previewBinding,
      available: previous.binding === previewBinding && previous.available, busy: true, reason: "" }));
    const current = () => checkSequence.current === sequence && latestCheckBinding.current === checkBinding;
    try {
      const endpoint = "/api/prototype/preview-status" + (previewTarget === "original" ? "?target=original" : "");
      const response = await fetch(ui.apiUrl?.(endpoint) ?? endpoint, {
        cache: "no-store", redirect: "error", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(7000)]),
      });
      const value = await response.json();
      if (!response.ok || value.generation !== generation || value.url !== readyUrl || value.checkpointId !== previewId
        || value.pendingCheckpointId !== pendingId || typeof value.available !== "boolean" || typeof value.reason !== "string") {
        throw new Error(value.error || `The ${previewLabel} changed or could not be verified. Check again.`);
      }
      if (current()) setPreviewCheck({ binding: previewBinding, available: value.available, busy: false, reason: value.reason });
    } catch (error) {
      if (current()) setPreviewCheck({ binding: previewBinding, available: false, busy: false,
        reason: error instanceof Error ? error.message : `The ${previewLabel} could not be checked.` });
    }
  }, [readyUrl, generation, previewId, pendingId, previewBinding, checkBinding, previewTarget, previewLabel]);
  useEffect(() => {
    if (visible && connected) void checkPreview();
    return () => { checkSequence.current++; checkController.current?.abort(); };
  }, [visible, connected, checkPreview]);
  const milestonesReady = milestoneReady(state, "structure") && milestoneReady(state, "interaction")
    && (!flow?.visualRequested || milestoneReady(state, "visual"));
  const blocked = pending || !canEdit("prototype") || hasActiveJobs(state) || finalizing || Boolean(question);
  const validation = state.prototypeApproach?.mode === "validate-existing";
  const startVisible = !unavailable && !building && !readyUrl && !flow && state.previewStatus !== "ready" && state.lifecycle.currentStage === "prototype";
  const retryVisible = Boolean(flow || failedRevision) && !candidate && !question && !building
    && Boolean(failed || failedRevision || !milestonesReady || unresolved.length || state.prototypeNeedsUpdate);
  const visualStale = Boolean(flow?.visualExploration && !visualExplorationIsCurrent(flow));
  const visualVisible = Boolean(flow && (!flow.visualExploration && (!flow.visualRequested || milestoneReady(state, "visual")) || visualStale)
    && !building && !hasActiveJobs(state) && milestoneReady(state, "interaction") && !candidate);
  const skipVisible = Boolean(flow?.visualRequested && !flow.visualExploration && !hasActiveJobs(state)
    && failed?.milestone === "visual" && !failed.revisionId);
  const checkpointKey = previewId || "legacy";
  useEffect(() => { if (!flow?.visualExploration || savedOnly) setInspectingVisual(false); },
    [state.generation, flow?.visualExploration?.checkpointId, savedOnly]);
  useEffect(() => {
    if (!building) { setElapsed(""); return; }
    const update = () => {
      const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(active?.requestedAt || state.processing?.requestedAt)) / 1000));
      setElapsed(Number.isFinite(seconds) ? `Elapsed: ${Math.floor(seconds / 60)}m ${seconds % 60}s` : "Elapsed: less than a minute");
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [building, active?.requestedAt, state.processing?.requestedAt]);
  useEffect(() => () => { capture.current?.finish(); restore.current = null; }, []);

  async function capturePreview(): Promise<{ state: unknown } | undefined> {
    capture.current?.finish();
    const source = frame.current?.contentWindow;
    const origin = originOf(readyUrl);
    if (!source || !origin) return undefined;
    return new Promise((resolve) => {
      const requestId = crypto.randomUUID();
      const timer = window.setTimeout(() => finish(), 350);
      const receive = (event: MessageEvent) => {
        if (event.source !== source || event.source !== frame.current?.contentWindow || event.origin !== origin
          || event.data?.type !== "tandem:preview:state" || event.data.requestId !== requestId
          || event.data.prototypeId !== previewOwner || !Object.hasOwn(event.data, "state")) return;
        try {
          const json = JSON.stringify(event.data.state);
          if (json && new TextEncoder().encode(json).byteLength <= 64 * 1024) finish({ state: JSON.parse(json) });
        } catch (error) { console.warn("Ignored a prototype state response that could not be serialized.", error); }
      };
      function finish(value?: { state: unknown }) {
        window.clearTimeout(timer);
        window.removeEventListener("message", receive);
        capture.current = null;
        resolve(value);
      }
      capture.current = { finish };
      window.addEventListener("message", receive);
      try { source.postMessage({ type: "tandem:preview:capture", requestId, prototypeId: previewOwner }, origin); }
      catch (error) { console.warn("Prototype state capture is unavailable; the update can still be applied.", error); finish(); }
    });
  }

  async function applyCheckpoint(checkpointId: string) {
    const identity = latest.current;
    const checkpoint = identity.prototypeFlow?.checkpoints.find(item => item.id === checkpointId);
    if (!latestUi.current.canEdit("prototype") || hasActiveJobs(identity)
      || identity.prototypeFlow?.pendingCheckpointId !== checkpointId || checkpoint?.status !== "ready") {
      throw new Error("The update is no longer ready to apply. Review the current prototype before retrying.");
    }
    try {
      const captured = checkpoint.visual?.operation !== "choose" && frame.current?.dataset.checkpointId === identity.prototypeFlow?.displayedCheckpointId
        ? await capturePreview() : undefined;
      const current = latest.current;
      if (current.prototypeId !== identity.prototypeId || current.generation !== identity.generation
        || !latestUi.current.canEdit("prototype") || hasActiveJobs(current)) {
        throw new Error("The effort changed. Review the current prototype before retrying.");
      }
      if (current.prototypeFlow?.pendingCheckpointId !== checkpointId
        || current.prototypeFlow?.displayedCheckpointId !== identity.prototypeFlow?.displayedCheckpointId
        || current.previewUrl !== identity.previewUrl) {
        throw new Error("The update changed. Review the latest update before applying it.");
      }
      if (captured) restore.current = { generation: identity.generation, checkpointId, state: captured.state };
      await latestUi.current.post("/api/prototype/action", { action: "apply-update", checkpointId, expectedRevision: current.revision });
    } catch (error) { restore.current = null; throw error; }
  }
  async function submitAction(kind: string) {
    if (blocked) return;
    await action.run(async () => {
      if (!latestUi.current.canEdit("prototype") || hasActiveJobs(latest.current)) {
        throw new Error("The prototype changed. Review its current state before retrying.");
      }
      if (kind === "apply-update") {
        if (!candidate) throw new Error("The update is no longer available.");
        await applyCheckpoint(candidate.id);
        return;
      }
      const checkpointId = kind === "visual-back" ? candidate?.id : kind === "retry" ? failed?.id : null;
      await post("/api/prototype/action", { action: kind, ...(checkpointId ? { checkpointId } : {}), expectedRevision: latest.current.revision });
    });
  }
  const message = candidate ? candidateLabel + ". " + (automaticCandidate ? "This is an automatically generated milestone, not a response to feedback. " : "")
    + (candidate.summary || "The next checkpoint has been validated.") + ` Your accepted prototype stays unchanged until you choose ${switchLabel}.`
    : question ? "A revision needs clarification. Keep exploring and queue feedback below."
    : building ? readyUrl ? "Your working preview stays available while the next checkpoint builds." : "Building the first runnable checkpoint. No preview is available yet; you can already queue feedback."
    : failed ? "The latest update failed. " + failed.summary + (readyUrl ? " Your working preview is unchanged." : "")
    : failedRevision ? "A feedback revision failed. Retry the failed revision to continue."
    : flow && awaitingVisualChoice(flow) ? "Accept a different direction, or finish Prototype with the currently applied design."
    : milestonesReady ? "Structure and Interaction are ready. Finish Prototype, or optionally explore visual direction."
    : "Start with Structure, then test one complete Interaction. Visual direction is optional.";
  const revisionMessage = revisionAction.error || (!canRequestChange ? guidance("submit changes")
    : state.stageReview ? "Feedback is saved only in this draft. Use Build draft preview when you want to run it."
    : finalizing ? "The final feature specification is being generated from frozen input. Keep drafting; sending is paused for this handoff."
    : unresolved.length >= 50 ? "The feedback queue is full. Apply or resolve existing updates before sending more; your draft is kept."
    : !readyUrl ? "You can queue feedback before the first preview is ready."
    : hasActiveJobs(state) ? "Keep using the displayed preview. New feedback is queued while the next update builds."
    : question ? "Answer the clarification to continue that revision. You can queue other feedback meanwhile."
    : candidate ? candidateLabel + ". Switching the displayed version is separate from optional feedback."
    : "Try the prototype, then describe any revision you want.");
  const recentApplied = new Set(revisions.filter((item) => item.status === "applied").slice(-5).map((item) => item.id));
  const importantProgress = Boolean(candidate || failed || failedRevision || question);
  const previewActions = <div ref={setPreviewActionsContainer} className="prototype-preview-actions">
    {!inspectingVisual && readyUrl && <Tooltip.Root><Tooltip.Trigger asChild>
      <button id={`retry-${previewTarget}-preview`} className="plan-button secondary preview-recovery-action" type="button"
        aria-label={`Recheck ${previewLabel}`} data-error={previewUnavailable} disabled={!connected || !visible || previewCheck.busy}
        onClick={() => void checkPreview()}><RefreshCw size={16} aria-hidden="true" /></button>
    </Tooltip.Trigger><Tooltip.Portal><Tooltip.Content className="preview-recovery-tooltip" sideOffset={6}>
      <strong>Recheck {previewLabel}</strong>{previewCheck.reason && <p>{previewCheck.reason}</p>}
      <p>Recheck the saved preview. Does not rebuild, regenerate, or restart it.</p>
    </Tooltip.Content></Tooltip.Portal></Tooltip.Root>}
    {!inspectingVisual && readyUrl && <PreviewRestart target={previewTarget} unavailable={previewUnavailable}
      changed={() => void checkPreview()} iconOnly />}
    {!inspectingVisual && readyUrl && showLivePreview && <a id="open-preview" className="plan-button secondary preview-open-action"
      href={readyUrl} target="_blank" rel="noreferrer" aria-label={`Open ${previewLabel}`} title={`Open ${previewLabel}`}
      data-status-help={`Open the ${previewLabel} in a new tab. Pending updates and visual alternatives are not applied.`}>
      <ExternalLink size={16} aria-hidden="true" />
    </a>}
  </div>;

  return <>
    {renderActions ? renderActions(previewActions) : previewActions}
    <div className="preview-surface">
      {savedOnly && state.lifecycle.outputs.some(output => output.stageId === "prototype") && !finalizing && <section className="prototype-progress" aria-label="Saved Prototype next step">
        {!state.stageReview && <HandoffControls prototype active={visible} />}
        <button className="plan-button secondary" type="button" onClick={() => ui.browseStage("development")}>Open Development</button>
        <details><summary>Returning later</summary><p>The saved Prototype remains available for review in Development. Opening Development does not submit it; confirm the handoff when ready.</p></details>
      </section>}
      <span id="preview-status" className="visually-hidden" role="status">{unavailable ? "not applicable" : finalizing ? "Finishing prototype..."
          : readyUrl && state.prototypeNeedsUpdate
            ? "Saved prototype - requested update pending"
          : readyUrl && !showLivePreview ? previewCheck.binding !== previewBinding || previewCheck.busy ? "Checking saved preview..." : "Saved prototype · preview unavailable"
          : savedOnly ? "Saved prototype · live preview verified" : candidate ? candidateLabel
          : inspectingVisual ? "Exploring visual directions · current prototype unchanged"
          : building ? readyUrl ? "Current preview live · next milestone building" : "Building first preview..."
          : readyUrl ? original ? "Currently showing: Default (original prototype)" : displayed ? `Currently showing: ${displayed.visual?.manifest
            ? displayed.visual.manifest.directions.find(item => item.id === displayed.visual?.manifest?.defaultSelection.directionId)?.name || "Chosen visual direction"
            : milestones.find(item => item.id === displayed.milestone)?.label || "Current prototype"}` : "Current preview live" : "No runnable preview yet"}</span>
      {readyUrl && <p id="preview-availability" className={previewUnavailable ? "revision-status" : "visually-hidden"} role="status"
        data-status={previewUnavailable ? "error" : "idle"} hidden={inspectingVisual || showLivePreview && !previewCheck.busy}>
        {!connected ? `Connection interrupted. The ${previewLabel} will be checked when the workspace reconnects.`
          : previewCheck.binding !== previewBinding || previewCheck.busy ? "Checking current preview..."
          : showLivePreview ? "Current preview verified."
          : `${original ? "Original prototype" : "Current preview"} unavailable. ${previewCheck.reason} Use the toolbar to recheck or restart it.`}
        {!showLivePreview && " Saved version, pending update and feedback are preserved. Checking does not start a server or model work."}
      </p>}
      <PendingPreviewAvailability active={visible} connected={connected} />
      <section id="prototype-progress" className="prototype-progress" aria-label="Prototype progress"
        aria-describedby={importantProgress ? "prototype-progress-message" : undefined}
        hidden={Boolean(unavailable) || (!flow && ((Boolean(readyUrl) && !failedRevision) || state.lifecycle.currentStage !== "prototype"))}>
        <ol id="prototype-milestones" className="prototype-milestones" aria-label="Prototype substages" hidden={!flow && Boolean(readyUrl)}>
          {milestones.map((milestone) => {
            const latest = checkpoints.filter((checkpoint) => checkpoint.milestone === milestone.id && !checkpoint.visualDismissedAt).at(-1)
              || checkpoints.filter(checkpoint => checkpoint.milestone === milestone.id).at(-1);
            const skipped = milestone.id === "visual" && !flow?.visualRequested && (latest?.status === "failed" || Boolean(flow?.visualExploration));
            const label = skipped ? "Skipped (optional)" : latest?.id === candidate?.id && candidate ? "Ready to inspect - not displayed"
              : latest?.status === "running" ? "Building" : latest?.status === "clarifying" ? "Needs clarification" : latest?.status === "failed" ? "Failed - retry available"
              : milestone.id === "visual" && flow && awaitingVisualChoice(flow) ? "Compare & choose"
              : milestoneReady(state, milestone.id) ? "Ready" : milestone.id === "visual" && !flow?.visualRequested ? "Optional" : "Waiting";
            return <li key={milestone.id} data-milestone={milestone.id} data-status={skipped ? "skipped" : latest?.status || "waiting"} aria-current={active?.milestone === milestone.id ? "step" : undefined}>
              <strong>{milestone.label}</strong><span>{label}</span>
            </li>;
          })}
        </ol>
        <div className="prototype-actions">
          <button id="apply-prototype-update" className="plan-button" hidden={!candidate || chosenCandidate && Boolean(flow?.visualExploration)} disabled={blocked}
            title="Switch the displayed preview to this saved version." onClick={() => void submitAction("apply-update")}><ArrowUpRight size={16} />{switchLabel}</button>
          <button id="visual-back" className="plan-button secondary" hidden={!chosenCandidate || Boolean(flow?.visualExploration)} disabled={blocked}
            onClick={() => void submitAction("visual-back")}>Back to alternatives</button>
          <button id="request-prototype-visual" className="plan-button" hidden={!visualVisible} disabled={blocked || unresolved.length > 0} onClick={() => void submitAction("visual")}><Sparkles size={16} />{visualStale ? "Explore current prototype" : "Explore visual directions (optional)"}</button>
          <button id="skip-prototype-visual" className="plan-button secondary" hidden={!skipVisible} disabled={blocked}
            onClick={() => void submitAction("skip-visual")}><SkipForward size={16} aria-hidden="true" />Skip visual direction</button>
          <button id="retry-prototype-checkpoint" className="plan-button" hidden={!retryVisible || Boolean(state.stageReview)} disabled={blocked} onClick={() => void submitAction("retry")}><RefreshCw size={16} />{failed ? "Retry " + milestones.find((item) => item.id === failed.milestone)?.label : failedRevision ? "Retry failed revision" : state.prototypeNeedsUpdate ? "Update for reviewed inputs" : "Continue prototype work"}</button>
        </div>
        {importantProgress && <p id="prototype-progress-message" className="muted"
          role="status" data-essential="true">{message}</p>}
      </section>
      <p id="prototype-action-status" className="revision-status" role="status" data-status={action.error ? "error" : "idle"}>{action.error}</p>
      <div id="prototype-building" className="prototype-building" role="status" hidden={!building}>
        <div className="prototype-building-card"><LoaderCircle className="spin" size={20} /><span className="processing-copy">
          <strong id="prototype-building-title">{active ? "Building " + milestones.find((item) => item.id === active.milestone)?.label : validation ? "Validating existing prototype" : "Building runnable prototype"}</strong>
          <span id="prototype-building-message" className="muted">{state.processing?.message || active?.focus || state.status}</span>
          <span id="prototype-building-elapsed" className="muted" role="timer" aria-live="off">{elapsed}</span>
        </span></div>
      </div>
      <p id="prototype-build-status" className="revision-status" role="status" data-status={state.previewStatus === "error" ? "error" : "idle"}>{state.previewStatus === "error" ? state.processing?.message || state.status || "The preview is unavailable." : ""}</p>
      {flow?.visualExploration && <VisualExplorationPanel active={visible} connected={connected}
        inspecting={inspectingVisual} onInspectChange={setInspectingVisual} onApply={applyCheckpoint}
        defaultPreviewReady={showLivePreview}
        renderActions={actions => previewActionsContainer ? createPortal(actions, previewActionsContainer) : null} />}
      <div id="preview-empty" className="preview-empty" hidden={Boolean(readyUrl)}>
        <div><p id="preview-empty-message">{unavailable ? "Live prototype is not applicable. " + unavailable.reason : undecided
          ? "Choose the prototype approach in Requirements before starting prototype work." : building
          ? "The runnable preview will appear here after its first checkpoint is validated. Feedback can be queued below." : validation
          ? "No prototype validation is running. Validate the existing app without replacing it." : "No prototype build is running. Start a build to create the runnable preview."}</p>
          <button id="start-prototype" className="plan-button" hidden={!startVisible} disabled={pending || !canEdit("prototype") || hasActiveJobs(state)}
            onClick={() => void action.run(() => post("/api/prototype/start", {}))}><Play size={16} />{validation ? state.previewStatus === "error" ? "Retry existing prototype validation" : "Validate existing prototype" : state.previewStatus === "error" ? "Retry prototype build" : "Start prototype"}</button>
        </div>
      </div>
      <iframe key={checkpointKey + ":" + (showLivePreview ? "verified" : "unverified")} id="preview-frame" ref={frame} title="Runnable prototype" src={showLivePreview ? readyUrl || undefined : undefined} hidden={!showLivePreview || inspectingVisual}
        data-url={readyUrl || ""} data-checkpoint-id={previewId || ""} referrerPolicy="origin"
        sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
        onLoad={(event) => {
          if (!showLivePreview || event.currentTarget !== frame.current) return;
          const saved = restore.current;
          if (!saved || saved.generation !== latest.current.generation || saved.checkpointId !== previewId
            || saved.checkpointId !== latest.current.prototypeFlow?.displayedCheckpointId) return;
          const origin = originOf(readyUrl);
          if (!origin) return;
          restore.current = null;
          try { frame.current?.contentWindow?.postMessage({ type: "tandem:preview:restore", prototypeId: previewOwner, state: saved.state }, origin); }
          catch (error) { console.warn("Prototype state could not be restored; the updated preview remains available.", error); }
        }} />
    </div>
    <section id="prototype-review" className="prototype-review" hidden={!hasStageData(state, "prototype") || Boolean(unavailable)}>
      <div className="prototype-review-heading"><strong>{inspectingVisual || original && original.id !== displayed?.id ? "Feedback for accepted prototype" : "Feedback"}</strong></div>
      <form id="revision-form" className="revision-form inline-composer" aria-describedby="revision-status" onSubmit={(event) => {
        event.preventDefault();
        if (pending || !canRequestChange || finalizing) return;
        const suggestion = draft.value.trim();
        if (!suggestion || suggestion.length > 4000 || unresolved.length >= 50) {
          revisionAction.setError(unresolved.length >= 50 ? "The feedback queue is full (50 unresolved revisions). Apply or resolve existing updates, then send this draft."
            : suggestion.length > 4000 ? "Keep the revision suggestion within 4,000 characters." : "Enter a revision suggestion."); return;
        }
        let submission = submissions.current.get(suggestion);
        if (!submission) {
          submission = { suggestion, baseCheckpointId: flow?.displayedCheckpointId || (state.previewStatus === "ready" && !flow ? undefined : null), clientRequestId: crypto.randomUUID() };
          submissions.current.set(suggestion, submission);
        }
        const submitted = draft.version;
        void revisionAction.run(async () => {
          await post("/api/revision", submission);
          submissions.current.delete(suggestion);
          setDraft((current) => current.version === submitted ? { value: "", version: submitted + 1 } : current);
        });
      }}>
        <textarea className="composer-input" id="revision-input" value={draft.value} onChange={(event) => {
          const value = event.currentTarget.value;
          setDraft((current) => ({ value, version: current.version + 1 }));
        }}
          rows={1} maxLength={4000} disabled={Boolean(state.effortReset)} placeholder="Describe one change you want to see in the prototype." aria-label="Prototype revision suggestion" aria-describedby="revision-status" />
        <button id="submit-revision" type="submit" aria-describedby="revision-status" disabled={pending || !canRequestChange || finalizing || unresolved.length >= 50}><Send size={16} />{revisionAction.busy ? state.stageReview ? "Saving..." : "Sending..." : state.stageReview ? "Save draft feedback" : hasActiveJobs(state) || question || candidate || !readyUrl ? "Queue change" : "Send change"}</button>
      </form>
      {question && <Clarification key={JSON.stringify(question)} question={question} />}
      <details id="revision-history-details" className="revision-history-details" hidden={!revisions.length}>
        <summary>Revision history <span id="revision-queue-summary" className="muted" role="status">{unresolved.length ? `${revisions.filter((item) => item.status === "queued").length} queued · ${unresolved.length} unresolved / 50` : ""}</span></summary>
        <ul id="revision-history" className="revision-history">{revisions.filter((item) => item.status !== "applied" || recentApplied.has(item.id)).slice().reverse().map((revision) =>
          <li key={revision.id} data-revision-id={revision.id} data-status={revision.status}><strong title={revision.summary}>{revision.suggestion || revision.summary}</strong>
            <span>{revision.visualSelection ? "Visual direction · " : ""}{{ queued: "Queued", processing: "Building update", clarifying: "Needs clarification", ready: "Update ready - not applied", applied: "Applied", dismissed: "Put aside - current kept", failed: "Failed - retry needed" }[revision.status] || revision.status}</span></li>)}</ul>
      </details>
      <p id="revision-status" className={revisionAction.error || unresolved.length >= 50 || finalizing || question ? "revision-status" : "visually-hidden"} role="status" data-status={revisionAction.error || unresolved.length >= 50 ? "error" : "idle"}
        data-essential={Boolean(revisionAction.error || unresolved.length >= 50 || !canEdit("prototype") || finalizing || question)}>{revisionMessage}</p>
    </section>
  </>;
}
