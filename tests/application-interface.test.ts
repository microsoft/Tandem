import assert from "node:assert/strict";
import { test } from "node:test";
import {
    APPLICATION_PROTOCOL, ApplicationError, applicationRequest, collectApplicationReply, matchApplicationOperation,
    objectSchema, stringSchema, validateApplicationInput,
} from "../development/tandem/runtime-src/application-interface.js";
import { upstreamOperations } from "../src/application-interface.js";
import { extensionHarness } from "./helpers/extension-harness.js";
import type { TandemState } from "../src/types.js";
import { createDevelopmentApplication } from "../development/tandem/src/human-loop-application.mjs";

const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const target = { prototypeId: "sample" };
const command = (operation: string, input: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
    ({ protocol: APPLICATION_PROTOCOL, target, operation, input, ...extra });

async function fixture() {
    const h = await extensionHarness();
    const state = h.api.createState("sample", "A team task board");
    state.stage = state.lifecycle.currentStage = "requirements";
    state.lifecycle.completedStages = ["prepare"];
    state.preparation.status = "ready";
    state.prototypeApproach = { mode: "build", reason: "A graphical task board" };
    state.requirements = { substage: "dag", usageItems: ["I want to assign tasks."], suggestions: [] };
    state.decisionGraph = { nodes: [{
        id: "assignment", title: "Assignment", dependencies: [], status: "answered", answer: "One person",
        question: { id: "assignment", text: "Who owns a task?", rationale: "Assignment behavior",
            choices: ["One person", "Several people", "No owner"], recommended: "One person", allowFreeText: true, answerPlaceholder: "" },
    }] };
    await h.api.persistState(state);
    return h;
}

test("the operation catalog is unique and binds input schemas to the exact UI routes", () => {
    assert.equal(new Set(upstreamOperations.map(operation => operation.id)).size, upstreamOperations.length);
    for (const operation of upstreamOperations) {
        assert.ok(operation.description);
        assert.equal(operation.inputSchema.type, "object");
        assert.equal(operation.inputSchema.additionalProperties, false);
        for (const key of operation.inputSchema.required ?? []) assert.ok(Object.hasOwn(operation.inputSchema.properties!, key));
    }
    const preview = upstreamOperations.find(operation => operation.id === "prototype.preview")!;
    const route = applicationRequest(preview, { target: "original" });
    assert.equal(route.path, "/api/prototype/preview-status?target=original");
    assert.deepEqual(matchApplicationOperation(upstreamOperations, route.method, route.path, route.input), {
        operation: preview, input: { target: "original" },
    });
    assert.throws(() => applicationRequest(preview, { target: "original", url: "http://example.test/" }), /does not accept url/);
    assert.equal(matchApplicationOperation(upstreamOperations, "POST", "/api/arbitrary-code", {}), undefined);
});

test("schema validation rejects wrong types, extra fields and invalid union branches", () => {
    const schema = objectSchema({
        value: { anyOf: [stringSchema(10), { type: "null" }] }, count: { type: "integer", minimum: 0 },
        choice: { oneOf: [{ const: "first" }, { const: "second" }] },
    }, ["value", "count", "choice"]);
    for (const value of [
        { value: 1, count: 0, choice: "first" }, { value: null, count: 1.5, choice: "first" },
        { value: null, count: -1, choice: "first" }, { value: null, count: 0, choice: "third" },
        { value: null, count: 0, choice: "first", actor: "user" },
    ]) assert.throws(() => validateApplicationInput(value, schema), ApplicationError);
    assert.doesNotThrow(() => validateApplicationInput({ value: null, count: 0, choice: "first" }, schema));
});

test("dispatch must return exactly one outcome and never converts a thrown error into success", async () => {
    assert.deepEqual(await collectApplicationReply(async respond => respond(202, { requestId: "one" })), {
        status: 202, body: { requestId: "one" },
    });
    await assert.rejects(collectApplicationReply(async () => {}), /did not return a result/);
    await assert.rejects(collectApplicationReply(async respond => { respond(200, {}); respond(200, {}); }), /more than one/);
    await assert.rejects(collectApplicationReply(async () => { throw new Error("storage failed"); }), /storage failed/);
    await assert.rejects(collectApplicationReply(async respond => {
        respond(202, { requestId: "retained" });
        throw new Error("Post-admission dispatch failed");
    }), error => error instanceof ApplicationError && (error.details as { accepted: boolean }).accepted === true
        && /Post-admission/.test(error.message));
});

test("headless inspection does not start workers and describes full schemas only on request", async t => {
    const h = await fixture(); t.after(() => h.close());
    const before = await h.api.loadState("sample");
    const overview = await h.api.inspectApplication({ target });
    assert.equal(overview.protocol, APPLICATION_PROTOCOL);
    assert.equal(overview.owner, "upstream");
    assert.equal(overview.operations.length, upstreamOperations.length);
    assert.ok(overview.operations.every(operation => operation.inputSchema === undefined));
    const described = await h.api.inspectApplication({ target, operation: "reviews.open" });
    assert.equal(described.operations.length, 1);
    assert.ok(described.operations[0].inputSchema);
    assert.deepEqual(plain(await h.api.loadState("sample")), plain(before));
    assert.equal(h.requests.length, 0);
    assert.equal(h.developmentRequests.length, 0);
});

test("DAG generation is a deterministic command without a synthetic user answer and returns its request identity", async t => {
    const h = await fixture(); t.after(() => h.close());
    const state = await h.api.loadState("sample");
    state.requirements.substage = "usage";
    state.decisionGraph = { nodes: [] };
    await h.api.persistState(state);
    const view = await h.api.inspectApplication({ target, operation: "requirements.submit", input: { action: "generate-dag" } });
    assert.equal(view.operations[0].availability.status, "available");
    const result = await h.api.executeApplication(command("requirements.submit", { action: "generate-dag" }, { expected: view.binding }));
    await h.waitForRequests();
    const pending = await h.api.loadState("sample");
    assert.equal(result.outcome, "accepted");
    assert.equal((result.data as { requestId: string }).requestId, pending.processing?.requestId);
    assert.equal(pending.processing?.action, "generate-dag");
    assert.equal(pending.processing?.question.id, "usage-intake");
    const operation = upstreamOperations.find(item => item.id === "requirements.submit")!;
    assert.throws(() => applicationRequest(operation, { action: "add-usage" }), /declared schema/);
    assert.throws(() => applicationRequest(operation, { action: "answer-decision", answer: "One person" }), /declared schema/);
});

test("agents can create, inspect and edit isolated review drafts but cannot apply or approve them", async t => {
    const h = await fixture(); t.after(() => h.close());
    const before = await h.api.inspectApplication({ target });
    const result = await h.api.executeApplication(command("reviews.open", {
        stageId: "prepare", expectedGeneration: before.binding.generation,
    }, { expected: before.binding }));
    assert.equal(result.outcome, "accepted");
    const draft = (result.data as { draft: TandemState }).draft;
    const reviewTarget = { ...target, reviewId: draft.prototypeId };
    const opened = await h.api.inspectApplication({ target: reviewTarget });
    assert.equal(opened.state.stageReview?.parentId, "sample");
    assert.equal(opened.operations.find(operation => operation.id === "reviews.apply")?.availability.status, "human-required");
    const changed = await h.api.executeApplication(command("reviews.edit-brief", {
        goal: "A reviewed task board with owners", expectedRevision: opened.binding.revision,
    }, { target: reviewTarget, expected: opened.binding }));
    assert.equal((changed.data as TandemState).goal, "A reviewed task board with owners");
    assert.equal((await h.api.loadState("sample")).goal, before.state.goal);
    await assert.rejects(h.api.executeApplication(command("reviews.apply", {
        reviewId: draft.prototypeId, expectedRevision: (changed.data as TandemState).revision,
    }, { target: reviewTarget, expected: opened.binding })), /belongs to the user/);
    await assert.rejects(h.api.executeApplication(command("native.submit", {
        id: "not-admitted", message: "Implement", receivedAt: new Date().toISOString(),
    }, { target: reviewTarget })), /pinned draft cannot submit/);
    assert.equal(h.developmentRequests.length, 0);
    assert.equal(h.requests.length, 0);
});

test("state bindings are checked under the existing transaction and reject concurrent stale edits", async t => {
    const h = await fixture(); t.after(() => h.close());
    const parent = await h.api.inspectApplication({ target });
    const opened = await h.api.executeApplication(command("reviews.open",
        { stageId: "prepare", expectedGeneration: parent.binding.generation }, { expected: parent.binding }));
    const draft = (opened.data as { draft: TandemState }).draft;
    const reviewTarget = { ...target, reviewId: draft.prototypeId };
    const view = await h.api.inspectApplication({ target: reviewTarget });
    const attempts = await Promise.allSettled(["First brief", "Second brief"].map(goal =>
        h.api.executeApplication(command("reviews.edit-brief", { goal, expectedRevision: view.binding.revision },
            { target: reviewTarget, expected: view.binding }))));
    assert.equal(attempts.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(attempts.filter(result => result.status === "rejected").length, 1);
    await assert.rejects(h.api.executeApplication(command("reviews.open",
        { stageId: "prepare", expectedGeneration: parent.binding.generation })), /exact generation and revision/);
});

test("unknown operations, forged authority and unlinked reviews fail without mutating state", async t => {
    const h = await fixture(); t.after(() => h.close());
    const before = await h.api.loadState("sample");
    await assert.rejects(h.api.executeApplication(command("eval", { script: "throw 1" })), /Unknown operation/);
    await assert.rejects(h.api.executeApplication({ ...command("project.state"), actor: "user" }), /does not accept actor/);
    await assert.rejects(h.api.inspectApplication({ target: { ...target, reviewId: "review-00000000-0000-4000-8000-000000000000" } }),
        /not linked to this effort/);
    await assert.rejects(h.api.executeApplication(command("requirements.submit", {
        action: "change-answer", questionId: "assignment", answer: "Several people",
    }, { expected: { generation: before.generation, revision: before.revision } })), /belongs to the user/);
    assert.deepEqual(plain(await h.api.loadState("sample")), plain(before));
});

test("HTTP and agent adapters read the same state and domain rejection without a canvas", async t => {
    const h = await fixture();
    let server: Awaited<ReturnType<typeof h.api.startServer>> | undefined;
    t.after(async () => {
        try {
            if (server) {
                clearInterval(server.heartbeat);
                server.server.closeAllConnections();
                await new Promise<void>((resolve, reject) => server!.server.close(error => error ? reject(error) : resolve()));
            }
        } finally { await h.close(); }
    });
    const state = await h.api.loadState("sample");
    state.goal = "A command-line task list";
    state.prototypeApproach = { mode: "not-applicable", reason: "This transport fixture has no graphical interface." };
    await h.api.persistState(state);
    server = await h.api.startServer("http-fixture", "sample", "project:tandem", true);
    const response = await fetch(new URL("api/application/inspect", server.url), {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ target }),
    });
    assert.equal(response.status, 200);
    const http = await response.json();
    const direct = await h.api.inspectApplication({ target });
    assert.deepEqual(http.binding, plain(direct.binding));
    assert.deepEqual(http.state, plain(direct.state));
    const denied = await fetch(new URL("api/application/execute", server.url), {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(command("stages.complete", { stageId: "requirements" }, { expected: direct.binding })),
    });
    assert.equal(denied.status, 409);
    assert.equal((await denied.json()).code, "human_decision_required");
    const malformed = await fetch(new URL("api/application/execute", server.url), {
        method: "POST", headers: { "content-type": "application/json" }, body: "{invalid",
    });
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).code, "invalid_json");
    const foreign = await fetch(new URL("api/application/execute", server.url), {
        method: "POST", headers: { "content-type": "application/json", origin: "https://example.test" },
        body: JSON.stringify(command("project.state")),
    });
    assert.equal(foreign.status, 403);
    await foreign.text();
    const completed = await fetch(new URL("api/stage/complete", server.url), {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ stageId: "requirements" }),
    });
    assert.equal(completed.status, 200, "The existing human UI path retains stage completion authority.");
    assert.equal((await completed.json()).lifecycle.currentStage, "development");
    assert.equal(h.requests.length, 0, "This transport/authority check does not launch a graphical worker.");
});

test("the integrated native bridge delegates exact envelopes and never substitutes an unavailable owner", async t => {
    const h = await fixture(); t.after(() => h.close());
    await assert.rejects(h.api.inspectApplication({ target, owner: "development" }), /matching application interface/);
    const requests: unknown[] = [];
    h.setDevelopmentApplication(createDevelopmentApplication({
        snapshot: async () => ({ installation: { status: "ready" }, workflow: { canSend: true } }),
        dispatch: async (request, respond) => {
            requests.push(request);
            respond(202, { requestId: request.input.id });
        },
    }));
    const input = { id: "native-one", message: "Review the existing Design.", receivedAt: "2026-10-27T18:00:00Z" };
    const result = await h.api.executeApplication(command("native.submit", input));
    assert.equal(result.outcome, "accepted");
    assert.deepEqual(plain(result.data), { requestId: input.id });
    assert.deepEqual(plain(requests), [{ method: "POST", path: "/api/requests", input }]);
    assert.equal(h.requests.length, 0, "No upstream worker or second scheduler was involved.");
    await assert.rejects(h.api.executeApplication(command("native.submit", input,
        { expected: { generation: "upstream-only", revision: 1 } })), /not an upstream state binding/);
    await assert.rejects(h.api.executeApplication(command("native.permissions.decide", { requestId: "private-one", decision: "all" })),
        /belongs to the user/);
    assert.equal(requests.length, 1);
});
