export function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Workflow: ${message}`);
  }
}

export function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  requireCondition(value !== null && typeof value === 'object' && !Array.isArray(value), 'expected an object.');
  const result = value as Record<string, unknown>;
  requireCondition(
    Object.keys(result).every((key) => keys.includes(key))
      && keys.every((key) => Object.hasOwn(result, key)),
    `expected exactly these fields: ${keys.join(', ')}.`,
  );
  return result;
}

export function text(value: unknown): string {
  requireCondition(typeof value === 'string' && value.trim().length > 0, 'expected non-empty text.');
  return value;
}

export function integer(value: unknown, minimum = 0): number {
  requireCondition(typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum, 'expected a safe integer.');
  return value;
}

export function list<T>(value: unknown, parse: (entry: unknown) => T): T[] {
  requireCondition(Array.isArray(value), 'expected an array.');
  return value.map(parse);
}

export function unique(values: readonly string[]): void {
  requireCondition(new Set(values).size === values.length, 'duplicate identities are not allowed.');
}

export function strings(value: unknown): string[] {
  const result = list(value, text);
  unique(result);
  return result;
}

export function choice<T extends string>(value: unknown, choices: readonly T[]): T {
  const result = choices.find((candidate) => candidate === value);
  requireCondition(result !== undefined, `expected one of: ${choices.join(', ')}.`);
  return result;
}

export function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && new Set(left).size === left.length
    && left.every((entry) => right.includes(entry));
}
