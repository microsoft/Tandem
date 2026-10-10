import { Component, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ErrorInfo, type ReactNode } from "react";
import { AlertDialog, Tabs, Tooltip } from "radix-ui";
import { ArrowRight, Check, ChevronDown, ClipboardList, Code, FileText, FolderOpen, GitBranch, Layers, ListChecks, Monitor, PanelLeft, PanelLeftClose, PanelLeftOpen, PencilRuler, Play, RefreshCw, RotateCcw, Sparkles, Target, X } from "lucide-react";
import { lifecycleStages } from "../workflow.js";
import type { LifecycleStageId } from "../types.js";
import { StudioStore } from "./state-store.js";
import { canBrowseStage, canOpenDevelopment, DraftProvider, hasActiveJobs, skippedStage, UiContext, useAction, useDraft, useStatusHelp, useUi, type UiContextValue, type UiState } from "./ui-context.js";
import { PreparationPanel } from "./preparation-panel.js";
import { RequirementsPanel } from "./requirements-panel.js";
import { SketchPanel, SketchCompletionContext, isSketchRevisionApproved } from "./sketch-panel.js";
import { PrototypePanel, prototypeCompletionBlocked } from "./prototype-panel.js";
import { ArtifactList, ArtifactsPanel } from "./artifacts-panel.js";
import { ProcessPanel } from "./process-panel.js";
import { DevelopmentPanel } from "./development-panel.js";
import { WorkflowActivity } from "./workflow-activity.js";
import { ProjectEffortControl } from "./project-effort.js";
import { ProjectConversation, ProjectConversationProvider, useProjectView } from "./project-conversation.js";
import { DiscoveryRecovery } from "./discovery-recovery.js";
import { SpeechProvider, SpeechSignInControl, SpeechTextarea, useSpeechSignInControl } from "./speech-textarea.js";
import { Brand } from "./brand.js";
import { useStandaloneHeader } from "./standalone-header.js";

const stageTabs = [
  { stage: "prepare", value: "preparation", id: "preparation", label: "Preparation", icon: Sparkles, className: "preparation-panel" },
  { stage: "requirements", value: "design-tree", id: "design-tree", label: "Requirements", icon: GitBranch, className: "design-tree-panel" },
  { stage: "sketch", value: "sketch", id: "sketch", label: "Sketch", icon: PencilRuler, className: "sketch-panel" },
  { stage: "prototype", value: "preview", id: "live-preview", label: "Live prototype", icon: Monitor, className: "frame-wrap" },
  { stage: "development", value: "development", id: "development", label: "Development", icon: Code, className: "development-panel" },
] as const;
type TabId = typeof stageTabs[number]["value"] | "content";
const minimumContextWidth = 220;
const tabFor = (stage: LifecycleStageId): TabId => stageTabs.find((tab) => tab.stage === stage)?.value || "content";
export const isGoalEntry = (state: UiState) => !state.goal?.trim() && state.lifecycle.currentStage === "prepare" && state.preparation?.status === "not-started";

export function canCompleteStage(state: UiState): boolean {
  const stage = state.lifecycle.currentStage;
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
  const [activeTab, setActiveTab] = useState<TabId>(() =>
    state.lifecycle.currentStage === "development" && !state.development
      && state.lifecycle.outputs.some(output => output.stageId === "prototype")
      ? "content" : tabFor(state.lifecycle.currentStage));
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
      setActiveTab((current) => stage !== "development" && current === tabFor(previous) ? tabFor(stage) : current);
      previousStage.current = stage;
    }
  }, [state.lifecycle.currentStage]);
  useEffect(() => {
    document.body.classList.toggle("prototype-view", activeTab === "preview");
    return () => document.body.classList.remove("prototype-view");
  }, [activeTab]);
  const value: UiContextValue = {
    state, pending: busy.size > 0 || Boolean(state.effortReset), post: store.post, refresh: store.refresh,
    canEdit: (stage, allowCompleted = false) => !state.effortReset && !busy.has("effort") && !busy.has("stage")
      && state.lifecycle.currentStage === stage && !skippedStage(state, stage)
      && (!["sketch", "prototype"].includes(stage) || state.prototypeApproach?.mode !== "undecided")
      && (allowCompleted || !state.lifecycle.completedStages.includes(stage)) && state.provider?.canSubmitAnswers !== false,
    guidance: (action) => state.provider?.source === "session" ? "Return to the Tandem session that owns this effort to " + action + "."
      : "Open the installed user-scoped Tandem to " + action + ".",
    confirm, browseStage, selectArtifact, setBusy,
  };
  return <UiContext.Provider value={value}><SpeechProvider signInPlacement="header">
    <ProjectConversationProvider designVisible={activeTab === "development"} showDesign={() => setActiveTab("development")}><Workspace version={version} connectionError={connectionError} store={store} activeTab={activeTab} onTabChange={setActiveTab}
      selectedArtifact={selectedArtifact} contextOpen={contextOpen} setContextOpen={setContextOpen}
      sketchBlocked={sketchBlocked} onSketchBlocked={setSketchBlocked} effortBusy={busy.has("effort")} /></ProjectConversationProvider>
  </SpeechProvider></UiContext.Provider>;
}

function GoalEntry({ openDevelopment }: { openDevelopment: () => void }) {
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
        <SpeechTextarea id="start-goal" ref={input} value={goal} onValueChange={(text) => { setGoal(text); action.setError(""); }}
          rows={5} maxLength={4000} required disabled={!writable || pending} aria-invalid={Boolean(action.error)}
          aria-describedby="start-help start-message" placeholder="Build an app that helps my team triage customer requests." />
        <p id="start-help" className="visually-hidden">Describe who it is for and what it should help them do. You can refine the details together.</p>
        <div className="start-actions"><span id="goal-length" className="muted">{goal.length.toLocaleString()} / 4,000</span>
          <button id="start-effort" className="plan-button" type="submit" disabled={!writable || pending || !goal.trim() || goal.length > 4000}
            data-status-help="Starting runs AI preparation: Tandem inspects the workspace and relevant sources, then opens Requirements. Implementation comes later."><Play size={16} aria-hidden="true" />{action.busy ? "Starting..." : "Start project"}</button></div>
        <p id="start-message" className="start-message" role="status" data-status={action.error ? "error" : "idle"}>{action.error || (!writable ? "Open the writable Tandem provider to start this project." : "")}</p>
      </form>
      <button id="open-development" className="plan-button secondary" type="button"
        disabled={pending || !canOpenDevelopment(state)} onClick={openDevelopment}>
        <Code size={16} aria-hidden="true" />Open Development directly
      </button>
      <p className="muted">Preparation and prototyping are optional. Start a new project or continue an existing repository in Development; opening sends no project request.</p>
    </div>
  </section>;
}

function Header({ version, connectionError, store, effortBusy, developmentView }: { version: string; connectionError: string; store: StudioStore; effortBusy: boolean; developmentView: boolean }) {
  const { state, confirm, post } = useUi();
  const reset = useAction("effort");
  const reload = useAction("reload");
  const [message, setMessage] = useState("");
  const [reloadRequested, setReloadRequested] = useState(false);
  const stageIndex = Math.max(0, lifecycleStages.findIndex((stage) => stage.id === state.lifecycle.currentStage));
  const reloadReceipt = state.reloadReceipt;
  useEffect(() => {
    if (["success", "error"].includes(reloadReceipt?.status)) setReloadRequested(false);
  }, [reloadReceipt?.status]);
  const reloadStatus = reload.error || (state.provider?.canReload !== true
    ? state.provider?.source === "session" ? "Reopen the workspace to update Tandem" : state.provider?.source === "project" ? "Available from the user-installed Tandem" : "Reload unavailable"
    : reloadReceipt?.status === "success" ? "" : reloadReceipt?.message || (reloadRequested ? "Reloading this session..." : "Current session only"));
  const reloadDisabled = developmentView || state.provider?.canReload !== true || reload.busy || reloadRequested || reloadReceipt?.status === "reloading" || effortBusy;
  const reloadTitle = state.provider?.canReload ? "Restart this session's provider from the latest installed user extension. This does not download updates." : reloadStatus;
  const reloadLabel = reload.busy ? "Checking..." : reloadRequested || reloadReceipt?.status === "reloading" ? "Reloading..." : "Reload";
  const resetDisabled = developmentView || state.provider?.canSubmitAnswers === false || effortBusy;
  const resetTitle = developmentView ? "Close the private runtime in Project settings before resetting discovery."
    : "Archive upstream discovery and return to goal entry; Development and admitted handoffs are retained";
  const effortMessage = reset.error || state.effortReset?.error
    || (state.effortReset ? "Reset is pending. Use Reset to confirm worker termination and finish clearing this effort." : message);
  const reloadExtension = () => {
    if (reloadDisabled) return;
    void reload.run(async () => {
      const response = await fetch("/api/reload", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Reload request failed.");
      setReloadRequested(true);
    });
  };
  const resetEffort = async () => {
    if (resetDisabled) return;
    if (!await confirm("Reset upstream discovery? Its current state and files will be archived. Development must be at an explicit quiet boundary; its canonical Design, conversation and admitted handoffs will not be erased. A later handoff refines that same project. Use another workspace for an unrelated project.", "Reset upstream discovery?")) return;
    void reset.run(async () => {
      setMessage("Stopping active work and resetting this effort...");
      await post("/api/effort/reset", { expectedRevision: state.revision ?? 0, generation: state.generation, confirm: true }, 120000);
      const current = store.getSnapshot().state;
      if (!current || !isGoalEntry(current) || current.generation === state.generation) throw new Error("Reset has not been confirmed. Reload the project state before retrying.");
    });
  };
  const speech = useSpeechSignInControl();
  const hosted = useStandaloneHeader({
    scope: JSON.stringify([state.prototypeId, state.generation, state.provider?.extensionId]),
    version, lifecycle: isGoalEntry(state) ? "" : `${stageIndex + 1}. ${lifecycleStages[stageIndex].label} | ${state.phase || "discovery"}`,
    permissionScope: developmentView ? "development" : "main",
    controls: {
      reload: { label: reloadLabel, title: reloadTitle, disabled: reloadDisabled, busy: reload.busy || reloadRequested || reloadReceipt?.status === "reloading" },
      reset: { label: reset.busy ? "Resetting..." : "Reset", title: resetTitle, disabled: resetDisabled, busy: reset.busy },
      signIn: { label: speech.signingIn ? "Signing in..." : "Sign in", title: developmentView ? "Speech sign-in belongs to upstream discovery, not Development." : speech.title, disabled: developmentView || speech.disabled, busy: speech.signingIn },
      cancelSignIn: speech.signingIn ? { label: "Cancel Microsoft sign-in", title: "Cancel Microsoft sign-in", disabled: false, busy: false } : null,
    },
    messages: [
      { id: "reload", text: reload.error || reloadReceipt?.status === "error" ? reloadStatus : "", error: true },
      { id: "effort", text: effortMessage, error: Boolean(reset.error || state.effortReset?.error) },
      { id: "speech", text: speech.message, error: speech.status === "error" },
      { id: "connection", text: connectionError, error: true },
    ].filter((message) => message.text).map((message) => ({ ...message, text: message.text.slice(0, 8192) })),
  }, { reload: reloadExtension, reset: resetEffort, signIn: speech.signIn, cancelSignIn: speech.cancel });
  return <header className="topbar" hidden={hosted} data-hosted={hosted || undefined}><Brand /><div className="topbar-actions">
    <div id="lifecycle-status" className="lifecycle" aria-label="Development lifecycle" hidden={isGoalEntry(state)}>
      <span id="current-stage" className="stage" aria-label={"Current lifecycle stage: " + lifecycleStages[stageIndex].label}>
        <span id="current-stage-index" className="stage-index" aria-hidden="true">{stageIndex + 1}</span><span id="stage">{lifecycleStages[stageIndex].label}</span>
      </span><span id="phase" className="phase">{state.phase || "discovery"}</span>
    </div>
    <div className="reload-control" data-status-help={reloadStatus}><button id="reload-extension" className="reload-button" type="button"
      disabled={reloadDisabled} title={reloadTitle}
      onClick={reloadExtension}><RefreshCw size={15} aria-hidden="true" />{reloadLabel}</button>
      <span id="reload-status" className={reload.error || reloadReceipt?.status === "error" ? "reload-status" : "visually-hidden"} role="status"
        data-status={reload.error || reloadReceipt?.status === "error" ? "error" : "idle"}>{reloadStatus}</span></div>
    <button id="reset-effort" className="reset-button" type="button" disabled={resetDisabled}
      title={resetTitle} onClick={resetEffort}><RotateCcw size={15} aria-hidden="true" />{reset.busy ? "Resetting..." : "Reset"}</button>
    {!developmentView && <SpeechSignInControl />}
    <span className="build-version" title="Tandem extension version">v{version}</span>
  </div>
    <p id="effort-message" className="effort-message" role="status" data-status={reset.error || state.effortReset?.error ? "error" : "idle"}>
      {effortMessage}
    </p>
    <p id="connection-status" className="connection-status" role="status">{connectionError}</p>
  </header>;
}

interface WorkspaceProps {
  version: string; connectionError: string; store: StudioStore; activeTab: TabId; onTabChange: (tab: TabId) => void;
  selectedArtifact: string | null; contextOpen: boolean; setContextOpen: (open: boolean) => void;
  sketchBlocked: boolean; onSketchBlocked: (blocked: boolean) => void; effortBusy: boolean;
}
function Workspace(props: WorkspaceProps) {
  const { state, pending, browseStage, post, confirm } = useUi();
  const projectView = useProjectView();
  const { activeTab, onTabChange, selectedArtifact, contextOpen, setContextOpen, sketchBlocked } = props;
  const stageAction = useAction("stage");
  const workspace = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(minimumContextWidth);
  const [contextCollapsed, setContextCollapsed] = useState(false);
  const [maximum, setMaximum] = useState(minimumContextWidth);
  const [dragging, setDragging] = useState<number | null>(null);
  const [nextAction, setNextAction] = useState<{ id: string; label: string; revealId: string | null } | null>(null);
  const atStart = isGoalEntry(state);
  const developmentView = activeTab === "development";
  const contextHelp = useStatusHelp(`${activeTab}:${contextOpen}:${contextCollapsed}:${atStart}`);
  const previousAtStart = useRef(atStart);
  useLayoutEffect(() => {
    if (atStart) document.getElementById("start-goal")?.focus();
    else if (previousAtStart.current) document.getElementById("preparation-panel")?.focus();
    previousAtStart.current = atStart;
  }, [atStart]);
  const current = state.lifecycle.currentStage;
  const viewed = stageTabs.find((tab) => tab.value === activeTab)?.stage
    || state.artifacts.find((artifact) => artifact.id === selectedArtifact)?.stage || current;
  const readOnly = viewed !== current || state.lifecycle.completedStages.includes(viewed);
  const complete = !pending && canCompleteStage(state) && (current !== "sketch" || !sketchBlocked);
  const allComplete = lifecycleStages.every((stage) => state.lifecycle.completedStages.includes(stage.id) || skippedStage(state, stage.id));
  const completionLabel = allComplete ? "All stages complete" : stageAction.busy ? "Saving stage output..."
    : current === "prototype" ? "Finish Prototype and save outputs"
    : current === "requirements" && state.prototypeApproach.mode === "not-applicable" ? "Finish Requirements and save outputs"
    : current === "prepare" ? "Preparation runs automatically" : "Finish " + (lifecycleStages.find((stage) => stage.id === current)?.label || current).toLowerCase();
  const completionHelp = contextCollapsed && !allComplete && !stageAction.busy && !["prepare", "development"].includes(current)
    ? "Next stage: " + completionLabel : completionLabel;
  const selectedLabel = lifecycleStages.find((stage) => stage.id === viewed)?.label || viewed;
  const statusBarError = props.connectionError || stageAction.error;
  const statusBarText = statusBarError || contextHelp || (nextAction ? "Next action: " + nextAction.label
    : state.status || (atStart ? "Ready to start a project." : "Ready."));
  const narrow = () => window.matchMedia("(max-width: 760px)").matches;
  const resize = (value: number) => {
    if (narrow() || contextCollapsed) return;
    const max = Math.max(minimumContextWidth, (workspace.current?.getBoundingClientRect().width || minimumContextWidth + 361) - 1 - 360);
    setMaximum(max); setWidth(Math.round(Math.min(max, Math.max(minimumContextWidth, value))));
  };
  useEffect(() => {
    const update = () => { const max = Math.max(minimumContextWidth, (workspace.current?.getBoundingClientRect().width || minimumContextWidth + 361) - 361); setMaximum(max); setWidth((width) => Math.min(max, width)); };
    update(); window.addEventListener("resize", update); return () => window.removeEventListener("resize", update);
  }, [atStart]);
  useEffect(() => {
    document.body.classList.toggle("is-resizing", dragging !== null);
    return () => document.body.classList.remove("is-resizing");
  }, [dragging]);
  useLayoutEffect(() => {
    const candidates: [string, string, string?][] = pending || atStart || state.provider?.canSubmitAnswers === false ? [] : {
      prepare: [["retry-preparation", "Retry preparation"]],
      requirements: state.requirements?.substage !== "dag" ? state.requirements?.usageItems?.length
        ? [["generate-dag", state.processing?.action === "generate-dag" && state.processing.status === "error"
          ? "Retry the requirements DAG" : "Generate the requirements DAG"]] : [["add-usage", "Add the first usage"]]
        : state.decisionGraph.nodes.some((node) => node.status === "active")
          ? [["decision-submit", "Answer the active requirement decision"], ["complete-stage", "Finish requirements collection"]]
          : [["complete-stage", "Finish requirements collection"]],
      sketch: [["sketch-retry-revision", "Retry the failed drawing revision", "sketch-history-toggle"], ["complete-stage", "Finish Sketch and continue to Prototype"],
        ["sketch-approve", "Approve drawings and continue"], ["sketch-generate", "Generate screen drawings"]],
      prototype: [["apply-prototype-update", "Apply the prepared prototype update"], ["extend-prototype-budget", "Review an additional prototype work window"],
        ["retry-prototype-checkpoint", "Retry incomplete prototype work"], ["start-prototype", "Start the prototype build"],
        ["submit-clarification", "Answer the prototype clarification"], ["complete-stage", "Finish prototype iteration"]],
      development: state.development ? [] : [["continue-design", "Continue Design from the completed Prototype"]],
    }[current] as [string, string, string?][];
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
  }, [state, pending, atStart, current]);
  function navigate(tab: string) {
    const target = stageTabs.find((item) => item.value === tab);
    if (target && !canBrowseStage(state, target.stage)) return;
    onTabChange(tab as TabId);
    setContextOpen(false);
  }
  return <div className="app project-workspace-app">
    <Tabs.Root value={activeTab} onValueChange={navigate} asChild>
      <main id="studio-workspace" ref={workspace} className="workspace project-workspace" data-development={developmentView} data-context-open={contextOpen} data-context-collapsed={contextCollapsed}
        inert={props.effortBusy || Boolean(state.effortReset)}
        aria-busy={props.effortBusy || Boolean(state.effortReset)} style={{ "--requirements-width": width + "px" } as CSSProperties}>
        <button id="context-toggle" className="context-toggle" type="button" aria-expanded={contextOpen} aria-controls="requirements-pane" onClick={() => setContextOpen(!contextOpen)}>
          <PanelLeft size={15} aria-hidden="true" /><span>Project context</span><span id="context-stage" className="context-stage">{lifecycleStages.find((stage) => stage.id === current)?.label}</span><ChevronDown className="context-chevron" size={16} aria-hidden="true" />
        </button>
        <aside id="requirements-pane" className="requirements" aria-label="Project context" onKeyDown={(event) => {
          if (event.key === "Escape" && contextOpen) { setContextOpen(false); document.getElementById("context-toggle")?.focus(); event.preventDefault(); }
        }}>
          <Header version={props.version} connectionError={props.connectionError} store={props.store} effortBusy={props.effortBusy} developmentView={projectView.active} />
          <nav className="project-navigation" aria-label="Project navigation">
            <button id="project-settings" type="button" className="plan-button" onClick={() => projectView.command("settings")}>Project settings</button>
            <ProjectEffortControl />
            <Tabs.List id="project-contents" className="preview-tabs project-tabs" aria-label="Project contents">
              {stageTabs.map(tab => {
                const skipped = skippedStage(state, tab.stage);
                const output = [...(state.lifecycle.history || []), ...state.lifecycle.outputs].reverse().find(item => item.stageId === tab.stage);
                const label = tab.stage === "sketch" ? "Drawings" : tab.label;
                return <Tabs.Trigger key={tab.value} value={tab.value} id={tab.id + "-tab"}
                className="preview-tab" data-stage-id={tab.stage} disabled={tab.stage !== "prepare" && !canBrowseStage(state, tab.stage)}
                title={skipped?.reason || output?.path || label}
                aria-label={`${label}${skipped ? `, not applicable. ${skipped.reason}` : ""}`}
                aria-controls={tab.id + "-panel"}><tab.icon size={15} aria-hidden="true" />
                {label}
                {tab.stage === "development" && projectView.designRevision && <span className="artifact-count">{projectView.designChanged ? "New output" : "Available"}</span>}
                {tab.stage === "prototype" && state.prototypeFlow?.pendingCheckpointId && <span className="artifact-count">Update ready</span>}
              </Tabs.Trigger>; })}
              <Tabs.Trigger value="content" id="content-tab" className="preview-tab" aria-controls="content-panel"><FileText size={15} />Saved artifacts <span id="artifact-count">{state.artifacts.length || ""}</span></Tabs.Trigger>
            </Tabs.List>
            <button id="project-current-work" type="button" className="plan-button" onClick={() => projectView.command("current-work")}>
              Current work{projectView.attention ? ` (${projectView.attention} needs attention)` : ""}
            </button>
          </nav>
          <div className="context-pane-heading">
            <p className="eyebrow"><Target size={14} aria-hidden="true" />Project overview</p>
            <button id="toggle-context-pane" className="context-collapse" type="button" aria-controls="requirements-pane"
              aria-expanded={!contextCollapsed} aria-label={contextCollapsed ? "Expand project context" : "Collapse project context"}
              title={contextCollapsed ? "Expand project context" : "Collapse to stage activity bar"}
              onClick={() => { setDragging(null); setContextCollapsed((collapsed) => !collapsed); }}>
              {contextCollapsed ? <PanelLeftOpen size={16} aria-hidden="true" /> : <PanelLeftClose size={16} aria-hidden="true" />}
            </button>
          </div>
          <details className="section project-brief"><summary>Brief and project details</summary><p id="goal" className="goal" title={state.goal}>{state.goal || "Discovery is optional. Describe the project here or activate Development."}</p></details>
          <p id="status" className="status" role="status">{projectView.active
            ? `Development: ${projectView.detail || projectView.status}` : state.status}</p>
          <DiscoveryRecovery />
          <WorkflowActivity />
          <section className="section workflow-section" aria-describedby="stage-browsing stage-message"><div className="section-heading"><p className="eyebrow"><Layers size={14} aria-hidden="true" />Discovery actions</p></div>
            <button id="complete-stage" className="complete-stage" type="button" hidden={current === "development" || viewed !== current || Boolean(skippedStage(state, current))} aria-describedby="stage-message"
              aria-label={completionHelp} title={completionHelp} data-status-help={completionHelp}
              disabled={!complete} onClick={() => { if (complete) void stageAction.run(() => post("/api/stage/complete", { stageId: current })); }}>
              {contextCollapsed && current !== "development" && !allComplete ? <ArrowRight size={16} aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}
              <span className="complete-stage-label">{completionLabel}</span>
            </button>
            <p id="stage-browsing" className="visually-hidden">{readOnly ? `Viewing ${selectedLabel} · read only. Reopen explicitly to change its scope.` : ""}</p>
            <button id="reopen-stage" className="complete-stage" type="button" aria-describedby="stage-browsing"
              hidden={viewed === "development" || !lifecycleStages.some(stage => stage.id === viewed) || !readOnly || Boolean(skippedStage(state, viewed)) || lifecycleStages.findIndex((stage) => stage.id === viewed) > lifecycleStages.findIndex((stage) => stage.id === current)}
              disabled={pending || state.provider?.canSubmitAnswers === false || hasActiveJobs(state)}
              onClick={async () => {
                if (!await confirm(`Reopen ${selectedLabel}? Its outputs and dependent stage outputs will be marked stale. ${["requirements", "sketch"].includes(viewed) ? "Sketch approval and dependent prototype evidence must be reviewed again. " : ""}Saved evidence is retained, but affected stages must be completed again.`)) return;
                void stageAction.run(async () => {
                  const latest = props.store.getSnapshot().state;
                  if (!latest || latest.generation !== state.generation || latest.revision !== state.revision
                    || latest.provider?.canSubmitAnswers === false || hasActiveJobs(latest)) {
                    throw new Error("The effort changed while confirmation was open. Review the stage before reopening it.");
                  }
                  const stage = lifecycleStages.find(stage => stage.id === viewed);
                  if (!stage) throw new Error("Historical stages cannot be reopened.");
                  await post("/api/stage/reopen", { stageId: stage.id }); browseStage(stage.id);
                });
              }}><RotateCcw size={16} aria-hidden="true" />Reopen {selectedLabel}</button>
            <p id="stage-message" className={stageAction.error ? "stage-message" : "visually-hidden"} title={stageAction.error || undefined} role="status" data-status={stageAction.error ? "error" : "idle"}>{stageAction.error || (state.lifecycle.outputs?.at(-1) ? "Saved " + state.lifecycle.outputs.at(-1)!.path : current === "prepare" ? "Preparation advances automatically when analysis completes." : "Complete the active stage to unlock the next.")}</p>
          </section>
          <section className="section"><div className="section-heading"><p className="eyebrow"><FolderOpen size={14} aria-hidden="true" />Artifacts</p><span className="section-count">{state.artifacts.length}</span></div><ArtifactList selectedArtifactId={selectedArtifact} /></section>
          {!developmentView && <ProcessPanel />}
          <details className="section ledger-details"><summary className="eyebrow ledger-summary">Requirement ledger</summary>
            <div className="ledger">{(["confirmed", "assumed", "deferred"] as const).map((kind) => <div key={kind}><h3>{kind[0].toUpperCase() + kind.slice(1)}</h3><ul id={kind}>{(state[kind] || []).map((text, index) => <li key={index}>{text}</li>)}</ul></div>)}</div>
          </details>
        </aside>
        <div id="studio-splitter" className={"splitter" + (dragging !== null ? " is-dragging" : "")} role="separator" tabIndex={0}
          aria-label="Resize requirements and output panels" aria-orientation="vertical" aria-controls="requirements-pane preview-pane"
          aria-valuemin={minimumContextWidth} aria-valuemax={maximum} aria-valuenow={width} title="Drag or use Left and Right arrow keys to resize"
          onPointerDown={(event) => { if (event.button !== 0 || narrow()) return; setDragging(event.pointerId); event.currentTarget.setPointerCapture(event.pointerId); resize(event.clientX - (workspace.current?.getBoundingClientRect().left || 0)); event.preventDefault(); }}
          onPointerMove={(event) => { if (dragging === event.pointerId) resize(event.clientX - (workspace.current?.getBoundingClientRect().left || 0)); }}
          onPointerUp={(event) => { if (dragging === event.pointerId) { setDragging(null); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); } }}
          onPointerCancel={() => setDragging(null)} onLostPointerCapture={() => setDragging(null)}
          onKeyDown={(event) => { if (["ArrowLeft", "ArrowRight"].includes(event.key)) { resize(width + (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 48 : 24)); event.preventDefault(); } }} />
        <section id="preview-pane" className="preview" aria-label="Stage workspace">
          {stageTabs.map((tab) => <Tabs.Content key={tab.value} value={tab.value} forceMount hidden={activeTab !== tab.value}
            id={tab.id + "-panel"} className={tab.className} aria-labelledby={tab.id + "-tab"} tabIndex={0}>
            {tab.stage === "prepare" ? atStart ? <GoalEntry openDevelopment={() => { navigate("development"); void projectView.activate(); }} /> : <PreparationPanel /> : tab.stage === "requirements" ? <RequirementsPanel />
              : tab.stage === "sketch" ? <SketchCompletionContext.Provider value={props.onSketchBlocked}><SketchPanel /></SketchCompletionContext.Provider>
              : tab.stage === "prototype" ? <PrototypePanel /> : <DevelopmentPanel active={developmentView} />}
          </Tabs.Content>)}
          <Tabs.Content value="content" forceMount hidden={activeTab !== "content"} id="content-panel" className="content-panel" aria-labelledby="content-tab" tabIndex={0}><ArtifactsPanel selectedArtifactId={selectedArtifact} /></Tabs.Content>
        </section>
        <ProjectConversation />
      </main>
    </Tabs.Root>
    <div id="next-action-bar" className="next-action-bar" data-status={statusBarError ? "error" : "idle"}>
      <span id="next-action-guide" role="status" title={statusBarText}>{statusBarText}</span>
      <button id="show-next-action" type="button" hidden={!nextAction}
        aria-label="Go to action" title={nextAction ? "Go to action: " + nextAction.label : "Go to action"} onClick={() => {
        if (!nextAction) return;
        if (nextAction.id === "complete-stage") { setContextCollapsed(false); onTabChange(tabFor(current)); if (narrow()) setContextOpen(true); }
        else { onTabChange(tabFor(current)); setContextOpen(false); }
        const reveal = nextAction.revealId ? document.getElementById(nextAction.revealId) : null;
        if (reveal?.getAttribute("aria-expanded") === "false") reveal.click();
        window.requestAnimationFrame(() => {
          const target = document.getElementById(nextAction.id);
          target?.scrollIntoView?.({ block: "nearest" }); target?.focus({ preventScroll: true });
        });
      }}><ArrowRight size={13} aria-hidden="true" /></button>
    </div>
  </div>;
}
