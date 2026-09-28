---
name: tandem
description: "Guide intent through Preparation, Requirements, approved Sketch, Prototype, and the native Development workspace for Design, implementation and Review."
priority: 100
categories:
  - prototyping
  - ui
  - frontend
  - product-design
triggers:
  keywords:
    - fast prototype
    - rapid prototype
    - prototype
    - prototyping
    - wireframe
    - proof of concept
    - mock UI
    - interaction flow
    - UI skeleton
  content_patterns:
    - '(?i)\b(poc|proof[- ]of[- ]concept)\b'
invocation:
  user_invocable: true
  disable_model_invocation: false
---

# Tandem

This is the loaded Tandem skill. Do not invoke the skill again.

The active lifecycle is **Preparation -> Requirements -> Sketch -> Prototype ->
Development**. Development is PR #14's original human-loop application, not a
renamed version of the old Design/Plan/Implement/Test factory pipeline.

## Invocation and intent

The end-user command can be as small as:

```text
/tandem "Build a useful team task board"
```

Treat the supplied text as a goal, not a finished specification. Open the
`tandem` canvas immediately using stable instance `tandem`, a short stable
`prototypeId`, and the goal. For an explicitly new goal, use `reset: true` only
at the permitted upstream reset boundary. Without a goal, open without reset
to restore the effort or show goal entry. Do not inspect the workspace, research
sources or interview the user before opening.

If the user supplied no goal, let them enter it and click **Start project**.
Opening a blank effort starts no agents. A supplied goal starts the bounded
Preparation work owned by Tandem; let progress and results remain in its UI.
Do not launch a second engine, create replacement sessions, or perform its
background work in the parent chat.

Do not ask the user to write an architecture, screen list, data model or
implementation prompt. Collect optional "I want to..." usages first. Suggestions
are not accepted scope until added; an accepted usage is not an answered decision.
Business names, hours, addresses and similar content may remain explicit
placeholders rather than blocking discovery.

## Upstream interaction and authority

Tandem owns user interaction. Hidden workers must not call `ask_user`,
`ask_user_question` or unrelated interactive question tools. Return questions
through the active stage's structured DAG or prototype clarification fields.
Where the result schema has no question field, report assumptions, deferred work
or blockers instead of interviewing the user. This never bypasses native tool
permissions.

Read the owning canvas state before claiming an operation succeeded. Worker or
factory completion is not proof that the application accepted its result.
Preserve request, generation, source and specification identities. Never edit
`.tandem` manually to manufacture readiness, approval, a test pass or recovery.

The Node main session's permission controls apply to Preparation through
Prototype only. Development has a separate private Interactive session and
its own consent. Main Allow all, Microsoft speech sign-in and upstream Reset
must not be presented as private Development controls.

## Preparation

Preparation checks the workspace, researches only necessary authoritative
sources, and produces a Requirements handoff. For ordinary goals in an empty
workspace, the existing lightweight goal-only path is sufficient; do not add
unnecessary research. Named products, repositories or specialized methods may
require primary sources, within the worker's existing budget.

The visible work items are workspace inspection, authoritative-source analysis
and Requirements handoff. Preserve sources, readiness checks, suggested usages,
assumptions and deferrals. Missing tooling or credentials are not fabricated
successes. `needs-attention` may proceed to Requirements with explicit deferrals;
a failed worker remains visible for **Retry preparation**.

The handoff selects:

- `build`: create a graphical prototype.
- `validate-existing`: use and revise the existing GUI's copied source.
- `not-applicable`: retain the non-GUI reason and feature specification.
- `undecided`: ask an explicit Requirements decision about GUI validation.

Preparation completes automatically through the existing owned factory receipt.
Do not call stage completion to bypass it.

## Requirements

Let the user add usages and optional suggestions before explicitly generating
the DAG. Each decision has prerequisites, a clear question, three to five curated
choices, a recommended default where appropriate, and mutually exclusive free
text. Questions should affect observable behavior or the primary workflow.

Only the user's actual answer is authoritative. Changing an answer invalidates
dependent decisions while retaining independent accepted answers. Whole-graph
defaults require their own explicit confirmation of the displayed recommendations
and one generation/revision-bound reconciliation; they are not repeated implicit
one-question approvals. Conflicts and changed questions require review.

After generation, verify `requirements.substage === "dag"`, the decision graph,
the active question and processing receipt before claiming readiness. Failed
generation/reconciliation retains the user's inputs for explicit retry.

## Sketch

Keep the existing screen editor, shapes, transitions, undo/redo, streamed
revisions, live voice and approval flow. Drawings describe the actual primary
journey, not one screen per decision. Preserve stable screen/shape IDs and exact
accepted decision references. Do not invent a sketch approval.

Only explicit user approval of the current rendered drawings creates the
approved document/image handoff. A changed requirements digest, revision or
document hash invalidates approval. Prototype workers use the exact approved
revision and the owned image-reading tool; do not substitute a different drawing.

No-GUI efforts skip Sketch and Prototype with a retained reason and feature
specification, not invented screens.

## Prototype

The prototype is a separate artifact, not the Tandem discovery UI itself. Keep
the existing structure/interaction/optional-visual checkpoints, finite work
window, durable feedback queue and explicit **Apply update** controls. Retain
the working displayed checkpoint if a later attempt fails.

For `validate-existing`, work from the same existing GUI's copied source; do not
replace it with a parallel demo. For `build`, create the minimum complete primary
journey with typed UI models and a clear mock boundary. Preserve keyboard access,
loading/empty/error states, user-selected dimensions and agreed interaction.

Prototype scope is intentionally limited:

- Use explicit mock data and typed contracts, not unapproved production services.
- Do not provision infrastructure, spend on real transactions or copy credentials.
- Keep dependency/browser caches and runtime profiles outside retained source.
- Do not claim backend, persistence, integration or test evidence from a mock UI.
- Label shortcuts, assumptions, unresolved conflicts and deferred production work.

A preview URL is convenient, not durable source evidence. The displayed
checkpoint and actual multi-file source fingerprint must match. Do not reduce
a React or multi-file prototype to an invented `index.html`.

**Finish Prototype and continue Design** retains `generate-design-spec`, which
creates `draft-feature-spec` at Prototype. It is not the retired technical
Design stage. Resolve outstanding feedback, pending checkpoints and applicable
sketch approval first. An offline preview does not invalidate already recorded,
source-bound input; absent or changed required files are explicit blockers.

## Prototype handoff to Development

The host freezes an immutable receipt and exact documents/source under the
target workspace's `.tandem\living-canvas\handoffs`. The receipt identifies the
effort, generation, completed snapshot revision/hash, artifact and asset hashes,
approved sketch, displayed checkpoint/source manifest, original shared state
root, actual target worktree, and one exact request ID/timestamp/message.
The snapshot retains confirmed, assumed and deferred decisions and mock
shortcuts without reclassifying them.

Use that ordinary persisted request through `HumanLoopRuntime.send`. Router
selects Designer; Designer reads the retained documents/source read-only and
publishes through `stage_human_design` and `submit_designer_outcome`. Do not
convert the upstream sketch directly into canonical Stage 2 Design, execute
prototype scripts, or copy prototype files onto production files automatically.

Preserve confirmed intent and the approved experience. Ask only about
consequential gaps or contradictions. A new handoff refines the existing
canonical Design. Legacy Design/Plan/Implement/Test approvals and passes remain
historical evidence, not new authority.

The exact envelope is persisted before sending. Duplicate clicks, tabs,
refreshes and lost acknowledgements reconcile it; never allocate another
identity automatically. Recovery-retired work must not be resent. Use a fresh
explicit message inside Development if the user wants to continue after
retirement. Opening/refreshing Development alone sends no project request.

## Native Development workflow

Keep the original Stage 2 Design/Conversation UI and controls in its full-size
isolated iframe. Its document, CSS, scripts and absolute API routes are not
ported into React. Navigation away is not Stop or Close and should not discard
an unsent draft.

Design publication returns to the user. A separate implementation request must
receive the original request/Design-bound confirmation before Planner or baseline
capture. Cancel records the decision without sending a model turn. Do not use
host acceptance/export as a substitute for implementation confirmation.

Use the native Router -> Designer / Planner -> Implementer -> Reviewer sequence.
Implementer runs the actual agreed checks and journeys. Reviewer is read-only,
checking Design conformance and over-engineering, with honest partial/unavailable
coverage. There is no extra final Test gate, independent certification scheduler
or old factory approval sequence.

Typed, identity-bound terminal results remain the normal completion authority.
Do not add idle, pending-tool, background-process, permission or quiescence gates
to normal role settlement. Keep native immediate dispatch, once-only consent,
read-only enforcement, cancellation, and the PR's one-shot missing-result
continuation. Never infer that readiness, an empty finding list or worker prose
means tests passed.

The private session uses `requestExtensions: false`. Retain the exact main/private
ownership records, WAL, Design, conversation, images and native history.
Compaction changes model context, not retained evidence. Same-ID recovery retires
interrupted dispatch eligibility; it never silently restores queued authorization.
Pending implementation confirmation still requires a fresh user decision.

## Reset, history and delivery

Lifecycle version 3 separates active stages from historical stage IDs. Old
snapshots, artifacts, receipts and acceptances stay read-only. Active or
termination-unknown legacy work must be settled by its original owner before
cutover; do not adopt it, rewrite owner IDs or infer termination.

Upstream reset/reopen requires an explicit quiet boundary with Development.
Unopened saved private state is not automatically quiet. Reset archives upstream
discovery and does not erase canonical Design, conversation or admitted handoffs.
For an unrelated canonical project, use another workspace.

Capture a Development outcome, review it and explicitly accept its exact Design,
cycle, sources, outcome, coverage, native evidence references and verification
limits. Acceptance is recorded human attribution, not an authenticated code-owner
approval or a fabricated test pass. Export is a separate explicit operation into
`tandem-records`; preparing a delivery draft is not export.

Keep Local/GitHub selections and receipt history behind `ProcessAdapterRegistry`.
Adapter errors never authorize fallback. Publication remains explicit and never
implies a Git commit, push, merge or deployment. Legacy auto-start and verification
settings are retained history only.

## Host/runtime and validation

Use actual Node 24+. Keep one composed provider and the real joined main session.
Check the preferred provider's protocol/version/full-payload identity; an old
user provider must fail visibly, not be overridden. Package/stage the complete
Stage 2 modules, `runtime-src`, original public assets, vendors/licenses and skills.
Do not hand-edit generated `extension.mjs` or update user installations without
authorization.

The host explicitly closes the private installation before main canvas/client
shutdown. Preserve separate saved/closed/uncertain outcomes even if local saving
fails. Close view, Stop after this step, Stop now, Close runtime, workspace switch
and app exit are different actions.

Use production builders in `src\planning-prompts.ts` and the Stage 2 role JSON,
not evaluation-only prompt copies. Run root and Stage 2 checks plus the targeted
bridge/browser cases. Skipped browsers are not UI evidence; no-model native API
qualification is not a model-driven implementation journey. Live evaluations
require explicit model, case/time and credit limits.
