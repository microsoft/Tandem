const choices = [
  ['approved', 'Plan and implement'],
  ['design', 'Update Design instead'],
  ['cancelled', 'Cancel'],
];

export function createImplementationConfirmations({ document, conversation, parking, decide }) {
  const cards = new Map();
  let connected = false;
  const make = (tag, text) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  function update(card) {
    const pending = card.value.status === 'pending';
    const focused = card.element.contains(document.activeElement);
    if (card.pending !== pending) {
      card.element.open = pending;
      if (!pending && (focused || card.restoreFocus && document.activeElement === document.body)) {
        card.heading.focus({ preventScroll: true });
      }
      if (!pending) card.restoreFocus = false;
    }
    card.pending = pending;
    card.heading.textContent = pending ? 'Start implementation?'
      : ({ approved: 'Implementation approved', design: 'Sent to Designer', cancelled: 'Implementation declined',
        invalidated: 'Implementation confirmation no longer active' }[card.value.status]);
    card.description.textContent = pending
      ? `${card.value.afterDesignResultId ? 'Review the published Design first. ' : ''}Planner and code changes will start only if you choose Plan and implement.`
      : card.value.message;
    card.scope.textContent = card.value.summary;
    card.revision.textContent = `Design revision: ${card.value.design.revisionId ?? 'No Design yet'}`;
    card.batch.textContent = card.value.requests?.length > 1
      ? `This decision covers ${card.value.requests.length} batched requests:\n${card.value.requests.map(r => r.message).join('\n\n')}` : '';
    card.batch.hidden = !card.batch.textContent;
    card.actions.hidden = !pending;
    card.error.hidden = !pending || !card.error.textContent;
    for (const [decision, label] of choices) {
      const button = card.buttons.get(decision);
      button.disabled = !pending || !connected || !card.value.canDecide || card.busy
        || Boolean(card.chosen && card.chosen !== decision);
      button.textContent = card.chosen === decision && card.error.textContent ? `Retry: ${label}` : label;
    }
    card.element.setAttribute('aria-busy', String(card.busy));
  }
  return {
    render(values = [], options = {}) {
      connected = options.connected === true;
      for (const value of values) {
        let card = cards.get(value.id);
        if (!card) {
          const element = make('details'), heading = make('summary'), description = make('p'), scope = make('p'),
            revision = make('p'), batch = make('p'), actions = make('div'), error = make('p');
          element.className = 'implementation-confirmation';
          element.dataset.confirmationId = value.id;
          actions.className = 'implementation-confirmation-actions';
          error.setAttribute('role', 'alert');
          batch.style.whiteSpace = 'pre-wrap';
          element.append(heading, description, scope, revision, batch, actions, error);
          card = { element, heading, description, scope, revision, batch, actions, error, buttons: new Map(),
            value, busy: false, chosen: null, pending: null, restoreFocus: false };
          for (const [decision, label] of choices) {
            const button = make('button', label);
            button.type = 'button';
            button.dataset.implementationDecision = decision;
            button.onclick = async () => {
              if (button.disabled || card.busy) return;
              card.restoreFocus = card.element.contains(document.activeElement);
              card.busy = true; card.chosen = decision; card.error.textContent = ''; update(card);
              try { await decide(value.id, decision); }
              catch (error) { card.error.textContent = `${error.message} Refresh or retry this same decision; no different choice will be sent while its outcome is uncertain.`; }
              finally {
                card.busy = false; update(card);
                if (card.restoreFocus && !button.disabled && document.activeElement === document.body) {
                  button.focus({ preventScroll: true }); card.restoreFocus = false;
                }
              }
            };
            card.buttons.set(decision, button); actions.append(button);
          }
          cards.set(value.id, card);
        }
        card.value = value; update(card);
        conversation.placeArtifact(`implementation-confirmation:${value.id}`, card.element, {
          requestId: value.requestId,
          ...(value.afterDesignResultId ? { entryId: `handoff:${value.afterDesignResultId}` } : {}),
          title: 'Implementation decision',
        });
      }
      for (const [id, card] of cards) if (!values.some(value => value.id === id)) {
        conversation.parkArtifact(`implementation-confirmation:${id}`, card.element, parking);
        card.element.remove(); cards.delete(id);
      }
    },
  };
}
