import source from "./human-loop.json" with { type: "json" };

function fail(path, message) {
  throw new TypeError(`Human-loop prompts: ${path} ${message}`);
}

function keys(value, expected, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Reflect.ownKeys(value).length !== expected.length
    || expected.some((key) => !Object.hasOwn(value, key))) {
    fail(path, `must contain exactly ${expected.join(", ")}.`);
  }
}

function lines(value, path) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 64) {
    fail(path, "must be an array of 1–64 instruction strings.");
  }
  for (let index = 0; index < value.length; index++) {
    const line = value[index];
    if (typeof line !== "string" || !line.trim() || line.length > 8192) {
      fail(`${path}[${index}]`, "must be a nonempty string of at most 8192 characters.");
    }
  }
}

function freeze(value) {
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") freeze(child);
  }
  return Object.freeze(value);
}

export function validateHumanLoopPrompts(value) {
  const legacy = Object.hasOwn(value ?? {}, "cooperativeStop") ? ["cooperativeStop"] : [];
  keys(value, ["schemaVersion", "wrapper", "shared", "roles", "sketchRules", "designRules", "reviewScope", "missingResultRecovery", ...legacy], "root");
  if (value.schemaVersion !== "human-loop-prompts/v1") fail("schemaVersion", "must be human-loop-prompts/v1.");
  for (const name of ["wrapper", "shared", "sketchRules", "designRules", "reviewScope", "missingResultRecovery", ...legacy]) lines(value[name], name);
  keys(value.roles, ["router", "designer", "planner", "implementer", "reviewer", "agent"], "roles");
  for (const name of ["router", "designer", "planner", "reviewer", "agent"]) lines(value.roles[name], `roles.${name}`);
  keys(value.roles.implementer, ["task", "aggregate"], "roles.implementer");
  for (const name of ["task", "aggregate"]) lines(value.roles.implementer[name], `roles.implementer.${name}`);
  return freeze(value);
}

export const humanLoopPrompts = validateHumanLoopPrompts(source);
