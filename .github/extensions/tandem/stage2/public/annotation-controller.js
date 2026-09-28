import { createPerspectiveAnnotationModel, createArtifactAnnotationModel, sameAnnotationView } from './annotation-model.js';
import { captureAnnotatedDiagram, drawAnnotationStrokes } from './annotation-capture.js';
import { createSnapshotAnnotationController } from './snapshot-annotation-controller.js';

export const annotationLimits = Object.freeze({ bytes: 4 * 1024 * 1024, pixels: 4_000_000, edge: 4096 });

function diagramFrame(element) {
  const bounds = element.getBoundingClientRect();
  const matrix = element.getScreenCTM?.();
  // Absolute screen position may change without changing the pinned crop. Keep
  // the diagram's local-to-pixel mapping separate from its immutable source.
  return JSON.stringify([bounds.width, bounds.height, element.clientWidth, element.clientHeight,
    element.getAttribute('viewBox'), element.getAttribute('preserveAspectRatio'),
    matrix && [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e - bounds.left, matrix.f - bounds.top]]);
}

export function visibleDiagramRegion(element, panel) {
  panel = element.closest('[data-artifact-expanded]') ?? panel;
  const bounds = element.getBoundingClientRect();
  const visual = window.visualViewport;
  const offsetLeft = visual?.offsetLeft ?? 0;
  const offsetTop = visual?.offsetTop ?? 0;
  let left = Math.max(offsetLeft, bounds.left);
  let top = Math.max(offsetTop, bounds.top);
  let right = Math.min(offsetLeft + (visual?.width ?? innerWidth), bounds.right);
  let bottom = Math.min(offsetTop + (visual?.height ?? innerHeight), bounds.bottom);
  for (let node = element.parentElement; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    const box = node.getBoundingClientRect();
    if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
      left = Math.max(left, box.left + node.clientLeft);
      right = Math.min(right, box.left + node.clientLeft + node.clientWidth);
    }
    if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
      top = Math.max(top, box.top + node.clientTop);
      bottom = Math.min(bottom, box.top + node.clientTop + node.clientHeight);
    }
    if (node === panel) break;
  }
  for (const selector of ['.panel-heading', '.design-navigation', '.backbone-view:not([hidden]) > .perspective-toolbar']) {
    const toolbar = panel.querySelector(selector);
    if (toolbar && ['sticky', 'fixed'].includes(getComputedStyle(toolbar).position)) {
      const box = toolbar.getBoundingClientRect();
      if (box.bottom > top && box.top < bottom) top = box.bottom;
    }
  }
  const width = Math.max(0, Math.floor(right - left));
  const height = Math.max(0, Math.floor(bottom - top));
  return { left, top, width, height,
    viewport: { x: Math.round(left - bounds.left), y: Math.round(top - bounds.top), width, height, scale: 1 } };
}

export function createAnnotationController({ panel, getCandidates, getView, selectPerspective, selectArtifact,
  artifactMode = false, getArtifactLabel = (id) => id, controls, onPreviewChange = () => {} }) {
  if (artifactMode) return createSnapshotAnnotationController({ panel, getCandidates, getView, selectArtifact,
    getArtifactLabel, controls, onPreviewChange, limits: annotationLimits, visibleRegion: visibleDiagramRegion, frameOf: diagramFrame });
  const model = artifactMode ? createArtifactAnnotationModel() : createPerspectiveAnnotationModel();
  const overlay = document.createElement('canvas');
  overlay.className = 'diagram-annotation-overlay';
  overlay.setAttribute('aria-label', 'Diagram sketch overlay');
  overlay.hidden = true;
  document.body.append(overlay);
  let current = null;
  let previewUrl = null;
  let capturing = false;
  let sending = false;
  const pinnedFrames = new Map();
  const labels = { 'use-case': 'Use cases', contract: 'Data', flow: 'Flow', gui: 'Screens', system: 'System' };
  const keyOf = (view) => artifactMode ? view?.artifactId : view?.perspective;
  const labelOf = (id) => artifactMode ? getArtifactLabel(id) : labels[id];
  const viewAttribute = artifactMode ? 'data-design-artifact' : 'data-design-perspective';
  const buttonAttribute = artifactMode ? 'data-annotate-artifact' : 'data-annotate-perspective';
  const notify = (text) => { if (controls.status.textContent !== text) controls.status.textContent = text; };
  const show = (element, visible) => { if (element.hidden === visible) element.hidden = !visible; };
  function refresh() {
    const selectedView = getView();
    const captureUnavailableReason = selectedView?.captureUnavailableReason;
    const view = selectedView?.capabilities?.annotate === false ? null : selectedView;
    const viewKey = keyOf(view);
    model.select(viewKey ?? null);
    const state = model.snapshot();
    const drafts = model.drafts();
    const otherDrafts = [...drafts].filter(([key, draft]) => key !== viewKey && (draft.mode === 'annotate' || draft.strokes.length));
    const toolbar = view && panel.querySelector(`[${viewAttribute}="${viewKey}"] > .perspective-toolbar`);
    const destination = toolbar ?? controls.parking;
    if (controls.tools.parentElement !== destination) destination.append(controls.tools);
    const annotationActive = Boolean(view && state.mode === 'annotate');
    show(controls.tools, annotationActive);
    for (const control of [controls.reset, controls.capture]) show(control, annotationActive);
    const navigationHeight = `${panel.querySelector('.design-navigation')?.getBoundingClientRect().height ?? 0}px`;
    if (panel.style.getPropertyValue('--diagram-navigation-height') !== navigationHeight) {
      panel.style.setProperty('--diagram-navigation-height', navigationHeight);
    }
    // Show the toolbar before measuring so activating it cannot shift a newly pinned viewport.
    panel.dataset.annotationMode = state.mode;
    current = (view && !captureUnavailableReason && view.capabilities?.capture !== false ? getCandidates() : []).map((candidate) => ({ ...candidate, region: visibleDiagramRegion(candidate.element, panel),
      frame: diagramFrame(candidate.element) }))
      .filter(({ region }) => region.width > 0 && region.height > 0)
      .sort((a, b) => b.region.width * b.region.height - a.region.width * a.region.height)[0] ?? null;
    const source = current && { ...current.identity, viewport: current.region.viewport };
    if (state.binding && current && !pinnedFrames.has(viewKey)) pinnedFrames.set(viewKey, current.frame);
    const stale = state.binding && (!sameAnnotationView(state.binding, source) || pinnedFrames.get(viewKey) !== current?.frame);
    if (stale) model.end();
    for (const button of panel.querySelectorAll(`[${buttonAttribute}]`)) {
      const perspective = button.getAttribute(buttonAttribute), draft = drafts.get(perspective);
      const outdated = draft?.binding && (draft.mode === 'annotate' || draft.strokes.length)
        && draft.binding.revisionId !== view?.revisionId;
      const active = draft?.mode === 'annotate';
      const retained = Boolean(draft?.strokes.length);
      const annotationState = outdated ? 'stale' : active ? 'active' : retained ? 'draft' : 'view';
      button.dataset.annotationState = annotationState;
      button.setAttribute('aria-pressed', String(Boolean(active)));
      button.disabled = !view || (perspective === viewKey && !active && (!getCandidates().length || captureUnavailableReason));
      const description = `Annotate ${labelOf(perspective)}${annotationState === 'active' ? ' — active'
        : annotationState === 'stale' ? ' — earlier revision sketch retained' : retained ? ' — sketch draft retained' : ''}`;
      button.setAttribute('aria-label', description);
      button.title = description;
      const text = active ? 'Annotate: on' : 'Annotate';
      if (button.textContent !== text) button.textContent = text;
    }
    panel.dataset.annotationStale = String(Boolean(stale));
    controls.reset.disabled = (!state.strokes.length && !state.binding) || capturing;
    controls.capture.disabled = !current || stale || capturing || sending;
    const captureLabel = state.preview ? 'Replace composer snapshot' : 'Snapshot to composer';
    if (controls.capture.textContent !== captureLabel) controls.capture.textContent = captureLabel;
    controls.remove.disabled = sending;
    overlay.hidden = state.mode !== 'annotate' || !current || stale;
    if (!overlay.hidden) {
      const { left, top, width, height } = current.region;
      overlay.style.cssText = `left:${left}px;top:${top}px;width:${width}px;height:${height}px;`;
      overlay.width = width;
      overlay.height = height;
      drawAnnotationStrokes(overlay.getContext('2d'), state.strokes);
    }
    notify(stale ? `Sketch for ${artifactMode ? state.binding.artifactId : labels[state.binding.perspective]} is retained for a different revision or viewport. Return to its pinned view or use Reset sketch.${captureUnavailableReason ? ` ${captureUnavailableReason}` : ''}`
      : captureUnavailableReason ? captureUnavailableReason
      : current ? `${state.mode === 'annotate' ? 'Draw on' : 'View'} ${current.label}. Capture creates a local preview only.`
        + (state.mode === 'view' && otherDrafts.length ? ` Sketches in ${otherDrafts.map(([key]) => labelOf(key)).join(', ')} are retained; return to their tabs to continue.` : '')
        : selectedView?.capabilities?.annotate === false
          ? `Read-only document.${otherDrafts.length ? ' Visual sketch drafts are retained in their artifact tabs.' : ''}`
          : 'Scroll a design diagram into view to annotate. No workflow action is started.');
  }
  const point = (event) => {
    const bounds = overlay.getBoundingClientRect();
    return { x: Math.max(0, Math.min(bounds.width, event.clientX - bounds.left)),
      y: Math.max(0, Math.min(bounds.height, event.clientY - bounds.top)) };
  };
  const redraw = () => {
    const context = overlay.getContext('2d');
    context.clearRect(0, 0, overlay.width, overlay.height);
    drawAnnotationStrokes(context, model.snapshot().strokes);
  };
  overlay.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || capturing || !current) return;
    refresh();
    if (overlay.hidden) return;
    try {
      model.begin({ ...current.identity, viewport: current.region.viewport }, point(event));
      overlay.setPointerCapture(event.pointerId);
      redraw();
    } catch (error) { notify(error.message); }
  });
  overlay.addEventListener('pointermove', (event) => {
    if (!overlay.hasPointerCapture(event.pointerId)) return;
    model.move(point(event));
    redraw();
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    overlay.addEventListener(name, () => { model.end(); refresh(); });
  }
  overlay.addEventListener('wheel', (event) => event.preventDefault(), { passive: false });
  function togglePerspective(perspective) {
    const wasSelected = keyOf(getView()) === perspective;
    (artifactMode ? selectArtifact : selectPerspective)(perspective);
    refresh();
    if (getView()?.capabilities?.annotate === false) {
      notify('Document artifacts do not support annotation or PNG capture.');
      return;
    }
    const enabled = !wasSelected || model.snapshot().mode !== 'annotate';
    if (enabled && !current && artifactMode) {
      const candidate = getCandidates()[0];
      candidate?.element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      refresh();
    }
    if (enabled && !current) {
      show(controls.tools, true);
      notify(getView()?.captureUnavailableReason ?? 'The artifact is not visible or is still rendering. Bring it into view before entering Annotate.');
      return;
    }
    model.toggle(enabled);
    refresh();
    if (enabled && !model.snapshot().binding && current) {
      // Revealing the toolbar can add a scrollbar before the renderer's ResizeObserver runs.
      current.prepareCapture?.();
      refresh();
      if (current) model.toggle(true, { ...current.identity, viewport: current.region.viewport });
    }
    refresh();
  }
  controls.reset.addEventListener('click', () => {
    refresh();
    if (controls.reset.disabled) { notify('No current sketch can be reset, or capture is still in progress.'); return; }
    model.clear();
    pinnedFrames.delete(keyOf(getView()));
    refresh();
    if (model.snapshot().mode === 'annotate' && current) {
      current.prepareCapture?.();
      refresh();
      if (current) model.toggle(true, { ...current.identity, viewport: current.region.viewport });
    }
    refresh();
  });
  async function capture() {
    if (sending) throw new Error('Wait for the current image send before replacing its preview.');
    refresh();
    if (getView()?.captureUnavailableReason) throw new Error(getView().captureUnavailableReason);
    if (!current) throw new Error('No visible diagram is available to capture.');
    if (model.snapshot().binding && pinnedFrames.get(keyOf(getView())) !== current.frame) {
      throw new Error('The diagram or viewport changed. Return to the original view or clear the sketch before capturing.');
    }
    const selected = current;
    const source = model.captureBinding({ ...selected.identity, viewport: selected.region.viewport });
    const { width, height } = source.viewport;
    if (width > annotationLimits.edge || height > annotationLimits.edge || width * height > annotationLimits.pixels) {
      throw new Error('The visible diagram exceeds the snapshot pixel limit. Make the visible pane smaller; the sketch is retained.');
    }
    capturing = true;
    refresh();
    try {
      const blob = await captureAnnotatedDiagram(selected.element, source.viewport, model.snapshot().strokes);
      refresh();
      if (!current || selected.frame !== current.frame
        || !sameAnnotationView(source, { ...current.identity, viewport: current.region.viewport })) {
        throw new Error('The diagram changed while capturing. No mismatched image was attached; the sketch is retained.');
      }
      if (blob.size > annotationLimits.bytes) throw new Error('The PNG exceeds 4 MiB. No resizing was applied; your sketch is retained.');
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(blob);
      model.setPreview({ blob, source, url: previewUrl });
      controls.capture.textContent = 'Replace composer snapshot';
      controls.image.src = previewUrl;
      controls.preview.hidden = false;
      controls.caption.textContent = `PNG snapshot - ${keyOf(source)}, revision ${source.revisionId}. Not sent.`;
      onPreviewChange(model.snapshot().preview);
    } finally {
      capturing = false;
      refresh();
    }
    notify('Snapshot is in the composer. Add a message and explicitly Send to share it with the agent.');
  }
  controls.capture.addEventListener('click', () => { void capture().catch((error) => notify(error.message)); });
  function removePreview() {
    model.removePreview();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    controls.image.removeAttribute('src');
    controls.preview.hidden = true;
    controls.capture.textContent = 'Snapshot to composer';
    onPreviewChange(null);
  }
  controls.remove.addEventListener('click', removePreview);
  window.addEventListener('scroll', refresh, true);
  window.addEventListener('resize', refresh);
  window.visualViewport?.addEventListener('resize', refresh);
  window.visualViewport?.addEventListener('scroll', refresh);
  const observer = new MutationObserver(refresh);
  observer.observe(panel.querySelector('#backbone-proposal'), {
    childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class', 'style', 'viewBox', 'transform'],
  });
  const resizeObserver = new ResizeObserver(refresh);
  resizeObserver.observe(panel);
  const heading = panel.querySelector('.panel-heading');
  if (heading) resizeObserver.observe(heading);
  return {
    refresh, togglePerspective, toggleArtifact: togglePerspective, preview: () => model.snapshot().preview, removePreview, isCapturing: () => capturing,
    setSending(value) { sending = value; refresh(); },
    close() {
      observer.disconnect(); resizeObserver.disconnect(); overlay.remove();
      window.removeEventListener('resize', refresh); window.removeEventListener('scroll', refresh, true);
      window.visualViewport?.removeEventListener('resize', refresh); window.visualViewport?.removeEventListener('scroll', refresh);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
  };
}
