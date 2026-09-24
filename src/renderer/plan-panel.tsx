import { useRef, useState, type CSSProperties } from "react";
import { Collapsible } from "radix-ui";
import { Check, ChevronDown, ChevronRight, Network, RotateCcw, SlidersHorizontal } from "lucide-react";
import { escapeMermaidLabel } from "../decision-diagram.js";
import { Diagram } from "./diagram.js";
import { SpeechTextarea } from "./speech-textarea.js";
import { useAction, useDraft, useUi } from "./ui-context.js";

export interface PlanWorkItem {
  id: string;
  title: string;
  description?: string;
  agentId?: string;
  agentRole?: string;
  estimatedHours?: number;
  dependencies?: string[];
  files?: string[];
  acceptanceCriteria?: string[];
  validation?: string[];
}

export interface PlanWave {
  index: number;
  startHour?: number;
  endHour?: number;
  workItemIds?: string[];
}

interface PlanAgent {
  id: string;
  estimatedHours?: number;
  roles?: string[];
  workItemIds?: string[];
}

const disclosureStyle: CSSProperties = {
  width: "100%", padding: "var(--studio-control-padding)", border: 0, background: "transparent",
  color: "inherit", textAlign: "left", cursor: "pointer",
};

function PlanList({ items, empty }: { items?: string[]; empty: string }) {
  return <ul>{items?.length
    ? items.map((value, index) => <li key={index}>{value}</li>)
    : <li className="muted">{empty}</li>}</ul>;
}

function buildPlanMermaid(items: PlanWorkItem[]) {
  const aliases = new Map(items.map((item, index) => [item.id, "PlanWork" + index]));
  const lines = ["flowchart LR", ...items.map((item) =>
    `  ${aliases.get(item.id)}["${escapeMermaidLabel(item.title)}<br/>${escapeMermaidLabel(item.agentId || "")}"]`,
  )];
  for (const item of items) {
    for (const dependency of item.dependencies || []) {
      if (aliases.has(dependency)) lines.push(`  ${aliases.get(dependency)} --> ${aliases.get(item.id)}`);
    }
  }
  return lines.join("\n");
}

function PlanItem({ item, draftKey }: { item: PlanWorkItem; draftKey: string }) {
  const [open, setOpen] = useDraft(draftKey, false);
  return <Collapsible.Root className="plan-work-item" data-ui-key={"plan-work:" + item.id} open={open} onOpenChange={setOpen}>
    <Collapsible.Trigger className="plan-work-item-heading" style={disclosureStyle} data-ui-key={"plan-work:" + item.id + ":summary"}>
      {open ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
      <strong>{item.title}</strong>
      <span className="plan-work-item-meta">{item.agentId} · {item.estimatedHours}h</span>
    </Collapsible.Trigger>
    <Collapsible.Content className="plan-work-item-body">
      <p>{item.description}</p>
      <p className="plan-work-item-meta">
        Role: {item.agentRole} · Dependencies: {item.dependencies?.join(", ") || "None"} · Files: {item.files?.join(", ") || "Owned scope TBD"}
      </p>
      <strong>Acceptance criteria</strong>
      <PlanList items={item.acceptanceCriteria} empty="None recorded" />
      <strong>Validation</strong>
      <PlanList items={item.validation} empty="None recorded" />
    </Collapsible.Content>
  </Collapsible.Root>;
}

export function PlanPanel() {
  const { state, pending, post, canEdit, guidance } = useUi();
  const action = useAction(JSON.stringify([state.prototypeId, state.generation, "plan"]));
  const planning = state.planning || {};
  const workItems: PlanWorkItem[] = Array.isArray(planning.workItems) ? planning.workItems : [];
  const waves: PlanWave[] = Array.isArray(planning.waves) ? planning.waves : [];
  const agents: PlanAgent[] = Array.isArray(planning.agents) ? planning.agents : [];
  const identity = JSON.stringify([state.prototypeId, state.generation]);
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const [maxAgents, setMaxAgents] = useDraft(identity + ":plan:max-agents", String(planning.maxAgents || 4));
  const [draft, setDraft] = useDraft(identity + ":plan:revision", { value: "", version: 0 });
  const [operation, setOperation] = useState<"generate" | "revise" | "finalize" | null>(null);
  const isPlan = state.lifecycle?.currentStage === "plan";
  const editable = canEdit("plan");
  const hasPlan = workItems.length > 0;
  const processing = Boolean(planning.processing);
  const finalized = planning.finalizedArtifactId === "execution-plan" && planning.status === "complete";
  const disabled = pending || action.busy || processing || !editable;
  const finalizeDisabled = disabled || !hasPlan || planning.status !== "ready";
  const progress = processing
    ? "The planning agent is building an optimized execution schedule."
    : finalized
      ? "Execution plan captured and ready for implementation."
      : hasPlan
        ? `${workItems.length} work items · ${waves.length} parallel waves · ${agents.length} agents`
        : "Generate work items, schedule waves, and agent assignments.";
  const status = action.error || (!isPlan
    ? "Execution plan is read only. Reopen Plan to change it."
    : !editable ? guidance("generate the plan")
      : planning.error || (processing ? "Planning continues asynchronously."
        : finalized ? "The final execution plan is available under Artifacts → Plan."
          : hasPlan ? "Review the schedule, revise it, then finalize the plan."
            : "Set the agent limit and generate the initial plan."));
  const metrics = [
    [workItems.length, "Work items"], [waves.length, "Parallel waves"], [agents.length, "Agents"],
    [(planning.metrics?.scheduledHours || 0) + "h", "Elapsed schedule"],
    [(planning.metrics?.parallelismSavingsHours || 0) + "h", "Parallel time saved"],
  ];

  function generate(kind: "generate" | "revise", instruction: string, accepted?: typeof draft) {
    if (disabled) return;
    void action.run(async () => {
      setOperation(kind);
      try {
        await post("/api/plan/generate", {
          action: kind, instruction, maxAgents: Math.max(1, Math.min(30, Number.parseInt(maxAgents, 10) || 4)),
        });
        if (accepted && currentIdentity.current === identity) {
          setDraft((current) => current.version === accepted.version && current.value === accepted.value
            ? { value: "", version: current.version + 1 } : current);
        }
      } finally {
        setOperation(null);
      }
    });
  }

  function finalize() {
    if (finalizeDisabled) return;
    void action.run(async () => {
      setOperation("finalize");
      try { await post("/api/plan/finalize", {}); }
      finally { setOperation(null); }
    });
  }

  return <div>
    <div className="plan-workspace">
      <div className="plan-heading" aria-describedby="plan-status">
        <div className="plan-heading-copy">
          <strong>Implementation orchestration</strong>
          <span id="plan-progress" className={processing || hasPlan && !finalized ? undefined : "visually-hidden"}>{progress}</span>
        </div>
        <div className="plan-controls">
          <label className="plan-agent-limit">
            Max agents
            <input id="plan-max-agents" type="number" min={1} max={30} value={maxAgents} disabled={disabled} onChange={(event) => setMaxAgents(event.currentTarget.value)} />
          </label>
          <button id="generate-plan" className="plan-button" type="button" disabled={disabled} aria-describedby="plan-status"
            onClick={() => generate(hasPlan ? "revise" : "generate", hasPlan
              ? "Regenerate the complete plan for the selected agent limit while preserving accepted design scope." : "")}>
            {hasPlan ? <RotateCcw size={16} aria-hidden="true" /> : <Network size={16} aria-hidden="true" />}{" "}
            {processing || operation === "generate" || operation === "revise"
              ? planning.processing?.action === "revise" || operation === "revise" ? "Revising..." : "Generating..."
              : hasPlan ? "Regenerate plan" : "Generate plan"}
          </button>
          <button id="finalize-plan" className="plan-button secondary" type="button" disabled={finalizeDisabled} aria-describedby="plan-status" onClick={finalize}>
            <Check size={16} aria-hidden="true" /> {operation === "finalize" ? "Finalizing..." : finalized ? "Plan finalized" : "Finalize plan"}
          </button>
        </div>
      </div>
      <p id="plan-status" className={action.error || processing || action.busy || planning.status === "failed" || planning.error ? "plan-status" : "visually-hidden"} role="status" aria-live="polite"
        data-status={action.error || planning.status === "failed" || planning.error ? "error" : "idle"}>{status}</p>
      <div id="plan-metrics" className="plan-metrics">
        {metrics.map(([value, label]) => <div key={label} className="plan-metric"><strong>{value}</strong><span>{label}</span></div>)}
      </div>
      <section id="plan-strategy-section" className="plan-section" hidden={!hasPlan}>
        <h3>Orchestration strategy</h3>
        <p id="plan-strategy" className="plan-strategy">{planning.strategy || planning.summary || ""}</p>
      </section>
      <div id="plan-columns" className="plan-columns" hidden={!hasPlan}>
        <div className="plan-main">
          <section className="plan-section">
            <h3>Parallel schedule</h3>
            <div id="plan-waves" className="plan-waves">
              {waves.map((wave) => <div key={wave.index} className="plan-wave">
                <div className="plan-wave-heading"><strong>Wave {wave.index}</strong><span>Hours {wave.startHour}–{wave.endHour}</span></div>
                <div className="plan-wave-items">{(wave.workItemIds || []).map((id) => {
                  const item = workItems.find((candidate) => candidate.id === id);
                  return item ? <span key={id} className="plan-wave-item">{item.agentId} · {item.title}</span> : null;
                })}</div>
              </div>)}
            </div>
          </section>
          <section className="plan-section">
            <h3>Implementation work items</h3>
            <div id="plan-work-items" className="plan-work-items">
              {workItems.map((item) => <PlanItem key={item.id} item={item} draftKey={identity + ":plan-work:" + item.id} />)}
            </div>
          </section>
        </div>
        <aside className="plan-sidebar">
          <section className="plan-section">
            <h3>Agent workload</h3>
            <div id="plan-agents" className="plan-agents">
              {agents.map((agent) => <div key={agent.id} className="plan-agent">
                <strong>{agent.id}</strong>
                <span className="plan-agent-meta">{agent.estimatedHours}h · {agent.roles?.join(", ")} · {agent.workItemIds?.length || 0} items</span>
              </div>)}
            </div>
          </section>
          <section className="plan-section">
            <h3>Risks and coordination</h3>
            <ul id="plan-risks" className="plan-risks">
              {planning.risks?.length ? planning.risks.map((risk: string, index: number) => <li key={index}>{risk}</li>)
                : <li className="muted">No additional planning risks recorded.</li>}
            </ul>
          </section>
        </aside>
      </div>
      <section id="plan-dag-section" className="plan-section" hidden={!hasPlan}>
        <h3>Dependency DAG</h3>
        {hasPlan && <Diagram id="plan-dag" source={buildPlanMermaid(workItems)} label="Execution plan dependency graph" />}
      </section>
      <section id="plan-revision-section" className="plan-section" hidden={!hasPlan}>
        <h3>Revise execution plan</h3>
        <form id="plan-revision-form" className="plan-revision-form" onSubmit={(event) => {
          event.preventDefault();
          if (disabled) return;
          if (!draft.value.trim()) { action.setError("Describe how the plan should change."); return; }
          generate("revise", draft.value.trim(), draft);
        }}>
          <SpeechTextarea id="plan-revision-input" maxLength={4000} disabled={disabled}
            placeholder="Describe how assignments, dependencies, work-item scope, or schedule should change."
            aria-label="Execution plan revision" aria-describedby="plan-status" value={draft.value}
            onValueChange={(value) => setDraft((current) => ({ value, version: current.version + 1 }))} />
          <div className="plan-actions">
            <button id="optimize-plan" className="plan-button secondary" type="button" disabled={disabled}
              onClick={() => generate("revise", "Reduce unnecessary dependencies and file ownership conflicts, widen safe parallel frontiers, balance agent workload, and shorten scheduled elapsed time without dropping scope or validation.")}>
              <SlidersHorizontal size={16} aria-hidden="true" /> Optimize parallelism
            </button>
            <button id="revise-plan" className="plan-button" type="submit" disabled={disabled}>
              <RotateCcw size={16} aria-hidden="true" /> {processing || operation === "revise" ? "Revising..." : "Revise plan"}
            </button>
          </div>
        </form>
      </section>
    </div>
  </div>;
}
