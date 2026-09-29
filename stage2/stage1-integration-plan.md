# Stage 1 to Stage 2 integration plan

Status: agreed direction; implementation and the exact handoff contract remain
to be finalized. This document does not claim that integration has shipped.

## Core idea: let Designer continue the Design

**Stage 1 is optional. Users can open Stage 2 directly and start there**, with
either a new project or an existing repository. No Stage 1 effort, completed
stage, prototype, exported bundle or handoff file is required.

When used, Stage 1 discovers intent through prototyping. Stage 2 develops against
the resulting agreement. The bridge is the existing Designer workflow, not a
separate importer or a restart of discovery.

This is analogous to Designer exploring an existing repository. Instead of
reconstructing a system's Design primarily from code, Designer reads the
existing design documents and HTML prototype, understands the confirmed
decisions, and continues from there.

Stage 1 does not need to generate Tandem's internal artifact format. Designer
uses the ordinary Stage 2 artifact-authoring and publication path to represent
and refine the existing agreement.

## Scope: replace the old delivery stages

Stage 2 **replaces Stage 1's Plan, Implement and Test stages** in the integrated
product. It is not an additional workflow after those stages have already run.
Stage 1 supplies preparation, requirements, prototyping and Design; Stage 2
continues that Design and owns subsequent planning, implementation, validation
and Review.

```text
Direct entry: new project or existing repository -----------------+
                                                                |
Optional Stage 1: Prepare -> Requirements -> Prototype -> Design  |
                                                          |     |
                                                   handoff|     |
                                                          v     v
Stage 2: conversational Design / confirmed implementation / Review
```

Direct entry uses the ordinary Stage 2 Router and Designer to establish or refine
the agreement from the user's request and available project context. It does not
fabricate completed Stage 1 stages or treat a missing handoff as a setup error.
The normal Design and implementation-confirmation boundaries still apply.

After handoff, the user changes the Design by talking to the Stage 2 agent and
using its existing Designer/question flow. There is **no current requirement to
return to an earlier Stage 1 step**, reopen its lifecycle, or synchronize two
editable Design authorities. Stage 1 handoff files and history remain available
as references; Stage 2's published Design becomes the agreement for subsequent
work. New implementation still requires the existing explicit confirmation.

This does not require removing backward navigation within standalone Stage 1
now. It means the integration should not add a cross-stage rollback mechanism or
retain the old Plan/Implement/Test sequence as a competing execution path.

## Runtime strategy: foreground owner, private Stage 2 session

Use the existing foreground Copilot session as the entry point for both stages.
Its Tandem extension brings up the Stage 2 runtime when the user opens Stage 2,
whether or not Stage 1 has been used;
that runtime creates or recovers its own private native Copilot session.
The foreground chat need not remain in an active turn while Stage 2 works.

```text
Foreground Copilot session
  |
  +-- Tandem extension / shared entry point
       |
       +-- Stage 1 coordinator
       |    +-- Foreground-session native factories and workers
       |
       +-- Stage 2 runtime
            +-- Owned private Copilot session
                 +-- Router / Designer / Planner / Implementer / Reviewer
                 +-- Native Review factory and scoped workers
```

Here, "background session" means Stage 2's separately owned, persistent native
session, not a temporary factory worker or a second copy of the foreground
conversation. Stage 1's retained discovery/Design operations keep their
foreground-session factory model;
Stage 2 keeps its private role conversation and factory registrations.
The seven factory types in today's Stage 1 implementation are not a mandatory
seven-step launch sequence. Its old delivery factories do not need to be moved
into Stage 2 or run before handoff.

Use **one installed extension entry point** that can open either stage, rather
than loading competing Stage 1 and Stage 2 providers with the same `tandem`
identity. Reuse Stage 2's installation/runtime initialization rather than adding
another session manager, scheduler or orchestration framework.

Preserve these boundaries:

- Bind the Stage 2 private session to its exact owning foreground session and
  project. Reopening recovers that identity and history, not a replacement
  session or an automatic replay of old work.
- Opening Stage 2 only establishes its runtime and surface. Only an explicit
  submission enters its workflow; foreground chat and Stage 1 completion are
  not automatically interpreted as implementation requests.
- Pass explicit references to the Stage 1 Design, prototype and relevant source
  through the handoff below. Do not assume private workers inherit foreground
  chat or treat the prototype as already accepted implementation.
- Retain Stage 2's permissions, implementation confirmation, parent-only
  publication, Stop and Close behavior. Stage 2 Stop must not cancel unrelated
  foreground or Stage 1 work.
- Keep the private-provider no-nesting guard: loading Tandem inside its owned
  private runtime must not create another Stage 2 runtime or app surface.

This strategy composes the existing ownership models; it is the intended
integration, not a claim that the shared entry point is already implemented.
The SDK test-host startup ordering described in the
[test startup guide](docs/testing-startup-and-reopen.md) is test infrastructure,
not a requirement for normal users to disable and re-enable the extension.

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

The shared entry point must expose direct Stage 2 startup without first starting
Stage 1. From there, users can describe a new project or ask Designer to explore
an existing repository through the normal Stage 2 conversation.

For the optional Stage 1 handoff:

1. From the foreground-owned Tandem entry point, the user opens Stage 2, makes
   the Stage 1 files available in the project and asks Tandem to continue that
   Design. Stage 2's private Router interprets this as Design work and hands it
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
6. Later Design changes stay in the Stage 2 conversation and Designer workflow.
   The user does not need to reopen Stage 1 Requirements or Design before
   requesting a revision. Follow-on implementation uses the revised agreement
   and the normal confirmation boundary.

Example initial request:

> Continue from the Stage 1 design in these documents and the mocked HTML
> prototype. Preserve the decisions identified as confirmed. Establish the
> corresponding Tandem Design, and raise consequential gaps or contradictions.
> Do not implement yet.

This is an ordinary request, not a special command. For later mixed
Change Design / Change implementation answers, keep the existing Design-first,
then implementation-confirmation behavior.

## Minimal implementation approach

### Current priority: logic before UX unification

Continue from the colleague's in-progress integration branch when available;
compare its implementation and known issues against this agreed direction rather
than starting over.

The current milestone is functional integration: direct Stage 2 entry, correct
session ownership and lifecycle, explicit handoff, Design continuation, and
confirmed implementation with correct factory/result handling. Stage 1 and
Stage 2 do **not** need a consistent visual design, navigation model or polished
cross-stage experience at this milestone. Temporary UX differences are acceptable;
unification and polish belong to a later pass.

Keep the minimum controls needed to exercise the logic usable and truthful.
Incorrect request routing, accidental submissions, bypassed confirmation or
permissions, ineffective Stop, and lost state are correctness issues, not UX
polish to defer. Do not expand this integration into a renderer rewrite or broad
interaction redesign merely to make the two stages look alike.

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

- A new project and an existing repository can each start directly in Stage 2
  without any Stage 1 state, prototype or handoff files.
- One foreground-owned extension can open either stage without competing
  providers or recursively creating private runtimes.
- Stage 2 runs in its own correctly bound private session without requiring
  an active foreground chat turn. Opening alone submits no project work.
- Stop and Close respect stage ownership; same-session reopen preserves
  Stage 2 history and does not replay old roles or factories.
- A handoff containing documents, mocked HTML and assets reaches Designer and
  produces a useful Design without starting Planner or changing product code.
- Confirmed decisions survive the handoff; mock data and shortcuts do not
  silently become production requirements.
- Missing files, conflicting descriptions and open consequential choices are
  surfaced honestly, not filled with unapproved assumptions.
- Revisions continue an existing Design and retain the original handoff files.
- Stage 2 replaces, rather than follows or duplicates, Stage 1's old
  Plan/Implement/Test execution path.
- A later Design change is handled interactively in Stage 2 without requiring
  backward Stage 1 navigation or overwriting the retained handoff.
- A distinct implementation request waits for confirmation. Cancel starts no
  implementation; approval proceeds against the reviewed Design.
- The resulting implementation and read-only Review use that Design and retain
  relevant handoff context, with validation limits stated explicitly.

These are acceptance checks for future integration work, not completed test
results.

## Still open

Exact handoff filenames, how Stage 1 marks confirmed decisions, the UI affordance
for opening Stage 2, and shared-entrypoint module/package composition remain to
be agreed. The runtime direction is settled above: one foreground-owned entry
point launches Stage 2 with a separate private session. Both source trees
currently use the `tandem` identity, so source co-location alone is not the
shared-entrypoint implementation. Resolve the packaging before activation.

Sharing a foreground launch owner does not require merging the stages'
conversations or factory runs. No new import service or formal exchange schema
is implied by this plan.

See the [current implementation guide](tandem/README.md),
[role and confirmation behavior](docs/human-loop-prompts.md), and
[two-stage overview](docs/tandem-opening-slides-v2.html#6).
