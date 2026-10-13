import { integer, list, object, requireCondition, sameSet, strings, text, unique } from './validation.ts';
import { parsePolicySnapshot, policyHash, type PolicySnapshot } from './policy.ts';
import { validatePolicyPayload } from './policy-contracts.ts';

export interface DesignRevision {
  id: string;
  complete: boolean;
  entities: Array<{ id: string; digest: string; dependencies: string[] }>;
}

export interface WorkItem {
  id: string;
  version: number;
  goal: string;
  scope: string[];
  designRefs: string[];
  dependsOn: string[];
  criteria: Array<{ id: string; description: string }>;
  digest: string;
}

export interface ChangePlan {
  schemaVersion: 'change-plan/v2';
  id: string;
  version: number;
  outcome: string;
  designRevisionId: string;
  baselineDigest: string;
  policyDigest: string;
  policy: PolicySnapshot;
  items: WorkItem[];
  digest: string;
}

export type ChangePlanProposal = Omit<ChangePlan, 'policy' | 'digest' | 'items'> & {
  items: Array<Omit<WorkItem, 'digest'>>;
};

export interface PlanLineage {
  planId: string;
  afterVersion: number;
  reusableDigest?: string;
}

export function parsePlanLineage(value: unknown): PlanLineage {
  const data = object(value, ['planId', 'afterVersion',
    ...(Object.hasOwn(value ?? {}, 'reusableDigest') ? ['reusableDigest'] : [])]);
  const reusableDigest = data.reusableDigest === undefined ? undefined : text(data.reusableDigest);
  requireCondition(reusableDigest === undefined || /^[a-f0-9]{64}$/.test(reusableDigest), 'Invalid reusable plan digest.');
  return { planId: text(data.planId), afterVersion: integer(data.afterVersion, 1),
    ...(reusableDigest ? { reusableDigest } : {}) };
}

export function planLineage(plans: Array<ChangePlan | null>): PlanLineage | undefined {
  const previous = plans.filter((plan): plan is ChangePlan => plan !== null);
  if (!previous.length) return undefined;
  const planId = previous[0]!.id;
  requireCondition(previous.every(({ id }) => id === planId), 'Saved plan lineage has conflicting identities.');
  return { planId, afterVersion: Math.max(...previous.map(({ version }) => version)) };
}

export function requirePlanLineage(plan: ChangePlan, lineage: PlanLineage): void {
  if (lineage.reusableDigest === plan.digest) return;
  requireCondition(plan.id === lineage.planId && plan.version > lineage.afterVersion,
    `candidate must be a strictly newer version of the same plan. Use id "${lineage.planId}" and version greater than ${lineage.afterVersion}; only an explicitly reusable exact candidate may be returned unchanged.`);
}

export interface ItemBinding {
  id: string;
  version: number;
  digest: string;
}

export interface Approval {
  requestId: string;
  planId: string;
  planVersion: number;
  planDigest: string;
  items: ItemBinding[];
}

export interface ImpactAssessment {
  itemDigest: string;
  fromRevision: string;
  toRevision: string;
  status: 'unaffected' | 'affected' | 'unknown';
  dependencyIds: string[];
}

function digest(value: unknown): string {
  return policyHash(value);
}

export function parseDesignRevision(value: unknown): DesignRevision {
  const data = object(value, ['id', 'complete', 'entities']);
  requireCondition(typeof data.complete === 'boolean', 'design completeness must be explicit.');
  const entities = list(data.entities, (entry) => {
    const entity = object(entry, ['id', 'digest', 'dependencies']);
    return { id: text(entity.id), digest: text(entity.digest), dependencies: strings(entity.dependencies) };
  });
  unique(entities.map(({ id }) => id));
  return { id: text(data.id), complete: data.complete, entities };
}

export function parsePlanProposal(value: unknown, snapshot: PolicySnapshot): ChangePlan {
  const policy = parsePolicySnapshot(snapshot);
  validatePolicyPayload('workPlan', value, policy);
  const data = object(value, [
    'schemaVersion', 'id', 'version', 'outcome', 'designRevisionId',
    'baselineDigest', 'policyDigest', 'items',
  ]);
  requireCondition(data.schemaVersion === 'change-plan/v2', 'unsupported plan schema.');
  const items = list(data.items, (entry): WorkItem => {
    const item = object(entry, ['id', 'version', 'goal', 'scope', 'designRefs', 'dependsOn', 'criteria']);
    const criteria = list(item.criteria, (entry) => {
      const criterion = object(entry, ['id', 'description']);
      return { id: text(criterion.id), description: text(criterion.description) };
    });
    unique(criteria.map(({ id }) => id));
    const body = {
      id: text(item.id), version: integer(item.version, 1), goal: text(item.goal),
      scope: strings(item.scope), designRefs: strings(item.designRefs),
      dependsOn: strings(item.dependsOn), criteria,
    };
    requireCondition(body.scope.length > 0 && criteria.length > 0, 'work needs explicit scope and criteria.');
    return { ...body, digest: digest(body) };
  });
  requireCondition(items.length > 0, 'a plan needs at least one work item.');
  unique(items.map(({ id }) => id));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (id: string): void => {
    requireCondition(!visiting.has(id), 'work-item dependencies must be acyclic.');
    if (visited.has(id)) return;
    const item = items.find((candidate) => candidate.id === id);
    requireCondition(item, `unknown work-item dependency ${id}.`);
    visiting.add(id);
    item.dependsOn.forEach(visit);
    visiting.delete(id);
    visited.add(id);
  };
  items.forEach(({ id }) => visit(id));
  const body = {
    schemaVersion: 'change-plan/v2' as const,
    id: text(data.id), version: integer(data.version, 1), outcome: text(data.outcome),
    designRevisionId: text(data.designRevisionId),
    baselineDigest: text(data.baselineDigest), policyDigest: policy.digest, policy, items,
  };
  return { ...body, digest: digest(body) };
}

export function parseItemBinding(value: unknown): ItemBinding {
  const data = object(value, ['id', 'version', 'digest']);
  return { id: text(data.id), version: integer(data.version, 1), digest: text(data.digest) };
}

export function approvePlan(plan: ChangePlan, value: unknown, requestId: string): Approval {
  const data = object(value, ['planId', 'planVersion', 'planDigest', 'items']);
  const items = list(data.items, parseItemBinding);
  requireCondition(
    data.planId === plan.id && data.planVersion === plan.version && data.planDigest === plan.digest,
    'approval does not identify the displayed plan version.',
  );
  requireCondition(
    sameSet(items.map(({ id }) => id), plan.items.map(({ id }) => id))
      && items.every((binding) => plan.items.some((item) =>
        item.id === binding.id && item.version === binding.version && item.digest === binding.digest)),
    'approval must bind every displayed item exactly once.',
  );
  return {
    requestId: text(requestId), planId: plan.id, planVersion: plan.version,
    planDigest: plan.digest, items,
  };
}

export function assessImpact(
  item: WorkItem,
  before: DesignRevision,
  after: DesignRevision,
): ImpactAssessment {
  const closure = (design: DesignRevision): Map<string, string> | undefined => {
    if (!design.complete) return undefined;
    const result = new Map<string, string>();
    const visit = (id: string): boolean => {
      if (result.has(id)) return true;
      const entity = design.entities.find((entry) => entry.id === id);
      if (!entity) return false;
      result.set(id, digest({ digest: entity.digest, dependencies: [...entity.dependencies].sort() }));
      return entity.dependencies.every(visit);
    };
    return item.designRefs.every(visit) ? result : undefined;
  };
  const left = closure(before);
  const right = closure(after);
  const status = !left || !right || (item.designRefs.length === 0 && before.id !== after.id)
    ? 'unknown'
    : left.size === right.size && [...left].every(([id, value]) => right.get(id) === value)
      ? 'unaffected' : 'affected';
  return {
    itemDigest: item.digest, fromRevision: before.id, toRevision: after.id, status,
    dependencyIds: [...new Set([...(left?.keys() ?? []), ...(right?.keys() ?? [])])].sort(),
  };
}

export function itemEligibility(
  plan: ChangePlan,
  item: WorkItem,
  approval: Approval | null,
  originalDesign: DesignRevision,
  currentDesign: DesignRevision,
  accepted: readonly ItemBinding[],
): string | undefined {
  if (!approval || approval.planId !== plan.id || approval.planVersion !== plan.version
    || approval.planDigest !== plan.digest
    || !approval.items.some((entry) =>
      entry.id === item.id && entry.version === item.version && entry.digest === item.digest)) {
    return 'Exact plan/item approval is missing.';
  }
  if (originalDesign.id !== plan.designRevisionId
    || assessImpact(item, originalDesign, currentDesign).status !== 'unaffected') {
    return 'Design impact is affected or unknown.';
  }
  if (!item.dependsOn.every((id) => {
    const dependency = plan.items.find((entry) => entry.id === id);
    return dependency && accepted.some((entry) =>
      entry.id === id && entry.version === dependency.version && entry.digest === dependency.digest);
  })) return 'A dependency has no accepted evidence.';
  return undefined;
}
