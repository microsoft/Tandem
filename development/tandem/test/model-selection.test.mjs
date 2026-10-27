import assert from "node:assert/strict";
import test from "node:test";
import { readModelSelection, modelSelectionLabel, validModelSelection } from "../public/model-selection.js";

test("model/effort readouts distinguish current native values, defaults, not-started and unavailable states", async () => {
  const actual = await readModelSelection(async () => ({ modelId: "native-current", reasoningEffort: "high", requestedModel: "not-applied" }));
  assert.equal(modelSelectionLabel(actual, "Main"), "Main: native-current · Effort: high");
  const implicit = await readModelSelection(async () => ({ modelId: "inherited-model" }));
  assert.equal(modelSelectionLabel(implicit, "Development"), "Development: inherited-model · Effort: native default (not reported)");
  assert.equal(modelSelectionLabel({ status: "not-started", modelId: null, reasoningEffort: null, error: null }, "Development"), "Development: not started");
  const unknown = await readModelSelection(async () => ({}));
  assert.match(modelSelectionLabel(unknown, "Main"), /model not yet reported/);
  const failed = await readModelSelection(async () => { throw new Error("Native readback unavailable"); });
  assert.equal(failed.modelId, null);
  assert.equal(failed.error, "Native readback unavailable");
  assert.equal(modelSelectionLabel(failed, "Development"), "Development: model/effort unavailable");
  assert.equal(validModelSelection({ status: "reported", modelId: ["not-a-model"], reasoningEffort: null, error: null }), false);
});
