import type { SketchDocument } from "../sketch.js";
import type { UiState } from "./ui-context.js";

type ContextRecord = Record<string, string | number | boolean | null>;

function encodeContext(data: ContextRecord, label?: string): string {
  const encoder = new TextEncoder();
  let result = JSON.stringify(data);
  const characters = label ? Array.from(String(data[label])) : [];
  while (encoder.encode(result).length > 500 && label && characters.length) {
    characters.pop();
    data[label] = characters.join("");
    result = JSON.stringify(data);
  }
  if (encoder.encode(result).length > 500) throw new Error("Sketch voice context exceeds the Live message limit.");
  return result;
}

export function sketchLiveContext(state: UiState, document: SketchDocument | null,
  selectedScreen: string, selectedShape: string): string[] {
  const active = document?.screens.find((screen) => screen.id === selectedScreen) ?? document?.screens[0];
  const requirements = state.decisionGraph.nodes.filter((node) => node.status === "answered");
  // Each independent context record respects Live's 500-byte append limit.
  // The drawing worker still receives the complete scene and accepted requirements.
  const context = [
    encodeContext({
      kind: "sketch-context", prototypeId: state.prototypeId, generation: state.generation,
      revisionId: state.sketch.current?.id ?? null, totalRequirements: requirements.length,
      approval: "Only the user can approve drawings in the UI.",
    }),
    encodeContext({ kind: "goal", text: state.goal ?? "" }, "text"),
    ...requirements.slice(0, 4).map((node) =>
      encodeContext({ kind: "accepted-requirement", id: node.id, answer: node.answer ?? "" }, "answer")),
    ...(document?.screens ?? []).map((screen) => encodeContext({
      kind: "screen", id: screen.id, active: screen.id === active?.id, title: screen.title,
      width: screen.width, height: screen.height, totalShapes: screen.shapes.length,
    }, "title")),
  ];
  if (active) {
    const selection = active.shapes.find((shape) => shape.id === selectedShape);
    const shapes = [...(selection ? [selection] : []), ...active.shapes.filter((shape) => shape !== selection)].slice(0, 6);
    context.push(...shapes.map((shape) => encodeContext({
      kind: "shape", screenId: active.id, id: shape.id, selected: shape.id === selectedShape,
      shapeKind: shape.kind, x: shape.x, y: shape.y, width: shape.width, height: shape.height, text: shape.text,
      ...(shape.kind === "path" ? {
        curve: shape.curve ?? "linear", closed: shape.closed ?? false,
        ...(shape.curve === "catmull-rom" ? { tension: shape.tension ?? 0 } : {}),
      } : {}),
    }, "text")));
    context.push(encodeContext({
      kind: "scene-summary", shownShapes: shapes.length, totalShapes: active.shapes.length,
      shownRequirements: Math.min(requirements.length, 4), totalRequirements: requirements.length,
    }));
  }
  if (state.processing) context.push(encodeContext({
    kind: "drawing-work", action: state.processing.action, status: state.processing.status,
    requestId: state.processing.requestId ?? null,
  }));
  return context;
}
