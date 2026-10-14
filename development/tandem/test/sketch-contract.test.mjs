import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generationContract, sketchSchema, SketchValidationError, validateSketch, wrapSketchText,
} from '../public/sketch/contract.js';
import { createLegacyTemplate as createTemplate, templateCatalog } from '../public/sketch/templates.js';

const minimal = () => ({
  schemaVersion: 'sketch/v1', id: 'example', title: 'Example',
  boxes: [{ id: 'one', label: 'One', x: 0, y: 0, w: 6, h: 3 }],
  connections: [],
});
const invalid = (mutate, code) => {
  const value = minimal();
  mutate(value);
  assert.throws(() => validateSketch(value), (error) => error instanceof SketchValidationError && error.code === code);
};

test('one exported JSON schema is the generation contract and drives structural validation', () => {
  assert.equal(generationContract.schema, sketchSchema);
  assert.equal(sketchSchema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(sketchSchema.additionalProperties, false);
  assert.ok(Object.isFrozen(sketchSchema.properties.boxes.items.properties));
  assert.ok(generationContract.rules.some((rule) => rule.includes('canonical')));
  assert.deepEqual(JSON.parse(JSON.stringify(generationContract)).schema, sketchSchema);
  assert.doesNotThrow(() => validateSketch(minimal()));
});

test('all templates are fresh instances of exactly the same schema', () => {
  assert.deepEqual(templateCatalog.map((item) => item.id), ['workflow', 'architecture', 'ui']);
  for (const { id } of templateCatalog) {
    const first = createTemplate(id), second = createTemplate(id);
    assert.deepEqual(first, second);
    assert.notEqual(first.boxes[0], second.boxes[0]);
    const validated = validateSketch(first);
    assert.deepEqual(validated, first);
    assert.notEqual(validated, first);
    assert.ok(Object.isFrozen(validated.boxes[0]));
    first.boxes[0].label = 'Changed';
    assert.notEqual(createTemplate(id).boxes[0].label, 'Changed');
  }
  assert.throws(() => createTemplate('toString'), RangeError);
  assert.throws(() => createTemplate('new-kind'), RangeError);
});

test('rejects unknown versions, fields, IDs, nulls, and non-JSON object properties', () => {
  invalid((value) => { value.schemaVersion = 'sketch/v3'; }, 'version');
  invalid((value) => { value.type = 'workflow'; }, 'unknown-field');
  invalid((value) => { value.boxes[0].html = '<b>One</b>'; }, 'unknown-field');
  invalid((value) => { value.boxes[0].id = 'bad id'; }, 'text');
  invalid((value) => { value.boxes[0].id = 'a\n'; }, 'text');
  invalid((value) => { value.boxes[0].label = ''; }, 'bounds');
  invalid((value) => { value.title = '\u0000'; }, 'text');
  invalid((value) => { value.description = null; }, 'type');
  invalid((value) => { delete value.connections; }, 'required');
  invalid((value) => { value.boxes[0] = new Date(); }, 'type');
  invalid((value) => {
    Object.defineProperty(value.boxes[0], 'label', { enumerable: true, get() { throw new Error('Must not execute'); } });
  }, 'type');
  invalid((value) => { value.boxes.toJSON = () => []; }, 'type');
  invalid((value) => { delete value.boxes[0]; }, 'type');
  invalid((value) => {
    Object.defineProperty(value.boxes, '0', { enumerable: true, get() { throw new Error('Must not execute'); } });
  }, 'type');
});

test('rejects unsafe, nonfinite, fractional, negative, and excessive geometry and counts', () => {
  for (const bad of [NaN, Infinity, -Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1, '1', null]) {
    invalid((value) => { value.boxes[0].x = bad; }, 'type');
  }
  invalid((value) => { value.boxes[0].x = -1; }, 'bounds');
  invalid((value) => { value.boxes[0].w = 5; }, 'bounds');
  invalid((value) => { value.boxes[0].h = 2; }, 'bounds');
  invalid((value) => { value.boxes[0].x = 120; }, 'bounds');
  invalid((value) => { value.boxes = []; }, 'bounds');
  invalid((value) => { value.boxes = Array.from({ length: 49 }, (_, i) => ({ ...value.boxes[0], id: `box-${i}` })); }, 'bounds');
  invalid((value) => { value.connections = Array(33).fill({ id: 'edge', from: 'one', to: 'two' }); }, 'bounds');
});

test('rejects duplicate identities and dangling parents or directed endpoints', () => {
  invalid((value) => { value.boxes[0].id = value.id; }, 'duplicate-id');
  invalid((value) => { value.boxes.push({ ...value.boxes[0], x: 10 }); }, 'duplicate-id');
  invalid((value) => { value.boxes[0].parent = 'missing'; }, 'reference');
  invalid((value) => { value.connections.push({ id: 'edge', from: 'one', to: 'missing' }); }, 'reference');
  invalid((value) => { value.connections.push({ id: 'one', from: 'one', to: 'one' }); }, 'duplicate-id');
  invalid((value) => { value.connections.push({ id: 'edge', from: 'one', to: 'one' }); }, 'endpoint');
});

test('rejects containment cycles, deep nesting, outside children, and insufficient header clearance', () => {
  invalid((value) => { value.boxes[0].parent = 'one'; }, 'cycle');
  invalid((value) => {
    value.boxes[0].parent = 'two';
    value.boxes.push({ ...value.boxes[0], id: 'two', parent: 'one' });
  }, 'cycle');
  const nested = minimal();
  nested.boxes = Array.from({ length: 5 }, (_, index) => ({
    id: `level-${index}`, label: 'Level', x: index ? 1 : 0, y: index ? 3 : 0,
    w: 40 - index * 3, h: 40 - index * 5, ...(index ? { parent: `level-${index - 1}` } : {}),
  }));
  assert.throws(() => validateSketch(nested), { code: 'depth' });
  const workflow = createTemplate('workflow');
  workflow.boxes.find((box) => box.id === 'prepare').x = 0;
  assert.throws(() => validateSketch(workflow), { code: 'containment' });
  workflow.boxes.find((box) => box.id === 'prepare').x = 5;
  assert.throws(() => validateSketch(workflow), { code: 'containment' });
  workflow.boxes.find((box) => box.id === 'prepare').x = 2;
  workflow.boxes.find((box) => box.id === 'prepare').y = 2;
  assert.throws(() => validateSketch(workflow), { code: 'containment' });
  workflow.boxes.find((box) => box.id === 'prepare').y = 4;
  workflow.connections = [{ id: 'parent-edge', from: 'requester', to: 'prepare' }];
  assert.throws(() => validateSketch(workflow), { code: 'endpoint' });
});

test('rejects overlapping siblings and impossible labels instead of hiding or truncating', () => {
  invalid((value) => { value.boxes.push({ ...value.boxes[0], id: 'two', x: 6 }); }, 'overlap');
  invalid((value) => { value.boxes[0].label = 'W'.repeat(17); }, 'text-fit');
  const value = minimal();
  value.boxes[0].label = 'W'.repeat(16);
  assert.doesNotThrow(() => validateSketch(value));
  value.boxes.push({ ...value.boxes[0], id: 'two', x: 7 });
  assert.doesNotThrow(() => validateSketch(value));
  const workflow = createTemplate('workflow');
  workflow.boxes[0].label = 'W'.repeat(53);
  assert.throws(() => validateSketch(workflow), { code: 'text-fit' });
});

test('bounds ports, rejects same-direction duplicates, and accepts opposite directions', () => {
  const value = minimal();
  value.boxes.push({ ...value.boxes[0], id: 'two', x: 10 });
  value.connections = [{ id: 'forward', from: 'one', to: 'two' }, { id: 'reverse', from: 'two', to: 'one' }];
  assert.doesNotThrow(() => validateSketch(value));
  value.connections[1] = { id: 'duplicate', from: 'one', to: 'two' };
  assert.throws(() => validateSketch(value), { code: 'endpoint' });
  value.connections = [];
  for (let index = 0; index < 5; index++) {
    value.boxes.push({ ...value.boxes[0], id: `target-${index}`, x: index * 10, y: 10 });
    value.connections.push({ id: `edge-${index}`, from: 'one', to: `target-${index}` });
  }
  assert.throws(() => validateSketch(value), { code: 'degree' });
});

test('validation and wrapping preserve exact text and details without mutating inputs', () => {
  const value = minimal();
  value.description = '  Original description\nwith <markup> & punctuation.  ';
  value.boxes[0].label = ' A & B\n第二行 ';
  value.boxes[0].details = '</desc><script>alert("not code")</script>\n  exact details ';
  const before = JSON.stringify(value), copy = validateSketch(value);
  assert.equal(JSON.stringify(value), before);
  assert.equal(copy.description, value.description);
  assert.equal(copy.boxes[0].details, value.boxes[0].details);
  assert.deepEqual(wrapSketchText('ab  cd\n\n😀中文', 3), ['ab ', ' cd', '', '😀中文']);
  assert.throws(() => wrapSketchText('abc', 0), { code: 'text-fit' });
});
