# Tandem Stage 2

This folder maintains Stage 2: development against an agreed Design. The Node
application now composes it after the surrounding Preparation, Requirements,
Sketch and Prototype stages. Its backend role engine and original renderer remain
the source of truth; root `src` owns the upstream bridge, not a replacement engine.

The source was copied from the teleos worktree at commit
`f0c9fb73c31ee3703fba7f61f09ed083415946e0`. The overview slides include the later,
uncommitted clarification of Implementer, Reviewer and user responsibilities.
The original teleos working copy is retained. Integration changes extract a reusable
controller and add narrow provenance/admission and durable native-creation seams.
Transferred fixtures resolve renderer assets and writer modules relative to their
own files, including when launched from the package directory.

## Layout

```text
development/
  tandem/                    Complete application, package, scripts and tests
    src/                     Native workflow and extension
    public/                  Browser/canvas renderer and bundled assets
    runtime-src/             Shared TypeScript contracts and persistence
    skills/                  Design and implementation guidance
    test/                    Runtime, browser and shared tests
    scripts/                 Packaging and asset build scripts
  docs/                      Design documentation, overview slides and image
  .github/extensions/tandem/ Original one-line discovery shim
  AGENTS.md                  Instructions scoped to this Stage 2 source tree
```

Keeping `tandem/` inside this folder preserves the existing package/test paths
without changing application behavior. In the transferred guides, "repository
root" means this `development/` source root unless stated otherwise.

### Source and distribution paths

The repository source folder is `development/` (formerly `stage2/`). Integrated
extension, browser and desktop builds deliberately retain `stage2/` inside the
runtime payload, including `stage2/src/human-loop-controller.mjs` and
`stage2/public/`. Payload manifests, verification and installation staging rely
on those paths. The ZIP includes source under `source/development/` and the
installed runtime under `extensions/tandem/stage2/`; standalone Stage 2 packaging
still places `src/`, `public/`, `runtime-src/` and `skills/` at its output root.

This is a source-layout refactor, not a release or state migration. Version,
provider/protocol IDs, `stage2` response fields, private native-session identities,
saved project state and historical records are unchanged. Stage 1 and Stage 2
retain their own UX, workflows and runtime ownership.

## Browser and CLI runtime

Stage 2 does not require Python or a separate Python web server. Its browser
renderer uses a loopback Node.js HTTP server with server-sent live updates,
backed by the Copilot SDK and an owned native CLI Interactive session.

The complete implementation is included:

- `tandem/src/extension.mjs` registers the canvas and browser entrypoint.
- `tandem/src/human-loop-controller.mjs` composes the same implementation into the
  Node host without entrypoint side effects or a second public registration.
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
npm --prefix development\tandem ci
npm --prefix development\tandem run build
npm --prefix development\tandem test
```

These commands are separate from the Stage 1 root package. No dependency
directories, generated builds, project runtime state, credentials or retained
agent sessions were transferred.

For a portable package, create an output parent and use a new destination:

```powershell
New-Item -ItemType Directory -Path C:\staging -Force | Out-Null
npm --prefix development\tandem run package:extension -- C:\staging\tandem-stage2
```

Building a package does not install or activate it. The nested discovery shim is
retained as source and is not activated by the composed Node host. Root packaging
includes this full payload under its single `tandem` provider. Do not load the
standalone shim beside that provider or overwrite a user installation to test it.
For separate standalone testing, install the complete portable package in an
owned test project following the
[Stage 2 installation guide](tandem/INSTALL.md).

## Key design documents

- [Current implementation and lifecycle](tandem/README.md): current roles,
  confirmation, permissions, persistence and recovery behavior.
- [Design reading guide](docs/README.md): the selected documents and their
  relationship to the implementation.
- [Two-stage overview, Stage 2 slide](docs/tandem-opening-slides-v2.html#6):
  the agreement-centered workflow and explicit responsibility split.

Implementer builds and validates whole user journeys. Reviewer is read-only and
checks Design conformance and over-engineering. Review neither repairs code nor
authorizes another implementation cycle; the user confirms that separately.

## Integrated Stage 1 handoff

See the [Stage 1 integration plan](stage1-integration-plan.md)
for the implemented Designer-led bridge, migration, ownership and qualification boundaries.

The host retains exact documents, approved sketch/assets and the displayed
multi-file prototype source (or explicit no-GUI disposition), with one immutable
request envelope. Designer reads these as existing intent and continues from
confirmed decisions rather than restarting discovery or turning mocks into
production requirements. Original source is not executed or copied over product
files by the bridge.

Consequential gaps or contradictions return to the user. The existing Design
refinement and implementation-confirmation flow remains the intended path.
Opening/reloading never submits that request, recovery never replays a retired
handoff, and a fresh refinement does not reset canonical Design. Native no-model
API qualification does not establish a live model-driven implementation result.
