# User manual

[All guides](README.md) | [First project](quick-start.md) | [Task recipes](use-cases.md)

## The workspace

Open the project folder you want to work on. Its first Preparation/Development
choice is saved there; it is not a mode switch on every visit.
Preparation can progress into Development, and existing files are preserved.
Both first-time choices check project Git setup before being saved. Review any
local initialization/ignore-rule consent; Cancel leaves the choice unsaved.
Existing repositories are reused, and Preparation never starts private Development.

| Area | Your work | Output |
| --- | --- | --- |
| Preparation, Requirements, Designs, Prototype | Describe a goal, decide behavior, edit designs and try a prototype. | Discovery evidence and a feature specification. |
| Development | Refine Design, answer questions, approve implementation and inspect results. | Canonical Design, project code, plans and Review outcomes. |

**Canonical Design** is the current agreement used for implementation and Review.
It is distinct from discovery evidence. It can use linked journeys, screens,
diagrams or concrete input/output examples, not just prose. Those views describe
one agreement: check that the same behavior and boundaries appear consistently.
Confirmed behavior, assumptions and unanswered questions are not interchangeable.

The sidebar tracks actual stage progress, not the selected tab. Its circled-dot
**Current phase** marker identifies the working phase; completed stages show a
lock because their accepted content is read-only. Neither marker means an AI
model is running. Empty requirement ledger sections stay hidden.
Hosted windows keep the folder identity in the host header rather than repeating
it in the sidebar; an unhosted canvas retains the sidebar name and full-path tooltip.
Use the left navigation to browse, **Current work** to find ongoing work/attention,
and **Project settings** to configure the project. Before Development, the
workspace also has **Preparation**, **Requirements**, **Designs** and
**Prototype** tabs. Use them to revisit available stages without changing the
current phase or losing drafts; unavailable stages stay disabled. Development
remains a separate left-navigation entry. Browsing does not authorize work.
**Finish** and **Reopen** sit on the right of the stage tab bar; pinned-draft
**Apply changes** remains below the selected stage's inputs.
**Approve designs and continue** shares the Designs tab header.
Development Conversation appears only in Development; its draft and
attachments stay hidden when you browse other phases, not moved to their inputs.
Parent Copilot chat is not a Development submission.

### Review an earlier stage without moving current work

When work needs review, a highlighted panel appears at the bottom of
**Preparation**, **Requirements**, **Designs** and **Prototype**. It identifies
the next stage to review. In that tab, follow its guidance and use the draft's
approval controls; from another tab, use the panel's button to open or resume
the required review. Opening a review does not apply changes.
When a change-triggered review targets another stage, the viewed stage's content
is dimmed and inactive. Stage tabs and the bottom review panel remain available.

For an available earlier **Prototype** stage, you can also choose
**Review changes** in its header. Its existing editor
opens in a separate, pinned draft. **Return to Prototype** (or your current stage) returns to the working stage;
coming back to the review keeps its editor and unsent input. Background progress
does not switch the pinned tab.

| Action | Effect |
| --- | --- |
| Save or edit a draft | Changes only the draft, not accepted inputs or current work. |
| **Build draft preview** | Copies the saved prototype into a new candidate workspace and runs the requested update. Merely opening review does neither. |
| **Apply changes** | Updates accepted content after checking the draft's baseline and waiting for active work to settle. The current stage stays in place; affected downstream outputs need review. |
| **Close review** | Leaves the editor. Saved edits remain available through **Resume draft review**. |
| **Reopen** | Makes the earlier stage current again and marks dependent outputs stale. Use it only when you intend to restart that part of the workflow. |

Every review panel has a **Details** button that opens the change context in a
popup. In a draft review, the same popup includes **Compare with the accepted baseline**,
showing what the draft started from.
If accepted inputs changed meanwhile, the draft is kept but cannot overwrite
them: compare it, discard it, then start a fresh review. Designs drafts support
direct editing and typed revision instructions.

After applying a Requirements review, affected Designs are marked stale.
In the Designs draft, choose **Update designs from latest requirements** in the
review pane when designs are stale. This updates the existing saved designs against the accepted
requirements and DAG, rather than starting with empty pages. Reviewed layouts,
styling, content and refinements remain unless the changed requirements need an
adjustment. Existing screens stay visible while the update arrives, including
when the review was opened without a linked change request.
Review the result, then choose **Apply changes** in the bottom review pane.
For Designs, this approves the saved draft and applies it in one confirmation.
Current Prototype work and saved revisions stay intact. **Reload saved designs**
only reloads the saved revision; it does not incorporate requirement changes.
Prototype's **Update for reviewed inputs** and prepared-version actions also
appear in its review pane.
**Regenerate designs** is the separate, confirmed start-over action; it may
replace reviewed layouts and refinements, while retaining saved history.

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

## Requirements and Designs

Preparation starts from **Start project**, reports its results and advances
automatically. It checks workspace context; an early lookup is only for an
unfamiliar reference needed to understand the goal. Its original brief stays
there. A reported failure can offer **Retry preparation**; quiet progress alone
is not a reason to retry.

In Requirements, **Add usage** accepts a usage, then **Generate requirements DAG**
researches relevant missing facts before creating connected decisions. Progress
appears in **Usage list**, alongside Requirements and **Research and sources**.
**Research and sources** starts expanded; collapse it when you want more space.
Switch to **Decision DAG** to answer questions; switch back to **Usage list**
to inspect accepted usages and research, including from later stages.
The DAG fills its tab. The diagram, decision list and selected question each have
a bounded-height area with their own scrollbar. **Mermaid source**, immediately
after the **Fit**/zoom readout, opens a scrollable popup without resizing those panes. Close it
with **Close** or **Escape** to return to the source button. The source remains
available even when the diagram cannot render.
Research informs questions, not accepted features or answers. Failed generation
keeps your usages and any completed findings for **Retry requirements DAG**.
An unchanged retry reuses those findings instead of repeating the research.
Answer the active decision, or select any **Ready to answer** question whose
prerequisites are complete, with **Use this answer**; processing reviews affected
decisions without rewriting unrelated questions.
Prerequisites hold dependent questions. Free text, when offered, replaces the
selected option rather than adding a second answer.

**Use whole-graph defaults** requires confirmation of the displayed
recommendations, including downstream choices. Questions without a valid
recommendation are marked **Explicit answer** in the DAG and question list.
They are skipped, not answered automatically. After compatibility review,
Tandem opens the next blocking question for you to answer. Defaults that conflict
or depend on missing information remain for review.
Answering an explicit question also reopens saved downstream defaults if their
meaning changes, retaining the previous answers for review.
Recommendations and suggestions are not already accepted answers.
**Update answer and dependents** can invalidate
dependent decisions while retaining independent answers.

Finishing Requirements opens Designs and generates the initial screens
automatically; generation controls are disabled while that work is running.
The main Designs area shows a processing indicator, the current generation
message and elapsed time when a request timestamp is available. Incoming screens
appear live with a received-screen count and update number; these are not a
percentage complete or approval. Tandem first plans and displays all page titles
and navigation, then starts a separate content pass to fill one page at a time.
Each page shows **Waiting**, **Processing**, or **Ready** in
the screen list; the selected page also shows its progress above the preview.
**Ready** means that page's preview is ready, not saved or approved.
If generation fails, completed and partial pages stay visible and navigable;
the interrupted page shows **Stopped**. **Retry generation** continues from the
retained content without starting over, including after reloading Tandem.
The recovery checkpoint is not a saved or approved revision. Changed requirements
or a replaced draft invalidate it. **Reload saved designs** returns to the saved
revision; **Regenerate designs** remains the explicit start-over action.
Existing designs and local edits stay visible
while a new design is prepared.
Designs displays UI DSL screens: structured components, layout and design tokens
rendered by a fixed local renderer. Describe UI changes in the composer; freehand,
shape tools and the geometry inspector are no longer available. Screen metadata,
transitions, Undo/Redo, canvas size presets and view zoom remain available.
New concepts start with a neutral **Wireframes: layout & navigation** kit.
Review the screen hierarchy, meaningful content, actions and path through the
task, without spending this stage on branding. Existing reviewed designs retain
their appearance; validating an existing GUI does not downgrade it to wireframes.
Wireframe approval confirms layout, content and navigation, not final appearance
or working application behavior. The approval control explains this scope.
**Screen details** contains screen metadata; **Structure**, below it, shows the
component hierarchy. Select an element there or directly in the view.
Selection stays active until you choose **Interact** to try the preview controls.
In Interact mode, navigation-linked controls and **Navigation preview only**
actions follow the saved screen transitions. This changes only the viewed screen,
without saving, approving, running services or generating application code.
Use arrow keys to browse, expand and collapse the hierarchy.

Requests include the viewed screen and selected element. Selecting or inspecting components does
not edit or approve the design, including in read-only views. Live-preview
selections are for inspection only and never become saved revision targets.
Sizing changes the responsive viewport; zoom changes only the view.
**Save designs** saves edits;
**Approve designs and continue** explicitly approves that revision.
Already-approved, unchanged designs may show **Finish Designs and continue**
instead. Their approval status appears in the bottom status bar, not the
design toolbar. A saved/streamed revision alone is not approval.

Older geometry-based designs show a **Regenerate designs** prompt instead of a
view. Reopen Designs if needed, regenerate and approve the DSL revision, then
update Prototype. Existing files and approval history remain intact. Prototype
and Development receive the approved DSL source; rendered images are visual
references, not a replacement for its component structure.

In Designs, the **Review** icon is on the input row immediately after **History**.
Its icon and border turn red, with an accessible **Review required** label, when
your decision is needed. One review stays current until you resolve or cancel it.
New change requests and unrelated edits/Continue actions are blocked; the work
needed to complete that review remains available in its owning stage or draft.
The inline review-status card is omitted so the design keeps its space.
The popup separates your request, the proposed update, impact details and the
decision controls. A new required decision opens it automatically once; routine
updates and loaded history do not reopen it.
Design request history and Discovery history retain requests and their responses
when you reopen the project.
**Close** or **Escape** dismisses it without discarding your clarification or
resizing the editor and returns focus to Review. You may still inspect screens,
zoom and history, but closing does not resolve the review or enable new changes.
**Cancel request** leaves unapproved work unchanged; a saved draft is never
silently applied.
Clear edits within the current Designs or Prototype stage prepare a draft without
an extra impact-approval step. Saving a design revision releases the request so
you can keep editing; approving designs or applying a prototype update remains
explicit.
In the current Requirements stage, clear additions are saved directly and new
questions remain unanswered. Changes to accepted answers, removals or existing
constraints still need impact review. Once its patch is saved, the request no
longer holds up additional Requirements edits.

A genuine ambiguity asks one focused question in this same review. Submit the
detail, review the proposal or cancel the request before sending another change.
Older projects with multiple saved requests retain their full history: already
admitted work is completed first, then pending requests are reviewed one at a
time. Earlier deferred records remain saved, but new reviews cannot be put aside
with **Keep for later**. Reopening never replays unanswered or failed work.

**Review Requirements draft** (or the named affected stage) opens an earlier-stage proposal without reopening that
stage; only **Apply
changes** updates its accepted content. Requirements keeps independent answers and shows previous
answers for decisions that need review. The saved prototype remains available
while its update is prepared. **Recheck impact** refreshes a stale proposal;
it does not approve it.
An unanswered or unapplied request in current work does not prevent applying a
separate ready draft. Those requests stay saved and are not approved, cancelled
or deferred by Apply; an older proposal must be checked again if accepted inputs
have changed. Running work, a change already being applied, conflicting inputs
or unfinished work inside the draft still blocks Apply with a visible reason.

Cancel before approval leaves accepted work unchanged. Cancelling remaining
work afterwards retains already saved changes rather than rolling them back.
Impact review applies only to stages through Prototype. Development handles its
own Design changes, implementation confirmation and code Review; its requests do
not automatically return to discovery or start a review in the main conversation.
Older Development-origin impact requests remain available as read-only history
and do not block new discovery work. Explicitly sending an accepted discovery
change to Development never substitutes for implementation confirmation.

**Reopen** remains a broader manual operation: affected outputs become stale and
may need completion/approval again. See [revision recipes](use-cases.md#revise-requirements-or-designs).

## Prototype versions

**Prototype** is one combined sub-stage for layout, navigation and working task
behavior. Feedback and **Explore visual directions (optional)** are optional.
Existing GUI validation uses copied source; a new mock UI is not proof of real
services, persistence or integrations.

One worker builds the smallest complete primary task, including applicable
loading, empty, error, recovery and success states, and returns one verified
preview. There is no separate Structure or Interaction build or approval.
Revisions add only the requested changes to an isolated copy; a failed update
retains the accepted version. Existing saved Structure/Interaction checkpoints
and any already-running work remain intact and appear under the combined tab.
An old Structure-only preview is partial, not proof of a complete prototype.

**Prototype** focuses on task flow and behavior; **Visual exploration** focuses
on appearance without adding workflows. Feedback targets the accepted version
when inspecting a saved result or **Default**. When comparing a named direction
or **Custom**, the same feedback box refines only that alternative.

Use the **Prototype** and **Visual exploration** tabs to revisit
each saved result, including after continuing into a later stage.
These numbered sub-tabs use the same style and status icons as Requirements.
Hover over an icon for its status; screen readers announce the same description.
Switching tabs only changes the view: it does not reopen work, apply a version,
or start generation. Each preview is checked against its saved checkpoint.
Unavailable saved previews can be explicitly rechecked or restarted.

The accepted prototype changes only when you choose an action such as
**Show Prototype** or **Show requested revision**. **Open pending prototype
(not applied)** lets you inspect a verified waiting version without accepting it. Automatic
milestones are not feedback you submitted. **Feedback** still targets the
accepted prototype when you are inspecting an earlier result.

Change and feedback boxes share an input, **Send**, and **History** layout.
**Send** keeps the current target and queues feedback when work is already running.
**History** shows the recorded requests and their status without applying changes.
Inspect any clarifications before continuing. Finish requires the necessary milestones, current
design approval and resolved submitted feedback. **Finish Prototype and save
outputs** retains evidence; it starts neither Design nor implementation.
Non-GUI work can retain a reason/specification without fabricating screens.

### Explore visual directions

After accepting the Prototype, choose **Explore visual directions (optional)**.
The agent builds two or three working alternatives with different layouts,
typography, colors and restrained effects. They keep the same primary workflow
and mock data. **What differs** explains each direction, including layout
departures from the approved designs; visual exploration does not authorize
new navigation or features.

1. **Default** shows the exact original prototype from before visual exploration,
   including its original layout, styling and interactions. Select a named
   direction to compare an alternative. Switching views does not accept a design.
2. Expand **Advanced settings** for light/dark, accent, density, text size and
   effects on a named direction. Changed settings appear as **Custom** and switch
   in place without an agent run. Reduced-motion preferences always turn motion off.
3. Use the shared **Feedback** box and **Refine direction** to request a change
   to the alternative on screen. Its heading identifies the target, and drafts
   are retained separately for each direction and the accepted prototype.
   Return to **Default** or the **Prototype** tab for ordinary feedback, which
   waits until exploration is applied or put aside.
4. Use **Accept** at the right of the direction buttons to apply the
   previewed direction and settings.
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

### Continue into Development

**Continue to Development** opens a handoff summary, not a model request.
Check its saved specification, decisions, assumptions, deferred work and target
folder, then confirm **Create Design from Prototype** (or **Refine Design from
Prototype**). Cancel changes nothing. **Open Development** is navigation only.
After confirmation, status distinguishes submission, Designer work and published
Design/questions. If activity is unavailable, it says unverified rather than
claiming completion. Scripts do not run and implementation remains separately
confirmed. Once the matching Design is verified and visible, the completed
handoff status clears and stays out of the workspace after later Design
revisions. Results remain in Conversation; the original saved request/source
records remain on disk.
New handoffs, unanswered questions and unverified or failed work still show their
current status. Routine checking, setup and Designer progress use the existing
bottom status bar without adding a header or moving the workspace. Review and
recovery controls stay beside the handoff; questions, permissions and actionable
errors stay in their owning Development controls. The standalone Development
view uses its conversation status strip.

**Project settings** opens one consistent window in every phase, with
appearance, shared reasoning effort, private Development model/access and
diagnostics. Opening settings does not start Development or change its consent.
The obsolete acceptance/export, delivery and linked-intake workflow is removed;
it is not available under an advanced settings menu. Existing snapshots,
receipts and exports are retained.

In **Development only**, that bar shows one current message: required attention,
then verified role activity or compaction, then a request/draft/permission
acknowledgment, then Ready. “Request received” confirms receipt, not execution.
Acknowledgments clear on the next interaction or relevant workflow change;
editing a draft, switching project generation, or reconnecting cannot revive an
old acknowledgment. Detailed errors, consent, questions, implementation decisions,
attachment validation and Settings feedback remain with their owning controls.
Preparation, Requirements, Designs and Prototype keep their existing status UX.

UI Design should preserve the accepted displayed Prototype's appearance and
interactions, not redesign it from prose. Missing evidence or necessary UX changes
are raised in the Designer summary and Questions; later approved Design revisions
are not replaced by an older Prototype.

Saved source and a running preview are separate. Use
[preview recovery](troubleshooting.md#the-preview-is-unavailable) to restart a
saved version, or [continue into Design](use-cases.md#continue-from-a-saved-prototype).

## Design, questions and implementation

Wait for **Ready**, then send requests in Development. **Quick requests** appends
editable text to the draft; it never sends automatically.
While Development's private session owns approvals, the browser host hides its
redundant permission-mode icon, even when you browse discovery stages. Development
permission settings and actual permission prompts remain available. The host
selector is disabled while ownership is unverified.
You can establish Design from existing code without editing it, refine an idea,
or ask for an explanation. [Optional role hints](use-cases.md#suggest-designer-or-agent)
and [visual annotations](use-cases.md#point-to-a-design-change) help express intent.
Artifact actions share the artifact heading instead of a separate toolbar row.
Questions, Current Design and connection status remain visible without redundant
Canvas or Conversation titles.

Before requesting implementation, trace a user goal through the proposed behavior:
what starts it, what outcome the user sees, and which limits or failure cases
matter. For a service or CLI, use a request sequence or command/output example
instead of requiring a screen. Describe what should happen, not a technology
choice you do not feel equipped to judge.

Select **Questions** beside Conversation to use the left workspace while keeping
Conversation available on the right. Select a question from the visible list to
read its context, options and consequences. List selection only navigates; it
does not answer or submit anything. On narrow screens, Questions and Conversation stack
in one column; **Go to Conversation** moves to the composer.
**Back to Design** restores the retained Design view. Inspecting a Design
reference offers **Back to Questions** without discarding your answer drafts.
New questions and answers do not switch views.
The Questions button is highlighted while any blocking or non-blocking questions
remain unanswered. It returns to its neutral appearance once they are answered;
saved answers remain available.

**Go to latest** (down arrow) appears when you scroll back in Conversation or
status history, even without new messages. It returns both to the latest content
without sending anything or clearing drafts. Incoming updates do not move you
away from older content you are reading.

**Send selected answers** sends the displayed selection list from that source as
one batch, including drafts for its other questions; drafts from other sources
are not sent. Unselected questions remain unanswered. Drafts survive navigation;
answers are recorded only after acknowledgment. The open-question list shows
blocking/advisory and draft states, and is hidden when empty.
Expand **Answered history** (or **Question
history** when it includes other statuses) to read the saved-question list and
recorded answers. **Inspect full context** opens one entry's complete text and
source references. Ordinary chat is not guessed to be a question answer.

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
before requesting follow-up work.

## Settings and saved state

In **Project settings**, choose **Reasoning effort for both stages** and **Apply
to both stages**. Each stage applies and reports its own value. Development's
choice can be pending before it opens; this does not start it.
**Refresh status** rereads without work. Busy, unsupported, unavailable or partial
application is not success and needs explicit resolution.

Before first opening Development, choose **Private Canvas model > Save model
for Development**. The choice is saved without creating a private session or
starting work. Startup checks that the saved model and effort are still available,
applies them, and verifies the actual private model; it never silently substitutes
another model. Once Development is Ready, **Apply model** changes that running
private session only. The main/discovery model belongs to the launching host.
If you start Development without a saved model, Tandem opens this same settings
window before creating its private session. Choose and save a model, then select
**Start Development with saved model**. Closing settings cancels the startup
continuation. Saving a model by itself never starts Development.
Continue stays disabled until the displayed model choice is saved or applied.
Changing that choice disables it again; a failed or pending save never enables
it. While startup checks the saved model, the button shows **Checking model...**.
Development then shows **Starting Development...** and **Verifying Development
model...** until initialization finishes. These are progress states, not warnings.
Permissions still require your response, and a failed startup or model check
remains visible once the operation settles.
The browser CLI accepts
`--model <id>` and optional `--reasoning-effort <level>` for that main session;
see the [quick start](quick-start.md). These options do not choose Development's
private model. Resolve pending private model intent using the offered retry or
**Accept actual model** only if you want the reported model.

The same Project settings window includes **Theme**, **Text size**,
**Save appearance** and Windows **Open project folder** in every phase.
Opening it before Development does not start the private runtime.
**Close** or Escape only dismisses Settings: it does not save, apply or stop work.

**Compact model context...** needs fresh approval and does not replace saved
Conversation, images, Design or results. Unsent drafts are different: copy
important text before page/extension reload or changing browser windows.

Operational data is under `.tandem`. Before Development, guided setup can add a
preserving `.tandem/` ignore rule with your explicit consent; the
[quick start](quick-start.md) also shows a manual alternative. Keep this data out
of commits. Do not edit it to force readiness or assume Git backs it up.
[Saved outputs](use-cases.md#locate-saved-outputs) remain available through
Artifacts and Conversation. Existing `tandem-records` exports are retained; the
retired acceptance/export workflow is not part of Project settings.
