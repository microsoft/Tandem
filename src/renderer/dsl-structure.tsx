import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ChevronRight } from "lucide-react";
import type { DslSketchScreen } from "../sketch.js";
import type { UiNode } from "../vendor/ui-dsl/index.js";
import { uiNodeLabel } from "./dsl-view.js";

export function DslStructure({ screen, selectedId, onSelect }: {
  screen: DslSketchScreen;
  selectedId: string | null;
  onSelect(id: string): void;
}) {
  const tree = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const selected = selectedId ? screen.ui.nodes[selectedId] : null;
  const rows = useMemo(() => {
    const result: Array<{ node: UiNode; depth: number; position: number; siblings: number }> = [];
    const visit = (id: string, depth: number, position: number, siblings: number) => {
      const node = screen.ui.nodes[id];
      result.push({ node, depth, position, siblings });
      if (!collapsed.has(id)) node.children.forEach((child, index) => visit(child, depth + 1, index + 1, node.children.length));
    };
    visit(screen.ui.root, 1, 1, 1);
    return result;
  }, [screen.ui, collapsed]);

  useLayoutEffect(() => {
    if (!selected) return;
    const ancestors: string[] = [];
    let parent = selected.parent;
    while (parent) {
      ancestors.push(parent);
      parent = screen.ui.nodes[parent].parent;
    }
    if (ancestors.some(id => collapsed.has(id))) {
      setCollapsed(current => new Set([...current].filter(id => !ancestors.includes(id))));
      return;
    }
    const row = tree.current?.querySelector<HTMLElement>(`[data-node-id="${selected.id}"]`);
    if (!row || !tree.current) return;
    const bounds = row.getBoundingClientRect(), viewport = tree.current.getBoundingClientRect();
    if (bounds.top < viewport.top) tree.current.scrollTop += bounds.top - viewport.top;
    else if (bounds.bottom > viewport.bottom) tree.current.scrollTop += bounds.bottom - viewport.bottom;
  }, [selected, screen.ui, collapsed]);

  function toggle(id: string) {
    setCollapsed(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function keydown(event: KeyboardEvent<HTMLButtonElement>, node: UiNode, index: number) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    let next: string | undefined;
    switch (event.key) {
      case "ArrowDown": next = rows[index + 1]?.node.id; break;
      case "ArrowUp": next = rows[index - 1]?.node.id; break;
      case "Home": next = rows[0]?.node.id; break;
      case "End": next = rows.at(-1)?.node.id; break;
      case "ArrowRight":
        if (node.children.length && collapsed.has(node.id)) toggle(node.id);
        else next = node.children[0];
        break;
      case "ArrowLeft":
        if (node.children.length && !collapsed.has(node.id)) toggle(node.id);
        else next = node.parent ?? undefined;
        break;
      default: return;
    }
    event.preventDefault();
    if (next) tree.current?.querySelector<HTMLElement>(`[data-node-id="${next}"]`)?.focus({ preventScroll: true });
  }
  const tabStop = rows.some(row => row.node.id === selectedId) ? selectedId : screen.ui.root;
  return <details id="sketch-structure" className="sketch-structure" open>
    <summary>Structure <span className="section-count">{Object.keys(screen.ui.nodes).length}</span></summary>
    <div ref={tree} id="sketch-structure-tree" className="sketch-structure-tree" role="tree" aria-label="UI component structure">
      {rows.map(({ node, depth, position, siblings }, index) => <button key={node.id} type="button"
        className="sketch-structure-node" role="treeitem" data-node-id={node.id}
        style={{ paddingInlineStart: 4 + Math.min(depth - 1, 8) * 12 }}
        aria-level={depth} aria-posinset={position} aria-setsize={siblings}
        aria-expanded={node.children.length ? !collapsed.has(node.id) : undefined}
        aria-selected={node.id === selectedId} aria-label={`${uiNodeLabel(node)} (${node.id})`}
        title={`${uiNodeLabel(node)} (${node.id})`} tabIndex={node.id === tabStop ? 0 : -1}
        onFocus={() => onSelect(node.id)}
        onClick={event => {
          onSelect(node.id);
          if (node.children.length && (event.target as Element).closest("[data-expander]")) toggle(node.id);
        }}
        onKeyDown={event => keydown(event, node, index)}>
        <span className="sketch-structure-expander" data-expander aria-hidden="true">
          {node.children.length > 0 && <ChevronRight size={12} />}
        </span>
        <span className="sketch-node-type">{node.type}</span>
        <span className="sketch-node-label">{uiNodeLabel(node).slice(node.type.length + 2)}</span>
      </button>)}
    </div>
  </details>;
}
