---
name: ui-design
license: MIT
description: Discuss UI design in your existing chat, plan the complete screen map, render wireframes in a lightweight preview, and revise stable UI nodes without rebuilding reviewed work. Independent of other skills or the Tandem framework.
---

<!-- Generated from src/planning-prompts.ts. Edit the maintained builder, not this file. -->

# UI design

Use the existing agent conversation for intent, revisions and explicit
confirmation. The preview only displays screens. This skill adds no Copilot
account, model backend, SDK, framework installation or mandatory phase pipeline.
Requirements and Brainstorm whiteboard are optional. A clear brief can be enough.

## Plan the screen map, then the screens

Use the supplied brief, current context and actual available baseline artifacts.
Do not ask people to repeat supplied decisions. Keep confirmed/supplied intent,
your proposals, assumptions and unresolved issues distinct. Clarify only
consequential UI questions through the host's available native question tool
or ordinary chat; never invent tools or move the interview into the preview.

Plan the complete page structure and navigation before any page contents are generated.
Show ALL currently identifiable screen IDs, titles, purposes, viewport sizes,
source references and transitions in chat before filling contents. Derive
screens from accepted usages, not one screen per Requirements question.
Every usage needs a visible mapping or an explicit unresolved/deferred reason.
Mermaid may supplement the screen map, but is never a substitute for UI views.
Do not fabricate accepted requirements to populate source references: use
honest brief IDs, such as brief-booking, when no Requirements IDs exist.

WIREFRAME FOCUS: confirm layout, meaningful content and navigation, not final appearance. The host supplies a neutral wireframe token kit; reuse it instead of emitting palette, font or radius tuning. Prefer standard semantic controls, clear primary actions and labeled image placeholders. Omit decorative icons, ornamental containers and duplicate sample rows. Include essential state/behavior annotations, not separate screens for every state. Do not spend this pass on branding or production polish.
Here the packaged helper supplies that neutral token kit; no framework host
is needed. Fill the existing outline with the shared UI DSL catalog.
Keep real task headings, action labels and enough representative content to judge the information hierarchy. Never replace meaningful labels with Button, H1 or lorem ipsum.
For click-through navigation, set Button.action or Link.destination to the exact outgoing transition ID. These links only preview the saved journey; they do not implement business logic.
Keep the full map available while contents are drafted. An outline or an
empty screen is not ready for visual confirmation.

## Revise the current design, not a replacement

Read the exact current structured document before editing.
These designs contain reviewed choices and user refinements. Patch only what the request or changed accepted requirements require.
Retain unrelated screens, layout, styling, content, viewport sizes, annotations, stable IDs and transitions exactly.
EXISTING DESIGN FOCUS: preserve the established components, appearance and reviewed choices. Do not downgrade existing designs to wireframes or restyle unrelated content.
Patch existing node IDs using validated operations. Metadata edits preserve
the screen's existing UI. Add or remove a screen only when the changed intent
requires it; do not remove/rebuild trees to make a small edit.

When supplied intent changes, reconcile affected source references and screens
without restarting discovery or rebuilding independent work. Clear current
confirmation even if the change affects meaning but not visible components.
Read errors or missing state are not permission to invent a baseline.

The fixed catalog cannot faithfully reproduce arbitrary HTML/CSS, fonts,
artwork or screenshots. Preserve originals, explain unsupported visual details
and do not call a lossy substitute the reviewed design. There is no arbitrary
HTML converter in this skill. Legacy geometric designs are not silently
converted. No backend, business-logic prototype, polished visual-direction
exploration or Development technical Design is included.

## Render and discuss in the same lightweight preview

Reading these instructions and discussing intent require no runtime setup.
The packaged helper path needs existing Node 24+, ordinary file/command
permissions and a real browser or native HTML preview. It needs no npm install
or consumer build. If the host cannot execute it or display HTML, explain that
the rendered loop is unavailable; do not claim a text diagram is a wireframe,
auto-install tooling, start services or invent a browser/canvas capability.
Use other native capabilities only when they genuinely provide the same
validated state and rendered view; do not build a host adapter platform.

Read [the authoring reference](references/authoring.md) for the exact document,
operation and component contracts. Read [the guide](README.md) for commands.
These are agent-facing mechanics; users should not manage files or projects
just to see a design. Use actual host/session temporary paths through normal
permissions, never a personal skill installation or production source folder.
The agent prepares outline/patch/reference input files through ordinary tools.

Create a complete outline first, then fill it using content edits. The helper
emits a self-contained HTML file containing exact structured state and its
visible version. Reuse that temporary output path. Update it, then reload the
SAME panel/window using an actually available host action. If none exists,
tell the user to refresh the same browser view and name the expected version.
No server, watcher, clipboard relay or browser-to-agent approval form is needed.
The preview's screen links describe navigation only, not a working app.

Use read before update and pass the exact displayed baseline version. If a
failed candidate falls back to a retained view, the error and displayed
version identify that view. Use --recover-retained explicitly to edit that
baseline, not the failed candidate. Ordinary updates reject older versions.
The helper keeps only current and one retained temporary view for failure
recovery, not a revision history. Invalid edits leave the existing file intact.
If rendering fails, keep/restore the valid view and disclose the failed update.
Never silently present an old preview as the new version.

Temporary state is not a durable design store. Do not promise that arbitrary
chat history or restarting the preview restores lost structured state.
If it is missing, disclose the loss and use an actual saved artifact or
explicitly start a new draft; do not reconstruct reviewed facts from memory.
Save/export retained files only when requested, through normal tools and
applicable repository conventions. Saving is not publication or implementation.

## Confirm only what was displayed

Refresh before final review to discard illustrative local field values.
Check every planned screen, meaningful content and declared journey links,
then inspect the actual rendered views with available tools. Nonempty JSON,
helper success or a worker's statement is not visual inspection. If only
the human can inspect the browser, attribute their explicit review honestly;
do not manufacture tool evidence or approve an uninspected image.

Show the current version and a brief delta in chat. Ask whether the rendered
layout, content and navigation cover the intended UI, or what should change.
Existing appearance is included only to the extent it is actually represented.
Appearance remains deferred for new wireframes; no application behavior is
proved. Keep unresolved proposals and assumptions distinct.

Record only the user's actual explicit chat confirmation of that displayed
version in conversation. Ambiguous feedback, silence, old versions, partial
screen review and failed/empty views are not current confirmation. No separate
approval file, hash ledger or consent receipt is needed. A subsequent change
clears current confirmation while preserving the conversation's historical
meaning. UI confirmation never authorizes implementation.

The existing format supports at most 8 screens, 40 transitions and 256 KiB,
with additional component limits in the reference. Never truncate a larger
accepted journey silently. Explain the limit and obtain a real scope decision.
No live model qualification, spending or additional agents are implied.
