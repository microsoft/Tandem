export const formatArtifacts = [
  {
    schemaVersion: 'artifact/v1', format: 'mermaid', id: 'order-flow', title: 'Order workflow',
    width: 800, height: 480,
    source: 'flowchart LR\n  menu["Browse menu"] --> bag["Review bag"]\n  bag --> pay["Authorize payment"]\n  pay --> ready["Pickup ready"]\n  pay --> retry["Payment declined"]\n  retry --> bag',
  },
  {
    schemaVersion: 'artifact/v1', format: 'html', id: 'checkout', title: 'Checkout screen',
    width: 800, height: 480,
    source: '<style>.sheet{display:grid;grid-template-columns:1fr 1fr;gap:20px;padding:20px;background:#ffffff;color:#17241f;font-family:system-ui}.tile{height:160px;background:#e03030;padding:20px}.bag{padding:20px;border:1px solid #888888}@media(max-width:600px){.sheet{grid-template-columns:1fr}}</style><section class="sheet" id="screen"><div class="tile" id="drink"><h2>Oat flat white</h2><p>Regular, oat milk</p></div><aside class="bag" id="bag"><h2>Your bag</h2><p>Total: $4.80</p><p>Pickup in 10 minutes</p></aside></section>',
  },
  {
    schemaVersion: 'artifact/v1', format: 'svg', id: 'pickup-plan', title: 'Pickup geometry',
    width: 800, height: 480,
    source: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 480"><rect width="800" height="480" fill="#ffffff"/><g transform="translate(80 60)"><rect id="counter" width="300" height="180" fill="#e03030"/><text x="20" y="40" font-size="24" fill="#ffffff">Pickup counter</text></g><path d="M80 360 L600 360 L600 180" fill="none" stroke="#214f40" stroke-width="8"/></svg>',
  },
];

export function multiFormatDesign() {
  return {
    schemaVersion: 'sketch-design/v3', goal: 'Order coffee and pick it up.',
    summary: 'Complementary workflow, checkout and spatial views.',
    outcomes: [{ id: 'order-ready', description: 'An accepted order is ready at the pickup counter.',
      references: formatArtifacts.map(({ id }) => id) }],
    artifacts: structuredClone(formatArtifacts),
  };
}
