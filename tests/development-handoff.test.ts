import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { access, link, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { DevelopmentHandoffs } from "../src/development-handoff.js";
import { DevelopmentTransition } from "../src/development-transition.js";
import { fingerprintPrototypeWorkspace } from "../src/prototype-runtime.js";
import { createProcessState } from "../src/process-state.js";
import { writeJsonAtomically } from "../src/project-store.js";
import { extensionHarness } from "./helpers/extension-harness.js";
import type { HumanLoopRuntimeHandle } from "../stage2/tandem/src/human-loop-controller.mjs";
import type { TandemState } from "../src/types.js";
import { HostStateFile, legacyHostFiles, migrateHostState } from "../stage2/tandem/runtime-src/domain/host-state-file.ts";
import { getHostStateWal } from "../stage2/tandem/runtime-src/domain/host-state-wal.ts";
import { ProjectPolicyStore, validateProjectPolicyDocument } from "../stage2/tandem/runtime-src/domain/workflow/project-policy-store.ts";
import { encodeRecord } from "../stage2/tandem/runtime-src/domain/workflow/foundation-storage.ts";
import { DEFAULT_POLICY, policyHash } from "../stage2/tandem/runtime-src/domain/workflow/policy.ts";
import { createHumanLoopLedger, replayHumanLoopLedger } from "../stage2/tandem/runtime-src/domain/human-loop/ledger.ts";
import { HumanLoopInstallation, parseHumanLoopConfiguration } from "../stage2/tandem/src/human-loop-installation.mjs";
import { HumanLoopRuntime } from "../stage2/tandem/src/human-loop-runtime.mjs";
import { createDurablePrivateSession } from "../stage2/tandem/src/human-loop-controller.mjs";

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
    return { root, workspace, shared, state, result, source, path, store, cleanup: async () => {
        await getHostStateWal(workspace).close();
        await rm(root, { recursive: true, force: true });
    } };
}

async function retainedFiles(root: string): Promise<Record<string, Buffer>> {
    const result: Record<string, Buffer> = {};
    async function visit(directory: string) {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
            const path = join(directory, entry.name);
            if (entry.isDirectory()) await visit(path);
            else result[relative(root, path)] = await readFile(path);
        }
    }
    await visit(root);
    return result;
}

async function installationFixture(f: Awaited<ReturnType<typeof fixture>>) {
    const installed = join(f.root, "installed");
    await mkdir(installed);
    const bytes = "Controlled no-model SDK fixture; never executed.";
    const digest = createHash("sha256").update(bytes).digest("hex");
    for (const name of ["sdk.mjs", "copilot.exe", "node.exe"]) await writeFile(join(installed, name), bytes);
    const discovered = {
        sdk: { modulePath: join(installed, "sdk.mjs"), digest },
        cli: { path: join(installed, "copilot.exe"), digest },
        node: { path: join(installed, "node.exe"), digest }, buildId: "handoff-first-fixture",
    };
    const main = { sessionId: "main" };
    let unavailable = false, clients = 0, sends = 0;
    class NoModelClient {
        constructor() { clients++; }
        async start() {}
        rpc = { sessions: {
            open: async ({ options }: { options: { sessionId: string } }) => ({ status: "created", sessionId: options.sessionId }),
            save: async () => {},
        } };
        async resumeSession(sessionId: string, config: { requestExtensions: boolean; continuePendingWork: boolean; suppressResumeEvent: boolean }) {
            assert.equal(config.requestExtensions, false);
            assert.equal(config.continuePendingWork, false);
            assert.equal(config.suppressResumeEvent, true);
            return {
                sessionId, abort: async () => {}, getEvents: async () => [],
                rpc: {
                    mode: { get: async () => "interactive" },
                    metadata: { isProcessing: async () => ({ processing: false }), activity: async () => ({ hasActiveWork: false }) },
                    queue: { pendingItems: async () => ({ items: [], steeringMessages: [] }) },
                },
                send: async () => { sends++; assert.fail("Startup and retained-request reconciliation must not send a model turn."); },
            };
        }
        async stop() { return []; }
    }
    const configuration = parseHumanLoopConfiguration({
        schemaVersion: "human-loop-runtime/v1",
        owner: { schemaVersion: "human-loop-owner/v1", id: "fixture-owner", mainSessionId: "main",
            privateSessionId: "fixture-private", workspacePath: f.workspace, policy: DEFAULT_POLICY },
        runtimeDirectory: join(f.root, "runtime", "fixture"), ...discovered,
    });
    const options = {
        workspacePath: f.workspace, mainSession: main,
        registration: { session: main, id: "fixture-registration", toolHook() {}, permissionHandler() {} },
        runtimeRoot: join(f.root, "runtime"),
        discoverRuntime: async () => {
            if (unavailable) throw new Error("Fixture runtime installation is temporarily unavailable.");
            return discovered;
        },
        loadSdk: async () => ({ RuntimeConnection: { forStdio: () => ({ kind: "stdio" }) }, CopilotClient: NoModelClient }),
        createRuntime: async options => new HumanLoopRuntime({ ...options,
            createPrivateSession: config => createDurablePrivateSession(options.client, config),
            onHandoff: async () => assert.fail("Opening storage must not publish a model outcome."),
        }),
    };
    return { configuration, create: () => new HumanLoopInstallation(options),
        setUnavailable(value: boolean) { unavailable = value; }, counts: () => ({ clients, sends }) };
}

test("first Prototype handoff precedes the real WAL, installation and runtime without changing retained inputs", async () => {
    const f = await fixture("build");
    const native = await installationFixture(f);
    let installation = native.create();
    try {
        execFileSync("git", ["init", "--quiet"], { cwd: f.workspace });
        await writeFile(join(f.workspace, ".gitignore"), ".tandem/\n");
        const receipt = await f.store.prepare(f.state);
        const original = await retainedFiles(f.store.root);
        assert.ok(Object.keys(original).some(path => path.endsWith("package.json")), "Retain actual copied source JSON before native startup.");
        const journal = join(f.workspace, ".tandem", "living-canvas", "host-state", "journal.wal");
        await assert.rejects(access(journal), { code: "ENOENT" });

        native.setUnavailable(true);
        await assert.rejects(installation.open(), /temporarily unavailable/);
        await assert.rejects(access(journal), { code: "ENOENT" });
        assert.deepEqual(native.counts(), { clients: 0, sends: 0 });

        const retained = new DevelopmentHandoffs(f.workspace, f.shared, "main");
        assert.deepEqual(await retained.prepare(f.state), receipt, "Retry retains the original request ID, timestamp, message and source hashes.");
        native.setUnavailable(false);
        installation = native.create();
        const runtime = await installation.open();
        assert.equal((await installation.read()).status, "ready");
        assert.equal((await runtime.readiness()).status, "ready");
        assert.equal((await runtime.store.load()).requests.length, 0);
        await access(journal);

        const policy = new ProjectPolicyStore(f.workspace);
        await policy.acquireWriter();
        try {
            await policy.select({}, "explicit-policy-fixture", 0);
            assert.equal((await policy.load()).policy.digest, DEFAULT_POLICY.digest);
        } finally { await policy.close(); }
        assert.deepEqual(await legacyHostFiles(f.workspace), []);
        assert.ok((await getHostStateWal(f.workspace).namespaces()).every(namespace => !namespace.includes("/handoffs")));
        assert.deepEqual(await retainedFiles(f.store.root), original, "Native storage must not import, rewrite or move handoff files.");

        await runtime.store.dispatch("user", `receive:${receipt.request.id}`, "receive-request", receipt.request);
        await runtime.store.dispatch("host", "fixture-recovery", "recover", {
            recoveryId: "fixture-recovery", recoveredAt: new Date().toISOString(), evidenceRef: "a".repeat(64),
            nativeUsers: [], design: (await runtime.store.load()).design,
        });
        const reconciled = await retained.admit(receipt.id, runtime);
        assert.match(reconciled.message, /retired/);
        assert.equal((await runtime.store.load()).requests.length, 1);
        assert.equal((await runtime.store.load()).requests[0].id, receipt.request.id);
        assert.deepEqual(await retained.read(receipt.id), receipt);
        assert.deepEqual(native.counts(), { clients: 1, sends: 0 }, "Reusing an already-retired handoff must not replay it.");
        await installation.close();
    } finally {
        await getHostStateWal(f.workspace).close();
        await f.cleanup();
    }
});

for (const withHandoff of [false, true]) for (const legacy of ["policy", "installation", "ledger"] as const) {
    test(`genuine legacy ${legacy} still requires verified WAL migration${withHandoff ? " alongside a retained handoff" : ""}`, async () => {
        const f = await fixture("build"), native = await installationFixture(f);
        try {
            if (withHandoff) await f.store.prepare(f.state);
            const policy = encodeRecord({ schemaVersion: "project-policy/v1", revision: 1, currentDigest: DEFAULT_POLICY.digest,
                snapshots: [DEFAULT_POLICY], receipts: [{ requestId: "original-policy", expectedRevision: 0,
                    overrideDigest: policyHash({}), selectedDigest: DEFAULT_POLICY.digest }] });
            validateProjectPolicyDocument(policy);
            const ledger = createHumanLoopLedger(native.configuration.owner, { revisionId: null, digest: null });
            replayHumanLoopLedger(ledger);
            const documents = {
                policy: { path: join("policy", "project-policy.json"), content: policy, validate: validateProjectPolicyDocument },
                installation: { path: join("human-loop", "installation.json"),
                    content: JSON.stringify({ schemaVersion: "human-loop-installation/v2", phase: "prepared",
                        configuration: native.configuration, reason: null, closeId: null, closeProof: null, reopenId: null }),
                    validate: (content: string) => parseHumanLoopConfiguration(JSON.parse(content).configuration) },
                ledger: { path: join("human-loop", "ledger.json"), content: JSON.stringify(ledger),
                    validate: (content: string) => replayHumanLoopLedger(JSON.parse(content)) },
            };
            const document = documents[legacy];
            const path = join(f.workspace, ".tandem", "living-canvas", document.path);
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, document.content);
            const file = new HostStateFile(f.workspace, path);
            assert.deepEqual(await legacyHostFiles(f.workspace), [file.path]);
            await assert.rejects(file.mutate("unverified", () => ({ content: document.content, result: null })), /verified.*migration/);
            const installation = native.create();
            await assert.rejects(installation.open(), /verified.*migration/);
            assert.equal(native.counts().clients, 0);
            assert.equal(await readFile(path, "utf8"), document.content);
            assert.equal(await file.journalExists(), false);

            let verifications = 0;
            await migrateHostState({ workspaceRoot: f.workspace, id: "explicit-migration-fixture",
                sources: [{ file, validate: document.validate }], verifyQuiescent: async () => { verifications++; } });
            assert.equal(verifications, 2);
            await file.mutate("verified", content => ({ content: content!, result: null }));
            assert.equal(await readFile(path, "utf8"), document.content);
        } finally { await f.cleanup(); }
    });
}

for (const relativePath of [".tandem", join(".tandem", "living-canvas"), join(".tandem", "living-canvas", "handoffs")]) {
    test(`handoff exclusion still rejects an aliased ${relativePath} boundary before creating a WAL`, async () => {
        const f = await fixture("not-applicable");
        const target = join(f.root, "alias-target"), alias = join(f.workspace, relativePath);
        try {
            await mkdir(target);
            const path = join(target, "original.json");
            await writeFile(path, '{"original":"do not adopt"}');
            await mkdir(dirname(alias), { recursive: true });
            await symlink(target, alias, process.platform === "win32" ? "junction" : "dir");
            await assert.rejects(legacyHostFiles(f.workspace), /aliased|symbolic links/);
            assert.equal(await readFile(path, "utf8"), '{"original":"do not adopt"}');
            await assert.rejects(access(join(f.workspace, ".tandem", "living-canvas", "host-state", "journal.wal")), { code: "ENOENT" });
        } finally {
            await rm(alias, { force: true });
            await f.cleanup();
        }
    });
}

test("the exclusion is exact and keeps hardlink and retained-source alias checks", async () => {
    const f = await fixture("build");
    try {
        const receipt = await f.store.prepare(f.state);
        const sibling = join(f.workspace, ".tandem", "living-canvas", "handoffs-backup", "state.json");
        await mkdir(dirname(sibling), { recursive: true });
        await writeFile(sibling, '{"original":true}');
        const file = new HostStateFile(f.workspace, sibling);
        assert.deepEqual(await legacyHostFiles(f.workspace), [file.path]);
        await assert.rejects(file.mutate("no-broad-exclusion", () => ({ content: "{}", result: null })), /verified.*migration/);
        await link(sibling, join(f.root, "legacy-hardlink.json"));
        await assert.rejects(migrateHostState({ workspaceRoot: f.workspace, id: "aliased-source",
            sources: [{ file, validate: JSON.parse }], verifyQuiescent: async () => {} }), /aliased/);
        const source = join(f.store.directory(receipt.id), "source", "package.json");
        await link(source, join(f.root, "source-hardlink.json"));
        await assert.rejects(f.store.read(receipt.id), /unlinked|aliased|materialized/);
        assert.equal(await file.journalExists(), false);
    } finally { await f.cleanup(); }
});

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
