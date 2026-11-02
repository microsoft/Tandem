export class BoardError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (message) => { throw new BoardError(422, message); };
export const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const types = new Set(["rectangle", "diamond", "ellipse", "text", "line", "arrow", "freedraw", "frame"]);
const ignored = new Set(["version", "versionNonce", "updated", "index", "lastCommittedPoint"]);
const fields = new Set([
  "id", "type", "x", "y", "width", "height", "angle", "strokeColor", "backgroundColor", "fillStyle",
  "strokeWidth", "strokeStyle", "roughness", "opacity", "groupIds", "frameId", "roundness", "seed",
  "isDeleted", "boundElements", "link", "locked", "customData", "text", "originalText", "fontSize",
  "fontFamily", "lineHeight", "textAlign", "verticalAlign", "containerId", "autoResize", "points",
  "pressures", "simulatePressure", "startBinding", "endBinding", "startArrowhead", "endArrowhead",
  "elbowed", "fixedSegments", "startIsSpecial", "endIsSpecial", "name",
]);
const numeric = ["x", "y", "width", "height", "angle", "strokeWidth", "roughness", "opacity", "seed", "fontSize", "fontFamily", "lineHeight"];
export function canonicalElement(input) {
  if (!isRecord(input)) fail("An element must be a native JSON object.");
  for (const key of Object.keys(input)) if (!fields.has(key) && !ignored.has(key)) fail(`Unsupported native field: ${key}`);
  if (typeof input.id !== "string" || !input.id || input.id.length > 200) fail("A stable nonempty element id is required.");
  if (!types.has(input.type)) fail(`Unsupported element type: ${input.type}. Use native shapes, text, arrows and ink, not images/embeds.`);
  for (const key of ["x", "y", "width", "height"]) if (!Number.isFinite(input[key])) fail(`Finite ${key} is required for ${input.id}.`);
  for (const key of numeric) if (input[key] !== undefined && !Number.isFinite(input[key])) fail(`Invalid ${key} for ${input.id}.`);
  if (input.width < 0 || input.height < 0 || input.isDeleted === true) fail("Remove objects with a remove operation; dimensions must be nonnegative.");
  const element = {
    angle: 0, strokeColor: "#1e1e1e", backgroundColor: "transparent", fillStyle: "solid",
    strokeWidth: 2, strokeStyle: "solid", roughness: 0, opacity: 100, groupIds: [], frameId: null,
    roundness: null, seed: 1, isDeleted: false, boundElements: [], link: null, locked: false,
    ...Object.fromEntries(Object.entries(structuredClone(input)).filter(([key]) => !ignored.has(key))),
    version: 1, versionNonce: 1, updated: 0, index: null,
  };
  element.boundElements = element.boundElements ?? [];
  if (Array.isArray(element.boundElements)) element.boundElements = [...element.boundElements].sort((a, b) => String(a?.id).localeCompare(String(b?.id)));
  if (element.opacity < 0 || element.opacity > 100 || element.strokeWidth < 0) fail("Invalid opacity/stroke width.");
  for (const key of ["strokeColor", "backgroundColor"]) if (typeof element[key] !== "string") fail(`Invalid ${key}.`);
  if (!["solid", "hachure", "cross-hatch", "zigzag"].includes(element.fillStyle) ||
      !["solid", "dashed", "dotted"].includes(element.strokeStyle)) fail("Unsupported fill/stroke style.");
  if (!Array.isArray(element.groupIds) || !element.groupIds.every((id) => typeof id === "string")) fail("Invalid groupIds.");
  if (element.customData !== undefined && !isRecord(element.customData)) fail("customData must be an object.");
  for (const key of ["locked", "autoResize", "simulatePressure", "elbowed", "startIsSpecial", "endIsSpecial"]) {
    if (element[key] !== undefined && typeof element[key] !== "boolean") fail(`Invalid ${key}.`);
  }
  if (element.type === "text") {
    if (typeof element.text !== "string") fail("Text content is required.");
    Object.assign(element, {
      fontSize: element.fontSize ?? 20, fontFamily: element.fontFamily ?? 2, lineHeight: element.lineHeight ?? 1.15,
      textAlign: element.textAlign ?? "left", verticalAlign: element.verticalAlign ?? "top",
      autoResize: element.autoResize ?? true, containerId: element.containerId ?? null,
      originalText: element.originalText ?? element.text,
    });
    if (element.fontSize <= 0 || element.lineHeight <= 0 || typeof element.originalText !== "string") fail("Invalid text metrics.");
  }
  if (["arrow", "line", "freedraw"].includes(element.type)) {
    if (!Array.isArray(element.points) || element.points.length > 30_000 ||
        !element.points.every((point) => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite))) fail("Invalid native points.");
    element.lastCommittedPoint = null;
    if (element.type === "freedraw") {
      element.pressures ??= [];
      element.simulatePressure ??= true;
      if (!Array.isArray(element.pressures) || !element.pressures.every(Number.isFinite)) fail("Invalid stroke pressures.");
    } else {
      element.startBinding ??= null; element.endBinding ??= null;
      element.startArrowhead ??= null; element.endArrowhead ??= element.type === "arrow" ? "arrow" : null;
      if (element.type === "arrow") element.elbowed ??= false;
    }
  }
  return element;
}

export function canonicalScene(input) {
  if (!isRecord(input) || !Array.isArray(input.elements) || input.elements.length > 3000) fail("A scene needs at most 3000 native elements.");
  if (input.files && Object.keys(input.files).length) fail("Raster assets are outside this first native-only prototype.");
  const elements = input.elements.map(canonicalElement);
  const byId = new Map(elements.map((element) => [element.id, element]));
  if (byId.size !== elements.length) fail("Duplicate element IDs.");
  for (const element of elements) {
    if (element.frameId && byId.get(element.frameId)?.type !== "frame") fail(`Missing frame for ${element.id}.`);
    const ancestors = new Set([element.id]);
    for (let frame = element.frameId; frame; frame = byId.get(frame)?.frameId) {
      if (ancestors.has(frame)) fail(`Cyclic frame relationship for ${element.id}.`);
      ancestors.add(frame);
    }
    if (element.type === "text" && element.containerId) {
      const container = byId.get(element.containerId);
      if (!container || !["rectangle", "diamond", "ellipse", "arrow"].includes(container.type)) fail(`Invalid text container for ${element.id}.`);
      if (!container.boundElements?.some((binding) => binding.id === element.id && binding.type === "text")) fail(`Missing reciprocal text binding for ${element.id}.`);
    }
    if (element.boundElements !== null) {
      if (!Array.isArray(element.boundElements) || !element.boundElements.every((binding) =>
        isRecord(binding) && typeof binding.id === "string" && ["text", "arrow"].includes(binding.type) && byId.get(binding.id)?.type === binding.type)) fail(`Invalid boundElements for ${element.id}.`);
      for (const binding of element.boundElements) {
        const child = byId.get(binding.id);
        if (binding.type === "text" ? child.containerId !== element.id :
          child.startBinding?.elementId !== element.id && child.endBinding?.elementId !== element.id) fail(`Nonreciprocal binding for ${element.id}.`);
      }
    }
    for (const key of ["startBinding", "endBinding"]) {
      const binding = element[key];
      if (binding) {
        const target = byId.get(binding.elementId);
        if (!isRecord(binding) || !target || !["rectangle", "diamond", "ellipse", "text", "frame"].includes(target.type) ||
            !Number.isFinite(binding.focus) || !Number.isFinite(binding.gap) ||
            !target.boundElements?.some((entry) => entry.id === element.id && entry.type === "arrow")) fail(`Invalid reciprocal ${key} for ${element.id}.`);
      }
    }
  }
  return { elements, files: {}, appState: { viewBackgroundColor: "#ffffff" } };
}
function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])]));
  return value;
}
export const fingerprint = (value) => JSON.stringify(sorted(value));
function fieldChanges(before, after, path = "", result = []) {
  for (const key of new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])) {
    if (!path && (ignored.has(key) || key === "id")) continue;
    const a = before?.[key], b = after?.[key], name = path ? `${path}.${key}` : key;
    if (fingerprint(a) === fingerprint(b)) continue;
    if (isRecord(a) && isRecord(b)) fieldChanges(a, b, name, result);
    else result.push({ path: name, before: a ?? null, after: b ?? null });
  }
  return result;
}
export function sceneDiff(before, after) {
  const a = new Map(before.elements.map((element) => [element.id, element]));
  const b = new Map(after.elements.map((element) => [element.id, element]));
  const added = after.elements.filter((element) => !a.has(element.id));
  const removed = before.elements.filter((element) => !b.has(element.id));
  const changed = after.elements.filter((element) => a.has(element.id))
    .map((element) => ({ id: element.id, fields: fieldChanges(a.get(element.id), element) })).filter((change) => change.fields.length);
  const oldCommon = before.elements.map((element) => element.id).filter((id) => b.has(id));
  const newCommon = after.elements.map((element) => element.id).filter((id) => a.has(id));
  if (fingerprint(oldCommon) !== fingerprint(newCommon)) {
    for (const id of newCommon) {
      if (oldCommon.indexOf(id) === newCommon.indexOf(id)) continue;
      let change = changed.find((entry) => entry.id === id);
      if (!change) { change = { id, fields: [] }; changed.push(change); }
      change.fields.push({ path: "zOrder", before: oldCommon.indexOf(id), after: newCommon.indexOf(id) });
    }
  }
  return { added, removed, changed };
}
export function operationsBetween(before, after) {
  const old = new Map(before.elements.map((element) => [element.id, element]));
  const now = new Map(after.elements.map((element) => [element.id, element]));
  const reconstruct = new Set(after.elements.filter((element) => old.has(element.id) &&
    (old.get(element.id).type !== element.type || Object.keys(old.get(element.id)).some((key) =>
      !ignored.has(key) && !(key in element)))).map((element) => element.id));
  const operations = before.elements.filter((element) => !now.has(element.id) || reconstruct.has(element.id))
    .map((element) => ({ op: "remove", id: element.id }));
  for (const [position, element] of after.elements.entries()) {
    // Reconstruct only an object whose removed native fields cannot be expressed with set.
    if (!old.has(element.id) || reconstruct.has(element.id)) operations.push({ op: "add", element, position });
    else {
      const set = Object.fromEntries(Object.entries(element).filter(([key, value]) => key !== "id" && key !== "type" &&
        !ignored.has(key) && fingerprint(value) !== fingerprint(old.get(element.id)[key])));
      if (Object.keys(set).length || before.elements.findIndex((entry) => entry.id === element.id) !== position) {
        operations.push({ op: "update", id: element.id, set, position });
      }
    }
  }
  return operations;
}
export function editorOperationsBetween(before, after) {
  const operations = operationsBetween(before, after);
  const elements = new Map(after.elements.map((element) => [element.id, element]));
  for (const operation of operations) {
    if (operation.op !== "update") continue;
    const element = elements.get(operation.id);
    if (["line", "arrow"].includes(element.type) &&
        ["x", "y", "width", "height", "angle", "points"].some((key) => key in operation.set)) {
      // Native restoration rebases paths to their first point. Keep origin and points in one coordinate basis.
      for (const key of ["x", "y", "width", "height", "angle", "points"]) operation.set[key] = element[key];
    }
  }
  return operations;
}
export function latestSealedEdit(working, sealed) {
  if (!isRecord(sealed) || sealed.sealed !== true || typeof sealed.versionId !== "string" ||
      sealed.versionId !== working.latestSealedVersionId) {
    throw new BoardError(409, "Latest sealed version changed since this working view. Inspect it again before resetting.");
  }
  return {
    expectedVersionId: working.versionId,
    expectedLatestSealedVersionId: sealed.versionId,
    operations: operationsBetween(working.scene, canonicalScene(sealed.scene)),
  };
}
