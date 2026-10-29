import { GRID, FONT_SIZE, LINE_HEIGHT, GLYPH_WIDTH, MAX_EXTENT, rejectSketch, wrapSketchText } from './contract.js';

const STEP = GRID / 2;
const round = (value) => Math.ceil(value / STEP) * STEP;
const fail = (node, message) => rejectSketch('layout', node.id, message);
const childSize = (node, axis) => node.sizing?.[axis === 'w' ? 'width' : 'height'] === 'stretch';

function wrapVisibleText(value, columns) {
  // Preserve every character while preferring whitespace boundaries in visible prose.
  if (columns < 1) return wrapSketchText(value, columns);
  return value.split('\n').flatMap((paragraph) => {
    const chars = Array.from(paragraph), lines = [];
    if (!chars.length) return [''];
    while (chars.length) {
      let end = Math.min(columns, chars.length);
      if (end < chars.length) {
        const space = chars.slice(0, end).lastIndexOf(' ');
        if (space > 0) end = space + 1;
      }
      lines.push(chars.splice(0, end).join(''));
    }
    return lines;
  });
}

function textGeometry(node, width, container) {
  const shape = node.shape, factor = shape === 'circle' ? Math.SQRT1_2 : shape === 'diamond' ? .5 : 1;
  const iconWidth = node.icon ? 36 : 0, available = width * factor - 24 - iconWidth;
  if (available < GLYPH_WIDTH) fail(node, 'The shape has no readable text area within its width bound.');
  const roles = [
    ['title', node.label, FONT_SIZE, LINE_HEIGHT,
      node.text?.emphasis === 'normal' ? 400 : node.text?.emphasis === 'strong' ? 700
        : shape === 'none' ? 400 : container && !node.parent ? 750 : 650],
    ['caption', node.caption, 12, 14, 400],
    ['body', node.body, FONT_SIZE, LINE_HEIGHT, 400],
  ];
  const blocks = [];
  let height = 0, textWidth = 0;
  for (const [role, value, fontSize, lineHeight, weight] of roles) {
    if (value === undefined) continue;
    const lines = wrapVisibleText(value, Math.floor(available / fontSize));
    if (blocks.length) height += 6;
    blocks.push({ role, lines, fontSize, lineHeight, weight, top: height });
    height += lines.length * lineHeight;
    textWidth = Math.max(textWidth, ...lines.map((line) => Array.from(line).length * fontSize));
  }
  return { blocks, textHeight: height, textWidth, iconWidth, factor,
    minimumW: round((textWidth + iconWidth + 24) / factor),
    minimumH: round((Math.max(height, node.icon ? 18 : 0) + 24) / factor) };
}

/** Resolve bounded v2 allocation into one measured, absolute drawing. Input stays untouched. */
export function resolveV2Boxes(sketch, gutter = GRID * 2) {
  const byId = new Map(sketch.boxes.map((node) => [node.id, node]));
  const children = new Map(sketch.boxes.map((node) => [node.id, sketch.boxes.filter((child) => child.parent === node.id)]));
  function measure(node, capW = node.w * GRID, capH = node.h * GRID, stretchW = false, stretchH = false, intrinsic = false) {
    capW = Math.min(node.w * GRID, capW); capH = Math.min(node.h * GRID, capH);
    if (node.shape === 'circle') capW = capH = Math.min(capW, capH);
    const descendants = children.get(node.id), container = descendants.length > 0;
    const padding = (node.layout?.padding ?? 1) * GRID;
    let text = textGeometry(node, capW, container);
    const headerHeight = Math.min(capH, Math.max(round(text.textHeight + 24), round((text.textHeight + 12) / .64)));
    if (text.minimumW > capW || (container ? headerHeight : text.minimumH) > capH) {
      fail(node, 'Visible title, caption or body cannot fit the declared shape bounds without truncation.');
    }
    const direction = node.layout?.direction ?? 'free', arranged = [];
    if (container && direction === 'free') {
      for (const child of descendants) {
        const frameX = child.x * GRID, frameY = child.y * GRID;
        if (frameX < padding || frameY < headerHeight + padding
          || frameX + child.w * GRID > capW - padding || frameY + child.h * GRID > capH - padding) {
          fail(child, 'Free placement exceeds the parent allocation, measured heading, or padding.');
        }
        const measured = measure(child, child.w * GRID, child.h * GRID, false, false, intrinsic);
        const dx = measured.container ? 0 : Math.floor((child.w * GRID - measured.w) / (2 * STEP)) * STEP;
        const dy = measured.container ? 0 : Math.floor((child.h * GRID - measured.h) / (2 * STEP)) * STEP;
        arranged.push({ ...measured, x: frameX + dx, y: frameY + dy });
      }
    } else if (container) {
      const horizontal = direction === 'horizontal', main = horizontal ? 'w' : 'h', cross = horizontal ? 'h' : 'w';
      const innerW = capW - padding * 2, innerH = capH - headerHeight - padding * 2;
      const mainSpace = horizontal ? innerW : innerH, crossSpace = horizontal ? innerH : innerW;
      const gap = (node.layout.gap ?? 1) * GRID;
      if (innerW < GRID || innerH < GRID) fail(node, 'The group heading and padding leave no room for its children.');
      const ordered = node.layout.order.map((id) => byId.get(id));
      const minima = ordered.map((child) => measure(child, innerW, innerH, false, false, true));
      const sizes = minima.map((child) => child[main]);
      let remaining = mainSpace - sizes.reduce((sum, size) => sum + size, 0) - gap * (ordered.length - 1);
      if (remaining < 0) fail(node, 'Ordered children exceed the group allocation. Increase the bound or reduce content/spacing.');
      // Distribute only available half-grid slots, respecting each child's bound.
      while (!intrinsic && remaining >= STEP) {
        let distributed = false;
        for (let index = 0; index < ordered.length && remaining >= STEP; index++) {
          if (!childSize(ordered[index], main) || sizes[index] + STEP > ordered[index][main] * GRID) continue;
          sizes[index] += STEP; remaining -= STEP; distributed = true;
        }
        if (!distributed) break;
      }
      let cursor = horizontal ? padding : headerHeight + padding;
      for (let index = 0; index < ordered.length; index++) {
        const child = ordered[index], crossBound = Math.min(child[cross] * GRID, crossSpace);
        const measured = intrinsic ? minima[index]
          : measure(child, horizontal ? sizes[index] : crossBound, horizontal ? crossBound : sizes[index],
            childSize(child, 'w'), childSize(child, 'h'));
        if (measured[main] > sizes[index] || measured[cross] > crossSpace) fail(child, 'Child content exceeds its resolved allocation.');
        const extra = crossSpace - measured[cross], align = node.layout.align ?? 'start';
        const offset = intrinsic ? 0 : align === 'end' ? extra : align === 'center' ? Math.floor(extra / (2 * STEP)) * STEP : 0;
        arranged.push({ ...measured, x: horizontal ? cursor : padding + offset,
          y: horizontal ? headerHeight + padding + offset : cursor });
        cursor += measured[main] + gap;
      }
    }
    let w = Math.max(GRID * 4, text.minimumW), h = Math.max(GRID * 3, text.minimumH,
      Math.min(capH, round((text.textHeight + 20) / (.64 * text.factor))));
    if (container) {
      w = Math.max(w, ...arranged.map((child) => child.x + child.w + padding));
      h = Math.max(headerHeight + padding * 2, ...arranged.map((child) => child.y + child.h + padding));
      if (intrinsic && direction === 'free') {
        w = Math.max(w, ...descendants.map((child) => (child.x + child.w) * GRID + padding));
        h = Math.max(h, ...descendants.map((child) => (child.y + child.h) * GRID + padding));
      }
    }
    if (node.shape === 'circle') w = h = Math.max(w, h);
    if (node.shape === 'diamond') h = Math.max(h, Math.min(capH, round(w * .65)));
    if (w > capW || h > capH) fail(node, 'Measured content exceeds its bounded allocation.');
    if (stretchW) w = capW;
    if (stretchH) h = capH;
    // Wrapping remains fixed after allocation; all visible text participates in the exclusion area.
    const safeW = w * text.factor, safeH = (container ? headerHeight : h) * text.factor;
    const topAligned = !container && node.body !== undefined && !['circle', 'diamond'].includes(node.shape);
    const textArea = { x: (w - safeW) / 2 + 12 + text.iconWidth,
      y: container ? (headerHeight - text.textHeight) / 2 : topAligned ? 12 : (h - safeH) / 2 + (safeH - text.textHeight) / 2,
      w: safeW - 24 - text.iconWidth, h: text.textHeight };
    if (textArea.w < text.textWidth || textArea.y < 0 || textArea.y + textArea.h > (container ? headerHeight : h)) {
      fail(node, 'The resolved shape does not contain its complete readable text.');
    }
    return { ...node, w, h, container, headerHeight, padding, blocks: text.blocks,
      lines: text.blocks[0].lines, textArea, topAligned, iconWidth: text.iconWidth, children: arranged };
  }
  const boxes = [];
  function place(tree, x, y, depth) {
    const { children: nested, ...node } = tree;
    boxes.push({ ...node, x, y, depth });
    for (const child of nested) place(child, x + child.x, y + child.y, depth + 1);
  }
  for (const node of sketch.boxes.filter((node) => !node.parent)) {
    const tree = measure(node);
    const dx = tree.container ? 0 : Math.floor((node.w * GRID - tree.w) / (2 * STEP)) * STEP;
    const dy = tree.container ? 0 : Math.floor((node.h * GRID - tree.h) / (2 * STEP)) * STEP;
    place(tree, node.x * GRID + gutter + dx, node.y * GRID + gutter + dy, 1);
  }
  const related = (a, b) => {
    for (let parent = a.parent; parent; parent = byId.get(parent).parent) if (parent === b.id) return true;
    for (let parent = b.parent; parent; parent = byId.get(parent).parent) if (parent === a.id) return true;
    return false;
  };
  for (const [index, box] of boxes.entries()) {
    if (box.x + box.w > gutter + MAX_EXTENT * GRID || box.y + box.h > gutter + MAX_EXTENT * GRID) fail(box, 'Resolved extent exceeds the document grid.');
    for (const other of boxes.slice(index + 1)) {
      if (related(box, other)) continue;
      if (box.x + box.w + GRID <= other.x || other.x + other.w + GRID <= box.x
        || box.y + box.h + GRID <= other.y || other.y + other.h + GRID <= box.y) continue;
      fail(box, `Resolved content overlaps or lacks the required gap from ${other.id}.`);
    }
  }
  return boxes.sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id));
}
