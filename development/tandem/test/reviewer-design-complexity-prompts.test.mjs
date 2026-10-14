import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { humanLoopPrompts } from "../public/prompts/human-loop.js";
import { designGenerationContract, designReferenceCatalog } from "../public/sketch/design-contract.js";
import { evaluateWrapper, promptCases } from "./helpers/human-loop-prompt-fixture.mjs";

test("Reviewer examines complete Design conformance and material over-engineering, not a third quality audit", () => {
  const instructions = humanLoopPrompts.roles.reviewer.join("\n");
  for (const phrase of [
    "Review has exactly two responsibilities",
    "COMPLETE canonical agreed Design",
    "backbone, state machine, authoritative state, ownership, contracts and interactions",
    "OVER-ENGINEERING beyond current agreed outcomes",
    "General bug hunting, test-coverage audits and correctness verification are not Review responsibilities",
    "concrete implementation evidence, the present requirement or responsibility boundary",
    "a material consequence and a supported simpler alternative when available",
    "exact producing designRefs",
    "do not repair code, rewrite Design, assume consent or start follow-on work",
  ]) assert.ok(instructions.includes(phrase), phrase);
});

test("Reviewer excludes routine undocumented details and plan variation from approval demands", () => {
  const instructions = humanLoopPrompts.roles.reviewer.join("\n");
  assert.match(instructions, /Unmentioned ordinary implementation details, extra files, forecast deviations and necessary safeguards are not automatically findings/);
  assert.match(instructions, /Do not invent an alternative or demand agreement for every helper/);
  assert.match(instructions, /no automatic Design rewrite, repair or follow-on role/);
  assert.match(instructions, /Safe, robust and future-proof are not blanket authorization/);
});

test("controlled Reviewer packets carry both dimensions with exact Design context and absent-Design limits", async () => {
  const runtime = await readFile(new URL("../src/human-loop-runtime.mjs", import.meta.url), "utf8");
  const transport = await readFile(new URL("../src/human-loop-transport.mjs", import.meta.url), "utf8");
  const cases = await promptCases(runtime, { designGenerationContract, designReferenceCatalog, humanLoopPrompts });
  for (const { name, packet } of cases.filter(({ name }) => name.startsWith("reviewer:"))) {
    const prompt = evaluateWrapper(transport, packet, humanLoopPrompts);
    assert.match(prompt, /Review has exactly two responsibilities/);
    assert.match(prompt, /Unmentioned ordinary implementation details/);
    assert.match(prompt, /If agreed Design is missing, disclose that limitation; do not substitute a plan or invent requirements/);
    assert.deepEqual(packet.binding.design, packet.context.design.binding, name);
    assert.deepEqual(packet.context.instructions, [...humanLoopPrompts.shared, ...humanLoopPrompts.roles.reviewer]);
    assert.equal(prompt.split("\n").at(-1), JSON.stringify(packet));
  }
});
