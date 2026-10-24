# Stage 1 / Stage 2 Node integration

This document describes the merged Node application's Stage 1 / Stage 2
composition and its integration follow-up. The maintained Stage 2 engine and
original renderer remain here; root `src` owns upstream discovery and the
integration boundary.

## Current folder entry and manual-readiness composition

The October 12 entry design supersedes the older activation/picker presentation
described in historical audits below. A project folder gets one explicit starting
choice: Preparation or Development, with visible recommendations and the actual
path. `.tandem/project-entry.json` stores that choice, independent of browser,
canvas and native session IDs. Atomic writes under a folder-local lock reject
contradictory choices; invalid, unreadable, aliased or foreign-folder metadata is
reported and preserved. There is no editable mode switch or inferred default.

That choice drives setup. Preparation preserves its original valid-goal form,
requirements inputs, Designs/editor controls and Prototype feedback/Apply flow.
It needs no Stage2 renderer/provider to show its saved project history or shared
effort setting. A Development choice prepares the existing correctly owned
runtime and enables its original composer only when usable. It sends no project
prompt and does not authorize implementation. Project-open setup is deduplicated
per host, so an ordinary view reload or status poll cannot undo Close. Existing
saved Preparation-to-Development progress is retained; the independent stage
operations and their quiet/ownership fences remain authoritative.

There is no Send-to selector. Artifact browsing is distinct from active work:
Development's renderer and draft stay mounted but hidden when browsing earlier artifacts,
which are read-only unless explicitly reopened through the original guarded
operation. Before Development, the right-hand history is passive and the
established Stage1 inputs remain the only actionable workflow inputs.
The later explicit independence clarification supersedes historical unified-chat
presentation: private conversation is visible only on Development and contains
only private messages and attributable work events. Root Discovery history stays
in the earlier phases. Foreground messages are no longer copied into the private
store; legacy copies are filtered from presentation, not erased. Shared artifact
references and genuine private handoff messages remain supported.
The duplicate global Project overview/brief and standalone status paragraph are
removed; the original brief remains in Preparation without reopening it. The
remaining activity summary shows one action/state/elapsed value and latest safe
update, with details expandable and blockers prominent. Saved Prototype guidance
points to Development navigation and its existing explicit handoff; optional
closing is secondary help, not a prerequisite or manual-import instruction.
Unavailable Development disables composer, quick-request and attachment actions
without clearing existing input. Recovery/Retry and Settings Close are distinct
from runtime Close.

Discovery completion/reopen actions live in their owning phase view, not a sidebar
Discovery actions category. The shared Artifacts list retains discovery outputs
and adds references to verified Design artifacts, each cycle's current Plan,
reported implementation results and original Review records. It opens existing
native views/renderers/history with exact bindings, not copied store records.
Cold or disconnected outputs are labelled unverified; previous observations are
not presented as deleted. A selected stale binding is not silently rebound.
Completed Prototype views label saved files separately from a live preview;
checking its retained URL/identity starts neither server nor model work.

The composed Settings effort field occupies a full-width row with separately
wrapping actions. Compact conversation-only layouts reset inherited two-column
grid areas and standalone mobile height rules. These presentation adapters do
not alter standalone Stage2 or stage execution semantics.

The first frozen manual-readiness preflight (`93fa290`) exercised the production
package with a fresh Preparation folder and the completed checklist. Preparation
kept its goal form without private initialization. The used folder's Development
choice automatically reached Ready, retaining all 31 native messages and the
canonical Design. Artifact navigation preserved the unsent draft; Settings
controls had disjoint hit targets at desktop, constrained and 390px widths.
No model request was submitted.

That preflight also exposed a presentation regression: the new phase toolbar
consumed Designs' horizontal layout and Prototype's reserved preview row.
The follow-up gives these toolbars a compact top row, retains the original
full-width body, and focuses the actual implementation receipt when selected.
Startup failure handling now consumes the installation's public retry/reopen
capabilities, including a retryable `prepared` state, rather than relying only
on status names. Browser regressions cover these cases with a synthetic runtime;
they do not establish native failure recovery or remove the caveats below.

The follow-up native package (`440de43`) also passed a fresh empty-folder
Development choice: automatic Ready, no competing Preparation starter, no chooser
on refresh, zero native conversation messages and zero Stage1 factory runs.
The used checklist reopened with the same main/private owners and all 31 message
IDs/texts and the canonical Design unchanged. Its original Designs/Prototype
views, implementation-result focus and disjoint effort controls were physically
checked at 1440, 920 and 390px. Both bounded hosts were normally closed; captured
PID/creation-time identities were verified absent.

A subsequent manual report identified an older unconditional `display: none`
rule on the inline Prototype iframe. The corrected rule respects React's existing
`hidden` guard; grid sizing reserves the frame's minimum height instead of letting
it cover Feedback. The full production renderer and stylesheet extracted from
the built package are now exercised in the browser regression, with synthetic
checkpoint APIs: absent/loading frames stay hidden, the current preview has
visible geometry and accepts a physical click, a pending version preserves that
frame and its state, and only explicit Apply sends the original checkpoint-bound
API request and switches its source. The separate link says **Open current
preview** and the pending status says **New prototype version ready**. This is
renderer/checkpoint-fixture qualification, not a new native prototype-generation
run; the user's frozen prototype was neither applied nor restarted.

Saved preview availability is separate from those layout corrections. Active as
well as completed Prototype now uses the existing read-only identity probe before
attaching an unverified URL. Revisit/reconnection rechecks do not change a verified
iframe's identity or local state. Responses bind generation, displayed checkpoint,
URL and the observed pending checkpoint; stale replies cannot attach another
version. A failed probe preserves checkpoint readiness/history and feedback and
shows unavailable guidance with **Check again**, without launching processes,
promoting a pending version or dispatching model work.

The subsequently authorized **Restart preview** / **Restart pending preview**
adds a distinct, explicit process action through the owning main session's native
tool/permission pipeline. A source/owner-bound reviewed Node recipe is recorded
outside checkpoint source. Legacy setups can review an existing entrypoint in
the UI; no script is guessed. The Windows adapter uses an attached native shell
handle, exact process receipts and listener ownership checks, and checks the
original prototype/checkpoint markers before claiming readiness. Current and
pending selection stay unchanged. This is independent of checkpoint Retry,
promotion, model generation, handoff admission and the private Development store.

The consolidated usability pass also gives the working artifact priority over
secondary Discovery history: a narrower default and explicit collapse preserve
user sizing, while individual evidence entries expand progressively. Primary
phase controls use explicit contrasting tokens, Requirements badges use local
requirements state, and an unverified private Design is not described as empty.
Embedded Design overview/description disclosures keep the actual artifact visible
on short panels. New-message navigation reserves space instead of overlaying
confirmation controls, and history tooltips cannot cover Settings or dialogs.

Prototype layout now gives its tabpanel the whole workspace row and reserves the
original Feedback section at its bottom. A growing preview surface replaces the
old implicit empty grid row; short panes scroll rather than overlap controls.
Pending-output copy uses checkpoint/revision provenance: automatic milestones are
ready to inspect, while recorded feedback revisions are labelled as requested.
The explicit action names the displayed-version switch. Optional Feedback,
milestone acceptance, pending promotion and live-server availability remain
distinct; no workflow gate changed.

Native model-restoration and unused-initialization-journal caveats remain separate
known limitations. This work does not claim they are fixed, replace a private
identity, or bypass their validation/recovery paths. Frozen manual session
`57dcd2b1` remains on its original candidate until the user explicitly switches.

## Explicit empty-created setup repair

The later native blocker was independently reproduced without model turns:
creating/naming an empty native session and awaiting `sessions.save` can still
leave no persisted journal. Same-ID `resumeSession` then fails, while explicit
`createSession` using the authoritatively absent reserved ID succeeds. An empty
snapshot alone is not proof; the private ledger, complete installation WAL,
native inventories and root handoff admission are checked separately.

**Repair Development setup** is a new guarded case, not a relaxation of legacy
initial-creation recovery. It permits the inspected empty close/question-gate
release and missing-session diagnostics, but refuses used/unknown additional
state, Design, requests, prior repair/recovery, active native ownership and any
nonprepared handoff admission. A digest-bound, expiring one-use confirmation
records reinitialization before creation. The old creation/Ready/Close/failure
frames remain; owner IDs and prepared handoffs do not change. Model/effort are
read back without waking queued work. Continue/Reconcile remains a separate user
action after repair, and no model turn is fabricated to force persistence.

## Agreed stage boundary

Stage 1 is optional. New and existing Git projects may open Development directly,
without a Stage 1 goal, lifecycle completion, prototype or handoff. Stage 1, when
used, collects Q&A, confirmed intent and prototype evidence; sketches support
that prototype. It does not author a competing formal Design. Stage 2 Designer
owns the canonical Design, and later changes stay in its conversation.

The folder-entry choice prepares the selected path; artifact tabs only navigate. Active
upstream work, legacy ownership uncertainty and read-only providers remain
blocked. Opening never fabricates Stage 1 completion or sends a project request.
Ordinary Stage 2 messages may reference documents and source directly. The
optional **Continue Design from Prototype** route remains a separate, strict,
immutable receipt-backed handoff, not a general file importer.

Stage 1 and Stage 2 do not require continuous connections between them. Finishing
Stage 1 saves Q&A/prototype files and neither creates a private runtime nor
submits a Design request. The user may shut down and later start Stage 2 with
those retained files as explicitly supplied input. Initial navigation for an
unhanded completed Prototype shows saved artifacts; upstream completion does not
automatically activate Development.

This is artifact portability, not transfer of run authority. An existing used
Stage 2 installation, Design, conversation, permissions and native history keep
their exact owners and same-ID recovery rules. Ordinary file references need no
Stage 1 connection; they do not rebind an old receipt or bypass the desktop
workspace's main-session claim. The optional strict continuation binds a new,
explicit request to the current target and preserves all source checks.

## One host, one public provider, one private native session

The Node/browser launcher uses `src\desktop\runtime.ts` and `workspace.ts`.
Root `src\extension.ts` makes the single public `joinSession`/`tandem`
registration. `tandem\src\human-loop-controller.mjs` is an importable composition
controller, without entrypoint side effects. The standalone Stage 2 entrypoint
also uses it; neither nested discovery shim is activated by the composed host.

The controller passes the actual joined main session and exact registered
hook/permission callbacks to `HumanLoopInstallation`. It owns private startup,
audit, permission events, browser providers and explicit close. The Node main
permission broker remains authoritative for upstream work; its registered
extension callback uses the SDK's `no-result` abstention for that exact main
session. Private permissions never inherit that grant or the main Allow all flag.

The private stdio runtime preserves the PR's stores/WAL, roles, result authority,
native tools/consent, immediate dispatch, missing-result continuation, Stop modes,
implementation confirmation and no-replay recovery.

The composed **Project effort** control supplies one plain selected value to both
stages. Each stage independently implements validation against its own model,
native application/readback and persistence. No shared effort manager or
cross-stage preference access is used. Stage 1 owns `src\main-session-effort.ts`;
Stage 2 exposes `validateReasoningEffort`, `selectReasoningEffort` and
`reasoningEffortStatus` through its controller, backed by its own preferences
and runtime. Saving Stage 2 intent neither starts it nor reserves an identity.
Explicit opening applies/verifies the saved choice when a compatible model is
available; missing/unconfirmed models and partial application remain visible.
Busy changes are rejected, not scheduled. Model choices remain independent,
private history/confirmation/ownership rules remain intact, and the standalone
Stage 2 selector remains independently usable.

Stage 1 no longer assigns arbitrary execution-time ceilings to Preparation,
suggestions, answers, Sketch or Prototype workflows. New Prototype checkpoints
are unbounded rather than spending a cumulative 15-minute work window. Old
limits, failures and charged-time records remain readable history, never an
automatic-resume authorization or a gate on a new explicit Retry. Explicit
caller-supplied limits and bounded startup, RPC and Close observations remain
distinct. Worker completion and source verification requirements are unchanged.

Initial creation uses SDK `createSession` with the exact reserved private ID and
full configuration, records native creation, explicitly names it and saves it.
It adds no dummy turn and adopts no other session. A later naming/save failure
cannot erase the creation acknowledgement. Recovery still resumes the same ID
with `continuePendingWork: false` and `suppressResumeEvent: true`, preserving
the original missing-session and ownership checks.

The composed host uses the current stable CLI/SDK pair and explicitly supplies
its SDK to the extension. Stage 1 registers its retained coordinators through
`defineWorkflow`/`workflows` and uses `session.workflow` for native run,
progress, cancellation and same-run recovery. Existing persisted `factoryRuns`
and `factoryName` fields, coordinator names, request IDs and artifact receipts
remain unchanged; there is no factory/workflow fallback or replay conversion.

First native creation is durably fenced in installation v3 with `not-requested`,
`requested` and `created` receipts, preserving the original reserved private ID.
A read-only actual-Git-root preflight runs before new setup is persisted.
Explicit Retry can complete a durably unrequested setup after cold restart; a
missing issued/created session cannot use that path. Positive same-ID resume can
settle an issued creation's acknowledgement without creating again.

Legacy v2 `unknown` state cannot prove that no native create was attempted.
Its separately confirmed **Inspect unused setup recovery** path uses bounded,
verified complete WAL document history, permits only never-ready startup phases
and startup-only ledger diagnostics, and rejects other work/Design/approval/native
control state. Supported native metadata not-found, in-use and complete
on-disk-storage inventory responses must positively establish absence;
exceptions or malformed/indeterminate responses never count as empty history.
The existing ordinary PR history-recovery behavior is not replaced.
Old normal Stop can record `unknown -> closing -> unknown` without ever opening
the private session. Only correlated unconfirmed close intents are permitted in
this inspection; historical Ready/closed states, positive close proofs and
uncorrelated or invalid close-ID transitions remain disqualifying evidence.

The five-minute one-time confirmation binds exact owner, configuration,
installation/ledger/inventory and native-absence evidence. Confirmation rechecks
them, appends its consumption in the native creation receipt immediately before
the request, and runs the existing named creation and normal recovery transition.
It neither edits historical WAL frames nor discards the earlier
`execution-unknown` audit. Cancel, inspection, Retry and handoff reconciliation
cannot silently authorize it. Recovered Ready sends no handoff or model work;
the user must explicitly reconcile the retained handoff afterward.

The main Node launcher keeps its npm CLI loader. The composed extension supplies
its actual executing native Copilot binary to private runtime discovery when
running inside that binary. SDK/CLI/Node paths remain canonical, hashed, outside
the editable project. Actual Node 24+ is required.

## Preserved renderer

Development uses `createHumanLoopProvider({ surface: "browser" })` and the
complete original `public\human-loop.html` tree on a separate loopback origin.
Root React embeds it in a full-size, persistently mounted iframe and hides the
upstream permanent context pane. There is no React port or third permanent column.

Questions, conversation/history, artifact navigation/expansion, resizing,
annotations/snapshots, pasted images, quick requests, confirmation, settings,
compaction, native permissions, processes, both Stop modes and Close stay in the
original renderer. Opening a view sends no project request.

## Exact upstream handoff

The optional upstream lifecycle is:

```text
prepare -> requirements -> sketch -> prototype -> development
```

Direct Development navigation does not rewrite that saved upstream lifecycle or
mark any skipped stage complete. Stage 1's `draft-feature-spec` and prototype
are evidence for Designer, not an accepted canonical Design or implementation
authorization.

`generate-design-spec` still creates the upstream `draft-feature-spec`.
`beginPrototypeCompletion` and `completeLifecycleStage` retain checkpoint,
source, feedback and sketch-approval checks; no-GUI completion uses the same
saved-output boundary with its explicit skip reason. Neither completion path
invokes `continueDevelopment`; only the explicit continuation does so.

`src\development-handoff.ts` retains exact completed snapshot bytes, multi-file
source and approved assets under target-workspace
`.tandem\living-canvas\handoffs`. It records hashes, effort/generation/revision,
shared source root, actual target workspace, mock limitations and an immutable
request envelope. Credential-like files, dependency installations, browser caches
and unrelated state are not copied. Live preview URLs are not evidence.

When explicitly requested, handoffs are retained before native startup. Their exact reserved
`.tandem\living-canvas\handoffs` subtree is source-artifact storage, not legacy
Stage 2 WAL documents, even when it contains copied package/source JSON.
Legacy discovery rejects aliased directory entries before excluding that subtree;
genuine policy, installation and ledger documents elsewhere still require
verified quiescent migration. Startup never moves or rewrites an existing handoff,
and an explicit retry reuses its original request envelope.

The production prompt in `src\planning-prompts.ts` is also used by the handoff
evaluation probes. One ordinary `HumanLoopRuntime.send` request asks Router and
Designer to preserve confirmed intent, read source without executing it, publish
the normal Design and return consequential gaps. A new handoff refines canonical
Design. No direct canonical conversion/import or automatic implementation occurs.

Receipt-backed source references are injected through an optional narrow role
context provider, so native compaction does not erase provenance. Duplicate
clicks/tabs/lost responses reconcile the original timestamp/message/request ID.
Existing ledger state, including `retired`, is authoritative; recovery cannot
authorize redelivery. Opening an upgraded completed Prototype requires explicit
continuation. Missing legacy source identity is a visible blocker.

## Mutation, migration and historical authority

`src\development-transition.ts` serializes upstream reset/reopen and explicit
request admission for the target workspace. Generation/snapshot ownership is
rechecked before send. The shared fence is acquired before the runtime's local
admission queue, preventing mixed composer/handoff lock inversion. It is not a
normal role-settlement or execution-certification gate.

Lifecycle version 3 uses a separate historical parser. Legacy outputs move to
read-only history with their original lifecycle retained; acceptances/receipts
retain their IDs and hashes. Old Plan/Test records cannot authorize a native
cycle. Active or termination-unconfirmed legacy work blocks cutover until its
original owner settles it. Shared-state scanning distinguishes actual worktree
owners instead of treating unrelated worktrees as one runtime.

Unopened saved private ownership is not assumed quiet. Reset/reopen must first
recover and explicitly settle or close it. Upstream reset archives the effort
under `.tandem\effort-history`; admitted handoffs and project-bound Stage 2 state
stay independent. A new upstream handoff refines the same project; unrelated
canonical projects require separate workspaces.

The old Design/test-review queues, Plan finalization, implementation/test wave
execution, four downstream factory registrations, worker prompts, panels,
routes, update fields and recovery callbacks are removed. Stale HTTP paths return
`410 stage_retired`; removed schema fields cannot dispatch. Shared fingerprint,
acceptance, scheduling data and upstream prompt helpers remain where still used.

## Outcome projection and explicit publication

`src\development-delivery.ts` captures an exact read-only Design/cycle/source
projection, native command evidence references, outcomes, coverage and limits.
Readiness, Review completion, empty findings and role statements are not test
passes. Source/Design drift requires a new capture before acceptance/publication.

Capture and human acceptance do not start work. Export into `tandem-records` is
separate and explicit; preparing a draft does not export. Local/GitHub adapters
and historical receipts remain behind `ProcessAdapterRegistry`; errors do not
fall back and export is not Git publication.

## Payload and shutdown

Root build/pack scripts include the entire Stage 2 package graph, renderer,
vendors/licenses and skills with a composed payload manifest. Staging verifies
hashes and reacts to asset-only changes. Relative `import.meta.url` resources
remain relocatable. Root `package.json` owns the release version.

The Node host checks the preferred provider before use; incompatible user/project
providers fail rather than being overwritten or bypassed. Root `/api/state`
remains the health contract. Private readiness is `/api/snapshot`.

App Stop, Ctrl+C and workspace switch invoke private close before main
canvas/client shutdown, within coordinated 30 + 8 second grace periods. View
close alone is not native close. Saving/closing uncertainty remains explicit;
unrelated processes and installed providers are never used as cleanup targets.

## Qualification boundaries

Use root `check`, `test`, `build`, Stage 2 build/shared/canvas suites, bridge tests
and genuinely executed browser cases. Isolated native no-model probes can
qualify startup, APIs, ownership, same-ID cold recovery and shutdown. Relocated
npx tests must exercise the actual complete payload, not source-local imports
in place of packaged modules.

No-model compatibility is not evidence of a model-driven Router/Designer,
implementation or agreed-journey success. Those live evaluations require explicit
model and execution/credit limits. Report baseline failures, new failures and
browser skips separately; do not fabricate successful verification.

The current stable CLI can discard the native journal of a session closed before
its first user input, even after explicit name/save (and a non-ephemeral host
log). Such a missing previously created identity remains a visible recovery
failure; Tandem does not silently replace it or broaden unused-setup authority.
Used-session same-ID recovery is separately qualified and must not be presented
as proof that this zero-input upstream limitation is resolved.
Completing Stage 1 no longer creates an unused private session just to preserve
a connection to Stage 2. This avoids that unnecessary exposure, but does not
repair journal loss for an explicitly opened, unused Stage 2 session or relax
main-session ownership/recovery.

## Earlier Design-only integration check, 2026-10-09

The agreed boundary is the clarified one above: optional Stage 1 supplies Q&A
and prototype evidence, not formal Design. The older proposal's Stage 1 Design
wording is superseded; restoring that stage is not remaining work.

| Requirement | Current evidence | Remaining qualification |
| --- | --- | --- |
| Direct Stage 2 entry for new/existing projects | Renderer/server regressions and actual no-model opens preserve empty upstream history and submit no request. | Unused-session cold persistence limitation above. |
| Stage 1 finishes independently; Stage 2 may start later from files | Both completion paths and initial/stage-change navigation have regression coverage. A fresh native Node host and real Edge showed retained synthetic Stage 1 artifacts without private startup; explicit Development navigation then reached Ready with unchanged input files and zero requests. | Upstream Q&A was a synthetic fixture, not a live Stage 1 journey. Existing used Stage 2 ownership is not transferred; unused native journal loss remains separate. |
| One foreground owner and separate private runtime | Actual private collector registration has no Tandem canvas or foreground tools; duplicate opens share one view. | No second engine or provider migration is planned. |
| Prototype evidence reaches Designer without implementation | Immutable source/asset tests pass; bounded native Router/Designer runs accepted the retained synthetic no-GUI handoff and published Design. | A fresh real Stage 1 Q&A-to-HTML/assets-to-Designer journey has not been run on this build. |
| Later Design changes remain in Stage 2 | A native explicit revision published a new Design while retaining prior decisions, source references and an unanswered semantics question. | No cross-stage rollback is required. |
| Exact ownership, Stop, Close and no replay | Used-session native Stop/Close and cold reopens preserve both IDs, Design, conversation and historical events with no new model request. | Do not generalize this result to zero-input sessions. |
| Explicit implementation confirmation and read-only Review | Existing runtime/state-machine tests retain confirmation, cancellation, producing-Design binding and parent-only results. | Full current-build Planner/Implementer/Reviewer execution is outside the Design-only qualification. |
| Optional private reasoning effort | Settings/cold-reopen tests and native no-model selection verify advertised effort, actual readback and retained pending intent. | No implicit model or effort substitution is allowed. |
| Native scoped Review workflow | Scoped collector, concurrent cancellation, explicit Stop retry and late-child tests pass; real no-model bootstrap and workflow lifecycle events are verified. | Live multiworker Review against an implemented project remains unqualified on this integration. |

The integration root suite passed 853 tests. The full Stage 2 run separately recorded
211 shared tests passing and 1,022 canvas tests with 1,015 passes, five failures
and two skips. Three failures passed isolated timing rechecks. The remaining
retired-native-Close expectation and standalone Sketch debugger failure
reproduced on the unchanged merged-main source. Follow-up investigation resolved
both test defects: settlement inspection, not storage Close, must reject a live
native task; the debugger fixture omitted the shared Markdown/navigation modules
and returned HTTP 404 before its script could initialize. Revised coverage
retains strict settlement/ownership checks and every browser validation,
source-preservation and static-only request assertion.

The follow-up passed 89 native retirement/shell/writer tests, 13 runtime/transport
Close and terminal-result tests, and all five debugger tests in real Edge with
both missing dependencies returning HTTP 200. Both exact original failing
selectors also passed three consecutive isolated runs. These are targeted
follow-up results, not a claim that the full Stage 2 suite was rerun or that a
generated application passed end-to-end.

The independent-stage follow-up passed 134 completion, handoff, ownership,
prototype and renderer regressions, plus 74 neighboring navigation, artifact and
effort-lifecycle tests, root type checks and root/Stage 2 builds. The native
no-model probe used production completion on synthetic
no-GUI Q&A, closed that fixture provider, and then used the supported fresh
Node launcher with no previous native main/private identity. Real Edge opened
the retained artifact view without a private installation; an explicit
Development tab selection created the new private session without a request,
handoff, Design or implementation confirmation. Saved file hashes were unchanged,
normal Close succeeded, and both loopback endpoints and the owned browser were
closed. This does not claim a used desktop identity was replaced or cold-resumed,
or that Designer actually read the files without a submitted model request.
Separate used-state regression rejects a different main owner while preserving
the exact WAL, retained handoff and history. Historical full-suite totals above
remain unchanged.

## Live full-framework tracker qualification, 2026-10-09

The later authorized evaluation used one tracker project, GPT-6 Astra with Low
reasoning effort, at most three concurrent native Review workers, at most two
post-handoff application correction cycles and no overall execution timeout.
No application correction cycle was needed. The application was written and
corrected by the product's native workers; the qualification harness did not
edit its source or force role/state transitions.

This was a deliberately staged candidate journey, not one uninterrupted run on
one build. Real Preparation, fourteen confirmed Q&A decisions and four approved
screens ran on the earlier notification-fixed candidate. The initial failed
Prototype, its source and its 300-second timeout remain retained. After normal
owner closure, `c269e4d` qualified the cap-free explicit Prototype Retry and
single effort control. The later private Design/implementation/Review and
used-session lifecycle journey ran on frozen source
`5eeb02346dcb8fbfa761789d43a880afd58b7e2c`, with composed payload digest
`c332327f409ff912facc50a5ac68898028a95943777a7227871edbda97a46a1a`.
Release version remained 1.1.15; CLI/SDK remained 1.0.94/1.0.18. Earlier frozen
candidates, including the original `8316fe4` evidence, were not overwritten.

| Journey | Observed result | Boundary |
| --- | --- | --- |
| Live Stage 1 | Preparation, accepted Q&A, approved designs, Structure, Interaction and draft feature specification completed. Physical Apply update published Interaction. | The prior Preparation/Prototype failures remain failures, not erased retries. |
| No arbitrary execution cap | The new native run's declared and approved limits both omitted timeout; Structure completed beyond the former 300 seconds. Historical Prototype accounting reached 1555/900 without gating new work. | Explicit limits and bounded startup/RPC/Close observations remain separate. |
| Independent Stage 1 completion | `prototype-r109.json` and prior stage snapshots were saved; Development remained uninitialized. The main host and preview processes actually exited before later Stage 2 entry. | No automatic private creation, handoff importer or replacement identity was used. |
| One effort choice, independent implementations | A physical project-control Low selection applied to the actual owning main session and retained unopened private intent. Explicit private model selection later applied the same Low through Stage 2's own implementation. Both real readbacks and every observed worker configuration/inference reported Astra/Low. | Model choices remain independent; an absent model leaves intent pending, never a substituted default. |
| Formal Design from saved files | A new private conversation read explicit snapshots, designs and all named mock-source files, then published canonical Design. | Stage 1 mock behavior was not promoted to implementation or test evidence. |
| Implementation and whole-plan Review | Separate request and physical Design-bound confirmation preceded Planner. Five implementation tasks, aggregate validation and three substantive native read-only Review scopes completed. Parent consolidation reported no supported material conformance/over-engineering findings. | Review explicitly distinguished source coverage from runtime acceptance. No broad permission grants were used. |
| Independent final-app acceptance | Physical mouse/keyboard/file-selection cases covered CRUD, dates, combined filters/counts, named deletion, actual downloads, invalid/cancelled/confirmed imports, recovery bytes, network failures, two-browser stale writes/imports, reload and 390px layout. A separate full application test invocation passed 48, with zero failures/skips, including real Edge. | These are generated-app results, not a rerun of the historical Tandem suites above. |
| Real Stop with pending native consent | A separate no-code verification request reached three live Review workers. Physical Stop now cancelled their native workflow and all three workers; pending native permissions ended denied with parent-authorization-ended feedback. Cards disappeared and no late Review was published. | A new post-Stop question completed under a distinct request; stopped work was not resumed. |
| Used same-ID cold reopen | Actual private Close and main-process exit preceded recovery of both original IDs. All four prior requests, all sixteen then-visible messages and complete Design were retained exactly; no new native user/turn/worker/usage event occurred before new input. Both actual effort readbacks remained Low. | No application server restarted automatically, and this does not qualify unused-session journal persistence. |
| Explicit post-cold application restart | A new confirmed operational request verified the old writer absent, removed only its hash-fenced stale lock, restarted the unchanged app in an attached native shell and checked the exact retained dataset hash. Independent physical browser readback confirmed three projects, two tasks and the calendar date after real process restart. | Stale-lock recovery was explicit operational repair, not automatic clean restart or an application-code correction. |
| Final cleanup | Normal private and main closure completed. All 24 final captured PID/creation identities exited, all final host/private/app endpoints became unreachable, and all four independent acceptance-browser instances closed. Cleanup preserved the post-acceptance app source/data and saved Stage 1 input hashes. | A retained stale application lock is evidence of native process termination; it was not silently deleted to make cleanup appear cleaner. |

Focused source checks during this follow-up were reported separately: 128
execution-policy checks; 49 consent-lifetime host/browser checks plus replay of
21 actual native envelopes; 58 root activity/parser checks and three Stage 2
prompt checks; 40 root and 28 private effort/settings checks; seven targeted
native-catalog correction checks; and eight terminal-duration checks. Type
checks and complete frozen browser builds passed. Actual fresh and cold root
provider bootstrap also received capability consent without a model turn or
callback-before-event deadlock. These counts are not an aggregate full-suite run.

The live run found that session-scoped `model.list` exposes
`capabilities.supports.reasoning_effort`, unlike the normalized client catalog
used independently by Stage 2. It also exposed a completed-request timer that
kept ticking; the terminal-duration fix uses authoritative completion time while
freshness continues to age. Failed prework/candidate observations were retained.

Remaining limitations are explicit:

- An ordinary main resume without launcher model configuration returned no
  actual model. The readback gate stopped model work and showed pending Low
  intent; a separately authorized explicit Astra model selection then allowed
  the production saved-effort implementation to apply Low. This is not proof of
  automatic main-model restoration, and no global settings/default was changed.
- Windows native Close terminated the attached app process but left its own
  exclusive lock. The app's documented, positively fenced manual stale-lock
  recovery was exercised before restarting; tracker data was never reset.
- The earlier Requirements defaults-button no-op required an owned view reload.
  Its cause remains unresolved; the later real confirmation does not erase that
  observation. Harness consent delays/denials and pre-click UI reconciliation
  also remain separately recorded, not relabeled as product passes.
- The unused zero-input private-journal limitation above remains open.
  Exhaustive screen-reader/keyboard auditing, measured contrast and full native
  browser zoom are not claimed. Root-font scaling alone is insufficient proof
  of full-page 200% zoom.

Receipts are retained under `full-framework-e2e\evidence\`:
`stage1-saved-output-hashes.json`, `native-unbounded-run-limits.json`,
`shared-effort-both-real-sessions-applied-before-goal.json`,
`whole-plan-native-review-complete.json`, `review-stop-native-outcomes.json`,
`used-same-id-cold-reopen-no-replay.json`, `post-cold-new-work-complete.json` and
`final-owned-cleanup.json`. Independent physical receipts are
`physical-initial\receipt.json`, `physical-faults\receipt.json` and
`physical-cold-readback\receipt.json`; the independent application suite output is
`independent-final-app-tests.txt`. Application JSON export was exercised, not
Tandem accepted-record export or Git publication.

## Stale tracker lock correction, 2026-10-10

The user requested an actual fix for the generated tracker's restart failure.
This follow-up supersedes the routine manual-lock-removal limitation above for
the corrected tracker; it does not rewrite the original qualification receipts.
It used the first of the two authorized application correction cycles, through
the same private native session, a narrowly revised locking Design and the real
implementation confirmation. No generated application source was edited by the
harness. No Tandem runtime code change, SDK upgrade or shutdown redesign was
needed.

The root cause was the application's ownership protocol: `openStore` exclusively
created a durable lock, but only cooperative JavaScript shutdown unlinked it.
Windows native child-process termination can bypass that cleanup. Tandem's
supported SDK shutdown did terminate its owned processes; the application then
treated every retained lock as permanent exclusion, including a proven dead
owner.

The corrected application's `src\locking.js` now puts ordinary acquisition and
release behind one exclusive short-lived `tracker.lock.guard`. Startup inspects
a valid legacy `{pid,token}` record and accepts only the operating system's
positive `ESRCH` result as absence. A live or reused PID, malformed record,
unreadable file or failed/invalid query remains blocked. It rechecks lock and
guard identity/content under exclusion before removing the stale lock and
acquiring a new lock normally. All corrected startup paths participate,
including initially absent locks, so concurrent recoverers cannot delete another
participating starter's replacement. Release also checks its exact ownership.
No age-based takeover, process killing or data repair is used.

This is guarded cleanup on explicit startup, not unconditional deletion.
Interrupted/partially written guards and guard-cleanup failure remain explicit,
fail-closed exceptional states. The protocol assumes participating application
versions; concurrent old versions and arbitrary external filesystem mutation
are not supported. These limitations do not require manual cleanup after the
ordinary native Close path that was reproduced and fixed.

Validation used the preserved tracker data and separate isolated test stores:

| Check | Actual result |
| --- | --- |
| Focused independent regression | 36 locking/storage tests passed, zero failures/skips. Includes live/reused-owner rejection, malformed/error reads, changed lock/guard, concurrent fresh starters/recoverers, interrupted guards, and actual Windows force-termination followed by four competing startup processes with only one winner. |
| Native workflow verification | The correction's recorded full regression run reported 64 passes, zero failures/skips. Direct whole-plan read-only Review found no supported material findings; this is distinct from the independent focused test run. |
| Actual Windows Close | Physical Tandem Close and main-host exit terminated the corrected attached app and left its PID 29716 lock intact with no guard. The data hash remained unchanged. |
| Ordinary restart, no manual cleanup | Independent `node server.mjs --port 0` recovered that exact untouched lock and served the retained data. A subsequent ordinary restart also recovered the next terminated owner's lock. No harness unlink/rename/repair was issued. |
| Live-writer protection | Real competing startups before and after the Close/restart boundary exited unsuccessfully, leaving the live writer's lock and tracker data unchanged; the original server stayed responsive. |
| Data and cleanup | Real browser readback retained all three projects, two tasks, calendar dates, reload and 390px behavior. Tracker SHA-256 remained `fd411fb479ca8d8715e8f53d043ea446711f2b155d341b7b544c92565759f0e9`; saved Stage 1 inputs and unrelated app source were unchanged. All final native, ordinary-launcher and browser owners exited. A final dead-owner lock remains recoverable by ordinary startup; it was not deleted to manufacture a clean result. |

The optional native-model-driven restart request encountered automatic context
compaction before command dispatch. It was explicitly retired with supported
Stop/Close so the remaining independent process-level check needed no model
turn or alternate SDK owner. This was not an execution timeout or lock failure.
The first independent startup succeeded but its later harness helper could not
resolve `tsx` from the artifact directory; that failed harness receipt was
preserved. Reusing the existing dependency installation from the correct harness
working directory completed live-writer and browser checks without app changes.

Correction source is retained in `full-framework-e2e\locking-correction-source\`
with exact hashes in `manifest.json`: the locking helper, store integration,
focused locking tests, the existing test-name correction and README. Native
implementation request: `caa5feae-4216-450b-ae9c-9bc79393200a`; revised Design:
`99aed0f5-6b1a-45da-9d8c-c2e2ce24a611`. The frozen Tandem runtime remained
`5eeb023`; this is a generated-application correction, not a new Tandem runtime
release. Evidence under `full-framework-e2e`:

- `locking-fix-independent-tests.txt`
- `evidence\stale-lock-correction-review-complete.json`
- `evidence\locking-before-native-close.json`
- `evidence\locking-actual-native-close.json`
- `evidence\locking-actual-close-ordinary-restart-proof.json` (successful startup, later harness dependency-resolution failure)
- `evidence\locking-ordinary-restart-final-proof.json`
- `evidence\locking-after-native-close.json`
- `physical-locking-native-close\receipt.json`
- `evidence\locking-final-cleanup.json`

The unrelated defaults-button observation, absent main-model resume behavior,
unused-private-journal limitation and earlier accessibility/zoom qualifications
remain unchanged. Nothing was pushed, deployed or installed.

Publishing a release, updating installed user extensions and broader UX
unification remain separate work. No export, GitHub publication or deployment
is implied by these qualification runs.

### October 10: artifact-centered project workspace

The subsequently approved UX direction is implemented in the source, separately
from the locking correction: one project navigation, selected artifacts/current
work and one persistent visible project conversation. Design expands the same
embedded renderer rather than opening another window or mounting another
conversation/editor. Project settings are opened from the root navigation;
standalone Stage 2 retains its own complete shell.

`POST /api/development/view` opens only the presentation provider. It does not
initialize/resume a private runtime or submit anything. Activation, retry and
reopen remain explicit. An origin/source/channel-bound presentation bridge
projects saved discovery evidence and dispatches explicit discovery actions
through their existing public APIs. Native messages, questions, confirmations,
permissions, Stop, Close, Design annotations and attachments keep their original
Stage 2 renderer and interfaces. No messages are replayed or copied to a private
session, and no cross-stage private-store writes or shared effort implementation
were added. Drafts and send target survive artifact navigation; activation does
not silently retarget a nonempty draft.

Current qualification is deterministic/no-model, not another tracker-generation
or live native E2E. `tests/project-workspace-browser.test.mjs` loads the production
React framework and actual Stage 2 provider/renderer together in Edge, using an
explicitly synthetic runtime. Hit-tested interactions cover discovery submission,
native message routing, questions, exact permission denial, implementation
confirmation cancellation, Stop, Settings with managed effort, Close/reopen
without replay and 1360/980/390-width navigation. The original handoff layout
regression also covers keyboard focus, resizing and the existing browser host's
900-pixel minimum application viewport. Standalone settings regressions are
unchanged and pass independently. Temporary providers and browser profiles close
after each test.

Cold private history still requires explicit verification/reopen; a passive view
does not reconstruct an unopened private journal. Discovery evidence in the
combined display is a source-labelled saved-state projection, not a claim to
recover previously unrecorded conversation. The earlier defaults-button and
main-model-resume qualifications remain. No installed runtime was hot-edited;
no release, push, deployment or global installation was performed.

The evidence directory is
`C:\Users\liqli\.copilot\session-state\296ea712-d081-4cdd-ae37-114a0ab0af6e\files\unified-project-ui`.
It contains `check.txt`, `build.txt`, `focused-tests.txt` (11 passing),
`navigation-regressions.txt` (58 passing), `standalone-final.txt` (3 passing),
and `project-workspace-{1360,980,390}.png`. Mobile checks assert the actual CSS
viewport width and hit-test the retained composer, rather than counting a scaled
desktop page as narrow-layout evidence. The matching build is retained under
`frozen-candidate`; it is a local qualification artifact, not an installed release.

The subsequent fresh native checklist run found two presentation defects before
Requirements editing: the narrow command-bar stylesheet hid the Send-to selector,
and the relocated effort popover covered its own summary. Native Preparation
completed and its files were saved before normal host shutdown. The narrow fix
keeps the target selector visible, places shared effort contents in navigation
flow so its summary remains reachable, and labels a passive new private runtime
as not activated. Browser regression coverage now physically hits the selector
and opens/closes effort settings rather than only inspecting their DOM values.
Failure receipts are under the session's `files\unified-checklist-e2e\evidence`
(`effort-popover-hit-failure.json/.png`, command `b6500c20-4b07-4609-9a6c-004f1b1d57cd`);
`routing-effort-fix-tests.txt` is supplementary no-model coverage. The fresh
native journey is still in progress; this is not a full-function E2E pass.

The defaults pointer no-op was subsequently reproduced from the captured real
Requirements snapshot. Moving focus from a radio inside the answer form to the
sibling defaults button collapsed the answer textarea by 42 pixels between
mouse-down and mouse-up. The latter hit the inspector instead of the button.
The question card now retains expanded composer height while any of its controls
has focus. `tests/requirements-pointer.test.ts` verifies trusted pointer-down
and pointer-up hit the same stationary button and open the real confirmation.
This fixes mouse activation, not the separate failed-launch receipt that blocked
the first native defaults submission.

Rapid usage clicks now save every accepted usage immediately but coalesce
suggestion refreshes behind one native suggestion run. After that run settles,
only the latest saved usage list is dispatched. Superseded live runs retain exact
cancellation/terminal receipts; unknown cancellation blocks another suggestion
launch. This addresses the observed four-active-workflow pressure without raising
native limits or introducing a general scheduler. It does not erase or reinterpret
the earlier orphan launch receipt.

The user explicitly approved a guarded product recovery action for this orphan,
not manual state repair or a fabricated rejection. The action binds the decision
to its original request, generation, revision and current main-session/workspace
owner; preserves the null ID and terminal=false fields; and records a separate
`abandoned-uncertain` outcome with two current native observations. Complete
workflow inventories, idle/non-abortable activity, empty input queues, no local
factory promises and an event guard through persistence are required. Missing,
active or changing evidence blocks. Stage2 is only checked through its existing
public quiet boundary, never mutated. Duplicate decisions are idempotent and old
request IDs cannot be replayed. The real checklist recovery remains to be
qualified on a newly frozen candidate after the completed native Close.

User-directed naming follow-up: the top-level navigation entry is
**Development**, encompassing formal Design, planning, implementation and Review.
The formal artifact and internal views remain **Design**. This changes visible
labels and accessible names only; stage/runtime/storage identities and passive
browsing semantics are unchanged.

At the native Stage1-close boundary, evidence inspection found mutable projection
rows still displaying their initial `running` text and a completed design
instruction absent from the shared timeline. Saved-evidence rows now refresh
independently of immutable native messages. Stage1 now records accepted design
instructions with their original request/time/base-revision identity before
dispatch and preserves them through success/failure. No earlier missing text is
backfilled from E2E receipts or native-session history. The existing checklist's
missing historical design instruction remains an explicit coverage limitation;
new-request persistence is supplemented by focused lifecycle tests.

The native implementation run also exposed a stale root status: the saved
handoff message still said implementation was not authorized while the current
private request was approved and executing. The root now displays the active
Development status from its public presentation projection, without rewriting
the original discovery/handoff record. This source fix is qualified separately
and only becomes live with the next safe candidate refresh.

User-directed navigation hierarchy follow-up moves **Saved artifacts** out of
the workflow navigation and into the existing **Artifacts** section. Its selected
state, count, existing view and output list remain shared; there is no second
library or runtime/history change. Focused keyboard and real-browser navigation
coverage retains the same conversation iframe and unsent draft.

The user-directed effort consolidation places the sole editable project-wide
effort selector inside Project settings and removes its navigation disclosure.
The embedded renderer exchanges only plain settings values/actions with the
root's existing public project-effort endpoint. Per-stage validation, application,
readback and persistence remain independently owned. Partial failure and pending
private intent stay visible; opening Settings or saving intent cannot activate
Development. Standalone Stage2 keeps its original independent effort control.

### October 10: bounded embedded shell consistency

The framework palette and density tokens now have one stylesheet source,
`tandem/public/project-theme.css`, imported by both the root bundle and the
embedded presentation. Embedded-only adapters align artifact headings,
navigation selection, toolbars, Settings and controls; authored artifact
contents and standalone styling remain separate. Saved appearance values are
projected to the root through the existing bound presentation channel, not a
second preferences writer.

Both artifact/conversation splitters use the root's actual conversation width.
User resizing carries between discovery and Development, including rapid
navigation immediately after input. Below the root's desktop breakpoint the
embedded contents stack and remain scrollable. Navigation resizing reserves
both content panes' minimum widths. These are presentation messages only:
activation, requests, questions, consent and implementation confirmation retain
their existing interfaces and identities.

Fourteen focused tests cover the complete browser surface, shared effort,
cross-view keyboard resizing, populated Design, light/dark palettes, Settings
Close/Escape, draft/target retention, narrow scrolling, and the defaults pointer
regression. Five additional focused checks cover shared token contracts and
standalone Settings/splitter behavior. These browser journeys use synthetic
runtime fixtures, not native completion evidence. Type checking and the complete
browser build pass; fresh frozen-package/native-project qualification is tracked
separately.

The retained checklist implementation is still interrupted after backend work:
the private session reported a native query error, HTTP 400 internal server
error. Normal Close completed, and all 22 captured owned process identities
were absent afterward. The failed request and partial files remain intact.
This UI pass neither retries that request nor completes the outstanding browser,
aggregate or native Review work. Contextual forms, the native history rail and
some repeated status/header structure remain intentionally outside this bounded
visual pass; this is not a complete design-system rewrite.

The first frozen `66af4ec` package failed actual root inspection: its stylesheet
still contained a relative source-tree `@import`. The production injection used
esbuild's single-file transform, whereas the browser fixture bundled imports.
Missing tokens made the root's primary buttons and header transparent, with
19.5px controls. That package is explicitly **not UI-qualified**. The owner
closed it normally without continuing native implementation.

The production stylesheet now bundles imports and watches their actual inputs.
The whole-workspace browser test can read the stylesheet module directly from
the generated extension, without executing extension startup. Run after
`npm run build:browser` with `TANDEM_PACKAGED_EXTENSION` pointing to
`dist/browser/extension.mjs`. This mode rejects unresolved imports and checks
opaque root primary/header backgrounds, at least 4.5:1 text contrast and proper
control geometry in light/dark themes, in addition to the ordinary interactions.
It fails against the retained defective package and passes against the rebuilt
artifact. This is packaged-CSS/browser evidence with a synthetic runtime; actual
same-project native qualification remains separately recorded.

The fresh `33f854a` frozen candidate was then exercised on the retained checklist
through its root workspace. Actual primary buttons were opaque
`rgb(53,91,196)` with white text and 30px height; the header was opaque in both
light and dark themes. Physical Settings Close and narrow-screen Escape returned
focus to Project settings. The sole shared selector reported actual
`gpt-6-astra` / `low` independently for both stages. An unsent test draft and its
Development target survived artifact navigation and a 520px-to-544px conversation
resize. Populated whole-root screenshots cover desktop light/dark and 980px/390px
layouts. Test appearance and draft were restored through the UI afterward.

Normal same-ID private verification retained the exact canonical Design revision
`f1400870-a00c-4669-af3d-6cc74ea02142` and digest
`62d06bafa03c1ca25ed82cc7ab314f4b9f0fb64c1f2ae57e34aa6b168200b555`.
The interrupted implementation request remained visible as retired, with no
active request/task and no automatic replay. Evidence is indexed in the session's
`unified-checklist-e2e/coverage.json`, including `corrected-native-retained-history`,
`corrected-populated-design-*`, `corrected-populated-conversation-390` and
`packaged-root-chrome-corrected`. This qualifies the bounded presentation slice,
not the unfinished generated application or native Review.

A subsequent real-root review at the 180px sidebar exposed horizontal clipping
of `Development` beside its `Available` badge. The narrow follow-up gives
project navigation labels and status badges separate wrapping grid rows and
removes the sidebar list's horizontal-scroll behavior. It preserves status text,
selection and keyboard focus; no Discovery actions or artifact hierarchy changes
are included. The whole-root regression checks Available, New output and Update
ready text at desktop, the actual 180px sidebar and mobile widths. The live
native candidate is not hot-edited; visibility waits for the next safe refresh.

### October 10: completed recovered checklist qualification

The sidebar fix was safely loaded as frozen `84966e8`. The real 180px sidebar
reported a 136px contents area and 136px scroll width with the complete
Development label and Available badge visible. Its wider/mobile and alternate
badge states have separate packaged-browser regression coverage. No unapproved
Discovery-actions removal or Development-artifact restructuring was included.

The first native scoped Review did not qualify. Its exact timeline distinguishes
two failures: `browser-design` encountered a native query HTTP400 after about
91 seconds; `persistence-api` waited 1,743.85 seconds on three read permissions
that **our E2E runner failed to service**. The external collector call timed out
after 1,800 seconds; subsequent parent retirement cancelled the remaining worker
and denied its pending reads. Read-only native workflow records confirm the
failed/cancelled outcomes. This was not 30 minutes of model inference, a successful
Review, or proof that timeout itself stopped child work. Normal Close and exact
process-identity checks settled all owned work. No timeout was raised.

A direct review-only message then routed to Agent without a cycle and correctly
could not use the Reviewer-only collector. That limitation is retained. The
existing, separately confirmed **read-only verification work cycle** was used
instead; no routing/ownership gate was weakened. The full-app scoped Review
workflow `f289c5a9-0d8a-41d9-9ea0-ddffc46455e2` completed both scopes on attempt 1
with actual GPT-6 Astra/Low worker readbacks. A narrow request/worker/file-hash
bound responder issued only current allow-once file-read decisions through the
root UI; unmatched searches stopped it for manual inspection. Its initial
dependency-directory error is retained, as are all decisions and stop records.
It stopped when the exact Review ended. No broad grants or scope retries were
used.

That substantive Review found one generated-app conformance issue: Escape
cancelled editing only from the name field, not Save/Cancel/recovery controls.
Physical Tab-to-Save/Escape reproduced it. The implementation choice was sent
through the real Review question and physically confirmed as request
`c13a8d74-f7db-4655-a509-c99f8637929b`. The native correction reused cancellation
and discard behavior, retained the in-flight-save guard, and added focused
event/browser regressions. The subsequent native correction Review reported no
substantiated remaining conformance or over-engineering finding. This used
**one of two** authorized post-handoff correction cycles; no generated source
was manually patched.

Independent execution passed **15 focused app tests**. Physical browser
acceptance covered add/edit, blank validation, 201-code-point rejection and
200-code-point acceptance, duplicates, both completion directions, counted
filters, exact named deletion Cancel/confirm and focus, 390px layout, corrected
Escape from Save and Retry, reload, a real server outage, actual Windows
read-only-file save failure, unchanged failed-write bytes and repaired Retry.
Plain process restart from a different working directory retained JSON data.
Simulated pending/lost-response tests remain labelled as such.

A distinct read-only native request was stopped while its exact file consent was
pending. Immediate Stop retired that consent and request; a separate subsequent
request completed without resuming it. Final cold same-ID verification preserved
all **31 native message IDs/texts**, the original canonical Design and main/private
Astra/Low readbacks, with no active request or replay. The saved Prototype hash
remained `e7c1940cbf6ebf2c5d8a8ebcd9def53a9438edc72bd36f1934604a6174bbc13b`.
Final app data retained three items and SHA-256
`9c786fa26b3518ac363d4fa4f7ffeb727ed45b4aff2a7ce56d1c7f3631f16e33`.

All owned test runtimes were closed and their captured PID/creation identities
and loopback listeners checked absent. The final browser-close helper did not
confirm exit within its own wait; the original warning is retained alongside
the subsequent exact absence check, not rewritten as clean shutdown.

The session's `unified-checklist-e2e/coverage.json` is the observed coverage
matrix, with original failures separate from corrected outcomes.
`evidence/final-qualification-summary.json`, `native-review-full-timeline.json`,
`native-scoped-review-completed.json`, `escape-correction-reviewed.json`,
`independent-final-app-tests.txt`, `final-cold-reopen-native.json` and
`final-owned-cleanup.json` index the decisive receipts. Populated root and app
screenshots include `navigation-wrap-live-180`, `native-review-two-scopes-root`,
`physical-checklist-desktop`, `physical-checklist-narrow`,
`physical-readonly-save-failure` and `final-cold-reopen-root`.
External services/auth/deployment, destructive reset of the retained journey,
screen-reader/full-accessibility qualification, actual full-disk/power-loss and
multi-server behavior were not exercised. This is a completed **recovered**
local journey, not an uninterrupted happy path or blanket all-functions pass.
