import assert from "node:assert/strict";
import { test } from "node:test";
import { NativeWorkflowActivity, workflowBinding, type WorkflowBinding } from "../src/workflow-activity.js";
import { reactHarness, state } from "./helpers/react-harness.js";
import { extensionHarness } from "./helpers/extension-harness.js";

const binding: WorkflowBinding = {
    generation: "fixture-generation", requestId: "request", runId: "run", requestedAt: "2026-10-09T00:00:00Z", kind: "answer",
};
const detail = {
    runId: "run", status: "running",
    agents: [{ agentId: "owned", toolCallId: "launch", label: "Build the layout", status: "running", activeMs: 1200 }],
    progress: { records: [{ recordedAt: Date.parse(binding.requestedAt) }] },
};
const event = (type: string, data: object, agentId = "owned", timestamp = "2026-10-09T00:00:01Z") =>
    ({ type, agentId, timestamp, data });

test("native activity is owned, timestamped and unchanged by repeated observation queries", () => {
    const activity = new NativeWorkflowActivity();
    activity.observe(event("subagent.started", { workflowRunId: "run", toolCallId: "launch" }));
    activity.observe(event("tool.execution_start", { toolCallId: "tool", toolName: "powershell",
        arguments: { command: "private command not projected", description: "Checking the layout." } }, "owned", "2026-10-09T00:00:02Z"));
    activity.observe(event("permission.requested", { requestId: "permission" }, "owned", "2026-10-09T00:00:03Z"));
    activity.observe(event("assistant.reasoning_delta", { reasoningText: "private reasoning not projected" }));
    activity.observe(event("assistant.message", { phase: "analysis", content: "private analysis not projected" }));
    activity.observe(event("assistant.message", { phase: "final_answer", content: '{"privateFinalPayload":true}' }));
    activity.observe(event("subagent.started", { workflowRunId: "other-run", toolCallId: "other-launch" }, "foreign"));
    activity.observe(event("assistant.intent", { intent: "Foreign update" }, "foreign", "2026-10-09T02:00:00Z"));
    const snapshot = activity.snapshot(binding, detail);
    assert.equal(snapshot.agents[0].status, "waiting-permission");
    assert.equal(snapshot.agents[0].pendingPermissions, 1);
    assert.equal(snapshot.agents[0].update, "Checking the layout.");
    assert.equal(snapshot.lastNativeActivityAt, "2026-10-09T00:00:03Z");
    assert.doesNotMatch(JSON.stringify(snapshot), /private|Foreign/);
    assert.deepEqual(activity.snapshot(binding, detail), snapshot, "Polling is not native progress.");
    assert.throws(() => activity.snapshot(binding, { ...detail, runId: "different" }), /another workflow/);
});

test("public commentary is separate from final data and cancellation ends pending-consent visibility", () => {
    const activity = new NativeWorkflowActivity();
    activity.observe(event("subagent.started", { workflowRunId: "run", toolCallId: "launch" }));
    activity.observe(event("assistant.message", { phase: "commentary", content: "The layout is ready; wiring interactions next.",
        reasoningText: "never show", encryptedContent: "never show" }));
    activity.observe(event("permission.requested", { requestId: "permission" }));
    activity.observe(event("permission.completed", { requestId: "unrelated" }));
    assert.equal(activity.snapshot(binding, detail).agents[0].pendingPermissions, 1);
    activity.observe(event("subagent.completed", { cancelled: true }, "owned", "2026-10-09T00:00:04Z"));
    const cancelled = activity.snapshot(binding, detail);
    assert.equal(cancelled.agents[0].status, "cancelled");
    assert.equal(cancelled.agents[0].pendingPermissions, 0);
    assert.match(cancelled.agents[0].update, /layout is ready/);
    activity.observe(event("assistant.intent", { intent: "Late update must not revive work" }, "owned", "2026-10-09T01:00:00Z"));
    assert.deepEqual(activity.snapshot(binding, detail), cancelled);
});

test("sparse native activity remains unknown rather than becoming failure or fabricated progress", () => {
    const activity = new NativeWorkflowActivity();
    const snapshot = activity.snapshot(binding, { ...detail, progress: { records: [] } });
    assert.equal(snapshot.status, "running");
    assert.equal(snapshot.lastNativeActivityAt, null);
    assert.equal(snapshot.agents[0].update, "");
    assert.equal(snapshot.agents[0].lastNativeActivityAt, null);
});

test("terminal activity uses the native completion timestamp, not late activity or polling time", () => {
    const activity = new NativeWorkflowActivity();
    const completedAt = "2026-10-09T00:01:30Z";
    for (const status of ["completed", "error", "failed", "cancelled"]) {
        const snapshot = activity.snapshot(binding, { ...detail, status, completedAt: Date.parse(completedAt),
            progress: { records: [{ recordedAt: Date.parse("2026-10-09T01:00:00Z") }] } });
        assert.equal(Date.parse(snapshot.completedAt!), Date.parse(completedAt));
        assert.equal(activity.snapshot({ ...binding, completedAt }, { ...detail, status }).completedAt, completedAt);
        assert.equal(activity.snapshot(binding, { ...detail, status }).completedAt, null);
    }
    assert.equal(activity.snapshot(binding, { ...detail, completedAt: Date.parse(completedAt) }).completedAt, null);
});

test("terminal request elapsed stays fixed while freshness ages; missing completion never uses wall time", async t => {
    const h = await reactHarness(t);
    const value = state("prototype");
    value.processing = { ...value.processing, status: "success", action: "build-prototype",
        requestId: "request", runId: "run", requestedAt: binding.requestedAt, completedAt: "2026-10-09T00:01:30Z" };
    const current = workflowBinding(value)!;
    const snapshot = new NativeWorkflowActivity().snapshot(current, {
        ...detail, status: "completed", completedAt: Date.parse(value.processing.completedAt!),
    });
    h.render({ ...value, workflowRuntime: snapshot }); await h.flush();
    assert.match(h.get("workflow-activity-title").textContent!, /1m 30s/);
    h.window.Date.now = () => Date.parse("2026-10-10T00:00:00Z");
    await new Promise(resolve => setTimeout(resolve, 1100)); await h.flush();
    assert.match(h.get("workflow-activity-title").textContent!, /1m 30s/);
    value.processing.completedAt = null;
    h.render({ ...value, workflowRuntime: { ...snapshot, completedAt: null } }); await h.flush();
    assert.match(h.get("native-workflow-activity").textContent!, /Request elapsed unavailable/);
    assert.doesNotMatch(h.get("native-workflow-activity").textContent!, /Request elapsed: \d/);
    assert.equal(h.requests.length, 0);
});

test("permission completion without agentId uses only the previously attributed native request", () => {
    const activity = new NativeWorkflowActivity();
    activity.observe(event("subagent.started", { workflowRunId: "run", toolCallId: "launch" }));
    activity.observe(event("permission.requested", { requestId: "known-request" }));
    activity.observe(event("permission.completed", { requestId: "known-request" }, "foreign"));
    assert.equal(activity.snapshot(binding, detail).agents[0].pendingPermissions, 1);
    activity.observe({ type: "permission.completed", data: { requestId: "unknown-request" } });
    assert.equal(activity.snapshot(binding, detail).agents[0].pendingPermissions, 1);
    activity.observe({ type: "permission.completed", data: { requestId: "known-request" }, timestamp: "2026-10-09T00:00:05Z" });
    assert.equal(activity.snapshot(binding, detail).agents[0].pendingPermissions, 0);
    assert.equal(activity.snapshot(binding, detail).agents[0].status, "running");
});
test("activity UI rejects old request projections and distinguishes waiting, unavailable and silent work", async t => {
    const h = await reactHarness(t);
    const value = state("prototype");
    value.processing = { ...value.processing, status: "running", action: "build-prototype",
        requestId: "request", runId: "run", requestedAt: binding.requestedAt };
    const current = workflowBinding(value)!;
    const activity = new NativeWorkflowActivity();
    const snapshot = activity.snapshot(current, { ...detail, progress: { records: [] } });
    h.render({ ...value, workflowRuntime: { ...snapshot, requestId: "old-request" } });
    await h.flush();
    assert.match(h.get("native-workflow-activity").textContent!, /not yet available/);
    h.render({ ...value, workflowRuntime: snapshot }); await h.flush();
    assert.match(h.get("native-workflow-activity").textContent!, /No native activity observed yet/);
    assert.match(h.get("native-workflow-activity").textContent!, /Silence does not mean failure/);
    h.render({ ...value, workflowRuntime: { ...snapshot, agents: [{ ...snapshot.agents[0],
        status: "waiting-permission", pendingPermissions: 1 }] } }); await h.flush();
    assert.match(h.get("native-workflow-activity").textContent!, /Waiting for permission/);
    h.render({ ...value, workflowRuntime: { ...snapshot, status: "unavailable",
        error: "Native details unavailable; work has not been declared failed." } }); await h.flush();
    assert.match(h.get("native-workflow-activity").textContent!, /not been declared failed/);
    assert.equal(h.requests.length, 0, "Progress does not launch, retry or cancel work.");
});

test("activity summary keeps one update and prominent blockers while raw operations stay in Details", async t => {
    const h = await reactHarness(t), value = state("prototype");
    value.processing = { ...value.processing, status: "running", action: "generate-design-spec",
        requestId: "request", runId: "run", requestedAt: new Date(Date.now() - 65000).toISOString() };
    const current = workflowBinding(value)!;
    const agent = { id: "agent", label: "Process Tandem answer", status: "running", operation: "view",
        update: "Inspecting the saved interaction.", updateAt: new Date().toISOString(),
        lastNativeActivityAt: new Date(Date.now() - 65000).toISOString(), pendingPermissions: 0, activeMs: 4000 };
    const snapshot = { ...current, status: "running", lastNativeActivityAt: agent.lastNativeActivityAt, agents: [agent] };
    h.render({ ...value, workflowRuntime: snapshot }); await h.flush();
    const details = h.get<HTMLDetailsElement>("workflow-activity-details");
    assert.equal(details.open, false);
    assert.match(h.get("workflow-activity-title").textContent!, /Finishing prototype/);
    assert.equal(h.get("workflow-latest-update").textContent, agent.update);
    const summary = h.get("native-workflow-activity").cloneNode(true) as HTMLElement;
    summary.querySelector("details")!.remove();
    assert.doesNotMatch(summary.textContent!, /Process Tandem answer|Last native activity|Silence does/);
    assert.match(summary.textContent!, /No new activity for/);
    await h.click(details.querySelector("summary")!);
    assert.equal(details.open, true);
    h.render({ ...value, workflowRuntime: { ...snapshot, agents: [{ ...agent, pendingPermissions: 1, status: "waiting-permission" }] } }); await h.flush();
    assert.match(h.get("workflow-activity-state").textContent!, /Waiting for permission/);
    assert.match(h.get("native-workflow-activity").querySelector('[role="alert"]')!.textContent!, /pending native permission/);
    h.render({ ...value, workflowRuntime: { ...snapshot, status: "execution-unknown", error: "Outcome is unknown. Inspect current work." } }); await h.flush();
    assert.match(h.get("native-workflow-activity").querySelector('[role="alert"]')!.textContent!, /Outcome is unknown/);
    assert.equal(details.open, true);
    assert.equal(h.requests.length, 0);
});

test("activity Details deduplicates only shared single-agent freshness and retains scoped unknown or distinct times", async t => {
    const h = await reactHarness(t), value = state("prototype");
    value.processing = { ...value.processing, status: "running", action: "build-prototype",
        requestId: "request", runId: "run", requestedAt: binding.requestedAt };
    const current = workflowBinding(value)!;
    const timestamp = new Date(Date.now() - 65000).toISOString();
    const earlier = new Date(Date.now() - 120000).toISOString();
    const agent = { id: "agent", label: "Process Tandem answer", status: "running", operation: "view",
        update: "", updateAt: null, lastNativeActivityAt: timestamp, pendingPermissions: 0, activeMs: 4000 };
    for (const scenario of [
        { overall: timestamp, times: [timestamp], lines: 1 },
        { overall: timestamp, times: [earlier], lines: 2 },
        { overall: timestamp, times: [null], lines: 2 },
        { overall: null, times: [timestamp], lines: 2 },
        { overall: null, times: [null], lines: 1 },
        { overall: timestamp, times: [], lines: 1 },
        { overall: timestamp, times: [timestamp, earlier], lines: 3 },
        { overall: timestamp, times: [timestamp, timestamp], lines: 3 },
    ]) {
        const snapshot = { ...current, status: "running", lastNativeActivityAt: scenario.overall,
            agents: scenario.times.map((time, index) => ({ ...agent, id: `agent-${index}`, label: `Agent ${index}`, lastNativeActivityAt: time })) };
        const original = JSON.stringify(snapshot);
        h.render({ ...value, revision: ++value.revision, workflowRuntime: snapshot }); await h.flush();
        const details = h.get("workflow-activity-details");
        const freshness = [...details.querySelectorAll("p")].filter(p => /^(Workflow|Agent):/.test(p.textContent!));
        assert.equal(freshness.length, scenario.lines, JSON.stringify(scenario));
        assert.match(freshness[0].textContent!, /^Workflow:/);
        assert.equal(freshness.filter(p => p.textContent!.startsWith("Agent:")).length, scenario.lines - 1);
        if (scenario.times.includes(null) && scenario.overall !== null) assert.match(details.textContent!, /Agent: No native activity observed yet/);
        assert.equal(JSON.stringify(snapshot), original, "Rendering cannot reset or fabricate native timestamps.");
    }
    assert.equal(h.requests.length, 0);
});

test("workflow activity endpoint reads the exact native run and surfaces unavailable metadata without work", async () => {
    const h = await extensionHarness();
    let entry: Awaited<ReturnType<typeof h.api.startServer>> | undefined;
    try {
        const value = h.api.createState("activity", "Observe existing work");
        value.stage = value.lifecycle.currentStage = "prototype";
        value.lifecycle.completedStages = ["prepare", "requirements", "sketch"];
        value.preparation.status = "ready";
        value.processing = { status: "running", action: "build-prototype", requestId: "request", runId: "run",
            requestedAt: binding.requestedAt, completedAt: null, message: "Requested build",
            factoryName: "fixture", answer: null, question: null, originalDecisionGraph: null };
        await h.api.persistState(value);
        let unavailable = false;
        h.api.setSession({ ...h.session, workflow: { getRunDetail: async (runId: string) => {
            assert.equal(runId, "run");
            if (unavailable) throw new Error("Native metadata disconnected");
            return detail;
        } } });
        entry = await h.api.startServer("activity", "activity", "project:tandem", true);
        const first = await fetch(new URL("api/workflow/status", entry.url)).then(response => response.json());
        assert.equal(first.workflowRuntime.runId, "run");
        assert.equal(first.workflowRuntime.status, "running");
        unavailable = true;
        const second = await fetch(new URL("api/workflow/status", entry.url)).then(response => response.json());
        assert.equal(second.workflowRuntime.status, "unavailable");
        assert.match(second.workflowRuntime.error, /does not mean the workflow failed/);
        assert.equal(h.requests.length, 0);
        assert.equal(h.developmentRequests.length, 0);
    } finally {
        if (entry) {
            clearInterval(entry.heartbeat);
            await new Promise<void>((resolve, reject) => entry.server.close(error => error ? reject(error) : resolve()));
        }
        await h.close();
    }
});
