# Tandem

Tandem takes software intent through **Preparation -> Requirements -> Sketch ->
Prototype -> Development**. Development embeds the Stage 2 human-loop application
from PR #14, including its original Design/Conversation UI and native role workflow.
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
Its model, compaction, permissions, Stop and Close controls are inside Development.
Main permission, Reset, speech and extension-reload controls are scoped or disabled
while viewing Development.

One composed public `tandem` provider owns both surfaces. The Node host retains
user > project > session preference when those providers are present. It checks
the selected provider's protocol, version and complete payload digest. An older
preferred installation produces an explicit conflict; the host does not silently
bypass it or overwrite a user installation.

Main-session chat is not a Development request. Opening, refreshing or recovering
Development initializes its owned runtime but sends no project request. Existing
state belonging to another main session or workspace fails visibly without
rebinding an identity.

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

Creating a tarball does not publish it. Root `package.json` is the release-version
authority. Before an authorized release, bump with
`npm version patch --no-git-tag-version` (or the intended increment), run
`npm run pack`, and rebuild the browser package. Source implementation alone
does not require a release bump or installation update.

## Workflow

Preparation inspects the workspace and necessary authoritative sources, then
offers optional first-person usages. Generic goals in an empty workspace do not
require external research. Requirements collects accepted usages and a
dependency-aware decision graph; recommendations are not answers until selected.
Whole-graph defaults require explicit confirmation and one bounded reconciliation.
Failed or conflicting answers remain visible, not silently accepted.

Sketch retains its editable screen drawings, revision history, explicit approval
and approved image assets. Prototype keeps the existing staged structure,
interaction, optional visual refinement, queued feedback and Apply update flow.
`build` produces a mock UI; `validate-existing` works from the existing GUI's
copied source; `not-applicable` preserves a reason and feature specification
without fabricating a graphical prototype.

### Finish Prototype and continue Design

The existing `generate-design-spec` action is retained: it creates
`draft-feature-spec` in Prototype, not a downstream technical Design stage.
Completion checks the displayed checkpoint, source fingerprint, applicable sketch
approval and outstanding feedback. A URL alone is not source evidence. An offline
preview does not invalidate a retained, source-bound checkpoint.

The host retains an immutable bounded handoff under the **target worktree's**
`.tandem\living-canvas\handoffs`. It includes exact completed snapshot bytes,
artifact hashes, confirmed/assumed/deferred decisions, approved drawings/assets,
mock shortcuts and the displayed multi-file source. Dependency installations,
browser/runtime caches, credential-like files and unrelated operational state
are excluded. Missing, changed or aliased input fails explicitly.

Stage 1's shared state root and the actual target worktree are recorded
separately. Stage 2 implements in the real target workspace, not in the shared
snapshot directory. Original inputs are preserved.

One exact request ID, timestamp and message are persisted **before** admission.
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

Development serves the unchanged Stage 2 document and assets on their own
loopback origin, in a full-size iframe. The upstream permanent context pane is
hidden rather than creating a third column. The iframe remains mounted when
browsing upstream history so unsent text survives navigation.

The original artifact views, questions, conversation/history, keyboard resizing,
annotation snapshots, pasted images, quick requests, implementation confirmation,
model/appearance settings, compaction, permissions, process controls, Stop after
this step, Stop now and Close remain Stage 2 controls. Closing a view is not the
same as closing its native runtime.

## State, migration and recovery

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

**Reconcile Design handoff** remains idempotent and cannot revive a retired
request. Do not use unused-setup initialization, delete history, or substitute a
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
After **Ready**, explicitly select **Reconcile Design handoff** to admit the
original prepared handoff. Never delete saved state or locks to bypass a
rejected recovery check.

## Acceptance, export and process adapters

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
