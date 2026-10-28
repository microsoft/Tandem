# Contributing to Tandem

This project welcomes contributions and suggestions. Most contributions require you to agree to a
Contributor License Agreement (CLA) declaring that you have the right to, and actually do, grant us
the rights to use your contribution. For details, visit [Contributor License Agreements](https://cla.opensource.microsoft.com).

When you submit a pull request, a CLA bot will automatically determine whether you need to provide
a CLA and decorate the PR appropriately (e.g., status check, comment). Simply follow the instructions
provided by the bot. You will only need to do this once across all repos using our CLA.

## Code of conduct

This project has adopted the [Microsoft Open Source Code of Conduct](CODE_OF_CONDUCT.md).
For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/)
or contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

## Issues and proposed changes

Search [existing issues](https://github.com/microsoft/Tandem/issues) and
[pull requests](https://github.com/microsoft/Tandem/pulls) before opening a new one.
For substantial changes, open an issue to discuss the proposal first.
Bug reports should include the source/package version, operating system, expected
and actual behavior, and steps to reproduce. Keep credentials, private launch URLs
and sensitive project content out of reports and test fixtures.

Report security vulnerabilities privately through [SECURITY.md](SECURITY.md),
not public issues or pull requests. See [SUPPORT.md](SUPPORT.md) for help.

## Local development

Use Windows with PowerShell, Git, and actual Node 24.15+ (24.x LTS) or Node 26+.
From the repository root:

```powershell
npm ci
npm --prefix development\tandem ci
npm run check
npm test
npm run build
```

The [README](README.md#get-started) explains how to build and launch the browser app.
Copilot-backed use requires a Copilot account and model access; ordinary checks
and deterministic tests do not require live model calls. Do not run live
evaluations without explicit model and execution limits.

Both dependency trees use committed lockfiles. Edit maintainable source in
`src` and `development\tandem`, not generated payloads
under `.github\extensions\tandem`. Follow existing TypeScript types, naming and
formatting, add focused regression tests for behavior changes, and update related
documentation. Changes within `development` must also follow its
[contributor instructions](development/AGENTS.md). The
[engineering reference](docs/engineering-reference.md) covers architecture,
packaging and qualification limits.

## Submitting a pull request

Create a branch in your fork, keep changes focused, and submit a pull request
against `main`. Describe the problem, the change, related issues, and the checks
you ran (including any checks you could not run). Do not include credentials,
local `.tandem` state, or unrelated generated files. Passing checks does not
establish native/UI qualification; describe observed behavior accurately.
