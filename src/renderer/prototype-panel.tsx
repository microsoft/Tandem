import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, Check, ExternalLink, LoaderCircle, Play, RefreshCw, Send, SkipForward, Sparkles } from "lucide-react";
import { RadioGroup } from "radix-ui";
import type { DecisionQuestion } from "../workflow.js";
import { hasActiveJobs, hasStageData, skippedStage, useAction, useDraft, useUi, type UiState } from "./ui-context.js";
import { SpeechTextarea } from "./speech-textarea.js";
import { HandoffControls } from "./handoff-review.js";

const milestones = [
  { id: "structure", label: "Structure" }, { id: "interaction", label: "Interaction" }, { id: "visual", label: "Visual direction" },
] as const;
const unresolvedStatuses = ["queued", "processing", "clarifying", "ready", "failed"];
interface Revision { id: string; status: string; suggestion?: string; summary?: string }
interface Submission { suggestion: string; baseCheckpointId?: string | null; clientRequestId: string }
interface PreviewRestartInspection {
  needsRecipe: boolean; confirmationId?: string; target: "current" | "pending"; checkpointId: string;
  cwd: string; url: string; executable: string; args?: string[]; entrypoints?: string[]; message: string;
}

function PreviewRestart({ target, unavailable, changed }: { target: "current" | "pending"; unavailable: boolean; changed(): void }) {
  const { state, pending } = useUi();
  const [inspection, setInspection] = useState<PreviewRestartInspection | null>(null);
  const [entrypoint, setEntrypoint] = useState(""), [argumentsText, setArgumentsText] = useState("[]");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [status, setStatus] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const blocked = pending || state.provider?.canSubmitAnswers === false || hasActiveJobs(state);
  const prefix = target === "current" ? "current" : "pending";
  async function request(action: string, body: object): Promise<PreviewRestartInspection & { started?: boolean; alreadyRunning?: boolean }> {
    const response = await fetch(`/api/prototype/preview-restart/${action}`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || "Saved preview restart failed.");
    return value;
  }
  async function inspect(recipe = false) {
    if (busy || blocked) return;
    setBusy(true); setError(""); setStatus("");
    try {
      const args: unknown = JSON.parse(argumentsText);
      if (!Array.isArray(args) || args.some(arg => typeof arg !== "string")) throw new Error("Arguments must be a JSON array of strings.");
      const value = await request("inspect", { target, generation: state.generation,
        checkpointId: target === "current" ? state.prototypeFlow?.displayedCheckpointId : state.prototypeFlow?.pendingCheckpointId,
        ...(recipe ? { entrypoint, args } : {}) });
      setInspection(value);
      if (!dialog.current?.open) dialog.current?.showModal();
    } catch (error) { setError(error instanceof Error ? error.message : "Could not inspect the saved preview launch."); }
    finally { setBusy(false); }
  }
  async function decide(approve: boolean) {
    const id = inspection?.confirmationId;
    if (busy) return;
    if (!id) { dialog.current?.close(); setInspection(null); return; }
    setBusy(true); setError("");
    if (approve) setStatus("Starting saved preview. Complete any native permission request in the owning session.");
    try {
      const result = await request("decision", { confirmationId: id, approve });
      if (approve) { setStatus(result.alreadyRunning ? "The selected preview is already running and verified." : "The selected saved preview is running and verified."); changed(); }
      dialog.current?.close(); setInspection(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Restart outcome could not be verified. Retry this same confirmation to reconcile it.");
      setStatus("");
    } finally { setBusy(false); }
  }
  return <div className="preview-restart">
    {unavailable && <button id={`restart-${prefix}-preview`} className="plan-button secondary" type="button" disabled={blocked || busy}
      onClick={() => void inspect()}>{busy ? "Starting preview..." : target === "current" ? "Restart preview" : "Restart pending preview"}</button>}
    {status && <p role="status">{status}</p>}
    {error && !dialog.current?.open && <p role="alert">{error}</p>}
    <dialog ref={dialog} className="preview-restart-dialog" aria-labelledby={`restart-${prefix}-title`}
      onCancel={event => { event.preventDefault(); if (!busy) void decide(false); }}>
      <h2 id={`restart-${prefix}-title`}>{target === "current" ? "Restart current saved preview" : "Restart pending saved version"}</h2>
      <p>{inspection?.message}</p>
      {inspection?.needsRecipe ? <form onSubmit={event => { event.preventDefault(); void inspect(true); }}>
        <p>This adapter runs an existing Node entrypoint only. Other stacks need an explicitly supported launch adapter; no default script is substituted.</p>
        <label>Saved Node entrypoint<input id={`restart-${prefix}-entrypoint`} list={`restart-${prefix}-files`} value={entrypoint}
          onChange={event => setEntrypoint(event.target.value)} placeholder="Choose or enter the existing file path" /></label>
        <datalist id={`restart-${prefix}-files`}>{inspection.entrypoints?.map(path => <option key={path} value={path} />)}</datalist>
        <details><summary>Additional arguments</summary><label>Arguments (JSON array)<textarea value={argumentsText} onChange={event => setArgumentsText(event.target.value)} /></label></details>
        <button type="submit" disabled={busy || !entrypoint.trim()}>Review launch</button>
      </form> : <pre>{inspection && `${inspection.executable}\n${JSON.stringify(inspection.args)}\nWorking directory: ${inspection.cwd}\nSaved URL: ${inspection.url}\nCheckpoint: ${inspection.checkpointId}`}</pre>}
      {error && <p role="alert">{error}</p>}
      {error && inspection?.confirmationId && <button type="button" disabled={busy} onClick={() => void inspect()}>Review a new restart attempt</button>}
      {busy && <p role="status">Starting the selected saved version. Native permission may be waiting in the owning host.</p>}
      <button type="button" disabled={busy} onClick={() => void decide(false)}>Cancel</button>
      {!inspection?.needsRecipe && inspection?.confirmationId && <button id={`confirm-${prefix}-restart`} type="button" disabled={busy} onClick={() => void decide(true)}>Restart this saved version</button>}
    </dialog>
  </div>;
}

function PendingPreviewAvailability({ active, connected }: { active: boolean; connected: boolean }) {
  const { state } = useUi();
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
        const response = await fetch("/api/prototype/preview-status?target=pending", { cache: "no-store", redirect: "error",
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
    <button className="plan-button secondary" type="button" disabled={result.busy || !connected} onClick={() => setRefresh(value => value + 1)}>Check pending preview</button>
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
      {question.allowFreeText !== false && <SpeechTextarea id="revision-question-detail" value={draft.detail} speechKey={JSON.stringify(question)}
        onValueChange={(detail) => setDraft((current) => ({ detail, choice: detail.trim() ? "" : current.choice, version: current.version + 1 }))}
        onSpeechStart={() => {
          const beforeSpeech = { choice: draft.choice, detail: draft.detail };
          return () => setDraft((current) => ({ ...beforeSpeech, version: current.version + 1 }));
        }}
        maxLength={4000} disabled={blocked} placeholder={question.answerPlaceholder || "Optional clarification"} aria-label="Prototype clarification" />}
      <button id="submit-clarification" type="submit" disabled={blocked}><Check size={16} />{action.busy ? "Sending..." : "Use this answer"}</button>
      <p role="status" className="revision-status" data-status={action.error ? "error" : "idle"}>{action.error}</p>
    </form>
  </div>;
}

export function PrototypePanel({ active: visible, connected }: { active: boolean; connected: boolean }) {
  const ui = useUi();
  const { state, pending, post, canEdit, guidance } = ui;
  const latest = useRef(state);
  latest.current = state;
  const latestUi = useRef(ui);
  latestUi.current = ui;
  const action = useAction("prototype-action");
  const revisionAction = useAction("prototype-revision");
  const [draft, setDraft] = useDraft("prototype-revision", { value: "", version: 0 });
  const submissions = useRef(new Map<string, Submission>());
  const frame = useRef<HTMLIFrameElement>(null);
  const capture = useRef<{ finish: (value?: { state: unknown }) => void } | null>(null);
  const restore = useRef<{ generation: string; checkpointId: string; state: unknown } | null>(null);
  const [elapsed, setElapsed] = useState("");
  const [previewCheck, setPreviewCheck] = useState({ binding: "", available: false, busy: false, reason: "" });
  const checkSequence = useRef(0);
  const checkController = useRef<AbortController | null>(null);
  const flow = state.prototypeFlow;
  const checkpoints = flow?.checkpoints || [];
  const displayed = checkpoints.find((item) => item.id === flow?.displayedCheckpointId);
  const candidate = checkpoints.find((item) => item.id === flow?.pendingCheckpointId);
  const active = checkpoints.find((item) => item.id === flow?.activeCheckpointId || item.status === "running");
  const failed = checkpoints.filter((item, index) => item.status === "failed" && (item.milestone !== "visual" || flow?.visualRequested)
    && !checkpoints.slice(index + 1).some((next) => next.milestone === item.milestone && next.revisionId === item.revisionId)).at(-1);
  const revisions: Revision[] = state.prototypeReview?.revisions || [];
  const candidateMilestone = milestones.find(item => item.id === candidate?.milestone)?.label || "Saved";
  const automaticCandidate = candidate?.revisionId === null;
  const requestedCandidate = Boolean(candidate?.revisionId && revisions.some(item => item.id === candidate.revisionId));
  const candidateLabel = automaticCandidate ? `${candidateMilestone} prototype ready to inspect`
    : requestedCandidate ? "Requested prototype revision ready to inspect" : "Saved prototype version ready to inspect";
  const switchLabel = automaticCandidate ? `Show ${candidateMilestone} prototype`
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
  const url = flow ? displayed?.previewUrl || (displayed ? state.previewUrl : null) : state.previewUrl;
  const readyUrl = originOf(url) && !unavailable && !undecided ? url : null;
  const savedOnly = state.lifecycle.completedStages.includes("prototype");
  const generation = state.generation;
  const displayedId = flow?.displayedCheckpointId ?? null;
  const pendingId = flow?.pendingCheckpointId ?? null;
  const previewBinding = JSON.stringify([generation, displayedId, readyUrl]);
  const checkBinding = JSON.stringify([previewBinding, pendingId]);
  const latestCheckBinding = useRef(checkBinding);
  latestCheckBinding.current = checkBinding;
  const showLivePreview = Boolean(readyUrl) && previewCheck.binding === previewBinding && previewCheck.available;
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
      const response = await fetch("/api/prototype/preview-status", {
        cache: "no-store", redirect: "error", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(7000)]),
      });
      const value = await response.json();
      if (!response.ok || value.generation !== generation || value.url !== readyUrl || value.checkpointId !== displayedId
        || value.pendingCheckpointId !== pendingId || typeof value.available !== "boolean" || typeof value.reason !== "string") {
        throw new Error(value.error || "The current preview changed or could not be verified. Check again.");
      }
      if (current()) setPreviewCheck({ binding: previewBinding, available: value.available, busy: false, reason: value.reason });
    } catch (error) {
      if (current()) setPreviewCheck({ binding: previewBinding, available: false, busy: false,
        reason: error instanceof Error ? error.message : "The current preview could not be checked." });
    }
  }, [readyUrl, generation, displayedId, pendingId, previewBinding, checkBinding]);
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
    && Boolean(failed || failedRevision || !milestonesReady || unresolved.length);
  const visualVisible = Boolean(flow && !flow.visualRequested && !building && !hasActiveJobs(state) && milestoneReady(state, "interaction") && !candidate);
  const skipVisible = Boolean(flow?.visualRequested && failed?.milestone === "visual" && !failed.revisionId && !hasActiveJobs(state));
  const checkpointKey = flow?.displayedCheckpointId || "legacy";
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
          || event.data.prototypeId !== state.prototypeId || !Object.hasOwn(event.data, "state")) return;
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
      try { source.postMessage({ type: "tandem:preview:capture", requestId, prototypeId: state.prototypeId }, origin); }
      catch (error) { console.warn("Prototype state capture is unavailable; the update can still be applied.", error); finish(); }
    });
  }

  async function submitAction(kind: string) {
    if (blocked) return;
    await action.run(async () => {
      if (!latestUi.current.canEdit("prototype") || hasActiveJobs(latest.current)) {
        throw new Error("The prototype changed. Review its current state before retrying.");
      }
      const checkpointId = kind === "apply-update" ? candidate?.id : kind === "retry" ? failed?.id : null;
      if (kind === "apply-update" && !checkpointId) throw new Error("The update is no longer available.");
      try {
        const captured = kind === "apply-update" ? await capturePreview() : undefined;
        if (latest.current.generation !== state.generation || !latestUi.current.canEdit("prototype")) {
          throw new Error("The effort changed. Review the current prototype before retrying.");
        }
        if (kind === "apply-update" && (latest.current.prototypeFlow?.pendingCheckpointId !== checkpointId
          || latest.current.prototypeFlow?.displayedCheckpointId !== flow?.displayedCheckpointId || latest.current.previewUrl !== state.previewUrl)) {
          throw new Error("The update changed. Review the latest update before applying it.");
        }
        if (captured && checkpointId) restore.current = { generation: state.generation, checkpointId, state: captured.state };
        await post("/api/prototype/action", { action: kind, ...(checkpointId ? { checkpointId } : {}), expectedRevision: latest.current.revision });
      } catch (error) { restore.current = null; throw error; }
    });
  }
  const message = candidate ? candidateLabel + ". " + (automaticCandidate ? "This is an automatically generated milestone, not a response to feedback. " : "")
    + (candidate.summary || "The next checkpoint has been validated.") + ` The inline preview and Open current preview still show your current version until you choose ${switchLabel}.`
    : question ? "A revision needs clarification. Keep exploring and queue feedback below."
    : building ? readyUrl ? "Your working preview stays available while the next checkpoint builds." : "Building the first runnable checkpoint. No preview is available yet; you can already queue feedback."
    : failed ? "The latest update failed. " + failed.summary + (readyUrl ? " Your working preview is unchanged." : "")
    : failedRevision ? "A feedback revision failed. Retry the failed revision to continue."
    : milestonesReady ? "Structure and Interaction are ready. Finish Prototype, or optionally explore visual direction."
    : "Start with Structure, then test one complete Interaction. Visual direction is optional.";
  const revisionMessage = revisionAction.error || (state.lifecycle.currentStage !== "prototype"
    ? "Prototype history is read only. You can keep a draft; reopen the stage to submit it."
    : !canEdit("prototype") ? guidance("submit revisions")
    : finalizing ? "The final feature specification is being generated from frozen input. Keep drafting; sending is paused for this handoff."
    : unresolved.length >= 50 ? "The feedback queue is full. Apply or resolve existing updates before sending more; your draft is kept."
    : !readyUrl ? "You can queue feedback before the first preview is ready."
    : hasActiveJobs(state) ? "Keep using the displayed preview. New feedback is queued while the next update builds."
    : question ? "Answer the clarification to continue that revision. You can queue other feedback meanwhile."
    : candidate ? candidateLabel + ". Switching the displayed version is separate from optional feedback."
    : "Try the prototype, then describe any revision you want.");
  const recentApplied = new Set(revisions.filter((item) => item.status === "applied").slice(-5).map((item) => item.id));
  const importantProgress = Boolean(failed || failedRevision || question);

  return <>
    <div className="preview-surface">
      {savedOnly && state.lifecycle.outputs.some(output => output.stageId === "prototype") && !finalizing && <section className="prototype-progress" aria-label="Saved Prototype next step">
        <HandoffControls prototype />
        <button className="plan-button secondary" type="button" onClick={() => ui.browseStage("development")}>Open Development</button>
        <details><summary>Returning later</summary><p>The saved Prototype remains available for review in Development. Opening Development does not submit it; confirm the handoff when ready.</p></details>
      </section>}
      <div id="preview-tools" className="preview-tools">
        <span id="preview-status">{unavailable ? "not applicable" : finalizing ? "Finishing prototype..."
          : readyUrl && !showLivePreview ? previewCheck.binding !== previewBinding || previewCheck.busy ? "Checking saved preview..." : "Saved prototype · preview unavailable"
          : savedOnly ? "Saved prototype · live preview verified" : candidate ? candidateLabel
          : building ? readyUrl ? "Current preview live · next milestone building" : "Building first preview..." : readyUrl ? "Current preview live" : "No runnable preview yet"}</span>
        {readyUrl && (!showLivePreview || !flow) && <button id="check-live-preview" className="plan-button secondary" type="button"
          disabled={previewCheck.busy || !connected || !visible} onClick={() => void checkPreview()}>
          {previewCheck.busy && connected ? "Checking preview..." : "Check again"}</button>}
        {readyUrl && showLivePreview && <a id="open-preview" href={readyUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} />Open current preview</a>}
      </div>
      {readyUrl && <p id="preview-availability" className="revision-status" role="status" hidden={showLivePreview && !previewCheck.busy}>
        {!connected ? "Connection interrupted. Current preview availability will be checked when the workspace reconnects."
          : previewCheck.binding !== previewBinding || previewCheck.busy ? "Checking current preview..."
          : showLivePreview ? "Current preview verified."
          : "Current preview unavailable. The preview server may have stopped. " + previewCheck.reason}
        {!showLivePreview && " Saved version, pending update and feedback are preserved. Checking does not start a server or model work."}
      </p>}
      {readyUrl && <PreviewRestart target="current" unavailable={previewCheck.binding === previewBinding && !previewCheck.available && !previewCheck.busy}
        changed={() => void checkPreview()} />}
      <PendingPreviewAvailability active={visible} connected={connected} />
      <section id="prototype-progress" className="prototype-progress" aria-label="Prototype progress"
        aria-describedby="prototype-progress-message"
        hidden={Boolean(unavailable) || (!flow && ((Boolean(readyUrl) && !failedRevision) || state.lifecycle.currentStage !== "prototype"))}>
        <ol id="prototype-milestones" className="prototype-milestones" aria-label="Prototype substages" hidden={!flow && Boolean(readyUrl)}>
          {milestones.map((milestone) => {
            const latest = checkpoints.filter((checkpoint) => checkpoint.milestone === milestone.id).at(-1);
            const skipped = milestone.id === "visual" && !flow?.visualRequested && latest?.status === "failed";
            const label = skipped ? "Skipped (optional)" : latest?.id === candidate?.id && candidate ? "Ready to inspect - not displayed"
              : latest?.status === "running" ? "Building" : latest?.status === "clarifying" ? "Needs clarification" : latest?.status === "failed" ? "Failed - retry available"
              : milestoneReady(state, milestone.id) ? "Ready" : milestone.id === "visual" && !flow?.visualRequested ? "Optional" : "Waiting";
            return <li key={milestone.id} data-milestone={milestone.id} data-status={skipped ? "skipped" : latest?.status || "waiting"} aria-current={active?.milestone === milestone.id ? "step" : undefined}>
              <strong>{milestone.label}</strong><span>{label}</span>
            </li>;
          })}
        </ol>
        <div className="prototype-actions">
          <button id="apply-prototype-update" className="plan-button" hidden={!candidate} disabled={blocked}
            title="Switch the displayed preview to this saved version." onClick={() => void submitAction("apply-update")}><ArrowUpRight size={16} />{switchLabel}</button>
          <button id="request-prototype-visual" className="plan-button" hidden={!visualVisible} disabled={blocked || unresolved.length > 0} onClick={() => void submitAction("visual")}><Sparkles size={16} />Explore visual direction (optional)</button>
          <button id="skip-prototype-visual" className="plan-button secondary" hidden={!skipVisible} disabled={blocked} onClick={() => void submitAction("skip-visual")}><SkipForward size={16} aria-hidden="true" />Skip visual direction</button>
          <button id="retry-prototype-checkpoint" className="plan-button" hidden={!retryVisible} disabled={blocked} onClick={() => void submitAction("retry")}><RefreshCw size={16} />{failed ? "Retry " + milestones.find((item) => item.id === failed.milestone)?.label : failedRevision ? "Retry failed revision" : "Continue prototype work"}</button>
        </div>
        <details id="prototype-progress-details" className="prototype-progress-details"><summary>Details</summary>
          {!importantProgress && <p id="prototype-progress-message" className="muted" role="status" data-essential={Boolean(candidate)}>{message}</p>}
          {readyUrl && showLivePreview && flow && <button id="check-live-preview" className="plan-button secondary" type="button"
            disabled={previewCheck.busy || !connected || !visible} onClick={() => void checkPreview()}>
            {previewCheck.busy ? "Checking preview..." : "Check current preview"}</button>}
          <p id="prototype-budget" className="muted">{flow && `Recorded checkpoint time: ${Math.ceil(flow.budget.usedSeconds / 60)} minutes. New work has no automatic execution-time cap.${flow.budget.limitSeconds === null ? "" : ` Legacy ${Math.ceil(flow.budget.limitSeconds / 60)}-minute budget retained for history, not enforced.`}`}</p>
        </details>
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
      <div id="preview-empty" className="preview-empty" hidden={Boolean(readyUrl)}>
        <div><p id="preview-empty-message">{unavailable ? "Live prototype is not applicable. " + unavailable.reason : undecided
          ? "Choose the prototype approach in Requirements before starting prototype work." : building
          ? "The runnable preview will appear here after its first checkpoint is validated. Feedback can be queued below." : validation
          ? "No prototype validation is running. Validate the existing app without replacing it." : "No prototype build is running. Start a build to create the runnable preview."}</p>
          <button id="start-prototype" className="plan-button" hidden={!startVisible} disabled={pending || !canEdit("prototype") || hasActiveJobs(state)}
            onClick={() => void action.run(() => post("/api/prototype/start", {}))}><Play size={16} />{validation ? state.previewStatus === "error" ? "Retry existing prototype validation" : "Validate existing prototype" : state.previewStatus === "error" ? "Retry prototype build" : "Start prototype"}</button>
        </div>
      </div>
      <iframe key={checkpointKey + ":" + (showLivePreview ? "verified" : "unverified")} id="preview-frame" ref={frame} title="Runnable prototype" src={showLivePreview ? readyUrl || undefined : undefined} hidden={!showLivePreview}
        data-url={readyUrl || ""} data-checkpoint-id={flow?.displayedCheckpointId || ""} referrerPolicy="origin"
        sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
        onLoad={(event) => {
          if (!showLivePreview || event.currentTarget !== frame.current) return;
          const saved = restore.current;
          if (!saved || saved.generation !== latest.current.generation || saved.checkpointId !== latest.current.prototypeFlow?.displayedCheckpointId) return;
          const origin = originOf(readyUrl);
          if (!origin) return;
          restore.current = null;
          try { frame.current?.contentWindow?.postMessage({ type: "tandem:preview:restore", prototypeId: state.prototypeId, state: saved.state }, origin); }
          catch (error) { console.warn("Prototype state could not be restored; the updated preview remains available.", error); }
        }} />
    </div>
    <section id="prototype-review" className="prototype-review" hidden={!hasStageData(state, "prototype") || Boolean(unavailable)}>
      <div className="prototype-review-heading"><strong>Feedback</strong></div>
      <p id="prototype-feedback-help" className="muted">Feedback is optional. Try the displayed prototype, then describe a change if you want one.</p>
      <form id="revision-form" className="revision-form inline-composer" aria-describedby="revision-status" onSubmit={(event) => {
        event.preventDefault();
        if (pending || !canEdit("prototype") || finalizing) return;
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
        <SpeechTextarea id="revision-input" value={draft.value} onValueChange={(value) => setDraft((current) => ({ value, version: current.version + 1 }))}
          rows={1} maxLength={4000} disabled={Boolean(state.effortReset)} placeholder="Describe one change you want to see in the prototype." aria-label="Prototype revision suggestion" aria-describedby="revision-status" />
        <button id="submit-revision" type="submit" aria-describedby="revision-status" disabled={pending || !canEdit("prototype") || finalizing || unresolved.length >= 50}><Send size={16} />{revisionAction.busy ? "Sending..." : hasActiveJobs(state) || question || candidate || !readyUrl ? "Queue revision" : "Send revision"}</button>
      </form>
      {question && <Clarification key={JSON.stringify(question)} question={question} />}
      <details id="revision-history-details" className="revision-history-details" hidden={!revisions.length}>
        <summary>Revision history <span id="revision-queue-summary" className="muted" role="status">{unresolved.length ? `${revisions.filter((item) => item.status === "queued").length} queued · ${unresolved.length} unresolved / 50` : ""}</span></summary>
        <ul id="revision-history" className="revision-history">{revisions.filter((item) => item.status !== "applied" || recentApplied.has(item.id)).slice().reverse().map((revision) =>
          <li key={revision.id} data-revision-id={revision.id} data-status={revision.status}><strong title={revision.summary}>{revision.suggestion || revision.summary}</strong>
            <span>{{ queued: "Queued", processing: "Building update", clarifying: "Needs clarification", ready: "Update ready - not applied", applied: "Applied", failed: "Failed - retry needed" }[revision.status] || revision.status}</span></li>)}</ul>
      </details>
      <p id="revision-status" className={revisionAction.error || unresolved.length >= 50 || finalizing || question ? "revision-status" : "visually-hidden"} role="status" data-status={revisionAction.error || unresolved.length >= 50 ? "error" : "idle"}
        data-essential={Boolean(revisionAction.error || unresolved.length >= 50 || !canEdit("prototype") || finalizing || question)}>{revisionMessage}</p>
    </section>
  </>;
}
