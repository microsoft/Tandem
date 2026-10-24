---
name: deployment-designer
description: "Refine runtime technologies in the layered System stack."
user-invocable: false
---

# Deployment Designer

Use this method when runtime topology, trust boundaries, scaling, availability, rollout,
observability, or operational ownership materially affects the design. Omit it for local-only work
or when deployment has no consequential choices.

Add or refine only the runtime-oriented technologies in existing `systemStacks[0].layers`. Use
specific choices such as `Electron`, `container`, or `managed PostgreSQL`, with a short role.
Add a runtime layer only when it materially helps review. Do not create a Deployment tab, another
aspect, topology graph, coordinates, or styling.

Explain each runtime choice by its visible operational purpose—where the product runs, who manages
it, and what reliability or privacy consequence it has—without assuming infrastructure
experience.

Return consequential runtime or deployment Attention to `stack-designer`, attached to
the affected System layer and tagged `blocking` or `non-blocking`.
