export function questionMeaning(question) {
  const tone = question.importance === 'advisory' ? 'advisory'
    : question.state === 'open' && question.blockingActive === true ? 'blocking' : 'released';
  const issue = question.importance === 'advisory' && (question.continuationIssue
    || (!question.unanswered ? 'missing' : null));
  return { tone, label: issue && question.state === 'open' ? 'Advisory / clarification required before new work' : {
    blocking: 'Blocking / answer required',
    advisory: 'Advisory / optional',
    released: 'Originally blocking - not blocking now',
  }[tone] };
}

export function renderQuestionMeaning(node, question) {
  const { tone, label } = questionMeaning(question);
  node.className = 'question-meaning';
  node.dataset.questionTone = tone;
  node.textContent = label;
  if (question.importance === 'advisory') {
    const explanation = node.ownerDocument.createElement('span');
    explanation.className = 'question-continuation';
    explanation.textContent = !question.unanswered
      ? `No unanswered continuation was recorded. ${question.state === 'open'
        ? 'Answer this question to clarify dependent new work; no default is inferred.'
        : 'No default is inferred; any explicit answer is recorded separately.'}`
      : `If unanswered: keep the Design bound to this question. ${question.unanswered.explanation} This is a declared continuation, not a user answer or approval.${
        question.continuationIssue === 'stale' ? ' The Design has since changed; clarify this question before dependent new work.' : ''}`;
    node.append(explanation);
  }
}

export function questionStatus(question) {
  const processing = { waiting: 'Queued', active: 'Processing', 'handoff-pending': 'Awaiting handoff',
    completed: 'Completed', stopped: 'Stopped', discarded: 'Discarded', retired: 'Not resumed', rejected: 'Rejected' }[question.processingState];
  return `${question.state ?? 'Recorded question'}${processing ? ` · ${processing}` : ''}`;
}
