import { BoardError, canonicalScene, fingerprint, operationsBetween } from "./scene.mjs";

export const CONNECTOR_META = "brainstormWhiteboard.authoring";
const META = CONNECTOR_META;
const sides = new Set(["left", "right", "top", "bottom"]);
const reject = (message) => { throw new BoardError(422, `Authoring helper: ${message}`); };
const find = (scene, id) => {
  const element = scene.elements.find((candidate) => candidate.id === id);
  if (!element) reject(`unknown element ${id}.`);
  return element;
};
function box(scene, id) {
  const node = find(scene, id);
  if (node.type !== "rectangle" || node.angle !== 0 || node.locked) reject(`${id} must be an unlocked, unrotated rectangle.`);
  return node;
}
function finish(before, elements) {
  return operationsBetween(before, canonicalScene({ elements }));
}
function refs(element, arrowId, include) {
  const remaining = element.boundElements.filter((entry) => entry.id !== arrowId);
  return include ? [...remaining, { id: arrowId, type: "arrow" }] : remaining;
}
function labelPosition(node, label) {
  const padding = 10;
  if (label.width > node.width - padding * 2 || label.height > node.height - padding * 2) {
    reject(`label ${label.id} does not fit the requested box. Use explicit line breaks/a larger box; automatic text wrapping is not provided.`);
  }
  const horizontal = label.textAlign === "left" ? padding : label.textAlign === "right" ? node.width - padding - label.width : (node.width - label.width) / 2;
  const vertical = label.verticalAlign === "top" ? padding : label.verticalAlign === "bottom" ? node.height - padding - label.height : (node.height - label.height) / 2;
  return { ...label, x: node.x + horizontal, y: node.y + vertical };
}
function anchor(node, side, gap) {
  if (!sides.has(side)) reject("connector sides must be left, right, top or bottom.");
  return {
    x: side === "left" ? node.x - gap : side === "right" ? node.x + node.width + gap : node.x + node.width / 2,
    y: side === "top" ? node.y - gap : side === "bottom" ? node.y + node.height + gap : node.y + node.height / 2,
  };
}
function connectorGeometry(scene, arrow, declaration) {
  const from = box(scene, declaration.fromId), to = box(scene, declaration.toId);
  if (from.frameId !== to.frameId || arrow.frameId !== from.frameId) reject("connectors between frames are unsupported; do not infer reparenting.");
  const startGap = arrow.startBinding?.gap ?? 8, endGap = arrow.endBinding?.gap ?? 8;
  const start = anchor(from, declaration.fromSide, startGap), end = anchor(to, declaration.toSide, endGap);
  return {
    ...arrow, x: start.x, y: start.y, width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y),
    points: [[0, 0], [end.x - start.x, end.y - start.y]],
    startBinding: { elementId: from.id, focus: 0, gap: startGap },
    endBinding: { elementId: to.id, focus: 0, gap: endGap },
  };
}
function simpleArrow(arrow) {
  if (arrow.type !== "arrow" || arrow.angle !== 0 || arrow.locked || arrow.elbowed ||
      arrow.points.length !== 2 || arrow.fixedSegments?.length || arrow.boundElements.length ||
      !arrow.startBinding || !arrow.endBinding || arrow.startBinding.focus !== 0 || arrow.endBinding.focus !== 0 ||
      arrow.startBinding.gap < 0 || arrow.endBinding.gap < 0) {
    reject(`${arrow.id} is not a simple unlocked, straight, center-bound arrow. Preserve it and edit explicitly.`);
  }
}
function declaredArrow(scene, arrow) {
  simpleArrow(arrow);
  const declaration = arrow.customData?.[META];
  if (declaration?.version !== 1 || declaration.fromId !== arrow.startBinding.elementId ||
      declaration.toId !== arrow.endBinding.elementId || !sides.has(declaration.fromSide) || !sides.has(declaration.toSide)) {
    reject(`${arrow.id} has no matching explicit anchor declaration (or was reconnected by a peer). Reconnect explicitly before helper geometry edits.`);
  }
  for (const [nodeId, side, binding, point] of [
    [declaration.fromId, declaration.fromSide, arrow.startBinding, arrow.points[0]],
    [declaration.toId, declaration.toSide, arrow.endBinding, arrow.points.at(-1)],
  ]) {
    const node = box(scene, nodeId), expected = anchor(node, side, binding.gap);
    const x = arrow.x + point[0], y = arrow.y + point[1];
    const horizontal = side === "left" || side === "right";
    // Validate the declared side, allowing native stroke/rounding offsets; never infer a new anchor.
    if (Math.abs(horizontal ? x - expected.x : y - expected.y) > 2 ||
        (horizontal ? y < node.y - 2 || y > node.y + node.height + 2 : x < node.x - 2 || x > node.x + node.width + 2)) {
      reject(`${arrow.id}'s native endpoint no longer matches its declared side. Reconnect it explicitly before helper geometry edits.`);
    }
  }
  return declaration;
}

export function addLabeledBox(input, options) {
  const scene = canonicalScene(input);
  const { id, labelId, text, x, y, width, height, groupIds = [], frameId = null,
    fill = "#edf3fb", stroke = "#2b456b", strokeWidth = 1.5, fontSize = 20, align = "center", vertical = "middle", customData } = options;
  if (scene.elements.some((element) => element.id === id || element.id === labelId) || id === labelId) reject("new box/label IDs must be different and unused.");
  if (typeof text !== "string" || !["left", "center", "right"].includes(align) || !["top", "middle", "bottom"].includes(vertical)) reject("use literal text and supported label alignment.");
  const node = {
    id, type: "rectangle", x, y, width, height, groupIds: [...groupIds], frameId,
    backgroundColor: fill, strokeColor: stroke, strokeWidth, fillStyle: "solid", roughness: 0,
    boundElements: [{ id: labelId, type: "text" }], ...(customData === undefined ? {} : { customData }),
  };
  const label = labelPosition(node, {
    id: labelId, type: "text", x, y, width: width - 20, height: text.split("\n").length * fontSize * 1.15,
    text, originalText: text, fontSize, fontFamily: 2, lineHeight: 1.15, autoResize: false,
    textAlign: align, verticalAlign: vertical, containerId: id, groupIds: [...groupIds], frameId, strokeColor: stroke,
  });
  return finish(scene, [...scene.elements, node, label]);
}

export function connectNodes(input, { id, fromId, toId, fromSide = "right", toSide = "left" }) {
  const scene = canonicalScene(input);
  if (fromId === toId) reject("self-loops require explicit native editing.");
  const from = box(scene, fromId), to = box(scene, toId);
  const existing = scene.elements.find((element) => element.id === id);
  if (existing) simpleArrow(existing);
  const declaration = { version: 1, fromId, toId, fromSide, toSide };
  const arrow = connectorGeometry(scene, {
    ...(existing ?? { id, type: "arrow", angle: 0, locked: false, elbowed: false,
      endArrowhead: "arrow", strokeColor: "#526b8b", strokeWidth: 1.25, roughness: 0, frameId: from.frameId }),
    customData: { ...existing?.customData, [META]: declaration },
  }, declaration);
  const elements = scene.elements.map((element) => {
    if (element.id === id) return arrow;
    if (element.id === fromId || element.id === toId) return { ...element, boundElements: refs(element, id, true) };
    if (existing && [existing.startBinding.elementId, existing.endBinding.elementId].includes(element.id)) {
      return { ...element, boundElements: refs(element, id, false) };
    }
    return element;
  });
  if (!existing) elements.push(arrow);
  return finish(scene, elements);
}

export function renameLabel(input, labelId, text) {
  const scene = canonicalScene(input), label = find(scene, labelId);
  if (label.type !== "text" || !label.containerId || label.angle !== 0 || label.locked || label.boundElements.length || typeof text !== "string") reject("rename an explicit unlocked bound text ID without its own connectors; standalone annotations are not guessed.");
  const node = box(scene, label.containerId);
  const next = labelPosition(node, { ...label, text, originalText: text, height: text.split("\n").length * label.fontSize * label.lineHeight });
  return finish(scene, scene.elements.map((element) => element.id === labelId ? next : element));
}

export function moveResizeNode(input, id, geometry) {
  const scene = canonicalScene(input), node = box(scene, id);
  if (!geometry || Object.keys(geometry).some((key) => !["x", "y", "width", "height"].includes(key)) ||
      Object.values(geometry).some((value) => !Number.isFinite(value))) reject("geometry accepts only finite x, y, width and height.");
  const updated = { ...node, ...geometry };
  if (updated.width <= 20 || updated.height <= 20) reject("a labeled box must remain larger than its padding.");
  if (node.frameId) {
    const frame = find(scene, node.frameId);
    if (frame.locked || frame.angle !== 0 || updated.x < frame.x || updated.y < frame.y ||
        updated.x + updated.width > frame.x + frame.width || updated.y + updated.height > frame.y + frame.height) {
      reject("keep the requested node inside its existing unlocked, unrotated frame.");
    }
  }
  const labels = node.boundElements.filter((binding) => binding.type === "text").map((binding) => find(scene, binding.id));
  if (labels.length > 1 || labels.some((label) => label.angle !== 0 || label.locked || label.boundElements.length ||
      label.frameId !== node.frameId)) reject("complex/locked labels require explicit native editing.");
  const replacements = new Map([[id, updated]]);
  for (const label of labels) replacements.set(label.id, labelPosition(updated, label));
  const staged = { ...scene, elements: scene.elements.map((element) => replacements.get(element.id) ?? element) };
  for (const reference of node.boundElements.filter((binding) => binding.type === "arrow")) {
    const arrow = find(scene, reference.id);
    replacements.set(arrow.id, connectorGeometry(staged, arrow, declaredArrow(scene, arrow)));
  }
  return finish(scene, scene.elements.map((element) => replacements.get(element.id) ?? element));
}

export function deleteNode(input, id) {
  const scene = canonicalScene(input), node = box(scene, id);
  const removed = new Set([id]);
  for (const reference of node.boundElements) {
    const element = find(scene, reference.id);
    if (element.locked) reject(`associated element ${element.id} is locked.`);
    removed.add(element.id);
    if (element.type === "arrow") {
      for (const binding of element.boundElements) {
        const label = find(scene, binding.id);
        if (binding.type !== "text" || label.locked) reject("complex arrow associations require explicit native editing.");
        removed.add(label.id);
      }
    }
  }
  return finish(scene, scene.elements.filter((element) => !removed.has(element.id)).map((element) => {
    const boundElements = element.boundElements.filter((binding) => !removed.has(binding.id));
    return fingerprint(boundElements) === fingerprint(element.boundElements) ? element : { ...element, boundElements };
  }));
}
