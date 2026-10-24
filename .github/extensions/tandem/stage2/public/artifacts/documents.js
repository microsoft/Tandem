import { lexer, validateSchemaMetadata, validateOpenApiSubset } from './vendor/documents.js';
import { renderStructuredDocument } from './document-views.js';
import { renderMarkdownTokens } from '../markdown.js';

const dialect = 'https://json-schema.org/draft/2020-12/schema';
const formats = new Set(['markdown', 'json-schema', 'openapi']);
export function isDocumentArtifact(input) {
  return input?.schemaVersion === 'artifact/v2' && formats.has(input.format);
}
const documentCapabilities = Object.freeze({ annotate: false, capture: false, zoom: false });
const visualCapabilities = Object.freeze({ annotate: true, capture: true, zoom: true });
export function artifactCapabilities(input) {
  return isDocumentArtifact(input) ? documentCapabilities : visualCapabilities;
}
function fail(message) { throw new Error(`Invalid artifact document: ${message}`); }
function bounded(value, depth = 0, budget = { count: 0 }) {
  if (++budget.count > 12000 || depth > 40) fail('source exceeds 12000 values/tokens or depth 40');
  if (typeof value === 'number' && !Number.isFinite(value)) fail('non-finite JSON number');
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) fail(`unsafe prototype key: ${key}`);
    if (key === '$schema' && typeof child === 'string' && child !== dialect) fail('only explicit JSON Schema 2020-12 dialect declarations are supported');
    bounded(child, depth + 1, budget);
  }
}
export function parseDocument(artifact) {
  if (artifact.format === 'markdown') {
    const tokens = lexer(artifact.source, { gfm: true });
    bounded(tokens);
    return tokens;
  }
  let data;
  try { data = JSON.parse(artifact.source); } catch { fail('source must be strict JSON, not YAML'); }
  bounded(data);
  if (artifact.format === 'json-schema') {
    if (!data || typeof data !== 'object' || Array.isArray(data) || data.$schema !== dialect) {
      fail(`JSON Schema requires an object with explicit $schema: ${dialect}`);
    }
  } else if (data?.jsonSchemaDialect !== dialect) {
    fail(`OpenAPI subset requires explicit jsonSchemaDialect: ${dialect}`);
  }
  // Metadata validation only: never compile an authored schema or resolve its refs.
  const validator = artifact.format === 'json-schema' ? validateSchemaMetadata : validateOpenApiSubset;
  if (!validator(data)) fail(`${artifact.format === 'json-schema' ? 'JSON Schema 2020-12 metadata' : 'OpenAPI 3.1 structural subset'}: ${
    validator.errors?.map(error => `${error.instancePath || '/'} ${error.message}`).join('; ')}`);
  return data;
}

export function renderDocument(document, artifact) {
  const data = parseDocument(artifact);
  const figure = document.createElement('figure');
  figure.className = 'source-artifact artifact-document';
  figure.dataset.artifactFormat = artifact.format;
  figure.dataset.artifactId = artifact.id;
  figure.dataset.artifactDocument = '';
  figure.style.cssText = 'margin:0;min-width:0;max-width:100%;width:100%;overflow-wrap:anywhere;user-select:text;font-family:var(--artifact-document-font-family,inherit);font-size:var(--artifact-document-font-size,16px);line-height:1.6;color:var(--artifact-document-color,var(--text,inherit));background:var(--artifact-document-background,transparent);';
  const make = (tag, text) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  figure.append(make('figcaption', artifact.title));
  if (artifact.format === 'markdown') {
    const source = make('details');
    source.dataset.markdownSource = '';
    source.append(make('summary', 'Read Markdown source'));
    renderMarkdownTokens(document, source, data);
    figure.append(source);
  } else {
    figure.append(make('p', artifact.format === 'json-schema'
      ? 'Schema structure, not payload validation. Reference links navigate declared definitions only.'
      : 'Declared API exchanges, not an executable API or full semantic validation.'));
    figure.append(renderStructuredDocument(document, artifact, data));
  }
  figure.captureElement = null;
  figure.ready = Promise.resolve(figure);
  figure.dispose = () => {};
  return figure;
}
