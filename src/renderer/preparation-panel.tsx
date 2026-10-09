import { ExternalLink, RotateCcw } from "lucide-react";
import type { PreparationState } from "../types.js";
import { hasActiveJobs, useAction, useUi, type RuntimeSnapshot } from "./ui-context.js";

type PreparationRuntime = Omit<RuntimeSnapshot, "progress"> & {
  currentPhase?: string;
  progress?: Array<{ seq: number; text: string; recordedAt: number; kind?: string }>;
};

const emptyPreparation: PreparationState = {
  status: "not-started",
  summary: "",
  workItems: [],
  messages: [],
  checks: [],
  sources: [],
  suggestedUsages: [],
  processing: null,
  error: "",
};

export function PreparationPanel() {
  const { state, pending, post, canEdit, guidance } = useUi();
  const action = useAction(JSON.stringify([state.prototypeId, state.generation, "preparation"]));
  const preparation = state.preparation || emptyPreparation;
  const runtime: PreparationRuntime | null | undefined = state.preparationRuntime;
  const preparing = ["not-started", "starting", "running"].includes(preparation.status);
  const currentStage = state.lifecycle?.currentStage || "prepare";
  const editable = canEdit("prepare");
  const retryDisabled = pending || action.busy || !editable || hasActiveJobs(state);
  const liveByWorkItem = new Map(
    (preparing ? runtime?.agents || [] : []).map((agent) => [String(agent.label || "").replace(/^prepare:/, ""), agent]),
  );
  const messages = [
    ...(preparation.messages || []).map((message) => ({
      id: message.id, text: message.text, kind: message.kind, at: Date.parse(message.at) || 0,
    })),
    ...(runtime?.progress || []).map((message) => ({
      id: "runtime-" + message.seq, text: message.text, kind: message.kind || "info",
      at: Number(message.recordedAt) || 0,
    })),
  ].sort((left, right) => right.at - left.at).slice(0, 30);
  const progress = runtime?.currentPhase
    ? "Current phase: " + runtime.currentPhase.split("-").join(" ")
    : preparing
      ? state.status || "Preparation is starting."
      : preparation.status === "failed"
        ? preparation.error || "Preparation stopped before completion. Retry to continue."
        : preparation.summary || "Preparation has completed.";
  const message = action.error
    || preparation.error
    || (runtime?.error ? "Live agent details are unavailable: " + runtime.error : "")
    || (currentStage === "prepare" && !editable ? guidance("retry preparation") : "")
    || (preparation.status === "needs-attention"
      ? "Preparation completed with blockers. Requirements suggestions are still available."
      : preparation.status === "ready"
        ? "Preparation completed and its suggestions were passed to Requirements."
        : "");

  function retry() {
    if (retryDisabled || currentStage !== "prepare" || preparation.status !== "failed") return;
    void action.run(() => post("/api/preparation/retry", {}));
  }

  return <div>
    <section className="preparation-stage-card">
      <div className="preparation-stage-heading" aria-describedby="preparation-stage-progress">
        <div>
          <p className="eyebrow">Environment preparation</p>
          <strong id="preparation-stage-title">
            {preparing ? "Preparing Tandem context" : preparation.status === "failed" ? "Preparation needs attention" : "Preparation results"}
          </strong>
          <p id="preparation-stage-progress" className={preparing || preparation.status === "failed" ? "muted" : "visually-hidden"}>{progress}</p>
        </div>
        <span id="preparation-stage-status" className="preparation-status" data-status={preparation.status}>
          {preparation.status.replace("-", " ")}
        </span>
      </div>
      <div className="preparation-stage-grid">
        <div className="preparation-stage-main">
          <section className="plan-section" aria-describedby="preparation-stage-message">
            <h3>Work items</h3>
            <div id="preparation-work-items" className="implementation-list">
              {(preparation.workItems || []).map((workItem) => {
                const live = liveByWorkItem.get(workItem.id);
                const status = live?.status === "running" ? "running" : workItem.status;
                return <div key={workItem.id} className="implementation-card" data-status={status}>
                  <div className="implementation-card-heading">
                    <strong>{workItem.title}</strong>
                    <span className="implementation-badge">{status}</span>
                  </div>
                  <p className="implementation-meta">{workItem.detail}</p>
                  {(live?.activity || workItem.result) && <p>{live?.activity || workItem.result}</p>}
                </div>;
              })}
              {!preparation.workItems?.length && <p className="muted">No work items yet.</p>}
            </div>
          </section>
          <section className="plan-section">
            <h3>Results</h3>
            <p id="preparation-result-summary" className={preparation.summary ? undefined : "muted"}>
              {preparation.summary || "No results yet."}
            </p>
            <div id="preparation-result-suggestions" className="preparation-result-suggestions">
              {!!preparation.suggestedUsages?.length && <>
                <strong>Passed to Requirements</strong>
                <ul>{preparation.suggestedUsages.map((usage, index) => <li key={index}>{usage}</li>)}</ul>
              </>}
            </div>
            <div id="preparation-result-checks" className="preparation-result-list">
              {(preparation.checks || []).map((check, index) => <div key={check.label + ":" + index} className="preparation-result-item" data-status={check.status}>
                <strong>{check.label} · {check.status}</strong>
                <span>{check.detail}</span>
              </div>)}
            </div>
            <div id="preparation-result-sources" className="preparation-result-sources">
              {(preparation.sources || []).map((source, index) => <a
                key={source.url + ":" + index}
                href={source.url}
                target="_blank"
                rel="noreferrer"
                title={source.purpose || source.url}
                data-ui-key={"preparation-source:" + source.url}
              >
                {source.title} <ExternalLink size={14} aria-hidden="true" />
              </a>)}
            </div>
          </section>
        </div>
        <aside className="preparation-stage-sidebar">
          <section className="plan-section">
            <h3>Progress</h3>
            <div id="preparation-messages" className="implementation-events">
              {messages.map((message) => <div key={message.id} className="implementation-event" data-status={message.kind}>
                <div className="implementation-event-heading">
                  <p>{message.text}</p>
                  <time dateTime={message.at ? new Date(message.at).toISOString() : undefined}>
                    {message.at ? new Date(message.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
                  </time>
                </div>
              </div>)}
              {!messages.length && <p className="muted">No activity yet.</p>}
            </div>
            <button
              id="retry-preparation"
              className="retry-preparation"
              type="button"
              aria-describedby="preparation-stage-message"
              hidden={preparation.status !== "failed" || currentStage !== "prepare"}
              disabled={retryDisabled}
              onClick={retry}
            >
              <RotateCcw size={16} aria-hidden="true" /> {action.busy ? "Retrying..." : "Retry preparation"}
            </button>
            <p id="preparation-stage-message" className={action.error || preparation.error || runtime?.error || ["failed", "needs-attention"].includes(preparation.status) ? "implementation-status" : "visually-hidden"} role="status" aria-live="polite"
              data-status={action.error || preparation.status === "failed" || runtime?.error ? "error" : "idle"}>
              {message}
            </p>
          </section>
        </aside>
      </div>
    </section>
  </div>;
}
