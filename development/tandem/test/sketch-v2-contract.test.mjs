import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  SKETCH_VERSION, SKETCH_V1_VERSION, sketchSchema, sketchV1Schema, generationContract,
  SKETCH_SHAPES, SKETCH_PROFILES, SKETCH_TREATMENTS, SKETCH_ICONS, SKETCH_SPACING,
  validateSketch, validateSketchSchema, absoluteSketchBoxes, GRID, MAX_DEPTH, MAX_EXTENT,
} from '../public/sketch/contract.js';
import { createTemplate, createLegacyTemplate, templateCatalog } from '../public/sketch/templates.js';
import { ICON_NAMES } from '../public/sketch/icons.js';

const node = (id, extra = {}) => ({ id, label: id, x: 0, y: 0, w: 12, h: 8, ...extra });
const sketch = () => ({ schemaVersion: SKETCH_VERSION, id: 'document', title: 'Composition',
  boxes: [node('first'), node('second', { x: 24 })], connections: [] });
const automatic = () => ({ ...sketch(), boxes: [
  node('group', { w: 60, h: 40, layout: { direction: 'horizontal', order: ['second', 'first'] } }),
  { id: 'first', label: 'First', parent: 'group', w: 12, h: 8 },
  { id: 'second', label: 'Second', parent: 'group', w: 12, h: 8 },
] });
const rejects = (factory, mutate, code) => {
  const input = factory(); mutate(input);
  assert.throws(() => validateSketch(input), { name: 'SketchValidationError', code });
};
const edge = (id, arrowheads, reverse = false) => ({ id, from: reverse ? 'second' : 'first',
  to: reverse ? 'first' : 'second', ...(arrowheads === undefined ? {} : { arrowheads }) });

test('v2 is writable and v1 retains an explicit frozen schema without widening', () => {
  assert.equal(SKETCH_VERSION, 'sketch/v2');
  assert.equal(SKETCH_V1_VERSION, 'sketch/v1');
  assert.equal(generationContract.schema, sketchSchema);
  assert.equal(sketchV1Schema.properties.schemaVersion.const, SKETCH_V1_VERSION);
  assert.equal(sketchSchema.properties.schemaVersion.const, SKETCH_VERSION);
  assert.deepEqual([GRID, MAX_DEPTH, MAX_EXTENT], [24, 4, 120]);
  assert.ok(Object.isFrozen(sketchV1Schema.properties.boxes.items.properties));
  assert.equal(sketchV1Schema.properties.boxes.items.properties.shape, undefined);
  assert.equal(sketchSchema.properties.boxes.maxItems, 48);
  assert.equal(sketchSchema.properties.connections.maxItems, 32);
  rejects(sketch, (value) => { value.schemaVersion = 'sketch/v3'; }, 'version');
  rejects(sketch, (value) => { value.schemaVersion = SKETCH_V1_VERSION; value.boxes[0].shape = 'circle'; }, 'unknown-field');
  assert.doesNotMatch(generationContract.rules.join('\n'), /side-center|cannot cross|earlier connections|no .*styling fields/);
});

test('the shared enums are enforced by the same structural schema used for generation', () => {
  for (const shape of SKETCH_SHAPES) assert.ok(validateSketch({ ...sketch(), boxes: [node('first', { shape })] }));
  for (const profile of SKETCH_PROFILES) {
    const value = sketch();
    value.boxes[0].appearance = { profile };
    value.connections = [{ ...edge('relation'), appearance: { profile } }];
    assert.ok(validateSketch(value));
  }
  for (const treatment of SKETCH_TREATMENTS) assert.ok(validateSketch({ ...sketch(), boxes: [node('first', { appearance: { treatment } })] }));
  for (const icon of SKETCH_ICONS) assert.ok(validateSketch({ ...sketch(), boxes: [node('first', { icon })] }));
  assert.equal(SKETCH_ICONS.length, 10);
  assert.equal(SKETCH_ICONS, ICON_NAMES);
  for (const spacing of SKETCH_SPACING) {
    const value = automatic(); Object.assign(value.boxes[0].layout, { gap: spacing, padding: spacing });
    assert.ok(validateSketch(value));
  }
  for (const patch of [
    { shape: 'ellipse' }, { icon: 'https://example.test/icon.svg' }, { caption: '' }, { body: '' },
    { text: { align: 'left' } }, { text: { emphasis: 'bold' } },
    { appearance: { profile: '#123456' } }, { appearance: { treatment: 'flat' } },
    { sizing: { width: 'auto' } }, { sizing: { height: 'fill' } },
  ]) rejects(sketch, (value) => Object.assign(value.boxes[0], patch), ('caption' in patch || 'body' in patch) ? 'bounds' : 'enum');
  for (const patch of [{ direction: 'grid' }, { gap: 0 }, { padding: 4 }, { align: 'stretch' }]) {
    rejects(automatic, (value) => Object.assign(value.boxes[0].layout, patch), 'enum');
  }
  for (const patch of [{ arrowheads: 'start' }, { stroke: 'dotted' }, { appearance: { profile: 'green' } }]) {
    rejects(sketch, (value) => { value.connections = [{ ...edge('relation'), ...patch }]; }, 'enum');
  }
  rejects(sketch, (value) => { value.connections = [{ ...edge('relation'), appearance: { treatment: 'filled' } }]; }, 'unknown-field');
  assert.throws(() => validateSketchSchema('anything', { type: 'boolean' }, 'schema'), { code: 'schema' });
});

test('explicit red reuses the closed node/connector profile enum without rewriting input', () => {
  assert.deepEqual(SKETCH_PROFILES, ['neutral', 'teal', 'blue', 'violet', 'amber', 'red']);
  assert.ok(Object.isFrozen(SKETCH_PROFILES));
  const nodeProfile = sketchSchema.properties.boxes.items.properties.appearance.properties.profile;
  const connectorProfile = sketchSchema.properties.connections.items.properties.appearance.properties.profile;
  assert.equal(nodeProfile, connectorProfile);
  assert.equal(nodeProfile.enum, SKETCH_PROFILES);
  for (const treatment of SKETCH_TREATMENTS) {
    const value = sketch();
    value.boxes[0].appearance = { profile: 'red', treatment };
    value.connections = [{ ...edge('relation'), appearance: { profile: 'red' } }];
    const source = JSON.stringify(value);
    assert.equal(JSON.stringify(validateSketch(value)), source);
    assert.equal(JSON.stringify(value), source);
  }
  for (const profile of ['green', 'orange', 'pink', 'RED', '#ff0000', 'rgb(255,0,0)']) {
    rejects(sketch, value => { value.boxes[0].appearance = { profile }; }, 'enum');
    rejects(sketch, value => { value.connections = [{ ...edge('relation'), appearance: { profile } }]; }, 'enum');
  }
  rejects(sketch, value => {
    value.schemaVersion = SKETCH_V1_VERSION;
    value.boxes[0].appearance = { profile: 'red' };
  }, 'unknown-field');
});

test('v2 exact text and absent defaults survive frozen validation without invoking getters', () => {
  const input = automatic();
  Object.assign(input.boxes[1], {
    label: '  Title\n第二行 ', caption: ' Captions\n  remain exact ', body: ' Body\n\n<not-markup>  ',
    details: ' Disclosure is not a replacement for visible content. ', shape: 'rounded-rectangle',
    text: { align: 'end', emphasis: 'normal' }, appearance: { profile: 'neutral', treatment: 'outlined' },
    sizing: { width: 'stretch', height: 'stretch' }, icon: 'document',
  });
  const before = JSON.stringify(input), output = validateSketch(input);
  assert.equal(JSON.stringify(output), before);
  assert.equal(JSON.stringify(input), before);
  assert.notEqual(output, input);
  assert.ok(Object.isFrozen(output.boxes[0].layout.order));
  assert.ok(Object.isFrozen(output.boxes[1].text));
  assert.equal(Object.hasOwn(output.boxes[2], 'x'), false);
  assert.equal(Object.hasOwn(output.boxes[2], 'appearance'), false);
  assert.equal(Object.hasOwn(output.boxes[2], 'sizing'), false);
  rejects(sketch, (value) => Object.defineProperty(value, 'schemaVersion', { enumerable: true, get() { throw Error('Executed getter'); } }), 'type');
  rejects(sketch, (value) => Object.defineProperty(value.boxes[0], 'caption', { enumerable: true, get() { throw Error('Executed getter'); } }), 'type');
  rejects(sketch, (value) => { value.boxes[0].body = '😀'.repeat(2001); }, 'bounds');
  rejects(sketch, (value) => { value.boxes[0].caption = '😀'.repeat(161); }, 'bounds');
  rejects(sketch, (value) => { value.boxes[0].body = '\t'; }, 'text');
  const long = sketch(); long.boxes[0].body = '😀'.repeat(2000); long.boxes[0].caption = '😀'.repeat(160);
  assert.ok(validateSketch(long), 'Measurement/fit belongs to layoutSketch, not structural admission.');
});

test('roots/free children require coordinates and automatic children reject even explicit zero', () => {
  assert.ok(validateSketch(automatic()));
  for (const axis of ['x', 'y']) {
    rejects(sketch, (value) => { delete value.boxes[0][axis]; }, 'required');
    rejects(automatic, (value) => { value.boxes[1][axis] = 0; }, 'layout');
  }
  const free = automatic();
  free.boxes[0].layout = { direction: 'free', padding: 2 };
  free.boxes[1].x = 2; free.boxes[1].y = 4; free.boxes[2].x = 20; free.boxes[2].y = 4;
  assert.ok(validateSketch(free));
  delete free.boxes[1].x;
  assert.throws(() => validateSketch(free), { code: 'required' });
  rejects(sketch, (value) => { delete value.boxes[0].w; }, 'required');
  rejects(sketch, (value) => { value.boxes[0].h = 121; }, 'bounds');
  rejects(sketch, (value) => { value.boxes[0].w = 5; }, 'bounds');
});

test('automatic group order is exhaustive, direct, unique and independent of array order', () => {
  const input = automatic(), first = validateSketch(input);
  input.boxes.reverse();
  assert.deepEqual(validateSketch(input).boxes.find(({ id }) => id === 'group').layout.order, ['second', 'first']);
  assert.deepEqual(first.boxes[0].layout.order, ['second', 'first']);
  for (const order of [[], ['first'], ['first', 'first'], ['first', 'absent'], ['first', 'second', 'group']]) {
    rejects(automatic, (value) => { value.boxes[0].layout.order = order; }, 'layout');
  }
  rejects(automatic, (value) => { delete value.boxes[0].layout.order; }, 'required');
  for (const field of ['order', 'align', 'gap']) {
    rejects(automatic, (value) => {
      value.boxes[0].layout = { direction: 'free', [field]: field === 'order' ? ['first', 'second'] : field === 'align' ? 'start' : 1 };
      for (const box of value.boxes.slice(1)) Object.assign(box, { x: 2, y: 4 });
    }, 'layout');
  }
  rejects(sketch, (value) => { value.boxes[0].layout = { direction: 'vertical', order: [] }; }, 'layout');
});

test('shape/layout/sizing combinations reject irrelevant fields rather than silently ignoring them', () => {
  for (const shape of ['circle', 'diamond', 'none']) rejects(automatic, (value) => { value.boxes[0].shape = shape; }, 'shape');
  for (const treatment of ['outlined', 'tinted', 'filled']) {
    rejects(sketch, (value) => Object.assign(value.boxes[0], { shape: 'none', appearance: { treatment } }), 'appearance');
  }
  assert.ok(validateSketch({ ...sketch(), boxes: [node('note', { shape: 'none', appearance: { treatment: 'quiet' } })] }));
  for (const axis of ['width', 'height']) {
    rejects(sketch, (value) => { value.boxes[0].sizing = { [axis]: 'stretch' }; }, 'sizing');
    rejects(automatic, (value) => { value.boxes[1].shape = 'circle'; value.boxes[1].sizing = { [axis]: 'stretch' }; }, 'sizing');
    const value = automatic(); value.boxes[1].sizing = { [axis]: 'stretch' }; assert.ok(validateSketch(value));
  }
  const circle = automatic(); circle.boxes[1].shape = 'circle'; circle.boxes[1].sizing = { width: 'content', height: 'content' };
  assert.ok(validateSketch(circle));
});

test('v2 retains identity, parent cycle/depth and four-incident-edge bounds', () => {
  rejects(sketch, (value) => { value.boxes[0].id = value.id; }, 'duplicate-id');
  rejects(sketch, (value) => { value.boxes[0].parent = 'missing'; }, 'reference');
  rejects(sketch, (value) => { value.boxes[0].parent = 'second'; value.boxes[1].parent = 'first'; }, 'cycle');
  rejects(sketch, (value) => { value.connections = [edge('relation')]; value.connections[0].to = 'missing'; }, 'reference');
  rejects(automatic, (value) => { value.connections = [{ id: 'relation', from: 'group', to: 'first' }]; }, 'endpoint');
  rejects(sketch, (value) => {
    value.boxes = Array.from({ length: 5 }, (_, i) => node(`node-${i}`, i ? { parent: `node-${i - 1}` } : {}));
  }, 'depth');
  rejects(sketch, (value) => {
    value.boxes = [node('first'), ...Array.from({ length: 5 }, (_, i) => node(`target-${i}`))];
    value.connections = Array.from({ length: 5 }, (_, i) => ({ id: `edge-${i}`, from: 'first', to: `target-${i}`, arrowheads: 'none' }));
  }, 'degree');
});

test('none/both occupy the unordered pair and reverse one-way arrows remain independent', () => {
  for (const arrowheads of [undefined, 'end', 'none', 'both']) {
    const value = sketch(); value.connections = [edge('relation', arrowheads)]; assert.ok(validateSketch(value));
  }
  for (const first of [undefined, 'end', 'none', 'both']) for (const second of [undefined, 'end', 'none', 'both']) {
    const value = sketch(); value.connections = [edge('forward', first), edge('reverse', second, true)];
    if ([undefined, 'end'].includes(first) && [undefined, 'end'].includes(second)) assert.ok(validateSketch(value));
    else assert.throws(() => validateSketch(value), { code: 'endpoint' });
    value.connections[1] = edge('duplicate', second);
    assert.throws(() => validateSketch(value), { code: 'endpoint' });
  }
});

test('legacy templates stay exact and v2 templates are fresh current authoring data', () => {
  // Digests of the unchanged JSON fixtures at d928a3ad1367ef02cf9222df50be9cf5e759454d.
  const baseline = {
    workflow: '8d1169726db08a1f724acf466bc3f02f0ada57e65078ac86547b3ccf9315a978',
    architecture: 'd1eeed3547519341315443dc6aa447eb9583135e41c3da4c4af45358381aec85',
    ui: '34d90c7bebadc9d6711e28fb2966d83e4c37c5c2a9978f04be8bc7e417aa5f29',
  };
  // Current v2 JSON at ebebf00ea8efdaca0ac0443e5039774ca75d3d5d, before explicit red.
  const v2Baseline = {
    workflow: '82db240604c3148757aed0eae8bbb0f198f08e1f1414066760bc43bee3bc818a',
    architecture: 'da728b3a15f5914bea8e77c34c2baab9918d8fbb1bcb5785a691d6895029a2dd',
    ui: 'b665fdaedd1f3d4b9ed4d2efe3337d97cb17e76327e2bb42ba60ee1bd8d9bb88',
  };
  for (const { id } of templateCatalog) {
    const old = createLegacyTemplate(id), source = JSON.stringify(old);
    assert.equal(old.schemaVersion, SKETCH_V1_VERSION);
    assert.deepEqual(createTemplate(id, SKETCH_V1_VERSION), old);
    assert.equal(JSON.stringify(validateSketch(old)), source);
    assert.ok(absoluteSketchBoxes(old).every((box) => Number.isFinite(box.x)));
    const current = createTemplate(id), currentSource = JSON.stringify(current);
    assert.equal(current.schemaVersion, SKETCH_VERSION);
    assert.equal(JSON.stringify(validateSketch(current)), currentSource);
    assert.equal(createHash('sha256').update(currentSource).digest('hex'), v2Baseline[id]);
    assert.notDeepEqual(current, old);
    current.boxes[0].label = 'Changed';
    assert.notEqual(createTemplate(id).boxes[0].label, 'Changed');
    assert.equal(createHash('sha256').update(JSON.stringify(old)).digest('hex'), baseline[id]);
  }
  assert.throws(() => createTemplate('workflow', 'sketch/v3'), RangeError);
});
