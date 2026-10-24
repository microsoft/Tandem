import { createHash } from 'node:crypto';
import { requireCondition } from './validation.ts';

// Text limits count UTF-16 code units, matching the existing runtime validators.
// Schema minima preserve nonempty evidence; overrides cannot disable that invariant.
const schemaDefaults = {
  'attention.alternatives.implication.maxLength': 120,
  'attention.alternatives.maxItems': 3,
  'attention.alternatives.minItems': 2,
  'attention.alternatives.option.maxLength': 60,
  'attention.question.maxLength': 140,
  'attention.whyItMatters.maxLength': 160,
  'common.id.maxLength': 40,
  'common.rule.statement.maxLength': 120,
  'conclusion.aspects.maxItems': 4,
  'conclusion.aspects.minItems': 1,
  'conclusion.aspects.relatedElements.maxItems': 4,
  'conclusion.aspects.relatedElements.maxLength': 60,
  'conclusion.aspects.summary.maxLength': 140,
  'conclusion.aspects.title.maxLength': 60,
  'conclusion.goal.maxLength': 140,
  'conclusion.notes.maxItems': 12,
  'conclusion.notes.maxLength': 240,
  'conclusion.reviewSummary.changes.description.maxLength': 200,
  'conclusion.reviewSummary.changes.maxItems': 4,
  'conclusion.reviewSummary.changes.minItems': 1,
  'conclusion.reviewSummary.changes.title.maxLength': 80,
  'conclusion.reviewSummary.changes.whyItMatters.maxLength': 180,
  'conclusion.reviewSummary.headline.maxLength': 140,
  'conclusion.summary.maxLength': 240,
  'contract.context.maxLength': 220,
  'contract.interactions.errors.maxItems': 3,
  'contract.interactions.errors.meaning.maxLength': 100,
  'contract.interactions.guarantees.maxItems': 3,
  'contract.interactions.guarantees.minItems': 1,
  'contract.interactions.input.description.maxLength': 120,
  'contract.interactions.input.name.maxLength': 60,
  'contract.interactions.maxItems': 7,
  'contract.interactions.minItems': 1,
  'contract.interactions.name.maxLength': 60,
  'contract.interactions.output.description.maxLength': 120,
  'contract.interactions.output.name.maxLength': 60,
  'contract.lifecycleRules.maxItems': 4,
  'contract.participants.maxItems': 6,
  'contract.participants.minItems': 2,
  'contract.participants.name.maxLength': 50,
  'contract.participants.responsibility.maxLength': 100,
  'contract.storageContracts.guarantees.maxItems': 3,
  'contract.storageContracts.guarantees.minItems': 1,
  'contract.storageContracts.lifecycleRules.maxItems': 4,
  'contract.storageContracts.maxItems': 3,
  'contract.storageContracts.name.maxLength': 60,
  'contract.storageContracts.purpose.maxLength': 120,
  'contract.storageContracts.records.constraints.maxItems': 4,
  'contract.storageContracts.records.description.maxLength': 100,
  'contract.storageContracts.records.fields.description.maxLength': 100,
  'contract.storageContracts.records.fields.maxItems': 12,
  'contract.storageContracts.records.fields.minItems': 1,
  'contract.storageContracts.records.fields.name.maxLength': 50,
  'contract.storageContracts.records.fields.type.maxLength': 40,
  'contract.storageContracts.records.keys.fieldIds.maxItems': 4,
  'contract.storageContracts.records.keys.fieldIds.minItems': 1,
  'contract.storageContracts.records.keys.maxItems': 4,
  'contract.storageContracts.records.keys.purpose.maxLength': 100,
  'contract.storageContracts.records.maxItems': 6,
  'contract.storageContracts.records.minItems': 1,
  'contract.storageContracts.records.name.maxLength': 50,
  'contract.storageContracts.relations.maxItems': 4,
  'contract.storageContracts.relations.statement.maxLength': 100,
  'contract.title.maxLength': 80,
  'controlFlows.edges.label.maxLength': 50,
  'controlFlows.edges.maxItems': 16,
  'controlFlows.edges.minItems': 1,
  'controlFlows.maxItems': 4,
  'controlFlows.nodes.label.maxLength': 70,
  'controlFlows.nodes.maxItems': 12,
  'controlFlows.nodes.minItems': 2,
  'controlFlows.purpose.maxLength': 140,
  'controlFlows.title.maxLength': 70,
  'controlFlows.useCaseIds.maxItems': 4,
  'controlFlows.useCaseIds.minItems': 1,
  'guiSketches.maxItems': 3,
  'guiSketches.purpose.maxLength': 120,
  'guiSketches.regions.elements.label.maxLength': 50,
  'guiSketches.regions.elements.maxItems': 6,
  'guiSketches.regions.elements.minItems': 1,
  'guiSketches.regions.label.maxLength': 40,
  'guiSketches.regions.maxItems': 5,
  'guiSketches.regions.minItems': 1,
  'guiSketches.title.maxLength': 60,
  'guiSketches.useCaseIds.maxItems': 3,
  'guiSketches.useCaseIds.minItems': 1,
  'review.findings.evidence.maxItems': 3,
  'review.findings.evidence.minItems': 1,
  'review.findings.evidence.observation.maxLength': 200,
  'review.findings.evidence.path.maxLength': 260,
  'review.stateUpdates.evidence.minItems': 1,
  'review.stateUpdates.evidence.observation.maxLength': 200,
  'review.stateUpdates.evidence.path.maxLength': 260,
  'review.stateUpdates.maxItems': 100,
  'review.stateUpdates.rationale.maxLength': 240,
  'review.summary.maxLength': 240,
  'systemStacks.layers.maxItems': 6,
  'systemStacks.layers.minItems': 2,
  'systemStacks.layers.name.maxLength': 50,
  'systemStacks.layers.responsibility.maxLength': 100,
  'systemStacks.layers.technologies.maxItems': 4,
  'systemStacks.layers.technologies.minItems': 1,
  'systemStacks.layers.technologies.name.maxLength': 40,
  'systemStacks.layers.technologies.role.maxLength': 70,
  'systemStacks.maxItems': 1,
  'systemStacks.title.maxLength': 70,
  'useCases.actor.maxLength': 50,
  'useCases.maxItems': 7,
  'useCases.minItems': 2,
  'useCases.outcome.maxLength': 120,
  'useCases.steps.maxItems': 6,
  'useCases.steps.minItems': 1,
  'useCases.steps.systemResponse.maxLength': 120,
  'useCases.steps.userAction.maxLength': 100,
  'useCases.title.maxLength': 80,
  'router.reason.maxLength': 240,
  'router.useCaseIds.maxItems': 8,
  'lifecycleUpdates.maxItems': 7,
} as const;

const defaults = {
  schema: schemaDefaults,
  // Null preserves the previously unbounded pure-model fields; it is not a safety bypass.
  work: {
    planItems: null, itemCriteria: null, itemScopePaths: null, itemDependencies: null,
    textCharacters: null, evidencePerCriterion: null,
  },
  execution: {
    implementationAttempts: 8, stagnantAttempts: 2, cycleTargets: 8,
    designRecoveryAttempts: 3, reviewAttemptMultiplier: 4,
  },
  time: {
    reviewMaximumMs: 600_000, reviewMinimumMs: 180_000, reviewBaseMs: 120_000,
    reviewPerFileMs: 12_000, reviewPerByteMs: 2,
    attemptMaximumMs: 300_000, attemptMinimumMs: 120_000, reviewGraceMs: 30_000,
    eventHeartbeatMs: 15_000, reconnectMs: 1_000, activityRefreshMs: 1_000,
    activityDebounceMs: 80, toastMs: 3_000, attentionHighlightMs: 2_400,
  },
  resources: {
    requestBytes: 64 * 1024, excerptBytes: 4_000,
    canvasRetainedEvents: null, standaloneRetainedEvents: 10_000,
    reviewCheckpointPrompts: 100, reviewInventoryFiles: 100_000,
    reviewProtectedWrites: 1_000, reviewReasonCharacters: 2_000,
    reviewErrorCharacters: 4_000, reviewCollections: 10_000,
    reviewIdentityCharacters: 200, reviewElementCharacters: 100,
    reviewLabelCharacters: 500, reviewExcerptCharacters: 4_000,
    reviewIndexCharacters: 2_000_000, reviewSavedQuestionCharacters: 500,
    reviewSavedRationaleCharacters: 1_000, reviewSavedOptionCharacters: 500,
    reviewSavedImplicationCharacters: 1_000, reviewSavedEvidenceCharacters: 1_000,
    reviewSavedPathCharacters: 1_000, reviewPromptCharacters: 100_000,
  },
  presentation: {
    preferredSummaryCharacters: 240, preferredQuestionCharacters: 140,
    browserEvents: 500, activityRows: 30, projectedTargets: 8,
    svgLineCharacters: 22, flowLaneCharacters: 15, flowNodeCharacters: 18,
    actorCharacters: 16, actionCharacters: 20, outcomeCharacters: 18,
    overviewTitleCharacters: 28, overviewOutcomeCharacters: 34, overviewActorCharacters: 14,
  },
  io: { renameRetries: 20, renameInitialDelayMs: 50, renameMaximumDelayMs: 500 },
};

type NumericTree<T> = { readonly [K in keyof T]: T[K] extends number ? K extends 'standaloneRetainedEvents' ? number | null : number
  : T[K] extends null ? number | null : NumericTree<T[K]> };
export type PolicyValues = NumericTree<typeof defaults>;
export type PolicyOverrides = { [G in keyof PolicyValues]?: Partial<PolicyValues[G]> };
export interface PolicySnapshot {
  readonly schemaVersion: 'workflow-policy/v1';
  readonly semanticsVersion: 'workflow-policy-semantics/v1';
  readonly defaultsVersion: string;
  readonly values: PolicyValues;
  readonly digest: string;
}

const validatedSnapshots = new WeakSet<object>();
const deeplyFrozen = new WeakSet<object>();

export function canonicalPolicyJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalPolicyJson).join(',')}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalPolicyJson(entry)}`).join(',')}}`;
}

export function policyHash(value: unknown): string {
  return createHash('sha256').update(canonicalPolicyJson(value)).digest('hex');
}

export function freezePolicyValue<T>(value: T): T {
  if (value && typeof value === 'object' && !deeplyFrozen.has(value)) {
    Object.values(value).forEach(freezePolicyValue);
    Object.freeze(value);
    deeplyFrozen.add(value);
  }
  return value;
}

function record(value: unknown): Record<string, unknown> {
  requireCondition(value !== null && typeof value === 'object' && !Array.isArray(value), 'policy must be an object.');
  requireCondition(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null,
    'policy must be a plain data object.');
  return value as Record<string, unknown>;
}

function readValues(value: unknown, partial: boolean, validateRelations = true): PolicyValues {
  const input = record(value);
  const result: Record<string, Record<string, number | null>> = {};
  requireCondition(Object.keys(input).every((key) => Object.hasOwn(defaults, key)), 'unknown policy group.');
  for (const [group, defined] of Object.entries(defaults)) {
    requireCondition(partial || Object.hasOwn(input, group), `policy snapshot is missing ${group}.`);
    const overrides = Object.hasOwn(input, group) ? record(input[group]) : {};
    requireCondition(Object.keys(overrides).every((key) => Object.hasOwn(defined, key)), `unknown ${group} policy key.`);
    const resolved: Record<string, number | null> = {};
    for (const [key, fallback] of Object.entries(defined)) {
      requireCondition(partial || Object.hasOwn(overrides, key), `policy snapshot is missing ${group}.${key}.`);
      const selected = Object.hasOwn(overrides, key) ? overrides[key] : fallback;
      if (selected === null) {
        requireCondition(fallback === null || (group === 'resources' && key === 'standaloneRetainedEvents'),
          `${group}.${key} cannot disable its bound.`);
      } else {
        const zeroAllowed = key.endsWith('.maxItems') || key === 'renameRetries'
          || (group === 'work' && key === 'itemDependencies')
          || key === 'reviewPerFileMs' || key === 'reviewPerByteMs';
        requireCondition(typeof selected === 'number' && Number.isSafeInteger(selected)
          && selected >= (zeroAllowed ? 0 : 1), `${group}.${key} must be a valid integer bound.`);
        if (group === 'time' || key.endsWith('DelayMs')) {
          requireCondition(selected <= 2 ** 31 - 1, `${group}.${key} exceeds the runtime timer representation.`);
        }
      }
      resolved[key] = selected as number | null;
    }
    result[group] = resolved;
  }
  // Keys and every scalar were checked above; this is the catalog's exact mapped shape.
  const values = result as PolicyValues;
  if (!validateRelations) return values;
  for (const [key, minimum] of Object.entries(values.schema)) {
    if (!key.endsWith('.minItems')) continue;
    const maximum = result.schema![key.replace(/\.minItems$/, '.maxItems')];
    requireCondition(maximum === undefined || maximum === null || minimum <= maximum, `policy count range conflicts at ${key}.`);
  }
  requireCondition(values.time.reviewMinimumMs <= values.time.reviewMaximumMs
    && values.time.reviewBaseMs <= values.time.reviewMaximumMs
    && values.time.attemptMinimumMs <= values.time.attemptMaximumMs
    && values.io.renameInitialDelayMs <= values.io.renameMaximumDelayMs, 'policy minimum/maximum bounds conflict.');
  requireCondition(values.presentation.activityRows <= values.presentation.browserEvents, 'activity rows exceed the browser event window.');
  return values;
}

function snapshot(values: PolicyValues, defaultsVersion: string): PolicySnapshot {
  const body = {
    schemaVersion: 'workflow-policy/v1' as const,
    semanticsVersion: 'workflow-policy-semantics/v1' as const,
    defaultsVersion, values,
  };
  const snapshot = freezePolicyValue({ ...body, digest: policyHash(body) });
  validatedSnapshots.add(snapshot);
  return snapshot;
}

export function validatePolicyOverrides(overrides: unknown): void {
  readValues(overrides, true, false);
}

export function resolvePolicy(overrides: unknown = {}, base: PolicySnapshot = DEFAULT_POLICY): PolicySnapshot {
  const original = parsePolicySnapshot(base);
  const input = record(overrides);
  // Validate partial input before merging so unknown keys are never dropped.
  validatePolicyOverrides(input);
  const values = Object.fromEntries(Object.entries(original.values).map(([group, values]) =>
    [group, { ...values, ...(Object.hasOwn(input, group) ? record(input[group]) : {}) }]));
  return snapshot(readValues(values, false), original.defaultsVersion);
}

export function parsePolicySnapshot(value: unknown): PolicySnapshot {
  if (value !== null && typeof value === 'object' && validatedSnapshots.has(value)) return value as PolicySnapshot;
  const input = record(value);
  requireCondition(Object.keys(input).length === 5
    && ['schemaVersion', 'semanticsVersion', 'defaultsVersion', 'values', 'digest'].every((key) => Object.hasOwn(input, key)),
  'a complete immutable policy snapshot is required; a bare digest is insufficient.');
  requireCondition(input.schemaVersion === 'workflow-policy/v1'
    && input.semanticsVersion === 'workflow-policy-semantics/v1', 'unknown policy semantics; inspection only.');
  requireCondition(typeof input.defaultsVersion === 'string' && input.defaultsVersion.trim(), 'policy defaults provenance is required.');
  const body = {
    schemaVersion: 'workflow-policy/v1' as const,
    semanticsVersion: 'workflow-policy-semantics/v1' as const,
    defaultsVersion: input.defaultsVersion,
    values: readValues(input.values, false),
  };
  requireCondition(input.digest === policyHash(body), 'policy snapshot digest is corrupt or conflicting.');
  const snapshot = freezePolicyValue({ ...body, digest: policyHash(body) });
  validatedSnapshots.add(snapshot);
  return snapshot;
}

// This edition remains the known legacy compatibility profile even if a later default edition is selected.
export const LEGACY_V1_POLICY = snapshot(readValues({}, true), 'teleos-defaults/2026-09-08');
export const DEFAULT_POLICY = LEGACY_V1_POLICY;
