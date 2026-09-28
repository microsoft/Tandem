---
name: design-impact-classifier
description: "Classify whether a user request can proceed directly or requires backbone review."
user-invocable: false
---

# Design-Impact Classifier

Apply this skill only when the session orchestrator supplies an `AssessmentContext`.

## Input contract

The context contains the current request. In the standalone host it confirms classification in an
ephemeral fork; in the canvas port it confirms classification in the attached current session.
Use inherited conversation when relevant. Do not inspect files, run commands, or modify the
workspace during this classification turn.

Verify before classifying:

1. `schemaVersion` is `assessment-context/v5` or `canvas-assessment-context/v1`.
2. The current request is present.

## Classification

When `activeReview` is present, it identifies the current living backbone. For
`canvas-assessment-context/v1`, classify only whether the request establishes or changes design.
Questions, status requests, explanations, implementation work, validation, and other ordinary
Agent requests choose `no-review` unless they also request a concrete design delta.

Design promotion never implies implementation approval. A later user input must pass through this
classifier again. When that input does not change design, release it to the normal Agent; the
Agent decides whether to answer, inspect, implement, or validate. The structured
`complete-current-design` action retains its managed-run semantics after it passes this design
gate.

For legacy `assessment-context/v5`, informational discussion of the current backbone may still
choose `backbone-review` with `discuss`.
When the request explicitly says a behavior is an existing living-design requirement, treat it as
implementation and choose `no-review` unless the request separately states a new design delta.
Do not reinterpret implementation-layer words such as API, query, contract type, persistence
query, or browser controls as a request to revise the canonical Contract perspective.

For `canvas-assessment-context/v1`, choose:

- `revise` for feedback, corrections, preferences, additions, removals, or any other requested
  design change;
- `none` only with `no-review`.

`discuss` is legacy-only and must not be returned for canvas assessment context.

Determine what the user wants changed, not merely which verb they used:

- approval of the just-discussed or just-revised design followed by "build it", "apply it",
  "implement it", "update the UI", or "change the GUI" means execute the accepted design and must
  choose `no-review` with `none` when no new design delta is introduced;
- references such as "this change", "that", or "it" inherit their target from the immediately
  preceding design discussion;
- "GUI" or "UI" can mean the implemented product surface; do not assume it means the GUI design
  perspective;
- choose `revise` only when the user supplies or requests a new design choice, correction,
  addition, removal, layout, behavior, contract, or other design delta.

Imperatives such as "add," "change," "remove," "we need," and "please include" indicate a revision
only when their object is a new design delta. Never use `discuss` merely because the request is
short or lacks implementation detail.

Input unrelated to the pending backbone follows the normal rules below. Ordinary conversation,
status inspection, implementation, validation, or local reversible work chooses `no-review` and
goes directly to the normal Host Agent.

Choose `backbone-review` when the request establishes or materially changes any of:

- architecture or module boundaries;
- externally visible contracts;
- persistence or data ownership;
- security, privacy, or access boundaries;
- deployment or operational topology;
- another decision that is costly to reverse.

Choose `no-review` only when the requested work appears local and reversible. The review
policy—not this skill—applies the confidence threshold.

## Output contract

Finish by calling `submit_design_impact_assessment` exactly once. Do not provide a prose answer.

Supply:

- `classification`: `no-review` or `backbone-review`;
- `backboneAction`: for canvas context, `none` or `revise`; legacy context also permits `discuss`;
- `rationale`: a concise explanation grounded only in supplied context;
- `confidence`: a number from 0 through 1;
- `affectedAreas`: concrete design areas.

Never call another tool during this classification turn.
