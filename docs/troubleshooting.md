# Troubleshooting

[All guides](README.md) | [Manual](user-manual.md) | [Detailed recovery contracts](engineering-reference.md#state-migration-and-recovery)

Read the current status and project folder first. **Do not delete `.tandem`,
locks or journals, copy another project's state, or kill all Node/Copilot
processes to bypass an error.**

## Stop, Close and returning later

| Action | What it does |
| --- | --- |
| Browse another phase/artifact | Changes the view, not permission to work. Hidden Development draft/context stays intact. |
| Settings **Close** / Escape | Dismisses Settings only; does not save, apply or stop. |
| Close a browser tab | Leaves work running. Unsent page-local text is not saved history. |
| Host **Reload page** | Reloads the view, not the extension or preview server. Copy important drafts first. |
| **Stop after this step** | Stops at the current role's result boundary; no successors start. Already-admitted operations may finish. Queued requests are discarded with history retained. |
| **Stop options > Stop now** | Requests immediate interruption, including escalation of an after-step Stop. Inspect its outcome; partial files/history remain. |
| **Project settings > Diagnostics > Close runtime** | Attempts to save and close Development, not the whole host. Saved/closed outcomes can differ; read warnings. |
| Host **Stop** / terminal **Ctrl+C** | Attempts Development close, then shuts down the project host and its owned processes. Check failures. |
| **Open folder** and confirmed switch | Stops the previous backend; preserves history and restores upstream **Ask each time** permissions. |
| Process-specific **Stop** / **Stop preview** | Targets that currently owned process only. |

**Stop is not rollback.** Inspect partial files before continuing.
With the standalone launcher, reopen the same project folder. With the Copilot
extension, resume the original owning Copilot session and reopen Tandem.

Supported reopen restores verified history without replaying interrupted work
or old queues, restoring project files, or claiming completion. A valid pending
implementation confirmation can remain pending, never automatically approved.
Stop invalidates it; changed Design requires a new one. After Ready, send a
fresh instruction accounting for retained work.

## Queued does not mean processed

Development's **Queued** list stays above the composer until actual workflow
pickup. Expand a row for its original text, attachment and received time; that
is not a processing timestamp. Required answers can hold ordinary input.

**Not started history** retains cancelled, stopped, rejected and recovery-retired
requests that never started. There are no per-message edit/cancel controls.
Do not resend to reorder the queue; use workflow Stop deliberately.

For an uncertain acknowledgement, use **Retry exact request** when offered,
not a new message. Discovery's **Check submission** reads the same available
submission record without repeating it. If the page context was lost, inspect
saved state before submitting again.

## The preview is unavailable

A saved Prototype and its preview server are different. A stopped server does
not erase saved source or feedback.

1. Use **Check again** for the current preview, **Check pending preview** for
   the waiting version, or **Check visual preview** for design alternatives.
   Checks start no server/model work.
2. Choose **Restart preview**, **Restart pending preview**, or **Restart visual
   exploration** for that exact saved version.
3. When start instructions were saved with the prototype, review the summary.
   Older previews show detected **Start options** from existing server files or
   supported package scripts. Choose one and select **Review restart**.
   Raw paths and command arguments are available under **Advanced setup**, not
   required for a saved launch.
4. Confirm **Restart preview**, answer any owning-host permission,
   and wait for verification.

**Result:** the saved server is running, not regenerated or promoted.
Restarting pending output does not display it; use its Show action separately.
An already-verified live server is reused.
Restart supplies the saved URL's port as `PORT` for Node servers that read it;
it does not choose a different port or replace an unrelated listener.
Restarting visual exploration retains its per-direction settings and does not
apply any alternative. If a running preview cannot confirm visual controls,
check it again and inspect the error; do not substitute another checkpoint or
claim that an adjustment was applied.

If no start option is found, **Advanced setup** lists existing JavaScript files
inside the saved preview. Select the script that starts the server (for example,
`app\server.mjs`), not `index.html`, `src\main.tsx` or a browser component. Set
**Start in folder** to its working folder (`.` means the saved preview root),
and enter each argument on a separate line. No JSON or shell quoting is needed.
Use the original launch instructions rather than trying arbitrary files.

This adapter supports Windows Node server scripts only. Detection reads direct
`node` commands in `package.json`; it does not execute npm lifecycle hooks,
shell commands, Vite CLI, or another stack. Unsupported start options are
explained. It does not install dependencies or substitute another server. Changed source/owner,
unsupported stacks, denied consent or foreign port listeners block it.
Obtain the correct launch instructions rather than killing listeners or editing
saved metadata. Inspect uncertain attempts before launching again.

A foreground-busy message applies before starting a new server, not while
checking one Tandem just launched. If startup fails, inspect the reported process
error rather than clearing session state or retrying an unrelated task.

## Startup and connection problems

| Symptom | Next step |
| --- | --- |
| Runtime requirement error / npm `EBADENGINE` | For source builds, use actual Node 24.15+ (24.x LTS) or Node 26+ and rerun the [source quick start](quick-start.md). A successful install with an engine warning does not establish support. |
| Browser did not open | Use the private URL from the launch terminal; never share it. `--no-open` prints it without opening a browser. |
| Folder is not a Git root | For a new folder, review **Set up this folder and continue** with either starting path. Older projects can need the same project setup when entering Development. For a subfolder, explicitly open the repository/worktree root named in the prompt; Tandem never silently switches or nests a repository. |
| Git setup could not finish | Read what was attempted. Git metadata and ignore content are retained, not rolled back. Resolve the reported permission or file problem, then **Check again** and review fresh consent. |
| Application state must be ignored by Git | Review the offered setup to add `.tandem/`, or use the [manual alternative](quick-start.md). Check `git status` before committing. |
| Git tracks `.tandem/` state | An ignore rule does not untrack existing files. Deliberately untrack that state yourself after reviewing it, without deleting local session data. Tandem never automatically untracks or deletes files. |
| Older installation conflicts | Review its version and arrange an explicit stopped-host update with the complete package. Building source does not update it. |
| Composer disabled / no Ready | Inspect setup, model and permission status. Unverified history is not empty state. |
| Model/effort pending, busy or unavailable | Read both stage results in Settings, wait for idle and explicitly apply/reconcile a supported selection. |
| Contextual **Retry runtime** / **Retry Development** | Inspect the failure and retry there; this does not authorize replacement history or replay. |
| Wrong owner, live writer or corrupt state | Return to the original project/session and retain the error. Do not bypass ownership. |
| Quiet work | Inspect activity, last-update age and permissions; silence is not proof of failure or success. |
| Microphone failed | Continue with text. **Dismiss** clears the standalone host's failed-operation notification only; it does not configure Azure, sign in, retry or restart work. Details remain in host **Diagnostics** and `.tandem/desktop/browser.log`. A new failure appears again. Use voice sign-in only for its identified credential error. |

For a report, include version, phase, action and visible error. Remove private
URLs, credentials, personal paths and sensitive project content first.

Startup/runtime blockers, lost connections and pending permission prompts cannot
be dismissed this way. Embedded recovery messages keep their existing actions.
Browser-local action failures remain in **Diagnostics** for the current tab and
workspace; dismissing them sends no command to the runtime.

## Advanced recovery

<details>
<summary>Unused setup, empty-session repair, or interrupted discovery</summary>

Use only the flow offered for the verified condition:

- **Repair Development setup > Repair the same session** is for a previously
  ready but unused setup with no request, Design, approval or native conversation.
- **Inspect unused setup recovery > Authorize one-time initialization** is for
  older incomplete first startup, after absence is verified.
- **Recover interrupted discovery** can abandon a verified-idle uncertain launch
  while preserving Requirements, saved files and its unknown outcome.

Setup confirmations are time-limited and one-use. They retain the original
identity/audit and send no project request. Failed/unavailable checks do not prove
absence. A prepared Prototype handoff still needs explicit continuation.

Used/admitted work is not empty setup. Use normal Close/Stop and same-owner reopen,
then fresh instructions. Recovery does not prove prior success or replay retired
work. See [full conditions](engineering-reference.md#state-migration-and-recovery).

</details>

## Maintenance is not refresh or a new project

<details>
<summary>Reload Tandem extension or restart Preparation</summary>

**Reload Tandem extension** is available only for supported installations:
before Development, **Project settings > Advanced project diagnostics**;
in integrated Development settings, under **Diagnostics**.

Use it after an intentional local extension update. Finish discovery and close
Development first; active/unknown Development blocks it. It can restart this
session's other extension connections and lose unsent text, but does not
archive/reset saved data, download updates or refresh the app preview.
Failures remain in the root status bar/hosted error banners after Settings closes.

**Restart Preparation...** lives in **Preparation > Advanced Preparation actions**,
not empty goal entry or direct Development without discovery. After confirmation,
it stops discovery, archives Preparation/Requirements/Drawings/Prototype state and
files, and returns to goal entry. Unconfirmed stopping leaves recovery visible.

Close Development first. Its Design, Conversation, app files, handoffs and the
folder's saved starting choice remain. Use another folder for an unrelated
project. For interrupted archive/reset, review the displayed **Restart Preparation**
recovery action; supported reload can reconnect but cannot clear the barrier
or resume work.

</details>
