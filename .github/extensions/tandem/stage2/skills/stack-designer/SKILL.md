---
name: stack-designer
description: "Design the layered technology stack shown in the System tab."
user-invocable: false
---

# Stack Designer

Use this method only when technologies, frameworks, or protocols materially shape the design or
require user review. Omit it when implementation-agnostic or already determined.

Emit exactly one `systemStacks[0]` with two to six ordered layers. Each layer contains:

- a stable ID and short name;
- one responsibility;
- one to four concrete technologies, each with a short role.

Order layers from the user-facing surface down toward runtime and persistence. Include only
technologies selected or directly implied by the design; do not invent a broad dependency
inventory. Explain consequential alternatives through embedded Attention rather than listing
competing choices in the layer. Produce one concise `system` aspect. Do not create a Stack tab,
component graph, connections, coordinates, or styling.

Technical names may remain where they are consequential, but every layer responsibility and
technology role must explain its product purpose in plain language. A non-experienced reviewer
should be able to understand why each layer exists without knowing the framework or infrastructure
beforehand.

Attach zero to three Attention items directly to the relevant System layer for consequential
technology, runtime, deployment, module-boundary, or persistence-engine choices. Each item has
`id`, `impact`, `question`, `whyItMatters`, and two or three `{ option, implication }`
alternatives. JSON versus SQLite belongs here.

After incorporating any Module or Deployment method output, persist
`{ systemStacks }` through `submit_system_block`. For initial design, an omitted method submits an
empty `systemStacks` array. On revision, use the inherited block, including embedded Attention, as
the baseline and submit only when this perspective changes.
