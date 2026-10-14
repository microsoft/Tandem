const paths = {
  route: 'M3 4h5v5H3z M8 6h5v10h7 M13 6h7 M17 3l3 3-3 3 M17 13l3 3-3 3',
  design: 'm5 16-1 4 4-1L20 7l-3-3Z M14 7l3 3',
  plan: 'M9 5h11 M9 12h11 M9 19h11 M3 4l1 1 2-2 M3 11l1 1 2-2 M3 18l1 1 2-2',
  code: 'm8 6-6 6 6 6 M16 6l6 6-6 6 M14 3l-4 18',
  review: 'M9 17a7 7 0 1 1 5-12 7 7 0 0 1-5 12 M14 15l6 6 M6 10l2 2 4-4',
  read: 'M3 5h7l2 2 2-2h7v14h-7l-2 2-2-2H3Z M12 7v14',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 7v5l3 2',
  check: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M7 12l3 3 7-7',
  compact: 'M3 4h18 M3 20h18 M8 8l4 4 4-4 M8 16l4-4 4 4',
  alert: 'm12 3 10 18H2Z M12 9v5 M12 17v1',
  question: 'M9 8a3 3 0 1 1 4 3c-1 1-1 2-1 3 M12 17v1 M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20',
  stop: 'M7 3h10l4 4v10l-4 4H7l-4-4V7Z M8 8h8v8H8Z',
  shield: 'm12 2 8 3v6c0 5-4 8-8 11-4-3-8-6-8-11V5Z',
  denied: 'M5 5l14 14 M19 5 5 19 M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20',
  recovery: 'M4 8a9 9 0 1 1-1 7 M4 3v5h5 M9 12l2 2 5-5',
  message: 'M3 3h18v14H9l-6 4Z M7 8h10 M7 12h7',
  host: 'M3 4h18v13H3Z M8 21h8 M12 17v4',
};

export const historyIconVocabulary = Object.freeze({
  Routing: 'route', Designing: 'design', Planning: 'plan', Implementing: 'code', Reviewing: 'review',
  'Read-only work': 'read', 'Setup waiting': 'clock', Ready: 'check',
  'Compaction requested': 'compact', Compacting: 'compact', 'Context compacted': 'compact', 'Compaction failed': 'alert',
  'Completion timeout': 'clock',
  'History issue': 'alert', 'Plan ready': 'plan', 'Task progress': 'code', 'Answer not applied': 'alert',
  'State unknown': 'question', Stopping: 'clock', Stopped: 'stop',
  'Permission needed': 'shield', 'Permission granted': 'shield', 'Permission denied': 'denied',
  'Permission withdrawn': 'shield', 'Approvals reset': 'shield',
  'Automatic approval': 'shield', 'Tool update': 'host', 'Tool failed': 'alert',
  'Design updated': 'design', 'Design unchanged': 'design', 'Input needed': 'question',
  'Review result': 'review', 'Answer ready': 'message', 'Work failed': 'alert',
  'Your request': 'message', Recovery: 'recovery', 'Host update': 'host',
});

export function historyIconPath(label) {
  return paths[historyIconVocabulary[label] ?? 'host'];
}

export function historyIconTone(label) {
  return { message: 'conversation', host: 'conversation',
    route: 'structure', plan: 'structure', review: 'structure', compact: 'structure',
    design: 'design', shield: 'design',
    code: 'execution', read: 'execution', check: 'execution', recovery: 'execution',
  }[historyIconVocabulary[label]] ?? 'neutral';
}
