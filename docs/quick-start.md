# Quick start

[All guides](README.md) | [User manual](user-manual.md)

Open a project, make its intended behavior visible, then decide whether to
implement it. **Preparation is optional; implementation always needs an
explicit decision.**

## 1. Launch the source preview

You need Windows, PowerShell, actual **Node 24.15+ (24.x LTS) or Node 26+**, Git,
and a Copilot account with the required model access. These commands build source,
not a published release or global installation. No .NET or running Copilot desktop app is needed.
Check `node --version` first: Node 24.0 through 24.14 and Node 25 do not satisfy
the locked source dependencies, even if npm only warns and the build succeeds.

Use an existing Git repository/worktree root, preserving its files. For your first
trial, use a test project or worktree. To create a new project instead:

```powershell
New-Item -ItemType Directory -Path C:\projects\counter
```

An initial commit is not required. Tandem offers consented local Git setup for
either starting path; manual setup is an alternative, not a prerequisite.
From your **Tandem source checkout**, separate from that target project:

```powershell
npm ci
npm run login:browser
npm run browser -- --workspace C:\projects\counter
```

Both browser scripts build the app automatically. `npm run login:browser` signs
in to Copilot. Review startup permissions and keep this terminal open.

### Test source alongside an installed Tandem

Use an explicit isolated launch when your installed Tandem differs from this
checkout:

```powershell
npm run browser -- --source-preview --workspace C:\projects\counter
```

The native SDK launch resolver admits only the complete matching Tandem payload
staged into that same session; it refuses other discovered extension entrypoints
before they execute. The main session also disables automatic configuration
discovery for agents, hooks and MCP configuration; the bundled Tandem skill
remains available. Turning off configuration discovery alone does not isolate
native extensions. This is execution/configuration isolation, not a filesystem sandbox.
It does not change the global installation, copy credentials, create another
profile, replace the saved session, choose a model or approve permissions.
It requires the SDK/runtime's extension launch-profile support; an unsupported
runtime fails instead of reverting to the installed extension launcher.
Private Development keeps its separate native ownership and consent.
The same flag is accepted by `npm run dev:browser -- ...`.

Normal launches without the flag keep installed-provider precedence. A mismatched
preferred provider still fails visibly; isolation is never an automatic fallback.
If another Tandem provider remains active in an isolated main session, startup
fails instead of making the session copy writable over it.

### Main-session model options

To choose the main/Preparation model and effort explicitly, add launch options:

```powershell
npm run browser -- --workspace C:\projects\counter --model gpt-6-astra --reasoning-effort low
```

Use a model available to your account. The launcher checks the native catalog and
actual readback before opening Tandem; it does not silently substitute a model.
Omitting both options preserves the native session's saved selection. If it has
no selected model, standalone startup selects the first available model in the
owning native catalog's preferred-default order and verifies actual readback
before opening the project. It does not choose a fixed effort level or copy
another Copilot chat's settings. If Stage 1
effort remains pending with no actual model, stop the host and reopen the same
folder with an explicit model. **Project settings** also provides separate,
optional **Main session model** and **Development model** selectors in one window.
Without a Development override, its first private session inherits the main
session's actual current model, then keeps its own saved selection. Later main
changes do not switch Development. Effort is not copied: native defaults/saved
effort apply unless you explicitly choose a supported shared Project effort.
The status area shows the viewed session's current model and effort; unreported
values are labeled rather than guessed.

**You should see:** your project folder and **Choose where to start**.
Returning projects use their saved choice and progress. If startup fails, use
[troubleshooting](troubleshooting.md#startup-and-connection-problems).

<details>
<summary>Set up Git manually instead (optional)</summary>

For the new folder above:

```powershell
git -C C:\projects\counter init
Add-Content -Path C:\projects\counter\.gitignore -Value '.tandem/'
```

For an existing repository, preserve its files and ensure `.gitignore` excludes
`.tandem/` before committing. This keeps local session state and diagnostics out
of Git. An ignore rule does not untrack existing files; review those deliberately.
Do not ignore `tandem-records` merely because operational state is private.

</details>

## 2. Choose your starting path

The choice is saved in this folder's `.tandem` metadata, not asked every visit.
These are recommendations, not rules about how many files a project contains.

For either path, Tandem checks the selected folder before saving your choice.
Existing repositories/worktrees are reused. If prompted, review **Set up this
folder and continue**: it initializes local Git only when needed and adds
`.tandem/` to `.gitignore`, preserving files and rules. No commit, remote or push
is created. **Cancel** performs no setup and leaves the starting choice unsaved.
Choosing Preparation does not open Development.
After setup, **Opening your selected project...** stays visible until entry
finishes; you are not asked to choose the starting path again. Cancellation
returns to the chooser, and a failed entry offers an explicit retry.

### Start with Preparation

Use this path to clarify requirements and UX.

1. Enter a goal such as "A keyboard-friendly counter with increment, decrement
   and reset" and select **Start project**.
2. In **Requirements**, **Add usage** entries you care about, then **Generate
   requirements DAG**. Tandem researches relevant missing facts for those usages
   before generating questions; **Research and sources** retains its findings.
   Answer the connected decisions with **Use this answer** and finish the phase
   when ready. Recommendations are not accepted automatically.
3. **Finish requirements** opens **Designs** and starts the first generation
   automatically. Wait for it to finish; use **Generate designs** if no generation
   is running and you need designs. For new concepts, focus on wireframe layout,
   content and navigation; use **Interact** to follow screen transitions.
   Existing designs keep their styling. Review/edit them, then **Approve designs
   and continue**.
4. In **Prototype**, select **Start prototype** if no build is running.
   The **Prototype** sub-stage builds layout, navigation and the primary task's
   behavior together. Try the current preview; use **Show Prototype** or
   **Show requested revision** when you want to accept a waiting version.
   Feedback is optional. For distinct layouts and styles, use
   **Explore visual directions (optional)** and [compare, refine and apply a
   direction](user-manual.md#explore-visual-directions).
5. Select **Finish Prototype** once. Tandem saves the feature specification and
   exact approved evidence, opens Development and asks Designer to create or
   refine Design. Progress and errors appear in status; there is no second
   handoff approval, required model chooser or Start Development step.
   Answer native permission requests if they appear. Design review and the
   later implementation confirmation remain separate.

**Result:** saved discovery evidence and a Design to refine. A prototype can
use mocks; finishing it does not prove a production app works or approve coding.
No shutdown or manual file transfer is required. Non-GUI work can skip graphical
prototyping with a recorded reason and **Finish Requirements and save outputs**.

### Go to Development

Use this path for existing code, an initial implementation, or a rough idea.

1. Complete project setup above. Development uses its saved model override or
   inherits the current main model at first creation. No model selection is
   required; optional overrides are in Project settings. Wait for **Ready**.
   Opening Development does not submit a model request or approve implementation.
2. Choose **Quick requests > Understand existing project**, review the inserted
   text and send it. Or use **Design something new** for an idea without code.
3. Inspect the Design beside Conversation and answer its questions.
   Existing behavior is evidence, not automatic agreement to keep it.

**Result:** a Design established directly from your project or idea. Quick
requests insert editable text; they do not send automatically.
Older projects or changed Git/ignore rules can require project setup again at
the point of need; Tandem never silently initializes or switches folders.

## 3. Decide when to implement

Review the Design and resolve required questions. Send **Implement agreed design**
from Quick requests, or write your own implementation request.

At **Start implementation?**, inspect the proposal and Design revision:

| Choose | What happens |
| --- | --- |
| **Plan and implement** | Planning and code changes begin in your selected working copy. Command permissions remain separate. |
| **Update Design instead** | The proposal goes to Design work, not implementation. |
| **Cancel** | The proposal is declined without deleting Design or sending a model turn. |

Inspect implementation and Review outcomes before requesting another change.
A Review result is not proof that every test or user journey passed.

## 4. End the visit

Use the browser host's **Stop** or **Ctrl+C** in its terminal, and check any
reported failure. Closing a tab alone leaves work running.
See [Stop and reopen](troubleshooting.md#stop-close-and-returning-later) for
interrupting work or returning to the same project.
