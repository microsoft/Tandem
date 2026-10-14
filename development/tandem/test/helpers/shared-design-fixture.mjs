import { createLegacyTemplate as createTemplate } from '../../public/sketch/templates.js';
import { DESIGN_V1_VERSION as DESIGN_VERSION } from '../../public/sketch/design-contract.js';

export function sharedDesign() {
  const artifact = createTemplate('workflow');
  artifact.id = 'interaction';
  artifact.title = 'Request and response';
  return {
    schemaVersion: DESIGN_VERSION,
    goal: 'Deliver the requested result.',
    summary: 'Roles contain actions connected by explicit handoffs.',
    outcomes: [{ id: 'delivered-result', description: 'The requester receives the completed result.',
      references: ['interaction#deliver', 'interaction#accept'] }],
    artifacts: [artifact],
  };
}

export function sharedDesignExample() {
  const design = sharedDesign();
  design.artifacts.push(createTemplate('architecture'), createTemplate('ui'));
  return design;
}

/** Explicit new authoring with stable concepts, separate from immutable v1 fixtures. */
export function sharedDesignV2() {
  const design = sharedDesign();
  design.schemaVersion = 'sketch-design/v2';
  for (const artifact of design.artifacts) artifact.schemaVersion = 'sketch/v2';
  return design;
}

export function sharedDesignExampleV2() {
  const design = sharedDesignExample();
  design.schemaVersion = 'sketch-design/v2';
  for (const artifact of design.artifacts) artifact.schemaVersion = 'sketch/v2';
  return design;
}

export function sharedDesignV3() {
  return { ...sharedDesignV2(), schemaVersion: 'sketch-design/v3' };
}

export function sharedDesignExampleV3() {
  return { ...sharedDesignExampleV2(), schemaVersion: 'sketch-design/v3' };
}
