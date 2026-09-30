import {
  idSchema,
  designEntityProperties,
  ruleSchema,
  type DesignEntityMetadata,
} from './schema-primitives.ts';

export type ContractInteractionKind = 'command' | 'query' | 'event' | 'stream';
export type StorageMedium = 'memory' | 'database' | 'file' | 'object-store' | 'cache';
export type StorageKeyKind = 'primary' | 'unique' | 'index';
export type StorageRelationKind = 'one-to-one' | 'one-to-many' | 'many-to-many';

interface ContractRule extends DesignEntityMetadata {
  id: string;
  statement: string;
}

export interface ContractBlock {
  schemaVersion: 'contract-set/v1';
  title: string;
  context: string;
  participants: Array<{
    id: string;
    name: string;
    responsibility: string;
  } & DesignEntityMetadata>;
  interactions: Array<{
    id: string;
    name: string;
    kind: ContractInteractionKind;
    fromParticipantId: string;
    toParticipantId: string;
    input: {
      name: string;
      description: string;
    };
    output: {
      name: string;
      description: string;
    };
    errors: Array<{
      code: string;
      meaning: string;
    } & DesignEntityMetadata>;
    guarantees: ContractRule[];
  } & DesignEntityMetadata>;
  storageContracts: Array<{
    id: string;
    name: string;
    medium: StorageMedium;
    ownerParticipantId: string;
    purpose: string;
    records: Array<{
      id: string;
      name: string;
      description: string;
      fields: Array<{
        id: string;
        name: string;
        type: string;
        required: boolean;
        description: string;
      } & DesignEntityMetadata>;
      keys: Array<{
        id: string;
        kind: StorageKeyKind;
        fieldIds: string[];
        purpose: string;
      } & DesignEntityMetadata>;
      constraints: ContractRule[];
    } & DesignEntityMetadata>;
    relations: Array<{
      id: string;
      fromRecordId: string;
      toRecordId: string;
      kind: StorageRelationKind;
      statement: string;
    } & DesignEntityMetadata>;
    guarantees: ContractRule[];
    lifecycleRules: ContractRule[];
  } & DesignEntityMetadata>;
  lifecycleRules: ContractRule[];
}

const descriptorSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 60 },
    description: { type: 'string', minLength: 1, maxLength: 120 },
  },
  required: ['name', 'description'],
} as const;

export const contractBlockSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    schemaVersion: { type: 'string', const: 'contract-set/v1' },
    title: { type: 'string', minLength: 1, maxLength: 80 },
    context: { type: 'string', minLength: 1, maxLength: 220 },
    participants: {
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
        },
        required: ['id', 'name', 'responsibility'],
      },
    },
    interactions: {
      type: 'array',
      minItems: 1,
      maxItems: 7,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: idSchema,
          ...designEntityProperties,
          name: { type: 'string', minLength: 1, maxLength: 60 },
          kind: {
            type: 'string',
            enum: ['command', 'query', 'event', 'stream'],
          },
          fromParticipantId: idSchema,
          toParticipantId: idSchema,
          input: descriptorSchema,
          output: descriptorSchema,
          errors: {
            type: 'array',
            maxItems: 3,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                code: idSchema,
                ...designEntityProperties,
                meaning: { type: 'string', minLength: 1, maxLength: 100 },
              },
              required: ['code', 'meaning'],
            },
          },
          guarantees: {
            type: 'array',
            minItems: 1,
            maxItems: 3,
            items: ruleSchema,
          },
        },
        required: [
          'id',
          'name',
          'kind',
          'fromParticipantId',
          'toParticipantId',
          'input',
          'output',
          'errors',
          'guarantees',
        ],
      },
    },
    storageContracts: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: idSchema,
          ...designEntityProperties,
          name: { type: 'string', minLength: 1, maxLength: 60 },
          medium: {
            type: 'string',
            enum: ['memory', 'database', 'file', 'object-store', 'cache'],
          },
          ownerParticipantId: idSchema,
          purpose: { type: 'string', minLength: 1, maxLength: 120 },
          records: {
            type: 'array',
            minItems: 1,
            maxItems: 6,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: idSchema,
                ...designEntityProperties,
                name: { type: 'string', minLength: 1, maxLength: 50 },
                description: { type: 'string', minLength: 1, maxLength: 100 },
                fields: {
                  type: 'array',
                  minItems: 1,
                  maxItems: 12,
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      id: idSchema,
                      ...designEntityProperties,
                      name: { type: 'string', minLength: 1, maxLength: 50 },
                      type: { type: 'string', minLength: 1, maxLength: 40 },
                      required: { type: 'boolean' },
                      description: { type: 'string', minLength: 1, maxLength: 100 },
                    },
                    required: ['id', 'name', 'type', 'required', 'description'],
                  },
                },
                keys: {
                  type: 'array',
                  maxItems: 4,
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      id: idSchema,
                      ...designEntityProperties,
                      kind: {
                        type: 'string',
                        enum: ['primary', 'unique', 'index'],
                      },
                      fieldIds: {
                        type: 'array',
                        minItems: 1,
                        maxItems: 4,
                        items: idSchema,
                      },
                      purpose: { type: 'string', minLength: 1, maxLength: 100 },
                    },
                    required: ['id', 'kind', 'fieldIds', 'purpose'],
                  },
                },
                constraints: {
                  type: 'array',
                  maxItems: 4,
                  items: ruleSchema,
                },
              },
              required: ['id', 'name', 'description', 'fields', 'keys', 'constraints'],
            },
          },
          relations: {
            type: 'array',
            maxItems: 4,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: idSchema,
                ...designEntityProperties,
                fromRecordId: idSchema,
                toRecordId: idSchema,
                kind: {
                  type: 'string',
                  enum: ['one-to-one', 'one-to-many', 'many-to-many'],
                },
                statement: { type: 'string', minLength: 1, maxLength: 100 },
              },
              required: ['id', 'fromRecordId', 'toRecordId', 'kind', 'statement'],
            },
          },
          guarantees: {
            type: 'array',
            minItems: 1,
            maxItems: 3,
            items: ruleSchema,
          },
          lifecycleRules: {
            type: 'array',
            maxItems: 4,
            items: ruleSchema,
          },
        },
        required: [
          'id',
          'name',
          'medium',
          'ownerParticipantId',
          'purpose',
          'records',
          'relations',
          'guarantees',
          'lifecycleRules',
        ],
      },
    },
    lifecycleRules: {
      type: 'array',
      maxItems: 4,
      items: ruleSchema,
    },
  },
  required: [
    'schemaVersion',
    'title',
    'context',
    'participants',
    'interactions',
    'storageContracts',
    'lifecycleRules',
  ],
} as const;

export interface ContractReferences {
  interactionIds: Set<string>;
  storageContractIds: Set<string>;
}

export function validateContractBlock(contract: ContractBlock): ContractReferences {
  if (contract.schemaVersion !== 'contract-set/v1') {
    throw new Error(`Unsupported contract schema: ${contract.schemaVersion}.`);
  }
  const participants = new Set<string>();
  const participantNames = new Set<string>();
  for (const participant of contract.participants) {
    if (participants.has(participant.id)) {
      throw new Error(`Contract participant ID must be unique: ${participant.id}.`);
    }
    if (participantNames.has(participant.name)) {
      throw new Error(`Contract participant name must be unique: ${participant.name}.`);
    }
    participants.add(participant.id);
    participantNames.add(participant.name);
  }

  const interactionIds = new Set<string>();
  const interactionNames = new Set<string>();
  for (const interaction of contract.interactions) {
    if (
      !participants.has(interaction.fromParticipantId)
      || !participants.has(interaction.toParticipantId)
    ) {
      throw new Error(
        `Contract interaction ${interaction.name} must reference existing participant IDs.`,
      );
    }
    if (interactionIds.has(interaction.id)) {
      throw new Error(`Contract interaction ID must be unique: ${interaction.id}.`);
    }
    if (interactionNames.has(interaction.name)) {
      throw new Error(`Contract interaction name must be unique: ${interaction.name}.`);
    }
    const errorCodes = new Set<string>();
    for (const error of interaction.errors) {
      if (errorCodes.has(error.code)) {
        throw new Error(
          `Contract interaction ${interaction.id} error code must be unique: ${error.code}.`,
        );
      }
      errorCodes.add(error.code);
    }
    const guaranteeIds = new Set<string>();
    for (const guarantee of interaction.guarantees) {
      if (guaranteeIds.has(guarantee.id)) {
        throw new Error(
          `Contract interaction ${interaction.id} guarantee ID must be unique: ${guarantee.id}.`,
        );
      }
      guaranteeIds.add(guarantee.id);
    }
    interactionIds.add(interaction.id);
    interactionNames.add(interaction.name);
  }

  const storageContractIds = new Set<string>();
  for (const storage of contract.storageContracts) {
    if (storageContractIds.has(storage.id)) {
      throw new Error(`Storage contract ID must be unique: ${storage.id}.`);
    }
    if (!participants.has(storage.ownerParticipantId)) {
      throw new Error(
        `Storage contract ${storage.id} must reference an existing owner participant ID.`,
      );
    }
    storageContractIds.add(storage.id);
    const recordIds = new Set<string>();
    for (const record of storage.records) {
      if (recordIds.has(record.id)) {
        throw new Error(`Storage record ID must be unique within ${storage.id}: ${record.id}.`);
      }
      recordIds.add(record.id);
      const fieldIds = new Set<string>();
      for (const field of record.fields) {
        if (fieldIds.has(field.id)) {
          throw new Error(`Storage field ID must be unique within ${record.id}: ${field.id}.`);
        }
        fieldIds.add(field.id);
      }
      const keyIds = new Set<string>();
      for (const key of record.keys) {
        if (keyIds.has(key.id)) {
          throw new Error(`Storage key ID must be unique within ${record.id}: ${key.id}.`);
        }
        keyIds.add(key.id);
        for (const fieldId of key.fieldIds) {
          if (!fieldIds.has(fieldId)) {
            throw new Error(
              `Storage key ${key.id} references unknown field ${fieldId} in ${record.id}.`,
            );
          }
        }
      }
      const constraintIds = new Set<string>();
      for (const constraint of record.constraints) {
        if (constraintIds.has(constraint.id)) {
          throw new Error(
            `Storage constraint ID must be unique within ${record.id}: ${constraint.id}.`,
          );
        }
        constraintIds.add(constraint.id);
      }
    }
    const relationIds = new Set<string>();
    for (const relation of storage.relations) {
      if (relationIds.has(relation.id)) {
        throw new Error(`Storage relation ID must be unique within ${storage.id}: ${relation.id}.`);
      }
      relationIds.add(relation.id);
      if (!recordIds.has(relation.fromRecordId) || !recordIds.has(relation.toRecordId)) {
        throw new Error(
          `Storage relation ${relation.id} must reference records in ${storage.id}.`,
        );
      }
    }
    const guaranteeIds = new Set<string>();
    for (const guarantee of storage.guarantees) {
      if (guaranteeIds.has(guarantee.id)) {
        throw new Error(
          `Storage guarantee ID must be unique within ${storage.id}: ${guarantee.id}.`,
        );
      }
      guaranteeIds.add(guarantee.id);
    }
    const lifecycleIds = new Set<string>();
    for (const rule of storage.lifecycleRules) {
      if (lifecycleIds.has(rule.id)) {
        throw new Error(
          `Storage lifecycle rule ID must be unique within ${storage.id}: ${rule.id}.`,
        );
      }
      lifecycleIds.add(rule.id);
    }
  }

  const lifecycleIds = new Set<string>();
  for (const rule of contract.lifecycleRules) {
    if (lifecycleIds.has(rule.id)) {
      throw new Error(`Contract lifecycle rule ID must be unique: ${rule.id}.`);
    }
    lifecycleIds.add(rule.id);
  }
  return { interactionIds, storageContractIds };
}
