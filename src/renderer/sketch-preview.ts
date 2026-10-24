import { hasScreenContent, validateSketchDocument } from "../sketch.js";
import type { SketchPreview, SketchScreenStatus } from "../sketch-stream.js";
import type { UiState } from "./ui-context.js";

const identityFields = ["prototypeId", "generation", "requestId", "runId", "baseRevisionId", "requirementsDigest"] as const;
const previewFields = [...identityFields, "sequence", "document"];
const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 512;

function activeIdentity(state: UiState) {
  const processing = state.processing;
  const request = processing?.sketchRequest;
  if (state.lifecycle.currentStage !== "sketch" || state.effortReset
    || !["generate-sketch", "revise-sketch"].includes(processing?.action)
    || !["starting", "running"].includes(processing?.status)
    || !nonempty(state.prototypeId) || !nonempty(state.generation)
    || !nonempty(processing.requestId) || !nonempty(processing.runId)
    || request?.generation !== state.generation || !nonempty(request?.requirementsDigest)
    || (request.baseRevisionId !== null && !nonempty(request.baseRevisionId))
    || request.baseRevisionId !== (state.sketch?.current?.id ?? null)) return null;
  return {
    prototypeId: state.prototypeId, generation: state.generation,
    requestId: processing.requestId as string, runId: processing.runId as string,
    baseRevisionId: request.baseRevisionId as string | null, requirementsDigest: request.requirementsDigest as string,
  };
}

export function sketchPreviewIdentity(state: UiState): string | null {
  const identity = activeIdentity(state);
  return identity ? JSON.stringify(identity) : null;
}

export function readSketchPreview(state: UiState, value: unknown, afterSequence = -1): SketchPreview | null {
  const identity = activeIdentity(state);
  if (!identity || value === null || value === undefined) return null;
  const invalid = () => { throw new Error("The live sketch preview is invalid. Saved designs are unchanged; reload or retry the design request."); };
  if (typeof value !== "object" || Array.isArray(value)) return invalid();
  const candidate = value as Record<string, unknown>;
  // Obsolete requests are not errors, even if their unfinished payload is malformed.
  if (identityFields.some((field) => Object.hasOwn(candidate, field)
    && (typeof candidate[field] === "string" || candidate[field] === null)
    && candidate[field] !== identity[field])) return null;
  if (Number.isSafeInteger(candidate.sequence) && Number(candidate.sequence) >= 0
    && Number(candidate.sequence) <= afterSequence) return null;
  const prototype = Object.getPrototypeOf(candidate);
  if ((prototype !== null && Object.getPrototypeOf(prototype) !== null)
    || Object.keys(candidate).some(field => !previewFields.includes(field) && field !== "screenStatuses")
    || previewFields.some((field) => !Object.hasOwn(candidate, field))
    || identityFields.some((field) => candidate[field] !== identity[field])
    || !Number.isSafeInteger(candidate.sequence) || Number(candidate.sequence) < 0) return invalid();
  try {
    const decisionIds = (state.decisionGraph?.nodes ?? [])
      .filter((node) => node.status === "answered" && typeof node.answer === "string" && node.answer.trim())
      .map((node) => node.id);
    const document = validateSketchDocument(candidate.document, decisionIds);
    if (document.version !== 2) return invalid();
    let screenStatuses: Record<string, SketchScreenStatus> | undefined;
    if (Object.hasOwn(candidate, "screenStatuses")) {
      const statuses = candidate.screenStatuses;
      if (!statuses || typeof statuses !== "object" || Array.isArray(statuses)
        || Object.keys(statuses).length !== document.screens.length) return invalid();
      screenStatuses = {};
      for (const screen of document.screens) {
        if (!Object.hasOwn(statuses, screen.id)) return invalid();
        const status: unknown = Reflect.get(statuses, screen.id);
        if (status !== "waiting" && status !== "processing" && status !== "ready") return invalid();
        if (status === "ready" && !hasScreenContent(screen)) return invalid();
        screenStatuses[screen.id] = status;
      }
    }
    return { ...identity, sequence: Number(candidate.sequence), document, ...(screenStatuses ? { screenStatuses } : {}) };
  } catch {
    return invalid();
  }
}

export class SketchPreviewTracker {
  private identity: string | null = null;
  private sequence = -1;
  private cleared = false;
  private result: { preview: SketchPreview | null; error: string } = { preview: null, error: "" };

  accept(state: UiState, value: unknown) {
    const identity = sketchPreviewIdentity(state);
    if (identity !== this.identity) {
      this.identity = identity;
      this.sequence = -1;
      this.cleared = false;
      this.result = { preview: null, error: "" };
    }
    if (!identity || value === undefined) return this.result;
    if (value === null) {
      // Startup nulls precede preview updates; a null after activity closes this request's preview.
      this.cleared ||= this.sequence >= 0 || Boolean(this.result.error);
      this.result = { preview: null, error: "" };
      return this.result;
    }
    if (this.cleared) return this.result;
    try {
      const preview = readSketchPreview(state, value, this.sequence);
      if (preview) {
        this.sequence = preview.sequence;
        this.result = { preview, error: "" };
      }
    } catch (cause) {
      this.result = { preview: null, error: (cause as Error).message };
    }
    return this.result;
  }
}
