import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { humanHistoryLabels, projectHumanHistory } from "../public/renderers/human-loop-history.js";
import { historyIconVocabulary, historyIconPath, historyIconTone } from "../public/renderers/history-icons.js";

test("every canonical history label has an explicit icon without renaming or conflating state labels", () => {
  assert.deepEqual(Object.keys(historyIconVocabulary).sort(), [...humanHistoryLabels].sort());
  for (const label of humanHistoryLabels) {
    assert.equal(typeof historyIconPath(label), "string", label);
    assert.match(historyIconPath(label), /^[Mm]/, label);
  }
  for (const label of ["Recovery", "Compacting", "Context compacted", "Compaction failed", "Permission needed",
    "Permission granted", "Permission denied", "Permission withdrawn", "Approvals reset", "Stopping", "Stopped",
    "Task progress", "Plan ready", "Design unchanged", "Work failed", "State unknown"]) {
    assert.ok(humanHistoryLabels.includes(label), label);
  }
  assert.notEqual(historyIconPath("Recovery"), historyIconPath("Ready"));
  assert.notEqual(historyIconPath("Compacting"), historyIconPath("Ready"));
  assert.equal(historyIconPath("Unrecognized future event"), historyIconPath("Host update"));
});

test("Host completion timeout stays distinct from user Stop and compaction failure", () => {
  const summary = "Host automatically requested cancellation after 30 seconds without the matching role turn-end signal. This was not a user Stop.";
  const history = projectHumanHistory([
    { id: "timeout", sequence: 1, type: "human.completion-timeout", timestamp: "2026-09-20T08:00:00Z", summary, data: { requestId: "request" } },
    { id: "compaction", sequence: 2, type: "human.compaction-failed", timestamp: "2026-09-20T08:00:01Z",
      summary: "Context compaction failed: UserAbort", data: {} },
  ], [], "stream");
  assert.deepEqual(history.map(entry => entry.label), ["Completion timeout", "Compaction failed"]);
  assert.equal(history[0].explanation, summary);
  assert.equal(history[0].source.requestId, "request");
  assert.ok(history.every(entry => entry.label !== "Stopped"));
});

test("normal history icon families include permissions, Host updates and recovery without recoloring exceptions", () => {
  for (const [tone, labels] of Object.entries({
    conversation: ["Your request", "Answer ready", "Host update"],
    structure: ["Routing", "Planning", "Plan ready", "Reviewing", "Review result", "Compaction requested", "Compacting", "Context compacted"],
    design: ["Designing", "Design updated", "Design unchanged", "Permission needed", "Permission granted", "Permission withdrawn", "Approvals reset"],
    execution: ["Implementing", "Task progress", "Read-only work", "Ready", "Recovery"],
  })) for (const label of labels) assert.equal(historyIconTone(label), tone, label);
  for (const label of ["Work failed", "History issue", "Compaction failed", "Permission denied", "Input needed",
    "Answer not applied", "State unknown", "Setup waiting", "Completion timeout", "Stopping", "Stopped", "Unrecognized future event"]) {
    assert.equal(historyIconTone(label), "neutral", label);
  }
});

test("history SVG-only palette retains contrast and differentiated hues in both themes", async () => {
  const css = await readFile(new URL("../public/human-loop-shell.css", import.meta.url), "utf8");
  const rgb = hex => hex.slice(1).match(/../g).map(value => Number.parseInt(value, 16));
  const mix = (left, weight, right) => left.map((value, index) => value * weight + right[index] * (1 - weight));
  const luminance = color => color.map(value => value / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
  const contrast = (left, right) => (Math.max(luminance(left), luminance(right)) + .05)
    / (Math.min(luminance(left), luminance(right)) + .05);
  const colors = [...css.matchAll(/--history-(\w+)-ink: light-dark\((#[a-f0-9]{6}), (#[a-f0-9]{6})\)/g)];
  assert.equal(colors.length, 4);
  const hueAndSaturation = color => {
    const [r, g, b] = color.map(value => value / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
    const hue = max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    return { hue: (hue * 60 + 360) % 360, saturation: delta / (1 - Math.abs(max + min - 1)) };
  };
  for (const [theme, index, background, surface] of [
    ["light", 2, "#e2e8f0", "#f8fafc"], ["dark", 3, "#0f172a", "#1e293b"],
  ]) for (const color of colors) {
    const tone = color[1], ink = rgb(color[index]);
    for (const [state, canvas] of [["normal", rgb(background)], ["selected", mix(rgb(surface), .92, rgb("#2563eb"))]]) {
      assert.ok(contrast(ink, canvas) >= 4.5, `${theme}/${state}/${tone}: ${contrast(ink, canvas).toFixed(2)}:1`);
    }
    const appearance = hueAndSaturation(ink);
    assert.ok(appearance.saturation >= .45, `${theme}/${tone} must not collapse into slate`);
    for (const other of colors.filter(other => other[1] !== tone)) {
      const distance = Math.abs(appearance.hue - hueAndSaturation(rgb(other[index])).hue);
      assert.ok(Math.min(distance, 360 - distance) >= 35, `${theme}/${tone}/${other[1]} hue separation`);
    }
    assert.ok(css.includes(`.state-history-dot svg[data-history-tone="${tone}"] { color: var(--history-${tone}-ink); }`));
  }
  assert.match(css, /\.state-history-dot \{[^}]*border: 1px solid var\(--border\)[^}]*background: var\(--background\)/);
  assert.match(css, /\.state-history-step::after \{[^}]*background: var\(--border\)/);
  assert.match(css, /\.state-history-step\[data-selected="true"\] \.state-history-dot \{ border-color: var\(--blue\); background: var\(--blue-soft\); \}/);
  assert.doesNotMatch(css, /(?:border|background|outline)[^;{}]*var\(--history-/);
});
