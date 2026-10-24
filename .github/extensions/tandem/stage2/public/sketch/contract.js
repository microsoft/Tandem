import { ICON_NAMES } from './icons.js';
import { humanLoopPrompts } from '../prompts/human-loop.js';

/**
 * Versioned JSON-only compositions: nodes, parent links, and connections.
 * Allocation w/h and authored x/y use integer logical-grid units.
 * A unit is 24 CSS pixels. Roots share an origin; the renderer adds an outer gutter.
 * Canonical collections and the standalone debugger share this document contract.
 */
export const SKETCH_VERSION = 'sketch/v2';
export const SKETCH_V1_VERSION = 'sketch/v1';
export const GRID = 24;
export const FONT_SIZE = 14;
export const LINE_HEIGHT = 18;
export const GLYPH_WIDTH = 14;
export const HEADER_HEIGHT = 48;
export const MAX_DEPTH = 4;
export const MAX_EXTENT = 120;

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

const id = { type: 'string', minLength: 1, maxLength: 48, pattern: '^[a-z][a-z0-9-]*$' };
const text = (maximum) => ({
  type: 'string', minLength: 1, maxLength: maximum,
  pattern: '^[^\\u0000-\\u0009\\u000b-\\u001f\\u007f]*$',
});
const integer = (minimum, maximum) => ({ type: 'integer', minimum, maximum });
const object = (properties, required) => ({
  type: 'object', additionalProperties: false, properties, required,
});

export const sketchV1Schema = freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:tandem:sketch:v1',
  title: 'Shared structured sketch',
  description: 'Boxes with optional containment and directed connections. Semantic constraints are in generationContract.',
  ...object({
    schemaVersion: { type: 'string', const: SKETCH_V1_VERSION },
    id,
    title: text(160),
    description: text(8000),
    boxes: {
      type: 'array', minItems: 1, maxItems: 48,
      items: object({
        id, label: text(160), details: text(8000), parent: id,
        x: integer(0, MAX_EXTENT), y: integer(0, MAX_EXTENT),
        w: integer(6, MAX_EXTENT), h: integer(3, MAX_EXTENT),
      }, ['id', 'label', 'x', 'y', 'w', 'h']),
    },
    connections: {
      type: 'array', minItems: 0, maxItems: 32,
      items: object({
        id, from: id, to: id, label: text(48), details: text(8000),
      }, ['id', 'from', 'to']),
    },
  }, ['schemaVersion', 'id', 'title', 'boxes', 'connections']),
});

export const SKETCH_SHAPES = freeze(['rectangle', 'rounded-rectangle', 'circle', 'diamond', 'none']);
export const SKETCH_PROFILES = freeze(['neutral', 'teal', 'blue', 'violet', 'amber', 'red']);
export const SKETCH_TREATMENTS = freeze(['quiet', 'outlined', 'tinted', 'filled']);
export const SKETCH_ICONS = ICON_NAMES;
export const SKETCH_ALIGNMENTS = freeze(['start', 'center', 'end']);
export const SKETCH_EMPHASES = freeze(['normal', 'strong']);
export const SKETCH_DIRECTIONS = freeze(['free', 'horizontal', 'vertical']);
export const SKETCH_SIZING = freeze(['content', 'stretch']);
export const SKETCH_SPACING = freeze([1, 2, 3]);
export const SKETCH_ARROWHEADS = freeze(['none', 'end', 'both']);
export const SKETCH_STROKES = freeze(['solid', 'dashed']);
const choice = (values) => ({ type: typeof values[0] === 'number' ? 'integer' : 'string', enum: values });
const profile = choice(SKETCH_PROFILES);
export const sketchSchema = freeze({
  ...sketchV1Schema,
  $id: 'urn:tandem:sketch:v2',
  description: 'Bounded shape and text compositions with calculated geometry and optional connector presentation.',
  properties: {
    ...sketchV1Schema.properties,
    schemaVersion: { type: 'string', const: SKETCH_VERSION },
    boxes: {
      ...sketchV1Schema.properties.boxes,
      items: object({
        ...sketchV1Schema.properties.boxes.items.properties,
        shape: choice(SKETCH_SHAPES), caption: text(160), body: text(2000),
        text: object({ align: choice(SKETCH_ALIGNMENTS), emphasis: choice(SKETCH_EMPHASES) }, []),
        appearance: object({ profile, treatment: choice(SKETCH_TREATMENTS) }, []),
        layout: object({
          direction: choice(SKETCH_DIRECTIONS),
          order: { type: 'array', minItems: 0, maxItems: 48, items: id },
          align: choice(SKETCH_ALIGNMENTS), gap: choice(SKETCH_SPACING), padding: choice(SKETCH_SPACING),
        }, ['direction']),
        sizing: object({ width: choice(SKETCH_SIZING), height: choice(SKETCH_SIZING) }, []),
        icon: choice(SKETCH_ICONS),
      }, ['id', 'label', 'w', 'h']),
    },
    connections: {
      ...sketchV1Schema.properties.connections,
      items: object({
        ...sketchV1Schema.properties.connections.items.properties,
        arrowheads: choice(SKETCH_ARROWHEADS), stroke: choice(SKETCH_STROKES),
        appearance: object({ profile }, []),
      }, ['id', 'from', 'to']),
    },
  },
});

export const generationContract = freeze({
  schema: sketchSchema,
  rules: humanLoopPrompts.sketchRules,
});

export class SketchValidationError extends Error {
  constructor(code, path, message) {
    super(`${path}: ${message}`);
    this.name = 'SketchValidationError';
    this.code = code;
    this.path = path;
  }
}

export function rejectSketch(code, path, message) {
  throw new SketchValidationError(code, path, message);
}

// The structural validator executes the exported schema, so its bounds cannot drift.
function checkSchema(value, schema, path) {
  if (schema.oneOf) {
    const version = value && typeof value === 'object'
      ? Object.getOwnPropertyDescriptor(value, 'schemaVersion')?.value : undefined;
    const versioned = schema.oneOf.filter((candidate) => candidate.properties?.schemaVersion?.const === version);
    if (version !== undefined && versioned.length === 1) {
      checkSchema(value, versioned[0], path);
      return;
    }
    const matches = schema.oneOf.filter((candidate) => {
      try { checkSchema(value, candidate, path); return true; }
      catch (error) { if (error instanceof SketchValidationError) return false; throw error; }
    });
    if (matches.length !== 1) rejectSketch('format', path, 'Expected exactly one supported, explicitly versioned artifact format.');
    return;
  }
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
      rejectSketch('type', path, 'Expected a plain JSON object.');
    }
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string' || !Object.hasOwn(schema.properties, key)) {
        rejectSketch('unknown-field', path, `Unknown field ${String(key)}.`);
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
        rejectSketch('type', `${path}.${key}`, 'Expected a JSON data property.');
      }
    }
    for (const key of schema.required) {
      if (!Object.hasOwn(value, key)) rejectSketch('required', `${path}.${key}`, 'Required field is missing.');
    }
    for (const key of Object.keys(value)) checkSchema(value[key], schema.properties[key], `${path}.${key}`);
  } else if (schema.type === 'array') {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
      rejectSketch('type', path, 'Expected a plain JSON array.');
    }
    if (value.length < schema.minItems || value.length > schema.maxItems) {
      rejectSketch('bounds', path, `Expected ${schema.minItems}–${schema.maxItems} items.`);
    }
    for (const key of Reflect.ownKeys(value)) {
      if (key === 'length') continue;
      if (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length) {
        rejectSketch('type', path, 'JSON arrays cannot have extra properties.');
      }
    }
    for (let index = 0; index < value.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
        rejectSketch('type', `${path}[${index}]`, 'Expected a JSON array item, not a hole or accessor.');
      }
      checkSchema(descriptor.value, schema.items, `${path}[${index}]`);
    }
  } else if (schema.type === 'string') {
    if (typeof value !== 'string') rejectSketch('type', path, 'Expected a string.');
    const length = Array.from(value).length;
    if (length < (schema.minLength ?? 0) || length > (schema.maxLength ?? Infinity)) {
      rejectSketch('bounds', path, 'Text length is outside the supported bounds.');
    }
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) {
      rejectSketch('text', path, 'Invalid ID or unsupported control character.');
    }
    if (schema.const !== undefined && value !== schema.const) rejectSketch('version', path, 'Unsupported sketch version.');
  } else if (schema.type === 'integer') {
    if (!Number.isSafeInteger(value)) rejectSketch('type', path, 'Expected a finite safe integer.');
    if (value < schema.minimum || value > schema.maximum) rejectSketch('bounds', path, 'Geometry is outside grid bounds.');
  } else rejectSketch('schema', path, 'Unsupported schema type.');
  if (schema.enum && !schema.enum.includes(value)) rejectSketch('enum', path, 'Value is not in the supported vocabulary.');
}

/** Lossless wrapping: joining each paragraph's slices restores the exact input. */
export function wrapSketchText(value, columns) {
  if (!Number.isSafeInteger(columns) || columns < 1) rejectSketch('text-fit', 'label', 'No room for text.');
  return value.split('\n').flatMap((paragraph) => {
    const characters = Array.from(paragraph);
    if (!characters.length) return [''];
    const lines = [];
    for (let start = 0; start < characters.length; start += columns) {
      lines.push(characters.slice(start, start + columns).join(''));
    }
    return lines;
  });
}

export function boxesAreRelated(first, second, byId) {
  const ancestors = (box, other) => {
    for (let parent = box.parent; parent; parent = byId.get(parent).parent) {
      if (parent === other.id) return true;
    }
    return false;
  };
  return ancestors(first, second) || ancestors(second, first);
}

/** The unchanged v1 coordinate resolver. V2 geometry must be resolved by layoutSketch. */
export function absoluteSketchBoxes(sketch) {
  const byId = new Map(sketch.boxes.map((box) => [box.id, box]));
  const cache = new Map();
  function resolve(box) {
    if (cache.has(box.id)) return cache.get(box.id);
    const parent = box.parent ? resolve(byId.get(box.parent)) : null;
    const result = {
      ...box, x: box.x + (parent?.x ?? 0), y: box.y + (parent?.y ?? 0),
      depth: (parent?.depth ?? 0) + 1,
      container: sketch.boxes.some((child) => child.parent === box.id),
    };
    cache.set(box.id, result);
    return result;
  }
  return sketch.boxes.map(resolve);
}

/**
 * Validate structure (and legacy v1 geometry); return a deeply frozen JSON copy.
 * Invalid input throws SketchValidationError; the caller's object is never changed.
 * All authoritative consumers must additionally call layoutSketch for full preflight.
 * V2 measurement, resolved placement, fit, extents and collisions belong there.
 */
export function validateSketch(input) {
  const version = input && Object.getOwnPropertyDescriptor(input, 'schemaVersion')?.value;
  const v2 = version === SKETCH_VERSION;
  checkSchema(input, v2 ? sketchSchema : sketchV1Schema, 'sketch');
  const ids = new Set([input.id]);
  for (const item of [...input.boxes, ...input.connections]) {
    if (ids.has(item.id)) rejectSketch('duplicate-id', item.id, 'IDs must be unique across the document.');
    ids.add(item.id);
  }
  const byId = new Map(input.boxes.map((box) => [box.id, box]));
  for (const box of input.boxes) {
    const visited = new Set([box.id]);
    let cursor = box;
    while (cursor.parent) {
      if (!byId.has(cursor.parent)) rejectSketch('reference', box.id, 'Parent box does not exist.');
      if (visited.has(cursor.parent)) rejectSketch('cycle', box.id, 'Containment cycle.');
      visited.add(cursor.parent);
      cursor = byId.get(cursor.parent);
    }
    if (visited.size > MAX_DEPTH) rejectSketch('depth', box.id, `Maximum containment depth is ${MAX_DEPTH}.`);
    if (box.parent && !v2) {
      const parent = byId.get(box.parent);
      if (box.x < 1 || box.y < 3 || box.x + box.w > parent.w - 1 || box.y + box.h > parent.h - 1) {
        rejectSketch('containment', box.id, 'Child must fit inside its parent with header and padding.');
      }
    }
  }
  if (v2) validateV2Structure(input, byId);
  const boxes = v2 ? [] : absoluteSketchBoxes(input);
  for (const [index, box] of boxes.entries()) {
    if (box.x + box.w > MAX_EXTENT || box.y + box.h > MAX_EXTENT) {
      rejectSketch('bounds', box.id, 'Absolute box extent exceeds the document grid.');
    }
    const columns = Math.floor((box.w * GRID - 24) / GLYPH_WIDTH);
    const lines = wrapSketchText(box.label, columns);
    const available = box.container ? HEADER_HEIGHT - 12 : box.h * GRID - 24;
    if (lines.length * LINE_HEIGHT > available) rejectSketch('text-fit', box.id, 'Label cannot fit without truncation.');
    for (const other of boxes.slice(index + 1)) {
      if (boxesAreRelated(box, other, byId)) continue;
      if (box.x + box.w + 1 <= other.x || other.x + other.w + 1 <= box.x
        || box.y + box.h + 1 <= other.y || other.y + other.h + 1 <= box.y) continue;
      rejectSketch('overlap', box.id, `Box overlaps or lacks a one-unit gap from ${other.id}.`);
    }
  }
  const degree = new Map();
  const pairs = new Set();
  const unorderedPairs = new Map();
  for (const edge of input.connections) {
    const from = byId.get(edge.from), to = byId.get(edge.to);
    if (!from || !to) rejectSketch('reference', edge.id, 'Connection endpoint does not exist.');
    if (from === to || boxesAreRelated(from, to, byId)) {
      rejectSketch('endpoint', edge.id, 'Endpoints must be distinct non-ancestor boxes.');
    }
    const pair = `${from.id}:${to.id}`;
    if (pairs.has(pair)) rejectSketch('endpoint', edge.id, 'Only one connection per directed endpoint pair is supported.');
    pairs.add(pair);
    if (v2) {
      const unorderedPair = [from.id, to.id].sort().join(':');
      const exclusive = (edge.arrowheads ?? 'end') !== 'end';
      if (unorderedPairs.has(unorderedPair) && (exclusive || unorderedPairs.get(unorderedPair))) {
        rejectSketch('endpoint', edge.id, 'An undirected or two-way connection occupies the unordered endpoint pair exclusively.');
      }
      unorderedPairs.set(unorderedPair, exclusive);
    }
    for (const endpoint of [edge.from, edge.to]) {
      degree.set(endpoint, (degree.get(endpoint) ?? 0) + 1);
      if (degree.get(endpoint) > 4) rejectSketch('degree', endpoint, 'At most four incident connections are supported.');
    }
  }
  return freeze(JSON.parse(JSON.stringify(input)));
}

function validateV2Structure(input, byId) {
  for (const box of input.boxes) {
    const parent = byId.get(box.parent);
    const automaticParent = parent && (parent.layout?.direction ?? 'free') !== 'free';
    for (const axis of ['x', 'y']) {
      if (automaticParent && Object.hasOwn(box, axis)) {
        rejectSketch('layout', `${box.id}.${axis}`, 'Automatic-parent children must not declare coordinates.');
      }
      if (!automaticParent && !Object.hasOwn(box, axis)) {
        rejectSketch('required', `${box.id}.${axis}`, 'Roots and free-parent children require coordinates.');
      }
    }
    const children = input.boxes.filter((child) => child.parent === box.id);
    if (children.length && ['circle', 'diamond', 'none'].includes(box.shape)) {
      rejectSketch('shape', box.id, 'Circle, diamond and unframed text nodes must be leaves.');
    }
    if (box.shape === 'none' && box.appearance?.treatment && box.appearance.treatment !== 'quiet') {
      rejectSketch('appearance', box.id, 'Unframed text permits only quiet or absent treatment.');
    }
    if (box.layout) {
      if (!children.length) rejectSketch('layout', box.id, 'Layout may only be declared on a group with children.');
      if (box.layout.direction === 'free') {
        for (const field of ['order', 'align', 'gap']) {
          if (Object.hasOwn(box.layout, field)) rejectSketch('layout', `${box.id}.layout.${field}`, 'This field requires automatic layout.');
        }
      } else {
        if (!Object.hasOwn(box.layout, 'order')) rejectSketch('required', `${box.id}.layout.order`, 'Automatic layout requires explicit child order.');
        const order = box.layout.order;
        const childIds = new Set(children.map((child) => child.id));
        if (order.length !== children.length || new Set(order).size !== order.length || order.some((id) => !childIds.has(id))) {
          rejectSketch('layout', `${box.id}.layout.order`, 'Order must list every direct child exactly once.');
        }
      }
    }
    if (Object.values(box.sizing ?? {}).includes('stretch')) {
      if (box.shape === 'circle') rejectSketch('sizing', box.id, 'Circles support content sizing only.');
      if (!automaticParent) rejectSketch('sizing', box.id, 'Stretch requires an automatic parent allocation.');
    }
  }
}

export { checkSchema as validateSketchSchema, freeze as freezeSketchData };

export function sketchConnectionLabel(edge) {
  if (edge.label !== undefined) return edge.label;
  if (edge.arrowheads === 'none') return `${edge.from} and ${edge.to} (undirected)`;
  if (edge.arrowheads === 'both') return `${edge.from} and ${edge.to} (two-way)`;
  return `${edge.from} to ${edge.to}`;
}
