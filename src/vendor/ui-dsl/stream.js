import { DSLError, LIMITS, ensure } from "./document.js";

const repairable = new Set([
  "invalid_object", "unsafe_key", "unknown_field", "missing_field", "invalid_value",
  "invalid_id", "unknown_component", "invalid_prop", "unknown_prop", "missing_prop", "unknown_icon",
  "unknown_token", "invalid_token", "unknown_operation", "empty_update", "duplicate_id",
  "leaf_parent", "invalid_anchor", "cycle", "root_edit", "missing_node", "depth_limit",
  "node_limit", "document_limit", "batch_limit",
]);

export class NDJSONDecoder {
  #buffer = "";
  #line = 0;
  #discarding = false;
  #first = true;
  #ended = false;
  #decoder = new TextDecoder("utf-8", { fatal: true });

  #parse(raw) {
    this.#line += 1;
    const line = raw.replace(/\r?\n$/, "").replace(/\r$/, "");
    if (line.length > LIMITS.line) return [this.#tooLong(this.#line)];
    const text = raw.trim();
    if (!text || /^```(?:json|jsonl|ndjson)?$/i.test(text)) return [];
    try {
      return [{ line: this.#line, raw: text, operation: JSON.parse(text) }];
    } catch {
      return [{ line: this.#line, raw: text, error: new DSLError("invalid_json", "Expected one complete JSON operation on this line.") }];
    }
  }
  #tooLong(line) {
    return { line, raw: "", error: new DSLError("line_limit", `A line may contain at most ${LIMITS.line} characters.`) };
  }
  #consume(text, final) {
    if (this.#first && text.length) {
      text = text.replace(/^\uFEFF/, "");
      this.#first = false;
    }
    const events = [];
    for (const part of text.split(/(?<=\n)/)) {
      if (this.#discarding) {
        if (part.endsWith("\n")) {
          this.#line += 1;
          this.#discarding = false;
        }
        continue;
      }
      this.#buffer += part;
      if (part.endsWith("\n")) {
        events.push(...this.#parse(this.#buffer));
        this.#buffer = "";
      } else if (this.#buffer.length > LIMITS.line + (this.#buffer.endsWith("\r") ? 1 : 0)) {
        events.push(this.#tooLong(this.#line + 1));
        this.#buffer = "";
        this.#discarding = true;
      }
    }
    if (final && this.#buffer) {
      events.push(...this.#parse(this.#buffer));
      this.#buffer = "";
    }
    return events;
  }
  push(chunk) {
    ensure(!this.#ended, "stream_closed", "The decoder has already finished.");
    ensure(typeof chunk === "string" || chunk instanceof Uint8Array,
      "invalid_chunk", "Stream chunks must be text or UTF-8 bytes.");
    try {
      const text = typeof chunk === "string" ? this.#decoder.decode() + chunk : this.#decoder.decode(chunk, { stream: true });
      return this.#consume(text, false);
    } catch (error) {
      if (error instanceof DSLError) throw error;
      throw new DSLError("invalid_encoding", "The operation stream is not valid UTF-8.");
    }
  }
  finish() {
    ensure(!this.#ended, "stream_closed", "The decoder has already finished.");
    this.#ended = true;
    try {
      return this.#consume(this.#decoder.decode(), true);
    } catch (error) {
      if (error instanceof DSLError) throw error;
      throw new DSLError("invalid_encoding", "The operation stream ended inside a UTF-8 character.");
    }
  }
}

export function abortable(promise, signal) {
  if (!signal) return Promise.resolve(promise);
  if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

export async function applyStream(chunks, {
  store, expectedRevision = store.getSnapshot().revision, requestId, editId,
  label = "Streamed edit", signal, repair, onEvent = () => {}, startedAt = performance.now(),
} = {}) {
  ensure(chunks && (chunks[Symbol.asyncIterator] || chunks[Symbol.iterator]),
    "invalid_stream", "The adapter must return an iterable of NDJSON chunks.");
  const iterator = chunks[Symbol.asyncIterator]?.() ?? chunks[Symbol.iterator]();
  const decoder = new NDJSONDecoder();
  ensure(requestId === undefined || (typeof requestId === "string" && requestId.length <= 120),
    "invalid_request_id", "Stream request IDs may contain at most 120 characters.");
  const started = startedAt;
  const report = { attempted: 0, applied: 0, repaired: 0, rejected: 0, errors: [], firstOperationMs: null };
  let revision = expectedRevision;
  let exhausted = false;
  const processEvent = async event => {
    signal?.throwIfAborted();
    report.attempted += 1;
    ensure(report.attempted <= LIMITS.stream, "stream_limit", `A stream may contain at most ${LIMITS.stream} operations.`);
    let operation = event.operation;
    let failure = event.error;
    const apply = async () => {
      const result = await store.apply(operation, {
        expectedRevision: revision,
        requestId: requestId ? `${requestId}:${event.line}` : undefined,
        editId, label,
      });
      revision = result.revision;
      report.applied += 1;
      report.firstOperationMs ??= performance.now() - started;
      await onEvent({ type: "applied", line: event.line, operation, result });
    };
    if (!failure) {
      try { await apply(); }
      catch (error) {
        if (!(error instanceof DSLError) || !repairable.has(error.code)) throw error;
        failure = error;
      }
    }
    if (!failure) return;
    await onEvent({ type: "invalid", line: event.line, error: failure.toJSON() });
    if (repair) {
      try {
        operation = await abortable(repair({
          operation, raw: event.raw, error: failure.toJSON(), line: event.line, revision, signal,
        }), signal);
        signal?.throwIfAborted();
        if (operation !== null && operation !== undefined) {
          await apply();
          report.repaired += 1;
          return;
        }
      } catch (error) {
        if (!(error instanceof DSLError) || !repairable.has(error.code)) throw error;
        failure = error;
      }
    }
    report.rejected += 1;
    report.errors.push({ line: event.line, error: failure.toJSON() });
    await onEvent({ type: "rejected", line: event.line, error: failure.toJSON() });
  };
  try {
    while (true) {
      signal?.throwIfAborted();
      const item = await abortable(iterator.next(), signal);
      if (item.done) { exhausted = true; break; }
      for (const event of decoder.push(item.value)) await processEvent(event);
    }
    for (const event of decoder.finish()) await processEvent(event);
    ensure(report.attempted > 0, "empty_stream", "The model returned no edit operations.");
    return { ...report, revision, durationMs: performance.now() - started };
  } catch (error) {
    await onEvent({ type: "stopped", report: { ...report, revision }, error: { code: error.code ?? error.name, message: error.message } });
    throw error;
  } finally {
    if (!exhausted && iterator.return) {
      // An uncooperative provider must not hold a cancellation or deadline open.
      Promise.resolve(iterator.return()).catch(error =>
        onEvent({ type: "cleanup_error", error: { code: error.code ?? error.name, message: error.message } }));
    }
  }
}
