const views = new WeakMap();
const ended = new Set(['completed', 'failed', 'stopped']);
const stoppable = new Set(['starting', 'running', 'held']);
const labels = { starting: 'Starting', running: 'Running', completed: 'Completed',
  failed: 'Failed', stopped: 'Stopped', held: 'Unconfirmed' };

/** Current native tasks and historical context; neither app readiness nor workflow Stop. */
export function renderBackgroundProcesses(container, sessions = [], { stop, onError, connected = false }) {
  sessions = sessions.filter(session => session.backgroundOrigin === 'explicit-async'
    || session.backgroundOrigin === 'sync-rollover' || session.backgroundOrigin === 'native-task');
  let state = views.get(container);
  const document = container.ownerDocument;
  const make = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  if (!state) {
    const disclosure = make('details', undefined, 'background-disclosure');
    const summary = make('summary');
    const panel = make('section', undefined, 'background-panel');
    panel.setAttribute('aria-label', 'Native shell sessions');
    const list = make('ul', undefined, 'background-list');
    panel.append(make('h3', 'Native shell sessions'),
      make('p', 'Process lifetime is separate from workflow activity.'), list);
    disclosure.append(summary, panel);
    container.append(disclosure);
    state = { disclosure, summary, list, rows: new Map(), pending: new Set() };
    views.set(container, state);
    disclosure.addEventListener('keydown', event => {
      if (event.key === 'Escape' && disclosure.open) {
        event.preventDefault(); event.stopPropagation();
        disclosure.open = false; summary.focus({ preventScroll: true });
      }
    });
    document.addEventListener('pointerdown', event => {
      if (disclosure.open && !container.contains(event.target)) disclosure.open = false;
    });
  }
  state.sessions = sessions;
  state.actions = { stop, onError, connected };
  container.hidden = sessions.length === 0;
  if (container.hidden) state.disclosure.open = false;
  const unfinished = sessions.filter(session => !ended.has(session.status) && !session.controlRetirement).length;
  state.summary.textContent = `Background ${unfinished}`;
  state.summary.title = `${unfinished} unfinished or unverified background processes under current control. Retired Unconfirmed history is separate.`;
  const canStop = session => state.actions.connected && session.canStop === true && !session.controlRetirement
    && stoppable.has(session.status) && Boolean(session.id && session.shellId)
    && typeof state.actions.stop === 'function';
  const preserveStopFocus = button => {
    if (document.activeElement === button && state.disclosure.open && !container.hidden) {
      state.summary.focus({ preventScroll: true });
    }
  };
  const updateButtons = () => {
    for (const [id, row] of state.rows) {
      const session = state.sessions.find(entry => entry.id === id);
      const disabled = !session || !canStop(session) || state.pending.has(id);
      if (disabled) preserveStopFocus(row.stop);
      row.stop.disabled = disabled;
      row.stop.textContent = state.pending.has(id) ? 'Requesting Stop…' : 'Stop process';
    }
  };
  for (const [id, row] of state.rows) if (!sessions.some(session => session.id === id)) {
    row.node.remove(); state.rows.delete(id);
  }
  for (const session of sessions) {
    let row = state.rows.get(session.id);
    if (!row) {
      const node = make('li', undefined, 'background-process');
      const heading = make('div', undefined, 'background-process-heading');
      const handle = make('code'), status = make('span'), button = make('button', 'Stop process');
      button.type = 'button'; button.dataset.nativeProcessId = session.id;
      heading.append(handle, status, button);
      const command = make('pre', undefined, 'background-command');
      const reason = make('p'), error = make('p', undefined, 'human-loop-error');
      error.setAttribute('role', 'alert'); error.hidden = true;
      const details = make('details'), provenance = make('pre');
      details.append(make('summary', 'Process details'), provenance);
      node.append(heading, command, reason, error, details);
      row = { node, handle, status, command, reason, error, provenance, stop: button };
      state.rows.set(session.id, row);
      state.list.append(node);
      button.onclick = async () => {
        const current = state.sessions.find(entry => entry.id === session.id);
        if (!current || !canStop(current) || state.pending.has(session.id) || button.disabled
          || !button.isConnected || container.hidden || !state.disclosure.open) return;
        state.pending.add(session.id); error.hidden = true; updateButtons();
        try { await state.actions.stop(session.id); }
        catch (failure) {
          error.textContent = `Stop not confirmed: ${failure.message ?? failure}`;
          error.hidden = false;
          state.actions.onError?.(failure);
        } finally { state.pending.delete(session.id); updateButtons(); }
      };
    }
    row.handle.textContent = session.shellId || 'Handle unavailable';
    row.status.textContent = labels[session.status] ?? 'Unknown';
    row.command.textContent = session.command;
    row.reason.textContent = session.reason ?? '';
    row.reason.hidden = !session.reason;
    row.provenance.textContent = JSON.stringify({
      id: session.id, sessionId: session.sessionId, shellId: session.shellId, mode: session.mode,
      backgroundOrigin: session.backgroundOrigin,
      ...(session.controlRetirement ? { recordedStatus: session.recordedStatus, controlRetirement: session.controlRetirement } : {}),
      status: session.status, exitCode: session.exitCode, taskId: session.taskId, requestId: session.requestId,
      cycleId: session.cycleId, toolCallId: session.toolCallId, startedAt: session.startedAt, endedAt: session.endedAt,
    }, null, 2);
    row.stop.setAttribute('aria-label', `Stop native process ${session.shellId || 'with unavailable handle'}`);
  }
  updateButtons();
}
