# Use-case recipes

[All user guides and version scope](README.md) | [Quick start](quick-start.md) | [Manual](user-manual.md)

Each recipe starts with an intended outcome. Inspect the selected project folder
before sending work; Development implementation changes that working copy.
Examples are requests you can adapt, not built-in demos or guaranteed output.

## Turn an idea into something you can inspect

**When:** you know the goal but need help clarifying behavior and UX.

1. Choose **Start with Preparation** and describe the goal in **Start project**.
2. Add the usages you care about in Requirements. Generate the requirements DAG
   and explicitly answer its decisions.
3. Generate or edit Drawings and approve the version you want to explore.
4. Start/inspect Prototype as the page directs, then show the ready Interaction
   version when you want to switch from Structure.
5. Give feedback only if you want a change; finish and save when satisfied.

**Result:** reviewable discovery evidence and a feature specification.
Prototype shortcuts and open questions stay explicit. Neither a working mock
nor finishing discovery is approval to implement the real application.

For the motivation behind this path, read [the story](the-tandem-story.md).

## Understand and improve an existing app

**When:** there is code to preserve, but no reliable description of the intended
behavior.

1. Open the existing repository/worktree root and choose **Go to Development**.
2. After **Ready**, choose **Quick requests > Understand existing project**,
   review the inserted text, and send it. Add preservation constraints, for example:

   > Preserve the existing counter and its tests. First describe the current
   > behavior and uncertainties in Design. Do not implement changes yet.

3. Inspect the Design. Answer questions about behavior to keep or change.
4. Request a specific Design revision, then ask separately for implementation.
   Review **Plan and implement** before proceeding.

**Result:** an evidence-backed Design followed by explicitly authorized changes.
Existing behavior is not automatically desired behavior. Opening Development
alone does not start a scan. Keep your own source-control/backups; Stop is not
a rollback for code already edited.

## Revise a requirement or drawing

**When:** a product decision or screen needs to change before you continue.

1. Open the owning phase. If it is completed/read-only, use its **Reopen**
   action and review the warning. Close/settle Development first if the guard
   requires it.
2. In Requirements, choose the answered decision and use **Update answer and
   dependents**. Review affected downstream decisions.
3. In Drawings, edit and save, or send a precise request such as "Keep the reset
   button visible below the count on narrow screens."
4. Inspect the resulting revision and approve it before using it for Prototype.

**Result:** revised discovery evidence, with earlier history retained.
Reopening marks affected outputs stale; requirements/drawing changes can require
new approval and prototype evidence. Browsing alone is read-only. For an ordinary
change after Development is underway, prefer a new Design message rather than
restarting discovery.

## Inspect a waiting prototype version and give feedback

**When:** the page says a version is ready but the inline preview still looks
unchanged.

1. Read the waiting version label. **Interaction prototype ready to inspect**
   can be an automatic milestone, not a response to feedback.
2. Select **Show Interaction prototype**, **Show requested revision**, or
   **Show saved version**, as displayed. Only then does the current version change.
3. Try it inline or choose **Open current preview** for that same version.
4. In **Feedback**, describe one change and choose **Send revision** or
   **Queue revision**. Inspect its status and any clarification.
5. Explicitly show the resulting version when it is ready.

**Result:** you know which version you are evaluating and which request caused
an update. Feedback is optional. A waiting version is not automatically promoted,
and viewing it is not Finish or implementation approval.
If it will not run, use [targeted preview recovery](troubleshooting.md#the-preview-is-unavailable),
not a new generation request just to restart its server.

## Continue from a saved Prototype

**When:** you have finished discovery and want Design to use its confirmed intent.

1. Open Prototype's saved output if you want to review it. You may do this in the
   same visit or after returning later.
2. Choose **Go to Development** and wait for its context to become ready.
3. Select **Continue Design from Prototype**. If an unsent handoff is already
   prepared, the action is **Continue saved Prototype handoff**.
4. Inspect the resulting Design and questions in Development Conversation.
   Send later refinements there.

**Result:** Design work receives a retained copy of the selected completed
evidence, including its source, decisions and mock limitations. It does not
execute prototype scripts or authorize implementation. Original inputs remain.
There is no manual file-transfer requirement.

The same admitted handoff is not resent on every visit; after admission, its
status directs you to Conversation. **Check handoff status** reads a pending or
unavailable status. **Reconcile saved handoff** is for uncertain admission: it
checks the exact saved request and may submit it only if not already admitted.
It cannot replay retired work. An updated completed Prototype can offer
**Continue Design from updated Prototype**; this refines the same Design,
not a new unrelated project.

Alternatively, send an ordinary Development request referencing saved files and
the scope you want Designer to use. Neither route requires keeping the earlier
discovery connection alive.

## Refine Design by pointing at an artifact

**When:** a journey, screen or diagram makes the requested change clearer than prose.

1. Open the relevant Design artifact in Development.
2. If it supports **Annotate**, open the captured-image editor, mark the relevant
   area and choose **Attach to composer**. Review the unsent snapshot.
3. Add a message, for example:

   > Keep this reset action on the current screen. Update Design only; retain
   > the existing keyboard behavior and do not implement yet.

4. Send, then inspect the new Design or the explanation that no change was needed.

**Result:** a contextual Design request tied to what you inspected.
Capturing a snapshot does not send it or approve changes. Some document formats
are read-only without annotation. **Return to design** keeps an unfinished sketch;
**Resume sketch** opens it again. If the artifact changed, inspect the original
source binding and use **Capture new** only when you intend to replace the captured
image and strokes. Do not assume an old annotation describes the new Design.

## Ask Designer or Agent with a hint

**When:** you want to suggest the kind of response without changing any workflow
permissions.

1. In Development, optionally start a message with `@designer ` or `@agent `:

   ```text
   @designer Add the empty-state journey to Design. Do not implement.
   @agent Explain which files implement the current counter. Do not change them.
   ```

2. Check the composer's preference help, then send.
3. Read the actual response and any confirmation or questions it requires.

**Result:** Router receives a per-message preference, not an instruction to bypass
normal routing. You can omit the hint entirely. Use exact lowercase at the start,
with whitespace and a message. No `@planner`, force-dispatch or **Send to**
control exists; [syntax details](user-manual.md#optional-role-hints) explain
literals and errors.

## Decide whether a question can wait

**When:** Development shows questions while you want to continue other work.

1. Open **Questions** and inspect the context, implications and label.
2. Answer **Blocking / answer required** questions through their original forms.
3. For **Advisory / optional**, read **If unanswered**. If preserving the bound
   Design is suitable, you can leave it unanswered; if you want a change, answer.
4. If the label says clarification is required before new work, resolve that
   question instead of assuming an old recommendation is the default.

**Result:** only actual answers record your choices. An advisory continuation
keeps the existing Design, not an automatically selected option. Stale or missing
continuations can block dependent new work. An answer that asks for implementation
still does not replace the implementation confirmation.

## Approve, redirect or cancel implementation

**When:** the Design is ready, or an implementation proposal needs reconsideration.

1. Request implementation in Development.
2. Read **Start implementation?**, including the proposal and Design revision.
3. Choose **Plan and implement** to authorize it, **Update Design instead** to
   refine the agreement, or **Cancel** to decline that proposal.
4. For approved work, respond separately to command permissions. Inspect
   implementation and Review results before deciding on another cycle.

**Result:** planning and application edits begin only for the approved proposal.
Cancel preserves published Design and records the decision without a model turn.
A valid pending confirmation can survive reopen, but never becomes automatic
approval. If you already approved and work is running, use
[Stop](troubleshooting.md#stop-close-and-returning-later), not the old confirmation
as an undo button.

## Review queued work and stop safely

**When:** you submitted another request during work, or want to end the current flow.

1. Inspect **Queued** above the Development composer. Expand a message to read
   its original text and received time.
2. Wait for actual workflow pickup before interpreting it as a processed turn.
   Do not resend a message merely because it is still queued.
3. Use **Stop after this step** for a boundary stop, or its **Stop options >
   Stop now** for immediate interruption.
4. Inspect the outcome and **Not started history**. Before further work, send
   a fresh request that accounts for retained partial files.

**Result:** stopped/not-started input remains visible as history, not silently
replayed. These are workflow controls, not per-message edit/cancel buttons.
They do not shut down the whole browser host or roll back code.
See [the lifecycle table](troubleshooting.md#stop-close-and-returning-later).

## Locate and export saved outputs

**When:** you want to review or share a completed stage or a Development outcome.

1. In **Artifacts**, expand the relevant Discovery or Development group.
   Select the original output and check its version/status.
2. For Development, open **Acceptance, export and delivery** and choose
   **Capture Development outcome for review**. Inspect the captured artifact and
   the original outcome, including failures or unverified areas.
3. Choose the completed stage/captured outcome, enter **Accepted by**, and review
   **Accept handoff**.
4. Select **Export accepted handoff** and review the resulting `tandem-records`
   bundle before sharing it.

**Result:** an explicitly exported accepted snapshot, not a Git publication.
Acceptance is attribution, not a test pass or code-owner approval. If Design or
source changed, capture/review again; do not apply an old acceptance to new work.

Optional **Prepare delivery draft** is separate from export.
**Process settings** selects Local/GitHub independently for delivery handoff,
status and intake. Review and save the choices before use. GitHub delivery needs
authenticated `gh` and a suitable existing PR reference; **Publish reviewed
handoff** posts the reviewed draft only after confirmation, with no merge or
deployment. Old references/history remain after changing adapters, and errors
do not switch adapters.

## Configure effort, model and appearance

**When:** you want to control reasoning effort or change how you read the workspace.

1. Open **Project settings**, select **Reasoning effort for both stages**, and
   choose **Apply to both stages**.
2. Inspect both reported results. If Development has not opened, its choice can
   remain pending. **Refresh status** rereads without starting it.
3. In Development settings, select **Private Canvas model** and **Apply model**
   only while available/idle. Resolve unsupported or mismatched settings rather
   than assuming the main model overrides them.
4. Use **Theme**, **Text size**, and **Save appearance** when available.
   Select **Close** to dismiss Settings.

**Result:** explicitly applied settings with separate stage readbacks; no new
project request. A busy/unavailable stage or partial application remains visible.
Close does not save choices or stop work. The browser CLI does not offer a main
model selection flag; [model scope](user-manual.md#project-settings) matters.

## Use optional voice input

**When:** you prefer dictating a discovery goal, answer or revision. Text remains
available without Azure speech sign-in. These controls do not configure
Development's separate composer or Copilot authentication.

1. Select **Mic** at the intended input. If Azure authentication is required,
   the input offers **Sign in for voice input**.
2. Choose it only if you want voice, complete Microsoft sign-in in its browser,
   then explicitly select **Mic** again and allow microphone access.
3. Speak, then use the microphone's **Stop** to finish the transcript. Edit the
   text and use that form's Send/Add/answer control yourself.
4. To abandon recording, use **Cancel** or Escape to restore the original draft.
   **Cancel sign-in** cancels an in-progress login; hiding or navigating away from
   the requesting input cancels it too.

**Result:** editable text, not an automatically sent message. Successful sign-in
does not start the microphone or a model request. A configuration or microphone
error is not necessarily a sign-in problem; type normally if voice is unavailable.
Audio is sent to Azure for transcription. Tandem does not retain an audio recording.

In Drawings, **Voice settings** also offers **GPT-live conversation** separately
from **Azure dictation**. With an authorized, configured deployment, **Talk with
GPT-live** starts live discussion; it can submit drawing revisions. Review those
revisions and approve drawings yourself. **End voice** does not cancel a drawing
request already submitted. GPT-live uses separate authentication/configuration;
Azure dictation sign-in does not sign in to it.

Voice requires compatible browser microphone support and the appropriate Azure
resource access; it is not included merely by signing in to Copilot. For setup
details, see the [speech configuration notes](../README.md#speech-input).
No voice mode is a required quick-start step.
