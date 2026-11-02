import { randomUUID } from "node:crypto";
import { BoardError, canonicalScene, fingerprint, isRecord, sceneDiff } from "./scene.mjs";
const freeze = (value) => {
  if (value && typeof value === "object") { Object.freeze(value); for (const child of Object.values(value)) freeze(child); }
  return value;
};
export function createBoard() {
  let working = freeze({ versionId: `v-${randomUUID()}`, scene: canonicalScene({ elements: [] }) });
  const seals = new Map([[working.versionId, working]]);
  let latest = working.versionId;
  const pending = () => working.versionId !== latest;
  const expected = (versionId) => {
    if (versionId !== working.versionId) throw new BoardError(409, "Working version changed. Read the next sealed handoff/reconcile; do not blindly replace expectedVersionId.");
  };
  const exactSeal = (versionId) => {
    const snapshot = seals.get(versionId);
    if (!snapshot) throw new BoardError(404, "Version is unavailable or unsealed; no draft substitution was made.");
    return snapshot;
  };
  return {
    state() { return structuredClone({ ...working, latestSealedVersionId: latest, hasUnsealedChanges: pending(), sealedCount: seals.size }); },
    read(input = {}) {
      if (!isRecord(input) || Object.keys(input).some((key) => !["target", "compareTo", "includeImage"].includes(key))) throw new BoardError(400, "Invalid read parameters.");
      const target = "target" in input ? input.target : "latest";
      if (typeof target !== "string" || !target || input.includeImage !== undefined && typeof input.includeImage !== "boolean") throw new BoardError(400, "Invalid read target/image flag.");
      const snapshot = exactSeal(target === "latest" ? latest : target);
      const result = { ...structuredClone(snapshot), sealed: true, hasUnsealedChanges: pending() };
      if (input.compareTo !== undefined) {
        if (typeof input.compareTo !== "string" || input.compareTo === "latest") throw new BoardError(400, "compareTo must name an exact sealed versionId.");
        const baseline = exactSeal(input.compareTo);
        result.compareTo = baseline.versionId;
        result.changes = sceneDiff(baseline.scene, snapshot.scene);
      }
      return result;
    },
    edit(input) {
      if (!isRecord(input) || Object.keys(input).some((key) => !["expectedVersionId", "expectedLatestSealedVersionId", "operations"].includes(key)) || !Array.isArray(input.operations)) throw new BoardError(400, "Use edit({expectedVersionId,operations}).");
      expected(input.expectedVersionId);
      if ("expectedLatestSealedVersionId" in input && input.expectedLatestSealedVersionId !== latest) {
        throw new BoardError(409, "Latest sealed version changed. Inspect it again before discarding working changes.");
      }
      const elements = structuredClone(working.scene.elements);
      for (const operation of input.operations) {
        if (!isRecord(operation)) throw new BoardError(422, "Each edit operation must be an object.");
        const index = elements.findIndex((element) => element.id === operation.id);
        if (operation.op === "add") {
          if (Object.keys(operation).some((key) => !["op", "element", "position"].includes(key)) || !isRecord(operation.element) ||
              elements.some((element) => element.id === operation.element.id)) throw new BoardError(422, "Invalid or duplicate add.");
          const position = operation.position ?? elements.length;
          if (!Number.isInteger(position) || position < 0 || position > elements.length) throw new BoardError(422, "Invalid add position.");
          elements.splice(position, 0, structuredClone(operation.element));
        } else if (operation.op === "update") {
          if (Object.keys(operation).some((key) => !["op", "id", "set", "position"].includes(key)) || index < 0 ||
              !isRecord(operation.set) || "id" in operation.set || "type" in operation.set) throw new BoardError(422, "Unknown ID or invalid update; IDs/types are stable.");
          Object.assign(elements[index], structuredClone(operation.set));
          if (operation.set.text !== undefined && operation.set.originalText === undefined) elements[index].originalText = operation.set.text;
          if (operation.position !== undefined) {
            if (!Number.isInteger(operation.position) || operation.position < 0 || operation.position >= elements.length) throw new BoardError(422, "Invalid update position.");
            const [element] = elements.splice(index, 1); elements.splice(operation.position, 0, element);
          }
        } else if (operation.op === "remove") {
          if (Object.keys(operation).some((key) => !["op", "id"].includes(key)) || index < 0) throw new BoardError(422, "Unknown remove ID.");
          elements.splice(index, 1);
        } else throw new BoardError(422, "Only add, update and remove are supported.");
      }
      const scene = canonicalScene({ elements });
      if (fingerprint(scene) === fingerprint(working.scene)) return { ...this.state(), effects: { added: [], removed: [], changed: [] } };
      const effects = sceneDiff(working.scene, scene);
      working = freeze({ versionId: `v-${randomUUID()}`, scene });
      return { ...this.state(), effects };
    },
    seal(input) {
      if (!isRecord(input) || Object.keys(input).some((key) => key !== "expectedVersionId")) throw new BoardError(400, "Use seal({expectedVersionId}).");
      expected(input.expectedVersionId);
      if (!seals.has(working.versionId)) seals.set(working.versionId, freeze(structuredClone(working)));
      latest = working.versionId;
      return { versionId: latest, sealed: true, hasUnsealedChanges: false };
    },
  };
}
