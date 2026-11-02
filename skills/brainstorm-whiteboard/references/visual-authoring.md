# Compose a useful native visual

Use the simplest visual that clarifies the current conversation. This is
on-demand authoring guidance, not a required diagram phase or a reason to put
every answer on a board. Explain the essential meaning and uncertainty in chat.
Human sketches can supply the idea; preserve them rather than demanding a prose
duplicate or treating your interpretation as an accepted decision.

## Match structure to the relationship

| What needs explaining | Useful structure | Avoid |
| --- | --- | --- |
| One route through a process | A short directed flow | More stages than the question needs |
| Alternative outcomes | A visible fork with distinct outcome labels; join only if paths really reconverge | A straight chain that hides the alternative |
| Choices against shared criteria | Aligned columns/rows with the same comparison headings | Arrows that imply one choice causes the other |
| Sequence over time | A timeline with a consistent direction and explicit dates/order | Spacing that implies measured duration when none is known |
| Ownership or containment | Parent/child groups, a hierarchy or native frames | Process arrows standing in for containment |
| A rough interface | Navigation, aligned labeled fields, actions and a preview/content area | Identical giant boxes, a screenshot or a fake working website |
| A spatial idea or uncertain sketch | A few shapes/ink marks plus a clarifying question | Inventing object names or silently tidying away human marks |

Use different positions and allocations for different roles, not a different
shape for every noun. Keep arrow directions consistent. A fork needs enough
space for both outcomes; a join needs an explicit common destination. Label
conditions when the distinction would otherwise be ambiguous.

## A small, consistent starting style

For **new agent-authored structured diagrams and UX sketches**, prefer normal
native text (`fontFamily: 2`), `roughness: 0`, solid thin strokes and restrained
fills. This is not a global preference, a theme applied to existing boards, or a
ban on a deliberate rough sketch. Keep a human's chosen fonts, ink, colors and
positions unless an agreed change requires otherwise.

Our starting palette is role-based, not an automatic semantic classifier:

| Role | Fill | Border/text | Meaning must also appear in words |
| --- | --- | --- | --- |
| Neutral context | `#f5f7fb` or white | `#52657a` | Name the component or context |
| Current focus/review | `#edf3fb` | `#2b456b` | State what is being reviewed |
| Ready outcome | `#eff7f0` | `#367650` | For example, "Approve release" |
| Needs discussion/revision | `#fff5e5` | `#936a22` | For example, "Request changes" |
| Connector | Transparent | `#526b8b` | Direction and any necessary condition |

Do not use color as the only distinction. A warning-looking fill is not proof
that a node is a failure, and a green fill is not an approval receipt.

Start with 1.5-unit shape borders and 1.25-unit arrows. Use a short title around
24-28, body labels around 18-20, and secondary notes around 14-16, adjusted for
the intended viewing scale. Use hierarchy and whitespace, not handwritten
fonts or excessively heavy borders, to make agent-created structure legible.
The native schema has no arbitrary CSS/font-weight/shadow styling.

Align related edges, baselines and field widths. Use a consistent small spacing
rhythm (for example 8/16/24 units) and leave generous connector clearance.
The helpers use 10-unit internal label padding; allow more space around cards.
Allocate text before connecting shapes, use explicit line breaks when needed,
and enlarge a node rather than squeezing or clipping its label. Keep controls,
arrows and annotations out of one another's space. Inspect the result at the
actual handoff scale, not only at a zoomed-in editing view.

## Construct native objects, not a flattened picture

The [editing cookbook](editing-cookbook.md) supplies executable `branch` and
`ux` recipes using the existing validated API and small helpers. `branch`
creates Submit request -> Check ownership, then forks to Approve release and
Request changes. The two outcomes are separated vertically, not hidden in a
four-box chain. `ux` creates a rough editable form/navigation/preview layout.
These are examples, not inferred requirements or a compulsory template.

Every declared label must be native bound text, with reciprocal container
references. Arrows need native endpoint bindings and reciprocal shape
references; grouping or proximity is not a substitute. Keep stable IDs when
refining an existing object. Leave intentionally standalone annotations and ink
alone. Geometry helpers support their documented subset; reject a complex
unsupported edit rather than break native relationships.

The [API/native reference](api-and-elements.md) is the field authority. Do not
invent unsupported SVG/HTML/raster content, styling fields or another semantic
DSL. No external template/library pack is needed.

## Review the exact version before handoff

1. Read the addressed topic's latest or exact handed-over seal. Keep its
   instance/topic/version identities. If work is pending, distinguish your own
   receipts from unknown peer work; do not overwrite it or assume who changed it.
2. Make a guarded edit against the actual read's `versionId`. Preserve unrelated
   objects and human input. A stale guard means reconcile, not replace the ID
   in the same old request.
3. Explicitly seal the successful edit's returned working ID. Read that exact
   seal or request `snapshot({topicId,target:sealed.versionId})`; never inspect
   an earlier image and imply it is the current result.
4. With image/browser tools, actually inspect the returned whole-topic PNG:
   text legibility/clipping, hierarchy, alignment, arrow endpoints, branch
   visibility, overlaps and the survival of human marks. Confirm both paths of
   a fork are visible and their labels explain the distinction.
5. If a concrete visual defect needs correction, take a fresh sealed read and
   verify no pending work, apply a bounded local edit with that guard, then seal
   and inspect the actual corrected ID. Stop for new peer work or genuine
   ambiguity. No blanket reset, automatic sealing or endless polish loop.

If image/browser tools are unavailable, say **visual review was not performed**
and explain what the structural checks cover. JSON validity, a passing test,
or a successful PNG request alone is not visual correctness. Tests can establish
bindings, IDs, guarded operations and preserved data; judging composition,
meaning and readability still requires inspecting the visual.
