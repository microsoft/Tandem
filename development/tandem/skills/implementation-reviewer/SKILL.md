---
name: implementation-reviewer
description: Orchestrate implementation-gap analysis, Use-case lifecycle reconciliation, and root implementation-index maintenance.
user-invocable: false
---

# Implementation Reviewer

Review a completed implementation turn inside the main code-agent session only when the host
prompt supplies an `ImplementationReviewToken`. Never self-invoke based only on seeing code
changes. This is a read-only code review except for the explicitly delegated `TANDEM.md` index
maintenance step. Never modify implementation or canonical design files, run commands, or revise
the living design directly.

The token authorizes exactly one review turn. Calling `submit_implementation_review` consumes the
token and immediately returns the session to its normal code-agent role. Do not carry this review
role into any later user request that lacks an active token.

## Review context

The host prompt provides:

- the implementation-review token;
- the original implementation request;
- the implementation files changed during that turn, including bounded before/after regions;
- the root `TANDEM.md` implementation-index path; and
- the canonical manifest path under `.tandem/living-canvas/design`.

Treat these inputs plus the files read during this review as one immutable `ReviewContext`. Read
the manifest, relevant canonical blocks, the root `TANDEM.md` when it exists, and only the
implementation paths listed in `ImplementationChanges.changedFiles`. That list
is the exhaustive implementation-code scope changed since the previous review: do not inspect,
search, or rescan other implementation files. Use supplied before content as evidence for deleted
files.

The root index stores one concise entry per assessed top-level Use case, with all relevant evidence
paths. Treat recorded status as navigation and review history, not unquestionable proof. A missing
root index means no prior implementation assessment exists.

When `ReviewScope` is `workspace-bootstrap`, assess every top-level Use case and inspect its linked
fine-grained design context plus the
implementation paths listed in `ImplementationChanges.changedFiles`. This is the one explicit
exception where that list contains the complete implementation workspace because no prior index
exists. `ImplementationChanges.details` still identifies the actual triggering turn diff.

When `ReviewScope` is `workspace-reconciliation`, the prior implementation turn was interrupted
before review. Assess every top-level Use case against the complete implementation workspace,
including work completed before restart. `ImplementationChanges.changedFiles` is the complete
eligible implementation scope, while `ImplementationChanges.details` contains only changes made
after resume and may be empty.

## Specialist orchestration

Apply the specialist skills in this order within this same review context:

1. Invoke `implementation-gap-reviewer` to produce all qualifying Attention findings.
2. Invoke `implementation-lifecycle-reconciler` to produce evidence-backed lifecycle
   recommendations for every materially affected top-level Use case.
3. Reconcile the two analyses. Findings and lifecycle changes are independent: either list may be
   empty, and one must not be invented merely to justify the other.
4. When lifecycle recommendations require durable evidence, invoke
   `implementation-index-maintainer` with the finalized recommendations. It is the only specialist
   allowed to edit files and may edit only `TANDEM.md`.
5. Call `submit_implementation_review` exactly once.

The specialists are instruction modules applied by this main agent, not separate sessions. Keep
their evidence and conclusions in the current review context so later steps can use earlier
analysis. Do not ask the user to coordinate them.

## Output

Only call `submit_implementation_review` after every required `TANDEM.md` update is complete. The
host validates exact design anchors, changed-file evidence, lifecycle transitions, and the root
index. It rejects missing, stale, or inconsistent evidence.

- Use `consistent` with an empty `findings` array when no qualifying gap exists.
- Use `attention-required` with one or more findings otherwise.
- Return lifecycle recommendations in `stateUpdates`; they do not determine Attention status.
- Keep `summary` concise and evidence based.

The successful tool result explicitly reports that the review token is closed. Treat that as the
end of this skill's authority. Do not emit a prose conclusion after the tool call.
