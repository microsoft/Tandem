import {
  validateDesignReviewSummary, type BackboneBlocks, type BackboneConclusionInput, type BackboneProposalInput,
} from '../backbone/proposal.ts';
import type { DesignRevision } from './change-plan.ts';
import { createPolicyGeneration } from './policy-contracts.ts';
import type { PolicySnapshot } from './policy.ts';
import { object, requireCondition } from './validation.ts';

export interface PrivateDesignOutput extends BackboneBlocks {
  conclusion: BackboneConclusionInput;
}

export function unpublishedWorkflowDesign(): DesignRevision {
  return { id: 'unpublished-design', complete: false, entities: [] };
}

export function isUnpublishedWorkflowDesign(value: unknown): value is DesignRevision {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  return Object.keys(data).length === 3
    && Object.hasOwn(data, 'id') && Object.hasOwn(data, 'complete') && Object.hasOwn(data, 'entities')
    && data.id === 'unpublished-design' && data.complete === false
    && Array.isArray(data.entities) && data.entities.length === 0;
}

export function parsePrivateDesignOutput(
  value: unknown, policy: PolicySnapshot, previousDesign: BackboneProposalInput | null = null,
): PrivateDesignOutput {
  const data = object(value, ['useCases', 'contract', 'controlFlows', 'guiSketches', 'systemStacks', 'conclusion']);
  const generation = createPolicyGeneration('private-design-output', policy);
  for (const kind of ['useCases', 'contract', 'controlFlows', 'guiSketches', 'systemStacks', 'conclusion'] as const) {
    generation.validate(kind, data[kind]);
  }
  const output = structuredClone(data) as unknown as PrivateDesignOutput;
  const { conclusion, ...blocks } = output;
  const proposal: BackboneProposalInput = {
    ...blocks, goal: conclusion.goal, summary: conclusion.summary, aspects: conclusion.aspects,
  };
  generation.validateDesign(proposal);
  requireCondition(conclusion.reviewSummary, 'private Design requires an anchored design-review summary.');
  validateDesignReviewSummary(conclusion.reviewSummary, blocks);
  if (previousDesign) generation.validateDesign(previousDesign);
  requireCondition(output.useCases.every(({ id, implementationState }) =>
    implementationState === undefined
    || implementationState === (previousDesign?.useCases.find((useCase) => useCase.id === id)?.implementationState ?? 'planned')),
  'private Design cannot claim or change implementation progress or verification.');
  return output;
}
