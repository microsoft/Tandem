# Bounded portable Design artifacts

## Pasted composer images

The Living Canvas composer accepts a single pasted PNG or JPEG, with or without
accompanying text. Ordinary text paste is unchanged. The preview is removable;
remove the existing image or diagram snapshot before adding another. JPEG's
`image/jpg` clipboard alias is normalized to `image/jpeg`, without re-encoding
the original bytes. Other formats, including SVG, GIF and WebP, fail explicitly.

Images are validated and stored locally before the preview becomes ready:
at most 4 MiB, 4 million pixels and 4096 pixels per edge, further limited by the
actual selected model's declared MIME/size capability. PNG uses the existing
structural/decompression checks, including bounded Adam7 passes for general
images; pinned, locally bundled jpeg-js 0.4.4 decodes
JPEG with bounded resolution and memory. No remote resources are fetched.

General images use `image-attachment/v1` with a content hash, MIME, dimensions
and byte length, stored under `.tandem/living-canvas/image-attachments`.
They have no invented artifact, revision or viewport identity. Accepted request
refs survive reload and reconstruct Conversation images; retries retain the
same request envelope. Applicable controlled role sends carry the verified
original bytes as SDK image blobs. Unsent previews are local browser drafts.
The SDK may retain a blob as a `sha256:` asset reference plus decoded byte
length instead of inline base64. Native history checks accept that exact
byte-derived representation, including hydration on reopen, without relaxing
the original message, transformed content, identity, metadata or ancestry checks.
Resumed cycle roles also receive that cycle's original general image, not
images belonging to unrelated historical work; distinct competing images
still fail the one-image dispatch bound explicitly.
Source-bound diagram annotations retain their separate storage, source checks
and stale-Design rejection. General image-only input does not authorize any
different workflow or bypass Router interpretation.

## Purpose navigation

Optional `artifact/v1` and document `artifact/v2` category metadata is `user-story`
(User story: goal, ordered user actions/system responses, outcomes and relevant
failure/retry paths), `ui` (UI: screen layouts, controls and interactions),
`workflows` (Workflows: process/state/sequence including
users, UI and services), `contracts-data` (Contracts & Data), or `system`
(System: architecture/stack/deployment). The Designer explicitly assigns purpose
for newly authored/revised artifacts independently of format. HTML and SVG can
share UI or User story; HTML and Mermaid can share Workflows. A storyboard with
screen thumbnails remains User story, not also UI just because it depicts screens.
UI-free projects do not require UI artifacts. Checkout interaction
sequences remain a valid Mermaid choice. Category is independent of all visual and document formats.

Only nonempty categories appear above exact artifact titles. Native buttons
support Tab/Enter and visible focus, with horizontally scrollable rows on narrow
panels. Each category remembers its selected artifact within the current revision;
references reveal their target category. Switching uses the same artifact
selection and scroll bookmarks, without resetting annotation drafts or bindings.

This is additive optional metadata, not a version migration. Absent category
stays absent; existing field order, source, canonical validation output and
digests remain unchanged. Unchanged artifacts are not rewritten. Existing v3
artifacts with missing category and old shared sketches remain readable and display
in neutral Ungrouped. The retained `experience` category is still accepted exactly,
but also displays in Ungrouped with a short explanation: it never distinguished
journeys from screens. No title/source guessing or automatic persisted rewrite
is performed. New/revised authoring uses the explicit current categories.
Only explicit authored category changes require a new revision/digest.

## Formats

New authoring uses `sketch-design/v3`. Each new **visual** artifact has
`schemaVersion: "artifact/v1"`, an explicit `format` (`mermaid`, `html`, or
`svg`), stable `id`, `title`, portable `source`, and bounded `width`/`height`
in CSS pixels. `description` is optional plain text.

### Document/data branch

`artifact/v2` is a bounded document-only branch of the same design union, not a
visual migration. Its exact fields are `schemaVersion`, `format`, `id`, `title`,
`source`, optional `description` and optional `category`. Markdown additionally permits
`noteForArtifactId`, an exact artifact ID of any supported format in the same
Design revision, and retains legacy `visualCompanionId` reads targeting visual
artifact/v1. Only Markdown can carry either association. Targets must exist;
self-references, note cycles and conflicting associations are rejected.
Supporting notes remain source-authoritative artifacts with their own stable
IDs and references, but appear through optional Notes buttons on their primary
artifact rather than top-level tabs. Back navigation restores the primary
artifact's retained view; annotation source/revision/digest never changes merely
because a note is opened. Notes are optional to author and read, must be brief,
and cannot replace essential behavior and decisions in the primary artifact.
Formats are `markdown`,
`json-schema`, and `openapi`. Width/height are forbidden: normal selectable text
reflows vertically, with horizontal scrolling contained inside wide table/code
wrappers. No screen-fit scaling, zoom/pan toolbar, Annotate, or PNG capture is
available. Shared viewer candidates, controller entry points, source binding
validation and capture enforce this distinction; visiting documents preserves
visual drafts, pinned crops and revision bindings. References are artifact-level
only, with exact original source, artifact ID, revision and digest retained.
Historical visual source, including HTML tables, is never automatically migrated.

Document-only CSS integration hooks are `--artifact-document-font-size` (16px
fallback), `--artifact-document-font-family` (inherited), `--artifact-document-color`
(shell `--text`, otherwise inherited), `--artifact-document-background`
(transparent), and `--artifact-document-border` (shell `--border`, otherwise #888).
These inherited custom properties affect only the document renderer, not authored
visual geometry, colors, scaling or capture. No preference persistence or startup
behavior is implemented here.

Content-specific authoring defaults favor reviewable visuals:

| Content | Recommended artifact |
| --- | --- |
| User story | HTML storyboard for user-visible screen/step journeys; Mermaid sequence interaction timeline when actor exchanges and their order are central. Show actions, responses/outcomes and relevant failure/retry |
| UI | HTML mockup: actual screen layouts and interaction states, not boxes describing screens |
| Workflows | Mermaid flowchart/state/sequence for steps, lifecycle or interactions |
| Behavioral contracts/rules | Mermaid sequence for exchanges; HTML decision tables for conditions/rules/outcomes |
| Data contracts | Mermaid ER/class diagrams for entities, fields and relationships; JSON Schema/OpenAPI when precise machine/API specs are needed |
| System | Mermaid grouped architecture with meaningful boundaries/layers/components/dependencies, not generic chains of boxes |
| Supporting notes | Markdown: brief, optional and secondary, not the recommended primary artifact |

These are recommendations, not mandatory formats, all seven artifacts, counts
or new validation gates. SVG remains valid for precise custom visuals, and
HTML/SVG alternatives are allowed where clearer. Do not invent HTTP APIs or
persistence to use a format. Select relevant complementary views without
unnecessary duplication. The primary artifact must stand on its own; essential
approval decisions cannot be hidden in notes.

For newly authored or revised visuals, **make the visual carry the information**,
including in HTML. Show relationships with named connectors, cardinality and typed
fields; interactions with lifelines/messages or ordered action-response states;
rules with compact decision tables; UI with actual layouts/states; and systems
with boundaries and dependencies. Use short meaningful labels/captions and only
essential callouts, not paragraph grids, repeated introductions, list-heavy
specifications or decorative cards that still require reading paragraphs.
For example, connect Order to LineItem with cardinality and typed fields rather
than explaining the relationship in two text cards.

Keep necessary constraints, invariants, errors, decisions, failure paths and
evidence visible. Do not achieve brevity through arbitrary word caps, tiny fonts,
clipping or hiding essential detail. Recompose instead. Brief deeper rationale
can use existing optional notes/details; the primary artifact stays self-contained.
This authoring guidance does not automatically rewrite saved artifacts.

Existing Markdown contracts remain accepted and unchanged; no mandatory
companion is introduced. They retain portable source behind a source disclosure; an
explicit visual-companion button selects the Designer-authored visual artifact.
That visual owns its own annotation/capture identity, not the Markdown identity.
No association is inferred from titles, text, outcomes or other revisions.
JSON Schema uses typed field hierarchies, requiredness and declared constraints;
OpenAPI uses request-to-operation-to-response branches with expandable schemas.
These are derived review views, not a replacement source or an API console.

- **Markdown:** pinned local Marked 15.0.12 GFM lexer, rendered solely with DOM
  element creation and text nodes (never untrusted `innerHTML`). Headings,
  paragraphs, emphasis, lists, blockquotes, rules, tables and fenced code are
  supported. Raw HTML is shown literally; image syntax shows alt text, and links
  show inert labels without navigation. Entities remain literal. No images,
  fetches, generated heading anchors, section comments, editor or executable code.
- **JSON Schema:** strict JSON object with explicit
  `$schema: "https://json-schema.org/draft/2020-12/schema"`. The official 2020-12
  meta-schema is precompiled at build time using pinned Ajv 8.17.1. Admission
  validates schema **metadata**, not instance payloads, reference correctness,
  format assertions or custom vocabulary semantics. There is no runtime schema
  compilation or general-purpose engine exposed to authored content.
  Nested `$schema` strings must also name 2020-12; other dialect declarations
  are conservatively rejected even inside opaque annotation/default data.
- **OpenAPI:** strict JSON, versions `3.1.0` or `3.1.1` only, with explicit
  `jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema"`.
  This is **structural presentation-subset validation**, not full OpenAPI
  semantic validation. Required: `openapi`, `info.title`, `info.version`, `paths`.
  Info also permits summary/description. Path items support `$ref`,
  summary/description, parameters and standard HTTP operation names. Operations
  support summary/description/operationId/tags/parameters/requestBody/responses.
  Responses are required nonempty maps of status codes/ranges or `default`, with
  description and optional content (or a reference object).
  Parameters support name/in/description/required/schema; request bodies support
  description/required/content; media entries support only schema.
  `components.schemas` is supported. Embedded schemas are meta-validated.
  Reference objects have `$ref` plus optional summary/description.
  Other structural fields (including servers, security, examples, callbacks and
  webhooks) are rejected rather than silently claimed validated. This does not
  establish operation-ID uniqueness, path-parameter correspondence, or ref target
  validity. No API console, code generation, resolver or new workflow is included.

Local JSON-pointer links can navigate declared definitions; they do not expand,
validate or execute referenced schemas. Remote and missing targets remain inert;
none are fetched or resolved. JSON prototype keys (`__proto__`, `prototype`,
`constructor`), nonfinite numbers, more than 12,000 values/tokens or depth 40 are
rejected. Source remains capped at 100,000 characters. No schema payload is run.
Vendors and license notices ship locally in the relocatable renderer graph;
`npm --prefix tandem run build:artifacts` reproducibly bundles the pinned
lexer and precompiled validators without CDN or runtime dependency installation.

The Designer first chooses the minimal complementary views needed to explain
the user's system, then chooses a format independently for each view:

| Purpose | Typical format |
| --- | --- |
| User-facing journeys and interaction steps | Static HTML/CSS storyboard; Mermaid sequence timeline when actor exchanges/order are central |
| Relationships, workflows, states, user/UI/service message sequences | Supported Mermaid syntax |
| UX screens and wireframes | Static HTML and CSS |
| Data/API contracts with actual fields, types, constraints and errors | Mermaid ER/class; precise JSON Schema/OpenAPI when needed; HTML/SVG where clearer |
| Context, components, responsibilities and integrations | Mermaid flowchart or SVG |
| Precise spatial or geometric composition | SVG |

This is not a required set of tabs or a separate schema for each purpose.
Do not invent architecture or technology choices merely to fill a view.
Unresolved choices continue through the existing question mechanism.

A product-journey storyboard shows meaningful screens or steps with the user
action, system response and next state/outcome, including a key error/retry
path when relevant. It is a static mockup, not executable interaction. Do not
duplicate it with a workflow diagram unless that adds distinct useful detail.
Prefer compact groups, concise labels, a restrained consistent palette and
clear hierarchy rather than sprawling chains or empty space.
Sequence diagrams remain a strong choice when who talks to whom, message
order, responses and failure paths matter. They are not limited to backend
internals: a checkout contract can show Customer, Checkout UI, Order service
and Payment provider, with accepted/declined alternatives and retained-bag
retry. Choose by the information to communicate, not a blanket format rule.

## Authority and compatibility

Source is authoritative. Browser layout, SVG generated by Mermaid, PNGs and
DOM IDs are derived output, not a replacement for the source. Revisions and
their digests cover the exact artifact source. No defaults or converted
geometry are persisted during reads.

Existing `sketch-design/v1` and `sketch-design/v2` collections retain exact
read support. V3 collections may retain unchanged `sketch/v1` and `sketch/v2`
artifacts alongside new formats. Replacing an old artifact is an explicit
Designer revision, not automatic migration.

Designer question answers clarify the producing question, including its options
and implications; they are not fresh permission to implement the whole Design.
A distinct ordinary implementation request is required. Live result and task
admission enforce this boundary even if the Router misinterprets an answer.
Source-bound answers may still resume or replan an existing implementation
cycle. Historical ledger replay retains its original facts; it does not
authorize new planning or implementation from an old misrouted Designer answer.

References remain `artifact-id` or `artifact-id#element-id`. HTML/SVG element
references come from validated IDs in the source. Mermaid currently exposes
artifact-level references only; generated DOM identifiers are never semantic
references. A geometric arrow does not establish a domain relationship.

## Rendering and capture boundaries

Model-generated content is static, not an application. Format validators
reject unsupported input explicitly. Rendering dependencies are pinned and
packaged locally; the direction demo's public CDN is not used in production.
HTML/SVG use isolated, script-disabled rendering. Scripts, event handlers,
external resources, navigation, animation and arbitrary execution are not
supported. The format contract exports the exact supported syntax and bounds
used by admission and generation.

The packaged versions are Mermaid 11.12.0, parse5 7.3.0 and css-tree 3.1.0;
esbuild 0.25.10 rebuilds the checked-in browser bundles with
`npm --prefix tandem run build:artifacts`. Licenses travel in
`public/artifacts/vendor/LICENSES.json`. The deployed package needs no npm
installation.

Mermaid's renderer-owned base theme uses system UI typography and a restrained
green/blue palette, with compact flowchart and sequence spacing matching the
direction demo. ER relationship labels have a trusted, ER-only contrasting
background/text override using the same theme palette. Prompts guide content and composition; they do
not override renderer defaults or guarantee generated visual quality.

Mermaid permits passive `flowchart`/`graph` (including subgraphs), `sequenceDiagram`,
`stateDiagram-v2`, `erDiagram` and `classDiagram`, not arbitrary families such as C4.
ER supports fields, PK/FK/UK and relationship cardinalities; class diagrams support
members, interfaces, inheritance, composition and aggregation. Flowchart/graph and
class diagrams may use separate `classDef`/`style` lines containing only hexadecimal
`fill`, `stroke`, `color` and integer `stroke-width:1px` through `12px`.
Whole-line plain comments are allowed, but directives, frontmatter, URLs, links,
configuration, interaction and other CSS remain forbidden. These additions retain
strict local rendering, the SVG output guard and artifact-level source references.
HTML supports explicit
fragments, tables, Grid/Flex and responsive media rules; it excludes forms,
inputs, links, images and embedded SVG. SVG supports shapes, paths, text,
groups and local paints/clipping, without `foreignObject`, `use`, images or
scripts. CSS uses an explicit property/value grammar allowlist, without
resource URLs, custom properties, generated content or dynamic hover/focus.
Use `overflow:clip`, not `hidden`: hidden containers can scroll on focus and
would invalidate a static snapshot. Fixed/sticky positioning and authored
scrolling are unsupported.

Admission checks Mermaid's family, source bounds and passive-source
restrictions synchronously. Its full grammar and layout are checked by
Mermaid during browser rendering; a grammar/rendering failure displays an
error and exposes no capture surface. This is not a guarantee that every
admitted source will render successfully, nor evidence of general model
generation quality.

Fit is a whole-artifact overview, not a global font-readability stretch.
Zoom preserves uniform geometry, with scrolling for detail. Authored HTML
layout responds to its source viewport; viewer zoom does not rewrite the
source viewport or change responsive breakpoints.
The viewer also bounds its height by the measured outer pane and its own
caption/zoom controls. An explicit **Fit** click reveals the complete overview
within the owning scroll pane, including its title and controls. Initial render,
view restoration, capture preparation and ordinary zoom do not navigate that
outer pane; manual zoom retains inner scrolling for detail. This addresses
reachable content below surrounding headers, not lost source extent.

### Expanded artifact view

The Tandem artifact toolbar's **Expand** fills the current browser document
viewport in place. It does not open a popup, use browser Fullscreen, or escape
an enclosing Copilot iframe. The same artifact DOM and sandboxed frame stay
mounted; the surrounding Conversation and its draft are not replaced.

Visual source artifacts open in Fit with the normal 480px height ceiling removed
only in this view. Fit, zoom and 100% retain uniform source geometry. Close or
Escape restores the previous Fit/manual view, inner and outer scroll positions,
and the Expand button's focus. Fit recalculates if the browser was resized;
scroll offsets remain subject to the browser's current bounds. Legacy shared
sketches keep their existing readability-constrained Fit controls. Document
artifacts simply gain a larger reading area, not visual zoom or PNG capture.

Expansion is local, unpersisted presentation state: no request, model call,
workflow transition or reload. Other panels are temporarily inert. Close or
Escape returns to questions, native permission decisions, Stop and Settings
while ordinary updates continue underneath. The existing annotation dialog
opens above the expanded view and handles its own Escape first (Cancel annotation);
Return to design still retains the draft, and Attach still creates an unsent
source-bound PNG. Capture clips against the expanded area rather than the old
narrow pane. Raw source retains its existing capture prohibition.

| Existing path | Expanded-view behavior |
| --- | --- |
| Repeated open, Fit/zoom/scroll, Close or Escape | Restore the saved normal view; remove both parent/frame key listeners and temporary inert state. |
| Same-bound Design and Conversation updates | Keep the current artifact mounted and expanded. |
| Notes, artifact/reference selection, new revision | End expansion before replacing the renderer; never apply old view state to the new renderer. |
| Loading, render failure, invalid Design, removal | Disable Expand until ready; show existing errors; clear expansion before disposal. |
| Annotation dialog and View raw | Preserve existing local edits, draft/capture rules and source identity; inner modal Escape takes precedence. |
| Historical Conversation navigation | Return to the ordinary interface first; there is no new historical-Design selector. |
| Settings, page reload or runtime Close | Use the existing ordinary controls after exiting; expansion has no recovery state. |

Physical Edge fixture coverage lives in `human-loop-shell.test.mjs`: all three
visual formats at 1280x900, 390x700 and 390x400, normal/manual/Fit restoration,
keyboard boundaries and sandbox Escape, unchanged frame identity, resize,
annotation drawing/PNG pixels, note navigation, live updates, failures and
permission-picker/Stop reachability. These are local browser/fixture checks,
not a native model workflow or installation/recovery qualification.

### Snapshot capture and source geometry

For HTML whose visible layout extends beyond its nominal canvas, the viewer
resolves styles at the authored viewport first, then retains that static layout
in an expanded paint surface. Fit includes that complete positive overflow;
manual zoom scrolls it in the host viewport. Explicit source clipping is preserved.
The source, declared dimensions, references and revision digest are unchanged.
Derived surfaces exceeding 4096 CSS pixels on either edge fail visibly without a
capture surface; this does not change the stricter snapshot byte/pixel limits.
SVG viewBox clipping and Mermaid geometry are unaffected.

Artifact annotation is snapshot-first: navigate, zoom and scroll the live
artifact, then **Annotate** captures its current visible supported crop and
opens a static-image editor. The renderer prepares its current Fit layout before
capture; asynchronous rasterization verifies the original source and geometry
again before accepting the image. Raw source, document artifacts, failed
renderers and invisible surfaces cannot start or replace a visual capture.

The captured bitmap and its strokes use one fixed pixel coordinate system.
Resizing the editor scales both together; later live scrolling, zooming,
rerendering or Design changes never reposition marks or rebind their source.
**Return to design** retains the draft and composer attachment.
**Resume sketch** reopens an unfinished image rather than recapturing it.
**Cancel annotation** in the editor or beside **Resume sketch** discards only
that unfinished sketch, including one with no strokes, and restores **Annotate**.
Escape inside the annotation dialog uses the same cancellation path. Existing
composer text, attached PNGs and other artifact drafts are unchanged; no upload
or send is required. An in-flight canceled capture/export cannot restore the draft
or replace the composer snapshot.
**Clear strokes** clears only marks. **Capture new** requires explicit replacement
confirmation, and keeps the old draft if capture fails. Drafts are local to the
open renderer, not persisted across application reloads.

**Attach to composer** combines the original bitmap and strokes into a local PNG;
it never sends. Successful attachment finishes the annotation: the editor closes,
the completed editable bitmap/strokes are released, and **Annotate** starts a
new capture. Only after the composer accepts the new PNG is the old attachment
replaced and the completed draft cleared. Encoding or acceptance failure retains
the unfinished draft and prior composer image for retry; **Return to design**
also retains the draft. **Cancel annotation** explicitly discards it instead.
Removing the composer snapshot
does not restore a completed annotation or clear a separate unfinished one.
Artifact ID, original revision, Design digest, selection and crop
remain attached through upload and explicit Send. The existing limits remain
4 MiB, 4 million pixels and 4096 pixels per edge; errors retain both draft and
prior attachment. An editor whose source no longer matches the current Design
shows an explicit warning. The server still rejects a new annotation upload
from an earlier Design revision; capture a new current image explicitly rather
than relabeling an old bitmap. No workflow or upload guards are weakened.

Switching artifact tabs restores their retained ancestor scroll positions
within the same Design revision after rendering is ready. This prevents
temporary shorter content from losing the user's place. Existing captured
drafts remain independent of this live-view restoration.
Visual artifacts also retain their Fit/manual zoom mode and inner viewport
scroll offsets across document and category visits. The renderer restores this
view state after becoming ready, before the Host exposes capture geometry.
Fit still recalculates for the current live viewport, without changing a saved
annotation bitmap. The legacy five-perspective host retains its existing live
annotation controller; the shared-artifact Canvas uses the static editor.

Router, Designer, implementation, Review, Stop, permission, recovery and
publication ownership are unchanged. Packaging is a build operation only:
it does not install, reload or activate an extension.

## Canvas settings and message entry

Settings saves project-scoped System/Light/Dark theme and Normal/Larger/Largest
text preferences in the versioned HostStateFile preferences document, independent
of the loopback port. System retains Host theme colors. The slate/blue shell uses
separate workspace, panel, card and composer surfaces. Text sizing affects shell
readability and the document renderer's dedicated CSS hooks, never global zoom,
isolated HTML/SVG/Mermaid source colors or canonical diagram geometry.

The model selector controls the private Canvas SDK session, not the main chat.
Automatic startup is unchanged: the saved model is used for a genuine fresh
creation after authenticated discovery, without silent fallback. Reopening
preserves the exact private identity and history and checks actual `modelId`
against the preference instead of forcing a switch. Unsupported SDK discovery
disables the control; explicit unverified preferences block request admission.

A model change requires positive native idle proof and no request, task, queue,
Stop, closing, unsettled effects, open questions or unfinished cycle. It shares
request admission serialization and never queues a switch behind active work.
Pending intent is durable before the SDK switch; only matching authoritative
readback commits the preference. Unconfirmed changes block new messages until
the user retries their selection or explicitly accepts the actual model in the
same session. Appearance saves cannot overwrite that intent. Image capability
checks use the actual selected model at upload and request admission.

Only the chat textarea handles Enter as Send through the existing form submit
path. Shift+Enter inserts a newline; IME composition and held/repeated Enter do
not send duplicates. Attachment uploads, whitespace checks and exact-envelope
retry semantics remain in the existing submission handler.

## Active role duration

The current Human Loop has no total role/task execution deadline. Elapsed
and permission-wait time remain telemetry, not automatic cancellation or
evidence of failed execution. Manual Stop, genuine transport failures,
ownership checks and positive result/end proof remain authoritative.
Post-result settlement, acknowledgement/abort/RPC operations and explicitly
bounded commands retain their existing deadlines.

Stored `workflow-policy/v1` snapshots and digests are unchanged.
`attemptMaximumMs` and `reviewMaximumMs` remain compatibility fields used
by other existing paths; they do not impose a total Human Loop role lifetime.
In particular, command/setup bounds and the retired private-result wait path
are not changed by this active Human Loop correction. No infinity value,
larger replacement timeout, policy rewrite or new configuration knob is used.
