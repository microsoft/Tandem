import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Collapsible, Progress } from "radix-ui";
import { ChevronDown, ChevronRight, CircleStop, Play, RotateCcw, Send } from "lucide-react";
import type { IndependentVerdict } from "../execution-proof.js";
import type { CommandEvidence } from "../verification.js";
import type { PlanWave, PlanWorkItem } from "./plan-panel.js";
import { SpeechTextarea } from "./speech-textarea.js";
import { hasActiveJobs, useAction, useDraft, useUi, type RuntimeSnapshot } from "./ui-context.js";

interface ExecutionEvent {
  id: string;
  type?: string;
  message: string;
  at: string;
}

interface StoredAgent {
  id: string;
  workItemId?: string;
  scenarioId?: string;
  role?: string;
  status?: string;
  activity?: string;
  summary?: string;
}

interface ExecutionView {
  status?: string;
  requestId?: string;
  runId?: string;
  inputRevision?: string;
  sourceFingerprint?: string;
  verifiedSourceFingerprint?: string;
  currentWaveIndex?: number;
  startedAt?: string;
  completedAt?: string;
  agents?: StoredAgent[];
  events?: ExecutionEvent[];
  error?: string;
  commandEvidence?: CommandEvidence[];
  independentVerdict?: IndependentVerdict;
  verificationProfile?: { enabled?: boolean; independentReview?: boolean };
}

interface ImplementationWork {
  id: string;
  status: string;
  summary?: string;
  filesChanged?: string[];
  validation?: string[];
  blockers?: string[];
}

interface ImplementationView extends ExecutionView {
  workItems?: ImplementationWork[];
  strategySuggestions?: Array<{ id: string; status: string; text: string; waveIndex?: number }>;
}

interface TestSpec {
  id: string;
  title: string;
  type?: string;
  description?: string;
  dependencies?: string[];
}

interface TestResult {
  id: string;
  status: string;
  summary?: string;
  evidence?: string[];
}

interface TestView extends ExecutionView {
  scenarios?: TestResult[];
  errorDetails?: string;
}

const disclosureStyle: CSSProperties = {
  width: "100%", padding: 0, border: 0, background: "transparent",
  color: "inherit", textAlign: "left", cursor: "pointer",
};

function elapsed(startedAt?: string, completedAt?: string) {
  if (!startedAt) return "0m";
  const start = Date.parse(startedAt);
  const end = completedAt ? Date.parse(completedAt) : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "0m";
  const minutes = Math.max(0, Math.round((end - start) / 60_000));
  return minutes < 60 ? minutes + "m" : Math.floor(minutes / 60) + "h " + minutes % 60 + "m";
}

function Metrics({ id, values }: { id: string; values: Array<[string | number, string]> }) {
  return <div id={id} className="plan-metrics">
    {values.map(([value, label]) => <div key={label} className="plan-metric"><strong>{value}</strong><span>{label}</span></div>)}
  </div>;
}

function ExecutionProgress({ id, completed, total, verb }: { id: string; completed: number; total: number; verb: string }) {
  const percent = total ? Math.round(completed / total * 100) : 0;
  return <section className="plan-section">
    <div className="implementation-progress-copy">
      <strong>Overall progress</strong>
      <span id={id + "-progress-label"} className="implementation-meta">{completed} of {total} {verb} · {percent}%</span>
    </div>
    <Progress.Root className="implementation-progress-track" value={percent} max={100} aria-labelledby={id + "-progress-label"}>
      <Progress.Indicator id={id + "-progress-bar"} className="implementation-progress-bar" style={{ width: percent + "%" }} />
    </Progress.Root>
  </section>;
}

function ExecutionCard({ draftKey, uiKey, title, status, children, initiallyOpen = false }: {
  draftKey: string;
  uiKey: string;
  title: string;
  status: string;
  children: ReactNode;
  initiallyOpen?: boolean;
}) {
  const initialOpen = useRef(initiallyOpen);
  const [open, setOpen] = useDraft(draftKey, initialOpen.current);
  return <Collapsible.Root className="implementation-card" data-ui-key={uiKey} data-status={status} open={open} onOpenChange={setOpen}>
    <Collapsible.Trigger className="implementation-card-heading" style={disclosureStyle} data-ui-key={uiKey + ":summary"}>
      {open ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
      <strong>{title}</strong><span className="implementation-badge">{status}</span>
    </Collapsible.Trigger>
    <Collapsible.Content>{children}</Collapsible.Content>
  </Collapsible.Root>;
}

function Activity({ id, events = [], runtime, empty }: {
  id: string; events?: ExecutionEvent[]; runtime?: RuntimeSnapshot | null; empty: string;
}) {
  const activity = [
    ...events.map((event) => ({ id: event.id, text: event.message, at: Date.parse(event.at) || 0 })),
    ...(runtime?.progress || []).map((event) => ({
      id: "runtime-" + event.seq, text: event.text, at: Number(event.recordedAt) || 0,
    })),
  ].sort((left, right) => right.at - left.at).slice(0, 20);
  return <div id={id} className="implementation-events">
    {activity.map((event) => <div key={event.id} className="implementation-event">
      <div className="implementation-event-heading">
        <p>{event.text}</p>
        <time>{event.at ? new Date(event.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}</time>
      </div>
    </div>)}
    {!activity.length && <p className="muted" data-status-help={empty}>No activity yet.</p>}
  </div>;
}

function AgentActivity({ kind, stored = [], runtime, planItems = [], specs = [] }: {
  kind: "implementation" | "test";
  stored?: StoredAgent[];
  runtime?: RuntimeSnapshot | null;
  planItems?: PlanWorkItem[];
  specs?: TestSpec[];
}) {
  const liveByItem = new Map((runtime?.agents || []).map((agent) => [
    String(agent.label || "").replace(kind === "test" ? /^test:/ : /^work:/, ""), agent,
  ]));
  const storedByItem = new Map(stored.map((agent) => [kind === "test" ? agent.scenarioId || "" : agent.workItemId || "", agent]));
  const itemIds = new Set([...storedByItem.keys(), ...liveByItem.keys()]);
  return <div id={kind + "-agents"} className="implementation-agents">
    {[...itemIds].map((itemId) => {
      const live = liveByItem.get(itemId);
      const saved = storedByItem.get(itemId);
      const planItem = planItems.find((item) => item.id === itemId);
      const spec = specs.find((item) => item.id === itemId);
      const status = live?.status || saved?.status || "pending";
      const title = kind === "test" ? saved?.id || "Test agent" : planItem?.agentId || saved?.id || "Implementation agent";
      const role = kind === "test" ? spec?.type || "integration" : planItem?.agentRole || saved?.role || "Implementation";
      return <div key={itemId} className="implementation-card" data-status={status}>
        <div className="implementation-card-heading"><strong>{title}</strong><span className="implementation-badge">{status}</span></div>
        <p className="implementation-meta">
          {role} · {planItem?.title || spec?.title || itemId}
          {live?.model ? " · " + live.model : ""}
          {live?.activeMs ? " · " + Math.round(live.activeMs / 1000) + "s active" : ""}
        </p>
        <p>{live?.activity || saved?.activity || saved?.summary || "Waiting for activity."}</p>
      </div>;
    })}
    {!itemIds.size && <p className="muted">No agents yet.</p>}
  </div>;
}

function proofIdentity(execution: ExecutionView, kind: "implementation" | "test") {
  return {
    requestId: execution.requestId,
    runId: execution.runId,
    inputRevision: execution.inputRevision,
    sourceFingerprint: kind === "test" ? execution.sourceFingerprint : execution.verifiedSourceFingerprint,
  };
}

function isCurrentProof(record: Pick<CommandEvidence, "requestId" | "runId" | "inputRevision" | "sourceFingerprint">,
  execution: ExecutionView, kind: "implementation" | "test") {
  const identity = proofIdentity(execution, kind);
  return Boolean(identity.requestId && identity.runId && identity.inputRevision && identity.sourceFingerprint)
    && record.requestId === identity.requestId && record.runId === identity.runId
    && record.inputRevision === identity.inputRevision && record.sourceFingerprint === identity.sourceFingerprint;
}

function VerificationEvidence({ execution, kind, draftKey }: {
  execution: ExecutionView; kind: "implementation" | "test"; draftKey: string;
}) {
  const records = execution.commandEvidence || [];
  const verdict = execution.independentVerdict;
  return <section className="plan-section" aria-labelledby={kind + "-verification-heading"} aria-describedby={kind + "-verification-help"}>
    <h3 id={kind + "-verification-heading"}>Tool-backed verification</h3>
    <p id={kind + "-verification-help"} className="visually-hidden">
      Worker-reported results are not tool-backed verification. Command evidence is bound to its execution request, run, source fingerprint, and input revision.
    </p>
    <div id={kind + "-command-evidence"} className="implementation-list">
      {records.map((record) => <ExecutionCard key={record.id} draftKey={draftKey + ":" + kind + ":command-evidence:" + record.id}
        uiKey={kind + "-command-evidence:" + record.id}
        title={record.checkId + ": " + record.status + " (exit " + (record.exitCode ?? "unavailable") + ")"}
        status={record.status}>
        <p className="implementation-meta">{isCurrentProof(record, execution, kind)
          ? "Evidence for the current execution inputs." : "Historical evidence — not proof for the current execution inputs."}</p>
        <pre className="test-error-details" tabIndex={0}>
          {`${record.program} ${JSON.stringify(record.args)}
Execution request: ${record.requestId}
SDK run: ${record.runId}
Input revision: ${record.inputRevision}
Sources: ${record.sourceFingerprint}
Started: ${record.startedAt}
Completed: ${record.completedAt}
Exit code: ${record.exitCode ?? "unavailable"}
Output SHA256: ${record.outputHash}
${record.output}${record.error ? "\n" + record.error : ""}${record.outputTruncated ? "\n[Output truncated]" : ""}`}
        </pre>
      </ExecutionCard>)}
      {!records.length && <p className="muted">{execution.verificationProfile?.enabled
        ? "No tool-backed command evidence has been captured for this execution."
        : "No tool-backed command evidence is recorded; scenario and work-item evidence is worker-reported."}</p>}
    </div>
    {kind === "test" && <p className="implementation-meta">
      {verdict ? `Independent verifier: ${verdict.status}. ${verdict.summary} ${isCurrentProof(verdict, execution, kind)
        ? "Verdict matches the current execution inputs." : "Historical verdict — not proof for the current execution inputs."}`
        : "Independent verification has not run."}
    </p>}
  </section>;
}

export function ImplementationPanel() {
  const { state, pending, post, canEdit, guidance } = useUi();
  const action = useAction(JSON.stringify([state.prototypeId, state.generation, "implementation"]));
  const implementation: ImplementationView = state.implementation || {};
  const planning = state.planning || {};
  const runtime = state.implementationRuntime;
  const planItems: PlanWorkItem[] = Array.isArray(planning.workItems) ? planning.workItems : [];
  const waves: PlanWave[] = Array.isArray(planning.waves) ? planning.waves : [];
  const workItems = implementation.workItems || [];
  const workById = new Map(workItems.map((item) => [item.id, item]));
  const completed = workItems.filter((item) => item.status === "completed").length;
  const running = workItems.filter((item) => item.status === "running").length;
  const failed = workItems.filter((item) => ["failed", "blocked", "cancelled"].includes(item.status)).length;
  const active = ["starting", "running"].includes(implementation.status || "");
  const isImplementation = state.lifecycle?.currentStage === "implement";
  const editable = canEdit("implement");
  const identity = JSON.stringify([state.prototypeId, state.generation]);
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const [draft, setDraft] = useDraft(identity + ":implementation:strategy", { value: "", version: 0 });
  const [operation, setOperation] = useState<"start" | "stop" | "strategy" | null>(null);
  const blocked = pending || action.busy || !editable;
  const startDisabled = blocked || active || implementation.status === "completed" || !planItems.length;
  const strategyDisabled = blocked || implementation.status === "completed";
  const progress = active
    ? `Wave ${implementation.currentWaveIndex || 1} is active · ${runtime?.liveAgentCount ?? running} live agents`
    : implementation.status === "completed" ? "All planned work completed and final code was captured."
      : failed ? "Review failures, adjust strategy, and retry incomplete work."
        : "Ready to assign the finalized work items.";
  const status = action.error || (operation === "start" ? "Starting agents..." : operation === "stop" ? "Stopping agents..." : "")
    || (!isImplementation ? "Implementation evidence is read only."
      : !editable ? guidance("run implementation")
        : runtime?.error ? "Live agent details are unavailable: " + runtime.error
          : implementation.error || (active ? "Suggestions are queued immediately and applied before the next wave."
            : implementation.status === "completed" ? "Final code is available under Artifacts → Implement."
              : failed ? "Retry preserves completed work and reruns only incomplete items."
                : "Start the agents when the execution plan is ready."));

  function startOrStop(kind: "start" | "stop") {
    if (kind === "start" ? startDisabled : blocked || !active) return;
    void action.run(async () => {
      setOperation(kind);
      try { await post("/api/implementation/" + kind, {}); }
      finally { setOperation(null); }
    });
  }

  function submitStrategy() {
    if (strategyDisabled) return;
    const accepted = draft;
    const text = accepted.value.trim();
    if (!text) { action.setError("Describe how the execution strategy should change."); return; }
    void action.run(async () => {
      setOperation("strategy");
      try {
        await post("/api/implementation/strategy", { text });
        if (currentIdentity.current === identity) {
          setDraft((current) => current.version === accepted.version && current.value === accepted.value
            ? { value: "", version: current.version + 1 } : current);
        }
      } finally { setOperation(null); }
    });
  }

  return <div>
    <div className="implementation-workspace">
      <div className="implementation-heading" aria-describedby="implementation-progress">
        <div className="implementation-heading-copy"><strong>Development execution</strong><span id="implementation-progress" className={active || failed ? undefined : "visually-hidden"}>{progress}</span></div>
        <div className="implementation-controls">
          <button id="start-implementation" className="plan-button" type="button" aria-describedby="implementation-status" disabled={startDisabled} onClick={() => startOrStop("start")}>
            {["failed", "cancelled"].includes(implementation.status || "") ? <RotateCcw size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}{" "}
            {["failed", "cancelled"].includes(implementation.status || "") ? "Retry incomplete work"
              : implementation.status === "completed" ? "Implementation complete" : active ? "Agents running..." : "Start implementation"}
          </button>
          <button id="stop-implementation" className="plan-button secondary" type="button" hidden={!active} disabled={blocked} onClick={() => startOrStop("stop")}>
            <CircleStop size={16} aria-hidden="true" /> {operation === "stop" ? "Stopping..." : "Stop run"}
          </button>
        </div>
      </div>
      <ExecutionProgress id="implementation" completed={completed} total={workItems.length} verb="complete" />
      <Metrics id="implementation-metrics" values={[
        [completed + "/" + workItems.length, "Completed"], [runtime?.liveAgentCount ?? running, "Live agents"],
        [implementation.currentWaveIndex || 0, "Current wave"], [failed, "Needs attention"],
        [elapsed(implementation.startedAt, implementation.completedAt), "Elapsed"],
      ]} />
      <div className="implementation-grid">
        <div className="implementation-main">
          <section className="plan-section">
            <h3>Execution waves</h3>
            <div id="implementation-waves" className="implementation-list">
              {waves.map((wave) => {
                const statuses = (wave.workItemIds || []).map((id) => workById.get(id)?.status || "pending");
                const waveStatus = statuses.length && statuses.every((value) => value === "completed") ? "completed"
                  : statuses.includes("running") ? "running"
                    : statuses.some((value) => ["failed", "blocked", "cancelled"].includes(value)) ? "failed" : "pending";
                return <div key={wave.index} className="implementation-card" data-status={waveStatus}>
                  <div className="implementation-card-heading"><strong>Wave {wave.index}</strong><span className="implementation-badge">{waveStatus}</span></div>
                  <p className="implementation-meta">{(wave.workItemIds || []).map((id) => planItems.find((item) => item.id === id)?.title || id).join(" · ")}</p>
                </div>;
              })}
              {!waves.length && <p className="muted">No execution waves are available.</p>}
            </div>
          </section>
          <section className="plan-section">
            <h3>Work items</h3>
            <div id="implementation-work-items" className="implementation-list">
              {planItems.map((planItem) => {
                const item = workById.get(planItem.id);
                const itemStatus = item?.status || "pending";
                return <ExecutionCard key={planItem.id} title={planItem.title} status={itemStatus}
                  uiKey={"implementation-work:" + planItem.id} draftKey={identity + ":implementation-work:" + planItem.id}
                  initiallyOpen={["running", "failed", "blocked"].includes(itemStatus)}>
                  <p className="implementation-meta">{planItem.agentId} · {planItem.agentRole} · dependencies: {planItem.dependencies?.join(", ") || "none"}</p>
                  {item?.summary && <p>{item.summary}</p>}
                  {!!item?.filesChanged?.length && <p className="implementation-meta">Files: {item.filesChanged.join(", ")}</p>}
                  {!!item?.validation?.length && <p className="implementation-meta">Validation: {item.validation.join(" · ")}</p>}
                  {!!item?.blockers?.length && <p>Blocked: {item.blockers.join(" · ")}</p>}
                </ExecutionCard>;
              })}
            </div>
          </section>
          <section className="plan-section">
            <h3>Agent activity</h3>
            <AgentActivity kind="implementation" stored={implementation.agents} runtime={runtime} planItems={planItems} />
          </section>
          <VerificationEvidence execution={implementation} kind="implementation" draftKey={identity} />
        </div>
        <aside className="implementation-sidebar">
          <section className="plan-section">
            <h3>Adjust execution strategy</h3>
            <form id="implementation-strategy-form" className="implementation-strategy-form inline-composer" aria-describedby="implementation-status" onSubmit={(event) => { event.preventDefault(); submitStrategy(); }}>
              <SpeechTextarea id="implementation-strategy-input" maxLength={4000} disabled={strategyDisabled}
                placeholder="Change priority, validation depth, coordination, or guidance for the next wave."
                aria-label="Implementation strategy adjustment" aria-describedby="implementation-status" value={draft.value}
                onValueChange={(value) => setDraft((current) => ({ value, version: current.version + 1 }))} />
              <div className="plan-actions">
                <span id="implementation-status" className={action.error || operation || implementation.status === "failed" || implementation.error || runtime?.error ? "implementation-status" : "visually-hidden"} role="status" aria-live="polite"
                  data-status={action.error || implementation.status === "failed" || implementation.error || runtime?.error ? "error" : "idle"}>{status}</span>
                <button id="submit-implementation-strategy" className="plan-button" type="submit" aria-describedby="implementation-status" disabled={strategyDisabled}>
                  <Send size={16} aria-hidden="true" /> {operation === "strategy" ? "Queueing..." : "Queue adjustment"}
                </button>
              </div>
            </form>
            <div id="implementation-strategies" className="implementation-strategies">
              {[...(implementation.strategySuggestions || [])].reverse().map((suggestion, index) => <div key={suggestion.id || index} className="implementation-strategy">
                <div className="implementation-card-heading">
                  <span className="implementation-badge">{suggestion.status}</span>
                  <span className="implementation-meta">{suggestion.waveIndex ? "Applied to wave " + suggestion.waveIndex : "Applies at the next wave boundary"}</span>
                </div>
                <p>{suggestion.text}</p>
              </div>)}
            </div>
          </section>
          <section className="plan-section">
            <h3>Recent activity</h3>
            <Activity id="implementation-events" events={implementation.events} runtime={runtime} empty="Run events and factory progress appear here." />
          </section>
        </aside>
      </div>
    </div>
  </div>;
}

function TestErrorDetails({ testing, runtime }: { testing: TestView; runtime?: RuntimeSnapshot | null }) {
  const [open, setOpen] = useState(false);
  const detailsRef = useRef<HTMLPreElement>(null);
  const failedResults = (testing.scenarios || []).filter((scenario) => ["failed", "blocked"].includes(scenario.status));
  const currentCommands = new Map((testing.commandEvidence || [])
    .filter((record) => isCurrentProof(record, testing, "test")).map((record) => [record.checkId, record]));
  const failedCommands = [...currentCommands.values()].filter((record) => record.status === "failed");
  const hasDetails = Boolean(testing.status === "failed" || testing.error || runtime?.error || failedResults.length || failedCommands.length);
  const details = testing.errorDetails || JSON.stringify({
    summary: testing.error || runtime?.error || "Test execution failed.",
    run: {
      id: testing.runId || runtime?.runId || "unavailable",
      status: testing.status || runtime?.status || "failed",
      error: runtime?.error || null,
    },
    failedScenarios: failedResults.map((scenario) => ({
      id: scenario.id, status: scenario.status, summary: scenario.summary, evidence: scenario.evidence || [],
    })),
    failedAgents: (testing.agents || []).filter((agent) => ["failed", "blocked"].includes(agent.status || "")).map((agent) => ({
      id: agent.id, scenarioId: agent.scenarioId, status: agent.status, activity: agent.activity, summary: agent.summary,
    })),
    errorEvents: (testing.events || []).filter((event) => event.type === "error"),
  }, null, 2);
  const verificationDetails = JSON.stringify({
    execution: {
      ...proofIdentity(testing, "test"),
      startedAt: testing.startedAt,
      completedAt: testing.completedAt,
    },
    runtimeError: runtime?.error || null,
    failedLiveAgents: (runtime?.agents || []).filter((agent) => ["failed", "blocked", "error"].includes(agent.status || "")),
    commandEvidence: testing.commandEvidence || [],
    independentVerdict: testing.independentVerdict || null,
  }, null, 2);

  useEffect(() => {
    if (open) detailsRef.current?.focus();
  }, [open]);

  return <Collapsible.Root open={open} onOpenChange={setOpen} hidden={!hasDetails}>
    <Collapsible.Trigger id="test-error-toggle" className="test-error-toggle" type="button" hidden={!hasDetails} aria-controls="test-error-details">
      {open ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}{" "}
      {open ? "Hide error details" : "Show error details"}
    </Collapsible.Trigger>
    <Collapsible.Content asChild forceMount id="test-error-details">
      <pre ref={detailsRef} className="test-error-details" tabIndex={0} hidden={!hasDetails || !open}>
        {hasDetails ? details + "\n\nExecution identity and verification evidence\n" + verificationDetails : ""}
      </pre>
    </Collapsible.Content>
  </Collapsible.Root>;
}

export function TestPanel() {
  const { state, pending, post, canEdit, guidance } = useUi();
  const action = useAction(JSON.stringify([state.prototypeId, state.generation, "test"]));
  const testing: TestView = state.testing || {};
  const specs: TestSpec[] = Array.isArray(state.testDesignReview?.scenarios) ? state.testDesignReview.scenarios : [];
  const runtime = state.testRuntime;
  const results = testing.scenarios || [];
  const resultById = new Map(results.map((result) => [result.id, result]));
  const passed = results.filter((result) => result.status === "passed").length;
  const running = results.filter((result) => result.status === "running").length;
  const failed = results.filter((result) => ["failed", "blocked"].includes(result.status)).length;
  const active = ["starting", "running"].includes(testing.status || "");
  const complete = testing.status === "completed";
  const isTest = state.lifecycle?.currentStage === "test";
  const editable = canEdit("test", true);
  const disabled = pending || action.busy || active || !editable || !specs.length || hasActiveJobs(state);
  const identity = JSON.stringify([state.prototypeId, state.generation]);
  // The request is the durable run identity; progress and late SDK run telemetry must not close diagnostics.
  const runIdentity = testing.requestId || testing.startedAt || testing.runId || "legacy";
  const progress = active
    ? `Wave ${testing.currentWaveIndex || 1} is active · ${runtime?.liveAgentCount ?? running} live agents`
    : complete ? "All approved scenarios passed and test evidence was captured."
      : failed ? "Review failed or blocked scenarios, then retry incomplete tests."
        : "Ready to execute the approved test specification.";
  const status = action.error || (action.busy ? "Starting test agents..." : "")
    || (!isTest ? "Test evidence is read only."
      : !editable ? guidance("run tests")
        : runtime?.error ? "Live agent details are unavailable: " + runtime.error
          : testing.error || (active ? "Independent scenarios run concurrently within each dependency wave."
            : complete ? "Test results are available under Artifacts → Test."
              : failed ? "Retry preserves passes only when source and specification are unchanged; otherwise all scenarios run again."
                : "Run the approved integration and interaction scenarios."));

  function start() {
    if (disabled) return;
    void action.run(() => post("/api/test/start", {}));
  }

  return <div>
    <div className="implementation-workspace">
      <div className="implementation-heading" aria-describedby="test-progress">
        <div className="implementation-heading-copy"><strong>Integration and interaction tests</strong><span id="test-progress" className={active || failed ? undefined : "visually-hidden"}>{progress}</span></div>
        <button id="start-tests" className="plan-button" type="button" aria-describedby="test-status" disabled={disabled} onClick={start}>
          {complete || failed ? <RotateCcw size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}{" "}
          {complete ? "Run tests again" : active ? "Tests running..." : failed ? "Retry incomplete tests" : "Run tests"}
        </button>
      </div>
      <ExecutionProgress id="test" completed={passed} total={results.length} verb="passed" />
      <Metrics id="test-metrics" values={[
        [passed + "/" + results.length, "Passed"], [runtime?.liveAgentCount ?? running, "Live agents"],
        [testing.currentWaveIndex || 0, "Current wave"], [failed, "Needs attention"],
        [elapsed(testing.startedAt, testing.completedAt), "Elapsed"],
      ]} />
      <div className="implementation-grid">
        <div className="implementation-main">
          <section className="plan-section">
            <h3>Test scenarios</h3>
            <div id="test-scenarios" className="implementation-list">
              {specs.map((spec) => {
                const result = resultById.get(spec.id);
                const resultStatus = result?.status || "pending";
                return <ExecutionCard key={spec.id} title={spec.title} status={resultStatus}
                  uiKey={"test-scenario:" + spec.id} draftKey={identity + ":test-scenario:" + spec.id}
                  initiallyOpen={["running", "failed", "blocked"].includes(resultStatus)}>
                  <p className="implementation-meta">{spec.type || "integration"} · dependencies: {spec.dependencies?.join(", ") || "none"}</p>
                  {spec.description && <p>{spec.description}</p>}
                  {result?.summary && <p>{result.summary}</p>}
                  {!!result?.evidence?.length && <>
                    <strong>Evidence</strong>
                    <p className="implementation-meta">Worker-reported scenario evidence</p>
                    <ul>{result.evidence.map((evidence, index) => <li key={index}>{evidence}</li>)}</ul>
                  </>}
                </ExecutionCard>;
              })}
              {!specs.length && <p className="muted" data-status-help="Finalize Test design to create executable scenarios.">No scenarios yet.</p>}
            </div>
          </section>
          <section className="plan-section">
            <h3>Test agents</h3>
            <AgentActivity kind="test" stored={testing.agents} runtime={runtime} specs={specs} />
          </section>
          <VerificationEvidence execution={testing} kind="test" draftKey={identity} />
        </div>
        <aside className="implementation-sidebar">
          <section className="plan-section">
            <h3>Recent test activity</h3>
            <Activity id="test-events" events={testing.events} runtime={runtime} empty="Test events and factory progress appear here." />
            <p id="test-status" className={action.error || action.busy || failed || testing.status === "failed" || testing.error || runtime?.error ? "implementation-status" : "visually-hidden"} role="status" aria-live="polite"
              data-status={action.error || testing.status === "failed" || testing.error || runtime?.error ? "error" : "idle"}>{status}</p>
            <TestErrorDetails key={identity + ":" + runIdentity} testing={testing} runtime={runtime} />
          </section>
        </aside>
      </div>
    </div>
  </div>;
}
