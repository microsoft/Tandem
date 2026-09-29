# Starting and reopening a real-project test

Use this guide for repeatable Stage 2 project qualification. Normal users should
follow [the installation guide](../tandem/INSTALL.md); they do not need the SDK
launcher or startup workaround below.

## Choose one host, then keep its identity

There is one product sequence:

**Start the owning Copilot session -> register Tandem -> open Tandem ->
create or recover its private workflow session.**

| Host | Use |
| --- | --- |
| Normal Copilot CLI or app | Normal product usage. The host presents extension consent. The earlier complete tracker test qualified same-session reopening through the ordinary CLI. |
| SDK-hosted CLI | Automated, isolated qualification. A script owns the main CLI process, handles startup consent and opens the real registered extension. Project work still goes through Tandem's UI and native roles. |

An SDK main-host registration failure before the canvas opens is **not evidence
that Tandem's private workflow reopen failed**. Record the failing stage.
Do not switch between host types, session identities or SDKs inside an attempt
without recording a new attempt and the changed conditions.

## Prepare once

Use Node 24+ and an existing authenticated Copilot CLI/SDK. Do not install or
upgrade Copilot as a test prerequisite. Record the executable and resolved SDK
paths, their SHA256 hashes, reported versions, source commit and package manifest
hash. Version-directory names alone are not reliable runtime identification.

From the **Tandem repository root**, build the complete Stage 2 package:

```powershell
New-Item -ItemType Directory -Path C:\tandem-tests\run-001 -ErrorAction Stop
npm --prefix stage2\tandem run package:extension -- C:\tandem-tests\run-001\package
```

The destination must not exist; its parent must exist. Create a fresh Git project
under this owned root and copy the **whole package** into
`project\.github\extensions\tandem`. Never copy just `src` or a discovery shim.
Keep the test home, browser profile, receipts and generated project under this
root. Never use an existing user preview or frozen evidence directory as scratch.

For the SDK host, use an exclusive `baseDirectory` for Copilot state and an
explicit `workingDirectory` for the test project. `baseDirectory` sets the spawned
runtime's `COPILOT_HOME`; it is not a reason to replace installation paths or copy
credentials. Inherit the existing host environment unless testing a particular
environment override. Clear inherited extension identity variables when starting
the **main** host: `SESSION_ID`, `COPILOT_EXTENSION_PARENT_PID`,
`COPILOT_SDK_PATH`, and `TANDEM_PRIVATE_WORKFLOW_SESSION`. The actual provider
identity must come from the runtime.

Persist the main session ID and verify Tandem's separately assigned private ID.
Only fresh creation chooses a new main ID. Reopening reuses both saved identities,
the same project and the same owned home.

## Fresh start

### Normal CLI or app

Start an Interactive session in the test project, approve the exact extension
capabilities, then open Tandem. For a CLI test with an explicitly retained main ID:

```powershell
# $cli is the previously verified executable; $mainId is this test's saved UUID.
Set-Location -LiteralPath $project
& $cli --experimental --no-auto-update --session-id $mainId
```

Ask the owning session to use `tandem_open_browser`. In the app, opening the
Tandem canvas is also supported. These are registered extension operations, not
shell commands. A browser tab is only a view; keep its owning host alive.

Inspect a fresh terminal screen before responding to prompts. Never send blind
Enter keys against stale output. Decline unrelated installer/download offers.
If the terminal reports success but has no live process or current output, stop
using it as an input channel; do not guess which prompt has focus.

### SDK main host

Use the installed SDK's public `CopilotClient` and
`RuntimeConnection.forStdio({ path: cliPath, args: ["--no-auto-update"] })`.
Set `workingDirectory: project` and `baseDirectory: ownedHome`.
Pass these session options on creation and supply the matching callbacks again
on resume:

```js
const options = {
  sessionId: mainId,
  workingDirectory: project,
  enableExperimentalMode: true,
  enableConfigDiscovery: true,
  requestExtensions: true,
  requestCanvasRenderer: true,
  extensionSdkPath: installedSdkDirectory,
  onPermissionRequest,
  onEvent,
};
const session = await client.createSession(options);
```

`onPermissionRequest` belongs to the test host. Present the actual request for
human approval, or apply a narrowly pre-authorized test decision matching its
session, extension ID and exact requested capabilities. Return `approve-once` or
`reject`; do not use `approveAll`. Record both the decision and the later native
`permission.completed` event. Callback return is **not** native completion.

Wait for the canonical `project:tandem` / `tandem` canvas catalog entry and a
responsive Interactive session before opening it. Through the public canvas RPC,
open an instance, invoke its `open_browser` action and use the returned URL. Do
not invent or reuse a port from an earlier process.

Finally verify HTTP success and **both installation and workflow Ready** through
the product UI/snapshot. Opening the surface must not submit a project request.
Main-session model settings do not prove private-session settings: select the
requested model/effort through Tandem Settings and verify actual private readback
before work. Effort selection requires a candidate containing that feature;
do not equate absent/null effort with an explicitly selected level.

## Normal Close and same-session reopen

1. Capture current request state, canonical Design, conversation/history and
   project data. Finish or explicitly Stop work through Tandem; do not kill a
   worker to manufacture a clean result.
2. Use the actual **Settings > Diagnostics > Close runtime** UI. Record saved and
   closed outcomes independently, including warnings.
3. Exit the owning CLI normally, or call the SDK host's `client.stop()`. Require
   actual completion and verify owned process exits. Do not overwrite a package
   while its provider or private runtime is alive.
4. Preserve the project, `.tandem`, owned Copilot home and session IDs. For an
   intentional candidate change, archive the old complete package and receipts
   and fingerprint the replacement before relaunch.
5. Restart the **same main ID**. Ordinary CLI uses its usual consent UI. An SDK
   host on the affected runtime uses the deferred activation below.
6. Obtain a fresh Tandem URL. Verify the **same private ID**, preserved Design,
   conversation, project files and data, and no automatic old-request, role,
   factory or app-process replay. Legitimate recovery status records need not
   make the history byte-identical; audit preservation and allowed additions.
7. Submit a new explicit request to prove new work operates. Reclose and verify
   cleanup. Merely obtaining a URL is not full reopen qualification.

## SDK cold start: defer extension activation

**Test-launcher workaround only.** On the diagnosed runtime, automatic
permission-bearing extension activation during SDK `resumeSession` can block
registration: the approval response and other same-session RPCs stay pending
while server ping still responds. The same failure was reproduced without
Tandem and with both pre-factory and current packages.

The following ordering passed full-package registration controls, including a
rejection control. It uses documented public APIs, but the ordering is an
**experimentally qualified workaround**, not an official SDK startup recipe.
It does not change Tandem's production private-provider bootstrap.

For an **exclusive test home with default extension settings**, the core sequence
is:

```js
await client.start();
const original = await client.rpc.user.settings.get();
assert.equal(original.settings.extensions.isDefault, true);

const change = await client.rpc.user.settings.set({
  settings: { extensions: { disabledExtensions: ["project:tandem"] } },
});
assert.deepEqual(change.shadowedKeys, []);
// Also verify that ownedHome/settings.json contains this exact setting.

const session = await client.resumeSession(mainId, {
  ...options,
  continuePendingWork: false,
  suppressResumeEvent: true,
});
assert.equal(await session.rpc.mode.get(), "interactive");
const { extensions } = await session.rpc.extensions.list();
const target = extensions.find(item => item.id === "project:tandem");
assert.equal(target?.status, "disabled");
assert.equal(target.pid, undefined);

await session.rpc.extensions.enable({ id: "project:tandem" });
// Require native permission.completed with approval AND the canonical canvas
// catalog entry before opening Tandem. Rejection is not readiness.
```

This is the ordering to integrate into a host, not a complete unattended launcher:
`client`, paths, callbacks, event correlation, cleanup and `assert` must be
provided. Keep the ordinary capability approval gate. No model turn or canvas
opening is allowed between resume and successful registration.

For non-default settings, **do not run the replacement snippet unchanged**.
`settings.set` replaces the top-level `extensions` object. Preserve its fields and
other disabled IDs, add only the owned target ID, and verify effective settings,
`shadowedKeys` and the actual owned file location. Never modify normal user/global
settings or attempt to enable an extension disabled by policy.

`session.extensions.enable` removed the target from the owned persistent disabled
list in the controls. Reapply temporary disable before **each** cold start.
Restore the original owned setting when handing the environment back, after
checking for intervening changes; `null` removes a top-level override. Do not
blindly overwrite unrelated/concurrent preferences or delete the whole file.

Do not substitute `requestExtensions:false` followed by resident `true`: that
sequence also reproduced the hang. Delaying approval until
`session.extensions_loaded` did not fix it either. The successful change was
deferring **activation**, not consent.

## Readiness, failures and cleanup

Keep launcher controls available **before** awaiting create/resume, not just after
Ready. Provide authenticated, loopback-only controls for normal `client.stop()`
and, when authorized and necessary, public `client.forceStop()`.

| Observation | Interpretation/action |
| --- | --- |
| Early `failed` inventory or provider `ready-timeout` log | Not alone proof of final failure. Capture subsequent events/catalog and allow bounded startup observation. Fresh startup has subsequently succeeded. |
| Resume acknowledgement or `extensions_loaded` / `running` | Not alone proof that consent and provider registration completed. |
| Approval callback returned, no `permission.completed` | Record the permission-response RPC boundary. Do not fabricate approval completion or bypass the gate. |
| Session calls hang, ping/status respond | Session-local blockage, not proof of total transport failure. Preserve the trace; do not issue overlapping retries. |
| Observation deadline expires | Waiting ended; the RPC/run may still be active. It was not automatically cancelled. |
| `client.stop()` hangs | It may be awaiting detach. Use public `forceStop()` for this owned runtime when necessary and record forced, not graceful, shutdown. |

Observe process identity with PID **and creation time**, executable and lineage.
Verify disappearance after cleanup. Never kill by process name or touch a recycled
PID, another browser profile, the user's app or an unrelated preview.

Startup/RPC observation deadlines are not model or factory execution limits.
Agree live-test model, effort and execution limits separately; do not impose an
execution timeout when the user requested none. Do not silently retry work whose
effects are unknown.

## What constitutes a real-project pass

Drive Design, a separate implementation request and its confirmation through the
actual UI. Let native roles generate the project. Exercise the resulting app
with browser interactions and disposable data; corrections go through a new
Tandem request, not harness edits to generated source.

Keep these results separate:

- Main host/provider startup and consent.
- Private Ready and actual model/effort.
- Real factory run/worker identities, source reads, configured model/effort and
  concurrency; collected evidence and one parent canonical report.
- Physical application acceptance, retained data and responsive attached preview.
- Stop during a live factory and same-session Close/reopen without replay.

Record request/role/run correlations, commands and effects, expected versus actual
results, candidate/runtime fingerprints and cleanup. Never turn a synthetic
factory probe, transient Ready, test-runner exit code or worker-reported completion
into a whole-project pass.

## Evidence and API references

The September 29, 2026 registration controls used:

| Component | SHA256 |
| --- | --- |
| CLI executable | `e8a40dfea24f81869dfff21f2143710e797f2052affb4b4efeb3fdc0ed108397` |
| Desktop SDK `index.js` | `0a5fe444ce7194d66a8834ef690a54df867f3f8da0c6b57daaba845effe590bc` |

Reported runtime labels differed; hashes identify the pair. Full pre-factory
`3989412` and factory/effort `d25efcb` packages failed automatic cold activation and
passed deferred activation on that pair. Rejecting consent left the canvas catalog
empty while session calls and graceful shutdown remained responsive.

These controls qualified **registration only**: they did not open the canvas,
start private work or use model calls. They establish an ordering-dependent
failure, not the exact internal mutex or a universal runtime-version defect.
Full integrated lifecycle evidence must come from the separate project journey.

The retained diagnostic bundle is named `sdk-consent-diagnosis-20260929`
(`conclusion.json`, `verification.json`, `probe.mjs`, `audit.mjs`); the matched
package comparison is `registration-package-ab`. These are historical session
artifacts, not portable repository scripts or prerequisites for running this guide.

Use the installed SDK declarations for exact version-specific signatures:
`types.d.ts` (`baseDirectory`, `onPermissionRequest`) and
`generated/rpc.d.ts` (`user.settings.get/set`, session `extensions.enable`).
Bundled `docs/extensions.md` and `docs/examples.md` explain registration and
permission handlers. Public references:

- [Node.js SDK](https://github.com/github/copilot-sdk/blob/main/nodejs/README.md)
- [SDK/CLI permission control](https://github.com/github/copilot-sdk/blob/main/docs/troubleshooting/compatibility.md#permission-control)

Public `main` may be newer than the installed SDK. Do not upgrade a running test
or invent an API merely because a newer reference mentions it.
