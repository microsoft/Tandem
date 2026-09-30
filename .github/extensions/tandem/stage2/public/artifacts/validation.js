import { parseFragment, css } from './vendor/parsers.js';
import { isDocumentArtifact, parseDocument } from './documents.js';
export { artifactCapabilities, isDocumentArtifact } from './documents.js';

export const referenceIdPattern = '^[a-z][a-z0-9-]{0,47}$';
const referenceId = new RegExp(referenceIdPattern);
const maximumSourceLength = 100_000;
const baseArtifactRules = Object.freeze([
  "Visual source artifacts have exactly schemaVersion:'artifact/v1', format:'mermaid'|'html'|'svg', id, title, optional description, source, width, height, and optional category. Never include unknown fields.",
  "For newly authored or revised artifacts explicitly assign category by purpose: user-story (User story) for user goals, ordered user actions and system responses, outcomes and relevant failure/retry paths; ui (UI) for screen layout, controls and interactions; workflows for process/state/sequence across users, UI and services; contracts-data for contracts and data; system for architecture/stack/deployment. A storyboard containing screen thumbnails is user-story, not also ui merely because it depicts screens. Category is independent of format, never inferred from title or mermaid/html/svg. Select only relevant complementary views; UI-free projects need no UI artifact. The experience value is retained only for historical compatibility; leave unchanged artifacts untouched, including missing category.",
  'Artifact IDs and authored HTML/SVG id or data-ref attributes must match ^[a-z][a-z0-9-]{0,47}$. DOM IDs and selected reference IDs must each be unique within an artifact. data-ref takes precedence over id on the same element. Use artifact-id#element-id for authored element references; Mermaid supports artifact-level references only, never generated DOM IDs.',
  'Title must contain non-whitespace text and be at most 200 characters. Description is optional text of at most 2000 characters. Source must contain non-whitespace text and be at most 100000 characters. Visual artifact/v1 width and height are required integers from 100 through 2400, representing the authored canvas in CSS pixels; the viewer uniformly scales that canvas.',
  'HTML source is a fragment, not a full document. Use explicit closing tags and explicit table sections. Allowed elements: div span section article header footer main nav aside p h1 h2 h3 h4 h5 h6 ul ol li dl dt dd table caption thead tbody tfoot tr th td colgroup col strong em b i u s small mark code pre blockquote br hr button label figure figcaption style. Buttons are inert and may have type="button". No inputs, forms, links, images, embedded SVG, scripts, frames, media, declarations, comments, or processing instructions.',
  'HTML/SVG common attributes are id, class, title, role, aria-label, aria-labelledby, aria-describedby, aria-hidden, data-ref, and style. Additional HTML attributes are colspan, rowspan, scope, type="button", and disabled. No event attributes, resource or navigation attributes, arbitrary data attributes, or namespace-prefixed attributes.',
  'Put HTML CSS in attribute-free style elements or inline style attributes. CSS may use ordinary layout, typography, borders, colors, gradients, Grid, Flex, and responsive @media rules. No other at-rules, URLs, external fonts, custom properties/var(), escapes, !important, animations, transitions, generated pseudo-elements/content, or unknown CSS syntax. Each stylesheet or inline style is limited to 30000 characters; markup is limited to 2500 nodes and depth 40.',
  'Source artifacts are static snapshots. Source overflow, overflow-x, and overflow-y may use only visible or clip. Use clip instead of hidden: hidden still scrolls on focus and is forbidden along with auto/scroll. Source position may use only static, relative, or absolute. Dynamic hover/focus selectors, fixed/sticky positioning, animations and transitions are forbidden. Scrolling and zoom belong to the host artifact viewport, not the authored content.',
  'SVG source must be exactly one complete svg element, optionally with xmlns="http://www.w3.org/2000/svg". Allowed SVG elements: svg g rect circle ellipse line polyline polygon path text tspan defs linearGradient radialGradient stop clipPath mask pattern marker title desc. No style elements, foreignObject, image, use, a, animation, scripts, or external resources. Use SVG presentation attributes for fills, strokes, geometry, text, transforms, gradients, clipping, masks, and markers. Local paint references must be url(#lowercase-id), refer to an existing source id, and occur only in fill, stroke, clip-path, mask, marker-start, marker-mid, or marker-end attributes.',
  'Mermaid source must start with flowchart or graph TB|TD|BT|RL|LR, sequenceDiagram, stateDiagram-v2, erDiagram, or classDiagram, followed by a newline or semicolon. Use passive nodes/edges and subgraphs, participants/messages, states/transitions, ER fields with PK/FK/UK and cardinalities, or class members, interfaces, inheritance, composition and aggregation. Limit Mermaid to 20000 characters, 250 lines, 300 edges, and tokens of at most 500 characters. Mermaid grammar is checked during rendering; malformed diagrams fail visibly.',
  'Mermaid forbids directives, frontmatter, @{...} extended node configuration, HTML, entities, Markdown backticks, escapes, resources, URLs and interaction. Whole-line %% plain comments are allowed, never %%{...} directives. Flowchart/graph/classDiagram alone allow classDef and style on separate lines with only fill/stroke/color hexadecimal #RGB or #RRGGBB and stroke-width 1..12px; no other authored CSS, linkStyle or theme configuration. Reserved words click, href, link, links, callback, call, init, config, accTitle, accDescr, linkStyle, img, image and icon are rejected even in labels. Class stereotypes are limited to <<interface>>, <<abstract>>, <<service>>, <<enumeration>>. Generated HTML labels are disabled; Mermaid references remain artifact-level.',
]);
function freeze(value) {
  for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child);
  return Object.freeze(value);
}
export const artifactSchema = freeze({
  type: 'object', additionalProperties: false,
  required: ['schemaVersion', 'format', 'id', 'title', 'source', 'width', 'height'],
  properties: {
    schemaVersion: { type: 'string', const: 'artifact/v1' },
    format: { type: 'string', enum: ['mermaid', 'html', 'svg'] },
    id: { type: 'string', pattern: referenceIdPattern, maxLength: 48 },
    title: { type: 'string', minLength: 1, maxLength: 200 },
    description: { type: 'string', maxLength: 2000 },
    source: { type: 'string', minLength: 1, maxLength: maximumSourceLength },
    width: { type: 'integer', minimum: 100, maximum: 2400 },
    height: { type: 'integer', minimum: 100, maximum: 2400 },
    category: { type: 'string', enum: ['user-story', 'ui', 'experience', 'workflows', 'contracts-data', 'system'] },
  },
});
const documentSchema = {
  ...artifactSchema,
  required: ['schemaVersion', 'format', 'id', 'title', 'source'],
  properties: Object.fromEntries(Object.entries({
    ...artifactSchema.properties,
    schemaVersion: { type: 'string', const: 'artifact/v2' },
    format: { type: 'string', enum: ['markdown', 'json-schema', 'openapi'] },
    visualCompanionId: { type: 'string', pattern: referenceIdPattern, maxLength: 48 },
    noteForArtifactId: { type: 'string', pattern: referenceIdPattern, maxLength: 48 },
  }).filter(([key]) => !['width', 'height'].includes(key))),
};
export const documentArtifactSchema = freeze({
  ...documentSchema,
  oneOf: [
    { ...documentSchema, properties: { ...documentSchema.properties, format: { type: 'string', const: 'markdown' } } },
    { ...documentSchema, properties: Object.fromEntries(Object.entries({
      ...documentSchema.properties, format: { type: 'string', enum: ['json-schema', 'openapi'] },
    }).filter(([key]) => !['visualCompanionId', 'noteForArtifactId'].includes(key))) },
  ],
});

function fail(message) { throw new Error(`Invalid artifact: ${message}`); }
const htmlTags = new Set('div span section article header footer main nav aside p h1 h2 h3 h4 h5 h6 ul ol li dl dt dd table caption thead tbody tfoot tr th td colgroup col strong em b i u s small mark code pre blockquote br hr button label figure figcaption style'.split(' '));
const svgTags = new Set('svg g rect circle ellipse line polyline polygon path text tspan defs linearGradient radialGradient stop clipPath mask pattern marker title desc'.split(' '));
const globalAttributes = new Set('id class title role aria-label aria-labelledby aria-describedby aria-hidden data-ref'.split(' '));
const htmlAttributes = new Set('colspan rowspan scope type disabled'.split(' '));
const svgAttributes = new Set('xmlns viewBox width height x y x1 y1 x2 y2 cx cy r rx ry d points transform fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin stroke-dasharray stroke-dashoffset opacity font-family font-size font-weight text-anchor dominant-baseline dx dy rotate textLength lengthAdjust gradientUnits gradientTransform spreadMethod offset stop-color stop-opacity clip-path clip-rule mask maskUnits maskContentUnits patternUnits patternContentUnits patternTransform marker-start marker-mid marker-end markerWidth markerHeight refX refY orient preserveAspectRatio'.split(' '));
const cssProperties = new Set(`color background background-color display position top right bottom left inset box-sizing width height min-width min-height max-width max-height margin margin-top margin-right margin-bottom margin-left padding padding-top padding-right padding-bottom padding-left gap row-gap column-gap grid grid-template grid-template-columns grid-template-rows grid-template-areas grid-auto-columns grid-auto-rows grid-auto-flow grid-column grid-column-start grid-column-end grid-row grid-row-start grid-row-end grid-area align-items align-content align-self justify-items justify-content justify-self place-items place-content place-self flex flex-direction flex-wrap flex-flow flex-grow flex-shrink flex-basis order float clear border border-width border-style border-color border-top border-right border-bottom border-left border-radius border-collapse border-spacing outline outline-color outline-width outline-style box-shadow opacity overflow overflow-x overflow-y font font-family font-size font-weight font-style font-variant line-height letter-spacing word-spacing text-align text-decoration text-transform text-indent text-overflow white-space word-break overflow-wrap vertical-align list-style list-style-type list-style-position table-layout caption-side empty-cells transform transform-origin aspect-ratio object-fit isolation z-index visibility`.split(/\s+/));
const cssFunctions = new Set('rgb rgba hsl hsla hwb lab lch oklab oklch min max clamp calc repeat minmax fit-content translate translateX translateY scale scaleX scaleY rotate skew skewX skewY matrix linear-gradient radial-gradient repeating-linear-gradient repeating-radial-gradient'.split(' ').map(value => value.toLowerCase()));
const cssPseudoClasses = ['root', 'first-child', 'last-child', 'nth-child', 'nth-of-type', 'first-of-type', 'last-of-type', 'not', 'is', 'where', 'disabled', 'empty'];
export const artifactRules = Object.freeze([
  ...baseArtifactRules,
  "Documents use artifact/v2 with format markdown, json-schema or openapi; id, title, source, optional description/category, and Markdown-only optional noteForArtifactId or legacy visualCompanionId. Width and height are forbidden: documents reflow with normal vertical scrolling, selectable text and contained wide table/code overflow. They have no zoom, annotation or PNG capture. Only artifact-level references are supported.",
  "Supporting Markdown notes are optional and secondary to their primary artifact. The user is not required to read supporting notes; the visual artifact must stand on its own and carry all essential behavior, decisions, and outcomes. Notes are optional and must be brief. Keep them concise and limited to essential clarification or rationale not already visible; do not duplicate visuals or bury approval-critical behavior in prose. Set noteForArtifactId on a Markdown note to an existing artifact ID in the same Design, including visual, Markdown, JSON Schema or OpenAPI artifacts. Do not reference self, create note cycles or conflicting associations. Retain existing visualCompanionId links to artifact/v1 unchanged; never invent unnecessary visuals to attach a note. Notes open from the primary artifact, not as competing top-level tabs. Retain portable Markdown source.",
  "Recommended artifact mapping by content: User story: HTML storyboard showing ordered user actions, system responses/outcomes and relevant failure/retry. UI: HTML mockup showing actual screen layouts and interaction states, not boxes describing screens. Workflows: Mermaid flowchart/state/sequence as appropriate to steps, lifecycle or interactions. Behavioral contracts/rules: Mermaid sequence for exchanges; HTML decision tables for conditions/rules/outcomes. Data contracts: Mermaid ER/class diagrams for entities, fields and relationships; JSON Schema/OpenAPI when precise machine/API specs are needed, never invented HTTP APIs or persistence. System: Mermaid grouped architecture with meaningful boundaries/layers/components/dependencies, not generic chains of boxes. Supporting notes: Markdown, brief/optional/secondary, not the recommended primary artifact.",
  "These recommendations are defaults, not mandatory formats, all seven artifacts, counts or new validation gates. SVG remains valid for precise custom visuals; HTML/SVG alternatives remain allowed where clearer. Choose only relevant complementary artifacts, avoid duplicate views, and ensure the primary artifact stands on its own; never hide essential approval decisions in notes. Preserve unchanged/historical artifacts, Markdown support and existing optional same-revision noteForArtifactId or legacy visualCompanionId relationships; do not invent mandatory companions. Do not migrate retained HTML tables automatically. Categories remain independent of format.",
  "Markdown supports GFM headings, paragraphs, tables, lists, quotes, emphasis and fenced code. Raw HTML is literal text, links are inert labels and images are alt text only. No resources, navigation or executable content. Entities remain literal. No section comments or editor.",
  "Schema sources are strict JSON. JSON Schema requires explicit $schema https://json-schema.org/draft/2020-12/schema and is checked against its 2020-12 meta-schema, never against payloads. OpenAPI supports only 3.1.0/3.1.1 with explicit jsonSchemaDialect https://json-schema.org/draft/2020-12/schema: info title/version/summary/description, paths with HTTP operations summary/description/operationId/tags/parameters/requestBody/responses, components.schemas. Parameters use name/in/description/required/schema; media entries only schema; responses description/content or $ref. Other OpenAPI fields are rejected. This is structural subset validation, not full semantic OpenAPI validation. All refs are opaque, never fetched or resolved. Prototype keys and excessive depth/size are rejected.",
  `The exact CSS property allowlist is: ${[...cssProperties].join(', ')}. Values must match the CSS property grammar; no unparsed/raw syntax is permitted.`,
  `The exact CSS function allowlist is: ${[...cssFunctions].join(', ')}. The exact pseudo-class allowlist is: ${cssPseudoClasses.join(', ')}. Pseudo-elements are forbidden.`,
  `Beyond common attributes and inline style, the exact SVG attribute allowlist is: ${[...svgAttributes].join(', ')}. Attribute values are limited to 12000 characters and must not contain control characters or escapes.`,
]);

function validateCss(source, context = 'stylesheet') {
  if (source.length > 30_000 || /[\\\u0000-\u0008\u000b\u000e-\u001f]/.test(source)) fail('CSS escapes and control characters are unsupported');
  let ast;
  try { ast = css.parse(source, { context, positions: false, onParseError: error => { throw error; } }); }
  catch { fail('malformed CSS'); }
  let count = 0;
  css.walk(ast, node => {
    if (++count > 12_000) fail('CSS is too complex');
    if (node.type === 'Raw' || node.type === 'Url') fail('CSS raw syntax and resources are forbidden');
    if (node.type === 'Atrule') {
      if (node.name.toLowerCase() !== 'media' || !node.block) fail('only CSS @media rules are supported');
      const query = css.generate(node.prelude);
      if (!/^(?:(?:only |not )?(?:screen|all)(?: and )?)?\(?[\w\s:().,%+-]+\)?(?:\s*,\s*[\w\s:().,%+-]+)*$/i.test(query)
        || /\b(?:url|style)\b/i.test(query)) fail('unsupported media query');
    }
    if (node.type === 'Declaration') {
      const property = node.property.toLowerCase();
      if (!cssProperties.has(property) || node.important) fail(`unsupported CSS property or !important: ${node.property}`);
      if (css.lexer.matchProperty(node.property, node.value).error) fail(`invalid CSS value for ${node.property}`);
      const value = css.generate(node.value).toLowerCase();
      if (['overflow', 'overflow-x', 'overflow-y'].includes(property)
        && !/^(?:visible|clip)(?: (?:visible|clip))?$/.test(value)) fail('source scrolling is unsupported; use visible or clip overflow');
      if (property === 'position' && !/^(?:static|relative|absolute)$/.test(value)) fail('source positioning must be static, relative or absolute');
    }
    if (node.type === 'Function' && !cssFunctions.has(node.name.toLowerCase())) fail(`unsupported CSS function: ${node.name}`);
    if (node.type === 'PseudoClassSelector' && !cssPseudoClasses.includes(node.name.toLowerCase())) fail('unsupported CSS pseudo-class');
    if (node.type === 'PseudoElementSelector') fail('CSS generated content is unsupported');
  });
}

export function parseMarkup(source, format) {
  // Reject ambiguous XML/browser repair paths before parsing. Entities are still
  // decoded by the HTML5 parser before attribute validation below.
  if (/<!|<\?|[\u0000-\u0008\u000b\u000e-\u001f]/.test(source)) fail('declarations, comments and control characters are unsupported');
  const errors = [];
  const tree = parseFragment(source, { sourceCodeLocationInfo: true, onParseError: error => errors.push(error) });
  if (errors.length) fail(`malformed markup (${errors[0].code})`);
  const references = [];
  const ids = new Set();
  const localResources = [];
  let count = 0;
  function visit(node, depth = 0) {
    if (++count > 2500 || depth > 40) fail('markup is too complex');
    if (node.nodeName === '#text') return;
    if (node.nodeName === '#document-fragment') { for (const child of node.childNodes) visit(child, depth); return; }
    const svg = node.namespaceURI === 'http://www.w3.org/2000/svg';
    if (format === 'html' ? svg || !htmlTags.has(node.tagName) : !svg || !svgTags.has(node.tagName)) fail(`unsupported ${format} element: ${node.tagName}`);
    if (!node.sourceCodeLocation) fail('implicitly generated markup is unsupported; supply explicit tags');
    if (node.tagName !== 'style' && !['br', 'hr', 'col'].includes(node.tagName)
      && !node.sourceCodeLocation.endTag && !source.slice(node.sourceCodeLocation.startOffset, node.sourceCodeLocation.endOffset).trimEnd().endsWith('/>')) fail(`missing closing tag: ${node.tagName}`);
    for (const attr of node.attrs) {
      const { name, value } = attr;
      if (attr.prefix || attr.namespace && name !== 'xmlns') fail('namespaced attributes are unsupported');
      if (name === 'style') { validateCss(value, 'declarationList'); continue; }
      if (!globalAttributes.has(name) && !(svg ? svgAttributes : htmlAttributes).has(name)) fail(`unsupported attribute: ${name}`);
      if (value.length > 12_000 || /[\u0000-\u001f\\]/.test(value)) fail(`invalid attribute: ${name}`);
      if (name === 'xmlns' && value !== 'http://www.w3.org/2000/svg') fail('invalid SVG namespace');
      if (name === 'id') {
        if (!referenceId.test(value) || ids.has(value)) fail('DOM IDs must be unique lowercase stable IDs');
        ids.add(value);
      }
      if (name === 'data-ref') {
        if (!referenceId.test(value)) fail('data-ref IDs must be lowercase stable IDs');
      }
      if (name === 'type' && value !== 'button') fail('only inert buttons are supported');
      if (svg && /url\s*\(/i.test(value)) {
        if (!['fill', 'stroke', 'clip-path', 'mask', 'marker-start', 'marker-mid', 'marker-end'].includes(name)
          || !/^url\(#[a-z][a-z0-9-]{0,47}\)$/.test(value)) fail('only local SVG paint references are allowed');
        localResources.push(value.slice(5, -1));
      }
      if (svg && name !== 'xmlns' && /(?:https?:|data:|javascript:|\/\/|@import)/i.test(value)) fail('SVG resources are forbidden');
    }
    const ref = node.attrs.find(attr => attr.name === 'data-ref')?.value ?? node.attrs.find(attr => attr.name === 'id')?.value;
    if (ref) {
      if (references.some(item => item.id === ref)) fail('source reference IDs must be unique');
      const label = node.attrs.find(attr => attr.name === 'aria-label' || attr.name === 'title')?.value ?? ref;
      references.push({ id: ref, kind: format, label, details: '' });
    }
    if (node.tagName === 'style') {
      if (node.attrs.length || node.childNodes.some(child => child.nodeName !== '#text')) fail('invalid style element');
      validateCss(node.childNodes.map(child => child.value).join(''));
    } else {
      for (const child of node.childNodes ?? []) visit(child, depth + 1);
    }
  }
  visit(tree);
  if (format === 'svg') {
    const roots = tree.childNodes.filter(node => node.nodeName !== '#text' || node.value.trim());
    if (roots.length !== 1 || roots[0].tagName !== 'svg') fail('SVG source must contain exactly one full svg element');
  }
  for (const id of localResources) if (!ids.has(id)) fail(`unknown SVG paint reference: ${id}`);
  return { tree, references };
}

function validateMermaid(source) {
  if (source.length > 20_000 || source.split('\n').length > 250) fail('Mermaid source exceeds rendering bounds');
  const header = /^\s*((?:flowchart|graph)\s+(?:TB|TD|BT|RL|LR)|sequenceDiagram|stateDiagram-v2|erDiagram|classDiagram)\s*(?:\r?\n|;|$)/.exec(source);
  if (!header) fail('only flowchart/graph, sequenceDiagram, stateDiagram-v2, erDiagram and classDiagram are supported');
  if (source.split(/\s+/).some(token => token.length > 500)) fail('Mermaid token is too long');
  if (/%%\s*\{|@\s*\{|---\s*\n|[\\\u0000-\u0008\u000b\u000e-\u001f]/.test(source)) fail('Mermaid configuration, directives and escapes are unsupported');
  const family = header[1].split(/\s+/)[0];
  const canStyle = ['flowchart', 'graph', 'classDiagram'].includes(family);
  let passive = source.split('\n').map(line => {
    if (/^\s*%%/.test(line)) return '';
    if (!/^\s*(?:classDef|style)\b/.test(line)) return line;
    const declaration = /^\s*(?:classDef|style)\s+[\w-]+(?:,[\w-]+)*\s+([^;]+);?\s*$/.exec(line);
    if (!canStyle || !declaration) fail('Mermaid styling requires a supported family and a separate bounded declaration');
    for (const value of declaration[1].split(',')) {
      if (!/^\s*(?:(?:fill|stroke|color):#[0-9a-f]{3}(?:[0-9a-f]{3})?|stroke-width:(?:[1-9]|1[0-2])px)\s*$/i.test(value)) {
        fail('Mermaid styling permits only hex fill/stroke/color and stroke-width 1..12px');
      }
    }
    return '';
  }).join('\n');
  if (!canStyle && /\bclass\b/i.test(passive)) fail('Mermaid class declarations require flowchart/graph or classDiagram');
  if (family === 'classDiagram') passive = passive.replace(/<<(?:interface|abstract|service|enumeration)>>/g, '')
    .replace(/<\|--|<\|\.\.|--\|>|\.\.\|>/g, '');
  passive = passive.replace(/<-->|-->>|<<--|->>|<<-|<--|<->|-->|->/g, '');
  if (/[<>&`]/.test(passive)
    || /%%|\b(?:click|href|link|links|callback|call|init|config|accTitle|accDescr|classDef|style|linkStyle|img|image|icon)\b|https?:|data:|javascript:|url\s*\(/i.test(passive)) {
    fail('Mermaid resources, HTML, interactions and unbounded styling are unsupported');
  }
}

export function validateArtifact(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('expected an object');
  const document = isDocumentArtifact(input);
  const schema = document ? documentArtifactSchema : artifactSchema;
  if (Object.keys(input).some(key => !Object.hasOwn(schema.properties, key))) fail('unknown field');
  for (const key of schema.required) if (!Object.hasOwn(input, key)) fail(`missing ${key}`);
  if (!document && (input.schemaVersion !== 'artifact/v1' || !['html', 'svg', 'mermaid'].includes(input.format))) fail('unsupported version or format');
  if (typeof input.id !== 'string' || !referenceId.test(input.id)) fail('invalid id');
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 200) fail('invalid title');
  if (Object.hasOwn(input, 'description') && (typeof input.description !== 'string' || input.description.length > 2000)) fail('invalid description');
  if (Object.hasOwn(input, 'category') && !artifactSchema.properties.category.enum.includes(input.category)) fail('invalid category');
  for (const key of ['visualCompanionId', 'noteForArtifactId']) if (Object.hasOwn(input, key) && (input.format !== 'markdown'
    || typeof input[key] !== 'string' || !referenceId.test(input[key]))) fail(`${key} requires Markdown and a valid artifact ID`);
  if (input.visualCompanionId !== undefined && input.noteForArtifactId !== undefined
    && input.visualCompanionId !== input.noteForArtifactId) fail('conflicting note associations');
  if (!document) for (const key of ['width', 'height']) if (!Number.isInteger(input[key]) || input[key] < 100 || input[key] > 2400) fail(`${key} must be an integer from 100 to 2400`);
  if (typeof input.source !== 'string' || !input.source.trim() || input.source.length > maximumSourceLength) fail('source must contain 1–100000 characters');
  if (document) parseDocument(input);
  else if (input.format === 'mermaid') validateMermaid(input.source);
  else parseMarkup(input.source, input.format);
  return Object.fromEntries(Object.keys(schema.properties).filter(key => Object.hasOwn(input, key)).map(key => [key, input[key]]));
}

export const artifactNoteTarget = artifact => artifact.noteForArtifactId ?? artifact.visualCompanionId ?? null;

export function artifactReferences(input) {
  const artifact = validateArtifact(input);
  return isDocumentArtifact(artifact) || artifact.format === 'mermaid' ? [] : parseMarkup(artifact.source, artifact.format).references;
}
