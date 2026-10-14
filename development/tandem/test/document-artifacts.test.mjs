import assert from 'node:assert/strict';
import test from 'node:test';
import { validateArtifact, artifactCapabilities, artifactReferences, documentArtifactSchema } from '../public/artifacts/contract.js';
import { validateDesign, validateArtifactAnnotationSource, designReferenceCatalog } from '../public/sketch/design-contract.js';
import { sharedDesignV3 } from './helpers/shared-design-fixture.mjs';
import { parseDebuggerInput } from '../public/sketch/debugger.js';
import { HumanLoopDesignStore, sharedDesignBinding } from '../src/human-loop-design-store.mjs';
import { HostStateFile } from '../runtime-src/domain/host-state-file.ts';
import { getHostStateWal } from '../runtime-src/domain/host-state-wal.ts';
import { policyHash } from '../runtime-src/domain/workflow/policy.ts';
import { mkdir, rm, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export const dialect = 'https://json-schema.org/draft/2020-12/schema';
export const doc = (format, source, extra = {}) => ({ schemaVersion: 'artifact/v2', format, id: 'business', title: 'Business contract', source, ...extra });
test('a UI-free user journey requires no screen artifact or extra category gate', () => {
  const journey = doc('markdown', '# Import records\n\n1. User selects input.\n2. System validates rows.\n3. Invalid rows can be corrected and retried.\n4. Valid rows are saved.',
    { id: 'journey', title: 'Import outcome', category: 'user-story' });
  const content = { schemaVersion: 'sketch-design/v3', goal: 'Import valid records', summary: 'A command-line journey',
    outcomes: [{ id: 'imported', description: 'Records saved', references: ['journey'] }], artifacts: [journey] };
  assert.deepEqual(validateDesign(content), content);
});
test('Markdown companion binds an existing visual in the same Design without rebinding source', () => {
  const design = sharedDesignV3();
  const visual = { schemaVersion: 'artifact/v1', format: 'mermaid', id: 'contract-visual',
    title: 'Exchange', width: 600, height: 400, source: 'flowchart LR\nA --> B' };
  const markdown = doc('markdown', '# Exact contract', { visualCompanionId: visual.id });
  const input = { ...design, artifacts: [...design.artifacts, visual, markdown] };
  assert.deepEqual(validateDesign(input), input);
  assert.throws(() => validateDesign({ ...input, artifacts: input.artifacts.filter(item => item !== visual) }), /companion/);
  assert.throws(() => validateDesign({ ...input, artifacts: [...design.artifacts, visual, { ...markdown, visualCompanionId: markdown.id }] }), /companion/);
  assert.throws(() => validateArtifact(doc('json-schema', JSON.stringify({ $schema: dialect }), { visualCompanionId: visual.id })), /Markdown/);
});
test('document union preserves exact source, categories and retained visual data', () => {
  const design = sharedDesignV3(), old = JSON.stringify(design.artifacts);
  for (const category of [undefined, 'user-story', 'ui', 'experience', 'workflows', 'contracts-data', 'system']) {
    for (const [format, source] of [
      ['markdown', '# Contract\r\n\r\n|Name|Value|\r\n|---|---|\r\n|A|B|\r\n\r\n```js\r\nconst x = 1;\r\n```\r\n'],
      ['json-schema', ` { "$schema": "${dialect}", "type": "object", "$ref": "https://invalid.example/no-fetch" } \n`],
      ['openapi', JSON.stringify({ openapi: '3.1.1', jsonSchemaDialect: dialect, info: { title: 'Actual API', version: '1' }, paths: { '/items': { get: { responses: { 200: { description: 'Items' } } } } } })],
    ]) {
      const artifact = doc(format, source, category === undefined ? {} : { category });
      assert.deepEqual(validateArtifact(artifact), artifact);
      assert.deepEqual(parseDebuggerInput(JSON.stringify(artifact)).artifacts, [artifact]);
      assert.deepEqual(artifactReferences(artifact), []);
      assert.deepEqual(artifactCapabilities(artifact), { annotate: false, zoom: false, capture: false });
      const result = validateDesign({ ...design, artifacts: [...design.artifacts, artifact] });
      assert.equal(result.artifacts.at(-1).source, source);
      assert.equal(JSON.stringify(result.artifacts.slice(0, -1)), old);
      assert.ok(designReferenceCatalog(result).some(item => item.reference === artifact.id));
      assert.throws(() => validateArtifactAnnotationSource({ schemaVersion: 'artifact-annotation/v1', artifactId: artifact.id,
        revisionId: 'rev', designDigest: 'digest', selectionId: null }, { revisionId: 'rev', digest: 'digest' }, result), /do not support/);
    }
  }
  assert.equal(Object.hasOwn(documentArtifactSchema.properties, 'width'), false);
  for (const extra of [{ width: 800 }, { height: 600 }, { category: 'markdown' }, { schemaVersion: 'artifact/v1' }]) {
    assert.throws(() => validateArtifact(doc('markdown', '# Text', extra)));
  }
});

test('optional notes target any same-Design artifact without changing source or allowing cycles', () => {
  const design = sharedDesignV3();
  const primaries = [
    ...design.artifacts,
    doc('markdown', '# Primary rules', { id: 'rules' }),
    doc('json-schema', JSON.stringify({ $schema: dialect, type: 'string' }), { id: 'schema' }),
    doc('openapi', JSON.stringify({ openapi: '3.1.1', jsonSchemaDialect: dialect, info: { title: 'API', version: '1' }, paths: {} }), { id: 'api' }),
  ];
  const note = doc('markdown', 'Brief rationale.\r\n', { id: 'note', noteForArtifactId: primaries[0].id });
  for (const primary of primaries) {
    const input = { ...design, artifacts: [...primaries, { ...note, noteForArtifactId: primary.id }] };
    assert.deepEqual(validateDesign(input), input);
    assert.ok(designReferenceCatalog(input).some(item => item.reference === note.id));
  }
  const input = artifacts => ({ ...design, artifacts: [...primaries, ...artifacts] });
  for (const target of ['missing', 'note']) assert.throws(() => validateDesign(input([{ ...note, noteForArtifactId: target }])), /Note target/);
  assert.throws(() => validateDesign(input([note, { ...note, id: 'second', noteForArtifactId: 'third' },
    { ...note, id: 'third', noteForArtifactId: 'second' }])), /cycle/);
  assert.doesNotThrow(() => validateDesign(input([note, { ...note, id: 'nested', noteForArtifactId: 'note' }])));
  assert.throws(() => validateArtifact({ ...note, visualCompanionId: 'different' }), /conflicting/);
  assert.throws(() => validateArtifact({ ...primaries.at(-1), noteForArtifactId: 'rules' }), /Markdown/);
  assert.equal(Object.hasOwn(documentArtifactSchema.oneOf[1].properties, 'noteForArtifactId'), false);
});

test('Markdown active HTML and unsafe resource syntax remain source, never interpreted', () => {
  const source = '<script>globalThis.pwned=true</script>\n\n<img src="https://invalid.example/a" onerror="alert(1)">\n\n[Go](javascript:alert(1)) ![Alt](https://invalid.example/image)';
  assert.equal(validateArtifact(doc('markdown', source)).source, source);
});

test('schema metadata and bounded OpenAPI structure are validated without resolving refs', () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('Unexpected network'); };
  try {
    for (const $ref of ['#/$defs/self', 'https://invalid.example/missing', 'file:///private']) {
      assert.doesNotThrow(() => validateArtifact(doc('json-schema', JSON.stringify({ $schema: dialect, $ref }))));
    }
    for (const value of [{}, { $schema: 'http://json-schema.org/draft-07/schema#' },
      { $schema: dialect, type: 'not-a-type' }, { $schema: dialect, required: 'x' },
      { $schema: dialect, $defs: { older: { $schema: 'http://json-schema.org/draft-07/schema#' } } },
      { $schema: dialect, properties: { x: { type: 8 } } }]) {
      assert.throws(() => validateArtifact(doc('json-schema', JSON.stringify(value))), /metadata|explicit/);
    }
    for (const source of ['{"__proto__":{}}', '{"nested":{"constructor":{}}}', '{"x":NaN}', '{"x":1e999}', '{"a":', 'openapi: 3.1.0']) {
      assert.throws(() => validateArtifact(doc('json-schema', source)), /prototype|strict JSON|finite/);
    }
    const api = { openapi: '3.1.0', jsonSchemaDialect: dialect, info: { title: 'API', version: '1' }, paths: {} };
    for (const extra of [{ openapi: '3.0.3' }, { info: {} }, { servers: [{ url: 'https://example.com' }] },
      { paths: { '/x': { get: {} } } }, { components: { schemas: { Bad: { type: 4 } } } }]) {
      assert.throws(() => validateArtifact(doc('openapi', JSON.stringify({ ...api, ...extra }))), /structural subset/);
    }
    assert.equal({}.polluted, undefined);
  } finally { globalThis.fetch = oldFetch; }
});

test('published document branch round trips exact source and immutable revision digest', async t => {
  const root = resolve('.tandem', `document-publication-${randomUUID()}`);
  await mkdir(root, { recursive: true });
  t.after(async () => { await getHostStateWal(root).close(); await rm(root, { recursive: true, force: true }); });
  const content = sharedDesignV3();
  content.artifacts.push({ schemaVersion: 'artifact/v1', format: 'mermaid', id: 'published-companion',
    title: 'Declared exchange', category: 'user-story', width: 600, height: 400, source: 'flowchart LR\nA --> B' },
  doc('markdown', '# Exact\r\n\r\n| A | B |\r\n|---|---|\r\n|1|2|\r\n',
    { category: 'system', visualCompanionId: 'published-companion' }));
  const store = new HumanLoopDesignStore(root);
  const journal = new HostStateFile(root, resolve(root, '.tandem', 'living-canvas', 'document-test.json'));
  const revision = await journal.run('publish-document-test', () => store.publish({
    input: content, previous: { revisionId: null, digest: null }, requestId: 'document-request',
    application: { id: randomUUID(), proposedAt: new Date().toISOString(), designDigest: policyHash(validateDesign(content)) },
  }));
  const binding = sharedDesignBinding(revision);
  const read = await new HumanLoopDesignStore(root).readRevision(binding);
  assert.deepEqual(read.input, content);
  assert.equal(read.input.artifacts.at(-1).source, content.artifacts.at(-1).source);
  assert.deepEqual(sharedDesignBinding(read), binding);
});

test('document metadata validators are precompiled locally and sources stay bounded', async () => {
  const vendor = await readFile(new URL('../public/artifacts/vendor/documents.js', import.meta.url), 'utf8');
  assert.doesNotMatch(vendor, /\bnew Function\b|\beval\s*\(|\bfetch\s*\(|XMLHttpRequest/);
  let nested = { type: 'string' };
  for (let i = 0; i < 45; i++) nested = { properties: { child: nested } };
  assert.throws(() => validateArtifact(doc('json-schema', JSON.stringify({ $schema: dialect, ...nested }))), /depth 40/);
  assert.throws(() => validateArtifact(doc('markdown', 'x'.repeat(100001))), /100000/);
  assert.throws(() => validateArtifact(doc('json-schema', JSON.stringify({ $schema: dialect, enum: Array.from({ length: 12001 }, (_, i) => i) }))), /12000/);
});
