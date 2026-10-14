import assert from "node:assert/strict";
import test from "node:test";
import { approvePlan, parsePlanProposal } from "../runtime-src/domain/workflow/change-plan.ts";
import { DEFAULT_POLICY, policyHash } from "../runtime-src/domain/workflow/policy.ts";
import { parsePrivateTask, parseChangeProposal, parsePrivateResult } from "../runtime-src/domain/workflow/private-execution-contract.ts";
import { parseRetainedWork } from "../runtime-src/domain/workflow/retained-work.ts";
import { resolve } from "node:path";

const digest = (value) => value.repeat(64);
const boundary = (value) => ({ commit: "a".repeat(40), inventoryDigest: digest(value), evidenceRef: `inventory-${value}` });
function fixture() {
  const design = { id: "design", complete: true, entities: [{ id: "contract:root", digest: "root", dependencies: [] }] };
  const owner = { ownerId: "owner", mainSessionId: "main", privateSessionId: "private", repositoryId: "repo",
    worktreePath: resolve(".retained-contract-source"), targetWorktreePath: resolve(".retained-contract-target"), policy: DEFAULT_POLICY };
  const plan = parsePlanProposal({ schemaVersion: "change-plan/v2", id: "new-plan", version: 1, outcome: "Follow the new request.",
    designRevisionId: design.id, baselineDigest: boundary("b").inventoryDigest, policyDigest: DEFAULT_POLICY.digest,
    items: [{ id: "item", version: 1, goal: "Reuse or rework the retained result.", scope: ["retained.js", "new.js"],
      designRefs: ["contract:root"], dependsOn: [], criteria: [{ id: "intent", description: "Matches current intent." }] }] }, DEFAULT_POLICY);
  const approval = approvePlan(plan, { planId: plan.id, planVersion: plan.version, planDigest: plan.digest,
    items: plan.items.map(({ id, version, digest }) => ({ id, version, digest })) }, "new-approval");
  const retainedWork = parseRetainedWork({ schemaVersion: "retained-work/v1", stopId: "stop", operationId: "cancelled-operation",
    sourceTaskIds: ["stopped-task"], baseline: boundary("a"), source: boundary("b"), target: boundary("c"), paths: ["retained.js"] });
  const task = parsePrivateTask({ taskId: "new-task", dispatchId: "new-dispatch", plan, approval, itemId: "item",
    originalDesign: design, currentDesign: design, acceptedDependencies: [], contextRefs: ["current"], constraints: [],
    before: boundary("b"), retainedWork, executionBaseline: { operationId: "new-operation", inventoryDigest: digest("b"), evidenceRefs: ["current"] } }, owner);
  const proposal = { schemaVersion: "retained-work-proposal/v1", taskId: task.taskId, inputDigest: policyHash(task),
    repositoryId: owner.repositoryId, sourceWorktree: owner.worktreePath, targetWorktree: owner.targetWorktreePath,
    before: boundary("c"), executionBefore: boundary("b"), retainedWorkDigest: policyHash(retainedWork), after: boundary("d"),
    patchRef: { artifactRef: "patch", digest: digest("e") },
    files: [{ path: "retained.js", beforeHash: digest("a"), afterHash: digest("b") }], integration: "not-applied" };
  return { owner, task, proposal };
}

test("retained proposals distinguish the actual execution baseline from exact target preimages", () => {
  const { owner, task, proposal } = fixture();
  const saved = parseChangeProposal(proposal, owner, task);
  assert.deepEqual(saved.before, task.retainedWork.target);
  assert.deepEqual(saved.executionBefore, task.before);
  for (const wrong of [
    { ...proposal, before: task.retainedWork.baseline },
    { ...proposal, executionBefore: task.retainedWork.baseline },
    { ...proposal, retainedWorkDigest: digest("f") },
    { ...proposal, files: [{ ...proposal.files[0], path: "TANDEM.md" }] },
  ]) assert.throws(() => parseChangeProposal(wrong, owner, task));
  const oldShape = { ...proposal, schemaVersion: "isolated-change-proposal/v1" };
  delete oldShape.executionBefore; delete oldShape.retainedWorkDigest;
  assert.throws(() => parseChangeProposal(oldShape, owner, task), /exact recorded baseline/);
});

test("removing abandoned edits may have zero net target change without erasing its execution baseline", () => {
  const { owner, task, proposal } = fixture();
  const saved = parseChangeProposal({ ...proposal, files: [], patchRef: null }, owner, task);
  assert.equal(saved.files.length, 0);
  assert.deepEqual(saved.executionBefore, task.before);
  assert.deepEqual(task.retainedWork.baseline, boundary("a"));
});

test("fresh plans must cover retained paths without inventing alignment judgments or transferring approval", () => {
  const { owner, task } = fixture();
  const router = parsePrivateTask({ ...task, approval: null, assessmentOnly: { scope: ["read-only-project"] },
    coordination: { kind: "router", requestId: "new-request", message: "Follow my new direction." } }, owner);
  const candidate = { schemaVersion: "change-plan/v2", id: "candidate", version: 1, outcome: "Use the new direction.",
    designRevisionId: task.currentDesign.id, baselineDigest: task.before.inventoryDigest, policyDigest: DEFAULT_POLICY.digest,
    items: task.plan.items.map(({ id, version, goal, scope, designRefs, dependsOn, criteria }) =>
      ({ id, version, goal, scope, designRefs, dependsOn, criteria })) };
  const result = { resultId: "result", inputDigest: policyHash(router), summary: "A fresh proposed plan.",
    evidenceRefs: ["before"], intent: "plan", candidate };
  assert.equal(parsePrivateResult(result, router).candidate.id, candidate.id);
  candidate.items[0].scope = ["new.js"];
  assert.throws(() => parsePrivateResult(result, router), /retained changed paths/);
  assert.equal(router.approval, null);
});
