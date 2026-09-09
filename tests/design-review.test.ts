import assert from "node:assert/strict";
import { test } from "node:test";
import { extensionHarness } from "./helpers/extension-harness.js";
import type { TandemArtifact, TandemState } from "../src/types.js";

type Harness = Awaited<ReturnType<typeof extensionHarness>>;
interface DesignRequest {
    args: {
        action: "process-thread" | "finalize";
        reviewKind: "product" | "test";
        thread: { id: string; prompt: string; artifactKind: string } | null;
        state: TandemState;
    };
}

const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
const draftIds = ["default-project-integration-tests", "default-project-interaction-tests"];
const scenario = {
    id: "integration-scenario", title: "Accepted integration", type: "integration",
    description: "Exercise the accepted boundary", dependencies: [],
    steps: ["Send a valid request"], expectedOutcome: "The boundary returns the expected response",
    validation: ["Assert the response"],
};

function artifact(id: string, kind = id, sourceThreadIds: string[] = []): TandemArtifact {
    return { id, title: id, kind, stage: "design", path: "", language: "markdown",
        content: `Reviewed content for ${id}`, mermaid: "", reviewStatus: "current", sourceThreadIds };
}

function designState(h: Harness, substage: "product" | "test" = "test"): TandemState {
    const state = h.api.createState("sample", "Preserve accepted design and review history");
    state.lifecycle.currentStage = state.stage = "design";
    state.lifecycle.completedStages = ["prepare", "requirements", "prototype"];
    state.design.substage = substage;
    state.designReview.threads = [{
        id: "accepted-product", prompt: "Review the product", type: "question", artifactKind: null,
        answer: "Accepted product answer", status: "resolved", artifactIds: [],
        reviewArtifactId: null, createdAt: "2026-09-09T00:00:00Z", completedAt: "2026-09-09T00:01:00Z", error: "",
    }];
    if (substage === "test") {
        state.designReview.finalizedArtifactId = "design-spec";
        state.artifacts = [artifact("design-spec", "design-spec", ["accepted-product"])];
    }
    return state;
}

function worker(h: Harness, fail?: (request: DesignRequest) => boolean): DesignRequest[] {
    const requests: DesignRequest[] = [];
    h.api.setSession({ ...h.session, rpc: { ...h.session.rpc, factory: {
        run: async (request: DesignRequest) => {
            requests.push(request);
            const runId = `design-run-${requests.length}`;
            if (fail?.(request)) return { runId, status: "failed", error: "Draft generation failed" };
            const { action, reviewKind, thread, state } = request.args;
            const review = reviewKind === "test" ? state.testDesignReview : state.designReview;
            const artifacts = action === "finalize"
                ? [artifact(reviewKind === "test" ? "test-spec" : "design-spec",
                    reviewKind === "test" ? "test-spec" : "design-spec",
                    review.threads.map((item: { id: string }) => item.id))]
                : [artifact(`${thread!.id}-draft`, thread!.artifactKind, [thread!.id])];
            return { runId, status: "completed", result: {
                answer: "Generated design artifacts", artifacts,
                testScenarios: action === "finalize" && reviewKind === "test" ? [scenario] : [],
            } };
        },
    } } });
    return requests;
}

async function post(url: string, path: string, body: unknown = {}) {
    return fetch(new URL(path, url), {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
}

test("default review seeding covers both substages and preserves existing review work", async () => {
    const h = await extensionHarness();
    try {
        const initial = designState(h);
        const seeded = h.api.seedDefaultDesignReview(initial, "2026-09-09T01:00:00Z");
        assert.deepEqual(plain(seeded.testDesignReview.threads.map((thread: { id: string }) => thread.id)), draftIds);
        assert.equal(initial.testDesignReview.threads.length, 0);
        assert.deepEqual(plain(seeded.designReview), plain(initial.designReview));
        assert.deepEqual(plain(seeded.artifacts), plain(initial.artifacts));
        assert.equal(seeded.testDesignReview.finalizeRequested, false);
        assert.equal(seeded.testDesignReview.finalizedArtifactId, null);
        for (const thread of seeded.testDesignReview.threads) {
            assert.equal(thread.type, "artifact");
            assert.equal(thread.artifactKind, "test-scenario");
            assert.equal(thread.status, "queued");
            assert.equal(thread.createdAt, "2026-09-09T01:00:00Z");
            assert.match(thread.prompt, /accepted design-spec/);
            assert.match(thread.prompt, /drafts for user review, not the final test-spec/);
        }
        for (const status of ["queued", "processing", "answered", "resolved", "failed"]) {
            const existing = plain(seeded);
            existing.testDesignReview.threads[0].status = status;
            assert.equal(h.api.seedDefaultDesignReview(existing), existing);
        }
        for (const review of [
            { finalizeRequested: true },
            { finalizedArtifactId: "test-spec" },
            { scenarios: [scenario] },
            { processing: { action: "finalize", requestId: "pending", threadId: null, runId: "run", requestedAt: "" } },
        ]) {
            const existing = { ...initial, testDesignReview: { ...initial.testDesignReview, ...review } };
            assert.equal(h.api.seedDefaultDesignReview(existing), existing);
        }
        const inactive = { ...initial, lifecycle: { ...initial.lifecycle, currentStage: "plan" as const } };
        assert.equal(h.api.seedDefaultDesignReview(inactive), inactive);
        const resetting = { ...initial, effortReset: { requestId: "reset" } };
        assert.equal(h.api.seedDefaultDesignReview(resetting), resetting);
        const product = designState(h, "product");
        product.designReview.threads = [];
        const productSeeded = h.api.seedDefaultDesignReview(product);
        assert.equal(productSeeded.designReview.threads.length, 3);
        assert.equal(productSeeded.testDesignReview.threads.length, 0);
    } finally { await h.close(); }
});

test("product finalization automatically generates test drafts, but only reviewed drafts can finalize", async (t) => {
    const h = await extensionHarness();
    try {
        await h.api.persistState(designState(h, "product"));
        const requests = worker(h);
        const entry = await h.api.startServer("review", "sample", "project:tandem", true);
        t.after(async () => {
            clearInterval(entry.heartbeat);
            await new Promise<void>((resolve) => entry.server.close(() => resolve()));
        });
        assert.equal((await post(entry.url, "api/design-review/finalize")).status, 202);
        await h.api.waitForDesignReview("sample");
        const drafted = await h.api.loadState("sample");
        assert.deepEqual(requests.map((request) => [request.args.reviewKind, request.args.action]), [
            ["product", "finalize"], ["test", "process-thread"], ["test", "process-thread"],
        ]);
        assert.equal(drafted.design.substage, "test");
        assert.equal(drafted.designReview.finalizedArtifactId, "design-spec");
        assert.equal(drafted.testDesignReview.threads.length, 2);
        assert.ok(drafted.testDesignReview.threads.every((thread: { status: string }) => thread.status === "answered"));
        assert.equal(drafted.testDesignReview.finalizedArtifactId, null);
        assert.equal(drafted.testDesignReview.scenarios.length, 0);
        assert.equal(drafted.artifacts.some((item) => item.id === "test-spec"), false);
        for (const request of requests.slice(1)) {
            assert.ok(request.args.state.artifacts.some((item) => item.id === "design-spec"));
        }
        assert.equal((await post(entry.url, "api/design-review/finalize")).status, 409);
        for (const threadId of draftIds) {
            assert.equal((await post(entry.url, "api/design-review/thread", { threadId, action: "resolve" })).status, 200);
        }
        assert.equal((await post(entry.url, "api/design-review/finalize")).status, 202);
        await h.api.waitForDesignReview("sample");
        const finalized = await h.api.loadState("sample");
        assert.equal(requests.length, 4);
        assert.equal(finalized.testDesignReview.finalizedArtifactId, "test-spec");
        assert.deepEqual(plain(finalized.testDesignReview.scenarios), [scenario]);
        assert.equal(finalized.testing.scenarios[0].id, scenario.id);
        assert.deepEqual(plain(finalized.artifacts.find((item) => item.id === "test-spec")!.sourceThreadIds), draftIds);
        assert.equal(finalized.artifacts.filter((item) => item.kind === "test-scenario").length, 2);
        assert.equal(h.api.stageCompletionError(finalized, "design"), null);
        assert.equal((await post(entry.url, "api/design-review/thread", {
            threadId: draftIds[0], action: "reopen",
        })).status, 200);
        const reopened = await h.api.loadState("sample");
        assert.equal(reopened.testDesignReview.finalizedArtifactId, null);
        assert.equal(reopened.artifacts.find((item) => item.id === "test-spec")!.reviewStatus, "stale");
        assert.equal(reopened.artifacts.find((item) => item.id === "design-spec")!.reviewStatus, "current");
        assert.equal((await post(entry.url, "api/design-review/finalize")).status, 409);
    } finally { await h.close(); }
});

test("opening an existing empty Test design effort recovers drafts once and persists them across providers", async () => {
    const h = await extensionHarness();
    try {
        const initial = designState(h);
        await h.api.persistState(initial);
        const readOnly = await h.api.loadState("sample");
        assert.equal(await h.api.ensureDefaultDesignReview(readOnly, false), readOnly);
        assert.equal((await h.api.loadState("sample")).testDesignReview.threads.length, 0);
        const requests = worker(h);
        await h.api.openTandem({
            sessionId: h.session.sessionId, instanceId: "review", extensionId: "project:tandem",
            input: { prototypeId: "sample" }, reason: "rehydrate",
        });
        await h.api.waitForDesignReview("sample");
        const recovered = await h.api.loadState("sample");
        assert.equal(requests.length, 2);
        assert.deepEqual(plain(recovered.designReview), plain(readOnly.designReview));
        assert.deepEqual(plain(recovered.artifacts.find((item) => item.id === "design-spec")),
            plain(readOnly.artifacts[0]));
        const revision = recovered.revision;
        await h.api.ensureDefaultDesignReview(recovered, true);
        assert.equal((await h.api.loadState("sample")).revision, revision);
        const fresh = await extensionHarness({}, h.root);
        try {
            const newRequests = worker(fresh);
            await fresh.api.openTandem({
                sessionId: fresh.session.sessionId, instanceId: "review-reloaded", extensionId: "project:tandem",
                input: { prototypeId: "sample" }, reason: "rehydrate",
            });
            await fresh.api.waitForDesignReview("sample");
            assert.equal(newRequests.length, 0);
            assert.deepEqual(plain((await fresh.api.loadState("sample")).testDesignReview), plain(recovered.testDesignReview));
        } finally { await fresh.close(); }
    } finally { await h.close(); }
});

test("failed automatic test drafts stay reviewable and retry without replacing successful drafts", async () => {
    const h = await extensionHarness();
    try {
        await h.api.persistState(designState(h));
        let fail = true;
        const requests = worker(h, (request) => fail && request.args.thread?.id === draftIds[0]);
        const entry = await h.api.openTandem({
            sessionId: h.session.sessionId, instanceId: "failed-review", extensionId: "project:tandem",
            input: { prototypeId: "sample" },
        });
        await h.api.waitForDesignReview("sample");
        const failed = await h.api.loadState("sample");
        assert.deepEqual(plain(failed.testDesignReview.threads.map((thread: { status: string }) => thread.status)), ["failed", "answered"]);
        assert.match(failed.testDesignReview.threads[0].error, /Draft generation failed/);
        assert.equal((await post(entry.url, "api/design-review/finalize")).status, 409);
        fail = false;
        assert.equal((await post(entry.url, "api/design-review/thread", { threadId: draftIds[0], action: "retry" })).status, 200);
        await h.api.waitForDesignReview("sample");
        const retried = await h.api.loadState("sample");
        assert.equal(requests.length, 3);
        assert.equal(retried.testDesignReview.threads[0].id, draftIds[0]);
        assert.equal(retried.testDesignReview.threads[0].status, "answered");
        assert.equal(retried.testDesignReview.threads[0].error, "");
        assert.deepEqual(plain(retried.testDesignReview.threads[1]), plain(failed.testDesignReview.threads[1]));
    } finally { await h.close(); }
});

test("an empty Test design cannot bypass draft review through finalization", async (t) => {
    const h = await extensionHarness();
    try {
        await h.api.persistState(designState(h));
        const entry = await h.api.startServer("empty-review", "sample", "project:tandem", true);
        t.after(async () => {
            clearInterval(entry.heartbeat);
            await new Promise<void>((resolve) => entry.server.close(() => resolve()));
        });
        const response = await post(entry.url, "api/design-review/finalize");
        assert.equal(response.status, 409);
        assert.match((await response.json()).error, /initial test-design drafts/);
        assert.equal((await h.api.loadState("sample")).testDesignReview.finalizeRequested, false);
        assert.equal(h.requests.length, 0);
    } finally { await h.close(); }
});
