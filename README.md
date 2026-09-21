# Tandem

Tandem is a standalone Windows Forms app and Copilot canvas for taking an app idea through preparation, requirements,
approved app sketches, prototype revisions, product and test design, execution planning, implementation,
and integration/interaction testing.

## Standalone Windows app

The desktop app follows WorkMesh's Windows Forms + WebView2 hosting pattern. It
uses the same Tandem UI, workflow, process adapters, and artifacts as the canvas,
with its own Copilot SDK runtime. **The GitHub Copilot app does not need to be
running.** AI operations still require a signed-in Copilot account and network
access; this is not an offline AI engine.

For development, install Windows, the .NET 10 SDK, Node.js 22.12+ (or 24 LTS),
Git, and the Microsoft Edge WebView2 Evergreen Runtime. Install dependencies,
authenticate once, and launch:

```powershell
npm ci
npx copilot login
npm run desktop -- --workspace C:\projects\my-app
```

Omit `--workspace` to choose a folder in the app. To build without opening it,
run `npm run build:desktop`; the executable is `dist\desktop\Tandem.Desktop.exe`.
After `npm ci`, you can also launch directly with the .NET CLI:

```powershell
dotnet run --project .\src\Tandem.Desktop\Tandem.Desktop.csproj
```

The project reads its version from `package.json`, builds the Node backend, and
copies the backend and companion skill beside the executable automatically.
No `-p:Version` argument or separate npm build is required.

The development build needs Node on PATH and the .NET 10 Desktop Runtime.
`TANDEM_NODE_PATH` may specify a Node executable; `TANDEM_DESKTOP_HOST` may
specify a different built `host.mjs` for debugging.

**Copilot tool-approval dialogs are disabled in the desktop app.** The backend
uses the SDK's allow-all handler for shell commands, file reads and writes, URL
access, MCP/custom tools, memory, hooks, extensions, and factory permissions.
This is the default for both new and resumed desktop sessions; no initial
approval or saved opt-in is required. Commands may change files and access the
network without confirmation, so only open workspaces and tools you trust.
SDK-managed restrictions are not bypassed: requests that cannot be automatically
approved fail with a visible error rather than opening a dialog or waiting
indefinitely. Untracked agent-question tools and their native pop-ups are disabled
in the dedicated desktop session. Product questions appear in Tandem's tracked
DAG or prototype-revision clarification UI instead. External-browser confirmation
and browser/OS microphone permissions remain separate.

Opening an empty workspace shows goal entry without starting agents.
Closing or switching folders stops that window's runtime; reopening a
folder resumes its original session, preserving effort state and run receipts.
An active effort owned by a different Copilot session stays read-only rather
than being taken over. Only one desktop window may own a given workspace.

Desktop session identities and locks live in ignored `.tandem\desktop`; normal
efforts remain in `.tandem\efforts`. The bundled extension and companion skill
are private to the desktop runtime session, not installed over your personal
Copilot extensions. If a user or project Tandem provider is loaded, the existing
user-before-project precedence is preserved; the session bundle is the fallback.
Native page reload does not redeploy extensions or reset project state.

Before publishing a desktop release, bump the version in `package.json` with
`npm version patch --no-git-tag-version` (or the intended minor/major increment),
then run `npm run pack:desktop`. It runs the normal extension pack as well and
creates `dist\tandem-<version>-windows-x64.zip`, including the self-contained
.NET host, Node runtime, Copilot SDK/runtime dependencies, and companion skill.
Recipients still need WebView2, Git, any tools required by their project, and
Copilot authentication. Extract the entire ZIP before launching
`Tandem.Desktop.exe`; do not copy the executable without its `runtime` directory.
If Copilot CLI is not separately installed, sign in with the bundled CLI:

```powershell
.\runtime\node.exe .\runtime\node_modules\@github\copilot\npm-loader.js login
```

`npm run test:desktop` runs the native host checks and exercises the built backend
without AI calls, including startup, session recovery, and shutdown. Add
`-- --gui` to check the real Windows Forms/WebView2 page and canvas switching.
Use `-- --dotnet` instead to exercise `dotnet run` without a version override.
These smoke checks require an existing Copilot login; the `--gui` executable
checks also require `npm run build:desktop`. They do not run live model evaluations.

## Web UI development

The desktop WebView2 host and Copilot canvas share a **React** UI with **Radix UI**
accessible primitives and **Lucide React** icons. The renderer entry point is
`src\renderer\main.tsx`; each workflow screen is a React component. Keep UI state
and form drafts in React rather than mutating the rendered DOM. Project state
still comes from the existing loopback HTTP/SSE API; the transport store rejects
out-of-order snapshots and effort-scoped drafts survive polling and tab changes.
The Sketch editor keeps geometry and history logic separate from its React view.

Run `npm run check`, `npm test`, and `npm run build` after changes. The build
bundles React, Radix, icons, and dependency license notices into the existing
self-contained extension, so the UI framework needs no CDN or new runtime
server. Mermaid diagrams retain their optional browser-loaded renderer and
readable text/source fallback. UI regression tests use jsdom to exercise the
actual React components, keyboard controls, dialogs, and request payloads.
Edit `src\renderer` and the build script, not the generated extension.

## Install

### From a shared Gist

1. In GitHub Copilot, open the command palette.
2. Choose **Install extension from gist...**.
3. Paste the shared Tandem Gist URL.
4. Choose **User** to make it available across projects, then reload extensions if
   prompted.

The Gist installs the canvas app. For the full guided workflow, also install the
companion `tandem` skill from the ZIP bundle:

- macOS/Linux: `~/.copilot/skills/tandem/SKILL.md`
- Windows: `%USERPROFILE%\.copilot\skills\tandem\SKILL.md`

### From the ZIP bundle

1. Extract `extensions/tandem` into
   `~/.copilot/extensions/tandem`.
2. Extract `skills/tandem` into
   `~/.copilot/skills/tandem`.
3. Reload Copilot extensions or restart Copilot.

For a repository-only installation, put the extension at
`.github/extensions/tandem` and the skill at
`.github/skills/tandem`.

## Use

Open a Git repository in Copilot and enter:

```text
/tandem Build an app that helps my team triage customer requests.
```

Copilot opens **Tandem** immediately. Its automatic Preparation stage then inspects
the workspace, analyzes authoritative sources for named concepts, and chooses
whether to build a new GUI, validate an existing GUI, bypass Prototype, or ask
Requirements to decide. Work through the stages in order:

You can also open Tandem without a goal. A new effort shows a start page where
you enter a goal and click **Start project**. Opening or refreshing that page
does not run agents; submitting the goal starts Preparation.

The Preparation tab shows live work-item and factory progress, source links,
environment checks, blockers, and final results. When analysis completes, Tandem
passes its usage suggestions, assumptions, and deferred work into Requirements.

For a goal-only project in an empty folder, Preparation checks the local directory
instead of launching a workspace-inspection agent. A single lightweight agent can
then provide the Requirements handoff without tool calls or generic web research.
Only Git and Tandem metadata directories are ignored; project files, guidance, or
an imported source record retain the full analysis path. Goals that need named
APIs, references, methods, or other authoritative evidence still run source
analysis. Runtime, dependency, and credential checks remain explicitly deferred
until an implementation approach is selected, rather than being reported as verified.

Preparation and usage suggestions do not conduct a product interview. Collect
your **"I want to..."** intents first, then generate the DAG to resolve decisions
needed by those accepted intents. Suggestions are optional, not accepted scope.
Unknown names, opening hours, addresses, and other replaceable content stay
deferred instead of blocking intent entry. Handoff and suggestion workers have
no tools; other workers return clarifications or blockers through tracked stage
results, never through an ad-hoc question dialog.

1. Review Preparation results and its suggested usages.
2. Add one usage sentence at a time, then generate and resolve the requirements
   DAG.
3. Review and edit the generated app drawings, then approve the drawing set.
4. Review the new or existing live interface and submit revisions until it is
   ready. For no-GUI work, Sketch and Prototype are disabled with an explanation and Design
   opens after Requirements.
5. Review the automatically generated Product design artifacts, then the
   integration and interaction test-design drafts. Resolve their review threads
   before finishing each substage to capture `design-spec` and `test-spec`.
6. Generate and finalize the execution plan.
7. Start implementation agents and monitor their work.
8. Run integration and interaction tests, then finish the lifecycle.

Failed test runs provide a **Show error details** button with the run status,
failed scenarios, agent summaries, captured evidence, and error events.

In a narrow canvas, **Project context** opens the goal, stages, artifacts, and
process settings without pushing the workspace off screen. Select a stage or
artifact to return to its workspace, or press Escape to close project context.
The next-step bar's **Go to action** button reveals and focuses the suggested
control; it never submits an answer, starts a worker, or completes a stage.
Stage tabs scroll horizontally and support arrow-key navigation.

Tandem stores durable project state under `.tandem`. Add that
directory to `.gitignore` unless you intentionally want to version the state.

Finishing Requirements starts **Sketch**, not a runnable prototype. A bounded
worker derives a small set of screens and navigation transitions from the goal,
usages and accepted DAG answers. The decision DAG is not treated as a screen map.
Sketch uses editable vector scenes rather than generated application code.
Review screen purposes, labels, geometry, annotations and requirement links;
save direct edits or request an AI revision. Saved revisions are immutable.
AI generation and both typed and voice revisions stream validated screen,
shape and navigation operations into a **live preview** as they arrive. A small
edit sends only changed objects instead of regenerating the entire document.
The tool-free drawing worker uses the existing factory budget and model
selection. Complete operations are coalesced into preview updates at 50 ms;
the initial model response still depends on model and service latency.
Previews are temporary, read-only and never constitute saved or approved
drawings. One immutable revision is saved only after the final operation stream
passes validation. Failure or cancellation discards the preview and keeps the
last saved revision; unsaved edits in another view are never overwritten.
Reconnecting retrieves the latest in-memory preview for the exact active
request. Restarting the provider discards previews, not saved revision history.
The **Canvas size** dropdown beside the zoom controls offers Tandem and
VisionLoop defaults, HD landscape/portrait, square, 4:3, and A4 presets. Selecting
a preset immediately resizes the selected screen in one undoable step, keeping
all shapes at their original positions and sizes. Existing custom dimensions
remain supported and are displayed in the dropdown. A smaller canvas hides
overflow without deleting it; enlarge the canvas or undo to reveal it again.
Save drawings to persist the new dimensions.

The larger, icon-only drawing tools retain tooltips and accessible labels.
**Quadratic Bezier**, **Cubic Bezier**, and **Catmull-Rom spline** tools add
editable curves using VisionLoop's path modes. Select a path to drag its knots
or control points, edit coordinates (one `x, y` pair per line), close the path,
or adjust spline tension from 0 (smooth) to 1 (straight segments).
Quadratic paths use a start point followed by control/end pairs; cubic paths
use a start point followed by control/control/end triples. Add complete
segments in the points editor. Splines use knots only and wrap smoothly when
closed; repeating the first knot is unnecessary. Point drags are single
undoable edits, and malformed edits block saving instead of losing geometry.
AI drawing operations support the same optional path-only `curve`, `closed`,
and `tension` fields. Existing paths without these fields stay linear and open;
omitted spline tension is 0. The 512-point limit is unchanged. The editor,
live preview, and saved SVG/PNG all use the same curve geometry.

**Zoom in**, **Zoom out**, **Fit entire canvas**, and **Actual size (100%)**
change only the view, never drawing geometry, undo history, or export dimensions.
Fit follows the available viewport in both directions; larger views scroll
inside it. Selecting another screen starts in Fit mode.

For an existing GUI, sketches describe the same application and proposed changes,
not a parallel replacement.

**Approve drawings and continue** captures the current scenes and a PNG of every
screen before enabling Prototype. The handoff records the exact Requirements
digest and sketch revision. Prototype receives the structured scenes and must
read each approved PNG through Tandem's image tool; a worker claim or image
filename is not enough. Drawing generation and revisions use one worker, at most
300 seconds and 128 AI credits per request. A failed request preserves the last
saved drawings and requires an explicit retry.

Drawing JSON, SVG and PNG files live under ignored
`.tandem/efforts/<prototypeId>/sketches/<revisionId>/`. Accepted handoffs archive
their verified asset bytes; explicit export includes the assets in
`tandem-records`, without publishing them to Git. Reopening Requirements makes
drawings stale; reopening Sketch clears its approval and invalidates downstream
prototype checkpoints while retaining revision and handoff history.

Existing efforts already at Prototype or later retain their progress with a
recorded legacy Sketch bypass, not fabricated approval. Reopen Requirements to
adopt the new drawing stage. New non-GUI efforts bypass both graphical stages.

Finishing Sketch starts **Structure**, the first progressive Prototype
checkpoint. A minimally clickable wireframe appears before **Interaction** builds
the primary journey. **Visual direction** is optional: request lightweight theme
refinement after trying the interaction. These are milestones inside Prototype,
not extra lifecycle approval stages. These milestones implement the approved
sketch structure and navigation before refining interaction or visual direction.

The last working preview remains available during later builds and failures.
Each checkpoint uses an isolated source snapshot under
`.tandem/efforts/<prototypeId>/previews/<requestId>/`; existing-GUI validation uses
a snapshot of the same application, not a replacement application. **Update
ready** lets you apply the next preview at a natural pause. Cooperative previews
can restore their route, ordinary form fields, scroll, and application-provided
camera or selection state; sensitive fields are never carried across updates.
Ordinary dependency installations can be reused read-only. Workspace-linked
installations are copied locally and their package links are redirected to the
new checkpoint, so monorepos do not execute mutable source from an older preview.

All Tandem stages share compact header, navigation, card spacing, and control
sizes. Conversation fields expand on focus; specifications and diagrams retain
their reading space. Live prototype adds inline milestone and build status and
a preview that fills the remaining workspace height. **Build details** and
**Revision history** expand on demand; update/retry actions and errors remain
visible. The feedback field expands when focused without replacing the preview.

Feedback is saved immediately, even during generation or a clarification. The
queue records which preview the suggestion refers to and processes one revision
at a time. A failed step retries from its prepared files without rebuilding
successful checkpoints. A failed optional visual refinement can be skipped.
Each prototype worker has at most 300 seconds and 10,000 AI credits; the work window permits
900 cumulative execution seconds, including retries. Continuing beyond that
window requires an explicit budget extension. Waiting for user feedback does not
consume the work window. Budget and checkpoint progress survive provider reloads.
If an older installation reports `unknown field limits`, reload the updated
extension and retry the checkpoint. Tandem repairs that known rejected-launch
record without resetting the effort. Unconfirmed transport failures remain
locked until the runtime can establish whether a worker actually started.

Browser profiles and tool caches belong in each checkpoint's separate
`.tandem/efforts/<prototypeId>/runtime/<requestId>/` directory. Checkpoint copies
and new source fingerprints exclude recognized browser profiles and legacy
`.browser-checkpoint` / `.vite-checkpoint` caches, so Windows-locked metrics do
not block an update. A failed copy retries from its last fully prepared source,
preserving unfinished application changes rather than copying partial output.

Finish Prototype after applying the Interaction update and resolving outstanding
feedback; Visual direction is not required unless requested. This produces the
feature-spec handoff for technical Design. Requirements remain usable when
diagram rendering is unavailable.

Generating the requirements DAG keeps your usage list until Tandem accepts a
valid, unanswered graph. An accepted graph opens Requirements and focuses its
first decision. If generation fails, the usage panel shows the actual error and
**Retry requirements DAG** instead of remaining on **Generating DAG...**.
Worker completion alone does not mean the DAG was accepted.

**Use whole-graph defaults** replaces the sequential **All as Recommended** loop.
The confirmation lists the exact current recommendations for **all unanswered
nodes**, including dependent decisions. Tandem saves this approval atomically with
the effort generation and snapshot revision, then runs one semantic reconciliation
job (one subagent, at most 300 seconds and 128 AI credits). A stale snapshot,
duplicate click, or missing/non-curated recommendation cannot start a second job.
**Use this answer** still answers only the selected question.

The worker checks the frozen defaults together against existing answers and
returns only conflicts, affected replacement questions, assumption/deferred
patches, and the prototype approach when relevant—not a complete state, ledger,
or diagram. Tandem validates that change set and locally derives node statuses,
the next eligible question, Confirmed, and the shared Design tree rendering.
Unchanged accepted answers and unrelated artifacts are retained. Changed or
conflicting decisions and their descendants become unresolved with the prior
selection and reason visible; unseen recommendations are never auto-selected.
Topology changes require explicit review rather than automatic restructuring.

Saved defaults are not accepted answers until reconciliation succeeds. A failed
worker exposes **Retry whole-graph defaults**, which reuses the exact saved
approval if its inputs still match. Reload reconnects to the durable run rather
than dispatching another batch. **Review current whole-graph defaults** offers a
new confirmation if the failed batch's semantic inputs changed. Requirements completion checks outstanding run
receipts against the SDK, so a terminal applied result is not blocked by an
unobserved receipt; genuinely active or unidentified workers still block.
Batch reconciliation never completes Requirements, generates sketches, or builds
a prototype. **Finish Requirements** remains an explicit separate action.

Regression tests prove a single factory/subagent call and a compatible change set
under 200 response characters. These are protocol/count checks with a mock worker,
not measured end-to-end latency or credit savings.

## Speech input

### GPT-live in Sketch

**Sketch voice provider** offers **Azure Speech (dictation)** and **GPT-live
(conversation and drawing edits)**. This selector affects Sketch only; all other
stages retain their existing Azure Speech controls.

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
Azure Speech's **Sign in with Microsoft** does not sign in to GPT-live.
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
Select **Sign in with Microsoft** to open your default browser, choose your work
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
sign in again after restarting or reloading the extension. Selecting **Sign in
with Microsoft** again lets you change accounts. Failed or cancelled sign-in
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

## State and recovery

Effort state is stored at `.tandem/efforts/<prototypeId>/state.json`; the active
effort pointer is separate at `.tandem/metadata/current.json`. Stage snapshots
are versioned under each effort's `stages/` directory. Existing flat state files
are migrated on first use without deleting the originals. Invalid or unsupported
state is preserved and reported: repair or restore the named file rather than
starting over silently.

Cross-process locks and monotonic revisions protect shared repository state.
Active jobs belong to their originating Copilot session and workspace; return
to that session to resume them. Other sessions may inspect the effort but
cannot replace its inputs while work is active.
Stopping work retains its ownership until the runtime confirms termination;
a failed stop cannot unlock reset, reopening, or replacement execution.

The top-right **Reset** button returns the current effort to goal entry after
confirmation. It stops active work before clearing that effort's goal,
requirements, artifacts, stage history, accepted handoffs, and process settings.
Other Tandem efforts, repository files, and exported `tandem-records` bundles
are not changed. Reset cannot be undone. If worker termination cannot be
confirmed, Tandem keeps the effort and shows an error instead of clearing it.
Use the owning session and writable provider when active work belongs there.
Finalized Preparation history migrated from older versions does not require its
archived factory run to remain available. Active or unconfirmed run receipts
still require termination confirmation. **Reload** remains available while a
reset is pending and preserves the reset barrier.

Preparation uses the same durable ownership and request/run fencing. An interrupted
job without a recoverable identity is surfaced for explicit retry, never recreated
silently. Rehydrating a canvas cannot repeat its original reset request.

Completed stages can be inspected without changing execution state. Explicitly
reopening a stage preserves its snapshots and marks dependent artifacts stale.
Later execution results must be regenerated against the revised inputs.
Running completed tests again reopens Test and archives its previous completion
snapshot. Finish Test again after the new run succeeds to accept its new evidence.

## Accepted handoffs and process blocks

Open **Handoffs & process** in the sidebar (inside **Project context** in a narrow canvas). The working lifecycle
is unchanged by default: automatic implementation, automatic tests, and
tool-backed verification are opt-in.

After completing a stage, select it and enter the name of the person accepting
its handoff. Acceptance freezes the completed snapshot, source fingerprint,
upstream acceptance hashes, and the current Tandem version/configuration hash.
The name is recorded attribution, not authenticated code-owner approval.
Existing completed stages are not retroactively claimed as approved.

**Export accepted handoff** writes an immutable, reviewable bundle under
`tandem-records/<effort>/<acceptance>/`. It contains a manifest, the full snapshot,
and human-readable artifacts. Nothing is staged, committed, pushed, or uploaded.
Keep `.tandem` ignored as operational state; intentionally commit selected
`tandem-records` bundles when the repository is the authoritative artifact record.
Generated bundles are excluded from execution source fingerprints and protected
by their own hashes. Editing or reopening the underlying work requires fresh
evidence and acceptance; historical bundles remain available.

### Pluggable Local and GitHub blocks

Each block has its own saved adapter selection. Switching adapters preserves all
acceptances, receipts, and source links; an unavailable adapter never silently
falls back to another.

| Block | Local | GitHub |
| --- | --- | --- |
| Delivery handoff | Writes a local Markdown/JSON bundle | Posts the reviewed handoff to an existing PR |
| Review/check status | Reads an owned local handoff; makes no remote approval claims | Reads the PR, reviews, and head check/status results |
| Issue/incident intake | Imports a JSON record supplied in the canvas | Reads a GitHub issue or failed workflow run |

GitHub requires `gh` with access to the configured `owner/repository`. Selecting
the adapter does not access the network. Status and intake are explicit reads;
publication requires a separate confirmation after displaying the delivery draft.
No adapter creates branches, commits, pushes, merges, or deploys. A handoff comment
does not grant release approval or prove that a dirty local workspace matches the
remote PR head.

Finish Test and accept its current handoff before preparing a delivery draft.
For GitHub, supply an existing PR number or URL as the handoff/status reference.
For Local status, use the path from the local delivery receipt. Intake accepts
an issue URL, a failed workflow-run URL, or a local reference plus JSON:

```json
{
  "title": "Request submission fails",
  "body": "Observed a 500 response when submitting an empty request.",
  "kind": "incident"
}
```

Intake creates a new, linked effort without resetting the current one or starting
agents. Its receipt offers **Open linked effort and start Preparation**. The
imported record is source evidence, not permission to obey embedded instructions.
New efforts inherit adapter selections, not automatic execution permissions.

### Worker contracts and evidence

Implementation workers receive a durable contract with accepted input hashes,
owned paths, and the exact contents/hashes of required installed skills.
Planners must use actual skill names rather than job-role labels. Missing or
changed skills block execution instead of being silently omitted.

The scheduler still coordinates a shared workspace. Actual file changes are
checked against the wave's combined ownership at its boundary. This is postflight
detection, not write isolation or an operating-system sandbox; host permissions
remain necessary.

Before starting Implement, enable tool-backed verification and approve a JSON
array of executable/argument definitions in Process settings. For a repository with an existing `npm test`
script, a final check could be:

```json
[
  {
    "id": "repository-tests",
    "program": "npm",
    "args": ["run", "test"],
    "stage": "test",
    "afterWorkItems": [],
    "timeoutSeconds": 120
  }
]
```

Only approve commands you trust: they run with local user permissions. Commands
are executed without shell interpolation; they are not inferred from agent
prose. Add `implementation` checks with `afterWorkItems` naming their prerequisite
plan items to obtain feedback at eligible wave boundaries.

The runner records exit codes, source/input identities, bounded output, and a
hash of the full output. Source changes invalidate a pass. Final Test still runs
the integration/interaction scenarios; enabling the independent verifier adds
a fresh-context acceptance pass that must not edit the implementation. Without
this option, the UI explicitly distinguishes worker-reported evidence from
tool-backed evidence.

Verified implementation completion is also bound to its final source tree.
Changing sources or verification settings invalidates that completion; rerun
Implement before accepting its handoff or starting Test. If Implement has already
been finished, reopen it first.

Protected acceptance paths freeze selected regression tests or directories at
implementation start. A retry retains that baseline. Restore changed protected
files, or explicitly reopen Plan to review a new baseline; retrying is not
permission to weaken the tests. Changing a command or reopening Implement does
not replace the protected baseline.

Automatic handoffs start implementation only after explicit Plan handoff
acceptance, and tests only after explicit Implement handoff acceptance. Existing
durable request identities prevent replacement or duplicate dispatch. If launch
cannot complete, the accepted handoff remains recorded and the stage's Start
control provides the explicit retry path.

The sidebar separates readiness-to-acceptance waiting time from available
factory execution time and model-reported AIU consumption. Missing metering is
shown as unavailable, not zero. Reopening counts and historical receipts remain
available when work is revised.

## Requirements

- A current GitHub Copilot app or CLI with extension canvas and agent factory
  support.
- A Git repository for project state and implementation work.
- Permission to run local loopback HTTP servers and agent factories.

## Develop and package

The maintainable source is under `src/`. The renderer is separated by concern:

- `src/renderer/index.html` contains the minimal React mount document.
- `src/renderer/styles.css` contains the complete canvas theme and layout.
- `src/renderer/main.tsx` mounts the React app; `app.tsx` owns the Radix workspace shell.
- `src/renderer/*-panel.tsx` owns workflow screens and controlled forms.
- `src/renderer/state-store.ts` orders HTTP/SSE state updates; `ui-context.tsx`
  shares UI permissions, actions, confirmations, and effort-scoped drafts.
- `src/renderer.ts` assembles the generated client and source assets.
- `src/project-store.ts` owns transactions, migration, revision checks, and durable writes.
- `src/workflow.ts` owns authoritative decisions, activity ownership, and artifact invalidation.
- `src/agent-runner.ts` owns serializable worker-result boundaries.
- `src/execution.ts` owns execution identity and evidence fingerprints.
- `src/scheduling.ts` owns dependency normalization and conflict-safe scheduling.
- `src/canvas-transport.ts` owns bounded JSON requests and responses.
- `src/requirements-reconciliation.ts` owns the frozen default-batch contract,
  strict semantic change-set validation, and Requirements input freshness digest.
- `src/decision-diagram.ts` shares deterministic DAG rendering between persistence
  and the canvas; Requirements normalization derives status and Confirmed locally.
- `src/accepted-artifacts.ts` owns immutable acceptance and explicit exports.
- `src/process-state.ts` owns process settings, receipts, and gate events.
- `src/worker-contracts.ts` binds skills and checks actual ownership.
- `src/verification.ts` captures approved command evidence.
- `src/execution-proof.ts` validates evidence and independent verdicts.
- `src/process-adapters.ts` registers interchangeable Local/GitHub blocks.
- `src/delivery.ts` builds and fences reviewable delivery drafts.
- `src/planning-prompts.ts` is shared by production workers and agent evaluations.

Copilot still requires the generated
`.github/extensions/tandem/extension.mjs` at the extension root for discovery.
The extension directory otherwise contains only deployable runtime files.

```text
npm install
npm run check
npm test
npm run build
npm run pack
```

- `npm run dev` watches the TypeScript source and rebuilds `extension.mjs`.
- `npm run check` includes a strict TypeScript boundary for the extracted core.
- `npm test` runs Node's built-in regression runner through the existing `tsx`
  toolchain, using isolated state directories and mocked agent execution.
- `npm run build` type-compiles and minifies the browser TypeScript, inlines the
  HTML and CSS, and bundles the assembled renderer with `src/extension.ts` into
  `.github/extensions/tandem/extension.mjs`.
- `npm run pack` type-checks, builds, and writes
  `dist/tandem-extension.zip` with the deployable extension, project source
  under `source/`, companion skill, and this guide.

## Agent evaluations

`npm run eval` lists the behavioral fixtures without making model calls.
The evaluation suite uses the same preparation and planning prompt builders as
the product, deterministic outcome graders, and isolated tool-disabled sessions.
It complements the mocked orchestration regressions; it is not an end-to-end
implementation benchmark.

Live model evaluations require explicit opt-in, a model, caller-specified
case/time limits, and an observed-usage AI-credit ceiling:

```text
npm run eval -- --live --model MODEL --max-cases N --timeout-seconds N --max-ai-credits N
```

The credit ceiling sums reported usage across cases and stops further calls
when reached. It is a **soft ceiling**, not a guaranteed cap on in-flight charges.
Missing usage fails closed rather than claiming a budgeted success.
See `npm run eval -- --help` for details.
Results are retained under `.tandem/evals`. The agent-evals workflow runs
deterministic regressions on relevant changes and provides a separately
configured live evaluation path; credentials and paid runs are not enabled by
installing Tandem.

## Release

The version shown in Tandem's top-right corner comes from `package.json`. Before
publishing or deploying a release, bump that package version with
`npm version patch --no-git-tag-version` (or the intended minor/major increment),
then run `npm run pack`. Deploy both the generated extension and companion skill
so the user-scoped provider does not override the release with stale files.
