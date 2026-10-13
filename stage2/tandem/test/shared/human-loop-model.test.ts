import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { DEFAULT_POLICY, policyHash } from '../../runtime-src/domain/workflow/policy.ts';
import { validatePolicyShape } from '../../runtime-src/domain/workflow/policy-contracts.ts';
import { createHumanLoop, transitionHumanLoop, nextHumanRequest, nextHumanBatch, humanExecutionQueue, hasQuestionBlockers, type HumanLoopState } from '../../runtime-src/domain/human-loop/model.ts';
import { parseRoleResult, parseTaskBinding, roles, parseQuestions, requireDeclaredAdvisoryContinuations, type Authority, type HumanRole, type RoleOutcome, type SnapshotRef, type QuestionDraft, type QuestionResolution } from '../../runtime-src/domain/human-loop/contracts.ts';
import { humanLoopResultTools, humanLoopProgressTool, humanLoopStopTool, humanQuestionSchema } from '../../runtime-src/domain/human-loop/tool-contracts.ts';
import { createHumanLoopLedger, replayHumanLoopLedger } from '../../runtime-src/domain/human-loop/ledger.ts';
import { validateHumanImplementationAuthorization } from '../../runtime-src/domain/human-loop/authorization.ts';

const design = { revisionId: 'design-1', digest: 'a'.repeat(64) };
const baseline = { id: 'baseline', digest: 'b'.repeat(64) };
const snapshot = (id: string): SnapshotRef => ({ id, digest: policyHash(id) });
const question: QuestionDraft = {
  id: 'direction', context: 'The requested behavior differs from the current Design.',
  question: 'Which behavior should this request use?', whyItMatters: 'Controls and outcomes differ.',
  importance: 'blocking', options: [
    { id: 'keep', label: 'Keep the current Design', implication: 'Continue within its agreed behavior.' },
    { id: 'change', label: 'Revise the Design', implication: 'Discuss the changed requirement first.' },
  ], allowFreeform: true,
};
const unanswered = { action: 'keep-current-design' as const, explanation: 'Keep the currently agreed behavior; the proposed revision is not applied.' };
const plan = () => ({
  schemaVersion: 'internal-plan/v1' as const, id: 'internal', version: 1, goal: 'Build the requested feature.',
  design, baseline, tasks: [
    { id: 'engine', title: 'Implement the engine', scope: ['engine.ts'], dependsOn: [],
      criteria: [{ id: 'engine-correct', description: 'Engine behavior matches the Design.' }] },
    { id: 'view', title: 'Implement the interface', scope: ['view.ts'], dependsOn: ['engine'],
      criteria: [{ id: 'view-correct', description: 'The interface uses the engine correctly.' }] },
  ],
});

function fixture(liveAuthorization = true, autoConfirm = true, legacyQuestions = false) {
  let n = 0;
  let state = createHumanLoop({ schemaVersion: 'human-loop-owner/v1', id: 'owner', mainSessionId: 'main',
    privateSessionId: 'private', workspacePath: resolve('human-loop-fixture'), policy: DEFAULT_POLICY }, design);
  const ledger = createHumanLoopLedger(state.owner, design);
  const emit = (type: string, data: unknown, authority: Authority = 'host') => {
    const command = { id: `command-${++n}`, expectedRevision: state.revision, type, data,
      ...(legacyQuestions ? {} : { questionPolicy: 'explicit-continuation/v1' }) };
    const next = transitionHumanLoop(state, authority, command, legacyQuestions);
    if (liveAuthorization) validateHumanImplementationAuthorization(state, type, data);
    state = next;
    ledger.events.push({ authority, command });
    return state;
  };
  const receive = (id: string, answers: unknown = null, message = `  Exact ${id}\nrequest.`) => emit('receive-request', {
    id, message, receivedAt: '2026-09-14T09:25:00Z', answers,
  }, 'user');
  const admit = (id: string) => emit('admit-request', { requestId: id });
  const start = (role: HumanRole, cycleId: string | null = null, internalTaskId: string | null = null) => {
    const before = cycleId ? state.cycles.find(({ id }) => id === cycleId)!.current : state.cycles.at(-1)?.current ?? baseline;
    const id = `role-${++n}`;
    emit('start-role', { id, dispatchId: `dispatch-${id}`, sessionId: 'private', requestId: state.activeRequestId,
      cycleId, role, internalTaskId, inputDigest: policyHash(id), before, design: state.design });
    emit('role-acknowledged', { taskId: id, dispatchId: `dispatch-${id}`, messageId: `message-${id}` }, 'runtime');
    emit('role-started', { taskId: id, messageId: `message-${id}`, interactionId: `interaction-${id}` }, 'runtime');
    return state.activeTask!;
  };
  const submit = (outcome: RoleOutcome) => {
    const result = { schemaVersion: 'human-role-result/v1', resultId: `result-${++n}`, inputDigest: state.activeTask!.binding.inputDigest, outcome };
    emit('submit-result', result, 'agent'); return result;
  };
  const end = (after = state.activeTask!.binding.before, termination = 'normal') => {
    const task = state.activeTask!;
    emit('confirm-role-end', { proof: { taskId: task.binding.id, dispatchId: task.binding.dispatchId, sessionId: 'private',
      messageId: task.messageId, interactionId: task.interactionId, endEventId: `native-end-${++n}`, quiescent: true,
      termination, abortAcknowledged: termination !== 'normal' }, snapshot: after });
  };
  const apply = (designPublication: unknown = null) => emit('apply-result', { resultId: state.activeTask!.result!.resultId, designPublication });
  const finish = (outcome: RoleOutcome, after?: SnapshotRef) => { const result = submit(outcome); end(after); apply(); return result; };
  const route = (intent: 'design' | 'implement' | 'answer' | 'resume-cycle' | 'replan-cycle', cycleId: string | null = null,
    resolvedQuestions: QuestionResolution[] = []) => {
    start('router');
    const result = finish({ kind: 'route', intent, cycleId, summary: 'Interpret the actual user request.', resolvedQuestions });
    if (liveAuthorization && autoConfirm && ['implement', 'resume-cycle', 'replan-cycle'].includes(intent)) {
      emit('request-implementation-confirmation', { id: `confirm:${result.resultId}`, requestId: state.activeRequestId,
        routeResultId: result.resultId, design: state.design, createdAt: '2026-09-28T10:00:00Z' });
      emit('decide-implementation-confirmation', { confirmationId: `confirm:${result.resultId}`, decision: 'approved',
        decidedAt: '2026-09-28T10:01:00Z' }, 'user');
    }
    return result;
  };
  const createCycle = () => emit('start-cycle', { cycleId: 'cycle', design: state.design, baseline });
  const accept = () => {
    const cycle = state.cycles[0]!, request = state.requests.find(({ id }) => id === state.activeRequestId)!;
    const acceptance = { schemaVersion: 'internal-plan-acceptance/v1', authority: 'host', cycleId: cycle.id,
      requestId: request.id, routeResultId: request.route!.resultId, planId: cycle.pendingPlan!.id,
      sourceRequestIds: [...state.activeBatchRequestIds],
      planDigest: cycle.pendingPlan!.digest, design: cycle.design, baseline: cycle.current, policyDigest: DEFAULT_POLICY.digest };
    emit('accept-plan', { cycleId: cycle.id, acceptance });
  };
  const planCycle = () => { start('planner', 'cycle'); finish({ kind: 'internal-plan', plan: plan() }); accept(); };
  const taskResult = (id: string) => finish({ kind: 'task-result', taskId: id, planDigest: state.cycles[0]!.plan!.digest,
    summary: `${id} reported complete; formal Review has not run.`, evidenceRefs: [id] }, snapshot(`after-${id}`));
  const present = () => emit('present-handoff', { handoffId: state.handoffs.at(-1)!.id });
  return { get state() { return state; }, ledger, emit, receive, admit, start, submit, end, apply, finish, route, createCycle, accept, planCycle, taskResult, present };
}

test('new advisory questions require a structured safe continuation, not recommended wording', () => {
  const advisory = { ...question, importance: 'advisory' as const,
    options: question.options.map(o => ({ ...o, label: `${o.label} (Recommended)` })) };
  assert.throws(() => requireDeclaredAdvisoryContinuations(parseQuestions([advisory])), /Every new advisory/);
  assert.throws(() => validatePolicyShape(humanQuestionSchema, advisory), /./);
  for (const invalid of [null, { action: 'change-design', explanation: 'Pick the recommended option' },
    { action: 'keep-current-design', explanation: ' ' }, { action: 'keep-current-design' }]) {
    assert.throws(() => parseQuestions([{ ...advisory, unanswered: invalid }]));
  }
  assert.throws(() => parseQuestions([{ ...question, unanswered }]), /Blocking questions/);
  const valid = { ...advisory, unanswered };
  assert.doesNotThrow(() => validatePolicyShape(humanQuestionSchema, valid));
  const f = fixture();
  f.receive('design'); f.admit('design'); f.route('design'); f.start('designer');
  assert.throws(() => f.submit({ kind: 'designer-unchanged', summary: 'Proposed improvement', explanation: 'No changes',
    questions: [advisory] }), /Every new advisory/);
  assert.equal(f.state.activeTask!.result, null, 'Rejected output remains correctable through the same result tool.');
  f.finish({ kind: 'designer-unchanged', summary: 'Keep agreed behavior', explanation: 'No Design change', questions: [valid] });
  f.present();
  assert.equal(f.state.questions[0]!.state, 'open');
  assert.equal(f.state.questions[0]!.answerRequestId, null);
  assert.deepEqual(f.state.design, design);
  assert.equal(hasQuestionBlockers(f.state), false);
  f.receive('explain'); f.admit('explain'); f.route('answer'); f.start('agent');
  f.finish({ kind: 'answer', summary: 'Explanation', report: 'Current Design retained.', evidenceRefs: [] }); f.present();
  assert.equal(f.state.questions[0]!.state, 'open');
  assert.equal(f.state.implementationConfirmations?.length ?? 0, 0);
  const source = f.state.questions[0]!.source.resultId;
  f.receive('explicit-change', { schemaVersion: 'human-question-answers/v1',
    answers: [{ questionId: question.id, sourceResultId: source, kind: 'option', value: 'change' }] });
  assert.equal(f.state.questions[0]!.state, 'answered');
  assert.equal(f.state.questions[0]!.answerRequestId, 'explicit-change');
  assert.deepEqual(f.state.design, design, 'Saving the explicit answer does not itself publish a Design.');
  f.admit('explicit-change'); f.route('design'); f.start('designer');
  f.submit({ kind: 'designer-changed', summary: 'Requested change', artifactRef: 'updated-design', questions: [] }); f.end();
  const next = { revisionId: 'design-2', digest: 'c'.repeat(64) };
  f.apply({ previous: design, current: next, receiptId: 'publication', artifactRef: 'updated-design' }); f.present();
  assert.deepEqual(f.state.design, next);
  assert.equal(f.state.cycles.length, 0, 'Neither the default nor a Design answer authorizes implementation.');
  assert.deepEqual(replayHumanLoopLedger(f.ledger).state, f.state);
});

test('stale advisory continuations hold new work until an explicit contextual answer', () => {
  const f = fixture();
  f.receive('first'); f.admit('first'); f.route('design'); f.start('designer');
  f.finish({ kind: 'designer-unchanged', summary: 'Optional', explanation: 'Retained', questions: [{ ...question, importance: 'advisory', unanswered }] }); f.present();
  f.receive('update'); f.admit('update'); f.route('design'); f.start('designer');
  f.submit({ kind: 'designer-changed', summary: 'New Design', artifactRef: 'new', questions: [] }); f.end();
  f.apply({ previous: design, current: { revisionId: 'new', digest: 'd'.repeat(64) }, receiptId: 'publication', artifactRef: 'new' }); f.present();
  const retained = structuredClone(f.state.questions[0]!);
  f.receive('new-work');
  assert.equal(nextHumanRequest(f.state), null);
  assert.throws(() => f.admit('new-work'), /prerequisites/);
  assert.deepEqual(f.state.questions[0], retained, 'A stale default is not rewritten as blocking, answered or invalidated.');
  f.receive('clarify', { schemaVersion: 'human-question-answers/v1', answers: [
    { questionId: retained.id, sourceResultId: retained.source.resultId, kind: 'freeform', value: 'Keep the newly agreed Design.' },
  ] });
  assert.equal(nextHumanRequest(f.state)?.id, 'clarify');
  assert.deepEqual(replayHumanLoopLedger(f.ledger).state, f.state);
});

test('legacy advisory journals remain unchanged while new commands require explicit clarification', () => {
  const f = fixture(false, false, true);
  f.receive('old-design'); f.admit('old-design'); f.route('design'); f.start('designer');
  f.finish({ kind: 'designer-unchanged', summary: 'Legacy question', explanation: 'No recorded default',
    questions: [{ ...question, importance: 'advisory' }] }); f.present();
  f.receive('old-work'); f.admit('old-work'); f.route('answer'); f.start('agent');
  const original = JSON.stringify(f.ledger);
  const active = replayHumanLoopLedger(JSON.parse(original)).state;
  assert.equal(active.activeTask?.binding.id, f.state.activeTask?.binding.id, 'Reading legacy state does not cancel active work.');
  assert.equal(hasQuestionBlockers(active), true);
  assert.deepEqual(active.questions, f.state.questions);
  f.finish({ kind: 'answer', summary: 'Historical answer', report: 'Old work completed.', evidenceRefs: [] }); f.present();
  f.receive('queued');
  const before = JSON.stringify(f.ledger);
  const old = replayHumanLoopLedger(f.ledger).state;
  assert.equal(JSON.stringify(f.ledger), before);
  assert.equal(Object.hasOwn(old.questions[0]!, 'unanswered'), false);
  assert.equal(old.questions[0]!.importance, 'advisory');
  assert.equal(old.questions[0]!.blockingActive, false);
  assert.equal(nextHumanRequest(old), null);
  const q = old.questions[0]!;
  const command = { id: 'new-clarification', expectedRevision: old.revision, type: 'receive-request',
    questionPolicy: 'explicit-continuation/v1', data: { id: 'clarification', message: 'Keep the agreed Design.', receivedAt: '2026-10-13T00:00:00Z',
      answers: { schemaVersion: 'human-question-answers/v1', answers: [
        { questionId: q.id, sourceResultId: q.source.resultId, kind: 'option', value: 'keep' },
      ] } } };
  const next = transitionHumanLoop(old, 'user', command);
  assert.equal(nextHumanRequest(next)?.id, 'clarification');
  assert.equal(next.questions[0]!.answerRequestId, 'clarification');
  assert.equal(next.questions[0]!.importance, 'advisory');
  assert.deepEqual(replayHumanLoopLedger({ ...f.ledger, events: [...f.ledger.events, { authority: 'user', command }] }).state, next);
});

test('modern native input evidence keeps acknowledgement, event, interaction and turn identities distinct', () => {
  const f = fixture();
  f.receive('request'); f.admit('request');
  const binding = { id: 'role-modern', dispatchId: 'dispatch-modern', sessionId: 'private', requestId: 'request',
    cycleId: null, role: 'router', internalTaskId: null, inputDigest: policyHash('modern'), before: null, design };
  f.emit('start-role', binding);
  const envelope = { schemaVersion: 'human-role-input/v1', kind: 'initial', promptDigest: policyHash('exact wrapper'),
    promptBytes: 42, attachmentsDigest: policyHash([]) };
  const prepared = { taskId: binding.id, dispatchId: binding.dispatchId, inputDigest: binding.inputDigest, envelope };
  assert.throws(() => f.emit('role-input-prepared', prepared, 'runtime'), /actor/);
  assert.throws(() => f.emit('role-input-prepared', { ...prepared, inputDigest: policyHash('changed') }), /immutable/);
  f.emit('role-input-prepared', prepared);
  assert.throws(() => f.emit('role-input-prepared', prepared), /first input/);
  const native = { taskId: binding.id, dispatchId: binding.dispatchId, kind: 'initial',
    user: { schemaVersion: 'human-loop-native-user/v2', id: 'native-user', messageId: null, turnId: null,
      interactionId: 'native-interaction' }, turnId: '0', startEventId: 'native-start' };
  assert.throws(() => f.emit('role-input-bound', { ...native, dispatchId: 'foreign' }, 'runtime'), /prepared/);
  assert.throws(() => f.emit('role-input-bound', { ...native,
    user: { ...native.user, messageId: 'partial-legacy-identity' } }, 'runtime'), /prepared/);
  f.emit('role-input-bound', native, 'runtime');
  assert.equal(f.state.activeTask!.messageId, null);
  f.emit('role-acknowledged', { taskId: binding.id, dispatchId: binding.dispatchId, messageId: 'sdk-ack' }, 'runtime');
  assert.throws(() => f.emit('role-started', { taskId: binding.id, messageId: 'sdk-ack', interactionId: 'foreign' }, 'runtime'), /sent-envelope/);
  f.emit('role-started', { taskId: binding.id, messageId: 'sdk-ack', interactionId: 'native-interaction' }, 'runtime');
  f.emit('role-input-prepared', { ...prepared, envelope: { ...envelope, kind: 'continuation', promptDigest: policyHash('continuation') } });
  assert.throws(() => f.emit('role-input-bound', { ...native, kind: 'continuation' }, 'runtime'), /reused/);
  f.emit('role-input-bound', { ...native, kind: 'continuation', turnId: '1', startEventId: 'continuation-start',
    user: { ...native.user, id: 'continuation-user', interactionId: 'continuation-interaction' } }, 'runtime');
  assert.throws(() => f.emit('continuation-acknowledged', { taskId: binding.id, dispatchId: binding.dispatchId,
    messageId: 'sdk-ack' }, 'runtime'), /acknowledgement/);
  f.emit('continuation-acknowledged', { taskId: binding.id, dispatchId: binding.dispatchId, messageId: 'continuation-ack' }, 'runtime');
  assert.throws(() => f.emit('role-input-prepared', { ...prepared, envelope: { ...envelope, kind: 'continuation' } }), /one same-role/);
  const inputs = f.state.activeTask!.inputs!;
  assert.equal(inputs[0]!.acknowledgementId, 'sdk-ack');
  assert.equal(inputs[0]!.native!.user.id, 'native-user');
  assert.equal(inputs[0]!.native!.user.messageId, null);
  assert.equal(inputs[1]!.native!.user.interactionId, 'continuation-interaction');
  assert.deepEqual(replayHumanLoopLedger(f.ledger).state, f.state);
});

test('batched role hints stay attached to each exact message and never select a role before Router', () => {
  const f = fixture();
  for (const role of ['designer', 'agent'] as const) f.emit('receive-request', {
    id: role, message: `@${role} Discuss the current work.`, receivedAt: '2026-10-13T00:00:00Z', answers: null,
    roleHint: { schemaVersion: 'human-role-hint/v1', role },
  }, 'user');
  f.receive('automatic', null, 'Explain the status.');
  assert.deepEqual(nextHumanBatch(f.state).map(request => [request.id, request.roleHint?.role]),
    [['designer', 'designer'], ['agent', 'agent'], ['automatic', undefined]]);
  f.admit('designer');
  assert.equal(f.state.activeTask, null);
  assert.throws(() => f.start('designer'), /Router|router|route/);
  assert.throws(() => f.start('agent'), /Router|router|route/);
  assert.equal(f.start('router').binding.role, 'router');
  assert.deepEqual(replayHumanLoopLedger(JSON.parse(JSON.stringify(f.ledger))).state, f.state);
});

test('legacy input evidence remains readable without adding invented envelope fields', () => {
  const f = fixture();
  f.receive('legacy'); f.admit('legacy'); f.start('router');
  assert.equal(Object.hasOwn(f.state.activeTask!, 'inputs'), false);
  assert.deepEqual(replayHumanLoopLedger(f.ledger).state, f.state);
});

for (const disposition of ['pending', 'approved', 'changed-design'] as const) test(`confirmation recovery preserves only pending human decisions: ${disposition}`, () => {
  const f = fixture(true, false);
  f.receive('proposal'); f.admit('proposal'); const route = f.route('implement');
  f.emit('request-implementation-confirmation', { id: 'confirmation', requestId: 'proposal',
    routeResultId: route.resultId, design, createdAt: '2026-09-28T10:00:00Z' });
  if (disposition === 'approved') f.emit('decide-implementation-confirmation', {
    confirmationId: 'confirmation', decision: 'approved', decidedAt: '2026-09-28T10:01:00Z',
  }, 'user');
  f.receive('queued');
  const currentDesign = disposition === 'changed-design' ? { revisionId: 'design-2', digest: 'c'.repeat(64) } : design;
  f.emit('recover', { recoveryId: 'reopen-confirmation', recoveredAt: '2026-09-28T11:00:00Z',
    evidenceRef: 'verified-native-history', design: currentDesign, nativeUsers: [] });
  assert.equal(f.state.requests[1]!.status, 'retired', 'Ordinary queued work is not automatically replayed.');
  assert.equal(f.state.activeRequestId, disposition === 'approved' ? null : 'proposal');
  assert.equal(f.state.requests[0]!.status, disposition === 'approved' ? 'retired' : 'active');
  assert.equal(f.state.activeTask, null);
  assert.equal(f.state.cycles.length, 0);
  assert.deepEqual(replayHumanLoopLedger(f.ledger).state, f.state);
  const decision = { confirmationId: 'confirmation', decision: 'approved', decidedAt: '2026-09-28T11:01:00Z' };
  if (disposition === 'approved') assert.throws(() => f.emit('decide-implementation-confirmation', decision, 'user'), /stale/);
  else {
    if (disposition === 'changed-design') {
      assert.throws(() => f.emit('decide-implementation-confirmation', decision, 'user'), /Design changed/);
      f.emit('request-implementation-confirmation', { id: 'replacement', requestId: 'proposal',
        routeResultId: route.resultId, design: currentDesign, createdAt: '2026-09-28T11:00:01Z' });
      assert.equal(f.state.implementationConfirmations![0]!.status, 'invalidated');
      assert.throws(() => f.emit('decide-implementation-confirmation', decision, 'user'), /stale/);
      decision.confirmationId = 'replacement';
    }
    f.emit('decide-implementation-confirmation', decision, 'user');
    assert.doesNotThrow(() => validateHumanImplementationAuthorization(f.state, 'start-cycle', {}));
  }
});

test('confirmation binds exact batch, route, Design and user authority rather than permission grants', () => {
  const f = fixture(true, false);
  f.receive('first'); f.receive('second'); f.admit('first'); const route = f.route('implement');
  const proposal = { id: 'confirmation', requestId: 'first', routeResultId: route.resultId, design, createdAt: '2026-09-28T10:00:00Z' };
  assert.throws(() => f.emit('request-implementation-confirmation', { ...proposal, routeResultId: 'another-route' }), /completed implementation route/);
  f.emit('request-implementation-confirmation', proposal);
  assert.deepEqual(f.state.implementationConfirmations![0]!.requestIds, ['first', 'second']);
  assert.throws(() => f.createCycle(), /Explicit user confirmation/);
  const decision = { confirmationId: 'confirmation', decision: 'approved', decidedAt: '2026-09-28T10:01:00Z' };
  assert.throws(() => f.emit('decide-implementation-confirmation', decision, 'agent'), /actor/);
  f.emit('decide-implementation-confirmation', decision, 'user');
  const changedBatch = structuredClone(f.state); changedBatch.activeBatchRequestIds.pop();
  assert.throws(() => validateHumanImplementationAuthorization(changedBatch, 'start-cycle', {}), /Explicit user confirmation/);
  f.createCycle();
  assert.deepEqual(f.state.cycles[0]!.originRequestIds, ['first', 'second']);
});

test('absent conversational evidence is explicit, replayable and never valid for a cycle role', () => {
  const f = fixture();
  f.receive('request'); f.admit('request');
  const binding = { id: 'role-null', dispatchId: 'dispatch-null', sessionId: 'private', requestId: 'request',
    cycleId: null, role: 'router', internalTaskId: null, inputDigest: policyHash('null'), before: null, design };
  for (const role of ['router', 'designer', 'agent']) assert.equal(parseTaskBinding({ ...binding, role }).before, null);
  for (const role of ['planner', 'implementer', 'reviewer']) assert.throws(() =>
    parseTaskBinding({ ...binding, role, cycleId: 'cycle' }), /evidence|snapshot/i);
  f.emit('start-role', binding);
  f.emit('role-acknowledged', { taskId: binding.id, dispatchId: binding.dispatchId, messageId: 'native-message' }, 'runtime');
  f.emit('role-started', { taskId: binding.id, messageId: 'native-message', interactionId: 'native-interaction' }, 'runtime');
  f.submit({ kind: 'route', intent: 'answer', cycleId: null, summary: 'Explain only.', resolvedQuestions: [] });
  assert.throws(() => f.apply(), /completed result.*code evidence/);
  f.end(null); f.apply();
  assert.equal(f.state.executions[0]!.after, null);
  assert.deepEqual(replayHumanLoopLedger(f.ledger).state, f.state);
  const legacy = fixture(); legacy.receive('request'); legacy.admit('request'); legacy.start('router');
  legacy.submit({ kind: 'route', intent: 'answer', cycleId: null, summary: 'Legacy observed evidence.', resolvedQuestions: [] });
  assert.throws(() => legacy.end(null), /cannot be discarded/);
});

test('current terminal result completes despite permission waiting while retaining schema identity and evidence checks', () => {
  const f = fixture();
  f.receive('request'); f.admit('request');
  const task = f.start('router');
  f.emit('permission-state', { taskId: task.binding.id, waiting: true }, 'runtime');
  const result = { schemaVersion: 'human-role-result/v1', resultId: 'declared-result', inputDigest: task.binding.inputDigest,
    outcome: { kind: 'route', intent: 'answer', cycleId: null, summary: 'Answer this request.', resolvedQuestions: [] } };
  assert.throws(() => f.emit('complete-role-result', { ...result, inputDigest: policyHash('foreign') }, 'agent'), /input binding/);
  assert.throws(() => f.emit('complete-role-result', { ...result, outcome: { kind: 'answer', summary: 'Wrong role.',
    report: 'Not a Router result.', evidenceRefs: [] } }, 'agent'));
  f.emit('complete-role-result', result, 'agent');
  assert.equal(f.state.activeTask!.completion, 'result-submission');
  assert.equal(f.state.activeTask!.end, null);
  assert.equal(f.state.activeTask!.turnEnd, undefined);
  assert.throws(() => f.emit('complete-role-result', result, 'agent'), /not active/);
  assert.throws(() => f.emit('record-result-snapshot', { taskId: 'foreign', resultId: result.resultId,
    snapshot: baseline }), /submitted result/);
  f.emit('record-result-snapshot', { taskId: task.binding.id, resultId: result.resultId, snapshot: baseline });
  f.apply();
  assert.equal(f.state.activeTask, null);
  assert.equal(f.state.executions[0]!.completion, 'result-submission');
  assert.deepEqual(replayHumanLoopLedger(f.ledger).state, f.state);
});

for (const uncertain of [false, true]) test(`Close releases question gates without deleting answers or waiting for execution: uncertain=${uncertain}`, () => {
  const f = fixture();
  f.receive('design'); f.admit('design'); f.route('design'); f.start('designer');
  const result = f.finish({ kind: 'designer-unchanged', summary: 'Choose the direction.',
    explanation: 'The choice remains open.', questions: [question] });
  f.present();
  f.receive('answer', { schemaVersion: 'human-question-answers/v1', answers: [{
    questionId: question.id, sourceResultId: result.resultId, kind: 'option', value: 'keep',
  }] });
  f.admit('answer'); f.start('router');
  if (uncertain) f.emit('execution-unknown', { reason: 'Native observation unavailable.', evidenceRef: 'fixture' });
  const before = structuredClone(f.state);
  f.emit('release-question-gates', {});
  assert.deepEqual(f.state.questions.map(item => ({ ...item, blockingActive: true })), before.questions);
  assert.ok(f.state.questions.every(item => item.blockingActive === false));
  assert.deepEqual(f.state.activeTask, before.activeTask);
  assert.deepEqual(f.state.requests, before.requests.map(request => ({ ...request, questionGatesReleased: true })));
  assert.deepEqual(f.state.uncertainty, before.uncertainty);
  assert.deepEqual(replayHumanLoopLedger(f.ledger).state, f.state);
});

test('known preparation rejection is Host-only and retains not-sent execution and independent waiting work', () => {
  const f = fixture();
  f.receive('first'); f.admit('first');
  const binding = { id: 'not-sent', dispatchId: 'not-sent-dispatch', sessionId: 'private', requestId: 'first',
    cycleId: null, role: 'router', internalTaskId: null, inputDigest: policyHash('not-sent'), before: null, design };
  f.emit('start-role', binding);
  f.receive('later');
  const failure = { requestId: 'first', taskId: binding.id, reason: 'Exact pre-send preparation failure.' };
  assert.throws(() => f.emit('reject-preparation', failure, 'agent'), /actor/);
  assert.throws(() => f.emit('reject-preparation', { ...failure, taskId: 'foreign' }), /not dispatched/);
  f.emit('reject-preparation', failure);
  assert.equal(f.state.uncertainty, null);
  assert.equal(f.state.activeTask, null);
  assert.equal(f.state.executions[0]!.condition, 'not-sent');
  assert.equal(f.state.executions[0]!.messageId, null);
  assert.equal(f.state.executions[0]!.end, null);
  assert.deepEqual(f.state.requests.map(r => r.status), ['rejected', 'waiting']);
  assert.equal(f.state.requests[0]!.rejectionReason, failure.reason);
  assert.equal(nextHumanRequest(f.state)!.id, 'later');
  assert.deepEqual(replayHumanLoopLedger(f.ledger).state, f.state);
  f.admit('later');
  const acknowledged = f.start('router');
  assert.throws(() => f.emit('reject-preparation', { ...failure, requestId: 'later', taskId: acknowledged.binding.id }),
    /not dispatched/);
  assert.equal(f.state.activeTask!.binding.id, acknowledged.binding.id);
});

test('legacy turn-end records survive replay without becoming new completion authority', () => {
  const f = fixture();
  f.receive('request'); f.admit('request');
  const task = f.start('router');
  const result = f.submit({ kind: 'route', intent: 'answer', cycleId: null, summary: 'Read-only answer.', resolvedQuestions: [] });
  const fact = { taskId: task.binding.id, resultId: result.resultId, toolCallId: 'terminal-tool',
    toolEventId: 'tool-complete', eventId: 'turn-end', turnId: '1', interactionId: task.interactionId };
  assert.throws(() => f.emit('record-role-turn-end', fact, 'agent'), /actor/);
  assert.throws(() => f.emit('record-role-turn-end', { ...fact, interactionId: 'foreign' }, 'runtime'), /owned interaction/);
  f.emit('record-role-turn-end', fact, 'runtime');
  assert.equal(f.state.activeTask!.turnEnd!.eventId, 'turn-end');
  assert.equal(f.state.activeTask!.end, null);
  assert.throws(() => f.apply(), /completed result.*code evidence/);
  assert.throws(() => f.emit('request-role-end', { taskId: task.binding.id, resultId: result.resultId,
    toolCallId: fact.toolCallId, eventId: fact.toolEventId, reason: 'completion-timeout' }), /proven role turn end/);
  assert.deepEqual(replayHumanLoopLedger(f.ledger).state, f.state);
  f.receive('waiting');
  f.emit('recover', { recoveryId: 'recover-turn-end', recoveredAt: '2026-09-20T08:00:00Z',
    evidenceRef: 'retained-events', design, nativeUsers: [] });
  assert.equal(f.state.activeTask, null);
  assert.equal(f.state.executions.at(-1)!.turnEnd!.eventId, 'turn-end');
  assert.equal(f.state.executions.at(-1)!.end, null);
  assert.deepEqual(humanExecutionQueue(f.state), []);
  assert.deepEqual(replayHumanLoopLedger(f.ledger).state, f.state);
});

test('unsent advisory Reviewer failure preserves processed blocking answers and releases later work', () => {
  const f = fixture();
  f.receive('choice'); f.admit('choice'); f.route('design'); f.start('designer');
  f.finish({ kind: 'designer-unchanged', summary: 'Choose before implementation.', explanation: 'The agreed Design is retained.', questions: [question] });
  f.present();
  const source = f.state.questions[0]!;
  f.receive('implement-answer', { schemaVersion: 'human-question-answers/v1', answers: [{
    questionId: source.id, sourceResultId: source.source.resultId, kind: 'option', value: 'keep',
  }] });
  f.admit('implement-answer'); f.route('implement'); f.createCycle(); f.planCycle();
  for (const id of ['engine', 'view']) { f.start('implementer', 'cycle', id); f.taskResult(id); }
  f.start('implementer', 'cycle');
  f.finish({ kind: 'implementation-result', planDigest: f.state.cycles[0]!.plan!.digest,
    completedTaskIds: ['engine', 'view'], summary: 'Implementation retained.', evidenceRefs: ['engine.ts', 'view.ts'] });
  const answers = structuredClone(f.state.questions), implementation = structuredClone(f.state.cycles[0]!.implementationResult);
  f.emit('start-role', { id: 'unsent-review', dispatchId: 'unsent-review-dispatch', sessionId: 'private',
    requestId: 'implement-answer', cycleId: 'cycle', role: 'reviewer', internalTaskId: null,
    inputDigest: policyHash('unsent-review'), before: f.state.cycles[0]!.current, design });
  f.receive('next');
  const withUnresolved = structuredClone(f.state);
  withUnresolved.questions.push({ ...structuredClone(withUnresolved.questions[0]!), id: 'another-unresolved-decision',
    state: 'open', answerRequestId: null, blockingActive: true });
  const stillBlocked = transitionHumanLoop(withUnresolved, 'host', { id: 'unsent-review-with-open-decision',
    expectedRevision: withUnresolved.revision, type: 'reject-preparation',
    data: { requestId: 'implement-answer', taskId: 'unsent-review', reason: 'Review was not sent.' } });
  assert.deepEqual(stillBlocked.questions, withUnresolved.questions);
  assert.equal(nextHumanRequest(stillBlocked), null, 'A genuine unresolved prerequisite remains blocking.');
  f.emit('reject-preparation', { requestId: 'implement-answer', taskId: 'unsent-review', reason: 'Review was not sent.' });
  assert.deepEqual(f.state.questions, answers);
  assert.deepEqual(f.state.cycles[0]!.implementationResult, implementation);
  assert.equal(f.state.cycles[0]!.reviewResult!.outcome.kind, 'review-incomplete');
  assert.equal(f.state.cycles[0]!.phase, 'completed');
  assert.equal(nextHumanRequest(f.state)!.id, 'next');
  assert.deepEqual(replayHumanLoopLedger(f.ledger).state, f.state);
});

test('automatic timeout cause persists separately from user Stop and requires matching abort acknowledgement', () => {
  const f = fixture();
  f.receive('request'); f.admit('request');
  const task = f.start('router');
  const result = f.submit({ kind: 'route', intent: 'answer', cycleId: null, summary: 'Read-only answer.', resolvedQuestions: [] });
  const receipt = { taskId: task.binding.id, resultId: result.resultId, toolCallId: 'terminal-tool', eventId: 'tool-complete' };
  assert.throws(() => f.emit('request-role-end', { ...receipt, reason: 'user-stop' }), /completion-timeout/);
  f.emit('request-role-end', { ...receipt, reason: 'completion-timeout' });
  assert.equal(f.state.activeTask!.terminal!.reason, 'completion-timeout');
  assert.equal(f.state.stop, null);
  assert.throws(() => f.end(baseline, 'result-abort'), /acknowledgement/);
  f.emit('acknowledge-role-end', receipt, 'runtime');
  f.end(baseline, 'result-abort');
  f.apply();
  assert.equal(f.state.executions.at(-1)!.terminal!.reason, 'completion-timeout');
  assert.deepEqual(replayHumanLoopLedger(f.ledger).state, f.state);
});

test('Recovery retires interrupted and queued dispatch without inventing task completion', () => {
  const f = fixture();
  f.receive('original'); f.admit('original'); f.route('implement'); f.createCycle(); f.planCycle();
  f.start('implementer', 'cycle', 'engine');
  f.receive('waiting');
  f.emit('execution-unknown', { reason: 'Native acknowledgement was not observed.', evidenceRef: 'lost-ack' });
  const before = structuredClone(f.state);
  f.emit('recover', { recoveryId: 'recovery-1', recoveredAt: '2026-09-20T04:00:00Z', evidenceRef: 'retained-history', design, nativeUsers: [] });
  assert.deepEqual(f.state.executions, [...before.executions, before.activeTask]);
  assert.deepEqual(f.state.cycles[0]!.tasks, before.cycles[0]!.tasks);
  assert.equal(f.state.cycles[0]!.phase, 'retired');
  assert.deepEqual(f.state.requests.map(({ status }) => status), ['retired', 'retired']);
  assert.deepEqual(f.state.requests.map(({ message }) => message), before.requests.map(({ message }) => message));
  assert.deepEqual(humanExecutionQueue(f.state), []);
  assert.equal(nextHumanRequest(f.state), null);
  assert.equal(f.state.activeTask, null);
  assert.equal(f.state.uncertainty, null);
  assert.deepEqual(f.state.recoveries?.[0]?.uncertainty, before.uncertainty);
  assert.equal(f.state.recoveries?.[0]?.taskId, before.activeTask?.binding.id);
  assert.deepEqual(replayHumanLoopLedger(f.ledger).state, f.state);
  f.receive('new-instruction');
  assert.equal(nextHumanRequest(f.state)?.id, 'new-instruction');
  f.admit('new-instruction');
  assert.equal(f.start('router').binding.requestId, 'new-instruction');
});

test('Recovery is Host-only and retains prior Stop evidence without claiming acknowledgement', () => {
  const f = fixture();
  f.receive('original'); f.admit('original'); f.start('router'); f.receive('waiting');
  f.emit('request-stop', { stopId: 'stop' }, 'user');
  const stop = structuredClone(f.state.stop);
  const recovery = { recoveryId: 'recovery-1', recoveredAt: '2026-09-20T04:00:00Z', evidenceRef: 'retained-history', design, nativeUsers: [] };
  assert.throws(() => f.emit('recover', recovery, 'agent'), /actor/);
  assert.throws(() => f.emit('recover', { ...recovery, recoveredAt: 'invalid' }), /timestamp/);
  f.emit('recover', recovery);
  assert.equal(f.state.stop, null);
  assert.deepEqual(f.state.recoveries?.[0]?.stop, stop);
  assert.equal(f.state.recoveries?.[0]?.stop?.acknowledged, false);
  assert.deepEqual(humanExecutionQueue(f.state), []);
  assert.deepEqual(replayHumanLoopLedger(f.ledger).state, f.state);
});

function injectionCommands(f: ReturnType<typeof fixture>, delivery: 'steering' | 'queued' | 'idle' = 'steering') {
  const task = f.state.activeTask!, stopId = 'cooperative-stop', taskId = task.binding.id;
  const request = { stopId, taskId, requestId: task.binding.requestId,
    inputDigest: task.binding.inputDigest, promptDigest: policyHash('exact cooperative stop prompt') };
  const acknowledgement = { stopId, taskId, messageId: 'injection-message' };
  const delivered = { ...acknowledgement, eventId: 'injection-delivered', turnId: 'injection-turn',
    interactionId: delivery === 'steering' ? task.interactionId! : 'queued-interaction', delivery };
  const response = { stopId, taskId, inputDigest: task.binding.inputDigest, toolCallId: 'stop-response-tool',
    summary: 'Partial-work audit: changes are retained, remaining work is unfinished; no completion, Review or approval.',
    evidenceRefs: ['partial-work'] };
  const settlement = { stopId, taskId, endEventId: 'injection-ended' };
  const partial: RoleOutcome = { kind: 'stopped-partial', stopId, summary: response.summary, evidenceRefs: response.evidenceRefs };
  const begin = () => {
    f.emit('request-step-stop', { stopId }, 'user');
    f.emit('request-stop-injection', request);
  };
  const respond = () => {
    f.emit('acknowledge-stop-injection', acknowledgement, 'runtime');
    f.emit('deliver-stop-injection', delivered, 'runtime');
    f.emit('record-stop-response', response, 'agent');
  };
  const settle = () => f.emit('settle-stop-injection', settlement, 'runtime');
  return { request, acknowledgement, delivered, response, settlement, partial, begin, respond, settle };
}

function designerContentAnswer(liveAuthorization = true) {
  const f = fixture(liveAuthorization);
  f.receive('design-request', null, 'I want a website for my neighborhood coffee shop.');
  f.admit('design-request'); f.route('design'); f.start('designer');
  const result = f.submit({ kind: 'designer-changed', summary: 'Initial website Design.', artifactRef: 'website-design',
    questions: [{
      id: 'content-readiness', context: 'Business details are incomplete.',
      question: 'How should those business details be handled when the website is implemented?',
      whyItMatters: 'The published website needs accurate details.', importance: 'advisory', unanswered,
      options: [{ id: 'placeholders', label: 'Build with clear placeholders', implication: 'Draft details before launch.' },
        { id: 'collect', label: 'Collect the details first', implication: 'Provide accurate details before implementation.' }],
      allowFreeform: false,
    }] });
  f.end();
  f.apply({ previous: design, current: { revisionId: 'website-design', digest: 'c'.repeat(64) },
    receiptId: 'website-publication', artifactRef: 'website-design' });
  f.present();
  assert.equal(f.state.cycles.length, 0, 'Design publication itself is a handoff, not automatic implementation.');
  f.receive('answer-only', { schemaVersion: 'human-question-answers/v1', answers: [{
    questionId: 'content-readiness', sourceResultId: result.resultId, kind: 'option', value: 'placeholders',
  }] }, 'Question form submission.');
  f.admit('answer-only');
  return { f, result };
}

test('a saved Designer answer is a new interpreted request, not an automatic implementation or role-origin veto', () => {
  const { f, result } = designerContentAnswer();
  assert.equal(f.state.cycles.length, 0);
  assert.equal(f.state.activeTask, null);
  f.route('implement', null, [{ questionId: 'content-readiness', sourceResultId: result.resultId }]);
  assert.equal(f.state.cycles.length, 0, 'Router interpretation still needs explicit Host cycle admission.');
  f.createCycle();
  assert.equal(f.state.cycles[0]!.originRequestId, 'answer-only');
  assert.deepEqual(f.state.cycles[0]!.design, f.state.design);
});

test('historical Designer-answer routes replay exactly without granting new live implementation authority', () => {
  const { f, result } = designerContentAnswer(false);
  f.route('implement', null, [{ questionId: 'content-readiness', sourceResultId: result.resultId }]);
  const beforeCycle = replayHumanLoopLedger(f.ledger);
  assert.deepEqual(beforeCycle.state, f.state);
  assert.throws(() => validateHumanImplementationAuthorization(beforeCycle.state, 'start-cycle',
    { cycleId: 'cycle', design: f.state.design, baseline }), /Explicit user confirmation/);
  f.createCycle();
  const retained = replayHumanLoopLedger(f.ledger);
  assert.deepEqual(retained.state, f.state);
  const task = { id: 'next', dispatchId: 'next', sessionId: 'private', requestId: 'answer-only', cycleId: 'cycle',
    internalTaskId: null, inputDigest: policyHash('next'), before: baseline, design: f.state.design };
  for (const role of ['planner', 'implementer']) {
    assert.throws(() => validateHumanImplementationAuthorization(retained.state, 'start-role', { ...task, role }), /Explicit user confirmation/);
  }
  assert.throws(() => f.emit('start-role', { ...task, role: 'implementer', internalTaskId: 'engine' }), /acceptance|plan|task/i);
  assert.deepEqual(replayHumanLoopLedger(f.ledger).state, retained.state);
});

test('a historically accepted Designer-answer route can settle Stop without authorizing any successor', () => {
  const { f, result } = designerContentAnswer(false);
  f.start('router');
  const route = f.submit({ kind: 'route', intent: 'implement', cycleId: null, summary: 'Previously accepted interpretation.',
    resolvedQuestions: [{ questionId: 'content-readiness', sourceResultId: result.resultId }] });
  f.emit('request-step-stop', { stopId: 'stop-historical-router' }, 'user');
  f.end();
  assert.doesNotThrow(() => validateHumanImplementationAuthorization(f.state, 'apply-result',
    { resultId: route.resultId, designPublication: null }), 'Settling an existing result is not fresh implementation admission.');
  f.apply();
  assert.equal(f.state.executions.at(-1)!.result!.resultId, route.resultId);
  assert.equal(f.state.cycles.length, 0);
  f.emit('confirm-stop', { stopId: 'stop-historical-router', snapshot: baseline });
  assert.equal(f.state.requests.at(-1)!.status, 'stopped');
});

for (const hasFindings of [false, true]) test(`whole-plan Review ${hasFindings ? 'with findings' : 'without findings'} is a normal persisted handoff before the next request`, () => {
  const f = fixture();
  f.receive('implement'); f.admit('implement'); f.route('implement'); f.createCycle();
  f.start('planner', 'cycle'); f.finish({ kind: 'internal-plan', plan: plan() });
  const cycle = f.state.cycles[0]!;
  assert.throws(() => f.emit('accept-plan', { cycleId: cycle.id, acceptance: {} }, 'user'), /actor/);
  assert.throws(() => f.start('implementer', 'cycle', 'engine'), /Host plan acceptance/);
  f.accept();
  assert.equal(f.state.cycles[0]!.acceptance!.authority, 'host');
  assert.equal(f.state.requests[0]!.message, '  Exact implement\nrequest.');
  f.start('implementer', 'cycle', 'engine');
  f.emit('report-progress', { schemaVersion: 'human-task-progress/v1', taskId: 'engine', planDigest: f.state.cycles[0]!.plan!.digest,
    status: 'progress', summary: 'Writing the engine.', evidenceRefs: [] }, 'agent');
  assert.equal(f.state.cycles[0]!.tasks[0]!.status, 'running');
  assert.throws(() => f.submit({ kind: 'implementation-result', planDigest: f.state.cycles[0]!.plan!.digest,
    completedTaskIds: ['engine', 'view'], summary: 'All done.', evidenceRefs: [] }), /Whole-plan completion/);
  f.receive('queued-follow-up');
  f.taskResult('engine');
  assert.equal(f.state.activeRequestId, 'implement');
  assert.throws(() => f.admit('queued-follow-up'), /handoff, internal work/);
  assert.throws(() => f.start('reviewer', 'cycle'), /whole-plan boundary/);
  f.start('implementer', 'cycle', 'view'); f.taskResult('view');
  assert.equal(f.state.executions.filter(({ binding }) => binding.role === 'reviewer').length, 0);
  f.start('implementer', 'cycle');
  f.finish({ kind: 'implementation-result', planDigest: f.state.cycles[0]!.plan!.digest,
    completedTaskIds: ['engine', 'view'], summary: 'All internal tasks are complete in the project.', evidenceRefs: ['engine', 'view'] });
  assert.equal(f.state.cycles[0]!.phase, 'review-pending');
  f.start('reviewer', 'cycle');
  assert.throws(() => f.submit({ kind: 'review-result', planDigest: f.state.cycles[0]!.plan!.digest,
    summary: 'Only checked the last task.', assessments: [{ taskId: 'view', criterionId: 'view-correct',
      status: 'supported', evidenceRefs: ['last-file'] }], findings: [], verificationLimits: [], evidenceRefs: [], questions: [] }), /entire internal plan/);
  f.finish({ kind: 'review-result', planDigest: f.state.cycles[0]!.plan!.digest,
    summary: hasFindings ? 'Interactive evidence is missing.' : 'No issues found.',
    assessments: plan().tasks.flatMap((task) => task.criteria.map((criterion) => ({ taskId: task.id, criterionId: criterion.id,
      status: hasFindings ? 'unverified' as const : 'supported' as const, evidenceRefs: ['review-snapshot'] }))),
    findings: hasFindings ? [{ id: 'playthrough', kind: 'missing-evidence', summary: 'Missing keyboard playthrough.',
      consequence: 'The rendered interaction is not verified.', evidenceRefs: ['review-snapshot'] }] : [],
    verificationLimits: [], evidenceRefs: ['review-snapshot'], questions: hasFindings ? [question] : [] });
  assert.equal(f.state.cycles[0]!.phase, 'completed');
  assert.equal(f.state.uncertainty, null);
  assert.equal(f.state.requests[0]!.status, 'handoff-pending');
  assert.throws(() => f.admit('queued-follow-up'), /handoff/);
  f.present();
  if (hasFindings) {
    assert.equal(nextHumanRequest(f.state), null);
    const source = f.state.questions[0]!;
    f.receive('review-answer', { schemaVersion: 'human-question-answers/v1',
      answers: [{ questionId: source.id, sourceResultId: source.source.resultId, kind: 'option', value: 'keep' }] });
    f.admit('review-answer'); f.route('implement', null, [{ questionId: source.id, sourceResultId: source.source.resultId }]);
  } else { f.admit('queued-follow-up'); f.route('implement'); }
  f.emit('start-cycle', { cycleId: 'follow-up-cycle', design, baseline: snapshot('after-view') });
  assert.equal(f.state.cycles.length, 2);
  assert.equal(f.state.cycles[0]!.reviewResult!.outcome.kind, 'review-result');
  assert.equal(f.state.requests[0]!.status, 'completed');
});

for (const changed of [false, true]) test(`Designer ${changed ? 'changed' : 'unchanged'} outcome is explicit and does not invent implementation`, () => {
  const f = fixture();
  f.receive('design'); f.admit('design'); f.route('design'); f.start('designer');
  f.submit(changed
    ? { kind: 'designer-changed', summary: 'Added quality labels.', artifactRef: 'validated-artifact', questions: [question] }
    : { kind: 'designer-unchanged', summary: 'No Design change was needed.', explanation: 'The current Design already specifies it.', questions: [question] });
  f.end();
  f.apply(changed ? { previous: design, current: { revisionId: 'design-2', digest: 'c'.repeat(64) },
    receiptId: 'publication', artifactRef: 'validated-artifact' } : null);
  assert.equal(f.state.cycles.length, 0);
  assert.equal(f.state.questions[0]!.source.role, 'designer');
  assert.equal(f.state.questions[0]!.source.design.revisionId, changed ? 'design-2' : 'design-1');
  assert.equal(f.state.handoffs[0]!.result.outcome.kind, changed ? 'designer-changed' : 'designer-unchanged');
  f.present();
  assert.equal(f.state.activeRequestId, null);
  assert.equal(f.state.activeTask, null);
});

for (const duringCoding of [false, true]) for (const answerMode of ['option', 'freeform']) test(`Design prerequisite during ${duringCoding ? 'coding' : 'planning'} resumes the same cycle after question-UI ${answerMode} answer`, () => {
  const f = fixture();
  f.receive('implement'); f.admit('implement'); f.route('implement'); f.createCycle();
  if (duringCoding) {
    f.planCycle(); f.start('implementer', 'cycle', 'engine'); f.taskResult('engine');
    f.start('implementer', 'cycle', 'view');
  } else f.start('planner', 'cycle');
  const retained = duringCoding ? snapshot('partially-written-view') : baseline;
  const concern = f.finish({ kind: 'design-concern', reason: 'The requested interaction would change the Design.',
    summary: 'Your direction is needed; any existing code is retained.', questions: [question] }, retained);
  assert.equal(f.state.cycles[0]!.phase, 'waiting-input');
  assert.equal(f.state.cycles[0]!.current.digest, retained.digest);
  assert.equal(f.state.executions.some(({ binding }) => binding.role === 'reviewer' || binding.role === 'designer'), false);
  f.receive('unrelated-queued'); f.present();
  assert.equal(nextHumanRequest(f.state), null);
  assert.throws(() => f.admit('unrelated-queued'), /question-UI answers have priority/);
  assert.equal(f.state.questions[0]!.state, 'open');
  f.receive('answer', { schemaVersion: 'human-question-answers/v1',
    answers: [{ questionId: question.id, sourceResultId: concern.resultId,
      kind: answerMode, value: answerMode === 'option' ? 'keep' : 'Keep the current Design and continue with the remaining work.' }] });
  f.admit('answer');
  f.route('resume-cycle', 'cycle', [{ questionId: question.id, sourceResultId: concern.resultId }]);
  f.emit('resume-cycle', { cycleId: 'cycle', design, snapshot: retained });
  assert.equal(f.state.cycles.length, 1);
  assert.deepEqual(f.state.cycles[0]!.requestIds, ['implement', 'answer']);
  assert.equal(f.state.questions[0]!.state, 'answered');
  assert.equal(f.state.cycles[0]!.phase, duringCoding ? 'implementing' : 'planning');
  if (duringCoding) {
    assert.equal(f.state.cycles[0]!.tasks[0]!.status, 'completed');
    assert.equal(f.state.cycles[0]!.tasks[1]!.status, 'pending');
    assert.equal(f.state.cycles[0]!.planHistory.length, 0);
    assert.throws(() => f.start('implementer', 'cycle', 'engine'), /completed/);
    f.start('implementer', 'cycle', 'view');
  }
});

for (const intent of ['resume-cycle', 'replan-cycle'] as const) test(`Designer follow-up answer permits ${intent} only for its existing source-bound cycle`, () => {
  const f = fixture();
  f.receive('implement'); f.admit('implement'); f.route('implement'); f.createCycle(); f.start('planner', 'cycle');
  const concern = f.finish({ kind: 'design-concern', reason: 'Clarify the interface scope.',
    summary: 'Planning needs a Design decision.', questions: [question] });
  f.present();
  f.receive('design-clarification', { schemaVersion: 'human-question-answers/v1',
    answers: [{ questionId: question.id, sourceResultId: concern.resultId, kind: 'option', value: 'change' }] });
  f.admit('design-clarification');
  f.route('design', null, [{ questionId: question.id, sourceResultId: concern.resultId }]);
  f.start('designer');
  const followup = f.finish({ kind: 'designer-unchanged', summary: 'Confirm existing behavior.',
    explanation: 'No source revision was necessary.', questions: [question] });
  f.present();
  assert.equal(f.state.questions.at(-1)!.source.role, 'designer');
  assert.equal(f.state.questions.at(-1)!.source.cycleId, 'cycle');
  f.receive('designer-answer', { schemaVersion: 'human-question-answers/v1',
    answers: [{ questionId: question.id, sourceResultId: followup.resultId, kind: 'option', value: 'keep' }] });
  f.admit('designer-answer');
  const resolvedQuestions = [{ questionId: question.id, sourceResultId: followup.resultId }];
  f.route(intent, 'cycle', resolvedQuestions);
  f.emit(intent === 'resume-cycle' ? 'resume-cycle' : 'prepare-replan', { cycleId: 'cycle', design, snapshot: baseline });
  f.start('planner', 'cycle');
  assert.equal(f.state.cycles.length, 1);
  assert.equal(f.state.cycles[0]!.originRequestId, 'implement');
  assert.equal(f.state.activeTask!.binding.requestId, 'designer-answer');
});

test('unrelated/stale answers cannot resolve product questions or silently resume a cycle', () => {
  const f = fixture();
  f.receive('implement'); f.admit('implement'); f.route('implement'); f.createCycle(); f.start('planner', 'cycle');
  const concern = f.finish({ kind: 'design-concern', reason: 'Need product direction.', summary: 'No code changed.', questions: [question] });
  f.present();
  assert.throws(() => f.receive('stale', { schemaVersion: 'human-question-answers/v1',
    answers: [{ questionId: 'direction', sourceResultId: 'wrong-result', kind: 'option', value: 'keep' }] }), /stale or unknown/);
  f.receive('unrelated');
  assert.throws(() => f.admit('unrelated'), /question-UI/);
  assert.equal(f.state.questions[0]!.state, 'open');
});

for (const queued of [false, true]) test(`option-like ordinary chat ${queued ? 'before' : 'after'} handoff cannot answer or resume questioned work`, () => {
  const f = fixture();
  f.receive('implement'); f.admit('implement'); f.route('implement'); f.createCycle(); f.start('planner', 'cycle');
  const concern = f.finish({ kind: 'design-concern', reason: 'Need Design direction.', summary: 'No code was changed.', questions: [question] });
  if (queued) f.receive('chat', null, 'Keep the current Design and continue.');
  f.present();
  if (!queued) f.receive('chat', null, 'Keep the current Design and continue.');
  assert.throws(() => f.admit('chat'), /question-UI/);
  assert.equal(f.state.questions[0]!.state, 'open');
  assert.equal(f.state.cycles[0]!.phase, 'waiting-input');
  assert.equal(f.state.requests.at(-1)!.status, 'waiting');
});

test('changed direction replans the same cycle while preserving completed unchanged tasks and all original code evidence', () => {
  const f = fixture();
  f.receive('implement'); f.admit('implement'); f.route('implement'); f.createCycle(); f.planCycle();
  f.start('implementer', 'cycle', 'engine'); f.taskResult('engine'); f.start('implementer', 'cycle', 'view');
  const retained = snapshot('partial-view');
  const concern = f.finish({ kind: 'design-concern', reason: 'Clarify the interface scope.',
    summary: 'The engine is done and partial view code is retained.', questions: [question] }, retained);
  f.present();
  f.receive('scope-answer', { schemaVersion: 'human-question-answers/v1',
    answers: [{ questionId: 'direction', sourceResultId: concern.resultId, kind: 'freeform', value: 'Keep the engine and simplify the view.' }] });
  f.admit('scope-answer');
  f.route('replan-cycle', 'cycle', [{ questionId: 'direction', sourceResultId: concern.resultId }]);
  f.emit('prepare-replan', { cycleId: 'cycle', design, snapshot: retained });
  f.start('planner', 'cycle');
  const next = plan(); next.version = 2; next.baseline = retained; next.tasks[1]!.title = 'Implement the simpler interface';
  f.finish({ kind: 'internal-plan', plan: next }); f.accept();
  assert.equal(f.state.cycles.length, 1);
  assert.deepEqual(f.state.cycles[0]!.baseline, baseline);
  assert.equal(f.state.cycles[0]!.tasks[0]!.status, 'completed');
  assert.equal(f.state.cycles[0]!.tasks[1]!.status, 'pending');
  assert.equal(f.state.cycles[0]!.planHistory.length, 1);
  assert.equal(f.state.cycles[0]!.acceptance!.requestId, 'scope-answer');
});

test('a changed Design invalidates old task completion even when task text is unchanged', () => {
  const f = fixture();
  f.receive('implement'); f.admit('implement'); f.route('implement'); f.createCycle(); f.planCycle();
  f.start('implementer', 'cycle', 'engine'); f.taskResult('engine'); f.start('implementer', 'cycle', 'view');
  const retained = snapshot('partial-view');
  const concern = f.finish({ kind: 'design-concern', reason: 'Design change needed.', summary: 'Existing code is retained.', questions: [question] }, retained);
  f.present();
  f.receive('ask-designer', { schemaVersion: 'human-question-answers/v1',
    answers: [{ questionId: 'direction', sourceResultId: concern.resultId, kind: 'option', value: 'change' }] });
  f.admit('ask-designer'); f.route('design', null, [{ questionId: 'direction', sourceResultId: concern.resultId }]);
  f.start('designer');
  f.submit({ kind: 'designer-changed', summary: 'New agreed behavior.', artifactRef: 'new-design', questions: [{ ...question, id: 'continue-new' }] });
  f.end();
  const changed = { revisionId: 'design-2', digest: 'c'.repeat(64) };
  f.apply({ previous: design, current: changed, receiptId: 'publication', artifactRef: 'new-design' }); f.present();
  const currentQuestion = f.state.questions.find(({ id }) => id === 'continue-new')!;
  assert.equal(currentQuestion.source.cycleId, 'cycle');
  f.receive('replan-answer', { schemaVersion: 'human-question-answers/v1',
    answers: [{ questionId: currentQuestion.id, sourceResultId: currentQuestion.source.resultId, kind: 'option', value: 'keep' }] });
  f.admit('replan-answer'); f.route('replan-cycle', 'cycle', [{ questionId: currentQuestion.id, sourceResultId: currentQuestion.source.resultId }]);
  f.emit('prepare-replan', { cycleId: 'cycle', design: changed, snapshot: retained });
  f.start('planner', 'cycle');
  const next = plan(); next.version = 2; next.design = changed; next.baseline = retained;
  f.finish({ kind: 'internal-plan', plan: next }); f.accept();
  assert.equal(f.state.cycles[0]!.tasks[0]!.status, 'pending');
  assert.equal(f.state.cycles[0]!.tasks[1]!.status, 'pending');
  assert.deepEqual(f.state.cycles[0]!.current, retained);
  assert.equal(f.state.cycles[0]!.planHistory.length, 1);
});

test('current answers front-insert FIFO as separate barriers, partial answers keep the gate, and ordinary messages later batch without rewritten originals', () => {
  const f = fixture();
  f.receive('design'); f.admit('design'); f.route('design'); f.start('designer');
  const second = { ...question, id: 'second' };
  f.finish({ kind: 'designer-unchanged', summary: 'Choose two product details.', explanation: 'No change yet.', questions: [question, second] });
  f.receive('ordinary-a', null, '  First queued message.\nKeep this exact text.');
  f.present();
  f.receive('ordinary-b', null, 'Second queued message.');
  assert.equal(nextHumanRequest(f.state), null);
  const sourceResultId = f.state.handoffs[0]!.result.resultId;
  const answer = (id: string, questionId: string) => f.receive(id, { schemaVersion: 'human-question-answers/v1',
    answers: [{ questionId, sourceResultId, kind: 'option', value: 'keep' }] });
  answer('answer-a', 'direction'); answer('answer-b', 'second');
  assert.deepEqual(humanExecutionQueue(f.state).map(({ id }) => id), ['answer-a', 'answer-b', 'ordinary-a', 'ordinary-b']);
  assert.deepEqual(nextHumanBatch(f.state).map(({ id }) => id), ['answer-a']);
  assert.throws(() => f.admit('answer-b'), /priority/);
  f.admit('answer-a');
  assert.throws(() => f.admit('answer-b'), /handoff, internal work/);
  f.route('answer', null, [{ questionId: 'direction', sourceResultId }]);
  f.start('agent'); f.finish({ kind: 'answer', summary: 'First answer handled.', report: 'The second question still needs its answer.', evidenceRefs: [] });
  f.present();
  assert.equal(hasQuestionBlockers(f.state), true);
  assert.deepEqual(nextHumanBatch(f.state).map(({ id }) => id), ['answer-b']);
  f.admit('answer-b'); f.route('answer', null, [{ questionId: 'second', sourceResultId }]);
  f.start('agent'); f.finish({ kind: 'answer', summary: 'Second answer handled.', report: 'Both submitted answers are handled.', evidenceRefs: [] });
  f.present();
  assert.equal(hasQuestionBlockers(f.state), false);
  assert.deepEqual(nextHumanBatch(f.state).map(({ id }) => id), ['ordinary-a', 'ordinary-b']);
  f.admit('ordinary-a');
  assert.deepEqual(f.state.activeBatchRequestIds, ['ordinary-a', 'ordinary-b']);
  assert.equal(f.state.requests.find(({ id }) => id === 'ordinary-a')!.message, '  First queued message.\nKeep this exact text.');
  f.route('answer'); f.start('agent');
  f.finish({ kind: 'answer', summary: 'Both ordinary requests handled.', report: 'One report for the exact ordered ordinary batch.', evidenceRefs: [] });
  assert.deepEqual(f.state.handoffs.at(-1)!.requestIds, ['ordinary-a', 'ordinary-b']);
  f.present();
  assert.deepEqual(f.state.requests.map(({ id }) => id), ['design', 'ordinary-a', 'ordinary-b', 'answer-a', 'answer-b']);
  assert.equal(f.state.requests.every(({ status }) => status === 'completed'), true);
});

test('an advisory Designer question permits explicit implementation and remains answerable after a new Review source', () => {
  const f = fixture();
  f.receive('design'); f.admit('design'); f.route('design'); f.start('designer');
  const original = f.finish({ kind: 'designer-unchanged', summary: 'Optional detail.', explanation: 'Enough Design to proceed.',
    questions: [{ ...question, importance: 'advisory', unanswered }] }); f.present();
  const originalQuestion = structuredClone(f.state.questions[0]);
  assert.equal(f.state.cycles.length, 0);
  f.receive('implement', null, 'Continue implementation without deciding the optional detail.');
  f.admit('implement'); f.route('implement'); f.createCycle(); f.planCycle();
  for (const id of ['engine', 'view']) { f.start('implementer', 'cycle', id); f.taskResult(id); }
  const digest = f.state.cycles[0]!.plan!.digest;
  f.start('implementer', 'cycle');
  f.finish({ kind: 'implementation-result', planDigest: digest, completedTaskIds: ['engine', 'view'],
    summary: 'Implementation ready for Review.', evidenceRefs: ['engine.ts', 'view.ts'] });
  f.start('reviewer', 'cycle');
  f.finish({ kind: 'review-result', planDigest: digest, summary: 'Review complete.', evidenceRefs: ['engine.ts', 'view.ts'],
    assessments: [{ taskId: 'engine', criterionId: 'engine-correct', status: 'supported', evidenceRefs: ['engine.ts'] },
      { taskId: 'view', criterionId: 'view-correct', status: 'supported', evidenceRefs: ['view.ts'] }],
    findings: [], verificationLimits: [], questions: [{ ...question, id: 'review-detail', importance: 'advisory', unanswered }] });
  f.present();
  assert.deepEqual(f.state.questions[0], originalQuestion);
  assert.equal(f.state.questions.length, 2);
  assert.equal(f.state.cycles[0]!.phase, 'completed');
  f.receive('old-answer', { schemaVersion: 'human-question-answers/v1',
    answers: [{ questionId: question.id, sourceResultId: original.resultId, kind: 'option', value: 'keep' }] });
  assert.equal(f.state.questions[0]!.state, 'answered');
  assert.equal(f.state.requests.at(-1)!.status, 'waiting');
  assert.equal(f.state.questions[1]!.state, 'open');
  f.admit('old-answer'); f.route('answer'); f.start('agent');
  f.finish({ kind: 'answer', summary: 'Already completed work acknowledged.', report: 'Original context interpreted now.', evidenceRefs: [] });
  f.present();
  assert.equal(f.state.cycles.length, 1, 'Answer did not revive or create implementation automatically.');
  assert.deepEqual(replayHumanLoopLedger(f.ledger).state, f.state);
});

test('mixed implementation intent survives a blocking Designer follow-up without starting work early', () => {
  const f = fixture(true, false);
  f.receive('design'); f.admit('design'); f.route('design'); f.start('designer');
  const original = f.finish({ kind: 'designer-unchanged', summary: 'Choose the intended changes.', explanation: 'Clarify both targets.',
    questions: (['design', 'implementation'] as const).map((target) => ({ ...question, id: target, options: [
      { id: 'change', label: `Change ${target === 'design' ? 'Design' : 'implementation'} - use the requested behavior`,
        implication: `Update ${target}.`, resolutionTarget: target },
    ] })) }); f.present();
  f.receive('mixed', { schemaVersion: 'human-question-answers/v1', answers: ['design', 'implementation'].map(id => ({
    questionId: id, sourceResultId: original.resultId, kind: 'option', value: 'change',
  })) });
  f.admit('mixed'); f.route('design'); f.start('designer');
  const followup = f.finish({ kind: 'designer-unchanged', summary: 'One remaining decision.', explanation: 'The change needs clarification.',
    questions: [{ ...question, id: 'followup' }] });
  assert.throws(() => f.emit('present-handoff', { handoffId: f.state.handoffs.at(-1)!.id,
    implementationConfirmation: { id: 'too-early', createdAt: '2026-09-28T10:00:00Z' } }), /Only settled mixed answers/);
  f.present();
  assert.equal(f.state.implementationConfirmations?.length ?? 0, 0);
  assert.equal(f.state.cycles.length, 0);
  f.receive('clarification', { schemaVersion: 'human-question-answers/v1',
    answers: [{ questionId: 'followup', sourceResultId: followup.resultId, kind: 'option', value: 'keep' }] });
  f.admit('clarification'); const route = f.route('design'); f.start('designer');
  const settled = f.finish({ kind: 'designer-unchanged', summary: 'All choices settled.', explanation: 'The Design already matches.', questions: [] });
  f.emit('present-handoff', { handoffId: f.state.handoffs.at(-1)!.id,
    implementationConfirmation: { id: 'after-clarification', createdAt: '2026-09-28T10:01:00Z' } });
  const confirmation = f.state.implementationConfirmations!.at(-1)!;
  assert.equal(confirmation.afterDesignResultId, settled.resultId);
  assert.equal(confirmation.routeResultId, route.resultId);
  assert.deepEqual(confirmation.requestIds, ['clarification']);
  assert.throws(() => f.createCycle(), /completed implementation route/);
  assert.throws(() => validateHumanImplementationAuthorization(f.state, 'start-cycle', {}), /Explicit user confirmation/);
  f.emit('decide-implementation-confirmation', { confirmationId: confirmation.id, decision: 'approved',
    decidedAt: '2026-09-28T10:02:00Z' }, 'user');
  f.createCycle();
  assert.equal(f.state.cycles.length, 1);
  assert.deepEqual(replayHumanLoopLedger(f.ledger).state, f.state);
});

test('mixed answers save atomically and retain priority, exact retries and hold-through-processing', () => {
  const f = fixture();
  f.receive('design'); f.admit('design'); f.route('design'); f.start('designer');
  const result = f.finish({ kind: 'designer-unchanged', summary: 'Mixed choices.', explanation: 'One required prerequisite.',
    questions: [question, { ...question, id: 'optional', importance: 'advisory', unanswered }, { ...question, id: 'remaining' }] });
  f.present(); f.receive('normal-1');
  const answers = { schemaVersion: 'human-question-answers/v1', answers: [
    { questionId: 'direction', sourceResultId: result.resultId, kind: 'option', value: 'keep' },
    { questionId: 'optional', sourceResultId: result.resultId, kind: 'freeform', value: '  Exact advisory\nanswer.' },
  ] };
  const before = structuredClone(f.state);
  assert.throws(() => f.receive('invalid', { ...answers, answers: [...answers.answers,
    { questionId: 'missing', sourceResultId: result.resultId, kind: 'freeform', value: 'Wrong source.' }] }), /stale or unknown/);
  assert.deepEqual(f.state, before);
  f.receive('mixed', answers); f.receive('normal-2');
  const saved = structuredClone(f.state.requests.find(r => r.id === 'mixed')!);
  assert.equal(saved.blockingAnswerRefs.length, 1);
  assert.equal(saved.answers!.answers.length, 2);
  assert.equal(saved.status, 'waiting');
  assert.deepEqual(f.state.questions.map(q => q.state), ['answered', 'answered', 'open']);
  f.receive('mixed', answers);
  assert.deepEqual(f.state.requests.find(r => r.id === 'mixed'), saved);
  assert.throws(() => f.receive('mixed', answers, 'Changed retry'), /Conflicting retry/);
  assert.deepEqual(humanExecutionQueue(f.state).map(r => r.id), ['mixed', 'normal-1', 'normal-2']);
  f.admit('mixed'); f.route('answer'); f.start('agent');
  f.finish({ kind: 'answer', summary: 'Saved answers handled.', report: 'Remaining prerequisite not answered.', evidenceRefs: [] });
  assert.equal(hasQuestionBlockers(f.state), true);
  assert.equal(nextHumanRequest(f.state), null);
  f.present();
  assert.equal(nextHumanRequest(f.state), null);
  assert.deepEqual(replayHumanLoopLedger(f.ledger).state, f.state);
});

test('Close releases gates without changing answerability or processing and new-format replay is deterministic', () => {
  const f = fixture();
  f.receive('design'); f.admit('design'); f.route('design'); f.start('designer');
  const result = f.finish({ kind: 'designer-unchanged', summary: 'Two questions.', explanation: 'Choice needed.',
    questions: [question, { ...question, id: 'unanswered' }] }); f.present();
  f.receive('saved', { schemaVersion: 'human-question-answers/v1',
    answers: [{ questionId: question.id, sourceResultId: result.resultId, kind: 'option', value: 'keep' }] });
  const saved = structuredClone(f.state.requests.at(-1)!);
  assert.equal(hasQuestionBlockers(f.state), true);
  f.emit('release-question-gates', {});
  assert.equal(hasQuestionBlockers(f.state), false);
  assert.equal(f.state.requests.at(-1)!.status, 'waiting');
  assert.deepEqual(f.state.requests.at(-1)!.answers, saved.answers);
  assert.deepEqual(f.state.questions.map(q => q.state), ['answered', 'open']);
  f.emit('recover', { recoveryId: 'reopen', recoveredAt: '2026-09-22T10:00:00Z', evidenceRef: 'verified-fixture',
    design, nativeUsers: [] });
  assert.equal(nextHumanRequest(f.state), null);
  assert.equal(f.state.requests.at(-1)!.status, 'retired');
  f.receive('later', { schemaVersion: 'human-question-answers/v1',
    answers: [{ questionId: 'unanswered', sourceResultId: result.resultId, kind: 'option', value: 'keep' }] });
  assert.deepEqual(f.state.requests.at(-1)!.blockingAnswerRefs, []);
  assert.equal(nextHumanRequest(f.state)!.id, 'later');
  assert.deepEqual(replayHumanLoopLedger(f.ledger).state, f.state);
  assert.throws(() => replayHumanLoopLedger({ ...f.ledger, schemaVersion: 'human-loop-ledger/v1' }), /fresh workspace/);
});

test('one multi-question answer envelope is not merged with another answer or following ordinary messages', () => {
  const f = fixture();
  f.receive('design'); f.admit('design'); f.route('design'); f.start('designer');
  f.finish({ kind: 'designer-unchanged', summary: 'Questions.', explanation: 'No Design change.', questions: [question, { ...question, id: 'second' }] });
  f.present();
  const sourceResultId = f.state.handoffs.at(-1)!.result.resultId;
  f.receive('ordinary');
  f.receive('both', { schemaVersion: 'human-question-answers/v1', answers: ['direction', 'second'].map((questionId) =>
    ({ questionId, sourceResultId, kind: 'option', value: 'keep' })) });
  assert.throws(() => f.receive('separate', { schemaVersion: 'human-question-answers/v1',
    answers: [{ questionId: 'second', sourceResultId, kind: 'freeform', value: 'A separate submission.' }] }), /stale or unknown/);
  assert.deepEqual(nextHumanBatch(f.state).map(({ id }) => id), ['both']);
  f.admit('both');
  f.route('answer', null, ['direction', 'second'].map((questionId) => ({ questionId, sourceResultId })));
  f.start('agent'); f.finish({ kind: 'answer', summary: 'Both handled.', report: 'The first answer envelope alone was handled.', evidenceRefs: [] }); f.present();
  assert.equal(f.state.requests.some(({ id }) => id === 'separate'), false);
  assert.equal(nextHumanRequest(f.state)!.id, 'ordinary');
});

test('Stop discards queued processing without erasing a durably saved answer', () => {
  const f = fixture();
  f.receive('implement'); f.admit('implement'); f.route('implement'); f.createCycle(); f.planCycle();
  f.start('implementer', 'cycle', 'engine');
  const code = snapshot('retained-partial');
  f.finish({ kind: 'design-concern', summary: 'Need direction.', reason: 'Design question.', questions: [question] }, code);
  f.present();
  const sourceResultId = f.state.handoffs.at(-1)!.result.resultId;
  f.receive('ordinary');
  f.receive('answer', { schemaVersion: 'human-question-answers/v1',
    answers: [{ questionId: 'direction', sourceResultId, kind: 'option', value: 'keep' }] });
  f.emit('request-stop', { stopId: 'stop-question' }, 'user');
  assert.throws(() => f.receive('late-answer', { schemaVersion: 'human-question-answers/v1',
    answers: [{ questionId: 'direction', sourceResultId, kind: 'option', value: 'keep' }] }), /stale or unknown/);
  f.receive('after-stop');
  f.emit('confirm-stop', { stopId: 'stop-question', snapshot: code });
  assert.equal(hasQuestionBlockers(f.state), false);
  assert.equal(f.state.cycles[0]!.phase, 'stopped');
  assert.deepEqual(f.state.cycles[0]!.current, code);
  assert.equal(f.state.questions[0]!.state, 'answered');
  assert.equal(f.state.questions[0]!.answerRequestId, 'answer');
  assert.equal(f.state.requests.find(({ id }) => id === 'ordinary')!.status, 'discarded');
  assert.equal(f.state.requests.find(({ id }) => id === 'answer')!.status, 'discarded');
  assert.equal(nextHumanRequest(f.state)!.id, 'after-stop');
});

test('older effective blockers still gate execution and remain answerable after a newer source', () => {
  const f = fixture();
  f.receive('design'); f.admit('design'); f.route('design'); f.start('designer');
  f.finish({ kind: 'designer-unchanged', summary: 'First questions.', explanation: 'No change.', questions: [question, { ...question, id: 'historical' }] });
  f.present();
  const first = f.state.handoffs.at(-1)!.result.resultId;
  f.receive('ordinary');
  f.receive('answer-first', { schemaVersion: 'human-question-answers/v1',
    answers: [{ questionId: 'direction', sourceResultId: first, kind: 'option', value: 'change' }] });
  f.admit('answer-first'); f.route('design', null, [{ questionId: 'direction', sourceResultId: first }]); f.start('designer');
  f.finish({ kind: 'designer-unchanged', summary: 'Current question.', explanation: 'Clarify this current point.', questions: [{ ...question, id: 'current' }] });
  f.present();
  const current = f.state.handoffs.at(-1)!.result.resultId;
  assert.notEqual(current, first);
  f.receive('answer-current', { schemaVersion: 'human-question-answers/v1',
    answers: [{ questionId: 'current', sourceResultId: current, kind: 'option', value: 'keep' }] });
  f.admit('answer-current'); f.route('answer', null, [{ questionId: 'current', sourceResultId: current }]); f.start('agent');
  f.finish({ kind: 'answer', summary: 'Current interaction finished.', report: 'The submitted current answer was handled.', evidenceRefs: [] }); f.present();
  assert.equal(f.state.questions.find(({ id }) => id === 'historical')!.state, 'open');
  assert.equal(hasQuestionBlockers(f.state), true);
  assert.equal(nextHumanRequest(f.state), null);
  f.receive('answer-old', { schemaVersion: 'human-question-answers/v1',
    answers: [{ questionId: 'historical', sourceResultId: first, kind: 'option', value: 'keep' }] });
  f.admit('answer-old'); f.route('answer'); f.start('agent');
  f.finish({ kind: 'answer', summary: 'Old answer handled.', report: 'Original context retained.', evidenceRefs: [] }); f.present();
  assert.equal(nextHumanRequest(f.state)!.id, 'ordinary');
});

test('explicit Stop retains code and releases later new input after its actual native response', () => {
  const f = fixture();
  f.receive('implement'); f.admit('implement'); f.route('implement'); f.createCycle(); f.planCycle();
  f.start('implementer', 'cycle', 'engine');
  f.receive('old-1'); f.receive('old-2');
  f.emit('request-stop', { stopId: 'stop' }, 'user');
  f.receive('after-stop');
  assert.deepEqual(f.state.requests.map(({ id, status }) => [id, status]), [
    ['implement', 'active'], ['old-1', 'discarded'], ['old-2', 'discarded'], ['after-stop', 'waiting'],
  ]);
  assert.equal(f.state.requests[1]!.message, '  Exact old-1\nrequest.');
  assert.throws(() => f.emit('confirm-stop', { stopId: 'stop', snapshot: baseline }), /actual native operation response/);
  assert.throws(() => f.submit({ kind: 'task-result', taskId: 'engine', planDigest: f.state.cycles[0]!.plan!.digest,
    summary: 'Late result.', evidenceRefs: [] }), /not active/);
  const retained = snapshot('partial-engine');
  f.emit('record-native-stop', { stopId: 'stop', sessionId: 'private', interrupted: true });
  assert.equal(f.state.activeTask!.end, null);
  f.emit('confirm-stop', { stopId: 'stop', snapshot: retained });
  assert.equal(f.state.cycles[0]!.phase, 'stopped');
  assert.equal(f.state.cycles[0]!.current.digest, retained.digest);
  assert.equal(f.state.requests[0]!.status, 'stopped');
  assert.throws(() => f.admit('old-1'), /FIFO order/);
  f.admit('after-stop'); f.route('answer');
  assert.equal(f.state.activeRequestId, 'after-stop');
});

test('a late role start is fenced by its exact Stop before and after a new request owns execution', () => {
  const f = fixture();
  f.receive('implement'); f.admit('implement'); f.route('implement'); f.createCycle(); f.planCycle();
  f.start('implementer', 'cycle', 'engine'); f.taskResult('engine');
  f.start('implementer', 'cycle', 'view'); f.taskResult('view');
  const binding = { id: 'late-aggregate', dispatchId: 'late-dispatch', sessionId: 'private', requestId: 'implement',
    cycleId: 'cycle', role: 'implementer', internalTaskId: null, inputDigest: policyHash('late-aggregate'),
    before: f.state.cycles[0]!.current, design };
  const assertFenced = () => {
    const previous = f.state;
    assert.throws(() => f.emit('start-role', binding), { code: 'human-loop-stop', requestId: 'implement', stopId: 'stop' });
    assert.deepEqual(f.state, previous);
  };
  f.emit('request-stop', { stopId: 'stop' }, 'user');
  assertFenced();
  f.emit('confirm-stop', { stopId: 'stop', snapshot: binding.before });
  assertFenced();
  f.receive('new'); f.admit('new');
  assertFenced();
  assert.throws(() => f.emit('start-role', { ...binding, requestId: 'foreign' }), /No active user request owns this work/);
  f.route('answer'); f.start('agent');
  f.finish({ kind: 'answer', summary: 'New work.', report: 'Stopped code is retained.', evidenceRefs: [] }); f.present();
  assert.equal(f.state.uncertainty, null);
  assert.equal(f.state.cycles[0]!.phase, 'stopped');
});

test('after-step intent requires exact native settlement without policing ordinary project edits', () => {
  const f = fixture();
  f.receive('request'); f.admit('request');
  const task = f.start('router');
  f.emit('request-step-stop', { stopId: 'step-stop' }, 'user');
  assert.equal(f.state.stop!.mode, 'after-step');
  assert.equal(f.state.stop!.taskId, task.binding.id);
  assert.throws(() => f.emit('acknowledge-stop', { stopId: 'step-stop', taskId: task.binding.id }, 'runtime'), /Stop acknowledgement/);
  assert.throws(() => f.emit('role-not-sent', { taskId: task.binding.id, snapshot: baseline }), /stopped dispatch/);
  f.submit({ kind: 'route', intent: 'answer', cycleId: null, summary: 'Finished the current role.', resolvedQuestions: [] });
  const observed = snapshot('current-project');
  f.end(observed);
  assert.throws(() => f.emit('confirm-stop', { stopId: 'step-stop', snapshot: baseline }), /Host application/);
  f.apply();
  assert.throws(() => f.start('agent'), { code: 'human-loop-stop', stopId: 'step-stop', requestId: 'request' });
  f.emit('confirm-stop', { stopId: 'step-stop', snapshot: observed });
  assert.equal(f.state.stops[0]!.mode, 'after-step');
  assert.equal(f.state.executions[0]!.result!.outcome.kind, 'route');
  assert.equal(f.state.requests[0]!.status, 'stopped');
  assert.equal(f.state.uncertainty, null);
});

test('duplicate after-step clicks share one intent and new input waits for settlement', () => {
  const f = fixture();
  f.receive('request'); f.admit('request'); f.start('router'); f.receive('old');
  f.emit('request-step-stop', { stopId: 'first' }, 'user');
  const first = structuredClone(f.state.stop);
  assert.throws(() => f.receive('later'), /Stop after current step is still settling/);
  f.emit('request-step-stop', { stopId: 'second' }, 'user');
  assert.deepEqual(f.state.stop, first);
  assert.equal(f.state.requests.find(({ id }) => id === 'old')!.status, 'discarded');
  assert.equal(f.state.requests.some(({ id }) => id === 'later'), false);
  f.finish({ kind: 'route', intent: 'answer', cycleId: null, summary: 'Completed once.', resolvedQuestions: [] });
  f.emit('confirm-stop', { stopId: 'first', snapshot: baseline });
  f.receive('later');
  f.admit('later');
  assert.throws(() => f.emit('request-step-stop', { stopId: 'first' }, 'user'), /Stop identity was reused/);
  assert.equal(f.state.activeRequestId, 'later');
  assert.equal(f.state.stop, null);
});

test('after-step Stop releases old and newly produced gates while preserving question answerability', () => {
  const f = fixture();
  f.receive('design'); f.admit('design'); f.route('design'); f.start('designer');
  const first = f.finish({ kind: 'designer-unchanged', summary: 'Initial questions.', explanation: 'Current Design retained.',
    questions: [question, { ...question, id: 'still-open' }] }); f.present();
  f.receive('answer', { schemaVersion: 'human-question-answers/v1',
    answers: [{ questionId: question.id, sourceResultId: first.resultId, kind: 'option', value: 'keep' }] });
  f.admit('answer'); f.route('design', null, [{ questionId: question.id, sourceResultId: first.resultId }]);
  const genuinelyAnswered = structuredClone(f.state.questions[0]);
  f.start('designer'); f.emit('request-step-stop', { stopId: 'question-stop' }, 'user');
  const last = f.finish({ kind: 'designer-unchanged', summary: 'Final question.', explanation: 'The role settled without further work.',
    questions: [{ ...question, id: 'new-question' }] });
  f.present(); f.emit('confirm-stop', { stopId: 'question-stop', snapshot: baseline });
  assert.deepEqual(f.state.questions[0], { ...genuinelyAnswered, blockingActive: false });
  assert.equal(f.state.questions[0]!.state, 'answered');
  for (const item of f.state.questions.slice(1)) {
    assert.equal(item.state, 'open');
    assert.equal(item.answerRequestId, null);
    assert.equal(item.blockingActive, false);
    assert.equal(item.invalidation, undefined);
  }
  assert.equal(hasQuestionBlockers(f.state), false);
  assert.equal(f.state.requests.filter(({ answers }) => answers).length, 1, 'Stop never fabricates answer envelopes.');
  f.receive('fresh'); f.admit('fresh');
  f.receive('old-answer', { schemaVersion: 'human-question-answers/v1',
    answers: [{ questionId: 'new-question', sourceResultId: last.resultId, kind: 'option', value: 'keep' }] });
  assert.equal(f.state.activeRequestId, 'fresh');
});

test('a settling Router retains interpretation without undoing the answer saved before Stop', () => {
  const f = fixture();
  f.receive('design'); f.admit('design'); f.route('design'); f.start('designer');
  const result = f.finish({ kind: 'designer-unchanged', summary: 'Question.', explanation: 'No change.', questions: [question] }); f.present();
  f.receive('answer', { schemaVersion: 'human-question-answers/v1',
    answers: [{ questionId: question.id, sourceResultId: result.resultId, kind: 'option', value: 'keep' }] });
  f.admit('answer'); f.start('router');
  f.emit('request-step-stop', { stopId: 'router-stop' }, 'user');
  f.finish({ kind: 'route', intent: 'answer', cycleId: null, summary: 'The current interpretation finished.',
    resolvedQuestions: [{ questionId: question.id, sourceResultId: result.resultId }] });
  f.emit('confirm-stop', { stopId: 'router-stop', snapshot: baseline });
  assert.equal(f.state.questions[0]!.state, 'answered');
  assert.equal(f.state.questions[0]!.answerRequestId, 'answer');
  assert.equal(f.state.activeTask, null);
  assert.equal(hasQuestionBlockers(f.state), false);
});

test('known execution failure is not a Design question, partial completion or unknown owner', () => {
  const f = fixture();
  f.receive('implement'); f.admit('implement'); f.route('implement'); f.createCycle(); f.planCycle();
  const task = f.start('implementer', 'cycle', 'engine');
  f.emit('execution-failed', { taskId: task.binding.id, reason: 'Compiler could not run.', evidenceRef: 'actual-command-failure' });
  f.end(snapshot('partial-engine')); f.apply(); f.present();
  assert.equal(f.state.cycles[0]!.phase, 'failed');
  assert.equal(f.state.questions.length, 0);
  assert.equal(f.state.cycles[0]!.implementationResult, null);
  assert.equal(f.state.uncertainty, null);
  assert.equal(f.state.handoffs[0]!.result.outcome.kind, 'execution-failure');
});

test('legacy submit-result and native-end records retain their original identity validation', () => {
  const f = fixture();
  f.receive('question'); f.admit('question'); const task = f.start('router');
  f.emit('permission-state', { taskId: task.binding.id, waiting: true }, 'runtime');
  assert.throws(() => f.submit({ kind: 'route', intent: 'answer', cycleId: null, summary: 'Answer route.', resolvedQuestions: [] }), /not active/);
  f.emit('permission-state', { taskId: task.binding.id, waiting: false }, 'runtime');
  f.submit({ kind: 'route', intent: 'answer', cycleId: null, summary: 'Answer route.', resolvedQuestions: [] });
  assert.throws(() => f.apply(), /completed result.*code evidence/);
  assert.throws(() => f.emit('confirm-role-end', { proof: {
    taskId: task.binding.id, dispatchId: task.binding.dispatchId, sessionId: 'foreign', messageId: task.messageId,
    interactionId: task.interactionId, endEventId: 'end', quiescent: true, termination: 'result-abort', abortAcknowledged: true,
  }, snapshot: baseline }), /does not match/);
  f.emit('execution-unknown', { reason: 'Native acknowledgement was lost.', evidenceRef: 'rpc-failure' });
  f.receive('later');
  assert.throws(() => f.admit('later'), /uncertain/);
  assert.equal(f.state.requests.at(-1)!.status, 'waiting');
});

test('new schema rejects old state/ownership and conflicting duplicate commands without mutation', () => {
  const f = fixture();
  const command = { id: 'once', expectedRevision: f.state.revision, type: 'receive-request',
    data: { id: 'request', message: 'Exact input', receivedAt: '2026-09-14T09:25:00Z', answers: null } };
  const next = transitionHumanLoop(f.state, 'user', command);
  assert.equal(transitionHumanLoop(next, 'user', command), next);
  assert.throws(() => transitionHumanLoop(next, 'user', { ...command, data: { ...command.data, message: 'Changed input' } }), /Conflicting/);
  assert.equal(f.state.requests.length, 0);
  assert.throws(() => transitionHumanLoop({ ...next, schemaVersion: 'workflow-controller/v1' } as unknown as HumanLoopState, 'user', command), /Incompatible/);
  assert.throws(() => createHumanLoop({ worktreePath: 'source', targetWorktreePath: 'target' }), /exactly these fields/);
  const ledger = createHumanLoopLedger(f.state.owner, design);
  ledger.events.push({ authority: 'user', command });
  assert.deepEqual(replayHumanLoopLedger(JSON.parse(JSON.stringify(ledger))).state, next);
  assert.throws(() => replayHumanLoopLedger({ ...ledger, schemaVersion: 'workflow-controller/v1' }), /Incompatible workflow ledger/);
  assert.throws(() => replayHumanLoopLedger({ ...ledger, events: [{ authority: 'agent', command }] }), /actor/);
});

test('structured tools distinguish internal progress, final outcomes and shared source-bound questions', () => {
  const tools = humanLoopResultTools();
  assert.equal(tools.some(({ name }) => /approve|apply|recovery/.test(name)), false);
  assert.equal(humanLoopProgressTool.terminal, false);
  assert.equal(tools.every(({ terminal }) => terminal), true);
  const examples: Array<[HumanRole, RoleOutcome]> = [
    ['router', { kind: 'route', intent: 'answer', cycleId: null, summary: 'Read-only question.', resolvedQuestions: [] }],
    ['planner', { kind: 'internal-plan', plan: plan() }],
    ['implementer', { kind: 'task-result', taskId: 'engine', planDigest: 'a'.repeat(64), summary: 'Task report.', evidenceRefs: [] }],
    ['implementer', { kind: 'implementation-result', planDigest: 'a'.repeat(64), completedTaskIds: ['engine', 'view'], summary: 'Plan report.', evidenceRefs: [] }],
    ['planner', { kind: 'design-concern', reason: 'Design prerequisite.', summary: 'User direction needed.', questions: [question] }],
    ['designer', { kind: 'designer-unchanged', summary: 'No change.', explanation: 'Already specified.', questions: [question] }],
    ['reviewer', { kind: 'review-result', reviewFormat: 'decision-review/v2', coverageStatus: 'complete', planDigest: 'a'.repeat(64), summary: 'Review findings.',
      assessments: [],
      findings: [], verificationLimits: [], evidenceRefs: [], questions: [] }],
    ['agent', { kind: 'answer', summary: 'Answer.', report: 'The complete actual answer.', evidenceRefs: [] }],
  ];
  for (const [role, outcome] of examples) {
    const result = { schemaVersion: 'human-role-result/v1', resultId: `result-${outcome.kind}`, inputDigest: 'a'.repeat(64), outcome };
    const definition = tools.find((tool) => tool.kinds.includes(outcome.kind as typeof tool.kinds[number]))!;
    validatePolicyShape(definition.parameters, result);
    assert.deepEqual(parseRoleResult(role, result), result);
    assert.throws(() => parseRoleResult(role, { ...result, approval: 'user' }), /exactly these fields/);
  }
  assert.throws(() => validatePolicyShape(humanLoopProgressTool.parameters, {
    schemaVersion: 'human-task-progress/v1', taskId: 'engine', planDigest: 'a'.repeat(64), status: 'completed', summary: 'Pretend done.', evidenceRefs: [],
  }), /supported|allowed|one of/);
});

test('cooperative Stop commands require durable ordered facts, exact ownership and strict fields', () => {
  const f = fixture();
  f.receive('request'); f.admit('request'); f.start('router');
  const c = injectionCommands(f);
  const commands: Array<[string, object, Authority]> = [
    ['request-stop-injection', c.request, 'host'],
    ['acknowledge-stop-injection', c.acknowledgement, 'runtime'],
    ['deliver-stop-injection', c.delivered, 'runtime'],
    ['record-stop-response', c.response, 'agent'],
    ['settle-stop-injection', c.settlement, 'runtime'],
  ];
  for (const [type, data, authority] of commands) {
    assert.throws(() => f.emit(type, data, authority), /Stop injection/);
  }
  f.emit('request-step-stop', { stopId: c.request.stopId }, 'user');
  for (let index = 0; index < commands.length; index++) {
    const [type, data, authority] = commands[index]!;
    const before = structuredClone(f.state);
    for (const foreign of [{ stopId: 'foreign' }, { taskId: 'foreign' }]) {
      assert.throws(() => f.emit(type, { ...data, ...foreign }, authority), /Stop injection/);
    }
    assert.throws(() => f.emit(type, { ...data, extra: true }, authority), /exactly these fields/);
    assert.throws(() => f.emit(type, data, 'user'), /actor/);
    if (type === 'request-stop-injection') {
      assert.throws(() => f.emit(type, { ...data, requestId: 'foreign' }), /exact started/);
      assert.throws(() => f.emit(type, { ...data, inputDigest: policyHash('foreign') }), /exact started/);
      assert.throws(() => f.emit(type, { ...data, promptDigest: 'not-a-digest' }), /SHA-256/);
    }
    if (type === 'deliver-stop-injection') {
      assert.throws(() => f.emit(type, { ...data, messageId: 'foreign' }, authority), /exact acknowledged/);
      assert.throws(() => f.emit(type, { ...data, delivery: 'unknown' }, authority), /one of/);
      assert.throws(() => f.emit(type, { ...data, eventId: '' }, authority), /non-empty/);
    }
    if (type === 'record-stop-response') {
      assert.throws(() => f.emit(type, { ...data, inputDigest: policyHash('foreign') }, authority), /exact delivered/);
      assert.throws(() => f.emit(type, { ...data, evidenceRefs: ['same', 'same'] }, authority), /duplicate/);
    }
    assert.deepEqual(f.state, before);
    for (const [laterType, laterData, laterAuthority] of commands.slice(index + 1)) {
      assert.throws(() => f.emit(laterType, laterData, laterAuthority), /Stop injection|Stop response/);
    }
    f.emit(type, data, authority);
    const event = f.ledger.events.at(-1)!;
    assert.equal(transitionHumanLoop(f.state, event.authority, event.command), f.state);
    assert.throws(() => transitionHumanLoop(f.state, event.authority, {
      ...event.command as object, data: { ...data, taskId: 'foreign' },
    }), /Conflicting lifecycle command/);
    assert.throws(() => f.emit(type, data, authority), /once|already recorded/);
    assert.deepEqual(replayHumanLoopLedger(JSON.parse(JSON.stringify(f.ledger))).state, f.state);
  }
  const reordered = structuredClone(f.ledger);
  const attemptIndex = reordered.events.findIndex((event) =>
    (event.command as { type: string }).type === 'request-stop-injection');
  reordered.events.splice(attemptIndex, 1);
  assert.throws(() => replayHumanLoopLedger(reordered), /Stale lifecycle revision/);
});

test('lost Stop injection send acknowledgement is durable uncertainty, never a second attempt or early release', () => {
  const f = fixture();
  f.receive('request'); f.admit('request'); f.start('router');
  const c = injectionCommands(f);
  c.begin();
  assert.deepEqual(f.state.stop!.injection, { taskId: c.request.taskId, requestId: 'request',
    inputDigest: c.request.inputDigest, promptDigest: c.request.promptDigest,
    messageId: null, delivery: null, acknowledgement: null, endEventId: null });
  const recovered = replayHumanLoopLedger(JSON.parse(JSON.stringify(f.ledger))).state;
  assert.throws(() => transitionHumanLoop(recovered, 'host', { id: 'retry', expectedRevision: recovered.revision,
    type: 'request-stop-injection', data: c.request }), /only once/);
  f.submit({ kind: 'route', intent: 'answer', cycleId: null, summary: 'A safe existing result.', resolvedQuestions: [] });
  assert.throws(() => f.end(), /must positively settle/);
  assert.throws(() => f.receive('new'), /still settling/);
  assert.throws(() => f.emit('confirm-stop', { stopId: c.request.stopId, snapshot: baseline }), /actual native operation response/);
  f.emit('execution-unknown', { reason: 'The immediate send failed with uncertain delivery.', evidenceRef: 'send-error' });
  assert.equal(nextHumanRequest(f.state), null);
  assert.throws(() => f.emit('request-stop-injection', c.request), /uncertain/);
  assert.throws(() => f.emit('acknowledge-stop-injection', c.acknowledgement, 'runtime'), /uncertain/);
  assert.deepEqual(replayHumanLoopLedger(JSON.parse(JSON.stringify(f.ledger))).state, f.state);
});

for (const delivery of ['steering', 'queued', 'idle'] as const) {
  test(`${delivery} cooperative exit retains unfinished task, plan and code until both interactions settle`, () => {
    const f = fixture();
    f.receive('implement'); f.admit('implement'); f.route('implement'); f.createCycle(); f.planCycle();
    f.start('implementer', 'cycle', 'engine');
    const originalPlan = structuredClone(f.state.cycles[0]!.plan);
    const originalAcceptance = structuredClone(f.state.cycles[0]!.acceptance);
    const c = injectionCommands(f, delivery);
    assert.throws(() => f.submit(c.partial), /stopped-partial audit/);
    c.begin();
    assert.throws(() => f.submit(c.partial), /stopped-partial audit/);
    f.emit('acknowledge-stop-injection', c.acknowledgement, 'runtime');
    assert.throws(() => f.submit(c.partial), /stopped-partial audit/);
    f.emit('deliver-stop-injection', c.delivered, 'runtime');
    assert.throws(() => f.submit(c.partial), /stopped-partial audit/);
    f.emit('record-stop-response', c.response, 'agent');
    assert.throws(() => f.submit({ ...c.partial, summary: 'Fabricated completion.' }), /stopped-partial audit/);
    assert.throws(() => f.submit({ ...c.partial, evidenceRefs: ['fabricated'] }), /stopped-partial audit/);
    const result = f.submit(c.partial);
    const receipt = { taskId: c.request.taskId, resultId: result.resultId, toolCallId: c.response.toolCallId,
      eventId: 'actual-stop-tool-execution-complete' };
    assert.throws(() => f.emit('request-role-end', { ...receipt, toolCallId: 'foreign-tool' }), /exact delivered injection response/);
    f.emit('request-role-end', receipt);
    f.emit('acknowledge-role-end', receipt, 'runtime');
    const retained = snapshot('partial-engine');
    assert.throws(() => f.end(retained, 'result-abort'), /must positively settle/);
    assert.throws(() => f.receive('new'), /still settling/);
    c.settle();
    f.end(retained, 'result-abort');
    assert.throws(() => f.emit('settle-stop-injection', c.settlement, 'runtime'), /exact active/);
    f.apply();
    const cycle = f.state.cycles[0]!;
    assert.equal(cycle.phase, 'implementing');
    assert.equal(cycle.tasks[0]!.status, 'running');
    assert.equal(cycle.tasks[0]!.result, null);
    assert.equal(cycle.implementationResult, null);
    assert.equal(cycle.reviewResult, null);
    assert.equal(cycle.indexReceipt, null);
    assert.deepEqual(cycle.plan, originalPlan);
    assert.deepEqual(cycle.acceptance, originalAcceptance);
    assert.deepEqual(cycle.current, retained);
    assert.equal(f.state.handoffs.at(-1)!.result.outcome.kind, 'stopped-partial');
    assert.throws(() => f.emit('confirm-stop', { stopId: c.request.stopId, snapshot: retained }), /handoff/);
    f.present();
    assert.equal(f.state.requests[0]!.status, 'stopped');
    assert.throws(() => f.receive('new'), /still settling/);
    const lostEnd = structuredClone(f.state);
    lostEnd.stop!.injection!.endEventId = null;
    const released = transitionHumanLoop(lostEnd, 'host', { id: 'missing-injection-end',
      expectedRevision: lostEnd.revision, type: 'confirm-stop',
      data: { stopId: c.request.stopId, snapshot: retained } });
    assert.equal(released.stop, null, 'Legacy injection observations are not a second Stop veto.');
    f.emit('confirm-stop', { stopId: c.request.stopId, snapshot: retained });
    assert.equal(f.state.cycles[0]!.phase, 'stopped');
    assert.equal(f.state.cycles[0]!.tasks[0]!.status, 'running');
    assert.deepEqual(f.state.stops[0]!.snapshot, retained);
    assert.equal(f.state.stops[0]!.injection!.endEventId, c.settlement.endEventId);
    assert.deepEqual(replayHumanLoopLedger(JSON.parse(JSON.stringify(f.ledger))).state, f.state);
    f.receive('new'); f.admit('new');
    assert.equal(f.state.activeRequestId, 'new');
    assert.throws(() => f.emit('record-stop-response', c.response, 'agent'), /No owned role task/);
  });
}

test('Stop response tool receipt can terminate a genuine result without replacing it with partial work', () => {
  const f = fixture();
  f.receive('request'); f.admit('request'); f.start('router');
  const existing = f.submit({ kind: 'route', intent: 'answer', cycleId: null,
    summary: 'The actual safe Router interpretation.', resolvedQuestions: [] });
  const c = injectionCommands(f);
  c.begin(); c.respond();
  assert.deepEqual(f.state.activeTask!.result, existing);
  assert.throws(() => f.submit(c.partial), /Result window/);
  const receipt = { taskId: c.request.taskId, resultId: existing.resultId,
    toolCallId: c.response.toolCallId, eventId: 'real-stop-tool-complete' };
  f.emit('request-role-end', receipt);
  f.emit('acknowledge-role-end', receipt, 'runtime');
  c.settle(); f.end(baseline, 'result-abort'); f.apply();
  f.emit('confirm-stop', { stopId: c.request.stopId, snapshot: baseline });
  assert.deepEqual(f.state.executions.at(-1)!.result, existing);
  assert.deepEqual(f.state.requests[0]!.route, existing);
  assert.equal(f.state.stops[0]!.injection!.acknowledgement!.toolCallId, receipt.toolCallId);
});

test('Stop injection rejects unstarted, terminal and immediate-stop roles without changing legacy flag-only settlement', () => {
  const f = fixture();
  f.receive('request'); f.admit('request');
  const binding = { id: 'unstarted', dispatchId: 'dispatch', sessionId: 'private', requestId: 'request',
    cycleId: null, role: 'router', internalTaskId: null, inputDigest: policyHash('input'), before: baseline, design };
  f.emit('start-role', binding);
  const c = injectionCommands(f);
  f.emit('request-step-stop', { stopId: c.request.stopId }, 'user');
  assert.throws(() => f.emit('request-stop-injection', c.request), /exact started/);
  f.emit('role-acknowledged', { taskId: binding.id, dispatchId: binding.dispatchId, messageId: 'message' }, 'runtime');
  assert.throws(() => f.emit('request-stop-injection', c.request), /exact started/);
  f.emit('role-started', { taskId: binding.id, messageId: 'message', interactionId: 'interaction' }, 'runtime');
  const result = f.submit({ kind: 'route', intent: 'answer', cycleId: null, summary: 'Original result.', resolvedQuestions: [] });
  const receipt = { taskId: binding.id, resultId: result.resultId, toolCallId: 'result-tool', eventId: 'tool-complete' };
  f.emit('request-role-end', receipt);
  assert.throws(() => f.emit('request-stop-injection', c.request), /before terminal/);
  f.emit('acknowledge-role-end', receipt, 'runtime');
  f.end(baseline, 'result-abort');
  assert.throws(() => f.emit('request-stop-injection', c.request), /before terminal/);
  f.apply(); f.emit('confirm-stop', { stopId: c.request.stopId, snapshot: baseline });
  assert.equal(Object.hasOwn(f.state.stops[0]!, 'injection'), false);
  assert.deepEqual(replayHumanLoopLedger(JSON.parse(JSON.stringify(f.ledger))).state, f.state);
  const immediate = fixture();
  immediate.receive('request'); immediate.admit('request'); immediate.start('router');
  const other = injectionCommands(immediate);
  immediate.emit('request-stop', { stopId: other.request.stopId }, 'user');
  assert.throws(() => immediate.emit('request-stop-injection', other.request), /exact started after-step/);
});

test('cooperative Stop tool is strict for all roles and partial outcomes never become ordinary result tools', () => {
  const response = { stopId: 'stop', taskId: 'task', inputDigest: policyHash('input'),
    summary: 'Partial audit only; no completion or approval.', evidenceRefs: ['retained-file'] };
  assert.equal(humanLoopStopTool.name, 'acknowledge_human_stop');
  assert.deepEqual(humanLoopStopTool.roles, [...roles]);
  assert.equal(humanLoopStopTool.terminal, true);
  assert.match(humanLoopStopTool.description, /partial-work audit/);
  assert.match(humanLoopStopTool.description, /not task completion, Review, failure or approval/);
  validatePolicyShape(humanLoopStopTool.parameters, response);
  assert.throws(() => validatePolicyShape(humanLoopStopTool.parameters, { ...response, toolCallId: 'forged' }), /does not allow toolCallId/);
  for (const field of Object.keys(response)) {
    assert.throws(() => validatePolicyShape(humanLoopStopTool.parameters,
      Object.fromEntries(Object.entries(response).filter(([key]) => key !== field))));
  }
  for (const role of roles) {
    const result = { schemaVersion: 'human-role-result/v1', resultId: 'partial', inputDigest: response.inputDigest,
      outcome: { kind: 'stopped-partial', stopId: response.stopId, summary: response.summary, evidenceRefs: response.evidenceRefs } };
    assert.deepEqual(parseRoleResult(role, result), result);
    assert.throws(() => parseRoleResult(role, { ...result, outcome: { ...result.outcome, approval: true } }), /exactly these fields/);
    assert.throws(() => parseRoleResult(role, { ...result, outcome: { ...result.outcome, stopId: '' } }), /non-empty/);
    for (const tool of humanLoopResultTools().filter((tool) => tool.roles.includes(role))) {
      assert.throws(() => validatePolicyShape(tool.parameters, result));
    }
  }
});

for (const role of roles) test(`${role} partial staging requires its Stop response and never completes the role's business outcome`, () => {
  const f = fixture();
  f.receive('request'); f.admit('request');
  if (role === 'agent' || role === 'designer') f.route(role === 'agent' ? 'answer' : 'design');
  else if (role !== 'router') {
    f.route('implement'); f.createCycle();
    if (role !== 'planner') f.planCycle();
    if (role === 'reviewer') {
      f.start('implementer', 'cycle', 'engine'); f.taskResult('engine');
      f.start('implementer', 'cycle', 'view'); f.taskResult('view');
      f.start('implementer', 'cycle');
      f.finish({ kind: 'implementation-result', planDigest: f.state.cycles[0]!.plan!.digest,
        completedTaskIds: ['engine', 'view'], summary: 'Implementation reported complete; awaiting Review.', evidenceRefs: ['code'] });
    }
  }
  const task = f.start(role, ['planner', 'implementer', 'reviewer'].includes(role) ? 'cycle' : null,
    role === 'implementer' ? 'engine' : null);
  const cycleBefore = structuredClone(f.state.cycles[0]);
  const c = injectionCommands(f);
  const partial = { schemaVersion: 'human-role-result/v1', resultId: `partial-${role}`,
    inputDigest: task.binding.inputDigest, outcome: c.partial };
  assert.throws(() => f.emit('stage-result', partial, 'agent'), /stopped-partial audit/);
  c.begin(); c.respond();
  f.emit('stage-result', partial, 'agent');
  f.emit('submit-result', partial, 'agent');
  assert.throws(() => f.end(snapshot('unauthorized-edit')), /must positively settle/);
  c.settle();
  f.end(); f.apply();
  assert.deepEqual(f.state.cycles[0], cycleBefore);
  assert.deepEqual(f.state.design, design);
  assert.equal(f.state.handoffs.at(-1)!.result.outcome.kind, 'stopped-partial');
  assert.equal(f.state.uncertainty, null);
  f.present();
  f.emit('confirm-stop', { stopId: c.request.stopId, snapshot: task.binding.before });
  assert.equal(f.state.requests[0]!.status, 'stopped');
  if (cycleBefore) {
    assert.equal(f.state.cycles[0]!.phase, 'stopped');
    assert.deepEqual(f.state.cycles[0]!.reviewResult, cycleBefore.reviewResult);
    assert.deepEqual(f.state.cycles[0]!.implementationResult, cycleBefore.implementationResult);
    assert.deepEqual(f.state.cycles[0]!.tasks, cycleBefore.tasks);
  }
});
