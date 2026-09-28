---
name: implementation-lifecycle-reconciler
description: Reconcile provisional living-design lifecycle state from concrete implementation evidence.
user-invocable: false
---

# Implementation Lifecycle Reconciler

Apply this skill only as part of a host-authorized `implementation-reviewer` turn. Analyze the
shared `ReviewContext` and return candidate lifecycle recommendations to the orchestrator. Do not
edit files, call the final submission tool, run commands, or emit a user-facing conclusion.

Independently reconcile every top-level Use case materially affected by the changed
implementation:

- `planned` when no implementation evidence exists;
- `in-progress` when only part of the current design obligation exists;
- `implemented` when code evidence satisfies the full obligation.

Concrete blockers and superseded obligations remain `in-progress`. Represent consequential
decisions through blocking Attention rather than adding another lifecycle state.

Only top-level Use cases carry lifecycle state. Journey steps, Contract, Flow, GUI, and System
entities remain exact design and Attention anchors, but never receive state recommendations.
Follow their canonical links to decide which Use case the changed evidence advances.

Recommend downgrades as well as promotions when recorded state exceeds the evidence. Do not treat
types, placeholders, prose claims, compilation alone, or one branch of a multi-mode contract as
proof that the whole entity is implemented. Never recommend `verified`; during implementation,
`implemented` is the ceiling. `verified` is reserved for later validation that exercises the
complete user-visible use case.

Each recommendation must:

- use perspective `use-case` and identify an exact top-level Use case `elementId`;
- represent a real transition rather than the currently recorded state;
- cite at least one implementation file changed in this turn; and
- include enough relevant implementation evidence to support the partial or complete assessment.

When evidence is insufficient to change an affected entity, omit its reconciliation. Do not
create a lifecycle transition merely because the gap reviewer found Attention. If uncertainty is
a consequential design ambiguity, leave it to `implementation-gap-reviewer`.

For `workspace-bootstrap` or `workspace-reconciliation`, assess every top-level Use case against
the complete implementation workspace, using linked fine-grained design context to understand its
obligation while retaining the triggering diff as the distinction between current-turn and
pre-existing evidence. A reconciliation diff may be empty because the completed work can predate
the resumed turn.
