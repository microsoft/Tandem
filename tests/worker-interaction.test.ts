import assert from "node:assert/strict";
import { test } from "node:test";
import {
    buildPreparationIntentPrompt, buildPreparationHandoffPrompt,
    buildPreparationSourcesPrompt, buildPreparationWorkspacePrompt, buildUsageSuggestionsPrompt,
    buildRequirementsResearchPrompt, tandemWorkerInteractionRules,
} from "../src/planning-prompts.js";
import { extensionHarness } from "./helpers/extension-harness.js";

test("preparation and intent workers defer product interviews through the shared production policy", () => {
    const args = { goal: "Build a coffee shop website", projectRoot: "workspace" };
    const workspace = { summary: "Empty workspace", checks: [] };
    const sources = { summary: "No external sources needed", sources: [] };
    const prompts = [
        buildPreparationWorkspacePrompt(args),
        buildPreparationSourcesPrompt(args, workspace),
        buildPreparationHandoffPrompt(args, workspace, sources),
        buildPreparationIntentPrompt(args, workspace),
        buildUsageSuggestionsPrompt({ goal: args.goal, usageItems: [] }),
    ];
    for (const prompt of prompts) {
        assert.ok(prompt.includes(tandemWorkerInteractionRules));
        assert.match(prompt, /Do not call ask_user, ask_user_question/);
        assert.match(prompt, /Never invent a user answer/);
    }
    assert.match(prompts[0], /The goal is sufficient to begin/);
    assert.match(prompts[1], /Do not interview the user for product scope/);
    assert.match(prompts[2], /Suggested usages\nare optional proposals, never accepted requirements/);
    assert.match(prompts[4], /Do not\nassume extra locations, ordering, payments/);
    assert.match(tandemWorkerInteractionRules, /short user-facing sentence at meaningful milestones/);
    assert.match(tandemWorkerInteractionRules, /Never prepend or mix/);
    assert.match(tandemWorkerInteractionRules, /no separate progress channel, keep the result format pure/);
    assert.match(tandemWorkerInteractionRules, /private\nreasoning, prompts or credentials/);
});

test("research is scoped to accepted usages and separated from implementation and decisions", () => {
    const prompt = buildRequirementsResearchPrompt({
        goal: "Build a coffee shop website",
        usageItems: ["I want to view the drinks menu."],
        preparation: { summary: "No existing application", checks: [], sources: [] },
    });
    assert.ok(prompt.includes(tandemWorkerInteractionRules));
    assert.match(prompt, /accepted usageItems and explicit goal constraints define the scope/);
    assert.match(prompt, /Do not add features, accept decisions, or research unselected suggestions/);
    assert.match(prompt, /at most four source calls total/);
    assert.match(prompt, /Defer stack selection, runtime\nchecks and implementation details to Development/);
    assert.match(prompt, /Do not edit files, install dependencies, start servers/);
    assert.match(prompt, /Findings inform questions; they are not accepted requirements/);
    assert.match(prompt, /I want to view the drinks menu/);
});

test("usage suggestion generation selects the tool-free worker and returns proposals without an interview", async () => {
    const h = await extensionHarness();
    try {
        assert.equal(h.api.textWorkerAgent.infer, false, "the parent chat must not be routed to this worker");
        assert.equal(h.api.textWorkerAgent.tools.length, 0);
        assert.equal(h.api.textWorkerAgent.prompt, tandemWorkerInteractionRules);
        const args = {
            prototypeId: "sample", requestId: "usage-suggestions",
            goal: "Build a coffee shop website", usageItems: ["I want to find opening hours."],
        };
        const expected = { suggestions: ["I want to browse the drinks menu."] };
        let calls = 0;
        const result = await h.api.usageSuggestionFactory.run({
            args, phase() {}, log() {},
            agent: async (prompt: string, options: { agent?: string }) => {
                calls++;
                assert.equal(options.agent, h.api.textWorkerAgent.name);
                assert.equal(prompt, buildUsageSuggestionsPrompt(args));
                return expected;
            },
        });
        assert.equal(result, expected);
        assert.equal(calls, 1);
        assert.deepEqual(args.usageItems, ["I want to find opening hours."]);
    } finally { await h.close(); }
});

test("Requirements decision workers use tracked questions, never direct question tools", async () => {
    const h = await extensionHarness();
    try {
        const state = h.api.createState("sample", "Build a coffee shop website");
        state.requirements.usageItems = ["I want to find opening hours."];
        for (const action of ["generate-dag", "answer-decision", "change-answer", "apply-defaults"]) {
            const prompt = h.api.answerFactoryPrompt({
                prototypeId: "sample", projectRoot: h.root, state, action,
                question: { id: "locations", text: "How many locations?" }, answer: "One location",
            });
            assert.ok(prompt.includes(tandemWorkerInteractionRules));
            assert.match(prompt, /I want to find opening hours/);
        }
    } finally { await h.close(); }
});
