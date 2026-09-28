import {
  idSchema,
  designEntityProperties,
  type DesignEntityMetadata,
} from './schema-primitives.ts';

export type GuiRegionPlacement = 'top' | 'left' | 'center' | 'right' | 'bottom';
export type GuiElementKind = 'text' | 'action' | 'input' | 'list-item' | 'card' | 'status';

export interface GuiSketchBlock extends DesignEntityMetadata {
  id: string;
  title: string;
  purpose: string;
  useCaseIds: string[];
  regions: Array<{
    id: string;
    placement: GuiRegionPlacement;
    label: string;
    elements: Array<{
      kind: GuiElementKind;
      label: string;
    } & DesignEntityMetadata>;
  }>;
}

export const guiBlockSchema = {
  type: 'array',
  maxItems: 3,
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: idSchema,
      ...designEntityProperties,
      title: { type: 'string', minLength: 1, maxLength: 60 },
      purpose: { type: 'string', minLength: 1, maxLength: 120 },
      useCaseIds: {
        type: 'array',
        minItems: 1,
        maxItems: 3,
        items: idSchema,
      },
      regions: {
        type: 'array',
        minItems: 1,
        maxItems: 5,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: idSchema,
            ...designEntityProperties,
            placement: {
              type: 'string',
              enum: ['top', 'left', 'center', 'right', 'bottom'],
            },
            label: { type: 'string', minLength: 1, maxLength: 40 },
            elements: {
              type: 'array',
              minItems: 1,
              maxItems: 6,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  kind: {
                    type: 'string',
                    enum: ['text', 'action', 'input', 'list-item', 'card', 'status'],
                  },
                  label: { type: 'string', minLength: 1, maxLength: 50 },
                },
                required: ['kind', 'label'],
              },
            },
          },
          required: ['id', 'placement', 'label', 'elements'],
        },
      },
    },
    required: ['id', 'title', 'purpose', 'useCaseIds', 'regions'],
  },
} as const;

export function validateGuiBlock(
  sketches: GuiSketchBlock[],
  useCaseIds: ReadonlySet<string>,
): void {
  const sketchIds = new Set<string>();
  for (const sketch of sketches) {
    if (sketchIds.has(sketch.id)) {
      throw new Error(`GUI sketch ID must be unique: ${sketch.id}.`);
    }
    sketchIds.add(sketch.id);
    for (const useCaseId of sketch.useCaseIds) {
      if (!useCaseIds.has(useCaseId)) {
        throw new Error(
          `GUI sketch ${sketch.id} references unknown use case ${useCaseId}.`,
        );
      }
    }
    const regionIds = new Set<string>();
    const placements = new Set<GuiRegionPlacement>();
    for (const region of sketch.regions) {
      if (regionIds.has(region.id)) {
        throw new Error(`GUI region ID must be unique within ${sketch.id}: ${region.id}.`);
      }
      regionIds.add(region.id);
      if (placements.has(region.placement)) {
        throw new Error(
          `GUI sketch ${sketch.id} may use placement ${region.placement} only once.`,
        );
      }
      placements.add(region.placement);
    }
    if (!placements.has('center')) {
      throw new Error(`GUI sketch ${sketch.id} must define a center region.`);
    }
  }
}
