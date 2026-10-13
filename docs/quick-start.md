# Quick start

[All user guides](README.md) | [Why Tandem](the-tandem-story.md) | [User manual](user-manual.md)

**Goal:** open a project, make its intended behavior visible, and decide whether
to implement it. Preparation is optional. Both paths below end in Development,
where planning and code changes require a separate **Plan and implement**
decision.

## Launch the source candidate

These commands run the integrated candidate from a Tandem source checkout.
They are **not published-release installation instructions**. You need Windows,
PowerShell, actual **Node 24+**, Git, and a Copilot account with access to the
models you intend to use. The browser app needs neither .NET nor a running
Copilot desktop app.

Keep the Tandem source folder separate from the project you want to build.
For this example, the source checkout is `C:\src\Tandem` and the target project
is `C:\projects\counter`.

For a **new** project, create the folder and initialize Git yourself:

```powershell
New-Item -ItemType Directory -Path C:\projects\counter
git -C C:\projects\counter init
```

For an **existing** project, use its Git repository/worktree root as-is; do not
replace its files or reinitialize it. Preserve uncommitted work and consider a
test copy or separate worktree for your first trial. Development changes the
selected working copy after approval, not a hidden staging application.
An initial Git commit is not required. Tandem does not initialize Git for you.

From the Tandem source checkout:

```powershell
Set-Location C:\src\Tandem
npm ci
npm run build:browser
node .\dist\browser\cli.mjs login
node .\dist\browser\cli.mjs --workspace C:\projects\counter
```

`login` is Copilot sign-in, not optional Microsoft speech sign-in. The last
command opens the browser and keeps the host running in this terminal. Review
startup permission prompts. If an older installed Tandem conflicts with the
candidate, follow [installation-conflict guidance](troubleshooting.md#startup-and-connection-problems)
rather than replacing files in a running installation.

**Expected result:** Tandem shows the target folder and, on its first open,
**Choose where to start**. This choice is saved in that folder's `.tandem`
metadata, not asked on every visit. Returning projects restore their saved
choice and progress. The two cards are guidance, not a test of whether the
folder is empty.

The launcher also supports:

```powershell
node .\dist\browser\cli.mjs --help
node .\dist\browser\cli.mjs --version
node .\dist\browser\cli.mjs --workspace C:\projects\counter --no-open
```

`--no-open` prints a private launch URL instead of opening a browser. Do not
share that URL. Omitting `--workspace` uses the current directory, which would
be the Tandem source checkout in the example above.

## Path A: start with an idea

Choose **Start with Preparation** when the project is empty or you want help
clarifying requirements and UX.

1. Enter a goal such as "A simple counter with increment, decrement and reset,
   usable with a keyboard" and select **Start project**. Preparation checks the
   project and gathers relevant context; its progress and results are visible.
2. In **Requirements**, add a usage such as "I want to reset the count to zero"
   with **Add usage**. Suggested usages are optional. Select **Generate
   requirements DAG** to turn the accepted usage list into connected decisions.
3. Answer active questions with **Use this answer**. A recommended choice is
   not accepted merely because it is displayed. Finish requirements when the
   phase's Finish control becomes available.
4. In **Drawings**, use **Generate drawings**, edit the screens or describe a
   revision, then review **Approve drawings and continue**. A saved drawing is
   not automatically an approved drawing.
5. In **Prototype**, choose **Start prototype** if no build is running.
   **Structure** and then **Interaction** are automatic milestones once work
   starts. Try the inline current preview. If an Interaction version is waiting,
   select **Show Interaction prototype** to display it. Feedback and visual
   refinement are optional.
6. Once required work is complete and submitted feedback is resolved, select
   **Finish Prototype and save outputs**. Then choose **Go to Development**.
   Use **Continue Design from Prototype** if you want Tandem to send the saved
   evidence into Design refinement.

**Expected result:** Requirements, drawings and prototype evidence are saved;
Development can create the formal Design from those inputs. The prototype is a
mock/validation artifact, not proof that a production app or backend exists.
Showing a version and finishing Prototype do not authorize implementation.
There is no required shutdown or manual file-transfer step between the phases.

For a non-GUI project, Tandem can record why a graphical prototype is not
applicable and use **Finish Requirements and save outputs** instead. Do not
create meaningless screens merely to advance.

## Path B: start from existing files or a rough idea

Choose **Go to Development** for existing code, an initial implementation, or
an idea you want to refine directly. You do not need to invent a preliminary
specification or complete Preparation first.

1. Wait for **Ready** in Development. Selection prepares its working context;
   it does not scan or change the application on your behalf.
2. Use **Quick requests > Understand existing project**, edit the inserted text
   if needed, and send it in Development. Or write:

   > Explore this repository and describe its current behavior in Design
   > artifacts. Identify unclear intent. Preserve existing files; do not
   > implement changes.

3. Inspect the published Design beside Conversation and answer its questions.
   Existing behavior is evidence, not automatic agreement that it should stay
   that way. For an idea without code, use **Design something new** instead.

**Expected result:** a Design you can inspect and refine without first going
through the discovery phases. Quick requests only insert editable text; choosing
one does not send it.

## Decide when to implement

Review the Design and resolve required questions. Then send a separate request,
for example **Quick requests > Implement agreed design**.

At **Start implementation?**, inspect the proposal and Design revision:

| Decision | Result |
| --- | --- |
| **Plan and implement** | Authorizes planning and implementation for this proposal. Code changes happen in the selected project folder; command permissions remain separate. |
| **Update Design instead** | Sends the proposal for Design work rather than implementing it. |
| **Cancel** | Declines this proposal without sending a model turn or deleting the Design. |

Implementer builds and validates the agreed work. Reviewer reports Design
conformance and unnecessary complexity; a Review result is not a universal test
pass. You decide the next change.

When done, use the browser host's **Stop** and check the result, or **Ctrl+C**
in its launch terminal. Closing a browser tab alone leaves work running.
See [Stop, Close and returning later](troubleshooting.md#stop-close-and-returning-later)
before interrupting active work.
