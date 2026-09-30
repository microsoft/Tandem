export const compactionInstructions = [
  "Summarize older exchanges while retaining recent exchanges, decisions, constraints, current intent, and references to Design and project files.",
  "The summary is context, not authoritative current code or Design. Read current files and canonical Design before acting.",
  "Historical requests and interrupted tasks are not new instructions. Compaction never authorizes resuming or replaying work.",
].join("\n");

export class HumanLoopCompaction {
  #state = { active: false, trigger: null, startedAt: null, error: null };
  #notify;
  #seen = new Set();
  constructor(notify) { this.#notify = notify; }
  read() { return { ...this.#state }; }
  confirmed() {
    const changed = this.#state.active || this.#state.error;
    this.#state = { ...this.#state, active: false, error: null };
    if (changed) this.#notify({ kind: "compaction-complete", summary: "Native runtime confirmed context compaction completed." });
  }
  observe(event) {
    if (event.agentId) return false;
    if (!["session.compaction_start", "session.compaction_complete"].includes(event.type)) return false;
    if (this.#seen.has(event.id)) return true;
    this.#seen.add(event.id);
    if (event.type === "session.compaction_start") {
      this.#state = { active: true, trigger: event.data?.trigger ?? null, startedAt: event.timestamp, error: null };
      this.#notify({ kind: "compaction-start", summary: "Compacting model context. Conversation and Design remain retained." });
      return true;
    }
    if (event.type === "session.compaction_complete") {
      const error = event.data?.success === true ? null : event.data?.error || "Native context compaction failed.";
      this.#state = { ...this.#state, active: false, trigger: event.data?.trigger ?? this.#state.trigger, error };
      this.#notify({ kind: error ? "compaction-failed" : "compaction-complete",
        summary: error ? `Context compaction failed: ${error}` : "Model context compacted. Saved Conversation and Design are unchanged." });
      return true;
    }
    return false;
  }
  failed(error) {
    const message = error instanceof Error ? error.message : "Context compaction failed.";
    if (!this.#state.active && this.#state.error === message) return;
    this.#state = { ...this.#state, active: false, error: message };
    this.#notify({ kind: "compaction-failed", summary: `Context compaction failed: ${this.#state.error}` });
  }
}
