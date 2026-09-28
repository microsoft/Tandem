# Stage 1 to Stage 2 integration plan

Status: agreed direction; implementation and the exact handoff contract remain
to be finalized. This document does not claim that integration has shipped.

## Core idea: let Designer continue the Design

Stage 1 discovers intent through prototyping. Stage 2 develops against the
resulting agreement. The bridge is the existing Designer workflow, not a
separate importer or a restart of discovery.

This is analogous to Designer exploring an existing repository. Instead of
reconstructing a system's Design primarily from code, Designer reads the
existing design documents and HTML prototype, understands the confirmed
decisions, and continues from there.

Stage 1 does not need to generate Tandem's internal artifact format. Designer
uses the ordinary Stage 2 artifact-authoring and publication path to represent
and refine the existing agreement.

## Provisional handoff

The expected input is ordinary project files:

- Documents describing intended behavior, scope and decisions.
- An HTML prototype with mocked data demonstrating interactions and visible states.
- Any assets needed to understand the prototype.

The handoff should make clear which decisions are user-confirmed, which are
proposals or open questions, and which behaviors are merely mock shortcuts.
That information can be in the documents or the user's request; no fixed
manifest, filename convention or interchange schema is agreed yet.

The documents and prototype complement each other. Documents explain rules
that the mock cannot demonstrate. The prototype makes the experience tangible.
Neither silently overrides the other when they conflict, and mocked behavior
is not evidence that backend logic, persistence or integrations work.

## Intended user flow

1. The user makes the Stage 1 files available in the project and asks Tandem to
   continue that Design. Router interprets this as Design work and hands it
   to Designer, not directly to Planner.
2. Designer inspects the supplied documents, prototype source and relevant
   project context read-only. It preserves the original files and distinguishes
   confirmed intent, open choices and implementation shortcuts.
3. Designer continues the Design using normal Stage 2 artifacts. It preserves
   agreed decisions, avoids repeating settled discovery questions, and raises
   only consequential gaps, conflicts or unclear assumptions through the
   existing question mechanism. Re-expressing a decision in an artifact is not
   permission to change it.
4. Designer publishes the Design and hands control back to the user. Publication
   alone does not start implementation. The user reviews and refines the Design
   through the normal conversation and question flow.
5. When the user requests implementation, the existing confirmation applies
   to that request and current Design. Only after confirmation does Planner
   start. Implementer builds and validates the user journeys; Reviewer checks
   Design conformance and over-engineering and reports without editing code.

Example initial request:

> Continue from the Stage 1 design in these documents and the mocked HTML
> prototype. Preserve the decisions identified as confirmed. Establish the
> corresponding Tandem Design, and raise consequential gaps or contradictions.
> Do not implement yet.

This is an ordinary request, not a special command. For later mixed
Change Design / Change implementation answers, keep the existing Design-first,
then implementation-confirmation behavior.

## Minimal implementation approach

Start with a representative Stage 1 handoff and exercise the existing Router
and Designer path. Reuse existing file inspection, artifact publication,
questions and implementation confirmation. Change prompts or input-context
assembly only where this concrete exercise reveals a gap.

Continuing an already-established Stage 2 Design should refine that Design,
not replace it with a fresh baseline or discard its history. If the user wants
to reuse prototype code, that is a later authorized implementation decision;
it is not an automatic side effect of reading the handoff.

Do not introduce a parallel workflow engine, direct file-to-canonical-state
conversion, automatic prototype execution, automatic implementation, or a
requirement for the colleague's Stage 1 to understand Stage 2 internals.
Inspecting prototype source is distinct from running arbitrary prototype
scripts; existing permission and rendering boundaries remain in effect.

## What to verify before calling the integration complete

- A handoff containing documents, mocked HTML and assets reaches Designer and
  produces a useful Design without starting Planner or changing product code.
- Confirmed decisions survive the handoff; mock data and shortcuts do not
  silently become production requirements.
- Missing files, conflicting descriptions and open consequential choices are
  surfaced honestly, not filled with unapproved assumptions.
- Revisions continue an existing Design and retain the original handoff files.
- A distinct implementation request waits for confirmation. Cancel starts no
  implementation; approval proceeds against the reviewed Design.
- The resulting implementation and read-only Review use that Design and retain
  relevant handoff context, with validation limits stated explicitly.

These are acceptance checks for future integration work, not completed test
results.

## Still open

Exact handoff filenames and packaging, how Stage 1 marks confirmed decisions,
and how the user opens the next stage remain to be agreed. Both source trees
currently use the `tandem` extension identity; source co-location does not
resolve runtime entrypoint or packaging choices. Decide those separately
before activating the stages together.

No shared-session requirement, new import service or formal exchange schema is
implied by this plan.

See the [current implementation guide](tandem/README.md),
[role and confirmation behavior](docs/human-loop-prompts.md), and
[two-stage overview](docs/tandem-opening-slides-v2.html#6).
