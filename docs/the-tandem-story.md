# The Tandem story: make intent visible

[All user guides](README.md) | [Try it](quick-start.md) | [User manual](user-manual.md)

You ask an agent to add account deletion. Soon there is a button, working code,
and tests. Then you ask, "How do I recover an account I deleted by mistake?"

The agent implemented permanent deletion. You expected a recovery window.
The software can run correctly according to its own assumptions and still be
the wrong product.

This is the central story of
[Tandem's opening presentation](../stage2/docs/tandem-opening-slides-v2.html#1).
The example below follows that deck's account-deletion journey. It is an
illustration of product decisions, not a built-in Tandem feature, a live demo,
or advice about a real service's retention obligations.

## Two fast starts, one missing agreement

[Slide 1, "Describe before building"](../stage2/docs/tandem-opening-slides-v2.html#1),
starts with a familiar promise: explain expectations, agree, implement, and
check the result. Its document-to-code-to-validation drawing makes the benefit
clear. Agreement comes before investment. The difficulty is that users must
imagine an experience from descriptions before they can try it.

[Slide 2, "Build before agreement"](../stage2/docs/tandem-opening-slides-v2.html#2),
reverses the starting point. A short prompt becomes an application. The user
tries it, reacts, and asks for a revision. That low barrier is valuable; Tandem
does not ask users to abandon it. But the first concrete feedback can arrive
after important choices have already become code.

In [slide 3, "The intent gap"](../stage2/docs/tandem-opening-slides-v2.html#3),
two overlapping circles represent the user's and agent's defaults. Much is
shared. One unspoken difference can still determine the outcome. Here, normal
access should stop immediately, but accidental deletion should be recoverable
for 30 days. The agent might instead choose immediate permanent purge. Neither
choice becomes agreed merely by being plausible.

More output alone cannot close that gap.
[Slide 4, "Output is not understanding"](../stage2/docs/tandem-opening-slides-v2.html#4),
shows why: feedback can arrive late, documents can become homework, successive
changes can drift, and code and tests can share the same wrong assumption.
Tests remain essential. They need the right expectations to test.

**Tandem's answer is to make the intended experience easier to inspect before
committing to implementation, and keep it visible while implementation evolves.**

## A new project: discover what "delete" means

Imagine opening an empty project folder for an account-management application.
You know the outcome you want, but not every screen, edge case or interaction.
You choose **Start with Preparation**.

You begin with a statement, not a technical plan. In Requirements, "I want to
recover an accidental deletion" becomes a concrete usage. Questions make the
consequential choices visible. Does ordinary access stop immediately? How long
does recovery remain possible? What happens to shared content? A recommendation
can help you decide; leaving it unanswered is not agreement.

Drawings give that conversation a shape. You can point at a confirmation
screen or ask for clearer wording rather than describe every coordinate.
You approve the drawings you intend to use.

Then the prototype provides something to try. Structure and Interaction are
automatic milestones, so a new version can become ready even when you have not
submitted feedback. The current preview stays current until you explicitly
show the waiting version. You can explore the deletion-and-recovery journey,
notice an ambiguity, and request a change.

This is the loop in
[slide 5, "Stage 1 - Prototype to a spec"](../stage2/docs/tandem-opening-slides-v2.html#5):
statements, targeted questions, experience, feedback, and a useful account of
the intended outcome. The slide's Model Y image is a historical illustration
of prototype-led discovery, not the account application in this story and not
an interactive example. The value is the reviewable experience, not that
particular screen.

You might notice that "recover within 30 days" leaves the exact deadline
ambiguous. That is cheaper to discuss while inspecting a journey than after
shipping contradictory behavior. You can also leave permanent purge unresolved
until the appropriate retention and shared-asset decisions are made.

When the prototype is ready, **Finish Prototype and save outputs** retains the
evidence and feature specification. It does not turn a mock service into a real
one or declare its behavior production-tested. Nor does it approve coding.
You can continue to Development immediately; closing and returning tomorrow is
an option, not a handoff requirement.

## An existing project: start with what is already there

Now imagine the same request in an application that already has account
settings, authentication and user data. Repeating an empty-project discovery
exercise would waste context and could encourage a parallel demo instead of
understanding the real product.

You open that project folder and choose **Go to Development**. You ask Tandem
to explore the repository, describe the existing behavior, identify unclear
intent, and avoid code changes. Designer makes that evidence visible in the
formal Design. You can distinguish "this is what the code does today" from
"this is what we want it to do."

The deck allows direct Stage 2 entry with an existing agreed specification.
The current application also accepts existing files or a rough idea: you can
establish and refine the agreement *inside Development*. A complete
specification is not an entry requirement.

Both starting paths belong to a project folder. The initial choice is saved
there, so reopening is not another onboarding decision. It is guidance about
where to start, not a filesystem rule and not permission to erase existing work.

## One agreement, several ways to see it

In [slide 6, "Stage 2 - Build against the agreement"](../stage2/docs/tandem-opening-slides-v2.html#6),
the account-deletion example becomes three linked views: a user journey, a
recovery timeline, and a map of unresolved purge decisions.

The journey says normal access stops immediately. The timeline makes the
boundary concrete: recovery is permitted before 30 days and rejected at or
after the deadline. The decision map keeps legal retention and shared assets
separate from that recovery rule. **Expiry does not authorize purge.**

These are views of one agreement, not independent documents that can quietly
disagree. You can point to the deadline or attach an annotated image to a
Development message. Designer can refine the Design while preserving the
distinction between confirmed choices and open questions.

For a non-GUI project, the same idea works through request sequences, state
transitions and concrete input/output examples. A graphical prototype is not a
mandatory detour.

## The moment a decision becomes implementation

Looking at the Design is not approval to code. Neither is showing a prototype,
answering an unrelated question, or seeing a **Ready** status.

When satisfied, you explicitly ask for implementation. Tandem presents
**Start implementation?** against the proposed work and Design revision. You
can choose **Plan and implement**, **Update Design instead**, or **Cancel**.
That keeps the product decision with you without asking you to operate an
internal file-by-file task plan.

After approval, Implementer builds in your selected working copy and validates
the agreed journeys. For this example, a useful check crosses the boundaries:
blocked normal access, recovery before the deadline, rejection at the deadline,
and no unapproved purge. A working button or a unit test alone would not tell
the whole story.

Reviewer then checks the implementation against the Design and looks for
material over-engineering. It reports findings and coverage limits; it does not
edit the code or authorize another coding cycle. If implementation uses seven
days where the agreement says thirty, the response is not to silently rewrite
the Design to excuse it. You decide whether to correct the implementation or
change the intended behavior, with another explicit approval when coding is
requested.

This is controlled execution, not a promise that every generated result is
correct. Test outcomes and unverified areas still matter. The gain is that
the decision being implemented stays inspectable.

## Two independent stages, one understandable project

Preparation through Prototype retains its goal, usage, decision, drawing and
feedback controls. Development retains its Design and its own Conversation.
You do not have to send every interaction through a single chat, and browsing
a drawing does not retarget a Development draft.

The shared Artifacts index helps you find outputs without merging the two
histories. You can finish discovery without starting Development, or use
Development without first running discovery. Each stage keeps its own work and
permissions; choosing an effort setting for both does not secretly replace
their independently selected models.

This independence is useful when the day ends as well. Saved evidence is
different from a running preview server. Closing a tab does not stop work;
stopping work does not roll back code. Returning to the same project preserves
history without automatically replaying interrupted instructions. You decide
what should happen next.

Tandem's story is not "generate more." It is **make the important assumptions
visible, decide deliberately, and keep implementation anchored to those
decisions**.

## Reading the slides with the current product

The presentation is explanatory material, not a release or qualification
record. Use it alongside the current [quick start](quick-start.md) and
[manual](user-manual.md).

| Source illustration or wording | Current interpretation |
| --- | --- |
| Slide 5's screenshot has a historical **Design** tab. | The integrated discovery path is Preparation, Requirements, Drawings and Prototype. Formal Design belongs to Development; the old screenshot is not a current navigation guide. |
| Slides 5-6 describe two stages and direct entry with an agreed spec. | Stages remain independent. Direct Development also accepts existing code or a rough idea and can establish the Design there. |
| Slide 5's "confirm" and prototype-feedback loop. | Feedback is optional. Showing a milestone is not finishing Prototype, and finishing is not implementation approval. |
| Slide 6's account recovery and purge diagrams. | These illustrate a product agreement, not Tandem's own saved-session recovery or a prescribed retention policy. |
| The older [role-colored workflow](../stage2/docs/workflow-redesign.html) says there is no human technical-plan approval or separate Apply gate. | You still explicitly choose **Plan and implement** before planning/code changes. You do not approve each internal task; implemented files are already in the working copy. Prototype's Show/Apply version control is a different action. |
| That diagram's **Main chat & Tandem** view includes observed main-chat history. | Current Development Conversation shows only its own messages and attributable events, not copied parent/Discovery chat. Ordinary parent chat is not a Development submission. |

The opening deck supports `#1` through `#6` links and **Script / N** for its
speaker notes. The older role diagram supports its own view tabs; its
[Ownership & changes view](../stage2/docs/workflow-redesign.html?view=ownership)
is useful for the responsibility split, with the corrections above. No slide
HTML has to be changed to use this guide.
