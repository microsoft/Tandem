---
name: implementation-index-maintainer
description: Persist finalized Use-case lifecycle evidence in the root TANDEM.md index.
user-invocable: false
---

# Implementation Index Maintainer

Apply this skill only as the persistence step of a host-authorized `implementation-reviewer`
turn. The orchestrator supplies finalized lifecycle recommendations and their evidence from the
shared `ReviewContext`. Update only the root `TANDEM.md`. Never edit implementation or canonical
design files, change the recommendations, call the final submission tool, run commands, or emit a
user-facing conclusion.

Before the orchestrator submits lifecycle recommendations:

1. Keep one compact entry per top-level Use case, keyed as `use-case:<elementId>`.
2. Merge every relevant workspace-relative evidence path into that single entry, regardless of
   which implementation directory contains the file.
3. Preserve prior evidence and history. Append a history revision only when state or rationale
   changes.
4. Preserve unrelated valid Use case entries. Remove entries for deleted Use cases and all
   non-Use-case entities.
5. Remove obsolete managed child `TANDEM.md` indexes and set root `children` to an empty array.
6. Do not create entries for untouched `planned` Use cases.

When `ReviewScope` is `workspace-bootstrap`, create the required root index from the full-workspace
Use case assessment before returning control.

When `ReviewScope` is `workspace-reconciliation`, update the existing root index from the
full-workspace Use case assessment, including evidence written before the interrupted turn
resumed.

The managed file uses this heading and marker:

```text
# Tandem implementation progress

<!-- tandem-living-canvas:implementation-index/v1 -->
```

Keep the human-readable Use case section synchronized with the JSON payload:

```text
{
  "schemaVersion": "implementation-index/v1",
  "directory": ".",
  "updatedAt": "ISO timestamp",
  "state": "aggregate lifecycle state",
  "entityRefs": ["use-case:<elementId>"],
  "entries": [{
    "key": "use-case:<elementId>",
    "state": "planned | in-progress | implemented | verified",
    "rationale": "current assessment",
    "evidence": ["workspace-relative path"],
    "history": [{
      "at": "ISO timestamp",
      "state": "lifecycle state",
      "rationale": "assessment at that time"
    }]
  }],
  "children": []
}
```

Use Windows-style workspace-relative evidence paths. Aggregate root state across every canonical
Use case, including planned Use cases without entries. All verified is `verified`; all implemented
or verified is `implemented`; all planned is `planned`; every other mixture is `in-progress`.

Keep the file compact. The human-readable section contains only each Use case's state, current
assessment, and evidence paths. Return control after the root index is ready.
