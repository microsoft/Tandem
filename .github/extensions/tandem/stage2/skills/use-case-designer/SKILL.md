---
name: use-case-designer
description: "Design the PM-level Use case tab and selectable user journeys."
user-invocable: false
---

# Use-Case Designer

Design the PM-level product overview before considering internal architecture.

Identify two to seven major use cases that together cover the core product experience. A use case
is a user goal with an observable outcome—not an API endpoint, screen, command, or internal
operation. Do not enumerate minor edge cases.

For each use case provide:

- a stable ID and short goal-oriented title;
- the user or external actor;
- the observable outcome;
- a representative journey of one to six steps.

Each step follows:

```text
{ id, userAction, systemResponse, interactionId }
```

Implementation state belongs only to the containing Use case. Do not put `implementationState`
on journey steps; they remain fine-grained design and Attention anchors while the host initializes
and preserves coarse Use case progress.

Use the user's language and assume the reviewer has no software-development background. Titles,
actions, and responses must describe recognizable goals and visible behavior without API,
framework, or architecture jargon. A reviewer should understand the complete experience map by
reading only its visible labels. `interactionId` must exactly match a stable `contract-set/v1`
interaction ID, not its display name. Together the use cases form an experience map; selecting one
reveals its journey. Keep the primary experience clear while leaving detailed error branches to
the Contract or Flow subviews.

Attach zero to three Attention items directly to the relevant Use case or journey step, only for
consequential ambiguity in a user goal or observable outcome. Each item has `id`, `impact`,
`question`, `whyItMatters`, and two or three `{ option, implication }` alternatives.

Persist `{ useCases }` through `submit_use_case_block`. On revision, use the inherited block,
including its embedded Attention, as the baseline and submit only when this perspective changes.
