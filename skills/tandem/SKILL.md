---
name: tandem
description: "Turn product ideas into runnable UI wireframes, typed UI contracts, and mock-driven interaction flows. Use for rapid prototypes, proof-of-concepts, UI skeletons, and early product exploration where feedback speed matters more than production engineering."
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

Create a runnable frontend wireframe that makes the user's idea concrete enough
to evaluate through interaction. The prototype is an executable design artifact:
its typed UI contracts and mock boundary should be reusable by a later production
implementation, but production engineering is outside this skill.

## Invocation

This document is the loaded Tandem skill context. Do not invoke the `tandem` skill
tool again when this context is already present.

The end-user command is intentionally small:

```text
/tandem "Build a runnable tandem demonstration"
```

Treat all text after `/tandem` as an initial goal, not a complete
specification. Never ask the user to compose the architecture, screen list, data
model, or implementation prompt. The skill owns discovery.

On activation:

1. Complete the bounded preparation preflight below.
2. Open the `tandem` canvas, displayed as **Tandem**, using stable instance
   `tandem`. Initialize it atomically by passing `reset: true`, the initial goal,
   short stable `prototypeId`, completed `preparation`, `prototypeApproach`,
   requirements usage list, assumptions, and deferred items in the open input.
   Do not open stale state and reset it in a later action. Do not call
   `list_canvas_capabilities` unless opening fails because the declared schema has
   changed.
3. End the turn and let the user add one-sentence usage item inside Tandem.
   Persist each item immediately. A separate background hidden agent generates
   complementary suggestions that the user can add with one click; suggestion
   generation must never block adding another usage.
4. The user explicitly generates the DAG from the completed usage list. The hidden
   agent then creates the complete dependency graph and exposes its first frontier.
5. Each DAG answer is processed by the bounded hidden factory. If the user changes
   an answered node, regenerate every transitive dependent node and clear
   stale descendant answers rather than preserving static downstream decisions.
   **All as Recommended** repeatedly applies the current active recommendation,
   waiting for each dependent regeneration before applying the next recommendation.

Tandem is the lifecycle orchestration UI. It advances sequentially through
**Requirements**, **Prototype**, **Design**, **Plan**, **Implement**, and
**Test**.
Each applicable stage must be completed explicitly, which persists its JSON result
under `.tandem/<prototypeId>/stages/` before enabling the next stage. A Prototype
that is not applicable is disabled and bypassed automatically after Requirements,
with its reason and feature-spec handoff still persisted. Tandem
owns Q&A, assumptions, scope, progress, prototype revisions, evidence, and the
live output area. The website being prototyped is a separate artifact rendered
inside Tandem; never mix discovery controls into the prototype itself.

## Preparation preflight

Preparation is a short agent preflight whose durable result is visible in Tandem.
Finish it before calling `open_canvas` so Requirements opens with grounded context
and a concrete environment-readiness report.

1. Parse the goal and identify named products, repositories, methods, benchmarks,
   standards, or domain terms whose meaning affects the intended workflow.
2. In one parallel workspace batch, inspect the repository root, guidance files,
   manifests, relevant entry points, package manager, run commands, and the
   availability of runtimes or container tools required by the named workflow.
3. In one parallel source batch, inspect only the authoritative repository,
   documentation, or paper for each named external concept. Prefer direct GitHub
   repository reads and official documentation over broad synthesized web search.
   Confirm identity, inputs, outputs, integration boundary, and execution workflow.
   Use at most four source calls total and do not run both broad web search and code
   search for the same concept. When the official repository is known, read it
   directly. When it is unknown, use one discovery search, then one direct read.
   Stop after these two batches unless a failed or contradictory source requires
   one focused follow-up.
4. Build the initial intent brief from that evidence: primary actor and job, likely
   happy path, required regions or screens, core entities and states, and observable
   success result.
5. Establish a usable workspace baseline when the user explicitly asked to work in
   a named existing codebase. If the workspace is empty and the primary target
   repository is unambiguous, materialize that official source without overwriting
   user work. Restore its normal dependencies only when the documented bootstrap is
   bounded and required for discovery; otherwise record the exact missing step.
   Do not implement product behavior or start a development server during
   preparation.
6. Select one `prototypeApproach`:
   - `build` when a new GUI is needed to evaluate the primary interaction;
   - `validate-existing` when the repository already has a GUI that can be run,
     exercised, and revised directly;
   - `not-applicable` when the requested result has no GUI, such as a library,
     API, CLI, automation, or infrastructure-only change.

Use `undecided` when a named product has a GUI but the requested change does not
clearly require graphical validation. The Requirements DAG must then include one
interface-validation decision and let the hidden processor update the approach
from its answer. Never silently choose `not-applicable` in that case.

Record preparation as:

```json
{
  "status": "ready",
  "summary": "The primary source is available and required runtimes were checked.",
  "checks": [
    {
      "label": "Primary source",
      "status": "ready",
      "detail": "Official repository is materialized in the workspace."
    }
  ],
  "sources": [
    {
      "title": "Official repository",
      "url": "https://github.com/owner/repo",
      "purpose": "Primary implementation target."
    }
  ]
}
```

Use `needs-attention` when a missing runtime, credential, platform, source, or
bootstrap step will affect later execution. Preparation evidence must be persisted
in the atomic canvas open input; do not bury it only in chat or concatenate it
into `goal`.

Keep the preflight bounded to information that changes discovery or prototype
feasibility. Do not turn it into implementation planning. Open Tandem with
`needs-attention` when discovery can resolve the blocker; report it in chat instead
only when meaningful discovery cannot proceed. Target one minute for the preflight;
when a network call or setup step would exceed that budget, record it as deferred or
missing and open Tandem rather than continuing to search.

## Instructions

- Understand the actor, job, primary flow, required screens, key data, and success
  outcome before committing to a UI structure.
- Ask only questions whose answers materially change the main interaction or UI
  contract. Model them as a dependency DAG. Give every active question three
  to five curated choices, put the recommended default first, and allow custom
  text as a mutually exclusive override. Ask through Tandem, not in the
  prototype website.
- When `prototypeApproach` is `build` or `validate-existing`, produce a runnable
  first draft quickly. Do not stop at a plan, architecture description, or static
  mockup.
- Reuse an existing frontend stack and conventions. For a greenfield prototype,
  use React, TypeScript, Vite, plain CSS, and deterministic mock data.
- Keep UI code behind typed interfaces. Components must not import mock data
  directly; they consume a hook, store, or API facade backed by a mock adapter.
- Implement the main path end to end and make every primary visible control work.
- Keep the development server running with hot module replacement and iterate in
  small, visible slices.
- Keep one Tandem canvas open for the entire workflow. As soon as the
  first screen works, set its `previewUrl` so the live prototype appears in the
  Tandem output area.
- Do not implement backend logic, production integrations, tests, review
  workflows, or visual polish while this skill is active.

## Discovery budget

Infer as much as possible from the request and existing workspace before asking
the user. Build a small intent brief containing:

- primary user and job to be done;
- main entry point and happy-path sequence;
- screens or regions needed for that sequence;
- core UI entities and their important states;
- the observable result that tells the user the flow succeeded.

Capture requirements in two substages:

1. **Usage list** asks how the user wants to use the deliverable. Each item must be one
   concise sentence describing one usage. Save additions synchronously, then
   generate three to five complementary, non-duplicate suggestions asynchronously
   with latest-request-wins semantics. Users can keep adding while suggestions run.
2. **Decision DAG** is generated only after the user finishes the usage list. Ask a
   DAG question only when multiple reasonable answers would produce meaningfully
   different screens, navigation, interactions, or contracts.

Use three to five mutually distinct choices for every DAG question, put the
recommended option first, and keep free text available for an override. Use chat
or the environment's normal question tool only when Tandem canvas is
unavailable. Do not ask about colors, animation, deployment, databases, backend
frameworks, test strategy, or other matters outside prototype scope.

Represent discovery as a `decisionGraph`. Every node ID is also its question ID;
`dependencies` contains prerequisite node IDs. A node is `answered` after it has an
answer. Exactly one eligible unanswered node is `active`; every other unanswered
node is `toAnswer`. After the active node is answered, promote the next eligible
`toAnswer` node to `active`. Keep independent questions as separate nodes and give
every `toAnswer` node a complete question and choices so its contents can be
recomputed when an upstream answer changes. The Requirements tab is the question
navigator; the active node opens in the right-side inspector, answered nodes remain
editable, and `toAnswer` nodes stay disabled. Changing an answered node invalidates
all transitive descendants: regenerate
their titles, questions, choices, and dependencies, and leave their answers empty.

## Canvas feedback loop

Use one Tandem canvas as the shared requirements and output surface:

1. Complete the preparation preflight, then atomically open `tandem` with
   `reset: true`, the user's goal, preparation evidence, prototype approach,
   assumptions, deferred work, and initial usage state. Seed one to three concise
   `I want to...` usages that are explicit in a detailed goal so the user does not
   have to re-enter information already supplied; leave the list empty only when
   the goal truly contains no concrete usage.
2. Initialize the usage-list substage and wait while the user adds usages and
   accepts any useful AI suggestions.
3. After the user clicks **Generate requirements DAG**, build the complete DAG from
   all usage items and expose its first frontier.
4. The hidden processor moves each DAG answer into **Confirmed**, adjusts
   **Assumed** and **Deferred**, marks that node answered, and promotes the next
   eligible `toAnswer` node to active. When an answered node is changed, it
   regenerates every transitive dependent node before exposing the revised graph.
5. Synthesize captured knowledge into Requirements-stage Tandem artifacts such as
   user intents and interaction flows so the user can inspect the accumulated
   requirements from the Content tab.
6. When every requirements node is answered, invoke `complete_stage` for
   `requirements`. Do not create or edit a runnable interface before this. When
   `prototypeApproach.mode` is `not-applicable`, Tandem disables and bypasses
   Prototype, persists the reason, creates the non-GUI `draft-feature-spec`, and
   enables Design.
7. For `build`, create the minimum runnable prototype. For `validate-existing`,
   run and revise the repository's existing GUI instead of creating a separate
   prototype app. In either mode, add the unique preview identity marker to the
   served HTML, start the hot-reload server on an available port, and capture the
   exact URL reported by that server.
8. Confirm the exact URL responds with the current identity marker, then call
   `update_tandem` with that URL and `previewStatus: ready`; Tandem verifies
   the identity before embedding it.
9. Let the user interact with the embedded prototype and submit revision
   suggestions in the box below it. Apply clear revisions directly. If a material
   interaction detail is ambiguous, show one focused question with three to five
   options in the right pane, then continue the same revision after the answer.
10. Repeat revision, clarification, implementation, and preview validation until
    the user has no more revisions.
11. The user finishes Prototype from Tandem. Collect the requirement,
    interaction, revision, clarification, preview, and artifact evidence; generate
    the `draft-feature-spec` artifact; then advance through Design, Plan, Implement,
    and Test.
12. The **Design review** tab stays visible throughout the lifecycle, directly after
    **Live prototype**. When Design starts, automatically queue project-specific
    architecture diagrams, implementation-facing contracts, and critical decision
    records for user review. The tab is a status overview; opening an artifact moves
    its Q&A, resolution controls, and review composer into the artifact view. Mermaid
    surfaces provide zoom in, zoom out, actual-size, and fit controls. Product design
    also accepts questions and artifact requests, then synthesizes `design-spec`.
    Test design accepts coverage questions and test-scenario requests, then
    synthesizes `test-spec` plus executable integration and interaction scenarios.
13. Resolve each satisfactory answer in the active substage. Reopening an answer
    marks artifacts derived from that thread stale. Finish Product design before
    Test design; Design completes only after both specifications are current.
14. During Plan, open the **Execution plan** tab, choose the maximum agent count,
    and generate a structured implementation plan from the accepted Design
    artifacts. Review its dependency DAG, safe parallel waves, schedule, agent
    workload, file ownership, acceptance criteria, and validation steps.
15. Revise or optimize the plan until it covers the complete implementation with
    minimal dependencies and balanced parallel work. Finalize it to create the
    `execution-plan` artifact, then complete Plan.
16. During Implement, open the **Implementation** tab and start the orchestration
    run. Monitor waves, work items, agents, validation, elapsed time, and recent
    activity. Queue strategy adjustments at any time; they persist immediately and
    apply before the next wave. Retry only incomplete work after a failure. Complete
    Implement only after every work item succeeds and Tandem captures
    `final-code`.
17. During Test, open the **Tests** tab and run the approved scenarios in dependency
    waves. Monitor scenario evidence and test-agent activity. Retry only incomplete
    scenarios after a failure; complete Test only after all scenarios pass and the
    Tandem captures `test-results`.

Use a payload shaped like this for a discovery turn:

```json
{
  "prototypeId": "workflow-demo",
  "reset": true,
  "goal": "Build an app that helps my team triage customer requests.",
  "status": "Describe how you want to use this deliverable, one usage per sentence.",
  "preparation": {
    "status": "ready",
    "summary": "The workspace and authoritative product context are ready.",
    "checks": [],
    "sources": []
  },
  "prototypeApproach": {
    "mode": "build",
    "reason": "A new GUI is needed to evaluate the primary interaction."
  },
  "requirements": {
    "substage": "usage",
    "usageItems": [],
    "suggestions": []
  },
  "confirmed": [],
  "assumed": ["Desktop layout first."],
  "deferred": ["Real persistence and authorization."],
  "artifacts": [
    {
      "id": "user-intents",
      "title": "User intents",
      "kind": "intent",
      "stage": "requirements",
      "language": "markdown",
      "content": "# User intents\n\n- Triage incoming work quickly."
    },
    {
      "id": "primary-workflow",
      "title": "Primary workflow",
      "kind": "workflow-diagram",
      "stage": "requirements",
      "language": "mermaid",
      "content": "Approval moves intake work into the active queue.",
      "mermaid": "flowchart LR\n  Intake[\"Intake\"] -->|Approve| Active[\"Active\"]"
    }
  ],
  "decisionGraph": { "nodes": [] }
}
```

During usage intake, `requirements.usageItems` and `requirements.suggestions` are
authoritative and `decisionGraph.nodes` stays empty. After explicit DAG generation,
set `requirements.substage` to `dag`; `decisionGraph` becomes authoritative and
`question` is the active node. Include
the complete question and curated options on every node. Set `question` to `null`
when no node is active or while building. Update `status` and `phase` so the
Tandem shows progress without verbose chat narration. Canvas answers are owned by
Tandem's hidden processor; do not also process them in the parent agent.

Maintain one `design-tree` artifact with `kind: "design-tree"` and
`language: "mermaid"`. Use `flowchart LR` so the tree is laid out from left to
right. Its Mermaid flowchart must preserve answered branches, the active decision,
and `toAnswer` downstream decisions. Use solid green nodes for answered decisions,
solid blue for the single active decision, and amber for `toAnswer` decisions. The renderer also
builds a selectable DAG from `decisionGraph`; the artifact is the durable,
inspectable design record.

`artifacts` is the complete current list, not a patch. Preserve prior entries when
publishing an update. Every new artifact must set `stage` to `requirements`,
`prototype`, `design`, `plan`, `implement`, or `test`. Use stable IDs and a clear `kind`
such as `intent`, `feature-spec`, `architecture`, `contract`, `execution-plan`, or
`final-code`; use `test-spec` and `test-results` for the test lifecycle. Artifact
content is a concise, synthesized representation of what
the owning stage established, not a copy of source requirements. Include a
workspace-relative `path` only when the artifact corresponds to implemented code,
and refresh the artifact when its related decision or contract changes. The
Tandem groups these entries by stage in the Artifacts pane above the collapsed
Requirement Ledger. Design Review artifacts also set `sourceThreadIds` to the
review threads that produced them and `reviewStatus` to `current`. Reopening a
source thread changes dependent artifacts to `stale`; regenerated replacements
return to `current`.

Represent important user and product workflows as Mermaid artifacts using
`kind: "workflow-diagram"`, `language: "mermaid"`, and a valid `mermaid` diagram
definition. Prefer compact `flowchart LR` or `flowchart TD` diagrams whose labels
use product language. Keep a short synthesized explanation in `content`; do not
paste implementation source as the artifact body. Update diagrams whenever a
captured decision changes the represented flow.

Tandem persists project state under `.tandem` at the shared repository
root. Reuse the same `prototypeId` when returning to an existing effort; opening
without one restores the project's most recently active prototype. Do not put
session-local copies of Tandem state under the Copilot session artifact folder.

Each usage addition, DAG generation request, requirement answer, prototype
revision, or clarification starts one bounded factory run with a hidden agent.
The run receives the action, current persisted state, active question, answer,
prototype review evidence, and active worktree root, then returns the complete
requirements and prototype-review objects, ledger, decision graph, and lifecycle
state plus explicit artifact upserts and removals. The worker edits the active worktree
when the current stage permits code changes, while `.tandem` remains shared
at the repository root. Unchanged artifacts remain intact even when their factory
context was truncated. It never sends a synthetic user message to the main
session. Tandem persists processing status and the durable factory run ID so
an extension reload can reconnect to or resume an active run. When both provider
scopes are loaded, the installed user provider owns answer processing and the
project provider is read-only; a process-local claim permits only one answer per
prototype at a time. Failures restore the original question for an explicit
retry. Continuity comes from `.tandem`, not from a long-lived hidden
conversation.

The activation payload above is the `open_canvas` input, not a later
`update_tandem` action. Later updates use `update_tandem` without `reset`.

## Sequential lifecycle

Stages are gated and cannot be skipped:

The preparation preflight happens before this lifecycle begins. It has no
completion control or persisted stage result because it requires no user decision;
Requirements remains the first interactive stage.

1. **Requirements** captures at least one usage, generates the DAG, and records an
   answer for every decision-graph node. Hidden workers may update Tandem state and
   artifacts but must not edit prototype files.
2. **Prototype** follows the selected approach. `build` produces a new runnable
   preview. `validate-existing` runs and revises the repository's existing GUI.
   Keep the revision input enabled while no worker or clarification is active.
   Prototype completion is owned by Tandem button: it gathers interaction evidence
   and generates a complete `draft-feature-spec` artifact with
   `kind: "feature-spec"` before advancing. For `not-applicable`, the stage and
   Live prototype tab are disabled with the recorded reason; completing Requirements
   automatically persists a non-GUI `draft-feature-spec` and enables Design.
3. **Design** has two ordered substages in the Design Review UI. Product design
   reconciles the draft feature specification into `design-spec`, architecture,
   contracts, and other product-design artifacts. Test design converts the accepted
   design into `test-spec` and structured integration and interaction scenarios.
   Question and artifact requests are queued without blocking the composer. The
   user explicitly resolves every answer and finalizes each substage.
4. **Plan** converts the accepted design into an `execution-plan` artifact with
   implementable work items, a dependency DAG, conflict-safe parallel waves,
   relative schedule, agent-role distribution, file ownership, validation, and
   explicit scope boundaries. The user reviews and finalizes the plan in the
   Execution plan tab before completion.
5. **Implement** executes the accepted plan and records a `final-code` artifact
   with the workspace-relative path to the completed code. Tandem launches
   work-item agents in dependency waves, preserves completed work across retries,
   and applies queued user strategy adjustments at safe wave boundaries.
6. **Test** executes the approved `test-spec` scenarios in dependency waves after
   implementation. Passing scenarios are preserved across retries; failed
   prerequisites block only dependent scenarios. Successful completion records
   `test-results` with scenario summaries and evidence.

Invoke `complete_stage` only for the active stage. The action writes
`.tandem/<prototypeId>/stages/<stageId>.json`, marks the stage complete, and
enables the next one. Keep the Goal above the Stages control in Tandem, and
keep the Design tree tab before Live prototype so requirement navigation remains
the primary discovery surface.

Every `build` or `validate-existing` preview must put its normalized `prototypeId`
in the document served at the preview root:

```html
<meta name="tandem-prototype-id" content="workflow-demo">
```

Never assume the development server uses its framework's default port, and never
copy a port from an example or a previous prototype. Concurrent sessions commonly
occupy adjacent ports. Either select an available port and launch with
`--strictPort`, or parse the server's actual `Local` URL after launch. Before
publishing, fetch that exact URL and verify both HTTP success and the identity
marker. If a framework falls back from one port to another, publish the fallback
URL it actually reported.

When the verified server is ready, add:

```json
{
  "phase": "iterating",
  "previewUrl": "http://127.0.0.1:<actual-port>/",
  "previewStatus": "ready",
  "status": "Try the primary flow, then answer the next decision."
}
```

The requirement ledger belongs in Tandem, never in the product UI. Keep it
compact:

- **Confirmed**: behavior the user selected or accepted;
- **Assumed**: defaults used to keep the prototype moving;
- **Deferred**: backend, polish, or secondary-flow work intentionally excluded.

Use `get_tandem_state` after a resume or whenever the current decisions are
uncertain. Reuse the existing instance rather than opening duplicate canvases.
Open a separate browser canvas only as a fallback when Tandem cannot embed
the local preview.

## Technical foundation

Follow CopilotApp's separation between UI, typed contracts, state, and host
transport, reduced to the minimum needed by the prototype:

```text
React view
  -> feature hook or Zustand store
  -> typed API facade
  -> UI-facing port/interface
  -> deterministic mock adapter and sample data
```

For an existing application:

- preserve its framework, package manager, scripts, naming, and folder layout;
- reuse existing components and state patterns;
- avoid dependency changes unless the prototype cannot be interactive without
  them;
- do not migrate or restructure unrelated code.

For a greenfield application, use this default:

- React and TypeScript for typed, component-based UI;
- Vite for a minimal development server and fast hot reload;
- plain CSS with a few shared variables for fast global adjustments;
- component-local React state by default;
- Zustand only when state is shared across distant components or screens;
- the package manager already selected by the workspace, or npm when none exists.

Use this proportional layout; omit folders the prototype does not need:

```text
src/
  App.tsx
  main.tsx
  features/
    <feature>/
      components/
      use<Feature>.ts
  model/
    contracts.ts
  api/
    <feature>Api.ts
  host/
    PrototypePort.ts
  mocks/
    mockData.ts
    MockPrototypePort.ts
  styles/
```

The UI-facing port is the backend surface. Keep it transport-neutral and as small
as the visible workflow allows. A method-based service is enough for simple
request/response flows. For event-driven or host-integrated prototypes, use the
CopilotApp-style command/event shape:

```ts
export interface PrototypePort {
  invoke<TRequest, TResponse>(
    command: string,
    args: TRequest,
  ): Promise<TResponse>;

  listen<TPayload>(
    event: string,
    handler: (payload: TPayload) => void,
  ): Promise<() => void>;
}
```

Prefer command and event maps that constrain valid names and payloads when more
than a couple of operations exist. UI components must not know whether the port
uses mocks, HTTP, WebView messages, or in-process calls. A later implementation
should be able to replace the adapter without rewriting the views.

## UI models and contracts

Define contracts before wiring substantial UI behavior. Include only types used
at the UI boundary:

- entities and summaries rendered by the interface;
- input models for forms and user actions;
- result models returned by the mock adapter;
- discriminated view states such as loading, ready, empty, and error;
- command and event payloads for asynchronous flows;
- identifiers needed to correlate selections, updates, or streamed events.

Keep contracts independent of React and mock implementation details. Prefer
small explicit types over generic dictionaries. Use literal unions for finite UI
states. Do not model database tables, backend internals, authentication tokens,
infrastructure, or speculative future features.

Mock data must be deterministic, representative, and rich enough to exercise the
main interaction. The mock adapter may hold ephemeral in-memory state and use
short delays to expose loading feedback. It must not grow into a simulated
backend, rules engine, or persistence layer. Add loading, empty, or error
scenarios only when they help evaluate an important UI decision.

## Wireframe rules

- Optimize information hierarchy, navigation, discoverability, and feedback.
- Use simple grayscale or restrained styling, semantic HTML, native controls,
  and obvious selected, focused, disabled, loading, empty, and error states.
- Use realistic labels and sample values so the workflow can be evaluated.
- Make all primary actions interactive. Do not leave convincing-looking buttons
  inert; remove them or label them as unavailable.
- Keep layout responsive only for the viewport classes the user needs. Default
  to a practical desktop layout when no target is specified.
- Avoid design systems, icon packages, illustrations, animations, elaborate
  themes, pixel-perfect spacing, and copy polishing unless already provided by
  the workspace.
- Preserve basic usability while staying wireframe-simple: associated labels,
  keyboard-reachable controls, visible focus, and understandable status text.

## Implementation loop

1. Reuse the workspace and domain context collected during preparation; inspect
   additional files only when a settled requirement makes them relevant.
2. Settle the requirements DAG through Tandem and explicitly complete the
   requirements stage.
3. For `build`, establish the minimum runnable shell in Prototype. For
   `validate-existing`, use the existing GUI entry point. Start its hot-reload
   development server on a verified, prototype-specific URL as early as possible.
   For `not-applicable`, continue directly to Design using the generated non-GUI
   feature specification.
4. Define the UI contracts, mock port, and representative sample data.
5. Implement one complete primary interaction from entry to visible result.
6. Verify the running page's `tandem-prototype-id`, set Tandem's `previewUrl`
   to that exact URL, and fix runtime or type errors immediately.
7. Collect one focused piece of feedback in Tandem, then modify the same
   embedded prototype rather than starting another tab or design document.
8. When feedback is unclear, return one focused clarification question to the
   Tandem before editing; preserve its answer as revision evidence.
9. Repeat in small slices until the user has no more revisions, then let the
   **Finish Prototype** button generate the evidence-backed draft feature
   specification.
10. Reconcile Product and Test design, produce the execution plan in Plan, record
    final code in Implement, run the approved scenarios in Test, and complete the
    stages in sequence.

## Design review loop

The Design Review tab is the authoritative Design-stage discussion surface:

1. In Product design, accept a normal design question or an artifact request for a
   Mermaid diagram, typed contract, or decision record.
2. Persist the request immediately with `queued` status. A dedicated hidden
   factory processes queued requests serially while the composer remains enabled.
3. Show the answer and links to generated Design artifacts in the thread. The user
   marks a satisfactory answer **Resolved** or reopens it for follow-up.
4. Keep generated artifacts linked to their source threads. Reopening a resolved
   Product design thread invalidates `design-spec`, its dependent artifacts, and
   the downstream `test-spec`.
5. Enable **Finish product design** only when every Product design thread is
   resolved and no request is processing. This action creates a current
   `design-spec` and advances the same surface to Test design.
6. In Test design, accept coverage questions and test-scenario artifacts. Finalize
   only after every Test design thread is resolved; create a current `test-spec`
   and at least one structured integration or interaction scenario.
7. Enable **Finish Design** only after both specifications are current. Reopening a
   thread invalidates the final artifact for that substage and reopens its loop.

## Execution planning loop

The Execution plan tab is the authoritative Plan-stage orchestration surface:

1. Let the user choose a maximum of 1–30 implementation agents and generate the
   initial plan from current Requirements, Prototype, and Design artifacts.
2. Divide work into stable, independently implementable units. Each unit defines
   its outcome, true prerequisites, agent role, effort estimate, owned files,
   skills, acceptance criteria, and existing validation commands or checks.
3. Keep dependencies acyclic and minimal. Work that can run concurrently must not
   claim the same files. Tandem computes safe topological waves, splits ready
   work around exact file conflicts and the agent cap, and assigns reusable agent
   slots to each wave.
4. Show total effort, elapsed schedule, critical path, maximum parallelism, and
   saved serial time. Show every wave, work-item detail, agent workload, and
   coordination risk in the UI.
5. Accept natural-language revisions for scope, assignments, dependencies, or
   schedule. **Optimize parallelism** specifically asks the planner to reduce
   unnecessary dependencies, file conflicts, and workload imbalance without
   dropping scope or validation.
6. Finalization deterministically captures the displayed model as an
   `execution-plan` Markdown artifact with its Mermaid dependency DAG. Any
   regeneration marks the prior artifact stale. Enable **Finish Plan** only when
   the current plan is finalized.

## Implementation orchestration loop

The Implementation tab is the authoritative Implement-stage execution surface:

1. Start only from a finalized `execution-plan`. The orchestrator processes its
   dependency waves in order and launches every work item in a wave concurrently,
   up to the finalized agent cap.
2. Give each agent its owned files, dependencies, acceptance criteria, validation
   steps, role, and completed dependency handoffs. Agents edit the active workspace
   directly and must not create branches, commits, stashes, or pull requests.
3. Persist work-item and wave outcomes after every barrier. Failed prerequisites
   block only their dependents; independent work may continue. A retry skips
   successful items and reruns only incomplete work.
4. Show durable work-item status together with live factory phase, agent model,
   activity, active time, resource use, and progress events. Recover or resume an
   active run after provider reload without launching duplicate work.
5. Accept execution strategy suggestions without blocking the active wave.
   Persist them as `queued`, apply them before the next wave, and include the
   resulting guidance in every newly launched agent prompt. Do not interrupt
   agents already editing the current wave.
6. Allow the user to stop an active run. A later retry preserves completed work.
   When all work items succeed, synthesize a current `final-code` artifact from
   changed-file and validation evidence. Enable **Finish Implement** only then.

## Test execution loop

The Tests tab is the authoritative Test-stage execution surface:

1. Start only after Implement is complete and Test design has finalized a
   `test-spec` with executable scenarios.
2. Schedule scenarios in topological dependency waves and launch independent
   scenarios concurrently, with at most four live test agents.
3. Give each agent the scenario steps, expected outcome, validation requirements,
   and passed dependency evidence. Agents inspect and exercise the implemented
   system without changing its intended behavior.
4. Persist every scenario outcome, evidence list, agent summary, and run event.
   Failed prerequisites block only dependent scenarios. When execution fails,
   preserve detailed run, scenario, agent, event, and evidence information so the
   Tests UI can expose it through **Show error details**.
5. On retry, preserve passed scenarios and rerun only failed, blocked, or pending
   scenarios. Recover an active test run after provider reload without duplication.
6. When every scenario passes, synthesize a current `test-results` artifact and
   enable **Finish Test**.

During an applicable Prototype stage, use browser interaction as the primary
validation. Do not create test files or run test suites in prototype mode. A fast
existing type check is acceptable when it completes quickly and does not interrupt
the feedback loop.
Avoid broad builds, linters, audits, reviews, and dependency upgrades while
prototyping; Implement follows the finalized plan's explicit validation steps.

## Scope firewall

The following are outside this skill:

- backend services, endpoints, databases, migrations, queues, and server-side
  business logic;
- real authentication, authorization, billing, storage, or network integration;
- production persistence, caching, telemetry, deployment, CI, and release work;
- complex workflow engines, policy systems, permissions matrices, and exhaustive
  validation;
- unit, integration, end-to-end, snapshot, and performance tests;
- code review, self-review, security review, and broad refactoring;
- production visual design, extensive accessibility audits, localization, and
  cross-browser hardening.

When the user asks for an out-of-scope capability, define the smallest typed UI
contract for it and mock the result needed by the visible flow. State that the
real implementation is deliberately deferred. Do not hide backend logic inside
the frontend or mock adapter.

## Completion

A prototype iteration is complete when:

- it runs through the workspace's development command with hot reload;
- it is visible and interactive in Tandem output area;
- the primary flow is clickable from entry to a visible outcome;
- UI models and the external-facing contract are explicit and typed;
- components consume a mock implementation through the contract boundary;
- representative sample data and important feedback states are visible;
- no backend, tests, production polish, or heavyweight engineering workflow was
  added.

Keep the handoff short: state what is now interactive, give the development
command when it is not obvious, and name only the assumptions that still affect
the next UI decision. During iteration, process suggestions from the revision box
and ask one focused Tandem clarification only when needed. Preserve every accepted
revision and clarification as evidence. After acceptance, generate the design
specification, then complete Design, Plan, and Implement in order. The final
`complete_stage` action marks Tandem phase `complete`; do not bypass stage
completion by setting the phase directly.
