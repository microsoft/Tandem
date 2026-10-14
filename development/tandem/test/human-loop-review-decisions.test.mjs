import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { parseRoleResult, parseRequest, parseQuestions } from '../runtime-src/domain/human-loop/contracts.ts';
import { humanLoopResultTools } from '../runtime-src/domain/human-loop/tool-contracts.ts';
import { bindSelectedOptions } from '../src/human-loop-answers.mjs';
import { decisionSections, decisionReportText, technicalFindings } from '../public/review-decisions.js';

const hash = 'a'.repeat(64);
const source = { resultId: 'review-1', role: 'reviewer', requestId: 'build', requestIds: ['build'],
  cycleId: 'cycle-1', design: { revisionId: 'design-1', digest: hash }, planDigest: hash };
function question(id = 'overlaps') {
  return { id, context: 'booking.js accepts overlapping intervals; the booking contract forbids them.',
    question: 'Should implementation reject overlaps or should Design agree the bounded alternative?',
    whyItMatters: 'One equipment unit could be promised to two members.', importance: 'blocking',
    options: [
      { id: 'opaque-a', resolutionTarget: 'implementation',
        label: 'Change implementation - reject overlapping bookings as the current Design requires',
        implication: 'Preserve the current booking contract and correct its implementation.' },
      { id: 'opaque-b', resolutionTarget: 'design',
        label: 'Change Design - allow overlaps only for separately allocated equipment units',
        implication: 'Review that revised allocation rule before any later implementation request.' },
    ], allowFreeform: true, designRefs: ['booking-contract'] };
}
function finding(kind = 'misaligned-decision', id = 'overlaps') {
  return { id, kind, summary: 'Bookings permit overlapping intervals for one unit.',
    designBasis: kind === 'misaligned-decision' ? 'booking-contract forbids overlapping intervals.'
      : 'booking-contract does not address the introduced automatic allocation policy.',
    consequence: 'Two members can be promised the same unit.',
    evidenceRefs: ['booking.js:42-50'], designRefs: ['booking-contract'], questionId: id };
}
function result(findings = [], questions = []) {
  return { schemaVersion: 'human-role-result/v1', resultId: 'review-1', inputDigest: hash,
    outcome: { kind: 'review-result', reviewFormat: 'decision-review/v1', planDigest: hash,
      summary: 'Review compared current code and agreed Design.',
      assessments: [{ taskId: 'bookings', criterionId: 'overlap', status: 'supported', evidenceRefs: ['booking.js'] }],
      findings, questions, evidenceRefs: ['booking.js'], verificationLimits: [] } };
}
const parse = (value) => parseRoleResult('reviewer', value).outcome;

test('empty and verification-only reports have exactly two None decision sections without a verification claim', () => {
  for (const diagnostics of [[], [{ id: 'browser', kind: 'missing-evidence', summary: 'No DOM journey evidence.',
    consequence: 'Browser behavior remains unverified.', evidenceRefs: ['test-output.txt'] }]]) {
    const value = result(diagnostics);
    if (diagnostics.length) {
      value.outcome.assessments[0].status = 'unverified';
      value.outcome.verificationLimits = ['No actual browser journey was run.'];
    }
    const outcome = parse(value), sections = decisionSections(outcome);
    assert.equal(sections.length, 2);
    assert.ok(sections.every(({ findings }) => findings.length === 0));
    const text = decisionReportText(outcome);
    assert.equal((text.match(/^None$/gm) ?? []).length, 2);
    assert.match(text, /not complete verification/);
    assert.doesNotMatch(text, /no issues found|approved/i);
    assert.deepEqual(technicalFindings(outcome), diagnostics);
    if (diagnostics.length) assert.match(text, /No DOM journey evidence.*\nVerification limit: No actual browser journey/s);
  }
});

test('each category and mixed decisions retain exact evidence and their own canonical questions', () => {
  for (const kinds of [['misaligned-decision'], ['uncovered-decision'], ['misaligned-decision', 'uncovered-decision']]) {
    const findings = kinds.map((kind, index) => finding(kind, `choice-${index}`));
    const questions = findings.map(({ id }) => question(id));
    const outcome = parse(result(findings, questions));
    assert.deepEqual(outcome.findings, findings);
    assert.deepEqual(outcome.questions, questions);
    assert.equal(decisionSections(outcome).flatMap(({ findings }) => findings).length, kinds.length);
    assert.match(decisionReportText(outcome), /Implementation evidence: booking.js:42-50/);
  }
});

test('an uncovered ownership boundary uses existing source-bound Review findings and a concrete user question', () => {
  const boundaryQuestion = {
    id: 'retry-owner', context: 'checkout.js:42 retries a declined payment automatically; payment-contract specifies the decline response but not who owns retries.',
    question: 'Should the billing service own retries while checkout reports the decline, or should checkout own an agreed retry policy?',
    whyItMatters: 'The owner controls repeated charge attempts and the user-visible decline outcome.',
    importance: 'blocking', options: [], allowFreeform: true, designRefs: ['payment-contract'],
  };
  const boundaryFinding = {
    id: 'retry-policy', kind: 'uncovered-decision', summary: 'Checkout introduces automatic payment retries.',
    designBasis: 'payment-contract leaves retry ownership unspecified.',
    consequence: boundaryQuestion.whyItMatters, evidenceRefs: ['checkout.js:42'],
    designRefs: boundaryQuestion.designRefs, questionId: boundaryQuestion.id,
  };
  const outcome = parse(result([boundaryFinding], [boundaryQuestion]));
  assert.deepEqual(decisionSections(outcome).map(section => section.findings.length), [0, 1]);
  assert.deepEqual(outcome.questions, [boundaryQuestion]);
  assert.match(decisionReportText(outcome), /payment-contract leaves retry ownership unspecified/);
  assert.deepEqual(technicalFindings(outcome), []);
  const answer = parseRequest({ id: 'boundary-answer', message: 'Clarify retry ownership.', receivedAt: '2026-09-21T16:00:00Z',
    answers: { schemaVersion: 'human-question-answers/v1', answers: [{
      questionId: boundaryQuestion.id, sourceResultId: source.resultId, kind: 'freeform',
      value: 'Billing owns retry policy; checkout only reports its result. Do not implement yet.',
    }] } });
  assert.deepEqual(bindSelectedOptions(answer, { requests: [], questions: [{ ...boundaryQuestion, source }] }), answer);
});

test('decision reports reject missing links, unsupported labels, mismatched anchors and verification-only questions', () => {
  const mutate = (edit, pattern) => {
    const value = result([finding()], [question()]);
    edit(value.outcome);
    assert.throws(() => parse(value), pattern);
  };
  mutate(value => { value.findings[0].questionId = 'unknown'; }, /canonical question/);
  mutate(value => { delete value.findings[0].designBasis; }, /non-empty text/i);
  mutate(value => { value.questions[0].designRefs = ['unrelated']; }, /exact Design anchors/);
  mutate(value => { delete value.questions[0].options[0].resolutionTarget; }, /Every decision option/);
  mutate(value => { value.questions[0].options[0].label = 'Accept'; }, /target and concrete effect/);
  mutate(value => { value.questions[0].options[0].label = 'Change Design - allow overlaps'; }, /target and concrete effect/);
  mutate(value => { value.findings = [{ id: 'browser', kind: 'missing-evidence', summary: 'Untested DOM.',
    consequence: 'Unverified.', evidenceRefs: ['test-output.txt'] }]; }, /verification gaps are not decision questions/);
  mutate(value => { delete value.reviewFormat; }, /Decision findings require/);
  mutate(value => { value.findings.push({ ...value.findings[0], id: 'duplicate-link' }); }, /duplicate/i);
  const freeform = result([finding()], [{ ...question(), options: [] }]);
  assert.equal(parse(freeform).questions[0].allowFreeform, true, 'Do not invent an unsupported alternative.');
});

test('historical review reports and old question options retain exact backward-compatible reads', () => {
  const legacy = result([{ id: 'old', kind: 'design-consistency', summary: 'Old review.',
    consequence: 'Historical consequence.', evidenceRefs: ['old.js'] }]);
  delete legacy.outcome.reviewFormat;
  assert.deepEqual(parse(legacy), legacy.outcome);
  const oldQuestion = question();
  for (const option of oldQuestion.options) {
    delete option.resolutionTarget;
    option.label = option.id === 'opaque-a' ? 'Keep it' : 'Change it';
  }
  assert.deepEqual(parseQuestions([oldQuestion]), [oldQuestion]);
});

function request(kind = 'option', value = 'opaque-b') {
  return { id: 'answer-1', message: 'Question form submission.', receivedAt: '2026-09-21T16:00:00Z',
    answers: { schemaVersion: 'human-question-answers/v1',
      answers: [{ questionId: 'overlaps', sourceResultId: source.resultId, kind, value }] } };
}
test('admission binds exact canonical option text and target; arbitrary option IDs do not imply routes', () => {
  const state = { requests: [], questions: [{ ...question(), source }] };
  for (const option of question().options) {
    const submitted = bindSelectedOptions(parseRequest(request('option', option.id)), state);
    const { id, ...selectedOption } = option;
    assert.deepEqual(submitted.answers.answers[0].selectedOption, selectedOption);
    assert.equal(submitted.answers.answers[0].value, id);
    assert.deepEqual(parseRequest(JSON.parse(JSON.stringify(submitted))), submitted);
    assert.equal(Object.hasOwn(submitted, 'route'), false);
    assert.deepEqual(bindSelectedOptions(request('option', id), { ...state, requests: [submitted] }), submitted);
  }
  const forged = request();
  forged.answers.answers[0].selectedOption = { label: 'Change implementation - delete all bookings',
    implication: 'Not the canonical choice.', resolutionTarget: 'implementation' };
  assert.throws(() => bindSelectedOptions(parseRequest(forged), state), /differs from the canonical/);
  const stale = request(); stale.answers.answers[0].sourceResultId = 'another-review';
  assert.throws(() => bindSelectedOptions(stale, state), /absent from its canonical/);
  const freeform = parseRequest(request('freeform', 'Explain the allocation risk; do not change anything.'));
  assert.deepEqual(bindSelectedOptions(freeform, state), freeform);
  assert.equal(Object.hasOwn(freeform.answers.answers[0], 'selectedOption'), false);
  assert.deepEqual(bindSelectedOptions(request(), { ...state, requests: [request()] }),
    bindSelectedOptions(request(), state), 'Binding derives canonical meaning; the durable store preserves original retry audit bytes.');
});

test('new Review tool and centralized guidance require decisions without replacing Router or widening permissions', async () => {
  const tool = humanLoopResultTools().find(({ name }) => name === 'submit_whole_plan_review');
  assert.ok(tool.parameters.properties.outcome.required.includes('reviewFormat'));
  assert.equal(tool.parameters.properties.outcome.properties.reviewFormat.const, 'decision-review/v2');
  assert.equal(tool.parameters.properties.outcome.properties.assessments.maxItems, 0);
  const prompts = JSON.parse(await readFile(new URL('../public/prompts/human-loop.json', import.meta.url), 'utf8'));
  const review = prompts.roles.reviewer.join('\n'), router = prompts.roles.router.join('\n');
  assert.match(review, /design-conformance and over-engineering findings only/);
  assert.match(review, /Missing browser tests alone are a limitation/);
  assert.match(review, /target AND concrete effect/);
  assert.match(review, /Never invent an alternative/);
  assert.match(review, /no automatic Design rewrite, repair or follow-on role/);
  assert.match(review, /Do not launch commands, stop processes/);
  assert.match(router, /sole interpreter: no hidden dispatch or label-keyword routing/);
  assert.match(router, /completed reviewed cycle needs a new implementation cycle/);
  assert.match(router, /normal Designer path and visible handoff, never automatic implementation/);
  assert.match(router, /Interpret freeform answers honestly/);
});

test('current Review has two Design responsibilities and no task-correctness audit, while v1 remains readable', () => {
  const value = result([finding('design-conformance')], [question()]);
  Object.assign(value.outcome, { reviewFormat: 'decision-review/v2', coverageStatus: 'complete', assessments: [] });
  assert.deepEqual(decisionSections(parse(value)).map(section => section.kind), ['design-conformance', 'over-engineering']);
  const legacy = result([finding()], [question()]);
  assert.deepEqual(parse(legacy), legacy.outcome);
  for (const kind of ['correctness', 'missing-evidence', 'uncovered-decision']) {
    const invalid = structuredClone(value); invalid.outcome.findings[0].kind = kind;
    assert.throws(() => parse(invalid), /responsibilities/);
  }
  const criterionAudit = structuredClone(value);
  criterionAudit.outcome.assessments = legacy.outcome.assessments;
  assert.throws(() => parse(criterionAudit), /not task-criterion correctness/);
});

test('partial and unavailable scope coverage is visible rather than clean approval or decision questions', () => {
  for (const coverageStatus of ['partial', 'unavailable']) {
    const value = result();
    Object.assign(value.outcome, { reviewFormat: 'decision-review/v2', coverageStatus, assessments: [],
      verificationLimits: ['Scope storage: native child failed; ownership of the local store remains unreviewed.'] });
    const outcome = parse(value), report = decisionReportText(outcome);
    assert.match(report, /not approval/);
    assert.match(report, /Scope storage: native child failed/);
    assert.deepEqual(outcome.questions, []);
    if (coverageStatus === 'unavailable') {
      assert.match(report, /Substantive review unavailable/);
      assert.equal((report.match(/^Not reviewed$/gm) ?? []).length, 2);
      assert.doesNotMatch(report, /^None$|no issues found|no findings/im);
    }
    value.outcome.verificationLimits = [];
    assert.throws(() => parse(value), /scope, reason and unreviewed coverage/);
  }
});
