---
name: control-flow-designer
description: "Design the Flow tab when orchestration, branching, or state transitions matter."
user-invocable: false
---

# Control-Flow Designer

Use this method when the design contains meaningful orchestration, branching, asynchronous work,
retries, or state transitions. Omit it for a trivial straight-through interaction and emit
`controlFlows: []`.

Emit one to four reviewable flows using exactly:

```text
controlFlow
├─ id
├─ title
├─ purpose
├─ useCaseIds[]
├─ nodes[]
│  ├─ id
│  ├─ label
│  ├─ kind: start | action | decision | interaction | storage | outcome | error
│  ├─ contractKind: none | interaction | storage
│  └─ contractId
└─ edges[]: { id, fromNodeId, toNodeId, label }
```

Use stable lowercase kebab-case IDs. A flow has exactly one `start` and at least one `outcome` or
`error`. For nodes without a contract reference, use `contractKind: none` and `contractId: ""`.
Connect the start node to the first operation. Every node must be reachable from start, every
path must end at an outcome or error, and only outcome/error nodes may omit an outgoing edge.
An intermediate outcome may lead to a final outcome when the flow exposes distinct observable
results, such as producing stdout before returning an exit code.
Otherwise reference an existing `contract-set/v1` interaction or storage-contract ID.
`interaction` nodes must reference the exact interaction they perform, and `storage` nodes must
reference the exact store they access. Never attach one representative interaction ID to a generic
node that stands for several operations. Split the flows, add explicit operation branches, or use
an `action` node with no contract reference for genuinely shared behavior.

Describe the main control path and only material alternate paths. Use decisions and labeled edges
for validation failures, missing state, retries, or commit failures. Produce one concise
`control-flow` aspect summary to make the Flow tab applicable, but keep the graph in
`controlFlows`. Do not restate every contract interaction.

Write node and edge labels as a plain-language story a non-experienced reviewer can follow from
start to outcome. Describe what the product or user observes, not function names, internal
services, protocol verbs, or implementation mechanics unless those mechanics are themselves the
decision under review. Decision labels should read as understandable questions.

Attach zero to three Attention items directly to the relevant Flow, node, or edge, only for
consequential ambiguity in branching, ordering, failure handling, retries, or state transitions.
Each item has `id`, `impact`, `question`, `whyItMatters`, and two or three
`{ option, implication }` alternatives.

Persist `{ controlFlows }` through `submit_flow_block`. For initial design, an omitted method
submits an empty `controlFlows` array. On revision, the inherited block, including embedded
Attention, needs no submission unless this perspective changes.
