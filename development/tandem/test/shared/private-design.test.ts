import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import type { SessionConfig, SessionEvent, ToolInvocation } from '@github/copilot-sdk';
import type { BackboneProposalInput } from '../../runtime-src/domain/backbone/proposal.ts';
import { approvePlan, parsePlanProposal, type DesignRevision } from '../../runtime-src/domain/workflow/change-plan.ts';
import { decodeRecord, encodeRecord } from '../../runtime-src/domain/workflow/foundation-storage.ts';
import { DEFAULT_POLICY, policyHash, resolvePolicy } from '../../runtime-src/domain/workflow/policy.ts';
import { createPolicyGeneration, type PolicySchema } from '../../runtime-src/domain/workflow/policy-contracts.ts';
import {
  isUnpublishedWorkflowDesign, parsePrivateDesignOutput, unpublishedWorkflowDesign, type PrivateDesignOutput,
} from '../../runtime-src/domain/workflow/private-design.ts';
import {
  parsePrivateOwner, parsePrivateResult, parsePrivateSubmission, parsePrivateTask,
  privateResultFields, privateResultKind, type PrivateTask, type PrivateTaskResult,
} from '../../runtime-src/domain/workflow/private-execution-contract.ts';

const owner = parsePrivateOwner({
  ownerId: 'fixture-owner', mainSessionId: 'main', privateSessionId: 'private', repositoryId: 'fixture',
  worktreePath: resolve('mock-private'), targetWorktreePath: resolve('mock-target'), policy: DEFAULT_POLICY,
});
const before = { commit: 'a'.repeat(40), inventoryDigest: 'b'.repeat(64), evidenceRef: 'mock-baseline' };

function output(): PrivateDesignOutput {
  return {
    useCases: ['view-tasks', 'refresh-tasks'].map((id) => ({
      id, title: 'View tasks', actor: 'User', outcome: 'See available tasks.', implementationState: 'planned',
      steps: [{ id: `${id}-step`, userAction: 'Request tasks.', systemResponse: 'Show available tasks.', interactionId: 'list-tasks' }],
    })),
    contract: {
      schemaVersion: 'contract-set/v1', title: 'Task access', context: 'A task application with an unresolved integration.',
      participants: [
        { id: 'user', name: 'User', responsibility: 'Request tasks.' },
        { id: 'application', name: 'Application', responsibility: 'Present available tasks.' },
      ],
      interactions: [{
        id: 'list-tasks', name: 'List tasks', kind: 'query', fromParticipantId: 'user', toParticipantId: 'application',
        input: { name: 'Task request', description: 'Request available tasks.' },
        output: { name: 'Tasks', description: 'Available task entries.' }, errors: [],
        guarantees: [{ id: 'truthful-tasks', statement: 'Do not invent integration data.' }],
        attention: [{
          id: 'integration-choice', impact: 'blocking', question: 'Which task integration should supply the list?',
          whyItMatters: 'The integration and its API contract are not yet known.',
          alternatives: [
            { option: 'Provide an integration contract', implication: 'Validate its actual inputs and outputs first.' },
            { option: 'Use local task entries', implication: 'Avoid an external integration until one is specified.' },
          ],
        }],
      }], storageContracts: [], lifecycleRules: [],
    },
    controlFlows: [{
      id: 'task-flow', title: 'Task display', purpose: 'Request and display tasks.', useCaseIds: ['view-tasks'],
      nodes: [
        { id: 'request-tasks', label: 'Request tasks', kind: 'start', contractKind: 'none', contractId: '' },
        { id: 'receive-tasks', label: 'Receive tasks', kind: 'interaction', contractKind: 'interaction', contractId: 'list-tasks' },
        { id: 'show-tasks', label: 'Show tasks', kind: 'outcome', contractKind: 'none', contractId: '' },
      ],
      edges: [
        { id: 'request-to-receive', fromNodeId: 'request-tasks', toNodeId: 'receive-tasks', label: 'Request' },
        { id: 'receive-to-show', fromNodeId: 'receive-tasks', toNodeId: 'show-tasks', label: 'Available tasks' },
      ],
    }],
    guiSketches: [{
      id: 'task-screen', title: 'Task list', purpose: 'Show available tasks.', useCaseIds: ['view-tasks'],
      regions: [{ id: 'task-list', placement: 'center', label: 'Tasks', elements: [{ kind: 'text', label: 'Available tasks' }] }],
    }],
    systemStacks: [{
      title: 'Task application', layers: [
        { id: 'presentation', name: 'Presentation', responsibility: 'Show tasks.',
          technologies: [{ name: 'Browser', role: 'Render task entries.' }] },
        { id: 'application-layer', name: 'Application', responsibility: 'Provide task access.',
          technologies: [{ name: 'JavaScript', role: 'Coordinate task requests.' }] },
      ],
    }],
    conclusion: {
      goal: 'View tasks without inventing an integration.', summary: 'Task application with an explicit unresolved integration.',
      aspects: [
        { id: 'contract-aspect', kind: 'contract', title: 'Task contract', summary: 'Bounded task access.', relatedElements: ['list-tasks'] },
        { id: 'flow-aspect', kind: 'control-flow', title: 'Task flow', summary: 'Request and receive.', relatedElements: ['task-flow'] },
        { id: 'gui-aspect', kind: 'gui', title: 'Task screen', summary: 'Present tasks.', relatedElements: ['task-screen'] },
        { id: 'system-aspect', kind: 'system', title: 'Task system', summary: 'Two responsibilities.', relatedElements: ['presentation'] },
      ],
      notes: ['No integration API has been assumed.'],
      reviewSummary: {
        headline: 'Task integration remains an explicit choice.',
        changes: [{
          id: 'integration-summary', title: 'Choose integration', description: 'The task data source remains unresolved.',
          whyItMatters: 'Implementation must not invent its API.', visibility: 'visible', perspective: 'contract', elementId: 'list-tasks',
        }],
      },
    },
  };
}

function proposal(): BackboneProposalInput {
  const { conclusion, ...blocks } = output();
  return { ...blocks, goal: conclusion.goal, summary: conclusion.summary, aspects: conclusion.aspects };
}

function task(previousDesign: BackboneProposalInput | null = null, policy = owner.policy): PrivateTask {
  const currentDesign: DesignRevision = previousDesign ? {
    id: 'published-design', complete: true,
    entities: [{ id: 'design:root', digest: policyHash(previousDesign), dependencies: [] }],
  } : unpublishedWorkflowDesign();
  const plan = parsePlanProposal({
    schemaVersion: 'change-plan/v2', id: 'design-plan', version: 1, outcome: 'Propose a Design without editing.',
    designRevisionId: currentDesign.id, baselineDigest: before.inventoryDigest, policyDigest: policy.digest,
    items: [{
      id: 'design-item', version: 1, goal: 'Propose task application behavior.', scope: ['read-only-project'],
      designRefs: currentDesign.entities.map(({ id }) => id), dependsOn: [],
      criteria: [{ id: 'coherent-design', description: 'Return five perspectives and an anchored conclusion.' }],
    }],
  }, policy);
  return {
    taskId: 'design-task', dispatchId: 'design-dispatch', plan, approval: null, itemId: 'design-item',
    originalDesign: currentDesign, currentDesign, acceptedDependencies: [], contextRefs: [before.evidenceRef],
    constraints: ['Read only; no canonical effects or integration.'], before, assessmentOnly: { scope: ['read-only-project'] },
    design: { requestId: 'design-request', message: 'Design a task application.',
      previousRevisionId: previousDesign ? currentDesign.id : null, previousDesign },
  };
}

function result(input: PrivateTask): PrivateTaskResult {
  return {
    resultId: 'design-result', inputDigest: policyHash(input), summary: 'Proposed task application with unresolved integration.',
    evidenceRefs: ['mock-request-evidence'], design: output(),
  };
}

test('initial read-only Design accepts five perspectives, conclusion and Attention across retained replay', () => {
  const input = parsePrivateTask(task(), owner);
  assert.equal(privateResultKind(input), 'design');
  const parsed = parsePrivateSubmission(result(input), input);
  assert.deepEqual(parsed.design, output());
  const replay = decodeRecord(encodeRecord({ input, result: parsed })) as { input: PrivateTask; result: PrivateTaskResult };
  const replayTask = parsePrivateTask(replay.input, owner);
  assert.deepEqual(parsePrivateResult(replay.result, replayTask), parsed);
  assert.equal(replayTask.approval, null);
  assert.deepEqual(replayTask.currentDesign, { id: 'unpublished-design', complete: false, entities: [] });
});

test('Design output rejects invalid cross-references, summary anchors, unknown fields and lifecycle claims', () => {
  const invalid = output();
  invalid.useCases[0]!.steps[0]!.interactionId = 'missing-interaction';
  assert.throws(() => parsePrivateDesignOutput(invalid, owner.policy), /interaction/i);
  const summary = output();
  summary.conclusion.reviewSummary!.changes[0]!.elementId = 'unknown';
  assert.throws(() => parsePrivateDesignOutput(summary, owner.policy), /anchor/i);
  const flow = output();
  flow.controlFlows[0]!.useCaseIds = ['missing-use-case'];
  assert.throws(() => parsePrivateDesignOutput(flow, owner.policy), /use.case/i);
  assert.throws(() => parsePrivateDesignOutput({ ...output(), publication: 'accepted' }, owner.policy), /fields/);
  const nested = output();
  Object.assign(nested.contract.interactions[0]!, { endpoint: '/invented-api' });
  assert.throws(() => parsePrivateDesignOutput(nested, owner.policy), /does not allow endpoint/);
  const missing = output();
  delete missing.conclusion.reviewSummary;
  assert.throws(() => parsePrivateDesignOutput(missing, owner.policy), /reviewSummary/);
  for (const state of ['in-progress', 'implemented', 'verified'] as const) {
    const claimed = output();
    claimed.useCases[0]!.implementationState = state;
    assert.throws(() => parsePrivateDesignOutput(claimed, owner.policy), /cannot claim/);
  }
});

test('explicit unpublished Design permits only Router or Design assessments, never planner or editing', () => {
  assert.equal(isUnpublishedWorkflowDesign(unpublishedWorkflowDesign()), true);
  for (const value of [
    null, {}, { ...unpublishedWorkflowDesign(), complete: true }, { ...unpublishedWorkflowDesign(), extra: true },
    { id: 'other', complete: false, entities: [] },
  ]) assert.equal(isUnpublishedWorkflowDesign(value), false);
  const { design: _design, ...base } = task();
  const router = { ...base, coordination: { kind: 'router', requestId: 'route', message: 'Start a task app.' } };
  assert.ok(parsePrivateTask(router, owner).coordination);
  assert.throws(() => parsePrivateTask({ ...router, coordination: { ...router.coordination, kind: 'planner' } }, owner), /expectations/);
  assert.throws(() => parsePrivateTask(base, owner), /expectations/);
  const approval = approvePlan(base.plan, {
    planId: base.plan.id, planVersion: base.plan.version, planDigest: base.plan.digest,
    items: base.plan.items.map(({ id, version, digest }) => ({ id, version, digest })),
  }, 'not-editing-authority');
  const { assessmentOnly: _assessment, ...edit } = base;
  assert.throws(() => parsePrivateTask({ ...edit, approval }, owner), /Design impact/);
  assert.throws(() => parsePrivateTask({
    ...base, currentDesign: { ...base.currentDesign, complete: true },
    originalDesign: { ...base.originalDesign, complete: true },
  }, owner), /never a completed seed/);
  assert.throws(() => parsePrivateTask({ ...task(), assessmentOnly: undefined }, owner), /object/);
  assert.throws(() => parsePrivateTask({ ...task(), approval }, owner), /no editing approval/);
  assert.throws(() => parsePrivateTask({ ...task(), coordination: router.coordination }, owner), /cannot also/);
  assert.throws(() => parsePrivateTask({ ...task(), review: {} }, owner), /cannot also/);
  assert.throws(() => parsePrivateTask({
    ...task(), acceptedDependencies: [{ id: 'other', version: 1, digest: 'not-accepted' }],
  }, owner), /expectations/);
});

test('revision Design validates full previous proposal and exact revision root digest', () => {
  const input = task(proposal());
  assert.deepEqual(parsePrivateTask(input, owner), input);
  const digest = structuredClone(input);
  digest.currentDesign.entities[0]!.digest = 'wrong';
  digest.originalDesign = digest.currentDesign;
  assert.throws(() => parsePrivateTask(digest, owner), /identity\/digest/);
  const id = structuredClone(input);
  id.design!.previousRevisionId = 'stale';
  assert.throws(() => parsePrivateTask(id, owner), /identity\/digest/);
  const previous = structuredClone(input);
  previous.design!.previousDesign!.useCases[0]!.steps[0]!.interactionId = 'unknown';
  assert.throws(() => parsePrivateTask(previous, owner), /interaction/i);
  assert.throws(() => parsePrivateTask({ ...input, design: { ...input.design, previousDesign: null } }, owner), /unpublished/);
  assert.throws(() => parsePrivateTask({
    ...task(), design: { ...task().design, previousRevisionId: 'invented-published-id' },
  }, owner), /unpublished/);
});

test('Design result has strict role-specific fields and cannot masquerade as another role', () => {
  const input = task();
  const base = ['resultId', 'inputDigest', 'summary', 'evidenceRefs'];
  assert.deepEqual(privateResultFields('implementation'), base);
  assert.deepEqual(privateResultFields('router'), [...base, 'intent', 'candidate']);
  assert.deepEqual(privateResultFields('planner'), [...base, 'candidate']);
  assert.deepEqual(privateResultFields('review'), [...base, 'review']);
  assert.deepEqual(privateResultFields('design'), [...base, 'design']);
  assert.throws(() => parsePrivateResult({ ...result(input), candidate: null }, input), /fields/);
  const { design: _design, ...missing } = result(input);
  assert.throws(() => parsePrivateResult(missing, input), /fields/);
  assert.throws(() => parsePrivateResult({ ...result(input), inputDigest: 'stale' }, input), /exact task/);
  const { design: _tag, ...assessment } = task(proposal());
  assert.throws(() => parsePrivateResult({ ...result(assessment) }, assessment), /fields/);
});

test('revision output preserves exact prior lifecycle states but cannot assign progress or regress them', () => {
  for (const state of ['in-progress', 'implemented', 'verified'] as const) {
    const previous = proposal();
    previous.useCases[0]!.implementationState = state;
    const input = parsePrivateTask(task(previous), owner);
    const matching = result(input);
    matching.design!.useCases[0]!.implementationState = state;
    assert.deepEqual(parsePrivateSubmission(matching, input), matching);
    const replay = decodeRecord(encodeRecord(matching));
    assert.deepEqual(parsePrivateResult(replay, input), matching);
    const omitted = structuredClone(matching);
    delete omitted.design!.useCases[0]!.implementationState;
    assert.deepEqual(parsePrivateSubmission(omitted, input), omitted);
    const regressed = structuredClone(matching);
    regressed.design!.useCases[0]!.implementationState = 'planned';
    assert.throws(() => parsePrivateSubmission(regressed, input), /cannot claim or change/);
    const progressed = structuredClone(matching);
    progressed.design!.useCases[0]!.implementationState = state === 'verified' ? 'implemented' : 'verified';
    assert.throws(() => parsePrivateSubmission(progressed, input), /cannot claim or change/);
    const added = structuredClone(matching);
    added.design!.useCases.push({
      id: 'new-task-use-case', title: 'New task view', actor: 'User', outcome: 'See available tasks.',
      implementationState: state,
      steps: [{ id: 'new-task-step', userAction: 'Request tasks.', systemResponse: 'Show tasks.', interactionId: 'list-tasks' }],
    });
    assert.throws(() => parsePrivateSubmission(added, input), /cannot claim or change/);
    added.design!.useCases.at(-1)!.implementationState = 'planned';
    assert.deepEqual(parsePrivateSubmission(added, input), added);
  }
});
