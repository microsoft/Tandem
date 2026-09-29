# Stage 2 design reading guide

Start with the [current implementation guide](../tandem/README.md). Its
lifecycle description and the executable source/tests distinguish shipped
behavior from earlier design intent.

## Selected documents

| Document | Purpose |
| --- | --- |
| [Stage 1 integration plan](../stage1-integration-plan.md) | Designer continues from existing documents and a mocked HTML prototype; intended flow, acceptance checks and open integration choices. |
| [Two-stage overview slides](tandem-opening-slides-v2.html#6) | Stage 2's agreement-centered development loop. Read the speaker notes for the explicit Implementer, Reviewer and user boundaries. Examples are illustrative, not product test evidence. |
| [Human-loop prompts and behavior](human-loop-prompts.md) | Request interpretation, role responsibilities, question context, confirmation and native workflow behavior. The executable prompt source is `tandem/public/prompts/human-loop.json`. |
| [Test startup and reopen](testing-startup-and-reopen.md) | Repeatable fresh startup, SDK-host consent ordering, normal Close, same-session recovery, evidence and owned cleanup. Separate from normal installation. |
| [Visual workflow](workflow-redesign.html) | Role ownership, user handoffs and Host-owned transitions. The current implementation guide and prompt contract cover subsequent refinements, including implementation confirmation. |
| [Supported Design artifact formats](supported-artifact-formats.md) | Portable artifact formats, source references, rendering restrictions and image/annotation behavior. |

The historical backlog, delivery trackers, earlier orchestration proposals and
old session evidence were deliberately not bundled. The workflow's related links
have been updated to this self-contained document set; the source diagram and
its historical explanations are otherwise preserved.

Persistence contracts and their tests are included with the application under
`tandem/runtime-src/domain/host-state-wal.ts`,
`tandem/runtime-src/domain/human-loop/`, and `tandem/test/`. Their current
behavior should not be inferred from an older recovery proposal.

## Integration boundary

Stage 1 owns prototype-led discovery. Stage 2 owns development against the
agreement. The provisional handoff is documents and a mocked HTML prototype,
which Designer reads as an existing Design to continue. No exact interchange
schema or automatic integration is established by this source transfer.
