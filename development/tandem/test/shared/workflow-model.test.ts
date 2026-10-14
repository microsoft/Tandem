import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessImpact, itemEligibility, parsePlanProposal, type DesignRevision,
} from '../../runtime-src/domain/workflow/change-plan.ts';
import {
  createWorkflowOperation, decideWorkflow, editingAllowed,
  type Authority, type WorkflowOperation,
} from '../../runtime-src/domain/workflow/operation.ts';
import { DEFAULT_POLICY, resolvePolicy, type PolicySnapshot } from '../../runtime-src/domain/workflow/policy.ts';

function design(): DesignRevision {
  return {
    id: 'design-1', complete: true,
    entities: [
      { id: 'contract:save', digest: 'save-v1', dependencies: ['system:storage'] },
      { id: 'system:storage', digest: 'storage-v1', dependencies: [] },
      { id: 'gui:unrelated', digest: 'screen-v1', dependencies: [] },
    ],
  };
}

function proposal(policy: PolicySnapshot = DEFAULT_POLICY) {
  return {
    schemaVersion: 'change-plan/v2', id: 'plan-1', version: 1, outcome: 'Save records safely.',
    designRevisionId: 'design-1', baselineDigest: 'before', policyDigest: policy.digest,
    items: [{
      id: 'add-storage-check', version: 1, goal: 'Check storage input.',
      scope: ['src\\storage.ts'], designRefs: ['contract:save'], dependsOn: [] as string[],
      criteria: [{ id: 'reject-invalid-input', description: 'Invalid input is rejected.' }],
    }],
  };
}

class Scenario {
  state: WorkflowOperation;
  sequence = 0;

  constructor(policy: PolicySnapshot = DEFAULT_POLICY) {
    this.state = createWorkflowOperation('operation-1', 'session-1', design(), 'before', policy);
  }

  input(type: string, data: unknown = {}) {
    return {
      schemaVersion: 'workflow-input/v2', operationId: this.state.id,
      id: `input-${++this.sequence}`, expectedRevision: this.state.revision, type, data,
    };
  }

  act(authority: Authority, type: string, data: unknown = {}) {
    const intent = decideWorkflow(this.state, authority, this.input(type, data));
    this.state = intent.next;
    return intent;
  }

  prepare(itemId: string | null = null) {
    this.act('host', 'prepare-task', { dispatchId: `dispatch-${this.sequence}`, itemId });
  }

  send() {
    this.act('host', 'send-attempted', { dispatchId: this.state.dispatch!.id });
  }

  start() {
    this.act('runtime', 'execution-started', {
      dispatchId: this.state.dispatch!.id, sessionId: 'session-1',
      executionId: `execution-${this.sequence}`, evidenceId: `start-${this.sequence}`,
    });
  }

  end(aborted = false) {
    this.act('runtime', 'execution-ended', {
      dispatchId: this.state.dispatch!.id, sessionId: 'session-1',
      executionId: this.state.dispatch!.executionId, evidenceId: `end-${this.sequence}`, aborted,
    });
  }

  router() {
    this.act('user', 'request');
    this.prepare();
    this.send();
    this.start();
  }

  propose(plan = proposal(this.state.policy)) {
    this.router();
    this.act('agent', 'submit-plan', { dispatchId: this.state.dispatch!.id, plan });
    this.end();
    this.act('host', 'route-applied');
    this.act('host', 'publish-plan');
  }

  approval() {
    const plan = this.state.plan!;
    return {
      planId: plan.id, planVersion: plan.version, planDigest: plan.digest,
      items: plan.items.map(({ id, version, digest }) => ({ id, version, digest })),
    };
  }

  approve() {
    this.act('user', 'approve-plan', { approval: this.approval() });
  }

  implement() {
    this.prepare(this.state.plan!.items[0]!.id);
    this.send();
    this.start();
  }

  review(changedPaths = ['src\\storage.ts']) {
    this.end();
    this.act('host', 'begin-capture');
    this.act('host', 'save-snapshot', {
      snapshotId: `snapshot-${this.sequence}`,
      baselineDigest: this.state.expectedBaselineDigest,
      afterDigest: changedPaths.length ? `after-${this.sequence}` : this.state.expectedBaselineDigest,
      changedPaths,
      outOfScopePaths: changedPaths.filter((path) => !this.state.plan!.items[0]!.scope.includes(path)),
    });
    this.prepare();
    this.send();
    this.start();
  }

  result(satisfied = true) {
    return {
      id: `result-${this.sequence}`, snapshotId: this.state.snapshot!.id,
      planDigest: this.state.plan!.digest,
      itemDigest: this.state.plan!.items[0]!.digest,
      criteria: this.state.plan!.items[0]!.criteria.map(({ id }) => ({
        id, satisfied, evidence: satisfied ? ['evidence:targeted-assertion'] : [],
      })),
      accountedPaths: this.state.snapshot!.changedPaths,
      outOfScopePaths: [...this.state.snapshot!.outOfScopePaths], blockers: [] as string[],
    };
  }

  submit(result = this.result()) {
    this.act('agent', 'submit-review', { dispatchId: this.state.dispatch!.id, result });
    this.act('host', 'persist-review-result', { resultId: result.id });
  }

  apply() {
    this.act('host', 'effects-applied', { resultId: this.state.savedReview!.id, receiptId: `receipt-${this.sequence}` });
  }
}

function reviewing(plan = proposal(), changedPaths?: string[], policy = DEFAULT_POLICY) {
  const scenario = new Scenario(policy);
  scenario.propose(plan);
  scenario.approve();
  scenario.implement();
  scenario.review(changedPaths);
  return scenario;
}

test('small inline plan is a proposal, not permission to edit or a completed task', () => {
  const scenario = new Scenario();
  scenario.router();
  scenario.act('agent', 'submit-plan', { dispatchId: scenario.state.dispatch!.id, plan: proposal() });
  assert.equal(scenario.state.phase, 'Routing');
  assert.equal(editingAllowed(scenario.state), false);
  assert.throws(() => scenario.act('host', 'route-applied'), /termination/);
  scenario.end();
  scenario.act('host', 'route-applied');
  scenario.act('host', 'publish-plan');
  assert.equal(scenario.state.phase, 'AwaitingApproval');
  assert.equal(scenario.state.approval, null);
  assert.throws(() => scenario.prepare('add-storage-check'), /cannot prepare/);
  scenario.approve();
  assert.equal(scenario.state.phase, 'ImplementationQueued');
  assert.equal(scenario.state.budget.startedAttempts, 0);
  assert.equal(editingAllowed(scenario.state), false);
});

for (const [label, mutate] of [
  ['wrong version', (approval: ReturnType<Scenario['approval']>) => { approval.planVersion += 1; }],
  ['wrong plan digest', (approval: ReturnType<Scenario['approval']>) => { approval.planDigest = 'stale'; }],
  ['wrong item digest', (approval: ReturnType<Scenario['approval']>) => { approval.items[0]!.digest = 'stale'; }],
  ['missing item', (approval: ReturnType<Scenario['approval']>) => { approval.items = []; }],
  ['duplicate item', (approval: ReturnType<Scenario['approval']>) => { approval.items.push(approval.items[0]!); }],
] as const) {
  test(`rejects ambiguous/stale approval: ${label}`, () => {
    const scenario = new Scenario();
    scenario.propose();
    const approval = scenario.approval();
    mutate(approval);
    const before = structuredClone(scenario.state);
    assert.throws(() => scenario.act('user', 'approve-plan', { approval }), /approval/);
    assert.deepEqual(scenario.state, before);
    assert.equal(editingAllowed(scenario.state), false);
  });
}

test('agents cannot choose a state, impersonate user approval, or claim Host effect completion', () => {
  const scenario = new Scenario();
  scenario.propose();
  for (const [type, data] of [
    ['approve-plan', { approval: scenario.approval() }],
    ['effects-applied', { resultId: 'result', receiptId: 'receipt' }],
    ['restore', {}],
  ] as const) {
    assert.throws(() => scenario.act('agent', type, data), /authority/);
  }
  assert.throws(() => scenario.act('agent', 'set_state', { next_state: 'Implementing' }), /expected one of/);
  assert.throws(() => parsePlanProposal({ ...proposal(), next_state: 'Implementing' }, DEFAULT_POLICY), /does not allow/);
  const nested = proposal();
  Object.assign(nested.items[0]!, { next_state: 'Completed' });
  assert.throws(() => parsePlanProposal(nested, DEFAULT_POLICY), /does not allow/);
});

test('proposal validation rejects unknown/cyclic dependencies and missing criteria', () => {
  for (const dependency of ['missing-item', 'add-storage-check']) {
    const plan = proposal();
    plan.items[0]!.dependsOn = [dependency];
    assert.throws(() => parsePlanProposal(plan, DEFAULT_POLICY), /dependency|acyclic/);
  }
  const plan = proposal();
  plan.items[0]!.criteria = [];
  assert.throws(() => parsePlanProposal(plan, DEFAULT_POLICY), /criteria/);
});

test('enqueue acknowledgement is not execution; late acknowledgement cannot regress a running task', () => {
  const scenario = new Scenario();
  scenario.propose();
  scenario.approve();
  scenario.prepare('add-storage-check');
  scenario.send();
  const ack = { dispatchId: scenario.state.dispatch!.id, sessionId: 'session-1', messageId: 'sdk-message' };
  scenario.act('runtime', 'dispatch-acknowledged', ack);
  assert.equal(scenario.state.phase, 'ImplementationQueued');
  assert.equal(editingAllowed(scenario.state), false);
  scenario.start();
  scenario.act('runtime', 'dispatch-acknowledged', ack);
  assert.equal(scenario.state.phase, 'Implementing');
  assert.equal(scenario.state.budget.startedAttempts, 1);
  assert.equal(editingAllowed(scenario.state), true);
});

test('runtime can start before send resolves; foreign session, dispatch and end are rejected', () => {
  const scenario = new Scenario();
  scenario.propose();
  scenario.approve();
  scenario.prepare('add-storage-check');
  scenario.send();
  for (const override of [{ sessionId: 'foreign' }, { dispatchId: 'foreign' }]) {
    assert.throws(() => scenario.act('runtime', 'execution-started', {
      dispatchId: scenario.state.dispatch!.id, sessionId: 'session-1',
      executionId: 'root', evidenceId: 'event', ...override,
    }), /match/);
  }
  scenario.start();
  assert.throws(() => scenario.act('runtime', 'execution-ended', {
    dispatchId: scenario.state.dispatch!.id, sessionId: 'session-1',
    executionId: 'foreign', evidenceId: 'end', aborted: false,
  }), /match/);
  assert.throws(() => scenario.act('runtime', 'session.idle'), /expected one of/);
  assert.throws(() => scenario.act('host', 'begin-capture'), /termination/);
});

test('accepted Review output, persisted result, execution end and applied effects are separate facts', () => {
  const scenario = reviewing();
  const result = scenario.result();
  scenario.act('agent', 'submit-review', { dispatchId: scenario.state.dispatch!.id, result });
  assert.equal(scenario.state.phase, 'Reviewing');
  assert.equal(scenario.state.savedReview, null);
  assert.deepEqual(scenario.state.acceptedItems, []);
  scenario.act('host', 'persist-review-result', { resultId: result.id });
  assert.equal(scenario.state.phase, 'ApplyingResult');
  assert.throws(() => scenario.apply(), /termination/);
  assert.throws(() => scenario.act('agent', 'effects-applied', { resultId: result.id, receiptId: 'forged' }), /host authority/);
  scenario.end();
  assert.deepEqual(scenario.state.acceptedItems, []);
  scenario.apply();
  assert.equal(scenario.state.phase, 'Completed');
  assert.equal(scenario.state.acceptedItems.length, 1);
  assert.equal(scenario.state.reviews[0]!.result.id, result.id);
  assert.equal(scenario.state.reviews[0]!.snapshot.id, result.snapshotId);
});

for (const [label, mutate] of [
  ['next_state', (result: ReturnType<Scenario['result']>) => Object.assign(result, { next_state: 'Completed' })],
  ['missing change accounting', (result: ReturnType<Scenario['result']>) => { result.accountedPaths = []; }],
  ['missing criterion evidence', (result: ReturnType<Scenario['result']>) => { result.criteria[0]!.evidence = []; }],
  ['wrong snapshot', (result: ReturnType<Scenario['result']>) => { result.snapshotId = 'foreign'; }],
  ['wrong plan', (result: ReturnType<Scenario['result']>) => { result.planDigest = 'foreign'; }],
] as const) {
  test(`invalid Review remains incomplete: ${label}`, () => {
    const scenario = reviewing();
    const result = scenario.result();
    mutate(result);
    assert.throws(() => scenario.submit(result), /Workflow:/);
    assert.equal(scenario.state.phase, 'Reviewing');
    assert.equal(scenario.state.savedReview, null);
    scenario.end();
    assert.throws(() => scenario.act('host', 'persist-review-result', { resultId: result.id }), /missing/);
  });
}

for (const satisfied of [true, false]) {
  test(`zero-change work needs explicit criterion assessment (satisfied=${satisfied})`, () => {
    const scenario = reviewing(proposal(), []);
    assert.deepEqual(scenario.state.acceptedItems, []);
    scenario.submit(scenario.result(satisfied));
    scenario.end();
    scenario.apply();
    assert.equal(scenario.state.phase, satisfied ? 'Completed' : 'ImplementationQueued');
    assert.equal(scenario.state.acceptedItems.length, satisfied ? 1 : 0);
  });
}

test('out-of-scope changes are accounted but never retroactively approved', () => {
  const scenario = reviewing(proposal(), ['src\\storage.ts', 'docs\\guide.md']);
  const result = scenario.result();
  result.outOfScopePaths = ['docs\\guide.md'];
  scenario.submit(result);
  scenario.end();
  scenario.apply();
  assert.equal(scenario.state.phase, 'Blocked');
  assert.match(scenario.state.blocker!, /Out-of-scope/);
  assert.deepEqual(scenario.state.acceptedItems, []);
  assert.equal(scenario.state.reviews[0]!.snapshot.changedPaths.length, 2);
});

test('restore retains queued uncertainty and cannot dispatch, apply or reset counters', () => {
  const scenario = new Scenario();
  scenario.propose();
  scenario.approve();
  scenario.prepare('add-storage-check');
  scenario.send();
  const phase = scenario.state.phase;
  scenario.act('host', 'restore');
  assert.equal(scenario.state.phase, phase);
  assert.throws(() => scenario.act('user', 'resume'), /termination/);
  assert.throws(() => scenario.send(), /Resume/);
  assert.throws(() => scenario.prepare('add-storage-check'), /Resume/);
  scenario.act('runtime', 'dispatch-not-delivered', {
    dispatchId: scenario.state.dispatch!.id, sessionId: 'session-1', evidenceId: 'verified-absence',
  });
  scenario.act('user', 'resume');
  assert.equal(scenario.state.dispatch, null);
  assert.equal(scenario.state.budget.startedAttempts, 0);
  scenario.implement();
  assert.equal(scenario.state.budget.startedAttempts, 1);
});

test('restore preserves a saved result and Resume applies only that boundary', () => {
  const plan = proposal();
  plan.items.push({ ...plan.items[0]!, id: 'second-work-item' });
  const scenario = reviewing(plan);
  scenario.submit();
  scenario.end();
  const saved = structuredClone(scenario.state.savedReview);
  scenario.act('host', 'restore');
  assert.equal(scenario.state.phase, 'ApplyingResult');
  assert.throws(() => scenario.apply(), /Resume/);
  assert.throws(() => scenario.prepare(), /Resume/);
  scenario.act('user', 'resume');
  scenario.apply();
  assert.equal(scenario.state.phase, 'Blocked');
  assert.equal(scenario.state.dispatch, null);
  assert.deepEqual(scenario.state.reviews[0]!.result, saved);
  assert.equal(scenario.state.budget.startedAttempts, 1);
  scenario.act('user', 'resume');
  assert.equal(scenario.state.phase, 'ImplementationQueued');
});

test('interrupted implementation retains edits obligation and budget, not a blind editing replay', () => {
  const scenario = new Scenario();
  scenario.propose();
  scenario.approve();
  scenario.implement();
  scenario.end(true);
  assert.equal(scenario.state.phase, 'Implementing');
  assert.equal(scenario.state.budget.startedAttempts, 1);
  assert.equal(editingAllowed(scenario.state), false);
  assert.throws(() => scenario.prepare('add-storage-check'), /Resume/);
  scenario.act('user', 'resume');
  assert.throws(() => scenario.prepare('add-storage-check'), /previous dispatch/);
  scenario.act('host', 'begin-capture');
  assert.equal(scenario.state.phase, 'CapturingChanges');
});

test('cancellation before dispatch needs no execution; queued uncertainty cannot be called cancelled', () => {
  for (const sent of [false, true]) {
    const scenario = new Scenario();
    scenario.propose();
    scenario.approve();
    scenario.prepare('add-storage-check');
    if (sent) scenario.send();
    scenario.act('user', 'request-cancel');
    if (sent) {
      assert.throws(() => scenario.act('host', 'finalize-cancellation', { receiptId: 'cancelled' }), /termination/);
      assert.equal(scenario.state.phase, 'ImplementationQueued');
    } else {
      scenario.act('host', 'finalize-cancellation', { receiptId: 'cancelled' });
      assert.equal(scenario.state.phase, 'Cancelled');
    }
  }
});

test('cancellation after edits requires a snapshot and retains a parked Review obligation', () => {
  const scenario = new Scenario();
  scenario.propose();
  scenario.approve();
  scenario.implement();
  scenario.act('user', 'request-cancel');
  assert.equal(editingAllowed(scenario.state), false);
  scenario.end(true);
  assert.throws(() => scenario.act('host', 'finalize-cancellation', { receiptId: 'cancelled' }), /captured/);
  scenario.act('host', 'begin-capture');
  scenario.act('host', 'save-snapshot', {
    snapshotId: 'partial', baselineDigest: 'before', afterDigest: 'partial-after', changedPaths: ['src\\storage.ts'],
    outOfScopePaths: [],
  });
  scenario.act('host', 'finalize-cancellation', { receiptId: 'cancelled' });
  assert.equal(scenario.state.phase, 'Cancelled');
  assert.equal(scenario.state.snapshot!.id, 'partial');
  assert.deepEqual(scenario.state.acceptedItems, []);
});

test('item blocker closes editing but partial changes still reach typed Review', () => {
  const scenario = new Scenario();
  scenario.propose();
  scenario.approve();
  scenario.implement();
  scenario.act('agent', 'report-blocker', {
    dispatchId: scenario.state.dispatch!.id, itemDigest: scenario.state.plan!.items[0]!.digest,
    reason: 'A product decision is required.',
  });
  assert.equal(editingAllowed(scenario.state), false);
  scenario.review();
  scenario.submit();
  scenario.end();
  scenario.apply();
  assert.equal(scenario.state.phase, 'Blocked');
  assert.deepEqual(scenario.state.acceptedItems, []);
});

for (const kind of ['unrelated', 'dependency', 'unknown', 'missing'] as const) {
  test(`design impact proof: ${kind}`, () => {
    const item = parsePlanProposal(proposal(), DEFAULT_POLICY).items[0]!;
    const before = design();
    const after = design();
    after.id = 'design-2';
    if (kind === 'unrelated') after.entities[2]!.digest = 'new-screen';
    if (kind === 'dependency') after.entities[1]!.digest = 'new-storage';
    if (kind === 'unknown') after.complete = false;
    if (kind === 'missing') after.entities.splice(1, 1);
    const result = assessImpact(item, before, after);
    assert.equal(result.status, kind === 'unrelated' ? 'unaffected' : kind === 'dependency' ? 'affected' : 'unknown');
  });
}

test('unknown impact, changed baseline and changed policy fail closed before editing', () => {
  for (const change of ['impact', 'baseline', 'policy']) {
    const scenario = new Scenario();
    scenario.propose();
    scenario.approve();
    scenario.prepare('add-storage-check');
    const nextDesign = design();
    if (change === 'impact') nextDesign.complete = false;
    const observation = {
      design: nextDesign, baselineDigest: change === 'baseline' ? 'external-edit' : 'before',
      policyDigest: change === 'policy' ? 'policy-2' : DEFAULT_POLICY.digest,
    };
    if (change === 'policy') {
      assert.throws(() => scenario.act('host', 'inputs-observed', observation), /policy adoption/);
      assert.equal(scenario.state.policyDigest, DEFAULT_POLICY.digest);
    } else {
      scenario.act('host', 'inputs-observed', observation);
      assert.throws(() => scenario.send(), /unknown|changed/);
    }
    assert.equal(editingAllowed(scenario.state), false);
  }
});

test('dependency acceptance binds exact work-item version, not product Use-case state', () => {
  const input = proposal();
  input.items.push({ ...input.items[0]!, id: 'dependent', dependsOn: ['add-storage-check'] });
  const scenario = new Scenario();
  scenario.propose(input);
  scenario.approve();
  const plan = scenario.state.plan!;
  const dependent = plan.items[1]!;
  assert.match(itemEligibility(plan, dependent, scenario.state.approval, design(), design(), [])!, /dependency/);
  assert.match(itemEligibility(plan, dependent, scenario.state.approval, design(), design(), [
    { id: plan.items[0]!.id, version: 9, digest: plan.items[0]!.digest },
  ])!, /dependency/);
  assert.equal(itemEligibility(plan, dependent, scenario.state.approval, design(), design(), [
    { id: plan.items[0]!.id, version: 1, digest: plan.items[0]!.digest },
  ]), undefined);
});

test('two no-progress reviews stop continuation and Resume cannot reset the budget', () => {
  const scenario = reviewing();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt) {
      scenario.implement();
      scenario.review();
    }
    scenario.submit(scenario.result(false));
    scenario.end();
    scenario.apply();
  }
  assert.equal(scenario.state.phase, 'Blocked');
  assert.deepEqual(scenario.state.budget, { startedAttempts: 2, stagnantAttempts: 2 });
  scenario.act('host', 'restore');
  assert.throws(() => scenario.act('user', 'resume'), /eligible/);
  assert.deepEqual(scenario.state.budget, { startedAttempts: 2, stagnantAttempts: 2 });
});

test('eight started attempts are bounded even when each makes accepted-criterion progress', () => {
  const plan = proposal();
  plan.items[0]!.criteria = Array.from({ length: 9 }, (_, i) => ({ id: `criterion-${i}`, description: `Criterion ${i}.` }));
  const scenario = reviewing(plan);
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    if (attempt > 1) {
      scenario.implement();
      assert.equal(editingAllowed(scenario.state), true);
      scenario.review();
    }
    const result = scenario.result(false);
    result.criteria.forEach((criterion, i) => {
      if (i < attempt) {
        criterion.satisfied = true;
        criterion.evidence = [`evidence-${i}`];
      }
    });
    scenario.submit(result);
    scenario.end();
    scenario.apply();
  }
  assert.equal(scenario.state.phase, 'Blocked');
  assert.equal(scenario.state.budget.startedAttempts, 8);
  assert.equal(scenario.state.budget.stagnantAttempts, 0);
  assert.throws(() => scenario.act('user', 'resume'), /eligible/);
});

test('design output is not publication; Host application ends without implementation', () => {
  const scenario = new Scenario();
  scenario.router();
  scenario.act('agent', 'submit-intent', { dispatchId: scenario.state.dispatch!.id, intent: 'design' });
  scenario.end();
  scenario.act('host', 'route-applied');
  scenario.prepare();
  scenario.send();
  scenario.start();
  scenario.act('agent', 'submit-design', { dispatchId: scenario.state.dispatch!.id, proposalId: 'published-design' });
  scenario.act('host', 'persist-design-result', { proposalId: 'published-design' });
  assert.equal(scenario.state.phase, 'ApplyingDesign');
  assert.throws(() => scenario.act('host', 'design-applied', { proposalId: 'published-design', receiptId: 'promotion' }), /termination/);
  scenario.end();
  scenario.act('host', 'design-applied', { proposalId: 'published-design', receiptId: 'promotion' });
  assert.equal(scenario.state.phase, 'Completed');
  assert.equal(scenario.state.plan, null);
  assert.equal(scenario.state.budget.startedAttempts, 0);
});

test('transition intents do not mutate input state and exact command retries are idempotent', () => {
  const scenario = new Scenario();
  const input = scenario.input('request');
  const before = structuredClone(scenario.state);
  const intent = decideWorkflow(scenario.state, 'user', input);
  assert.deepEqual(scenario.state, before);
  assert.equal(intent.expectedRevision, before.revision);
  assert.equal(intent.next.phase, 'Routing');
  const replay = decideWorkflow(intent.next, 'user', input);
  assert.equal(replay.duplicate, true);
  assert.deepEqual(replay.next, intent.next);
  assert.throws(() => decideWorkflow(intent.next, 'user', { ...input, type: 'resume' }), /reused/);
  assert.throws(() => decideWorkflow(intent.next, 'user', { ...input, id: 'another' }), /stale/);
  assert.throws(() => decideWorkflow(before, 'user', { ...input, operationId: 'foreign' }), /ownership/);
});

test('separate planner task uses the same proposal and approval contract', () => {
  const scenario = new Scenario();
  scenario.router();
  scenario.act('agent', 'submit-intent', { dispatchId: scenario.state.dispatch!.id, intent: 'planning' });
  scenario.end();
  scenario.act('host', 'route-applied');
  scenario.prepare();
  assert.equal(scenario.state.phase, 'PlanningQueued');
  scenario.send();
  scenario.start();
  scenario.act('agent', 'submit-plan', { dispatchId: scenario.state.dispatch!.id, plan: proposal() });
  assert.throws(() => scenario.act('host', 'publish-plan'), /termination/);
  scenario.end();
  scenario.act('host', 'publish-plan');
  assert.equal(scenario.state.phase, 'AwaitingApproval');
});

test('a live task loses editing permission when new impact becomes unknown', () => {
  const scenario = new Scenario();
  scenario.propose();
  scenario.approve();
  scenario.implement();
  assert.equal(editingAllowed(scenario.state), true);
  const changed = design();
  changed.complete = false;
  scenario.act('host', 'inputs-observed', { design: changed, baselineDigest: 'before', policyDigest: DEFAULT_POLICY.digest });
  assert.equal(editingAllowed(scenario.state), false);
  assert.equal(scenario.state.phase, 'Implementing');
  assert.equal(scenario.state.dispatch!.endEvidence, null);
});

test('unaffected approval and completed evidence survive a revision and scoped replan', () => {
  const plan = proposal();
  plan.items.push({ ...plan.items[0]!, id: 'second-work-item' });
  const scenario = reviewing(plan);
  scenario.submit();
  scenario.end();
  scenario.act('host', 'restore');
  scenario.act('user', 'resume');
  scenario.apply();
  const oldApproval = structuredClone(scenario.state.approval);
  const oldReview = structuredClone(scenario.state.reviews[0]);
  const changed = design();
  changed.id = 'design-2';
  changed.entities[2]!.digest = 'unrelated-gui-change';
  scenario.act('host', 'inputs-observed', {
    design: changed, baselineDigest: scenario.state.baselineDigest, policyDigest: DEFAULT_POLICY.digest,
  });
  assert.deepEqual(scenario.state.approval, oldApproval);
  scenario.act('user', 'replan');
  const revised = { ...plan, version: 2, designRevisionId: changed.id, baselineDigest: scenario.state.baselineDigest };
  scenario.prepare();
  scenario.send();
  scenario.start();
  scenario.act('agent', 'submit-plan', { dispatchId: scenario.state.dispatch!.id, plan: revised });
  scenario.end();
  scenario.act('host', 'publish-plan');
  assert.equal(scenario.state.phase, 'AwaitingApproval');
  assert.equal(scenario.state.approval, null);
  assert.deepEqual(scenario.state.approvalHistory[0], oldApproval);
  assert.deepEqual(scenario.state.reviews[0], oldReview);
  assert.equal(scenario.state.acceptedItems.length, 1);
  assert.throws(() => scenario.act('user', 'approve-plan', { approval: oldApproval }), /exactly these fields|approval/);
  scenario.approve();
  assert.throws(() => scenario.prepare('add-storage-check'), /already accepted/);
  scenario.prepare('second-work-item');
});

test('cancellation of saved application preserves result, waits for effects, and never accepts cancelled work', () => {
  const scenario = reviewing();
  scenario.submit();
  scenario.act('user', 'request-cancel');
  assert.throws(() => scenario.act('host', 'finalize-cancellation', { receiptId: 'cancel' }), /saved application/);
  scenario.end();
  scenario.apply();
  assert.equal(scenario.state.phase, 'Cancelled');
  assert.equal(scenario.state.reviews.length, 1);
  assert.deepEqual(scenario.state.acceptedItems, []);
});

test('reviewer cannot hide Host-classified out-of-scope changes by reporting an empty list', () => {
  const scenario = reviewing(proposal(), ['docs\\guide.md']);
  const result = scenario.result();
  result.outOfScopePaths = [];
  assert.throws(() => scenario.submit(result), /Host scope classification/);
  assert.equal(scenario.state.savedReview, null);
  assert.deepEqual(scenario.state.acceptedItems, []);
});

for (const action of ['replan', 'cancel'] as const) {
  test(`restored blocked operation can explicitly ${action} without authorizing editing`, () => {
    const scenario = reviewing(proposal(), ['docs\\guide.md']);
    scenario.submit();
    scenario.end();
    scenario.apply();
    assert.equal(scenario.state.phase, 'Blocked');
    scenario.act('host', 'restore');
    assert.throws(() => scenario.act('user', 'resume'), /replanning/);
    if (action === 'replan') {
      scenario.act('user', 'replan');
      assert.equal(scenario.state.phase, 'Planning');
      assert.equal(scenario.state.recovery, null);
    } else {
      scenario.act('user', 'request-cancel');
      scenario.act('host', 'finalize-cancellation', { receiptId: 'cancel' });
      assert.equal(scenario.state.phase, 'Cancelled');
      scenario.act('host', 'release');
      assert.equal(scenario.state.phase, 'Ready');
    }
    assert.equal(editingAllowed(scenario.state), false);
    assert.equal(scenario.state.reviews.length, 1);
  });
}

test('approving a revised plan records approval but does not queue exhausted work', () => {
  const scenario = reviewing();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt) {
      scenario.implement();
      scenario.review();
    }
    scenario.submit(scenario.result(false));
    scenario.end();
    scenario.apply();
  }
  scenario.act('user', 'replan');
  const revised = { ...proposal(), version: 2, baselineDigest: scenario.state.baselineDigest };
  scenario.prepare();
  scenario.send();
  scenario.start();
  scenario.act('agent', 'submit-plan', { dispatchId: scenario.state.dispatch!.id, plan: revised });
  scenario.end();
  scenario.act('host', 'publish-plan');
  scenario.approve();
  assert.equal(scenario.state.approval!.planVersion, 2);
  assert.equal(scenario.state.phase, 'Blocked');
  assert.equal(scenario.state.dispatch, null);
  assert.deepEqual(scenario.state.budget, { startedAttempts: 2, stagnantAttempts: 2 });
  scenario.act('user', 'request-cancel');
  scenario.act('host', 'finalize-cancellation', { receiptId: 'cancel' });
  assert.equal(scenario.state.phase, 'Cancelled');
});

for (const unfinishedEligible of [false, true]) {
  test(`Resume considers only unfinished eligible items (unfinishedEligible=${unfinishedEligible})`, () => {
    const plan = proposal();
    plan.items.push({
      ...plan.items[0]!, id: 'update-screen', scope: ['src\\screen.ts'], designRefs: ['gui:unrelated'],
    });
    const scenario = reviewing(plan);
    scenario.submit();
    scenario.end();
    scenario.act('host', 'restore');
    scenario.act('user', 'resume');
    scenario.apply();
    assert.equal(scenario.state.phase, 'Blocked');
    assert.deepEqual(scenario.state.acceptedItems.map(({ id }) => id), ['add-storage-check']);

    const changed = design();
    changed.id = 'design-2';
    changed.entities[unfinishedEligible ? 0 : 2]!.digest = 'changed-expectations';
    scenario.act('host', 'inputs-observed', {
      design: changed, baselineDigest: scenario.state.baselineDigest, policyDigest: DEFAULT_POLICY.digest,
    });
    const before = structuredClone(scenario.state);
    if (unfinishedEligible) {
      scenario.act('user', 'resume');
      assert.equal(scenario.state.phase, 'ImplementationQueued');
      assert.throws(() => scenario.prepare('add-storage-check'), /already accepted/);
      scenario.prepare('update-screen');
      scenario.send();
      scenario.start();
      assert.equal(editingAllowed(scenario.state), true);
    } else {
      assert.throws(() => scenario.act('user', 'resume'), /no eligible approved work remains/);
      assert.deepEqual(scenario.state, before);
      assert.equal(scenario.state.phase, 'Blocked');
      assert.equal(editingAllowed(scenario.state), false);
      scenario.act('user', 'replan');
      assert.equal(scenario.state.phase, 'Planning');
    }

    assert.deepEqual(scenario.state.reviews, before.reviews);
    assert.deepEqual(scenario.state.acceptedItems, before.acceptedItems);
    assert.deepEqual(scenario.state.approvalHistory, before.approvalHistory);
  });
}

for (const limit of ['implementationAttempts', 'stagnantAttempts'] as const) {
  test(`approved policy controls ${limit} without a hidden default budget`, () => {
    const policy = resolvePolicy({ execution: { [limit]: 1 } });
    const scenario = reviewing(proposal(policy), [], policy);
    scenario.submit(scenario.result(false));
    scenario.end();
    scenario.apply();
    assert.equal(scenario.state.phase, 'Blocked');
    assert.equal(scenario.state.policy.digest, policy.digest);
    assert.deepEqual(scenario.state.plan!.policy, policy);
    assert.deepEqual(scenario.state.reviews[0]!.snapshot.policy, policy);
    assert.ok(Object.isFrozen(scenario.state.policy.values.execution));
    scenario.act('host', 'restore');
    assert.throws(() => scenario.act('user', 'resume'), /eligible/);
    assert.equal(scenario.state.budget.startedAttempts, 1);
  });
}

test('new work-item schema caps are enforced without allowing an agent to supply its policy', () => {
  const policy = resolvePolicy({ work: { planItems: 1 } });
  const scenario = new Scenario(policy);
  const plan = proposal(policy);
  plan.items.push({ ...plan.items[0]!, id: 'extra-work' });
  assert.throws(() => scenario.propose(plan), /at most 1/);
  assert.equal(scenario.state.approval, null);
  assert.equal(scenario.state.proposal, null);
  assert.throws(() => createWorkflowOperation('old', 'session', design(), 'before', 'opaque-policy-digest'), /policy/);
});

test('pinned snapshot resource bounds reject overflow instead of discarding changed paths', () => {
  const policy = resolvePolicy({ resources: { reviewInventoryFiles: 1 } });
  const scenario = new Scenario(policy);
  scenario.propose();
  scenario.approve();
  scenario.implement();
  scenario.end();
  scenario.act('host', 'begin-capture');
  assert.throws(() => scenario.act('host', 'save-snapshot', {
    snapshotId: 'too-large', baselineDigest: 'before', afterDigest: 'after',
    changedPaths: ['src\\storage.ts', 'extra.ts'], outOfScopePaths: ['extra.ts'],
  }), /at most 1/);
  assert.equal(scenario.state.phase, 'CapturingChanges');
  assert.equal(scenario.state.snapshot, null);
});

test('design reassessment preserves accepted Review history and pauses only uncertain unfinished work', () => {
  const plan = proposal();
  plan.items.push({ ...plan.items[0]!, id: 'unfinished', designRefs: ['gui:unrelated'] });
  const scenario = reviewing(plan);
  scenario.submit(); scenario.end(); scenario.apply();
  const original = structuredClone(scenario.state);
  assert.equal(original.acceptedItems.length, 1);
  const next = design();
  next.id = 'design-2';
  next.entities[2]!.digest = 'changed-unfinished-expectation';
  scenario.act('host', 'reassess-design', {
    design: next, baselineDigest: scenario.state.baselineDigest, policyDigest: DEFAULT_POLICY.digest,
  });
  assert.equal(scenario.state.phase, 'Blocked');
  assert.deepEqual(scenario.state.acceptedItems, original.acceptedItems);
  assert.deepEqual(scenario.state.reviews, original.reviews);
  assert.deepEqual(scenario.state.approvalHistory, original.approvalHistory);
  assert.equal(scenario.state.dispatch, null);
  assert.deepEqual(scenario.state.budget, original.budget);
});
