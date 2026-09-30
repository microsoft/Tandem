import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { generatedContentText } from "../public/annotation-capture.js";

test("generated labels preserve literals, attributes, escapes and empty visual boxes", () => {
  const source = { getAttribute: (name) => name === "data-sequence" ? "2" : null };
  assert.equal(generatedContentText('attr(data-sequence)', source), "2");
  assert.equal(generatedContentText('"Step " attr(data-sequence)', source), "Step 2");
  assert.equal(generatedContentText(String.raw`"\41 ttention"`, source), "Attention");
  assert.equal(generatedContentText(String.raw`"say \"hello\""`, source), 'say "hello"');
  assert.equal(generatedContentText('""', source), "");
  assert.equal(generatedContentText("none", source), null);
  assert.equal(generatedContentText("normal", source), null);
  for (const unsupported of ["counter(sequence)", "open-quote", 'url("https://example.invalid/image.png")']) {
    assert.throws(() => generatedContentText(unsupported, source), /unsupported generated content/);
  }
});
