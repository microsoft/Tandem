# Agent reference: actual prototype API and native elements

This reference describes this skill's validator and local protocol, not the
entire Excalidraw API. Rendering/editing uses pinned Excalidraw 0.18.1.
Use [the executable cookbook](editing-cookbook.md) for ordinary authoring.
Native elements are the foundation for flows **and UX sketches**; no Mermaid,
HTML, SVG or image input is accepted by `edit`.

## Connection, topics and versions

Start with `node scripts\whiteboard.mjs serve`, keep the owned command running,
and use its printed URL. `GET /health` returns
`{service:"optional-whiteboard/v1",instanceId,url,pid,memoryOnly:true,defaultTopicId}`.
Verify that identity when reusing an existing URL. Restart loses all RAM topics,
working states and seals; exports are not restoration.

All JSON operations below require:

```text
Content-Type: application/json
x-whiteboard-instance: <instanceId returned by health>
```

`GET /topics` needs the instance header and returns
`{defaultTopicId,topics:[{topicId,name}]}`. `POST /topics` with `{name}` returns
201 `{topicId,name}`. Names trim to 1-80 characters; IDs, not names, identify
pages. List/create only: no rename/delete/archive/merge or persistence.

Send `topicId` explicitly on every content request. Omission is compatibility
for the fixed original `default` topic (Main), **never the human's selected page**.
An unknown/invalid topic fails. Each topic has its own working state and seals;
native element IDs may repeat on other topics. Store `(topicId, versionId)`
together at handoff. Cross-topic target/comparison versions fail.

One opaque `versionId` identifies content. Content-changing edits get a new ID;
no-op edits keep it. `seal` captures under that same ID, not another revision
channel. Old unsealed states are not retained. Every new topic starts with an
empty seal. Sealing is neither approval nor locking, source saving or an agent
invocation. Human and agent use the same content engine.

## Requests and responses

| HTTP | Request | Successful response |
| --- | --- | --- |
| `POST /read` | `{topicId,target?:"latest"|exactSeal,compareTo?:exactSeal,includeImage?:boolean}` | `{topicId,topicName,versionId,sealed:true,scene,hasUnsealedChanges,compareTo?,changes?,image?}` |
| `POST /edit` | `{topicId,expectedVersionId,operations,expectedLatestSealedVersionId?}` | `{topicId,topicName,versionId,scene,latestSealedVersionId,hasUnsealedChanges,sealedCount,effects}` |
| `POST /seal` | `{topicId,expectedVersionId}` | `{topicId,topicName,versionId,sealed:true,hasUnsealedChanges:false}` |
| `POST /snapshot` | `{topicId,target?:"latest"|exactSeal}` | `{topicId,topicName,versionId,sealed:true,hasUnsealedChanges,image}` |

`scene` is `{elements:[...],files:{},appState:{viewBackgroundColor:"#ffffff"}}`.
`image` is `{topicId,versionId,dataURL:"data:image/png;base64,...",width,height}`.
PNG covers the whole addressed sealed topic, not selection, viewport, all
topics or editor chrome. It uses the same captured-seal rendering as
`read(includeImage:true)` and fits within a 4096-pixel longest side.

`read`/`snapshot` default to latest **sealed** content. If working edits are
newer, return the previous seal and `hasUnsealedChanges:true`, not the live
draft and not a pending-work error. Exact sealed reads are repeatable.
`compareTo` must be an exact seal in the same topic; direction is baseline ->
target. Missing/unsealed target/baseline is an error, never a fallback or empty
diff. A later seal/edit during PNG rendering cannot retarget the captured image.
The pending flag describes the state at capture, not at asynchronous completion.

`changes` and edit `effects` have this shape:

```json
{
  "added": [{ "id": "new-note", "type": "text" }],
  "removed": [],
  "changed": [
    { "id": "label", "fields": [{ "path": "text", "before": "Draft", "after": "Discuss" }] }
  ]
}
```

Added/removed entries contain full elements (abbreviated above). Nested changed
fields use dotted paths; absent values appear as `null`. Text, geometry, style,
points/pressure, metadata and bindings are factual content. Camera/selection and
native bookkeeping are excluded; visible layer changes are reported as
`zOrder`. These are **not intent, approval or human/agent attribution**.

### Atomic edit operations

```json
{
  "topicId": "<actual-topic-id>",
  "expectedVersionId": "<actual-current-working-id>",
  "operations": [
    { "op": "add", "element": { "id": "note", "type": "text", "x": 80, "y": 350, "width": 220, "height": 23, "text": "Standalone question" } },
    { "op": "update", "id": "existing-label", "set": { "text": "Discuss" } },
    { "op": "remove", "id": "explicit-obsolete-note" }
  ]
}
```

Use only IDs that actually exist/are unused as appropriate; this illustrates the
three operation kinds, not a batch to send blindly. Add/update allow optional
zero-based `position` in the layer array. Add defaults to append. Update cannot
set `id` or `type`; text updates also set `originalText` unless supplied explicitly.
Unknown operation/element fields, missing IDs and duplicate additions fail.

The whole batch is validated against its final relationships before any commit.
Remove associated references in the **same batch**; intermediate ordering can
temporarily reference a new object added later in that batch. Unchanged objects
keep their IDs and content. No full-board replace or automatic ID regeneration.
Optional `expectedLatestSealedVersionId` also guards the current latest seal;
the human Reset control uses it. No public reset/fit method is introduced.

Use an edit's returned working ID for your next edit/seal. If another peer has
unsealed work beyond the seal you read, do not overwrite it. On 409, obtain the
next handoff and reconcile instead of pasting a newer ID into an old proposal.

### CLI

From the skill directory:

```powershell
node scripts\whiteboard.mjs health --url "<printed-url>"
node scripts\whiteboard.mjs topics --url "<printed-url>"
node scripts\whiteboard.mjs create-topic --url "<printed-url>" --json '{"name":"UX discussion"}'
node scripts\whiteboard.mjs read --url "<printed-url>" --topic "<topicId>" --json '{"includeImage":true}'
node scripts\whiteboard.mjs edit --url "<printed-url>" --topic "<topicId>" --input edit.json
node scripts\whiteboard.mjs seal --url "<printed-url>" --topic "<topicId>" --json '{"expectedVersionId":"<returned-working-id>"}'
node scripts\whiteboard.mjs snapshot --url "<printed-url>" --topic "<topicId>" --json '{"target":"<exact-seal>"}'
```

`--input` reads UTF-8 JSON; `--json` accepts inline JSON. `--topic` must agree
with a `topicId` already in the body. Responses print JSON; CLI errors exit
nonzero with the HTTP status/message. There is no agent-specific SDK requirement.
There is **no** Mermaid request type, public live-draft read, or file routing.

## Native object fields: complete accepted inventory

All adds require `id`, `type`, finite `x`, `y`, `width`, `height`.
Dimensions must be nonnegative; stable nonempty IDs are at most 200 characters.
Supported types are exactly:
`rectangle`, `diamond`, `ellipse`, `text`, `line`, `arrow`, `freedraw`, `frame`.
Every other type/unknown field is rejected. Coordinates are scene units, not
pixels in a particular zoom. Elements are ordered back-to-front.

The table gives safe native authoring values and actual defaults. Some advanced
native fields are accepted/pass-through but not deeply validated; that is **not**
a promise of all upstream behaviors. Use the cookbook's tested subset for
normal edits rather than inventing unsupported structures.

| Fields | Values / defaults / enforcement |
| --- | --- |
| `id`, `type`, `x`, `y`, `width`, `height` | Required as above. Update IDs/types are immutable; use explicit remove/add only when appropriate. |
| `angle` | Finite radians, default `0`. Geometry helpers intentionally require unrotated rectangles. |
| `strokeColor`, `backgroundColor` | Strings, defaults `"#1e1e1e"` / `"transparent"`. Use valid native CSS colors. |
| `fillStyle` | `solid` (default), `hachure`, `cross-hatch`, `zigzag`. |
| `strokeStyle` | `solid` (default), `dashed`, `dotted`. |
| `strokeWidth`, `roughness`, `opacity` | Finite; defaults `2`, `0`, `100`. Stroke width >= 0; opacity 0-100. |
| `groupIds` | Array of strings, default `[]`; deepest to outermost. Preserve native groups; they are not shape-label/connector bindings. |
| `frameId` | Default `null`; when truthy must reference an existing `frame`. Frame ancestry cannot cycle. |
| `boundElements` | Default/`null` normalize to `[]`; `{id,type:"text"|"arrow"}` entries require matching existing object type and reciprocal relationship. Sorted by ID canonically. |
| `roundness` | Default `null`; optional native roundness object is pass-through. Cookbook uses unrounded rectangles. |
| `seed` | Finite native drawing seed, default `1`. |
| `isDeleted` | Default `false`; `true` is rejected. Use a remove operation instead of tombstones. |
| `link` | Default `null`; native link data is pass-through, not an external-content import. |
| `locked` | Boolean, default `false`. The API is an explicit content editor, not a lock-authorization system; helpers respect locks. |
| `customData` | Optional JSON object; preserve unrelated metadata. Helpers use only their own namespaced connector declaration. |
| `text`, `originalText` | Required string `text` for text objects. `originalText` defaults to text; keep the two consistent. |
| `fontSize`, `fontFamily`, `lineHeight` | Finite; text defaults `20`, `2`, `1.15`. Size/line height > 0. `2` is the tested normal font; other finite font IDs are not universally qualified. |
| `textAlign`, `verticalAlign` | Text defaults `left` / `top`; safe native choices `left|center|right`, `top|middle|bottom`. Alignment values are not separately enum-validated. |
| `containerId` | Text default `null`. Truthy references must be to a rectangle, diamond, ellipse or arrow with reciprocal bound-text entry. |
| `autoResize` | Text boolean, default `true`. Cookbook labels use fixed allocated width (`false`) and explicit line breaks; this is not an automatic layout engine. |
| `points` | Required for line/arrow/ink: array of up to 30000 finite `[dx,dy]` pairs relative to element `x/y`. Keep width/height consistent with point extent. No Bezier/semantic path input. |
| `pressures`, `simulatePressure` | Ink defaults `[]` / `true`. Pressures are finite numbers, flag boolean. Physical stylus behavior is unqualified. |
| `startBinding`, `endBinding` | Line/arrow defaults `null`. Reciprocal native endpoint binding is supported for **arrows**: `{elementId,focus,gap}` needs finite focus/gap, an existing bindable target and reciprocal arrow entry. Lines must remain unbound in this validated subset. Helpers use declared center anchors (`focus:0`, nonnegative gap). |
| `startArrowhead`, `endArrowhead` | Start default `null`; end defaults `"arrow"` on arrows, otherwise `null`. Native arrowhead values are pass-through; cookbook uses `null` / `"arrow"`. |
| `elbowed` | Arrow boolean, default `false`; advanced elbow geometry is not handled by the safe helpers. |
| `fixedSegments`, `startIsSpecial`, `endIsSpecial` | Accepted native elbow fields; special flags boolean. Segment payload is pass-through, not a general routing API; helpers reject this case. |
| `name` | Optional native frame label, pass-through. It does not create source/project ownership. |

The only accepted bookkeeping fields are `version`, `versionNonce`, `updated`,
`index`, `lastCommittedPoint`. Supplied values are normalized/ignored, not
independent public version channels. They never substitute for `versionId`.
Camera/selection are not element fields and are not accepted as edit fields.
Scene assets remain `files:{}`; no raster/HTML/SVG/iframe/embeddable imports.

### Relationships to declare explicitly

For a label `label-A` on `box-A`:

```json
{
  "boxExcerpt": { "id": "box-A", "boundElements": [{ "id": "label-A", "type": "text" }] },
  "labelExcerpt": { "id": "label-A", "containerId": "box-A" }
}
```

These are **excerpts**, not complete adds. The cookbook emits complete payloads.
Bound text must point back to its container. The native text containers supported
by the validator are rectangle/diamond/ellipse/arrow, not frame/ink/line.

An arrow endpoint binds only to rectangle/diamond/ellipse/text/frame; its target
must list `{id:arrowId,type:"arrow"}` in `boundElements`. Every target arrow entry
must in turn name it in start/end binding. A group or nearby position is not a
substitute. There is no semantic association inferred by the board.

For explicit deletion, remove the node, its requested associated label/arrows
and their reciprocal references together. Do not silently delete nearby ink,
standalone annotations or other group members. Frames and groups do not imply
cascading removal. The tested helper rejects complex geometry it cannot preserve.

## Limits and honest failures

| Status | Meaning |
| --- | --- |
| 400 | Invalid operation parameters/JSON/topic/name/target; snapshot accepts only its target plus topic identity. |
| 403 | Wrong service instance or loopback origin. |
| 404 | Unknown topic or unavailable/unsealed/cross-topic target/baseline. No fallback. |
| 409 | Stale working/latest-seal precondition; response includes current topic/working ID for diagnosis, not permission to replay. |
| 413 | Request exceeds 2 MiB. |
| 415 | JSON content type required. |
| 422 | Invalid native fields, IDs, operation, dimensions, references or scene limits. Whole edit is rejected. |
| 503 | Captured PNG rendering unavailable; ordinary native read still works. |
| 500 | Unexpected service failure; not a successful empty drawing or fallback. |

At most 3000 elements per scene, 30000 points per stroke/path, native-only
assets, 4096-pixel PNG longest side. Rendering needs installed Edge on Windows
or prepared Playwright Chromium/`WHITEBOARD_BROWSER_CHANNEL` elsewhere.
The service owns no source files, saved project state, workflow phases or
library-pack installation. No production RAM-retention budget, physical
pen/touch or Claude Code/Codex runtime qualification is claimed.
