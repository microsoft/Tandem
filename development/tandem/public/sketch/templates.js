import { SKETCH_VERSION, SKETCH_V1_VERSION, validateSketch } from './contract.js';

const box = (id, label, x, y, w, h, parent, details) => ({
  id, label, x, y, w, h, ...(parent ? { parent } : {}), ...(details ? { details } : {}),
});
const connection = (id, from, to, label, details) => ({
  id, from, to, ...(label ? { label } : {}), ...(details ? { details } : {}),
});

const legacyExamples = {
  workflow: {
    schemaVersion: SKETCH_V1_VERSION,
    id: 'workflow-example',
    title: 'Request, review, and deliver',
    description: 'Role containers hold action boxes. Directed handoffs connect the actions, not the roles.',
    boxes: [
      box('requester', 'Requester', 0, 0, 16, 19),
      box('reviewer', 'Reviewer', 23, 0, 16, 19),
      box('operator', 'Operator', 46, 0, 16, 19),
      box('prepare', 'Prepare request', 2, 4, 12, 4, 'requester', 'Describe the desired outcome and acceptance criteria.'),
      box('accept', 'Accept result', 2, 13, 12, 4, 'requester', 'Confirm that the delivered result meets the request.'),
      box('review', 'Review request', 2, 4, 12, 4, 'reviewer', 'Read the complete request and record a decision.'),
      box('deliver', 'Deliver result', 2, 13, 12, 4, 'operator', 'Complete the agreed work and return the result.'),
    ],
    connections: [
      connection('handoff-request', 'prepare', 'review', 'Send', 'The requester submits a request for review.'),
      connection('handoff-approved', 'review', 'deliver', 'Approve'),
      connection('handoff-result', 'deliver', 'accept', 'Return'),
    ],
  },
  architecture: {
    schemaVersion: SKETCH_V1_VERSION,
    id: 'architecture-example',
    title: 'Application components',
    description: 'Nested component groups and connections use the same box vocabulary as every other sketch.',
    boxes: [
      box('application', 'Application', 0, 0, 51, 25),
      box('interface-group', 'Interface group', 2, 4, 18, 18, 'application'),
      box('service-group', 'Service group', 28, 4, 20, 18, 'application'),
      box('client', 'Browser client', 2, 4, 14, 4, 'interface-group'),
      box('api', 'Application API', 3, 4, 14, 4, 'service-group', 'Accepts requests and coordinates application behavior.'),
      box('store', 'Record store', 3, 12, 14, 4, 'service-group', 'Persists application records.'),
    ],
    connections: [
      connection('request-api', 'client', 'api', 'Call'),
      connection('store-record', 'api', 'store', 'Save'),
    ],
  },
  ui: {
    schemaVersion: SKETCH_V1_VERSION,
    id: 'ui-example',
    title: 'Review screen sketch',
    description: 'A screen, its content, and its controls are ordinary nested boxes. No UI-specific renderer is used.',
    boxes: [
      box('screen', 'Review screen', 0, 0, 46, 27),
      box('navigation', 'Navigation', 2, 4, 10, 20, 'screen'),
      box('content', 'Content', 18, 4, 25, 20, 'screen'),
      box('inbox', 'Inbox', 1, 4, 8, 4, 'navigation', 'Navigate to pending items. This sketch never executes navigation.'),
      box('summary', 'Request summary', 2, 4, 21, 6, 'content', 'Shows the complete selected request.'),
      box('decision', 'Review decision', 2, 14, 21, 4, 'content', 'A low-fidelity control placeholder, not an executable action.'),
    ],
    connections: [connection('select-item', 'inbox', 'summary', 'Open')],
  },
};

const examples = {
  workflow: {
    schemaVersion: SKETCH_VERSION, id: 'workflow-example', title: 'Request, review, and deliver',
    description: 'Role groups, a labeled decision and explicit outcomes are data, not executable workflow rules.',
    boxes: [
      { ...box('requester', 'Requester', 0, 0, 24, 46), appearance: { profile: 'teal', treatment: 'tinted' } },
      { ...box('reviewer', 'Reviewer', 34, 0, 24, 46), shape: 'rounded-rectangle', appearance: { profile: 'violet' } },
      { ...box('operator', 'Operator', 68, 0, 24, 46), appearance: { profile: 'blue', treatment: 'tinted' } },
      { ...box('prepare', 'Prepare request', 2, 6, 20, 9, 'requester'), caption: 'Desired outcome', icon: 'document' },
      { ...box('accept', 'Accept result', 2, 32, 20, 9, 'requester'), icon: 'check', appearance: { treatment: 'filled' } },
      { ...box('review', 'Approve?', 2, 6, 20, 20, 'reviewer'), shape: 'diamond', text: { align: 'center' },
        details: 'Read the complete request and choose the explicitly labeled outcome.' },
      { ...box('deliver', 'Deliver result', 2, 32, 20, 9, 'operator'), shape: 'rounded-rectangle', caption: 'Agreed work' },
    ],
    connections: [
      connection('handoff-request', 'prepare', 'review', 'Send'),
      connection('handoff-approved', 'review', 'deliver', 'Yes'),
      { ...connection('handoff-declined', 'review', 'accept', 'No'), stroke: 'dashed' },
      connection('handoff-result', 'deliver', 'accept', 'Return'),
    ],
  },
  architecture: {
    schemaVersion: SKETCH_VERSION, id: 'architecture-example', title: 'Application components',
    description: 'Named profiles, shaped leaves and labeled relationships use the same generic composition vocabulary.',
    boxes: [
      { ...box('application', 'Application', 0, 0, 84, 48), appearance: { profile: 'blue', treatment: 'tinted' } },
      { ...box('interface-group', 'Interface group', 2, 6, 30, 38, 'application'), shape: 'rounded-rectangle' },
      { ...box('service-group', 'Service group', 42, 6, 38, 38, 'application'), caption: 'Request handling' },
      { ...box('client', 'Client', 3, 8, 24, 24, 'interface-group'), shape: 'circle', icon: 'user', text: { align: 'center' } },
      { ...box('api', 'Application API', 3, 8, 32, 9, 'service-group'), shape: 'rounded-rectangle', icon: 'service',
        caption: 'Requests', body: 'Coordinates records.' },
      { ...box('store', 'Record store', 3, 25, 32, 9, 'service-group'), icon: 'database', appearance: { profile: 'amber' } },
    ],
    connections: [
      { ...connection('request-api', 'client', 'api', 'Request'), arrowheads: 'both' },
      { ...connection('store-record', 'api', 'store', 'Events'), stroke: 'dashed' },
    ],
  },
  ui: {
    schemaVersion: SKETCH_VERSION, id: 'ui-example', title: 'Mail screen sketch',
    description: 'A bounded mail composition demonstrates ordered groups and visible text. No control is executable.',
    boxes: [
      { ...box('screen', 'Mail', 0, 0, 110, 76), appearance: { profile: 'teal' },
        layout: { direction: 'vertical', order: ['header', 'content'], gap: 2, padding: 2 } },
      { id: 'header', parent: 'screen', label: 'Inbox', caption: 'Search mail and select a message', icon: 'mail',
        shape: 'none', w: 104, h: 6, sizing: { width: 'stretch' } },
      { id: 'content', parent: 'screen', label: 'Workspace', w: 104, h: 60, sizing: { width: 'stretch', height: 'stretch' },
        layout: { direction: 'horizontal', order: ['navigation', 'messages', 'reader'], gap: 2 } },
      { id: 'navigation', parent: 'content', label: 'Folders', w: 20, h: 52, sizing: { height: 'stretch' },
        layout: { direction: 'vertical', order: ['compose', 'inbox'] }, icon: 'folder' },
      { id: 'compose', parent: 'navigation', label: 'Compose', w: 18, h: 6, sizing: { width: 'stretch' },
        appearance: { treatment: 'filled' }, details: 'A low-fidelity placeholder, not an executable action.' },
      { id: 'inbox', parent: 'navigation', label: 'Inbox', caption: '2 messages', w: 18, h: 7, sizing: { width: 'stretch' } },
      { id: 'messages', parent: 'content', label: 'Messages', w: 28, h: 52, sizing: { height: 'stretch' },
        layout: { direction: 'vertical', order: ['selected-message', 'next-message'] } },
      { id: 'selected-message', parent: 'messages', label: 'Project update', caption: 'Alex · Today',
        body: 'The review is ready.', w: 26, h: 10, sizing: { width: 'stretch' }, appearance: { treatment: 'tinted' } },
      { id: 'next-message', parent: 'messages', label: 'Team notes', caption: 'Sam · Yesterday',
        body: 'Notes from our discussion.', w: 26, h: 10, sizing: { width: 'stretch' } },
      { id: 'reader', parent: 'content', label: 'Project update', w: 48, h: 52,
        sizing: { width: 'stretch', height: 'stretch' }, layout: { direction: 'vertical', order: ['summary', 'decision'] } },
      { id: 'summary', parent: 'reader', label: 'Alex', caption: 'To: Design team', body: 'The review is ready.\nPlease share your feedback.',
        shape: 'none', w: 44, h: 15, sizing: { width: 'stretch' }, text: { emphasis: 'strong' },
        details: 'Shows the complete selected message without moving body content into disclosure.' },
      { id: 'decision', parent: 'reader', label: 'Reply', caption: 'Sketch only', w: 20, h: 7,
        appearance: { treatment: 'outlined' } },
    ],
    connections: [],
  },
};

// Templates are validated instances, never schemas or renderer registrations.
for (const [key, value] of Object.entries(legacyExamples)) legacyExamples[key] = validateSketch(value);
for (const [key, value] of Object.entries(examples)) examples[key] = validateSketch(value);
export const templateCatalog = Object.freeze(Object.entries(examples).map(([id, value]) => Object.freeze({
  id, title: value.title, description: value.description,
})));

/** Fresh mutable JSON data for generation/editing; validate it before rendering. */
export function createTemplate(id, version = SKETCH_VERSION) {
  if (![SKETCH_VERSION, SKETCH_V1_VERSION].includes(version)) throw new RangeError(`Unsupported sketch template version: ${version}`);
  const source = version === SKETCH_V1_VERSION ? legacyExamples : examples;
  if (!Object.hasOwn(source, id)) throw new RangeError(`Unknown sketch template: ${id}`);
  return JSON.parse(JSON.stringify(source[id]));
}

export function createLegacyTemplate(id) { return createTemplate(id, SKETCH_V1_VERSION); }
