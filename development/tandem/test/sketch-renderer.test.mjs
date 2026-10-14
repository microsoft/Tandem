import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import test from 'node:test';
import { GRID, MAX_EXTENT, absoluteSketchBoxes, validateSketch } from '../public/sketch/contract.js';
import { layoutSketch, SketchLayoutError } from '../public/sketch/renderer.js';
import { createLegacyTemplate as createTemplate, templateCatalog } from '../public/sketch/templates.js';
import { browserAvailable, openFixtureBrowser } from './helpers/browser-fixture.mjs';
import { fanoutCrossingSketch } from './fixtures/sketch-routing.mjs';

const segments = (points) => points.slice(1).map((to, index) => ({ from: points[index], to }));
const onBoundary = (point, box) => (
  ((point.x === box.x || point.x === box.x + box.w) && point.y >= box.y && point.y <= box.y + box.h)
  || ((point.y === box.y || point.y === box.y + box.h) && point.x >= box.x && point.x <= box.x + box.w)
);
const intersectsInterior = ({ from, to }, box) => from.x === to.x
  ? from.x > box.x && from.x < box.x + box.w
    && Math.max(from.y, to.y) > box.y && Math.min(from.y, to.y) < box.y + box.h
  : from.y > box.y && from.y < box.y + box.h
    && Math.max(from.x, to.x) > box.x && Math.min(from.x, to.x) < box.x + box.w;

test('all templates render deterministic bounded geometry, orthogonal endpoints, and unobstructed arrows', () => {
  for (const { id } of templateCatalog) {
    const input = createTemplate(id), before = JSON.stringify(input);
    const layout = layoutSketch(validateSketch(input));
    assert.equal(JSON.stringify(input), before);
    assert.deepEqual(layoutSketch(input), layout);
    assert.equal(layout.boxes.length, input.boxes.length);
    assert.equal(layout.connections.length, input.connections.length);
    assert.ok(layout.width <= (MAX_EXTENT + 4) * GRID && layout.height <= (MAX_EXTENT + 4) * GRID);
    for (const box of layout.boxes) {
      const source = absoluteSketchBoxes(input).find((item) => item.id === box.id);
      const parent = layout.boxes.find((item) => item.id === box.parent);
      assert.ok(box.x >= source.x * GRID + GRID * 2);
      assert.ok(box.y >= source.y * GRID + GRID * 2);
      assert.ok(box.x + box.w <= (source.x + source.w) * GRID + GRID * 2);
      assert.ok(box.y + box.h <= (source.y + source.h) * GRID + GRID * 2);
      if (parent) {
        assert.ok(box.x >= parent.x + GRID && box.y >= parent.y + 3 * GRID);
        assert.ok(box.x + box.w <= parent.x + parent.w - GRID);
        assert.ok(box.y + box.h <= parent.y + parent.h - GRID);
      }
    }
    const occupied = new Set();
    for (const edge of layout.connections) {
      const from = layout.boxes.find((box) => box.id === edge.from), to = layout.boxes.find((box) => box.id === edge.to);
      assert.ok(onBoundary(edge.points[0], from), `${edge.id}: exact source outline`);
      assert.ok(onBoundary(edge.points.at(-1), to), `${edge.id}: exact destination outline`);
      const edgePoints = new Set();
      for (const segment of segments(edge.points)) {
        const { from: start, to: end } = segment;
        assert.ok(start.x === end.x || start.y === end.y, `${edge.id}: orthogonal segment`);
        assert.ok(start.x !== end.x || start.y !== end.y, `${edge.id}: no zero-length segment`);
        for (const box of layout.boxes.filter((item) => !item.container)) {
          assert.equal(intersectsInterior(segment, box), false, `${edge.id}: does not enter ${box.id}`);
        }
        const dx = Math.sign(end.x - start.x) * 12, dy = Math.sign(end.y - start.y) * 12;
        for (let x = start.x, y = start.y; ; x += dx, y += dy) {
          assert.ok(x >= 0 && y >= 0 && x <= layout.width && y <= layout.height);
          edgePoints.add(`${x},${y}`);
          if (x === end.x && y === end.y) break;
        }
      }
      for (const point of edgePoints) {
        assert.equal(occupied.has(point), false, `${edge.id}: does not cross or share another connection`);
        occupied.add(point);
      }
      assert.equal(edge.labelRect.lines.join(''), edge.label);
    }
    const shuffled = { ...input, boxes: [...input.boxes].reverse(), connections: [...input.connections].reverse() };
    assert.deepEqual(layoutSketch(shuffled).connections, layout.connections, 'Array order cannot change routing');
    assert.deepEqual(layoutSketch(shuffled).boxes, layout.boxes, 'Array order cannot change stacking');
  }
});

test('shared routing detours around an unrelated box without template hints', () => {
  const value = {
    schemaVersion: 'sketch/v1', id: 'detour', title: 'Detour',
    boxes: [
      { id: 'from', label: 'From', x: 0, y: 0, w: 8, h: 4 },
      { id: 'obstacle', label: 'Obstacle', x: 15, y: 0, w: 8, h: 4 },
      { id: 'to', label: 'To', x: 30, y: 0, w: 8, h: 4 },
    ],
    connections: [{ id: 'route', from: 'from', to: 'to' }],
  };
  const layout = layoutSketch(value), obstacle = layout.boxes.find((box) => box.id === 'obstacle');
  assert.ok(layout.connections[0].points.length >= 4);
  for (const segment of segments(layout.connections[0].points)) assert.equal(intersectsInterior(segment, obstacle), false);
});

test('ordered same-side ports use short routes, explicit crossings and content-sized cards', () => {
  const before = JSON.stringify(fanoutCrossingSketch), layout = layoutSketch(fanoutCrossingSketch);
  const outgoing = layout.connections.filter((edge) => edge.from === 'coordinator');
  assert.deepEqual(outgoing.map((edge) => edge.fromPort), ['right', 'right', 'right']);
  assert.deepEqual(outgoing.map((edge) => edge.points[0].y), [384, 408, 432]);
  assert.equal(layout.connections.find((edge) => edge.id === 'e-trace').points.length, 2);
  assert.equal(layout.connections.reduce((sum, edge) => sum + edge.points.length - 2, 0), 4);
  assert.equal(layout.crossings.length, 3);
  for (const crossing of layout.crossings) {
    assert.equal(crossing.over, 'e-trace', 'The continuous vertical bridge passes over the horizontal paths.');
    for (const id of [crossing.over, crossing.under]) {
      const edge = layout.connections.find((item) => item.id === id);
      for (const point of edge.points) assert.ok(Math.abs(crossing.x - point.x) + Math.abs(crossing.y - point.y) >= 24,
        'A crossing must clear every bend and arrow tip.');
    }
    assert.equal(layout.bridges.length, 1, 'Nearby crossings merge into one clear bridge.');
    assert.equal(layout.bridges[0].offset, -24, 'The clear left shoulder is preferred.');
    assert.equal(layout.bridges[0].crossings.length, 3);
  }
  for (const edge of layout.connections) for (const segment of segments(edge.points)) {
    for (const box of layout.boxes.filter((box) => !box.container)) {
      assert.equal(intersectsInterior(segment, box), false);
    }
  }
  const area = layout.boxes.filter((box) => !box.container).reduce((sum, box) => sum + box.w * box.h, 0);
  assert.equal(area, 70848, 'Content sizing reduces drawable leaf area without changing model bounds.');
  assert.equal(JSON.stringify(fanoutCrossingSketch), before);
  const shuffled = { ...fanoutCrossingSketch, connections: [...fanoutCrossingSketch.connections].reverse(),
    boxes: [...fanoutCrossingSketch.boxes].reverse() };
  assert.deepEqual(layoutSketch(shuffled).connections, layout.connections);
  assert.deepEqual(layoutSketch(shuffled).crossings, layout.crossings);
  const excess = structuredClone(fanoutCrossingSketch);
  excess.connections.push({ id: 'fifth', from: 'coordinator', to: 'audit' });
  assert.throws(() => layoutSketch(excess), { code: 'degree' }, 'Same-side ports do not expand the canonical degree cap.');
});

test('aligned Store handoff stays straight beside Validate and Publish bends, without a near-target dogleg', () => {
  const layout = layoutSketch(fanoutCrossingSketch);
  const source = layout.boxes.find((box) => box.id === 'coordinator');
  const target = layout.boxes.find((box) => box.id === 'store');
  const edge = layout.connections.find((item) => item.id === 'c-store');
  assert.deepEqual(edge.points, [
    { x: source.x + source.w, y: source.y + source.h / 2 },
    { x: target.x, y: target.y + target.h / 2 },
  ], 'A crossing-clearance halo is not an occupied stroke and must not cause a stair-step in clear parallel space.');
});

test('opposite directed handoffs use separate routes and distinct destination arrow tips', () => {
  const layout = layoutSketch({
    schemaVersion: 'sketch/v1', id: 'exchange', title: 'Request and response',
    boxes: [
      { id: 'client', label: 'Client', x: 0, y: 0, w: 12, h: 6 },
      { id: 'server', label: 'Server', x: 24, y: 0, w: 12, h: 6 },
    ],
    connections: [
      { id: 'request', from: 'client', to: 'server', label: 'Request' },
      { id: 'response', from: 'server', to: 'client', label: 'Response' },
    ],
  });
  const occupied = new Set(), ports = new Set();
  for (const edge of layout.connections) {
    const from = layout.boxes.find(box => box.id === edge.from);
    const to = layout.boxes.find(box => box.id === edge.to);
    assert.ok(onBoundary(edge.points[0], from));
    assert.ok(onBoundary(edge.points.at(-1), to));
    for (const port of [`${edge.from}:${JSON.stringify(edge.points[0])}`, `${edge.to}:${JSON.stringify(edge.points.at(-1))}`]) {
      assert.equal(ports.has(port), false);
      ports.add(port);
    }
    const points = new Set();
    for (const segment of segments(edge.points)) {
      for (const box of layout.boxes) assert.equal(intersectsInterior(segment, box), false);
      const dx = Math.sign(segment.to.x - segment.from.x) * 12;
      const dy = Math.sign(segment.to.y - segment.from.y) * 12;
      for (let x = segment.from.x, y = segment.from.y; ; x += dx, y += dy) {
        points.add(`${x},${y}`);
        if (x === segment.to.x && y === segment.to.y) break;
      }
    }
    for (const point of points) {
      assert.equal(occupied.has(point), false, 'Opposite directions cannot share or cross routes');
      occupied.add(point);
    }
    const tip = edge.points.at(-1), before = edge.points.at(-2);
    assert.ok(Math.abs(tip.x - before.x) + Math.abs(tip.y - before.y) >= 12,
      'Final segment accommodates the renderer’s 9px directed arrowhead');
    assert.equal(edge.labelRect.lines.join(''), edge.label);
  }
});

test('impossible connection labels and structural errors fail explicitly before creating DOM', () => {
  const value = {
    schemaVersion: 'sketch/v1', id: 'crowded', title: 'Crowded',
    boxes: [
      { id: 'one', label: 'One', x: 0, y: 0, w: 6, h: 3 },
      { id: 'two', label: 'Two', x: 7, y: 0, w: 6, h: 3 },
    ],
    connections: [{ id: 'edge', from: 'one', to: 'two', label: 'W'.repeat(48) }],
  };
  assert.throws(() => layoutSketch(value), (error) => error instanceof SketchLayoutError && error.id === 'edge');
  value.boxes[0].w = Infinity;
  assert.throws(() => layoutSketch(value), { name: 'SketchValidationError', code: 'type' });
});

async function openSketchFixture(t) {
  const publicRoot = new URL('../public/sketch/', import.meta.url);
  const files = new Map(await Promise.all(['contract.js', 'renderer.js', 'templates.js', 'geometry-v2.js', 'icons.js'].map(async (name) => (
    [`/${name}`, await readFile(new URL(name, publicRoot), 'utf8')]
  ))));
  for (const name of ['human-loop.js', 'human-loop.json']) {
    files.set(`/prompts/${name}`, await readFile(new URL(`../prompts/${name}`, publicRoot), 'utf8'));
  }
  files.set('/fixture.html', '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><main></main>');
  const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (!files.has(path)) { response.writeHead(404).end(); return; }
    response.setHeader('Content-Type', path.endsWith('.json') ? 'application/json' : path.endsWith('.js') ? 'text/javascript' : 'text/html');
    response.end(files.get(path));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const browser = await openFixtureBrowser(t);
  await browser.call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await browser.call('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/fixture.html` });
  await browser.waitFor("document.querySelector('main')");
  await browser.evaluate(`(async () => {
    const { renderSketch, layoutSketch } = await import('/renderer.js');
    const { createLegacyTemplate: createTemplate, templateCatalog } = await import('/templates.js');
    window.sketchFixture = { renderSketch, layoutSketch, createTemplate, templateCatalog, selections: [] };
    document.querySelector('main').append(...templateCatalog.map(({id}) => renderSketch(document, createTemplate(id))));
  })()`);
  return browser;
}

test('real Edge renders all compositions with legible measured text, safe details, theme tokens, and bounded narrow scrolling',
  { skip: !browserAvailable, timeout: 60_000 }, async (t) => {
    const browser = await openSketchFixture(t);
    const measurements = await browser.evaluate(`(() => {
      return sketchFixture.templateCatalog.map(({ id }) => {
        const value = sketchFixture.createTemplate(id);
        const svg = document.querySelector('[data-sketch-id="' + value.id + '"]');
        const boxes = [...svg.querySelectorAll('[data-sketch-box]')].map(group => {
          const rect = group.querySelector('rect').getBBox(), text = group.querySelector('text').getBBox();
          const spans = [...group.querySelectorAll('tspan')];
          return { id: group.getAttribute('data-sketch-box'), rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
            text: { x: text.x, y: text.y, w: text.width, h: text.height },
            font: parseFloat(getComputedStyle(group.querySelector('text')).fontSize),
            fontFamily: getComputedStyle(group.querySelector('text')).fontFamily,
            accent: group.getAttribute('data-sketch-accent'),
            container: group.querySelector('.sketch-container') !== null,
            rule: group.querySelector('.sketch-container-rule') !== null,
            longestLine: Math.max(...spans.map(span => span.getComputedTextLength())) };
        });
        const connections = [...svg.querySelectorAll('[data-sketch-connection]')].map(group => {
          const path = group.querySelector('path'), arrow = group.querySelector('polygon');
          const points = [...arrow.points].map(point => ({ x: point.x, y: point.y }));
          const end = path.getPointAtLength(path.getTotalLength());
          return { id: group.getAttribute('data-sketch-connection'), length: path.getTotalLength(),
            end: { x: end.x, y: end.y }, points, label: group.querySelector('text')?.textContent };
        });
        return { id, boxes, connections, viewBox: svg.getAttribute('viewBox'),
          expectedBoxes: value.boxes.length, expectedConnections: value.connections.length };
      });
    })()`);
    for (const item of measurements) {
      assert.equal(item.boxes.length, item.expectedBoxes);
      assert.equal(item.connections.length, item.expectedConnections);
      for (const box of item.boxes) {
        assert.equal(box.font, 14);
        assert.doesNotMatch(box.fontFamily, /monospace/i);
        assert.match(box.accent, /^[1-4]$/);
        assert.equal(box.rule, box.container);
        assert.ok(box.text.x >= box.rect.x + 8, `${item.id}/${box.id}: readable left inset`);
        assert.ok(box.text.x + box.text.w <= box.rect.x + box.rect.w - 8, `${item.id}/${box.id}: no horizontal text clipping`);
        assert.ok(box.text.y >= box.rect.y + 4, `${item.id}/${box.id}: no top clipping`);
        assert.ok(box.text.y + box.text.h <= box.rect.y + box.rect.h - 4, `${item.id}/${box.id}: no bottom clipping`);
        assert.ok(box.longestLine <= box.rect.w - 24);
      }
      for (const connection of item.connections) {
        assert.ok(connection.length >= 24);
        assert.equal(connection.points.length, 3);
        assert.deepEqual(connection.points[0], connection.end, 'Arrow tip exactly meets the path destination');
        assert.ok(connection.label.length > 0);
      }
    }

    const exact = '<img src=x>\n  原文 & text';
    const details = '</desc><script>window.sketchInjected=true</script>\n  Full details  ';
    const safety = await browser.evaluate(`(() => {
      const value = sketchFixture.createTemplate('workflow');
      value.boxes.find(box => box.id === 'prepare').label = ${JSON.stringify(exact)};
      value.boxes.find(box => box.id === 'prepare').details = ${JSON.stringify(details)};
      const before = JSON.stringify(value);
      const output = sketchFixture.renderSketch(document, value, { onSelect: selection => sketchFixture.selections.push(selection) });
      document.querySelector('main').replaceChildren(output);
      const group = output.querySelector('[data-sketch-box="prepare"]');
      group.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      group.focus();
      group.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      group.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      return { title: group.querySelector('title').textContent, details: group.querySelector('desc').textContent,
        aria: group.getAttribute('aria-label'), unsafe: output.querySelectorAll('img,script,foreignObject').length,
        injected: window.sketchInjected === true, unchanged: JSON.stringify(value) === before,
        selections: sketchFixture.selections, focused: document.activeElement === group };
    })()`);
    assert.equal(safety.title, exact);
    assert.equal(safety.aria, exact);
    assert.equal(safety.details, details);
    assert.equal(safety.unsafe, 0);
    assert.equal(safety.injected, false);
    assert.equal(safety.unchanged, true);
    assert.equal(safety.focused, true);
    assert.equal(safety.selections.length, 3);
    assert.ok(safety.selections.every((selection) => selection.id === 'prepare' && selection.details === details));

    for (const theme of [
      { surface: '#fafafa', text: '#18202a', border: '#59636f' },
      { surface: '#181c22', text: '#e8edf4', border: '#a4b0bf' },
    ]) {
      const colors = await browser.evaluate(`(() => {
        const root = document.documentElement;
        root.style.setProperty('--background-color-default', '${theme.surface}');
        root.style.setProperty('--text-color-default', '${theme.text}');
        root.style.setProperty('--border-color-default', '${theme.border}');
        const rgba = value => {
          const canvas = document.createElement('canvas'), context = canvas.getContext('2d');
          canvas.width = canvas.height = 1;
          context.fillStyle = value;
          context.fillRect(0, 0, 1, 1);
          return [...context.getImageData(0, 0, 1, 1).data];
        };
        const color = (selector, property) => rgba(getComputedStyle(document.querySelector(selector))[property]);
        return { fill: color('.sketch-box:not(.sketch-container)', 'fill'),
          container: color('.sketch-container', 'fill'),
          surface: color('.sketch-grid-surface', 'fill'),
          text: color('.sketch-node-title', 'fill'),
          heading: color('.sketch-root-title', 'fill'),
          arrow: color('.sketch-arrow', 'fill'),
          border: color('.sketch-box:not(.sketch-container)', 'stroke'),
          grid: color('.sketch-grid-dot', 'fill'),
          accents: new Set([...document.querySelectorAll('[data-sketch-accent]')]
            .map(node => node.getAttribute('data-sketch-accent'))).size };
      })()`);
      const rgb = (hex) => [...[1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16)), 255];
      const luminance = ([red, green, blue]) => {
        const values = [red, green, blue].map(value => {
          const channel = value / 255;
          return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
        });
        return values[0] * .2126 + values[1] * .7152 + values[2] * .0722;
      };
      const contrast = (first, second) => {
        const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
        return (values[0] + .05) / (values[1] + .05);
      };
      assert.deepEqual(colors.surface, rgb(theme.surface));
      assert.deepEqual(colors.text, rgb(theme.text));
      assert.ok(contrast(colors.text, colors.fill) >= 4.5);
      assert.ok(contrast(colors.text, colors.container) >= 4.5);
      assert.ok(contrast(colors.heading, colors.container) >= 4.5);
      assert.ok(contrast(colors.arrow, colors.surface) >= 3);
      assert.ok(contrast(colors.border, colors.surface) >= 3);
      assert.ok(colors.grid[3] > 0 && colors.grid[3] < 128);
      assert.ok(colors.accents >= 3, 'Independent root groups receive restrained distinct accents');
    }

    await browser.call('Emulation.setDeviceMetricsOverride', { width: 320, height: 700, deviceScaleFactor: 1, mobile: false });
    const narrowResults = await browser.evaluate(`(() => {
      const main = document.querySelector('main');
      main.replaceChildren(...sketchFixture.templateCatalog.map(({ id }) =>
        sketchFixture.renderSketch(document, sketchFixture.createTemplate(id))));
      return [...main.querySelectorAll('.shared-sketch')].map(figure => {
        figure.scrollLeft = 100000;
        return { pageWidth: document.documentElement.scrollWidth, viewport: innerWidth,
          client: figure.clientWidth, scroll: figure.scrollWidth, offset: figure.scrollLeft,
          svgWidth: figure.querySelector('svg').getBoundingClientRect().width,
          font: parseFloat(getComputedStyle(figure.querySelector('text')).fontSize) };
      });
    })()`);
    assert.equal(narrowResults.length, 3);
    for (const narrow of narrowResults) {
      assert.ok(narrow.pageWidth <= narrow.viewport, 'The diagram does not overflow the page');
      assert.ok(narrow.client <= 320 && narrow.scroll > narrow.client);
      assert.equal(narrow.scroll, narrow.svgWidth);
      assert.equal(narrow.offset, narrow.scroll - narrow.client);
      assert.equal(narrow.font, 14, 'A narrow viewport scrolls instead of shrinking text');
    }
    assert.deepEqual(browser.exceptions, []);
  });
