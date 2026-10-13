import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { humanLoopPrompts } from "../public/prompts/human-loop.js";
import { designGenerationContract, designReferenceCatalog } from "../public/sketch/design-contract.js";
import { contextHarness } from "./helpers/human-loop-prompt-fixture.mjs";
import { sharedDesign } from "./helpers/shared-design-fixture.mjs";

test("Router guidance prioritizes requested Design changes without keyword-based routing", () => {
  const instructions = humanLoopPrompts.roles.router.join("\n");
  assert.match(instructions, /When a request spans roles, choose the work that must happen first/);
  assert.match(instructions, /requested product Design change takes precedence over accompanying implementation intent/);
  assert.match(instructions, /'change the Design and then build it' routes to Designer, not Planner/);
  assert.match(instructions, /'implement the already-agreed Design\/change'.*code fixes restoring agreed behavior route to internal planning/);
  assert.match(instructions, /Compare the request with the canonical Design/);
  assert.match(instructions, /do not infer a new Design change from the words design\/change alone/);
  assert.match(instructions, /explanation\/testing-only requests route to the read-only Agent/);
});

test("cross-role guidance ends Design work without carrying implementation approval forward", () => {
  const instructions = humanLoopPrompts.roles.router.join("\n");
  assert.match(instructions, /Design work ends at its visible handoff/);
  assert.match(instructions, /Do not treat accompanying implementation intent as approval after publication/);
  assert.match(instructions, /Only the user's Plan and implement click authorizes Planner/);
  assert.match(instructions, /Other Design work requires a distinct subsequent implementation request and its confirmation/);
  assert.match(instructions, /both Change Design and Change implementation must route to Designer first/);
  assert.match(instructions, /preserve every implementation answer as reference for Planner and Implementer/);
  assert.match(instructions, /Treat each answer as a normal new user request/);
  assert.match(instructions, /Choose resume-cycle or replan-cycle only through normal current-request interpretation for a genuinely unfinished compatible authorized cycle/);
});

test("existing-repository onboarding uses Designer without treating every populated folder as an onboarding request", () => {
  const instructions = humanLoopPrompts.roles.router.join("\n");
  assert.match(instructions, /bring an existing repository into Tandem.*generate Design artifacts from its code/);
  assert.match(instructions, /route to Designer for repository exploration and an evidence-based baseline/);
  assert.match(instructions, /Existing code is not itself a canonical Tandem Design/);
  assert.match(instructions, /Do not start onboarding merely because files exist or the UI opened/);
  assert.match(instructions, /ordinary explanation\/testing-only requests remain Agent work/);
  assert.match(instructions, /normal Design handoff and question-answer path, with no new phase or automatic implementation/);
});

test("mixed and already-agreed request contrasts retain exact Design context and Router guidance, not inferred model outcomes", async (t) => {
  const runtime = await readFile(new URL("../src/human-loop-runtime.mjs", import.meta.url), "utf8");
  const Harness = contextHarness(runtime, { designGenerationContract, designReferenceCatalog, humanLoopPrompts });
  const design = {
    binding: { revisionId: "agreed-design", digest: "a".repeat(64) },
    content: sharedDesign(),
  };
  for (const [id, message] of [
    ["mixed", "Change the Design to allow editing past daily notes, then build it."],
    ["already-agreed", "Implement the already-agreed Design change allowing past daily note editing."],
    ["restore-behavior", "Fix the save button so it persists notes as the agreed Design requires."],
    ["explain", "Explain the Design change and how its implementation would work; do not change anything."],
    ["prior-reference", "Build the change we just agreed in the current Design."],
  ]) {
    await t.test(id, async () => {
      const request = { id, message, answers: null };
      const state = { requests: [request], activeBatchRequestIds: [id], questions: [],
        awaitedQuestionResultId: null, cycles: [], handoffs: [] };
      const context = await new Harness({}).context("router", request, null, null,
        { id: "current-code", digest: "b".repeat(64) }, design, state);
      assert.equal(context.request.message, message);
      assert.deepEqual(context.requests, [request]);
      assert.deepEqual(context.design.binding, design.binding);
      assert.deepEqual(context.design.content, design.content);
      assert.deepEqual(context.instructions, [...humanLoopPrompts.shared, ...humanLoopPrompts.roles.router]);
      assert.equal(context.cycle, null);
    });
  }
});
