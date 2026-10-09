import assert from "node:assert/strict";
import { test } from "node:test";
import { extensionHarness } from "./helpers/extension-harness.js";

function decision(id: string, answer: string | null = null) {
    return {
        id, title: id, answer, dependencies: [], status: answer ? "answered" : "active",
        question: { id, text: `Choose ${id}`, choices: ["Recommended", "Alternative", "Minimal"],
            recommended: "Recommended", allowFreeText: true },
    };
}

test("DAG generation does not turn usage intake into a decision, and a rejected worker can be retried", async () => {
    const h = await extensionHarness();
    const entry = await h.api.startServer("dag-view", "sample", "project:tandem", true);
    try {
        const initial = h.api.createState("sample", "Explore a model");
        initial.stage = "requirements";
        initial.lifecycle.currentStage = "requirements";
        initial.lifecycle.completedStages = ["prepare"];
        initial.preparation.status = "ready";
        initial.prototypeApproach = { mode: "build", reason: "A new interface" };
        initial.requirements.usageItems = ["I want to explore the exterior."];
        // Reproduce the intake placeholder left by an older failed generation.
        initial.decisionGraph = { nodes: [decision("usage-intake")] };
        initial.question = { ...initial.question!, id: "usage-intake", text: "Add usages" };
        await h.api.persistState(initial);
        let fail = true;
        let attempts = 0;
        h.api.setSession({ ...h.session, rpc: { ...h.session.rpc, workflow: {
            run: async (request: any) => {
                h.requests.push(request);
                attempts++;
                assert.equal(request.args.state.decisionGraph.nodes.length, 0);
                assert.deepEqual(Array.from(request.args.state.requirements.usageItems), initial.requirements.usageItems);
                const result = {
                    ...request.args.state,
                    requirements: { substage: "dag", usageItems: ["Worker rewrote scope"], suggestions: [] },
                    decisionGraph: { nodes: [decision("fidelity", fail ? "Worker-selected answer" : null), decision("navigation")] },
                    question: decision("fidelity").question,
                    artifactChanges: { upsert: [], remove: [] },
                };
                const runId = `dag-run-${attempts}`;
                try {
                    const accepted = await h.api.answerFactory.run({
                        args: request.args, runId,
                        phase() {}, log() {},
                        step: (_name: string, run: () => Promise<unknown>) => run(),
                        agent: async () => result,
                    });
                    return { status: "completed", runId, result: accepted };
                } catch (error) {
                    return { status: "failed", runId, error: (error as Error).message };
                }
            },
        } } });
        const generate = async () => {
            const response = await fetch(new URL("api/answer", entry.url), {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ questionId: "usage-intake", action: "generate-dag", answer: "Generate the DAG." }),
            });
            assert.equal(response.status, 202);
            await h.waitForRequests(attempts || 1);
            await h.api.waitForAnswer("sample");
        };
        await generate();
        const failed = await h.api.loadState("sample");
        assert.equal(failed.processing!.status, "error");
        assert.match(failed.processing!.message, /answered by the user/);
        assert.equal(failed.requirements.substage, "usage");
        assert.equal(failed.decisionGraph.nodes.length, 0);
        assert.equal(failed.jobOwner, null);
        assert.deepEqual(Array.from(failed.requirements.usageItems), initial.requirements.usageItems);
        fail = false;
        await generate();
        const ready = await h.api.loadState("sample");
        assert.equal(attempts, 2);
        assert.equal(ready.processing!.status, "success", ready.status);
        assert.equal(ready.requirements.substage, "dag");
        assert.equal(ready.question!.id, "fidelity");
        assert.equal(ready.decisionGraph.nodes[0].status, "active");
        assert.ok(ready.decisionGraph.nodes.every((node) => node.answer === null));
        assert.deepEqual(Array.from(ready.requirements.usageItems), initial.requirements.usageItems);
        const snapshot = await fetch(new URL("api/state", entry.url)).then((result) => result.json()) as any;
        assert.equal(snapshot.requirements.substage, "dag");
        assert.equal(snapshot.processing.status, "success");
        assert.equal(snapshot.revision, ready.revision);
    } finally {
        clearInterval(entry.heartbeat);
        await new Promise<void>((resolve, reject) => entry.server.close((error) => error ? reject(error) : resolve()));
        await h.close();
    }
});

test("generation validation still rejects intake nodes and invented answers at the persistence boundary", async () => {
    const h = await extensionHarness();
    try {
        const pending = h.api.createState("sample", "Goal");
        pending.stage = "requirements";
        pending.lifecycle.currentStage = "requirements";
        pending.prototypeApproach = { mode: "build", reason: "New GUI" };
        pending.requirements.usageItems = ["I want to explore."];
        pending.processing = {
            action: "generate-dag", status: "running", requestId: "request", runId: "run",
            factoryName: "tandem-process-answer-project", message: "", answer: "Generate.",
            question: pending.question, requestedAt: new Date().toISOString(), completedAt: null,
            originalDecisionGraph: null,
        };
        await h.api.persistState(pending);
        for (const [nodes, error] of [
            [[decision("usage-intake"), decision("real-decision")], /Usage intake is not/],
            [[decision("fidelity", "Invented"), decision("next")], /answered by the user/],
            [[], /did not contain any decisions/],
        ] as const) {
            await assert.rejects(h.api.applyFactoryResult("sample", "request", {
                status: "completed", runId: "run", result: {
                    ...pending, decisionGraph: { nodes }, question: null,
                },
            }), error);
            assert.equal((await h.api.loadState("sample")).requirements.substage, "usage");
        }
    } finally { await h.close(); }
});

test("generation prompts distinguish commands from authoritative decision answers", async () => {
    const h = await extensionHarness();
    try {
        const state = h.api.createState("sample", "Goal");
        const args = {
            prototypeId: "sample", projectRoot: h.root, state,
            question: { id: "usage-intake", text: "Add usages" }, answer: "Generate the DAG.",
        };
        const prompt = h.api.answerFactoryPrompt({ ...args, action: "generate-dag" });
        assert.match(prompt, /Set answer\nto null on EVERY generated node/);
        assert.match(prompt, /Do not copy the usage-intake question or node/);
        assert.match(prompt, /Unselected suggestions\nare not scope/);
        assert.match(prompt, /Do not conduct a separate interview/);
        assert.match(prompt, /Defer exact business names, hours, addresses/);
        assert.doesNotMatch(prompt, /Ask exactly one next high-impact question/);
        assert.doesNotMatch(prompt, /Include the submitted answer|Treat the answer as an authoritative/);
        const answerPrompt = h.api.answerFactoryPrompt({ ...args, action: "answer-decision" });
        assert.match(answerPrompt, /Include the submitted answer only on its matching decision node/);
    } finally { await h.close(); }
});

test("usage intents are saved immediately without accepting suggestions or waiting for a background interview", async () => {
    const h = await extensionHarness();
    const entry = await h.api.startServer("intent-entry", "sample", "project:tandem", true);
    try {
        const initial = h.api.createState("sample", "Build a coffee shop website");
        initial.stage = "requirements";
        initial.lifecycle.currentStage = "requirements";
        initial.lifecycle.completedStages = ["prepare"];
        initial.preparation.status = "ready";
        initial.requirements.suggestions = ["I want to order coffee online."];
        await h.api.persistState(initial);
        const intents = ["I want to find the shop's opening hours.", "I want to browse the drinks menu."];
        for (const [index, intent] of intents.entries()) {
            const response = await fetch(new URL("api/answer", entry.url), {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ questionId: "usage-intake", action: "add-usage", answer: intent }),
                signal: AbortSignal.timeout(5_000),
            });
            assert.equal(response.status, 202);
            await h.waitForRequests(index + 1);
            const saved = await h.api.loadState("sample");
            assert.deepEqual(Array.from(saved.requirements.usageItems), intents.slice(0, index + 1));
            assert.equal(saved.requirements.substage, "usage");
            assert.equal(saved.decisionGraph.nodes.length, 0);
            assert.equal(saved.suggestionProcessing?.status, "running");
        }
        const saved = await h.api.loadState("sample");
        assert.ok(!saved.requirements.usageItems.includes(initial.requirements.suggestions[0]));
        assert.deepEqual(Array.from(saved.confirmed), []);
    } finally {
        clearInterval(entry.heartbeat);
        await new Promise<void>((resolve, reject) => entry.server.close((error) => error ? reject(error) : resolve()));
        await h.close();
    }
});
