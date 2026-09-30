---
name: storage-contract-designer
description: "Design memory, database, file, object-store, or cache contracts inside Contract."
user-invocable: false
---

# Storage Contract Designer

Use this method when consequential state is retained in memory, a database, a file, an object
store, or a cache. Omit it for genuinely stateless work. This method contributes
`contract.storageContracts`; it never creates a Data tab or an `aspects` entry.

For each independently owned store emit exactly:

```text
storageContract
├─ id
├─ name
├─ medium: memory | database | file | object-store | cache
├─ ownerParticipantId
├─ purpose
├─ records[]
│  ├─ id
│  ├─ name
│  ├─ description
│  ├─ fields[]: { id, name, type, required, description }
│  ├─ keys[]: { id, kind, fieldIds, purpose }
│  └─ constraints[]: { id, statement }
├─ relations[]: { id, fromRecordId, toRecordId, kind, statement }
├─ guarantees[]: { id, statement }
└─ lifecycleRules[]: { id, statement }
```

`kind` for keys is `primary`, `unique`, or `index`; relation kind is `one-to-one`,
`one-to-many`, or `many-to-many`. Use stable lowercase kebab-case IDs. Reference an existing
Contract participant as the owner. Include only fields, keys, constraints, and relationships that
define the storage agreement or expose a consequential design assumption.

The contract must state what acknowledged storage operations guarantee and when records are
created, changed, expired, or deleted. Do not describe storage as a generic architecture summary:
make its persisted shape and semantics reviewable.

Use familiar domain names and plain-language field descriptions. Explain keys, relationships,
retention, and durability in terms of what information the product remembers and what the user can
expect, rather than assuming database knowledge.

Return Attention about storage guarantees or persisted semantics to `contract-designer` for
embedding on the relevant Contract entity. Return persistence-engine Attention such as JSON
versus SQLite to `stack-designer` for embedding on the relevant System layer. Do not emit the same
question in both places.
