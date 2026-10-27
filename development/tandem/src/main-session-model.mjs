import { normalizeModelCatalog } from "./human-loop-preferences.mjs";

/** Settings for the joined main session, never the private Development owner. */
export class MainSessionModel {
  #changing = false;
  #error = null;
  constructor(session, effort) { this.session = session; this.effort = effort; }
  async #current() {
    const session = this.session();
    if (!session?.sessionId || typeof session.rpc?.model?.getCurrent !== "function") {
      throw new Error("This host cannot read the owning main-session model.");
    }
    const value = await session.rpc.model.getCurrent();
    if (!value || value.modelId !== undefined && (typeof value.modelId !== "string" || !value.modelId.trim())
      || value.reasoningEffort !== undefined && typeof value.reasoningEffort !== "string") {
      throw new Error("Main-session model readback is invalid.");
    }
    return { sessionId: session.sessionId, actual: value.modelId ?? null, reasoningEffort: value.reasoningEffort ?? null };
  }
  async #models() {
    if (typeof this.session()?.rpc?.model?.list !== "function") throw new Error("This host cannot list main-session models.");
    const catalog = await this.session().rpc.model.list();
    return normalizeModelCatalog(catalog?.list?.map(model => ({ ...model,
      supportedReasoningEfforts: model?.capabilities?.supports?.reasoning_effort ?? [] })));
  }
  async #idle() {
    const rpc = this.session()?.rpc;
    if (typeof rpc?.model?.switchTo !== "function" || typeof rpc.metadata?.isProcessing !== "function"
      || typeof rpc.metadata?.activity !== "function" || typeof rpc.queue?.pendingItems !== "function") {
      throw new Error("This host does not expose idle-checked main-model changes. Use its native model control.");
    }
    const [processing, activity, queue] = await Promise.all([rpc.metadata.isProcessing(), rpc.metadata.activity(), rpc.queue.pendingItems()]);
    if (processing?.processing !== false || activity?.hasActiveWork !== false
      || !Array.isArray(queue?.items) || !Array.isArray(queue?.steeringMessages)
      || queue.items.length || queue.steeringMessages.length) {
      throw new Error("Wait for main-session work and queued input to finish before changing its model.");
    }
  }
  async read() {
    let current = { sessionId: this.session()?.sessionId ?? null, actual: null, reasoningEffort: null }, models = [];
    try {
      current = await this.#current();
      models = await this.#models();
      await this.#idle();
      return { ...current, models, canChange: !this.#changing, error: this.#error,
        sharedEffort: await this.effort(), reason: "Changes only the owning main session. Existing Development sessions keep their model." };
    } catch (error) {
      return { ...current, models, canChange: false, error: this.#error, sharedEffort: null, reason: error.message };
    }
  }
  async select(input) {
    if (this.#changing) throw new Error("A main-session model change is already in progress.");
    this.#changing = true;
    try {
      const current = await this.#current();
      if (!input || typeof input.model !== "string" || input.sessionId !== current.sessionId || input.expectedModel !== current.actual) {
        throw new Error("The main-session model or owner changed. Refresh settings before applying.");
      }
      await this.#idle();
      const model = (await this.#models()).find(model => model.id === input.model);
      if (!model) throw new Error("The requested main model is unavailable or disabled; no substitute was selected.");
      const effort = await this.effort() ?? current.reasoningEffort;
      if (effort !== null && !model.supportedReasoningEfforts.includes(effort)) {
        throw new Error("The requested main model does not support the current reasoning effort. Choose a compatible model or explicitly change Project effort.");
      }
      const result = await this.session().rpc.model.switchTo({ modelId: model.id, requireAvailable: true,
        runCompactionPreflight: true, ...(effort !== null ? { reasoningEffort: effort } : {}) });
      if (result?.deferred || result?.queueId || result?.confirmation || result?.persistenceError) {
        throw new Error(result.persistenceError || result.message
          || "The native model change is pending or needs host confirmation. Inspect the hosting session; it has not been verified as applied.");
      }
      const after = await this.#current();
      if (after.sessionId !== current.sessionId || after.actual !== model.id || effort !== null && after.reasoningEffort !== effort) {
        throw new Error("The main session did not confirm the requested model/effort. Refresh its actual state; no replacement session was created.");
      }
      this.#error = result?.warning ?? null;
    } catch (error) {
      this.#error = error.message;
      throw error;
    } finally { this.#changing = false; }
    return this.read();
  }
}
