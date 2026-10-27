import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Code, Maximize, Minus, Plus, RotateCcw, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useDraft } from "./ui-context.js";

export interface MermaidRenderer {
  initialize(config: object): void;
  render(id: string, source: string): Promise<{ svg: string }>;
}

let rendererPromise: Promise<MermaidRenderer> | null = null;
export function loadMermaid(): Promise<MermaidRenderer> {
  if (!rendererPromise) {
    rendererPromise = import(
      // @ts-expect-error Mermaid remains an optional browser-loaded diagram renderer.
      "https://cdn.jsdelivr.net/npm/mermaid@11.17.2/dist/mermaid.esm.min.mjs"
    ).then((module) => module.default as MermaidRenderer).catch((error: unknown) => {
      rendererPromise = null;
      throw error;
    });
  }
  return rendererPromise;
}

let nextDiagram = 0;
export function Diagram({ id, source, onNodeSelect, legend, label = "Diagram", loader = loadMermaid }: {
  id: string;
  source: string;
  onNodeSelect?: (nodeId: string) => void;
  legend?: ReactNode;
  label?: string;
  loader?: () => Promise<MermaidRenderer>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");
  const [theme, setTheme] = useState(() => document.documentElement.dataset.colorMode);
  const [view, setView] = useDraft<{ mode: "fit" | "scale"; scale: number }>("diagram:" + id, { mode: "fit", scale: 1 });
  const [naturalWidth, setNaturalWidth] = useState(800);
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(document.documentElement.dataset.colorMode));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-color-mode"] });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let cancelled = false;
    setError("");
    if (!source.trim()) { setSvg(""); return; }
    void loader().then(async (renderer) => {
      renderer.initialize({ startOnLoad: false, securityLevel: "strict", suppressErrorRendering: true,
        theme: theme === "dark" ? "dark" : "default", flowchart: { htmlLabels: false, useMaxWidth: true } });
      const result = await renderer.render("tandem-diagram-" + ++nextDiagram, source);
      if (!cancelled) setSvg(result.svg);
    }).catch((cause: unknown) => {
      if (!cancelled) {
        setSvg("");
        setError("Diagram unavailable. Open Mermaid source to view its text. " + (cause instanceof Error ? cause.message : ""));
      }
    });
    return () => { cancelled = true; };
  }, [source, theme, loader]);
  useEffect(() => {
    const node = host.current?.querySelector("svg");
    const width = Number(node?.getAttribute("viewBox")?.trim().split(/\s+/)[2]) || Number.parseFloat(node?.getAttribute("width") || "");
    if (Number.isFinite(width) && width > 0) setNaturalWidth(width);
    if (!onNodeSelect) return;
    for (const group of host.current?.querySelectorAll<SVGGElement>("g.node") || []) {
      group.setAttribute("tabindex", "0");
      group.setAttribute("role", "button");
      group.setAttribute("aria-label", group.textContent?.trim() || "Select decision");
    }
  }, [svg, onNodeSelect]);
  const select = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return;
    const group = target.closest("g.node");
    const nodeId = group?.id.match(/^flowchart-(.+)-\d+$/)?.[1] || group?.getAttribute("data-id");
    if (nodeId) onNodeSelect?.(nodeId);
  };
  const zoom = (scale: number) => setView({ mode: "scale", scale: Math.max(.25, Math.min(4, scale)) });
  return <Dialog.Root><div className="diagram">
    <div className="diagram-header">
      {legend}
      <div className="diagram-toolbar" role="toolbar" aria-label="Diagram controls">
        {svg && <>
        <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => zoom(view.scale * .8)}><Minus size={16} aria-hidden="true" /></button>
        <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => zoom(view.scale * 1.25)}><Plus size={16} aria-hidden="true" /></button>
        <button type="button" aria-label="Actual size" title="Actual size" onClick={() => zoom(1)}><RotateCcw size={16} aria-hidden="true" />100%</button>
        <button type="button" aria-label="Fit diagram" title="Fit diagram" onClick={() => setView({ mode: "fit", scale: 1 })}><Maximize size={16} aria-hidden="true" />Fit</button>
        </>}
        <div className="diagram-source-controls">
          {svg && <span className="diagram-toolbar-output" aria-live="polite">{view.mode === "fit" ? "Fit" : Math.round(view.scale * 100) + "%"}</span>}
          <Dialog.Trigger asChild><button id={`${id}-source-trigger`} type="button" title="Mermaid source" aria-controls={`${id}-source-dialog`}>
            <Code size={16} aria-hidden="true" />Mermaid source
          </button></Dialog.Trigger>
        </div>
      </div>
    </div>
    <div className="diagram-scroll-area" role="region" aria-label={`${label} content`} tabIndex={0}>
      <div id={id} ref={host} className="mermaid-host react-diagram" role={onNodeSelect ? "group" : "img"} aria-label={label}
        style={{ "--diagram-width": view.mode === "fit" ? "100%" : naturalWidth * view.scale + "px" } as CSSProperties}
        onClick={(event) => select(event.target)}
        onKeyDown={(event) => { if (onNodeSelect && ["Enter", " "].includes(event.key)) { event.preventDefault(); select(event.target); } }}
        dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
    <p className="diagram-status" role="status" data-status={error ? "error" : "idle"}>{error}</p>
  </div>
    <Dialog.Portal><Dialog.Overlay className="dialog-overlay" />
      <Dialog.Content id={`${id}-source-dialog`} className="dialog-content diagram-source-dialog"
        aria-modal="true" aria-labelledby={`${id}-source-label`} aria-describedby={undefined}>
        <header className="diagram-source-heading">
          <Dialog.Title id={`${id}-source-label`}>Mermaid source</Dialog.Title>
          <Dialog.Close asChild><button className="review-close" type="button" aria-label="Close Mermaid source">
            <X size={18} aria-hidden="true" />
          </button></Dialog.Close>
        </header>
        <pre tabIndex={0} role="region" aria-labelledby={`${id}-source-label`}>{source}</pre>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
