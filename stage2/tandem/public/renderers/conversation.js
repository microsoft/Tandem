import { renderAssistantResponse, renderPlainResponse } from '../assistant-response.js';
import { historyIconPath, historyIconTone } from './history-icons.js';
import { createHistoryPopover } from './history-popover.js';
import { renderQuestionMeaning, questionStatus } from '../question-presentation.js';

function renderQuestionHistory(document, questions) {
  const section = document.createElement('section');
  section.className = 'question-answer-record';
  section.dataset.questionHistory = 'true';
  const title = document.createElement('strong'), explanation = document.createElement('p');
  title.textContent = 'Saved question context';
  explanation.textContent = 'Original wording is retained here. Use Questions to answer an unanswered question.';
  section.append(title, explanation);
  for (const question of questions) {
    const row = document.createElement('section');
    row.dataset.questionResultId = question.resultId;
    row.dataset.questionId = question.id;
    const meaning = document.createElement('span'), status = document.createElement('span');
    status.className = 'question-processing-status';
    renderQuestionMeaning(meaning, question); status.textContent = questionStatus(question);
    const heading = document.createElement('strong'), support = document.createElement('p');
    heading.textContent = question.question;
    support.textContent = `${question.role}: ${question.context}\n${question.whyItMatters}`;
    support.style.whiteSpace = 'pre-wrap';
    row.append(heading, meaning, status, support);
    const options = document.createElement('ul');
    for (const option of question.options) {
      const item = document.createElement('li');
      item.textContent = `${option.label}: ${option.implication}`;
      options.append(item);
    }
    row.append(options); section.append(row);
  }
  return section;
}

export function renderConversationEntry(document, entry) {
  const article = document.createElement('article');
  article.className = `conversation-entry conversation-${entry.kind}`;
  article.dataset.entryId = entry.id;
  article.dataset.kind = entry.kind;
  if (entry.generated) article.dataset.generated = 'true';
  article.tabIndex = -1;
  const header = document.createElement('header');
  const avatar = document.createElement('span');
  avatar.className = 'conversation-avatar';
  avatar.textContent = entry.kind === 'user' ? 'Y' : entry.kind === 'assistant' ? 'T' : 't';
  const name = document.createElement('strong');
  name.textContent = entry.legacySummary ? 'Retained summary (not original)'
    : { user: 'You', assistant: 'Copilot', status: 'Workflow' }[entry.kind];
  if (entry.requestId) article.dataset.requestId = entry.requestId;
  const time = document.createElement('time');
  time.dateTime = entry.timestamp;
  time.textContent = new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  time.title = new Date(entry.timestamp).toLocaleString();
  const role = document.createElement('span');
  role.className = 'conversation-role';
  role.textContent = entry.kind === 'status' ? 'Host update' : '';
  header.append(avatar, name, role, time);
  const body = document.createElement('div');
  body.className = 'conversation-text';
  if (entry.kind === 'assistant') renderAssistantResponse(body, entry.text);
  else renderPlainResponse(body, entry.text);
  article.append(header, body);
  if (entry.questionHistory?.length) article.append(renderQuestionHistory(document, entry.questionHistory));
  if (entry.answerDetails?.length) {
    const answers = document.createElement('section');
    answers.className = 'question-answer-record';
    const title = document.createElement('strong');
    title.textContent = 'Question form answers';
    answers.append(title);
    for (const answer of entry.answerDetails) {
      const row = document.createElement('div');
      row.dataset.questionResultId = answer.sourceResultId;
      const question = document.createElement('p'), value = document.createElement('p');
      question.textContent = `${answer.role}: ${answer.question}`;
      value.textContent = answer.answer;
      value.style.whiteSpace = 'pre-wrap';
      row.append(question, value);
      if (answer.implication) {
        const implication = document.createElement('p');
        implication.textContent = answer.implication;
        row.append(implication);
      }
      answers.append(row);
    }
    article.append(answers);
  }
  for (const attachment of entry.attachments ?? []) {
    const image = document.createElement('img');
    image.className = 'conversation-diagram-image';
    const general = attachment.schemaVersion === 'image-attachment/v1';
    image.src = `/api/${general ? 'image' : 'annotation'}-attachments/${encodeURIComponent(attachment.id)}`;
    image.alt = general ? 'Attached image' : `Diagram feedback: ${attachment.source.artifactId ?? attachment.source.perspective}, revision ${attachment.source.revisionId}`;
    image.loading = 'lazy';
    article.append(image);
  }
  return article;
}

export function renderStateMarker(document, transition, focusEntry, onSelectState) {
  const item = document.createElement('li');
  item.className = `state-history-step state-${transition.kind}`;
  item.dataset.transitionId = transition.id;
  const button = document.createElement('button');
  button.type = 'button';
  const dot = document.createElement('span');
  dot.className = 'state-history-dot';
  dot.setAttribute('aria-hidden', 'true');
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.dataset.historyTone = historyIconTone(transition.label);
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('stroke', 'currentColor');
  icon.setAttribute('stroke-width', '1.5');
  icon.setAttribute('stroke-linecap', 'round');
  icon.setAttribute('stroke-linejoin', 'round');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', historyIconPath(transition.label));
  icon.append(path); dot.append(icon);
  const label = document.createElement('span');
  label.className = 'state-history-label';
  label.textContent = transition.label;
  button.append(dot, label);
  button.setAttribute('aria-label', transition.entryId ? `${transition.label}. View associated message.` : `${transition.label}. Show recorded explanation.`);
  if (transition.entryId) button.setAttribute('aria-controls', 'messages');
  button.addEventListener('click', () => {
    if (transition.entryId) focusEntry(transition.entryId);
    onSelectState?.(transition);
  });
  const connector = document.createElement('span');
  connector.className = 'state-history-hover-connector';
  connector.setAttribute('aria-hidden', 'true');
  item.append(button, connector);
  return item;
}

export function createConversationRenderer({ messages, history, current, currentDetail, newer, onSelectState }) {
  const document = messages.ownerDocument;
  const historyPopover = createHistoryPopover(history);
  const rendered = new Map();
  const markers = new Map();
  const markerContexts = new Map();
  const entryData = new Map();
  const contexts = new Map();
  let selected = null;
  let selectedTransitionId = null;
  let highlightTimer = null;
  const window = document.defaultView;
  function updateMarker(marker, transition) {
    const button = marker.querySelector('button');
    const selected = selectedTransitionId === transition.id;
    const label = transition.members ? `${transition.label} ×${transition.members.length}` : transition.label;
    button.setAttribute('aria-label', transition.entryId ? `${label}. View associated message.` : `${label}. Show recorded explanation.`);
    marker.querySelector('.state-history-label').textContent = label;
    let count = marker.querySelector('.state-history-count');
    if (transition.members && !count) {
      count = document.createElement('button');
      count.type = 'button'; count.className = 'state-history-count';
      count.setAttribute('aria-haspopup', 'dialog'); count.setAttribute('aria-expanded', 'false');
      count.setAttribute('aria-controls', historyPopover.detailsId);
      count.onclick = () => historyPopover.expand(count, transition, focusEntry);
      marker.append(count);
    }
    if (count) {
      count.hidden = !transition.members;
      count.textContent = transition.members ? `×${transition.members.length}` : '';
      count.setAttribute('aria-label', `Show all ${label} events`);
    }
    if (transition.entryId) button.setAttribute('aria-controls', 'messages');
    else button.removeAttribute('aria-controls');
    button.setAttribute('aria-pressed', String(selected));
    marker.dataset.selected = String(selected);
    historyPopover.refresh(button, transition);
  }
  function selectTransition(transition) {
    selectedTransitionId = !transition.entryId && selectedTransitionId === transition.id ? null : transition.id;
    for (const [id, marker] of markers) updateMarker(marker, markerContexts.get(id));
    onSelectState?.(transition);
  }
  const returnToCurrent = document.createElement('button');
  returnToCurrent.type = 'button';
  returnToCurrent.className = 'state-history-return';
  returnToCurrent.textContent = 'Return to current';
  returnToCurrent.setAttribute('aria-controls', history.id);
  returnToCurrent.hidden = true;
  (history.closest('.human-app .conversation-layout') ?? history).after(returnToCurrent);
  let followingHistory = true;
  let historyFrame = null;
  let lastHistoryTop = history.scrollTop;
  const historyNearBottom = () => history.scrollHeight - history.scrollTop - history.clientHeight < 60;
  function followHistory() {
    if (!followingHistory || historyFrame !== null) return;
    historyFrame = window.requestAnimationFrame(() => {
      historyFrame = null;
      if (!followingHistory) return;
      history.scrollTop = history.scrollHeight;
      lastHistoryTop = history.scrollTop;
    });
  }
  history.addEventListener('scroll', () => {
    // Our own delayed scroll events must not reinterpret later content growth as browsing.
    if (history.scrollTop === lastHistoryTop) return;
    lastHistoryTop = history.scrollTop;
    followingHistory = historyNearBottom();
    returnToCurrent.hidden = followingHistory;
  });
  returnToCurrent.addEventListener('click', () => {
    followingHistory = true;
    returnToCurrent.hidden = true;
    followHistory();
  });
  // Observe the viewport and rows: initial hidden layout, wrapping and late font sizing
  // can change the bottom without a new conversation snapshot.
  const historyResize = new window.ResizeObserver(followHistory);
  historyResize.observe(history);
  function focusEntry(id) {
    const entry = rendered.get(id);
    if (!entry) return;
    rendered.get(selected)?.classList.remove('state-focused');
    selected = id;
    entry.classList.add('state-focused');
    entry.scrollIntoView({ block: 'nearest' });
    entry.focus({ preventScroll: true });
    window.clearTimeout(highlightTimer);
    highlightTimer = window.setTimeout(() => entry.classList.remove('state-focused'), 2000);
  }
  newer.addEventListener('click', () => {
    messages.scrollTop = messages.scrollHeight;
    newer.hidden = true;
  });
  messages.addEventListener('scroll', () => {
    if (messages.scrollHeight - messages.scrollTop - messages.clientHeight < 60) newer.hidden = true;
  });
  return {
    render(entries, transitions, progress = new Map()) {
      const pinned = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 60;
      const anchor = [...messages.children].find((node) =>
        node.getBoundingClientRect().bottom >= messages.getBoundingClientRect().top);
      const offset = anchor?.getBoundingClientRect().top;
      let changed = false;
      // Insert only new records. Never replace an older agent response on a new turn.
      let previous = null;
      for (const entry of entries) {
        let node = rendered.get(entry.id);
        if (node && entry.questionHistory?.length && !node.querySelector('[data-question-history]')) {
          node.append(renderQuestionHistory(document, entry.questionHistory));
          changed = true;
        }
        if (node && entry.questionHistory?.length) {
          for (const row of node.querySelectorAll('[data-question-history] [data-question-id]')) {
            const question = entry.questionHistory.find(q => q.id === row.dataset.questionId && q.resultId === row.dataset.questionResultId);
            if (!question) continue;
            renderQuestionMeaning(row.querySelector('.question-meaning'), question);
            row.querySelector('.question-processing-status').textContent = questionStatus(question);
          }
        }
        if (node?.dataset.generated && !entry.generated) {
          const replacement = renderConversationEntry(document, entry);
          node.replaceWith(replacement);
          rendered.set(entry.id, replacement);
          node = replacement;
          changed = true;
        }
        if (!node) {
          node = renderConversationEntry(document, entry);
          rendered.set(entry.id, node);
          messages.insertBefore(node, previous ? previous.nextSibling : messages.firstChild);
          changed = true;
        }
        entryData.set(entry.id, entry);
        node.dataset.compactHost = entry.compactHost ? 'true' : 'false';
        node.dataset.suppressedHost = entry.suppressedHost ? 'true' : 'false';
        const deliveryLabel = { received: 'Received', waiting: 'Queued', active: 'Active request',
          held: 'Held from the stopped direction', stopped: 'Stopped with the previous direction', cancelled: 'Implementation declined' }[entry.queueState];
        let delivery = node.querySelector(':scope > .conversation-queue-state');
        if (entry.kind === 'user' && deliveryLabel) {
          if (!delivery) { delivery = document.createElement('p'); delivery.className = 'conversation-queue-state'; node.append(delivery); }
          delivery.textContent = deliveryLabel;
          delivery.dataset.disposition = entry.queueState;
        } else delivery?.remove();
        const updates = entry.requestId && progress.get(entry.requestId);
        if (updates && entry.id === `canvas-user:${entry.requestId}`) {
          let details = node.querySelector(':scope > .request-progress');
          if (!details) {
            details = document.createElement('details');
            details.className = 'request-progress';
            node.append(details);
          }
          const latest = new Map();
          for (const update of updates) latest.set(update.toolKey ?? update.id, update);
          const tools = [...latest.values()].filter((update) => update.toolCallId);
          if (!tools.length) {
            details.remove();
            previous = node;
            continue;
          }
          const summary = document.createElement('summary');
          const failed = tools.filter(({ status }) => status === 'failed').length;
          summary.textContent = `Tools · ${tools.length} call${tools.length === 1 ? '' : 's'}${failed ? ` · ${failed} failed` : ''}`;
          const list = document.createElement('ol');
          for (const update of tools) {
            const row = document.createElement('li');
            const time = document.createElement('time');
            time.dateTime = update.timestamp;
            time.textContent = new Date(update.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const label = document.createElement('span');
            label.textContent = update.label;
            row.append(time, label);
            if (update.status) {
              const status = document.createElement('span');
              status.className = `progress-status progress-${update.status}`;
              status.textContent = { running: 'Started', completed: 'Completed', failed: 'Failed' }[update.status] ?? 'Observed';
              row.append(status);
            } else node.querySelector(':scope > .request-progress')?.remove();
            list.append(row);
          }
          details.replaceChildren(summary, list);
        }
        previous = node;
      }
      let priorMarker = null;
      let historyChanged = false;
      const visibleMarkers = new Set(transitions.map(({ id }) => id));
      for (const [id, marker] of markers) {
        if (!visibleMarkers.has(id)) {
          historyPopover.forget(marker.querySelector('button'));
          historyResize.unobserve(marker);
          marker.remove();
          markers.delete(id);
          markerContexts.delete(id);
          historyChanged = true;
        }
      }
      for (const transition of transitions) {
        let context = markerContexts.get(transition.id);
        if (!context) { context = { ...transition }; markerContexts.set(transition.id, context); }
        else Object.assign(context, transition, { members: transition.members });
        let marker = markers.get(transition.id);
        if (!marker) {
          marker = renderStateMarker(document, context, focusEntry, selectTransition);
          historyPopover.bind(marker.querySelector('button'), context);
          markers.set(transition.id, marker);
          history.insertBefore(marker, priorMarker ? priorMarker.nextSibling : history.firstChild);
          historyResize.observe(marker);
          historyChanged = true;
        }
        updateMarker(marker, context);
        priorMarker = marker;
      }
      if (historyChanged) followHistory();
      if (changed) {
        if (pinned) messages.scrollTop = messages.scrollHeight;
        else if (anchor) messages.scrollTop += anchor.getBoundingClientRect().top - offset;
        newer.hidden = pinned;
      }
    },
    current(value) {
      const currentLabel = document.getElementById?.('current-state-title');
      const currentReason = document.getElementById?.('current-state-detail');
      (currentLabel && current.contains(currentLabel) ? currentLabel : current).textContent = value.label === 'Waiting for plan approval' ? 'Awaiting approval' : value.label;
      (currentReason && currentDetail.contains(currentReason) ? currentReason : currentDetail).textContent = value.detail;
      current.parentElement.dataset.state = value.kind;
      current.parentElement.dataset.currentLabel = value.label;
      const title = document.getElementById?.('current-state-title');
      if (title) {
        title.textContent = value.label;
        document.getElementById('current-state-detail').textContent = value.detail;
        title.closest('.conversation-state-strip').dataset.state = value.kind;
        title.closest('.conversation-state-strip').dataset.currentLabel = value.label;
      }
    },
    focusRequest(requestId) {
      const target = [...entryData.values()].findLast((entry) => entry.requestId === requestId);
      if (target) focusEntry(target.id);
      else messages.scrollTop = messages.scrollHeight;
    },
    placeArtifact(key, node, { requestId, entryId, eventKind, title, unlinked = false }) {
      const focused = document.activeElement;
      const restoreFocus = focused && node.contains(focused);
      const selection = restoreFocus && typeof focused.selectionStart === 'number'
        ? [focused.selectionStart, focused.selectionEnd, focused.selectionDirection] : null;
      const candidates = [...entryData.values()].filter((entry) => !entry.generated && entry.requestId === requestId);
      const entry = !unlinked && requestId && (candidates.find((entry) => entry.id === entryId)
        ?? candidates.findLast((entry) => entry.eventKind === eventKind)
        ?? candidates.find((entry) => entry.kind === 'user'));
      let owner = entry && rendered.get(entry.id);
      const previous = contexts.get(key);
      if (!owner) {
        owner = previous?.fallback ?? document.createElement('article');
        owner.className = 'conversation-entry conversation-status';
        owner.dataset.contextId = key;
        if (!previous?.fallback) {
          const heading = document.createElement('header');
          const name = document.createElement('strong');
          name.textContent = title;
          heading.append(name);
          owner.append(heading);
        }
        if (!owner.isConnected) messages.append(owner);
      } else if (previous?.fallback) previous.fallback.remove();
      let slot = owner.querySelector(':scope > .message-artifacts');
      if (!slot) {
        slot = document.createElement('div');
        slot.className = 'message-artifacts';
        owner.append(slot);
      }
      if (node.parentElement !== slot) {
        slot.append(node);
        if (restoreFocus) {
          focused.focus({ preventScroll: true });
          if (selection) focused.setSelectionRange(...selection);
        }
      }
      if (!entry) owner.hidden = node.hidden;
      contexts.set(key, { fallback: entry ? null : owner });
      return Boolean(entry);
    },
    parkArtifact(key, node, parking) {
      if (node.parentElement !== parking) parking.append(node);
      contexts.get(key)?.fallback?.remove();
      contexts.delete(key);
    },
    reset() {
      rendered.clear();
      for (const marker of markers.values()) {
        historyPopover.forget(marker.querySelector('button'));
        historyResize.unobserve(marker);
      }
      markers.clear();
      markerContexts.clear();
      entryData.clear();
      contexts.clear();
      messages.replaceChildren();
      history.replaceChildren();
      selected = null;
      followingHistory = true;
      lastHistoryTop = history.scrollTop;
      returnToCurrent.hidden = true;
      followHistory();
    },
  };
}
