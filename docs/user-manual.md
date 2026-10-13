# User manual

[All user guides and version scope](README.md) | [Quick start](quick-start.md) | [Recipes](use-cases.md)

## Your project and its two starting paths

Open the project folder you want to work on. On first open, choose **Start with
Preparation** for help discovering requirements and UX, or **Go to Development**
to work from existing files, an initial implementation or a rough idea. Neither
choice requires a particular number of files. Development requires the actual
Git repository/worktree root; an empty repository with no commit is supported.

The initial choice is saved in the folder's `.tandem` metadata. It is not a
per-browser preference or a switch to reselect on every open. Preparation can
progress into Development. Opening the folder prepares the selected context;
it does not give permission to implement changes.

Tandem keeps two independent ways of working:

| Area | What you do there | What it produces |
| --- | --- | --- |
| Preparation, Requirements, Drawings, Prototype (discovery / Stage 1) | Enter a goal, choose usages and decisions, edit drawings, try a prototype and optionally give feedback. | Saved intent, decisions, drawings, prototype source and a feature specification. |
| Development (Stage 2) | Discuss and refine Design, answer questions, explicitly approve implementation, inspect results and Review. | The canonical Design, implementation work in your project folder, and retained plans/results/reviews. |

Discovery evidence is not the formal Design. **Canonical Design** means the
current agreement Development uses when implementing and reviewing the project.
Each stage keeps its own state, conversation/input controls and permissions.
Before Development starts, reading discovery history does not require starting
Development.

## Find your way around

The left navigation selects **Preparation**, **Requirements**, **Drawings**,
**Prototype**, or **Development**. A phase can be unavailable until its
prerequisites are complete. **Current work** takes you to the active work or
attention needed; **Project settings** opens configuration.

Changing the view does not start a new request or approve work. Development
Conversation appears **only in Development**. When you browse earlier artifacts,
its existing draft, attachments and live context stay hidden rather than being
replaced by a discovery input. Return to Development to act on its questions or
permissions. Parent Copilot chat and discovery messages are not copied into
Development Conversation.

**Artifacts** is a shared index, with **Discovery** and **Development** sections.
Artifact groups start collapsed and show their names and counts. Expand a group
and select an entry to open its original viewer, work-cycle view or history.
The index does not copy outputs into a new combined store. **Saved artifacts**
opens discovery outputs; Development groups include Design, Plan,
Implementation and Review.

Read status cues for what they mean:

| Cue | Meaning |
| --- | --- |
| **Available** beside Development | A Design is available, not proof that implementation or testing passed. |
| **New output** / **New** | Output changed since it was viewed; inspect it. This is not an approval. |
| **Ready to inspect** beside Prototype | A saved version is waiting to be shown; the current preview has not automatically changed. |
| **needs attention**, a question, permission or error | A decision or investigation is needed, not merely a new artifact. |
| **Unverified** / unavailable outputs | Tandem cannot currently verify access to that saved history. It is not reporting that the history is empty or deleted. |

## Preparation and Requirements

Enter the goal in Preparation and select **Start project**. The **Original
project brief** remains readable there. Preparation inspects the workspace and
uses relevant sources when needed; it reports results, sources and blockers.
It advances automatically when analysis completes. Use **Retry preparation**
only for a reported failed attempt, not simply because a task is quiet.

In Requirements, write one "I want to..." usage at a time and select **Add
usage**, or add an optional suggestion. Then **Generate requirements DAG**
creates a decision graph: related questions with prerequisites. "DAG" is the
UI's name for that graph; you do not need to design the graph yourself.

Choose an active decision, read its question and recommendation, and explicitly
select **Use this answer**. Free text, when available, replaces the selected
choice rather than silently adding a second answer. **To answer** decisions
remain blocked until their prerequisites are answered.

**Use whole-graph defaults** is an optional bulk decision. It asks you to confirm
the displayed recommendations across unanswered decisions, including downstream
ones. It is not automatic acceptance, and conflicts or changed questions still
need review. Changing an existing answer with **Update answer and dependents**
can invalidate dependent decisions while keeping independent answers.

Finish the phase using its Finish control when the required decisions are
resolved. A non-GUI project can retain a reason for skipping drawings/prototype
and save its feature specification instead.

## Drawings

The **Drawings** page retains the Sketch editor. Use **Generate drawings** for
a first draft, or **Add screen** to begin yourself. You can edit screens, shapes,
labels and transitions, use Undo/Redo, or write a drawing instruction and **Send**.
**Revision history** retains earlier revisions and request outcomes.

Use **Save drawings** for local edits. **Approve drawings and continue** is the
explicit decision that lets the current drawings guide the prototype. After
unchanged drawings are already approved, **Finish Drawings and continue** is the
remaining completion action if the phase has not advanced. A streamed or saved
revision alone is not approval.

Requirements changes or drawing edits can make the old approval stale. Do not
assume that an approved earlier version approves the replacement. If a revision
fails, inspect its recorded instruction and use its Retry control rather than
silently submitting a different change.

## Prototype: current, waiting and finished

Prototype supports building a mock UI or validating an existing GUI from copied
source. It does not use the mock as evidence that production persistence,
services or integrations work. Existing GUI work should be identified as such,
not replaced by an unrelated demo.

Once prototype work starts, **Structure** and then **Interaction** are automatic
milestones. **Explore visual direction (optional)** requests additional visual
work. Feedback is optional; a ready Interaction version does not imply that you
sent a revision request.

The inline preview and **Open current preview** use the displayed version.
While another version builds, they keep that current version. The waiting
version has a specific action such as **Show Interaction prototype**,
**Show requested revision**, or **Show saved version**. These are the current
labels for applying a saved update to the displayed preview. Only that explicit
action switches versions.

Use **Feedback** below the preview to request a change. Depending on current
work, the button says **Send revision** or **Queue revision**. Queued feedback
does not immediately replace the current preview. Read clarification questions
and failed revision states; a failure does not erase the working version.

**Finish Prototype and save outputs** saves the feature specification and
evidence for the displayed source. Required milestones, submitted
feedback and relevant drawing approval must be resolved first. Showing a
version is not finishing, and finishing is not implementation approval.
A stopped preview server does not by itself invalidate retained source evidence.
Use [preview recovery](troubleshooting.md#the-preview-is-unavailable) when you
need to try that saved version again.

After finishing, **Go to Development** is the normal next navigation action.
The [saved Prototype recipe](use-cases.md#continue-from-a-saved-prototype) explains
explicit continuation. You do not need to close the application or manually
transfer files.

## Development conversation and Design

Wait for **Ready**, then send a request inside Development. **Quick requests**
inserts editable prompts for understanding an existing project, designing
something new, revising Design, implementing agreed Design, or explaining it.
Selecting a preset appends text to your draft; it does not send or approve it.

Ask Designer to inspect existing code read-only when establishing a baseline.
Observed behavior can inform Design, but is not automatically desired behavior.
After Design publication, inspect the original artifacts beside Conversation.
Use **Annotate** on a supported visual artifact to open a captured-image editor.
Draw on the fixed image, choose **Attach to composer**, then send a message
explaining the change. **Return to design** keeps an unfinished sketch for
**Resume sketch**; **Cancel annotation** discards that unfinished sketch without
changing an existing composer attachment. Document-only formats do not all
support annotation. Snapshots retain their original source revision; a changed
Design warning means you need to inspect which version your feedback describes.

You may paste an image into the composer when the selected model supports image
input. Inspect the unsent preview before sending. Capturing, pasting or removing
an attachment does not itself change Design or code.

### Optional role hints

Ordinary messages need no prefix. For one message, you may begin with exactly
`@designer` or `@agent`, followed by whitespace and your request:

```text
@designer Update the Design to keep the reset control visible. Do not implement.
@agent Explain how the existing counter stores its value. Do not change files.
```

The composer shows **Preference: @designer for this message. Router decides who
responds.** (or `@agent`). Router interprets each request and may choose a
different role or require implementation confirmation. Hints do not change
permissions or force dispatch.

The syntax is lowercase and must start at the first character. Leading spaces,
`@Designer`, `@designer:`, quoted mentions and mentions inside a sentence do not
set a hint. A hint with no message, or two consecutive supported hints, produces
an error and keeps the draft. There is no `@planner` shortcut, permanent
recipient selection or **Send to** selector.

## Questions are decisions, not permissions

Open **Questions** in Development to see the original question, context, choices,
implications and saved answers. Use its answer form for a bound answer; a casual
message in Conversation is not silently matched to an earlier question.

| Question label | What to do / what happens if unanswered |
| --- | --- |
| **Blocking / answer required** | Answer before dependent work can proceed. A tool-permission response is not a product answer. |
| **Advisory / optional** | Read **If unanswered**. The supported continuation keeps the Design bound to that question and explains what can safely continue without changing it. |
| **Advisory / clarification required before new work** | An old question lacks a supported continuation, or the Design has changed since it was recorded. Clarify through the original form before dependent new work. |
| **Originally blocking - not blocking now** | Inspect the retained context and current status; this is not evidence that you answered it. |

Silence is never an answer, agreement to a recommendation, permission, or approval
to change Design. An advisory continuation does not automatically start work or
approve implementation. Tandem does not choose arbitrary recommended options
because you left the question unanswered.

Choices may say **Change Design - ...** or **Change implementation - ...**, with
their actual effect explained. Mixed selections go to Designer first; a later
implementation still needs confirmation against the published Design. Submitted
answers retain their original wording and times. If an answer is still being
processed, wait for its outcome rather than assuming the decision is complete.

## Implementation and Review

Ask for implementation only after reviewing the intended Design. Every new
implementation, resume or replan proposal pauses at **Start implementation?**
before planning and code changes. **Plan and implement** authorizes that
proposal and its Design revision; **Update Design instead** changes direction;
**Cancel** declines it without a model turn. No timeout approves it for you.

Approval is not blanket permission for later messages. Tool permissions remain
separate. Review each command or access request in the stage that owns it;
**Allow once** is limited to that request. The host's discovery permission setting
does not approve Development commands.

Implementation edits the selected working copy. Internal planning and coding
steps proceed within the approved work without making you operate each task.
Implementer validates the agreed journeys. Reviewer checks Design conformance
and material over-engineering, reports findings and limits, and returns control.
It does not edit code or start an automatic fix loop. Review completion,
**Available**, and an agent saying "done" are not substitutes for passing checks.
There is no separate final Test phase or Apply-to-project transfer.

Use [queued work and Stop guidance](troubleshooting.md#queued-does-not-mean-processed)
when sending more input during work. Stop retains partial files; it is not undo.

## Project settings

**Project effort** offers one **Reasoning effort for both stages** choice and
**Apply to both stages**. Each stage applies and reports its own actual value.
Choosing effort before Development opens saves the intended setting without
starting it. **Refresh status** rereads the values; it starts no project work.

Read both stage results. **Loading**, unavailable model information, a busy
stage, an unsupported effort or a pending choice is not a successful application.
If one stage applied and another did not, that partial result is visible rather
than silently rolled back. Resolve it explicitly when the stage is ready.
No shared choice leaves existing defaults unchanged.

In Development, **Model > Private Canvas model > Apply model** changes the
Development model, not the main/discovery model. The main model remains owned
by the launching host; the browser CLI shown in the quick start has no
`--model` option. A main model or effort readback does not prove Development is
using the same one. If a model update cannot be confirmed, inspect the pending
intent and use the displayed retry or **Accept actual model** only if that
actual model is the one you want.

Development settings also include **Theme**, **Text size**, **Save appearance**,
and **Open project folder** (Windows Explorer). Saved appearance applies across
the integrated project surface; authored diagrams can retain their own styling.
Before Development is opened, the discovery-owned settings panel exposes shared
effort without requiring the Development settings UI.

**Close** at the top of Settings (or Escape) only dismisses the panel. It does
not save, apply, discard, stop work or close Development. Use the relevant
Apply/Save action for changes. **Compact model context...** requires a fresh
confirmation; it summarizes model context without replacing saved Conversation,
images, Design or results. It does not resume old work.

## Saved outputs and optional delivery

Use Artifacts to inspect saved work. Operational state is kept under `.tandem`;
do not edit it to change readiness, permissions, decisions or ownership.
Do not assume a Git commit backs up ignored operational data or unsent drafts.
Ordinary view navigation retains the live draft; page reload, another browser
window or extension reload is not a durable draft-save mechanism.

In Development, **Acceptance, export and delivery** opens an optional dialog.
**Capture Development outcome for review** records the current Design, work and
available evidence for inspection. **Accept handoff** records your attribution;
it is not implementation approval, authenticated code-owner approval, or a test
pass. **Export accepted handoff** separately writes the reviewed bundle into
`tandem-records`. Export never commits, pushes, merges or deploys.

Delivery handoff, status reading and issue/incident intake can independently use
Local or GitHub. **Save process settings** saves these choices; changing an
adapter keeps old history and does not substitute a different adapter on errors.
GitHub requires authenticated `gh` and the requested access. External publication
is explicit: **Publish reviewed handoff** can post to an existing PR with GitHub
or write a local bundle with Local. It is not a deployment.
**Import linked effort** creates a linked follow-up from the selected source
without resetting the current effort or starting agents. **Open linked effort
and start Preparation** is a separate action that does start discovery.
See the [export recipe](use-cases.md#locate-and-export-saved-outputs) before sharing.

Voice is optional and discovery-specific; see the
[voice recipe](use-cases.md#use-optional-voice-input). Maintenance is not a
normal project step: use the
[restart and reload guidance](troubleshooting.md#maintenance-is-not-refresh-or-a-new-project)
only for their stated purpose.
