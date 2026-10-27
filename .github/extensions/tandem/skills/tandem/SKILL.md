---
name: tandem
description: "Optional Q&A and prototype discovery, or direct native Development for Design, implementation and Review."
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

Stage 1 is optional: **Preparation -> Requirements -> Designs -> Prototype**
collects Q&A and prototype evidence, not formal Design. Stage 2 can open directly
or later with saved Stage 1 files as explicit input. Development is PR #14's
original human-loop application, not a renamed version of the old
Design/Plan/Implement/Test factory pipeline.

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

If the user supplied no goal, let them enter it and click **Start project**, or
choose **Open Development directly** without starting Stage 1.
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
its own consent. Main Allow all and upstream Reset
must not be presented as private Development controls.

## Preparation

Preparation checks local workspace context and produces a lightweight handoff
for usage collection. Empty folders remain eligible for local inspection when
they contain only Git/Tandem metadata and the setup-only `.gitignore` rule.
Do not perform substantive domain/product research before accepted usages.
Only an unfamiliar reference essential to understanding the goal permits a
small early lookup, bounded to one authoritative source call. A named API,
repository, method or research request alone does not justify it.

The visible work items are workspace inspection, goal clarification if needed,
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
the DAG. **Generate requirements DAG** first researches missing facts relevant
to accepted usages, reusing sufficient Preparation findings. Ordinary concepts
need no external lookup; necessary research uses at most four authoritative
source calls. Unselected suggestions are not research scope. Defer pure
implementation research to Development unless it affects a requirements decision.
Progress and retained **Research and sources** belong inside Requirements, not
a new stage. Question generation and answer reconciliation use focused, tool-free
workers; the host preserves independent decisions and derives graph presentation.
Research informs choices; it never accepts answers or adds features.

Each decision has prerequisites, a clear question, three to five curated
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
Completed research retains its exact inputs, generation, request and run IDs
even if question generation fails. An unchanged retry reuses that saved record
without another research worker and preserves its original identities. Changed
inputs require fresh research. Never substitute stale or worker-invented findings;
question results must bind the exact saved research record.

## Designs

Designs uses version-2 multi-screen documents containing UI DSL v1 component
trees and design tokens, not geometric shapes. Use streamed `ui` records wrapping
one validated DSL edit, plus screen/transition metadata operations. Preserve
screen/node IDs, accepted decision references, size/zoom controls, undo/redo,
revision history and explicit approval. Do not restore shape/freehand tools.
Keep the DSL Structure tree and view selection synchronized. Select is persistent;
Interact is an explicit mode for trying controls. Selection is view state,
not edits or approval. Live-preview selections must
not become saved revision targets or appear in exported approval images.
Views describe the primary journey, not one screen per decision. Legacy geometry
files remain readable for integrity/history, but active views require explicit
regeneration as DSL; never silently convert or overwrite an old approval.

Update existing Designs incrementally after accepted requirements change.
Use `sketch_action` with `action: "update"` and the saved revision; it retains
reviewed screens and UI nodes while applying only required adjustments.
`action: "generate"` is a separate, explicit start-over choice, not a refresh.
Generation publishes page titles and navigation before a separate content pass.
If it fails, retain completed and partial pages as an incomplete preview, never
as approval. **Retry generation** resumes that checkpoint without starting over.
For an explicitly requested retry, use `sketch_action` with `action: "retry"`,
the current `expectedRevision`, `expectedGeneration`, and the failed `requestId`.
Do not substitute regeneration when the checkpoint is stale or unavailable.

Only explicit user approval of the current rendered designs creates the
approved document/image handoff. A changed requirements digest, revision or
document hash invalidates approval. Prototype workers use the exact approved
revision's DSL source and the owned image-reading tool. Per-screen `.ui.json`
files are authoritative structured inputs; PNGs are derived visual references.
Prototype, the feature specification and the Development handoff must carry
component hierarchy, typed props, tokens and transitions, not reconstruct shapes
from screenshots. Do not substitute a different design.

No-GUI efforts skip Designs and Prototype with a retained reason and feature
specification, not invented screens.

## Prototype

The prototype is a separate artifact, not the Tandem discovery UI itself. Keep
one combined **Prototype** sub-stage and optional **Visual exploration**, durable feedback
queue and explicit **Apply update** controls. New work has no product-imposed
execution-time cap; silence is not failure or permission to retry. Retain
the working displayed checkpoint if a later attempt fails.
Build layout, navigation and the primary task's mock behavior together in one
checkpoint. Do not schedule separate Structure and Interaction passes. Preserve
historical checkpoints and already-admitted workers; never infer acceptance from
browsing a saved or pending version.

**Visual exploration** is optional design exploration, not a palette-only polish
pass. Build two or three distinct working layout/style directions in the same
app, preserving the primary journey and mock contracts. Use the production
checkpoint prompt and validated `tandem-visual-directions.json` contract; do not
maintain a separate prompt or theme protocol here. Explain layout departures
from the approved designs without changing navigation or adding features.

Comparison and per-direction appearance settings are not acceptance. Scoped
feedback refines one alternative while retaining the others and the current
prototype. **Prepare this direction** creates source with the exact chosen
defaults; **Apply chosen visual direction** explicitly promotes it. Keeping the
current prototype retains alternatives and puts outstanding visual feedback
aside, not into accepted requirements. Preserve chosen defaults in subsequent
revisions and distinguish unchosen alternatives in the draft feature specification.

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

For a source-owned Node server, retain the actual `previewStart` instruction from
the production checkpoint prompt: entrypoint and working folder relative to the
checkpoint root, plus the exact arguments used. Do not guess a script or copy an
older checkpoint's port. Unsupported launch methods remain explicit rather than
silently becoming a different server. Restart reviews saved or detected startup
choices; manual server paths and line-separated arguments belong under Advanced
setup. Restart does not generate, promote or approve a prototype.

**Finish Prototype and save outputs** retains `generate-design-spec`, which
creates `draft-feature-spec` at Prototype. It is not the retired technical
Design stage. Resolve outstanding feedback, pending checkpoints and applicable
sketch approval first. An offline preview does not invalidate already recorded,
source-bound input; absent or changed required files are explicit blockers.

Finishing Prototype (or non-GUI Requirements) saves output only. It must not
start a private Stage 2 session or submit a Design request. The user can close
Stage 1 and later explicitly open Development with the saved documents/source
as ordinary file references. No Stage 1 connection has to remain alive.
Files are evidence, not authority to replace an existing used Stage 2 owner,
import canonical Design or replay an old request.

## Scoped changes before Development

Use `request_change` in Requirements, Designs or Prototype for an explicit change that may affect earlier discovery
stages. It assesses the original request against retained decisions and current
work; it does not approve or apply an upstream change. Read the saved proposal
and explain the earliest affected stage, the affected work and what is preserved.
Use `decide_change` only with the displayed request, analysis and baseline
identities and the user's actual decision. A stale proposal needs another impact
assessment, not inferred approval.

The original message, clarifications, independent answers, design revisions and
displayed prototype remain retained. Ask only new or affected decisions. A
Requirements change updates its graph incrementally; do not regenerate the whole
interview or resubmit historical work as new tasks. Approval of changed designs
and application of a prepared prototype remain explicit. Cancellation after
partial progress keeps saved changes; it is not rollback.

Impact review ends at Prototype. Development requests remain in its native
Router, Designer, implementation-confirmation and Review workflow, even with
retained Prototype evidence. Do not send them to the main session for upstream
assessment. Historical `discovery-change` results and Development-origin impact
requests are retained for inspection, not new assessment or replay.
After accepted pre-Development updates, explicit
`continue_change_development` sends the retained request to the same native
Development owner. It is not implementation confirmation. Main-session chat
still is not an implicit Tandem submission.

## Prototype handoff to Development

**Finish Prototype and save outputs** never requests Development work.
**Continue to Development** opens a read-only summary of the exact saved
specification, decisions, assumptions, deferred work and target folder.
Cancel creates no receipt or request. Only **Create Design from Prototype**
(or **Refine Design from Prototype**) confirms the reviewed binding and asks
the current host to freeze an immutable receipt and exact documents/source under the
target workspace's `.tandem\living-canvas\handoffs`. The receipt identifies the
effort, generation, completed snapshot revision/hash, artifact and asset hashes,
approved sketch, displayed checkpoint/source manifest, original shared state
root, actual target worktree, and one exact request ID/timestamp/message.
The snapshot retains confirmed, assumed and deferred decisions and mock
shortcuts without reclassifying them.

For canvas actions, present `review_prototype_handoff` before explicit user
confirmation of `continue_design` with its `reviewBinding`. Navigation is
**Open Development**, never implicit submission. Once admitted, show authoritative
request/Designer/Design/questions status instead of another submission action.
Unknown activity remains unverified; never invent progress or inject a model turn.

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

If first Development startup fails, preserve its original reason and use
**Retry runtime** inside Development, not repeated handoff sends. New setup
records the native-creation boundary durably and checks the Git root without
initializing or committing it. Older unused v2 setup may offer **Inspect unused
setup recovery**, with a separate exact-owner/ID-bound one-time confirmation.
Only the user may authorize that operation after the application verifies
complete startup-only history and authoritative absence of native state.
It must refuse prior work, native history, issued creation, foreign/live owners
and indeterminate observations. Never delete/reset WAL files or locks, invent
an absent session, or reinterpret ordinary Retry as this authorization.
Recovered Ready preserves audit and the prepared envelope; it does not submit
the handoff or authorize implementation.

## Settings, reset and history

Lifecycle version 3 separates active stages from historical stage IDs. Old
snapshots, artifacts, receipts and acceptances stay read-only. Active or
termination-unknown legacy work must be settled by its original owner before
cutover; do not adopt it, rewrite owner IDs or infer termination.

Upstream reset/reopen requires an explicit quiet boundary with Development.
Unopened saved private state is not automatically quiet. Reset archives upstream
discovery and does not erase canonical Design, conversation or admitted handoffs.
For an unrelated canonical project, use another workspace.

Project settings is the same window in every phase. Appearance, shared reasoning
effort and native Development settings retain their original owners; opening
settings does not start Development or grant consent.
Before first startup, **Save model for Development** records the user's private
model choice. Startup validates and applies that saved preference, then verifies
native readback; saving is not proof of a running model. Catalog failures or
unavailable model/effort choices never authorize a fallback.
If first startup has no saved private model, ask through Project settings before
creating the session. Saving the selection alone must not resume startup or
submit a handoff; the user explicitly continues afterward.

The obsolete acceptance, capture/export, delivery and linked-intake workflow is
retired, including `process_action`. Do not recreate or relocate those controls.
Retain historical snapshots, Local/GitHub selections, receipts, acceptances and
existing `tandem-records` exports without mutation or adapter substitution.
This is distinct from the explicit Prototype-to-Design handoff and native
implementation confirmation, which remain supported. Inspect original Design,
Conversation and results rather than manufacturing acceptance or test evidence.

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
