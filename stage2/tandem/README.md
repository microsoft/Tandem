# Tandem canvas and browser runtime

This directory owns the supported Tandem extension, its human-loop runtime and
its canvas/regular-browser UI. Both surfaces use the same product and workflow.
The project discovery shim is `.github\extensions\tandem\extension.mjs`;
it imports `src\extension.mjs`. The renderer entry is `public\human-loop.html`.

The standalone server/UI under `apps/living-canvas` and the inactive Canvas
migration application have been removed, including their alternate Router,
coordinators, private SDK adapter, frontend and smoke driver. Current shared contracts, storage and permissions now live in `runtime-src`,
with authoring/review guidance in `skills`. All maintained product code, scripts
and tests use this single workspace, manifest and lockfile.

## Current lifecycle

`human-loop-installation.mjs`, `human-loop-runtime.mjs`,
`human-loop-transport.mjs` and `human-loop-provider.mjs` own installation,
execution, native transport and UI projection respectively.

Controlled roles use `mode: "immediate"` and `agentMode: "interactive"` in one
retained private Interactive session. Router interprets requests; Designer
publishes canonical Design; Planner and Implementer perform authorized work;
Reviewer consolidates review. Read-only Agent requests do not require Design.
The native runtime owns scheduling, tool execution and cleanup.

New and existing repositories use this same workflow. When asked to establish
Design from existing code, Designer first explores the project read-only,
creates an evidence-backed baseline using the normal artifacts, and raises
contextual questions about current design choices, contradictions and missing
intent. Existing behavior is observed evidence, not presumed desired behavior.
Publication ends at the normal Design handoff; later answers and explicit
implementation requests follow the existing Router and work-cycle path.
Opening Tandem alone does not start a repository scan or implementation.

Every new implementation, resume or replan request pauses before Planner (and
before capturing an implementation baseline) at an inline confirmation:
**Plan and implement**, **Update Design instead**, or **Cancel**. This is
separate from command permissions. Approval covers that exact routed request
batch and Design revision, not later messages; internal tasks and Review do
not ask again. There is no timeout or automatic approval.

Question options use **Change Design - [specific effect]** and
**Change implementation - [specific effect]**. Mixed selections go to Designer
first. After publication and resolution of blocking questions, Tandem offers
implementation confirmation against the published Design. Planner and every
Implementer receive the original questions, choices and implications as
reference; they are not discarded at the Design handoff or treated as approval.

Cancel records a Host status without fabricating user text or sending a model
turn. It declines only the proposal, not the underlying idea; an already
published Design is retained. Pending confirmation survives browser reload and
same-session reopen without starting work. Stop invalidates it. Reopen still
retires interrupted approved/running work; it never replays an old approval.
Decisions are durable, duplicate clicks are idempotent, and stale/conflicting
decisions are rejected. A recovered changed Design requires a new confirmation.

The composer's **Quick requests** menu supplies editable text for understanding
an existing project, designing something new, revising or implementing Design,
and explaining Design. Selection appends to an existing draft without sending
or adding structured actions. Normal Send still goes through Router; presets
do not grant permissions or bypass workflow boundaries. Presets are disabled
during submission and while an exact request is awaiting acknowledgement.

A valid current-role terminal result is durably saved and applied once without
waiting for native tools, permissions, children, turn-end, idle or quiescence.
Role/request/schema validation and actual persistence failures remain enforced.
Before a result, correlated native `session.idle` permits one same-session,
same-role continuation to submit the required result while retaining completed
work. `assistant.idle` does not trigger recovery. A second omission reports
failure; result, Stop and Close suppress further continuation.

Both normal dispatch and the one-shot missing-result continuation explicitly use
immediate native delivery. Native enqueue can strand successor work while an
attached background app remains running. Immediate delivery does not change
Tandem's durable request ordering, grant permissions, invoke Stop or add a
completion gate; native scheduling and process lifetime remain runtime-owned.

Input correlation keeps the SDK send acknowledgement separate from the native
user-event ID, interaction and turn. The Host durably records the exact prompt
and attachment envelope before sending; absent SDK fields are never invented.
An exact owned `queued` input is valid timing evidence, not foreign origin;
steering, injected source and conflicting identities remain rejected. The SDK's
`parentAgentTaskId` is telemetry, not an input-origin or permission claim. Numeric
turn IDs are interaction-scoped. Reused or retired turns require an explicit
interaction or a matching SDK assistant tool-request ID, never chronological
`parentId` or the most recent role. This additive evidence preserves old ledger
reads and does not make acknowledgement or event bookkeeping a result gate.

The September 28 isolated native/full-E2E qualification exercised 23 role
dispatches exactly once with the same attached app through aggregate
implementation, Review and later work, plus same-ID Close/reopen/reclose.
Its `immediate-full-e2e-final/v1` receipt SHA256 is
`5a63a6c418e25b7a6aacbfcf1a257f580b99bc38c0b2978ef154f5386beec275`.
That evidence includes disclosed human terminal-focus/draft/once-consent
assistance and native generated-app corrections; local mock regressions do not
establish native behavior. Earlier enqueue-failure receipts remain historical.

Reviewer checks complete agreed-Design conformance and material over-engineering,
not a third general quality/test audit. It may review directly or use meaningful
native read-only scopes, at most three concurrently and more total in batches.
It first publishes scopes, then reconciles them into one report. Children cannot
delegate or publish canonical results. Partial/all-child failure and whole-parent
failure retain implementation/findings, disclose incomplete coverage and release
the attempt without mandatory successful review retry.

Native `view`, `glob`, `rg`, `apply_patch` and PowerShell tools execute ordinary
engineering work. Read-only roles cannot patch files. Native editing requires
the selected accepted internal Implementer task. Hooks enforce ownership, role,
read-only and permission boundaries independently of result completion. Eligible
session grants survive role/child boundaries; Allow once remains once-only.
Historical custom-tool records remain readable, but the old custom file/shell
execution wrappers and static-preview tool are not registered.

## Stop, Close and recovery

**Stop after this step** retains graceful behavior. **Stop now** uses
`interruptMainTurn({ flushQueued: true })`, not global abort, and can escalate an
existing graceful Stop. Conversation and partial files remain; the stopped
request is retired and no successor starts automatically. Native interruption
outcomes and local recording problems are reported separately.

Close attempts native save/shutdown even during work or when local preparation,
history inspection or persistence fails. Its receipt distinguishes confirmed
save, actual native shutdown and warnings. History equivalence, an extra audit
or proof of future resumability is not a shutdown veto. Never infer saved or
closed from an unsuccessful operation.

After native shutdown, command cleanup drains local journal writes and closes
local storage before releasing its writer. It does not query the closed native
task registry or require historical shell records to appear settled. Real local
cleanup errors remain visible warnings.

Cold reopening validates retained Conversation, attachments, Design and native
history, and resumes the same private identity with `continuePendingWork: false`
and `suppressResumeEvent: true`. Prior queue/tasks/questions remain historical:
they are not replayed, declared complete or new authorization. Ready permits
fresh instructions. Refocusing a live panel does not restart its runtime.

The workspace WAL and native journals retain exclusive writer ownership.
Live/unverified owners, corrupt state and incomplete frames fail visibly.
Historical native shells may retire control authority, never process lifetime,
after supported recovery. Original status/exit information remains unchanged;
stored handles cannot authorize later process adoption or termination. Historical
`tasks.list` diagnostics are bounded and best-effort, not a new work gate.

The Background disclosure counts explicitly async launches and established
sync rollover, not unfinished foreground calls. Per-process Stop uses an exact
live-owned native identity and is distinct from workflow Stop and runtime Close.

## Renderer and settings

Design artifacts use portable authoritative source and derived rendering.
Mermaid, bounded HTML/CSS and SVG retain sandboxing, source-bound annotations,
capture/upload and stale-source checks. Artifact Expand fills the current
browser document viewport, not an enclosing application's outer window.
See [supported formats](../docs/supported-artifact-formats.md).
Shared-sketch reads and the local sketch inspection surface remain supported.

Conversation and history scroll independently. The Design/Conversation divider
supports pointer and keyboard resizing without changing artifact geometry.
Assistant messages render Markdown using the same Marked-based DOM renderer as
Design documents, including tables, lists and code blocks. Conversation links
remain limited to HTTP(S) without embedded credentials; raw HTML stays inert and
Markdown images do not load remote resources. User messages and Host statuses
remain plain text, and stored conversation originals are unchanged.
Open questions reveal their answer controls without moving keyboard focus.
Answered questions retain exact submitted answers and source references.
Permissions have an explicit request selector and independent per-request
reading/decision state; presentation never grants access.

Settings retains appearance and explicit model selection. **Compact model
context...** requires a fresh approval for each explicit compaction. Native
automatic compaction remains enabled. Full visible Conversation/images/results
are retained separately from summarized model context; compaction never
authorizes replay. **Open project folder** uses Windows Explorer for the bound
workspace through a fixed executable/argument, not a model command or permission
grant. Other platforms report unsupported.

## Validate

From the repository root:

```powershell
npm --prefix tandem run build
node --check tandem\src\extension.mjs
node --test tandem\test\*.test.mjs
```

From `tandem`, `npm run test:shared` runs the shared TypeScript suite;
`npm test` runs shared tests followed by Canvas tests. `npm run test:canvas`
runs only the Canvas tests. These are
domain/browser boundary checks, not real native/model end-to-end qualification.
Only artifact dependency updates require `npm run build:artifacts`.

Provider changes require an explicitly authorized extension restart/reload to
take effect; closing a panel alone does not reload modules. Keep live work and
saved state intact. Never remove permission/tool hooks to bypass a native reload
failure. Qualify updates in a fresh isolated environment before promotion.

## Package without activation

See the [quick start](INSTALL.md) for prerequisites, installation and first use.
`tandem_open_browser` and the canvas `open_browser` action return a separately
owned local browser URL without submitting work. Closing the canvas panel does
not invalidate that URL. The browser view is not another SDK host or old web app.

```powershell
npm --prefix tandem run package:extension -- C:\staging\tandem
```

The parent of the new destination must exist. The package contains the current
discovery entrypoint, provider, renderer, referenced shared code under
`runtime-src`, skills and a versioned SHA-256 manifest. Imports are rebased for
relocation. SDK modules remain runtime-supplied. Raw-copying source would leave
checkout-relative imports and is unsupported.

Packaging does not install dependencies, activate/reload an extension or create
a session. Existing destinations, links, source overlap and invalid UTF-8 fail
explicitly. Publication reserves the destination exclusively; the manifest
follows the payload and the root entrypoint is last. This is not an atomic
directory rename. Failed outputs are retained and reported, not treated as
ready or retried in place.

## Names and retained workspaces

The product is **Tandem**; new state uses `.tandem/` and the index is `TANDEM.md`.
The extension directory and canvas ID are `tandem`; discovery lists
`project:tandem`. New portable manifests use `tandem-package/v1`.
The former `living-canvas` extension/canvas ID is not registered as an alias.
Do not load old and new copies together, including user-scoped copies: their
different discovery names do not override each other. Follow the stopped-host
installation guidance in [INSTALL.md](INSTALL.md).

Internal `.tandem/living-canvas` state paths, native runtime directories and
persisted schemas remain unchanged; this naming change does not migrate or
reset retained work. Existing `.teleos/`/`TELEOS.md` names are migrated without rewriting retained contents.
Migration rejects collisions, aliased paths and live/unverified legacy writers;
it never silently merges, overwrites, replays or repairs state.

The extension uses its owned session workspace. The removed standalone host's
`TANDEM_WORKSPACE`/`TELEOS_WORKSPACE` environment settings are not startup options.
Historical documentation, research, prototypes and frozen evidence remain
historical material, not supported alternate entrypoints.
