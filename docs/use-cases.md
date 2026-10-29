# Task recipes

[All guides](README.md) | [Manual](user-manual.md)

For a first idea or existing app, use the [two-path quick start](quick-start.md).
The recipes below cover the next tasks.

<a id="revise-requirements-or-drawings"></a>

## Revise requirements or designs

**Use when:** a behavior or screen needs to change.

1. Before Development, describe the change in Prototype Feedback, the design
   revision input, or Requirements. Tandem assesses the affected stages against
   retained decisions and work before changing earlier stages.
2. Review **Project changes**: where the change starts, what needs an update,
   and what stays unchanged. Clarify or refine the request if necessary.
3. Approve the impact proposal. Answer only new or affected Requirements
   questions, then review the affected designs and prototype update.
4. Use **Apply update** for the prepared prototype. If Development is affected,
   use **Continue change in Development**; implementation still needs its own
   confirmation.

**Result:** the new request proceeds from the earliest affected stage without
repeating completed decisions or replacing the previous working prototype.
Prior answers remain visible when a decision needs review. A changed project
requires **Check impact again** before approving an older proposal.

In Development, use its conversation to [refine Design](#point-to-a-design-change)
or request implementation changes. This stays in Development's own workflow;
it does not automatically start an upstream impact review.

For direct edits rather than a chat request:

1. Open the owning phase. If completed/read-only, use **Reopen** and review its
   broader warning; settle/close Development first if required.
2. In Requirements, choose the answered question and **Update answer and
   dependents**. Review affected decisions.
3. In Designs, edit and **Save designs**, or type a precise change and use
   **Send** (**Enter**; **Ctrl+Enter** or **Command+Enter** inserts a new line). Inspect
   **Revision history** if a request failed; retry the recorded request deliberately.
4. Approve the new designs before using them for Prototype.

**Result:** revised evidence with history retained. Reopening marks affected
outputs stale, so old approvals may no longer apply. For a normal Development
change, [refine Design](#point-to-a-design-change) instead.

## Inspect a waiting prototype version

**Use when:** a version is ready but the current preview has not changed.

1. Read its label: Prototype can be an automatic result, not your feedback.
2. Choose the displayed **Show Prototype**, **Show requested revision**
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

1. Select **Finish Prototype** for the current accepted version. Saving its
   specification/evidence and continuing to Development are one action.
   Older save-only outputs offer **Continue to Development**.
2. Follow status while the exact handoff is retained and Designer starts.
   There is no additional handoff-review or model-selection popup.
3. Designer can take several minutes; answer any
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

## Locate saved outputs

**Use when:** you want to inspect the project's saved work and evidence.

1. Expand the relevant **Artifacts** group and inspect the original output.
2. In Development, inspect Design, Plan, Implementation and Review outputs and
   their original Conversation entries. Keep failed, partial and unavailable
   coverage distinct from passing evidence.
3. Use the saved files as evidence when sharing or requesting follow-up work.
   Publication remains a separate action outside Project settings.

**Result:** inspected original outputs, not a new acceptance or export.
The former acceptance, delivery and linked-intake workflow has been removed.
Previously saved snapshots, receipts and `tandem-records` exports remain intact.
