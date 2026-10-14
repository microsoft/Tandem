import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { parsePlanProposal, planLineage } from '../../runtime-src/domain/workflow/change-plan.ts';
import { DEFAULT_POLICY, policyHash } from '../../runtime-src/domain/workflow/policy.ts';
import { parsePrivateResult, parsePrivateSubmission, parsePrivateTask, type PrivateTask } from '../../runtime-src/domain/workflow/private-execution-contract.ts';

const design = { id: 'current-design', complete: true, entities: [{ id: 'design:root', digest: 'current-semantics', dependencies: [] }] };
const before = { commit: 'a'.repeat(40), inventoryDigest: 'b'.repeat(64), evidenceRef: 'fixture' };
const proposal = (version: number, id = 'existing-plan') => ({
  schemaVersion: 'change-plan/v2', id, version, outcome: 'Bounded plan.',
  designRevisionId: design.id, baselineDigest: before.inventoryDigest, policyDigest: DEFAULT_POLICY.digest,
  items: [{ id: 'work', version: 1, goal: 'Implement the agreed behavior.', scope: ['app.js'], designRefs: ['design:root'],
    dependsOn: [], criteria: [{ id: 'correct', description: 'The agreed behavior works.' }] }],
});

for (const kind of ['router', 'planner'] as const) test(`${kind} checks pinned lineage before staging, with exact reuse and immutable version rules`, () => {
  const prior = parsePlanProposal(proposal(1), DEFAULT_POLICY);
  const current = parsePlanProposal(proposal(3), DEFAULT_POLICY);
  const lineage = planLineage([prior, null, current])!;
  assert.deepEqual(lineage, { planId: 'existing-plan', afterVersion: 3 });
  const task: PrivateTask = {
    taskId: 'task', dispatchId: 'dispatch', plan: parsePlanProposal(proposal(1, 'coordination'), DEFAULT_POLICY),
    approval: null, itemId: 'work', originalDesign: design, currentDesign: design, before,
    acceptedDependencies: [], contextRefs: [], constraints: [], assessmentOnly: { scope: ['app.js'] },
    coordination: { kind, requestId: 'request', message: 'Replan without approval.', planLineage: lineage },
  };
  const result = (candidate: ReturnType<typeof proposal>, input = task) => ({
    resultId: 'result', inputDigest: policyHash(input), summary: 'Candidate.', evidenceRefs: ['fixture'],
    ...(kind === 'router' ? { intent: 'plan' } : {}), candidate,
  });
  for (const invalid of [proposal(1, 'new-plan'), proposal(3), proposal(2), proposal(100, 'new-plan')]) {
    assert.doesNotThrow(() => parsePrivateResult(result(invalid), task), 'Historical stored output retains its old readable contract.');
    assert.throws(() => parsePrivateSubmission(result(invalid), task), /existing-plan.*version greater than 3/);
  }
  assert.equal(parsePrivateSubmission(result(proposal(4)), task).candidate!.version, 4);
  const reusable: PrivateTask = { ...task, coordination: { ...task.coordination!, planLineage: { ...lineage, reusableDigest: current.digest } } };
  assert.equal(parsePrivateSubmission(result(proposal(3), reusable), reusable).candidate!.version, 3);
  const changed = proposal(3);
  changed.items[0]!.goal = 'Changed same-version content.';
  assert.throws(() => parsePrivateSubmission(result(changed, reusable), reusable), /strictly newer/);
  const owner = {
    ownerId: 'owner', mainSessionId: 'main', privateSessionId: 'private', repositoryId: 'fixture',
    worktreePath: resolve('lineage-source'), targetWorktreePath: resolve('lineage-target'), policy: DEFAULT_POLICY,
  };
  assert.equal(policyHash(parsePrivateTask(reusable, owner)), policyHash(reusable));
  assert.throws(() => parsePrivateTask({ ...reusable, coordination: { ...reusable.coordination, kind: 'agent' } }, owner), /Only planning roles/);
  assert.throws(() => parsePrivateTask({ ...reusable, coordination: {
    ...reusable.coordination, planLineage: { planId: 'existing-plan', afterVersion: 0 },
  } }, owner), /integer/);
});
