# Stage 1 / Stage 2 Node integration

This document describes the merged Node application's Stage 1 / Stage 2
composition and its integration follow-up. The maintained Stage 2 engine and
original renderer remain here; root `src` owns upstream discovery and the
integration boundary.

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
| Live Stage 1 | Preparation, accepted Q&A, approved drawings, Structure, Interaction and draft feature specification completed. Physical Apply update published Interaction. | The prior Preparation/Prototype failures remain failures, not erased retries. |
| No arbitrary execution cap | The new native run's declared and approved limits both omitted timeout; Structure completed beyond the former 300 seconds. Historical Prototype accounting reached 1555/900 without gating new work. | Explicit limits and bounded startup/RPC/Close observations remain separate. |
| Independent Stage 1 completion | `prototype-r109.json` and prior stage snapshots were saved; Development remained uninitialized. The main host and preview processes actually exited before later Stage 2 entry. | No automatic private creation, handoff importer or replacement identity was used. |
| One effort choice, independent implementations | A physical project-control Low selection applied to the actual owning main session and retained unopened private intent. Explicit private model selection later applied the same Low through Stage 2's own implementation. Both real readbacks and every observed worker configuration/inference reported Astra/Low. | Model choices remain independent; an absent model leaves intent pending, never a substituted default. |
| Formal Design from saved files | A new private conversation read explicit snapshots, drawings and all named mock-source files, then published canonical Design. | Stage 1 mock behavior was not promoted to implementation or test evidence. |
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
