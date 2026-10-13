import assert from 'node:assert/strict';
import test from 'node:test';
import { artifactSchema, artifactRules, validateArtifact, artifactReferences } from '../public/artifacts/contract.js';

const artifact = (format, source, extra = {}) => ({
  schemaVersion: 'artifact/v1', format, id: 'example', title: 'Example',
  source, width: 800, height: 600, ...extra,
});

test('artifact schema is explicit and validation returns independent portable data', () => {
  const input = artifact('html', '<div>Hello</div>');
  assert.deepEqual(validateArtifact(input), input);
  assert.notEqual(validateArtifact(input), input);
  assert.equal(artifactSchema.additionalProperties, false);
  assert.ok(Object.isFrozen(artifactRules));
  assert.ok(artifactRules.every(rule => typeof rule === 'string' && rule.length > 0));
  assert.match(artifactRules.join('\n'), /100000.*100 through 2400/s);
  for (const extra of [{ format: 'pdf' }, { schemaVersion: 'artifact/v2' }, { source: 'x'.repeat(100001) },
    { width: 800.5 }, { height: 0 }, { id: 'UPPER' }, { id: 'a'.repeat(49) }, { surprise: true }, { title: ' ' }]) {
    assert.throws(() => validateArtifact({ ...input, ...extra }), /Invalid artifact/);
  }
});

test('purpose category is additive optional metadata independent of format', () => {
  const old = artifact('html', '<div>Hello</div>', { description: 'Retained' });
  const expected = { schemaVersion: old.schemaVersion, format: old.format, id: old.id, title: old.title,
    description: old.description, source: old.source, width: old.width, height: old.height };
  assert.equal(JSON.stringify(validateArtifact(old)), JSON.stringify(expected));
  assert.equal(Object.hasOwn(validateArtifact(old), 'category'), false);
  assert.equal(artifactSchema.required.includes('category'), false);
  for (const category of ['user-story', 'ui', 'experience', 'workflows', 'contracts-data', 'system']) {
    for (const [format, source] of [['html', '<div>Hello</div>'], ['svg', '<svg><text>Hello</text></svg>'],
      ['mermaid', 'sequenceDiagram\nA->>B: Checkout']]) {
      assert.equal(validateArtifact(artifact(format, source, { category })).category, category);
    }
  }
  for (const category of [null, undefined, '', 'ungrouped', 'Experience', 'html', 1, {}, ['experience']]) {
    assert.throws(() => validateArtifact({ ...old, category }), /invalid category/);
  }
});

test('recommended content mappings do not restrict accepted formats or require notes', () => {
  for (const input of [
    artifact('html', '<table><tbody><tr><th>Condition</th><td>Retry allowed</td></tr></tbody></table>', { category: 'contracts-data' }),
    artifact('svg', '<svg><text>System boundary</text></svg>', { category: 'system' }),
    artifact('mermaid', 'sequenceDiagram\nUser->>Service: Request', { category: 'user-story' }),
    { schemaVersion: 'artifact/v2', format: 'markdown', id: 'retained-contract',
      title: 'Retained contract', source: 'Existing contract text.', category: 'contracts-data' },
  ]) assert.deepEqual(validateArtifact(input), input);
  assert.match(artifactRules.join('\n'), /defaults, not mandatory formats, all seven artifacts, counts or new validation gates/);
  assert.doesNotMatch(artifactRules.join('\n'), /Choose Markdown for behavior\/business contracts/);
});

test('HTML supports Grid, Flex and responsive CSS with explicit source references', () => {
  const input = artifact('html', `<style>
    .grid {display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
    #toolbar {display:flex;align-items:center;background:linear-gradient(90deg,white,lightblue)}
    @media (max-width:600px) {.grid {grid-template-columns:1fr}}
  </style><main class="grid"><section id="toolbar" aria-label="Toolbar"><button type="button" data-ref="save">Save</button></section></main>`);
  assert.equal(validateArtifact(input).source, input.source);
  assert.deepEqual(artifactReferences(input).map(item => [item.id, item.label]), [['toolbar', 'Toolbar'], ['save', 'save']]);
});

test('SVG supports vector geometry, text, clipping and local gradients', () => {
  const input = artifact('svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600">
  <defs><linearGradient id="paint"><stop offset="0%" stop-color="red"/><stop offset="100%" stop-color="blue"/></linearGradient></defs>
  <rect id="card" x="10" y="10" width="300" height="100" fill="url(#paint)"/>
  <text x="30" y="50">Hello</text></svg>`);
  assert.equal(validateArtifact(input).source, input.source);
  assert.deepEqual(artifactReferences(input).map(item => item.id), ['paint', 'card']);
  assert.doesNotThrow(() => validateArtifact({ ...input, source: input.source.replaceAll('paint', 'paint--') }));
});

test('source CSS remains static without nested scroll state or viewport-fixed positioning', () => {
  for (const css of ['overflow:auto', 'overflow:scroll', 'overflow:hidden', 'overflow:hidden auto', 'overflow-x:hidden', 'overflow-x:scroll',
    'overflow-y:auto', 'overflow:inherit', 'position:fixed', 'position:sticky', 'position:inherit',
    'animation:spin 1s infinite', 'transition:all 1s']) {
    assert.throws(() => validateArtifact(artifact('html', `<div style="${css}">Static only</div>`)), /Invalid artifact/, css);
    assert.throws(() => validateArtifact(artifact('html', `<style>@media (max-width:800px){div{${css}}}</style><div>Static only</div>`)), /Invalid artifact/, css);
  }
  for (const css of ['overflow:clip', 'overflow:visible', 'overflow:visible clip',
    'overflow-x:clip;overflow-y:clip', 'position:absolute', 'position:relative', 'position:static']) {
    assert.doesNotThrow(() => validateArtifact(artifact('html', `<div style="${css}">Static</div>`)), css);
  }
});

test('markup rejects active content, parser ambiguity and resource loading explicitly', () => {
  for (const source of [
    '<script>alert(1)</script>', '<div onclick="alert(1)">x</div>', '<iframe></iframe>',
    '<a href="javascript:alert(1)">x</a>', '<img src="https://example.com/x">',
    '<div style="background:url(https://example.com)">x</div>',
    '<style>@import "https://example.com/a.css";</style>',
    '<style>@font-face{font-family:x;src:url(x)}</style>',
    '<style>div{background:u\\72l(x)}</style>',
    '<style>div{--image:url(x)}</style>',
    '<style>div{background:image-set("https://example.com/x" 1x)}</style>',
    '<style>div::before{content:"x"}</style>',
    '<style>div:hover{width:800px}</style>', '<style>div:focus{height:800px}</style>',
    '<style>div{position:fixed!important}</style>',
    '<style>div{behavior:expression(alert(1))}</style>',
    '<div style="color:&#117;rl(x)">x</div>', '<div><span>missing closing tags',
    '<div id="same"></div><div id="same"></div>', '<div data-ref="Upper">x</div>',
    '<div data-ref="same"></div><div id="same"></div>',
    '<svg><foreignObject><div>x</div></foreignObject></svg>',
    '<!-- unsupported -->', '<!DOCTYPE html><div>x</div>',
  ]) assert.throws(() => validateArtifact(artifact('html', source)), /Invalid artifact/, source);
  for (const source of [
    '<svg><script>alert(1)</script></svg>', '<svg onload="alert(1)"></svg>',
    '<svg><image href="https://example.com/x"/></svg>', '<svg><use href="#x"/></svg>',
    '<svg><a href="https://example.com">x</a></svg>', '<svg><animate attributeName="href"/></svg>',
    '<svg><rect fill="url(https://example.com/x)"/></svg>',
    '<svg><rect fill="url(#missing)"/></svg>', '<svg><foreignObject/></svg>',
    '<svg/><svg/>', '<svg><style>rect{fill:red}</style></svg>',
  ]) assert.throws(() => validateArtifact(artifact('svg', source)), /Invalid artifact/, source);
});

test('Mermaid allows bounded passive diagrams and never exposes generated DOM IDs', () => {
  for (const source of ['flowchart LR\nstart[Start] --> finish[Finish]',
    'sequenceDiagram\nAlice->>Bob: Hello\nBob-->>Alice: Hi',
    'stateDiagram-v2\n[*] --> Ready\nReady --> Done',
    'graph TD\nsubgraph UI\nA[Browser]:::client\nend\nA --> B[API]\nclassDef client fill:#deebfa,stroke:#123,color:#112233,stroke-width:2px',
    'erDiagram\nUSER ||--o{ ORDER : places\nUSER {\nint id PK\nstring email UK\n}\nORDER {\nint user_id FK\n}',
    'classDiagram\nAnimal <|-- Dog\nRepository <|.. Dog\nDog *-- Collar\nOwner o-- Dog\nclass Dog {\n+String name\n+bark()\n}\nclass Repository {\n<<interface>>\n+save()\n}',
    'graph LR\n%% passive explanation\nA --> B\nstyle A fill:#fff,stroke:#123456']) {
    assert.equal(validateArtifact(artifact('mermaid', source)).source, source);
    assert.deepEqual(artifactReferences(artifact('mermaid', source)), []);
  }
  for (const source of ['pie\n"A":1', 'flowchart LR\n%%{init: {securityLevel: "loose"}}%%',
    'flowchart LR\nA-->B\nclick A "https://example.com"', 'flowchart LR\nA["<img src=x>"]',
    'flowchart LR\nA@{ img: "/local-resource.png" }',
    'flowchart LR\nA-->B\nstyle A fill:red', '---\nconfig: x\n---\nflowchart LR\nA-->B',
    'graph LR\nclassDef x fill:url(https://example.test/x)',
    'graph LR\nclassDef x fill:#fff; color:red',
    'graph LR\nclassDef x fill:#fff!important', 'graph LR\nclassDef x animation:spin',
    'graph LR\nstyle A background-image:url(x)', 'classDiagram\nclass Foo["<script>"]',
    'classDiagram\nFoo : callback()', 'erDiagram\nstyle USER fill:#fff',
    'graph LR\nlinkStyle 0 stroke:#fff', 'graph LR\nA["https://example.test"]',
    'graph LR\nA["javascript:alert(1)"]', 'graph LR\nA["\\u003cscript"]',
    'graph LR\nA["&#60;script&#62;"]', 'graph LR\nA["`markdown`"]',
    'graph LR\nclassDef x stroke-width:13px', 'classDiagram\nclass Foo {\n<<script>>\n}',
    'graph LR\n' + 'A'.repeat(501), 'graph LR\n' + '\n'.repeat(250), 'graph LR\n' + 'A '.repeat(10_001)]) {
    assert.throws(() => validateArtifact(artifact('mermaid', source)), /Invalid artifact/);
  }
});
