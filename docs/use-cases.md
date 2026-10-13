# Task recipes

[All guides](README.md) | [Manual](user-manual.md)

For a first idea or existing app, use the [two-path quick start](quick-start.md).
The recipes below cover the next tasks.

## Revise requirements or drawings

**Use when:** a behavior or screen needs to change.

1. Open the owning phase. If completed/read-only, use **Reopen** and review its
   warning; settle/close Development first if required.
2. In Requirements, choose the answered question and **Update answer and
   dependents**. Review affected decisions.
3. In Drawings, edit and **Save drawings**, or send a precise change. Inspect
   **Revision history** if a request failed; retry the recorded request deliberately.
4. Approve the new drawings before using them for Prototype.

**Result:** revised evidence with history retained. Reopening marks affected
outputs stale, so old approvals may no longer apply. For a normal Development
change, [refine Design](#point-to-a-design-change) instead.

## Inspect a waiting prototype version

**Use when:** a version is ready but the current preview has not changed.

1. Read its label: Interaction can be an automatic milestone, not your feedback.
2. Choose the displayed **Show Interaction prototype**, **Show requested revision**
   or **Show saved version** action.
3. Try it inline or use **Open current preview**. If you want a change, describe
   it in Feedback and **Send revision** or **Queue revision**.
4. Inspect clarifications/outcomes, then explicitly show the resulting version.

**Result:** you control which version you evaluate. Viewing is not Finish or
implementation approval. If the server stopped, [restart that saved preview](troubleshooting.md#the-preview-is-unavailable),
not model generation.

## Continue from a saved Prototype

**Use when:** finished discovery should inform Development's Design.

1. Choose **Go to Development** and wait for Ready.
2. Select **Continue Design from Prototype**, or **Continue saved Prototype
   handoff** if an unsent handoff is already prepared.
3. Inspect the Design/questions and send later changes in Conversation.

**Result:** retained source, decisions and mock limitations inform Design.
Scripts are not executed by the handoff; originals remain. No manual transfer,
shutdown or implementation approval is implied.

An admitted handoff shows status instead of a repeated submission button.
**Check handoff status** reads pending/unavailable status. **Reconcile saved
handoff** checks uncertain admission and may submit only if not already admitted;
it never replays retired work. An updated completed Prototype can offer
**Continue Design from updated Prototype**.

Alternatively, reference saved files in an ordinary Development request and
explain the scope Designer should use.

## Point to a Design change

**Use when:** showing a journey, screen or diagram is clearer than describing it.

1. Open a supported Design artifact and choose **Annotate**.
2. Mark the captured image and **Attach to composer**.
3. Add a request such as "Keep this reset action visible. Update Design only;
   preserve keyboard behavior and do not implement yet," then send.

**Result:** feedback tied to the inspected source revision, not an automatic edit.
**Return to design** keeps an unfinished sketch for **Resume sketch**;
**Cancel annotation** discards only that sketch. **Capture new** replaces the
captured image/strokes only after confirmation.

Document-only formats do not all support annotation. Inspect changed-source
warnings rather than assuming an old snapshot describes the current Design.
You may also paste an image when the selected model supports it; review its
unsent preview before sending.

## Suggest Designer or Agent

**Use when:** you want to hint at the kind of response. Ordinary messages need
no prefix.

```text
@designer Add the empty-state journey to Design. Do not implement.
@agent Explain which files implement the counter. Do not change them.
```

Start with exactly one lowercase `@designer` or `@agent`, then whitespace and
your message. Check the composer's **Preference** help and send.
Router still decides; hints do not grant permissions or force a role.

Leading spaces, `@Designer`, `@designer:`, quoted mentions and mentions inside
a sentence are ordinary text. A hint alone or two consecutive supported hints
produce an error and keep the draft. There is no `@planner` or **Send to** selector.

## Resolve questions and approve work

**Use when:** Design or Review needs your decision.

1. Open **Questions**, read the context/implications, and answer through that form.
   For advisory questions, read **If unanswered**; it preserves the bound Design,
   not an automatically selected recommendation.
2. Resolve blockers or missing/stale continuations before dependent work.
3. If implementation is wanted, review the separate **Start implementation?**
   proposal and choose **Plan and implement**, **Update Design instead**, or
   **Cancel**.

**Result:** only explicit decisions authorize changes. Cancel preserves Design
without a model turn. After approval, use [Stop controls](troubleshooting.md#stop-close-and-returning-later)
to interrupt work; the earlier confirmation is not undo.

## Locate and export saved outputs

**Use when:** you want a reviewed snapshot to share.

1. Expand the relevant **Artifacts** group and inspect the original output.
2. In Development, open **Acceptance, export and delivery**, then **Capture
   Development outcome for review**. Check the captured and original outcomes,
   including failed/partial/unverified areas.
3. Select the completed stage/captured outcome, enter **Accepted by**, and review
   **Accept handoff**.
4. **Export accepted handoff**, then inspect the `tandem-records` bundle before sharing.

**Result:** an exported accepted snapshot, not a Git commit or publication.
Acceptance records attribution, not implementation approval or a test pass.
If source/Design changed, capture and review again.

<details>
<summary>Optional delivery and linked follow-up work</summary>

**Prepare delivery draft** is separate from export. **Process settings** selects
Local/GitHub independently for delivery, status and intake; **Save process
settings** applies the selection. Existing references/history remain, and errors
never switch adapters.

GitHub needs authenticated `gh` and suitable access. **Publish reviewed handoff**
posts to an existing PR with GitHub or writes a local bundle with Local, only
after confirmation. Nothing is merged or deployed.
**Import linked effort** creates a follow-up without resetting the current one
or starting agents; **Open linked effort and start Preparation** is the separate
action that starts discovery.

</details>

## Use optional voice input

**Use when:** you prefer dictating a discovery goal, answer or revision.
Text and Copilot use do not require Azure voice sign-in.

1. Select **Mic** at the intended input. If an Azure credential error requires it,
   choose the offered **Sign in for voice input** and complete browser sign-in.
2. Select **Mic** again and allow microphone access. Successful login never
   starts recording.
3. **Stop** the recording, edit the transcript, then use the form's send/answer
   action yourself. **Cancel** or Escape restores the original draft.

**Result:** editable text, not an automatically sent request. Audio goes to Azure;
Tandem does not retain a recording. **Cancel sign-in**, or hiding/navigating away
from its input, cancels pending login. Configuration/microphone errors are not
fixed by sign-in; type normally if voice is unavailable.

Drawings' **Voice settings** separately offers **GPT-live conversation**.
With an authorized deployment, **Talk with GPT-live** can discuss and submit
drawing revisions; you still approve drawings. **End voice** does not cancel
an already-submitted revision. Its authentication differs from Azure dictation.
See [speech configuration](engineering-reference.md#speech-input) for prerequisites.
