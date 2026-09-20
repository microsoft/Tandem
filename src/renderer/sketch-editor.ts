import { renderSketchSvg, validateSketchDocument } from "../sketch.js";
import type { SketchDocument, SketchScreen, SketchShape } from "../sketch.js";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const slug = (prefix: string, ids: string[]) => {
  let index = 1;
  while (ids.includes(`${prefix}-${index}`)) index++;
  return `${prefix}-${index}`;
};

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
  const minimum = ["rectangle", "ellipse", "text"].includes(shape.kind) ? 1 : 0;
  const width = clamp(bounds.width ?? original.width, minimum, screen.width);
  const height = clamp(bounds.height ?? original.height, minimum, screen.height);
  const x = clamp(bounds.x ?? original.x, 0, screen.width - width);
  const y = clamp(bounds.y ?? original.y, 0, screen.height - height);
  return {
    ...shape, x, y, width, height,
    points: shape.points.map((point, index) => ({
      x: clamp(x + (original.width ? (point.x - original.x) / original.width : index / (shape.points.length - 1)) * width, 0, screen.width),
      y: clamp(y + (original.height ? (point.y - original.y) / original.height : index / (shape.points.length - 1)) * height, 0, screen.height),
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

interface WorkspaceHooks {
  post: (path: string, body: unknown) => Promise<any>;
  changed: () => void;
  canEdit: () => boolean;
  blocked: () => boolean;
  guidance: () => string;
}

export class SketchWorkspace {
  readonly editor = new SketchEditor();
  private elements: Record<string, any> = {};
  private state: any;
  private identity = "";
  private baseRevision: string | null = null;
  private loadedKey: string | null = null;
  private failedKey: string | null = null;
  private request = 0;
  private loading = false;
  busy = false;
  private conflict = false;
  private message = "";
  private selectedScreen = "";
  private selectedShape = "";
  private fieldDrafts = new Map<string, string>();
  private drawing = false;
  private pointer: {
    id: number; x: number; y: number; screen: SketchScreen; shape: SketchShape | null;
    points: { x: number; y: number }[]; moved: SketchShape | null;
  } | null = null;

  constructor(private root: HTMLElement, private hooks: WorkspaceHooks) {
    for (const node of root.querySelectorAll<HTMLElement>("[id]")) this.elements[node.id.replace("sketch-", "")] = node;
    this.on("generate", "click", () => this.submit("generate"));
    this.on("revise-form", "submit", (event) => { event.preventDefault(); return this.submit("revise"); });
    this.on("retry-revision", "click", () => this.submit("revise", this.failedInstruction()));
    this.on("save", "click", () => this.submit("save"));
    this.on("approve", "click", () => this.submit("approve"));
    this.on("reload", "click", () => this.reload());
    this.on("add-screen", "click", () => this.edit((document) => {
      const screen = createScreen(document, this.acceptedDecisionIds().slice(0, 200));
      document.screens.push(screen);
      this.selectedScreen = screen.id;
      this.selectedShape = "";
    }));
    this.on("undo", "click", () => { if (this.writable()) this.undo(); });
    this.on("redo", "click", () => { if (this.writable()) { this.editor.redo(); this.changed(); } });
    this.on("delete-shape", "click", () => this.updateScreen((screen) => {
      screen.shapes = screen.shapes.filter((shape) => shape.id !== this.selectedShape);
    }));
    for (const kind of ["rectangle", "ellipse", "text", "line", "arrow"] as const) {
      this.on("add-" + kind, "click", () => this.edit((document) => {
        const screen = document.screens.find((item) => item.id === this.selectedScreen)!;
        const shape = createShape(screen, kind);
        screen.shapes.push(shape);
        this.selectedShape = shape.id;
        this.drawing = false;
      }));
    }
    this.on("freehand", "click", () => {
      if (!this.writable() || !this.screen()) return;
      this.drawing = !this.drawing;
      this.changed();
    });
    for (const field of ["title", "purpose", "notes"] as const) {
      this.on(field, "input", () => {
        if (!this.writable()) return;
        const key = this.selectedScreen + ":" + field;
        const value = this.elements[field].value;
        this.fieldDrafts.set(key, value);
        this.edit((document) => {
          document.screens.find((screen) => screen.id === this.selectedScreen)![field] = value;
        }, () => this.fieldDrafts.delete(key));
      });
    }
    this.on("decisions", "change", () => this.updateScreen((screen) => {
      screen.decisionIds = this.elements.decisions.value.split(",").map((id: string) => id.trim()).filter(Boolean);
    }));
    for (const field of ["x", "y", "width", "height"] as const) {
      this.on(field, "change", () => this.updateShape((shape, screen) =>
        setShapeBounds(screen, shape, { [field]: Number(this.elements[field].value) })));
    }
    this.on("text", "input", () => this.updateShape((shape) => ({ ...shape, text: this.elements.text.value })));
    this.on("font-size", "change", () => this.updateShape((shape) => ({ ...shape, fontSize: Number(this.elements["font-size"].value) })));
    for (const field of ["fill", "stroke"] as const) {
      this.on(field, "change", () => this.updateShape((shape) => ({ ...shape, [field]: this.elements[field].value })));
    }
    this.on("add-transition", "click", () => this.edit((document) => {
      document.transitions.push({
        id: slug("transition", document.transitions.map((item) => item.id)),
        fromScreenId: this.selectedScreen, toScreenId: document.screens.find((screen) => screen.id !== this.selectedScreen)?.id || this.selectedScreen,
        trigger: "Continue", description: "",
      });
    }));
    this.on("instruction", "input", () => this.changed());
    this.on("board", "pointerdown", (event) => this.pointerDown(event));
    this.on("board", "pointermove", (event) => this.pointerMove(event));
    this.on("board", "pointerup", (event) => this.pointerUp(event));
    for (const event of ["pointercancel", "lostpointercapture"]) this.on("board", event, () => {
      if (!this.pointer) return;
      this.pointer = null;
      this.changed();
    });
    root.addEventListener("keydown", (event) => this.keydown(event));
    window.addEventListener("beforeunload", (event) => {
      if (!this.dirty) return;
      event.preventDefault();
      event.returnValue = "";
    });
  }

  private on(id: string, event: string, callback: (event: any) => unknown) {
    this.elements[id].addEventListener(event, callback);
  }
  get dirty() { return this.editor.dirty || Boolean(this.pointer) || this.fieldDrafts.size > 0; }
  get completionBlocked() {
    const sketch = this.state?.sketch;
    return this.busy || this.loading || this.dirty || this.conflict || this.loadedKey !== this.key()
      || this.failedKey === this.key() || this.hasEmptyScreens() || sketch?.status !== "approved"
      || !sketch.current || sketch.approved?.revisionId !== sketch.current.id
      || sketch.approved?.documentHash !== sketch.current.documentHash
      || sketch.approved?.requirementsDigest !== sketch.current.requirementsDigest;
  }
  reset() {
    this.request++;
    this.editor.load(null);
    this.baseRevision = null;
    this.loadedKey = this.failedKey = null;
    this.message = "";
    this.conflict = this.loading = this.busy = false;
    this.pointer = null;
    this.fieldDrafts.clear();
    this.selectedScreen = this.selectedShape = "";
    this.elements.instruction.value = "";
  }
  private key() { return JSON.stringify([this.identity, this.state?.sketch?.current?.id ?? null]); }
  private writable() {
    return this.hooks.canEdit() && !this.hooks.blocked() && !this.busy && !this.loading && !this.pointer
      && this.loadedKey !== null && this.failedKey !== this.key();
  }
  private screen() { return this.editor.document?.screens.find((screen) => screen.id === this.selectedScreen); }
  private shape() { return this.screen()?.shapes.find((shape) => shape.id === this.selectedShape); }
  private acceptedDecisionIds(): string[] {
    return (this.state?.decisionGraph?.nodes || [])
      .filter((node: any) => node.status === "answered" && typeof node.answer === "string" && node.answer.trim())
      .map((node: any) => node.id);
  }
  private hasEmptyScreens() { return !this.editor.document || this.editor.document.screens.some((screen) => !screen.shapes.length); }
  private failedInstruction() {
    const processing = this.state?.processing;
    return processing?.action === "revise-sketch" && processing.status === "error" && typeof processing.answer === "string"
      ? processing.answer.trim() : "";
  }
  private changed() { this.hooks.changed(); }
  private edit(change: (document: SketchDocument) => void, accepted?: () => void) {
    if (!this.writable()) return;
    try {
      this.editor.edit(change);
      accepted?.();
      this.message = "";
    } catch (error) { this.message = error instanceof Error ? error.message : "Invalid drawing."; }
    this.changed();
  }
  private updateScreen(change: (screen: SketchScreen) => void) {
    this.edit((document) => {
      const screen = document.screens.find((screen) => screen.id === this.selectedScreen);
      if (screen) change(screen);
    });
  }
  private updateShape(change: (shape: SketchShape, screen: SketchScreen) => SketchShape) {
    this.updateScreen((screen) => {
      screen.shapes = screen.shapes.map((shape) => shape.id === this.selectedShape ? change(shape, screen) : shape);
    });
  }
  private undo() {
    if (this.fieldDrafts.size) this.fieldDrafts.clear();
    else this.editor.undo();
    this.message = "";
    this.changed();
  }
  update(state: any) {
    const identity = JSON.stringify([state.prototypeId, state.generation]);
    if (this.identity && identity !== this.identity) this.reset();
    this.identity = identity;
    this.state = state;
    const revision = state.sketch?.current?.id ?? null;
    if (this.loadedKey !== null && revision !== this.baseRevision && !this.busy) this.conflict = this.dirty;
    this.render();
    const available = state.sketch && (state.lifecycle?.currentStage === "sketch" || revision);
    if (available && !this.skipped() && !this.busy && !this.loading && !this.conflict
      && this.loadedKey !== this.key() && this.failedKey !== this.key()) void this.load();
  }
  private skipped() {
    return this.state?.lifecycle?.skippedStages?.find((entry: any) => entry.stageId === "sketch")?.reason
      || (this.state?.prototypeApproach?.mode === "not-applicable" ? this.state.prototypeApproach.reason || "No graphical interface needs sketch validation." : "");
  }
  private async reload() {
    if (this.busy || this.loading || this.pointer) return;
    if (this.dirty && !window.confirm("Discard your unsaved drawing edits and load the latest saved revision?")) return;
    await this.load(true);
  }
  private async load(discard = false) {
    const key = this.key();
    const request = ++this.request;
    this.loading = true;
    this.message = "";
    this.changed();
    try {
      const response = await fetch("/api/sketch", { cache: "no-store", signal: AbortSignal.timeout(15000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not load drawings.");
      if (request !== this.request || key !== this.key()) return;
      if ((result.sketch?.current?.id ?? null) !== (this.state.sketch?.current?.id ?? null)) {
        throw new Error("The saved drawing changed while loading. Reload the latest state and drawings.");
      }
      if (this.dirty && !discard) { this.conflict = true; return; }
      if (result.sketch?.current && !result.document) throw new Error("The saved drawing document is unavailable.");
      this.editor.load(result.document);
      this.fieldDrafts.clear();
      this.baseRevision = result.sketch?.current?.id ?? null;
      this.loadedKey = key;
      this.failedKey = null;
      this.conflict = false;
    } catch (error) {
      if (request !== this.request) return;
      this.failedKey = key;
      this.message = error instanceof Error ? error.message : "Could not load drawings.";
    } finally {
      if (request === this.request) { this.loading = false; this.changed(); }
    }
  }
  private async save() {
    const identity = this.identity;
    if (!this.editor.document) throw new Error("Add a screen before saving.");
    if (this.fieldDrafts.size) throw new Error("Complete the invalid screen fields before saving drawings.");
    validateSketchDocument(this.editor.document, this.acceptedDecisionIds());
    const result = await this.hooks.post("/api/sketch", {
      action: "save", expectedRevision: this.baseRevision, document: this.editor.document,
    });
    const revision = result.sketch?.current;
    if (identity !== this.identity || !revision || revision.id !== this.state.sketch?.current?.id) {
      throw new Error("The saved revision could not be confirmed. Reload state before retrying.");
    }
    this.baseRevision = revision.id;
    this.loadedKey = this.key();
    this.editor.markSaved();
    this.conflict = false;
  }
  private async submit(action: "save" | "approve" | "generate" | "revise", retryInstruction?: string) {
    if (!this.writable() || this.conflict || this.pointer || this.fieldDrafts.size) return;
    const instruction = retryInstruction ?? this.elements.instruction.value.trim();
    if (action === "revise" && (!this.editor.document || !instruction)) return;
    if (action === "generate" && this.editor.dirty) {
      this.message = "Save drawings before regenerating. Local edits have been kept.";
      this.changed();
      return;
    }
    if (action === "generate" && this.editor.document
      && !window.confirm("Generate a new drawing revision? Your saved revision remains in history.")) return;
    if (action === "approve" && (this.hasEmptyScreens() || this.state.sketch?.status === "stale")) return;
    const identity = this.identity;
    this.busy = true;
    this.message = "";
    this.changed();
    try {
      if (action === "save" || this.editor.dirty && (action === "approve" || action === "revise")) await this.save();
      if (identity !== this.identity) throw new Error("The effort changed. Review drawings before continuing.");
      if (action === "approve") {
        const revision = this.baseRevision;
        const previews = [];
        for (const screen of this.editor.document!.screens) previews.push(await renderSketchPng(screen));
        if (identity !== this.identity || revision !== this.state.sketch?.current?.id) {
          throw new Error("The drawing changed during PNG export. Review it before approving.");
        }
        await this.hooks.post("/api/sketch", { action: "approve", expectedRevision: revision, previews });
        if (this.state.sketch?.status !== "approved" || this.state.sketch?.approved?.revisionId !== revision) {
          throw new Error("Drawing approval could not be confirmed.");
        }
        await this.hooks.post("/api/stage/complete", { stageId: "sketch" });
      } else if (action !== "save") {
        await this.hooks.post("/api/sketch", {
          action, expectedRevision: this.baseRevision, ...(action === "revise" ? { instruction } : {}),
        });
        if (identity !== this.identity) return;
        if (action === "revise" && retryInstruction === undefined && this.elements.instruction.value.trim() === instruction) {
          this.elements.instruction.value = "";
        }
      }
    } catch (error) {
      if (identity !== this.identity) return;
      this.message = error instanceof Error ? error.message : "Could not update drawings.";
      if (this.baseRevision !== (this.state.sketch?.current?.id ?? null)) this.conflict = this.editor.dirty;
    } finally {
      if (identity === this.identity) {
        this.busy = false;
        this.update(this.state);
        this.hooks.changed();
      }
    }
  }

  private render() {
    const e = this.elements;
    const document = this.editor.document;
    if (!document?.screens.some((screen) => screen.id === this.selectedScreen)) this.selectedScreen = document?.screens[0]?.id || "";
    const screen = this.screen();
    const shape = this.shape();
    const writable = this.writable() && !this.skipped();
    const sketch = this.state?.sketch;
    const worker = ["generate-sketch", "revise-sketch"].includes(this.state?.processing?.action) ? this.state.processing : null;
    e.status.textContent = this.skipped() ? "Sketch disabled: " + this.skipped()
      : this.loading ? "Loading drawings…"
      : this.busy ? "Saving drawings or preparing approval…"
      : worker?.status === "running" ? worker.message || "AI is preparing a drawing revision. Existing drawings are retained."
      : this.conflict ? "Conflict: a newer saved revision exists. Your local edits are retained; load latest explicitly to discard them."
      : this.state?.provider?.canSubmitAnswers === false ? this.hooks.guidance()
      : !this.hooks.canEdit() ? "Read only. Open or reopen Sketch to edit these drawings."
      : sketch?.status === "stale" ? "Stale drawings: requirements changed. Regenerate or revise and review before approval."
      : document && this.hasEmptyScreens() ? "Add at least one shape to every screen before approving. Empty screens can be saved as drafts."
      : this.dirty ? "Unsaved drawings — save before leaving this browser. Switching tabs keeps your edits."
      : sketch?.status === "approved" ? "Drawings approved. Finish Sketch to continue if the stage has not advanced."
      : document ? "Review every screen, edit the drawings, then approve to continue to Prototype."
      : "Generate drawings from the requirements DAG, or add a screen to draw your own.";
    e.message.textContent = this.message || (worker?.status === "error" ? worker.message || "Drawing generation failed. Retry explicitly." : "");
    e.message.hidden = !e.message.textContent;
    e.empty.hidden = Boolean(screen);
    e.workspace.hidden = !screen;
    e.generate.textContent = document ? "Regenerate drawings" : "Generate drawings";
    e.generate.disabled = !writable || this.conflict || this.dirty;
    e.save.disabled = !writable || !document || !this.editor.dirty || this.conflict || this.fieldDrafts.size > 0;
    e.approve.disabled = !writable || this.hasEmptyScreens() || this.conflict || sketch?.status === "stale" || this.fieldDrafts.size > 0;
    e.revise.disabled = !writable || !document || this.conflict || !e.instruction.value.trim() || this.fieldDrafts.size > 0;
    const failedInstruction = this.failedInstruction();
    e["failed-revision"].hidden = !failedInstruction;
    e["failed-instruction"].textContent = failedInstruction ? "Failed revision instruction: " + failedInstruction : "";
    e["retry-revision"].disabled = !writable || !document || this.conflict || !failedInstruction || this.fieldDrafts.size > 0;
    e.instruction.disabled = !writable;
    e.reload.disabled = this.busy || this.loading || Boolean(this.pointer) || !this.state?.sketch;
    e.reload.textContent = this.conflict ? "Discard local edits & load latest" : "Reload saved drawings";
    e["add-screen"].disabled = !writable || (document?.screens.length || 0) >= 8 || !this.acceptedDecisionIds().length;
    e.undo.disabled = !writable || (!this.editor.canUndo && !this.fieldDrafts.size);
    e.redo.disabled = !writable || !this.editor.canRedo;
    e.freehand.setAttribute("aria-pressed", String(this.drawing));
    e["board-help"].textContent = this.drawing
      ? "Freehand: drag on the board to draw. Select Freehand again to stop."
      : "Select a shape on the board or in the list. Drag to move; use arrow keys to nudge, or edit dimensions below.";
    for (const control of e.tools.querySelectorAll("button")) control.disabled = !writable || !screen || screen.shapes.length >= 100;
    e["delete-shape"].disabled = !writable || !shape;
    e["add-transition"].disabled = !writable || !screen || (document?.transitions.length || 0) >= 40;
    this.listScreens();
    for (const field of ["title", "purpose", "notes", "decisions"] as const) {
      const value = this.fieldDrafts.get(this.selectedScreen + ":" + field)
        ?? (field === "decisions" ? screen?.decisionIds.join(", ") : screen?.[field]);
      if (e[field].value !== (value || "")) e[field].value = value || "";
      e[field].setAttribute("aria-invalid", String(this.fieldDrafts.has(this.selectedScreen + ":" + field)));
      e[field].disabled = !writable || !screen;
    }
    e.viewport.textContent = screen ? `${screen.width} × ${screen.height}` : "";
    const shapeView = shape ? { ...shape, ...shapeBounds(shape) } : null;
    for (const field of ["x", "y", "width", "height", "text", "font-size", "fill", "stroke"] as const) {
      const key = field === "font-size" ? "fontSize" : field;
      const value = shapeView ? String(shapeView[key]) : "";
      if (e[field].value !== value) e[field].value = value;
      e[field].disabled = !writable || !shape || (["text", "font-size"].includes(field) && shape.kind !== "text");
      if (["width", "height"].includes(field)) e[field].min = shape && ["line", "arrow", "path"].includes(shape.kind) ? "0" : "1";
    }
    e["shape-label"].textContent = shape ? `${shape.kind} · ${shape.id}` : "Select a shape to edit";
    this.renderBoard();
    this.listTransitions(writable);
    e.history.replaceChildren();
    const revisions = [...(sketch?.history || []), ...(sketch?.current ? [sketch.current] : [])];
    const unique = new Map<string, any>(revisions.map((revision) => [revision.id, revision]));
    for (const revision of [...unique.values()].reverse()) {
      const item = this.root.ownerDocument.createElement("li");
      item.textContent = `Revision ${revision.number} · ${revision.source} · ${revision.createdAt}`
        + (revision.id === sketch?.approved?.revisionId ? " · approved" : "")
        + (revision.id === sketch?.current?.id ? " · current" : "");
      e.history.append(item);
    }
  }
  private listScreens() {
    const e = this.elements;
    e.screens.replaceChildren();
    for (const screen of this.editor.document?.screens || []) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = screen.title || screen.id;
      button.disabled = Boolean(this.pointer);
      button.dataset.uiKey = "sketch-screen:" + screen.id;
      button.setAttribute("aria-pressed", String(screen.id === this.selectedScreen));
      button.addEventListener("click", () => { this.selectedScreen = screen.id; this.selectedShape = ""; this.changed(); });
      e.screens.append(button);
    }
    e.shapes.replaceChildren();
    for (const shape of this.screen()?.shapes || []) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = shape.kind + (shape.text ? ": " + shape.text : " · " + shape.id);
      button.disabled = Boolean(this.pointer);
      button.dataset.uiKey = "sketch-shape:" + shape.id;
      button.setAttribute("aria-pressed", String(shape.id === this.selectedShape));
      button.addEventListener("click", () => { this.selectedShape = shape.id; this.drawing = false; this.changed(); });
      e.shapes.append(button);
    }
  }
  private renderBoard() {
    const screen = this.screen();
    if (!screen) { this.elements.board.replaceChildren(); return; }
    const preview = clone(screen);
    if (this.pointer?.moved) preview.shapes = preview.shapes.map((shape) => shape.id === this.pointer!.moved!.id ? this.pointer!.moved! : shape);
    if (this.pointer && !this.pointer.shape && this.pointer.points.length >= 2) preview.shapes.push(this.path(this.pointer.points));
    this.elements.board.innerHTML = renderSketchSvg(preview);
    for (const group of this.elements.board.querySelectorAll("[data-shape-id]")) {
      group.classList.toggle("sketch-selected", group.dataset.shapeId === this.selectedShape);
    }
    this.elements.board.classList.toggle("sketch-drawing", this.drawing);
  }
  private listTransitions(writable: boolean) {
    this.elements.transitions.replaceChildren();
    for (const transition of this.editor.document?.transitions || []) {
      const row = document.createElement("div");
      row.className = "sketch-transition";
      for (const field of ["fromScreenId", "toScreenId", "trigger", "description"] as const) {
        const label = document.createElement("label");
        label.textContent = { fromScreenId: "From", toScreenId: "To", trigger: "Trigger", description: "Description" }[field];
        const input = document.createElement(field.endsWith("ScreenId") ? "select" : "input");
        if (field.endsWith("ScreenId")) {
          for (const screen of this.editor.document!.screens) {
            const option = document.createElement("option");
            option.value = screen.id;
            option.textContent = screen.title || screen.id;
            input.append(option);
          }
        }
        input.value = transition[field];
        input.disabled = !writable;
        input.setAttribute("maxlength", "500");
        input.dataset.uiKey = `sketch-transition:${transition.id}:${field}`;
        input.addEventListener("change", () => this.edit((document) => {
          document.transitions.find((item) => item.id === transition.id)![field] = input.value;
        }));
        label.append(input);
        row.append(label);
      }
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Remove transition";
      remove.disabled = !writable;
      remove.addEventListener("click", () => this.edit((document) => {
        document.transitions = document.transitions.filter((item) => item.id !== transition.id);
      }));
      row.append(remove);
      this.elements.transitions.append(row);
    }
  }
  private position(event: PointerEvent) {
    const screen = this.screen()!;
    const rect = this.elements.board.querySelector("svg").getBoundingClientRect();
    return { x: clamp((event.clientX - rect.left) * screen.width / rect.width, 0, screen.width),
      y: clamp((event.clientY - rect.top) * screen.height / rect.height, 0, screen.height) };
  }
  private pointerDown(event: PointerEvent) {
    if (!this.writable() || !this.screen() || (event.button !== undefined && event.button !== 0)) return;
    const id = (event.target as Element).closest("[data-shape-id]")?.getAttribute("data-shape-id");
    const screen = this.screen()!;
    const shape = screen.shapes.find((shape) => shape.id === id);
    if (!this.drawing && !shape || this.drawing && screen.shapes.length >= 100) return;
    event.preventDefault();
    const point = this.position(event);
    this.selectedShape = this.drawing ? "" : shape!.id;
    this.pointer = { id: event.pointerId, ...point, screen: clone(screen), shape: this.drawing ? null : clone(shape!), points: [point], moved: null };
    this.elements.board.setPointerCapture(event.pointerId);
    this.elements.board.focus();
    this.changed();
  }
  private pointerMove(event: PointerEvent) {
    if (!this.pointer || this.pointer.id !== event.pointerId) return;
    const point = this.position(event);
    if (this.pointer.shape) {
      const original = shapeBounds(this.pointer.shape);
      this.pointer.moved = setShapeBounds(this.pointer.screen, this.pointer.shape, {
        x: original.x + point.x - this.pointer.x, y: original.y + point.y - this.pointer.y,
      });
    } else if (this.pointer.points.length < 512) {
      const last = this.pointer.points.at(-1)!;
      if (Math.hypot(point.x - last.x, point.y - last.y) >= 2) this.pointer.points.push(point);
    }
    this.renderBoard();
  }
  private path(points: { x: number; y: number }[]): SketchShape {
    const screen = this.screen()!;
    const xs = points.map((point) => point.x), ys = points.map((point) => point.y);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { ...createShape(screen, "path"), x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y, points };
  }
  private pointerUp(event: PointerEvent) {
    if (!this.pointer || this.pointer.id !== event.pointerId) return;
    this.pointerMove(event);
    const pointer = this.pointer;
    this.pointer = null;
    this.elements.board.releasePointerCapture(event.pointerId);
    if (!this.writable()) { this.changed(); return; }
    if (pointer.moved) this.updateShape(() => pointer.moved!);
    else if (!pointer.shape && pointer.points.length >= 2) this.updateScreen((screen) => {
      const shape = this.path(pointer.points);
      screen.shapes.push(shape);
      this.selectedShape = shape.id;
    });
    this.changed();
  }
  private keydown(event: KeyboardEvent) {
    if ((event.target as Element).closest("input, textarea, select")) return;
    if (event.key === "Escape") {
      this.pointer = null;
      this.drawing = false;
      this.changed();
      return;
    }
    if (!this.writable()) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) this.editor.redo(); else { this.undo(); return; }
      this.changed();
    } else if (this.shape() && (event.target as Element).closest("#sketch-board, #sketch-shapes")) {
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        this.updateShape((shape, screen) => {
          const bounds = shapeBounds(shape);
          return setShapeBounds(screen, shape, {
            x: bounds.x + (event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0),
            y: bounds.y + (event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0),
          });
        });
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        this.updateScreen((screen) => { screen.shapes = screen.shapes.filter((shape) => shape.id !== this.selectedShape); });
      }
    }
  }
}
