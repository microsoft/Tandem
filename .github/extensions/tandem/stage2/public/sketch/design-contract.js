import { humanLoopPrompts } from '../prompts/human-loop.js';
import { sketchSchema, sketchV1Schema, validateSketchSchema, freezeSketchData, rejectSketch, sketchConnectionLabel } from './contract.js';
import { layoutSketch } from './renderer.js';
import { createTemplate, templateCatalog } from './templates.js';
import { artifactSchema, documentArtifactSchema, artifactRules, validateArtifact, artifactReferences, artifactCapabilities, artifactNoteTarget } from '../artifacts/contract.js';

export const DESIGN_VERSION = 'sketch-design/v3';
export const DESIGN_V2_VERSION = 'sketch-design/v2';
export const DESIGN_V1_VERSION = 'sketch-design/v1';
export const designReferenceSchema = freezeSketchData({
  type: 'string', minLength: 1, maxLength: 97,
  pattern: '^[a-z][a-z0-9-]{0,47}(?:#[a-z][a-z0-9-]{0,47})?$',
});
const text = (maxLength) => ({ type: 'string', minLength: 1, maxLength,
  pattern: '^[^\\u0000-\\u0009\\u000b-\\u001f\\u007f]*$' });
const object = (properties, required = Object.keys(properties)) => ({
  type: 'object', properties, required, additionalProperties: false,
});
const references = { type: 'array', minItems: 1, maxItems: 96, items: designReferenceSchema };
export const designV1Schema = freezeSketchData({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:tandem:sketch-design:v1',
  title: 'Canonical shared-sketch Design',
  ...object({
    schemaVersion: { type: 'string', const: DESIGN_V1_VERSION },
    goal: text(8000), summary: text(8000),
    outcomes: { type: 'array', minItems: 1, maxItems: 48, items: object({
      id: { type: 'string', minLength: 1, maxLength: 48, pattern: '^[a-z][a-z0-9-]*$' },
      description: text(8000), references,
    }) },
    artifacts: { type: 'array', minItems: 1, maxItems: 24, items: sketchV1Schema },
  }),
});
export const designV2Schema = freezeSketchData({
  ...designV1Schema,
  $id: 'urn:tandem:sketch-design:v2',
  properties: {
    ...designV1Schema.properties,
    schemaVersion: { type: 'string', const: DESIGN_V2_VERSION },
    artifacts: { ...designV1Schema.properties.artifacts, items: sketchSchema },
  },
});
export const designSchema = freezeSketchData({
  ...designV2Schema,
  $id: 'urn:tandem:sketch-design:v3',
  properties: {
    ...designV2Schema.properties,
    schemaVersion: { type: 'string', const: DESIGN_VERSION },
    artifacts: { ...designV2Schema.properties.artifacts, items: { oneOf: [artifactSchema, documentArtifactSchema, sketchSchema, sketchV1Schema] } },
  },
});
export const designGenerationContract = freezeSketchData({
  schema: designSchema,
  referenceSchema: designReferenceSchema,
  rules: [
    ...humanLoopPrompts.designRules,
    ...artifactRules,
  ],
  templates: templateCatalog.map(({ id }) => ({ id, document: createTemplate(id) })),
});

function referenceIndex(collection) {
  const index = new Map();
  for (const artifact of collection.artifacts) {
    index.set(artifact.id, { reference: artifact.id, artifactId: artifact.id, elementId: null,
      kind: 'artifact', label: artifact.title, details: artifact.description ?? '' });
    if (['artifact/v1', 'artifact/v2'].includes(artifact.schemaVersion)) {
      for (const item of artifactReferences(artifact)) {
        const reference = `${artifact.id}#${item.id}`;
        index.set(reference, { reference, artifactId: artifact.id, elementId: item.id,
          kind: item.kind, label: item.label, details: item.details ?? '' });
      }
      continue;
    }
    for (const [kind, items] of [['box', artifact.boxes], ['connection', artifact.connections]]) {
      for (const item of items) {
        const reference = `${artifact.id}#${item.id}`;
        index.set(reference, { reference, artifactId: artifact.id, elementId: item.id, kind,
          label: item.label ?? sketchConnectionLabel(item), details: item.details ?? '',
          ...(item.caption === undefined ? {} : { caption: item.caption }),
          ...(item.body === undefined ? {} : { body: item.body }) });
      }
    }
  }
  return index;
}
function checkReferences(values, index, path) {
  validateSketchSchema(values, { ...references, minItems: 0 }, path);
  if (new Set(values).size !== values.length) rejectSketch('duplicate-reference', path, 'References must be unique.');
  for (const value of values) if (!index.has(value)) rejectSketch('reference', path, `Unknown Design reference: ${value}.`);
}

/** Validate complete canonical data and actual rendering feasibility without changing inputs. */
export function validateDesign(input, { previous = null } = {}) {
  const version = input && Object.getOwnPropertyDescriptor(input, 'schemaVersion')?.value;
  if (![DESIGN_VERSION, DESIGN_V2_VERSION, DESIGN_V1_VERSION].includes(version)) rejectSketch('version', 'design',
    'Expected sketch-design/v3, v2 or v1. Legacy five-perspective Design is not implicitly converted.');
  validateSketchSchema(input, version === DESIGN_V1_VERSION ? designV1Schema
    : version === DESIGN_V2_VERSION ? designV2Schema : designSchema, 'design');
  const ids = input.artifacts.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) rejectSketch('duplicate-id', 'design.artifacts', 'Artifact IDs must be unique.');
  const outcomes = input.outcomes.map(({ id }) => id);
  if (new Set(outcomes).size !== outcomes.length) rejectSketch('duplicate-id', 'design.outcomes', 'Outcome IDs must be unique.');
  for (const artifact of input.artifacts) {
    if (['artifact/v1', 'artifact/v2'].includes(artifact.schemaVersion)) validateArtifact(artifact);
    else layoutSketch(artifact);
    if (artifact.visualCompanionId !== undefined && !input.artifacts.some(candidate =>
      candidate.id === artifact.visualCompanionId && candidate.schemaVersion === 'artifact/v1')) {
      rejectSketch('reference', `artifacts.${artifact.id}.visualCompanionId`, 'Visual companion must reference an artifact/v1 in this Design.');
    }
  }
  const byId = new Map(input.artifacts.map(artifact => [artifact.id, artifact]));
  for (const artifact of input.artifacts) {
    const visited = new Set([artifact.id]);
    let target = artifactNoteTarget(artifact);
    while (target !== null) {
      if (!byId.has(target) || visited.has(target)) rejectSketch('reference', `artifacts.${artifact.id}.noteForArtifactId`,
        'Note target must exist in this Design and cannot form a self-reference or note cycle.');
      visited.add(target);
      target = artifactNoteTarget(byId.get(target));
    }
  }
  const index = referenceIndex(input);
  for (const outcome of input.outcomes) checkReferences(outcome.references, index, `outcomes.${outcome.id}.references`);
  if (previous !== null) {
    const old = referenceIndex(validateDesign(previous));
    for (const [ref, item] of index) if (old.has(ref) && old.get(ref).kind !== item.kind
      && [old.get(ref).kind, item.kind].includes('connection')) {
      rejectSketch('identity-reuse', ref, 'A stable element identity cannot change between box and connection.');
    }
  }
  return freezeSketchData(JSON.parse(JSON.stringify(input)));
}

export function designReferenceCatalog(input) {
  return [...referenceIndex(validateDesign(input)).values()];
}
export function validateDesignReferences(input, values) {
  checkReferences(values, input === null ? new Map() : referenceIndex(validateDesign(input)), 'designReferences');
  return [...values];
}
export function resolveDesignReference(input, reference) {
  validateDesignReferences(input, [reference]);
  return referenceIndex(input).get(reference);
}

export function validateArtifactAnnotationSource(source, binding, collection) {
  if (source?.schemaVersion !== 'artifact-annotation/v1') rejectSketch('version', 'annotation',
    'New annotations require an artifact-annotation/v1 source; old view identities are not rebound.');
  if (source.revisionId !== binding.revisionId || source.designDigest !== binding.digest) {
    rejectSketch('annotation-stale-revision', 'annotation', 'The image belongs to another exact Design revision; retain it or capture a new image.');
  }
  const artifact = resolveDesignReference(collection, source.artifactId);
  if (!artifactCapabilities(collection.artifacts.find(item => item.id === source.artifactId)).annotate) {
    rejectSketch('annotation-capability', 'annotation', 'Document artifacts do not support annotations or PNG capture.');
  }
  if (artifact.kind !== 'artifact') rejectSketch('reference', 'annotation.artifactId', 'An artifact identity is required.');
  if (source.selectionId !== null) validateDesignReferences(collection, [`${source.artifactId}#${source.selectionId}`]);
  return source;
}
