import { validateDesign, resolveDesignReference } from '../sketch/design-contract.js';
import { renderSketch } from '../sketch/renderer.js';
import { renderArtifact } from '../artifacts/renderer.js';
import { artifactCapabilities, artifactNoteTarget } from '../artifacts/contract.js';

/** The same view host mounts every artifact; purpose and layout come entirely from data. */
export function createSharedDesignView({ tabs, mount, onChange = () => {}, onAnnotate = () => {} }) {
  const document = mount.ownerDocument;
  const make = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  let design = null, fingerprint = null, selected = null, selectedElement = null, figure = null, rawVisible = false;
  const scrollPositions = new Map();
  const viewStates = new Map();
  let restoring = false;
  let closeExpanded = null;
  function expand(section, button) {
    const rendered = figure, state = rendered.getViewState?.(), focus = document.activeElement;
    const positions = [...section.querySelectorAll('*')];
    const background = [];
    for (let node = section; node; node = node.parentElement) {
      positions.push(node);
      for (const sibling of node.parentElement?.children ?? []) {
        // Annotation keeps its existing top-layer dialog above the expanded view.
        if (sibling !== node && sibling.localName !== 'dialog') {
          background.push([sibling, sibling.inert]); sibling.inert = true;
        }
      }
    }
    const scroll = positions.map(node => [node, node.scrollTop, node.scrollLeft]);
    const overflow = document.documentElement.style.overflow;
    const frameDocument = rendered.captureElement?.contentDocument;
    const focusable = root => [...root.querySelectorAll('button, input, select, textarea, a[href], iframe, summary, [tabindex]')]
      .filter(node => !node.disabled && node.tabIndex >= 0 && node.getClientRects().length);
    const keydown = event => {
      if (document.querySelector('dialog:modal')) return;
      if (event.key === 'Escape') { event.preventDefault(); closeExpanded?.(); }
      if (event.key === 'Tab') {
        if (event.currentTarget === frameDocument) {
          const inner = focusable(frameDocument);
          if (event.shiftKey || inner.length && frameDocument.activeElement !== inner.at(-1)) return;
        }
        const controls = focusable(section);
        const first = controls[0], last = controls.at(-1), active = document.activeElement;
        if (event.shiftKey && active === first || !event.shiftKey && active === last) {
          event.preventDefault(); (event.shiftKey ? last : first)?.focus({ preventScroll: true });
        }
      }
    };
    section.dataset.artifactExpanded = 'true';
    section.setAttribute('role', 'dialog'); section.setAttribute('aria-modal', 'true');
    document.documentElement.style.overflow = 'hidden';
    button.textContent = 'Close'; button.setAttribute('aria-label', 'Close expanded artifact');
    button.setAttribute('aria-expanded', 'true');
    document.addEventListener('keydown', keydown);
    frameDocument?.addEventListener('keydown', keydown);
    closeExpanded = (restoreFocus = true) => {
      closeExpanded = null;
      delete section.dataset.artifactExpanded;
      section.removeAttribute('role'); section.removeAttribute('aria-modal');
      document.documentElement.style.overflow = overflow;
      for (const [node, inert] of background) node.inert = inert;
      document.removeEventListener('keydown', keydown);
      frameDocument?.removeEventListener('keydown', keydown);
      button.textContent = 'Expand'; button.setAttribute('aria-label', 'Expand artifact');
      button.setAttribute('aria-expanded', 'false');
      if (state) rendered.restoreViewState(state);
      else rendered.refreshLayout?.();
      for (const [node, top, left] of scroll) { node.scrollTop = top; node.scrollLeft = left; }
      if (restoreFocus) focus?.focus({ preventScroll: true });
      if (restoreFocus) onChange();
    };
    section.scrollTop = section.scrollLeft = 0;
    rendered.fitToView?.();
    button.focus({ preventScroll: true });
    onChange();
  }
  const groupSelections = new Map();
  const groups = [['user-story', 'User story'], ['ui', 'UI'], ['workflows', 'Workflows'],
    ['contracts-data', 'Contracts & Data'], ['system', 'System'], ['ungrouped', 'Ungrouped']];
  const categoryOf = artifact => ['artifact/v1', 'artifact/v2'].includes(artifact.schemaVersion)
    && artifact.category && artifact.category !== 'experience' ? artifact.category : 'ungrouped';
  function primaryArtifact(artifact) {
    while (artifactNoteTarget(artifact)) artifact = design.content.artifacts.find(item => item.id === artifactNoteTarget(artifact));
    return artifact;
  }
  function updateNavigation() {
    const primary = primaryArtifact(currentArtifact());
    const category = categoryOf(primary);
    groupSelections.set(category, primary.id);
    for (const button of tabs.querySelectorAll('[data-artifact-group]')) {
      button.setAttribute('aria-pressed', String(button.dataset.artifactGroup === category));
    }
    for (const button of tabs.querySelectorAll('[data-artifact-tab]')) {
      button.hidden = button.dataset.artifactCategory !== category;
      button.setAttribute('aria-pressed', String(button.dataset.artifactTab === primary.id));
    }
  }
  function rememberScroll() {
    if (!selected || !figure || restoring) return;
    const state = figure.getViewState?.();
    if (state) viewStates.set(selected, state);
    const positions = [];
    for (let node = mount.parentElement; node; node = node.parentElement) {
      positions.push({ node, top: node.scrollTop, left: node.scrollLeft });
    }
    scrollPositions.set(selected, positions);
  }
  function restoreScroll() {
    // Tab replacement can clamp ancestor scroll while the next frame is loading.
    // Restore only the retained view, never an annotation's source/crop binding.
    for (const { node, top, left } of scrollPositions.get(selected) ?? []) {
      node.scrollTop = top; node.scrollLeft = left;
    }
  }
  let detail;
  const currentArtifact = () => design?.content.artifacts.find(({ id }) => id === selected);
  function showElement(item, focus = false) {
    selectedElement = item.elementId;
    detail.hidden = false;
    detail.replaceChildren(make('summary', item.label || item.reference),
      ...(item.caption === undefined ? [] : [make('p', item.caption, 'artifact-element-caption')]),
      ...(item.body === undefined ? [] : [make('pre', item.body, 'artifact-element-body')]),
      make('p', item.details || 'No additional detail was recorded.'), make('code', item.reference));
    detail.open = true;
    if (focus && item.elementId) {
      const selectedFigure = figure;
      const reveal = () => {
        if (figure !== selectedFigure || selectedElement !== item.elementId) return;
        const node = [...figure.querySelectorAll('[data-sketch-box], [data-sketch-connection]')]
          .find((node) => node.dataset.sketchBox === item.elementId || node.dataset.sketchConnection === item.elementId)
          ?? [...(figure.captureElement?.contentDocument?.querySelectorAll('[data-ref], [id]') ?? [])]
            .find((node) => (node.getAttribute('data-ref') ?? node.id) === item.elementId);
        (figure.captureElement ?? node)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        node?.focus({ preventScroll: true });
      };
      if (figure.ready) figure.ready.then(reveal).catch(() => {});
      else reveal();
    }
    onChange();
  }
  function renderSelected() {
    const refocus = Boolean(closeExpanded) && !document.querySelector('dialog:modal');
    closeExpanded?.(false);
    figure?.dispose?.();
    restoring = false;
    rawVisible = false;
    const artifact = currentArtifact();
    if (!artifact) { mount.replaceChildren(); figure = null; return; }
    const section = make('section', undefined, 'backbone-view shared-artifact-view');
    if (refocus) section.tabIndex = -1;
    section.dataset.designArtifact = artifact.id;
    section.setAttribute('aria-label', artifact.title);
    const toolbar = make('div', undefined, 'perspective-toolbar');
    const annotate = make('button', 'Annotate', 'annotation-view-toggle');
    annotate.type = 'button'; annotate.dataset.annotateArtifact = artifact.id;
    annotate.addEventListener('click', () => { if (artifactCapabilities(artifact).annotate) onAnnotate(artifact.id); });
    const rawButton = make('button', 'View raw', 'raw-toggle');
    rawButton.type = 'button'; rawButton.setAttribute('aria-expanded', 'false');
    const raw = make('pre', JSON.stringify(artifact, null, 2), 'raw-block');
    raw.id = 'artifact-raw'; raw.hidden = true; rawButton.setAttribute('aria-controls', raw.id);
    rawButton.addEventListener('click', () => {
      rawVisible = !rawVisible;
      raw.hidden = !rawVisible; rawButton.setAttribute('aria-expanded', String(rawVisible));
      onChange();
    });
    if (artifactCapabilities(artifact).annotate) {
      const cancel = make('button', 'Cancel annotation', 'annotation-cancel');
      cancel.type = 'button'; cancel.dataset.cancelAnnotationArtifact = artifact.id; cancel.hidden = true;
      toolbar.append(annotate, cancel);
    }
    const parentId = artifactNoteTarget(artifact);
    if (parentId) {
      const companion = design.content.artifacts.find(item => item.id === parentId);
      const button = make('button', `Back to ${companion.title}`);
      button.type = 'button'; button.dataset.notePrimary = companion.id;
      if (artifact.visualCompanionId) button.dataset.visualCompanion = companion.id;
      button.addEventListener('click', () => {
        selectArtifact(companion.id);
        mount.querySelector(`[data-artifact-note="${artifact.id}"]`)?.focus({ preventScroll: true });
      });
      toolbar.append(button);
    }
    for (const note of design.content.artifacts.filter(item => artifactNoteTarget(item) === artifact.id)) {
      const button = make('button', `Notes: ${note.title}`);
      button.type = 'button'; button.dataset.artifactNote = note.id;
      button.addEventListener('click', () => {
        selectArtifact(note.id);
        mount.querySelector('[data-note-primary]')?.focus({ preventScroll: true });
      });
      toolbar.append(button);
    }
    const expandButton = make('button', 'Expand');
    expandButton.type = 'button'; expandButton.dataset.artifactExpand = '';
    expandButton.title = 'Expand within the Tandem browser document. Close or Escape restores the previous view.';
    expandButton.setAttribute('aria-label', 'Expand artifact'); expandButton.setAttribute('aria-expanded', 'false');
    expandButton.addEventListener('click', () => closeExpanded ? closeExpanded() : expand(section, expandButton));
    toolbar.append(rawButton, expandButton);
    section.append(toolbar, raw);
    if (primaryArtifact(artifact).category === 'experience') {
      section.append(make('p', 'This retained artifact has no separate User story or UI category. Its original content is unchanged.', 'artifact-category-notice'));
    }
    if (artifact.description) {
      const description = make('p', artifact.description, 'artifact-description');
      if (document.body.dataset.projectPanel) {
        const about = make('details', undefined, 'artifact-about');
        about.append(make('summary', 'About this artifact'), description); section.append(about);
      } else section.append(description);
    }
    figure = (['artifact/v1', 'artifact/v2'].includes(artifact.schemaVersion) ? renderArtifact : renderSketch)(document, artifact, { onSelect: (item) =>
      showElement(resolveDesignReference(design.content, `${artifact.id}#${item.id}`)) });
    figure.dataset.artifactId = artifact.id;
    detail = make('details', undefined, 'artifact-element-details'); detail.hidden = true;
    section.append(figure, detail); mount.replaceChildren(section);
    if (figure.ready) {
      const rendered = figure;
      restoring = true;
      annotate.disabled = true;
      expandButton.disabled = true;
      rendered.ready.then(() => {
        if (figure !== rendered) return;
        const state = viewStates.get(selected);
        if (state) rendered.restoreViewState(state);
        restoreScroll();
        restoring = false; annotate.disabled = false; expandButton.disabled = false;
        if (refocus && !document.querySelector('dialog:modal')) expandButton.focus({ preventScroll: true });
        onChange();
      }).catch((error) => {
        if (figure !== rendered) return;
        annotate.disabled = true;
        const failure = make('p', `Artifact is not displayed: ${error.message}`, 'design-render-error');
        failure.setAttribute('role', 'alert'); section.append(failure);
        if (refocus && !document.querySelector('dialog:modal')) section.focus({ preventScroll: true });
        onChange();
      });
    }
    updateNavigation();
    onChange();
    if (!figure.ready) {
      const state = viewStates.get(selected);
      if (state) figure.restoreViewState(state);
      restoreScroll(); onChange();
    }
  }
  function selectArtifact(id) {
    if (!design?.content.artifacts.some((artifact) => artifact.id === id)) throw new Error('The requested artifact is not in this Design.');
    if (selected === id && figure) return;
    closeExpanded?.(false);
    rememberScroll();
    selected = id; selectedElement = null; renderSelected();
  }
  return {
    render(value) {
      if (!value?.content) {
        closeExpanded?.(false);
        figure?.dispose?.();
        design = null; fingerprint = null; selected = null; selectedElement = null; figure = null;
        scrollPositions.clear();
        viewStates.clear();
        groupSelections.clear();
        tabs.replaceChildren(); mount.replaceChildren(); onChange(); return;
      }
      let content;
      try { content = validateDesign(value.content); }
      catch (error) {
        closeExpanded?.(false);
        figure?.dispose?.();
        design = null; fingerprint = null; selected = null; selectedElement = null; figure = null;
        scrollPositions.clear();
        viewStates.clear();
        groupSelections.clear();
        tabs.replaceChildren();
        const failure = make('p', `Design is not displayed: ${error.message}`, 'design-render-error');
        failure.setAttribute('role', 'alert'); mount.replaceChildren(failure); onChange(); throw error;
      }
      if (!value.binding?.revisionId || !value.binding.digest) throw new Error('Published Design has no revision binding.');
      const next = JSON.stringify(content);
      if (design?.binding.revisionId === value.binding.revisionId && design.binding.digest === value.binding.digest) {
        if (next !== fingerprint) throw new Error('Design content changed without a new bound revision.');
        return;
      }
      design = { binding: { ...value.binding }, content }; fingerprint = next;
      scrollPositions.clear();
      viewStates.clear();
      groupSelections.clear();
      const primaryArtifacts = content.artifacts.filter(artifact => !artifactNoteTarget(artifact));
      if (!content.artifacts.some(({ id }) => id === selected)) selected = primaryArtifacts[0].id;
      selectedElement = null;
      const groupRow = make('div', undefined, 'artifact-navigation-row');
      groupRow.setAttribute('role', 'group'); groupRow.setAttribute('aria-label', 'Artifact categories');
      const artifactRow = make('div', undefined, 'artifact-navigation-row');
      artifactRow.setAttribute('role', 'group'); artifactRow.setAttribute('aria-label', 'Artifacts');
      for (const [category, label] of groups) {
        const first = primaryArtifacts.find(artifact => categoryOf(artifact) === category);
        if (!first) continue;
        const button = make('button', label); button.type = 'button'; button.dataset.artifactGroup = category;
        button.addEventListener('click', () => selectArtifact(groupSelections.get(category) ?? first.id));
        groupRow.append(button);
      }
      artifactRow.append(...primaryArtifacts.map((artifact) => {
        const button = make('button', artifact.title); button.type = 'button'; button.dataset.artifactTab = artifact.id;
        button.dataset.artifactCategory = categoryOf(artifact);
        button.addEventListener('click', () => selectArtifact(artifact.id)); return button;
      }));
      tabs.replaceChildren(groupRow, artifactRow);
      renderSelected();
    },
    selectArtifact,
    inspectReference(binding, reference) {
      if (!design || binding?.revisionId !== design.binding.revisionId || binding?.digest !== design.binding.digest) {
        throw new Error('This reference belongs to another retained Design revision; it was not rebound to the current view.');
      }
      const item = resolveDesignReference(design.content, reference);
      selectArtifact(item.artifactId); showElement(item, true);
    },
    current() {
      return design && selected ? { artifactId: selected, revisionId: design.binding.revisionId, designDigest: design.binding.digest,
        capabilities: artifactCapabilities(currentArtifact()),
        captureUnavailableReason: rawVisible ? 'Raw source cannot be annotated or captured. Return to the rendered artifact.' : null } : null;
    },
    label(id) { return design?.content.artifacts.find((artifact) => artifact.id === id)?.title ?? id; },
    candidates() {
      if (restoring || rawVisible) return [];
      const artifact = currentArtifact();
      if (!artifactCapabilities(artifact).capture) return [];
      const surface = artifact?.schemaVersion === 'artifact/v1' ? figure?.captureElement : figure?.querySelector('svg');
      return artifact && surface ? [{ element: surface, label: artifact.title, prepareCapture: figure.refreshLayout, identity: {
        schemaVersion: 'artifact-annotation/v1', artifactId: artifact.id, revisionId: design.binding.revisionId,
        designDigest: design.binding.digest, selectionId: selectedElement,
      } }] : [];
    },
  };
}
