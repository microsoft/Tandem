import { renderConversationEntry } from './renderers/conversation.js';

const labels = {
  queued: 'Queued; not started',
  'cancelled-before-start': 'Cancelled before processing',
  'stopped-before-start': 'Stopped before processing',
  'retired-before-start': 'Not started; not resumed after Recovery',
  'rejected-before-start': 'Rejected before processing',
};

export function createQueuedRequests(mount) {
  const document = mount.ownerDocument, rows = new Map();
  const group = (title, open) => {
    const details = document.createElement('details'), summary = document.createElement('summary'), list = document.createElement('ol');
    details.open = open; details.append(summary, list); mount.append(details);
    return { details, summary, list, title };
  };
  const waiting = group('Queued', true), retained = group('Not started history', false);
  waiting.details.dataset.queuedWaiting = '';
  retained.details.dataset.queuedHistory = '';
  return {
    render(entries, queue = [], available = true) {
      const queued = entries.filter(entry => entry.kind === 'user' && Object.hasOwn(labels, entry.queuedStatus))
        .sort((a, b) => a.queuedOrder - b.queuedOrder);
      const ids = new Set(queued.map(entry => entry.id));
      for (const [id, row] of rows) if (!ids.has(id)) { row.remove(); rows.delete(id); }
      const order = new Map(queue.map((entry, index) => [entry.id, index]));
      const current = queued.filter(entry => entry.queuedStatus === 'queued')
        .sort((a, b) => (order.get(a.requestId) ?? Infinity) - (order.get(b.requestId) ?? Infinity));
      for (const [target, items] of [[waiting, current], [retained, queued.filter(entry => entry.queuedStatus !== 'queued')]]) {
        target.details.hidden = !items.length;
        target.summary.textContent = `${target.title} (${items.length})`;
        let previous = null;
        for (const entry of items) {
          let row = rows.get(entry.id);
          if (!row) {
            row = document.createElement('li');
            row.dataset.queuedRequestId = entry.requestId;
            const details = document.createElement('details'), summary = document.createElement('summary');
            summary.textContent = entry.text || 'Image attachment';
            details.append(summary, renderConversationEntry(document, entry));
            row.append(details); rows.set(entry.id, row);
          }
          row.dataset.queuedStatus = entry.queuedStatus;
          const label = row.querySelector('.conversation-role');
          label.textContent = labels[entry.queuedStatus] + (entry.roleHint ? `; Preference: @${entry.roleHint.role}` : '');
          label.title = entry.roleHint ? 'Per-message preference only. Router decides who responds.' : '';
          const time = row.querySelector('time');
          time.title = `Received ${new Date(entry.timestamp).toLocaleString()}. Processing time is not recorded here.`;
          time.setAttribute('aria-label', time.title);
          if (row.parentElement !== target.list || row.previousElementSibling !== previous) {
            target.list.insertBefore(row, previous ? previous.nextSibling : target.list.firstChild);
          }
          previous = row;
        }
      }
      mount.hidden = !queued.length || !available;
    },
    focusRequest(requestId) {
      const row = [...rows.values()].find(row => row.dataset.queuedRequestId === requestId);
      if (!row) return false;
      row.parentElement.parentElement.open = true;
      row.firstElementChild.open = true;
      row.scrollIntoView({ block: 'nearest' });
      row.querySelector('summary').focus({ preventScroll: true });
      return true;
    },
  };
}
