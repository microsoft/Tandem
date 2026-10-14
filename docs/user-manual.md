# User manual

[All guides](README.md) | [First project](quick-start.md) | [Task recipes](use-cases.md)

## The workspace

Open the project folder you want to work on. Its first Preparation/Development
choice is saved there; it is not a mode switch on every visit.
Preparation can progress into Development, and existing files are preserved.

| Area | Your work | Output |
| --- | --- | --- |
| Preparation, Requirements, Drawings, Prototype | Describe a goal, decide behavior, edit drawings and try a prototype. | Discovery evidence and a feature specification. |
| Development | Refine Design, answer questions, approve implementation and inspect results. | Canonical Design, project code, plans and Review outcomes. |

**Canonical Design** is the current agreement used for implementation and Review.
It is distinct from discovery evidence. It can use linked journeys, screens,
diagrams or concrete input/output examples, not just prose. Those views describe
one agreement: check that the same behavior and boundaries appear consistently.
Confirmed behavior, assumptions and unanswered questions are not interchangeable.

Use the left navigation to browse, **Current work** to find ongoing work/attention,
and **Project settings** to configure the project. Browsing does not authorize
work. Development Conversation appears only in Development; its draft and
attachments stay hidden when you browse other phases, not moved to their inputs.
Parent Copilot chat is not a Development submission.

## Find saved work

**Artifacts** groups **Discovery** and **Development** outputs. Groups start
collapsed with names/counts; expand one and select an entry. **Saved artifacts**
opens discovery output. Development entries open their original Design, Plan,
Implementation or Review view/history, without copying stores together.

| Indicator | Meaning |
| --- | --- |
| Compact **Design available** marker | Design exists, not that implementation passed. |
| **New output** / **New** | An output changed; inspect it. |
| Prototype **Ready to inspect** | A version is waiting to be shown, not already displayed. |
| **needs attention**, questions or permissions | Input or investigation is needed. |
| Unverified/unavailable history | Access is not verified, not that saved work was deleted. |

## Requirements and Drawings

Preparation starts from **Start project**, reports its results and advances
automatically. Its original brief stays there. A reported failure can offer
**Retry preparation**; quiet progress alone is not a reason to retry.

In Requirements, **Add usage** accepts a usage, then **Generate requirements DAG**
creates connected decisions. Answer active decisions with **Use this answer**.
Prerequisites hold dependent questions. Free text, when offered, replaces the
selected option rather than adding a second answer.

**Use whole-graph defaults** requires confirmation of the displayed
recommendations, including downstream choices. Recommendations and suggestions
are not already accepted answers. **Update answer and dependents** can invalidate
dependent decisions while retaining independent answers.

Drawings retains the Sketch editor: generate screens, edit shapes/transitions,
use Undo/Redo, or send a revision instruction. **Save drawings** saves edits;
**Approve drawings and continue** explicitly approves that revision.
Already-approved, unchanged drawings may show **Finish Drawings and continue**
instead. A saved/streamed revision alone is not approval.

To change a completed phase, review its **Reopen** warning: affected outputs
become stale and may need completion/approval again. History is retained.
For ordinary changes once Development is underway, use a new Design request
instead of restarting discovery. See [revision recipes](use-cases.md#revise-requirements-or-drawings).

## Prototype versions

**Structure** and **Interaction** are automatic milestones after prototype work
starts. Feedback and **Explore visual direction (optional)** are optional.
Existing GUI validation uses copied source; a new mock UI is not proof of real
services, persistence or integrations.

The inline preview and **Open current preview** show the displayed version.
A waiting version changes that only when you choose its action, such as
**Show Interaction prototype** or **Show requested revision**. Automatic
milestones are not feedback you submitted.

Use **Feedback** to **Send revision** or **Queue revision**, then inspect its
status and clarifications. Finish requires the necessary milestones, current
drawing approval and resolved submitted feedback. **Finish Prototype and save
outputs** retains evidence; it does not approve implementation.
Non-GUI work can retain a reason/specification without fabricating screens.

Saved source and a running preview are separate. Use
[preview recovery](troubleshooting.md#the-preview-is-unavailable) to restart a
saved version, or [continue into Design](use-cases.md#continue-from-a-saved-prototype).

## Design, questions and implementation

Wait for **Ready**, then send requests in Development. **Quick requests** appends
editable text to the draft; it never sends automatically.
You can establish Design from existing code without editing it, refine an idea,
or ask for an explanation. [Optional role hints](use-cases.md#suggest-designer-or-agent)
and [visual annotations](use-cases.md#point-to-a-design-change) help express intent.

Before requesting implementation, trace a user goal through the proposed behavior:
what starts it, what outcome the user sees, and which limits or failure cases
matter. For a service or CLI, use a request sequence or command/output example
instead of requiring a screen. Describe what should happen, not a technology
choice you do not feel equipped to judge.

Open **Questions** to see the original context, options, implications and answers.
Use that form to answer; ordinary chat is not guessed to be an answer to it.

| Question | If you leave it unanswered |
| --- | --- |
| **Blocking / answer required** | Dependent work waits. |
| **Advisory / optional** | Read **If unanswered**: the declared continuation keeps the Design bound to this question unchanged. |
| **Advisory / clarification required before new work** | A missing/stale continuation needs clarification through the original form before dependent work. |
| **Originally blocking - not blocking now** | Read its current status; this does not imply you answered it. |

Silence never accepts a recommended option, changes Design, approves
implementation or grants a command permission. Choices labeled **Change Design**
and **Change implementation** state different effects; mixed choices go to
Designer first. Submitted answers can still be queued/processing.

When you request implementation, **Start implementation?** offers **Plan and
implement**, **Update Design instead**, or **Cancel**. Approval covers that
proposal and Design revision, not later requests. It has no automatic timeout.
Tool permissions remain separate, and discovery permissions do not approve
Development operations.

Implementation edits your selected working copy; there is no later Apply-to-project
step. Implementer validates agreed journeys. Reviewer reports Design conformance
and material over-engineering without editing or starting a fix loop. Inspect
verification limits; "done" or Review completion is not a test pass.
For interruptions, see [queued work and Stop](troubleshooting.md).

## Read an outcome and decide what comes next

Inspect Design, Implementation and Review together, rather than judging the
number of activity messages or passed tests.

| Check | What to look for |
| --- | --- |
| Agreement | Which user goal, behavior and Design revision governed the work? |
| Change | What was implemented or revised, and what was left out? |
| Evidence | Which journeys and boundaries were actually exercised, with what results and limitations? |
| Decision | Is there drift to correct, a change in intent to confirm, or an unanswered question? |

For example, checks that account recovery works before 30 days and fails at the
deadline do not validate permanent purge or an unconfirmed Undo interface.
A screenshot is not an exercised journey, and a mock backend is not evidence
that a real integration works. A partial or unavailable check remains a limit,
not an inferred pass.

If code disagrees with unchanged Design, request a correction against that
agreement. If the intended behavior has changed, request a Design update first.
Use the original Questions form for issued questions; request implementation
separately when ready. Review reports and an empty question queue never authorize
another code-changing cycle. Follow the [outcome recipe](use-cases.md#inspect-a-result-and-request-the-right-follow-up)
before accepting or exporting work.

## Settings and saved state

In **Project settings**, choose **Reasoning effort for both stages** and **Apply
to both stages**. Each stage applies and reports its own value. Development's
choice can be pending before it opens; this does not start it.
**Refresh status** rereads without work. Busy, unsupported, unavailable or partial
application is not success and needs explicit resolution.

In Development, **Private Canvas model > Apply model** changes only that model;
the main/discovery model belongs to the launching host. The browser CLI accepts
`--model <id>` and optional `--reasoning-effort <level>` for that main session;
see the [quick start](quick-start.md). These options do not choose Development's
private model. Resolve pending private model intent using the offered retry or
**Accept actual model** only if you want the reported model.

Development settings include **Theme**, **Text size**, **Save appearance** and
Windows **Open project folder**. Before Development opens, the discovery settings
panel exposes shared effort without starting the Development UI.
**Close** or Escape only dismisses Settings: it does not save, apply or stop work.

**Compact model context...** needs fresh approval and does not replace saved
Conversation, images, Design or results. Unsent drafts are different: copy
important text before page/extension reload or changing browser windows.

Operational data is under `.tandem`; ensure the project's `.gitignore` includes
`.tandem/`, as shown in the [quick start](quick-start.md). Tandem does not add that
rule for you. Do not edit this state to force readiness or assume Git backs it up.
Optional [acceptance and export](use-cases.md#locate-and-export-saved-outputs)
writes reviewed output to `tandem-records`; export is not Git publication.
