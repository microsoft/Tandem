import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_POLICY, LEGACY_V1_POLICY, parsePolicySnapshot, policyHash, resolvePolicy,
} from '../../runtime-src/domain/workflow/policy.ts';
import {
  createPolicyGeneration, createPolicySchema, type PolicyContract,
} from '../../runtime-src/domain/workflow/policy-contracts.ts';
import {
  backboneBlockSubmissionSchemas, backboneConclusionSchema, implementationStateUpdatesSchema,
  type BackboneProposalInput,
} from '../../runtime-src/domain/backbone/proposal.ts';
import { attentionItemsSchema } from '../../runtime-src/domain/backbone/schema-primitives.ts';
import {
  implementationReviewResultSchema, validateImplementationReviewResult, type ImplementationReviewResult,
} from '../../runtime-src/domain/implementation-review.ts';

function attention(question = 'Choose the storage behavior.') {
  return {
    id: 'storage-choice', impact: 'blocking', question, whyItMatters: 'It defines saved data.',
    alternatives: [{ option: 'Keep', implication: 'Retain data.' }, { option: 'Replace', implication: 'Replace data.' }],
  };
}

function design(): BackboneProposalInput {
  return {
    goal: 'Save records.', summary: 'A bounded record service.',
    aspects: [{ id: 'record-contract', kind: 'contract', title: 'Record contract', summary: 'Save a record.', relatedElements: ['save'] }],
    useCases: ['save-record', 'repeat-save'].map((id) => ({
      id, title: 'Save a record', actor: 'User', outcome: 'Record saved.', implementationState: 'planned',
      steps: [{ id: 'save-step', userAction: 'Save.', systemResponse: 'Saved.', interactionId: 'save' }],
    })),
    contract: {
      schemaVersion: 'contract-set/v1', title: 'Record service', context: 'Store records.',
      participants: [
        { id: 'user', name: 'User', responsibility: 'Request a save.' },
        { id: 'service', name: 'Service', responsibility: 'Save records.' },
      ],
      interactions: [{
        id: 'save', name: 'Save', kind: 'command', fromParticipantId: 'user', toParticipantId: 'service',
        input: { name: 'Record', description: 'Record input.' }, output: { name: 'Saved', description: 'Record saved.' },
        errors: [], guarantees: [{ id: 'save-guarantee', statement: 'Save valid records.' }],
      }],
      storageContracts: [], lifecycleRules: [],
    },
    controlFlows: [], guiSketches: [], systemStacks: [],
  };
}

test('default generated contracts preserve every legacy schema threshold without mutating templates', () => {
  const templates = {
    attention: attentionItemsSchema.items, review: implementationReviewResultSchema,
    conclusion: backboneConclusionSchema, lifecycleUpdates: implementationStateUpdatesSchema,
    ...Object.fromEntries(Object.entries(backboneBlockSubmissionSchemas)
      .map(([kind, schema]) => [kind, schema.properties[kind as keyof typeof schema.properties]])),
  };
  const originals = structuredClone(templates);
  const requiredWasFrozen = Object.isFrozen(implementationReviewResultSchema.required);
  for (const [kind, template] of Object.entries(templates)) {
    assert.deepEqual(createPolicySchema(kind as PolicyContract, DEFAULT_POLICY), template);
  }
  assert.deepEqual(templates, originals);
  assert.equal(Object.isFrozen(implementationReviewResultSchema.required), requiredWasFrozen);
  assert.equal(DEFAULT_POLICY.values.schema['review.summary.maxLength'], 240);
  assert.equal(DEFAULT_POLICY.values.schema['attention.question.maxLength'], 140);
  assert.equal(DEFAULT_POLICY.values.execution.implementationAttempts, 8);
  assert.equal(DEFAULT_POLICY.values.execution.stagnantAttempts, 2);
});

test('override order does not change the digest, and effective snapshots are complete and deeply immutable', () => {
  const first = resolvePolicy({ execution: { implementationAttempts: 5 }, schema: { 'review.summary.maxLength': 480 } });
  const second = resolvePolicy({ schema: { 'review.summary.maxLength': 480 }, execution: { implementationAttempts: 5 } });
  assert.equal(first.digest, second.digest);
  assert.notEqual(first.digest, DEFAULT_POLICY.digest);
  assert.deepEqual(parsePolicySnapshot(JSON.parse(JSON.stringify(first))), first);
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first.values) && Object.isFrozen(first.values.schema));
  assert.throws(() => Object.assign(first.values.execution, { implementationAttempts: 99 }), TypeError);
  assert.equal(DEFAULT_POLICY.values.execution.implementationAttempts, 8);
  assert.throws(() => parsePolicySnapshot(first.digest), /policy/);
  assert.throws(() => parsePolicySnapshot({ digest: first.digest }), /complete immutable/);
});

for (const [label, input] of [
  ['unknown group', { safety: { skipApproval: true } }],
  ['unknown key', { execution: { skipOwnership: true } }],
  ['zero attempt budget', { execution: { implementationAttempts: 0 } }],
  ['negative length', { schema: { 'attention.question.maxLength': -1 } }],
  ['fractional count', { schema: { 'useCases.maxItems': 2.5 } }],
  ['non-finite timeout', { time: { reviewMaximumMs: Infinity } }],
  ['numeric string', { execution: { stagnantAttempts: '2' } }],
  ['undefined is not omission', { execution: { stagnantAttempts: undefined } }],
  ['disabled evidence minimum', { schema: { 'review.findings.evidence.minItems': 0 } }],
  ['conflicting schema range', { schema: { 'useCases.minItems': 8 } }],
  ['conflicting time bounds', { time: { reviewMaximumMs: 100 } }],
  ['conflicting retry bounds', { io: { renameMaximumDelayMs: 1 } }],
  ['unsupported null', { execution: { implementationAttempts: null } }],
  ['timer overflow', { time: { toastMs: 2 ** 31 } }],
  ['display rows exceed window', { presentation: { browserEvents: 1 } }],
  ['non-data object', new Date()],
] as const) {
  test(`invalid policy override fails visibly: ${label}`, () => {
    assert.throws(() => resolvePolicy(input), /Workflow:/);
  });
}

test('snapshot validation does not fill missing fields or guess unknown semantics', () => {
  const source = JSON.parse(JSON.stringify(DEFAULT_POLICY));
  delete source.values.execution.stagnantAttempts;
  source.digest = policyHash({
    schemaVersion: source.schemaVersion, semanticsVersion: source.semanticsVersion,
    defaultsVersion: source.defaultsVersion, values: source.values,
  });
  assert.throws(() => parsePolicySnapshot(source), /missing/);
  assert.throws(() => parsePolicySnapshot({ ...DEFAULT_POLICY, semanticsVersion: 'future' }), /unknown policy/);
  assert.throws(() => parsePolicySnapshot({ ...DEFAULT_POLICY, digest: 'forged' }), /digest/);
  assert.throws(() => parsePolicySnapshot({ ...DEFAULT_POLICY, next_state: 'Completed' }), /complete immutable/);
});

test('Attention schema, Host shape validation and guidance share the selected bounds', () => {
  const policy = resolvePolicy({ schema: {
    'attention.question.maxLength': 280,
    'attention.alternatives.maxItems': 4,
  } });
  const generation = createPolicyGeneration('registration-1', policy);
  assert.equal(generation.schema('attention').properties!.question!.maxLength, 280);
  assert.match(generation.guidance().attention, /280/);
  generation.validate('attention', attention('x'.repeat(280)));
  assert.throws(() => generation.validate('attention', attention('x'.repeat(281))), /280/);
  const value = attention();
  value.alternatives.push({ option: 'Third', implication: 'Third path.' }, { option: 'Fourth', implication: 'Fourth path.' });
  generation.validate('attention', value);
  value.alternatives.push({ option: 'Fifth', implication: 'Fifth path.' });
  assert.throws(() => generation.validate('attention', value), /4 entries/);
  assert.throws(() => generation.validate('attention', { ...attention(), next_state: 'Ready' }), /does not allow/);
});

test('configured Review and design validators retain semantic invariants rather than only checking shapes', () => {
  const policy = resolvePolicy({ schema: { 'review.summary.maxLength': 480, 'attention.question.maxLength': 280 } });
  const generation = createPolicyGeneration('registration-1', policy);
  const changes = { addedFiles: [], modifiedFiles: ['src\\record.ts'], deletedFiles: [], changedFiles: ['src\\record.ts'], changedBytes: 1, details: [] };
  const result: ImplementationReviewResult = {
    status: 'attention-required', summary: 'x'.repeat(480), stateUpdates: [],
    findings: [{
      perspective: 'use-case', elementId: 'save-record',
      attention: { ...attention('x'.repeat(280)), impact: 'blocking' },
      evidence: [{ path: 'src\\record.ts', observation: 'Record changes.' }],
    }],
  };
  generation.validateReview(result, design(), changes);
  assert.throws(() => validateImplementationReviewResult(result, design(), changes), /1-240/);
  assert.throws(() => generation.validateReview({ ...result, status: 'consistent' }, design(), changes), /status must agree/);
  const missingEvidence = structuredClone(result);
  missingEvidence.findings[0]!.evidence = [{ path: 'unrelated.ts', observation: 'Not changed.' }];
  assert.throws(() => generation.validateReview(missingEvidence, design(), changes), /changed implementation file/);
  generation.validateDesign(design());
  const invalid = design();
  invalid.useCases[0]!.steps[0]!.interactionId = 'missing';
  assert.throws(() => generation.validateDesign(invalid), /unknown interaction/);
});

test('schema count overrides and common identifier references remain coherent', () => {
  const policy = resolvePolicy({ schema: { 'useCases.minItems': 1, 'useCases.maxItems': 1, 'common.id.maxLength': 80 } });
  const generation = createPolicyGeneration('small-design', policy);
  const input = design();
  input.useCases.splice(1);
  generation.validateDesign(input);
  input.useCases.push(design().useCases[1]!);
  assert.throws(() => generation.validateDesign(input), /at most 1/);
  assert.equal(generation.schema('review').properties!.findings!.items!.properties!.elementId!.maxLength, 80);
  assert.equal(generation.schema('controlFlows').items!.properties!.nodes!.items!.properties!.contractId!.maxLength, 80);
});

test('presentation preference does not become an application validation rule', () => {
  const policy = resolvePolicy({ presentation: { preferredSummaryCharacters: 10, preferredQuestionCharacters: 5 } });
  const generation = createPolicyGeneration('short-display', policy);
  generation.validate('review', { status: 'consistent', summary: 'x'.repeat(240), findings: [], stateUpdates: [] });
  generation.validate('attention', attention('x'.repeat(140)));
  assert.equal(generation.renderer().preferredSummaryCharacters, 10);
  assert.equal(generation.schema('review').properties!.summary!.maxLength, 240);
});

test('paired Host validation preserves the legacy UTF-16 counting unit', () => {
  const generation = createPolicyGeneration('text-units', resolvePolicy({ schema: { 'attention.question.maxLength': 3 } }));
  assert.equal(generation.textUnits, 'utf16-code-units');
  generation.validate('attention', attention('x\u{1f600}'));
  assert.throws(() => generation.validate('attention', attention('\u{1f600}\u{1f600}')), /3 UTF-16 units/);
});

test('a registration generation cannot adopt changed settings by mutating its validator policy', () => {
  const old = createPolicyGeneration('registration-old', DEFAULT_POLICY);
  const newer = resolvePolicy({ schema: { 'review.summary.maxLength': 480 } });
  const result = { status: 'consistent', summary: 'x'.repeat(300), findings: [], stateUpdates: [] };
  assert.throws(() => old.assertCompatible(newer), /explicit new registration/);
  assert.throws(() => old.validate('review', result, newer), /registration/);
  assert.throws(() => old.validate('review', result), /240/);
  assert.throws(() => Object.assign(old, { policy: newer }), TypeError);
  createPolicyGeneration('registration-new', newer).validate('review', result);
  assert.equal(old.policy.digest, LEGACY_V1_POLICY.digest);
});

test('resource, timeout, retention and retry adapters consume the same policy', () => {
  const policy = resolvePolicy({
    resources: { requestBytes: 4, excerptBytes: 3, standaloneRetainedEvents: null },
    time: {
      reviewMaximumMs: 100, reviewMinimumMs: 50, reviewBaseMs: 20, reviewPerFileMs: 5,
      reviewPerByteMs: 1, attemptMaximumMs: 50, attemptMinimumMs: 10, reviewGraceMs: 5,
    },
    execution: { reviewAttemptMultiplier: 2 },
    io: { renameRetries: 4 },
  });
  const generation = createPolicyGeneration('resources', policy);
  generation.requestBytes('\u00e9\u00e9');
  assert.throws(() => generation.requestBytes('\u00e9\u00e9x'), /4 UTF-8 bytes/);
  assert.deepEqual(generation.excerpt(Buffer.from('abcdef')), { content: 'abc', truncated: true });
  assert.deepEqual(generation.reviewTimeout('turn', 1, 1), { review: 50, attempt: 25, total: 55 });
  assert.equal(generation.reviewTimeout('workspace-reconciliation', 1, 1).review, 100);
  assert.equal(generation.retainedEvents('canvas'), null);
  assert.equal(generation.retainedEvents('standalone'), null);
  assert.equal(generation.retryLimits().renameRetries, 4);
  assert.equal(createPolicyGeneration('defaults', DEFAULT_POLICY).retainedEvents('standalone'), 10_000);
});
