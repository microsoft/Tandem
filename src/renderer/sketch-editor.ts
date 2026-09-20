import { renderSketchSvg, validateSketchDocument, validSketchDimension } from "../sketch.js";
import type { SketchDocument, SketchScreen, SketchShape } from "../sketch.js";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const slug = (prefix: string, ids: string[]) => {
  let index = 1;
  while (ids.includes(`${prefix}-${index}`)) index++;
  return `${prefix}-${index}`;
};

export const SKETCH_SIZE_PRESETS = [
  { id: "tandem", label: "Tandem default", width: 960, height: 640 },
  { id: "default", label: "VisionLoop default", width: 1000, height: 650 },
  { id: "hd-landscape", label: "HD landscape", width: 1920, height: 1080 },
  { id: "hd-portrait", label: "HD portrait", width: 1080, height: 1920 },
  { id: "square", label: "Square", width: 1080, height: 1080 },
  { id: "presentation", label: "Presentation (4:3)", width: 1024, height: 768 },
  { id: "a4-portrait", label: "A4 portrait (96 dpi)", width: 794, height: 1123 },
  { id: "a4-landscape", label: "A4 landscape (96 dpi)", width: 1123, height: 794 },
] as const;

export function resizeScreen(screen: SketchScreen, width: number, height: number): void {
  if (!validSketchDimension(width) || !validSketchDimension(height)) {
    throw new Error("Canvas dimensions must be whole numbers from 1 to 10,000.");
  }
  screen.width = width;
  screen.height = height;
}

export function createScreen(document: SketchDocument, decisionIds: string[]): SketchScreen {
  return {
    id: slug("screen", document.screens.map((screen) => screen.id)),
    title: `Screen ${document.screens.length + 1}`, purpose: "Support the selected requirements.", notes: "", decisionIds: [...decisionIds],
    width: 960, height: 640, shapes: [],
  };
}

export function createShape(screen: SketchScreen, kind: SketchShape["kind"]): SketchShape {
  const x = Math.min(40, screen.width / 4);
  const y = Math.min(40, screen.height / 4);
  const width = Math.min(160, screen.width - x);
  const height = Math.min(kind === "text" ? 40 : 80, screen.height - y);
  return {
    id: slug(kind, screen.shapes.map((shape) => shape.id)), kind, x, y, width, height,
    text: kind === "text" ? "Label" : "", stroke: kind === "text" ? "none" : "#333333",
    fill: kind === "text" ? "#333333" : ["rectangle", "ellipse"].includes(kind) ? "#eeeeee" : "none", fontSize: 16,
    points: ["line", "arrow", "path"].includes(kind) ? [{ x, y }, { x: x + width, y: y + height }] : [],
  };
}

export function shapeBounds(shape: SketchShape): Pick<SketchShape, "x" | "y" | "width" | "height"> {
  if (!shape.points.length) return { x: shape.x, y: shape.y, width: shape.width, height: shape.height };
  // Point geometry is authoritative for strokes; valid documents may declare a different box.
  const xs = shape.points.map((point) => point.x), ys = shape.points.map((point) => point.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export function setShapeBounds(screen: SketchScreen, shape: SketchShape,
  bounds: Partial<Pick<SketchShape, "x" | "y" | "width" | "height">>): SketchShape {
  if (Object.values(bounds).some((value) => !Number.isFinite(value))) throw new Error("Dimensions must be finite numbers.");
  const original = shapeBounds(shape);
  // Editing one axis must not truncate geometry hidden by a smaller canvas.
  const extentWidth = Math.max(screen.width, original.x + original.width);
  const extentHeight = Math.max(screen.height, original.y + original.height);
  const minimum = ["rectangle", "ellipse", "text"].includes(shape.kind) ? 1 : 0;
  const width = clamp(bounds.width ?? original.width, minimum, extentWidth);
  const height = clamp(bounds.height ?? original.height, minimum, extentHeight);
  const x = clamp(bounds.x ?? original.x, 0, extentWidth - width);
  const y = clamp(bounds.y ?? original.y, 0, extentHeight - height);
  return {
    ...shape, x, y, width, height,
    points: shape.points.map((point, index) => ({
      x: clamp(x + (original.width ? (point.x - original.x) / original.width : index / (shape.points.length - 1)) * width, 0, extentWidth),
      y: clamp(y + (original.height ? (point.y - original.y) / original.height : index / (shape.points.length - 1)) * height, 0, extentHeight),
    })),
  };
}

export class SketchEditor {
  document: SketchDocument | null = null;
  private saved = "null";
  private past: (SketchDocument | null)[] = [];
  private future: (SketchDocument | null)[] = [];
  get dirty() { return JSON.stringify(this.document) !== this.saved; }
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  load(document: SketchDocument | null) {
    this.document = document ? validateSketchDocument(clone(document)) : null;
    this.saved = JSON.stringify(this.document);
    this.past = [];
    this.future = [];
  }
  markSaved() { this.saved = JSON.stringify(this.document); }
  edit(change: (document: SketchDocument) => void) {
    const next = clone(this.document || { version: 1, screens: [], transitions: [] } as SketchDocument);
    change(next);
    validateSketchDocument(next);
    if (JSON.stringify(next) === JSON.stringify(this.document)) return;
    this.past.push(clone(this.document));
    if (this.past.length > 50) this.past.shift();
    this.future = [];
    this.document = next;
  }
  undo() {
    if (!this.canUndo) return;
    this.future.push(clone(this.document));
    this.document = this.past.pop()!;
  }
  redo() {
    if (!this.canRedo) return;
    this.past.push(clone(this.document));
    this.document = this.future.pop()!;
  }
}

export async function renderSketchPng(screen: SketchScreen): Promise<{ screenId: string; data: string }> {
  if (typeof Image === "undefined") throw new Error("PNG export is unavailable in this browser. Drawings were not approved.");
  const canvas = document.createElement("canvas");
  canvas.width = screen.width;
  canvas.height = screen.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("PNG export is unavailable in this browser. Drawings were not approved.");
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("PNG export timed out. Drawings were not approved.")), 15000);
    image.onload = () => { clearTimeout(timer); resolve(); };
    image.onerror = () => { clearTimeout(timer); reject(new Error("Could not render the drawing for PNG export.")); };
    image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(renderSketchSvg(screen));
  });
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const data = canvas.toDataURL("image/png");
  if (!data.startsWith("data:image/png;base64,") || data.length <= 22) {
    throw new Error("PNG export failed. Drawings were not approved.");
  }
  return { screenId: screen.id, data: data.slice("data:image/png;base64,".length) };
}
