import {
  idSchema,
  designEntityProperties,
  type DesignEntityMetadata,
} from './schema-primitives.ts';

export interface SystemStackBlock {
  title: string;
  layers: Array<{
    id: string;
    name: string;
    responsibility: string;
    technologies: Array<{
      name: string;
      role: string;
    } & DesignEntityMetadata>;
  }>;
}

export const systemBlockSchema = {
  type: 'array',
  maxItems: 1,
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 70 },
      layers: {
        type: 'array',
        minItems: 2,
        maxItems: 6,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: idSchema,
            ...designEntityProperties,
            name: { type: 'string', minLength: 1, maxLength: 50 },
            responsibility: { type: 'string', minLength: 1, maxLength: 100 },
            technologies: {
              type: 'array',
              minItems: 1,
              maxItems: 4,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  name: { type: 'string', minLength: 1, maxLength: 40 },
                  role: { type: 'string', minLength: 1, maxLength: 70 },
                },
                required: ['name', 'role'],
              },
            },
          },
          required: ['id', 'name', 'responsibility', 'technologies'],
        },
      },
    },
    required: ['title', 'layers'],
  },
} as const;

export function validateSystemBlock(stacks: SystemStackBlock[]): void {
  for (const stack of stacks) {
    const layerIds = new Set<string>();
    for (const layer of stack.layers) {
      if (layerIds.has(layer.id)) {
        throw new Error(`System layer ID must be unique: ${layer.id}.`);
      }
      layerIds.add(layer.id);
      const technologyNames = new Set<string>();
      for (const technology of layer.technologies) {
        const normalizedName = technology.name.toLowerCase();
        if (technologyNames.has(normalizedName)) {
          throw new Error(
            `Technology ${technology.name} must be unique within layer ${layer.id}.`,
          );
        }
        technologyNames.add(normalizedName);
      }
    }
  }
}
