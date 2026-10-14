import { useState, type ReactNode } from "react";
import { ChevronRight, FileText, FileWarning, FolderOpen } from "lucide-react";
import { lifecycleStages, isRetiredStage, retiredStages } from "../workflow.js";
import { Diagram } from "./diagram.js";
import { useDraft, useUi } from "./ui-context.js";
import { useProjectView } from "./project-conversation.js";

interface ArtifactSelectionProps { selectedArtifactId: string | null }
const artifactGroups = [...lifecycleStages, ...retiredStages.map(id => ({ id, label: `Historical ${id}` }))];

function ArtifactGroup({ source, name, label, count, version, selected, children }: {
  source: "discovery" | "development"; name: string; label: string; count: number; version: string;
  selected: boolean; children: ReactNode;
}) {
  const { state } = useUi();
  const [initial] = useState(() => ({ open: false, seen: version }));
  const [disclosure, setDisclosure] = useDraft(
    JSON.stringify([state.prototypeId, state.generation, "artifact-group", source, name]), initial);
  const id = `artifact-group-${source}-${name.toLowerCase()}`;
  const updated = !disclosure.open && disclosure.seen !== version;
  const Heading = source === "development" ? "h4" : "h3";
  return <section className="artifact-stage-group" aria-label={`${source === "development" ? "Development " : ""}${label} artifacts`}>
    <Heading className="artifact-stage-heading"><button id={id} type="button" className="artifact-group-toggle"
      aria-expanded={disclosure.open} aria-controls={`${id}-items`} data-selected={selected}
      aria-label={`${label} artifacts, ${count} items${selected ? ", contains current selection" : ""}${updated ? ", new output" : ""}`}
      onClick={() => setDisclosure({ open: !disclosure.open, seen: version })}>
      <ChevronRight size={14} aria-hidden="true" /><span className="artifact-group-name">{label}</span>
      <span className="artifact-group-count">{count}</span>{updated && <span className="artifact-group-new">New</span>}
      {selected && <span className="visually-hidden">Current selection</span>}
    </button></Heading>
    <div id={`${id}-items`} hidden={!disclosure.open}>{children}</div>
  </section>;
}

export function ArtifactList({ selectedArtifactId, active = true }: ArtifactSelectionProps & { active?: boolean }) {
  const { state, selectArtifact } = useUi();
  const selected = !active ? null : state.artifacts.some(artifact => artifact.id === selectedArtifactId)
    ? selectedArtifactId : state.artifacts[0]?.id ?? null;
  return <div id="artifact-list" className="artifact-list">
    {artifactGroups.map(stage => {
      const artifacts = state.artifacts.filter(artifact => (artifact.stage || "requirements") === stage.id);
      if (!artifacts.length) return null;
      return <ArtifactGroup key={stage.id} source="discovery" name={stage.id} label={stage.label} count={artifacts.length}
        version={JSON.stringify(artifacts.map(item => [item.id, item.sourceRevision, item.path, item.reviewStatus]))}
        selected={artifacts.some(item => item.id === selected)}>
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
      </ArtifactGroup>;
    })}
  </div>;
}

export function DevelopmentArtifactList({ active }: { active: boolean }) {
  const view = useProjectView();
  return <div id="development-artifact-list" className="artifact-list" role="group" aria-label="Development outputs">
    <h3 className="artifact-stage-heading">Development</h3>
    {view.outputStatus !== "verified" && <p role="status" className="artifact-availability">
      {view.outputStatus === "not-started" ? "Development has not been activated." : view.outputReason || "Development outputs are unverified, not deleted. Verify the saved runtime explicitly in Development."}
    </p>}
    {view.outputStatus === "verified" && !view.outputs.length && <p>No published Development outputs yet.</p>}
    {view.outputReason && view.outputStatus === "verified" && <p role="status">{view.outputReason}</p>}
    {view.outputError && <p role="alert">{view.outputError}</p>}
    {(["Design", "Plan", "Implementation", "Review"] as const).map(group => {
      const items = view.outputs.filter(item => item.group === group);
      return items.length ? <ArtifactGroup key={group} source="development" name={group} label={group} count={items.length}
        version={JSON.stringify(items.map(item => [item.id, item.binding]))}
        selected={active && items.some(item => item.id === view.selectedOutput)}>
        <ul className="artifact-stage-items">{items.map(item => <li key={item.id}>
          <button type="button" className="artifact-button" data-development-output={item.id}
            disabled={view.outputStatus !== "verified"} aria-current={active && view.selectedOutput === item.id}
            title={`${item.title} · ${item.detail}`} onClick={() => view.openOutput(item)}>
            <FileText className="artifact-icon" size={15} aria-hidden="true" />
            <span className="artifact-copy"><span className="artifact-title">{item.title}</span>
              <span className="artifact-list-meta">{item.detail}</span></span>
          </button>
        </li>)}</ul>
      </ArtifactGroup> : null;
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
