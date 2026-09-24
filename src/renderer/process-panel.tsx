import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Collapsible } from "radix-ui";
import { Check, ChevronDown, Download, FileText, FolderOpen, RefreshCw, Save, Send, Settings, ShieldCheck } from "lucide-react";
import type { AcceptanceRecord } from "../accepted-artifacts.js";
import type { IndependentVerdict } from "../execution-proof.js";
import type { AdapterId, ProcessBlock, ProcessSettings, VerificationCheck } from "../process-state.js";
import type { LifecycleStageId } from "../types.js";
import type { CommandEvidence } from "../verification.js";
import { lifecycleStages } from "../workflow.js";
import { hasActiveJobs, useAction, useDraft, useUi, type UiState } from "./ui-context.js";

interface SettingsFields {
  handoffAdapter: AdapterId;
  statusAdapter: AdapterId;
  intakeAdapter: AdapterId;
  repository: string;
  autoImplement: boolean;
  autoTest: boolean;
  evidenceEnabled: boolean;
  independentReview: boolean;
  checks: string;
  protectedPaths: string;
}

interface SettingsDraft {
  values: SettingsFields;
  baseRevision: number;
  version: number;
}

type ProcessRequest =
  | { action: "configure"; settings: ProcessSettings; expectedRevision: number }
  | { action: "accept"; stageId: LifecycleStageId; approver: string }
  | { action: "export"; acceptanceId: string }
  | { action: "prepare-handoff" }
  | { action: "handoff"; reference: string; confirm: true }
  | { action: "status"; reference: string }
  | { action: "intake"; reference: string; content?: string }
  | { action: "open-intake"; receiptId: string };

type ProcessMetrics = ReturnType<typeof import("../process-state.js").processMetrics>;

function savedSettings(state: UiState): SettingsFields {
  const settings = state.process?.settings;
  return {
    handoffAdapter: settings?.adapters?.handoff ?? "local",
    statusAdapter: settings?.adapters?.status ?? "local",
    intakeAdapter: settings?.adapters?.intake ?? "local",
    repository: settings?.githubRepository || "",
    autoImplement: settings?.autoStartImplementation || false,
    autoTest: settings?.autoStartTests || false,
    evidenceEnabled: settings?.verification?.enabled || false,
    independentReview: settings?.verification?.independentReview !== false,
    checks: JSON.stringify(settings?.verification?.checks || [], null, 2),
    protectedPaths: (settings?.verification?.protectedPaths || []).join("\n"),
  };
}

function stageLabel(stage: LifecycleStageId): string {
  return lifecycleStages.find((candidate) => candidate.id === stage)?.label || stage;
}

function ProcessSection({ name, label, children, outer = false }: {
  name: string;
  label: ReactNode;
  children: ReactNode;
  outer?: boolean;
}) {
  const { state } = useUi();
  const [open, setOpen] = useDraft(
    JSON.stringify([state.prototypeId, state.generation, "process-disclosure", name]), false);
  return <Collapsible.Root open={open} onOpenChange={setOpen} asChild>
    <section className={outer ? "section process-controls" : "process-section"}>
      <Collapsible.Trigger asChild>
        <button type="button" className={outer ? "eyebrow ledger-summary" : "ledger-summary"}>
          <ChevronDown size={14} aria-hidden="true" /> {label}
        </button>
      </Collapsible.Trigger>
      <Collapsible.Content forceMount hidden={!open}>{children}</Collapsible.Content>
    </section>
  </Collapsible.Root>;
}

function AcceptanceDetails({ record, current }: { record: AcceptanceRecord; current: boolean }) {
  return <details data-ui-key={`acceptance:${record.id}`}
    data-status-help="Acceptance records attribution, not authenticated code-owner approval.">
    <summary>{stageLabel(record.stageId)} · {current ? "Current snapshot" : "Historical snapshot"} · {record.acceptedAt}</summary>
    <p>Accepted by {record.acceptedBy.label}.</p>
    <pre>{[
      `Acceptance: ${record.id}`,
      `Snapshot: ${record.snapshotPath}`,
      `Snapshot SHA256: ${record.snapshotHash || "unavailable"}`,
      `Source commit: ${record.source?.commit || "unavailable"}`,
      `Source fingerprint: ${record.source?.fingerprint || "unavailable"}`,
      `Producer version: ${record.producer?.version || "unavailable"}`,
      `Configuration hash: ${record.producer?.configurationHash || "unavailable"}`,
      `Export: ${record.exportPath || "Not exported"}`,
      `Upstream: ${JSON.stringify(record.upstream || [], null, 2)}`,
      `Artifacts: ${JSON.stringify(record.artifactHashes || [], null, 2)}`,
    ].join("\n")}</pre>
  </details>;
}

function EvidenceRecord({ record, current, scope }: { record: CommandEvidence; current: boolean; scope: string }) {
  return <details data-ui-key={`command-evidence:${scope}:${record.id}`}>
    <summary>{record.checkId}: {record.status} (exit {record.exitCode ?? "unavailable"}){current ? "" : " · historical / different inputs"}</summary>
    <pre>{[
      `${record.program} ${JSON.stringify(record.args)}`,
      `Request: ${record.requestId || "unavailable"}`,
      `Run: ${record.runId || "unavailable"}`,
      `Specification / inputs: ${record.inputRevision || "unavailable"}`,
      `Sources: ${record.sourceFingerprint || "unavailable"}`,
      `Started: ${record.startedAt || "unavailable"}`,
      `Completed: ${record.completedAt || "unavailable"}`,
      `Output SHA256: ${record.outputHash || "unavailable"}`,
      record.output,
      record.error || "",
      record.outputTruncated ? "[Output truncated]" : "",
    ].join("\n")}</pre>
  </details>;
}

function ToolEvidence() {
  const { state } = useUi();
  const verdict = state.testing?.independentVerdict as IndependentVerdict | null | undefined;
  const verdictCurrent = verdict && verdict.requestId === state.testing?.requestId
    && verdict.runId === state.testing?.runId
    && verdict.inputRevision === state.testing?.inputRevision
    && verdict.sourceFingerprint === state.testing?.sourceFingerprint;
  return <div id="process-evidence" aria-describedby="process-evidence-help">
    <p id="process-evidence-help" className="visually-hidden">Only tool-backed commands and the independent verifier provide verification evidence.
      Worker-reported completion is not a passing command result. Historical evidence never establishes a pass for different sources or inputs.</p>
    {(["implementation", "testing"] as const).flatMap((scope) => {
      const runtime = state[scope];
      const records = (runtime?.commandEvidence || []) as CommandEvidence[];
      return records.map((record) => {
        const current = Boolean(record.requestId && record.runId && record.inputRevision && record.sourceFingerprint)
          && record.requestId === runtime?.requestId && record.runId === runtime?.runId
          && record.inputRevision === runtime?.inputRevision
          && record.sourceFingerprint === (scope === "implementation" ? runtime?.verifiedSourceFingerprint : runtime?.sourceFingerprint);
        return <EvidenceRecord key={`${scope}:${record.id}`} record={record} current={current} scope={scope} />;
      });
    })}
    <p>{verdict
      ? `Independent verifier: ${verdict.status}. ${verdict.summary}${verdictCurrent ? "" : " Historical verdict; it does not verify the current inputs."}`
      : "Independent verification has not run. Worker-reported evidence is shown in the implementation and test tabs."}</p>
    {verdict && <details data-ui-key={`independent-verdict:${verdict.requestId}:${verdict.runId}`}>
      <summary>Independent verifier identities</summary>
      <pre>{`Request: ${verdict.requestId}\nRun: ${verdict.runId}\nSpecification / inputs: ${verdict.inputRevision}\nSources: ${verdict.sourceFingerprint}`}</pre>
    </details>}
  </div>;
}

export function ProcessPanel() {
  const ui = useUi();
  const { state, pending, post, confirm, guidance } = ui;
  const scope = JSON.stringify([state.prototypeId, state.generation, "process"]);
  const action = useAction(scope);
  const [draft, setDraft] = useDraft<SettingsDraft | null>(`${scope}:settings`, null);
  const [selectedStage, setSelectedStage] = useDraft<string>(`${scope}:stage`, "");
  const [approver, setApprover] = useDraft(`${scope}:approver`, "");
  const [reference, setReference] = useDraft(`${scope}:reference`, "");
  const [intake, setIntake] = useDraft(`${scope}:intake`, "");
  const [message, setMessage] = useState<{ text: string; revision: number } | null>(null);
  const fields = draft?.values || savedSettings(state);
  const process = state.process;
  const outputs = state.lifecycle.outputs || [];
  const stages = [...new Set(outputs.map((output) => output.stageId))];
  const stage = stages.find((candidate) => candidate === selectedStage) || stages.at(-1) || null;
  const selectedOutput = outputs.find((output) => output.stageId === stage);
  const acceptance = (process?.acceptances || []).filter((record) => record.stageId === stage
    && outputs.some((output) => output.stageId === record.stageId && output.path === record.snapshotPath)).at(-1);
  const writable = state.provider?.canSubmitAnswers !== false && !state.effortReset;
  const blocked = action.busy || pending || !writable || hasActiveJobs(state);
  const completedTest = state.lifecycle.completedStages.includes("test");
  const adapters = process?.settings?.adapters;
  const handoffAdapter = adapters?.handoff ?? "local";
  const statusAdapter = adapters?.status ?? "local";
  const intakeAdapter = adapters?.intake ?? "local";
  const latest = useRef({ state, scope, draft });
  latest.current = { state, scope, draft };
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  function edit<K extends keyof SettingsFields>(name: K, value: SettingsFields[K]) {
    setDraft((current) => ({
      values: { ...(current?.values || savedSettings(state)), [name]: value },
      baseRevision: current?.baseRevision ?? state.revision ?? 0,
      version: (current?.version || 0) + 1,
    }));
  }

  function perform(body: ProcessRequest, options: { confirmation?: string; accepted?: () => void } = {}) {
    if (blocked) return;
    const origin = state;
    void action.run(async () => {
      if (options.confirmation && !await confirm(options.confirmation, "Confirm process action")) return;
      if (!mounted.current) return;
      const current = latest.current.state;
      if (latest.current.scope !== scope || current.revision !== origin.revision
        || current.prototypeId !== origin.prototypeId || current.generation !== origin.generation) {
        throw new Error("The effort changed. Review the current state and retry. Your draft has been preserved.");
      }
      if (current.provider?.canSubmitAnswers === false || current.effortReset) {
        throw new Error(guidance("change process settings or handoffs"));
      }
      if (hasActiveJobs(current)) throw new Error("Finish or stop active work before changing process settings or handoffs.");
      const result = await post("/api/process", { expectedRevision: origin.revision ?? 0, ...body });
      if (!mounted.current || latest.current.scope !== scope) return;
      options.accepted?.();
      setMessage({ text: result?.process?.message || "Process action completed.", revision: result?.revision ?? origin.revision });
    });
  }

  function saveSettings(event: FormEvent) {
    event.preventDefault();
    if (blocked) return;
    let checks: VerificationCheck[];
    try {
      const parsed: unknown = JSON.parse(fields.checks);
      if (!Array.isArray(parsed)) throw new Error("Not an array");
      checks = parsed as VerificationCheck[];
    } catch {
      action.setError("Verification commands must be a valid JSON array.");
      return;
    }
    const version = draft?.version ?? 0;
    const settings: ProcessSettings = {
      adapters: { handoff: fields.handoffAdapter, status: fields.statusAdapter, intake: fields.intakeAdapter },
      githubRepository: fields.repository.trim(),
      autoStartImplementation: fields.autoImplement,
      autoStartTests: fields.autoTest,
      verification: {
        enabled: fields.evidenceEnabled,
        independentReview: fields.independentReview,
        checks,
        protectedPaths: fields.protectedPaths.split(/\r?\n/).map((path) => path.trim()).filter(Boolean),
      },
    };
    perform({ action: "configure", settings, expectedRevision: draft?.baseRevision ?? state.revision ?? 0 }, {
      confirmation: "Save these process settings? Enabled verification commands will run with your local user permissions. Acceptance and external publication remain explicit.",
      accepted: () => setDraft((current) => (current?.version ?? 0) === version ? null : current),
    });
  }

  function reloadSettings() {
    if (blocked) return;
    const version = draft?.version ?? 0;
    void action.run(async () => {
      if (!await confirm("Discard the process settings draft and reload saved settings?", "Reload saved settings")) return;
      if (!mounted.current || latest.current.scope !== scope) return;
      if ((latest.current.draft?.version ?? 0) !== version) {
        throw new Error("The settings draft changed while confirmation was open. Your new edits have been preserved.");
      }
      setDraft(null);
      setMessage({ text: "Reloaded saved process settings.", revision: latest.current.state.revision });
    });
  }

  function acceptHandoff() {
    if (blocked || !stage || !selectedOutput || !state.lifecycle.completedStages.includes(stage)) return;
    if (!approver.trim()) {
      action.setError("Enter the name of the person accepting this handoff.");
      return;
    }
    const automatic = stage === "plan" && process?.settings?.autoStartImplementation
      ? " Saved settings will start implementation after this explicit acceptance."
      : stage === "implement" && process?.settings?.autoStartTests
        ? " Saved settings will start tests after this explicit acceptance." : "";
    perform({ action: "accept", stageId: stage, approver }, {
      confirmation: `Accept the immutable ${stageLabel(stage)} handoff at ${selectedOutput.path} as ${approver.trim()}? `
        + `This records attribution, not authenticated code-owner approval. Nothing will be committed or published.${automatic}`,
    });
  }

  const metrics = (state as UiState & { processMetrics?: ProcessMetrics }).processMetrics;
  const metricText = metrics
    ? `${metrics.acceptanceCount} accepted handoffs; ${metrics.reopenedCount} reopenings; ${Math.round(metrics.acceptanceWaitingMs / 60000)} minutes awaiting handoff acceptance. `
      + (metrics.measuredRunCount
        ? `${Math.round((metrics.measuredActiveMs || 0) / 60000)} factory-active minutes; ${((metrics.measuredNanoAiu || 0) / 1e9).toFixed(3)} reported AIU across ${metrics.measuredRunCount} metered runs.`
        : "Factory usage not yet recorded.")
      + (process?.meteringError ? ` ${process.meteringError}` : "")
    : process?.meteringError || "";
  const status = action.error || (action.busy ? "Processing..."
    : message && state.revision <= message.revision ? message.text : process?.message || "");

  return <ProcessSection name="root" label="Handoffs & process" outer>
    <p id="handoff-help" className="visually-hidden">Finish a stage, then accept its immutable handoff. Exports never commit or publish.</p>
    {!writable && <p id="process-readonly-help" className="visually-hidden" role="status">{guidance("change process settings or handoffs")}</p>}
    <label htmlFor="handoff-stage">Completed stage</label>
    <select id="handoff-stage" value={stage || ""} aria-describedby="handoff-help" onChange={(event) => setSelectedStage(event.target.value)}>
      {!stages.length && <option value="">No completed stages</option>}
      {stages.map((id) => <option key={id} value={id}>{stageLabel(id)}</option>)}
    </select>
    <label htmlFor="handoff-approver">Accepted by</label>
    <input id="handoff-approver" maxLength={200} placeholder="Your name (recorded attribution)" value={approver}
      disabled={!writable} onChange={(event) => setApprover(event.target.value)} />
    <button id="accept-handoff" className="complete-stage" type="button" aria-describedby={writable ? "handoff-help" : "process-readonly-help"}
      disabled={blocked || !stage || !state.lifecycle.completedStages.includes(stage)} onClick={acceptHandoff}>
      <Check size={14} aria-hidden="true" /> Accept handoff
    </button>
    <button id="export-handoff" className="complete-stage" type="button" disabled={blocked || !acceptance} aria-describedby="handoff-help"
      onClick={() => acceptance && perform({ action: "export", acceptanceId: acceptance.id }, {
        confirmation: "Export the accepted snapshot and artifacts into tandem-records? Review the bundle before sharing; nothing will be committed.",
      })}>
      <Download size={14} aria-hidden="true" /> Export accepted handoff
    </button>
    <p id="handoff-record" className="muted">{acceptance
      ? `Accepted by ${acceptance.acceptedBy.label} at ${acceptance.acceptedAt}. ${acceptance.exportPath || "Not exported."}`
      : "No acceptance for this stage revision."}</p>

    <ProcessSection name="delivery" label={<><Send size={14} aria-hidden="true" /> Delivery & maintenance</>}>
      <button id="prepare-delivery" className="complete-stage" type="button" disabled={blocked || !completedTest}
        onClick={() => perform({ action: "prepare-handoff" })}>
        <FileText size={14} aria-hidden="true" /> Prepare delivery draft
      </button>
      <pre id="delivery-draft" tabIndex={0}>{process?.deliveryDraft?.body
        || "Finish Test and accept its handoff to prepare a reviewable delivery draft."}</pre>
      {process?.deliveryDraft && <details data-ui-key={`delivery-draft:${process.deliveryDraft.id}`}>
        <summary>Delivery draft provenance</summary>
        <pre>{`Draft: ${process.deliveryDraft.id}\nSources: ${process.deliveryDraft.sourceFingerprint}\nAccepted snapshots: ${process.deliveryDraft.acceptanceIds.join(", ")}`}</pre>
      </details>}
      <label htmlFor="process-reference">Adapter reference</label>
      <input id="process-reference" placeholder="GitHub PR/issue/run URL or local receipt path / incident ID"
        value={reference} disabled={!writable} onChange={(event) => setReference(event.target.value)} />
      <button id="publish-delivery" className="complete-stage" type="button"
        disabled={blocked || !completedTest || !process?.deliveryDraft}
        onClick={() => {
          if (!completedTest || !process?.deliveryDraft) return;
          perform({ action: "handoff", reference, confirm: true }, {
            confirmation: `Publish the displayed delivery draft using ${handoffAdapter}? GitHub posts a comment to the existing PR; Local writes a local bundle. Nothing will be merged or deployed.`,
          });
        }}>
        <Send size={14} aria-hidden="true" /> Publish reviewed handoff ({handoffAdapter})
      </button>
      <button id="refresh-delivery" className="complete-stage" type="button" disabled={blocked}
        onClick={() => perform({ action: "status", reference })}>
        <RefreshCw size={14} aria-hidden="true" /> Read review / check status ({statusAdapter})
      </button>
      <label htmlFor="intake-content">Local intake JSON (unused by GitHub)</label>
      <textarea id="intake-content" rows={5} spellCheck={false}
        placeholder={'{"title":"Incident","body":"Observed failure","kind":"incident"}'}
        value={intake} disabled={!writable} onChange={(event) => setIntake(event.target.value)} />
      <button id="import-intake" className="complete-stage" type="button" disabled={blocked}
        onClick={() => perform({
          action: "intake", reference, ...(intakeAdapter === "github" ? {} : { content: intake }),
        }, {
          confirmation: "Read this source and create a new linked effort? The current effort will not be reset, and no agents will start.",
        })}>
        <Download size={14} aria-hidden="true" /> Import linked effort ({intakeAdapter})
      </button>
      <div id="process-receipts">
        {(process?.receipts || []).slice().reverse().map((receipt) => <details key={receipt.id}
          data-ui-key={`process-receipt:${receipt.id}`}>
          <summary>{receipt.adapter} / {receipt.block} / {receipt.recordedAt}</summary>
          <pre>{`${receipt.reference}\n${receipt.summary}\nInput hash: ${receipt.inputHash || "unavailable"}`}</pre>
          {receipt.followupId && <button type="button" className="complete-stage" disabled={blocked}
            onClick={() => perform({ action: "open-intake", receiptId: receipt.id }, {
              confirmation: `Open linked effort ${receipt.followupId} and start its Preparation? The current effort will remain unchanged.`,
            })}>
            <FolderOpen size={14} aria-hidden="true" /> Open linked effort and start Preparation
          </button>}
        </details>)}
      </div>
    </ProcessSection>

    <ProcessSection name="settings" label={<><Settings size={14} aria-hidden="true" /> Process settings</>}>
      <form onSubmit={saveSettings} aria-label="Process settings" aria-busy={action.busy}>
        {(["handoff", "status", "intake"] as ProcessBlock[]).map((block) => {
          const name = `${block}Adapter` as "handoffAdapter" | "statusAdapter" | "intakeAdapter";
          return <div key={block}>
            <label htmlFor={`${block}-adapter`}>{block === "handoff" ? "Delivery handoff"
              : block === "status" ? "Review / check status" : "Issue / incident intake"}</label>
            <select id={`${block}-adapter`} value={fields[name]} disabled={!writable}
              onChange={(event) => edit(name, event.target.value as AdapterId)}>
              <option value="local">Local</option><option value="github">GitHub</option>
            </select>
          </div>;
        })}
        <label htmlFor="process-repository">GitHub repository</label>
        <input id="process-repository" placeholder="owner/repository" maxLength={200} disabled={!writable}
          value={fields.repository} onChange={(event) => edit("repository", event.target.value)} />
        <label><input id="auto-implement" type="checkbox" checked={fields.autoImplement} disabled={!writable}
          onChange={(event) => edit("autoImplement", event.target.checked)} /> Start implementation after explicit Plan handoff acceptance</label>
        <label><input id="auto-test" type="checkbox" checked={fields.autoTest} disabled={!writable}
          onChange={(event) => edit("autoTest", event.target.checked)} /> Start tests after explicit Implement handoff acceptance</label>
        <label><input id="evidence-enabled" type="checkbox" checked={fields.evidenceEnabled} disabled={!writable}
          onChange={(event) => edit("evidenceEnabled", event.target.checked)} /> Require tool-backed verification</label>
        <label><input id="independent-review" type="checkbox" checked={fields.independentReview} disabled={!writable}
          onChange={(event) => edit("independentReview", event.target.checked)} /> Independent final verifier</label>
        <label htmlFor="protected-paths">Protected acceptance files / directories (one per line)</label>
        <textarea id="protected-paths" rows={3} spellCheck={false} placeholder={"tests\\regressions"}
          value={fields.protectedPaths} disabled={!writable} onChange={(event) => edit("protectedPaths", event.target.value)} />
        <label htmlFor="verification-checks">Approved commands (JSON array)</label>
        <textarea id="verification-checks" rows={8} spellCheck={false} aria-describedby="verification-help"
          value={fields.checks} disabled={!writable} onChange={(event) => edit("checks", event.target.value)} />
        <p id="verification-help" className="visually-hidden">Each check: id, program, args, stage (implementation or test),
          afterWorkItems, timeoutSeconds. Only approve commands you trust. No shell interpolation.</p>
        <p id="process-settings-help" className="visually-hidden">Settings are drafts until saved. Actions use the saved adapter; an adapter error never switches to a different adapter.</p>
        {draft && <p className="muted" role="status">Unsaved settings based on revision {draft.baseRevision}.
          {draft.baseRevision !== state.revision ? " The effort has changed; saving may conflict. Reload saved settings to discard this draft." : ""}</p>}
        <button id="save-process" className="complete-stage" type="submit" disabled={blocked} aria-describedby="process-settings-help">
          <Save size={14} aria-hidden="true" /> Save process settings
        </button>
        <button id="reset-process" className="complete-stage" type="button" disabled={blocked} onClick={reloadSettings}>
          <RefreshCw size={14} aria-hidden="true" /> Reload saved settings
        </button>
      </form>
    </ProcessSection>
    <p id="process-metrics" className="muted">{metricText}</p>
    <ProcessSection name="history" label="Acceptance & process history">
      {(process?.acceptances || []).slice().reverse().map((record) => <AcceptanceDetails key={record.id} record={record}
        current={outputs.some((output) => output.stageId === record.stageId && output.path === record.snapshotPath)} />)}
      {(process?.events || []).slice().reverse().map((event) => <details key={event.id} data-ui-key={`process-event:${event.id}`}>
        <summary>{stageLabel(event.stage)} · {event.kind} · {event.at}</summary>
        <p>{event.detail}</p>
      </details>)}
      {process?.source && <p className="muted">Source: {process.source.adapter} · {process.source.reference}
        {process.source.parentEffortId ? ` · Parent effort: ${process.source.parentEffortId}` : ""}</p>}
      {!(process?.acceptances || []).length && !(process?.events || []).length && <p className="muted">No handoffs or process events recorded yet.</p>}
    </ProcessSection>
    <ProcessSection name="evidence" label={<><ShieldCheck size={14} aria-hidden="true" /> Tool-backed evidence</>}>
      <ToolEvidence />
    </ProcessSection>
    <p id="process-message" className="stage-message" role="status" aria-live="polite"
      data-status={action.error ? "error" : "idle"}>{status}</p>
  </ProcessSection>;
}
