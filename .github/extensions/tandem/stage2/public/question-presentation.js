export function questionMeaning(question) {
  const tone = question.importance === 'advisory' ? 'advisory'
    : question.state === 'open' && question.blockingActive === true ? 'blocking' : 'released';
  return { tone, label: {
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
}

export function questionStatus(question) {
  const processing = { waiting: 'Queued', active: 'Processing', 'handoff-pending': 'Awaiting handoff',
    completed: 'Completed', stopped: 'Stopped', discarded: 'Discarded', retired: 'Not resumed', rejected: 'Rejected' }[question.processingState];
  return `${question.state ?? 'Recorded question'}${processing ? ` · ${processing}` : ''}`;
}
