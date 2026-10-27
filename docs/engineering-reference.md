# Engineering and operations reference

[Project overview](../README.md) | [User guides](README.md) | [Troubleshooting](troubleshooting.md)

This maintainer reference preserves the integrated application's runtime,
ownership, recovery and packaging details formerly
in the root README. For task-by-task instructions, use the
[user manual](user-manual.md) rather than this implementation reference.

The source baseline is the integrated documentation at `6e5ffa7`, including the
maintenance/error-visibility changes in `fe16b72` and `5f27488`. These are source
contracts, not a claim that a public release or installed package includes them.
All source paths and command working directories below are relative to the
**Tandem repository root**, not this `docs` folder.

| Topic | Details |
| --- | --- |
| [Browser host and ownership](#standalone-nodebrowser-app) | Shutdown, permissions, provider selection and local packaging. |
| [Workflow contracts](#workflow) | Independent stages, effort, progress, source handoff and UI boundaries. |
| [State, migration and recovery](#state-migration-and-recovery) | Retained history, interrupted work and guarded setup repair. |
| [Settings and retained history](#project-settings-and-retained-history) | Shared settings, independent runtime ownership and retired process records. |
| [Windows Forms host](#optional-windows-forms-host) | Alternative host requirements. |
| [Development and packaging](#develop-validate-and-package) | Source layout, checks, packaging and qualification boundaries. |
| [UI system and Storybook](ui-system.md) | Shared tokens, component contracts and development-only examples. |

## Implementation scope

Tandem can open **Development directly** for a new or existing Git project.
Optional Stage 1 collects Q&A, confirmed intent and prototype evidence through
**Preparation -> Requirements -> Designs -> Prototype**. It does not own formal
Design. Stage 2 Development owns canonical Design, confirmed implementation and
Review, using its original Design/Conversation UI and native role workflow.
The former Design, Plan, Implement and Test stage engine is retired.

## Standalone Node/browser app

Use the [source quick start](quick-start.md#1-launch-the-source-preview) for
prerequisites and launch commands. Windows and PowerShell are the currently
qualified Stage 2 environment. Other platforms are not qualified merely because
the outer browser launcher supports them. The browser launcher needs neither
.NET nor a running Copilot desktop app.

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
Main permission controls remain scoped or disabled while the private
runtime is active, not merely while browsing Design. Maintenance is not in the
branded root or hosted header. Supported providers expose **Reload Tandem extension**
in Project settings' advanced diagnostics. Its explanation warns that this
session's extension connections restart and unsent form text may be lost;
Tandem's saved data/history are not reset or archived. It does not refresh the
page or app preview or download updates. The composed Settings
surface delegates this existing action to its owning root; standalone Stage 2
does not acquire a root maintenance action.
Reload failures remain visible in the root status bar and hosted error banners
after Settings closes. An interrupted Preparation restart may use supported
reload to reconnect, but reload does not clear that recovery barrier or resume work.

Standalone hosts combine workspace status/help and **Go to action** with host
status in one bottom bar. Independently opened canvases, and hosts without status
bar support, retain the workspace's own bar.

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

Initial project entry for either starting path checks Git and effective application-state exclusions
without writing. `/api/development/preflight` binds an expiring, one-operation
consent to the observed folder, Git metadata, saved choice and ignore bytes.
Only explicit `/api/development/setup` consent may initialize local Git and append
the missing `.tandem/` rule. It never chooses a starting path or starts a runtime.
The renderer then resumes the originally requested public entry once; the backend
rechecks readiness before saving either starting choice, opening Development or preparing a
Prototype handoff. Setup does not authorize model submission or implementation.
Cancel performs no setup or project-entry writes. Partial failures retain and
report attempted changes, and require a fresh check before another consent.
The native runtime's independent tracked/untracked inventory checks remain intact.

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

The source package pins CLI 1.0.94 and SDK 1.0.18 in root `package.json`.
The host explicitly supplies that SDK to extension processes, preserving native
`isTerminal` declarations rather than relying on a different bundled serializer.
Retained Stage 1 coordinators use the public Dynamic Workflows API. Existing
`factoryRuns` and `factoryName` receipt fields remain unchanged on disk; their
names are historical, not an alternate legacy execution path.
The answer workflow's `action` schema is derived from `ANSWER_ACTIONS`, the same
set used for runtime validation. This includes the `assess-change` prerequisite
for design and prototype revision requests.

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

Preparation inspects local workspace context and offers optional first-person
usages. Empty folders, including those with only Git/Tandem metadata and the
setup-generated `.gitignore` containing `.tandem/`, use local inspection and one
tool-free handoff worker instead of separate workspace and source workers.
Other ignore rules, guidance, project files and linked metadata still require
workspace inspection. Only an unfamiliar reference essential to understanding
the goal can trigger an early lookup, bounded to one authoritative source call.
Named APIs, repositories or research goals alone do not trigger substantive research.

After the user accepts usages, **Generate requirements DAG** runs targeted
research before generating the dependency-aware questions. Research uses accepted
usages and relevant Preparation findings, not unselected suggestions, with at
most four authoritative source calls and no external lookup for ordinary concepts
when none is needed. Pure implementation research waits for Development unless
it changes a requirements decision. Question generation and answer reconciliation
use tool-free workers with Requirements-only context. Generation returns nodes
and semantic lists; individual answers return only changed dependent questions,
necessary new nodes and list patches. The host applies the exact submitted answer,
retains independent decisions and derives statuses, the next question and diagram.
Findings and sources are saved with the exact input snapshot, generation,
request and run identities; stale results cannot advance Requirements. Failed
generation retains usages and any completed research for explicit retry.
A retry reuses research only when the goal, accepted usages, Preparation evidence
and generation still match. Reuse preserves its original request, run and completion
identities; generated questions bind the exact retained research digest. Answer
patches bind the frozen Requirements inputs and submitted answer. Versioned workflow
steps prevent replaying older full-state outputs as focused patches; already-running
legacy results remain recoverable.
Progress and **Research and sources** stay inside Requirements, without a new
user-facing stage. Recommendations and research findings are not accepted answers.
Whole-graph defaults require explicit confirmation and one bounded reconciliation.
The frozen batch must contain exactly all unanswered decisions with valid curated
recommendations, including downstream nodes; questions without them remain
unanswered and are marked **Explicit answer** in both DAG and list. Reconciliation
must not infer their answers or accept dependent defaults whose compatibility
requires missing prerequisite information. On success, the inspector focuses the
next active question. No new or changed recommendation is selected automatically.
The active marker is a navigation default, not an answer lock: the UI and answer
endpoint share dependency-based readiness, so any unanswered question with
completed prerequisites can be selected and answered. Unmet dependencies still
block submission.
Failed or conflicting answers remain visible, not silently accepted.

Designs (internal stage ID `sketch`) uses a version-2 multi-screen envelope with UI DSL v1 documents, while
retaining revision history, explicit approval, size/zoom and screen/transition
metadata controls. Use Designs consistently in user-facing labels, status messages
and help. Internal IDs and saved paths retain their existing names; Development's
formal artifact remains Design. The shape toolbar, freehand gestures and geometry inspector are
removed. `src/vendor/ui-dsl` is a hash-recorded, unmodified snapshot of the local
`chat-ui-dsl` library, not its standalone canvas, server or persistence. Refresh
it with `node --import tsx scripts\sync-ui-dsl.ts C:\projects\dsl`; builds do not
depend on that neighboring checkout. Bundled icon licenses are retained in both
source and built payloads.

New UI DSL envelopes record optional `fidelity`: `wireframe` for new concepts,
`styled` for existing-GUI validation. The host seeds new wireframe screens with a
fixed neutral token kit; workers focus on meaningful content, hierarchy and
navigation instead of decorative operations. Missing fidelity retains historical
styled semantics and is never written into an existing revision implicitly, so
old source hashes and approvals remain unchanged. Incremental edits and recovery
retain the saved fidelity. Wireframe approval explicitly defers appearance and
does not prove application behavior; this scope travels with the approved DSL
and its artifact into Prototype and Development.

Production prompts in `src/planning-prompts.ts` use the shared DSL catalog and
operation rules, with a bounded, validated icon-name palette for the tool-free
design worker. That worker cannot call the library's optional icon lookup tools.
Tandem's stream boundary canonicalizes known official Lucide aliases such as
`trash-2` to `trash` before normal validation, without modifying the vendor
snapshot. Unknown icons still fail atomically; previews and saved documents
contain only canonical names. Invalid component props (for example `List.size`)
receive one bounded correction attempt from the last validated document, with the
rejected operation and schema error supplied to the worker. Invalid properties are
never silently dropped or accepted; transport, identity and unsafe-key errors do
not trigger this correction. The existing bounded stream applies one `ui.edit` at a time to
the named screen; Tandem still owns request identity, transient previews, final
commit, approval and immutable history. Generation uses an outline-only worker for
`upsert-screen` metadata and `upsert-transition` navigation, followed by a content-only
worker that cannot change that published outline. Structural updates bypass preview
batching so every page is visible before content generation starts. Content is built
sequentially with `screen-status` processing/ready records. The factory allows at most
three workers (outline, content and one correction), retaining its existing credit
ceiling. Incremental revisions still patch the saved DSL without rebuilding an outline.
The host initializes new pages as waiting, validates
ready pages have UI content, and resets a page to processing on a later edit.
Per-page statuses travel only in the request-bound preview, never the saved
document or approval. Older previews without statuses remain readable and do not
claim partial content is ready. JSON records can span formatting line breaks;
only complete, valid operations are applied, with unchanged size limits and
strict rejection of prose, malformed JSON and invalid operations.
On failure, the last validated preview remains inspectable and is persisted as a
request-bound recovery checkpoint in ignored operational state, not in saved revision
history or approval. `sketch_action` with `action: "retry"`, `expectedRevision`,
`expectedGeneration` and the failed `requestId` resumes its exact phase, pages, nodes
and navigation. The SDK must confirm the failed run is terminal before retry.
Recovery preserves its source request/run identities and is rejected if the generation,
requirements digest or saved base revision changes. Success clears the checkpoint.
The renderer labels interrupted pages **Stopped**, keeps completed pages visible,
and disables edits/approval of the incomplete preview.
Verified workers without native phase metadata can stream JSON-prefixed data
without waiting for the final message; prose still requires native commentary
classification and cannot be silently dropped from a design result.
A shadow-root renderer isolates artifact
styling from the editor. PNG approval previews use the same renderer and CSS at
the saved viewport, independent of view zoom.

The integrated Structure tree appears after Screen details, follows the DSL's
ordered child IDs and synchronizes with the rendered selection. The Screens list
fits its content up to half the sidebar height; the expanded Structure tree fills
the remaining space. Each pane scrolls independently. Select is the
default persistent mode; Interact is explicit. Tree navigation and selection are
view state, not edits or approval. Saved change targets retain their revision,
screen and node identities; transient preview selections use a separate request
identity and are never carried into saved revision requests. Selection outlines
are excluded from approval images.
In Interact mode, `Button.action` and `Link.destination` can name an exact outgoing
transition ID; the local view follows only that saved edge. A bounded navigation
strip also exposes the outgoing transitions without inferring links from labels
or opening external URLs. Neither route edits or approves a document. Preview
rendering and selection effects key on actual screen content, not object identity,
so streamed changes on another page do not touch the selected page's DOM.

New revisions save `document.json` and per-screen `.ui.json` sources instead of
SVG geometry. Approval binds their hashes and derived PNGs. Prototype and the
Development handoff consume these exact DSL inputs; images are additional visual
evidence. Version-1 geometry remains readable for archive integrity, but is not
rendered in active Designs or accepted as a new downstream input. Users must
explicitly regenerate and approve DSL views; no files or old approvals migrate
implicitly.

Next-action guidance opens request history and focuses
a failed revision's Retry control without resubmitting it or replacing an unsent
instruction. Prototype uses one combined functional sub-stage,
optional visual refinement, queued feedback and explicit update acceptance.
`build` produces a mock UI; `validate-existing` works from the existing GUI's
copied source; `not-applicable` preserves a reason and feature specification
without fabricating a graphical prototype.

New builds, retries and non-visual revisions use milestone `prototype`, combining
layout, navigation, typed mock behavior and applicable state feedback in one
worker/checkpoint. The required sequence is `prototype`, then optional `visual`;
no new Structure/Interaction continuation is scheduled. Existing checkpoints
retain their IDs, sources, receipts and milestone values without rewriting history.
A ready legacy `interaction` satisfies Prototype readiness; `structure` alone
does not. Both map to the single Prototype tab, whose saved-preview target prefers
the accepted non-visual version, otherwise a complete saved result, then a partial
historical preview. Browsing never promotes a pending version.

The legacy `tandem_publish_structure_*` tool and `continuation: "interaction"`
reader remain only for previously admitted progressive workers. Their source
verification, original image-read identities and terminal-receipt semantics are
unchanged; a resumed worker follows its actual active checkpoint. New jobs never
request that tool. Retrying incomplete historical work uses the combined milestone
and preserves its source. Preview restart binds the checkpoint ID, not its shared
workflow request ID, so both historical progressive snapshots remain recoverable.

### Finish Stage 1; open Development when ready

Chat changes use the additive `changeRequests` ledger and the production
`buildChangeAssessmentPrompt`, not the broad stage-reopen/reset path. HTTP and
canvas entry points share assessment and decision handlers; the original stage
engines remain independently usable. The change ledger, stage tabs and active
editor occupy separate workspace rows. The top row holds stage navigation,
completion/reopen controls and Designs approval on the right. Pinned draft Apply
and preview recovery controls retain their below-input placement; an empty
review row occupies no space. Designs places its Review icon
immediately after History on the composer row. A newly returned proposal or
failure opens the bounded review popup once. A shared, browser-safe policy excludes
changes that proceed automatically; refreshes, loaded history and an already open review do not
steal focus. Impact details open in a bounded modal dialog outside the workspace
grid, so reviewing them never resizes the editor. Closing the dialog restores focus
to its trigger and retains clarification drafts. The red icon and border use the
semantic danger token plus an accessible Review-required label. Closing permits
inspection but does not release the review gate. Errors remain visible in the
dialog and status area. Design completion is shown only
after approval, while a failed continuation remains explicitly retryable.
The popup presents one current review with request, impact and clarification
sections and a fixed action footer. There is no request selector or inline
reviewing-status card. Shared
request-status presentation distinguishes an unapplied proposal, missing detail,
saved design draft and Development admission without implying implementation.
Design submission IDs bind composer history to the ledger, whose responses
survive reload. Composer and Discovery-history actions open the exact record and
restore focus to their original control. Older errors cannot label newer requests
as blocked. Completed records remain inspectable without mutation controls.
Pinned Apply gates on active/uncertain parent work and approved active changes,
and on a prepared prototype candidate that must be resolved before its inputs
change. Queued assessments, unapproved proposals and failed/deferred requests
alone do not block Apply.
Both the Apply endpoint and its public readiness state use the same parent-work
check. Saving a reviewed stage checks pending requests in that draft while still
validating the merged stage's artifacts and source bindings. Unrelated parent
requests and their baseline digests remain unchanged; changed inputs invalidate
old proposals rather than implicitly approving or discarding them.
The shared review policy chooses admitted work first, otherwise the pending
request. New independent submissions are rejected atomically while that request
is outstanding, including the HTTP and canvas paths; duplicate submission IDs
remain idempotent. Prototype feedback can explicitly bind `replacesRequestId` to
that current review to request re-evaluation instead. Replacement links are
validated and preserve the previous request/analysis identities. At a safe
boundary after parent and pinned-draft workers finish, only the replaced review's
unapplied candidates and open drafts are retired; their files, records, applied
changes and unrelated work remain intact. The latest queued feedback includes
its predecessor chain in assessment context and still requires the normal
approval steps. Rehydration resumes this queue without replaying old patches.
Unrelated edits and stage completion stay gated, while the
current review's required stage updates and pinned-draft work remain possible.
Queued changes waiting for an existing prototype candidate, clarification or
revision do not lock those predecessor controls. Their assessment waits until
the earlier work is resolved, including automatic candidates without a feedback
revision. This uses the same browser-safe policy as the review pane and edit gate.
Older queues and deferred records are preserved rather than cancelled or merged;
they resume one at a time after the current review resolves. New deferral is not
an escape from required review. Rehydration continues eligible queued work only through
the writable provider and existing ownership checks, never by taking over a
foreign or unverified worker.

Current-stage design-only changes settle when their revised draft and matching
terminal run receipt have been saved, not when the whole Designs stage is
approved. Current-stage Requirements patches settle when saved; purely additive
requests can proceed without another impact decision, while edits to existing
decisions, removals and assumption/deferral changes still require review.
New questions never acquire automatic answers. Rehydration can settle older
requests left active by these behaviors using their bound receipts and saved
state, verifying design source bytes where applicable; it never reapplies,
regenerates or approves them. Prototype
updates still require their existing explicit Apply action. Cross-stage and
consequential Requirements changes retain impact review and sparse reconciliation.

Design requests bind the viewed screen and optional explicitly picked UI node
to the source revision. Both HTTP and canvas actions validate those identities.
Assessments receive the full current DSL and, if it changed, the original source
DSL as well. Production prompts resolve visual descriptions using components and
their properties, avoid incidental cosmetic questions, and retain genuine target
or behavior ambiguities rather than silently choosing another element.
Assessment is context-only and preserves accepted state, including the derived
Requirements diagram. Impact-check progress stays in processing state instead of
rewriting that artifact and invalidating its own baseline. Approval binds the exact
analysis ID and semantic baseline digest,
including current Development Design/code when available. It saves a complete
baseline snapshot before applying a sparse Requirements patch and marking only
the affected stage outputs for review. Stable decision IDs, independent answers,
unaffected screens, source checkpoints and receipt history remain intact.

Scoped lifecycle records add `changeRequestId` to the existing version-3 format
so completed stages need not be a contiguous prefix. Earlier version-3 records
retain their original normalization. Updated prototype checkpoints also bind the
Requirements digest; a retained old preview is not current evidence for changed
requirements. Freshness follows recorded Requirements/design identities even
without lifecycle review flags; legacy previews lacking those bindings require
an explicit update after accepted upstream changes. A change whose next stage is
Prototype also requires its own applied, checkpoint-bound feedback revision,
not merely a matching input digest. Opening an earlier draft alone does not
invalidate the accepted preview. The explicit refresh path uses the original
change's stable feedback identity, carries its complete context to the worker,
and preserves the displayed version until promotion. Retry reuses failed work;
optional visual exploration cannot substitute for the required update.
Request, analysis, native delivery and artifact identities remain
separate. Errors and uncertain delivery are retained, not converted into approval.

Upstream impact review is confined to discovery, through Prototype. Development
requests stay in the native Router, Designer, implementation-confirmation and
Review flow, including when retained Prototype handoffs exist. The composed host
supplies only immutable handoff evidence, not a live discovery baseline, and
native settlement never schedules an upstream assessment or wakes the main
session. `discovery-change` remains readable in historical native ledgers but is
not an accepted Router tool outcome. Saved Development-origin change requests
remain inspectable without blocking discovery, resuming assessments or exposing
impact-decision controls.

Explicit continuation of a pre-Development change still persists an immutable
outbound request before sending; duplicate delivery reconciles that identity,
and recovery never authorizes replay. Upstream mutation retains the existing
quiet/admission boundary, and Development implementation retains its separate
human confirmation.

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
creation/resume, with actual readback checked before opening the canvas. The
standalone browser CLI also accepts these options and passes them to that same
native host, including after a folder switch. `--reasoning-effort` requires
`--model`; `login` accepts neither option.
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
from final structured output and design NDJSON; untagged prose is not guessed
away to make an invalid result pass.
Explicitly tagged design data still streams immediately. If native message
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
approved designs or prototype source files in a normal message. Stage 1's
connection need not survive: these files are input/evidence, not permission to
adopt a previous Stage 2 run, its canonical Design or session authority. Existing
used Stage 2 work still requires its original owner and same-ID recovery; this
does not bypass the desktop workspace's main-session ownership rules.

Alternatively, **Continue to Development** opens a read-only handoff review.
`GET /api/development/handoff-review` reads the completed snapshot, without
creating a receipt or native session. Confirmation binds its snapshot hash,
generation, source path, target workspace, owner and acceptance context; changed
inputs fail before admission. Cancel has no backend mutation.
**Create Design from Prototype** (or **Refine Design from Prototype**) asks the current
host to retain an immutable bounded handoff under the **target worktree's**
`.tandem\living-canvas\handoffs`. It includes exact completed snapshot bytes,
artifact hashes, confirmed/assumed/deferred decisions, approved designs/assets,
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
Requirements, designs and Prototype retain their specialized inputs and controls.
Discovery views also expose horizontal Preparation, Requirements, Designs and
Prototype tabs above the workspace. They share the sidebar's browsing selection
and availability guards, but sidebar styling stays bound to lifecycle progress:
the current phase stays highlighted and completed inputs stay visibly locked.
The tabs keep the existing panels mounted and scroll horizontally
on narrow screens. The tab bar is absent from goal entry, Saved artifacts and
Development; it does not change stage completion, reopening or data updates.
Earlier-stage **Review changes** opens a pinned, independently stored draft using
the existing stage editors. Root `stageReviews` records link each draft to its
parent generation, stage and eventual Apply/discard outcome; the draft's
`stageReview` binding identifies its accepted baseline. Draft state and its
immutable baseline live under `.tandem/efforts/review-<id>/`. Opening a draft copies
only state metadata, not application source, and dispatches no worker.
Requirements renders its immutable Accepted/Draft comparison directly in the
editor, including no-question usage and ledger changes. Apply waits for a
successfully read, identity-matching baseline; failures expose Retry. Unchanged
assessment patches are rejected rather than creating empty reviews. Applied and
discarded comparisons remain inspectable with their actual outcome. After Apply,
unlinked reviews route to the earliest invalidated stage just like linked changes.

Continuing a change into another pinned stage copies its original request,
source identities and accumulated affected-decision scope into a stage-local
active request. It does not reapply the Requirements delta or restart earlier
stages. Applying a draft carries its recorded scope forward. An explicit Designs
action also restores missing request context in older linked drafts from their
parent and applied review records, after checking that the baseline still matches.
Stale Designs exposes **Update designs from latest requirements**; preparing the
draft, approving it and applying it remain separate actions.
The `update` design action always runs an incremental `revise-sketch` worker from
the current saved DSL, whether or not a change request is linked. It records an
`update` request and a `revised` result so retries retain that intent. The prompt
edits existing node IDs without a fresh page outline; only explicit `generate`
starts an empty stream. Current-stage stale-design continuation also uses `update`.
The stream may retain obsolete decision references from its immutable baseline
while editing; previews and completed revisions must use current accepted IDs.

Design revisions and prototype candidates use new immutable paths in the
parent effort's existing asset namespaces. This preserves the exact asset,
checkpoint and preview identities required by restart, acceptance and Development
handoffs without copying or rewriting an accepted revision. Prototype feedback
stays queued in the draft until an explicit preview build. Draft worker requests
retain their own effort/request identities; preview HTML identifies the parent
project and the exact candidate checkpoint.

Apply holds the parent and draft `ProjectStore` transactions, validates the
stage's baseline and predecessors, rejects stale draft revisions or active work,
and requires Development to be quiet before changing accepted inputs. Independent
later-stage progress does not stale an earlier-stage draft. The lifecycle
`reviewId` preserves the working stage while dependent completion records move
to history; affected stages must be reviewed again without implicitly rewinding
the project. Earlier-stage chat proposals enter this same draft path and remain
separate from normal current-stage work and broader Reopen operations.

Review editors use scoped API routes and an independent store, busy state and
draft-input provider. Navigating to current work hides rather than remounts the
pinned editor. Applying does not close it or authorize Development implementation.
Draft Designs uses direct edits or explicitly requested revisions.
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
controls follow the stage tabs at the right of the workspace header, alongside
Prototype preview controls when applicable, not in the tab content or sidebar.
The header has no horizontal divider lines; controls wrap on narrow screens.
Secondary history starts compact in constrained panels and can collapse to a
small keyboard-accessible rail; reopening restores its prior sizing. Already
approved, unchanged designs show one Finish action rather than another primary
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
Saved appearance settings apply to the whole project surface. Development uses
its own responsive Design/Conversation split: Conversation starts at 45% of the
embedded workspace, or 53% when that workspace is at most 950px wide. Its existing
pointer/keyboard divider retains explicit resizing across artifact navigation,
independently of Discovery's read-only history width. At 660px or less of embedded
width, the contents stack without replacing the conversation or its draft.
Source diagrams and documents retain their own authored styling.
Navigation labels remain fully visible in constrained sidebars. A compact dot
beside Development means **Design available**, with that tooltip and accessible
name; it does not imply completion or approval. New-output and attention cues
remain distinct, with longer output-status badges on a second line.

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
Requirements uses view-only **Usage list** and **Decision DAG** tabs. The usage
tab owns Requirements intake/history and retained research. The DAG tab fills
the available workspace. The diagram viewport, decision list and selected-question
pane have independent, bounded scroll regions. The diagram region and the
question list below it share a 3:2 vertical
split at wide and narrow widths, without resizing the selected-question inspector.
The legend and zoom toolbar sit
outside the diagram viewport. The Mermaid source button follows the Fit/zoom readout and opens a
modal with its own bounded code scroller, including when rendering fails.
Opening, closing or updating the source cannot resize the workspace or reset zoom
or decision selection. Requirements and Prototype use shared numbered sub-tab
styling and status icons while retaining their independent state. Status descriptions
remain available through icon tooltips and accessible names, not visible status text.
Tab changes retain answer drafts, graph zoom and research expansion without
changing the saved requirements substage or reopening accepted work.

Active and completed Prototype views distinguish saved checkpoint readiness from
a running server. Viewing the phase, reconnecting, or **Check again** verifies the
current generation/checkpoint/URL before attaching an unverified inline preview.
Unavailable servers show an explanation instead of a browser connection error;
saved versions, pending updates and feedback are unchanged. Verification never
starts a server or model work, and successful rechecks keep the current frame's
local state when its verified identity has not changed.
**Prototype** and **Visual exploration** are view-only tabs.
Saved milestone targets resolve the accepted checkpoint of that milestone when
available, otherwise its latest ready, non-dismissed checkpoint. Availability
checks and explicit restart reviews bind the exact generation, checkpoint and URL;
browsing never promotes a pending version. Previously viewed milestone frames and
the current preview stay mounted across tab changes. Feedback continues to bind
the accepted checkpoint, not the historical result being inspected.
The toolbar's open-preview control follows the visible result.
An automatic version is labelled **Prototype ready to inspect**;
**Show Prototype** explicitly switches the
displayed checkpoint. Requested-revision wording appears only for a checkpoint
linked to a recorded feedback revision. Feedback is optional; readiness is not a
claim that the user submitted feedback or that the saved preview server is live.
The phase-owned Feedback section stays at the bottom of the Prototype pane, with
the inline preview using the remaining space above and its sub-stage content
scrolling when needed. Project context, stage content and discussion each own
their scrolling rather than expanding the outer workspace, including narrow views.
Successful preview checks and verbose version summaries stay collapsed in Details;
unavailable versions and their targeted Restart actions remain prominent. The
normal current-plus-pending view preserves a useful preview and initially reachable
Feedback at 920x620, including an expanded feedback draft.
Designs, Prototype (including visual-direction refinement) and draft Requirements
change requests use the same input/Send/History layout and shared history controls.
History reads the owning stage's existing request records, preserves drafts and
queue identities, and never submits, accepts or promotes a version.
Neither current-preview link nor current iframe switches to a pending version without the explicit
checkpoint-promotion action; its existing validation and Finish gates are unchanged.

Optional **Visual exploration** uses one isolated application checkpoint with
two or three working directions, not parallel replacement applications.
`src/planning-prompts.ts` owns the generation/refinement instructions.
`src/visual-directions.ts` validates the bounded manifest, exact setting enums
and stable direction identities. Each direction describes layout, typography,
palette, effects and departures from approved designs; palette-only duplicates
are rejected at the contract level. Descriptions are not proof of visual quality:
workers must exercise the actual alternatives and report observations separately.

The checkpoint retains `tandem-visual-directions.json` in its source root and
serves an identical copy beside its preview page. The host checks both copies,
the exact preview identities, opt-in HTML marker and unmodified preview bridge
before recording readiness. The bridge applies source defaults on standalone
startup, or bounded `tandem-*` selection parameters for an explicitly shared
direction link. Trusted parent messages switch root attributes and CSS variables
in place; acknowledgments bind the prototype, checkpoint, request and settings.
No wildcard origins, browser-storage preferences or executable CSS inputs are
accepted. Reduced motion overrides requested motion effects.

Comparison state lives in `prototypeFlow.visualExploration`, independently of
`displayedCheckpointId`. Viewing or adjusting alternatives never promotes them
or starts model work. **Default** is the exact original checkpoint, not a neutral
appearance preset of a generated direction. Its identity follows the exploration's
original base through scoped refinements, even after accepting another direction.
Accepting Default requires the current revision, unchanged source and designs,
and a verified preview identity; it restores that retained checkpoint without
generation or deleting alternatives. Scoped refinement uses the existing durable feedback
queue and latest exploration source, retaining the submitted direction/settings
and original feedback base. Unrelated current-prototype feedback waits during
unresolved exploration. Accepting the original Default resolves that optional
choice and resumes queued ordinary feedback from the original source. The guarded
`skip-visual` action explicitly marks outstanding visual feedback `dismissed`;
it does not delete the alternatives or source.

The top-toolbar **Accept** freezes a direction into a new checkpoint whose source
manifest's `defaultSelection` must match exactly, then explicitly applies the
verified saved choice. Later ordinary revisions retain those
defaults; handoff captures the same source and snapshot rather than a URL-only
theme preference. Previous single-theme checkpoints remain readable, and new
exploration is an explicit action. Prototype generation and private
Development ownership are unchanged.

If a saved preview server has stopped, **Restart preview** targets only the
displayed checkpoint; **Restart pending preview** targets only the waiting version.
**Restart visual exploration** targets the retained alternative bundle.
Default and the named directions share one top-toolbar recheck/restart pair:
Default binds the original checkpoint, while a named direction binds the shared
exploration checkpoint. The open-preview action follows the same visible view.
Pending-version recovery remains separate. Preview failures are visible in the
pane rather than only in visually hidden status text.
None of these actions generates code, applies an update, changes feedback or opens
Development. A previously reviewed live server is reused rather than duplicated.
New Node-based checkpoints may retain `previewStart` with the actual source-owned
server entrypoint, working directory and argument vector supplied by the worker.
Paths are checkpoint-relative, validated against materialized source, and kept
with that checkpoint's source fingerprint. They are launch instructions, not
tool-backed proof of a previous command invocation. They are never inherited from
another checkpoint or treated as approval to start a process.

Restart reuses a reviewed launch record or the checkpoint's saved instructions.
Older checkpoints show labelled choices from source-owned server files and direct
`node` start scripts in bounded, nested `package.json` discovery. Detection does
not evaluate shell syntax, runtime flags, environment assignments or npm hooks.
Other JavaScript files remain in **Advanced setup**, with one argument per line
instead of JSON. The normal confirmation hides paths/arguments under technical
details and describes the selected saved preview. It never substitutes a static
server or guesses a missing npm command. The restart adapter still supports only
the Windows Node host; unsupported stacks/platforms fail explicitly.

Launch records bind the original main owner and accepted source fingerprint.
An optional materialized working directory stays within the fingerprinted
checkpoint root; execution never silently changes the source root or saved port.
The launcher explicitly sets `PORT` from the reviewed saved URL, including for
older recipes whose package script only says `node server.mjs`. Technical details
and process receipts show that value. Other environment variables are not inferred
from old worker text; explicit argument vectors remain unchanged.
The native shell permission prompt remains authoritative. After approval, the
packaged launcher rechecks source/executable identity and port availability,
starts an attached session-owned process, and records its exact launch/PID.
Ready requires both owned listener evidence and matching prototype/checkpoint
markers. Changed source, foreign listeners, rejected consent and startup failure
remain visible. Foreground-idle checks govern admission before native dispatch,
not the launch's readiness loop: a shell completion can trigger native background
processing, including after a startup failure. Readiness continues to verify
source/owner/selection and the exact process receipt without mistaking that
notification for competing work. Failed launches retain bounded stderr with
their exit status; cleanup failures do not erase the original startup error.
Closing the owning host stops its own launches; no unrelated
server is terminated. A failed or uncertain attempt can be inspected/reconciled,
not silently replaced with another command.
Saved-evidence rows refresh when their source changes; native conversation records
remain immutable. New design requests retain their exact accepted instruction,
request ID, time and base revision in Stage1's own state, including failed requests.
Older design instruction text that was never persisted is not reconstructed.
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

Operational data lives in `.tandem`, not Git publication. Keep `.tandem/` ignored:
guided Development setup can add a preserving rule after explicit consent, or
the user can add it manually.

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

**Restart Preparation...** lives in Preparation's tab header beside its stage
actions, not global navigation. Its confirmation explains that current upstream
state/files are archived, while Development Design, conversation, application
files, admitted handoffs and the immutable starting choice are retained.
Direct-Development projects without discovery do not offer this reset starter.
An interrupted reset reveals its recovery action in Preparation, with ordinary
work still blocked until recovery is confirmed.

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
Development **Close runtime** or the host's normal **Stop**, then reopen the updated
application in the same workspace. Same-ID recovery retains Conversation,
source handoffs and failure audit while retiring the interrupted request; it
does not retry that role. Wait for **Ready**, then explicitly send a **new**
request referencing the retained handoff, for example:
`Continue Design from retained handoff <id> and its source. Preserve confirmed
decisions and identify mocks. Do not implement.`

An exactly admitted handoff does not repeat the primary submission button.
The public Development projection supplies request-bound
queued, Designer, published Design/questions and retired states; connection loss
makes activity unverified. Polling is not progress evidence.
Verified successful completion is quiet only when its matching Design is visible
and no questions or permissions need attention. The authenticated presentation
bridge gives the visible root control ownership of that exact request's notice;
standalone Development retains its own status.
Uncertain admission offers review before **Reconcile saved handoff**;
pending submission offers a read-only status check. Reconciliation remains
idempotent and cannot revive a retired request. A newly saved Prototype offers a
separate explicit continuation. Do not use unused-setup initialization, delete history, or substitute a
new private identity to retry admitted work. If Close or reopen fails, retain
the reported ownership/history error rather than treating it as success.

### Recover an incomplete first Development startup

New setup checks the actual Git root read-only before reserving native setup.
The guided entry can offer **Set up this folder and continue** for explicit local
Git initialization and a preserving `.tandem/` ignore rule. It never commits,
configures a remote, pushes or untracks saved state. An unborn Git HEAD is
supported. Installation v3 records whether native creation is still
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
After **Ready**, review and confirm the saved Prototype handoff to admit the
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
prepared handoff stays unsent until a separate handoff review and explicit
confirmation. A failed or uncertain repair
cannot reuse its consumed confirmation.

## Project settings and retained history

**Project settings** opens the same window in Preparation, Requirements,
Designs, Prototype and Development. Its isolated settings document reuses the
native renderer for appearance, shared reasoning effort, private model, session
access and diagnostics. Opening it does not start the private runtime or submit
work. Main-session and private Development model/permission ownership remain
independent. Close and Escape return focus to Project settings; closing or
browsing another phase retains the settings document and its unsaved fields.

Before first Development startup, the authenticated main-session catalog supplies
model choices without creating a private session. **Save model for Development**
writes the existing native preferences store, not the main model. The original
private startup path validates and applies the saved model/effort and verifies
native readback before work. Unavailable choices, incompatible effort and
uncertain existing ownership remain explicit errors; a saved preference is not
an actual running model. Once Ready, changes still use the native idle-only
model-switch path.

First startup requires an explicit saved model. The root entry/open controls
read the controller's model-selection preflight and open the same Project
settings window when needed; startup remains a separate explicit action after
saving. The native controller enforces the requirement before installation or
private-session creation. A previously created but unselected private session
uses that same prompt and its original model-switch path, not a replacement
session. Prototype submission still needs its separate handoff review after
model selection.
The settings document reports scoped model readiness only after readback matches
its displayed model/effort. Continue is disabled for unsaved choices, pending or
failed writes, and stale/foreign readiness messages. Each opening gets a fresh
scope; continuation still rechecks the native preflight and cannot resume after
the user closes the window during that check.

The controller exposes a presentation-only startup phase through private runtime
creation/recovery and final model/effort verification. Until it settles, the
renderer shows progress rather than temporary unverified-history or model-error
warnings, and keeps request/retry controls unavailable. Pending permissions remain
actionable. Clearing the phase publishes the actual Ready or failure state; no
error is erased, and this adds no role-completion or execution gate.

The obsolete acceptance, capture, export, delivery, adapter configuration and
linked-intake controls have been removed, not moved into settings. The public
`process_action` canvas action is no longer registered; `/api/process` returns
`410 process_retired` without mutation. Compatibility storage and historical
snapshots, acceptances, Local/GitHub selections, receipts and existing
`tandem-records` exports are preserved. No adapter substitution or publication
occurs during this retirement.

This does not retire the separately reviewed **Create Design from Prototype**
handoff or native implementation confirmation. Design, Conversation and native
results remain the ordinary Development evidence surfaces. The Requirement
ledger still omits empty categories.

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
under `development\tandem`. Never hand-edit the generated extension.

For live frontend editing, run:

```powershell
npm run dev:browser -- --workspace C:\projects\my-app
```

This builds the standalone app, opens it, and watches the Preparation renderer,
browser shell, their frontend dependencies/styles/templates, and Development's
`development\tandem\public` assets. Successful edits refresh connected development
tabs at the same URL. It is a full-page refresh, not React Fast Refresh: unsent
form input and local UI state may be lost, but the existing Copilot runtimes,
pending permissions, saved history, and running work are not restarted.
Frontend compilation errors appear in the terminal; the last successful bundle
stays available until a build succeeds. Development's unbundled public assets are
served directly from source. Backend/runtime code changes require stopping and
restarting the command. Normal browser launches and installed extensions do not
watch these development assets. Stop in the app or Ctrl+C closes the owned host
and watcher. The existing `npm run dev` remains the extension-only build watcher.

```powershell
npm run check
npm test
npm run build
npm --prefix .\development\tandem run build
npm --prefix .\development\tandem test
```

Root checking emits Stage 2 type declarations using its strict configuration
before checking the composition; it does not inline or rewrite its runtime.
`npm run build:browser` and `npm run build:desktop:runtime` stage the same complete
payload. `npm run pack` creates the extension ZIP. Install its complete
`extensions\tandem` directory and matching `skills\tandem\SKILL.md` together
only when explicitly authorized; copying the single generated entrypoint is
insufficient. Large complete payloads may exceed the canvas gist size limits.

The `development/` source folder is distinct from the stable `stage2/` packaged
runtime directory. See [source and distribution paths](../development/README.md#source-and-distribution-paths).
After a fresh build, check the actual composed payload and production renderer
with local deterministic fixtures (no model calls or installation):

```powershell
$env:TANDEM_PACKAGED_EXTENSION = (Resolve-Path .\.github\extensions\tandem\extension.mjs).Path
try {
    node --import tsx --test tests\payload.test.ts tests\project-workspace-browser.test.mjs
} finally {
    Remove-Item Env:TANDEM_PACKAGED_EXTENSION
}
```

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

See [Stage 2 integration](../development/stage1-integration-plan.md) and
[Stage 2 instructions](../development/AGENTS.md) for the composition boundary and invariants.
