import assert from 'node:assert/strict';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import test from 'node:test';
import { renderHumanLoop } from '../public/renderers/human-loop.js';
import { renderConversationEntry } from '../public/renderers/conversation.js';
import { projectHumanConversation } from '../src/human-loop-provider.mjs';
import { projectHumanHistory } from '../public/renderers/human-loop-history.js';
import { browserAvailable, openFixtureBrowser } from './helpers/browser-fixture.mjs';

// Same small ownerDocument fixture pattern as conversation-renderer.test.mjs.
function documentFixture() {
  const document = {
    activeElement: null,
    createTextNode(text) {
      const node = this.createElement('#text');
      node.textContent = text;
      return node;
    },
    createElement(tagName) {
      let text = '';
      return {
        tagName, ownerDocument: document, dataset: {}, children: [], attributes: {}, listeners: {}, style: {},
        value: '', disabled: false, hidden: false,
        get textContent() { return text + this.children.map((child) => child.textContent).join(''); },
        set textContent(value) { text = String(value); this.children = []; },
        set innerHTML(_) { throw new Error('Model text must never be interpreted as HTML.'); },
        append(...children) { this.children.push(...children); },
        replaceChildren(...children) { text = ''; this.children = children; },
        setAttribute(key, value) { this.attributes[key] = value; },
        addEventListener(name, listener) { this.listeners[name] = listener; },
        querySelector(tag) { return descendants(this).find((node) => node.tagName === tag) ?? null; },
        focus() { document.activeElement = this; },
        fire(name) { return this.listeners[name]?.({ preventDefault() {} }); },
      };
    },
  };
  return document;
}

function descendants(node) {
  return node.children.flatMap((child) => [child, ...descendants(child)]);
}

// Exact question/source from integrated-checklist-ux/blocked-before-stop.json;
// Stop identity/reason from completed-workflow-receipt.json and restart-completed-receipt.json.
function savedStoppedQuestion() {
  const source = {
    role: 'designer',
    resultId: 'designer-5f07e611-c6b4-4c78-8256-cfc235c5f4bb-browser-storage',
    requestId: '5f07e611-c6b4-4c78-8256-cfc235c5f4bb',
    requestIds: ['5f07e611-c6b4-4c78-8256-cfc235c5f4bb'], cycleId: null,
    design: { revisionId: '8b8c578a-ee8c-4726-b76d-0e7adf542776',
      digest: 'fb966b6bc41f0ee39ce5d1e8c9a5e3651ecb30a16bfd8f5b6e648df5821bb87b' },
    planDigest: null,
  };
  const question = {
    id: 'historical-edit-policy',
    context: 'The calendar opens a preserved checklist and note for a past date. The original product request did not decide whether those records can later change, and the submitted read-only selection was explicitly limited to a disposable UX run rather than product approval.',
    question: 'For the actual product, should a past daily record be editable after it is opened?',
    whyItMatters: 'This determines whether historical completion and notes are immutable evidence or correctable records, and changes the controls and persistence rules for past dates.',
    importance: 'blocking',
    options: [
      { id: 'read-only-history', label: 'Past records are read-only',
        implication: 'The calendar opens a viewing mode; only today can be changed.' },
      { id: 'editable-history', label: 'Past records remain editable',
        implication: 'Checklist and note controls work on past dates and update that saved record.' },
      { id: 'notes-only-history', label: 'Only past notes are editable',
        implication: 'Checklist completion stays fixed while the daily note can be corrected or expanded.' },
    ],
    allowFreeform: true, state: 'open', answerRequestId: null,
    designRefs: ['calendar-history#selected-summary', 'daily-record-contract', 'daily-workspace'],
    source,
  };
  const reason = 'The user requested Stop for the current process; its questions will not be answered.';
  const lastStop = { id: '6aad9aed-f19e-4604-bd3f-be7dbc48c59b', mode: 'after-step', taskId: null,
    invalidatedQuestions: [{ id: question.id, source, question: question.question, reason }] };
  return { question, lastStop };
}

function projection(role = 'designer', resultId = 'result-1') {
  const source = { role, resultId, requestId: 'request-1', cycleId: null,
    requestIds: ['request-1'], design: { revisionId: null, digest: null }, planDigest: null };
  return {
    schemaVersion: 'human-loop-view/v1', status: 'waiting-answer', reason: null, activeRole: null,
    currentCycle: null, questionInteraction: {
      resultId, source: { role, requestId: source.requestId, design: source.design, cycleId: null },
      questions: ['one', 'two', 'three'].map((id) => ({
        id, context: `Context ${id}`, question: `Question ${id}?`, whyItMatters: `Reason ${id}`,
        importance: 'blocking', blockingActive: true, options: [{ id: 'a', label: 'First', implication: 'First consequence' },
          { id: 'b', label: 'Second', implication: 'Second consequence' }],
        allowFreeform: true, source: { ...source }, state: 'open', answerRequestId: null,
      })),
      canAnswer: true,
    },
    queue: [{ id: 'ordinary', message: 'First', status: 'waiting', kind: 'ordinary', priority: false }],
    lastHandoff: null, canStop: true, canSend: true,
  };
}

function fixture(view = projection(), overrides = {}) {
  const document = documentFixture();
  const container = document.createElement('div');
  const calls = { answers: [], stop: 0, refresh: 0, discuss: 0 };
  const actions = {
    submitAnswers: (batch) => calls.answers.push(batch),
    stop: () => { calls.stop++; },
    refresh: () => { calls.refresh++; },
    discuss: () => { calls.discuss++; },
    ...overrides,
  };
  const render = (nextView = view, state = {}, nextActions = actions) =>
    renderHumanLoop(container, { view: nextView, ...state }, nextActions);
  render();
  const all = (tag) => descendants(container).filter((node) => node.tagName === tag);
  const action = (name) => descendants(container).find((node) => node.dataset.humanLoopAction === name);
  return { document, container, calls, actions, render, all, action, view };
}

test('request-bound presentation omits the global queue without changing shared defaults or queue data', () => {
  const view = projection();
  view.activeRole = 'designer';
  view.queue.unshift({ id: 'answer', message: 'Saved answer for a separate request',
    status: 'waiting', kind: 'answer', priority: true });
  const original = structuredClone(view);
  const ui = fixture(view);
  const queueItems = () => ui.all('ol').flatMap(list => list.children.map(node => node.textContent));
  const expected = ['Answer batch · waiting · priority: Saved answer for a separate request', 'Ordinary message · waiting: First'];
  assert.deepEqual(queueItems(), expected);
  ui.render(view, { showQueue: false });
  assert.deepEqual(queueItems(), []);
  assert.doesNotMatch(ui.container.textContent, /Queue \(|Saved answer for a separate request|Ordinary message ·/);
  assert.match(ui.container.textContent, /Active role: designer/);
  assert.equal(ui.all('form').length, 1, 'Question presentation remains independent of queue visibility.');
  ui.render(view);
  assert.deepEqual(queueItems(), expected, 'Existing shared consumers still display the global queue.');
  assert.deepEqual(view, original);
});

test('new Whole Review renders exactly two decision categories, None, and separate verification evidence', () => {
  const diagnostic = { id: 'browser', kind: 'missing-evidence', summary: 'No DOM interaction evidence.',
    consequence: 'Browser behavior remains unverified.', evidenceRefs: ['test-output.txt'] };
  const misaligned = { id: 'overlap', kind: 'misaligned-decision', summary: 'Overlaps are accepted.',
    designBasis: 'booking-contract forbids overlaps.', consequence: 'The same unit can be double booked.',
    evidenceRefs: ['booking.js:42'], questionId: 'overlaps', designRefs: ['booking-contract'] };
  const uncovered = { ...misaligned, id: 'allocation', kind: 'uncovered-decision', questionId: 'allocation',
    summary: 'Automatic allocation was introduced.', designBasis: 'The contract does not agree automatic allocation.' };
  for (const findings of [[], [diagnostic], [misaligned], [uncovered], [misaligned, uncovered, diagnostic]]) {
    const view = projection();
    view.lastHandoff = { role: 'reviewer', kind: 'review-result', reviewFormat: 'decision-review/v1',
      summary: 'Must not become a third decision section.', findings, verificationLimits: ['Only controller tests were run.'],
      design: { revisionId: 'exact-revision', digest: 'a'.repeat(64) } };
    const ui = fixture(view);
    const sections = descendants(ui.container).filter(node => node.dataset.reviewCategory);
    assert.deepEqual(sections.map(node => node.children[0].textContent), [
      'Decisions misaligned with agreed Design', 'Consequential implementation decisions not covered by agreed Design',
    ]);
    for (const section of sections) {
      const expected = findings.filter(finding => finding.kind === section.dataset.reviewCategory);
      assert.equal(section.children.some(node => node.textContent === 'None'), expected.length === 0);
      assert.doesNotMatch(section.textContent, /No DOM interaction evidence|controller tests/);
      for (const finding of expected) {
        assert.ok(section.textContent.includes(finding.designBasis));
        assert.ok(section.textContent.includes(finding.evidenceRefs[0]));
        assert.ok(section.textContent.includes(finding.questionId));
      }
    }
    assert.match(ui.container.textContent, /Only controller tests were run/);
    assert.doesNotMatch(ui.container.textContent, /no issues found|third decision section/i);
    if (findings.includes(diagnostic)) assert.match(ui.container.textContent, /No DOM interaction evidence/);
  }
});

test('question groups keep unique literal heading names across simultaneous forms', () => {
  const ui = fixture();
  const other = ui.document.createElement('div');
  renderHumanLoop(other, { view: projection('reviewer', 'result-2') }, ui.actions);
  const fields = [...ui.all('fieldset'), ...descendants(other).filter(node => node.tagName === 'fieldset')];
  const ids = fields.map(field => {
    const title = field.children[0];
    assert.equal(title.tagName, 'h4');
    assert.equal(title.className, 'human-loop-question-title');
    assert.equal(title.textContent, `Question ${field.dataset.questionId}?`);
    assert.equal(field.attributes['aria-labelledby'], title.id);
    assert.ok(title.id);
    assert.equal(descendants(field).some(node => node.tagName === 'legend'), false);
    return title.id;
  });
  assert.equal(new Set(ids).size, 6);
  ui.render();
  assert.deepEqual(ui.all('fieldset').map(field => field.children[0].id), ids.slice(0, 3));
});

test('all roles share option/freeform controls and exact independent partial answer envelopes', async () => {
  for (const role of ['designer', 'reviewer', 'planner', 'implementer']) {
    const ui = fixture(projection(role));
    const selects = ui.all('select');
    selects[0].value = 'option:b';
    selects[0].fire('change');
    const text = ui.all('textarea')[1];
    text.value = '  My answer\nwith original spacing  ';
    text.fire('input');
    assert.equal(ui.action('submitAnswers').disabled, false);
    await ui.all('form')[0].fire('submit');
    assert.deepEqual(ui.calls.answers, [{
      schemaVersion: 'human-question-answers/v1',
      answers: [
        { questionId: 'one', sourceResultId: 'result-1', kind: 'option', value: 'b' },
        { questionId: 'two', sourceResultId: 'result-1', kind: 'freeform', value: '  My answer\nwith original spacing  ' },
      ],
    }]);
    assert.match(ui.container.textContent, new RegExp(`Questions from ${role}`));
    assert.match(ui.container.textContent, /Result: result-1/);
    assert.match(ui.container.textContent, /FIFO priority/);
    assert.match(ui.container.textContent, /Only effective prerequisites and their pending answer processing hold ordinary work/);
    selects[2].value = 'option:a';
    selects[2].fire('change');
    await ui.all('form')[0].fire('submit');
    assert.equal(ui.calls.answers.length, 2);
    assert.deepEqual(ui.calls.answers[1].answers, [
      { questionId: 'three', sourceResultId: 'result-1', kind: 'option', value: 'a' },
    ]);
  }
});

test('saved Stop questions do not follow later requests or same-role work in Active request', () => {
  const { question, lastStop } = savedStoppedQuestion();
  const view = projection();
  view.status = 'ready'; view.questionInteraction = null; view.queue = []; view.canStop = false;
  view.lastStop = lastStop;
  const retained = structuredClone(view);
  const ui = fixture(view);
  for (const role of [null, 'designer', 'router', 'planner', 'implementer', 'reviewer', 'agent']) {
    ui.render({ ...view, activeRole: role, status: role ? 'working' : 'ready',
      activeRequestId: role ? `later-${role}` : null });
    assert.equal(ui.all('form').length, 0);
    assert.equal(ui.all('select').length, 0);
    assert.equal(ui.all('details').some(node => node.dataset.stopId), false);
    for (const historical of [question.id, question.question, question.source.requestId,
      question.source.resultId, lastStop.id, lastStop.invalidatedQuestions[0].reason, 'Invalidated questions']) {
      assert.equal(ui.container.textContent.includes(historical), false, `${role}: ${historical}`);
    }
  }
  assert.deepEqual(view, retained, 'Removing duplicate presentation cannot change canonical input.');
  assert.deepEqual(ui.calls.answers, []);
});

test('exact stopped question remains accessible through existing Conversation and Stop history', () => {
  const { question, lastStop } = savedStoppedQuestion();
  question.state = 'invalidated';
  question.invalidation = { stopId: lastStop.id, reason: lastStop.invalidatedQuestions[0].reason };
  const state = { questions: [question], awaitedQuestionResultId: null, requests: [],
    handoffs: [{ id: `handoff:${question.source.resultId}`, result: { resultId: question.source.resultId } }] };
  const original = { id: state.handoffs[0].id, role: 'assistant', kind: 'assistant',
    requestId: question.source.requestId, content: question.question, timestamp: '2026-09-20T11:00:00Z' };
  const retained = structuredClone(state);
  const [message] = projectHumanConversation(state, [original]);
  assert.equal(message.text, original.content);
  assert.equal(message.questionHistory[0].resultId, question.source.resultId);
  const document = documentFixture(), record = renderConversationEntry(document, message);
  assert.match(record.textContent, /Saved question context/);
  assert.match(record.textContent, /Originally blocking - not blocking now/);
  assert.ok(record.textContent.includes(question.question));
  assert.ok(record.textContent.includes(question.context));
  for (const option of question.options) assert.ok(record.textContent.includes(option.label));
  assert.equal(descendants(record).some(node => ['form', 'select', 'textarea'].includes(node.tagName)), false);
  const [stop] = projectHumanHistory([{ sequence: 1, timestamp: original.timestamp, type: 'human.stopped',
    summary: question.invalidation.reason, data: { stopId: lastStop.id, requestId: question.source.requestId } }],
  [message], 'replay');
  assert.equal(stop.label, 'Stopped');
  assert.equal(stop.source.stopId, lastStop.id);
  assert.equal(stop.explanation, question.invalidation.reason);
  assert.deepEqual(state, retained);
});

test('only explicitly invalidated, exactly bound questions leave the current form', async () => {
  const { question, lastStop } = savedStoppedQuestion();
  const view = projection();
  view.activeRequestId = 'later-designer-request';
  view.activeRole = 'designer';
  view.lastStop = lastStop;
  view.questionInteraction = { resultId: question.source.resultId, source: question.source,
    questions: [question], canAnswer: true };
  const ui = fixture(view);
  assert.ok(ui.container.textContent.includes(question.question));
  ui.all('select')[0].value = 'option:read-only-history';
  ui.all('select')[0].fire('change');
  await ui.all('form')[0].fire('submit');
  assert.deepEqual(ui.calls.answers[0].answers, [{
    questionId: question.id, sourceResultId: question.source.resultId, kind: 'option', value: 'read-only-history',
  }], 'An actually open question is not retired by role/request mismatch or a historical Stop.');

  const invalidated = structuredClone(view);
  invalidated.questionInteraction.questions[0].state = 'invalidated';
  invalidated.questionInteraction.canAnswer = false;
  ui.render(invalidated);
  assert.equal(ui.all('form').length, 0);
  assert.equal(invalidated.questionInteraction.questions[0].state, 'invalidated');
  assert.equal(invalidated.questionInteraction.questions.length, 1);

  for (const [requestId, resultId] of [
    ['later-designer-request', 'new-designer-result'],
    [question.source.requestId, 'second-result-for-same-request'],
  ]) {
    const current = structuredClone(view);
    const source = { ...question.source, requestId, requestIds: [requestId], resultId };
    current.questionInteraction = { resultId, source,
      questions: [{ ...question, source }], canAnswer: true };
    ui.render(current);
    ui.all('select')[0].value = 'option:notes-only-history';
    ui.all('select')[0].fire('change');
    await ui.all('form')[0].fire('submit');
    assert.equal(ui.calls.answers.at(-1).answers[0].sourceResultId, resultId,
      'A reused question ID must not inherit invalidation from another result/request.');
  }
});

test('mixed invalidated/open questions preserve exact answers; invalid source still fails closed', async () => {
  const view = projection();
  view.questionInteraction.questions[0].state = 'invalidated';
  const retained = structuredClone(view);
  const ui = fixture(view);
  assert.deepEqual(ui.all('fieldset').map(node => node.dataset.questionId), ['two', 'three']);
  ui.all('select')[0].value = 'option:a'; ui.all('select')[0].fire('change');
  await ui.all('form')[0].fire('submit');
  assert.deepEqual(ui.calls.answers[0].answers, [
    { questionId: 'two', sourceResultId: 'result-1', kind: 'option', value: 'a' },
  ]);
  assert.deepEqual(view, retained);
  const mismatch = structuredClone(view);
  mismatch.questionInteraction.questions[0].source.requestId = 'wrong-request';
  ui.render(mismatch);
  assert.equal(ui.all('fieldset').every(node => node.disabled), true);
  assert.match(ui.container.textContent, /Question sources do not match/);
});

test('empty batches, unknown options, whitespace and resolved questions cannot submit', async () => {
  const ui = fixture();
  await ui.all('form')[0].fire('submit');
  ui.all('select')[0].value = 'option:missing';
  ui.all('textarea')[1].value = ' \n ';
  ui.all('textarea')[1].fire('input');
  await ui.all('form')[0].fire('submit');
  assert.deepEqual(ui.calls.answers, []);
  ui.all('select')[0].value = 'option:a';
  ui.all('select')[2].value = 'option:b';
  const next = structuredClone(ui.view);
  next.questionInteraction.questions[0].state = 'answered';
  next.questionInteraction.questions[2].state = 'deferred';
  ui.render(next);
  assert.equal(ui.all('fieldset')[0].disabled, true);
  assert.equal(ui.action('submitAnswers').disabled, true);
  await ui.all('form')[0].fire('submit');
  assert.deepEqual(ui.calls.answers, []);
});

test('remaining current answers enqueue separate envelopes during owned work without mixing sources', async () => {
  const ui = fixture();
  ui.all('select')[0].value = 'option:a';
  await ui.all('form')[0].fire('submit');
  const next = structuredClone(ui.view);
  next.status = 'working';
  next.activeRole = 'designer';
  next.questionInteraction.questions[0].state = 'answered';
  next.queue.unshift({ id: 'answer-1', message: 'First answer batch', status: 'active', kind: 'answer', priority: true });
  ui.render(next);
  ui.all('select')[1].value = 'option:b';
  ui.all('select')[1].fire('change');
  assert.equal(ui.action('submitAnswers').disabled, false);
  await ui.all('form')[0].fire('submit');
  assert.deepEqual(ui.calls.answers, [
    { schemaVersion: 'human-question-answers/v1', answers: [
      { questionId: 'one', sourceResultId: 'result-1', kind: 'option', value: 'a' },
    ] },
    { schemaVersion: 'human-question-answers/v1', answers: [
      { questionId: 'two', sourceResultId: 'result-1', kind: 'option', value: 'b' },
    ] },
  ]);
  assert.match(ui.container.textContent, /FIFO priority; each submitted batch remains a separate request/);
  assert.equal(next.queue[0].status, 'active');
  assert.equal(ui.calls.stop, 0);
  next.status = 'waiting-permission';
  ui.render(next);
  ui.all('select')[2].value = 'option:a';
  ui.all('select')[2].fire('change');
  assert.equal(ui.action('submitAnswers').disabled, false);
  next.questionInteraction.questions[2].source.resultId = 'other-result';
  ui.render(next);
  assert.equal(ui.action('submitAnswers').disabled, true);
  await ui.all('form')[0].fire('submit');
  assert.equal(ui.calls.answers.length, 2);
});

test('option-only questions have no free-text input and unknown option IDs never become answers', async () => {
  const view = projection();
  view.questionInteraction.questions = [view.questionInteraction.questions[0]];
  view.questionInteraction.questions[0].allowFreeform = false;
  const ui = fixture(view);
  assert.equal(ui.all('textarea').length, 0);
  assert.equal(ui.all('option').some((option) => option.value === 'freeform'), false);
  ui.all('select')[0].value = 'freeform';
  await ui.all('form')[0].fire('submit');
  assert.deepEqual(ui.calls.answers, []);
  ui.all('select')[0].value = 'option:a';
  await ui.all('form')[0].fire('submit');
  assert.deepEqual(ui.calls.answers[0].answers, [
    { questionId: 'one', sourceResultId: 'result-1', kind: 'option', value: 'a' },
  ]);
});

test('live snapshots preserve question DOM, draft, focus, caret and details disclosure', () => {
  const ui = fixture();
  const form = ui.all('form')[0];
  const textarea = ui.all('textarea')[0];
  textarea.value = 'unsent draft';
  textarea.selectionStart = 3;
  textarea.selectionEnd = 7;
  textarea.focus();
  textarea.fire('input');
  ui.all('details')[0].open = true;
  for (let count = 0; count < 5; count++) {
    const next = structuredClone(ui.view);
    next.questionInteraction.questions[0].source =
      Object.fromEntries(Object.entries(next.questionInteraction.questions[0].source).reverse());
    next.queue.push({ id: `queued-${count}`, message: 'New message', kind: 'ordinary', status: 'waiting', priority: false });
    ui.render(next);
  }
  assert.equal(ui.all('form')[0], form);
  assert.equal(ui.all('textarea')[0], textarea);
  assert.equal(textarea.value, 'unsent draft');
  assert.equal(ui.document.activeElement, textarea);
  assert.equal(textarea.selectionStart, 3);
  assert.equal(textarea.selectionEnd, 7);
  assert.equal(ui.all('details')[0].open, true);
});

test('retired form closures cannot submit for a replacement result or changed definition', async () => {
  const ui = fixture();
  ui.all('select')[0].value = 'option:a';
  const oldForm = ui.all('form')[0];
  const oldButton = ui.action('submitAnswers');
  ui.render(projection('reviewer', 'result-2'));
  assert.equal(oldButton.disabled, true);
  await oldForm.fire('submit');
  assert.deepEqual(ui.calls.answers, []);
  assert.equal(ui.all('select')[0].value, '');
  ui.all('textarea')[1].value = 'keep this unchanged question draft';
  ui.all('textarea')[1].fire('input');
  const secondForm = ui.all('form')[0];
  const next = projection('reviewer', 'result-2');
  next.questionInteraction.questions[0].question = 'Replacement definition?';
  ui.render(next);
  await secondForm.fire('submit');
  assert.deepEqual(ui.calls.answers, []);
  assert.equal(ui.all('textarea')[1].value, 'keep this unchanged question draft');
});

test('mismatched question source and duplicate question identity fail closed', async () => {
  for (const mutate of [
    (view) => { view.questionInteraction.questions[0].source.resultId = 'wrong-result'; },
    (view) => { view.questionInteraction.questions[0].source.role = 'reviewer'; },
    (view) => { view.questionInteraction.questions[0].source.requestId = 'wrong-request'; },
    (view) => { view.questionInteraction.questions[0].source.design = { revisionId: 'other', digest: 'other' }; },
    (view) => { view.questionInteraction.questions[0].source.cycleId = 'wrong-cycle'; },
    (view) => { view.questionInteraction.questions[1].id = 'one'; },
  ]) {
    const view = projection();
    mutate(view);
    const ui = fixture(view);
    ui.all('select')[0].value = 'option:a';
    ui.all('select')[0].fire('change');
    assert.equal(ui.action('submitAnswers').disabled, true);
    await ui.all('form')[0].fire('submit');
    assert.deepEqual(ui.calls.answers, []);
    assert.match(ui.container.textContent, /sources do not match/);
  }
});

test('current authoritative gates and callbacks supersede old snapshots; Stop works during Q&A', async () => {
  const ui = fixture();
  ui.render(ui.view, { busy: true });
  assert.equal(ui.action('stop').disabled, false);
  assert.equal(ui.action('submitAnswers').disabled, true);
  await ui.action('stop').fire('click');
  assert.equal(ui.calls.stop, 1);
  assert.match(ui.container.textContent, /Stop after current step asks the current agent to cease further work/);
  assert.match(ui.container.textContent, /Queued requests are discarded; code and completed results are retained/);
  assert.match(ui.container.textContent, /Already-admitted tools or permissions may still finish/);
  assert.match(ui.container.textContent, /requested outcome may remain incomplete/);
  assert.doesNotMatch(ui.container.textContent, /may continue editing|lets the current agent turn.*finish/);
  const next = structuredClone(ui.view);
  next.canStop = false;
  next.questionInteraction.canAnswer = false;
  ui.render(next);
  await ui.action('stop').fire('click');
  assert.equal(ui.calls.stop, 1);
  ui.all('select')[0].value = 'option:a';
  await ui.all('form')[0].fire('submit');
  assert.deepEqual(ui.calls.answers, []);
  const currentCalls = [];
  ui.render(ui.view, {}, { ...ui.actions, submitAnswers: (batch) => currentCalls.push(batch) });
  await ui.all('form')[0].fire('submit');
  assert.equal(currentCalls.length, 1);
  assert.deepEqual(ui.calls.answers, []);
  assert.ok(ui.all('button').every((button) => !/approv|apply/i.test(button.textContent)));
});

test('failed and in-flight submissions retain drafts and cannot submit duplicate envelopes', async () => {
  let reject;
  const ui = fixture(projection(), { submitAnswers: () => new Promise((_, failure) => { reject = failure; }) });
  const textarea = ui.all('textarea')[0];
  textarea.value = 'retry draft';
  textarea.fire('input');
  const pending = ui.all('form')[0].fire('submit');
  assert.equal(ui.action('submitAnswers').disabled, true);
  await ui.all('form')[0].fire('submit');
  ui.render(structuredClone(ui.view));
  reject(new Error('Delivery failed'));
  await pending;
  assert.equal(textarea.value, 'retry draft');
  assert.equal(ui.action('submitAnswers').disabled, false);
  assert.match(ui.container.textContent, /Delivery failed/);
});

test('old async completion cannot clear a replacement interaction draft', async () => {
  let resolveAnswer;
  const ui = fixture(projection(), { submitAnswers: () => new Promise((done) => { resolveAnswer = done; }) });
  ui.all('textarea')[0].value = 'old draft';
  ui.all('textarea')[0].fire('input');
  const pending = ui.all('form')[0].fire('submit');
  ui.render(projection('reviewer', 'result-2'));
  ui.all('textarea')[0].value = 'new draft';
  ui.all('textarea')[0].fire('input');
  resolveAnswer();
  await pending;
  assert.equal(ui.all('textarea')[0].value, 'new draft');
  assert.equal(ui.action('submitAnswers').disabled, false);
});

test('100% internal progress never invents whole Review or whole-plan completion', () => {
  const view = projection();
  view.currentCycle = { id: 'cycle-1', phase: 'implementing', completed: 1, total: 1,
    plan: { id: 'plan-1', version: 2, goal: 'Internal goal',
      tasks: [{ id: 'task-1', title: 'Technical task', scope: ['src/file.ts'], dependsOn: [],
        criteria: [{ id: 'criterion-1', description: 'Check behavior' }] }] },
    tasks: [{ id: 'task-1', title: 'Technical task', status: 'completed' }] };
  const ui = fixture(view);
  assert.match(ui.container.textContent, /1 \/ 1 internal tasks completed/);
  assert.match(ui.container.textContent, /not per-item formal Review or whole-plan completion/);
  assert.doesNotMatch(ui.container.textContent, /No findings reported/);
  const technical = ui.all('details').find((node) => /Technical details/.test(node.textContent));
  assert.equal(technical.open, false);
  assert.match(technical.textContent, /src\/file.ts/);
  assert.match(technical.textContent, /Check behavior/);
  technical.open = true;
  ui.render(structuredClone(view));
  assert.equal(ui.all('details').find((node) => /Technical details/.test(node.textContent)).open, true);
  view.lastHandoff = { id: 'review-1', role: 'reviewer', kind: 'review-result', summary: 'Review complete',
    findings: [], verificationLimits: ['Integration tests were not run'] };
  ui.render(view);
  assert.match(ui.container.textContent, /No findings reported in this Whole Review/);
  assert.match(ui.container.textContent, /not a claim of complete verification/);
  assert.match(ui.container.textContent, /Integration tests were not run/);
  view.lastHandoff.findings = [{ id: 'finding-1', summary: 'Broken behavior',
    consequence: 'Request could fail', evidenceRefs: ['src/file.ts:12'] }];
  ui.render(view);
  assert.match(ui.container.textContent, /1 Review finding/);
  assert.match(ui.container.textContent, /Request could fail/);
  assert.match(ui.container.textContent, /src\/file.ts:12/);
  view.lastHandoff.kind = 'execution-failure';
  view.lastHandoff.findings = [];
  ui.render(view);
  assert.doesNotMatch(ui.container.textContent, /No findings reported/);
});

test('user input, permission, unknown execution and pending presentation remain distinct', () => {
  const ui = fixture();
  ui.all('select')[0].value = 'option:a';
  ui.all('select')[0].fire('change');
  for (const [status, label] of [
    ['waiting-answer', 'Waiting for your answers'],
    ['working', 'Working'],
    ['waiting-permission', 'Waiting for permission'],
    ['execution-unknown', 'Execution state unknown'],
    ['presentation-pending', 'Result presentation pending'],
    ['stopping', 'Stopping after current step'], ['closed', 'Closed'],
  ]) {
    ui.render({ ...ui.view, status });
    assert.equal(ui.all('h2')[0].textContent, label);
    assert.equal(ui.action('submitAnswers').disabled,
      !['waiting-answer', 'working', 'waiting-permission'].includes(status));
  }
});

test('all untrusted copy is literal text; unavailable and unsupported views retire form handlers', async () => {
  const view = projection();
  const attack = '<img src=x onerror="globalThis.attacked=true"><script>alert(1)</script>';
  view.reason = attack;
  view.questionInteraction.questions[0].question = attack;
  view.questionInteraction.questions[0].options[0].label = attack;
  view.queue[0].message = attack;
  const ui = fixture(view);
  assert.ok(ui.container.textContent.includes(attack));
  assert.equal(ui.all('img').length, 0);
  ui.all('select')[0].value = 'option:a';
  const oldForm = ui.all('form')[0];
  ui.render(null);
  assert.equal(ui.container.hidden, true);
  await oldForm.fire('submit');
  assert.deepEqual(ui.calls.answers, []);
  ui.render({ ...view, schemaVersion: 'unsupported' });
  assert.match(ui.container.textContent, /Unsupported human-loop view/);
  await oldForm.fire('submit');
  assert.deepEqual(ui.calls.answers, []);
});

test('real Edge retains textarea focus/caret and source safety across live snapshots',
  { skip: !browserAvailable, timeout: 60_000 }, async (t) => {
    const scratch = resolve(`.human-loop-browser-${process.pid}-${Date.now()}`);
    await mkdir(scratch);
    const previousEnvironment = Object.fromEntries(['TEMP', 'TMP', 'TMPDIR'].map((name) => [name, process.env[name]]));
    // Keep the existing helper's browser profile inside this checkout, never in the OS temp directory.
    for (const name of Object.keys(previousEnvironment)) process.env[name] = scratch;
    let browser;
    try { browser = await openFixtureBrowser(t); }
    finally {
      t.after(() => rm(scratch, { recursive: true, force: true, maxRetries: 15, retryDelay: 200 }));
      for (const [name, value] of Object.entries(previousEnvironment)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
    const renderer = await readFile(new URL('../public/renderers/human-loop.js', import.meta.url));
    const decisions = await readFile(new URL('../public/review-decisions.js', import.meta.url));
    const questionPresentation = await readFile(new URL('../public/question-presentation.js', import.meta.url));
    const css = await readFile(new URL('../public/renderers/human-loop.css', import.meta.url));
    const server = createServer((request, response) => {
      const resource = {
        '/human-loop.js': ['text/javascript', renderer],
        '/review-decisions.js': ['text/javascript', decisions],
        '/question-presentation.js': ['text/javascript', questionPresentation],
        '/human-loop.css': ['text/css', css],
        '/': ['text/html', '<!doctype html><link rel="stylesheet" href="/human-loop.css"><main id="fixture"></main>'],
      }[request.url];
      response.writeHead(resource ? 200 : 404, { 'Content-Type': resource?.[0] ?? 'text/plain' });
      response.end(resource?.[1] ?? 'Not found');
    });
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    t.after(() => new Promise((done) => { server.closeAllConnections(); server.close(done); }));
    await browser.call('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
    await browser.waitFor('!!document.getElementById("fixture")');
    await browser.evaluate(`(async () => {
      window.renderHumanLoop = (await import('/human-loop.js')).renderHumanLoop;
      window.view = ${JSON.stringify(projection())};
      window.batches = []; window.stops = 0;
      window.actions = {submitAnswers: batch => batches.push(batch), stop: () => stops++, refresh: () => {}};
      window.container = document.getElementById('fixture');
      renderHumanLoop(container, {view}, actions);
      window.firstForm = container.querySelector('form');
      window.draft = container.querySelector('textarea');
      draft.value = 'draft with caret'; draft.dispatchEvent(new Event('input'));
      draft.focus(); draft.setSelectionRange(3, 8);
      window.oldButton = container.querySelector('[data-human-loop-action="submitAnswers"]');
      for (let index = 0; index < 10; index++) renderHumanLoop(container, {view: structuredClone(view)}, actions);
    })()`);
    assert.deepEqual(await browser.evaluate(`({
      sameForm: firstForm === container.querySelector('form'),
      sameTextarea: draft === container.querySelector('textarea'),
      focused: document.activeElement === draft, value: draft.value,
      start: draft.selectionStart, end: draft.selectionEnd,
      forbiddenButtons: [...container.querySelectorAll('button')].some(button => /approv|apply/i.test(button.textContent))
    })`), {
      sameForm: true, sameTextarea: true, focused: true, value: 'draft with caret',
      start: 3, end: 8, forbiddenButtons: false,
    });
    await browser.evaluate(`(() => {
      container.querySelectorAll('select')[1].value = 'option:b';
      container.querySelectorAll('select')[1].dispatchEvent(new Event('change'));
      container.querySelector('form').requestSubmit();
    })()`);
    assert.deepEqual(await browser.evaluate('batches'), [{
      schemaVersion: 'human-question-answers/v1', answers: [
        { questionId: 'one', sourceResultId: 'result-1', kind: 'freeform', value: 'draft with caret' },
        { questionId: 'two', sourceResultId: 'result-1', kind: 'option', value: 'b' },
      ],
    }]);
    await browser.evaluate(`(() => {
      view = ${JSON.stringify(projection('reviewer', 'result-2'))};
      view.questionInteraction.questions[0].question = '<img src=x onerror="window.attacked=true">';
      renderHumanLoop(container, {view, busy: true}, actions);
      container.querySelector('[data-human-loop-action="stop"]').click();
      firstForm.dispatchEvent(new Event('submit', {cancelable: true}));
    })()`);
    assert.deepEqual(await browser.evaluate(`({
      stops, retiredDisabled: oldButton.disabled, batchCount: batches.length,
      images: container.querySelectorAll('img').length,
      escapedText: container.textContent.includes('<img src=x onerror="window.attacked=true">'),
      attacked: !!window.attacked
    })`), { stops: 1, retiredDisabled: true, batchCount: 1, images: 0, escapedText: true, attacked: false });
    assert.deepEqual(browser.exceptions, []);
  });
