import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { HostStateFile } from "../runtime-src/domain/host-state-file.ts";
import { allowsHumanRoleSettlement } from "../runtime-src/domain/human-loop/model.ts";
import { policyHash } from "../runtime-src/domain/workflow/policy.ts";
import { requireCondition } from "../runtime-src/domain/workflow/validation.ts";
import { validateDesignReferences } from "../public/sketch/design-contract.js";
import { decisionSections, technicalFindings, reviewCoverageText, emptyReviewSection } from "../public/review-decisions.js";

const hash = (value) => value === null ? null : createHash("sha256").update(value).digest("hex");
const start = "<!-- tandem:human-loop:evidence:start -->";
const end = "<!-- tandem:human-loop:evidence:end -->";
const display = (value) => String(value).replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("`", "\\`").replace(/[\r\n]+/g, " ");

export class HumanLoopReview {
  #owner;
  #workspace;
  #store;
  #commands;
  #verify;
  #file;
  #readDesign;
  constructor({ owner, workspace, store, commands, verifyOwnership, readDesign }) {
    this.#owner = owner; this.#workspace = workspace; this.#store = store; this.#commands = commands; this.#verify = verifyOwnership;
    this.#file = new HostStateFile(owner.workspacePath, join(owner.workspacePath, ".tandem", "living-canvas", "human-loop", "reviews.json"));
    requireCondition(typeof readDesign === "function", "Whole-plan Review requires a bound generic Design reader.");
    this.#readDesign = readDesign;
  }
  async #designEvidence(cycle, result = null) {
    const design = await this.#readDesign();
    requireCondition(policyHash(design.binding) === policyHash(cycle.design)
      && (design.content === null ? design.binding.digest === null : policyHash(design.content) === design.binding.digest),
    "Review evidence belongs to another Design revision or content.");
    const groups = [...cycle.plan.tasks, ...(result?.outcome.findings ?? []),
      ...(result?.outcome.assessments ?? []), ...(result?.outcome.questions ?? [])];
    for (const group of groups) validateDesignReferences(design.content, group.designRefs ?? []);
    const references = [...new Set(groups.flatMap((group) => group.designRefs ?? []))];
    return { binding: design.binding, references };
  }
  async evidence(cycle) {
    await this.#verify();
    const design = await this.#designEvidence(cycle);
    const after = cycle.reviewSnapshot ?? cycle.current;
    const changes = await this.#workspace.changes(cycle.baseline, after);
    const [beforeImage, afterImage] = await Promise.all([
      this.#workspace.readSnapshot(cycle.baseline), this.#workspace.readSnapshot(after),
    ]);
    const metadata = (file) => file ? { digest: file.digest, bytes: file.bytes, mode: file.mode, encoding: file.encoding } : null;
    return {
      schemaVersion: "whole-plan-review-evidence/v2", cycleId: cycle.id, design,
      originalRequestIds: cycle.originRequestIds, plan: cycle.plan, planHistory: cycle.planHistory,
      baseline: cycle.baseline, after, implementationResult: cycle.implementationResult,
      tasks: cycle.tasks, files: changes.map(({ path }) => ({
        path, before: metadata(beforeImage.files.find((file) => file.path === path)),
        after: metadata(afterImage.files.find((file) => file.path === path)),
        hostManaged: path === "TANDEM.md",
      })),
      changes,
      commands: await this.#commands.evidenceForCycle(cycle.id),
      authority: "Product acceptance authority is the exact bound agreed Design, its outcomes and contracts. Full-cycle evidence includes every actual changed file, not only task.scope forecasts. Plans, tasks and criteria are Design-derived execution aids, not a competing approval contract. Forecast deviations alone are not defects; all tasks complete alone is not product success. No transfer or Apply step exists.",
    };
  }
  async file(cycle, { path, side, offset = 0, length = this.#owner.policy.values.resources.reviewExcerptCharacters }) {
    requireCondition(["before", "after"].includes(side) && Number.isSafeInteger(offset) && offset >= 0
      && Number.isSafeInteger(length) && length > 0 && length <= this.#owner.policy.values.resources.reviewExcerptCharacters,
    "Invalid bounded cycle-file excerpt request.");
    const evidence = await this.evidence(cycle);
    const normalized = String(path).replaceAll("\\", "/");
    requireCondition(evidence.files.some((file) => file.path === normalized), "File is outside this cycle's actual change set.");
    const image = await this.#workspace.readSnapshot(side === "before" ? cycle.baseline : evidence.after);
    const file = image.files.find((file) => file.path === normalized);
    if (!file) return { path: normalized, side, exists: false };
    if (file.encoding !== "utf8") return { path: normalized, side, exists: true, binary: true, digest: file.digest, bytes: file.bytes };
    const characters = Array.from(file.content);
    const next = Math.min(characters.length, offset + length);
    return { path: normalized, side, exists: true, digest: file.digest, offset, totalCharacters: characters.length,
      content: characters.slice(offset, next).join(""), nextOffset: next < characters.length ? next : null };
  }
  async #index() {
    const path = join(this.#owner.workspacePath, "TANDEM.md");
    try {
      const info = await lstat(path);
      requireCondition(info.isFile() && !info.isSymbolicLink() && info.nlink === 1
        && info.size <= this.#owner.policy.values.resources.reviewIndexCharacters * 4, "Implementation index is aliased or oversized.");
      const bytes = await readFile(path), content = bytes.toString("utf8");
      const after = await lstat(path);
      requireCondition(after.isFile() && !after.isSymbolicLink() && after.nlink === 1 && after.dev === info.dev
        && after.ino === info.ino && after.size === info.size && after.mtimeMs === info.mtimeMs,
      "Implementation index changed during inspection.");
      requireCondition(Buffer.from(content).equals(bytes), "Implementation index is not valid UTF-8.");
      return content;
    } catch (error) { if (error.code === "ENOENT") return null; throw error; }
  }
  #render(previous, records) {
    if (previous !== null) previous = previous
      .replaceAll("<!-- teleos:human-loop:evidence:start -->", start)
      .replaceAll("<!-- teleos:human-loop:evidence:end -->", end);
    const lines = [start, "## Tandem whole-cycle implementation evidence", "",
      "Code is already in this project workspace. Review findings are not an approval or transfer gate.", ""];
    for (const record of records) {
      const decisionReview = Boolean(record.reviewFormat);
      lines.push(`- Cycle \`${display(record.cycleId)}\`; plan \`${display(record.planId)}\`; Review \`${display(record.resultId)}\`: ${decisionReview ? "decision review; verification evidence retained separately" : record.findings.length ? `${record.findings.length} finding(s)` : "no issues found"}.`,
        `  Summary: ${display(record.summary)}`,
        `  Design revision: \`${display(record.design.revisionId ?? "none")}\`; digest: \`${display(record.design.digest ?? "none")}\`. References: ${record.designRefs.map((ref) => `\`${display(ref)}\``).join(", ") || "none"}.`,
        `  Code snapshot: \`${record.before.digest}\`. Source requests: ${record.requestIds.map(display).join(", ")}.`);
      if (record.reviewFormat === "decision-review/v2") lines.push(`  ${reviewCoverageText(record)}`);
      if (decisionReview) for (const section of decisionSections(record)) {
        lines.push(`  ${section.title}: ${section.findings.length ? "" : emptyReviewSection(record)}`);
        for (const finding of section.findings) lines.push(`  Decision: ${display(finding.summary)} Design basis: ${display(finding.designBasis)} Material impact: ${display(finding.consequence)} Evidence: ${finding.evidenceRefs.map(display).join("; ")} Question: ${display(finding.questionId)}.`);
      }
      for (const finding of decisionReview ? technicalFindings(record) : record.findings) lines.push(
        `  ${decisionReview ? "Technical diagnostic" : "Finding"}: ${display(finding.summary)} ${display(finding.consequence)}`);
      for (const limit of record.verificationLimits) lines.push(`  ${record.reviewFormat === "decision-review/v2" ? "Coverage / limitation" : "Verification limit"}: ${display(limit)}`);
      lines.push("");
    }
    lines.push(end);
    const section = `${lines.join("\n")}\n`;
    if (previous === null) return `# Implementation evidence\n\n${section}`;
    const first = previous.indexOf(start), last = previous.indexOf(end);
    requireCondition((first < 0 && last < 0) || (first >= 0 && last > first
      && previous.indexOf(start, first + start.length) < 0 && previous.indexOf(end, last + end.length) < 0),
    "Managed index boundaries are ambiguous; user content was not overwritten.");
    return first < 0 ? `${previous}${previous.endsWith("\n") ? "" : "\n"}\n${section}`
      : previous.slice(0, first) + section + previous.slice(last + end.length).replace(/^\r?\n/, "");
  }
  async apply({ cycle, result, snapshot }) {
    await this.#verify();
    const state = await this.#store.load(), task = state.activeTask;
    requireCondition(task?.binding.role === "reviewer" && task.binding.cycleId === cycle.id
      && task.result?.resultId === result.resultId && policyHash(task.result) === policyHash(result)
      && (task.completion === "result-submission" || task.end) && policyHash(task.after) === policyHash(snapshot)
      && policyHash(state.cycles.find(({ id }) => id === cycle.id)) === policyHash(cycle)
      && !state.uncertainty && result.outcome.kind === "review-result",
    "Index maintenance requires the exact saved whole-plan Review result and evidence.");
    if (!allowsHumanRoleSettlement(state, task.binding.id)) return { cancelled: true };
    const designEvidence = await this.#designEvidence(cycle, result);
    const ownerDigest = policyHash(this.#owner);
    let record;
    await this.#file.mutate("prepare-whole-plan-index", async (content) => {
      const ledger = content === undefined ? { schemaVersion: "human-loop-reviews/v2", ownerDigest, records: [] } : JSON.parse(content);
      requireCondition(ledger.schemaVersion === "human-loop-reviews/v2" && ledger.ownerDigest === ownerDigest
        && Array.isArray(ledger.records), "Review index ownership is invalid.");
      record = ledger.records.find((entry) => entry.resultId === result.resultId);
      if (record) {
        requireCondition(record.cycleId === cycle.id && record.resultDigest === policyHash(result), "Review index result identity conflicts.");
        return { content, result: null };
      }
      await this.#workspace.readSnapshot(snapshot);
      const previous = await this.#index();
      record = { resultId: result.resultId, resultDigest: policyHash(result), cycleId: cycle.id, planId: cycle.plan.id,
        planDigest: cycle.plan.digest, requestIds: cycle.originRequestIds, before: snapshot,
        design: designEvidence.binding, designRefs: designEvidence.references,
        summary: result.outcome.summary, findings: result.outcome.findings, verificationLimits: result.outcome.verificationLimits,
        ...(result.outcome.reviewFormat ? { reviewFormat: result.outcome.reviewFormat } : {}),
        ...(result.outcome.coverageStatus ? { coverageStatus: result.outcome.coverageStatus } : {}),
        receiptId: `whole-review-index:${result.resultId}`, state: "prepared", previous, next: null, after: null };
      record.next = this.#render(previous, [...ledger.records, record]);
      requireCondition(record.next.length <= this.#owner.policy.values.resources.reviewIndexCharacters, "Managed index exceeds its configured size bound.");
      ledger.records.push(record);
      return { content: JSON.stringify(ledger), result: null };
    });
    const current = await this.#index();
    requireCondition(hash(current) === hash(record.previous) || hash(current) === hash(record.next), "The index changed outside its prepared update.");
    if (hash(current) !== hash(record.next)) {
      await this.#workspace.readSnapshot(record.before);
      const directory = join(this.#owner.workspacePath, ".tandem", "living-canvas", "human-loop", "index-staging");
      let ancestor = this.#owner.workspacePath;
      for (const part of [".tandem", "living-canvas", "human-loop", "index-staging"]) {
        ancestor = join(ancestor, part);
        try { await mkdir(ancestor); } catch (error) { if (error.code !== "EEXIST") throw error; }
        const info = await lstat(ancestor);
        requireCondition(info.isDirectory() && !info.isSymbolicLink(), "Index staging is aliased.");
      }
      const temporary = join(directory, `${randomUUID()}.tmp`);
      await writeFile(temporary, record.next, { encoding: "utf8", flag: "wx" });
      try {
        await this.#verify();
        requireCondition(hash(await this.#index()) === hash(record.previous), "Index changed before atomic replacement.");
        const staged = await lstat(temporary);
        requireCondition(staged.isFile() && !staged.isSymbolicLink() && staged.nlink === 1
          && hash(await readFile(temporary)) === hash(record.next), "Prepared index bytes changed.");
        for (let attempt = 0;; attempt++) {
          try { await rename(temporary, join(this.#owner.workspacePath, "TANDEM.md")); break; }
          catch (error) {
            if (!["EACCES", "EPERM", "EBUSY"].includes(error.code) || attempt >= this.#owner.policy.values.io.renameRetries) throw error;
            await new Promise((resolve) => setTimeout(resolve, this.#owner.policy.values.io.renameInitialDelayMs));
            requireCondition(hash(await this.#index()) === hash(record.previous), "Index changed while waiting for its file lock.");
          }
        }
      } finally { await rm(temporary, { force: true }); }
    }
    const after = await this.#workspace.capture();
    requireCondition(hash(await this.#index()) === hash(record.next),
      "Implementation index changed while recording Review evidence.");
    await this.#file.mutate("complete-whole-plan-index", (content) => {
      const ledger = JSON.parse(content), saved = ledger.records.find((entry) => entry.resultId === result.resultId);
      requireCondition(saved && saved.resultDigest === record.resultDigest, "Prepared Review index receipt changed.");
      saved.state = "applied"; saved.after = after;
      return { content: JSON.stringify(ledger), result: null };
    });
    return { receiptId: record.receiptId, before: record.before, after };
  }
}
