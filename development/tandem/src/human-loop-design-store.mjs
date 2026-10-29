import { resolve } from "node:path";
import { HostStateFile } from "../runtime-src/domain/host-state-file.ts";
import { parseDesignBinding } from "../runtime-src/domain/human-loop/contracts.ts";
import { policyHash } from "../runtime-src/domain/workflow/policy.ts";
import { object, requireCondition, text } from "../runtime-src/domain/workflow/validation.ts";
import { validateDesign } from "../public/sketch/design-contract.js";

const same = (a, b) => policyHash(a) === policyHash(b);
const absent = { revisionId: null, digest: null };
export const sharedDesignBinding = (revision) => revision
  ? { revisionId: revision.id, digest: policyHash(revision.input) } : { ...absent };

/** Canonical head and immutable revisions participate in the caller's workspace WAL transaction. */
export class HumanLoopDesignStore {
  #root;
  #head;
  constructor(workspacePath) {
    this.#root = workspacePath;
    this.#head = new HostStateFile(workspacePath, resolve(workspacePath, ".tandem", "living-canvas", "design", "manifest.json"));
  }
  #revision(id) {
    requireCondition(typeof id === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id),
      "Invalid shared Design revision identity.");
    return new HostStateFile(this.#root, resolve(this.#root, ".tandem", "living-canvas", "design", "revisions", `${id}.json`),
      undefined, { artifact: true });
  }
  async readRevision(value) {
    const binding = parseDesignBinding(value);
    requireCondition(binding.revisionId !== null, "An exact published Design binding is required.");
    const content = await this.#revision(binding.revisionId).read();
    requireCondition(content !== undefined, "The referenced immutable Design revision is missing.");
    const revision = object(JSON.parse(content), ["schemaVersion", "id", "previous", "requestId", "proposedAt", "input"]);
    requireCondition(revision.schemaVersion === "sketch-design-revision/v1" && revision.id === binding.revisionId,
      "Unsupported or mismatched shared Design revision.");
    const previous = parseDesignBinding(revision.previous), input = validateDesign(revision.input);
    text(revision.requestId);
    requireCondition(typeof revision.proposedAt === "string" && Number.isFinite(Date.parse(revision.proposedAt))
      && policyHash(input) === binding.digest, "Shared Design revision content or timestamp is invalid.");
    return { ...revision, previous, input };
  }
  async inspectCurrent() {
    const content = await this.#head.read();
    if (content === undefined) return null;
    const parsed = JSON.parse(content);
    requireCondition(parsed?.schemaVersion === "sketch-design-head/v1",
      "Unsupported canonical Design format. Expected sketch-design-head/v1; no conversion or clearing was attempted.");
    const head = object(parsed, ["schemaVersion", "current", "previous", "publishedAt"]);
    const current = parseDesignBinding(head.current), previous = parseDesignBinding(head.previous);
    const revision = await this.readRevision(current);
    requireCondition(same(previous, revision.previous) && head.publishedAt === revision.proposedAt,
      "Canonical Design head and immutable revision disagree.");
    return revision;
  }
  async publish({ input, previous, requestId, application }) {
    previous = parseDesignBinding(previous);
    const current = await this.inspectCurrent();
    requireCondition(same(sharedDesignBinding(current), previous), "Canonical Design changed before publication.");
    const validated = validateDesign(input, { previous: current?.input ?? null });
    requireCondition(application.id !== previous.revisionId && typeof application.proposedAt === "string"
      && Number.isFinite(Date.parse(application.proposedAt)) && application.designDigest === policyHash(validated),
    "Prepared Design publication does not match its complete content.");
    const revision = { schemaVersion: "sketch-design-revision/v1", id: application.id, previous,
      requestId: text(requestId), proposedAt: application.proposedAt, input: validated };
    const file = this.#revision(revision.id), existing = await file.read();
    requireCondition(existing === undefined || same(JSON.parse(existing), revision), "Immutable Design revision identity conflicts.");
    await file.write("publish-shared-design-revision", JSON.stringify(revision));
    await this.#head.write("publish-shared-design-head", JSON.stringify({
      schemaVersion: "sketch-design-head/v1", current: sharedDesignBinding(revision), previous, publishedAt: revision.proposedAt,
    }));
    return revision;
  }
}
