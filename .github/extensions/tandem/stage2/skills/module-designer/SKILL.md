---
name: module-designer
description: "Refine responsibilities in the layered System technology stack."
user-invocable: false
---

# Module Designer

Use this method when logical responsibilities materially influence technology boundaries. Omit it
when the stack can be described directly by `stack-designer`.

Help `stack-designer` choose the smallest coherent layers and state what each layer owns. Do not
turn implementation files, framework folders, or individual services into layers.

Contribute to exactly one stack:

```text
systemStacks[0]
├─ title
└─ layers[]
   ├─ id
   ├─ name
   ├─ responsibility
   └─ technologies[]: { name, role }
```

Use stable lowercase kebab-case IDs. Preserve top-to-bottom dependency order. Do not emit
connections, coordinates, styling, icons, or a separate module diagram.

Phrase layer names and responsibilities by the product job they perform. Avoid internal code
organization terms unless a non-experienced reviewer needs that boundary to understand a
consequential tradeoff.

Return consequential module-boundary Attention to `stack-designer`, attached to the
affected System layer and tagged `blocking` or `non-blocking`.
