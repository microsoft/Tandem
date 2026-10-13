export function healthDesign() {
  return {
    useCases: [
      { id: "inspect-trends", title: "Inspect health trends", actor: "Person",
        outcome: "Understand changes in personal health measurements.", steps: [
          { id: "open-trends", userAction: "Open the trend view.", systemResponse: "Show available measurements and their source.", interactionId: "read-trends" },
        ] },
      { id: "choose-source", title: "Choose a health data source", actor: "Person",
        outcome: "Know which source can supply measurements.", steps: [
          { id: "inspect-sources", userAction: "Inspect data source options.", systemResponse: "Show unresolved integration requirements.", interactionId: "read-sources" },
        ] },
    ],
    contract: {
      schemaVersion: "contract-set/v1", title: "Personal health trends", context: "A trend view makes data provenance and integration uncertainty explicit.",
      participants: [
        { id: "person", name: "Person", responsibility: "Chooses measurements and reviews trends." },
        { id: "health-app", name: "Health app", responsibility: "Presents available measurements with their provenance." },
      ],
      interactions: [
        { id: "read-trends", name: "Read available trends", kind: "query", fromParticipantId: "person", toParticipantId: "health-app",
          input: { name: "Period", description: "The time period the person wants to inspect." },
          output: { name: "Trend view", description: "Available measurements, units and source labels." },
          errors: [], guarantees: [{ id: "honest-data", statement: "Missing data is explicit; live synchronization is never implied." }] },
        { id: "read-sources", name: "Inspect data sources", kind: "query", fromParticipantId: "person", toParticipantId: "health-app",
          input: { name: "Source request", description: "Ask which measurement sources are supported." },
          output: { name: "Source options", description: "Documented capabilities or unresolved choices." },
          errors: [], guarantees: [{ id: "documented-source", statement: "No provider capability is invented." }],
          attention: [{ id: "provider-access", impact: "blocking", question: "Which documented provider API and authorization are available?",
            whyItMatters: "Fitbit Air and Google health access are not yet established.",
            alternatives: [
              { option: "Manual sample import", implication: "Explore trends without claiming live provider access." },
              { option: "Verified provider integration", implication: "Confirm API capabilities and authorization before implementation." },
            ] }],
        },
      ], storageContracts: [], lifecycleRules: [],
    },
    controlFlows: [{ id: "trend-workflow", title: "Inspect available measurements", purpose: "Keep missing data explicit.",
      useCaseIds: ["inspect-trends"], nodes: [
        { id: "open", label: "Open trend view", kind: "start", contractKind: "none", contractId: "" },
        { id: "read", label: "Read available measurements", kind: "interaction", contractKind: "interaction", contractId: "read-trends" },
        { id: "shown", label: "Available trends shown", kind: "outcome", contractKind: "none", contractId: "" },
      ], edges: [
        { id: "open-read", fromNodeId: "open", toNodeId: "read", label: "Requested period" },
        { id: "read-shown", fromNodeId: "read", toNodeId: "shown", label: "Available measurements" },
      ] }],
    guiSketches: [{ id: "health-home", title: "Health trends", purpose: "Inspect available data and source limitations.",
      useCaseIds: ["inspect-trends", "choose-source"], regions: [
        { id: "trends", placement: "center", label: "Measurements", elements: [{ kind: "card", label: "Trends and source labels" }] },
        { id: "sources", placement: "bottom", label: "Source status", elements: [{ kind: "status", label: "Provider access needs confirmation" }] },
      ] }],
    systemStacks: [{ title: "Bounded health trend app", layers: [
      { id: "presentation", name: "Trend presentation", responsibility: "Show measurements and source status.",
        technologies: [{ name: "Browser", role: "Displays the trend interface." }] },
      { id: "data", name: "Measurement access", responsibility: "Keep source capabilities explicit.",
        technologies: [{ name: "Documented source contract", role: "No live provider integration until access is confirmed." }] },
    ] }],
    conclusion: {
      goal: "Understand personal health trends.", summary: "Inspect measurements honestly; provider API and authorization need confirmation.",
      aspects: [
        { id: "source-contract", kind: "contract", title: "Honest source access", summary: "No unverified live-sync promise.", relatedElements: ["read-sources"] },
        { id: "trend-flow", kind: "control-flow", title: "Read available trends", summary: "Show the requested available measurements.", relatedElements: ["trend-workflow"] },
        { id: "trend-ui", kind: "gui", title: "Health trend view", summary: "Measurements and visible source limitations.", relatedElements: ["health-home"] },
        { id: "trend-system", kind: "system", title: "Presentation and source access", summary: "Keep presentation separate from provider access.", relatedElements: ["presentation", "data"] },
      ],
      notes: [], reviewSummary: { headline: "Health trend design with explicit source uncertainty.", changes: [
        { id: "source-choice", title: "Confirm source access", description: "Keep provider API and authorization as anchored Attention.",
          whyItMatters: "Prevents false live synchronization claims.", visibility: "visible", perspective: "contract", elementId: "read-sources" },
      ] },
    },
  };
}
