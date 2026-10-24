export function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

const colors = {
  background: "#f6f8fa", surface: "#ffffff", text: "#1f2328",
  muted: "#59636e", primary: "#0969da", onPrimary: "#ffffff",
  border: "#d1d9e0", subtle: "#eef2f6", success: "#1a7f37",
  warning: "#9a6700", danger: "#cf222e",
};

export const TOKEN_DEFINITIONS = deepFreeze(Object.fromEntries([
  ...Object.entries(colors).map(([key, value]) =>
    [`color.${key}`, { kind: "color", default: value }]),
  ...[0, 4, 8, 12, 16, 24, 32, 48, 64].map((value, index) =>
    [`space.${index}`, { kind: "length", default: value, min: 0, max: 128 }]),
  ...Object.entries({ none: 0, sm: 4, md: 8, lg: 12, full: 999 }).map(([key, value]) =>
    [`radius.${key}`, { kind: "length", default: value, min: 0, max: 999 }]),
  ...Object.entries({ caption: 12, body: 14, large: 18, title: 24, hero: 36 }).map(([key, value]) =>
    [`font.size.${key}`, { kind: "length", default: value, min: 10, max: 72 }]),
  ...Object.entries({ regular: 400, medium: 500, semibold: 600, bold: 700 }).map(([key, value]) =>
    [`font.weight.${key}`, { kind: "weight", default: value, min: 400, max: 800 }]),
  ...Object.entries({ narrow: 560, content: 960, wide: 1200 }).map(([key, value]) =>
    [`size.${key}`, { kind: "length", default: value, min: 240, max: 1600 }]),
]));

export const DEFAULT_TOKENS = deepFreeze(Object.fromEntries(
  Object.entries(TOKEN_DEFINITIONS).map(([key, rule]) => [key, rule.default]),
));

const text = (defaultValue, maxLength = 2000) => ({
  type: "string", maxLength, ...(defaultValue === undefined ? {} : { default: defaultValue }),
});
const label = () => ({ ...text(undefined, 200), minLength: 1 });
const choice = (values, defaultValue) => ({
  type: "string", enum: values, ...(defaultValue === undefined ? {} : { default: defaultValue }),
});
const bool = (value = false) => ({ type: "boolean", default: value });
const integer = (min, max, value) => ({
  type: "integer", minimum: min, maximum: max,
  ...(value === undefined ? {} : { default: value }),
});
const token = (prefix, value) =>
  choice(Object.keys(TOKEN_DEFINITIONS).filter(key => key.startsWith(`${prefix}.`)), value);
const strings = { type: "array", minItems: 1, maxItems: 50, items: label() };
const common = {
  padding: token("space"), background: token("color"), color: token("color"),
  radius: token("radius"), width: choice(["auto", "fill", "content"]),
};
const layout = {
  gap: token("space", "space.4"),
  align: choice(["start", "center", "end", "stretch"], "stretch"),
  justify: choice(["start", "center", "end", "between"], "start"),
};
const typography = {
  size: token("font.size", "font.size.body"),
  weight: token("font.weight", "font.weight.regular"),
  textAlign: choice(["left", "center", "right"], "left"),
};
const input = {
  label: label(), value: text(""), placeholder: text("", 200),
  disabled: bool(), required: bool(), helper: text("", 300),
};
const iconName = {
  type: "string", maxLength: 100, pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
  description: "Canonical kebab-case name from bundled Lucide; use get_icons or searchIcons to look up names.",
};
const inlineIcon = {
  icon: { ...iconName, pattern: "^(?:[a-z0-9]+(?:-[a-z0-9]+)*)?$", default: "" },
  iconPosition: choice(["start", "end"], "start"),
};
const component = (container, properties, required = [], defaults = {}) => ({
  container,
  props: {
    type: "object", additionalProperties: false,
    properties: { ...common, ...properties }, required,
  },
  defaults,
});

export const CATALOG = deepFreeze({
  Screen: component(true, { ...layout, maxWidth: token("size", "size.wide") }, [], {
    padding: "space.6", background: "color.background",
  }),
  Stack: component(true, layout),
  Row: component(true, { ...layout, wrap: bool(true) }),
  Grid: component(true, { ...layout, columns: integer(1, 6, 2) }),
  Card: component(true, { ...layout, bordered: bool(true) }, [], {
    padding: "space.5", background: "color.surface", radius: "radius.lg",
  }),
  Section: component(true, { ...layout, label: label() }, ["label"]),
  Heading: component(false, {
    ...typography, text: label(), level: integer(1, 6, 2),
  }, ["text"], { size: "font.size.title", weight: "font.weight.bold" }),
  Text: component(false, { ...typography, text: text(), tone: choice(["default", "muted"], "default") }, ["text"]),
  Button: component(false, {
    ...inlineIcon,
    label: label(), variant: choice(["primary", "secondary", "ghost", "danger"], "primary"),
    disabled: bool(), action: { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_-]{0,63}$" },
  }, ["label"]),
  Input: component(false, {
    ...input, type: choice(["text", "email", "password", "number", "search", "tel", "url"], "text"),
  }, ["label"]),
  Textarea: component(false, { ...input, rows: integer(2, 12, 4) }, ["label"]),
  Select: component(false, {
    label: label(), options: strings, value: text("", 200), disabled: bool(), required: bool(),
  }, ["label", "options"]),
  Checkbox: component(false, { label: label(), checked: bool(), disabled: bool() }, ["label"]),
  Switch: component(false, { label: label(), checked: bool(), disabled: bool() }, ["label"]),
  Badge: component(false, {
    text: label(), tone: choice(["neutral", "primary", "success", "warning", "danger"], "neutral"),
  }, ["text"]),
  Divider: component(false, {}),
  Spacer: component(false, { size: token("space", "space.4") }),
  Image: component(false, {
    alt: label(), aspect: choice(["wide", "square", "portrait"], "wide"),
  }, ["alt"]),
  Avatar: component(false, {
    name: label(), size: choice(["sm", "md", "lg"], "md"),
  }, ["name"]),
  Icon: component(false, {
    name: iconName, size: choice(["sm", "md", "lg"], "md"), label: text("", 200),
  }, ["name"]),
  Link: component(false, { ...inlineIcon, label: label(), destination: text("", 200) }, ["label"]),
  Progress: component(false, { label: label(), value: integer(0, 100, 0) }, ["label"]),
  Stat: component(false, { label: label(), value: label(), detail: text("", 300) }, ["label", "value"]),
  Alert: component(false, {
    title: label(), text: text(""), tone: choice(["info", "success", "warning", "danger"], "info"),
  }, ["title"]),
  List: component(false, { items: strings, ordered: bool() }, ["items"]),
});

export const ID_SCHEMA = deepFreeze({
  type: "string", pattern: "^[A-Za-z][A-Za-z0-9_-]{0,63}$", maxLength: 64,
});
const propsSchema = { type: "object", maxProperties: 24 };
const afterSchema = { anyOf: [ID_SCHEMA, { type: "null" }] };
const operation = (op, properties, required) => ({
  type: "object", additionalProperties: false,
  properties: { op: { const: op }, ...properties }, required: ["op", ...required],
});

export const OPERATION_SCHEMA = deepFreeze({
  oneOf: [
    operation("add", {
      parent: ID_SCHEMA, after: afterSchema,
      component: {
        type: "object", additionalProperties: false,
        properties: { id: ID_SCHEMA, type: { enum: Object.keys(CATALOG) }, props: propsSchema },
        required: ["id", "type", "props"],
      },
    }, ["parent", "component"]),
    operation("update", { id: ID_SCHEMA, props: propsSchema }, ["id", "props"]),
    operation("remove", { id: ID_SCHEMA }, ["id"]),
    operation("move", { id: ID_SCHEMA, parent: ID_SCHEMA, after: afterSchema }, ["id", "parent"]),
    operation("setToken", {
      key: { enum: Object.keys(TOKEN_DEFINITIONS) },
      value: { anyOf: [{ type: "string" }, { type: "number" }] },
    }, ["key", "value"]),
  ],
});
