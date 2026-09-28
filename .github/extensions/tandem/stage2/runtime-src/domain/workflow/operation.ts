import {
  approvePlan, assessImpact, itemEligibility, parseDesignRevision, parsePlanProposal,
  planLineage, requirePlanLineage,
  type Approval, type ChangePlan, type DesignRevision, type ItemBinding, type WorkItem,
} from './change-plan.ts';
import { choice, integer, list, object, requireCondition, sameSet, strings, text } from './validation.ts';
import { parsePolicySnapshot, type PolicySnapshot } from './policy.ts';
import { validatePolicyPayload } from './policy-contracts.ts';

export type Authority = 'user' | 'host' | 'runtime' | 'agent';
export type Role = 'router' | 'design' | 'planning' | 'agent-work' | 'implementation' | 'review';
export type Phase =
  | 'Ready' | 'Routing' | 'DesignQueued' | 'Designing' | 'ApplyingDesign'
  | 'AgentWorkQueued' | 'AgentWork' | 'Planning' | 'PlanningQueued'
  | 'AwaitingApproval' | 'ImplementationQueued' | 'Implementing' | 'CapturingChanges'
  | 'ReviewPending' | 'ReviewQueued' | 'Reviewing' | 'ApplyingResult'
  | 'Blocked' | 'Completed' | 'Cancelled';

interface Dispatch {
  id: string;
  role: Role;
  delivery: 'prepared' | 'attempted' | 'acknowledged' | 'not-delivered';
  messageId: string | null;
  executionId: string | null;
  startEvidence: string | null;
  endEvidence: string | null;
}

interface Snapshot {
  id: string;
  policy: PolicySnapshot;
  planDigest: string;
  itemDigest: string;
  baselineDigest: string;
  afterDigest: string;
  changedPaths: string[];
  outOfScopePaths: string[];
}

export interface ReviewResult {
  id: string;
  planDigest: string;
  snapshotId: string;
  itemDigest: string;
  criteria: Array<{ id: string; satisfied: boolean; evidence: string[] }>;
  accountedPaths: string[];
  outOfScopePaths: string[];
  blockers: string[];
}

export interface WorkflowOperation {
  schemaVersion: 'workflow-operation-model/v2';
  id: string;
  sessionId: string;
  revision: number;
  phase: Phase;
  design: DesignRevision;
  baselineDigest: string;
  expectedBaselineDigest: string;
  policyDigest: string;
  policy: PolicySnapshot;
  dispatch: Dispatch | null;
  dispatchHistory: Dispatch[];
  intent: 'answer' | 'design' | 'agent-work' | 'planning' | null;
  proposal: ChangePlan | null;
  plan: ChangePlan | null;
  planDesign: DesignRevision | null;
  planHistory: ChangePlan[];
  approval: Approval | null;
  approvalHistory: Approval[];
  itemId: string | null;
  acceptedItems: ItemBinding[];
  snapshot: Snapshot | null;
  submittedReview: ReviewResult | null;
  savedReview: ReviewResult | null;
  reviews: Array<{ snapshot: Snapshot; result: ReviewResult; receiptId: string }>;
  designResult: string | null;
  receipts: Array<{ resultId: string; receiptId: string; itemDigest: string | null; criteria: string[] }>;
  recovery: string | null;
  boundaryOnly: boolean;
  cancellationRequested: boolean;
  blocker: string | null;
  budget: { startedAttempts: number; stagnantAttempts: number };
  inputs: Array<{ id: string; signature: string }>;
}

export interface TransitionIntent {
  operationId: string;
  expectedRevision: number;
  next: WorkflowOperation;
  duplicate: boolean;
}

const sources = {
  request: 'user',
  'prepare-task': 'host',
  'send-attempted': 'host',
  'dispatch-acknowledged': 'runtime',
  'dispatch-not-delivered': 'runtime',
  'execution-started': 'runtime',
  'execution-ended': 'runtime',
  'submit-intent': 'agent',
  'route-applied': 'host',
  'submit-plan': 'agent',
  'stage-plan-candidate': 'host',
  'publish-plan': 'host',
  'approve-plan': 'user',
  replan: 'user',
  'submit-design': 'agent',
  'persist-design-result': 'host',
  'design-applied': 'host',
  'agent-work-completed': 'host',
  'begin-capture': 'host',
  'save-snapshot': 'host',
  'submit-review': 'agent',
  'persist-review-result': 'host',
  'effects-applied': 'host',
  'report-blocker': 'agent',
  'inputs-observed': 'host',
  'index-boundary-applied': 'host',
  'reassess-design': 'host',
  'retry-review': 'user',
  restore: 'host',
  resume: 'user',
  'request-cancel': 'user',
  'finalize-cancellation': 'host',
  interrupt: 'host',
  release: 'host',
} as const satisfies Record<string, Authority>;

const fields: Record<keyof typeof sources, readonly string[]> = {
  request: [],
  'prepare-task': ['dispatchId', 'itemId'],
  'send-attempted': ['dispatchId'],
  'dispatch-acknowledged': ['dispatchId', 'sessionId', 'messageId'],
  'dispatch-not-delivered': ['dispatchId', 'sessionId', 'evidenceId'],
  'execution-started': ['dispatchId', 'sessionId', 'executionId', 'evidenceId'],
  'execution-ended': ['dispatchId', 'sessionId', 'executionId', 'evidenceId', 'aborted'],
  'submit-intent': ['dispatchId', 'intent'],
  'route-applied': [],
  'submit-plan': ['dispatchId', 'plan'],
  'stage-plan-candidate': ['plan'],
  'publish-plan': [],
  'approve-plan': ['approval'],
  replan: [],
  'submit-design': ['dispatchId', 'proposalId'],
  'persist-design-result': ['proposalId'],
  'design-applied': ['proposalId', 'receiptId'],
  'agent-work-completed': ['outcomeId', 'changedPaths'],
  'begin-capture': [],
  'save-snapshot': ['snapshotId', 'baselineDigest', 'afterDigest', 'changedPaths', 'outOfScopePaths'],
  'submit-review': ['dispatchId', 'result'],
  'persist-review-result': ['resultId'],
  'effects-applied': ['resultId', 'receiptId'],
  'report-blocker': ['dispatchId', 'itemDigest', 'reason'],
  'inputs-observed': ['design', 'baselineDigest', 'policyDigest'],
  'index-boundary-applied': ['applicationId', 'baselineDigest'],
  'reassess-design': ['design', 'baselineDigest', 'policyDigest'],
  'retry-review': [],
  restore: [],
  resume: [],
  'request-cancel': [],
  'finalize-cancellation': ['receiptId'],
  interrupt: ['reason'],
  release: [],
};

export function createWorkflowOperation(
  id: string, sessionId: string, design: unknown, baselineDigest: string, policyValue: unknown,
): WorkflowOperation {
  const policy = parsePolicySnapshot(policyValue);
  return {
    schemaVersion: 'workflow-operation-model/v2', id: text(id), sessionId: text(sessionId),
    revision: 0, phase: 'Ready', design: parseDesignRevision(design),
    baselineDigest: text(baselineDigest), expectedBaselineDigest: baselineDigest,
    policyDigest: policy.digest, policy, dispatch: null, dispatchHistory: [], intent: null,
    proposal: null, plan: null, planDesign: null, planHistory: [],
    approval: null, approvalHistory: [], itemId: null, acceptedItems: [],
    snapshot: null, submittedReview: null, savedReview: null, reviews: [], designResult: null,
    receipts: [], recovery: null, boundaryOnly: false, cancellationRequested: false,
    blocker: null, budget: { startedAttempts: 0, stagnantAttempts: 0 }, inputs: [],
  };
}

// Authority is supplied by the future trusted adapter, never read from the agent payload.
// The returned intent has NOT been persisted, dispatched, or applied.
export function decideWorkflow(
  current: WorkflowOperation, authority: Authority, value: unknown,
): TransitionIntent {
  requireCondition(current.schemaVersion === 'workflow-operation-model/v2', 'unbound workflow policy; inspection only.');
  const policy = parsePolicySnapshot(current.policy);
  requireCondition(current.policyDigest === policy.digest, 'operation policy binding is corrupt.');
  const input = object(value, ['schemaVersion', 'operationId', 'id', 'expectedRevision', 'type', 'data']);
  requireCondition(input.schemaVersion === 'workflow-input/v2', 'unsupported input schema.');
  requireCondition(input.operationId === current.id, 'operation ownership does not match.');
  const type = choice(input.type, Object.keys(sources) as Array<keyof typeof sources>);
  requireCondition(sources[type] === authority, `${type} requires ${sources[type]} authority.`);
  const data = object(input.data, fields[type]);
  const id = text(input.id);
  const signature = JSON.stringify([authority, input]);
  const prior = current.inputs.find((entry) => entry.id === id);
  if (prior) {
    requireCondition(prior.signature === signature, 'input identity was reused with different content.');
    return { operationId: current.id, expectedRevision: current.revision, next: restorePolicyBindings(structuredClone(current)), duplicate: true };
  }
  requireCondition(integer(input.expectedRevision) === current.revision, 'stale operation revision.');
  if (current.recovery) {
    requireCondition([
      'restore', 'resume', 'request-cancel', 'dispatch-acknowledged', 'dispatch-not-delivered',
      'execution-started', 'execution-ended', 'inputs-observed', 'replan', 'finalize-cancellation',
    ].includes(type), 'explicit Resume is required; saved phase is retained.');
  }
  const state = restorePolicyBindings(structuredClone(current));
  const phase = (...allowed: Phase[]): void => {
    requireCondition(allowed.includes(state.phase), `${type} is not legal from ${state.phase}.`);
  };
  const dispatch = (): Dispatch => {
    requireCondition(state.dispatch && data.dispatchId === state.dispatch.id, 'dispatch ownership does not match.');
    return state.dispatch;
  };
  const runtimeDispatch = (): Dispatch => {
    requireCondition(data.sessionId === state.sessionId, 'runtime session does not match.');
    return dispatch();
  };
  const agentDispatch = (...roles: Role[]): Dispatch => {
    const task = dispatch();
    requireCondition(task.executionId && !task.endEvidence && roles.includes(task.role), 'no matching active agent task.');
    requireCondition(!state.cancellationRequested
      && (task.role !== 'implementation' || editingAllowed(state)), 'editing/submission authority is closed.');
    return task;
  };
  const requireStopped = (): void => {
    requireCondition(isQuiescent(state.dispatch), 'task termination or absence is not established.');
  };
  const closeDispatch = (): void => {
    requireStopped();
    if (state.dispatch) state.dispatchHistory.push(state.dispatch);
    state.dispatch = null;
  };
  switch (type) {
    case 'request':
      phase('Ready');
      requireCondition(state.inputs.length === 0, 'a new request needs a new operation identity.');
      state.phase = 'Routing';
      break;
    case 'prepare-task': {
      requireCondition(!state.cancellationRequested, 'operation is cancelled.');
      requireCondition(!state.dispatch, 'previous dispatch must be closed before preparing another.');
      const roles: Partial<Record<Phase, Role>> = {
        Routing: 'router', DesignQueued: 'design', Planning: 'planning',
        AgentWorkQueued: 'agent-work', ImplementationQueued: 'implementation', ReviewPending: 'review',
      };
      const role = roles[state.phase];
      requireCondition(role, `cannot prepare a task from ${state.phase}.`);
      requireCondition(!state.blocker || role === 'review', 'operation is blocked.');
      const dispatchId = text(data.dispatchId);
      requireCondition(!state.dispatchHistory.some(({ id }) => id === dispatchId), 'dispatch identity cannot be reused.');
      if (role === 'implementation') {
        const item = requireItem(state, text(data.itemId));
        requireCondition(!state.acceptedItems.some((entry) => entry.digest === item.digest), 'item already accepted.');
        requireCondition(!eligibility(state, item), eligibility(state, item) ?? 'item is not eligible.');
        state.itemId = item.id;
        state.snapshot = null;
        state.submittedReview = null;
        state.savedReview = null;
      } else {
        requireCondition(data.itemId === null, 'only implementation selects a work item.');
        if (role === 'review') requireCurrentReviewInputs(state);
      }
      state.dispatch = {
        id: dispatchId, role, delivery: 'prepared', messageId: null,
        executionId: null, startEvidence: null, endEvidence: null,
      };
      if (role === 'planning') state.phase = 'PlanningQueued';
      if (role === 'review') state.phase = 'ReviewQueued';
      break;
    }
    case 'send-attempted': {
      const task = dispatch();
      requireCondition(task.delivery === 'prepared' && !state.cancellationRequested, 'dispatch cannot be sent.');
      if (task.role === 'implementation') {
        const reason = eligibility(state, requireItem(state));
        requireCondition(!reason, reason ?? 'implementation is no longer eligible.');
      }
      if (task.role === 'review') requireCurrentReviewInputs(state);
      task.delivery = 'attempted';
      break;
    }
    case 'dispatch-acknowledged': {
      const task = runtimeDispatch();
      requireCondition(task.delivery === 'attempted' || task.delivery === 'acknowledged', 'dispatch was not attempted.');
      const messageId = text(data.messageId);
      requireCondition(!task.messageId || task.messageId === messageId, 'conflicting dispatch acknowledgement.');
      task.messageId = messageId;
      task.delivery = 'acknowledged';
      break;
    }
    case 'dispatch-not-delivered': {
      const task = runtimeDispatch();
      requireCondition(!task.executionId, 'started execution cannot become undelivered.');
      task.endEvidence = text(data.evidenceId);
      task.delivery = 'not-delivered';
      state.recovery = 'Runtime proved the dispatch cannot execute; Resume explicitly.';
      break;
    }
    case 'execution-started': {
      const task = runtimeDispatch();
      requireCondition(['attempted', 'acknowledged'].includes(task.delivery), 'execution has no attempted dispatch.');
      requireCondition(!task.executionId && !task.endEvidence, 'execution already started or terminated.');
      task.executionId = text(data.executionId);
      task.startEvidence = text(data.evidenceId);
      const phases: Record<Role, Phase> = {
        router: 'Routing', design: 'Designing', planning: 'Planning',
        'agent-work': 'AgentWork', implementation: 'Implementing', review: 'Reviewing',
      };
      state.phase = phases[task.role];
      if (task.role === 'implementation') {
        const reason = eligibility(state, requireItem(state));
        if (reason) state.recovery = reason;
        state.budget.startedAttempts += 1;
      }
      break;
    }
    case 'execution-ended': {
      const task = runtimeDispatch();
      requireCondition(task.executionId !== null && data.executionId === task.executionId && !task.endEvidence, 'execution end does not match.');
      requireCondition(typeof data.aborted === 'boolean', 'aborted must be explicit.');
      task.endEvidence = text(data.evidenceId);
      if (data.aborted && !state.cancellationRequested) state.recovery = 'Execution was interrupted.';
      break;
    }
    case 'submit-intent':
      phase('Routing');
      agentDispatch('router');
      requireCondition(!state.intent, 'Router already submitted its intent.');
      state.intent = choice(data.intent, ['answer', 'design', 'agent-work', 'planning'] as const);
      break;
    case 'route-applied':
      phase('Routing');
      requireCondition(state.intent, 'Router output is incomplete.');
      closeDispatch();
      state.phase = state.intent === 'answer' ? 'Completed' : state.intent === 'design' ? 'DesignQueued'
        : state.intent === 'agent-work' ? 'AgentWorkQueued' : 'Planning';
      break;
    case 'submit-plan': {
      phase('Routing', 'Planning');
      const task = agentDispatch('router', 'planning');
      requireCondition(!state.proposal, 'a plan proposal already exists for this task.');
      requireCondition(task.role !== 'router' || !state.intent || state.intent === 'planning', 'Router selected another intent.');
      const plan = parsePlanProposal(data.plan, policy);
      requireCondition(plan.designRevisionId === state.design.id
        && plan.baselineDigest === state.baselineDigest && plan.policyDigest === state.policyDigest, 'plan inputs are stale.');
      requireCondition(!state.plan || (plan.id === state.plan.id && plan.version > state.plan.version), 'replanning requires a successor version.');
      state.proposal = plan;
      if (task.role === 'router') state.intent = 'planning';
      break;
    }
    case 'stage-plan-candidate': {
      phase('Ready', 'Planning', 'AwaitingApproval', 'Blocked');
      requireCondition(!state.dispatch && !state.savedReview && !state.cancellationRequested,
        'candidate staging cannot bypass unresolved execution or result application.');
      requireCondition(state.design.complete && state.design.entities.length > 0, 'current complete design is required before planning.');
      const plan = parsePlanProposal(data.plan, policy);
      requireCondition(plan.designRevisionId === state.design.id && plan.baselineDigest === state.baselineDigest,
        'candidate plan inputs are stale.');
      const lineage = planLineage([state.proposal, state.plan, ...state.planHistory]);
      if (lineage) requirePlanLineage(plan, lineage);
      requireCondition(plan.items.every((item) => assessImpact(item, state.design, state.design).status === 'unaffected'),
        'candidate references unknown design assumptions.');
      state.proposal = plan;
      state.phase = 'Planning';
      break;
    }
    case 'publish-plan':
      phase('Planning');
      requireCondition(state.proposal, 'required plan output is missing.');
      requireCondition(state.proposal.designRevisionId === state.design.id
        && state.proposal.baselineDigest === state.baselineDigest
        && state.proposal.policyDigest === state.policyDigest, 'plan inputs changed before publication.');
      closeDispatch();
      if (state.plan) {
        const previousPlan = state.plan;
        const previousDesign = state.planDesign;
        state.acceptedItems = state.acceptedItems.filter((binding) => {
          const item = previousPlan.items.find((item) => item.digest === binding.digest);
          return item && previousDesign
            && state.proposal!.items.some((next) => next.digest === item.digest)
            && assessImpact(item, previousDesign, state.design).status === 'unaffected';
        });
        state.planHistory.push(state.plan);
      }
      state.plan = state.proposal;
      state.proposal = null;
      state.planDesign = structuredClone(state.design);
      state.expectedBaselineDigest = state.plan.baselineDigest;
      state.approval = null;
      state.phase = 'AwaitingApproval';
      break;
    case 'approve-plan':
      phase('AwaitingApproval');
      requireCondition(state.plan && state.planDesign, 'no displayed plan.');
      requireCondition(state.baselineDigest === state.plan.baselineDigest
        && state.policyDigest === state.plan.policyDigest, 'approval baseline or policy is stale.');
      state.approval = approvePlan(state.plan, data.approval, id);
      requireCondition(state.plan.items.every((item) => {
        const reason = itemEligibility(state.plan!, item, state.approval, state.planDesign!, state.design, []);
        return reason === undefined || reason === 'A dependency has no accepted evidence.';
      }), 'approval design assumptions are stale or unknown.');
      state.approvalHistory.push(state.approval);
      state.boundaryOnly = false;
      state.phase = state.plan.items.every((item) => state.acceptedItems.some((entry) => entry.digest === item.digest))
        ? 'Completed'
        : state.plan.items.some((item) => !state.acceptedItems.some((entry) => entry.digest === item.digest)
          && !eligibility(state, item)) ? 'ImplementationQueued' : 'Blocked';
      break;
    case 'replan':
      phase('AwaitingApproval', 'Blocked');
      closeDispatch();
      requireCondition(!state.savedReview, 'saved result must be resolved before replanning.');
      state.proposal = null;
      state.blocker = null;
      state.recovery = null;
      state.phase = 'Planning';
      break;
    case 'submit-design':
      phase('Designing');
      agentDispatch('design');
      requireCondition(!state.designResult, 'design output already submitted.');
      state.designResult = text(data.proposalId);
      break;
    case 'persist-design-result':
      phase('Designing');
      requireCondition(state.designResult && data.proposalId === state.designResult, 'no matching design result.');
      state.phase = 'ApplyingDesign';
      break;
    case 'design-applied':
      phase('ApplyingDesign');
      requireCondition(state.designResult && data.proposalId === state.designResult, 'no saved design result.');
      closeDispatch();
      state.receipts.push({ resultId: state.designResult, receiptId: text(data.receiptId), itemDigest: null, criteria: [] });
      state.phase = state.cancellationRequested ? 'Cancelled' : 'Completed';
      break;
    case 'agent-work-completed':
      phase('AgentWork');
      text(data.outcomeId);
      closeDispatch();
      state.blocker = strings(data.changedPaths).length ? 'Non-modifying task changed repository files; explicit review is required.' : null;
      state.phase = state.blocker ? 'Blocked' : 'Completed';
      break;
    case 'begin-capture':
      phase('Implementing');
      requireStopped();
      state.phase = 'CapturingChanges';
      break;
    case 'save-snapshot': {
      phase('CapturingChanges');
      validatePolicyPayload('workSnapshot', data, policy);
      requireCondition(data.baselineDigest === state.expectedBaselineDigest, 'snapshot baseline does not match approved execution.');
      const changedPaths = strings(data.changedPaths);
      const outOfScopePaths = strings(data.outOfScopePaths);
      requireCondition(outOfScopePaths.every((path) => changedPaths.includes(path)), 'Host scope classification must reference actual changes.');
      state.snapshot = {
        id: text(data.snapshotId), policy, planDigest: state.plan!.digest, itemDigest: requireItem(state).digest,
        baselineDigest: text(data.baselineDigest),
        afterDigest: text(data.afterDigest), changedPaths, outOfScopePaths,
      };
      state.baselineDigest = state.snapshot.afterDigest;
      closeDispatch();
      state.phase = 'ReviewPending';
      break;
    }
    case 'submit-review':
      phase('Reviewing');
      agentDispatch('review');
      requireCondition(!state.submittedReview, 'review result already submitted.');
      requireCurrentReviewInputs(state);
      state.submittedReview = parseReviewResult(data.result, state);
      break;
    case 'persist-review-result':
      phase('Reviewing');
      requireCurrentReviewInputs(state);
      requireCondition(state.submittedReview && data.resultId === state.submittedReview.id, 'required review result is missing.');
      state.savedReview = state.submittedReview;
      state.phase = 'ApplyingResult';
      break;
    case 'effects-applied': {
      phase('ApplyingResult');
      requireCurrentReviewInputs(state);
      const result = state.savedReview;
      requireCondition(result && data.resultId === result.id, 'saved result does not match.');
      closeDispatch();
      const item = requireItem(state);
      const satisfied = result.criteria.filter(({ satisfied }) => satisfied).map(({ id }) => id);
      const previous = new Set(state.receipts.filter(({ itemDigest }) => itemDigest === item.digest).flatMap(({ criteria }) => criteria));
      const progress = satisfied.some((id) => !previous.has(id));
      state.budget.stagnantAttempts = progress ? 0 : state.budget.stagnantAttempts + 1;
      const receiptId = text(data.receiptId);
      state.receipts.push({ resultId: result.id, receiptId, itemDigest: item.digest, criteria: satisfied });
      state.reviews.push({ snapshot: state.snapshot!, result, receiptId });
      if (satisfied.length === item.criteria.length && !result.outOfScopePaths.length
        && !result.blockers.length && !state.blocker && !state.cancellationRequested) {
        state.acceptedItems.push({ id: item.id, version: item.version, digest: item.digest });
      }
      state.expectedBaselineDigest = state.snapshot!.afterDigest;
      state.savedReview = null;
      state.submittedReview = null;
      state.blocker ??= result.outOfScopePaths.length ? 'Out-of-scope changes require renewed approval.'
        : result.blockers[0] ?? null;
      const remaining = state.plan!.items.filter((item) => !state.acceptedItems.some((entry) => entry.digest === item.digest));
      state.phase = state.cancellationRequested ? 'Cancelled'
        : !remaining.length ? 'Completed'
          : state.boundaryOnly || state.blocker || !remaining.some((item) => !eligibility(state, item)) ? 'Blocked'
            : 'ImplementationQueued';
      break;
    }
    case 'report-blocker':
      phase('Implementing');
      agentDispatch('implementation');
      requireCondition(data.itemDigest === requireItem(state).digest, 'blocker does not match the approved item.');
      state.blocker = text(data.reason);
      break;
    case 'inputs-observed':
      requireCondition(data.policyDigest === policy.digest, 'policy adoption requires a new approved operation; existing work stays pinned.');
      state.design = parseDesignRevision(data.design);
      state.baselineDigest = text(data.baselineDigest);
      break;
    case 'index-boundary-applied':
      phase('Blocked', 'ImplementationQueued', 'Completed');
      requireCondition(!state.dispatch && !state.savedReview && state.receipts.at(-1)?.receiptId === data.applicationId,
        'index baseline refresh requires the latest applied result and no active task.');
      state.baselineDigest = text(data.baselineDigest);
      state.expectedBaselineDigest = state.baselineDigest;
      break;
    case 'reassess-design': {
      requireCondition(!state.dispatch && !state.savedReview && !state.submittedReview && !state.recovery,
        'design impact cannot bypass active execution or saved result recovery.');
      requireCondition(data.policyDigest === state.policyDigest && data.baselineDigest === state.baselineDigest,
        'design impact does not authorize policy or workspace rebasing.');
      const next = parseDesignRevision(data.design);
      const unfinished = state.plan?.items.filter((item) => !state.acceptedItems.some(({ digest }) => digest === item.digest)) ?? [];
      const affected = unfinished.some((item) => !state.planDesign || assessImpact(item, state.planDesign, next).status !== 'unaffected');
      state.design = next;
      if (affected) state.phase = 'Blocked';
      break;
    }
    case 'retry-review':
      phase('Reviewing', 'ReviewQueued');
      requireCondition(state.snapshot && state.dispatch?.role === 'review'
        && state.dispatch.endEvidence && !state.savedReview && !state.submittedReview,
      'retry requires a positively ended Review without a validated result.');
      closeDispatch();
      state.phase = 'ReviewPending';
      break;
    case 'restore':
      state.recovery = 'Restored saved phase; explicit Resume is required.';
      state.boundaryOnly = true;
      break;
    case 'resume':
      requireCondition(state.recovery || state.phase === 'Blocked', 'nothing requires Resume.');
      requireStopped();
      requireCondition(!state.blocker || ['Implementing', 'CapturingChanges', 'ReviewPending', 'Reviewing', 'ApplyingResult'].includes(state.phase),
        'blocker must be resolved through replanning.');
      state.recovery = null;
      if (state.dispatch?.delivery === 'not-delivered') {
        const task = state.dispatch;
        closeDispatch();
        state.phase = task.role === 'review' ? 'ReviewPending'
          : task.role === 'planning' ? 'Planning' : state.phase;
      } else if (state.phase === 'Reviewing' && !state.submittedReview) {
        closeDispatch();
        state.phase = 'ReviewPending';
      } else if (state.phase === 'Blocked') {
        requireCondition(state.plan && state.plan.items.some((item) =>
          !state.acceptedItems.some((entry) => entry.digest === item.digest)
          && !eligibility(state, item)), 'no eligible approved work remains.');
        state.boundaryOnly = false;
        state.phase = 'ImplementationQueued';
      }
      break;
    case 'request-cancel':
      requireCondition(!['Completed', 'Cancelled'].includes(state.phase), 'operation is already terminal.');
      state.cancellationRequested = true;
      break;
    case 'finalize-cancellation':
      requireCondition(state.cancellationRequested, 'cancellation was not requested.');
      requireCondition(!state.savedReview && state.phase !== 'ApplyingDesign', 'saved application must be resolved before cancellation.');
      requireStopped();
      requireCondition(!state.dispatch?.startEvidence || state.dispatch.role !== 'implementation' || state.snapshot, 'partial implementation must be captured first.');
      closeDispatch();
      state.receipts.push({ resultId: 'cancellation', receiptId: text(data.receiptId), itemDigest: null, criteria: [] });
      state.recovery = null;
      state.phase = 'Cancelled';
      break;
    case 'interrupt':
      state.recovery = text(data.reason);
      state.boundaryOnly = true;
      break;
    case 'release':
      phase('Completed', 'Cancelled');
      closeDispatch();
      state.phase = 'Ready';
      break;
  }
  state.revision += 1;
  state.inputs.push({ id, signature });
  return { operationId: state.id, expectedRevision: current.revision, next: state, duplicate: false };
}

function isQuiescent(task: Dispatch | null): boolean {
  return !task || task.delivery === 'prepared' || task.delivery === 'not-delivered' || task.endEvidence !== null;
}

export function restorePolicyBindings(state: WorkflowOperation): WorkflowOperation {
  const policy = parsePolicySnapshot(state.policy);
  requireCondition(state.policyDigest === policy.digest, 'operation policy binding is corrupt.');
  state.policy = policy;
  for (const plan of [state.plan, state.proposal, ...state.planHistory]) {
    if (plan) {
      requireCondition(parsePolicySnapshot(plan.policy).digest === policy.digest, 'plan policy differs from its owning operation.');
      plan.policy = policy;
    }
  }
  for (const snapshot of [state.snapshot, ...state.reviews.map(({ snapshot }) => snapshot)]) {
    if (snapshot) {
      requireCondition(parsePolicySnapshot(snapshot.policy).digest === policy.digest, 'checkpoint policy differs from its owning operation.');
      snapshot.policy = policy;
    }
  }
  return state;
}

function requireItem(state: WorkflowOperation, id = state.itemId): WorkItem {
  const item = state.plan?.items.find((item) => item.id === id);
  requireCondition(item, 'unknown selected work item.');
  return item;
}

export function eligibility(state: WorkflowOperation, item: WorkItem): string | undefined {
  if (!state.plan || !state.planDesign) return 'No approved plan.';
  if (state.recovery || state.cancellationRequested || state.blocker) return 'Operation is held.';
  const limits = parsePolicySnapshot(state.policy).values.execution;
  if (state.budget.startedAttempts >= limits.implementationAttempts
    || state.budget.stagnantAttempts >= limits.stagnantAttempts) return 'Continuation budget exhausted.';
  if (state.baselineDigest !== state.expectedBaselineDigest || state.policyDigest !== state.plan.policyDigest) return 'Workspace baseline or policy changed.';
  return itemEligibility(state.plan, item, state.approval, state.planDesign, state.design, state.acceptedItems);
}

export function editingAllowed(state: WorkflowOperation): boolean {
  if (state.phase !== 'Implementing' || !state.dispatch?.executionId
    || state.dispatch.endEvidence || state.dispatch.role !== 'implementation') return false;
  const item = state.plan?.items.find((item) => item.id === state.itemId);
  if (!item) return false;
  // Starting an attempt consumes its slot; it does not revoke that same task.
  return !eligibility({
    ...state, budget: { ...state.budget, startedAttempts: state.budget.startedAttempts - 1 },
  }, item);
}

export function requireCurrentReviewInputs(state: WorkflowOperation): void {
  requireCondition(state.plan && state.planDesign && state.snapshot, 'review boundary is missing.');
  requireCondition(state.snapshot.afterDigest === state.baselineDigest
    && state.policyDigest === state.plan.policyDigest
    && parsePolicySnapshot(state.snapshot.policy).digest === state.policyDigest
    && state.snapshot.planDigest === state.plan.digest, 'review snapshot or policy is stale.');
  const item = requireItem(state);
  requireCondition(state.snapshot.itemDigest === item.digest, 'review snapshot item binding is stale.');
  requireCondition(!itemEligibility(state.plan, item, state.approval, state.planDesign, state.design, state.acceptedItems), 'review expectations are stale.');
}

function parseReviewResult(value: unknown, state: WorkflowOperation): ReviewResult {
  requireCondition(state.snapshot, 'review boundary is missing.');
  const result = validateWorkReviewResult(value, {
    snapshotId: state.snapshot.id, planDigest: state.snapshot.planDigest, item: requireItem(state),
    changedPaths: state.snapshot.changedPaths, outOfScopePaths: state.snapshot.outOfScopePaths,
  }, state.policy);
  requireCondition(!state.reviews.some(({ result: previous }) => previous.id === result.id), 'review result identity was already applied.');
  return result;
}

export function validateWorkReviewResult(value: unknown, expected: {
  snapshotId: string; planDigest: string; item: WorkItem; changedPaths: string[]; outOfScopePaths: string[];
}, policy: PolicySnapshot): ReviewResult {
  validatePolicyPayload('workReview', value, policy);
  const data = object(value, ['id', 'planDigest', 'snapshotId', 'itemDigest', 'criteria', 'accountedPaths', 'outOfScopePaths', 'blockers']);
  const id = text(data.id);
  const item = expected.item;
  requireCondition(data.snapshotId === expected.snapshotId
    && data.planDigest === expected.planDigest && data.itemDigest === item.digest, 'review result binding does not match.');
  const criteria = list(data.criteria, (entry) => {
    const criterion = object(entry, ['id', 'satisfied', 'evidence']);
    requireCondition(typeof criterion.satisfied === 'boolean', 'criterion assessment must be explicit.');
    const evidence = strings(criterion.evidence);
    requireCondition(!criterion.satisfied || evidence.length > 0, 'accepted criteria require evidence.');
    return { id: text(criterion.id), satisfied: criterion.satisfied, evidence };
  });
  requireCondition(sameSet(criteria.map(({ id }) => id), item.criteria.map(({ id }) => id)), 'every approved criterion needs exactly one assessment.');
  const accountedPaths = strings(data.accountedPaths);
  const outOfScopePaths = strings(data.outOfScopePaths);
  requireCondition(sameSet(accountedPaths, expected.changedPaths)
    && outOfScopePaths.every((path) => accountedPaths.includes(path)), 'every actual change must be accounted for.');
  requireCondition(sameSet(outOfScopePaths, expected.outOfScopePaths), 'review cannot override Host scope classification.');
  return {
    id, planDigest: expected.planDigest, snapshotId: expected.snapshotId, itemDigest: item.digest,
    criteria, accountedPaths, outOfScopePaths, blockers: strings(data.blockers),
  };
}
