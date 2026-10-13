# Tandem

Tandem can open **Development directly** for a new or existing Git project.
Optional Stage 1 collects Q&A, confirmed intent and prototype evidence through
**Preparation -> Requirements -> Sketch -> Prototype**. It does not own formal
Design. Stage 2 Development owns canonical Design, confirmed implementation and
Review, using its original Design/Conversation UI and native role workflow.
The former Design, Plan, Implement and Test stage engine is retired.

## Standalone Node/browser app

Use actual **Node 24+**, Git, and a Copilot account with the required model access.
The browser launcher needs neither .NET nor a running Copilot desktop app.
Windows and PowerShell are the currently qualified Stage 2 environment. Other
platforms are not qualified merely because the outer browser launcher supports them.

```powershell
npm ci
npm run build:browser
node .\dist\browser\cli.mjs login
npm run browser -- --workspace C:\projects\my-app
```

Omit `--workspace` to use the current folder. `--no-open` prints a private launch
URL instead of opening a browser. **Do not share that URL.** The host and both
application surfaces bind only to `127.0.0.1`.

Open folder, page reload, diagnostics, and Stop remain host controls. Closing a
tab leaves the backend running. **Stop**, **Ctrl+C**, and workspace switching
attempt private Development shutdown before closing the main session. Native
save, native close, and uncertain local persistence are separate outcomes; inspect
Diagnostics after a failure. The host allows 30 seconds for private close and
another 8 seconds for main-client shutdown, within its owned-process deadline.
It never terminates unrelated processes.

The Node runtime still lives under `src\desktop` for compatibility with the
Windows host. Those modules are Node code, not a .NET dependency.

### Permissions and ownership

The main Node session owns Preparation through Prototype. Its native permission
broker starts in **Ask each time**. Main-session Allow all does **not** approve
Development operations. Development owns a separate real Interactive session,
with the PR's private permission broker, once-only consent and native enforcement.
Its model, compaction, permissions, Stop and Close controls remain independently
owned, inside the persistent project conversation and Project settings.
Main permission, Reset, speech and extension-reload controls are scoped or disabled
while the private runtime is active, not merely while browsing Design.

One composed public `tandem` provider owns both surfaces. The Node host retains
user > project > session preference when those providers are present. It checks
the selected provider's protocol, version and complete payload digest. An older
preferred installation produces an explicit conflict; the host does not silently
bypass it or overwrite a user installation.

Main-session chat is not a Development request. On first opening a project folder,
choose **Start with Preparation** or **Go to Development**. The choice is saved
once in that folder's `.tandem/project-entry.json`; it is not a browser preference
or a runtime/session identity. Development selection prepares its owned runtime
without a project prompt or implementation authorization. Reopening uses the saved
choice and progress; refreshing an already-open page does not repeat initialization.
Browsing artifacts does not start work, and Close is not undone by a render/poll.
Foreign ownership or invalid metadata fails visibly without rebinding or resetting.

### Local npx package

```powershell
npm run pack:browser
npx --yes --package ".\dist\tandem-standalone-<version>.tgz" tandem --workspace C:\projects\my-app
```

The tarball contains the host, composed extension, complete Stage 2 module tree,
`runtime-src`, original renderer, offline vendors/licenses, skills and hash
manifests. Keep the entire package together. Session staging checks all manifest
entries; an asset-only change invalidates the cache.

The main Node process uses the pinned npm CLI loader. When running inside the
native Copilot extension process, the composition explicitly uses that exact
executing native Copilot binary for the private stdio connection, rather than
asking the embedded executable to run a JavaScript npm loader.

The reproducible Node package uses the current stable CLI 1.0.94 and SDK 1.0.18.
The host explicitly supplies that SDK to extension processes, preserving native
`isTerminal` declarations rather than relying on a different bundled serializer.
Retained Stage 1 coordinators use the public Dynamic Workflows API. Existing
`factoryRuns` and `factoryName` receipt fields remain unchanged on disk; their
names are historical, not an alternate legacy execution path.

Creating a tarball does not publish it. Root `package.json` is the release-version
authority. Before an authorized release, bump with
`npm version patch --no-git-tag-version` (or the intended increment), run
`npm run pack`, and rebuild the browser package. Source implementation alone
does not require a release bump or installation update.

## Workflow

The first-open cards show the actual folder and visible guidance:
**Preparation** is for an empty project or help clarifying requirements and UX;
**Development** accepts existing files, an initial implementation, or just a rough
idea. Neither choice is inferred from files. There is no editable mode switch.
Preparation retains its original goal form and requires a valid goal before
goal-dependent work. Development prepares automatically after selection and enables
its conversation only when ready. Startup consent, model validation, recovery and
implementation confirmation remain explicit. Preparation can progress normally
into Development using saved outputs; choosing a starting path never erases history.

Preparation inspects the workspace and necessary authoritative sources, then
offers optional first-person usages. Generic goals in an empty workspace do not
require external research. Requirements collects accepted usages and a
dependency-aware decision graph; recommendations are not answers until selected.
Whole-graph defaults require explicit confirmation and one bounded reconciliation.
Failed or conflicting answers remain visible, not silently accepted.

Sketch retains its editable screen drawings, revision history, explicit approval
and approved image assets. Next-action guidance opens request history and focuses
a failed revision's Retry control without resubmitting it or replacing an unsent
instruction. Prototype keeps the existing staged structure,
interaction, optional visual refinement, queued feedback and Apply update flow.
`build` produces a mock UI; `validate-existing` works from the existing GUI's
copied source; `not-applicable` preserves a reason and feature specification
without fabricating a graphical prototype.

### Finish Stage 1; open Development when ready

Stage 1 workers honor the owning native session's explicitly selected reasoning
effort. If unset, they keep their existing per-worker low/medium defaults.
Failure to read that selection is an error, not permission to substitute a default.
Stage 1 workflow results are consumed by the extension with native completion
notifications disabled. Success or failure updates Tandem's UI and receipts;
it must not independently wake a foreground model turn.
New Stage 1 workflows have no product-imposed execution-time cap. The former
240/120/300-second limits and cumulative 15-minute Prototype gate are retired,
including worker instructions to stop at those deadlines. Existing failed runs,
checkpoint limits and charged-time records remain historical evidence; only an
explicit new Retry creates unbounded work. No history is reset and no old run
is automatically resumed. Explicit caller-supplied limits, native concurrency,
permission checks and bounded startup/RPC/shutdown observations are unchanged.
The read-only Development status endpoint includes `mainSessionModel`, the
owning SDK's current model/effort snapshot; reading it starts no work.
Programmatic browser hosts can explicitly pass
`startBackend({ ..., modelSelection: { model, reasoningEffort } })`; the packaged
native host accepts the corresponding `--model` and `--reasoning-effort` options.
They are validated against the native model catalog and forwarded to SDK
creation/resume, with actual readback checked before opening the canvas.
Omitting them preserves native defaults and saved main-session selection.
This does not configure or overwrite the separate private Development session.
If native main-session resume reports no model, an explicit saved project effort
remains pending until a supported model is selected through that launcher path;
Tandem does not invent a model or silently replace native defaults.

Use **Project effort** inside **Project settings** for one explicit reasoning-effort
choice across both stages. Models remain independently selected. Root
`MainSessionEffort` owns Stage 1 validation, SDK application/readback and
`.tandem\desktop\reasoning-effort.json`; Development's controller/runtime and
preferences own the equivalent Stage 2 implementation. Integration passes only
the selected value through their explicit interfaces, not shared effort logic
or access to the other stage's preference files.
Saving a choice before Development opens retains intent without creating a
private identity or starting work. On explicit open, select a compatible private
model if none is verified. Settings shows both actual readbacks and pending/error
states; **Refresh status** rereads them without starting work. Busy or unsupported
changes are rejected. A partial application is visible and is not rolled back
silently or retried automatically. Saved explicit choices survive ordinary
reopen; unresolved private model intent must still be reconciled, and workflow
history is never replaced. With no shared choice, existing defaults are unchanged.
Standalone Stage 2 retains its own editable effort selector and needs no Stage 1.

The native host also retires a pending tool-consent card when its exact native
worker is cancelled or its native permission request has already completed.
Correlation uses the owning session and exact native request envelope, request,
tool, agent and available workflow identities. A stale card cannot grant
once-only or session-wide approval; unrelated workers and ordinary completion
keep their existing consent behavior.
Stage 1's activity view uses native workflow/worker/tool/permission observations
and their original timestamps. It shows operation, elapsed request time, pending
consent and the age of the last native activity; polling is not productive work.
Terminal request elapsed time uses the recorded completion timestamp and stops
increasing. Activity/update age still advances; an unavailable terminal timestamp
is shown as unavailable, not replaced by server uptime or the current clock.
Unavailable or silent activity is reported honestly and never triggers automatic
failure, retry or cancellation. Short public model updates are requested at
meaningful milestones. Reasoning and raw prompts are not projected, and progress
is never completion or verification evidence. Native commentary stays separate
from final structured output and drawing NDJSON; untagged prose is not guessed
away to make an invalid result pass.
Explicitly tagged drawing data still streams immediately. If native message
phase is absent or arrives later, text is buffered until message classification
or the authoritative result instead of guessing whether prose is progress.

The existing `generate-design-spec` action is retained: it creates
`draft-feature-spec` in Prototype, not a downstream technical Design stage.
Completion checks the displayed checkpoint, source fingerprint, applicable sketch
approval and outstanding feedback. A URL alone is not source evidence. An offline
preview does not invalidate a retained, source-bound checkpoint.

**Finish Prototype and save outputs** (or **Finish Requirements and save
outputs** for a non-GUI project) saves Stage 1 evidence without opening a private
Stage 2 session or submitting a Design request. Completion keeps the current
upstream view; reopening completed Stage 1 without a handoff shows its saved
artifacts. You may shut down at this point.

Later, open Development explicitly and reference the saved Q&A, snapshot,
approved drawings or prototype source files in a normal message. Stage 1's
connection need not survive: these files are input/evidence, not permission to
adopt a previous Stage 2 run, its canonical Design or session authority. Existing
used Stage 2 work still requires its original owner and same-ID recovery; this
does not bypass the desktop workspace's main-session ownership rules.

Alternatively, **Continue Design from Prototype** explicitly asks the current
host to retain an immutable bounded handoff under the **target worktree's**
`.tandem\living-canvas\handoffs`. It includes exact completed snapshot bytes,
artifact hashes, confirmed/assumed/deferred decisions, approved drawings/assets,
mock shortcuts and the displayed multi-file source. Dependency installations,
browser/runtime caches, credential-like files and unrelated operational state
are excluded. Missing, changed or aliased input fails explicitly.

Stage 1's shared state root and the actual target worktree are recorded
separately. Stage 2 implements in the real target workspace, not in the shared
snapshot directory. Original inputs are preserved.

For that optional strict route, one exact request ID, timestamp and message are persisted **before** admission.
Duplicate clicks, tabs and lost acknowledgements reconcile that envelope.
Recovery retirement is never permission to deliver it again. Reopening an
already-completed Prototype or legacy downstream effort offers an explicit
continuation; opening the app alone does not send it. A legacy preview without
an exact source identity must be revisited before continuation.

The ordinary request goes through `HumanLoopRuntime.send`, Router and Designer.
Designer reads the supplied documents/source without running prototype scripts,
then publishes through the existing Stage 2 design tools. A later handoff refines
the current canonical Design rather than replacing the project.

**Design publication returns control to the user.** Implementation needs a
separate request and the PR's exact human confirmation before Planner/baseline
capture. Cancelling confirmation sends no model turn. Implementer runs the agreed
checks and journeys; Reviewer is read-only Design-conformance and over-engineering
review. There is no independent final Test stage. Readiness, Review completion,
empty findings and worker statements are not evidence that tests passed.

### Development UI

The framework header uses Tandem's existing bicycle wordmark, shared with the
standalone artwork. The build embeds it locally; displaying the logo needs no
external asset request.

Settings has a labelled **Close** button at its top-right. Close or Escape only
dismisses the panel and returns focus to Project settings (or the standalone
Settings trigger); it does not save, apply, discard, stop work or close the runtime.
**Close runtime** remains a separate action under Diagnostics.

The main framework is one project workspace: project navigation and Settings
on the left and the selected phase's own workspace and history.
Requirements, drawings and Prototype retain their specialized inputs and controls.
The **Development** navigation entry contains formal Design, planning,
implementation and Review; it is not an additional Stage1 Design phase.
**Saved artifacts** is the cross-project library entry in the separate
**Artifacts** section, alongside the saved outputs, rather than another workflow entry.
The same list groups verified Development Design, cycle plans, reported
implementation results and Review records. Each opens its original native
viewer/work view or history entry, with its original binding; revisions are not
copied into the discovery store or counted again. Unverified cold outputs are
labelled as unverified, not empty or deleted.
Artifact groups start collapsed with their labels and counts visible. Group
choices persist through polling and new output arrivals; a collapsed group marks
new output without reopening itself. Current selection remains marked on its
group, and the shared Saved artifacts entry stays directly accessible.
Browsing does not require starting both engines. Development work and pending
questions, confirmations and permissions remain bound to the private session;
return to Development to interact with them.
New advisory questions explicitly explain their unanswered continuation: keep
the producing Design unchanged. Recommended option text is not a default, and
silence never records an answer, accepts a Design change or approves implementation.
If no safe no-change continuation exists, the question must be blocking. Older
questions retain their original records; missing or stale continuations require
clarification before dependent new work rather than fabricated defaults.
New Design output and a Prototype update awaiting Apply are marked in navigation.

The original discovery phase forms remain independently owned. Finish/Reopen
controls live in their owning phase view, not a sidebar Discovery actions category.
Secondary history starts compact in constrained panels and can collapse to a
small keyboard-accessible rail; reopening restores its prior sizing. Already
approved, unchanged drawings show one Finish action rather than another primary
approval. Development keeps Design and conversation side by side where they fit,
and an empty/unverified Design does not reserve a large blank pane on narrow screens.
The original brief is readable in Preparation, not duplicated in a global Project
overview. Sidebar progress shows one action/state and latest public update;
worker details and freshness diagnostics expand under Details. Permission
requests, errors and unknown outcomes remain prominent. Successful Prototype
completion directs to Development; closing and returning later is optional.
Before Development, root-owned saved-evidence history needs no Stage2 renderer or
private session. Project settings keeps the shared effort control usable there.
After Development begins, its complete renderer owns its document, controls and isolated
loopback origin. One iframe stays mounted hidden across earlier-phase navigation; selecting Development
expands its existing Design pane alongside its existing conversation. This also
keeps annotations and unsent attachments with their original composer, rather
than creating a second editor. Standalone Stage 2 retains its full shell.

Embedded Development uses the framework's shared color and control tokens.
Saved appearance settings apply to the whole project surface. Resizing the
artifact/conversation split carries across artifact navigation; constrained
windows stack the contents without replacing the conversation or its draft.
Source diagrams and documents retain their own authored styling.
Navigation labels remain fully visible in constrained sidebars; output-status
badges occupy a second line rather than requiring horizontal scrolling.

Development conversation is visible **only on Development**. Earlier phases use
their original inputs and root-owned Discovery history; the private renderer stays
mounted but hidden so its draft and attachments survive navigation. Private
conversation contains only Stage2's own messages and attributable events, not
foreground/main chat or copied Discovery evidence. Previously stored parent
copies are excluded from display without deleting the original journal.
Unverified private history is labelled unavailable, never replaced by parent
history. Genuine privately admitted handoff messages still reference saved inputs.

There is no **Send to** selector. Established discovery inputs use their original
public actions; Development uses its original conversation/request interface.
Earlier artifacts remain read-only during Development unless explicitly reopened
through the existing guarded operation. Navigation never retargets a draft.
Unavailable Development disables its composer, quick requests and attachment
actions without clearing existing input. Saved discovery evidence is a source-labelled,
render-only projection, not reconstructed native chat; it is never copied into a
private request or written into its store. Cold private history still requires
owned runtime verification during project entry; browsing alone does not reopen it.
Active and completed Prototype views distinguish saved checkpoint readiness from
a running server. Viewing the phase, reconnecting, or **Check again** verifies the
current generation/checkpoint/URL before attaching an unverified inline preview.
Unavailable servers show an explanation instead of a browser connection error;
saved versions, pending updates and feedback are unchanged. Verification never
starts a server or model work, and successful rechecks keep the current frame's
local state when its verified identity has not changed.
During Prototype work, the runnable current version appears inline above Feedback.
**Open current preview** opens that same version in a separate window.
An automatic milestone is labelled **Interaction prototype ready to inspect** (or
its actual milestone); **Show Interaction prototype** explicitly switches the
displayed checkpoint. Requested-revision wording appears only for a checkpoint
linked to a recorded feedback revision. Feedback is optional; readiness is not a
claim that the user submitted feedback or that the saved preview server is live.
The phase-owned Feedback section stays at the bottom of the Prototype pane, with
the inline preview using the remaining space above and pane scrolling when needed.
Successful preview checks and verbose version summaries stay collapsed in Details;
unavailable versions and their targeted Restart actions remain prominent. The
normal current-plus-pending view preserves a useful preview and initially reachable
Feedback at 920x620, including an expanded feedback draft.
Neither preview link nor iframe switches to a pending version without the explicit
checkpoint-promotion action; its existing validation and Finish gates are unchanged.

If a saved preview server has stopped, **Restart preview** targets only the
displayed checkpoint; **Restart pending preview** targets only the waiting version.
Neither action generates code, applies an update, changes feedback or opens
Development. A previously reviewed live server is reused rather than duplicated.
For legacy checkpoints without a launch record, the UI asks you to review an
existing Node entrypoint (and any arguments), then confirm the exact executable,
checkpoint directory and saved URL. It never guesses an npm script or substitutes
a static server. The current restart adapter supports the Windows Node host;
unsupported stacks/platforms fail explicitly.

Launch records bind the original main owner and accepted source fingerprint.
The native shell permission prompt remains authoritative. After approval, the
packaged launcher rechecks source/executable identity and port availability,
starts an attached session-owned process, and records its exact launch/PID.
Ready requires both owned listener evidence and matching prototype/checkpoint
markers. Changed source, foreign listeners, rejected consent and startup failure
remain visible. Closing the owning host stops its own launches; no unrelated
server is terminated. A failed or uncertain attempt can be inspected/reconciled,
not silently replaced with another command.
Saved-evidence rows refresh when their source changes; native conversation records
remain immutable. New drawing requests retain their exact accepted instruction,
request ID, time and base revision in Stage1's own state, including failed requests.
Older drawing instruction text that was never persisted is not reconstructed.
Question answers and implementation decisions retain their original bound forms.
If a discovery result is delayed, **Check submission** reads the same in-memory
receipt without repeating the action. After a lost presentation session, inspect
saved state before submitting again.

The original artifact views, questions, conversation/history, keyboard resizing,
annotation snapshots, pasted images, quick requests, implementation confirmation,
model/appearance settings, compaction, permissions, process controls, Stop after
this step, Stop now and Close remain Stage 2 controls. Closing a view is not the
same as closing its native runtime.

## State, migration and recovery

An unconfirmed Stage1 launch with no native run ID can block later work even
after its visible operation ended. **Recover interrupted discovery** offers an
explicit, request/owner/revision-bound abandonment decision. It preserves the
original null run ID and unknown terminal outcome, adds an
`abandoned-uncertain` recovery record, and retains Requirements and saved files.
It is not a claim that the launch failed, succeeded or never executed.
Recovery requires two consistent, complete native workflow inventories,
idle/non-abortable native activity, no queued or in-flight input, no local pending
factory work and no native events during the guarded write. Active, resumable,
unavailable or changing native evidence keeps recovery blocked. No workers are
cancelled and nothing is replayed; continuing requires a new explicit action.

Operational data is ignored `.tandem` data, not Git publication:

- Shared upstream efforts and snapshots: `.tandem\efforts\<effortId>`.
- Archived upstream resets: `.tandem\effort-history\<effortId>\<archiveId>`.
- Project-bound Stage 2 installation, WAL, canonical Design and ledger:
  `.tandem\living-canvas`.
- Immutable admitted source handoffs: `.tandem\living-canvas\handoffs`.
- Node/Windows main-session identity and workspace lock: `.tandem\desktop`.

Lifecycle version 3 has five active stages and a separate historical-stage
parser. Old snapshots, artifacts, acceptances, receipts, code and original
identities remain read-only evidence; they do not become Stage 2 authorization.
Active or termination-unconfirmed legacy work blocks cutover until its original
owner settles it. Work owned by a different worktree is not silently adopted.

Reset/reopen use a shared upstream-mutation/request-admission boundary, not a
second role scheduler. They recheck private readiness under that boundary.
Unopened saved Development ownership must be recovered and explicitly settled or
closed before changing upstream discovery. Reset archives upstream files; it
does not erase canonical Design, conversation or admitted handoffs. Use a different
workspace for an unrelated canonical project.

The private runtime retains the PR's same-ID recovery, terminal-result authority,
immediate dispatch and native permission enforcement. It retires interrupted
dispatch eligibility instead of replaying work. A still-valid pending
implementation confirmation remains pending, never automatically approved.
Empty private sessions are created through supported named native creation,
saved, then attached with the exact original tools/hooks/permissions and
`continuePendingWork: false`, `suppressResumeEvent: true`. No dummy user turn is
used to make a session durable.

### Continue after an admitted role failed

An admitted request held as `execution-unknown` is **not unused setup**. Use
Development **Close** or the host's normal **Stop**, then reopen the updated
application in the same workspace. Same-ID recovery retains Conversation,
source handoffs and failure audit while retiring the interrupted request; it
does not retry that role. Wait for **Ready**, then explicitly send a **new**
request referencing the retained handoff, for example:
`Continue Design from retained handoff <id> and its source. Preserve confirmed
decisions and identify mocks. Do not implement.`

An exactly admitted handoff shows **Prototype handoff admitted**, not a repeated
primary submission button. Uncertain admission offers **Reconcile saved handoff**;
pending submission offers a read-only status check. Reconciliation remains
idempotent and cannot revive a retired request. A newly saved Prototype offers a
separate explicit continuation. Do not use unused-setup initialization, delete history, or substitute a
new private identity to retry admitted work. If Close or reopen fails, retain
the reported ownership/history error rather than treating it as success.

### Recover an incomplete first Development startup

New setup checks the actual Git root read-only before reserving native setup.
Tandem does not run `git init`, change ignore rules or commit for you. An unborn
Git HEAD is supported. Installation v3 records whether native creation is still
unrequested, has been issued, or has been confirmed. After a pre-native failure,
**Retry runtime** can finish initialization using the original reserved private
ID, after checking that no work or native state exists. An issued creation with
an unknown outcome is never treated as a fresh create.

Older v2 setup did not retain that boundary. An absent session and an empty
ledger therefore do not authorize an automatic fallback. If the original setup
failed before any work, use **Inspect unused setup recovery** in Development.
The application checks the full installation history, exact owner/configuration,
startup-only ledger/audit and native metadata, storage inventory and live-owner
observations. It refuses any prior Ready, confirmed native close/creation, Design, requests, roles,
cycles, approvals, native state, foreign owner or indeterminate observation.
No failed native query is interpreted as empty.
An old Stop/Close intent that returned to `unknown` without a close proof is
retained as intent, not mistaken for native creation; its IDs and phase transitions
must match the complete startup history.

If those checks succeed, review the displayed workspace and original reserved
private ID, then select **Authorize one-time initialization**. This is a separate
five-minute confirmation, not ordinary Retry, Reconcile, or implementation
approval. The application rechecks the bound evidence and records consumption
before issuing creation. Existing WAL frames, handoff files, request IDs and
startup uncertainty remain retained; it sends no project/model request.
After **Ready**, explicitly select **Continue saved Prototype handoff** to admit the
original prepared handoff. Never delete saved state or locks to bypass a
rejected recovery check.

### Repair a verified-empty Development setup

The native runtime can omit an empty session's event journal even after creation,
naming and explicit save. If that previously Ready setup cannot reopen, use
**Repair Development setup** in Development, then review **Repair the same
session**. This is a separate, one-use repair—not ordinary Retry or the older
unused-startup flow.

Repair requires the original created/Ready/close/failure history, unchanged owner
and runtime, no request/execution/Design/approval/native conversation, and
authoritative absence of native metadata, storage and a live owner. Only the
verified empty-close and missing-journal diagnostics are permitted. Retained
handoffs must be unsubmitted: sending, admitted, uncertain or foreign admission
blocks repair. API failures never count as absence.

The confirmation expires after five minutes and is revalidated under the
admission fence. Its evidence and consumption are recorded before the installed
SDK creates the **same reserved ID** again. Old WAL frames and source/handoff
files remain intact. This reinitializes empty setup; it does not restore
nonexistent native history, create a replacement UUID, or send a dummy turn.
Native model/effort readback must succeed before reporting completion. The
prepared handoff stays unsent until a separate explicit **Continue Design from
Prototype** / **Continue saved Prototype handoff** action. A failed or uncertain repair
cannot reuse its consumed confirmation.

## Acceptance, export and process adapters

Open **Acceptance, export and delivery** in Development for the optional advanced
panel. Its Close button and Escape return focus to the opener; the controls are
not required for ordinary Design work. Opening or closing it does not accept,
export, publish or start work.

Use **Capture Development outcome for review**, inspect the original Development
outcome and captured artifact, then explicitly accept it. The projection binds
the exact Design, cycle, source snapshots, implementation/review outcomes,
coverage, unresolved questions, native command references and verification limits.
Failed, partial, unavailable and unverified outcomes stay labeled.

Acceptance records attribution, not authenticated code-owner approval or a test
pass. It does not start work. **Export accepted handoff** is a separate explicit
operation writing `tandem-records`. Preparing a delivery draft does not export.
Source/Design drift requires a fresh capture and review before acceptance or
publication.

`ProcessAdapterRegistry` remains authoritative for independently selected Local
and GitHub handoff/status/intake blocks. Switching an adapter retains existing
references and receipts. Errors never substitute another adapter. GitHub requires
authenticated `gh`. Reviewed external publication is explicit; export itself
never commits, pushes, merges or deploys. Legacy automatic implementation/test
settings and verification records are historical only, with no executable
scheduler or mutable UI.

## Speech input

These controls belong to upstream discovery. Development preserves the PR's own
composer and private-session controls; main speech sign-in never authorizes it.

### GPT-live in Sketch

Sketch uses a compact microphone, message, and **Send** row. Open **Voice settings**
with the microphone dropdown or settings button to select **Azure dictation** or
**GPT-live conversation**. This selector affects Sketch only; all other stages
retain Azure Speech. **Ctrl+Enter** (or **Command+Enter**) sends a typed drawing
revision. Voice status and errors appear only when relevant. While GPT-live is
connecting or listening, the message box is read-only and shows the current
sentence for **You** and **GPT-live**, using VisionLoop's sentence boundaries
instead of adding a transcript row for each word. Ending voice restores your
unsent typed draft.

Select GPT-live, then **Talk with GPT-live** to start the microphone and hear
spoken replies. Discuss the current screen or ask for layout, label, shape,
canvas-size or navigation changes. Like VisionLoop, GPT-live delegates drawing
work to the app rather than directly executing model-generated commands.
Tandem saves local drawing edits first, runs its bounded streaming sketch worker,
and shows drawing operations incrementally before saving the completed revision.
Typed drafts remain untouched; a live preview is not a saved or approved result.
Voice never accepts requirements, approves drawings, advances stages or publishes.
Review the drawing and use **Approve drawings and continue** yourself.
The initial scene summary is included in session startup. Later context and
spoken work updates carry the provider's delegation ID; manual changes are
included at the next delegation rather than sent as unsolicited append commands.

GPT-live uses VisionLoop's native Live WebSocket protocol, **gpt-live-1**, mono
16 kHz PCM audio, and Azure CLI / Microsoft Entra authentication. It is not the
OpenAI Realtime/WebRTC API. The extension holds the Entra token; only a short-lived,
single-use loopback connection ticket reaches the page. Its configuration is
separate from Azure Speech:

```powershell
$env:Path += ";$env:LOCALAPPDATA\Programs\AzureCLI\bin" # For a per-user Azure CLI installation
az login --tenant 72f988bf-86f1-41af-91ab-2d7cd011db47
# Optional overrides in the environment that launches Tandem / Copilot:
$env:TANDEM_Live__Endpoint = "https://cloudgpt-ins.openai.azure.com/openai/v1/"
$env:TANDEM_Live__Model = "gpt-live-1"
$env:TANDEM_Live__Voice = "marin"
$env:TANDEM_Live__TenantId = "72f988bf-86f1-41af-91ab-2d7cd011db47"
```

Your account must have access to this Azure GPT-live deployment. The endpoint
is restricted to the approved VisionLoop host and Live route; arbitrary
endpoints and other models are rejected rather than receiving credentials.
Azure Speech's top-bar **Sign in** button does not sign in to GPT-live.
On Windows, GPT-live also adds the verified
`%LOCALAPPDATA%\Programs\AzureCLI\bin` installation to the extension process's
PATH before authenticating. This works even when Copilot was launched before
Azure CLI was added to PATH; it does not change your persistent Windows PATH.

**Live audio, captions and a bounded summary of the current sketch are sent to
Azure.** The provider session requests `store: false`. Tandem keeps conversation
captions in page memory, not audio files; a delegated drawing instruction is
handled by the normal sketch revision workflow. Connections stop after ten
minutes, when Sketch is hidden, when the effort/provider changes, or when you
select **End voice** or press Escape. Stopping voice does not cancel a drawing
worker already submitted. Failures are visible and never switch providers or
reconnect automatically. A microphone-capable browser with Web Audio is required;
use **Open Tandem in browser** if the embedded canvas blocks microphone access.

### Azure Speech dictation

Every conversational input has a **Mic** control: project goals, usages,
requirement answers, prototype revisions and clarifications, artifact reviews
(including test design), plan revisions, and implementation strategy adjustments.
Select **Sign in** on the right of the top bar to open your default browser, choose your work
account, and complete any MFA prompt. Return to Tandem after it confirms sign-in,
then click **Mic**, allow microphone access, and speak naturally. Partial text updates
in place; **Stop** finishes the recognized text so you can edit and send it.
**Cancel** or Escape restores the original draft. Recording never sends a message
or starts an agent. One input can record at a time, for up to two minutes.
Changing conversation, hiding the page, or resetting the effort cancels capture.

Speech uses **Azure Speech with Microsoft Entra ID**, following Demore's
identity-based authentication pattern, not a Speech subscription key. Configure
these environment variables in the environment that launches Copilot, then restart
Copilot so the extension inherits them:

```powershell
$env:TANDEM_Speech__ResourceId = "/subscriptions/<subscription-id>/resourceGroups/<group>/providers/Microsoft.CognitiveServices/accounts/<speech-resource>"
$env:TANDEM_Speech__Region = "eastus"
$env:TANDEM_Speech__Language = "en-US" # Optional; defaults to en-US
```

Use an Azure Speech resource and grant the signed-in identity the **Cognitive
Services Speech User** role on that resource. **Browser sign-in requires neither
Azure CLI nor an API key.** It uses Azure Identity's `InteractiveBrowserCredential`
with PKCE and a local loopback callback. Browser sign-in has a three-minute limit;
**Cancel sign-in** or Escape stops the local listener. Switching to the browser
does not cancel sign-in. It never starts the microphone or sends your draft.

The selected account and token cache are memory-only for this extension session;
sign in again after restarting or reloading the extension. Selecting **Sign in**
again lets you change accounts. Failed or cancelled sign-in
does not replace an already selected account. Once a browser account is selected,
Tandem does not silently switch to another identity if its tokens expire.
Before browser sign-in, existing `DefaultAzureCredential` sources (such as
`az login` or a managed identity) remain supported.

For local development, the browser flow uses Azure Identity's development
application. If your organization's policies require an approved app, set
`TANDEM_Speech__TenantId` and `TANDEM_Speech__ClientId` to its tenant and client
GUIDs. Register it as a public desktop client with the `http://localhost` redirect
URI and the required Azure Cognitive Services delegated permissions/consent.
Use an organization-owned application for production distribution. No client
secret is used. Shell-only environment changes apply only to applications
launched from that shell.

**Microphone audio is sent to Azure for transcription.** Tandem does not save
audio, recognition history, or credentials; unsent text stays in the current
page's draft memory. Normal message persistence starts only when you explicitly
send. Recognition errors restore the original draft and never switch to another
provider. If the host canvas denies microphone access, use **Open Tandem in
browser** beside the error and grant microphone permission there; the same effort
and chat inputs are available. Unsent drafts are page-local, so copy any draft
you want to keep before switching windows.

## Optional Windows Forms host

The existing Windows Forms/WebView2 host remains available with .NET 10 and the
WebView2 Evergreen Runtime, using the same Node 24+ backend:

```powershell
npm run desktop -- --workspace C:\projects\my-app
```

Its build copies the complete composed payload, not only `extension.mjs`.
Its upstream permission menu is distinct from Development consent. Both native
and browser hosts give private close its intended grace period before owned
process termination.

## Develop, validate and package

Maintain root TypeScript/renderer assets under `src` and Stage 2 implementation
under `stage2\tandem`. Never hand-edit the generated extension.

```powershell
npm run check
npm test
npm run build
npm --prefix .\stage2\tandem run build
npm --prefix .\stage2\tandem test
```

Root checking emits Stage 2 type declarations using its strict configuration
before checking the composition; it does not inline or rewrite its runtime.
`npm run build:browser` and `npm run build:desktop:runtime` stage the same complete
payload. `npm run pack` creates the extension ZIP. Install its complete
`extensions\tandem` directory and matching `skills\tandem\SKILL.md` together
only when explicitly authorized; copying the single generated entrypoint is
insufficient. Large complete payloads may exceed the canvas gist size limits.

Bridge tests cover source retention, exact request reconciliation, migration,
retired routes, native capability/provider conflicts, payload hashes and delivery.
Stage 2 owns its role/runtime, confirmation, Stop/reopen, WAL and browser tests.
Browser fixtures must actually execute to establish UI coverage; skips are not
qualification. Native no-model startup/control/recovery qualification is distinct
from a model-driven Design/implementation journey.

`npm run eval` is a no-network inventory of synthetic Preparation and
Prototype-to-Designer probes using the production prompt builders. Live
evaluations still require explicit `--live`, `--model`, `--max-cases`,
`--timeout-seconds` and `--max-ai-credits`. No mock result or worker report
establishes native end-to-end success.

See [Stage 2 integration](stage2/stage1-integration-plan.md) and
[Stage 2 instructions](stage2/AGENTS.md) for the composition boundary and invariants.
