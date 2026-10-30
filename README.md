<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/tandem-mark-dark.png">
    <img src="docs/images/tandem-mark-light.png" alt="Tandem bicycle logo" width="72" align="absmiddle">
  </picture>
  Tandem: Two minds, one direction.
</h1>

<p align="center">
  <a href="package.json"><img src="https://img.shields.io/github/package-json/v/microsoft/Tandem?label=version" alt="Package version"></a>
  <a href="LICENSE.txt"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License: MIT"></a>
  <a href="CONTRIBUTING.md"><img src="https://img.shields.io/badge/contributions-welcome-brightgreen" alt="Contributions welcome"></a>
</p>

Tandem is a collaborative workspace for turning ideas and existing code into
software you understand and intend. Discuss the experience, make decisions
visible in UI designs and Design artifacts, then explicitly approve implementation.

It is for developers, designers and project owners who want to work with a coding
agent without leaving product decisions hidden in a prompt.

![Original illustration of a person and Copilot discussing a user journey, interface sketch and technical flow on a shared whiteboard.](docs/images/tandem-vision.svg)

The illustration above expresses that vision; it is not a product screenshot.

<a id="news"></a>

## 📰 News

- **2026-10-29:** We are releasing **Tandem 0.0.16** today.

<a id="see-tandem-in-action"></a>

## 🎬 See Tandem in action

**Watch the 94-second introduction:**

https://github.com/user-attachments/assets/6b068a9d-1669-47bd-a55d-26ced792145a

**Using Tandem: a two-minute highlights tour**

Follow a weekend-away planner through Requirements, drawings, a UI prototype
with mocked data, Design discussion, implementation and Review.

https://github.com/user-attachments/assets/ea2c909b-97c7-44b2-adfe-86ff56e4c382

[Watch this for an E2E tutorial](https://github.com/user-attachments/assets/d1460f4a-ab61-42de-be0b-914b4269069d):
a 14-minute coffee-shop walkthrough from goal to implementation and Review.

<a id="why-tandem"></a>

## 💡 Why Tandem?

- **See the idea before committing to it.** Explore requirements, UI designs and
  interactive prototypes instead of reconstructing everything from a long spec.
- **Start where your project is.** Discover a new idea or work directly from an
  existing application; Preparation is optional.
- **Keep implementation tied to your decisions.** Review the Design, approve
  the proposed work, and inspect implementation and Review outcomes.

Read [the Tandem story](docs/the-tandem-story.md) for the approach and a concrete
example.

<a id="get-started"></a>

## 🚀 Get started

**Source preview:** the instructions below build this checkout; they do not
install a published release. Use Windows with PowerShell, actual **Node 24.15+
(24.x LTS) or Node 26+**, Git, and a Copilot account with the required model access.
Other platforms are not yet qualified. The browser app does not require .NET or a running Copilot
desktop app.

From your Tandem source checkout, run:

```powershell
npm ci
npm run login:browser
npm run browser -- --workspace C:\projects\my-app
```

Both browser scripts build the app automatically. Pass launch options after `--`.

Optionally choose the **main session's** model and reasoning effort using a model
available to your account:

```powershell
npm run browser -- --workspace C:\projects\my-app --model gpt-6-astra --reasoning-effort low
```

Omitting these flags preserves saved selection. With no selected main model,
standalone startup activates and verifies the native preferred model without
forcing an effort level. Project
settings has separate **Main session model** and **Development model** controls;
see [model options](docs/quick-start.md#main-session-model-options) for
creation-time Development inheritance and independent effort settings.

If you also have Tandem installed, explicitly isolate a source preview from that
installation:

```powershell
npm run browser -- --source-preview --workspace C:\projects\my-app
```

This restricts native extension launches to the exact session-staged Tandem
payload and disables main-session configuration discovery. Other discovered
extensions cannot execute; the bundled skill remains available. Sign-in, saved
session identity and native permission prompts are unchanged. The installed
extension is not modified.
Without this option, normal installed-provider preference remains in effect.

Replace `C:\projects\my-app` with your project folder (the repository/worktree root
for existing Git projects), not the Tandem source folder. Before Development,
Tandem offers explicit local Git setup when needed;
[the quick start](docs/quick-start.md) shows both paths. Use a test
project or worktree for your first trial.

**What you will see:** Tandem opens your project folder and asks where to start:

| Start with Preparation | Go to Development |
| --- | --- |
| Clarify an idea through Requirements, Designs and Prototype, then continue into Development. | Explore existing files or refine a rough idea directly in Design and Conversation. |

The choice is saved for that folder. In Development, review the Design and
answer questions, then request implementation. **Plan and implement** explicitly
authorizes planning and code changes in your selected working copy; opening a
view or finishing a prototype does not.

Keep the launch terminal open. Closing a browser tab leaves work running;
use the host's **Stop** or **Ctrl+C** to exit, and check any reported failure.
Private launch URLs must not be shared.

## Documentation

| Guide | Use it to |
| --- | --- |
| [Quick start](docs/quick-start.md) | Open your first project and reach an implementation decision. |
| [The Tandem story](docs/the-tandem-story.md) | Understand the vision through a concrete example. |
| [User manual](docs/user-manual.md) | Learn the workspace and everyday controls. |
| [Task recipes](docs/use-cases.md) | Revise a prototype, refine Design, or inspect saved outcomes. |
| [Troubleshooting](docs/troubleshooting.md) | Handle queued work, unavailable previews, Stop and reopen. |

The [documentation index](docs/README.md) also links advanced configuration and
engineering references.

## Development and contributions

Contributions are subject to the Microsoft Contributor License Agreement; see
[CONTRIBUTING.md](CONTRIBUTING.md) for the CLA process and submission guidance.
Please follow our [Code of Conduct](CODE_OF_CONDUCT.md).

Work from source in `src` and `development\tandem`; do not hand-edit the generated
extension under `.github\extensions\tandem`. From the repository root:

```powershell
npm ci
npm --prefix development\tandem ci
npm run check
npm test
npm run build
```

For Development changes, also follow its [contributor instructions](development/AGENTS.md).
See the [engineering reference](docs/engineering-reference.md) for architecture
boundaries, packaging, optional hosts and qualification limits.

For shared UI components, tokens and isolated light/dark examples, see the
[UI system guide](docs/ui-system.md). Run `npm run storybook` to open its local
development server; this does not start Copilot or a project runtime.

For automatic frontend rebuilds and browser refresh:

```powershell
npm run dev:browser -- --workspace C:\projects\my-app
```

Add `--source-preview` to use the same explicit isolation while watching UI files.

UI saves refresh the whole page without restarting Copilot runtimes; unsent input
may be lost. Backend/runtime source changes require restarting the command.

For a bug report or proposed change, describe the expected behavior, what happened,
and the source/package version. Keep private launch URLs, credentials and
sensitive project content out of reports. Report security vulnerabilities through
the process in [SECURITY.md](SECURITY.md), not a public issue.
See [SUPPORT.md](SUPPORT.md) for help and support channels.

## Data and privacy

Tandem uses GitHub Copilot CLI and SDK for AI work. Prompts, selected project
context and tool results are processed by the configured AI services; this is
not an offline application. This checkout does not include voice input or
microphone capture. Local workflow records and diagnostic logs remain necessary
for history, troubleshooting and recovery.

Tandem does not configure an analytics exporter. Copilot runtimes can support
optional OpenTelemetry tracing; check the **executing runtime's**
`copilot --version` and `copilot help monitoring`, rather than inferring behavior
from an npm package version. For runtimes whose monitoring help documents the
three activation settings below, tracing is off by default, but inherited
environment settings can enable it. To keep those activation settings unset, run
the following in the PowerShell terminal **before launching Tandem or its host**:

```powershell
Remove-Item Env:COPILOT_OTEL_ENABLED -ErrorAction SilentlyContinue
Remove-Item Env:OTEL_EXPORTER_OTLP_ENDPOINT -ErrorAction SilentlyContinue
Remove-Item Env:COPILOT_OTEL_FILE_EXPORTER_PATH -ErrorAction SilentlyContinue
```

These controls disable optional OpenTelemetry export, not required service
processing, local logs, or other runtime usage collection. They are not a
verified opt-out for all Copilot runtime collection; that dependency's
collection and opt-out coverage still need confirmation before a release can
claim no telemetry. See the [GitHub privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement)
and [Microsoft privacy statement](https://privacy.microsoft.com/privacystatement)
for service data handling.

## License

[MIT](LICENSE.txt). Bundled third-party components retain their own licenses.
See the [renderer bundle notices](development/tandem/public/artifacts/vendor/LICENSES.json),
the [Lucide license](src/vendor/ui-dsl/lucide-LICENSE), and the notices included
in generated bundles and distributions.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft trademarks or logos is subject to and must follow [Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general). Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship. Any use of third-party trademarks or logos are subject to those third-party's policies.

## Citation

To cite this repository, use the following BibTeX entry. Identify the version or
commit you used alongside the citation so readers can find the same source.

```bibtex
@misc{tandem,
  title = {Tandem},
  url = {https://github.com/microsoft/Tandem}
}
```
