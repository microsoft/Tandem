import assert from 'node:assert/strict';
import test from 'node:test';
import { layoutSketch } from '../public/sketch/renderer.js';
import { mailSketch, shapeSketch } from './fixtures/sketch-v2.mjs';
import { sketchConnectionLabel } from '../public/sketch/contract.js';

test('v2 resolves nested automatic mail groups in explicit order without changing source data', () => {
  const source = JSON.stringify(mailSketch), layout = layoutSketch(mailSketch);
  assert.equal(JSON.stringify(mailSketch), source);
  const box = id => layout.boxes.find(node => node.id === id);
  assert.ok(box('folders').x < box('messages').x && box('messages').x < box('reader').x);
  assert.ok(box('message-one').y < box('message-two').y && box('message-two').y < box('message-three').y);
  assert.equal(box('reader').h, box('folders').h);
  assert.equal(box('message-one').w, box('message-two').w);
  assert.ok(box('reader').blocks.some(block => block.role === 'body' && block.lines.join('').includes('same visual vocabulary')));
  const permuted = { ...mailSketch, boxes: [...mailSketch.boxes].reverse() };
  assert.deepEqual(layoutSketch(permuted).boxes, layout.boxes, 'Array order never overrides explicit group order.');
  for (const node of layout.boxes) {
    const sourceNode = mailSketch.boxes.find(item => item.id === node.id);
    assert.ok(node.w <= sourceNode.w * 24 && node.h <= sourceNode.h * 24);
    if (node.parent) {
      const parent = box(node.parent);
      assert.ok(node.x >= parent.x + parent.padding);
      assert.ok(node.y >= parent.y + parent.headerHeight + parent.padding);
      assert.ok(node.x + node.w <= parent.x + parent.w - parent.padding);
      assert.ok(node.y + node.h <= parent.y + parent.h - parent.padding);
    }
  }
});

test('v2 reports visible overflow and never truncates text or expands a declared allocation', () => {
  const crowded = structuredClone(mailSketch);
  crowded.boxes.find(node => node.id === 'workspace').w = 30;
  assert.throws(() => layoutSketch(crowded), /allocation|fit|bounds/);
  const text = structuredClone(shapeSketch);
  text.boxes.find(node => node.id === 'person').body = 'A complete visible paragraph\n'.repeat(20);
  assert.throws(() => layoutSketch(text), /fit|bounds/);
});

test('nested stretch measures intrinsic content before allocating sibling groups', () => {
  for (const align of ['start', 'center', 'end']) {
    const input = {
      schemaVersion: 'sketch/v2', id: 'nested-stretch', title: 'Nested stretch',
      boxes: [
        { id: 'root', label: 'Root', x: 0, y: 0, w: 30, h: 20,
          layout: { direction: 'horizontal', order: ['left', 'right'] } },
        ...['left', 'right'].flatMap(id => [
          { id, label: 'Group', parent: 'root', w: 28, h: 15, sizing: { width: 'stretch' },
            layout: { direction: 'vertical', order: [`${id}-leaf`], align } },
          { id: `${id}-leaf`, label: 'Leaf', parent: id, w: 26, h: 4, sizing: { width: 'stretch' } },
        ]),
      ],
      connections: [],
    };
    const exact = JSON.stringify(input), layout = layoutSketch(input);
    const node = id => layout.boxes.find(box => box.id === id);
    assert.equal(node('left').w, node('right').w);
    assert.equal(node('left').w + node('right').w + 24, node('root').w - 48);
    for (const id of ['left', 'right']) {
      assert.equal(node(`${id}-leaf`).w, node(id).w - 48);
      assert.ok(node(`${id}-leaf`).x >= node(id).x + 24);
      assert.ok(node(`${id}-leaf`).x + node(`${id}-leaf`).w <= node(id).x + node(id).w - 24);
    }
    assert.equal(JSON.stringify(input), exact);
    const narrower = structuredClone(input);
    for (const box of narrower.boxes.filter(box => ['left', 'right'].includes(box.id))) box.w = 13;
    assert.doesNotThrow(() => layoutSketch(narrower), 'Increasing an upper bound must not make nested stretch infeasible.');
  }
});

test('intrinsic free groups reserve authored allocation frames inside automatic ancestors', () => {
  for (const direction of ['horizontal', 'vertical']) {
    const input = {
      schemaVersion: 'sketch/v2', id: 'mixed-layout', title: 'Mixed nesting',
      boxes: [
        { id: 'root', label: 'Root', x: 0, y: 0, w: 30, h: 30, layout: { direction, order: ['free'] } },
        { id: 'free', label: 'Free', parent: 'root', w: 28, h: 20 },
        { id: 'auto', label: 'Auto', parent: 'free', x: 1, y: 3, w: 26, h: 10,
          layout: { direction: 'horizontal', order: ['leaf'] } },
        { id: 'leaf', label: 'Leaf', parent: 'auto', w: 10, h: 6, sizing: { height: 'stretch' } },
      ],
      connections: [],
    };
    const exact = JSON.stringify(input), layout = layoutSketch(input);
    const node = id => layout.boxes.find(box => box.id === id);
    assert.equal(node('leaf').h, node('auto').h - node('auto').headerHeight - node('auto').padding * 2);
    assert.ok(node('auto').y >= node('free').y + node('free').headerHeight + node('free').padding);
    assert.ok(node('auto').x + node('auto').w <= node('free').x + node('free').w - node('free').padding);
    assert.ok(node('auto').y + node('auto').h <= node('free').y + node('free').h - node('free').padding);
    assert.equal(JSON.stringify(input), exact);
  }
});

test('v2 ports terminate on actual circle and diamond contours, with real directedness and no mutation', () => {
  const source = JSON.stringify(shapeSketch), layout = layoutSketch(shapeSketch);
  for (const edge of layout.connections) {
    for (const [id, point] of [[edge.from, edge.points[0]], [edge.to, edge.points.at(-1)]]) {
      const box = layout.boxes.find(item => item.id === id);
      if (box.shape === 'circle') {
        assert.equal(box.w, box.h);
        const radius = box.w / 2;
        assert.ok(Math.abs(((point.x - box.x - radius) / radius) ** 2 + ((point.y - box.y - radius) / radius) ** 2 - 1) < 1e-9);
      } else if (box.shape === 'diamond') {
        assert.ok(Math.abs(Math.abs(point.x - box.x - box.w / 2) / (box.w / 2)
          + Math.abs(point.y - box.y - box.h / 2) / (box.h / 2) - 1) < 1e-9);
      }
    }
  }
  assert.equal(JSON.stringify(shapeSketch), source);
  assert.equal(layout.connections.find(edge => edge.id === 'exchange').arrowheads, 'both');
  assert.equal(layout.connections.find(edge => edge.id === 'association').arrowheads, 'none');
  assert.equal(sketchConnectionLabel({ from: 'one', to: 'two', arrowheads: 'none' }), 'one and two (undirected)');
  assert.equal(sketchConnectionLabel({ from: 'one', to: 'two', arrowheads: 'both' }), 'one and two (two-way)');
  assert.equal(sketchConnectionLabel({ from: 'one', to: 'two' }), 'one to two');
});
