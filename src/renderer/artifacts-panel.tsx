import { FileText, FileWarning, FolderOpen, MessageCircle, Send } from "lucide-react";
import type { FormEvent } from "react";
import type { TandemArtifact } from "../types.js";
import { lifecycleStages } from "../workflow.js";
import { Diagram } from "./diagram.js";
import {
  currentReviewKind, getReview, ReviewThreadCard, reviewStatus, reviewThreadsForArtifact,
  type ReviewRequestKind,
} from "./review-panel.js";
import { SpeechTextarea } from "./speech-textarea.js";
import { useAction, useDraft, useUi } from "./ui-context.js";

interface ArtifactSelectionProps {
  selectedArtifactId: string | null;
}

interface ReviewDraft {
  prompt: string;
  kind: ReviewRequestKind;
  version: number;
}

function ArtifactComposer({ artifact }: { artifact: TandemArtifact }) {
  const { state, pending, canEdit, guidance, post } = useUi();
  const kind = currentReviewKind(state);
  const key = JSON.stringify([state.prototypeId, state.generation, "artifact-review", artifact.id, kind]);
  const [draft, setDraft] = useDraft<ReviewDraft>(key, { prompt: "", kind: "question", version: 0 });
  const action = useAction(key);
  const editable = canEdit("design");
  const review = getReview(state);
  const requestKind = kind !== "test" && draft.kind === "test-scenario" ? "question" : draft.kind;
  const placeholder = requestKind === "question"
    ? `Ask about ${artifact.title}, its tradeoffs, behavior, or risks.`
    : requestKind === "diagram"
      ? "Describe the architecture, sequence, state, or workflow diagram to generate."
      : requestKind === "contract"
        ? "Describe the UI-facing boundary or contract to clarify."
        : requestKind === "test-scenario"
          ? "Describe the integration boundary or user interaction scenario to test."
          : "Describe the design decision and tradeoff to record.";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending || action.busy || !editable) return;
    if (!state.artifacts.some((candidate) => candidate.id === artifact.id && candidate.stage === "design")) {
      action.setError("Select a Design artifact before starting a review.");
      return;
    }
    if (!draft.prompt.trim()) {
      action.setError("Enter a design question or artifact request.");
      return;
    }
    const submittedVersion = draft.version;
    await action.run(async () => {
      await post("/api/design-review", {
        prompt: draft.prompt.trim(),
        type: requestKind === "question" ? "question" : "artifact",
        artifactKind: requestKind === "question" ? null : requestKind,
        artifactId: artifact.id,
      });
      setDraft((current) => current.version === submittedVersion
        ? { prompt: "", kind: "question", version: current.version + 1 } : current);
    });
  }

  return <form id="design-review-form" className="design-review-composer inline-composer" onSubmit={submit} aria-describedby="design-review-status"
    hidden={!editable} data-draft-key={key} aria-busy={action.busy}>
    <select id="review-request-kind" className="review-request-kind" aria-label="Artifact review request type"
      value={requestKind} disabled={!editable}
      onChange={(event) => setDraft((current) => ({ ...current, kind: event.target.value as ReviewRequestKind, version: current.version + 1 }))}>
      <option value="question">Ask about this artifact</option>
      <option value="diagram">Generate a related diagram</option>
      <option value="contract">Generate a related contract</option>
      <option value="decision-record">Generate a related decision record</option>
      {kind === "test" && <option value="test-scenario">Generate a related test scenario</option>}
    </select>
    <SpeechTextarea id="design-review-input" speechKey={key} maxLength={4000} value={draft.prompt}
      placeholder={placeholder} aria-label="Artifact review question or request" aria-describedby="design-review-status" disabled={!editable}
      onValueChange={(prompt) => setDraft((current) => ({ ...current, prompt, version: current.version + 1 }))} />
    <div className="review-composer-actions">
      <span id="design-review-status" className={action.error || action.busy || review.processing || review.finalizeRequested || review.threads.some((thread) => thread.status === "failed") ? "design-review-status" : "visually-hidden"} role="status" aria-live="polite"
        data-status={action.error ? "error" : "idle"}>
        {action.error || reviewStatus(state, editable, guidance("conduct the review"))}
      </span>
      <button id="review-submit" className="review-submit" type="submit" aria-describedby="design-review-status" disabled={pending || action.busy || !editable}>
        <Send size={14} aria-hidden="true" /> {action.busy ? "Queueing..." : review.processing
          ? requestKind === "question" ? "Queue question" : "Queue artifact"
          : requestKind === "question" ? "Ask question" : "Generate artifact"}
      </button>
    </div>
  </form>;
}

export function ArtifactList({ selectedArtifactId }: ArtifactSelectionProps) {
  const { state, selectArtifact } = useUi();
  const selected = state.artifacts.some((artifact) => artifact.id === selectedArtifactId)
    ? selectedArtifactId : state.artifacts[0]?.id ?? null;
  return <div id="artifact-list" className="artifact-list">
      {state.artifacts.length === 0 && <p className="artifact-empty">No artifacts yet.</p>}
      {lifecycleStages.map((stage) => {
        const artifacts = state.artifacts.filter((artifact) => (artifact.stage || "requirements") === stage.id);
        if (!artifacts.length) return null;
        return <section key={stage.id} className="artifact-stage-group" aria-label={`${stage.label} artifacts`}>
          <h3 className="artifact-stage-heading">{stage.label}<span>{artifacts.length}</span></h3>
          <ul className="artifact-stage-items">{artifacts.map((artifact) => {
            const meta = [artifact.kind, artifact.path, artifact.reviewStatus === "stale" ? "stale" : ""].filter(Boolean).join(" · ");
            return <li key={artifact.id}>
              <button className="artifact-button" type="button" data-artifact-id={artifact.id}
                data-ui-key={`artifact:${artifact.id}`} aria-current={artifact.id === selected} title={`${artifact.title} · ${meta}`}
                data-stale={artifact.reviewStatus === "stale"}
                onClick={() => selectArtifact(artifact.id)}>
                {artifact.reviewStatus === "stale" ? <FileWarning className="artifact-icon" size={15} aria-hidden="true" /> : <FileText className="artifact-icon" size={15} aria-hidden="true" />}
                <span className="artifact-copy"><span className="artifact-title">{artifact.title}</span>
                  {meta && <span className="artifact-list-meta">{meta}</span>}</span>
              </button>
            </li>;
          })}</ul>
        </section>;
      })}
  </div>;
}

export function ArtifactsPanel({ selectedArtifactId }: ArtifactSelectionProps) {
  const { state, canEdit, guidance } = useUi();
  const artifact = state.artifacts.find((candidate) => candidate.id === selectedArtifactId) || state.artifacts[0];
  if (!artifact) return <div id="content-empty" className="content-empty">
    <div className="empty-state"><FolderOpen size={28} aria-hidden="true" /><strong>No artifacts yet</strong></div>
  </div>;
  const stage = lifecycleStages.find((candidate) => candidate.id === artifact.stage)?.label;
  const meta = [stage, artifact.kind, artifact.path, artifact.reviewStatus === "stale" ? "stale" : ""].filter(Boolean).join(" · ");
  const threads = reviewThreadsForArtifact(state, artifact);
  const reviewKind = currentReviewKind(state);

  return <div id="content-card" className="content-card">
    <div className="content-heading">
      <strong id="artifact-heading">{artifact.title}</strong>
      <span id="artifact-meta" className="artifact-meta">{meta}</span>
    </div>
    <div className="artifact-body">
      {artifact.mermaid?.trim() && <div id="artifact-diagram" className="artifact-diagram" aria-label={`${artifact.title} workflow diagram`}>
        <Diagram key={artifact.id} id={`artifact:${artifact.id}`} source={artifact.mermaid} label={`${artifact.title} workflow diagram`} />
      </div>}
      <pre id="artifact-content" className="artifact-content" hidden={!artifact.content}>{artifact.content || ""}</pre>
      {artifact.stage === "design" && <section id="artifact-review" className="artifact-review" aria-describedby="artifact-review-help">
        <div className="artifact-review-heading">
          <strong><MessageCircle size={16} aria-hidden="true" /> Artifact review</strong>
          <span id="artifact-review-help" className="visually-hidden">Questions and review decisions stay with this artifact.</span>
        </div>
        <div id="artifact-review-threads" className="artifact-review-threads">
          {threads.map(({ thread, kind }) => <ReviewThreadCard key={`${artifact.id}:${kind}:${thread.id}`}
            thread={thread} kind={kind} showArtifactLinks={false} />)}
        </div>
        {!canEdit("design") && <p className="visually-hidden" role="status">
          {reviewStatus(state, false, guidance("conduct the review"))}
        </p>}
        <ArtifactComposer key={`${artifact.id}:${reviewKind}`} artifact={artifact} />
      </section>}
    </div>
  </div>;
}
