---
name: implementation-gap-reviewer
description: Detect consequential unagreed implementation decisions, design inconsistencies, emergent Attention, and unmapped behavior.
user-invocable: false
---

# Implementation Gap Reviewer

Apply this skill only as part of a host-authorized `implementation-reviewer` turn. Analyze the
shared `ReviewContext` and return candidate findings to the orchestrator. Do not edit files, call
the final submission tool, run commands, or emit a user-facing conclusion.

## Review criteria

Report a finding only when implementation evidence reveals one of these consequential gaps:

1. **Unagreed implementation decision** — implementation silently introduces a consequential
   behavior, default, workflow mechanism, or operating policy that the user did not request and
   the living design does not establish. Absence of an objection is not agreement.
2. **Design inconsistency** — implemented behavior contradicts a current Use case, Contract,
   Flow, GUI, or System entity.
3. **Emergent Attention** — implementation selects a consequential default or commitment that
   the design leaves genuinely undecided.
4. **Unmapped implementation entity** — implementation introduces a user-visible behavior,
   contract, flow, interface region, or system responsibility absent from the design.

Treat unagreed implementation decisions as a primary audit target, including decisions hidden in
host orchestration or control flow. Look specifically for:

- persistent modes or state changes that alter later user requests;
- automatic retries, fallbacks, failure-open/failure-closed behavior, or implicit skips;
- new thresholds, timeouts, retention, ordering, ownership, or synchronization policies;
- new permission, security, privacy, or data-lifecycle assumptions; and
- defaults that make later behavior difficult or expensive to reverse.

Use this test: if the decision had been shown before implementation, might a reasonable user have
chosen differently because it changes product behavior, future agent behavior, risk, cost, or
reversibility? If yes, it is likely Attention. Ordinary local coding choices are not.

For example, switching a long-lived agent session into plan mode for one design turn may appear
to be a harmless safety mechanism while causing a later implementation request to be deferred.
When neither the user nor the design established that persistent workflow change, report it as
Attention even if the implementation has a reasonable rationale.

Do not report:

- style preferences, naming, formatting, or ordinary local implementation details;
- speculative concerns without concrete code evidence;
- implementation choices already represented by the design; or
- an Attention item already present in the canonical blocks.

Inspect all existing Attention across every canonical perspective before returning findings.
Treat a finding as already represented when it asks for the same underlying user decision, even
if its proposed ID, anchor, wording, or impact differs. Omit that finding rather than creating a
second question.

For unmapped behavior, do not invent a design entity. Anchor the question to the closest existing
entity that motivated it and ask whether to retain the behavior and revise the design or remove
the behavior.

## Anchoring and evidence

Every finding must:

- use an exact existing `elementId` from the canonical blocks;
- use the perspective containing that entity;
- cite at least one implementation file changed in this turn;
- explain observed code behavior rather than quoting the assistant response;
- use a stable kebab-case Attention ID; and
- offer two or three concrete alternatives with implications.

Return every qualifying finding, ordered by user-visible behavior, contracts, data ownership,
irreversibility, and rework cost. Return no finding when the evidence does not meet this bar.
