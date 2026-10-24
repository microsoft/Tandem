import { CATALOG, DEFAULT_TOKENS, TOKEN_DEFINITIONS, deepFreeze } from "./catalog.js";
import { LUCIDE_ICONS } from "./lucide-icons.js";

export const LIMITS = deepFreeze({
  nodes: 2000, depth: 64, batch: 64, history: 50, historyBytes: 2_000_000,
  documentCharacters: 500_000, receiptCharacters: 1_000_000,
  line: 32768, stream: 256, receipts: 128,
});
const forbidden = new Set(["__proto__", "prototype", "constructor"]);
const own = (value, key) => Object.hasOwn(value, key);
const validatedDocuments = new WeakSet();
const verified = document => {
  deepFreeze(document);
  validatedDocuments.add(document);
  return document;
};

export class DSLError extends Error {
  constructor(code, message, path = "", details = {}) {
    super(message);
    this.name = "DSLError";
    this.code = code;
    this.path = path;
    this.details = details;
  }
  toJSON() {
    return { code: this.code, message: this.message, path: this.path, details: this.details };
  }
}

export function ensure(condition, code, message, path = "", details = {}) {
  if (!condition) throw new DSLError(code, message, path, details);
}

export function assertRecord(value, path) {
  ensure(value !== null && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value)),
  "invalid_object", "Expected a plain JSON object.", path);
  for (const key of Object.keys(value)) {
    ensure(!forbidden.has(key), "unsafe_key", `Key '${key}' is not allowed.`, path);
  }
}

function keys(value, allowed, required, path) {
  assertRecord(value, path);
  for (const key of Object.keys(value)) {
    ensure(allowed.includes(key), "unknown_field", `Unknown field '${key}'.`, `${path}.${key}`);
    ensure(value[key] !== undefined, "invalid_value", "Undefined is not JSON.", `${path}.${key}`);
  }
  for (const key of required) {
    ensure(own(value, key), "missing_field", `Missing field '${key}'.`, path);
  }
}

export function assertId(id, path = "id") {
  ensure(typeof id === "string" && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id)
    && !forbidden.has(id), "invalid_id", "Use a letter followed by up to 63 letters, digits, '_' or '-'.", path);
}

function validateValue(value, schema, path) {
  if (schema.type === "array") {
    ensure(Array.isArray(value) && value.length >= schema.minItems && value.length <= schema.maxItems,
      "invalid_prop", `Expected ${schema.minItems}-${schema.maxItems} items.`, path);
    value.forEach((entry, index) => validateValue(entry, schema.items, `${path}[${index}]`));
    return [...value];
  }
  const validType = schema.type === "integer" ? Number.isSafeInteger(value) : typeof value === schema.type;
  ensure(validType, "invalid_prop", `Expected ${schema.type}.`, path);
  if (schema.enum) ensure(schema.enum.includes(value), "invalid_prop", `Use one of: ${schema.enum.join(", ")}.`, path);
  if (typeof value === "string") {
    ensure(value.length >= (schema.minLength ?? 0) && value.length <= (schema.maxLength ?? 2000),
      "invalid_prop", "Text length is outside the allowed range.", path);
    if (schema.minLength) ensure(value.trim().length > 0, "invalid_prop", "A visible label is required.", path);
    if (schema.pattern) ensure(new RegExp(schema.pattern).test(value), "invalid_prop", "Invalid value format.", path);
  }
  if (typeof value === "number") {
    ensure(Number.isFinite(value) && value >= schema.minimum && value <= schema.maximum,
      "invalid_prop", `Expected a value from ${schema.minimum} to ${schema.maximum}.`, path);
  }
  return value;
}

export function normalizeProps(type, props, base = {}) {
  ensure(own(CATALOG, type), "unknown_component", `Unknown component '${type}'.`, "type");
  assertRecord(props, "props");
  const { properties, required } = CATALOG[type].props;
  const result = {};
  for (const [key, schema] of Object.entries(properties)) {
    if (own(schema, "default")) result[key] = schema.default;
  }
  Object.assign(result, CATALOG[type].defaults, base);
  for (const [key, value] of Object.entries(props)) {
    ensure(own(properties, key), "unknown_prop", `'${key}' is not a prop of ${type}.`, `props.${key}`);
    result[key] = validateValue(value, properties[key], `props.${key}`);
  }
  for (const key of required) {
    ensure(own(result, key), "missing_prop", `${type} requires '${key}'.`, `props.${key}`);
  }
  if (type === "Select" && result.value !== "") {
    ensure(result.options.includes(result.value), "invalid_prop", "Select value must match an option.", "props.value");
  }
  const iconKey = type === "Icon" ? "name" : ["Button", "Link"].includes(type) ? "icon" : null;
  if (iconKey && result[iconKey]) {
    ensure(Object.hasOwn(LUCIDE_ICONS, result[iconKey]), "unknown_icon",
      `Unknown Lucide icon '${result[iconKey]}'. Use get_icons or searchIcons for bundled names.`, `props.${iconKey}`);
  }
  return result;
}

export function validateToken(key, value) {
  ensure(own(TOKEN_DEFINITIONS, key), "unknown_token", `Unknown token '${key}'.`, "key");
  const rule = TOKEN_DEFINITIONS[key];
  if (rule.kind === "color") {
    ensure(typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value),
      "invalid_token", "Colors must be six-digit hexadecimal values.", "value");
  } else {
    ensure(Number.isSafeInteger(value) && value >= rule.min && value <= rule.max
      && (rule.kind !== "weight" || value % 100 === 0),
    "invalid_token", `Token must be an integer from ${rule.min} to ${rule.max}${rule.kind === "weight" ? " in steps of 100" : ""}.`, "value");
  }
}

export function createDocument({ rootId = "screen", tokens = {} } = {}) {
  assertId(rootId);
  assertRecord(tokens, "tokens");
  for (const [key, value] of Object.entries(tokens)) validateToken(key, value);
  return verified({
    version: 1, revision: 0, root: rootId,
    tokens: { ...DEFAULT_TOKENS, ...tokens },
    nodes: {
      [rootId]: { id: rootId, type: "Screen", parent: null, children: [], props: normalizeProps("Screen", {}) },
    },
  });
}

export function validateDocument(document) {
  if (validatedDocuments.has(document)) return document;
  keys(document, ["version", "revision", "root", "tokens", "nodes"],
    ["version", "revision", "root", "tokens", "nodes"], "document");
  ensure(document.version === 1, "unsupported_version", "Only DSL version 1 is supported.", "version");
  ensure(Number.isSafeInteger(document.revision) && document.revision >= 0,
    "invalid_revision", "Revision must be a non-negative safe integer.", "revision");
  assertId(document.root, "root");
  assertRecord(document.tokens, "tokens");
  for (const [key, value] of Object.entries(document.tokens)) validateToken(key, value);
  for (const key of Object.keys(DEFAULT_TOKENS)) {
    ensure(own(document.tokens, key), "missing_token", `Missing token '${key}'.`, "tokens");
  }
  assertRecord(document.nodes, "nodes");
  const entries = Object.entries(document.nodes);
  ensure(entries.length > 0 && entries.length <= LIMITS.nodes, "node_limit", `Use at most ${LIMITS.nodes} nodes.`, "nodes");
  ensure(own(document.nodes, document.root), "missing_root", "The root node does not exist.", "root");
  const normalized = {};
  for (const [id, node] of entries) {
    assertId(id, "nodes");
    keys(node, ["id", "type", "parent", "children", "props"],
      ["id", "type", "parent", "children", "props"], `nodes.${id}`);
    ensure(node.id === id, "id_mismatch", "Node key and ID must match.", `nodes.${id}.id`);
    ensure(own(CATALOG, node.type), "unknown_component", `Unknown component '${node.type}'.`, `nodes.${id}.type`);
    if (id === document.root) {
      ensure(node.parent === null && node.type === "Screen", "invalid_root", "The root must be a parentless Screen.");
    } else {
      assertId(node.parent, `nodes.${id}.parent`);
      ensure(node.type !== "Screen", "invalid_root", "Only the root may be a Screen.");
    }
    ensure(Array.isArray(node.children) && node.children.length <= LIMITS.nodes,
      "invalid_children", "Children must be an ordered array of node IDs.", `nodes.${id}.children`);
    ensure(CATALOG[node.type].container || node.children.length === 0,
      "leaf_parent", `${node.type} cannot contain children.`, `nodes.${id}.children`);
    node.children.forEach(child => assertId(child, `nodes.${id}.children`));
    normalized[id] = { ...node, children: [...node.children], props: normalizeProps(node.type, node.props) };
  }
  const visited = new Set();
  const walk = (id, depth) => {
    ensure(depth <= LIMITS.depth, "depth_limit", `Maximum depth is ${LIMITS.depth}.`);
    ensure(!visited.has(id), "cycle", "A node cannot appear more than once in the tree.", id);
    visited.add(id);
    for (const child of normalized[id].children) {
      ensure(own(normalized, child), "missing_node", `Child '${child}' does not exist.`, id);
      ensure(normalized[child].parent === id, "parent_mismatch", `Parent link for '${child}' does not match.`, child);
      walk(child, depth + 1);
    }
  };
  walk(document.root, 0);
  ensure(visited.size === entries.length, "orphan_node", "Every node must be reachable from the root.");
  ensure(JSON.stringify({ ...document, nodes: normalized }).length <= LIMITS.documentCharacters,
    "document_limit", `A document may contain at most ${LIMITS.documentCharacters} serialized characters.`);
  return verified({ ...document, tokens: { ...document.tokens }, nodes: normalized });
}

export function validateOperation(op) {
  assertRecord(op, "operation");
  switch (op.op) {
    case "add":
      keys(op, ["op", "parent", "after", "component"], ["op", "parent", "component"], "operation");
      keys(op.component, ["id", "type", "props"], ["id", "type", "props"], "component");
      assertId(op.component.id, "component.id");
      normalizeProps(op.component.type, op.component.props);
      break;
    case "update":
      keys(op, ["op", "id", "props"], ["op", "id", "props"], "operation");
      assertRecord(op.props, "props");
      ensure(Object.keys(op.props).length > 0, "empty_update", "An update must include at least one prop.", "props");
      break;
    case "remove":
      keys(op, ["op", "id"], ["op", "id"], "operation");
      break;
    case "move":
      keys(op, ["op", "id", "parent", "after"], ["op", "id", "parent"], "operation");
      break;
    case "setToken":
      keys(op, ["op", "key", "value"], ["op", "key", "value"], "operation");
      validateToken(op.key, op.value);
      break;
    default:
      throw new DSLError("unknown_operation", "Use add, update, remove, move, or setToken.", "op");
  }
  if (own(op, "id")) assertId(op.id);
  if (own(op, "parent")) assertId(op.parent, "parent");
  if (own(op, "after") && op.after !== null) assertId(op.after, "after");
  return op;
}

function requireNode(document, id) {
  ensure(own(document.nodes, id), "missing_node", `Node '${id}' does not exist.`, "id");
  return document.nodes[id];
}

export function applyOperations(document, operations) {
  document = validateDocument(document);
  ensure(Array.isArray(operations) && operations.length > 0 && operations.length <= LIMITS.batch,
    "batch_limit", `A batch must contain 1-${LIMITS.batch} operations.`);
  const draft = { ...document, nodes: { ...document.nodes }, tokens: document.tokens };
  const replaceChildren = (id, children) => {
    draft.nodes[id] = { ...requireNode(draft, id), children };
  };
  const insert = (parentId, id, after) => {
    const parent = requireNode(draft, parentId);
    ensure(CATALOG[parent.type].container, "leaf_parent", `${parent.type} cannot contain children.`, "parent");
    const children = [...parent.children];
    const index = after === null ? 0 : after === undefined ? children.length : children.indexOf(after) + 1;
    ensure(after === null || after === undefined || index > 0,
      "invalid_anchor", `'${after}' is not a child of '${parentId}'.`, "after");
    children.splice(index, 0, id);
    replaceChildren(parentId, children);
  };
  operations.forEach((raw, index) => {
    try {
      const op = validateOperation(raw);
      if (op.op === "setToken") {
        draft.tokens = { ...draft.tokens, [op.key]: op.value };
        return;
      }
      if (op.op === "add") {
        const { id, type, props } = op.component;
        ensure(!own(draft.nodes, id), "duplicate_id", `Node '${id}' already exists.`, "component.id");
        ensure(type !== "Screen", "invalid_root", "A document has exactly one Screen.");
        insert(op.parent, id, op.after);
        draft.nodes[id] = { id, type, parent: op.parent, children: [], props: normalizeProps(type, props) };
        return;
      }
      const node = requireNode(draft, op.id);
      if (op.op === "update") {
        draft.nodes[op.id] = { ...node, props: normalizeProps(node.type, op.props, node.props) };
        return;
      }
      ensure(op.id !== draft.root, "root_edit", "The root cannot be removed or moved.", "id");
      if (op.op === "remove") {
        const remove = id => {
          draft.nodes[id].children.forEach(remove);
          delete draft.nodes[id];
        };
        replaceChildren(node.parent, draft.nodes[node.parent].children.filter(id => id !== op.id));
        remove(op.id);
        return;
      }
      let ancestor = requireNode(draft, op.parent);
      while (ancestor) {
        ensure(ancestor.id !== op.id, "cycle", "A node cannot move into its own subtree.", "parent");
        ancestor = ancestor.parent === null ? null : draft.nodes[ancestor.parent];
      }
      ensure(op.after !== op.id, "invalid_anchor", "A node cannot be placed after itself.", "after");
      replaceChildren(node.parent, draft.nodes[node.parent].children.filter(id => id !== op.id));
      insert(op.parent, op.id, op.after);
      draft.nodes[op.id] = { ...node, parent: op.parent };
    } catch (error) {
      if (error instanceof DSLError) error.details = { ...error.details, operationIndex: index };
      throw error;
    }
  });
  draft.revision = document.revision + 1;
  const valid = validateDocument(draft);
  // Reuse unchanged records so the DOM renderer can skip untouched components.
  for (const [id, node] of Object.entries(draft.nodes)) {
    if (node === document.nodes[id]) draft.nodes[id] = document.nodes[id];
    else draft.nodes[id] = valid.nodes[id];
  }
  return verified({ ...valid, nodes: draft.nodes, tokens: draft.tokens });
}

export function duplicateOperations(document, id) {
  const node = requireNode(document, id);
  ensure(id !== document.root, "root_edit", "Select a component inside the screen to duplicate.");
  const operations = [];
  const allocated = new Set(Object.keys(document.nodes));
  const visit = (source, parent, after) => {
    let suffix = 1;
    let nextId;
    do nextId = `${source.id.slice(0, 52)}_copy${suffix++}`;
    while (allocated.has(nextId));
    allocated.add(nextId);
    const operation = { op: "add", parent, component: { id: nextId, type: source.type, props: source.props } };
    if (after !== undefined) operation.after = after;
    operations.push(operation);
    source.children.forEach(child => visit(document.nodes[child], nextId));
  };
  visit(node, node.parent, id);
  ensure(operations.length <= LIMITS.batch, "batch_limit", `Duplicate supports subtrees up to ${LIMITS.batch} nodes.`);
  return operations;
}

export class DocumentStore {
  #document;
  #past = [];
  #future = [];
  #receipts = [];
  #listeners = new Set();

  constructor(document = createDocument()) {
    this.#document = validateDocument(document);
  }
  getSnapshot() { return this.#document; }
  get canUndo() { return this.#past.length > 0; }
  get canRedo() { return this.#future.length > 0; }
  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  #emit(event) {
    for (const listener of this.#listeners) listener(event);
  }
  #checkRevision(expectedRevision) {
    ensure(Number.isSafeInteger(expectedRevision) && expectedRevision === this.#document.revision,
      "revision_conflict", "The document changed. Read fresh context before retrying.", "baseRevision",
      { expected: expectedRevision, actual: this.#document.revision });
  }
  #receipt(requestId, fingerprint) {
    if (requestId === undefined) return null;
    ensure(typeof requestId === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(requestId),
      "invalid_request_id", "Use a unique, short request ID.", "requestId");
    const receipt = this.#receipts.find(entry => entry.requestId === requestId);
    if (receipt) {
      ensure(receipt.fingerprint === fingerprint, "request_reused", "Request ID was already used for different edits.", "requestId");
      return { ...receipt.result, revision: this.#document.revision, originalRevision: receipt.result.revision, deduplicated: true };
    }
    return null;
  }
  #remember(requestId, fingerprint, result) {
    if (requestId !== undefined) {
      this.#receipts.push({ requestId, fingerprint, result });
      this.#receipts = this.#receipts.slice(-LIMITS.receipts);
      while (this.#receipts.length > 1 && JSON.stringify(this.#receipts).length > LIMITS.receiptCharacters) {
        this.#receipts.shift();
      }
    }
  }
  #trimHistory() {
    this.#past = this.#past.slice(-LIMITS.history);
    while (this.#past.length && JSON.stringify(this.#past).length > LIMITS.historyBytes) this.#past.shift();
  }
  apply(operations, { expectedRevision = this.#document.revision, requestId, editId, label = "Edit" } = {}) {
    const ops = Array.isArray(operations) ? operations : [operations];
    const fingerprint = JSON.stringify({ kind: "apply", ops, editId, label });
    return this.#apply(ops, { expectedRevision, requestId, editId, label }, fingerprint);
  }
  editSelection(command, id, options = {}) {
    ensure(command === "delete" || command === "duplicate", "unknown_command", "Use delete or duplicate.");
    assertId(id);
    const label = command === "delete" ? "Delete selection" : "Duplicate selection";
    const fingerprint = JSON.stringify({ kind: command, id, editId: options.editId, label });
    const receipt = this.#receipt(options.requestId, fingerprint);
    if (receipt) return receipt;
    const ops = command === "delete" ? [{ op: "remove", id }] : duplicateOperations(this.#document, id);
    return this.#apply(ops, {
      ...options, expectedRevision: options.expectedRevision ?? this.#document.revision, label,
    }, fingerprint);
  }
  #apply(ops, { expectedRevision, requestId, editId, label }, fingerprint) {
    ensure(typeof label === "string" && label.length <= 200, "invalid_label", "Use a label of at most 200 characters.");
    ensure(editId === undefined || (typeof editId === "string" && editId.length > 0 && editId.length <= 128),
      "invalid_edit_id", "Use an edit ID of 1-128 characters.");
    const receipt = this.#receipt(requestId, fingerprint);
    if (receipt) return receipt;
    this.#checkRevision(expectedRevision);
    const before = this.#document;
    const after = applyOperations(before, ops);
    const previous = this.#past.at(-1);
    if (editId && previous?.editId === editId && this.#future.length === 0) {
      this.#past[this.#past.length - 1] = { ...previous, after };
    } else {
      this.#past.push({ before, after, editId: editId ?? null, label });
    }
    this.#future = [];
    this.#document = after;
    this.#trimHistory();
    const result = { revision: after.revision, applied: ops.length, deduplicated: false };
    this.#remember(requestId, fingerprint, result);
    this.#emit({ type: "patch", document: after, operations: ops, previousRevision: before.revision, label });
    return result;
  }
  #travel(direction, { expectedRevision = this.#document.revision, requestId } = {}) {
    const receipt = this.#receipt(requestId, direction);
    if (receipt) return receipt;
    this.#checkRevision(expectedRevision);
    ensure(this.#document.revision < Number.MAX_SAFE_INTEGER, "revision_limit", "The revision limit has been reached.");
    const source = direction === "undo" ? this.#past : this.#future;
    const target = direction === "undo" ? this.#future : this.#past;
    ensure(source.length > 0, "empty_history", `Nothing to ${direction}.`);
    const entry = source.pop();
    target.push(entry);
    const next = direction === "undo" ? entry.before : entry.after;
    this.#document = verified({ ...next, revision: this.#document.revision + 1 });
    const result = { revision: this.#document.revision, applied: 1, deduplicated: false };
    this.#remember(requestId, direction, result);
    this.#emit({ type: "snapshot", document: this.#document, label: `${direction}: ${entry.label}` });
    return result;
  }
  undo(options) { return this.#travel("undo", options); }
  redo(options) { return this.#travel("redo", options); }
  fork() {
    const store = new DocumentStore();
    store.#document = this.#document;
    store.#past = [...this.#past];
    store.#future = [...this.#future];
    store.#receipts = [...this.#receipts];
    return store;
  }
  serialize() {
    return JSON.parse(JSON.stringify({
      document: this.#document, past: this.#past, future: this.#future, receipts: this.#receipts,
    }));
  }
  static restore(state) {
    keys(state, ["document", "past", "future", "receipts"], ["document", "past", "future", "receipts"], "state");
    const store = new DocumentStore(state.document);
    const restoreHistory = entries => {
      ensure(Array.isArray(entries) && entries.length <= LIMITS.history, "invalid_history", "Invalid history length.");
      ensure(JSON.stringify(entries).length <= LIMITS.historyBytes, "invalid_history", "History exceeds its storage budget.");
      return entries.map(entry => {
        keys(entry, ["before", "after", "label", "editId"], ["before", "after", "label", "editId"], "history");
        ensure(typeof entry.label === "string" && entry.label.length <= 200
          && (entry.editId === null || (typeof entry.editId === "string" && entry.editId.length <= 128)),
        "invalid_history", "Invalid history metadata.");
        return deepFreeze({ ...entry, before: validateDocument(entry.before), after: validateDocument(entry.after) });
      });
    };
    store.#past = restoreHistory(state.past);
    store.#future = restoreHistory(state.future);
    ensure(Array.isArray(state.receipts) && state.receipts.length <= LIMITS.receipts,
      "invalid_receipts", "Invalid retry receipt list.");
    ensure(JSON.stringify(state.receipts).length <= LIMITS.receiptCharacters + LIMITS.line * LIMITS.batch,
      "invalid_receipts", "Retry receipts exceed their storage budget.");
    for (const receipt of state.receipts) {
      keys(receipt, ["requestId", "fingerprint", "result"], ["requestId", "fingerprint", "result"], "receipt");
      ensure(typeof receipt.fingerprint === "string" && receipt.fingerprint.length <= 1_000_000,
        "invalid_receipts", "Invalid retry fingerprint.");
      store.#receipt(receipt.requestId, receipt.fingerprint);
      keys(receipt.result, ["revision", "applied", "deduplicated"], ["revision", "applied", "deduplicated"], "receipt.result");
      ensure(Number.isSafeInteger(receipt.result.revision) && receipt.result.revision >= 0
        && receipt.result.revision <= store.#document.revision
        && Number.isSafeInteger(receipt.result.applied) && receipt.result.applied > 0
        && receipt.result.deduplicated === false, "invalid_receipts", "Invalid retry result.");
      store.#receipts.push(deepFreeze(JSON.parse(JSON.stringify(receipt))));
    }
    return store;
  }
}
