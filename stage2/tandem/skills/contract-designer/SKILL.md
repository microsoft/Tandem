---
name: contract-designer
description: "Design the interaction portion of the visual Contract set."
user-invocable: false
---

# Contract Designer

Explain how the major use cases are implemented between components or external actors. The
Contract page is a set of related contracts, not one protocol and not one skill per tab.

Emit exactly `contract-set/v1`; do not add, remove, rename, or improvise fields:

```text
contract
├─ schemaVersion: "contract-set/v1"
├─ title
├─ context
├─ participants[]: { id, name, responsibility }
├─ interactions[]
│  ├─ id
│  ├─ name
│  ├─ kind: command | query | event | stream
│  ├─ fromParticipantId
│  ├─ toParticipantId
│  ├─ input: { name, description }
│  ├─ output: { name, description }
│  ├─ errors[]: { code, meaning }
│  └─ guarantees[]: { id, statement }
├─ storageContracts[]
│  └─ output from `storage-contract-designer`, or [] when no stored state exists
└─ lifecycleRules[]: { id, statement }
```

Define two to six participants and one to seven important interactions. IDs and error codes are
stable lowercase kebab-case identifiers; labels and descriptions are user-facing. Participant
references use IDs, never names. Use the interaction kind by semantics: `command` changes state,
`query` reads state, `event` announces a fact, and `stream` carries an ongoing sequence.

Each interaction has exactly one input and output object, zero to three important errors, and one
to three guarantees. Add no more than four material ordering, state, or lifecycle rules. Every Use
case step references an interaction ID. Use compact phrases suitable for a visual protocol map. Do
not hide unresolved choices inside a seemingly final contract. Do not improvise storage fields;
use `storage-contract-designer` when memory, database, file, object-store, or cache state matters.

Although IDs remain technical and stable, every visible participant name, interaction name,
description, error meaning, and guarantee must be understandable to a non-experienced reviewer.
Name components by their product role, explain what crosses each boundary in everyday language,
and avoid unexplained acronyms or transport-specific jargon.

For a CLI entry interaction, use a compact representative invocation such as
`todo-scan <path> [options]` as `input.name`, and a concise visible result such as
`report + exit status` as `output.name`. Keep individual flags and parser details in the
description only when they affect a consequential default; do not turn the contract into command
reference documentation.

Attach zero to three Attention items directly to exact visible Contract entities, only for
consequential ambiguity in an external interface, schema, protocol, lifecycle rule, or guarantee.
Each item has `id`, `impact`, `question`, `whyItMatters`, and two or three
`{ option, implication }` alternatives.
Technology-engine choices belong to the System submission instead.

After incorporating any storage-contract method output, persist
`{ contract }` through `submit_contract_block`. On revision, use the inherited block, including
its embedded Attention, as the baseline and submit only when this perspective changes.
