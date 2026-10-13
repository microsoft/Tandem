import {
  attentionProperty,
  idSchema,
  designEntityProperties,
  type AttentionTracked,
  type DesignEntityMetadata,
  implementationStateProperty,
  type ImplementationTracked,
} from './schema-primitives.ts';

export interface UseCaseBlock extends AttentionTracked, ImplementationTracked {
  id: string;
  title: string;
  actor: string;
  outcome: string;
  steps: Array<{
    id: string;
    userAction: string;
    systemResponse: string;
    interactionId: string;
  } & DesignEntityMetadata>;
}

export const useCaseBlockSchema = {
  type: 'array',
  minItems: 2,
  maxItems: 7,
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: idSchema,
      ...attentionProperty,
      ...implementationStateProperty,
      title: { type: 'string', minLength: 1, maxLength: 80 },
      actor: { type: 'string', minLength: 1, maxLength: 50 },
      outcome: { type: 'string', minLength: 1, maxLength: 120 },
      steps: {
        type: 'array',
        minItems: 1,
        maxItems: 6,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: idSchema,
            ...designEntityProperties,
            userAction: { type: 'string', minLength: 1, maxLength: 100 },
            systemResponse: { type: 'string', minLength: 1, maxLength: 120 },
            interactionId: idSchema,
          },
          required: ['id', 'userAction', 'systemResponse', 'interactionId'],
        },
      },
    },
    required: ['id', 'title', 'actor', 'outcome', 'steps'],
  },
} as const;

export function validateUseCaseBlock(
  useCases: UseCaseBlock[],
  interactionIds: ReadonlySet<string>,
): Set<string> {
  const useCaseIds = new Set<string>();
  for (const useCase of useCases) {
    if (useCaseIds.has(useCase.id)) {
      throw new Error(`Use-case ID must be unique: ${useCase.id}.`);
    }
    useCaseIds.add(useCase.id);
    const stepIds = new Set<string>();
    for (const step of useCase.steps) {
      if (stepIds.has(step.id)) {
        throw new Error(`Use-case step ID must be unique within ${useCase.id}: ${step.id}.`);
      }
      stepIds.add(step.id);
      if (!interactionIds.has(step.interactionId)) {
        throw new Error(
          `Use-case step ${step.id} references unknown interaction ${step.interactionId}.`,
        );
      }
    }
  }
  return useCaseIds;
}
