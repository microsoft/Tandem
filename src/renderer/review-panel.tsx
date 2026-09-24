import { Check, FileText, MessageCircle, RotateCcw } from "lucide-react";
import type { TandemArtifact } from "../types.js";
import { useAction, useUi, type UiState } from "./ui-context.js";

export type ReviewKind = "product" | "test";
export type ReviewRequestKind = "question" | "diagram" | "contract" | "decision-record" | "test-scenario";
export type ReviewThreadAction = "resolve" | "reopen" | "retry";

export interface ReviewThread {
  id: string;
  type: "question" | "artifact";
  artifactKind?: Exclude<ReviewRequestKind, "question"> | null;
  prompt: string;
  answer?: string;
  status: "queued" | "processing" | "answered" | "resolved" | "failed";
  artifactIds?: string[];
  reviewArtifactId?: string | null;
  error?: string;
}

interface ReviewScenario {
  id: string;
  title: string;
  type: "integration" | "interaction";
  description: string;
  dependencies?: string[];
  steps?: string[];
  expectedOutcome: string;
  validation?: string[];
}

export interface DesignReview {
  threads: ReviewThread[];
  processing?: { action: string; requestId?: string; threadId?: string; runId?: string } | null;
  finalizeRequested?: boolean;
  finalizedArtifactId?: string | null;
  scenarios?: ReviewScenario[];
}

export function currentReviewKind(state: UiState): ReviewKind {
  return state.design?.substage === "test" ? "test" : "product";
}

export function getReview(state: UiState, kind = currentReviewKind(state)): DesignReview {
  const review = kind === "test" ? state.testDesignReview : state.designReview;
  return { ...review, threads: Array.isArray(review?.threads) ? review.threads : [] };
}

export function isReviewFinalized(review: DesignReview, kind: ReviewKind): boolean {
  return kind === "test"
    ? review.finalizedArtifactId === "test-spec"
    : ["design-spec", "design-review"].includes(review.finalizedArtifactId || "");
}

export function reviewThreadsForArtifact(state: UiState, artifact: TandemArtifact) {
  const sourceIds = new Set(artifact.sourceThreadIds || []);
  return (["product", "test"] as const).flatMap((kind) => getReview(state, kind).threads
    .filter((thread) => sourceIds.has(thread.id)
      || thread.reviewArtifactId === artifact.id
      || (thread.artifactIds || []).includes(artifact.id))
    .map((thread) => ({ thread, kind })));
}

function nextThreadAction(thread: ReviewThread): ReviewThreadAction | null {
  return thread.status === "answered" ? "resolve"
    : thread.status === "resolved" ? "reopen"
      : thread.status === "failed" ? "retry" : null;
}

export function ReviewThreadCard({ thread, kind, showArtifactLinks = true }: {
  thread: ReviewThread;
  kind: ReviewKind;
  showArtifactLinks?: boolean;
}) {
  const { state, pending, canEdit, post, selectArtifact } = useUi();
  const action = useAction(`review-thread:${state.prototypeId}:${state.generation}:${kind}:${thread.id}`);
  const active = currentReviewKind(state) === kind
    && getReview(state).threads.some((candidate) => candidate.id === thread.id);
  const editable = canEdit("design") && active;
  const nextAction = nextThreadAction(thread);
  const artifactIds = [...new Set([...(thread.artifactIds || []),
    ...(thread.reviewArtifactId ? [thread.reviewArtifactId] : [])])];
  const artifacts = artifactIds.flatMap((id) => {
    const artifact = state.artifacts.find((candidate) => candidate.id === id);
    return artifact ? [artifact] : [];
  });
  const followupArtifact = artifacts.find((artifact) => artifact.id === thread.reviewArtifactId)
    || artifacts.find((artifact) => artifact.stage === "design");
  const defaultArtifact = thread.type === "artifact" && thread.id.startsWith("default-project-");

  function submitThreadAction() {
    if (pending || action.busy || !editable || !nextAction) return;
    const currentThread = getReview(state).threads.find((candidate) => candidate.id === thread.id);
    if (!currentThread || nextThreadAction(currentThread) !== nextAction) return;
    void action.run(() => post("/api/design-review/thread", { threadId: thread.id, action: nextAction }));
  }

  return <article className="review-thread" data-status={thread.status} data-thread-id={thread.id}>
    <div className="review-thread-heading">
      <span className="review-thread-kind">{thread.type === "artifact"
        ? `Artifact · ${(thread.artifactKind || "").replaceAll("-", " ")}`
        : kind === "test" ? "Test design question" : "Product design question"}</span>
      <span className="review-thread-state">{thread.status}</span>
    </div>
    {!defaultArtifact && <>
      <p className="review-thread-prompt">{thread.prompt}</p>
      {thread.answer
        ? <p className="review-thread-answer">{thread.answer}</p>
        : ["queued", "processing"].includes(thread.status)
          ? <p className="review-thread-answer muted">{thread.status === "queued"
            ? "Waiting in the Tandem review queue..."
            : "Tandem is preparing a design response..."}</p>
          : null}
    </>}
    {thread.error && <p className="review-thread-error">{thread.error}</p>}
    {showArtifactLinks && artifacts.length > 0 && <div className="review-thread-artifacts">
      {artifacts.map((artifact) => <button key={artifact.id} type="button" className="review-artifact-link"
        data-thread-id={thread.id} data-ui-key={`review-link:${kind}:${thread.id}:${artifact.id}`}
        onClick={() => selectArtifact(artifact.id)}>
        <FileText size={14} aria-hidden="true" /> {artifact.title}{artifact.reviewStatus === "stale" ? " · stale" : ""}
      </button>)}
    </div>}
    {editable && nextAction && <div className="review-thread-actions">
      {showArtifactLinks && followupArtifact && <button type="button" className="thread-action"
        onClick={() => selectArtifact(followupArtifact.id)}>
        <MessageCircle size={14} aria-hidden="true" /> Ask a follow-up
      </button>}
      <button type="button" className="thread-action" data-thread-action={nextAction}
        data-ui-key={`artifact-thread:${kind}:${thread.id}:${nextAction}`}
        disabled={pending || action.busy} onClick={submitThreadAction}>
        {nextAction === "resolve" ? <Check size={14} aria-hidden="true" /> : <RotateCcw size={14} aria-hidden="true" />}
        {" "}{action.busy ? "Updating..." : nextAction === "resolve" ? "Mark resolved" : nextAction === "reopen" ? "Reopen" : "Retry"}
      </button>
    </div>}
    {action.error && <p className="review-thread-error" role="alert">{action.error}</p>}
  </article>;
}

export function reviewStatus(state: UiState, canSubmit: boolean, guidance: string): string {
  const kind = currentReviewKind(state);
  const review = getReview(state);
  const failed = review.threads.some((thread) => thread.status === "failed");
  const queued = review.threads.some((thread) => ["queued", "processing"].includes(thread.status));
  if (state.lifecycle.currentStage !== "design") return state.lifecycle.completedStages.includes("design")
    ? "Design review is complete and remains available for reference."
    : "Complete Prototype to unlock review actions.";
  if (!canSubmit) return guidance;
  if (failed) return "A review request failed. Retry it before finishing.";
  if (review.processing || review.finalizeRequested) return review.finalizeRequested || review.processing?.action === "finalize"
    ? "Finalizing the specification from the resolved review."
    : "A design request is processing. Open a Design artifact to review it or queue a follow-up.";
  if (isReviewFinalized(review, kind)) return kind === "test"
    ? "The test specification is available under Artifacts → Design."
    : "The design specification is available under Artifacts → Design.";
  if (kind === "test" && review.threads.length === 0) return "Initial test-design drafts are generated automatically before finalization.";
  if (queued) return "Generating design artifacts for review. Open an artifact when it is ready.";
  if (review.threads.some((thread) => thread.status !== "resolved")) {
    return "Open each generated artifact to review it, ask questions, and mark its thread resolved.";
  }
  return "Open a Design artifact to ask another question, or finish the review.";
}

export function ReviewPanel() {
  const { state, pending, canEdit, guidance, post } = useUi();
  const kind = currentReviewKind(state);
  const action = useAction(`review-finalize:${state.prototypeId}:${state.generation}:${kind}`);
  const review = getReview(state);
  const isDesign = state.lifecycle.currentStage === "design";
  const designComplete = state.lifecycle.completedStages.includes("design");
  const editable = canEdit("design");
  const finalized = isReviewFinalized(review, kind);
  const unresolved = review.threads.filter((thread) => thread.status !== "resolved");
  const queued = review.threads.filter((thread) => ["queued", "processing"].includes(thread.status)).length;
  const resolved = review.threads.length - unresolved.length;
  const finalizing = review.finalizeRequested || review.processing?.action === "finalize";
  const disabled = pending || action.busy || !editable || finalized
    || (kind === "test" && review.threads.length === 0)
    || Boolean(review.processing) || Boolean(review.finalizeRequested) || unresolved.length > 0;
  const status = action.error || reviewStatus(state, editable, guidance("conduct the review"));
  const error = Boolean(action.error) || review.threads.some((thread) => thread.status === "failed");
  const scenarios = getReview(state, "test").scenarios || [];
  const scenariosApproved = isReviewFinalized(getReview(state, "test"), "test");

  function finalize() {
    if (disabled) return;
    void action.run(() => post("/api/design-review/finalize", {}));
  }

  return <section className="design-review-card">
    <div className="design-review-heading" aria-describedby="design-review-stage-status">
      <div className="design-review-title">
        <ol className="design-substages" aria-label="Design substages">
          <li id="product-design-substage" className="design-substage"
            data-status={designComplete ? "complete" : !isDesign ? "locked" : kind === "test" ? "complete" : "active"}>
            1 · Product design
          </li>
          <li id="test-design-substage" className="design-substage"
            data-status={designComplete ? "complete" : isDesign && kind === "test" ? "active" : "locked"}>
            2 · Test design
          </li>
        </ol>
        <strong id="design-review-title">{kind === "test" ? "Integration and interaction test design" : "Product design review"}</strong>
        <span id="design-review-progress">{finalized
          ? `Review captured from ${resolved} resolved thread${resolved === 1 ? "." : "s."}`
          : `${resolved} resolved · ${unresolved.length} open${queued ? ` · ${queued} queued` : ""}`}</span>
      </div>
      <button id="finish-review" className="finish-review" type="button" hidden={!isDesign}
        disabled={disabled} onClick={finalize} aria-describedby="design-review-stage-status">
        <Check size={16} aria-hidden="true" /> {action.busy || finalizing ? "Capturing specification..."
          : finalized ? kind === "test" ? "Test spec captured" : "Design spec captured"
            : kind === "test" ? "Finish test design" : "Finish product design"}
      </button>
    </div>
    <p id="design-review-stage-status" className={error || review.processing || finalizing || action.busy ? "design-review-status" : "visually-hidden"} role="status" aria-live="polite"
      data-status={error ? "error" : "idle"}>{status}</p>
    <div id="design-review-threads" className="design-review-threads">
      {review.threads.length === 0 && <p className="design-review-empty">
        {!isDesign && !designComplete ? "Required project-specific design artifacts will be generated after Prototype."
          : kind === "test" ? "Preparing integration and interaction test-design drafts for review."
            : "Preparing the required project-specific design artifacts for review."}
      </p>}
      {review.threads.map((thread) => <ReviewThreadCard key={`${kind}:${thread.id}`} thread={thread} kind={kind} />)}
      {scenarios.length > 0 && <section className="plan-section" aria-label="Test design scenarios" aria-describedby="test-scenario-help">
        <h3>{scenariosApproved ? "Approved test scenarios" : "Test scenarios awaiting finalization"}</h3>
        <p id="test-scenario-help" className="visually-hidden">These are scenario specifications, not evidence that tests have passed.</p>
        {scenarios.map((scenario) => <details key={scenario.id} className="implementation-card"
          data-ui-key={`review-scenario:${scenario.id}`}>
          <summary className="implementation-card-heading"><strong>{scenario.title}</strong>
            <span className="implementation-badge">{scenario.type}</span></summary>
          <p className="implementation-meta">Dependencies: {(scenario.dependencies || []).join(", ") || "none"}</p>
          <p>{scenario.description}</p>
          <strong>Steps</strong>
          <ol>{(scenario.steps || []).map((step, index) => <li key={index}>{step}</li>)}</ol>
          <strong>Expected outcome</strong><p>{scenario.expectedOutcome}</p>
          <strong>Validation</strong>
          <ul>{(scenario.validation || []).map((item, index) => <li key={index}>{item}</li>)}</ul>
        </details>)}
      </section>}
    </div>
  </section>;
}
