# Native editing cookbook

Use this only when authoring/refining a useful visual. Chat remains
self-contained; the human can originate a sketch and need not repeat it all
in prose. These are sample drawings, not inferred project requirements.
The [API/native reference](api-and-elements.md) is sufficient for ordinary raw
edits; agents do not need to reverse-engineer the implementation.
For pattern selection, composition, restrained styling and reviewing the exact
sealed image, load the [visual authoring guide](visual-authoring.md). A valid
payload is only the structural check, not proof that the drawing reads well.

## Use current objects and a real precondition

Read the exact topic's latest/handed-over seal, optionally `compareTo` your
previous seal and `includeImage:true`. If `hasUnsealedChanges` is true, the read
is still the old seal: wait for the next handoff or discuss it, rather than
overwriting unseen work. Keep `topicId` with every `versionId`.

Save that actual JSON response as UTF-8 `current.json`. Generate an ordinary
edit request locally, inspect it, then use the existing API:

```powershell
node scripts\cookbook.mjs ux --read current.json --out edit.json
node scripts\whiteboard.mjs edit --url "<url>" --topic "<topicId>" --input edit.json
```

The generator does **not** call the board or seal anything. It requires a fresh
sealed response with no pending work, preserves the supplied topic/version ID,
and outputs only normal add/update/remove operations. The board remains the
authority: a 409 rejects stale work. Re-read/reconcile, never substitute a newer
ID into the old request. After a meaningful edit, seal its returned working ID.
Do not recreate the diagram on every turn.

## Small deterministic helper set

Import from `shared/authoring.mjs` in Node:

```js
import {
  addLabeledBox, connectNodes, renameLabel, moveResizeNode, deleteNode,
} from "./shared/authoring.mjs";

const request = {
  topicId: current.topicId,
  expectedVersionId: current.versionId,
  operations: moveResizeNode(current.scene, "review", {
    x: 390, y: 340, width: 250, height: 130,
  }),
};
```

Every helper returns edit operations; it does not mutate the read, send requests,
mint canonical IDs, seal, interpret meaning or use proximity. Caller supplies
stable IDs and intended positions. Unrelated elements/metadata remain unchanged.

Helpers intentionally support unlocked, unrotated **rectangles**, one native
bound text label, and declared straight center-bound arrows. This is a safe
subset of the wider raw native validator, not a new domain diagram language.
For complex/native human drawings, preserve unsupported objects and use explicit
native edits/clarification rather than flattening or guessing.

| Helper | Input / result |
| --- | --- |
| `addLabeledBox(scene,{id,labelId,text,x,y,width,height,...})` | Adds complete rectangle + bound text with reciprocal references. Defaults: normal font 20, roughness 0, border 1.5, center/middle, 10-unit padding, pale fill. Optional `fill`, `stroke`, `strokeWidth`, `fontSize`, `align`, `vertical`, `groupIds`, `frameId`, `customData`. IDs must be unused. |
| `connectNodes(scene,{id,fromId,toId,fromSide?,toSide?})` | Adds a straight bound arrow (new arrow width 1.25), or explicitly rewires that existing arrow ID without restyling it. Sides default right -> left; choices left/right/top/bottom. Repairs old/new reciprocal node references in the same batch. |
| `renameLabel(scene,labelId,text)` | Updates the named bound text ID and its native text metrics/position; preserves the container, IDs, metadata and other elements. |
| `moveResizeNode(scene,nodeId,{x?,y?,width?,height?})` | Moves/resizes that node, positions its existing bound label and adjusts declared connected arrow endpoints. Preserves IDs, styles, groups, frame membership and unrelated annotations. |
| `deleteNode(scene,nodeId)` | Explicitly removes that node, its bound text and incident arrows/arrow labels, then removes their reciprocal references. Does not delete neighboring nodes, standalone ink or other group members. |

Connector metadata is namespaced at `customData["brainstormWhiteboard.authoring"]`
and records version/from/to/anchor sides. It preserves other metadata. Geometry
helpers require that declaration to match current native bindings; a peer's
reconnection must be handled explicitly, not undone from an old recipe.
Bent/elbowed/rotated/locked arrows, noncenter bindings, self-loops and cross-frame
connections are rejected, as are labels with their own connectors and stale
side declarations after a human reroute. The helper validates the declared side;
it never picks a new side from nearby objects. Label text uses explicit newlines and must fit the
stored allocation; automatic word wrapping/font measurement is not a helper
feature. Resize may require a larger box or explicit label edits first.
Move within an existing frame stays within its bounds; it does not move frames
or unrelated group members. Always inspect the resulting native snapshot.

## Tested edit sequence: flow, insertion, rename, geometry, deletion

`scripts/cookbook.mjs` contains the executable recipes, not just fragments.
For each next recipe, use a **new actual read after sealing the previous edit**.
The IDs below are the fixture's IDs, not IDs to invent on an unrelated board.

| Recipe | Native action | Expected factual effects |
| --- | --- | --- |
| `flow` | Add Request and Decide with associated labels and `request-decision` bound connector. | 5 added elements. Existing standalone/user content retained. |
| `insert` | Add Review between them; rewire the existing `request-decision` arrow to Review; add `review-decision`. | 3 added elements, changed endpoint/reciprocal references; original arrow ID retained. |
| `rename` | Rename `review-label` to Discuss together. | Same label ID; changed text/originalText/allocated text geometry only. |
| `move` | Move/resize `review` and update its label/two arrows consistently. | Geometry changes for the explicit node, label and connectors; no recreated IDs. |
| `remove` | Delete Review plus its own label/incident connectors. | Those 4 IDs removed; surviving endpoints lose only the removed arrow references. Request/Decide and annotations remain. |

For custom content, call the same helpers with the IDs and intent read from the
current native scene. The helper doesn't decide which step the user meant.
Deleting a step does **not** invent a new connection between the survivors.

## A real fork, not a longer chain

`branch` appends four labeled nodes and three bound arrows: Submit request ->
Check ownership, then separate Approve release and Request changes outcomes.
The lower outcome uses the review node's **bottom** anchor and its own **left**
anchor; the upper route stays horizontal. Outcome text, not color alone,
explains the difference. All eleven added objects remain editable. Existing
annotations/metadata are retained; repeating the recipe with colliding IDs fails.

```powershell
node scripts\cookbook.mjs branch --read current.json --out branch-edit.json
node scripts\whiteboard.mjs edit --url "<url>" --topic "<topicId>" --input branch-edit.json
```

Seal that edit's actual returned working ID, then capture its exact version:

```powershell
node scripts\whiteboard.mjs seal --url "<url>" --topic "<topicId>" --json '{"expectedVersionId":"<actual-edit-versionId>"}'
node scripts\whiteboard.mjs snapshot --url "<url>" --topic "<topicId>" --json '{"target":"<actual-sealed-versionId>"}'
```

The identifiers above are placeholders for real replies, not literal IDs.
Inspect the returned PNG with available image tools before handoff. If a label
clips or a connector crosses a card, correct only that area with a **fresh**
sealed read/no pending work and a new guarded edit/seal/snapshot. If visual
inspection is unavailable, state that limitation. Do not regenerate a recipe
over an existing human branch or infer a new outcome from its color.

## Native rough UX, then a targeted refinement

`ux` produces native editable panels, navigation, labeled field sketches,
a primary button and a preview card/connector. It is not a screenshot, HTML
mock or functioning settings website. It appends named `ux-*` IDs and refuses
collisions; it never replaces unrelated material.

`ux-edit` reads the existing `ux-primary` button's current position/size,
renames its bound label to Save settings and modestly moves/enlarges it while
adjusting its declared connector. It keeps existing IDs and metadata.
Use the native text editor for human label changes; native shape moves/resizes
continue to carry native bound text and arrow relationships.

```powershell
node scripts\cookbook.mjs ux --read current.json --out ux-edit-request.json
# Send with whiteboard.mjs edit, inspect the view, seal, obtain a fresh read.
node scripts\cookbook.mjs ux-edit --read next-current.json --out refinement.json
```

Treat the layout as a proposed illustration. The user can draw an idea, rearrange
controls or mark an area. On the next seal, compare the **actual native state**
and matching image, explain what changed in chat, and distinguish observation
from interpretation. Preserve the user's ink, unknown box called "new", and
unrelated metadata/IDs. Ask only about genuine ambiguity; do not demand a
textual duplicate or quietly turn an unknown sketch into accepted requirements.

## Mermaid is optional creation, not the foundation

Mermaid is not a general UX format and `/edit` does **not** accept Mermaid text.
The pinned Excalidraw package bundles `@excalidraw/mermaid-to-excalidraw` 2.2.2,
not the current upstream v3 API. The existing native UI's **More tools > Mermaid
to Excalidraw** is suitable for a small flow when its rendered result consists
of native elements. Other diagram types may fall back to an image, outside this
native-only skill. There is no agent-side Mermaid endpoint/bridge here and no
new parser/service or library packs to install.

After human edits, refine the current native objects; never regenerate the
original Mermaid and overwrite the user's changes. The executable cookbook
and UX proof use native objects directly, not Mermaid.
