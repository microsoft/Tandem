import { lifecycleStages } from "../workflow.js";
import type { UiState } from "./ui-context.js";
import { SketchPreviewTracker, sketchPreviewIdentity } from "./sketch-preview.js";
import { workflowBinding } from "../workflow-activity.js";

export interface StudioSnapshot {
  state: UiState | null;
  connectionError: string;
}

export function isStateSnapshot(value: unknown): value is UiState {
  if (!value || typeof value !== "object" || !("prototypeId" in value) || typeof value.prototypeId !== "string"
    || !("lifecycle" in value) || !value.lifecycle || typeof value.lifecycle !== "object"
    || !("currentStage" in value.lifecycle)) return false;
  const currentStage = value.lifecycle.currentStage;
  return lifecycleStages.some((stage) => stage.id === currentStage)
    && (!("revision" in value) || (Number.isSafeInteger(value.revision) && Number(value.revision) >= 0));
}

export class StudioStore {
  private snapshot: StudioSnapshot = { state: null, connectionError: "" };
  private listeners = new Set<() => void>();
  private sequence = 0;
  private lastTransportSequence = 0;
  private sketchPreview = new SketchPreviewTracker();
  private request: Promise<void> | null = null;
  private requestSequence = 0;
  private disposed = false;

  constructor(private readonly fetcher: typeof fetch = (input, init) => fetch(input, init)) {}

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private publish(snapshot: StudioSnapshot) {
    if (this.disposed) return;
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }

  setConnectionError = (message: string) => {
    if (message !== this.snapshot.connectionError) this.publish({ ...this.snapshot, connectionError: message });
  };

  accept = (state: unknown, sequence = ++this.sequence): boolean => {
    if (!isStateSnapshot(state)) throw new Error("The studio returned an invalid state.");
    const previous = this.snapshot.state;
    const revision = state.revision ?? 0;
    const previousRevision = previous?.revision ?? 0;
    if (previous && (state.prototypeId !== previous.prototypeId || revision < previousRevision
      || (revision === 0 && previousRevision === 0 && Date.parse(state.updatedAt) < Date.parse(previous.updatedAt)))) return false;
    const changed = !previous || revision > previousRevision
      || (revision === 0 && state.updatedAt !== previous.updatedAt);
    const next = changed ? { ...state, revision } : { ...previous };
    for (const field of ["provider", "preparationRuntime", "workflowRuntime", "developmentBlocker"] as const) {
      if (sequence >= this.lastTransportSequence && Object.hasOwn(state, field)) {
        // Each transport-only field retains its own declared type.
        Object.assign(next, { [field]: state[field] });
      } else if (previous && Object.hasOwn(previous, field)
        && (field === "provider" || next.generation === previous.generation)) {
        Object.assign(next, { [field]: previous[field] });
      }
    }
    const preview = this.sketchPreview.accept(next as UiState,
      sequence >= this.lastTransportSequence && sketchPreviewIdentity(state) === sketchPreviewIdentity(next as UiState)
        ? state.sketchPreview : undefined);
    next.sketchPreview = preview.preview;
    this.lastTransportSequence = Math.max(this.lastTransportSequence, sequence);
    const transportChanged = !previous || ["provider", "preparationRuntime", "workflowRuntime", "developmentBlocker", "sketchPreview"].some(
      (field) => JSON.stringify(Reflect.get(next, field)) !== JSON.stringify(Reflect.get(previous, field)));
    if (changed || transportChanged) this.publish({ state: next as UiState, connectionError: preview.error });
    else this.setConnectionError(preview.error);
    return changed || transportChanged;
  };

  refresh = (afterSequence = 0): Promise<void> => {
    if (this.request) {
      return this.requestSequence <= afterSequence
        ? this.request.catch(() => undefined).then(() => this.refresh(afterSequence))
        : this.request;
    }
    const sequence = ++this.sequence;
    this.requestSequence = sequence;
    const stage = this.snapshot.state?.lifecycle.currentStage;
    const endpoint = stage === "prepare" ? "/api/preparation/status"
      : stage !== "development" && this.snapshot.state && workflowBinding(this.snapshot.state) ? "/api/workflow/status" : "/api/state";
    this.request = this.fetcher(endpoint, { cache: "no-store", signal: AbortSignal.timeout(15000) })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load studio state.");
        this.accept(await response.json(), sequence);
      })
      .catch((error: unknown) => {
        this.setConnectionError("Connection interrupted. Retrying...");
        throw error;
      })
      .finally(() => { this.request = null; });
    return this.request;
  };

  post = async <T = UiState>(endpoint: string, body: unknown, timeoutMs = 60000): Promise<T> => {
    const sequence = ++this.sequence;
    const identity = this.snapshot.state;
    const response = await this.fetcher(endpoint, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
    });
    const result: unknown = await response.json();
    if (!response.ok) {
      const message = result && typeof result === "object" && "error" in result && typeof result.error === "string"
        ? result.error : "The request failed.";
      throw new Error(message);
    }
    if (endpoint !== "/api/effort/reset" && identity && this.snapshot.state?.generation !== identity.generation) {
      throw new Error("The effort changed while the request was in flight. Review the current state before retrying.");
    }
    if (isStateSnapshot(result)) this.accept(result, sequence);
    else await this.refresh(sequence);
    return result as T;
  };

  connect() {
    this.disposed = false;
    void this.refresh().catch(() => { this.setConnectionError("Could not load the studio state. Retrying..."); });
    const timer = window.setInterval(() => { void this.refresh().catch(() => undefined); }, 2000);
    const events = new EventSource("/events");
    events.onmessage = (event) => {
      try { this.accept(JSON.parse(event.data)); }
      catch { this.setConnectionError("Could not read the studio update. Retrying..."); }
    };
    events.onerror = () => { this.setConnectionError("Reconnecting to the studio..."); };
    return () => {
      this.disposed = true;
      window.clearInterval(timer);
      events.close();
    };
  }
}
