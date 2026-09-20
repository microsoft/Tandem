import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Maximize, Scan, ZoomIn, ZoomOut } from "lucide-react";

const MIN_ZOOM = 0.01;
const MAX_ZOOM = 8;
type ZoomMode = "fit" | "actual" | "custom";

export function SketchViewport({ context, width, height, blocked, sizeControl, tools, help, children }: {
  context: string;
  width: number;
  height: number;
  blocked: boolean;
  sizeControl: ReactNode;
  tools: ReactNode;
  help: ReactNode;
  children: ReactNode;
}) {
  const shell = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const center = useRef<{ x: number; y: number } | null>(null);
  const [available, setAvailable] = useState({ width: 0, height: 0 });
  const [view, setView] = useState({ context, width, height, mode: "fit" as ZoomMode, scale: 1 });
  const { mode } = view;
  const scale = mode === "fit"
    ? available.width > 0 && available.height > 0 ? Math.min(available.width / view.width, available.height / view.height) : 1
    : view.scale;

  function captureCenter() {
    const node = shell.current!;
    const before = canvas.current!.getBoundingClientRect();
    const bounds = node.getBoundingClientRect();
    center.current = before.width > 0 && before.height > 0 ? {
      x: (bounds.left + node.clientWidth / 2 - before.left) / before.width,
      y: (bounds.top + node.clientHeight / 2 - before.top) / before.height,
    } : null;
  }

  useLayoutEffect(() => {
    if (view.context === context && view.width === width && view.height === height) return;
    captureCenter();
    setView((current) => ({ ...current, context, width, height, mode: current.context === context ? current.mode : "fit" }));
  }, [context, width, height, view.context, view.width, view.height]);

  useLayoutEffect(() => {
    const node = shell.current!;
    const measure = () => {
      const rect = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      const pixels = (value: string) => Number.parseFloat(value) || 0;
      // Ignore old scrollbars: fit removes them and can use the full inner area.
      const width = rect.width - pixels(style.borderLeftWidth) - pixels(style.borderRightWidth)
        - pixels(style.paddingLeft) - pixels(style.paddingRight);
      const height = rect.height - pixels(style.borderTopWidth) - pixels(style.borderBottomWidth)
        - pixels(style.paddingTop) - pixels(style.paddingBottom);
      if (width > 0 && height > 0) setAvailable((current) =>
        current.width === width && current.height === height ? current : { width, height });
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(node);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, [context]);

  useLayoutEffect(() => {
    const node = shell.current!;
    if (mode === "fit") {
      node.scrollLeft = 0;
      node.scrollTop = 0;
    } else if (center.current) {
      const after = canvas.current!.getBoundingClientRect();
      const bounds = node.getBoundingClientRect();
      node.scrollLeft += after.left + after.width * center.current.x - bounds.left - node.clientWidth / 2;
      node.scrollTop += after.top + after.height * center.current.y - bounds.top - node.clientHeight / 2;
    }
    center.current = null;
  }, [view.context, view.width, view.height, scale, mode]);

  function zoom(mode: ZoomMode, nextScale: number) {
    // Capture before React changes the canvas box and the browser clamps its scroll offsets.
    captureCenter();
    setView((current) => ({ ...current, mode, scale: nextScale }));
  }
  const stepZoom = (factor: number) => zoom("custom", Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, scale * factor)));
  return <>
    <div className="sketch-toolbar">
      {tools}
      <div className="sketch-view-controls">
        {sizeControl}
        <div id="sketch-zoom-tools" className="sketch-actions" role="group" aria-label="Canvas zoom controls">
          <button id="sketch-zoom-out" className="sketch-icon-button" type="button" title="Zoom out" aria-label="Zoom out"
            disabled={blocked || scale <= MIN_ZOOM} onClick={() => stepZoom(.8)}><ZoomOut size={20} aria-hidden="true" /></button>
          <button id="sketch-zoom-in" className="sketch-icon-button" type="button" title="Zoom in" aria-label="Zoom in"
            disabled={blocked || scale >= MAX_ZOOM} onClick={() => stepZoom(1.25)}><ZoomIn size={20} aria-hidden="true" /></button>
          <output id="sketch-zoom" className="sketch-zoom-output" aria-label="Canvas zoom" aria-live="polite">
            {Number((scale * 100).toFixed(1))}%
          </output>
          <button id="sketch-zoom-fit" className="sketch-icon-button" type="button" title="Fit entire canvas" aria-label="Fit entire canvas"
            aria-pressed={mode === "fit"} disabled={blocked} onClick={() => zoom("fit", 1)}>
            <Maximize size={20} aria-hidden="true" /></button>
          <button id="sketch-zoom-actual" className="sketch-icon-button" type="button" title="Actual size (100%)" aria-label="Actual size (100%)"
            aria-pressed={scale === 1} disabled={blocked} onClick={() => zoom("actual", 1)}>
            <Scan size={20} aria-hidden="true" /></button>
        </div>
      </div>
    </div>
    {help}
    <div ref={shell} id="sketch-board-wrap" className="sketch-board-wrap">
      <div ref={canvas} id="sketch-canvas" className="sketch-canvas" style={{ width: view.width * scale, height: view.height * scale }}>
        {children}
      </div>
    </div>
  </>;
}
