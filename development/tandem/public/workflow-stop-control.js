export function createWorkflowStopControl({ container, primary, toggle, menu, immediate }, request, onError) {
  let current = null, connected = false, pending = false, inFlight = false;
  const allowed = mode => connected && !pending && !inFlight
    && Boolean(mode === 'immediate' ? current?.canStopNow : current?.canStop);
  function close(focus = false) {
    menu.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    if (focus && !toggle.disabled) toggle.focus({ preventScroll: true });
  }
  function open() {
    if (!allowed('immediate')) return;
    menu.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    immediate.focus({ preventScroll: true });
    menu.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  async function send(mode) {
    if (!allowed(mode)) return;
    close(); inFlight = true; update();
    try { await request(mode); } catch (error) { onError(error); }
    finally { inFlight = false; update(); }
  }
  primary.onclick = () => send('after-step');
  immediate.onclick = () => send('immediate');
  toggle.onclick = () => menu.hidden ? open() : close(true);
  toggle.addEventListener('keydown', event => {
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); open(); }
  });
  container.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !menu.hidden) {
      event.preventDefault(); event.stopPropagation(); close(true);
    } else if (event.key === 'Tab') close();
    else if (!menu.hidden && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); immediate.focus({ preventScroll: true });
    }
  });
  container.ownerDocument.addEventListener('pointerdown', event => {
    if (!container.contains(event.target)) close();
  });
  function update() {
    container.hidden = !current?.canStop && !current?.canStopNow;
    primary.hidden = container.hidden;
    primary.disabled = !allowed('after-step');
    toggle.disabled = immediate.disabled = !allowed('immediate');
    if (container.hidden || toggle.disabled) close();
  }
  return {
    render(view, options) {
      current = view; connected = options.connected; pending = options.pending;
      update();
    },
  };
}
