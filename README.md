# Tandem

Tandem is a Copilot canvas for taking an app idea through preparation, requirements,
prototype revisions, product and test design, execution planning, implementation,
and integration/interaction testing.

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

1. Review Preparation results and its suggested usages.
2. Add one usage sentence at a time, then generate and resolve the requirements
   DAG.
3. Review the new or existing live interface and submit revisions until it is
   ready. For no-GUI work, Prototype is disabled with an explanation and Design
   opens after Requirements.
4. Complete Product design and Test design.
5. Generate and finalize the execution plan.
6. Start implementation agents and monitor their work.
7. Run integration and interaction tests, then finish the lifecycle.

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

Finishing Requirements schedules the applicable new or existing GUI work automatically.
Non-GUI efforts bypass Prototype and retain their feature-spec handoff.
If startup fails, use the prototype retry control; building messages reflect
the active job rather than simulated milestones. Requirements remain usable
when diagram rendering is unavailable.

## Speech input

Every conversational input has a **Mic** control: project goals, usages,
requirement answers, prototype revisions and clarifications, artifact reviews
(including test design), plan revisions, and implementation strategy adjustments.
Click **Mic**, allow microphone access, and speak naturally. Partial text updates
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
az login
```

Use an Azure Speech resource and grant the signed-in identity the **Cognitive
Services Speech User** role on that resource. The extension uses
`DefaultAzureCredential`; local development can use Azure CLI sign-in, and hosted
environments can use a configured managed identity. No keys are needed. Shell-only
environment changes apply only to applications launched from that shell.

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

- `src/renderer/index.html` contains the semantic document structure.
- `src/renderer/styles.css` contains the complete canvas theme and layout.
- `src/renderer/client.ts` contains browser behavior and state rendering.
- `src/renderer.ts` assembles the generated client and source assets.
- `src/project-store.ts` owns transactions, migration, revision checks, and durable writes.
- `src/workflow.ts` owns authoritative decisions, activity ownership, and artifact invalidation.
- `src/agent-runner.ts` owns serializable worker-result boundaries.
- `src/execution.ts` owns execution identity and evidence fingerprints.
- `src/scheduling.ts` owns dependency normalization and conflict-safe scheduling.
- `src/canvas-transport.ts` owns bounded JSON requests and responses.
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
