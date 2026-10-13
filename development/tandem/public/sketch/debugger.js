import { SKETCH_VERSION, SKETCH_V1_VERSION, validateSketch } from './contract.js';
import { DESIGN_VERSION, DESIGN_V2_VERSION, DESIGN_V1_VERSION, designGenerationContract, validateDesign } from './design-contract.js';
import { validateArtifact } from '../artifacts/contract.js';
import { renderArtifact } from '../artifacts/renderer.js';
import { layoutSketch, renderSketch } from './renderer.js';
import { createTemplate, templateCatalog } from './templates.js';

/** Validate the complete input before exposing any artifact, without rewriting the source. */
export function parseDebuggerInput(source) {
  const input = JSON.parse(source);
  if (['artifact/v1', 'artifact/v2'].includes(input?.schemaVersion)) {
    const value = validateArtifact(input);
    return { value, artifacts: [value], mode: value.schemaVersion };
  }
  if ([SKETCH_VERSION, SKETCH_V1_VERSION].includes(input?.schemaVersion)) {
    const value = validateSketch(input);
    layoutSketch(value);
    return { value, artifacts: [value], mode: value.schemaVersion };
  }
  const value = validateDesign(input);
  return { value, artifacts: value.artifacts, mode: value.schemaVersion };
}

export function createSampleInput(id = 'collection') {
  if (id !== 'collection') return createTemplate(id);
  const artifacts = templateCatalog.map(({ id: templateId }) => createTemplate(templateId));
  return {
    schemaVersion: DESIGN_VERSION,
    goal: 'Inspect a shared sketch collection using the production contract.',
    summary: 'Optional template data demonstrates compositions, not mandatory artifact kinds.',
    outcomes: [{ id: 'inspect-artifacts', description: 'Select any artifact and inspect its exact details.',
      references: artifacts.map(({ id: artifactId }) => artifactId) }],
    artifacts,
  };
}

export function mountDebugger(document) {
  const get = (id) => document.getElementById(id);
  const source = get('json-input'), selector = get('artifact-select'), preview = get('preview');
  const status = get('validation-status'), errorOutput = get('validation-error');
  const caption = document.createElement('p'), body = document.createElement('pre');
  caption.id = 'selection-caption'; caption.setAttribute('aria-label', 'Selected caption');
  body.id = 'selection-body'; body.setAttribute('aria-label', 'Selected body');
  get('details').before(caption, body);
  let current = null;

  function clearPreview() {
    for (const node of preview.children) node.dispose?.();
    current = null;
    selector.replaceChildren();
    selector.disabled = true;
    preview.replaceChildren();
    for (const id of ['design-details', 'selection-reference', 'selection-label', 'details']) get(id).textContent = '';
    caption.textContent = ''; body.textContent = ''; caption.hidden = true; body.hidden = true;
  }

  function showError(error) {
    clearPreview();
    status.textContent = 'Input rejected. No artifact rendered; your source is unchanged.';
    errorOutput.textContent = error instanceof SyntaxError
      ? `JSON parse error: ${error.message}`
      : `${error.name}${error.code ? ` [${error.code}]` : ''}: ${error.message}`;
    errorOutput.hidden = false;
    source.setAttribute('aria-invalid', 'true');
  }

  function showSelection(artifact, selection = null) {
    get('selection-reference').textContent = selection ? `${artifact.id}#${selection.id}` : artifact.id;
    get('selection-label').textContent = selection ? selection.label : artifact.title;
    get('details').textContent = selection ? selection.details : artifact.description ?? '';
    const node = selection && artifact.boxes?.find(({ id }) => id === selection.id);
    caption.textContent = node?.caption ?? ''; caption.hidden = node?.caption === undefined;
    body.textContent = node?.body ?? ''; body.hidden = node?.body === undefined;
  }

  function renderSelected() {
    const artifact = current?.artifacts.find(({ id }) => id === selector.value);
    if (!artifact) return;
    try {
      const figure = (['artifact/v1', 'artifact/v2'].includes(artifact.schemaVersion) ? renderArtifact : renderSketch)(document, artifact, {
        onSelect: (selection) => showSelection(artifact, selection),
      });
      for (const node of preview.children) node.dispose?.();
      preview.replaceChildren(figure);
      figure.ready?.catch((error) => { if (figure.isConnected) showError(error); });
      showSelection(artifact);
    } catch (error) { showError(error); }
  }

  function validate() {
    const selectedId = selector.value;
    clearPreview();
    errorOutput.hidden = true;
    errorOutput.textContent = '';
    try {
      current = parseDebuggerInput(source.value);
      for (const artifact of current.artifacts) {
        const option = document.createElement('option');
        option.value = artifact.id;
        option.textContent = `${artifact.title} (${artifact.id})`;
        selector.append(option);
      }
      selector.disabled = false;
      if (current.artifacts.some(({ id }) => id === selectedId)) selector.value = selectedId;
      if ([DESIGN_VERSION, DESIGN_V2_VERSION, DESIGN_V1_VERSION].includes(current.mode)) {
        const { goal, summary, outcomes } = current.value;
        get('design-details').textContent = JSON.stringify({ goal, summary, outcomes }, null, 2);
      }
      status.textContent = `Valid ${current.mode}: ${current.artifacts.length} artifact(s). Full input passed production validation and layout.`;
      source.removeAttribute('aria-invalid');
      renderSelected();
    } catch (error) { showError(error); }
  }

  const samples = get('sample-select');
  for (const item of [{ id: 'collection', title: 'Collection — all template data' }, ...templateCatalog]) {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = item.title;
    samples.append(option);
  }
  const loadSample = () => {
    source.value = JSON.stringify(createSampleInput(samples.value), null, 2);
    validate();
  };
  source.addEventListener('input', () => {
    clearPreview();
    errorOutput.hidden = true;
    errorOutput.textContent = '';
    source.removeAttribute('aria-invalid');
    status.textContent = 'Source changed. Validate the complete input to render it.';
  });
  selector.addEventListener('change', renderSelected);
  get('validate-input').addEventListener('click', validate);
  get('load-sample').addEventListener('click', loadSample);
  get('theme-select').addEventListener('change', (event) => {
    document.documentElement.dataset.theme = event.target.value;
  });
  get('generation-contract').textContent = JSON.stringify(designGenerationContract, null, 2);
  loadSample();
}

if (typeof document !== 'undefined' && document.querySelector('[data-sketch-debugger]')) mountDebugger(document);
