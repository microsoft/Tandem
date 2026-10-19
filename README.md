<picture>
  <source media="(prefers-color-scheme: dark)" srcset="development/tandem/public/branding/tandem-blue-dark.png">
  <img src="development/tandem/public/branding/tandem-blue-light.png" alt="Tandem logo: a blue bicycle built for two beside the Tandem wordmark." width="420">
</picture>

# Tandem

**You and Copilot, thinking together before building.**

![Original illustration of a person and Copilot discussing a user journey, interface sketch and technical flow on a shared whiteboard.](docs/images/tandem-vision.svg)

Tandem is a collaborative workspace for turning ideas and existing code into
software you understand and intend. Discuss the experience, make decisions
visible in drawings and Design artifacts, then explicitly approve implementation.

It is for developers, designers and project owners who want to work with a coding
agent without leaving product decisions hidden in a prompt.
The illustration above expresses that vision; it is not a product screenshot.

## Why Tandem?

- **See the idea before committing to it.** Explore requirements, drawings and
  interactive prototypes instead of reconstructing everything from a long spec.
- **Start where your project is.** Discover a new idea or work directly from an
  existing application; Preparation is optional.
- **Keep implementation tied to your decisions.** Review the Design, approve
  the proposed work, and inspect implementation and Review outcomes.

Read [the Tandem story](docs/the-tandem-story.md) for the approach and a concrete
example.

## Get started

**Source preview:** the instructions below build this checkout; they do not
install a published release. Use Windows with PowerShell, actual **Node 24.15+
(24.x LTS) or Node 26+**, Git, and a Copilot account with the required model access.
Other platforms are not yet qualified. The browser app does not require .NET or a running Copilot
desktop app.

From your Tandem source checkout, run:

```powershell
npm ci
npm run build:browser
node .\dist\browser\cli.mjs login
node .\dist\browser\cli.mjs --workspace C:\projects\my-app
```

Replace `C:\projects\my-app` with your project folder (the repository/worktree root
for existing Git projects), not the Tandem source folder. Before Development,
Tandem offers explicit local Git setup when needed;
[the quick start](docs/quick-start.md) shows both paths. Use a test
project or worktree for your first trial.

**What you will see:** Tandem opens your project folder and asks where to start:

| Start with Preparation | Go to Development |
| --- | --- |
| Clarify an idea through Requirements, Drawings and Prototype, then continue into Development. | Explore existing files or refine a rough idea directly in Design and Conversation. |

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
| [Task recipes](docs/use-cases.md) | Revise a prototype, refine Design, use voice, or export an outcome. |
| [Troubleshooting](docs/troubleshooting.md) | Handle queued work, unavailable previews, Stop and reopen. |

The [documentation index](docs/README.md) also links advanced configuration and
engineering references.

<details>
<summary>Optional presentation background</summary>

The [six-slide opening presentation](development/docs/tandem-opening-slides-v2.html#1)
and [extended background deck](development/docs/tandem-opening-slides-light.html#1)
provide historical illustrations, a development walkthrough and discussion notes.
The guides above stand on their own. Open the checked-out HTML locally; the
screenshots are not evidence of current capabilities or test results.

</details>

## Development and contributions

Contributions are subject to the Microsoft Contributor License Agreement; see
[CONTRIBUTING.md](CONTRIBUTING.md) for the CLA process and submission guidance.
Please follow our [Code of Conduct](CODE_OF_CONDUCT.md).

Work from source in `src` and `development\tandem`; do not hand-edit the generated
extension under `.github\extensions\tandem`. From the repository root:

```powershell
npm run check
npm test
npm run build
```

For Stage 2 changes, also follow its [contributor instructions](development/AGENTS.md).
See the [engineering reference](docs/engineering-reference.md) for architecture
boundaries, packaging, optional hosts and qualification limits.

For a bug report or proposed change, describe the expected behavior, what happened,
and the source/package version. Keep private launch URLs, credentials and
sensitive project content out of reports. Report security vulnerabilities through
the process in [SECURITY.md](SECURITY.md), not a public issue.
See [SUPPORT.md](SUPPORT.md) for help and support channels.

## Data and privacy

Tandem uses GitHub Copilot CLI and SDK for AI work. Prompts, selected project
context and tool results are processed by the configured AI services; this is
not an offline application. Optional voice input sends audio to your configured
Azure Speech resource; live voice uses your configured Azure OpenAI endpoint.
Do not enable voice or grant microphone access if you do not want audio sent.
Speech SDK diagnostic telemetry is disabled by Tandem. Local workflow records
and diagnostic logs remain necessary for history, troubleshooting and recovery.

Tandem does not configure an analytics exporter. In the pinned Copilot CLI
1.0.94 / SDK 1.0.18 runtime, optional OpenTelemetry tracing is off by default,
but inherited environment settings can enable it. To keep it disabled, run
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

### Third-party code

The repository includes offline renderer bundles built from Mermaid, marked,
Ajv, parse5, css-tree and jpeg-js, with their transitive components, in
`development/tandem/public/artifacts/vendor`. Their notices are recorded in
[LICENSES.json](development/tandem/public/artifacts/vendor/LICENSES.json);
the generated extension carries copies under
`.github/extensions/tandem/stage2/public/artifacts/vendor`.
Builds also bundle npm dependencies for the UI and host, including React,
Radix UI, Lucide, Azure Identity, Azure Speech and ws, preserving notices in the
generated JavaScript. The manifests and lockfiles describe installed
dependencies separately from these checked-in bundles. Standalone distributions
install the Copilot CLI/SDK and other runtime dependencies under their own
licenses; the desktop distribution also includes Node.js and its license.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft trademarks or logos is subject to and must follow [Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general). Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship. Any use of third-party trademarks or logos are subject to those third-party's policies.
