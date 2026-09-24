import { createContext, useContext, useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import type { LifecycleStageId, TandemState } from "../types.js";
import type { SketchPreview } from "../sketch-stream.js";

export interface RuntimeAgent {
  id?: string;
  label?: string;
  status?: string;
  model?: string;
  activity?: string;
  activeMs?: number;
}

export interface RuntimeSnapshot {
  runId?: string;
  status?: string;
  error?: string;
  liveAgentCount?: number;
  agents?: RuntimeAgent[];
  progress?: { seq: number; text: string; recordedAt: number }[];
}

export interface UiState extends TandemState {
  provider?: {
    canSubmitAnswers?: boolean;
    canReload?: boolean;
    extensionId?: string;
    source?: string;
    reloadMessage?: string;
  };
  preparationRuntime?: RuntimeSnapshot | null;
  implementationRuntime?: RuntimeSnapshot | null;
  testRuntime?: RuntimeSnapshot | null;
  sketchPreview?: SketchPreview | null;
}

export interface UiContextValue {
  state: UiState;
  pending: boolean;
  post: <T = UiState>(endpoint: string, body: unknown, timeoutMs?: number) => Promise<T>;
  refresh: () => Promise<void>;
  canEdit: (stage: LifecycleStageId, allowCompleted?: boolean) => boolean;
  guidance: (action: string) => string;
  confirm: (message: string, title?: string) => Promise<boolean>;
  browseStage: (stage: LifecycleStageId) => void;
  selectArtifact: (id: string) => void;
  setBusy: (key: string, busy: boolean) => void;
}

export const UiContext = createContext<UiContextValue | null>(null);

export function useUi(): UiContextValue {
  const context = useContext(UiContext);
  if (!context) throw new Error("Tandem UI components require a UiContext provider.");
  return context;
}

function statusHelp(target: Element | null): string {
  if (!target?.isConnected || target.closest("[hidden], [inert], #next-action-bar")) return "";
  for (let element: Element | null = target; element && element !== document.body; element = element.parentElement) {
    const description = (element.getAttribute("aria-describedby") || "").split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent?.trim()).filter(Boolean).join(" ");
    const text = element.getAttribute("data-status-help") || description
      || element.getAttribute("aria-description") || element.getAttribute("title");
    if (text?.trim()) return text.trim().replace(/\s+/g, " ");
  }
  return "";
}

export function useStatusHelp(view: string): string {
  const [help, setHelp] = useState("");
  const hovered = useRef<Element | null>(null);
  const focused = useRef<Element | null>(null);
  useEffect(() => {
    const update = () => setHelp(statusHelp(hovered.current) || statusHelp(focused.current));
    const element = (target: EventTarget | null) => target instanceof Element ? target : null;
    const over = (event: PointerEvent) => { hovered.current = element(event.target); update(); };
    const out = (event: PointerEvent) => { hovered.current = element(event.relatedTarget); update(); };
    const focus = (event: FocusEvent) => { focused.current = element(event.target); hovered.current = null; update(); };
    const blur = (event: FocusEvent) => { focused.current = element(event.relatedTarget); update(); };
    const leave = () => { hovered.current = null; focused.current = null; update(); };
    document.addEventListener("pointerover", over, true);
    document.addEventListener("pointerout", out, true);
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", blur);
    window.addEventListener("blur", leave);
    return () => {
      document.removeEventListener("pointerover", over, true);
      document.removeEventListener("pointerout", out, true);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("focusout", blur);
      window.removeEventListener("blur", leave);
    };
  }, []);
  useEffect(() => {
    hovered.current = null;
    focused.current = document.activeElement;
    setHelp(statusHelp(focused.current));
  }, [view]);
  return help;
}

export function hasActiveJobs(state: UiState): boolean {
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
      || (review?.threads || []).some((thread: { status: string }) => ["queued", "processing"].includes(thread.status)));
}

export function skippedStage(state: UiState, stage: LifecycleStageId) {
  return (state.lifecycle.skippedStages || []).find((entry) => entry.stageId === stage)
    || (["sketch", "prototype"].includes(stage) && state.prototypeApproach?.mode === "not-applicable"
      ? { stageId: stage, reason: state.prototypeApproach.reason || "No graphical interface needs sketch or prototype validation." }
      : null);
}

export function hasStageData(state: UiState, stage: LifecycleStageId): boolean {
  return state.lifecycle.currentStage === stage
    || (state.lifecycle.completedStages || []).includes(stage)
    || (state.lifecycle.history || []).some((entry) => entry.stageId === stage)
    || (state.artifacts || []).some((artifact) => artifact.stage === stage)
    || (stage === "sketch" && Boolean(state.sketch?.current))
    || (stage === "plan" && (state.planning?.workItems || []).length > 0)
    || (stage === "implement" && (state.implementation?.workItems || []).length > 0)
    || (stage === "test" && (state.testing?.scenarios || []).length > 0);
}

export function useAction(key: string) {
  const { setBusy } = useUi();
  const running = useRef(false);
  const [busy, setLocalBusy] = useState(false);
  const [error, setError] = useState("");
  async function run<T>(action: () => Promise<T>): Promise<T | undefined> {
    if (running.current) return undefined;
    running.current = true;
    setLocalBusy(true);
    setBusy(key, true);
    setError("");
    try {
      return await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The request failed.");
      return undefined;
    } finally {
      running.current = false;
      setLocalBusy(false);
      setBusy(key, false);
    }
  }
  return { busy, error, setError, run };
}

interface DraftStore {
  values: Map<string, unknown>;
}
const DraftContext = createContext<DraftStore | null>(null);

export function DraftProvider({ children }: { children: ReactNode }) {
  const [store] = useState<DraftStore>(() => ({ values: new Map() }));
  return <DraftContext.Provider value={store}>{children}</DraftContext.Provider>;
}

export function useDraft<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const store = useContext(DraftContext);
  if (!store) throw new Error("Drafts require a DraftProvider.");
  const [, rerender] = useState(0);
  const value = store.values.has(key) ? store.values.get(key) as T : initial;
  const setValue: Dispatch<SetStateAction<T>> = (next) => {
    const previous = store.values.has(key) ? store.values.get(key) as T : initial;
    store.values.set(key, typeof next === "function" ? (next as (value: T) => T)(previous) : next);
    rerender((revision) => revision + 1);
  };
  return [value, setValue];
}
