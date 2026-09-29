# Stage 1 / Stage 2 Node integration

This document describes the implemented composition of PR #14 into the Node
application. The maintained Stage 2 engine and original renderer remain here;
root `src` owns upstream discovery and the integration boundary.

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

For the qualified Node/CLI combination, composition uses supported native
`sessions.open` with the exact new private ID/name, saves it, and attaches the
original configuration with `continuePendingWork: false` and
`suppressResumeEvent: true`. This avoids an empty `createSession` identity being
discarded before its first user turn. It adds no dummy turn and adopts no other
session. Recovery still uses the original missing-session and ownership checks.

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

The active lifecycle is:

```text
prepare -> requirements -> sketch -> prototype -> development
```

`generate-design-spec` still creates the upstream `draft-feature-spec`.
`beginPrototypeCompletion` and `completeLifecycleStage` retain checkpoint,
source, feedback and sketch-approval checks; no-GUI completion uses the same
handoff boundary with its explicit skip reason.

`src\development-handoff.ts` retains exact completed snapshot bytes, multi-file
source and approved assets under target-workspace
`.tandem\living-canvas\handoffs`. It records hashes, effort/generation/revision,
shared source root, actual target workspace, mock limitations and an immutable
request envelope. Credential-like files, dependency installations, browser caches
and unrelated state are not copied. Live preview URLs are not evidence.

Handoffs are retained before native startup. Their exact reserved
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
