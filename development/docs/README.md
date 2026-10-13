# Stage 2 design reading guide

Start with the [current implementation guide](../tandem/README.md). Its
lifecycle description and the executable source/tests distinguish shipped
behavior from earlier design intent.

## Selected documents

| Document | Purpose |
| --- | --- |
| [Stage 1 integration plan](../stage1-integration-plan.md) | Designer continues from existing documents and a mocked HTML prototype; intended flow, acceptance checks and open integration choices. |
| [Two-stage overview slides](tandem-opening-slides-v2.html#6) | Stage 2's agreement-centered development loop. Read the speaker notes for the explicit Implementer, Reviewer and user boundaries. Examples are illustrative, not product test evidence. |
| [Extended background slides](tandem-opening-slides-light.html#1) | Optional historical 15-slide presentation: hidden expectations, scoped evidence, a captured tank-game workflow, Q&A and related work. Not a current operating guide. |
| [Human-loop prompts and behavior](human-loop-prompts.md) | Request interpretation, role responsibilities, question context, confirmation and native workflow behavior. The executable prompt source is `tandem/public/prompts/human-loop.json`. |
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

## Presentation provenance

The extended deck was supplied as `tandem-opening-slides-light.html`, titled
**Tandem - Group Meeting Opening (Light)**, and imported on 2026-10-13.
Source SHA-256:
`3090312b185b78d94c5b6698d84d1d16fcbd2333159d380e55abffe725f2be68`.
All 15 slides, speaker notes and 14 embedded PNGs are retained. Personal
workspace/session header metadata was opaquely redacted and re-encoded in three
screenshots: the first on slide 10 and the first and third on slide 12. No private
values or source-machine paths are included here. The supplied source is unchanged.

The portable HTML needs no local app, image folder or external rendering library.
Its two public article links are optional references, not rendering dependencies.
Use `#1` through `#15`, arrow controls, **Script / N** for notes, and the numbered
walkthrough image controls.

The **Teleos Living Canvas** captures and older stage/Attention labels are retained
as historical context, not current Tandem UI instructions. Screenshots and reported
progress are not tool-backed validation of today's runtime. The standalone
[Tandem story](../../docs/the-tandem-story.md), [manual](../../docs/user-manual.md)
and [task recipes](../../docs/use-cases.md) contain the essential explanations
without requiring these references.

## Integration boundary

Stage 1 owns prototype-led discovery. Stage 2 owns development against the
agreement. The provisional handoff is documents and a mocked HTML prototype,
which Designer reads as an existing Design to continue. No exact interchange
schema or automatic integration is established by this source transfer.
