export function createHistoryPopover(history) {
  const document = history.ownerDocument, window = document.defaultView;
  const panel = document.createElement('div'), title = document.createElement('strong'), detail = document.createElement('p');
  const time = document.createElement('time');
  const rangeEnd = document.createElement('time'), range = document.createElement('span');
  range.append(document.createTextNode(' – '), rangeEnd);
  range.hidden = true;
  panel.id = `${history.id}-popover`;
  panel.className = 'state-history-popover';
  panel.setAttribute('role', 'tooltip');
  panel.hidden = true;
  panel.append(title, time, range, detail);
  document.body.append(panel);
  const dialog = document.createElement('dialog'), heading = document.createElement('h2');
  const close = document.createElement('button'), list = document.createElement('ol');
  dialog.id = `${history.id}-events`;
  dialog.className = 'state-history-events';
  heading.id = `${dialog.id}-title`;
  dialog.setAttribute('aria-labelledby', heading.id);
  close.type = 'button'; close.textContent = 'Close event details';
  close.onclick = () => dialog.close();
  dialog.append(heading, close, list);
  document.body.append(dialog);
  const rows = new Map();
  let expanded = null, opener = null;
  dialog.addEventListener('close', () => {
    opener?.setAttribute('aria-expanded', 'false');
    expanded = null; rows.clear(); list.replaceChildren();
    if (opener?.isConnected) opener.focus();
    opener = null;
  });
  let anchor = null, timer = null;
  const cancel = () => { window.clearTimeout(timer); timer = null; };
  const hide = () => {
    cancel();
    anchor?.removeAttribute('aria-describedby');
    anchor = null; panel.hidden = true;
  };
  function position() {
    if (!anchor) return;
    const box = anchor.getBoundingClientRect(), rail = history.getBoundingClientRect();
    if (box.bottom < rail.top || box.top > rail.bottom) { hide(); return; }
    panel.style.width = box.left >= 266 ? `${Math.min(360, box.left - 16)}px` : '';
    const width = panel.offsetWidth;
    if (box.left >= width + 16) {
      panel.style.maxHeight = `${Math.min(320, window.innerHeight - 16)}px`;
      panel.style.left = `${box.left - width - 8}px`;
      panel.style.top = `${Math.max(8, Math.min(window.innerHeight - panel.offsetHeight - 8, box.top + box.height / 2 - panel.offsetHeight / 2))}px`;
    } else {
      const above = box.top - 16, below = window.innerHeight - box.bottom - 16;
      const useAbove = above >= 80;
      panel.style.maxHeight = `${Math.max(24, Math.min(320, useAbove ? above : below))}px`;
      panel.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, box.left))}px`;
      panel.style.top = `${useAbove ? Math.max(8, box.top - panel.offsetHeight - 8) : box.bottom + 8}px`;
    }
  }
  function show(button, transition) {
    cancel();
    anchor?.removeAttribute('aria-describedby');
    anchor = button;
    const members = transition.members, first = members?.[0] ?? transition;
    title.textContent = members ? `${transition.label} ×${members.length}` : transition.label;
    time.dateTime = first.timestamp;
    time.textContent = new Date(first.timestamp).toLocaleString();
    range.hidden = !members;
    if (members) {
      rangeEnd.dateTime = members.at(-1).timestamp;
      rangeEnd.textContent = new Date(members.at(-1).timestamp).toLocaleString();
    }
    detail.textContent = `${members ? 'Latest: ' : ''}${transition.explanation ?? 'No explanation was recorded.'}`;
    panel.hidden = false;
    button.setAttribute('aria-describedby', panel.id);
    position();
  }
  function leave(event) {
    if (panel.contains(event.relatedTarget) || anchor?.contains(event.relatedTarget)) return;
    if (event.type === 'blur' && (panel.matches(':hover') || anchor?.matches(':hover'))) return;
    cancel(); timer = window.setTimeout(hide, 150);
  }
  panel.addEventListener('pointerenter', cancel);
  panel.addEventListener('pointerleave', leave);
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !panel.hidden) hide(); });
  window.addEventListener('resize', position);
  document.addEventListener('scroll', event => { if (!panel.contains(event.target)) position(); }, true);
  function updateDetails(transition, focusEntry) {
    heading.textContent = `${transition.label} ×${transition.members.length}`;
    const retained = new Set(transition.members.map(member => member.id));
    for (const [id, row] of rows) if (!retained.has(id)) { row.remove(); rows.delete(id); }
    for (const member of transition.members) {
      if (rows.has(member.id)) continue;
      const row = document.createElement('li'), label = document.createElement('strong');
      const timestamp = document.createElement('time'), explanation = document.createElement('p');
      const source = document.createElement('details'), summary = document.createElement('summary'), identity = document.createElement('pre');
      row.dataset.transitionId = member.id;
      label.textContent = `${member.label} (${member.eventType})`;
      timestamp.dateTime = member.timestamp; timestamp.textContent = new Date(member.timestamp).toLocaleString();
      explanation.textContent = member.explanation;
      summary.textContent = 'Source identity';
      identity.textContent = JSON.stringify({ id: member.id, eventType: member.eventType, timestamp: member.timestamp, ...member.source }, null, 2);
      source.append(summary, identity); row.append(label, timestamp, explanation, source);
      if (member.entryId) {
        const link = document.createElement('button');
        link.type = 'button'; link.textContent = 'View associated message';
        link.onclick = () => {
          opener?.setAttribute('aria-expanded', 'false'); opener = null;
          dialog.close(); focusEntry(member.entryId);
        };
        row.append(link);
      }
      rows.set(member.id, row); list.append(row);
    }
  }
  return {
    detailsId: dialog.id,
    expand(button, transition, focusEntry) {
      if (!transition.members) return;
      hide();
      opener = button; expanded = { transition, focusEntry };
      button.setAttribute('aria-expanded', 'true');
      updateDetails(transition, focusEntry);
      dialog.showModal();
    },
    refresh(button, transition) {
      if (anchor === button && !panel.hidden) show(button, transition);
      if (dialog.open && expanded?.transition.id === transition.id) {
        if (transition.members) updateDetails(transition, expanded.focusEntry);
        else dialog.close();
      }
    },
    forget(button) {
      if (anchor === button) hide();
      if (opener?.parentElement === button.parentElement && dialog.open) dialog.close();
    },
    bind(button, transition) {
      button.addEventListener('pointerenter', () => show(button, transition));
      button.addEventListener('pointerleave', leave);
      button.addEventListener('focus', () => show(button, transition));
      button.addEventListener('blur', leave);
      const connector = button.parentElement.querySelector('.state-history-hover-connector');
      connector.addEventListener('pointerenter', () => show(button, transition));
      connector.addEventListener('pointerleave', leave);
    },
  };
}
