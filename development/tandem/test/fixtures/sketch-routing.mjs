export const fanoutCrossingSketch = {
  schemaVersion: 'sketch/v1', id: 'compact-routing', title: 'Process a request',
  description: 'Three ordered outputs share the right side. Independent audit traffic crosses without joining them.',
  boxes: [
    { id: 'processing', label: 'Processing', x: 0, y: 0, w: 50, h: 31 },
    { id: 'request', parent: 'processing', label: 'Request', x: 1, y: 13, w: 8, h: 4 },
    { id: 'coordinator', parent: 'processing', label: 'Coordinator', x: 12, y: 12, w: 12, h: 6,
      details: 'One input and three ordered right-side outputs. The unchanged four-connection limit applies.' },
    { id: 'validate', parent: 'processing', label: 'Validate', x: 37, y: 5, w: 10, h: 4 },
    { id: 'store', parent: 'processing', label: 'Store', x: 37, y: 13, w: 10, h: 4 },
    { id: 'publish', parent: 'processing', label: 'Publish', x: 37, y: 21, w: 10, h: 4 },
    { id: 'audit', parent: 'processing', label: 'Audit', x: 27, y: 3, w: 8, h: 4 },
    { id: 'trace', parent: 'processing', label: 'Trace', x: 27, y: 25, w: 8, h: 4 },
  ],
  connections: [
    { id: 'a-request', from: 'request', to: 'coordinator' },
    { id: 'b-validate', from: 'coordinator', to: 'validate' },
    { id: 'c-store', from: 'coordinator', to: 'store' },
    { id: 'd-publish', from: 'coordinator', to: 'publish' },
    { id: 'e-trace', from: 'audit', to: 'trace',
      details: 'One continuous left-bowing bridge passes over the three output routes without joining them.' },
  ],
};
