import { AlertDialog, Button, Disclosure, IconButton, Tabs, Textarea, Tooltip } from "./ui/index.js";
import { Component, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ErrorInfo, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { ArrowRight, Check, ChevronDown, CircleDot, ClipboardList, Code, FileText, FolderOpen, GitBranch, Layers, ListChecks, LockKeyhole, Monitor, PanelLeft, PanelLeftClose, PanelLeftOpen, PencilRuler, Pin, Play, RotateCcw, Sparkles, X } from "lucide-react";
import { lifecycleStages } from "../workflow.js";
import { awaitingVisualChoice } from "../visual-directions.js";
import type { LifecycleStageId } from "../types.js";
import { StudioStore } from "./state-store.js";
import { canBrowseStage, canOpenDevelopment, DraftProvider, hasActiveJobs, skippedStage, UiContext, useAction, useChangeRequestDialog, useDraft, useStatusHelp, useUi, type UiContextValue, type UiState } from "./ui-context.js";
import { PreparationPanel } from "./preparation-panel.js";
import { RequirementsPanel } from "./requirements-panel.js";
import { SketchPanel, SketchCompletionContext, isSketchRevisionApproved } from "./sketch-panel.js";
import { PrototypePanel, prototypeCompletionBlocked } from "./prototype-panel.js";
import { ArtifactList, ArtifactsPanel, DevelopmentArtifactList } from "./artifacts-panel.js";
import { DevelopmentPanel } from "./development-panel.js";
import { HandoffReviewProvider, useHandoffStatus } from "./handoff-review.js";
import { modelSelectionLabel } from "../../development/tandem/public/model-selection.js";
import { WorkflowActivity } from "./workflow-activity.js";
import { ProjectConversation, ProjectConversationProvider, useProjectView } from "./project-conversation.js";
import { DiscoveryRecovery } from "./discovery-recovery.js";
import { ChangeRequestsPanel } from "./change-requests-panel.js";
import { changeRequestActionLabel, changeRequestReviewStage } from "./change-request-feedback.js";
import { changeReviewBlocksEditing, currentChangeReview, pendingUpstreamReviewStage } from "../change-request-policy.js";
import { PendingReviewPane, StageReviewWorkspace } from "./stage-review.js";
import { Brand } from "./brand.js";
import { useStandaloneHeader, type ApplicationStatus, type StandaloneHosting } from "./standalone-header.js";

const stageTabs = [
  { stage: "prepare", value: "preparation", id: "preparation", label: "Preparation", icon: Sparkles, className: "preparation-panel" },
  { stage: "requirements", value: "design-tree", id: "design-tree", label: "Requirements", icon: GitBranch, className: "design-tree-panel" },
  { stage: "sketch", value: "sketch", id: "sketch", label: "Designs", icon: PencilRuler, className: "sketch-panel" },
  { stage: "prototype", value: "preview", id: "live-preview", label: "Live prototype", icon: Monitor, className: "frame-wrap" },
  { stage: "development", value: "development", id: "development", label: "Development", icon: Code, className: "development-panel" },
] as const;
type TabId = typeof stageTabs[number]["value"] | "content";
const minimumContextWidth = 220;
const tabFor = (stage: LifecycleStageId): TabId => stageTabs.find((tab) => tab.stage === stage)?.value || "content";
export const isGoalEntry = (state: UiState) => !state.goal?.trim() && state.lifecycle.currentStage === "prepare" && state.preparation?.status === "not-started";

export function canCompleteStage(state: UiState): boolean {
  const stage = state.lifecycle.currentStage;
  if (pendingUpstreamReviewStage(state)) return false;
  if (changeReviewBlocksEditing(state)) return false;
  if (state.effortReset || state.provider?.canSubmitAnswers === false || skippedStage(state, stage)
    || state.lifecycle.completedStages.includes(stage) || hasActiveJobs(state)) return false;
  switch (stage) {
    case "prepare": return false;
    case "requirements": return state.preparation?.status !== "not-started" && state.prototypeApproach?.mode !== "undecided"
      && state.requirements?.substage === "dag" && Boolean(state.decisionGraph?.nodes?.length)
      && state.decisionGraph.nodes.every((node) => Boolean(node.answer));
    case "sketch": return isSketchRevisionApproved(state.sketch);
    case "prototype": return state.previewStatus === "ready" && state.prototypeApproach?.mode !== "undecided" && !prototypeCompletionBlocked(state);
    case "development": return false;
  }
}

class RenderBoundary extends Component<{ children: ReactNode }, { error: string }> {
  state = { error: "" };
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("Tandem UI failed to render.", error, info.componentStack); }
  render() {
    return this.state.error
      ? <main className="start-panel"><div className="start-content" role="alert"><h1>Tandem could not display this workspace</h1><p>{this.state.error}</p><p>Reload the page to reconnect. Saved project data has not been reset.</p></div></main>
      : this.props.children;
  }
}

interface Confirmation { title: string; message: string; resolve: (confirmed: boolean) => void }
export function App({ store, version, connect = true }: { store: StudioStore; version: string; connect?: boolean }) {
  const { state, connectionError } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const confirmationRef = useRef<Confirmation | null>(null);
  const confirmationFocus = useRef<HTMLElement | null>(null);
  const confirm = useCallback<UiContextValue["confirm"]>((message, title = "Confirm action") => new Promise((resolve) => {
    confirmationRef.current?.resolve(false);
    confirmationFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const next = { message, title, resolve };
    confirmationRef.current = next;
    setConfirmation(next);
  }), []);
  const resolve = useCallback((approved: boolean) => {
    confirmationRef.current?.resolve(approved);
    confirmationRef.current = null;
    setConfirmation(null);
  }, []);
  useEffect(() => connect ? store.connect() : undefined, [store, connect]);
  useEffect(() => () => confirmationRef.current?.resolve(false), []);
  return <RenderBoundary><Tooltip.Provider delayDuration={500}>
    {state ? <DraftProvider key={state.prototypeId + ":" + state.generation}>
      <EffortApp state={state} store={store} version={version} connectionError={connectionError} confirm={confirm} />
    </DraftProvider> : <div className="app"><header className="topbar"><Brand /><span className="build-version">v{version}</span></header>
      <main className="start-panel"><div className="start-content"><h2>What do you want to build?</h2><p id="start-loading" role="status">{connectionError || "Loading your project..."}</p></div></main></div>}
    <AlertDialog.Root open={Boolean(confirmation)} onOpenChange={(open) => { if (!open) resolve(false); }}>
      <AlertDialog.Portal><AlertDialog.Overlay className="dialog-overlay" /><AlertDialog.Content className="dialog-content"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (confirmationFocus.current?.isConnected) confirmationFocus.current.focus({ preventScroll: true });
          confirmationFocus.current = null;
        }}>
        <AlertDialog.Title>{confirmation?.title}</AlertDialog.Title><AlertDialog.Description>{confirmation?.message}</AlertDialog.Description>
        <div className="dialog-actions"><AlertDialog.Cancel className="plan-button secondary" onClick={() => resolve(false)}><X size={15} aria-hidden="true" />Cancel</AlertDialog.Cancel>
          <AlertDialog.Action className="plan-button" onClick={() => resolve(true)}><Check size={15} aria-hidden="true" />Confirm</AlertDialog.Action></div>
      </AlertDialog.Content></AlertDialog.Portal>
    </AlertDialog.Root>
  </Tooltip.Provider></RenderBoundary>;
}

function EffortApp({ state, store, version, connectionError, confirm }: {
  state: UiState; store: StudioStore; version: string; connectionError: string; confirm: UiContextValue["confirm"];
}) {
  const [busy, setBusyKeys] = useState<Set<string>>(() => new Set());
  const changeRequestDialog = useChangeRequestDialog();
  const [activeTab, setActiveTab] = useState<TabId>(() =>
    state.lifecycle.currentStage === "development" && !state.development && !state.developmentIntent
      && state.lifecycle.outputs.some(output => output.stageId === "prototype")
      ? canBrowseStage(state, "prototype") ? "preview" : "design-tree" : tabFor(state.lifecycle.currentStage));
  const [selectedArtifact, setSelectedArtifact] = useState<string | null>(null);
  const [contextOpen, setContextOpen] = useState(false);
  const previousStage = useRef(state.lifecycle.currentStage);
  const [sketchBlocked, setSketchBlocked] = useState(true);
  const setBusy = useCallback((key: string, value: boolean) => setBusyKeys((current) => {
    if (current.has(key) === value) return current;
    const next = new Set(current);
    if (value) next.add(key); else next.delete(key);
    return next;
  }), []);
  const browseStage = useCallback((stage: LifecycleStageId) => {
    if (!canBrowseStage(state, stage)) return;
    setActiveTab(tabFor(stage)); setContextOpen(false);
  }, [state]);
  const selectArtifact = useCallback((id: string) => { setSelectedArtifact(id); setActiveTab("content"); setContextOpen(false); }, []);
  useEffect(() => {
    const stage = state.lifecycle.currentStage;
    if (previousStage.current !== stage) {
      const previous = previousStage.current;
      setActiveTab((current) => (stage !== "development" || state.developmentIntent?.generation === state.generation)
        && current === tabFor(previous) ? tabFor(stage) : current);
      previousStage.current = stage;
    }
  }, [state.lifecycle.currentStage, state.developmentIntent, state.generation]);
  useEffect(() => {
    document.body.classList.toggle("prototype-view", activeTab === "preview");
    return () => document.body.classList.remove("prototype-view");
  }, [activeTab]);
  const value: UiContextValue = {
    state, pending: busy.size > 0 || Boolean(state.effortReset), post: store.post, refresh: store.refresh,
    canEdit: (stage, allowCompleted = false) => !state.effortReset && !busy.has("effort") && !busy.has("stage")
      && !changeReviewBlocksEditing(state)
      && state.lifecycle.currentStage === stage && !skippedStage(state, stage)
      && (!["sketch", "prototype"].includes(stage) || state.prototypeApproach?.mode !== "undecided")
      && (allowCompleted || !state.lifecycle.completedStages.includes(stage)) && state.provider?.canSubmitAnswers !== false,
    guidance: (action) => changeReviewBlocksEditing(state) ? "Resolve the current review before changing this work."
      : state.provider?.source === "session" ? "Return to the Tandem session that owns this effort to " + action + "."
      : "Open the installed user-scoped Tandem to " + action + ".",
    confirm, browseStage, selectArtifact, setBusy, changeRequestDialog,
  };
  return <UiContext.Provider value={value}>
    <ProjectConversationProvider designVisible={activeTab === "development"} effortBusy={busy.has("effort")}
      viewedStage={stageTabs.find(tab => tab.value === activeTab)?.stage
        ?? stageTabs.find(tab => tab.stage === state.artifacts.find(item => item.id === selectedArtifact)?.stage)?.stage ?? state.lifecycle.currentStage}
      onEntry={(path, firstChoice) => { if (path === "development") setActiveTab("development"); else if (firstChoice) setActiveTab("preparation"); }}
      showDesign={() => setActiveTab("development")}><HandoffReviewProvider><Workspace version={version} connectionError={connectionError} store={store} activeTab={activeTab} onTabChange={setActiveTab}
      selectedArtifact={selectedArtifact} contextOpen={contextOpen} setContextOpen={setContextOpen}
      sketchBlocked={sketchBlocked} onSketchBlocked={setSketchBlocked} effortBusy={busy.has("effort")} /></HandoffReviewProvider></ProjectConversationProvider>
  </UiContext.Provider>;
}

function GoalEntry() {
  const { state, pending, post } = useUi();
  const action = useAction("effort");
  const [goal, setGoal] = useDraft("start-goal", "");
  const input = useRef<HTMLTextAreaElement>(null);
  const writable = state.provider?.canSubmitAnswers !== false;
  return <section id="start-panel" className="start-panel" aria-labelledby="start-title">
    <div className="start-content"><h2 id="start-title">What do you want to build?</h2>
      <form id="start-form" className="start-form" aria-busy={action.busy} onSubmit={(event) => {
        event.preventDefault();
        if (pending || !writable) return;
        if (!goal.trim() || goal.length > 4000) { action.setError("Enter a project goal between 1 and 4,000 characters."); input.current?.focus(); return; }
        void action.run(async () => {
          await post("/api/effort/start", { expectedRevision: state.revision ?? 0, generation: state.generation, goal: goal.trim() });
        });
      }}>
        <label htmlFor="start-goal">Your project goal</label>
        <Textarea submitOnEnter className="composer-input" id="start-goal" ref={input} value={goal} onChange={(event) => { setGoal(event.currentTarget.value); action.setError(""); }}
          rows={5} maxLength={4000} required disabled={!writable || pending} aria-invalid={Boolean(action.error)}
          aria-describedby="start-help start-message" placeholder="Build an app that helps my team triage customer requests." />
        <p id="start-help" className="visually-hidden">Describe who it is for and what it should help them do. You can refine the details together.</p>
        <div className="start-actions"><span id="goal-length" className="muted">{goal.length.toLocaleString()} / 4,000</span>
          <Button variant="primary" id="start-effort" className="plan-button" type="submit" disabled={!writable || pending || !goal.trim() || goal.length > 4000}
            data-status-help="Starting checks workspace context and opens Requirements. Substantive research follows your accepted usages; implementation comes later."><Play size={16} aria-hidden="true" />{action.busy ? "Starting..." : "Start project"}</Button></div>
        <p id="start-message" className="start-message" role="status" data-status={action.error ? "error" : "idle"}>{action.error || (!writable ? "Open the writable Tandem provider to start this project." : "")}</p>
      </form>
    </div>
  </section>;
}

function Header({ version, connectionError, status, showNextAction, onHostedChange }: {
  version: string; connectionError: string; status: ApplicationStatus;
  showNextAction(): void; onHostedChange(hosted: StandaloneHosting): void;
}) {
  const { state } = useUi();
  const projectView = useProjectView();
  const { maintenanceError } = projectView;
  const ownershipUnknown = Boolean(connectionError || projectView.error || projectView.entry.error)
    || projectView.entry.loading || projectView.entry.busy;
  const permissionScope = ownershipUnknown ? undefined : projectView.active ? "development"
    : projectView.starting || projectView.developmentEntered || ["unknown", "unavailable"].includes(projectView.status) ? undefined : "main";
  const stageIndex = Math.max(0, lifecycleStages.findIndex((stage) => stage.id === state.lifecycle.currentStage));
  const phase = state.lifecycle.currentStage === "development" ? "" : state.phase || "discovery";
  const hosted = useStandaloneHeader({
    scope: JSON.stringify([state.prototypeId, state.generation, state.provider?.extensionId]),
    version, lifecycle: isGoalEntry(state) ? "" : `${stageIndex + 1}. ${lifecycleStages[stageIndex].label}${phase ? ` | ${phase}` : ""}`,
    ...(permissionScope ? { permissionScope } : {}),
    controls: {
      reload: null,
      reset: null,
    },
    messages: [
      { id: "maintenance", text: maintenanceError, error: true },
      { id: "connection", text: connectionError, error: true },
    ].filter((message) => message.text).map((message) => ({ ...message, text: message.text.slice(0, 8192) })),
    status: { ...status, text: status.text.slice(0, 8192) },
  }, { reload: () => { throw new Error("Use Project settings diagnostics to reload Tandem."); },
    reset: () => { throw new Error("Use Preparation actions to restart Preparation."); } }, showNextAction);
  useEffect(() => { onHostedChange(hosted); }, [hosted, onHostedChange]);
  return <header className="topbar" hidden={hosted.header} data-hosted={hosted.header || undefined}><Brand /><div className="topbar-actions">
    <div id="lifecycle-status" className="lifecycle" aria-label="Development lifecycle" hidden={isGoalEntry(state)}>
      <span id="current-stage" className="stage" aria-label={"Current lifecycle stage: " + lifecycleStages[stageIndex].label}>
        <span id="current-stage-index" className="stage-index" aria-hidden="true">{stageIndex + 1}</span><span id="stage">{lifecycleStages[stageIndex].label}</span>
      </span><span id="phase" className="phase" hidden={!phase}>{phase}</span>
    </div>
    <span className="build-version" title="Tandem extension version">v{version}</span>
  </div>
    <p id="connection-status" className="connection-status" role="status">{connectionError}</p>
  </header>;
}

function PreparationRestart({ store, effortBusy, renderAction }: {
  store: StudioStore; effortBusy: boolean; renderAction?: (action: ReactNode) => ReactNode;
}) {
  const { state, confirm, post } = useUi();
  const project = useProjectView();
  const reset = useAction("effort");
  const [message, setMessage] = useState("");
  const disabled = project.active || project.starting || project.status === "unknown"
    || state.provider?.canSubmitAnswers === false || effortBusy;
  const latest = useRef(disabled); latest.current = disabled;
  if (project.entry.startingPath !== "preparation" && !state.effortReset) return null;
  if (isGoalEntry(state) && !state.effortReset && !reset.error) return null;
  const error = reset.error || state.effortReset?.error;
  const button = <Button variant="secondary" id="reset-effort" className="plan-button secondary" type="button" disabled={disabled}
      aria-describedby="effort-message"
      title={project.active ? "Close the private runtime in Project settings before restarting Preparation." : "Archive upstream discovery; retain Development and admitted handoffs"}
      onClick={async () => {
        if (latest.current) return;
        if (!await confirm("Tandem will first stop active discovery work. If stopping cannot be confirmed, the current effort is kept and a recovery message is shown.\n\nOn success, Preparation, Requirements, Designs and Prototype state/files are archived and the goal form opens. Development Design, conversation, application files and admitted handoffs are preserved. Close Development before restarting Preparation.\n\nThe project's saved starting choice stays unchanged. This restarts discovery for the same project; use another folder for a different project.", "Restart Preparation?")) return;
        void reset.run(async () => {
          const current = store.getSnapshot().state;
          if (latest.current || !current || current.generation !== state.generation || current.revision !== state.revision) {
            throw new Error("The project changed while confirmation was open. Review Preparation before retrying.");
          }
          setMessage("Stopping active discovery work and archiving this effort...");
          await post("/api/effort/reset", { expectedRevision: state.revision ?? 0, generation: state.generation, confirm: true }, 120000);
          const saved = store.getSnapshot().state;
          if (!saved || !isGoalEntry(saved) || saved.generation === state.generation) throw new Error("Preparation restart has not been confirmed. Refresh the project state before retrying.");
        });
      }}><RotateCcw size={15} aria-hidden="true" />{reset.busy ? "Restarting Preparation..." : "Restart Preparation..."}</Button>;
  return <>
    {renderAction ? renderAction(button) : button}
    <p id="effort-message" className="effort-message" role="status" data-status={error ? "error" : "idle"}>
      {error || (state.effortReset ? "Preparation restart is pending. Use Restart Preparation to confirm worker termination and finish the interrupted archive/reset." : message)}
    </p>
  </>;
}
interface WorkspaceProps {
  version: string; connectionError: string; store: StudioStore; activeTab: TabId; onTabChange: (tab: TabId) => void;
  selectedArtifact: string | null; contextOpen: boolean; setContextOpen: (open: boolean) => void;
  sketchBlocked: boolean; onSketchBlocked: (blocked: boolean) => void; effortBusy: boolean;
}
function Workspace(props: WorkspaceProps) {
  const ui = useUi();
  const { state, pending, browseStage, post, confirm } = ui;
  const projectView = useProjectView();
  const { activeTab, onTabChange, selectedArtifact, contextOpen, setContextOpen, sketchBlocked } = props;
  const directDevelopment = projectView.entry.startingPath === "development";
  useLayoutEffect(() => {
    if (directDevelopment && activeTab === "preparation") onTabChange("development");
  }, [directDevelopment, activeTab, onTabChange]);
  const stageAction = useAction("stage");
  const reviewAction = useAction("stage-review");
  const [review, setReview] = useDraft<UiState | null>("pinned-stage-review", null);
  useEffect(() => {
    if (review?.stageReview?.changeRequestId && state.changeRequests?.some(request =>
      request.id === review.stageReview?.changeRequestId && request.abandonment)) setReview(null);
  }, [review, state.changeRequests, setReview]);
  const workspace = useRef<HTMLElement>(null);
  const [stageActionsContainer, setStageActionsContainer] = useState<HTMLElement | null>(null);
  const [reviewControlsContainer, setReviewControlsContainer] = useState<HTMLElement | null>(null);
  const [reviewFeedbackContainer, setReviewFeedbackContainer] = useState<HTMLElement | null>(null);
  const [prototypeHeaderActions, setPrototypeHeaderActions] = useState<HTMLElement | null>(null);
  const [approvalContainer, setApprovalContainer] = useState<HTMLElement | null>(null);
  const [sketchApprovalStatus, setSketchApprovalStatus] = useState("");
  const [width, setWidth] = useState(minimumContextWidth);
  const [contextCollapsed, setContextCollapsed] = useState(false);
  const [hosting, setHosting] = useState<StandaloneHosting>({ header: false, status: false });
  const [maximum, setMaximum] = useState(minimumContextWidth);
  const [dragging, setDragging] = useState<number | null>(null);
  const [nextAction, setNextAction] = useState<{ id: string; label: string; revealId: string | null } | null>(null);
  const atStart = isGoalEntry(state);
  const developmentView = activeTab === "development";
  const showStageTabs = !atStart && !developmentView && activeTab !== "content";
  useLayoutEffect(() => {
    const selected = document.querySelector<HTMLElement>('#stage-workspace-tabs [aria-selected="true"]');
    if (selected === document.activeElement) selected?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [activeTab, showStageTabs]);
  const contextHelp = useStatusHelp(`${activeTab}:${contextOpen}:${contextCollapsed}:${atStart}:${projectView.entry.ready}`);
  const previousAtStart = useRef(atStart);
  useEffect(() => { if (state.effortReset) onTabChange("preparation"); }, [state.effortReset?.requestId]);
  useLayoutEffect(() => {
    if (atStart && projectView.entry.ready && !projectView.developmentEntered) document.getElementById("start-goal")?.focus();
    else if (previousAtStart.current) document.getElementById("preparation-panel")?.focus();
    previousAtStart.current = atStart;
  }, [atStart, projectView.entry.ready, projectView.developmentEntered]);
  const current = state.lifecycle.currentStage;
  const viewed = stageTabs.find((tab) => tab.value === activeTab)?.stage
    || state.artifacts.find((artifact) => artifact.id === selectedArtifact)?.stage || current;
  const requiredReviewStage = changeRequestReviewStage(currentChangeReview(state));
  const contentBlockedByReview = Boolean(showStageTabs && requiredReviewStage && viewed !== requiredReviewStage);
  const reviewing = review?.stageReview?.stage === viewed;
  const feedbackOutsideEditor = contentBlockedByReview && viewed === "prototype" && current === "prototype" && !reviewing;
  const reviewTarget = lifecycleStages.find(stage => stage.id === viewed)?.id;
  const earlierStage = reviewTarget !== undefined
    && lifecycleStages.findIndex(stage => stage.id === reviewTarget) < lifecycleStages.findIndex(stage => stage.id === current);
  async function openReview(stage: LifecycleStageId, request?: import("../change-requests.js").ChangeRequest) {
    const result = await post<{ draft: UiState }>("/api/reviews/open", {
      stageId: stage, expectedGeneration: state.generation,
      ...(request ? { changeRequestId: request.id, analysisId: request.analysisId, baselineDigest: request.baselineDigest } : {}),
    });
    setReview(result.draft);
    onTabChange(tabFor(stage));
  }
  const readOnly = projectView.developmentEntered || viewed !== current || state.lifecycle.completedStages.includes(viewed);
  const complete = !pending && canCompleteStage(state) && (current !== "sketch" || !sketchBlocked);
  const allComplete = lifecycleStages.every((stage) => state.lifecycle.completedStages.includes(stage.id) || skippedStage(state, stage.id));
  const finalizingPrototype = current === "prototype" && state.processing?.action === "generate-design-spec"
    && ["starting", "running"].includes(state.processing.status);
  const completionLabel = finalizingPrototype ? "Finishing prototype..." : allComplete ? "All stages complete" : stageAction.busy ? "Saving stage output..."
    : current === "prototype" ? "Finish Prototype"
    : current === "requirements" && state.prototypeApproach.mode === "not-applicable" ? "Finish Requirements and save outputs"
    : current === "sketch" ? "Finish Designs and continue"
    : current === "prepare" ? "Preparation runs automatically" : "Finish " + (lifecycleStages.find((stage) => stage.id === current)?.label || current).toLowerCase();
  const completionHelp = current === "prototype" && !finalizingPrototype ? "Finish Prototype and prepare Design in Development"
    : contextCollapsed && !allComplete && !stageAction.busy && !["prepare", "development"].includes(current)
    ? "Next stage: " + completionLabel : completionLabel;
  const selectedLabel = lifecycleStages.find((stage) => stage.id === viewed)?.label || viewed;
  const handoffStatus = useHandoffStatus(activeTab === "development");
  const statusBarError = props.connectionError || stageAction.error || reviewAction.error || projectView.maintenanceError || state.effortReset?.error
    || (activeTab === "development" ? projectView.error || state.developmentBlocker : "") || handoffStatus.error;
  const developmentStatus = activeTab === "development" ? projectView.detail
    || (projectView.starting ? "Opening Development..." : projectView.developmentEntered && !projectView.url
      ? "Connecting to Development..." : "") : "";
  const savedPrototype = state.lifecycle.currentStage === "development" && state.lifecycle.outputs.some(output => output.stageId === "prototype")
    && state.status === "Prototype outputs saved. Stage 1 is complete. You can close now and open Development later with these files as input.";
  const privateStatus = activeTab === "development" ? projectView.presentation : null;
  const upstreamStatus = directDevelopment && atStart && projectView.developmentEntered && privateStatus ? "" : handoffStatus.rootStatus;
  const selection = developmentView ? projectView.modelSelection : state.mainModelSelection;
  const selectionLabel = developmentView && !projectView.developmentEntered ? "Development: not started"
    : modelSelectionLabel(selection, developmentView ? "Development" : "Main");
  const authoritativeActivity = privateStatus?.kind === "active" && !handoffStatus.busy && !pending
    && !hasActiveJobs(state) && (!upstreamStatus || savedPrototype) ? privateStatus.text : "";
  const statusBarText = statusBarError || (privateStatus?.kind === "attention" ? privateStatus.text : "")
    || (activeTab === "development" && projectView.starting ? privateStatus?.text || "Starting Development..." : "")
    || authoritativeActivity || contextHelp
    || (activeTab === "sketch" && !reviewing && !pending && !hasActiveJobs(state) ? sketchApprovalStatus : "")
    || (nextAction ? "Next action: " + nextAction.label
    : (handoffStatus.busy ? handoffStatus.text : "") || developmentStatus
    || (pending || hasActiveJobs(state) ? state.status : "") || (!savedPrototype ? upstreamStatus : "")
    || (privateStatus?.kind === "active" ? privateStatus.text : "") || handoffStatus.text || privateStatus?.text
    || (activeTab === "development" && projectView.developmentEntered ? "Development" : "")
    || (savedPrototype ? "Prototype saved. Continue in Development when you're ready."
    : upstreamStatus || (atStart ? "Ready to start a project." : "Ready.")));
  const narrow = () => window.matchMedia("(max-width: 760px)").matches;
  const showNextAction = () => {
    if (!nextAction) return;
    if (["continue-pending-review", "continue-stage-review", "apply-stage-review"].includes(nextAction.id)
      || nextAction.id === "sketch-update-requirements" && (reviewing || reviewControlsContainer)) setContextOpen(false);
    else if (nextAction.id === "complete-stage") { setContextCollapsed(false); onTabChange(tabFor(current)); if (narrow()) setContextOpen(true); }
    else { onTabChange(tabFor(current)); setContextOpen(false); }
    const reveal = nextAction.revealId ? document.getElementById(nextAction.revealId) : null;
    if (reveal?.getAttribute("aria-expanded") === "false") reveal.click();
    window.requestAnimationFrame(() => {
      const target = document.getElementById(nextAction.id);
      target?.scrollIntoView?.({ block: "nearest" }); target?.focus({ preventScroll: true });
    });
  };
  // Keep both artifact and conversation minimum widths, including the two dividers.
  const maximumContextWidth = () => Math.max(minimumContextWidth,
    (workspace.current?.getBoundingClientRect().width || minimumContextWidth + 587) - 587);
  const resize = (value: number) => {
    if (narrow() || contextCollapsed) return;
    const max = maximumContextWidth();
    setMaximum(max); setWidth(Math.round(Math.min(max, Math.max(minimumContextWidth, value))));
  };
  useEffect(() => {
    const update = () => { const max = maximumContextWidth(); setMaximum(max); setWidth((width) => Math.min(max, width)); };
    update(); window.addEventListener("resize", update); return () => window.removeEventListener("resize", update);
  }, [atStart]);
  useEffect(() => {
    document.body.classList.toggle("is-resizing", dragging !== null);
    return () => document.body.classList.remove("is-resizing");
  }, [dragging]);
  useLayoutEffect(() => {
    const latestChange = currentChangeReview(state);
    const changeAction: [string, string, string?][] = latestChange && ["proposed", "reviewing", "failed"].includes(latestChange.status)
      ? [[showStageTabs ? "continue-pending-review" : "toggle-change-details",
        changeRequestActionLabel(latestChange)]] : [];
    const reviewActions: [string, string][] = showStageTabs ? reviewing
      ? [["continue-stage-review", "Continue to the next review"], ["sketch-update-requirements", "Update designs for reviewed requirements"], ["apply-stage-review", "Apply the reviewed draft"]]
      : [["continue-pending-review", "Continue the required review"], ["sketch-update-requirements", "Update designs for reviewed requirements"]] : [];
    const candidates: [string, string, string?][] = pending || atStart || state.provider?.canSubmitAnswers === false ? [] : [...reviewActions, ...changeAction, ...{
      prepare: [["retry-preparation", "Retry preparation"]],
      requirements: state.requirements?.substage !== "dag" ? state.requirements?.usageItems?.length
        ? [["generate-dag", state.processing?.action === "generate-dag" && state.processing.status === "error"
          ? "Retry the requirements DAG" : "Generate the requirements DAG"]] : [["add-usage", "Add the first usage"]]
        : state.decisionGraph.nodes.some((node) => node.status === "active")
          ? [["decision-submit", "Answer the active requirement decision"], ["complete-stage", "Finish requirements collection"]]
          : [["complete-stage", "Finish requirements collection"]],
      sketch: [["sketch-retry-generation", "Continue the failed design generation"],
        ["sketch-retry-revision", "Retry the failed design revision", "sketch-history-toggle"], ["complete-stage", "Finish Designs and continue to Prototype"],
        ["sketch-approve", "Approve designs and continue"], ["sketch-generate", "Generate screen designs"]],
      prototype: [["apply-prototype-update", "Show the prepared prototype version"], ["extend-prototype-budget", "Review an additional prototype work window"],
        ["retry-prototype-checkpoint", state.prototypeNeedsUpdate ? "Update the prototype for reviewed inputs" : "Retry incomplete prototype work"], ["start-prototype", "Start the prototype build"],
        ["submit-clarification", "Answer the prototype clarification"], ["complete-stage", "Finish prototype iteration"]],
      development: state.development ? [] : [["continue-design", "Continue to Development"]],
    }[current] as [string, string, string?][]];
    const update = () => {
      const candidate = candidates.find(([id, , revealId]) => {
        const button = document.getElementById(id) as HTMLButtonElement | null;
        if (!button || button.disabled) return false;
        const hidden = button.closest('[hidden]:not([role="tabpanel"])');
        if (id === "complete-stage" || !hidden) return true;
        const reveal = revealId ? document.getElementById(revealId) as HTMLButtonElement | null : null;
        return reveal && !reveal.disabled && hidden.id === reveal.getAttribute("aria-controls");
      });
      const next = candidate ? { id: candidate[0], label: candidate[1], revealId: candidate[2] ?? null } : null;
      setNextAction((current) => current?.id === next?.id && current?.label === next?.label && current?.revealId === next?.revealId ? current : next);
    };
    update();
    const observer = new MutationObserver(update);
    if (workspace.current) observer.observe(workspace.current, {
      subtree: true, childList: true, attributes: true, attributeFilter: ["hidden", "disabled"],
    });
    return () => observer.disconnect();
  }, [state, pending, atStart, current, showStageTabs, reviewing]);
  function navigate(tab: string) {
    const target = stageTabs.find((item) => item.value === tab);
    if (directDevelopment && target?.stage === "prepare") return;
    if (target && !canBrowseStage(state, target.stage)) return;
    onTabChange(tab as TabId);
    setContextOpen(false);
  }
  const phaseActions = <section id="stage-workflow-actions" className="phase-actions" aria-label={`${selectedLabel} actions`} aria-describedby="stage-browsing stage-message">
    <div className="stage-primary-actions" ref={setPrototypeHeaderActions} />
    <Button variant="primary" id="complete-stage" className="complete-stage" type="button" hidden={reviewing || projectView.developmentEntered
      || current === "prepare" || current === "development" || (current === "sketch" && sketchBlocked)
      || viewed !== current || Boolean(skippedStage(state, current))} aria-describedby="stage-message"
      aria-label={completionHelp} title={completionHelp} data-status-help={completionHelp}
      disabled={!complete} onClick={() => {
        if (!complete) return;
        void stageAction.run(async () => {
          if (current === "prototype") {
            const identity = props.store.getSnapshot().state;
            if (!identity || identity.generation !== state.generation || identity.lifecycle.currentStage !== "prototype"
              || !canCompleteStage(identity)) throw new Error("The prototype changed. Review its applied version before finishing.");
            if (identity.prototypeFlow && awaitingVisualChoice(identity.prototypeFlow)) {
              await post("/api/prototype/action", { action: "skip-visual", expectedRevision: identity.revision });
            }
            const latest = props.store.getSnapshot().state;
            if (!latest || latest.prototypeId !== identity.prototypeId || latest.generation !== identity.generation
              || latest.lifecycle.currentStage !== "prototype"
              || latest.prototypeFlow?.displayedCheckpointId !== identity.prototypeFlow?.displayedCheckpointId
              || latest.previewUrl !== identity.previewUrl || !canCompleteStage(latest)) {
              throw new Error("The applied prototype changed. Review its current version before finishing.");
            }
          }
          await post("/api/stage/complete", { stageId: current, ...(current === "prototype" ? { continueDevelopment: true } : {}) });
        });
      }}>
      <Check size={16} aria-hidden="true" /><span className="complete-stage-label">{completionLabel}</span>
    </Button>
    <p id="stage-browsing" className="visually-hidden">{reviewing ? `Pinned ${selectedLabel} draft review. ${current} remains the current stage.`
      : readOnly ? `Viewing ${selectedLabel} · read only. Use the review panel for pending changes, or explicitly reopen the stage.` : ""}</p>
    <Button variant="primary" id="review-stage" className="complete-stage" type="button"
      hidden={reviewing || ["prepare", "requirements", "sketch"].includes(viewed) || !earlierStage || !reviewTarget || Boolean(skippedStage(state, viewed)) || !canBrowseStage(state, reviewTarget)}
      disabled={pending || state.provider?.canSubmitAnswers === false}
      onClick={() => { if (reviewTarget) void reviewAction.run(() => openReview(reviewTarget)); }}><Pin size={15} aria-hidden="true" />{state.stageReviews?.some(item => item.stage === viewed
        && item.generation === state.generation && !item.appliedAt && !item.discardedAt) ? "Resume draft review" : "Review changes"}</Button>
    <Button variant="secondary" id="reopen-stage" className="complete-stage" type="button" aria-describedby="stage-browsing"
      hidden={reviewing || viewed === "development" || !lifecycleStages.some(stage => stage.id === viewed) || !readOnly || Boolean(skippedStage(state, viewed)) || lifecycleStages.findIndex((stage) => stage.id === viewed) > lifecycleStages.findIndex((stage) => stage.id === current)}
      disabled={pending || state.provider?.canSubmitAnswers === false || hasActiveJobs(state)
        || state.changeRequests?.some(request => request.status === "reviewing")}
      onClick={async () => {
        if (!await confirm(`Reopen ${selectedLabel}? Its outputs and dependent stage outputs will be marked stale. ${["requirements", "sketch"].includes(viewed) ? "Designs approval and dependent prototype evidence must be reviewed again. " : ""}Saved evidence is retained, but affected stages must be completed again.`)) return;
        void stageAction.run(async () => {
          const latest = props.store.getSnapshot().state;
          if (!latest || latest.generation !== state.generation || latest.revision !== state.revision
            || latest.provider?.canSubmitAnswers === false || hasActiveJobs(latest)) {
            throw new Error("The effort changed while confirmation was open. Review the stage before reopening it.");
          }
          const stage = lifecycleStages.find(stage => stage.id === viewed);
          if (!stage) throw new Error("Historical stages cannot be reopened.");
          await post("/api/stage/reopen", { stageId: stage.id }); projectView.resumeDiscovery(); browseStage(stage.id);
        });
      }}><RotateCcw size={16} aria-hidden="true" />Reopen {selectedLabel}</Button>
    <p id="stage-message" className={stageAction.error ? "stage-message" : "visually-hidden"} title={stageAction.error || undefined} role="status" data-status={stageAction.error ? "error" : "idle"}>{stageAction.error || (state.lifecycle.outputs?.at(-1) ? "Saved " + state.lifecycle.outputs.at(-1)!.path : current === "prepare" ? "Preparation advances automatically when analysis completes." : "Complete the active stage to unlock the next.")}</p>
  </section>;
  return <UiContext.Provider value={{ ...ui, reviewStage: openReview }}><div className="app project-workspace-app">
    {!projectView.entry.ready && (projectView.entry.loading || projectView.entry.busy) && !projectView.gitSetupVisible && !projectView.settingsOpen
      && <p id="project-entry-progress" className="project-entry-loading" role="status">
        {projectView.entry.loading ? "Reading project metadata..." : "Opening your selected project..."}</p>}
    <AlertDialog.Root open={!projectView.entry.loading && !projectView.entry.busy && !projectView.entry.ready && !projectView.gitSetupVisible && !projectView.settingsOpen}>
      <AlertDialog.Portal><AlertDialog.Overlay className="dialog-overlay" /><AlertDialog.Content className="dialog-content project-entry">
        <AlertDialog.Title>Choose where to start</AlertDialog.Title>
        <AlertDialog.Description>
          <span className="project-entry-path">{projectView.entry.projectPath || "Reading project folder..."}</span>
          This starting choice is saved for this project folder, so you won't be asked again. Preparation can still progress into Development.
        </AlertDialog.Description>
        {projectView.entry.error ? <div role="alert"><p>{projectView.entry.error}</p><Button variant="primary" type="button" className="plan-button" onClick={() => void projectView.reloadEntry()}>Retry project entry</Button></div>
          : projectView.entry.startingPath ? <Button variant="primary" id="resume-project-entry" type="button" className="plan-button" disabled={projectView.entry.busy}
              onClick={() => void projectView.reloadEntry()}>Continue saved {projectView.entry.startingPath === "development" ? "Development" : "Preparation"} entry</Button>
          : projectView.entry.loading ? <p role="status">Reading project metadata...</p>
            : <div className="project-entry-choices">
              <Button variant="item" id="entry-preparation" type="button" autoFocus disabled={projectView.entry.busy || state.provider?.canSubmitAnswers === false}
                onClick={() => void projectView.chooseEntry("preparation")}><strong>Start with Preparation</strong>
                <span>Start here if your project is empty or you want help clarifying requirements and shaping the UX. Work through Requirements, Designs, and a Prototype before Development.</span></Button>
              <Button variant="item" id="entry-development" type="button" disabled={projectView.entry.busy || !canOpenDevelopment(state)}
                onClick={() => void projectView.chooseEntry("development")}><strong>Go to Development</strong>
                <span>Go directly to Development if you already have project files, an initial implementation, or a rough idea you want to work on. You can refine the Design there without going through Preparation.</span></Button>
            </div>}
        {state.provider?.canSubmitAnswers === false && <p role="status">This provider is read-only. Use the project's owning writable provider to make the initial choice.</p>}
      </AlertDialog.Content></AlertDialog.Portal>
    </AlertDialog.Root>
    <Tabs.Root value={activeTab} onValueChange={navigate} asChild>
      <main id="studio-workspace" ref={workspace} className="workspace project-workspace" data-development={developmentView} data-context-open={contextOpen} data-context-collapsed={contextCollapsed}
        inert={!projectView.entry.ready || props.effortBusy}
        aria-busy={!projectView.entry.ready && projectView.entry.busy || props.effortBusy || Boolean(state.effortReset)} style={{ "--requirements-width": width + "px" } as CSSProperties}>
        <Button variant="item" id="context-toggle" className="context-toggle" type="button" aria-expanded={contextOpen} aria-controls="requirements-pane" onClick={() => setContextOpen(!contextOpen)}>
          <PanelLeft size={15} aria-hidden="true" /><span>Project context</span><span id="context-stage" className="context-stage">{lifecycleStages.find((stage) => stage.id === current)?.label}</span><ChevronDown className="context-chevron" size={16} aria-hidden="true" />
        </Button>
        <aside id="requirements-pane" className="requirements" aria-label="Project context" onKeyDown={(event) => {
          if (event.key === "Escape" && contextOpen) { setContextOpen(false); document.getElementById("context-toggle")?.focus(); event.preventDefault(); }
        }}>
          <Header version={props.version} connectionError={props.connectionError}
            status={{ text: `${statusBarText} | ${selectionLabel}`, error: Boolean(statusBarError), action: nextAction?.label ?? null }}
            showNextAction={showNextAction} onHostedChange={setHosting} />
          <nav className="project-navigation" aria-label="Project navigation">
            <Button variant="item" id="project-settings" type="button" className="plan-button" onClick={() => projectView.command("settings")}>Project settings</Button>
            <Tabs.List id="project-contents" className="preview-tabs project-tabs" aria-label="Project contents">
              {stageTabs.map(tab => {
                const skipped = skippedStage(state, tab.stage);
                const output = [...(state.lifecycle.history || []), ...state.lifecycle.outputs].reverse().find(item => item.stageId === tab.stage);
                const label = tab.label;
                const designStatus = tab.stage === "development" && projectView.designRevision
                  ? projectView.designChanged ? "New Design output" : "Design available" : null;
                const currentPhase = !skipped && (projectView.developmentEntered
                  ? tab.stage === "development" : current !== "development" && tab.stage === current);
                const completed = state.lifecycle.completedStages.includes(tab.stage);
                const needsReview = !currentPhase && !completed && canBrowseStage(state, tab.stage)
                  && lifecycleStages.findIndex(stage => stage.id === tab.stage) < lifecycleStages.findIndex(stage => stage.id === current);
                const progress = currentPhase ? "active" : skipped ? "skipped" : completed ? "complete" : needsReview ? "review" : "locked";
                const progressLabel = completed ? "Completed, accepted work locked" : needsReview ? "Needs review" : "";
                return <Tabs.Trigger key={tab.value} value={tab.value} id={tab.id + "-tab"}
                className="preview-tab" data-stage-id={tab.stage} data-status={progress} disabled={tab.stage === "prepare" ? directDevelopment
                  : tab.stage === "development" ? !canOpenDevelopment(state) : !canBrowseStage(state, tab.stage)}
                title={`${skipped?.reason || output?.path || label}${progressLabel ? `. ${progressLabel}` : ""}${designStatus ? `. ${designStatus}` : ""}`}
                aria-current={currentPhase ? "step" : undefined}
                aria-label={`${label}${currentPhase ? ", Current phase" : ""}${progressLabel ? `, ${progressLabel}` : ""}${skipped ? `, not applicable. ${skipped.reason}` : ""}${designStatus ? `, ${designStatus}` : ""}`}
                aria-controls={tab.id + "-panel"}><tab.icon size={15} aria-hidden="true" />
                <span className="project-tab-label"><span className="project-tab-name">{label}</span>{designStatus === "Design available" && !currentPhase
                  && <span className="project-availability" title="Design available" aria-hidden="true" />}</span>
                {currentPhase && <span className="current-phase" title="Current phase" aria-hidden="true"><CircleDot size={13} /></span>}
                {!currentPhase && completed && <span className="project-stage-status" title="Completed, accepted work locked" aria-hidden="true"><LockKeyhole size={13} /></span>}
                {needsReview && <span className="project-stage-status" title="Needs review" aria-hidden="true"><RotateCcw size={13} /></span>}
                {designStatus === "New Design output" && <span className="artifact-count">New output</span>}
                {tab.stage === "prototype" && state.prototypeFlow?.pendingCheckpointId && <span className="artifact-count">Ready to inspect</span>}
              </Tabs.Trigger>; })}
            </Tabs.List>
            <Button variant="item" id="project-current-work" type="button" className="plan-button"
              aria-label={projectView.developmentEntered ? `Current work: Development ${projectView.status}` : "Current work"}
              onClick={() => projectView.command("current-work")}>
              Current work{projectView.attention ? ` (${projectView.attention} needs attention)` : ""}
            </Button>
          </nav>
          <div className="context-pane-heading" data-hosted={hosting.header || undefined}>
            <span className="project-folder" hidden={hosting.header} title={projectView.entry.projectPath}>{projectView.entry.projectPath.split(/[\\/]/).filter(Boolean).at(-1)}</span>
            <IconButton variant="ghost" id="toggle-context-pane" className="context-collapse" type="button" aria-controls="requirements-pane"
              aria-expanded={!contextCollapsed} aria-label={contextCollapsed ? "Expand project context" : "Collapse project context"}
              title={contextCollapsed ? "Expand project context" : "Collapse to stage activity bar"}
              onClick={() => { setDragging(null); setContextCollapsed((collapsed) => !collapsed); }}>
              {contextCollapsed ? <PanelLeftOpen size={16} aria-hidden="true" /> : <PanelLeftClose size={16} aria-hidden="true" />}
            </IconButton>
          </div>
          {!projectView.visible && (projectView.error || ["unknown", "execution-unknown", "failed"].includes(projectView.status)) &&
            <p role="alert">Development needs attention. Open Current work to inspect the private session.</p>}
          <DiscoveryRecovery />
          <WorkflowActivity />
          <section id="project-artifact-library" className="section" aria-label="Artifacts">
            <div className="section-heading"><p className="eyebrow"><FolderOpen size={14} aria-hidden="true" />Artifacts</p>
              {projectView.outputStatus === "verified" && <span aria-label="Verified project output count">{state.artifacts.length + projectView.outputs.length}</span>}
            </div>
            <div role="group" aria-label="Discovery outputs"><h3 className="artifact-stage-heading">Discovery</h3>
            <Tabs.List className="artifact-library-nav" aria-label="Saved artifact library">
              <Tabs.Trigger value="content" id="content-tab" className="preview-tab" aria-controls="content-panel">
                <FileText size={15} aria-hidden="true" />Saved artifacts <span id="artifact-count">{state.artifacts.length}</span>
              </Tabs.Trigger>
            </Tabs.List>
              <ArtifactList selectedArtifactId={selectedArtifact} active={activeTab === "content"} />
            </div>
            <DevelopmentArtifactList active={developmentView} />
          </section>
          <Disclosure className="section ledger-details" hidden={!(["confirmed", "assumed", "deferred"] as const).some(kind => state[kind]?.length)}><summary className="eyebrow ledger-summary">Requirement ledger</summary>
            <div className="ledger">{(["confirmed", "assumed", "deferred"] as const).filter(kind => state[kind]?.length).map((kind) => <div key={kind}><h3>{kind[0].toUpperCase() + kind.slice(1)}</h3><ul id={kind}>{state[kind].map((text, index) => <li key={index}>{text}</li>)}</ul></div>)}</div>
          </Disclosure>
        </aside>
        <div id="studio-splitter" className={"splitter" + (dragging !== null ? " is-dragging" : "")} role="separator" tabIndex={0}
          aria-label="Resize requirements and output panels" aria-orientation="vertical" aria-controls="requirements-pane preview-pane"
          aria-valuemin={minimumContextWidth} aria-valuemax={maximum} aria-valuenow={width} title="Drag or use Left and Right arrow keys to resize"
          onPointerDown={(event) => { if (event.button !== 0 || narrow()) return; event.currentTarget.focus({ preventScroll: true }); setDragging(event.pointerId); event.currentTarget.setPointerCapture(event.pointerId); resize(event.clientX - (workspace.current?.getBoundingClientRect().left || 0)); event.preventDefault(); }}
          onPointerMove={(event) => { if (dragging === event.pointerId) resize(event.clientX - (workspace.current?.getBoundingClientRect().left || 0)); }}
          onPointerUp={(event) => { if (dragging === event.pointerId) { setDragging(null); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); } }}
          onPointerCancel={() => setDragging(null)} onLostPointerCapture={() => setDragging(null)}
          onKeyDown={(event) => { if (["ArrowLeft", "ArrowRight"].includes(event.key)) { resize(width + (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 48 : 24)); event.preventDefault(); } }} />
        <section id="preview-pane" className="preview" aria-label="Stage workspace" data-stage-tabs={showStageTabs}>
          {showStageTabs && <div className="previewbar">
            <Tabs.List id="stage-workspace-tabs" className="preview-tabs" aria-label="Pre-development stages">
              {stageTabs.filter(tab => tab.stage !== "development").map(tab => {
                const skipped = skippedStage(state, tab.stage);
                const label = tab.stage === "prototype" ? "Prototype" : tab.label;
                const change = currentChangeReview(state);
                const pendingReview = change?.remainingStages.includes(tab.stage)
                  && ["active", "reviewing"].includes(change.status);
                return <Tabs.Trigger key={tab.value} value={tab.value} id={tab.id + "-workspace-tab"}
                  className="preview-tab" disabled={!canBrowseStage(state, tab.stage)}
                  title={skipped?.reason || label} aria-label={skipped ? `${label}, not applicable. ${skipped.reason}`
                    : label + (review?.stageReview?.stage === tab.stage ? ", pinned draft review" : pendingReview ? ", change review pending" : "")}
                  aria-controls={tab.id + "-panel"}
                  onFocus={event => event.currentTarget.scrollIntoView?.({ block: "nearest", inline: "nearest" })}>
                  <tab.icon size={15} aria-hidden="true" /><span>{label}</span>
                  {review?.stageReview?.stage === tab.stage && <Pin size={12} aria-hidden="true" />}
                  {pendingReview && review?.stageReview?.stage !== tab.stage && <span className="review-tab-indicator" aria-hidden="true" />}
                </Tabs.Trigger>;
              })}
            </Tabs.List>
            {phaseActions}
            <div className="stage-header-actions" ref={setApprovalContainer} aria-label="Designs approval" />
          </div>}
          {stageTabs.map((tab) => <Tabs.Content key={tab.value} value={tab.value} forceMount hidden={activeTab !== tab.value}
            id={tab.id + "-panel"} className={tab.className}
            inert={contentBlockedByReview && activeTab === tab.value}
            aria-disabled={contentBlockedByReview && activeTab === tab.value || undefined}
            aria-labelledby={tab.id + (showStageTabs && tab.stage !== "development" ? "-workspace-tab" : "-tab")} tabIndex={0}>
            {review?.stageReview?.stage === tab.stage ? <StageReviewWorkspace key={review.prototypeId} initial={review} parent={{ ...ui, reviewStage: openReview }}
              active={activeTab === tab.value} actionsContainer={stageActionsContainer}
              headerActionsContainer={prototypeHeaderActions}
              workingStage={projectView.developmentEntered ? "development" : current}
              onExit={() => {
                setReview(null);
                window.requestAnimationFrame(() => document.getElementById("review-stage")?.focus({ preventScroll: true }));
              }} onReturn={() => {
                if (projectView.developmentEntered) projectView.command("current-work");
                else browseStage(current);
                window.requestAnimationFrame(() => {
                  const target = stageTabs.find(item => item.stage === (projectView.developmentEntered ? "development" : current));
                  if (target) document.getElementById(`${target.id}-panel`)?.focus({ preventScroll: true });
                });
              }} /> : <UiContext.Provider value={tab.stage === "development" ? ui : { ...ui, canEdit: (stage, allowCompleted) => !projectView.developmentEntered && ui.canEdit(stage, allowCompleted) }}>
            {tab.stage === "prepare" && <PreparationRestart store={props.store} effortBusy={props.effortBusy}
              renderAction={activeTab === "preparation" && prototypeHeaderActions
                ? action => createPortal(action, prototypeHeaderActions) : undefined} />}
            {tab.stage === "prepare" ? atStart ? projectView.developmentEntered
              ? <div className="start-panel"><h2>Preparation was not used</h2><p>This project is working in Development. Its conversation remains alongside the project artifacts.</p></div>
              : <GoalEntry /> : <PreparationPanel /> : tab.stage === "requirements" ? <RequirementsPanel />
              : tab.stage === "sketch" ? <SketchCompletionContext.Provider value={props.onSketchBlocked}><SketchPanel
                onApprovalStatusChange={setSketchApprovalStatus}
                renderReviewActions={activeTab === "sketch" && reviewControlsContainer
                  ? actions => createPortal(actions, reviewControlsContainer) : undefined}
                renderApproval={actions => activeTab === "sketch" && approvalContainer ? createPortal(actions, approvalContainer) : null} /></SketchCompletionContext.Provider>
              : tab.stage === "prototype" ? <PrototypePanel active={activeTab === "preview" && projectView.entry.ready}
                allowReviewFeedback={!projectView.developmentEntered}
                renderFeedback={feedbackOutsideEditor
                  ? feedback => reviewFeedbackContainer ? createPortal(feedback, reviewFeedbackContainer) : null : undefined}
                renderReviewActions={activeTab === "preview" && reviewControlsContainer
                  ? actions => createPortal(actions, reviewControlsContainer) : undefined}
                renderStageActions={activeTab === "preview" && prototypeHeaderActions
                  ? actions => createPortal(actions, prototypeHeaderActions) : undefined}
                connected={!props.connectionError} /> : <DevelopmentPanel active={developmentView} />}
            </UiContext.Provider>}
          </Tabs.Content>)}
          <Tabs.Content value="content" forceMount hidden={activeTab !== "content"} id="content-panel" className="content-panel" aria-labelledby="content-tab" tabIndex={0}><ArtifactsPanel selectedArtifactId={selectedArtifact} /></Tabs.Content>
          {contentBlockedByReview && <div className="stage-content-overlay" aria-hidden="true" />}
          <div id="stage-input-review" className="stage-input-review" aria-label="Review and approval">
            {!reviewing && <ChangeRequestsPanel compact showTrigger={!["preparation", "design-tree", "preview", "sketch"].includes(activeTab)} />}
            {showStageTabs && !reviewing && <PendingReviewPane viewedStage={reviewTarget ?? current} pinnedReview={review}
              onActionsContainer={setReviewControlsContainer} />}
            {showStageTabs && <section id="stage-review-actions" ref={setStageActionsContainer} className="phase-actions"
              aria-label={`${selectedLabel} review and preview actions`} />}
            {feedbackOutsideEditor && <div className="review-feedback" ref={setReviewFeedbackContainer} />}
          </div>
        </section>
        <ProjectConversation />
      </main>
    </Tabs.Root>
    <div id="next-action-bar" className="next-action-bar" hidden={hosting.status} data-status={statusBarError ? "error" : "idle"}>
      <span id="session-model-effort" className="session-model-effort" title={selection?.error || selectionLabel}>{selectionLabel}</span>
      <span id="next-action-guide" role="status" title={statusBarText}>{statusBarText}</span>
      <IconButton variant="ghost" id="show-next-action" type="button" hidden={!nextAction}
        aria-label="Go to action" title={nextAction ? "Go to action: " + nextAction.label : "Go to action"}
        onClick={showNextAction}><ArrowRight size={13} aria-hidden="true" /></IconButton>
    </div>
  </div></UiContext.Provider>;
}
