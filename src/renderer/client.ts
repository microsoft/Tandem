import { installSpeechInputs } from "./speech-input.js";
import { createAzureSpeechSession } from "./speech-recognizer.js";
import { buildDecisionGraphMermaid, escapeMermaidLabel } from "../decision-diagram.js";
import { curatedDefault } from "../workflow.js";

type AnyRecord = Record<string, any>;

const elements: AnyRecord = {
  resetEffort: document.getElementById("reset-effort"),
  effortMessage: document.getElementById("effort-message"),
  lifecycleStatus: document.getElementById("lifecycle-status"),
  startPanel: document.getElementById("start-panel"),
  startForm: document.getElementById("start-form"),
  startLoading: document.getElementById("start-loading"),
  startGoal: document.getElementById("start-goal"),
  startEffort: document.getElementById("start-effort"),
  startMessage: document.getElementById("start-message"),
  goalLength: document.getElementById("goal-length"),
  handoffStage: document.getElementById("handoff-stage"),
  handoffApprover: document.getElementById("handoff-approver"),
  acceptHandoff: document.getElementById("accept-handoff"),
  exportHandoff: document.getElementById("export-handoff"),
  handoffRecord: document.getElementById("handoff-record"),
  handoffAdapter: document.getElementById("handoff-adapter"),
  statusAdapter: document.getElementById("status-adapter"),
  intakeAdapter: document.getElementById("intake-adapter"),
  processRepository: document.getElementById("process-repository"),
  autoImplement: document.getElementById("auto-implement"),
  autoTest: document.getElementById("auto-test"),
  evidenceEnabled: document.getElementById("evidence-enabled"),
  independentReview: document.getElementById("independent-review"),
  protectedPaths: document.getElementById("protected-paths"),
  verificationChecks: document.getElementById("verification-checks"),
  saveProcess: document.getElementById("save-process"),
  processMetrics: document.getElementById("process-metrics"),
  processEvidence: document.getElementById("process-evidence"),
  processMessage: document.getElementById("process-message"),
  prepareDelivery: document.getElementById("prepare-delivery"),
  deliveryDraft: document.getElementById("delivery-draft"),
  processReference: document.getElementById("process-reference"),
  publishDelivery: document.getElementById("publish-delivery"),
  refreshDelivery: document.getElementById("refresh-delivery"),
  intakeContent: document.getElementById("intake-content"),
  importIntake: document.getElementById("import-intake"),
  processReceipts: document.getElementById("process-receipts"),
  resetProcess: document.getElementById("reset-process"),
  stage: document.getElementById("stage"),
  currentStage: document.getElementById("current-stage"),
  currentStageIndex: document.getElementById("current-stage-index"),
  phase: document.getElementById("phase"),
  goal: document.getElementById("goal"),
  status: document.getElementById("status"),
  connectionStatus: document.getElementById("connection-status"),
  nextActionGuide: document.getElementById("next-action-guide"),
  nextActionBar: document.getElementById("next-action-bar"),
  showNextAction: document.getElementById("show-next-action"),
  contextToggle: document.getElementById("context-toggle"),
  contextStage: document.getElementById("context-stage"),
  questionHost: document.getElementById("question-host"),
  confirmed: document.getElementById("confirmed"),
  assumed: document.getElementById("assumed"),
  deferred: document.getElementById("deferred"),
  artifactList: document.getElementById("artifact-list"),
  artifactCount: document.getElementById("artifact-count"),
  artifactHeading: document.getElementById("artifact-heading"),
  artifactMeta: document.getElementById("artifact-meta"),
  artifactContent: document.getElementById("artifact-content"),
  artifactDiagram: document.getElementById("artifact-diagram"),
  artifactReview: document.getElementById("artifact-review"),
  artifactReviewThreads: document.getElementById("artifact-review-threads"),
  mermaidHost: document.getElementById("mermaid-host"),
  mermaidSource: document.getElementById("mermaid-source"),
  diagramStatus: document.getElementById("diagram-status"),
  diagramSourceDetails: document.getElementById("diagram-source-details"),
  contentCard: document.getElementById("content-card"),
  contentEmpty: document.getElementById("content-empty"),
  preparationTab: document.getElementById("preparation-tab"),
  preparationPanel: document.getElementById("preparation-panel"),
  requirementsTab: document.getElementById("design-tree-tab"),
  preparationStageTitle: document.getElementById("preparation-stage-title"),
  preparationStageProgress: document.getElementById("preparation-stage-progress"),
  preparationStageStatus: document.getElementById("preparation-stage-status"),
  preparationWorkItems: document.getElementById("preparation-work-items"),
  preparationResultSummary: document.getElementById("preparation-result-summary"),
  preparationResultSuggestions: document.getElementById("preparation-result-suggestions"),
  preparationResultChecks: document.getElementById("preparation-result-checks"),
  preparationResultSources: document.getElementById("preparation-result-sources"),
  preparationMessages: document.getElementById("preparation-messages"),
  preparationStageMessage: document.getElementById("preparation-stage-message"),
  retryPreparation: document.getElementById("retry-preparation"),
  designTreePanel: document.getElementById("design-tree-panel"),
  designTreeCard: document.getElementById("design-tree-card"),
  designTreeEmpty: document.getElementById("design-tree-empty"),
  designTreeCurrent: document.getElementById("design-tree-current"),
  designTreePhase: document.getElementById("design-tree-phase"),
  designTreeHost: document.getElementById("design-tree-host"),
  decisionList: document.getElementById("decision-list"),
  designTreeStatus: document.getElementById("design-tree-status"),
  designTreeSource: document.getElementById("design-tree-source"),
  designTreeSourceDetails: document.getElementById("design-tree-source-details"),
  designReviewTab: document.getElementById("design-review-tab"),
  reviewCount: document.getElementById("review-count"),
  designReviewPanel: document.getElementById("design-review-panel"),
  productDesignSubstage: document.getElementById("product-design-substage"),
  testDesignSubstage: document.getElementById("test-design-substage"),
  designReviewTitle: document.getElementById("design-review-title"),
  designReviewProgress: document.getElementById("design-review-progress"),
  finishReview: document.getElementById("finish-review"),
  designReviewThreads: document.getElementById("design-review-threads"),
  designReviewForm: document.getElementById("design-review-form"),
  reviewRequestKind: document.getElementById("review-request-kind"),
  designReviewInput: document.getElementById("design-review-input"),
  designReviewStatus: document.getElementById("design-review-status"),
  designReviewStageStatus: document.getElementById("design-review-stage-status"),
  reviewSubmit: document.getElementById("review-submit"),
  planTab: document.getElementById("plan-tab"),
  planPanel: document.getElementById("plan-panel"),
  planProgress: document.getElementById("plan-progress"),
  planMaxAgents: document.getElementById("plan-max-agents"),
  generatePlan: document.getElementById("generate-plan"),
  finalizePlan: document.getElementById("finalize-plan"),
  planMetrics: document.getElementById("plan-metrics"),
  planStrategySection: document.getElementById("plan-strategy-section"),
  planStrategy: document.getElementById("plan-strategy"),
  planDagSection: document.getElementById("plan-dag-section"),
  planDag: document.getElementById("plan-dag"),
  planDagStatus: document.getElementById("plan-dag-status"),
  planColumns: document.getElementById("plan-columns"),
  planWaves: document.getElementById("plan-waves"),
  planWorkItems: document.getElementById("plan-work-items"),
  planAgents: document.getElementById("plan-agents"),
  planRisks: document.getElementById("plan-risks"),
  planRevisionSection: document.getElementById("plan-revision-section"),
  planRevisionForm: document.getElementById("plan-revision-form"),
  planRevisionInput: document.getElementById("plan-revision-input"),
  optimizePlan: document.getElementById("optimize-plan"),
  revisePlan: document.getElementById("revise-plan"),
  planStatus: document.getElementById("plan-status"),
  implementationTab: document.getElementById("implementation-tab"),
  implementationPanel: document.getElementById("implementation-panel"),
  implementationProgress: document.getElementById("implementation-progress"),
  implementationProgressLabel: document.getElementById("implementation-progress-label"),
  implementationProgressBar: document.getElementById("implementation-progress-bar"),
  implementationMetrics: document.getElementById("implementation-metrics"),
  implementationWaves: document.getElementById("implementation-waves"),
  implementationWorkItems: document.getElementById("implementation-work-items"),
  implementationAgents: document.getElementById("implementation-agents"),
  implementationStrategyForm: document.getElementById("implementation-strategy-form"),
  implementationStrategyInput: document.getElementById("implementation-strategy-input"),
  submitImplementationStrategy: document.getElementById("submit-implementation-strategy"),
  implementationStrategies: document.getElementById("implementation-strategies"),
  implementationEvents: document.getElementById("implementation-events"),
  implementationStatus: document.getElementById("implementation-status"),
  startImplementation: document.getElementById("start-implementation"),
  stopImplementation: document.getElementById("stop-implementation"),
  testTab: document.getElementById("test-tab"),
  testPanel: document.getElementById("test-panel"),
  testProgress: document.getElementById("test-progress"),
  testProgressLabel: document.getElementById("test-progress-label"),
  testProgressBar: document.getElementById("test-progress-bar"),
  testMetrics: document.getElementById("test-metrics"),
  testScenarios: document.getElementById("test-scenarios"),
  testAgents: document.getElementById("test-agents"),
  testEvents: document.getElementById("test-events"),
  testStatus: document.getElementById("test-status"),
  testErrorToggle: document.getElementById("test-error-toggle"),
  testErrorDetails: document.getElementById("test-error-details"),
  startTests: document.getElementById("start-tests"),
  previewTabs: Array.from(document.querySelectorAll('[role="tab"]')),
  previewPanel: document.getElementById("live-preview-panel"),
  contentPanel: document.getElementById("content-panel"),
  previewTools: document.getElementById("preview-tools"),
  previewStatus: document.getElementById("preview-status"),
  previewTab: document.getElementById("live-preview-tab"),
  prototypeBuilding: document.getElementById("prototype-building"),
  prototypeBuildingMessage: document.getElementById("prototype-building-message"),
  prototypeBuildingTitle: document.getElementById("prototype-building-title"),
  prototypeBuildingElapsed: document.getElementById("prototype-building-elapsed"),
  prototypeBuildStatus: document.getElementById("prototype-build-status"),
  prototypeProgress: document.getElementById("prototype-progress"),
  prototypeMilestones: document.getElementById("prototype-milestones"),
  prototypeProgressMessage: document.getElementById("prototype-progress-message"),
  prototypeProgressDetails: document.getElementById("prototype-progress-details"),
  prototypeBudget: document.getElementById("prototype-budget"),
  prototypeActionStatus: document.getElementById("prototype-action-status"),
  applyPrototypeUpdate: document.getElementById("apply-prototype-update"),
  requestPrototypeVisual: document.getElementById("request-prototype-visual"),
  skipPrototypeVisual: document.getElementById("skip-prototype-visual"),
  retryPrototypeCheckpoint: document.getElementById("retry-prototype-checkpoint"),
  extendPrototypeBudget: document.getElementById("extend-prototype-budget"),
  startPrototype: document.getElementById("start-prototype"),
  previewEmpty: document.getElementById("preview-empty"),
  previewEmptyMessage: document.getElementById("preview-empty-message"),
  previewFrame: document.getElementById("preview-frame"),
  openPreview: document.getElementById("open-preview"),
  workspace: document.getElementById("studio-workspace"),
  requirements: document.getElementById("requirements-pane"),
  splitter: document.getElementById("studio-splitter"),
  reloadButton: document.getElementById("reload-extension"),
  reloadStatus: document.getElementById("reload-status"),
  stageList: document.getElementById("stage-list"),
  completeStage: document.getElementById("complete-stage"),
  stageMessage: document.getElementById("stage-message"),
  stageBrowsing: document.getElementById("stage-browsing"),
  reopenStage: document.getElementById("reopen-stage"),
  requirementsSubstageSection: document.getElementById("requirements-substage-section"),
  usageSubstage: document.getElementById("usage-substage"),
  dagSubstage: document.getElementById("dag-substage"),
  usageIntake: document.getElementById("usage-intake"),
  usageItems: document.getElementById("usage-items"),
  usageForm: document.getElementById("usage-form"),
  usageInput: document.getElementById("usage-input"),
  addUsage: document.getElementById("add-usage"),
  usageSuggestionArea: document.getElementById("usage-suggestion-area"),
  usageSuggestions: document.getElementById("usage-suggestions"),
  generateDag: document.getElementById("generate-dag"),
  usageMessage: document.getElementById("usage-message"),
  prototypeReview: document.getElementById("prototype-review"),
  revisionForm: document.getElementById("revision-form"),
  revisionInput: document.getElementById("revision-input"),
  submitRevision: document.getElementById("submit-revision"),
  revisionQuestion: document.getElementById("revision-question"),
  revisionQuestionTitle: document.getElementById("revision-question-title"),
  revisionQuestionRationale: document.getElementById("revision-question-rationale"),
  revisionQuestionForm: document.getElementById("revision-question-form"),
  revisionQuestionChoices: document.getElementById("revision-question-choices"),
  revisionQuestionDetail: document.getElementById("revision-question-detail"),
  submitClarification: document.getElementById("submit-clarification"),
  revisionHistory: document.getElementById("revision-history"),
  revisionHistoryDetails: document.getElementById("revision-history-details"),
  revisionQueueSummary: document.getElementById("revision-queue-summary"),
  revisionStatus: document.getElementById("revision-status"),
};

const MIN_REQUIREMENTS_WIDTH = 280;
const MIN_PREVIEW_WIDTH = 360;
const DEFAULT_REQUIREMENTS_RATIO = 0.24;
const KEYBOARD_RESIZE_STEP = 24;
const LIFECYCLE_STAGES = [
  { id: "prepare", label: "Preparation" },
  { id: "requirements", label: "Requirements" },
  { id: "prototype", label: "Prototype" },
  { id: "design", label: "Design" },
  { id: "plan", label: "Plan" },
  { id: "implement", label: "Implement" },
  { id: "test", label: "Test" },
];
let currentState = null;
let effortSubmitting: "start" | "reset" | null = null;
let lastRenderedGeneration: string | null = null;
let submitting = false;
let applyingAllRecommended = false;
let completingStage = false;
let reopeningStage = false;
let prototypeSubmitting = false;
let prototypeActionError = "";
let revisionTransportError = "";
const revisionSubmissions = new Map<string, {
  suggestion: string; baseCheckpointId?: string | null; clientRequestId: string;
}>();
const MAX_PREVIEW_STATE_BYTES = 64 * 1024;
let previewCapture: {
  source: Window; origin: string; requestId: string; prototypeId: string;
  finish: (value?: { state: unknown }) => void;
} | null = null;
let previewRestore: {
  prototypeId: string; generation: string; checkpointId: string; state: unknown;
} | null = null;
let viewedStageId = null;
let activePointerId = null;
let reloadRequestError = "";
let activeOutputTab = "preparation";
let selectedArtifactId = null;
let selectedDecisionId = null;
let followingActiveDecision = true;
let mermaidModulePromise = null;
let diagramRenderId = 0;
let designTreeRenderId = 0;
let planRenderId = 0;
let lastLifecycleStage = null;
let lastRequirementsView: { identity: string; substage: string } | null = null;
let preparationSubmitting = false;
let lastPreparationRuntimeSignature = "";
let implementationSubmitting = false;
let lastImplementationRuntimeSignature = "";
let lastProviderSignature = "";
let testSubmitting = false;
let testErrorDetailsExpanded = false;
let testErrorDetailsSignature = "";
let lastTestRuntimeSignature = "";
let processingMessageTimer = null;
let prototypeBuildMessageTimer = null;
let transportSequence = 0;
let lastTransportSequence = 0;
let sharedStateRequest = null;
let sharedStateSequence = 0;
let lastQuestionSignature = "";
const diagramViews = new Map<string, { mode: "fit" | "scale"; scale: number }>();
const diagramSignatures = new WeakMap<HTMLElement, string>();
const formDrafts = new Map<string, { values: AnyRecord; version: number }>();
const draftForms = new WeakSet<HTMLElement>();
const questionErrors = new Map<string, string>();
const expandedViews = new Map<string, boolean>();
const inputVersions = new WeakMap<HTMLElement, number>();
let lastNextActionLabel = "";

function currentStage(state = currentState) {
  return state?.lifecycle?.currentStage || "prepare";
}

function hasPendingRequest() {
  return Boolean(effortSubmitting || currentState?.effortReset) || submitting || completingStage || reopeningStage || prototypeSubmitting
    || preparationSubmitting || implementationSubmitting || testSubmitting || processSubmitting;
}

function skippedStage(state, stage) {
  return (state?.lifecycle?.skippedStages || []).find((entry) => entry.stageId === stage)
    || (stage === "prototype" && state?.prototypeApproach?.mode === "not-applicable"
      ? { stageId: stage, reason: state.prototypeApproach.reason || "No graphical interface needs prototype validation." }
      : null);
}

function canEditStage(stage, state = currentState, allowCompleted = false) {
  return Boolean(state)
    && !effortSubmitting && !state.effortReset && !reopeningStage && !completingStage
    && currentStage(state) === stage
    && !skippedStage(state, stage)
    && (stage !== "prototype" || state.prototypeApproach?.mode !== "undecided")
    && (allowCompleted || !(state.lifecycle?.completedStages || []).includes(stage))
    && state.provider?.canSubmitAnswers !== false;
}

function hasActiveJobs(state) {
  return ["running", "starting"].includes(state.processing?.status)
    || ["starting", "running"].includes(state.preparation?.status)
    || Boolean(state.preparation?.processing && !state.preparation.processing.completedAt)
    || state.suggestionProcessing?.status === "running"
    || Boolean(state.planning?.processing)
    || ["starting", "running"].includes(state.implementation?.status)
    || ["starting", "running"].includes(state.testing?.status)
    || state.previewStatus === "starting"
    || (state.prototypeFlow?.checkpoints || []).some((checkpoint) => checkpoint.status === "running")
    || [state.designReview, state.testDesignReview].some((review) =>
      review?.processing || review?.finalizeRequested
      || (review?.threads || []).some((thread) =>
        ["queued", "processing"].includes(thread.status)
      )
    );
}

const PROTOTYPE_MILESTONES = [
  { id: "structure", label: "Structure" },
  { id: "interaction", label: "Interaction" },
  { id: "visual", label: "Visual direction" },
];
const UNRESOLVED_REVISIONS = ["queued", "processing", "clarifying", "ready", "failed"];

function prototypeCheckpoint(state, id) {
  return (state?.prototypeFlow?.checkpoints || []).find((checkpoint) => checkpoint.id === id) || null;
}

function prototypeMilestoneReady(state, milestone) {
  return (state.prototypeFlow?.checkpoints || []).some((checkpoint) =>
    checkpoint.milestone === milestone && checkpoint.status === "ready");
}

function failedPrototypeCheckpoint(state) {
  const checkpoints = state.prototypeFlow?.checkpoints || [];
  return checkpoints.filter((checkpoint, index) => checkpoint.status === "failed"
    && (checkpoint.milestone !== "visual" || state.prototypeFlow.visualRequested)
    && !checkpoints.slice(index + 1).some((next) =>
      next.milestone === checkpoint.milestone && next.revisionId === checkpoint.revisionId)).at(-1) || null;
}

function failedPrototypeRevision(state) {
  return (state.prototypeReview?.revisions || []).find((revision) => revision.status === "failed") || null;
}

function prototypeFinalizing(state) {
  return completingStage || (["starting", "running"].includes(state.processing?.status)
    && state.processing?.action === "generate-design-spec");
}

function prototypeCompletionBlocked(state) {
  const flow = state.prototypeFlow;
  return hasActiveJobs(state)
    || Boolean(state.prototypeReview?.question)
    || (state.prototypeReview?.revisions || []).some((revision) => UNRESOLVED_REVISIONS.includes(revision.status))
    || Boolean(flow && (flow.pendingCheckpointId
      || !prototypeMilestoneReady(state, "structure")
      || !prototypeMilestoneReady(state, "interaction")
      || (flow.visualRequested && !prototypeMilestoneReady(state, "visual"))));
}

function previewOrigin(url) {
  try {
    const parsed = new URL(url);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.origin : null;
  } catch {
    return null;
  }
}

function capturePreviewState(): Promise<{ state: unknown } | undefined> {
  previewCapture?.finish();
  const source = elements.previewFrame.contentWindow;
  const origin = previewOrigin(elements.previewFrame.dataset.url);
  const prototypeId = currentState.prototypeId;
  if (!source || !origin) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => finish(), 350);
    function finish(value?: { state: unknown }) {
      clearTimeout(timer);
      if (previewCapture?.requestId === requestId) previewCapture = null;
      resolve(value);
    }
    previewCapture = { source, origin, requestId, prototypeId, finish };
    try {
      source.postMessage({ type: "tandem:preview:capture", requestId, prototypeId }, origin);
    } catch (error) {
      console.warn("Prototype state capture is unavailable; the update can still be applied.", error);
      finish();
    }
  });
}

window.addEventListener("message", (event) => {
  const capture = previewCapture;
  const data = event.data;
  if (!capture || event.source !== capture.source
    || event.source !== elements.previewFrame.contentWindow || event.origin !== capture.origin
    || data?.type !== "tandem:preview:state" || data.requestId !== capture.requestId
    || data.prototypeId !== capture.prototypeId || !Object.hasOwn(data, "state")) return;
  try {
    const json = JSON.stringify(data.state);
    if (!json || new TextEncoder().encode(json).byteLength > MAX_PREVIEW_STATE_BYTES) return;
    capture.finish({ state: JSON.parse(json) });
  } catch (error) {
    console.warn("Ignored a prototype state response that could not be serialized.", error);
  }
});

elements.previewFrame.addEventListener("load", () => {
  const restore = previewRestore;
  if (!restore || restore.prototypeId !== currentState?.prototypeId
    || restore.generation !== currentState?.generation
    || restore.checkpointId !== currentState?.prototypeFlow?.displayedCheckpointId
    || restore.checkpointId !== elements.previewFrame.dataset.checkpointId) return;
  const origin = previewOrigin(elements.previewFrame.dataset.url);
  if (!origin) return;
  previewRestore = null;
  try {
    elements.previewFrame.contentWindow?.postMessage({
      type: "tandem:preview:restore", prototypeId: restore.prototypeId, state: restore.state,
    }, origin);
  } catch (error) {
    console.warn("Prototype state could not be restored; the updated preview remains available.", error);
  }
});

function hasStageData(state, stage) {
  return currentStage(state) === stage
    || (state.lifecycle?.completedStages || []).includes(stage)
    || (state.lifecycle?.history || []).some((output) => output.stageId === stage)
    || (state.artifacts || []).some((artifact) => artifact.stage === stage)
    || (stage === "plan" && (state.planning?.workItems || []).length > 0)
    || (stage === "implement" && (state.implementation?.workItems || []).length > 0)
    || (stage === "test" && (state.testing?.scenarios || []).length > 0);
}

function stageTab(stage) {
  return {
    prepare: "preparation", requirements: "design-tree", prototype: "preview", design: "design-review",
    plan: "plan", implement: "implementation", test: "test",
  }[stage] || "content";
}

function browseStage(stage) {
  if (!currentState || !hasStageData(currentState, stage) || skippedStage(currentState, stage)) return;
  viewedStageId = stage;
  if (window.matchMedia("(max-width: 760px)").matches) setContextExpanded(false);
  activateOutputTab(stageTab(stage), true);
}

function uiKey(element) {
  return element?.dataset?.uiKey || element?.id || "";
}

function captureView(root = document.body) {
  for (const details of root.querySelectorAll("details[data-ui-key]")) {
    if (details instanceof HTMLDetailsElement) expandedViews.set(uiKey(details), details.open);
  }
  const active = document.activeElement as HTMLInputElement | null;
  return {
    focus: root.contains(active) ? uiKey(active) : "",
    original: active,
    start: active?.selectionStart,
    end: active?.selectionEnd,
    scroll: Array.from(root.querySelectorAll("[id], [data-ui-key]"))
      .filter((element: HTMLElement) => element.scrollTop || element.scrollLeft)
      .map((element: HTMLElement) => ({
        key: uiKey(element), top: element.scrollTop, left: element.scrollLeft,
      })),
  };
}

function restoreView(snapshot, root = document.body) {
  const nodes = Array.from(root.querySelectorAll("[id], [data-ui-key]")) as HTMLElement[];
  for (const details of root.querySelectorAll("details[data-ui-key]")) {
    if (details instanceof HTMLDetailsElement && expandedViews.has(uiKey(details))) {
      details.open = expandedViews.get(uiKey(details))!;
    }
  }
  for (const scroll of snapshot.scroll) {
    const element = nodes.find((node) => uiKey(node) === scroll.key);
    if (element) {
      element.scrollTop = scroll.top;
      element.scrollLeft = scroll.left;
    }
  }
  const target = nodes.find((node) => uiKey(node) === snapshot.focus) as HTMLInputElement;
  if (
    target && !target.disabled && !target.closest("[hidden]")
    && (!snapshot.original?.isConnected || document.activeElement === snapshot.original)
  ) {
    if (document.activeElement !== target) target.focus({ preventScroll: true });
    if (typeof snapshot.start === "number" && typeof target.setSelectionRange === "function") {
      try { target.setSelectionRange(snapshot.start, snapshot.end); } catch { /* Non-text input. */ }
    }
  }
}

function formValues(form) {
  const values: AnyRecord = {};
  for (const input of form.querySelectorAll("input, textarea, select")) {
    const key = input.name || input.id;
    if (!key) continue;
    if (input.type === "radio") {
      values[key + ":" + input.value] = input.checked;
    } else {
      values[key] = input.value;
    }
  }
  return values;
}

function saveFormDraft(form, edited = false) {
  const key = form?.dataset?.draftKey;
  if (!key) return;
  const previous = formDrafts.get(key);
  formDrafts.set(key, {
    values: formValues(form),
    version: (previous?.version || 0) + (edited ? 1 : 0),
  });
}

function bindFormDraft(form, key) {
  const previousKey = form.dataset.draftKey;
  if (previousKey && previousKey !== key) {
    speechInputs.cancelForForm(form);
    saveFormDraft(form);
    for (const input of form.querySelectorAll("textarea, input:not([type=radio])")) {
      input.value = "";
    }
    for (const select of form.querySelectorAll("select")) select.selectedIndex = 0;
  }
  form.dataset.draftKey = key;
  const draft = formDrafts.get(key);
  if (draft) {
    for (const input of form.querySelectorAll("input, textarea, select")) {
      const name = input.name || input.id;
      const field = input.type === "radio" ? name + ":" + input.value : name;
      if (!(field in draft.values)) continue;
      if (input.type === "radio") input.checked = draft.values[field];
      else input.value = draft.values[field];
    }
  }
  if (!draftForms.has(form)) {
    form.addEventListener("input", () => saveFormDraft(form, true));
    form.addEventListener("change", () => saveFormDraft(form, true));
    draftForms.add(form);
  }
  saveFormDraft(form);
}

function draftKey(kind, id, definition = null) {
  return JSON.stringify([currentState?.prototypeId || "", kind, id, definition]);
}

function clearAcceptedDraft(key, version) {
  const draft = formDrafts.get(key);
  if (!draft || draft.version !== version) return;
  const values = Object.fromEntries(Object.entries(draft.values).map(([field, value]) => [
    field, typeof value === "boolean" ? false : field === "review-request-kind" ? "question" : "",
  ]));
  formDrafts.set(key, { values, version: version + 1 });
  for (const form of document.querySelectorAll("form[data-draft-key]")) {
    if ((form as HTMLElement).dataset.draftKey === key) bindFormDraft(form, key);
  }
}

function captureInput(input) {
  return { value: input.value, version: inputVersions.get(input) || 0 };
}

function clearAcceptedInput(input, snapshot) {
  if (input.value === snapshot.value && (inputVersions.get(input) || 0) === snapshot.version) {
    input.value = "";
  }
}

for (const event of ["input", "change"]) {
  document.addEventListener(event, (event) => {
    const input = event.target as HTMLElement;
    inputVersions.set(input, (inputVersions.get(input) || 0) + 1);
  }, true);
}

function elapsedLabel(requestedAt) {
  const start = Date.parse(requestedAt || "");
  if (!Number.isFinite(start)) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - start) / 1000));
  return "Elapsed: " + Math.floor(seconds / 60) + "m " + (seconds % 60) + "s";
}

const speechInputs = installSpeechInputs(document, createAzureSpeechSession, () =>
  JSON.stringify([currentState?.prototypeId, currentState?.generation]),
);

async function postJson(endpoint, body, timeoutMs = 60000) {
  const sequence = ++transportSequence;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The request failed.");
  if (isStateSnapshot(result)) renderIfChanged(result, sequence);
  else await refreshSharedState(sequence).catch(() => undefined);
  return result;
}

function isGoalEntry(state) {
  return !state?.goal?.trim()
    && currentStage(state) === "prepare"
    && state?.preparation?.status === "not-started";
}

function renderEffortControls(state) {
  const writable = state?.provider?.canSubmitAnswers !== false;
  const atStart = isGoalEntry(state);
  const blocked = Boolean(effortSubmitting || state?.effortReset);
  elements.startPanel.hidden = !atStart;
  elements.workspace.hidden = atStart;
  elements.workspace.inert = blocked;
  elements.workspace.setAttribute("aria-busy", String(blocked));
  elements.lifecycleStatus.hidden = atStart;
  elements.startLoading.hidden = true;
  elements.startForm.hidden = false;
  elements.resetEffort.disabled = !state || !writable || Boolean(effortSubmitting);
  elements.resetEffort.textContent = effortSubmitting === "reset" ? "Resetting..." : "Reset";
  elements.resetEffort.title = !writable
    ? "Use the writable Tandem provider and the session that owns active work to reset."
    : "Clear the current Tandem effort and return to goal entry";
  elements.startGoal.disabled = !writable || blocked;
  elements.startEffort.disabled = !writable || blocked
    || !elements.startGoal.value.trim() || elements.startGoal.value.length > 4000;
  elements.startEffort.textContent = effortSubmitting === "start" ? "Starting..." : "Start project";
  elements.startForm.setAttribute("aria-busy", String(effortSubmitting === "start"));
  if (atStart && !writable && !elements.startMessage.textContent) {
    elements.startMessage.textContent = "Open the writable Tandem provider to start this project.";
  }
  elements.goalLength.textContent = elements.startGoal.value.length.toLocaleString() + " / 4,000";
  if (state?.effortReset) {
    elements.effortMessage.textContent = state.effortReset.error
      || "Reset is pending. Use Reset to confirm worker termination and finish clearing this effort.";
    elements.effortMessage.dataset.status = state.effortReset.error ? "error" : "idle";
  }
  if (atStart || blocked) {
    elements.nextActionBar.hidden = true;
    clearNextAction();
  }
}

elements.startGoal.addEventListener("input", () => {
  elements.startGoal.removeAttribute("aria-invalid");
  elements.startMessage.textContent = "";
  if (currentState) renderEffortControls(currentState);
});

elements.startForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentState || effortSubmitting || currentState.effortReset || !isGoalEntry(currentState)
    || currentState.provider?.canSubmitAnswers === false) return;
  const goal = elements.startGoal.value.trim();
  if (!goal || elements.startGoal.value.length > 4000) {
    elements.startMessage.textContent = "Enter a project goal between 1 and 4,000 characters.";
    elements.startMessage.dataset.status = "error";
    elements.startGoal.setAttribute("aria-invalid", "true");
    elements.startGoal.focus();
    return;
  }
  const identity = { expectedRevision: currentState.revision ?? 0, generation: currentState.generation };
  effortSubmitting = "start";
  elements.startMessage.textContent = "Saving your goal and starting preparation...";
  elements.startMessage.dataset.status = "idle";
  elements.effortMessage.textContent = "";
  render(currentState, true);
  try {
    await postJson("/api/effort/start", { ...identity, goal });
    if (!isGoalEntry(currentState)) {
      elements.startGoal.value = "";
      elements.startMessage.textContent = "";
      elements.preparationPanel.focus();
    }
  } catch (error) {
    elements.startMessage.textContent = error instanceof Error ? error.message : "Could not start the project.";
    elements.startMessage.dataset.status = "error";
    if (!isGoalEntry(currentState)) {
      elements.effortMessage.textContent = elements.startMessage.textContent;
      elements.effortMessage.dataset.status = "error";
    }
  } finally {
    effortSubmitting = null;
    if (currentState) render(currentState, true);
  }
});

elements.resetEffort.addEventListener("click", async () => {
  if (!currentState || effortSubmitting || currentState.provider?.canSubmitAnswers === false) return;
  if (!window.confirm(
    "Reset this Tandem effort? Active work will be stopped before its goal, requirements, artifacts, "
    + "stage history, handoffs, and settings are cleared. This cannot be undone. Other efforts, repository "
    + "files, and exported files will not be changed.",
  )) return;
  const identity = { expectedRevision: currentState.revision ?? 0, generation: currentState.generation };
  effortSubmitting = "reset";
  applyingAllRecommended = false;
  elements.effortMessage.textContent = "Stopping active work and resetting this effort...";
  elements.effortMessage.dataset.status = "idle";
  render(currentState, true);
  try {
    await postJson("/api/effort/reset", { ...identity, confirm: true }, 120000);
    if (!isGoalEntry(currentState) || currentState.generation === identity.generation) {
      throw new Error("Reset has not been confirmed. Reload the project state before retrying.");
    }
    elements.effortMessage.textContent = "Effort reset. Enter a new goal to start again.";
    elements.startGoal.focus();
  } catch (error) {
    elements.effortMessage.textContent = error instanceof Error ? error.message : "Could not reset the effort.";
    elements.effortMessage.dataset.status = "error";
  } finally {
    effortSubmitting = null;
    if (currentState) render(currentState, true);
    if (isGoalEntry(currentState)) elements.startGoal.focus();
  }
});

function clearEffortDrafts() {
  previewCapture?.finish();
  previewRestore = null;
  revisionSubmissions.clear();
  revisionTransportError = "";
  prototypeActionError = "";
  formDrafts.clear();
  questionErrors.clear();
  expandedViews.clear();
  diagramViews.clear();
  selectedArtifactId = null;
  selectedDecisionId = null;
  followingActiveDecision = true;
  applyingAllRecommended = false;
  lastQuestionSignature = "";
  lastLifecycleStage = null;
  viewedStageId = null;
  activeOutputTab = "preparation";
  processSettingsDirty = false;
  processSettingsEffort = "";
  for (const input of document.querySelectorAll("input, textarea, select")) {
    inputVersions.delete(input as HTMLElement);
    if (input.tagName.toLowerCase() === "select") (input as HTMLSelectElement).selectedIndex = 0;
    else if ((input as HTMLInputElement).type === "checkbox" || (input as HTMLInputElement).type === "radio") {
      (input as HTMLInputElement).checked = false;
    } else (input as HTMLInputElement).value = "";
  }
  for (const form of document.querySelectorAll("form[data-draft-key]")) form.removeAttribute("data-draft-key");
  for (const details of document.querySelectorAll("details")) (details as HTMLDetailsElement).open = false;
  elements.startMessage.textContent = "";
  elements.effortMessage.textContent = "";
  elements.effortMessage.dataset.status = "idle";
  elements.startGoal.removeAttribute("aria-invalid");
  elements.previewFrame.removeAttribute("src");
  delete elements.previewFrame.dataset.url;
  delete elements.previewFrame.dataset.checkpointId;
  setContextExpanded(false);
}

let processSubmitting = false;
let processSettingsDirty = false;
let processSettingsEffort = "";
let processSettingsBaseRevision = 0;
const processSettingsElements = ["handoffAdapter", "statusAdapter", "intakeAdapter", "processRepository",
  "autoImplement", "autoTest", "evidenceEnabled", "independentReview", "verificationChecks", "protectedPaths"];
for (const key of processSettingsElements) {
  const markDirty = () => {
    if (!processSettingsDirty) processSettingsBaseRevision = currentState?.revision ?? 0;
    processSettingsDirty = true;
  };
  elements[key].addEventListener("input", markDirty);
  elements[key].addEventListener("change", markDirty);
}

function selectedAcceptance(state) {
  return (state.process?.acceptances || []).filter((record) => record.stageId === elements.handoffStage.value &&
    state.lifecycle.outputs.some((output) => output.stageId === record.stageId && output.path === record.snapshotPath)).at(-1);
}

async function submitProcess(body) {
  if (!currentState || processSubmitting || hasPendingRequest() || hasActiveJobs(currentState) ||
      currentState.provider?.canSubmitAnswers === false) return;
  processSubmitting = true;
  elements.processMessage.textContent = "Processing...";
  elements.processMessage.dataset.status = "idle";
  renderProcess(currentState, true);
  try {
    await postJson("/api/process", { expectedRevision: currentState.revision ?? 0, ...body });
    elements.processMessage.textContent = currentState.process?.message || "Process action completed.";
    return true;
  } catch (error) {
    elements.processMessage.textContent = error instanceof Error ? error.message : "Process action failed.";
    elements.processMessage.dataset.status = "error";
    return false;
  } finally {
    processSubmitting = false;
    if (currentState) renderProcess(currentState, true);
  }
}

elements.handoffStage.addEventListener("change", () => currentState && renderProcess(currentState, true));
elements.resetProcess.addEventListener("click", () => {
  if (processSubmitting || !window.confirm("Discard the process settings draft and reload saved settings?")) return;
  processSettingsDirty = false;
  if (currentState) renderProcess(currentState, true);
});
elements.prepareDelivery.addEventListener("click", () => submitProcess({ action: "prepare-handoff" }));
elements.publishDelivery.addEventListener("click", () => {
  const adapter = currentState?.process?.settings.adapters.handoff || "local";
  if (!window.confirm(`Publish the displayed delivery draft using ${adapter}? GitHub posts a comment to the existing PR; Local writes a local bundle. Nothing will be merged or deployed.`)) return;
  return submitProcess({ action: "handoff", reference: elements.processReference.value, confirm: true });
});
elements.refreshDelivery.addEventListener("click", () =>
  submitProcess({ action: "status", reference: elements.processReference.value }));
elements.importIntake.addEventListener("click", () => {
  if (!window.confirm("Read this source and create a new linked effort? The current effort will not be reset, and no agents will start.")) return;
  return submitProcess({ action: "intake", reference: elements.processReference.value,
    ...(currentState?.process?.settings.adapters.intake === "github" ? {} : { content: elements.intakeContent.value }) });
});
elements.acceptHandoff.addEventListener("click", () => submitProcess({
  action: "accept", stageId: elements.handoffStage.value, approver: elements.handoffApprover.value,
}));
elements.exportHandoff.addEventListener("click", () => {
  const record = selectedAcceptance(currentState);
  if (!record || !window.confirm("Export the accepted snapshot and artifacts into tandem-records? Review the bundle before sharing; nothing will be committed.")) return;
  return submitProcess({ action: "export", acceptanceId: record.id });
});
elements.saveProcess.addEventListener("click", async () => {
  let checks;
  try { checks = JSON.parse(elements.verificationChecks.value); }
  catch {
    elements.processMessage.textContent = "Verification commands must be a valid JSON array.";
    elements.processMessage.dataset.status = "error";
    return;
  }
  if (!window.confirm("Save these process settings? Enabled verification commands will run with your local user permissions. Acceptance and external publication remain explicit.")) return;
  const settings = {
    adapters: { handoff: elements.handoffAdapter.value, status: elements.statusAdapter.value, intake: elements.intakeAdapter.value },
    githubRepository: elements.processRepository.value.trim(),
    autoStartImplementation: elements.autoImplement.checked,
    autoStartTests: elements.autoTest.checked,
    verification: { enabled: elements.evidenceEnabled.checked, independentReview: elements.independentReview.checked, checks,
      protectedPaths: elements.protectedPaths.value.split(/\r?\n/).map((path) => path.trim()).filter(Boolean) },
  };
  const submittedDraft = processSettingsElements.map((key) => [elements[key].value, elements[key].checked]);
  const success = await submitProcess({ action: "configure", settings,
    expectedRevision: processSettingsDirty ? processSettingsBaseRevision : currentState.revision });
  if (success && JSON.stringify(submittedDraft) === JSON.stringify(
    processSettingsElements.map((key) => [elements[key].value, elements[key].checked]),
  )) processSettingsDirty = false;
  if (currentState) renderProcess(currentState, true);
});

function renderProcess(state, preserveMessage = false) {
  const process = state.process;
  const busy = processSubmitting || hasPendingRequest() || hasActiveJobs(state) || state.provider?.canSubmitAnswers === false;
  const stages = state.lifecycle.outputs || [];
  const stageSignature = JSON.stringify(stages.map((output) => output.stageId));
  if (elements.handoffStage.dataset.signature !== stageSignature) {
    const selected = elements.handoffStage.value;
    elements.handoffStage.replaceChildren(...stages.map((output) => {
      const option = document.createElement("option");
      option.value = output.stageId;
      option.textContent = LIFECYCLE_STAGES.find((stage) => stage.id === output.stageId)?.label || output.stageId;
      return option;
    }));
    elements.handoffStage.value = stages.some((output) => output.stageId === selected) ? selected : stages.at(-1)?.stageId || "";
    elements.handoffStage.dataset.signature = stageSignature;
  }
  const record = selectedAcceptance(state);
  elements.handoffRecord.textContent = record
    ? `Accepted by ${record.acceptedBy.label} at ${record.acceptedAt}. ${record.exportPath || "Not exported."}`
    : "No acceptance for this stage revision.";
  elements.acceptHandoff.disabled = busy || !elements.handoffStage.value;
  elements.exportHandoff.disabled = busy || !record;
  elements.saveProcess.disabled = busy;
  elements.resetProcess.disabled = busy;
  elements.prepareDelivery.disabled = busy || !state.lifecycle.completedStages.includes("test");
  elements.publishDelivery.disabled = busy || !process?.deliveryDraft || !state.lifecycle.completedStages.includes("test");
  elements.publishDelivery.textContent = `Publish reviewed handoff (${process?.settings.adapters.handoff || "local"})`;
  elements.refreshDelivery.disabled = busy;
  elements.refreshDelivery.textContent = `Read review / check status (${process?.settings.adapters.status || "local"})`;
  elements.importIntake.disabled = busy;
  elements.importIntake.textContent = `Import linked effort (${process?.settings.adapters.intake || "local"})`;
  elements.deliveryDraft.textContent = process?.deliveryDraft?.body || "Finish Test and accept its handoff to prepare a reviewable delivery draft.";
  const receiptsSignature = JSON.stringify(process?.receipts || []);
  if (elements.processReceipts.dataset.signature !== receiptsSignature) {
    elements.processReceipts.replaceChildren(...(process?.receipts || []).slice().reverse().map((receipt) => {
      const details = document.createElement("details");
      details.dataset.uiKey = "process-receipt:" + receipt.id;
      const summary = document.createElement("summary");
      summary.textContent = `${receipt.adapter} / ${receipt.block} / ${receipt.recordedAt}`;
      const text = document.createElement("pre");
      text.textContent = `${receipt.reference}\n${receipt.summary}`;
      details.append(summary, text);
      if (receipt.followupId) {
        const open = document.createElement("button");
        open.type = "button";
        open.className = "complete-stage";
        open.textContent = "Open linked effort and start Preparation";
        open.addEventListener("click", () => submitProcess({ action: "open-intake", receiptId: receipt.id }));
        details.append(open);
      }
      return details;
    }));
    elements.processReceipts.dataset.signature = receiptsSignature;
  }
  if (processSettingsEffort !== state.prototypeId) {
    processSettingsDirty = false;
    processSettingsEffort = state.prototypeId;
  }
  if (!processSettingsDirty) {
    const settings = process?.settings;
    for (const block of ["handoff", "status", "intake"]) elements[block + "Adapter"].value = settings?.adapters?.[block] || "local";
    elements.processRepository.value = settings?.githubRepository || "";
    elements.autoImplement.checked = settings?.autoStartImplementation || false;
    elements.autoTest.checked = settings?.autoStartTests || false;
    elements.evidenceEnabled.checked = settings?.verification?.enabled || false;
    elements.independentReview.checked = settings?.verification?.independentReview !== false;
    elements.verificationChecks.value = JSON.stringify(settings?.verification?.checks || [], null, 2);
    elements.protectedPaths.value = (settings?.verification?.protectedPaths || []).join("\n");
    processSettingsBaseRevision = state.revision ?? 0;
  }
  const metrics = state.processMetrics;
  elements.processMetrics.textContent = metrics
    ? `${metrics.acceptanceCount} accepted handoffs; ${metrics.reopenedCount} reopenings; ${Math.round(metrics.acceptanceWaitingMs / 60000)} minutes awaiting handoff acceptance. `
      + (metrics.measuredRunCount ? `${Math.round(metrics.measuredActiveMs / 60000)} factory-active minutes; ${(metrics.measuredNanoAiu / 1e9).toFixed(3)} reported AIU across ${metrics.measuredRunCount} metered runs.` : "Factory usage not yet recorded.")
      + (process?.meteringError ? ` ${process.meteringError}` : "")
    : "";
  const proof = [state.implementation, state.testing].flatMap((runtime) => runtime?.commandEvidence || []);
  const evidenceSignature = JSON.stringify([proof, state.testing?.independentVerdict]);
  if (elements.processEvidence.dataset.signature !== evidenceSignature) {
    elements.processEvidence.replaceChildren(...proof.map((record) => {
      const details = document.createElement("details");
      details.dataset.uiKey = "command-evidence:" + record.id;
      const summary = document.createElement("summary");
      summary.textContent = `${record.checkId}: ${record.status} (exit ${record.exitCode ?? "unavailable"})`;
      const output = document.createElement("pre");
      output.textContent = `${record.program} ${JSON.stringify(record.args)}\nSources: ${record.sourceFingerprint}\nOutput SHA256: ${record.outputHash}\n${record.output}\n${record.error || ""}${record.outputTruncated ? "\n[Output truncated]" : ""}`;
      details.append(summary, output);
      return details;
    }));
    const verdict = document.createElement("p");
    verdict.textContent = state.testing?.independentVerdict
      ? `Independent verifier: ${state.testing.independentVerdict.status}. ${state.testing.independentVerdict.summary}`
      : "Independent verification has not run. Worker-reported evidence is shown in the implementation and test tabs.";
    elements.processEvidence.append(verdict);
    elements.processEvidence.dataset.signature = evidenceSignature;
  }
  if (!preserveMessage) elements.processMessage.textContent = process?.message || "";
}

function finishSubmission() {
  submitting = false;
  if (currentState) {
    render(currentState, true);
  }
}

function setContextExpanded(expanded: boolean) {
  elements.workspace.dataset.contextOpen = String(expanded);
  elements.contextToggle.setAttribute("aria-expanded", String(expanded));
}

elements.contextToggle.addEventListener("click", () => {
  setContextExpanded(elements.contextToggle.getAttribute("aria-expanded") !== "true");
});

elements.requirements.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !window.matchMedia("(max-width: 760px)").matches) return;
  setContextExpanded(false);
  elements.contextToggle.focus();
  event.preventDefault();
});

elements.showNextAction.addEventListener("click", () => {
  const action = currentState && nextActionForState(currentState);
  if (!action?.target || action.target.disabled) return;
  if (action.tab) activateOutputTab(action.tab);
  else if (elements.requirements.contains(action.target)) browseStage(currentStage());
  if (window.matchMedia("(max-width: 760px)").matches) {
    setContextExpanded(elements.requirements.contains(action.target));
  }
  action.target.focus();
  action.target.scrollIntoView?.({ block: "nearest", inline: "nearest" });
});

function splitterBounds() {
  const workspaceRect = elements.workspace.getBoundingClientRect();
  const splitterWidth = elements.splitter.getBoundingClientRect().width || 9;
  return {
    workspaceRect,
    min: MIN_REQUIREMENTS_WIDTH,
    max: Math.max(
      MIN_REQUIREMENTS_WIDTH,
      workspaceRect.width - splitterWidth - MIN_PREVIEW_WIDTH,
    ),
  };
}

function setRequirementsWidth(width) {
  if (window.matchMedia("(max-width: 760px)").matches) return;
  const bounds = splitterBounds();
  const next = Math.round(Math.min(bounds.max, Math.max(bounds.min, width)));
  elements.workspace.style.setProperty("--requirements-width", next + "px");
  elements.splitter.setAttribute("aria-valuemin", String(bounds.min));
  elements.splitter.setAttribute("aria-valuemax", String(Math.round(bounds.max)));
  elements.splitter.setAttribute("aria-valuenow", String(next));
  const percent = bounds.workspaceRect.width > 0
    ? Math.round((next / bounds.workspaceRect.width) * 100)
    : DEFAULT_REQUIREMENTS_RATIO * 100;
  elements.splitter.setAttribute(
    "aria-valuetext",
    percent + "% requirements, " + (100 - percent) + "% preview",
  );
}

function syncSplitterBounds() {
  if (window.matchMedia("(max-width: 760px)").matches) return;
  const currentWidth = elements.requirements.getBoundingClientRect().width;
  setRequirementsWidth(
    currentWidth || elements.workspace.clientWidth * DEFAULT_REQUIREMENTS_RATIO,
  );
}

function resizeFromPointer(clientX) {
  const { workspaceRect } = splitterBounds();
  setRequirementsWidth(clientX - workspaceRect.left);
}

function finishPointerResize(pointerId, releaseCapture) {
  if (activePointerId !== pointerId) return;
  activePointerId = null;
  elements.splitter.classList.remove("is-dragging");
  document.body.classList.remove("is-resizing");
  if (
    releaseCapture &&
    elements.splitter.hasPointerCapture(pointerId)
  ) {
    elements.splitter.releasePointerCapture(pointerId);
  }
}

elements.splitter.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || window.matchMedia("(max-width: 760px)").matches) {
    return;
  }
  activePointerId = event.pointerId;
  elements.splitter.setPointerCapture(event.pointerId);
  elements.splitter.classList.add("is-dragging");
  document.body.classList.add("is-resizing");
  resizeFromPointer(event.clientX);
  event.preventDefault();
});

elements.splitter.addEventListener("pointermove", (event) => {
  if (activePointerId !== event.pointerId) return;
  resizeFromPointer(event.clientX);
});

elements.splitter.addEventListener("pointerup", (event) => {
  finishPointerResize(event.pointerId, true);
});

elements.splitter.addEventListener("pointercancel", (event) => {
  finishPointerResize(event.pointerId, true);
});

elements.splitter.addEventListener("lostpointercapture", (event) => {
  finishPointerResize(event.pointerId, false);
});

elements.splitter.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  const direction = event.key === "ArrowLeft" ? -1 : 1;
  const step = event.shiftKey ? KEYBOARD_RESIZE_STEP * 2 : KEYBOARD_RESIZE_STEP;
  setRequirementsWidth(
    elements.requirements.getBoundingClientRect().width + direction * step,
  );
  event.preventDefault();
});

window.addEventListener("resize", syncSplitterBounds);
requestAnimationFrame(syncSplitterBounds);

function renderReload(state) {
  const provider = state.provider || {};
  const receipt = state.reloadReceipt;
  const canReload = provider.canReload === true;
  const isReloading = receipt?.status === "reloading";

  elements.reloadButton.disabled = !canReload || isReloading || Boolean(effortSubmitting);
  elements.reloadButton.textContent = isReloading
    ? "Reloading..."
    : "Reload";

  let status = "";
  let statusKind = "idle";
  if (reloadRequestError) {
    status = reloadRequestError;
    statusKind = "error";
  } else if (!canReload) {
    status = provider.source === "project"
      ? "Available from the user-installed Tandem"
      : "Reload unavailable";
  } else if (receipt?.status === "reloading") {
    status = receipt.message || "Reloading...";
  } else if (receipt?.status === "success") {
    statusKind = "success";
  } else if (receipt?.status === "error") {
    status = receipt.message || "Reload failed";
    statusKind = "error";
  } else {
    status = "Current session only";
  }

  elements.reloadStatus.textContent = status;
  elements.reloadStatus.dataset.status = statusKind;
  elements.reloadButton.title = canReload
    ? "Restart this session's provider from the latest installed user extension. This does not download updates."
    : status;
}

elements.reloadButton.addEventListener("click", async () => {
  if (elements.reloadButton.disabled) return;
  reloadRequestError = "";
  elements.reloadButton.disabled = true;
  elements.reloadButton.textContent = "Checking...";
  elements.reloadStatus.textContent = "Checking installed user extension...";
  elements.reloadStatus.dataset.status = "idle";

  try {
    const response = await fetch("/api/reload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || "Reload request failed.");
    }
    elements.reloadButton.textContent = "Reloading...";
    elements.reloadStatus.textContent = "Reloading this session...";
  } catch (error) {
    reloadRequestError = error instanceof Error
      ? error.message
      : "Reload request failed.";
    if (currentState) renderReload(currentState);
  }
});

async function submitRequirementAction(action, answer) {
  if (
    hasPendingRequest() ||
    !canEditStage("requirements") ||
    currentState.processing?.status === "running"
  ) {
    return false;
  }
  submitting = true;
  elements.usageMessage.textContent =
    action === "generate-dag"
      ? "Generating the DAG from your usage list..."
      : "Adding usage and generating suggestions...";
  elements.usageMessage.dataset.status = "idle";
  renderRequirementsSubstage(currentState);
  try {
    await postJson("/api/answer", {
        questionId: "usage-intake",
        answer,
        action,
    });
    return true;
  } catch (error) {
    elements.usageMessage.textContent = error instanceof Error
      ? error.message
      : "Could not update requirements.";
    elements.usageMessage.dataset.status = "error";
    return false;
  } finally {
    finishSubmission();
  }
}

elements.usageForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const draft = captureInput(elements.usageInput);
  const usage = draft.value.trim();
  if (!usage) {
    elements.usageMessage.textContent = "Enter one usage sentence.";
    elements.usageMessage.dataset.status = "error";
    return;
  }
  if (await submitRequirementAction("add-usage", usage)) {
    clearAcceptedInput(elements.usageInput, draft);
  }
});

elements.generateDag.addEventListener("click", () => {
  submitRequirementAction(
    "generate-dag",
    "Generate the requirements DAG from the complete usage list.",
  );
});

elements.revisionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (hasPendingRequest() || !canEditStage("prototype") || prototypeFinalizing(currentState)) return;
  const draft = captureInput(elements.revisionInput);
  const suggestion = draft.value.trim();
  const unresolved = (currentState.prototypeReview?.revisions || []).filter((revision) =>
    UNRESOLVED_REVISIONS.includes(revision.status)).length;
  if (!suggestion || suggestion.length > 4000 || unresolved >= 50) {
    revisionTransportError = unresolved >= 50
      ? "The feedback queue is full (50 unresolved revisions). Apply or resolve existing updates, then send this draft."
      : suggestion.length > 4000 ? "Keep the revision suggestion within 4,000 characters." : "Enter a revision suggestion.";
    elements.revisionStatus.textContent = revisionTransportError;
    elements.revisionStatus.dataset.status = "error";
    elements.revisionStatus.dataset.essential = "true";
    return;
  }
  const key = JSON.stringify([currentState.prototypeId, currentState.generation, suggestion]);
  let submission = revisionSubmissions.get(key);
  if (!submission) {
    submission = {
      suggestion,
      baseCheckpointId: currentState.prototypeFlow?.displayedCheckpointId
        || (currentState.previewStatus === "ready" && !currentState.prototypeFlow ? undefined : null),
      clientRequestId: crypto.randomUUID(),
    };
    revisionSubmissions.set(key, submission);
  }
  submitting = true;
  revisionTransportError = "";
  elements.submitRevision.disabled = true;
  elements.submitRevision.textContent = "Sending...";
  elements.revisionStatus.textContent = "";
  try {
    await postJson("/api/revision", submission);
    revisionSubmissions.delete(key);
    clearAcceptedInput(elements.revisionInput, draft);
  } catch (error) {
    revisionTransportError = error instanceof Error
      ? error.message
      : "Could not submit the revision.";
    elements.revisionStatus.textContent = revisionTransportError;
    elements.revisionStatus.dataset.status = "error";
  } finally {
    finishSubmission();
  }
});

elements.revisionQuestionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (hasPendingRequest() || !canEditStage("prototype") || elements.submitClarification.disabled) return;
  const question = currentState.prototypeReview?.question;
  if (!question) return;
  const selected = elements.revisionQuestionChoices.querySelector(
    'input[name="revision-clarification"]:checked',
  );
  const detail = elements.revisionQuestionDetail.value.trim();
  const answer = detail || selected?.value || "";
  const key = elements.revisionQuestionForm.dataset.draftKey;
  saveFormDraft(elements.revisionQuestionForm);
  const version = formDrafts.get(key)?.version;
  if (!answer) {
    elements.revisionStatus.textContent =
      "Choose an option or enter clarification.";
    elements.revisionStatus.dataset.status = "error";
    return;
  }
  submitting = true;
  elements.submitClarification.disabled = true;
  elements.submitClarification.textContent = "Sending...";
  elements.revisionStatus.textContent = "";
  try {
    await postJson("/api/answer", {
        questionId: question.id,
        answer,
        action: "clarify-revision",
    });
    clearAcceptedDraft(key, version);
  } catch (error) {
    elements.revisionStatus.textContent = error instanceof Error
      ? error.message
      : "Could not submit clarification.";
    elements.revisionStatus.dataset.status = "error";
  } finally {
    finishSubmission();
  }
});

function reviewRequestDetails() {
  const value = elements.reviewRequestKind.value;
  return value === "question"
    ? { type: "question", artifactKind: null, label: "Ask question" }
    : { type: "artifact", artifactKind: value, label: "Generate artifact" };
}

elements.reviewRequestKind.addEventListener("change", () => {
  const request = reviewRequestDetails();
  elements.reviewSubmit.textContent = request.label;
  elements.designReviewInput.placeholder = request.type === "question"
    ? "Ask about the design, tradeoffs, behavior, or risks."
    : request.artifactKind === "diagram"
      ? "Describe the architecture, sequence, state, or workflow diagram to generate."
      : request.artifactKind === "contract"
        ? "Describe the UI-facing boundary or contract to clarify."
        : request.artifactKind === "test-scenario"
          ? "Describe the integration boundary or user interaction scenario to test."
          : "Describe the design decision and tradeoff to record.";
});

elements.designReviewForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (hasPendingRequest() || !canEditStage("design")) return;
  const draft = captureInput(elements.designReviewInput);
  const prompt = draft.value.trim();
  const key = elements.designReviewForm.dataset.draftKey;
  saveFormDraft(elements.designReviewForm);
  const version = formDrafts.get(key)?.version;
  const artifact = (currentState.artifacts || []).find(
    (candidate) => candidate.id === selectedArtifactId,
  );
  if (!artifact || artifact.stage !== "design") {
    elements.designReviewStatus.textContent =
      "Select a Design artifact before starting a review.";
    elements.designReviewStatus.dataset.status = "error";
    return;
  }
  if (!prompt) {
    elements.designReviewStatus.textContent =
      "Enter a design question or artifact request.";
    elements.designReviewStatus.dataset.status = "error";
    return;
  }
  const request = reviewRequestDetails();
  submitting = true;
  elements.reviewSubmit.disabled = true;
  elements.reviewSubmit.textContent = "Queueing...";
  elements.designReviewStatus.textContent = "";
  try {
    await postJson("/api/design-review", {
        prompt,
        type: request.type,
        artifactKind: request.artifactKind,
        artifactId: artifact.id,
    });
    clearAcceptedDraft(key, version);
    if (elements.designReviewForm.dataset.draftKey === key) {
      clearAcceptedInput(elements.designReviewInput, draft);
    }
  } catch (error) {
    elements.designReviewStatus.textContent = error instanceof Error
      ? error.message
      : "Could not queue this review request.";
    elements.designReviewStatus.dataset.status = "error";
  } finally {
    finishSubmission();
  }
});

elements.finishReview.addEventListener("click", async () => {
  if (hasPendingRequest() || elements.finishReview.disabled || !canEditStage("design")) return;
  submitting = true;
  elements.finishReview.disabled = true;
  elements.finishReview.textContent = "Capturing review...";
  elements.designReviewStatus.textContent = "";
  try {
    await postJson("/api/design-review/finalize", {});
  } catch (error) {
    elements.designReviewStatus.textContent = error instanceof Error
      ? error.message
      : "Could not finish the design review.";
    elements.designReviewStatus.dataset.status = "error";
  } finally {
    finishSubmission();
  }
});

async function submitPlanRequest(action, instruction) {
  if (hasPendingRequest() || !canEditStage("plan") || currentState.planning?.processing) return false;
  const maxAgents = Math.max(
    1,
    Math.min(30, Number.parseInt(elements.planMaxAgents.value, 10) || 4),
  );
  submitting = true;
  elements.planStatus.textContent = "";
  elements.planStatus.dataset.status = "idle";
  render(currentState, true);
  try {
    await postJson("/api/plan/generate", { action, instruction, maxAgents });
    return true;
  } catch (error) {
    elements.planStatus.textContent = error instanceof Error
      ? error.message
      : "Could not generate the execution plan.";
    elements.planStatus.dataset.status = "error";
    return false;
  } finally {
    finishSubmission();
  }
}

elements.generatePlan.addEventListener("click", () => {
  const hasPlan = (currentState?.planning?.workItems || []).length > 0;
  submitPlanRequest(
    hasPlan ? "revise" : "generate",
    hasPlan
      ? "Regenerate the complete plan for the selected agent limit while preserving accepted design scope."
      : "",
  );
});

elements.optimizePlan.addEventListener("click", () => {
  submitPlanRequest(
    "revise",
    "Reduce unnecessary dependencies and file ownership conflicts, widen safe parallel frontiers, balance agent workload, and shorten scheduled elapsed time without dropping scope or validation.",
  );
});

elements.planRevisionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const draft = captureInput(elements.planRevisionInput);
  const instruction = draft.value.trim();
  if (!instruction) {
    elements.planStatus.textContent = "Describe how the plan should change.";
    elements.planStatus.dataset.status = "error";
    return;
  }
  if (await submitPlanRequest("revise", instruction)) {
    clearAcceptedInput(elements.planRevisionInput, draft);
  }
});

elements.finalizePlan.addEventListener("click", async () => {
  if (hasPendingRequest() || elements.finalizePlan.disabled || !canEditStage("plan")) return;
  submitting = true;
  elements.finalizePlan.disabled = true;
  elements.finalizePlan.textContent = "Finalizing...";
  elements.planStatus.textContent = "";
  try {
    await postJson("/api/plan/finalize", {});
  } catch (error) {
    elements.planStatus.textContent = error instanceof Error
      ? error.message
      : "Could not finalize the execution plan.";
    elements.planStatus.dataset.status = "error";
  } finally {
    finishSubmission();
  }
});

elements.startImplementation.addEventListener("click", async () => {
  if (hasPendingRequest() || !canEditStage("implement") || elements.startImplementation.disabled) return;
  implementationSubmitting = true;
  elements.implementationStatus.textContent = "Starting agents...";
  elements.implementationStatus.dataset.status = "idle";
  render(currentState, true);
  try {
    await postJson("/api/implementation/start", {});
    elements.implementationStatus.textContent =
      "Implementation agents are starting.";
  } catch (error) {
    elements.implementationStatus.textContent = error instanceof Error
      ? error.message
      : "Could not start implementation.";
    elements.implementationStatus.dataset.status = "error";
  } finally {
    implementationSubmitting = false;
    if (currentState) render(currentState, true);
  }
});

elements.stopImplementation.addEventListener("click", async () => {
  if (hasPendingRequest() || !canEditStage("implement") || elements.stopImplementation.disabled) return;
  implementationSubmitting = true;
  elements.implementationStatus.textContent = "Stopping agents...";
  elements.implementationStatus.dataset.status = "idle";
  render(currentState, true);
  try {
    await postJson("/api/implementation/stop", {});
  } catch (error) {
    elements.implementationStatus.textContent = error instanceof Error
      ? error.message
      : "Could not stop implementation.";
    elements.implementationStatus.dataset.status = "error";
  } finally {
    implementationSubmitting = false;
    if (currentState) render(currentState, true);
  }
});

elements.implementationStrategyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (hasPendingRequest() || !canEditStage("implement") || elements.submitImplementationStrategy.disabled) return;
  const draft = captureInput(elements.implementationStrategyInput);
  const text = draft.value.trim();
  if (!text) {
    elements.implementationStatus.textContent =
      "Describe how the execution strategy should change.";
    elements.implementationStatus.dataset.status = "error";
    return;
  }
  implementationSubmitting = true;
  elements.submitImplementationStrategy.disabled = true;
  elements.submitImplementationStrategy.textContent = "Queueing...";
  elements.implementationStatus.textContent = "";
  try {
    await postJson("/api/implementation/strategy", { text });
    clearAcceptedInput(elements.implementationStrategyInput, draft);
  } catch (error) {
    elements.implementationStatus.textContent = error instanceof Error
      ? error.message
      : "Could not queue this adjustment.";
    elements.implementationStatus.dataset.status = "error";
  } finally {
    implementationSubmitting = false;
    if (currentState) render(currentState, true);
  }
});

elements.startTests.addEventListener("click", async () => {
  if (hasPendingRequest() || !canEditStage("test", currentState, true) || elements.startTests.disabled) return;
  testSubmitting = true;
  elements.testStatus.textContent = "Starting test agents...";
  elements.testStatus.dataset.status = "idle";
  render(currentState, true);
  try {
    await postJson("/api/test/start", {});
    elements.testStatus.textContent = "Test agents are starting.";
  } catch (error) {
    elements.testStatus.textContent = error instanceof Error
      ? error.message
      : "Could not start tests.";
    elements.testStatus.dataset.status = "error";
  } finally {
    testSubmitting = false;
    if (currentState) render(currentState, true);
  }
});

elements.testErrorToggle.addEventListener("click", () => {
  testErrorDetailsExpanded = !testErrorDetailsExpanded;
  elements.testErrorToggle.setAttribute(
    "aria-expanded",
    String(testErrorDetailsExpanded),
  );
  elements.testErrorToggle.textContent = testErrorDetailsExpanded
    ? "Hide error details"
    : "Show error details";
  elements.testErrorDetails.hidden = !testErrorDetailsExpanded;
  if (testErrorDetailsExpanded) elements.testErrorDetails.focus();
});

elements.retryPreparation.addEventListener("click", async () => {
  if (hasPendingRequest() || !canEditStage("prepare") || currentState.preparation?.status !== "failed" || hasActiveJobs(currentState)) return;
  preparationSubmitting = true;
  elements.retryPreparation.disabled = true;
  elements.retryPreparation.textContent = "Retrying...";
  elements.preparationStageMessage.textContent = "";
  elements.preparationStageMessage.dataset.status = "idle";
  try {
    await postJson("/api/preparation/retry", {});
    elements.preparationStageMessage.textContent = "Preparation retry started.";
  } catch (error) {
    elements.preparationStageMessage.textContent = error instanceof Error
      ? error.message
      : "Could not retry preparation.";
    elements.preparationStageMessage.dataset.status = "error";
  } finally {
    preparationSubmitting = false;
    if (currentState) render(currentState, true);
  }
});

elements.completeStage.addEventListener("click", async () => {
  if (hasPendingRequest() || elements.completeStage.disabled || !currentState) return;
  const stageId = currentStage();
  if (stageId === "prepare" || skippedStage(currentState, stageId)) return;
  completingStage = true;
  elements.completeStage.disabled = true;
  elements.completeStage.textContent = "Saving stage output...";
  elements.stageMessage.textContent = "";
  elements.stageMessage.dataset.status = "idle";
  try {
    const result = await postJson("/api/stage/complete", { stageId });
    if (result.accepted) {
      elements.stageMessage.textContent =
        "Collecting evidence and generating the draft feature specification...";
      elements.stageMessage.dataset.status = "idle";
    }
  } catch (error) {
    elements.stageMessage.textContent = error instanceof Error
      ? error.message
      : "Could not complete this stage.";
    elements.stageMessage.dataset.status = "error";
  } finally {
    completingStage = false;
    if (currentState) render(currentState, true);
  }
});

elements.startPrototype.addEventListener("click", async () => {
  if (hasPendingRequest() || !canEditStage("prototype") || hasActiveJobs(currentState)
    || elements.startPrototype.hidden || elements.startPrototype.disabled) return;
  prototypeSubmitting = true;
  elements.prototypeBuildStatus.textContent = currentState.prototypeApproach?.mode === "validate-existing"
    ? "Requesting validation of the existing prototype..."
    : "Requesting prototype build...";
  elements.prototypeBuildStatus.dataset.status = "idle";
  render(currentState, true);
  try {
    await postJson("/api/prototype/start", {});
  } catch (error) {
    elements.prototypeBuildStatus.textContent = error instanceof Error ? error.message : "Could not start the prototype.";
    elements.prototypeBuildStatus.dataset.status = "error";
  } finally {
    prototypeSubmitting = false;
    if (currentState) render(currentState, true);
  }
});

async function submitPrototypeAction(action, button) {
  if (hasPendingRequest() || !canEditStage("prototype") || hasActiveJobs(currentState)
    || prototypeFinalizing(currentState) || button.hidden || button.disabled) return;
  const flow = currentState.prototypeFlow;
  if (!flow && (action !== "retry" || !failedPrototypeRevision(currentState))) return;
  if (action === "extend-budget" && !window.confirm(
    "Add another 15-minute AI work window and retry paused prototype work? Your current preview and queued feedback will be kept.",
  )) return;
  const checkpointId = action === "apply-update" ? flow?.pendingCheckpointId
    : action === "retry" ? failedPrototypeCheckpoint(currentState)?.id : null;
  if (action === "apply-update" && !checkpointId) return;
  const identity = { prototypeId: currentState.prototypeId, generation: currentState.generation };
  const displayedCheckpointId = flow?.displayedCheckpointId;
  const oldUrl = elements.previewFrame.dataset.url;
  prototypeSubmitting = true;
  prototypeActionError = "";
  elements.prototypeActionStatus.textContent = action === "apply-update"
    ? "Applying update; preserving supported preview state..."
    : action === "skip-visual" ? "Skipping optional visual direction..." : "Requesting prototype work...";
  elements.prototypeActionStatus.dataset.status = "idle";
  render(currentState, true);
  try {
    const captured = action === "apply-update" ? await capturePreviewState() : undefined;
    if (currentState.prototypeId !== identity.prototypeId || currentState.generation !== identity.generation) {
      throw new Error("The effort changed. Review the current prototype before retrying.");
    }
    if (action === "apply-update" && (currentState.prototypeFlow?.pendingCheckpointId !== checkpointId
      || currentState.prototypeFlow?.displayedCheckpointId !== displayedCheckpointId
      || elements.previewFrame.dataset.url !== oldUrl)) {
      throw new Error("The update changed. Review the latest update before applying it.");
    }
    if (captured) previewRestore = { ...identity, checkpointId, state: captured.state };
    await postJson("/api/prototype/action", {
      action, ...(checkpointId ? { checkpointId } : {}), expectedRevision: currentState.revision,
    });
    elements.prototypeActionStatus.textContent = "";
  } catch (error) {
    previewRestore = null;
    prototypeActionError = error instanceof Error ? error.message : "Could not update the prototype.";
    elements.prototypeActionStatus.textContent = prototypeActionError;
    elements.prototypeActionStatus.dataset.status = "error";
  } finally {
    prototypeSubmitting = false;
    if (currentState) render(currentState, true);
  }
}

elements.applyPrototypeUpdate.addEventListener("click", () =>
  submitPrototypeAction("apply-update", elements.applyPrototypeUpdate));
elements.requestPrototypeVisual.addEventListener("click", () =>
  submitPrototypeAction("visual", elements.requestPrototypeVisual));
elements.skipPrototypeVisual.addEventListener("click", () =>
  submitPrototypeAction("skip-visual", elements.skipPrototypeVisual));
elements.retryPrototypeCheckpoint.addEventListener("click", () =>
  submitPrototypeAction("retry", elements.retryPrototypeCheckpoint));
elements.extendPrototypeBudget.addEventListener("click", () =>
  submitPrototypeAction("extend-budget", elements.extendPrototypeBudget));

elements.reopenStage.addEventListener("click", async () => {
  if (hasPendingRequest() || !currentState || elements.reopenStage.disabled || elements.reopenStage.hidden) return;
  const stageId = viewedStageId;
  if (skippedStage(currentState, stageId)) return;
  const label = LIFECYCLE_STAGES.find((stage) => stage.id === stageId)?.label;
  if (!window.confirm(
    `Reopen ${label}? Its outputs and dependent stage outputs will be marked stale. `
      + "Saved evidence is retained, but affected stages must be completed again.",
  )) return;
  if (hasActiveJobs(currentState)) return;
  reopeningStage = true;
  elements.stageMessage.textContent = "Reopening " + label + "...";
  elements.stageMessage.dataset.status = "idle";
  render(currentState, true);
  try {
    await postJson("/api/stage/reopen", { stageId });
    viewedStageId = stageId;
    activeOutputTab = stageTab(stageId);
  } catch (error) {
    elements.stageMessage.textContent = error instanceof Error ? error.message : "Could not reopen this stage.";
    elements.stageMessage.dataset.status = "error";
  } finally {
    reopeningStage = false;
    if (currentState) render(currentState, true);
  }
});

function activateOutputTab(tabName, focusTab = false) {
  const requestedTab = [
    "preparation",
    "preview",
    "design-tree",
    "design-review",
    "plan",
    "implementation",
    "test",
    "content",
  ].includes(tabName)
    ? tabName
    : "preparation";
  const requestedElement = elements.previewTabs.find(
    (tab) => tab.dataset.tab === requestedTab,
  );
  activeOutputTab = requestedElement?.disabled || requestedElement?.hidden
    ? elements.previewTabs.find((tab) => !tab.hidden && !tab.disabled)?.dataset.tab
      || "preparation"
    : requestedTab;
  viewedStageId = {
    preparation: "prepare", preview: "prototype", "design-tree": "requirements", "design-review": "design",
    plan: "plan", implementation: "implement", test: "test",
  }[activeOutputTab] || (currentState?.artifacts || []).find(
    (artifact) => artifact.id === selectedArtifactId,
  )?.stage || currentStage();
  for (const tab of elements.previewTabs) {
    const isActive = tab.dataset.tab === activeOutputTab;
    const wasActive = tab.getAttribute("aria-selected") === "true";
    tab.setAttribute("aria-selected", String(isActive));
    tab.tabIndex = isActive ? 0 : -1;
    if (isActive && focusTab) tab.focus();
    if (isActive && (focusTab || !wasActive)) {
      tab.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    }
  }
  elements.preparationPanel.hidden = activeOutputTab !== "preparation";
  elements.previewPanel.hidden = activeOutputTab !== "preview";
  elements.designTreePanel.hidden = activeOutputTab !== "design-tree";
  elements.designReviewPanel.hidden = activeOutputTab !== "design-review";
  elements.planPanel.hidden = activeOutputTab !== "plan";
  elements.implementationPanel.hidden = activeOutputTab !== "implementation";
  elements.testPanel.hidden = activeOutputTab !== "test";
  elements.contentPanel.hidden = activeOutputTab !== "content";
  elements.previewTools.hidden = activeOutputTab !== "preview";
  document.body.classList.toggle("prototype-view", activeOutputTab === "preview");
  if (currentState) {
    renderBrowsingState(currentState);
    renderNextAction(currentState);
  }
  speechInputs.sync();
}

for (const tab of elements.previewTabs) {
  tab.addEventListener("click", () => activateOutputTab(tab.dataset.tab));
  tab.addEventListener("keydown", (event) => {
    const visibleTabs = elements.previewTabs.filter(
      (candidate) => !candidate.hidden && !candidate.disabled,
    );
    const currentIndex = visibleTabs.indexOf(tab);
    let nextIndex = null;
    if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + visibleTabs.length) % visibleTabs.length;
    } else if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % visibleTabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = visibleTabs.length - 1;
    }
    if (nextIndex === null) return;
    activateOutputTab(visibleTabs[nextIndex].dataset.tab, true);
    event.preventDefault();
  });
}

function renderBrowsingState(state) {
  const active = currentStage(state);
  const viewed = viewedStageId || active;
  const label = LIFECYCLE_STAGES.find((stage) => stage.id === viewed)?.label || viewed;
  const skipped = skippedStage(state, viewed);
  const readOnly = Boolean(skipped) || viewed !== active || (state.lifecycle?.completedStages || []).includes(viewed);
  elements.stageBrowsing.textContent = skipped
    ? `${label} is not applicable. ${skipped.reason} Reopen Requirements to change prototype applicability.`
    : readOnly
    ? `Viewing ${label} · read only. Reopen explicitly to change its scope.`
    : "";
  elements.completeStage.hidden = viewed !== active || Boolean(skipped);
  elements.reopenStage.hidden = Boolean(skipped) || !readOnly
    || LIFECYCLE_STAGES.findIndex((stage) => stage.id === viewed)
      > LIFECYCLE_STAGES.findIndex((stage) => stage.id === active);
  elements.reopenStage.textContent = reopeningStage ? "Reopening..." : "Reopen " + label;
  elements.reopenStage.disabled = reopeningStage || completingStage || submitting
    || prototypeSubmitting || preparationSubmitting || implementationSubmitting || testSubmitting
    || state.provider?.canSubmitAnswers === false || hasActiveJobs(state);
  for (const button of elements.stageList.querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(button.dataset.stageId === viewed));
  }
}

function renderLifecycle(state, preserveMessage = false) {
  const lifecycle = state.lifecycle || {
    currentStage: "prepare",
    completedStages: [],
    outputs: [],
    skippedStages: [],
  };
  const completed = new Set(lifecycle.completedStages || []);
  const skipped = new Map<string, AnyRecord>(
    (lifecycle.skippedStages || []).map(
      (entry): [string, AnyRecord] => [entry.stageId, entry],
    ),
  );
  const outputs = new Map<string, AnyRecord>(
    [...(lifecycle.history || []), ...(lifecycle.outputs || [])].map(
      (output): [string, AnyRecord] => [output.stageId, output],
    ),
  );
  const hasFinalCodeArtifact = (state.artifacts || []).some(
    (artifact) =>
      artifact.id === "final-code" &&
      artifact.kind === "final-code" &&
      artifact.stage === "implement" &&
      artifact.path &&
      artifact.reviewStatus !== "stale",
  );
  const allComplete = LIFECYCLE_STAGES.every((stage) => completed.has(stage.id) || Boolean(skippedStage(state, stage.id)));
  const currentStageId = lifecycle.currentStage || "prepare";
  const currentIndex = Math.max(
    0,
    LIFECYCLE_STAGES.findIndex((stage) => stage.id === currentStageId),
  );
  const currentDefinition = LIFECYCLE_STAGES[currentIndex];

  elements.stageList.replaceChildren();
  LIFECYCLE_STAGES.forEach((stage, index) => {
    const isComplete = completed.has(stage.id);
    const configuredSkip = stage.id === "prototype"
      && state.prototypeApproach?.mode === "not-applicable";
    const skippedEntry = skipped.get(stage.id)
      || (configuredSkip
        ? {
            stageId: "prototype",
            reason: state.prototypeApproach?.reason
              || "No graphical interface needs prototype validation.",
          }
        : null);
    const isSkipped = Boolean(skippedEntry);
    const isActive = stage.id === currentStageId && !allComplete;
    const status = isSkipped
      ? "not applicable"
      : isComplete
        ? "complete"
        : isActive
          ? "active"
          : "locked";
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.className = "stage-step";
    button.type = "button";
    button.dataset.uiKey = "stage:" + stage.id;
    button.dataset.stageId = stage.id;
    button.dataset.status = status;
    button.disabled = isSkipped || (status === "locked" && !hasStageData(state, stage.id));
    button.setAttribute("aria-current", String(isActive));
    if (isSkipped) {
      button.title = skippedEntry.reason;
      button.setAttribute(
        "aria-label",
        `${stage.label}, not applicable. ${skippedEntry.reason}`,
      );
    }

    const number = document.createElement("span");
    number.className = "stage-step-index";
    number.textContent = isComplete ? "\u2713" : String(index + 1);
    number.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.className = "stage-step-label";
    label.textContent = stage.label;
    const statusLabel = document.createElement("span");
    statusLabel.className = "stage-step-status";
    statusLabel.textContent = status;
    button.append(number, label, statusLabel);

    const output = outputs.get(stage.id);
    if (output && !isSkipped) button.title = output.path;
    button.addEventListener("click", () => browseStage(stage.id));
    item.append(button);
    if (isSkipped) {
      const hint = document.createElement("p");
      hint.className = "stage-step-hint";
      hint.textContent = skippedEntry.reason;
      item.append(hint);
    }
    elements.stageList.append(item);
  });

  elements.currentStageIndex.textContent = String(currentIndex + 1);
  elements.stage.textContent = currentDefinition.label;
  elements.contextStage.textContent = currentDefinition.label;
  elements.currentStage.setAttribute(
    "aria-label",
    "Current lifecycle stage: " + currentDefinition.label,
  );
  elements.completeStage.disabled = completingStage
    || reopeningStage || submitting || prototypeSubmitting
    || preparationSubmitting || implementationSubmitting || testSubmitting
    || allComplete
    || currentStageId === "prepare"
    || state.provider?.canSubmitAnswers === false
    || state.processing?.status === "running"
    || (
      currentStageId === "prototype"
      && (
        state.previewStatus !== "ready"
        || state.prototypeApproach?.mode === "undecided"
        || Boolean(skippedStage(state, "prototype"))
        || Boolean(state.prototypeReview?.question)
        || prototypeCompletionBlocked(state)
      )
    )
    || (
      currentStageId === "requirements"
      && (
        state.preparation?.status === "not-started"
        || state.prototypeApproach?.mode === "undecided"
        || state.requirements?.substage !== "dag"
        || !Array.isArray(state.decisionGraph?.nodes)
        || state.decisionGraph.nodes.length === 0
        || state.decisionGraph.nodes.some((node) => !node.answer)
      )
    )
    || (
      currentStageId === "design"
      && (
        !["design-spec", "design-review"].includes(
          state.designReview?.finalizedArtifactId,
        )
        || Boolean(state.designReview?.processing)
        || Boolean(state.designReview?.finalizeRequested)
        || (state.designReview?.threads || []).some(
          (thread) => thread.status !== "resolved",
        )
        || state.testDesignReview?.finalizedArtifactId !== "test-spec"
        || Boolean(state.testDesignReview?.processing)
        || Boolean(state.testDesignReview?.finalizeRequested)
        || (state.testDesignReview?.threads || []).some(
          (thread) => thread.status !== "resolved",
        )
      )
    )
    || (
      currentStageId === "plan"
      && (
        state.planning?.status !== "complete"
        || state.planning?.finalizedArtifactId !== "execution-plan"
        || Boolean(state.planning?.processing)
      )
    )
    || (
      currentStageId === "implement"
      && (
        state.implementation?.status !== "completed"
        || state.implementation?.finalizedArtifactId !== "final-code"
        || !hasFinalCodeArtifact
        || (state.implementation?.workItems || []).some(
          (item) => item.status !== "completed",
        )
      )
    )
    || (
      currentStageId === "test"
      && (
        state.testing?.status !== "completed"
        || state.testing?.finalizedArtifactId !== "test-results"
        || (state.testing?.scenarios || []).some(
          (scenario) => scenario.status !== "passed",
        )
      )
    );
  elements.completeStage.textContent = allComplete
    ? "All stages complete"
    : completingStage
      ? "Saving stage output..."
      : currentStageId === "prepare"
        ? "Preparation runs automatically"
      : state.processing?.status === "running"
          && state.processing?.action === "generate-design-spec"
        ? "Generating draft feature spec..."
      : "Finish " + currentDefinition.label.toLowerCase();

  if (!preserveMessage) {
    const latestOutput = [...(lifecycle.outputs || [])].pop();
    const prototypeSkip = skipped.get("prototype")
      || (
        state.prototypeApproach?.mode === "not-applicable"
          ? state.prototypeApproach
          : null
      );
    elements.stageMessage.textContent = prototypeSkip
        && (!latestOutput || latestOutput.stageId === "prototype")
      ? "Prototype disabled: " + prototypeSkip.reason
      : latestOutput
        ? "Saved " + latestOutput.path
        : currentStageId === "prepare"
          ? "Preparation advances automatically when analysis completes."
          : "Complete the active stage to unlock the next.";
    elements.stageMessage.dataset.status = "idle";
  }
  renderBrowsingState(state);
}

function renderPreparation(state, preserveMessage = false) {
  const preparation = state.preparation || {
    status: "not-started",
    summary: "",
    workItems: [],
    messages: [],
    checks: [],
    sources: [],
    suggestedUsages: [],
    error: "",
  };
  const runtime = state.preparationRuntime || null;
  const isPreparing = ["not-started", "starting", "running"].includes(
    preparation.status,
  );
  const currentStage = state.lifecycle?.currentStage || "prepare";
  elements.requirementsTab.disabled = currentStage === "prepare";
  elements.requirementsTab.title = currentStage === "prepare"
    ? "Requirements unlock when preparation completes."
    : "";
  elements.preparationStageStatus.textContent =
    preparation.status.replace("-", " ");
  elements.preparationStageStatus.dataset.status = preparation.status;
  elements.preparationStageTitle.textContent = isPreparing
    ? "Preparing Tandem context"
    : preparation.status === "failed"
      ? "Preparation needs attention"
      : "Preparation results";
  elements.preparationStageProgress.textContent = runtime?.currentPhase
    ? "Current phase: " + runtime.currentPhase.split("-").join(" ")
    : isPreparing
      ? state.status || "Preparation is starting."
      : preparation.status === "failed"
        ? preparation.error || "Preparation stopped before completion. Retry to continue."
        : preparation.summary || "Preparation has completed.";

  const liveByWorkItem = new Map<string, AnyRecord>(
    (runtime?.agents || []).map(
      (agent): [string, AnyRecord] => [
        String(agent.label || "").replace(/^prepare:/, ""),
        agent,
      ],
    ),
  );
  elements.preparationWorkItems.replaceChildren();
  for (const workItem of preparation.workItems || []) {
    const live = liveByWorkItem.get(workItem.id) || {};
    const status = live.status === "running" ? "running" : workItem.status;
    const card = document.createElement("div");
    card.className = "implementation-card";
    card.dataset.status = status;
    const heading = document.createElement("div");
    heading.className = "implementation-card-heading";
    const title = document.createElement("strong");
    title.textContent = workItem.title;
    const badge = document.createElement("span");
    badge.className = "implementation-badge";
    badge.textContent = status;
    heading.append(title, badge);
    const detail = document.createElement("p");
    detail.className = "implementation-meta";
    detail.textContent = workItem.detail;
    card.append(heading, detail);
    if (live.activity || workItem.result) {
      const result = document.createElement("p");
      result.textContent = live.activity || workItem.result;
      card.append(result);
    }
    elements.preparationWorkItems.append(card);
  }
  if ((preparation.workItems || []).length === 0) {
    appendImplementationEmpty(
      elements.preparationWorkItems,
      "Preparation work items will appear when analysis starts.",
    );
  }

  elements.preparationResultSummary.textContent = preparation.summary
    || "Results will appear as preparation completes.";
  elements.preparationResultSummary.classList.toggle(
    "muted",
    !preparation.summary,
  );
  elements.preparationResultChecks.replaceChildren();
  elements.preparationResultSuggestions.replaceChildren();
  if ((preparation.suggestedUsages || []).length > 0) {
    const heading = document.createElement("strong");
    heading.textContent = "Passed to Requirements";
    const list = document.createElement("ul");
    appendPlanList(list, preparation.suggestedUsages, "No suggestions generated.");
    elements.preparationResultSuggestions.append(heading, list);
  }
  for (const check of preparation.checks || []) {
    const item = document.createElement("div");
    item.className = "preparation-result-item";
    item.dataset.status = check.status;
    const label = document.createElement("strong");
    label.textContent = check.label + " · " + check.status;
    const detail = document.createElement("span");
    detail.textContent = check.detail;
    item.append(label, detail);
    elements.preparationResultChecks.append(item);
  }
  elements.preparationResultSources.replaceChildren();
  for (const source of preparation.sources || []) {
    const link = document.createElement("a");
    link.href = source.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = source.title;
    link.dataset.uiKey = "preparation-source:" + source.url;
    link.title = source.purpose || source.url;
    elements.preparationResultSources.append(link);
  }

  const progressMessages = [
    ...(preparation.messages || []).map((message) => ({
      id: message.id,
      text: message.text,
      kind: message.kind,
      at: Date.parse(message.at) || 0,
    })),
    ...(runtime?.progress || []).map((message) => ({
      id: "runtime-" + message.seq,
      text: message.text,
      kind: message.kind || "info",
      at: Number(message.recordedAt) || 0,
    })),
  ].sort((left, right) => right.at - left.at).slice(0, 30);
  elements.preparationMessages.replaceChildren();
  for (const message of progressMessages) {
    const card = document.createElement("div");
    card.className = "implementation-event";
    card.dataset.status = message.kind;
    const heading = document.createElement("div");
    heading.className = "implementation-event-heading";
    const text = document.createElement("p");
    text.textContent = message.text;
    const time = document.createElement("time");
    time.textContent = message.at
      ? new Date(message.at).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })
      : "";
    heading.append(text, time);
    card.append(heading);
    elements.preparationMessages.append(card);
  }
  if (progressMessages.length === 0) {
    appendImplementationEmpty(
      elements.preparationMessages,
      "Preparation progress will appear here.",
    );
  }

  const canSubmit = canEditStage("prepare", state);
  elements.retryPreparation.hidden = preparation.status !== "failed" || currentStage !== "prepare";
  elements.retryPreparation.disabled = hasPendingRequest() || !canSubmit || hasActiveJobs(state);
  elements.retryPreparation.textContent = preparationSubmitting
    ? "Retrying..."
    : "Retry preparation";
  if (!preserveMessage) {
    elements.preparationStageMessage.textContent = preparation.error
    || (preparation.status === "needs-attention"
      ? "Preparation completed with blockers. Requirements suggestions are still available."
      : preparation.status === "ready"
        ? "Preparation completed and its suggestions were passed to Requirements."
        : "");
    elements.preparationStageMessage.dataset.status =
      preparation.status === "failed" ? "error" : "idle";
  }
}

function renderRequirementsSubstage(state, preserveMessage = false) {
  const isRequirements =
    (state.lifecycle?.currentStage || "requirements") === "requirements";
  elements.requirementsSubstageSection.hidden = !isRequirements;
  if (!isRequirements) return;

  const requirements = state.requirements || {
    substage: decisionNodesForState(state).length > 0 ? "dag" : "usage",
    usageItems: [],
    suggestions: [],
  };
  const isUsage = requirements.substage !== "dag";
  elements.usageSubstage.dataset.status = isUsage ? "active" : "complete";
  elements.dagSubstage.dataset.status = isUsage ? "locked" : "active";
  elements.usageIntake.hidden = !isUsage;

  const usageItems = Array.isArray(requirements.usageItems)
    ? requirements.usageItems
    : [];
  elements.usageItems.replaceChildren();
  if (usageItems.length === 0) {
    const empty = document.createElement("li");
    empty.className = "muted";
    empty.textContent = "No usages added yet.";
    elements.usageItems.append(empty);
  } else {
    usageItems.forEach((usage, index) => {
      const item = document.createElement("li");
      item.className = "usage-item";
      item.textContent = (index + 1) + ". " + usage;
      elements.usageItems.append(item);
    });
  }

  const suggestions = Array.isArray(requirements.suggestions)
    ? requirements.suggestions
    : [];
  elements.usageSuggestions.replaceChildren();
  const processing = state.processing?.status === "running" || submitting;
  const dagFailed = state.processing?.action === "generate-dag" && state.processing.status === "error";
  const suggestionsLoading =
    state.suggestionProcessing?.status === "running";
  elements.usageSuggestionArea.hidden =
    suggestions.length === 0 && !suggestionsLoading;
  if (suggestionsLoading && suggestions.length === 0) {
    const loading = document.createElement("li");
    loading.className = "muted";
    loading.textContent = "Generating AI suggestions...";
    elements.usageSuggestions.append(loading);
  }
  const canSubmit = canEditStage("requirements", state);
  for (const suggestion of suggestions) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.className = "usage-suggestion";
    button.type = "button";
    button.textContent = "+ " + suggestion;
    button.disabled = processing || !canSubmit;
    button.addEventListener("click", () => {
      submitRequirementAction("add-usage", suggestion);
    });
    item.append(button);
    elements.usageSuggestions.append(item);
  }

  elements.usageInput.disabled = processing || !canSubmit;
  elements.addUsage.disabled = processing || !canSubmit;
  elements.generateDag.disabled =
    processing || !canSubmit || usageItems.length === 0;
  elements.addUsage.textContent = processing ? "Working..." : "Add usage";
  elements.generateDag.textContent =
    state.processing?.action === "generate-dag" && state.processing.status === "running"
      ? "Generating DAG..."
      : dagFailed ? "Retry requirements DAG" : "Generate requirements DAG";

  if (!preserveMessage || (dagFailed && !processing)) {
    elements.usageMessage.textContent = !canSubmit
      ? "Open the installed user-scoped Tandem to edit requirements."
      : dagFailed && !processing
        ? (state.processing.message || "The requirements DAG could not be generated.")
          + " Your usages are saved. Retry requirements DAG to continue."
      : processing
        ? state.status || "Updating requirements..."
        : suggestionsLoading
          ? usageItems.length === 0
            ? "Starter suggestions are loading; you can add a usage now."
            : "Usage saved. Suggestions are refreshing; you can keep adding usages."
        : isUsage
          ? usageItems.length === 0
            ? "Add the first usage to receive AI suggestions."
            : "Add another usage or generate the decision DAG."
          : "Usage collection is complete. Work through the dynamic DAG.";
    elements.usageMessage.dataset.status = dagFailed && !processing ? "error" : "idle";
  }
}

function setList(element, values) {
  element.replaceChildren();
  if (!Array.isArray(values) || values.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty-item";
    empty.textContent = "None yet";
    element.append(empty);
    return;
  }

  for (const value of values) {
    const item = document.createElement("li");
    item.textContent = value;
    element.append(item);
  }
}

function loadMermaid() {
  if (!mermaidModulePromise) {
    mermaidModulePromise = import(
      // @ts-expect-error The canvas loads Mermaid directly in the browser.
      "https://cdn.jsdelivr.net/npm/mermaid@11.17.2/dist/mermaid.esm.min.mjs"
    )
      .then((module) => {
        const mermaid = module.default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          suppressErrorRendering: true,
          theme: document.documentElement.dataset.colorMode === "dark"
            ? "dark"
            : "default",
          flowchart: {
            htmlLabels: false,
            useMaxWidth: true,
          },
        });
        return mermaid;
      })
      .catch((error) => {
        mermaidModulePromise = null;
        throw error;
      });
  }
  return mermaidModulePromise;
}

function diagramNaturalWidth(svg) {
  const viewBox = String(svg.getAttribute("viewBox") || "")
    .trim()
    .split(/\s+/)
    .map(Number);
  if (viewBox.length === 4 && Number.isFinite(viewBox[2]) && viewBox[2] > 0) {
    return viewBox[2];
  }
  const width = Number.parseFloat(svg.getAttribute("width") || "");
  return Number.isFinite(width) && width > 0 ? width : 800;
}

function updateDiagramToolbar(host, label) {
  const toolbar = host.previousElementSibling;
  if (!toolbar?.classList.contains("diagram-toolbar")) return;
  const output = toolbar.querySelector(".diagram-toolbar-output");
  if (output) output.textContent = label;
}

function setDiagramFit(host) {
  const svg = host.querySelector("svg") as SVGSVGElement | null;
  if (!svg) return;
  diagramViews.set(host.dataset.diagramKey || host.id, { mode: "fit", scale: 1 });
  svg.style.width = "100%";
  svg.style.minWidth = "0";
  svg.style.maxWidth = "none";
  svg.style.height = "auto";
  updateDiagramToolbar(host, "Fit");
}

function setDiagramScale(host, scale) {
  const svg = host.querySelector("svg") as SVGSVGElement | null;
  if (!svg) return;
  const nextScale = Math.min(4, Math.max(0.25, scale));
  diagramViews.set(host.dataset.diagramKey || host.id, { mode: "scale", scale: nextScale });
  svg.style.width = `${diagramNaturalWidth(svg) * nextScale}px`;
  svg.style.minWidth = "0";
  svg.style.maxWidth = "none";
  svg.style.height = "auto";
  updateDiagramToolbar(host, `${Math.round(nextScale * 100)}%`);
}

function ensureDiagramControls(host) {
  const restore = () => {
    const view = diagramViews.get(host.dataset.diagramKey || host.id);
    if (view?.mode === "scale") setDiagramScale(host, view.scale);
    else setDiagramFit(host);
  };
  if (host.previousElementSibling?.classList.contains("diagram-toolbar")) {
    host.previousElementSibling.hidden = false;
    restore();
    return;
  }
  const toolbar = document.createElement("div");
  toolbar.className = "diagram-toolbar";
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", "Diagram zoom controls");

  const controls = [
    { action: "out", label: "−", title: "Zoom out" },
    { action: "in", label: "+", title: "Zoom in" },
    { action: "actual", label: "100%", title: "Actual size" },
    { action: "fit", label: "Fit", title: "Fit diagram" },
  ];
  for (const control of controls) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.uiKey = host.id + ":zoom:" + control.action;
    button.textContent = control.label;
    button.title = control.title;
    button.setAttribute("aria-label", control.title);
    button.addEventListener("click", () => {
      if (control.action === "fit") {
        setDiagramFit(host);
        return;
      }
      if (control.action === "actual") {
        setDiagramScale(host, 1);
        return;
      }
      const view = diagramViews.get(host.dataset.diagramKey || host.id);
      const svg = host.querySelector("svg");
      const current = view?.mode === "scale" ? view.scale
        : svg ? (svg.getBoundingClientRect().width || diagramNaturalWidth(svg)) / diagramNaturalWidth(svg)
        : 1;
      setDiagramScale(host, current * (control.action === "in" ? 1.25 : 0.8));
    });
    toolbar.append(button);
  }
  const output = document.createElement("span");
  output.className = "diagram-toolbar-output";
  output.setAttribute("aria-live", "polite");
  toolbar.append(output);
  host.before(toolbar);
  restore();
}

function hideDiagramControls(host) {
  const toolbar = host.previousElementSibling;
  if (toolbar?.classList.contains("diagram-toolbar")) {
    (toolbar as HTMLElement).hidden = true;
  }
}

async function renderMermaidArtifact(artifact) {
  const source = String(artifact?.mermaid || "").trim();
  const key = "artifact:" + (artifact?.id || "");
  const signature = JSON.stringify([key, source, document.documentElement.dataset.colorMode]);
  if (diagramSignatures.get(elements.mermaidHost) === signature) return;
  diagramSignatures.set(elements.mermaidHost, signature);
  elements.mermaidHost.dataset.diagramKey = key;
  if (elements.diagramSourceDetails.dataset.uiKey !== key + ":source") {
    elements.diagramSourceDetails.open = expandedViews.get(key + ":source") ?? false;
  }
  elements.diagramSourceDetails.dataset.uiKey = key + ":source";
  const renderId = ++diagramRenderId;
  elements.artifactDiagram.hidden = !source;
  elements.mermaidSource.textContent = source;
  elements.mermaidHost.replaceChildren();
  hideDiagramControls(elements.mermaidHost);
  elements.diagramStatus.textContent = "";
  elements.diagramStatus.dataset.status = "idle";
  if (!source) return;

  elements.mermaidHost.setAttribute(
    "aria-label",
    artifact.title + " workflow diagram",
  );
  elements.diagramStatus.textContent = "Rendering Mermaid diagram...";
  try {
    const mermaid = await loadMermaid();
    const result = await mermaid.render(
      "tandem-diagram-" + renderId,
      source,
    );
    if (renderId !== diagramRenderId) return;
    const view = captureView();
    elements.mermaidHost.innerHTML = result.svg;
    if (typeof result.bindFunctions === "function") {
      result.bindFunctions(elements.mermaidHost);
    }
    ensureDiagramControls(elements.mermaidHost);
    restoreView(view);
    elements.diagramStatus.textContent = "";
  } catch {
    if (renderId !== diagramRenderId) return;
    diagramSignatures.delete(elements.mermaidHost);
    elements.diagramStatus.textContent =
      "Mermaid could not render this diagram. The source is available below.";
    elements.diagramStatus.dataset.status = "error";
    elements.diagramSourceDetails.open = true;
  }
}

function decisionNodesForState(state) {
  if (state.requirements?.substage === "usage") return [];
  const nodes = Array.isArray(state.decisionGraph?.nodes)
    ? state.decisionGraph.nodes
    : [];
  if (nodes.length > 0) return nodes;
  if (!state.question) return [];
  return [{
    id: state.question.id,
    title: state.question.text,
    dependencies: [],
    question: state.question,
    answer: null,
    status: "active",
  }];
}

function showDecisionQuestion(state, nodes, nodeId) {
  const node = nodes.find((candidate) => candidate.id === nodeId) || null;
  if (!node || node.status === "toAnswer") return;
  selectedDecisionId = node.id;
  for (const button of elements.decisionList.querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(button.dataset.decisionId === node.id));
  }
  for (
    const group of elements.designTreeHost.querySelectorAll(
      "g.node",
    ) as NodeListOf<HTMLElement>
  ) {
    group.dataset.selected = String(group.dataset.decisionId === node.id);
  }
  const processing = ["running", "error"].includes(state.processing?.status)
    && (state.processing?.question?.id === node.id || state.processing?.action === "apply-defaults")
    ? state.processing
    : null;
  renderQuestion(
    node.question,
    processing,
    canEditStage("requirements", state)
      && state.processing?.status !== "running",
    node,
  );
  const toAnswerCount = nodes.filter(
    (candidate) => candidate.status === "toAnswer",
  ).length;
  elements.designTreeCurrent.textContent =
    (node.status === "active" ? "Active" : "Answered")
      + " · " + node.title
      + (toAnswerCount > 0 ? " · " + toAnswerCount + " to answer" : "");
}

async function postDecisionAnswer(questionId, answer, action = "answer-decision") {
  return postJson("/api/answer", { questionId, answer, action });
}

async function applyWholeGraphDefaults(state, useCurrentSnapshot = false) {
  if (hasPendingRequest() || applyingAllRecommended || !canEditStage("requirements") ||
      state.processing?.status === "running") return;
  const retry = !useCurrentSnapshot && state.processing?.action === "apply-defaults" && state.processing.status === "error";
  const unanswered = (state.decisionGraph?.nodes || []).filter((node) => !node.answer);
  if (!retry) {
    const missing = unanswered.find((node) => !curatedDefault(node.question));
    if (missing) {
      elements.designTreeStatus.textContent = `"${missing.title}" has no curated recommended choice. Answer it explicitly first.`;
      elements.designTreeStatus.dataset.status = "error";
      return;
    }
    if (!window.confirm("Use whole-graph defaults for ALL " + unanswered.length + " unanswered decisions?\n\n"
      + unanswered.map((node) => node.title + ": " + node.question.recommended).join("\n")
      + "\n\nOne semantic review checks compatibility. Changed decisions require review; new recommendations are not automatically selected.")) return;
  }
  const body = {
    action: "apply-defaults", expectedRevision: state.revision, generation: state.generation,
    ...(retry ? { retryRequestId: state.processing.requestId } : {
      defaults: unanswered.map((node) => ({ nodeId: node.id, answer: node.question.recommended })),
    }),
  };
  applyingAllRecommended = true;
  submitting = true;
  renderNextAction(state);
  try {
    await postJson("/api/answer", body);
  } catch (error) {
    elements.designTreeStatus.textContent = error instanceof Error ? error.message : "Could not reconcile whole-graph defaults.";
    elements.designTreeStatus.dataset.status = "error";
  } finally {
    applyingAllRecommended = false;
    finishSubmission();
  }
}

async function renderDesignTree(state) {
  const nodes = decisionNodesForState(state);
  const graph = buildDecisionGraphMermaid(nodes);
  const source = graph.source;
  elements.designTreeCard.hidden = nodes.length === 0;
  elements.designTreeEmpty.hidden = nodes.length > 0;
  elements.designTreePhase.textContent = state.phase || "discovery";

  if (nodes.length === 0) {
    ++designTreeRenderId;
    diagramSignatures.delete(elements.designTreeHost);
    elements.designTreeHost.replaceChildren();
    elements.decisionList.replaceChildren();
    hideDiagramControls(elements.designTreeHost);
    renderQuestion(null, state.processing, false, null);
    return;
  }
  const activeNode = nodes.find((node) => node.status === "active") || null;
  const selectedNode = nodes.find(
    (node) => node.id === selectedDecisionId && node.status !== "toAnswer",
  );
  const defaultNode = (followingActiveDecision ? activeNode : selectedNode)
    || selectedNode || activeNode
    || nodes.find((node) => node.status === "answered")
    || null;
  selectedDecisionId = defaultNode?.id || null;

  if (defaultNode) showDecisionQuestion(state, nodes, defaultNode.id);
  const selectDecision = (id) => {
    speechInputs.beforeRender();
    const view = captureView();
    const latest = decisionNodesForState(currentState);
    followingActiveDecision = latest.find((node) => node.id === id)?.status === "active";
    showDecisionQuestion(currentState, latest, id);
    speechInputs.afterRender();
    restoreView(view);
    renderNextAction(currentState);
  };
  const signature = JSON.stringify([source, document.documentElement.dataset.colorMode]);
  if (diagramSignatures.get(elements.designTreeHost) === signature) {
    for (const button of elements.decisionList.querySelectorAll("button")) {
      const node = nodes.find((node) => node.id === button.dataset.decisionId);
      button.disabled = !node || node.status === "toAnswer";
    }
    return;
  }
  diagramSignatures.set(elements.designTreeHost, signature);
  const renderId = ++designTreeRenderId;
  elements.designTreeHost.dataset.diagramKey = "requirements:" + state.prototypeId;
  elements.designTreeHost.replaceChildren();
  hideDiagramControls(elements.designTreeHost);
  elements.designTreeSource.textContent = source;
  elements.designTreeStatus.dataset.status = "idle";
  elements.decisionList.replaceChildren();
  elements.decisionList.hidden = false;
  for (const node of nodes) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.uiKey = "decision-text:" + node.id;
    button.dataset.decisionId = node.id;
    button.textContent = node.title + " · " + (node.status === "toAnswer" ? "To answer" : node.status);
    button.disabled = node.status === "toAnswer";
    button.setAttribute("aria-pressed", String(node.id === selectedDecisionId));
    button.addEventListener("click", () => selectDecision(node.id));
    item.append(button);
    elements.decisionList.append(item);
  }
  elements.designTreeStatus.textContent = "Rendering requirements DAG...";
  try {
    const mermaid = await loadMermaid();
    const result = await mermaid.render(
      "tandem-design-tree-" + renderId,
      source,
    );
    if (renderId !== designTreeRenderId) return;
    const view = captureView();
    elements.designTreeHost.innerHTML = result.svg;
    if (typeof result.bindFunctions === "function") {
      result.bindFunctions(elements.designTreeHost);
    }
    ensureDiagramControls(elements.designTreeHost);
    for (const [alias, node] of graph.aliases) {
      const group = Array.from(
        elements.designTreeHost.querySelectorAll(
          "g.node",
        ) as NodeListOf<HTMLElement>,
      ).find((candidate) => candidate.id.includes("-" + alias + "-"));
      if (!group) continue;

      const canAnswer = node.status === "active";
      const canReview = node.status === "answered";
      const selectable = canAnswer || canReview;
      group.dataset.decisionId = node.id;
      group.dataset.uiKey = "decision:" + node.id;
      group.dataset.status = node.status;
      group.dataset.selectable = String(selectable);
      group.dataset.selected = String(node.id === selectedDecisionId);
      group.setAttribute(
        "aria-label",
        node.title + ". " + (
          node.status === "active"
            ? "Active question"
            : node.status === "answered"
              ? "Answered"
              : "To answer"
        ),
      );
      if (!selectable) continue;

      group.setAttribute("role", "button");
      group.setAttribute("tabindex", "0");
      const select = () => selectDecision(node.id);
      group.addEventListener("click", select);
      group.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        select();
      });
    }
    // Keep the text controls available to assistive technology and as an alternate view.
    elements.decisionList.hidden = false;
    restoreView(view);
    renderNextAction(currentState);
    elements.designTreeStatus.textContent = "";
  } catch {
    if (renderId !== designTreeRenderId) return;
    diagramSignatures.delete(elements.designTreeHost);
    elements.designTreeStatus.textContent =
      "The diagram is unavailable. Select a decision from the list to continue.";
    elements.designTreeStatus.dataset.status = "error";
    elements.designTreeSourceDetails.open = true;
  }
}

function reviewThreadsForArtifact(state, artifact) {
  if (!artifact) return [];
  const sourceThreadIds = new Set(artifact.sourceThreadIds || []);
  return [
    ...(state?.designReview?.threads || []),
    ...(state?.testDesignReview?.threads || []),
  ].filter((thread) =>
    sourceThreadIds.has(thread.id) ||
    thread.reviewArtifactId === artifact.id ||
    (thread.artifactIds || []).includes(artifact.id)
  );
}

function appendReviewThreadHeading(card, thread, isTestDesign = false) {
  const heading = document.createElement("div");
  heading.className = "review-thread-heading";
  const kind = document.createElement("span");
  kind.className = "review-thread-kind";
  kind.textContent = thread.type === "artifact"
    ? "Artifact · " + String(thread.artifactKind || "").replace("-", " ")
    : isTestDesign ? "Test design question" : "Product design question";
  const status = document.createElement("span");
  status.className = "review-thread-state";
  status.textContent = thread.status;
  heading.append(kind, status);
  card.append(heading);
}

function renderArtifactReview(state, artifact) {
  elements.artifactReviewThreads.replaceChildren();
  const isDesignArtifact = artifact?.stage === "design";
  elements.artifactReview.hidden = !isDesignArtifact;
  if (!isDesignArtifact) return;
  const canReview = canEditStage("design", state);
  elements.designReviewForm.hidden = !canReview;
  bindFormDraft(elements.designReviewForm, draftKey("artifact-review", artifact.id, state.design?.substage || "product"));
  if (elements.reviewRequestKind.value === "question") {
    elements.designReviewInput.placeholder =
      `Ask about ${artifact.title}, its tradeoffs, behavior, or risks.`;
  }

  const currentReview = state.design?.substage === "test"
    ? state.testDesignReview
    : state.designReview;
  const activeThreadIds = new Set(
    (currentReview?.threads || []).map((thread) => thread.id),
  );
  const threads = reviewThreadsForArtifact(state, artifact);
  for (const thread of threads) {
    const card = document.createElement("article");
    card.className = "review-thread";
    card.dataset.status = thread.status;
    appendReviewThreadHeading(
      card,
      thread,
      (state.testDesignReview?.threads || []).some(
        (candidate) => candidate.id === thread.id,
      ),
    );

    const isDefaultArtifact =
      thread.type === "artifact"
      && String(thread.id || "").startsWith("default-project-");
    if (!isDefaultArtifact) {
      const prompt = document.createElement("p");
      prompt.className = "review-thread-prompt";
      prompt.textContent = thread.prompt;
      card.append(prompt);
      if (thread.answer) {
        const answer = document.createElement("p");
        answer.className = "review-thread-answer";
        answer.textContent = thread.answer;
        card.append(answer);
      } else if (["queued", "processing"].includes(thread.status)) {
        const waiting = document.createElement("p");
        waiting.className = "review-thread-answer muted";
        waiting.textContent = thread.status === "queued"
          ? "Waiting in the Tandem review queue..."
          : "Tandem is preparing a design response...";
        card.append(waiting);
      }
    }

    if (thread.error) {
      const error = document.createElement("p");
      error.className = "review-thread-error";
      error.textContent = thread.error;
      card.append(error);
    }

    const actionName = thread.status === "answered"
      ? "resolve"
      : thread.status === "resolved"
        ? "reopen"
        : thread.status === "failed"
          ? "retry"
          : null;
    if (
      actionName &&
      activeThreadIds.has(thread.id) &&
      canReview
    ) {
      const actions = document.createElement("div");
      actions.className = "review-thread-actions";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "thread-action";
      button.dataset.threadAction = actionName;
      button.dataset.uiKey = "artifact-thread:" + thread.id + ":" + actionName;
      button.textContent = actionName === "resolve"
        ? "Mark resolved"
        : actionName === "reopen"
          ? "Reopen"
          : "Retry";
      button.disabled = submitting || state.provider?.canSubmitAnswers === false;
      button.addEventListener("click", () =>
        submitDesignThreadAction(thread.id, actionName)
      );
      actions.append(button);
      card.append(actions);
    }
    elements.artifactReviewThreads.append(card);
  }
}

function renderArtifactContent(artifacts) {
  const artifact = artifacts.find((item) => item.id === selectedArtifactId) || null;
  elements.contentCard.hidden = !artifact;
  elements.contentEmpty.hidden = Boolean(artifact);
  if (!artifact) {
    elements.artifactHeading.textContent = "Artifact content";
    elements.artifactMeta.textContent = "";
    elements.artifactContent.textContent = "";
    elements.artifactContent.hidden = true;
    elements.artifactReview.hidden = true;
    elements.artifactReviewThreads.replaceChildren();
    renderMermaidArtifact(null);
    return;
  }

  elements.artifactHeading.textContent = artifact.title;
  const stageLabel = LIFECYCLE_STAGES.find(
    (stage) => stage.id === artifact.stage,
  )?.label;
  elements.artifactMeta.textContent = [
    stageLabel,
    artifact.kind,
    artifact.path,
    artifact.reviewStatus === "stale" ? "stale" : "",
  ]
    .filter(Boolean)
    .join(" · ");
  elements.artifactContent.textContent = artifact.content || "";
  elements.artifactContent.hidden = !artifact.content;
  renderMermaidArtifact(artifact);
  renderArtifactReview(currentState, artifact);
}

function renderArtifacts(value) {
  const artifacts = Array.isArray(value) ? value : [];
  if (!artifacts.some((artifact) => artifact.id === selectedArtifactId)) {
    selectedArtifactId = artifacts[0]?.id || null;
  }

  elements.artifactCount.textContent = artifacts.length > 0
    ? "(" + artifacts.length + ")"
    : "";
  elements.artifactList.replaceChildren();
  if (artifacts.length === 0) {
    const empty = document.createElement("p");
    empty.className = "artifact-empty";
    empty.textContent = "Your artifacts will appear here as each stage progresses.";
    elements.artifactList.append(empty);
  }

  for (const stage of LIFECYCLE_STAGES) {
    const stageArtifacts = artifacts.filter(
      (artifact) => (artifact.stage || "requirements") === stage.id,
    );
    if (stageArtifacts.length === 0) continue;
    const group = document.createElement("section");
    group.className = "artifact-stage-group";
    group.setAttribute("aria-label", stage.label + " artifacts");

    const heading = document.createElement("h3");
    heading.className = "artifact-stage-heading";
    heading.textContent = stage.label;
    const count = document.createElement("span");
    count.textContent = String(stageArtifacts.length);
    heading.append(count);

    const list = document.createElement("ul");
    list.className = "artifact-stage-items";
    for (const artifact of stageArtifacts) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.className = "artifact-button";
      button.type = "button";
      button.dataset.artifactId = artifact.id;
      button.dataset.uiKey = "artifact:" + artifact.id;
      button.setAttribute(
        "aria-current",
        String(artifact.id === selectedArtifactId),
      );

      const title = document.createElement("span");
      title.className = "artifact-title";
      title.textContent = artifact.title;
      button.append(title);

      const metaValue = [
        artifact.kind,
        artifact.path,
        artifact.reviewStatus === "stale" ? "stale" : "",
      ].filter(Boolean).join(" · ");
      if (metaValue) {
        const meta = document.createElement("span");
        meta.className = "artifact-list-meta";
        meta.textContent = metaValue;
        button.append(meta);
      }

      button.addEventListener("click", () => {
        selectedArtifactId = artifact.id;
        render(currentState, true);
        if (window.matchMedia("(max-width: 760px)").matches) setContextExpanded(false);
        activateOutputTab("content", true);
      });
      item.append(button);
      list.append(item);
    }
    group.append(heading, list);
    elements.artifactList.append(group);
  }

  renderArtifactContent(artifacts);
}

const PROCESSING_TITLES = {
  "apply-defaults": "Reconciling whole-graph defaults",
  "add-usage": "Updating usage guidance",
  "generate-dag": "Building requirements DAG",
  "answer-decision": "Applying your decision",
  "change-answer": "Revising dependent decisions",
  "submit-revision": "Reviewing prototype revision",
  "clarify-revision": "Applying your clarification",
  "generate-design-spec": "Preparing design specification",
};

function renderQuestion(question, processing, canSubmitAnswers, decisionNode = null) {
  const key = draftKey("decision", question?.id, [question, decisionNode?.answer || null]);
  const signature = JSON.stringify([
    key, processing, canSubmitAnswers, decisionNode?.status, decisionNode?.review,
    submitting, applyingAllRecommended, questionErrors.get(key),
  ]);
  if (lastQuestionSignature === signature) return;
  lastQuestionSignature = signature;
  saveFormDraft(elements.questionHost.querySelector("form"));
  if (processingMessageTimer !== null) {
    window.clearInterval(processingMessageTimer);
    processingMessageTimer = null;
  }
  elements.questionHost.replaceChildren();
  const isChangingAnswer =
    decisionNode?.status === "answered" && processing?.status !== "running";
  if (isChangingAnswer) {
    const title = document.createElement("p");
    title.className = "question";
    title.textContent = question?.text || decisionNode.title;
    const label = document.createElement("p");
    label.className = "muted";
    label.textContent = "Answered";
    const answer = document.createElement("div");
    answer.className = "choice";
    const answerText = document.createElement("span");
    answerText.textContent = decisionNode.answer || "No answer recorded.";
    answer.append(answerText);
    elements.questionHost.append(title, label, answer);
    if (!canSubmitAnswers) return;
  }
  if (processing?.status === "running") {
    const state = document.createElement("div");
    state.className = "processing-state";
    state.setAttribute("role", "status");
    state.setAttribute("aria-live", "polite");
    state.setAttribute("aria-atomic", "true");

    const indicator = document.createElement("span");
    indicator.className = "processing-indicator";
    indicator.setAttribute("aria-hidden", "true");

    const copy = document.createElement("span");
    copy.className = "processing-copy";
    const heading = document.createElement("span");
    heading.className = "processing-heading";
    const title = document.createElement("strong");
    const dots = document.createElement("span");
    dots.className = "processing-dots";
    dots.setAttribute("aria-hidden", "true");
    for (let index = 0; index < 3; index += 1) {
      dots.append(document.createElement("i"));
    }
    const detail = document.createElement("span");
    detail.className = "muted";
    const elapsed = document.createElement("span");
    elapsed.className = "muted";
    elapsed.setAttribute("role", "timer");
    elapsed.setAttribute("aria-live", "off");
    title.textContent = PROCESSING_TITLES[processing.action] || "Processing Tandem update";
    heading.append(title, dots);
    copy.append(heading, detail, elapsed);
    state.append(indicator, copy);
    elements.questionHost.append(state);

    const updateMessage = () => {
      detail.textContent = processing.message || "Waiting for a progress update.";
      elapsed.textContent = elapsedLabel(processing.requestedAt);
    };
    updateMessage();
    processingMessageTimer = window.setInterval(updateMessage, 1000);
    return;
  }

  if (processing?.status === "error") {
    const failure = document.createElement("p");
    failure.className = "processing-error";
    failure.setAttribute("role", "alert");
    failure.textContent = processing.message || "Tandem processing failed.";
    elements.questionHost.append(failure);
  }
  if (decisionNode?.review) {
    const review = document.createElement("p");
    review.className = "processing-error";
    review.setAttribute("role", "alert");
    review.textContent = "Review required: " + decisionNode.review.reason
      + (decisionNode.review.previousAnswer ? " Previously selected: " + decisionNode.review.previousAnswer : "");
    elements.questionHost.append(review);
  }

  if (!question) {
    const waiting = document.createElement("p");
    waiting.className = "muted";
    waiting.textContent = processing?.status === "success"
      ? "No decision is waiting."
      : "Preparing the next decision...";
    elements.questionHost.append(waiting);
    return;
  }

  if (!canSubmitAnswers) {
    const notice = document.createElement("p");
    notice.className = "provider-notice";
    notice.textContent =
      "Answers are routed through the installed user-scoped Tandem.";
    elements.questionHost.append(notice);
  }

  const title = document.createElement("p");
  title.className = "question";
  title.textContent = isChangingAnswer ? "Change this answer" : question.text;
  elements.questionHost.append(title);

  if (question.rationale && !isChangingAnswer) {
    const rationale = document.createElement("p");
    rationale.className = "rationale";
    rationale.textContent = question.rationale;
    elements.questionHost.append(rationale);
  }

  const form = document.createElement("form");
  const choices = document.createElement("div");
  choices.className = "choices";

  for (const value of question.choices || []) {
    const label = document.createElement("label");
    label.className = "choice";

    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "prototype-choice";
    radio.value = value;
    radio.dataset.uiKey = "decision:" + question.id + ":choice:" + value;
    radio.disabled = submitting || !canSubmitAnswers;
    radio.checked = !isChangingAnswer && value === question.recommended;

    const text = document.createElement("span");
    text.textContent = value;

    label.append(radio, text);
    if (value === question.recommended && !isChangingAnswer) {
      const badge = document.createElement("span");
      badge.className = "recommended";
      badge.textContent = "Recommended";
      label.append(badge);
    }
    choices.append(label);
  }
  if (choices.childElementCount > 0) form.append(choices);

  let detail = null;
  if (question.allowFreeText !== false) {
    detail = document.createElement("textarea");
    detail.name = "prototype-detail";
    detail.setAttribute("data-speech-input", "");
    detail.setAttribute("maxlength", "4000");
    detail.dataset.uiKey = "decision:" + question.id + ":detail";
    detail.disabled = submitting || !canSubmitAnswers;
    detail.placeholder = question.answerPlaceholder || (
      choices.childElementCount > 0
        ? "Optional context"
        : "Enter your answer"
    );
    if (isChangingAnswer) {
      detail.placeholder = "Enter a replacement answer";
    }
    detail.setAttribute("aria-label", "Additional answer context");
    detail.addEventListener("input", () => {
      const radios = Array.from(
        form.querySelectorAll<HTMLInputElement>(
          'input[name="prototype-choice"]',
        ),
      );
      if (detail.value.trim()) {
        for (const radio of radios) radio.checked = false;
        return;
      }

      const recommended = radios.find(
        (radio) => radio.value === question.recommended,
      );
      if (recommended) recommended.checked = true;
    });
    form.append(detail);
  }

  for (
    const radio of form.querySelectorAll<HTMLInputElement>(
      'input[name="prototype-choice"]',
    )
  ) {
    radio.addEventListener("change", () => {
      if (radio.checked && detail) detail.value = "";
    });
  }

  const actions = document.createElement("div");
  actions.className = "actions";
  const send = document.createElement("button");
  send.className = "send";
  send.type = "submit";
  send.dataset.uiKey = "decision:" + question.id + ":send";
  send.textContent = canSubmitAnswers
    ? isChangingAnswer
      ? "Update answer and dependents"
      : "Use this answer"
    : "Open installed Tandem to answer";
  send.disabled = submitting || !canSubmitAnswers;
  let allRecommended = null;
  if (!isChangingAnswer && question.recommended && canSubmitAnswers) {
    allRecommended = document.createElement("button");
    allRecommended.className = "all-recommended";
    allRecommended.type = "button";
    allRecommended.dataset.uiKey = "decision:" + question.id + ":recommended";
    allRecommended.textContent = applyingAllRecommended
      ? "Saving whole-graph defaults..."
      : currentState.processing?.action === "apply-defaults" && currentState.processing.status === "error"
        ? "Retry whole-graph defaults"
        : "Use whole-graph defaults";
    allRecommended.title =
      "Approve the currently displayed recommended choices for ALL unanswered decisions, including downstream nodes, in one reconciled batch. Changed decisions require review.";
    allRecommended.disabled = submitting || applyingAllRecommended;
    allRecommended.addEventListener("click", () => {
      void applyWholeGraphDefaults(currentState);
    });
  }
  const error = document.createElement("p");
  error.className = "error";
  error.setAttribute("role", "alert");
  error.textContent = questionErrors.get(key) || "";
  actions.append(send);
  if (allRecommended) actions.append(allRecommended);
  if (allRecommended && currentState.processing?.action === "apply-defaults" && currentState.processing.status === "error") {
    const reviewDefaults = document.createElement("button");
    reviewDefaults.type = "button";
    reviewDefaults.className = "review-current-defaults";
    reviewDefaults.textContent = "Review current whole-graph defaults";
    reviewDefaults.title = "Replace the failed batch only after approving a fresh snapshot of every current recommendation.";
    reviewDefaults.disabled = submitting || applyingAllRecommended;
    reviewDefaults.addEventListener("click", () => { void applyWholeGraphDefaults(currentState, true); });
    actions.append(reviewDefaults);
  }
  actions.append(error);
  form.append(actions);
  bindFormDraft(form, key);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (hasPendingRequest() || !canEditStage("requirements") || currentState.processing?.status === "running") return;

    const selected = form.querySelector<HTMLInputElement>(
      'input[name="prototype-choice"]:checked',
    );
    const note = detail ? detail.value.trim() : "";
    const answer = note || selected?.value || "";
    saveFormDraft(form);
    const version = formDrafts.get(key)?.version;
    if (!answer) {
      error.textContent = "Choose an option or enter an answer.";
      return;
    }

    submitting = true;
    questionErrors.delete(key);
    send.disabled = true;
    send.textContent = "Sending...";
    error.textContent = "";
    try {
      await postDecisionAnswer(
        question.id,
        answer,
        isChangingAnswer ? "change-answer" : "answer-decision",
      );
      clearAcceptedDraft(key, version);
      followingActiveDecision = true;
    } catch (requestError) {
      const message = requestError instanceof Error
        ? requestError.message
        : "Could not send answer.";
      questionErrors.set(key, message);
    } finally {
      finishSubmission();
    }
  });

  elements.questionHost.append(form);
}

function renderPrototypeReview(state, preserveMessage = false) {
  const isPrototype =
    (state.lifecycle?.currentStage || "requirements") === "prototype";
  elements.prototypeReview.hidden = !hasStageData(state, "prototype") || Boolean(skippedStage(state, "prototype"));
  if (elements.prototypeReview.hidden) return;

  const review = state.prototypeReview || {
    revisions: [],
    activeRevisionId: null,
    question: null,
    evidence: [],
  };
  const processing = state.processing?.status === "running";
  const canSubmit = canEditStage("prototype", state);
  const previewReady = state.previewStatus === "ready";
  const question = review.question || null;
  const revisions = Array.isArray(review.revisions) ? review.revisions : [];
  const unresolved = revisions.filter((revision) => UNRESOLVED_REVISIONS.includes(revision.status));
  const queued = revisions.filter((revision) => revision.status === "queued");
  const finalizing = prototypeFinalizing(state);
  elements.revisionInput.disabled = Boolean(effortSubmitting || state.effortReset);
  elements.submitRevision.disabled = hasPendingRequest() || !canSubmit || finalizing || unresolved.length >= 50;
  elements.submitRevision.textContent = submitting ? "Sending..."
    : hasActiveJobs(state) || question || state.prototypeFlow?.pendingCheckpointId || !previewReady
      ? "Queue revision" : "Send revision";
  elements.revisionQueueSummary.textContent = unresolved.length
    ? `${queued.length} queued · ${unresolved.length} unresolved / 50` : "";
  elements.revisionHistoryDetails.hidden = revisions.length === 0;

  elements.revisionQuestion.hidden = !question;
  saveFormDraft(elements.revisionQuestionForm);
  const previousKey = elements.revisionQuestionForm.dataset.draftKey;
  const key = question ? draftKey("clarification", question.id, question) : "";
  elements.revisionQuestionForm.dataset.draftKey = "";
  elements.revisionQuestionChoices.replaceChildren();
  if (key !== previousKey) elements.revisionQuestionDetail.value = "";
  if (question) {
    elements.revisionQuestionTitle.textContent = question.text;
    elements.revisionQuestionRationale.textContent = question.rationale || "";
    elements.revisionQuestionRationale.hidden = !question.rationale;
    for (const choice of question.choices || []) {
      const label = document.createElement("label");
      label.className = "revision-question-choice";
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "revision-clarification";
      radio.value = choice;
      radio.dataset.uiKey = "clarification:" + question.id + ":" + choice;
      radio.checked = choice === question.recommended;
      const text = document.createElement("span");
      text.textContent = choice;
      label.append(radio, text);
      elements.revisionQuestionChoices.append(label);
    }
    const allowFreeText = question.allowFreeText !== false;
    elements.revisionQuestionDetail.hidden = !allowFreeText;
    elements.revisionQuestionDetail.disabled =
      !allowFreeText || submitting || processing || !canSubmit;
    elements.revisionQuestionDetail.placeholder =
      question.answerPlaceholder || "Optional clarification";
    elements.revisionQuestionDetail.oninput = () => {
      if (!elements.revisionQuestionDetail.value.trim()) return;
      for (const radio of elements.revisionQuestionChoices.querySelectorAll(
        'input[name="revision-clarification"]',
      )) {
        radio.checked = false;
      }
    };
    for (const radio of elements.revisionQuestionChoices.querySelectorAll(
      'input[name="revision-clarification"]',
    )) {
      radio.disabled = submitting || processing || !canSubmit;
      radio.addEventListener("change", () => {
        if (radio.checked) elements.revisionQuestionDetail.value = "";
      });
    }
    elements.submitClarification.disabled =
      submitting || processing || !canSubmit;
    elements.submitClarification.textContent = processing
      ? "Applying..."
      : "Use this answer";
    bindFormDraft(elements.revisionQuestionForm, key);
  }

  elements.revisionHistory.replaceChildren();
  const recentApplied = new Set(revisions.filter((revision) => revision.status === "applied").slice(-5));
  const statusLabels = {
    queued: "Queued", processing: "Building update", clarifying: "Needs clarification",
    ready: "Update ready — not applied", applied: "Applied", failed: "Failed — retry needed",
  };
  for (const revision of revisions.filter((revision) =>
    revision.status !== "applied" || recentApplied.has(revision)).reverse()) {
    const item = document.createElement("li");
    item.dataset.revisionId = revision.id;
    item.dataset.status = revision.status;
    const suggestion = document.createElement("strong");
    suggestion.textContent = revision.suggestion || revision.summary;
    if (revision.summary) suggestion.title = revision.summary;
    const status = document.createElement("span");
    status.textContent = statusLabels[revision.status] || revision.status;
    item.append(suggestion, status);
    elements.revisionHistory.append(item);
  }

  if (!preserveMessage || revisionTransportError) {
    elements.revisionStatus.textContent = revisionTransportError || (!isPrototype
      ? "Prototype history is read only. You can keep a draft; reopen the stage to submit it."
      : !canSubmit
      ? "Open the installed user-scoped Tandem to submit revisions."
      : finalizing
        ? "The final feature specification is being generated from frozen input. Keep drafting; sending is paused for this handoff."
      : unresolved.length >= 50
        ? "The feedback queue is full. Apply or resolve existing updates before sending more; your draft is kept."
      : !previewReady
        ? "You can queue feedback before the first preview is ready."
        : hasActiveJobs(state)
          ? "Keep using the displayed preview. New feedback is queued while the next update builds."
          : question
            ? "Answer the clarification to continue that revision. You can queue other feedback meanwhile."
            : state.prototypeFlow?.pendingCheckpointId
              ? "An update is ready. Apply it when you are ready; new feedback remains queued."
            : revisions.length > 0
              ? "Add another revision, or finish Prototype when no changes remain."
              : "Try the prototype, then describe any revision you want.");
    elements.revisionStatus.dataset.status =
      revisionTransportError || unresolved.length >= 50 ? "error" : "idle";
    elements.revisionStatus.dataset.essential = String(Boolean(
      revisionTransportError || unresolved.length >= 50 || !canSubmit || !isPrototype || finalizing || question,
    ));
  }
}

async function submitDesignThreadAction(threadId, action) {
  if (hasPendingRequest() || !canEditStage("design")) return;
  submitting = true;
  try {
    await postJson("/api/design-review/thread", { threadId, action });
  } catch (error) {
    elements.designReviewStatus.textContent = error instanceof Error
      ? error.message
      : "Could not update this review thread.";
    elements.designReviewStatus.dataset.status = "error";
  } finally {
    finishSubmission();
  }
}

function renderDesignReview(state, preserveMessage = false) {
  const isDesign =
    (state.lifecycle?.currentStage || "requirements") === "design";
  const designComplete = (state.lifecycle?.completedStages || []).includes("design");
  const isTestDesign = state.design?.substage === "test";
  const review = (isTestDesign
    ? state.testDesignReview
    : state.designReview) || {
    threads: [],
    processing: null,
    finalizeRequested: false,
    finalizedArtifactId: null,
  };
  const threads = Array.isArray(review.threads) ? review.threads : [];
  const canSubmit = canEditStage("design", state);
  const selectedArtifact = (state.artifacts || []).find(
    (artifact) => artifact.id === selectedArtifactId,
  );
  const reviewingArtifact = selectedArtifact?.stage === "design";
  const finalized = isTestDesign
    ? review.finalizedArtifactId === "test-spec"
    : ["design-spec", "design-review"].includes(review.finalizedArtifactId);
  elements.productDesignSubstage.dataset.status = designComplete
    ? "complete"
    : !isDesign
      ? "locked"
      : isTestDesign
        ? "complete"
        : "active";
  elements.testDesignSubstage.dataset.status = designComplete
    ? "complete"
    : isDesign && isTestDesign
      ? "active"
      : "locked";
  elements.designReviewTitle.textContent = isTestDesign
    ? "Integration and interaction test design"
    : "Product design review";
  if (elements.reviewRequestKind.value === "question") {
    elements.designReviewInput.placeholder = reviewingArtifact
      ? `Ask about ${selectedArtifact.title}, its tradeoffs, behavior, or risks.`
      : "Select a Design artifact to start a review.";
  }
  const unresolved = threads.filter((thread) => thread.status !== "resolved");
  const queued = threads.filter((thread) =>
    ["queued", "processing"].includes(thread.status),
  ).length;
  const resolved = threads.length - unresolved.length;

  elements.reviewCount.textContent = threads.length > 0
    ? "(" + threads.length + ")"
    : "";
  elements.designReviewProgress.textContent = finalized
    ? "Review captured from " + resolved + " resolved thread"
      + (resolved === 1 ? "." : "s.")
    : resolved + " resolved · " + unresolved.length + " open"
      + (queued > 0 ? " · " + queued + " queued" : "");

  elements.designReviewThreads.replaceChildren();
  if (threads.length === 0) {
    const empty = document.createElement("p");
    empty.className = "design-review-empty";
    empty.textContent =
      !isDesign && !designComplete
        ? "Required project-specific design artifacts will be generated after Prototype."
        : isTestDesign
        ? "Preparing integration and interaction test-design drafts for review."
        : "Preparing the required project-specific design artifacts for review.";
    elements.designReviewThreads.append(empty);
  }

  for (const thread of threads) {
    const card = document.createElement("article");
    card.className = "review-thread";
    card.dataset.status = thread.status;
    card.dataset.threadId = thread.id;
    appendReviewThreadHeading(card, thread, isTestDesign);

    if (thread.error) {
      const error = document.createElement("p");
      error.className = "review-thread-error";
      error.textContent = thread.error;
      card.append(error);
    }

    const artifactIds = Array.from(new Set([
      ...(Array.isArray(thread.artifactIds) ? thread.artifactIds : []),
      ...(thread.reviewArtifactId ? [thread.reviewArtifactId] : []),
    ]));
    if (artifactIds.length > 0) {
      const artifactLinks = document.createElement("div");
      artifactLinks.className = "review-thread-artifacts";
      for (const artifactId of artifactIds) {
        const artifact = (state.artifacts || []).find(
          (candidate) => candidate.id === artifactId,
        );
        if (!artifact) continue;
        const link = document.createElement("button");
        link.type = "button";
        link.className = "review-artifact-link";
        link.dataset.threadId = thread.id;
        link.dataset.uiKey = "review-link:" + thread.id + ":" + artifactId;
        link.textContent = artifact.title
          + (artifact.reviewStatus === "stale" ? " · stale" : "");
        link.addEventListener("click", () => {
          selectedArtifactId = artifact.id;
          render(currentState, true);
          activateOutputTab("content");
        });
        artifactLinks.append(link);
      }
      card.append(artifactLinks);
    }

    if (thread.status === "failed" && artifactIds.length === 0 && isDesign) {
      const actions = document.createElement("div");
      actions.className = "review-thread-actions";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "thread-action";
      button.dataset.threadAction = "retry";
      button.dataset.uiKey = "review-retry:" + thread.id;
      button.textContent = "Retry";
      button.disabled = submitting || !canSubmit;
      button.addEventListener("click", () =>
        submitDesignThreadAction(thread.id, "retry"),
      );
      actions.append(button);
      card.append(actions);
    }
    elements.designReviewThreads.append(card);
  }

  const request = reviewRequestDetails();
  elements.designReviewForm.hidden = !isDesign || !reviewingArtifact;
  elements.finishReview.hidden = !isDesign;
  elements.reviewRequestKind.disabled = submitting || !canSubmit;
  const testScenarioOption = elements.reviewRequestKind.querySelector(
    'option[value="test-scenario"]',
  );
  if (testScenarioOption) testScenarioOption.hidden = !isTestDesign;
  if (!isTestDesign && elements.reviewRequestKind.value === "test-scenario") {
    elements.reviewRequestKind.value = "question";
  }
  elements.designReviewInput.disabled = submitting || !canSubmit;
  elements.reviewSubmit.disabled = submitting || !canSubmit;
  elements.reviewSubmit.textContent = submitting
    ? "Sending..."
    : review.processing
      ? request.type === "question"
        ? "Queue question"
        : "Queue artifact"
      : request.label;
  elements.finishReview.disabled =
    submitting ||
    !canSubmit ||
    finalized ||
    (isTestDesign && threads.length === 0) ||
    Boolean(review.processing) ||
    Boolean(review.finalizeRequested) ||
    unresolved.length > 0;
  elements.finishReview.textContent = finalized
    ? isTestDesign ? "Test spec captured" : "Design spec captured"
    : review.finalizeRequested ||
        review.processing?.action === "finalize"
      ? "Capturing specification..."
      : isTestDesign ? "Finish test design" : "Finish product design";

  if (!preserveMessage) {
    const failed = threads.find((thread) => thread.status === "failed");
    elements.designReviewStatus.textContent = !isDesign
      ? designComplete
        ? "Design review is complete and remains available for reference."
        : "Complete Prototype to unlock review actions."
      : !canSubmit
      ? "Open the installed user-scoped Tandem to conduct the review."
      : failed
        ? "A review request failed. Retry it before finishing."
        : review.processing
          ? review.processing.action === "finalize"
            ? "Finalizing the specification from the resolved review."
            : "A design request is processing. Open a Design artifact to review it or queue a follow-up."
          : finalized
            ? isTestDesign
              ? "The test specification is available under Artifacts → Design."
              : "The design specification is available under Artifacts → Design."
            : isTestDesign && threads.length === 0
              ? "Initial test-design drafts are generated automatically before finalization."
              : queued > 0
                ? "Generating design artifacts for review. Open an artifact when it is ready."
                : unresolved.length > 0
                  ? "Open each generated artifact to review it, ask questions, and mark its thread resolved."
                  : "Open a Design artifact to ask another question, or finish the review.";
    elements.designReviewStatus.dataset.status = failed ? "error" : "idle";
  }
  elements.designReviewStageStatus.textContent = elements.designReviewStatus.textContent;
  elements.designReviewStageStatus.dataset.status = elements.designReviewStatus.dataset.status;
}

function buildPlanMermaid(workItems) {
  const aliases = new Map();
  const lines = ["flowchart LR"];
  workItems.forEach((item, index) => {
    const alias = "PlanWork" + index;
    aliases.set(item.id, alias);
    lines.push(
      "  " + alias + "[\"" + escapeMermaidLabel(item.title)
        + "<br/>" + escapeMermaidLabel(item.agentId) + "\"]",
    );
  });
  for (const item of workItems) {
    for (const dependency of item.dependencies || []) {
      if (aliases.has(dependency)) {
        lines.push(
          "  " + aliases.get(dependency) + " --> " + aliases.get(item.id),
        );
      }
    }
  }
  return lines.join("\n");
}

function appendPlanList(host, items, emptyText) {
  host.replaceChildren();
  const values = Array.isArray(items) ? items : [];
  if (values.length === 0) {
    const empty = document.createElement("li");
    empty.className = "muted";
    empty.textContent = emptyText;
    host.append(empty);
    return;
  }
  for (const value of values) {
    const item = document.createElement("li");
    item.textContent = value;
    host.append(item);
  }
}

async function renderPlanDag(workItems) {
  const source = buildPlanMermaid(workItems);
  const signature = JSON.stringify([source, document.documentElement.dataset.colorMode]);
  if (diagramSignatures.get(elements.planDag) === signature) return;
  diagramSignatures.set(elements.planDag, signature);
  elements.planDag.dataset.diagramKey = "plan:" + currentState?.prototypeId;
  const renderId = ++planRenderId;
  elements.planDag.replaceChildren();
  hideDiagramControls(elements.planDag);
  elements.planDagStatus.textContent = "Rendering execution DAG...";
  elements.planDagStatus.dataset.status = "idle";
  try {
    const mermaid = await loadMermaid();
    const result = await mermaid.render(
      "tandem-plan-" + renderId,
      source,
    );
    if (renderId !== planRenderId) return;
    const view = captureView();
    elements.planDag.innerHTML = result.svg;
    if (typeof result.bindFunctions === "function") {
      result.bindFunctions(elements.planDag);
    }
    ensureDiagramControls(elements.planDag);
    restoreView(view);
    elements.planDagStatus.textContent = "";
  } catch {
    if (renderId !== planRenderId) return;
    diagramSignatures.delete(elements.planDag);
    elements.planDagStatus.textContent =
      "The execution DAG could not be rendered.";
    elements.planDagStatus.dataset.status = "error";
  }
}

function renderPlan(state, preserveMessage = false) {
  const isPlan =
    (state.lifecycle?.currentStage || "requirements") === "plan";
  elements.planTab.hidden = !hasStageData(state, "plan");
  if (elements.planTab.hidden) return;

  const planning = state.planning || {
    status: "idle",
    summary: "",
    strategy: "",
    maxAgents: 4,
    workItems: [],
    waves: [],
    agents: [],
    risks: [],
    metrics: {},
    processing: null,
    finalizedArtifactId: null,
    error: "",
  };
  const workItems = Array.isArray(planning.workItems)
    ? planning.workItems
    : [];
  const waves = Array.isArray(planning.waves) ? planning.waves : [];
  const agents = Array.isArray(planning.agents) ? planning.agents : [];
  const hasPlan = workItems.length > 0;
  const processing = Boolean(planning.processing);
  const finalized = planning.finalizedArtifactId === "execution-plan"
    && planning.status === "complete";
  const canSubmit = canEditStage("plan", state);

  if (!inputVersions.get(elements.planMaxAgents) && document.activeElement !== elements.planMaxAgents) {
    elements.planMaxAgents.value = String(planning.maxAgents || 4);
  }
  elements.planMaxAgents.disabled = processing || submitting || !canSubmit;
  elements.generatePlan.disabled = processing || submitting || !canSubmit;
  elements.generatePlan.textContent = processing
    ? planning.processing?.action === "revise"
      ? "Revising..."
      : "Generating..."
    : hasPlan
      ? "Regenerate plan"
      : "Generate plan";
  elements.finalizePlan.disabled =
    processing ||
    submitting ||
    !canSubmit ||
    !hasPlan ||
    planning.status !== "ready";
  elements.finalizePlan.textContent = finalized
    ? "Plan finalized"
    : "Finalize plan";
  elements.planProgress.textContent = processing
    ? "The planning agent is building an optimized execution schedule."
    : finalized
      ? "Execution plan captured and ready for implementation."
      : hasPlan
        ? workItems.length + " work items · " + waves.length
          + " parallel waves · " + agents.length + " agents"
        : "Generate work items, schedule waves, and agent assignments.";

  const metricValues = [
    [workItems.length, "Work items"],
    [waves.length, "Parallel waves"],
    [agents.length, "Agents"],
    [(planning.metrics?.scheduledHours || 0) + "h", "Elapsed schedule"],
    [
      (planning.metrics?.parallelismSavingsHours || 0) + "h",
      "Parallel time saved",
    ],
  ];
  elements.planMetrics.replaceChildren();
  for (const [value, label] of metricValues) {
    const card = document.createElement("div");
    card.className = "plan-metric";
    const strong = document.createElement("strong");
    strong.textContent = String(value);
    const span = document.createElement("span");
    span.textContent = label;
    card.append(strong, span);
    elements.planMetrics.append(card);
  }

  elements.planStrategySection.hidden = !hasPlan;
  elements.planStrategy.textContent = planning.strategy || planning.summary || "";
  elements.planDagSection.hidden = !hasPlan;
  elements.planColumns.hidden = !hasPlan;
  elements.planRevisionSection.hidden = !hasPlan;
  if (hasPlan) void renderPlanDag(workItems);

  elements.planWaves.replaceChildren();
  for (const wave of waves) {
    const card = document.createElement("div");
    card.className = "plan-wave";
    const heading = document.createElement("div");
    heading.className = "plan-wave-heading";
    const title = document.createElement("strong");
    title.textContent = "Wave " + wave.index;
    const timing = document.createElement("span");
    timing.textContent = "Hours " + wave.startHour + "–" + wave.endHour;
    heading.append(title, timing);
    const items = document.createElement("div");
    items.className = "plan-wave-items";
    for (const id of wave.workItemIds || []) {
      const workItem = workItems.find((candidate) => candidate.id === id);
      if (!workItem) continue;
      const pill = document.createElement("span");
      pill.className = "plan-wave-item";
      pill.textContent = workItem.agentId + " · " + workItem.title;
      items.append(pill);
    }
    card.append(heading, items);
    elements.planWaves.append(card);
  }

  elements.planWorkItems.replaceChildren();
  for (const item of workItems) {
    const details = document.createElement("details");
    details.className = "plan-work-item";
    details.dataset.uiKey = "plan-work:" + item.id;
    const summary = document.createElement("summary");
    summary.dataset.uiKey = "plan-work:" + item.id + ":summary";
    const heading = document.createElement("span");
    heading.className = "plan-work-item-heading";
    const title = document.createElement("strong");
    title.textContent = item.title;
    const meta = document.createElement("span");
    meta.className = "plan-work-item-meta";
    meta.textContent = item.agentId + " · " + item.estimatedHours + "h";
    heading.append(title, meta);
    summary.append(heading);

    const body = document.createElement("div");
    body.className = "plan-work-item-body";
    const description = document.createElement("p");
    description.textContent = item.description;
    const assignment = document.createElement("p");
    assignment.className = "plan-work-item-meta";
    assignment.textContent =
      "Role: " + item.agentRole
      + " · Dependencies: " + ((item.dependencies || []).join(", ") || "None")
      + " · Files: " + ((item.files || []).join(", ") || "Owned scope TBD");
    const criteriaHeading = document.createElement("strong");
    criteriaHeading.textContent = "Acceptance criteria";
    const criteria = document.createElement("ul");
    appendPlanList(criteria, item.acceptanceCriteria, "None recorded");
    const validationHeading = document.createElement("strong");
    validationHeading.textContent = "Validation";
    const validation = document.createElement("ul");
    appendPlanList(validation, item.validation, "None recorded");
    body.append(
      description,
      assignment,
      criteriaHeading,
      criteria,
      validationHeading,
      validation,
    );
    details.append(summary, body);
    elements.planWorkItems.append(details);
  }

  elements.planAgents.replaceChildren();
  for (const agent of agents) {
    const card = document.createElement("div");
    card.className = "plan-agent";
    const title = document.createElement("strong");
    title.textContent = agent.id;
    const meta = document.createElement("span");
    meta.className = "plan-agent-meta";
    meta.textContent =
      agent.estimatedHours + "h · "
      + (agent.roles || []).join(", ") + " · "
      + (agent.workItemIds || []).length + " items";
    card.append(title, meta);
    elements.planAgents.append(card);
  }
  appendPlanList(
    elements.planRisks,
    planning.risks,
    "No additional planning risks recorded.",
  );

  elements.planRevisionInput.disabled = processing || submitting || !canSubmit;
  elements.optimizePlan.disabled = processing || submitting || !canSubmit;
  elements.revisePlan.disabled = processing || submitting || !canSubmit;
  elements.revisePlan.textContent = processing ? "Revising..." : "Revise plan";

  if (!preserveMessage) {
    elements.planStatus.textContent = !isPlan
      ? "Execution plan is read only. Reopen Plan to change it."
      : !canSubmit
      ? "Open the installed user-scoped Tandem to generate the plan."
      : planning.error
        ? planning.error
        : processing
          ? "Planning continues asynchronously."
          : finalized
            ? "The final execution plan is available under Artifacts → Plan."
            : hasPlan
              ? "Review the schedule, revise it, then finalize the plan."
              : "Set the agent limit and generate the initial plan.";
    elements.planStatus.dataset.status =
      planning.status === "failed" || planning.error ? "error" : "idle";
  }
}

function implementationElapsed(startedAt, completedAt) {
  if (!startedAt) return "0m";
  const start = Date.parse(startedAt);
  const end = completedAt ? Date.parse(completedAt) : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "0m";
  const minutes = Math.max(0, Math.round((end - start) / 60000));
  if (minutes < 60) return minutes + "m";
  return Math.floor(minutes / 60) + "h " + (minutes % 60) + "m";
}

function appendImplementationEmpty(host, message) {
  const empty = document.createElement("p");
  empty.className = "muted";
  empty.textContent = message;
  host.append(empty);
}

function renderImplementation(state, preserveMessage = false) {
  const isImplementation =
    (state.lifecycle?.currentStage || "requirements") === "implement";
  elements.implementationTab.hidden = !hasStageData(state, "implement");
  if (elements.implementationTab.hidden) return;

  const planning = state.planning || { workItems: [], waves: [] };
  const implementation = state.implementation || {
    status: "idle",
    currentWaveIndex: 0,
    workItems: [],
    agents: [],
    strategySuggestions: [],
    events: [],
    error: "",
  };
  const runtime = state.implementationRuntime || null;
  const planItems = Array.isArray(planning.workItems)
    ? planning.workItems
    : [];
  const workItems = Array.isArray(implementation.workItems)
    ? implementation.workItems
    : [];
  const workById = new Map<string, AnyRecord>(
    workItems.map((item): [string, AnyRecord] => [item.id, item]),
  );
  const completed = workItems.filter(
    (item) => item.status === "completed",
  ).length;
  const running = workItems.filter(
    (item) => item.status === "running",
  ).length;
  const failed = workItems.filter((item) =>
    ["failed", "blocked", "cancelled"].includes(item.status),
  ).length;
  const active = ["starting", "running"].includes(implementation.status);
  const canSubmit = canEditStage("implement", state);
  const progress = workItems.length > 0
    ? Math.round((completed / workItems.length) * 100)
    : 0;

  elements.implementationProgress.textContent = active
    ? "Wave " + (implementation.currentWaveIndex || 1)
      + " is active · " + (runtime?.liveAgentCount ?? running) + " live agents"
    : implementation.status === "completed"
      ? "All planned work completed and final code was captured."
      : failed > 0
        ? "Review failures, adjust strategy, and retry incomplete work."
        : "Ready to assign the finalized work items.";
  elements.implementationProgressLabel.textContent =
    completed + " of " + workItems.length + " complete · " + progress + "%";
  elements.implementationProgressBar.style.width = progress + "%";

  elements.startImplementation.disabled =
    implementationSubmitting || active || !canSubmit
    || implementation.status === "completed" || planItems.length === 0;
  elements.startImplementation.textContent = implementation.status === "failed"
    || implementation.status === "cancelled"
    ? "Retry incomplete work"
    : implementation.status === "completed"
      ? "Implementation complete"
      : active
        ? "Agents running..."
        : "Start implementation";
  elements.stopImplementation.hidden = !active;
  elements.stopImplementation.disabled =
    implementationSubmitting || !canSubmit;
  elements.implementationStrategyInput.disabled =
    implementationSubmitting || !canSubmit
    || implementation.status === "completed";
  elements.submitImplementationStrategy.disabled =
    implementationSubmitting || !canSubmit
    || implementation.status === "completed";
  elements.submitImplementationStrategy.textContent =
    implementationSubmitting ? "Queueing..." : "Queue adjustment";

  const metrics = [
    [completed + "/" + workItems.length, "Completed"],
    [runtime?.liveAgentCount ?? running, "Live agents"],
    [implementation.currentWaveIndex || 0, "Current wave"],
    [failed, "Needs attention"],
    [
      implementationElapsed(
        implementation.startedAt,
        implementation.completedAt,
      ),
      "Elapsed",
    ],
  ];
  elements.implementationMetrics.replaceChildren();
  for (const [value, label] of metrics) {
    const card = document.createElement("div");
    card.className = "plan-metric";
    const strong = document.createElement("strong");
    strong.textContent = String(value);
    const span = document.createElement("span");
    span.textContent = label;
    card.append(strong, span);
    elements.implementationMetrics.append(card);
  }

  elements.implementationWaves.replaceChildren();
  for (const wave of planning.waves || []) {
    const states = (wave.workItemIds || []).map(
      (id) => workById.get(id)?.status || "pending",
    );
    const waveStatus = states.length > 0
      && states.every((status) => status === "completed")
      ? "completed"
      : states.some((status) => status === "running")
        ? "running"
        : states.some((status) =>
          ["failed", "blocked", "cancelled"].includes(status))
          ? "failed"
          : "pending";
    const card = document.createElement("div");
    card.className = "implementation-card";
    card.dataset.status = waveStatus;
    const heading = document.createElement("div");
    heading.className = "implementation-card-heading";
    const title = document.createElement("strong");
    title.textContent = "Wave " + wave.index;
    const badge = document.createElement("span");
    badge.className = "implementation-badge";
    badge.textContent = waveStatus;
    heading.append(title, badge);
    const meta = document.createElement("p");
    meta.className = "implementation-meta";
    meta.textContent = (wave.workItemIds || []).map((id) => {
      const planItem = planItems.find((item) => item.id === id);
      return planItem?.title || id;
    }).join(" · ");
    card.append(heading, meta);
    elements.implementationWaves.append(card);
  }
  if (!(planning.waves || []).length) {
    appendImplementationEmpty(
      elements.implementationWaves,
      "No execution waves are available.",
    );
  }

  elements.implementationWorkItems.replaceChildren();
  for (const planItem of planItems) {
    const item = workById.get(planItem.id) || {
      status: "pending",
      summary: "",
      filesChanged: [],
      validation: [],
      blockers: [],
    };
    const card = document.createElement("details");
    card.className = "implementation-card";
    card.dataset.uiKey = "implementation-work:" + planItem.id;
    card.dataset.status = item.status;
    if (["running", "failed", "blocked"].includes(item.status)) card.open = true;
    const summary = document.createElement("summary");
    summary.dataset.uiKey = "implementation-work:" + planItem.id + ":summary";
    summary.className = "implementation-card-heading";
    const title = document.createElement("strong");
    title.textContent = planItem.title;
    const badge = document.createElement("span");
    badge.className = "implementation-badge";
    badge.textContent = item.status;
    summary.append(title, badge);
    const body = document.createElement("div");
    const assignment = document.createElement("p");
    assignment.className = "implementation-meta";
    assignment.textContent =
      planItem.agentId + " · " + planItem.agentRole
      + " · dependencies: "
      + ((planItem.dependencies || []).join(", ") || "none");
    body.append(assignment);
    if (item.summary) {
      const outcome = document.createElement("p");
      outcome.textContent = item.summary;
      body.append(outcome);
    }
    if ((item.filesChanged || []).length > 0) {
      const files = document.createElement("p");
      files.className = "implementation-meta";
      files.textContent = "Files: " + item.filesChanged.join(", ");
      body.append(files);
    }
    if ((item.validation || []).length > 0) {
      const validation = document.createElement("p");
      validation.className = "implementation-meta";
      validation.textContent = "Validation: " + item.validation.join(" · ");
      body.append(validation);
    }
    if ((item.blockers || []).length > 0) {
      const blockers = document.createElement("p");
      blockers.textContent = "Blocked: " + item.blockers.join(" · ");
      body.append(blockers);
    }
    card.append(summary, body);
    elements.implementationWorkItems.append(card);
  }

  const liveByWorkItem = new Map<string, AnyRecord>(
    (runtime?.agents || []).map(
      (agent): [string, AnyRecord] => [
        String(agent.label || "").replace(/^work:/, ""),
        agent,
      ],
    ),
  );
  const storedByWorkItem = new Map<string, AnyRecord>(
    (implementation.agents || []).map(
      (agent): [string, AnyRecord] => [agent.workItemId, agent],
    ),
  );
  const agentWorkItemIds = new Set([
    ...storedByWorkItem.keys(),
    ...liveByWorkItem.keys(),
  ]);
  elements.implementationAgents.replaceChildren();
  for (const workItemId of agentWorkItemIds) {
    const stored = storedByWorkItem.get(workItemId) || {};
    const live = liveByWorkItem.get(workItemId) || {};
    const planItem = planItems.find((item) => item.id === workItemId);
    const status = live.status || stored.status || "pending";
    const card = document.createElement("div");
    card.className = "implementation-card";
    card.dataset.status = status;
    const heading = document.createElement("div");
    heading.className = "implementation-card-heading";
    const title = document.createElement("strong");
    title.textContent = planItem?.agentId || stored.id || "Implementation agent";
    const badge = document.createElement("span");
    badge.className = "implementation-badge";
    badge.textContent = status;
    heading.append(title, badge);
    const meta = document.createElement("p");
    meta.className = "implementation-meta";
    meta.textContent =
      (planItem?.agentRole || stored.role || "Implementation")
      + " · " + (planItem?.title || workItemId)
      + (live.model ? " · " + live.model : "")
      + (live.activeMs ? " · " + Math.round(live.activeMs / 1000) + "s active" : "");
    const activity = document.createElement("p");
    activity.textContent =
      live.activity || stored.activity || stored.summary || "Waiting for activity.";
    card.append(heading, meta, activity);
    elements.implementationAgents.append(card);
  }
  if (agentWorkItemIds.size === 0) {
    appendImplementationEmpty(
      elements.implementationAgents,
      "Agents appear here after implementation starts.",
    );
  }

  elements.implementationStrategies.replaceChildren();
  for (const suggestion of [...(implementation.strategySuggestions || [])].reverse()) {
    const card = document.createElement("div");
    card.className = "implementation-strategy";
    const heading = document.createElement("div");
    heading.className = "implementation-card-heading";
    const badge = document.createElement("span");
    badge.className = "implementation-badge";
    badge.textContent = suggestion.status;
    const meta = document.createElement("span");
    meta.className = "implementation-meta";
    meta.textContent = suggestion.waveIndex
      ? "Applied to wave " + suggestion.waveIndex
      : "Applies at the next wave boundary";
    heading.append(badge, meta);
    const text = document.createElement("p");
    text.textContent = suggestion.text;
    card.append(heading, text);
    elements.implementationStrategies.append(card);
  }

  const activity = [
    ...(implementation.events || []).map((event) => ({
      id: event.id,
      text: event.message,
      at: Date.parse(event.at) || 0,
    })),
    ...(runtime?.progress || []).map((event) => ({
      id: "runtime-" + event.seq,
      text: event.text,
      at: Number(event.recordedAt) || 0,
    })),
  ].sort((left, right) => right.at - left.at).slice(0, 20);
  elements.implementationEvents.replaceChildren();
  for (const event of activity) {
    const card = document.createElement("div");
    card.className = "implementation-event";
    const heading = document.createElement("div");
    heading.className = "implementation-event-heading";
    const text = document.createElement("p");
    text.textContent = event.text;
    const time = document.createElement("time");
    time.textContent = event.at
      ? new Date(event.at).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })
      : "";
    heading.append(text, time);
    card.append(heading);
    elements.implementationEvents.append(card);
  }
  if (activity.length === 0) {
    appendImplementationEmpty(
      elements.implementationEvents,
      "Run events and factory progress appear here.",
    );
  }

  if (!preserveMessage) {
    elements.implementationStatus.textContent = !isImplementation
      ? "Implementation evidence is read only."
      : !canSubmit
      ? "Open the installed user-scoped Tandem to run implementation."
      : runtime?.error
        ? "Live agent details are unavailable: " + runtime.error
      : implementation.error
        ? implementation.error
        : active
          ? "Suggestions are queued immediately and applied before the next wave."
          : implementation.status === "completed"
            ? "Final code is available under Artifacts → Implement."
            : failed > 0
              ? "Retry preserves completed work and reruns only incomplete items."
              : "Start the agents when the execution plan is ready.";
    elements.implementationStatus.dataset.status =
      implementation.status === "failed" || implementation.error || runtime?.error
        ? "error"
        : "idle";
  }
}

function renderTest(state, preserveMessage = false) {
  const isTest = (state.lifecycle?.currentStage || "requirements") === "test";
  elements.testTab.hidden = !hasStageData(state, "test");
  if (elements.testTab.hidden) return;

  const specs = Array.isArray(state.testDesignReview?.scenarios)
    ? state.testDesignReview.scenarios
    : [];
  const testing = state.testing || {
    status: "idle",
    currentWaveIndex: 0,
    scenarios: [],
    agents: [],
    events: [],
    error: "",
  };
  const runtime = state.testRuntime || null;
  const results = Array.isArray(testing.scenarios) ? testing.scenarios : [];
  const resultById = new Map<string, AnyRecord>(
    results.map((scenario): [string, AnyRecord] => [scenario.id, scenario]),
  );
  const passed = results.filter((scenario) => scenario.status === "passed").length;
  const running = results.filter((scenario) => scenario.status === "running").length;
  const failed = results.filter((scenario) =>
    ["failed", "blocked"].includes(scenario.status),
  ).length;
  const active = ["starting", "running"].includes(testing.status);
  const complete = testing.status === "completed";
  const canSubmit = canEditStage("test", state, true);
  const progress = results.length > 0
    ? Math.round((passed / results.length) * 100)
    : 0;

  elements.testProgress.textContent = active
    ? "Wave " + (testing.currentWaveIndex || 1) + " is active · "
      + (runtime?.liveAgentCount ?? running) + " live agents"
    : complete
      ? "All approved scenarios passed and test evidence was captured."
      : failed > 0
        ? "Review failed or blocked scenarios, then retry incomplete tests."
        : "Ready to execute the approved test specification.";
  elements.testProgressLabel.textContent =
    passed + " of " + results.length + " passed · " + progress + "%";
  elements.testProgressBar.style.width = progress + "%";
  elements.startTests.disabled =
    hasPendingRequest() || active || !canSubmit || specs.length === 0 || hasActiveJobs(state);
  elements.startTests.textContent = complete
    ? "Run tests again"
    : active
      ? "Tests running..."
      : failed > 0
        ? "Retry incomplete tests"
        : "Run tests";

  const metrics = [
    [passed + "/" + results.length, "Passed"],
    [runtime?.liveAgentCount ?? running, "Live agents"],
    [testing.currentWaveIndex || 0, "Current wave"],
    [failed, "Needs attention"],
    [implementationElapsed(testing.startedAt, testing.completedAt), "Elapsed"],
  ];
  elements.testMetrics.replaceChildren();
  for (const [value, label] of metrics) {
    const card = document.createElement("div");
    card.className = "plan-metric";
    const strong = document.createElement("strong");
    strong.textContent = String(value);
    const span = document.createElement("span");
    span.textContent = label;
    card.append(strong, span);
    elements.testMetrics.append(card);
  }

  elements.testScenarios.replaceChildren();
  for (const spec of specs) {
    const result = resultById.get(spec.id) || {
      status: "pending",
      summary: "",
      evidence: [],
    };
    const card = document.createElement("details");
    card.className = "implementation-card";
    card.dataset.uiKey = "test-scenario:" + spec.id;
    card.dataset.status = result.status;
    if (["running", "failed", "blocked"].includes(result.status)) card.open = true;
    const summary = document.createElement("summary");
    summary.dataset.uiKey = "test-scenario:" + spec.id + ":summary";
    summary.className = "implementation-card-heading";
    const title = document.createElement("strong");
    title.textContent = spec.title;
    const badge = document.createElement("span");
    badge.className = "implementation-badge";
    badge.textContent = result.status;
    summary.append(title, badge);
    const body = document.createElement("div");
    const meta = document.createElement("p");
    meta.className = "implementation-meta";
    meta.textContent =
      String(spec.type || "integration") + " · dependencies: "
      + ((spec.dependencies || []).join(", ") || "none");
    body.append(meta);
    if (spec.description) {
      const description = document.createElement("p");
      description.textContent = spec.description;
      body.append(description);
    }
    if (result.summary) {
      const outcome = document.createElement("p");
      outcome.textContent = result.summary;
      body.append(outcome);
    }
    if ((result.evidence || []).length > 0) {
      const evidenceHeading = document.createElement("strong");
      evidenceHeading.textContent = "Evidence";
      const evidence = document.createElement("ul");
      appendPlanList(evidence, result.evidence, "No evidence captured.");
      body.append(evidenceHeading, evidence);
    }
    card.append(summary, body);
    elements.testScenarios.append(card);
  }
  if (specs.length === 0) {
    appendImplementationEmpty(
      elements.testScenarios,
      "Finalize Test design to create executable scenarios.",
    );
  }

  const liveByScenario = new Map<string, AnyRecord>(
    (runtime?.agents || []).map(
      (agent): [string, AnyRecord] => [
        String(agent.label || "").replace(/^test:/, ""),
        agent,
      ],
    ),
  );
  const storedByScenario = new Map<string, AnyRecord>(
    (testing.agents || []).map(
      (agent): [string, AnyRecord] => [agent.scenarioId, agent],
    ),
  );
  const agentScenarioIds = new Set([
    ...storedByScenario.keys(),
    ...liveByScenario.keys(),
  ]);
  elements.testAgents.replaceChildren();
  for (const scenarioId of agentScenarioIds) {
    const stored = storedByScenario.get(scenarioId) || {};
    const live = liveByScenario.get(scenarioId) || {};
    const spec = specs.find((candidate) => candidate.id === scenarioId);
    const status = live.status || stored.status || "pending";
    const card = document.createElement("div");
    card.className = "implementation-card";
    card.dataset.status = status;
    const heading = document.createElement("div");
    heading.className = "implementation-card-heading";
    const title = document.createElement("strong");
    title.textContent = stored.id || "Test agent";
    const badge = document.createElement("span");
    badge.className = "implementation-badge";
    badge.textContent = status;
    heading.append(title, badge);
    const meta = document.createElement("p");
    meta.className = "implementation-meta";
    meta.textContent =
      (spec?.type || "integration") + " · " + (spec?.title || scenarioId)
      + (live.model ? " · " + live.model : "")
      + (live.activeMs ? " · " + Math.round(live.activeMs / 1000) + "s active" : "");
    const activity = document.createElement("p");
    activity.textContent =
      live.activity || stored.activity || stored.summary || "Waiting for activity.";
    card.append(heading, meta, activity);
    elements.testAgents.append(card);
  }
  if (agentScenarioIds.size === 0) {
    appendImplementationEmpty(
      elements.testAgents,
      "Agents appear here after test execution starts.",
    );
  }

  const activity = [
    ...(testing.events || []).map((event) => ({
      id: event.id,
      text: event.message,
      at: Date.parse(event.at) || 0,
    })),
    ...(runtime?.progress || []).map((event) => ({
      id: "runtime-" + event.seq,
      text: event.text,
      at: Number(event.recordedAt) || 0,
    })),
  ].sort((left, right) => right.at - left.at).slice(0, 20);
  elements.testEvents.replaceChildren();
  for (const event of activity) {
    const card = document.createElement("div");
    card.className = "implementation-event";
    const heading = document.createElement("div");
    heading.className = "implementation-event-heading";
    const text = document.createElement("p");
    text.textContent = event.text;
    const time = document.createElement("time");
    time.textContent = event.at
      ? new Date(event.at).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })
      : "";
    heading.append(text, time);
    card.append(heading);
    elements.testEvents.append(card);
  }
  if (activity.length === 0) {
    appendImplementationEmpty(
      elements.testEvents,
      "Test events and factory progress appear here.",
    );
  }

  const failedResults = results.filter((scenario) =>
    ["failed", "blocked"].includes(scenario.status)
  );
  const errorDetails = testing.errorDetails || JSON.stringify(
    {
      summary: testing.error || runtime?.error || "Test execution failed.",
      run: {
        id: testing.runId || runtime?.runId || "unavailable",
        status: testing.status || runtime?.status || "failed",
      },
      failedScenarios: failedResults.map((scenario) => ({
        id: scenario.id,
        status: scenario.status,
        summary: scenario.summary,
        evidence: scenario.evidence || [],
      })),
      failedAgents: (testing.agents || [])
        .filter((agent) => ["failed", "blocked"].includes(agent.status))
        .map((agent) => ({
          id: agent.id,
          scenarioId: agent.scenarioId,
          status: agent.status,
          activity: agent.activity,
          summary: agent.summary,
        })),
      errorEvents: (testing.events || []).filter((event) => event.type === "error"),
    },
    null,
    2,
  );
  const hasErrorDetails = Boolean(
    testing.status === "failed"
    || testing.error
    || runtime?.error
    || failedResults.length > 0
  );
  const errorSignature = hasErrorDetails
    ? [testing.requestId || testing.runId || runtime?.runId || "legacy", testing.startedAt].join("|")
    : "";
  if (errorSignature !== testErrorDetailsSignature) {
    testErrorDetailsSignature = errorSignature;
    testErrorDetailsExpanded = false;
  }
  elements.testErrorToggle.hidden = !hasErrorDetails;
  elements.testErrorToggle.textContent = testErrorDetailsExpanded
    ? "Hide error details"
    : "Show error details";
  elements.testErrorToggle.setAttribute(
    "aria-expanded",
    String(testErrorDetailsExpanded),
  );
  elements.testErrorDetails.hidden =
    !hasErrorDetails || !testErrorDetailsExpanded;
  elements.testErrorDetails.textContent = hasErrorDetails ? errorDetails : "";

  if (!preserveMessage) {
    elements.testStatus.textContent = !isTest
      ? "Test evidence is read only."
      : !canSubmit
      ? "Open the installed user-scoped Tandem to run tests."
      : runtime?.error
        ? "Live agent details are unavailable: " + runtime.error
        : testing.error
          ? testing.error
          : active
            ? "Independent scenarios run concurrently within each dependency wave."
            : complete
              ? "Test results are available under Artifacts → Test."
              : failed > 0
                ? "Retry preserves passes only when source and specification are unchanged; otherwise all scenarios run again."
                : "Run the approved integration and interaction scenarios.";
    elements.testStatus.dataset.status =
      testing.status === "failed" || testing.error || runtime?.error
        ? "error"
        : "idle";
  }
}

function renderPrototypeProgress(state, building, active, preserveMessage) {
  const flow = state.prototypeFlow;
  const pending = prototypeCheckpoint(state, flow?.pendingCheckpointId);
  const failed = failedPrototypeCheckpoint(state);
  const failedRevision = failedPrototypeRevision(state);
  const checkpoints = flow?.checkpoints || [];
  const milestonesReady = prototypeMilestoneReady(state, "structure")
    && prototypeMilestoneReady(state, "interaction")
    && (!flow?.visualRequested || prototypeMilestoneReady(state, "visual"));
  const unresolved = (state.prototypeReview?.revisions || []).some((revision) =>
    UNRESOLVED_REVISIONS.includes(revision.status));
  const exhausted = flow && flow.budget.usedSeconds >= flow.budget.limitSeconds;
  const blocked = hasPendingRequest() || !canEditStage("prototype", state)
    || hasActiveJobs(state) || prototypeFinalizing(state) || Boolean(state.prototypeReview?.question);
  elements.prototypeProgress.hidden = Boolean(skippedStage(state, "prototype"))
    || (!flow && ((Boolean(state.previewUrl) && !failedRevision) || currentStage(state) !== "prototype"));
  elements.prototypeMilestones.hidden = !flow && Boolean(state.previewUrl);
  elements.prototypeMilestones.replaceChildren();
  for (const milestone of PROTOTYPE_MILESTONES) {
    const latest = checkpoints.filter((checkpoint) => checkpoint.milestone === milestone.id).at(-1);
    const ready = prototypeMilestoneReady(state, milestone.id);
    const skippedVisual = milestone.id === "visual" && !flow?.visualRequested && latest?.status === "failed";
    const item = document.createElement("li");
    const label = document.createElement("strong");
    label.textContent = milestone.label;
    const status = document.createElement("span");
    status.textContent = skippedVisual ? "Skipped (optional)"
      : latest?.id === pending?.id && pending
      ? "Update ready — apply when ready"
      : latest?.status === "running" ? "Building"
      : latest?.status === "clarifying" ? "Needs clarification"
      : latest?.status === "failed" ? "Failed — retry available"
      : ready ? "Ready"
      : milestone.id === "visual" && !flow?.visualRequested ? "Optional"
      : "Waiting";
    item.dataset.milestone = milestone.id;
    item.dataset.status = skippedVisual ? "skipped" : latest?.status || "waiting";
    if (active?.milestone === milestone.id) item.setAttribute("aria-current", "step");
    item.append(label, status);
    elements.prototypeMilestones.append(item);
  }
  elements.prototypeProgressMessage.textContent = pending
    ? "Update ready. " + (pending.summary || "The next checkpoint has been validated.")
      + " Your displayed preview will not change until you choose Apply update."
    : state.prototypeReview?.question
      ? "A revision needs clarification. Keep exploring and queue feedback below."
    : building
      ? state.previewUrl ? "Your working preview stays available while the next checkpoint builds."
        : "Building the first runnable checkpoint. No preview is available yet; you can already queue feedback."
    : failed
      ? "The latest update failed. " + (failed.summary || state.processing?.message || "")
        + (state.previewUrl ? " Your working preview is unchanged." : "")
    : failedRevision
      ? "A feedback revision failed. Retry the failed revision to continue."
        + (state.previewUrl ? " Your working preview is unchanged." : "")
    : exhausted && (!milestonesReady || unresolved)
      ? "Prototype work is paused at its work-window limit. Your preview and queued feedback are kept."
    : milestonesReady
      ? flow?.visualRequested ? "All requested checkpoints are ready. Finish Prototype when no revisions remain."
        : "Structure and Interaction are ready. Finish Prototype, or optionally explore visual direction."
    : "Start with Structure, then test one complete Interaction. Visual direction is optional.";
  elements.prototypeProgressMessage.dataset.essential = String(Boolean(
    pending || failed || failedRevision || state.prototypeReview?.question || exhausted && !building,
  ));
  elements.prototypeBudget.textContent = flow
    ? `Work window: ${Math.ceil(flow.budget.usedSeconds / 60)} of ${Math.ceil(flow.budget.limitSeconds / 60)} minutes used`
      + (building ? " or reserved for active work. Unused reserved time is returned when the job ends." : ".")
    : "";
  elements.applyPrototypeUpdate.hidden = !pending;
  elements.applyPrototypeUpdate.disabled = blocked;
  elements.applyPrototypeUpdate.textContent = prototypeSubmitting ? "Applying update..." : "Apply update";
  elements.requestPrototypeVisual.hidden = !flow || flow.visualRequested || building || hasActiveJobs(state)
    || !prototypeMilestoneReady(state, "interaction") || Boolean(pending);
  elements.requestPrototypeVisual.disabled = blocked || unresolved || exhausted;
  elements.skipPrototypeVisual.hidden = !flow?.visualRequested || failed?.milestone !== "visual"
    || Boolean(failed?.revisionId) || hasActiveJobs(state);
  elements.skipPrototypeVisual.disabled = blocked;
  elements.retryPrototypeCheckpoint.hidden = (!flow && !failedRevision) || Boolean(pending) || Boolean(state.prototypeReview?.question)
    || building || exhausted || (!failed && !failedRevision && milestonesReady && !unresolved);
  elements.retryPrototypeCheckpoint.disabled = blocked;
  elements.retryPrototypeCheckpoint.textContent = failed
    ? "Retry " + (PROTOTYPE_MILESTONES.find((milestone) => milestone.id === failed.milestone)?.label || "checkpoint")
    : failedRevision ? "Retry failed revision"
    : "Continue prototype work";
  elements.extendPrototypeBudget.hidden = !exhausted || building || Boolean(pending);
  elements.extendPrototypeBudget.disabled = blocked;
  if (!preserveMessage || prototypeActionError) {
    elements.prototypeActionStatus.textContent = prototypeActionError;
    elements.prototypeActionStatus.dataset.status = prototypeActionError ? "error" : "idle";
  }
}

function renderPreview(state, preserveMessage = false) {
  const stage = currentStage(state);
  const previewStatus = state.previewStatus || "waiting";
  const prototypeUnavailable = Boolean(skippedStage(state, "prototype"));
  const prototypeReason = skippedStage(state, "prototype")?.reason
    || "No graphical interface needs prototype validation.";
  const validateExisting = state.prototypeApproach?.mode === "validate-existing";
  const undecided = state.prototypeApproach?.mode === "undecided";
  const build = state.processing?.action === "build-prototype" ? state.processing : null;
  const flow = state.prototypeFlow;
  const active = prototypeCheckpoint(state, flow?.activeCheckpointId)
    || (flow?.checkpoints || []).find((checkpoint) => checkpoint.status === "running");
  const displayed = prototypeCheckpoint(state, flow?.displayedCheckpointId);
  const pending = prototypeCheckpoint(state, flow?.pendingCheckpointId);
  const building = !prototypeUnavailable && !undecided && stage === "prototype"
    && (active?.status === "running" || previewStatus === "starting" || build?.status === "running"
      || (["submit-revision", "clarify-revision"].includes(state.processing?.action) && state.processing?.status === "running"));
  const url = flow ? displayed?.previewUrl || (displayed ? state.previewUrl : null) : state.previewUrl;
  const workingPreview = Boolean(url && (displayed?.status === "ready" || previewStatus === "ready"
    || elements.previewFrame.dataset.url === url));
  renderPrototypeProgress(state, building, active, preserveMessage);
  elements.previewTab.disabled = prototypeUnavailable;
  elements.previewTab.title = prototypeUnavailable ? prototypeReason : "";
  if (prototypeUnavailable && activeOutputTab === "preview") {
    activeOutputTab = stageTab(stage === "prototype" ? "requirements" : stage);
  }
  elements.previewStatus.textContent = prototypeUnavailable
    ? "not applicable"
    : pending ? "update ready"
    : building
      ? workingPreview ? "preview ready · building update" : "building"
      : previewStatus;
  elements.previewTab.classList.toggle("prototype-building-tab", building);
  elements.previewTab.setAttribute(
    "aria-label",
    prototypeUnavailable
      ? "Live prototype, not applicable. " + prototypeReason
      : building
        ? validateExisting ? "Live prototype, validating existing app" : "Live prototype, building"
        : "Live prototype",
  );
  elements.prototypeBuildingTitle.textContent = active
    ? "Building " + (PROTOTYPE_MILESTONES.find((milestone) => milestone.id === active.milestone)?.label || "update")
    : validateExisting
    ? "Validating existing prototype"
    : "Building runnable prototype";
  elements.prototypeBuilding.hidden = !building;

  if (prototypeBuildMessageTimer !== null) {
    window.clearInterval(prototypeBuildMessageTimer);
    prototypeBuildMessageTimer = null;
  }
  if (building) {
    elements.prototypeBuildingMessage.textContent =
      state.processing?.message || active?.focus || build?.message || state.status
      || (validateExisting ? "Existing prototype validation is running." : "Prototype build is running.");
    elements.prototypeBuildingMessage.title = elements.prototypeBuildingMessage.textContent;
    const updateMessage = () => {
      elements.prototypeBuildingElapsed.textContent = elapsedLabel(active?.requestedAt || build?.requestedAt);
    };
    updateMessage();
    prototypeBuildMessageTimer = window.setInterval(updateMessage, 1000);
  } else {
    elements.prototypeBuildingElapsed.textContent = "";
  }

  elements.startPrototype.hidden = prototypeUnavailable || building || workingPreview
    || Boolean(flow) || previewStatus === "ready" || stage !== "prototype";
  elements.startPrototype.disabled = hasPendingRequest()
    || !canEditStage("prototype", state) || hasActiveJobs(state);
  elements.startPrototype.textContent = prototypeSubmitting ? "Requesting..."
    : validateExisting
      ? previewStatus === "error" ? "Retry existing prototype validation" : "Validate existing prototype"
      : previewStatus === "error" ? "Retry prototype build" : "Start prototype";
  elements.previewEmptyMessage.textContent = prototypeUnavailable
    ? "Live prototype is not applicable. " + prototypeReason
    : undecided
      ? "Choose the prototype approach in Requirements before starting prototype work."
    : building
      ? "The runnable preview will appear here after its first checkpoint is validated. Feedback can be queued below."
    : previewStatus === "error"
      ? "Prototype " + (validateExisting ? "validation" : "build") + " failed. Review the error, then retry."
    : stage === "prototype"
      ? validateExisting
        ? "No prototype validation is running. Validate the existing app without replacing it."
        : "No prototype build is running. Start a build to create the runnable preview."
      : "The runnable prototype will appear after Requirements are completed.";
  if (!preserveMessage) {
    elements.prototypeBuildStatus.textContent = previewStatus === "error"
      ? build?.message || state.status || "The preview is unavailable."
      : "";
    elements.prototypeBuildStatus.dataset.status = previewStatus === "error" ? "error" : "idle";
  }
  if (prototypeUnavailable || undecided || !workingPreview) {
    elements.previewEmpty.style.display = "grid";
    elements.previewFrame.style.display = "none";
    elements.openPreview.style.display = "none";
    return;
  }

  elements.previewEmpty.style.display = "none";
  elements.previewFrame.style.display = "block";
  elements.openPreview.style.display = "inline";
  elements.openPreview.href = url;
  const checkpointId = flow?.displayedCheckpointId || "";
  if (elements.previewFrame.dataset.url !== url || (elements.previewFrame.dataset.checkpointId || "") !== checkpointId) {
    elements.previewFrame.dataset.url = url;
    elements.previewFrame.dataset.checkpointId = checkpointId;
    elements.previewFrame.src = url;
  }
}

function clearNextAction() {
  for (const element of document.querySelectorAll(
    ".next-action-target, .next-action-tab",
  )) {
    element.classList.remove("next-action-target", "next-action-tab");
    element.removeAttribute("data-next-action-label");
    element.removeAttribute("aria-describedby");
    const original = (element as HTMLElement).dataset.originalTitle;
    if (original) element.setAttribute("title", original);
    else element.removeAttribute("title");
    delete (element as HTMLElement).dataset.originalTitle;
  }
}

function nextActionForState(state) {
  if (
    effortSubmitting ||
    state.effortReset ||
    isGoalEntry(state) ||
    completingStage ||
    submitting ||
    preparationSubmitting ||
    implementationSubmitting ||
    testSubmitting ||
    preparationSubmitting ||
    prototypeSubmitting || reopeningStage ||
    state.provider?.canSubmitAnswers === false
  ) {
    return null;
  }

  const stage = state.lifecycle?.currentStage || "prepare";
  if (stage === "prepare") {
    if (state.preparation?.status === "failed" && !elements.retryPreparation.disabled) {
      return {
        tab: "preparation",
        target: elements.retryPreparation,
        label: "Retry preparation",
      };
    }
    return null;
  }
  if (stage === "requirements") {
    if (state.processing?.status === "running") return null;
    if (state.requirements?.substage !== "dag") {
      const hasUsages = (state.requirements?.usageItems || []).length > 0;
      return hasUsages
        ? {
            tab: "design-tree",
            target: elements.generateDag,
            label: state.processing?.action === "generate-dag" && state.processing.status === "error"
              ? "Retry the requirements DAG" : "Generate the requirements DAG",
          }
        : {
            tab: "design-tree",
            target: elements.addUsage,
            label: "Add the first usage",
          };
    }
    if ((state.decisionGraph?.nodes || []).some((node) => node.status === "active")) {
      return {
        tab: "design-tree",
        target: elements.questionHost.querySelector(".send"),
        label: "Answer the active requirement decision",
      };
    }
    if (!elements.completeStage.disabled) {
      return {
        target: elements.completeStage,
        label: "Finish requirements collection",
      };
    }
    return null;
  }

  if (stage === "prototype") {
    if (state.processing?.status === "running") return null;
    for (const [target, label] of [
      [elements.applyPrototypeUpdate, "Apply the prepared prototype update"],
      [elements.extendPrototypeBudget, "Review an additional prototype work window"],
      [elements.retryPrototypeCheckpoint, "Retry incomplete prototype work"],
    ]) {
      if (!target.hidden && !target.disabled) return { tab: "preview", target, label };
    }
    if (state.previewStatus !== "ready" && !elements.startPrototype.hidden && !elements.startPrototype.disabled) {
      return {
        tab: "preview",
        target: elements.startPrototype,
        label: state.prototypeApproach?.mode === "validate-existing"
          ? "Validate the existing prototype"
          : state.previewStatus === "error" ? "Retry the prototype build" : "Start the prototype build",
      };
    }
    if (state.prototypeReview?.question) {
      return {
        tab: "preview",
        target: elements.submitClarification,
        label: "Answer the prototype clarification",
      };
    }
    if (!elements.completeStage.disabled) {
      return {
        target: elements.completeStage,
        label: "Finish prototype iteration",
      };
    }
    return null;
  }

  if (stage === "design") {
    const review = state.design?.substage === "test"
      ? state.testDesignReview
      : state.designReview;
    if (review?.processing || review?.finalizeRequested) return null;
    const failed = document.querySelector(
      '[data-thread-action="retry"]',
    );
    if (failed) {
      return {
        tab: failed.closest("#artifact-review") ? "content" : "design-review",
        target: failed,
        label: "Retry the failed design review request",
      };
    }
    const resolve = elements.artifactReviewThreads.querySelector(
      '[data-thread-action="resolve"]',
    );
    if (resolve) {
      return {
        tab: "content",
        target: resolve,
        label: "Mark the answered design thread resolved",
      };
    }
    const threadToReview = (review?.threads || []).find(
      (thread) => ["answered", "failed"].includes(thread.status),
    );
    if (threadToReview) {
      const link = Array.from(
        elements.designReviewThreads.querySelectorAll(".review-artifact-link"),
      ).find((candidate: HTMLElement) =>
        candidate.dataset.threadId === threadToReview.id
      );
      if (link) {
        return {
          tab: "design-review",
          target: link,
          label: "Open the design artifact for review",
        };
      }
    }
    if (!elements.finishReview.disabled) {
      return {
        tab: "design-review",
        target: elements.finishReview,
        label: state.design?.substage === "test"
          ? "Finish integration and interaction test design"
          : "Finish product design",
      };
    }
    if (!elements.completeStage.disabled) {
      return {
        target: elements.completeStage,
        label: "Finish the Design stage",
      };
    }
    return null;
  }

  if (stage === "plan") {
    if (state.planning?.processing) return null;
    if (!elements.completeStage.disabled) {
      return {
        target: elements.completeStage,
        label: "Finish execution planning",
      };
    }
    const hasPlan = (state.planning?.workItems || []).length > 0;
    if (hasPlan && !elements.finalizePlan.disabled) {
      return {
        tab: "plan",
        target: elements.finalizePlan,
        label: "Finalize the execution plan",
      };
    }
    if (!elements.generatePlan.disabled) {
      return {
        tab: "plan",
        target: elements.generatePlan,
        label: hasPlan ? "Regenerate the execution plan" : "Generate the execution plan",
      };
    }
    return null;
  }

  if (stage === "implement") {
    if (["starting", "running"].includes(state.implementation?.status)) return null;
    if (!elements.completeStage.disabled) {
      return {
        target: elements.completeStage,
        label: "Finish implementation",
      };
    }
    if (!elements.startImplementation.disabled) {
      return {
        tab: "implementation",
        target: elements.startImplementation,
        label: ["failed", "cancelled"].includes(state.implementation?.status)
          ? "Retry incomplete implementation work"
          : "Start implementation",
      };
    }
    return null;
  }

  if (stage === "test") {
    if (["starting", "running"].includes(state.testing?.status)) return null;
    if (!elements.completeStage.disabled) {
      return {
        target: elements.completeStage,
        label: "Finish integration testing",
      };
    }
    if (!elements.startTests.disabled) {
      return {
        tab: "test",
        target: elements.startTests,
        label: (state.testing?.scenarios || []).some(
          (scenario) => ["failed", "blocked"].includes(scenario.status),
        )
          ? "Retry incomplete integration tests"
          : "Run integration and interaction tests",
      };
    }
  }
  return null;
}

function renderNextAction(state) {
  clearNextAction();
  const action = nextActionForState(state);
  elements.nextActionBar.hidden = !action?.target || action.target.disabled;
  if (!action?.target || action.target.disabled) {
    if (lastNextActionLabel) {
      elements.nextActionGuide.textContent = "";
      lastNextActionLabel = "";
    }
    return;
  }

  action.target.classList.add("next-action-target");
  action.target.dataset.nextActionLabel = "Next";
  action.target.dataset.originalTitle = action.target.title || "";
  action.target.title = "Next action: " + action.label;
  action.target.setAttribute("aria-describedby", "next-action-guide");
  if (action.label !== lastNextActionLabel) {
    elements.nextActionGuide.textContent = "Next action: " + action.label;
    lastNextActionLabel = action.label;
  }

  if (action.tab && action.tab !== activeOutputTab) {
    const tab = elements.previewTabs.find(
      (candidate) => candidate.dataset.tab === action.tab,
    );
    if (tab && !tab.hidden) {
      tab.classList.add("next-action-tab");
      tab.dataset.nextActionLabel = "Next";
      tab.title = "Open this tab for the next action: " + action.label;
      tab.setAttribute("aria-describedby", "next-action-guide");
    }
  }
}

function render(state, preserveMessages = false) {
  speechInputs.beforeRender();
  const view = captureView();
  const wasReset = lastRenderedGeneration !== null && state.generation !== lastRenderedGeneration && isGoalEntry(state);
  if (wasReset) {
    clearEffortDrafts();
    preserveMessages = false;
  }
  if (currentState && (state.prototypeId !== currentState.prototypeId || state.generation !== currentState.generation)) {
    previewCapture?.finish();
    previewRestore = null;
    revisionSubmissions.clear();
    revisionTransportError = "";
    prototypeActionError = "";
  }
  lastRenderedGeneration = state.generation;
  currentState = state;
  const currentLifecycleStage =
    state.lifecycle?.currentStage || "prepare";
  const requirementsIdentity = JSON.stringify([state.prototypeId, state.generation]);
  const requirementsSubstage = state.requirements?.substage
    || (decisionNodesForState(state).length ? "dag" : "usage");
  const generatedDag = currentLifecycleStage === "requirements"
    && lastRequirementsView?.identity === requirementsIdentity
    && lastRequirementsView.substage === "usage" && requirementsSubstage === "dag"
    && state.processing?.status !== "running" && state.processing?.status !== "error"
    && decisionNodesForState(state).some((node) => node.status === "active");
  const focusGeneratedDag = generatedDag && !hasPendingRequest();
  lastRequirementsView = currentLifecycleStage === "requirements"
    ? { identity: requirementsIdentity, substage: generatedDag && !focusGeneratedDag ? "usage" : requirementsSubstage } : null;
  if (focusGeneratedDag) {
    activeOutputTab = "design-tree";
    viewedStageId = "requirements";
    followingActiveDecision = true;
    selectedDecisionId = null;
    if (window.matchMedia("(max-width: 760px)").matches) setContextExpanded(false);
  }
  if (currentLifecycleStage !== lastLifecycleStage) {
    if (!lastLifecycleStage || viewedStageId === lastLifecycleStage) {
      activeOutputTab = stageTab(currentLifecycleStage);
      viewedStageId = currentLifecycleStage;
    }
    lastLifecycleStage = currentLifecycleStage;
  }
  renderLifecycle(state, preserveMessages);
  renderProcess(state, preserveMessages);
  renderPreparation(state, preserveMessages);
  renderRequirementsSubstage(state, preserveMessages && !focusGeneratedDag);
  elements.phase.textContent = state.phase || "discovery";
  elements.goal.textContent = state.goal || "Waiting for a prototype goal...";
  elements.goal.classList.toggle("muted", !state.goal);
  elements.status.textContent = state.status || "";
  setList(elements.confirmed, state.confirmed);
  setList(elements.assumed, state.assumed);
  setList(elements.deferred, state.deferred);
  renderArtifacts(state.artifacts);
  renderDesignTree(state);
  renderPreview(state, preserveMessages);
  renderPrototypeReview(state, preserveMessages);
  renderDesignReview(state, preserveMessages);
  renderPlan(state, preserveMessages);
  renderImplementation(state, preserveMessages);
  renderTest(state, preserveMessages);
  renderReload(state);
  activateOutputTab(activeOutputTab);
  renderEffortControls(state);
  speechInputs.afterRender();
  if (!wasReset) restoreView(view);
  else if (!effortSubmitting) elements.startGoal.focus();
  if (focusGeneratedDag) {
    elements.questionHost.scrollIntoView?.({ block: "nearest" });
    const target = elements.questionHost.querySelector('input:checked:not([disabled])')
      || elements.questionHost.querySelector('textarea:not([disabled])')
      || elements.requirementsTab;
    target.focus({ preventScroll: true });
  }
}

function isStateSnapshot(state) {
  return state && typeof state === "object" && typeof state.prototypeId === "string"
    && LIFECYCLE_STAGES.some((stage) => stage.id === state.lifecycle?.currentStage)
    && (state.revision === undefined || (Number.isSafeInteger(state.revision) && state.revision >= 0));
}

function renderIfChanged(state, sequence = ++transportSequence) {
  if (!isStateSnapshot(state)) throw new Error("The studio returned an invalid state.");
  const revision = state.revision ?? 0;
  const previousRevision = currentState?.revision ?? 0;
  if (currentState && (
    state.prototypeId !== currentState.prototypeId
    || revision < previousRevision
    || (revision === 0 && previousRevision === 0
      && Date.parse(state.updatedAt) < Date.parse(currentState.updatedAt))
  )) return false;

  const domainChanged = !currentState || revision > previousRevision
    || (revision === 0 && state.updatedAt !== currentState.updatedAt);
  const next = domainChanged ? { ...state, revision } : { ...currentState };
  for (const field of ["provider", "preparationRuntime", "implementationRuntime", "testRuntime"]) {
    if (sequence >= lastTransportSequence && Object.hasOwn(state, field)) next[field] = state[field];
    else if (currentState && Object.hasOwn(currentState, field)
      && (field === "provider" || next.generation === currentState.generation)) next[field] = currentState[field];
  }
  lastTransportSequence = Math.max(lastTransportSequence, sequence);
  const providerSignature = JSON.stringify(next.provider || null);
  const preparationRuntimeSignature = JSON.stringify(next.preparationRuntime || null);
  const implementationRuntimeSignature = JSON.stringify(next.implementationRuntime || null);
  const testRuntimeSignature = JSON.stringify(next.testRuntime || null);
  const providerChanged = providerSignature !== lastProviderSignature;
  const preparationChanged = preparationRuntimeSignature !== lastPreparationRuntimeSignature;
  const implementationChanged = implementationRuntimeSignature !== lastImplementationRuntimeSignature;
  const testChanged = testRuntimeSignature !== lastTestRuntimeSignature;
  lastProviderSignature = providerSignature;
  lastPreparationRuntimeSignature = preparationRuntimeSignature;
  lastImplementationRuntimeSignature = implementationRuntimeSignature;
  lastTestRuntimeSignature = testRuntimeSignature;
  currentState = next;
  if (domainChanged || providerChanged) {
    render(next);
  } else if (preparationChanged || implementationChanged || testChanged) {
    const view = captureView();
    if (preparationChanged) renderPreparation(next);
    if (implementationChanged) renderImplementation(next);
    if (testChanged) renderTest(next);
    speechInputs.sync();
    restoreView(view);
  }
  return domainChanged || providerChanged || preparationChanged || implementationChanged || testChanged;
}

function refreshSharedState(afterSequence = 0) {
  if (sharedStateRequest) {
    if (sharedStateSequence <= afterSequence) {
      return sharedStateRequest.catch(() => undefined).then(() => refreshSharedState(afterSequence));
    }
    return sharedStateRequest;
  }
  const sequence = ++transportSequence;
  sharedStateSequence = sequence;
  const endpoint =
    (currentState?.lifecycle?.currentStage || "") === "prepare"
      ? "/api/preparation/status"
      : (currentState?.lifecycle?.currentStage || "") === "implement"
      ? "/api/implementation/status"
      : (currentState?.lifecycle?.currentStage || "") === "test"
        ? "/api/test/status"
        : "/api/state";
  sharedStateRequest = fetch(endpoint, { cache: "no-store", signal: AbortSignal.timeout(15000) })
    .then(async (response) => {
      if (!response.ok) throw new Error("Could not load studio state.");
      const state = await response.json();
      renderIfChanged(state, sequence);
      elements.connectionStatus.textContent = "";
    })
    .catch((error) => {
      elements.connectionStatus.textContent = "Connection interrupted. Retrying...";
      throw error;
    })
    .finally(() => { sharedStateRequest = null; });
  return sharedStateRequest;
}

refreshSharedState()
  .catch(() => {
    elements.connectionStatus.textContent = "Could not load the studio state. Retrying...";
  });
setInterval(() => refreshSharedState().catch(() => undefined), 2000);

const events = new EventSource("/events");
events.onmessage = (event) => {
  try {
    renderIfChanged(JSON.parse(event.data));
    elements.connectionStatus.textContent = "";
  } catch {
    elements.connectionStatus.textContent = "Could not read the studio update. Retrying...";
  }
};
events.onerror = () => {
  elements.connectionStatus.textContent = "Reconnecting to the studio...";
};

new MutationObserver(() => {
  mermaidModulePromise = null;
  if (currentState) render(currentState, true);
}).observe(document.documentElement, { attributes: true, attributeFilter: ["data-color-mode"] });
