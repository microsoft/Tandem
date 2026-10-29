import { DSLError, ensure } from "./document.js";
import { getContext, PROMPT_PREFIX } from "./context.js";
import { OPERATION_SCHEMA } from "./catalog.js";
import { abortable, applyStream } from "./stream.js";

export function localCommand(prompt) {
  const text = prompt.trim().toLowerCase().replace(/[.!]$/, "");
  const commands = {
    undo: "undo", redo: "redo", "delete selected": "delete",
    "remove selected": "delete", "duplicate selected": "duplicate",
  };
  return Object.hasOwn(commands, text) ? commands[text] : null;
}

export function routeIntent(prompt) {
  const local = localCommand(prompt);
  if (local) return { kind: "local", command: local, modelHint: null };
  if (/\b(new|create|build|design)\b.*\b(screen|page|dashboard|form)\b/i.test(prompt)) {
    return { kind: "screen", modelHint: "capable" };
  }
  if (/\b(add|remove|move|reorder|section|layout|grid|columns)\b/i.test(prompt)) {
    return { kind: "structure", modelHint: "capable" };
  }
  return { kind: "edit", modelHint: "fast" };
}

export function applyLocalCommand(store, command, selectedId, options = {}) {
  if (command === "undo") return store.undo(options);
  if (command === "redo") return store.redo(options);
  ensure(selectedId, "selection_required", "Select a component first.");
  if (command === "delete" || command === "duplicate") return store.editSelection(command, selectedId, options);
  throw new DSLError("unknown_command", "Unknown local command.");
}

export function createAgentController({ store, adapter, onStatus = () => {} }) {
  let running = false;
  let sequence = 0;
  return {
    async send(prompt, { selectedId = store.getSnapshot().root, signal, timeoutMs = 30000 } = {}) {
      ensure(typeof prompt === "string" && prompt.trim().length > 0 && prompt.length <= 8000,
        "invalid_prompt", "Enter a request of 1-8,000 characters.");
      ensure(!running, "agent_busy", "Wait for the current edit or cancel it first.");
      ensure(Number.isInteger(timeoutMs) && timeoutMs >= 10 && timeoutMs <= 120000,
        "invalid_timeout", "timeoutMs must be between 10 and 120,000.");
      running = true;
      const started = performance.now();
      const controller = new AbortController();
      const effectiveSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
      const timer = setTimeout(() => controller.abort(new DSLError("deadline", "The model deadline was reached.")), timeoutMs);
      const route = routeIntent(prompt);
      const editId = `edit-${Date.now()}-${++sequence}`;
      try {
        onStatus({ type: "acknowledged", elapsedMs: performance.now() - started, route });
        effectiveSignal.throwIfAborted();
        if (route.kind === "local") {
          const result = applyLocalCommand(store, route.command, selectedId, { requestId: editId });
          onStatus({ type: "complete", result });
          return result;
        }
        ensure(typeof adapter?.stream === "function", "model_unavailable", "Connect a model adapter to process this request.");
        const request = {
          system: PROMPT_PREFIX, request: prompt, context: getContext(store.getSnapshot(), { selectedId }),
          schema: OPERATION_SCHEMA, route, signal: effectiveSignal,
        };
        onStatus({ type: "waiting", route });
        const chunks = await abortable(adapter.stream(request), effectiveSignal);
        const report = await applyStream(chunks, {
          store, expectedRevision: request.context.revision, requestId: editId, editId,
          signal: effectiveSignal, startedAt: started,
          repair: typeof adapter.repair === "function" ? failure => adapter.repair({ ...request, ...failure }) : undefined,
          onEvent: event => onStatus(event),
        });
        onStatus({ type: report.rejected ? "partial" : "complete", report });
        return report;
      } catch (error) {
        onStatus({ type: effectiveSignal.aborted ? "cancelled" : "error", error: { code: error.code ?? error.name, message: error.message } });
        throw error;
      } finally {
        clearTimeout(timer);
        running = false;
      }
    },
  };
}
