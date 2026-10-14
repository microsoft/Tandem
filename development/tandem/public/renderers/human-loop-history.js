const roles = {
  router: ['router', 'Routing'], designer: ['designer', 'Designing'], planner: ['planner', 'Planning'],
  implementer: ['implementer', 'Implementing'], reviewer: ['reviewer', 'Reviewing'], agent: ['agent', 'Read-only work'],
};
const events = {
  'human.setup-waiting': ['setup', 'Setup waiting'],
  'human.ready': ['host', 'Ready'],
  'human.compaction-requested': ['host', 'Compaction requested'],
  'human.compaction-start': ['host', 'Compacting'],
  'human.compaction-complete': ['host', 'Context compacted'],
  'human.compaction-failed': ['attention', 'Compaction failed'],
  'human.completion-timeout': ['attention', 'Completion timeout'],
  'human.audit-failed': ['unknown', 'History issue'],
  'human.plan-accepted': ['planner', 'Plan ready'],
  'human.task-progress': ['implementer', 'Task progress'],
  'human.internal-task': ['implementer', 'Task progress'],
  'human.answer-rejected': ['attention', 'Answer not applied'],
  'human.execution-unknown': ['unknown', 'State unknown'],
  'human.stopping': ['stopping', 'Stopping'],
  'human.stopped': ['stopped', 'Stopped'],
  'permission.requested': ['permission', 'Permission needed'],
  'permission.granted': ['permission', 'Permission granted'],
  'permission.denied': ['permission', 'Permission denied'],
  'permission.cancelled': ['permission', 'Permission withdrawn'],
  'permission.reset': ['permission', 'Approvals reset'],
};
const outcomes = {
  'designer-changed': ['designer', 'Design updated'],
  'designer-unchanged': ['designer', 'Design unchanged'],
  'design-concern': ['attention', 'Input needed'],
  'review-result': ['reviewer', 'Review result'],
  answer: ['agent', 'Answer ready'],
  'execution-failure': ['unknown', 'Work failed'],
};

export const humanHistoryLabels = Object.freeze([...new Set([
  ...Object.values(roles), ...Object.values(events), ...Object.values(outcomes),
].map(([, label]) => label)), 'Your request', 'Recovery', 'Host update', 'Automatic approval', 'Tool update', 'Tool failed']);

function routineEvent(event, streamId) {
  const data = event.data ?? {}, activity = data.activity;
  if (event.source !== 'system' || typeof streamId !== 'string' || !streamId || !Number.isInteger(event.sequence) || event.sequence < 1
    || !Number.isFinite(Date.parse(event.timestamp)) || !activity || !Object.hasOwn(roles, activity.role)
    || !['sessionId', 'taskId', 'requestId'].every(key => typeof activity[key] === 'string' && activity[key])
    || (data.requestId && data.requestId !== activity.requestId) || (data.role && data.role !== activity.role)) return null;
  const toolBound = ['toolName', 'toolCallId'].every(key => typeof activity[key] === 'string' && activity[key]);
  let subtype;
  if (event.type === 'permission.granted' && data.decision === 'all' && typeof data.grantRequestId === 'string' && data.grantRequestId
    && typeof data.permissionKind === 'string' && data.permissionKind && toolBound) {
    subtype = [data.permissionKind, activity.toolName, data.grantRequestId];
  } else if (event.type === 'human.native-shell' && data.status === 'succeeded'
    && toolBound && activity.toolName !== 'stop_powershell') {
    subtype = [data.status, activity.toolName];
  } else if (event.type === 'human.task-progress' && ['started', 'progress'].includes(data.status) && typeof data.taskId === 'string' && data.taskId) {
    subtype = [data.status, data.taskId];
  } else return null;
  return JSON.stringify([streamId, event.type, ...subtype, activity.sessionId, activity.requestId, activity.role, activity.taskId]);
}

function groupRoutineEvents(transitions) {
  const result = [];
  for (const transition of transitions) {
    const previous = result.at(-1);
    if (transition.groupKey && previous?.groupKey === transition.groupKey && previous.entryId === transition.entryId) {
      const members = [...(previous.members ?? [previous]), transition];
      result[result.length - 1] = { ...previous, members, timestamp: transition.timestamp, explanation: transition.explanation };
    } else result.push(transition);
  }
  return result;
}

export function projectHumanHistory(items, messages, streamId, requests = [], recoveries = []) {
  const transitions = items.filter(({ type }) => type !== 'human.state'
    && !(type === 'human.recovery' && recoveries.length)).map((event) => {
    const automatic = event.type === 'permission.granted' && event.source === 'system'
      && event.data?.decision === 'all' && event.data?.grantRequestId;
    const semantic = automatic ? ['permission', 'Automatic approval']
      : event.type === 'human.native-shell' && ['succeeded', 'failed'].includes(event.data?.status)
        ? event.data.status === 'failed' ? ['unknown', 'Tool failed'] : ['host', 'Tool update']
      : event.type === 'human.role' ? roles[event.data?.role]
      : event.type === 'human.handoff' ? outcomes[event.data?.kind] : events[event.type];
    const [kind, label] = semantic ?? ['host', 'Host update'];
    // Permission request IDs belong to the broker, not to a conversation request.
    const requestId = event.type.startsWith('human.') ? event.data?.requestId ?? null : null;
    const associated = event.type === 'human.handoff' && event.data?.resultId && requestId
      && messages.find((entry) => entry.id === `handoff:${event.data.resultId}` && entry.requestId === requestId);
    return {
      id: `event:${streamId}:${event.sequence}`, kind, label, timestamp: event.timestamp,
      groupKey: routineEvent(event, streamId),
      entryId: associated?.id ?? '', explanation: [event.summary,
        ...(event.type.startsWith('permission.') && event.data?.action ? [
          event.data.action.description, ...(event.data.action.scopes ?? []),
          `Recorded decision: ${event.data.decision ?? 'unknown'}.`,
          ...(event.data.grantRequestId ? [`Remembered grant origin: ${event.data.grantRequestId}.`] : []),
        ] : [])].filter(Boolean).join('\n'), eventType: event.type,
      source: {
        eventId: event.id ?? null, streamId, sequence: event.sequence,
        requestId: event.data?.requestId ?? null, cycleId: event.data?.cycleId ?? null,
        resultId: event.data?.resultId ?? null, stopId: event.data?.stopId ?? null,
        ...(event.data?.activity ? { activity: { ...event.data.activity } } : {}),
      },
    };
  });
  const requestMarkers = [...new Map(requests.map(request => [request.id, request])).values()].map(request => {
    const associated = messages.find(entry => entry.id === `request:${request.id}`
      && entry.requestId === request.id && entry.kind === 'user');
    return {
      id: `request:${request.id}`, kind: 'user', label: 'Your request', timestamp: request.receivedAt,
      entryId: associated?.id ?? '', explanation: 'Your request was received.',
      eventType: 'request', source: { requestId: request.id },
    };
  });
  const firstRole = new Map();
  for (const transition of transitions) if (transition.eventType === 'human.role' && transition.source.requestId) {
    const id = transition.source.requestId, timestamp = Date.parse(transition.timestamp);
    firstRole.set(id, Math.min(firstRole.get(id) ?? timestamp, timestamp));
  }
  // Preserve receipt timestamps even if the browser clock is ahead of the Host.
  const orderTime = item => item.eventType === 'request'
    ? Math.min(Date.parse(item.timestamp), firstRole.get(item.source.requestId) ?? Infinity) : Date.parse(item.timestamp);
  const recoveryMarkers = recoveries.map(({ id, recoveredAt }) => (
    { id: `recovery:${id}`, kind: 'host', label: 'Recovery', timestamp: recoveredAt, entryId: '',
      explanation: 'Retained Conversation and Design restored. Previous tasks and queued requests were not resumed.',
      eventType: 'recovery', source: { recoveryId: id, sequence: 0 } }
  ));
  return groupRoutineEvents([...requestMarkers, ...transitions, ...recoveryMarkers].sort((a, b) =>
    orderTime(a) - orderTime(b)
    || Number(b.eventType === 'request') - Number(a.eventType === 'request')
    || (a.source.sequence ?? 0) - (b.source.sequence ?? 0)
    || a.id.localeCompare(b.id)).slice(-500));
}
