# Tandem Stage 2

This folder contains the independently maintained Stage 2 implementation:
development against an agreed Design. Stage 1 remains in the surrounding Tandem
project. This transfer does not integrate their runtimes or change Stage 1.

The source was copied from the teleos worktree at commit
`f0c9fb73c31ee3703fba7f61f09ed083415946e0`. The overview slides include the later,
uncommitted clarification of Implementer, Reviewer and user responsibilities.
The original teleos working copy is retained. Application code is unchanged;
transferred test fixtures resolve renderer assets and writer test modules relative
to their own files so they also work when launched from the package directory.

## Layout

```text
stage2/
  tandem/                    Complete application, package, scripts and tests
    src/                     Native workflow and extension
    public/                  Browser/canvas renderer and bundled assets
    runtime-src/             Shared TypeScript contracts and persistence
    skills/                  Design and implementation guidance
    test/                    Runtime, browser and shared tests
    scripts/                 Packaging and asset build scripts
  docs/design/               Selected design documentation
  reference/ux-experiments/  Two-stage overview slides and their image
  .github/extensions/tandem/ Original one-line discovery shim
  AGENTS.md                  Instructions scoped to this Stage 2 source tree
```

Keeping `tandem/` inside this folder preserves the existing package/test paths
without changing application behavior. In the transferred guides, "repository
root" means this `stage2/` source root unless stated otherwise.

## Browser and CLI runtime

Stage 2 does not require Python or a separate Python web server. Its browser
renderer uses a loopback Node.js HTTP server with server-sent live updates,
backed by the Copilot SDK and an owned native CLI Interactive session.

The complete implementation is included:

- `tandem/src/extension.mjs` registers the canvas and browser entrypoint.
- `tandem/src/human-loop-browser-entry.mjs` owns the regular-browser entry lifecycle.
- `tandem/src/human-loop-provider.mjs` serves the UI and its local HTTP/event API.
- `tandem/src/human-loop-installation.mjs` and `human-loop-transport.mjs` manage
  installation, private-session ownership and native execution.
- `tandem/public/` contains the renderer, prompts, bundled libraries and license notices.

Running the extension requires Node 24+, Git and an authenticated Copilot CLI
with the required extension/SDK support; those platform tools are not vendored
here. The extension host supplies the runtime SDK. Development dependencies are
declared in the included package manifest and lockfile. Keep the hosting Copilot
session open while using the browser, and close the runtime through Tandem before
exiting. See [installation and startup](tandem/INSTALL.md).

## Develop from the Tandem repository root

Use Node 24+ and the Stage 2 package's own lockfile and scripts:

```powershell
npm --prefix stage2\tandem ci
npm --prefix stage2\tandem run build
npm --prefix stage2\tandem test
```

These commands are separate from the Stage 1 root package. No dependency
directories, generated builds, project runtime state, credentials or retained
agent sessions were transferred.

For a portable package, create an output parent and use a new destination:

```powershell
New-Item -ItemType Directory -Path C:\staging -Force | Out-Null
npm --prefix stage2\tandem run package:extension -- C:\staging\tandem-stage2
```

Building a package does not install or activate it. The nested discovery shim is
retained as source; it has not replaced the surrounding project's Stage 1 shim.
Both products use the `tandem` extension identity. Do not overwrite the Stage 1
extension or user-wide installation to try Stage 2. Install the complete portable
package in a separate test project following the
[Stage 2 installation guide](tandem/INSTALL.md).

## Key design documents

- [Current implementation and lifecycle](tandem/README.md): current roles,
  confirmation, permissions, persistence and recovery behavior.
- [Design reading guide](docs/design/README.md): the selected documents and their
  relationship to the implementation.
- [Two-stage overview, Stage 2 slide](reference/ux-experiments/tandem-opening-slides-v2.html#6):
  the agreement-centered workflow and explicit responsibility split.

Implementer builds and validates whole user journeys. Reviewer is read-only and
checks Design conformance and over-engineering. Review neither repairs code nor
authorizes another implementation cycle; the user confirms that separately.

## Stage 1 handoff direction

The integration contract is not finalized. The expected handoff is documents
plus an HTML prototype with mocked data. Designer should read these as the
existing Design and continue from its confirmed decisions, rather than restart
discovery or infer production requirements from mock shortcuts.

Consequential gaps or contradictions return to the user. The existing Design
refinement and implementation-confirmation flow remains the intended path.
This describes the agreed integration direction, not a completed importer,
shared runtime or finalized schema.
