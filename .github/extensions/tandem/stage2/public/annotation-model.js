export function sameAnnotationView(left, right) {
  return Boolean(left && right
    && ['schemaVersion', 'revisionId', 'designDigest', 'artifactId', 'perspective', 'selectionId'].every((key) => left[key] === right[key])
    && left.viewport && right.viewport
    && ['x', 'y', 'width', 'height', 'scale'].every((key) => left.viewport[key] === right.viewport[key]));
}

export function createAnnotationModel() {
  let mode = 'view';
  let binding = null;
  let strokes = [];
  let active = null;
  let preview = null;
  const snapshot = () => ({ mode, binding: structuredClone(binding), strokes: structuredClone(strokes), preview });
  return {
    snapshot,
    toggle(enabled, view) {
      mode = enabled ? 'annotate' : 'view';
      if (enabled && !binding && view) binding = structuredClone(view);
      active = null;
      return snapshot();
    },
    begin(view, point) {
      if (mode !== 'annotate') throw new Error('Turn on Annotate to draw.');
      if (binding && !sameAnnotationView(binding, view)) throw new Error('This sketch belongs to another diagram view. Return to that view or explicitly clear the sketch.');
      binding ??= structuredClone(view);
      active = [point];
      strokes.push(active);
    },
    move(point) { if (active) active.push(point); },
    end() { active = null; },
    undo() { active = null; strokes.pop(); },
    clear() { binding = null; strokes = []; active = null; },
    captureBinding(view) {
      if (binding && !sameAnnotationView(binding, view)) throw new Error('The diagram or viewport changed. Return to the original view or clear the sketch before capturing.');
      return structuredClone(binding ?? view);
    },
    setPreview(value) { preview = value; },
    removePreview() { preview = null; },
  };
}

function createAnnotationCollection(isSupported) {
  const drafts = new Map();
  let selected = null, preview = null;
  const active = () => {
    if (!selected) throw new Error('Select a supported diagram before sketching.');
    return drafts.get(selected);
  };
  return {
    select(perspective) {
      if (perspective !== null && !isSupported(perspective)) throw new Error('Unsupported annotation view.');
      if (selected && selected !== perspective) active().end();
      selected = perspective;
      if (selected && !drafts.has(selected)) drafts.set(selected, createAnnotationModel());
    },
    snapshot: () => ({ ...(selected ? active().snapshot() : { mode: 'view', binding: null, strokes: [] }), preview }),
    drafts: () => new Map([...drafts].map(([key, model]) => [key, model.snapshot()])),
    toggle: (enabled, view) => active().toggle(enabled, view),
    begin: (view, point) => active().begin(view, point),
    move: (point) => active().move(point),
    end: () => { if (selected) active().end(); },
    undo: () => active().undo(),
    clear: () => active().clear(),
    captureBinding: (view) => active().captureBinding(view),
    setPreview(value) { preview = value; },
    removePreview() { preview = null; },
  };
}

export function createPerspectiveAnnotationModel() {
  const supported = new Set(['use-case', 'contract', 'flow', 'gui', 'system']);
  return createAnnotationCollection((key) => supported.has(key));
}

export function createArtifactAnnotationModel() {
  return createAnnotationCollection((key) => typeof key === 'string' && key.length > 0);
}
