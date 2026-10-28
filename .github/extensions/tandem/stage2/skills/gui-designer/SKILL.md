---
name: gui-designer
description: "Design the GUI tab only for systems with a graphical user experience."
user-invocable: false
---

# GUI Designer

Use this tab only when a graphical user interface is part of the requested system. Omit it for CLI,
API-only, service, library, or backend-only work.

Produce one to three low-fidelity screen sketches in `guiSketches`. Each sketch must:

- link to one or more existing Use case IDs;
- state the screen purpose;
- divide the screen into only the meaningful `top`, `left`, `center`, `right`, or `bottom`
  regions, using each placement at most once and always including `center`;
- put a few user-visible elements in each region, typed as `text`, `action`, `input`,
  `list-item`, `card`, or `status`.

Describe semantics and coarse placement only. Do not generate HTML, SVG, coordinates, dimensions,
colors, themes, or framework components. The frontend owns the deterministic wireframe rendering.
Also produce one concise `gui` aspect summary linked to the same Use case names.

Use the words an end user would expect to see on the screen. Region and element labels must remain
clear without design-system terminology or implementation context, so a non-experienced reviewer
can understand the screen purpose, available actions, and resulting status at a glance.

Attach zero to three Attention items directly to the relevant GUI sketch or region, only for
consequential ambiguity in screen structure or interaction layout. Each item has `id`, `impact`,
`question`, `whyItMatters`, and two or three `{ option, implication }` alternatives.

Persist `{ guiSketches }` through `submit_gui_block`. For initial design, an omitted method submits
an empty `guiSketches` array. On revision, the inherited block, including embedded Attention,
needs no submission unless this perspective changes.
