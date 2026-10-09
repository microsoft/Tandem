# Stage 1 / Stage 2 Node integration

This document describes the implemented composition of PR #14 into the Node
application. The maintained Stage 2 engine and original renderer remain here;
root `src` owns upstream discovery and the integration boundary.

## Agreed stage boundary

Stage 1 is optional. New and existing Git projects may open Development directly,
without a Stage 1 goal, lifecycle completion, prototype or handoff. Stage 1, when
used, collects Q&A, confirmed intent and prototype evidence; sketches support
that prototype. It does not author a competing formal Design. Stage 2 Designer
owns the canonical Design, and later changes stay in its conversation.

The direct-open control and Development tab only open the runtime/view. Active
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

## Integration check, 2026-10-09

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

Publishing a release, updating installed user extensions and broader UX
unification remain separate work. No export, GitHub publication or deployment
is implied by these qualification runs.
