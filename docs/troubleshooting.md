# Troubleshooting and lifecycle

[All user guides and version scope](README.md) | [Manual](user-manual.md) | [Recipes](use-cases.md)

Start by reading the current status and selected project folder. A saved artifact,
a running preview, a ready Development context, and a completed implementation
are different things. Do not delete `.tandem`, locks or journals to make an error
disappear, or kill every Node/Copilot process on the machine.

## Stop, Close and returning later

| Action | Consequence |
| --- | --- |
| Navigate to another artifact/phase | Changes what you see, not permission to do work. A live Development draft/context is preserved while hidden. |
| Settings **Close** or Escape | Dismisses settings only. It does not apply/save, discard, stop, or close the runtime. |
| Close a browser tab | Leaves the backend and work running. Unsent page-local input is not a saved request. |
| Host **Reload page** | Reloads the application view, not the extension or app preview server. Copy important unsent input first. |
| Development **Stop after this step** | Lets the current role reach its result boundary, then prevents successors. Already-admitted operations may finish. Existing queued requests are discarded with history retained. |
| Development **Stop options > Stop now** | Requests immediate interruption and can escalate an after-step Stop. Inspect whether interruption succeeded. Partial files and history remain; this is not rollback. |
| Development **Project settings > Diagnostics > Close runtime** | Attempts to save and shut down Development. Saved and closed outcomes are reported separately; inspect any warning. It is not a whole-host exit. |
| Browser host **Stop**, or **Ctrl+C** in its terminal | Shuts down the project backend/host, attempting Development close before main-session shutdown and owned-process cleanup. Inspect any failure rather than assuming it saved. |
| Host **Open folder** and confirmed workspace switch | Stops the previous backend before opening the selected folder. Saved artifacts/history remain; upstream permissions return to **Ask each time**. |
| A process-specific **Stop** / **Stop preview** | Targets that currently owned process when offered, not all project work or unrelated servers. |

To return with the standalone browser launcher, launch Tandem against the same
project folder again. If you use the Copilot extension surface, resume the
original owning Copilot session and reopen Tandem; ask for its browser URL again
if necessary. A different session or copied metadata is not a substitute owner.

Supported reopen verifies retained history and restores access without replaying
queued requests or interrupted approved work. It does not roll project files
back or declare unfinished work complete. A still-valid pending implementation
confirmation can remain pending; review it and decide explicitly. Stop invalidates
that confirmation, and a changed Design requires a new one.

After **Ready**, submit a new instruction if you want to continue:

> Inspect the retained Design and current files. Explain what remains from the
> interrupted work before proposing the next implementation.

## Queued does not mean processed

Development keeps **Queued** above the composer until actual workflow pickup.
Expand a row to inspect its text, attachment and received time. The time is not
a processing timestamp. Required answers may affect when ordinary input can
proceed.

Cancelled, stopped, rejected or recovery-retired requests that never started
remain in **Not started history**, with their original content and times.
Once a request is picked up, it belongs in the normal conversation. A queue row
does not claim a response already happened.

There are no per-message edit/cancel controls in this queue. To stop the workflow,
use the explicit Stop controls and inspect their consequences. Do not use repeated
Send clicks to try to reorder it.

If a submission acknowledgement is uncertain, **Retry exact request**, when
offered, retries that retained submission rather than creating a new one.
For discovery, **Check submission** checks the same available submission record
without repeating its action. After losing the page context, inspect saved state
before submitting again.

## The preview is unavailable

**First, distinguish saved source from a server.** A saved Prototype can remain
valid while its preview server has stopped. A later candidate may also be saved
but not yet displayed.

1. Open Prototype and use **Check again** for the current preview, or **Check
   pending preview** for the waiting version. Checks do not start a server or
   regenerate code.
2. If unavailable, select **Restart preview** for the current displayed version,
   or **Restart pending preview** for the waiting version.
3. Review the exact saved version, executable, working directory and URL.
   For older output without launch information, select/enter its existing
   **Saved Node entrypoint**, review any **Additional arguments**, then choose
   **Review launch**. Arguments use a JSON array of strings, not a shell command.
4. Select **Restart this saved version** only if the proposed launch is correct.
   Respond to any command permission in the owning host.
5. Wait for a verified running result. Restarting the pending version does not
   show it; use its explicit Show action when ready to switch.

The current restart adapter supports **Windows Node entrypoints**. It does not
guess `npm` scripts, install dependencies, substitute a static server, regenerate
the prototype, apply a waiting update or open Development. A verified already-live
server is reused.

Changed source, changed ownership, a denied permission, an unsupported stack,
or an unrelated listener on the saved port is a real blocker. Do not kill that
listener or edit saved launch information to bypass the check. If you do not know
the correct entrypoint, stop and obtain the project's launch instructions.
Keep uncertain launch outcomes visible and use the offered inspection/reconciliation,
not speculative duplicate launches.

## Startup and connection problems

| Symptom | Safe next action |
| --- | --- |
| Node/runtime requirement error | Use actual Node 24+ and the source-candidate build instructions. Electron/Bun compatibility is not implied. |
| Browser did not open | Use the private URL printed in the same launch terminal. Keep it private and local; do not include it in reports. |
| Folder is not a Git root | Open the actual repository/worktree root. For a deliberately new project, initialize Git yourself before Development. Tandem does not initialize, commit or rewrite ignore rules for you. |
| Older installed Tandem conflicts with the candidate | Inspect the reported installation/version. Arrange an explicit stopped-host update using the complete matching package. Do not overwrite the installation, bypass it with partial files, or assume building source updated it. |
| **Ready** never appears / composer disabled | Inspect Development's setup, model and permission status. Loading or unverified history is not an empty project. Keep the existing draft; do not reset discovery to force readiness. |
| Model/effort pending or unavailable | Read both stage results in Project settings. Wait for idle, choose a supported Development model if required, and explicitly apply/reconcile. Main-model settings do not silently replace private settings. |
| **Retry runtime** / **Retry Development** offered after setup failure | Use the contextual retry and inspect its result. It is not permission to create replacement history or replay previous work. |
| Wrong owner, live writer, corrupt or incompatible state | Return to the original project/session and preserve the error. Do not copy another project's metadata, remove locks, or manufacture a fresh identity. |
| Work is quiet | Inspect public activity, last-update age, pending permissions and errors. Silence or polling does not prove failure, success or a need to retry. |
| Microphone fails | Continue with text. Use sign-in only when the voice input identifies an authentication problem; resource configuration and browser permissions are separate. |

For a report, include the source/package version, phase, action, visible error,
and whether saved artifacts are still accessible. Remove private launch URLs,
credentials, personal paths, project content and sensitive diagnostics before
sharing. Historical qualification examples are not proof of the current run.

## Repair only the setup the UI identifies

These are advanced recovery paths, not routine onboarding or generic fixes.

**Verified-empty Development:** if a formerly ready but unused setup cannot
reopen, **Repair Development setup** inspects it. Review **Repair the same
session** only if the displayed project is correct. The application must verify
that there is no prior request, Design, approval or native conversation and no
live owner. The time-limited, one-use confirmation preserves the same identity
and saved audit; it sends no project request. A failed check is not an invitation
to delete evidence. After a successful repair, any prepared Prototype handoff
still needs explicit continuation.

**Older incomplete first startup:** **Inspect unused setup recovery**, when
offered, checks whether the original setup never created usable work.
**Authorize one-time initialization** is a separate, time-limited decision after
inspection, not implementation approval or ordinary Retry. An unavailable
history check never counts as proof that nothing exists.

**Used or interrupted work:** neither empty-setup flow applies after work was
admitted. Use normal Close/host Stop and same-owner reopen, inspect retained
history, then send a fresh request after Ready. Reconciliation of an already
admitted Prototype handoff never restarts its retired work.

**Interrupted discovery launch:** **Recover interrupted discovery**, if offered,
requires explicit confirmation after Tandem verifies it can safely abandon an
uncertain launch. It retains Requirements, saved files and the original unknown
outcome. It does not assert success, cancel active workers or replay anything.
Unavailable or changing evidence keeps recovery blocked.

## Maintenance is not refresh or a new project

These controls describe the committed maintenance candidate identified in the
[version scope](README.md#which-version-does-this-guide-describe). Older builds
may still have generic header controls; do not infer equivalent behavior from
the label alone.

**Reload Tandem extension** appears only for supported installations. Before
Development, find it in **Project settings > Advanced project diagnostics**.
The integrated Development settings expose the same guarded action under
**Diagnostics**. Use it after an intentional local extension update, not to
download an update or restart your prototype.

Finish discovery work and close Development first. Active or unknown Development
blocks reload. Reload can restart this Copilot session's extension connections,
including other extensions, and unsent form text may be lost. Saved Tandem files
and history are not archived or reset. Unsupported installations do not gain this
action; use their supported stopped-host update path instead.
Reload failures remain visible in the root status bar and hosted error banners
even after Project settings closes; reopening Settings also shows the failure.

**Restart Preparation...** lives in **Preparation > Advanced Preparation
actions**, for a project that used discovery. It is absent on an empty goal form
or a direct-Development project without discovery. Review the confirmation:
Tandem first stops discovery work, then archives Preparation, Requirements,
Drawings and Prototype state/files and returns to the goal form. If stopping
cannot be confirmed, it keeps the effort and reports recovery instead.

Close Development before restarting Preparation. Its Design, Conversation,
application files and admitted handoffs are preserved, as is the folder's
original starting choice. This is not a way to make a different canonical
project; use another project folder for unrelated work.

If an archive/restart was interrupted, use the visible **Restart Preparation**
recovery action after reviewing the status. A supported extension reload may
reconnect the UI, but it does not clear that recovery barrier or resume workers.
Never delete the saved state to bypass either operation.
