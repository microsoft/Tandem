import assert from 'node:assert/strict';
import test from 'node:test';
import { DESIGN_VERSION, DESIGN_V2_VERSION, DESIGN_V1_VERSION, designSchema, designV2Schema, designV1Schema, designGenerationContract, validateDesign, designReferenceCatalog,
  validateDesignReferences, resolveDesignReference, validateArtifactAnnotationSource } from '../public/sketch/design-contract.js';
import { sketchSchema, sketchV1Schema, validateSketch, validateSketchSchema } from '../public/sketch/contract.js';
import { layoutSketch } from '../public/sketch/renderer.js';
import { sharedDesign } from './helpers/shared-design-fixture.mjs';
import { multiFormatDesign } from './fixtures/multi-format.mjs';

function authoredV2() {
  const value = sharedDesign();
  value.schemaVersion = DESIGN_VERSION;
  for (const artifact of value.artifacts) artifact.schemaVersion = 'sketch/v2';
  return value;
}

test('one canonical envelope uses the exact shared document schema and renderable data-only templates', () => {
  assert.ok(designSchema.properties.artifacts.items.oneOf.includes(sketchSchema));
  assert.equal(designGenerationContract.schema, designSchema);
  for (const { document } of designGenerationContract.templates) assert.ok(layoutSketch(document).boxes.length);
  const input = sharedDesign(), before = structuredClone(input), output = validateDesign(input);
  assert.deepEqual(input, before);
  assert.notEqual(output, input);
  assert.ok(Object.isFrozen(output.artifacts[0].boxes[0]));
  assert.equal(output.goal, input.goal);
  assert.deepEqual(output.outcomes, input.outcomes);
});

test('artifact collections are dynamic, not a fixed five-perspective set', () => {
  const input = sharedDesign();
  for (let i = 0; i < 6; i++) input.artifacts.push({ ...structuredClone(input.artifacts[0]), id: `additional-${i}`, title: `Additional view ${i}` });
  assert.equal(validateDesign(input).artifacts.length, 7);
  assert.equal(designReferenceCatalog(input).filter(({ kind }) => kind === 'artifact').length, 7);
});

test('portable formats retain exact source and use only source-authored references', () => {
  const input = multiFormatDesign(), before = JSON.stringify(input);
  const output = validateDesign(input);
  assert.equal(JSON.stringify(output), before);
  assert.ok(Object.isFrozen(output.artifacts[0]));
  assert.equal(resolveDesignReference(input, 'checkout#drink').elementId, 'drink');
  assert.equal(resolveDesignReference(input, 'pickup-plan#counter').elementId, 'counter');
  assert.throws(() => resolveDesignReference(input, 'order-flow#flowchart-menu-0'), /Unknown Design reference/);
  assert.throws(() => validateDesign({ ...input, artifacts: [{ ...input.artifacts[0], format: 'javascript' }] }), /format/);
  const previous = sharedDesign(), next = multiFormatDesign();
  next.artifacts.push(...previous.artifacts);
  assert.equal(validateDesign(next, { previous }).artifacts.at(-1).schemaVersion, 'sketch/v1');
  assert.equal(JSON.stringify(previous), JSON.stringify(sharedDesign()));
  const changedFormat = structuredClone(input);
  changedFormat.artifacts[1] = {
    ...input.artifacts[1], format: 'svg',
    source: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 480"><rect id="drink" width="100" height="100"/></svg>',
  };
  assert.equal(resolveDesignReference(validateDesign(changedFormat, { previous: input }), 'checkout#drink').elementId, 'drink');
});

test('generic document and element references validate existence without per-kind contracts', () => {
  const input = sharedDesign();
  assert.deepEqual(validateDesignReferences(input, ['interaction', 'interaction#deliver']), ['interaction', 'interaction#deliver']);
  assert.equal(resolveDesignReference(input, 'interaction#deliver').kind, 'box');
  assert.equal(resolveDesignReference(input, 'interaction#handoff-result').kind, 'connection');
  assert.throws(() => validateDesignReferences(input, ['missing']), /Unknown Design reference/);
  assert.throws(() => validateDesignReferences(input, ['interaction#missing']), /Unknown Design reference/);
  assert.throws(() => validateDesignReferences(input, ['interaction', 'interaction']), /unique/);
  assert.throws(() => validateDesignReferences(null, ['interaction']), /Unknown Design reference/);
  assert.deepEqual(validateDesignReferences(null, []), []);
});

test('legacy documents, invalid references and unstable kind reuse are rejected without conversion', () => {
  assert.throws(() => validateDesign({ useCases: [], controlFlows: [] }), /not implicitly converted/);
  const input = sharedDesign();
  input.outcomes[0].references = ['interaction#absent'];
  assert.throws(() => validateDesign(input), /Unknown Design reference/);
  const previous = sharedDesign(), next = sharedDesign();
  next.artifacts[0].boxes = next.artifacts[0].boxes.filter(({ id }) => id !== 'accept');
  next.artifacts[0].connections = [{ id: 'accept', from: 'prepare', to: 'review' }];
  next.outcomes[0].references = ['interaction#accept'];
  assert.throws(() => validateDesign(next, { previous }), /identity cannot change/);
  const unchangedIds = sharedDesign();
  unchangedIds.artifacts[0].boxes.find(({ id }) => id === 'deliver').details = 'Updated full details, same identity.';
  assert.equal(validateDesign(unchangedIds, { previous }).artifacts[0].boxes.find(({ id }) => id === 'deliver').id, 'deliver');
});

test('layout and text feasibility are part of canonical admission, not a later browser-only failure', () => {
  const input = sharedDesign(), before = structuredClone(input);
  input.artifacts[0].boxes[0].label = 'This container label cannot fit in its allocated header '.repeat(2);
  assert.throws(() => validateDesign(input), /Label cannot fit/);
  assert.deepEqual(before, sharedDesign());
  const touching = sharedDesign();
  touching.artifacts[0].boxes[1].x = 16;
  assert.throws(() => validateDesign(touching), /overlap|gap/i);
  const unroutable = sharedDesign(), artifact = unroutable.artifacts[0];
  artifact.boxes = ['a', 'b'].flatMap((side, column) => [0, 1, 2].map((row) => ({
    id: `${side}${row}`, label: `${side}${row}`, x: column * 30, y: row * 10, w: 10, h: 4,
  })));
  artifact.connections = [0, 1, 2].flatMap((a) => [0, 1, 2].map((b) => ({
    id: `edge-${a}-${b}`, from: `a${a}`, to: `b${b}`,
  })));
  unroutable.outcomes[0].references = ['interaction#a0'];
  assert.ok(validateSketch(artifact));
  assert.throws(() => validateDesign(unroutable), /route|routing|label|port/i);
});

test('artifact annotation identity is exact across revision, digest, document and optional element', () => {
  const design = sharedDesign(), binding = { revisionId: 'revision', digest: 'a'.repeat(64) };
  const source = { schemaVersion: 'artifact-annotation/v1', revisionId: binding.revisionId, designDigest: binding.digest,
    artifactId: 'interaction', selectionId: 'deliver', viewport: { x: 0, y: 0, width: 100, height: 100, scale: 1 } };
  assert.equal(validateArtifactAnnotationSource(source, binding, design), source);
  assert.throws(() => validateArtifactAnnotationSource({ ...source, designDigest: 'b'.repeat(64) }, binding, design), /another exact Design revision/);
  assert.throws(() => validateArtifactAnnotationSource({ ...source, revisionId: 'other' }, binding, design), /another exact Design revision/);
  assert.throws(() => validateArtifactAnnotationSource({ ...source, artifactId: 'missing' }, binding, design), /Unknown Design reference/);
  assert.throws(() => validateArtifactAnnotationSource({ ...source, artifactId: 'interaction#deliver' }, binding, design), /artifact identity/);
  assert.throws(() => validateArtifactAnnotationSource({ ...source, selectionId: 'missing' }, binding, design), /Unknown Design reference/);
  assert.throws(() => validateArtifactAnnotationSource({ ...source, schemaVersion: 'old' }, binding, design), /not rebound/);
});

test('homogeneous collections dispatch versions without changing exact legacy data or accepting mixed documents', () => {
  const old = sharedDesign(), before = JSON.stringify(old);
  assert.equal(old.schemaVersion, DESIGN_V1_VERSION);
  assert.equal(designV1Schema.properties.artifacts.items, sketchV1Schema);
  assert.equal(designV2Schema.properties.artifacts.items, sketchSchema);
  assert.equal(JSON.stringify(validateDesign(old)), before);
  assert.equal(JSON.stringify(old), before);
  assert.ok(Object.isFrozen(designV1Schema.properties));
  assert.throws(() => validateSketchSchema(old, designSchema, 'design'), { code: 'version' },
    'The current tool schema is writable v3, even though explicit reads retain v1/v2.');
  const current = authoredV2();
  assert.equal(validateDesign(current).schemaVersion, DESIGN_VERSION);
  assert.equal(JSON.stringify(current), JSON.stringify(validateDesign(current)));
  for (const [envelope, document] of [[DESIGN_V2_VERSION, 'sketch/v1'], [DESIGN_V1_VERSION, 'sketch/v2']]) {
    const mixed = sharedDesign();
    mixed.schemaVersion = envelope; mixed.artifacts[0].schemaVersion = document;
    assert.throws(() => validateDesign(mixed), { code: 'version' });
  }
  const mixed = authoredV2();
  mixed.artifacts.push({ ...sharedDesign().artifacts[0], id: 'legacy' });
  assert.deepEqual(validateDesign(mixed), mixed, 'V3 retains legacy documents without read-time conversion.');
  assert.throws(() => validateDesign({ ...old, schemaVersion: 'sketch-design/v4' }), { code: 'version' });
});

test('stable identities and references remain bound across an explicit v1-to-v2 replacement', () => {
  const previous = sharedDesign(), next = authoredV2();
  assert.deepEqual(validateDesign(next, { previous }), next);
  assert.equal(resolveDesignReference(previous, 'interaction#deliver').label, 'Deliver result');
  assert.equal(resolveDesignReference(next, 'interaction#deliver').kind, 'box');
  next.artifacts[0].boxes = next.artifacts[0].boxes.filter(({ id }) => id !== 'accept');
  next.artifacts[0].connections = [{ id: 'accept', from: 'prepare', to: 'review' }];
  next.outcomes[0].references = ['interaction#accept'];
  assert.throws(() => validateDesign(next, { previous }), { code: 'identity-reuse' });
  assert.equal(resolveDesignReference(previous, 'interaction#accept').kind, 'box');
});

test('v2 catalogs expose exact caption/body separately from stable title and disclosure', () => {
  const input = {
    schemaVersion: DESIGN_VERSION, goal: 'Read all text.', summary: 'One generic visible note.',
    outcomes: [{ id: 'read-text', description: 'Text is visible and exact.', references: ['notes#note'] }],
    artifacts: [{ schemaVersion: 'sketch/v2', id: 'notes', title: 'Notes', boxes: [{
      id: 'note', label: ' A title ', caption: '  Secondary caption  ', body: ' First line\n\n  Second line ',
      details: ' Disclosure stays separate. ', shape: 'none', x: 0, y: 0, w: 24, h: 15,
    }], connections: [] }],
  };
  const before = JSON.stringify(input), item = resolveDesignReference(input, 'notes#note');
  assert.deepEqual(item, {
    reference: 'notes#note', artifactId: 'notes', elementId: 'note', kind: 'box', label: ' A title ',
    caption: '  Secondary caption  ', body: ' First line\n\n  Second line ', details: ' Disclosure stays separate. ',
  });
  assert.deepEqual(designReferenceCatalog(input).find(({ elementId }) => elementId === 'note'), item);
  assert.equal(JSON.stringify(input), before);
  const oldItem = resolveDesignReference(sharedDesign(), 'interaction#deliver');
  assert.equal(Object.hasOwn(oldItem, 'caption'), false);
  assert.equal(Object.hasOwn(oldItem, 'body'), false);
});
