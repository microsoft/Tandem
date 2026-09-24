import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Maximize, Minus, Plus, RotateCcw } from "lucide-react";
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
export function Diagram({ id, source, onNodeSelect, label = "Diagram", loader = loadMermaid }: {
  id: string;
  source: string;
  onNodeSelect?: (nodeId: string) => void;
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
        setError("Diagram unavailable. Use the text and source below. " + (cause instanceof Error ? cause.message : ""));
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
  return <>
    {svg && <div className="diagram-toolbar" role="toolbar" aria-label="Diagram zoom controls">
      <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => zoom(view.scale * .8)}><Minus size={16} aria-hidden="true" /></button>
      <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => zoom(view.scale * 1.25)}><Plus size={16} aria-hidden="true" /></button>
      <button type="button" aria-label="Actual size" title="Actual size" onClick={() => zoom(1)}><RotateCcw size={16} aria-hidden="true" />100%</button>
      <button type="button" aria-label="Fit diagram" title="Fit diagram" onClick={() => setView({ mode: "fit", scale: 1 })}><Maximize size={16} aria-hidden="true" />Fit</button>
      <span className="diagram-toolbar-output" aria-live="polite">{view.mode === "fit" ? "Fit" : Math.round(view.scale * 100) + "%"}</span>
    </div>}
    <div id={id} ref={host} className="mermaid-host react-diagram" role={onNodeSelect ? "group" : "img"} aria-label={label}
      style={{ "--diagram-width": view.mode === "fit" ? "100%" : naturalWidth * view.scale + "px" } as CSSProperties}
      onClick={(event) => select(event.target)}
      onKeyDown={(event) => { if (onNodeSelect && ["Enter", " "].includes(event.key)) { event.preventDefault(); select(event.target); } }}
      dangerouslySetInnerHTML={{ __html: svg }} />
    <p className="diagram-status" role="status" data-status={error ? "error" : "idle"}>{error}</p>
    <details className="diagram-source" open={error ? true : undefined}><summary>Mermaid source</summary><pre>{source}</pre></details>
  </>;
}
