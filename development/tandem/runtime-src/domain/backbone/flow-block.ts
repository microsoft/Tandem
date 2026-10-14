import {
  attentionProperty,
  idSchema,
  type AttentionTracked,
} from './schema-primitives.ts';

export type ControlFlowNodeKind =
  | 'start'
  | 'action'
  | 'decision'
  | 'interaction'
  | 'storage'
  | 'outcome'
  | 'error';
export type ControlFlowContractKind = 'none' | 'interaction' | 'storage';

export interface FlowBlock extends AttentionTracked {
  id: string;
  title: string;
  purpose: string;
  useCaseIds: string[];
  nodes: Array<{
    id: string;
    label: string;
    kind: ControlFlowNodeKind;
    contractKind: ControlFlowContractKind;
    contractId: string;
  } & AttentionTracked>;
  edges: Array<{
    id: string;
    fromNodeId: string;
    toNodeId: string;
    label: string;
  } & AttentionTracked>;
}

export const flowBlockSchema = {
  type: 'array',
  maxItems: 4,
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: idSchema,
      ...attentionProperty,
      title: { type: 'string', minLength: 1, maxLength: 70 },
      purpose: { type: 'string', minLength: 1, maxLength: 140 },
      useCaseIds: {
        type: 'array',
        minItems: 1,
        maxItems: 4,
        items: idSchema,
      },
      nodes: {
        type: 'array',
        minItems: 2,
        maxItems: 12,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: idSchema,
            ...attentionProperty,
            label: { type: 'string', minLength: 1, maxLength: 70 },
            kind: {
              type: 'string',
              enum: [
                'start',
                'action',
                'decision',
                'interaction',
                'storage',
                'outcome',
                'error',
              ],
            },
            contractKind: {
              type: 'string',
              enum: ['none', 'interaction', 'storage'],
            },
            contractId: {
              type: 'string',
              maxLength: 40,
              pattern: '^$|^[a-z][a-z0-9-]*$',
            },
          },
          required: ['id', 'label', 'kind', 'contractKind', 'contractId'],
        },
      },
      edges: {
        type: 'array',
        minItems: 1,
        maxItems: 16,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: idSchema,
            ...attentionProperty,
            fromNodeId: idSchema,
            toNodeId: idSchema,
            label: { type: 'string', minLength: 1, maxLength: 50 },
          },
          required: ['id', 'fromNodeId', 'toNodeId', 'label'],
        },
      },
    },
    required: ['id', 'title', 'purpose', 'useCaseIds', 'nodes', 'edges'],
  },
} as const;

export function validateFlowBlock(
  flows: FlowBlock[],
  references: {
    useCaseIds: ReadonlySet<string>;
    interactionIds: ReadonlySet<string>;
    storageContractIds: ReadonlySet<string>;
  },
): void {
  const flowIds = new Set<string>();
  for (const flow of flows) {
    if (flowIds.has(flow.id)) {
      throw new Error(`Control-flow ID must be unique: ${flow.id}.`);
    }
    flowIds.add(flow.id);
    for (const useCaseId of flow.useCaseIds) {
      if (!references.useCaseIds.has(useCaseId)) {
        throw new Error(`Control flow ${flow.id} references unknown use case ${useCaseId}.`);
      }
    }
    const nodeIds = new Set<string>();
    let startCount = 0;
    let terminalCount = 0;
    for (const node of flow.nodes) {
      if (nodeIds.has(node.id)) {
        throw new Error(`Control-flow node ID must be unique within ${flow.id}: ${node.id}.`);
      }
      nodeIds.add(node.id);
      startCount += node.kind === 'start' ? 1 : 0;
      terminalCount += node.kind === 'outcome' || node.kind === 'error' ? 1 : 0;
      if (node.kind === 'interaction' && node.contractKind !== 'interaction') {
        throw new Error(`Control-flow interaction node ${node.id} must reference an interaction.`);
      }
      if (node.kind === 'storage' && node.contractKind !== 'storage') {
        throw new Error(`Control-flow storage node ${node.id} must reference a storage contract.`);
      }
      if (
        node.kind !== 'interaction'
        && node.kind !== 'storage'
        && node.contractKind !== 'none'
      ) {
        throw new Error(`Control-flow node ${node.id} cannot carry a contract reference.`);
      }
      if (node.contractKind === 'none' && node.contractId !== '') {
        throw new Error(`Control-flow node ${node.id} cannot reference a contract.`);
      }
      if (
        node.contractKind === 'interaction'
        && !references.interactionIds.has(node.contractId)
      ) {
        throw new Error(
          `Control-flow node ${node.id} references unknown interaction ${node.contractId}.`,
        );
      }
      if (
        node.contractKind === 'storage'
        && !references.storageContractIds.has(node.contractId)
      ) {
        throw new Error(
          `Control-flow node ${node.id} references unknown storage contract ${node.contractId}.`,
        );
      }
    }
    if (startCount !== 1) {
      throw new Error(`Control flow ${flow.id} must contain exactly one start node.`);
    }
    if (terminalCount === 0) {
      throw new Error(`Control flow ${flow.id} must contain an outcome or error node.`);
    }
    const edgeIds = new Set<string>();
    const incoming = new Map(flow.nodes.map(({ id }) => [id, 0]));
    const outgoing = new Map(flow.nodes.map(({ id }) => [id, [] as string[]]));
    for (const edge of flow.edges) {
      if (edgeIds.has(edge.id)) {
        throw new Error(`Control-flow edge ID must be unique within ${flow.id}: ${edge.id}.`);
      }
      edgeIds.add(edge.id);
      if (!nodeIds.has(edge.fromNodeId) || !nodeIds.has(edge.toNodeId)) {
        throw new Error(`Control-flow edge ${edge.id} must reference nodes in ${flow.id}.`);
      }
      incoming.set(edge.toNodeId, (incoming.get(edge.toNodeId) ?? 0) + 1);
      outgoing.get(edge.fromNodeId)?.push(edge.toNodeId);
    }
    const start = flow.nodes.find(({ kind }) => kind === 'start');
    if (!start) {
      throw new Error(`Control flow ${flow.id} must contain a start node.`);
    }
    if ((incoming.get(start.id) ?? 0) !== 0) {
      throw new Error(`Control-flow start node ${start.id} cannot have incoming edges.`);
    }
    let sinkCount = 0;
    for (const node of flow.nodes) {
      const outgoingCount = outgoing.get(node.id)?.length ?? 0;
      const isTerminal = node.kind === 'outcome' || node.kind === 'error';
      if (outgoingCount === 0) {
        if (!isTerminal) {
          throw new Error(`Control-flow node ${node.id} must have an outgoing edge.`);
        }
        sinkCount += 1;
      }
    }
    if (sinkCount === 0) {
      throw new Error(`Control flow ${flow.id} must end at an outcome or error node.`);
    }
    const reachable = new Set<string>([start.id]);
    const queue = [start.id];
    while (queue.length > 0) {
      const nodeId = queue.shift();
      for (const nextId of outgoing.get(nodeId ?? '') ?? []) {
        if (!reachable.has(nextId)) {
          reachable.add(nextId);
          queue.push(nextId);
        }
      }
    }
    const unreachable = flow.nodes.find(({ id }) => !reachable.has(id));
    if (unreachable) {
      throw new Error(
        `Control-flow node ${unreachable.id} must be reachable from start node ${start.id}.`,
      );
    }
  }
}
