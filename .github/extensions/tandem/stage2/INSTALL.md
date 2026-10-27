# Tandem quick start

Tandem is a Copilot extension for designing, building and reviewing a project
together, in a new or existing repository. This is a **developer preview**;
try it on a test repository or a copy of your existing project first.

## Before you start

You need Windows with PowerShell, **Node 24+** on PATH, Git, and an authenticated
Copilot installation that supports extensions. Use an **Interactive** session.
You can use Tandem in a regular browser or a canvas-capable Copilot app.

## 1. Build and install the package

There is no published package download linked yet. For now, generate the
portable package from this repository. From the repository root, run:

```powershell
New-Item -ItemType Directory -Path C:\staging -Force | Out-Null
npm --prefix tandem run package:extension -- C:\staging\tandem
```

`C:\staging\tandem` must not already exist. After the command succeeds,
**that folder is the complete portable package**.

### User-wide installation (recommended)

Install once for your user. New Copilot sessions and Git worktrees discover the
same package without copying it into each repository. Project data stays in
each working folder; installing user-wide does not combine projects or sessions.

Run in PowerShell:

```powershell
$copilotHome = if ($env:COPILOT_HOME) { $env:COPILOT_HOME } else { Join-Path $HOME '.copilot' }
$source = 'C:\staging\tandem'
$target = Join-Path $copilotHome 'extensions\tandem'

if (!(Test-Path -LiteralPath "$source\extension.mjs")) {
    throw 'Build the complete Tandem package first.'
}
if (Test-Path -LiteralPath $target) {
    throw 'Tandem is already installed here. Do not overwrite a running installation.'
}

New-Item -ItemType Directory -Path (Split-Path $target) -Force -ErrorAction Stop | Out-Null
Copy-Item -LiteralPath $source -Destination $target -Recurse -ErrorAction Stop
```

The default destination is `$HOME\.copilot\extensions\tandem`. These commands
honor `COPILOT_HOME`; if your Copilot host uses a different configuration
directory, use that directory for `$copilotHome` instead.

Copy the **whole package**, including `extension.mjs`, `manifest.json`, `src`,
`public`, `runtime-src` and `skills`. Do not copy only `src` or the repository's
discovery shim. No `npm install` is needed to use a packaged extension.
Building the package alone does not install or activate it.

### Repository-local alternative

To pin Tandem for one repository, copy the complete package into an empty
`<your-project>\.github\extensions\tandem` directory. Commit the package before
creating worktrees from that commit; untracked files in the original checkout
do not appear in new worktrees. User-wide installation avoids this requirement.

A project-local `tandem` overrides the user-wide `tandem` in that working copy.
To switch a test project to the user-wide copy, close its Tandem runtime and
Copilot session before removing the redundant local package. Keep this source
repository's development shim when working on Tandem itself. Do not load an old
`living-canvas` extension alongside `tandem`.

## 2. Open Tandem

For a new project, create its folder and run `git init` inside it first.
For an existing repository, use its folder as-is; keep its code and Git history.

**CLI:** From your project directory, start:

```powershell
copilot --experimental
```

Review the extension permission prompt. Check `/extensions` shows
`user:tandem` running (or `project:tandem` for a local installation), then ask Copilot:

> Use `tandem_open_browser` and show me the local URL.

Open the returned URL in a browser on the same machine. This is a tool request
to Copilot, not a shell command. Keep the CLI open while using Tandem.

**Copilot app:** Start an Interactive session in the project and ask:

> Reload extensions, verify Tandem is running, then open the Tandem canvas.

Review any extension permission prompt. User-wide installation also works for
app-created worktrees. An installation copied after session startup needs a
reload in that session; reloading another session does not update it.

## 3. Start a project

Wait for **Ready**, then send your request **inside Tandem**.
Use **Quick requests** beside the composer to insert a common request, edit it,
and press **Send**. Presets keep existing draft text and never send automatically.

**New project:**

> Design a simple task tracker with projects, tasks and due dates.

**Existing code:**

> Explore this repository, generate Design artifacts from the existing code,
> and raise questions about its current design. Do not change the code.

Designer first reads the project, describes the current behavior in artifacts,
and raises questions about uncertain intent or conflicting design evidence.
This establishes a baseline; it does not rewrite the application.

Review the proposed Design and answer any questions in Tandem. When satisfied,
send a separate request to implement it. Review permission requests as they appear.

**Project settings > Models** has optional **Main session model** and **Development
model** selectors. First private creation uses an explicit Development override,
or inherits the current main model when none is saved. Same-ID resume keeps the
private session's model; later main changes do not synchronize it.
Main changes use supported native session APIs with idle/readback checks; an
unsupported host reports the limitation rather than replacing its session.
The status area shows current model and effort for the owning stage, with
not-started/unavailable and native-default/not-reported states kept explicit.
The optional **Reasoning effort** list contains only levels advertised for that
model. **No explicit override** preserves native model-selection behavior; Tandem
does not impose an effort default. Apply is available only while the private
runtime is idle. The status shows authoritative model and effort readback before
an explicit choice is saved. A failed or mismatched update retains pending intent
and blocks new work until you retry or **Accept actual model**.

Saved explicit effort is checked again on same-session reopen, without replaying
work or silently changing retained native settings. Main-chat effort is not
evidence of private workflow or Review-worker effort.

## 4. Close safely

Use **Settings > Diagnostics > Close runtime** and confirm it succeeds before
exiting Copilot. Closing a browser tab alone does not close the runtime.
To return later, resume the **same Copilot session** and open Tandem again;
request a new browser URL if needed.

## Uninstall

First use **Close runtime** in every running Tandem instance and confirm it
succeeds, then exit the affected Copilot sessions. To remove the user-wide
package, run:

```powershell
$copilotHome = if ($env:COPILOT_HOME) { $env:COPILOT_HOME } else { Join-Path $HOME '.copilot' }
Remove-Item -LiteralPath (Join-Path $copilotHome 'extensions\tandem') -Recurse -Confirm -ErrorAction Stop
```

Use the same configuration directory as installation. This removes only the
extension package, not project code or `.tandem` saved data. Repository-local
copies remain available until separately removed from their working copies;
if tracked, commit their removal to stop including them in future worktrees.

## If it does not open

- **Extension missing:** Check the folder layout and launch the CLI with
  `--experimental`. Inspect `/extensions` and its error log.
- **CLI executable not found:** Set `COPILOT_CLI_PATH` to your installed
  `copilot.exe` before starting Copilot.
- **Older installation present:** Do not load `living-canvas` and `tandem`
  together. Close the old runtime and exit its host before moving the old
  extension folder outside discovery directories. Preserve saved data.
  In-place upgrades of older preview workspaces are not supported by this guide.
