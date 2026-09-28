const views = new WeakMap();

/** Presentation only: request IDs, exact details and decision values remain unchanged. */
export function renderPermissionRequests(container, requests, { decide, approvePendingOnce, onError }) {
  let state = views.get(container);
  if (!state) {
    state = { signature: null, selected: null, pending: new Set(), cards: new Map() };
    views.set(container, state);
  }
  state.requests = requests;
  state.actions = { decide, approvePendingOnce, onError };
  const signature = JSON.stringify([requests, Boolean(approvePendingOnce)]);
  if (state.signature === signature) return;
  state.signature = signature;
  for (const id of state.pending) if (!requests.some(request => request.id === id)) state.pending.delete(id);
  for (const id of state.cards.keys()) if (!requests.some(request => request.id === id)) state.cards.delete(id);
  if (!requests.some(request => request.id === state.selected)) state.selected = requests[0]?.id ?? null;
  const document = container.ownerDocument;
  const focused = document.activeElement;
  const restoreFocus = container.contains(focused);
  const pickerFocused = focused?.matches('.access-request-picker select');
  const inspected = state.cards.get(state.selected);
  const retainReading = Boolean(inspected) && state.renderedSelection === state.selected
    && inspected?.signature === JSON.stringify(requests.find(request => request.id === state.selected));
  const readingTop = retainReading ? inspected.node.querySelector('.access-request-context').scrollTop : 0;
  const make = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const nodes = [];
  if (approvePendingOnce && requests.length) {
    const toolbar = make('div', undefined, 'access-request-decisions');
    const capturedIds = requests.map(request => request.id);
    const eligible = requests.find(request => request.canApproveAll);
    toolbar.append(make('p', 'Once approves exactly the displayed pending set, not later arrivals. Session access also covers future eligible native and custom requests; managed-required requests still prompt.'));
    for (const [decision, label, enabled] of [
      ['once', `Approve pending set once (${capturedIds.length})`, true],
      ['all', 'Allow current + future access for this Tandem session', Boolean(eligible)],
    ]) {
      const button = make('button', label);
      button.type = 'button'; button.dataset.accessBatch = decision;
      button.disabled = !enabled || state.batchPending === true;
      button.onclick = async () => {
        if (button.disabled || !button.isConnected || state.batchPending) return;
        state.batchPending = true; state.signature = null;
        renderPermissionRequests(container, state.requests, state.actions);
        try {
          if (decision === 'once') await state.actions.approvePendingOnce(capturedIds);
          else await state.actions.decide(eligible.id, 'all');
        } catch (error) { state.actions.onError(error); }
        finally {
          state.batchPending = false; state.signature = null;
          renderPermissionRequests(container, state.requests, state.actions);
        }
      };
      toolbar.append(button);
    }
    nodes.push(toolbar);
  }
  if (requests.length > 1) {
    const label = make('label', `Pending permissions (${requests.length})`, 'access-request-picker');
    const select = make('select');
    select.setAttribute('aria-label', 'Pending permission request');
    requests.forEach((request, index) => {
      const purpose = request.scopes?.find(scope => scope.startsWith('Purpose:'))?.slice('Purpose:'.length).trim();
      const option = make('option', `${index + 1}. ${request.title}${purpose ? ` — ${purpose}` : ''}`);
      option.value = request.id;
      select.append(option);
    });
    select.value = state.selected;
    select.onchange = () => {
      state.selected = select.value;
      state.signature = null;
      renderPermissionRequests(container, state.requests, state.actions);
      container.querySelector('.access-request-picker select')?.focus({ preventScroll: true });
    };
    label.append(select);
    nodes.push(label);
  }
  for (const request of requests) {
    const requestSignature = JSON.stringify(request);
    const cached = state.cards.get(request.id);
    if (cached?.signature === requestSignature) {
      cached.node.hidden = request.id !== state.selected;
      for (const button of cached.node.querySelectorAll('[data-access-decision]')) button.disabled = state.batchPending === true || state.pending.has(request.id);
      nodes.push(cached.node);
      continue;
    }
    const card = make('article', undefined, 'access-card');
    card.hidden = request.id !== state.selected;
    card.dataset.permissionId = request.id;
    const heading = make('h3', request.title);
    const context = make('div', undefined, 'access-request-context');
    const native = Boolean(request.nativeInvocation);
    if (native) context.append(make('p', `Native tool: ${request.nativeInvocation.toolName}`));
    if (request.elevated) context.append(make('strong', 'Elevated access requested'));
    const scopes = request.scopes ?? [];
    const detailedScope = value => /^(Arguments:|Diff:\n|New contents:\n)/.test(value);
    for (const scope of scopes.filter(value => !detailedScope(value))) {
      context.append(make('p', scope));
    }
    const details = make('details', undefined, 'access-request-details');
    details.append(make('summary', 'Exact request details'), make('pre', request.description));
    const exactScopes = native ? scopes : scopes.filter(detailedScope);
    if (exactScopes.length) {
      const alternate = make('details');
      alternate.append(make('summary', !native && exactScopes.every(value => value.startsWith('Arguments:'))
        ? 'Exact argument scope' : 'Exact security scope'));
      for (const scope of exactScopes) alternate.append(make('pre', scope));
      details.append(alternate);
    }
    if (native) details.append(make('h4', 'Native invocation'),
      make('pre', JSON.stringify({ brokerRequestId: request.id, nativeInvocation: request.nativeInvocation }, null, 2)));
    context.append(details);
    const footer = make('div', undefined, 'access-request-decisions');
    footer.append(make('p', native
      ? 'Once approves only pending native requests. Session access automatically answers future eligible callbacks once; native per-tool grants remain unavailable. Deny rejects this request.'
      : ['Once: this request.', request.canApproveForSession && 'Session: this tool with any arguments.',
        request.canApproveAll && 'All: current and future eligible requests in this private session.'].filter(Boolean).join(' '),
    'access-approval-scope'));
    const buttons = make('div', undefined, 'access-decision-buttons');
    for (const [decision, title, allowed] of [
      ['once', 'Allow once', true], ['denied', 'Deny', true],
      ['session', 'Allow this tool for session', !approvePendingOnce && !native && request.canApproveForSession],
      ['all', 'Allow all eligible access for session', !approvePendingOnce && request.canApproveAll],
    ]) {
      if (!allowed) continue;
      const button = make('button', title);
      button.type = 'button';
      button.dataset.accessDecision = decision;
      button.dataset.requestId = request.id;
      button.disabled = state.batchPending === true || state.pending.has(request.id);
      button.onclick = async () => {
        if (button.disabled || card.hidden || !button.isConnected) return;
        state.pending.add(request.id);
        for (const control of buttons.querySelectorAll('button')) control.disabled = true;
        try {
          await state.actions.decide(request.id, decision);
        } catch (error) {
          state.pending.delete(request.id);
          state.signature = null;
          renderPermissionRequests(container, state.requests, state.actions);
          state.actions.onError(error);
        }
      };
      buttons.append(button);
    }
    footer.append(buttons);
    card.append(heading, context, footer);
    state.cards.set(request.id, { signature: requestSignature, node: card });
    nodes.push(card);
  }
  container.replaceChildren(...nodes);
  const readingPane = state.cards.get(state.selected)?.node.querySelector('.access-request-context');
  if (readingPane) readingPane.scrollTop = readingTop;
  state.renderedSelection = state.selected;
  container.parentElement.scrollTop = 0;
  if (restoreFocus) {
    if (pickerFocused) container.querySelector('.access-request-picker select')?.focus({ preventScroll: true });
    else if (focused.isConnected && !focused.closest('[hidden]')) focused.focus({ preventScroll: true });
  }
}
