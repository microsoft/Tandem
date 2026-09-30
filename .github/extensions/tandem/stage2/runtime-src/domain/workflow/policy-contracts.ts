import {
  backboneBlockSubmissionSchemas, backboneConclusionSchema, implementationStateUpdatesSchema,
  validateBackboneProposal, type BackboneProposalInput,
} from '../backbone/proposal.ts';
import { attentionItemsSchema, idSchema, ruleSchema } from '../backbone/schema-primitives.ts';
import {
  implementationReviewResultSchema, validateImplementationReviewResult,
  type ImplementationReviewResult, type ImplementationChangeSummary,
} from '../implementation-review.ts';
import { freezePolicyValue, parsePolicySnapshot, type PolicySnapshot } from './policy.ts';
import { requireCondition, text } from './validation.ts';

export interface PolicySchema {
  anyOf?: readonly PolicySchema[];
  type?: string;
  const?: unknown;
  enum?: readonly unknown[];
  properties?: Record<string, PolicySchema>;
  required?: readonly string[];
  additionalProperties?: boolean;
  items?: PolicySchema;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  minimum?: number;
}

export type PolicyContract =
  | 'attention' | 'review' | 'conclusion' | 'useCases' | 'contract'
  | 'controlFlows' | 'guiSketches' | 'systemStacks' | 'router' | 'lifecycleUpdates'
  | 'workPlan' | 'workReview' | 'workSnapshot';

const nonempty: PolicySchema = { type: 'string', minLength: 1, pattern: '\\S' };
const stringList: PolicySchema = { type: 'array', items: nonempty, uniqueItems: true };
const objectSchema = (properties: Record<string, PolicySchema>, required = Object.keys(properties)): PolicySchema =>
  ({ type: 'object', additionalProperties: false, properties, required });

function workSchema(kind: 'workPlan' | 'workReview' | 'workSnapshot', policy: PolicySnapshot): PolicySchema {
  const boundedText = policy.values.work.textCharacters === null ? nonempty
    : { ...nonempty, maxLength: policy.values.work.textCharacters };
  const collection = (items: PolicySchema, maximum: number | null, minimum = 1): PolicySchema => ({
    type: 'array', items, minItems: minimum, ...(maximum === null ? {} : { maxItems: maximum }),
  });
  const paths = { ...stringList, maxItems: policy.values.resources.reviewInventoryFiles };
  if (kind === 'workSnapshot') {
    return objectSchema({
      snapshotId: nonempty, baselineDigest: nonempty, afterDigest: nonempty,
      changedPaths: paths, outOfScopePaths: paths,
    });
  }
  if (kind === 'workPlan') {
    return objectSchema({
      schemaVersion: { const: 'change-plan/v2' }, id: nonempty,
      version: { type: 'integer', minimum: 1 }, outcome: boundedText,
      designRevisionId: nonempty, baselineDigest: nonempty, policyDigest: { const: policy.digest },
      items: collection(objectSchema({
        id: nonempty, version: { type: 'integer', minimum: 1 }, goal: boundedText,
        scope: collection(nonempty, policy.values.work.itemScopePaths),
        designRefs: stringList, dependsOn: collection(nonempty, policy.values.work.itemDependencies, 0),
        criteria: collection(objectSchema({ id: nonempty, description: boundedText }), policy.values.work.itemCriteria),
      }), policy.values.work.planItems),
    });
  }
  return objectSchema({
    id: nonempty, planDigest: nonempty, snapshotId: nonempty, itemDigest: nonempty,
    criteria: collection(objectSchema({
      id: nonempty, satisfied: { type: 'boolean' },
      evidence: collection(boundedText, policy.values.work.evidencePerCriterion, 0),
    }), policy.values.work.itemCriteria),
    accountedPaths: paths, outOfScopePaths: paths, blockers: stringList,
  });
}

export function createPolicySchema(kind: PolicyContract, snapshot: PolicySnapshot): PolicySchema {
  const policy = parsePolicySnapshot(snapshot);
  if (kind === 'workPlan' || kind === 'workReview' || kind === 'workSnapshot') return freezePolicyValue(workSchema(kind, policy));
  const templates: Record<Exclude<PolicyContract, 'workPlan' | 'workReview' | 'workSnapshot'>, PolicySchema> = {
    attention: attentionItemsSchema.items,
    review: implementationReviewResultSchema,
    conclusion: backboneConclusionSchema,
    useCases: backboneBlockSubmissionSchemas.useCases.properties.useCases,
    contract: backboneBlockSubmissionSchemas.contract.properties.contract,
    controlFlows: backboneBlockSubmissionSchemas.controlFlows.properties.controlFlows,
    guiSketches: backboneBlockSubmissionSchemas.guiSketches.properties.guiSketches,
    systemStacks: backboneBlockSubmissionSchemas.systemStacks.properties.systemStacks,
    router: objectSchema({
      reason: { ...nonempty, maxLength: policy.values.schema['router.reason.maxLength'] },
      useCaseIds: { ...stringList, minItems: 1, maxItems: policy.values.schema['router.useCaseIds.maxItems'], items: idSchema },
    }, ['reason']),
    lifecycleUpdates: implementationStateUpdatesSchema,
  };
  const limits: Readonly<Record<string, number>> = policy.values.schema;
  const visit = (schema: PolicySchema, path: string): PolicySchema => {
    if (schema === idSchema || [
      'review.findings.elementId', 'review.stateUpdates.elementId', 'controlFlows.nodes.contractId',
    ].includes(path)) path = 'common.id';
    if (schema === attentionItemsSchema.items) path = 'attention';
    if (schema === ruleSchema) path = 'common.rule';
    const result = { ...schema };
    if (schema.required) result.required = [...schema.required];
    if (schema.enum) result.enum = [...schema.enum];
    if (Object.hasOwn(schema, 'const')) result.const = structuredClone(schema.const);
    for (const key of ['maxLength', 'minItems', 'maxItems'] as const) {
      if (schema[key] === undefined) continue;
      // A required, nonempty Router target set is structural, not an override to allow no target.
      if (path === 'router.useCaseIds' && key === 'minItems') continue;
      const configured = limits[`${path}.${key}`];
      requireCondition(configured !== undefined, `unclassified schema threshold: ${path}.${key}.`);
      result[key] = configured;
    }
    if (schema.properties) {
      result.properties = Object.fromEntries(Object.entries(schema.properties)
        .map(([key, child]) => [key, visit(child, `${path}.${key}`)]));
    }
    if (schema.items) result.items = visit(schema.items, path);
    return result;
  };
  return freezePolicyValue(visit(templates[kind], kind));
}

// This is the paired Host shape validator. SDK validation/registration remains a separate activation gate.
export function validatePolicyShape(schema: PolicySchema, value: unknown, path = 'input'): void {
  const fail = (message: string) => requireCondition(false, `${path}: ${message}`);
  if (schema.anyOf) {
    let matched = false;
    for (const candidate of schema.anyOf) {
      try { validatePolicyShape(candidate, value, path); matched = true; break; }
      catch { /* Try the remaining declared schema alternatives. */ }
    }
    if (!matched) fail('does not match an allowed schema alternative.');
  }
  if (Object.hasOwn(schema, 'const') && value !== schema.const) fail('does not match the required identity/value.');
  if (schema.enum && !schema.enum.includes(value)) fail('is not an allowed value.');
  if (schema.type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('must be an object.');
    const data = value as Record<string, unknown>;
    for (const key of schema.required ?? []) if (!Object.hasOwn(data, key)) fail(`requires ${key}.`);
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(data)) if (!Object.hasOwn(schema.properties ?? {}, key)) fail(`does not allow ${key}.`);
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (Object.hasOwn(data, key)) validatePolicyShape(child, data[key], `${path}.${key}`);
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) fail('must be an array.');
    const values = value as unknown[];
    if (schema.minItems !== undefined && values.length < schema.minItems) fail(`requires at least ${schema.minItems} entries.`);
    if (schema.maxItems !== undefined && values.length > schema.maxItems) fail(`allows at most ${schema.maxItems} entries.`);
    if (schema.uniqueItems && new Set(values.map((entry) => JSON.stringify(entry))).size !== values.length) fail('requires unique entries.');
    values.forEach((entry, index) => { if (schema.items) validatePolicyShape(schema.items, entry, `${path}[${index}]`); });
  } else if (schema.type === 'string') {
    if (typeof value !== 'string') fail('must be text.');
    const string = value as string;
    if (schema.minLength !== undefined && string.length < schema.minLength) fail(`requires at least ${schema.minLength} UTF-16 units.`);
    if (schema.maxLength !== undefined && string.length > schema.maxLength) fail(`allows at most ${schema.maxLength} UTF-16 units.`);
    if (schema.pattern && !new RegExp(schema.pattern).test(string)) fail('does not match the required format.');
  } else if (schema.type === 'integer') {
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) fail('must be a safe integer.');
    if (schema.minimum !== undefined && Number(value) < schema.minimum) fail(`must be at least ${schema.minimum}.`);
  } else if (schema.type === 'boolean' && typeof value !== 'boolean') {
    fail('must be boolean.');
  } else if (schema.type === 'null' && value !== null) {
    fail('must be null.');
  }
}

export function validatePolicyPayload(kind: PolicyContract, value: unknown, policy: PolicySnapshot): void {
  validatePolicyShape(createPolicySchema(kind, policy), value);
}

export function createPolicyGeneration(id: string, snapshot: PolicySnapshot) {
  const policy = parsePolicySnapshot(snapshot);
  const generationId = text(id);
  const assertCompatible = (candidate: PolicySnapshot) => {
    requireCondition(parsePolicySnapshot(candidate).digest === policy.digest,
      'policy differs from the advertised registration generation; explicit new registration is required.');
  };
  return freezePolicyValue({
    id: generationId,
    policy,
    textUnits: 'utf16-code-units' as const,
    assertCompatible,
    schema: (kind: PolicyContract) => createPolicySchema(kind, policy),
    validate: (kind: PolicyContract, value: unknown, candidate = policy) => {
      assertCompatible(candidate);
      validatePolicyPayload(kind, value, policy);
    },
    validateReview: (result: ImplementationReviewResult, design: BackboneProposalInput, changes: ImplementationChangeSummary) => {
      validatePolicyPayload('review', result, policy);
      validateImplementationReviewResult(result, design, changes, policy);
    },
    validateDesign: (design: BackboneProposalInput) => {
      const summary = createPolicySchema('conclusion', policy).properties!;
      const properties: Record<string, PolicySchema> = {
        goal: summary.goal!, summary: summary.summary!, aspects: summary.aspects!,
      };
      for (const kind of ['useCases', 'contract', 'controlFlows', 'guiSketches', 'systemStacks'] as const) {
        properties[kind] = createPolicySchema(kind, policy);
      }
      validatePolicyShape(objectSchema(properties), design);
      validateBackboneProposal(design, policy);
    },
    guidance: () => ({
      summary: `Review summary: at most ${policy.values.schema['review.summary.maxLength']} UTF-16 units.`,
      attention: `Attention question: at most ${policy.values.schema['attention.question.maxLength']} UTF-16 units.`,
      attempts: `At most ${policy.values.execution.implementationAttempts} implementation attempts; stop after ${policy.values.execution.stagnantAttempts} no-progress attempts.`,
    }),
    requestBytes: (value: string) => {
      requireCondition(Buffer.byteLength(value, 'utf8') <= policy.values.resources.requestBytes,
        `request exceeds ${policy.values.resources.requestBytes} UTF-8 bytes.`);
    },
    excerpt: (value: Buffer) => ({
      content: value.subarray(0, policy.values.resources.excerptBytes).toString('utf8'),
      truncated: value.length > policy.values.resources.excerptBytes,
    }),
    reviewTimeout: (scope: 'turn' | 'workspace-bootstrap' | 'workspace-reconciliation', files: number, bytes: number) => {
      requireCondition(['turn', 'workspace-bootstrap', 'workspace-reconciliation'].includes(scope), 'unknown review scope.');
      requireCondition(Number.isSafeInteger(files) && files >= 0 && Number.isSafeInteger(bytes) && bytes >= 0, 'review size must be nonnegative integers.');
      const limits = policy.values.time;
      const review = scope === 'turn' ? Math.min(limits.reviewMaximumMs, Math.max(limits.reviewMinimumMs,
        limits.reviewBaseMs + files * limits.reviewPerFileMs + bytes * limits.reviewPerByteMs)) : limits.reviewMaximumMs;
      const attempt = Math.min(limits.attemptMaximumMs, Math.max(limits.attemptMinimumMs, Math.floor(review / 2)));
      return {
        review, attempt,
        total: Math.min(limits.reviewMaximumMs, Math.max(review, attempt * policy.values.execution.reviewAttemptMultiplier + limits.reviewGraceMs)),
      };
    },
    renderer: () => ({
      schemaVersion: 'workflow-renderer-policy/v1' as const, generationId, policyDigest: policy.digest,
      ...policy.values.presentation,
    }),
    checkpointLimits: () => policy.values.resources,
    retryLimits: () => policy.values.io,
    retainedEvents: (host: 'canvas' | 'standalone') => {
      requireCondition(host === 'canvas' || host === 'standalone', 'unknown event-store host.');
      return host === 'canvas' ? policy.values.resources.canvasRetainedEvents : policy.values.resources.standaloneRetainedEvents;
    },
  });
}
