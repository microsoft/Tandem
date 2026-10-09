# Human-loop prompt source

Shared user-facing tone uses ordinary words and short concrete statements, leading
with the outcome, impact or needed choice. Internal terminology is reserved for
necessary explanations or requested technical detail. Errors and uncertainty stay
explicit; schemas, exact identifiers and technical code/artifacts are not rewritten.
Concrete shared examples ask "Where should your data be saved?" and distinguish
"Save in a file on this computer" from "Keep it in this browser only", explaining
browser independence and clearing-data consequences only when they match the
proposed Design. Summaries describe changed screens and saving rules rather than
internal storage machinery. Required Change Design/Change implementation prefixes
and technical artifact content remain intact. This is generation guidance, not a
wording validator, a rewrite of saved messages or a guarantee of every model reply.

## Request acceptance and derived state

### Existing-repository Design

Explicit requests to adopt an existing repository or generate its Design from
code route to Designer, not to implementation or a prose-only Agent answer.
The initial Designer inspects relevant project instructions, manifests, source,
tests and documentation through native read tools before authoring artifacts.
It excludes dependency/build output and Tandem's own package/state unless those
are the requested subject, and respects denied reads and content exclusions.

The baseline uses existing visual artifact formats and contextual questions,
distinguishing observed behavior, inferred intent, contradictions and requested
future changes. Paths/symbols appear in existing artifact/summary/question
fields; no new schema or evidence registry is added. Existing code is not
automatically correct or approved. Consequential uncertainty becomes a question;
unavailable evidence is disclosed, never filled in as fact.

Exploration must preserve source, dirty/untracked files and Git history. It
does not run project scripts, install dependencies or initialize a repository.
Normal staging/publication persists the Design and questions, then ends the
role. A separate subsequent request is still required for implementation.
Answers use the same Router path, and later revisions preserve canonical Design
and stable IDs rather than automatically regenerating from code drift.

This is role guidance on the existing workflow, not a new onboarding phase,
automatic startup scan or extra native-tool permission layer. Prompt checks
and scripted runtime regressions verify instruction delivery and lifecycle
contracts; they do not prove a model's reconstruction accuracy on real projects.

### Request processing

The complete ledger remains authoritative. A store reconstructs its derived state
on first read or authoritative document change, then applies each validated local
transition incrementally. The cached projection is bound to the exact document,
published only after the existing Host transaction commits, and never returned
by reference. Failed writes, outer transaction rollback, conflicting retries and
corrupt replacement documents do not become successful state. No WAL format,
history pruning, new persistent cache or background polling is introduced.
An exact retry of a historical option-answer envelope may omit derived option
wording. The store compares both envelopes against the same retained canonical
question while preserving the original ledger bytes. Changed text, timestamps,
answer choices or forged option metadata still conflict; request ID alone never
authorizes reuse.

Ordinary text admission does not read Design state in the HTTP adapter or fetch
the authenticated model catalog. Startup and model selection still validate
availability; every Send still checks pending model intent and the actual native
model against the saved selection. Image capabilities and source-bound annotation
checks remain on their existing paths.

The composer updates its small sending control immediately without rebuilding
the whole view. Only HTTP 202 with the exact request identity confirms receipt.
That confirmation clears the submitted draft and unlocks editing without waiting
for a full status refresh. A lost or mismatched acknowledgement preserves the
exact retry envelope; no optimistic receipt, generated replacement request or
early model-completion claim is made.

## Private model selection

An SDK session may initially have no authoritative `modelId`. Settings retains
the authenticated model list so an idle session can explicitly select a model;
it never substitutes a default or infers image capability. Apply must confirm
the selected ID through native readback before saving the preference. An unknown
actual model cannot be accepted as verified, and images remain blocked until
the actual model and its image limits are positively identified.

## Product identity

The current shell and canvas display name are **Tandem**, with the exact slogan
“two minds, one direction.” The supplied bicycle image is retained byte-for-byte
as `public/branding/tandem-original.jpg` and used as the browser favicon.
The original margin-only `tandem-mark.png` is retained. The header uses
`tandem-mark-transparent.png`, reproducibly derived with
`node tandem/scripts/prepare-branding.mjs`: crop empty margins to 472 by 192
at (28, 160), remove the near-white JPEG matte, and preserve the colored frame,
navy outlines and wheel spokes. A subtle contour shadow separates the navy ink
from dark backgrounds without a rectangular badge. Name and exact slogan form
one compact lockup; project context remains separate and truncates with its
existing full-goal tooltip.
The installed SDK's canvas declaration has no icon field, so the icon is exposed
through the supported browser/header surfaces only. The active extension and
canvas ID are `tandem`. Internal `.tandem/living-canvas` state paths and
persisted workflow schemas remain unchanged; historical receipts keep their
original identities.

## Background process control

Every displayed background-process row retains **Stop process**. It is disabled
for terminal tasks, disconnected/closed sessions, retired or unowned handles,
and while that row's stop request is pending. Foreground role activity is not
a disabling condition.

This is direct exact-task host cancellation (`session.rpc.tasks.list/cancel`),
not a Router/Designer/Implementer operation or foreground workflow Stop. It does
not pause the role, discard queued requests or grant new tool permissions.
Confirmed completed/failed tasks retain their reported outcome; cancellation
errors are shown for the process without changing workflow execution status.
Existing Close and ownership checks remain in force; historical handles are
never adopted and OS PIDs are not used for cancellation.

The agent owns application consequences, including an expected connection error
after a server is stopped. Tandem neither auto-restarts the process nor prohibits
the agent from restarting it through ordinary authorized tools and permissions.

## History navigation

Hover and keyboard-focus tooltips show the event title, original timestamp
formatted as local date/time, and recorded details. Rendering never substitutes
the current time or changes the canonical event timestamp.

Consecutive routine automatic approvals, successful native tool updates and
nonterminal task-progress updates share a counted icon only when their original
event metadata positively binds the same semantic type/tool, private session,
request, role and task. Manual decisions, permission requests/denials, failures,
questions, role changes and actual process/workflow completion remain individual.
An intervening event breaks grouping; icons or summary text never establish identity.
Legacy events without exact provenance remain individual. No stored events are
merged, deleted or backfilled.

Grouped hover/focus details show the count, original first-to-last local date/time
range and latest detail. The count button opens keyboard-accessible individual
event details, including each original timestamp and source identity, without
changing the icon's existing message navigation. Counts reflect only actual
entries in the retained window, not timers or evidence of completed work.
This presentation change does not accelerate native searches or permission processing.

The Conversation's request-bound workflow card does not repeat the global queue.
Each waiting request keeps its own message and queue status; queued work alone
does not create a workflow card under another request. Queue order, answer
priority, active roles and request-specific progress remain backend projections.

State-history selection never opens a historical header panel. A transition
with an exact persisted handoff message jumps to and briefly highlights that
Conversation entry. Other events retain selection and expose their recorded
explanation in the transient hover/focus tooltip, with bounded scrollable text and
keyboard access. They do not jump to a nearby or latest message. Late message arrival updates an exact
link without reopening a popup or moving Conversation automatically. Current
status and actionable questions/permissions remain separate and unchanged.

“Your request” marks each retained request's exact receipt time and ID, including
queued, batched and image-only input. It links only to that request's persisted
Conversation entry. Receipt markers precede workflow events at equal timestamps;
the combined rail retains the latest 500 items. These are projections of existing
requests, not new workflow states or invented user/Router messages.
If the receipt clock is ahead of a bound role event, initiation still precedes
that role in the rail without changing the displayed stored receipt time.

## Role and permission boundaries

Reviewer inspects Design, code, cycle and existing process evidence without
editing, running commands or launching, serving or stopping applications.
Its native tool admission allows file reads/searches, existing process output/listing,
and bounded read-only Review scopes. Children have only file reads/searches;
neither children nor other native agents can publish canonical Review results.
Implementer owns actual-software self-testing, not Reviewer. Other roles retain
their ordinary native capabilities under normal Copilot permissions and content
exclusions. Explicit eligible session-wide grants survive transitions in the same
native session; once-only grants remain invocation-only, including child reads.
No role transition resets grants or upgrades a prior approval. Selected
internal tasks and Host plan acceptance govern Tandem domain operations, not
ordinary native-tool admission.

Native `view`, `rg` and `glob` retain the agent's exact arguments and the native
host's selection semantics, including directory scopes and empty results. Tandem
does not enumerate snapshot files, expand search roots into file lists, rewrite
glob patterns, add hidden exclusions or impose result-count limits. Native
callbacks still require their exact current tool/task/session attribution and
normal user permission. Native path eligibility does not use snapshot inventory
exclusions, portable naming rules or alias restrictions: dependency files, Git
metadata, directories, native-valid names/links and paths outside the project
remain subject to the native host's permissions, not a Tandem filesystem sandbox.
Original arguments are unchanged. Native tools own patch grammar, target selection,
existence checks and execution outcomes. Tandem does not repeat these checks or
recertify the root index around native file access, including descendant callbacks.
Native permissions and content exclusions still apply. Canonical Design, accepted
task/result and index publication validate their own records at their domain
boundaries; native file access is not a canonical publication.

Private runtime admission does not observe the main session's mode, processing,
activity or queue. The joined identity still binds attachment and routing; actual
private execution still requires its own supported Interactive, activity and queue
APIs. Main idle does not start or wake private work.

Private startup sets `TANDEM_PRIVATE_WORKFLOW_SESSION` to the exact private ID.
In that environment Tandem registers only its native workflow and permission-gated
collector tool, not its canvas,
browser tool, audit observer or another private runtime. Create and same-ID resume
temporarily request extensions with the installed SDK path, wait for the native
Tandem provider to be running with its collector in the native tool catalog, then resume the same ID with
`requestExtensions: false` and `continuePendingWork: false`. Registration survives that resident
opt-out, and the collector's availability is checked again. The bounded startup wait does not mistake an initial `failed` inventory
snapshot for a final launch outcome. Full restart registers a fresh provider;
it never resumes old workflow runs. Repository configuration discovery, native
permissions and content exclusions remain enabled. No global extension preference
or permission grant is changed, and no explicit extension reload is requested.

Idle model changes, explicit compaction and approval reset do not require answers
to open questions or completion of plans/cycles. They preserve those records,
pending answers and model intent. Ordinary requests blocked by an unanswered
prerequisite do not prevent these idle actions: the existing request-admission
predicate determines whether work can run. Dispatchable requests, queued answer
reconciliation, actual native activity/queues, Stop, closing, unsettled effects and
conflicting model operations remain ineligible. Existing admission serialization
and model/compaction flags protect concurrent sends. No Settings action answers
questions, changes queued requests or advances the workflow. The reset button uses
the private idle capability rather than the workflow's business label.

Opening/reopening discovers the currently selected installed SDK, CLI and Node.
Compatible path/byte changes update the existing configuration atomically, retaining
prior configurations as audit. Old close receipts remain bound to their original
configuration, not rewritten. Required native capabilities and current ownership
are still checked; no runtime is downloaded or substituted.

Failed startup offers explicit retry, never an automatic retry loop. Only the
current failed attempt is released, using current native activity/queue/task state
and SDK disconnect/stop. Historical executions and Running labels do not block
release. Current work, unavailable observations or unconfirmed cleanup remain
visible and prevent replacement. Recovery keeps the same owner/session IDs and
never sends or replays requests. Only a first creation with no retained work and
an authoritative native not-found result may create that same missing ID.

The browser tool and the canvas `open_browser` action share a separately owned
browser provider. Its URL survives closing a canvas panel; canvas-only servers
still close with their panels. The owning main session's user-exit hook closes
both kinds of server. Ordinary turn completion does not close the browser.
Closing a provider stops accepting connections and releases its own HTTP/SSE
connections, including an unfinished status read or reload. It does not cancel
native work or wait for browser reconnects; later URL requests cannot resurrect
the released browser owner.

The existing Return to current history action occupies a reserved normal-flow
row below the conversation/history area in the Tandem shell. Its narrow-label
wrapping must not collapse the scrollable marker area or cover marker hit targets.
The label, callback, keyboard action and adjacent-only event grouping are unchanged.

Snapshot/review enumeration and its exclusions remain separate and unchanged.
Native access does not add dependencies or Git data to evidence. An entry allowed
by native tools can still be unrepresentable in a later snapshot. Router,
Designer and Agent carry explicit null code evidence rather than capture the
whole workspace. Planning reuses the actual cycle baseline; Implementer and
Reviewer still capture the evidence their work needs. Historical non-null
bindings remain readable and cannot be discarded at settlement.

Native command text is not a mutation classifier: mentioning Git, dependency
trees or Tandem filenames does not veto a command. Normal permissions still
apply and protected index checks remain; this is not an OS command sandbox.
Optional/reused shell labels and native-valid detached arguments pass through
unchanged. Native host authorization governs detach; Tandem never requests it
automatically. The journal identifies invocations by native tool-call ID, not
the caller's label. Missing journal attribution does not restrict current native
task controls. Requested detached work remains native-owned.
Program-output text is never parsed into control authority. Structured native
exits can supply runtime-assigned handles and terminal evidence. A successful
Stop tool invocation alone does not prove a stopped process. The native
`stop_powershell` completed-stop response does; native `tasks.cancel` returning
`cancelled: true` also confirms cancellation without a second terminal row.
Generic success, "requested" responses and registry absence do not imply exit.
Controls target the current private session, task ID and native start identity
because native labels can be reused. Command text, invocation time windows and
audit digests are not additional cancellation certificates. Detached cancellation
is not qualified.

Retained command entries and exact output-event hashes are evidence, not
lifetime execution quotas. The process view retains unresolved rows plus a
bounded recent settled window; cycle evidence and journals remain complete.
This does not claim that total retained session evidence has bounded size.

Known preparation failure before native dispatch rejects only that request
batch, retains not-sent tasks and prior evidence, and reopens unresolved saved
answers for retry. If Stop already completed, its status remains authoritative
and the late preparation failure is recorded without blocking later work.
An actual native Close failure remains explicit and unconfirmed; it is not restored
to Ready merely because shutdown failed. Send acknowledgement uncertainty and failures after irreversible effects remain
distinct. A secondary persistence error preserves the primary diagnostic;
neither is represented as successful completion.

A native directory-level permission may cover descendants without separate
per-file callbacks. Tandem does not claim descendant read exclusions in that
case; native permissions/content exclusions govern actual selection. Removing
Tandem's rewriting does not prove elimination of native per-path callbacks or a
measured performance improvement.

Permission cards show requested command arguments and working directory.
Individual **Allow once / Deny** remain available. The additional once button
approves exactly the displayed captured pending IDs; later arrivals are excluded
and withdrawn requests are reported rather than counted as approved.
Session access reuses the broker's private-session all-grant: eligible native
callbacks still receive `approve-once`, native mode stays manual, and managed
policy/ownership/path checks still apply. Native per-tool grants are unavailable.
**Off** revokes the broad grant without denying pending requests or cancelling
authorized work. Separate custom per-tool approval reset still requires verified
Ready. Close/reopen and new private identities do not inherit these grants.

## Normal Copilot setup and main chat

The private session enables the installed SDK's supported configuration
discovery and no longer uses an eight-tool catalog allowlist. Explicit native
settings still take precedence. Tandem does not replace the SDK system prompt,
copy plugin directories or install integrations. Discovery is not a promise to
clone transient tools injected by the main app; plugin opt-ins and other
SDK-specific discovery settings remain native-owned.

Registered SDK callbacks and SDK-tagged descendant events retain normal native
permission decisions. Descendant calls cannot finalize Tandem domain results or
become root input, Conversation, role-end or completion evidence. Hook arguments
correlate an already SDK-observed call; names or arguments do not establish
ancestry. No native permission is synthesized or bypassed.

Main chat remains independent, including questions while Tandem is busy or has
unanswered questions. Main observations only preserve exact text/timestamps
without a request ID. Main idle may wake existing eligible Tandem work; it never
turns a main-chat message into a Router request. Tandem composer and Questions
remain the source-bound admission surfaces.

## Asynchronous questions and retained diagnostics

This preview uses fresh `human-loop/v2` / `human-loop-ledger/v2` workspaces.
Incompatible saved ledgers are explicitly rejected, not converted. Questions
retain their original compound result/question identity and remain answerable
after newer results, Stop, Close or verified recovery. Answer requests atomically
save the original selected wording/context and answered bookkeeping; processing
status is separate. Corrections are new contextual requests, not overwrites.

Only effective prerequisites gate ordinary input. Answers addressing them take
FIFO priority as intact separate envelopes; pending answer processing retains
the gate. Router receives `pendingQuestionAnswers` so saved answers in other
requests are not mistaken for completed processing or merged into this request.
Stop and verified Close release question gates, not questions or saved answers.
Restart recovery releases retired-work gates after current-session readiness and
canonical retirement; it does not certify historical execution. No old plan
automatically resumes.

The Conversation Questions control shows unanswered/effective-blocker counts and
source-grouped forms. Exact-source in-memory drafts, focus and retry identity
survive projection updates; drafts are not persisted across browser reload.
Blocking and advisory meaning have distinct labels/colors, independent of saved
answer processing status.

Automatic native shell-output reads retain exact notification, empty assistant
request, start and completion ancestry. Attribution to a Tandem invocation also
requires a tracked live shell. The current-generation journal retains the exact root completion
notification ID and digest, matching the private session, unique shell and exit.
Notification parents may be intervening SDK hooks or usage events, not the
original role's turn start. This does not restore old role authority. Pending reads
remain visible for idle Settings checks, but cannot veto a submitted role result,
successor dispatch, Stop or Close. These reads do not create
model admissions, permissions or role-completion authority. A missing, historical or
reused-label binding is explicitly unbound: the observation cannot settle or
control an invocation, but does not poison independently established root
continuation/completion or manufacture a recovery action. Conflicting exact
receipts and malformed root call chains remain integrity failures.
Failed commands with known exits and safely denied
pre-dispatch callbacks are not execution-unknown. Genuine missing/conflicting
ownership or durable-application errors remain explicit.
Already-observed owned exit notifications settle even if a later event fails.

Native command labels remain optional and reusable; ordinary native read/list/stop
calls pass through unchanged even without a Tandem journal handle. Native
permissions still decide access. For a new attached launch, Tandem may bind its
audit context using pre/post `session.rpc.tasks.list()` observations: one new
native task identity matching the command, without a competing matching launch.
New records retain the native start identity; old observation-digest records
remain readable. This association is not a prerequisite for process controls:
the process projection reads the current native catalog, including unattributed
background tasks. Historical cards cannot target a later task with a reused ID.
Absent current tasks remain unconfirmed history unless an actual native outcome
was received; absent fields do not permanently unbind a known handle.
Read/list/stop settlement and process snapshots refresh current native status.
Terminal registry facts settle associated audit entries without inventing exit
codes. Program stdout is never a handle or control-metadata source.
One shared in-flight catalog observation serves these boundaries; there are no
polling loops or observation timers. Pending observations explicitly label the
last native observation; rejection retains Unconfirmed rows and a diagnostic.
Catalog reads do not block snapshots, ordinary native admission or settlement,
Ready, or roles without native commands. Explicit cancellation alone checks its
current native target as part of that operation. Late observation can add audit
attribution, but cannot release a role or become a new control prerequisite.

The isolated native lifecycle harness initializes offered tools using documented
`session.rpc.tools.initializeAndValidate()` before `tools.execute`; no model turn
is needed. Native stop removes its registry row, whereas task cancellation may
retain a cancelled row. Both use their own explicit native outcome, not inferred
process completion from disappearance.

A synchronous command that rolls into native background waiting retains its
original role and interaction through the agent's end-and-wait response. Process
completion is not a typed role result. A new native turn in that same interaction
resumes the outstanding wait without redispatch; foreign sessions/interactions,
reused turn identities and conflicting events still fail ownership checks.
An unresolved control binding does not manufacture a missing-result failure or
prevent normal native reads. Explicit Stop uses its native operation outcome;
actual typed results complete their role without waiting for native task settlement.
This corrects new work only: recovery does not rewrite
old failures or infer fresh control authority from historical handles.

Missing-result handling is exception recovery, not a completion boundary.
`assistant.idle` can occur while native background work remains pending and does
not trigger it. If native `session.idle` belongs to the active input and no valid
terminal result was submitted, the Host retains a notice and sends one
continuation with explicit native `mode: "immediate"` and
`agentMode: "interactive"` in the same session with the same role/request/task packet. It
preserves completed work, grants and source bindings; it neither readmits the
workflow nor replays implementation. Duplicate or delayed idle events from the
earlier input cannot exhaust that attempt. A second session-idle event belonging
to the continuation, still without a result, produces an explicit missing-result
error. Reviewer failure remains advisory, not approval. Actual dispatch or
runtime errors remain explicit. A valid result is authoritative immediately;
Stop and Close suppress the continuation. Recovery never automatically resends
this notice or resumes a retired role.

Close attempts the owned SDK shutdown even during work or when local preparation,
state reading, explicit native save or history inspection fails. Native save is
requested without making its acknowledgement a prerequisite for shutdown.
The `human-loop-close/v2` receipt separately records confirmed native shutdown,
whether explicit save was confirmed, and warnings. It is not a resumability
certificate. Native shutdown errors remain errors; a local recording error after
successful native shutdown is reported as such, not as a failed native Close.
Available Conversation, Design and working files remain retained.

The saved native journal is read during same-ID recovery, not as a shutdown veto.
Legacy v1 close receipts and ledger commands remain readable; their comparison
helpers do not gate current Close or reopen. No new history normalization,
completed-child teardown certification or fallback runtime is introduced.
Ready means the current correctly owned runtime can accept **new** work, not that
past execution or history equivalence has been certified. Historical failures,
missing admission, unavailable history and conflicting visible messages become retained
Conversation diagnostics. Existing exact Conversation messages, Design, failures
and audit records are preserved; conflicting SDK projections never replace them.
The existing canonical `recover` event archives uncertainty and retires interrupted
workflow/control ownership. No old work is replayed, old process exit inferred or
clean-close proof synthesized. Historical native event identities are retired;
new live events still require current ownership.

Restart still checks the original session identity, actual current mode/activity,
an empty current native queue and writable/parseable owned state. It never clears
the native queue to manufacture readiness. Current reported native work remains
a blocker; stale journal Running labels and unavailable historical process outcomes
are not evidence of current work and do not require OS exit proof. Native access
permissions are renewed through the existing reset path without widening grants.
Recovery diagnostics do not expose reasoning or tool bodies.
`read_cycle_file` advertises the configured excerpt maximum and supports omission
for the bounded default, followed by `nextOffset` pagination. Oversized reads are
rejected before immutable snapshot evidence is read.

Each transition into execution-unknown atomically appends one inspectable
Conversation status diagnostic using the existing WAL-backed `human-loop/conversation.json`
logical document. It contains the bounded reason, timestamp, source and available
session/request/role/task/event/call identities, not prompts or tool bodies.
Exact retries do not duplicate it. If durable recording also fails, the original
cause is retained and the existing runtime stderr warning channel reports that
additional failure; a successful durable log is not claimed.

Review the active human-loop's static model-facing instructions in
[`tandem/public/prompts/human-loop.json`](../tandem/public/prompts/human-loop.json).
This is the single editable **non-JavaScript prompt source**, not a new workflow,
system-prompt override, or prompt optimization.

Its `human-loop-prompts/v1` sections retain their existing structure and order:

| Section | Production consumer |
| --- | --- |
| `wrapper` | `tandem/src/human-loop-transport.mjs` sends these lines, then the unchanged serialized task packet, joined by newlines |
| `shared` | `tandem/src/human-loop-runtime.mjs` prepends these context instructions |
| `roles` | Router, Designer, Planner, Implementer (`task` and `aggregate`), Reviewer, Agent context instructions |
| `reviewScope` | Native read-only `tandem-review-scope` child instructions; not another workflow role |
| `sketchRules` | `tandem/public/sketch/contract.js` shared document generation rules |
| `designRules` | `tandem/public/sketch/design-contract.js` collection generation rules, appended after `sketchRules` |

The browser-safe `public/prompts/human-loop.js` loader uses native JSON import
attributes (`with { type: "json" }`) in both Node and the browser. It validates
the version, exact required object keys, and bounded nonempty string arrays,
then deeply freezes the data without trimming or rewriting any text.
Unknown/missing sections, malformed JSON, and a missing asset fail at module
load; there is no fallback, fetch/Node-filesystem branch, or Node dependency in
the browser loader. The provider already serves `.json` as `application/json`;
the package builder already copies public assets and resolves JSON imports.

## Scope boundaries

The shell's Settings disclosure contains the Diagnostics entry, labeled for
runtime troubleshooting and owned-preview management. Opening it closes
Settings and focuses the existing diagnostics panel; Escape returns focus to
Settings. Refresh and owned-preview controls are unchanged. Close is available
for an owned runtime during work as well as at idle.
Normal workflow errors, permissions and initialization/reopen controls remain
outside Settings.

Rendering debugger is also in Settings. It opens the packaged, local JSON
validator/preview in a dialog, not a Host Browser canvas or popup. Close or
Escape returns focus to its Settings button; closing preserves debugger input
and unsent conversation drafts. It never submits a workflow request.
The shared Design summary and Goal/outcomes disclosure precede artifact tabs.
The existing CURRENT rail card owns View current and meaningful status reasons,
without a second conversation banner. Only truly empty workflow shells are
hidden; Latest result content and all persisted conversation identities remain
unchanged.

Designer must produce applicable candidate purposes by default: user
journey/storyboard, key screen/interaction designs, workflow/state transitions,
contracts/data relationships, and system responsibilities. Omissions need a
strong project-specific reason stated briefly in the existing Designer summary.
A journey shows ordered actions, system responses, observable outcomes and
relevant failure/retry paths; screen galleries, responsive variants and prose
alone are not substitutes. One artifact may genuinely cover multiple purposes.
Non-GUI or no-persistence projects justify inapplicable coverage rather than
inventing it. These are authoring instructions, not new schemas, runtime gates,
quotas, required tabs or mandatory separate files.

Both the Designer role/design-generation prompts and the shared artifact rules
use the [content-specific recommended artifact mapping](supported-artifact-formats.md#documentdata-branch):
HTML storyboards for user stories, HTML mockups for UI, Mermaid workflow/state/sequence
diagrams for workflows, sequence exchanges or HTML decision tables for behavioral
contracts/rules, ER/class diagrams or precise JSON Schema/OpenAPI for data
contracts, and grouped Mermaid system architecture. Markdown is recommended for
brief optional secondary notes, not primary business contracts. These are
defaults, not mandatory formats or counts; SVG custom visuals and clearer
HTML/SVG alternatives remain available. No HTTP API or persistence is invented
to fill a view. Existing Markdown acceptance and note relationships are unchanged.
Prompt regressions check this guidance, not the quality of actual model output.

Supporting Markdown notes are optional to author and optional for the user to
read; no note-review gate is introduced. The visual artifact must stand on its
own and carry all essential behavior, decisions and outcomes. Notes must be
brief. Keep them concise and
limited to essential clarification or rationale not already visible in the
primary artifact; do not duplicate visuals or bury approval-critical behavior
in prose. There is no word-count rejection gate. Markdown `noteForArtifactId`
targets an existing artifact of any supported format in the same Design;
missing targets, self-references, note cycles and conflicting associations are
rejected. Existing `visualCompanionId` still targets `artifact/v1` without
rewriting historical source. Notes open through a Notes button on their primary
artifact and do not compete as top-level tabs; exact note references can still
open the source-bound note directly. The Implementer's actual-software journey verification
instruction remains unchanged.

The canonical **agreed Design**, including its outcomes and contracts at the
exact bound revision/digest, is the product acceptance authority. Planner
plans, tasks and criteria are complete, Design-derived execution aids, not a
second approval contract. Host plan acceptance coordinates execution; it does
not establish an independent definition of product success.

Implementer aggregation and Reviewer evaluation inspect the complete actual
implementation against that Design. Implementer supplies its execution evidence;
Reviewer does not repeat a criterion-by-criterion correctness audit. Requirements
omitted from a plan remain requirements.
Finishing all tasks alone is not success; extra files or task variation alone
are not defects. Purely internal technical choices do not require user
decisions. Genuine product mismatches or unresolved product choices still use
the contextual question mechanism. If no agreed Design exists, Review reports
the acceptance-evidence limitation rather than treating the plan as a substitute.

New Whole Reviews use `decision-review/v2`, empty criterion assessments, and
exactly two responsibilities: complete agreed-Design conformance and material
over-engineering. Conformance includes the backbone, state machine, authoritative
state, ownership, contracts and interactions, not just stories or finished tasks.
Over-engineering includes excess scope, responsibility, restrictions, automation,
abstractions or interacting machinery, premature infrastructure without a strong
backbone, and taking over another actor's or the native platform's responsibilities.
"Safe", "robust" and "future-proof" are not blanket authorization. Ordinary
unspecified implementation details and necessary safeguards are not automatically
findings. General bug hunting, test-coverage auditing and correctness verification
are not a third responsibility. Incidental limitations remain separate disclosures.

One externally sequential Reviewer may work directly or divide actual implementation
and Design into useful complementary scopes, including cross-component interactions.
Every child applies both goals to the same producing Design and evidence, and may
inspect dependencies. The native `tandem-review-scopes` workflow calls
`ctx.parallel`/`ctx.agent` with `tandem-review-scope` and a declared
`maxConcurrentSubagents: 3`. More than three total scopes are allowed; unique
labels keep independent scopes distinct from native memoization. The parent uses
`tandem_collect_review_scopes`, retaining native tool consent. Its provider awaits
`session.workflow.run` with completion notifications disabled, unlike the background
`run_dynamic_workflow` tool. No automatic parent turn or second queue is introduced.
Host admission binds the exact current
task packet and native tool-call ID and rejects limit overrides, old-run resume
and overlapping workflow groups. Three is neither a mandatory split nor a
file-count partition. Children cannot nest delegation. There is no custom
scheduler, pool, retry loop, model override or additional persisted child store.
The parent collects results,
resolves overlaps and contradictions, and publishes one report without repeating
every child inspection.

The native child pre-tool hook can precede delivery of its tool-start event.
Admission therefore requires its already observed running child identity, current
owned Reviewer and read-only tool. The subsequent permission callback still needs
the exact native tool-call identity and ordinary permission. Child events cannot
finish the root role. Workflow envelopes and returned scope identities are checked
against their admitted parent binding; missing evidence is unavailable coverage.
Immediate Stop cancels the owned workflow as well as interrupting the foreground.
Accepted parent results remain the sole completion authority, even with pending
children; release withdraws their authority and requests native cancellation
without adding a settlement gate.

Reports state coverage as complete, partial or unavailable. Failed scopes add
visible scope/reason/unreviewed-coverage warnings, preserving supported findings.
All failed scopes mean substantive review unavailable, never approval or "no
findings". A safely ended parent Reviewer without a result, or proven-unsent Review
preparation failure, concludes the attempt with `review-incomplete`, preserving
implementation and recorded findings. Normal later authorized requests may proceed
without mandatory successful review retry. This is not a fabricated successful
Review: native unavailability, uncertain execution, store failures and explicit
Stop retain their boundaries. Genuine unresolved decisions still use the existing
question mechanism; no automatic repair, Design change or silent acceptance occurs.

Legacy reports retain their original categories, assessments and exact stored
text. Current empty decision sections never imply verification; unavailable
coverage says "Not reviewed". This guidance and enforcement are regression-tested,
not a guarantee of future model judgments.

Each substantiated decision cites concrete implementation evidence, the present
requirement or responsibility boundary, material impact, and a supported simpler
alternative when available. Its canonical
question is bound to the producing result, Design revision/digest, work cycle
and plan. Options explicitly state `Change Design - <specific effect>` or
`Change implementation - <specific effect>`; unsupported alternatives are not
invented. New answers durably retain the canonical option wording, implication
and target. Freeform remains exact user text. Router receives that context and
remains the sole interpreter: no label-based or hidden direct dispatch.
A Design-only resolution ends at the normal visible Designer handoff and needs a
distinct later implementation request. Mixed explicit Change Design / Change
implementation answers go to Designer first; after publication and settlement
of blocking questions the Host offers a separate implementation confirmation
against the published revision. Planner and Implementer receive the exact saved
questions, selected labels, implications and target through current and historical
answer context. They must not drop the implementation choices at that handoff.
Historical answers are reference, not authority to override current Design.
This reference includes the current request and completed/cancelled request
history, not queued, rejected or interrupted answer envelopes. Those envelopes
remain in the durable audit without becoming instructions for the current work.

Every new implementation/resume/replan proposal waits for **Plan and implement**,
**Update Design instead**, or **Cancel** before baseline capture or Planner.
This durable user decision is independent of permissions and Host plan acceptance.
Cancel adds a Host status, not an invented user message or model turn. It does not
reject the idea or authorize Design changes. Pending confirmations survive reload
and same-session reopen; Stop invalidates them, while recovery retires interrupted
approved work. Changed Design requires fresh approval. Historical reports and
answer envelopes remain readable without retroactive reclassification.

For accepted internal Implementer tasks, `task.scope` is a Planner forecast,
not a file authorization allowlist. Necessary additional project source and
generated application data are retained in the full before/after evidence and
whole-plan Review. A forecast mismatch alone does not fence tools, reject a
typed result, trigger recovery, or ask the user for approval.

The serialized scope field and its existing path validation/digests remain
unchanged for old plans and replay. Canonical domain workspace/record validation,
session ownership, native permissions/content exclusions, domain-tool role
contracts, native completion and Stop remain independent boundaries. Patch
validation belongs to the native tool. Ordinary project edits are not monitored or
attributed to a role and do not freeze tools, settlement, continuation or reopen.
Implementer rereads a file after a stale-preimage rejection instead of blindly
retrying. This is ordinary optimistic editing, not an atomic compare-and-swap
guarantee against arbitrary editors. Whole-plan Review considers actual changed
files against the requested behavior and Design, without claiming authorship.

Snapshots are immutable observations for task/checkpoint/Review evidence, not
workspace leases. Conversational roles explicitly omit code snapshots; cycle
roles retain their required observations. Settlement does not assert that
ordinary project files remained unchanged. Implementer settlement captures its
resulting disk state, and Review starts with fresh evidence. Read tools no longer
recapture the entire workspace before and after every call. Read-only role
guidance is not enforced by blocking native file or command tools, including
at settlement. Own-record and index integrity still apply. Native commands in
every role require normal permission and are not an OS sandbox. A project diff
alone is not evidence of which process wrote it.

This moves static role instructions and generation prose, **not every string
visible to a model**. Machine contracts stay beside the code that enforces them:

- `tandem/runtime-src/domain/human-loop/tool-contracts.ts`: result/progress
  tool names, descriptions, role membership, and parameter schemas.
- `tandem/src/human-loop-runtime.mjs`: executable workspace tool definitions,
  authorization checks, tool responses, and failure messages.
- `tandem/src/human-loop-design.mjs`: `stage_human_design` tool description,
  schema, and staging feedback.
- `tandem/src/human-loop-transport.mjs`: tool registration/policy enforcement,
  dynamic digest feedback, execution/permission errors, and native lifecycle.
- `tandem/public/sketch/contract.js` and `design-contract.js`: structural
  schemas (including schema descriptions), validation, reference checks, and
  validation errors. Layout diagnostics remain in the sketch renderer modules.
- Domain validation and error prose remain in
  `tandem/runtime-src/domain/human-loop` and `domain/workflow`.

The domain tool schemas do **not** import the public prompt source; extracting
them would invert the dependency direction. Dynamic user messages, question
answers, Design data, template documents, code evidence, packet serialization,
and input digests are not authored prompt prose.

Installation inspection on 2026-09-16 found the running project discovery shim
at `.github/extensions/living-canvas/extension.mjs`. The current checkout shim
is `.github/extensions/tandem/extension.mjs` and imports `tandem/src/extension.mjs`.
The active human-loop installation/transport
does not configure a standalone model system prompt or `systemMessage`.
The SDK's own foundational system instructions remain SDK-owned. No new
system prompt or injection was introduced by the extraction. The former
`cooperativeStop` section is retired; legacy prompt files may still retain it.
Later format, answer-authorization and Design-authority guidance deliberately
changes the affected new role packets and their input digests; it does not
rewrite historical packets, plan fields, scope serialization or stored digests.
Legacy standalone-host prompts and historical
plugin prompts are outside this active human-loop extraction.

## Equivalence evidence

`tandem/test/fixtures/human-loop-prompts.before.json` is immutable historical
test evidence, **not another editable prompt source**. It was captured from the
four original production files before extraction, with their SHA-256 digests.
It contains exact complete wrapper-plus-packet strings and input digests.
Do not regenerate this baseline from the extracted JSON.

`human-loop-prompts.test.mjs` isolates the production private `#context` method
using the existing TypeScript AST dependency, without exposing a production API.
It tests all six roles, both Implementer branches, bound/unbound Design and
cycle contexts, and Designer custom-generation selection. Each case also goes
through real transport send assembly using an SDK-shaped local fixture.
It checks exact text/order, serialized context/packet, and input digest.
The intentional Planner/Implementer/Reviewer instruction changes are narrowly
enumerated: unchanged instruction positions retain byte-equality assertions,
while changed positions have explicit Design-authority/completeness assertions.
Router/Designer exceptions from earlier changes remain separate. Wrapper,
safety instructions, exact references, role permissions, native completion and
Stop behavior are not altered by this acceptance guidance.

## Role completion and Stop ownership

A valid current-role/request terminal result submission is the normal completion
authority. Tandem saves it, records actual code evidence, applies canonical
effects once, and sends the next authorized role with explicit native
`mode: "immediate"` and `agentMode: "interactive"`. Attached background work must
not strand successors in native enqueue. Tandem's durable request queue and
one-role ownership are unchanged; native scheduling remains runtime-owned.
Pending tools, permissions or child scopes, missing tool-return events, turn-end,
idle and quiescence are not additional completion requirements. No synthetic
native end or automatic result-bound interruption is generated. Role/request
identity, schema validation, duplicate rejection, actual persistence and explicit
Stop boundaries still apply. Native execution and cleanup belong to the runtime.

After-step Stop prevents successors at the accepted role result, without another
steering message or acknowledgement tool. Immediate Stop fences late publication
and calls `interruptMainTurn({ flushQueued: true })`. Its actual `interrupted`
boolean is retained: false is not relabelled as a successful interruption.
Native errors remain explicit. The native response is recorded before fallible
local snapshots; failures saving intent or recording local effects are disclosed
separately and do not veto attempting native Stop. Stop does not fabricate a
role result or mark unfinished implementation complete.

Permission and read-only checks, together with the native workflow's three-worker limit,
remain independent policies. They cannot reject a valid parent terminal result
because low-level task records are still pending. A report with unfinished or
failed scopes discloses unavailable coverage rather than implying approval.
Historical cooperative Stop records and partial reports remain readable; new
work does not register or send the retired acknowledgement protocol.

Native Node and installed Edge tests cover JSON import success, strict
validation, freezing, missing/malformed assets, and browser MIME rejection.
The full Designer debugger consumes the same JSON-backed rules. The targeted
`packages native JSON prompt` package fixture proves byte-preserving asset
collection and relocatable import closure, including missing-asset rejection;
it does not create a persistent release candidate.

Focused checks:

```powershell
node --test tandem\test\human-loop-prompts.test.mjs
node --test tandem\test\sketch-contract.test.mjs tandem\test\sketch-v2-contract.test.mjs tandem\test\shared-design-contract.test.mjs tandem\test\sketch-debugger.test.mjs tandem\test\human-loop-transport.test.mjs
node --test --test-name-pattern="packages native JSON prompt" tandem\test\package-extension.test.mjs
```
