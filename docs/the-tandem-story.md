# The Tandem story: make intent visible

[Try Tandem](quick-start.md) | [All guides](README.md) | [User manual](user-manual.md)

You ask an agent to add account deletion. Soon there is a button, code, and tests.
Then you ask, "How do I recover an account I deleted by mistake?"

The agent implemented permanent deletion. You expected a recovery window.
The software can work according to its own assumptions and still be the wrong
product.

This is the question behind Tandem: **how can you and Copilot move quickly
without moving toward different outcomes?**

## From a working result to a shared understanding

There are two familiar starting points. Describe before building, and expectations
come first, but users must imagine an experience from documents. Build before
agreement, and the first app arrives quickly, but important assumptions may already
be code before the user notices them. Tandem embraces the fast start without
treating whatever the agent built as what the user wanted.

Neither approach is inherently wrong. The risk is the
**intent gap**: the user's and
agent's assumptions overlap, but one difference matters enormously.
Tests written for permanent deletion cannot establish that the user wanted it.
Visible activity is not visible agreement: logs show what the agent did, not
whether it chose the behavior you expected.

Tandem's vision is the shared whiteboard: a person and Copilot discussing a
journey, pointing to an unclear step, and deciding what should happen before
committing to implementation. Designs and interactive previews make the
discussion concrete; a visible Design keeps the agreement available afterward.

## What a short request leaves unsaid

Not every missing expectation is a question the user already knows to ask.
Consider four situations from the user's perspective:

| What the user knows | Account-deletion example | Useful next step |
| --- | --- | --- |
| Explicit intent | "Let people recover an accidental deletion." | Record the goal. |
| A recognized open question | "I have not chosen the recovery period." | Ask and confirm the boundary. |
| An unstated expectation | "I assumed I would see an Undo action." | Let the user inspect an experience and clarify what they meant. |
| An unconsidered issue | "I had not thought about files shared with teammates." | Surface the consequence and make it an explicit decision. |

These are often called known knowns, known unknowns, unknown knowns and unknown
unknowns. They describe what this user knows at this point, not four kinds of
software feature. Prototyping and review can expose missing expectations; neither
guarantees finding them all. The agent can raise a question, but only the user's
answer establishes the intended behavior.

## Discover the experience, not just the requirements

Imagine an empty project for an account-management app. You choose Preparation
because the outcome matters more than a detailed specification you do not yet have.

"I want to recover an accidental deletion" becomes a usage. Questions clarify
when access stops, how recovery works and what remains undecided. Designs give
the journey a shape. A prototype lets you try it and notice that "within 30 days"
still leaves the exact deadline ambiguous.

The loop is statements, targeted questions, an experience to inspect, and optional
feedback. Resolve the consequential choices needed for a useful prototype rather
than requiring an exhaustive document first. Then return to clarification when
trying the experience reveals more.

Suppose the user looks for a deadline and Undo while trying recovery. That is an
observation worth discussing, not yet a requirement to implement either control.
Ask whether those controls are wanted, confirm their behavior, then incorporate
the answer. A recovery policy can be agreed while the interface and permanent
purge rules remain open.

The outcome is confirmed intent with explicit assumptions and open questions,
not documentation of whatever the prototype happened to do. A mock service is
still a mock. Showing a new version is not approving production code.

If the application already exists, you can start directly in Development instead.
Ask Tandem to explore it without changing code and make current behavior visible
in Design. Then distinguish "what it does today" from "what we want."
A rough idea can start there too; an agreed specification is not an entry ticket.

## Keep the agreement beside the work

By "specification," we mean an understandable agreement about requirements and
design, not necessarily one long document. In Development, **canonical Design**
is that current agreement. A journey, recovery timeline and unresolved-decision
map can express different parts of it; they must not silently invent different
policies.

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

## Judge outcomes, not just activity

A result should help you answer four questions: **What is agreed? What changed?
What evidence supports it? What still needs my decision?**

For the deletion example, evidence that access stops immediately and recovery
works before the deadline supports that scope only. It does not show that the
deadline or Undo interface was wanted or tested, or that permanent purge is safe.
Unit tests remain useful, but code and tests can share the same wrong assumption.
Check the agreed journey across components and read what could not be exercised.

The same distinction applies beyond account management. For a tank game, decide
whether it is solo, shared-device or online play before authorizing the affected
work: each changes controls, rules and infrastructure. Later, a working arena can
still leave difficulty and scoring expectations unresolved. A screenshot shows
an appearance; an "implemented" state reports progress; neither proves those
rules match the agreement.

When an issue appears, distinguish an implementation mismatch from a change in
intent. Correct the code against the existing Design when the agreement still
stands. If the user wants different behavior, revise Design first. In either
case, a new implementation cycle requires fresh approval; an empty question
queue or completed Review is not permission to continue coding.

## Independent stages, deliberate decisions

Discovery keeps its goal, question, design and prototype controls. Development
keeps its own Design and Conversation. You can use either starting path without
being forced through the other, and shared artifact navigation does not merge
their histories or retarget your draft.

This is not a promise that AI always gets the answer right. It is a way to keep
assumptions inspectable, consequential choices with the user, and implementation
anchored to what was actually decided.

## Why add a workspace when an agent can already do this?

An ordinary code agent can prototype, write a specification and review code.
Tandem's proposed value is keeping those activities connected to decisions the
user can inspect and reuse, rather than asking them to reconstruct the agreement
from chat and tool logs. Direct agent use remains a valid choice.

Questions and review add interaction. The hypothesis is that they prevent more
re-explanation and rework than they cost, not that more artifacts automatically
mean better software. Time and user effort to an accepted outcome, missed
expectations and later rework are more useful measures than code or test counts.
A speed advantage has not been established. Adaptive views for different project
types and a broader AI-native IDE remain directions to explore, not promises of
complete current functionality.

## Further reading

Related references include Thariq Shihipar's
[Finding your unknowns](https://claude.com/blog/a-field-guide-to-claude-fable-finding-your-unknowns)
and Anthropic's [AI-native SDLC playbook](https://claude.com/blog/the-ai-native-sdlc-playbook).
The shared direction is durable agreements and human judgment across agent work;
Tandem emphasizes discovering expectations through experience and making the
agreement and evidence understandable. This is not a claim of unique agent
capabilities or full lifecycle coverage.
