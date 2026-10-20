# Task recipes

[All guides](README.md) | [Manual](user-manual.md)

For a first idea or existing app, use the [two-path quick start](quick-start.md).
The recipes below cover the next tasks.

## Revise requirements or drawings

**Use when:** a behavior or screen needs to change.

1. Describe the change in Prototype Feedback, the drawing revision input, or
   the Development conversation. Tandem assesses the affected stages against
   retained decisions and work before changing earlier stages.
2. Review **Project changes**: where the change starts, what needs an update,
   and what stays unchanged. Clarify or refine the request if necessary.
3. Approve the impact proposal. Answer only new or affected Requirements
   questions, then review the affected drawings and prototype update.
4. Use **Apply update** for the prepared prototype. If Development is affected,
   use **Continue change in Development**; implementation still needs its own
   confirmation.

**Result:** the new request proceeds from the earliest affected stage without
repeating completed decisions or replacing the previous working prototype.
Prior answers remain visible when a decision needs review. A changed project
requires **Check impact again** before approving an older proposal.

For direct edits rather than a chat request:

1. Open the owning phase. If completed/read-only, use **Reopen** and review its
   broader warning; settle/close Development first if required.
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
   it in Feedback and **Send change** or **Queue change**.
4. Inspect clarifications/outcomes, then explicitly show the resulting version.

**Result:** you control which version you evaluate. Viewing is not Finish or
implementation approval. If the server stopped, [restart that saved preview](troubleshooting.md#the-preview-is-unavailable),
not model generation.

Keep an observation separate from a confirmed change. For example: "I looked for
Undo after deletion. Clarify whether recovery needs a visible Undo action and a
deadline before revising the prototype." Then answer the clarification and inspect
the revision; the agent should not infer a requirement solely from what you tried.

## Continue from a saved Prototype

**Use when:** finished discovery should inform Development's Design.

1. Select **Continue to Development** from the saved Prototype, or **Review
   Prototype handoff** in Development.
2. Review the exact saved specification, decisions, assumptions, deferred work
   and target folder. Confirm **Create Design from Prototype** or **Refine Design
   from Prototype**. **Cancel** creates no handoff and starts no work.
3. Follow the handoff status. Designer can take several minutes; answer any
   permission request in the owning session. When Design is ready, inspect it
   and answer blocking/advisory questions in Development.

**Result:** retained source, decisions and mock limitations inform Design.
Scripts are not executed by the handoff; originals remain. No manual transfer,
shutdown or implementation approval is implied.

An admitted handoff shows status instead of a repeated submission button.
**Check handoff status** reads pending/unavailable status. **Review handoff
recovery**, then **Reconcile saved handoff**, checks uncertain admission and may
submit only if not already admitted; it never replays retired work. A saved update
offers **Review updated Prototype**; a prepared request offers **Review saved
handoff**. Each confirmation binds to the
reviewed source and target; changed inputs require a fresh review.
**Open Development** and ordinary navigation do not submit the Prototype.

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
your message. Typing `@` or a partial role at the start offers compact suggestions:
use Up/Down and Enter/Tab, or click one, to insert it without sending. Escape
dismisses suggestions and keeps your draft. Check the composer's **Preference**
help and send when ready.
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

## Inspect a result and request the right follow-up

**Use when:** implementation or Review has finished, but you need to judge what
works and whether more work is needed.

1. Open the corresponding Design, Implementation and Review outputs from
   **Artifacts**. Match the result to the agreed user goal and Design revision.
2. Read the reported journey checks, outcomes and limitations. Compare the
   starting action, visible result and important boundaries; do not substitute
   a screenshot or a test count for missing evidence.
3. Separate a mismatch from a new expectation. "Recovery rejects users after
   seven days, but Design says thirty" is a correction against existing Design.
   "I now want a visible Undo action" changes the agreement first.
4. Answer issued questions through **Questions**. Otherwise, send the appropriate
   request: "Correct recovery against the unchanged Design," or "Update Design
   to include Undo; do not implement yet."
5. Inspect the resulting proposal. Choose **Plan and implement** only when you
   want that implementation cycle, then inspect its new results.

**Result:** a deliberate follow-up, not automatic acceptance or another fix loop.
If evidence is partial, ask what remains unverified instead of treating it as a
pass. Recovery checks do not settle purge rules or an unconfirmed interface.
You may leave those decisions open and retain an explicitly limited outcome.

## Locate and export saved outputs

**Use when:** you want a reviewed snapshot to share.

1. Expand the relevant **Artifacts** group and inspect the original output.
2. Open **Project settings → Advanced handoffs & history**. Choose a saved
   discovery snapshot, or use **Capture Development outcome for review** in
   Development. Inspect the captured and original outcomes, including any
   failed/partial/unverified areas.
3. Select the completed stage/captured outcome, enter **Accepted by**, and review
   **Accept handoff**.
4. Once that snapshot is accepted, **Export accepted handoff** appears. Export,
   then inspect the local `tandem-records` bundle before sharing.

**Result:** an exported accepted snapshot, not a Git commit or publication.
Acceptance records attribution, not authenticated identity, implementation approval or a test pass.
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
