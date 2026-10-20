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

The circled-dot **Current phase** marker identifies the working phase independently of the selected view;
it does not mean an AI model is running. Empty requirement ledger sections stay hidden.
Hosted windows keep the folder identity in the host header rather than repeating
it in the sidebar; an unhosted canvas retains the sidebar name and full-path tooltip.
Use the left navigation to browse, **Current work** to find ongoing work/attention,
and **Project settings** to configure the project. Before Development, the
workspace also has **Preparation**, **Requirements**, **Drawings** and
**Prototype** tabs. Use them to revisit available stages without changing the
current phase or losing drafts; unavailable stages stay disabled. Development
remains a separate left-navigation entry. Browsing does not authorize work.
**Finish** and **Reopen** actions for the selected stage appear to the right of
the tabs, wrapping below them when space is limited.
Development Conversation appears only in Development; its draft and
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

Finishing Requirements opens Drawings and generates the initial screens
automatically; generation controls are disabled while that work is running.
Drawings retains the Sketch editor: generate screens, edit shapes/transitions,
use Undo/Redo, or send a revision instruction. **Save drawings** saves edits;
**Approve drawings and continue** explicitly approves that revision.
Already-approved, unchanged drawings may show **Finish Drawings and continue**
instead. A saved/streamed revision alone is not approval.

For chat changes, **Project changes** shows the earliest affected stage, the
proposed updates and the work that stays unchanged. Approve that proposal before
earlier stages change. Requirements keeps independent answers and shows previous
answers for decisions that need review. The saved prototype remains available
while its update is prepared. **Check impact again** refreshes a stale proposal;
it does not approve it.

Cancel before approval leaves accepted work unchanged. Cancelling remaining
work afterwards retains already saved changes rather than rolling them back.
Development can propose an upstream change when a discovery baseline exists;
direct Development continues to own its Design without mandatory discovery.
Returning a change to Development never substitutes for implementation confirmation.

**Reopen** remains a broader manual operation: affected outputs become stale and
may need completion/approval again. See [revision recipes](use-cases.md#revise-requirements-or-drawings).

## Prototype versions

**Structure** and **Interaction** are automatic milestones after prototype work
starts. Feedback and **Explore visual directions (optional)** are optional.
Existing GUI validation uses copied source; a new mock UI is not proof of real
services, persistence or integrations.

The inline preview and **Open current preview** show the displayed version.
A waiting version changes that only when you choose its action, such as
**Show Interaction prototype** or **Show requested revision**. Automatic
milestones are not feedback you submitted.

Use **Feedback** to **Send change** or **Queue change**, then inspect its
status and clarifications. Finish requires the necessary milestones, current
drawing approval and resolved submitted feedback. **Finish Prototype and save
outputs** retains evidence; it does not approve implementation.
Non-GUI work can retain a reason/specification without fabricating screens.

### Explore visual directions

After applying Interaction, choose **Explore visual directions (optional)**.
The agent builds two or three working alternatives with different layouts,
typography, colors and restrained effects. They keep the same primary workflow
and mock data. **What differs** explains each direction, including layout
departures from the approved drawings; visual exploration does not authorize
new navigation or features.

1. **Default** shows the exact original prototype from before visual exploration,
   including its original layout, styling and interactions. Select a named
   direction to compare an alternative. Switching views does not accept a design.
2. Expand **Advanced settings** for light/dark, accent, density, text size and
   effects on a named direction. Changed settings appear as **Custom** and switch
   in place without an agent run. Reduced-motion preferences always turn motion off.
3. Use **Refine direction** to request a change to that alternative only.
   Ordinary **Feedback** still targets the current prototype and waits until
   exploration is applied or put aside.
4. Use **Accept** in the top toolbar to apply the previewed direction and settings.
   Accepting **Default** restores the saved original without regenerating it.
   Alternatives, settings and checkpoint history are retained.

The top toolbar's **Recheck**, **Restart** and open-preview controls follow the
view on screen: the original for **Default**, or the shared comparison preview
for a named direction. There is no second set of controls below the directions.
Unavailable previews show their error beside the preview area.
**Finish Prototype and save outputs** saves the accepted version, not an
unaccepted comparison.

Select **Default** and **Accept** to keep the original and resume queued ordinary
feedback without choosing a generated direction. To retain another already
accepted direction, finish with that version instead. Alternatives, settings and
history remain saved. If ordinary feedback has since changed the prototype,
**Explore current prototype** builds fresh directions instead of applying stale
comparisons. Resolve submitted feedback before finishing.

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

Operational data is under `.tandem`. Before Development, guided setup can add a
preserving `.tandem/` ignore rule with your explicit consent; the
[quick start](quick-start.md) also shows a manual alternative. Keep this data out
of commits. Do not edit it to force readiness or assume Git backs it up.
Optional [acceptance and export](use-cases.md#locate-and-export-saved-outputs)
writes reviewed output to `tandem-records`; export is not Git publication.
