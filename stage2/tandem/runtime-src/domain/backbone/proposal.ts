import {
  contractBlockSchema,
  type ContractBlock,
  validateContractBlock,
} from './contract-block.ts';
import {
  flowBlockSchema,
  type FlowBlock,
  validateFlowBlock,
} from './flow-block.ts';
import {
  guiBlockSchema,
  type GuiSketchBlock,
  validateGuiBlock,
} from './gui-block.ts';
import {
  idSchema,
  implementationStates,
  implementationStateSchema,
  type AttentionItem,
  type ImplementationState,
} from './schema-primitives.ts';
import {
  systemBlockSchema,
  type SystemStackBlock,
  validateSystemBlock,
} from './system-block.ts';
import {
  useCaseBlockSchema,
  type UseCaseBlock,
  validateUseCaseBlock,
} from './use-case-block.ts';
import { LEGACY_V1_POLICY, parsePolicySnapshot, type PolicySnapshot } from '../workflow/policy.ts';

export type DesignAspectKind = 'contract' | 'control-flow' | 'system' | 'gui';
export type DesignPerspective = 'use-case' | 'contract' | 'flow' | 'gui' | 'system';

export interface ImplementationStateUpdate {
  perspective: DesignPerspective;
  elementId: string;
  implementationState: ImplementationState;
}

const perspectiveNames: Record<DesignPerspective, string> = {
  'use-case': 'Use case',
  contract: 'Contract',
  flow: 'Flow',
  gui: 'GUI',
  system: 'System',
};

const blockByPerspective: Record<DesignPerspective, keyof BackboneBlocks> = {
  'use-case': 'useCases',
  contract: 'contract',
  flow: 'controlFlows',
  gui: 'guiSketches',
  system: 'systemStacks',
};

export interface AnchoredAttentionItem extends AttentionItem {
  designElement: string;
  context: {
    perspective: DesignPerspective;
    elementId: string;
  };
}

export interface BackboneBlocks {
  useCases: UseCaseBlock[];
  contract: ContractBlock;
  controlFlows: FlowBlock[];
  guiSketches: GuiSketchBlock[];
  systemStacks: SystemStackBlock[];
}

export type BackboneBlockSubmission<TName extends keyof BackboneBlocks> =
  Pick<BackboneBlocks, TName>;

export interface BackboneConclusionInput {
  goal: string;
  summary: string;
  aspects: Array<{
    id: string;
    kind: DesignAspectKind;
    title: string;
    summary: string;
    relatedElements: string[];
  }>;
  notes?: string[];
  reviewSummary?: DesignReviewSummary;
}

export interface DesignReviewSummary {
  headline: string;
  changes: Array<{
    id: string;
    title: string;
    description: string;
    whyItMatters: string;
    visibility: 'visible' | 'summary-only';
    perspective: DesignPerspective;
    elementId: string;
  }>;
}

export interface BackboneProposalInput extends BackboneBlocks {
  goal: BackboneConclusionInput['goal'];
  summary: BackboneConclusionInput['summary'];
  aspects: BackboneConclusionInput['aspects'];
}

const proposalSummaryProperties = {
  goal: { type: 'string', minLength: 1, maxLength: 140 },
  summary: { type: 'string', minLength: 1, maxLength: 240 },
  aspects: {
    type: 'array',
    minItems: 1,
    maxItems: 4,
    items: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: idSchema,
        kind: {
          type: 'string',
          enum: ['contract', 'control-flow', 'system', 'gui'],
        },
        title: { type: 'string', minLength: 1, maxLength: 60 },
        summary: { type: 'string', minLength: 1, maxLength: 140 },
        relatedElements: {
          type: 'array',
          maxItems: 4,
          items: { type: 'string', minLength: 1, maxLength: 60 },
        },
      },
      required: ['id', 'kind', 'title', 'summary', 'relatedElements'],
    },
  },
} as const;

export const implementationStateUpdatesSchema = {
  type: 'array',
  maxItems: 7,
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      perspective: {
        type: 'string',
        const: 'use-case',
      },
      elementId: idSchema,
      implementationState: implementationStateSchema,
    },
    required: ['perspective', 'elementId', 'implementationState'],
  },
} as const;

export const backboneConclusionSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ...proposalSummaryProperties,
    notes: {
      type: 'array',
      maxItems: 12,
      items: { type: 'string', minLength: 1, maxLength: 240 },
    },
    reviewSummary: {
      type: 'object',
      additionalProperties: false,
      properties: {
        headline: { type: 'string', minLength: 1, maxLength: 140 },
        changes: {
          type: 'array',
          minItems: 1,
          maxItems: 4,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: idSchema,
              title: { type: 'string', minLength: 1, maxLength: 80 },
              description: { type: 'string', minLength: 1, maxLength: 200 },
              whyItMatters: { type: 'string', minLength: 1, maxLength: 180 },
              visibility: {
                type: 'string',
                enum: ['visible', 'summary-only'],
              },
              perspective: {
                type: 'string',
                enum: ['use-case', 'contract', 'flow', 'gui', 'system'],
              },
              elementId: idSchema,
            },
            required: [
              'id',
              'title',
              'description',
              'whyItMatters',
              'visibility',
              'perspective',
              'elementId',
            ],
          },
        },
      },
      required: ['headline', 'changes'],
    },
  },
  required: ['goal', 'summary', 'aspects', 'reviewSummary'],
} as const;

export function validateDesignReviewSummary(
  summary: DesignReviewSummary,
  blocks: BackboneBlocks,
): void {
  const ids = new Set<string>();
  for (const change of summary.changes) {
    if (ids.has(change.id)) {
      throw new Error(`Design-review change ID must be unique: ${change.id}.`);
    }
    ids.add(change.id);
    const block = blocks[blockByPerspective[change.perspective]];
    const matches = countDesignElementMatches(block, change.elementId);
    if (matches !== 1) {
      throw new Error(
        `Design-review change ${change.id} must anchor to exactly one `
        + `${perspectiveNames[change.perspective]} element "${change.elementId}"; `
        + `found ${matches}.`,
      );
    }
  }

  function countDesignElementMatches(value: unknown, elementId: string): number {
    if (Array.isArray(value)) {
      return value.reduce(
        (count, item) => count + countDesignElementMatches(item, elementId),
        0,
      );
    }
    if (!value || typeof value !== 'object') {
      return 0;
    }
    const entity = value as Record<string, unknown>;
    let matches = entity.id === elementId || entity.code === elementId ? 1 : 0;
    for (const [property, nested] of Object.entries(entity)) {
      if (property !== 'attention') {
        matches += countDesignElementMatches(nested, elementId);
      }
    }
    return matches;
  }
}

export const backboneBlockSubmissionSchemas = {
  useCases: {
    type: 'object',
    additionalProperties: false,
    properties: {
      useCases: useCaseBlockSchema,
    },
    required: ['useCases'],
  },
  contract: {
    type: 'object',
    additionalProperties: false,
    properties: {
      contract: contractBlockSchema,
    },
    required: ['contract'],
  },
  controlFlows: {
    type: 'object',
    additionalProperties: false,
    properties: {
      controlFlows: flowBlockSchema,
    },
    required: ['controlFlows'],
  },
  guiSketches: {
    type: 'object',
    additionalProperties: false,
    properties: {
      guiSketches: guiBlockSchema,
    },
    required: ['guiSketches'],
  },
  systemStacks: {
    type: 'object',
    additionalProperties: false,
    properties: {
      systemStacks: systemBlockSchema,
    },
    required: ['systemStacks'],
  },
} as const;

export const backboneProposalSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ...proposalSummaryProperties,
    useCases: useCaseBlockSchema,
    controlFlows: flowBlockSchema,
    guiSketches: guiBlockSchema,
    systemStacks: systemBlockSchema,
    contract: contractBlockSchema,
  },
  required: [
    'goal',
    'summary',
    'useCases',
    'controlFlows',
    'guiSketches',
    'systemStacks',
    'aspects',
    'contract',
  ],
} as const;

export function contextElements(
  input: BackboneBlocks,
): Record<DesignPerspective, Set<string>> {
  return {
    'use-case': new Set(input.useCases.map(({ id }) => id)),
    contract: new Set([
      ...input.contract.participants.map(({ id }) => id),
      ...input.contract.interactions.flatMap((interaction) => [
        interaction.id,
        ...interaction.errors.map(({ code }) => code),
        ...interaction.guarantees.map(({ id }) => id),
      ]),
      ...input.contract.storageContracts.flatMap((storage) => [
        storage.id,
        ...storage.records.flatMap((record) => [
          record.id,
          ...record.fields.map(({ id }) => id),
          ...record.keys.map(({ id }) => id),
          ...record.constraints.map(({ id }) => id),
        ]),
        ...storage.relations.map(({ id }) => id),
        ...storage.guarantees.map(({ id }) => id),
        ...storage.lifecycleRules.map(({ id }) => id),
      ]),
      ...input.contract.lifecycleRules.map(({ id }) => id),
    ]),
    flow: new Set(),
    gui: new Set(input.guiSketches.flatMap((sketch) => [
      sketch.id,
      ...sketch.regions.map(({ id }) => id),
    ])),
    system: new Set(input.systemStacks.flatMap((stack) =>
      stack.layers.map(({ id }) => id))),
  };
}

export function validateImplementationStateUpdates(
  updates: ImplementationStateUpdate[],
  blocks: BackboneBlocks,
): void {
  const elements = contextElements(blocks);
  const seen = new Set<string>();
  const validStates = new Set<ImplementationState>([
    ...implementationStates,
  ]);
  for (const update of updates) {
    if (!validStates.has(update.implementationState)) {
      throw new Error(`Design element ${update.elementId} has an invalid implementation state.`);
    }
    const key = `${update.perspective}:${update.elementId}`;
    if (seen.has(key)) {
      throw new Error(`Implementation-state update must be unique: ${key}.`);
    }
    seen.add(key);
    if (update.perspective !== 'use-case') {
      throw new Error(
        'Only top-level Use cases carry implementation lifecycle state.',
      );
    }
    if (!elements[update.perspective].has(update.elementId)) {
      throw new Error(
        `${perspectiveNames[update.perspective]} element "${update.elementId}" does not exist.`,
      );
    }
  }
}

function rejectImplementationStates(value: unknown, context: string): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      rejectImplementationStates(item, context);
    }
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }
  const entity = value as Record<string, unknown>;
  if (entity.implementationState !== undefined) {
    throw new Error(
      `${context} entity ${String(entity.id ?? entity.code ?? 'unknown')} must not carry implementation lifecycle state.`,
    );
  }
  for (const nested of Object.values(entity)) {
    rejectImplementationStates(nested, context);
  }
}

function entityLabel(entity: Record<string, unknown>, elementId: string): string {
  for (const key of ['title', 'name', 'label', 'statement', 'meaning']) {
    if (typeof entity[key] === 'string' && entity[key]) {
      return entity[key];
    }
  }
  return elementId;
}

function collectPerspectiveAttention(
  value: unknown,
  perspective: DesignPerspective,
  result: AnchoredAttentionItem[],
): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectPerspectiveAttention(item, perspective, result);
    }
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }

  const entity = value as Record<string, unknown>;
  const elementId = typeof entity.id === 'string'
    ? entity.id
    : typeof entity.code === 'string'
      ? entity.code
      : undefined;
  if (elementId && Array.isArray(entity.attention)) {
    for (const item of entity.attention as AttentionItem[]) {
      result.push({
        ...item,
        designElement: entityLabel(entity, elementId),
        context: { perspective, elementId },
      });
    }
  }

  for (const [key, nested] of Object.entries(entity)) {
    if (key !== 'attention') {
      collectPerspectiveAttention(nested, perspective, result);
    }
  }
}

export function collectAttentionItems(
  blocks: BackboneBlocks,
): AnchoredAttentionItem[] {
  const result: AnchoredAttentionItem[] = [];
  collectPerspectiveAttention(blocks.useCases, 'use-case', result);
  collectPerspectiveAttention(blocks.contract, 'contract', result);
  collectPerspectiveAttention(blocks.controlFlows, 'flow', result);
  collectPerspectiveAttention(blocks.guiSketches, 'gui', result);
  collectPerspectiveAttention(blocks.systemStacks, 'system', result);
  return result;
}

export function findAttentionItem(
  blocks: BackboneBlocks,
  attentionId: string,
): AnchoredAttentionItem | undefined {
  return collectAttentionItems(blocks).find(({ id }) => id === attentionId);
}

export function validateEmbeddedAttention(blocks: BackboneBlocks, snapshot: PolicySnapshot = LEGACY_V1_POLICY): void {
  const limits = parsePolicySnapshot(snapshot).values.schema;
  const validateStructure = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) {
        validateStructure(item);
      }
      return;
    }
    if (!value || typeof value !== 'object') {
      return;
    }
    const entity = value as Record<string, unknown>;
    if ('attention' in entity) {
      const elementId = String(entity.id ?? entity.code ?? 'unknown');
      if (!Array.isArray(entity.attention)) {
        throw new Error(`Design entity ${elementId} must store Attention as an array.`);
      }
      for (const rawItem of entity.attention) {
        if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) {
          throw new Error(`Design entity ${elementId} contains an invalid Attention item.`);
        }
        const item = rawItem as Record<string, unknown>;
        if (
          typeof item.id !== 'string'
          || item.id.length > limits['common.id.maxLength']
          || !/^[a-z][a-z0-9-]*$/.test(item.id)
        ) {
          throw new Error(`Design entity ${elementId} contains an invalid Attention item ID.`);
        }
        if (
          typeof item.question !== 'string'
          || item.question.length < 1
          || item.question.length > limits['attention.question.maxLength']
          || typeof item.whyItMatters !== 'string'
          || item.whyItMatters.length < 1
          || item.whyItMatters.length > limits['attention.whyItMatters.maxLength']
        ) {
          throw new Error(`Attention item ${item.id} requires a concise question and rationale.`);
        }
        if (
          item.impact !== 'blocking'
          && item.impact !== 'non-blocking'
        ) {
          throw new Error(`Attention item ${item.id} must be blocking or non-blocking.`);
        }
        if (
          !Array.isArray(item.alternatives)
          || item.alternatives.length < limits['attention.alternatives.minItems']
          || item.alternatives.length > limits['attention.alternatives.maxItems']
        ) {
          throw new Error(`Attention item ${item.id} must offer ${limits['attention.alternatives.minItems']} to ${limits['attention.alternatives.maxItems']} alternatives.`);
        }
        for (const alternative of item.alternatives) {
          if (
            !alternative
            || typeof alternative !== 'object'
            || Array.isArray(alternative)
          ) {
            throw new Error(`Attention item ${item.id} contains an invalid alternative.`);
          }
          const entry = alternative as Record<string, unknown>;
          if (
            typeof entry.option !== 'string'
            || entry.option.length < 1
            || entry.option.length > limits['attention.alternatives.option.maxLength']
            || typeof entry.implication !== 'string'
            || entry.implication.length < 1
            || entry.implication.length > limits['attention.alternatives.implication.maxLength']
          ) {
            throw new Error(
              `Attention item ${item.id} alternatives require an option and implication.`,
            );
          }
        }
      }
    }
    for (const [key, nested] of Object.entries(entity)) {
      if (key !== 'attention') {
        validateStructure(nested);
      }
    }
  };

  validateStructure(blocks);
  const items = collectAttentionItems(blocks);
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) {
      throw new Error(`Attention item ID must be unique: ${item.id}.`);
    }
    ids.add(item.id);
    if (item.impact !== 'blocking' && item.impact !== 'non-blocking') {
      throw new Error(`Attention item ${item.id} must be blocking or non-blocking.`);
    }
    if (
      !Array.isArray(item.alternatives)
      || item.alternatives.length < limits['attention.alternatives.minItems']
      || item.alternatives.length > limits['attention.alternatives.maxItems']
    ) {
      throw new Error(`Attention item ${item.id} must offer ${limits['attention.alternatives.minItems']} to ${limits['attention.alternatives.maxItems']} alternatives.`);
    }
  }
}

export function validateBackboneProposal(input: BackboneProposalInput, policy: PolicySnapshot = LEGACY_V1_POLICY): void {
  const contractReferences = validateContractBlock(input.contract);
  const useCaseIds = validateUseCaseBlock(
    input.useCases,
    contractReferences.interactionIds,
  );
  validateFlowBlock(input.controlFlows, {
    useCaseIds,
    ...contractReferences,
  });
  validateGuiBlock(input.guiSketches, useCaseIds);
  validateSystemBlock(input.systemStacks);
  for (const useCase of input.useCases) {
    if (
      useCase.implementationState !== undefined
      && ![
        ...implementationStates,
      ].includes(useCase.implementationState)
    ) {
      throw new Error(
        `Use case ${useCase.id} has an invalid implementation state.`,
      );
    }
    rejectImplementationStates(useCase.steps, 'Use case step');
  }
  rejectImplementationStates(input.contract, 'Contract');
  rejectImplementationStates(input.controlFlows, 'Flow');
  rejectImplementationStates(input.guiSketches, 'GUI');
  rejectImplementationStates(input.systemStacks, 'System');

  if (!input.aspects.some(({ kind }) => kind === 'contract')) {
    throw new Error('The coordinated aspects must include the contract view.');
  }
  const hasFlowAspect = input.aspects.some(({ kind }) => kind === 'control-flow');
  if (hasFlowAspect !== (input.controlFlows.length > 0)) {
    throw new Error(
      'The control-flow aspect and structured controlFlows must either both be present or absent.',
    );
  }
  const hasSystemAspect = input.aspects.some(({ kind }) => kind === 'system');
  if (hasSystemAspect !== (input.systemStacks.length > 0)) {
    throw new Error(
      'The system aspect and structured systemStacks must either both be present or absent.',
    );
  }
  const hasGuiAspect = input.aspects.some(({ kind }) => kind === 'gui');
  if (hasGuiAspect !== (input.guiSketches.length > 0)) {
    throw new Error(
      'The GUI aspect and structured guiSketches must either both be present or absent.',
    );
  }

  validateEmbeddedAttention(input, policy);
}

export type {
  ContractBlock,
  ContractInteractionKind,
  StorageKeyKind,
  StorageMedium,
  StorageRelationKind,
} from './contract-block.ts';
export type {
  ControlFlowContractKind,
  ControlFlowNodeKind,
  FlowBlock,
} from './flow-block.ts';
export type { GuiElementKind, GuiRegionPlacement, GuiSketchBlock } from './gui-block.ts';
export type { AttentionItem, ImplementationState } from './schema-primitives.ts';
export type { SystemStackBlock } from './system-block.ts';
export type { UseCaseBlock } from './use-case-block.ts';
