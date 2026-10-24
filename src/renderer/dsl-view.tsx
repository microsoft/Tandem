import { useLayoutEffect, useRef, useState } from "react";
import type { DslSketchScreen } from "../sketch.js";
import { createRenderer, type UiNode, type UiRenderer } from "../vendor/ui-dsl/index.js";
import rendererCss from "../vendor/ui-dsl/styles.js";

const styles = `${rendererCss}
:host { display: block; width: 100%; height: 100%; overflow: hidden; }
:host([hidden]) { display: none; }
.uidl-surface { min-height: 100%; }
`;

function mount(host: HTMLElement, onSelect?: (id: string) => void) {
  const style = host.ownerDocument.createElement("style");
  style.textContent = styles;
  host.append(style);
  return createRenderer(host, { mode: "interact", onSelect });
}

export function uiNodeLabel(node: UiNode): string {
  const label = ["label", "text", "title", "alt", "name"].map(key => node.props[key])
    .find(value => typeof value === "string" && value.trim());
  return `${node.type}: ${typeof label === "string" ? label.slice(0, 80) : node.id}`;
}

export function DslView({ screen, selection }: {
  screen: DslSketchScreen;
  selection?: { nodeId: string | null; picking: boolean; onSelect(id: string): void };
}) {
  const host = useRef<HTMLDivElement>(null);
  const renderer = useRef<UiRenderer | null>(null);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const [error, setError] = useState("");
  useLayoutEffect(() => {
    const shadow = host.current!.shadowRoot ?? host.current!.attachShadow({ mode: "open" });
    const surface = host.current!.ownerDocument.createElement("div");
    surface.style.cssText = "width:100%;height:100%";
    shadow.append(surface);
    renderer.current = mount(surface, id => selectionRef.current?.onSelect(id));
    return () => { renderer.current?.dispose(); renderer.current = null; surface.remove(); };
  }, []);
  useLayoutEffect(() => {
    try {
      renderer.current!.render(screen.ui);
      setError("");
    } catch (cause) {
      setError(`Could not render the UI DSL view: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }, [screen.ui]);
  useLayoutEffect(() => {
    renderer.current!.setMode(selection?.picking ? "select" : "interact");
    renderer.current!.select(selection?.nodeId && Object.hasOwn(screen.ui.nodes, selection.nodeId) ? selection.nodeId : null);
  }, [screen.ui, selection?.nodeId, selection?.picking]);
  useLayoutEffect(() => {
    if (!selection?.picking || !selection.nodeId) return;
    const element = renderer.current?.getElement(selection.nodeId);
    const viewport = host.current?.closest<HTMLElement>(".sketch-board-wrap");
    if (!element || !viewport) return;
    const bounds = element.getBoundingClientRect(), visible = viewport.getBoundingClientRect();
    if (bounds.top < visible.top || bounds.height > visible.height) viewport.scrollTop += bounds.top - visible.top;
    else if (bounds.bottom > visible.bottom) viewport.scrollTop += bounds.bottom - visible.bottom;
    if (bounds.left < visible.left || bounds.width > visible.width) viewport.scrollLeft += bounds.left - visible.left;
    else if (bounds.right > visible.right) viewport.scrollLeft += bounds.right - visible.right;
  }, [selection?.nodeId, selection?.picking]);
  return <>
    <div ref={host} className="dsl-view" role="group" aria-label={`${screen.title} UI preview`}
      style={{ width: "100%", height: "100%" }} hidden={Boolean(error)} />
    {error && <p role="alert">{error}</p>}
  </>;
}

/** Raster input is derived from the same trusted renderer and CSS as the live view. */
export function renderDslSvg(screen: DslSketchScreen): string {
  const owner = document.implementation.createHTMLDocument("");
  const host = owner.createElement("div");
  host.style.cssText = `width:${screen.width}px;height:${screen.height}px;overflow:hidden`;
  const renderer = mount(host);
  try {
    renderer.render(screen.ui);
    for (const input of host.querySelectorAll("input")) {
      input.setAttribute("value", input.value);
      if (input.checked) input.setAttribute("checked", "");
    }
    for (const textarea of host.querySelectorAll("textarea")) textarea.textContent = textarea.value;
    for (const option of host.querySelectorAll("option")) {
      if (option.selected) option.setAttribute("selected", "");
    }
    const Serializer = document.defaultView!.XMLSerializer;
    const content = new Serializer().serializeToString(host);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${screen.width}" height="${screen.height}" viewBox="0 0 ${screen.width} ${screen.height}"><foreignObject width="100%" height="100%">${content}</foreignObject></svg>`;
  } finally {
    renderer.dispose();
  }
}
