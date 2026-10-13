import { isAbsolute } from 'node:path';
import { annotationLimits } from '../workflow/annotation-attachment.ts';
import { policyHash, parsePolicySnapshot, type PolicySnapshot } from '../workflow/policy.ts';
import { choice, integer, list, object, requireCondition, sameSet, strings, text } from '../workflow/validation.ts';
import {
  HUMAN_LOOP_SCHEMA, parseRequest, bindQuestionOptions, parseRoleResult, parseTaskBinding, parseOwnedEnd, parseInternalPlan,
  digest, parseSnapshotRef, parseDesignBinding, parseProgress, parseRoleInputEnvelope, parseNativeUserEvidence,
  advisoryContinuationIssue, requireDeclaredAdvisoryContinuations,
  type Authority, type HumanRequest, type TaskBinding, type RoleResult, type OwnedEnd, type InternalPlan,
  type InternalAcceptance, type DesignBinding, type SnapshotRef, type QuestionRecord, type QuestionDraft,
  type QuestionSource, type TaskProgress, type QuestionResolution, type RoleInput, type NativeUserEvidence,
} from './contracts.ts';

export interface HumanLoopOwner {
  schemaVersion: 'human-loop-owner/v1'; id: string; mainSessionId: string; privateSessionId: string; workspacePath: string;
  policy: PolicySnapshot;
}
export interface RequestRecord extends HumanRequest {
  status: 'waiting' | 'active' | 'handoff-pending' | 'completed' | 'discarded' | 'stopped' | 'rejected' | 'retired' | 'cancelled';
  stopId: string | null; route: RoleResult | null; rejectionReason: string | null;
  blockingAnswerRefs: QuestionResolution[];
  questionGatesReleased: boolean;
}
export interface WorkCycle {
  id: string; originRequestId: string; originRequestIds: string[]; requestIds: string[];
  phase: 'planning' | 'implementing' | 'review-pending' | 'reviewing' | 'waiting-input' | 'completed' | 'stopped' | 'failed' | 'retired';
  design: DesignBinding; baseline: SnapshotRef; current: SnapshotRef;
  pendingPlan: InternalPlan | null; plan: InternalPlan | null; planHistory: InternalPlan[];
  acceptance: InternalAcceptance | null;
  tasks: Array<{ id: string; definitionDigest: string; status: 'pending' | 'running' | 'completed' | 'waiting-input';
    result: RoleResult | null; progress: TaskProgress[] }>;
  implementationResult: RoleResult | null; reviewResult: RoleResult | null; concernResultId: string | null;
  reviewSnapshot: SnapshotRef | null; indexReceipt: { id: string; resultId: string; snapshot: SnapshotRef } | null;
}
export interface RoleExecution {
  binding: TaskBinding; messageId: string | null; interactionId: string | null;
  condition: 'queued' | 'running' | 'waiting-permission' | 'ended' | 'not-sent' | 'unknown';
  result: RoleResult | null; end: OwnedEnd | null; after: SnapshotRef | null;
  completion?: 'result-submission' | 'native-stop' | 'reported-failure';
  stagedResult: RoleResult | null;
  terminal: { resultId: string; toolCallId: string; eventId: string; acknowledged: boolean; reason?: 'completion-timeout' } | null;
  turnEnd?: { resultId: string; toolCallId: string; toolEventId: string; eventId: string; turnId: string; interactionId: string };
  inputs?: RoleInput[];
}
export interface Handoff {
  id: string; requestId: string; requestIds: string[]; cycleId: string | null; result: RoleResult; snapshot: SnapshotRef | null;
  presented: boolean;
}
export interface ImplementationConfirmation {
  id: string; requestId: string; requestIds: string[]; routeResultId: string; design: DesignBinding;
  afterDesignResultId: string | null;
  status: 'pending' | 'approved' | 'design' | 'cancelled' | 'invalidated';
  createdAt: string; decidedAt: string | null;
}
export function currentImplementationConfirmation(state: HumanLoopState): ImplementationConfirmation | undefined {
  const request = state.requests.find(({ id }) => id === state.activeRequestId);
  if (!request) return undefined;
  return state.implementationConfirmations?.findLast(c => c.requestId === request.id && c.routeResultId === request.route?.resultId);
}
export function hasMixedImplementationAnswers(request: HumanRequest): boolean {
  const targets = new Set(request.answers?.answers.map(answer => answer.selectedOption?.resolutionTarget));
  return targets.has('design') && targets.has('implementation');
}
export function requestsImplementationAfterDesign(state: HumanLoopState, request: RequestRecord, seen = new Set<string>()): boolean {
  if (seen.has(request.id) || ['cancelled', 'discarded', 'stopped', 'rejected', 'retired'].includes(request.status)) return false;
  seen.add(request.id);
  if (hasMixedImplementationAnswers(request)) return true;
  return Boolean(request.answers?.answers.some(answer => {
    const question = state.questions.find(q => q.id === answer.questionId && q.source.resultId === answer.sourceResultId);
    return question?.source.requestIds.some(id => {
      const source = state.requests.find(r => r.id === id);
      return source && requestsImplementationAfterDesign(state, source, seen);
    });
  }));
}
export function implementationDecisionMessage(confirmation: ImplementationConfirmation): string {
  return {
    pending: 'Confirm before Tandem plans or changes code. No implementation has started for this request.',
    approved: 'Plan and implement approved for this request and Design revision.',
    design: 'Update Design instead selected. Code changes are not authorized by this request.',
    cancelled: confirmation.afterDesignResultId
      ? 'Implementation declined. The published Design is retained; no planning or code changes started for this request.'
      : 'Implementation declined. No planning or code changes started for this request. The current Design is unchanged.',
    invalidated: 'This implementation confirmation is no longer current and cannot authorize work.',
  }[confirmation.status];
}
export function requireImplementationConfirmation(state: HumanLoopState): void {
  const confirmation = currentImplementationConfirmation(state);
  requireCondition(confirmation?.status === 'approved' && same(confirmation.design, state.design)
    && same(confirmation.requestIds, state.activeBatchRequestIds),
  'Explicit user confirmation for this request, route and current Design is required before implementation.');
  requireCondition(!state.questions.some(q => questionBlocksNewWork(state, q)),
    'Resolve the outstanding Design questions before starting implementation.');
}
export interface HumanStop {
  id: string; requestId: string | null; requestIds: string[]; taskId: string | null; cycleId: string | null;
  discardedRequestIds: string[]; acknowledged: boolean;
  mode?: 'after-step';
  nativeResult?: { sessionId: string; interrupted: boolean };
  injection?: {
    taskId: string; requestId: string; inputDigest: string; promptDigest: string;
    messageId: string | null;
    delivery: { eventId: string; messageId: string; turnId: string; interactionId: string;
      delivery: 'steering' | 'queued' | 'idle' } | null;
    acknowledgement: { toolCallId: string; summary: string; evidenceRefs: string[] } | null;
    endEventId: string | null;
    cancellationEndEventId?: string;
  };
}
export interface HumanLoopState {
  schemaVersion: typeof HUMAN_LOOP_SCHEMA; revision: number; owner: HumanLoopOwner; design: DesignBinding;
  requests: RequestRecord[]; cycles: WorkCycle[]; questions: QuestionRecord[]; handoffs: Handoff[];
  activeRequestId: string | null; activeTask: RoleExecution | null; executions: RoleExecution[];
  activeBatchRequestIds: string[];
  implementationConfirmations?: ImplementationConfirmation[];
  stop: HumanStop | null;
  stops: Array<HumanStop & { snapshot: SnapshotRef }>;
  uncertainty: { reason: string; evidenceRef: string } | null;
  recoveries?: Array<{
    id: string; recoveredAt: string; evidenceRef: string; requestIds: string[]; cycleIds: string[];
    taskId: string | null; stop: HumanStop | null; uncertainty: HumanLoopState['uncertainty'];
    nativeUsers: NativeUserEvidence[];
  }>;
  applied: Array<{ id: string; signature: string }>;
}

const same = (left: unknown, right: unknown) => policyHash(left) === policyHash(right);
export function releaseQuestionGates(state: HumanLoopState, scope?: { requestIds: string[]; cycleIds: string[] }): void {
  const requests = scope ? state.requests.filter(({ id }) => scope.requestIds.includes(id)) : state.requests;
  const refs = requests.flatMap(({ blockingAnswerRefs }) => blockingAnswerRefs);
  for (const question of state.questions) if (!scope || question.source.requestIds.some(id => scope.requestIds.includes(id))
    || scope.requestIds.includes(question.source.requestId)
    || (question.source.cycleId !== null && scope.cycleIds.includes(question.source.cycleId))
    || refs.some(ref => ref.questionId === question.id && ref.sourceResultId === question.source.resultId)) {
    question.blockingActive = false;
  }
  for (const request of requests) request.questionGatesReleased = true;
}
export function parseHumanLoopOwner(value: unknown): HumanLoopOwner {
  const data = object(value, ['schemaVersion', 'id', 'mainSessionId', 'privateSessionId', 'workspacePath', 'policy']);
  requireCondition(data.schemaVersion === 'human-loop-owner/v1', 'Old two-copy ownership is incompatible; no migration was attempted.');
  requireCondition(isAbsolute(text(data.workspacePath)), 'One-copy ownership needs the existing absolute workspace path.');
  requireCondition(data.mainSessionId !== data.privateSessionId, 'Main and private conversations have distinct identities.');
  return { schemaVersion: 'human-loop-owner/v1', id: text(data.id), mainSessionId: text(data.mainSessionId),
    privateSessionId: text(data.privateSessionId), workspacePath: text(data.workspacePath), policy: parsePolicySnapshot(data.policy) };
}
export function createHumanLoop(owner: unknown, design: DesignBinding = { revisionId: null, digest: null }): HumanLoopState {
  return { schemaVersion: HUMAN_LOOP_SCHEMA, revision: 0, owner: parseHumanLoopOwner(owner),
    design: parseDesignBinding(design), requests: [], cycles: [], questions: [], handoffs: [],
    activeRequestId: null, activeBatchRequestIds: [], activeTask: null, executions: [],
    stop: null, stops: [], uncertainty: null, applied: [] };
}
export function allowsHumanRoleSettlement(state: HumanLoopState, taskId: string): boolean {
  return !state.stop || (state.stop.mode === 'after-step' && state.stop.taskId === taskId
    && state.activeTask?.binding.id === taskId);
}
export function requireHumanRequestRunning(state: HumanLoopState, requestId: string, taskId: string | null = null): void {
  const stop = state.stop?.requestIds.includes(requestId) ? state.stop
    : state.stops.find((entry) => entry.requestIds.includes(requestId));
  const settling = stop === state.stop && stop?.mode === 'after-step' && taskId !== null && stop.taskId === taskId
    && (state.activeTask?.binding.id === taskId || state.executions.some((task) => task.binding.id === taskId && (task.end || task.completion) && task.result));
  if (stop && !settling) throw Object.assign(new Error('The user stopped this work.'), {
    code: 'human-loop-stop', requestId, stopId: stop.id,
  });
  requireCondition(!state.uncertainty, state.uncertainty?.reason ?? 'Execution is uncertain.');
  requireCondition(state.activeRequestId === requestId, 'No active user request owns this work.');
}
export function isStaleAnswer(state: HumanLoopState, request: RequestRecord): boolean {
  return Boolean(request.answers?.answers.some(answer => !state.questions.some(q => q.id === answer.questionId
    && q.source.resultId === answer.sourceResultId && q.state === 'answered' && q.answerRequestId === request.id)));
}
export function isPriorityAnswer(request: RequestRecord): boolean {
  return !request.questionGatesReleased && request.blockingAnswerRefs.length > 0;
}
export function questionBlocksNewWork(state: HumanLoopState, question: QuestionRecord, enforceContinuations = true): boolean {
  return question.state === 'open' && (question.blockingActive
    || enforceContinuations && advisoryContinuationIssue(question, state.design) !== null);
}
export function hasQuestionBlockers(state: HumanLoopState, enforceContinuations = true): boolean {
  return state.questions.some(q => questionBlocksNewWork(state, q, enforceContinuations))
    || state.requests.some(r => isPriorityAnswer(r) && ['waiting', 'active', 'handoff-pending'].includes(r.status));
}
export function requireHumanQuiescence(state: HumanLoopState): void {
  requireCondition(!state.activeTask && state.activeRequestId === null && !state.activeBatchRequestIds.length
    && !state.stop && !state.uncertainty
    && state.requests.every(({ status }) => !['active', 'handoff-pending'].includes(status)),
  'Only a settled new-model session can close or reopen; interrupted work is not adopted.');
}
export function humanExecutionQueue(state: HumanLoopState): RequestRecord[] {
  const waiting = state.requests.filter(({ status }) => status === 'waiting');
  return [...waiting.filter(isPriorityAnswer), ...waiting.filter(request => !isPriorityAnswer(request))];
}
export function nextHumanRequest(state: HumanLoopState, enforceContinuations = true): RequestRecord | null {
  if (state.activeRequestId || state.activeTask || state.stop || state.uncertainty) return null;
  const first = humanExecutionQueue(state).find((request) => !isStaleAnswer(state, request));
  if (!first) return null;
  if (hasQuestionBlockers(state, enforceContinuations) && !isPriorityAnswer(first)) return null;
  return first;
}
export function nextHumanBatch(state: HumanLoopState, enforceContinuations = true): RequestRecord[] {
  const first = nextHumanRequest(state, enforceContinuations);
  if (!first) return [];
  if (first.answers) return [first];
  const queue = humanExecutionQueue(state), start = queue.findIndex(({ id }) => id === first.id);
  const batch: RequestRecord[] = [];
  let bytes = 0;
  const images = new Set<string>();
  for (const request of queue.slice(start)) {
    if (request.answers) break;
    const size = Buffer.byteLength(JSON.stringify({ message: request.message, attachments: request.attachments }), 'utf8');
    if (batch.length && bytes + size > state.owner.policy.values.resources.requestBytes) break;
    const nextImages = new Set([...images, ...(request.attachments ?? []).map(({ id }) => id)]);
    if (batch.length && nextImages.size > annotationLimits.maxImages) break;
    nextImages.forEach((id) => images.add(id));
    bytes += size;
    batch.push(request);
  }
  return batch;
}
function activeRequest(state: HumanLoopState): RequestRecord {
  const request = state.requests.find(({ id }) => id === state.activeRequestId);
  requireCondition(request && request.status === 'active', 'No active user request owns this work.');
  return request;
}
function cycleFor(state: HumanLoopState, id: unknown): WorkCycle {
  const cycle = state.cycles.find((cycle) => cycle.id === id);
  requireCondition(cycle, 'Unknown work-cycle identity.');
  return cycle;
}
function activeTask(state: HumanLoopState): RoleExecution {
  requireCondition(state.activeTask, 'No owned role task is active.');
  return state.activeTask;
}
function stopInjection(state: HumanLoopState, data: Record<string, unknown>) {
  const task = activeTask(state), stop = state.stop;
  requireCondition(stop && stop.id === data.stopId && stop.taskId === data.taskId
    && task.binding.id === data.taskId && !task.end && stop.injection
    && stop.injection.taskId === task.binding.id && stop.injection.requestId === task.binding.requestId
    && stop.injection.inputDigest === task.binding.inputDigest,
  'Stop injection requires its exact active after-step task and durable attempt.');
  return stop.injection;
}
function routeFor(request: RequestRecord) {
  requireCondition(request.route?.outcome.kind === 'route', 'A completed Router interpretation is required.');
  return request.route;
}
function resolveQuestions(state: HumanLoopState, request: RequestRecord, result: RoleResult) {
  requireCondition(result.outcome.kind === 'route', 'Only Router interprets question answers.');
  requireCondition(request.answers || !result.outcome.resolvedQuestions.length,
    'An ordinary message cannot claim a submitted question answer.');
  for (const reference of result.outcome.resolvedQuestions) {
    const question = state.questions.find((q) => q.id === reference.questionId && q.source.resultId === reference.sourceResultId);
    const answer = request.answers?.answers.find((a) => a.questionId === reference.questionId && a.sourceResultId === reference.sourceResultId);
    requireCondition(question?.state === 'answered' && question.answerRequestId === request.id && answer,
      'Only this request\'s durably saved answer may be acknowledged.');
  }
  if (result.outcome.intent === 'resume-cycle' || result.outcome.intent === 'replan-cycle') {
    const cycle = cycleFor(state, result.outcome.cycleId);
    requireCondition(cycle.phase === 'waiting-input', 'Only an unfinished questioned cycle may resume.');
    requireCondition(!state.questions.some(q => q.source.cycleId === cycle.id && q.blockingActive && q.state === 'open'),
      'Compatible resumption still needs the effective cycle prerequisites.');
    requireCondition(!state.requests.some(r => r.id !== request.id && isPriorityAnswer(r)
      && ['waiting', 'active', 'handoff-pending'].includes(r.status)
      && r.blockingAnswerRefs.some(ref => state.questions.some(q => q.id === ref.questionId
        && q.source.resultId === ref.sourceResultId && q.source.cycleId === cycle.id))),
    'Another saved cycle answer must finish processing before resumption.');
  }
}
function validateResult(state: HumanLoopState, task: RoleExecution, result: RoleResult) {
  requireCondition(result.inputDigest === task.binding.inputDigest, 'Result input binding is stale.');
  const request = activeRequest(state), outcome = result.outcome;
  requireCondition(task.binding.requestId === request.id, 'Result belongs to another user request.');
  if (outcome.kind === 'stopped-partial') {
    const stop = state.stop, injection = stop?.injection;
    requireCondition(stop?.mode === 'after-step' && stop.id === outcome.stopId && stop.taskId === task.binding.id
      && state.activeTask?.binding.id === task.binding.id && injection?.taskId === task.binding.id
      && injection.requestId === request.id && injection.inputDigest === result.inputDigest
      && injection.messageId && injection.delivery?.messageId === injection.messageId && injection.acknowledgement
      && outcome.summary === injection.acknowledgement.summary && same(outcome.evidenceRefs, injection.acknowledgement.evidenceRefs),
    'A stopped-partial audit requires the exact delivered Stop injection and recorded agent response; it is not completion or approval.');
  }
  if (outcome.kind === 'route') {
    resolveQuestions(state, request, result);
    requireCondition(['resume-cycle', 'replan-cycle'].includes(outcome.intent) === (outcome.cycleId !== null),
      'Route must explicitly bind only a resumed/replanned cycle.');
    if (outcome.intent === 'replan-cycle') requireCondition(cycleFor(state, outcome.cycleId).phase === 'waiting-input',
      'Replanning must name an unfinished questioned cycle.');
    if (outcome.intent === 'resume-cycle') {
      const cycle = cycleFor(state, outcome.cycleId);
      requireCondition(same(task.binding.design, cycle.design),
        'Compatible resumption requires the same agreed Design.');
    }
  }
  if (['internal-plan', 'task-result', 'implementation-result', 'design-concern', 'review-result'].includes(outcome.kind)) {
    const cycle = cycleFor(state, task.binding.cycleId);
    if (outcome.kind === 'internal-plan') {
      const plan = parseInternalPlan(outcome.plan);
      requireCondition(cycle.phase === 'planning' && same(plan.design, cycle.design) && same(plan.baseline, cycle.current),
        'Internal plan does not match the cycle Design and actual code baseline.');
      requireCondition(!cycle.plan || (plan.id === cycle.plan.id && plan.version > cycle.plan.version),
        'A replanned internal cycle needs a successor version of its existing plan.');
    } else if (outcome.kind === 'task-result') {
      const item = cycle.tasks.find(({ id }) => id === outcome.taskId);
      requireCondition(cycle.phase === 'implementing' && cycle.plan?.digest === outcome.planDigest
        && task.binding.internalTaskId === outcome.taskId && item?.status === 'running',
      'Task result cannot complete another task or plan.');
    } else if (outcome.kind === 'implementation-result') {
      requireCondition(cycle.phase === 'implementing' && task.binding.internalTaskId === null
        && cycle.plan?.digest === outcome.planDigest && cycle.tasks.every(({ status }) => status === 'completed')
        && sameSet(outcome.completedTaskIds, cycle.tasks.map(({ id }) => id)),
      'Whole-plan completion requires every exact internal task; progress or partial work cannot start Review.');
    } else if (outcome.kind === 'design-concern') {
      requireCondition(['planning', 'implementing'].includes(cycle.phase), 'A Design concern must belong to unfinished planning or coding.');
    } else if (outcome.kind === 'review-result') {
      requireCondition(cycle.phase === 'reviewing' && cycle.implementationResult && cycle.plan?.digest === outcome.planDigest,
        'Review requires the exact whole-plan implementation result.');
      requireCondition(outcome.reviewFormat === 'decision-review/v2' || sameSet(outcome.assessments.map(({ taskId, criterionId }) => JSON.stringify([taskId, criterionId])),
        cycle.plan.tasks.flatMap((task) => task.criteria.map(({ id }) => JSON.stringify([task.id, id])))),
      'Review must account for every criterion in the entire internal plan.');
    }
  }
}
function recordQuestions(state: HumanLoopState, task: RoleExecution, result: RoleResult, questions: QuestionDraft[]) {
  requireCondition(['designer', 'reviewer', 'planner', 'implementer'].includes(task.binding.role), 'Invalid question source role.');
  const request = activeRequest(state);
  const answerCycles = new Set((request.answers?.answers ?? []).map((answer) => state.questions.find((q) =>
    q.id === answer.questionId && q.source.resultId === answer.sourceResultId)?.source.cycleId).filter(Boolean));
  const inheritedCycle = answerCycles.size === 1 ? [...answerCycles][0] : null;
  const cycleId = task.binding.cycleId ?? (task.binding.role === 'designer'
    && state.cycles.some((cycle) => cycle.id === inheritedCycle && cycle.phase === 'waiting-input') ? inheritedCycle ?? null : null);
  const source: QuestionSource = {
    role: task.binding.role as QuestionSource['role'], resultId: result.resultId, requestId: task.binding.requestId,
    requestIds: [...state.activeBatchRequestIds],
    cycleId, design: result.outcome.kind === 'designer-changed' ? state.design : task.binding.design,
    planDigest: cycleId ? cycleFor(state, cycleId).plan?.digest ?? null : null,
  };
  for (const question of questions) {
    requireCondition(!state.questions.some((q) => q.id === question.id && q.source.resultId === result.resultId), 'Question identity was reused.');
    state.questions.push({ ...question, source, state: 'open', answerRequestId: null,
      blockingActive: question.importance === 'blocking' && !state.stop });
  }
}

const authorities: Record<string, Authority> = {
  'receive-request': 'user', 'admit-request': 'host', 'start-cycle': 'host', 'resume-cycle': 'host', 'prepare-replan': 'host',
  'start-role': 'host', 'role-acknowledged': 'runtime', 'role-started': 'runtime', 'permission-state': 'runtime',
  'role-input-prepared': 'host', 'role-input-bound': 'runtime', 'continuation-acknowledged': 'runtime',
  'submit-result': 'agent', 'report-progress': 'agent', 'confirm-role-end': 'host', 'apply-result': 'host',
  'accept-plan': 'host', 'present-handoff': 'host', 'request-stop': 'user', 'confirm-stop': 'host', 'execution-unknown': 'host',
  'execution-failed': 'host',
  'stage-result': 'agent', 'request-role-end': 'host', 'acknowledge-role-end': 'runtime', 'acknowledge-stop': 'runtime',
  'record-role-turn-end': 'runtime',
  'role-not-sent': 'host',
  'reject-stale-answer': 'host',
  'reject-preparation': 'host',
  'record-review-index': 'host',
  'complete-role-result': 'agent', 'record-result-snapshot': 'host', 'record-native-stop': 'host',
  'recover': 'host',
  'request-step-stop': 'user',
  'request-stop-injection': 'host', 'acknowledge-stop-injection': 'runtime', 'deliver-stop-injection': 'runtime',
  'record-stop-response': 'agent', 'settle-stop-injection': 'runtime',
  'release-question-gates': 'host',
  'request-implementation-confirmation': 'host', 'decide-implementation-confirmation': 'user',
};

export function transitionHumanLoop(current: HumanLoopState, authority: Authority, value: unknown, replay = false): HumanLoopState {
  requireCondition(current.schemaVersion === HUMAN_LOOP_SCHEMA, 'Incompatible workflow state; old runs cannot be silently converted.');
  const command = object(value, ['id', 'expectedRevision', 'type', 'data',
    ...(Object.hasOwn(value ?? {}, 'questionPolicy') ? ['questionPolicy'] : [])]);
  if (Object.hasOwn(command, 'questionPolicy')) requireCondition(command.questionPolicy === 'explicit-continuation/v1', 'Unknown question continuation policy.');
  const enforceContinuations = !replay || command.questionPolicy === 'explicit-continuation/v1';
  const id = text(command.id), type = text(command.type);
  requireCondition(authorities[type] === authority, 'This actor cannot produce the requested lifecycle fact.');
  const signature = policyHash({ authority, command });
  const previous = current.applied.find((entry) => entry.id === id);
  if (previous) { requireCondition(previous.signature === signature, 'Conflicting lifecycle command identity.'); return current; }
  requireCondition(integer(command.expectedRevision) === current.revision, 'Stale lifecycle revision.');
  requireCondition(!current.uncertainty || ['receive-request', 'request-stop', 'record-native-stop', 'release-question-gates', 'recover'].includes(type), 'Execution is uncertain; no continuation or blind resend is permitted.');
  if (enforceContinuations && (['start-cycle', 'resume-cycle', 'prepare-replan', 'request-implementation-confirmation'].includes(type)
    || type === 'decide-implementation-confirmation' && (command.data as { decision?: string }).decision === 'approved'
    || type === 'start-role' && ['planner', 'implementer'].includes((command.data as { role: string }).role))) {
    requireCondition(!current.questions.some(q => q.state === 'open' && advisoryContinuationIssue(q, current.design) !== null),
      'Clarify advisory questions with missing or stale unanswered continuations before new dependent work. Answer through the original question form; no default or consent is inferred.');
  }
  const state = structuredClone(current);
  switch (type) {
    case 'recover': {
      const data = object(command.data, ['recoveryId', 'recoveredAt', 'evidenceRef', 'design', 'nativeUsers']);
      const recoveryId = text(data.recoveryId), recoveredAt = text(data.recoveredAt);
      requireCondition(Number.isFinite(Date.parse(recoveredAt)), 'Invalid Recovery timestamp.');
      requireCondition(!state.recoveries?.some(({ id }) => id === recoveryId), 'Recovery identity was reused.');
      const confirmation = currentImplementationConfirmation(state);
      const retained = confirmation?.status === 'pending' && !state.activeTask && !state.stop && !state.uncertainty
        ? confirmation : null;
      const retainedCycle = retained ? state.requests.find(r => r.id === retained.requestId)?.route?.outcome : null;
      const requests = state.requests.filter(({ id, status }) => ['waiting', 'active', 'handoff-pending'].includes(status)
        && !retained?.requestIds.includes(id));
      const cycles = state.cycles.filter(({ id, phase }) => !['completed', 'stopped', 'failed', 'retired'].includes(phase)
        && !(phase === 'waiting-input' && retainedCycle?.kind === 'route' && retainedCycle.cycleId === id));
      (state.recoveries ??= []).push({
        id: recoveryId, recoveredAt, evidenceRef: text(data.evidenceRef),
        requestIds: requests.map(({ id }) => id), cycleIds: cycles.map(({ id }) => id),
        taskId: state.activeTask?.binding.id ?? null, stop: state.stop, uncertainty: state.uncertainty,
        nativeUsers: list(data.nativeUsers, parseNativeUserEvidence),
      });
      for (const request of requests) request.status = 'retired';
      for (const cycle of cycles) cycle.phase = 'retired';
      releaseQuestionGates(state, { requestIds: requests.map(({ id }) => id), cycleIds: cycles.map(({ id }) => id) });
      state.design = parseDesignBinding(data.design);
      if (state.activeTask) state.executions.push(state.activeTask);
      for (const c of state.implementationConfirmations ?? []) if (c.status === 'pending' && c !== retained) c.status = 'invalidated';
      state.activeRequestId = retained?.requestId ?? null; state.activeBatchRequestIds = retained ? [...retained.requestIds] : []; state.activeTask = null;
      state.stop = null; state.uncertainty = null;
      break;
    }
    case 'request-implementation-confirmation': {
      const data = object(command.data, ['id', 'requestId', 'routeResultId', 'design', 'createdAt']);
      const request = activeRequest(state), route = routeFor(request);
      const previous = currentImplementationConfirmation(state);
      requireCondition(!state.activeTask && !state.stop && data.requestId === request.id && data.routeResultId === route.resultId
        && route.outcome.kind === 'route' && (previous?.afterDesignResultId || ['implement', 'resume-cycle', 'replan-cycle'].includes(route.outcome.intent)),
      'Confirmation requires a completed implementation route and no running role.');
      const design = parseDesignBinding(data.design), createdAt = text(data.createdAt);
      requireCondition(same(design, state.design) && Number.isFinite(Date.parse(createdAt)), 'Confirmation Design or timestamp is invalid.');
      requireCondition(!previous || previous.status === 'pending' && !same(previous.design, design),
        'This route already has a current confirmation or recorded decision.');
      if (previous) previous.status = 'invalidated';
      requireCondition(!state.implementationConfirmations?.some(c => c.id === data.id), 'Confirmation identity was reused.');
      (state.implementationConfirmations ??= []).push({ id: text(data.id), requestId: request.id,
        requestIds: [...state.activeBatchRequestIds], routeResultId: route.resultId, design, createdAt,
        afterDesignResultId: previous?.afterDesignResultId ?? null, status: 'pending', decidedAt: null });
      break;
    }
    case 'decide-implementation-confirmation': {
      const data = object(command.data, ['confirmationId', 'decision', 'decidedAt']);
      const confirmation = currentImplementationConfirmation(state);
      const decision = choice(data.decision, ['approved', 'design', 'cancelled'] as const);
      const decidedAt = text(data.decidedAt);
      requireCondition(confirmation && confirmation.id === data.confirmationId && confirmation.status === 'pending'
        && !state.activeTask && !state.stop && same(confirmation.requestIds, state.activeBatchRequestIds),
      'The confirmation is stale, already decided, or no longer owns this request.');
      requireCondition(decision === 'cancelled' || same(confirmation.design, state.design), 'The Design changed; fresh confirmation is required.');
      if (decision === 'approved') requireCondition(!state.questions.some(q => q.state === 'open' && q.blockingActive),
        'Resolve outstanding Design questions before implementation.');
      requireCondition(Number.isFinite(Date.parse(decidedAt)), 'Invalid confirmation decision timestamp.');
      confirmation.status = decision; confirmation.decidedAt = decidedAt;
      if (decision === 'cancelled') {
        for (const request of state.requests) if (confirmation.requestIds.includes(request.id)) request.status = 'cancelled';
        releaseQuestionGates(state, { requestIds: confirmation.requestIds, cycleIds: [] });
        state.activeRequestId = null; state.activeBatchRequestIds = [];
      }
      break;
    }
    case 'release-question-gates': {
      object(command.data, []);
      releaseQuestionGates(state);
      break;
    }
    case 'receive-request': {
      const request = bindQuestionOptions(parseRequest(command.data), state.questions);
      const previous = state.requests.find(({ id }) => id === request.id);
      if (previous) {
        const { id, message, receivedAt, answers, attachments } = previous;
        requireCondition(same(request, { id, message, receivedAt, answers, ...(attachments ? { attachments } : {}) }),
          'Conflicting retry of a saved user request.');
        break;
      }
      requireCondition(state.stop?.mode !== 'after-step', 'Stop after current step is still settling; wait before sending a new request.');
      requireCondition(Buffer.byteLength(JSON.stringify(request), 'utf8') <= state.owner.policy.values.resources.requestBytes,
        'The user request exceeds the configured request-size bound.');
      const blockingAnswerRefs: QuestionResolution[] = [];
      for (const answer of request.answers?.answers ?? []) {
        const question = state.questions.find((q) => q.id === answer.questionId && q.source.resultId === answer.sourceResultId);
        requireCondition(question?.state === 'open', 'Answer source is stale or unknown.');
        requireCondition(state.handoffs.some(h => h.presented && h.result.resultId === answer.sourceResultId),
          'Only a published question accepts answers.');
        requireCondition(answer.kind === 'freeform' ? question.allowFreeform : question.options.some(({ id }) => id === answer.value),
          'Answer is not permitted by the bound question.');
        if (questionBlocksNewWork(state, question, enforceContinuations)) blockingAnswerRefs.push({ questionId: question.id, sourceResultId: question.source.resultId });
        question.state = 'answered'; question.answerRequestId = request.id;
      }
      state.requests.push({ ...request, status: 'waiting', stopId: null, route: null, rejectionReason: null,
        blockingAnswerRefs, questionGatesReleased: false });
      break;
    }
    case 'reject-stale-answer': {
      const data = object(command.data, ['requestId', 'reason']);
      const request = state.requests.find(({ id }) => id === data.requestId);
      requireCondition(request?.status === 'waiting' && request.answers && isStaleAnswer(state, request),
        'Only a stale queued answer may be rejected without execution.');
      request.status = 'rejected'; request.rejectionReason = text(data.reason); break;
    }
    case 'reject-preparation': {
      const data = object(command.data, ['requestId', 'taskId', 'reason']);
      const request = activeRequest(state), task = state.activeTask;
      requireCondition(!state.stop && !state.uncertainty && request.id === data.requestId
        && (task ? data.taskId === task.binding.id && task.condition === 'queued'
          && !task.messageId && !task.interactionId && !task.result && !task.end : data.taskId === null),
      'Only preparation proven not dispatched may be rejected without native completion.');
      const reason = text(data.reason), affected = new Set(state.activeBatchRequestIds);
      for (const confirmation of state.implementationConfirmations ?? []) {
        if (confirmation.status === 'pending' && affected.has(confirmation.requestId)) confirmation.status = 'invalidated';
      }
      const reviewOnly = task?.binding.role === 'reviewer' && task.binding.cycleId !== null;
      for (const source of state.requests) if (affected.has(source.id)) {
        source.status = 'rejected'; source.rejectionReason = reason;
      }
      for (const question of state.questions) if (!reviewOnly && question.state === 'answered'
        && question.answerRequestId && affected.has(question.answerRequestId)) {
        question.state = 'open'; question.answerRequestId = null;
      }
      if (task?.binding.role === 'reviewer' && task.binding.cycleId) {
        const cycle = cycleFor(state, task.binding.cycleId);
        requireCondition(cycle.implementationResult, 'Review preparation must retain completed implementation.');
        task.result = { schemaVersion: 'human-role-result/v1', resultId: `failure:${id}`, inputDigest: task.binding.inputDigest,
          outcome: { kind: 'review-incomplete', summary: 'Review could not start. Implementation is retained; this is not approval.',
            reason, evidenceRefs: [id] } };
        cycle.reviewResult ??= task.result; cycle.phase = 'completed';
      }
      for (const cycle of state.cycles) if (cycle.requestIds.includes(request.id)
        && !['completed', 'stopped', 'retired'].includes(cycle.phase)) cycle.phase = 'failed';
      if (task) { task.condition = 'not-sent'; state.executions.push(task); }
      state.activeTask = null; state.activeRequestId = null; state.activeBatchRequestIds = [];
      break;
    }
    case 'admit-request': {
      const data = object(command.data, ['requestId']);
      requireCondition(!state.stop && !state.activeTask && state.activeRequestId === null, 'A handoff, internal work or Stop still owns the queue.');
      const next = nextHumanRequest(state, enforceContinuations);
      requireCondition(next && next.id === data.requestId,
        'Blocking question-UI answers have priority; the normal lane waits for prerequisites and their processing. Each queue preserves durable FIFO order.');
      const batch = nextHumanBatch(state, enforceContinuations);
      for (const request of batch) request.status = 'active';
      state.activeRequestId = next.id; state.activeBatchRequestIds = batch.map(({ id }) => id); break;
    }
    case 'start-cycle': {
      const data = object(command.data, ['cycleId', 'design', 'baseline']);
      const request = activeRequest(state), route = routeFor(request);
      const afterDesign = currentImplementationConfirmation(state);
      requireCondition(route.outcome.kind === 'route' && (route.outcome.intent === 'implement'
        || afterDesign?.afterDesignResultId && afterDesign.status === 'approved') && !state.activeTask,
        'A cycle requires the actual user request and its completed implementation route.');
      requireCondition(!state.cycles.some((cycle) => cycle.requestIds.includes(request.id)), 'The request already owns a work cycle.');
      const cycleId = text(data.cycleId), design = parseDesignBinding(data.design), baseline = parseSnapshotRef(data.baseline);
      requireCondition(!state.cycles.some(({ id }) => id === cycleId) && same(design, state.design), 'Cycle identity or Design is stale.');
      state.cycles.push({ id: cycleId, originRequestId: request.id, originRequestIds: [...state.activeBatchRequestIds],
        requestIds: [...state.activeBatchRequestIds], phase: 'planning',
        design, baseline, current: baseline, pendingPlan: null, plan: null, planHistory: [], acceptance: null,
        tasks: [], implementationResult: null, reviewResult: null, concernResultId: null, reviewSnapshot: null, indexReceipt: null });
      break;
    }
    case 'resume-cycle':
    case 'prepare-replan': {
      const data = object(command.data, ['cycleId', 'design', 'snapshot']);
      const request = activeRequest(state), route = routeFor(request), cycle = cycleFor(state, data.cycleId);
      requireCondition(route.outcome.kind === 'route' && route.outcome.cycleId === cycle.id
        && route.outcome.intent === (type === 'resume-cycle' ? 'resume-cycle' : 'replan-cycle')
        && cycle.phase === 'waiting-input' && !state.activeTask, 'No matching unfinished work cycle was routed.');
      const design = parseDesignBinding(data.design), snapshot = parseSnapshotRef(data.snapshot);
      requireCondition(same(design, state.design), 'Routed Design is not current.');
      if (type === 'resume-cycle') {
        requireCondition(same(design, cycle.design) && same(snapshot, cycle.current), 'Compatible continuation cannot silently rebase Design or code.');
        requireCondition(!state.questions.some((q) => q.source.cycleId === cycle.id && q.blockingActive && q.state === 'open'),
          'Unanswered cycle questions prevent compatible continuation.');
        cycle.phase = cycle.plan ? 'implementing' : 'planning';
        for (const task of cycle.tasks) if (task.status === 'waiting-input') task.status = 'pending';
      } else {
        cycle.phase = 'planning'; cycle.design = design; cycle.current = snapshot; cycle.pendingPlan = null;
      }
      cycle.requestIds.push(...state.activeBatchRequestIds.filter((id) => !cycle.requestIds.includes(id)));
      break;
    }
    case 'start-role': {
      const binding = parseTaskBinding(command.data);
      requireHumanRequestRunning(state, binding.requestId);
      const request = activeRequest(state);
      requireCondition(!state.stop && !state.activeTask && binding.requestId === request.id
        && binding.sessionId === state.owner.privateSessionId && same(binding.design, state.design)
        && !state.executions.some(({ binding: old }) => old.id === binding.id || old.dispatchId === binding.dispatchId),
      'Role dispatch is overlapping, stale or unowned.');
      if (binding.role === 'router') requireCondition(!request.route && binding.cycleId === null, 'Router interprets each new request once.');
      else if (binding.role === 'designer' || binding.role === 'agent') {
        const route = routeFor(request);
        const designOverride = binding.role === 'designer' && currentImplementationConfirmation(state)?.status === 'design';
        requireCondition(route.outcome.kind === 'route' && (designOverride || route.outcome.intent === (binding.role === 'designer' ? 'design' : 'answer'))
          && binding.cycleId === null, 'Role differs from the routed request.');
      } else {
        const cycle = cycleFor(state, binding.cycleId);
        requireCondition(cycle.requestIds.includes(request.id)
          && same(binding.design, cycle.design), 'Role lacks current cycle/Design context.');
        requireCondition(binding.before, 'A cycle role must retain actual code evidence.');
        cycle.current = binding.before;
        if (binding.role === 'planner') requireCondition(cycle.phase === 'planning' && !cycle.pendingPlan, 'Internal planning is not available.');
        else if (binding.role === 'reviewer') {
          requireCondition(cycle.phase === 'review-pending' && cycle.implementationResult && cycle.tasks.every(({ status }) => status === 'completed'),
            'Formal Review is a whole-plan boundary, not an internal task gate.');
          cycle.phase = 'reviewing'; cycle.reviewSnapshot = cycle.current;
        } else {
          requireCondition(cycle.phase === 'implementing' && cycle.plan && cycle.acceptance?.planDigest === cycle.plan.digest,
            'Implementation requires actual Host plan acceptance.');
          if (binding.internalTaskId === null) requireCondition(cycle.tasks.every(({ status }) => status === 'completed'), 'Final result cannot precede required tasks.');
          else {
            const item = cycle.tasks.find(({ id }) => id === binding.internalTaskId);
            const definition = cycle.plan.tasks.find(({ id }) => id === binding.internalTaskId);
            requireCondition(item?.status === 'pending' && definition
              && definition.dependsOn.every((id) => cycle.tasks.some((task) => task.id === id && task.status === 'completed')),
            'Internal task is unknown, completed or has unfinished dependencies.');
            item.status = 'running';
          }
        }
      }
      state.activeTask = { binding, messageId: null, interactionId: null, condition: 'queued',
        result: null, stagedResult: null, terminal: null, end: null, after: null };
      break;
    }
    case 'role-input-prepared': {
      const data = object(command.data, ['taskId', 'dispatchId', 'inputDigest', 'envelope']);
      const task = activeTask(state), envelope = parseRoleInputEnvelope(data.envelope);
      requireHumanRequestRunning(state, task.binding.requestId, task.binding.id);
      requireCondition(!task.result && !task.end && !task.completion && (envelope.kind === 'initial' || !state.stop)
        && data.taskId === task.binding.id && data.dispatchId === task.binding.dispatchId && data.inputDigest === task.binding.inputDigest,
      'Sent-envelope evidence differs from its live immutable task.');
      const inputs = task.inputs ??= [];
      requireCondition(envelope.kind === 'initial' ? inputs.length === 0 && task.messageId === null
        : inputs.length === 1 && inputs[0]?.native && inputs[0].acknowledgementId,
      'Only the first input and one same-role continuation may be prepared.');
      inputs.push({ ...envelope, acknowledgementId: null, native: null });
      break;
    }
    case 'role-input-bound': {
      const data = object(command.data, ['taskId', 'dispatchId', 'kind', 'user', 'turnId', 'startEventId']);
      const task = activeTask(state), kind = choice(data.kind, ['initial', 'continuation'] as const);
      const input = task.inputs?.find(input => input.kind === kind), user = parseNativeUserEvidence(data.user);
      const turnId = text(data.turnId), startEventId = text(data.startEventId);
      requireCondition(data.taskId === task.binding.id && data.dispatchId === task.binding.dispatchId
        && !task.result && !task.end && input && !input.native && user.interactionId
        && (user.messageId === null) === (user.turnId === null)
        && (user.turnId === null || user.turnId === turnId)
        && (!input.acknowledgementId || user.messageId === null || user.messageId === input.acknowledgementId),
      'Native input lacks its exact prepared envelope, interaction or turn.');
      const previous = [...state.executions, task].flatMap(task => task.inputs ?? []).flatMap(input => input.native ? [input.native] : []);
      requireCondition(!previous.some(native => native.user.id === user.id || native.user.interactionId === user.interactionId
        || native.startEventId === startEventId), 'Native input or start identity was reused.');
      input.native = { user, turnId, startEventId };
      break;
    }
    case 'continuation-acknowledged': {
      const data = object(command.data, ['taskId', 'dispatchId', 'messageId']);
      const task = activeTask(state), input = task.inputs?.find(input => input.kind === 'continuation'), messageId = text(data.messageId);
      requireCondition(data.taskId === task.binding.id && data.dispatchId === task.binding.dispatchId && input
        && !input.acknowledgementId && messageId !== task.messageId
        && (!input.native?.user.messageId || input.native.user.messageId === messageId),
      'Continuation acknowledgement differs from its owned send.');
      input.acknowledgementId = messageId; break;
    }
    case 'role-acknowledged': {
      const data = object(command.data, ['taskId', 'dispatchId', 'messageId']);
      const task = activeTask(state);
      requireCondition(data.taskId === task.binding.id && data.dispatchId === task.binding.dispatchId && !task.messageId, 'Dispatch acknowledgement differs from owned send.');
      const input = task.inputs?.find(input => input.kind === 'initial'), messageId = text(data.messageId);
      requireCondition(!input?.native?.user.messageId || input.native.user.messageId === messageId, 'Acknowledgement conflicts with native input.');
      if (input) input.acknowledgementId = messageId;
      task.messageId = messageId; break;
    }
    case 'role-started': {
      const data = object(command.data, ['taskId', 'messageId', 'interactionId']);
      const task = activeTask(state);
      requireCondition(data.taskId === task.binding.id && task.messageId === data.messageId && !task.interactionId, 'Native start lacks exact acknowledged input.');
      requireCondition(!task.inputs || task.inputs[0]?.native?.user.interactionId === data.interactionId,
        'Native start differs from the exact sent-envelope binding.');
      task.interactionId = text(data.interactionId);
      if (!task.completion) task.condition = 'running';
      break;
    }
    case 'permission-state': {
      const data = object(command.data, ['taskId', 'waiting']);
      const task = activeTask(state);
      requireCondition(data.taskId === task.binding.id && task.interactionId && !task.end && !task.result && typeof data.waiting === 'boolean',
        'Permission condition belongs to no active execution.');
      task.condition = data.waiting ? 'waiting-permission' : 'running'; break;
    }
    case 'report-progress': {
      const progress = parseProgress(command.data), task = activeTask(state);
      const cycle = cycleFor(state, task.binding.cycleId);
      requireCondition(task.binding.role === 'implementer' && task.binding.internalTaskId === progress.taskId
        && cycle.plan?.digest === progress.planDigest && !task.result && !task.end && task.interactionId,
      'Progress cannot update another task or complete a plan.');
      cycle.tasks.find(({ id }) => id === progress.taskId)!.progress.push(progress); break;
    }
    case 'stage-result':
    case 'complete-role-result':
    case 'submit-result': {
      const task = activeTask(state);
      requireCondition(allowsHumanRoleSettlement(state, task.binding.id) && !task.result && !task.end && (type === 'complete-role-result'
        ? ['queued', 'running', 'waiting-permission'].includes(task.condition) : type === 'stage-result'
        ? ['queued', 'running'].includes(task.condition) && !task.stagedResult
        : task.condition === 'running' && task.interactionId), 'Result window is not active.');
      const result = parseRoleResult(task.binding.role, command.data);
      if (enforceContinuations && 'questions' in result.outcome) requireDeclaredAdvisoryContinuations(result.outcome.questions);
      requireCondition(!state.executions.some(({ result: previous }) => previous?.resultId === result.resultId), 'Result identity was reused.');
      validateResult(state, task, result);
      if (type === 'stage-result') task.stagedResult = result;
      else {
        requireCondition(!task.stagedResult || same(task.stagedResult, result), 'Submitted result differs from its staged candidate.');
        task.result = result;
        if (type === 'complete-role-result') {
          task.completion = 'result-submission'; task.condition = 'ended';
        }
      }
      break;
    }
    case 'record-result-snapshot': {
      const data = object(command.data, ['taskId', 'resultId', 'snapshot']), task = activeTask(state);
      requireCondition(task.binding.id === data.taskId && task.result?.resultId === data.resultId
        && task.completion && task.after === null, 'Code evidence must belong to the submitted result.');
      const snapshot = data.snapshot === null ? null : parseSnapshotRef(data.snapshot);
      requireCondition(snapshot !== null || task.binding.before === null, 'Bound code evidence cannot be discarded.');
      task.after = snapshot;
      if (task.binding.cycleId) {
        requireCondition(snapshot, 'Cycle result evidence needs an actual snapshot.');
        cycleFor(state, task.binding.cycleId).current = snapshot;
      }
      break;
    }
    case 'record-native-stop': {
      const data = object(command.data, ['stopId', 'sessionId', 'interrupted']);
      const stop = state.stop;
      requireCondition(stop && stop.id === data.stopId && stop.mode !== 'after-step'
        && data.sessionId === state.owner.privateSessionId && typeof data.interrupted === 'boolean',
      'Native Stop response belongs to another operation or session.');
      stop.acknowledged = true;
      stop.nativeResult = { sessionId: text(data.sessionId), interrupted: data.interrupted };
      if (state.activeTask) {
        state.activeTask.completion = 'native-stop'; state.activeTask.condition = 'ended';
      }
      state.uncertainty = null;
      break;
    }
    case 'record-role-turn-end': {
      const data = object(command.data, ['taskId', 'resultId', 'toolCallId', 'toolEventId', 'eventId', 'turnId', 'interactionId']);
      const task = activeTask(state);
      requireCondition(!task.turnEnd && !task.end && task.binding.id === data.taskId
        && task.result?.resultId === data.resultId && task.interactionId === data.interactionId,
      'Role turn end needs the exact submitted result and owned interaction.');
      task.turnEnd = { resultId: text(data.resultId), toolCallId: text(data.toolCallId), toolEventId: text(data.toolEventId),
        eventId: text(data.eventId), turnId: text(data.turnId), interactionId: text(data.interactionId) };
      break;
    }
    case 'request-role-end': {
      const hasReason = command.data !== null && typeof command.data === 'object' && Object.hasOwn(command.data, 'reason');
      const data = object(command.data, ['taskId', 'resultId', 'toolCallId', 'eventId', ...(hasReason ? ['reason'] : [])]), task = activeTask(state);
      requireCondition(!hasReason || !task.turnEnd, 'A proven role turn end cannot trigger a completion timeout.');
      requireCondition(allowsHumanRoleSettlement(state, task.binding.id) && !task.terminal && !task.end && task.binding.id === data.taskId
        && task.result && task.result.resultId === data.resultId && task.messageId && task.interactionId,
      'Terminal intent needs an exact submitted and started role.');
      if (task.result.outcome.kind === 'stopped-partial'
        || state.stop?.injection?.acknowledgement?.toolCallId === data.toolCallId) {
        const injection = stopInjection(state, { stopId: state.stop?.id, taskId: data.taskId });
        requireCondition(injection.acknowledgement?.toolCallId === data.toolCallId
          && injection.messageId && injection.delivery?.messageId === injection.messageId,
        'Stop terminal intent requires the exact delivered injection response tool receipt.');
      }
      task.terminal = { resultId: task.result.resultId, toolCallId: text(data.toolCallId), eventId: text(data.eventId), acknowledged: false,
        ...(hasReason ? { reason: choice(data.reason, ['completion-timeout'] as const) } : {}) };
      break;
    }
    case 'acknowledge-role-end': {
      const data = object(command.data, ['taskId', 'resultId', 'toolCallId', 'eventId']), task = activeTask(state);
      requireCondition(task.binding.id === data.taskId && task.terminal && !task.terminal.acknowledged
        && task.terminal.resultId === data.resultId && task.terminal.toolCallId === data.toolCallId
        && task.terminal.eventId === data.eventId, 'Terminal acknowledgement differs from its durable intent.');
      task.terminal.acknowledged = true; break;
    }
    case 'acknowledge-stop': {
      const data = object(command.data, ['stopId', 'taskId']);
      requireCondition(state.stop && state.stop.mode !== 'after-step' && state.stop.id === data.stopId && state.stop.taskId === data.taskId
        && !state.stop.acknowledged, 'Stop acknowledgement needs its exact durable intent.');
      state.stop.acknowledged = true; break;
    }
    case 'request-stop-injection': {
      const data = object(command.data, ['stopId', 'taskId', 'requestId', 'inputDigest', 'promptDigest']);
      const task = activeTask(state), stop = state.stop;
      requireCondition(stop?.mode === 'after-step' && stop.id === data.stopId && stop.taskId === data.taskId
        && stop.requestId === data.requestId && task.binding.id === data.taskId && task.binding.requestId === data.requestId
        && state.activeRequestId === data.requestId && task.binding.inputDigest === data.inputDigest
        && task.messageId && task.interactionId && ['running', 'waiting-permission'].includes(task.condition)
        && !task.terminal && !task.end && !stop.injection,
      'Stop injection needs the exact started after-step task, before terminal/end, and may be attempted only once.');
      stop.injection = { taskId: task.binding.id, requestId: task.binding.requestId, inputDigest: digest(data.inputDigest),
        promptDigest: digest(data.promptDigest), messageId: null, delivery: null, acknowledgement: null, endEventId: null };
      break;
    }
    case 'acknowledge-stop-injection': {
      const data = object(command.data, ['stopId', 'taskId', 'messageId']), injection = stopInjection(state, data);
      requireCondition(!injection.messageId, 'Stop injection send acknowledgement is already recorded; never resend.');
      injection.messageId = text(data.messageId); break;
    }
    case 'deliver-stop-injection': {
      const data = object(command.data, ['stopId', 'taskId', 'eventId', 'messageId', 'turnId', 'interactionId', 'delivery']);
      const injection = stopInjection(state, data);
      requireCondition(injection.messageId && injection.messageId === data.messageId && !injection.delivery && !injection.endEventId,
        'Stop injection delivery requires the exact acknowledged message, once.');
      injection.delivery = { eventId: text(data.eventId), messageId: injection.messageId, turnId: text(data.turnId),
        interactionId: text(data.interactionId), delivery: choice(data.delivery, ['steering', 'queued', 'idle']) };
      break;
    }
    case 'record-stop-response': {
      const data = object(command.data, ['stopId', 'taskId', 'inputDigest', 'toolCallId', 'summary', 'evidenceRefs']);
      const injection = stopInjection(state, data);
      requireCondition(injection.inputDigest === data.inputDigest && injection.messageId
        && injection.delivery?.messageId === injection.messageId && !injection.acknowledgement && !injection.endEventId,
      'Stop response requires the exact delivered injection input, once.');
      injection.acknowledgement = { toolCallId: text(data.toolCallId), summary: text(data.summary), evidenceRefs: strings(data.evidenceRefs) };
      break;
    }
    case 'settle-stop-injection': {
      const data = object(command.data, ['stopId', 'taskId', 'endEventId']), injection = stopInjection(state, data);
      requireCondition(injection.messageId && injection.delivery?.messageId === injection.messageId
        && injection.acknowledgement && !injection.endEventId,
      'Stop injection settlement requires send acknowledgement, delivery and agent response, once.');
      injection.endEventId = text(data.endEventId); break;
    }
    case 'role-not-sent': {
      const data = object(command.data, ['taskId', 'snapshot']), task = activeTask(state);
      requireCondition(state.stop?.mode !== 'after-step' && state.stop?.taskId === task.binding.id && data.taskId === task.binding.id
        && !task.messageId && !task.interactionId && !task.result && !task.end,
      'Only a stopped dispatch proven not sent can end without native execution.');
      task.condition = 'not-sent'; task.after = parseSnapshotRef(data.snapshot); break;
    }
    case 'confirm-role-end': {
      const data = object(command.data, ['proof', 'snapshot']), proof = parseOwnedEnd(data.proof), task = activeTask(state);
      requireCondition(!task.end && proof.taskId === task.binding.id && proof.dispatchId === task.binding.dispatchId
        && proof.sessionId === task.binding.sessionId && proof.messageId === task.messageId && proof.interactionId === task.interactionId,
      'Native end does not match the owned role.');
      const cancelledInjection = state.stop?.mode !== 'after-step' && state.stop?.acknowledged
        && proof.termination === 'user-stop' && proof.abortAcknowledged;
      requireCondition(!state.stop?.injection || state.stop.injection.endEventId || cancelledInjection,
        'Stop injection must positively settle before role end; send acknowledgement is not an end.');
      const immediateStop = state.stop && state.stop.mode !== 'after-step';
      requireCondition(immediateStop || (task.result && task.condition !== 'waiting-permission' && proof.termination !== 'user-stop'),
        'A normal end needs its typed result; permission waiting is not completion.');
      requireCondition(proof.termination !== 'result-abort' || task.terminal?.acknowledged, 'Result cancellation acknowledgement is not recorded.');
      requireCondition(proof.termination !== 'user-stop' || state.stop?.acknowledged, 'User Stop cancellation acknowledgement is not recorded.');
      const snapshot = data.snapshot === null ? null : parseSnapshotRef(data.snapshot);
      requireCondition(snapshot !== null || task.binding.before === null,
        'Previously bound code evidence cannot be discarded at role end.');
      task.end = proof; task.after = snapshot; task.condition = 'ended';
      if (cancelledInjection && state.stop?.injection && !state.stop.injection.endEventId) {
        state.stop.injection.cancellationEndEventId = proof.endEventId;
      }
      if (task.binding.cycleId) {
        requireCondition(snapshot, 'A cycle role end requires actual code evidence.');
        cycleFor(state, task.binding.cycleId).current = snapshot;
      }
      break;
    }
    case 'apply-result': {
      const data = object(command.data, ['resultId', 'designPublication']), task = activeTask(state);
      requireCondition(allowsHumanRoleSettlement(state, task.binding.id) && task.result && task.result.resultId === data.resultId
        && (task.end || task.completion) && (!task.binding.cycleId || task.after), 'Apply the exact completed result with its recorded code evidence.');
      const result = task.result, outcome = result.outcome, request = activeRequest(state);
      validateResult(state, task, result);
      requireCondition(outcome.kind === 'designer-changed' || data.designPublication === null, 'This role cannot publish a Design.');
      let handoff = false;
      if (outcome.kind === 'route') { resolveQuestions(state, request, result); request.route = result; }
      else if (outcome.kind === 'internal-plan') cycleFor(state, task.binding.cycleId).pendingPlan = parseInternalPlan(outcome.plan);
      else if (outcome.kind === 'task-result') {
        const item = cycleFor(state, task.binding.cycleId).tasks.find(({ id }) => id === outcome.taskId)!;
        item.status = 'completed'; item.result = result;
      } else if (outcome.kind === 'implementation-result') {
        const cycle = cycleFor(state, task.binding.cycleId);
        cycle.implementationResult = result; cycle.phase = 'review-pending';
      } else {
        handoff = true;
        if (outcome.kind === 'designer-changed') {
          const publication = object(data.designPublication, ['previous', 'current', 'receiptId', 'artifactRef']);
          requireCondition(same(parseDesignBinding(publication.previous), state.design)
            && same(state.design, task.binding.design) && publication.artifactRef === outcome.artifactRef,
          'Design publication needs the exact prior revision and validated result artifact.');
          text(publication.receiptId); state.design = parseDesignBinding(publication.current);
          requireCondition(state.design.revisionId !== task.binding.design.revisionId, 'Changed Design requires a new revision.');
        } else if (outcome.kind === 'review-result') {
          const cycle = cycleFor(state, task.binding.cycleId);
          cycle.reviewResult = result; cycle.phase = 'completed';
        } else if (outcome.kind === 'design-concern') {
          const cycle = cycleFor(state, task.binding.cycleId);
          cycle.phase = 'waiting-input'; cycle.concernResultId = result.resultId;
          const item = cycle.tasks.find(({ id }) => id === task.binding.internalTaskId);
          if (item) item.status = 'waiting-input';
        } else if (outcome.kind === 'review-incomplete' && task.binding.cycleId) {
          const cycle = cycleFor(state, task.binding.cycleId);
          requireCondition(task.binding.role === 'reviewer' && cycle.implementationResult,
            'Incomplete Review must retain the completed implementation.');
          cycle.reviewResult ??= result; cycle.phase = 'completed';
        } else if (outcome.kind === 'execution-failure' && task.binding.cycleId) {
          cycleFor(state, task.binding.cycleId).phase = 'failed';
        }
        if ('questions' in outcome) recordQuestions(state, task, result, outcome.questions);
      }
      if (handoff) {
        state.handoffs.push({ id: `handoff:${result.resultId}`, requestId: request.id, requestIds: [...state.activeBatchRequestIds], cycleId: task.binding.cycleId,
          result, snapshot: task.after, presented: false });
        for (const source of state.requests) if (state.activeBatchRequestIds.includes(source.id)) source.status = 'handoff-pending';
      }
      state.executions.push(task); state.activeTask = null; break;
    }
    case 'record-review-index': {
      const data = object(command.data, ['taskId', 'resultId', 'receiptId', 'before', 'after']), task = activeTask(state);
      const cycle = cycleFor(state, task.binding.cycleId);
      requireCondition(task.binding.id === data.taskId && task.binding.role === 'reviewer'
        && task.result?.outcome.kind === 'review-result' && task.result.resultId === data.resultId && (task.end || task.completion)
        && same(task.after, parseSnapshotRef(data.before)) && same(cycle.current, task.after),
      'Host index evidence needs the exact ended whole-plan Review and code boundary.');
      const after = parseSnapshotRef(data.after);
      cycle.indexReceipt = { id: text(data.receiptId), resultId: task.result.resultId, snapshot: after };
      cycle.current = after; task.after = after; break;
    }
    case 'accept-plan': {
      const data = object(command.data, ['cycleId', 'acceptance']), cycle = cycleFor(state, data.cycleId), request = activeRequest(state);
      const route = routeFor(request), plan = cycle.pendingPlan;
      requireCondition(!state.stop || (state.stop.mode === 'after-step' && state.executions.some((task) =>
        task.binding.id === state.stop!.taskId && task.result?.outcome.kind === 'internal-plan'
        && parseInternalPlan(task.result.outcome.plan).digest === plan?.digest)), 'Plan acceptance is outside the settling role.');
      requireCondition(!state.activeTask && cycle.phase === 'planning' && plan && cycle.requestIds.includes(request.id), 'No ended planning result is available for Host acceptance.');
      const acceptance = object(data.acceptance, ['schemaVersion', 'authority', 'cycleId', 'requestId', 'routeResultId',
        'planId', 'planDigest', 'sourceRequestIds', 'design', 'baseline', 'policyDigest']);
      const expected: InternalAcceptance = { schemaVersion: 'internal-plan-acceptance/v1', authority: 'host',
        cycleId: cycle.id, requestId: request.id, routeResultId: route.resultId, planId: plan.id, planDigest: plan.digest,
        sourceRequestIds: [...state.activeBatchRequestIds],
        design: cycle.design, baseline: cycle.current, policyDigest: state.owner.policy.digest };
      requireCondition(same(acceptance, expected) && same(plan.design, cycle.design) && same(plan.baseline, cycle.current),
        'Internal acceptance must have real Host/request/plan/code provenance, never a fabricated user approval.');
      const previousTasks = cycle.tasks;
      const canReuseCompleted = cycle.plan && same(cycle.plan.design, plan.design);
      if (cycle.plan) cycle.planHistory.push(cycle.plan);
      cycle.plan = plan; cycle.pendingPlan = null; cycle.acceptance = expected; cycle.phase = 'implementing';
      cycle.tasks = plan.tasks.map((task) => {
        const previous = canReuseCompleted ? previousTasks.find((entry) => entry.id === task.id
          && entry.definitionDigest === policyHash(task) && entry.status === 'completed') : undefined;
        return previous ?? { id: task.id, definitionDigest: policyHash(task), status: 'pending', result: null, progress: [] };
      });
      break;
    }
    case 'present-handoff': {
      const withConfirmation = command.data !== null && typeof command.data === 'object' && Object.hasOwn(command.data, 'implementationConfirmation');
      const data = object(command.data, ['handoffId', ...(withConfirmation ? ['implementationConfirmation'] : [])]);
      const handoff = state.handoffs.find(({ id }) => id === data.handoffId);
      const request = state.requests.find(({ id }) => id === state.activeRequestId);
      const settling = state.stop?.mode === 'after-step' && state.stop.requestId === request?.id
        && state.executions.some((task) => task.binding.id === state.stop!.taskId && task.result?.resultId === handoff?.result.resultId);
      requireCondition(!state.activeTask && (!state.stop || settling) && handoff && !handoff.presented && request?.status === 'handoff-pending'
        && handoff.requestId === request.id && sameSet(handoff.requestIds, state.activeBatchRequestIds),
      'Only the exact saved visible handoff may release the user queue.');
      handoff.presented = true;
      for (const source of state.requests) if (state.activeBatchRequestIds.includes(source.id)) {
        source.status = handoff.result.outcome.kind === 'stopped-partial' ? 'stopped' : 'completed';
      }
      if (withConfirmation) {
        const input = object(data.implementationConfirmation, ['id', 'createdAt']);
        requireCondition(!settling && ['designer-changed', 'designer-unchanged'].includes(handoff.result.outcome.kind)
          && requestsImplementationAfterDesign(state, request)
          && !state.questions.some(q => q.state === 'open' && q.blockingActive),
        'Only settled mixed answers may propose implementation after the Design handoff.');
        const createdAt = text(input.createdAt), confirmationId = text(input.id);
        requireCondition(Number.isFinite(Date.parse(createdAt))
          && !state.implementationConfirmations?.some(c => c.id === confirmationId), 'Invalid post-Design confirmation identity.');
        (state.implementationConfirmations ??= []).push({ id: confirmationId, requestId: request.id,
          requestIds: [...state.activeBatchRequestIds], routeResultId: routeFor(request).resultId, design: structuredClone(state.design),
          afterDesignResultId: handoff.result.resultId, status: 'pending', createdAt, decidedAt: null });
        for (const source of state.requests) if (state.activeBatchRequestIds.includes(source.id)) source.status = 'active';
      } else if (!settling) { state.activeRequestId = null; state.activeBatchRequestIds = []; }
      break;
    }
    case 'request-stop':
    case 'request-step-stop': {
      const data = object(command.data, ['stopId']);
      const stopId = text(data.stopId);
      if (state.stop && type === 'request-stop') {
        requireCondition(state.stop.id === stopId, 'Immediate escalation must retain the exact current Stop identity.');
        delete state.stop.mode;
        releaseQuestionGates(state);
        break;
      }
      if (type === 'request-step-stop' && state.stop?.mode === 'after-step') break;
      requireCondition(!state.stop, 'Another Stop boundary already owns cancellation.');
      requireCondition(!state.stops.some(({ id }) => id === stopId), 'Stop identity was reused.');
      for (const confirmation of state.implementationConfirmations ?? []) if (confirmation.status === 'pending') confirmation.status = 'invalidated';
      const discardedRequestIds: string[] = [];
      for (const request of state.requests) if (request.status === 'waiting') {
        request.status = 'discarded'; request.stopId = stopId; discardedRequestIds.push(request.id);
      }
      const unsettled = type === 'request-step-stop' ? state.executions.findLast((task) =>
        task.binding.requestId === state.activeRequestId && (state.handoffs.some((handoff) =>
          !handoff.presented && handoff.result.resultId === task.result?.resultId)
          || (task.result?.outcome.kind === 'internal-plan' && state.cycles.some((cycle) =>
            cycle.id === task.binding.cycleId && cycle.pendingPlan)))) : undefined;
      const settlingTask = state.activeTask ?? unsettled;
      const cycleId = settlingTask?.binding.cycleId
        ?? state.cycles.find((cycle) => cycle.requestIds.includes(state.activeRequestId ?? '') && !['completed', 'failed', 'stopped'].includes(cycle.phase))?.id
        ?? state.cycles.findLast(cycle => cycle.phase === 'waiting-input'
          && state.questions.some(q => q.source.cycleId === cycle.id && q.blockingActive))?.id ?? null;
      state.stop = { id: stopId, requestId: state.activeRequestId, requestIds: [...state.activeBatchRequestIds],
        taskId: settlingTask?.binding.id ?? null, cycleId,
        discardedRequestIds, acknowledged: false, ...(type === 'request-step-stop' ? { mode: 'after-step' as const } : {}) };
      releaseQuestionGates(state);
      break;
    }
    case 'confirm-stop': {
      const data = object(command.data, ['stopId', 'snapshot']);
      requireCondition(state.stop && state.stop.id === data.stopId
        && (!state.activeTask || state.activeTask.end || state.activeTask.completion === 'native-stop'
          || state.activeTask.condition === 'not-sent'), 'Stop requires its actual native operation response.');
      requireCondition(state.stop.nativeResult || state.stop.mode === 'after-step' || !state.stop.injection || state.stop.injection.endEventId
        || (state.stop.mode !== 'after-step' && state.stop.acknowledged
          && state.stop.injection.cancellationEndEventId === state.activeTask?.end?.endEventId),
        'Stop injection must positively settle before Stop confirmation; send acknowledgement is not an end.');
      if (state.stop.mode === 'after-step') {
        const completed = state.executions.find((task) => task.binding.id === state.stop!.taskId);
        requireCondition(!state.activeTask && (!state.stop.taskId || (completed?.result && (completed.end || completed.completion))),
          'After-step Stop requires the admitted role result and Host application.');
        const handoff = state.handoffs.find((entry) => entry.result.resultId === completed?.result?.resultId);
        requireCondition(!handoff || handoff.presented, 'After-step Stop requires the completed role handoff to be settled.');
      }
      const snapshot = parseSnapshotRef(data.snapshot);
      if (state.activeTask) {
        if (state.activeTask.completion === 'native-stop') state.activeTask.after = snapshot;
        else requireCondition(same(snapshot, state.activeTask.after), 'Stop must retain its captured actual code.');
        state.executions.push(state.activeTask);
        if (state.activeTask.binding.cycleId) {
          const cycle = cycleFor(state, state.activeTask.binding.cycleId);
          cycle.current = snapshot; cycle.phase = 'stopped';
        }
      }
      for (const cycle of state.cycles) if (cycle.id === state.stop.cycleId && cycle.phase !== 'completed'
        && !(state.stop.mode === 'after-step' && cycle.phase === 'failed')) {
        cycle.phase = 'stopped'; cycle.current = snapshot;
      }
      for (const request of state.requests) if (state.stop.requestIds.includes(request.id)) {
        if (state.stop.mode !== 'after-step' || request.status !== 'completed') request.status = 'stopped';
        request.stopId = state.stop.id;
      }
      releaseQuestionGates(state);
      state.stops.push({ ...state.stop, snapshot });
      state.activeTask = null; state.activeRequestId = null; state.activeBatchRequestIds = []; state.stop = null; break;
    }
    case 'execution-unknown': {
      const data = object(command.data, ['reason', 'evidenceRef']);
      state.uncertainty = { reason: text(data.reason), evidenceRef: text(data.evidenceRef) };
      if (state.activeTask) state.activeTask.condition = 'unknown';
      break;
    }
    case 'execution-failed': {
      const modern = command.data !== null && typeof command.data === 'object' && Object.hasOwn(command.data, 'completion');
      const data = object(command.data, ['taskId', 'reason', 'evidenceRef', ...(modern ? ['completion'] : [])]), task = activeTask(state);
      if (modern) requireCondition(data.completion === 'reported-failure', 'Unknown failure completion authority.');
      requireCondition(data.taskId === task.binding.id && task.messageId && task.interactionId && !task.result && !task.end,
        'A known failure needs an owned started task; ambiguous execution remains unknown.');
      task.result = { schemaVersion: 'human-role-result/v1', resultId: `failure:${id}`, inputDigest: task.binding.inputDigest,
        outcome: { kind: task.binding.role === 'reviewer' ? 'review-incomplete' : 'execution-failure',
          summary: task.binding.role === 'reviewer'
            ? 'Review did not complete. Your implementation is retained; this is not approval. You may send another request without retrying Review.'
            : 'The requested execution failed; partial work is not whole-plan completion.',
          reason: text(data.reason), evidenceRefs: [text(data.evidenceRef)] } };
      if (data.completion === 'reported-failure') {
        task.completion = 'reported-failure'; task.condition = 'ended';
      }
      break;
    }
  }
  state.revision++; state.applied.push({ id, signature }); return state;
}
