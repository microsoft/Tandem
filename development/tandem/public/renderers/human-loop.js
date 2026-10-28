import { decisionSections, technicalFindings, reviewCoverageText, emptyReviewSection } from '../review-decisions.js';
import { renderQuestionMeaning, questionMeaning, questionStatus } from '../question-presentation.js';
import { installComposerEnter } from '../composer-enter.js';

const instances = new WeakMap();
let questionTitleSequence = 0;
const roles = new Set(['router', 'designer', 'planner', 'implementer', 'reviewer', 'agent']);
const statusLabels = {
  ready: 'Ready',
  working: 'Working',
  'waiting-answer': 'Waiting for your answers',
  'waiting-permission': 'Waiting for permission',
  'waiting-confirmation': 'Waiting for implementation confirmation',
  stopping: 'Stopping after current step',
  'execution-unknown': 'Execution state unknown',
  'presentation-pending': 'Result presentation pending',
  closed: 'Closed',
};

function element(document, tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function binding(source) {
  return [source?.role, source?.requestId, source?.cycleId,
    source?.design?.revisionId, source?.design?.digest];
}

function questionKey(question) {
  return JSON.stringify([question.id, question.context, question.question, question.whyItMatters,
    question.importance, question.options.map(({ id, label, implication, resolutionTarget }) => [id, label, implication, resolutionTarget]),
    question.allowFreeform, binding(question.source), question.source.resultId,
    question.source.requestIds, question.source.planDigest, question.designRefs ?? [], question.unanswered ?? null]);
}

function appendDesignReferences(state, node, references, design) {
  if (!references?.length) return;
  const make = (tag, text) => element(state.document, tag, text);
  const details = make('details'); details.append(make('summary', 'Design references'));
  for (const reference of references) {
    const button = make('button', reference); button.type = 'button'; button.className = 'design-reference';
    button.dataset.designReference = reference;
    button.disabled = !design || typeof state.actions.inspectReference !== 'function';
    button.addEventListener('click', () => {
      if (!button.disabled && button.isConnected !== false) state.actions.inspectReference(design, reference);
    });
    details.append(button);
  }
  node.append(details);
}

function interactionKey(interaction) {
  return interaction ? JSON.stringify([interaction.resultId, binding(interaction.source),
    interaction.questions.map(questionKey)]) : null;
}

function validSource(interaction) {
  const expected = JSON.stringify(binding(interaction.source));
  const ids = new Set();
  return interaction.questions.every((question) => {
    if (ids.has(question.id)) return false;
    ids.add(question.id);
    return question.source.resultId === interaction.resultId
      && JSON.stringify(binding(question.source)) === expected;
  });
}

function currentQuestions(interaction, includeHistory = false) {
  if (!interaction || !validSource(interaction)) return interaction;
  // Retain open blockers regardless of the active role/request. Only an exact,
  // validated source binding and explicit invalidation make a question historical.
  const questions = interaction.questions.filter(question => includeHistory || question.state !== 'invalidated');
  return questions.length ? { ...interaction, questions } : null;
}

function selectedAnswer(row, question, resultId) {
  if (question.state !== 'open') return null;
  if (row.select.value === 'freeform' && question.allowFreeform && row.textarea.value.trim()) {
    return { questionId: question.id, sourceResultId: resultId, kind: 'freeform', value: row.textarea.value };
  }
  const option = question.options.find(({ id }) => row.select.value === `option:${id}`);
  return option ? { questionId: question.id, sourceResultId: resultId, kind: 'option', value: option.id } : null;
}

function answersFor(state, form) {
  const interaction = state.view?.questionInteraction;
  if (!interaction || state.form !== form || interactionKey(interaction) !== form.key
    || !validSource(interaction)) return [];
  return interaction.questions.flatMap((question, index) => {
    const answer = selectedAnswer(form.rows[index], question, interaction.resultId);
    return answer ? [answer] : [];
  });
}

function canAnswer(state, form) {
  const interaction = state.view?.questionInteraction;
  return state.form === form && !state.busy && !form.pending
    && ['ready', 'waiting-answer', 'working', 'waiting-permission'].includes(state.view?.status) && interaction?.canAnswer
    && interactionKey(interaction) === form.key && validSource(interaction)
    && typeof state.actions.submitAnswers === 'function';
}

function recordedAnswerText(state, question, resultId) {
  const submitted = state.answerDetails.findLast(answer => answer.questionId === question.id
    && answer.sourceResultId === resultId
    && (!question.answerRequestId || answer.answerRequestId === question.answerRequestId));
  if (submitted) return `Submitted answer: ${submitted.answer}${question.invalidation?.reason ? `\n${question.invalidation.reason}` : ''}`;
  return question.state === 'answered'
    ? 'Answered. The submitted answer is retained in Conversation.'
    : question.invalidation?.reason ?? `This question is ${question.state}; no answer is inferred.`;
}

function updateForm(state) {
  const form = state.form;
  if (!form) return;
  const enabled = canAnswer(state, form);
  form.rows.forEach((row, index) => {
    const question = state.view.questionInteraction.questions[index];
    row.fieldset.disabled = !state.workspace && (!enabled || question.state !== 'open');
    row.select.disabled = row.textarea.disabled = !enabled || question.state !== 'open';
    row.fieldset.dataset.questionState = question.state;
    renderQuestionMeaning(row.meaning, question);
    row.status.textContent = questionStatus(question);
    const closed = question.state !== 'open';
    row.controls.hidden = closed;
    row.answer.hidden = !closed;
    row.answer.textContent = recordedAnswerText(state, question, state.view.questionInteraction.resultId);
    if (row.closed !== closed && (!state.workspace || row.closed === undefined)) row.context.open = !closed;
    row.closed = closed;
  });
  const completed = state.view.questionInteraction.questions.every(question => question.state !== 'open');
  const unanswered = state.view.questionInteraction.questions.filter(q => q.state === 'open');
  form.groupSummary.textContent = `${state.view.questionInteraction.source.role}: ${unanswered.length} unanswered`
    + `, ${unanswered.filter(q => q.blockingActive).length} blockers`;
  form.node.dataset.completed = String(completed);
  form.help.hidden = completed;
  form.submit.hidden = completed;
  form.submit.disabled = !enabled || !answersFor(state, form).length;
  form.submit.textContent = form.pending ? 'Sending answers…' : 'Send selected answers';
  form.sourceError.hidden = validSource(state.view.questionInteraction);
  form.errorNode.hidden = !form.error;
  form.errorNode.textContent = form.error ?? '';
  state.refreshWorkspace?.();
}

function retireForm(form) {
  if (!form) return;
  form.submit.disabled = true;
  for (const row of form.rows) row.fieldset.disabled = true;
}

function createForm(state, interaction, previous) {
  const { document } = state;
  const make = (tag, text, css) => element(document, tag, text, css);
  const form = { key: interactionKey(interaction), rows: [], pending: false, node: make('form') };
  form.groupNode = make('details', undefined, 'human-loop-question-group');
  form.groupSummary = make('summary');
  form.groupNode.open = interaction.questions.some(q => q.state === 'open' && q.blockingActive);
  form.groupNode.append(form.groupSummary, form.node);
  form.node.className = 'human-loop-questions';
  form.node.dataset.sourceResultId = interaction.resultId;
  form.node.dataset.sourceRequestId = interaction.source.requestId;
  form.node.dataset.role = roles.has(interaction.source.role) ? interaction.source.role : 'agent';
  form.help = make('p', 'Send any selected answers; unselected questions stay unanswered. Ordinary messages do not resolve questions.', 'human-loop-question-help');
  form.node.append(make('h3', `Questions from ${interaction.source.role}`), form.help);
  const source = make('details');
  source.append(make('summary', 'Question source'),
    make('p', `Role: ${interaction.source.role} · Result: ${interaction.resultId}`),
    make('p', `Request: ${interaction.source.requestId} · Cycle: ${interaction.source.cycleId ?? 'none'}`),
    make('p', `Design revision: ${interaction.source.design?.revisionId ?? 'none'} · Digest: ${interaction.source.design?.digest ?? 'none'}`));
  form.node.append(source);
  if (typeof state.actions.inspectQuestionSource === 'function') {
    const original = make('button', 'Show original message');
    original.type = 'button';
    original.addEventListener('click', () => state.actions.inspectQuestionSource(interaction.resultId, interaction.source.requestId));
    form.node.append(original);
  }
  form.sourceError = make('p', 'Question sources do not match the current interaction. Refresh before answering.', 'human-loop-error');
  form.sourceError.setAttribute('role', 'alert');
  form.node.append(form.sourceError);
  for (const question of interaction.questions) {
    const key = questionKey(question);
    const fieldset = make('fieldset');
    fieldset.dataset.questionId = question.id;
    const title = make('h4', question.question, 'human-loop-question-title');
    title.id = `human-loop-question-title-${++questionTitleSequence}`;
    fieldset.setAttribute('aria-labelledby', title.id);
    const status = make('p', '', 'human-loop-question-status');
    const meaning = make('span');
    const answer = make('p', '', 'human-loop-submitted-answer');
    answer.hidden = true;
    const controls = make('div', undefined, 'human-loop-question-controls');
    const context = make('details', undefined, 'human-loop-question-context');
    context.append(make('summary', 'Context and options'),
      make('p', question.context, 'human-loop-question-help'),
      make('p', `Why it matters: ${question.whyItMatters}`, 'human-loop-question-help'));
    appendDesignReferences(state, context, question.designRefs, question.source.design);
    fieldset.append(title, meaning, status, answer, ...(state.workspace ? [context, controls] : [controls, context]));
    const selectLabel = make('label', 'Answer choice');
    const select = make('select');
    select.setAttribute('aria-label', `Answer choice: ${question.question}`);
    const blank = make('option', 'Leave unanswered');
    blank.value = '';
    select.append(blank);
    for (const option of question.options) {
      const node = make('option', option.label);
      node.value = `option:${option.id}`;
      select.append(node);
    }
    if (question.allowFreeform) {
      const freeform = make('option', 'Write my own answer');
      freeform.value = 'freeform';
      select.append(freeform);
    }
    selectLabel.append(select);
    controls.append(selectLabel);
    const implications = make('ul');
    for (const option of question.options) {
      implications.append(make('li', `${option.label}: ${option.implication}`));
    }
    context.append(implications);
    const textarea = make('textarea');
    if (question.allowFreeform) {
      const label = make('label', 'Your own answer (typing selects free text)');
      textarea.rows = 3;
      textarea.setAttribute('aria-label', `Your own answer: ${question.question}`);
      textarea.title = 'Enter to send; Ctrl+Enter for a new line.';
      textarea.setAttribute('aria-keyshortcuts', 'Enter');
      installComposerEnter(textarea, form.node, () => canAnswer(state, form) && !form.submit.disabled);
      label.append(textarea);
      controls.append(label);
    }
    const prior = previous?.resultId === interaction.resultId
      ? previous.rows.find((row) => row.key === key) : null;
    if (prior) {
      select.value = prior.select.value;
      textarea.value = prior.textarea.value;
    }
    const row = { key, fieldset, meaning, status, select, textarea, controls, context, answer, title };
    form.rows.push(row);
    select.addEventListener('change', () => {
      if (state.form === form) updateForm(state);
    });
    textarea.addEventListener('input', () => {
      if (state.form !== form) return;
      select.value = textarea.value.length ? 'freeform' : '';
      updateForm(state);
    });
    form.node.append(fieldset);
  }
  form.resultId = interaction.resultId;
  form.submit = make('button', 'Send selected answers');
  form.submit.type = 'submit';
  form.submit.dataset.humanLoopAction = 'submitAnswers';
  form.errorNode = make('p', '', 'human-loop-error');
  form.errorNode.setAttribute('role', 'alert');
  form.batch = make('section', undefined, 'question-batch');
  form.batch.hidden = true;
  if (state.workspace) form.node.append(form.help);
  form.node.append(form.errorNode, form.batch, form.submit);
  form.node.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!canAnswer(state, form)) return;
    const answers = answersFor(state, form);
    if (!answers.length) return;
    form.pending = true;
    form.error = null;
    updateForm(state);
    try {
      await state.actions.submitAnswers({ schemaVersion: 'human-question-answers/v1', answers });
      if (state.form !== form) return;
      for (const answer of answers) {
        const index = state.view.questionInteraction.questions.findIndex(({ id }) => id === answer.questionId);
        const row = form.rows[index];
        const current = selectedAnswer(row, state.view.questionInteraction.questions[index], form.resultId);
        if (JSON.stringify(current) === JSON.stringify(answer)) {
          row.select.value = '';
          if (answer.kind === 'freeform') row.textarea.value = '';
        }
      }
    } catch (error) {
      if (state.form === form) form.error = error instanceof Error ? error.message : String(error);
    } finally {
      form.pending = false;
      if (state.form === form) {
        updateForm(state);
      }
    }
  });
  return form;
}

function updateError(state) {
  const error = state.error ?? state.localError;
  state.errorNode.hidden = !error;
  state.errorNode.textContent = error ? String(error) : '';
}

export function renderCycleProgress(container, cycle, inspectReference) {
  renderCycle({ document: container.ownerDocument, cycle: container, actions: { inspectReference } }, cycle);
}

function renderCycle(state, cycle) {
  const make = (tag, text, css) => element(state.document, tag, text, css);
  state.cycle.hidden = !cycle;
  if (!cycle) return;
  const detailsOpen = state.cycle.querySelector('details')?.open ?? false;
  const details = make('details');
  details.open = detailsOpen;
  details.append(make('summary', 'Technical details — internal plan and tasks'),
    make('p', `Cycle: ${cycle.id} · Phase: ${cycle.phase}`));
  if (cycle.plan) {
    details.append(make('p', `Plan: ${cycle.plan.id} · Version: ${cycle.plan.version}`), make('p', cycle.plan.goal));
    const tasks = make('ol');
    for (const task of cycle.plan.tasks) {
      const item = make('li');
      item.append(make('strong', task.title),
        make('p', `Task: ${task.id} · Depends on: ${task.dependsOn.join(', ') || 'none'}`),
        make('p', `Scope: ${task.scope.join(', ')}`));
      appendDesignReferences(state, item, task.designRefs, cycle.plan.design);
      const criteria = make('ul');
      for (const criterion of task.criteria) criteria.append(make('li', `${criterion.id}: ${criterion.description}`));
      item.append(criteria);
      tasks.append(item);
    }
    details.append(tasks);
  }
  const progress = make('ul');
  for (const task of cycle.tasks) progress.append(make('li', `${task.title} · ${task.status}`));
  details.append(progress);
  if (cycle.implementation) {
    const receipt = make('section');
    receipt.dataset.implementationResult = cycle.implementation.resultId;
    receipt.tabIndex = -1;
    receipt.append(make('h4', 'Implementation result'), make('p', cycle.implementation.summary),
      make('p', `Result: ${cycle.implementation.resultId}`));
    const references = make('ul');
    for (const reference of cycle.implementation.evidenceRefs) references.append(make('li', reference));
    receipt.append(references); details.append(receipt);
  }
  state.cycle.replaceChildren(make('h3', 'Internal task progress'),
    make('p', `${cycle.completed} / ${cycle.total} internal tasks completed`),
    make('p', 'Task progress is not per-item formal Review or whole-plan completion. Whole Review is reported separately.', 'human-loop-muted'),
    details);
}

function renderHandoff(state, handoff) {
  const make = (tag, text, css) => element(state.document, tag, text, css);
  state.handoff.hidden = !handoff;
  if (!handoff) return;
  const review = handoff.role === 'reviewer' && handoff.kind === 'review-result';
  if (state.summaryInConversation && !review && !handoff.findings.length
    && !handoff.verificationLimits.length && !handoff.designRefs?.length) {
    state.handoff.hidden = true;
    state.handoff.replaceChildren();
    return;
  }
  const nodes = [make('h3', review ? 'Whole Review' : `Latest result · ${handoff.role}`)];
  if (review && handoff.reviewFormat) {
    const current = handoff.reviewFormat === 'decision-review/v2';
    if (current) nodes.push(make('p', reviewCoverageText(handoff)));
    for (const { kind, title, findings } of decisionSections(handoff)) {
      const section = make('section');
      section.dataset.reviewCategory = kind;
      section.append(make('h4', title));
      if (!findings.length) section.append(make('p', emptyReviewSection(handoff)));
      for (const finding of findings) {
        const item = make('article', undefined, 'human-loop-finding');
        item.append(make('strong', finding.summary), make('p', `Design basis: ${finding.designBasis}`),
          make('p', `Material impact: ${finding.consequence}`));
        const evidence = make('ul');
        for (const ref of finding.evidenceRefs) evidence.append(make('li', ref));
        item.append(evidence, make('p', `Resolve using question ${finding.questionId} in the question form.`));
        appendDesignReferences(state, item, finding.designRefs, handoff.design);
        section.append(item);
      }
      nodes.push(section);
    }
    if (!current) nodes.push(make('p', 'None means no substantiated decision in that category, not complete verification.', 'human-loop-muted'));
    const diagnostics = technicalFindings(handoff);
    if (diagnostics.length || handoff.verificationLimits.length) {
      const details = make(current ? 'section' : 'details');
      details.append(make(current ? 'h4' : 'summary', current ? 'Coverage and limitations'
        : `Technical/verification evidence (${diagnostics.length} diagnostics, ${handoff.verificationLimits.length} limitations)`));
      for (const finding of diagnostics) {
        const item = make('article', undefined, 'human-loop-finding');
        item.append(make('strong', finding.summary), make('p', finding.consequence),
          make('p', `Evidence: ${finding.evidenceRefs.join('; ')}`));
        appendDesignReferences(state, item, finding.designRefs, handoff.design);
        details.append(item);
      }
      for (const limit of handoff.verificationLimits) details.append(make('p', `${current ? 'Coverage / limitation' : 'Verification limit'}: ${limit}`));
      nodes.push(details);
    }
    state.handoff.dataset.role = 'reviewer';
    state.handoff.replaceChildren(...nodes);
    return;
  }
  if (!state.summaryInConversation) nodes.push(make('p', handoff.summary));
  if (review) nodes.push(make('p', handoff.findings.length
    ? `${handoff.findings.length} Review finding(s) reported`
    : 'No findings reported in this Whole Review. This is not a claim of complete verification.'));
  for (const finding of handoff.findings) {
    const item = make('article', undefined, 'human-loop-finding');
    item.append(make('h4', finding.summary), make('p', `Consequence: ${finding.consequence}`));
    const evidence = make('ul');
    for (const ref of finding.evidenceRefs) evidence.append(make('li', ref));
    item.append(evidence);
    appendDesignReferences(state, item, finding.designRefs, handoff.design);
    nodes.push(item);
  }
  if (handoff.verificationLimits.length) {
    nodes.push(make('h4', 'Verification limits'));
    const limits = make('ul');
    for (const limit of handoff.verificationLimits) limits.append(make('li', limit));
    nodes.push(limits);
  }
  state.handoff.dataset.role = roles.has(handoff.role) ? handoff.role : 'agent';
  state.handoff.replaceChildren(...nodes);
  appendDesignReferences(state, state.handoff, handoff.designRefs, handoff.design);
}

function createState(container) {
  const document = container.ownerDocument;
  const make = (tag, text, css) => element(document, tag, text, css);
  const root = make('section', undefined, 'human-loop');
  root.setAttribute('aria-label', 'Human loop');
  const status = make('h2');
  status.setAttribute('aria-live', 'polite');
  const reason = make('p');
  const role = make('p', '', 'human-loop-muted');
  const errorNode = make('p', '', 'human-loop-error');
  errorNode.setAttribute('role', 'alert');
  const cycle = make('section');
  const questions = make('section');
  const handoff = make('section');
  const queue = make('section');
  const controls = make('div', undefined, 'human-loop-actions');
  const state = { document, root, status, reason, role, errorNode, cycle, questions, handoff, queue,
    actions: {}, forms: new Map(), localError: null };
  for (const [name, label] of [['stop', 'Stop after current step'], ['refresh', 'Refresh status'], ['discuss', 'Discuss']]) {
    const button = make('button', label);
    button.type = 'button';
    button.dataset.humanLoopAction = name;
    button.addEventListener('click', async () => {
      if (button.disabled || button.hidden || !state.view || typeof state.actions[name] !== 'function') return;
      if (name === 'stop' && !state.view.canStop) return;
      try {
        state.localError = null;
        updateError(state);
        await state.actions[name]();
      } catch (error) {
        state.localError = error instanceof Error ? error.message : String(error);
        updateError(state);
      }
    });
    state[name] = button;
    controls.append(button);
  }
  root.append(status, role, reason, errorNode,
    make('p', 'Only effective prerequisites and their pending answer processing hold ordinary work. Advisory questions can be answered later. Blocking answers have FIFO priority; each submitted batch remains a separate request. The backend determines queue order.', 'human-loop-muted human-loop-guidance'),
    questions, cycle, handoff, queue,
    make('p', 'Stop after current step asks the current agent to cease further work, then waits for its verified settlement. Already-admitted tools or permissions may still finish; the requested outcome may remain incomplete. No next step starts. Queued requests are discarded; code and completed results are retained.', 'human-loop-muted human-loop-guidance'),
    controls);
  container.replaceChildren(root);
  return state;
}

function renderQuestions(state, interactions) {
  const nodes = [];
  const retained = new Set();
  for (const raw of interactions) {
    const interaction = currentQuestions(raw, state.questionWorkspace);
    if (!interaction) continue;
    retained.add(interaction.resultId);
    let group = state.forms.get(interaction.resultId);
    if (!group) {
      group = { document: state.document, form: null };
      state.forms.set(interaction.resultId, group);
    }
    Object.assign(group, { view: { ...state.view, questionInteraction: interaction }, actions: state.actions,
      busy: state.busy, answerDetails: state.answerDetails, workspace: state.questionWorkspace });
    const key = interactionKey(interaction);
    if (group.form?.key !== key) {
      const previous = group.form;
      retireForm(previous);
      group.form = createForm(group, interaction, previous);
    }
    updateForm(group);
    nodes.push(group.form.groupNode);
  }
  for (const [id, group] of state.forms) if (!retained.has(id)) {
    retireForm(group.form); group.form = null; group.view = null; state.forms.delete(id);
  }
  if (state.questionWorkspace) {
    if (!state.navigation) state.navigation = createQuestionNavigation(state);
    nodes.unshift(state.navigation.node);
    for (const group of state.forms.values()) group.refreshWorkspace = () => updateQuestionNavigation(state);
    updateQuestionNavigation(state);
  }
  const current = [...state.questions.children];
  if (current.length !== nodes.length || current.some((node, index) => node !== nodes[index])) {
    const focused = state.document.activeElement;
    const restore = nodes.some(node => node.contains?.(focused));
    state.questions.replaceChildren(...nodes);
    if (restore) focused.focus({ preventScroll: true });
  }
  state.questions.hidden = nodes.length === 0;
}

function createQuestionNavigation(state) {
  const make = (tag, text, css) => element(state.document, tag, text, css);
  const node = make('nav', undefined, 'question-navigation');
  node.setAttribute('aria-label', 'Choose a question');
  const openSection = make('section', undefined, 'question-open');
  const openList = make('ul', undefined, 'question-list question-open-list');
  openSection.setAttribute('aria-label', 'Open questions');
  openSection.append(make('h3', 'Open questions'), openList);
  const history = make('details', undefined, 'question-history');
  const summary = make('summary', 'Answered history');
  const historyList = make('ul', undefined, 'question-list question-history-list');
  history.append(summary, historyList);
  const empty = make('p', 'Select a question to read its context and options.', 'human-loop-muted');
  node.append(openSection, history, empty);
  const select = key => {
    state.selectedQuestion = key;
    updateQuestionNavigation(state);
    const selected = [...state.forms.values()].flatMap(group => group.form.rows).find(row => !row.fieldset.hidden);
    if (selected) {
      selected.title.tabIndex = -1;
      selected.title.focus({ preventScroll: true });
      selected.fieldset.scrollIntoView({ block: 'start' });
    }
  };
  return { node, openSection, openList, openRows: new Map(), history, historyList, historyRows: new Map(), summary, empty, select };
}

function updateQuestionList(state, list, rows, entries, selected, history) {
  const nodes = entries.map(entry => {
    let item = rows.get(entry.key);
    if (!item) {
      const make = (tag, text, css) => element(state.document, tag, text, css);
      const node = make('li');
      const button = make('button');
      button.type = 'button';
      button.dataset[history ? 'questionHistoryKey' : 'questionOpenKey'] = entry.key;
      const title = make('strong', '', history ? 'question-history-title' : 'question-open-title');
      const status = make('span', '', 'question-list-source human-loop-muted');
      const answer = make('span', '', history ? 'question-history-answer' : 'question-open-status');
      const action = make('span', '', 'question-list-inspect');
      button.append(title, status, answer, action);
      button.addEventListener('click', () => state.navigation.select(entry.key));
      node.append(button);
      item = { node, button, title, status, answer, action };
      rows.set(entry.key, item);
    }
    const draft = selectedAnswer(entry.row, entry.question, entry.group.form.resultId);
    for (const [node, text] of [[item.title, entry.question.question],
      [item.status, `${entry.provenance}${history ? ` · ${questionStatus(entry.question)}` : ''}`],
      [item.answer, history ? recordedAnswerText(state, entry.question, entry.group.form.resultId)
        : questionMeaning(entry.question).label + (draft ? entry.group.form.pending ? ' · Sending answer' : ' · Draft answer selected' : '')],
      [item.action, `${entry === selected ? 'Selected · ' : ''}Inspect full context`]]) {
      if (node.textContent !== text) node.textContent = text;
    }
    item.button.setAttribute('aria-label', `Inspect full context: ${entry.question.question} (${entry.provenance})${history ? '' : `. ${item.answer.textContent}`}`);
    item.button.setAttribute('aria-current', String(entry === selected));
    return item.node;
  });
  const keys = new Set(entries.map(entry => entry.key));
  for (const key of rows.keys()) if (!keys.has(key)) rows.delete(key);
  const previousNodes = [...list.children];
  if (previousNodes.length !== nodes.length || previousNodes.some((node, index) => node !== nodes[index])) {
    const focused = state.document.activeElement;
    const restore = nodes.some(node => node.contains?.(focused));
    list.replaceChildren(...nodes);
    if (restore) focused.focus({ preventScroll: true });
  }
}

function updateQuestionNavigation(state) {
  if (!state.navigation) return;
  const nav = state.navigation;
  const entries = [...state.forms.values()].flatMap((group, sourceIndex) => group.form.rows.map((row, index) => {
    const interaction = group.view.questionInteraction, question = interaction.questions[index];
    return { group, row, question, key: JSON.stringify([interaction.resultId, question.id]),
      provenance: `${interaction.source.role} (source ${sourceIndex + 1}) / question ${index + 1}` };
  }));
  if (state.selectedQuestion === undefined && entries.length) {
    state.selectedQuestion = entries.find(entry => entry.question.state === 'open')?.key ?? '';
  }
  const selected = entries.find(entry => entry.key === state.selectedQuestion);
  const open = entries.filter(entry => entry.question.state === 'open');
  const history = entries.filter(entry => entry.question.state !== 'open');
  nav.openSection.hidden = !open.length;
  nav.history.hidden = !history.length;
  updateQuestionList(state, nav.openList, nav.openRows, open, selected, false);
  updateQuestionList(state, nav.historyList, nav.historyRows, history, selected, true);
  nav.summary.textContent = `${history.every(entry => entry.question.state === 'answered') ? 'Answered' : 'Question'} history (${history.length})`;
  nav.empty.hidden = Boolean(selected) || (!state.selectedQuestion && !open.length && history.length > 0);
  nav.empty.textContent = !entries.length ? 'No saved questions are available in this view.'
    : state.selectedQuestion ? 'The selected question is no longer available at its original source. Choose another question.'
      : 'Choose a question to read its context and options.';
  for (const group of state.forms.values()) {
    const form = group.form;
    form.groupNode.hidden = selected?.group !== group;
    form.groupNode.open = true;
    form.groupSummary.hidden = true;
    for (const row of form.rows) row.fieldset.hidden = selected?.row !== row;
    const answers = answersFor(group, form);
    const signature = JSON.stringify(answers);
    if (form.batchSignature !== signature) {
      form.batchSignature = signature;
      const make = (tag, text) => element(state.document, tag, text);
      const list = make('ul');
      for (const answer of answers) {
        const entry = entries.find(entry => entry.group === group && entry.question.id === answer.questionId);
        const item = make('li');
        const edit = make('button', entry.question.question);
        edit.type = 'button';
        edit.addEventListener('click', () => nav.select(entry.key));
        const value = answer.kind === 'option' ? entry.question.options.find(option => option.id === answer.value).label : answer.value;
        item.append(edit, make('p', value)); list.append(item);
      }
      form.batch.replaceChildren(make('h4', `Selected answers from this source (${answers.length})`), list,
        make('p', 'Send selected answers sends this entire list as one batch. Drafts from other sources are not sent.'));
    }
    form.batch.hidden = !answers.length;
  }
}

/** Renders projected state only; an optional stable questionsContainer separates question provenance without recreating forms. */
export function renderHumanLoop(container, { view, busy = false, error = null, questionsContainer = null, cycleContainer = null,
  questionWorkspace = false, summaryInConversation = false, answerDetails = [], showQueue = true }, actions) {
  let state = instances.get(container);
  if (!state) {
    state = createState(container);
    instances.set(container, state);
  }
  if (questionsContainer && state.questions.parentElement !== questionsContainer) {
    questionsContainer.append(state.questions);
  }
  if (cycleContainer && state.cycle.parentElement !== cycleContainer) cycleContainer.append(state.cycle);
  state.view = view;
  state.busy = busy;
  state.error = error;
  state.actions = actions ?? {};
  state.summaryInConversation = summaryInConversation;
  state.answerDetails = answerDetails;
  state.questionWorkspace = questionWorkspace;
  container.hidden = !view;
  if (!view) {
    renderQuestions(state, []);
    state.cycle.hidden = true;
    return;
  }
  if (view.schemaVersion !== 'human-loop-view/v1') {
    renderQuestions(state, []);
    state.view = null;
    state.questions.replaceChildren();
    state.status.textContent = 'Unsupported human-loop view';
    state.reason.textContent = 'Refresh with a compatible human-loop-view/v1 projection.';
    for (const node of [state.role, state.cycle, state.handoff, state.queue]) node.hidden = true;
    for (const name of ['stop', 'refresh', 'discuss']) state[name].disabled = true;
    return;
  }
  state.status.textContent = humanLoopStatusLabel(view.status);
  state.root.dataset.status = view.status;
  state.reason.textContent = view.reason ?? ({
    'waiting-answer': 'Your input is needed; this is not an unknown execution state.',
    'waiting-permission': 'A permission decision is required in the permission controls, not in the question form.',
    'execution-unknown': 'Execution has not been confirmed. Refresh status; do not assume work has stopped or completed.',
    'presentation-pending': 'The result is awaiting presentation; no completion is inferred.',
  }[view.status] ?? '');
  state.reason.hidden = !state.reason.textContent;
  state.role.hidden = !view.activeRole;
  state.role.textContent = view.activeRole ? `Active role: ${view.activeRole}` : '';
  renderQuestions(state, view.questionInteractions ?? (view.questionInteraction ? [view.questionInteraction] : []));
  renderCycle(state, view.currentCycle);
  renderHandoff(state, view.lastHandoff);
  state.queue.hidden = !showQueue || view.queue.length === 0;
  if (showQueue) {
    const make = (tag, text) => element(state.document, tag, text);
    const list = make('ol');
    for (const request of view.queue) {
      list.append(make('li', `${request.kind === 'answer' ? 'Answer batch' : 'Ordinary message'} · ${request.status}${request.priority ? ' · priority' : ''}: ${request.message}`));
    }
    state.queue.replaceChildren(make('h3', `Queue (${view.queue.length})`), list);
  } else {
    state.queue.replaceChildren();
  }
  state.stop.disabled = !view.canStop || typeof state.actions.stop !== 'function';
  state.refresh.disabled = busy || typeof state.actions.refresh !== 'function';
  state.discuss.hidden = typeof state.actions.discuss !== 'function';
  state.discuss.disabled = busy || !view.canSend;
  updateError(state);
}

export function humanLoopStatusLabel(status) {
  return statusLabels[status] ?? ({ new: 'Preparing runtime', prepared: 'Preparing runtime', 'saved-state': 'Saved runtime',
    creating: 'Starting runtime', reopening: 'Reopening runtime', closed: 'Closed' }[status] ?? 'Execution state unknown');
}
