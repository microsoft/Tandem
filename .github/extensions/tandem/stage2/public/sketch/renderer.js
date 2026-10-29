import {
  GRID, FONT_SIZE, LINE_HEIGHT, GLYPH_WIDTH, HEADER_HEIGHT,
  absoluteSketchBoxes, validateSketch, wrapSketchText, sketchConnectionLabel,
} from './contract.js';
import { resolveV2Boxes } from './geometry-v2.js';
import { ICON_PATHS } from './icons.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const STEP = GRID / 2;
const GUTTER = GRID * 2;
const CLEARANCE = 6;
const directions = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const pointKey = ({ x, y }) => `${x},${y}`;
const inside = (point, rect, padding = 0) => point.x > rect.x - padding
  && point.x < rect.x + rect.w + padding && point.y > rect.y - padding
  && point.y < rect.y + rect.h + padding;
const overlaps = (a, b, padding = 0) => a.x < b.x + b.w + padding
  && a.x + a.w > b.x - padding && a.y < b.y + b.h + padding && a.y + a.h > b.y - padding;

export class SketchLayoutError extends Error {
  constructor(id, message) {
    super(`${id}: ${message}`);
    this.name = 'SketchLayoutError';
    this.code = 'layout';
    this.id = id;
  }
}

function preferredSide(box, peer) {
  const horizontal = Math.max(peer.x - box.x - box.w, box.x - peer.x - peer.w);
  const vertical = Math.max(peer.y - box.y - box.h, box.y - peer.y - peer.h);
  return horizontal >= vertical
    ? peer.x + peer.w / 2 >= box.x + box.w / 2 ? 'right' : 'left'
    : peer.y + peer.h / 2 >= box.y + box.h / 2 ? 'bottom' : 'top';
}

function ports(box, peer, edge, incidents) {
  const preferred = preferredSide(box, peer);
  const offset = (side, axis, length, minimum = STEP) => {
    const ordered = incidents.filter((item) => item.id === edge.id || preferredSide(box, item.peer) === side)
      .sort((a, b) => a.peer[axis] + a.peer[axis === 'x' ? 'w' : 'h'] / 2
      - b.peer[axis] - b.peer[axis === 'x' ? 'w' : 'h'] / 2 || a.id.localeCompare(b.id));
    const slot = ordered.findIndex((item) => item.id === edge.id);
    const first = Math.ceil(minimum / STEP), last = Math.floor((length - STEP) / STEP);
    return Math.round(first + (last - first) * (ordered.length === 1 ? .5 : slot / (ordered.length - 1))) * STEP;
  };
  const px = (side) => offset(side, 'x', box.w);
  const py = (side) => offset(side, 'y', box.h, box.container ? (box.headerHeight ?? HEADER_HEIGHT) + STEP : STEP);
  return [
    { side: 'right', point: { x: box.x + box.w, y: box.y + py('right') }, dir: 0 },
    { side: 'bottom', point: { x: box.x + px('bottom'), y: box.y + box.h }, dir: 1 },
    { side: 'left', point: { x: box.x, y: box.y + py('left') }, dir: 2 },
    { side: 'top', point: { x: box.x + px('top'), y: box.y }, dir: 3 },
  ].map((port) => {
    const outer = { x: port.point.x + directions[port.dir][0] * STEP, y: port.point.y + directions[port.dir][1] * STEP };
    const point = { ...port.point }, cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    if (box.shape === 'circle' || box.shape === 'diamond') {
      const horizontal = port.dir % 2 === 0, fraction = horizontal
        ? Math.abs(point.y - cy) / (box.h / 2) : Math.abs(point.x - cx) / (box.w / 2);
      const reach = box.shape === 'circle' ? Math.sqrt(Math.max(0, 1 - fraction * fraction)) : Math.max(0, 1 - fraction);
      if (horizontal) point.x = cx + directions[port.dir][0] * box.w / 2 * reach;
      else point.y = cy + directions[port.dir][1] * box.h / 2 * reach;
    }
    return { ...port, point, penalty: port.side === preferred ? 0 : 8, outer };
  });
}

function simplify(points) {
  const result = [];
  for (const point of points) {
    if (result.length > 1) {
      const a = result.at(-2), b = result.at(-1);
      if ((a.x === b.x && b.x === point.x) || (a.y === b.y && b.y === point.y)) result.pop();
    }
    result.push(point);
  }
  return result;
}

function segments(points) {
  return points.slice(1).map((to, index) => ({ from: points[index], to }));
}

function segmentHitsRect({ from, to }, rect, padding = 0) {
  if (from.x === to.x) {
    return from.x > rect.x - padding && from.x < rect.x + rect.w + padding
      && Math.max(from.y, to.y) > rect.y - padding && Math.min(from.y, to.y) < rect.y + rect.h + padding;
  }
  return from.y > rect.y - padding && from.y < rect.y + rect.h + padding
    && Math.max(from.x, to.x) > rect.x - padding && Math.min(from.x, to.x) < rect.x + rect.w + padding;
}

function boxOutline(box) {
  return segments([
    { x: box.x, y: box.y }, { x: box.x + box.w, y: box.y },
    { x: box.x + box.w, y: box.y + box.h }, { x: box.x, y: box.y + box.h },
    { x: box.x, y: box.y },
  ]);
}

class RouteQueue {
  items = [];
  push(value) {
    const items = this.items;
    let index = items.length;
    items.push(value);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (items[parent].priority <= value.priority) break;
      items[index] = items[parent]; index = parent;
    }
    items[index] = value;
  }
  pop() {
    const items = this.items, first = items[0], last = items.pop();
    if (items.length) {
      let index = 0;
      while (index * 2 + 1 < items.length) {
        let child = index * 2 + 1;
        if (child + 1 < items.length && items[child + 1].priority < items[child].priority) child++;
        if (items[child].priority >= last.priority) break;
        items[index] = items[child]; index = child;
      }
      items[index] = last;
    }
    return first;
  }
}

function routeConnection(edge, from, to, context) {
  const { width, height, obstacles, usedPorts, incidents } = context;
  const columns = Math.round(width / STEP) + 1, rows = Math.round(height / STEP) + 1;
  const blocked = new Uint8Array(columns * rows);
  const edgeObstacles = [...obstacles, ...[from, to].filter((box) => box.container)];
  const outlines = context.boxes.flatMap(boxOutline);
  const indexOf = (point) => Math.round(point.y / STEP) * columns + Math.round(point.x / STEP);
  const pointAt = (index) => ({ x: (index % columns) * STEP, y: Math.floor(index / columns) * STEP });
  const occupied = new Uint8Array(blocked.length);
  const mark = (point, array, value) => {
    if (point.x < 0 || point.x > width || point.y < 0 || point.y > height) return;
    const index = indexOf(point);
    if (index >= 0 && index < array.length) array[index] |= value;
  };
  for (const segment of context.routeSegments) {
    const horizontal = segment.from.y === segment.to.y, axis = horizontal ? 'x' : 'y';
    const first = Math.ceil(Math.min(segment.from[axis], segment.to[axis]) / STEP) * STEP;
    const last = Math.floor(Math.max(segment.from[axis], segment.to[axis]) / STEP) * STEP;
    for (let value = first; value <= last; value += STEP) {
      mark(horizontal ? { x: value, y: segment.from.y } : { x: segment.from.x, y: value }, occupied, horizontal ? 1 : 2);
    }
    for (const point of [segment.from, segment.to]) {
      mark(point, occupied, 4);
      for (const distance of [STEP, STEP * 2]) for (const [dx, dy] of directions) {
        mark({ x: point.x + dx * distance, y: point.y + dy * distance }, occupied, 4);
      }
    }
  }
  for (let index = 0; index < blocked.length; index++) {
    const point = pointAt(index);
    blocked[index] = Number(point.x < STEP || point.y < STEP || point.x > width - STEP || point.y > height - STEP
      || edgeObstacles.some((rect) => inside(point, rect, CLEARANCE)));
  }
  const available = (box, peer) => ports(box, peer, edge, incidents.get(box.id)).filter((port) =>
    !usedPorts.has(`${box.id}:${pointKey(port.point)}`)
    && !(occupied[indexOf(port.point)] & 3) && !(occupied[indexOf(port.outer)] & 3)
    && !blocked[indexOf(port.outer)]
    && !edgeObstacles.some((rect) => rect.id !== box.id
      && segmentHitsRect({ from: port.point, to: port.outer }, rect, CLEARANCE)));
  const starts = available(from, to), targets = available(to, from);
  const targetStates = new Map(targets.map((port) => [indexOf(port.outer) * 4 + (port.dir + 2) % 4, port]));
  const previous = new Int32Array(blocked.length * 4).fill(-2);
  const costs = new Float64Array(previous.length).fill(Infinity), queue = new RouteQueue();
  const heuristic = (point) => Math.min(...targets.map((port) =>
    (Math.abs(port.outer.x - point.x) + Math.abs(port.outer.y - point.y)) / STEP + port.penalty));
  const sourcePorts = new Map();
  let goal = -1;
  for (const port of starts) {
    const index = indexOf(port.outer) * 4 + port.dir;
    previous[index] = -1;
    costs[index] = port.penalty;
    sourcePorts.set(index, port);
    queue.push({ index, cost: port.penalty, priority: port.penalty + heuristic(port.outer) });
  }
  while (queue.items.length && targets.length) {
    const entry = queue.pop(), current = entry.index;
    if (entry.cost !== costs[current]) continue;
    if (targetStates.has(current)) { goal = current; break; }
    const cell = Math.floor(current / 4), heading = current % 4;
    const x = cell % columns, y = Math.floor(cell / columns);
    for (let dir = 0; dir < directions.length; dir++) {
      if (dir === (heading + 2) % 4) continue;
      const [dx, dy] = directions[dir];
      if (dir !== heading && ((occupied[cell] & 3) || [1, 2].some((distance) =>
        (occupied[cell - (directions[heading][1] * columns + directions[heading][0]) * distance] & 3)
        || (occupied[cell + (dy * columns + dx) * distance] & 3)))) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= columns || ny < 0 || ny >= rows) continue;
      const nextCell = ny * columns + nx, flags = occupied[nextCell], crossing = flags & 3, orientation = dx ? 1 : 2;
      if (blocked[nextCell] || (crossing && (flags & (orientation | 4)))) continue;
      // A crossing stays straight, separated from nearby crossings, tips and bends.
      if (crossing && (dir !== heading || (occupied[cell] & 3) || (occupied[nextCell + dy * columns + dx] & 3))) continue;
      if (crossing && outlines.some((segment) => segmentHitsRect(segment,
        { x: nx * STEP - STEP, y: ny * STEP - STEP, w: STEP * 2, h: STEP * 2 }, 2))) continue;
      const next = nextCell * 4 + dir, cost = costs[current] + 1 + (dir === heading ? 0 : 4);
      if (cost >= costs[next]) continue;
      costs[next] = cost;
      previous[next] = current;
      queue.push({ index: next, cost, priority: cost + heuristic(pointAt(nextCell)) });
    }
  }
  if (goal === -1) throw new SketchLayoutError(edge.id, 'No clear orthogonal route. Separate boxes or connections.');
  const indices = [];
  for (let index = goal; index !== -1; index = previous[index]) indices.push(index);
  indices.reverse();
  const start = sourcePorts.get(indices[0]), end = targetStates.get(goal);
  const raw = [start.point, ...indices.map((index) => pointAt(Math.floor(index / 4))), end.point];
  usedPorts.add(`${from.id}:${pointKey(start.point)}`);
  usedPorts.add(`${to.id}:${pointKey(end.point)}`);
  return { points: simplify(raw), fromPort: start.side, toPort: end.side };
}

function placeLabel(edge, points, context) {
  if (edge.label === undefined) return null;
  const lines = wrapSketchText(edge.label, 12);
  const w = Math.max(...lines.map((line) => Array.from(line).length)) * GLYPH_WIDTH + 12;
  const h = lines.length * LINE_HEIGHT + 8;
  const candidates = segments(points).sort((a, b) => (
    Math.abs(b.to.x - b.from.x) + Math.abs(b.to.y - b.from.y)
    - Math.abs(a.to.x - a.from.x) - Math.abs(a.to.y - a.from.y)
  ));
  const allSegments = [...context.routeSegments, ...segments(points)];
  const outlines = context.boxes.flatMap(boxOutline);
  for (const { from, to } of candidates) {
    const length = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
    const fractions = [0.5, 0.25, 0.75, ...Array.from({ length: Math.floor(length / STEP) + 1 }, (_, i) => i * STEP / length)];
    for (const fraction of fractions) {
      const center = { x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction };
      const positions = [8, 20, 32].flatMap((offset) => from.y === to.y
        ? [{ x: center.x - w / 2, y: center.y - h - offset }, { x: center.x - w / 2, y: center.y + offset }]
        : [{ x: center.x + offset, y: center.y - h / 2 }, { x: center.x - w - offset, y: center.y - h / 2 }]);
      for (const position of positions) {
        const rect = { ...position, w, h };
        if (rect.x < 4 || rect.y < 4 || rect.x + w > context.width - 4 || rect.y + h > context.height - 4) continue;
        if (context.obstacles.some((obstacle) => overlaps(rect, obstacle, 4))) continue;
        if (allSegments.some((segment) => segmentHitsRect(segment, rect, 4))) continue;
        if (outlines.some((segment) => segmentHitsRect(segment, rect, 2))) continue;
        return { ...rect, lines };
      }
    }
  }
  throw new SketchLayoutError(edge.id, 'Connection label has no clear space. Shorten it or enlarge the corridor.');
}

function drawableBoxes(sketch) {
  const boxes = absoluteSketchBoxes(sketch).map((box) => ({
    ...box, x: box.x * GRID + GUTTER, y: box.y * GRID + GUTTER,
    w: box.w * GRID, h: box.h * GRID,
    lines: wrapSketchText(box.label, Math.floor((box.w * GRID - 24) / GLYPH_WIDTH)),
  })).sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id));
  const rounded = (size) => Math.ceil(size / GRID) * GRID;
  for (const box of [...boxes].reverse()) {
    const titleWidth = rounded(Math.max(...box.lines.map((line) => Array.from(line).length)) * GLYPH_WIDTH + 32);
    if (box.container) {
      const children = boxes.filter((child) => child.parent === box.id);
      box.w = Math.min(box.w, Math.max(titleWidth, ...children.map((child) => child.x + child.w - box.x + GRID)));
      box.h = Math.min(box.h, Math.max(...children.map((child) => child.y + child.h - box.y + GRID)));
    } else {
      const w = Math.min(box.w, Math.max(GRID * 4, titleWidth));
      const h = Math.min(box.h, Math.max(GRID * 3, rounded(box.lines.length * LINE_HEIGHT + 24)));
      box.x += Math.floor((box.w - w) / (2 * STEP)) * STEP;
      box.y += Math.floor((box.h - h) / (2 * STEP)) * STEP;
      box.w = w; box.h = h;
    }
  }
  return boxes;
}

function crossingPoints(connections) {
  const crossings = [];
  for (let i = 0; i < connections.length; i++) {
    for (const first of segments(connections[i].points)) {
      for (const other of connections.slice(i + 1)) for (const second of segments(other.points)) {
        if ((first.from.x === first.to.x) === (second.from.x === second.to.x)) continue;
        const horizontal = first.from.y === first.to.y ? first : second;
        const vertical = horizontal === first ? second : first;
        const x = vertical.from.x, y = horizontal.from.y;
        if (x <= Math.min(horizontal.from.x, horizontal.to.x) || x >= Math.max(horizontal.from.x, horizontal.to.x)
          || y <= Math.min(vertical.from.y, vertical.to.y) || y >= Math.max(vertical.from.y, vertical.to.y)) continue;
        crossings.push({ x, y, over: vertical === first ? connections[i].id : other.id,
          under: horizontal === first ? connections[i].id : other.id });
      }
    }
  }
  return crossings;
}

function crossingBridges(connections, crossings, context) {
  const bridges = [], outlines = context.boxes.flatMap(boxOutline);
  const routes = connections.flatMap((edge) => segments(edge.points).map((segment) => ({ ...segment, id: edge.id })));
  const build = (edge, group) => {
    const first = group[0], last = group.at(-1), top = first.y - STEP, bottom = last.y + STEP;
    for (const offset of [-STEP * 2, STEP * 2, -STEP, STEP]) {
      const rect = { x: first.x + Math.min(0, offset), y: top, w: Math.abs(offset), h: bottom - top };
      if (rect.x < STEP || rect.y < STEP || rect.x + rect.w > context.width - STEP || rect.y + rect.h > context.height - STEP) continue;
      if (group.some((crossing) => !routes.some((segment) => segment.id === crossing.under
        && segment.from.y === crossing.y && segment.to.y === crossing.y
        && first.x + offset >= Math.min(segment.from.x, segment.to.x) + STEP * 2
        && first.x + offset <= Math.max(segment.from.x, segment.to.x) - STEP * 2))) continue;
      if (context.obstacles.some((box) => overlaps(rect, box, CLEARANCE))) continue;
      if (outlines.some((segment) => segmentHitsRect(segment, rect, 2))) continue;
      if (bridges.some((bridge) => overlaps(rect, bridge.bounds, bridge.edgeId === edge.id ? 0 : CLEARANCE))) continue;
      if (routes.some((segment) => segment.id !== edge.id
        && !group.some((crossing) => crossing.under === segment.id && segment.from.y === crossing.y
          && crossing.x > Math.min(segment.from.x, segment.to.x) && crossing.x < Math.max(segment.from.x, segment.to.x))
        && segmentHitsRect(segment, rect, CLEARANCE))) continue;
      bridges.push({ edgeId: edge.id, x: first.x, firstY: first.y, lastY: last.y, top, bottom, offset,
        crossings: group, bounds: rect });
      return;
    }
    if (group.length > 1) {
      for (const crossing of group) build(edge, [crossing]);
      return;
    }
    throw new SketchLayoutError(edge.id, 'A crossing bridge has no clear space. Separate the nearby routes or boxes.');
  };
  for (const edge of connections) for (const segment of segments(edge.points)) {
    if (segment.from.x !== segment.to.x) continue;
    const selected = crossings.filter((point) => point.over === edge.id && point.x === segment.from.x
      && point.y > Math.min(segment.from.y, segment.to.y) && point.y < Math.max(segment.from.y, segment.to.y))
      .sort((a, b) => a.y - b.y);
    let group = [];
    for (const crossing of selected) {
      if (group.length && crossing.y - group.at(-1).y > GRID * 2) { build(edge, group); group = []; }
      group.push(crossing);
    }
    if (group.length) build(edge, group);
  }
  return bridges;
}

/**
 * Pure deterministic geometry, also useful for tests and future Designer previews.
 * Throws on invalid data or unsupported crowded routing; never hides a box or edge.
 */
export function layoutSketch(input) {
  const sketch = validateSketch(input);
  const boxes = sketch.schemaVersion === 'sketch/v2' ? resolveV2Boxes(sketch, GUTTER) : drawableBoxes(sketch);
  const width = Math.max(...boxes.map((box) => box.x + box.w)) + GUTTER;
  const height = Math.max(...boxes.map((box) => box.y + box.h)) + GUTTER;
  const byId = new Map(boxes.map((box) => [box.id, box]));
  const context = {
    boxes, width, height, usedPorts: new Set(), routeSegments: [],
    incidents: new Map(boxes.map((box) => [box.id, sketch.connections
      .filter((edge) => edge.from === box.id || edge.to === box.id)
      .map((edge) => ({ id: edge.id, peer: byId.get(edge.from === box.id ? edge.to : edge.from) }))])),
    obstacles: boxes.map((box) => box.container ? { ...box, h: box.headerHeight ?? HEADER_HEIGHT } : box),
  };
  const connections = [...sketch.connections].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map((edge) => {
    const route = routeConnection(edge, byId.get(edge.from), byId.get(edge.to), context);
    context.routeSegments.push(...segments(route.points));
    return { ...edge, ...route, labelRect: null };
  });
  const crossings = crossingPoints(connections);
  const bridges = crossingBridges(connections, crossings, context);
  context.obstacles.push(...crossings.map((point) => ({ x: point.x - STEP, y: point.y - STEP, w: STEP * 2, h: STEP * 2 })));
  context.obstacles.push(...bridges.map((bridge) => bridge.bounds));
  for (const edge of connections) {
    edge.labelRect = placeLabel(edge, edge.points, context);
    if (edge.labelRect) context.obstacles.push(edge.labelRect);
  }
  return { sketch, width, height, boxes, connections, crossings, bridges };
}

function svgElement(document, name, attributes = {}, text) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  if (text !== undefined) element.textContent = text;
  return element;
}

const SYSTEM_FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const COMPACT_X = .64;
const COMPACT_Y = .75;
const DISPLAY_PADDING = 16;
const EDGE_LINE_HEIGHT = 14;

function appendText(document, parent, lines, x, firstBaseline, attributes = {}, lineHeight = LINE_HEIGHT) {
  const text = svgElement(document, 'text', {
    x, y: firstBaseline, 'font-size': FONT_SIZE, 'font-family': SYSTEM_FONT,
    'text-anchor': 'middle', 'xml:space': 'preserve', style: 'white-space:pre', ...attributes,
  });
  lines.forEach((line, index) => text.append(svgElement(document, 'tspan', {
    x, y: firstBaseline + index * lineHeight,
  }, line)));
  parent.append(text);
}

const styles = `
.shared-sketch { color-scheme: light dark; margin: 0; min-width: 0; max-width: 100%; width: 100%;
  overflow: auto; overscroll-behavior: contain;
  --sketch-surface: var(--surface, var(--background-color-default, light-dark(#ffffff, #1e2228)));
  --sketch-text: var(--text, var(--text-color-default, light-dark(#17241f, #e6edf3)));
  --sketch-line: var(--border, var(--border-color-default, light-dark(#59655f, #a6b0bc)));
  --sketch-grid: color-mix(in srgb, var(--sketch-line) 18%, transparent);
  --sketch-accent-1: color-mix(in srgb, #1f9d8f 58%, var(--sketch-text));
  --sketch-accent-2: color-mix(in srgb, #4f8acb 58%, var(--sketch-text));
  --sketch-accent-3: color-mix(in srgb, #946dbe 58%, var(--sketch-text));
  --sketch-accent-4: color-mix(in srgb, #cf8134 58%, var(--sketch-text));
  --sketch-accent-neutral: color-mix(in srgb, var(--sketch-text) 85%, var(--sketch-surface));
  --sketch-accent-red: color-mix(in srgb, #d64545 58%, var(--sketch-text));
  color: var(--sketch-text); background: var(--sketch-surface); }
.shared-sketch svg { display: block; max-width: none; overflow: visible; background: var(--sketch-surface); }
.shared-sketch .sketch-grid-surface { fill: var(--sketch-surface); }
.shared-sketch .sketch-grid-dot { fill: var(--sketch-grid); }
.shared-sketch .sketch-box { fill: var(--sketch-surface);
  stroke: var(--sketch-accent); stroke-width: 1.5; }
.shared-sketch .sketch-container { fill: color-mix(in srgb, var(--sketch-surface) 86%, var(--sketch-accent));
  stroke: color-mix(in srgb, var(--sketch-surface) 75%, var(--sketch-accent)); stroke-width: .8; }
.shared-sketch .sketch-nested-container { fill: color-mix(in srgb, var(--sketch-surface) 92%, var(--sketch-accent));
  stroke: color-mix(in srgb, var(--sketch-surface) 84%, var(--sketch-accent)); }
.shared-sketch .sketch-container-rule { stroke: color-mix(in srgb, var(--sketch-accent) 28%, transparent);
  stroke-width: 1; }
.shared-sketch text { fill: var(--sketch-text); font-family: ${SYSTEM_FONT};
  pointer-events: none; }
.shared-sketch .sketch-node-title { font-size: var(--sketch-title-size, 14px); font-weight: 650; letter-spacing: 0; }
.shared-sketch .sketch-container-title { fill: color-mix(in srgb, var(--sketch-text) 88%, var(--sketch-accent));
  font-size: var(--sketch-title-size, 14px); font-weight: 650; letter-spacing: 0; }
.shared-sketch .sketch-root-title { fill: var(--sketch-accent); font-weight: 750; }
.shared-sketch .sketch-connection { fill: none; stroke: color-mix(in srgb, var(--sketch-accent) 76%, var(--sketch-text));
  stroke-width: 1.5; stroke-linejoin: round; stroke-linecap: round; }
.shared-sketch .sketch-arrow { fill: color-mix(in srgb, var(--sketch-accent) 76%, var(--sketch-text)); }
.shared-sketch .sketch-label-surface { fill: color-mix(in srgb, var(--sketch-surface) 94%, var(--sketch-accent));
  stroke: color-mix(in srgb, var(--sketch-accent) 38%, transparent); stroke-width: 1; }
.shared-sketch .sketch-edge-label { font-size: var(--sketch-edge-size, 12px); font-weight: 500; }
.shared-sketch .sketch-treatment-quiet { fill: none; stroke: none; }
.shared-sketch .sketch-treatment-outlined { fill: var(--sketch-surface); stroke: var(--sketch-accent); stroke-width: 1.5; }
.shared-sketch .sketch-treatment-tinted { fill: color-mix(in srgb, var(--sketch-surface) 86%, var(--sketch-accent)); stroke: none; }
.shared-sketch .sketch-treatment-filled { fill: var(--sketch-accent); stroke: var(--sketch-accent); }
.shared-sketch .sketch-filled text, .shared-sketch .sketch-on-filled text { fill: var(--sketch-surface); }
.shared-sketch .sketch-v2-title { font-size: var(--sketch-title-size, 14px); }
.shared-sketch .sketch-v2-caption { font-size: var(--sketch-edge-size, 12px); }
.shared-sketch .sketch-v2-body { font-size: var(--sketch-title-size, 14px); }
.shared-sketch .sketch-icon { fill: none; stroke: var(--sketch-text); stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.shared-sketch .sketch-filled .sketch-icon, .shared-sketch .sketch-on-filled .sketch-icon { stroke: var(--sketch-surface); }
.shared-sketch .sketch-contrast-line { stroke: var(--sketch-surface); }
.shared-sketch .sketch-contrast-arrow { fill: var(--sketch-surface); }
.shared-sketch [role="button"] { cursor: pointer; }
.shared-sketch [role="button"]:focus { outline: none; }
.shared-sketch [role="button"]:focus .sketch-box,
.shared-sketch [role="button"]:focus .sketch-connection { stroke: var(--sketch-text); stroke-width: 3; }
.shared-sketch [role="button"]:hover .sketch-box { filter: brightness(1.035); }
.shared-sketch .sketch-view-controls { position: sticky; left: 0; display: flex; flex-wrap: wrap; align-items: center;
  gap: 4px; box-sizing: border-box; width: 100%; min-width: 0; padding: 6px 8px;
  color: var(--sketch-text); background: var(--sketch-surface); border-bottom: 1px solid color-mix(in srgb, var(--sketch-line) 25%, transparent);
  font: 12px ${SYSTEM_FONT}; }
.shared-sketch .sketch-view-controls button { font: inherit; line-height: 1.4; min-height: 26px; padding: 3px 8px;
  border: 1px solid color-mix(in srgb, var(--sketch-line) 45%, transparent); border-radius: 5px;
  color: var(--sketch-text); background: var(--sketch-surface); cursor: pointer; }
.shared-sketch .sketch-view-controls button:hover:not(:disabled) { background: color-mix(in srgb, var(--sketch-surface) 92%, var(--sketch-text)); }
.shared-sketch .sketch-view-controls button:focus-visible { outline: 2px solid var(--sketch-text); outline-offset: 2px; }
.shared-sketch .sketch-view-controls button:disabled { opacity: .48; cursor: default; }
.shared-sketch .sketch-view-status { flex: 0 0 86px; font-size: 11px; white-space: nowrap;
  color: color-mix(in srgb, var(--sketch-text) 78%, var(--sketch-surface)); }
`;

function presentationBounds(layout) {
  const rectangles = [...layout.boxes, ...layout.bridges.map((bridge) => bridge.bounds),
    ...layout.connections.flatMap((edge) => edge.labelRect ? [edge.labelRect] : [])];
  const points = layout.connections.flatMap((edge) => edge.points);
  const x = Math.min(...rectangles.map((box) => box.x), ...points.map((point) => point.x));
  const y = Math.min(...rectangles.map((box) => box.y), ...points.map((point) => point.y));
  const right = Math.max(...rectangles.map((box) => box.x + box.w), ...points.map((point) => point.x));
  const bottom = Math.max(...rectangles.map((box) => box.y + box.h), ...points.map((point) => point.y));
  return { x, y, w: right - x, h: bottom - y };
}

function presentationCoordinates(layout, bounds, axis) {
  // Compress only empty strips. Protect cards, labels, outlines and route
  // turns so the same monotone mapping keeps every connector and boundary aligned.
  const size = axis === 'x' ? 'w' : 'h', start = bounds[axis], extent = bounds[size];
  const intervals = [
    ...layout.boxes.filter((box) => !box.container).map((box) => [box[axis] - STEP, box[axis] + box[size] + STEP]),
    ...layout.boxes.flatMap((box) => [
      [box[axis] - 4, box[axis] + 4], [box[axis] + box[size] - 4, box[axis] + box[size] + 4],
      ...(axis === 'y' && box.container ? [[box.y, box.y + (box.headerHeight ?? HEADER_HEIGHT)]] : []),
      ...(box.blocks && box.container ? [[box[axis], box[axis] + box[size]]] : []),
    ]),
    ...layout.connections.flatMap((edge) => [
      ...edge.points.map((point) => [point[axis] - CLEARANCE, point[axis] + CLEARANCE]),
      ...(edge.labelRect ? [[edge.labelRect[axis] - 4, edge.labelRect[axis] + edge.labelRect[size] + 4]] : []),
    ]),
    ...layout.crossings.map((point) => [point[axis] - STEP, point[axis] + STEP]),
    ...layout.bridges.map((bridge) => [bridge.bounds[axis] - CLEARANCE, bridge.bounds[axis] + bridge.bounds[size] + CLEARANCE]),
  ].map(([left, right]) => [Math.max(start, left), Math.min(start + extent, right)])
    .filter(([left, right]) => right > left).sort((a, b) => a[0] - b[0]);
  const occupied = [];
  for (const interval of intervals) {
    const last = occupied.at(-1);
    if (last && interval[0] <= last[1]) last[1] = Math.max(last[1], interval[1]);
    else occupied.push([...interval]);
  }
  const spans = [];
  let previous = start;
  for (const [left, right] of occupied) {
    if (left > previous) spans.push({ left: previous, right: left, weight: .28 });
    spans.push({ left, right, weight: 1 }); previous = right;
  }
  if (previous < start + extent) spans.push({ left: previous, right: start + extent, weight: .28 });
  const at = (value) => spans.reduce((sum, span) =>
    sum + Math.max(0, Math.min(value, span.right) - span.left) * span.weight, 0);
  return { at, extent: at(start + extent) };
}

function containmentStyle(box) {
  if (!box.container) return { role: 'leaf', inset: 12, weight: 650, rectangle: 'sketch-box', title: 'sketch-node-title' };
  if (box.parent) return { role: 'nested-container', inset: 12, weight: 650,
    rectangle: 'sketch-box sketch-container sketch-nested-container', title: 'sketch-container-title' };
  return { role: 'root-container', inset: 16, weight: 750,
    rectangle: 'sketch-box sketch-container sketch-root-container', title: 'sketch-container-title sketch-root-title' };
}

function readableScales(document, layout, horizontal, vertical) {
  const context = document.createElement('canvas').getContext?.('2d');
  const width = (lines, size, weight) => {
    if (context) context.font = `${weight} ${size}px ${SYSTEM_FONT}`;
    return Math.max(...lines.map((line) => context?.measureText(line).width ?? Array.from(line).length * size));
  };
  let x = .3, y = .4;
  for (const box of layout.boxes) {
    if (box.blocks) {
      const area = box.textArea;
      const projectedWidth = horizontal.at(box.x + area.x + area.w) - horizontal.at(box.x + area.x);
      for (const block of box.blocks) x = Math.max(x, (width(block.lines, block.fontSize, block.weight) + 2) / projectedWidth);
      if (box.icon) x = Math.max(x, 30 / (horizontal.at(box.x + area.x) - horizontal.at(box.x)));
      const bodyHeight = box.container ? box.headerHeight
        : box.h * (box.shape === 'circle' ? Math.SQRT1_2 : box.shape === 'diamond' ? .5 : 1);
      y = Math.max(y, (area.h + (box.container ? 12 : box.topAligned ? 24 : 20)) / bodyHeight);
      continue;
    }
    x = Math.max(x, (width(box.lines, FONT_SIZE, containmentStyle(box).weight) + 28)
      / (horizontal.at(box.x + box.w) - horizontal.at(box.x)));
    y = Math.max(y, box.container
      ? (box.lines.length * LINE_HEIGHT + 12) / (vertical.at(box.y + HEADER_HEIGHT) - vertical.at(box.y))
      : (box.lines.length * LINE_HEIGHT + 20) / (vertical.at(box.y + box.h) - vertical.at(box.y)));
  }
  for (const edge of layout.connections) if (edge.labelRect) {
    const label = edge.labelRect;
    x = Math.max(x, (width(label.lines, 12, 500) + 4) / label.w);
    y = Math.max(y, (label.lines.length * EDGE_LINE_HEIGHT + 4) / label.h);
  }
  return { x, y };
}

const PROFILE_ACCENTS = Object.freeze({ neutral: 'neutral', teal: 1, blue: 2, violet: 3, amber: 4, red: 'red' });

function accentAssignments(boxes) {
  const byId = new Map(boxes.map((box) => [box.id, box]));
  const rootId = (box) => {
    let current = box;
    while (current.parent) current = byId.get(current.parent);
    return current.id;
  };
  const roots = boxes.filter((box) => !box.parent)
    .sort((a, b) => a.x - b.x || a.y - b.y || a.id.localeCompare(b.id));
  const byRoot = new Map(roots.map((box, index) => [box.id, index % 4 + 1]));
  const profile = (box) => box.appearance?.profile ? PROFILE_ACCENTS[box.appearance.profile]
    : box.parent ? profile(byId.get(box.parent)) : byRoot.get(box.id);
  return new Map(boxes.map((box) => [box.id, profile(box)]));
}

function accentStyle(index) {
  return `--sketch-accent:var(--sketch-accent-${index})`;
}

function accessibleGroup(document, item, kind, onSelect) {
  const relationshipLabel = kind === 'connection' ? sketchConnectionLabel(item) : item.label;
  const group = svgElement(document, 'g', {
    [`data-sketch-${kind}`]: item.id,
    'aria-label': relationshipLabel,
    ...(onSelect ? { tabindex: 0, role: 'button' } : { role: 'group' }),
  });
  group.append(svgElement(document, 'title', {}, item.label ?? (item.arrowheads === 'none' || item.arrowheads === 'both'
    ? relationshipLabel : `${item.from} → ${item.to}`)));
  if (item.details !== undefined) group.append(svgElement(document, 'desc', {}, item.details));
  for (const key of ['caption', 'body']) if (item[key] !== undefined) {
    group.append(svgElement(document, 'desc', { 'data-text-role': key }, item[key]));
  }
  if (onSelect) {
    const select = () => onSelect(Object.freeze({
      kind, id: item.id, label: item.label ?? (item.arrowheads === 'none' || item.arrowheads === 'both' ? relationshipLabel : ''), details: item.details ?? '',
      ...(item.caption === undefined ? {} : { caption: item.caption }),
      ...(item.body === undefined ? {} : { body: item.body }),
      ...(kind === 'connection' ? { from: item.from, to: item.to } : {}),
    }));
    group.addEventListener('click', select);
    group.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); }
    });
  }
  return group;
}

const presentationMemory = new WeakMap();

function paintSketch(document, svg, layout, horizontal, vertical, scales, onSelect) {
  const { x: sx, y: sy, font } = scales;
  const x = (value) => horizontal.at(value) * sx + DISPLAY_PADDING;
  const y = (value) => vertical.at(value) * sy + DISPLAY_PADDING;
  const width = Math.ceil(horizontal.extent * sx + DISPLAY_PADDING * 2 - 1e-7);
  const height = Math.ceil(vertical.extent * sy + DISPLAY_PADDING * 2 - 1e-7);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', String(width)); svg.setAttribute('height', String(height));
  svg.dataset.displayScaleX = String(sx); svg.dataset.displayScaleY = String(sy);
  svg.style.setProperty('--sketch-title-size', `${FONT_SIZE * font}px`);
  svg.style.setProperty('--sketch-edge-size', `${12 * font}px`);
  svg.replaceChildren();
  // aria-label names the document without a native tooltip covering the drawing.
  if (layout.sketch.description !== undefined) svg.append(svgElement(document, 'desc', {}, layout.sketch.description));
  const gridId = `sketch-grid-${layout.sketch.id}`;
  const pattern = svgElement(document, 'pattern', { id: gridId, width: GRID, height: GRID, patternUnits: 'userSpaceOnUse' });
  pattern.append(svgElement(document, 'circle', { class: 'sketch-grid-dot', cx: 1.5, cy: 1.5, r: .85 }));
  const definitions = svgElement(document, 'defs'); definitions.append(pattern);
  svg.append(definitions, svgElement(document, 'rect', { class: 'sketch-grid-surface', x: 0, y: 0, width, height }),
    svgElement(document, 'rect', { 'data-sketch-grid': '', x: 0, y: 0, width, height, fill: `url(#${gridId})` }));
  const accents = accentAssignments(layout.boxes);
  const boxesById = new Map(layout.boxes.map((box) => [box.id, box]));
  const filledBackground = (box) => {
    if (box.appearance?.treatment === 'filled') return true;
    if (box.shape === 'none' || box.appearance?.treatment === 'quiet') return box.parent ? filledBackground(boxesById.get(box.parent)) : false;
    return false;
  };
  const fillBoundaries = layout.boxes.filter((box) => box.container
    && filledBackground(box) !== (box.parent ? filledBackground(boxesById.get(box.parent)) : false));
  const contrastClip = `sketch-contrast-${layout.sketch.id}`;
  if (fillBoundaries.length) {
    const d = fillBoundaries.map((box) => {
      const left = x(box.x), top = y(box.y), right = x(box.x + box.w), bottom = y(box.y + box.h);
      const r = box.shape === 'rectangle' ? 0 : 5;
      return `M${left+r},${top} H${right-r} Q${right},${top} ${right},${top+r} V${bottom-r}`
        + ` Q${right},${bottom} ${right-r},${bottom} H${left+r} Q${left},${bottom} ${left},${bottom-r}`
        + ` V${top+r} Q${left},${top} ${left+r},${top} Z`;
    }).join(' ');
    const clip = svgElement(document, 'clipPath', { id: contrastClip, clipPathUnits: 'userSpaceOnUse' });
    clip.append(svgElement(document, 'path', { d, 'clip-rule': 'evenodd' })); definitions.append(clip);
  }
  for (const box of layout.boxes) {
    const presentation = containmentStyle(box);
    const group = accessibleGroup(document, box, 'box', onSelect);
    group.setAttribute('data-sketch-presentation', presentation.role);
    group.setAttribute('data-sketch-accent', String(accents.get(box.id)));
    group.setAttribute('style', accentStyle(accents.get(box.id)));
    const bx = x(box.x), by = y(box.y), w = x(box.x + box.w) - bx, h = y(box.y + box.h) - by,
      header = y(box.y + (box.headerHeight ?? HEADER_HEIGHT)) - by;
    const treatment = box.shape === 'none' ? 'quiet' : box.appearance?.treatment;
    const rectangleClass = `${presentation.rectangle}${treatment ? ` sketch-treatment-${treatment}` : ''}`;
    group.dataset.sketchShape = box.shape ?? 'rounded-rectangle';
    if (treatment === 'filled') group.classList.add('sketch-filled');
    else if (filledBackground(box)) group.classList.add('sketch-on-filled');
    if (treatment === 'quiet') group.setAttribute('pointer-events', 'all');
    if (box.shape === 'circle') group.append(svgElement(document, 'circle', {
      cx: bx + w / 2, cy: by + h / 2, r: w / 2, class: rectangleClass,
    }));
    else if (box.shape === 'diamond') group.append(svgElement(document, 'polygon', {
      points: `${bx + w / 2},${by} ${bx + w},${by + h / 2} ${bx + w / 2},${by + h} ${bx},${by + h / 2}`,
      class: rectangleClass,
    }));
    else group.append(svgElement(document, 'rect', {
      x: bx, y: by, width: w, height: h, rx: box.shape === 'rectangle' || box.shape === 'none' ? 0 : box.container ? 5 : 8,
      class: rectangleClass, ...(box.shape === 'none' ? { 'pointer-events': 'all' } : {}),
    }));
    if (box.container && !treatment) group.append(svgElement(document, 'line', {
      class: 'sketch-container-rule', x1: bx + presentation.inset, y1: by + header, x2: bx + w - presentation.inset, y2: by + header,
    }));
    if (box.blocks) {
      const area = box.textArea, left = x(box.x + area.x), right = x(box.x + area.x + area.w);
      const textTop = box.topAligned ? by + 12 * font
        : (y(box.y + area.y) + y(box.y + area.y + area.h) - area.h * font) / 2;
      const align = box.text?.align ?? 'start', anchor = align === 'center' ? 'middle' : align;
      const tx = align === 'center' ? (left + right) / 2 : align === 'end' ? right : left;
      for (const block of box.blocks) appendText(document, group, block.lines, tx,
        textTop + block.top * font + (block.fontSize === 12 ? 11 : 14) * font, {
          'text-anchor': anchor, class: `sketch-v2-${block.role}`, 'data-text-role': block.role,
          style: `white-space:pre;font-weight:${block.weight}`,
        }, block.lineHeight * font);
      if (box.icon) {
        if (!Object.hasOwn(ICON_PATHS, box.icon)) throw new SketchLayoutError(box.id, 'Unknown controlled icon.');
        const icon = svgElement(document, 'g', { 'data-sketch-icon': box.icon, 'aria-hidden': 'true',
          transform: `translate(${left - 24 * font},${textTop}) scale(${.75 * font})` });
        icon.append(svgElement(document, 'path', { d: ICON_PATHS[box.icon], class: 'sketch-icon' })); group.append(icon);
      }
    } else {
      const baseline = by + ((box.container ? header : h) - box.lines.length * LINE_HEIGHT * font) / 2 + 14 * font;
      appendText(document, group, box.lines, bx + presentation.inset * font, baseline, {
        'text-anchor': 'start', class: presentation.title,
      }, LINE_HEIGHT * font);
    }
    svg.append(group);
  }
  for (const edge of layout.connections) {
    const group = accessibleGroup(document, edge, 'connection', onSelect);
    const edgeAccent = edge.appearance?.profile
      ? PROFILE_ACCENTS[edge.appearance.profile] : accents.get(edge.from);
    group.setAttribute('data-sketch-accent', String(edgeAccent));
    group.setAttribute('style', accentStyle(edgeAccent));
    const points = edge.points.map((point) => ({ x: x(point.x), y: y(point.y) }));
    const commands = [`M${points[0].x},${points[0].y}`];
    const bridgeStrokes = [];
    let gapCount = 0, bridgeCount = 0;
    for (let i = 1; i < points.length; i++) {
      const start = points[i - 1], end = points[i];
      const bridges = layout.bridges.filter((bridge) => bridge.edgeId === edge.id
        && edge.points[i - 1].x === bridge.x && edge.points[i].x === bridge.x
        && bridge.top > Math.min(edge.points[i - 1].y, edge.points[i].y)
        && bridge.bottom < Math.max(edge.points[i - 1].y, edge.points[i].y))
        .sort((a, b) => start.y < end.y ? a.top - b.top : b.top - a.top);
      for (const bridge of bridges) {
        const downward = start.y < end.y, bx = x(bridge.x + bridge.offset);
        const entry = y(downward ? bridge.top : bridge.bottom), exit = y(downward ? bridge.bottom : bridge.top);
        const first = y(downward ? bridge.firstY : bridge.lastY), last = y(downward ? bridge.lastY : bridge.firstY);
        const c1 = (entry + first) / 2, c2 = (last + exit) / 2;
        const shoulder = [`C${start.x},${c1} ${bx},${c1} ${bx},${first}`,
          ...(first !== last ? [`L${bx},${last}`] : []),
          `C${bx},${c2} ${start.x},${c2} ${start.x},${exit}`];
        commands.push(`L${start.x},${entry}`, ...shoulder);
        bridgeStrokes.push([`M${start.x},${entry}`, ...shoulder].join(' '));
        bridgeCount++;
      }
      const gaps = layout.bridges.flatMap((bridge) => bridge.crossings
        .filter((crossing) => crossing.under === edge.id
          && edge.points[i - 1].y === crossing.y && edge.points[i].y === crossing.y
          && crossing.x > Math.min(edge.points[i - 1].x, edge.points[i].x)
          && crossing.x < Math.max(edge.points[i - 1].x, edge.points[i].x))
        .map(() => x(bridge.x + bridge.offset)))
        .sort((a, b) => start.x < end.x ? a - b : b - a);
      for (const cx of gaps) {
        const half = Math.min(4, STEP * sx * .45), direction = Math.sign(end.x - start.x);
        commands.push(`L${cx - direction * half},${start.y}`, `M${cx + direction * half},${start.y}`);
        gapCount++;
      }
      commands.push(`L${end.x},${end.y}`);
    }
    group.append(svgElement(document, 'path', { class: 'sketch-connection',
      'data-crossing-gaps': gapCount, 'data-crossing-bridges': bridgeCount, d: commands.join(' '),
      ...(edge.stroke === 'dashed' ? { 'stroke-dasharray': `${6 * font} ${4 * font}` } : {}) }));
    if (edge.stroke === 'dashed') for (const d of bridgeStrokes) group.append(svgElement(document, 'path', {
      class: 'sketch-connection', 'data-bridge-overpass': '', d,
    }));
    const tips = edge.arrowheads === 'none' ? [] : [[points.at(-1), points.at(-2), 'end']];
    if (edge.arrowheads === 'both') tips.push([points[0], points[1], 'start']);
    for (const [tip, previous, side] of tips) {
      const dx = Math.sign(tip.x - previous.x), dy = Math.sign(tip.y - previous.y);
      const length = Math.min(7.5, 9 * Math.min(sx, sy),
        (Math.abs(tip.x - previous.x) + Math.abs(tip.y - previous.y)) * .75);
      const base = { x: tip.x - dx * length, y: tip.y - dy * length }, half = length / 2;
      group.append(svgElement(document, 'polygon', { class: 'sketch-arrow', 'data-arrowhead': side,
        points: `${tip.x},${tip.y} ${base.x - dy * half},${base.y + dx * half} ${base.x + dy * half},${base.y - dx * half}` }));
    }
    if (fillBoundaries.length) {
      // Only recolor existing ink over opaque filled groups; gaps remain transparent.
      const overlay = svgElement(document, 'g', { 'data-contrast-ink': '', 'aria-hidden': 'true',
        'pointer-events': 'none', 'clip-path': `url(#${contrastClip})` });
      for (const mark of group.children) {
        if (mark.localName === 'path') overlay.append(svgElement(document, 'path', {
          d: mark.getAttribute('d'), class: 'sketch-connection sketch-contrast-line',
          ...(mark.hasAttribute('stroke-dasharray') ? { 'stroke-dasharray': mark.getAttribute('stroke-dasharray') } : {}),
        }));
        if (mark.localName === 'polygon') overlay.append(svgElement(document, 'polygon', {
          points: mark.getAttribute('points'), class: 'sketch-contrast-arrow',
        }));
      }
      group.append(overlay);
    }
    if (edge.labelRect) {
      const label = edge.labelRect, lx = x(label.x), ly = y(label.y), w = x(label.x + label.w) - lx, h = y(label.y + label.h) - ly;
      group.append(svgElement(document, 'rect', { class: 'sketch-label-surface', x: lx, y: ly, width: w, height: h, rx: 4 }));
      appendText(document, group, label.lines, lx + w / 2,
        ly + (h - label.lines.length * EDGE_LINE_HEIGHT * font) / 2 + 11 * font,
        { class: 'sketch-edge-label' }, EDGE_LINE_HEIGHT * font);
    }
    svg.append(group);
  }
}

/**
 * Input validation stays independent of drawing. Presentation scales geometry, not
 * labels below their readable baseline, and keeps SVG pixels aligned with capture.
 * Data is never interpreted as markup, styles, URLs, selectors, or executable code.
 */
export function renderSketch(document, input, { onSelect } = {}) {
  if (!document?.createElementNS || !document?.createElement) throw new TypeError('A browser Document is required.');
  if (onSelect !== undefined && typeof onSelect !== 'function') throw new TypeError('onSelect must be a function.');
  const layout = layoutSketch(input), bounds = presentationBounds(layout);
  const uniform = layout.boxes.some((box) => box.shape === 'circle');
  const horizontal = presentationCoordinates(layout, bounds, 'x'), vertical = presentationCoordinates(layout, bounds, 'y');
  const figure = document.createElement('figure');
  figure.className = 'shared-sketch';
  figure.setAttribute('aria-label', layout.sketch.title);
  figure.setAttribute('tabindex', '0');
  const style = document.createElement('style');
  style.textContent = styles;
  const svg = svgElement(document, 'svg', {
    xmlns: SVG_NS, role: 'group', 'aria-label': layout.sketch.title,
    'data-sketch-id': layout.sketch.id,
  });
  const controls = document.createElement('div'); controls.className = 'sketch-view-controls';
  controls.setAttribute('role', 'group'); controls.setAttribute('aria-label', 'Local diagram view');
  const status = document.createElement('span'); status.className = 'sketch-view-status'; status.setAttribute('aria-live', 'polite');
  const buttons = {};
  for (const [action, label, title] of [
    ['fit', 'Fit', 'Fit available width without making labels unreadable'],
    ['out', '\u2212', 'Zoom out, keeping readable labels'],
    ['in', '+', 'Zoom in'],
    ['reset', 'Reset', 'Reset to compact presentation'],
  ]) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
    button.dataset.sketchViewAction = action; button.title = title; button.setAttribute('aria-label', title);
    buttons[action] = button; controls.append(button);
  }
  controls.append(status); figure.append(style, controls, svg);
  let memory = presentationMemory.get(document);
  if (!memory) { memory = new Map(); presentationMemory.set(document, memory); }
  const key = JSON.stringify(layout.sketch);
  let minimum = readableScales(document, layout, horizontal, vertical);
  let view = memory.get(key) ?? { mode: 'fit', x: Math.max(COMPACT_X, minimum.x), y: Math.max(COMPACT_Y, minimum.y), font: 1 };
  if (uniform && !memory.has(key)) view = { ...view, x: Math.max(COMPACT_X, minimum.x, minimum.y), y: Math.max(COMPACT_X, minimum.x, minimum.y) };
  let width = -1, connected = false, locked = false, pendingFit = false;
  let resizeObserver, annotationObserver, observedPanel;
  const annotationLocked = () => {
    const panel = figure.closest('[data-annotation-mode]')
      ?? figure.closest('[data-design-artifact], [data-design-perspective]');
    if (!panel) return false;
    if (panel.dataset.annotationMode === 'annotate' || panel.dataset.annotationStale === 'true') return true;
    // Existing controller projects a binding/strokes as a visible Reset control.
    const tools = panel.querySelector('#annotation-tools'), reset = panel.querySelector('#annotation-reset');
    return Boolean(tools && !tools.hidden && reset && !reset.hidden);
  };
  const remember = () => {
    memory.delete(key); memory.set(key, { ...view });
    if (memory.size > 64) memory.delete(memory.keys().next().value);
  };
  const syncControls = () => {
    locked = annotationLocked();
    figure.dataset.annotationLocked = String(locked); figure.dataset.viewMode = view.mode;
    for (const button of Object.values(buttons)) if (button.disabled !== locked) button.disabled = locked;
    const label = locked ? 'Pinned' : view.mode === 'fit'
      ? Number(svg.getAttribute('width')) > figure.clientWidth + 1 ? 'Fit \u00b7 pan' : 'Fit' : view.mode === 'compact' ? 'Compact' : 'Custom';
    if (status.textContent !== label) status.textContent = label;
    status.title = locked ? 'Exit Annotate, then Reset sketch to change the view. Removing only a PNG does not clear a sketch.'
      : 'Labels keep a readable size; narrow views may need local panning.';
  };
  const paint = () => {
    if (uniform) {
      const scale = Math.max(view.x, view.y);
      view = { ...view, x: scale, y: scale };
    }
    const active = document.activeElement;
    const focused = svg.contains(active) ? { box: active.dataset?.sketchBox, edge: active.dataset?.sketchConnection } : null;
    paintSketch(document, svg, layout, horizontal, vertical, view, onSelect); remember(); syncControls();
    if (focused) [...svg.querySelectorAll('[data-sketch-box],[data-sketch-connection]')]
      .find((node) => focused.box ? node.dataset.sketchBox === focused.box : node.dataset.sketchConnection === focused.edge)
      ?.focus({ preventScroll: true });
  };
  const fit = () => {
    if (annotationLocked()) { pendingFit = true; syncControls(); return; }
    const available = figure.clientWidth;
    if (!available) return;
    view = { mode: 'fit', x: Math.max(minimum.x, Math.min(COMPACT_X, (available - DISPLAY_PADDING * 2) / horizontal.extent)),
      y: Math.max(COMPACT_Y, minimum.y), font: 1 };
    if (uniform) {
      const scale = Math.max(minimum.x, minimum.y, Math.min(COMPACT_X, (available - DISPLAY_PADDING * 2) / horizontal.extent));
      view = { ...view, x: scale, y: scale };
    }
    pendingFit = false; paint();
  };
  for (const [action, button] of Object.entries(buttons)) button.addEventListener('click', () => {
    if (annotationLocked()) { syncControls(); return; }
    if (action === 'fit') { fit(); return; }
    if (action === 'reset') view = { mode: 'compact', x: Math.max(COMPACT_X, minimum.x, uniform ? minimum.y : 0),
      y: uniform ? Math.max(COMPACT_X, minimum.x, minimum.y) : Math.max(COMPACT_Y, minimum.y), font: 1 };
    else {
      const multiplier = action === 'in' ? 1.15 : 1 / 1.15;
      const font = Math.max(1, Math.min(2, view.font * multiplier));
      view = { mode: 'manual', x: Math.max(minimum.x * font, Math.min(2, view.x * multiplier)),
        y: Math.max(minimum.y * font, Math.min(2, view.y * multiplier)), font };
    }
    pendingFit = false; paint();
  });
  paint();
  const window = document.defaultView;
  if (window?.ResizeObserver) {
    resizeObserver = new window.ResizeObserver(() => {
      if (!figure.isConnected) {
        if (connected) { resizeObserver.disconnect(); annotationObserver?.disconnect(); }
        return;
      }
      connected = true;
      const panel = figure.closest('[data-annotation-mode]')
        ?? figure.closest('[data-design-artifact], [data-design-perspective]');
      if (panel && panel !== observedPanel) {
        observedPanel = panel; annotationObserver?.disconnect();
        annotationObserver = new window.MutationObserver(() => {
          if (!figure.isConnected) { annotationObserver.disconnect(); resizeObserver.disconnect(); return; }
          const wasLocked = locked; syncControls();
          if (wasLocked && !locked && pendingFit && view.mode === 'fit') fit();
        });
        annotationObserver.observe(panel, { subtree: true, childList: true, attributes: true,
          attributeFilter: ['hidden', 'disabled', 'data-annotation-mode', 'data-annotation-stale', 'data-annotation-state'] });
      }
      if (Math.abs(figure.clientWidth - width) > .5) {
        width = figure.clientWidth;
        if (view.mode === 'fit') fit(); else syncControls();
      }
    });
    resizeObserver.observe(figure);
  }
  document.fonts?.ready.then(() => {
    if (!figure.isConnected || annotationLocked()) return;
    minimum = readableScales(document, layout, horizontal, vertical);
    if (view.mode === 'fit') fit();
  });
  figure.fitToView = fit;
  figure.getViewState = () => ({ ...view, scrollLeft: figure.scrollLeft, scrollTop: figure.scrollTop });
  figure.restoreViewState = state => {
    if (!state || !['fit', 'compact', 'manual'].includes(state.mode)
      || !['x', 'y', 'font'].every(key => Number.isFinite(state[key]) && state[key] > 0)
      || !['scrollLeft', 'scrollTop'].every(key => Number.isFinite(state[key]) && state[key] >= 0)) {
      throw new Error('Invalid sketch view state');
    }
    view = { mode: state.mode, x: state.x, y: state.y, font: state.font };
    pendingFit = false; paint();
    figure.scrollLeft = state.scrollLeft; figure.scrollTop = state.scrollTop;
  };
  return figure;
}
