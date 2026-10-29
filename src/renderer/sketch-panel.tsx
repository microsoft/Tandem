import { Button, Disclosure, FormField, IconButton, Input, Select, Textarea, ToggleGroup } from "./ui/index.js";
import {
  createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type KeyboardEvent, type ReactNode,
} from "react";

import {
  Check, ChevronRight, CircleAlert, Clock, Hand, History, LoaderCircle, Monitor, MousePointer2, Plus, Redo2, RefreshCw, Save, Send, Sparkles, Trash2, Undo2, Workflow, X,
} from "lucide-react";
import { hasScreenContent, sketchApprovalScope, sketchFidelity, sketchNeedsRequirementsUpdate, validateSketchDocument } from "../sketch.js";
import type { DslSketchDocument, DslSketchScreen, SketchRevision, SketchState, SketchTransition } from "../sketch.js";
import { createDslScreen, renderSketchPng, resizeScreen, SketchEditor, SKETCH_SIZE_PRESETS } from "./sketch-editor.js";
import { DslView } from "./dsl-view.js";
import { DslStructure } from "./dsl-structure.js";
import { SketchViewport } from "./sketch-viewport.js";
import { readSketchPreview } from "./sketch-preview.js";
import type { SketchPreview, SketchScreenStatus } from "../sketch-stream.js";
import { hasActiveJobs, skippedStage, useAction, useDraft, useUi, type UiState } from "./ui-context.js";
import { changeRequestHistoryStatus, changeRequestResponse } from "./change-request-feedback.js";
import { currentChangeReview, sketchNeedsChangeUpdate } from "../change-request-policy.js";
import { FeedbackHistory, FeedbackHistoryButton } from "./feedback-history.js";

// The shell must distinguish completion readiness from pending requests: unsaved designs
// block Finish Designs, but must not disable their own editing controls.
export const SketchCompletionContext = createContext<(blocked: boolean) => void>(() => {});

export interface DraftDesignApproval {
  ready: boolean;
  approve(): Promise<UiState | undefined>;
}

export function isSketchRevisionApproved(sketch: SketchState, requirementsDigest?: string): boolean {
  const { current, approved } = sketch;
  return sketch.status === "approved" && !sketchNeedsRequirementsUpdate(sketch, requirementsDigest) && Boolean(current && approved
    && approved.revisionId === current.id
    && approved.documentHash === current.documentHash
    && approved.requirementsDigest === current.requirementsDigest);
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const identityOf = (state: UiState) => JSON.stringify([state.prototypeId, state.generation]);
const revisionIdentity = (revision: SketchRevision | null) =>
  JSON.stringify(revision ? [revision.id, revision.documentHash, revision.requirementsDigest] : null);
const loadKey = (state: UiState) => JSON.stringify([identityOf(state), revisionIdentity(state.sketch.current)]);
const nextId = (prefix: string, ids: string[]) => {
  let index = 1;
  while (ids.includes(`${prefix}-${index}`)) index++;
  return `${prefix}-${index}`;
};
const acceptedDecisionIds = (state: UiState) => state.decisionGraph.nodes
  .filter((node) => node.status === "answered" && typeof node.answer === "string" && node.answer.trim())
  .map((node) => node.id);
const errorMessage = (cause: unknown) => cause instanceof Error ? cause.message : "Could not update designs.";

interface FieldDraft { value: string; error: string }
interface FieldEdit { key: string; value: string; keepInput?: boolean }
interface RequestHistoryItem {
  id: string;
  requestId: string;
  changeRequestId?: string;
  at: string;
  kind: "generate" | "update" | "save" | "approve" | "revise";
  request: string;
  response: string;
  status: "running" | "waiting" | "success" | "error";
}
interface LoadState {
  loading: boolean;
  baseRevision: SketchRevision | null;
  loadedKey: string | null;
  failedKey: string | null;
  conflict: boolean;
}
const sidePanes = [
  { id: "transitions", label: "Screen transitions", target: "sketch-screen-transitions", Icon: Workflow },
  { id: "history", label: "Revision history", target: "sketch-revision-history", Icon: History },
] as const;

type ScreenProgressStatus = SketchScreenStatus | "stopped";
const screenStatusLabels: Record<ScreenProgressStatus, string> = {
  waiting: "Waiting", processing: "Processing", ready: "Ready", stopped: "Stopped",
};
const updateRequirementsLabel = "Update designs from latest requirements";

function ScreenStatusIcon({ status }: { status: ScreenProgressStatus }) {
  return status === "processing" ? <LoaderCircle className="processing-indicator" size={15} aria-hidden="true" />
    : status === "stopped" ? <CircleAlert size={15} aria-hidden="true" />
    : status === "waiting" ? <Clock size={15} aria-hidden="true" /> : <Check size={15} aria-hidden="true" />;
}

function SketchGenerationStatus({ processing, preview, hasScreen, dirty }: {
  processing: { action?: string; status?: string; requestedAt?: string; message?: string };
  preview: SketchPreview | null;
  hasScreen: boolean;
  dirty: boolean;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [processing.requestedAt]);
  const started = Date.parse(processing.requestedAt || "");
  const seconds = Number.isFinite(started) ? Math.max(0, Math.floor((now - started) / 1000)) : null;
  const updating = processing.action === "revise-sketch";
  const title = processing.status === "starting" ? updating ? "Starting design update" : "Starting UI design"
    : updating ? "Updating UI design" : "Generating UI design";
  const screens = preview?.document.screens.length ?? 0;
  return <section id="sketch-generation" className="sketch-generation" data-empty={!hasScreen}
    aria-labelledby="sketch-generation-title">
    <div className="processing-state">
      <LoaderCircle className="processing-indicator" size={20} aria-hidden="true" />
      <div className="processing-copy">
        <div className="processing-heading">
          <strong id="sketch-generation-title">{title}</strong>
          {seconds !== null && <span id="sketch-generation-elapsed" className="muted" role="timer" aria-live="off">
            {seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`} elapsed
          </span>}
        </div>
        <div id="sketch-generation-status" role="status" aria-live="polite" aria-atomic="true">
          <p>{processing.message || (updating ? "Updating existing designs while preserving unrelated work." : "Preparing screens from your accepted requirements.")}</p>
          {preview && <p id="sketch-generation-progress">{updating ? "Updating existing designs" : `${screens} ${screens === 1 ? "screen" : "screens"} received`}
            {" · "}live update {preview.sequence}</p>}
        </div>
        <p className="muted">{dirty
          ? "Your local edits remain visible. Incoming screens are not saved or approved."
          : preview ? "You can inspect the live screens below. They are not saved or approved yet."
          : hasScreen ? updating ? "Your existing designs remain visible. Only the required changes are being prepared."
            : "Your current designs remain visible while the new design is prepared."
          : "Page titles and navigation appear first; page contents follow. Designs still need your approval."}</p>
      </div>
    </div>
  </section>;
}

export function SketchPanel({ renderApproval, renderReviewActions, onDraftApprovalChange, onApprovalStatusChange }: {
  renderApproval?: (actions: ReactNode) => ReactNode;
  renderReviewActions?: (actions: ReactNode) => ReactNode;
  onDraftApprovalChange?: (approval: DraftDesignApproval | null) => void;
  onApprovalStatusChange?: (status: string) => void;
} = {}) {
  const ui = useUi();
  const { state, pending, canEdit, guidance } = ui;
  const action = useAction("sketch");
  const reportCompletion = useContext(SketchCompletionContext);
  const [editor] = useState(() => new SketchEditor());
  const [, redraw] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>({
    loading: false, baseRevision: null, loadedKey: null, failedKey: null, conflict: false,
  });
  const loadRef = useRef(loadState);
  const [drafts, setDrafts] = useState<Record<string, FieldDraft>>({});
  const draftsRef = useRef(drafts);
  const [selectedScreen, setSelectedScreen] = useState("");
  const [pickingElement, setPickingElement] = useState(true);
  const [selectedElement, setSelectedElement] = useState<{ key: string | null; screenId: string; nodeId: string } | null>(null);
  const [sidePane, setSidePane] = useState<"" | "transitions" | "history">("");
  const [instruction, setInstruction] = useDraft("sketch:instruction", "");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [requestHistory, setRequestHistory] = useState<RequestHistoryItem[]>([]);
  const [clearedWorkerError, setClearedWorkerError] = useState("");
  const [dismissedPreview, setDismissedPreview] = useState<string | null>(null);
  const instructionRef = useRef(instruction);
  instructionRef.current = instruction;
  const [retryDraft, setRetryDraft] = useState("");
  const operation = useRef(false);
  const mounted = useRef(true);
  const request = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const latest = useRef(ui);
  latest.current = ui;
  const stateRef = useRef(state);
  if (identityOf(state) !== identityOf(stateRef.current) || state.revision >= stateRef.current.revision) {
    stateRef.current = state;
  }

  const key = loadKey(state);
  const skipped = skippedStage(state, "sketch");
  const available = Boolean(state.sketch && (state.lifecycle.currentStage === "sketch" || state.sketch.current));
  const invalidFields = Object.values(drafts).some((draft) => Boolean(draft.error));
  const dirty = editor.dirty || Object.keys(drafts).length > 0;
  useEffect(() => {
    ui.setReviewDirty?.("drawings", dirty || Boolean(instruction.trim()));
    return () => ui.setReviewDirty?.("drawings", false);
  }, [dirty, instruction, ui.setReviewDirty]);
  const incoming = useMemo(() => {
    try { return { preview: readSketchPreview(state, state.sketchPreview), error: "" }; }
    catch (cause) { return { preview: null, error: errorMessage(cause) }; }
  }, [state]);
  const previewKey = incoming.preview ? JSON.stringify(["preview", incoming.preview.prototypeId, incoming.preview.generation,
    incoming.preview.requestId, incoming.preview.runId, incoming.preview.baseRevisionId, incoming.preview.requirementsDigest]) : null;
  const livePreview = !dirty && previewKey !== dismissedPreview ? incoming.preview : null;
  // A preview is only a display source: the editor and undo history stay local/saved.
  const sourceDocument = livePreview?.document ?? editor.document;
  const legacy = sourceDocument?.version === 1;
  const document = sourceDocument?.version === 2 ? sourceDocument : null;
  const wireframe = sketchFidelity(document, state.prototypeApproach?.mode) === "wireframe";
  const screen = document?.screens.find((item) => item.id === selectedScreen) ?? document?.screens[0];
  const selectionKey = livePreview ? previewKey : loadState.loadedKey;
  const selectedNodeId = selectedElement?.key === selectionKey && selectedElement?.screenId === screen?.id
    && screen && Object.hasOwn(screen.ui.nodes, selectedElement.nodeId) ? selectedElement.nodeId : null;
  const remoteChanged = loadState.loadedKey !== null
    && revisionIdentity(loadState.baseRevision) !== revisionIdentity(state.sketch.current);
  const conflict = loadState.conflict || (!action.busy && remoteChanged && dirty);
  const emptyScreens = !document?.screens.length || document.screens.some((item) => !hasScreenContent(item));
  const requestWritable = canEdit("sketch") && state.provider?.canSubmitAnswers !== false
    && !skipped && !pending && !hasActiveJobs(state) && !action.busy && !loadState.loading
    && loadState.loadedKey !== null && loadState.failedKey !== key && (!remoteChanged || dirty || loadState.conflict);
  const writable = requestWritable && !livePreview;
  const worker = ["generate-sketch", "revise-sketch"].includes(state.processing?.action) ? state.processing : null;
  const workerRequest = state.sketch.requests?.find(item => item.requestId === worker?.requestId);
  const generating = state.lifecycle.currentStage === "sketch" && !skipped && !state.effortReset
    && ["starting", "running"].includes(worker?.status);
  const stoppedPreview = Boolean(livePreview && worker?.status === "error");
  const recoverable = worker?.status === "error" && Boolean((worker.sketchRecovery || worker.sketchResume) && incoming.preview);
  const screenStatus = (item: DslSketchScreen): ScreenProgressStatus | null => {
    if ((!generating && !stoppedPreview) || dirty) return null;
    if (!livePreview && worker?.action === "revise-sketch" && hasScreenContent(item)) return "ready";
    const progress = livePreview?.screenStatuses?.[item.id]
      ?? (livePreview && hasScreenContent(item) ? "processing" : "waiting");
    return stoppedPreview && progress === "processing" ? "stopped" : progress;
  };
  const pageStatus = screen ? screenStatus(screen) : null;
  const drawingChanges = (state.changeRequests ?? []).filter(item => item.originStage === "sketch").map(item =>
    worker?.status === "error" && worker.changeRequestId === item.id ? { ...item,
      error: worker.message || "The design revision failed. Open request history to review the failure and retry." } : item);
  const requiredReview = currentChangeReview(state);
  const requirementsChanged = sketchNeedsRequirementsUpdate(state.sketch, state.requirementsDigest);
  const needsUpdate = sketchNeedsChangeUpdate(state, state.requirementsDigest);
  const savedHistory: RequestHistoryItem[] = drawingChanges.map(item => ({
    id: `change:${item.id}`, requestId: item.analysisId ?? "", changeRequestId: item.id, at: item.submittedAt,
    kind: "revise", request: item.message, response: changeRequestResponse(item), status: changeRequestHistoryStatus(item),
  }));
  const history = [...savedHistory, ...requestHistory.filter(item => !drawingChanges.some(change =>
    change.clientRequestId === item.id || change.id === item.changeRequestId || change.analysisId === item.requestId))]
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at)).slice(0, 25);
  const workerErrorKey = worker?.status === "error" ? JSON.stringify([worker.requestId ?? "", worker.message ?? "", worker.answer ?? ""]) : "";
  const workerErrorCleared = Boolean(workerErrorKey && clearedWorkerError === workerErrorKey);
  const failedInstruction = worker?.action === "revise-sketch" && worker.status === "error" && typeof worker.answer === "string"
    && !workerErrorCleared ? worker.answer.trim() : "";
  const retryInstruction = retryDraft || failedInstruction;
  const failedReviewWork = Boolean(requiredReview && state.processing?.status === "error"
    && state.processing.changeRequestId === requiredReview.id);
  const completionBlocked = Boolean(livePreview) || hasActiveJobs(state) || action.busy || loadState.loading || dirty || conflict || !available || Boolean(skipped)
    || loadState.loadedKey !== key || loadState.failedKey === key || emptyScreens || needsUpdate
    || !isSketchRevisionApproved(state.sketch, state.requirementsDigest);

  useEffect(() => {
    if (selectedElement && !selectedNodeId) setSelectedElement(null);
  }, [selectedElement, selectedNodeId]);

  function selectElement(nodeId: string) {
    if (!screen || !selectionKey) return;
    if (nodeId && !Object.hasOwn(screen.ui.nodes, nodeId)) {
      action.setError("The selected UI element is no longer in this view. Select a current component.");
      return;
    }
    setSelectedElement(nodeId ? { key: selectionKey, screenId: screen.id, nodeId } : null);
    setPickingElement(true);
  }

  function updateLoad(change: Partial<LoadState>) {
    loadRef.current = { ...loadRef.current, ...change };
    setLoadState(loadRef.current);
  }
  function updateDrafts(next: Record<string, FieldDraft>) {
    draftsRef.current = next;
    setDrafts(next);
  }
  function isDirty() {
    return editor.dirty || Object.keys(draftsRef.current).length > 0;
  }
  function hasInvalidFields() {
    return Object.values(draftsRef.current).some((draft) => Boolean(draft.error));
  }
  function finishField(key: string) {
    if (!draftsRef.current[key] || draftsRef.current[key].error) return;
    const next = { ...draftsRef.current };
    delete next[key];
    updateDrafts(next);
  }
  function canWrite(allowPreview = false) {
    const context = latest.current;
    const snapshot = stateRef.current;
    return (allowPreview || !livePreview) && mounted.current && context.canEdit("sketch") && snapshot.provider?.canSubmitAnswers !== false
      && !skippedStage(snapshot, "sketch") && !context.pending && !hasActiveJobs(snapshot)
      && !operation.current && !loadRef.current.loading
      && loadRef.current.loadedKey !== null && loadRef.current.failedKey !== loadKey(snapshot)
      && (loadRef.current.loadedKey === loadKey(snapshot) || isDirty() || loadRef.current.conflict);
  }
  function hasConflict() {
    return loadRef.current.conflict || (loadRef.current.loadedKey !== null
      && revisionIdentity(loadRef.current.baseRevision) !== revisionIdentity(stateRef.current.sketch.current));
  }
  function recordHistory(item: RequestHistoryItem) {
    setRequestHistory((items) => [item, ...items.filter((entry) => entry.id !== item.id)].slice(0, 25));
  }
  function updateHistory(id: string, change: Partial<RequestHistoryItem>) {
    setRequestHistory((items) => items.map((item) => item.id === id ? { ...item, ...change } : item));
  }
  function requestLabel(kind: RequestHistoryItem["kind"], value: string) {
    if (kind === "revise") return value || "Revise designs";
    if (kind === "update") return updateRequirementsLabel;
    if (kind === "generate") return editor.document ? "Regenerate designs" : "Generate designs";
    if (kind === "approve") return state.stageReview ? "Approve draft" : "Approve designs and continue";
    return "Save designs";
  }
  function responseLabel(kind: RequestHistoryItem["kind"], result: UiState | undefined) {
    if (kind === "save") return `Saved ${result?.sketch.current ? `revision ${result.sketch.current.number}` : "designs"}.`;
    if (kind === "approve") return state.stageReview ? "Draft designs approved. Accepted work is unchanged until Apply changes."
      : "Approved designs and continued to the next stage.";
    const processing = result?.processing;
    if (processing?.message) return processing.message;
    return kind === "revise" || kind === "update" ? "Revision request queued." : "Design generation queued.";
  }

  useLayoutEffect(() => {
    reportCompletion(completionBlocked);
  }, [completionBlocked, reportCompletion]);
  useEffect(() => () => reportCompletion(true), [reportCompletion]);
  useEffect(() => {
    setRequestHistory([]);
    setHistoryOpen(false);
    setRetryDraft("");
    setClearedWorkerError("");
  }, [identityOf(state)]);
  useEffect(() => {
    if (!worker?.requestId) return;
    if (worker.changeRequestId && state.changeRequests?.some(item => item.id === worker.changeRequestId)) return;
    const kind = workerRequest?.kind ?? (worker.action === "revise-sketch" ? "revise" : "generate");
    const requestText = typeof worker.answer === "string" && worker.answer.trim()
      ? worker.answer.trim() : workerRequest?.instruction || (kind === "update" ? updateRequirementsLabel : kind === "revise" ? "Revise designs" : "Generate designs");
    const status = worker.status === "error" ? "error" : worker.status === "success" ? "success" : "running";
    const response = worker.message || (status === "error" ? "Design request failed."
      : status === "success" ? "Design request completed." : "Design request is running.");
    const id = `worker:${worker.requestId}`;
    setRequestHistory((items) => {
      const existing = items.find((item) => item.requestId === worker.requestId || item.id === id);
      if (existing) {
        return items.map((item) => item === existing ? {
          ...item, id, requestId: worker.requestId, kind, request: requestText, response, status,
        } : item);
      }
      const item: RequestHistoryItem = {
        id, requestId: worker.requestId, kind, request: requestText, response, status,
        at: new Date().toISOString(),
      };
      return [item, ...items].slice(0, 25);
    });
  }, [worker?.requestId, worker?.action, worker?.status, worker?.message, worker?.answer, worker?.changeRequestId, workerRequest, state.changeRequests]);
  useEffect(() => {
    mounted.current = true;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirty()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      mounted.current = false;
      request.current++;
      controller.current?.abort();
      window.removeEventListener("beforeunload", beforeUnload);
      latest.current.setBusy("sketch", false);
    };
  }, [editor]);

  async function load(discard = false) {
    const startKey = loadKey(stateRef.current);
    const sequence = ++request.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const timeout = window.setTimeout(() => abort.abort(), 15000);
    updateLoad({ loading: true });
    if (discard || loadRef.current.loadedKey === null) action.setError("");
    try {
      const response = await fetch(latest.current.apiUrl?.("/api/sketch") ?? "/api/sketch", { cache: "no-store", signal: abort.signal });
      const result = await response.json() as { sketch?: SketchState; document?: unknown; error?: string };
      if (!response.ok) throw new Error(result.error || "Could not load designs.");
      if (!mounted.current || sequence !== request.current || startKey !== loadKey(stateRef.current)) return;
      if (!result.sketch || !Object.hasOwn(result.sketch, "current")
        || revisionIdentity(result.sketch.current) !== revisionIdentity(stateRef.current.sketch.current)) {
        throw new Error("The saved design changed while loading. Reload the latest state and designs.");
      }
      if (!Object.hasOwn(result, "document")) throw new Error("The design response did not include a document.");
      if (isDirty() && !discard) {
        updateLoad({ conflict: true });
        return;
      }
      if (result.sketch.current && !result.document) throw new Error("The saved design document is unavailable.");
      if (!result.sketch.current && result.document) throw new Error("The design document has no saved revision identity.");
      editor.load(result.document ? validateSketchDocument(result.document) : null);
      updateDrafts({});
      updateLoad({
        baseRevision: result.sketch.current ? { ...result.sketch.current } : null,
        loadedKey: startKey, failedKey: null, conflict: false,
      });
      redraw((version) => version + 1);
    } catch (cause) {
      if (!mounted.current || sequence !== request.current || startKey !== loadKey(stateRef.current)) return;
      updateLoad({ failedKey: startKey });
      action.setError(abort.signal.aborted ? "Loading designs timed out. Reload saved designs to retry." : errorMessage(cause));
    } finally {
      window.clearTimeout(timeout);
      if (mounted.current && sequence === request.current) updateLoad({ loading: false });
    }
  }

  useEffect(() => {
    if (operation.current || loadRef.current.loading || !available || skipped) return;
    const changed = loadRef.current.loadedKey !== null
      && revisionIdentity(loadRef.current.baseRevision) !== revisionIdentity(state.sketch.current);
    if (changed && isDirty()) {
      if (!loadRef.current.conflict) updateLoad({ conflict: true });
      return;
    }
    if (!loadRef.current.conflict && loadRef.current.loadedKey !== key && loadRef.current.failedKey !== key) void load();
  }, [key, available, Boolean(skipped), action.busy, loadState.loading, dirty, loadState.conflict]);

  function edit(change: (draft: DslSketchDocument) => void, field?: FieldEdit) {
    if (!canWrite()) return false;
    try {
      editor.edit((draft) => {
        if (draft.version !== 2) throw new Error("Regenerate legacy designs as UI DSL before editing.");
        change(draft);
      });
      if (field) {
        const next = { ...draftsRef.current };
        if (field.keepInput) next[field.key] = { value: field.value, error: "" };
        else delete next[field.key];
        updateDrafts(next);
      }
      action.setError("");
      redraw((version) => version + 1);
      return true;
    } catch (cause) {
      const message = errorMessage(cause);
      if (field) updateDrafts({ ...draftsRef.current, [field.key]: { value: field.value, error: message } });
      action.setError(message);
      return false;
    }
  }
  function editScreen(change: (item: DslSketchScreen) => void, field?: FieldEdit) {
    if (!screen) return false;
    return edit((draft) => {
      const item = draft.screens.find((item) => item.id === screen.id);
      if (item) change(item);
    }, field);
  }
  function undo() {
    if (!canWrite()) return;
    const discardInvalid = hasInvalidFields();
    updateDrafts({});
    if (!discardInvalid) editor.undo();
    action.setError("");
    redraw((version) => version + 1);
  }
  function redo() {
    if (!canWrite() || hasInvalidFields()) return;
    updateDrafts({});
    editor.redo();
    action.setError("");
    redraw((version) => version + 1);
  }
  function ensureEffort(identity: string) {
    if (!mounted.current || identity !== identityOf(stateRef.current)) {
      throw new Error("The effort changed. Review designs before continuing.");
    }
  }
  function ensureRevision(revision: SketchRevision | null) {
    if (revisionIdentity(revision) !== revisionIdentity(stateRef.current.sketch.current)) {
      throw new Error("The design changed. Your local edits are retained; reload designs before retrying.");
    }
  }
  function ensureSketchWritable() {
    const snapshot = stateRef.current;
    if (snapshot.lifecycle.currentStage !== "sketch" || snapshot.lifecycle.completedStages.includes("sketch")
      || skippedStage(snapshot, "sketch") || snapshot.provider?.canSubmitAnswers === false || snapshot.effortReset
      || hasActiveJobs(snapshot)) {
      throw new Error("Designs is no longer editable. Review the current stage and provider before retrying.");
    }
  }
  async function post(endpoint: string, body: unknown, identity: string) {
    const result = await latest.current.post(endpoint, body);
    ensureEffort(identity);
    if (!result?.sketch || identityOf(result) !== identity) {
      throw new Error("The design update could not be confirmed. Reload state before retrying.");
    }
    if (result.revision >= stateRef.current.revision) stateRef.current = result;
    return result;
  }
  async function save(identity: string) {
    if (!editor.document) throw new Error("Add a screen before saving.");
    if (hasInvalidFields()) throw new Error("Complete the invalid design fields before saving designs.");
    ensureRevision(loadRef.current.baseRevision);
    const savedDocument = validateSketchDocument(editor.document, acceptedDecisionIds(stateRef.current));
    const result = await post("/api/sketch", {
      action: "save", expectedRevision: loadRef.current.baseRevision?.id ?? null, document: savedDocument,
    }, identity);
    const revision = result.sketch.current;
    if (!revision) throw new Error("The saved revision could not be confirmed. Reload state before retrying.");
    ensureRevision(revision);
    editor.markSaved();
    updateDrafts({});
    updateLoad({ baseRevision: { ...revision }, loadedKey: loadKey(stateRef.current), failedKey: null, conflict: false });
  }
  async function submit(kind: RequestHistoryItem["kind"], retry?: string) {
    if (!canWrite(kind === "generate" || kind === "update" || retry !== undefined) || hasConflict() || hasInvalidFields()) return;
    if (kind === "revise" && sketchNeedsRequirementsUpdate(stateRef.current.sketch, stateRef.current.requirementsDigest)) {
      action.setError("Update designs from latest requirements before sending a design revision. Your message is retained.");
      return;
    }
    if (kind === "revise" && retry === undefined && currentChangeReview(stateRef.current)) {
      action.setError("Resolve the current review before sending another change. Your message is retained.");
      return;
    }
    const requestedInstruction = retry ?? instructionRef.current.trim();
    const retryContext = retry !== undefined && worker?.action === "revise-sketch" && worker.status === "error"
      && typeof worker.answer === "string" && requestedInstruction === worker.answer.trim()
      ? worker.sketchContext : null;
    if (kind === "revise" && (!editor.document || !requestedInstruction)) return;
    if (kind === "update" && editor.document?.version !== 2) {
      action.setError("An update needs existing UI DSL designs. Generate them first or explicitly regenerate legacy designs.");
      return;
    }
    if ((kind === "generate" || kind === "update") && editor.dirty) {
      action.setError("Save designs before updating or regenerating. Local edits have been kept.");
      return;
    }
    if (kind === "approve" && (emptyScreens || sketchNeedsChangeUpdate(stateRef.current, stateRef.current.requirementsDigest))) return;
    const identity = identityOf(stateRef.current);
    const startRevision = loadRef.current.baseRevision;
    const historyId = crypto.randomUUID();
    recordHistory({
      id: historyId, requestId: "", kind, at: new Date().toISOString(),
      request: requestLabel(kind, requestedInstruction),
      response: "Request submitted.",
      status: "running",
    });
    action.setError("");
    setRetryDraft("");
    if (workerErrorKey) setClearedWorkerError(workerErrorKey);
    operation.current = true;
    return action.run(async () => {
      try {
        if ((kind === "generate" || kind === "update") && editor.document
          && !await latest.current.confirm(kind === "update"
            ? "Update the existing designs for the latest accepted requirements and DAG? Keep reviewed layouts and refinements except where those changes require an adjustment. The updated draft will still need your review and approval."
            : "Regenerate all designs from scratch? Reviewed layouts and refinements may be replaced. Your saved revision remains in history.",
          kind === "update" ? updateRequirementsLabel : "Regenerate designs")) {
          updateHistory(historyId, { response: "Request cancelled.", status: "success" });
          return;
        }
        ensureEffort(identity);
        ensureRevision(startRevision);
        ensureSketchWritable();
        if (kind === "revise" && retry !== undefined) setRetryDraft(requestedInstruction);
        if (kind === "save" || (editor.dirty && (kind === "approve" || kind === "revise"))) await save(identity);
        ensureEffort(identity);
        ensureSketchWritable();
        if (kind === "approve") {
          const revision = loadRef.current.baseRevision;
          if (!revision || !editor.document) throw new Error("Save a design revision before approval.");
          const approvalDocument = clone(editor.document);
          const previews = [];
          for (const item of approvalDocument.screens) previews.push(await renderSketchPng(item));
          ensureEffort(identity);
          ensureRevision(revision);
          ensureSketchWritable();
          if (sketchNeedsChangeUpdate(stateRef.current, stateRef.current.requirementsDigest)) {
            throw new Error("The required design update changed during PNG export. Review designs before approving.");
          }
          const result = await post("/api/sketch", { action: "approve", expectedRevision: revision.id, previews }, identity);
          ensureRevision(revision);
          if (!isSketchRevisionApproved(result.sketch, result.requirementsDigest)
            || !isSketchRevisionApproved(stateRef.current.sketch, stateRef.current.requirementsDigest)
            || result.sketch.approved?.revisionId !== revision.id) {
            throw new Error("Design approval could not be confirmed.");
          }
          ensureSketchWritable();
          if (!stateRef.current.stageReview) await post("/api/stage/complete", { stageId: "sketch" }, identity);
          updateHistory(historyId, { response: responseLabel("approve", stateRef.current), status: "success" });
          return result;
        } else if (kind !== "save") {
          const result = await post("/api/sketch", {
            action: kind, expectedRevision: loadRef.current.baseRevision?.id ?? null,
            ...(kind === "revise" ? { instruction: requestedInstruction, clientRequestId: historyId,
              ...(retryContext ? { sketchContext: retryContext } : screen && loadRef.current.baseRevision ? { sketchContext: {
                revisionId: loadRef.current.baseRevision.id, screenId: screen.id, nodeId: selectedNodeId,
              } } : {}) } : {}),
          }, identity);
          const change = result.changeRequests?.find(item => item.clientRequestId === historyId);
          updateHistory(historyId, {
            ...(change ? { changeRequestId: change.id } : {}),
            requestId: typeof result.processing?.requestId === "string" ? result.processing.requestId : "",
            response: change ? changeRequestResponse(change) : responseLabel(kind, result),
            status: change ? changeRequestHistoryStatus(change) : ["error", "failed"].includes(result.processing?.status) ? "error" : "running",
          });
          if (kind === "revise") {
            setRetryDraft("");
            if (retry === undefined && instructionRef.current.trim() === requestedInstruction) setInstruction("");
          }
          return result;
        } else {
          updateHistory(historyId, { response: responseLabel("save", stateRef.current), status: "success" });
        }
      } catch (cause) {
        updateHistory(historyId, { response: errorMessage(cause), status: "error" });
        if (mounted.current && identity === identityOf(stateRef.current)
          && revisionIdentity(loadRef.current.baseRevision) !== revisionIdentity(stateRef.current.sketch.current) && isDirty()) {
          updateLoad({ conflict: true });
        }
        throw cause;
      } finally {
        operation.current = false;
      }
    });
  }

  async function reload() {
    if (operation.current || loadRef.current.loading || hasActiveJobs(stateRef.current)) return;
    const identity = identityOf(stateRef.current);
    operation.current = true;
    await action.run(async () => {
      try {
        if (isDirty() && !await latest.current.confirm(
          "Discard your unsaved design edits and load the latest saved revision?", "Reload saved designs")) return;
        ensureEffort(identity);
        await load(true);
        if (loadRef.current.failedKey === null) setDismissedPreview(previewKey);
      } finally {
        operation.current = false;
      }
    });
  }

  async function retryGeneration() {
    if (!recoverable || !canWrite(true) || isDirty() || hasConflict() || hasInvalidFields()) return;
    const identity = identityOf(stateRef.current);
    operation.current = true;
    await action.run(async () => {
      try {
        const result = await post("/api/sketch", {
          action: "retry", expectedRevision: stateRef.current.sketch.current?.id ?? null,
          expectedGeneration: stateRef.current.generation, requestId: worker.requestId,
        }, identity);
        if (result.processing?.status !== "error") setClearedWorkerError(workerErrorKey);
      } finally {
        operation.current = false;
      }
    });
  }

  function keydown(event: KeyboardEvent<HTMLElement>) {
    if ((event.target as Element).closest("input, textarea, select, [contenteditable=true], .dsl-view")) return;
    if (!canWrite()) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) redo(); else undo();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
      event.preventDefault();
      redo();
    }
  }

  function closeSidePane(element: HTMLElement) {
    const trigger = element.ownerDocument.getElementById(`sketch-toggle-${sidePane}`);
    setSidePane("");
    trigger?.focus();
  }

  function sidePaneKeydown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Escape" || event.defaultPrevented || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    closeSidePane(event.currentTarget);
  }

  const status = skipped ? "Designs disabled: " + skipped.reason
    : stoppedPreview ? "Generation stopped. Generated pages and content are retained as an incomplete preview, not saved or approved. Retry generation or reload saved designs."
    : incoming.preview && previewKey !== dismissedPreview ? dirty
      ? "Live preview pending — local edits are preserved and remain visible. Incoming designs are not saved or approved."
      : `Live preview · update ${incoming.preview.sequence} — not saved or approved. You can browse screens while AI draws.`
    : loadState.loading || (available && !dirty && loadState.loadedKey !== key && loadState.failedKey !== key) ? "Loading saved designs…"
    : action.busy ? "Saving designs or preparing approval…"
    : worker?.status === "running" || worker?.status === "starting" ? worker.message || "AI is preparing a design revision. Existing designs are retained."
    : conflict ? "Conflict: a newer saved revision exists. Your local edits are retained; load latest explicitly to discard them."
    : state.provider?.canSubmitAnswers === false ? guidance("edit or approve designs")
    : !canEdit("sketch") ? "Read only. Open or reopen Designs to edit these designs."
    : requirementsChanged ? "Stale designs: requirements changed. Update designs from the latest requirements, then review and approve."
    : needsUpdate ? "Update designs for the reviewed changes, then inspect and approve the updated version."
    : document && emptyScreens ? "Request UI components for every screen before approving. Empty screens can be saved as drafts."
    : dirty ? "Unsaved designs — save before leaving this browser. Switching tabs keeps your edits."
    : isSketchRevisionApproved(state.sketch, state.requirementsDigest) ? "Designs approved. Finish Designs to continue if the stage has not advanced."
    : document ? ""
    : "Generate UI views from the requirements DAG, then describe changes below.";
  const message = action.error || incoming.error || Object.values(drafts).find((draft) => draft.error)?.error
    || (worker?.status === "error" && !workerErrorCleared ? worker.message || "Design generation failed. Retry explicitly." : "");
  const activeError = Boolean(message || retryInstruction);
  const boardHelp = stoppedPreview
    ? "Incomplete UI DSL preview retained after generation stopped. Inspect pages and components; this preview is not saved or approved."
    : livePreview
    ? "Live UI DSL preview. Inspect the structure or select components while generation continues. This selection is not a saved change target."
    : pickingElement ? "Select an element in the view or Structure, then describe the change. Use Interact to try the controls."
    : "UI DSL preview. Controls are local examples, not connected services. Describe changes below.";
  const screenFieldKey = (field: string) => `screen:${screen?.id}:${field}`;
  const fieldValue = (key: string, value: string | number | undefined) => drafts[key]?.value ?? String(value ?? "");
  const fieldInvalid = (key: string) => Boolean(drafts[key]?.error);
  const canvasPreset = SKETCH_SIZE_PRESETS.find((size) => size.width === screen?.width && size.height === screen?.height);
  const revisions = [...new Map([...state.sketch.history, ...(state.sketch.current ? [state.sketch.current] : [])]
    .map((revision) => [revision.id, revision])).values()].reverse();
  const approved = isSketchRevisionApproved(state.sketch, state.requirementsDigest) && !needsUpdate && !dirty && !conflict && !livePreview;
  const approvalStatus = document && approved && !state.stageReview && loadState.loadedKey === key && !loadState.loading
    ? wireframe ? "Layout and navigation approved" : "Saved designs approved" : "";
  useEffect(() => {
    onApprovalStatusChange?.(approvalStatus);
    return () => onApprovalStatusChange?.("");
  }, [approvalStatus, onApprovalStatusChange]);
  const approvalDisabled = !writable || emptyScreens || conflict || needsUpdate || invalidFields || failedReviewWork;
  useEffect(() => {
    if (!state.stageReview || !onDraftApprovalChange) return;
    onDraftApprovalChange({
      ready: !approvalDisabled,
      approve: async () => isSketchRevisionApproved(stateRef.current.sketch, stateRef.current.requirementsDigest)
        && !sketchNeedsChangeUpdate(stateRef.current, stateRef.current.requirementsDigest) && !isDirty() && !hasConflict()
        ? stateRef.current : submit("approve"),
    });
    return () => onDraftApprovalChange(null);
  }, [onDraftApprovalChange, approvalDisabled, state.revision, state.stageReview]);
  const approval = state.stageReview ? null : <div className="sketch-approval-actions">
    <Button variant="primary" id="sketch-approve" className="plan-button" type="button"
      title={document ? sketchApprovalScope(document) : undefined}
      hidden={approved}
      disabled={approvalDisabled}
      onClick={() => void submit("approve")}><Check size={14} aria-hidden="true" />Approve designs and continue</Button>
  </div>;
  const updateAction = needsUpdate && canEdit("sketch") && !legacy
    ? <Button variant="primary" id="sketch-update-requirements" className="plan-button" type="button" disabled={!requestWritable || !document || conflict || dirty}
      title={dirty ? "Save or undo your local design edits before updating from requirements." : updateRequirementsLabel}
      onClick={() => void submit("update")}><Sparkles size={15} aria-hidden="true" />{updateRequirementsLabel}</Button> : null;

  return <section className="sketch-stage" onKeyDown={keydown}>
    {renderApproval ? renderApproval(approval) : approval}
    {renderReviewActions?.(updateAction)}
    <div className="sketch-heading sketch-header-actions" role="group" aria-label="Design tools" aria-describedby="sketch-status">
      <IconButton variant="secondary" id="sketch-add-screen" className="sketch-icon-button" type="button" title="Add screen" aria-label="Add screen"
        disabled={!writable || legacy || (document?.screens.length ?? 0) >= 8 || !acceptedDecisionIds(state).length}
        onClick={() => {
          let created = "";
          if (edit((draft) => {
            const item = createDslScreen(draft, acceptedDecisionIds(stateRef.current).slice(0, 200));
            draft.screens.push(item);
            created = item.id;
          })) setSelectedScreen(created);
        }}><Plus size={16} aria-hidden="true" /></IconButton>
      <IconButton variant="secondary" id="sketch-undo" className="sketch-icon-button" type="button" title="Undo" aria-label="Undo"
        disabled={!writable || (!editor.canUndo && !invalidFields)} onClick={undo}>
        <Undo2 size={16} aria-hidden="true" /></IconButton>
      <IconButton variant="secondary" id="sketch-redo" className="sketch-icon-button" type="button" title="Redo" aria-label="Redo"
        disabled={!writable || !editor.canRedo || invalidFields} onClick={redo}>
        <Redo2 size={16} aria-hidden="true" /></IconButton>
      <IconButton variant="secondary" id="sketch-reload" className="sketch-icon-button" type="button"
        title={conflict ? "Discard local edits & load latest" : "Reload saved designs"}
        aria-label={conflict ? "Discard local edits & load latest" : "Reload saved designs"}
        disabled={action.busy || loadState.loading || hasActiveJobs(state) || !state.sketch}
        onClick={() => void reload()}><RefreshCw size={16} aria-hidden="true" /></IconButton>
      <IconButton variant="secondary" id="sketch-generate" className="sketch-icon-button" type="button"
        title={sourceDocument ? "Regenerate designs" : "Generate designs"} aria-label={sourceDocument ? "Regenerate designs" : "Generate designs"}
        disabled={!requestWritable || conflict || dirty} onClick={() => void submit("generate")}>
        <Sparkles size={16} aria-hidden="true" />
      </IconButton>
      <IconButton variant="secondary" id="sketch-save" className="sketch-icon-button" type="button" title="Save designs" aria-label="Save designs"
        disabled={!writable || !document || !editor.dirty && !(state.stageReview && state.sketch.status === "stale") || conflict || invalidFields} onClick={() => void submit("save")}>
        <Save size={16} aria-hidden="true" />
      </IconButton>
    </div>
    <div id="sketch-status" className={incoming.preview || loadState.loading || action.busy || conflict || dirty || needsUpdate ? "muted" : "visually-hidden"} role="status" aria-live="polite" hidden={!status || generating}>
      <span>{status}</span>
      {!renderReviewActions && updateAction}
    </div>
    {generating && <SketchGenerationStatus key={JSON.stringify([state.prototypeId, state.generation, worker.requestId])}
      processing={worker} preview={incoming.preview} hasScreen={Boolean(screen)} dirty={dirty} />}
    {recoverable && <div id="sketch-recovery" className="sketch-heading">
      <p className="muted">Continue from the retained pages and content, without starting over.</p>
      <Button variant="primary" id="sketch-retry-generation" className="plan-button" type="button"
        disabled={!requestWritable || dirty || conflict || invalidFields}
        onClick={() => void retryGeneration()}><RefreshCw size={15} aria-hidden="true" />Retry generation</Button>
    </div>}
    <p id="sketch-empty" className="sketch-empty" hidden={Boolean(screen) || generating}
      data-status-help="Generate a first draft or add a screen to begin.">{legacy
        ? "These designs use the retired geometry format. Reopen Designs if needed, then choose Regenerate designs to create UI DSL views. Saved files and approval history will remain intact."
        : "No UI views yet. Generate designs to begin."}</p>
    <div id="sketch-workspace" className="sketch-workspace" hidden={!screen}>
      <aside className="sketch-sidebar" aria-label="Design screens and properties">
        <section className="sketch-pane sketch-screens-pane" aria-labelledby="sketch-screens-heading">
          <h3 id="sketch-screens-heading" className="sketch-pane-heading">
            <span>Screens</span><span className="section-count">{document?.screens.length ?? 0}</span>
          </h3>
          <nav id="sketch-screens" className="sketch-list sketch-pane-body" aria-label="Screens">
            {document?.screens.map((item) => {
              const progress = screenStatus(item);
              return <Button variant="item" key={item.id} type="button"
                data-ui-key={`sketch-screen:${item.id}`} aria-pressed={item.id === screen?.id}
                data-screen-status={progress ?? undefined}
                onClick={() => setSelectedScreen(item.id)}>
                {progress ? <ScreenStatusIcon status={progress} /> : <Monitor size={15} aria-hidden="true" />}
                <span className="sketch-screen-label"><span>{item.title || item.id}</span>
                  {progress && <small>{screenStatusLabels[progress]}</small>}
                </span>
              </Button>;
            })}
          </nav>
        </section>
        <Disclosure className="sketch-pane sketch-screen-details">
          <summary className="sketch-pane-heading">
            <ChevronRight className="sketch-pane-chevron" size={14} aria-hidden="true" /><span>Screen details</span>
          </summary>
          <div className="sketch-pane-body sketch-screen-fields">
            <FormField id="sketch-title" label="Screen title" error={drafts[screenFieldKey("title")]?.error}>
              {control => <Input {...control} maxLength={500} disabled={!writable || !screen}
                value={fieldValue(screenFieldKey("title"), screen?.title)} aria-invalid={fieldInvalid(screenFieldKey("title"))}
                onChange={(event) => editScreen((item) => { item.title = event.target.value; }, { key: screenFieldKey("title"), value: event.target.value })} />}
            </FormField>
            {(["purpose", "notes"] as const).map((field) => <FormField key={field} id={`sketch-${field}`}
              label={field === "purpose" ? "Purpose" : "Notes"} error={drafts[screenFieldKey(field)]?.error}>
              {control => <Textarea {...control} rows={3} maxLength={field === "purpose" ? 500 : 4000}
                disabled={!writable || !screen} value={fieldValue(screenFieldKey(field), screen?.[field])}
                aria-invalid={fieldInvalid(screenFieldKey(field))}
                onChange={(event) => editScreen((item) => { item[field] = event.target.value; }, { key: screenFieldKey(field), value: event.target.value })} />}
            </FormField>)}
            <FormField id="sketch-decisions" label="Requirement decision IDs" error={drafts[screenFieldKey("decisions")]?.error}>
              {control => <Input {...control} placeholder="Comma-separated IDs" disabled={!writable || !screen}
                value={fieldValue(screenFieldKey("decisions"), screen?.decisionIds.join(", "))}
                aria-invalid={fieldInvalid(screenFieldKey("decisions"))}
                onBlur={() => finishField(screenFieldKey("decisions"))}
                onChange={(event) => editScreen((item) => {
                  item.decisionIds = event.target.value.split(",").map((id) => id.trim()).filter(Boolean);
                }, { key: screenFieldKey("decisions"), value: event.target.value, keepInput: true })} />}
            </FormField>
          </div>
        </Disclosure>
        {screen && <DslStructure key={JSON.stringify([selectionKey, screen.id])}
          screen={screen} selectedId={selectedNodeId} onSelect={selectElement} />}
      </aside>
      <div className="sketch-main" data-side-pane-open={sidePane !== ""}>
        <SketchViewport context={JSON.stringify([identityOf(state), screen?.id])} width={screen?.width ?? 960}
          height={screen?.height ?? 640} blocked={!screen} tools={
            <div className="sketch-view-mode" role="group" aria-label="UI preview mode">
              <IconButton variant="secondary" id="sketch-pick-element" className="sketch-icon-button" type="button" aria-pressed={pickingElement} disabled={!screen}
                aria-label="Select elements" title="Select elements" onClick={() => setPickingElement(true)}>
                <MousePointer2 size={15} aria-hidden="true" />
              </IconButton>
              <IconButton variant="secondary" id="sketch-interact" className="sketch-icon-button" type="button" aria-pressed={!pickingElement} disabled={!screen}
                aria-label="Interact with preview" title="Interact with preview controls" onClick={() => setPickingElement(false)}>
                <Hand size={15} aria-hidden="true" />
              </IconButton>
            </div>
          } viewActions={
            <ToggleGroup.Root id="sketch-pane-selector" className="sketch-pane-controls" type="single"
              value={sidePane} aria-label="Design side pane" disabled={!screen}
              onValueChange={(value) => {
                if (value === "" || value === "transitions" || value === "history") setSidePane(value);
              }}>
              {sidePanes.map(({ id, label, target, Icon }) => <ToggleGroup.Item iconOnly key={id} id={`sketch-toggle-${id}`}
                className="sketch-icon-button" type="button" value={id}
                title={`${sidePane === id ? "Hide" : "Show"} ${label.toLowerCase()}`}
                aria-label={`${sidePane === id ? "Hide" : "Show"} ${label.toLowerCase()}`}
                aria-expanded={sidePane === id} aria-controls={target}>
                <Icon size={20} aria-hidden="true" />
              </ToggleGroup.Item>)}
            </ToggleGroup.Root>
          } sizeControl={
            <Select id="sketch-size-preset" className="sketch-size-preset" aria-label="Canvas size" title="Canvas size"
              disabled={!writable || !screen} value={canvasPreset?.id ?? "custom"}
              onChange={(event) => editScreen((item) => {
                const preset = SKETCH_SIZE_PRESETS.find((size) => size.id === event.target.value);
                if (!preset) throw new Error("Choose a supported canvas size preset.");
                resizeScreen(item, preset.width, preset.height);
              })}>
              {!canvasPreset && <option value="custom" disabled>{screen ? `Custom (${screen.width} × ${screen.height})` : "No canvas"}</option>}
              {SKETCH_SIZE_PRESETS.map((size) => <option key={size.id} value={size.id}>
                {size.label} ({size.width} × {size.height})
              </option>)}
            </Select>
          } help={<div className="sketch-page-heading">
            {pageStatus && screen && <div id="sketch-page-status" className="sketch-page-status"
              role="status" aria-live="polite" aria-atomic="true" data-status={pageStatus}>
              <ScreenStatusIcon status={pageStatus} /><strong>{screen.title}</strong>
              <span>{pageStatus === "waiting" ? "Waiting for design"
                : pageStatus === "processing" ? "Design in progress"
                : pageStatus === "stopped" ? "Generation stopped - partial content retained" : "Preview ready - not saved or approved"}</span>
            </div>}
            <p id="sketch-board-help" className="visually-hidden">{boardHelp}</p>
            {!pickingElement && document && screen && <nav className="sketch-flow-preview" aria-label="Preview screen flow">
              <span className="muted">Navigation preview only</span>
              {document.transitions.filter(item => item.fromScreenId === screen.id).map(transition =>
                <Button variant="secondary" key={transition.id} type="button" title={transition.description}
                  onClick={() => setSelectedScreen(transition.toScreenId)}>
                  {transition.trigger} &rarr; {document.screens.find(item => item.id === transition.toScreenId)?.title}
                </Button>)}
            </nav>}
          </div>}>
          <div id="sketch-board" className="sketch-board" tabIndex={0} role="group"
            aria-busy={generating && (pageStatus === "waiting" || pageStatus === "processing")}
            aria-label={livePreview ? "Live UI DSL preview (not saved)" : "UI DSL screen view"} aria-describedby="sketch-board-help">
            {screen && <DslView key={screen.id} screen={screen} selection={{
              nodeId: selectedNodeId, picking: pickingElement, onSelect: selectElement,
            }} onNavigate={transitionId => {
              const transition = document?.transitions.find(item => item.id === transitionId && item.fromScreenId === screen.id);
              if (transition) setSelectedScreen(transition.toScreenId);
            }} />}
            {screen && pageStatus && pageStatus !== "ready" && !hasScreenContent(screen)
              && <div className="sketch-page-placeholder" aria-hidden="true">
                <ScreenStatusIcon status={pageStatus} />
                <strong>{screen.title}</strong>
                <span>{pageStatus === "waiting" ? "Waiting for design" : pageStatus === "stopped" ? "Generation stopped" : "Design in progress"}</span>
              </div>}
          </div>
        </SketchViewport>
        <aside id="sketch-screen-transitions" className="sketch-pane sketch-side-pane" aria-labelledby="sketch-transitions-heading"
          hidden={sidePane !== "transitions"} onKeyDown={sidePaneKeydown}>
          <div className="sketch-pane-heading">
            <h3 id="sketch-transitions-heading">Screen transitions</h3>
            <IconButton variant="ghost" size="small" aria-label="Close screen transitions" onClick={event => closeSidePane(event.currentTarget)}>
              <X size={14} aria-hidden="true" />
            </IconButton>
          </div>
          <div className="sketch-pane-body">
            <div id="sketch-transitions">
              {!document?.transitions.length && <p className="muted">No screen transitions yet.</p>}
              {document?.transitions.map((transition) => <div key={transition.id} className="sketch-transition">
                {(["fromScreenId", "toScreenId", "trigger", "description"] as const).map((field) => {
                  const fieldKey = `transition:${transition.id}:${field}`;
                  const change = (value: string) => edit((draft) => {
                    draft.transitions.find((item) => item.id === transition.id)![field] = value;
                  }, { key: fieldKey, value });
                  const props = {
                    disabled: !writable, "data-ui-key": `sketch-transition:${transition.id}:${field}`,
                    value: fieldValue(fieldKey, transition[field]), "aria-invalid": fieldInvalid(fieldKey),
                    onChange: (event: { target: { value: string } }) => change(event.target.value),
                  };
                  return <FormField key={field} id={`sketch-transition-${transition.id}-${field}`} error={drafts[fieldKey]?.error}
                    label={({ fromScreenId: "From", toScreenId: "To", trigger: "Trigger", description: "Description" } satisfies Record<Exclude<keyof SketchTransition, "id">, string>)[field]}>
                    {control => field === "fromScreenId" || field === "toScreenId"
                      ? <Select {...control} {...props}>{document.screens.map((item) => <option key={item.id} value={item.id}>{item.title || item.id}</option>)}</Select>
                      : <Input {...control} {...props} maxLength={500} />}
                  </FormField>;
                })}
                <Button variant="secondary" type="button" disabled={!writable} onClick={() => {
                  if (edit((draft) => { draft.transitions = draft.transitions.filter((item) => item.id !== transition.id); })) {
                    updateDrafts(Object.fromEntries(Object.entries(draftsRef.current).filter(([key]) => !key.startsWith(`transition:${transition.id}:`))));
                  }
                }}><Trash2 size={14} aria-hidden="true" /> Remove transition</Button>
              </div>)}
            </div>
            <Button variant="secondary" id="sketch-add-transition" type="button" disabled={!writable || !screen || (document?.transitions.length ?? 0) >= 40}
              onClick={() => edit((draft) => {
                draft.transitions.push({
                  id: nextId("transition", draft.transitions.map((item) => item.id)),
                  fromScreenId: screen!.id, toScreenId: draft.screens.find((item) => item.id !== screen!.id)?.id ?? screen!.id,
                  trigger: "Continue", description: "",
                });
              })}><Plus size={14} aria-hidden="true" /> Add transition</Button>
          </div>
        </aside>
        <aside id="sketch-revision-history" className="sketch-pane sketch-side-pane" aria-labelledby="sketch-history-heading"
          hidden={sidePane !== "history"} onKeyDown={sidePaneKeydown}>
          <div className="sketch-pane-heading">
            <h3 id="sketch-history-heading">Revision history</h3>
            <IconButton variant="ghost" size="small" aria-label="Close revision history" onClick={event => closeSidePane(event.currentTarget)}>
              <X size={14} aria-hidden="true" />
            </IconButton>
          </div>
          <div className="sketch-pane-body">
            {!revisions.length && <p className="muted">No saved revisions yet.</p>}
            <ul id="sketch-history" className="muted">{revisions.map((revision) => <li key={revision.id}>
              {`Revision ${revision.number} · ${revision.source} · ${revision.createdAt}`}
              {revision.id === state.sketch.approved?.revisionId ? " · approved" : ""}
              {revision.id === state.sketch.current?.id ? " · current" : ""}
            </li>)}</ul>
          </div>
        </aside>
      </div>
    </div>
    <div className="sketch-input-pane">
    <FeedbackHistory id="sketch-request-history-pane" triggerId="sketch-history-toggle"
      label="Design request history" open={historyOpen} onClose={() => setHistoryOpen(false)}>
      <p id="sketch-message" className="sketch-error" role="alert" hidden={!message}>{message}</p>
      <section id="sketch-failed-revision" className="sketch-details" aria-label="Failed design revision" hidden={!retryInstruction || recoverable}>
        <p id="sketch-failed-instruction" className="muted">{retryInstruction ? "Failed revision instruction: " + retryInstruction : ""}</p>
        <Button variant="secondary" id="sketch-retry-revision" type="button" aria-describedby="sketch-retry-help"
          disabled={!requestWritable || !document || conflict || !retryInstruction || invalidFields || workerRequest?.kind === "update" && dirty}
          onClick={() => void submit(workerRequest?.kind === "update" ? "update" : "revise", retryInstruction)}>
          <RefreshCw size={14} aria-hidden="true" />{workerRequest?.kind === "update" ? "Retry update" : "Retry same revision"}</Button>
        <p id="sketch-retry-help" className="visually-hidden">{workerRequest?.kind === "update"
          ? "Retries the incremental update against saved designs. Save or undo local edits first; any new instruction below is kept."
          : "Retries the original instruction against these designs. Local edits are saved first; any new instruction below is kept."}</p>
      </section>
      <ol id="sketch-request-history" className="sketch-request-history feedback-request-history">
        {history.map((item) => <li key={item.id} data-status={item.status}>
          <div><strong>{item.kind === "revise" ? "Revision" : item.kind[0].toUpperCase() + item.kind.slice(1)}</strong>
            <span>{new Date(item.at).toLocaleTimeString()}</span></div>
          <p><b>Request:</b> {item.request}</p>
          <p><b>Response:</b> {item.response}</p>
          {item.changeRequestId && ui.changeRequestDialog && <Button variant="secondary" className="plan-button secondary" type="button"
            onClick={event => ui.changeRequestDialog!.open(item.changeRequestId!, event.currentTarget)}>View this request</Button>}
        </li>)}
      </ol>
      <p className="muted" hidden={Boolean(history.length || message || retryInstruction)}>
        No design requests yet.
      </p>
    </FeedbackHistory>
    <form id="sketch-revise-form" className="sketch-revise-form feedback-composer" onSubmit={(event) => { event.preventDefault(); void submit("revise"); }}>
      <label className="visually-hidden" htmlFor="sketch-instruction">Describe a design change</label>
      <Textarea submitOnEnter className="composer-input" id="sketch-instruction" rows={1} maxLength={4000} disabled={!writable || Boolean(requiredReview)}
        value={instruction} onChange={(event) => setInstruction(event.currentTarget.value)}
        aria-describedby="sketch-board-help sketch-status sketch-review-required"
        placeholder={wireframe ? "Change a layout, label or navigation path... (Enter to send)" : "Describe a design change... (Enter to send)"} />
      <Button variant="primary" id="sketch-revise" className="plan-button feedback-send" type="submit"
        title={requirementsChanged ? "Update designs from latest requirements before sending a revision." : "Send design revision (Enter)"}
        disabled={!writable || !document || conflict || !instruction.trim() || invalidFields || Boolean(requiredReview) || requirementsChanged}>
        <Send size={15} aria-hidden="true" /> Send
      </Button>
      <FeedbackHistoryButton id="sketch-history-toggle" target="sketch-request-history-pane"
        open={historyOpen} error={Boolean(activeError)} errorLabel="Open request history and design errors"
        onToggle={() => setHistoryOpen(open => !open)} />
    </form>
    <p id="sketch-review-required" className="visually-hidden" role="status">{requiredReview
      ? "Review required. New changes are paused until this review is resolved. You can still inspect screens and history." : ""}</p>
    </div>
  </section>;
}
