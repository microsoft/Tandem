import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { parsePlanProposal } from '../../runtime-src/domain/workflow/change-plan.ts';
import { DEFAULT_POLICY, policyHash } from '../../runtime-src/domain/workflow/policy.ts';
import { unpublishedWorkflowDesign } from '../../runtime-src/domain/workflow/private-design.ts';
import {
  parsePrivateOwner, parsePrivateResult, parsePrivateTask, privateResultFields, privateResultKind,
} from '../../runtime-src/domain/workflow/private-execution-contract.ts';

const owner = parsePrivateOwner({
  ownerId: 'agent-owner', mainSessionId: 'main', privateSessionId: 'private', repositoryId: 'project',
  worktreePath: resolve('agent-private-fixture'), targetWorktreePath: resolve('agent-target-fixture'),
  policy: DEFAULT_POLICY,
});

function input() {
  const design = unpublishedWorkflowDesign();
  const before = { commit: 'a'.repeat(40), inventoryDigest: 'b'.repeat(64), evidenceRef: 'retained-baseline' };
  const plan = parsePlanProposal({
    schemaVersion: 'change-plan/v2', id: 'readonly-agent-input', version: 1,
    outcome: 'Investigate existing code without editing or planning implementation.',
    designRevisionId: design.id, baselineDigest: before.inventoryDigest, policyDigest: owner.policy.digest,
    items: [{
      id: 'investigate', version: 1, goal: 'Explain the request handler.',
      scope: ['read-only-project'], designRefs: [], dependsOn: [],
      criteria: [{ id: 'grounded-report', description: 'Return findings with evidence.' }],
    }],
  }, owner.policy);
  return {
    taskId: 'agent-task', dispatchId: 'agent-dispatch', plan, approval: null, itemId: 'investigate',
    originalDesign: design, currentDesign: design, acceptedDependencies: [],
    contextRefs: [before.evidenceRef], constraints: ['Do not edit files or publish a plan.'], before,
    assessmentOnly: { scope: ['read-only-project'] },
    coordination: { kind: 'agent', requestId: 'source-request', message: 'Explain the request handler; do not fix it.' },
  };
}

test('a read-only Agent task is valid without a published Design or editing approval', () => {
  const task = parsePrivateTask(input(), owner);
  assert.equal(task.approval, null);
  assert.equal(task.coordination?.kind, 'agent');
  assert.equal(task.currentDesign.complete, false);
  assert.equal(privateResultKind(task), 'agent');
  assert.deepEqual(privateResultFields('agent'), ['resultId', 'inputDigest', 'summary', 'evidenceRefs', 'report']);
});

test('Agent reports cannot impersonate a plan, Design, review or implementation result', () => {
  const task = parsePrivateTask(input(), owner);
  const result = {
    resultId: 'agent-result', inputDigest: policyHash(task), summary: 'The handler validates before writing.',
    evidenceRefs: ['retained-baseline'], report: 'The request handler reads the input, validates it, then returns a response. No files were changed.',
  };
  const parsed = parsePrivateResult(result, task);
  assert.equal(parsed.report, result.report);
  assert.equal(parsed.candidate, undefined);
  assert.equal(parsed.intent, undefined);
  assert.equal(parsed.design, undefined);
  assert.equal(parsed.review, undefined);
  for (const field of ['candidate', 'intent', 'design', 'review', 'approval', 'implementationState']) {
    assert.throws(() => parsePrivateResult({ ...result, [field]: null }, task), /does not allow|exactly these fields/i);
  }
  assert.throws(() => parsePrivateResult({ ...result, inputDigest: 'c'.repeat(64) }, task), /exact task/i);
  assert.throws(() => parsePrivateResult({ ...result, report: ' ' }, task));
  assert.throws(() => parsePrivateResult({
    ...result, report: 'x'.repeat(task.plan.policy.values.resources.requestBytes + 1),
  }, task), /report.*bound|bound.*report/i);
});

test('an Agent task cannot request editing approval or combine roles', () => {
  const task = input();
  assert.throws(() => parsePrivateTask({ ...task, assessmentOnly: undefined }, owner));
  assert.throws(() => parsePrivateTask({ ...task, approval: {} }, owner));
  assert.throws(() => parsePrivateTask({
    ...task, design: { requestId: 'request', message: 'Change Design', previousRevisionId: null, previousDesign: null },
  }, owner), /also coordinate|read-only/i);
});
