# Quick start

[All guides](README.md) | [User manual](user-manual.md)

Open a project, make its intended behavior visible, then decide whether to
implement it. **Preparation is optional; implementation always needs an
explicit decision.**

## 1. Launch the source preview

You need Windows, PowerShell, actual **Node 24.15+ (24.x LTS) or Node 26+**, Git,
and a Copilot account with the required model access. These commands build source, not a published
release or global installation. No .NET or running Copilot desktop app is needed.
Check `node --version` first: Node 24.0 through 24.14 and Node 25 do not satisfy
the locked source dependencies, even if npm only warns and the build succeeds.

Use an existing Git repository/worktree root, preserving its files. For your first
trial, use a test project or worktree. To create a new project instead:

```powershell
New-Item -ItemType Directory -Path C:\projects\counter
git -C C:\projects\counter init
Add-Content -Path C:\projects\counter\.gitignore -Value '.tandem/'
```

An initial commit is not required. Tandem does not initialize Git or add an ignore
rule for you. For an existing project, ensure its `.gitignore` contains `.tandem/`
before launching. This keeps local session state and diagnostics out of commits;
do not ignore `tandem-records` merely because operational state is private.
From your **Tandem source checkout**, separate from that target project:

```powershell
npm ci
npm run build:browser
node .\dist\browser\cli.mjs login
node .\dist\browser\cli.mjs --workspace C:\projects\counter
```

`login` signs in to Copilot, not optional Azure voice input. Review startup
permissions and keep this terminal open.

To choose the main/Preparation model and effort explicitly, add launch options:

```powershell
node .\dist\browser\cli.mjs --workspace C:\projects\counter --model gpt-6-astra --reasoning-effort low
```

Use a model available to your account. The launcher checks the native catalog and
actual readback before opening Tandem; it does not silently substitute a model.
Omitting both options preserves native defaults and saved selection. If Stage 1
effort remains pending with no actual model, stop the host and reopen the same
folder with an explicit model. Development's private model is separate: select it
in **Project settings > Private Canvas model**, then apply the shared effort and
check both stage results before submitting work.

**You should see:** your project folder and **Choose where to start**.
Returning projects use their saved choice and progress. If startup fails, use
[troubleshooting](troubleshooting.md#startup-and-connection-problems).

## 2. Choose your starting path

The choice is saved in this folder's `.tandem` metadata, not asked every visit.
These are recommendations, not rules about how many files a project contains.

### Start with Preparation

Use this path to clarify requirements and UX.

1. Enter a goal such as "A keyboard-friendly counter with increment, decrement
   and reset" and select **Start project**.
2. In **Requirements**, **Add usage** entries you care about, then **Generate
   requirements DAG**. Answer the connected decisions with **Use this answer**
   and finish the phase when ready. Recommendations are not accepted automatically.
3. In **Drawings**, **Generate drawings**, review/edit them, then **Approve
   drawings and continue**.
4. In **Prototype**, select **Start prototype** if no build is running.
   Structure and Interaction are automatic milestones. Try the current preview;
   use **Show Interaction prototype** when you want to display that ready version.
   Feedback is optional.
5. **Finish Prototype and save outputs**, then **Go to Development**.
   Select **Continue Design from Prototype** to use the saved evidence for Design.

**Result:** saved discovery evidence and a Design to refine. A prototype can
use mocks; finishing it does not prove a production app works or approve coding.
No shutdown or manual file transfer is required. Non-GUI work can skip graphical
prototyping with a recorded reason and **Finish Requirements and save outputs**.

### Go to Development

Use this path for existing code, an initial implementation, or a rough idea.

1. Wait for **Ready**. Opening Development alone does not scan or change the app.
2. Choose **Quick requests > Understand existing project**, review the inserted
   text and send it. Or use **Design something new** for an idea without code.
3. Inspect the Design beside Conversation and answer its questions.
   Existing behavior is evidence, not automatic agreement to keep it.

**Result:** a Design established directly from your project or idea. Quick
requests insert editable text; they do not send automatically.

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
