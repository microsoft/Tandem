# Tandem Development

Development is Tandem's Design, implementation and Review workspace. It can open
directly or use explicitly reviewed outputs from Preparation, Requirements,
Designs and Prototype. The native role engine and renderer here remain the source
of truth; root `src/` composes them rather than providing a replacement engine.

For everyday use, start with the [quick start](../docs/quick-start.md) and
[user manual](../docs/user-manual.md). Contributors should read
[AGENTS.md](AGENTS.md) and the [runtime guide](tandem/README.md).

## Layout

| Path | Purpose |
| --- | --- |
| `tandem/src/` | Native workflow, controller and extension |
| `tandem/public/` | Browser/canvas renderer, role prompts, assets and vendor notices |
| `tandem/runtime-src/` | Shared TypeScript contracts and persistence |
| `tandem/skills/` | Current Design authoring guidance |
| `tandem/test/` | Runtime, browser and shared tests |
| `tandem/scripts/` | Packaging and asset builds |
| `docs/` | Contributor references for prompts and artifact formats |
| `.github/extensions/tandem/` | Standalone discovery shim; not activated by the composed host |

`tandem/` retains its own package manifest, lockfile and strict build/tests.
Paths in its standalone guides are relative to this `development/` source root
unless stated otherwise.

## Source and distribution paths

Source lives in `development/tandem/`. Integrated extension, browser and desktop
builds retain `stage2/` inside the installed payload, including
`stage2/src/human-loop-controller.mjs` and `stage2/public/`. Manifests, verification
and installation staging depend on those paths. The ZIP includes source under
`source/development/` and runtime under `extensions/tandem/stage2/`; standalone
packaging places `src/`, `public/`, `runtime-src/` and `skills/` at its output root.

Root `package.json` alone owns the integrated release version. Provider/protocol
IDs, technical `stage2` response fields, private native-session identities and
saved historical records must remain compatible. Discovery and Development keep
independent UX, workflows, state and runtime ownership.

## Build and test

Use actual Node 24+ and the Development package's lockfile:

```powershell
npm --prefix development\tandem ci
npm --prefix development\tandem run build
npm --prefix development\tandem test
```

The loopback Node server and Copilot SDK use an owned native Interactive session;
no Python server is required. The extension host supplies the runtime SDK.
See [installation and startup](tandem/INSTALL.md) for standalone requirements.
For integrated checks and packaging, use the root
[engineering reference](../docs/engineering-reference.md#develop-validate-and-package).

Portable standalone packaging uses a new destination:

```powershell
New-Item -ItemType Directory -Path C:\staging -Force | Out-Null
npm --prefix development\tandem run package:extension -- C:\staging\tandem-development
```

Packaging does not install or activate the extension. Never load the standalone
shim beside the composed provider or overwrite a user installation to test source.

## Reviewed discovery handoff

**Finish Prototype** saves outputs and carries that explicit user intent into
Development's normal Designer request without another handoff approval or Start
button. Older saved outputs retain an explicit continuation. The host freezes exact documents,
approved designs/assets, multi-file prototype source (or a no-GUI disposition)
and one immutable request envelope in the target workspace.

Designer reads that retained evidence, preserves confirmed intent and asks about
consequential gaps. The bridge neither executes prototype scripts nor copies them
over product files. Opening or refreshing does not submit; retries reconcile the
same envelope, and recovery never replays a retired request. Existing canonical
Design and its native owner are not replaced.

Development changes stay in its private Design/Conversation workflow; historical
`discovery-change` results do not authorize automatic upstream escalation.
Optional Main and Development model selectors share Project settings. First
private creation inherits the actual main model unless overridden; the existing
private session then remains independent. Effort is not implicitly copied.
Implementation requires a separate exact request/Design-bound confirmation.
Implementer builds and validates agreed journeys; Reviewer is read-only and
checks Design conformance and over-engineering, not independent certification.
See the [handoff contract](../docs/engineering-reference.md)
and [runtime invariants](AGENTS.md#active-architecture).

## Source provenance

The Development source was originally transferred from teleos commit
`f0c9fb73c31ee3703fba7f61f09ed083415946e0`. Subsequent integration preserves the
original engine and renderer through a reusable controller, explicit provenance/
admission boundaries and durable native-creation records. Historical internal
discussion decks and integration trackers are not current operating guides.
Bundled libraries, branding sources and their license notices remain with the
application.
