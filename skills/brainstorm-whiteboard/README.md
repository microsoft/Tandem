# Brainstorm whiteboard: memory-only prototype

A standalone brainstorming whiteboard that **both the agent and the human can
edit, annotate and seal as peers**. Either can build on the other's work; it is
not just an agent-generated picture for the user to view.

It also gives the human a visual input channel when an idea is hard to type:
sketch it, move or connect items, or annotate a concern. The agent reads the
sealed drawing and changes, explains its interpretation in chat and refines it
with the user. Self-contained chat is the agent's responsibility, not a demand
that users rewrite their sketches in prose.

Use it proactively when a visual would help.
It is **additional to Tandem**, not its replacement. There is one standalone
service with named RAM topic pages and
three participant-neutral content operations: **read, edit, seal**.
A read-only **snapshot** convenience captures a whole sealed diagram as PNG.

## Agent authoring without implementation archaeology

The [API/native element reference](references/api-and-elements.md) covers the
actual validated fields, required values/defaults, bindings, requests/responses,
versions and failures. The [editing cookbook](references/editing-cookbook.md)
provides executable native recipes and deterministic operation helpers for
flow edits, move/resize, insertion/rewire, explicit deletion, rough UX and a
subsequent refinement. Load it on demand, not as a required visual workflow.
Native shapes/text are the foundation; Mermaid is not a general UX solution.

## Powered by Excalidraw

`@excalidraw/excalidraw` provides the native editing and rendering engine:
shapes, text, bound labels/connectors and freehand drawing. The API exchanges a
validated subset of native Excalidraw elements, with stable IDs for editing and
comparison. PNGs are rendered from those elements with Excalidraw.

The local Node service adds topics, volatile working state, immutable seals,
diffs and the API; those are not built-in Excalidraw handoff features. The skill
does not require the hosted excalidraw.com application or an Excalidraw account.
Use the payload subset documented here rather than arbitrary upstream scene
fields. The pinned editor version is recorded in `package.json`.

The editor is [Excalidraw](https://github.com/excalidraw/excalidraw), distributed
under its [MIT license](https://github.com/excalidraw/excalidraw/blob/master/LICENSE).
This standalone skill is [MIT-licensed](LICENSE.txt); retain that notice when
copying the folder independently.
Installed dependencies and bundled font assets retain their own licenses.
Build scripts copy local font assets from the pinned package; no external
library packs or hosted Excalidraw account are needed.

## Proactive visuals alongside chat

Read [SKILL.md](SKILL.md) for activation guidance and five when/how examples.
Use the board naturally when relationships, architecture, branching paths,
alternatives or spatial layouts would be clearer visually. Do not wait for
chat to fail, an explicit drawing request or a guaranteed need for human edits.
An editable sketch can help an explanation now and support joint refinement
later. Honor explicit board requests, and keep ordinary prose, tables and inline
diagrams available when they fit better. The board is optional, not discouraged.

**Optional means chat stands on its own.** A reader must be able to understand
the explanation, decisions and relevant changes without opening the board or
depending on its continued existence. Visuals may be used proactively, but
essential meaning must not live exclusively in shapes, arrows or annotations.
Describe relationships and layout choices in text; do not make "see the board"
the answer. This does not require repeating every coordinate or drawing detail.

Briefly explain the visual's purpose before opening it; keep explanations,
questions and decisions in chat, and return there when the visual is no longer
useful; do not ask for extra permission merely to choose a helpful visual.
Normal host permissions still apply. The examples are proposed illustrations,
not accepted project scope.
An added box called "new" remains unresolved until the user explains it; a
mechanical diff does not authorize an inferred label or intent.

Reuse a known URL only after `health` verifies the same service/instance, then
read the relevant sealed state. Do not relaunch/reseed on every conversation
turn. A stopped RAM instance loses its versions; an old URL/export is not a
restored session. Without host browser/image tools, give the real URL and state
what cannot be inspected. Do not claim successful rendering from JSON alone.

## Run without the full framework

From this directory, with Node 24.15+ or Node 26+ and npm:

```powershell
npm ci
npm run build
node scripts\whiteboard.mjs serve
```

Open the printed `http://127.0.0.1:<port>/` in any normal modern browser; keep the
command running. `--port 0` (default) lets the OS allocate a free loopback port.
A chosen occupied `--port` fails instead of adopting another process.
For a long-lived agent-hosted preview use that host's supported detached-service
mechanism, not a workspace/session registry. Ctrl+C stops the owned foreground
service. No root package, Copilot account/SDK, MCP integration or global agent
installation is needed. Initial npm setup requires registry access.

The service prints `{ service, instanceId, url, pid, memoryOnly: true }`.
`node scripts\whiteboard.mjs health --url <url>` verifies its service identity;
the helper rejects another kind of local viewer. There is no port scanning or
persisted connection record.

## Named discussion topics

Use separate pages for distinct discussions, for example Architecture and
Retry policy, without creating another whiteboard service or source attachment.
Each page owns its working drawing, immutable seals, latest/pending state and
comparisons. Element IDs may repeat on different pages because their state is
never implicitly composed or routed by a global human selection.

The human **Topic** selector displays one page at a time; switching preserves
acknowledged unsealed content and sealed snapshots in RAM. **New topic** asks for
a name and creates an empty page without switching the current drawing.
Switch/create waits for active editing/sending to finish and stays disabled for
conflicted local work. Download/recover it before changing pages. Native undo
history is cleared at the UI boundary so an undo cannot inject another page.

Topic management is tooling, not a workflow:

| HTTP | Request / response |
| --- | --- |
| `GET /topics` | `{ defaultTopicId, topics: [{ topicId, name }] }` |
| `POST /topics` | `{ "name": "Retry policy" }` -> `{ topicId, name }` |

Use the same `x-whiteboard-instance` header as content requests. Names are trimmed,
nonempty and at most 80 characters; IDs, not names, identify pages. This prototype
has list/create only, not rename/delete/archive/merge or persistence.

```powershell
node scripts\whiteboard.mjs topics --url "<printed-url>"
node scripts\whiteboard.mjs create-topic --url "<printed-url>" --json '{"name":"Retry policy"}'
node scripts\whiteboard.mjs read --url "<printed-url>" --topic "<returned-topicId>"
```

Send `topicId` in every content JSON request, or use CLI `--topic`. Store it with
handoff `versionId`s. Every reply/working stream/captured image identifies its
topic. A delayed request for A always targets A, even if the human selects B.
`latest`, exact seals and `compareTo` resolve within the addressed page;
cross-topic version lookup/comparison fails.

Compatibility only: omitting `topicId` always addresses the fixed original
`default` topic, named Main. It **never** follows the human selector. The default
ID is also reported by health/list tooling. The normal named-topic workflow
uses explicit IDs. No topic is automatically created just because chat changed
subject; use pages when useful and keep chat self-contained.

**All scene state is RAM only. Restart loses working content and every seal.**
For each topic the service retains only current working content plus explicit
sealed snapshots, not the trajectory of unsealed edits. Native UI undo is ordinary ephemeral editor
state. No `.tandem`, scene autosave, draft archive, source backup, localStorage or
IndexedDB document store is implemented. Requested downloads and proof evidence
are explicit exports and are never automatically restored.

## Core HTTP interface

These operations and `snapshot` accept `POST` JSON with `Content-Type: application/json` and
`x-whiteboard-instance: <instanceId from health>`. `/health` is startup tooling.
The browser uses the same edit/seal methods and preconditions as any JSON caller;
there is no actor/role argument or privileged sealing path.

### read

```json
{
  "topicId": "<topic-id>",
  "target": "latest",
  "compareTo": "<exact-sealed-versionId>",
  "includeImage": true
}
```

`target` defaults to `"latest"` = most recent sealed snapshot. `compareTo` is
optional and must be an exact sealed ID, not `"latest"`. Missing/unsealed targets
or comparison baselines fail, never silently fall back.

Response: `{ topicId, topicName, versionId, sealed: true, scene, hasUnsealedChanges, changes?, image? }`.
`scene` includes native elements, white background and `files: {}` for this
native-only prototype. When newer working edits exist, a latest read still
returns the prior seal and `hasUnsealedChanges: true`. The flag is sampled at
read capture and describes pending work beyond the latest seal, not whether an
explicit old target is older than another seal.

`changes` describes **compareTo -> target**:

```json
{
  "added": [{ "id": "<native-id>", "type": "freedraw" }],
  "removed": [],
  "changed": [
    { "id": "label-2", "fields": [{ "path": "text", "before": "Discuss", "after": "Review together" }] }
  ]
}
```

Added/removed entries contain full native objects (abbreviated above).
Changed fields are mechanical facts, not intent or human/agent attribution.
Text, geometry, style, binding references, pressure/points and visible order
are retained; camera/selection and native version/index/update bookkeeping
are not content. Layer movement uses factual `zOrder`, not raw index noise.

An image is `{ topicId, versionId, dataURL, width, height }`. Native PNG rendering captures
that immutable target before asynchronous work; later edits cannot change which
scene it renders. On Windows this uses installed Edge; elsewhere prepare
Playwright Chromium (`npx playwright install chromium`) or set
`WHITEBOARD_BROWSER_CHANNEL` to an installed supported channel. If rendering is
unavailable, `includeImage` fails explicitly with 503; no screenshot of a newer
draft is substituted. Ordinary native reads remain usable.

### edit

```json
{
  "topicId": "<topic-id>",
  "expectedVersionId": "<current-working-versionId>",
  "operations": [
    { "op": "add", "element": { "id": "note", "type": "text", "x": 80, "y": 350, "width": 220, "height": 23, "text": "A standalone annotation" } },
    { "op": "update", "id": "label-2", "set": { "text": "Review together" } },
    { "op": "remove", "id": "old-annotation" }
  ]
}
```

This illustrates all operation kinds; IDs must actually exist for updates/
removals and all references must be valid in the **complete final batch**.
A failed operation/relationship rejects the entire attempted batch.
`id` and `type` are not mutable update fields. Native add/update payloads use the
documented supported fields in the [agent reference](references/api-and-elements.md);
arbitrary properties fail.
Required add geometry is `id`, supported `type`, finite `x/y/width/height`.
Native defaults are filled explicitly. Native text/line/arrow/freehand-specific
fields are validated; assets/embeds are rejected. Text updates also update
`originalText` unless explicitly provided.

Optional `position` on add/update gives a zero-based array/layer position.
There is no full-scene replacement operation. A valid no-op returns the same
working ID. A content change returns a new opaque `versionId`, current scene and
factual `effects`; the same stable native IDs survive edits and seals.
Stale preconditions return 409 without applying the attempted batch.

The edit request may also specify `expectedLatestSealedVersionId`. The reset UI
uses this atomic precondition in addition to the working ID so a peer sealing
the same working state cannot silently change the intended restoration target.
A mismatch returns 409. This is a guard within edit, not a reset API or new ID
scheme. An older backend that lacks it must be updated before using the reset UI;
frontend-only compatibility is not sufficient.

**Normal diagram labels must belong to their shapes**, not just happen to be
drawn on top:

```json
{
  "shape": { "id": "node-2", "boundElements": [{ "id": "label-2", "type": "text" }, { "id": "arrow-1", "type": "arrow" }] },
  "label": { "id": "label-2", "type": "text", "containerId": "node-2" },
  "connector": { "id": "arrow-1", "type": "arrow", "endBinding": { "elementId": "node-2", "focus": 0, "gap": 8 } }
}
```

These are relationship excerpts, not complete add payloads. Complete reciprocal
text and start/end arrow bindings are declared by `scripts/example.mjs`.
Grouping or geographic proximity is not an association. Standalone annotations
may intentionally remain unbound. Native UI moves/resizes carry associated
labels and connectors; raw API geometry batches must include intended native
child/connector geometry changes, not rely on an intent/layout inference engine.

### seal

```json
{ "topicId": "<topic-id>", "expectedVersionId": "<working-id returned by edit>" }
```

Returns `{ topicId, topicName, versionId: "<same-id>", sealed: true, hasUnsealedChanges: false }`.
The complete logical scene is copied immutably under that same ID. Re-sealing
unchanged state can return the same seal. The board remains editable.
This is neither approval nor file saving, a lock, an automatic notification,
an agent invocation or a turn transfer.

An empty sealed baseline exists for each newly created topic, so its first `read` is safe.
Old unsealed IDs are not retained; exact unavailable/unsealed reads return 404.

### snapshot

`POST /snapshot` accepts `{ "topicId": "<topic-id>" }` with optional
`"target": "latest"` or an exact sealed `versionId`. No live/unsealed target, selection, crop or viewport
parameter is supported. It is a thin wrapper over the same captured-seal PNG
renderer used by `read(includeImage)`, which remains unchanged.

The response is:

```json
{
  "topicId": "<topic-id>",
  "topicName": "<topic-name>",
  "versionId": "<resolved-sealed-id>",
  "sealed": true,
  "hasUnsealedChanges": false,
  "image": { "topicId": "<same-topic>", "versionId": "<same-id>", "dataURL": "data:image/png;base64,...", "width": 900, "height": 400 }
}
```

The dimensions above are illustrative. The PNG includes the addressed topic's
whole native diagram, including offscreen/unselected elements and ink, not
other pages or editor chrome. A topic switch cannot retarget a captured image.
It fits within a 4096-pixel longest side and uses the same native-only/browser
prerequisites and explicit rendering errors as `read(includeImage)`.

Latest resolves once before rendering. If newer drafts exist, snapshot still
returns the prior seal's image and `hasUnsealedChanges: true` sampled at capture.
A later seal during rendering does not retarget that response. Missing/unsealed
IDs fail explicitly with 404, never fall back. Snapshot neither edits nor seals
the working board. Exact prior-seal images remain repeatable.

## CLI and example authoring

```powershell
node scripts\whiteboard.mjs read --url "<printed-url>" --topic "<topicId>"
node scripts\whiteboard.mjs edit --url "<printed-url>" --topic "<topicId>" --input edit.json
node scripts\whiteboard.mjs seal --url "<printed-url>" --topic "<topicId>" --input seal.json
node scripts\whiteboard.mjs snapshot --url "<printed-url>" --topic "<topicId>"
node scripts\whiteboard.mjs snapshot --url "<printed-url>" --topic "<topicId>" --json '{"target":"<exact-sealed-id>"}'
```

`--json '<JSON>'` is another input option. `--topic` must agree with any `topicId`
already in that JSON; contradictory values fail. Always use actual returned IDs; never
blindly replace a stale precondition. The normal bound-flow recipe is:

```powershell
node scripts\example.mjs --url "<printed-url>" --topic "<topicId>"
```

It adds/seals a native flow only on a fresh empty topic and refuses to replace
existing/unsealed work. `flowElements()` declares shape-associated text and
connector endpoints, preserving stable IDs. It does not guess associations.

Text placed over a box and arrows without endpoint bindings remain independent
objects. Use declared native relationships when labels/connectors should follow
node movement. Do not repair or reinterpret a peer's existing sealed drawing
without an explicit edit and a new handoff.

## UI synchronization and limits

The compact native editor has a Topic selector/New topic control and human
**Reset to latest sealed**, **Fit diagram** and **Seal version** controls, not a
workflow side panel.

Reset reads the selected topic's latest immutable seal and restores that content using a
version-guarded atomic edit. It asks for confirmation before discarding unsealed
changes; Cancel leaves content/version/view alone. Sending edits must finish
first; conflicted local edits must be explicitly recovered. A changed reset gets
a new working version and remains unsealed relative to the restored seal.
Identical working content is a no-op. No seals are deleted, rewritten or minted
by reset. Content or latest-seal changes during confirmation/submission reject
stale inspection; the UI does not blindly refresh a precondition. Local changes
that arrive during submission remain recoverable rather than being overwritten.

Fit uses Excalidraw's native pan/zoom API over **all** of the selected topic's active shapes, text and
ink, independent of selection, with padding for the native toolbar/properties
areas. It preserves content, version IDs, seals and selection. Empty boards
receive a harmless message. Shift+1 remains the native fit shortcut; fitting
uses the native editor's zoom limits. Header controls wrap on narrow screens.
Reset/Fit are human UI conveniences only; no reset/fit endpoint or CLI command
is introduced and they are not agent workflow steps. Agent access uses
read/edit/seal and the read-only snapshot convenience, without role-based
authorization or scheduling.

SSE delivers only the selected topic's current working display state; it is transport for all peers, not
`read("latest")` returning a draft. Content operations remain the same three.
The UI submits atomic native deltas with explicit captured topic identity and
the working version it inspected. New stream subscriptions reject queued state
from an old topic; switching is held while a request or unsent/conflicted edit
could otherwise be lost.
When an edit loses a race, local unsent work stays visible in the tab. Explicit
download/reload controls allow recovery instead of silently adopting new IDs.
Sealing waits for that tab's acknowledged edits and rejects stale inspection.

Supported now: native rectangles/diamonds/ellipses, text, lines/arrows, frames
and ink. No imported raster/SVG/HTML embeds, source files, dynamic attachments,
workspace ownership, CRDT collaboration or persistent scene store. Requests are
limited to 2 MiB, scenes to 3000 elements and a stroke to 30000 points.
PNGs fit within 4096 pixels on their longest side. Seals remain in RAM without
automatic eviction until the service stops; this is not a production retention
or memory-budget policy.

The LLM interprets changes; no semantic intent engine is implemented.
https://libraries.excalidraw.com/ is deferred; no library packs are included or
downloaded. Physical pen/touch and real Claude Code/Codex runtime use are untested.
The prototype has an npm/browser setup and does not claim zero setup.
Named pages do not add persistence, source attachments, topic deletion/rename,
branch/merge or simultaneous editing guarantees. Switching is not a seal or
approval. Production topic/scene memory budgets and retention remain undecided.

## Focused qualification

```powershell
npm run check
npm test
npm run build -- --outDir dist-test
node scripts\prove.mjs --out "<explicit-evidence-directory>"
```

`prove` **always** creates an isolated temporary RAM service; it cannot accept a
public review URL. It closes the service and owned browsers in `finally`.
It reaches the real native text editor, edits/moves/resizes a bound node, draws
ink, checks the pre-seal V1 pending read, seals V2 through the UI, checks factual
changes/immutable V1/matching PNG pixels, rejects stale/invalid atomic batches,
checks camera/selection noise, and forces a peer race to verify local preservation.
No live model or paid/native agent journey is run.

A separate clean-start smoke check exercises the documented CLI in a fresh
temporary service: startup URL/health, empty sealed read, a bound native diagram
edit/seal, exact sealed read with baseline diff and matching PNG. It uses existing
installed dependencies and separate qualified assets, then stops its owned
service/browser processes. This is command/browser smoke evidence, **not** a
clean LLM-agent session, skill-discovery evaluation or Claude Code/Codex
qualification. Activation examples are guidance, not a brittle prose test.

The focused Reset/Fit checks use separate assets and a temporary RAM service:

```powershell
npm run build -- --outDir dist-controls
node scripts\prove-controls.mjs --out "<explicit-evidence-directory>"
node scripts\prove-snapshot.mjs --out "<explicit-evidence-directory>"
```

They exercise fresh/last-seal restoration, no-op/cancel, canonical content and
immutable seals, working/latest-seal races, pending native edits, actual
whole-diagram fit including distant text/ink despite selection, unchanged
content/version and a narrow header. All owned test browsers/services close
afterward; no held review or installed copy is exercised.
Snapshot checks additionally cover actual API/CLI default/exact targets,
captured-once behavior during a newer seal, pending flags, missing/unsealed
errors, all-diagram PNG pixels independent of selection/viewport, no mutation
and compatibility with `read(includeImage)`.

The bounded topic proof uses separate assets and two named pages plus Main:

```powershell
npm run build -- --outDir dist-topics
node scripts\prove-topics.mjs --out "<explicit-evidence-directory>"
```

It exercises UI/CLI create/list, explicit and fixed-default routing, identical
native IDs in independent drawings, separate pending/seals/diffs/PNG captures,
draft-preserving round-trip switches, stale/cross-topic rejection, selected-page
Reset/Fit, in-flight topic identity and conflicted-local preservation. It starts
no persistent review server and closes its owned temporary service/browsers.

The authoring reference/cookbook proof runs the real emitted request payloads
through isolated store/API topics and exercises a native UX sketch in Edge:

```powershell
npm run build -- --outDir dist-authoring
node scripts\prove-authoring.mjs --out "<explicit-evidence-directory>"
```

It checks create/connect/insert/rewire/rename/move/resize/delete bindings,
unchanged unrelated metadata/ink/groups/frame membership, unsupported-helper
failures, stable IDs/diffs/seals, actual bound UX text editing and a human button
move, then an agent refinement that preserves the human's name/ink and
unexplained `new` box. The PNG is Excalidraw rendering of native objects, not a
website screenshot. The helper is stopped after the proof; no held review or
installed skill is contacted. This is local command/browser evidence, not a
clean LLM-agent session or runtime-portability qualification.

Explicit evidence files are test exports, not a persistence implementation.
During review the public service/bundle can be held unchanged while private
`dist-test` and temporary servers qualify newer source; do not redeploy/restart a
held RAM board without acknowledging that its working/sealed versions would be lost.

For an explicitly requested fresh development preview while holding another
review instance, build to a different directory and serve that directory:

```powershell
npm run build -- --outDir dist-review
node scripts\whiteboard.mjs serve --assets dist-review
```

This is startup tooling, not a product session/workspace management feature.
It creates a separate empty RAM board with new version IDs; it does not migrate,
repair or alter an already running board or its sealed versions.
