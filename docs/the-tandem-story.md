# The Tandem story: make intent visible

[Try Tandem](quick-start.md) | [All guides](README.md) | [Opening slides](../stage2/docs/tandem-opening-slides-v2.html#1)

You ask an agent to add account deletion. Soon there is a button, code, and tests.
Then you ask, "How do I recover an account I deleted by mistake?"

The agent implemented permanent deletion. You expected a recovery window.
The software can work according to its own assumptions and still be the wrong
product.

This is the question behind Tandem: **how can you and Copilot move quickly
without moving toward different outcomes?**

## From a working result to a shared understanding

The [opening presentation](../stage2/docs/tandem-opening-slides-v2.html#1) begins
with two familiar approaches. In "Describe before building," expectations come
first, but users must imagine an experience from documents.
In ["Build before agreement"](../stage2/docs/tandem-opening-slides-v2.html#2),
the first app arrives quickly, but important assumptions may already be code
before the user notices them.

Neither approach is inherently wrong. The risk is the
["intent gap"](../stage2/docs/tandem-opening-slides-v2.html#3): the user's and
agent's assumptions overlap, but one difference matters enormously.
Tests written for permanent deletion cannot establish that the user wanted it.
As [slide 4](../stage2/docs/tandem-opening-slides-v2.html#4) puts it, more output
is not understanding.

Tandem's vision is the shared whiteboard: a person and Copilot discussing a
journey, pointing to an unclear step, and deciding what should happen before
committing to implementation. Drawings and interactive previews make the
discussion concrete; a visible Design keeps the agreement available afterward.

## Discover the experience, not just the requirements

Imagine an empty project for an account-management app. You choose Preparation
because the outcome matters more than a detailed specification you do not yet have.

"I want to recover an accidental deletion" becomes a usage. Questions clarify
when access stops, how recovery works and what remains undecided. Drawings give
the journey a shape. A prototype lets you try it and notice that "within 30 days"
still leaves the exact deadline ambiguous.

That is the loop in
[slide 5, "Prototype to a spec"](../stage2/docs/tandem-opening-slides-v2.html#5):
statements, targeted questions, an experience to inspect, and optional feedback.
Its historical Model Y image illustrates the idea; it is not a live demo of this
account-management example.

The outcome is confirmed intent with explicit assumptions and open questions,
not documentation of whatever the prototype happened to do. A mock service is
still a mock. Showing a new version is not approving production code.

If the application already exists, you can start directly in Development instead.
Ask Tandem to explore it without changing code and make current behavior visible
in Design. Then distinguish "what it does today" from "what we want."
A rough idea can start there too; an agreed specification is not an entry ticket.

## Keep the agreement beside the work

[Slide 6, "Build against the agreement"](../stage2/docs/tandem-opening-slides-v2.html#6)
shows three views of the account-deletion example: a journey, a recovery timeline,
and unresolved purge decisions.

Normal access stops immediately. Recovery is allowed before 30 days, but rejected
at or after the deadline. Legal retention and shared assets remain separate
decisions: **expiry does not authorize purge**. These are illustrative choices,
not retention advice or Tandem's own session-recovery policy.

You can point to the timeline rather than decode a long specification.
For a non-GUI project, a request sequence or concrete input/output example can
serve the same purpose.

Once satisfied, you request implementation and choose **Plan and implement**.
Implementer builds and validates the agreed journeys in your working copy.
Reviewer checks Design conformance and unnecessary complexity, reports findings
and limits, and returns the decision to you.

If the code uses seven days where Design says thirty, silently changing Design
to excuse the mismatch is not the answer. You decide whether to correct the code
or change the intended behavior. Review does not authorize a new coding cycle.

## Independent stages, deliberate decisions

Discovery keeps its goal, question, drawing and prototype controls. Development
keeps its own Design and Conversation. You can use either starting path without
being forced through the other, and shared artifact navigation does not merge
their histories or retarget your draft.

This is not a promise that AI always gets the answer right. It is a way to keep
assumptions inspectable, consequential choices with the user, and implementation
anchored to what was actually decided.

## Reading the slides with today's source

Open the HTML locally to use `#1` through `#6` and **Script / N** for speaker
notes. The slides explain the vision; the [quick start](quick-start.md) and
[manual](user-manual.md) describe current operation.

| Historical material | Current distinction |
| --- | --- |
| Slide 5's screenshot has a **Design** tab. | Discovery uses Preparation, Requirements, Drawings and Prototype. Formal Design belongs to Development. |
| The slides mention direct entry with an agreed spec. | Development also accepts existing files or a rough idea and can establish the agreement there. |
| The older [workflow diagram](../stage2/docs/workflow-redesign.html?view=ownership) has no human technical-plan approval or Apply-to-project step. | **Plan and implement** is still required before planning/code changes. You do not approve each internal task. Prototype's Show/Apply control is a different action. |
| The diagram includes observed main-chat history. | Development shows its own messages and attributable events, not copied parent/discovery chat. |

None of these illustrations establishes release availability, test coverage,
or a measured speed advantage.
