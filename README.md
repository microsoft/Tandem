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

Tandem stores durable project state under `.tandem`. Add that
directory to `.gitignore` unless you intentionally want to version the state.

Finishing Requirements schedules the applicable new or existing GUI work automatically.
Non-GUI efforts bypass Prototype and retain their feature-spec handoff.
If startup fails, use the prototype retry control; building messages reflect
the active job rather than simulated milestones. Requirements remain usable
when diagram rendering is unavailable.

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

Preparation uses the same durable ownership and request/run fencing. An interrupted
job without a recoverable identity is surfaced for explicit retry, never recreated
silently. Rehydrating a canvas cannot repeat its original reset request.

Completed stages can be inspected without changing execution state. Explicitly
reopening a stage preserves its snapshots and marks dependent artifacts stale.
Later execution results must be regenerated against the revised inputs.
Running completed tests again reopens Test and archives its previous completion
snapshot. Finish Test again after the new run succeeds to accept its new evidence.

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

## Release

The version shown in Tandem's top-right corner comes from `package.json`. Before
publishing or deploying a release, bump that package version with
`npm version patch --no-git-tag-version` (or the intended minor/major increment),
then run `npm run pack`. Deploy both the generated extension and companion skill
so the user-scoped provider does not override the release with stale files.
