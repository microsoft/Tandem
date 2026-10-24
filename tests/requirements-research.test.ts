import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRequirementsResearchPrompt } from "../src/planning-prompts.js";
import {
    requirementsResearchInput, requirementsResearchIsCurrent, type ResearchAnalysis,
} from "../src/requirements-research.js";
import { requirementsResearchDigest } from "../src/requirements-reconciliation.js";
import type { TandemState } from "../src/types.js";
import { extensionHarness } from "./helpers/extension-harness.js";

const findings: ResearchAnalysis = {
    summary: "Declined payments can require a retry or a different payment method.",
    checks: [{ label: "Live payment credentials", status: "deferred", detail: "Use mocks; live execution belongs to Development." }],
    sources: [{ title: "Declines reference", url: "https://docs.stripe.com/declines", purpose: "Choices for the accepted decline-recovery usage" }],
};

async function pendingResearch(h: Awaited<ReturnType<typeof extensionHarness>>) {
    const initial = h.api.createState("sample", "Build a checkout using Stripe");
    initial.stage = initial.lifecycle.currentStage = "requirements";
    initial.lifecycle.completedStages = ["prepare"];
    initial.preparation.status = "ready";
    initial.preparation.summary = "An existing mock checkout provides local context.";
    initial.preparation.sources = [{ title: "Stripe overview", url: "https://docs.stripe.com/", purpose: "Goal comprehension" }];
    initial.prototypeApproach = { mode: "build", reason: "Review the checkout flow." };
    initial.requirements.usageItems = ["I want to recover from a declined payment."];
    initial.requirements.suggestions = ["I want to manage a subscription."];
    initial.processing = {
        action: "generate-dag", status: "running", requestId: "research-request", runId: null,
        factoryName: "tandem-process-answer-project", message: "", answer: "Generate requirements DAG.",
        question: initial.question, requestedAt: new Date().toISOString(), completedAt: null,
        originalDecisionGraph: null,
    };
    await h.api.persistState(initial);
    const state = await h.api.loadState("sample");
    return {
        prototypeId: "sample", projectRoot: h.root, requestId: "research-request", state,
        question: { id: "usage-intake", text: "How do you want to use this deliverable?" },
        answer: "Generate requirements DAG.", action: "generate-dag",
    };
}

function dagResult(state: TandemState) {
    return {
        nodes: [{
            id: "decline-recovery", title: "Decline recovery", dependencies: [],
            question: {
                id: "decline-recovery", text: "How should a declined payment be retried?",
                rationale: "Make recovery explicit.", answerPlaceholder: "",
                choices: ["Retry or change method", "Change method only", "Contact support"],
                recommended: "Retry or change method", allowFreeText: true,
            },
        }],
        assumed: state.assumed, deferred: state.deferred,
    };
}

test("accepted-usage research precedes tool-free questions, survives replay and persists its exact identities", async () => {
    const h = await extensionHarness();
    try {
        const args = await pendingResearch(h);
        const labels: string[] = [];
        const phases: string[] = [];
        const journal = new Map<string, unknown>([["process-answer", dagResult(args.state)]]);
        const context = {
            args, runId: "research-run", phase: (title: string) => phases.push(title), log() {},
            step: async (key: string, work: () => Promise<unknown>) => {
                if (!journal.has(key)) journal.set(key, await work());
                return journal.get(key);
            },
            agent: async (prompt: string, options: { label: string; agent?: string }) => {
                labels.push(options.label);
                const saved = await h.api.loadState("sample");
                if (options.label === "Research accepted usages") {
                    assert.equal(options.agent, undefined);
                    assert.equal(prompt, buildRequirementsResearchPrompt(requirementsResearchInput(args.state)));
                    assert.match(prompt, /I want to recover from a declined payment/);
                    assert.doesNotMatch(prompt, /I want to manage a subscription/);
                    assert.match(prompt, /Stripe overview/);
                    assert.match(saved.status, /Researching missing facts/);
                    assert.equal(saved.requirements.research, undefined);
                    return findings;
                }
                assert.equal(options.agent, h.api.textWorkerAgent.name);
                assert.equal(h.api.textWorkerAgent.tools.length, 0);
                assert.match(prompt, /Declined payments can require a retry/);
                assert.match(saved.status, /Research findings are saved/);
                assert.equal(saved.requirements.substage, "usage");
                assert.equal(saved.requirements.research?.requestId, args.requestId);
                assert.equal(saved.requirements.research?.runId, context.runId);
                assert.equal(saved.requirements.research?.generation, args.state.generation);
                assert.ok(requirementsResearchIsCurrent(saved));
                assert.deepEqual(Array.from(saved.confirmed), []);
                return dagResult(args.state);
            },
        };
        const result = await h.api.answerFactory.run(context);
        assert.deepEqual(labels, ["Research accepted usages", "Process Tandem answer"]);
        assert.ok(journal.has(`${args.requestId}:generate-researched-dag-v2`), "legacy question steps cannot bypass the focused output contract");
        assert.deepEqual(phases, ["Research accepted usages", "Interpret decision", "Return Tandem update"]);
        const recorded = (await h.api.loadState("sample")).requirements.research!;
        assert.deepEqual(await h.api.answerFactory.run(context), result);
        assert.equal(labels.length, 2, "durable replay cannot repeat research or question generation");
        assert.equal((await h.api.loadState("sample")).requirements.research?.completedAt, recorded.completedAt);
        await h.api.applyFactoryResult("sample", args.requestId, { status: "completed", runId: context.runId, result });

        const reopened = await extensionHarness({}, h.root);
        try {
            const ready = await reopened.api.loadState("sample");
            assert.equal(ready.requirements.substage, "dag");
            assert.deepEqual(JSON.parse(JSON.stringify(ready.requirements.research)), JSON.parse(JSON.stringify(recorded)));
            assert.deepEqual(Array.from(ready.requirements.usageItems), Array.from(args.state.requirements.usageItems));
            assert.equal(ready.decisionGraph.nodes[0].answer, null);
            assert.equal(ready.decisionGraph.nodes[0].status, "active");
            assert.deepEqual(Array.from(ready.confirmed), []);
            assert.equal(ready.preparation.sources[0].title, "Stripe overview", "Requirements does not replace Preparation history");
        } finally { await reopened.close(); }
    } finally { await h.close(); }
});

test("failed research preserves usages and exposes the existing retry path without generating questions", async () => {
    const h = await extensionHarness();
    const entry = await h.api.startServer("research-failure", "sample", "project:tandem", true);
    try {
        const args = await pendingResearch(h);
        await h.api.persistState({ ...args.state, processing: null });
        let calls = 0;
        h.api.setSession({ ...h.session, rpc: { ...h.session.rpc, workflow: {
            run: async (request: { args: unknown }) => {
                h.requests.push(request);
                const runId = "failed-research-run";
                try {
                    await h.api.answerFactory.run({
                        args: request.args, runId, phase() {}, log() {},
                        step: (_key: string, work: () => Promise<unknown>) => work(),
                        agent: async (_prompt: string, options: { label: string }) => {
                            calls++;
                            assert.equal(options.label, "Research accepted usages");
                            throw new Error("Authoritative source lookup was denied.");
                        },
                    });
                    assert.fail("Research must not report success.");
                } catch (error) {
                    return { status: "failed", runId, error: (error as Error).message };
                }
            },
        } } });
        const response = await fetch(new URL("api/answer", entry.url), {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "generate-dag", questionId: "usage-intake", answer: "Generate requirements DAG." }),
        });
        assert.equal(response.status, 202);
        await h.waitForRequests();
        await h.api.waitForAnswer("sample");
        const failed = await h.api.loadState("sample");
        assert.equal(calls, 1);
        assert.equal(failed.processing.status, "error");
        assert.match(failed.processing.message, /source lookup was denied/);
        assert.equal(failed.requirements.substage, "usage");
        assert.equal(failed.requirements.research, undefined);
        assert.deepEqual(Array.from(failed.requirements.usageItems), Array.from(args.state.requirements.usageItems));
        assert.equal(failed.decisionGraph.nodes.length, 0);
        assert.equal(failed.jobOwner, null);
    } finally {
        clearInterval(entry.heartbeat);
        await new Promise<void>((resolve, reject) => entry.server.close(error => error ? reject(error) : resolve()));
        await h.close();
    }
});

test("research cannot persist against changed usages, goal, source context or request ownership", async (t) => {
    const changes: Record<string, (state: TandemState) => void> = {
        usages: state => { state.requirements.usageItems.push("I want another capability."); },
        goal: state => { state.goal = "A different project"; },
        context: state => { state.preparation.summary = "New source context"; },
        sources: state => { state.preparation.sources = []; },
        generation: state => { state.generation = "new-generation"; },
        request: state => { state.processing.requestId = "new-request"; },
        run: state => { state.processing.runId = "new-run"; },
        cancelled: state => { state.processing.status = "error"; },
    };
    for (const [name, change] of Object.entries(changes)) await t.test(name, async () => {
        const h = await extensionHarness();
        try {
            const args = await pendingResearch(h);
            let calls = 0;
            await assert.rejects(h.api.answerFactory.run({
                args, runId: "research-run", phase() {}, log() {},
                step: (_key: string, work: () => Promise<unknown>) => work(),
                agent: async () => {
                    calls++;
                    const changed = await h.api.loadState("sample");
                    change(changed);
                    await h.api.persistState(changed);
                    return findings;
                },
            }), /no longer owns/);
            assert.equal(calls, 1);
            assert.equal((await h.api.loadState("sample")).requirements.research, undefined);
            assert.equal((await h.api.loadState("sample")).decisionGraph.nodes.length, 0);
        } finally { await h.close(); }
    });
});

test("research requires accepted usages and rejects malformed or unsafe findings rather than falling back", async (t) => {
    const invalid = [
        { summary: "Missing sources and checks" },
        { ...findings, passed: true },
        { ...findings, sources: [{ ...findings.sources[0], url: "javascript:alert(1)" }] },
        { ...findings, sources: [{ ...findings.sources[0], url: "https://user@example.com/reference" }] },
        { ...findings, checks: [{ label: "Lookup", status: "success", detail: "Not a supported check status" }] },
    ];
    for (const [index, analysis] of invalid.entries()) await t.test(`invalid findings ${index + 1}`, async () => {
        const h = await extensionHarness();
        try {
            const args = await pendingResearch(h);
            let calls = 0;
            await assert.rejects(h.api.answerFactory.run({
                args, runId: "research-run", phase() {}, log() {},
                step: (_key: string, work: () => Promise<unknown>) => work(),
                agent: async () => { calls++; return analysis; },
            }), /research|Research/);
            assert.equal(calls, 1);
            assert.equal((await h.api.loadState("sample")).requirements.research, undefined);
        } finally { await h.close(); }
    });
    await t.test("no accepted usages", async () => {
        const h = await extensionHarness();
        try {
            const args = await pendingResearch(h);
            args.state.requirements.usageItems = [];
            await h.api.persistState(args.state);
            await assert.rejects(h.api.answerFactory.run({
                args, runId: "research-run", phase() {}, log() {},
                step: (_key: string, work: () => Promise<unknown>) => work(),
                agent: async () => assert.fail("No worker may run without accepted usages."),
            }), /accepted usages/);
        } finally { await h.close(); }
    });
});

test("question persistence rejects changed research inputs even after question generation", async () => {
    const h = await extensionHarness();
    try {
        const args = await pendingResearch(h);
        const result = await h.api.answerFactory.run({
            args, runId: "research-run", phase() {}, log() {},
            step: (_key: string, work: () => Promise<unknown>) => work(),
            agent: async (_prompt: string, options: { label: string }) =>
                options.label === "Research accepted usages" ? findings : dagResult(args.state),
        });
        const current = await h.api.loadState("sample");
        current.requirements.usageItems.push("I want to save payment methods.");
        await h.api.persistState(current);
        await assert.rejects(h.api.applyFactoryResult("sample", args.requestId, {
            status: "completed", runId: "research-run", result,
        }), /no matching research result/);
        const saved = await h.api.loadState("sample");
        assert.equal(saved.requirements.substage, "usage");
        assert.equal(saved.decisionGraph.nodes.length, 0);
        assert.equal(requirementsResearchIsCurrent(saved), false);
        assert.equal(saved.requirements.research?.requestId, args.requestId);
    } finally { await h.close(); }
});

test("reusing matching research skips its worker and retains exact source, request, run and completion identities", async () => {
    const h = await extensionHarness();
    try {
        const args = await pendingResearch(h);
        const retained = {
            ...findings, input: requirementsResearchInput(args.state), generation: args.state.generation,
            requestId: "original-request", runId: "original-run", completedAt: "2026-10-01T00:00:00.000Z",
        };
        args.state.requirements.research = retained;
        await h.api.persistState(args.state);
        let calls = 0;
        const result = await h.api.answerFactory.run({
            args, runId: "retry-run", phase() {}, log() {},
            step: (_key: string, work: () => Promise<unknown>) => work(),
            agent: async (_prompt: string, options: { label: string }) => {
                calls++;
                assert.equal(options.label, "Process Tandem answer");
                return dagResult(args.state);
            },
        });
        assert.equal(calls, 1);
        assert.equal((result as any).researchDigest, requirementsResearchDigest(retained));
        await h.api.applyFactoryResult("sample", args.requestId, { status: "completed", runId: "retry-run", result });
        const saved = await h.api.loadState("sample");
        assert.equal(saved.requirements.substage, "dag");
        assert.deepEqual(JSON.parse(JSON.stringify(saved.requirements.research)), JSON.parse(JSON.stringify(retained)));
        assert.equal(saved.processing.runId, "retry-run");
    } finally { await h.close(); }
});

test("changed usages, goal, Preparation evidence or generation cannot reuse earlier research", async (t) => {
    const mutations: Record<string, (state: TandemState) => void> = {
        usages: state => { state.requirements.usageItems.push("I want to handle refunds."); },
        goal: state => { state.goal = "An expanded checkout goal"; },
        summary: state => { state.preparation.summary = "Changed local context"; },
        checks: state => { state.preparation.checks.push({ label: "New constraint", status: "deferred", detail: "Needs review" }); },
        sources: state => { state.preparation.sources = []; },
        generation: state => { state.generation = "new-generation"; },
    };
    for (const [name, mutate] of Object.entries(mutations)) await t.test(name, async () => {
        const h = await extensionHarness();
        try {
            const args = await pendingResearch(h);
            args.state.requirements.research = {
                ...findings, input: requirementsResearchInput(args.state), generation: args.state.generation,
                requestId: "old-request", runId: "old-run", completedAt: "2026-10-01T00:00:00.000Z",
            };
            mutate(args.state);
            await h.api.persistState(args.state);
            const labels: string[] = [];
            await h.api.answerFactory.run({
                args, runId: "new-run", phase() {}, log() {},
                step: (_key: string, work: () => Promise<unknown>) => work(),
                agent: async (_prompt: string, options: { label: string }) => {
                    labels.push(options.label);
                    return options.label === "Research accepted usages" ? findings : dagResult(args.state);
                },
            });
            assert.deepEqual(labels, ["Research accepted usages", "Process Tandem answer"]);
            const saved = await h.api.loadState("sample");
            assert.equal(saved.requirements.research?.runId, "new-run");
            assert.equal(saved.requirements.research?.requestId, args.requestId);
            assert.ok(requirementsResearchIsCurrent(saved));
        } finally { await h.close(); }
    });
});

test("a retry cannot fabricate saved research or consume findings changed after question generation", async () => {
    const h = await extensionHarness();
    try {
        const args = await pendingResearch(h);
        args.state.requirements.research = {
            ...findings, input: requirementsResearchInput(args.state), generation: args.state.generation,
            requestId: "unrecorded-request", runId: "unrecorded-run", completedAt: "2026-10-01T00:00:00.000Z",
        };
        await assert.rejects(h.api.answerFactory.run({
            args, runId: "retry-run", phase() {}, log() {},
            step: (_key: string, work: () => Promise<unknown>) => work(),
            agent: async () => assert.fail("Unrecorded findings cannot reach question generation."),
        }), /does not match/);
        args.state = await h.api.loadState("sample");
        const result = await h.api.answerFactory.run({
            args, runId: "retry-run", phase() {}, log() {},
            step: (_key: string, work: () => Promise<unknown>) => work(),
            agent: async (_prompt: string, options: { label: string }) =>
                options.label === "Research accepted usages" ? findings : dagResult(args.state),
        });
        const current = await h.api.loadState("sample");
        current.requirements.research!.summary = "A newer research finding";
        await h.api.persistState(current);
        await assert.rejects(h.api.applyFactoryResult("sample", args.requestId, {
            status: "completed", runId: "retry-run", result,
        }), /no matching research result/);
        assert.equal((await h.api.loadState("sample")).requirements.substage, "usage");
    } finally { await h.close(); }
});
