import { validateArtifact, artifactReferences } from './validation.js';
import { isDocumentArtifact, renderDocument } from './documents.js';
export { artifactSchema, documentArtifactSchema, artifactRules, validateArtifact, artifactReferences, artifactCapabilities, isDocumentArtifact } from './validation.js';

let mermaidModule;
let renderQueue = Promise.resolve();
let sequence = 0;
function htmlSurfaceSize(body, width, height) {
  const size = { width: Math.max(width, body.scrollWidth), height: Math.max(height, body.scrollHeight) };
  if (size.width === width && size.height === height) return size;
  if (size.width > 4096 || size.height > 4096) {
    throw new Error('HTML content exceeds the 4096px rendered surface limit; reduce its layout size');
  }
  // Resolve the source at its authored viewport before enlarging the paint
  // surface. Otherwise height media queries and viewport units change the design.
  const view = body.ownerDocument.defaultView;
  const styles = [body.ownerDocument.documentElement, body, ...body.querySelectorAll('*')].filter(node => node.localName !== 'style').map(node => {
    const computed = view.getComputedStyle(node);
    return [node, [...computed].map(property => [property, computed.getPropertyValue(property), node.style.getPropertyPriority(property)])];
  });
  for (const [node, properties] of styles) {
    for (const [property, value, priority] of properties) node.style.setProperty(property, value, priority);
  }
  for (const root of [body.ownerDocument.documentElement, body]) root.style.setProperty('overflow', 'visible', 'important');
  return size;
}

function renderMermaid(source, document) {
  const render = renderQueue.then(async () => {
    const mermaid = (await (mermaidModule ??= import('./vendor/mermaid.js'))).default;
    const primaryTextColor = '#243d38', tertiaryColor = '#f5f2e9';
    const erDiagram = /^\s*erDiagram\b/.test(source);
    mermaid.initialize({
      startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true,
      maxTextSize: 20_000, maxEdges: 300,
      flowchart: { htmlLabels: false, useMaxWidth: true, nodeSpacing: 24, rankSpacing: 36 },
      sequence: { useMaxWidth: true, actorMargin: 35, messageMargin: 28 },
      htmlLabels: false, theme: 'base', deterministicIds: true,
      themeCSS: erDiagram
        ? `.edgeLabel .background { fill: ${tertiaryColor}; } .edgeLabel text { fill: ${primaryTextColor}; }` : '',
      themeVariables: {
        fontFamily: 'system-ui, sans-serif', fontSize: '14px',
        primaryColor: '#e0eee2', primaryTextColor, primaryBorderColor: '#547c65',
        lineColor: '#567469', secondaryColor: '#deebfa', tertiaryColor,
        ...(erDiagram ? { edgeLabelBackground: tertiaryColor } : {}),
      },
    });
    const { svg } = await mermaid.render(`artifact-mermaid-${++sequence}`, source);
    const template = document.createElement('template');
    template.innerHTML = svg;
    const element = template.content.firstElementChild;
    if (element?.localName !== 'svg' || element.querySelector('script,foreignObject,a,image,use')
      || [...element.querySelectorAll('*')].some(node => [...node.attributes].some(attribute => /^on/i.test(attribute.name) || /^(?:href|xlink:href)$/i.test(attribute.name)))) {
      throw new Error('Mermaid produced unsupported active or HTML content');
    }
    return element;
  });
  renderQueue = render.catch(() => {});
  return render;
}

export function renderArtifact(document, input, { onSelect } = {}) {
  const artifact = validateArtifact(input);
  if (isDocumentArtifact(artifact)) return renderDocument(document, artifact);
  const references = artifactReferences(artifact);
  const figure = document.createElement('figure');
  figure.className = 'source-artifact';
  figure.dataset.artifactId = artifact.id;
  figure.dataset.artifactFormat = artifact.format;
  figure.style.cssText = 'margin:0;min-width:0;width:100%;';
  const caption = document.createElement('figcaption');
  caption.textContent = artifact.title;
  figure.append(caption);
  const controls = document.createElement('div');
  controls.setAttribute('role', 'group');
  controls.setAttribute('aria-label', 'Artifact zoom');
  controls.style.cssText = 'display:flex;align-items:center;gap:8px;margin:8px 0;';
  const status = document.createElement('output');
  status.setAttribute('aria-live', 'polite');
  const viewport = document.createElement('div');
  viewport.dataset.artifactViewport = '';
  viewport.style.cssText = 'overflow:auto;max-width:100%;width:100%;position:relative;';
  const surface = document.createElement('div');
  surface.style.cssText = 'position:relative;overflow:hidden;';
  const iframe = document.createElement('iframe');
  iframe.title = artifact.title;
  iframe.setAttribute('sandbox', 'allow-same-origin');
  iframe.setAttribute('referrerpolicy', 'no-referrer');
  iframe.style.cssText = `display:block;border:0;position:absolute;left:0;top:0;width:${artifact.width}px;height:${artifact.height}px;transform-origin:0 0;`;
  surface.append(iframe);
  viewport.append(surface);
  figure.append(controls, viewport);
  figure.captureElement = null;
  let renderedWidth = artifact.width, renderedHeight = artifact.height;
  let scale = 1, fit = true, disposed = false, failed = false, observer, timeout, cancelReady, selectedBody;
  const window = document.defaultView;
  function paneAncestors() {
    const result = [], panel = figure.closest('[data-artifact-expanded], #design-panel, [data-artifact-panel]');
    for (let node = figure.parentElement; node; node = node.parentElement) {
      const overflow = window?.getComputedStyle(node).overflowY;
      if (['auto', 'scroll', 'hidden', 'clip'].includes(overflow) && node.clientHeight) result.push({ node, overflow });
      if (node === panel) break;
    }
    return result;
  }
  function revealOverview() {
    // Only the explicit Fit action navigates the outer pane. Rendering, capture
    // preparation, restoration and ordinary zoom must not move that pane.
    for (const { node, overflow } of paneAncestors()) {
      if (!['auto', 'scroll'].includes(overflow)) continue;
      const pane = node.getBoundingClientRect(), bounds = figure.getBoundingClientRect();
      const top = pane.top + node.clientTop, bottom = top + node.clientHeight;
      const delta = bounds.top < top ? bounds.top - top : bounds.bottom > bottom ? bounds.bottom - bottom : 0;
      if (delta) node.scrollTop += delta > 0 ? Math.ceil(delta) : Math.floor(delta);
    }
  }
  function resize() {
    if (disposed || failed) return;
    const panel = figure.closest('[data-artifact-expanded], #design-panel, [data-artifact-panel]');
    const width = Math.max(1, viewport.clientWidth || panel?.clientWidth || 480);
    const panelSizing = panel?.computedStyleMap?.().get('height')?.toString() || panel?.style.height || 'auto';
    const panelOverflow = panel && window?.getComputedStyle(panel).overflowY;
    const constrainedPanel = panelSizing !== 'auto' || ['auto', 'scroll', 'hidden', 'clip'].includes(panelOverflow);
    // Reserve host chrome without measuring transient annotation controls or the
    // figure's screen position. Auto-height ancestors cannot define their own fit.
    const panelHeight = constrainedPanel && panel?.clientHeight ? panel.clientHeight - 160 : 480;
    let height = Math.max(1, Math.min(480, panelHeight, (window?.innerHeight || 640) - 160));
    if (panel?.dataset.artifactExpanded === 'true') height = Math.max(1, viewport.clientHeight);
    const chrome = Math.max(0, viewport.getBoundingClientRect().top - figure.getBoundingClientRect().top);
    for (const { node } of paneAncestors()) height = Math.min(height, Math.max(1, node.clientHeight - chrome));
    if (fit) scale = Math.min(1, width / renderedWidth, height / renderedHeight);
    iframe.style.transform = `scale(${scale})`;
    surface.style.width = `${renderedWidth * scale}px`;
    surface.style.height = `${renderedHeight * scale}px`;
    viewport.style.maxHeight = `${height}px`;
    status.textContent = `${Math.round(scale * 100)}%${fit ? ' · Fit' : ''}`;
    figure.dataset.artifactScale = String(scale);
  }
  function fitToView() {
    fit = true; resize();
    viewport.scrollLeft = viewport.scrollTop = 0;
    // Resolve the width released by inner scrollbars before revealing the image.
    resize();
  }
  for (const [action, label] of [['fit', 'Fit'], ['out', '−'], ['in', '+'], ['actual', '100%']]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.artifactZoom = action;
    button.textContent = label;
    button.setAttribute('aria-label', { fit: 'Fit entire artifact', out: 'Zoom out', in: 'Zoom in', actual: 'Authored size' }[action]);
    button.addEventListener('click', () => {
      if (action === 'fit') { fitToView(); revealOverview(); }
      else {
        fit = false;
        scale = action === 'actual' ? 1 : Math.min(2, Math.max(0.1, scale + (action === 'in' ? 0.25 : -0.25)));
        resize();
      }
    });
    controls.append(button);
  }
  controls.append(status);
  figure.refreshLayout = resize;
  figure.fitToView = fitToView;
  figure.getViewState = () => figure.captureElement && !disposed && !failed
    ? { fit, scale, scrollLeft: viewport.scrollLeft, scrollTop: viewport.scrollTop } : null;
  figure.restoreViewState = state => {
    if (!figure.captureElement || disposed || failed) throw new Error('Artifact view restoration requires a ready renderer');
    if (!state || typeof state.fit !== 'boolean' || !Number.isFinite(state.scale) || state.scale <= 0 || state.scale > 2
      || ![state.scrollLeft, state.scrollTop].every(value => Number.isFinite(value) && value >= 0)) {
      throw new Error('Invalid artifact view state');
    }
    fit = state.fit; scale = state.scale;
    resize();
    viewport.scrollLeft = state.scrollLeft; viewport.scrollTop = state.scrollTop;
  };
  resize();
  const select = event => {
    const target = event.target?.closest?.('[data-ref], [id]');
    const id = target?.getAttribute('data-ref') ?? target?.getAttribute('id');
    const item = references.find(reference => reference.id === id);
    if (item) onSelect?.(item, event);
  };
  const markup = artifact.format === 'mermaid' ? renderMermaid(artifact.source, document).then(svg => {
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.style.maxWidth = 'none';
    return svg.outerHTML;
  }) : Promise.resolve(artifact.source);
  figure.ready = new Promise((resolve, reject) => {
      cancelReady = reject;
      timeout = setTimeout(() => reject(new Error('Artifact frame did not become ready; attach the figure to the document before awaiting ready')), 15_000);
      iframe.addEventListener('load', async () => {
        try {
          const body = iframe.contentDocument?.body;
          if (!body || !body.hasAttribute('data-artifact-surface')) return;
          for (const root of [body.ownerDocument.documentElement, body]) {
            for (const [property, value] of Object.entries({
              width: `${artifact.width}px`, height: `${artifact.height}px`,
              'min-width': '0', 'min-height': '0', 'max-width': 'none', 'max-height': 'none',
              margin: '0', border: '0', 'box-sizing': 'border-box', position: 'relative',
              inset: 'auto', transform: 'none', overflow: 'clip',
            })) root.style.setProperty(property, value, 'important');
            if (root !== body) {
              root.style.setProperty('padding', '0', 'important');
              root.style.setProperty('display', 'block', 'important');
            }
          }
          await body.ownerDocument.fonts?.ready;
          if (disposed || failed) return;
          for (const element of body.querySelectorAll('*')) {
            const style = body.ownerDocument.defaultView.getComputedStyle(element);
            if (['auto', 'scroll'].includes(style.overflowX) || ['auto', 'scroll'].includes(style.overflowY)) {
              throw new Error('Source layout creates a scrollable region; use visible or clip overflow');
            }
          }
          if (artifact.format === 'html') {
            const size = htmlSurfaceSize(body, artifact.width, artifact.height);
            renderedWidth = size.width; renderedHeight = size.height;
            iframe.style.width = `${renderedWidth}px`;
            iframe.style.height = `${renderedHeight}px`;
          }
          body.addEventListener('click', select);
          selectedBody = body;
          figure.captureElement = iframe;
          iframe.dataset.artifactSurface = '';
          resize();
          if (window?.ResizeObserver && !observer) {
            observer = new window.ResizeObserver(resize);
            observer.observe(viewport);
            const panel = figure.closest('#design-panel, [data-artifact-panel]');
            if (panel) observer.observe(panel);
          }
          clearTimeout(timeout);
          cancelReady = null;
          resolve(figure);
        } catch (error) { clearTimeout(timeout); reject(error); }
      });
      // No scripts, fetches, navigation, fonts, forms or nested frames even if a
      // future parser allowlist expands accidentally. Same origin is capture-only.
      markup.then(source => {
        if (!disposed) iframe.srcdoc = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><style>html,body{margin:0;width:${artifact.width}px;height:${artifact.height}px;overflow:clip}body{box-sizing:border-box;font-family:system-ui,sans-serif;background:white;color:#172033}svg{max-width:100%;max-height:100%}</style></head><body data-artifact-surface>${source}</body></html>`;
      }, reject);
  });
  figure.dispose = () => {
    disposed = true;
    clearTimeout(timeout);
    observer?.disconnect();
    selectedBody?.removeEventListener('click', select);
    figure.captureElement = null;
    iframe.removeAttribute('data-artifact-surface');
    cancelReady?.(new Error('Artifact was disposed before rendering completed'));
    iframe.remove();
  };
  // Rejections remain observable by callers without generating an unhandled
  // rejection before an asynchronously mounted viewer subscribes.
  figure.ready.catch(error => {
    failed = true;
    clearTimeout(timeout);
    figure.captureElement = null;
    iframe.removeAttribute('data-artifact-surface');
    if (disposed) return;
    figure.dataset.artifactError = 'true';
    const message = document.createElement('p');
    message.setAttribute('role', 'alert');
    message.textContent = `Artifact could not be rendered: ${error.message}`;
    surface.replaceChildren(message);
  });
  return figure;
}
