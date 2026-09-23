import {
  createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type KeyboardEvent, type PointerEvent, type ReactNode,
} from "react";
import { Popover, Toggle, ToggleGroup } from "radix-ui";
import {
  ArrowRight, Check, ChevronDown, Circle, History, Minus, PanelRight, Pencil, PenTool, Plus, Redo2, RefreshCw, Save, Send, Sparkles, Spline, Square, Trash2, Type, Undo2, Workflow, X,
} from "lucide-react";
import { validateSketchDocument } from "../sketch.js";
import type { SketchCurve, SketchDocument, SketchRevision, SketchScreen, SketchShape, SketchState, SketchTransition } from "../sketch.js";
import { sketchPathData } from "../sketch-path.js";
import { createCurveShape, createScreen, createShape, parsePathPoints, renderSketchPng, resizeScreen, setPathPoints, setShapeBounds, shapeBounds, SketchEditor, SKETCH_SIZE_PRESETS } from "./sketch-editor.js";
import { SketchViewport } from "./sketch-viewport.js";
import { SpeechTextarea, useSpeechCoordinator } from "./speech-textarea.js";
import { SketchLivePanel } from "./sketch-live-panel.js";
import { sketchLiveContext } from "./sketch-live-context.js";
import type { SketchLiveSessionFactory } from "./sketch-live-session.js";
import { readSketchPreview } from "./sketch-preview.js";
import { hasActiveJobs, skippedStage, useAction, useDraft, useUi, type UiState } from "./ui-context.js";

// The shell must distinguish completion readiness from pending requests: unsaved drawings
// block Finish Sketch, but must not disable their own editing controls.
export const SketchCompletionContext = createContext<(blocked: boolean) => void>(() => {});

export function isSketchRevisionApproved(sketch: SketchState): boolean {
  const { current, approved } = sketch;
  return sketch.status === "approved" && Boolean(current && approved
    && approved.revisionId === current.id
    && approved.documentHash === current.documentHash
    && approved.requirementsDigest === current.requirementsDigest);
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const clamp = (value: number, max: number) => Math.max(0, Math.min(max, value));
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
const errorMessage = (cause: unknown) => cause instanceof Error ? cause.message : "Could not update drawings.";

interface FieldDraft { value: string; error: string }
interface FieldEdit { key: string; value: string; keepInput?: boolean }
interface RequestHistoryItem {
  id: string;
  requestId: string;
  at: string;
  kind: "generate" | "save" | "approve" | "revise";
  request: string;
  response: string;
  status: "running" | "success" | "error";
}
interface LoadState {
  loading: boolean;
  baseRevision: SketchRevision | null;
  loadedKey: string | null;
  failedKey: string | null;
  conflict: boolean;
}
interface Gesture {
  id: number;
  x: number;
  y: number;
  screen: SketchScreen;
  shape: SketchShape | null;
  points: Array<{ x: number; y: number }>;
  moved: SketchShape | null;
  pointIndex: number | null;
}

function freehandShape(screen: SketchScreen, points: Gesture["points"]): SketchShape {
  const x = Math.min(...points.map((point) => point.x));
  const y = Math.min(...points.map((point) => point.y));
  return {
    ...createShape(screen, "path"), x, y,
    width: Math.max(...points.map((point) => point.x)) - x,
    height: Math.max(...points.map((point) => point.y)) - y,
    points,
  };
}

function ShapePrimitive({ shape }: { shape: SketchShape }) {
  const style = { stroke: shape.stroke, fill: shape.fill, strokeWidth: 2 };
  if (shape.kind === "rectangle") {
    return <rect x={shape.x} y={shape.y} width={shape.width} height={shape.height} {...style} />;
  }
  if (shape.kind === "ellipse") {
    return <ellipse cx={shape.x + shape.width / 2} cy={shape.y + shape.height / 2}
      rx={shape.width / 2} ry={shape.height / 2} {...style} />;
  }
  if (shape.kind === "text") {
    return <text x={shape.x} y={shape.y + Math.min(shape.fontSize, shape.height)}
      fontFamily="sans-serif" fontSize={shape.fontSize} fill={shape.fill === "none" ? shape.stroke : shape.fill}
      stroke="none" xmlSpace="preserve">{shape.text}</text>;
  }
  if (shape.kind === "path") {
    return <path d={sketchPathData(shape)} {...style} />;
  }
  const [start, end] = shape.points;
  let head: ReactNode = null;
  if (shape.kind === "arrow") {
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const size = Math.min(10, Math.hypot(end.x - start.x, end.y - start.y) / 2);
    const left = { x: end.x - size * Math.cos(angle - Math.PI / 6), y: end.y - size * Math.sin(angle - Math.PI / 6) };
    const right = { x: end.x - size * Math.cos(angle + Math.PI / 6), y: end.y - size * Math.sin(angle + Math.PI / 6) };
    head = <path d={`M ${left.x} ${left.y} L ${end.x} ${end.y} L ${right.x} ${right.y}`}
      fill="none" stroke={shape.stroke} strokeWidth={2} />;
  }
  return <><line x1={start.x} y1={start.y} x2={end.x} y2={end.y} {...style} />{head}</>;
}

export function SketchSvg({ screen, selectedShape = "", editPoints = false }: {
  screen: SketchScreen; selectedShape?: string; editPoints?: boolean;
}) {
  const selected = screen.shapes.find((shape) => shape.id === selectedShape);
  return <svg xmlns="http://www.w3.org/2000/svg" width={screen.width} height={screen.height}
    viewBox={`0 0 ${screen.width} ${screen.height}`}>
    <title>{screen.title}</title>
    <rect width={screen.width} height={screen.height} fill="#ffffff" />
    {screen.shapes.map((shape) => <g key={shape.id} data-shape-id={shape.id}
      className={shape.id === selectedShape ? "sketch-selected" : undefined}>
      <ShapePrimitive shape={shape} />
    </g>)}
    {editPoints && selected?.kind === "path" && <g className="sketch-path-handles" data-point-shape={selected.id}>
      {(selected.curve === "quadratic" || selected.curve === "cubic") && <polyline
        points={selected.points.map((point) => `${point.x},${point.y}`).join(" ")}
        fill="none" stroke="#777777" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" pointerEvents="none" />}
      {selected.points.map((point, index) => {
        const control = selected.curve === "quadratic" ? index % 2 !== 0 : selected.curve === "cubic" && index % 3 !== 0;
        return <circle key={index} data-point-index={index} cx={point.x} cy={point.y} r={5}
          fill={control ? "#ffffff" : "#333333"} stroke="#333333" strokeWidth={2} vectorEffect="non-scaling-stroke">
          <title>{`${control ? "Control point" : "Knot / endpoint"} ${index + 1}: drag to edit`}</title>
        </circle>;
      })}
    </g>}
  </svg>;
}

const curveLabels: Record<SketchCurve, string> = {
  linear: "Linear", quadratic: "Quadratic Bezier", cubic: "Cubic Bezier", "catmull-rom": "Catmull-Rom spline",
};
const shapeTools: Array<{
  id: string; kind: SketchShape["kind"]; curve?: Exclude<SketchCurve, "linear">; label: string; Icon: typeof Square;
}> = [
  { id: "rectangle", kind: "rectangle", label: "Rectangle", Icon: Square },
  { id: "ellipse", kind: "ellipse", label: "Ellipse", Icon: Circle },
  { id: "text", kind: "text", label: "Text", Icon: Type },
  { id: "line", kind: "line", label: "Line", Icon: Minus },
  { id: "arrow", kind: "arrow", label: "Arrow", Icon: ArrowRight },
  { id: "quadratic", kind: "path", curve: "quadratic", label: "Quadratic Bezier", Icon: PenTool },
  { id: "cubic", kind: "path", curve: "cubic", label: "Cubic Bezier", Icon: PenTool },
  { id: "spline", kind: "path", curve: "catmull-rom", label: "Catmull-Rom spline", Icon: Spline },
];
const colorChoices = [
  ["none", "None"], ["#ffffff", "White"], ["#eeeeee", "Light gray"],
  ["#999999", "Gray"], ["#333333", "Dark gray"], ["#000000", "Black"],
] as const;
const sidePanes = [
  { id: "properties", label: "Object properties", target: "sketch-object-properties", Icon: PanelRight },
  { id: "transitions", label: "Screen transitions", target: "sketch-screen-transitions", Icon: Workflow },
  { id: "history", label: "Revision history", target: "sketch-revision-history", Icon: History },
] as const;

export function SketchPanel({ createLiveSession }: { createLiveSession?: SketchLiveSessionFactory } = {}) {
  const ui = useUi();
  const speech = useSpeechCoordinator();
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
  const [selectedShape, setSelectedShape] = useState("");
  const [sidePane, setSidePane] = useState<"" | "properties" | "transitions" | "history">("");
  const propertiesOpen = sidePane === "properties";
  const [drawing, setDrawing] = useState(false);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const gestureRef = useRef(gesture);
  const [instruction, setInstruction] = useDraft("sketch:instruction", "");
  const [voiceProvider, setVoiceProvider] = useDraft<"azure-speech" | "gpt-live">("sketch:voice-provider", "azure-speech");
  const [voiceSettingsOpen, setVoiceSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [requestHistory, setRequestHistory] = useState<RequestHistoryItem[]>([]);
  const [clearedWorkerError, setClearedWorkerError] = useState("");
  const instructionInput = useRef<HTMLTextAreaElement>(null);
  const instructionRef = useRef(instruction);
  instructionRef.current = instruction;
  const [retryDraft, setRetryDraft] = useState("");
  const operation = useRef(false);
  const mounted = useRef(true);
  const request = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const board = useRef<HTMLDivElement>(null);
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
  const dirty = editor.dirty || Boolean(gesture) || Object.keys(drafts).length > 0;
  const incoming = useMemo(() => {
    try { return { preview: readSketchPreview(state, state.sketchPreview), error: "" }; }
    catch (cause) { return { preview: null, error: errorMessage(cause) }; }
  }, [state]);
  const livePreview = !dirty ? incoming.preview : null;
  // A preview is only a display source: the editor, undo history and voice scene stay local/saved.
  const document = livePreview?.document ?? editor.document;
  const screen = document?.screens.find((item) => item.id === selectedScreen) ?? document?.screens[0];
  const shape = screen?.shapes.find((item) => item.id === selectedShape);
  const remoteChanged = loadState.loadedKey !== null
    && revisionIdentity(loadState.baseRevision) !== revisionIdentity(state.sketch.current);
  const conflict = loadState.conflict || (!action.busy && remoteChanged && dirty);
  const emptyScreens = !document?.screens.length || document.screens.some((item) => !item.shapes.length);
  const writable = canEdit("sketch") && state.provider?.canSubmitAnswers !== false
    && !skipped && !pending && !hasActiveJobs(state) && !action.busy && !loadState.loading
    && !gesture && loadState.loadedKey !== null && loadState.failedKey !== key && (!remoteChanged || dirty || loadState.conflict);
  const worker = ["generate-sketch", "revise-sketch"].includes(state.processing?.action) ? state.processing : null;
  const workerErrorKey = worker?.status === "error" ? JSON.stringify([worker.requestId ?? "", worker.message ?? "", worker.answer ?? ""]) : "";
  const workerErrorCleared = Boolean(workerErrorKey && clearedWorkerError === workerErrorKey);
  const failedInstruction = worker?.action === "revise-sketch" && worker.status === "error" && typeof worker.answer === "string"
    && !workerErrorCleared ? worker.answer.trim() : "";
  const retryInstruction = retryDraft || failedInstruction;
  const completionBlocked = hasActiveJobs(state) || action.busy || loadState.loading || dirty || conflict || !available || Boolean(skipped)
    || loadState.loadedKey !== key || loadState.failedKey === key || emptyScreens || !isSketchRevisionApproved(state.sketch);

  function updateLoad(change: Partial<LoadState>) {
    loadRef.current = { ...loadRef.current, ...change };
    setLoadState(loadRef.current);
  }
  function updateDrafts(next: Record<string, FieldDraft>) {
    draftsRef.current = next;
    setDrafts(next);
  }
  function updateGesture(next: Gesture | null) {
    gestureRef.current = next;
    setGesture(next);
  }
  function isDirty() {
    return editor.dirty || Boolean(gestureRef.current) || Object.keys(draftsRef.current).length > 0;
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
  function canWrite() {
    const context = latest.current;
    const snapshot = stateRef.current;
    return mounted.current && context.canEdit("sketch") && snapshot.provider?.canSubmitAnswers !== false
      && !skippedStage(snapshot, "sketch") && !context.pending && !hasActiveJobs(snapshot)
      && !operation.current && !loadRef.current.loading && !gestureRef.current
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
    if (kind === "revise") return value || "Revise drawings";
    if (kind === "generate") return editor.document ? "Regenerate drawings" : "Generate drawings";
    if (kind === "approve") return "Approve drawings and continue";
    return "Save drawings";
  }
  function responseLabel(kind: RequestHistoryItem["kind"], result: UiState | undefined) {
    if (kind === "save") return `Saved ${result?.sketch.current ? `revision ${result.sketch.current.number}` : "drawings"}.`;
    if (kind === "approve") return "Approved drawings and continued to the next stage.";
    const processing = result?.processing;
    if (processing?.message) return processing.message;
    return kind === "revise" ? "Revision request queued." : "Drawing generation queued.";
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
    const kind = worker.action === "revise-sketch" ? "revise" : "generate";
    const requestText = typeof worker.answer === "string" && worker.answer.trim()
      ? worker.answer.trim() : kind === "revise" ? "Revise drawings" : "Generate drawings";
    const status = worker.status === "error" ? "error" : worker.status === "success" ? "success" : "running";
    const response = worker.message || (status === "error" ? "Drawing request failed."
      : status === "success" ? "Drawing request completed." : "Drawing request is running.");
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
  }, [worker?.requestId, worker?.action, worker?.status, worker?.message, worker?.answer]);
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
      const response = await fetch("/api/sketch", { cache: "no-store", signal: abort.signal });
      const result = await response.json() as { sketch?: SketchState; document?: unknown; error?: string };
      if (!response.ok) throw new Error(result.error || "Could not load drawings.");
      if (!mounted.current || sequence !== request.current || startKey !== loadKey(stateRef.current)) return;
      if (!result.sketch || !Object.hasOwn(result.sketch, "current")
        || revisionIdentity(result.sketch.current) !== revisionIdentity(stateRef.current.sketch.current)) {
        throw new Error("The saved drawing changed while loading. Reload the latest state and drawings.");
      }
      if (!Object.hasOwn(result, "document")) throw new Error("The drawing response did not include a document.");
      if (isDirty() && !discard) {
        updateLoad({ conflict: true });
        return;
      }
      if (result.sketch.current && !result.document) throw new Error("The saved drawing document is unavailable.");
      if (!result.sketch.current && result.document) throw new Error("The drawing document has no saved revision identity.");
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
      action.setError(abort.signal.aborted ? "Loading drawings timed out. Reload saved drawings to retry." : errorMessage(cause));
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

  function edit(change: (draft: SketchDocument) => void, field?: FieldEdit) {
    if (!canWrite()) return false;
    try {
      editor.edit(change);
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
  function editScreen(change: (item: SketchScreen) => void, field?: FieldEdit) {
    if (!screen) return false;
    return edit((draft) => {
      const item = draft.screens.find((item) => item.id === screen.id);
      if (item) change(item);
    }, field);
  }
  function editShape(change: (item: SketchShape, owner: SketchScreen) => SketchShape, field?: FieldEdit) {
    return editScreen((owner) => {
      owner.shapes = owner.shapes.map((item) => item.id === selectedShape ? change(item, owner) : item);
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
  function deleteShape() {
    if (!shape) return;
    if (editScreen((owner) => { owner.shapes = owner.shapes.filter((item) => item.id !== shape.id); })) {
      updateDrafts(Object.fromEntries(Object.entries(draftsRef.current).filter(([key]) => !key.startsWith(`shape:${screen!.id}:${shape.id}:`))));
      setSelectedShape("");
    }
  }

  function ensureEffort(identity: string) {
    if (!mounted.current || identity !== identityOf(stateRef.current)) {
      throw new Error("The effort changed. Review drawings before continuing.");
    }
  }
  function ensureRevision(revision: SketchRevision | null) {
    if (revisionIdentity(revision) !== revisionIdentity(stateRef.current.sketch.current)) {
      throw new Error("The drawing changed. Your local edits are retained; reload drawings before retrying.");
    }
  }
  function ensureSketchWritable() {
    const snapshot = stateRef.current;
    if (snapshot.lifecycle.currentStage !== "sketch" || snapshot.lifecycle.completedStages.includes("sketch")
      || skippedStage(snapshot, "sketch") || snapshot.provider?.canSubmitAnswers === false || snapshot.effortReset
      || hasActiveJobs(snapshot)) {
      throw new Error("Sketch is no longer editable. Review the current stage and provider before retrying.");
    }
  }
  async function post(endpoint: string, body: unknown, identity: string) {
    const result = await latest.current.post(endpoint, body);
    ensureEffort(identity);
    if (!result?.sketch || identityOf(result) !== identity) {
      throw new Error("The drawing update could not be confirmed. Reload state before retrying.");
    }
    if (result.revision >= stateRef.current.revision) stateRef.current = result;
    return result;
  }
  async function save(identity: string, expectedGeneration?: string) {
    if (!editor.document) throw new Error("Add a screen before saving.");
    if (hasInvalidFields()) throw new Error("Complete the invalid drawing fields before saving drawings.");
    ensureRevision(loadRef.current.baseRevision);
    const savedDocument = validateSketchDocument(editor.document, acceptedDecisionIds(stateRef.current));
    const result = await post("/api/sketch", {
      action: "save", expectedRevision: loadRef.current.baseRevision?.id ?? null, document: savedDocument,
      ...(expectedGeneration !== undefined ? { expectedGeneration } : {}),
    }, identity);
    const revision = result.sketch.current;
    if (!revision) throw new Error("The saved revision could not be confirmed. Reload state before retrying.");
    ensureRevision(revision);
    editor.markSaved();
    updateDrafts({});
    updateLoad({ baseRevision: { ...revision }, loadedKey: loadKey(stateRef.current), failedKey: null, conflict: false });
  }
  async function submit(kind: "generate" | "save" | "approve" | "revise", retry?: string, signal?: AbortSignal) {
    if (!canWrite() || hasConflict() || hasInvalidFields()) return;
    const requestedInstruction = retry ?? instructionRef.current.trim();
    if (kind === "revise" && (!editor.document || !requestedInstruction)) return;
    if (kind === "generate" && editor.dirty) {
      action.setError("Save drawings before regenerating. Local edits have been kept.");
      return;
    }
    if (kind === "approve" && (emptyScreens || stateRef.current.sketch.status === "stale")) return;
    const identity = identityOf(stateRef.current);
    const expectedGeneration = signal ? stateRef.current.generation : undefined;
    const startRevision = loadRef.current.baseRevision;
    const historyId = `${Date.now()}-${kind}`;
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
        if (kind === "generate" && editor.document
          && !await latest.current.confirm("Generate a new drawing revision? Your saved revision remains in history.", "Regenerate drawings")) {
          updateHistory(historyId, { response: "Request cancelled.", status: "success" });
          return;
        }
        ensureEffort(identity);
        ensureRevision(startRevision);
        ensureSketchWritable();
        signal?.throwIfAborted();
        if (kind === "revise" && retry !== undefined) setRetryDraft(requestedInstruction);
        if (kind === "save" || (editor.dirty && (kind === "approve" || kind === "revise"))) await save(identity, expectedGeneration);
        ensureEffort(identity);
        ensureSketchWritable();
        signal?.throwIfAborted();
        if (kind === "approve") {
          const revision = loadRef.current.baseRevision;
          if (!revision || !editor.document) throw new Error("Save a drawing revision before approval.");
          const approvalDocument = clone(editor.document);
          const previews = [];
          for (const item of approvalDocument.screens) previews.push(await renderSketchPng(item));
          ensureEffort(identity);
          ensureRevision(revision);
          ensureSketchWritable();
          if (stateRef.current.sketch.status === "stale") throw new Error("Requirements changed during PNG export. Review drawings before approving.");
          const result = await post("/api/sketch", { action: "approve", expectedRevision: revision.id, previews }, identity);
          ensureRevision(revision);
          if (!isSketchRevisionApproved(result.sketch) || !isSketchRevisionApproved(stateRef.current.sketch)
            || result.sketch.approved?.revisionId !== revision.id) {
            throw new Error("Drawing approval could not be confirmed.");
          }
          ensureSketchWritable();
          await post("/api/stage/complete", { stageId: "sketch" }, identity);
          updateHistory(historyId, { response: responseLabel("approve", stateRef.current), status: "success" });
        } else if (kind !== "save") {
          const result = await post("/api/sketch", {
            action: kind, expectedRevision: loadRef.current.baseRevision?.id ?? null,
            ...(kind === "revise" ? { instruction: requestedInstruction } : {}),
            ...(expectedGeneration !== undefined ? { expectedGeneration } : {}),
          }, identity);
          updateHistory(historyId, {
            requestId: typeof result.processing?.requestId === "string" ? result.processing.requestId : "",
            response: responseLabel(kind, result),
            status: ["error", "failed"].includes(result.processing?.status) ? "error" : "running",
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

  async function reviseByVoice(instruction: string, signal: AbortSignal) {
    signal.throwIfAborted();
    if (!canWrite() || hasConflict() || hasInvalidFields() || !editor.document) {
      throw new Error("Drawings are busy, conflicted or unavailable. Finish the current edit or reload before asking again.");
    }
    const identity = identityOf(stateRef.current);
    const queued = await submit("revise", instruction, signal);
    if (!queued || typeof queued.processing?.requestId !== "string") {
      throw new Error("The voice revision could not be submitted. Review the drawing error and retry explicitly.");
    }
    const requestId = queued.processing.requestId;
    const baseRevisionId = queued.processing.sketchRequest?.baseRevisionId ?? queued.sketch.current?.id;
    const deadline = Date.now() + 310_000;
    while (Date.now() < deadline) {
      signal.throwIfAborted();
      ensureEffort(identity);
      const snapshot = stateRef.current;
      if (snapshot.lifecycle.currentStage !== "sketch" || snapshot.effortReset) {
        throw new Error("Sketch changed while the voice revision was running.");
      }
      const processing = snapshot.processing;
      if (processing?.requestId !== requestId) throw new Error("The voice revision was replaced by another drawing request.");
      if (processing.status === "error") throw new Error(processing.message || "The voice drawing revision failed.");
      if (processing.status === "success") {
        const revision = snapshot.sketch.current;
        if (!revision || revision.id === baseRevisionId || revision.source !== "revised") {
          throw new Error("No new saved drawing revision could be confirmed.");
        }
        return `Drawing revision ${revision.number} is saved and ready to review. Approval is still required in the Sketch UI.`;
      }
      await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(new Error("Voice stopped.")); };
        const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 500);
        signal.addEventListener("abort", abort, { once: true });
      });
      signal.throwIfAborted();
      await latest.current.refresh();
    }
    throw new Error("The drawing revision has not finished within its deadline. Check Sketch before retrying.");
  }
  async function reload() {
    if (operation.current || loadRef.current.loading || gestureRef.current || hasActiveJobs(stateRef.current)) return;
    const identity = identityOf(stateRef.current);
    operation.current = true;
    await action.run(async () => {
      try {
        if (isDirty() && !await latest.current.confirm(
          "Discard your unsaved drawing edits and load the latest saved revision?", "Reload saved drawings")) return;
        ensureEffort(identity);
        await load(true);
      } finally {
        operation.current = false;
      }
    });
  }

  function position(event: PointerEvent<HTMLDivElement>, owner: SketchScreen) {
    const rect = board.current?.querySelector("svg")?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) throw new Error("The drawing viewport is unavailable. Try again when the Sketch panel is visible.");
    return {
      x: clamp((event.clientX - rect.left) * owner.width / rect.width, owner.width),
      y: clamp((event.clientY - rect.top) * owner.height / rect.height, owner.height),
    };
  }
  function releasePointer(id: number) {
    if (board.current?.hasPointerCapture(id)) board.current.releasePointerCapture(id);
  }
  function cancelGesture() {
    const current = gestureRef.current;
    updateGesture(null);
    if (current) releasePointer(current.id);
  }
  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!canWrite() || !screen || event.button !== 0) return;
    const element = event.target as Element;
    const id = element.closest("[data-shape-id]")?.getAttribute("data-shape-id")
      ?? element.closest("[data-point-shape]")?.getAttribute("data-point-shape");
    const target = screen.shapes.find((item) => item.id === id);
    if ((!drawing && !target) || (drawing && screen.shapes.length >= 100)) return;
    event.preventDefault();
    try {
      const point = position(event, screen);
      board.current!.setPointerCapture(event.pointerId);
      board.current!.focus();
      setSelectedShape(drawing ? "" : target!.id);
      const handle = !drawing && target?.kind === "path" ? element.closest("[data-point-index]") : null;
      updateGesture({
        id: event.pointerId, ...point, screen: clone(screen), shape: drawing ? null : clone(target!),
        points: [point], moved: null, pointIndex: handle ? Number(handle.getAttribute("data-point-index")) : null,
      });
    } catch (cause) {
      action.setError(errorMessage(cause));
    }
  }
  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const current = gestureRef.current;
    if (!current || current.id !== event.pointerId) return;
    try {
      const point = position(event, current.screen);
      if (current.shape) {
        if (current.pointIndex !== null) {
          updateGesture({ ...current, moved: setPathPoints(current.shape,
            current.shape.points.map((original, index) => index === current.pointIndex ? {
              x: clamp(original.x + point.x - current.x, current.screen.width),
              y: clamp(original.y + point.y - current.y, current.screen.height),
            } : original)) });
        } else {
          const bounds = shapeBounds(current.shape);
          updateGesture({ ...current, moved: setShapeBounds(current.screen, current.shape, {
            x: bounds.x + point.x - current.x, y: bounds.y + point.y - current.y,
          }) });
        }
      } else if (current.points.length < 512) {
        const last = current.points.at(-1)!;
        if (Math.hypot(point.x - last.x, point.y - last.y) >= 2) updateGesture({ ...current, points: [...current.points, point] });
      }
    } catch (cause) {
      cancelGesture();
      action.setError(errorMessage(cause));
    }
  }
  function pointerUp(event: PointerEvent<HTMLDivElement>) {
    if (gestureRef.current?.id !== event.pointerId) return;
    pointerMove(event);
    const current = gestureRef.current;
    if (!current) return;
    updateGesture(null);
    releasePointer(current.id);
    if (!canWrite()) return;
    if (current.moved) editShape(() => current.moved!);
    else if (!current.shape && current.points.length >= 2) {
      const item = freehandShape(current.screen, current.points);
      if (editScreen((owner) => { owner.shapes.push(item); })) setSelectedShape(item.id);
    }
  }
  function keydown(event: KeyboardEvent<HTMLElement>) {
    if ((event.target as Element).closest("input, textarea, select, [contenteditable=true]")) return;
    if (event.key === "Escape") {
      cancelGesture();
      setDrawing(false);
      return;
    }
    if (!canWrite()) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) redo(); else undo();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
      event.preventDefault();
      redo();
    } else if (shape && (event.target as Element).closest("#sketch-board, #sketch-shapes")) {
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        editShape((item, owner) => {
          const bounds = shapeBounds(item);
          return setShapeBounds(owner, item, {
            x: bounds.x + (event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0),
            y: bounds.y + (event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0),
          });
        });
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        deleteShape();
      }
    }
  }

  const status = skipped ? "Sketch disabled: " + skipped.reason
    : incoming.preview ? dirty
      ? "Live preview pending — local edits are preserved and remain visible. Incoming drawings are not saved or approved."
      : `Live preview · update ${incoming.preview.sequence} — not saved or approved. You can browse screens while AI draws.`
    : loadState.loading || (available && !dirty && loadState.loadedKey !== key && loadState.failedKey !== key) ? "Loading saved drawings…"
    : action.busy ? "Saving drawings or preparing approval…"
    : worker?.status === "running" || worker?.status === "starting" ? worker.message || "AI is preparing a drawing revision. Existing drawings are retained."
    : conflict ? "Conflict: a newer saved revision exists. Your local edits are retained; load latest explicitly to discard them."
    : state.provider?.canSubmitAnswers === false ? guidance("edit or approve drawings")
    : !canEdit("sketch") ? "Read only. Open or reopen Sketch to edit these drawings."
    : state.sketch.status === "stale" ? "Stale drawings: requirements changed. Regenerate or revise and review before approval."
    : document && emptyScreens ? "Add at least one shape to every screen before approving. Empty screens can be saved as drafts."
    : dirty ? "Unsaved drawings — save before leaving this browser. Switching tabs keeps your edits."
    : isSketchRevisionApproved(state.sketch) ? "Drawings approved. Finish Sketch to continue if the stage has not advanced."
    : document ? ""
    : "Generate drawings from the requirements DAG, or add a screen to draw your own.";
  const message = action.error || incoming.error || Object.values(drafts).find((draft) => draft.error)?.error
    || (worker?.status === "error" && !workerErrorCleared ? worker.message || "Drawing generation failed. Retry explicitly." : "");
  const activeError = Boolean(message || retryInstruction);
  const boardHelp = livePreview
    ? "Live preview is read only. Browse screens and shapes, or zoom while drawing continues. Nothing here is saved or approved yet."
    : drawing ? "Freehand: drag on the board to draw. Select Freehand again to stop." : "";
  const preview = screen && {
    ...screen,
    shapes: [
      ...screen.shapes.map((item) => gesture?.moved?.id === item.id ? gesture.moved : item),
      ...(gesture && !gesture.shape && gesture.points.length >= 2 ? [freehandShape(screen, gesture.points)] : []),
    ],
  };
  const shapeView = shape ? { ...shape, ...shapeBounds(shape) } : null;
  const screenFieldKey = (field: string) => `screen:${screen?.id}:${field}`;
  const shapeFieldKey = (field: string) => `shape:${screen?.id}:${shape?.id}:${field}`;
  const fieldValue = (key: string, value: string | number | undefined) => drafts[key]?.value ?? String(value ?? "");
  const fieldInvalid = (key: string) => Boolean(drafts[key]?.error);
  const canvasPreset = SKETCH_SIZE_PRESETS.find((size) => size.width === screen?.width && size.height === screen?.height);
  const revisions = [...new Map([...state.sketch.history, ...(state.sketch.current ? [state.sketch.current] : [])]
    .map((revision) => [revision.id, revision])).values()].reverse();
  const composer = {
    voiceOptions: <Popover.Trigger asChild>
      <button id="sketch-voice-options" className="voice-options-toggle" type="button" aria-label="Voice settings" title="Voice settings">
        <ChevronDown size={14} aria-hidden="true" />
      </button>
    </Popover.Trigger>,
    actions: <>
      <button id="sketch-revise" className="plan-button sketch-send" type="submit"
        title="Send drawing revision (Ctrl+Enter)"
        disabled={!writable || !document || conflict || !instruction.trim() || invalidFields || speech.active?.kind === "capture"}>
        <Send size={15} aria-hidden="true" /> Send
      </button>
      <button id="sketch-history-toggle" className="voice-settings-button sketch-history-toggle" type="button"
        data-status={activeError ? "error" : "idle"}
        aria-label={activeError ? "Open request history and drawing errors" : "Open request history"}
        title={activeError ? "Drawing request failed. Open request history." : "Request history"}
        aria-expanded={historyOpen} aria-controls="sketch-request-history-pane"
        onClick={() => setHistoryOpen((open) => !open)}><History size={17} aria-hidden="true" /></button>
    </>,
  };
  const sendShortcut = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  return <section className="sketch-stage" onKeyDown={keydown}>
    <div className="sketch-heading sketch-header-actions" role="group" aria-label="Sketch actions">
      <button id="sketch-add-screen" className="sketch-icon-button" type="button" title="Add screen" aria-label="Add screen"
        disabled={!writable || (document?.screens.length ?? 0) >= 8 || !acceptedDecisionIds(state).length}
        onClick={() => {
          let created = "";
          if (edit((draft) => {
            const item = createScreen(draft, acceptedDecisionIds(stateRef.current).slice(0, 200));
            draft.screens.push(item);
            created = item.id;
          })) { setSelectedScreen(created); setSelectedShape(""); }
        }}><Plus size={16} aria-hidden="true" /></button>
      <button id="sketch-undo" className="sketch-icon-button" type="button" title="Undo" aria-label="Undo"
        disabled={!writable || (!editor.canUndo && !invalidFields)} onClick={undo}>
        <Undo2 size={16} aria-hidden="true" /></button>
      <button id="sketch-redo" className="sketch-icon-button" type="button" title="Redo" aria-label="Redo"
        disabled={!writable || !editor.canRedo || invalidFields} onClick={redo}>
        <Redo2 size={16} aria-hidden="true" /></button>
      <button id="sketch-reload" className="sketch-icon-button" type="button"
        title={conflict ? "Discard local edits & load latest" : "Reload saved drawings"}
        aria-label={conflict ? "Discard local edits & load latest" : "Reload saved drawings"}
        disabled={action.busy || loadState.loading || Boolean(gesture) || hasActiveJobs(state) || !state.sketch}
        onClick={() => void reload()}><RefreshCw size={16} aria-hidden="true" /></button>
      <button id="sketch-generate" className="sketch-icon-button" type="button"
        title={document ? "Regenerate drawings" : "Generate drawings"} aria-label={document ? "Regenerate drawings" : "Generate drawings"}
        disabled={!writable || conflict || dirty} onClick={() => void submit("generate")}>
        <Sparkles size={16} aria-hidden="true" />
      </button>
      <button id="sketch-save" className="sketch-icon-button" type="button" title="Save drawings" aria-label="Save drawings"
        disabled={!writable || !document || !editor.dirty || conflict || invalidFields} onClick={() => void submit("save")}>
        <Save size={16} aria-hidden="true" />
      </button>
      <button id="sketch-approve" className="plan-button" type="button"
        disabled={!writable || emptyScreens || conflict || state.sketch.status === "stale" || invalidFields}
        onClick={() => void submit("approve")}><Check size={14} aria-hidden="true" /> Approve drawings and continue</button>
    </div>
    <p id="sketch-status" className="muted" role="status" aria-live="polite" hidden={!status}>{status}</p>
    <p id="sketch-empty" className="sketch-empty" hidden={Boolean(screen)}>No drawings yet. Generate a first draft or add a screen to begin.</p>
    <div id="sketch-workspace" className="sketch-workspace" hidden={!screen}>
      <aside className="sketch-sidebar" aria-label="Sketch screens and properties">
        <h3>Screens</h3>
        <nav id="sketch-screens" className="sketch-list" aria-label="Screens">
          {document?.screens.map((item) => <button key={item.id} type="button" disabled={Boolean(gesture)}
            data-ui-key={`sketch-screen:${item.id}`} aria-pressed={item.id === screen?.id}
            onClick={() => { setSelectedScreen(item.id); setSelectedShape(""); }}>{item.title || item.id}</button>)}
        </nav>
        <label htmlFor="sketch-title">Screen title</label>
        <input id="sketch-title" maxLength={500} disabled={!writable || !screen}
          value={fieldValue(screenFieldKey("title"), screen?.title)} aria-invalid={fieldInvalid(screenFieldKey("title"))}
          onChange={(event) => editScreen((item) => { item.title = event.target.value; }, { key: screenFieldKey("title"), value: event.target.value })} />
        {(["purpose", "notes"] as const).map((field) => <div key={field}>
          <label htmlFor={`sketch-${field}`}>{field === "purpose" ? "Purpose" : "Notes"}</label>
          <textarea id={`sketch-${field}`} rows={2} maxLength={field === "purpose" ? 500 : 4000}
            disabled={!writable || !screen} value={fieldValue(screenFieldKey(field), screen?.[field])}
            aria-invalid={fieldInvalid(screenFieldKey(field))}
            onChange={(event) => editScreen((item) => { item[field] = event.target.value; }, { key: screenFieldKey(field), value: event.target.value })} />
        </div>)}
        <label htmlFor="sketch-decisions">Requirement decision IDs</label>
        <input id="sketch-decisions" placeholder="Comma-separated IDs" disabled={!writable || !screen}
          value={fieldValue(screenFieldKey("decisions"), screen?.decisionIds.join(", "))}
          aria-invalid={fieldInvalid(screenFieldKey("decisions"))}
          onBlur={() => finishField(screenFieldKey("decisions"))}
          onChange={(event) => editScreen((item) => {
            item.decisionIds = event.target.value.split(",").map((id) => id.trim()).filter(Boolean);
          }, { key: screenFieldKey("decisions"), value: event.target.value, keepInput: true })} />
        <details><summary>Shapes (keyboard selection)</summary>
          <div id="sketch-shapes" className="sketch-list" aria-label="Shapes">
            {screen?.shapes.map((item) => <button key={item.id} type="button" disabled={Boolean(gesture)}
              data-ui-key={`sketch-shape:${item.id}`} aria-pressed={item.id === selectedShape}
              onClick={() => { setSelectedShape(item.id); setDrawing(false); }}>
              {item.kind === "path" ? curveLabels[item.curve ?? "linear"] : item.kind}{item.text ? ": " + item.text : " · " + item.id}
            </button>)}
          </div>
        </details>
      </aside>
      <div className="sketch-main" data-side-pane-open={sidePane !== ""}>
        <SketchViewport context={JSON.stringify([identityOf(state), screen?.id])} width={screen?.width ?? 960}
          height={screen?.height ?? 640} blocked={!screen || Boolean(gesture)} viewActions={
            <ToggleGroup.Root id="sketch-pane-selector" className="sketch-pane-controls" type="single"
              value={sidePane} aria-label="Sketch side pane" disabled={!screen || Boolean(gesture)}
              onValueChange={(value) => {
                if (value === "" || value === "properties" || value === "transitions" || value === "history") setSidePane(value);
              }}>
              {sidePanes.map(({ id, label, target, Icon }) => <ToggleGroup.Item key={id} id={`sketch-toggle-${id}`}
                className="sketch-icon-button" type="button" value={id}
                title={`${sidePane === id ? "Hide" : "Show"} ${label.toLowerCase()}`}
                aria-label={`${sidePane === id ? "Hide" : "Show"} ${label.toLowerCase()}`}
                aria-expanded={sidePane === id} aria-controls={target}>
                <Icon size={20} aria-hidden="true" />
              </ToggleGroup.Item>)}
            </ToggleGroup.Root>
          } sizeControl={
            <select id="sketch-size-preset" className="sketch-size-preset" aria-label="Canvas size" title="Canvas size"
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
            </select>
          } tools={
          <div id="sketch-tools" className="sketch-actions" role="group" aria-label="Drawing tools">
          {shapeTools.map(({ id, kind, curve, label, Icon }) => <button id={`sketch-add-${id}`} key={id} type="button"
            className="sketch-icon-button" title={label} aria-label={label}
            disabled={!writable || !screen || screen.shapes.length >= 100} onClick={() => {
              let created = "";
              if (editScreen((owner) => {
                const item = curve ? createCurveShape(owner, curve) : createShape(owner, kind);
                owner.shapes.push(item);
                created = item.id;
              })) { setSelectedShape(created); setDrawing(false); }
            }}><Icon size={20} aria-hidden="true" /></button>)}
          <Toggle.Root id="sketch-freehand" className="sketch-icon-button" type="button" pressed={drawing}
            title="Freehand" aria-label="Freehand"
            disabled={!writable || !screen || screen.shapes.length >= 100} onPressedChange={setDrawing}>
            <Pencil size={20} aria-hidden="true" />
          </Toggle.Root>
        </div>
        } help={boardHelp ? <p id="sketch-board-help" className="muted">{boardHelp}</p> : null}>
          <div ref={board} id="sketch-board" className={`sketch-board${drawing ? " sketch-drawing" : ""}`}
            tabIndex={0} role="group" aria-label={livePreview ? "Live preview screen drawing (read only)" : "Editable screen drawing"} aria-describedby={boardHelp ? "sketch-board-help" : undefined}
            onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp}
            onPointerCancel={(event) => { if (gestureRef.current?.id === event.pointerId) cancelGesture(); }}
            onLostPointerCapture={(event) => { if (gestureRef.current?.id === event.pointerId) cancelGesture(); }}>
            {preview && <SketchSvg screen={preview} selectedShape={selectedShape} editPoints={!drawing && (writable || Boolean(gesture))} />}
          </div>
        </SketchViewport>
        <aside id="sketch-object-properties" className="sketch-side-pane" aria-label="Object properties" hidden={!propertiesOpen}>
        <h3>Object properties</h3>
        <fieldset className="sketch-inspector">
          <legend id="sketch-shape-label">{shape ? `${shape.kind} · ${shape.id}` : "Select a shape to edit"}</legend>
          {(["x", "y", "width", "height"] as const).map((field) => <label key={field}>
            {field === "x" || field === "y" ? field.toUpperCase() : field[0].toUpperCase() + field.slice(1)}
            <input id={`sketch-${field}`} type="number" step="1"
              min={["width", "height"].includes(field) && shape && !["line", "arrow", "path"].includes(shape.kind) ? 1 : 0}
              disabled={!writable || !shape} value={fieldValue(shapeFieldKey(field), shapeView?.[field])}
              aria-invalid={fieldInvalid(shapeFieldKey(field))}
              onBlur={() => finishField(shapeFieldKey(field))}
              onChange={(event) => {
                const value = event.target.value;
                editShape((item, owner) => setShapeBounds(owner, item, { [field]: value.trim() ? Number(value) : NaN }),
                  { key: shapeFieldKey(field), value, keepInput: true });
              }} />
          </label>)}
          <label className="sketch-label-input">Text tool label
            <input id="sketch-text" maxLength={500} disabled={!writable || shape?.kind !== "text"}
              value={fieldValue(shapeFieldKey("text"), shape?.text)} aria-invalid={fieldInvalid(shapeFieldKey("text"))}
              onChange={(event) => editShape((item) => ({ ...item, text: event.target.value }), { key: shapeFieldKey("text"), value: event.target.value })} />
          </label>
          <label>Font size<input id="sketch-font-size" type="number" min={1} max={500}
            disabled={!writable || shape?.kind !== "text"} value={fieldValue(shapeFieldKey("fontSize"), shape?.fontSize)}
            aria-invalid={fieldInvalid(shapeFieldKey("fontSize"))}
            onBlur={() => finishField(shapeFieldKey("fontSize"))}
            onChange={(event) => editShape((item) => ({ ...item, fontSize: event.target.value.trim() ? Number(event.target.value) : NaN }),
              { key: shapeFieldKey("fontSize"), value: event.target.value, keepInput: true })} /></label>
          {(["fill", "stroke"] as const).map((field) => <label key={field}>{field === "fill" ? "Fill" : "Stroke"}
            <select id={`sketch-${field}`} disabled={!writable || !shape} value={shape?.[field] ?? ""}
              onChange={(event) => editShape((item) => ({ ...item, [field]: event.target.value }))}>
              {!shape && <option value="">Select a shape</option>}
              {shape && !colorChoices.some(([value]) => value === shape[field]) && <option value={shape[field]}>{shape[field]}</option>}
              {colorChoices.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>)}
          <button id="sketch-delete-shape" type="button" disabled={!writable || !shape} onClick={deleteShape}>
            <Trash2 size={14} aria-hidden="true" /> Delete shape</button>
        </fieldset>
        {shape?.kind === "path" && <fieldset className="sketch-inspector sketch-path-inspector">
          <legend>{curveLabels[shape.curve ?? "linear"]} path</legend>
          <label>Closed path
            <select id="sketch-path-closed" disabled={!writable} value={String(shape.closed ?? false)}
              onChange={(event) => editShape((item) => ({ ...item, closed: event.target.value === "true" }))}>
              <option value="false">Open</option><option value="true">Closed</option>
            </select>
          </label>
          {shape.curve === "catmull-rom" && <label>Spline tension (0-1)
            <input id="sketch-path-tension" type="number" min={0} max={1} step={0.05} disabled={!writable}
              value={fieldValue(shapeFieldKey("tension"), shape.tension ?? 0)} aria-invalid={fieldInvalid(shapeFieldKey("tension"))}
              onBlur={() => finishField(shapeFieldKey("tension"))}
              onChange={(event) => editShape((item) => ({ ...item, tension: event.target.value.trim() ? Number(event.target.value) : NaN }),
                { key: shapeFieldKey("tension"), value: event.target.value, keepInput: true })} />
          </label>}
          <label className="sketch-path-points">Points (one x, y pair per line)
            <textarea id="sketch-path-points" rows={5} disabled={!writable} aria-describedby="sketch-path-help"
              value={fieldValue(shapeFieldKey("points"), shape.points.map((point) => `${point.x}, ${point.y}`).join("\n"))}
              aria-invalid={fieldInvalid(shapeFieldKey("points"))}
              onBlur={() => finishField(shapeFieldKey("points"))}
              onChange={(event) => editShape((item) => setPathPoints(item, parsePathPoints(event.target.value)),
                { key: shapeFieldKey("points"), value: event.target.value, keepInput: true })} />
          </label>
          <p id="sketch-path-help" className="muted">
            {shape.curve === "quadratic" ? "Start point, then control/end pairs. Append complete pairs to add segments."
              : shape.curve === "cubic" ? "Start point, then control/control/end triples. Append complete triples to add segments."
              : shape.curve === "catmull-rom" ? "Knots only; the spline passes through each one. Closed splines wrap smoothly without repeating the first knot. Tension 0 is smooth; 1 gives straight segments."
              : "Points are joined by straight segments."}
            {" "}Drag knots or control points on the board, or edit their coordinates here. Paths allow 2-512 points.
          </p>
        </fieldset>}
        </aside>
        <aside id="sketch-screen-transitions" className="sketch-side-pane" aria-label="Screen transitions" hidden={sidePane !== "transitions"}>
      <h3>Screen transitions</h3>
      <div id="sketch-transitions">
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
            return <label key={field}>{({ fromScreenId: "From", toScreenId: "To", trigger: "Trigger", description: "Description" } satisfies Record<Exclude<keyof SketchTransition, "id">, string>)[field]}
              {field === "fromScreenId" || field === "toScreenId"
                ? <select {...props}>{document.screens.map((item) => <option key={item.id} value={item.id}>{item.title || item.id}</option>)}</select>
                : <input {...props} maxLength={500} />}
            </label>;
          })}
          <button type="button" disabled={!writable} onClick={() => {
            if (edit((draft) => { draft.transitions = draft.transitions.filter((item) => item.id !== transition.id); })) {
              updateDrafts(Object.fromEntries(Object.entries(draftsRef.current).filter(([key]) => !key.startsWith(`transition:${transition.id}:`))));
            }
          }}><Trash2 size={14} aria-hidden="true" /> Remove transition</button>
        </div>)}
      </div>
      <button id="sketch-add-transition" type="button" disabled={!writable || !screen || (document?.transitions.length ?? 0) >= 40}
        onClick={() => edit((draft) => {
          draft.transitions.push({
            id: nextId("transition", draft.transitions.map((item) => item.id)),
            fromScreenId: screen!.id, toScreenId: draft.screens.find((item) => item.id !== screen!.id)?.id ?? screen!.id,
            trigger: "Continue", description: "",
          });
        })}><Plus size={14} aria-hidden="true" /> Add transition</button>
        </aside>
        <aside id="sketch-revision-history" className="sketch-side-pane" aria-label="Revision history" hidden={sidePane !== "history"}>
          <h3>Revision history</h3>
          <ul id="sketch-history" className="muted">{revisions.map((revision) => <li key={revision.id}>
            {`Revision ${revision.number} · ${revision.source} · ${revision.createdAt}`}
            {revision.id === state.sketch.approved?.revisionId ? " · approved" : ""}
            {revision.id === state.sketch.current?.id ? " · current" : ""}
          </li>)}</ul>
        </aside>
      </div>
    </div>
    <div className="sketch-input-pane">
    <section id="sketch-request-history-pane" className="sketch-request-history-pane"
      aria-label="Drawing request history" hidden={!historyOpen}>
      <div className="sketch-history-heading">
        <h3>Request history</h3>
        <button type="button" aria-label="Close request history" onClick={() => setHistoryOpen(false)}>
          <X size={14} aria-hidden="true" />
        </button>
      </div>
      <p id="sketch-message" className="sketch-error" role="alert" hidden={!message}>{message}</p>
      <section id="sketch-failed-revision" className="sketch-details" aria-label="Failed drawing revision" hidden={!retryInstruction}>
        <p id="sketch-failed-instruction" className="muted">{retryInstruction ? "Failed revision instruction: " + retryInstruction : ""}</p>
        <button id="sketch-retry-revision" type="button"
          disabled={!writable || !document || conflict || !retryInstruction || invalidFields} onClick={() => void submit("revise", retryInstruction)}>
          <RefreshCw size={14} aria-hidden="true" /> Retry same revision</button>
        <p className="muted">Retries the original instruction against these drawings. Local edits are saved first; any new instruction below is kept.</p>
      </section>
      <ol id="sketch-request-history" className="sketch-request-history">
        {requestHistory.map((item) => <li key={item.id} data-status={item.status}>
          <div><strong>{item.kind === "revise" ? "Revision" : item.kind[0].toUpperCase() + item.kind.slice(1)}</strong>
            <span>{new Date(item.at).toLocaleTimeString()}</span></div>
          <p><b>Request:</b> {item.request}</p>
          <p><b>Response:</b> {item.response}</p>
        </li>)}
      </ol>
      <p className="muted" hidden={Boolean(requestHistory.length || message || retryInstruction)}>
        Send a drawing revision to see its request and response history here.
      </p>
    </section>
    <Popover.Root open={voiceSettingsOpen} onOpenChange={setVoiceSettingsOpen}>
    <form id="sketch-revise-form" className="sketch-revise-form sketch-composer" onSubmit={(event) => { event.preventDefault(); void submit("revise"); }}>
      <label className="visually-hidden" htmlFor="sketch-instruction">Describe a drawing change</label>
      {voiceProvider === "azure-speech"
        ? <SpeechTextarea ref={instructionInput} id="sketch-instruction" rows={1} maxLength={4000} disabled={!writable}
          value={instruction} onValueChange={setInstruction} onKeyDown={sendShortcut} composer={composer}
          placeholder="Describe a drawing change... (Ctrl+Enter)" />
        : <SketchLivePanel identity={identityOf(state)} input={instructionInput} createSession={createLiveSession}
            enabled={canEdit("sketch") && state.provider?.canSubmitAnswers !== false && !state.effortReset
              && !skipped && !conflict && !invalidFields}
            canStart={writable && Boolean(document)}
            context={sketchLiveContext(state, editor.document, selectedScreen, selectedShape)} revise={reviseByVoice}
            composer={{ ...composer, input: (caption) => <textarea ref={instructionInput} id="sketch-instruction"
              rows={caption === null ? 1 : 2} maxLength={caption === null ? 4000 : undefined}
              disabled={caption === null && !writable} readOnly={caption !== null} data-voice-caption={caption !== null}
              aria-label={caption === null ? undefined : "Voice transcript: you and GPT-live"}
              aria-describedby="sketch-live-status"
              value={caption ?? instruction} onChange={(event) => { if (caption === null) setInstruction(event.target.value); }}
              onKeyDown={sendShortcut}
              placeholder="Describe a drawing change... (Ctrl+Enter)" /> }} />}
      <Popover.Portal>
        <Popover.Content id="sketch-voice-settings" className="voice-settings-popover" side="top" align="start"
          sideOffset={8} collisionPadding={12} aria-labelledby="sketch-voice-settings-title">
          <div className="voice-settings-heading">
            <h3 id="sketch-voice-settings-title">Voice settings</h3>
            <Popover.Close asChild><button type="button" aria-label="Close voice settings"><X size={16} aria-hidden="true" /></button></Popover.Close>
          </div>
          <label htmlFor="sketch-voice-provider">Voice provider</label>
          <select id="sketch-voice-provider" value={voiceProvider} disabled={Boolean(speech.active)} onChange={(event) => {
            if (event.target.value === "azure-speech" || event.target.value === "gpt-live") setVoiceProvider(event.target.value);
          }}>
            <option value="azure-speech">Azure dictation</option>
            <option value="gpt-live">GPT-live conversation</option>
          </select>
          <p role="status" aria-live="polite">{speech.active?.kind === "capture" ? "Voice session in progress" : "Microphone off"}</p>
          <p className="muted">{voiceProvider === "azure-speech"
            ? "Use Sign in in the top bar for Azure Speech. Audio goes to Azure; dictation does not send your message. Language and Azure resources use the existing host configuration."
            : "GPT-live uses Azure CLI sign-in and sends audio and sketch context to Azure. Spoken drawing requests can create revisions; approval stays manual."}</p>
        </Popover.Content>
      </Popover.Portal>
    </form>
    </Popover.Root>
    </div>
  </section>;
}
