import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { HostStateFile } from "../runtime-src/domain/host-state-file.ts";
import { parseDesignBinding, parseOwnedEnd, parseRoleResult } from "../runtime-src/domain/human-loop/contracts.ts";
import { parseHumanLoopOwner, allowsHumanRoleSettlement } from "../runtime-src/domain/human-loop/model.ts";
import { policyHash } from "../runtime-src/domain/workflow/policy.ts";
import { object, requireCondition, text } from "../runtime-src/domain/workflow/validation.ts";
import { parseHumanTask } from "./human-loop-task.mjs";
import { HumanLoopDesignStore, sharedDesignBinding } from "./human-loop-design-store.mjs";
import { designSchema, designGenerationContract, validateDesign, validateDesignReferences, designReferenceCatalog } from "../public/sketch/design-contract.js";
import { validateSketchSchema } from "../public/sketch/contract.js";

const same = (a, b) => policyHash(a) === policyHash(b);
const bindingOf = sharedDesignBinding;
const artifactId = (ref) => {
  requireCondition(typeof ref === "string" && /^human-design:[a-f0-9]{64}$/.test(ref), "Invalid human Design artifact reference.");
  return ref.slice("human-design:".length);
};

/** Staging is Designer-owned; publication applies its durably submitted result. */
export class HumanLoopDesigner {
  #owner;
  #ownerDigest;
  #store;
  #verify;
  #artifacts;
  #journal;

  constructor({ owner, store, verifyOwnership }) {
    this.#owner = parseHumanLoopOwner(owner);
    requireCondition(typeof store?.load === "function" && typeof verifyOwnership === "function",
      "Human Design needs the owned ledger and an ownership verifier.");
    this.#ownerDigest = policyHash(this.#owner);
    this.#store = store;
    this.#verify = verifyOwnership;
    this.#artifacts = new HumanLoopDesignStore(this.#owner.workspacePath);
    this.#journal = this.#file("publication.json");
  }

  #file(name, artifact = false) {
    return new HostStateFile(this.#owner.workspacePath,
      resolve(this.#owner.workspacePath, ".tandem", "living-canvas", "human-loop", "design", name),
      undefined, { artifact });
  }

  async read() {
    await this.#verify();
    return this.#journal.inspect(async () => {
      const current = await this.#artifacts.inspectCurrent();
      return { binding: bindingOf(current), content: current?.input ?? null,
        references: current ? designReferenceCatalog(current.input) : [] };
    });
  }
  generation() { return designGenerationContract; }
  async readRevision(binding) {
    await this.#verify();
    return this.#journal.inspect(async () => {
      const revision = await this.#artifacts.readRevision(binding);
      return { binding: bindingOf(revision), content: revision.input, references: designReferenceCatalog(revision.input) };
    });
  }

  tools() {
    return [{
      name: "stage_human_design",
      description: "Validate a complete sketch-design/v3 collection and its source-bound references without publishing. Visual artifact/v1 uses mermaid, html or svg with dimensions. Document artifact/v2 uses markdown, json-schema or bounded openapi with no dimensions; follow the exact artifact rules and preserve unchanged artifacts. Return its artifactRef in submit_designer_outcome.",
      roles: ["designer"],
      parameters: designSchema,
      validate: async (args, { task, signal }) => {
        const packet = parseHumanTask(task);
        signal?.throwIfAborted();
        await this.#journal.inspect(async () => { await this.#validateStage(args, packet, signal); });
      },
      execute: (args, { task, signal }) => this.#stage(args, task, signal),
    }];
  }

  async #owned(packet, result, ended = false) {
    await this.#verify();
    const state = await this.#store.load(), task = state.activeTask;
    requireCondition(same(state.owner, this.#owner) && allowsHumanRoleSettlement(state, packet.binding.id) && !state.uncertainty,
      "Human Design ownership is stopped, uncertain or changed.");
    requireCondition(packet.binding.role === "designer" && packet.binding.sessionId === this.#owner.privateSessionId
      && task && same(task.binding, packet.binding) && same(state.design, packet.binding.design),
    "Human Design task, input or prior binding is not the exact active task.");
    requireCondition(!["unknown", "not-sent", "waiting-permission"].includes(task.condition),
      "Human Design task has no usable owned execution.");
    if (result) requireCondition(result.inputDigest === packet.binding.inputDigest, "Designer result input digest differs from its task.");
    if (ended) {
      requireCondition(task.condition === "ended" && task.result && same(task.result, result)
        && (task.completion === "result-submission" || task.end) && same(task.after, packet.binding.before),
      "Design publication requires the exact saved result and code binding.");
      if (task.completion !== "result-submission") {
        const end = parseOwnedEnd(task.end);
        requireCondition(end.termination !== "user-stop" && end.taskId === packet.binding.id
          && end.dispatchId === packet.binding.dispatchId && end.sessionId === packet.binding.sessionId
          && end.messageId === task.messageId && end.interactionId === task.interactionId
          && (end.termination !== "result-abort" || task.terminal?.acknowledged === true),
        "Legacy Design publication has a mismatched execution binding.");
      }
    }
    return task;
  }

  async #validateStage(args, packet, signal) {
    signal?.throwIfAborted();
    const active = await this.#owned(packet);
    requireCondition(!active.result && !active.end && active.condition === "running", "Designer staging window has ended.");
    const current = await this.#artifacts.inspectCurrent(), previous = bindingOf(current);
    requireCondition(same(previous, packet.binding.design), "Canonical Design differs from the task's prior binding.");
    requireCondition(Buffer.byteLength(JSON.stringify(args), "utf8") <= this.#owner.policy.values.resources.reviewPromptCharacters * 4,
      "Shared Design exceeds the pinned generation resource bound.");
    validateSketchSchema(args, designSchema, "design");
    const output = validateDesign(args, { previous: current?.input ?? null });
    signal?.throwIfAborted();
    return { schemaVersion: "human-design-artifact/v2", ownerDigest: this.#ownerDigest,
      binding: packet.binding, previousContent: current?.input ?? null, output };
  }

  async #stage(args, task, signal) {
    const packet = parseHumanTask(task);
    signal?.throwIfAborted();
    return this.#journal.run("stage-human-design", async () => {
      const artifact = await this.#validateStage(args, packet, signal);
      const id = policyHash(artifact), artifactRef = `human-design:${id}`, file = this.#file(`${id}.json`, true);
      const existing = await file.read();
      requireCondition(existing === undefined || same(JSON.parse(existing), artifact), "Immutable Design artifact identity conflicts.");
      signal?.throwIfAborted();
      await this.#verify();
      await file.write("stage-human-design", JSON.stringify(artifact));
      return { artifactRef };
    });
  }

  async #loadArtifact(packet, artifactRef) {
    const content = await this.#file(`${artifactId(artifactRef)}.json`, true).read();
    requireCondition(content !== undefined, "Referenced human Design artifact does not exist.");
    const artifact = object(JSON.parse(content), ["schemaVersion", "ownerDigest", "binding", "previousContent", "output"]);
    requireCondition(artifact.schemaVersion === "human-design-artifact/v2" && artifact.ownerDigest === this.#ownerDigest
      && policyHash(artifact) === artifactId(artifactRef), "Human Design artifact integrity or ownership differs.");
    requireCondition(same(artifact.binding, packet.binding), "Design artifact belongs to another task, input or prior binding.");
    requireCondition(artifact.previousContent === null
      ? packet.binding.design.revisionId === null
      : policyHash(artifact.previousContent) === packet.binding.design.digest, "Design artifact prior content is not bound.");
    return validateDesign(artifact.output, { previous: artifact.previousContent });
  }

  async validateOutcome(packet, result) {
    packet = parseHumanTask(packet);
    result = parseRoleResult("designer", result);
    requireCondition(["designer-changed", "designer-unchanged"].includes(result.outcome.kind), "Expected a Designer outcome.");
    return this.#journal.inspect(async () => {
      await this.#owned(packet, result);
      requireCondition(same(bindingOf(await this.#artifacts.inspectCurrent()), packet.binding.design),
        "Canonical Design no longer matches the task's prior revision and digest.");
      const design = result.outcome.kind === "designer-changed" ? await this.#loadArtifact(packet, result.outcome.artifactRef)
        : (await this.#artifacts.inspectCurrent())?.input ?? null;
      for (const question of result.outcome.questions) validateDesignReferences(design, question.designRefs ?? []);
      return result;
    });
  }

  #parseReceipt(content, packet, result, output) {
    if (content === undefined) return null;
    const receipt = object(JSON.parse(content), ["schemaVersion", "ownerDigest", "binding", "result", "application", "publication"]);
    requireCondition(receipt.schemaVersion === "human-design-receipt/v2" && receipt.ownerDigest === this.#ownerDigest
      && same(receipt.binding, packet.binding) && same(receipt.result, result), "Design publication receipt belongs to another result or task.");
    const application = object(receipt.application, ["id", "proposedAt", "designDigest"]);
    text(application.id);
    requireCondition(typeof application.proposedAt === "string" && Number.isFinite(Date.parse(application.proposedAt))
      && application.designDigest === policyHash(output), "Design publication application is invalid.");
    if (receipt.publication !== null) {
      const publication = object(receipt.publication, ["previous", "current", "receiptId", "artifactRef"]);
      requireCondition(same(parseDesignBinding(publication.previous), packet.binding.design)
        && parseDesignBinding(publication.current).revisionId === application.id
        && publication.current.digest !== null && publication.receiptId === `human-design-publication:${application.id}`
        && publication.artifactRef === result.outcome.artifactRef, "Design publication receipt is inconsistent.");
    }
    return receipt;
  }

  async publish({ packet, result, previous }) {
    packet = parseHumanTask(packet);
    result = parseRoleResult("designer", result);
    previous = parseDesignBinding(previous);
    requireCondition(result.outcome.kind === "designer-changed" && same(previous, packet.binding.design),
      "Only a changed Design with the exact previous binding can publish.");
    const file = this.#file(`${artifactId(result.outcome.artifactRef)}.receipt.json`);
    // Persist the application identity before promotion. A retry always uses this same revision.
    await this.#journal.run("prepare-human-design-publication", async () => {
      await this.#owned(packet, result, true);
      const output = await this.#loadArtifact(packet, result.outcome.artifactRef);
      const receipt = this.#parseReceipt(await file.read(), packet, result, output);
      const expected = receipt?.publication?.current ?? previous;
      requireCondition(same(bindingOf(await this.#artifacts.inspectCurrent()), expected), "Canonical Design changed before publication.");
      if (!receipt) await file.write("prepare-human-design-publication", JSON.stringify({
        schemaVersion: "human-design-receipt/v2", ownerDigest: this.#ownerDigest, binding: packet.binding, result,
        application: { id: randomUUID(), proposedAt: new Date().toISOString(), designDigest: policyHash(output) }, publication: null,
      }));
    });
    return this.#journal.run("publish-human-design", async () => {
      await this.#owned(packet, result, true);
      const output = await this.#loadArtifact(packet, result.outcome.artifactRef);
      const receipt = this.#parseReceipt(await file.read(), packet, result, output);
      requireCondition(receipt, "Design publication preparation is missing.");
      const current = await this.#artifacts.inspectCurrent();
      requireCondition(same(bindingOf(current), receipt.publication?.current ?? previous), "Canonical Design changed before promotion or replay.");
      if (receipt.publication) return receipt.publication;
      const published = await this.#artifacts.publish({ input: output, previous,
        requestId: packet.binding.requestId, application: receipt.application });
      const publication = { previous, current: bindingOf(published),
        receiptId: `human-design-publication:${receipt.application.id}`, artifactRef: result.outcome.artifactRef };
      requireCondition(publication.current.revisionId !== previous.revisionId, "Changed Design needs a new revision.");
      // Immutable revision, canonical head and receipt commit in the same workspace WAL transaction.
      await this.#verify();
      await file.write("publish-human-design", JSON.stringify({ ...receipt, publication }));
      return publication;
    });
  }
}
