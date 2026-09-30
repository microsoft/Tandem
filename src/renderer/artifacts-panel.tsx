import { FileText, FileWarning, FolderOpen } from "lucide-react";
import { lifecycleStages, isRetiredStage, retiredStages } from "../workflow.js";
import { Diagram } from "./diagram.js";
import { useUi } from "./ui-context.js";

interface ArtifactSelectionProps { selectedArtifactId: string | null }
const artifactGroups = [...lifecycleStages, ...retiredStages.map(id => ({ id, label: `Historical ${id}` }))];

export function ArtifactList({ selectedArtifactId }: ArtifactSelectionProps) {
  const { state, selectArtifact } = useUi();
  const selected = state.artifacts.some(artifact => artifact.id === selectedArtifactId)
    ? selectedArtifactId : state.artifacts[0]?.id ?? null;
  return <div id="artifact-list" className="artifact-list">
    {!state.artifacts.length && <p className="artifact-empty">No artifacts yet.</p>}
    {artifactGroups.map(stage => {
      const artifacts = state.artifacts.filter(artifact => (artifact.stage || "requirements") === stage.id);
      if (!artifacts.length) return null;
      return <section key={stage.id} className="artifact-stage-group" aria-label={`${stage.label} artifacts`}>
        <h3 className="artifact-stage-heading">{stage.label}<span>{artifacts.length}</span></h3>
        <ul className="artifact-stage-items">{artifacts.map(artifact => {
          const meta = [artifact.kind, artifact.path, artifact.reviewStatus === "stale" ? "stale" : ""].filter(Boolean).join(" · ");
          return <li key={artifact.id}><button className="artifact-button" type="button" data-artifact-id={artifact.id}
            data-ui-key={`artifact:${artifact.id}`} aria-current={artifact.id === selected} title={`${artifact.title} · ${meta}`}
            data-stale={artifact.reviewStatus === "stale"} onClick={() => selectArtifact(artifact.id)}>
            {artifact.reviewStatus === "stale" ? <FileWarning className="artifact-icon" size={15} aria-hidden="true" />
              : <FileText className="artifact-icon" size={15} aria-hidden="true" />}
            <span className="artifact-copy"><span className="artifact-title">{artifact.title}</span>
              {meta && <span className="artifact-list-meta">{meta}</span>}</span>
          </button></li>;
        })}</ul>
      </section>;
    })}
  </div>;
}

export function ArtifactsPanel({ selectedArtifactId }: ArtifactSelectionProps) {
  const { state } = useUi();
  const artifact = state.artifacts.find(candidate => candidate.id === selectedArtifactId) || state.artifacts[0];
  if (!artifact) return <div id="content-empty" className="content-empty">
    <div className="empty-state"><FolderOpen size={28} aria-hidden="true" /><strong>No artifacts yet</strong></div>
  </div>;
  const stage = artifactGroups.find(candidate => candidate.id === artifact.stage)?.label;
  const meta = [stage, artifact.kind, artifact.path, artifact.reviewStatus === "stale" ? "stale" : ""].filter(Boolean).join(" · ");
  const threads = [state.designReview, state.testDesignReview].flatMap(review =>
    (Array.isArray(review?.threads) ? review.threads : []).filter(thread =>
      artifact.sourceThreadIds?.includes(thread.id) || thread.reviewArtifactId === artifact.id || thread.artifactIds?.includes(artifact.id)));
  return <div id="content-card" className="content-card">
    <div className="content-heading"><strong id="artifact-heading">{artifact.title}</strong>
      <span id="artifact-meta" className="artifact-meta">{meta}</span></div>
    <div className="artifact-body">
      {artifact.mermaid?.trim() && <div id="artifact-diagram" className="artifact-diagram" aria-label={`${artifact.title} workflow diagram`}>
        <Diagram key={artifact.id} id={`artifact:${artifact.id}`} source={artifact.mermaid} label={`${artifact.title} workflow diagram`} />
      </div>}
      <pre id="artifact-content" className="artifact-content" hidden={!artifact.content}>{artifact.content || ""}</pre>
      {isRetiredStage(artifact.stage) && <section aria-label="Historical review">
        <p>Read-only legacy evidence. It does not authorize Development or establish a current verification pass.</p>
        {threads.map((thread, index) => <details key={`${thread.id}:${index}`}>
          <summary>{thread.prompt} · {thread.status}</summary><pre>{thread.answer}</pre>
          {thread.error && <p>{thread.error}</p>}
        </details>)}
      </section>}
    </div>
  </div>;
}
