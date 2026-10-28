import { CATALOG, TOKEN_DEFINITIONS } from "./catalog.js";
import { ensure, validateDocument } from "./document.js";
import { LUCIDE_ICONS } from "./lucide-icons.js";

let mountSequence = 0;
const svgNamespace = "http://www.w3.org/2000/svg";
const iconSizes = { sm: 16, md: 20, lg: 24 };
const variable = key => `--ui-${key.replaceAll(".", "-")}`;
const token = key => key ? `var(${variable(key)})` : "";
const tagFor = node => ({
  Screen: "main", Card: "article", Section: "section", Heading: `h${node.props.level}`,
  Text: "p", Button: "button", Checkbox: "label", Switch: "label", Badge: "span",
  Divider: "hr", Avatar: "span", Icon: "span", Link: "a", Stat: "dl", Alert: "section",
  List: node.props.ordered ? "ol" : "ul",
})[node.type] ?? "div";

export function createRenderer(host, { onSelect = () => {}, onEvent = () => {}, mode = "select" } = {}) {
  ensure(host && typeof host.append === "function", "invalid_host", "Pass a DOM element to createRenderer.");
  ensure(["select", "interact"].includes(mode), "invalid_mode", "Use select or interact mode.");
  const owner = host.ownerDocument;
  const mountId = ++mountSequence;
  const records = new Map();
  const surface = owner.createElement("div");
  surface.className = "uidl-surface";
  surface.dataset.mode = mode;
  host.append(surface);
  let snapshot = null;
  let selectedId = null;
  let disposed = false;

  const element = (tag, className) => {
    const result = owner.createElement(tag);
    if (className) result.className = className;
    return result;
  };
  const setText = (target, value) => {
    if (target.textContent !== value) target.textContent = value;
  };
  const updateIcon = (record, name, size = "md") => {
    if (!name) {
      record.icon?.remove();
      record.icon = null;
      return;
    }
    if (!record.icon) {
      record.icon = owner.createElementNS(svgNamespace, "svg");
      for (const [key, value] of Object.entries({
        class: "uidl-icon", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
        "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round",
        "aria-hidden": "true", focusable: "false",
      })) record.icon.setAttribute(key, value);
    }
    if (record.icon.getAttribute("data-icon") !== name) {
      record.icon.replaceChildren(...LUCIDE_ICONS[name].map(([tag, attributes]) => {
        const shape = owner.createElementNS(svgNamespace, tag);
        for (const [key, value] of Object.entries(attributes)) shape.setAttribute(key, value);
        return shape;
      }));
      record.icon.setAttribute("data-icon", name);
    }
    record.icon.setAttribute("width", String(iconSizes[size]));
    record.icon.setAttribute("height", String(iconSizes[size]));
  };
  const make = node => {
    const el = element(tagFor(node), "uidl-node");
    el.dataset.uiId = node.id;
    el.dataset.type = node.type;
    const record = { el, node: null };
    if (["Input", "Textarea", "Select"].includes(node.type)) {
      record.label = element("label", "uidl-label");
      record.control = element(node.type === "Input" ? "input" : node.type === "Textarea" ? "textarea" : "select", "uidl-control");
      record.control.id = `ui-${mountId}-${node.id}`;
      record.label.htmlFor = record.control.id;
      record.helper = element("small", "uidl-helper");
      record.helper.id = `${record.control.id}-help`;
      el.append(record.label, record.control, record.helper);
    } else if (["Checkbox", "Switch"].includes(node.type)) {
      record.control = element("input");
      record.control.type = "checkbox";
      if (node.type === "Switch") record.control.setAttribute("role", "switch");
      record.label = element("span");
      el.append(record.control, record.label);
    } else if (node.type === "Progress") {
      record.label = element("label", "uidl-label");
      record.control = element("progress");
      record.control.id = `ui-${mountId}-${node.id}`;
      record.control.max = 100;
      record.label.htmlFor = record.control.id;
      el.append(record.label, record.control);
    } else if (node.type === "Stat") {
      record.label = element("dt");
      record.value = element("dd", "uidl-stat-value");
      record.detail = element("dd", "uidl-helper");
      el.append(record.label, record.value, record.detail);
    } else if (node.type === "Alert") {
      record.title = element("strong");
      record.text = element("p");
      el.setAttribute("role", "note");
      el.append(record.title, record.text);
    } else if (["Button", "Link"].includes(node.type)) {
      record.label = element("span");
      el.append(record.label);
      if (node.type === "Button") el.type = "button";
      else el.href = "#";
    } else if (node.type === "Image" || node.type === "Avatar") el.setAttribute("role", "img");
    else if (node.type === "Spacer") el.setAttribute("aria-hidden", "true");
    return record;
  };
  const update = (record, node) => {
    const p = node.props;
    const old = record.node?.props;
    const el = record.el;
    el.style.padding = token(p.padding);
    el.style.backgroundColor = token(p.background);
    el.style.color = token(p.color);
    el.style.borderRadius = token(p.radius);
    el.style.width = p.width === "fill" ? "100%" : p.width === "content" ? "max-content" : "";
    if (CATALOG[node.type].container) {
      el.style.gap = token(p.gap);
      el.style.alignItems = ({ start: "flex-start", end: "flex-end" })[p.align] ?? p.align;
      el.style.justifyContent = ({ start: "flex-start", end: "flex-end", between: "space-between" })[p.justify] ?? p.justify;
    }
    if (["Button", "Link"].includes(node.type)) {
      setText(record.label, p.label);
      updateIcon(record, p.icon);
      el.dataset.hasIcon = String(Boolean(p.icon));
      place(el, !record.icon ? [record.label] : p.iconPosition === "end"
        ? [record.label, record.icon] : [record.icon, record.label]);
    }
    switch (node.type) {
      case "Screen": el.style.maxWidth = token(p.maxWidth); break;
      case "Row": el.style.flexWrap = p.wrap ? "wrap" : "nowrap"; break;
      case "Grid": el.style.setProperty("--ui-columns", String(p.columns)); break;
      case "Section": el.setAttribute("aria-label", p.label); break;
      case "Card": el.dataset.bordered = String(p.bordered); break;
      case "Heading":
      case "Text":
        setText(el, p.text);
        el.style.fontSize = token(p.size);
        el.style.fontWeight = token(p.weight);
        el.style.textAlign = p.textAlign;
        el.dataset.tone = p.tone ?? "default";
        break;
      case "Button":
        el.dataset.variant = p.variant;
        el.disabled = p.disabled;
        break;
      case "Input":
      case "Textarea":
      case "Select": {
        const control = record.control;
        setText(record.label, p.label);
        control.disabled = p.disabled;
        control.required = p.required;
        if (node.type === "Input") control.type = p.type;
        if (node.type === "Textarea") control.rows = p.rows;
        if (node.type !== "Select") control.placeholder = p.placeholder;
        const optionsChanged = node.type === "Select" && JSON.stringify(old?.options) !== JSON.stringify(p.options);
        if (optionsChanged) {
          const current = control.value;
          control.replaceChildren(...p.options.map(value => {
            const option = element("option");
            option.value = value;
            setText(option, value);
            return option;
          }));
          control.value = p.options.includes(current) ? current : (p.value || p.options[0]);
        }
        if (!old || old.value !== p.value) control.value = p.value || (node.type === "Select" ? p.options[0] : "");
        setText(record.helper, p.helper ?? "");
        record.helper.hidden = !p.helper;
        if (p.helper) control.setAttribute("aria-describedby", record.helper.id);
        else control.removeAttribute("aria-describedby");
        break;
      }
      case "Checkbox":
      case "Switch":
        setText(record.label, p.label);
        if (!old || old.checked !== p.checked) record.control.checked = p.checked;
        record.control.disabled = p.disabled;
        break;
      case "Badge":
        setText(el, p.text);
        el.dataset.tone = p.tone;
        break;
      case "Spacer": el.style.height = token(p.size); break;
      case "Image":
        el.setAttribute("aria-label", p.alt);
        el.dataset.aspect = p.aspect;
        setText(el, `Image / ${p.alt}`);
        break;
      case "Avatar":
        el.setAttribute("aria-label", p.name);
        el.dataset.size = p.size;
        setText(el, p.name.trim().split(/\s+/).slice(0, 2).map(word => [...word][0]).join("").toUpperCase());
        break;
      case "Icon":
        updateIcon(record, p.name, p.size);
        place(el, [record.icon]);
        if (p.label.trim()) {
          el.setAttribute("role", "img");
          el.setAttribute("aria-label", p.label);
          el.removeAttribute("aria-hidden");
        } else {
          el.setAttribute("aria-hidden", "true");
          el.removeAttribute("role");
          el.removeAttribute("aria-label");
        }
        break;
      case "Link":
        el.title = p.destination ? `Preview destination: ${p.destination}` : "Preview link";
        break;
      case "Progress":
        setText(record.label, `${p.label} (${p.value}%)`);
        record.control.value = p.value;
        break;
      case "Stat":
        setText(record.label, p.label);
        setText(record.value, p.value);
        setText(record.detail, p.detail);
        record.detail.hidden = !p.detail;
        break;
      case "Alert":
        setText(record.title, p.title);
        setText(record.text, p.text);
        record.text.hidden = !p.text;
        el.dataset.tone = p.tone;
        break;
      case "List":
        if (JSON.stringify(old?.items) !== JSON.stringify(p.items)) {
          el.replaceChildren(...p.items.map(value => {
            const li = element("li");
            setText(li, value);
            return li;
          }));
        }
        break;
    }
    record.node = node;
  };
  const place = (parent, children) => {
    let cursor = parent.firstChild;
    for (const child of children) {
      if (child !== cursor) {
        if (parent.moveBefore && child.isConnected && parent.isConnected) parent.moveBefore(child, cursor);
        else parent.insertBefore(child, cursor);
      }
      cursor = child.nextSibling;
    }
  };
  const select = id => {
    ensure(id === null || records.has(id), "missing_node", `Node '${id}' does not exist.`);
    if (selectedId) records.get(selectedId)?.el.removeAttribute("data-selected");
    selectedId = id;
    if (id) records.get(id).el.dataset.selected = "true";
  };
  const eventNode = event => {
    const target = event.target?.closest?.("[data-ui-id]");
    return target && surface.contains(target) ? records.get(target.dataset.uiId) : null;
  };
  const click = event => {
    const record = eventNode(event);
    if (!record) return;
    if (mode === "select") {
      event.preventDefault();
      event.stopPropagation();
      select(record.node.id);
      onSelect(record.node.id);
    } else if (["Button", "Link"].includes(record.node.type)) {
      event.preventDefault();
      onEvent({ id: record.node.id, type: "activate", action: record.node.props.action ?? null, destination: record.node.props.destination ?? null });
    }
  };
  const change = event => {
    const record = eventNode(event);
    if (mode === "interact" && record?.control) {
      const control = record.control;
      onEvent({ id: record.node.id, type: "change", value: control.type === "checkbox" ? control.checked : control.value });
    }
  };
  surface.addEventListener("click", click, true);
  surface.addEventListener("change", change);

  return {
    render(document) {
      ensure(!disposed, "renderer_disposed", "This renderer has been disposed.");
      const next = validateDocument(document);
      const focused = surface.contains(owner.activeElement) ? owner.activeElement : null;
      const caret = focused && typeof focused.selectionStart === "number"
        ? [focused.selectionStart, focused.selectionEnd, focused.selectionDirection] : null;
      for (const [key, value] of Object.entries(next.tokens)) {
        if (snapshot?.tokens[key] !== value) {
          surface.style.setProperty(variable(key), `${value}${TOKEN_DEFINITIONS[key].kind === "length" ? "px" : ""}`);
        }
      }
      for (const node of Object.values(next.nodes)) {
        let record = records.get(node.id);
        if (!record || record.el.localName !== tagFor(node) || record.node?.type !== node.type) {
          const replacement = make(node);
          record?.el.replaceWith(replacement.el);
          records.set(node.id, replacement);
          record = replacement;
        }
        if (record.node !== node) update(record, node);
      }
      place(surface, [records.get(next.root).el]);
      const reconcile = id => {
        const node = next.nodes[id];
        if (!CATALOG[node.type].container) return;
        place(records.get(id).el, node.children.map(child => records.get(child).el));
        node.children.forEach(reconcile);
      };
      reconcile(next.root);
      for (const [id, record] of records) {
        if (!Object.hasOwn(next.nodes, id)) {
          record.el.remove();
          records.delete(id);
        }
      }
      snapshot = next;
      select(selectedId && records.has(selectedId) ? selectedId : null);
      if (focused?.isConnected && owner.activeElement !== focused) {
        focused.focus({ preventScroll: true });
        if (caret) focused.setSelectionRange(...caret);
      }
    },
    select,
    setMode(next) {
      ensure(["select", "interact"].includes(next), "invalid_mode", "Use select or interact mode.");
      mode = next;
      surface.dataset.mode = mode;
    },
    getElement(id) { return records.get(id)?.el ?? null; },
    dispose() {
      surface.removeEventListener("click", click, true);
      surface.removeEventListener("change", change);
      records.clear();
      surface.remove();
      disposed = true;
    },
  };
}
