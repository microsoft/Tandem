---
name: brainstorm-whiteboard
license: MIT
description: An Excalidraw-powered, two-way brainstorming whiteboard that both the agent and the human can edit, annotate and seal as peers. Use it when a user can show an idea or feedback more easily than type it, or when a sketch helps the agent explain, explore or compare ideas. Read and interpret human sketches as well as creating your own; proactively use shapes, diagrams and annotations without waiting for a drawing request. Keep chat self-contained so viewing the board is never required to understand the response.
---

# Brainstorm whiteboard

**Both the agent and the human can create, edit, annotate and seal the board
as peers.** This is not a one-way diagram generator or a picture that only the
human can adjust. Either participant can refine the other's visual work and
seal a version for the next handoff.

The board is also a visual input channel for the human. Someone can show an idea
by sketching, moving a shape, connecting two items or marking an area when words
are awkward. They need not translate that drawing into a detailed text prompt:
the agent reads the sealed snapshot and object changes, interprets them, and
continues the conversation.

Use the board naturally when a visual helps. This optional agent-neutral skill
complements the agent's chat interface; it replaces neither chat nor Tandem and
requires no other skill. Chat carries the conversation; the board gives it an
editable visual reference. **Optional means the user can understand
the chat without opening the board or relying on it still existing.** It does
not mean the agent should be reluctant to use a helpful visual.

## Engine and editable content

**Excalidraw is the editing and rendering engine**, embedded through
`@excalidraw/excalidraw`. Humans use its native shapes, text, arrows and drawing
tools. Agent reads and edits carry native Excalidraw elements through this
prototype's supported, validated subset, not HTML/SVG pictures or a separate
diagram language.

Preserve native element IDs, shape-associated text and arrow bindings so both
participants can continue editing the same diagram. Use the supported payloads
in the [API and native-element reference](references/api-and-elements.md) rather
than assuming every upstream Excalidraw field or feature is exposed. For
authoring/refinement, load the [tested editing cookbook](references/editing-cookbook.md)
on demand: it supplies complete executable recipes and a few deterministic
native-operation helpers, including a rough UX sketch and a targeted update.
The agent does not need to reverse-engineer the validator for ordinary edits.

The small local Node service supplies topics, in-memory working state, immutable
seals, factual diffs and the read/edit/seal/snapshot API. PNG snapshots use
Excalidraw's rendering, not a screenshot of the editor controls. This is a local
embedded editor, not automation of the hosted excalidraw.com application.
Understanding the drawing remains the LLM's job.

## Decide whether to use it

Proactively sketch when seeing relationships, steps, alternatives or spatial
arrangement would help the user understand, explore or decide. This can be
useful while explaining architecture, discussing a design, tracing a flow,
debugging interactions or comparing approaches. The user need not ask for a
drawing, chat need not have failed, and you need not know in advance that the
user will edit it. A useful explanation is enough reason to start a visual that
can then be refined together.

Offer visual input when the user finds an idea hard to explain in text or would
rather show a relationship or change. The user can start the visual, not only
react to an agent-created diagram. Keep ordinary chat available if they prefer
typing.

Honor explicit whiteboard requests. Otherwise choose the representation that
helps the current discussion: prose, a table, an inline diagram or this editable
board. A short syntax answer or a small list usually needs no board, but a code
question may benefit from one when connections or execution paths matter.
Choose visuals freely when helpful, without requiring the user to view them
to understand the answer. Not every task or conversation turn needs a drawing.

Before opening, briefly frame the visual's purpose in chat, such as "I'll sketch
the retry branches so we can see the failure paths." Then proceed within normal
host permissions; do not turn choosing a useful visual into a permission
interview.

## Keep chat self-contained

Explain the essential relationships, reasoning, recommendations, assumptions
and open questions in chat. The board illustrates that explanation and supports
editing; it must not be the only place that contains the answer or a decision.
Use named components and describe their relationship rather than only saying
"see the diagram" or "the box on the left".

This is the agent's responsibility when responding, not a requirement that the
human restate every sketch in prose. Interpret the visual input, explain your
reading in chat, and ask about genuine ambiguity instead of demanding a textual
duplicate or treating an interpretation as confirmed intent.

After a visual handoff, describe the relevant changes and their implications
in chat, distinguishing observed edits from inferred intent. Someone reading
only the conversation should still understand what changed, what was decided
and what remains unresolved. There is no need to duplicate every coordinate or
serialize the whole drawing into prose: preserve the meaning needed to follow
the discussion.

If the board is closed, unavailable or lost on restart, continue from the
conversation and explain any missing visual evidence. Do not make reopening
or reconstructing the board a prerequisite for understanding prior answers.

Keep explanations, questions and decisions in chat. Do not mirror the transcript,
turn every topic into a drawing or require a seal on every turn. Return to chat
as soon as the visual stops helping.

## Typical when-and-how examples

These are illustrative possibilities, not inferred user requirements or a
required sequence. Draw only the portion relevant to the actual discussion.

- **Human-originated sketch:** "It's hard to explain; let me show you." Let the
  user draw a relationship or mark a desired change and seal it. Read that
  topic's snapshot and structured state, using a comparison when there is a
  prior seal. Explain what you see in chat and refine it together; the user need
  not supply a formal diagram or repeat the whole idea in text.
- **Architecture relationships:** "Explain how the request reaches the worker
  and where the queue belongs." Proactively draw a few native service boxes with
  associated labels and bound arrows. Use the picture to explain the paths in
  chat, then let the user move the queue or mark a concern. Seal a meaningful
  view; there is no need to wait for an explicit request to draw. The chat
  explanation names which component sends to which and what the queue does.
- **Branching workflow:** "Let's work out our payment retry policy." Sketch the
  known success, failure and retry paths with native boxes/diamonds and bound
  labels/connectors; leave undecided branches explicit. State the retry/review
  conditions and undecided rules in chat, not only on the arrows.
  If the user reconnects or annotates the flow and seals it, read that seal
  against the prior seal before refining.
- **Low-fidelity layout/spatial feedback:** "How could we organize this settings
  page?" Sketch a rough arrangement of panels and controls with editable
  rectangles and associated labels. Explain the trade-offs in chat and invite
  spatial feedback when useful. Keep this a rough layout, not a functional UI,
  pixel-perfect mock or screenshot masquerading as editable content. Describe
  the proposed arrangement and its rationale in text as well.
- **Human-edited handoff:** after an agent seals a flow, the user moves a node,
  adds a box called "new", and seals it. Read that exact returned version with
  `compareTo` the agent's previous seal, optionally with its matching image.
  Describe the actual added box, movement and connection changes in chat so the
  handoff is understandable without seeing the board.
  The new box's meaning is unresolved: ask about it or leave it explicitly
  unknown; do not silently rename it "approval" or "review". Preserve its ID,
  label and other user changes when applying agreed refinements.

All diagram examples use native shape-associated labels and declared arrow
bindings. Standalone questions/annotations can intentionally remain unbound.
Factual differences supply evidence; understanding intent is the LLM's job.

## Start or use the dedicated board

First use any board context already present in the conversation. Verify its
actual service with:

```powershell
node "<skill-directory>\scripts\whiteboard.mjs" health --url "<known-board-url>"
```

Check the returned service/instance identity against the context; a URL alone
does not identify the same RAM board after a restart. Read the relevant seal
before editing. Do not launch, reset or reseed a fresh board for every refinement.
If the service is gone or its instance changed, explain that the previous RAM
versions are unavailable rather than pretend archived exports restored them.

For separate discussion threads, use named **topics inside this one board**.
For example, "Architecture" and "Retry policy" can keep different editable pages
and sealed handoffs. Reuse an existing topic for continued refinement; do not
create a topic or fill a template on every chat turn. Each topic has its own
working drawing, seals, latest/pending state and differences. All remain RAM-only.

List/create topics with the helper:

```powershell
node "<skill-directory>\scripts\whiteboard.mjs" topics --url "<known-board-url>"
node "<skill-directory>\scripts\whiteboard.mjs" create-topic --url "<known-board-url>" --json '{"name":"Retry policy"}'
```

Keep the returned `topicId` **with every handoff versionId** and explicitly
address that topic in later read/edit/seal/snapshot requests (`--topic` in CLI).
The human's Topic selector never redirects an agent request. For old callers
only, omitted `topicId` targets the fixed original `default` topic (Main), never
the selected human page. Do not rely on that fallback for named discussions.
Cross-topic version reads/comparisons fail rather than substituting a seal.
These are drawing pages, not workspace/source-file attachments or skill phases.

For a genuinely new board, resolve this skill's own directory. First source
setup requires Node 24.15+ or Node 26+, npm, registry access, and a modern browser:

```powershell
Set-Location "<skill-directory>"
npm ci
npm run build
node scripts\whiteboard.mjs serve
```

The command prints the verified loopback URL, instance ID and PID and stays
running. Use the host's supported background-service mechanism if needed.
Open that exact URL in an ordinary browser. If the host has no browser/image tool,
say so and provide the URL for the user to open; do not claim you displayed,
inspected or interpreted the visual. JSON operations alone are not browser
rendering evidence. If the host cannot run local tools either, explain the
limitation and stay in chat rather than fabricate a working board.
No Copilot account, SDK, MCP server, workspace parameter, source attachment or
per-workspace registry is required.
Do not adopt or restart a different service merely because it has a whiteboard URL.

**Memory only:** every topic's working content and explicitly sealed versions exist only in
the service's RAM. Stopping/restarting it loses both, including the empty starting
seal. There is no scene autosave or restoration from disk/browser storage.
Do not claim immutable means durable. Explicit requested downloads are exports,
not automatic document persistence.

## Same three operations for every participant

Human editing and the human **Seal version** button use the same authoritative
edit/seal engine as the JSON API. There are no human/agent roles, approval
privileges, locks, turn scheduling or agent calls on drawing.

The CLI accepts `read`, `edit`, `seal` and a read-only `snapshot` convenience,
plus tooling `health`/`serve` and topic list/create:

```powershell
node "<skill-directory>\scripts\whiteboard.mjs" read --url "<printed-url>" --topic "<topicId>"
node "<skill-directory>\scripts\whiteboard.mjs" edit --url "<printed-url>" --topic "<topicId>" --input "<edit-request.json>"
node "<skill-directory>\scripts\whiteboard.mjs" seal --url "<printed-url>" --topic "<topicId>" --input "<seal-request.json>"
node "<skill-directory>\scripts\whiteboard.mjs" snapshot --url "<printed-url>" --topic "<topicId>"
```

Use actual returned IDs, not illustrative `v1` strings. The
[reference](references/api-and-elements.md) lists the complete supported
request/response, native field/default/binding and error/limit contract.

### Read

`read({ topicId, target: "latest", compareTo?: "<exact-seal>", includeImage?: true })`
returns a sealed scene, its actual `topicId`/`versionId` and `hasUnsealedChanges`.
Default/`"latest"` means the most recent **sealed** snapshot, never the draft.
It resolves only within the addressed topic, as does `compareTo`.
When a peer has newer unsealed work, still read the old seal with the pending
flag; wait/discuss the next seal instead of overwriting unseen work.

Exact sealed IDs remain repeatable. Missing/unsealed target or comparison IDs
fail explicitly; do not silently substitute another state or empty differences.
`changes` is a factual baseline-to-target object diff, not semantic intent or
attribution. Camera, selection and bookkeeping are excluded; geometry, text,
style, relationships and ink remain. A requested PNG is rendered from that same
captured seal, not a later working board.

### Edit

`edit({ topicId, expectedVersionId, operations })` atomically adds, updates or removes
specific native objects. Preserve unrelated elements and stable IDs. Validate
the entire batch, including references, before commit. Unknown IDs, duplicate
adds, unsupported fields and invalid relationships are errors, not partial work.

Use the last working ID returned by your successful edit for further edits or
sealing. A stale ID rejects without changes. Do not just substitute the newest
ID into a stale proposal; obtain the next sealed handoff and reconcile.
There is no implicit whole-board replacement or ID regeneration.

**Author diagrams with shape-associated labels.** Declare text `containerId`
and the shape's reciprocal `boundElements`, and explicit arrow `startBinding` /
`endBinding` plus reciprocal shape references. Use the declared native structure,
not proximity guesses or grouping as a substitute. Labels/connectors then follow
native moves/resizes. Keep intentionally standalone annotations unbound.
`scripts/example.mjs` provides a bound flow; `scripts/cookbook.mjs` and
`shared/authoring.mjs` supply tested creation, rename, node geometry,
insertion/rewire, explicit deletion and native UX refinements as ordinary edit
operations. Helpers preserve unrelated IDs/metadata and reject complex cases
they cannot safely adjust. For raw geometry changes, include native
child/connector geometry updates in the atomic batch; the server invents no layout.
Native objects are the foundation for UX and human sketch refinement. Mermaid
is only an optional appropriate flow-creation recipe, not UX/canonical input;
`edit` does not accept Mermaid. After human edits, use the actual native objects,
never regenerate an old diagram definition over their changes.

### Seal

`seal({ topicId, expectedVersionId })` retains an immutable complete scene under the
**same current `versionId`**. It does not mint another ID channel, freeze editing,
imply approval, save a source file or invoke an agent. Re-sealing unchanged state
can return the same seal. Later content edits get new working IDs and cannot
mutate prior seals.

The human button waits for that tab's edits to reach the authoritative state
and uses the same version precondition. Peer conflicts preserve unsent local
content in the tab; download it before explicitly reloading current working state.

### Snapshot

`snapshot({ topicId, target?: "latest" | "<exact-sealed-versionId>" })` captures the
**whole addressed topic** as PNG, not a collage of pages or the current viewport,
selection or editor chrome. It defaults to that topic's latest seal, resolves
it once and returns actual `topicId`/`versionId`, `hasUnsealedChanges` and
`image: { topicId, versionId, dataURL, width, height }`.
Newer drafts do not replace the target image. Missing/unsealed IDs fail
explicitly. There is no live-draft target, implicit seal or content mutation.
It reuses the same captured-seal rendering as `read({includeImage:true})`.

## Human viewing controls

The compact header also gives the human two conveniences, not additional agent
operations or a required handoff step:

- **Reset to latest sealed** restores the latest seal's content to the working
  board. It confirms before discarding unsealed changes; Cancel changes nothing.
  All seals remain readable. A content-changing reset is an ordinary guarded
  edit with a new, unsealed working ID, not an empty-board reset or auto-seal.
  Wait for sending edits; stale working/latest-seal state rejects instead of
  discarding newer work.
- **Fit diagram** centers and zooms to all active content, including text and
  ink, with padding. Selection does not restrict its scope. It changes no
  content, version or seal. Excalidraw's native Shift+1 is also available.

Do not invoke reset/fit as agent CLI methods: no such methods are added.
Both affect only the human's selected topic. **Topic** switches pages without
discarding their acknowledged working drafts or seals. **New topic** creates an
empty named page, without switching the current drawing; select it when ready.
Switch/create is held while a text/shape interaction is active, edits are sending
or local edits are conflicted. Finish or explicitly recover the current work
first; no queued delta or native undo history is carried into another page.

## Use in conversation

For a new board, start from its fresh empty sealed baseline; for a continuing
discussion, verify/reuse the existing board/topic and read the relevant handoff.
Draw or refine the needed native visual using the API, then seal its returned
working ID when there is a meaningful visual handoff to the user.
After the user changes and seals it, read that exact seal with `compareTo` your
previous seal, optionally requesting a matching image. Explain the factual
changes in ordinary conversation and preserve them when refining.
The version pair belongs to one topic; use another page for another discussion,
not a cross-topic comparison or merged drawing.

Do not require every conversation turn to use/seal the board. No OCR,
intent engine, agent-specific backend or source-artifact management is implied.
Raster/HTML/embed objects are outside this first native-only prototype, not
screenshots masquerading as editable drawings. Physical pen/touch and actual
Claude Code/Codex sessions remain unqualified.

The Excalidraw library catalog was suggested for later. Do not download or
integrate library packs as part of this prototype.
