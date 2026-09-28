import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { test } from "node:test";
import { DevelopmentHandoffs } from "../src/development-handoff.js";
import { DevelopmentTransition } from "../src/development-transition.js";
import { fingerprintPrototypeWorkspace } from "../src/prototype-runtime.js";
import { createProcessState } from "../src/process-state.js";
import { writeJsonAtomically } from "../src/project-store.js";
import { extensionHarness } from "./helpers/extension-harness.js";
import type { HumanLoopRuntimeHandle } from "../stage2/tandem/src/human-loop-controller.mjs";
import type { TandemState } from "../src/types.js";

async function fixture(mode: "build" | "validate-existing" | "not-applicable") {
    const root = await mkdtemp(join(tmpdir(), "tandem-handoff-"));
    const workspace = join(root, "worktree"), shared = join(root, "shared");
    await mkdir(workspace); await mkdir(shared);
    const requestId = randomUUID(), sketchId = randomUUID();
    const source = join(shared, ".tandem", "efforts", "fixture", "previews", requestId);
    await mkdir(join(source, "src"), { recursive: true });
    await writeFile(join(source, "src", "app.tsx"), "export const App = () => 'Mock checkout';");
    await writeFile(join(source, "package.json"), '{"name":"mock-ui","scripts":{"start":"DO NOT RUN"}}');
    await writeFile(join(source, ".env"), "PRIVATE_FIXTURE_CREDENTIAL=do-not-copy");
    for (const name of ["node_modules", ".browser-profile", ".vite-checkpoint"]) {
        await mkdir(join(source, name)); await writeFile(join(source, name, "private"), "Do not retain");
    }
    const png = Buffer.from("retained approved fixture image");
    const assetPath = `.tandem/efforts/fixture/sketches/${sketchId}/home.png`;
    await mkdir(join(shared, ".tandem", "efforts", "fixture", "sketches", sketchId), { recursive: true });
    await writeFile(join(shared, ...assetPath.split("/")), png);
    const asset = { id: "home", path: assetPath, hash: createHash("sha256").update(png).digest("hex"), mediaType: "image/png" };
    const checkpoint = { id: requestId, requestId, workspacePath: source,
        status: "ready", sketchRevisionId: sketchId, sourceFingerprint: await fingerprintPrototypeWorkspace(source) };
    const result = {
        goal: "Preserve exact intent", prototypeApproach: { mode, reason: mode === "not-applicable" ? "CLI-only workflow" : "Agreed UI" },
        confirmed: ["Do not charge real cards"], assumed: ["Mock approval"], deferred: ["Real payments"],
        decisionGraph: { nodes: [{ id: "choice", answer: "Exact user answer" }] },
        prototypeReview: { evidence: [{ type: "shortcut", content: "In-memory state; no backend." }] },
        prototypeFlow: mode === "not-applicable" ? null : { displayedCheckpointId: requestId, checkpoints: [checkpoint] },
        sketch: mode === "not-applicable" ? { current: null, approved: null } : {
            current: { id: sketchId, requirementsDigest: "requirements", documentHash: "drawing" },
            approved: { revisionId: sketchId, requirementsDigest: "requirements", documentHash: "drawing", assets: [asset] },
        },
        artifacts: [{ id: "draft-feature-spec", stage: "prototype", content: "Exact feature specification", reviewStatus: "current" }],
    };
    const path = join(shared, ".tandem", "efforts", "fixture", "stages", "prototype-r4.json");
    await writeJsonAtomically(path, { version: 1, prototypeId: "fixture", stageId: "prototype", revision: 4,
        completedAt: "2026-09-01T01:00:00.000Z", result });
    const state = {
        prototypeId: "fixture", generation: "original-generation", revision: 4,
        lifecycle: { currentStage: "development", completedStages: ["prepare", "requirements", "sketch", "prototype"],
            outputs: [{ stageId: "prototype", path: relative(shared, path), completedAt: "2026-09-01T01:00:00.000Z" }], skippedStages: [] },
        designReview: {}, testDesignReview: {}, planning: {}, implementation: {}, testing: {},
        process: createProcessState(),
    } as TandemState;
    const store = new DevelopmentHandoffs(workspace, shared, "main");
    return { root, workspace, shared, state, result, source, path, store, cleanup: () => rm(root, { recursive: true, force: true }) };
}

for (const mode of ["build", "validate-existing", "not-applicable"] as const) {
    test(`${mode} retains exact immutable docs, approved assets and the displayed multi-file source`, async () => {
        const f = await fixture(mode);
        try {
            const receipt = await f.store.prepare(f.state);
            const directory = f.store.directory(receipt.id);
            assert.equal(receipt.target.workspaceRoot, f.workspace);
            assert.equal(receipt.source.sharedRoot, f.shared);
            assert.notEqual(receipt.target.workspaceRoot, receipt.source.sharedRoot);
            assert.deepEqual(await readFile(join(directory, "snapshot.json")), await readFile(f.path));
            assert.match(receipt.request.message, /Do not implement, run prototype scripts/);
            assert.match(receipt.request.message, /stage_human_design and submit_designer_outcome/);
            assert.equal(receipt.prototype.disposition, mode);
            assert.equal(receipt.files.some(file => file.path === "source/src/app.tsx"), mode !== "not-applicable");
            assert.equal(receipt.files.some(file => /node_modules|browser-profile|vite-checkpoint|\.env/.test(file.path)), false);
            assert.equal(receipt.files.some(file => file.path.startsWith("assets/")), mode !== "not-applicable");
            const duplicate = await Promise.all([f.store.prepare(f.state), f.store.prepare(f.state)]);
            assert.deepEqual(duplicate.map(value => value.request), [receipt.request, receipt.request]);
            await rm(join(f.shared, ".tandem", "efforts", "fixture"), { recursive: true });
            assert.deepEqual(await f.store.read(receipt.id), receipt, "Upstream cleanup cannot remove admitted source/documents.");
        } finally { await f.cleanup(); }
    });
}

test("handoff admission reconciles exact lost acknowledgements and never replays retired work", async () => {
    const f = await fixture("not-applicable");
    try {
        const receipt = await f.store.prepare(f.state);
        const requests: any[] = [];
        let sends = 0;
        const state = { owner: { mainSessionId: "main", privateSessionId: "private", workspacePath: f.workspace }, requests, recoveries: [] };
        const runtime = { sessionId: "private", store: { load: async () => state },
            send: async (request: unknown) => { sends++; requests.push({ ...request as object, status: "waiting" }); throw new Error("Lost acknowledgement"); } };
        await assert.rejects(f.store.admit(receipt.id, runtime as HumanLoopRuntimeHandle), /Lost acknowledgement/);
        requests[0].status = "retired";
        const reopened = new DevelopmentHandoffs(f.workspace, f.shared, "main");
        const repeated = await reopened.admit(receipt.id, runtime as HumanLoopRuntimeHandle);
        assert.match(repeated.message, /retired/);
        assert.equal(sends, 1);
        assert.equal((await reopened.context()).length, 1, "Immutable provenance survives native compaction/recovery.");
        requests[0].message += " conflicting retry";
        await assert.rejects(reopened.admit(receipt.id, runtime as HumanLoopRuntimeHandle), /conflicting content/);
        assert.equal(sends, 1);
    } finally { await f.cleanup(); }
});

test("uncertain undelivered admission cannot cross native recovery and cannot switch owners", async () => {
    const f = await fixture("not-applicable");
    try {
        const receipt = await f.store.prepare(f.state);
        const state: any = { owner: { mainSessionId: "main", privateSessionId: "private", workspacePath: f.workspace }, requests: [], recoveries: [] };
        let sends = 0;
        const runtime = { sessionId: "private", store: { load: async () => state }, send: async () => { sends++; throw new Error("Not acknowledged"); } };
        await assert.rejects(f.store.admit(receipt.id, runtime as HumanLoopRuntimeHandle), /Not acknowledged/);
        state.recoveries.push({ id: "recovered" });
        await assert.rejects(f.store.admit(receipt.id, runtime as HumanLoopRuntimeHandle), /cannot be redelivered/);
        state.owner.mainSessionId = "foreign";
        await assert.rejects(f.store.admit(receipt.id, runtime as HumanLoopRuntimeHandle), /ownership differs/);
        await assert.rejects(new DevelopmentHandoffs(f.workspace, f.shared, "foreign").read(receipt.id), /another workspace or owner/);
        assert.equal(sends, 1);
    } finally { await f.cleanup(); }
});

test("changed source, sketch identity and immutable retained bytes fail explicitly", async () => {
    const f = await fixture("build");
    try {
        await writeFile(join(f.source, "src", "app.tsx"), "changed");
        await assert.rejects(f.store.prepare(f.state), /source changed/);
        await writeFile(join(f.source, "src", "app.tsx"), "export const App = () => 'Mock checkout';");
        const receipt = await f.store.prepare(f.state);
        await writeFile(join(f.store.directory(receipt.id), "source", "src", "app.tsx"), "tampered");
        await assert.rejects(f.store.read(receipt.id), /missing, changed or aliased|exceeds/);
    } finally { await f.cleanup(); }
});

test("mixed composer/handoff gate ordering cannot deadlock the native admission queue", async () => {
    const root = await mkdtemp(join(tmpdir(), "tandem-transition-"));
    try {
        const transition = new DevelopmentTransition(root);
        let queue: Promise<unknown> = Promise.resolve();
        const admitted: string[] = [];
        const send = (id: string) => transition.run(async () => {
            const work = queue.then(() => { admitted.push(id); });
            queue = work.then(() => undefined, () => undefined);
            return work;
        });
        const entered = Promise.withResolvers<void>(), proceed = Promise.withResolvers<void>();
        const handoff = transition.run(async () => { entered.resolve(); await proceed.promise; await send("handoff"); });
        await entered.promise;
        const composer = send("composer");
        proceed.resolve();
        await Promise.race([Promise.all([handoff, composer]), new Promise<never>((_, reject) => {
            const timer = setTimeout(() => reject(new Error("Admission lock inversion")), 3000); timer.unref();
        })]);
        assert.deepEqual(admitted, ["handoff", "composer"]);
    } finally { await rm(root, { recursive: true, force: true }); }
});

test("a stale generation cannot create a new handoff or submit work", async () => {
    const h = await extensionHarness();
    try {
        const state = h.api.createState("stale");
        state.lifecycle.currentStage = state.stage = "development";
        state.lifecycle.completedStages = ["prepare", "requirements", "sketch", "prototype"];
        state.lifecycle.outputs = [{ stageId: "prototype", path: "unchanged-path", completedAt: "now" }];
        await h.api.persistState(state);
        await assert.rejects(h.api.continueDevelopment("stale", "project:tandem", {
            generation: "older-generation", expectedRevision: state.revision, snapshotPath: "unchanged-path",
        }), /changed/);
        assert.equal(h.developmentRequests.length, 0);
    } finally { await h.close(); }
});

test("shared upstream storage does not make another worktree's active work a local cutover blocker", async () => {
    const root = await mkdtemp(join(tmpdir(), "tandem-shared-worktrees-"));
    const shared = join(root, "shared"), local = join(root, "local"), other = join(root, "other");
    const h = await extensionHarness({}, shared, "", local);
    try {
        await mkdir(other);
        const state = h.api.createState("other-effort");
        state.preparation.status = "running";
        state.jobOwner = { sessionId: "original-owner", workspaceRoot: other };
        await h.api.persistState(state);
        await h.api.assertDevelopmentAvailable();
        state.jobOwner.workspaceRoot = local;
        await h.api.persistState(state);
        await assert.rejects(h.api.assertDevelopmentAvailable(), /Finish upstream work/);
        assert.equal((await h.api.loadState(state.prototypeId)).jobOwner?.sessionId, "original-owner");
        assert.equal(h.developmentRequests.length, 0);
    } finally { await h.close(); await rm(root, { recursive: true, force: true }); }
});

test("Reset racing a prepared handoff waits for admission and cannot erase admitted inputs", async () => {
    const h = await extensionHarness();
    try {
        const state = h.api.createState("race", "A command-line tool");
        state.stage = state.lifecycle.currentStage = "requirements";
        state.lifecycle.completedStages = ["prepare"];
        state.preparation.status = "ready";
        state.requirements = { substage: "dag", usageItems: ["Use the command"], suggestions: [] };
        state.decisionGraph.nodes = [{ id: "choice", title: "Command behavior", dependencies: [],
            question: null, answer: "Use the CLI", status: "answered" }];
        state.prototypeApproach = { mode: "not-applicable", reason: "CLI only" };
        await h.api.persistState(state);
        const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
        h.setBeforeDevelopmentStart(async () => { entered.resolve(); await release.promise; });
        const handoff = h.api.completeLifecycleStage("race", "requirements", "project:tandem");
        await entered.promise;
        const prepared = await h.api.loadState("race");
        let resetSettled = false;
        const reset = h.api.resetEffort("race", "project:tandem", {
            expectedRevision: prepared.revision, generation: prepared.generation, confirm: true,
        }).finally(() => { resetSettled = true; });
        void reset.catch(() => {});
        await new Promise(resolve => setTimeout(resolve, 20));
        assert.equal(resetSettled, false);
        assert.equal(h.developmentRequests.length, 0);
        release.resolve();
        await handoff;
        await assert.rejects(reset, /Development/);
        assert.equal(h.developmentRequests.length, 1);
        const retained = await h.api.loadState("race");
        assert.equal(retained.generation, prepared.generation);
        assert.equal(retained.development?.handoffId, prepared.development?.handoffId);
        assert.ok(await readFile(join(h.root, ".tandem", "living-canvas", "handoffs", retained.development!.handoffId, "receipt.json")));
    } finally { await h.close(); }
});
