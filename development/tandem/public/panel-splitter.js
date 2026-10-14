export function installPanelSplitter({ layout, design, separator, resized }) {
  const narrow = matchMedia('(max-width: 660px)');
  let preferredRatio = null, drag = null, projectLayout = null;
  const stacked = () => projectLayout?.stacked ?? narrow.matches;
  const bounds = () => {
    const width = layout.getBoundingClientRect().width;
    return { width, min: 280, max: width - (projectLayout ? 300 : 340) };
  };
  const refresh = () => {
    separator.hidden = stacked();
    if (stacked()) {
      finish(true);
      return;
    }
    const { width, min, max } = bounds();
    if (width <= 0) return;
    if (projectLayout) {
      const size = Math.max(min, Math.min(max, width - projectLayout.conversationWidth));
      layout.style.setProperty('--panel-columns', `${size}px minmax(0, 1fr)`);
    } else if (preferredRatio !== null) {
      const size = Math.max(min, Math.min(max, preferredRatio * width));
      layout.style.setProperty('--panel-columns', `${size}px minmax(0, 1fr)`);
    } else {
      layout.style.removeProperty('--panel-columns');
    }
    const size = design.getBoundingClientRect().width, percent = Math.round(size / width * 100);
    separator.style.left = `${size - 6}px`;
    separator.setAttribute('aria-valuemin', String(min / width * 100));
    separator.setAttribute('aria-valuemax', String(max / width * 100));
    separator.setAttribute('aria-valuenow', String(size / width * 100));
    separator.setAttribute('aria-valuetext', `Design ${percent}%, Conversation ${100 - percent}%`);
  };
  const resize = size => {
    const { width, min, max } = bounds();
    preferredRatio = Math.max(min, Math.min(max, size)) / width;
    if (projectLayout) {
      projectLayout = { ...projectLayout, conversationWidth: width - preferredRatio * width };
      resized?.(projectLayout.conversationWidth);
    }
    refresh();
  };
  function finish(cancelled) {
    if (!drag) return;
    const previous = drag;
    drag = null;
    delete layout.dataset.resizing;
    if (separator.hasPointerCapture(previous.id)) separator.releasePointerCapture(previous.id);
    if (cancelled) {
      preferredRatio = previous.ratio;
      if (projectLayout && Number.isFinite(previous.conversationWidth)) {
        projectLayout = { ...projectLayout, conversationWidth: previous.conversationWidth };
        resized?.(projectLayout.conversationWidth);
      }
      if (!stacked()) refresh();
    }
  }
  const down = event => {
    if (stacked() || drag || !event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    separator.focus({ preventScroll: true });
    drag = { id: event.pointerId, x: event.clientX, size: design.getBoundingClientRect().width,
      ratio: preferredRatio, conversationWidth: projectLayout?.conversationWidth };
    separator.setPointerCapture(event.pointerId);
    layout.dataset.resizing = 'true';
  };
  const move = event => {
    if (drag?.id === event.pointerId) resize(drag.size + event.clientX - drag.x);
  };
  const up = event => { if (drag?.id === event.pointerId) finish(false); };
  const cancel = event => { if (drag?.id === event.pointerId) finish(true); };
  const blur = () => finish(true);
  const key = event => {
    if (event.key === 'Escape' && drag) { event.preventDefault(); finish(true); return; }
    if (stacked() || drag || event.altKey || event.ctrlKey || event.metaKey) return;
    const { min, max } = bounds(), size = design.getBoundingClientRect().width;
    const step = event.shiftKey ? 40 : 10;
    const next = { ArrowLeft: size - step, ArrowRight: size + step, Home: min, End: max }[event.key];
    if (next === undefined) return;
    event.preventDefault(); resize(next);
  };
  const listeners = { pointerdown: down, pointermove: move, pointerup: up, pointercancel: cancel,
    lostpointercapture: cancel, keydown: key };
  for (const [type, handler] of Object.entries(listeners)) separator.addEventListener(type, handler);
  window.addEventListener('blur', blur);
  narrow.addEventListener('change', refresh);
  const observer = new ResizeObserver(refresh);
  observer.observe(layout);
  refresh();
  return { setProjectLayout(value) { projectLayout = value; refresh(); }, dispose() {
    finish(true);
    observer.disconnect();
    narrow.removeEventListener('change', refresh);
    window.removeEventListener('blur', blur);
    for (const [type, handler] of Object.entries(listeners)) separator.removeEventListener(type, handler);
  } };
}
