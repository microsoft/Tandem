export const APPLICATION_PROTOCOL = 'tandem-application/v1' as const;

export type ApplicationActor = 'agent' | 'user';
export type ApplicationInput = Record<string, unknown>;
export interface ApplicationSchema {
  type?: string | readonly string[];
  properties?: Record<string, ApplicationSchema>;
  required?: readonly string[];
  additionalProperties?: boolean | ApplicationSchema;
  items?: ApplicationSchema;
  anyOf?: readonly ApplicationSchema[];
  oneOf?: readonly ApplicationSchema[];
  enum?: readonly unknown[];
  const?: unknown;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  description?: string;
}

export interface ApplicationOperation {
  id: string;
  description: string;
  method: 'GET' | 'POST';
  path: string;
  inputSchema: ApplicationSchema;
  authority: 'agent' | 'user';
  humanActions?: readonly string[];
  query?: readonly string[];
  pathParameters?: readonly string[];
  retry: 'read' | 'identity' | 'inspect';
}

export interface ApplicationBlocker { code: string; message: string }
export interface ApplicationAvailability {
  status: 'available' | 'blocked' | 'human-required';
  blockers: ApplicationBlocker[];
}
export interface ApplicationReply { status: number; body: unknown }
export type ApplicationRespond = (status: number, body: unknown) => void;
export interface ApplicationRequest { method: 'GET' | 'POST'; path: string; input: ApplicationInput }
export interface ApplicationCommand {
  protocol: typeof APPLICATION_PROTOCOL;
  operation: string;
  input: ApplicationInput;
}

export class ApplicationError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details: unknown;
  constructor(code: string, message: string, statusCode = 409, details?: unknown) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export const objectSchema = (properties: Record<string, ApplicationSchema> = {}, required: readonly string[] = []): ApplicationSchema =>
  ({ type: 'object', additionalProperties: false, properties, required });
export const stringSchema = (maxLength = 4000, minLength = 1): ApplicationSchema => ({ type: 'string', minLength, maxLength });
export const idSchema: ApplicationSchema = { ...stringSchema(200), pattern: '^[A-Za-z0-9._:-]+$' };
export const booleanSchema: ApplicationSchema = { type: 'boolean' };
export const revisionSchema: ApplicationSchema = { type: 'integer', minimum: 0 };
export const nullableSchema = (schema: ApplicationSchema): ApplicationSchema => ({ anyOf: [schema, { type: 'null' }] });
export const enumSchema = (...values: string[]): ApplicationSchema => ({ type: 'string', enum: values });

export function isApplicationInput(value: unknown): value is ApplicationInput {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function applicationFailure(error: unknown, fallbackStatus = 500) {
  const fields = isApplicationInput(error) ? error : {};
  return {
    code: typeof fields.code === 'string' ? fields.code : 'operation_failed',
    message: error instanceof Error ? error.message : typeof fields.message === 'string' ? fields.message : String(error),
    statusCode: Number.isInteger(fields.statusCode) && Number(fields.statusCode) >= 400 && Number(fields.statusCode) <= 599
      ? Number(fields.statusCode) : fallbackStatus,
    ...(fields.details !== undefined ? { details: fields.details } : {}),
  };
}

/** Transport validation is deliberately separate from each owner's semantic validation. */
export function validateApplicationInput(value: unknown, schema: ApplicationSchema, path = 'input'): void {
  const invalid = (reason: string): never => { throw new ApplicationError('invalid_input', `${path} ${reason}`, 400); };
  const alternatives = schema.anyOf ?? schema.oneOf;
  if (alternatives) {
    let matches = 0;
    for (const alternative of alternatives) {
      try { validateApplicationInput(value, alternative, path); matches++; }
      catch (error) { if (!(error instanceof ApplicationError)) throw error; }
    }
    if (!matches || schema.oneOf && matches !== 1) invalid('does not match its declared schema.');
  }
  if ('const' in schema && value !== schema.const || schema.enum && !schema.enum.includes(value)) invalid('has an unsupported value.');
  const types = typeof schema.type === 'string' ? [schema.type] : schema.type;
  const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (types && !types.includes(actual) && !(actual === 'number' && types.includes('integer') && Number.isSafeInteger(value))) {
    invalid(`must be ${types.join(' or ')}.`);
  }
  if (typeof value === 'string' && (value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? Infinity)
    || schema.pattern && !new RegExp(schema.pattern).test(value))) invalid('has an invalid length or format.');
  if (typeof value === 'number' && (!Number.isFinite(value) || value < (schema.minimum ?? -Infinity)
    || value > (schema.maximum ?? Infinity))) invalid('is outside its allowed range.');
  if (Array.isArray(value)) {
    if (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity)
      || schema.uniqueItems && new Set(value.map(item => JSON.stringify(item))).size !== value.length) invalid('has invalid entries.');
    if (schema.items) value.forEach((item, index) => validateApplicationInput(item, schema.items!, `${path}[${index}]`));
  }
  if (isApplicationInput(value)) {
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) invalid(`requires ${key}.`);
    for (const [key, item] of Object.entries(value)) {
      const property = Object.hasOwn(schema.properties ?? {}, key) ? schema.properties?.[key] : undefined;
      if (property) validateApplicationInput(item, property, `${path}.${key}`);
      else if (schema.additionalProperties === false) invalid(`does not accept ${key}.`);
      else if (isApplicationInput(schema.additionalProperties)) validateApplicationInput(item, schema.additionalProperties, `${path}.${key}`);
    }
  }
}

export function readApplicationCommand(value: unknown): ApplicationCommand {
  validateApplicationInput(value, objectSchema({
    protocol: { const: APPLICATION_PROTOCOL }, operation: stringSchema(120), input: { type: 'object' },
  }, ['protocol', 'operation', 'input']));
  if (!isApplicationInput(value) || !isApplicationInput(value.input) || typeof value.operation !== 'string') {
    throw new ApplicationError('invalid_command', 'Supply a versioned operation and its input object.', 400);
  }
  return { protocol: APPLICATION_PROTOCOL, operation: value.operation, input: value.input };
}

export function findApplicationOperation<T extends ApplicationOperation>(operations: readonly T[], id: string): T {
  const operation = operations.find(item => item.id === id);
  if (!operation) throw new ApplicationError('unknown_operation', `Unknown operation: ${id}. Inspect the application catalog.`, 404);
  return operation;
}

export function applicationAvailability(operation: ApplicationOperation, actor: ApplicationActor,
  blockers: ApplicationBlocker[] = [], input?: ApplicationInput): ApplicationAvailability {
  if (actor === 'agent' && (operation.authority === 'user'
    || input && operation.humanActions?.includes(String(input.action ?? input.decision)))) {
    return { status: 'human-required', blockers: [...blockers, {
      code: 'human_decision_required', message: 'This decision belongs to the user. Present the current application review; do not approve it on their behalf.',
    }] };
  }
  return { status: blockers.length ? 'blocked' : 'available', blockers };
}

export function assertApplicationAvailable(availability: ApplicationAvailability): void {
  const blocker = availability.blockers[0];
  if (availability.status !== 'available') throw new ApplicationError(
    availability.status === 'human-required' ? 'human_decision_required' : blocker?.code ?? 'operation_blocked',
    availability.status === 'human-required' ? availability.blockers.at(-1)!.message : blocker!.message);
}

export function describeApplicationOperation(operation: ApplicationOperation, availability: ApplicationAvailability, schema = false) {
  return { id: operation.id, description: operation.description, effect: operation.method === 'GET' ? 'read' : 'command',
    authority: operation.authority, humanActions: operation.humanActions ?? [], retry: operation.retry, availability,
    inputRequired: Boolean(operation.inputSchema.required?.length),
    ...(schema ? { inputSchema: operation.inputSchema } : {}) };
}

export function applicationRequest(operation: ApplicationOperation, input: ApplicationInput): ApplicationRequest {
  validateApplicationInput(input, operation.inputSchema);
  let path = operation.path;
  const body = { ...input };
  for (const key of operation.pathParameters ?? []) {
    if (typeof input[key] !== 'string') throw new ApplicationError('invalid_input', `Supply ${key}.`, 400);
    path = path.replace(`:${key}`, encodeURIComponent(input[key]));
    delete body[key];
  }
  const query = new URLSearchParams();
  for (const key of operation.query ?? []) {
    if (input[key] !== undefined) query.set(key, String(input[key]));
    delete body[key];
  }
  return { method: operation.method, path: `${path}${query.size ? `?${query}` : ''}`, input: body };
}

export function matchApplicationOperation(operations: readonly ApplicationOperation[], method: string, path: string,
  body: ApplicationInput = {}): { operation: ApplicationOperation; input: ApplicationInput } | undefined {
  const url = new URL(path, 'http://127.0.0.1');
  for (const operation of operations) {
    if (method !== operation.method) continue;
    const keys = operation.pathParameters ?? [];
    const pattern = operation.path.split('/').map(part => part.startsWith(':') && keys.includes(part.slice(1))
      ? '([^/]+)' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('/');
    const match = new RegExp(`^${pattern}$`).exec(url.pathname);
    if (!match) continue;
    const input = { ...body };
    keys.forEach((key, index) => { input[key] = decodeURIComponent(match[index + 1]!); });
    for (const [key, value] of url.searchParams) {
      if (!operation.query?.includes(key)) throw new ApplicationError('invalid_input', `Unexpected query field ${key}.`, 400);
      input[key] = operation.inputSchema.properties?.[key]?.type === 'integer' ? Number(value) : value;
    }
    return { operation, input };
  }
  return undefined;
}

export async function collectApplicationReply(dispatch: (respond: ApplicationRespond) => Promise<void>): Promise<ApplicationReply> {
  let reply: ApplicationReply | undefined;
  try {
    await dispatch((status, body) => {
      if (reply) throw new ApplicationError('duplicate_response', 'An application operation returned more than one result.', 500);
      reply = { status, body };
    });
  } catch (error) {
    if (reply && reply.status >= 200 && reply.status < 300) {
      const failure = applicationFailure(error);
      throw new ApplicationError(failure.code, failure.message, failure.statusCode, {
        accepted: true, acknowledgement: reply.body, error: failure.details ?? null,
      });
    }
    throw error;
  }
  if (!reply) throw new ApplicationError('missing_response', 'The application operation did not return a result.', 500);
  return reply;
}
