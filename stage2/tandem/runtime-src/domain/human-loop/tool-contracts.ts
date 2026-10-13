import type { PolicySchema } from '../workflow/policy-contracts.ts';
import { roles, type HumanRole, type RoleOutcome } from './contracts.ts';

const string: PolicySchema = { type: 'string', minLength: 1 };
const hash: PolicySchema = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const nullableString: PolicySchema = { anyOf: [string, { type: 'null' }] };
const array = (items: PolicySchema): PolicySchema => ({ type: 'array', items });
const strings: PolicySchema = { ...array(string), uniqueItems: true };
const forecastScope: PolicySchema & { description: string } = {
  ...strings, minItems: 1,
  description: 'Forecast of relative project paths for task planning, not a write authorization allowlist.',
};
const obj = (properties: Record<string, PolicySchema>): PolicySchema => ({
  type: 'object', properties, required: Object.keys(properties), additionalProperties: false,
});
const referenced = (properties: Record<string, PolicySchema>): PolicySchema => ({
  ...obj({ ...properties, designRefs: strings }), required: Object.keys(properties),
});
const design = obj({ revisionId: nullableString, digest: { anyOf: [hash, { type: 'null' }] } });
const snapshot = obj({ id: string, digest: hash });
const resolutionTarget: PolicySchema = { enum: ['design', 'implementation'] };
const questionOption: PolicySchema = {
  ...obj({ id: string, label: string, implication: string, resolutionTarget }),
  required: ['id', 'label', 'implication'],
};
const questionFields = {
  id: string, context: string, question: string, whyItMatters: string,
  options: array(questionOption), allowFreeform: { type: 'boolean' },
};
export const humanQuestionSchema: PolicySchema = { anyOf: [
  referenced({ ...questionFields, importance: { const: 'blocking' } }),
  referenced({ ...questionFields, importance: { const: 'advisory' },
    unanswered: obj({ action: { const: 'keep-current-design' }, explanation: { ...string, pattern: '\\S', maxLength: 2000 } }) }),
] };
export const humanAnswerBatchSchema = obj({
  schemaVersion: { const: 'human-question-answers/v1' },
  answers: { ...array(obj({ questionId: string, sourceResultId: string, kind: { enum: ['option', 'freeform'] }, value: string })), minItems: 1 },
});
export const internalPlanSchema = obj({
  schemaVersion: { const: 'internal-plan/v1' }, id: string, version: { type: 'integer', minimum: 1 }, goal: string,
  design, baseline: snapshot, tasks: { ...array(referenced({
    id: string, title: string, scope: forecastScope, dependsOn: strings,
    criteria: { ...array(obj({ id: string, description: string })), minItems: 1 },
  })), minItems: 1 },
});
const outcome = (kind: RoleOutcome['kind'], fields: Record<string, PolicySchema>) => obj({ kind: { const: kind }, ...fields });
const schemas: Record<Exclude<RoleOutcome['kind'], 'execution-failure' | 'review-incomplete' | 'stopped-partial'>, PolicySchema> = {
  route: outcome('route', { intent: { enum: ['design', 'implement', 'answer', 'resume-cycle', 'replan-cycle'] },
    cycleId: nullableString, summary: string, resolvedQuestions: array(obj({ questionId: string, sourceResultId: string })) }),
  'internal-plan': outcome('internal-plan', { plan: internalPlanSchema }),
  'task-result': outcome('task-result', { taskId: string, planDigest: hash, summary: string, evidenceRefs: strings }),
  'implementation-result': outcome('implementation-result', { planDigest: hash, completedTaskIds: strings, summary: string, evidenceRefs: strings }),
  'design-concern': outcome('design-concern', { reason: string, summary: string, questions: { ...array(humanQuestionSchema), minItems: 1 } }),
  'designer-changed': outcome('designer-changed', { summary: string, artifactRef: string, questions: array(humanQuestionSchema) }),
  'designer-unchanged': outcome('designer-unchanged', { summary: string, explanation: string, questions: array(humanQuestionSchema) }),
  'review-result': outcome('review-result', { reviewFormat: { const: 'decision-review/v2' },
    coverageStatus: { enum: ['complete', 'partial', 'unavailable'] },
    planDigest: hash, summary: string, assessments: { ...array(referenced({
      taskId: string, criterionId: string, status: { enum: ['supported', 'issue', 'unverified'] }, evidenceRefs: strings,
    })), maxItems: 0 },
    findings: array(
    obj({ id: string, kind: { enum: ['design-conformance', 'over-engineering'] }, summary: string,
      consequence: string, evidenceRefs: { ...strings, minItems: 1 }, designRefs: strings,
      designBasis: string, questionId: string })),
    verificationLimits: strings, evidenceRefs: strings, questions: array(humanQuestionSchema) }),
  answer: referenced({ kind: { const: 'answer' }, summary: string, report: string, evidenceRefs: strings }),
};
const definitions: Array<{ name: string; roles: HumanRole[]; kinds: Array<keyof typeof schemas>; description: string }> = [
  { name: 'submit_human_route', roles: ['router'], kinds: ['route'], description: 'Interpret only the exact user request and bound answers; do not invent an answer or approve edits.' },
  { name: 'submit_internal_plan', roles: ['planner'], kinds: ['internal-plan'], description: 'Submit the complete technical plan for Host validation. This is internal acceptance, not user approval.' },
  { name: 'submit_internal_task_result', roles: ['implementer'], kinds: ['task-result'], description: 'Account for the one owned internal task. This does not complete the plan or constitute a Review.' },
  { name: 'submit_implementation_result', roles: ['implementer'], kinds: ['implementation-result'], description: 'Submit the whole-plan result only after every internal task is accounted for. Real owned end is still required.' },
  { name: 'raise_implementation_design_concern', roles: ['planner', 'implementer'], kinds: ['design-concern'], description: 'Explain a Design prerequisite during planning or coding and ask the user. Keep existing code; do not invoke Designer or finish a partial plan.' },
  { name: 'submit_designer_outcome', roles: ['designer'], kinds: ['designer-changed', 'designer-unchanged'], description: 'Return changed Design or an explicit no-change explanation, plus source-bound user questions.' },
  { name: 'submit_whole_plan_review', roles: ['reviewer'], kinds: ['review-result'], description: 'Review the complete cycle and actual code. Findings or no findings are both normal user handoffs, never automatic repair instructions.' },
  { name: 'submit_readonly_answer', roles: ['agent'], kinds: ['answer'], description: 'Deliver the requested grounded answer and honest limits without source or Design changes.' },
];
export function humanLoopResultTools() {
  return definitions.map((definition) => ({
    ...definition, terminal: true,
    parameters: obj({ schemaVersion: { const: 'human-role-result/v1' }, resultId: string, inputDigest: hash,
      outcome: definition.kinds.length === 1 ? schemas[definition.kinds[0]!] : { anyOf: definition.kinds.map((kind) => schemas[kind]) } }),
  }));
}
export const humanLoopProgressTool = {
  name: 'report_internal_task_progress', roles: ['implementer'] as HumanRole[], terminal: false,
  description: 'Report progress on the exact active task. Progress cannot declare task/plan completion or bypass whole-plan Review.',
  parameters: obj({ schemaVersion: { const: 'human-task-progress/v1' },
    taskId: string, planDigest: hash, status: { enum: ['started', 'progress'] }, summary: string, evidenceRefs: strings }),
};
export const humanLoopStopTool = {
  name: 'acknowledge_human_stop', roles: [...roles], terminal: true,
  description: 'Acknowledge only the exact delivered Host Stop injection. Report a partial-work audit and retained evidence, not task completion, Review, failure or approval. End this role without starting more work.',
  parameters: obj({
    stopId: string, taskId: string, inputDigest: hash,
    summary: string,
    evidenceRefs: strings,
  }),
};
