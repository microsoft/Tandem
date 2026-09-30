import { isAbsolute, relative, resolve, sep } from 'node:path';
import { parseAnnotationAttachments, type AnnotationAttachment } from './annotation-attachment.ts';
import {
  approvePlan, assessImpact, itemEligibility, parseDesignRevision, parseItemBinding, parsePlanProposal,
  parsePlanLineage, requirePlanLineage,
  type Approval, type ChangePlan, type ChangePlanProposal, type DesignRevision, type ItemBinding, type PlanLineage,
} from './change-plan.ts';
import { parsePolicySnapshot, policyHash, type PolicySnapshot } from './policy.ts';
import { list, object, requireCondition, strings, text, unique } from './validation.ts';
import { validateWorkReviewResult, type ReviewResult } from './operation.ts';
import type { BackboneProposalInput } from '../backbone/proposal.ts';
import { createPolicyGeneration } from './policy-contracts.ts';
import { isUnpublishedWorkflowDesign, parsePrivateDesignOutput, type PrivateDesignOutput } from './private-design.ts';
import { parseRetainedWork, requireRetainedExecution, requireRetainedPlanCoverage, type RetainedWork } from './retained-work.ts';

export interface WorkspaceBoundary {
  commit: string;
  inventoryDigest: string;
  evidenceRef: string;
}

export interface PrivateCloseHistory {
  schemaVersion: 'private-close-history/v1';
  knownEventIds: string[];
  requiredEventIds: string[];
}

export function parsePrivateCloseHistory(value: unknown): PrivateCloseHistory {
  const data = object(value, ['schemaVersion', 'knownEventIds', 'requiredEventIds']);
  requireCondition(data.schemaVersion === 'private-close-history/v1', 'Unsupported private close history.');
  const knownEventIds = strings(data.knownEventIds), requiredEventIds = strings(data.requiredEventIds);
  unique(knownEventIds); unique(requiredEventIds);
  requireCondition(requiredEventIds.every((id) => knownEventIds.includes(id)), 'Close history requirements are not owned.');
  return { schemaVersion: 'private-close-history/v1', knownEventIds, requiredEventIds };
}

export interface PrivateExecutionOwner {
  ownerId: string;
  mainSessionId: string;
  privateSessionId: string;
  repositoryId: string;
  worktreePath: string;
  targetWorktreePath: string;
  policy: PolicySnapshot;
}

export interface PrivateTask {
  retainedWork?: RetainedWork;
  attachments?: AnnotationAttachment[];
  taskId: string;
  dispatchId: string;
  plan: ChangePlan;
  approval: Approval | null;
  itemId: string;
  originalDesign: DesignRevision;
  currentDesign: DesignRevision;
  acceptedDependencies: ItemBinding[];
  contextRefs: string[];
  constraints: string[];
  before: WorkspaceBoundary;
  executionBaseline?: { operationId: string; evidenceRefs: string[]; inventoryDigest: string };
  review?: { implementation: PrivateTask; proposal: ChangeProposal; snapshotId: string; outOfScopePaths: string[] };
  assessmentOnly?: { scope: string[] };
  coordination?: { kind: 'router' | 'planner' | 'agent'; requestId: string; message: string; planLineage?: PlanLineage };
  design?: {
    requestId: string; message: string; previousRevisionId: string | null; previousDesign: BackboneProposalInput | null;
  };
}

export interface PrivateTaskResult {
  resultId: string;
  inputDigest: string;
  summary: string;
  evidenceRefs: string[];
  review?: ReviewResult;
  intent?: 'answer' | 'design' | 'plan' | 'agent-work';
  candidate?: ChangePlanProposal | null;
  design?: PrivateDesignOutput;
  report?: string;
}

export interface ChangeProposal {
  schemaVersion: 'isolated-change-proposal/v1' | 'retained-work-proposal/v1';
  executionBefore?: WorkspaceBoundary;
  retainedWorkDigest?: string;
  taskId: string;
  inputDigest: string;
  repositoryId: string;
  sourceWorktree: string;
  targetWorktree: string;
  before: WorkspaceBoundary;
  after: WorkspaceBoundary;
  patchRef: { artifactRef: string; digest: string } | null;
  files: Array<{ path: string; beforeHash: string | null; afterHash: string | null }>;
  integration: 'not-applied';
}

export interface PrivateRuntimeObservation {
  sessionId: string;
  mode: string;
  ownershipRef: string;
  historyRef: string;
  idle: boolean;
  pendingMessageIds: string[];
  unresolvedWorkRefs: string[];
}

export interface PrivateRuntimeStatus extends PrivateRuntimeObservation {
  boundary: WorkspaceBoundary;
}

export interface PrivateUserStopEvidence {
  stopId: string;
  taskId: string;
  dispatchId: string;
  sessionId: string;
  messageId: string | null;
  endEventId: string | null;
  abortAcknowledged: boolean;
  notSent: boolean;
  alreadyEnded: boolean;
  status: PrivateRuntimeStatus;
  proposal: ChangeProposal;
}

export function parseDigest(value: unknown): string {
  const result = text(value);
  requireCondition(/^[a-f0-9]{64}$/.test(result), 'evidence digest must be SHA-256 hex.');
  return result;
}

export function parseWorkspaceBoundary(value: unknown): WorkspaceBoundary {
  const data = object(value, ['commit', 'inventoryDigest', 'evidenceRef']);
  const commit = text(data.commit);
  requireCondition(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit), 'workspace baseline needs an exact commit identity.');
  return { commit, inventoryDigest: parseDigest(data.inventoryDigest), evidenceRef: text(data.evidenceRef) };
}

export function sameBoundary(left: WorkspaceBoundary, right: WorkspaceBoundary): boolean {
  return left.commit === right.commit && left.inventoryDigest === right.inventoryDigest;
}

export function parsePrivateOwner(value: unknown): PrivateExecutionOwner {
  const data = object(value, [
    'ownerId', 'mainSessionId', 'privateSessionId', 'repositoryId',
    'worktreePath', 'targetWorktreePath', 'policy',
  ]);
  const mainSessionId = text(data.mainSessionId);
  const privateSessionId = text(data.privateSessionId);
  requireCondition(mainSessionId !== privateSessionId, 'private execution must not reuse the main conversation session.');
  const worktreePath = text(data.worktreePath);
  const targetWorktreePath = text(data.targetWorktreePath);
  requireCondition(isAbsolute(worktreePath) && isAbsolute(targetWorktreePath), 'worktree identities must be absolute.');
  const contains = (parent: string, child: string) => {
    const path = relative(parent.toLowerCase(), child.toLowerCase());
    return !path || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
  };
  requireCondition(!contains(worktreePath, targetWorktreePath) && !contains(targetWorktreePath, worktreePath),
    'execution and target worktrees must be separate, non-nested locations.');
  return {
    ownerId: text(data.ownerId), mainSessionId, privateSessionId, repositoryId: text(data.repositoryId),
    worktreePath: resolve(worktreePath), targetWorktreePath: resolve(targetWorktreePath),
    policy: parsePolicySnapshot(data.policy),
  };
}

export function parsePrivateTask(value: unknown, owner: PrivateExecutionOwner): PrivateTask {
  const optional = value && typeof value === 'object' ? value : {};
  const data = object(value, [
    'taskId', 'dispatchId', 'plan', 'approval', 'itemId', 'originalDesign', 'currentDesign',
    'acceptedDependencies', 'contextRefs', 'constraints', 'before',
    ...(Object.hasOwn(optional, 'executionBaseline') ? ['executionBaseline'] : []),
    ...(Object.hasOwn(optional, 'review') ? ['review'] : []),
    ...(Object.hasOwn(optional, 'assessmentOnly') ? ['assessmentOnly'] : []),
    ...(Object.hasOwn(optional, 'coordination') ? ['coordination'] : []),
    ...(Object.hasOwn(optional, 'design') ? ['design'] : []),
    ...(Object.hasOwn(optional, 'attachments') ? ['attachments'] : []),
    ...(Object.hasOwn(optional, 'retainedWork') ? ['retainedWork'] : []),
  ]);
  const stored = object(data.plan, [
    'schemaVersion', 'id', 'version', 'outcome', 'designRevisionId', 'baselineDigest',
    'policyDigest', 'policy', 'items', 'digest',
  ]);
  const policy = parsePolicySnapshot(stored.policy);
  requireCondition(policy.digest === owner.policy.digest, 'task policy differs from the private registration generation.');
  const plan = parsePlanProposal({
    schemaVersion: stored.schemaVersion, id: stored.id, version: stored.version, outcome: stored.outcome,
    designRevisionId: stored.designRevisionId, baselineDigest: stored.baselineDigest, policyDigest: stored.policyDigest,
    items: list(stored.items, (value) => {
      const item = object(value, ['id', 'version', 'goal', 'scope', 'designRefs', 'dependsOn', 'criteria', 'digest']);
      const { digest, ...proposal } = item;
      requireCondition(digest === policyHash(proposal), 'stored work-item digest is corrupt.');
      return proposal;
    }),
  }, policy);
  requireCondition(stored.digest === plan.digest, 'stored approved plan digest is corrupt.');
  let assessmentOnly: PrivateTask['assessmentOnly'];
  let coordination: PrivateTask['coordination'];
  let design: PrivateTask['design'];
  let approval: Approval | null;
  if (data.assessmentOnly !== undefined) {
    const assessment = object(data.assessmentOnly, ['scope']);
    const scope = strings(assessment.scope);
    requireCondition(scope.length > 0 && data.approval === null, 'read-only assessment has explicit scope and no editing approval.');
    assessmentOnly = { scope };
    approval = null;
  } else {
    const approved = object(data.approval, ['requestId', 'planId', 'planVersion', 'planDigest', 'items']);
    const { requestId, ...binding } = approved;
    approval = approvePlan(plan, binding, text(requestId));
  }
  if (data.coordination !== undefined) {
    const input = object(data.coordination, ['kind', 'requestId', 'message',
      ...(Object.hasOwn(data.coordination ?? {}, 'planLineage') ? ['planLineage'] : [])]);
    requireCondition(assessmentOnly && !data.review && (input.kind === 'router' || input.kind === 'planner' || input.kind === 'agent'),
      'semantic coordination is read-only and cannot masquerade as implementation/Review.');
    requireCondition(input.planLineage === undefined || input.kind !== 'agent', 'Only planning roles carry plan lineage.');
    coordination = { kind: input.kind, requestId: text(input.requestId), message: text(input.message),
      ...(input.planLineage !== undefined ? { planLineage: parsePlanLineage(input.planLineage) } : {}) };
  }
  const itemId = text(data.itemId);
  const item = plan.items.find((item) => item.id === itemId);
  requireCondition(item, 'unknown private execution item.');
  const originalDesign = parseDesignRevision(data.originalDesign);
  const currentDesign = parseDesignRevision(data.currentDesign);
  for (const revision of [originalDesign, currentDesign]) {
    requireCondition(revision.id !== 'unpublished-design' || isUnpublishedWorkflowDesign(revision),
      'unpublished Design is explicit absence, never a completed seed.');
  }
  if (data.design !== undefined) {
    const input = object(data.design, ['requestId', 'message', 'previousRevisionId', 'previousDesign']);
    requireCondition(assessmentOnly && approval === null && !data.review && !coordination,
      'private Design is read-only and cannot also coordinate or review.');
    requireCondition(plan.designRevisionId === currentDesign.id && policyHash(originalDesign) === policyHash(currentDesign),
      'private Design must bind one exact current revision.');
    const previousRevisionId = input.previousRevisionId === null ? null : text(input.previousRevisionId);
    let previousDesign: BackboneProposalInput | null = null;
    if (input.previousDesign === null) {
      requireCondition(previousRevisionId === null && isUnpublishedWorkflowDesign(currentDesign),
        'initial private Design requires explicit unpublished inputs.');
    } else {
      const generation = createPolicyGeneration('private-design-input', policy);
      generation.validateDesign(input.previousDesign as BackboneProposalInput);
      previousDesign = structuredClone(input.previousDesign) as BackboneProposalInput;
      requireCondition(currentDesign.complete && previousRevisionId === currentDesign.id
        && currentDesign.entities.find(({ id }) => id === 'design:root')?.digest === policyHash(previousDesign),
      'previous private Design identity/digest differs from the current revision.');
    }
    design = { requestId: text(input.requestId), message: text(input.message), previousRevisionId, previousDesign };
  }
  const acceptedDependencies = list(data.acceptedDependencies, parseItemBinding);
  unique(acceptedDependencies.map(({ id }) => id));
  if (assessmentOnly) {
    const unpublished = isUnpublishedWorkflowDesign(originalDesign) && isUnpublishedWorkflowDesign(currentDesign)
      && plan.designRevisionId === currentDesign.id && item.designRefs.length === 0
      && (design || coordination?.kind === 'router' || coordination?.kind === 'agent');
    requireCondition(acceptedDependencies.length === 0
      && (unpublished || assessImpact(item, originalDesign, currentDesign).status === 'unaffected'),
      'assessment design expectations are unknown or changed.');
  } else {
    const reason = itemEligibility(plan, item, approval, originalDesign, currentDesign, acceptedDependencies);
    requireCondition(!reason, reason ?? 'private task lacks eligible approved work.');
  }
  const before = parseWorkspaceBoundary(data.before);
  const retainedWork = data.retainedWork === undefined ? undefined : parseRetainedWork(data.retainedWork);
  if (retainedWork && !data.review && !data.assessmentOnly) {
    requireCondition(Boolean(data.executionBaseline), 'retained execution requires the newly approved execution boundary.');
    requireRetainedExecution(retainedWork, before);
    requireCondition(retainedWork.paths.every((path) => item.scope.some((allowed) =>
      allowed.replaceAll('\\', '/').toLowerCase() === path.replaceAll('\\', '/').toLowerCase())),
    'the newly approved work item must cover the retained changed paths.');
  }
  // This bounded prototype requires a fresh plan baseline for each task. Continuation
  // rebasing from applied Review receipts belongs to the later owning controller.
  let executionBaseline: PrivateTask['executionBaseline'];
  if (data.executionBaseline !== undefined) {
    const boundary = object(data.executionBaseline, ['operationId', 'evidenceRefs', 'inventoryDigest']);
    const evidenceRefs = strings(boundary.evidenceRefs);
    requireCondition(evidenceRefs.length > 0 && boundary.inventoryDigest === before.inventoryDigest,
      'continued task baseline requires exact Host evidence.');
    executionBaseline = { operationId: text(boundary.operationId), evidenceRefs, inventoryDigest: parseDigest(boundary.inventoryDigest) };
  }
  let review: PrivateTask['review'];
  if (data.review !== undefined) {
    const scoped = object(data.review, ['implementation', 'proposal', 'snapshotId', 'outOfScopePaths']);
    requireCondition(scoped.implementation !== null && typeof scoped.implementation === 'object'
      && !Object.hasOwn(scoped.implementation, 'review'), 'review cannot recursively review another review task.');
    const implementation = parsePrivateTask(scoped.implementation, owner);
    const proposal = parseChangeProposal(scoped.proposal, owner, implementation);
    const outOfScopePaths = strings(scoped.outOfScopePaths);
    requireCondition(plan.digest === implementation.plan.digest && itemId === implementation.itemId
      && sameBoundary(before, proposal.after) && outOfScopePaths.every((path) => proposal.files.some((file) => file.path === path)),
    'read-only review scope does not match the approved captured implementation.');
    review = { implementation, proposal, snapshotId: text(scoped.snapshotId), outOfScopePaths };
  }
  requireCondition(review || executionBaseline || before.inventoryDigest === plan.baselineDigest,
    'task baseline differs from the approved plan.');
  return {
    taskId: text(data.taskId), dispatchId: text(data.dispatchId), plan, approval, itemId,
    originalDesign, currentDesign, acceptedDependencies,
    contextRefs: strings(data.contextRefs), constraints: strings(data.constraints), before,
    ...(retainedWork ? { retainedWork } : {}),
    ...(executionBaseline ? { executionBaseline } : {}), ...(review ? { review } : {}),
    ...(assessmentOnly ? { assessmentOnly } : {}),
    ...(coordination ? { coordination } : {}),
    ...(design ? { design } : {}),
    ...(data.attachments !== undefined ? { attachments: parseAnnotationAttachments(data.attachments) } : {}),
  };
}

export type PrivateResultKind = 'implementation' | 'router' | 'planner' | 'review' | 'design' | 'agent';

export function privateResultKind(task: Pick<PrivateTask, 'coordination' | 'review' | 'design'>): PrivateResultKind {
  return task.design ? 'design' : task.coordination?.kind ?? (task.review ? 'review' : 'implementation');
}

export function privateResultFields(kind: PrivateResultKind): string[] {
  return [
    'resultId', 'inputDigest', 'summary', 'evidenceRefs',
    ...(kind === 'design' ? ['design'] : kind === 'review' ? ['review']
      : kind === 'router' ? ['intent', 'candidate'] : kind === 'planner' ? ['candidate']
        : kind === 'agent' ? ['report'] : []),
  ];
}

export function parsePrivateResult(value: unknown, task: PrivateTask): PrivateTaskResult {
  const data = object(value, privateResultFields(privateResultKind(task)));
  requireCondition(data.inputDigest === policyHash(task), 'typed result does not match the exact task inputs.');
  const summary = text(data.summary);
  requireCondition(summary.length <= task.plan.policy.values.schema['review.summary.maxLength'],
    'typed result summary exceeds its pinned policy.');
  const evidenceRefs = strings(data.evidenceRefs);
  requireCondition(evidenceRefs.length > 0, 'typed result requires retained evidence references.');
  const review = task.review ? validateWorkReviewResult(data.review, {
    snapshotId: task.review.snapshotId, planDigest: task.plan.digest,
    item: task.plan.items.find(({ id }) => id === task.itemId)!,
    changedPaths: task.review.proposal.files.map(({ path }) => path), outOfScopePaths: task.review.outOfScopePaths,
  }, task.plan.policy) : undefined;
  let intent: PrivateTaskResult['intent'];
  if (task.coordination?.kind === 'router') {
    requireCondition(['answer', 'design', 'plan', 'agent-work'].includes(String(data.intent)), 'unknown Router intent.');
    intent = data.intent as PrivateTaskResult['intent'];
  }
  const planning = task.coordination?.kind === 'router' || task.coordination?.kind === 'planner';
  const candidate = planning && data.candidate !== null
    ? parsePlanProposal(data.candidate, task.plan.policy) : undefined;
  if (candidate && task.retainedWork) requireRetainedPlanCoverage(candidate, task.retainedWork);
  requireCondition(task.coordination?.kind !== 'planner' || candidate, 'Planner must submit a complete candidate.');
  const report = task.coordination?.kind === 'agent' ? text(data.report) : undefined;
  requireCondition(report === undefined || Buffer.byteLength(report, 'utf8') <= task.plan.policy.values.resources.requestBytes,
    'Agent report exceeds its pinned output bound.');
  requireCondition(!candidate || ((!intent || intent === 'plan') && candidate.baselineDigest === task.before.inventoryDigest
    && candidate.designRevisionId === task.currentDesign.id), 'Candidate does not match the bounded planning inputs.');
  const proposal: ChangePlanProposal | null = candidate ? {
    schemaVersion: candidate.schemaVersion, id: candidate.id, version: candidate.version, outcome: candidate.outcome,
    designRevisionId: candidate.designRevisionId, baselineDigest: candidate.baselineDigest, policyDigest: candidate.policyDigest,
    items: candidate.items.map(({ digest: _digest, ...item }) => item),
  } : null;
  return {
    resultId: text(data.resultId), inputDigest: policyHash(task), summary, evidenceRefs, ...(review ? { review } : {}),
    ...(intent ? { intent } : {}), ...(planning ? { candidate: proposal } : {}),
    ...(report !== undefined ? { report } : {}),
    ...(task.design ? { design: parsePrivateDesignOutput(data.design, task.plan.policy, task.design.previousDesign) } : {}),
  };
}

export function parsePrivateSubmission(value: unknown, task: PrivateTask): PrivateTaskResult {
  const result = parsePrivateResult(value, task);
  if (result.candidate) {
    const plan = parsePlanProposal(result.candidate, task.plan.policy);
    if (task.coordination?.planLineage) requirePlanLineage(plan, task.coordination.planLineage);
    requireCondition(plan.items.every((item) => assessImpact(item, task.currentDesign, task.currentDesign).status === 'unaffected'),
      'Candidate designRefs must use only known task.currentDesign.entities IDs and resolved dependencies.');
  }
  return result;
}

export function parseRuntimeStatus(value: unknown, owner: PrivateExecutionOwner): PrivateRuntimeStatus {
  const data = object(value, [
    'sessionId', 'mode', 'ownershipRef', 'historyRef', 'idle', 'pendingMessageIds',
    'unresolvedWorkRefs', 'boundary',
  ]);
  const { boundary, ...observation } = data;
  return { ...parseRuntimeObservation(observation, owner), boundary: parseWorkspaceBoundary(boundary) };
}

export function parseRuntimeObservation(value: unknown, owner: PrivateExecutionOwner): PrivateRuntimeObservation {
  const data = object(value, [
    'sessionId', 'mode', 'ownershipRef', 'historyRef', 'idle', 'pendingMessageIds', 'unresolvedWorkRefs',
  ]);
  requireCondition(data.sessionId === owner.privateSessionId, 'runtime status belongs to another session.');
  requireCondition(typeof data.idle === 'boolean', 'runtime idle observation must be explicit.');
  return {
    sessionId: owner.privateSessionId, mode: text(data.mode),
    ownershipRef: text(data.ownershipRef), historyRef: text(data.historyRef), idle: data.idle,
    pendingMessageIds: strings(data.pendingMessageIds), unresolvedWorkRefs: strings(data.unresolvedWorkRefs),
  };
}

export function requireReusable(status: PrivateRuntimeStatus): void {
  requireCondition(status.mode === 'interactive', 'private execution requires actual Interactive mode; no mode mutation is allowed.');
  requireCondition(status.idle && status.pendingMessageIds.length === 0 && status.unresolvedWorkRefs.length === 0,
    'private execution still has runtime, queued or required background work.');
}

export function parsePrivateUserStopEvidence(value: unknown, owner: PrivateExecutionOwner, task: PrivateTask): PrivateUserStopEvidence {
  const data = object(value, [
    'stopId', 'taskId', 'dispatchId', 'sessionId', 'messageId', 'endEventId',
    'abortAcknowledged', 'notSent', 'alreadyEnded', 'status', 'proposal',
  ]);
  const stopId = text(data.stopId);
  const taskId = text(data.taskId);
  const dispatchId = text(data.dispatchId);
  const sessionId = text(data.sessionId);
  const messageId = data.messageId === null ? null : text(data.messageId);
  const endEventId = data.endEventId === null ? null : text(data.endEventId);
  const abortAcknowledged = data.abortAcknowledged === true;
  const notSent = data.notSent === true;
  const alreadyEnded = data.alreadyEnded === true;
  requireCondition(taskId === task.taskId && dispatchId === task.dispatchId && sessionId === owner.privateSessionId,
    'private stop evidence belongs to another task, dispatch or session.');
  requireCondition(stopId.length > 0, 'private stop evidence needs a stop identity.');
  requireCondition(notSent || abortAcknowledged || alreadyEnded, 'private stop evidence needs a stop outcome flag.');
  requireCondition(!(notSent && (abortAcknowledged || alreadyEnded || messageId !== null || endEventId !== null)),
    'private stop evidence claims a dispatched or ended task was not sent.');
  requireCondition(!(alreadyEnded && notSent), 'private stop evidence cannot be both not-sent and already ended.');
  requireCondition(!(alreadyEnded && abortAcknowledged), 'private stop evidence cannot be both aborted and already ended.');
  requireCondition(notSent || endEventId !== null, 'private stop evidence needs a native end event.');
  const status = parseRuntimeStatus(data.status, owner);
  requireReusable(status);
  const proposal = parseChangeProposal(data.proposal, owner, task);
  return {
    stopId, taskId, dispatchId, sessionId, messageId, endEventId,
    abortAcknowledged, notSent, alreadyEnded, status, proposal,
  };
}

export function parseChangeProposal(value: unknown, owner: PrivateExecutionOwner, task: PrivateTask): ChangeProposal {
  const retained = value !== null && typeof value === 'object' && 'schemaVersion' in value && value.schemaVersion === 'retained-work-proposal/v1';
  const data = object(value, [
    'schemaVersion', 'taskId', 'inputDigest', 'repositoryId', 'sourceWorktree', 'targetWorktree',
    'before', 'after', 'patchRef', 'files', 'integration',
    ...(retained ? ['executionBefore', 'retainedWorkDigest'] : []),
  ]);
  requireCondition((data.schemaVersion === 'isolated-change-proposal/v1' || retained)
    && data.taskId === task.taskId && data.inputDigest === policyHash(task)
    && data.repositoryId === owner.repositoryId
    && data.sourceWorktree === owner.worktreePath && data.targetWorktree === owner.targetWorktreePath
    && data.integration === 'not-applied', 'proposed changes have incorrect ownership or integration authority.');
  const before = parseWorkspaceBoundary(data.before);
  const after = parseWorkspaceBoundary(data.after);
  let executionBefore: WorkspaceBoundary | undefined;
  if (retained) {
    executionBefore = parseWorkspaceBoundary(data.executionBefore);
    requireCondition(task.retainedWork && sameBoundary(before, task.retainedWork.target)
      && sameBoundary(executionBefore, task.before) && data.retainedWorkDigest === policyHash(task.retainedWork),
    'retained proposal must bind both original delivery and actual execution baselines.');
  } else requireCondition(policyHash(before) === policyHash(task.before), 'proposal must retain the exact recorded baseline evidence.');
  requireCondition(after.commit === before.commit, 'committed source changes need separate reconciliation.');
  const files = list(data.files, (value) => {
    const entry = object(value, ['path', 'beforeHash', 'afterHash']);
    const path = text(entry.path);
    if (retained) requireCondition(!['tandem.md', 'teleos.md'].includes(path.toLowerCase()), 'Host index history is not a retained product patch.');
    requireCondition(!isAbsolute(path) && !/^[a-z]:/i.test(path)
      && !path.replaceAll('\\', '/').split('/').some((part) => !part || part === '.' || part === '..'),
    'proposed file must be a safe worktree-relative path.');
    const beforeHash = entry.beforeHash === null ? null : parseDigest(entry.beforeHash);
    const afterHash = entry.afterHash === null ? null : parseDigest(entry.afterHash);
    requireCondition(beforeHash !== afterHash, 'proposed file has no actual change.');
    return { path, beforeHash, afterHash };
  });
  unique(files.map(({ path }) => path.replaceAll('\\', '/').toLowerCase()));
  requireCondition(files.length <= owner.policy.values.resources.reviewInventoryFiles, 'proposal exceeds the pinned inventory limit.');
  const changed = retained ? files.length > 0 : before.inventoryDigest !== after.inventoryDigest;
  requireCondition(changed === (files.length > 0) && changed === (data.patchRef !== null),
    'changed inventory, changed files and saved patch evidence must agree.');
  const patch = data.patchRef === null ? null : object(data.patchRef, ['artifactRef', 'digest']);
  return {
    schemaVersion: retained ? 'retained-work-proposal/v1' : 'isolated-change-proposal/v1', taskId: task.taskId, inputDigest: policyHash(task),
    repositoryId: owner.repositoryId, sourceWorktree: owner.worktreePath, targetWorktree: owner.targetWorktreePath,
    before, after, files, integration: 'not-applied',
    patchRef: patch ? { artifactRef: text(patch.artifactRef), digest: parseDigest(patch.digest) } : null,
    ...(executionBefore ? { executionBefore, retainedWorkDigest: parseDigest(data.retainedWorkDigest) } : {}),
  };
}
