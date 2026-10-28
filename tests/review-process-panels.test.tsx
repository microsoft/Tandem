import assert from "node:assert/strict";
import { test } from "node:test";
import { reactHarness, state } from "./helpers/react-harness.js";

test("retired artifact content remains readable and is escaped", async t => {
  const value = state("prototype");
  value.artifacts = [{ id: "legacy", title: "Retained Design", stage: "design", kind: "contract",
    content: '<script>alert("not executable")</script>' }];
  const h = await reactHarness(t);
  h.render(value); await h.flush();
  await h.click(h.get("artifact-list").querySelector('[data-artifact-id="legacy"]')!);
  assert.equal(h.get("artifact-content").querySelector("script"), null);
  assert.equal(h.get("artifact-content").textContent, value.artifacts[0].content);
  assert.match(h.get("content-card").textContent!, /Read-only legacy evidence/);
  assert.match(h.get("content-card").textContent!, /does not authorize Development/);
  assert.equal(h.document.querySelector("#process-root-toggle, #acceptance-delivery, #save-process"), null);
  assert.equal(h.requests.length, 0);
});
