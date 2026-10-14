export const idSchema = {
  type: 'string',
  minLength: 1,
  maxLength: 40,
  pattern: '^[a-z][a-z0-9-]*$',
} as const;

export type ImplementationState =
  | 'planned'
  | 'in-progress'
  | 'implemented'
  | 'verified';

export const implementationStates = [
  'planned',
  'in-progress',
  'implemented',
  'verified',
] as const;

export function normalizeImplementationState(
  value: unknown,
): ImplementationState | undefined {
  if (value === 'blocked' || value === 'stale') {
    return 'in-progress';
  }
  return implementationStates.includes(value as ImplementationState)
    ? value as ImplementationState
    : undefined;
}

export interface ImplementationTracked {
  implementationState?: ImplementationState;
}

export interface AttentionItem {
  id: string;
  impact: 'blocking' | 'non-blocking';
  question: string;
  whyItMatters: string;
  alternatives: Array<{
    option: string;
    implication: string;
  }>;
}

export interface AttentionTracked {
  attention?: AttentionItem[];
}

export interface DesignEntityMetadata extends AttentionTracked {}

export const implementationStateSchema = {
  type: 'string',
  enum: implementationStates,
} as const;

export const implementationStateProperty = {
  implementationState: implementationStateSchema,
} as const;

export const attentionItemsSchema = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: idSchema,
      impact: {
        type: 'string',
        enum: ['blocking', 'non-blocking'],
      },
      question: { type: 'string', minLength: 1, maxLength: 140 },
      whyItMatters: { type: 'string', minLength: 1, maxLength: 160 },
      alternatives: {
        type: 'array',
        minItems: 2,
        maxItems: 3,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            option: { type: 'string', minLength: 1, maxLength: 60 },
            implication: { type: 'string', minLength: 1, maxLength: 120 },
          },
          required: ['option', 'implication'],
        },
      },
    },
    required: ['id', 'impact', 'question', 'whyItMatters', 'alternatives'],
  },
} as const;

export const attentionProperty = {
  attention: attentionItemsSchema,
} as const;

export const designEntityProperties = {
  ...attentionProperty,
} as const;

export const ruleSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: idSchema,
    statement: { type: 'string', minLength: 1, maxLength: 120 },
    ...designEntityProperties,
  },
  required: ['id', 'statement'],
} as const;
