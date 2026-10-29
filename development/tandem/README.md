# Tandem canvas and browser runtime

This directory owns the supported Tandem extension, its human-loop runtime and
its canvas/regular-browser UI. Both surfaces use the same product and workflow.
The project discovery shim is `.github\extensions\tandem\extension.mjs`;
it imports `src\extension.mjs`. The renderer entry is `public\human-loop.html`.

The standalone server/UI under `apps/living-canvas` and the inactive Canvas
migration application have been removed, including their alternate Router,
coordinators, private SDK adapter, frontend and smoke driver. Current shared contracts, storage and permissions now live in `runtime-src`,
with Design authoring guidance in `skills`. All maintained product code, scripts
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

Project settings provides separate optional **Main session model** and
**Development model** controls. At first private creation, an explicit saved
Development override wins; otherwise the actual current main model is inherited
and verified against the private runtime. Same-ID resume retains Development's
selection, and later main changes do not synchronize it. Reasoning effort remains
native default/saved or explicitly overridden; it is not copied from main.
The status area displays each owning session's current model/effort, with
not-started, unreported and failed readback states shown honestly.
Model settings never submit project work or authorize implementation.

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

In the private Development composer, start a message with exactly one lowercase
`@designer` or `@agent`, followed by whitespace and your request, to **suggest**
a responding role. The inline guidance shows the preference; Router still
chooses from actual intent and current workflow and may choose a different role.
There is no recipient selector, persistent preference, or direct dispatch.
Assistant messages show their actual responding role, not the hint.

The mention must begin at the very first character. Emails, indented code,
quoted/backtick text, embedded mentions, `@designer:`, uppercase names and other
`@words` are ordinary text. Only a leading mention has syntax: subsequent
mentions within the request body are literal text, not additional preferences.
Consecutive supported leading mentions (including repeats or newline-separated
ones) and a hint without request text are rejected before submission, keeping
the draft and any attachment. Add request text even when attaching an image.
Select/edit/delete mention text normally; Enter, Shift+Enter, Escape and IME
keep their normal composer behavior. No popup captures those keys.

New submissions bind optional `roleHint` metadata (`human-role-hint/v1`) to the
original unmodified text, ID, timestamp and attachments. The shared private
parser validates that metadata at admission; retries cannot add, remove or
change it. Retained requests and older clients without metadata remain
unhinted, even if their text starts with `@designer` or `@agent`. Reopen never
reparses history or replays work. Question-form answers have no composer hints.
Hints grant no implementation confirmation, permissions or role authority;
all existing Stop, ownership, read-only and result gates remain unchanged.

Accepted requests that have not been picked up appear in **Queued**, immediately
above the private Development composer, not as conversation turns. Expand a row
to inspect its exact text, attachments, question answers or per-message hint.
Multiple rows keep the runtime's queue order in a bounded scroll area; they do
not cover the composer or approval controls. Unconfirmed submissions still use
the existing exact retry/draft path and are not invented as accepted queue rows.

The existing durable `admit-request` transition marks each picked-up batch member
with derived `queueAdmitted` state. Ledger replay reconstructs this fact for old
requests without rewriting history. This is runtime pickup, **not evidence of a
native model turn** or a changed dispatch policy. At pickup the request moves
once into the normal conversation. Displayed times remain the original receipt
times; no pickup/model-start timestamp is invented.

Stop, rejection or Recovery before pickup retains the request separately in
**Not started history**. Requests picked up before Stop/Recovery remain in the
conversation with their actual disposition. Reconnect reads these same durable
facts; it never re-enqueues, edits or deletes a request. Both presentations keep
the original private audit, request IDs and attachment references unchanged.

A valid current-role terminal result is durably saved and applied once without
waiting for native tools, permissions, children, turn-end, idle or quiescence.
Role/request/schema validation and actual persistence failures remain enforced.
Before a result, correlated native `session.idle` permits one same-session,
same-role continuation to submit the required result while retaining completed
work. `assistant.idle` does not trigger recovery. A second omission reports
failure; result, Stop and Close suppress further continuation.

An owned native `session.error` with `errorType: query` is different from a
missing result: it retains the current role, request, Design, approvals and
completed work, including during Review. The actual model error is saved and
shown with credential-like values redacted. Native retries and tools remain
usable. When foreground processing has stopped, **Continue** sends a short
same-task nudge into the retained private conversation; it does not replay the
task packet, repeat approvals or capture a new baseline. Continue is human-only,
bound to the current task/error, and cannot race pending native input or revive
stopped/completed work. This is not a general recovery mechanism: other errors,
uncertain acknowledgements, shutdown, ownership/storage failures and the
existing full-restart retirement contract retain their previous behavior.

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

Native `pending_messages.modified` queue hints may arrive without a persisted
event ID. They are not role input, idle or result evidence and do not settle work;
queue inspection still uses the native RPC. Session ownership and required
input/turn/tool identities remain enforced.

Private session creation and same-ID resume disable native tool search so the
controlled role tools, including terminal results, are preloaded. This avoids
deferred-discovery steering messages in the Host-owned role conversation; it
does not whitelist injected system text or relax input/permission checks.
Foreground-session tool discovery is unchanged.

The private pre-tool hook accepts SDK arguments as either decoded values or a
single JSON-serialized value; native `apply_patch` retains its raw patch grammar.
Decoding occurs before the existing role/schema
and exact-invocation checks; malformed JSON is denied. Permission callbacks and
tool handlers still validate their actual arguments and require their own grants.

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
native read-only scopes through the permission-gated `tandem_collect_review_scopes`
tool. Its native workflow schedules at most three workers concurrently, without
a total-three cap or a Tandem worker scheduler.
It first publishes scopes, then reconciles them into one report. Children cannot
delegate or publish canonical results. Partial/all-child failure and whole-parent
failure retain implementation/findings, disclose incomplete coverage and release
the attempt without mandatory successful review retry.

The foreground and private session use the same entrypoint. The private
registration exposes only the Review workflow and collector, never another
canvas or runtime. For the composed Node host, bootstrap stages an idempotent
import shim in the private session's own extension directory, enables native
extension discovery, and reattaches the exact private hook/permission
configuration after registration. Mismatched retained shims fail explicitly;
no user installation or project extension is overwritten.

Native `view`, `glob`, `rg`, `apply_patch` and PowerShell tools execute ordinary
engineering work. Read-only roles cannot patch files. Native editing requires
the selected accepted internal Implementer task. Hooks enforce ownership, role,
read-only and permission boundaries independently of result completion. Eligible
session grants survive role/child boundaries; Allow once remains once-only.
Permission cards show the selected request and its Allow once/Deny controls
before broader set/session actions. Narrow panes wrap long scopes and controls
and use bounded vertical scrolling; resizing the conversation is not required.
Historical custom-tool records remain readable, but the old custom file/shell
execution wrappers and static-preview tool are not registered.

## Stop, Close and recovery

**Stop after this step** retains graceful behavior. **Stop now** uses
`interruptMainTurn({ flushQueued: true })`, not global abort, and can escalate an
existing graceful Stop. Conversation and partial files remain; the stopped
request is retired and no successor starts automatically. Native interruption
outcomes and local recording problems are reported separately.
Concurrent requests share an in-flight Review workflow cancellation. A failed
native cancellation stays visible; a later explicit Stop may retry it, without
an automatic retry loop or reporting the first failure as success.

Close attempts native save/shutdown even during work or when local preparation,
history inspection or persistence fails. Its receipt distinguishes confirmed
save, actual native shutdown and warnings. History equivalence, an extra audit
or proof of future resumability is not a shutdown veto. Never infer saved or
closed from an unsuccessful operation.

After native shutdown, command cleanup drains local journal writes and closes
local storage before releasing its writer. It does not query the closed native
task registry or require historical shell records to appear settled. Real local
cleanup errors remain visible warnings.
`assertSettled` and `cleanCloseDigest` still reject live attached tasks when
settlement evidence is requested. Those inspections do not gate storage
`close()`, and closing storage does not invent a process exit or completion.

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
**Questions** explicitly opens a left-workspace view beside Conversation, with
one selected question and compact selectable lists, not question dropdowns.
Open questions show their titles, blocking/advisory states and selected drafts;
selecting a row only navigates to its full context. **Back to Design** restores the
retained artifact view; Design references offer **Back to Questions**.
Polling never changes this view or takes focus. Drafts survive navigation, and
the visible selection list preserves source-bound **Send selected answers**
batch semantics. The open-question list is hidden when empty. **Answered
history** starts collapsed; expand it for a compact saved-question list with
recorded answers and **Inspect full context** actions. It is labeled **Question
history** when it includes other statuses, without inferring answers or completion.
Full details retain exact submitted answers and source references.
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
