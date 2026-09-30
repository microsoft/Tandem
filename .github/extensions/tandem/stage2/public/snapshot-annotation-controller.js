import { captureAnnotatedDiagram, drawAnnotationStrokes } from './annotation-capture.js';
import { sameAnnotationView } from './annotation-model.js';

/** Artifact sketches edit a captured bitmap, never a moving live renderer. */
export function createSnapshotAnnotationController({ panel, getCandidates, getView, selectArtifact,
  getArtifactLabel, controls, onPreviewChange, limits, visibleRegion, frameOf }) {
  const document = panel.ownerDocument;
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const editor = make('dialog', 'annotation-editor');
  editor.setAttribute('aria-label', 'Annotate captured image');
  const heading = make('h2', '', 'Annotate captured image');
  const status = make('p', 'annotation-editor-status');
  status.setAttribute('role', 'status');
  const toolbar = make('div', 'annotation-editor-toolbar');
  const viewport = make('div', 'annotation-editor-viewport');
  const stage = make('div', 'annotation-editor-stage');
  stage.style.cssText = 'position:relative;max-width:100%;';
  const base = make('img', 'annotation-editor-base');
  base.alt = 'Captured artifact';
  base.draggable = false;
  base.style.cssText = 'display:block;width:100%;height:auto;';
  const ink = make('canvas', 'annotation-editor-ink');
  ink.setAttribute('aria-label', 'Draw on captured image');
  ink.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;touch-action:none;';
  stage.append(base, ink);
  viewport.append(stage);
  const buttons = {};
  for (const [action, label] of [['close', 'Return to design'], ['cancel', 'Cancel annotation'], ['clear', 'Clear strokes'],
    ['capture-new', 'Capture new'], ['attach', 'Attach to composer']]) {
    const button = make('button', '', label);
    button.type = 'button'; button.dataset.annotationAction = action;
    buttons[action] = button; toolbar.append(button);
  }
  const confirmation = make('div', 'annotation-editor-confirmation');
  confirmation.hidden = true;
  confirmation.append(make('p', '', 'Replace this saved image and its strokes with the current visible view? Your composer attachment is unchanged.'));
  const replace = make('button', '', 'Replace sketch'), keep = make('button', '', 'Keep sketch');
  replace.type = keep.type = 'button';
  replace.dataset.annotationAction = 'replace';
  keep.dataset.annotationAction = 'keep';
  confirmation.append(replace, keep);
  editor.append(heading, status, toolbar, confirmation, viewport);
  document.body.append(editor);
  const drafts = new Map();
  let active = null, requestedId = null, preview = null, previewUrl = null, busy = false, sending = false, operation = 0, destroyed = false;
  let errorMessage = null;
  let stroke = null;
  controls.tools.hidden = true;
  controls.capture.hidden = controls.reset.hidden = true;
  controls.capture.disabled = controls.reset.disabled = true;
  const navigation = panel.querySelector('.design-navigation');
  const navigationObserver = new ResizeObserver(refresh);
  if (navigation) navigationObserver.observe(navigation);
  const say = text => { status.textContent = text; controls.status.textContent = text; };
  const caption = draft => `Captured ${getArtifactLabel(draft.source.artifactId)}, revision ${draft.source.revisionId}.`;
  function refresh() {
    if (navigation) panel.style.setProperty('--diagram-navigation-height', `${navigation.getBoundingClientRect().height}px`);
    const view = getView();
    for (const button of panel.querySelectorAll('[data-annotate-artifact]')) {
      const id = button.dataset.annotateArtifact, draft = drafts.get(id);
      const open = editor.open && active?.source.artifactId === id;
      button.disabled = busy || sending || (!draft && (view?.artifactId !== id || view?.capabilities?.annotate === false
        || view?.captureUnavailableReason || !getCandidates().length));
      button.setAttribute('aria-pressed', String(Boolean(open)));
      button.dataset.annotationState = open ? 'active' : draft ? 'draft' : 'view';
      const label = draft ? 'Resume sketch' : 'Annotate';
      if (button.textContent !== label) button.textContent = label;
      button.title = draft ? 'Resume the unfinished captured image without replacing it.' : 'Capture the current visible artifact and draw on the static image.';
      const cancel = button.parentElement.querySelector('[data-cancel-annotation-artifact]');
      if (cancel) {
        cancel.hidden = !draft;
        cancel.disabled = sending;
      }
    }
    buttons.cancel.disabled = sending;
    for (const action of ['clear', 'capture-new', 'attach']) buttons[action].disabled = busy || sending || !active;
    buttons['capture-new'].disabled = busy || sending || !requestedId;
    buttons.clear.disabled ||= !active?.strokes.length;
    replace.disabled = busy || sending;
    controls.remove.disabled = sending;
    stage.hidden = !active;
    viewport.hidden = !active;
    if (errorMessage) say(errorMessage);
    else if (active && editor.open && !busy) {
      const changed = view?.artifactId !== active.source.artifactId || view?.revisionId !== active.source.revisionId
        || view?.designDigest !== active.source.designDigest;
      say(`${caption(active)} ${changed ? 'The current Design or artifact differs; this sketch keeps its original source binding. ' : ''}
Draw on this fixed image. Return to design keeps the sketch for later; Cancel annotation discards only this unfinished sketch. Attach finishes this annotation and adds an unsent composer snapshot${preview ? ', replacing the existing one only on success' : ''}.`);
    }
  }
  function redraw() {
    const context = ink.getContext('2d');
    context.clearRect(0, 0, ink.width, ink.height);
    if (active) drawAnnotationStrokes(context, active.strokes);
  }
  function openDraft(draft) {
    active = draft; requestedId = draft.source.artifactId; errorMessage = null; stroke = null; confirmation.hidden = true;
    base.width = draft.source.viewport.width;
    base.height = draft.source.viewport.height;
    base.src = draft.url;
    stage.style.width = `${draft.source.viewport.width}px`;
    ink.width = draft.source.viewport.width;
    ink.height = draft.source.viewport.height;
    redraw();
    if (!editor.open) editor.showModal();
    refresh();
  }
  function returnToDesign() {
    operation++; stroke = null; confirmation.hidden = true;
    if (editor.open) editor.close();
    refresh();
  }
  function cancelAnnotation(id = requestedId) {
    if (sending || !id) return;
    const draft = drafts.get(id);
    drafts.delete(id);
    if (draft) { URL.revokeObjectURL(draft.url); draft.strokes = []; }
    if (requestedId === id || active === draft) {
      active = null; requestedId = null; errorMessage = null;
      base.removeAttribute('src'); redraw();
      returnToDesign();
    } else refresh();
    say('Annotation canceled. Existing composer text and attachments are unchanged.');
    const annotate = panel.querySelector(`[data-annotate-artifact="${id}"]`);
    (annotate?.disabled ? annotate.parentElement.querySelector('.raw-toggle') : annotate)?.focus({ preventScroll: true });
  }
  function cancelFromToolbar(event) {
    const button = event.target.closest?.('[data-cancel-annotation-artifact]');
    if (button && panel.contains(button)) cancelAnnotation(button.dataset.cancelAnnotationArtifact);
  }
  const candidate = () => {
    const view = getView();
    if (view?.captureUnavailableReason) throw new Error(view.captureUnavailableReason);
    if (!view || view.capabilities?.capture === false || view.capabilities?.annotate === false) {
      throw new Error('This artifact does not support image capture.');
    }
    const current = getCandidates().map(item => ({ ...item, region: visibleRegion(item.element, panel), frame: frameOf(item.element) }))
      .filter(item => item.region.width > 0 && item.region.height > 0)
      .sort((a, b) => b.region.width * b.region.height - a.region.width * a.region.height)[0];
    if (!current) throw new Error('Bring the supported artifact into view before capturing. No sketch was replaced.');
    return current;
  };
  function checkSize(source) {
    const { width, height } = source.viewport;
    if (width > limits.edge || height > limits.edge || width * height > limits.pixels) {
      throw new Error('The visible image exceeds the snapshot pixel limit. Make the visible pane smaller; your saved sketch is retained.');
    }
  }
  async function capture(id) {
    if (busy || sending) return;
    const token = ++operation;
    requestedId = id; errorMessage = null; stroke = null; busy = true; refresh();
    let url;
    try {
      if (getView()?.artifactId !== id) throw new Error('Return to this artifact before choosing Capture new.');
      const selected = candidate();
      selected.prepareCapture?.();
      const ready = candidate();
      const source = { ...ready.identity, viewport: ready.region.viewport };
      checkSize(source);
      say('Capturing the visible artifact. Cancel annotation discards this attempt without changing composer attachments.');
      if (!editor.open) editor.showModal();
      const blob = await captureAnnotatedDiagram(ready.element, source.viewport, []);
      const latest = candidate();
      if (latest.frame !== ready.frame || !sameAnnotationView(source, { ...latest.identity, viewport: latest.region.viewport })) {
        throw new Error('The artifact changed during capture. No sketch was replaced; capture the current view again.');
      }
      if (blob.size > limits.bytes) throw new Error('The PNG exceeds 4 MiB. Your saved sketch is retained.');
      url = URL.createObjectURL(blob);
      const image = new Image();
      image.src = url;
      await image.decode();
      if (token !== operation || destroyed) return;
      const draft = { source: structuredClone(source), blob, image, url, strokes: [] };
      const previous = drafts.get(id);
      drafts.set(id, draft);
      if (previous) URL.revokeObjectURL(previous.url);
      openDraft(draft);
      url = null;
    } catch (error) {
      if (token === operation) {
        errorMessage = error.message;
        if (!editor.open) editor.showModal();
      }
    } finally {
      if (url) URL.revokeObjectURL(url);
      busy = false;
      if (token === operation && editor.open && active && !confirmation.hidden) confirmation.hidden = true;
      refresh();
    }
  }
  async function attach() {
    if (busy || sending || !active) return;
    const draft = active, token = ++operation;
    let nextUrl;
    errorMessage = null; stroke = null; busy = true; refresh();
    try {
      checkSize(draft.source);
      const canvas = make('canvas');
      canvas.width = draft.source.viewport.width; canvas.height = draft.source.viewport.height;
      const context = canvas.getContext('2d');
      context.drawImage(draft.image, 0, 0);
      drawAnnotationStrokes(context, draft.strokes);
      const blob = await new Promise((resolve, reject) => canvas.toBlob(
        value => value ? resolve(value) : reject(new Error('The annotated image could not be encoded. Your sketch is retained.')), 'image/png'));
      if (blob.size > limits.bytes) throw new Error('The PNG exceeds 4 MiB. Your sketch and composer attachment are retained.');
      if (token !== operation || destroyed) return;
      nextUrl = URL.createObjectURL(blob);
      const next = { blob, source: structuredClone(draft.source), url: nextUrl };
      await onPreviewChange(next);
      if (token !== operation || destroyed) return;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = nextUrl; nextUrl = null; preview = next;
      controls.image.src = previewUrl;
      controls.preview.hidden = false;
      controls.caption.replaceChildren(
        make('span', 'annotation-preview-status', 'Not sent. '),
        make('span', 'annotation-preview-provenance', `PNG snapshot - ${draft.source.artifactId}, revision ${draft.source.revisionId}.`));
      drafts.delete(draft.source.artifactId);
      URL.revokeObjectURL(draft.url);
      draft.strokes = []; active = null; requestedId = null;
      base.removeAttribute('src'); redraw();
      say('Annotation finished. Snapshot attached to composer, not sent.');
      returnToDesign();
    } catch (error) { if (token === operation) errorMessage = error.message; }
    finally { if (nextUrl) URL.revokeObjectURL(nextUrl); busy = false; refresh(); }
  }
  const point = event => {
    const bounds = ink.getBoundingClientRect();
    return { x: Math.max(0, Math.min(ink.width, (event.clientX - bounds.left) * ink.width / bounds.width)),
      y: Math.max(0, Math.min(ink.height, (event.clientY - bounds.top) * ink.height / bounds.height)) };
  };
  ink.addEventListener('pointerdown', event => {
    if (event.button !== 0 || busy || sending || !active) return;
    stroke = [point(event)]; active.strokes.push(stroke);
    ink.setPointerCapture(event.pointerId); redraw(); refresh();
  });
  ink.addEventListener('pointermove', event => { if (!busy && !sending && stroke && ink.hasPointerCapture(event.pointerId)) { stroke.push(point(event)); redraw(); } });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) ink.addEventListener(name, () => { stroke = null; });
  buttons.close.addEventListener('click', returnToDesign);
  buttons.cancel.addEventListener('click', () => cancelAnnotation());
  editor.addEventListener('cancel', event => { event.preventDefault(); cancelAnnotation(); });
  panel.addEventListener('click', cancelFromToolbar);
  buttons.clear.addEventListener('click', () => { if (!busy && !sending && active) { errorMessage = null; active.strokes = []; stroke = null; redraw(); refresh(); } });
  buttons['capture-new'].addEventListener('click', () => {
    if (busy || sending) return;
    if (active) confirmation.hidden = false;
    else if (requestedId) void capture(requestedId);
  });
  keep.addEventListener('click', () => { confirmation.hidden = true; });
  replace.addEventListener('click', () => { if (active) void capture(active.source.artifactId); });
  buttons.attach.addEventListener('click', () => { void attach(); });
  function removePreview() {
    preview = null;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null; controls.image.removeAttribute('src'); controls.preview.hidden = true; onPreviewChange(null); refresh();
  }
  controls.remove.addEventListener('click', removePreview);
  const observer = new MutationObserver(refresh);
  observer.observe(panel.querySelector('#backbone-proposal'), { childList: true, subtree: true });
  return {
    refresh,
    toggleArtifact(id) {
      if (busy || sending) return;
      selectArtifact(id);
      const draft = drafts.get(id);
      if (draft) openDraft(draft);
      else { active = null; void capture(id); }
    },
    togglePerspective(id) { this.toggleArtifact(id); },
    preview: () => preview, removePreview, isCapturing: () => busy,
    setSending(value) { sending = value; refresh(); },
    close() {
      destroyed = true; operation++; observer.disconnect(); navigationObserver.disconnect(); editor.remove();
      panel.removeEventListener('click', cancelFromToolbar);
      controls.remove.removeEventListener('click', removePreview);
      for (const draft of drafts.values()) URL.revokeObjectURL(draft.url);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
  };
}
