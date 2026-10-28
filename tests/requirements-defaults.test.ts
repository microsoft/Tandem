import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { extensionHarness } from "./helpers/extension-harness.js";
import { buildDecisionGraphMermaid } from "../src/decision-diagram.js";
import { requirementsInputDigest, validateChangeSet } from "../src/requirements-reconciliation.js";
import type { TandemState } from "../src/types.js";
import { curatedDefault, type DecisionNode } from "../src/workflow.js";

const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
function decision(id: string, dependencies: string[] = [], answer: string | null = null): DecisionNode {
    return {
        id, title: id, dependencies, answer, status: "toAnswer",
        question: { id, text: `Choose ${id}`, rationale: "", choices: ["Recommended", "Alternative", "Minimal"],
            recommended: "Recommended", allowFreeText: true, answerPlaceholder: "" },
    };
}
function changes() {
    return { version: 1, conflicts: [], questions: [], assumptions: { add: [], remove: [] },
        deferred: { add: [], remove: [] }, prototypeApproach: null };
}
async function setup() {
    const h = await extensionHarness();
    const initial = h.api.createState("sample", "Keep human scope");
    initial.stage = "requirements";
    initial.lifecycle.currentStage = "requirements";
    initial.lifecycle.completedStages = ["prepare"];
    initial.preparation.status = "ready";
    initial.requirements = { substage: "dag", usageItems: ["I want to explore."], suggestions: [] };
    initial.prototypeApproach = { mode: "build", reason: "New GUI approved" };
    initial.decisionGraph = { nodes: [
        decision("existing", [], "Custom accepted intent"), decision("root"),
        decision("child", ["root"]), decision("grandchild", ["child"]),
    ] };
    initial.assumed = ["Human assumption"];
    initial.deferred = ["Human deferral"];
    initial.artifacts = [{ id: "human-note", title: "Human note", kind: "note", stage: "prepare", path: "",
        content: "Preserve this verbatim.", mermaid: "", language: "markdown" }];
    await h.api.persistState(initial);
    const entry = await h.api.startServer("defaults", "sample", "project:tandem", true);
    const post = (body: unknown) => fetch(new URL("api/answer", entry.url), {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const close = async () => {
        clearInterval(entry.heartbeat);
        await new Promise<void>((resolve, reject) => entry.server.close((error) => error ? reject(error) : resolve()));
        await h.close();
    };
    return { h, initial: await h.api.loadState("sample"), entry, post, close };
}
function snapshot(state: TandemState) {
    return plain({ action: "apply-defaults", expectedRevision: state.revision, generation: state.generation,
        defaults: state.decisionGraph.nodes.filter((node) => !node.answer && curatedDefault(node.question))
            .map((node) => ({ nodeId: node.id, answer: node.question!.recommended })) });
}
function worker(h: Awaited<ReturnType<typeof extensionHarness>>, result: (request: any) => any = changes, factory?: any) {
    let agents = 0;
    h.api.setSession({ ...h.session, ...(factory ? { workflow: factory } : {}), rpc: { ...h.session.rpc, workflow: {
        run: async (request: any) => {
            h.requests.push(plain(request));
            const runId = `run-${h.requests.length}`;
            try {
                const output = await h.api.answerFactory.run({
                    args: request.args, runId, phase() {}, log() {},
                    step: (_name: string, run: () => Promise<unknown>) => run(),
                    agent: async (_prompt: string, options: any) => {
                        agents++;
                        assert.equal(options.agent, h.api.textWorkerAgent.name);
                        if (request.args.action === "apply-defaults") {
                            assert.equal(options.schema.additionalProperties, false);
                            assert.equal(options.schema.properties.decisionGraph, undefined);
                            assert.equal(options.schema.properties.confirmed, undefined);
                        }
                        return result(request);
                    },
                });
                return { status: "completed", runId, result: output };
            } catch (error) {
                return { status: "failed", runId, error: (error as Error).message };
            }
        },
    } } });
    return () => agents;
}

async function interruptedBatch(f: Awaited<ReturnType<typeof setup>>) {
    const counts = { agents: 0, reads: 0, waits: 0, resumes: 0 };
    let completed: any;
    const sdk = {
        getRun: async (runId: string) => {
            counts.reads++;
            assert.equal(runId, "interrupted-run");
            return completed;
        },
        waitForRun: async (_runId: string): Promise<any> => {
            counts.waits++;
            throw new Error("Transient SDK connection failure");
        },
        resume: async () => { counts.resumes++; throw new Error("Recovery must not resume a terminal batch"); },
    };
    f.h.api.setSession({ ...f.h.session, workflow: sdk, rpc: { ...f.h.session.rpc, workflow: {
        run: async (request: any) => {
            f.h.requests.push(plain(request));
            const runId = "interrupted-run";
            const result = await f.h.api.answerFactory.run({
                args: request.args, runId, phase() {}, log() {},
                step: (_name: string, run: () => Promise<unknown>) => run(),
                agent: async () => { counts.agents++; return changes(); },
            });
            completed = { runId, status: "completed", result };
            return { runId, status: "running" };
        },
    } } });
    const approved = snapshot(f.initial);
    assert.equal((await f.post(approved)).status, 202);
    await f.h.waitForRequests();
    await f.h.api.waitForAnswer("sample");
    const failed = await f.h.api.loadState("sample");
    assert.equal(failed.processing.status, "error");
    assert.match(failed.processing.message, /Transient SDK connection failure/);
    assert.equal(failed.factoryRuns![0].terminal, false);
    assert.ok(failed.jobOwner);
    return { approved, failed, completed, counts, sdk };
}

function retry(state: TandemState) {
    return { action: "apply-defaults", expectedRevision: state.revision, generation: state.generation,
        retryRequestId: state.processing.requestId };
}

test("one bounded factory reconciles every dependent snapshot default without duplicated structural output", async () => {
    const f = await setup();
    try {
        const agents = worker(f.h);
        const approved = snapshot(f.initial);
        assert.equal((await f.post(approved)).status, 202);
        await f.h.waitForRequests();
        await f.h.api.waitForAnswer("sample");
        assert.equal(f.h.requests.length, 1);
        assert.equal(agents(), 1);
        const request = f.h.requests[0] as any;
        assert.deepEqual(request.args.defaultBatch.defaults, approved.defaults);
        assert.equal(request.args.defaultBatch.revision, f.initial.revision);
        assert.equal(request.args.defaultBatch.generation, f.initial.generation);
        assert.equal(request.options.limits.maxTotalSubagents, 1);
        assert.equal(request.options.limits.timeoutSeconds, undefined);
        assert.equal(request.options.limits.maxAiCredits, 128);
        assert.equal(Object.hasOwn(request, "limits"), false);
        for (const key of ["artifacts", "confirmed", "lifecycle", "previewUrl", "processing", "implementation", "question"]) {
            assert.equal(key in request.args.state, false, key);
        }
        assert.ok(request.args.state.decisionGraph.nodes.every((node: any) => !("status" in node)));
        assert.ok(JSON.stringify(changes()).length < 200, "a compatible batch needs under 200 response characters");
        const next = await f.h.api.loadState("sample");
        assert.equal(next.processing.status, "success", next.processing.message);
        assert.equal(next.lifecycle.currentStage, "requirements");
        assert.equal(next.previewUrl, null);
        assert.equal(next.jobOwner, null);
        assert.equal(next.question, null);
        assert.ok(next.decisionGraph.nodes.every((node) => node.status === "answered"));
        assert.deepEqual(plain(next.confirmed), ["existing: Custom accepted intent", "root: Recommended", "child: Recommended", "grandchild: Recommended"]);
        assert.deepEqual(plain(next.assumed), ["Human assumption"]);
        assert.deepEqual(plain(next.deferred), ["Human deferral"]);
        assert.deepEqual(plain(next.artifacts.find((item) => item.id === "human-note")), plain(f.initial.artifacts[0]));
        const tree = next.artifacts.find((item) => item.id === "design-tree")!;
        assert.equal(tree.mermaid, buildDecisionGraphMermaid(next.decisionGraph.nodes).source);
        assert.match(tree.mermaid, /Decision1 --> Decision2/);
        assert.match(tree.mermaid, /class Decision0,Decision1,Decision2,Decision3 answered/);
        const persisted = JSON.parse(await readFile(join(f.h.root, ".tandem", "efforts", "sample", "state.json"), "utf8"));
        assert.deepEqual(persisted.processing.defaultBatch.defaults, approved.defaults);
        assert.equal(persisted.factoryRuns[0].terminal, true);
        f.h.api.setSession(f.h.session);
        const completed = await f.h.api.completeLifecycleStage("sample", "requirements", "project:tandem");
        assert.equal(completed.lifecycle.currentStage, "sketch", "completion remains an explicit separate operation");
        assert.equal(completed.processing.action, "generate-sketch", "completion schedules designs before a prototype");
        await f.h.waitForRequests(2);
    } finally { await f.close(); }
});

test("snapshot drift, unknown choices and non-curated recommendations cannot launch a batch", async () => {
    const f = await setup();
    try {
        const body = snapshot(f.initial);
        for (const invalid of [
            { ...body, expectedRevision: body.expectedRevision - 1 },
            { ...body, generation: "old-generation" },
            { ...body, defaults: body.defaults.slice(0, 1) },
            { ...body, defaults: body.defaults.map((item) => ({ ...item, answer: "Unseen choice" })) },
            { ...body, defaults: [...body.defaults.slice(0, 2), body.defaults[0]] },
        ]) assert.ok([400, 409].includes((await f.post(invalid)).status));
        for (const choices of [[], ["Recommended"], ["Recommended", "recommended", "Other"], ["Other", "Different", "Minimal"]]) {
            const state = await f.h.api.loadState("sample");
            state.decisionGraph.nodes[2].question!.choices = choices;
            await f.h.api.persistState(state);
            const valid = snapshot(state);
            const response = await f.post({ ...valid, defaults: [...valid.defaults, { nodeId: "child", answer: "Recommended" }] });
            assert.equal(response.status, 409);
            assert.match((await response.json() as any).error, /exactly all current unanswered whole-graph recommendations/);
        }
        assert.equal(f.h.requests.length, 0);
    } finally { await f.close(); }
});

test("mixed defaults accept all curated descendants, retain explicit blockers and persist the next question", async () => {
    const f = await setup();
    try {
        const state = await f.h.api.loadState("sample");
        state.decisionGraph.nodes[2].question!.recommended = null;
        state.decisionGraph.nodes.push({ ...decision("last", ["grandchild"]),
            question: { ...decision("last").question!, recommended: null } });
        await f.h.api.persistState(state);
        const approved = snapshot(await f.h.api.loadState("sample"));
        assert.deepEqual(approved.defaults, [{ nodeId: "root", answer: "Recommended" }, { nodeId: "grandchild", answer: "Recommended" }]);
        const agents = worker(f.h);
        assert.equal((await f.post(approved)).status, 202);
        await f.h.waitForRequests(); await f.h.api.waitForAnswer("sample");
        const next = await f.h.api.loadState("sample");
        assert.equal(next.processing.status, "success", next.processing.message);
        assert.equal(next.question!.id, "child");
        assert.equal(next.decisionGraph.nodes[2].answer, null);
        assert.equal(next.decisionGraph.nodes[2].status, "active");
        assert.equal(next.decisionGraph.nodes[3].answer, "Recommended");
        assert.equal(next.decisionGraph.nodes[4].answer, null);
        assert.equal(next.decisionGraph.nodes[0].answer, "Custom accepted intent");
        assert.equal(agents(), 1);
        assert.deepEqual(plain(next.processing.defaultBatch.defaults), approved.defaults);
        assert.match(next.status, /2 questions still need an explicit answer/);
        assert.doesNotMatch(next.status, /ready for explicit completion/);
        assert.deepEqual(plain(next.confirmed), ["existing: Custom accepted intent", "root: Recommended", "grandchild: Recommended"]);
        assert.match(next.artifacts.find(item => item.id === "design-tree")!.mermaid, /class Decision2,Decision4 explicitAnswer/);
        await assert.rejects(f.h.api.completeLifecycleStage("sample", "requirements", "project:tandem"), /remain unanswered/);
    } finally { await f.close(); }
});

test("only explicit questions cannot launch an empty batch or accept fabricated defaults", async () => {
    const f = await setup();
    try {
        const state = await f.h.api.loadState("sample");
        for (const node of state.decisionGraph.nodes) if (!node.answer) node.question!.recommended = null;
        await f.h.api.persistState(state);
        const body = snapshot(await f.h.api.loadState("sample"));
        for (const defaults of [[], [{ nodeId: "root", answer: "Recommended" }]]) {
            const response = await f.post({ ...body, defaults });
            assert.equal(response.status, 409);
            assert.match((await response.json()).error, /No recommended answers are available/);
        }
        assert.equal(f.h.requests.length, 0);
    } finally { await f.close(); }
});

test("a non-active explicit question is answerable once its prerequisites are satisfied", async () => {
    const f = await setup();
    try {
        const state = await f.h.api.loadState("sample");
        state.decisionGraph.nodes.push({ ...decision("jurisdiction", ["existing"]),
            question: { ...decision("jurisdiction").question!, recommended: null } });
        await f.h.api.persistState(state);
        const before = await f.h.api.loadState("sample");
        assert.equal(before.question!.id, "root");
        assert.equal(before.decisionGraph.nodes.find(node => node.id === "jurisdiction")!.status, "toAnswer");
        const agents = worker(f.h, () => ({
            upsert: [], assumptions: { add: [], remove: [] }, deferred: { add: [], remove: [] }, prototypeApproach: null,
        }));
        const rejected = await f.post({ action: "answer-decision", questionId: "child", answer: "Premature answer" });
        assert.equal(rejected.status, 409);
        assert.match((await rejected.json()).error, /Complete its prerequisites first/);
        assert.equal(f.h.requests.length, 0);
        assert.equal((await f.post({ action: "answer-decision", questionId: "jurisdiction",
            answer: "The shop operates in Washington, USA." })).status, 202);
        await f.h.waitForRequests(); await f.h.api.waitForAnswer("sample");
        const next = await f.h.api.loadState("sample");
        assert.equal(next.processing.status, "success", next.processing.message);
        assert.equal(next.decisionGraph.nodes.find(node => node.id === "jurisdiction")!.answer, "The shop operates in Washington, USA.");
        assert.equal(next.question!.id, "root");
        assert.equal(next.decisionGraph.nodes[1].answer, null);
        assert.equal(next.decisionGraph.nodes[2].answer, null);
        assert.equal(next.decisionGraph.nodes[0].answer, "Custom accepted intent");
        assert.equal(agents(), 1);
        assert.equal((await f.post({ action: "answer-decision", questionId: "jurisdiction",
            answer: "Another answer without change consent" })).status, 409);
    } finally { await f.close(); }
});

test("answering an explicit blocker reopens changed saved downstream defaults, retaining their prior answers", async () => {
    const f = await setup();
    try {
        const state = await f.h.api.loadState("sample");
        state.decisionGraph.nodes[1].question!.recommended = null;
        await f.h.api.persistState(state);
        worker(f.h);
        assert.equal((await f.post(snapshot(await f.h.api.loadState("sample")))).status, 202);
        await f.h.waitForRequests(); await f.h.api.waitForAnswer("sample");
        const batched = await f.h.api.loadState("sample");
        assert.equal(batched.question!.id, "root");
        assert.equal(batched.decisionGraph.nodes[2].answer, "Recommended");
        worker(f.h, () => ({
            upsert: [{ id: "child", title: "Review child", dependencies: ["root"],
                question: { ...decision("child").question!, text: "Which behavior fits the explicit answer?" } }],
            assumptions: { add: [], remove: [] }, deferred: { add: [], remove: [] }, prototypeApproach: null,
        }));
        assert.equal((await f.post({ action: "answer-decision", questionId: "root", answer: "Explicit constraint" })).status, 202);
        await f.h.waitForRequests(2); await f.h.api.waitForAnswer("sample");
        const next = await f.h.api.loadState("sample");
        assert.equal(next.processing.status, "success", next.processing.message);
        assert.equal(next.decisionGraph.nodes[1].answer, "Explicit constraint");
        assert.equal(next.decisionGraph.nodes[0].answer, "Custom accepted intent");
        for (const node of next.decisionGraph.nodes.slice(2)) {
            assert.equal(node.answer, null);
            assert.equal(node.review?.previousAnswer, "Recommended");
        }
        assert.equal(next.question!.id, "child");
        assert.deepEqual(plain(next.confirmed), ["existing: Custom accepted intent", "root: Explicit constraint"]);
        assert.equal(f.h.requests.length, 2);
    } finally { await f.close(); }
});

test("rapid and cross-provider duplicate clicks launch at most one job and never accept optimistic answers", async () => {
    const f = await setup();
    const other = await extensionHarness({}, f.h.root);
    const second = await other.api.startServer("second", "sample", "project:tandem", true);
    try {
        const body = snapshot(f.initial);
        const responses = await Promise.all([f.post(body), fetch(new URL("api/answer", second.url), {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        })]);
        assert.deepEqual(responses.map((value) => value.status).sort(), [202, 409]);
        for (let tries = 0; f.h.requests.length + other.requests.length === 0 && tries < 100; tries++) {
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        assert.equal(f.h.requests.length + other.requests.length, 1);
        const pending = await f.h.api.loadState("sample");
        assert.equal(pending.decisionGraph.nodes.filter((node) => node.answer).length, 1);
        assert.equal(pending.processing.defaultBatch.defaults.length, 3);
        assert.equal((await f.post(body)).status, 409);
        await assert.rejects(f.h.api.completeLifecycleStage("sample", "requirements", "project:tandem"), /hidden Tandem agent/);
    } finally {
        clearInterval(second.heartbeat);
        await new Promise<void>((resolve) => second.server.close(() => resolve()));
        await other.close();
        await f.close();
    }
});

test("semantic conflicts and changed questions invalidate affected descendants and retain review evidence", async () => {
    const f = await setup();
    try {
        worker(f.h, () => ({ ...changes(),
            conflicts: [{ nodeId: "child", reason: "This recommendation is incompatible with the upstream choice." }],
            questions: [{ nodeId: "child", title: "Review compatibility", question: {
                ...decision("child").question!, text: "Which compatible behavior?", recommended: "Alternative",
            } }],
            assumptions: { add: ["Compatibility must be reviewed"], remove: [] },
        }));
        assert.equal((await f.post(snapshot(f.initial))).status, 202);
        await f.h.waitForRequests(); await f.h.api.waitForAnswer("sample");
        const next = await f.h.api.loadState("sample");
        assert.equal(next.processing.status, "success", next.status);
        assert.equal(next.question!.id, "child");
        assert.equal(next.decisionGraph.nodes[0].answer, "Custom accepted intent");
        assert.equal(next.decisionGraph.nodes[1].answer, "Recommended");
        assert.equal(next.decisionGraph.nodes[2].answer, null);
        assert.equal(next.decisionGraph.nodes[3].answer, null);
        assert.equal(next.decisionGraph.nodes[3].status, "toAnswer");
        assert.equal(next.decisionGraph.nodes[2].review!.previousAnswer, "Recommended");
        assert.match(next.decisionGraph.nodes[2].review!.reason, /incompatible/);
        assert.equal(next.confirmed.length, 2);
        assert.match(next.artifacts.find((item) => item.id === "design-tree")!.mermaid, /class Decision2 active/);
        await assert.rejects(f.h.api.completeLifecycleStage("sample", "requirements", "project:tandem"), /remain unanswered/);
        assert.equal(f.h.requests.length, 1, "review never silently launches another default batch");
    } finally { await f.close(); }
});

test("failed reconciliation retains the frozen approval, rejects full-state results and retries exactly those choices", async () => {
    const f = await setup();
    try {
        let fail = true;
        worker(f.h, () => fail ? { ...changes(), decisionGraph: f.initial.decisionGraph } : changes());
        const approved = snapshot(f.initial);
        assert.equal((await f.post(approved)).status, 202);
        await f.h.waitForRequests(); await f.h.api.waitForAnswer("sample");
        const failed = await f.h.api.loadState("sample");
        assert.equal(failed.processing.status, "error");
        assert.match(failed.processing.message, /unexpected fields/);
        assert.deepEqual(plain(failed.processing.defaultBatch.defaults), approved.defaults);
        assert.equal(failed.jobOwner, null);
        assert.equal(failed.decisionGraph.nodes.filter((node) => node.answer).length, 1);
        await assert.rejects(f.h.api.completeLifecycleStage("sample", "requirements", "project:tandem"), /Reconcile the saved/);
        fail = false;
        assert.equal((await f.post({ action: "apply-defaults", expectedRevision: failed.revision, generation: failed.generation,
            retryRequestId: failed.processing.requestId })).status, 202);
        await f.h.waitForRequests(2); await f.h.api.waitForAnswer("sample");
        const ready = await f.h.api.loadState("sample");
        assert.equal(ready.processing.status, "success", ready.status);
        assert.deepEqual((f.h.requests[1] as any).args.defaultBatch, (f.h.requests[0] as any).args.defaultBatch);
        assert.equal(f.h.requests.length, 2);
    } finally { await f.close(); }
});

test("reload recovers the existing run without another worker and repairs an unobserved terminal receipt", async () => {
    const f = await setup();
    const reloaded = await extensionHarness({}, f.h.root);
    try {
        assert.equal((await f.post(snapshot(f.initial))).status, 202);
        await f.h.waitForRequests();
        const pending = await f.h.api.loadState("sample");
        // The worker's run ID can persist before the SDK launch response reaches the provider.
        pending.processing.runId = "reload-run";
        await f.h.api.persistState(pending);
        const run = { runId: "reload-run", status: "completed", result: changes() };
        reloaded.api.setSession({ ...reloaded.session, workflow: { getRun: async () => run } });
        reloaded.api.recoverAnswerFactory(await reloaded.api.loadState("sample"), true);
        await reloaded.api.waitForAnswer("sample");
        const ready = await reloaded.api.loadState("sample");
        assert.equal(ready.processing.status, "success", ready.processing.message);
        assert.equal(reloaded.requests.length, 0);
        assert.equal(ready.factoryRuns![0].terminal, true);
        assert.equal(ready.factoryRuns![0].runId, "reload-run");
        // Repair the same old receipt shape at the completion boundary, but only after SDK verification.
        ready.factoryRuns![0] = { ...ready.factoryRuns![0], terminal: false, runId: null };
        await reloaded.api.persistState(ready);
        reloaded.api.setSession({ ...reloaded.session, workflow: {
            getRun: async () => ({ ...run, status: "running" }),
        } });
        await assert.rejects(reloaded.api.completeLifecycleStage("sample", "requirements", "project:tandem"), /hidden Tandem agent/);
        assert.ok((await reloaded.api.loadState("sample")).jobOwner);
        reloaded.api.setSession({ ...reloaded.session, workflow: { getRun: async () => run } });
        const completed = await reloaded.api.completeLifecycleStage("sample", "requirements", "project:tandem");
        assert.equal(completed.lifecycle.currentStage, "sketch");
        assert.equal(completed.processing.action, "generate-sketch");
        await reloaded.waitForRequests();
        assert.equal((await reloaded.api.loadState("sample")).factoryRuns![0].terminal, true);
    } finally { await reloaded.close(); await f.close(); }
});

test("retry and fresh approval recover completed batches after transient wait failures without another worker", async () => {
    for (const fresh of [false, true]) {
        const f = await setup();
        try {
            const interrupted = await interruptedBatch(f);
            const response = await f.post(fresh ? snapshot(interrupted.failed) : retry(interrupted.failed));
            assert.equal(response.status, 202, JSON.stringify(await response.json()));
            await f.h.api.waitForAnswer("sample");
            const ready = await f.h.api.loadState("sample");
            assert.equal(ready.processing.status, "success", ready.processing.message);
            assert.equal(ready.processing.requestId, interrupted.failed.processing.requestId);
            assert.deepEqual(plain(ready.processing.defaultBatch), plain(interrupted.failed.processing.defaultBatch));
            for (const approved of interrupted.approved.defaults) {
                assert.equal(ready.decisionGraph.nodes.find((node) => node.id === approved.nodeId)!.answer, approved.answer);
            }
            assert.equal(ready.decisionGraph.nodes[0].answer, "Custom accepted intent");
            assert.deepEqual(plain(ready.assumed), ["Human assumption"]);
            assert.deepEqual(plain(ready.deferred), ["Human deferral"]);
            assert.equal(ready.factoryRuns![0].terminal, true);
            assert.equal(ready.jobOwner, null);
            assert.equal(ready.lifecycle.currentStage, "requirements");
            assert.equal(f.h.requests.length, 1);
            assert.deepEqual(interrupted.counts, { agents: 1, reads: 1, waits: 1, resumes: 0 });
        } finally { await f.close(); }
    }
});

test("retry verifies SDK state but never waits for active work or treats unknown results as terminal", async () => {
    const f = await setup();
    try {
        const interrupted = await interruptedBatch(f);
        let reads = 0;
        for (const observation of ["running", "unknown", "not_found", "connection-error", "wrong-run"]) {
            interrupted.sdk.getRun = async () => {
                reads++;
                if (observation === "not_found" || observation === "connection-error") {
                    throw Object.assign(new Error(observation), { code: observation });
                }
                return { ...interrupted.completed, runId: observation === "wrong-run" ? "another-run" : "interrupted-run",
                    status: observation === "wrong-run" ? "completed" : observation };
            };
            const before = await f.h.api.loadState("sample");
            const response = await f.post(retry(before));
            assert.equal(response.status, 409, observation);
            const after = await f.h.api.loadState("sample");
            assert.equal(after.revision, before.revision);
            assert.equal(after.processing.status, "error");
            assert.equal(after.factoryRuns![0].terminal, false);
            assert.ok(after.jobOwner);
            assert.equal(after.decisionGraph.nodes.filter((node) => node.answer).length, 1);
        }
        assert.equal(reads, 5);
        assert.equal(interrupted.counts.waits, 1, "POST inspects once instead of awaiting the worker");
        assert.equal(interrupted.counts.agents, 1);
        assert.equal(f.h.requests.length, 1);
    } finally { await f.close(); }
});

test("SDK terminal failures allow an explicit retry of the frozen batch without auto-resume", async () => {
    for (const status of ["failed", "cancelled", "halted"]) {
        const f = await setup();
        try {
            const interrupted = await interruptedBatch(f);
            interrupted.sdk.getRun = async () => ({ runId: "interrupted-run", status, error: `SDK ${status}` });
            const retryAgents = worker(f.h, changes, interrupted.sdk);
            const response = await f.post(retry(interrupted.failed));
            assert.equal(response.status, 202, JSON.stringify(await response.json()));
            await f.h.waitForRequests(2); await f.h.api.waitForAnswer("sample");
            const ready = await f.h.api.loadState("sample");
            assert.equal(ready.processing.status, "success", ready.processing.message);
            assert.notEqual(ready.processing.requestId, interrupted.failed.processing.requestId);
            assert.deepEqual((f.h.requests[1] as any).args.defaultBatch, (f.h.requests[0] as any).args.defaultBatch);
            assert.ok(ready.factoryRuns!.every((receipt) => receipt.terminal));
            assert.equal(retryAgents(), 1);
            assert.equal(interrupted.counts.agents, 1);
            assert.equal(interrupted.counts.resumes, 0);
            assert.equal(f.h.requests.length, 2, "only the explicit retry starts another attempt");
        } finally { await f.close(); }
    }
});

test("reload recovers errored batches using processing IDs, receipts, or established request correlation", async () => {
    for (const missing of ["receipt", "processing", "both"]) {
        const f = await setup();
        const reloaded = await extensionHarness({}, f.h.root);
        try {
            const interrupted = await interruptedBatch(f);
            const failed = await f.h.api.loadState("sample");
            if (missing !== "processing") failed.factoryRuns![0].runId = null;
            if (missing !== "receipt") failed.processing.runId = null;
            await f.h.api.persistState(failed);
            reloaded.api.setSession({ ...reloaded.session, workflow: { ...interrupted.sdk,
                listRuns: async () => [{ runId: "interrupted-run", workflowName: failed.processing.factoryName,
                    createdAt: Date.parse(failed.processing.requestedAt) }],
                getRunProgress: async () => ({ records: [{ text: `Request ${failed.processing.requestId}; recovered` }] }),
            } });
            reloaded.api.recoverAnswerFactory(await reloaded.api.loadState("sample"), true);
            await reloaded.api.waitForAnswer("sample");
            const ready = await reloaded.api.loadState("sample");
            assert.equal(ready.processing.status, "success", ready.processing.message);
            assert.equal(ready.factoryRuns![0].terminal, true);
            assert.equal(ready.factoryRuns![0].runId, "interrupted-run");
            assert.equal(ready.processing.runId, "interrupted-run");
            assert.equal(ready.jobOwner, null);
            assert.deepEqual(plain(ready.processing.defaultBatch), plain(failed.processing.defaultBatch));
            assert.equal(f.h.requests.length, 1);
            assert.equal(reloaded.requests.length, 0);
            assert.equal(interrupted.counts.agents, 1);
        } finally { await reloaded.close(); await f.close(); }
    }
});

test("reload monitors an errored active batch outside the claim, and records terminal failure without relaunch", async () => {
    for (const status of ["completed", "failed", "cancelled", "halted"]) {
        const f = await setup();
        const reloaded = await extensionHarness({}, f.h.root);
        try {
            const interrupted = await interruptedBatch(f);
            let finish!: (run: any) => void;
            let monitoring!: () => void;
            const started = new Promise<void>((resolve) => { monitoring = resolve; });
            reloaded.api.setSession({ ...reloaded.session, workflow: { ...interrupted.sdk,
                getRun: async () => ({ runId: "interrupted-run", status: "running" }),
                waitForRun: async () => new Promise((resolve) => { finish = resolve; monitoring(); }),
            } });
            reloaded.api.recoverAnswerFactory(await reloaded.api.loadState("sample"), true);
            await started;
            const active = await f.h.api.loadState("sample");
            assert.equal(active.processing.status, "error");
            assert.equal(active.factoryRuns![0].terminal, false);
            active.status = "Unrelated concurrent metadata update";
            await f.h.api.persistState(active);
            finish({ ...interrupted.completed, status, ...(status === "completed" ? {} : { error: `SDK ${status}` }) });
            await reloaded.api.waitForAnswer("sample");
            const settled = await reloaded.api.loadState("sample");
            assert.equal(settled.processing.status, status === "completed" ? "success" : "error");
            if (status !== "completed") assert.equal(settled.processing.message, `SDK ${status}`);
            assert.equal(settled.factoryRuns![0].terminal, true);
            assert.equal(settled.jobOwner, null);
            assert.equal(settled.decisionGraph.nodes.filter((node) => node.answer).length, status === "completed" ? 4 : 1);
            assert.equal(f.h.requests.length, 1);
            assert.equal(reloaded.requests.length, 0);
            assert.equal(interrupted.counts.resumes, 0);
        } finally { await reloaded.close(); await f.close(); }
    }
});

test("batch recovery rejects stale revisions, changed inputs and foreign ownership before SDK inspection", async () => {
    for (const mutation of ["revision", "generation", "request", "inputs", "owner", "receipt-run"]) {
        const f = await setup();
        try {
            const interrupted = await interruptedBatch(f);
            const current = await f.h.api.loadState("sample");
            let body = retry(current);
            if (mutation === "revision") body.expectedRevision--;
            if (mutation === "generation") body.generation = "stale-generation";
            if (mutation === "request") body.retryRequestId = "different-request";
            if (mutation === "inputs") current.decisionGraph.nodes[1].question!.recommended = "Alternative";
            if (mutation === "owner") current.jobOwner = { sessionId: "foreign-session", workspaceRoot: f.h.root };
            if (mutation === "receipt-run") current.factoryRuns![0].runId = "another-run";
            if (["inputs", "owner", "receipt-run"].includes(mutation)) {
                await f.h.api.persistState(current);
                body = retry(current);
            }
            assert.equal((await f.post(body)).status, 409, mutation);
            assert.equal(interrupted.counts.reads, 0, mutation);
            assert.equal(interrupted.counts.agents, 1);
            assert.equal(f.h.requests.length, 1);
            assert.equal((await f.h.api.loadState("sample")).factoryRuns![0].terminal, false);
        } finally { await f.close(); }
    }
});

test("reload ignores late completion after the frozen inputs or request identity change", async () => {
    for (const mutation of ["inputs", "batch", "request", "generation", "owner"]) {
        const f = await setup();
        const reloaded = await extensionHarness({}, f.h.root);
        try {
            const interrupted = await interruptedBatch(f);
            let finish!: (run: any) => void;
            let monitoring!: () => void;
            const started = new Promise<void>((resolve) => { monitoring = resolve; });
            reloaded.api.setSession({ ...reloaded.session, workflow: {
                getRun: async () => ({ runId: "interrupted-run", status: "running" }),
                waitForRun: async () => new Promise((resolve) => { finish = resolve; monitoring(); }),
            } });
            reloaded.api.recoverAnswerFactory(await reloaded.api.loadState("sample"), true);
            await started;
            const changed = await f.h.api.loadState("sample");
            if (mutation === "inputs") changed.decisionGraph.nodes[1].question!.text = "Changed while monitoring";
            if (mutation === "batch") changed.processing.defaultBatch.defaults[0].answer = "Alternative";
            if (mutation === "request") changed.processing.requestId = "replacement-request";
            if (mutation === "generation") {
                changed.generation = "replacement-generation";
                changed.factoryRuns![0].generation = changed.generation;
            }
            if (mutation === "owner") changed.jobOwner = { sessionId: "other-session", workspaceRoot: f.h.root };
            await f.h.api.persistState(changed);
            finish(interrupted.completed);
            await reloaded.api.waitForAnswer("sample");
            const after = await reloaded.api.loadState("sample");
            assert.equal(after.processing.status, "error", mutation);
            assert.equal(after.factoryRuns![0].terminal, false, mutation);
            assert.equal(after.decisionGraph.nodes.filter((node) => node.answer).length, 1, mutation);
            assert.equal(reloaded.requests.length, 0);
            assert.equal(f.h.requests.length, 1);
        } finally { await reloaded.close(); await f.close(); }
    }
});

test("SDK inspection cannot hide a concurrent revision or semantic edit behind receipt bookkeeping", async () => {
    for (const semantic of [false, true]) {
        const f = await setup();
        try {
            const interrupted = await interruptedBatch(f);
            interrupted.sdk.getRun = async () => {
                const concurrent = await f.h.api.loadState("sample");
                concurrent.status = "Concurrent edit during SDK inspection";
                if (semantic) concurrent.decisionGraph.nodes[1].question!.text = "A new question";
                await f.h.api.persistState(concurrent);
                return interrupted.completed;
            };
            assert.equal((await f.post(retry(interrupted.failed))).status, 409);
            const after = await f.h.api.loadState("sample");
            assert.equal(after.status, "Concurrent edit during SDK inspection");
            assert.equal(after.factoryRuns![0].terminal, false);
            assert.equal(after.processing.status, "error");
            assert.equal(after.decisionGraph.nodes.filter((node) => node.answer).length, 1);
            assert.equal(f.h.requests.length, 1);
        } finally { await f.close(); }
    }
});

test("stage completion observes an errored batch result instead of stranding a terminal receipt", async () => {
    const f = await setup();
    try {
        const interrupted = await interruptedBatch(f);
        interrupted.sdk.getRun = async () => ({ ...interrupted.completed, result: { ...changes(),
            conflicts: [{ nodeId: "root", reason: "Review the upstream constraint" }],
            questions: [{ nodeId: "root", title: "Review root", question: decision("root").question }],
        } });
        await assert.rejects(f.h.api.completeLifecycleStage("sample", "requirements", "project:tandem"), /remain unanswered/);
        const reviewed = await f.h.api.loadState("sample");
        assert.equal(reviewed.processing.status, "success", reviewed.processing.message);
        assert.equal(reviewed.processing.requestId, interrupted.failed.processing.requestId);
        assert.equal(reviewed.factoryRuns![0].terminal, true);
        assert.equal(reviewed.jobOwner, null);
        assert.equal(reviewed.decisionGraph.nodes[1].review!.previousAnswer, "Recommended");
        assert.equal(reviewed.lifecycle.currentStage, "requirements");
        assert.equal(f.h.requests.length, 1);
        assert.equal(interrupted.counts.agents, 1);
    } finally { await f.close(); }
});

test("late results are rejected when semantic inputs change, even within the same request", async () => {
    const f = await setup();
    try {
        assert.equal((await f.post(snapshot(f.initial))).status, 202);
        await f.h.waitForRequests();
        const pending = await f.h.api.loadState("sample");
        pending.processing.runId = "late";
        pending.decisionGraph.nodes[1].question!.text = "A materially different question";
        await f.h.api.persistState(pending);
        assert.notEqual(requirementsInputDigest(pending), pending.processing.defaultBatch.inputDigest);
        await assert.rejects(f.h.api.applyFactoryResult("sample", pending.processing.requestId, {
            runId: "late", status: "completed", result: changes(),
        }), /frozen requirements inputs changed/);
        assert.equal((await f.h.api.loadState("sample")).decisionGraph.nodes[1].answer, null);
    } finally { await f.close(); }
});

test("strict semantic schema rejects malformed, unknown, duplicate and answer-bearing patches", () => {
    const graph = { nodes: [decision("root")] };
    for (const result of [
        { ...changes(), conflicts: [{ nodeId: "root", reason: "Conflict without a review question" }] },
        { ...changes(), questions: [{ nodeId: "missing", title: "Missing", question: decision("missing").question }] },
        { ...changes(), questions: [{ nodeId: "root", title: "Root", answer: "Invented", question: decision("root").question }] },
        { ...changes(), questions: [{ nodeId: "root", title: "Root", question: { ...decision("root").question, recommended: "Unseen" } }] },
        { ...changes(), version: 2 },
    ]) assert.throws(() => validateChangeSet(result, graph));
});

test("a changed accepted decision becomes unresolved, retaining its exact prior user answer", async () => {
    const f = await setup();
    try {
        worker(f.h, () => ({ ...changes(),
            conflicts: [{ nodeId: "existing", reason: "The approved defaults conflict with this accepted custom constraint." }],
            questions: [{ nodeId: "existing", title: "Review existing constraint", question: decision("existing").question }],
        }));
        assert.equal((await f.post(snapshot(f.initial))).status, 202);
        await f.h.waitForRequests(); await f.h.api.waitForAnswer("sample");
        const next = await f.h.api.loadState("sample");
        assert.equal(next.question!.id, "existing");
        assert.equal(next.decisionGraph.nodes[0].answer, null);
        assert.equal(next.decisionGraph.nodes[0].review!.previousAnswer, "Custom accepted intent");
        assert.equal(next.decisionGraph.nodes.filter((node) => node.answer).length, 3);
        assert.ok(!next.confirmed.some((line) => line.includes("Custom accepted intent")));
        await assert.rejects(f.h.api.completeLifecycleStage("sample", "requirements", "project:tandem"), /remain unanswered/);
    } finally { await f.close(); }
});

test("a regenerated approved question needs review even without an explicit conflict", async () => {
    const f = await setup();
    try {
        worker(f.h, () => ({ ...changes(),
            questions: [{ nodeId: "child", title: "Changed semantics", question: {
                ...decision("child").question!, choices: ["A new default", "Other behavior", "No feature"], recommended: "A new default",
            } }],
        }));
        assert.equal((await f.post(snapshot(f.initial))).status, 202);
        await f.h.waitForRequests(); await f.h.api.waitForAnswer("sample");
        const next = await f.h.api.loadState("sample");
        assert.equal(next.decisionGraph.nodes[2].question!.recommended, "A new default");
        assert.equal(next.decisionGraph.nodes[2].answer, null);
        assert.equal(next.decisionGraph.nodes[3].answer, null);
        assert.match(next.decisionGraph.nodes[2].review!.reason, /changed during reconciliation/);
    } finally { await f.close(); }
});

test("custom single answers and edits continue to regenerate transitive descendants after batching", async () => {
    const f = await setup();
    try {
        worker(f.h);
        assert.equal((await f.post(snapshot(f.initial))).status, 202);
        await f.h.waitForRequests(); await f.h.api.waitForAnswer("sample");
        worker(f.h, (request) => ({
            upsert: request.args.state.decisionGraph.nodes
                .filter((node: any) => ["child", "grandchild"].includes(node.id) && node.id !== request.args.question.id)
                .map((node: any) => ({
                    id: node.id, dependencies: node.dependencies, title: `${node.id} regenerated`,
                    question: { ...node.question, text: `Reconsider ${node.id} after ${request.args.answer}`,
                        choices: ["New default", "Another", "Minimal"], recommended: "New default" },
                })),
            assumptions: { add: [], remove: [] }, deferred: { add: [], remove: [] }, prototypeApproach: null,
        }));
        assert.equal((await f.post({ action: "change-answer", questionId: "root", answer: "Custom changed intent" })).status, 202);
        await f.h.waitForRequests(2); await f.h.api.waitForAnswer("sample");
        const edited = await f.h.api.loadState("sample");
        assert.equal(edited.processing.status, "success", edited.status);
        assert.equal(edited.decisionGraph.nodes[0].answer, "Custom accepted intent");
        assert.equal(edited.decisionGraph.nodes[1].answer, "Custom changed intent");
        assert.equal(edited.decisionGraph.nodes[2].answer, null);
        assert.equal(edited.decisionGraph.nodes[3].answer, null);
        assert.match(edited.decisionGraph.nodes[3].question!.text, /Custom changed intent/);
        assert.equal(edited.question!.id, "child");
        assert.equal(edited.confirmed.length, 2);
        assert.match(edited.artifacts.find((item) => item.id === "design-tree")!.mermaid, /class Decision2 active/);
        assert.equal((await f.post({ action: "answer-decision", questionId: "child", answer: "My custom behavior" })).status, 202);
        await f.h.waitForRequests(3); await f.h.api.waitForAnswer("sample");
        const answered = await f.h.api.loadState("sample");
        assert.equal(answered.processing.status, "success", answered.status);
        assert.equal(answered.decisionGraph.nodes[2].answer, "My custom behavior");
        assert.equal(answered.decisionGraph.nodes[3].answer, null);
        assert.match(answered.decisionGraph.nodes[3].question!.text, /My custom behavior/);
        assert.equal(answered.question!.id, "grandchild");
        assert.equal(f.h.requests.length, 3, "no automatically selected newly recommended answers");
    } finally { await f.close(); }
});

test("prototype approach is reconciled only from its approved default and never builds during Requirements", async () => {
    const f = await setup();
    try {
        const state = await f.h.api.loadState("sample");
        state.prototypeApproach = { mode: "undecided", reason: "" };
        state.decisionGraph.nodes.push(decision("prototype-approach"));
        await f.h.api.persistState(state);
        worker(f.h, () => ({ ...changes(), prototypeApproach: { mode: "build", reason: "The approved default is a new GUI." } }));
        assert.equal((await f.post(snapshot(state))).status, 202);
        await f.h.waitForRequests(); await f.h.api.waitForAnswer("sample");
        const next = await f.h.api.loadState("sample");
        assert.equal(next.prototypeApproach.mode, "build");
        assert.equal(next.processing.status, "success", next.status);
        assert.equal(next.lifecycle.currentStage, "requirements");
        assert.equal(next.previewStatus, "waiting");
        assert.equal(f.h.requests.length, 1);
    } finally { await f.close(); }
});

test("reload derives old inconsistent flags, confirmed decisions and diagram without a worker", async () => {
    const f = await setup();
    try {
        const original = await f.h.api.loadState("sample");
        original.question = decision("grandchild").question;
        original.confirmed = ["Old synthesized duplicate"];
        original.decisionGraph.nodes[1].status = "answered";
        original.decisionGraph.nodes[2].status = "active";
        original.artifacts.push({ id: "design-tree", title: "Old diagram", stage: "requirements", kind: "design-tree",
            path: "", language: "mermaid", content: "Old state", mermaid: "flowchart TD\nWrong" });
        await f.h.api.persistState(original);
        const state = await f.h.api.loadState("sample");
        assert.equal(state.question!.id, "root");
        assert.deepEqual(plain(state.decisionGraph.nodes.map((node) => node.status)), ["answered", "active", "toAnswer", "toAnswer"]);
        assert.deepEqual(plain(state.confirmed), ["existing: Custom accepted intent"]);
        assert.equal(state.artifacts.filter((item) => item.id === "design-tree").length, 1);
        assert.equal(state.artifacts.find((item) => item.id === "design-tree")!.mermaid,
            buildDecisionGraphMermaid(state.decisionGraph.nodes).source);
        assert.equal(f.h.requests.length, 0);
    } finally { await f.close(); }
});

test("a failed batch with changed inputs requires fresh whole-graph approval, not silent retry", async () => {
    const f = await setup();
    try {
        worker(f.h, () => { throw new Error("Worker unavailable"); });
        assert.equal((await f.post(snapshot(f.initial))).status, 202);
        await f.h.waitForRequests(); await f.h.api.waitForAnswer("sample");
        const state = await f.h.api.loadState("sample");
        const saved = plain(state.processing.defaultBatch);
        state.decisionGraph.nodes[2].question!.recommended = "Alternative";
        await f.h.api.persistState(state);
        const rejected = await f.post({ action: "apply-defaults", expectedRevision: state.revision, generation: state.generation,
            retryRequestId: state.processing.requestId });
        assert.equal(rejected.status, 409);
        assert.match((await rejected.json() as any).error, /inputs changed/);
        assert.equal(f.h.requests.length, 1);
        assert.deepEqual(plain((await f.h.api.loadState("sample")).processing.defaultBatch), saved);
        worker(f.h);
        assert.equal((await f.post(snapshot(state))).status, 202);
        await f.h.waitForRequests(2); await f.h.api.waitForAnswer("sample");
        assert.equal((await f.h.api.loadState("sample")).decisionGraph.nodes[2].answer, "Alternative");
    } finally { await f.close(); }
});
