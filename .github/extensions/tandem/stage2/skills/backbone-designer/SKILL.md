---
name: backbone-designer
description: "Orchestrate relevant tab-specific design skills into one coherent backbone."
user-invocable: false
---

# Backbone Designer

Apply this skill to the request that invoked it. The invoking prompt supplies one action:
`create`, `discuss`, or `revise`.

For `create`, persist all five perspective blocks and finish by calling
`conclude_backbone_proposal` exactly once; do not finish with prose. For follow-up input:

- for `discuss`, answer concisely without opening a proposal;
- for `revise`, use inherited blocks as the baseline, submit only affected perspectives,
  and call `conclude_backbone_proposal` exactly once; never reinterpret it as discussion;
- if a `create` or `revise` request leaves a consequential choice unresolved, never call
  `ask_user` or ask in prose. Persist one blocking or non-blocking Attention item on the closest
  exact design entity, submit the affected block, and conclude normally so the Canvas Attention
  queue collects the answer. Preserve an existing matching Attention item instead of duplicating
  it.

## Design-method orchestration

Invoke specialist skills in this order:

1. Always invoke `use-case-designer`.
2. Always invoke `contract-designer`.
3. Invoke `storage-contract-designer` when important state is stored.
4. Invoke each remaining method only when it materially helps review:
   `control-flow-designer`, `module-designer`, `stack-designer`, `gui-designer`, and
   `deployment-designer`.

An inapplicable method or tab is omitted, not filled with generic content. Storage extends the
Contract block. Stack creates one System aspect; Module and Deployment only refine it. Always
include one Contract aspect. Submit empty arrays for omitted Flow, GUI, and System blocks.

The methods describe one design. Reuse stable actor, interaction, data, and component names across
perspectives. Keep the Canvas compact: short labels, noun phrases, and one-sentence summaries.

## Audience and visual comprehension

Treat comprehension by a person without software-development experience as a required output
quality, not optional polish. Every generated block becomes a visual artifact in the Canvas.

- Lead with user goals, visible behavior, and familiar product concepts.
- Prefer plain language over architecture jargon, abbreviations, protocol terminology, or code
  vocabulary. When a technical term is unavoidable, pair it with a short explanation of what it
  does or why the user should care.
- Make titles and labels understandable in isolation so a person can scan a diagram without
  reading raw JSON or the conversation.
- Keep each visual focused on its primary question. Do not expose implementation inventory merely
  because it exists.
- Use consistent names across perspectives and move specialist detail into Technical details
  rather than making Experience or Screens harder to understand.
- Before submitting, mentally read each rendered path as a non-experienced reviewer: it should
  communicate who acts, what happens, what can go wrong, and what decision needs attention.

## Entity-embedded Attention

Generate design and Attention together. An unresolved question lives directly on the exact design
entity it concerns as an optional `attention` array:

```text
attention[]: {
  id,
  impact: blocking | non-blocking,
  question,
  whyItMatters,
  alternatives: [{ option, implication }, ...]
}
```

Containment is the anchor; never add `context`, `designElement`, candidate files, dispositions, or
a second Attention selection pass. Raise at most three Attention items per perspective, only for
consequential ambiguity. Give each issue one primary entity and stable lowercase kebab-case ID.
Explain why it matters and provide two or three meaningful alternatives.

Use `blocking` only when work on that entity cannot safely proceed without a decision. Use
`non-blocking` when a stated default permits progress. Encode clear low-risk defaults in the
design instead of asking.

Choose the entity by the nature of the question:

- user goal or observable outcome -> Use case or journey step;
- external interface, schema, protocol, storage semantics, or guarantee -> Contract entity;
- branching, ordering, retry, or failure path -> Flow or node;
- screen structure or interaction layout -> GUI sketch or region;
- technology, runtime, deployment, module, or persistence-engine choice -> System layer.

For example, JSON versus SQLite belongs on the relevant System layer, while durability semantics
belong on a Contract entity. Before adding Attention, inspect all inherited Attention across every
perspective. Treat items as duplicates when they ask for the same underlying user decision, even
if the proposed ID, anchor, wording, or impact differs. Preserve the existing item and do not
duplicate one issue across perspectives.

On revision, preserve unresolved Attention that remains relevant. To resolve an item, remove it
from its entity in the submitted block and record the resulting design change in `notes`. To
replace an item, remove the old item and add the new item in the same block revision.

## Output contract

Each tool persists one complete perspective block:

```text
submit_use_case_block -> useCases
submit_contract_block -> contract
submit_flow_block     -> controlFlows
submit_gui_block      -> guiSketches
submit_system_block   -> systemStacks
```

All five submissions are required for initial design. They are host-persisted artifacts, not file
writes. On revision, inherited unchanged blocks need no submission.

`implementationState` is host-maintained provisional lifecycle metadata. Do not infer or change it
during design generation; omit it from submissions. The host initializes top-level Use cases as
`planned` and preserves existing values by stable Use case ID. Journey steps, Contract, Flow, GUI,
and System entities remain fine-grained design and Attention anchors but do not carry lifecycle
state.

After implementation, the independent reviewer reconciles lifecycle state using exact IDs from
the canonical Use case block, the root `TANDEM.md`, and code evidence from the completed turn.
During implementation, `implemented` is the highest available state.

After submissions succeed, call `conclude_backbone_proposal` with:

- `goal`: intended product outcome;
- `summary`: how the coordinated design fits together;
- `aspects`: Contract plus applicable Flow, System, and GUI summaries;
- `notes`: itemized major changes and concise context not represented in structured blocks.
- `reviewSummary`: a focused delta for this design review, containing:
  - one plain-language `headline`;
  - one to four `changes`, each with a stable `id`, short `title`, concrete `description`,
    `whyItMatters`, `visibility`, and an exact `perspective` plus `elementId` anchor.

Use `visibility: visible` when the change is readily apparent in its rendered view. Use
`visibility: summary-only` when the important difference is subtle or otherwise easy to miss,
such as a guarantee, default, terminology correction, removed ambiguity, or cross-perspective
alignment. Describe the actual delta from the previous design rather than summarizing the whole
current design. For an initial design, describe the most consequential choices established by the
review. Every change must tell a non-experienced reviewer what changed and why it deserves
attention, then anchor to the closest exact design element so the Canvas can navigate there.

Conclusion summarizes the already persisted design. It does not select, invent, or rewrite
Attention.
