import assert from "node:assert/strict";
import { test } from "node:test";
import {
    applyRequirementsAnswerChanges, requirementsAnswerChangesSchema, requirementsAnswerDigest,
    requirementsPromptContext, type RequirementsAnswerChanges,
} from "../src/requirements-reconciliation.js";
import { buildRequirementsAnswerPrompt } from "../src/planning-prompts.js";
import type { TandemState } from "../src/types.js";
import type { DecisionNode } from "../src/workflow.js";
import { extensionHarness } from "./helpers/extension-harness.js";

const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
function decision(index: number): DecisionNode {
    const id = `decision-${index}`;
    return {
        id, title: `Decision ${index}: review the intended workflow`,
        dependencies: index === 1 ? ["decision-0"] : index === 2 ? ["decision-1"] : [],
        answer: null, status: "toAnswer",
        question: {
            id, text: `Which behavior should workflow ${index} use?`,
            rationale: "Make this workflow predictable without adding unrelated scope.",
            choices: ["Keep the default behavior", "Use the alternative behavior", "Use the minimal behavior"],
            recommended: "Keep the default behavior", allowFreeText: true, answerPlaceholder: "Describe the intended behavior",
        },
    };
}
function changes(): RequirementsAnswerChanges {
    return { upsert: [], assumptions: { add: [], remove: [] }, deferred: { add: [], remove: [] }, prototypeApproach: null };
}
function replacement(node: DecisionNode) {
    return { id: node.id, title: node.title, dependencies: [...node.dependencies], question: { ...node.question! } };
}
function initialState(h: Awaited<ReturnType<typeof extensionHarness>>) {
    const state = h.api.createState("sample", "Build a local workflow tracker.");
    state.stage = state.lifecycle.currentStage = "requirements";
    state.lifecycle.completedStages = ["prepare"];
    state.preparation.status = "ready";
    state.preparation.summary = "Existing local tracker; no external dependencies required.";
    state.prototypeApproach = { mode: "build", reason: "Review the GUI." };
    state.requirements = {
        substage: "dag", usageItems: ["I want to create, organize and review my tasks."],
        suggestions: ["I want calendar integration."],
    };
    state.decisionGraph = { nodes: Array.from({ length: 30 }, (_, index) => decision(index)) };
    state.artifacts = [{
        id: "retained-notes", title: "Earlier notes", stage: "prepare", kind: "note", path: "",
        language: "markdown", content: "Retained preparation notes. ".repeat(400), mermaid: "",
    }];
    return state;
}
async function pendingAnswer(h: Awaited<ReturnType<typeof extensionHarness>>) {
    const state = initialState(h);
    const question = state.decisionGraph.nodes[0].question!;
    state.processing = {
        status: "running", action: "answer-decision", requestId: "answer-request", runId: null,
        factoryName: "tandem-process-answer-project", question, answer: "Use the minimal behavior",
        requestedAt: state.updatedAt, completedAt: null, message: "",
    };
    await h.api.persistState(state);
    return {
        prototypeId: "sample", projectRoot: h.root, requestId: "answer-request",
        action: "answer-decision", question, answer: state.processing.answer, state: await h.api.loadState("sample"),
    };
}
function context(args: Awaited<ReturnType<typeof pendingAnswer>>, agent: () => Promise<unknown>) {
    return {
        args, runId: "answer-run", phase() {}, log() {},
        step: (_key: string, work: () => Promise<unknown>) => work(), agent,
    };
}

test("a 30-decision answer uses one tool-free, compact semantic update without rewriting the graph", async (t) => {
    const h = await extensionHarness();
    const entry = await h.api.startServer("focused-answer", "sample", "project:tandem", true);
    try {
        const initial = initialState(h);
        await h.api.persistState(initial);
        const before = await h.api.loadState("sample");
        let calls = 0, promptBytes = 0, schemaBytes = 0;
        h.api.setSession({ ...h.session, rpc: { ...h.session.rpc, workflow: {
            run: async (request: any) => {
                h.requests.push(request);
                const result = await h.api.answerFactory.run({
                    args: request.args, runId: "answer-run", phase() {}, log() {},
                    step: (_key: string, work: () => Promise<unknown>) => work(),
                    agent: async (prompt: string, options: any) => {
                        calls++;
                        assert.equal(options.agent, h.api.textWorkerAgent.name);
                        assert.equal(h.api.textWorkerAgent.tools.length, 0);
                        assert.deepEqual(plain(options.schema), requirementsAnswerChangesSchema);
                        assert.doesNotMatch(prompt, /Retained preparation notes|calendar integration|durableStatePath/);
                        assert.ok(!("artifacts" in request.args.state));
                        assert.ok(!("confirmed" in request.args.state));
                        assert.ok(!("prototypeReview" in request.args.state));
                        promptBytes = Buffer.byteLength(prompt);
                        schemaBytes = Buffer.byteLength(JSON.stringify(options.schema));
                        return changes();
                    },
                });
                return { status: "completed", runId: "answer-run", result };
            },
        } } });
        const response = await fetch(new URL("api/answer", entry.url), {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "answer-decision", questionId: "decision-0", answer: "Use the minimal behavior" }),
        });
        assert.equal(response.status, 202);
        await h.waitForRequests(); await h.api.waitForAnswer("sample");
        const saved = await h.api.loadState("sample");
        assert.equal(saved.processing.status, "success", saved.processing.message);
        assert.equal(calls, 1, "Even an unchanged downstream graph receives semantic review.");
        assert.equal(saved.decisionGraph.nodes.length, 30);
        assert.equal(saved.decisionGraph.nodes[0].answer, "Use the minimal behavior");
        assert.equal(saved.question?.id, "decision-1");
        assert.equal(saved.confirmed.length, 1);
        assert.ok(saved.decisionGraph.nodes.slice(1).every(node => node.answer === null));
        assert.deepEqual(plain(saved.artifacts.find(item => item.id === "retained-notes")), plain(before.artifacts[0]));
        assert.deepEqual(plain(saved.prototypeReview), plain(before.prototypeReview));
        assert.deepEqual(plain(saved.requirements), plain(before.requirements));
        assert.equal(saved.previewUrl, null);
        assert.equal(saved.lifecycle.currentStage, "requirements");
        assert.equal(saved.jobOwner, null);
        const responseBytes = Buffer.byteLength(JSON.stringify(changes()));
        assert.ok(promptBytes < 15_000, `Prompt was ${promptBytes} bytes; the full-state baseline was 44,647.`);
        assert.ok(schemaBytes < 2_500, `Schema was ${schemaBytes} bytes; the full-state baseline was 5,948.`);
        assert.ok(responseBytes < 200, "Unchanged downstream decisions must not require a full 14KB graph response.");
        t.diagnostic(JSON.stringify({ promptBytes, schemaBytes, responseBytes }));
    } finally {
        clearInterval(entry.heartbeat);
        await new Promise<void>((resolve, reject) => entry.server.close(error => error ? reject(error) : resolve()));
        await h.close();
    }
});

test("focused answers update dependent questions and allow necessary new decisions without touching independent answers", async () => {
    const h = await extensionHarness();
    try {
        const state = initialState(h);
        state.decisionGraph.nodes[3].answer = "An independent accepted constraint";
        state.assumed = ["Retained assumption"];
        state.deferred = ["Resolved by this answer"];
        const child = replacement(state.decisionGraph.nodes[1]);
        child.question.text = "Which behavior fits the custom answer?";
        child.dependencies.push("new-boundary");
        const added = { ...replacement(decision(30)), id: "new-boundary", dependencies: ["decision-0"],
            question: { ...decision(30).question!, id: "new-boundary" } };
        const update = { ...changes(), upsert: [child, added],
            assumptions: { add: ["New explicit assumption"], remove: [] },
            deferred: { add: [], remove: ["Resolved by this answer"] } };
        const next = applyRequirementsAnswerChanges(state, update, "decision-0", "Custom intent", false);
        assert.equal(next.decisionGraph.nodes.length, 31);
        assert.equal(next.decisionGraph.nodes[0].answer, "Custom intent");
        assert.equal(next.decisionGraph.nodes[1].question?.text, child.question.text);
        assert.equal(next.decisionGraph.nodes[3].answer, state.decisionGraph.nodes[3].answer);
        assert.equal(next.decisionGraph.nodes[30].answer, null);
        assert.deepEqual(next.assumed, ["Retained assumption", "New explicit assumption"]);
        assert.deepEqual(next.deferred, []);
        assert.equal(state.decisionGraph.nodes[0].answer, null, "Applying a patch cannot mutate its frozen inputs.");
    } finally { await h.close(); }
});

test("changing an answer reopens every descendant even when semantic review needs no wording changes", async () => {
    const h = await extensionHarness();
    try {
        const state = initialState(h);
        for (const node of state.decisionGraph.nodes) node.answer = `Accepted ${node.id}`;
        const next = applyRequirementsAnswerChanges(state, changes(), "decision-0", "New custom intent", true);
        assert.deepEqual(next.decisionGraph.nodes.slice(0, 4).map(node => node.answer), [
            "New custom intent", null, null, "Accepted decision-3",
        ]);
    } finally { await h.close(); }
});

test("focused patches reject fabricated answers, independent rewrites, malformed questions and invalid topology", async () => {
    const h = await extensionHarness();
    try {
        const state = initialState(h);
        const child = replacement(state.decisionGraph.nodes[1]);
        for (const invalid of [
            { ...changes(), answer: "Invented" },
            { ...changes(), upsert: [{ ...child, answer: "Invented" }] },
            { ...changes(), upsert: [replacement(state.decisionGraph.nodes[0])] },
            { ...changes(), upsert: [replacement(state.decisionGraph.nodes[3])] },
            { ...changes(), upsert: [child, child] },
            { ...changes(), upsert: [{ ...child, dependencies: ["decision-2"] }] },
            { ...changes(), upsert: [{ ...child, dependencies: ["missing"] }] },
            { ...changes(), upsert: [{ ...child, dependencies: ["decision-0", "decision-0"] }] },
            { ...changes(), upsert: [{ ...child, question: { ...child.question, id: "different" } }] },
            { ...changes(), upsert: [{ ...child, question: { ...child.question, recommended: "Unseen choice" } }] },
            { ...changes(), assumptions: { add: [], remove: ["Missing assumption"] } },
            { ...changes(), prototypeApproach: { mode: "not-applicable", reason: "Unsubmitted change" } },
        ]) assert.throws(() => applyRequirementsAnswerChanges(state, invalid, "decision-0", "Custom intent", false));
        state.decisionGraph.nodes = Array.from({ length: 50 }, (_, index) => decision(index));
        assert.throws(() => applyRequirementsAnswerChanges(state, {
            ...changes(), upsert: [replacement(decision(50))],
        }, "decision-0", "Custom intent", false), /50-decision/);
    } finally { await h.close(); }
});

test("tool-free answer inputs retain question meaning and review evidence without repeating unrelated choices", async () => {
    const h = await extensionHarness();
    try {
        const state = initialState(h);
        state.decisionGraph.nodes[3].review = { reason: "Needs independent review", previousAnswer: "Previous custom answer" };
        const input = requirementsPromptContext(state, "decision-0");
        assert.ok(input.decisions.slice(0, 3).every(node => node.question && "choices" in node.question));
        assert.ok(input.decisions.slice(3).every(node => node.question && !("choices" in node.question)));
        assert.equal(input.decisions[3].question?.text, state.decisionGraph.nodes[3].question!.text);
        assert.equal(input.decisions[3].question?.rationale, state.decisionGraph.nodes[3].question!.rationale);
        assert.deepEqual(input.decisions[3].review, state.decisionGraph.nodes[3].review);
        const leafPrompt = buildRequirementsAnswerPrompt({
            state, requestId: "leaf", prototypeId: "sample", action: "answer-decision",
            question: state.decisionGraph.nodes[3].question!, answer: "A custom leaf constraint",
        });
        assert.match(leafPrompt, /A custom leaf constraint/);
        assert.match(leafPrompt, /Never rewrite the submitted node or independent decisions/);
        assert.match(leafPrompt, /Which behavior should workflow 0 use/);
    } finally { await h.close(); }
});

test("prototype approach changes require its explicit answer and cannot start a preview", async () => {
    const h = await extensionHarness();
    try {
        const state = initialState(h);
        const node = decision(0);
        node.id = node.question!.id = "prototype-approach";
        state.decisionGraph = { nodes: [node] };
        state.prototypeApproach = { mode: "undecided", reason: "Needs a decision" };
        assert.throws(() => applyRequirementsAnswerChanges(state, changes(), node.id, "New GUI", false), /did not resolve/);
        const next = applyRequirementsAnswerChanges(state, {
            ...changes(), prototypeApproach: { mode: "build", reason: "The user chose a new GUI." },
        }, node.id, "New GUI", false);
        assert.equal(next.prototypeApproach.mode, "build");
        assert.equal(state.previewUrl, null);
        assert.equal(state.prototypeApproach.mode, "undecided");
    } finally { await h.close(); }
});

test("focused answer results reject stale semantics, generation, stage and submitted answers", async (t) => {
    const mutations: Record<string, (state: TandemState) => void> = {
        goal: state => { state.goal = "Changed scope"; },
        question: state => { state.decisionGraph.nodes[1].question!.text = "A newer question"; },
        answer: state => { state.processing.answer = "A different submitted answer"; },
        action: state => { state.processing.action = "change-answer"; },
        generation: state => { state.generation = "new-generation"; },
        stage: state => { state.stage = state.lifecycle.currentStage = "sketch"; state.lifecycle.completedStages.push("requirements"); },
    };
    for (const [name, mutate] of Object.entries(mutations)) await t.test(name, async () => {
        const h = await extensionHarness();
        try {
            const args = await pendingAnswer(h);
            const result = await h.api.answerFactory.run(context(args, async () => changes()));
            const current = await h.api.loadState("sample");
            mutate(current);
            await h.api.persistState(current);
            await assert.rejects(h.api.applyFactoryResult("sample", args.requestId, {
                status: "completed", runId: "answer-run", result,
            }), /changed|older generation|active stage/);
            assert.equal((await h.api.loadState("sample")).decisionGraph.nodes[0].answer, null);
        } finally { await h.close(); }
    });
});

test("stale answer inputs fail before launching a worker, and durable replay never consumes a legacy full-state step", async () => {
    const h = await extensionHarness();
    try {
        const args = await pendingAnswer(h);
        const stale = { ...args, state: { ...args.state, goal: "Old scope" } };
        await assert.rejects(h.api.answerFactory.run(context(stale, async () => assert.fail("No stale worker may run."))), /frozen Requirements/);
        let calls = 0;
        const journal = new Map<string, unknown>([["process-answer", { status: "Legacy full-state result" }]]);
        const ctx = {
            ...context(args, async () => { calls++; return changes(); }),
            step: async (key: string, work: () => Promise<unknown>) => {
                if (!journal.has(key)) journal.set(key, await work());
                return journal.get(key);
            },
        };
        const result = await h.api.answerFactory.run(ctx);
        assert.deepEqual(await h.api.answerFactory.run(ctx), result);
        assert.equal(calls, 1);
        assert.ok(journal.has("answer-request:reconcile-answer-v1"));
        assert.equal((result as any).inputDigest, requirementsAnswerDigest(args.state, args.question.id, args.answer, false));
        await h.api.applyFactoryResult("sample", args.requestId, { status: "completed", runId: "answer-run", result });
        const reopened = await extensionHarness({}, h.root);
        try {
            assert.equal((await reopened.api.loadState("sample")).decisionGraph.nodes[0].answer, args.answer);
        } finally { await reopened.close(); }
    } finally { await h.close(); }
});

test("already-running legacy full-state answer results remain recoverable", async () => {
    const h = await extensionHarness();
    try {
        const args = await pendingAnswer(h);
        const current = await h.api.loadState("sample");
        current.processing.runId = "legacy-run";
        await h.api.persistState(current);
        await h.api.applyFactoryResult("sample", args.requestId, {
            status: "completed", runId: "legacy-run",
            result: { ...args.state, artifactChanges: { upsert: [], remove: [] } },
        });
        const saved = await h.api.loadState("sample");
        assert.equal(saved.processing.status, "success");
        assert.equal(saved.decisionGraph.nodes[0].answer, args.answer);
        assert.equal(saved.decisionGraph.nodes.length, 30);
    } finally { await h.close(); }
});
