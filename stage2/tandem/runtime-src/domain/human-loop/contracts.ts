import { isAbsolute } from 'node:path';
import { parseRoleMention, type RoleHint } from '../../../public/role-hint.js';
import { parseRequestAttachments, type RequestAttachment } from '../workflow/image-attachment.ts';
import { policyHash } from '../workflow/policy.ts';
import { choice, integer, list, object, requireCondition, strings, text, unique } from '../workflow/validation.ts';

export const HUMAN_LOOP_SCHEMA = 'human-loop/v2' as const;
export const roles = ['router', 'designer', 'planner', 'implementer', 'reviewer', 'agent'] as const;
export type HumanRole = typeof roles[number];
export type Authority = 'user' | 'host' | 'agent' | 'runtime';
export interface DesignBinding { revisionId: string | null; digest: string | null }
export interface SnapshotRef { id: string; digest: string }
export interface InternalTask {
  id: string; title: string; scope: string[]; dependsOn: string[];
  criteria: Array<{ id: string; description: string }>;
  designRefs?: string[];
}
export interface InternalPlanProposal {
  schemaVersion: 'internal-plan/v1'; id: string; version: number; goal: string;
  design: DesignBinding; baseline: SnapshotRef; tasks: InternalTask[];
}
export interface InternalPlan extends InternalPlanProposal { digest: string }
export interface InternalAcceptance {
  schemaVersion: 'internal-plan-acceptance/v1'; authority: 'host';
  cycleId: string; requestId: string; routeResultId: string; planId: string; planDigest: string;
  sourceRequestIds: string[]; design: DesignBinding; baseline: SnapshotRef; policyDigest: string;
}
export interface QuestionOption {
  id: string; label: string; implication: string;
  resolutionTarget?: 'design' | 'implementation';
}
export interface QuestionDraft {
  id: string; context: string; question: string; whyItMatters: string;
  importance: 'blocking' | 'advisory';
  options: QuestionOption[];
  allowFreeform: boolean;
  designRefs?: string[];
  unanswered?: { action: 'keep-current-design'; explanation: string };
}
export interface QuestionSource {
  role: 'designer' | 'reviewer' | 'planner' | 'implementer';
  resultId: string; requestId: string; cycleId: string | null;
  requestIds: string[]; design: DesignBinding; planDigest: string | null;
}
export interface QuestionRecord extends QuestionDraft {
  source: QuestionSource; state: 'open' | 'answered' | 'deferred' | 'invalidated'; answerRequestId: string | null;
  blockingActive: boolean;
  invalidation?: { stopId: string; recoveryId?: never; reason: string }
    | { recoveryId: string; stopId?: never; reason: string };
}
export interface QuestionAnswer {
  questionId: string; sourceResultId: string; kind: 'option' | 'freeform'; value: string;
  selectedOption?: Omit<QuestionOption, 'id'>;
}
export interface QuestionResolution {
  questionId: string; sourceResultId: string;
}
export interface AnswerBatch { schemaVersion: 'human-question-answers/v1'; answers: QuestionAnswer[] }
export interface HumanRequest {
  id: string; message: string; receivedAt: string; answers: AnswerBatch | null;
  attachments?: RequestAttachment[];
  roleHint?: RoleHint;
}
export interface TaskBinding {
  id: string; dispatchId: string; sessionId: string; requestId: string; cycleId: string | null;
  role: HumanRole; internalTaskId: string | null; inputDigest: string;
  before: SnapshotRef | null; design: DesignBinding;
}
export type NativeUserEvidence =
  | { id: string; messageId: string; turnId: string; interactionId: string }
  | { schemaVersion: 'human-loop-native-user/v2'; id: string; messageId: string | null;
      turnId: string | null; interactionId: string | null; parentAgentTaskId?: string | null };
export interface RoleInputEnvelope {
  schemaVersion: 'human-role-input/v1'; kind: 'initial' | 'continuation';
  promptDigest: string; promptBytes: number; attachmentsDigest: string;
}
export interface RoleInput extends RoleInputEnvelope {
  acknowledgementId: string | null;
  native: { user: NativeUserEvidence; turnId: string; startEventId: string } | null;
}
export function parseNativeUserEvidence(value: unknown): NativeUserEvidence {
  const modern = value !== null && typeof value === 'object' && 'schemaVersion' in value;
  const telemetry = modern && Object.hasOwn(value, 'parentAgentTaskId');
  const data = object(value, [...(modern ? ['schemaVersion'] : []), 'id', 'messageId', 'turnId', 'interactionId',
    ...(telemetry ? ['parentAgentTaskId'] : [])]);
  if (!modern) return { id: text(data.id), messageId: text(data.messageId),
    turnId: text(data.turnId), interactionId: text(data.interactionId) };
  requireCondition(data.schemaVersion === 'human-loop-native-user/v2', 'Incompatible native input evidence.');
  const user: NativeUserEvidence = { schemaVersion: 'human-loop-native-user/v2', id: text(data.id),
    messageId: data.messageId === null ? null : text(data.messageId),
    turnId: data.turnId === null ? null : text(data.turnId),
    interactionId: data.interactionId === null ? null : text(data.interactionId) };
  if (!telemetry) return user;
  const parentAgentTaskId = data.parentAgentTaskId;
  requireCondition(parentAgentTaskId === null || typeof parentAgentTaskId === 'string', 'Native input parent telemetry must be a string or null.');
  return { ...user, parentAgentTaskId };
}
export function parseRoleInputEnvelope(value: unknown): RoleInputEnvelope {
  const data = object(value, ['schemaVersion', 'kind', 'promptDigest', 'promptBytes', 'attachmentsDigest']);
  requireCondition(data.schemaVersion === 'human-role-input/v1', 'Incompatible sent-envelope evidence.');
  return { schemaVersion: data.schemaVersion, kind: choice(data.kind, ['initial', 'continuation'] as const),
    promptDigest: digest(data.promptDigest), promptBytes: integer(data.promptBytes, 1), attachmentsDigest: digest(data.attachmentsDigest) };
}
export interface OwnedEnd {
  taskId: string; dispatchId: string; sessionId: string; messageId: string; interactionId: string;
  endEventId: string; quiescent: true; termination: 'normal' | 'result-abort' | 'user-stop';
  abortAcknowledged: boolean;
}
export interface TaskProgress {
  schemaVersion: 'human-task-progress/v1';
  taskId: string; planDigest: string; status: 'started' | 'progress'; summary: string; evidenceRefs: string[];
}
export interface ReviewFinding {
  id: string; kind: 'correctness' | 'design-consistency' | 'missing-evidence' | 'misaligned-decision' | 'uncovered-decision'
    | 'design-conformance' | 'over-engineering';
  summary: string; consequence: string; evidenceRefs: string[];
  designRefs?: string[];
  designBasis?: string; questionId?: string;
}
export type RoleOutcome =
  | { kind: 'execution-failure'; summary: string; reason: string; evidenceRefs: string[] }
  | { kind: 'review-incomplete'; summary: string; reason: string; evidenceRefs: string[] }
  | { kind: 'stopped-partial'; summary: string; evidenceRefs: string[]; stopId: string }
  | { kind: 'route'; intent: 'design' | 'implement' | 'answer' | 'resume-cycle' | 'replan-cycle';
      cycleId: string | null; summary: string; resolvedQuestions: QuestionResolution[] }
  | { kind: 'internal-plan'; plan: InternalPlanProposal }
  | { kind: 'task-result'; taskId: string; planDigest: string; summary: string; evidenceRefs: string[] }
  | { kind: 'implementation-result'; planDigest: string; completedTaskIds: string[]; summary: string; evidenceRefs: string[] }
  | { kind: 'design-concern'; reason: string; summary: string; questions: QuestionDraft[] }
  | { kind: 'designer-changed'; summary: string; artifactRef: string; questions: QuestionDraft[] }
  | { kind: 'designer-unchanged'; summary: string; explanation: string; questions: QuestionDraft[] }
  | { kind: 'review-result'; planDigest: string; summary: string;
      reviewFormat?: 'decision-review/v1' | 'decision-review/v2';
      coverageStatus?: 'complete' | 'partial' | 'unavailable';
      assessments: Array<{ taskId: string; criterionId: string; status: 'supported' | 'issue' | 'unverified'; evidenceRefs: string[]; designRefs?: string[] }>;
      findings: ReviewFinding[]; verificationLimits: string[];
      evidenceRefs: string[]; questions: QuestionDraft[] }
  | { kind: 'answer'; summary: string; report: string; evidenceRefs: string[]; designRefs?: string[] };
export interface RoleResult {
  schemaVersion: 'human-role-result/v1'; resultId: string; inputDigest: string; outcome: RoleOutcome;
}

export function digest(value: unknown): string {
  const result = text(value);
  requireCondition(/^[a-f0-9]{64}$/.test(result), 'Expected a SHA-256 identity.');
  return result;
}
export function parseDesignBinding(value: unknown): DesignBinding {
  const data = object(value, ['revisionId', 'digest']);
  requireCondition((data.revisionId === null) === (data.digest === null), 'Design absence must be explicit.');
  return { revisionId: data.revisionId === null ? null : text(data.revisionId), digest: data.digest === null ? null : digest(data.digest) };
}
export function parseSnapshotRef(value: unknown): SnapshotRef {
  const data = object(value, ['id', 'digest']);
  return { id: text(data.id), digest: digest(data.digest) };
}
function referencedObject(value: unknown, keys: string[]): Record<string, unknown> {
  const hasRefs = value !== null && typeof value === 'object' && Object.hasOwn(value, 'designRefs');
  return object(value, hasRefs ? [...keys, 'designRefs'] : keys);
}
function designRefs(data: Record<string, unknown>): { designRefs?: string[] } {
  return Object.hasOwn(data, 'designRefs') ? { designRefs: strings(data.designRefs) } : {};
}
export function parseInternalPlan(value: unknown): InternalPlan {
  const data = object(value, ['schemaVersion', 'id', 'version', 'goal', 'design', 'baseline', 'tasks']);
  requireCondition(data.schemaVersion === 'internal-plan/v1', 'Incompatible internal plan schema.');
  const tasks = list(data.tasks, (value): InternalTask => {
    const task = referencedObject(value, ['id', 'title', 'scope', 'dependsOn', 'criteria']);
    const scope = strings(task.scope);
    requireCondition(scope.length > 0 && scope.every((path) => !isAbsolute(path) && !/[:<>"|\u0000-\u001f]/.test(path)
      && !/^[\\/]|[*?]/.test(path) && !path.replaceAll('\\', '/').split('/').some((part) =>
        !part || ['.', '..', '.git', '.tandem', 'tandem.md', '.teleos', 'teleos.md', '.tandem-migration.lock'].includes(part.toLowerCase()))),
    'Internal task scope must name relative project paths, not protected metadata or wildcards.');
    const criteria = list(task.criteria, (value) => {
      const criterion = object(value, ['id', 'description']);
      return { id: text(criterion.id), description: text(criterion.description) };
    });
    requireCondition(criteria.length > 0, 'Internal tasks need criteria for whole-plan Review.');
    unique(criteria.map(({ id }) => id));
    return { id: text(task.id), title: text(task.title), scope, dependsOn: strings(task.dependsOn), criteria, ...designRefs(task) };
  });
  requireCondition(tasks.length > 0, 'An internal plan cannot be empty.');
  unique(tasks.map(({ id }) => id));
  const visited = new Set<string>(), visiting = new Set<string>();
  const visit = (id: string) => {
    requireCondition(!visiting.has(id), 'Internal task dependencies are cyclic.');
    if (visited.has(id)) return;
    const task = tasks.find((task) => task.id === id);
    requireCondition(task, 'Unknown internal task dependency.');
    visiting.add(id); task.dependsOn.forEach(visit); visiting.delete(id); visited.add(id);
  };
  tasks.forEach(({ id }) => visit(id));
  const proposal: InternalPlanProposal = { schemaVersion: 'internal-plan/v1', id: text(data.id),
    version: integer(data.version, 1), goal: text(data.goal), design: parseDesignBinding(data.design),
    baseline: parseSnapshotRef(data.baseline), tasks };
  return { ...proposal, digest: policyHash(proposal) };
}
export function parseQuestions(value: unknown): QuestionDraft[] {
  const questions = list(value, (value): QuestionDraft => {
    const data = referencedObject(value, ['id', 'context', 'question', 'whyItMatters', 'importance', 'options', 'allowFreeform',
      ...(Object.hasOwn(value ?? {}, 'unanswered') ? ['unanswered'] : [])]);
    requireCondition(typeof data.allowFreeform === 'boolean', 'Question free-text support must be explicit.');
    const options = list(data.options, (value) => {
      const option = object(value, ['id', 'label', 'implication',
        ...(Object.hasOwn(value ?? {}, 'resolutionTarget') ? ['resolutionTarget'] : [])]);
      return { id: text(option.id), ...parseSelectedOption({
        label: option.label, implication: option.implication,
        ...(Object.hasOwn(option, 'resolutionTarget') ? { resolutionTarget: option.resolutionTarget } : {}),
      }) };
    });
    unique(options.map(({ id }) => id));
    requireCondition(options.length >= 2 || data.allowFreeform, 'A question needs choices or free-text input.');
    let unanswered: QuestionDraft['unanswered'];
    if (Object.hasOwn(data, 'unanswered')) {
      const continuation = object(data.unanswered, ['action', 'explanation']);
      requireCondition(data.importance === 'advisory', 'Blocking questions cannot declare an unanswered continuation.');
      requireCondition(continuation.action === 'keep-current-design',
        'An advisory continuation must keep the current Design; choices requiring a change or authorization must be blocking.');
      unanswered = { action: 'keep-current-design', explanation: text(continuation.explanation) };
      requireCondition(unanswered.explanation.length <= 2000, 'Explain the unanswered continuation in at most 2000 characters.');
    }
    return { id: text(data.id), context: text(data.context), question: text(data.question),
      whyItMatters: text(data.whyItMatters), importance: choice(data.importance, ['blocking', 'advisory']),
      options, allowFreeform: data.allowFreeform, ...designRefs(data), ...(unanswered ? { unanswered } : {}) };
  });
  unique(questions.map(({ id }) => id));
  return questions;
}
export function requireDeclaredAdvisoryContinuations(questions: readonly QuestionDraft[]): void {
  requireCondition(questions.every(q => q.importance !== 'advisory' || q.unanswered?.action === 'keep-current-design'),
    'Every new advisory question must declare unanswered: { action: "keep-current-design", explanation: "..." }. State the safe continuation, or classify the question as blocking. Recommended option text is not a default.');
}

export function advisoryContinuationIssue(question: QuestionRecord, currentDesign: DesignBinding): 'missing' | 'stale' | null {
  if (question.importance !== 'advisory') return null;
  if (!question.unanswered || question.unanswered.action !== 'keep-current-design' || !question.unanswered.explanation?.trim()) return 'missing';
  return question.source.design.revisionId !== currentDesign.revisionId || question.source.design.digest !== currentDesign.digest ? 'stale' : null;
}
function parseSelectedOption(value: unknown): Omit<QuestionOption, 'id'> {
  const data = object(value, ['label', 'implication',
    ...(Object.hasOwn(value ?? {}, 'resolutionTarget') ? ['resolutionTarget'] : [])]);
  const resolutionTarget = Object.hasOwn(data, 'resolutionTarget')
    ? choice(data.resolutionTarget, ['design', 'implementation'] as const) : undefined;
  const label = text(data.label);
  if (resolutionTarget) {
    const prefix = `Change ${resolutionTarget === 'design' ? 'Design' : 'implementation'} - `;
    requireCondition(label.startsWith(prefix) && label.slice(prefix.length).trim().length > 0,
      'A resolution option must name its target and concrete effect: Change Design - ... or Change implementation - ...');
  }
  return { label, implication: text(data.implication), ...(resolutionTarget ? { resolutionTarget } : {}) };
}
export function parseAnswerBatch(value: unknown): AnswerBatch {
  const data = object(value, ['schemaVersion', 'answers']);
  requireCondition(data.schemaVersion === 'human-question-answers/v1', 'Incompatible question-answer schema.');
  const answers = list(data.answers, (value): QuestionAnswer => {
    const answer = object(value, ['questionId', 'sourceResultId', 'kind', 'value',
      ...(Object.hasOwn(value ?? {}, 'selectedOption') ? ['selectedOption'] : [])]);
    requireCondition(!Object.hasOwn(answer, 'selectedOption') || answer.kind === 'option',
      'Freeform answers cannot carry a selected-option interpretation.');
    return { questionId: text(answer.questionId), sourceResultId: text(answer.sourceResultId),
      kind: choice(answer.kind, ['option', 'freeform']), value: text(answer.value),
      ...(Object.hasOwn(answer, 'selectedOption') ? { selectedOption: parseSelectedOption(answer.selectedOption) } : {}) };
  });
  requireCondition(answers.length > 0, 'An answer batch cannot be empty.');
  unique(answers.map((answer) => JSON.stringify([answer.sourceResultId, answer.questionId])));
  return { schemaVersion: 'human-question-answers/v1', answers };
}
export function parseRequest(value: unknown): HumanRequest {
  const data = object(value, ['id', 'message', 'receivedAt', 'answers',
    ...(Object.hasOwn(value ?? {}, 'roleHint') ? ['roleHint'] : []),
    ...(Object.hasOwn(value ?? {}, 'attachments') ? ['attachments'] : [])]);
  const receivedAt = text(data.receivedAt);
  requireCondition(Number.isFinite(Date.parse(receivedAt)), 'Invalid request timestamp.');
  const attachments = data.attachments === undefined ? undefined : parseRequestAttachments(data.attachments);
  requireCondition(typeof data.message === 'string' && (data.message.trim().length > 0 || attachments?.length === 1), 'A request needs text or an image.');
  let roleHint: RoleHint | undefined;
  if (Object.hasOwn(data, 'roleHint')) {
    requireCondition(data.answers === null, 'Question answers cannot carry composer role hints.');
    const hint = object(data.roleHint, ['schemaVersion', 'role']);
    requireCondition(hint.schemaVersion === 'human-role-hint/v1', 'Incompatible role-hint schema.');
    roleHint = { schemaVersion: hint.schemaVersion, role: choice(hint.role, ['designer', 'agent'] as const) };
    const parsed = parseRoleMention(data.message);
    requireCondition(!parsed.error, parsed.error ?? 'Invalid role hint.');
    requireCondition(parsed.roleHint?.role === roleHint.role, 'Role hint does not match the original leading mention.');
  }
  return { id: text(data.id), message: data.message, receivedAt,
    answers: data.answers === null ? null : parseAnswerBatch(data.answers),
    ...(roleHint ? { roleHint } : {}),
    ...(attachments !== undefined ? { attachments } : {}) };
}
export function bindQuestionOptions(request: HumanRequest, questions: readonly QuestionRecord[]): HumanRequest {
  if (!request.answers) return request;
  const answers = request.answers.answers.map(answer => {
    if (answer.kind !== 'option') return answer;
    const question = questions.find(q => q.id === answer.questionId && q.source.resultId === answer.sourceResultId);
    const option = question?.options.find(o => o.id === answer.value);
    requireCondition(option, 'Answer source is stale or unknown. Selected option is absent from its canonical question.');
    const { id: _id, ...selectedOption } = option;
    requireCondition(!answer.selectedOption || policyHash(answer.selectedOption) === policyHash(selectedOption),
      'Selected-option wording or target differs from the canonical source question.');
    return { ...answer, selectedOption };
  });
  return { ...request, answers: { ...request.answers, answers } };
}
export function parseTaskBinding(value: unknown): TaskBinding {
  const data = object(value, ['id', 'dispatchId', 'sessionId', 'requestId', 'cycleId', 'role', 'internalTaskId', 'inputDigest', 'before', 'design']);
  const role = choice(data.role, roles);
  requireCondition(data.internalTaskId === null || role === 'implementer', 'Only implementation selects an internal task.');
  const before = data.before === null ? null : parseSnapshotRef(data.before);
  requireCondition(before !== null || ['router', 'designer', 'agent'].includes(role),
    'Cycle roles require actual code evidence; conversational roles may explicitly omit it.');
  return { id: text(data.id), dispatchId: text(data.dispatchId), sessionId: text(data.sessionId),
    requestId: text(data.requestId), cycleId: data.cycleId === null ? null : text(data.cycleId), role,
    internalTaskId: data.internalTaskId === null ? null : text(data.internalTaskId), inputDigest: digest(data.inputDigest),
    before, design: parseDesignBinding(data.design) };
}
export function parseOwnedEnd(value: unknown): OwnedEnd {
  const data = object(value, ['taskId', 'dispatchId', 'sessionId', 'messageId', 'interactionId',
    'endEventId', 'quiescent', 'termination', 'abortAcknowledged']);
  const termination = choice(data.termination, ['normal', 'result-abort', 'user-stop']);
  requireCondition(data.quiescent === true && typeof data.abortAcknowledged === 'boolean'
    && (termination === 'normal' || data.abortAcknowledged), 'Positive owned end and cancellation acknowledgement are required.');
  return { taskId: text(data.taskId), dispatchId: text(data.dispatchId), sessionId: text(data.sessionId),
    messageId: text(data.messageId), interactionId: text(data.interactionId), endEventId: text(data.endEventId),
    quiescent: true, termination, abortAcknowledged: data.abortAcknowledged };
}
export function parseProgress(value: unknown): TaskProgress {
  const data = object(value, ['schemaVersion', 'taskId', 'planDigest', 'status', 'summary', 'evidenceRefs']);
  requireCondition(data.schemaVersion === 'human-task-progress/v1', 'Incompatible task progress schema.');
  return { schemaVersion: 'human-task-progress/v1', taskId: text(data.taskId), planDigest: digest(data.planDigest),
    status: choice(data.status, ['started', 'progress']), summary: text(data.summary), evidenceRefs: strings(data.evidenceRefs) };
}
export function parseRoleResult(role: HumanRole, value: unknown): RoleResult {
  const data = object(value, ['schemaVersion', 'resultId', 'inputDigest', 'outcome']);
  requireCondition(data.schemaVersion === 'human-role-result/v1', 'Incompatible role-result schema.');
  requireCondition(data.outcome !== null && typeof data.outcome === 'object' && 'kind' in data.outcome, 'Role outcome is missing.');
  const kind = data.outcome.kind;
  let outcome: RoleOutcome;
  switch (kind) {
    case 'stopped-partial': {
      const v = object(data.outcome, ['kind', 'summary', 'evidenceRefs', 'stopId']);
      outcome = { kind, summary: text(v.summary), evidenceRefs: strings(v.evidenceRefs), stopId: text(v.stopId) };
      break;
    }
    case 'route': {
      requireCondition(role === 'router', 'Only Router interprets requests.');
      const v = object(data.outcome, ['kind', 'intent', 'cycleId', 'summary', 'resolvedQuestions']);
      const resolvedQuestions = list(v.resolvedQuestions, (entry): QuestionResolution => {
        const q = object(entry, ['questionId', 'sourceResultId']);
        return { questionId: text(q.questionId), sourceResultId: text(q.sourceResultId) };
      });
      unique(resolvedQuestions.map((q) => JSON.stringify([q.sourceResultId, q.questionId])));
      outcome = { kind, intent: choice(v.intent, ['design', 'implement', 'answer', 'resume-cycle', 'replan-cycle']),
        cycleId: v.cycleId === null ? null : text(v.cycleId), summary: text(v.summary), resolvedQuestions };
      break;
    }
    case 'internal-plan': {
      requireCondition(role === 'planner', 'Internal plan belongs to the planning role.');
      const v = object(data.outcome, ['kind', 'plan']);
      const { digest: _digest, ...plan } = parseInternalPlan(v.plan);
      outcome = { kind, plan }; break;
    }
    case 'task-result': {
      requireCondition(role === 'implementer', 'Task results belong to implementation.');
      const v = object(data.outcome, ['kind', 'taskId', 'planDigest', 'summary', 'evidenceRefs']);
      outcome = { kind, taskId: text(v.taskId), planDigest: digest(v.planDigest), summary: text(v.summary), evidenceRefs: strings(v.evidenceRefs) };
      break;
    }
    case 'implementation-result': {
      requireCondition(role === 'implementer', 'Whole-plan completion belongs to implementation.');
      const v = object(data.outcome, ['kind', 'planDigest', 'completedTaskIds', 'summary', 'evidenceRefs']);
      outcome = { kind, planDigest: digest(v.planDigest), completedTaskIds: strings(v.completedTaskIds),
        summary: text(v.summary), evidenceRefs: strings(v.evidenceRefs) }; break;
    }
    case 'design-concern': {
      requireCondition(role === 'planner' || role === 'implementer', 'Only implementation planning/coding raises this prerequisite.');
      const v = object(data.outcome, ['kind', 'reason', 'summary', 'questions']);
      const questions = parseQuestions(v.questions);
      requireCondition(questions.some(({ importance }) => importance === 'blocking'), 'A Design prerequisite needs an explicit blocking question.');
      outcome = { kind, reason: text(v.reason), summary: text(v.summary), questions }; break;
    }
    case 'designer-changed':
    case 'designer-unchanged': {
      requireCondition(role === 'designer', 'Only Designer produces Design outcomes.');
      const v = object(data.outcome, ['kind', 'summary', 'questions', kind === 'designer-changed' ? 'artifactRef' : 'explanation']);
      outcome = kind === 'designer-changed'
        ? { kind, summary: text(v.summary), artifactRef: text(v.artifactRef), questions: parseQuestions(v.questions) }
        : { kind, summary: text(v.summary), explanation: text(v.explanation), questions: parseQuestions(v.questions) };
      break;
    }
    case 'review-result': {
      requireCondition(role === 'reviewer', 'Only whole-plan Reviewer produces Review outcomes.');
      const v = object(data.outcome, ['kind', 'planDigest', 'summary', 'assessments', 'findings', 'verificationLimits', 'evidenceRefs', 'questions',
        ...(Object.hasOwn(data.outcome ?? {}, 'reviewFormat') ? ['reviewFormat'] : []),
        ...(Object.hasOwn(data.outcome ?? {}, 'coverageStatus') ? ['coverageStatus'] : [])]);
      const reviewFormat = Object.hasOwn(v, 'reviewFormat')
        ? choice(v.reviewFormat, ['decision-review/v1', 'decision-review/v2'] as const) : undefined;
      const currentReview = reviewFormat === 'decision-review/v2';
      requireCondition(currentReview || !Object.hasOwn(v, 'coverageStatus'), 'Coverage status belongs to decision-review/v2.');
      const coverageStatus = currentReview ? choice(v.coverageStatus, ['complete', 'partial', 'unavailable'] as const) : undefined;
      const verificationLimits = strings(v.verificationLimits);
      requireCondition(!currentReview || coverageStatus === 'complete' || verificationLimits.length > 0,
        'Incomplete Review must disclose its scope, reason and unreviewed coverage.');
      const assessments = list(v.assessments, (value) => {
        const a = referencedObject(value, ['taskId', 'criterionId', 'status', 'evidenceRefs']);
        const evidenceRefs = strings(a.evidenceRefs);
        requireCondition(evidenceRefs.length > 0, 'Review criterion assessment needs evidence or an evidenced gap.');
        return { taskId: text(a.taskId), criterionId: text(a.criterionId),
          status: choice(a.status, ['supported', 'issue', 'unverified'] as const), evidenceRefs, ...designRefs(a) };
      });
      requireCondition(currentReview ? assessments.length === 0 : assessments.length > 0,
        'Current Review assesses agreed Design conformance and over-engineering, not task-criterion correctness.');
      unique(assessments.map(({ taskId, criterionId }) => JSON.stringify([taskId, criterionId])));
      const findings = list(v.findings, (value): ReviewFinding => {
        const f = referencedObject(value, ['id', 'kind', 'summary', 'consequence', 'evidenceRefs',
          ...(Object.hasOwn(value ?? {}, 'designBasis') ? ['designBasis'] : []),
          ...(Object.hasOwn(value ?? {}, 'questionId') ? ['questionId'] : [])]);
        const evidenceRefs = strings(f.evidenceRefs);
        requireCondition(evidenceRefs.length > 0, 'Review findings need evidence.');
        const kind = choice(f.kind, ['correctness', 'design-consistency', 'missing-evidence', 'misaligned-decision', 'uncovered-decision',
          'design-conformance', 'over-engineering'] as const);
        const currentKind = kind === 'design-conformance' || kind === 'over-engineering';
        requireCondition(currentReview === currentKind, 'Finding category differs from the Review format and its responsibilities.');
        const decision = currentKind || kind === 'misaligned-decision' || kind === 'uncovered-decision';
        requireCondition(!decision || reviewFormat !== undefined, 'Decision findings require the decision-review format.');
        requireCondition(!reviewFormat || kind !== 'design-consistency', 'Categorize the actual decision as misaligned or uncovered.');
        requireCondition(decision || (!Object.hasOwn(f, 'questionId') && !Object.hasOwn(f, 'designBasis')),
          'Technical diagnostics are not decision questions.');
        return { id: text(f.id), kind, summary: text(f.summary), consequence: text(f.consequence), evidenceRefs, ...designRefs(f),
          ...(decision ? { designBasis: text(f.designBasis), questionId: text(f.questionId) } : {}) };
      });
      unique(findings.map(({ id }) => id));
      requireCondition(assessments.every(({ status }) => status === 'supported') || findings.length > 0,
        'Unsupported criteria must be explained as Review findings, not a clean result.');
      const questions = parseQuestions(v.questions);
      if (reviewFormat) {
        const decisions = findings.filter(({ questionId }) => questionId !== undefined);
        unique(decisions.map(({ questionId }) => questionId!));
        requireCondition(questions.length === decisions.length, 'Every decision needs its own canonical question; verification gaps are not decision questions.');
        for (const finding of decisions) {
          const question = questions.find(({ id }) => id === finding.questionId);
          requireCondition(question !== undefined, 'A decision finding must reference its canonical question.');
          requireCondition(question.options.every(({ resolutionTarget }) => resolutionTarget !== undefined),
            'Every decision option must state whether it changes Design or implementation, with its concrete effect.');
          requireCondition(finding.designRefs !== undefined
            && finding.designRefs.every((ref) => question.designRefs?.includes(ref)),
          'Decision questions must reference the exact Design anchors of their findings.');
        }
      }
      outcome = { kind, planDigest: digest(v.planDigest), summary: text(v.summary), assessments, findings, verificationLimits,
        evidenceRefs: strings(v.evidenceRefs), questions, ...(reviewFormat ? { reviewFormat } : {}),
        ...(coverageStatus ? { coverageStatus } : {}) }; break;
    }
    case 'answer': {
      requireCondition(role === 'agent', 'The read-only Agent provides the actual answer.');
      const v = referencedObject(data.outcome, ['kind', 'summary', 'report', 'evidenceRefs']);
      outcome = { kind, summary: text(v.summary), report: text(v.report), evidenceRefs: strings(v.evidenceRefs), ...designRefs(v) }; break;
    }
    default: throw new Error('Human loop: unknown typed outcome.');
  }
  return { schemaVersion: 'human-role-result/v1', resultId: text(data.resultId), inputDigest: digest(data.inputDigest), outcome };
}
