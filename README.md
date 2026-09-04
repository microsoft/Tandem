# Tandem

Tandem is a Copilot canvas for taking an app idea through requirements,
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

Copilot first performs a bounded preflight: it inspects the workspace and researches
authoritative sources for named external concepts that affect the requested flow.
It also chooses whether to build a new GUI, validate an existing GUI, or bypass
Prototype for work with no graphical interface. It then opens **Tandem** with that
context. Work through the stages in order:

The Preparation card records source links, environment checks, and blockers. A
fresh `/tandem` invocation initializes this state atomically, so stale discovery
content is not displayed before the new goal is ready.

1. Add one usage sentence at a time, then generate and resolve the requirements
   DAG.
2. Review the new or existing live interface and submit revisions until it is
   ready. For no-GUI work, Prototype is disabled with an explanation and Design
   opens after Requirements.
3. Complete Product design and Test design.
4. Generate and finalize the execution plan.
5. Start implementation agents and monitor their work.
6. Run integration and interaction tests, then finish the lifecycle.

Failed test runs provide a **Show error details** button with the run status,
failed scenarios, agent summaries, captured evidence, and error events.

Tandem stores durable project state under `.tandem`. Add that
directory to `.gitignore` unless you intentionally want to version the state.

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

Copilot still requires the generated
`.github/extensions/tandem/extension.mjs` at the extension root for discovery.
The extension directory otherwise contains only deployable runtime files.

```text
npm install
npm run check
npm run build
npm run pack
```

- `npm run dev` watches the TypeScript source and rebuilds `extension.mjs`.
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
