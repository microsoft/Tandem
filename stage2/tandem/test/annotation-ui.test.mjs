import assert from "node:assert/strict";
import test from "node:test";
import { createAnnotationModel, createPerspectiveAnnotationModel, createArtifactAnnotationModel } from "../public/annotation-model.js";

const source = () => ({ revisionId: "revision-a", perspective: "use-case", selectionId: "map",
  viewport: { x: 0, y: 10, width: 100, height: 80, scale: 1 } });
const preview = () => ({ source: source(), blob: new Blob(["original-png"]), url: "blob:preview" });
const supported = { supported: true, limits: { maxBytes: 4 * 1024 * 1024, maxImages: 1 } };

test("generic artifact drafts are not a five-view enum and cannot cross an exact revision digest", () => {
  const model = createArtifactAnnotationModel();
  const bound = { schemaVersion: "artifact-annotation/v1", revisionId: "revision", designDigest: "a".repeat(64),
    artifactId: "custom-domain-map", selectionId: "action", viewport: source().viewport };
  model.select(bound.artifactId); model.toggle(true, bound);
  model.begin(bound, { x: 1, y: 2 }); model.end();
  model.select("another-arbitrary-artifact");
  assert.equal(model.snapshot().binding, null);
  model.select(bound.artifactId);
  assert.deepEqual(model.snapshot().binding, bound);
  assert.throws(() => model.captureBinding({ ...bound, designDigest: "b".repeat(64) }), /changed/);
  assert.throws(() => model.captureBinding({ ...bound, artifactId: "another-arbitrary-artifact" }), /changed/);
});

test("per-perspective drafts retain independent activation, exact targets and one shared composer preview", () => {
  const model = createPerspectiveAnnotationModel();
  model.select("use-case");
  model.toggle(true, source());
  model.begin(source(), { x: 10, y: 20 });
  model.move({ x: 30, y: 40 });
  model.end();
  const first = model.snapshot();
  const image = preview();
  model.setPreview(image);
  model.select("flow");
  assert.equal(model.snapshot().mode, "view", "Selecting a tab does not turn on its drawing mode.");
  const flow = { ...source(), perspective: "flow", selectionId: "flow-one" };
  model.toggle(true, flow);
  model.begin(flow, { x: 1, y: 2 });
  model.end();
  assert.equal(model.snapshot().preview, image, "Switching tabs never replaces the global composer image.");
  model.select("use-case");
  assert.deepEqual(model.snapshot().strokes, first.strokes);
  assert.deepEqual(model.snapshot().binding, first.binding);
  assert.equal(model.snapshot().mode, "annotate");
  model.toggle(false);
  model.select("flow");
  assert.equal(model.snapshot().mode, "annotate");
  model.clear();
  assert.equal(model.snapshot().binding, null);
  model.select("use-case");
  assert.equal(model.snapshot().mode, "view");
  assert.deepEqual(model.snapshot().strokes, first.strokes);
  assert.throws(() => model.captureBinding({ ...source(), revisionId: "revision-b" }), /changed/);
  assert.throws(() => model.select("scroll-position-2"), /Unsupported/);
  for (const perspective of ["use-case", "contract", "flow", "gui", "system"]) model.select(perspective);
  assert.equal(model.drafts().size, 5);
});

test("View/Annotate toggling preserves strokes and never modifies source Design identity", () => {
  const model = createAnnotationModel();
  const original = source();
  model.toggle(true);
  model.begin(original, { x: 10, y: 20 });
  model.move({ x: 30, y: 40 });
  model.end();
  model.toggle(false);
  assert.equal(model.snapshot().mode, "view");
  assert.equal(model.snapshot().strokes[0].length, 2);
  model.toggle(true);
  assert.deepEqual(model.captureBinding(source()), original);
  assert.deepEqual(original, source());
  model.undo();
  assert.equal(model.snapshot().strokes.length, 0);
  model.clear();
  assert.equal(model.snapshot().binding, null);
});

test("revision, perspective, selection and viewport changes never silently remap retained marks", () => {
  const model = createAnnotationModel();
  model.toggle(true);
  model.begin(source(), { x: 10, y: 20 });
  model.end();
  for (const changed of [
    { ...source(), revisionId: "new" }, { ...source(), perspective: "gui" },
    { ...source(), selectionId: "different-node" },
    { ...source(), viewport: { ...source().viewport, y: 11 } },
  ]) {
    assert.throws(() => model.captureBinding(changed), /changed/);
    assert.throws(() => model.begin(changed, { x: 1, y: 1 }), /another diagram/);
    assert.equal(model.snapshot().strokes.length, 1);
  }
});

test("entering Annotate pins its target before the first stroke", () => {
  const model = createAnnotationModel();
  model.toggle(true, source());
  assert.deepEqual(model.snapshot().binding, source());
  assert.throws(() => model.begin({ ...source(), selectionId: "now-more-visible" }, { x: 1, y: 1 }), /another diagram/);
  model.toggle(false);
  assert.deepEqual(model.snapshot().binding, source());
});

test("capture preview and remove are local state, not submission or approval", () => {
  const model = createAnnotationModel();
  const image = preview();
  model.setPreview(image);
  model.toggle(false);
  assert.equal(model.snapshot().preview, image);
  model.removePreview();
  assert.equal(model.snapshot().preview, null);
});
