import { resolve } from "node:path";
import { HostStateFile } from "../runtime-src/domain/host-state-file.ts";
import { getHostStateWal } from "../runtime-src/domain/host-state-wal.ts";
import { createHumanLoopLedger, replayHumanLoopLedger } from "../runtime-src/domain/human-loop/ledger.ts";
import { parseHumanLoopOwner, transitionHumanLoop, implementationDecisionMessage } from "../runtime-src/domain/human-loop/model.ts";
import { bindQuestionOptions, parseRequest } from "../runtime-src/domain/human-loop/contracts.ts";
import { validateHumanImplementationAuthorization } from "../runtime-src/domain/human-loop/authorization.ts";
import { policyHash } from "../runtime-src/domain/workflow/policy.ts";
import { requireCondition, text, object } from "../runtime-src/domain/workflow/validation.ts";

export class HumanLoopStore {
  #owner;
  #file;
  #messages;
  #tail = Promise.resolve();
  #listeners = new Set();
  #derived = null;

  constructor(owner) {
    this.#owner = parseHumanLoopOwner(owner);
    this.#file = new HostStateFile(owner.workspacePath, resolve(owner.workspacePath, ".tandem", "living-canvas", "human-loop", "ledger.json"));
    this.#messages = new HostStateFile(owner.workspacePath, resolve(owner.workspacePath, ".tandem", "living-canvas", "human-loop", "conversation.json"));
  }

  async initialize(design) {
    const legacy = new HostStateFile(this.#owner.workspacePath,
      resolve(this.#owner.workspacePath, ".tandem", "living-canvas", "workflow", "controller", "controller-state.json"));
    requireCondition(await legacy.read() === undefined,
      "This workspace contains a legacy two-copy workflow. Use a fresh new-model session; no approvals or code were migrated.");
    return this.#file.transact("human-loop-initialize", async (content) => {
      const ledger = content === undefined ? createHumanLoopLedger(this.#owner, design) : JSON.parse(content);
      const derived = this.#derive(JSON.stringify(ledger));
      await this.#publishAfterCommit(derived);
      return { content: derived.content, result: structuredClone(derived.state) };
    });
  }

  #derive(content) {
    if (this.#derived?.content === content) return this.#derived;
    const parsed = replayHumanLoopLedger(JSON.parse(content));
    requireCondition(policyHash(parsed.ledger.owner) === policyHash(this.#owner), "Human-loop owner changed.");
    return { content, ...parsed, commands: new Map(parsed.ledger.events.map(event => [event.command.id, event])) };
  }

  async #publishAfterCommit(derived, notify = false) {
    await this.#file.afterCommit(() => {
      this.#derived = derived;
      if (notify) for (const listener of this.#listeners) {
        try { Promise.resolve(listener(structuredClone(derived.state))).catch(() => process.emitWarning("Human-loop observation failed; durable state is retained.", { code: "HUMAN_LOOP_OBSERVATION" })); }
        catch { process.emitWarning("Human-loop observation failed; durable state is retained.", { code: "HUMAN_LOOP_OBSERVATION" }); }
      }
    });
  }

  async load() {
    const content = await this.#file.read();
    requireCondition(content !== undefined, "Human-loop state is not initialized; missing data is not an empty workflow.");
    const derived = this.#derive(content);
    // Transaction-local changes must never escape into the committed projection.
    if (!this.#file.inTransaction()) this.#derived = derived;
    return structuredClone(derived.state);
  }

  async inspectInitialCreation() {
    const content = await this.#file.read();
    const derived = content === undefined ? null : this.#derive(content);
    requireCondition(!derived || derived.ledger.initialDesign.revisionId === null
      && derived.ledger.initialDesign.digest === null
      && derived.ledger.events.every(event => event.authority === "host"
        && event.command.type === "execution-unknown" && event.command.id === "execution-unknown:session")
      && !derived.state.requests.length && !derived.state.executions.length && !derived.state.cycles.length
      && !derived.state.questions.length && !derived.state.handoffs.length && !derived.state.stops.length
      && !derived.state.implementationConfirmations?.length && !derived.state.activeRequestId && !derived.state.activeTask
      && !derived.state.stop && !derived.state.recoveries?.length,
    "Initial setup recovery refuses any admitted work, Design, approval or prior recovery; a missing used session must be restored, not recreated.");
    const messages = await this.messages();
    requireCondition(messages.every(message => message.requestId === null && message.role === "host" && message.kind === "status"
      && (message.id === "diagnostic:execution-unknown:session" || message.id.startsWith("recovery-diagnostic:"))),
    "Initial setup recovery cannot replace retained native or project conversation.");
    return { initialized: content !== undefined, digest: policyHash({ content: content ?? null, messages }) };
  }

  async dispatch(authority, id, type, data) {
    return this.#dispatch(authority, id, type, data);
  }

  async admitTask(packet) {
    return this.#dispatch("host", `start:${packet.binding.dispatchId}`, "start-role", packet.binding, () => this.saveTask(packet));
  }

  async #dispatch(authority, id, type, data, prepare) {
    const work = this.#tail.then(() => this.#file.transact(`human-loop:${type}`, async (content) => {
      requireCondition(content !== undefined, "Human-loop ledger disappeared.");
      const derived = this.#derive(content), { ledger, state } = derived;
      const previous = derived.commands.get(id);
      if (previous) {
        requireCondition(previous.authority === authority && previous.command.type === type, "Conflicting retry of a durable lifecycle command.");
        // Old option envelopes omit derived wording; compare meaning without rewriting their audit.
        const comparable = value => type === "receive-request"
          ? bindQuestionOptions(parseRequest(value), state.questions) : value;
        requireCondition(policyHash(comparable(previous.command.data)) === policyHash(comparable(data)),
          "Conflicting retry of a durable lifecycle command.");
        await this.#publishAfterCommit(derived, true);
        return { content, result: structuredClone(state) };
      }
      const command = { id: text(id), expectedRevision: state.revision, type, data: structuredClone(data) };
      const next = transitionHumanLoop(state, authority, command);
      validateHumanImplementationAuthorization(state, type, data);
      await prepare?.();
      if (type === "decide-implementation-confirmation") {
        const confirmation = next.implementationConfirmations.find(c => c.id === data.confirmationId);
        await this.recordMessage({ id: `implementation-decision:${confirmation.id}`, requestId: confirmation.requestId,
          role: "host", kind: "status", content: implementationDecisionMessage(confirmation), timestamp: confirmation.decidedAt });
      }
      if (type === "execution-unknown" && !state.uncertainty) {
        const binding = state.activeTask?.binding, timestamp = new Date().toISOString();
        const bounded = value => typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 256) : null;
        await this.recordMessage({ id: `diagnostic:${id}`, requestId: binding?.requestId ?? null,
          role: "host", kind: "status", timestamp,
          content: JSON.stringify({ kind: "execution-unknown", timestamp, source: bounded(id), authority,
            sessionId: bounded(this.#owner.privateSessionId), requestId: bounded(binding?.requestId),
            taskId: bounded(binding?.id), role: bounded(binding?.role), evidenceRef: bounded(data.evidenceRef),
            reason: String(data.reason).replace(/[\u0000-\u001f\u007f]/g, " ")
              .slice(0, this.#owner.policy.values.resources.reviewReasonCharacters) }) });
      }
      const event = { authority, command };
      const nextLedger = { ...ledger, events: [...ledger.events, event] };
      const nextContent = JSON.stringify(nextLedger);
      const commands = new Map(derived.commands); commands.set(id, event);
      await this.#publishAfterCommit({ content: nextContent, ledger: nextLedger, state: next, commands }, true);
      return { content: nextContent, result: structuredClone(next) };
    }));
    this.#tail = work.then(() => undefined, () => undefined);
    return work;
  }

  async validate(authority, type, data) {
    const state = await this.load();
    transitionHumanLoop(state, authority, { id: `validation:${state.revision}:${type}`, expectedRevision: state.revision, type, data });
    validateHumanImplementationAuthorization(state, type, data);
  }

  async saveTask(packet) {
    const file = new HostStateFile(this.#owner.workspacePath,
      resolve(this.#owner.workspacePath, ".tandem", "living-canvas", "human-loop", "tasks", `${packet.binding.inputDigest}.json`), undefined, { artifact: true });
    const serialized = JSON.stringify(packet);
    await file.mutate("save-human-loop-task", (existing) => {
      requireCondition(existing === undefined || existing === serialized, "Immutable task input conflicts with its digest.");
      return { content: serialized, result: null };
    });
  }

  async recordMessage(value) {
    const entry = object(value, ["id", "requestId", "role", "kind", "content", "timestamp"]);
    text(entry.id); text(entry.role); text(entry.content); text(entry.timestamp);
    requireCondition(entry.requestId === null || typeof entry.requestId === "string", "Invalid message origin.");
    requireCondition(["user", "assistant", "status"].includes(entry.kind) && Number.isFinite(Date.parse(entry.timestamp)), "Invalid retained message.");
    await this.#messages.mutate("record-human-loop-message", (content) => {
      const state = content === undefined ? { schemaVersion: "human-loop-conversation/v1", messages: [] } : JSON.parse(content);
      requireCondition(state.schemaVersion === "human-loop-conversation/v1" && Array.isArray(state.messages), "Invalid retained human-loop conversation.");
      const previous = state.messages.find(({ id }) => id === entry.id);
      requireCondition(!previous || policyHash(previous) === policyHash(entry), "Message identity has conflicting originals.");
      if (!previous) state.messages.push(entry);
      return { content: JSON.stringify(state), result: null };
    });
  }

  async messages() {
    const content = await this.#messages.read();
    if (content === undefined) return [];
    const state = JSON.parse(content);
    requireCondition(state.schemaVersion === "human-loop-conversation/v1" && Array.isArray(state.messages), "Invalid retained conversation schema.");
    return state.messages;
  }
  subscribe(listener) { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }
  async close() { await this.#tail; this.#derived = null; await getHostStateWal(this.#owner.workspacePath).close(); }
}
